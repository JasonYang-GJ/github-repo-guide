import {
  OpenAICompatibleProvider,
  type OpenAICompatibleProviderOptions,
} from "./openai-compatible-provider.js";

export const DEEPSEEK_V4_PRO_PROFILE = {
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-pro",
  modelVersion: "DeepSeek-V4-Pro-0813",
  apiKeyEnvName: "DEEPSEEK_API_KEY",
  responseFormat: "json_object",
  timeoutMs: 180_000,
  contextTokens: 1_000_000,
  maxOutputTokens: 384_000,
  maxRetries: 1,
  retryDelayMs: 250,
  pricingBasis: "peak-cache-aware-2026-09-01",
  inputCacheHitUsdPerMillion: 0.044,
  inputCacheMissUsdPerMillion: 1.32,
  outputUsdPerMillion: 3.96,
} as const;

export const DEEPSEEK_FLASH_PROFILE = {
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-flash",
  modelVersion: "DeepSeek-V4.1-Flash",
  apiKeyEnvName: "DEEPSEEK_API_KEY",
  responseFormat: "json_object",
  timeoutMs: 180_000,
  contextTokens: 1_000_000,
  maxOutputTokens: 384_000,
  maxRetries: 1,
  retryDelayMs: 250,
  pricingBasis: "peak-cache-aware-2026-09-15",
  inputCacheHitUsdPerMillion: 0.006,
  inputCacheMissUsdPerMillion: 0.3,
  outputUsdPerMillion: 1.2,
} as const;

export interface DeepSeekV4ProProviderDependencies {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly fetch?: typeof fetch;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly maxRetries?: 0 | 1;
}

export const DEEPSEEK_V4_PRO_NON_THINKING_SURFACE_PROFILE = {
  taskClass: "surface_realization",
  thinking: "disabled",
  reasoningEffort: null,
} as const;

export const DEEPSEEK_V4_PRO_CONTENT_ANGLE_PROFILE = {
  taskClass: "content_angle_selection",
  thinking: "enabled",
  reasoningEffort: "low",
  maxRetries: 0,
} as const;

interface DeepSeekV4ProRequestProfile {
  readonly thinking: "enabled" | "disabled";
  readonly reasoningEffort: "low" | "high" | "max" | null;
}

function createDeepSeekV4ProProviderForProfile(
  dependencies: DeepSeekV4ProProviderDependencies,
  requestProfile: DeepSeekV4ProRequestProfile,
): OpenAICompatibleProvider {
  const options: OpenAICompatibleProviderOptions = {
    baseUrl: DEEPSEEK_V4_PRO_PROFILE.baseUrl,
    model: DEEPSEEK_V4_PRO_PROFILE.model,
    apiKeyEnvName: DEEPSEEK_V4_PRO_PROFILE.apiKeyEnvName,
    responseFormat: DEEPSEEK_V4_PRO_PROFILE.responseFormat,
    timeoutMs: DEEPSEEK_V4_PRO_PROFILE.timeoutMs,
    tokenLimits: {
      contextTokens: DEEPSEEK_V4_PRO_PROFILE.contextTokens,
      maxOutputTokens: DEEPSEEK_V4_PRO_PROFILE.maxOutputTokens,
    },
    providerMetadata: {
      id: "deepseek-api",
      displayName: "DeepSeek API",
      networkHost: "api.deepseek.com",
    },
    pricing: {
      currency: "USD",
      inputCacheHitUsdPerMillion:
        DEEPSEEK_V4_PRO_PROFILE.inputCacheHitUsdPerMillion,
      inputCacheMissUsdPerMillion:
        DEEPSEEK_V4_PRO_PROFILE.inputCacheMissUsdPerMillion,
      outputUsdPerMillion: DEEPSEEK_V4_PRO_PROFILE.outputUsdPerMillion,
    },
    maxRetries: dependencies.maxRetries ?? DEEPSEEK_V4_PRO_PROFILE.maxRetries,
    retryDelayMs: DEEPSEEK_V4_PRO_PROFILE.retryDelayMs,
    thinking: { type: requestProfile.thinking },
    reasoningEffort: requestProfile.reasoningEffort ?? undefined,
    environment: dependencies.environment,
    fetch: dependencies.fetch,
    sleep: dependencies.sleep,
  };
  return new OpenAICompatibleProvider(options);
}

export function createDeepSeekV4ProProvider(
  dependencies: DeepSeekV4ProProviderDependencies = {},
): OpenAICompatibleProvider {
  return createDeepSeekV4ProProviderForProfile(dependencies, {
    thinking: "enabled",
    reasoningEffort: "high",
  });
}

export function createDeepSeekFlashProvider(
  dependencies: DeepSeekV4ProProviderDependencies = {},
): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    baseUrl: DEEPSEEK_FLASH_PROFILE.baseUrl,
    model: DEEPSEEK_FLASH_PROFILE.model,
    apiKeyEnvName: DEEPSEEK_FLASH_PROFILE.apiKeyEnvName,
    responseFormat: DEEPSEEK_FLASH_PROFILE.responseFormat,
    timeoutMs: DEEPSEEK_FLASH_PROFILE.timeoutMs,
    tokenLimits: {
      contextTokens: DEEPSEEK_FLASH_PROFILE.contextTokens,
      maxOutputTokens: DEEPSEEK_FLASH_PROFILE.maxOutputTokens,
    },
    providerMetadata: {
      id: "deepseek-api",
      displayName: "DeepSeek API",
      networkHost: "api.deepseek.com",
    },
    pricing: {
      currency: "USD",
      inputCacheHitUsdPerMillion:
        DEEPSEEK_FLASH_PROFILE.inputCacheHitUsdPerMillion,
      inputCacheMissUsdPerMillion:
        DEEPSEEK_FLASH_PROFILE.inputCacheMissUsdPerMillion,
      outputUsdPerMillion: DEEPSEEK_FLASH_PROFILE.outputUsdPerMillion,
    },
    maxRetries: dependencies.maxRetries ?? DEEPSEEK_FLASH_PROFILE.maxRetries,
    retryDelayMs: DEEPSEEK_FLASH_PROFILE.retryDelayMs,
    thinking: { type: "disabled" },
    environment: dependencies.environment,
    fetch: dependencies.fetch,
    sleep: dependencies.sleep,
  });
}

export function createDeepSeekV4ProNonThinkingProvider(
  dependencies: DeepSeekV4ProProviderDependencies = {},
): OpenAICompatibleProvider {
  return createDeepSeekV4ProProviderForProfile(
    dependencies,
    DEEPSEEK_V4_PRO_NON_THINKING_SURFACE_PROFILE,
  );
}

export function createDeepSeekV4ProContentAngleProvider(
  dependencies: DeepSeekV4ProProviderDependencies = {},
): OpenAICompatibleProvider {
  return createDeepSeekV4ProProviderForProfile(
    { ...dependencies, maxRetries: DEEPSEEK_V4_PRO_CONTENT_ANGLE_PROFILE.maxRetries },
    DEEPSEEK_V4_PRO_CONTENT_ANGLE_PROFILE,
  );
}
