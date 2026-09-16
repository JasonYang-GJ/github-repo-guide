import { TextDecoder } from "node:util";
import { posix } from "node:path";

import type {
  ManifestSignals,
  ReadFileKind,
  ReadRepositoryFile,
  RepositoryReadDecision,
  ReadScope,
  RepositorySnapshot,
  RepositorySource,
  ResolvedRepository,
  ScopeEvent,
  SkipReason,
  SkipSummary,
  TreeEntry,
} from "./contracts.js";
import { parseGitHubRepositoryUrl } from "./url-guard.js";
import { MAX_REPOSITORY_TREE_ENTRIES } from "./read-limits.js";

export type RepositoryReadErrorCode =
  | "INVALID_REPOSITORY_URL"
  | "REPOSITORY_IDENTITY_MISMATCH"
  | "INVALID_COMMIT"
  | "TREE_TRUNCATED"
  | "TOO_MANY_TREE_ENTRIES"
  | "INVALID_TREE_ENTRY"
  | "MISSING_MANIFEST"
  | "AMBIGUOUS_MANIFEST"
  | "INVALID_MANIFEST"
  | "MANIFEST_UNREADABLE"
  | "READ_BUDGET_EXHAUSTED";

export class RepositoryReadError extends Error {
  constructor(
    readonly code: RepositoryReadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RepositoryReadError";
  }
}

export interface RepositoryReadLimits {
  readonly maxTreeEntries: number;
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
  readonly maxSourceFiles: number;
  readonly maxSchemaFiles: number;
}

const DEFAULT_LIMITS: RepositoryReadLimits = {
  maxTreeEntries: MAX_REPOSITORY_TREE_ENTRIES,
  maxFileBytes: 100 * 1024,
  maxTotalBytes: 1024 * 1024,
  maxSourceFiles: 40,
  maxSchemaFiles: 20,
};

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  "build",
  "coverage",
  "dist",
  "generated",
  "node_modules",
  "test",
  "tests",
  "__tests__",
  "fixtures",
  "vendor",
]);

const COMMON_SOURCE_DIRECTORIES = new Set([
  "api",
  "app",
  "apps",
  "bin",
  "client",
  "cmd",
  "components",
  "core",
  "internal",
  "lib",
  "packages",
  "pkg",
  "renderer",
  "renderers",
  "server",
  "shared",
  "src",
  "scripts",
  "validator",
  "validators",
  "web",
]);

const SOURCE_EXTENSION =
  /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx|cs|css|dart|ex|exs|fs|fsx|go|html?|java|kt|kts|lua|m|mm|php|pl|pm|py|r|rb|rs|scala|scss|sh|sol|sql|swift|svelte|vue|zig|(?:c|m)?(?:j|t)sx?)$/i;
const JSON_SCHEMA = /\.schema\.json$/i;
const GENERATED_SOURCE = /(?:\.min\.(?:js|mjs)|\.generated\.(?:js|ts)|\.d\.ts)$/i;
const TEST_SOURCE = /\.(?:test|spec)\.(?:c|m)?(?:j|t)sx?$/i;
const SECRET_FILE = /^(?:\.env(?:\..+)?|credentials(?:\.json)?|id_rsa|id_ed25519|.*\.(?:key|pem|p12|pfx))$/i;
const COMMIT_SHA = /^[a-f0-9]{40}$/;
const BLOB_SHA = /^[a-f0-9]{40}$/;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

interface MutableReadState {
  readonly files: ReadRepositoryFile[];
  readonly skips: Map<SkipReason, number>;
  readonly decisions: Map<string, RepositoryReadDecision>;
  bytesRead: number;
}

function incrementSkip(state: MutableReadState, reason: SkipReason, count = 1): void {
  state.skips.set(reason, (state.skips.get(reason) ?? 0) + count);
}

function recordDecision(
  state: MutableReadState,
  decision: RepositoryReadDecision,
): void {
  const existing = state.decisions.get(decision.path);
  if (existing === undefined || decision.status === "read") {
    state.decisions.set(decision.path, decision);
  }
}

function excludeDecision(
  state: MutableReadState,
  entry: TreeEntry,
  kind: ReadFileKind,
  scope: ReadScope,
  selectionReason: string,
  skipReason: SkipReason,
): void {
  incrementSkip(state, skipReason);
  recordDecision(state, {
    path: entry.path,
    kind,
    scope,
    selectionReason,
    status: "excluded",
    skipReason,
  });
}

function isSafePath(path: string): boolean {
  if (path.length === 0 || path.startsWith("/") || path.includes("\\")) {
    return false;
  }
  const parts = path.split("/");
  return parts.every((part) => part.length > 0 && part !== "." && part !== "..");
}

function hasIgnoredDirectory(path: string): boolean {
  const parts = path.toLowerCase().split("/");
  return parts.slice(0, -1).some((part) => IGNORED_DIRECTORIES.has(part));
}

function isSecretPath(path: string): boolean {
  const name = path.split("/").at(-1) ?? path;
  return SECRET_FILE.test(name);
}

function packageRoot(manifestPath: string): string {
  const directory = posix.dirname(manifestPath);
  return directory === "." ? "" : directory;
}

function isAtRoot(path: string, root: string): boolean {
  return root.length === 0 ? !path.includes("/") : posix.dirname(path) === root;
}

function classifyScopeOne(path: string, manifestPath: string | null): ReadFileKind | null {
  const lower = path.toLowerCase();
  const name = lower.split("/").at(-1) ?? lower;
  const root = manifestPath === null ? "" : packageRoot(manifestPath);
  const repositoryRootFile = !path.includes("/");
  const packageRootFile = isAtRoot(path, root);
  if (manifestPath !== null && path === manifestPath) {
    return "manifest";
  }
  if (
    (repositoryRootFile || packageRootFile) &&
    (name === "tsconfig.json" || /^tsconfig\..+\.json$/.test(name))
  ) {
    return "configuration";
  }
  if (
    (repositoryRootFile || packageRootFile) &&
    (/^readme(?:[_\.-][a-z0-9_-]+)?\.md$/.test(name) ||
      name === "license" ||
      name.startsWith("license.") ||
      (packageRootFile && name === "skill.md"))
  ) {
    return "documentation";
  }
  if (
    manifestPath === null &&
    repositoryRootFile &&
    /^(?:pyproject\.toml|cargo\.toml|go\.mod|composer\.json|gemfile|requirements(?:\.[a-z0-9_-]+)?\.txt|pom\.xml|build\.gradle(?:\.kts)?|makefile|cmakelists\.txt)$/i.test(name)
  ) {
    return "configuration";
  }
  return null;
}

interface ManifestSelection {
  readonly entry: TreeEntry | null;
  readonly genericReason:
    | "missing_package_manifest"
    | "ambiguous_package_manifests"
    | null;
}

function selectManifestEntry(entries: readonly TreeEntry[]): ManifestSelection {
  const candidates = entries
    .filter(
      (entry) =>
        entry.type === "blob" &&
        entry.path.toLowerCase().endsWith("package.json") &&
        (entry.path.toLowerCase() === "package.json" ||
          entry.path.toLowerCase().endsWith("/package.json")) &&
        !hasIgnoredDirectory(entry.path) &&
        !isSecretPath(entry.path),
    )
    .sort((left, right) => {
      const depth = left.path.split("/").length - right.path.split("/").length;
      return depth === 0 ? left.path.localeCompare(right.path) : depth;
    });
  const root = candidates.find((entry) => entry.path.toLowerCase() === "package.json");
  if (root !== undefined) return { entry: root, genericReason: null };
  const first = candidates[0];
  if (first === undefined) {
    return { entry: null, genericReason: "missing_package_manifest" };
  }
  const shallowDepth = first.path.split("/").length;
  const equallyShallow = candidates.filter(
    (entry) => entry.path.split("/").length === shallowDepth,
  );
  if (equallyShallow.length > 1) {
    return { entry: null, genericReason: "ambiguous_package_manifests" };
  }
  return { entry: first, genericReason: null };
}

function normalizeManifestPath(value: string): string | null {
  const normalized = value.replace(/^\.\//, "").replace(/\\/g, "/");
  return isSafePath(normalized) ? normalized : null;
}

function collectStringLeaves(value: unknown, output: string[]): void {
  if (typeof value === "string") {
    const normalized = normalizeManifestPath(value);
    if (normalized !== null) {
      output.push(normalized);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringLeaves(item, output);
    }
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) {
      collectStringLeaves(item, output);
    }
  }
}

function stringRecord(value: unknown): Readonly<Record<string, string>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function parseManifest(text: string, manifestPath: string): ManifestSignals {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RepositoryReadError("INVALID_MANIFEST", `package.json is invalid JSON: ${message}`);
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new RepositoryReadError("INVALID_MANIFEST", "package.json must contain a JSON object");
  }

  const manifest = raw as Record<string, unknown>;
  if (typeof manifest.name !== "string" || manifest.name.length === 0) {
    throw new RepositoryReadError("INVALID_MANIFEST", "package.json must declare a package name");
  }

  const entryCandidates: string[] = [];
  for (const field of ["main", "module", "types", "typings", "bin", "exports"] as const) {
    collectStringLeaves(manifest[field], entryCandidates);
  }

  return {
    format: "npm",
    manifestPath,
    packageRoot: packageRoot(manifestPath),
    name: manifest.name,
    description: typeof manifest.description === "string" ? manifest.description : null,
    version: typeof manifest.version === "string" ? manifest.version : null,
    packageType: typeof manifest.type === "string" ? manifest.type : null,
    entryCandidates: [...new Set(entryCandidates)].sort(),
    dependencies: stringRecord(manifest.dependencies),
    devDependencies: stringRecord(manifest.devDependencies),
    scripts: stringRecord(manifest.scripts),
    raw: manifest,
  };
}

function validateResolvedRepository(
  repository: ResolvedRepository,
  expected: ReturnType<typeof parseGitHubRepositoryUrl>,
): void {
  if (
    repository.url !== expected.url ||
    repository.owner !== expected.owner ||
    repository.name !== expected.name
  ) {
    throw new RepositoryReadError(
      "REPOSITORY_IDENTITY_MISMATCH",
      "Repository source returned a different repository identity",
    );
  }
  if (!COMMIT_SHA.test(repository.commitSha)) {
    throw new RepositoryReadError("INVALID_COMMIT", "Repository source did not resolve a full SHA");
  }
}

function validateTree(entries: readonly TreeEntry[], limits: RepositoryReadLimits): void {
  if (entries.length > limits.maxTreeEntries) {
    throw new RepositoryReadError(
      "TOO_MANY_TREE_ENTRIES",
      `Repository tree has ${entries.length} entries; limit is ${limits.maxTreeEntries}`,
    );
  }
  for (const entry of entries) {
    if (
      !isSafePath(entry.path) ||
      entry.size < 0 ||
      (entry.type === "blob" &&
        (entry.blobSha === null || !BLOB_SHA.test(entry.blobSha)))
    ) {
      throw new RepositoryReadError("INVALID_TREE_ENTRY", `Unsafe tree entry: ${entry.path}`);
    }
  }
}

async function readSelectedFile(
  source: RepositorySource,
  repository: ResolvedRepository,
  entry: TreeEntry,
  kind: ReadFileKind,
  scope: ReadScope,
  selectionReason: string,
  limits: RepositoryReadLimits,
  state: MutableReadState,
  critical: boolean,
): Promise<ReadRepositoryFile | null> {
  if (entry.type === "symlink") {
    excludeDecision(state, entry, kind, scope, selectionReason, "symlink");
    return null;
  }
  if (entry.type !== "blob" || entry.blobSha === null) {
    excludeDecision(state, entry, kind, scope, selectionReason, "unsupported_type");
    return null;
  }
  if (entry.size > limits.maxFileBytes) {
    excludeDecision(state, entry, kind, scope, selectionReason, "oversized_file");
    if (critical) {
      throw new RepositoryReadError("MANIFEST_UNREADABLE", "package.json exceeds the file limit");
    }
    return null;
  }
  if (state.bytesRead + entry.size > limits.maxTotalBytes) {
    excludeDecision(state, entry, kind, scope, selectionReason, "budget_exhausted");
    if (critical) {
      throw new RepositoryReadError("READ_BUDGET_EXHAUSTED", "No budget remains for package.json");
    }
    return null;
  }

  const { bytes } = await source.readBlob(repository, entry);
  if (
    bytes.byteLength > limits.maxFileBytes ||
    state.bytesRead + bytes.byteLength > limits.maxTotalBytes
  ) {
    excludeDecision(state, entry, kind, scope, selectionReason, "budget_exhausted");
    if (critical) {
      throw new RepositoryReadError("MANIFEST_UNREADABLE", "package.json exceeded its declared size");
    }
    return null;
  }
  if (bytes.includes(0)) {
    excludeDecision(state, entry, kind, scope, selectionReason, "binary");
    if (critical) {
      throw new RepositoryReadError("MANIFEST_UNREADABLE", "package.json is binary");
    }
    return null;
  }

  let text: string;
  try {
    text = utf8Decoder.decode(bytes);
  } catch {
    excludeDecision(state, entry, kind, scope, selectionReason, "binary");
    if (critical) {
      throw new RepositoryReadError("MANIFEST_UNREADABLE", "package.json is not valid UTF-8");
    }
    return null;
  }

  const file: ReadRepositoryFile = {
    path: entry.path,
    blobSha: entry.blobSha,
    size: bytes.byteLength,
    text,
    kind,
    scope,
    selectionReason,
  };
  state.files.push(file);
  state.bytesRead += bytes.byteLength;
  recordDecision(state, {
    path: entry.path,
    kind,
    scope,
    selectionReason,
    status: "read",
  });
  return file;
}

function sourcePriority(
  path: string,
  relativePath: string,
  manifestEntries: ReadonlySet<string>,
): number {
  const lower = relativePath.toLowerCase();
  if (manifestEntries.has(path)) {
    return 0;
  }
  // Maintenance scripts inside a workspace package are still tooling. Without
  // this check apps/*/scripts can fill the source budget before packages/*/src.
  if (lower.split("/").slice(0, -1).includes("scripts")) {
    return 600 + relativePath.split("/").length;
  }
  if (/^(?:src\/)?(?:index|main|app)\.[a-z0-9+_-]+$/.test(lower)) return 1;
  const firstDirectory = lower.split("/")[0] ?? "";
  const directoryPriority: Readonly<Record<string, number>> = {
    bin: 2,
    src: 3,
    lib: 3,
    app: 3,
    apps: 3,
    packages: 3,
    core: 3,
    server: 3,
    client: 3,
    api: 3,
    internal: 3,
    pkg: 3,
    cmd: 3,
    renderer: 4,
    renderers: 4,
    validator: 4,
    validators: 4,
    shared: 5,
    scripts: 6,
  };
  return (directoryPriority[firstDirectory] ?? 10) * 100 + relativePath.split("/").length;
}

function sourceCandidates(
  entries: readonly TreeEntry[],
  manifest: ManifestSignals,
  state: MutableReadState,
): TreeEntry[] {
  const manifestEntries = new Set(
    manifest.entryCandidates.map((path) =>
      manifest.packageRoot.length === 0 ? path : posix.join(manifest.packageRoot, path),
    ),
  );
  const candidates: TreeEntry[] = [];

  for (const entry of entries) {
    if (entry.type !== "blob") {
      continue;
    }
    if (!SOURCE_EXTENSION.test(entry.path)) {
      continue;
    }
    if (hasIgnoredDirectory(entry.path)) {
      excludeDecision(
        state,
        entry,
        "source",
        2,
        "Source path excluded by the bounded directory policy",
        "ignored_directory",
      );
      continue;
    }
    if (isSecretPath(entry.path)) {
      excludeDecision(
        state,
        entry,
        "source",
        2,
        "Secret-like source path excluded before content access",
        "other",
      );
      continue;
    }
    if (GENERATED_SOURCE.test(entry.path)) {
      excludeDecision(
        state,
        entry,
        "source",
        2,
        "Generated source excluded by the bounded source policy",
        "generated_file",
      );
      continue;
    }
    if (TEST_SOURCE.test(entry.path)) {
      excludeDecision(
        state,
        entry,
        "source",
        2,
        "Test source excluded so production modules retain the bounded analysis budget",
        "not_selected",
      );
      continue;
    }

    const withinPackage =
      manifest.packageRoot.length === 0 || entry.path.startsWith(`${manifest.packageRoot}/`);
    if (!withinPackage) continue;
    const relativePath =
      manifest.packageRoot.length === 0
        ? entry.path
        : entry.path.slice(manifest.packageRoot.length + 1);
    const firstDirectory = relativePath.toLowerCase().split("/")[0];
    const isRootSource = !relativePath.includes("/");
    if (
      manifest.format === "generic" ||
      manifest.packageRoot.length > 0 ||
      (firstDirectory !== undefined && COMMON_SOURCE_DIRECTORIES.has(firstDirectory)) ||
      isRootSource ||
      manifestEntries.has(entry.path)
    ) {
      candidates.push(entry);
    }
  }

  return candidates.sort((left, right) => {
    const leftRelative =
      manifest.packageRoot.length === 0
        ? left.path
        : left.path.slice(manifest.packageRoot.length + 1);
    const rightRelative =
      manifest.packageRoot.length === 0
        ? right.path
        : right.path.slice(manifest.packageRoot.length + 1);
    const priority =
      sourcePriority(left.path, leftRelative, manifestEntries) -
      sourcePriority(right.path, rightRelative, manifestEntries);
    return priority === 0 ? left.path.localeCompare(right.path) : priority;
  });
}

function schemaCandidates(
  entries: readonly TreeEntry[],
  manifest: ManifestSignals,
): TreeEntry[] {
  const prefix = manifest.packageRoot.length === 0 ? "" : `${manifest.packageRoot}/`;
  return entries
    .filter(
      (entry) =>
        entry.type === "blob" &&
        entry.path.startsWith(prefix) &&
        JSON_SCHEMA.test(entry.path) &&
        !hasIgnoredDirectory(entry.path) &&
        !isSecretPath(entry.path),
    )
    .sort((left, right) => left.path.localeCompare(right.path));
}

function toSkipSummary(skips: ReadonlyMap<SkipReason, number>): SkipSummary[] {
  return [...skips.entries()]
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reason, count]) => ({ reason, count }));
}

export async function readRepository(
  source: RepositorySource,
  inputUrl: string,
  overrides: Partial<RepositoryReadLimits> = {},
): Promise<RepositorySnapshot> {
  let expected: ReturnType<typeof parseGitHubRepositoryUrl>;
  try {
    expected = parseGitHubRepositoryUrl(inputUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RepositoryReadError("INVALID_REPOSITORY_URL", message);
  }

  const limits = { ...DEFAULT_LIMITS, ...overrides };
  const repository = await source.resolve(expected.url);
  validateResolvedRepository(repository, expected);

  const repositoryTree = await source.listTree(repository);
  if (repositoryTree.truncated) {
    throw new RepositoryReadError("TREE_TRUNCATED", "Repository tree response was truncated");
  }
  validateTree(repositoryTree.entries, limits);

  const entries = [...repositoryTree.entries].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  const state: MutableReadState = {
    files: [],
    skips: new Map(),
    decisions: new Map(),
    bytesRead: 0,
  };
  const scopeEvents: ScopeEvent[] = [
    { scope: 0, reason: "Resolved repository identity to an immutable commit SHA", selectedPaths: [] },
  ];

  const manifestSelection = selectManifestEntry(entries);
  const packageEntry = manifestSelection.entry;
  const scopeOneEntries = entries
    .map((entry) => ({
      entry,
      kind: classifyScopeOne(entry.path, packageEntry?.path ?? null),
    }))
    .filter(
      (candidate): candidate is { entry: TreeEntry; kind: ReadFileKind } =>
        candidate.kind !== null &&
        !hasIgnoredDirectory(candidate.entry.path) &&
        !isSecretPath(candidate.entry.path),
    )
    .sort((left, right) => {
      const priority: Record<ReadFileKind, number> = {
        manifest: 0,
        documentation: 1,
        configuration: 2,
        schema: 3,
        source: 4,
      };
      return priority[left.kind] - priority[right.kind] || left.entry.path.localeCompare(right.entry.path);
    });

  if (packageEntry === null && scopeOneEntries.length === 0) {
    const probeState: MutableReadState = {
      files: [],
      skips: new Map(),
      decisions: new Map(),
      bytesRead: 0,
    };
    const sourceOrientation = sourceCandidates(
      entries,
      {
        format: "generic",
        genericReason: manifestSelection.genericReason ?? "missing_package_manifest",
        manifestPath: "",
        packageRoot: "",
        name: repository.name,
        description: null,
        version: null,
        packageType: null,
        entryCandidates: [],
        dependencies: {},
        devDependencies: {},
        scripts: {},
        raw: { name: repository.name },
      },
      probeState,
    )[0];
    if (sourceOrientation !== undefined) {
      scopeOneEntries.push({ entry: sourceOrientation, kind: "source" });
    }
  }

  const scopeOnePaths: string[] = [];
  let manifest: ManifestSignals | null = null;
  for (const { entry, kind } of scopeOneEntries) {
    const file = await readSelectedFile(
      source,
      repository,
      entry,
      kind,
      1,
      kind === "manifest" ? "selected primary npm manifest" : "repository orientation",
      limits,
      state,
      kind === "manifest",
    );
    if (file !== null) {
      scopeOnePaths.push(file.path);
      if (packageEntry !== null && file.path === packageEntry.path) {
        manifest = parseManifest(file.text, packageEntry.path);
      }
    }
  }
  if (manifest === null) {
    if (packageEntry !== null) {
      throw new RepositoryReadError(
        "MANIFEST_UNREADABLE",
        `${packageEntry.path} could not be read`,
      );
    }
    const orientationFile = state.files[0];
    if (orientationFile === undefined) {
      throw new RepositoryReadError(
        "MISSING_MANIFEST",
        "Repository has no supported package manifest or readable orientation file",
      );
    }
    manifest = {
      format: "generic",
      genericReason: manifestSelection.genericReason ?? "missing_package_manifest",
      manifestPath: orientationFile.path,
      packageRoot: "",
      name: repository.name,
      description: null,
      version: null,
      packageType: null,
      entryCandidates: [],
      dependencies: {},
      devDependencies: {},
      scripts: {},
      raw: { name: repository.name },
    };
  }
  scopeEvents.push({
    scope: 1,
    reason: "Read manifest, documentation, configuration, and tree orientation files",
    selectedPaths: scopeOnePaths,
  });

  const scopeTwoPaths: string[] = [];
  const schemas = schemaCandidates(entries, manifest);
  const selectedSchemas = schemas.slice(0, limits.maxSchemaFiles);
  if (schemas.length > selectedSchemas.length) {
    incrementSkip(state, "not_selected", schemas.length - selectedSchemas.length);
    for (const entry of schemas.slice(limits.maxSchemaFiles)) {
      recordDecision(state, {
        path: entry.path,
        kind: "schema",
        scope: 2,
        selectionReason: "JSON Schema exceeded the bounded schema-file cap",
        status: "excluded",
        skipReason: "not_selected",
      });
    }
  }
  for (const entry of selectedSchemas) {
    const file = await readSelectedFile(
      source,
      repository,
      entry,
      "schema",
      2,
      "JSON Schema under the selected package root",
      limits,
      state,
      false,
    );
    if (file !== null) scopeTwoPaths.push(file.path);
  }

  const candidates = sourceCandidates(entries, manifest, state).filter(
    (entry) => !state.files.some((file) => file.path === entry.path),
  );
  let attemptedSources = 0;
  let readSources = 0;
  const manifestEntries = new Set(
    manifest.entryCandidates.map((path) =>
      manifest.packageRoot.length === 0 ? path : posix.join(manifest.packageRoot, path),
    ),
  );
  for (const entry of candidates) {
    if (readSources >= limits.maxSourceFiles) break;
    attemptedSources += 1;
    const file = await readSelectedFile(
      source,
      repository,
      entry,
      "source",
      2,
      manifestEntries.has(entry.path)
        ? "Source entry declared by the selected npm manifest"
        : manifest.format === "generic"
          ? "High-signal text source selected for generic repository analysis"
          : "High-signal source file under the selected package root",
      limits,
      state,
      false,
    );
    if (file !== null) {
      scopeTwoPaths.push(file.path);
      readSources += 1;
    }
  }
  if (candidates.length > attemptedSources) {
    incrementSkip(state, "not_selected", candidates.length - attemptedSources);
    for (const entry of candidates.slice(attemptedSources)) {
      recordDecision(state, {
        path: entry.path,
        kind: "source",
        scope: 2,
        selectionReason: "Source file ranked below the bounded source-file cap",
        status: "excluded",
        skipReason: "not_selected",
      });
    }
  }
  if (scopeTwoPaths.length > 0) {
    scopeEvents.push({
      scope: 2,
      reason: "Read bounded entry points and high-signal source files",
      selectedPaths: scopeTwoPaths,
    });
  }

  const readPaths = new Set(state.files.map((file) => file.path));
  const filesSkipped = entries.filter(
    (entry) => entry.type === "blob" && !readPaths.has(entry.path),
  ).length;

  return {
    repository,
    tree: entries,
    files: state.files,
    manifest,
    scopeEvents,
    readDecisions: [...state.decisions.values()].sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
    highestScope: scopeTwoPaths.length > 0 ? 2 : 1,
    filesSeen: entries.length,
    filesSkipped,
    bytesRead: state.bytesRead,
    skipSummary: toSkipSummary(state.skips),
  };
}
