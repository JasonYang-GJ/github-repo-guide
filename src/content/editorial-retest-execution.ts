import {
  createDeepSeekV4ProNonThinkingProvider,
  DEEPSEEK_V4_PRO_PROFILE,
} from "../model/deepseek-profile.js";
import {
  calculateOpenAICompatibleCost,
  OpenAICompatibleProviderError,
  type OpenAICompatiblePricing,
} from "../model/openai-compatible-provider.js";
import type { ModelProvider, ModelResult } from "../model/provider.js";
import type { CanonicalGroundedBriefArtifact } from "../brief/canonical.js";
import type { GroundedFactPack } from "../facts/domain.js";
import type { SchemaRegistry } from "../schemas/registry.js";
import type {
  CanonicalEditorialAngleInputV2,
} from "./editorial-angle-input.js";
import type {
  PreparedVs05EPositiveBenchmarkRetest,
} from "./editorial-retest.js";
import {
  evaluateMinimalAngleDecisionDraftV2,
  type MinimalAngleDecisionDraftV2,
} from "./editorial-retest.js";
import type { MinimalAngleDecisionEvaluation } from "./angle-routing.js";
import { EDITORIAL_FACT_CLUSTER_SET_VERSION } from "./editorial-fact-clusters.js";
import type { OpenAICompatibleChatCompletionsRequestBody } from "../model/openai-compatible-request.js";

export const VS05_E_HARD_BUDGET_USD = 0.1 as const;

export interface Vs05EOfficialPricingSnapshot {
  readonly pricing_snapshot_version: 1;
  readonly verified_on: string;
  readonly source_url: string;
  readonly provider: "DeepSeek API";
  readonly model: "deepseek-v4-pro";
  readonly model_version: "DeepSeek-V4-Pro-0813";
  readonly base_url: "https://api.deepseek.com";
  readonly model_verification_url: "https://api-docs.deepseek.com/api/list-models/";
  readonly thinking_mode_url: "https://api-docs.deepseek.com/guides/thinking_mode/";
  readonly currency: "USD";
  readonly hard_budget_pricing_basis: "PEAK_WORST_CASE";
  readonly pricing_schedule_timezone: "UTC";
  readonly peak_windows_weekdays_utc: readonly ["01:00-04:00", "06:00-10:00"];
  readonly input_cache_hit_off_peak_usd_per_million: number;
  readonly input_cache_miss_off_peak_usd_per_million: number;
  readonly output_off_peak_usd_per_million: number;
  readonly input_cache_hit_usd_per_million: number;
  readonly input_cache_miss_usd_per_million: number;
  readonly output_usd_per_million: number;
}

export interface Vs05EExecutionPreflight {
  readonly status: "VS05_E_REAL_REQUEST_READY";
  readonly baseline_sha: string;
  readonly repository: "https://github.com/tt-a1i/archify";
  readonly commit: "c826e6c3a7abad19c0f3cd1ca57207d54b1ad8de";
  readonly editorial_angle_input_version: 2;
  readonly request_preview_drift: "PASS";
  readonly editorial_input_drift: "PASS";
  readonly official_pricing: Vs05EOfficialPricingSnapshot;
  readonly worst_case_cost_usd: number;
  readonly hard_budget_usd: typeof VS05_E_HARD_BUDGET_USD;
  readonly input_token_ceiling: 15_000;
  readonly output_token_ceiling: 12_000;
  readonly facts_available: number;
  readonly facts_sent: number;
  readonly known_unknowns_sent: number;
  readonly cluster_count: number;
  readonly cluster_version: typeof EDITORIAL_FACT_CLUSTER_SET_VERSION;
  readonly thinking: "DISABLED";
  readonly reasoning_effort_sent: false;
  readonly max_paid_requests: 1;
  readonly max_http_attempts: 1;
  readonly retries: 0;
  readonly resamples: 0;
  readonly secret_reads: 0;
  readonly repository_executions: 0;
  readonly prepared: PreparedVs05EPositiveBenchmarkRetest;
}

export interface PrepareVs05EExecutionPreflightInput {
  readonly baselineSha: string;
  readonly prepared: PreparedVs05EPositiveBenchmarkRetest;
  readonly approvedPreview: OpenAICompatibleChatCompletionsRequestBody;
  readonly frozenInput: CanonicalEditorialAngleInputV2;
  readonly pricing: Vs05EOfficialPricingSnapshot;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

type Vs05EPricingBand = "PEAK" | "OFF_PEAK";

function pricingFromSnapshot(
  snapshot: Vs05EOfficialPricingSnapshot,
  band: Vs05EPricingBand = "PEAK",
): OpenAICompatiblePricing {
  if (band === "OFF_PEAK") {
    return {
      currency: snapshot.currency,
      inputCacheHitUsdPerMillion:
        snapshot.input_cache_hit_off_peak_usd_per_million,
      inputCacheMissUsdPerMillion:
        snapshot.input_cache_miss_off_peak_usd_per_million,
      outputUsdPerMillion: snapshot.output_off_peak_usd_per_million,
    };
  }
  return {
    currency: snapshot.currency,
    inputCacheHitUsdPerMillion:
      snapshot.input_cache_hit_usd_per_million,
    inputCacheMissUsdPerMillion:
      snapshot.input_cache_miss_usd_per_million,
    outputUsdPerMillion: snapshot.output_usd_per_million,
  };
}

function pricingBandAt(timestampMs: number): Vs05EPricingBand {
  const date = new Date(timestampMs);
  const weekday = date.getUTCDay();
  const minuteOfDay = date.getUTCHours() * 60 + date.getUTCMinutes();
  const isWeekday = weekday >= 1 && weekday <= 5;
  const isPeakWindow =
    (minuteOfDay >= 60 && minuteOfDay < 240) ||
    (minuteOfDay >= 360 && minuteOfDay < 600);
  return isWeekday && isPeakWindow ? "PEAK" : "OFF_PEAK";
}

function assertOfficialPricing(
  snapshot: Vs05EOfficialPricingSnapshot,
): OpenAICompatiblePricing {
  let source: URL;
  try {
    source = new URL(snapshot.source_url);
  } catch {
    throw new Error("VS05_E_OFFICIAL_PRICING_SOURCE_INVALID");
  }
  if (
    source.protocol !== "https:" ||
    source.hostname !== "api-docs.deepseek.com" ||
    snapshot.verified_on !== "2026-09-02" ||
    snapshot.provider !== "DeepSeek API" ||
    snapshot.model !== DEEPSEEK_V4_PRO_PROFILE.model ||
    snapshot.model_version !== DEEPSEEK_V4_PRO_PROFILE.modelVersion ||
    snapshot.base_url !== DEEPSEEK_V4_PRO_PROFILE.baseUrl ||
    snapshot.model_verification_url !==
      "https://api-docs.deepseek.com/api/list-models/" ||
    snapshot.thinking_mode_url !==
      "https://api-docs.deepseek.com/guides/thinking_mode/" ||
    snapshot.currency !== "USD" ||
    snapshot.hard_budget_pricing_basis !== "PEAK_WORST_CASE" ||
    snapshot.pricing_schedule_timezone !== "UTC" ||
    !sameJson(snapshot.peak_windows_weekdays_utc, [
      "01:00-04:00",
      "06:00-10:00",
    ])
  ) {
    throw new Error("VS05_E_OFFICIAL_PRICING_SOURCE_INVALID");
  }
  const pricing = pricingFromSnapshot(snapshot);
  if (
    pricing.inputCacheHitUsdPerMillion !==
      DEEPSEEK_V4_PRO_PROFILE.inputCacheHitUsdPerMillion ||
    pricing.inputCacheMissUsdPerMillion !==
      DEEPSEEK_V4_PRO_PROFILE.inputCacheMissUsdPerMillion ||
    pricing.outputUsdPerMillion !== DEEPSEEK_V4_PRO_PROFILE.outputUsdPerMillion ||
    snapshot.input_cache_hit_off_peak_usd_per_million !== 0.022 ||
    snapshot.input_cache_miss_off_peak_usd_per_million !== 0.66 ||
    snapshot.output_off_peak_usd_per_million !== 1.98
  ) {
    throw new Error("OFFICIAL_PRICING_PROFILE_DRIFT");
  }
  return pricing;
}

export function prepareVs05EExecutionPreflight(
  input: PrepareVs05EExecutionPreflightInput,
): Vs05EExecutionPreflight {
  const { prepared } = input;
  if (!sameJson(prepared.request_preview, input.approvedPreview)) {
    throw new Error("REQUEST_PREVIEW_DRIFT");
  }
  if (!sameJson(prepared.editorial_input, input.frozenInput)) {
    throw new Error("EDITORIAL_INPUT_DRIFT");
  }
  if (
    input.baselineSha !==
      "b1bc98d762938001cea26b7c5cd9f04d47523e38" ||
    prepared.editorial_input.repository.url !==
      "https://github.com/tt-a1i/archify" ||
    prepared.editorial_input.commit !==
      "c826e6c3a7abad19c0f3cd1ca57207d54b1ad8de" ||
    prepared.editorial_input.input_version !== 2 ||
    prepared.routing.status !== "PREFLIGHT_ONLY_NOT_AUTHORIZED" ||
    prepared.routing.provider !== "DeepSeek API" ||
    prepared.routing.model !== "deepseek-v4-pro" ||
    prepared.routing.thinking !== "disabled" ||
    prepared.routing.reasoning_effort !== "not sent" ||
    prepared.routing.maximum_requests !== 1 ||
    prepared.routing.maximum_http_attempts !== 1 ||
    prepared.routing.maximum_retries !== 0 ||
    prepared.routing.input_token_hard_limit !== 15_000 ||
    prepared.routing.output_token_hard_limit !== 12_000
  ) {
    throw new Error("VS05_E_APPROVED_EXECUTION_IDENTITY_INVALID");
  }
  const pricing = assertOfficialPricing(input.pricing);
  const worstCaseCost = calculateOpenAICompatibleCost(
    { inputTokens: 15_000, outputTokens: 12_000 },
    pricing,
  ).totalCost;
  if (worstCaseCost > VS05_E_HARD_BUDGET_USD) {
    throw new Error("VS05_E_WORST_CASE_BUDGET_EXCEEDED");
  }

  return {
    status: "VS05_E_REAL_REQUEST_READY",
    baseline_sha: input.baselineSha,
    repository: "https://github.com/tt-a1i/archify",
    commit: "c826e6c3a7abad19c0f3cd1ca57207d54b1ad8de",
    editorial_angle_input_version: 2,
    request_preview_drift: "PASS",
    editorial_input_drift: "PASS",
    official_pricing: input.pricing,
    worst_case_cost_usd: worstCaseCost,
    hard_budget_usd: VS05_E_HARD_BUDGET_USD,
    input_token_ceiling: 15_000,
    output_token_ceiling: 12_000,
    facts_available: prepared.facts_available,
    facts_sent: prepared.facts_included,
    known_unknowns_sent: prepared.known_unknowns_included,
    cluster_count: prepared.clusters_included,
    cluster_version: EDITORIAL_FACT_CLUSTER_SET_VERSION,
    thinking: "DISABLED",
    reasoning_effort_sent: false,
    max_paid_requests: 1,
    max_http_attempts: 1,
    retries: 0,
    resamples: 0,
    secret_reads: 0,
    repository_executions: 0,
    prepared,
  };
}

export interface Vs05ERequestAuditReceipt {
  readonly status: "PASS" | "FAIL" | "PENDING";
  readonly inspections: number;
  readonly transport_calls: number;
  readonly actual_request_body_match: boolean | null;
  readonly failure_code: "REQUEST_PREVIEW_DRIFT" | "REQUEST_TRANSPORT_METADATA_DRIFT" | null;
}

export interface Vs05ERequestAudit {
  readonly fetch: typeof fetch;
  readonly receipt: () => Vs05ERequestAuditReceipt;
}

export function createVs05ERequestAudit(
  approvedPreview: OpenAICompatibleChatCompletionsRequestBody,
  transport: typeof fetch,
): Vs05ERequestAudit {
  let inspections = 0;
  let transportCalls = 0;
  let actualRequestBodyMatch: boolean | null = null;
  let failureCode: Vs05ERequestAuditReceipt["failure_code"] = null;
  const expectedBody = JSON.stringify(approvedPreview);

  const auditedFetch: typeof fetch = async (input, init) => {
    inspections += 1;
    const requestUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (
      requestUrl !== "https://api.deepseek.com/chat/completions" ||
      init?.method !== "POST"
    ) {
      actualRequestBodyMatch = false;
      failureCode = "REQUEST_TRANSPORT_METADATA_DRIFT";
      throw new Error("REQUEST_TRANSPORT_METADATA_DRIFT");
    }
    let body: unknown;
    try {
      body = JSON.parse(String(init.body));
    } catch {
      actualRequestBodyMatch = false;
      failureCode = "REQUEST_PREVIEW_DRIFT";
      throw new Error("REQUEST_PREVIEW_DRIFT");
    }
    actualRequestBodyMatch = JSON.stringify(body) === expectedBody;
    if (!actualRequestBodyMatch) {
      failureCode = "REQUEST_PREVIEW_DRIFT";
      throw new Error("REQUEST_PREVIEW_DRIFT");
    }
    transportCalls += 1;
    return transport(input, init);
  };

  return {
    fetch: auditedFetch,
    receipt: () => ({
      status:
        failureCode !== null
          ? "FAIL"
          : actualRequestBodyMatch === true
            ? "PASS"
            : "PENDING",
      inspections,
      transport_calls: transportCalls,
      actual_request_body_match: actualRequestBodyMatch,
      failure_code: failureCode,
    }),
  };
}

export interface Vs05EGenerationReceipt {
  readonly provider: "deepseek-api";
  readonly model: "deepseek-v4-pro";
  readonly thinking: "DISABLED";
  readonly reasoningEffortSent: false;
  readonly paidRequests: 1;
  readonly httpAttempts: 1;
  readonly retries: 0;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheHitInputTokens: number | null;
  readonly cacheMissInputTokens: number | null;
  readonly reasoningTokens: number | null;
  readonly reasoningContentCharacters: 0;
  readonly visibleFinalContentTokens: number | null;
  readonly visibleFinalContentCharacters: number;
  readonly pricingBand: Vs05EPricingBand;
  readonly finishReason: "stop";
  readonly truncated: false;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly actualCostUsd: number;
  readonly peakBudgetUsd: number;
  readonly outputCeiling: 12_000;
  readonly repositoryExecutions: 0;
}

export interface Vs05EPositiveBenchmarkResult {
  readonly status: MinimalAngleDecisionEvaluation["status"];
  readonly rawCandidates: MinimalAngleDecisionDraftV2;
  readonly rawModelOutput: string;
  readonly evaluation: MinimalAngleDecisionEvaluation;
  readonly generation: Vs05EGenerationReceipt;
}

export interface Vs05EFailureReceipt {
  readonly status: "FAIL_CLOSED";
  readonly failure_code: string;
  readonly provider_failure_code: string | null;
  readonly paid_requests: 0 | 1;
  readonly http_attempts: number;
  readonly retries: 0;
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
  readonly finish_reason: string | null;
  readonly truncated: boolean;
  readonly duration_ms: number;
  readonly actual_cost_usd: number | null;
  readonly pricing_band: Vs05EPricingBand | null;
  readonly partial_content_persisted: false;
  readonly reasoning_content_persisted: false;
  readonly repository_executions: 0;
}

export type Vs05EPositiveBenchmarkOutcome =
  | { readonly status: "COMPLETED"; readonly result: Vs05EPositiveBenchmarkResult }
  | { readonly status: "FAIL_CLOSED"; readonly failure: Vs05EFailureReceipt };

function safeFailureCode(error: unknown): string {
  if (error instanceof OpenAICompatibleProviderError) return error.code;
  if (error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message)) {
    return error.message;
  }
  return "UNCLASSIFIED_FAILURE";
}

function usageCost(
  modelResult: ModelResult<MinimalAngleDecisionDraftV2> | undefined,
  providerError: OpenAICompatibleProviderError | null,
  pricing: Vs05EOfficialPricingSnapshot,
  timestampMs: number,
): number | null {
  const usage = providerError?.telemetry?.usage ?? modelResult?.usage;
  return usage === undefined
    ? null
    : calculateOpenAICompatibleCost(
        usage,
        pricingFromSnapshot(pricing, pricingBandAt(timestampMs)),
      ).totalCost;
}

function buildFailureReceipt(
  error: unknown,
  modelResult: ModelResult<MinimalAngleDecisionDraftV2> | undefined,
  preflight: Vs05EExecutionPreflight,
  started: number,
  completed: number,
): Vs05EFailureReceipt {
  const providerError =
    error instanceof OpenAICompatibleProviderError ? error : null;
  const telemetry = providerError?.telemetry;
  const usage = telemetry?.usage ?? modelResult?.usage;
  const attempts = providerError?.attempts ?? modelResult?.networkCalls ?? 0;
  if (attempts > 1) {
    throw new Error("VS05_E_REQUEST_BOUNDARY_VIOLATED");
  }
  return {
    status: "FAIL_CLOSED",
    failure_code: safeFailureCode(error),
    provider_failure_code: providerError?.code ?? null,
    paid_requests:
      attempts > 0 || modelResult?.paid === true ? 1 : 0,
    http_attempts: attempts,
    retries: 0,
    input_tokens: usage?.inputTokens ?? null,
    output_tokens: usage?.outputTokens ?? null,
    finish_reason: telemetry?.finishReason ?? modelResult?.finishReason ?? null,
    truncated: providerError?.code === "TRUNCATED_OUTPUT",
    duration_ms: completed - started,
    actual_cost_usd: usageCost(
      modelResult,
      providerError,
      preflight.official_pricing,
      started,
    ),
    pricing_band: pricingBandAt(started),
    partial_content_persisted: false,
    reasoning_content_persisted: false,
    repository_executions: 0,
  };
}

function assertCompletedResult(
  result: ModelResult<MinimalAngleDecisionDraftV2>,
  preflight: Vs05EExecutionPreflight,
): void {
  if (
    result.provider !== "deepseek-api" ||
    result.model !== "deepseek-v4-pro" ||
    result.networkCalls !== 1 ||
    !result.paid ||
    result.requestConfiguration?.thinking !== "disabled" ||
    result.requestConfiguration.reasoningEffort !== null ||
    result.rawOutput === undefined ||
    result.rawOutput.trim().length === 0 ||
    result.finishReason !== "stop" ||
    result.reasoning === undefined ||
    result.reasoning.contentCharacters !== 0 ||
    (result.reasoning.tokens !== null && result.reasoning.tokens !== 0)
  ) {
    throw new Error("VS05_E_RESPONSE_IDENTITY_INVALID");
  }
  if (
    result.context.promptStage !== "angles" ||
    result.context.highestReadScope !== 0 ||
    result.context.filesConsidered.length !== 0 ||
    result.context.filesRead.length !== 0 ||
    result.context.filesPassed.length !== 0 ||
    result.context.repositoryCharactersPassed !== 0 ||
    result.context.promptCharacters !== preflight.prepared.prompt_characters ||
    !result.context.schemaValidated ||
    result.context.endpoint !== "remote_https"
  ) {
    throw new Error("VS05_E_CONTEXT_DRIFT");
  }
  if (
    result.usage.inputTokens > preflight.input_token_ceiling ||
    result.usage.outputTokens > preflight.output_token_ceiling
  ) {
    throw new Error("VS05_E_ACTUAL_TOKEN_LIMIT_EXCEEDED");
  }
}

export async function runVs05EPositiveBenchmark(
  preflight: Vs05EExecutionPreflight,
  provider: ModelProvider,
  pack: GroundedFactPack,
  canonical: CanonicalGroundedBriefArtifact,
  schemas: SchemaRegistry,
  clock: () => number = Date.now,
): Promise<Vs05EPositiveBenchmarkOutcome> {
  const started = clock();
  let modelResult: ModelResult<MinimalAngleDecisionDraftV2> | undefined;
  try {
    modelResult =
      await provider.generateStructured<MinimalAngleDecisionDraftV2>(
        preflight.prepared.structured_request,
      );
    const completed = clock();
    if (
      !Number.isFinite(started) ||
      !Number.isFinite(completed) ||
      completed < started
    ) {
      throw new Error("VS05_E_DURATION_INVALID");
    }
    assertCompletedResult(modelResult, preflight);
    const evaluation = evaluateMinimalAngleDecisionDraftV2(
      modelResult.value,
      pack,
      canonical,
      schemas,
    );
    if (evaluation.acceptedAngles.length > 3) {
      throw new Error("VS05_E_ACCEPTED_ANGLE_LIMIT_EXCEEDED");
    }
    const pricingBand = pricingBandAt(started);
    const actualCost = calculateOpenAICompatibleCost(
      modelResult.usage,
      pricingFromSnapshot(preflight.official_pricing, pricingBand),
    ).totalCost;
    if (actualCost > preflight.hard_budget_usd) {
      throw new Error("VS05_E_ACTUAL_BUDGET_EXCEEDED");
    }
    return {
      status: "COMPLETED",
      result: {
        status: evaluation.status,
        rawCandidates: modelResult.value,
        rawModelOutput: modelResult.rawOutput as string,
        evaluation,
        generation: {
          provider: "deepseek-api",
          model: "deepseek-v4-pro",
          thinking: "DISABLED",
          reasoningEffortSent: false,
          paidRequests: 1,
          httpAttempts: 1,
          retries: 0,
          inputTokens: modelResult.usage.inputTokens,
          outputTokens: modelResult.usage.outputTokens,
          cacheHitInputTokens:
            modelResult.usage.cacheHitInputTokens ?? null,
          cacheMissInputTokens:
            modelResult.usage.cacheMissInputTokens ?? null,
          reasoningTokens: modelResult.reasoning?.tokens ?? null,
          reasoningContentCharacters: 0,
          visibleFinalContentTokens:
            modelResult.reasoning?.visibleContentTokens ?? null,
          visibleFinalContentCharacters: (modelResult.rawOutput as string).length,
          pricingBand,
          finishReason: "stop",
          truncated: false,
          startedAt: new Date(started).toISOString(),
          completedAt: new Date(completed).toISOString(),
          durationMs: completed - started,
          actualCostUsd: actualCost,
          peakBudgetUsd: preflight.worst_case_cost_usd,
          outputCeiling: 12_000,
          repositoryExecutions: 0,
        },
      },
    };
  } catch (error) {
    const completed = clock();
    return {
      status: "FAIL_CLOSED",
      failure: buildFailureReceipt(
        error,
        modelResult,
        preflight,
        started,
        completed,
      ),
    };
  }
}

export interface ExecuteVs05EAuthorizedOptions {
  readonly preflight: Vs05EExecutionPreflight;
  readonly pack: GroundedFactPack;
  readonly canonical: CanonicalGroundedBriefArtifact;
  readonly schemas: SchemaRegistry;
  readonly readSecret: () => string | undefined;
  readonly transport: typeof fetch;
  readonly clock?: () => number;
}

export interface ExecuteVs05EAuthorizedResult {
  readonly secret_reads: 1;
  readonly request_audit: Vs05ERequestAuditReceipt;
  readonly outcome: Vs05EPositiveBenchmarkOutcome;
}

function missingSecretOutcome(): Vs05EPositiveBenchmarkOutcome {
  return {
    status: "FAIL_CLOSED",
    failure: {
      status: "FAIL_CLOSED",
      failure_code: "DEEPSEEK_API_KEY_NOT_CONFIGURED",
      provider_failure_code: "API_KEY_NOT_CONFIGURED",
      paid_requests: 0,
      http_attempts: 0,
      retries: 0,
      input_tokens: null,
      output_tokens: null,
      finish_reason: null,
      truncated: false,
      duration_ms: 0,
      actual_cost_usd: null,
      pricing_band: null,
      partial_content_persisted: false,
      reasoning_content_persisted: false,
      repository_executions: 0,
    },
  };
}

export async function executeVs05EAuthorized(
  options: ExecuteVs05EAuthorizedOptions,
): Promise<ExecuteVs05EAuthorizedResult> {
  const secret = options.readSecret();
  if (secret === undefined || secret.length === 0) {
    return {
      secret_reads: 1,
      request_audit: {
        status: "PENDING",
        inspections: 0,
        transport_calls: 0,
        actual_request_body_match: null,
        failure_code: null,
      },
      outcome: missingSecretOutcome(),
    };
  }
  const requestAudit = createVs05ERequestAudit(
    options.preflight.prepared.request_preview,
    options.transport,
  );
  const provider = createDeepSeekV4ProNonThinkingProvider({
    environment: { DEEPSEEK_API_KEY: secret },
    fetch: requestAudit.fetch,
    maxRetries: 0,
  });
  const outcome = await runVs05EPositiveBenchmark(
    options.preflight,
    provider,
    options.pack,
    options.canonical,
    options.schemas,
    options.clock,
  );
  return {
    secret_reads: 1,
    request_audit: requestAudit.receipt(),
    outcome,
  };
}
