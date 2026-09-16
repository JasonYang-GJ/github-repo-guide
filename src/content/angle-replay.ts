import type { CanonicalGroundedBriefArtifact } from "../brief/canonical.js";
import type { GroundedFactPack } from "../facts/domain.js";
import type { SchemaRegistry } from "../schemas/registry.js";
import {
  evaluateContentAngleDraftBundle,
  type ContentAngleCandidateDraftBundle,
  type ContentAngleCanaryDecision,
  type ContentAngleDraftEvaluation,
} from "./angle-canary.js";
import type { ContentAngleGateCode } from "./angle-contract.js";
import {
  projectCanonicalUnknowns,
  reconcileUnknownReferences,
  type CanonicalUnknown,
  type UnknownReferenceReconciliation,
} from "./unknown-reference.js";

export interface ReplayedContentAngleCandidate {
  readonly candidate_id: string;
  readonly original_unknown_dependencies: readonly string[];
  readonly canonicalized_unknown_dependencies: readonly string[] | null;
  readonly representation_changed: boolean;
  readonly reference_only_change: boolean;
  readonly reference_resolution: UnknownReferenceReconciliation;
  readonly decision: ContentAngleCanaryDecision;
}

export interface ContentAngleReplayResult {
  readonly status: "REPLAY_COMPLETE";
  readonly canonical_unknowns: readonly CanonicalUnknown[];
  readonly candidates: readonly ReplayedContentAngleCandidate[];
  readonly evaluation: ContentAngleDraftEvaluation;
  readonly accepted: ContentAngleDraftEvaluation["acceptedAngles"];
  readonly summary: {
    readonly raw_candidates: number;
    readonly exact_id_references: number;
    readonly canonicalized_references: number;
    readonly ambiguous_references: number;
    readonly unsupported_unknown_introductions: number;
    readonly unknown_unknown_references: number;
    readonly candidates_invalid_due_to_contract: number;
    readonly candidates_invalid_due_to_truth_boundary: number;
    readonly accepted: number;
    readonly rejected: number;
    readonly deduplicated: number;
  };
}

const TRUTH_BOUNDARY_GATE_CODES = new Set<ContentAngleGateCode>([
  "UNKNOWN_FACT_REFERENCE",
  "UNKNOWN_STATEMENT_REFERENCE",
  "FACT_STATEMENT_BINDING_MISMATCH",
  "TECHNICAL_BASIS_REFERENCE_MISMATCH",
  "TECHNICAL_BASIS_NOT_ENTAILED",
  "FACT_MUTATION_FORBIDDEN",
  "UNSUPPORTED_ENTITY_INTRODUCTION",
  "EDITORIAL_JUDGMENT_MASQUERADES_AS_VERIFIED",
  "EXTERNAL_COMPARISON_UNSUPPORTED",
  "CAUSALITY_UNSUPPORTED",
  "EXCLUSIVITY_UNSUPPORTED",
  "SCOPE_EXPANSION",
  "PERFORMANCE_CLAIM_UNSUPPORTED",
  "SAFETY_CLAIM_UNSUPPORTED",
  "OUTCOME_CLAIM_UNSUPPORTED",
  "DOCUMENTATION_UPGRADE_FORBIDDEN",
  "KNOWN_UNKNOWN_PROMOTED",
  "NOVELTY_RESEARCH_REQUIRED",
]);

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export function replayContentAngleDraftBundle(
  rawBundle: ContentAngleCandidateDraftBundle,
  pack: GroundedFactPack,
  canonical: CanonicalGroundedBriefArtifact,
  schemas: SchemaRegistry,
): ContentAngleReplayResult {
  const canonicalUnknowns = projectCanonicalUnknowns(canonical);
  const resolutions = rawBundle.candidates.map((candidate) =>
    reconcileUnknownReferences(candidate.unknown_dependencies, canonicalUnknowns),
  );
  const replayBundle: ContentAngleCandidateDraftBundle = {
    draft_version: rawBundle.draft_version,
    candidates: rawBundle.candidates.map((candidate, index) => {
      const resolution = resolutions[index];
      if (resolution === undefined || resolution.status !== "RESOLVED") {
        return candidate;
      }
      return {
        ...candidate,
        unknown_dependencies: [...resolution.canonical_unknown_ids],
      };
    }),
  };
  const evaluation = evaluateContentAngleDraftBundle(
    replayBundle,
    pack,
    canonical,
    schemas,
  );
  const decisions = new Map(
    evaluation.decisions.map((decision) => [decision.candidate_id, decision]),
  );
  const candidates = rawBundle.candidates.map((candidate, index) => {
    const resolution = resolutions[index];
    const decision = decisions.get(candidate.candidate_id);
    const replayedCandidate = replayBundle.candidates[index];
    if (
      resolution === undefined ||
      decision === undefined ||
      replayedCandidate === undefined
    ) {
      throw new Error("CONTENT_ANGLE_REPLAY_DECISION_DRIFT");
    }
    const {
      unknown_dependencies: _originalUnknownDependencies,
      ...originalContent
    } = candidate;
    const {
      unknown_dependencies: _replayedUnknownDependencies,
      ...replayedContent
    } = replayedCandidate;
    const canonicalized =
      resolution.status === "RESOLVED"
        ? resolution.canonical_unknown_ids
        : null;
    const representationChanged =
      canonicalized !== null &&
      !sameStrings(candidate.unknown_dependencies, canonicalized);
    return {
      candidate_id: candidate.candidate_id,
      original_unknown_dependencies: [...candidate.unknown_dependencies],
      canonicalized_unknown_dependencies:
        canonicalized === null ? null : [...canonicalized],
      representation_changed: representationChanged,
      reference_only_change:
        representationChanged &&
        JSON.stringify(originalContent) === JSON.stringify(replayedContent),
      reference_resolution: resolution,
      decision,
    };
  });
  const referenceDecisions = resolutions.flatMap(
    (resolution) => resolution.references,
  );
  return {
    status: "REPLAY_COMPLETE",
    canonical_unknowns: canonicalUnknowns,
    candidates,
    evaluation,
    accepted: evaluation.acceptedAngles,
    summary: {
      raw_candidates: rawBundle.candidates.length,
      exact_id_references: referenceDecisions.filter(
        (reference) => reference.decision === "EXACT_ID_REFERENCE",
      ).length,
      canonicalized_references: referenceDecisions.filter(
        (reference) => reference.decision === "REFERENCE_CANONICALIZED",
      ).length,
      ambiguous_references: referenceDecisions.filter(
        (reference) => reference.decision === "AMBIGUOUS_UNKNOWN_REFERENCE",
      ).length,
      unsupported_unknown_introductions: referenceDecisions.filter(
        (reference) =>
          reference.decision === "UNSUPPORTED_UNKNOWN_INTRODUCTION",
      ).length,
      unknown_unknown_references: referenceDecisions.filter(
        (reference) => reference.decision === "UNKNOWN_UNKNOWN_REFERENCE",
      ).length,
      candidates_invalid_due_to_contract: resolutions.filter(
        (resolution) => resolution.status === "REJECTED",
      ).length,
      candidates_invalid_due_to_truth_boundary: evaluation.decisions.filter(
        (decision) =>
          decision.reason_codes.some((code) =>
            TRUTH_BOUNDARY_GATE_CODES.has(code),
          ),
      ).length,
      accepted: evaluation.acceptedAngles.length,
      rejected: evaluation.decisions.filter(
        (decision) => decision.decision === "REJECT",
      ).length,
      deduplicated: evaluation.decisions.filter(
        (decision) => decision.decision === "DEDUPLICATE",
      ).length,
    },
  };
}
