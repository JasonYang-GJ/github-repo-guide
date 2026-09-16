import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { analyzeSnapshot, type AnalysisBundle } from "../src/analysis/pipeline.js";
import { writeArtifacts } from "../src/artifacts/writer.js";
import { buildContentAngles } from "../src/content/angles.js";
import { buildGroundedScript } from "../src/content/script.js";
import {
  buildQualityReviewArtifacts,
  evaluateContentQuality,
} from "../src/quality/content-evaluation.js";
import { buildScriptFactTrace } from "../src/quality/script-fact-trace.js";
import { DeterministicModelProvider } from "../src/model/deterministic-provider.js";
import { readRepository } from "../src/repo/progressive-reader.js";
import { createSchemaRegistry } from "../src/schemas/registry.js";
import { FixtureRepositorySource } from "./support/fixture-repository-source.js";

const root = process.cwd();
const fixturesRoot = resolve(root, "tests", "fixtures");
const schemas = createSchemaRegistry(resolve(root, "schemas"));

async function bundle(): Promise<AnalysisBundle> {
  const source = new FixtureRepositorySource(
    resolve(fixturesRoot, "multi-module-typescript-repo"),
    "multi-module-typescript-repo",
  );
  const snapshot = await readRepository(source, source.url);
  return analyzeSnapshot(snapshot, {
    provider: new DeterministicModelProvider(),
    schemas,
    generatedAt: "2026-08-31T00:00:00.000Z",
    networkHosts: [],
  });
}

test("content quality uses eight evidence-backed dimensions and no fake total score", async () => {
  const analysis = await bundle();
  const evaluation = evaluateContentQuality(analysis);

  assert.deepEqual(
    evaluation.dimensions.map((dimension) => dimension.id),
    [
      "technical_accuracy",
      "evidence_grounding",
      "relevance",
      "differentiation",
      "clarity",
      "non_hype",
      "shareability",
      "internal_consistency",
    ],
  );
  assert.ok(evaluation.dimensions.every((dimension) => dimension.reason.length > 0));
  assert.ok(evaluation.dimensions.every((dimension) => dimension.evidence.length > 0));
  assert.equal("total" in evaluation, false);
  assert.equal("score" in evaluation, false);
  assert.equal(evaluation.shareability, "NO");
  assert.equal(evaluation.rejected_angles.length, 1);
  assert.match(evaluation.rejected_angles[0]?.reason ?? "", /generic|通用/i);
  assert.ok(
    evaluation.marketing_claim_isolation.evidence.some((item) =>
      item.includes("claim_project_purpose: documentation"),
    ),
  );
});

test("script fact trace maps every core fact sentence to real claim and evidence IDs", async () => {
  const analysis = await bundle();
  const trace = buildScriptFactTrace(analysis);
  const claimIds = new Set(analysis.brief.claims.map((claim) => claim.id));
  const evidenceIds = new Set(analysis.evidence.map((evidence) => evidence.id));
  const claimSegments = analysis.script.segments.filter((segment) => segment.kind === "claim");

  assert.equal(trace.entries.length, claimSegments.length);
  assert.equal(trace.untraced_core_sentences.length, 0);
  assert.ok(trace.entries.every((entry) => entry.trace_status === "exact_claim"));
  assert.ok(trace.entries.every((entry) => entry.claim_ids.every((id) => claimIds.has(id))));
  assert.ok(trace.entries.every((entry) => entry.evidence_ids.every((id) => evidenceIds.has(id))));
});

test("model-ranked angles with unknown Claim IDs are rejected instead of partially repaired", async () => {
  const analysis = await bundle();
  const angles = buildContentAngles(
    analysis.brief,
    analysis.evidence,
    {
      title: "fallback is intentionally unused",
      hook: "fallback",
      whyInteresting: "fallback",
      candidates: [
        {
          title: "An unsupported candidate",
          hook: "It references a made-up claim.",
          whyInteresting: "This must never pass the host boundary.",
          claimIds: ["claim_does_not_exist"],
          decision: "select",
          rank: 1,
          rejectionReason: "",
        },
      ],
    },
    "2026-08-31T00:00:00.000Z",
  );

  assert.deepEqual(angles, []);
});

test("a fluent script with no core fact trace cannot pass grounding or shareability", async () => {
  const analysis = await bundle();
  const transitions = analysis.script.segments.filter((segment) => segment.kind === "transition");
  const altered: AnalysisBundle = {
    ...analysis,
    script: {
      ...analysis.script,
      segments: transitions,
      text: transitions.map((segment) => segment.text).join("\n"),
    },
  };
  const evaluation = evaluateContentQuality(altered);

  assert.equal(
    evaluation.dimensions.find((dimension) => dimension.id === "evidence_grounding")?.status,
    "fail",
  );
  assert.equal(evaluation.shareability, "NO");
});

test("untraced factual transitions are hallucination findings, not harmless prose", async () => {
  const analysis = await bundle();
  const first = analysis.script.segments[0];
  assert.ok(first !== undefined);
  const alteredSegment = {
    ...first,
    text: "Defu 类型在 types.ts 中被声明，并提供类型约束。",
  };
  const altered: AnalysisBundle = {
    ...analysis,
    script: {
      ...analysis.script,
      segments: [alteredSegment, ...analysis.script.segments.slice(1)],
      text: [alteredSegment, ...analysis.script.segments.slice(1)]
        .map((segment) => segment.text)
        .join("\n"),
    },
  };
  const evaluation = evaluateContentQuality(altered);

  assert.equal(
    evaluation.dimensions.find((dimension) => dimension.id === "evidence_grounding")?.status,
    "fail",
  );
  assert.ok(
    evaluation.hallucination_findings.some(
      (finding) => finding.source === "script" && /Defu 类型/.test(finding.text),
    ),
  );
  assert.equal(
    evaluation.dimensions.find((dimension) => dimension.id === "non_hype")?.status,
    "pass",
  );
  assert.equal(evaluation.shareability, "NO");
});

test("common core-functionality and type-safety titles are rejected as generic", async () => {
  const analysis = await bundle();
  const firstAngle = analysis.angles[0];
  assert.ok(firstAngle !== undefined);
  const altered: AnalysisBundle = {
    ...analysis,
    angles: [{ ...firstAngle, title: "Type Safety with layered-notes" }],
  };
  const evaluation = evaluateContentQuality(altered);

  assert.equal(evaluation.rejected_angles.length, 1);
  assert.equal(evaluation.dimensions.find((item) => item.id === "relevance")?.status, "fail");
});

test("spoken script stays inside the top-ranked angle even when the model requests another angle's fact", async () => {
  const analysis = await bundle();
  const firstAngle = analysis.angles[0];
  const purpose = analysis.brief.claims.find((claim) => claim.id === "claim_project_purpose");
  assert.ok(firstAngle !== undefined);
  assert.ok(purpose !== undefined);
  const purposeAngle = {
    ...firstAngle,
    id: "angle_purpose",
    rank: 2,
    claim_ids: [purpose.id],
    evidence_ids: purpose.evidence_ids,
    script_safe_claim_ids: [purpose.id],
  };
  const script = buildGroundedScript(
    analysis.brief,
    [firstAngle, purposeAngle],
    analysis.evidence,
    {
      opening: "先看证据。",
      closing: "证据之外保持未知。",
      claimOrder: [purpose.id, ...firstAngle.script_safe_claim_ids],
      transitions: [],
    },
  );

  const spokenClaimIds = script.segments
    .filter((segment) => segment.kind === "claim")
    .flatMap((segment) => segment.claim_ids);
  assert.equal(spokenClaimIds.includes(purpose.id), false);
  assert.ok(spokenClaimIds.length > 0);
  assert.ok(
    spokenClaimIds.every((claimId) => firstAngle.script_safe_claim_ids.includes(claimId)),
  );
});

test("hype and unsupported superlatives are explicit quality failures", async () => {
  const analysis = await bundle();
  const first = analysis.script.segments[0];
  assert.ok(first !== undefined);
  const alteredSegment = {
    ...first,
    text: "这是史上最快、彻底颠覆行业的革命性方案。",
  };
  const altered: AnalysisBundle = {
    ...analysis,
    script: {
      ...analysis.script,
      segments: [alteredSegment, ...analysis.script.segments.slice(1)],
      text: [alteredSegment, ...analysis.script.segments.slice(1)]
        .map((segment) => segment.text)
        .join("\n"),
    },
  };
  const evaluation = evaluateContentQuality(altered);

  assert.equal(
    evaluation.dimensions.find((dimension) => dimension.id === "non_hype")?.status,
    "fail",
  );
  assert.ok(evaluation.hallucination_findings.some((finding) => /史上最快/.test(finding.text)));
  assert.equal(evaluation.shareability, "NO");
});

test("quality review artifacts are atomic, machine-readable, and human-reviewable", async () => {
  const analysis = await bundle();
  const review = buildQualityReviewArtifacts(analysis);
  const outputRoot = await mkdtemp(join(tmpdir(), "repo-artifact-quality-"));
  const result = await writeArtifacts(analysis, {
    outputRoot,
    durationMs: 42,
    licenseSpdx: "MIT",
    verticalSlice: "02",
    additionalArtifacts: review.files,
    receiptExtension: {
      engineering_status: "PASS",
      content_quality_status: review.evaluation.release_status,
    },
  });

  assert.deepEqual((await readdir(result.outputDirectory)).sort(), [
    "architecture.mmd",
    "codebase-brief.json",
    "content-angles.json",
    "content-quality.json",
    "evidence.json",
    "human-review.md",
    "model-insights.json",
    "rejected-angles.json",
    "report.md",
    "run-receipt.json",
    "script-fact-trace.json",
    "script.json",
  ]);
  const humanReview = await readFile(join(result.outputDirectory, "human-review.md"), "utf8");
  assert.match(humanReview, /## Repository and Commit/);
  assert.match(humanReview, /## Files Read and Model Context/);
  assert.match(humanReview, /## Model Interpretations/);
  assert.match(humanReview, /## Evidence and Fact Trace/);
  assert.match(humanReview, /Reviewer score \(1–5\): ____/);
  const receipt = JSON.parse(
    await readFile(join(result.outputDirectory, "run-receipt.json"), "utf8"),
  ) as Record<string, unknown>;
  assert.equal(receipt.vertical_slice, "02");
  assert.equal(receipt.engineering_status, "PASS");
  assert.equal(receipt.content_quality_status, review.evaluation.release_status);
});
