import { OpenAICompatibleProvider } from "./openai-compatible-provider.js";

// Web destinations are host-owned. Never accept an API URL from a request/repository.
export const WEB_MODEL_PROFILES = {
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-flash", env: "DEEPSEEK_API_KEY", check: "balance", docs: "https://api-docs.deepseek.com/" },
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini", env: "OPENAI_API_KEY", check: "authentication", docs: "https://platform.openai.com/api-keys" },
  zhipu: { label: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4.7", env: "ZHIPU_API_KEY", check: "configuration", docs: "https://docs.bigmodel.cn/cn/guide/develop/http/introduction" },
  qwen: { label: "通义千问（北京）", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", env: "DASHSCOPE_API_KEY", check: "configuration", docs: "https://help.aliyun.com/zh/model-studio/get-api-key" },
  "qwen-intl": { label: "Qwen（新加坡）", baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", env: "DASHSCOPE_INTL_API_KEY", check: "configuration", docs: "https://help.aliyun.com/zh/model-studio/get-api-key" },
} as const;

export type WebModelProvider = keyof typeof WEB_MODEL_PROFILES;
export function isWebModelProvider(value: unknown): value is WebModelProvider {
  return typeof value === "string" && Object.hasOwn(WEB_MODEL_PROFILES, value);
}

export function webModelName(provider: WebModelProvider, value: unknown): string {
  if (value === undefined || value === "") return WEB_MODEL_PROFILES[provider].model;
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,99}$/.test(value) || /^sk-/i.test(value) || value.includes("://")) {
    throw new Error("INVALID_MODEL_NAME");
  }
  return value;
}

export function createWebModelProvider(provider: WebModelProvider, apiKey: string, model: string, fetchImpl?: typeof fetch): OpenAICompatibleProvider {
  const profile = WEB_MODEL_PROFILES[provider];
  return new OpenAICompatibleProvider({
    baseUrl: profile.baseUrl, model, apiKeyEnvName: profile.env,
    environment: { [profile.env]: apiKey }, fetch: fetchImpl,
    providerMetadata: { id: `${provider}-api`, displayName: profile.label, networkHost: new URL(profile.baseUrl).host },
    responseFormat: "json_object", timeoutMs: 180_000,
    tokenLimits: { contextTokens: 128_000, maxOutputTokens: 8_192 },
    maxRetries: 0,
    ...(provider === "openai" ? { tokenParameter: "max_completion_tokens" as const } : {}),
    ...(provider === "deepseek" || provider === "zhipu" ? { thinking: { type: "disabled" as const } } : {}),
    ...(provider === "qwen" || provider === "qwen-intl" ? { enableThinking: false } : {}),
  });
}
