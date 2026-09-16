import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { readRepository, RepositoryReadError } from "../src/repo/progressive-reader.js";
import { createWebServer } from "../src/web/server.js";
import { DeterministicModelProvider } from "../src/model/deterministic-provider.js";
import type { ModelProvider, ModelResult, StructuredGenerationRequest } from "../src/model/provider.js";
import { LargeRepositorySource } from "./support/large-repository-source.js";

const fixtureRoot = resolve("tests/fixtures/small-typescript-repo");

test("12944-entry repository reads bounded production sources instead of failing or filling the budget with scripts", async () => {
  const source = new LargeRepositorySource(fixtureRoot);
  const snapshot = await readRepository(source, source.url);
  assert.equal(snapshot.filesSeen, 12_944);
  assert.equal(snapshot.files.filter(f => f.kind === "source").length, 40);
  assert.ok(snapshot.files.some(f => f.path.startsWith("packages/engine/src/")));
  assert.equal(snapshot.files.some(f => f.path.split("/").includes("scripts")), false);
  assert.equal(source.operations.some(op => op.includes(":vendor/")), false);
  assert.ok(snapshot.bytesRead <= 1024 * 1024);
  assert.equal(snapshot.filesSkipped, snapshot.tree.filter(e => e.type === "blob").length - snapshot.files.length);
});

test("large indexes do not increase the one MiB content budget", async () => {
  const source = new LargeRepositorySource(fixtureRoot, 100_000, 80 * 1024);
  const snapshot = await readRepository(source, source.url);
  assert.equal(snapshot.filesSeen, 100_000);
  assert.ok(snapshot.bytesRead <= 1024 * 1024);
  assert.ok(snapshot.skipSummary.some(s => s.reason === "budget_exhausted" && s.count > 0));
  assert.ok(snapshot.files.filter(f => f.kind === "source").length < 40);
});

test("oversized, explicitly limited, unsafe and truncated indexes still fail before reading any content", async () => {
  for (const kind of ["oversized", "explicit-limit", "unsafe", "truncated"] as const) {
    const source = new LargeRepositorySource(fixtureRoot, kind === "oversized" ? 100_001 : 12_944);
    const originalTree = source.listTree.bind(source);
    source.listTree = async repo => {
      const tree = await originalTree(repo);
      if (kind === "truncated") return { ...tree, truncated: true };
      if (kind === "unsafe") return { ...tree, entries: [...tree.entries.slice(0, -1), { ...tree.entries[0]!, path: "../escape.ts" }] };
      return tree;
    };
    const code = kind === "unsafe" ? "INVALID_TREE_ENTRY" : kind === "truncated" ? "TREE_TRUNCATED" : "TOO_MANY_TREE_ENTRIES";
    await assert.rejects(readRepository(source, source.url, kind === "explicit-limit" ? { maxTreeEntries: 10_000 } : {}),
      (error: unknown) => error instanceof RepositoryReadError && error.code === code);
    assert.equal(source.operations.some(op => op.startsWith("blob:")), false);
  }
});

test("large repository reaches report downloads through both free and simulated DeepSeek Web modes", async () => {
  for (const mode of ["deterministic", "deepseek"] as const) {
    const source = new LargeRepositorySource(fixtureRoot);
    const delegate = new DeterministicModelProvider();
    const stages: string[] = [];
    const provider: ModelProvider = {
      id: mode === "deepseek" ? "deepseek-api" : delegate.id,
      async generateStructured<T>(request: StructuredGenerationRequest): Promise<ModelResult<T>> {
        stages.push(request.stage);
        assert.ok(request.untrustedRepositoryContext.reduce((sum, chunk) => sum + chunk.content.length, 0) <= 36_000);
        const result = await delegate.generateStructured<T>(request);
        return mode === "deterministic" ? result : {
          ...result,
          provider: "deepseek-api",
          model: "deepseek-offline-test-double",
          paid: true,
          networkCalls: 1,
          context: { ...result.context, endpoint: "remote_https" },
        };
      },
    };
    const server = createWebServer({
      source, modelProviderFactory: () => provider,
      assetRoot: resolve("web"), schemaDirectory: resolve("schemas"),
      outputRoot: await mkdtemp(join(tmpdir(), "large-repository-web-")),
      networkHosts: mode === "deepseek" ? ["api.deepseek.com"] : [],
    });
    await new Promise<void>(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const response = await fetch(`${base}/api/analyze`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: source.url, provider: mode, githubAuthMode: "anonymous", ...(mode === "deepseek" ? { deepseekApiKey: "fake-offline-test-key", paidModelConsent: true } : {}) }) });
      const body = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body.error));
      assert.equal(body.status, "PASS");
      assert.equal(body.analysis.files_seen, 12_944);
      assert.ok(body.analysis.bytes_read <= 1024 * 1024);
      assert.equal(body.analysis.repository_code_executions, 0);
      assert.deepEqual(stages, ["brief", "angles"]);
      const reportLink = body.artifacts.downloads.find((item: { name: string }) => item.name === "report.md");
      assert.ok(reportLink);
      const report = await fetch(`${base}${reportLink.url}`);
      assert.equal(report.status, 200);
      assert.match(await report.text(), /A small TypeScript greeting library/);
    } finally {
      await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
    }
  }
});
