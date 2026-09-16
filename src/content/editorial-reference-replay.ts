import type { CanonicalGroundedBriefArtifact } from "../brief/canonical.js";
import type { GroundedFactPack } from "../facts/domain.js";
import type { SchemaRegistry } from "../schemas/registry.js";
import type {
  MinimalAngleDecisionCandidate,
  MinimalAngleDecisionEvaluation,
} from "./angle-routing.js";
import {
  evaluateMinimalAngleDecisionDraftV2,
  type MinimalAngleDecisionDraftV2,
} from "./editorial-retest.js";
import {
  resolveExactModelFactReference,
  type ExactModelFactReferenceResolution,
  type ModelFactReferenceMap,
} from "./model-fact-reference.js";

export interface ReplayedModelFactReference {
  readonly candidate_id: string;
  readonly reference_index: number;
  readonly status: ExactModelFactReferenceResolution["status"];
  readonly raw_reference: string;
  readonly resolved_reference: string | null;
  readonly model_ref: string | null;
  readonly resolution_reason:
    | "MODEL_REFERENCE_CANONICALIZED"
    | "UNKNOWN_MODEL_FACT_REFERENCE"
    | "AMBIGUOUS_MODEL_FACT_REFERENCE"
    | "MODEL_FACT_REFERENCE_CONTEXT_MISMATCH";
}

export interface ReconciledMinimalAngleCandidate {
  readonly candidate_id: string;
  readonly status: "RESOLVED" | "REFERENCE_INVALID";
  readonly raw_supporting_references: readonly string[];
  readonly resolved_canonical_fact_ids: readonly string[];
  readonly resolution_records: readonly ReplayedModelFactReference[];
  readonly derived_candidate: MinimalAngleDecisionCandidate | null;
}

export interface ReconciledMinimalAngleReplay {
  readonly status: "REPLAY_COMPLETE" | "REFERENCE_INVALID";
  readonly raw_candidates: number;
  readonly references_exact: number;
  readonly references_resolved: number;
  readonly references_invalid: number;
  readonly reference_audit: readonly ReplayedModelFactReference[];
  readonly candidates: readonly ReconciledMinimalAngleCandidate[];
  readonly canonicalized_draft: MinimalAngleDecisionDraftV2;
  readonly host_evaluation: MinimalAngleDecisionEvaluation;
  readonly execution_metadata: {
    readonly mode: "OFFLINE_EXACT_REFERENCE_REPLAY";
    readonly paid_api_requests: 0;
    readonly real_model_requests: 0;
    readonly secret_reads: 0;
    readonly repository_executions: 0;
  };
}

export interface ReconciledMinimalAngleReplayInput {
  readonly draft: MinimalAngleDecisionDraftV2;
  readonly reference_map: ModelFactReferenceMap;
  readonly pack: GroundedFactPack;
  readonly canonical: CanonicalGroundedBriefArtifact;
  readonly schemas: SchemaRegistry;
}

function assertDraftShape(draft: MinimalAngleDecisionDraftV2): void {
  if (
    draft.minimal_angle_draft_version !== 2 ||
    draft.candidates.length > 4 ||
    new Set(draft.candidates.map((candidate) => candidate.candidate_id)).size !==
      draft.candidates.length ||
    draft.candidates.some(
      (candidate) =>
        candidate.supporting_fact_ids.length < 1 ||
        candidate.supporting_fact_ids.length > 8 ||
        new Set(candidate.supporting_fact_ids).size !==
          candidate.supporting_fact_ids.length,
    )
  ) {
    throw new Error("MINIMAL_ANGLE_DECISION_DRAFT_V2_INVALID");
  }
}

export function replayReconciledMinimalAngleDecisionDraftV2(
  input: ReconciledMinimalAngleReplayInput,
): ReconciledMinimalAngleReplay {
  assertDraftShape(input.draft);
  const candidates = input.draft.candidates.map((candidate) => {
    const resolutionRecords = candidate.supporting_fact_ids.map(
      (rawReference, referenceIndex): ReplayedModelFactReference => {
        const resolution = resolveExactModelFactReference(input.reference_map, {
          raw_reference: rawReference,
          accepted_namespace: "FROZEN_VS05_E_SOURCE_REF",
          repository: input.pack.repository,
          commit: input.pack.commit,
          fact_ir_version: input.pack.fact_ir_version,
        });
        if (resolution.status === "RESOLVED") {
          return {
            candidate_id: candidate.candidate_id,
            reference_index: referenceIndex,
            status: resolution.status,
            raw_reference: resolution.raw_reference,
            resolved_reference: resolution.canonical_fact_id,
            model_ref: resolution.model_ref,
            resolution_reason: resolution.resolution_reason,
          };
        }
        return {
          candidate_id: candidate.candidate_id,
          reference_index: referenceIndex,
          status: resolution.status,
          raw_reference: resolution.raw_reference,
          resolved_reference: null,
          model_ref: null,
          resolution_reason: resolution.failure_code,
        };
      },
    );
    const allResolved = resolutionRecords.every(
      (resolution) => resolution.status === "RESOLVED",
    );
    const resolvedCanonicalFactIds = resolutionRecords.flatMap((resolution) =>
      resolution.resolved_reference === null
        ? []
        : [resolution.resolved_reference],
    );
    const derivedCandidate: MinimalAngleDecisionCandidate | null = allResolved
      ? {
          ...candidate,
          supporting_fact_ids: resolvedCanonicalFactIds,
          target_audience: [...candidate.target_audience],
        }
      : null;

    return {
      candidate_id: candidate.candidate_id,
      status: allResolved ? "RESOLVED" : "REFERENCE_INVALID",
      raw_supporting_references: [...candidate.supporting_fact_ids],
      resolved_canonical_fact_ids: resolvedCanonicalFactIds,
      resolution_records: resolutionRecords,
      derived_candidate: derivedCandidate,
    } satisfies ReconciledMinimalAngleCandidate;
  });
  const referenceAudit = candidates.flatMap(
    (candidate) => candidate.resolution_records,
  );
  const canonicalizedDraft: MinimalAngleDecisionDraftV2 = {
    minimal_angle_draft_version: 2,
    candidates: candidates.flatMap((candidate) =>
      candidate.derived_candidate === null ? [] : [candidate.derived_candidate],
    ),
  };
  const hostEvaluation = evaluateMinimalAngleDecisionDraftV2(
    canonicalizedDraft,
    input.pack,
    input.canonical,
    input.schemas,
  );
  const referencesResolved = referenceAudit.filter(
    (resolution) => resolution.status === "RESOLVED",
  ).length;
  const referencesInvalid = referenceAudit.length - referencesResolved;

  return {
    status: referencesInvalid === 0 ? "REPLAY_COMPLETE" : "REFERENCE_INVALID",
    raw_candidates: input.draft.candidates.length,
    references_exact: referencesResolved,
    references_resolved: referencesResolved,
    references_invalid: referencesInvalid,
    reference_audit: referenceAudit,
    candidates,
    canonicalized_draft: canonicalizedDraft,
    host_evaluation: hostEvaluation,
    execution_metadata: {
      mode: "OFFLINE_EXACT_REFERENCE_REPLAY",
      paid_api_requests: 0,
      real_model_requests: 0,
      secret_reads: 0,
      repository_executions: 0,
    },
  };
}
