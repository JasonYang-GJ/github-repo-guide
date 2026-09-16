import type { CanonicalGroundedBriefArtifact } from "../brief/canonical.js";
import type { ContentAngleCandidateDraftBundle } from "./angle-canary.js";
import {
  projectCanonicalUnknowns,
  validateUnknownIdReferences,
  type UnknownReferenceReconciliation,
} from "./unknown-reference.js";

export interface FixedContractUnknownCandidateAudit {
  readonly candidate_id: string;
  readonly reference_resolution: UnknownReferenceReconciliation;
}

export interface FixedContractUnknownAudit {
  readonly status: "FIXED_CONTRACT_UNKNOWN_AUDIT_COMPLETE";
  readonly candidates: readonly FixedContractUnknownCandidateAudit[];
  readonly summary: {
    readonly candidates: number;
    readonly contract_valid: number;
    readonly contract_invalid: number;
    readonly exact_id_references: number;
    readonly unsupported_unknown_introductions: number;
    readonly nonexistent_unknown_ids: number;
  };
}

export function auditFixedContractUnknownReferences(
  bundle: ContentAngleCandidateDraftBundle,
  canonical: CanonicalGroundedBriefArtifact,
): FixedContractUnknownAudit {
  const canonicalUnknowns = projectCanonicalUnknowns(canonical);
  const candidates = bundle.candidates.map((candidate) => ({
    candidate_id: candidate.candidate_id,
    reference_resolution: validateUnknownIdReferences(
      candidate.unknown_dependencies,
      canonicalUnknowns,
    ),
  }));
  const references = candidates.flatMap(
    (candidate) => candidate.reference_resolution.references,
  );
  return {
    status: "FIXED_CONTRACT_UNKNOWN_AUDIT_COMPLETE",
    candidates,
    summary: {
      candidates: candidates.length,
      contract_valid: candidates.filter(
        (candidate) => candidate.reference_resolution.status === "RESOLVED",
      ).length,
      contract_invalid: candidates.filter(
        (candidate) => candidate.reference_resolution.status === "REJECTED",
      ).length,
      exact_id_references: references.filter(
        (reference) => reference.decision === "EXACT_ID_REFERENCE",
      ).length,
      unsupported_unknown_introductions: references.filter(
        (reference) =>
          reference.decision === "UNSUPPORTED_UNKNOWN_INTRODUCTION",
      ).length,
      nonexistent_unknown_ids: references.filter(
        (reference) => reference.decision === "UNKNOWN_UNKNOWN_REFERENCE",
      ).length,
    },
  };
}
