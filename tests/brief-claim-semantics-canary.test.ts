import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { runBriefClaimSemanticsCanary } from "../src/analysis/brief-canary.js";
import type { BriefNarrative } from "../src/analysis/brief-builder.js";
import type { EvidenceRecord } from "../src/analysis/domain.js";
import { prepareBriefGeneration } from "../src/analysis/pipeline.js";
import type {
  ModelProvider,
  ModelResult,
  StructuredGenerationRequest,
} from "../src/model/provider.js";
import { buildStructuredPrompt } from "../src/model/structured-prompt.js";
import { structuredOutputContract } from "../src/model/structured-output.js";
import { readRepository } from "../src/repo/progressive-reader.js";
import { evaluateBriefNarrativeSemantics } from "../src/quality/brief-narrative-semantics.js";
import { createSchemaRegistry } from "../src/schemas/registry.js";
import { FixtureRepositorySource } from "./support/fixture-repository-source.js";

const root = process.cwd();
const schemas = createSchemaRegistry(resolve(root, "schemas"));

function experimentalControl(
  snapshot: Awaited<ReturnType<typeof readRepository>>,
) {
  const prepared = prepareBriefGeneration(snapshot, "deepseek-api");
  const contract = structuredOutputContract(prepared.request.schemaId);
  assert.ok(contract !== null);
  return {
    expectedHighestReadScope: snapshot.highestScope,
    expectedFilesRead: snapshot.files.map((file) => file.path),
    expectedRepositoryCharactersPassed: prepared.request.untrustedRepositoryContext.reduce(
      (sum, chunk) => sum + chunk.content.length,
      0,
    ),
    expectedPromptCharacters: buildStructuredPrompt(prepared.request, contract.schema).length,
  };
}

function resultFor<T>(request: StructuredGenerationRequest, value: T): ModelResult<T> {
  const contract = structuredOutputContract(request.schemaId);
  assert.ok(contract !== null);
  return {
    value,
    provider: "deepseek-api",
    model: "deepseek-v4-pro",
    usage: {
      inputTokens: 400,
      outputTokens: 100,
      cacheHitInputTokens: 350,
      cacheMissInputTokens: 50,
    },
    networkCalls: 1,
    paid: true,
    context: {
      promptStage: request.stage,
      highestReadScope: request.repositoryReadReceipt.highestScope,
      filesConsidered: request.repositoryReadReceipt.filesConsidered,
      filesRead: request.repositoryReadReceipt.filesRead,
      filesPassed: request.untrustedRepositoryContext.map((chunk) => chunk.path),
      repositoryCharactersPassed: request.untrustedRepositoryContext.reduce(
        (sum, chunk) => sum + chunk.content.length,
        0,
      ),
      promptCharacters: buildStructuredPrompt(request, contract.schema).length,
      repairActions: [],
      schemaValidated: true,
      endpoint: "remote_https",
    },
  };
}

test("Brief-only canary sends exactly one Brief request and never enters Angle or Content", async () => {
  const source = new FixtureRepositorySource(
    resolve(root, "tests", "fixtures", "small-typescript-repo"),
    "small-typescript-repo",
  );
  const snapshot = await readRepository(source, source.url);
  const stages: StructuredGenerationRequest["stage"][] = [];
  const provider: ModelProvider = {
    id: "deepseek-api",
    async generateStructured<T>(request: StructuredGenerationRequest): Promise<ModelResult<T>> {
      stages.push(request.stage);
      return resultFor(
        request,
        {
          oneSentence: "A small greeting package.",
          summary: "The package exports a greeting function.",
          problem: "It formats a greeting from a supplied name.",
          targetUsers: ["TypeScript developers"],
          moduleInterpretations: [],
        } as T,
      );
    },
  };

  const result = await runBriefClaimSemanticsCanary(snapshot, {
    provider,
    schemas,
    generatedAt: "2026-09-01T00:00:00.000Z",
    expectedCommitSha: source.commitSha,
    experimentalControl: experimentalControl(snapshot),
    budget: {
      hardBudgetUsd: 0.02,
      inputTokenHardLimit: 18_000,
      outputTokenHardLimit: 2_500,
      preflightInputTokens: 500,
      pricing: {
        currency: "USD",
        inputCacheHitUsdPerMillion: 0.044,
        inputCacheMissUsdPerMillion: 1.32,
        outputUsdPerMillion: 3.96,
      },
    },
  });

  assert.deepEqual(stages, ["brief"]);
  assert.equal(result.generation.paidRequests, 1);
  assert.equal(result.generation.httpAttempts, 1);
  assert.equal(result.generation.outputTokenLimit, 2_500);
  assert.equal(result.repositoryExecutions, 0);
  assert.equal(result.canonicalBrief.repository.commit_sha, source.commitSha);
  assert.equal(result.briefQuality.passed, true);
  assert.equal(
    result.briefQuality.gates.find((gate) => gate.id === "schema_validity")?.passed,
    true,
  );
  assert.equal(
    result.briefQuality.gates.find((gate) => gate.id === "evidence_paths")?.passed,
    true,
  );
  assert.equal(
    result.briefQuality.gates.find((gate) => gate.id === "claim_semantics")?.passed,
    true,
  );
  assert.equal(result.narrativeSemantics.decisions.length, 3);
});

test("Brief-only canary rejects prompt drift before the paid provider is called", async () => {
  const source = new FixtureRepositorySource(
    resolve(root, "tests", "fixtures", "small-typescript-repo"),
    "small-typescript-repo",
  );
  const snapshot = await readRepository(source, source.url);
  let providerCalls = 0;
  const provider: ModelProvider = {
    id: "deepseek-api",
    async generateStructured<T>(request: StructuredGenerationRequest): Promise<ModelResult<T>> {
      providerCalls += 1;
      return resultFor(request, {} as T);
    },
  };
  const control = experimentalControl(snapshot);

  await assert.rejects(
    runBriefClaimSemanticsCanary(snapshot, {
      provider,
      schemas,
      generatedAt: "2026-09-01T00:00:00.000Z",
      expectedCommitSha: source.commitSha,
      experimentalControl: {
        ...control,
        expectedPromptCharacters: control.expectedPromptCharacters + 1,
      },
      budget: {
        hardBudgetUsd: 0.02,
        inputTokenHardLimit: 18_000,
        outputTokenHardLimit: 2_500,
        preflightInputTokens: 500,
        pricing: {
          currency: "USD",
          inputCacheHitUsdPerMillion: 0.044,
          inputCacheMissUsdPerMillion: 1.32,
          outputUsdPerMillion: 3.96,
        },
      },
    }),
    /BRIEF_CANARY_PROMPT_DRIFT/,
  );
  assert.equal(providerCalls, 0);
});

test("Brief narrative semantics returns traceable decisions for the real DeepSeek replay", () => {
  const fixture = JSON.parse(
    readFileSync(
      resolve(root, "tests", "fixtures", "deepseek-v4-pro-defu-brief-retry.json"),
      "utf8",
    ),
  ) as {
    readonly rawBriefNarrative: BriefNarrative;
    readonly evidenceSnapshot: EvidenceRecord;
  };

  const receipt = evaluateBriefNarrativeSemantics(
    fixture.rawBriefNarrative,
    [fixture.evidenceSnapshot],
  );
  const nullish = receipt.decisions.find((decision) =>
    decision.originalClaim.includes("skips nullish values"),
  );
  const security = receipt.decisions.find((decision) =>
    decision.originalClaim.includes("introducing security risks"),
  );
  const lightweight = receipt.decisions.find((decision) =>
    decision.originalClaim.includes("lightweight utility"),
  );

  assert.equal(receipt.claimSemanticsVersion, 2);
  assert.equal(nullish?.finalAction, "NARROW");
  assert.equal(nullish?.traceValid, true);
  assert.deepEqual(nullish?.evidenceIds, ["evidence_symbol_src_defu_ts__defu_5"]);
  assert.equal(security?.atomizationStatus, "COMPOUND_UNATOMIZED");
  assert.equal(security?.finalAction, "DOWNGRADE");
  assert.equal(security?.finalStatus, "unknown");
  assert.deepEqual(security?.evidenceIds, []);
  assert.equal(security?.traceValid, true);
  assert.equal(lightweight?.finalAction, "DOWNGRADE");
  assert.equal(lightweight?.finalStatus, "unknown");
});

test("Brief narrative semantics stops on a genuinely unclassified comparative pattern", () => {
  const receipt = evaluateBriefNarrativeSemantics(
    {
      oneSentence: "The helper is better than alternatives.",
      summary: "The type enables safer configuration.",
      problem: "",
      targetUsers: [],
      moduleInterpretations: [],
    },
    [],
  );

  assert.equal(receipt.passed, false);
  assert.deepEqual(receipt.newSemanticGaps, [
    {
      decisionId: "brief_narrative_claim_001",
      pattern: "COMPARATIVE",
      claim: "The helper is better than alternatives.",
    },
  ]);
  assert.equal(receipt.decisions[1]?.semanticStatus, "OUTCOME_UNSUPPORTED");
});

test("module descriptions are atomized into independently traceable claims", () => {
  const receipt = evaluateBriefNarrativeSemantics(
    {
      oneSentence: "A bounded utility.",
      summary: "The utility has one module.",
      problem: "",
      targetUsers: [],
      moduleInterpretations: [
        {
          sourcePath: "src/index.ts",
          semanticName: "Entry",
          responsibility: "Exports `createTool`. It handles arrays.",
          whyImportant: "It is the selected entry module.",
        },
      ],
    },
    [],
  );
  const moduleClaims = receipt.decisions.filter(
    (decision) => decision.source === "module_responsibility",
  );

  assert.equal(receipt.claimSemanticsVersion, 2);
  assert.equal(moduleClaims.length, 2);
  assert.equal(moduleClaims[0]?.rawClaim, "Exports `createTool`. It handles arrays.");
  assert.equal(moduleClaims[0]?.parentClaimId, moduleClaims[1]?.parentClaimId);
  assert.deepEqual(
    moduleClaims.map((decision) => decision.originalClaim),
    ["Exports `createTool`.", "It handles arrays."],
  );
  assert.deepEqual(
    moduleClaims.map((decision) => decision.atomizationStatus),
    ["ATOMIZED", "ATOMIZED"],
  );
  assert.notEqual(moduleClaims[0]?.id, moduleClaims[1]?.id);
});

test("independent predicates split while uncertain compounds fail closed", () => {
  const split = evaluateBriefNarrativeSemantics(
    {
      oneSentence: "Module X exposes an ESM entry and preserves its inputs.",
      summary: "A bounded module.",
      problem: "",
      targetUsers: [],
      moduleInterpretations: [],
    },
    [],
  );
  const splitAtoms = split.decisions.filter(
    (decision) => decision.source === "one_sentence",
  );
  assert.deepEqual(
    splitAtoms.map((decision) => decision.originalClaim),
    ["Module X exposes an ESM entry.", "Module X preserves its inputs."],
  );
  assert.equal(splitAtoms[0]?.parentClaimId, splitAtoms[1]?.parentClaimId);
  assert.ok(splitAtoms.every((decision) => decision.atomizationStatus === "ATOMIZED"));
  assert.equal(splitAtoms[0]?.claimType, "PACKAGE_EXPORT");
  assert.equal(splitAtoms[1]?.claimType, "IMMUTABILITY");
  assert.ok(Array.isArray(splitAtoms[0]?.evidenceCandidates));
  assert.ok(Array.isArray(splitAtoms[0]?.selectedEvidence));
  assert.ok(splitAtoms[0]?.semanticAnchors.objects.includes("esm_entry"));

  const uncertain = evaluateBriefNarrativeSemantics(
    {
      oneSentence:
        "Assigning nested defaults safely without mutating inputs, and with customizable merge behavior.",
      summary: "A bounded module.",
      problem: "",
      targetUsers: [],
      moduleInterpretations: [],
    },
    [],
  );
  const uncertainClaim = uncertain.decisions.find(
    (decision) => decision.source === "one_sentence",
  );
  assert.equal(uncertainClaim?.atomizationStatus, "COMPOUND_UNATOMIZED");
  assert.equal(uncertainClaim?.semanticStatus, "COMPOUND_UNATOMIZED");
  assert.equal(uncertainClaim?.finalAction, "DOWNGRADE");
  assert.equal(uncertainClaim?.finalStatus, "unknown");
  assert.ok(uncertainClaim?.safetyModifiers.includes("safely"));
});

test("atomization recognizes punctuation and fails closed when subject carry is unsafe", () => {
  const receipt = evaluateBriefNarrativeSemantics(
    {
      oneSentence: "Module X reads config but writes cache.",
      summary: "Module X reads config; Module X writes cache.",
      problem: "Module X reads config while Module Y writes cache.",
      targetUsers: [],
      moduleInterpretations: [
        {
          sourcePath: "src/index.ts",
          semanticName: "Entry",
          responsibility: "Module X reads config, which also writes cache.",
          whyImportant: "Module X reads config, writes cache, and returns a value.",
        },
      ],
    },
    [],
  );

  const oneSentence = receipt.decisions.filter((decision) => decision.source === "one_sentence");
  assert.deepEqual(
    oneSentence.map((decision) => decision.originalClaim),
    ["Module X reads config.", "Module X writes cache."],
  );
  assert.equal(
    receipt.decisions.find((decision) => decision.source === "problem")?.atomizationStatus,
    "COMPOUND_UNATOMIZED",
  );
  assert.equal(
    receipt.decisions.find((decision) => decision.source === "module_responsibility")
      ?.atomizationStatus,
    "COMPOUND_UNATOMIZED",
  );
  assert.deepEqual(
    receipt.decisions
      .filter((decision) => decision.source === "module_importance")
      .map((decision) => decision.originalClaim),
    ["Module X reads config.", "Module X writes cache.", "Module X returns a value."],
  );
});

test("VS02-C real output replays offline with zero irrelevant narrowings", () => {
  const fixturePath = resolve(
    root,
    "tests",
    "fixtures",
    "deepseek-v4-pro-defu-vs02-c.json",
  );
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
    readonly sourceArtifact: { readonly path: string; readonly sha256: string };
    readonly rawBriefNarrative: BriefNarrative;
    readonly evidenceSnapshot: readonly EvidenceRecord[];
  };
  const sourceArtifactPath = resolve(root, fixture.sourceArtifact.path);
  if (existsSync(sourceArtifactPath)) {
    const sourceBytes = readFileSync(sourceArtifactPath);
    assert.equal(createHash("sha256").update(sourceBytes).digest("hex"), fixture.sourceArtifact.sha256);
    const source = JSON.parse(sourceBytes.toString("utf8")) as {
      readonly result: { readonly narrative: BriefNarrative };
    };
    assert.deepEqual(fixture.rawBriefNarrative, source.result.narrative);
  }

  const receipt = evaluateBriefNarrativeSemantics(
    fixture.rawBriefNarrative,
    fixture.evidenceSnapshot,
  );
  const knownBadParents = new Set([
    fixture.rawBriefNarrative.oneSentence,
    "defu is a TypeScript library that merges objects by recursively applying defaults.",
    fixture.rawBriefNarrative.problem,
  ]);
  const irrelevantNarrowings = receipt.decisions.filter(
    (decision) =>
      knownBadParents.has(decision.rawClaim) &&
      decision.finalAction === "NARROW" &&
      decision.finalClaim?.includes("skips a value when value is null or undefined") === true,
  );
  assert.equal(irrelevantNarrowings.length, 0);

  const safety = receipt.decisions.find((decision) =>
    decision.rawClaim.includes("safely and ergonomically"),
  );
  assert.ok(safety?.safetyModifiers.includes("safely"));
  assert.equal(safety?.detectedStrength, "SAFETY");
  assert.notEqual(safety?.finalStatus, "verified");

  const moduleAtoms = receipt.decisions.filter(
    (decision) =>
      decision.source === "module_responsibility" && decision.sourcePath === "src/defu.ts",
  );
  assert.equal(moduleAtoms.length, 6);
  assert.equal(new Set(moduleAtoms.map((decision) => decision.parentClaimId)).size, 1);
  assert.ok(moduleAtoms.every((decision) => decision.atomizationStatus === "ATOMIZED"));
  assert.equal(new Set(moduleAtoms.map((decision) => decision.id)).size, 6);
  assert.deepEqual(
    moduleAtoms
      .filter((decision) => decision.finalAction === "ACCEPT")
      .map((decision) => decision.originalClaim),
    [
      "src/defu.ts exports `createDefu`.",
      "src/defu.ts exports `defu`.",
      "src/defu.ts exports `defuFn`.",
      "src/defu.ts exports `defuArrayFn`.",
    ],
  );

  const esm = receipt.decisions.find((decision) =>
    decision.originalClaim.includes("both ESM and CommonJS entry points"),
  );
  assert.equal(esm?.claimType, "PACKAGE_EXPORT");
  assert.equal(esm?.atomizationStatus, "COMPOUND_UNATOMIZED");
  assert.equal(esm?.finalAction, "DOWNGRADE");
  assert.deepEqual(esm?.selectedEvidence, []);
  assert.equal(
    esm?.evidenceCandidates.some((item) => item.compatible),
    false,
  );

  const immutability = receipt.decisions.find(
    (decision) => decision.claimType === "IMMUTABILITY",
  );
  assert.notEqual(immutability?.finalStatus, "verified");
  const typeRuntime = receipt.decisions.find(
    (decision) =>
      decision.claimType === "TYPE_RUNTIME" &&
      decision.rawClaim.includes("matching runtime semantics"),
  );
  assert.ok(
    typeRuntime?.semanticStatus === "TYPE_RUNTIME_UNSUPPORTED" ||
      typeRuntime?.semanticStatus === "COMPOUND_UNATOMIZED",
  );
  assert.notEqual(typeRuntime?.finalStatus, "verified");
});
