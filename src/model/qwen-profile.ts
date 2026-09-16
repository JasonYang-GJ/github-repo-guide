import {
  OpenAICompatibleProvider,
  type OpenAICompatibleProviderOptions,
} from "./openai-compatible-provider.js";

export const QWEN_MAX_BENCHMARK_PROFILE = {
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  model: "qwen3.8-max",
  apiKeyEnvName: "DASHSCOPE_API_KEY",
  responseFormat: "json_object",
  timeoutMs: 180_000,
  contextTokens: 1_000_000,
  maxOutputTokens: 12_000,
  maxRetries: 0,
  retryDelayMs: 250,
  pricingBasis: "china-beijing-2026-09-02",
  inputUsdPerMillion: 1.65,
  outputUsdPerMillion: 4.951,
  enableThinking: false,
} as const;

export interface QwenMaxProviderDependencies {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly fetch?: typeof fetch;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

export function createQwenMaxNonThinkingProvider(
  dependencies: QwenMaxProviderDependencies = {},
): OpenAICompatibleProvider {
  const options: OpenAICompatibleProviderOptions = {
    baseUrl: QWEN_MAX_BENCHMARK_PROFILE.baseUrl,
    model: QWEN_MAX_BENCHMARK_PROFILE.model,
    apiKeyEnvName: QWEN_MAX_BENCHMARK_PROFILE.apiKeyEnvName,
    responseFormat: QWEN_MAX_BENCHMARK_PROFILE.responseFormat,
    timeoutMs: QWEN_MAX_BENCHMARK_PROFILE.timeoutMs,
    tokenLimits: {
      contextTokens: QWEN_MAX_BENCHMARK_PROFILE.contextTokens,
      maxOutputTokens: QWEN_MAX_BENCHMARK_PROFILE.maxOutputTokens,
    },
    providerMetadata: {
      id: "dashscope",
      displayName: "DashScope / Alibaba Cloud Model Studio",
      networkHost: "dashscope.aliyuncs.com",
    },
    pricing: {
      currency: "USD",
      inputCacheHitUsdPerMillion:
        QWEN_MAX_BENCHMARK_PROFILE.inputUsdPerMillion,
      inputCacheMissUsdPerMillion:
        QWEN_MAX_BENCHMARK_PROFILE.inputUsdPerMillion,
      outputUsdPerMillion: QWEN_MAX_BENCHMARK_PROFILE.outputUsdPerMillion,
    },
    maxRetries: QWEN_MAX_BENCHMARK_PROFILE.maxRetries,
    retryDelayMs: QWEN_MAX_BENCHMARK_PROFILE.retryDelayMs,
    enableThinking: QWEN_MAX_BENCHMARK_PROFILE.enableThinking,
    environment: dependencies.environment,
    fetch: dependencies.fetch,
    sleep: dependencies.sleep,
  };
  return new OpenAICompatibleProvider(options);
}
