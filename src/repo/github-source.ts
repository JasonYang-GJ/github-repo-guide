import { createHash } from "node:crypto";
import { posix } from "node:path";
import { gunzipSync } from "node:zlib";
import { ProxyAgent, fetch as undiciFetch } from "undici";

import type {
  RepositoryBlob,
  RepositorySource,
  RepositoryTree,
  ResolvedRepository,
  TreeEntry,
} from "./contracts.js";
import { parseGitHubRepositoryUrl } from "./url-guard.js";
import { MAX_REPOSITORY_TREE_ENTRIES } from "./read-limits.js";

const API_ORIGIN = "https://api.github.com";
const RAW_ORIGIN = "https://raw.githubusercontent.com";
const WEB_ORIGIN = "https://github.com";
const CODELOAD_ORIGIN = "https://codeload.github.com";
const API_VERSION = "2022-11-28";
const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_ARCHIVE_INFLATED_BYTES = 128 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = MAX_REPOSITORY_TREE_ENTRIES;

function configuredProxyUrl(): string | undefined {
  const candidate =
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy;
  if (candidate === undefined || candidate.trim().length === 0) return undefined;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

const proxyUrl = configuredProxyUrl();
const repositoryProxyAgent = proxyUrl === undefined ? undefined : new ProxyAgent(proxyUrl);

const defaultRepositoryFetch: typeof fetch = async (input, init) => {
  if (repositoryProxyAgent === undefined) return await fetch(input, init);
  return (await undiciFetch(input as Parameters<typeof undiciFetch>[0], {
    ...(init as Parameters<typeof undiciFetch>[1]),
    dispatcher: repositoryProxyAgent,
  })) as unknown as Response;
};

export class GitHubApiError extends Error {
  constructor(
    readonly status: number | null,
    message: string,
    readonly rateLimit?: {
      readonly limit: number | null;
      readonly remaining: number | null;
      readonly resetAt: string | null;
      readonly authenticated: boolean;
    },
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

function withFallbackFailure(
  primary: GitHubApiError,
  stage: string,
  fallback: unknown,
): GitHubApiError {
  const detail = fallback instanceof Error ? fallback.message : String(fallback);
  return new GitHubApiError(
    primary.status,
    `${primary.message}; ${stage} failed: ${detail}`,
    primary.rateLimit,
  );
}

export interface GitHubResponseCache {
  get(path: string): unknown | undefined;
  set(path: string, value: unknown): void;
}

interface CachedGitHubResponse {
  readonly value: unknown;
  readonly expiresAt: number;
}

export class MemoryGitHubResponseCache implements GitHubResponseCache {
  private readonly entries = new Map<string, CachedGitHubResponse>();

  constructor(
    private readonly ttlMs = 5 * 60_000,
    private readonly maxEntries = 2_000,
    private readonly now: () => number = Date.now,
  ) {}

  get(path: string): unknown | undefined {
    const cached = this.entries.get(path);
    if (cached === undefined) return undefined;
    if (cached.expiresAt <= this.now()) {
      this.entries.delete(path);
      return undefined;
    }
    this.entries.delete(path);
    this.entries.set(path, cached);
    return cached.value;
  }

  set(path: string, value: unknown): void {
    this.entries.delete(path);
    this.entries.set(path, { value, expiresAt: this.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

export interface GitHubRepositorySourceOptions {
  readonly fetch?: typeof fetch;
  readonly token?: string;
  readonly cache?: GitHubResponseCache;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new GitHubApiError(null, "GitHub returned an unexpected response shape");
  }
  return value as Record<string, unknown>;
}

function repositoryKey(repository: Pick<ResolvedRepository, "owner" | "name" | "commitSha">): string {
  return `${repository.owner}/${repository.name}@${repository.commitSha}`;
}

function tarString(bytes: Buffer, offset: number, length: number): string {
  const raw = bytes.subarray(offset, offset + length).toString("utf8");
  const nul = raw.indexOf("\0");
  return nul === -1 ? raw : raw.slice(0, nul);
}

function tarSize(bytes: Buffer, offset: number, length: number): number {
  const raw = tarString(bytes, offset, length).trim();
  if (raw.length === 0) return 0;
  if (!/^[0-7]+$/.test(raw)) {
    throw new GitHubApiError(null, "GitHub source archive contains an invalid entry size");
  }
  const size = Number.parseInt(raw, 8);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new GitHubApiError(null, "GitHub source archive contains an unsafe entry size");
  }
  return size;
}

function parsePaxPath(bytes: Buffer): string | undefined {
  const text = bytes.toString("utf8");
  let offset = 0;
  let path: string | undefined;
  while (offset < text.length) {
    const space = text.indexOf(" ", offset);
    if (space === -1) break;
    const lengthText = text.slice(offset, space);
    if (!/^\d+$/.test(lengthText)) break;
    const length = Number(lengthText);
    if (!Number.isSafeInteger(length) || length <= 0 || offset + length > text.length) break;
    const record = text.slice(space + 1, offset + length).replace(/\n$/, "");
    const equals = record.indexOf("=");
    if (equals > 0 && record.slice(0, equals) === "path") path = record.slice(equals + 1);
    offset += length;
  }
  return path;
}

interface ParsedArchive {
  readonly tree: RepositoryTree;
  readonly blobs: ReadonlyMap<string, Buffer>;
}

function parseSourceArchive(compressed: Buffer): ParsedArchive {
  let tar: Buffer;
  try {
    tar = gunzipSync(compressed, { maxOutputLength: MAX_ARCHIVE_INFLATED_BYTES });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new GitHubApiError(null, `GitHub source archive could not be decompressed safely: ${message}`);
  }

  const entries: TreeEntry[] = [];
  const blobs = new Map<string, Buffer>();
  let offset = 0;
  let archiveRoot: string | undefined;
  let nextPaxPath: string | undefined;
  let nextLongPath: string | undefined;

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = tarSize(header, 124, 12);
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > tar.length) {
      throw new GitHubApiError(null, "GitHub source archive ended inside an entry");
    }
    const typeFlag = String.fromCharCode(header[156] ?? 0);
    const body = tar.subarray(bodyStart, bodyEnd);
    const nextOffset = bodyStart + Math.ceil(size / 512) * 512;

    if (typeFlag === "x") {
      nextPaxPath = parsePaxPath(body);
      offset = nextOffset;
      continue;
    }
    if (typeFlag === "g") {
      offset = nextOffset;
      continue;
    }
    if (typeFlag === "L") {
      nextLongPath = tarString(body, 0, body.length);
      offset = nextOffset;
      continue;
    }

    const name = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 155);
    const rawPath = nextPaxPath ?? nextLongPath ?? (prefix.length > 0 ? `${prefix}/${name}` : name);
    nextPaxPath = undefined;
    nextLongPath = undefined;
    if (
      rawPath.length === 0 ||
      rawPath.length > 4_096 ||
      rawPath.includes("\\") ||
      rawPath.includes("\0") ||
      rawPath.startsWith("/")
    ) {
      throw new GitHubApiError(null, "GitHub source archive contains an unsafe path");
    }
    const parts = rawPath.replace(/\/$/, "").split("/");
    const root = parts.shift();
    if (root === undefined || root.length === 0 || root === "." || root === "..") {
      throw new GitHubApiError(null, "GitHub source archive is missing its repository root");
    }
    if (archiveRoot === undefined) archiveRoot = root;
    else if (archiveRoot !== root) {
      throw new GitHubApiError(null, "GitHub source archive contains multiple roots");
    }
    if (parts.length === 0) {
      offset = nextOffset;
      continue;
    }
    const relativePath = parts.join("/");
    const normalized = posix.normalize(relativePath);
    if (
      normalized !== relativePath ||
      normalized === "." ||
      normalized.startsWith("../") ||
      posix.isAbsolute(normalized)
    ) {
      throw new GitHubApiError(null, "GitHub source archive contains path traversal");
    }
    if (entries.length >= MAX_ARCHIVE_ENTRIES) {
      throw new GitHubApiError(null, "GitHub source archive contains too many entries");
    }

    if (typeFlag === "0" || typeFlag === "\0") {
      const bytes = Buffer.from(body);
      const blobSha = createHash("sha1")
        .update(`blob ${bytes.length}\0`)
        .update(bytes)
        .digest("hex");
      entries.push({ path: normalized, type: "blob", size: bytes.length, blobSha });
      blobs.set(normalized, bytes);
    } else if (typeFlag === "5") {
      entries.push({ path: normalized, type: "tree", size: 0, blobSha: null });
    } else if (typeFlag === "2") {
      entries.push({ path: normalized, type: "symlink", size: 0, blobSha: null });
    }
    offset = nextOffset;
  }

  if (archiveRoot === undefined || entries.length === 0) {
    throw new GitHubApiError(null, "GitHub source archive is empty");
  }
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return { tree: { entries, truncated: false }, blobs };
}

function embeddedRefInfo(html: string): { readonly branch: string; readonly commitSha: string } {
  const scripts = html.matchAll(
    /<script\b[^>]*data-target=["']react-app\.embeddedData["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const match of scripts) {
    const json = match[1];
    if (json === undefined) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      continue;
    }
    const root = parsed !== null && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
    const payload = root?.payload;
    const payloadObject =
      payload !== null && typeof payload === "object" && !Array.isArray(payload)
        ? payload as Record<string, unknown>
        : null;
    const codeViewRepoRoute = payloadObject?.codeViewRepoRoute;
    const routeObject =
      codeViewRepoRoute !== null &&
      typeof codeViewRepoRoute === "object" &&
      !Array.isArray(codeViewRepoRoute)
        ? codeViewRepoRoute as Record<string, unknown>
        : null;
    for (const refInfo of [payloadObject?.refInfo, routeObject?.refInfo]) {
      const refObject =
        refInfo !== null && typeof refInfo === "object" && !Array.isArray(refInfo)
          ? refInfo as Record<string, unknown>
          : null;
      if (
        typeof refObject?.name === "string" &&
        typeof refObject.currentOid === "string" &&
        /^[a-f0-9]{40}$/.test(refObject.currentOid)
      ) {
        return { branch: refObject.name, commitSha: refObject.currentOid };
      }
    }
  }
  throw new GitHubApiError(null, "GitHub public repository page did not expose a fixed commit");
}

export class GitHubRepositorySource implements RepositorySource {
  private readonly fetchImpl: typeof fetch;
  private readonly token: string;
  private readonly cache: GitHubResponseCache | undefined;
  private readonly archiveRepositories = new Set<string>();
  private readonly archives = new Map<string, ParsedArchive>();

  constructor(options: GitHubRepositorySourceOptions | typeof fetch = {}) {
    if (typeof options === "function") {
      this.fetchImpl = options;
      this.token = "";
      this.cache = undefined;
      return;
    }
    this.fetchImpl = options.fetch ?? defaultRepositoryFetch;
    this.token = options.token?.trim() ?? "";
    this.cache = options.cache;
    if (/[\u0000-\u001f\u007f]/.test(this.token)) {
      throw new GitHubApiError(null, "GitHub token contains invalid control characters");
    }
  }

  private async boundedResponseBytes(
    response: Response,
    limit: number,
    label: string,
  ): Promise<Buffer> {
    const declared = response.headers.get("content-length");
    if (declared !== null && /^\d+$/.test(declared) && Number(declared) > limit) {
      throw new GitHubApiError(null, `${label} exceeds the ${limit}-byte safety limit`);
    }
    if (response.body === null) return Buffer.alloc(0);
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new GitHubApiError(null, `${label} exceeds the ${limit}-byte safety limit`);
      }
      chunks.push(Buffer.from(result.value));
    }
    return Buffer.concat(chunks, total);
  }

  private async resolveFromPublicPage(
    canonical: ReturnType<typeof parseGitHubRepositoryUrl>,
  ): Promise<ResolvedRepository> {
    const owner = encodeURIComponent(canonical.owner);
    const name = encodeURIComponent(canonical.name);
    const cacheKey = `web-head:${owner}/${name}`;
    const cached = this.cache?.get(cacheKey);
    let html: string;
    if (typeof cached === "string") {
      html = cached;
    } else {
      const url = new URL(`/${owner}/${name}`, WEB_ORIGIN);
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: "GET",
          redirect: "error",
          signal: AbortSignal.timeout(20_000),
          headers: {
            Accept: "text/html",
            "User-Agent": "repo-artifact-core/0.2.0",
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new GitHubApiError(null, `GitHub public repository page request failed: ${message}`);
      }
      if (!response.ok) {
        throw new GitHubApiError(
          response.status,
          `GitHub public repository page returned ${response.status}`,
        );
      }
      html = (await this.boundedResponseBytes(response, MAX_HTML_BYTES, "GitHub page")).toString(
        "utf8",
      );
      this.cache?.set(cacheKey, html);
    }
    const head = embeddedRefInfo(html);
    const repository: ResolvedRepository = {
      url: canonical.url,
      owner: canonical.owner,
      name: canonical.name,
      defaultBranch: head.branch,
      commitSha: head.commitSha,
      resolvedAt: new Date().toISOString(),
      licenseSpdx: null,
    };
    this.archiveRepositories.add(repositoryKey(repository));
    return repository;
  }

  private async loadArchive(repository: ResolvedRepository): Promise<ParsedArchive> {
    const key = repositoryKey(repository);
    const existing = this.archives.get(key);
    if (existing !== undefined) return existing;
    const owner = encodeURIComponent(repository.owner);
    const name = encodeURIComponent(repository.name);
    const cacheKey = `archive:${owner}/${name}/${repository.commitSha}`;
    const cached = this.cache?.get(cacheKey);
    let compressed: Buffer;
    if (cached instanceof Uint8Array) {
      compressed = Buffer.from(cached);
    } else {
      const url = new URL(`/${owner}/${name}/tar.gz/${repository.commitSha}`, CODELOAD_ORIGIN);
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: "GET",
          redirect: "error",
          signal: AbortSignal.timeout(30_000),
          headers: {
            Accept: "application/x-gzip, application/octet-stream",
            "User-Agent": "repo-artifact-core/0.2.0",
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new GitHubApiError(null, `GitHub source archive request failed: ${message}`);
      }
      if (!response.ok) {
        throw new GitHubApiError(response.status, `GitHub source archive returned ${response.status}`);
      }
      compressed = await this.boundedResponseBytes(
        response,
        MAX_ARCHIVE_BYTES,
        "GitHub source archive",
      );
      this.cache?.set(cacheKey, compressed);
    }
    const archive = parseSourceArchive(compressed);
    this.archives.set(key, archive);
    return archive;
  }

  private async request(path: string): Promise<unknown> {
    const url = new URL(path, API_ORIGIN);
    if (url.origin !== API_ORIGIN) {
      throw new GitHubApiError(null, "GitHub API request escaped its allowed origin");
    }

    const cached = this.cache?.get(path);
    if (cached !== undefined) return cached;

    let response: Response;
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": "repo-artifact-core/0.2.0",
    };
    if (this.token.length > 0) headers.Authorization = `Bearer ${this.token}`;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
        headers,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new GitHubApiError(null, `GitHub API request failed: ${message}`);
    }

    if (!response.ok) {
      const remaining = response.headers.get("x-ratelimit-remaining");
      const reset = response.headers.get("x-ratelimit-reset");
      const retryAfter = response.headers.get("retry-after");
      const limit = response.headers.get("x-ratelimit-limit");
      const isRateLimited =
        response.status === 429 || (response.status === 403 && remaining === "0");
      const resetSeconds = reset !== null && /^\d+$/.test(reset) ? Number(reset) : null;
      const retryAfterSeconds =
        retryAfter !== null && /^\d+$/.test(retryAfter) ? Number(retryAfter) : null;
      const resetAt =
        resetSeconds !== null
          ? new Date(resetSeconds * 1_000).toISOString()
          : retryAfterSeconds === null
            ? null
            : new Date(Date.now() + retryAfterSeconds * 1_000).toISOString();
      const rateLimit = isRateLimited
        ? {
            limit: limit !== null && /^\d+$/.test(limit) ? Number(limit) : null,
            remaining: 0,
            resetAt,
            authenticated: this.token.length > 0,
          }
        : undefined;
      throw new GitHubApiError(
        response.status,
        `GitHub API returned ${response.status}${
          isRateLimited
            ? `; ${this.token.length > 0 ? "authenticated" : "anonymous"} rate limit exhausted${
                reset === null ? "" : ` until ${reset}`
              }`
            : ""
        }`,
        rateLimit,
      );
    }
    const value = (await response.json()) as unknown;
    this.cache?.set(path, value);
    return value;
  }

  async resolve(inputUrl: string): Promise<ResolvedRepository> {
    const canonical = parseGitHubRepositoryUrl(inputUrl);
    const owner = encodeURIComponent(canonical.owner);
    const name = encodeURIComponent(canonical.name);
    let metadata: Record<string, unknown>;
    try {
      metadata = objectValue(await this.request(`/repos/${owner}/${name}`));
    } catch (error) {
      if (error instanceof GitHubApiError && error.rateLimit !== undefined) {
        try {
          return await this.resolveFromPublicPage(canonical);
        } catch (fallbackError) {
          throw withFallbackFailure(error, "public fallback", fallbackError);
        }
      }
      throw error;
    }
    if (metadata.private !== false || typeof metadata.default_branch !== "string") {
      throw new GitHubApiError(null, "Repository is private or has no default branch");
    }
    let commit: Record<string, unknown>;
    try {
      commit = objectValue(
        await this.request(
          `/repos/${owner}/${name}/commits/${encodeURIComponent(metadata.default_branch)}`,
        ),
      );
    } catch (error) {
      if (error instanceof GitHubApiError && error.rateLimit !== undefined) {
        try {
          return await this.resolveFromPublicPage(canonical);
        } catch (fallbackError) {
          throw withFallbackFailure(error, "public fallback", fallbackError);
        }
      }
      throw error;
    }
    if (typeof commit.sha !== "string" || !/^[a-f0-9]{40}$/.test(commit.sha)) {
      throw new GitHubApiError(null, "GitHub did not return a full commit SHA");
    }

    const license =
      metadata.license !== null && typeof metadata.license === "object"
        ? (metadata.license as Record<string, unknown>).spdx_id
        : null;
    return {
      url: canonical.url,
      owner: canonical.owner,
      name: canonical.name,
      defaultBranch: metadata.default_branch,
      commitSha: commit.sha,
      resolvedAt: new Date().toISOString(),
      licenseSpdx: typeof license === "string" ? license : null,
    };
  }

  async listTree(repository: ResolvedRepository): Promise<RepositoryTree> {
    const key = repositoryKey(repository);
    if (this.archiveRepositories.has(key)) {
      return (await this.loadArchive(repository)).tree;
    }
    const owner = encodeURIComponent(repository.owner);
    const name = encodeURIComponent(repository.name);
    let body: Record<string, unknown>;
    try {
      body = objectValue(
        await this.request(
          `/repos/${owner}/${name}/git/trees/${repository.commitSha}?recursive=1`,
        ),
      );
    } catch (error) {
      if (error instanceof GitHubApiError && error.rateLimit !== undefined) {
        this.archiveRepositories.add(key);
        try {
          return (await this.loadArchive(repository)).tree;
        } catch (fallbackError) {
          this.archiveRepositories.delete(key);
          throw withFallbackFailure(error, "source archive fallback", fallbackError);
        }
      }
      throw error;
    }
    if (!Array.isArray(body.tree)) {
      throw new GitHubApiError(null, "GitHub tree response is missing entries");
    }

    const entries: TreeEntry[] = [];
    for (const raw of body.tree) {
      const entry = objectValue(raw);
      if (
        typeof entry.path !== "string" ||
        typeof entry.type !== "string" ||
        typeof entry.mode !== "string"
      ) {
        throw new GitHubApiError(null, "GitHub tree contains an invalid entry");
      }
      let type: TreeEntry["type"];
      if (entry.mode === "120000") type = "symlink";
      else if (entry.type === "blob") type = "blob";
      else if (entry.type === "tree") type = "tree";
      else if (entry.type === "commit") type = "submodule";
      else continue;
      entries.push({
        path: entry.path,
        type,
        size: typeof entry.size === "number" ? entry.size : 0,
        blobSha:
          type === "blob" || type === "symlink"
            ? typeof entry.sha === "string"
              ? entry.sha
              : null
            : null,
      });
    }
    return { entries, truncated: body.truncated === true };
  }

  async readBlob(
    repository: ResolvedRepository,
    entry: TreeEntry,
  ): Promise<RepositoryBlob> {
    if (entry.type !== "blob" || entry.blobSha === null) {
      throw new GitHubApiError(null, `Cannot read non-blob entry ${entry.path}`);
    }
    const key = repositoryKey(repository);
    if (this.archiveRepositories.has(key)) {
      const bytes = (await this.loadArchive(repository)).blobs.get(entry.path);
      if (bytes === undefined) {
        throw new GitHubApiError(null, `GitHub source archive is missing ${entry.path}`);
      }
      return { bytes: Buffer.from(bytes) };
    }
    const owner = encodeURIComponent(repository.owner);
    const name = encodeURIComponent(repository.name);
    const path = entry.path.split("/").map(encodeURIComponent).join("/");
    const cacheKey = `raw:${owner}/${name}/${repository.commitSha}/${path}`;
    const cached = this.cache?.get(cacheKey);
    if (cached instanceof Uint8Array) return { bytes: Buffer.from(cached) };

    const url = new URL(`/${owner}/${name}/${repository.commitSha}/${path}`, RAW_ORIGIN);
    if (url.origin !== RAW_ORIGIN) {
      throw new GitHubApiError(null, "GitHub raw request escaped its allowed origin");
    }
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
        headers: {
          Accept: "application/octet-stream",
          "User-Agent": "repo-artifact-core/0.2.0",
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new GitHubApiError(null, `GitHub raw content request failed: ${message}`);
    }
    if (!response.ok) {
      throw new GitHubApiError(
        response.status,
        `GitHub raw content returned ${response.status} for ${entry.path}`,
      );
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    this.cache?.set(cacheKey, bytes);
    return { bytes };
  }
}
