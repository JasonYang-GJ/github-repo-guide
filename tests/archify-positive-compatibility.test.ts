import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { buildCodebaseBrief } from "../src/analysis/brief-builder.js";
import { buildSnapshotSummary } from "../src/analysis/pipeline.js";
import { extractStaticFacts } from "../src/analysis/static-facts.js";
import { freezeCanonicalGroundedBrief } from "../src/brief/canonical.js";
import { buildGroundedFactPack } from "../src/facts/grounded-fact-pack.js";
import { evaluateBriefQualityGate } from "../src/quality/gates.js";
import { readRepository } from "../src/repo/progressive-reader.js";
import { createSchemaRegistry } from "../src/schemas/registry.js";
import { FixtureRepositorySource } from "./support/fixture-repository-source.js";

const root = process.cwd();
const fixtureRoot = resolve(root, "tests", "fixtures", "nested-esm-schema-repo");

async function nestedSnapshot() {
  const source = new FixtureRepositorySource(fixtureRoot, "nested-esm-schema-repo");
  return readRepository(source, source.url);
}

test("progressive reader selects one shallow nested npm package and its ESM/schema surface", async () => {
  const snapshot = await nestedSnapshot();
  const paths = snapshot.files.map((file) => file.path);

  assert.equal(snapshot.manifest.manifestPath, "tool/package.json");
  assert.equal(snapshot.manifest.packageRoot, "tool");
  assert.equal(snapshot.manifest.name, "nested-esm-tool");
  assert.ok(paths.includes("README.md"));
  assert.ok(paths.includes("LICENSE"));
  assert.ok(paths.includes("tool/bin/tool.mjs"));
  assert.ok(paths.includes("tool/renderers/render.mjs"));
  assert.ok(paths.includes("tool/shared/validator.mjs"));
  assert.ok(paths.includes("tool/schemas/architecture.schema.json"));
  assert.equal(paths.includes("integrations/other/package.json"), false);
  assert.equal(
    snapshot.files.find((file) => file.path.endsWith("architecture.schema.json"))?.kind,
    "schema",
  );
});

test("ESM static facts preserve declarations, relative imports, schemas, and direct throw branches", async () => {
  const facts = extractStaticFacts(await nestedSnapshot());

  assert.ok(
    facts.symbols.some(
      (symbol) =>
        symbol.path === "tool/shared/validator.mjs" && symbol.name === "validateInput",
    ),
  );
  assert.deepEqual(
    facts.relationships.map((relationship) => [relationship.fromPath, relationship.toPath]),
    [
      ["tool/bin/tool.mjs", "tool/renderers/render.mjs"],
      ["tool/renderers/render.mjs", "tool/shared/validator.mjs"],
    ],
  );
  assert.deepEqual(
    facts.schemas.map((schema) => ({
      path: schema.path,
      title: schema.title,
      rootType: schema.rootType,
      required: schema.requiredProperties,
    })),
    [
      {
        path: "tool/schemas/architecture.schema.json",
        title: "Architecture",
        rootType: "object",
        required: ["name"],
      },
    ],
  );
  assert.ok(
    facts.branchBehaviors.some(
      (branch) =>
        branch.path === "tool/shared/validator.mjs" &&
        branch.ownerSymbol === "validateInput" &&
        branch.action === "throw" &&
        branch.condition === "!input",
    ),
  );
});

test("nested ESM/schema CodebaseBrief passes exact Evidence and claim-semantic gates", async () => {
  const snapshot = await nestedSnapshot();
  const facts = extractStaticFacts(snapshot);
  const built = buildCodebaseBrief(
    snapshot,
    facts,
    {
      oneSentence: snapshot.manifest.description ?? snapshot.manifest.name,
      summary: "Host-generated static summary.",
      problem: "",
      targetUsers: [],
    },
    "2026-09-01T00:00:00.000Z",
  );
  const receipt = evaluateBriefQualityGate(
    built.brief,
    built.evidence,
    buildSnapshotSummary(snapshot),
    createSchemaRegistry(resolve(root, "schemas")),
  );

  assert.equal(
    receipt.passed,
    true,
    receipt.gates.filter((gate) => !gate.passed).map((gate) => gate.details).join("; "),
  );
});

test("nested ESM/schema facts pass the unchanged deterministic canonical truth gates", async () => {
  const snapshot = await nestedSnapshot();
  const staticFacts = extractStaticFacts(snapshot);
  const result = buildCodebaseBrief(
    snapshot,
    staticFacts,
    {
      oneSentence: snapshot.manifest.description ?? snapshot.manifest.name,
      summary: "Host-generated static summary.",
      problem: "",
      targetUsers: [],
    },
    "2026-09-01T00:00:00.000Z",
  );
  const pack = buildGroundedFactPack({ brief: result.brief, evidence: result.evidence });
  const categories = new Set(pack.facts.map((fact) => fact.category));

  for (const category of ["STRUCTURAL", "RELATION", "BEHAVIORAL", "CONFIGURATION", "TYPE"] as const) {
    assert.equal(categories.has(category), true, `missing ${category}`);
  }
  assert.ok(
    pack.facts.some(
      (fact) => fact.fact_type === "BRANCH_BEHAVIOR" && fact.predicate === "THROWS_WHEN",
    ),
  );
  assert.ok(
    pack.facts.some(
      (fact) =>
        fact.fact_type === "TYPE_DECLARATION" &&
        pack.entities.find((entity) => entity.id === fact.object_ref)?.source_path?.endsWith(
          "architecture.schema.json",
        ),
    ),
  );

  const canonical = freezeCanonicalGroundedBrief(
    pack,
    createSchemaRegistry(resolve(root, "schemas")),
  );
  assert.equal(canonical.artifact.status, "ACCEPTED");
  assert.equal(canonical.artifact.generation_mode, "deterministic");
  assert.equal(canonical.assessment.verdicts.technical_utility, "PASS");
  assert.equal(canonical.assessment.verdicts.declaration_dump_check, "PASS");
});
