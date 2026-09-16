import { createHash } from "node:crypto";

import type { EvidenceRecord } from "../analysis/domain.js";
import type {
  StaticBranchBehavior,
  StaticDirectCall,
  StaticRelationship,
  StaticSymbol,
} from "../analysis/static-facts.js";
import type {
  ReadRepositoryFile,
  RepositorySnapshot,
  TreeEntry,
} from "../repo/contracts.js";

export interface EvidenceBuildContext {
  readonly repositoryUrl: string;
  readonly commitSha: string;
  readonly checkedAt: string;
}

function hashExcerpt(excerpt: string): string {
  return createHash("sha256").update(excerpt, "utf8").digest("hex");
}

function verifiedBase(
  id: string,
  claimId: string,
  claim: string,
  context: EvidenceBuildContext,
): Pick<
  EvidenceRecord,
  | "evidence_record_version"
  | "id"
  | "claim_id"
  | "claim"
  | "repository"
  | "supports_evidence_ids"
  | "confidence"
  | "verification_status"
  | "notes"
  | "limitations"
> {
  return {
    evidence_record_version: 1,
    id,
    claim_id: claimId,
    claim,
    repository: { url: context.repositoryUrl, commit_sha: context.commitSha },
    supports_evidence_ids: [],
    confidence: 1,
    verification_status: "verified",
    notes: "",
    limitations: [],
  };
}

export function treeEvidence(
  id: string,
  claimId: string,
  claim: string,
  entry: TreeEntry,
  context: EvidenceBuildContext,
): EvidenceRecord {
  if (entry.blobSha === null) {
    throw new Error(`Cannot create blob evidence for ${entry.path}`);
  }
  return {
    ...verifiedBase(id, claimId, claim, context),
    evidence_type: "tree_entry",
    source_kind: "repository_tree",
    locator: { source_path: entry.path, blob_sha: entry.blobSha },
    verification: {
      method: "tree_lookup",
      checked_at: context.checkedAt,
      commit_resolved: true,
      path_exists: true,
      symbol_exists: null,
      line_range_valid: null,
      excerpt_matches: null,
    },
  };
}

export function manifestEvidence(
  id: string,
  claimId: string,
  claim: string,
  manifestFile: ReadRepositoryFile,
  fieldPointer: string,
  fieldValue: unknown,
  context: EvidenceBuildContext,
): EvidenceRecord {
  const excerpt = JSON.stringify(fieldValue);
  return {
    ...verifiedBase(id, claimId, claim, context),
    evidence_type: "manifest_field",
    source_kind: "manifest",
    locator: {
      source_path: manifestFile.path,
      blob_sha: manifestFile.blobSha,
      field_pointer: fieldPointer,
      excerpt,
      excerpt_sha256: hashExcerpt(excerpt),
    },
    verification: {
      method: "manifest_parse",
      checked_at: context.checkedAt,
      commit_resolved: true,
      path_exists: true,
      symbol_exists: null,
      line_range_valid: null,
      excerpt_matches: true,
    },
  };
}

export function configurationEvidence(
  id: string,
  claimId: string,
  claim: string,
  configurationFile: ReadRepositoryFile,
  fieldPointer: string,
  fieldValue: unknown,
  context: EvidenceBuildContext,
): EvidenceRecord {
  const excerpt = JSON.stringify(fieldValue);
  return {
    ...verifiedBase(id, claimId, claim, context),
    evidence_type: "config_field",
    source_kind: "configuration",
    locator: {
      source_path: configurationFile.path,
      blob_sha: configurationFile.blobSha,
      field_pointer: fieldPointer,
      excerpt,
      excerpt_sha256: hashExcerpt(excerpt),
    },
    verification: {
      method: "config_parse",
      checked_at: context.checkedAt,
      commit_resolved: true,
      path_exists: true,
      symbol_exists: null,
      line_range_valid: null,
      excerpt_matches: true,
    },
  };
}

export function documentationEvidence(
  id: string,
  claimId: string,
  claim: string,
  documentationFile: ReadRepositoryFile,
  lineStart: number,
  lineEnd: number,
  excerpt: string,
  context: EvidenceBuildContext,
): EvidenceRecord {
  return {
    ...verifiedBase(id, claimId, claim, context),
    evidence_type: "documentation_statement",
    source_kind: "documentation",
    locator: {
      source_path: documentationFile.path,
      blob_sha: documentationFile.blobSha,
      line_start: lineStart,
      line_end: lineEnd,
      excerpt,
      excerpt_sha256: hashExcerpt(excerpt),
    },
    confidence: 0.9,
    verification_status: "documentation",
    verification: {
      method: "documentation_read",
      checked_at: context.checkedAt,
      commit_resolved: true,
      path_exists: true,
      symbol_exists: null,
      line_range_valid: true,
      excerpt_matches: true,
    },
    limitations: ["项目文档是仓库作者的说明，不等同于运行时验证。"],
  };
}

export function branchEvidence(
  id: string,
  claimId: string,
  claim: string,
  file: ReadRepositoryFile,
  branch: StaticBranchBehavior,
  context: EvidenceBuildContext,
): EvidenceRecord {
  return {
    ...verifiedBase(id, claimId, claim, context),
    evidence_type: "source_range",
    source_kind: "source_code",
    locator: {
      source_path: file.path,
      blob_sha: file.blobSha,
      symbol: { name: branch.ownerSymbol, kind: "function" },
      line_start: branch.lineStart,
      line_end: branch.lineEnd,
      excerpt: branch.excerpt,
      excerpt_sha256: hashExcerpt(branch.excerpt),
    },
    verification: {
      method: "exact_text",
      checked_at: context.checkedAt,
      commit_resolved: true,
      path_exists: true,
      symbol_exists: true,
      line_range_valid: true,
      excerpt_matches: true,
    },
  };
}

export function sourceRangeEvidence(
  id: string,
  claimId: string,
  claim: string,
  file: ReadRepositoryFile,
  relationship: StaticRelationship,
  context: EvidenceBuildContext,
): EvidenceRecord {
  return {
    ...verifiedBase(id, claimId, claim, context),
    evidence_type: "source_range",
    source_kind: "source_code",
    locator: {
      source_path: file.path,
      blob_sha: file.blobSha,
      line_start: relationship.lineStart,
      line_end: relationship.lineEnd,
      excerpt: relationship.excerpt,
      excerpt_sha256: hashExcerpt(relationship.excerpt),
    },
    verification: {
      method: "exact_text",
      checked_at: context.checkedAt,
      commit_resolved: true,
      path_exists: true,
      symbol_exists: null,
      line_range_valid: true,
      excerpt_matches: true,
    },
  };
}

export function directCallEvidence(
  id: string,
  claimId: string,
  claim: string,
  callerFile: ReadRepositoryFile,
  call: StaticDirectCall,
  context: EvidenceBuildContext,
): EvidenceRecord {
  return {
    ...verifiedBase(id, claimId, claim, context),
    evidence_record_version: 2,
    evidence_type: "direct_call",
    source_kind: "source_code",
    locator: {
      source_path: callerFile.path,
      blob_sha: callerFile.blobSha,
      symbol: { name: call.callerSymbol, kind: "function" },
      line_start: call.lineStart,
      line_end: call.lineEnd,
      excerpt: call.excerpt,
      excerpt_sha256: hashExcerpt(call.excerpt),
    },
    call_relation: {
      relation: "CALLS",
      direct: true,
      runtime_execution_guaranteed: false,
      caller: {
        source_path: call.callerPath,
        symbol: { name: call.callerSymbol, kind: "function" },
      },
      callee: {
        source_path: call.calleePath,
        symbol: { name: call.calleeSymbol, kind: "function" },
      },
      call_site: {
        source_path: call.callerPath,
        line_start: call.lineStart,
        line_end: call.lineEnd,
        source_order: call.sourceOrder,
      },
      resolution_method: call.resolutionMethod,
      ...(call.importBinding === undefined
        ? {}
        : {
            import_binding: {
              kind: call.importBinding.kind,
              specifier: call.importBinding.specifier,
              local_name: call.importBinding.localName,
              imported_name: call.importBinding.importedName,
              declaration_path: call.importBinding.declarationPath,
              line_start: call.importBinding.lineStart,
              line_end: call.importBinding.lineEnd,
              ...(call.importBinding.reexportHop === undefined
                ? {}
                : {
                    reexport_hop: {
                      declaration_path: call.importBinding.reexportHop.declarationPath,
                      specifier: call.importBinding.reexportHop.specifier,
                      exported_name: call.importBinding.reexportHop.exportedName,
                      imported_name: call.importBinding.reexportHop.importedName,
                      line_start: call.importBinding.reexportHop.lineStart,
                      line_end: call.importBinding.reexportHop.lineEnd,
                    },
                  }),
            },
          }),
    },
    verification: {
      method: "ast_call_expression",
      checked_at: context.checkedAt,
      commit_resolved: true,
      path_exists: true,
      symbol_exists: true,
      line_range_valid: true,
      excerpt_matches: true,
    },
    limitations: [
      "This is one resolved direct static call expression; it does not prove runtime execution, frequency, ordering, outcome, or transitive flow.",
    ],
  };
}

export function symbolEvidence(
  id: string,
  claimId: string,
  claim: string,
  file: ReadRepositoryFile,
  symbol: StaticSymbol,
  context: EvidenceBuildContext,
): EvidenceRecord {
  return {
    ...verifiedBase(id, claimId, claim, context),
    evidence_type: "symbol_declaration",
    source_kind: "source_code",
    locator: {
      source_path: file.path,
      blob_sha: file.blobSha,
      symbol: { name: symbol.name, kind: symbol.kind },
      line_start: symbol.lineStart,
      line_end: symbol.lineEnd,
      excerpt: symbol.excerpt,
      excerpt_sha256: hashExcerpt(symbol.excerpt),
    },
    verification: {
      method: "ast_symbol",
      checked_at: context.checkedAt,
      commit_resolved: true,
      path_exists: true,
      symbol_exists: true,
      line_range_valid: true,
      excerpt_matches: true,
    },
  };
}

export function findBlob(snapshot: RepositorySnapshot, path: string): TreeEntry {
  const entry = snapshot.tree.find(
    (candidate) => candidate.path === path && candidate.type === "blob",
  );
  if (entry === undefined) {
    throw new Error(`Cannot bind evidence to missing path: ${path}`);
  }
  return entry;
}
