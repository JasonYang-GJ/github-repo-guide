import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { DeterministicModelProvider } from "../src/model/deterministic-provider.js";
import { WEB_MODEL_PROFILES, type WebModelProvider } from "../src/model/web-profiles.js";
import { OpenAICompatibleProviderError } from "../src/model/openai-compatible-provider.js";
import type {
  ModelProvider,
  ModelResult,
  StructuredGenerationRequest,
} from "../src/model/provider.js";
import type {
  RepositoryBlob,
  RepositorySource,
  RepositoryTree,
  ResolvedRepository,
  TreeEntry,
} from "../src/repo/contracts.js";
import { GitHubApiError } from "../src/repo/github-source.js";
import { createWebServer, type WebServerOptions } from "../src/web/server.js";
import { FixtureRepositorySource } from "./support/fixture-repository-source.js";

const root = process.cwd();
const assetRoot = resolve(root, "web");
const schemaDirectory = resolve(root, "schemas");
const fixtureRoot = resolve(root, "tests", "fixtures", "small-typescript-repo");
const nestedDesktopNotesRoot = resolve(root, "tests", "fixtures", "nested-desktop-notes");
const manifestlessPythonRoot = resolve(
  root,
  "tests",
  "fixtures",
  "manifestless-python-repo",
);
const genericPolyglotRoot = resolve(
  root,
  "tests",
  "fixtures",
  "generic-polyglot-repo",
);
const sourceOnlyRustRoot = resolve(
  root,
  "tests",
  "fixtures",
  "source-only-rust-repo",
);
const ambiguousMonorepoRoot = resolve(
  root,
  "tests",
  "fixtures",
  "ambiguous-monorepo",
);

async function withServer(
  options: WebServerOptions,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = createWebServer({ assetRoot, schemaDirectory, ...options });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolveClose, rejectClose) => {
      server.close((error) => (error === undefined ? resolveClose() : rejectClose(error)));
    });
  }
}

function analysisRequest(
  url: string,
  repositoryUrl: string,
  extra: Readonly<Record<string, unknown>> = {},
): Promise<Response> {
  return fetch(`${url}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: repositoryUrl, ...extra }),
  });
}

for (const provider of Object.keys(WEB_MODEL_PROFILES) as WebModelProvider[]) {
  test(`Web ${provider} completes real adapter-to-report flow with a mocked two-stage transport`, async () => {
    const source = new FixtureRepositorySource(fixtureRoot, "small-typescript-repo");
    const outputRoot = await mkdtemp(join(tmpdir(), "repo-provider-wire-"));
    const stages: string[] = [];
    const modelFetch: typeof fetch = async (url, init) => {
      assert.equal(String(url), `${WEB_MODEL_PROFILES[provider].baseUrl}/chat/completions`);
      const body = JSON.parse(String(init?.body));
      const isBrief = body.messages[1].content.includes("Prompt stage: brief\n");
      stages.push(isBrief ? "brief" : "angles");
      const value = isBrief
        ? { oneSentence: "A greeting library.", summary: "A small TypeScript library for developers to reuse greeting functions.", problem: "", targetUsers: ["developers"], moduleInterpretations: [] }
        : { title: "Read the greeting entry point", hook: "Inspect the documented greeting function.", whyInteresting: "Follow the evidence before reusing the code.", candidates: [] };
      return Response.json({ model: body.model, choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(value) } }], usage: { prompt_tokens: 100, completion_tokens: 50 } });
    };
    await withServer({ source, outputRoot, modelFetch, deepseekFetch: modelFetch }, async baseUrl => {
      const response = await analysisRequest(baseUrl, source.url, { provider, apiKey: "test-wire-key", paidModelConsent: true });
      const data = await response.json();
      assert.equal(response.status, 200, JSON.stringify(data.error));
      assert.equal(data.analysis.provider, `${provider}-api`);
      assert.equal(data.analysis.model, WEB_MODEL_PROFILES[provider].model);
      assert.equal(data.analysis.paid, true);
      assert.equal(data.analysis.fallback, null);
      assert.deepEqual(stages, ["brief", "angles"]);
      assert.equal(data.analysis.input_tokens, 200);
      assert.match(data.project_guide.model_interpretation.summary, /greeting functions/);
    });
  });

  test(`Web ${provider} isolates environment/request keys, model and consent`, async () => {
    const profile = WEB_MODEL_PROFILES[provider];
    const source = new FixtureRepositorySource(fixtureRoot, "small-typescript-repo");
    const outputRoot = await mkdtemp(join(tmpdir(), "repo-multi-provider-"));
    const environment = Object.fromEntries(Object.values(WEB_MODEL_PROFILES).map(p => [p.env, `test-env-${p.env}`]));
    const captured: unknown[][] = [];
    const paid = new PaidFixtureProvider(`${provider}-api`);
    await withServer({ source, outputRoot, environment, allowEnvironmentCredentials: true,
      modelProviderFactory: (id, key, model) => { captured.push([id, key, model]); return paid; },
    }, async baseUrl => {
      const consent = await analysisRequest(baseUrl, source.url, { provider });
      assert.equal(consent.status, 400);
      assert.equal((await consent.json()).error.code, "PAID_MODEL_CONSENT_REQUIRED");
      for (const extra of [{ model: "https://untrusted.example" }, { baseUrl: "https://untrusted.example" }, { apiKey: "test-common", deepseekApiKey: "test-legacy" }]) {
        assert.equal((await analysisRequest(baseUrl, source.url, { provider, paidModelConsent: true, ...extra })).status, 400);
      }
      assert.equal(captured.length, 0);
      for (const useRequestKey of [false, true]) {
        const response = await analysisRequest(baseUrl, source.url, { provider, paidModelConsent: true, model: "test-model", ...(useRequestKey ? { apiKey: "test-request-key" } : {}) });
        const data = await response.json();
        assert.equal(response.status, 200, JSON.stringify(data.error));
        assert.equal(data.analysis.provider, `${provider}-api`);
        assert.deepEqual(captured.at(-1), [provider, useRequestKey ? "test-request-key" : `test-env-${profile.env}`, "test-model"]);
        assert.ok(paid.requests.every(r => r.maxOutputTokens === 2500));
        assert.doesNotMatch(JSON.stringify(data), /test-request-key|test-env-/);
        for (const artifact of data.artifacts.downloads) {
          const text = await (await fetch(`${baseUrl}${artifact.url}`)).text();
          assert.doesNotMatch(text, /test-request-key|test-env-/);
        }
      }
    });
  });

  test(`Web ${provider} returns free fallback with the actual failed provider and no retry`, async () => {
    const source = new FixtureRepositorySource(fixtureRoot, "small-typescript-repo");
    const outputRoot = await mkdtemp(join(tmpdir(), "repo-multi-fallback-"));
    let calls = 0;
    const failingFetch: typeof fetch = async () => { calls++; return new Response("not logged", { status: 503 }); };
    await withServer({ source, outputRoot, modelFetch: failingFetch, deepseekFetch: failingFetch }, async baseUrl => {
      const response = await analysisRequest(baseUrl, source.url, { provider, apiKey: "test-fallback-key", paidModelConsent: true });
      const data = await response.json();
      assert.equal(response.status, 200, JSON.stringify(data.error));
      assert.equal(data.analysis.fallback.from_provider, `${provider}-api`);
      assert.equal(data.analysis.fallback.to_provider, "deterministic-v1");
      assert.equal(data.analysis.fallback.network_calls, 1);
      assert.equal(calls, 1);
      assert.doesNotMatch(JSON.stringify(data), /test-fallback-key/);
    });
  });
}

test("free mode ignores all model credentials and never creates a paid provider", async () => {
  const source = new FixtureRepositorySource(fixtureRoot, "small-typescript-repo");
  await withServer({ source, outputRoot: await mkdtemp(join(tmpdir(), "repo-free-keys-")), environment: { OPENAI_API_KEY: "test-env-secret" }, allowEnvironmentCredentials: true,
    modelProviderFactory: (id, key, model) => { assert.equal(id, "deterministic"); assert.equal(key, undefined); assert.equal(model, undefined); return new DeterministicModelProvider(); },
    modelFetch: async () => { assert.fail("free mode must not call a model"); },
  }, async baseUrl => {
    assert.equal((await analysisRequest(baseUrl, source.url, { provider: "deterministic", apiKey: "test-stale", deepseekApiKey: "test-stale", model: "stale" })).status, 200);
  });
});

const customConnection = { name: "Unlisted service", baseUrl: "https://models.example.com/v1", apiFormat: "openai-chat", model: "my-model" };
for (const apiFormat of ["openai-chat", "anthropic-messages"]) {
  test(`custom ${apiFormat} completes report with its approved host and isolates the key`, async () => {
    const source = new FixtureRepositorySource(fixtureRoot, "small-typescript-repo");
    const outputRoot = await mkdtemp(join(tmpdir(), "repo-custom-wire-"));
    let calls = 0;
    let lookups = 0;
    await withServer({ source, outputRoot,
      modelHostResolver: async host => { lookups++; assert.equal(host, "models.example.com"); return [{ address: "8.8.8.8", family: 4 }]; },
      customModelFetch: async (url, init) => {
        calls++;
        assert.equal(String(url), `https://models.example.com/v1/${apiFormat === "openai-chat" ? "chat/completions" : "messages"}`);
        const headers = new Headers(init?.headers);
        assert.equal(headers.get(apiFormat === "openai-chat" ? "authorization" : "x-api-key"), apiFormat === "openai-chat" ? "Bearer test-custom-only" : "test-custom-only");
        assert.doesNotMatch(String(init?.body), /test-custom-only|test-environment/);
        const value = calls === 1
          ? { oneSentence: "A greeting library.", summary: "A library providing reusable greetings.", problem: "", targetUsers: [], moduleInterpretations: [] }
          : { title: "Follow the greeting function", hook: "Read the source evidence.", whyInteresting: "Inspect the entry point.", candidates: [] };
        return Response.json(apiFormat === "openai-chat"
          ? { model: "my-model", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 10, completion_tokens: 20 } }
          : { model: "my-model", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(value) }], usage: { input_tokens: 10, output_tokens: 20 } });
      },
      environment: { OPENAI_API_KEY: "test-environment", DEEPSEEK_API_KEY: "test-environment" }, allowEnvironmentCredentials: true,
    }, async baseUrl => {
      const response = await analysisRequest(baseUrl, source.url, { provider: "custom", customProvider: { ...customConnection, apiFormat }, apiKey: "test-custom-only", paidModelConsent: true });
      const data = await response.json();
      assert.equal(response.status, 200, JSON.stringify(data.error));
      assert.equal(data.analysis.provider, `custom-${apiFormat}`); assert.equal(data.analysis.fallback, null);
      assert.equal(calls, 2); assert.equal(lookups, 1);
      for (const artifact of data.artifacts.downloads) assert.doesNotMatch(await (await fetch(`${baseUrl}${artifact.url}`)).text(), /test-custom-only|test-environment/);
    });
  });

  test(`custom ${apiFormat} falls back on model error without retry`, async () => {
    const source = new FixtureRepositorySource(fixtureRoot, "small-typescript-repo");
    let calls = 0;
    await withServer({ source, outputRoot: await mkdtemp(join(tmpdir(), "repo-custom-fallback-")),
      modelHostResolver: async () => [{ address: "8.8.8.8", family: 4 }],
      customModelFetch: async () => { calls++; return new Response("test-secret-must-not-echo", { status: 401 }); },
    }, async baseUrl => {
      const response = await analysisRequest(baseUrl, source.url, { provider: "custom", customProvider: { ...customConnection, apiFormat }, apiKey: "test-custom-only", paidModelConsent: true });
      const data = await response.json();
      assert.equal(response.status, 200); assert.equal(calls, 1);
      assert.equal(data.analysis.fallback.from_provider, `custom-${apiFormat}`);
      assert.doesNotMatch(JSON.stringify(data), /test-secret-must-not-echo|test-custom-only/);
    });
  });
}

test("custom connection configuration checks do not send keys, resolve DNS or perform inference", async () => {
  await withServer({ modelHostResolver: async () => assert.fail("no DNS in configuration checks"), customModelFetch: async () => assert.fail("no external request") }, async baseUrl => {
    const check = (extra: object) => fetch(`${baseUrl}/api/connections/test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "custom", configuration: customConnection, ...extra }) });
    const result = await check({}); assert.equal(result.status, 200);
    assert.equal((await result.json()).authentication_verified, false);
    assert.equal((await check({ credential: "test-secret" })).status, 400);
    assert.equal((await check({ configuration: { ...customConnection, baseUrl: "https://localhost/v1" } })).status, 400);
  });
});

test("custom endpoint consent and key are required before DNS; environment cannot fund arbitrary endpoints", async () => {
  await withServer({ allowEnvironmentCredentials: true, environment: { OPENAI_API_KEY: "test-env" }, modelHostResolver: async () => assert.fail("no DNS before consent/key validation") }, async baseUrl => {
    for (const extra of [{}, { paidModelConsent: true }, { apiKey: "test-key" }]) {
      const response = await analysisRequest(baseUrl, "https://github.com/example/repo", { provider: "custom", customProvider: customConnection, ...extra });
      assert.equal(response.status, 400);
    }
  });
});

test("custom DNS rebinding/private answers are rejected before repository or model access", async () => {
  await withServer({ modelHostResolver: async () => [{ address: "127.0.0.1", family: 4 }], customModelFetch: async () => assert.fail("must not send key"), githubFetch: async () => assert.fail("must not fetch repository") }, async baseUrl => {
    const response = await analysisRequest(baseUrl, "https://github.com/example/repo", { provider: "custom", customProvider: customConnection, apiKey: "test-key", paidModelConsent: true });
    assert.equal(response.status, 422); assert.equal((await response.json()).error.code, "MODEL_ENDPOINT_BLOCKED");
    // Failure releases the per-server analysis lock.
    const second = await analysisRequest(baseUrl, "https://github.com/example/repo", { provider: "custom", customProvider: customConnection, paidModelConsent: true });
    assert.equal(second.status, 400);
  });
});

test("model checks distinguish local configuration from authentication without inference", async () => {
  const calls: string[] = [];
  await withServer({ modelFetch: async (url, init) => {
    calls.push(String(url));
    assert.equal(String(url), "https://api.openai.com/v1/models/gpt-4.1-mini");
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-openai");
    return Response.json({ id: "gpt-4.1-mini" });
  } }, async baseUrl => {
    for (const kind of ["zhipu", "qwen", "qwen-intl", "openai"]) {
      const response = await fetch(`${baseUrl}/api/connections/test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, credential: `test-${kind}` }) });
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.inference_calls, 0);
      assert.equal(data.status, kind === "openai" ? "PASS" : "CONFIGURATION_ONLY");
      assert.equal(data.authentication_verified, kind === "openai");
    }
    assert.equal(calls.length, 1);
  });
});

test("foreign or disabled environment keys cannot pay for another selected provider", async () => {
  for (const allowEnvironmentCredentials of [false, true]) {
    await withServer({ environment: { DEEPSEEK_API_KEY: "test-deepseek-only", DASHSCOPE_API_KEY: "test-beijing-only" }, allowEnvironmentCredentials }, async baseUrl => {
      for (const provider of ["openai", "qwen-intl"]) {
        const response = await analysisRequest(baseUrl, "https://github.com/example/repo", { provider, paidModelConsent: true });
        assert.equal(response.status, 400);
        assert.equal((await response.json()).error.code, "MODEL_API_KEY_REQUIRED");
      }
    });
  }
});

test("OpenAI test failures are safe and do not claim a valid key", async () => {
  for (const status of [401, 404, 429, 500]) {
    await withServer({ modelFetch: async () => new Response("test-echo-secret", { status }) }, async baseUrl => {
      const response = await fetch(`${baseUrl}/api/connections/test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "openai", credential: "test-echo-secret" }) });
      assert.equal(response.status, 400);
      assert.doesNotMatch(await response.text(), /test-echo-secret/);
    });
  }
});

test("web health and static shell expose the V0.2 credential boundary", async () => {
  await withServer({}, async (baseUrl) => {
    const health = await fetch(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);
    assert.match(health.headers.get("content-security-policy") ?? "", /default-src 'self'/);
    assert.deepEqual(await health.json(), {
      status: "ok",
      preview_version: "0.2.0",
      default_provider: "deterministic-v1",
      providers: [
        { id: "deterministic", paid: false, credential_required: false },
        ...Object.entries(WEB_MODEL_PROFILES).map(([id, profile]) => ({
          id,
          label: profile.label,
          default_model: profile.model,
          endpoint: profile.baseUrl,
          environment_variable: profile.env,
          connection_check: profile.check,
          docs: profile.docs,
          paid: true,
          credential_required: true,
          environment_credential_available: false,
        })),
      ],
      github: {
        anonymous_supported: true,
        environment_credential_available: false,
      },
      credential_storage: "request_only",
      target_repository_execution: false,
    });

    const page = await fetch(baseUrl);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /了解一个项目/);
    assert.match(await (await fetch(baseUrl)).text(), /匿名访问（无需 Token）/);
    assert.match(await (await fetch(baseUrl)).text(), /id="provider-dialog"/);
    assert.match(await (await fetch(baseUrl)).text(), /Anthropic Messages/);
    assert.doesNotMatch(await (await fetch(baseUrl)).text(), /option value="deepseek"|option value="qwen"/);
    assert.match(await (await fetch(baseUrl)).text(), /id="language-switch"/);
    assert.match(await (await fetch(baseUrl)).text(), /data-locale="en"/);
    assert.match(await (await fetch(baseUrl)).text(), /id="generic-mode-notice"/);
    assert.match(await (await fetch(baseUrl)).text(), /id="guide-features"/);
    assert.doesNotMatch(await (await fetch(baseUrl)).text(), /script-card|copy-script|口播稿/);

    const script = await fetch(`${baseUrl}/app.js`);
    const scriptText = await script.text();
    assert.equal(script.status, 200);
    assert.equal(scriptText.includes("innerHTML"), false);
    assert.match(scriptText, /textContent/);
  });
});

test("English analysis mode localizes the generated view and report without another request", async () => {
  const source = new FixtureRepositorySource(fixtureRoot, "small-typescript-repo");
  const outputRoot = await mkdtemp(join(tmpdir(), "repo-artifact-web-en-"));
  const provider = new PaidFixtureProvider();
  await withServer(
    {
      source,
      outputRoot,
      generatedAt: "2026-09-16T00:00:00.000Z",
      networkHosts: [],
      modelProviderFactory: () => provider,
    },
    async (baseUrl) => {
      const response = await analysisRequest(baseUrl, source.url, {
        locale: "en",
        provider: "deepseek",
        deepseekApiKey: "test-english-mode-secret",
        paidModelConsent: true,
      });
      assert.equal(response.status, 200);
      const result = (await response.json()) as {
        readonly locale: string;
        readonly overview: { readonly summary: string };
        readonly modules: readonly {
          readonly responsibility: string;
          readonly short_name: string;
        }[];
        readonly relationships: readonly {
          readonly from_module_id: string;
          readonly to_module_id: string;
          readonly relationship_type: string;
        }[];
        readonly relationship_summary: {
          readonly cross_module: number;
          readonly internal_calls: number;
        };
        readonly script?: unknown;
        readonly artifacts: {
          readonly downloads: readonly { readonly name: string; readonly url: string }[];
        };
      };
      assert.equal(result.locale, "en");
      assert.match(result.overview.summary, /This code-level analysis covers/);
      assert.doesNotMatch(result.overview.summary, /代码范围|前端 TypeScript 子包/);
      assert.ok(result.modules.every((module) => module.short_name.length > 0));
      assert.ok(result.relationships.length > 0);
      assert.ok(
        result.relationships.every(
          (relationship) =>
            relationship.from_module_id !== relationship.to_module_id,
        ),
      );
      assert.equal(result.relationships[0]?.relationship_type, "imports");
      assert.ok(result.relationship_summary.cross_module >= result.relationships.length);
      assert.ok(result.relationship_summary.internal_calls >= 0);
      assert.equal(result.script, undefined);

      const reportLink = result.artifacts.downloads.find((item) => item.name === "report.md");
      assert.ok(reportLink !== undefined);
      const report = await (await fetch(`${baseUrl}${reportLink.url}`)).text();
      assert.match(report, /## Project overview/);
      assert.match(report, /## Architecture relationships/);
      assert.doesNotMatch(report, /## Optional spoken explainer/);
      assert.match(report, /### Getting started/);
      assert.doesNotMatch(report, /代码范围|前端 TypeScript 子包/);
      assert.doesNotMatch(report, /## 中文口播稿/);
    },
  );
});

test("analysis locale is a closed Chinese or English choice", async () => {
  const source = new FixtureRepositorySource(fixtureRoot, "small-typescript-repo");
  await withServer({ source, networkHosts: [] }, async (baseUrl) => {
    const response = await analysisRequest(baseUrl, source.url, { locale: "fr" });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_REQUEST");
  });
});

test("README-only repositories produce a report without fabricated code modules", async () => {
  class DocumentationOnlySource extends FixtureRepositorySource {
    override async listTree(repository: ResolvedRepository): Promise<RepositoryTree> {
      const tree = await super.listTree(repository);
      return { ...tree, entries: tree.entries.filter(entry => entry.path === "README.md") };
    }
  }
  const source = new DocumentationOnlySource(fixtureRoot, "readme-only");
  const outputRoot = await mkdtemp(join(tmpdir(), "repo-docs-only-"));
  await withServer({ source, outputRoot, networkHosts: [] }, async baseUrl => {
    const response = await analysisRequest(baseUrl, source.url);
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(result.status, "PASS");
    assert.equal(result.modules.length, 0);
    assert.equal(result.relationships.length, 0);
    assert.match(result.project_guide.summary, /greeting function/);
  });
});

test("long README introductions fit report fields in free, smart and fallback modes", async () => {
  for (const locale of ["zh-CN", "en"] as const) {
    for (const length of [501, 3000]) {
      for (const mode of ["free", "smart", "fallback"] as const) {
        const text = `# Documentation model\n\n${"Background context. ".repeat(length === 3000 ? 150 : 1)}\n\nThis is a model release with documented usage. ${"详细说明😀 ".repeat(length)}\n`;
        const bytes = Buffer.from(text);
        const blobSha = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
        class LongDocumentationSource extends FixtureRepositorySource {
          override async listTree(): Promise<RepositoryTree> {
            return { truncated: false, entries: [{ path: "README.md", type: "blob", size: bytes.length, blobSha }] };
          }
          override async readBlob(): Promise<RepositoryBlob> { return { bytes }; }
        }
        const source = new LongDocumentationSource(fixtureRoot, "long-docs");
        const outputRoot = await mkdtemp(join(tmpdir(), "repo-long-docs-"));
        const provider = mode === "fallback" ? new TruncatedPaidFixtureProvider() : new PaidFixtureProvider();
        await withServer({ source, outputRoot, networkHosts: [], modelProviderFactory: () => provider }, async baseUrl => {
          const response = await analysisRequest(baseUrl, source.url, {
            locale, ...(mode === "free" ? {} : { provider: "deepseek", deepseekApiKey: "test-long-docs", paidModelConsent: true }),
          });
          const result = await response.json();
          assert.equal(response.status, 200, `${locale}/${length}/${mode}: ${JSON.stringify(result)}`);
          assert.equal(result.modules.length, 0);
          assert.ok(Array.from(result.overview.one_sentence).length <= 500);
          assert.ok(Array.from(result.overview.summary).length <= 4000);
          assert.ok(Array.from(result.overview.problem).length <= 2000);
          assert.match(result.overview.one_sentence, /…$/);
          assert.match(result.project_guide.summary, /This is a model/);
          const reportLink = result.artifacts.downloads.find((item: {name:string}) => item.name === "report.md");
          assert.equal((await fetch(`${baseUrl}${reportLink.url}`)).status, 200);
          if (mode === "fallback") assert.equal(result.analysis.fallback.used, true);
        });
      }
    }
  }
});

test("host validation failures are diagnosed before paid requests and remain fail-closed", async () => {
  const source = new FixtureRepositorySource(fixtureRoot, "small-typescript-repo");
  const provider = new PaidFixtureProvider();
  const outputRoot = await mkdtemp(join(tmpdir(), "repo-preflight-failure-"));
  await withServer({ source, outputRoot, generatedAt: "invalid-host-date", networkHosts: [], modelProviderFactory: () => provider }, async baseUrl => {
    const response = await analysisRequest(baseUrl, source.url, { provider: "deepseek", deepseekApiKey: "test-no-charge-secret", paidModelConsent: true });
    const result = await response.json();
    assert.equal(response.status, 422);
    assert.equal(result.error.code, "REPORT_VALIDATION_FAILED");
    assert.match(result.error.message, /数据格式/);
    assert.match(result.error.message, /无需反复付费重试/);
    assert.doesNotMatch(JSON.stringify(result), /test-no-charge-secret|invalid-host-date/);
    assert.deepEqual(provider.attemptedStages, []);
  });
});

test("a public repository without package.json still produces a bounded base report", async () => {
  const source = new FixtureRepositorySource(
    manifestlessPythonRoot,
    "manifestless-python-repo",
  );
  const outputRoot = await mkdtemp(join(tmpdir(), "repo-artifact-web-generic-"));
  await withServer(
    { source, outputRoot, generatedAt: "2026-09-16T00:00:00.000Z", networkHosts: [] },
    async (baseUrl) => {
      const response = await analysisRequest(baseUrl, source.url, { locale: "en" });
      assert.equal(response.status, 200);
      const result = (await response.json()) as {
        readonly status: string;
        readonly repository: { readonly name: string };
        readonly analysis: {
          readonly repository_mode: string;
          readonly files_read: number;
          readonly repository_code_executions: number;
        };
        readonly artifacts: {
          readonly downloads: readonly { readonly name: string; readonly url: string }[];
        };
      };
      assert.equal(result.status, "PASS");
      assert.equal(result.repository.name, "Manifestless Project");
      assert.equal(result.analysis.repository_mode, "generic_text");
      assert.ok(result.analysis.files_read >= 1);
      assert.equal(result.analysis.repository_code_executions, 0);
      assert.ok(result.artifacts.downloads.some((item) => item.name === "report.md"));
    },
  );
});

test("generic mode reads common non-npm text sources without parsing them as TypeScript", async () => {
  const source = new FixtureRepositorySource(genericPolyglotRoot, "generic-polyglot-repo");
  await withServer(
    { source, generatedAt: "2026-09-16T00:00:00.000Z", networkHosts: [] },
    async (baseUrl) => {
      const response = await analysisRequest(baseUrl, source.url, { locale: "zh-CN" });
      assert.equal(response.status, 200);
      const result = (await response.json()) as {
        readonly status: string;
        readonly analysis: {
          readonly repository_mode: string;
          readonly files_read: number;
        };
        readonly modules: readonly {
          readonly name: string;
          readonly responsibility: string;
        }[];
        readonly relationships: readonly unknown[];
        readonly limitations: readonly {
          readonly description: string;
          readonly impact: string;
        }[];
        readonly unknowns: readonly { readonly question: string }[];
      };
      assert.equal(result.status, "PASS");
      assert.equal(result.analysis.repository_mode, "generic_text");
      assert.ok(result.analysis.files_read >= 6);
      assert.deepEqual(
        result.modules.map((module) => module.name).sort(),
        ["src/lib.rs", "src/main.go", "src/main.py", "src/worker.py", "web/index.html"],
      );
      assert.ok(
        result.modules.every((module) =>
          module.responsibility.startsWith("包含选中的源码文件"),
        ),
      );
      assert.equal(result.relationships.length, 0);
      assert.match(
        result.limitations.map((item) => `${item.description} ${item.impact}`).join(" "),
        /通用文本分析.*非 JavaScript\/TypeScript/,
      );
      assert.deepEqual(
        result.unknowns.map((item) => item.question),
        ["这个仓库里的软件实际运行时会发生什么？", "这个项目运行时会使用哪些外部服务？"],
      );
    },
  );
});

for (const scenario of [
  {
    name: "source-only repository",
    root: sourceOnlyRustRoot,
    fixtureName: "source-only-rust-repo",
    expectedModule: "src/main.rs",
  },
  {
    name: "repository with multiple equally shallow npm packages",
    root: ambiguousMonorepoRoot,
    fixtureName: "ambiguous-monorepo",
    expectedModule: "apps/one/src/index.ts",
  },
] as const) {
  test(`${scenario.name} falls back to a normal bounded generic report`, async () => {
    const source = new FixtureRepositorySource(scenario.root, scenario.fixtureName);
    await withServer({ source, networkHosts: [] }, async (baseUrl) => {
      const response = await analysisRequest(baseUrl, source.url, { locale: "en" });
      assert.equal(response.status, 200);
      const result = (await response.json()) as {
        readonly status: string;
        readonly modules: readonly { readonly name: string }[];
        readonly analysis: { readonly repository_code_executions: number };
      };
      assert.equal(result.status, "PASS");
      assert.ok(result.modules.some((module) => module.name === scenario.expectedModule));
      assert.equal(result.analysis.repository_code_executions, 0);
    });
  });
}

test("fixture-backed web analysis returns a readable view and downloadable artifacts", async () => {
  const source = new FixtureRepositorySource(fixtureRoot, "small-typescript-repo");
  const outputRoot = await mkdtemp(join(tmpdir(), "repo-artifact-web-"));
  await withServer(
    {
      source,
      outputRoot,
      generatedAt: "2026-09-15T00:00:00.000Z",
      networkHosts: [],
    },
    async (baseUrl) => {
      const response = await analysisRequest(baseUrl, source.url);
      assert.equal(response.status, 200);
      const result = (await response.json()) as {
        readonly status: string;
        readonly repository: { readonly commit_sha: string };
        readonly analysis: {
          readonly provider: string;
          readonly repository_code_executions: number;
        };
        readonly evidence_total: number;
        readonly artifacts: {
          readonly directory: string;
          readonly downloads: readonly { readonly name: string; readonly url: string }[];
        };
      };
      assert.equal(result.status, "PASS");
      assert.equal(result.repository.commit_sha, source.commitSha);
      assert.equal(result.analysis.provider, "deterministic-v1");
      assert.equal(result.analysis.repository_code_executions, 0);
      assert.ok(result.evidence_total > 0);
      assert.equal(result.artifacts.downloads.length, 7);

      const reportLink = result.artifacts.downloads.find((item) => item.name === "report.md");
      assert.ok(reportLink !== undefined);
      const report = await fetch(`${baseUrl}${reportLink.url}`);
      assert.equal(report.status, 200);
      assert.match(report.headers.get("content-disposition") ?? "", /report\.md/);
      assert.match(await report.text(), /## 证据/);
    },
  );
});

test("web view presents nested desktop application identity and explanations in Chinese", async () => {
  const source = new FixtureRepositorySource(nestedDesktopNotesRoot, "nested-desktop-notes");
  const outputRoot = await mkdtemp(join(tmpdir(), "repo-artifact-web-zh-"));
  await withServer(
    {
      source,
      outputRoot,
      generatedAt: "2026-09-16T00:00:00.000Z",
      networkHosts: [],
    },
    async (baseUrl) => {
      const response = await analysisRequest(baseUrl, source.url);
      assert.equal(response.status, 200);
      const result = (await response.json()) as {
        readonly repository: { readonly name: string };
        readonly overview: { readonly one_sentence: string; readonly summary: string };
        readonly modules: readonly { readonly name: string; readonly responsibility: string }[];
        readonly relationships: readonly { readonly relationship_type: string }[];
        readonly evidence: readonly { readonly claim: string; readonly status: string }[];
        readonly script?: unknown;
        readonly artifacts: {
          readonly downloads: readonly { readonly name: string; readonly url: string }[];
        };
      };

      assert.equal(result.repository.name, "桌面笔记 Desktop Notes");
      assert.match(result.overview.one_sentence, /本地优先日历笔记应用/);
      assert.match(result.overview.summary, /前端 TypeScript 子包/);
      assert.equal(result.modules.some((module) => /\.(?:test|spec)\./i.test(module.name)), false);
      assert.ok(result.modules.every((module) => /[\u3400-\u9fff]/.test(module.responsibility)));
      assert.ok(
        result.relationships.every((relationship) =>
          ["导入", "调用"].includes(relationship.relationship_type),
        ),
      );
      assert.ok(result.evidence.every((record) => /[\u3400-\u9fff]/.test(record.claim)));
      assert.ok(result.evidence.every((record) => /[\u3400-\u9fff]/.test(record.status)));
      assert.equal(result.script, undefined);

      const reportLink = result.artifacts.downloads.find((item) => item.name === "report.md");
      assert.ok(reportLink !== undefined);
      const report = await (await fetch(`${baseUrl}${reportLink.url}`)).text();
      assert.match(report, /# 桌面笔记 Desktop Notes — 仓库分析报告/);
      assert.doesNotMatch(report, /## 可选口播稿/);
      assert.doesNotMatch(report, /Repository Analysis/);
    },
  );
});

test("web API rejects malformed, oversized and non-canonical requests before repository access", async () => {
  const source = new FixtureRepositorySource(fixtureRoot, "small-typescript-repo");
  await withServer({ source }, async (baseUrl) => {
    const malformed = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    assert.equal(malformed.status, 400);

    const invalidUrl = await analysisRequest(baseUrl, "https://example.com/owner/repo");
    assert.equal(invalidUrl.status, 400);
    assert.equal((await invalidUrl.json()).error.code, "REPOSITORY_URL_INVALID");

    const oversized = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: `https://github.com/owner/${"a".repeat(9_000)}` }),
    });
    assert.equal(oversized.status, 413);

    const invalidCredential = await analysisRequest(baseUrl, source.url, {
      githubToken: "token-with\nnewline",
    });
    assert.equal(invalidCredential.status, 400);
    assert.equal((await invalidCredential.json()).error.code, "CREDENTIAL_INVALID");

    const missingDeepSeekKey = await analysisRequest(baseUrl, source.url, {
      provider: "deepseek",
      paidModelConsent: true,
    });
    assert.equal(missingDeepSeekKey.status, 400);
    assert.equal((await missingDeepSeekKey.json()).error.code, "DEEPSEEK_API_KEY_REQUIRED");

    const invalidGitHubMode = await analysisRequest(baseUrl, source.url, {
      githubAuthMode: "unexpected",
    });
    assert.equal(invalidGitHubMode.status, 400);
    assert.equal((await invalidGitHubMode.json()).error.code, "INVALID_REQUEST");
    assert.equal(source.operations.length, 0);
  });
});

test("web API rejects cross-origin writes and unsupported routes or methods", async () => {
  await withServer({}, async (baseUrl) => {
    const crossOrigin = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://attacker.example" },
      body: JSON.stringify({ url: "https://github.com/owner/repo" }),
    });
    assert.equal(crossOrigin.status, 403);

    const wrongMethod = await fetch(`${baseUrl}/api/analyze`);
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get("allow"), "POST");

    const missing = await fetch(`${baseUrl}/does-not-exist`);
    assert.equal(missing.status, 404);
  });
});

test("connection checks use request credentials without echoing them or invoking a model", async () => {
  const githubSecret = "github_pat_web_test_secret";
  const deepseekSecret = "test-deepseek-request-secret";
  const authorizationHeaders: string[] = [];
  const githubFetch: typeof fetch = async (_input, init) => {
    authorizationHeaders.push(new Headers(init?.headers).get("authorization") ?? "");
    return new Response(
      JSON.stringify({
        resources: { core: { limit: 5_000, remaining: 4_999, reset: 1_800_000_000 } },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  const deepseekFetch: typeof fetch = async (_input, init) => {
    authorizationHeaders.push(new Headers(init?.headers).get("authorization") ?? "");
    return new Response(
      JSON.stringify({
        is_available: true,
        balance_infos: [{ currency: "CNY", total_balance: "9.50" }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  await withServer({ githubFetch, deepseekFetch }, async (baseUrl) => {
    const github = await fetch(`${baseUrl}/api/connections/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "github", credential: githubSecret }),
    });
    assert.equal(github.status, 200);
    const githubBody = await github.text();
    assert.equal(githubBody.includes(githubSecret), false);
    assert.match(githubBody, /"remaining":4999/);

    const deepseek = await fetch(`${baseUrl}/api/connections/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "deepseek", credential: deepseekSecret }),
    });
    assert.equal(deepseek.status, 200);
    const deepseekBody = await deepseek.text();
    assert.equal(deepseekBody.includes(deepseekSecret), false);
    assert.match(deepseekBody, /"inference_calls":0/);
  });

  assert.deepEqual(authorizationHeaders, [
    `Bearer ${githubSecret}`,
    `Bearer ${deepseekSecret}`,
  ]);
});

test("loopback mode can use configured environment credentials without exposing them", async () => {
  const githubSecret = "github_pat_environment_secret";
  const deepseekSecret = "test-deepseek-environment-secret";
  const headers: string[] = [];
  const githubFetch: typeof fetch = async (_input, init) => {
    headers.push(new Headers(init?.headers).get("authorization") ?? "");
    return new Response(
      JSON.stringify({ resources: { core: { limit: 5_000, remaining: 4_998, reset: 1_800_000_000 } } }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  const deepseekFetch: typeof fetch = async (_input, init) => {
    headers.push(new Headers(init?.headers).get("authorization") ?? "");
    return new Response(
      JSON.stringify({ is_available: true, balance_infos: [] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  await withServer(
    {
      allowEnvironmentCredentials: true,
      environment: { GITHUB_TOKEN: githubSecret, DEEPSEEK_API_KEY: deepseekSecret },
      githubFetch,
      deepseekFetch,
    },
    async (baseUrl) => {
      const healthText = await (await fetch(`${baseUrl}/api/health`)).text();
      assert.equal(healthText.includes(githubSecret), false);
      assert.equal(healthText.includes(deepseekSecret), false);
      const health = JSON.parse(healthText);
      assert.equal(health.github.environment_credential_available, true);
      assert.equal(
        health.providers.find((provider: { readonly id: string }) => provider.id === "deepseek")
          .environment_credential_available,
        true,
      );

      for (const kind of ["github", "deepseek"] as const) {
        const response = await fetch(`${baseUrl}/api/connections/test`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind }),
        });
        assert.equal(response.status, 200);
        const responseText = await response.text();
        assert.equal(responseText.includes(githubSecret), false);
        assert.equal(responseText.includes(deepseekSecret), false);
        assert.match(responseText, /"credential_source":"environment"/);
      }
    },
  );

  assert.deepEqual(headers, [`Bearer ${githubSecret}`, `Bearer ${deepseekSecret}`]);
});

test("explicit anonymous GitHub mode ignores stale request and environment tokens", async () => {
  const authorizationHeaders: string[] = [];
  const githubFetch: typeof fetch = async (_input, init) => {
    authorizationHeaders.push(new Headers(init?.headers).get("authorization") ?? "");
    return new Response(
      JSON.stringify({ resources: { core: { limit: 60, remaining: 59, reset: 1_800_000_000 } } }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  await withServer(
    {
      allowEnvironmentCredentials: true,
      environment: { GITHUB_TOKEN: "github_pat_environment_secret" },
      githubFetch,
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/connections/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "github",
          mode: "anonymous",
          credential: "stale-browser-autofill-token",
        }),
      });
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.authentication, "anonymous");
      assert.equal(payload.credential_source, "none");
      assert.equal(payload.remaining, 59);
    },
  );

  assert.deepEqual(authorizationHeaders, [""]);
});

class PaidFixtureProvider implements ModelProvider {
  constructor(readonly id = "deepseek-api") {}
  readonly attemptedStages: string[] = [];
  readonly requests: StructuredGenerationRequest[] = [];
  private readonly delegate = new DeterministicModelProvider();

  async generateStructured<T>(
    request: StructuredGenerationRequest,
  ): Promise<ModelResult<T>> {
    this.attemptedStages.push(request.stage);
    this.requests.push(request);
    const result = await this.delegate.generateStructured<T>(request);
    return {
      ...result,
      provider: this.id,
      model: "deepseek-flash-test-double",
      networkCalls: 1,
      paid: true,
      context: { ...result.context, endpoint: "remote_https" },
    };
  }
}

test("Web report provides a detailed guide without generating, writing or serving a spoken script", async () => {
  const source = new FixtureRepositorySource(fixtureRoot, "small-typescript-repo");
  const provider = new PaidFixtureProvider();
  const outputRoot = await mkdtemp(join(tmpdir(), "repo-guide-web-"));
  await withServer({ source, outputRoot, networkHosts: [], modelProviderFactory: () => provider }, async baseUrl => {
    const response = await analysisRequest(baseUrl, source.url, {
      provider: "deepseek", deepseekApiKey: "test-guide-secret", paidModelConsent: true,
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.repository.name, "Tiny Greeter");
    assert.match(result.project_guide.summary, /greeting function/);
    assert.ok(result.project_guide.model_interpretation.summary);
    assert.equal(result.script, undefined);
    assert.deepEqual(provider.attemptedStages, ["brief", "angles"]);
    const request = provider.requests[0]!;
    assert.match(request.systemInstructions, /400–700 Chinese characters/);
    assert.doesNotMatch(request.systemInstructions, /Keep each field short/);
    assert.equal(request.untrustedRepositoryContext[0]?.path, "README.md");
    assert.ok(request.untrustedRepositoryContext.every(chunk => chunk.trust === "untrusted_repository_data"));
    assert.ok(request.untrustedRepositoryContext.reduce((sum, chunk) => sum + chunk.content.length, 0) <= 36_000);
    const names = result.artifacts.downloads.map((item: { name: string }) => item.name);
    assert.ok(names.includes("project-guide.json"));
    assert.ok(!names.includes("script.json"));
    const guideLink = result.artifacts.downloads.find((item: { name: string }) => item.name === "project-guide.json");
    assert.deepEqual(await (await fetch(`${baseUrl}${guideLink.url}`)).json(), result.project_guide);
    assert.equal((await fetch(`${baseUrl}${guideLink.url.replace("project-guide.json", "script.json")}`)).status, 404);
    const reportLink = result.artifacts.downloads.find((item: { name: string }) => item.name === "report.md");
    const report = await (await fetch(`${baseUrl}${reportLink.url}`)).text();
    assert.match(report, /AI 详细解读/);
    assert.match(report, /需结合原文核对/);
    assert.doesNotMatch(report, /口播稿|spoken explainer/);
    // Inspect real artifact files, not only the public download allowlist.
    const walk = async (path: string): Promise<string[]> => {
      const entries = await readdir(path, { withFileTypes: true });
      return (await Promise.all(entries.map(entry => entry.isDirectory() ? walk(join(path, entry.name)) : [entry.name]))).flat();
    };
    const files = await walk(outputRoot);
    assert.ok(files.includes("project-guide.json"));
    assert.ok(!files.includes("script.json"));
  });
});

test("DeepSeek mode accepts a generic non-npm repository before model generation", async () => {
  const source = new FixtureRepositorySource(genericPolyglotRoot, "generic-polyglot-repo");
  const provider = new PaidFixtureProvider();
  await withServer(
    {
      source,
      networkHosts: ["api.deepseek.com"],
      modelProviderFactory: () => provider,
    },
    async (baseUrl) => {
      const response = await analysisRequest(baseUrl, source.url, {
        locale: "zh-CN",
        provider: "deepseek",
        deepseekApiKey: "test-generic-deepseek-secret",
        paidModelConsent: true,
      });
      assert.equal(response.status, 200);
      const result = (await response.json()) as {
        readonly status: string;
        readonly analysis: {
          readonly repository_mode: string;
          readonly provider: string;
        };
      };
      assert.equal(result.status, "PASS");
      assert.equal(result.analysis.repository_mode, "generic_text");
      assert.equal(result.analysis.provider, "deepseek-api");
      assert.deepEqual(provider.attemptedStages, ["brief", "angles"]);
    },
  );
});

class TruncatedPaidFixtureProvider implements ModelProvider {
  readonly id = "deepseek-api";
  readonly attemptedStages: string[] = [];
  private readonly delegate = new DeterministicModelProvider();

  async generateStructured<T>(
    request: StructuredGenerationRequest,
  ): Promise<ModelResult<T>> {
    this.attemptedStages.push(request.stage);
    if (request.stage === "angles") {
      throw new OpenAICompatibleProviderError(
        "TRUNCATED_OUTPUT",
        "Provider truncated stage angles at the configured output limit.",
        1,
        {
          stage: request.stage,
          provider: this.id,
          model: "deepseek-flash-test-double",
          finishReason: "length",
          requestConfiguration: { thinking: "enabled", reasoningEffort: "high" },
          reasoning: {
            tokens: 2_300,
            contentCharacters: 4_200,
            visibleContentTokens: 200,
          },
          usage: { inputTokens: 900, outputTokens: 2_500 },
          visibleContentCharacters: 320,
          networkCalls: 1,
          paid: true,
        },
      );
    }
    const result = await this.delegate.generateStructured<T>(request);
    return {
      ...result,
      provider: this.id,
      model: "deepseek-flash-test-double",
      usage: { inputTokens: 700, outputTokens: 500 },
      networkCalls: 1,
      paid: true,
      context: { ...result.context, endpoint: "remote_https" },
    };
  }
}

test("DeepSeek Web mode requires consent and keeps its request key out of results and artifacts", async () => {
  const source = new FixtureRepositorySource(fixtureRoot, "small-typescript-repo");
  const outputRoot = await mkdtemp(join(tmpdir(), "repo-artifact-web-deepseek-"));
  const secret = "test-deepseek-artifact-secret";
  let receivedSecret = "";

  await withServer(
    {
      source,
      outputRoot,
      generatedAt: "2026-09-15T00:00:00.000Z",
      networkHosts: ["api.deepseek.com"],
      modelProviderFactory: (provider, apiKey) => {
        assert.equal(provider, "deepseek");
        receivedSecret = apiKey ?? "";
        return new PaidFixtureProvider();
      },
    },
    async (baseUrl) => {
      const noConsent = await analysisRequest(baseUrl, source.url, {
        provider: "deepseek",
        deepseekApiKey: secret,
      });
      assert.equal(noConsent.status, 400);
      assert.equal((await noConsent.json()).error.code, "PAID_MODEL_CONSENT_REQUIRED");
      assert.equal(source.operations.length, 0);

      const response = await analysisRequest(baseUrl, source.url, {
        provider: "deepseek",
        deepseekApiKey: secret,
        paidModelConsent: true,
      });
      assert.equal(response.status, 200);
      const responseText = await response.text();
      assert.equal(responseText.includes(secret), false);
      const result = JSON.parse(responseText) as {
        readonly analysis: { readonly provider: string; readonly paid: boolean };
        readonly artifacts: { readonly downloads: readonly { readonly url: string }[] };
      };
      assert.equal(result.analysis.provider, "deepseek-api");
      assert.equal(result.analysis.paid, true);
      assert.equal(receivedSecret, secret);

      for (const artifact of result.artifacts.downloads) {
        const artifactText = await (await fetch(`${baseUrl}${artifact.url}`)).text();
        assert.equal(artifactText.includes(secret), false);
      }
    },
  );
});

test("DeepSeek truncation returns a clearly labelled deterministic report instead of an empty failure", async () => {
  const source = new FixtureRepositorySource(fixtureRoot, "small-typescript-repo");
  const outputRoot = await mkdtemp(join(tmpdir(), "repo-artifact-web-fallback-"));
  const provider = new TruncatedPaidFixtureProvider();

  await withServer(
    {
      source,
      outputRoot,
      generatedAt: "2026-09-16T00:00:00.000Z",
      networkHosts: ["api.deepseek.com"],
      modelProviderFactory: () => provider,
    },
    async (baseUrl) => {
      const response = await analysisRequest(baseUrl, source.url, {
        provider: "deepseek",
        deepseekApiKey: "test-deepseek-fallback-secret",
        paidModelConsent: true,
      });

      assert.equal(response.status, 200);
      const result = (await response.json()) as {
        readonly status: string;
        readonly overview: { readonly summary: string };
        readonly analysis: {
          readonly provider: string;
          readonly paid: boolean;
          readonly fallback: {
            readonly used: boolean;
            readonly failed_stage: string;
            readonly failure_code: string;
            readonly paid_request_attempted: boolean;
            readonly input_tokens: number;
            readonly output_tokens: number;
          };
        };
        readonly artifacts: {
          readonly downloads: readonly { readonly name: string; readonly url: string }[];
        };
      };
      assert.equal(result.status, "PASS_WITH_FALLBACK");
      assert.match(result.overview.summary, /small TypeScript greeting library/i);
      assert.equal(result.analysis.provider, "deterministic-v1");
      assert.equal(result.analysis.paid, false);
      assert.deepEqual(result.analysis.fallback, {
        used: true,
        from_provider: "deepseek-api",
        from_model: "deepseek-flash-test-double",
        to_provider: "deterministic-v1",
        failed_stage: "angles",
        failure_code: "TRUNCATED_OUTPUT",
        finish_reason: "length",
        paid_request_attempted: true,
        network_calls: 1,
        input_tokens: 900,
        output_tokens: 2_500,
      });
      assert.deepEqual(provider.attemptedStages, ["brief", "angles"]);

      const reportLink = result.artifacts.downloads.find((item) => item.name === "report.md");
      const fallbackLink = result.artifacts.downloads.find(
        (item) => item.name === "fallback-receipt.json",
      );
      assert.ok(reportLink !== undefined);
      assert.ok(fallbackLink !== undefined);
      const report = await (await fetch(`${baseUrl}${reportLink.url}`)).text();
      assert.match(report, /DeepSeek 智能增强未完成/);
      assert.match(report, /免费确定性分析/);
      const fallbackReceipt = await (await fetch(`${baseUrl}${fallbackLink.url}`)).text();
      assert.equal(fallbackReceipt.includes("test-deepseek-fallback-secret"), false);
      assert.match(fallbackReceipt, /"failed_stage": "angles"/);
      assert.match(fallbackReceipt, /"normal_report_generated": true/);
    },
  );
});

class RateLimitedSource implements RepositorySource {
  async resolve(): Promise<ResolvedRepository> {
    throw new GitHubApiError(403, "GitHub API returned 403", {
      limit: 60,
      remaining: 0,
      resetAt: "2026-09-15T10:10:43.000Z",
      authenticated: false,
    });
  }

  async listTree(): Promise<RepositoryTree> {
    throw new Error("unreachable");
  }

  async readBlob(): Promise<RepositoryBlob> {
    throw new Error("unreachable");
  }
}

test("GitHub quota exhaustion is classified separately from an invalid repository URL", async () => {
  await withServer({ source: new RateLimitedSource() }, async (baseUrl) => {
    const response = await analysisRequest(baseUrl, "https://github.com/owner/repo");
    assert.equal(response.status, 422);
    const body = await response.json();
    assert.equal(body.error.code, "GITHUB_RATE_LIMIT");
    assert.equal(body.error.retry_at, "2026-09-15T10:10:43.000Z");
    assert.match(body.error.message, /匿名/);
  });
});

class BlockingSource implements RepositorySource {
  readonly fixture = new FixtureRepositorySource(fixtureRoot, "small-typescript-repo");
  readonly started: Promise<void>;
  private signalStarted!: () => void;
  private readonly released: Promise<void>;
  private signalReleased!: () => void;

  constructor() {
    this.started = new Promise((resolveStarted) => {
      this.signalStarted = resolveStarted;
    });
    this.released = new Promise((resolveReleased) => {
      this.signalReleased = resolveReleased;
    });
  }

  release(): void {
    this.signalReleased();
  }

  async resolve(url: string): Promise<ResolvedRepository> {
    this.signalStarted();
    await this.released;
    return this.fixture.resolve(url);
  }

  listTree(repository: ResolvedRepository): Promise<RepositoryTree> {
    return this.fixture.listTree(repository);
  }

  readBlob(repository: ResolvedRepository, entry: TreeEntry): Promise<RepositoryBlob> {
    return this.fixture.readBlob(repository, entry);
  }
}

test("local preview permits only one active analysis", async () => {
  const source = new BlockingSource();
  const outputRoot = await mkdtemp(join(tmpdir(), "repo-artifact-web-busy-"));
  await withServer({ source, outputRoot, networkHosts: [] }, async (baseUrl) => {
    const first = analysisRequest(baseUrl, source.fixture.url);
    await source.started;

    const second = await analysisRequest(baseUrl, source.fixture.url);
    assert.equal(second.status, 409);
    assert.equal((await second.json()).error.code, "ANALYSIS_BUSY");

    source.release();
    assert.equal((await first).status, 200);
  });
});

test("download routes never accept arbitrary files", async () => {
  const source = new FixtureRepositorySource(fixtureRoot, "small-typescript-repo");
  const outputRoot = await mkdtemp(join(tmpdir(), "repo-artifact-web-download-"));
  await withServer({ source, outputRoot, networkHosts: [] }, async (baseUrl) => {
    const response = await analysisRequest(baseUrl, source.url);
    const result = (await response.json()) as {
      readonly artifacts: { readonly downloads: readonly { readonly url: string }[] };
    };
    const validUrl = result.artifacts.downloads[0]?.url;
    assert.ok(validUrl !== undefined);
    const runId = /^\/api\/runs\/([^/]+)\//.exec(validUrl)?.[1];
    assert.ok(runId !== undefined);

    const forbidden = await fetch(`${baseUrl}/api/runs/${runId}/artifacts/package.json`);
    assert.equal(forbidden.status, 404);
    assert.equal(await readFile(resolve(root, "package.json"), "utf8").then(Boolean), true);
  });
});
