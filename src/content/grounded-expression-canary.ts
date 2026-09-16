import { createHash } from "node:crypto";

import {
  calculateOpenAICompatibleCost,
  OpenAICompatibleProviderError,
} from "../model/openai-compatible-provider.js";
import {
  buildOpenAICompatibleChatCompletionsRequestBody,
  type OpenAICompatibleChatCompletionsRequestBody,
} from "../model/openai-compatible-request.js";
import type { StructuredGenerationRequest } from "../model/provider.js";
import {
  createQwenMaxNonThinkingProvider,
  QWEN_MAX_BENCHMARK_PROFILE,
} from "../model/qwen-profile.js";
import { buildStructuredPrompt } from "../model/structured-prompt.js";
import { structuredOutputContract } from "../model/structured-output.js";
import type { SchemaRegistry } from "../schemas/registry.js";
import {
  buildGroundedExpressionRevision,
  createSpokenTechnicalStyleProfileV1,
  evaluateExpressionQuality,
  sourceScriptClauseId,
  validateGroundedExpressionRevision,
  type ExpressionQualityReviewV1,
  type ExpressionSemanticOperation,
  type ExpressionSourceSegmentMappingV1,
  type ExpressionRewriteEligibility,
  type GroundedExpressionRevisionV1,
  type GroundedExpressionSegmentV1,
  type GroundedExpressionValidationV1,
  type TruthValidSourceScript,
} from "./grounded-expression.js";
import type { ApprovedEditorialStoryV1FromHuman } from "./human-story-approval.js";
import type {
  GroundedScriptDraft,
  ScriptFactPack,
  ScriptFactReferenceMap,
} from "./grounded-script.js";

export const VS07_H_SCHEMA_ID =
  "internal:grounded-expression-model-draft:1" as const;
export const VS07_H_OUTPUT_TOKEN_HARD_LIMIT = 2_500 as const;
export const VS07_H_INPUT_TOKEN_HARD_LIMIT = 12_000 as const;
export const VS07_H_HARD_BUDGET_USD = 0.05 as const;
export const VS07_H_CONSERVATIVE_INPUT_USD_PER_MILLION = 2 as const;
export const VS07_H_CONSERVATIVE_OUTPUT_USD_PER_MILLION = 6 as const;
export const VS07_H_CONSERVATIVE_CHARACTERS_PER_TOKEN = 3 as const;
export const VS07_H_APPROVED_STORY_ID =
  "story_abf84e2074b11ede9aff2846" as const;
export const VS07_H_REPOSITORY_COMMIT =
  "c826e6c3a7abad19c0f3cd1ca57207d54b1ad8de" as const;

const EXPECTED_FACT_REFS = [
  "fact_001",
  "fact_002",
  "fact_003",
  "fact_004",
  "fact_005",
] as const;

export interface GroundedExpressionModelDraftPayload {
  readonly grounded_expression_model_draft_version: 1;
  readonly segments: readonly GroundedExpressionSegmentV1[];
  readonly source_segment_mapping: readonly ExpressionSourceSegmentMappingV1[];
  readonly semantic_operations: readonly ExpressionSemanticOperation[];
}

interface RealGroundedExpressionModelInput {
  readonly grounded_expression_model_input_version: 1;
  readonly source: {
    readonly source_script_id: string;
    readonly source_script_fingerprint_sha256: string;
    readonly segments: readonly {
      readonly segment_id: string;
      readonly source_clause_id: string;
      readonly role: GroundedScriptDraft["segments"][number]["role"];
      readonly text: string;
      readonly statement_kind: GroundedScriptDraft["segments"][number]["statement_kind"];
      readonly fact_refs: readonly string[];
      readonly known_unknown_refs: readonly string[];
    }[];
  };
  readonly approved_story: {
    readonly story_id: string;
    readonly story_fingerprint_sha256: string;
    readonly title: string;
    readonly editorial_thesis: string;
    readonly why_this_story: string;
    readonly target_audience: readonly string[];
  };
  readonly allowed_facts: ScriptFactPack["core_facts"];
  readonly known_unknowns: ScriptFactPack["known_unknowns"];
  readonly style_profile: ReturnType<typeof createSpokenTechnicalStyleProfileV1>;
  readonly semantic_lock: {
    readonly purpose: string;
    readonly allowed_semantic_operations: readonly ExpressionSemanticOperation[];
    readonly forbidden_semantic_operations: readonly [
      "EXPAND",
      "STRENGTHEN",
      "GENERALIZE",
      "EXPLAIN_CAUSE",
      "INVENT_PURPOSE",
    ];
    readonly source_clause_mapping_operations: readonly [
      "PARAPHRASE",
      "MERGE",
      "COMPRESS",
      "REORDER",
      "EDITORIAL_POLISH",
    ];
    readonly spoken_caveat_policy: string;
    readonly internal_truth_boundaries: readonly string[];
  };
  readonly output_contract: {
    readonly schema: "GroundedExpressionModelDraft v1";
    readonly structured_output_only: true;
    readonly every_revision_clause_requires_source_clause_ids: true;
    readonly technical_fact_refs_must_match_source_clause: true;
    readonly no_automatic_fact_fill: true;
  };
  readonly authorization: {
    readonly mode: "REAL_EXPRESSION_CANARY";
    readonly real_model_authorized: true;
    readonly max_paid_requests: 1;
    readonly max_http_attempts: 1;
    readonly retries: 0;
    readonly resampling: 0;
    readonly fallbacks: 0;
  };
}

export interface PreparedRealGroundedExpressionCanary {
  readonly canary_version: 1;
  readonly status: "READY" | "BUDGET_PREFLIGHT_BLOCKED" | "CONTAMINATION_BLOCKED";
  readonly execution_baseline_sha: string;
  readonly source_script_fingerprint_sha256: string;
  readonly approved_story_id: string;
  readonly approved_story_fingerprint_sha256: string;
  readonly eligibility: ExpressionRewriteEligibility;
  readonly routing: {
    readonly provider: "dashscope";
    readonly model: "qwen3.8-max";
    readonly mode: "NON_THINKING";
    readonly enable_thinking: false;
  };
  readonly model_input: RealGroundedExpressionModelInput;
  readonly structured_request: StructuredGenerationRequest;
  readonly request_preview: OpenAICompatibleChatCompletionsRequestBody;
  readonly request_body_sha256: string;
  readonly model_input_fingerprint_sha256: string;
  readonly contamination: {
    readonly reference_contamination_count: number;
    readonly findings: readonly string[];
    readonly forbidden_sources_present: false | true;
    readonly unselected_fact_refs_present: false | true;
    readonly canonical_fact_ids_present: false | true;
    readonly evidence_ids_present: false | true;
  };
  readonly budget: {
    readonly status: "PASS" | "BLOCKED";
    readonly hard_budget_usd: 0.05;
    readonly conservative_input_usd_per_million: 2;
    readonly conservative_output_usd_per_million: 6;
    readonly request_body_characters: number;
    readonly conservative_request_input_token_estimate: number;
    readonly input_token_hard_limit: 12000;
    readonly output_token_hard_limit: 2500;
    readonly worst_case_cost_usd: number;
    readonly pricing_basis: string;
    readonly pricing_sources: readonly string[];
  };
}

export interface ValidatedRealGroundedExpression {
  readonly revision: GroundedExpressionRevisionV1;
  readonly validation: GroundedExpressionValidationV1;
  readonly quality: ExpressionQualityReviewV1 | null;
  readonly repair_actions: readonly string[];
  readonly would_publish: "YES" | "MAYBE" | "NO";
  readonly canary_verdict:
    | "GROUNDED_EXPRESSION_CANARY_PASS"
    | "GROUNDED_EXPRESSION_CANARY_PARTIAL"
    | "GROUNDED_EXPRESSION_CANARY_FAIL";
}

interface FailureReceipt {
  readonly failure_code: string;
  readonly paid_requests: 0 | 1;
  readonly http_attempts: 0 | 1;
  readonly retries: 0;
  readonly resampling: 0;
  readonly fallbacks: 0;
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
  readonly finish_reason: string | null;
  readonly truncated: boolean | null;
  readonly duration_ms: number;
  readonly actual_cost_usd: number | null;
  readonly secret_reads: 1;
  readonly secret_exposure: 0;
  readonly repository_executions: 0;
}

export type RealGroundedExpressionCanaryResult =
  | ({
      readonly status: "COMPLETED";
      readonly raw_output: string;
      readonly generation: {
        readonly provider: "dashscope";
        readonly model: "qwen3.8-max";
        readonly mode: "NON_THINKING";
        readonly enable_thinking: false;
        readonly paid_requests: 1;
        readonly http_attempts: 1;
        readonly retries: 0;
        readonly resampling: 0;
        readonly fallbacks: 0;
        readonly input_tokens: number;
        readonly output_tokens: number;
        readonly finish_reason: string | null;
        readonly truncated: false;
        readonly duration_ms: number;
        readonly actual_cost_usd: number;
        readonly secret_reads: 1;
        readonly secret_exposure: 0;
        readonly repository_executions: 0;
        readonly request_body_sha256: string;
      };
    } & ValidatedRealGroundedExpression)
  | {
      readonly status: "FAIL_CLOSED";
      readonly raw_output: string;
      readonly failure: FailureReceipt;
    };

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

function sha256(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(value)), "utf8")
    .digest("hex");
}

function money(value: number): number {
  return Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;
}

function assertFrozenInputs(args: {
  readonly eligibility: ExpressionRewriteEligibility;
  readonly sourceScript: GroundedScriptDraft;
  readonly sourceReplay: TruthValidSourceScript;
  readonly approvedStory: ApprovedEditorialStoryV1FromHuman;
  readonly scriptFactPack: ScriptFactPack;
  readonly referenceMap: ScriptFactReferenceMap;
}): void {
  if (
    args.eligibility.status !== "ELIGIBLE" ||
    args.eligibility.source_truth !== "PASS" ||
    !args.eligibility.source_grounded ||
    args.eligibility.story_fidelity !== "PASS" ||
    !args.eligibility.fact_trace_complete ||
    args.sourceReplay.status !== "TRUTH_PASS" ||
    args.sourceReplay.validation.truth_gate !== "PASS"
  ) {
    throw new Error("VS07_H_EXPRESSION_SOURCE_NOT_ELIGIBLE");
  }
  if (
    args.approvedStory.story_id !== VS07_H_APPROVED_STORY_ID ||
    args.sourceScript.approved_angle_ref !== VS07_H_APPROVED_STORY_ID ||
    args.sourceScript.commit !== VS07_H_REPOSITORY_COMMIT ||
    args.approvedStory.commit !== VS07_H_REPOSITORY_COMMIT ||
    args.scriptFactPack.commit !== VS07_H_REPOSITORY_COMMIT ||
    args.referenceMap.commit !== VS07_H_REPOSITORY_COMMIT ||
    args.sourceReplay.commit !== VS07_H_REPOSITORY_COMMIT ||
    args.sourceScript.fact_ir_version !== 2 ||
    args.scriptFactPack.fact_ir_version !== 2 ||
    args.referenceMap.fact_ir_version !== 2 ||
    args.sourceReplay.fact_ir_version !== 2 ||
    args.eligibility.source_script_fingerprint_sha256 !==
      args.sourceReplay.persisted_draft_sha256 ||
    args.eligibility.approved_story_fingerprint_sha256 !==
      args.approvedStory.story_fingerprint_sha256
  ) {
    throw new Error("VS07_H_FROZEN_BINDING_MISMATCH");
  }
  const factRefs = args.scriptFactPack.core_facts.map(
    (fact) => fact.model_fact_ref,
  );
  if (
    args.scriptFactPack.context_facts.length !== 0 ||
    JSON.stringify(factRefs) !== JSON.stringify(EXPECTED_FACT_REFS) ||
    JSON.stringify(args.eligibility.allowed_fact_refs) !==
      JSON.stringify(EXPECTED_FACT_REFS) ||
    args.referenceMap.entries.length !== EXPECTED_FACT_REFS.length ||
    args.referenceMap.entries.some(
      (entry, index) => entry.model_fact_ref !== EXPECTED_FACT_REFS[index],
    )
  ) {
    throw new Error("VS07_H_FACT_SCOPE_DRIFT");
  }
}

const EXPRESSION_INSTRUCTIONS = [
  "You are performing Grounded Generative Expression only. Truth, Facts, Story, and Evidence are frozen by the Host.",
  "Rewrite the supplied truth-valid Chinese script into a natural, direct, technical-conversational 60-90 second spoken draft.",
  "You may only SIMPLIFY, COMPRESS, REORDER, MERGE, and NATURALIZE. Never EXPAND, STRENGTHEN, GENERALIZE, EXPLAIN_CAUSE, or INVENT_PURPOSE.",
  "Every revision clause must cite one or more exact source_clause_ids. A TECHNICAL_FACT clause must use only the fact_ref carried by its cited source technical clause.",
  "Keep fact_### and gap_* references in JSON metadata only; never speak them.",
  "CALLS proves one direct static call expression only. THROWS_WHEN proves one authored local throw branch only.",
  "Do not add runtime execution, runtime order, data flow, full branch coverage, alias resolution, dynamic call targets, safety, SSRF, attack prevention, correctness, reliability, performance, guarantees, causality, novelty, external comparisons, or author intent.",
  "Preserve symbol names exactly, including checkedFetch, resolveRequestTarget, requestPinned, Date.now(), deadline, location, redirects, and response.ok.",
  "Keep the minimum natural caveat needed to prevent readers from treating static source facts as complete runtime proof. Internal Known Unknown boundaries remain active even when not all are spoken.",
  "Preserve the Human editorial takeaway: AI writing a happy path does not finish the work; failure paths and boundary conditions still deserve inspection.",
  "If you omit a source segment for brevity, mark it OMITTED_FOR_BREVITY in source_segment_mapping. Do not replace an omitted Fact with invented prose.",
  "Return exactly one GroundedExpressionModelDraft v1 JSON object. No Markdown and no commentary.",
].join("\n");

function contaminationAudit(serialized: string): PreparedRealGroundedExpressionCanary["contamination"] {
  const checks = [
    ["CANONICAL_FACT_ID", /fact_(?:call|branch)_archify/i],
    ["EVIDENCE_ID", /evidence_(?:call|branch)_archify/i],
    ["UNSELECTED_FACT", /(?:^|[^A-Za-z0-9_])F[23](?:[^A-Za-z0-9_]|$)/],
    ["ANGLE_004", /angle-004/i],
    ["VS07_G_SYNTHETIC_ARTIFACT", /grounded-expression-revision-v1\.synthetic/i],
    ["VS07_G_SYNTHETIC_WORDING", /先别看宏大架构，我们只看 checkedFetch/i],
    ["HISTORICAL_FAILED_CANDIDATE", /historical failed candidate/i],
  ] as const;
  const findings = checks
    .filter(([, pattern]) => pattern.test(serialized))
    .map(([code]) => code);
  return {
    reference_contamination_count: findings.length,
    findings,
    forbidden_sources_present: findings.some((finding) =>
      [
        "ANGLE_004",
        "VS07_G_SYNTHETIC_ARTIFACT",
        "VS07_G_SYNTHETIC_WORDING",
        "HISTORICAL_FAILED_CANDIDATE",
      ].includes(finding),
    ),
    unselected_fact_refs_present: findings.includes("UNSELECTED_FACT"),
    canonical_fact_ids_present: findings.includes("CANONICAL_FACT_ID"),
    evidence_ids_present: findings.includes("EVIDENCE_ID"),
  };
}

export function buildRealGroundedExpressionCanaryPreflight(args: {
  readonly eligibility: ExpressionRewriteEligibility;
  readonly sourceScript: GroundedScriptDraft;
  readonly sourceReplay: TruthValidSourceScript;
  readonly approvedStory: ApprovedEditorialStoryV1FromHuman;
  readonly scriptFactPack: ScriptFactPack;
  readonly referenceMap: ScriptFactReferenceMap;
  readonly executionBaselineSha: string;
}): PreparedRealGroundedExpressionCanary {
  assertFrozenInputs(args);
  if (!/^[0-9a-f]{40}$/.test(args.executionBaselineSha)) {
    throw new Error("VS07_H_EXECUTION_BASELINE_INVALID");
  }
  const styleProfile = createSpokenTechnicalStyleProfileV1();
  const modelInput: RealGroundedExpressionModelInput = {
    grounded_expression_model_input_version: 1,
    source: {
      source_script_id: `script_${args.eligibility.source_script_fingerprint_sha256.slice(0, 24)}`,
      source_script_fingerprint_sha256:
        args.eligibility.source_script_fingerprint_sha256,
      segments: args.sourceScript.segments.map((segment) => ({
        segment_id: segment.segment_id,
        source_clause_id: sourceScriptClauseId(segment.segment_id, 0),
        role: segment.role,
        text: segment.text,
        statement_kind: segment.statement_kind,
        fact_refs: segment.supporting_fact_refs,
        known_unknown_refs: segment.known_unknown_refs,
      })),
    },
    approved_story: {
      story_id: args.approvedStory.story_id,
      story_fingerprint_sha256: args.approvedStory.story_fingerprint_sha256,
      title: args.approvedStory.title,
      editorial_thesis: args.approvedStory.editorial_thesis,
      why_this_story: args.approvedStory.why_this_story,
      target_audience: args.approvedStory.target_audience,
    },
    allowed_facts: args.scriptFactPack.core_facts,
    known_unknowns: args.scriptFactPack.known_unknowns,
    style_profile: styleProfile,
    semantic_lock: {
      purpose: "Improve how the same frozen truth is spoken without reopening what is true.",
      allowed_semantic_operations: [
        "SIMPLIFY",
        "COMPRESS",
        "REORDER",
        "MERGE",
        "NATURALIZE",
      ],
      forbidden_semantic_operations: [
        "EXPAND",
        "STRENGTHEN",
        "GENERALIZE",
        "EXPLAIN_CAUSE",
        "INVENT_PURPOSE",
      ],
      source_clause_mapping_operations: [
        "PARAPHRASE",
        "MERGE",
        "COMPRESS",
        "REORDER",
        "EDITORIAL_POLISH",
      ],
      spoken_caveat_policy:
        "Compress only to the minimum needed to prevent a materially misleading runtime reading; every unspoken boundary remains active internally.",
      internal_truth_boundaries: [
        "runtime execution or order",
        "data flow",
        "full path or branch coverage",
        "alias resolution",
        "dynamic or indirect call targets",
        "security, SSRF, or attack prevention",
        "design intent",
        "correctness or reliability",
      ],
    },
    output_contract: {
      schema: "GroundedExpressionModelDraft v1",
      structured_output_only: true,
      every_revision_clause_requires_source_clause_ids: true,
      technical_fact_refs_must_match_source_clause: true,
      no_automatic_fact_fill: true,
    },
    authorization: {
      mode: "REAL_EXPRESSION_CANARY",
      real_model_authorized: true,
      max_paid_requests: 1,
      max_http_attempts: 1,
      retries: 0,
      resampling: 0,
      fallbacks: 0,
    },
  };
  const modelInputFingerprint = sha256(modelInput);
  const structuredRequest: StructuredGenerationRequest = {
    stage: "content",
    schemaId: VS07_H_SCHEMA_ID,
    systemInstructions: EXPRESSION_INSTRUCTIONS,
    untrustedRepositoryContext: [],
    untrustedRepositorySignals: modelInput as unknown as Readonly<
      Record<string, unknown>
    >,
    signalSerialization: "compact",
    repositoryReadReceipt: {
      highestScope: 0,
      filesConsidered: [],
      filesRead: [],
    },
    maxOutputTokens: VS07_H_OUTPUT_TOKEN_HARD_LIMIT,
    cacheKey: `vs07-h:${modelInputFingerprint}`,
  };
  const outputContract = structuredOutputContract(structuredRequest.schemaId);
  if (outputContract === null) {
    throw new Error("VS07_H_STRUCTURED_OUTPUT_CONTRACT_MISSING");
  }
  const prompt = buildStructuredPrompt(structuredRequest, outputContract.schema);
  const requestPreview = buildOpenAICompatibleChatCompletionsRequestBody({
    model: QWEN_MAX_BENCHMARK_PROFILE.model,
    enableThinking: false,
    prompt,
    maxOutputTokens: VS07_H_OUTPUT_TOKEN_HARD_LIMIT,
  });
  const requestBody = JSON.stringify(requestPreview);
  const estimatedInputTokens = Math.ceil(
    requestBody.length / VS07_H_CONSERVATIVE_CHARACTERS_PER_TOKEN,
  );
  if (estimatedInputTokens > VS07_H_INPUT_TOKEN_HARD_LIMIT) {
    throw new Error("VS07_H_INPUT_TOKEN_HARD_LIMIT_EXCEEDED");
  }
  const worstCaseCost = money(
    (VS07_H_INPUT_TOKEN_HARD_LIMIT *
      VS07_H_CONSERVATIVE_INPUT_USD_PER_MILLION +
      VS07_H_OUTPUT_TOKEN_HARD_LIMIT *
        VS07_H_CONSERVATIVE_OUTPUT_USD_PER_MILLION) /
      1_000_000,
  );
  const budgetStatus =
    worstCaseCost <= VS07_H_HARD_BUDGET_USD ? "PASS" : "BLOCKED";
  const contamination = contaminationAudit(requestBody);
  const status =
    contamination.reference_contamination_count > 0
      ? "CONTAMINATION_BLOCKED"
      : budgetStatus === "PASS"
        ? "READY"
        : "BUDGET_PREFLIGHT_BLOCKED";
  return {
    canary_version: 1,
    status,
    execution_baseline_sha: args.executionBaselineSha,
    source_script_fingerprint_sha256:
      args.eligibility.source_script_fingerprint_sha256,
    approved_story_id: args.approvedStory.story_id,
    approved_story_fingerprint_sha256:
      args.approvedStory.story_fingerprint_sha256,
    eligibility: args.eligibility,
    routing: {
      provider: "dashscope",
      model: "qwen3.8-max",
      mode: "NON_THINKING",
      enable_thinking: false,
    },
    model_input: modelInput,
    structured_request: structuredRequest,
    request_preview: requestPreview,
    request_body_sha256: sha256(JSON.parse(requestBody)),
    model_input_fingerprint_sha256: modelInputFingerprint,
    contamination,
    budget: {
      status: budgetStatus,
      hard_budget_usd: VS07_H_HARD_BUDGET_USD,
      conservative_input_usd_per_million:
        VS07_H_CONSERVATIVE_INPUT_USD_PER_MILLION,
      conservative_output_usd_per_million:
        VS07_H_CONSERVATIVE_OUTPUT_USD_PER_MILLION,
      request_body_characters: requestBody.length,
      conservative_request_input_token_estimate: estimatedInputTokens,
      input_token_hard_limit: VS07_H_INPUT_TOKEN_HARD_LIMIT,
      output_token_hard_limit: VS07_H_OUTPUT_TOKEN_HARD_LIMIT,
      worst_case_cost_usd: worstCaseCost,
      pricing_basis: "official-qwen3.8-max-conservative-singapore-2026-09-03",
      pricing_sources: [
        "https://www.alibabacloud.com/help/en/model-studio/qwen3-8-max",
        "https://www.alibabacloud.com/help/en/model-studio/model-pricing",
      ],
    },
  };
}

function wouldPublish(
  quality: ExpressionQualityReviewV1,
  validation: GroundedExpressionValidationV1,
): "YES" | "MAYBE" | "NO" {
  if (validation.truth_gate !== "PASS") return "NO";
  const dimensions = quality.revision.dimensions;
  if (
    dimensions.spoken_naturalness === "HIGH" &&
    dimensions.audit_language_density === "LOW" &&
    dimensions.caveat_burden !== "HIGH" &&
    dimensions.narrative_flow === "HIGH" &&
    dimensions.human_story_fidelity === "HIGH"
  ) {
    return "YES";
  }
  return "MAYBE";
}

export function validateRealGroundedExpressionModelDraft(args: {
  readonly modelDraft: GroundedExpressionModelDraftPayload;
  readonly preflight: PreparedRealGroundedExpressionCanary;
  readonly sourceScript: GroundedScriptDraft;
  readonly sourceReplay: TruthValidSourceScript;
  readonly approvedStory: ApprovedEditorialStoryV1FromHuman;
  readonly scriptFactPack: ScriptFactPack;
  readonly referenceMap: ScriptFactReferenceMap;
  readonly schemas: SchemaRegistry;
}): ValidatedRealGroundedExpression {
  const revision = buildGroundedExpressionRevision({
    eligibility: args.preflight.eligibility,
    sourceScript: args.sourceScript,
    approvedStory: args.approvedStory,
    scriptFactPack: args.scriptFactPack,
    styleProfile: args.preflight.model_input.style_profile,
    segments: args.modelDraft.segments,
    sourceSegmentMapping: args.modelDraft.source_segment_mapping,
    semanticOperations: args.modelDraft.semantic_operations,
    revisionMetadata: {
      mode: "real_model_canary",
      synthetic_fixture: false,
      model_generated: true,
      provider: "dashscope",
      model: "qwen3.8-max",
      enable_thinking: false,
      semantic_operations: args.modelDraft.semantic_operations,
      paid_api_requests: 1,
      real_model_requests: 1,
      secret_reads: 1,
      repository_executions: 0,
    },
  });
  args.schemas.assert("GroundedExpressionRevision", revision);
  const validation = validateGroundedExpressionRevision({
    revision,
    eligibility: args.preflight.eligibility,
    sourceScript: args.sourceScript,
    sourceReplay: args.sourceReplay,
    approvedStory: args.approvedStory,
    scriptFactPack: args.scriptFactPack,
    referenceMap: args.referenceMap,
  });
  args.schemas.assert("GroundedExpressionValidation", validation);
  const quality =
    validation.truth_gate === "PASS"
      ? evaluateExpressionQuality(
          args.sourceScript,
          revision,
          validation,
          "QUALITATIVE_HOST_REVIEW_REAL_MODEL_OUTPUT_NOT_TRUTH",
        )
      : null;
  if (quality !== null) args.schemas.assert("ExpressionQualityReview", quality);
  const publish = quality === null ? "NO" : wouldPublish(quality, validation);
  const canaryVerdict =
    validation.truth_gate !== "PASS"
      ? "GROUNDED_EXPRESSION_CANARY_FAIL"
      : validation.fact_trace.traced === validation.fact_trace.expected &&
          validation.story_fidelity.status === "PASS" &&
          validation.caveat_coverage.status === "PASS" &&
          quality !== null &&
          quality.revision.dimensions.spoken_naturalness === "HIGH" &&
          quality.revision.dimensions.audit_language_density === "LOW" &&
          quality.revision.dimensions.caveat_burden !== "HIGH" &&
          publish === "YES"
        ? "GROUNDED_EXPRESSION_CANARY_PASS"
        : "GROUNDED_EXPRESSION_CANARY_PARTIAL";
  return {
    revision,
    validation,
    quality,
    repair_actions: [],
    would_publish: publish,
    canary_verdict: canaryVerdict,
  };
}

function safeFailureCode(error: unknown): string {
  if (error instanceof OpenAICompatibleProviderError) return error.code;
  if (error instanceof Error && /^VS07_H_[A-Z0-9_]+$/.test(error.message)) {
    return error.message;
  }
  return "VS07_H_UNKNOWN_FAILURE";
}

export async function executeRealGroundedExpressionCanary(input: {
  readonly preflight: PreparedRealGroundedExpressionCanary;
  readonly sourceScript: GroundedScriptDraft;
  readonly sourceReplay: TruthValidSourceScript;
  readonly approvedStory: ApprovedEditorialStoryV1FromHuman;
  readonly scriptFactPack: ScriptFactPack;
  readonly referenceMap: ScriptFactReferenceMap;
  readonly schemas: SchemaRegistry;
  readonly readSecret: (name: "DASHSCOPE_API_KEY") => string | undefined;
  readonly fetch: typeof fetch;
  readonly now?: () => number;
}): Promise<RealGroundedExpressionCanaryResult> {
  if (
    input.preflight.status !== "READY" ||
    input.preflight.budget.status !== "PASS" ||
    input.preflight.contamination.reference_contamination_count !== 0
  ) {
    throw new Error("VS07_H_PREFLIGHT_BLOCKED");
  }
  const now = input.now ?? Date.now;
  const startedAt = now();
  const secret = input.readSecret("DASHSCOPE_API_KEY");
  if (secret === undefined || secret.length === 0) {
    return {
      status: "FAIL_CLOSED",
      raw_output: "",
      failure: {
        failure_code: "DASHSCOPE_API_KEY_NOT_CONFIGURED",
        paid_requests: 0,
        http_attempts: 0,
        retries: 0,
        resampling: 0,
        fallbacks: 0,
        input_tokens: null,
        output_tokens: null,
        finish_reason: null,
        truncated: null,
        duration_ms: now() - startedAt,
        actual_cost_usd: null,
        secret_reads: 1,
        secret_exposure: 0,
        repository_executions: 0,
      },
    };
  }
  let forwardingCalls = 0;
  let capturedRawOutput = "";
  const expectedBody = JSON.stringify(input.preflight.request_preview);
  const auditedFetch: typeof fetch = async (url, init) => {
    if (forwardingCalls >= 1) {
      throw new Error("VS07_H_SECOND_HTTP_ATTEMPT_FORBIDDEN");
    }
    if (
      String(url) !==
        "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions" ||
      String(init?.body) !== expectedBody ||
      sha256(JSON.parse(String(init?.body))) !==
        input.preflight.request_body_sha256
    ) {
      throw new Error("VS07_H_ACTUAL_REQUEST_DRIFT");
    }
    forwardingCalls += 1;
    const response = await input.fetch(url, init);
    try {
      const envelope = (await response.clone().json()) as {
        choices?: readonly { message?: { content?: unknown } }[];
      };
      const content = envelope.choices?.[0]?.message?.content;
      if (typeof content === "string") capturedRawOutput = content;
    } catch {
      // Provider validation owns the envelope; this clone only preserves raw text.
    }
    return response;
  };
  try {
    const provider = createQwenMaxNonThinkingProvider({
      environment: { DASHSCOPE_API_KEY: secret },
      fetch: auditedFetch,
    });
    const modelResult =
      await provider.generateStructured<GroundedExpressionModelDraftPayload>(
        input.preflight.structured_request,
      );
    if (
      modelResult.provider !== "dashscope" ||
      modelResult.model !== "qwen3.8-max" ||
      modelResult.requestConfiguration?.thinking !== "disabled" ||
      modelResult.networkCalls !== 1 ||
      forwardingCalls !== 1 ||
      modelResult.usage.inputTokens > VS07_H_INPUT_TOKEN_HARD_LIMIT ||
      modelResult.usage.outputTokens > VS07_H_OUTPUT_TOKEN_HARD_LIMIT
    ) {
      throw new Error("VS07_H_EXECUTION_IDENTITY_OR_CEILING_VIOLATION");
    }
    const cost = calculateOpenAICompatibleCost(modelResult.usage, provider.pricing);
    if (cost.totalCost > VS07_H_HARD_BUDGET_USD) {
      throw new Error("VS07_H_ACTUAL_BUDGET_EXCEEDED");
    }
    const validated = validateRealGroundedExpressionModelDraft({
      modelDraft: modelResult.value,
      preflight: input.preflight,
      sourceScript: input.sourceScript,
      sourceReplay: input.sourceReplay,
      approvedStory: input.approvedStory,
      scriptFactPack: input.scriptFactPack,
      referenceMap: input.referenceMap,
      schemas: input.schemas,
    });
    return {
      status: "COMPLETED",
      raw_output: modelResult.rawOutput ?? capturedRawOutput,
      ...validated,
      repair_actions: modelResult.context.repairActions,
      generation: {
        provider: "dashscope",
        model: "qwen3.8-max",
        mode: "NON_THINKING",
        enable_thinking: false,
        paid_requests: 1,
        http_attempts: 1,
        retries: 0,
        resampling: 0,
        fallbacks: 0,
        input_tokens: modelResult.usage.inputTokens,
        output_tokens: modelResult.usage.outputTokens,
        finish_reason: modelResult.finishReason ?? null,
        truncated: false,
        duration_ms: now() - startedAt,
        actual_cost_usd: cost.totalCost,
        secret_reads: 1,
        secret_exposure: 0,
        repository_executions: 0,
        request_body_sha256: input.preflight.request_body_sha256,
      },
    };
  } catch (error) {
    const providerError =
      error instanceof OpenAICompatibleProviderError ? error : null;
    const usage = providerError?.telemetry?.usage;
    const actualCost =
      usage === undefined
        ? null
        : calculateOpenAICompatibleCost(usage, {
            currency: "USD",
            inputCacheHitUsdPerMillion:
              QWEN_MAX_BENCHMARK_PROFILE.inputUsdPerMillion,
            inputCacheMissUsdPerMillion:
              QWEN_MAX_BENCHMARK_PROFILE.inputUsdPerMillion,
            outputUsdPerMillion:
              QWEN_MAX_BENCHMARK_PROFILE.outputUsdPerMillion,
          }).totalCost;
    return {
      status: "FAIL_CLOSED",
      raw_output: capturedRawOutput,
      failure: {
        failure_code: safeFailureCode(error),
        paid_requests: forwardingCalls === 0 ? 0 : 1,
        http_attempts: forwardingCalls === 0 ? 0 : 1,
        retries: 0,
        resampling: 0,
        fallbacks: 0,
        input_tokens: usage?.inputTokens ?? null,
        output_tokens: usage?.outputTokens ?? null,
        finish_reason: providerError?.telemetry?.finishReason ?? null,
        truncated:
          providerError?.code === "TRUNCATED_OUTPUT"
            ? true
            : providerError?.telemetry?.finishReason === "stop"
              ? false
              : null,
        duration_ms: now() - startedAt,
        actual_cost_usd: actualCost,
        secret_reads: 1,
        secret_exposure: 0,
        repository_executions: 0,
      },
    };
  }
}

function inline(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function renderRealGroundedExpressionPreview(
  result: Extract<RealGroundedExpressionCanaryResult, { status: "COMPLETED" }>,
  sourceScript: GroundedScriptDraft,
): string {
  const before = sourceScript.segments.map((segment) => inline(segment.text)).join("\n\n");
  const after = result.revision.segments
    .map((segment) => inline(segment.text))
    .join("\n\n");
  const traced = result.validation.fact_trace.traced;
  const technicalTrace = result.validation.clause_trace.filter(
    (clause) => clause.statement_kind === "TECHNICAL_FACT",
  );
  const revisionClauseById = new Map(
    result.revision.segments
      .flatMap((segment) => segment.clauses)
      .map((clause) => [clause.revision_clause_id, clause]),
  );
  return [
    "# Archify First Real Grounded Expression Preview",
    "",
    "## BEFORE",
    "",
    before,
    "",
    "## AFTER",
    "",
    after,
    "",
    "## Validation",
    "",
    `Truth: **${result.validation.truth_gate}**`,
    `Fact Trace Coverage: **${traced}/${result.validation.fact_trace.expected}**`,
    `Estimated Duration: **${result.validation.host_validation.duration_estimate.estimated_seconds}s (ESTIMATE)**`,
    `Story Fidelity: **${result.validation.story_fidelity.status}**`,
    `Caveat Coverage: **${result.validation.caveat_coverage.status}**`,
    `Quality: **${result.quality?.revision.overall ?? "NOT_EVALUATED_TRUTH_FAIL"}**`,
    `Would Publish: **${result.would_publish}**`,
    `Canary Verdict: **${result.canary_verdict}**`,
    "Human Final Review Required: **YES**",
    "Automatic Approval: **NO**",
    "Automatic Publish: **NO**",
    "",
    "## Technical Trace",
    "",
    ...technicalTrace.map(
      (clause) => {
        const declared =
          revisionClauseById.get(clause.revision_clause_id)?.fact_refs ?? [];
        return `- ${clause.revision_clause_id}: declared ${declared.join(", ")} → canonical ${clause.canonical_fact_ids.join(", ") || "UNRESOLVED"} → evidence ${clause.evidence_ids.join(", ") || "UNRESOLVED"} (${clause.status})`;
      },
    ),
    "",
  ].join("\n");
}
