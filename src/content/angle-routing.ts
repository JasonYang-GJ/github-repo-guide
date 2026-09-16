import type { CanonicalGroundedBriefArtifact } from "../brief/canonical.js";
import type {
  GroundedFact,
  GroundedFactCategory,
  GroundedFactPack,
} from "../facts/domain.js";
import type { SchemaRegistry } from "../schemas/registry.js";
import {
  calculateOpenAICompatibleCost,
  OpenAICompatibleProviderError,
  type OpenAICompatiblePricing,
} from "../model/openai-compatible-provider.js";
import type {
  ModelProvider,
  ModelRequestConfiguration,
  ModelResult,
  StructuredGenerationRequest,
} from "../model/provider.js";
import { buildStructuredPrompt } from "../model/structured-prompt.js";
import { structuredOutputContract } from "../model/structured-output.js";
import type {
  AcceptedContentAngleV2,
  ContentAngleCandidateV2,
  ContentAngleEvaluationReceipt,
  ContentAngleGateCode,
  ContentAngleTargetAudience,
  ContentAngleType,
  DeterministicContentAngleInput,
} from "./angle-contract.js";
import { evaluateContentAngleCandidates } from "./angle-contract.js";
import {
  buildContentAngleCanaryModelInput,
  VS04_B_OFF_PEAK_PRICING,
  VS04_B_PEAK_PRICING,
  type ContentAngleCanaryModelInput,
} from "./angle-canary.js";
import { projectCanonicalUnknowns } from "./unknown-reference.js";

export const MINIMAL_ANGLE_DECISION_DRAFT_SCHEMA_ID =
  "internal:minimal-angle-decision-draft:1" as const;

export const MINIMAL_ANGLE_DECISION_INSTRUCTIONS = [
  {
    category: "OUTPUT_CONTRACT",
    text: "Return JSON matching the minimal schema; an honest empty result is {\"minimal_angle_draft_version\":1,\"candidates\":[]}.",
  },
  {
    category: "EDITORIAL_TASK",
    text: "Propose zero to four editorial choices using only supplied immutable Fact IDs, Canonical Brief context, and Known Unknown boundaries.",
  },
  {
    category: "EDITORIAL_TASK",
    text: "Return decisions only: which Facts, what bounded angle, why it is interesting, and who it serves.",
  },
  {
    category: "TRUTH_INSTRUCTIONS",
    text: "Do not restate Host-owned truth, Evidence, source paths, verification, novelty proof, ranking, acceptance, or scores.",
  },
  {
    category: "SAFETY_CONSTRAINTS",
    text: "Do not create Facts, entities, comparisons, causal or exclusivity claims, performance, safety, outcomes, or external novelty.",
  },
  {
    category: "SAFETY_CONSTRAINTS",
    text: "Do not produce scripts, hooks, outlines, posts, blogs, or video content. Compact plain technical English is preferred.",
  },
] as const;

export interface MinimalAngleDecisionCandidate {
  readonly candidate_id: string;
  readonly title: string;
  readonly angle_type: ContentAngleType;
  readonly editorial_thesis: string;
  readonly supporting_fact_ids: readonly string[];
  readonly why_interesting: string;
  readonly target_audience: readonly ContentAngleTargetAudience[];
  readonly editorial_confidence?: "LOW" | "MEDIUM" | "HIGH";
}

export interface MinimalAngleDecisionDraft {
  readonly minimal_angle_draft_version: 1;
  readonly candidates: readonly MinimalAngleDecisionCandidate[];
}

export type ContentAngleRoutingMode = "NON_THINKING" | "THINKING_LOW";

export type { DeterministicContentAngleInput } from "./angle-contract.js";

export interface CompactContentAngleRoutingModelInput {
  readonly input_contract_version: 3;
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: GroundedFactPack["fact_ir_version"];
  readonly canonical_grounded_brief_version: CanonicalGroundedBriefArtifact["canonical_grounded_brief_version"];
  readonly truth_boundary: {
    readonly facts_are_immutable: true;
    readonly known_unknowns_stay_unknown: true;
    readonly allowed_actions: readonly ["select", "group", "rank", "frame"];
    readonly prohibited_actions: readonly ["create", "upgrade", "rewrite", "replace"];
  };
  readonly canonical_brief: {
    readonly fields: readonly ["statement_id", "text", "fact_ids"];
    readonly items: readonly (readonly [string, string, readonly string[]])[];
  };
  readonly fact_groups: readonly {
    readonly category: GroundedFactCategory;
    readonly fields: readonly [
      "fact_id",
      "fact_type",
      "subject",
      "predicate",
      "object",
      "scope",
      "limitation_ids",
    ];
    readonly items: readonly (readonly [
      string,
      GroundedFact["fact_type"],
      string,
      GroundedFact["predicate"],
      string,
      GroundedFact["scope"],
      readonly string[],
    ])[];
  }[];
  readonly fact_limitations: {
    readonly fields: readonly ["limitation_id", "text"];
    readonly items: readonly (readonly [string, string])[];
  };
  readonly known_unknowns: {
    readonly fields: readonly ["unknown_id", "boundary", "evidence_needed"];
    readonly items: readonly (readonly [string, string, string])[];
  };
  readonly limitations: readonly string[];
}

export type ContentAngleRoutingModelInput =
  | ContentAngleCanaryModelInput
  | CompactContentAngleRoutingModelInput;

export interface ContentAngleRoutingPolicy {
  readonly status: string;
  readonly inputTokenHardLimit: number;
  readonly nonThinkingOutputTokens: number;
  readonly thinkingLowOutputTokens: number;
  readonly conservativeCharactersPerToken: number;
  readonly hardBudgetUsd: number;
  readonly maxRawCandidates: 4;
  readonly maxAcceptedAngles: 3;
  readonly maxPaidRequests: 2;
  readonly maxHttpAttempts: 2;
  readonly maxRetries: 0;
  readonly peakPricing: OpenAICompatiblePricing;
  readonly offPeakPricing: OpenAICompatiblePricing;
  readonly cacheKeySuffix: string;
}

export interface PreparedMinimalAngleExperiment {
  readonly mode: ContentAngleRoutingMode;
  readonly thinking: Extract<
    ModelRequestConfiguration["thinking"],
    "enabled" | "disabled"
  >;
  readonly reasoningEffort: "low" | null;
  readonly request: StructuredGenerationRequest;
  readonly modelInput: ContentAngleRoutingModelInput;
  readonly promptCharacters: number;
  readonly estimatedInputTokens: number;
  readonly peakWorstCaseCostUsd: number;
  readonly inputTokenHardLimit: number;
  readonly hardBudgetUsd: number;
  readonly peakPricing: OpenAICompatiblePricing;
  readonly offPeakPricing: OpenAICompatiblePricing;
  readonly factsAvailable: number;
  readonly factsSent: number;
  readonly knownUnknownsSent: number;
}

export interface PreparedContentAngleRoutingAB {
  readonly status: string;
  readonly experimentA: PreparedMinimalAngleExperiment;
  readonly experimentB: PreparedMinimalAngleExperiment;
  readonly inputTokenHardLimit: number;
  readonly maxRawCandidates: 4;
  readonly maxAcceptedAngles: 3;
  readonly maxPaidRequests: 2;
  readonly maxHttpAttempts: 2;
  readonly maxRetries: 0;
  readonly hardBudgetUsd: number;
  readonly combinedPeakWorstCaseCostUsd: number;
}

export interface MinimalAngleExperimentGenerationReceipt {
  readonly provider: "deepseek-api";
  readonly model: "deepseek-v4-pro";
  readonly mode: ContentAngleRoutingMode;
  readonly thinking: "enabled" | "disabled";
  readonly reasoningEffort: "low" | null;
  readonly paidRequests: 1;
  readonly httpAttempts: 1;
  readonly retries: 0;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheHitInputTokens: number | null;
  readonly cacheMissInputTokens: number | null;
  readonly reasoningTokens: number | null;
  readonly reasoningContentCharacters: number;
  readonly visibleFinalContentTokens: number | null;
  readonly visibleFinalContentCharacters: number;
  readonly finishReason: "stop";
  readonly truncated: false;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly pricingTier: "PEAK" | "OFF_PEAK";
  readonly actualCostUsd: number;
  readonly peakActualCostUsd: number;
  readonly peakBudgetLedgerUsd: number;
  readonly outputCeiling: number;
  readonly costPerAcceptedAngleUsd: number | null;
  readonly repositoryExecutions: 0;
}

export interface MinimalAngleExperimentResult {
  readonly status: MinimalAngleDecisionEvaluation["status"];
  readonly rawCandidates: MinimalAngleDecisionDraft;
  readonly rawModelOutput: string;
  readonly evaluation: MinimalAngleDecisionEvaluation;
  readonly generation: MinimalAngleExperimentGenerationReceipt;
}

export interface MinimalAngleExperimentFailureReceipt {
  readonly status: "FAIL_CLOSED";
  readonly mode: ContentAngleRoutingMode;
  readonly failure_code: string;
  readonly provider_failure_code: string | null;
  readonly environment_trustworthy: boolean;
  readonly paid_requests: 0 | 1;
  readonly http_attempts: number;
  readonly retries: 0;
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
  readonly cache_hit_input_tokens: number | null;
  readonly cache_miss_input_tokens: number | null;
  readonly reasoning_tokens: number | null;
  readonly visible_final_content_tokens: number | null;
  readonly finish_reason: string | null;
  readonly truncated: boolean;
  readonly duration_ms: number;
  readonly actual_cost_usd: number | null;
  readonly peak_actual_cost_usd: number | null;
  readonly partial_content_persisted: false;
  readonly reasoning_content_persisted: false;
  readonly repository_executions: 0;
}

export type MinimalAngleExperimentOutcome =
  | { readonly status: "COMPLETED"; readonly result: MinimalAngleExperimentResult }
  | {
      readonly status: "FAIL_CLOSED";
      readonly failure: MinimalAngleExperimentFailureReceipt;
    };

export interface ContentAngleRoutingABResult {
  readonly status: "AB_COMPLETED" | "STOPPED_AFTER_A";
  readonly experimentA: MinimalAngleExperimentOutcome;
  readonly experimentB: MinimalAngleExperimentOutcome | null;
  readonly totalPaidRequests: number;
  readonly totalHttpAttempts: number;
  readonly retries: 0;
  readonly totalActualCostUsd: number | null;
  readonly repositoryExecutions: 0;
}

export interface ContentAngleRoutingExecutionHooks {
  readonly beforeExperiment?: (
    experiment: PreparedMinimalAngleExperiment,
  ) => void | Promise<void>;
}

export interface MinimalAngleEnrichmentTrace {
  readonly candidate_id: string;
  readonly fact_categories: readonly GroundedFactCategory[];
  readonly evidence_ids: readonly string[];
  readonly known_unknown_conflicts: readonly string[];
  readonly novelty_status: "NOT_RESEARCHED";
}

export interface MinimalAngleDecisionEvaluation {
  readonly status: "ACCEPTED" | "NO_STRONG_CONTENT_ANGLE";
  readonly rawCandidateCount: number;
  readonly materializedCandidates: readonly ContentAngleCandidateV2[];
  readonly acceptedAngles: readonly AcceptedContentAngleV2[];
  readonly enrichment: readonly MinimalAngleEnrichmentTrace[];
  readonly decisions: readonly MinimalAngleHostDecision[];
  readonly hostEvaluation: ContentAngleEvaluationReceipt;
}

export interface MinimalAngleHostDecision {
  readonly candidate_id: string;
  readonly decision: "ACCEPT" | "DOWNGRADE" | "REJECT" | "DEDUPLICATE";
  readonly reason_codes: readonly ContentAngleGateCode[];
  readonly rank: number | null;
}

const SCOPE_ORDER = { LOCAL: 0, MODULE: 1, PACKAGE: 2, PROJECT: 3 } as const;

const VS04_C_ROUTING_POLICY: ContentAngleRoutingPolicy = {
  status: "VS04_C_OFFLINE_PREFLIGHT_READY",
  inputTokenHardLimit: 10_000,
  nonThinkingOutputTokens: 6_000,
  thinkingLowOutputTokens: 20_000,
  conservativeCharactersPerToken: 3,
  hardBudgetUsd: 0.2,
  maxRawCandidates: 4,
  maxAcceptedAngles: 3,
  maxPaidRequests: 2,
  maxHttpAttempts: 2,
  maxRetries: 0,
  peakPricing: VS04_B_PEAK_PRICING,
  offPeakPricing: VS04_B_OFF_PEAK_PRICING,
  cacheKeySuffix: "minimal-angle-decision-v1",
};

export function buildCompactContentAngleRoutingModelInput(
  input: DeterministicContentAngleInput,
): CompactContentAngleRoutingModelInput {
  const factLimitations = [
    ...new Set(
      input.facts_by_category.flatMap((group) =>
        group.facts.flatMap((fact) => fact.limitations),
      ),
    ),
  ];
  const limitationIds = new Map(
    factLimitations.map((limitation, index) => [limitation, `L${index + 1}`]),
  );
  return {
    input_contract_version: 3,
    repository: { ...input.repository },
    commit: input.commit,
    fact_ir_version: input.fact_ir_version,
    canonical_grounded_brief_version:
      input.canonical_grounded_brief_version,
    truth_boundary: {
      facts_are_immutable: true,
      known_unknowns_stay_unknown: true,
      allowed_actions: ["select", "group", "rank", "frame"],
      prohibited_actions: ["create", "upgrade", "rewrite", "replace"],
    },
    canonical_brief: {
      fields: ["statement_id", "text", "fact_ids"],
      items: input.canonical_brief.statements.map((statement) => [
        statement.statement_id,
        statement.text,
        [...statement.fact_ids],
      ]),
    },
    fact_groups: input.facts_by_category.map((group) => ({
      category: group.category,
      fields: [
        "fact_id",
        "fact_type",
        "subject",
        "predicate",
        "object",
        "scope",
        "limitation_ids",
      ],
      items: group.facts.map((fact) => [
        fact.fact_id,
        fact.fact_type,
        fact.subject.label,
        fact.predicate,
        fact.object.label,
        fact.scope,
        fact.limitations.map((limitation) => {
          const id = limitationIds.get(limitation);
          if (id === undefined) {
            throw new Error("CONTENT_ANGLE_ROUTING_LIMITATION_LOOKUP_FAILED");
          }
          return id;
        }),
      ]),
    })),
    fact_limitations: {
      fields: ["limitation_id", "text"],
      items: factLimitations.map((limitation, index) => [
        `L${index + 1}`,
        limitation,
      ]),
    },
    known_unknowns: {
      fields: ["unknown_id", "boundary", "evidence_needed"],
      items: input.known_unknowns.map((unknown) => [
        unknown.id,
        unknown.statement,
        unknown.evidence_needed,
      ]),
    },
    limitations: [...input.limitations],
  };
}

function modelInputFactCount(input: ContentAngleRoutingModelInput): number {
  return "facts" in input
    ? input.facts.length
    : input.fact_groups.reduce((total, group) => total + group.items.length, 0);
}

function modelInputUnknownCount(input: ContentAngleRoutingModelInput): number {
  return "fact_groups" in input
    ? input.known_unknowns.items.length
    : input.known_unknowns.length;
}

function positiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name.toUpperCase()}_INVALID`);
  }
}

function validateRoutingPolicy(policy: ContentAngleRoutingPolicy): void {
  positiveInteger("input_token_hard_limit", policy.inputTokenHardLimit);
  positiveInteger("non_thinking_output_tokens", policy.nonThinkingOutputTokens);
  positiveInteger("thinking_low_output_tokens", policy.thinkingLowOutputTokens);
  positiveInteger(
    "conservative_characters_per_token",
    policy.conservativeCharactersPerToken,
  );
  if (
    policy.status.length === 0 ||
    policy.hardBudgetUsd <= 0 ||
    policy.cacheKeySuffix.length === 0 ||
    policy.maxRawCandidates !== 4 ||
    policy.maxAcceptedAngles !== 3 ||
    policy.maxPaidRequests !== 2 ||
    policy.maxHttpAttempts !== 2 ||
    policy.maxRetries !== 0
  ) {
    throw new Error("CONTENT_ANGLE_ROUTING_POLICY_INVALID");
  }
}

function prepareMinimalAngleExperiment(
  mode: ContentAngleRoutingMode,
  pack: GroundedFactPack,
  modelInput: ContentAngleRoutingModelInput,
  policy: ContentAngleRoutingPolicy,
): PreparedMinimalAngleExperiment {
  const outputTokens =
    mode === "NON_THINKING"
      ? policy.nonThinkingOutputTokens
      : policy.thinkingLowOutputTokens;
  const request: StructuredGenerationRequest = {
    stage: "angles",
    schemaId: MINIMAL_ANGLE_DECISION_DRAFT_SCHEMA_ID,
    systemInstructions: MINIMAL_ANGLE_DECISION_INSTRUCTIONS.map(
      (instruction) => instruction.text,
    ).join(" "),
    untrustedRepositoryContext: [],
    untrustedRepositorySignals: { content_angle_input: modelInput },
    signalSerialization: "compact",
    repositoryReadReceipt: {
      highestScope: 0,
      filesConsidered: [],
      filesRead: [],
    },
    maxOutputTokens: outputTokens,
    cacheKey: `${pack.repository.owner}/${pack.repository.name}:${pack.commit}:${policy.cacheKeySuffix}`,
  };
  const contract = structuredOutputContract(request.schemaId);
  if (contract === null) throw new Error("MINIMAL_ANGLE_SCHEMA_MISSING");
  const promptCharacters = buildStructuredPrompt(request, contract.schema).length;
  const estimatedInputTokens =
    Math.ceil(promptCharacters / policy.conservativeCharactersPerToken) + 256;
  if (estimatedInputTokens > policy.inputTokenHardLimit) {
    throw new Error("CONTENT_ANGLE_ROUTING_INPUT_LIMIT_EXCEEDED");
  }
  const peakWorstCaseCostUsd = calculateOpenAICompatibleCost(
    {
      inputTokens: policy.inputTokenHardLimit,
      outputTokens,
    },
    policy.peakPricing,
  ).totalCost;
  return {
    mode,
    thinking: mode === "NON_THINKING" ? "disabled" : "enabled",
    reasoningEffort: mode === "NON_THINKING" ? null : "low",
    request,
    modelInput,
    promptCharacters,
    estimatedInputTokens,
    peakWorstCaseCostUsd,
    inputTokenHardLimit: policy.inputTokenHardLimit,
    hardBudgetUsd: policy.hardBudgetUsd,
    peakPricing: policy.peakPricing,
    offPeakPricing: policy.offPeakPricing,
    factsAvailable: pack.facts.length,
    factsSent: modelInputFactCount(modelInput),
    knownUnknownsSent: modelInputUnknownCount(modelInput),
  };
}

function pricingTierAt(timestamp: number): "PEAK" | "OFF_PEAK" {
  const date = new Date(timestamp);
  const weekday = date.getUTCDay();
  const hour = date.getUTCHours();
  const weekdayPeak = weekday >= 1 && weekday <= 5;
  return weekdayPeak && ((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10))
    ? "PEAK"
    : "OFF_PEAK";
}

class MinimalAngleHostExecutionError extends Error {
  constructor(
    readonly code: string,
    readonly modelResult: ModelResult<MinimalAngleDecisionDraft>,
  ) {
    super(code);
    this.name = "MinimalAngleHostExecutionError";
  }
}

export async function runMinimalAngleExperiment(
  prepared: PreparedMinimalAngleExperiment,
  provider: ModelProvider,
  pack: GroundedFactPack,
  canonical: CanonicalGroundedBriefArtifact,
  schemas: SchemaRegistry,
  clock: () => number = Date.now,
): Promise<MinimalAngleExperimentResult> {
  const started = clock();
  const modelResult = await provider.generateStructured<MinimalAngleDecisionDraft>(
    prepared.request,
  );
  try {
  const completed = clock();
  if (
    !Number.isFinite(started) ||
    !Number.isFinite(completed) ||
    completed < started
  ) {
    throw new Error("VS04_C_DURATION_INVALID");
  }
  if (
    modelResult.provider !== "deepseek-api" ||
    modelResult.model !== "deepseek-v4-pro" ||
    modelResult.networkCalls !== 1 ||
    !modelResult.paid
  ) {
    throw new Error("VS04_C_REQUEST_IDENTITY_INVALID");
  }
  if (
    modelResult.requestConfiguration?.thinking !== prepared.thinking ||
    modelResult.requestConfiguration.reasoningEffort !== prepared.reasoningEffort
  ) {
    throw new Error("VS04_C_REQUEST_CONFIGURATION_INVALID");
  }
  if (
    modelResult.rawOutput === undefined ||
    modelResult.rawOutput.trim().length === 0 ||
    modelResult.finishReason !== "stop" ||
    modelResult.reasoning === undefined
  ) {
    throw new Error("VS04_C_RESPONSE_INCOMPLETE");
  }
  if (
    modelResult.context.promptStage !== "angles" ||
    modelResult.context.highestReadScope !== 0 ||
    modelResult.context.filesConsidered.length !== 0 ||
    modelResult.context.filesRead.length !== 0 ||
    modelResult.context.filesPassed.length !== 0 ||
    modelResult.context.repositoryCharactersPassed !== 0 ||
    modelResult.context.promptCharacters !== prepared.promptCharacters ||
    !modelResult.context.schemaValidated ||
    modelResult.context.endpoint !== "remote_https"
  ) {
    throw new Error("VS04_C_CONTEXT_DRIFT");
  }
  if (
    modelResult.usage.inputTokens > prepared.inputTokenHardLimit ||
    modelResult.usage.outputTokens > prepared.request.maxOutputTokens ||
    (modelResult.reasoning.tokens !== null &&
      modelResult.reasoning.tokens > modelResult.usage.outputTokens)
  ) {
    throw new Error("VS04_C_ACTUAL_TOKEN_LIMIT_EXCEEDED");
  }

  const evaluation = evaluateMinimalAngleDecisionDraft(
    modelResult.value,
    pack,
    canonical,
    schemas,
  );
  const tier = pricingTierAt(started);
  const actualCost = calculateOpenAICompatibleCost(
    modelResult.usage,
    tier === "PEAK" ? prepared.peakPricing : prepared.offPeakPricing,
  ).totalCost;
  const peakActualCost = calculateOpenAICompatibleCost(
    modelResult.usage,
    prepared.peakPricing,
  ).totalCost;
  if (
    actualCost > prepared.hardBudgetUsd ||
    peakActualCost > prepared.hardBudgetUsd
  ) {
    throw new Error("VS04_C_ACTUAL_BUDGET_EXCEEDED");
  }
  return {
    status: evaluation.status,
    rawCandidates: modelResult.value,
    rawModelOutput: modelResult.rawOutput,
    evaluation,
    generation: {
      provider: "deepseek-api",
      model: "deepseek-v4-pro",
      mode: prepared.mode,
      thinking: prepared.thinking,
      reasoningEffort: prepared.reasoningEffort,
      paidRequests: 1,
      httpAttempts: 1,
      retries: 0,
      inputTokens: modelResult.usage.inputTokens,
      outputTokens: modelResult.usage.outputTokens,
      cacheHitInputTokens: modelResult.usage.cacheHitInputTokens ?? null,
      cacheMissInputTokens: modelResult.usage.cacheMissInputTokens ?? null,
      reasoningTokens: modelResult.reasoning.tokens,
      reasoningContentCharacters: modelResult.reasoning.contentCharacters,
      visibleFinalContentTokens: modelResult.reasoning.visibleContentTokens,
      visibleFinalContentCharacters: modelResult.rawOutput.length,
      finishReason: "stop",
      truncated: false,
      startedAt: new Date(started).toISOString(),
      completedAt: new Date(completed).toISOString(),
      durationMs: completed - started,
      pricingTier: tier,
      actualCostUsd: actualCost,
      peakActualCostUsd: peakActualCost,
      peakBudgetLedgerUsd: prepared.peakWorstCaseCostUsd,
      outputCeiling: prepared.request.maxOutputTokens,
      costPerAcceptedAngleUsd:
        evaluation.acceptedAngles.length === 0
          ? null
          : actualCost / evaluation.acceptedAngles.length,
      repositoryExecutions: 0,
    },
  };
  } catch (error) {
    if (error instanceof MinimalAngleHostExecutionError) throw error;
    throw new MinimalAngleHostExecutionError(safeFailureCode(error), modelResult);
  }
}

function safeFailureCode(error: unknown): string {
  if (error instanceof OpenAICompatibleProviderError) return error.code;
  if (error instanceof Error && /^[A-Z0-9_]+(?::.*)?$/.test(error.message)) {
    return error.message.split(":", 1)[0] ?? "UNCLASSIFIED_FAILURE";
  }
  return "UNCLASSIFIED_FAILURE";
}

function buildMinimalAngleFailureReceipt(
  error: unknown,
  prepared: PreparedMinimalAngleExperiment,
  started: number,
  completed: number,
): MinimalAngleExperimentFailureReceipt {
  const providerError =
    error instanceof OpenAICompatibleProviderError ? error : null;
  const hostError =
    error instanceof MinimalAngleHostExecutionError ? error : null;
  const hostResult = hostError?.modelResult;
  const attempts = providerError?.attempts ?? hostResult?.networkCalls ?? 0;
  if (attempts > 1) {
    throw new Error("VS04_C_RETRY_BOUNDARY_VIOLATED");
  }
  const telemetry = providerError?.telemetry;
  const usage = telemetry?.usage ?? hostResult?.usage;
  const reasoning = telemetry?.reasoning ?? hostResult?.reasoning;
  const tier = pricingTierAt(started);
  const actualCost =
    usage === undefined
      ? null
      : calculateOpenAICompatibleCost(
          usage,
          tier === "PEAK" ? prepared.peakPricing : prepared.offPeakPricing,
        ).totalCost;
  const peakActualCost =
    usage === undefined
      ? null
      : calculateOpenAICompatibleCost(
          usage,
          prepared.peakPricing,
        ).totalCost;
  return {
    status: "FAIL_CLOSED",
    mode: prepared.mode,
    failure_code:
      prepared.mode === "NON_THINKING" &&
      providerError?.code === "TRUNCATED_OUTPUT"
        ? "MINIMAL_ANGLE_OUTPUT_PIPELINE_FAILURE"
        : hostError?.code ?? safeFailureCode(error),
    provider_failure_code: providerError?.code ?? null,
    environment_trustworthy: telemetry !== undefined && hostError === null,
    paid_requests:
      (providerError?.attempts ?? 0) > 0 || hostResult?.paid === true ? 1 : 0,
    http_attempts: attempts,
    retries: 0,
    input_tokens: usage?.inputTokens ?? null,
    output_tokens: usage?.outputTokens ?? null,
    cache_hit_input_tokens: usage?.cacheHitInputTokens ?? null,
    cache_miss_input_tokens: usage?.cacheMissInputTokens ?? null,
    reasoning_tokens: reasoning?.tokens ?? null,
    visible_final_content_tokens:
      reasoning?.visibleContentTokens ?? null,
    finish_reason: telemetry?.finishReason ?? hostResult?.finishReason ?? null,
    truncated: providerError?.code === "TRUNCATED_OUTPUT",
    duration_ms: completed - started,
    actual_cost_usd: actualCost,
    peak_actual_cost_usd: peakActualCost,
    partial_content_persisted: false,
    reasoning_content_persisted: false,
    repository_executions: 0,
  };
}

async function runMinimalAngleOutcome(
  prepared: PreparedMinimalAngleExperiment,
  provider: ModelProvider,
  pack: GroundedFactPack,
  canonical: CanonicalGroundedBriefArtifact,
  schemas: SchemaRegistry,
  beforeExperiment?: (
    experiment: PreparedMinimalAngleExperiment,
  ) => void | Promise<void>,
): Promise<MinimalAngleExperimentOutcome> {
  const started = Date.now();
  try {
    await beforeExperiment?.(prepared);
    const result = await runMinimalAngleExperiment(
      prepared,
      provider,
      pack,
      canonical,
      schemas,
    );
    return { status: "COMPLETED", result };
  } catch (error) {
    return {
      status: "FAIL_CLOSED",
      failure: buildMinimalAngleFailureReceipt(
        error,
        prepared,
        started,
        Date.now(),
      ),
    };
  }
}

function outcomePaidRequests(outcome: MinimalAngleExperimentOutcome): number {
  return outcome.status === "COMPLETED"
    ? outcome.result.generation.paidRequests
    : outcome.failure.paid_requests;
}

function outcomeHttpAttempts(outcome: MinimalAngleExperimentOutcome): number {
  return outcome.status === "COMPLETED"
    ? outcome.result.generation.httpAttempts
    : outcome.failure.http_attempts;
}

function outcomeCost(outcome: MinimalAngleExperimentOutcome): number | null {
  return outcome.status === "COMPLETED"
    ? outcome.result.generation.actualCostUsd
    : outcome.failure.actual_cost_usd;
}

export async function runContentAngleRoutingAB(
  prepared: PreparedContentAngleRoutingAB,
  providerA: ModelProvider,
  providerB: ModelProvider,
  pack: GroundedFactPack,
  canonical: CanonicalGroundedBriefArtifact,
  schemas: SchemaRegistry,
  hooks: ContentAngleRoutingExecutionHooks = {},
): Promise<ContentAngleRoutingABResult> {
  const experimentA = await runMinimalAngleOutcome(
    prepared.experimentA,
    providerA,
    pack,
    canonical,
    schemas,
    hooks.beforeExperiment,
  );
  const mustStopAfterA =
    experimentA.status === "FAIL_CLOSED" &&
    !experimentA.failure.environment_trustworthy;
  const experimentB = mustStopAfterA
    ? null
    : await runMinimalAngleOutcome(
        prepared.experimentB,
        providerB,
         pack,
         canonical,
         schemas,
         hooks.beforeExperiment,
       );
  const outcomes = [experimentA, ...(experimentB === null ? [] : [experimentB])];
  const totalPaidRequests = outcomes.reduce(
    (total, outcome) => total + outcomePaidRequests(outcome),
    0,
  );
  const totalHttpAttempts = outcomes.reduce(
    (total, outcome) => total + outcomeHttpAttempts(outcome),
    0,
  );
  if (totalPaidRequests > 2 || totalHttpAttempts > 2) {
    throw new Error("VS04_C_REQUEST_BOUNDARY_VIOLATED");
  }
  const costs = outcomes.map(outcomeCost);
  const totalActualCostUsd = costs.some((cost) => cost === null)
    ? null
    : costs.reduce<number>((total, cost) => total + (cost ?? 0), 0);
  if (
    totalActualCostUsd !== null &&
    totalActualCostUsd > prepared.hardBudgetUsd
  ) {
    throw new Error("VS04_C_COMBINED_ACTUAL_BUDGET_EXCEEDED");
  }
  return {
    status: mustStopAfterA ? "STOPPED_AFTER_A" : "AB_COMPLETED",
    experimentA,
    experimentB,
    totalPaidRequests,
    totalHttpAttempts,
    retries: 0,
    totalActualCostUsd,
    repositoryExecutions: 0,
  };
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateCompactRoutingModelInput(
  input: CompactContentAngleRoutingModelInput,
  pack: GroundedFactPack,
  canonical: CanonicalGroundedBriefArtifact,
): void {
  if (
    JSON.stringify(input.repository) !== JSON.stringify(pack.repository) ||
    input.commit !== pack.commit ||
    input.fact_ir_version !== pack.fact_ir_version ||
    input.canonical_grounded_brief_version !==
      canonical.canonical_grounded_brief_version
  ) {
    throw new Error("CONTENT_ANGLE_ROUTING_TRUTH_IDENTITY_MISMATCH");
  }
  const entities = new Map(
    pack.entities.map((entity) => [entity.id, entity.display_label]),
  );
  const facts = new Map(pack.facts.map((fact) => [fact.id, fact]));
  const limitationText = new Map(input.fact_limitations.items);
  const projectedFactIds: string[] = [];
  for (const group of input.fact_groups) {
    for (const item of group.items) {
      const [id, factType, subject, predicate, object, scope, limitationIds] = item;
      const fact = facts.get(id);
      const limitations = limitationIds.map((limitationId) =>
        limitationText.get(limitationId),
      );
      if (
        fact === undefined ||
        fact.category !== group.category ||
        fact.fact_type !== factType ||
        (entities.get(fact.subject_ref) ?? fact.subject_ref) !== subject ||
        fact.predicate !== predicate ||
        (entities.get(fact.object_ref) ?? fact.object_ref) !== object ||
        fact.scope !== scope ||
        limitations.some((limitation) => limitation === undefined) ||
        !sameStringArray(fact.limitations, limitations as string[])
      ) {
        throw new Error("CONTENT_ANGLE_ROUTING_FACT_PROJECTION_MISMATCH");
      }
      projectedFactIds.push(id);
    }
  }
  if (
    projectedFactIds.length === 0 ||
    projectedFactIds.length > 80 ||
    new Set(projectedFactIds).size !== projectedFactIds.length
  ) {
    throw new Error("CONTENT_ANGLE_ROUTING_FACT_SELECTION_INVALID");
  }
  const statements = new Map(
    canonical.brief.sections.flatMap((section) =>
      section.statements.map((statement) => [statement.id, statement] as const),
    ),
  );
  for (const [id, text, factIds] of input.canonical_brief.items) {
    const statement = statements.get(id);
    if (
      statement === undefined ||
      statement.text !== text ||
      !sameStringArray(statement.fact_ids, factIds) ||
      factIds.some((factId) => !projectedFactIds.includes(factId))
    ) {
      throw new Error("CONTENT_ANGLE_ROUTING_BRIEF_PROJECTION_MISMATCH");
    }
  }
  const expectedUnknowns = canonical.known_unknowns.map((unknown) => [
    unknown.id,
    unknown.statement,
    unknown.evidence_needed,
  ] as const);
  const expectedLimitations = [
    ...canonical.limitations,
    "Repository-local evidence cannot establish external novelty or comparative superiority.",
    "Editorial scores are heuristics, not objective truth or source-code verification.",
  ];
  if (
    JSON.stringify(input.known_unknowns.items) !== JSON.stringify(expectedUnknowns) ||
    !sameStringArray(input.limitations, expectedLimitations)
  ) {
    throw new Error("CONTENT_ANGLE_ROUTING_UNKNOWN_PROJECTION_MISMATCH");
  }
}

export function prepareContentAngleRoutingABWithPolicy(
  pack: GroundedFactPack,
  canonical: CanonicalGroundedBriefArtifact,
  modelInput: ContentAngleRoutingModelInput,
  policy: ContentAngleRoutingPolicy,
): PreparedContentAngleRoutingAB {
  validateRoutingPolicy(policy);
  if (
    JSON.stringify(modelInput.repository) !== JSON.stringify(pack.repository) ||
    modelInput.commit !== pack.commit ||
    canonical.status !== "ACCEPTED" ||
    JSON.stringify(canonical.repository) !== JSON.stringify(pack.repository) ||
    canonical.commit !== pack.commit ||
    canonical.fact_ir_version !== pack.fact_ir_version
  ) {
    throw new Error("CONTENT_ANGLE_ROUTING_TRUTH_CONTEXT_MISMATCH");
  }
  if ("fact_groups" in modelInput) {
    validateCompactRoutingModelInput(modelInput, pack, canonical);
  }
  const experimentA = prepareMinimalAngleExperiment(
    "NON_THINKING",
    pack,
    modelInput,
    policy,
  );
  const experimentB = prepareMinimalAngleExperiment(
    "THINKING_LOW",
    pack,
    modelInput,
    policy,
  );
  const combinedPeakWorstCaseCostUsd =
    Math.round(
      (experimentA.peakWorstCaseCostUsd +
        experimentB.peakWorstCaseCostUsd) *
        1_000_000_000_000,
    ) / 1_000_000_000_000;
  if (combinedPeakWorstCaseCostUsd > policy.hardBudgetUsd) {
    throw new Error("CONTENT_ANGLE_ROUTING_COMBINED_BUDGET_PREFLIGHT_FAILED");
  }
  return {
    status: policy.status,
    experimentA,
    experimentB,
    inputTokenHardLimit: policy.inputTokenHardLimit,
    maxRawCandidates: policy.maxRawCandidates,
    maxAcceptedAngles: policy.maxAcceptedAngles,
    maxPaidRequests: policy.maxPaidRequests,
    maxHttpAttempts: policy.maxHttpAttempts,
    maxRetries: policy.maxRetries,
    hardBudgetUsd: policy.hardBudgetUsd,
    combinedPeakWorstCaseCostUsd,
  };
}

export function prepareContentAngleRoutingAB(
  pack: GroundedFactPack,
  canonical: CanonicalGroundedBriefArtifact,
): PreparedContentAngleRoutingAB {
  return prepareContentAngleRoutingABWithPolicy(
    pack,
    canonical,
    buildContentAngleCanaryModelInput(pack, canonical),
    VS04_C_ROUTING_POLICY,
  );
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function highestScope(facts: readonly GroundedFact[]): GroundedFact["scope"] {
  return facts.reduce<GroundedFact["scope"]>(
    (highest, fact) =>
      SCOPE_ORDER[fact.scope] > SCOPE_ORDER[highest] ? fact.scope : highest,
    "LOCAL",
  );
}

const UNKNOWN_CATEGORY_PATTERNS: Readonly<Record<string, RegExp>> = {
  alias_and_reexport_resolution:
    /\b(resolves? aliases?|alias resolution|follows? re-exports?|re-export chains?)\b|解析别名|重导出链/i,
  call_relations: /\b(calls?|invokes?|call graph|call relation)\b|调用关系|调用图/i,
  general_branch_behavior:
    /\b(all branches|every branch|general branch behavior|always|whole project|project-wide)\b|所有分支|始终|整个项目|全项目/i,
  input_immutability:
    /\b(does not mutate|without mutating|never mutates|immutable|immutability)\b|不修改输入|不可变/i,
  performance_outcomes:
    /\b(faster|fastest|performance|performant|lightweight|more efficient|efficiency gain)\b|更快|最快|高性能|轻量|效率提升/i,
  safety_guarantees:
    /\b(safe|safer|secure|security|vulnerability-free|production-safe|prevents? attacks?|prototype[- ]pollution|dangerous prototype keys?|guard against prototype)\b|安全|无漏洞|防止攻击/i,
};

function deriveKnownUnknownConflicts(
  candidate: MinimalAngleDecisionCandidate,
  canonical: CanonicalGroundedBriefArtifact,
): string[] {
  const corpus = [
    candidate.title,
    candidate.editorial_thesis,
    candidate.why_interesting,
  ].join(" ");
  return projectCanonicalUnknowns(canonical)
    .filter((unknown) => UNKNOWN_CATEGORY_PATTERNS[unknown.category]?.test(corpus))
    .map((unknown) => unknown.unknown_id);
}

export function evaluateMinimalAngleDecisionDraft(
  draft: MinimalAngleDecisionDraft,
  pack: GroundedFactPack,
  canonical: CanonicalGroundedBriefArtifact,
  schemas: SchemaRegistry,
): MinimalAngleDecisionEvaluation {
  if (
    draft.minimal_angle_draft_version !== 1 ||
    draft.candidates.length > 4 ||
    new Set(draft.candidates.map((candidate) => candidate.candidate_id)).size !==
      draft.candidates.length
  ) {
    throw new Error("MINIMAL_ANGLE_DECISION_DRAFT_INVALID");
  }

  const factsById = new Map(pack.facts.map((fact) => [fact.id, fact]));
  const entitiesById = new Map(
    pack.entities.map((entity) => [entity.id, entity.display_label]),
  );
  const statements = canonical.brief.sections.flatMap(
    (section) => section.statements,
  );
  const materializedCandidates: ContentAngleCandidateV2[] = [];
  const enrichment: MinimalAngleEnrichmentTrace[] = [];
  const preRejected = new Map<string, MinimalAngleHostDecision>();

  for (const candidate of draft.candidates) {
    const facts = candidate.supporting_fact_ids.flatMap((factId) => {
      const fact = factsById.get(factId);
      return fact === undefined ? [] : [fact];
    });
    if (facts.length !== candidate.supporting_fact_ids.length) {
      preRejected.set(candidate.candidate_id, {
        candidate_id: candidate.candidate_id,
        decision: "REJECT",
        reason_codes: ["UNKNOWN_FACT_REFERENCE"],
        rank: null,
      });
      continue;
    }
    const technicalBasis = facts.map((fact) => ({
      fact_id: fact.id,
      canonical_statement_id:
        statements
          .filter((statement) => statement.fact_ids.includes(fact.id))
          .map((statement) => statement.id)
          .sort()[0] ?? null,
      subject_ref: fact.subject_ref,
      predicate: fact.predicate,
      object_ref: fact.object_ref,
      scope: fact.scope,
    }));
    const supportingStatementIds = uniqueStrings(
      technicalBasis.flatMap((basis) =>
        basis.canonical_statement_id === null
          ? []
          : [basis.canonical_statement_id],
      ),
    );
    const entityRefs = uniqueStrings(
      facts.flatMap((fact) => [fact.subject_ref, fact.object_ref]),
    );
    const factCategories = uniqueStrings(
      facts.map((fact) => fact.category),
    ) as GroundedFactCategory[];
    const evidenceIds = uniqueStrings(
      facts.flatMap((fact) => fact.evidence_ids),
    );
    const knownUnknownConflicts = deriveKnownUnknownConflicts(
      candidate,
      canonical,
    );
    const unknownCaveats = projectCanonicalUnknowns(canonical)
      .filter((unknown) => knownUnknownConflicts.includes(unknown.unknown_id))
      .map((unknown) => unknown.canonical_text);

    materializedCandidates.push({
      content_angle_version: 2,
      id: candidate.candidate_id,
      status: "CANDIDATE",
      rank: null,
      repository: { ...pack.repository },
      commit: pack.commit,
      fact_ir_version: pack.fact_ir_version,
      canonical_grounded_brief_version:
        canonical.canonical_grounded_brief_version,
      title: candidate.title,
      angle_type: candidate.angle_type,
      editorial_thesis: candidate.editorial_thesis,
      editorial_reason: candidate.why_interesting,
      technical_basis: technicalBasis,
      supporting_fact_ids: [...candidate.supporting_fact_ids],
      supporting_statement_ids: supportingStatementIds,
      why_interesting: candidate.why_interesting,
      target_audience: [...candidate.target_audience],
      confidence: {
        level: candidate.editorial_confidence ?? "MEDIUM",
        basis: "EDITORIAL_JUDGMENT_NOT_FACT_VERIFICATION",
        rationale:
          "Editorial confidence does not change Canonical Fact verification.",
      },
      novelty_assessment: {
        status: "NOT_RESEARCHED",
        claim_boundary: "NO_EXTERNAL_NOVELTY_CLAIM",
        rationale: "External novelty was not researched for this experiment.",
      },
      educational_value: candidate.why_interesting,
      caveats: uniqueStrings([
        ...facts.flatMap((fact) => fact.limitations),
        ...unknownCaveats,
      ]).slice(0, 4),
      unknown_dependencies: knownUnknownConflicts,
      external_claims: [],
      technical_entities: entityRefs.map((entityRef) => ({
        entity_ref: entityRef,
        label: entitiesById.get(entityRef) ?? entityRef,
      })),
      fact_mutation_requests: [],
      claimed_scope: highestScope(facts),
      editorial_scores: {
        technical_significance: 2,
        educational_value: 2,
        clarity: 2,
        evidence_strength: 3,
        distinctiveness: 2,
        content_potential: 2,
      },
    });
    enrichment.push({
      candidate_id: candidate.candidate_id,
      fact_categories: factCategories,
      evidence_ids: evidenceIds,
      known_unknown_conflicts: knownUnknownConflicts,
      novelty_status: "NOT_RESEARCHED",
    });
  }

  const hostEvaluation = evaluateContentAngleCandidates(
    materializedCandidates,
    pack,
    canonical,
    schemas,
  );
  const hostDecisions = new Map(
    hostEvaluation.decision_trace.map((trace) => [
      trace.candidate_id,
      {
        candidate_id: trace.candidate_id,
        decision: trace.decision,
        reason_codes: [...trace.decision_reason],
        rank: trace.rank,
      } satisfies MinimalAngleHostDecision,
    ]),
  );
  const decisions = draft.candidates.map((candidate) => {
    const decision =
      preRejected.get(candidate.candidate_id) ??
      hostDecisions.get(candidate.candidate_id);
    if (decision === undefined) {
      throw new Error("MINIMAL_ANGLE_DECISION_TRACE_MISSING");
    }
    return decision;
  });
  return {
    status:
      hostEvaluation.accepted_angles.length > 0
        ? "ACCEPTED"
        : "NO_STRONG_CONTENT_ANGLE",
    rawCandidateCount: draft.candidates.length,
    materializedCandidates,
    acceptedAngles: hostEvaluation.accepted_angles,
    enrichment,
    decisions,
    hostEvaluation,
  };
}
