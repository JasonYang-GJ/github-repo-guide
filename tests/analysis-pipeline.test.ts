import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import {
  analyzeSnapshot,
  type AnalysisBundle,
} from "../src/analysis/pipeline.js";
import { DeterministicModelProvider } from "../src/model/deterministic-provider.js";
import { evaluateQualityGate } from "../src/quality/gates.js";
import { readRepository } from "../src/repo/progressive-reader.js";
import { createSchemaRegistry } from "../src/schemas/registry.js";
import { FixtureRepositorySource } from "./support/fixture-repository-source.js";

const root = process.cwd();
const fixturesRoot = resolve(root, "tests", "fixtures");
const schemas = createSchemaRegistry(resolve(root, "schemas"));

async function fixtureBundle(name: string): Promise<{
  bundle: AnalysisBundle;
  source: FixtureRepositorySource;
}> {
  const source = new FixtureRepositorySource(resolve(fixturesRoot, name), name);
  const snapshot = await readRepository(source, source.url);
  const bundle = await analyzeSnapshot(snapshot, {
    provider: new DeterministicModelProvider(),
    schemas,
    generatedAt: "2026-08-31T00:00:00.000Z",
    networkHosts: [],
  });
  return { bundle, source };
}

test("full local fixture produces a schema-valid grounded analysis bundle", async () => {
  const { bundle, source } = await fixtureBundle("multi-module-typescript-repo");
  const claimIds = new Set(bundle.brief.claims.map((claim) => claim.id));
  const evidenceIds = new Set(bundle.evidence.map((evidence) => evidence.id));

  assert.equal(schemas.validate("CodebaseBrief", bundle.brief).valid, true);
  assert.ok(bundle.evidence.every((record) => schemas.validate("EvidenceRecord", record).valid));
  assert.ok(bundle.angles.every((angle) => schemas.validate("ContentAngle", angle).valid));
  assert.equal(bundle.brief.repository.commit_sha, source.commitSha);
  assert.equal(bundle.brief.relationships.length, 4);
  assert.equal(
    bundle.brief.relationships.filter((relationship) => relationship.relationship_type === "calls")
      .length,
    1,
  );
  assert.ok(bundle.brief.core_modules.length >= 4);
  assert.ok(bundle.angles.length >= 1 && bundle.angles.length <= 2);
  assert.ok(bundle.angles.every((angle) => angle.claim_ids.every((id) => claimIds.has(id))));
  assert.ok(bundle.angles.every((angle) => angle.evidence_ids.every((id) => evidenceIds.has(id))));
  assert.match(bundle.mermaid, /^flowchart LR/m);
  assert.equal(bundle.script.repository_commit_sha, source.commitSha);
  assert.ok(bundle.script.estimated_seconds >= 60 && bundle.script.estimated_seconds <= 90);
  assert.equal(bundle.quality.passed, true);
  assert.equal(bundle.quality.gates.length, 11);
  assert.equal(bundle.provider_invocations.length, 3);
  assert.ok(bundle.provider_invocations.every((invocation) => invocation.network_calls === 0));
  assert.ok(bundle.provider_invocations.every((invocation) => invocation.paid === false));
});

test("nested application uses the root README product identity in Chinese", async () => {
  const { bundle } = await fixtureBundle("nested-desktop-notes");

  assert.equal(bundle.brief.overview.project_name, "桌面笔记（Desktop Notes）");
  assert.match(bundle.brief.overview.one_sentence, /面向 Windows 的本地优先日历笔记应用/);
  assert.match(bundle.brief.overview.summary, /本次代码级分析覆盖/);
  assert.equal(
    bundle.brief.core_modules.some((module) => /\.(?:test|spec)\./i.test(module.name)),
    false,
  );
  assert.match(bundle.angles[0]?.title ?? "", /[\u3400-\u9fff]/);
  const purposeEvidence = bundle.evidence.find(
    (record) => record.id === "evidence_project_purpose",
  );
  assert.equal(purposeEvidence?.source_kind, "documentation");
  assert.equal(purposeEvidence?.locator?.source_path, "README.md");
  assert.equal(purposeEvidence?.verification_status, "documentation");
  assert.equal(bundle.quality.passed, true);
});

test("every verified claim has commit-bound evidence at a real fixture path", async () => {
  const { bundle, source } = await fixtureBundle("small-typescript-repo");
  const treePaths = new Set(bundle.snapshot_summary.tree_paths);
  const evidenceById = new Map(bundle.evidence.map((record) => [record.id, record]));

  for (const claim of bundle.brief.claims.filter((candidate) => candidate.status === "verified")) {
    assert.ok(claim.evidence_ids.length > 0);
    for (const evidenceId of claim.evidence_ids) {
      const evidence = evidenceById.get(evidenceId);
      assert.equal(evidence?.repository?.commit_sha, source.commitSha);
      assert.equal(treePaths.has(evidence?.locator?.source_path ?? ""), true);
    }
  }
});

test("package exports and ESM entries retain exact manifest evidence", async () => {
  const { bundle } = await fixtureBundle("small-typescript-repo");
  const evidenceById = new Map(bundle.evidence.map((record) => [record.id, record]));
  const packageExport = bundle.brief.claims.find(
    (claim) => claim.statement === 'package.json declares export ".".',
  );
  const esmEntry = bundle.brief.claims.find(
    (claim) => claim.statement === 'package.json declares ESM entry "dist/index.js".',
  );

  assert.equal(packageExport?.status, "verified");
  assert.equal(esmEntry?.status, "verified");
  assert.equal(
    evidenceById.get(packageExport?.evidence_ids[0] ?? "")?.locator?.field_pointer,
    "/exports/.",
  );
  assert.equal(
    evidenceById.get(esmEntry?.evidence_ids[0] ?? "")?.locator?.field_pointer,
    "/module",
  );
  assert.equal(bundle.quality.passed, true);
});

test("malicious repository instructions remain inert data through the full pipeline", async () => {
  const { bundle, source } = await fixtureBundle("malicious-prompt-repo");

  assert.equal(bundle.security.repository_content_role, "untrusted_data");
  assert.equal(bundle.security.repository_code_executions, 0);
  assert.deepEqual(bundle.security.network_hosts, []);
  assert.equal(bundle.security.provider_id, "deterministic");
  assert.equal(source.operations.some((operation) => operation.includes("attacker.invalid")), false);
  assert.equal(bundle.quality.passed, true);
});

test("quality gate rejects dangling relationships and missing evidence paths", async () => {
  const { bundle } = await fixtureBundle("small-typescript-repo");
  const dangling: AnalysisBundle = {
    ...bundle,
    brief: {
      ...bundle.brief,
      relationships: [
        ...bundle.brief.relationships,
        {
          id: "relationship_dangling",
          from_module_id: bundle.brief.core_modules[0]?.id ?? "module_missing",
          to_module_id: "module_missing",
          relationship_type: "imports",
          description: "Invalid test relationship",
          status: "verified",
          confidence: 1,
          evidence_ids: [bundle.evidence[0]?.id ?? "evidence_missing"],
        },
      ],
    },
  };
  const danglingReceipt = evaluateQualityGate(dangling, bundle.snapshot_summary, schemas);
  assert.equal(danglingReceipt.passed, false);
  assert.equal(danglingReceipt.gates.some((gate) => gate.id === "relationship_nodes" && !gate.passed), true);

  const firstEvidence = bundle.evidence[0];
  assert.ok(firstEvidence?.locator !== undefined);
  const badEvidence = {
    ...firstEvidence,
    locator: { ...firstEvidence.locator, source_path: "src/does-not-exist.ts" },
  };
  const missingPath: AnalysisBundle = {
    ...bundle,
    evidence: bundle.evidence.map((record, index) => (index === 0 ? badEvidence : record)),
    brief: {
      ...bundle.brief,
      evidence: bundle.brief.evidence.map((record, index) =>
        index === 0 ? badEvidence : record,
      ),
    },
  };
  const evidenceReceipt = evaluateQualityGate(missingPath, bundle.snapshot_summary, schemas);
  assert.equal(evidenceReceipt.passed, false);
  assert.equal(evidenceReceipt.gates.some((gate) => gate.id === "evidence_paths" && !gate.passed), true);
});

test("quality gate rejects unsupported claims, angles, diagrams, and instruction drift", async () => {
  const { bundle } = await fixtureBundle("small-typescript-repo");
  const firstVerifiedClaim = bundle.brief.claims.find((claim) => claim.status === "verified");
  const firstAngle = bundle.angles[0];
  assert.ok(firstVerifiedClaim !== undefined);
  assert.ok(firstAngle !== undefined);

  const unsupportedClaim: AnalysisBundle = {
    ...bundle,
    brief: {
      ...bundle.brief,
      claims: bundle.brief.claims.map((claim) =>
        claim.id === firstVerifiedClaim.id ? { ...claim, evidence_ids: [] } : claim,
      ),
    },
  };
  const claimReceipt = evaluateQualityGate(unsupportedClaim, bundle.snapshot_summary, schemas);
  assert.equal(
    claimReceipt.gates.some((gate) => gate.id === "verified_claims" && !gate.passed),
    true,
  );

  const unsupportedAngle: AnalysisBundle = {
    ...bundle,
    angles: [{ ...firstAngle, evidence_ids: ["evidence_missing"] }],
  };
  const angleReceipt = evaluateQualityGate(unsupportedAngle, bundle.snapshot_summary, schemas);
  assert.equal(
    angleReceipt.gates.some((gate) => gate.id === "angle_references" && !gate.passed),
    true,
  );

  const alteredDiagram: AnalysisBundle = {
    ...bundle,
    mermaid: `${bundle.mermaid}    module_fake --> module_fake\n`,
  };
  const diagramReceipt = evaluateQualityGate(alteredDiagram, bundle.snapshot_summary, schemas);
  assert.equal(
    diagramReceipt.gates.some((gate) => gate.id === "mermaid_grounding" && !gate.passed),
    true,
  );

  const instructionDrift: AnalysisBundle = {
    ...bundle,
    security: {
      ...bundle.security,
      repository_code_executions: 1 as 0,
      network_hosts: ["attacker.invalid"],
    },
  };
  const isolationReceipt = evaluateQualityGate(
    instructionDrift,
    bundle.snapshot_summary,
    schemas,
  );
  assert.equal(
    isolationReceipt.gates.some((gate) => gate.id === "instruction_isolation" && !gate.passed),
    true,
  );
});

test("quality gate rejects confidence escalation, new script facts, and SHA drift", async () => {
  const { bundle } = await fixtureBundle("small-typescript-repo");
  const firstAngle = bundle.angles[0];
  assert.ok(firstAngle !== undefined);

  const escalated: AnalysisBundle = {
    ...bundle,
    brief: {
      ...bundle.brief,
      claims: bundle.brief.claims.map((claim) =>
        claim.id === firstAngle.claim_ids[0] ? { ...claim, confidence: 0.4 } : claim,
      ),
    },
    angles: [
      { ...firstAngle, confidence: 1 },
      ...bundle.angles.slice(1),
    ],
  };
  const escalationReceipt = evaluateQualityGate(escalated, bundle.snapshot_summary, schemas);
  assert.equal(escalationReceipt.passed, false);
  assert.equal(
    escalationReceipt.gates.some(
      (gate) => gate.id === "confidence_escalation" && !gate.passed,
    ),
    true,
  );

  const ungrounded: AnalysisBundle = {
    ...bundle,
    script: {
      ...bundle.script,
      text: `${bundle.script.text}\n它还使用 PostgreSQL 数据库。`,
      segments: [
        ...bundle.script.segments,
        {
          id: "segment_ungrounded",
          kind: "claim",
          text: "它还使用 PostgreSQL 数据库。",
          claim_ids: [firstAngle.claim_ids[0] ?? "claim_missing"],
          evidence_ids: [firstAngle.evidence_ids[0] ?? "evidence_missing"],
          asserted_entities: ["PostgreSQL"],
        },
      ],
    },
  };
  const groundingReceipt = evaluateQualityGate(ungrounded, bundle.snapshot_summary, schemas);
  assert.equal(groundingReceipt.passed, false);
  assert.equal(
    groundingReceipt.gates.some((gate) => gate.id === "script_grounding" && !gate.passed),
    true,
  );

  const drifted: AnalysisBundle = {
    ...bundle,
    script: { ...bundle.script, repository_commit_sha: "f".repeat(40) },
  };
  const bindingReceipt = evaluateQualityGate(drifted, bundle.snapshot_summary, schemas);
  assert.equal(bindingReceipt.passed, false);
  assert.equal(bindingReceipt.gates.some((gate) => gate.id === "output_binding" && !gate.passed), true);
});

test("claim semantics gate rejects an overclaim even when its evidence record repeats it", async () => {
  const { bundle } = await fixtureBundle("small-typescript-repo");
  const originalClaim = bundle.brief.claims.find((claim) => claim.status === "verified");
  assert.ok(originalClaim !== undefined);
  const statement = "The project improves developer efficiency.";
  const evidenceIds = new Set(originalClaim.evidence_ids);
  const replaceEvidenceClaim = (record: AnalysisBundle["evidence"][number]) =>
    evidenceIds.has(record.id) ? { ...record, claim: statement } : record;
  const overclaimed: AnalysisBundle = {
    ...bundle,
    evidence: bundle.evidence.map(replaceEvidenceClaim),
    brief: {
      ...bundle.brief,
      claims: bundle.brief.claims.map((claim) =>
        claim.id === originalClaim.id ? { ...claim, statement } : claim,
      ),
      evidence: bundle.brief.evidence.map(replaceEvidenceClaim),
    },
  };

  const receipt = evaluateQualityGate(overclaimed, bundle.snapshot_summary, schemas);

  assert.equal(
    receipt.gates.some((gate) => gate.id === "verified_claims" && gate.passed),
    true,
  );
  assert.equal(
    receipt.gates.some((gate) => gate.id === "claim_semantics" && !gate.passed),
    true,
  );
});
