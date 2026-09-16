import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import type { request as RequestFunction } from "node:https";
import { parseCustomConnection, customModelEndpoint, isPublicModelAddress, resolvePublicModelHost, pinnedModelFetch, createCustomModelProvider } from "../src/model/custom-connection.js";
import { OpenAICompatibleProviderError } from "../src/model/openai-compatible-provider.js";
import type { StructuredGenerationRequest } from "../src/model/provider.js";

const config = { name: "My service", baseUrl: "https://models.example.com/v1", apiFormat: "openai-chat", model: "my-model-v1" };
const brief = { oneSentence: "A fixture.", summary: "A bounded fixture.", problem: "", targetUsers: [], moduleInterpretations: [] };
const request: StructuredGenerationRequest = {
  stage: "brief", schemaId: "internal:brief-narrative:1", systemInstructions: "Explain verified input.",
  untrustedRepositoryContext: [], untrustedRepositorySignals: {},
  repositoryReadReceipt: { highestScope: 1, filesConsidered: [], filesRead: [] }, maxOutputTokens: 2500, cacheKey: "custom-fixture",
};

test("custom providers accept arbitrary brands, compatible formats and base path prefixes", () => {
  for (const name of ["Kimi", "My Claude", "An unlisted provider"]) assert.equal(parseCustomConnection({ ...config, name }).name, name);
  assert.equal(customModelEndpoint(parseCustomConnection(config)), "https://models.example.com/v1/chat/completions");
  assert.equal(customModelEndpoint(parseCustomConnection({ ...config, apiFormat: "anthropic-messages", baseUrl: "https://models.example.com" })), "https://models.example.com/v1/messages");
  assert.equal(customModelEndpoint(parseCustomConnection({ ...config, apiFormat: "anthropic-messages", baseUrl: "https://models.example.com/proxy/anthropic/v1/" })), "https://models.example.com/proxy/anthropic/v1/messages");
});

for (const baseUrl of ["http://example.com/v1", "https://user:secret@example.com/v1", "https://example.com/v1?key=test", "https://example.com/#key", "https://localhost/v1", "https://service.local/v1", "https://metadata.google.internal/v1", "https://127.1/v1", "https://2130706433/v1", "https://0x7f000001/v1", "https://[::1]/v1", "https://[::ffff:127.0.0.1]/v1", "https://169.254.169.254/v1", "https://10.0.0.1/v1", "https://example.com/v1/messages", "https://example.com/v1/chat/completions", "https://example.com/v1/responses", "https://example.com./v1", "https://example.com/%73ecret"]) {
  test(`custom URL guard blocks ${baseUrl.replace(/user:secret/, "credentials")}`, () => {
    assert.throws(() => parseCustomConnection({ ...config, baseUrl }));
  });
}

test("custom configuration rejects extra secrets, missing models and unsupported protocols", () => {
  for (const extra of [{ apiKey: "test-secret" }, { headers: {} }, { model: "" }, { model: "sk-test-secret" }, { model: "x\nmodel" }, { name: "" }, { apiFormat: "unknown" }, { tokenParameter: "temperature" }, { jsonMode: "true" }]) assert.throws(() => parseCustomConnection({ ...config, ...extra }));
});

test("IPv4/IPv6 classification and mixed DNS answers fail closed", async () => {
  for (const address of ["0.0.0.0", "100.64.0.1", "172.16.1.1", "192.168.1.1", "198.18.0.1", "203.0.113.1", "224.0.0.1", "240.1.1.1", "::", "::1", "fc00::1", "fe80::1", "ff02::1", "2001:db8::1", "2002:7f00:1::", "64:ff9b::7f00:1", "::ffff:8.8.8.8"]) assert.equal(isPublicModelAddress(address), false, address);
  for (const address of ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"]) assert.equal(isPublicModelAddress(address), true, address);
  const url = new URL(config.baseUrl);
  await assert.rejects(resolvePublicModelHost(url, async () => [{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }]), /阻止/);
  await assert.rejects(resolvePublicModelHost(url, async () => []), /阻止/);
  await assert.rejects(resolvePublicModelHost(url, async () => { throw new Error("raw internal DNS details"); }), error => !String(error).includes("raw internal"));
  assert.deepEqual(await resolvePublicModelHost(url, async () => [{ address: "8.8.8.8", family: 4 }]), { address: "8.8.8.8", family: 4 });
});

test("HTTPS transport pins validated DNS, preserves hostname/TLS, refuses another destination and does not follow redirects", async () => {
  const endpoint = "https://models.example.com/v1/chat/completions";
  let calls = 0;
  const fakeRequest = ((url: URL, options: any, callback: (response: any) => void) => {
    calls++;
    assert.equal(url.hostname, "models.example.com");
    assert.equal(options.agent, false);
    assert.notEqual(options.rejectUnauthorized, false);
    options.lookup("models.example.com", {}, (error: unknown, address: string, family: number) => {
      assert.equal(error, null); assert.equal(address, "8.8.8.8"); assert.equal(family, 4);
    });
    const req = new EventEmitter() as any;
    req.end = () => { const response = Readable.from([]) as any; response.statusCode = 302; response.headers = { location: "https://127.0.0.1/" }; callback(response); };
    return req;
  }) as unknown as typeof RequestFunction;
  const transport = pinnedModelFetch(endpoint, { address: "8.8.8.8", family: 4 }, fakeRequest);
  assert.equal((await transport(endpoint, { method: "POST", body: "{}" })).status, 302);
  await assert.rejects(transport("https://another.example.com/v1/chat/completions", { method: "POST", body: "{}" }), /DESTINATION_CHANGED/);
  assert.equal(calls, 1);
});

test("Anthropic Messages uses native auth/body and maps text and cache usage into validated reports", async () => {
  const client = createCustomModelProvider(parseCustomConnection({ ...config, apiFormat: "anthropic-messages" }), "test-key", async (url, init) => {
    assert.equal(String(url), "https://models.example.com/v1/messages");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("x-api-key"), "test-key");
    assert.equal(headers.get("authorization"), null);
    assert.equal(headers.get("anthropic-version"), "2023-06-01");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "my-model-v1"); assert.equal(body.max_tokens, 2500);
    assert.ok(body.system.includes("Repository") || body.system.includes("repository"));
    assert.equal(body.messages.length, 1); assert.equal(body.messages[0].role, "user");
    assert.equal(body.response_format, undefined); assert.equal(body.stream, false);
    assert.doesNotMatch(String(init?.body), /test-key/);
    return Response.json({ model: "my-model-v1", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(brief) }], usage: { input_tokens: 20, cache_creation_input_tokens: 10, cache_read_input_tokens: 5, output_tokens: 50 } });
  });
  const result = await client.generateStructured(request);
  assert.deepEqual(result.value, brief); assert.equal(result.provider, "custom-anthropic-messages");
  assert.equal(result.usage.inputTokens, 35); assert.equal(result.usage.cacheHitInputTokens, 5); assert.equal(result.usage.cacheMissInputTokens, 30);
});

for (const reason of ["max_tokens", "tool_use", "refusal", "pause_turn"]) {
  test(`Anthropic ${reason} is not accepted as a complete report and never retries`, async () => {
    let calls = 0;
    const client = createCustomModelProvider(parseCustomConnection({ ...config, apiFormat: "anthropic-messages" }), "test-key", async () => {
      calls++;
      return Response.json({ stop_reason: reason, content: [{ type: "text", text: JSON.stringify(brief) }], usage: { input_tokens: 10, output_tokens: 20 } });
    });
    await assert.rejects(client.generateStructured(request), error => error instanceof OpenAICompatibleProviderError && error.code === (reason === "max_tokens" ? "TRUNCATED_OUTPUT" : "INVALID_RESPONSE"));
    assert.equal(calls, 1);
  });
}

test("custom OpenAI compatibility parameters are user-selectable without vendor guessing", async () => {
  const client = createCustomModelProvider(parseCustomConnection({ ...config, tokenParameter: "max_completion_tokens", jsonMode: false }), "test-key", async (_, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.max_completion_tokens, 2500); assert.equal(body.max_tokens, undefined); assert.equal(body.response_format, undefined);
    assert.equal(body.thinking, undefined); assert.equal(body.enable_thinking, undefined);
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(brief) } }], usage: { prompt_tokens: 10, completion_tokens: 20 } });
  });
  assert.deepEqual((await client.generateStructured(request)).value, brief);
});
