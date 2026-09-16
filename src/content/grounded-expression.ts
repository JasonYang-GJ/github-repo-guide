import { createHash } from "node:crypto";

import {
  assertApprovedEditorialStoryV1FromHumanIntegrity,
  type ApprovedEditorialStoryV1FromHuman,
} from "./human-story-approval.js";
import {
  validateGroundedScriptDraft,
  type GroundedScriptContractInput,
} from "./grounded-script.js";
import type {
  GroundedScriptDraft,
  ScriptClauseTrace,
  ScriptFactPack,
  ScriptFactReferenceMap,
} from "./grounded-script.js";
import type { CanonicalGroundedBriefArtifact } from "../brief/canonical.js";
import type {
  GroundedEntity,
  GroundedFact,
  GroundedFactPack,
} from "../facts/domain.js";

export const EXPRESSION_REWRITE_ELIGIBILITY_VERSION = 1 as const;
export const GROUNDED_EXPRESSION_REVISION_VERSION = 1 as const;
export const SPOKEN_TECHNICAL_STYLE_PROFILE_VERSION = 1 as const;
export const GROUNDED_EXPRESSION_VALIDATION_VERSION = 1 as const;
export const EXPRESSION_SEMANTIC_LOCK_VERSION = 1 as const;
export const CAVEAT_COVERAGE_VERSION = 1 as const;
export const EXPRESSION_QUALITY_REVIEW_VERSION = 1 as const;

export type ExpressionQualityLevel = "HIGH" | "MEDIUM" | "LOW";
export type ExpressionQualityResult = "PASS" | "PARTIAL" | "FAIL";

export interface ExpressionQualityDimensionsV1 {
  readonly spoken_naturalness: ExpressionQualityLevel;
  readonly sentence_variety: ExpressionQualityLevel;
  readonly audit_language_density: ExpressionQualityLevel;
  readonly technical_jargon_load: ExpressionQualityLevel;
  readonly narrative_flow: ExpressionQualityLevel;
  readonly caveat_burden: ExpressionQualityLevel;
  readonly developer_relevance: ExpressionQualityLevel;
  readonly human_story_fidelity: ExpressionQualityLevel;
}

export interface ExpressionQualityReviewV1 {
  readonly expression_quality_review_version: 1;
  readonly basis:
    | "QUALITATIVE_OFFLINE_SYNTHETIC_FIXTURE_NOT_TRUTH"
    | "QUALITATIVE_HOST_REVIEW_REAL_MODEL_OUTPUT_NOT_TRUTH";
  readonly source: {
    readonly dimensions: ExpressionQualityDimensionsV1;
    readonly overall: ExpressionQualityResult;
  };
  readonly revision: {
    readonly dimensions: ExpressionQualityDimensionsV1;
    readonly overall: ExpressionQualityResult;
  };
  readonly comparison: {
    readonly spoken_naturalness: "IMPROVED" | "NOT_IMPROVED";
    readonly audit_language_density: "REDUCED" | "NOT_REDUCED";
    readonly caveat_burden: "REDUCED" | "NOT_REDUCED";
    readonly human_story_fidelity: "PRESERVED" | "NOT_PRESERVED";
  };
  readonly truth_authority: "NONE";
  readonly human_final_copy: false;
}

export type InternalTruthBoundary =
  | "RUNTIME_EXECUTION_OR_ORDER"
  | "DATA_FLOW"
  | "FULL_PATH_OR_BRANCH_COVERAGE"
  | "ALIAS_RESOLUTION"
  | "DYNAMIC_OR_INDIRECT_CALL_TARGETS"
  | "SECURITY_OR_SSRF_OR_ATTACK_PREVENTION"
  | "DESIGN_INTENT"
  | "CORRECTNESS_OR_RELIABILITY";

export interface CaveatCoverageV1 {
  readonly caveat_coverage_version: 1;
  readonly internal_known_unknowns: ScriptFactPack["known_unknowns"];
  readonly spoken_caveats: readonly string[];
  readonly covered_risk_classes: readonly InternalTruthBoundary[];
  readonly unspoken_internal_boundaries: readonly InternalTruthBoundary[];
  readonly misleading_omission_risk: "LOW" | "HIGH";
  readonly status: "PASS" | "FAIL";
}

export type ExpressionSemanticOperation =
  | "SIMPLIFY"
  | "COMPRESS"
  | "REORDER"
  | "MERGE"
  | "NATURALIZE";

export type ExpressionClauseRewriteOperation =
  | "PARAPHRASE"
  | "MERGE"
  | "COMPRESS"
  | "REORDER"
  | "EDITORIAL_POLISH";

export interface SpokenTechnicalStyleProfileV1 {
  readonly spoken_technical_style_profile_version: 1;
  readonly language: "zh-CN";
  readonly audience: readonly ["DEVELOPER", "VIBE_CODING_USER"];
  readonly target_duration_seconds: { readonly min: 60; readonly max: 90 };
  readonly tone: readonly ["NATURAL", "DIRECT", "TECHNICAL_CONVERSATIONAL"];
  readonly sentence_length: "SHORT";
  readonly audit_language_density: "REDUCE";
  readonly technical_jargon_load: "MINIMUM_NECESSARY";
  readonly symbol_name_policy: "PRESERVE_EXACT";
  readonly fact_ids_spoken: false;
  readonly avoid_repeated_sentence_pattern: true;
  readonly forbidden_registers: readonly ["README", "AUDIT_REPORT"];
  readonly truth_authority: "NONE";
}

export interface GroundedExpressionClauseV1 {
  readonly revision_clause_id: string;
  readonly text: string;
  readonly statement_kind: GroundedScriptDraft["segments"][number]["statement_kind"];
  readonly source_clause_ids: readonly string[];
  readonly fact_refs: readonly string[];
  readonly known_unknown_refs: readonly string[];
  readonly rewrite_operation: ExpressionClauseRewriteOperation;
}

export interface GroundedExpressionSegmentV1 {
  readonly revision_segment_id: string;
  readonly role: GroundedScriptDraft["segments"][number]["role"];
  readonly text: string;
  readonly clauses: readonly GroundedExpressionClauseV1[];
}

export interface ExpressionSourceSegmentMappingV1 {
  readonly source_segment_id: string;
  readonly source_clause_ids: readonly string[];
  readonly revision_segment_ids: readonly string[];
  readonly disposition: "REWRITTEN" | "MERGED" | "OMITTED_FOR_BREVITY";
  readonly reason: string;
}

export interface GroundedExpressionRevisionV1 {
  readonly grounded_expression_revision_version: 1;
  readonly revision_id: string;
  readonly source_script_id: string;
  readonly source_script_fingerprint_sha256: string;
  readonly approved_story_id: string;
  readonly approved_story_fingerprint_sha256: string;
  readonly repository: GroundedScriptDraft["repository"];
  readonly commit: string;
  readonly fact_ir_version: number;
  readonly language: "zh-CN";
  readonly style_profile: SpokenTechnicalStyleProfileV1;
  readonly segments: readonly GroundedExpressionSegmentV1[];
  readonly source_segment_mapping: readonly ExpressionSourceSegmentMappingV1[];
  readonly fact_refs: readonly string[];
  readonly known_unknowns: ScriptFactPack["known_unknowns"];
  readonly revision_metadata: GroundedExpressionRevisionMetadataV1;
  readonly revision_fingerprint_sha256: string;
}

export type GroundedExpressionRevisionMetadataV1 =
  | {
      readonly mode: "deterministic_offline_fixture";
      readonly synthetic_fixture: true;
      readonly model_generated: false;
      readonly semantic_operations: readonly ExpressionSemanticOperation[];
      readonly paid_api_requests: 0;
      readonly real_model_requests: 0;
      readonly secret_reads: 0;
      readonly repository_executions: 0;
    }
  | {
      readonly mode: "real_model_canary";
      readonly synthetic_fixture: false;
      readonly model_generated: true;
      readonly provider: "dashscope";
      readonly model: "qwen3.8-max";
      readonly enable_thinking: false;
      readonly semantic_operations: readonly ExpressionSemanticOperation[];
      readonly paid_api_requests: 1;
      readonly real_model_requests: 1;
      readonly secret_reads: 1;
      readonly repository_executions: 0;
    };

export interface BuildGroundedExpressionRevisionInput {
  readonly eligibility: ExpressionRewriteEligibility;
  readonly sourceScript: GroundedScriptDraft;
  readonly approvedStory: ApprovedEditorialStoryV1FromHuman;
  readonly scriptFactPack: ScriptFactPack;
  readonly styleProfile: SpokenTechnicalStyleProfileV1;
  readonly segments: readonly GroundedExpressionSegmentV1[];
  readonly sourceSegmentMapping: readonly ExpressionSourceSegmentMappingV1[];
  readonly semanticOperations: readonly ExpressionSemanticOperation[];
  readonly revisionMetadata?: GroundedExpressionRevisionMetadataV1;
}

export interface ValidateGroundedExpressionRevisionInput {
  readonly revision: GroundedExpressionRevisionV1;
  readonly eligibility: ExpressionRewriteEligibility;
  readonly sourceScript: GroundedScriptDraft;
  readonly sourceReplay: TruthValidSourceScript;
  readonly approvedStory: ApprovedEditorialStoryV1FromHuman;
  readonly scriptFactPack: ScriptFactPack;
  readonly referenceMap: ScriptFactReferenceMap;
}

export interface GroundedExpressionClauseTraceV1 {
  readonly revision_segment_id: string;
  readonly revision_clause_id: string;
  readonly source_clause_ids: readonly string[];
  readonly source_segment_ids: readonly string[];
  readonly rewrite_operation: ExpressionClauseRewriteOperation;
  readonly statement_kind: GroundedScriptDraft["segments"][number]["statement_kind"];
  readonly fact_refs: readonly string[];
  readonly canonical_fact_ids: readonly string[];
  readonly evidence_ids: readonly string[];
  readonly host_alignment_methods: ScriptClauseTrace["alignment_methods"];
  readonly status: ScriptClauseTrace["status"];
}

export interface GroundedExpressionValidationV1 {
  readonly grounded_expression_validation_version: 1;
  readonly status: "PASS" | "FAIL";
  readonly truth_gate: "PASS" | "FAIL";
  readonly findings: readonly {
    readonly code: string;
    readonly revision_clause_id: string | null;
    readonly details: string;
  }[];
  readonly semantic_lock: {
    readonly expression_semantic_lock_version: 1;
    readonly status: "PASS" | "FAIL";
    readonly allowed_operations: readonly ExpressionSemanticOperation[];
    readonly forbidden_operations: readonly [
      "EXPAND",
      "STRENGTHEN",
      "GENERALIZE",
      "EXPLAIN_CAUSE",
      "INVENT_PURPOSE",
    ];
  };
  readonly host_validation: ReturnType<typeof validateGroundedScriptDraft>;
  readonly clause_trace: readonly GroundedExpressionClauseTraceV1[];
  readonly source_fact_coverage: string;
  readonly rewritten_fact_coverage: string;
  readonly unsupported_technical_claims: number;
  readonly fact_trace: {
    readonly expected: number;
    readonly traced: number;
    readonly missing_fact_refs: readonly string[];
    readonly unsupported_technical_clauses: number;
  };
  readonly caveat_coverage: CaveatCoverageV1;
  readonly story_fidelity: {
    readonly status: "PASS" | "FAIL";
    readonly human_editorial_takeaway_present: boolean;
    readonly prohibited_story_drift_present: boolean;
    readonly core_fact_refs_expected: readonly string[];
    readonly core_fact_refs_used: readonly string[];
  };
  readonly truth_boundary_gates: {
    readonly technical_accuracy: "PASS" | "FAIL";
    readonly evidence_grounding: "PASS" | "FAIL";
    readonly safety: "PASS" | "FAIL";
    readonly runtime_outcome: "PASS" | "FAIL";
    readonly design_intent: "PASS" | "FAIL";
    readonly guarantee: "PASS" | "FAIL";
    readonly causality: "PASS" | "FAIL";
    readonly external_comparison: "PASS" | "FAIL";
    readonly novelty: "PASS" | "FAIL";
    readonly universal_quantifier: "PASS" | "FAIL";
    readonly absence: "PASS" | "FAIL";
    readonly symbol_name: "PASS" | "FAIL";
    readonly known_unknown: "PASS" | "FAIL";
    readonly story_fidelity: "PASS" | "FAIL";
    readonly caveat_coverage: "PASS" | "FAIL";
  };
}

export interface TruthValidSourceScript {
  readonly exact_script_offline_replay_version: 1;
  readonly stage: "VS07-F";
  readonly status: "TRUTH_PASS" | "TRUTH_FAIL";
  readonly repository: GroundedScriptDraft["repository"];
  readonly commit: string;
  readonly fact_ir_version: number;
  readonly approved_angle_ref: string;
  readonly raw_script_sha256: string;
  readonly persisted_draft_sha256: string;
  readonly exact_script_text_changed: false;
  readonly validation: {
    readonly script_validation_version: 1;
    readonly clause_alignment_version: 2;
    readonly status: "PASS" | "FAIL";
    readonly decision: "HOST_VALIDATED" | "HOST_REJECTED";
    readonly truth_gate: "PASS" | "FAIL";
    readonly findings: readonly unknown[];
    readonly clause_trace: readonly ScriptClauseTrace[];
  };
  readonly story_fidelity: {
    readonly approved_story_fidelity_version: 1;
    readonly status: "PASS" | "FAIL";
    readonly findings: readonly unknown[];
    readonly core_fact_refs_expected: readonly string[];
    readonly core_fact_refs_used: readonly string[];
    readonly human_editorial_takeaway_present: boolean;
    readonly prohibited_story_drift_present: boolean;
  };
}

export interface BuildExpressionRewriteEligibilityInput {
  readonly sourceScript: GroundedScriptDraft;
  readonly sourceReplay: TruthValidSourceScript;
  readonly approvedStory: ApprovedEditorialStoryV1FromHuman;
  readonly scriptFactPack: ScriptFactPack;
  readonly referenceMap: ScriptFactReferenceMap;
}

export interface ExpressionRewriteEligibility {
  readonly expression_rewrite_eligibility_version: 1;
  readonly status: "ELIGIBLE" | "NOT_ELIGIBLE";
  readonly source_truth: "PASS" | "FAIL";
  readonly source_grounded: boolean;
  readonly story_fidelity: "PASS" | "FAIL";
  readonly approved_story_current: boolean;
  readonly fact_trace_complete: boolean;
  readonly reason_codes: readonly string[];
  readonly repository: GroundedScriptDraft["repository"];
  readonly commit: string;
  readonly fact_ir_version: number;
  readonly approved_story_id: string;
  readonly approved_story_fingerprint_sha256: string;
  readonly source_script_fingerprint_sha256: string;
  readonly allowed_fact_refs: readonly string[];
  readonly internal_known_unknown_refs: readonly string[];
  readonly real_model_authorized: false;
  readonly eligibility_fingerprint_sha256: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function sourceScriptClauseId(
  segmentId: string,
  clauseIndex: number,
): string {
  return `source_clause:${segmentId}:${clauseIndex}`;
}

export function createSpokenTechnicalStyleProfileV1(): SpokenTechnicalStyleProfileV1 {
  return {
    spoken_technical_style_profile_version:
      SPOKEN_TECHNICAL_STYLE_PROFILE_VERSION,
    language: "zh-CN",
    audience: ["DEVELOPER", "VIBE_CODING_USER"],
    target_duration_seconds: { min: 60, max: 90 },
    tone: ["NATURAL", "DIRECT", "TECHNICAL_CONVERSATIONAL"],
    sentence_length: "SHORT",
    audit_language_density: "REDUCE",
    technical_jargon_load: "MINIMUM_NECESSARY",
    symbol_name_policy: "PRESERVE_EXACT",
    fact_ids_spoken: false,
    avoid_repeated_sentence_pattern: true,
    forbidden_registers: ["README", "AUDIT_REPORT"],
    truth_authority: "NONE",
  };
}

function artifactSha256(value: unknown): string {
  return sha256(`${JSON.stringify(value, null, 2)}\n`);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sameRepository(
  left: GroundedScriptDraft["repository"],
  right: GroundedScriptDraft["repository"],
): boolean {
  return stableJson(left) === stableJson(right);
}

export function buildExpressionRewriteEligibility(
  input: BuildExpressionRewriteEligibilityInput,
): ExpressionRewriteEligibility {
  const reasons: string[] = [];
  const { sourceScript, sourceReplay, approvedStory, scriptFactPack, referenceMap } =
    input;
  const expectedFactRefs = referenceMap.entries
    .filter((entry) => entry.role === "CORE_FACT")
    .map((entry) => entry.model_fact_ref);
  const technicalTrace = sourceReplay.validation.clause_trace.filter(
    (clause) => clause.statement_kind === "TECHNICAL_FACT",
  );
  const tracedFactRefs = technicalTrace.flatMap(
    (clause) => clause.supporting_fact_refs,
  );
  const sourceHashMatches =
    artifactSha256(sourceScript) === sourceReplay.persisted_draft_sha256;
  if (!sourceHashMatches) reasons.push("SOURCE_SCRIPT_FINGERPRINT_MISMATCH");

  let approvedStoryIntegrity = true;
  try {
    assertApprovedEditorialStoryV1FromHumanIntegrity(approvedStory);
  } catch {
    approvedStoryIntegrity = false;
    reasons.push("APPROVED_STORY_INTEGRITY_FAILED");
  }

  const identityMatches =
    sameRepository(sourceScript.repository, sourceReplay.repository) &&
    sameRepository(sourceScript.repository, approvedStory.repository) &&
    sameRepository(sourceScript.repository, scriptFactPack.repository) &&
    sameRepository(sourceScript.repository, referenceMap.repository) &&
    [
      sourceReplay.commit,
      approvedStory.commit,
      scriptFactPack.commit,
      referenceMap.commit,
    ].every((commit) => commit === sourceScript.commit) &&
    [
      sourceReplay.fact_ir_version,
      approvedStory.fact_ir_version,
      scriptFactPack.fact_ir_version,
      referenceMap.fact_ir_version,
    ].every((version) => version === sourceScript.fact_ir_version) &&
    sourceReplay.approved_angle_ref === sourceScript.approved_angle_ref &&
    approvedStory.story_id === sourceScript.approved_angle_ref &&
    scriptFactPack.approved_angle_ref === sourceScript.approved_angle_ref &&
    scriptFactPack.approved_angle_fingerprint_sha256 ===
      approvedStory.story_fingerprint_sha256;
  if (!identityMatches) reasons.push("FROZEN_IDENTITY_MISMATCH");

  const sourceTruth =
    sourceReplay.status === "TRUTH_PASS" &&
    sourceReplay.validation.status === "PASS" &&
    sourceReplay.validation.truth_gate === "PASS" &&
    sourceReplay.validation.findings.length === 0 &&
    sourceReplay.exact_script_text_changed === false;
  if (!sourceTruth) reasons.push("SOURCE_TRUTH_NOT_PASS");

  const referenceByModelRef = new Map(
    referenceMap.entries.map((entry) => [entry.model_fact_ref, entry]),
  );
  const sourceGrounded =
    expectedFactRefs.length > 0 &&
    new Set(expectedFactRefs).size === expectedFactRefs.length &&
    technicalTrace.length === expectedFactRefs.length &&
    technicalTrace.every(
      (clause) => {
        const modelRef = clause.supporting_fact_refs[0];
        const reference =
          modelRef === undefined ? undefined : referenceByModelRef.get(modelRef);
        return (
          clause.status === "FACT_TRACED" &&
          clause.supporting_fact_refs.length === 1 &&
          reference !== undefined &&
          stableJson(clause.canonical_fact_ids) ===
            stableJson([reference.canonical_fact_id]) &&
          clause.evidence_ids.length > 0 &&
          clause.evidence_ids.every((evidenceId) =>
            reference.evidence_ids.includes(evidenceId),
          )
        );
      },
    );
  if (!sourceGrounded) reasons.push("SOURCE_NOT_FULLY_GROUNDED");

  const factTraceComplete =
    new Set(tracedFactRefs).size === expectedFactRefs.length &&
    stableJson([...new Set(tracedFactRefs)].sort()) ===
      stableJson([...expectedFactRefs].sort()) &&
    stableJson([...sourceReplay.story_fidelity.core_fact_refs_used].sort()) ===
      stableJson([...expectedFactRefs].sort()) &&
    stableJson([...approvedStory.supporting_fact_ids].sort()) ===
      stableJson(
        referenceMap.entries
          .filter((entry) => entry.role === "CORE_FACT")
          .map((entry) => entry.canonical_fact_id)
          .sort(),
      );
  if (!factTraceComplete) reasons.push("SOURCE_FACT_TRACE_INCOMPLETE");

  const storyFidelity =
    sourceReplay.story_fidelity.status === "PASS" &&
    sourceReplay.story_fidelity.findings.length === 0 &&
    sourceReplay.story_fidelity.human_editorial_takeaway_present &&
    !sourceReplay.story_fidelity.prohibited_story_drift_present;
  if (!storyFidelity) reasons.push("SOURCE_STORY_FIDELITY_NOT_PASS");

  const storyCurrent =
    approvedStoryIntegrity &&
    approvedStory.status === "CURRENT" &&
    approvedStory.host_validation.status === "PASS" &&
    approvedStory.script_eligibility.contract_eligible;
  if (!storyCurrent) reasons.push("APPROVED_STORY_NOT_CURRENT");

  const receiptWithoutFingerprint = {
    expression_rewrite_eligibility_version:
      EXPRESSION_REWRITE_ELIGIBILITY_VERSION,
    status: reasons.length === 0 ? ("ELIGIBLE" as const) : ("NOT_ELIGIBLE" as const),
    source_truth: sourceTruth ? ("PASS" as const) : ("FAIL" as const),
    source_grounded: sourceGrounded,
    story_fidelity: storyFidelity ? ("PASS" as const) : ("FAIL" as const),
    approved_story_current: storyCurrent,
    fact_trace_complete: factTraceComplete,
    reason_codes: reasons,
    repository: sourceScript.repository,
    commit: sourceScript.commit,
    fact_ir_version: sourceScript.fact_ir_version,
    approved_story_id: approvedStory.story_id,
    approved_story_fingerprint_sha256: approvedStory.story_fingerprint_sha256,
    source_script_fingerprint_sha256: sourceReplay.persisted_draft_sha256,
    allowed_fact_refs: expectedFactRefs,
    internal_known_unknown_refs: scriptFactPack.known_unknowns.map(
      (unknown) => unknown.unknown_ref,
    ),
    real_model_authorized: false as const,
  };
  return {
    ...receiptWithoutFingerprint,
    eligibility_fingerprint_sha256: sha256(stableJson(receiptWithoutFingerprint)),
  };
}

export function buildGroundedExpressionRevision(
  input: BuildGroundedExpressionRevisionInput,
): GroundedExpressionRevisionV1 {
  if (input.eligibility.status !== "ELIGIBLE") {
    throw new Error("EXPRESSION_SOURCE_NOT_ELIGIBLE");
  }
  if (
    input.sourceScript.commit !== input.eligibility.commit ||
    input.sourceScript.approved_angle_ref !== input.eligibility.approved_story_id ||
    input.approvedStory.story_id !== input.eligibility.approved_story_id ||
    input.approvedStory.story_fingerprint_sha256 !==
      input.eligibility.approved_story_fingerprint_sha256
  ) {
    throw new Error("EXPRESSION_FROZEN_BINDING_MISMATCH");
  }
  const factRefs = [
    ...new Set(
      input.segments.flatMap((segment) =>
        segment.clauses.flatMap((clause) => clause.fact_refs),
      ),
    ),
  ];
  const revisionMetadata =
    input.revisionMetadata ??
    ({
      mode: "deterministic_offline_fixture" as const,
      synthetic_fixture: true as const,
      model_generated: false as const,
      semantic_operations: input.semanticOperations,
      paid_api_requests: 0 as const,
      real_model_requests: 0 as const,
      secret_reads: 0 as const,
      repository_executions: 0 as const,
    } satisfies GroundedExpressionRevisionMetadataV1);
  if (
    stableJson(revisionMetadata.semantic_operations) !==
    stableJson(input.semanticOperations)
  ) {
    throw new Error("EXPRESSION_REVISION_METADATA_OPERATION_MISMATCH");
  }
  const content = {
    grounded_expression_revision_version: GROUNDED_EXPRESSION_REVISION_VERSION,
    source_script_id: `script_${input.eligibility.source_script_fingerprint_sha256.slice(0, 24)}`,
    source_script_fingerprint_sha256:
      input.eligibility.source_script_fingerprint_sha256,
    approved_story_id: input.approvedStory.story_id,
    approved_story_fingerprint_sha256:
      input.approvedStory.story_fingerprint_sha256,
    repository: input.sourceScript.repository,
    commit: input.sourceScript.commit,
    fact_ir_version: input.sourceScript.fact_ir_version,
    language: "zh-CN" as const,
    style_profile: input.styleProfile,
    segments: input.segments,
    source_segment_mapping: input.sourceSegmentMapping,
    fact_refs: factRefs,
    known_unknowns: input.scriptFactPack.known_unknowns,
    revision_metadata: revisionMetadata,
  };
  const contentFingerprint = sha256(stableJson(content));
  const revisionWithoutFingerprint = {
    ...content,
    revision_id: `expression_revision_${contentFingerprint.slice(0, 24)}`,
  };
  return {
    ...revisionWithoutFingerprint,
    revision_fingerprint_sha256: sha256(stableJson(revisionWithoutFingerprint)),
  };
}

function boundedHostValidationInputs(
  input: ValidateGroundedExpressionRevisionInput,
): {
  readonly draft: GroundedScriptDraft;
  readonly contract: GroundedScriptContractInput;
  readonly factPack: GroundedFactPack;
  readonly canonical: CanonicalGroundedBriefArtifact;
} {
  const modelFacts = [
    ...input.scriptFactPack.core_facts,
    ...input.scriptFactPack.context_facts,
  ];
  const entityByLabel = new Map<string, GroundedEntity>();
  const entity = (label: string, kind: GroundedEntity["kind"]): GroundedEntity => {
    const current = entityByLabel.get(label);
    if (current !== undefined) return current;
    const built: GroundedEntity = {
      id: `expression_entity_${sha256(label).slice(0, 24)}`,
      kind,
      display_label: label,
      value: label,
      evidence_ids: [],
    };
    entityByLabel.set(label, built);
    return built;
  };
  const entryByRef = new Map(
    input.referenceMap.entries.map((entry) => [entry.model_fact_ref, entry]),
  );
  const facts: GroundedFact[] = modelFacts.flatMap((modelFact) => {
    const reference = entryByRef.get(modelFact.model_fact_ref);
    if (reference === undefined) return [];
    const subject = entity(modelFact.subject, "symbol");
    const object = entity(
      modelFact.object,
      modelFact.predicate === "THROWS_WHEN" ? "condition" : "symbol",
    );
    return [
      {
        id: reference.canonical_fact_id,
        fact_type: modelFact.fact_type,
        category: modelFact.category,
        subject_ref: subject.id,
        predicate: modelFact.predicate,
        object_ref: object.id,
        scope: modelFact.scope,
        evidence_ids: reference.evidence_ids,
        source_kind: "source_code",
        verification: { status: "verified", confidence: 1 },
        qualifiers: [],
        limitations: modelFact.limitations,
        provenance: {
          repository: {
            url: input.scriptFactPack.repository.url,
            commit_sha: input.scriptFactPack.commit,
          },
          extractor: "deterministic-evidence-to-fact-v2",
          evidence_ids: reference.evidence_ids,
        },
      },
    ];
  });
  const factPack: GroundedFactPack = {
    fact_ir_version: input.scriptFactPack.fact_ir_version,
    repository: input.scriptFactPack.repository,
    commit: input.scriptFactPack.commit,
    entities: [...entityByLabel.values()],
    facts,
    evidence_refs: [],
    unsupported_areas: input.scriptFactPack.known_unknowns.map((unknown) => ({
      id: unknown.unknown_ref,
      reason: unknown.statement,
      evidence_needed: unknown.evidence_needed,
    })),
    limitations: [
      ...new Set(modelFacts.flatMap((fact) => fact.limitations)),
    ],
  };
  // The frozen Host analyzer reads only brief.sections[].statements from this
  // bounded view. It is deliberately not persisted or represented as a new
  // Canonical Brief, and it contains no Fact outside ScriptFactPack v1.
  const canonical = {
    brief: {
      sections: [
        {
          statements: facts.map((fact) => {
            const modelFact = modelFacts.find(
              (candidate) =>
                entryByRef.get(candidate.model_fact_ref)?.canonical_fact_id ===
                fact.id,
            );
            return {
              fact_ids: [fact.id],
              text:
                modelFact === undefined
                  ? fact.predicate
                  : `${modelFact.subject} ${modelFact.predicate} ${modelFact.object}`,
            };
          }),
        },
      ],
    },
  } as unknown as CanonicalGroundedBriefArtifact;
  const styleProfile = {
    script_style_profile_version: 1 as const,
    language: "zh-CN" as const,
    audience: "TECHNICAL_CREATOR" as const,
    tone: "CLEAR_TECHNICAL" as const,
    sentence_length: "SHORT_TO_MEDIUM" as const,
    verbosity: "CONCISE" as const,
    spoken_rhythm: "NATURAL" as const,
    target_duration_seconds: { min: 60 as const, max: 90 as const },
    speech_rate: { unit: "CHARACTERS_PER_SECOND" as const, value: 4 as const },
    truth_authority: "NONE" as const,
  };
  const contract: GroundedScriptContractInput = {
    eligibility: {
      script_eligibility_version: 1,
      status: "ELIGIBLE",
      reason: "CURRENT_HOST_VALIDATED_HUMAN_CONFIRMED_STORY",
      fixture_only: false,
      real_model_authorized: false,
    },
    script_fact_pack: input.scriptFactPack,
    reference_map: input.referenceMap,
    model_input: {
      script_input_version: 1,
      repository: input.scriptFactPack.repository,
      commit: input.scriptFactPack.commit,
      fact_ir_version: input.scriptFactPack.fact_ir_version,
      approved_angle: {
        approved_angle_ref: input.approvedStory.story_id,
        title: input.approvedStory.title,
        editorial_thesis: input.approvedStory.editorial_thesis,
        known_caveats: input.approvedStory.known_caveats,
        source_kind: "HUMAN_COMPOSITION",
        human_confirmed: true,
      },
      script_fact_pack: input.scriptFactPack,
      style_profile: styleProfile,
      output_contract: {
        schema: "GroundedScriptDraft v1",
        structured_output_only: true,
        approved_angle_read_only: true,
        fact_discovery_forbidden: true,
        analogy_forbidden: true,
      },
      authorization: {
        mode: "OFFLINE_CONTRACT_FIXTURE",
        real_model_authorized: false,
      },
    },
    input_fingerprint_sha256: input.eligibility.eligibility_fingerprint_sha256,
  };
  const draft: GroundedScriptDraft = {
    script_version: 1,
    status: "GENERATED",
    repository: input.revision.repository,
    commit: input.revision.commit,
    fact_ir_version: input.scriptFactPack.fact_ir_version,
    approved_angle_ref: input.revision.approved_story_id,
    language: "zh-CN",
    target_duration_seconds: { min: 60, max: 90 },
    segments: input.revision.segments.flatMap((segment) =>
      segment.clauses.map((clause) => ({
        segment_id: clause.revision_clause_id,
        role: segment.role,
        text: clause.text,
        statement_kind: clause.statement_kind,
        supporting_fact_refs: clause.fact_refs,
        context_fact_refs: [],
        known_unknown_refs: clause.known_unknown_refs,
        approved_angle_ref: input.revision.approved_story_id,
      })),
    ),
    generation_metadata: {
      mode: "deterministic_offline_fixture",
      provider: "FAKE_DETERMINISTIC",
      model: null,
      paid_api_requests: 0,
      real_model_requests: 0,
      secret_reads: 0,
      repository_executions: 0,
    },
  };
  return { draft, contract, factPack, canonical };
}

const INTERNAL_TRUTH_BOUNDARIES: readonly InternalTruthBoundary[] = [
  "RUNTIME_EXECUTION_OR_ORDER",
  "DATA_FLOW",
  "FULL_PATH_OR_BRANCH_COVERAGE",
  "ALIAS_RESOLUTION",
  "DYNAMIC_OR_INDIRECT_CALL_TARGETS",
  "SECURITY_OR_SSRF_OR_ATTACK_PREVENTION",
  "DESIGN_INTENT",
  "CORRECTNESS_OR_RELIABILITY",
];

export function evaluateCaveatCoverage(
  revision: GroundedExpressionRevisionV1,
  scriptFactPack: ScriptFactPack,
): CaveatCoverageV1 {
  const spokenCaveats = revision.segments
    .flatMap((segment) => segment.clauses)
    .filter((clause) => clause.statement_kind === "CAVEAT")
    .map((clause) => clause.text);
  const caveatText = spokenCaveats.join(" ");
  const sourceBounded =
    /(?:只能|仅能|只)(?:确认|证明)[^。！？!?]*(?:源码|代码)|(?:源码|代码)[^。！？!?]*(?:不能证明|不证明|不代表)/i.test(
      caveatText,
    );
  const runtimeOrPathBounded =
    /(?:不能证明|不证明|不代表|并不意味着)[^。！？!?]*(?:所有|全部|完整)[^。！？!?]*(?:运行路径|执行路径|分支覆盖|运行时)/i.test(
      caveatText,
    );
  const coveredRiskClasses: InternalTruthBoundary[] = [];
  if (runtimeOrPathBounded) {
    coveredRiskClasses.push(
      "RUNTIME_EXECUTION_OR_ORDER",
      "FULL_PATH_OR_BRANCH_COVERAGE",
    );
  }
  const unknownsPreserved =
    stableJson(revision.known_unknowns) === stableJson(scriptFactPack.known_unknowns);
  const passed = sourceBounded && runtimeOrPathBounded && unknownsPreserved;
  return {
    caveat_coverage_version: CAVEAT_COVERAGE_VERSION,
    internal_known_unknowns: scriptFactPack.known_unknowns,
    spoken_caveats: spokenCaveats,
    covered_risk_classes: coveredRiskClasses,
    unspoken_internal_boundaries: INTERNAL_TRUTH_BOUNDARIES.filter(
      (boundary) => !coveredRiskClasses.includes(boundary),
    ),
    misleading_omission_risk: passed ? "LOW" : "HIGH",
    status: passed ? "PASS" : "FAIL",
  };
}

export function validateGroundedExpressionRevision(
  input: ValidateGroundedExpressionRevisionInput,
): GroundedExpressionValidationV1 {
  const findings: {
    code: string;
    revision_clause_id: string | null;
    details: string;
  }[] = [];
  const revisionWithoutFingerprint = { ...input.revision } as {
    revision_fingerprint_sha256?: string;
  };
  delete revisionWithoutFingerprint.revision_fingerprint_sha256;
  if (
    sha256(stableJson(revisionWithoutFingerprint)) !==
    input.revision.revision_fingerprint_sha256
  ) {
    findings.push({
      code: "EXPRESSION_REVISION_FINGERPRINT_MISMATCH",
      revision_clause_id: null,
      details: "The structured revision changed after its fingerprint was frozen.",
    });
  }
  if (input.eligibility.status !== "ELIGIBLE") {
    findings.push({
      code: "EXPRESSION_SOURCE_NOT_ELIGIBLE",
      revision_clause_id: null,
      details: "Truth-invalid source Scripts cannot enter the expression layer.",
    });
  }
  const frozenBindingMatches =
    input.revision.source_script_fingerprint_sha256 ===
      input.eligibility.source_script_fingerprint_sha256 &&
    input.revision.approved_story_id === input.approvedStory.story_id &&
    input.revision.approved_story_fingerprint_sha256 ===
      input.approvedStory.story_fingerprint_sha256 &&
    input.revision.commit === input.sourceScript.commit &&
    input.revision.fact_ir_version === input.sourceScript.fact_ir_version;
  if (!frozenBindingMatches) {
    findings.push({
      code: "EXPRESSION_FROZEN_BINDING_MISMATCH",
      revision_clause_id: null,
      details: "Revision identity must remain bound to the frozen Script and Story.",
    });
  }
  const sourceSegmentIds = input.sourceScript.segments.map(
    (segment) => segment.segment_id,
  );
  const mappingSourceIds = input.revision.source_segment_mapping.map(
    (mapping) => mapping.source_segment_id,
  );
  if (
    new Set(mappingSourceIds).size !== sourceSegmentIds.length ||
    stableJson([...mappingSourceIds].sort()) !==
      stableJson([...sourceSegmentIds].sort())
  ) {
    findings.push({
      code: "EXPRESSION_SOURCE_MAPPING_INCOMPLETE",
      revision_clause_id: null,
      details: "Every frozen source segment must be accounted for exactly once.",
    });
  }
  const revisionSegmentIds = new Set(
    input.revision.segments.map((segment) => segment.revision_segment_id),
  );
  if (revisionSegmentIds.size !== input.revision.segments.length) {
    findings.push({
      code: "EXPRESSION_REVISION_SEGMENT_ID_DUPLICATE",
      revision_clause_id: null,
      details: "Every revision segment ID must be unique.",
    });
  }
  const sourceClauseIds = new Set(
    input.sourceReplay.validation.clause_trace.map((clause) =>
      sourceScriptClauseId(clause.segment_id, clause.clause_index),
    ),
  );
  for (const mapping of input.revision.source_segment_mapping) {
    const exactSourceClausePrefix = `source_clause:${mapping.source_segment_id}:`;
    if (
      mapping.source_clause_ids.some(
        (clauseId) =>
          !sourceClauseIds.has(clauseId) ||
          !clauseId.startsWith(exactSourceClausePrefix),
      ) ||
      mapping.revision_segment_ids.some(
        (segmentId) => !revisionSegmentIds.has(segmentId),
      )
    ) {
      findings.push({
        code: "EXPRESSION_SOURCE_MAPPING_INVALID",
        revision_clause_id: null,
        details: `Invalid mapping for ${mapping.source_segment_id}.`,
      });
    }
    if (
      (mapping.disposition === "OMITTED_FOR_BREVITY" &&
        mapping.revision_segment_ids.length !== 0) ||
      (mapping.disposition !== "OMITTED_FOR_BREVITY" &&
        mapping.revision_segment_ids.length === 0)
    ) {
      findings.push({
        code: "EXPRESSION_SOURCE_MAPPING_DISPOSITION_INVALID",
        revision_clause_id: null,
        details: `Mapping disposition and revision targets disagree for ${mapping.source_segment_id}.`,
      });
    }
  }
  const revisionClauses = input.revision.segments.flatMap((segment) => {
    if (segment.text !== segment.clauses.map((clause) => clause.text).join("")) {
      findings.push({
        code: "EXPRESSION_SEGMENT_CLAUSE_TEXT_MISMATCH",
        revision_clause_id: null,
        details: `${segment.revision_segment_id} is not the exact concatenation of its clauses.`,
      });
    }
    return segment.clauses.map((clause) => ({ segment, clause }));
  });
  const revisionClauseIds = revisionClauses.map(
    ({ clause }) => clause.revision_clause_id,
  );
  if (new Set(revisionClauseIds).size !== revisionClauseIds.length) {
    findings.push({
      code: "EXPRESSION_REVISION_CLAUSE_ID_DUPLICATE",
      revision_clause_id: null,
      details: "Every revision clause ID must be unique.",
    });
  }
  for (const { segment, clause } of revisionClauses) {
    if (
      clause.source_clause_ids.length === 0 ||
      clause.source_clause_ids.some((clauseId) => !sourceClauseIds.has(clauseId)) ||
      clause.source_clause_ids.some((clauseId) => {
        const sourceSegmentId = clauseId.split(":")[1];
        const mapping = input.revision.source_segment_mapping.find(
          (candidate) => candidate.source_segment_id === sourceSegmentId,
        );
        return (
          mapping === undefined ||
          !mapping.revision_segment_ids.includes(segment.revision_segment_id)
        );
      })
    ) {
      findings.push({
        code: "EXPRESSION_CLAUSE_SOURCE_TRACE_INVALID",
        revision_clause_id: clause.revision_clause_id,
        details: "Every rewritten clause needs an exact frozen source-clause trace.",
      });
    }
    if (/\bfact_\d{3}\b/i.test(clause.text)) {
      findings.push({
        code: "MODEL_FACT_REFERENCE_SPOKEN",
        revision_clause_id: clause.revision_clause_id,
        details: "Model Fact references are internal trace metadata, not spoken copy.",
      });
    }
    const isBoundaryCaveat =
      clause.statement_kind === "CAVEAT" &&
      /(?:不能证明|不证明|不代表|并不意味着|无法证明|未证明)/i.test(clause.text);
    if (
      !isBoundaryCaveat &&
      /作者[^。！？!?]{0,32}(?:为了|意图|想要)|显然是为了|设计目的|旨在/i.test(
        clause.text,
      )
    ) {
      findings.push({
        code: "DESIGN_INTENT_UNSUPPORTED",
        revision_clause_id: clause.revision_clause_id,
        details: "Expression polish cannot infer the author's purpose or design intent.",
      });
    }
    if (
      /AI[^。！？!?]{0,48}(?:最常见|通常|普遍|往往|大多数)|(?:最常见|通常|普遍|往往)[^。！？!?]{0,48}AI/i.test(
        clause.text,
      )
    ) {
      findings.push({
        code: "EXTERNAL_GENERALIZATION_UNSUPPORTED",
        revision_clause_id: clause.revision_clause_id,
        details: "A local Story cannot be generalized into a claim about AI coding at large.",
      });
    }
    if (
      !isBoundaryCaveat &&
      /(?:让|使|保证|确保)[^。！？!?]{0,24}(?:请求|代码|系统)[^。！？!?]{0,16}(?:更安全|安全)|(?:更安全|防止攻击|防止\s*SSRF)/i.test(
        clause.text,
      )
    ) {
      findings.push({
        code: "SAFETY_OUTCOME_UNSUPPORTED",
        revision_clause_id: clause.revision_clause_id,
        details: "Authored calls and branches do not establish a safety outcome.",
      });
    }
    if (
      !isBoundaryCaveat &&
      /(?:保证|确保|必然|一定)[^。！？!?]{0,32}(?:正确|可靠|安全|成功|执行)/i.test(
        clause.text,
      )
    ) {
      findings.push({
        code: "GUARANTEE_UNSUPPORTED",
        revision_clause_id: clause.revision_clause_id,
        details: "Expression polish cannot add a guarantee.",
      });
    }
    if (
      !isBoundaryCaveat &&
      /(?:首个|唯一|革命性|前所未有)/i.test(clause.text)
    ) {
      findings.push({
        code: "NOVELTY_UNSUPPORTED",
        revision_clause_id: clause.revision_clause_id,
        details: "Novelty requires a separately authorized external Evidence layer.",
      });
    }
    if (
      !isBoundaryCaveat &&
      /(?:所有|全部|每次)[^。！？!?]{0,32}(?:都会|都能|必然|一定)/i.test(
        clause.text,
      )
    ) {
      findings.push({
        code: "UNIVERSAL_QUANTIFIER_UNSUPPORTED",
        revision_clause_id: clause.revision_clause_id,
        details: "Static authored Facts do not license a universal runtime claim.",
      });
    }
    if (
      !isBoundaryCaveat &&
      /(?:完全没有|绝不存在|没有任何)[^。！？!?]{0,24}(?:路径|调用|分支|问题)/i.test(
        clause.text,
      )
    ) {
      findings.push({
        code: "ABSENCE_CLAIM_UNSUPPORTED",
        revision_clause_id: clause.revision_clause_id,
        details: "Absence claims require complete search coverage.",
      });
    }
  }
  const allowedSemanticOperations = new Set<ExpressionSemanticOperation>([
    "SIMPLIFY",
    "COMPRESS",
    "REORDER",
    "MERGE",
    "NATURALIZE",
  ]);
  const allowedClauseOperations = new Set<ExpressionClauseRewriteOperation>([
    "PARAPHRASE",
    "MERGE",
    "COMPRESS",
    "REORDER",
    "EDITORIAL_POLISH",
  ]);
  if (
    input.revision.revision_metadata.semantic_operations.some(
      (operation) => !allowedSemanticOperations.has(operation),
    ) ||
    revisionClauses.some(
      ({ clause }) => !allowedClauseOperations.has(clause.rewrite_operation),
    )
  ) {
    findings.push({
      code: "FORBIDDEN_REWRITE_OPERATION",
      revision_clause_id: null,
      details:
        "EXPAND, STRENGTHEN, GENERALIZE, EXPLAIN_CAUSE, INVENT_PURPOSE, and NEW_TECHNICAL_CLAIM are forbidden.",
    });
  }
  const sourceKindBySegment = new Map(
    input.sourceScript.segments.map((segment) => [
      segment.segment_id,
      segment.statement_kind,
    ]),
  );
  if (
    input.revision.source_segment_mapping.some(
      (mapping) =>
        mapping.disposition === "OMITTED_FOR_BREVITY" &&
        ["TECHNICAL_FACT", "CAVEAT"].includes(
          sourceKindBySegment.get(mapping.source_segment_id) ?? "",
        ),
    )
  ) {
    findings.push({
      code: "MATERIAL_SOURCE_CLAUSE_OMITTED",
      revision_clause_id: null,
      details:
        "OMITTED_FOR_BREVITY cannot remove a technical Fact or the minimum Caveat coverage.",
    });
  }
  const allowedFactRefs = new Set(input.eligibility.allowed_fact_refs);
  const usedFactRefs = revisionClauses.flatMap(({ clause }) => clause.fact_refs);
  if (
    usedFactRefs.some((reference) => !allowedFactRefs.has(reference)) ||
    stableJson([...new Set(usedFactRefs)].sort()) !==
      stableJson([...allowedFactRefs].sort())
  ) {
    findings.push({
      code: "EXPRESSION_FACT_COVERAGE_CHANGED",
      revision_clause_id: null,
      details: "Expression revision must preserve the frozen 5/5 Fact set.",
    });
  }
  const sourceTechnicalByClause = new Map(
    input.sourceReplay.validation.clause_trace
      .filter((clause) => clause.statement_kind === "TECHNICAL_FACT")
      .map((clause) => [
        sourceScriptClauseId(clause.segment_id, clause.clause_index),
        clause.supporting_fact_refs,
      ]),
  );
  for (const { clause } of revisionClauses) {
    if (clause.statement_kind !== "TECHNICAL_FACT") continue;
    const authorizedRefs = [
      ...new Set(
        clause.source_clause_ids.flatMap(
          (sourceClauseId) => sourceTechnicalByClause.get(sourceClauseId) ?? [],
        ),
      ),
    ];
    if (
      clause.fact_refs.length !== 1 ||
      stableJson(clause.fact_refs) !== stableJson(authorizedRefs)
    ) {
      findings.push({
        code: "EXPRESSION_TECHNICAL_SOURCE_FACT_MISMATCH",
        revision_clause_id: clause.revision_clause_id,
        details: "A rewritten technical clause may use only the Fact of its source clause.",
      });
    }
  }

  const bounded = boundedHostValidationInputs(input);
  const hostValidation = validateGroundedScriptDraft(bounded);
  for (const finding of hostValidation.findings) {
    findings.push({
      code: finding.code,
      revision_clause_id: finding.segment_id,
      details: finding.details,
    });
  }
  const caveatCoverage = evaluateCaveatCoverage(
    input.revision,
    input.scriptFactPack,
  );
  if (caveatCoverage.status === "FAIL") {
    findings.push({
      code: "SPOKEN_CAVEAT_MINIMUM_COVERAGE_MISSING",
      revision_clause_id: null,
      details:
        "Internal Known Unknowns remain active, but the spoken copy omits the minimum source/runtime-path boundary needed to avoid a misleading reading.",
    });
  }
  const fullText = input.revision.segments.map((segment) => segment.text).join(" ");
  const humanEditorialTakeawayPresent =
    /AI/i.test(fullText) &&
    /(?:成功路径|快乐路径|happy\s*path)/i.test(fullText) &&
    /(?:失败路径|失败边界|边界条件)/i.test(fullText) &&
    /(?:检查|核对|继续看)/i.test(fullText);
  const prohibitedStoryDriftPresent =
    /\bSSRF\b|攻击|防攻击|全局架构|整个\s*Archify|渲染器|性能优化|AI\s*编码行业|AI\s*编程行业/i.test(
      fullText,
    );
  const storyFidelityStatus =
    humanEditorialTakeawayPresent && !prohibitedStoryDriftPresent
      ? "PASS"
      : "FAIL";
  if (storyFidelityStatus === "FAIL") {
    findings.push({
      code: "EXPRESSION_STORY_FIDELITY_FAIL",
      revision_clause_id: null,
      details:
        "The revision must preserve the Human takeaway and stay inside the approved local Story.",
    });
  }
  const hostTraceByClause = new Map(
    hostValidation.clause_trace.map((trace) => [trace.segment_id, trace]),
  );
  const clauseTrace: GroundedExpressionClauseTraceV1[] = revisionClauses.map(
    ({ segment, clause }) => {
      const hostTrace = hostTraceByClause.get(clause.revision_clause_id);
      return {
        revision_segment_id: segment.revision_segment_id,
        revision_clause_id: clause.revision_clause_id,
        source_clause_ids: clause.source_clause_ids,
        source_segment_ids: clause.source_clause_ids.map(
          (sourceClauseId) => sourceClauseId.split(":")[1] ?? "",
        ),
        rewrite_operation: clause.rewrite_operation,
        statement_kind: clause.statement_kind,
        fact_refs: hostTrace?.supporting_fact_refs ?? clause.fact_refs,
        canonical_fact_ids: hostTrace?.canonical_fact_ids ?? [],
        evidence_ids: hostTrace?.evidence_ids ?? [],
        host_alignment_methods: hostTrace?.alignment_methods ?? [],
        status: hostTrace?.status ?? "REJECTED",
      };
    },
  );
  const findingCodes = new Set(findings.map((finding) => finding.code));
  const gate = (codes: readonly string[]): "PASS" | "FAIL" =>
    codes.some((code) => findingCodes.has(code)) ? "FAIL" : "PASS";
  const truthBoundaryGates = {
    technical_accuracy: gate([
      "TECHNICAL_CLAUSE_UNGROUNDED",
      "COMPOUND_CLAIM_UNGROUNDED",
      "EXPRESSION_TECHNICAL_SOURCE_FACT_MISMATCH",
      "EXPRESSION_FACT_COVERAGE_CHANGED",
    ]),
    evidence_grounding: gate([
      "UNKNOWN_FACT_REFERENCE",
      "SCRIPT_REFERENCE_MAP_INVALID",
      "SCRIPT_REFERENCE_MAP_CROSS_COMMIT",
      "EXPRESSION_CLAUSE_SOURCE_TRACE_INVALID",
      "EXPRESSION_SOURCE_MAPPING_INVALID",
      "EXPRESSION_SOURCE_MAPPING_INCOMPLETE",
      "EXPRESSION_SOURCE_MAPPING_DISPOSITION_INVALID",
      "EXPRESSION_REVISION_SEGMENT_ID_DUPLICATE",
      "EXPRESSION_REVISION_CLAUSE_ID_DUPLICATE",
    ]),
    safety: gate(["SAFETY_OUTCOME_UNSUPPORTED"]),
    runtime_outcome: gate([
      "SAFETY_OUTCOME_UNSUPPORTED",
      "KNOWN_UNKNOWN_PROMOTION",
      "UNIVERSAL_QUANTIFIER_UNSUPPORTED",
    ]),
    design_intent: gate(["DESIGN_INTENT_UNSUPPORTED"]),
    guarantee: gate(["GUARANTEE_UNSUPPORTED", "SAFETY_OUTCOME_UNSUPPORTED"]),
    causality: gate(["TECHNICAL_CAUSALITY_UNSUPPORTED"]),
    external_comparison: gate([
      "EXTERNAL_COMPARISON_UNSUPPORTED",
      "EXTERNAL_GENERALIZATION_UNSUPPORTED",
    ]),
    novelty: gate(["NOVELTY_UNSUPPORTED"]),
    universal_quantifier: gate([
      "UNIVERSAL_QUANTIFIER_UNSUPPORTED",
      "KNOWN_UNKNOWN_PROMOTION",
    ]),
    absence: gate(["ABSENCE_CLAIM_UNSUPPORTED"]),
    symbol_name: gate(["SYMBOL_NAME_SEMANTIC_INFERENCE_UNSUPPORTED"]),
    known_unknown: gate([
      "UNKNOWN_KNOWN_UNKNOWN_REFERENCE",
      "KNOWN_UNKNOWN_PROMOTION",
      "SPOKEN_CAVEAT_MINIMUM_COVERAGE_MISSING",
    ]),
    story_fidelity: storyFidelityStatus,
    caveat_coverage: caveatCoverage.status,
  } as const;
  const passed = findings.length === 0;
  return {
    grounded_expression_validation_version:
      GROUNDED_EXPRESSION_VALIDATION_VERSION,
    status: passed ? "PASS" : "FAIL",
    truth_gate: passed ? "PASS" : "FAIL",
    findings,
    semantic_lock: {
      expression_semantic_lock_version: EXPRESSION_SEMANTIC_LOCK_VERSION,
      status: passed ? "PASS" : "FAIL",
      allowed_operations: ["SIMPLIFY", "COMPRESS", "REORDER", "MERGE", "NATURALIZE"],
      forbidden_operations: [
        "EXPAND",
        "STRENGTHEN",
        "GENERALIZE",
        "EXPLAIN_CAUSE",
        "INVENT_PURPOSE",
      ],
    },
    host_validation: hostValidation,
    clause_trace: clauseTrace,
    source_fact_coverage: `${input.eligibility.allowed_fact_refs.length}/${input.eligibility.allowed_fact_refs.length}`,
    rewritten_fact_coverage: `${new Set(usedFactRefs).size}/${input.eligibility.allowed_fact_refs.length}`,
    unsupported_technical_claims: hostValidation.findings.filter((finding) =>
      [
        "TECHNICAL_CLAUSE_UNGROUNDED",
        "COMPOUND_CLAIM_UNGROUNDED",
        "TECHNICAL_CAUSALITY_UNSUPPORTED",
        "SAFETY_OUTCOME_UNSUPPORTED",
      ].includes(finding.code),
    ).length,
    fact_trace: {
      expected: input.eligibility.allowed_fact_refs.length,
      traced: new Set(
        clauseTrace
          .filter(
            (clause) =>
              clause.statement_kind === "TECHNICAL_FACT" &&
              clause.status === "FACT_TRACED",
          )
          .flatMap((clause) => clause.fact_refs),
      ).size,
      missing_fact_refs: input.eligibility.allowed_fact_refs.filter(
        (reference) =>
          !clauseTrace.some(
            (clause) =>
              clause.status === "FACT_TRACED" &&
              clause.fact_refs.includes(reference),
          ),
      ),
      unsupported_technical_clauses: hostValidation.findings.filter((finding) =>
        [
          "TECHNICAL_CLAUSE_UNGROUNDED",
          "COMPOUND_CLAIM_UNGROUNDED",
          "TECHNICAL_CAUSALITY_UNSUPPORTED",
        ].includes(finding.code),
      ).length,
    },
    caveat_coverage: caveatCoverage,
    story_fidelity: {
      status: storyFidelityStatus,
      human_editorial_takeaway_present: humanEditorialTakeawayPresent,
      prohibited_story_drift_present: prohibitedStoryDriftPresent,
      core_fact_refs_expected: input.eligibility.allowed_fact_refs,
      core_fact_refs_used: [...new Set(usedFactRefs)],
    },
    truth_boundary_gates: truthBoundaryGates,
  };
}

function expressionTextFromScript(script: GroundedScriptDraft): string {
  return script.segments.map((segment) => segment.text).join(" ");
}

function expressionTextFromRevision(revision: GroundedExpressionRevisionV1): string {
  return revision.segments.map((segment) => segment.text).join(" ");
}

function auditPhraseCount(value: string): number {
  return (
    value.match(/直接静态调用表达式|本地抛出分支|需要说明的是|这些事实仅证明/g)
      ?.length ?? 0
  );
}

export function evaluateExpressionQuality(
  sourceScript: GroundedScriptDraft,
  revision: GroundedExpressionRevisionV1,
  validation: GroundedExpressionValidationV1,
  basis: ExpressionQualityReviewV1["basis"] =
    "QUALITATIVE_OFFLINE_SYNTHETIC_FIXTURE_NOT_TRUTH",
): ExpressionQualityReviewV1 {
  const sourceText = expressionTextFromScript(sourceScript);
  const revisionText = expressionTextFromRevision(revision);
  const sourceAuditPhrases = auditPhraseCount(sourceText);
  const revisionAuditPhrases = auditPhraseCount(revisionText);
  const sourceCaveat = sourceScript.segments
    .filter((segment) => segment.statement_kind === "CAVEAT")
    .map((segment) => segment.text)
    .join(" ");
  const revisionCaveat = revision.segments
    .flatMap((segment) => segment.clauses)
    .filter((clause) => clause.statement_kind === "CAVEAT")
    .map((clause) => clause.text)
    .join(" ");
  const caveatReduced =
    revisionCaveat.length > 0 && revisionCaveat.length < sourceCaveat.length;
  const sourceDimensions: ExpressionQualityDimensionsV1 = {
    spoken_naturalness: sourceAuditPhrases > 0 ? "MEDIUM" : "HIGH",
    sentence_variety: sourceAuditPhrases >= 3 ? "LOW" : "MEDIUM",
    audit_language_density: sourceAuditPhrases >= 3 ? "HIGH" : "MEDIUM",
    technical_jargon_load: sourceAuditPhrases >= 3 ? "HIGH" : "MEDIUM",
    narrative_flow: sourceAuditPhrases > 0 ? "MEDIUM" : "HIGH",
    caveat_burden: sourceCaveat.length > 50 ? "HIGH" : "MEDIUM",
    developer_relevance: /AI|Vibe\s*Coding/i.test(sourceText) ? "HIGH" : "MEDIUM",
    human_story_fidelity: "HIGH",
  };
  const revisionDimensions: ExpressionQualityDimensionsV1 = {
    spoken_naturalness:
      validation.truth_gate === "PASS" && revisionAuditPhrases === 0
        ? "HIGH"
        : "MEDIUM",
    sentence_variety: revisionAuditPhrases === 0 ? "HIGH" : "MEDIUM",
    audit_language_density: revisionAuditPhrases === 0 ? "LOW" : "MEDIUM",
    technical_jargon_load: "MEDIUM",
    narrative_flow: validation.story_fidelity.status === "PASS" ? "HIGH" : "LOW",
    caveat_burden: caveatReduced ? "LOW" : "MEDIUM",
    developer_relevance: /AI|Vibe\s*Coding/i.test(revisionText)
      ? "HIGH"
      : "MEDIUM",
    human_story_fidelity:
      validation.story_fidelity.status === "PASS" ? "HIGH" : "LOW",
  };
  const spokenImproved =
    sourceDimensions.spoken_naturalness === "MEDIUM" &&
    revisionDimensions.spoken_naturalness === "HIGH";
  const auditReduced = revisionAuditPhrases < sourceAuditPhrases;
  const storyPreserved = validation.story_fidelity.status === "PASS";
  return {
    expression_quality_review_version: EXPRESSION_QUALITY_REVIEW_VERSION,
    basis,
    source: { dimensions: sourceDimensions, overall: "PARTIAL" },
    revision: {
      dimensions: revisionDimensions,
      overall:
        validation.truth_gate === "PASS" &&
        spokenImproved &&
        auditReduced &&
        caveatReduced &&
        storyPreserved
          ? "PASS"
          : validation.truth_gate === "PASS"
            ? "PARTIAL"
            : "FAIL",
    },
    comparison: {
      spoken_naturalness: spokenImproved ? "IMPROVED" : "NOT_IMPROVED",
      audit_language_density: auditReduced ? "REDUCED" : "NOT_REDUCED",
      caveat_burden: caveatReduced ? "REDUCED" : "NOT_REDUCED",
      human_story_fidelity: storyPreserved ? "PRESERVED" : "NOT_PRESERVED",
    },
    truth_authority: "NONE",
    human_final_copy: false,
  };
}
