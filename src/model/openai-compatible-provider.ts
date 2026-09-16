import type {
  ModelProvider,
  ModelRequestConfiguration,
  ModelResult,
  ModelStage,
  StructuredGenerationRequest,
} from "./provider.js";
import { buildOpenAICompatibleChatCompletionsRequestBody, OPENAI_COMPATIBLE_BOUNDED_SYSTEM_MESSAGE } from "./openai-compatible-request.js";
import { buildStructuredPrompt } from "./structured-prompt.js";
import {
  parseStructuredOutput,
  StructuredOutputError,
  structuredOutputContract,
} from "./structured-output.js";

export interface OpenAICompatiblePricing {
  readonly currency: "USD";
  readonly inputCacheHitUsdPerMillion: number;
  readonly inputCacheMissUsdPerMillion: number;
  readonly outputUsdPerMillion: number;
}

export interface OpenAICompatibleUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheHitInputTokens?: number;
  readonly cacheMissInputTokens?: number;
}

export interface OpenAICompatibleCost {
  readonly currency: "USD";
  readonly inputCost: number;
  readonly outputCost: number;
  readonly totalCost: number;
}

export interface OpenAICompatibleFailureTelemetry {
  readonly stage: ModelStage;
  readonly provider: string;
  readonly model: string;
  readonly finishReason: string | null;
  readonly requestConfiguration: ModelRequestConfiguration;
  readonly reasoning: {
    readonly tokens: number | null;
    readonly contentCharacters: number | null;
    readonly visibleContentTokens: number | null;
  };
  readonly usage: OpenAICompatibleUsage;
  readonly visibleContentCharacters: number | null;
  readonly networkCalls: number;
  readonly paid: true;
}

function money(value: number): number {
  return Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;
}

export function calculateOpenAICompatibleCost(
  usage: OpenAICompatibleUsage,
  pricing: OpenAICompatiblePricing,
): OpenAICompatibleCost {
  const cacheHit = usage.cacheHitInputTokens ?? 0;
  const cacheMiss = usage.cacheMissInputTokens ?? usage.inputTokens;
  const inputCost = money(
    (cacheHit * pricing.inputCacheHitUsdPerMillion +
      cacheMiss * pricing.inputCacheMissUsdPerMillion) /
      1_000_000,
  );
  const outputCost = money(
    (usage.outputTokens * pricing.outputUsdPerMillion) / 1_000_000,
  );
  return {
    currency: pricing.currency,
    inputCost,
    outputCost,
    totalCost: money(inputCost + outputCost),
  };
}

export interface OpenAICompatibleProviderMetadata {
  readonly id: string;
  readonly displayName: string;
  readonly networkHost: string;
}

export interface OpenAICompatibleProviderOptions {
  readonly apiFormat?: "openai-chat" | "anthropic-messages";
  readonly jsonMode?: boolean;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKeyEnvName: string;
  readonly responseFormat: "json_object";
  readonly timeoutMs: number;
  readonly tokenLimits: {
    readonly contextTokens: number;
    readonly maxOutputTokens: number;
  };
  readonly providerMetadata: OpenAICompatibleProviderMetadata;
  readonly pricing: OpenAICompatiblePricing;
  readonly tokenParameter?: "max_tokens" | "max_completion_tokens";
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly fetch?: typeof fetch;
  readonly maxRetries?: 0 | 1;
  readonly retryDelayMs?: number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly thinking?: { readonly type: "enabled" | "disabled" };
  readonly enableThinking?: boolean;
  readonly reasoningEffort?: "low" | "high" | "max";
}

export type OpenAICompatibleProviderErrorCode =
  | "INVALID_CONFIGURATION"
  | "UNKNOWN_SCHEMA"
  | "API_KEY_NOT_CONFIGURED"
  | "HTTP_ERROR"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "INVALID_RESPONSE"
  | "EMPTY_CONTENT"
  | "TRUNCATED_OUTPUT"
  | "TOKEN_LIMIT_EXCEEDED"
  | "INVALID_USAGE"
  | "JSON_SYNTAX_INVALID"
  | "AMBIGUOUS_FIELD"
  | "SCHEMA_VALIDATION_FAILED";

export class OpenAICompatibleProviderError extends Error {
  constructor(
    readonly code: OpenAICompatibleProviderErrorCode,
    message: string,
    readonly attempts: number = 0,
    readonly telemetry?: OpenAICompatibleFailureTelemetry,
  ) {
    super(message);
    this.name = "OpenAICompatibleProviderError";
  }
}

interface ChatCompletionResponse {
  readonly model?: unknown;
  readonly choices?: readonly {
    readonly finish_reason?: unknown;
    readonly message?: {
      readonly content?: unknown;
      readonly reasoning_content?: unknown;
    };
  }[];
  readonly usage?: {
    readonly prompt_tokens?: unknown;
    readonly completion_tokens?: unknown;
    readonly prompt_cache_hit_tokens?: unknown;
    readonly prompt_cache_miss_tokens?: unknown;
    readonly completion_tokens_details?: {
      readonly reasoning_tokens?: unknown;
    };
  };
}

function anthropicEnvelope(value: unknown): ChatCompletionResponse {
  const payload = value as { model?: unknown; stop_reason?: unknown; content?: { type?: string; text?: string }[]; usage?: Record<string, unknown> } | null;
  if (!payload || !Array.isArray(payload.content)) return {};
  const count = (key: string) => typeof payload.usage?.[key] === "number" && Number.isInteger(payload.usage[key]) && Number(payload.usage[key]) >= 0 ? Number(payload.usage[key]) : null;
  const input = count("input_tokens");
  const cacheRead = payload.usage?.cache_read_input_tokens === undefined ? 0 : count("cache_read_input_tokens");
  const cacheWrite = payload.usage?.cache_creation_input_tokens === undefined ? 0 : count("cache_creation_input_tokens");
  const validInput = input !== null && cacheRead !== null && cacheWrite !== null;
  const textBlocks = payload.content.filter(item => item?.type === "text");
  const invalidBlocks = payload.content.some(item => !item || !["text", "thinking", "redacted_thinking"].includes(item.type ?? ""));
  return {
    model: payload.model,
    choices: [{ finish_reason: payload.stop_reason === "max_tokens" ? "length" : payload.stop_reason === "end_turn" && !invalidBlocks ? "stop" : payload.stop_reason,
      message: { content: textBlocks.every(block => typeof block.text === "string") ? textBlocks.map(block => block.text).join("\n") : undefined } }],
    usage: { prompt_tokens: validInput ? input + cacheRead + cacheWrite : undefined, completion_tokens: count("output_tokens"),
      prompt_cache_hit_tokens: validInput ? cacheRead : undefined, prompt_cache_miss_tokens: validInput ? input + cacheWrite : undefined },
  };
}

function normalizeBaseUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new OpenAICompatibleProviderError(
      "INVALID_CONFIGURATION",
      "OpenAI-compatible base URL is invalid.",
    );
  }
  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error("OpenAI-compatible base URL must be credential-free HTTPS.");
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  return url;
}

function requiredTokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function parseResponseUsage(
  payload: ChatCompletionResponse,
  attempts: number,
): {
  readonly usage: OpenAICompatibleUsage;
  readonly reasoningTokens: number | null;
} {
  const usage = payload.usage;
  const inputTokens = requiredTokenCount(usage?.prompt_tokens);
  const outputTokens = requiredTokenCount(usage?.completion_tokens);
  if (inputTokens === null || outputTokens === null) {
    throw new OpenAICompatibleProviderError(
      "INVALID_USAGE",
      "Provider response did not contain valid token usage.",
      attempts,
    );
  }
  const cacheHitInputTokens = requiredTokenCount(usage?.prompt_cache_hit_tokens);
  const cacheMissInputTokens = requiredTokenCount(usage?.prompt_cache_miss_tokens);
  const reasoningTokensRaw = usage?.completion_tokens_details?.reasoning_tokens;
  const reasoningTokens =
    reasoningTokensRaw === undefined || reasoningTokensRaw === null
      ? null
      : requiredTokenCount(reasoningTokensRaw);
  if (
    (reasoningTokensRaw !== undefined &&
      reasoningTokensRaw !== null &&
      reasoningTokens === null) ||
    (reasoningTokens !== null && reasoningTokens > outputTokens)
  ) {
    throw new OpenAICompatibleProviderError(
      "INVALID_USAGE",
      "Provider reasoning usage was invalid.",
      attempts,
    );
  }
  const hasCacheBreakdown =
    cacheHitInputTokens !== null && cacheMissInputTokens !== null;
  const hasPartialCacheBreakdown =
    (cacheHitInputTokens === null) !== (cacheMissInputTokens === null);
  if (
    hasPartialCacheBreakdown ||
    (hasCacheBreakdown && cacheHitInputTokens + cacheMissInputTokens !== inputTokens)
  ) {
    throw new OpenAICompatibleProviderError(
      "INVALID_USAGE",
      "Provider cache usage did not match total input usage.",
      attempts,
    );
  }
  return {
    usage: {
      inputTokens,
      outputTokens,
      cacheHitInputTokens: hasCacheBreakdown ? (cacheHitInputTokens ?? 0) : 0,
      cacheMissInputTokens: hasCacheBreakdown
        ? (cacheMissInputTokens ?? 0)
        : inputTokens,
    },
    reasoningTokens,
  };
}

function retryDelay(response: Response, fallbackMs: number): number {
  const header = response.headers.get("retry-after");
  if (header !== null && /^\d+(?:\.\d+)?$/.test(header.trim())) {
    return Math.min(Number(header) * 1_000, 5_000);
  }
  return fallbackMs;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class OpenAICompatibleProvider implements ModelProvider {
  readonly id: string;
  readonly metadata: OpenAICompatibleProviderMetadata;
  private readonly configuredPricing: OpenAICompatiblePricing | undefined;
  private readonly tokenParameter: "max_tokens" | "max_completion_tokens" | undefined;
  private readonly apiFormat: "openai-chat" | "anthropic-messages";
  private readonly jsonMode: boolean;
  get pricing(): OpenAICompatiblePricing {
    if (this.configuredPricing === undefined) throw new Error("Provider pricing is not configured; consult the provider bill.");
    return this.configuredPricing;
  }
  private readonly baseUrl: URL;
  private readonly model: string;
  private readonly apiKey: string;
  private readonly responseFormat: "json_object";
  private readonly timeoutMs: number;
  private readonly maxOutputTokens: number;
  private readonly contextTokens: number;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: 0 | 1;
  private readonly retryDelayMs: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly thinking: { readonly type: "enabled" | "disabled" } | undefined;
  private readonly enableThinking: boolean | undefined;
  private readonly reasoningEffort: "low" | "high" | "max" | undefined;

  constructor(options: Omit<OpenAICompatibleProviderOptions, "pricing"> & { readonly pricing?: OpenAICompatiblePricing }) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.model = options.model;
    this.responseFormat = options.responseFormat;
    this.timeoutMs = options.timeoutMs;
    this.maxOutputTokens = options.tokenLimits.maxOutputTokens;
    this.contextTokens = options.tokenLimits.contextTokens;
    this.metadata = options.providerMetadata;
    this.configuredPricing = options.pricing;
    this.tokenParameter = options.tokenParameter;
    this.apiFormat = options.apiFormat ?? "openai-chat";
    this.jsonMode = options.jsonMode ?? true;
    this.id = options.providerMetadata.id;
    this.maxRetries = options.maxRetries ?? 0;
    this.retryDelayMs = options.retryDelayMs ?? 250;
    this.sleep = options.sleep ?? defaultSleep;
    this.thinking = options.thinking;
    this.enableThinking = options.enableThinking;
    this.reasoningEffort = options.reasoningEffort;
    if (this.thinking !== undefined && this.enableThinking !== undefined) {
      throw new OpenAICompatibleProviderError(
        "INVALID_CONFIGURATION",
        "Only one Provider thinking control may be configured.",
      );
    }
    if (this.thinking?.type === "disabled" && this.reasoningEffort !== undefined) {
      throw new OpenAICompatibleProviderError(
        "INVALID_CONFIGURATION",
        "Reasoning effort must be omitted when thinking is disabled.",
      );
    }
    const environment = options.environment ?? process.env;
    this.apiKey = environment[options.apiKeyEnvName] ?? "";
    if (this.apiKey.length === 0) {
      throw new OpenAICompatibleProviderError(
        "API_KEY_NOT_CONFIGURED",
        `${options.apiKeyEnvName}_NOT_CONFIGURED`,
      );
    }
    this.fetchImpl = options.fetch ?? fetch;
  }

  async generateStructured<T>(
    request: StructuredGenerationRequest,
  ): Promise<ModelResult<T>> {
    const contract = structuredOutputContract(request.schemaId);
    if (contract === null) {
      throw new OpenAICompatibleProviderError(
        "UNKNOWN_SCHEMA",
        `OpenAICompatibleProvider does not allow schema ${request.schemaId}.`,
      );
    }
    if (request.maxOutputTokens > this.maxOutputTokens) {
      throw new OpenAICompatibleProviderError(
        "TOKEN_LIMIT_EXCEEDED",
        "Requested output token limit exceeds the configured Provider limit.",
      );
    }
    const prompt = buildStructuredPrompt(request, contract.schema);
    if (prompt.length + request.maxOutputTokens > this.contextTokens) {
      throw new OpenAICompatibleProviderError(
        "TOKEN_LIMIT_EXCEEDED",
        "Conservative prompt estimate exceeds the configured Provider context limit.",
      );
    }
    const endpoint = `${this.baseUrl.toString().replace(/\/$/, "")}/${this.apiFormat === "anthropic-messages" ? "messages" : "chat/completions"}`;
    const requestBody = JSON.stringify(
      this.apiFormat === "anthropic-messages" ? {
        model: this.model, max_tokens: request.maxOutputTokens, stream: false,
        system: OPENAI_COMPATIBLE_BOUNDED_SYSTEM_MESSAGE,
        messages: [{ role: "user", content: prompt }],
      } : buildOpenAICompatibleChatCompletionsRequestBody({
        thinking: this.thinking,
        enableThinking: this.enableThinking,
        reasoningEffort: this.reasoningEffort,
        model: this.model,
        prompt,
        maxOutputTokens: request.maxOutputTokens,
        tokenParameter: this.tokenParameter,
        jsonMode: this.jsonMode,
      }),
    );
    let response: Response;
    let attempts = 0;
    while (true) {
      attempts += 1;
      try {
        response = await this.fetchImpl(endpoint, {
          method: "POST",
          redirect: "error",
          headers: {
            ...(this.apiFormat === "anthropic-messages"
              ? { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" }
              : { authorization: `Bearer ${this.apiKey}` }),
            "content-type": "application/json",
          },
          body: requestBody,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        const name =
          error !== null && typeof error === "object" && "name" in error
            ? String(error.name)
            : "";
        if (name === "TimeoutError" || name === "AbortError") {
          throw new OpenAICompatibleProviderError(
            "TIMEOUT",
            "Provider request timed out.",
            attempts,
          );
        }
        throw new OpenAICompatibleProviderError(
          "NETWORK_ERROR",
          "Provider transport failed.",
          attempts,
        );
      }
      if (
        !response.ok &&
        (response.status === 429 || response.status === 500 || response.status === 503) &&
        attempts <= this.maxRetries
      ) {
        await this.sleep(retryDelay(response, this.retryDelayMs));
        continue;
      }
      break;
    }
    if (!response.ok) {
      throw new OpenAICompatibleProviderError(
        "HTTP_ERROR",
        `Provider returned HTTP ${response.status}.`,
        attempts,
      );
    }
    let payload: ChatCompletionResponse;
    try {
      const envelope: unknown = await response.json();
      payload = this.apiFormat === "anthropic-messages" ? anthropicEnvelope(envelope) : (envelope ?? {}) as ChatCompletionResponse;
    } catch {
      throw new OpenAICompatibleProviderError(
        "INVALID_RESPONSE",
        "Provider returned an invalid JSON response envelope.",
        attempts,
      );
    }
    const finishReasonRaw = payload.choices?.[0]?.finish_reason;
    const content = payload.choices?.[0]?.message?.content;
    const reasoningContentRaw = payload.choices?.[0]?.message?.reasoning_content;
    const parsedUsage = parseResponseUsage(payload, attempts);
    const requestConfiguration: ModelRequestConfiguration = {
      thinking:
        this.thinking?.type ??
        (this.enableThinking === undefined
          ? "unspecified"
          : this.enableThinking
            ? "enabled"
            : "disabled"),
      reasoningEffort: this.reasoningEffort ?? null,
    };
    const finishReason =
      typeof finishReasonRaw === "string" ? finishReasonRaw : null;
    const failureTelemetry: OpenAICompatibleFailureTelemetry = {
      stage: request.stage,
      provider: this.id,
      model: typeof payload.model === "string" ? payload.model : this.model,
      finishReason,
      requestConfiguration,
      reasoning: {
        tokens: parsedUsage.reasoningTokens,
        contentCharacters:
          typeof reasoningContentRaw === "string"
            ? reasoningContentRaw.length
            : reasoningContentRaw === undefined || reasoningContentRaw === null
              ? 0
              : null,
        visibleContentTokens:
          parsedUsage.reasoningTokens !== null
            ? parsedUsage.usage.outputTokens - parsedUsage.reasoningTokens
            : reasoningContentRaw === undefined || reasoningContentRaw === null
              ? parsedUsage.usage.outputTokens
              : null,
      },
      usage: parsedUsage.usage,
      visibleContentCharacters: typeof content === "string" ? content.length : null,
      networkCalls: attempts,
      paid: true,
    };
    if (finishReason === "length") {
      throw new OpenAICompatibleProviderError(
        "TRUNCATED_OUTPUT",
        `Provider truncated stage ${request.stage} at the configured output limit.`,
        attempts,
        failureTelemetry,
      );
    }
    if (typeof content !== "string") {
      throw new OpenAICompatibleProviderError(
        "INVALID_RESPONSE",
        "Provider response did not contain model content.",
        attempts,
        failureTelemetry,
      );
    }
    if (content.trim().length === 0) {
      throw new OpenAICompatibleProviderError(
        "EMPTY_CONTENT",
        "Provider returned empty model content.",
        attempts,
        failureTelemetry,
      );
    }
    if (
      reasoningContentRaw !== undefined &&
      reasoningContentRaw !== null &&
      typeof reasoningContentRaw !== "string"
    ) {
      throw new OpenAICompatibleProviderError(
        "INVALID_RESPONSE",
        "Provider response contained invalid reasoning metadata.",
        attempts,
        failureTelemetry,
      );
    }
    const reasoningContent =
      typeof reasoningContentRaw === "string" ? reasoningContentRaw : "";
    if (finishReason !== "stop") {
      throw new OpenAICompatibleProviderError(
        "INVALID_RESPONSE",
        "Provider response did not end with a complete stop reason.",
        attempts,
        failureTelemetry,
      );
    }
    let parsed: ReturnType<typeof parseStructuredOutput>;
    try {
      parsed = parseStructuredOutput(content, contract);
    } catch (error) {
      if (error instanceof StructuredOutputError) {
        throw new OpenAICompatibleProviderError(
          error.code,
          error.message,
          attempts,
          failureTelemetry,
        );
      }
      throw error;
    }
    const filesPassed = request.untrustedRepositoryContext.map((chunk) => chunk.path);
    return {
      value: parsed.value as T,
      provider: this.id,
      model: typeof payload.model === "string" ? payload.model : this.model,
      rawOutput: content,
      finishReason,
      requestConfiguration,
      reasoning: {
        tokens: parsedUsage.reasoningTokens,
        contentCharacters: reasoningContent.length,
        visibleContentTokens:
          parsedUsage.reasoningTokens !== null
            ? parsedUsage.usage.outputTokens - parsedUsage.reasoningTokens
            : reasoningContent.length === 0
              ? parsedUsage.usage.outputTokens
              : null,
      },
      usage: parsedUsage.usage,
      networkCalls: attempts,
      paid: true,
      context: {
        promptStage: request.stage,
        highestReadScope: request.repositoryReadReceipt.highestScope,
        filesConsidered: request.repositoryReadReceipt.filesConsidered,
        filesRead: request.repositoryReadReceipt.filesRead,
        filesPassed,
        repositoryCharactersPassed: request.untrustedRepositoryContext.reduce(
          (total, chunk) => total + chunk.content.length,
          0,
        ),
        promptCharacters: prompt.length,
        repairActions: parsed.repairActions,
        schemaValidated: true,
        endpoint: "remote_https",
      },
    };
  }
}
