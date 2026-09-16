import {
  createDeepSeekV4ProNonThinkingProvider,
  DEEPSEEK_V4_PRO_PROFILE,
} from "../model/deepseek-profile.js";
import {
  calculateOpenAICompatibleCost,
  OpenAICompatibleProviderError,
  type OpenAICompatiblePricing,
} from "../model/openai-compatible-provider.js";
import {
  buildOpenAICompatibleChatCompletionsRequestBody,
  OPENAI_COMPATIBLE_BOUNDED_SYSTEM_MESSAGE,
  type OpenAICompatibleChatCompletionsRequestBody,
} from "../model/openai-compatible-request.js";
import type {
  ModelResult,
  StructuredGenerationRequest,
} from "../model/provider.js";
import { buildStructuredPrompt } from "../model/structured-prompt.js";
import { structuredOutputContract } from "../model/structured-output.js";
import type { CanonicalGroundedBriefArtifact } from "../brief/canonical.js";
import type { GroundedFactPack } from "../facts/domain.js";
import type { SchemaRegistry } from "../schemas/registry.js";
import type { DeterministicContentAngleInput } from "./angle-contract.js";
import {
  buildStage2EditorialFramingInput,
  evaluateEditorialFramingDraft,
  evaluateFactCompositionProposalDraft,
  prepareTwoStageEditorialRequestPreviews,
  type EditorialFramingDraftV1,
  type EditorialFramingEvaluationReceipt,
  type FactCompositionEvaluationReceipt,
  type FactCompositionProposalDraftV1,
  type Stage1FactCompositionInput,
  type Stage2EditorialFramingInput,
  type TwoStageEditorialRequestPreviews,
} from "./editorial-composition.js";
import type { FlatModelFactReferenceMap } from "./model-fact-reference.js";

export const VS05_G_BASELINE_SHA =
  "98f16237568081399055ea4e29e3779c67fcc0c6" as const;
export const VS05_G_ARCHIFY_COMMIT =
  "c826e6c3a7abad19c0f3cd1ca57207d54b1ad8de" as const;
export const VS05_G_HARD_BUDGET_USD = 0.2 as const;
export const VS05_G_STAGE1_INPUT_TOKEN_CEILING = 15_000 as const;
export const VS05_G_STAGE1_OUTPUT_TOKEN_CEILING = 8_000 as const;
export const VS05_G_STAGE2_INPUT_TOKEN_CEILING = 12_000 as const;
export const VS05_G_STAGE2_OUTPUT_TOKEN_CEILING = 12_000 as const;
export const VS05_G_CONSERVATIVE_CHARACTERS_PER_TOKEN = 3 as const;

export interface Vs05GOfficialPricingSnapshot {
  readonly pricing_snapshot_version: 1;
  readonly verified_on: "2026-09-02";
  readonly source_url: "https://api-docs.deepseek.com/quick_start/pricing/";
  readonly provider: "DeepSeek API";
  readonly model: "deepseek-v4-pro";
  readonly model_version: "DeepSeek-V4-Pro-0813";
  readonly base_url: "https://api.deepseek.com";
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

export interface Vs05GPreparedStage {
  readonly contract_preview_drift: "PASS";
  readonly input_token_ceiling: number;
  readonly output_token_ceiling: number;
  readonly prompt_characters: number;
  readonly model_input_characters: number;
  readonly estimated_input_tokens: number;
  readonly structured_request: StructuredGenerationRequest;
  readonly approved_request: OpenAICompatibleChatCompletionsRequestBody;
}

export interface Vs05GExecutionPreflight {
  readonly status: "VS05_G_REAL_REQUEST_READY";
  readonly baseline_sha: typeof VS05_G_BASELINE_SHA;
  readonly repository: "https://github.com/tt-a1i/archify";
  readonly tag: "v2.16.0";
  readonly commit: typeof VS05_G_ARCHIFY_COMMIT;
  readonly provider: "DeepSeek API";
  readonly model: "deepseek-v4-pro";
  readonly thinking: "DISABLED";
  readonly reasoning_effort_sent: false;
  readonly source_input: "FLAT_V1";
  readonly rejected_input: "CLUSTERED_V2";
  readonly experimental_flow: "TWO_STAGE_COMPOSITION";
  readonly stage1: Vs05GPreparedStage & {
    readonly input_token_ceiling: typeof VS05_G_STAGE1_INPUT_TOKEN_CEILING;
    readonly output_token_ceiling: typeof VS05_G_STAGE1_OUTPUT_TOKEN_CEILING;
  };
  readonly stage2_template: Vs05GPreparedStage & {
    readonly input_token_ceiling: typeof VS05_G_STAGE2_INPUT_TOKEN_CEILING;
    readonly output_token_ceiling: typeof VS05_G_STAGE2_OUTPUT_TOKEN_CEILING;
  };
  readonly official_pricing: Vs05GOfficialPricingSnapshot;
  readonly stage1_peak_worst_case_cost_usd: number;
  readonly stage2_peak_worst_case_cost_usd: number;
  readonly worst_case_cost_usd: number;
  readonly hard_budget_usd: typeof VS05_G_HARD_BUDGET_USD;
  readonly max_paid_requests: 2;
  readonly max_http_attempts: 2;
  readonly retries: 0;
  readonly regenerations: 0;
  readonly resamples: 0;
  readonly secret_reads: 0;
  readonly repository_executions: 0;
  readonly stage1_input: Stage1FactCompositionInput;
  readonly frozen_previews: TwoStageEditorialRequestPreviews;
}

export interface PrepareVs05GExecutionPreflightInput {
  readonly baselineSha: string;
  readonly stage1Input: Stage1FactCompositionInput;
  readonly frozenPreviews: TwoStageEditorialRequestPreviews;
  readonly pricing: Vs05GOfficialPricingSnapshot;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function money(value: number): number {
  return Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;
}

function peakPricing(
  snapshot: Vs05GOfficialPricingSnapshot,
): OpenAICompatiblePricing {
  return {
    currency: snapshot.currency,
    inputCacheHitUsdPerMillion: snapshot.input_cache_hit_usd_per_million,
    inputCacheMissUsdPerMillion: snapshot.input_cache_miss_usd_per_million,
    outputUsdPerMillion: snapshot.output_usd_per_million,
  };
}

function assertOfficialPricing(
  snapshot: Vs05GOfficialPricingSnapshot,
): OpenAICompatiblePricing {
  let source: URL;
  try {
    source = new URL(snapshot.source_url);
  } catch {
    throw new Error("VS05_G_OFFICIAL_PRICING_SOURCE_INVALID");
  }
  if (
    source.protocol !== "https:" ||
    source.hostname !== "api-docs.deepseek.com" ||
    snapshot.verified_on !== "2026-09-02" ||
    snapshot.provider !== "DeepSeek API" ||
    snapshot.model !== DEEPSEEK_V4_PRO_PROFILE.model ||
    snapshot.model_version !== DEEPSEEK_V4_PRO_PROFILE.modelVersion ||
    snapshot.base_url !== DEEPSEEK_V4_PRO_PROFILE.baseUrl ||
    snapshot.currency !== "USD" ||
    snapshot.hard_budget_pricing_basis !== "PEAK_WORST_CASE" ||
    snapshot.pricing_schedule_timezone !== "UTC" ||
    !sameJson(snapshot.peak_windows_weekdays_utc, [
      "01:00-04:00",
      "06:00-10:00",
    ])
  ) {
    throw new Error("VS05_G_OFFICIAL_PRICING_SOURCE_INVALID");
  }
  const pricing = peakPricing(snapshot);
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
    throw new Error("VS05_G_OFFICIAL_PRICING_PROFILE_DRIFT");
  }
  return pricing;
}

function prepareStage(
  request: StructuredGenerationRequest,
  inputTokenCeiling: number,
  outputTokenCeiling: number,
): Vs05GPreparedStage {
  const contract = structuredOutputContract(request.schemaId);
  if (contract === null) {
    throw new Error("VS05_G_STRUCTURED_OUTPUT_CONTRACT_MISSING");
  }
  const structuredRequest = {
    ...request,
    maxOutputTokens: outputTokenCeiling,
  };
  const prompt = buildStructuredPrompt(structuredRequest, contract.schema);
  const modelInputCharacters =
    OPENAI_COMPATIBLE_BOUNDED_SYSTEM_MESSAGE.length + prompt.length;
  const estimatedInputTokens =
    Math.ceil(
      modelInputCharacters / VS05_G_CONSERVATIVE_CHARACTERS_PER_TOKEN,
    ) + 256;
  if (estimatedInputTokens > inputTokenCeiling) {
    throw new Error("VS05_G_ESTIMATED_INPUT_TOKEN_LIMIT_EXCEEDED");
  }
  return {
    contract_preview_drift: "PASS",
    input_token_ceiling: inputTokenCeiling,
    output_token_ceiling: outputTokenCeiling,
    prompt_characters: prompt.length,
    model_input_characters: modelInputCharacters,
    estimated_input_tokens: estimatedInputTokens,
    structured_request: structuredRequest,
    approved_request: buildOpenAICompatibleChatCompletionsRequestBody({
      thinking: { type: "disabled" },
      model: DEEPSEEK_V4_PRO_PROFILE.model,
      prompt,
      maxOutputTokens: outputTokenCeiling,
    }),
  };
}

export function prepareVs05GExecutionPreflight(
  input: PrepareVs05GExecutionPreflightInput,
): Vs05GExecutionPreflight {
  if (input.baselineSha !== VS05_G_BASELINE_SHA) {
    throw new Error("VS05_G_BASELINE_INVALID");
  }
  const currentPreviews = prepareTwoStageEditorialRequestPreviews(
    input.stage1Input,
  );
  if (!sameJson(currentPreviews.stage1, input.frozenPreviews.stage1)) {
    throw new Error("VS05_G_STAGE1_PREVIEW_DRIFT");
  }
  if (
    !sameJson(
      currentPreviews.stage2_template,
      input.frozenPreviews.stage2_template,
    )
  ) {
    throw new Error("VS05_G_STAGE2_TEMPLATE_DRIFT");
  }
  if (
    input.stage1Input.source_input !== "FLAT_V1" ||
    input.stage1Input.repository.url !==
      "https://github.com/tt-a1i/archify" ||
    input.stage1Input.commit !== VS05_G_ARCHIFY_COMMIT ||
    input.stage1Input.facts.items.length !== 80 ||
    input.stage1Input.routing !== "TO_BE_EVALUATED"
  ) {
    throw new Error("VS05_G_BENCHMARK_IDENTITY_INVALID");
  }
  const pricing = assertOfficialPricing(input.pricing);
  const stage1 = prepareStage(
    currentPreviews.stage1.structured_request,
    VS05_G_STAGE1_INPUT_TOKEN_CEILING,
    VS05_G_STAGE1_OUTPUT_TOKEN_CEILING,
  ) as Vs05GExecutionPreflight["stage1"];
  const stage2Template = prepareStage(
    currentPreviews.stage2_template.structured_request,
    VS05_G_STAGE2_INPUT_TOKEN_CEILING,
    VS05_G_STAGE2_OUTPUT_TOKEN_CEILING,
  ) as Vs05GExecutionPreflight["stage2_template"];
  const stage1WorstCase = calculateOpenAICompatibleCost(
    {
      inputTokens: VS05_G_STAGE1_INPUT_TOKEN_CEILING,
      outputTokens: VS05_G_STAGE1_OUTPUT_TOKEN_CEILING,
    },
    pricing,
  ).totalCost;
  const stage2WorstCase = calculateOpenAICompatibleCost(
    {
      inputTokens: VS05_G_STAGE2_INPUT_TOKEN_CEILING,
      outputTokens: VS05_G_STAGE2_OUTPUT_TOKEN_CEILING,
    },
    pricing,
  ).totalCost;
  const totalWorstCase = money(stage1WorstCase + stage2WorstCase);
  if (totalWorstCase > VS05_G_HARD_BUDGET_USD) {
    throw new Error("VS05_G_WORST_CASE_BUDGET_EXCEEDED");
  }
  return {
    status: "VS05_G_REAL_REQUEST_READY",
    baseline_sha: VS05_G_BASELINE_SHA,
    repository: "https://github.com/tt-a1i/archify",
    tag: "v2.16.0",
    commit: VS05_G_ARCHIFY_COMMIT,
    provider: "DeepSeek API",
    model: "deepseek-v4-pro",
    thinking: "DISABLED",
    reasoning_effort_sent: false,
    source_input: "FLAT_V1",
    rejected_input: "CLUSTERED_V2",
    experimental_flow: "TWO_STAGE_COMPOSITION",
    stage1,
    stage2_template: stage2Template,
    official_pricing: input.pricing,
    stage1_peak_worst_case_cost_usd: stage1WorstCase,
    stage2_peak_worst_case_cost_usd: stage2WorstCase,
    worst_case_cost_usd: totalWorstCase,
    hard_budget_usd: VS05_G_HARD_BUDGET_USD,
    max_paid_requests: 2,
    max_http_attempts: 2,
    retries: 0,
    regenerations: 0,
    resamples: 0,
    secret_reads: 0,
    repository_executions: 0,
    stage1_input: input.stage1Input,
    frozen_previews: input.frozenPreviews,
  };
}

export type Vs05GPricingBand = "PEAK" | "OFF_PEAK";

function pricingForBand(
  snapshot: Vs05GOfficialPricingSnapshot,
  band: Vs05GPricingBand,
): OpenAICompatiblePricing {
  return band === "PEAK"
    ? peakPricing(snapshot)
    : {
        currency: snapshot.currency,
        inputCacheHitUsdPerMillion:
          snapshot.input_cache_hit_off_peak_usd_per_million,
        inputCacheMissUsdPerMillion:
          snapshot.input_cache_miss_off_peak_usd_per_million,
        outputUsdPerMillion: snapshot.output_off_peak_usd_per_million,
      };
}

function pricingBandAt(timestampMs: number): Vs05GPricingBand {
  const date = new Date(timestampMs);
  const weekday = date.getUTCDay();
  const minuteOfDay = date.getUTCHours() * 60 + date.getUTCMinutes();
  const peak =
    weekday >= 1 &&
    weekday <= 5 &&
    ((minuteOfDay >= 60 && minuteOfDay < 240) ||
      (minuteOfDay >= 360 && minuteOfDay < 600));
  return peak ? "PEAK" : "OFF_PEAK";
}

export interface Vs05GRequestAuditReceipt {
  readonly status: "PASS" | "FAIL" | "PENDING";
  readonly inspections: number;
  readonly transport_calls: number;
  readonly actual_request_body_match: boolean | null;
  readonly failure_code:
    | "REQUEST_PREVIEW_DRIFT"
    | "REQUEST_TRANSPORT_METADATA_DRIFT"
    | null;
}

interface Vs05GRequestAudit {
  readonly fetch: typeof fetch;
  readonly receipt: () => Vs05GRequestAuditReceipt;
}

function createRequestAudit(
  approvedRequest: OpenAICompatibleChatCompletionsRequestBody,
  transport: typeof fetch,
): Vs05GRequestAudit {
  const expectedBody = JSON.stringify(approvedRequest);
  let inspections = 0;
  let transportCalls = 0;
  let actualRequestBodyMatch: boolean | null = null;
  let failureCode: Vs05GRequestAuditReceipt["failure_code"] = null;
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
      failureCode = "REQUEST_TRANSPORT_METADATA_DRIFT";
      actualRequestBodyMatch = false;
      throw new Error("REQUEST_TRANSPORT_METADATA_DRIFT");
    }
    let body: unknown;
    try {
      body = JSON.parse(String(init.body));
    } catch {
      failureCode = "REQUEST_PREVIEW_DRIFT";
      actualRequestBodyMatch = false;
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

export interface Vs05GGenerationReceipt {
  readonly stage: "STAGE1_COMPOSITION" | "STAGE2_FRAMING";
  readonly provider: "deepseek-api";
  readonly model: "deepseek-v4-pro";
  readonly thinking: "DISABLED";
  readonly reasoning_effort_sent: false;
  readonly paid_requests: 1;
  readonly http_attempts: 1;
  readonly retries: 0;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cache_hit_input_tokens: number | null;
  readonly cache_miss_input_tokens: number | null;
  readonly reasoning_tokens: number | null;
  readonly reasoning_content_characters: 0;
  readonly finish_reason: "stop";
  readonly truncated: false;
  readonly started_at: string;
  readonly completed_at: string;
  readonly duration_ms: number;
  readonly pricing_band: Vs05GPricingBand;
  readonly actual_cost_usd: number;
  readonly input_ceiling: number;
  readonly output_ceiling: number;
  readonly repository_executions: 0;
}

export interface Vs05GFailureReceipt {
  readonly status: "FAIL_CLOSED";
  readonly stage: "STAGE1_COMPOSITION" | "STAGE2_FRAMING";
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
  readonly pricing_band: Vs05GPricingBand | null;
  readonly partial_content_persisted: false;
  readonly reasoning_content_persisted: false;
  readonly repository_executions: 0;
}

interface CompletedStage<T> {
  readonly status: "COMPLETED";
  readonly value: T;
  readonly raw_model_output: string;
  readonly generation: Vs05GGenerationReceipt;
  readonly request_audit: Vs05GRequestAuditReceipt;
}

interface FailedStage {
  readonly status: "FAIL_CLOSED";
  readonly failure: Vs05GFailureReceipt;
  readonly request_audit: Vs05GRequestAuditReceipt;
}

type StageOutcome<T> = CompletedStage<T> | FailedStage;

function safeFailureCode(error: unknown): string {
  if (error instanceof OpenAICompatibleProviderError) return error.code;
  if (error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message)) {
    return error.message;
  }
  return "UNCLASSIFIED_FAILURE";
}

function buildFailureReceipt(
  stage: Vs05GFailureReceipt["stage"],
  error: unknown,
  pricing: Vs05GOfficialPricingSnapshot,
  started: number,
  completed: number,
  modelResult?: ModelResult<unknown>,
): Vs05GFailureReceipt {
  const providerError =
    error instanceof OpenAICompatibleProviderError ? error : null;
  const telemetry = providerError?.telemetry;
  const usage = telemetry?.usage ?? modelResult?.usage;
  const attempts = providerError?.attempts ?? modelResult?.networkCalls ?? 0;
  if (attempts > 1) throw new Error("VS05_G_REQUEST_BOUNDARY_VIOLATED");
  const band = attempts > 0 ? pricingBandAt(started) : null;
  return {
    status: "FAIL_CLOSED",
    stage,
    failure_code: safeFailureCode(error),
    provider_failure_code: providerError?.code ?? null,
    paid_requests: attempts > 0 ? 1 : 0,
    http_attempts: attempts,
    retries: 0,
    input_tokens: usage?.inputTokens ?? null,
    output_tokens: usage?.outputTokens ?? null,
    finish_reason: telemetry?.finishReason ?? modelResult?.finishReason ?? null,
    truncated: providerError?.code === "TRUNCATED_OUTPUT",
    duration_ms: completed - started,
    actual_cost_usd:
      usage === undefined || band === null
        ? null
        : calculateOpenAICompatibleCost(
            usage,
            pricingForBand(pricing, band),
          ).totalCost,
    pricing_band: band,
    partial_content_persisted: false,
    reasoning_content_persisted: false,
    repository_executions: 0,
  };
}

async function runStage<T>(args: {
  readonly stage: Vs05GGenerationReceipt["stage"];
  readonly prepared: Vs05GPreparedStage;
  readonly pricing: Vs05GOfficialPricingSnapshot;
  readonly secret: string;
  readonly transport: typeof fetch;
  readonly clock: () => number;
}): Promise<StageOutcome<T>> {
  const audit = createRequestAudit(args.prepared.approved_request, args.transport);
  const provider = createDeepSeekV4ProNonThinkingProvider({
    environment: { DEEPSEEK_API_KEY: args.secret },
    fetch: audit.fetch,
    maxRetries: 0,
  });
  const started = args.clock();
  let modelResult: ModelResult<T> | undefined;
  try {
    const result = await provider.generateStructured<T>(
      args.prepared.structured_request,
    );
    modelResult = result;
    const completed = args.clock();
    if (
      !Number.isFinite(started) ||
      !Number.isFinite(completed) ||
      completed < started ||
      result.provider !== "deepseek-api" ||
      result.model !== "deepseek-v4-pro" ||
      result.networkCalls !== 1 ||
      !result.paid ||
      result.requestConfiguration?.thinking !== "disabled" ||
      result.requestConfiguration.reasoningEffort !== null ||
      result.finishReason !== "stop" ||
      result.rawOutput === undefined ||
      result.rawOutput.trim().length === 0 ||
      result.reasoning?.contentCharacters !== 0 ||
      (result.reasoning.tokens !== null && result.reasoning.tokens !== 0) ||
      result.context.promptStage !== "angles" ||
      result.context.promptCharacters !== args.prepared.prompt_characters ||
      result.context.highestReadScope !== 0 ||
      result.context.filesConsidered.length !== 0 ||
      result.context.filesRead.length !== 0 ||
      result.context.filesPassed.length !== 0 ||
      result.context.repositoryCharactersPassed !== 0 ||
      !result.context.schemaValidated ||
      result.context.endpoint !== "remote_https" ||
      audit.receipt().status !== "PASS"
    ) {
      throw new Error("VS05_G_RESPONSE_OR_CONTEXT_IDENTITY_INVALID");
    }
    if (
      result.usage.inputTokens > args.prepared.input_token_ceiling ||
      result.usage.outputTokens > args.prepared.output_token_ceiling
    ) {
      throw new Error("VS05_G_ACTUAL_TOKEN_LIMIT_EXCEEDED");
    }
    const band = pricingBandAt(started);
    const actualCost = calculateOpenAICompatibleCost(
      result.usage,
      pricingForBand(args.pricing, band),
    ).totalCost;
    return {
      status: "COMPLETED",
      value: result.value,
      raw_model_output: result.rawOutput,
      generation: {
        stage: args.stage,
        provider: "deepseek-api",
        model: "deepseek-v4-pro",
        thinking: "DISABLED",
        reasoning_effort_sent: false,
        paid_requests: 1,
        http_attempts: 1,
        retries: 0,
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
        cache_hit_input_tokens: result.usage.cacheHitInputTokens ?? null,
        cache_miss_input_tokens: result.usage.cacheMissInputTokens ?? null,
        reasoning_tokens: result.reasoning?.tokens ?? null,
        reasoning_content_characters: 0,
        finish_reason: "stop",
        truncated: false,
        started_at: new Date(started).toISOString(),
        completed_at: new Date(completed).toISOString(),
        duration_ms: completed - started,
        pricing_band: band,
        actual_cost_usd: actualCost,
        input_ceiling: args.prepared.input_token_ceiling,
        output_ceiling: args.prepared.output_token_ceiling,
        repository_executions: 0,
      },
      request_audit: audit.receipt(),
    };
  } catch (error) {
    const completed = args.clock();
    return {
      status: "FAIL_CLOSED",
      failure: buildFailureReceipt(
        args.stage,
        error,
        args.pricing,
        started,
        completed,
        modelResult,
      ),
      request_audit: audit.receipt(),
    };
  }
}

function missingSecretFailure(): Vs05GFailureReceipt {
  return {
    status: "FAIL_CLOSED",
    stage: "STAGE1_COMPOSITION",
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
  };
}

export type Vs05GExecutionOutcome =
  | {
      readonly status: "FAIL_CLOSED_STAGE1";
      readonly secret_reads: 1;
      readonly stage1: FailedStage;
      readonly stage2: null;
      readonly total_paid_requests: 0 | 1;
      readonly total_http_attempts: number;
      readonly total_cost_usd: number | null;
    }
  | {
      readonly status: "STAGE1_COMPOSITION_DISCOVERY_FAIL";
      readonly secret_reads: 1;
      readonly stage1: CompletedStage<FactCompositionProposalDraftV1> & {
        readonly host_evaluation: FactCompositionEvaluationReceipt;
      };
      readonly stage2: null;
      readonly total_paid_requests: 1;
      readonly total_http_attempts: 1;
      readonly total_cost_usd: number;
    }
  | {
      readonly status: "FAIL_CLOSED_STAGE2";
      readonly secret_reads: 1;
      readonly stage1: CompletedStage<FactCompositionProposalDraftV1> & {
        readonly host_evaluation: FactCompositionEvaluationReceipt;
      };
      readonly stage2: FailedStage & {
        readonly input: Stage2EditorialFramingInput;
        readonly prepared: Vs05GPreparedStage;
      };
      readonly total_paid_requests: 1 | 2;
      readonly total_http_attempts: number;
      readonly total_cost_usd: number | null;
    }
  | {
      readonly status: "COMPLETED";
      readonly secret_reads: 1;
      readonly stage1: CompletedStage<FactCompositionProposalDraftV1> & {
        readonly host_evaluation: FactCompositionEvaluationReceipt;
      };
      readonly stage2: CompletedStage<EditorialFramingDraftV1> & {
        readonly input: Stage2EditorialFramingInput;
        readonly prepared: Vs05GPreparedStage;
        readonly host_evaluation: EditorialFramingEvaluationReceipt;
      };
      readonly total_paid_requests: 2;
      readonly total_http_attempts: 2;
      readonly total_cost_usd: number;
    };

export interface ExecuteVs05GAuthorizedOptions {
  readonly preflight: Vs05GExecutionPreflight;
  readonly flat_input: DeterministicContentAngleInput;
  readonly reference_map: FlatModelFactReferenceMap;
  readonly pack: GroundedFactPack;
  readonly canonical: CanonicalGroundedBriefArtifact;
  readonly schemas: SchemaRegistry;
  readonly readSecret: () => string | undefined;
  readonly transport: typeof fetch;
  readonly assertStage2Contamination?: (
    request: OpenAICompatibleChatCompletionsRequestBody,
  ) => void;
  readonly clock?: () => number;
}

function totalCost(
  stage1: CompletedStage<unknown>,
  stage2?: CompletedStage<unknown> | FailedStage,
): number | null {
  const stage2Cost =
    stage2 === undefined
      ? 0
      : stage2.status === "COMPLETED"
        ? stage2.generation.actual_cost_usd
        : stage2.failure.actual_cost_usd;
  return stage2Cost === null
    ? null
    : money(stage1.generation.actual_cost_usd + stage2Cost);
}

function prepareActualStage2(
  preflight: Vs05GExecutionPreflight,
  input: Stage2EditorialFramingInput,
): Vs05GPreparedStage {
  const request: StructuredGenerationRequest = {
    ...preflight.stage2_template.structured_request,
    untrustedRepositorySignals: { editorial_framing_input: input },
    maxOutputTokens: VS05_G_STAGE2_OUTPUT_TOKEN_CEILING,
  };
  return prepareStage(
    request,
    VS05_G_STAGE2_INPUT_TOKEN_CEILING,
    VS05_G_STAGE2_OUTPUT_TOKEN_CEILING,
  );
}

export async function executeVs05GAuthorized(
  options: ExecuteVs05GAuthorizedOptions,
): Promise<Vs05GExecutionOutcome> {
  const secret = options.readSecret();
  if (secret === undefined || secret.length === 0) {
    return {
      status: "FAIL_CLOSED_STAGE1",
      secret_reads: 1,
      stage1: {
        status: "FAIL_CLOSED",
        failure: missingSecretFailure(),
        request_audit: {
          status: "PENDING",
          inspections: 0,
          transport_calls: 0,
          actual_request_body_match: null,
          failure_code: null,
        },
      },
      stage2: null,
      total_paid_requests: 0,
      total_http_attempts: 0,
      total_cost_usd: null,
    };
  }
  const clock = options.clock ?? Date.now;
  const stage1Call = await runStage<FactCompositionProposalDraftV1>({
    stage: "STAGE1_COMPOSITION",
    prepared: options.preflight.stage1,
    pricing: options.preflight.official_pricing,
    secret,
    transport: options.transport,
    clock,
  });
  if (stage1Call.status === "FAIL_CLOSED") {
    return {
      status: "FAIL_CLOSED_STAGE1",
      secret_reads: 1,
      stage1: stage1Call,
      stage2: null,
      total_paid_requests: stage1Call.failure.paid_requests,
      total_http_attempts: stage1Call.failure.http_attempts,
      total_cost_usd: stage1Call.failure.actual_cost_usd,
    };
  }
  const stage1Evaluation = evaluateFactCompositionProposalDraft({
    draft: stage1Call.value,
    input: options.preflight.stage1_input,
    reference_map: options.reference_map,
    pack: options.pack,
    canonical: options.canonical,
  });
  const completedStage1 = {
    ...stage1Call,
    host_evaluation: stage1Evaluation,
  };
  if (stage1Evaluation.accepted_proposals.length === 0) {
    return {
      status: "STAGE1_COMPOSITION_DISCOVERY_FAIL",
      secret_reads: 1,
      stage1: completedStage1,
      stage2: null,
      total_paid_requests: 1,
      total_http_attempts: 1,
      total_cost_usd: stage1Call.generation.actual_cost_usd,
    };
  }
  const stage2Input = buildStage2EditorialFramingInput({
    stage1_input: options.preflight.stage1_input,
    stage1_evaluation: stage1Evaluation,
    reference_map: options.reference_map,
    flat_input: options.flat_input,
  });
  let stage2Prepared: Vs05GPreparedStage;
  try {
    stage2Prepared = prepareActualStage2(options.preflight, stage2Input);
    options.assertStage2Contamination?.(stage2Prepared.approved_request);
  } catch (error) {
    const failed: FailedStage & {
      readonly input: Stage2EditorialFramingInput;
      readonly prepared: Vs05GPreparedStage;
    } = {
      status: "FAIL_CLOSED",
      failure: buildFailureReceipt(
        "STAGE2_FRAMING",
        error,
        options.preflight.official_pricing,
        clock(),
        clock(),
      ),
      request_audit: {
        status: "PENDING",
        inspections: 0,
        transport_calls: 0,
        actual_request_body_match: null,
        failure_code: null,
      },
      input: stage2Input,
      prepared: prepareStage(
        options.preflight.stage2_template.structured_request,
        VS05_G_STAGE2_INPUT_TOKEN_CEILING,
        VS05_G_STAGE2_OUTPUT_TOKEN_CEILING,
      ),
    };
    return {
      status: "FAIL_CLOSED_STAGE2",
      secret_reads: 1,
      stage1: completedStage1,
      stage2: failed,
      total_paid_requests: 1,
      total_http_attempts: 1,
      total_cost_usd: stage1Call.generation.actual_cost_usd,
    };
  }
  const stage2Call = await runStage<EditorialFramingDraftV1>({
    stage: "STAGE2_FRAMING",
    prepared: stage2Prepared,
    pricing: options.preflight.official_pricing,
    secret,
    transport: options.transport,
    clock,
  });
  if (stage2Call.status === "FAIL_CLOSED") {
    const cost = totalCost(stage1Call, stage2Call);
    return {
      status: "FAIL_CLOSED_STAGE2",
      secret_reads: 1,
      stage1: completedStage1,
      stage2: {
        ...stage2Call,
        input: stage2Input,
        prepared: stage2Prepared,
      },
      total_paid_requests: stage2Call.failure.paid_requests === 1 ? 2 : 1,
      total_http_attempts: 1 + stage2Call.failure.http_attempts,
      total_cost_usd: cost,
    };
  }
  const stage2Evaluation = evaluateEditorialFramingDraft({
    draft: stage2Call.value,
    input: stage2Input,
    stage1_evaluation: stage1Evaluation,
    reference_map: options.reference_map,
    pack: options.pack,
    canonical: options.canonical,
    schemas: options.schemas,
  });
  const cost = totalCost(stage1Call, stage2Call);
  if (cost === null || cost > options.preflight.hard_budget_usd) {
    throw new Error("VS05_G_ACTUAL_BUDGET_EXCEEDED");
  }
  return {
    status: "COMPLETED",
    secret_reads: 1,
    stage1: completedStage1,
    stage2: {
      ...stage2Call,
      input: stage2Input,
      prepared: stage2Prepared,
      host_evaluation: stage2Evaluation,
    },
    total_paid_requests: 2,
    total_http_attempts: 2,
    total_cost_usd: cost,
  };
}
