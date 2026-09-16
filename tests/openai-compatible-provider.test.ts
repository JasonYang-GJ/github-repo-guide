import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createWebModelProvider, WEB_MODEL_PROFILES, webModelName, isWebModelProvider, type WebModelProvider } from "../src/model/web-profiles.js";

import {
  calculateOpenAICompatibleCost,
  OpenAICompatibleProvider,
  OpenAICompatibleProviderError,
  type OpenAICompatibleProviderOptions,
} from "../src/model/openai-compatible-provider.js";
import type { StructuredGenerationRequest } from "../src/model/provider.js";
import {
  createDeepSeekFlashProvider,
  createDeepSeekV4ProContentAngleProvider,
  createDeepSeekV4ProNonThinkingProvider,
  createDeepSeekV4ProProvider,
  DEEPSEEK_V4_PRO_CONTENT_ANGLE_PROFILE,
  DEEPSEEK_V4_PRO_NON_THINKING_SURFACE_PROFILE,
  DEEPSEEK_V4_PRO_PROFILE,
} from "../src/model/deepseek-profile.js";
import {
  createQwenMaxNonThinkingProvider,
  QWEN_MAX_BENCHMARK_PROFILE,
} from "../src/model/qwen-profile.js";

const briefRequest: StructuredGenerationRequest = {
  stage: "brief",
  schemaId: "internal:brief-narrative:1",
  systemInstructions: "Return a bounded interpretation.",
  untrustedRepositoryContext: [
    {
      path: "src/index.ts",
      content: "export const value = 1;",
      trust: "untrusted_repository_data",
    },
  ],
  untrustedRepositorySignals: { projectName: "fixture" },
  repositoryReadReceipt: {
    highestScope: 2,
    filesConsidered: ["src/index.ts"],
    filesRead: ["src/index.ts"],
  },
  maxOutputTokens: 800,
  cacheKey: "fixture:brief",
};

for (const provider of Object.keys(WEB_MODEL_PROFILES) as WebModelProvider[]) {
  test(`Web ${provider} routes only to its official endpoint with isolated credentials and bounded JSON generation`, async () => {
    const profile = WEB_MODEL_PROFILES[provider];
    const secret = `test-${randomUUID()}`;
    let calls = 0;
    const client = createWebModelProvider(provider, secret, profile.model, async (url, init) => {
      calls++;
      assert.equal(String(url), `${profile.baseUrl}/chat/completions`);
      assert.equal(init?.redirect, "error");
      assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${secret}`);
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, profile.model);
      assert.deepEqual(body.response_format, { type: "json_object" });
      assert.equal(body[provider === "openai" ? "max_completion_tokens" : "max_tokens"], 800);
      assert.equal(body[provider === "openai" ? "max_tokens" : "max_completion_tokens"], undefined);
      assert.equal(body.stream, false);
      assert.equal(body.thinking?.type, ["deepseek", "zhipu"].includes(provider) ? "disabled" : undefined);
      assert.equal(body.enable_thinking, provider.startsWith("qwen") ? false : undefined);
      assert.ok(!String(init?.body).includes(secret));
      return successfulResponse();
    });
    const result = await client.generateStructured(briefRequest);
    assert.equal(result.provider, `${provider}-api`);
    assert.equal(calls, 1);
    assert.ok(!JSON.stringify(result).includes(secret));
    assert.throws(() => client.pricing, /not configured/);
  });

  test(`Web ${provider} does not retry paid HTTP failures`, async () => {
    let calls = 0;
    const client = createWebModelProvider(provider, "test-no-charge", WEB_MODEL_PROFILES[provider].model, async () => {
      calls++;
      return new Response("do not echo this error or credential", { status: 503 });
    });
    await assert.rejects(client.generateStructured(briefRequest), (error: unknown) => error instanceof OpenAICompatibleProviderError && error.attempts === 1 && !error.message.includes("credential"));
    assert.equal(calls, 1);
  });
}

test("Web provider and model validation rejects URL/credential injection", () => {
  for (const value of ["constructor", "__proto__", "https://example.com", null]) assert.equal(isWebModelProvider(value), false);
  for (const value of ["sk-not-a-model", "https://example.com", "gpt\nsecret", "x".repeat(101), 42]) assert.throws(() => webModelName("openai", value));
  assert.equal(webModelName("openai", undefined), "gpt-4.1-mini");
  assert.equal(webModelName("openai", "gpt-4.1-mini-2025-04-14"), "gpt-4.1-mini-2025-04-14");
});

const validBrief = {
  oneSentence: "A bounded fixture.",
  summary: "The fixture exposes one constant.",
  problem: "",
  targetUsers: ["maintainers"],
  moduleInterpretations: [
    {
      sourcePath: "src/index.ts",
      semanticName: "Entry",
      responsibility: "Exports the constant.",
      whyImportant: "It is the supplied source boundary.",
    },
  ],
};

function successfulResponse(content: string = JSON.stringify(validBrief)): Response {
  return new Response(
    JSON.stringify({
      id: "chatcmpl_fixture",
      model: "deepseek-v4-pro",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: { role: "assistant", content },
        },
      ],
      usage: {
        prompt_tokens: 120,
        completion_tokens: 30,
        total_tokens: 150,
        prompt_cache_hit_tokens: 20,
        prompt_cache_miss_tokens: 100,
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function providerOptions(
  secret: string,
  fetchImpl: typeof fetch,
): OpenAICompatibleProviderOptions {
  return {
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-pro",
    apiKeyEnvName: "DEEPSEEK_API_KEY",
    responseFormat: "json_object",
    timeoutMs: 1_000,
    tokenLimits: { contextTokens: 1_000_000, maxOutputTokens: 384_000 },
    providerMetadata: {
      id: "deepseek-api",
      displayName: "DeepSeek API",
      networkHost: "api.deepseek.com",
    },
    pricing: {
      currency: "USD",
      inputCacheHitUsdPerMillion: 0.044,
      inputCacheMissUsdPerMillion: 1.32,
      outputUsdPerMillion: 3.96,
    },
    environment: { DEEPSEEK_API_KEY: secret },
    fetch: fetchImpl,
  };
}

test("OpenAICompatibleProvider serializes endpoint, model, JSON mode, and usage", async () => {
  const secret = randomUUID();
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const provider = new OpenAICompatibleProvider(
    providerOptions(secret, async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return successfulResponse();
    }),
  );

  const result = await provider.generateStructured<typeof validBrief>(briefRequest);

  assert.equal(capturedUrl, "https://api.deepseek.com/chat/completions");
  assert.ok(capturedInit !== undefined);
  const body = JSON.parse(String(capturedInit.body)) as {
    readonly model: string;
    readonly response_format: { readonly type: string };
    readonly max_tokens: number;
    readonly stream: boolean;
  };
  assert.equal(body.model, "deepseek-v4-pro");
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.max_tokens, 800);
  assert.equal(body.stream, false);
  assert.equal(result.provider, "deepseek-api");
  assert.equal(result.model, "deepseek-v4-pro");
  assert.deepEqual(result.usage, {
    inputTokens: 120,
    outputTokens: 30,
    cacheHitInputTokens: 20,
    cacheMissInputTokens: 100,
  });
  assert.equal(result.networkCalls, 1);
  assert.equal(result.paid, true);
  assert.equal(result.rawOutput, JSON.stringify(validBrief));
  assert.equal(result.finishReason, "stop");
  assert.equal(result.context.endpoint, "remote_https");
  assert.equal(capturedUrl.includes(secret), false);
  assert.equal(String(capturedInit.body).includes(secret), false);
});

test("OpenAICompatibleProvider fails before transport when DEEPSEEK_API_KEY is absent", () => {
  let transportCalls = 0;
  assert.throws(
    () =>
      new OpenAICompatibleProvider({
        ...providerOptions(randomUUID(), async () => {
          transportCalls += 1;
          return successfulResponse();
        }),
        environment: {},
      }),
    (error: unknown) => {
      assert.ok(error instanceof OpenAICompatibleProviderError);
      assert.equal(error.code, "API_KEY_NOT_CONFIGURED");
      assert.equal(error.message, "DEEPSEEK_API_KEY_NOT_CONFIGURED");
      return true;
    },
  );
  assert.equal(transportCalls, 0);
});

test("OpenAICompatibleProvider redacts the API key and remote error body", async () => {
  const secret = randomUUID();
  let capturedUrl = "";
  const provider = new OpenAICompatibleProvider(
    {
      ...providerOptions(secret, async (input) => {
        capturedUrl = String(input);
        return new Response(JSON.stringify({ error: `echo:${secret}` }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }),
      maxRetries: 1,
      retryDelayMs: 0,
      sleep: async () => undefined,
    },
  );

  await assert.rejects(provider.generateStructured(briefRequest), (error: unknown) => {
    assert.ok(error instanceof OpenAICompatibleProviderError);
    assert.equal(error.code, "HTTP_ERROR");
    assert.equal(error.attempts, 1);
    assert.equal(error.message, "Provider returned HTTP 401.");
    assert.equal(error.message.includes(secret), false);
    assert.equal(error.message.includes("echo"), false);
    assert.equal(capturedUrl.includes(secret), false);
    return true;
  });
});

test("OpenAICompatibleProvider fails closed on malformed model JSON", async () => {
  const provider = new OpenAICompatibleProvider(
    providerOptions(randomUUID(), async () => successfulResponse('{"oneSentence":')),
  );

  await assert.rejects(provider.generateStructured(briefRequest), (error: unknown) => {
    assert.ok(error instanceof OpenAICompatibleProviderError);
    assert.equal(error.code, "JSON_SYNTAX_INVALID");
    assert.equal(error.attempts, 1);
    return true;
  });
});

test("OpenAICompatibleProvider rejects the documented empty-content response", async () => {
  const provider = new OpenAICompatibleProvider(
    providerOptions(randomUUID(), async () => successfulResponse("   ")),
  );

  await assert.rejects(provider.generateStructured(briefRequest), (error: unknown) => {
    assert.ok(error instanceof OpenAICompatibleProviderError);
    assert.equal(error.code, "EMPTY_CONTENT");
    assert.equal(error.attempts, 1);
    return true;
  });
});

test("OpenAICompatibleProvider rejects finish_reason length as truncated output", async () => {
  const partialContent = '{"partial":"must-not-be-persisted"';
  const privateReasoning = "private reasoning must not be persisted";
  const truncated = new Response(
    JSON.stringify({
      model: "deepseek-v4-pro",
      choices: [
        {
          index: 0,
          finish_reason: "length",
          message: {
            role: "assistant",
            content: partialContent,
            reasoning_content: privateReasoning,
          },
        },
      ],
      usage: {
        prompt_tokens: 120,
        completion_tokens: 800,
        total_tokens: 920,
        prompt_cache_hit_tokens: 20,
        prompt_cache_miss_tokens: 100,
        completion_tokens_details: { reasoning_tokens: 760 },
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
  const provider = new OpenAICompatibleProvider({
    ...providerOptions(randomUUID(), async () => truncated),
    thinking: { type: "enabled" },
    reasoningEffort: "low",
  });

  await assert.rejects(provider.generateStructured(briefRequest), (error: unknown) => {
    assert.ok(error instanceof OpenAICompatibleProviderError);
    assert.equal(error.code, "TRUNCATED_OUTPUT");
    assert.equal(error.attempts, 1);
    assert.deepEqual(error.telemetry, {
      stage: "brief",
      provider: "deepseek-api",
      model: "deepseek-v4-pro",
      finishReason: "length",
      requestConfiguration: { thinking: "enabled", reasoningEffort: "low" },
      reasoning: {
        tokens: 760,
        contentCharacters: privateReasoning.length,
        visibleContentTokens: 40,
      },
      usage: {
        inputTokens: 120,
        outputTokens: 800,
        cacheHitInputTokens: 20,
        cacheMissInputTokens: 100,
      },
      visibleContentCharacters: partialContent.length,
      networkCalls: 1,
      paid: true,
    });
    const persisted = JSON.stringify(error.telemetry);
    assert.equal(persisted.includes(partialContent), false);
    assert.equal(persisted.includes(privateReasoning), false);
    return true;
  });
});

test("OpenAICompatibleProvider preserves truncated usage when reasoning leaves final content empty", async () => {
  const truncated = new Response(
    JSON.stringify({
      model: "deepseek-v4-pro",
      choices: [
        {
          index: 0,
          finish_reason: "length",
          message: {
            role: "assistant",
            content: "",
            reasoning_content: "private reasoning",
          },
        },
      ],
      usage: {
        prompt_tokens: 6_241,
        completion_tokens: 12_000,
        total_tokens: 18_241,
        completion_tokens_details: { reasoning_tokens: 12_000 },
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
  const provider = new OpenAICompatibleProvider({
    ...providerOptions(randomUUID(), async () => truncated),
    thinking: { type: "enabled" },
    reasoningEffort: "low",
  });

  await assert.rejects(provider.generateStructured(briefRequest), (error: unknown) => {
    assert.ok(error instanceof OpenAICompatibleProviderError);
    assert.equal(error.code, "TRUNCATED_OUTPUT");
    assert.equal(error.telemetry?.usage.inputTokens, 6_241);
    assert.equal(error.telemetry?.usage.outputTokens, 12_000);
    assert.equal(error.telemetry?.reasoning.tokens, 12_000);
    assert.equal(error.telemetry?.reasoning.visibleContentTokens, 0);
    assert.equal(error.telemetry?.visibleContentCharacters, 0);
    return true;
  });
});

test("OpenAICompatibleProvider rejects a non-stop completion as incomplete", async () => {
  const incomplete = new Response(
    JSON.stringify({
      model: "deepseek-v4-pro",
      choices: [
        {
          index: 0,
          finish_reason: "content_filter",
          message: { role: "assistant", content: JSON.stringify(validBrief) },
        },
      ],
      usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
  const provider = new OpenAICompatibleProvider(
    providerOptions(randomUUID(), async () => incomplete),
  );

  await assert.rejects(provider.generateStructured(briefRequest), (error: unknown) => {
    assert.ok(error instanceof OpenAICompatibleProviderError);
    assert.equal(error.code, "INVALID_RESPONSE");
    assert.equal(error.attempts, 1);
    return true;
  });
});

test("OpenAICompatibleProvider rejects unknown fields and fabricated verified evidence", async () => {
  const fabricated = {
    ...validBrief,
    verifiedEvidence: {
      sourcePath: "src/index.ts",
      status: "verified",
    },
  };
  const provider = new OpenAICompatibleProvider(
    providerOptions(randomUUID(), async () => successfulResponse(JSON.stringify(fabricated))),
  );

  await assert.rejects(provider.generateStructured(briefRequest), (error: unknown) => {
    assert.ok(error instanceof OpenAICompatibleProviderError);
    assert.equal(error.code, "SCHEMA_VALIDATION_FAILED");
    return true;
  });
});

test("OpenAICompatibleProvider rejects a malformed HTTP response envelope", async () => {
  const provider = new OpenAICompatibleProvider(
    providerOptions(
      randomUUID(),
      async () =>
        new Response("not-json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ),
  );

  await assert.rejects(provider.generateStructured(briefRequest), (error: unknown) => {
    assert.ok(error instanceof OpenAICompatibleProviderError);
    assert.equal(error.code, "INVALID_RESPONSE");
    assert.equal(error.attempts, 1);
    return true;
  });
});

test("OpenAICompatibleProvider fails closed on timeout without exposing transport detail", async () => {
  const secret = randomUUID();
  const provider = new OpenAICompatibleProvider(
    providerOptions(secret, async () => {
      throw new DOMException(`timeout:${secret}`, "TimeoutError");
    }),
  );

  await assert.rejects(provider.generateStructured(briefRequest), (error: unknown) => {
    assert.ok(error instanceof OpenAICompatibleProviderError);
    assert.equal(error.code, "TIMEOUT");
    assert.equal(error.attempts, 1);
    assert.equal(error.message.includes(secret), false);
    return true;
  });
});

test("OpenAICompatibleProvider requires non-negative integer usage counters", async () => {
  const response = new Response(
    JSON.stringify({
      model: "deepseek-v4-pro",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: { role: "assistant", content: JSON.stringify(validBrief) },
        },
      ],
      usage: { prompt_tokens: "120", completion_tokens: -1, total_tokens: 119 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
  const provider = new OpenAICompatibleProvider(
    providerOptions(randomUUID(), async () => response),
  );

  await assert.rejects(provider.generateStructured(briefRequest), (error: unknown) => {
    assert.ok(error instanceof OpenAICompatibleProviderError);
    assert.equal(error.code, "INVALID_USAGE");
    return true;
  });
});

test("OpenAI-compatible budget calculation uses cache-aware official unit prices", () => {
  const pricing = providerOptions(randomUUID(), async () => successfulResponse()).pricing;
  const cost = calculateOpenAICompatibleCost(
    {
      inputTokens: 120,
      outputTokens: 30,
      cacheHitInputTokens: 20,
      cacheMissInputTokens: 100,
    },
    pricing,
  );

  assert.deepEqual(cost, {
    currency: "USD",
    inputCost: 0.00013288,
    outputCost: 0.0001188,
    totalCost: 0.00025168,
  });
});

test("OpenAICompatibleProvider retries 429, 500, and 503 at most once", async () => {
  for (const status of [429, 500, 503]) {
    let calls = 0;
    const delays: number[] = [];
    const provider = new OpenAICompatibleProvider({
      ...providerOptions(randomUUID(), async () => {
        calls += 1;
        return calls === 1
          ? new Response("transient", { status, headers: { "retry-after": "0" } })
          : successfulResponse();
      }),
      maxRetries: 1,
      retryDelayMs: 25,
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
    });

    const result = await provider.generateStructured(briefRequest);
    assert.equal(calls, 2);
    assert.deepEqual(delays, [0]);
    assert.equal(result.networkCalls, 2);
  }
});

test("DeepSeek profile freezes the current V4 Pro canary configuration", async () => {
  const secret = randomUUID();
  let capturedBody = "";
  const provider = createDeepSeekV4ProProvider({
    environment: { DEEPSEEK_API_KEY: secret },
    fetch: async (_input, init) => {
      capturedBody = String(init?.body);
      return successfulResponse();
    },
    sleep: async () => undefined,
  });

  await provider.generateStructured(briefRequest);
  const body = JSON.parse(capturedBody) as {
    readonly model: string;
    readonly thinking: { readonly type: string };
    readonly reasoning_effort: string;
  };
  assert.equal(body.model, "deepseek-v4-pro");
  assert.deepEqual(body.thinking, { type: "enabled" });
  assert.equal(body.reasoning_effort, "high");
  assert.deepEqual(DEEPSEEK_V4_PRO_PROFILE, {
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
  });
});

test("DeepSeek surface profile disables thinking and omits reasoning effort", async () => {
  const secret = randomUUID();
  let capturedBody = "";
  const provider = createDeepSeekV4ProNonThinkingProvider({
    environment: { DEEPSEEK_API_KEY: secret },
    maxRetries: 0,
    fetch: async (_input, init) => {
      capturedBody = String(init?.body);
      return successfulResponse();
    },
  });

  const result = await provider.generateStructured(briefRequest);
  const body = JSON.parse(capturedBody) as Record<string, unknown>;

  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.equal("reasoning_effort" in body, false);
  assert.deepEqual(result.requestConfiguration, {
    thinking: "disabled",
    reasoningEffort: null,
  });
  assert.deepEqual(DEEPSEEK_V4_PRO_NON_THINKING_SURFACE_PROFILE, {
    taskClass: "surface_realization",
    thinking: "disabled",
    reasoningEffort: null,
  });
  assert.equal(capturedBody.includes(secret), false);
});

test("DeepSeek Flash web profile disables thinking so structured output keeps its full budget", async () => {
  const secret = randomUUID();
  let capturedBody = "";
  const provider = createDeepSeekFlashProvider({
    environment: { DEEPSEEK_API_KEY: secret },
    maxRetries: 0,
    fetch: async (_input, init) => {
      capturedBody = String(init?.body);
      return successfulResponse();
    },
  });

  const result = await provider.generateStructured(briefRequest);
  const body = JSON.parse(capturedBody) as Record<string, unknown>;

  assert.equal(body.model, "deepseek-flash");
  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.equal("reasoning_effort" in body, false);
  assert.deepEqual(result.requestConfiguration, {
    thinking: "disabled",
    reasoningEffort: null,
  });
  assert.equal(capturedBody.includes(secret), false);
});

test("Qwen Max profile uses DashScope JSON mode and explicitly disables thinking", async () => {
  const secret = randomUUID();
  let capturedUrl = "";
  let capturedBody = "";
  const provider = createQwenMaxNonThinkingProvider({
    environment: { DASHSCOPE_API_KEY: secret },
    fetch: async (input: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedBody = String(init?.body);
      return successfulResponse();
    },
  });

  const result = await provider.generateStructured(briefRequest);
  const body = JSON.parse(capturedBody) as Record<string, unknown>;

  assert.equal(
    capturedUrl,
    "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
  );
  assert.equal(body.model, "qwen3.8-max");
  assert.equal(body.enable_thinking, false);
  assert.equal("thinking" in body, false);
  assert.equal("reasoning_effort" in body, false);
  assert.deepEqual(result.requestConfiguration, {
    thinking: "disabled",
    reasoningEffort: null,
  });
  assert.equal(capturedBody.includes(secret), false);
  assert.deepEqual(QWEN_MAX_BENCHMARK_PROFILE, {
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
  });
});

test("Qwen Max profile fails before transport when DASHSCOPE_API_KEY is absent", () => {
  let transportCalls = 0;
  assert.throws(
    () =>
      createQwenMaxNonThinkingProvider({
        environment: {},
        fetch: async () => {
          transportCalls += 1;
          return successfulResponse();
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof OpenAICompatibleProviderError);
      assert.equal(error.code, "API_KEY_NOT_CONFIGURED");
      assert.equal(error.message, "DASHSCOPE_API_KEY_NOT_CONFIGURED");
      return true;
    },
  );
  assert.equal(transportCalls, 0);
});

test("OpenAICompatibleProvider rejects mixed DeepSeek and Qwen thinking controls", () => {
  assert.throws(
    () =>
      new OpenAICompatibleProvider({
        ...providerOptions(randomUUID(), async () => successfulResponse()),
        thinking: { type: "disabled" },
        enableThinking: false,
      }),
    (error: unknown) => {
      assert.ok(error instanceof OpenAICompatibleProviderError);
      assert.equal(error.code, "INVALID_CONFIGURATION");
      return true;
    },
  );
});

test("DeepSeek Content Angle profile sends low reasoning and hard-disables retries", async () => {
  const secret = randomUUID();
  let capturedBody = "";
  let calls = 0;
  const provider = createDeepSeekV4ProContentAngleProvider({
    environment: { DEEPSEEK_API_KEY: secret },
    maxRetries: 1,
    fetch: async (_input, init) => {
      calls += 1;
      capturedBody = String(init?.body);
      return new Response("transient", { status: 429 });
    },
  });

  await assert.rejects(provider.generateStructured(briefRequest), (error: unknown) => {
    assert.ok(error instanceof OpenAICompatibleProviderError);
    assert.equal(error.code, "HTTP_ERROR");
    assert.equal(error.attempts, 1);
    return true;
  });

  const body = JSON.parse(capturedBody) as Record<string, unknown>;
  assert.deepEqual(body.thinking, { type: "enabled" });
  assert.equal(body.reasoning_effort, "low");
  assert.equal(calls, 1);
  assert.deepEqual(DEEPSEEK_V4_PRO_CONTENT_ANGLE_PROFILE, {
    taskClass: "content_angle_selection",
    thinking: "enabled",
    reasoningEffort: "low",
    maxRetries: 0,
  });
  assert.equal(capturedBody.includes(secret), false);
});

test("OpenAICompatibleProvider rejects reasoning effort when thinking is disabled", () => {
  assert.throws(
    () =>
      new OpenAICompatibleProvider({
        ...providerOptions(randomUUID(), async () => successfulResponse()),
        thinking: { type: "disabled" },
        reasoningEffort: "high",
      }),
    (error: unknown) => {
      assert.ok(error instanceof OpenAICompatibleProviderError);
      assert.equal(error.code, "INVALID_CONFIGURATION");
      assert.equal(error.attempts, 0);
      return true;
    },
  );
});

test("OpenAICompatibleProvider keeps reasoning content separate from the final Brief", async () => {
  const finalContent = JSON.stringify(validBrief);
  const response = new Response(
    JSON.stringify({
      model: "deepseek-v4-pro",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: finalContent,
            reasoning_content: "analysis",
          },
        },
      ],
      usage: {
        prompt_tokens: 120,
        completion_tokens: 35,
        total_tokens: 155,
        prompt_cache_hit_tokens: 20,
        prompt_cache_miss_tokens: 100,
        completion_tokens_details: { reasoning_tokens: 5 },
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
  const provider = new OpenAICompatibleProvider({
    ...providerOptions(randomUUID(), async () => response),
    thinking: { type: "disabled" },
  });

  const result = await provider.generateStructured<typeof validBrief>(briefRequest);

  assert.deepEqual(result.value, validBrief);
  assert.equal(result.rawOutput, finalContent);
  assert.deepEqual(result.reasoning, {
    tokens: 5,
    contentCharacters: 8,
    visibleContentTokens: 30,
  });
});

test("OpenAICompatibleProvider never substitutes reasoning content for empty final content", async () => {
  const response = new Response(
    JSON.stringify({
      model: "deepseek-v4-pro",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: "",
            reasoning_content: JSON.stringify(validBrief),
          },
        },
      ],
      usage: {
        prompt_tokens: 120,
        completion_tokens: 30,
        total_tokens: 150,
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
  const provider = new OpenAICompatibleProvider(
    providerOptions(randomUUID(), async () => response),
  );

  await assert.rejects(provider.generateStructured(briefRequest), (error: unknown) => {
    assert.ok(error instanceof OpenAICompatibleProviderError);
    assert.equal(error.code, "EMPTY_CONTENT");
    return true;
  });
});

test("DeepSeek canary can hard-disable retries for a one-attempt authorization", async () => {
  let calls = 0;
  const delays: number[] = [];
  const provider = createDeepSeekV4ProProvider({
    environment: { DEEPSEEK_API_KEY: randomUUID() },
    maxRetries: 0,
    fetch: async () => {
      calls += 1;
      return new Response("transient", { status: 429 });
    },
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    },
  });

  await assert.rejects(provider.generateStructured(briefRequest), (error: unknown) => {
    assert.ok(error instanceof OpenAICompatibleProviderError);
    assert.equal(error.code, "HTTP_ERROR");
    assert.equal(error.attempts, 1);
    return true;
  });
  assert.equal(calls, 1);
  assert.deepEqual(delays, []);
});

test("OpenAICompatibleProvider rejects configured token-limit overflow before transport", async () => {
  let calls = 0;
  const provider = new OpenAICompatibleProvider({
    ...providerOptions(randomUUID(), async () => {
      calls += 1;
      return successfulResponse();
    }),
    tokenLimits: { contextTokens: 1_000_000, maxOutputTokens: 100 },
  });

  await assert.rejects(provider.generateStructured(briefRequest), (error: unknown) => {
    assert.ok(error instanceof OpenAICompatibleProviderError);
    assert.equal(error.code, "TOKEN_LIMIT_EXCEEDED");
    assert.equal(error.attempts, 0);
    return true;
  });
  assert.equal(calls, 0);
});

test("OpenAICompatibleProvider rejects a cache breakdown that understates input usage", async () => {
  const response = new Response(
    JSON.stringify({
      model: "deepseek-v4-pro",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: { role: "assistant", content: JSON.stringify(validBrief) },
        },
      ],
      usage: {
        prompt_tokens: 120,
        completion_tokens: 30,
        total_tokens: 150,
        prompt_cache_hit_tokens: 20,
        prompt_cache_miss_tokens: 50,
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
  const provider = new OpenAICompatibleProvider(
    providerOptions(randomUUID(), async () => response),
  );

  await assert.rejects(provider.generateStructured(briefRequest), (error: unknown) => {
    assert.ok(error instanceof OpenAICompatibleProviderError);
    assert.equal(error.code, "INVALID_USAGE");
    return true;
  });
});
