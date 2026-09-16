import { createHash } from "node:crypto";

import type { GroundedFactPack } from "../facts/domain.js";
import type { SchemaRegistry } from "../schemas/registry.js";
import type {
  AcceptedContentAngleV2,
  ContentAngleEvaluationReceipt,
  ContentAngleGateCode,
} from "./angle-contract.js";

export const HUMAN_SELECTION_VERSION = 1 as const;

export type CandidateLifecycleState =
  | "GENERATED"
  | "HOST_VALIDATED"
  | "HOST_REJECTED"
  | "HUMAN_APPROVED"
  | "HUMAN_REJECTED"
  | "STALE";

export type EditorialStrength = "WEAK" | "USEFUL" | "STRONG";

export interface ArtifactReference {
  readonly artifact_path: string;
  readonly sha256: string;
}

export interface EditorialSignal {
  readonly strength: EditorialStrength;
  readonly classification: string;
  readonly basis: "EDITORIAL_HEURISTIC_NOT_OBJECTIVE_TRUTH";
  readonly rationale: string;
  readonly source: ArtifactReference;
}

export interface GenerationReference {
  readonly provider: string;
  readonly model: string;
  readonly receipt: ArtifactReference;
}

export interface FactEvidenceTrace {
  readonly fact_id: string;
  readonly evidence_ids: readonly string[];
}

export interface HumanSelectableAngle {
  readonly lifecycle: readonly ["GENERATED", "HOST_VALIDATED"];
  readonly candidate_fingerprint_sha256: string;
  readonly angle: AcceptedContentAngleV2;
  readonly host_validation: {
    readonly status: "PASS";
    readonly decision_codes: readonly ["ALL_HARD_GATES_PASSED"];
  };
  readonly editorial_signal: EditorialSignal;
  readonly canonical_technical_basis: AcceptedContentAngleV2["technical_basis"];
  readonly supporting_fact_ids: readonly string[];
  readonly known_caveats: readonly string[];
  readonly fact_evidence_trace: readonly FactEvidenceTrace[];
  readonly generation: GenerationReference;
  readonly available_actions: readonly ["APPROVE", "REJECT"];
}

export interface ExcludedAngle {
  readonly candidate_id: string;
  readonly lifecycle: readonly ["GENERATED", "HOST_REJECTED"];
  readonly reason_codes: readonly ContentAngleGateCode[];
}

export interface HumanSelectionArtifact {
  readonly human_selection_version: typeof HUMAN_SELECTION_VERSION;
  readonly status: "READY" | "EMPTY";
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: GroundedFactPack["fact_ir_version"];
  readonly content_angle_version: 2;
  readonly editorial_authority: "HUMAN";
  readonly source_provenance: {
    readonly host_evaluation: ArtifactReference;
    readonly fact_pack: ArtifactReference;
  };
  readonly candidates: readonly HumanSelectableAngle[];
  readonly excluded_candidates: readonly ExcludedAngle[];
  readonly zero_candidate_is_valid: true;
  readonly generation_metadata: {
    readonly mode: "offline_host_projection";
    readonly paid_api_requests: 0;
    readonly real_model_requests: 0;
    readonly secret_reads: 0;
    readonly repository_executions: 0;
  };
}

export interface BuildHumanSelectionInput {
  readonly evaluation: ContentAngleEvaluationReceipt;
  readonly factPack: GroundedFactPack;
  readonly signals: Readonly<Record<string, EditorialSignal>>;
  readonly generation: GenerationReference;
  readonly sources: HumanSelectionArtifact["source_provenance"];
}

export interface EditorialAngleDecisionArtifact {
  readonly editorial_decision_version: 1;
  readonly decision: "APPROVE" | "REJECT";
  readonly status: "HUMAN_APPROVED" | "HUMAN_REJECTED";
  readonly lifecycle: readonly [
    "GENERATED",
    "HOST_VALIDATED",
    "HUMAN_APPROVED" | "HUMAN_REJECTED",
  ];
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: GroundedFactPack["fact_ir_version"];
  readonly content_angle_version: 2;
  readonly candidate_id: string;
  readonly candidate_fingerprint_sha256: string;
  readonly title: string;
  readonly editorial_thesis: string;
  readonly supporting_fact_ids: readonly string[];
  readonly canonical_technical_basis: AcceptedContentAngleV2["technical_basis"];
  readonly known_caveats: readonly string[];
  readonly host_validation: HumanSelectableAngle["host_validation"];
  readonly editorial_signal: EditorialSignal;
  readonly decided_by: "human";
  readonly approved_by: "human" | null;
  readonly decision_timestamp: string;
  readonly approval_timestamp: string | null;
  readonly decision_context: "USER_ACTION" | "OFFLINE_FIXTURE";
  readonly generation_model: {
    readonly provider: string;
    readonly model: string;
  };
  readonly generation_receipt: ArtifactReference;
  readonly script_eligibility: {
    readonly eligible: boolean;
    readonly status: "ELIGIBLE" | "NOT_ELIGIBLE";
    readonly reason:
      | "HOST_VALIDATED_HUMAN_APPROVED_EDITORIAL_STRENGTH_USEFUL_OR_STRONG"
      | "HUMAN_REJECTED"
      | "EDITORIAL_STRENGTH_BELOW_USEFUL";
  };
  readonly explicit_script_generation_required: true;
  readonly generation_metadata: {
    readonly mode: "offline_human_decision";
    readonly paid_api_requests: 0;
    readonly real_model_requests: 0;
    readonly secret_reads: 0;
    readonly repository_executions: 0;
  };
}

export type ApprovedEditorialAngle = EditorialAngleDecisionArtifact & {
  readonly decision: "APPROVE";
  readonly status: "HUMAN_APPROVED";
  readonly approved_by: "human";
  readonly approval_timestamp: string;
};

export interface CreateHumanEditorialDecisionInput {
  readonly selection: HumanSelectionArtifact;
  readonly candidate_id: string;
  readonly decision: "APPROVE" | "REJECT";
  readonly decided_at: string;
  readonly context: "USER_ACTION" | "OFFLINE_FIXTURE";
}

export interface CurrentEditorialBinding {
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: number;
  readonly content_angle_version: number;
  readonly candidate_fingerprint_sha256: string;
}

export type EditorialFreshnessReason =
  | "REPOSITORY_CHANGED"
  | "REPOSITORY_COMMIT_CHANGED"
  | "FACT_IR_VERSION_CHANGED"
  | "CONTENT_ANGLE_VERSION_CHANGED"
  | "CANDIDATE_TECHNICAL_CONTENT_CHANGED";

export interface EditorialDecisionFreshness {
  readonly state: "CURRENT" | "STALE" | "REVALIDATION_REQUIRED";
  readonly reason_codes: readonly EditorialFreshnessReason[];
  readonly script_eligible: boolean;
}

function sameRepository(
  left: GroundedFactPack["repository"],
  right: GroundedFactPack["repository"],
): boolean {
  return (
    left.url === right.url &&
    left.owner === right.owner &&
    left.name === right.name
  );
}

export function buildHumanSelectionArtifact(
  input: BuildHumanSelectionInput,
): HumanSelectionArtifact {
  const { evaluation, factPack } = input;
  if (
    !sameRepository(evaluation.repository, factPack.repository) ||
    evaluation.commit !== factPack.commit ||
    evaluation.fact_ir_version !== factPack.fact_ir_version
  ) {
    throw new Error(
      "HUMAN_SELECTION_IDENTITY_MISMATCH: Host evaluation and Fact IR must bind to the same repository, commit, and Fact version.",
    );
  }

  const factById = new Map(factPack.facts.map((fact) => [fact.id, fact]));
  const decisionById = new Map(
    evaluation.decision_trace.map((decision) => [decision.candidate_id, decision]),
  );
  const candidates = evaluation.accepted_angles.map((angle) => {
    const decision = decisionById.get(angle.id);
    if (
      decision?.decision !== "ACCEPT" ||
      !decision.decision_reason.includes("ALL_HARD_GATES_PASSED")
    ) {
      throw new Error(
        `HUMAN_SELECTION_HOST_VALIDATION_REQUIRED: ${angle.id} lacks an accepted Host Truth receipt.`,
      );
    }
    const signal = input.signals[angle.id];
    if (signal === undefined) {
      throw new Error(
        `HUMAN_SELECTION_EDITORIAL_SIGNAL_REQUIRED: ${angle.id} has no qualitative editorial signal.`,
      );
    }
    const factEvidenceTrace = angle.supporting_fact_ids.map((factId) => {
      const fact = factById.get(factId);
      if (fact === undefined || fact.evidence_ids.length === 0) {
        throw new Error(
          `HUMAN_SELECTION_FACT_TRACE_INVALID: ${angle.id} references unavailable Fact ${factId}.`,
        );
      }
      return { fact_id: fact.id, evidence_ids: [...fact.evidence_ids] };
    });
    const candidate = {
      lifecycle: ["GENERATED", "HOST_VALIDATED"] as const,
      angle,
      host_validation: {
        status: "PASS" as const,
        decision_codes: ["ALL_HARD_GATES_PASSED"] as const,
      },
      editorial_signal: signal,
      canonical_technical_basis: angle.technical_basis,
      supporting_fact_ids: [...angle.supporting_fact_ids],
      known_caveats: [...angle.caveats],
      fact_evidence_trace: factEvidenceTrace,
      generation: input.generation,
      available_actions: ["APPROVE", "REJECT"] as const,
    };
    return {
      ...candidate,
      candidate_fingerprint_sha256: candidateFingerprint(candidate),
    };
  });

  const excludedCandidates = evaluation.decision_trace
    .filter((decision) => decision.decision === "REJECT")
    .map((decision) => ({
      candidate_id: decision.candidate_id,
      lifecycle: ["GENERATED", "HOST_REJECTED"] as const,
      reason_codes: [...decision.decision_reason],
    }));

  return {
    human_selection_version: HUMAN_SELECTION_VERSION,
    status: candidates.length > 0 ? "READY" : "EMPTY",
    repository: { ...evaluation.repository },
    commit: evaluation.commit,
    fact_ir_version: evaluation.fact_ir_version,
    content_angle_version: 2,
    editorial_authority: "HUMAN",
    source_provenance: input.sources,
    candidates,
    excluded_candidates: excludedCandidates,
    zero_candidate_is_valid: true,
    generation_metadata: {
      mode: "offline_host_projection",
      paid_api_requests: 0,
      real_model_requests: 0,
      secret_reads: 0,
      repository_executions: 0,
    },
  };
}

function candidateFingerprint(
  candidate: Omit<HumanSelectableAngle, "candidate_fingerprint_sha256">,
): string {
  const technicalIdentity = {
    repository: candidate.angle.repository,
    commit: candidate.angle.commit,
    fact_ir_version: candidate.angle.fact_ir_version,
    content_angle_version: candidate.angle.content_angle_version,
    candidate_id: candidate.angle.id,
    title: candidate.angle.title,
    editorial_thesis: candidate.angle.editorial_thesis,
    supporting_fact_ids: candidate.supporting_fact_ids,
    canonical_technical_basis: candidate.canonical_technical_basis,
    known_caveats: candidate.known_caveats,
  };
  return createHash("sha256")
    .update(JSON.stringify(technicalIdentity))
    .digest("hex");
}

export function createHumanEditorialDecision(
  input: CreateHumanEditorialDecisionInput,
): EditorialAngleDecisionArtifact {
  assertHumanSelectionIntegrity(input.selection);
  const candidate = input.selection.candidates.find(
    (item) => item.angle.id === input.candidate_id,
  );
  if (candidate === undefined) {
    const hostRejected = input.selection.excluded_candidates.some(
      (item) => item.candidate_id === input.candidate_id,
    );
    throw new Error(
      hostRejected
        ? `HOST_REJECTED_CANDIDATE_CANNOT_BE_APPROVED: ${input.candidate_id}`
        : `CANDIDATE_NOT_HUMAN_SELECTABLE: ${input.candidate_id}`,
    );
  }
  if (
    candidateFingerprint(candidate) !== candidate.candidate_fingerprint_sha256
  ) {
    throw new Error(
      `CANDIDATE_TECHNICAL_CONTENT_CHANGED_REVALIDATION_REQUIRED: ${input.candidate_id}`,
    );
  }
  const parsedTimestamp = new Date(input.decided_at);
  if (
    Number.isNaN(parsedTimestamp.valueOf()) ||
    parsedTimestamp.toISOString() !== input.decided_at
  ) {
    throw new Error(
      "EDITORIAL_DECISION_TIMESTAMP_INVALID: decided_at must be a canonical ISO-8601 UTC timestamp.",
    );
  }

  const approved = input.decision === "APPROVE";
  const strengthAllowsScript =
    candidate.editorial_signal.strength === "USEFUL" ||
    candidate.editorial_signal.strength === "STRONG";
  const eligible = approved && strengthAllowsScript;
  const finalLifecycle = approved ? "HUMAN_APPROVED" : "HUMAN_REJECTED";

  return {
    editorial_decision_version: 1,
    decision: input.decision,
    status: finalLifecycle,
    lifecycle: ["GENERATED", "HOST_VALIDATED", finalLifecycle],
    repository: { ...input.selection.repository },
    commit: input.selection.commit,
    fact_ir_version: input.selection.fact_ir_version,
    content_angle_version: input.selection.content_angle_version,
    candidate_id: candidate.angle.id,
    candidate_fingerprint_sha256: candidate.candidate_fingerprint_sha256,
    title: candidate.angle.title,
    editorial_thesis: candidate.angle.editorial_thesis,
    supporting_fact_ids: [...candidate.supporting_fact_ids],
    canonical_technical_basis: candidate.canonical_technical_basis,
    known_caveats: [...candidate.known_caveats],
    host_validation: candidate.host_validation,
    editorial_signal: candidate.editorial_signal,
    decided_by: "human",
    approved_by: approved ? "human" : null,
    decision_timestamp: input.decided_at,
    approval_timestamp: approved ? input.decided_at : null,
    decision_context: input.context,
    generation_model: {
      provider: candidate.generation.provider,
      model: candidate.generation.model,
    },
    generation_receipt: candidate.generation.receipt,
    script_eligibility: {
      eligible,
      status: eligible ? "ELIGIBLE" : "NOT_ELIGIBLE",
      reason: !approved
        ? "HUMAN_REJECTED"
        : strengthAllowsScript
          ? "HOST_VALIDATED_HUMAN_APPROVED_EDITORIAL_STRENGTH_USEFUL_OR_STRONG"
          : "EDITORIAL_STRENGTH_BELOW_USEFUL",
    },
    explicit_script_generation_required: true,
    generation_metadata: {
      mode: "offline_human_decision",
      paid_api_requests: 0,
      real_model_requests: 0,
      secret_reads: 0,
      repository_executions: 0,
    },
  };
}

export function evaluateEditorialDecisionFreshness(
  decision: EditorialAngleDecisionArtifact,
  current: CurrentEditorialBinding,
): EditorialDecisionFreshness {
  const staleReasons: EditorialFreshnessReason[] = [];
  if (!sameRepository(decision.repository, current.repository)) {
    staleReasons.push("REPOSITORY_CHANGED");
  }
  if (decision.commit !== current.commit) {
    staleReasons.push("REPOSITORY_COMMIT_CHANGED");
  }
  if (decision.fact_ir_version !== current.fact_ir_version) {
    staleReasons.push("FACT_IR_VERSION_CHANGED");
  }
  if (decision.content_angle_version !== current.content_angle_version) {
    staleReasons.push("CONTENT_ANGLE_VERSION_CHANGED");
  }
  if (staleReasons.length > 0) {
    return {
      state: "STALE",
      reason_codes: staleReasons,
      script_eligible: false,
    };
  }
  if (
    decision.candidate_fingerprint_sha256 !==
    current.candidate_fingerprint_sha256
  ) {
    return {
      state: "REVALIDATION_REQUIRED",
      reason_codes: ["CANDIDATE_TECHNICAL_CONTENT_CHANGED"],
      script_eligible: false,
    };
  }
  return {
    state: "CURRENT",
    reason_codes: [],
    script_eligible: decision.script_eligibility.eligible,
  };
}

export function serializeEditorialDecision(
  decision: EditorialAngleDecisionArtifact,
): string {
  return `${JSON.stringify(decision, null, 2)}\n`;
}

function sameStringArray(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export function assertHumanSelectionIntegrity(
  selection: HumanSelectionArtifact,
): void {
  if (
    (selection.status === "READY" && selection.candidates.length === 0) ||
    (selection.status === "EMPTY" && selection.candidates.length !== 0)
  ) {
    throw new Error("HUMAN_SELECTION_STATUS_COUNT_MISMATCH");
  }
  const candidateIds = new Set<string>();
  for (const candidate of selection.candidates) {
    if (candidateIds.has(candidate.angle.id)) {
      throw new Error(`HUMAN_SELECTION_DUPLICATE_CANDIDATE: ${candidate.angle.id}`);
    }
    candidateIds.add(candidate.angle.id);
    if (
      candidate.angle.status !== "ACCEPTED" ||
      !sameRepository(candidate.angle.repository, selection.repository) ||
      candidate.angle.commit !== selection.commit ||
      candidate.angle.fact_ir_version !== selection.fact_ir_version ||
      candidate.angle.content_angle_version !== selection.content_angle_version ||
      candidate.host_validation.status !== "PASS" ||
      !candidate.host_validation.decision_codes.includes(
        "ALL_HARD_GATES_PASSED",
      )
    ) {
      throw new Error(
        `HUMAN_SELECTION_HOST_BINDING_INVALID: ${candidate.angle.id}`,
      );
    }
    if (
      candidateFingerprint(candidate) !== candidate.candidate_fingerprint_sha256
    ) {
      throw new Error(
        `CANDIDATE_TECHNICAL_CONTENT_CHANGED_REVALIDATION_REQUIRED: ${candidate.angle.id}`,
      );
    }
    if (
      !sameStringArray(
        candidate.supporting_fact_ids,
        candidate.angle.supporting_fact_ids,
      ) ||
      JSON.stringify(candidate.canonical_technical_basis) !==
        JSON.stringify(candidate.angle.technical_basis) ||
      !sameStringArray(candidate.known_caveats, candidate.angle.caveats)
    ) {
      throw new Error(
        `HUMAN_SELECTION_HOST_DERIVED_FIELDS_DRIFT: ${candidate.angle.id}`,
      );
    }
    const tracedFactIds = candidate.fact_evidence_trace.map(
      (trace) => trace.fact_id,
    );
    if (
      !sameStringArray(tracedFactIds, candidate.supporting_fact_ids) ||
      candidate.fact_evidence_trace.some(
        (trace) => trace.evidence_ids.length === 0,
      )
    ) {
      throw new Error(
        `HUMAN_SELECTION_FACT_EVIDENCE_TRACE_INVALID: ${candidate.angle.id}`,
      );
    }
  }
  for (const excluded of selection.excluded_candidates) {
    if (candidateIds.has(excluded.candidate_id)) {
      throw new Error(
        `HOST_REJECTED_CANDIDATE_CANNOT_BE_HUMAN_SELECTABLE: ${excluded.candidate_id}`,
      );
    }
  }
}

export function parseHumanSelectionArtifact(
  value: unknown,
  schemas: SchemaRegistry,
): HumanSelectionArtifact {
  schemas.assert("HumanSelection", value);
  const selection = value as HumanSelectionArtifact;
  assertHumanSelectionIntegrity(selection);
  return selection;
}

export function serializeHumanSelectionArtifact(
  selection: HumanSelectionArtifact,
): string {
  assertHumanSelectionIntegrity(selection);
  return `${JSON.stringify(selection, null, 2)}\n`;
}

function inline(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function renderHumanSelectionPreview(
  selection: HumanSelectionArtifact,
): string {
  assertHumanSelectionIntegrity(selection);
  const lines = [
    "# Human Editorial Selection",
    "",
    `Repository: ${selection.repository.url}`,
    `Commit: ${selection.commit}`,
    `Fact IR Version: ${selection.fact_ir_version}`,
    "Editorial Authority: HUMAN",
    "",
  ];
  if (selection.candidates.length === 0) {
    lines.push("No grounded editorial angle candidate found.");
    return `${lines.join("\n")}\n`;
  }
  selection.candidates.forEach((candidate, index) => {
    const entityLabels = new Map(
      candidate.angle.technical_entities.map((entity) => [
        entity.entity_ref,
        entity.label,
      ]),
    );
    lines.push(
      `## Candidate ${index + 1}: ${inline(candidate.angle.title)}`,
      "",
      `Candidate ID: ${candidate.angle.id}`,
      `Thesis: ${inline(candidate.angle.editorial_thesis)}`,
      `Why It May Be Interesting: ${inline(candidate.angle.why_interesting)}`,
      `Target Audience: ${candidate.angle.target_audience.join(", ")}`,
      `Editorial Strength: ${candidate.editorial_signal.strength}`,
      `Editorial Signal Basis: ${candidate.editorial_signal.basis}`,
      "",
      "### Canonical Technical Basis",
      "",
      ...candidate.canonical_technical_basis.map(
        (basis) =>
          `- ${inline(entityLabels.get(basis.subject_ref) ?? basis.subject_ref)} ${basis.predicate} ${inline(entityLabels.get(basis.object_ref) ?? basis.object_ref)} [${basis.scope}]`,
      ),
      "",
      "<details>",
      "<summary>Supporting Facts and Fact → Evidence Trace</summary>",
      "",
      ...candidate.fact_evidence_trace.map(
        (trace) =>
          `- ${trace.fact_id} -> ${trace.evidence_ids.join(", ")}`,
      ),
      "",
      "</details>",
      "",
      "### Known Caveats",
      "",
      ...(candidate.known_caveats.length === 0
        ? ["- None recorded."]
        : candidate.known_caveats.map((caveat) => `- ${inline(caveat)}`)),
      "",
      "[Approve] [Reject]",
      "",
    );
  });
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return `${lines.join("\n")}\n`;
}
