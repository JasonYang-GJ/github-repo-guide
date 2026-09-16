export interface ResolvedRepository {
  readonly url: string;
  readonly owner: string;
  readonly name: string;
  readonly defaultBranch: string;
  readonly commitSha: string;
  readonly resolvedAt: string;
  readonly licenseSpdx: string | null;
}

export type TreeEntryType = "blob" | "tree" | "symlink" | "submodule";

export interface TreeEntry {
  readonly path: string;
  readonly type: TreeEntryType;
  readonly size: number;
  readonly blobSha: string | null;
}

export interface RepositoryTree {
  readonly entries: readonly TreeEntry[];
  readonly truncated: boolean;
}

export interface RepositoryBlob {
  readonly bytes: Uint8Array;
}

export interface RepositorySource {
  resolve(url: string): Promise<ResolvedRepository>;
  listTree(repository: ResolvedRepository): Promise<RepositoryTree>;
  readBlob(repository: ResolvedRepository, entry: TreeEntry): Promise<RepositoryBlob>;
}

export type ReadFileKind =
  | "documentation"
  | "manifest"
  | "configuration"
  | "schema"
  | "source";
export type ReadScope = 1 | 2 | 3;

export interface ReadRepositoryFile {
  readonly path: string;
  readonly blobSha: string;
  readonly size: number;
  readonly text: string;
  readonly kind: ReadFileKind;
  readonly scope: ReadScope;
  readonly selectionReason: string;
}

export interface ManifestSignals {
  readonly format?: "npm" | "generic";
  readonly genericReason?:
    | "missing_package_manifest"
    | "ambiguous_package_manifests";
  readonly manifestPath: string;
  readonly packageRoot: string;
  readonly name: string;
  readonly description: string | null;
  readonly version: string | null;
  readonly packageType: string | null;
  readonly entryCandidates: readonly string[];
  readonly dependencies: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
  readonly scripts: Readonly<Record<string, string>>;
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface ScopeEvent {
  readonly scope: 0 | ReadScope;
  readonly reason: string;
  readonly selectedPaths: readonly string[];
}

export type SkipReason =
  | "ignored_directory"
  | "unsupported_type"
  | "binary"
  | "oversized_file"
  | "generated_file"
  | "symlink"
  | "budget_exhausted"
  | "not_selected"
  | "other";

export interface SkipSummary {
  readonly reason: SkipReason;
  readonly count: number;
}

export interface RepositoryReadDecision {
  readonly path: string;
  readonly kind: ReadFileKind;
  readonly scope: ReadScope;
  readonly selectionReason: string;
  readonly status: "read" | "excluded";
  readonly skipReason?: SkipReason;
}

export interface RepositorySnapshot {
  readonly repository: ResolvedRepository;
  readonly tree: readonly TreeEntry[];
  readonly files: readonly ReadRepositoryFile[];
  readonly manifest: ManifestSignals;
  readonly scopeEvents: readonly ScopeEvent[];
  readonly readDecisions: readonly RepositoryReadDecision[];
  readonly highestScope: 1 | 2 | 3;
  readonly filesSeen: number;
  readonly filesSkipped: number;
  readonly bytesRead: number;
  readonly skipSummary: readonly SkipSummary[];
}
