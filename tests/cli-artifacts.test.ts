import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { analyzeRepository } from "../src/application/analyze-repository.js";
import { runCli } from "../src/cli/command.js";
import { DeterministicModelProvider } from "../src/model/deterministic-provider.js";
import { FixtureRepositorySource } from "./support/fixture-repository-source.js";

const root = process.cwd();
const fixturesRoot = resolve(root, "tests", "fixtures");
const schemaDirectory = resolve(root, "schemas");

function fixture(name: string): FixtureRepositorySource {
  return new FixtureRepositorySource(resolve(fixturesRoot, name), name);
}

async function temporaryOutput(): Promise<string> {
  return mkdtemp(join(tmpdir(), "repo-artifact-output-"));
}

test("application writes the complete JSON and Markdown artifact set atomically", async () => {
  const source = fixture("small-typescript-repo");
  const outputRoot = await temporaryOutput();
  const result = await analyzeRepository({
    url: source.url,
    source,
    provider: new DeterministicModelProvider(),
    schemaDirectory,
    outputRoot,
    generatedAt: "2026-08-31T00:00:00.000Z",
    networkHosts: [],
  });

  assert.deepEqual((await readdir(result.outputDirectory)).sort(), [
    "architecture.mmd",
    "codebase-brief.json",
    "content-angles.json",
    "evidence.json",
    "report.md",
    "run-receipt.json",
    "script.json",
  ]);
  const receipt = JSON.parse(
    await readFile(join(result.outputDirectory, "run-receipt.json"), "utf8"),
  ) as Record<string, unknown>;
  assert.equal(receipt.status, "PASS");
  assert.equal(receipt.commit_sha, source.commitSha);
  assert.equal(receipt.repository_code_executions, 0);
  const report = await readFile(join(result.outputDirectory, "report.md"), "utf8");
  assert.match(report, /## 架构关系/);
  assert.match(report, /## 证据/);
  assert.match(report, /## 可选口播稿/);
});

test("critical repository failure writes no normal-looking report", async () => {
  const source = fixture("broken-repo");
  const outputRoot = await temporaryOutput();

  await assert.rejects(
    analyzeRepository({
      url: source.url,
      source,
      provider: new DeterministicModelProvider(),
      schemaDirectory,
      outputRoot,
      generatedAt: "2026-08-31T00:00:00.000Z",
      networkHosts: [],
    }),
  );

  const rootEntries = await readdir(outputRoot, { recursive: true });
  assert.equal(rootEntries.some((entry) => entry.endsWith("report.md")), false);
  assert.equal(rootEntries.some((entry) => entry.endsWith("failure-receipt.json")), true);
});

test("CLI analyze command is a real fixture-backed entry point", async () => {
  const source = fixture("small-typescript-repo");
  const outputRoot = await temporaryOutput();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = await runCli(
    ["analyze", source.url, "--output", outputRoot, "--provider", "deterministic"],
    {
      source,
      schemaDirectory,
      generatedAt: "2026-08-31T00:00:00.000Z",
      networkHosts: [],
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    },
  );

  assert.equal(exitCode, 0, stderr.join("\n"));
  assert.equal(stderr.length, 0);
  assert.equal(stdout.some((line) => line.includes("PASS")), true);
  assert.equal(stdout.some((line) => line.includes(source.commitSha)), true);
});

test("quality-review application mode writes VS02 review artifacts without changing VS01 mode", async () => {
  const source = fixture("multi-module-typescript-repo");
  const outputRoot = await temporaryOutput();
  const result = await analyzeRepository({
    url: source.url,
    source,
    provider: new DeterministicModelProvider(),
    schemaDirectory,
    outputRoot,
    generatedAt: "2026-08-31T00:00:00.000Z",
    networkHosts: [],
    includeQualityReview: true,
  });

  assert.ok(result.qualityReview !== undefined);
  assert.equal(result.qualityReview.evaluation.shareability, "NO");
  const receipt = JSON.parse(
    await readFile(join(result.outputDirectory, "run-receipt.json"), "utf8"),
  ) as Record<string, unknown>;
  assert.equal(receipt.vertical_slice, "02");
  assert.equal(receipt.status, "BLOCKED_PENDING_STRONGER_MODEL");
  assert.equal(receipt.engineering_status, "PASS");
});

test("CLI can select the optional local Ollama provider and records a blocked content verdict", async () => {
  const source = fixture("small-typescript-repo");
  const outputRoot = await temporaryOutput();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const requestedOutputLimits: number[] = [];
  const ollamaFetch: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      readonly prompt: string;
      readonly options: { readonly num_predict: number };
    };
    requestedOutputLimits.push(body.options.num_predict);
    const stage = /Prompt stage: (brief|angles|content)/.exec(body.prompt)?.[1];
    const value =
      stage === "brief"
        ? {
            oneSentence: "A small greeting package.",
            summary: "It exposes a bounded greeting function.",
            problem: "",
            targetUsers: ["maintainers"],
            moduleInterpretations: [
              {
                sourcePath: "src/greet.ts",
                semanticName: "Greeting core",
                responsibility: "Builds the returned greeting.",
                whyImportant: "It keeps the public entry separate from the implementation.",
              },
            ],
          }
        : stage === "angles"
          ? {
              title: "Why tiny-greeter keeps its public entry separate",
              hook: "Follow the fixed commit.",
              whyInteresting: "The import is directly traceable.",
              candidates: [
                {
                  title: "Why tiny-greeter keeps its public entry separate",
                  hook: "One import exposes the package boundary.",
                  whyInteresting: "The fixed source range makes the boundary reproducible.",
                  claimIds: ["claim_relationship_1_src_index_ts_src_greet_ts"],
                  decision: "select",
                  rank: 1,
                  rejectionReason: "",
                },
                {
                  title: "A second source-bound angle",
                  hook: "The same fixed claim is deliberately reused in this fixture.",
                  whyInteresting: "The host, not the model, controls the final count.",
                  claimIds: ["claim_relationship_1_src_index_ts_src_greet_ts"],
                  decision: "select",
                  rank: 2,
                  rejectionReason: "",
                },
                {
                  title: "A third source-bound angle",
                  hook: "This exceeds the host publication limit.",
                  whyInteresting: "It should be retained only as a rejection receipt.",
                  claimIds: ["claim_relationship_1_src_index_ts_src_greet_ts"],
                  decision: "select",
                  rank: 3,
                  rejectionReason: "",
                },
              ],
            }
          : {
              opening: "先看固定提交里的证据。",
              closing: "证据之外的内容继续留作未知。",
              claimOrder: ["claim_relationship_1_src_index_ts_src_greet_ts"],
              transitions: [
                "真正值得讲的不是文件数量，而是入口与实现之间这条可以复查的边界。",
              ],
            };
    return new Response(
      JSON.stringify({
        model: "qwen2.5:7b",
        response: JSON.stringify(value),
        done: true,
        done_reason: "stop",
        prompt_eval_count: 100,
        eval_count: 30,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const exitCode = await runCli(
    [
      "analyze",
      source.url,
      "--output",
      outputRoot,
      "--provider",
      "ollama",
      "--model",
      "qwen2.5:7b",
    ],
    {
      source,
      schemaDirectory,
      generatedAt: "2026-08-31T00:00:00.000Z",
      networkHosts: ["127.0.0.1:11434"],
      ollamaFetch,
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    },
  );

  assert.equal(exitCode, 0);
  assert.equal(stderr.length, 0);
  assert.deepEqual(requestedOutputLimits, [800, 800, 1_000]);
  assert.ok(stdout.some((line) => line.includes("ENGINEERING PASS")));
  assert.ok(stdout.some((line) => line.includes("BLOCKED_PENDING_")));
  const artifactLine = stdout.find((line) => line.startsWith("Artifacts: "));
  assert.ok(artifactLine !== undefined);
  const humanReview = await readFile(
    join(artifactLine.slice("Artifacts: ".length), "human-review.md"),
    "utf8",
  );
  assert.match(humanReview, /Greeting core/);
  assert.match(humanReview, /入口与实现之间这条可以复查的边界/);
  const modelInsights = JSON.parse(
    await readFile(
      join(artifactLine.slice("Artifacts: ".length), "model-insights.json"),
      "utf8",
    ),
  ) as {
    readonly angle_candidates: readonly { readonly host_status: string }[];
  };
  assert.equal(modelInsights.angle_candidates[2]?.host_status, "rejected_rank_limit");
});

test("DeepSeek CLI returns only DEEPSEEK_API_KEY_NOT_CONFIGURED before any request", async () => {
  const source = fixture("small-typescript-repo");
  const outputRoot = await temporaryOutput();
  const stdout: string[] = [];
  const stderr: string[] = [];
  let providerRequests = 0;

  const exitCode = await runCli(
    ["analyze", source.url, "--output", outputRoot, "--provider", "deepseek"],
    {
      source,
      schemaDirectory,
      modelEnvironment: {},
      deepseekFetch: async () => {
        providerRequests += 1;
        throw new Error("transport must not run");
      },
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    },
  );

  assert.equal(exitCode, 1);
  assert.deepEqual(stdout, []);
  assert.deepEqual(stderr, ["DEEPSEEK_API_KEY_NOT_CONFIGURED"]);
  assert.equal(providerRequests, 0);
  assert.deepEqual(await readdir(outputRoot), []);
});

test("DeepSeek CLI uses the existing three-stage pipeline through a mock transport", async () => {
  const source = fixture("small-typescript-repo");
  const outputRoot = await temporaryOutput();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const secret = randomUUID();
  let providerRequests = 0;
  const requestedOutputLimits: number[] = [];
  const deepseekFetch: typeof fetch = async (_input, init) => {
    providerRequests += 1;
    const body = JSON.parse(String(init?.body)) as {
      readonly messages: readonly { readonly content: string }[];
      readonly max_tokens: number;
    };
    requestedOutputLimits.push(body.max_tokens);
    const prompt = body.messages[1]?.content ?? "";
    const stage = /Prompt stage: (brief|angles|content)/.exec(prompt)?.[1];
    const value =
      stage === "brief"
        ? {
            oneSentence: "A small greeting package.",
            summary: "It exposes a bounded greeting function.",
            problem: "",
            targetUsers: ["maintainers"],
            moduleInterpretations: [
              {
                sourcePath: "src/greet.ts",
                semanticName: "Greeting core",
                responsibility: "Builds the returned greeting.",
                whyImportant: "It keeps the public entry separate from the implementation.",
              },
            ],
          }
        : stage === "angles"
          ? {
              title: "Why tiny-greeter keeps its public entry separate",
              hook: "Follow the fixed commit.",
              whyInteresting: "The import is directly traceable.",
              candidates: [
                {
                  title: "Why tiny-greeter keeps its public entry separate",
                  hook: "One import exposes the package boundary.",
                  whyInteresting: "The fixed source range makes the boundary reproducible.",
                  claimIds: ["claim_relationship_1_src_index_ts_src_greet_ts"],
                  decision: "select",
                  rank: 1,
                  rejectionReason: "",
                },
              ],
            }
          : {
              opening: "先看固定提交里的证据。",
              closing: "证据之外的内容继续留作未知。",
              claimOrder: ["claim_relationship_1_src_index_ts_src_greet_ts"],
              transitions: ["接下来只复述已经追踪的事实。"],
            };
    return new Response(
      JSON.stringify({
        model: "deepseek-v4-pro",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: JSON.stringify(value) },
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 30,
          total_tokens: 130,
          prompt_cache_hit_tokens: 0,
          prompt_cache_miss_tokens: 100,
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const exitCode = await runCli(
    ["analyze", source.url, "--output", outputRoot, "--provider", "deepseek"],
    {
      source,
      schemaDirectory,
      generatedAt: "2026-08-31T00:00:00.000Z",
      networkHosts: ["api.deepseek.com"],
      modelEnvironment: { DEEPSEEK_API_KEY: secret },
      deepseekFetch,
      modelSleep: async () => undefined,
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    },
  );

  assert.equal(exitCode, 0, stderr.join("\n"));
  assert.equal(stderr.length, 0);
  assert.equal(providerRequests, 3);
  assert.deepEqual(requestedOutputLimits, [2_500, 2_500, 2_500]);
  assert.ok(stdout.some((line) => line.includes("ENGINEERING PASS")));
  const artifactLine = stdout.find((line) => line.startsWith("Artifacts: "));
  assert.ok(artifactLine !== undefined);
  const receipt = JSON.parse(
    await readFile(join(artifactLine.slice("Artifacts: ".length), "run-receipt.json"), "utf8"),
  ) as {
    readonly provider_invocations: readonly {
      readonly provider: string;
      readonly paid: boolean;
      readonly endpoint: string;
    }[];
  };
  assert.equal(receipt.provider_invocations.length, 3);
  assert.ok(
    receipt.provider_invocations.every(
      (invocation) =>
        invocation.provider === "deepseek-api" &&
        invocation.paid === true &&
        invocation.endpoint === "remote_https",
    ),
  );
});
