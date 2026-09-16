import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";

import {
  GitHubApiError,
  GitHubRepositorySource,
  MemoryGitHubResponseCache,
} from "../src/repo/github-source.js";

const commitSha = "0123456789abcdef0123456789abcdef01234567";

function tarGzip(entries: readonly { readonly path: string; readonly content: string }[]): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const content = Buffer.from(entry.content, "utf8");
    const header = Buffer.alloc(512);
    header.write(`repo-${commitSha}/${entry.path}`, 0, 100, "utf8");
    header.write("0000644\0", 100, 8, "ascii");
    header.write("0000000\0", 108, 8, "ascii");
    header.write("0000000\0", 116, 8, "ascii");
    header.write(`${content.length.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii");
    header.write("00000000000\0", 136, 12, "ascii");
    header.fill(0x20, 148, 156);
    header.write("0", 156, 1, "ascii");
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
    chunks.push(header, content, Buffer.alloc((512 - (content.length % 512)) % 512));
  }
  chunks.push(Buffer.alloc(1_024));
  return gzipSync(Buffer.concat(chunks));
}

test("GitHub source sends a bearer token and shares credential-free cached responses", async () => {
  const cache = new MemoryGitHubResponseCache(60_000, 20);
  const calls: { readonly url: string; readonly authorization: string | null }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({
      url,
      authorization: new Headers(init?.headers).get("authorization"),
    });
    if (url.endsWith("/repos/owner/repo")) {
      return new Response(
        JSON.stringify({
          private: false,
          default_branch: "main",
          license: { spdx_id: "MIT" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ sha: commitSha }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const first = new GitHubRepositorySource({
    fetch: fetchImpl,
    token: "github_pat_first_secret",
    cache,
  });
  const second = new GitHubRepositorySource({
    fetch: fetchImpl,
    token: "github_pat_second_secret",
    cache,
  });

  assert.equal((await first.resolve("https://github.com/owner/repo")).commitSha, commitSha);
  assert.equal((await second.resolve("https://github.com/owner/repo")).commitSha, commitSha);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.authorization === "Bearer github_pat_first_secret"));
  assert.ok(calls.every((call) => !call.url.includes("github_pat")));
});

test("GitHub source keeps anonymous requests unauthenticated and exposes bounded rate metadata", async () => {
  const fetchImpl: typeof fetch = async (_input, init) => {
    assert.equal(new Headers(init?.headers).has("authorization"), false);
    return new Response("rate limited", {
      status: 403,
      headers: {
        "x-ratelimit-limit": "60",
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "1800000000",
      },
    });
  };
  const source = new GitHubRepositorySource({ fetch: fetchImpl });

  await assert.rejects(
    () => source.resolve("https://github.com/owner/repo"),
    (error: unknown) => {
      assert.ok(error instanceof GitHubApiError);
      assert.equal(error.status, 403);
      assert.match(
        error.message,
        /public fallback failed: GitHub public repository page returned 403/,
      );
      assert.deepEqual(error.rateLimit, {
        limit: 60,
        remaining: 0,
        resetAt: "2027-01-15T08:00:00.000Z",
        authenticated: false,
      });
      return true;
    },
  );
});

test("GitHub source reads fixed-commit public blobs without spending REST API quota or forwarding tokens", async () => {
  const cache = new MemoryGitHubResponseCache(60_000, 20);
  const calls: { readonly url: string; readonly authorization: string | null }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization"),
    });
    return new Response("export const value = 1;", { status: 200 });
  };
  const source = new GitHubRepositorySource({
    fetch: fetchImpl,
    token: "github_pat_must_not_reach_raw_host",
    cache,
  });
  const repository = {
    url: "https://github.com/owner/repo",
    owner: "owner",
    name: "repo",
    defaultBranch: "main",
    commitSha,
    resolvedAt: "2026-09-15T00:00:00.000Z",
    licenseSpdx: "MIT",
  } as const;
  const entry = {
    path: "src/a file.ts",
    type: "blob",
    size: 23,
    blobSha: "a".repeat(40),
  } as const;

  const first = await source.readBlob(repository, entry);
  const second = await source.readBlob(repository, entry);

  assert.equal(Buffer.from(first.bytes).toString("utf8"), "export const value = 1;");
  assert.equal(Buffer.from(second.bytes).toString("utf8"), "export const value = 1;");
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0]?.url,
    `https://raw.githubusercontent.com/owner/repo/${commitSha}/src/a%20file.ts`,
  );
  assert.equal(calls[0]?.authorization, null);
});

test("GitHub source falls back to a fixed public archive when anonymous REST quota is exhausted", async () => {
  const archive = tarGzip([
    {
      path: "package.json",
      content: JSON.stringify({ name: "archive-fixture", version: "1.0.0" }),
    },
    { path: "src/index.ts", content: "export const answer = 42;\n" },
  ]);
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith("https://api.github.com/")) {
      return new Response("rate limited", {
        status: 403,
        headers: {
          "x-ratelimit-limit": "60",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "1800000000",
        },
      });
    }
    assert.equal(new Headers(init?.headers).has("authorization"), false);
    if (url === "https://github.com/owner/repo") {
      const embedded = JSON.stringify({
        payload: { refInfo: { name: "main", currentOid: commitSha } },
      });
      return new Response(
        `<script type="application/json" data-target="react-app.embeddedData">${embedded}</script>`,
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    }
    if (url === `https://codeload.github.com/owner/repo/tar.gz/${commitSha}`) {
      const body = archive.buffer.slice(
        archive.byteOffset,
        archive.byteOffset + archive.byteLength,
      ) as ArrayBuffer;
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "application/x-gzip" },
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const source = new GitHubRepositorySource({ fetch: fetchImpl });

  const repository = await source.resolve("https://github.com/owner/repo");
  const tree = await source.listTree(repository);
  const sourceEntry = tree.entries.find((entry) => entry.path === "src/index.ts");

  assert.equal(repository.commitSha, commitSha);
  assert.equal(repository.defaultBranch, "main");
  assert.ok(sourceEntry !== undefined);
  assert.equal(
    Buffer.from(await source.readBlob(repository, sourceEntry).then((blob) => blob.bytes)).toString(
      "utf8",
    ),
    "export const answer = 42;\n",
  );
  assert.deepEqual(calls, [
    "https://api.github.com/repos/owner/repo",
    "https://github.com/owner/repo",
    `https://codeload.github.com/owner/repo/tar.gz/${commitSha}`,
  ]);
});

test("GitHub source accepts the current nested refInfo shape during anonymous quota fallback", async () => {
  const archive = tarGzip([
    { path: "README.md", content: "# Current GitHub page shape\n" },
  ]);
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith("https://api.github.com/")) {
      return new Response("rate limited", {
        status: 403,
        headers: {
          "x-ratelimit-limit": "60",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "1800000000",
        },
      });
    }
    if (url === "https://github.com/owner/repo") {
      const embedded = JSON.stringify({
        payload: {
          codeViewRepoRoute: {
            path: "/",
            refInfo: { name: "main", currentOid: commitSha },
          },
        },
      });
      return new Response(
        `<script type="application/json" data-target="react-app.embeddedData">${embedded}</script>`,
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    }
    if (url === `https://codeload.github.com/owner/repo/tar.gz/${commitSha}`) {
      const body = archive.buffer.slice(
        archive.byteOffset,
        archive.byteOffset + archive.byteLength,
      ) as ArrayBuffer;
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "application/x-gzip" },
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const source = new GitHubRepositorySource({ fetch: fetchImpl });

  const repository = await source.resolve("https://github.com/owner/repo");
  const tree = await source.listTree(repository);

  assert.equal(repository.commitSha, commitSha);
  assert.equal(repository.defaultBranch, "main");
  assert.ok(tree.entries.some((entry) => entry.path === "README.md"));
  assert.deepEqual(calls, [
    "https://api.github.com/repos/owner/repo",
    "https://github.com/owner/repo",
    `https://codeload.github.com/owner/repo/tar.gz/${commitSha}`,
  ]);
});

test("archive fallback accepts more than 20000 metadata entries without raising its byte limit", async () => {
  const archive = tarGzip(Array.from({ length: 20_001 }, (_, i) => ({
    path: `vendor/item-${i}.txt`, content: "",
  })));
  const source = new GitHubRepositorySource({ fetch: async (input) => {
    const url = String(input);
    if (url.endsWith("/repos/owner/repo")) {
      return Response.json({ private: false, default_branch: "main" });
    }
    if (url.includes("/commits/")) return Response.json({ sha: commitSha });
    if (url.includes("/git/trees/")) {
      return new Response("limited", { status: 403, headers: { "x-ratelimit-remaining": "0" } });
    }
    assert.equal(url, `https://codeload.github.com/owner/repo/tar.gz/${commitSha}`);
    return new Response(new Uint8Array(archive));
  }});
  const repo = await source.resolve("https://github.com/owner/repo");
  assert.equal((await source.listTree(repo)).entries.length, 20_001);

  const oversized = new GitHubRepositorySource({ fetch: async (input) => {
    const url = String(input);
    if (url.startsWith("https://api.github.com/")) {
      return new Response("limited", { status: 403, headers: { "x-ratelimit-remaining": "0" } });
    }
    if (url.startsWith("https://github.com/")) {
      return new Response(`<script data-target="react-app.embeddedData">${JSON.stringify({ payload: { refInfo: { name: "main", currentOid: commitSha } } })}</script>`);
    }
    return new Response("", { headers: { "content-length": String(32 * 1024 * 1024 + 1) } });
  }});
  const oversizedRepo = await oversized.resolve("https://github.com/owner/repo");
  await assert.rejects(oversized.listTree(oversizedRepo), /safety limit/);
});

test("GitHub response cache expires entries and enforces its entry bound", () => {
  let now = 1_000;
  const cache = new MemoryGitHubResponseCache(100, 2, () => now);
  cache.set("/a", { value: "a" });
  cache.set("/b", { value: "b" });
  assert.deepEqual(cache.get("/a"), { value: "a" });
  cache.set("/c", { value: "c" });
  assert.equal(cache.get("/b"), undefined);
  assert.deepEqual(cache.get("/a"), { value: "a" });
  now = 1_101;
  assert.equal(cache.get("/a"), undefined);
  assert.equal(cache.get("/c"), undefined);
});
