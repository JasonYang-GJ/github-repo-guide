import type { CanonicalGroundedBriefArtifact } from "../brief/canonical.js";
import type { GroundedFactPack } from "../facts/domain.js";
import {
  calculateOpenAICompatibleCost,
  OpenAICompatibleProviderError,
  type OpenAICompatiblePricing,
} from "../model/openai-compatible-provider.js";
import type {
  ModelProvider,
  ModelRequestConfiguration,
  StructuredGenerationRequest,
} from "../model/provider.js";
import { buildStructuredPrompt } from "../model/structured-prompt.js";
import { structuredOutputContract } from "../model/structured-output.js";
import type { SchemaRegistry } from "../schemas/registry.js";
import {
  buildDeterministicContentAngleInput,
  evaluateContentAngleCandidates,
  type AcceptedContentAngleV2,
  type ContentAngleCandidateV2,
  type ContentAngleEvaluationReceipt,
  type ContentAngleGateCode,
} from "./angle-contract.js";
import { projectCanonicalUnknowns } from "./unknown-reference.js";

export const CONTENT_ANGLE_CANDIDATE_DRAFT_SCHEMA_ID =
  "internal:content-angle-candidate-draft:1" as const;

export const VS04_B_PEAK_PRICING: OpenAICompatiblePricing = {
  currency: "USD",
  inputCacheHitUsdPerMillion: 0.044,
  inputCacheMissUsdPerMillion: 1.32,
  outputUsdPerMillion: 3.96,
};

export const VS04_B_OFF_PEAK_PRICING: OpenAICompatiblePricing = {
  currency: "USD",
  inputCacheHitUsdPerMillion: 0.022,
  inputCacheMissUsdPerMillion: 0.66,
  outputUsdPerMillion: 1.98,
};

export const VS04_B_AUTHORIZED_BUDGET = {
  hardBudgetUsd: 0.025,
  inputTokenHardLimit: 8_000,
  outputTokenHardLimit: 3_000,
  requestedOutputTokens: 3_000,
  conservativeCharactersPerToken: 3,
  maxCandidates: 5,
  maxAcceptedAngles: 3,
  maxPaidRequests: 1,
  maxHttpAttempts: 1,
  maxRetries: 0,
  peakPricing: VS04_B_PEAK_PRICING,
  offPeakPricing: VS04_B_OFF_PEAK_PRICING,
} as const;

export const VS04_B_R2_AUTHORIZED_BUDGET = {
  hardBudgetUsd: 0.1,
  inputTokenHardLimit: 10_000,
  outputTokenHardLimit: 12_000,
  requestedOutputTokens: 12_000,
  conservativeCharactersPerToken: 3,
  maxCandidates: 5,
  maxAcceptedAngles: 3,
  maxPaidRequests: 1,
  maxHttpAttempts: 1,
  maxRetries: 0,
  peakPricing: VS04_B_PEAK_PRICING,
  offPeakPricing: VS04_B_OFF_PEAK_PRICING,
} as const;

export interface ContentAngleCanaryBudget {
  readonly hardBudgetUsd: number;
  readonly inputTokenHardLimit: number;
  readonly outputTokenHardLimit: number;
  readonly requestedOutputTokens: number;
  readonly conservativeCharactersPerToken: number;
  readonly maxCandidates: 5;
  readonly maxAcceptedAngles: 3;
  readonly maxPaidRequests: 1;
  readonly maxHttpAttempts: 1;
  readonly maxRetries: 0;
  readonly peakPricing: OpenAICompatiblePricing;
  readonly offPeakPricing: OpenAICompatiblePricing;
}

export interface ContentAngleCanaryModelInput {
  readonly input_contract_version: 2;
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly truth_boundary: {
    readonly facts_are_immutable: true;
    readonly canonical_statements_are_context: true;
    readonly known_unknowns_stay_unknown: true;
    readonly allowed_actions: readonly ["select", "rank", "group", "frame"];
    readonly prohibited_actions: readonly ["create", "upgrade", "rewrite", "replace"];
  };
  readonly facts: readonly {
    readonly id: string;
    readonly fact_type: string;
    readonly subject: { readonly entity_ref: string; readonly label: string };
    readonly predicate: string;
    readonly object: { readonly entity_ref: string; readonly label: string };
    readonly scope: string;
    readonly source_kind: string;
    readonly limitations: readonly string[];
    readonly canonical_statements: readonly {
      readonly id: string;
      readonly text: string;
      readonly kind: string;
      readonly scope: string;
    }[];
  }[];
  readonly known_unknowns: readonly {
    readonly unknown_id: string;
    readonly category: string;
    readonly canonical_text: string;
    readonly scope: "FACT_IR";
    readonly status: "UNRESOLVED";
  }[];
}

export interface ContentAngleCandidateDraft {
  readonly candidate_id: string;
  readonly title: string;
  readonly angle_type: ContentAngleCandidateV2["angle_type"];
  readonly editorial_thesis: string;
  readonly editorial_reason: string;
  readonly technical_basis: readonly {
    readonly fact_id: string;
    readonly canonical_statement_id: string | null;
  }[];
  readonly supporting_fact_ids: readonly string[];
  readonly supporting_statement_ids: readonly string[];
  readonly why_interesting: string;
  readonly target_audience: ContentAngleCandidateV2["target_audience"];
  readonly confidence: {
    readonly level: ContentAngleCandidateV2["confidence"]["level"];
    readonly rationale: string;
  };
  readonly novelty_assessment: {
    readonly status: Extract<
      ContentAngleCandidateV2["novelty_assessment"]["status"],
      "NOT_RESEARCHED" | "REPOSITORY_LOCAL_ONLY"
    >;
    readonly rationale: string;
  };
  readonly educational_value: string;
  readonly caveats: readonly string[];
  readonly unknown_dependencies: readonly string[];
  readonly external_claims: readonly string[];
  readonly technical_entities: ContentAngleCandidateV2["technical_entities"];
  readonly claimed_scope: ContentAngleCandidateV2["claimed_scope"];
  readonly editorial_scores: ContentAngleCandidateV2["editorial_scores"];
}

export interface ContentAngleCandidateDraftBundle {
  readonly draft_version: 1;
  readonly candidates: readonly ContentAngleCandidateDraft[];
}

export interface ContentAngleCanaryDecision {
  readonly candidate_id: string;
  readonly decision: "ACCEPT" | "DOWNGRADE" | "REJECT" | "DEDUPLICATE";
  readonly reason_codes: readonly ContentAngleGateCode[];
  readonly supporting_fact_ids: readonly string[];
  readonly rank: number | null;
}

export interface ContentAngleDraftEvaluation {
  readonly status: "ACCEPTED" | "NO_STRONG_CONTENT_ANGLE";
  readonly rawCandidateCount: number;
  readonly materializedCandidates: readonly ContentAngleCandidateV2[];
  readonly acceptedAngles: readonly AcceptedContentAngleV2[];
  readonly decisions: readonly ContentAngleCanaryDecision[];
  readonly hostEvaluation: ContentAngleEvaluationReceipt;
}

export interface ContentAngleCanaryOptions {
  readonly provider: ModelProvider;
  readonly schemas: SchemaRegistry;
  readonly budget: ContentAngleCanaryBudget;
  readonly clock?: () => number;
}

export interface ContentAngleCanaryGenerationReceipt {
  readonly provider: "deepseek-api";
  readonly model: "deepseek-v4-pro";
  readonly paidRequests: 1;
  readonly httpAttempts: 1;
  readonly retries: 0;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheHitInputTokens: number | null;
  readonly cacheMissInputTokens: number | null;
  readonly thinking: "enabled";
  readonly reasoningEffort: "low";
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
  readonly hardBudgetUsd: number;
  readonly requestedOutputTokens: number;
  readonly promptCharacters: number;
  readonly estimatedInputTokens: number;
  readonly sourceCodeSentToModel: false;
  readonly readmeSentToModel: "NO";
  readonly evidenceRecordsSentToModel: false;
  readonly priorModelOutputsSentToModel: false;
  readonly factsAvailable: number;
  readonly factsSentToModel: number;
  readonly knownUnknownsSentToModel: number;
  readonly repairActions: readonly string[];
  readonly secretReads: 1;
  readonly repositoryExecutions: 0;
}

export interface ContentAngleCanaryFailureReceipt {
  readonly status: "FAIL_CLOSED";
  readonly failure_code: string;
  readonly provider_failure_code: string | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly thinking: ModelRequestConfiguration["thinking"] | null;
  readonly reasoning_effort: ModelRequestConfiguration["reasoningEffort"];
  readonly paid_requests: 0 | 1;
  readonly http_attempts: number;
  readonly retries: 0;
  readonly usage_preserved: boolean;
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
  readonly cache_hit_input_tokens: number | null;
  readonly cache_miss_input_tokens: number | null;
  readonly reasoning_tokens: number | null;
  readonly reasoning_content_characters: number | null;
  readonly visible_final_content_tokens: number | null;
  readonly visible_final_content_characters: number | null;
  readonly finish_reason: string | null;
  readonly truncated: boolean;
  readonly started_at: string;
  readonly completed_at: string;
  readonly duration_ms: number;
  readonly pricing_tier: "PEAK" | "OFF_PEAK";
  readonly actual_cost_usd: number | null;
  readonly peak_actual_cost_usd: number | null;
  readonly peak_budget_ledger_usd: number;
  readonly hard_budget_usd: number;
  readonly input_token_hard_limit: number;
  readonly output_token_hard_limit: number;
  readonly requested_output_tokens: number;
  readonly partial_content_persisted: false;
  readonly reasoning_content_persisted: false;
  readonly secret_reads: 1;
  readonly repository_executions: 0;
}

export interface ContentAngleCanaryResult {
  readonly status: ContentAngleDraftEvaluation["status"];
  readonly rawCandidates: ContentAngleCandidateDraftBundle;
  readonly rawModelOutput: string;
  readonly evaluation: ContentAngleDraftEvaluation;
  readonly acceptedAngles: readonly AcceptedContentAngleV2[];
  readonly decisions: readonly ContentAngleCanaryDecision[];
  readonly generation: ContentAngleCanaryGenerationReceipt;
}

export interface PreparedContentAngleCanary {
  readonly request: StructuredGenerationRequest;
  readonly modelInput: ContentAngleCanaryModelInput;
  readonly promptCharacters: number;
  readonly estimatedInputTokens: number;
  readonly preflightWorstCaseCostUsd: number;
  readonly factsAvailable: number;
  readonly factsSent: number;
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

function safeFailureCode(error: unknown): string {
  if (error instanceof OpenAICompatibleProviderError) return error.code;
  if (error instanceof Error && /^[A-Z0-9_]+(?::.*)?$/.test(error.message)) {
    return error.message.split(":", 1)[0] ?? "UNCLASSIFIED_FAILURE";
  }
  return "UNCLASSIFIED_FAILURE";
}

export function buildContentAngleCanaryFailureReceipt(
  error: unknown,
  budget: ContentAngleCanaryBudget,
  started: number,
  completed: number,
): ContentAngleCanaryFailureReceipt {
  if (
    !Number.isFinite(started) ||
    !Number.isFinite(completed) ||
    completed < started
  ) {
    throw new Error("CONTENT_ANGLE_CANARY_DURATION_INVALID");
  }
  const providerError =
    error instanceof OpenAICompatibleProviderError ? error : null;
  const telemetry = providerError?.telemetry;
  const providerFailureCode = providerError?.code ?? null;
  const failureCode =
    providerFailureCode === "TRUNCATED_OUTPUT" &&
    budget.requestedOutputTokens === 12_000
      ? "ANGLE_REASONING_RUNAWAY"
      : safeFailureCode(error);
  const attempts = providerError?.attempts ?? 1;
  const tier = pricingTierAt(started);
  const actualCost =
    telemetry === undefined
      ? null
      : calculateOpenAICompatibleCost(
          telemetry.usage,
          tier === "PEAK" ? budget.peakPricing : budget.offPeakPricing,
        ).totalCost;
  const peakActualCost =
    telemetry === undefined
      ? null
      : calculateOpenAICompatibleCost(telemetry.usage, budget.peakPricing)
          .totalCost;
  const peakBudgetLedger = calculateOpenAICompatibleCost(
    {
      inputTokens: budget.inputTokenHardLimit,
      outputTokens: budget.requestedOutputTokens,
    },
    budget.peakPricing,
  ).totalCost;

  return {
    status: "FAIL_CLOSED",
    failure_code: failureCode,
    provider_failure_code: providerFailureCode,
    provider: telemetry?.provider ?? null,
    model: telemetry?.model ?? null,
    thinking: telemetry?.requestConfiguration.thinking ?? null,
    reasoning_effort: telemetry?.requestConfiguration.reasoningEffort ?? null,
    paid_requests: attempts > 0 ? 1 : 0,
    http_attempts: attempts,
    retries: 0,
    usage_preserved: telemetry !== undefined,
    input_tokens: telemetry?.usage.inputTokens ?? null,
    output_tokens: telemetry?.usage.outputTokens ?? null,
    cache_hit_input_tokens: telemetry?.usage.cacheHitInputTokens ?? null,
    cache_miss_input_tokens: telemetry?.usage.cacheMissInputTokens ?? null,
    reasoning_tokens: telemetry?.reasoning.tokens ?? null,
    reasoning_content_characters:
      telemetry?.reasoning.contentCharacters ?? null,
    visible_final_content_tokens:
      telemetry?.reasoning.visibleContentTokens ?? null,
    visible_final_content_characters:
      telemetry?.visibleContentCharacters ?? null,
    finish_reason: telemetry?.finishReason ?? null,
    truncated: providerFailureCode === "TRUNCATED_OUTPUT",
    started_at: new Date(started).toISOString(),
    completed_at: new Date(completed).toISOString(),
    duration_ms: completed - started,
    pricing_tier: tier,
    actual_cost_usd: actualCost,
    peak_actual_cost_usd: peakActualCost,
    peak_budget_ledger_usd: peakBudgetLedger,
    hard_budget_usd: budget.hardBudgetUsd,
    input_token_hard_limit: budget.inputTokenHardLimit,
    output_token_hard_limit: budget.outputTokenHardLimit,
    requested_output_tokens: budget.requestedOutputTokens,
    partial_content_persisted: false,
    reasoning_content_persisted: false,
    secret_reads: 1,
    repository_executions: 0,
  };
}

export function evaluateContentAngleDraftBundle(
  bundle: ContentAngleCandidateDraftBundle,
  pack: GroundedFactPack,
  canonical: CanonicalGroundedBriefArtifact,
  schemas: SchemaRegistry,
): ContentAngleDraftEvaluation {
  if (bundle.draft_version !== 1 || bundle.candidates.length > 5) {
    throw new Error("CONTENT_ANGLE_DRAFT_CONTRACT_INVALID");
  }
  const candidateIds = bundle.candidates.map((candidate) => candidate.candidate_id);
  if (new Set(candidateIds).size !== candidateIds.length) {
    throw new Error("CONTENT_ANGLE_DRAFT_DUPLICATE_CANDIDATE_ID");
  }
  const facts = new Map(pack.facts.map((fact) => [fact.id, fact]));
  const materialized: ContentAngleCandidateV2[] = [];
  const preRejected = new Map<string, ContentAngleCanaryDecision>();

  for (const draft of bundle.candidates) {
    const hasUnknownBasisFact = draft.technical_basis.some(
      (basis) => !facts.has(basis.fact_id),
    );
    if (hasUnknownBasisFact) {
      preRejected.set(draft.candidate_id, {
        candidate_id: draft.candidate_id,
        decision: "REJECT",
        reason_codes: ["UNKNOWN_FACT_REFERENCE"],
        supporting_fact_ids: [...draft.supporting_fact_ids],
        rank: null,
      });
      continue;
    }
    const technicalBasis = draft.technical_basis.map((basis) => {
      const fact = facts.get(basis.fact_id);
      if (fact === undefined) {
        throw new Error("CONTENT_ANGLE_DRAFT_FACT_LOOKUP_DRIFT");
      }
      return {
        fact_id: fact.id,
        canonical_statement_id: basis.canonical_statement_id,
        subject_ref: fact.subject_ref,
        predicate: fact.predicate,
        object_ref: fact.object_ref,
        scope: fact.scope,
      };
    });
    materialized.push({
      content_angle_version: 2,
      id: draft.candidate_id,
      status: "CANDIDATE",
      rank: null,
      repository: { ...pack.repository },
      commit: pack.commit,
      fact_ir_version: pack.fact_ir_version,
      canonical_grounded_brief_version:
        canonical.canonical_grounded_brief_version,
      title: draft.title,
      angle_type: draft.angle_type,
      editorial_thesis: draft.editorial_thesis,
      editorial_reason: draft.editorial_reason,
      technical_basis: technicalBasis,
      supporting_fact_ids: [...draft.supporting_fact_ids],
      supporting_statement_ids: [...draft.supporting_statement_ids],
      why_interesting: draft.why_interesting,
      target_audience: [...draft.target_audience],
      confidence: {
        level: draft.confidence.level,
        basis: "EDITORIAL_JUDGMENT_NOT_FACT_VERIFICATION",
        rationale: draft.confidence.rationale,
      },
      novelty_assessment: {
        status: draft.novelty_assessment.status,
        claim_boundary: "NO_EXTERNAL_NOVELTY_CLAIM",
        rationale: draft.novelty_assessment.rationale,
      },
      educational_value: draft.educational_value,
      caveats: [...draft.caveats],
      unknown_dependencies: [...draft.unknown_dependencies],
      external_claims: [...draft.external_claims],
      technical_entities: draft.technical_entities.map((entity) => ({ ...entity })),
      fact_mutation_requests: [],
      claimed_scope: draft.claimed_scope,
      editorial_scores: { ...draft.editorial_scores },
    });
  }

  const hostEvaluation = evaluateContentAngleCandidates(
    materialized,
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
        supporting_fact_ids: [...trace.supporting_fact_ids],
        rank: trace.rank,
      } satisfies ContentAngleCanaryDecision,
    ]),
  );
  const decisions = bundle.candidates.map((candidate) => {
    const decision =
      preRejected.get(candidate.candidate_id) ??
      hostDecisions.get(candidate.candidate_id);
    if (decision === undefined) {
      throw new Error("CONTENT_ANGLE_DRAFT_DECISION_TRACE_MISSING");
    }
    return decision;
  });

  return {
    status:
      hostEvaluation.accepted_angles.length > 0
        ? "ACCEPTED"
        : "NO_STRONG_CONTENT_ANGLE",
    rawCandidateCount: bundle.candidates.length,
    materializedCandidates: materialized,
    acceptedAngles: hostEvaluation.accepted_angles,
    decisions,
    hostEvaluation,
  };
}

function positiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
}

export function buildContentAngleCanaryModelInput(
  pack: GroundedFactPack,
  canonical: CanonicalGroundedBriefArtifact,
): ContentAngleCanaryModelInput {
  const deterministic = buildDeterministicContentAngleInput(pack, canonical, {
    selected_fact_ids: canonical.selected_fact_ids,
  });
  const statements = deterministic.canonical_brief.statements;
  const canonicalUnknowns = projectCanonicalUnknowns(canonical);
  return {
    input_contract_version: 2,
    repository: { ...deterministic.repository },
    commit: deterministic.commit,
    truth_boundary: {
      facts_are_immutable: true,
      canonical_statements_are_context: true,
      known_unknowns_stay_unknown: true,
      allowed_actions: ["select", "rank", "group", "frame"],
      prohibited_actions: ["create", "upgrade", "rewrite", "replace"],
    },
    facts: deterministic.facts_by_category.flatMap((group) =>
      group.facts.map((fact) => ({
        id: fact.fact_id,
        fact_type: fact.fact_type,
        subject: { ...fact.subject },
        predicate: fact.predicate,
        object: { ...fact.object },
        scope: fact.scope,
        source_kind: fact.source_kind,
        limitations: [...fact.limitations],
        canonical_statements: statements
          .filter((statement) => statement.fact_ids.includes(fact.fact_id))
          .map((statement) => ({
            id: statement.statement_id,
            text: statement.text,
            kind: statement.kind,
            scope: statement.scope,
          })),
      })),
    ),
    known_unknowns: canonicalUnknowns.map((unknown) => ({
      unknown_id: unknown.unknown_id,
      category: unknown.category,
      canonical_text: unknown.canonical_text,
      scope: unknown.scope,
      status: unknown.status,
    })),
  };
}

export function prepareContentAngleCanary(
  pack: GroundedFactPack,
  canonical: CanonicalGroundedBriefArtifact,
  budget: ContentAngleCanaryBudget,
): PreparedContentAngleCanary {
  positiveInteger("inputTokenHardLimit", budget.inputTokenHardLimit);
  positiveInteger("outputTokenHardLimit", budget.outputTokenHardLimit);
  positiveInteger("requestedOutputTokens", budget.requestedOutputTokens);
  positiveInteger(
    "conservativeCharactersPerToken",
    budget.conservativeCharactersPerToken,
  );
  if (budget.hardBudgetUsd <= 0) throw new Error("hardBudgetUsd must be positive.");
  if (
    budget.requestedOutputTokens > budget.outputTokenHardLimit ||
    budget.maxCandidates !== 5 ||
    budget.maxAcceptedAngles !== 3 ||
    budget.maxPaidRequests !== 1 ||
    budget.maxHttpAttempts !== 1 ||
    budget.maxRetries !== 0
  ) {
    throw new Error("CONTENT_ANGLE_CANARY_AUTHORIZATION_MISMATCH");
  }
  const preflightCost = calculateOpenAICompatibleCost(
    {
      inputTokens: budget.inputTokenHardLimit,
      outputTokens: budget.requestedOutputTokens,
    },
    budget.peakPricing,
  );
  if (preflightCost.totalCost > budget.hardBudgetUsd) {
    throw new Error("CONTENT_ANGLE_CANARY_BUDGET_PREFLIGHT_FAILED");
  }

  const modelInput = buildContentAngleCanaryModelInput(pack, canonical);
  const request: StructuredGenerationRequest = {
    stage: "angles",
    schemaId: CONTENT_ANGLE_CANDIDATE_DRAFT_SCHEMA_ID,
    systemInstructions: [
      "Return JSON matching the schema; an honest empty result is {\"draft_version\":1,\"candidates\":[]}.",
      "Propose zero to five editorial Content Angle candidates from only the supplied immutable Facts, their bound Canonical statements, and Known Unknowns.",
      "The host owns truth and acceptance. You may only select, group, rank, and frame; never create, upgrade, rewrite, or replace a Fact.",
      "Do not add external comparisons, causal or exclusivity claims, performance, safety, outcomes, unsupported entities, or promote a Known Unknown.",
      "Keep every technical_basis item as Fact ID plus its bound Canonical statement ID. Do not produce scripts, hooks, outlines, posts, blogs, or video content.",
      "unknown_dependencies must contain only unknown_id strings copied exactly from supplied known_unknowns. Never repeat or paraphrase canonical_text in unknown_dependencies. Use an empty array when the angle does not depend on an unresolved Known Unknown.",
      "Use compact plain technical English and avoid causal connectors such as because, therefore, ensures, prevents, or leads to.",
    ].join(" "),
    untrustedRepositoryContext: [],
    untrustedRepositorySignals: { content_angle_input: modelInput },
    signalSerialization: "compact",
    repositoryReadReceipt: {
      highestScope: 0,
      filesConsidered: [],
      filesRead: [],
    },
    maxOutputTokens: budget.requestedOutputTokens,
    cacheKey: `${pack.repository.owner}/${pack.repository.name}:${pack.commit}:content-angle-canary-v2`,
  };
  const contract = structuredOutputContract(request.schemaId);
  if (contract === null) throw new Error("CONTENT_ANGLE_CANARY_SCHEMA_MISSING");
  const promptCharacters = buildStructuredPrompt(request, contract.schema).length;
  const estimatedInputTokens =
    Math.ceil(promptCharacters / budget.conservativeCharactersPerToken) + 256;
  if (estimatedInputTokens > budget.inputTokenHardLimit) {
    throw new Error("CONTENT_ANGLE_CANARY_INPUT_LIMIT_EXCEEDED");
  }
  return {
    request,
    modelInput,
    promptCharacters,
    estimatedInputTokens,
    preflightWorstCaseCostUsd: preflightCost.totalCost,
    factsAvailable: pack.facts.length,
    factsSent: modelInput.facts.length,
  };
}

export async function runContentAngleCanary(
  pack: GroundedFactPack,
  canonical: CanonicalGroundedBriefArtifact,
  options: ContentAngleCanaryOptions,
): Promise<ContentAngleCanaryResult> {
  const prepared = prepareContentAngleCanary(pack, canonical, options.budget);
  const clock = options.clock ?? Date.now;
  const started = clock();
  const modelResult = await options.provider.generateStructured<ContentAngleCandidateDraftBundle>(
    prepared.request,
  );
  const completed = clock();
  if (
    !Number.isFinite(started) ||
    !Number.isFinite(completed) ||
    completed < started
  ) {
    throw new Error("CONTENT_ANGLE_CANARY_DURATION_INVALID");
  }
  if (
    modelResult.provider !== "deepseek-api" ||
    modelResult.model !== "deepseek-v4-pro" ||
    modelResult.networkCalls !== 1 ||
    !modelResult.paid
  ) {
    throw new Error("CONTENT_ANGLE_CANARY_REQUEST_IDENTITY_INVALID");
  }
  if (
    modelResult.requestConfiguration?.thinking !== "enabled" ||
    modelResult.requestConfiguration.reasoningEffort !== "low"
  ) {
    throw new Error("CONTENT_ANGLE_CANARY_REQUEST_CONFIGURATION_INVALID");
  }
  if (modelResult.reasoning === undefined) {
    throw new Error("CONTENT_ANGLE_CANARY_REASONING_RECEIPT_MISSING");
  }
  if (
    modelResult.rawOutput === undefined ||
    modelResult.rawOutput.trim().length === 0 ||
    modelResult.finishReason !== "stop"
  ) {
    throw new Error("CONTENT_ANGLE_CANARY_RESPONSE_INCOMPLETE");
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
    throw new Error("CONTENT_ANGLE_CANARY_CONTEXT_DRIFT");
  }
  if (
    modelResult.usage.inputTokens > options.budget.inputTokenHardLimit ||
    modelResult.usage.outputTokens > options.budget.outputTokenHardLimit ||
    (modelResult.reasoning.tokens !== null &&
      modelResult.reasoning.tokens > modelResult.usage.outputTokens)
  ) {
    throw new Error("CONTENT_ANGLE_CANARY_ACTUAL_TOKEN_LIMIT_EXCEEDED");
  }

  const tier = pricingTierAt(started);
  const actualCost = calculateOpenAICompatibleCost(
    modelResult.usage,
    tier === "PEAK" ? options.budget.peakPricing : options.budget.offPeakPricing,
  );
  const peakActualCost = calculateOpenAICompatibleCost(
    modelResult.usage,
    options.budget.peakPricing,
  );
  if (
    actualCost.totalCost > options.budget.hardBudgetUsd ||
    peakActualCost.totalCost > options.budget.hardBudgetUsd
  ) {
    throw new Error("CONTENT_ANGLE_CANARY_ACTUAL_BUDGET_EXCEEDED");
  }

  const evaluation = evaluateContentAngleDraftBundle(
    modelResult.value,
    pack,
    canonical,
    options.schemas,
  );
  return {
    status: evaluation.status,
    rawCandidates: modelResult.value,
    rawModelOutput: modelResult.rawOutput,
    evaluation,
    acceptedAngles: evaluation.acceptedAngles,
    decisions: evaluation.decisions,
    generation: {
      provider: "deepseek-api",
      model: "deepseek-v4-pro",
      paidRequests: 1,
      httpAttempts: 1,
      retries: 0,
      inputTokens: modelResult.usage.inputTokens,
      outputTokens: modelResult.usage.outputTokens,
      cacheHitInputTokens: modelResult.usage.cacheHitInputTokens ?? null,
      cacheMissInputTokens: modelResult.usage.cacheMissInputTokens ?? null,
      thinking: "enabled",
      reasoningEffort: "low",
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
      actualCostUsd: actualCost.totalCost,
      peakActualCostUsd: peakActualCost.totalCost,
      peakBudgetLedgerUsd: prepared.preflightWorstCaseCostUsd,
      hardBudgetUsd: options.budget.hardBudgetUsd,
      requestedOutputTokens: options.budget.requestedOutputTokens,
      promptCharacters: prepared.promptCharacters,
      estimatedInputTokens: prepared.estimatedInputTokens,
      sourceCodeSentToModel: false,
      readmeSentToModel: "NO",
      evidenceRecordsSentToModel: false,
      priorModelOutputsSentToModel: false,
      factsAvailable: prepared.factsAvailable,
      factsSentToModel: prepared.factsSent,
      knownUnknownsSentToModel: prepared.modelInput.known_unknowns.length,
      repairActions: [...modelResult.context.repairActions],
      secretReads: 1,
      repositoryExecutions: 0,
    },
  };
}
