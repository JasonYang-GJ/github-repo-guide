import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import {
  MAXIMUM_DIRECT_CALL_EVIDENCE,
  buildCodebaseBrief,
  selectBoundedDirectCalls,
} from "../src/analysis/brief-builder.js";
import {
  extractStaticFacts,
  type StaticDirectCall,
} from "../src/analysis/static-facts.js";
import { buildAngleRefinementFactCoverage } from "../src/content/angle-refinement.js";
import { buildGroundedFactPack } from "../src/facts/grounded-fact-pack.js";
import { readRepository } from "../src/repo/progressive-reader.js";
import { createSchemaRegistry } from "../src/schemas/registry.js";
import { FixtureRepositorySource } from "./support/fixture-repository-source.js";

const root = process.cwd();
const generatedAt = "2026-09-02T00:00:00.000Z";

async function buildCallFixture() {
  const source = new FixtureRepositorySource(
    resolve(root, "tests", "fixtures", "bounded-call-repo"),
    "bounded-call-repo",
  );
  const snapshot = await readRepository(source, source.url);
  const facts = extractStaticFacts(snapshot);
  const build = buildCodebaseBrief(
    snapshot,
    facts,
    {
      oneSentence: "Bounded direct-call fixture.",
      summary: "Bounded direct-call fixture.",
      problem: "",
      targetUsers: [],
    },
    generatedAt,
  );
  return { source, snapshot, facts, build };
}

test("DIRECT_CALL Evidence binds caller, callee, call site, import binding, repository, and commit", async () => {
  const { source, snapshot, build } = await buildCallFixture();
  const schemas = createSchemaRegistry(resolve(root, "schemas"));
  const calls = build.evidence.filter((record) => record.evidence_type === "direct_call");

  assert.equal(calls.length, 10);
  for (const record of calls) {
    schemas.assert("EvidenceRecord", record);
    assert.equal(record.evidence_record_version, 2);
    assert.equal(record.repository?.url, source.url);
    assert.equal(record.repository?.commit_sha, snapshot.repository.commitSha);
    assert.equal(record.verification.method, "ast_call_expression");
    assert.equal(record.call_relation?.relation, "CALLS");
    assert.equal(record.call_relation?.direct, true);
    assert.equal(record.call_relation?.runtime_execution_guaranteed, false);
    assert.equal(record.call_relation?.caller.source_path, record.locator?.source_path);
    assert.ok((record.call_relation?.call_site.line_start ?? 0) >= 1);
    assert.ok((record.call_relation?.callee.symbol.name.length ?? 0) > 0);
  }

  const named = calls.find(
    (record) =>
      record.call_relation?.caller.symbol.name === "run" &&
      record.call_relation.callee.symbol.name === "work",
  );
  assert.equal(named?.call_relation?.import_binding?.kind, "named");
  assert.equal(named?.call_relation?.resolution_method, "RELATIVE_NAMED_IMPORT");
  const reexported = calls.find(
    (record) => record.call_relation?.resolution_method === "RELATIVE_NAMED_REEXPORT",
  );
  assert.equal(
    reexported?.call_relation?.import_binding?.reexport_hop?.declaration_path,
    "src/barrel.ts",
  );
  assert.equal(
    reexported?.call_relation?.import_binding?.reexport_hop?.exported_name,
    "barrelWork",
  );
  assert.equal(
    reexported?.call_relation?.import_binding?.reexport_hop?.imported_name,
    "reexportedWork",
  );
});

test("DIRECT_CALL Evidence becomes local or module-scoped CALL_RELATION Fact IR v2", async () => {
  const { build } = await buildCallFixture();
  const schemas = createSchemaRegistry(resolve(root, "schemas"));
  const pack = buildGroundedFactPack({ brief: build.brief, evidence: build.evidence });
  const calls = pack.facts.filter((fact) => fact.fact_type === "CALL_RELATION");

  schemas.assert("GroundedFactPack", pack);
  assert.equal(pack.fact_ir_version, 2);
  assert.equal(calls.length, 10);
  assert.ok(calls.every((fact) => fact.predicate === "CALLS"));
  assert.ok(
    calls.some(
      (fact) =>
        fact.scope === "LOCAL" &&
        pack.entities.find((entity) => entity.id === fact.subject_ref)?.display_label === "run" &&
        pack.entities.find((entity) => entity.id === fact.object_ref)?.display_label === "prepare",
    ),
  );
  assert.ok(
    calls.some(
      (fact) =>
        fact.scope === "MODULE" &&
        pack.entities.find((entity) => entity.id === fact.object_ref)?.display_label === "work",
    ),
  );
  assert.ok(
    calls.every((fact) =>
      fact.evidence_ids.every(
        (id) => pack.evidence_refs.find((record) => record.id === id)?.evidence_type === "direct_call",
      ),
    ),
  );
});

test("CALL_RELATION extraction is deterministic and rejects cross-commit Evidence", async () => {
  const { snapshot, facts, build } = await buildCallFixture();
  const reversedSourceFacts = extractStaticFacts({
    ...snapshot,
    files: [...snapshot.files].reverse(),
  });
  assert.deepEqual(reversedSourceFacts.directCalls, facts.directCalls);
  assert.deepEqual(reversedSourceFacts.unresolvedCalls, facts.unresolvedCalls);
  const forward = buildGroundedFactPack({ brief: build.brief, evidence: build.evidence });
  const reversed = buildGroundedFactPack({
    brief: build.brief,
    evidence: [...build.evidence].reverse(),
  });
  assert.deepEqual(reversed, forward);

  const crossCommitEvidence = build.evidence.map((record) =>
    record.evidence_type === "direct_call"
      ? {
          ...record,
          repository: {
            url: record.repository?.url ?? snapshot.repository.url,
            commit_sha: "f".repeat(40),
          },
        }
      : record,
  );
  const crossCommit = buildGroundedFactPack({
    brief: build.brief,
    evidence: crossCommitEvidence,
  });
  assert.equal(
    crossCommit.facts.filter((fact) => fact.fact_type === "CALL_RELATION").length,
    0,
  );
});

test("bounded call selection is deterministic and does not let one large file starve cross-module calls", async () => {
  const { facts } = await buildCallFixture();
  const template = facts.directCalls[0] as StaticDirectCall;
  const localCalls = Array.from({ length: MAXIMUM_DIRECT_CALL_EVIDENCE + 20 }, (_, index) => ({
    ...template,
    callerPath: "src/aaa-large.ts",
    calleePath: "src/aaa-large.ts",
    callerSymbol: `local${index}`,
    calleeSymbol: `helper${index}`,
    sourceOrder: index + 1,
  }));
  const crossCalls = Array.from({ length: 5 }, (_, index) => ({
    ...template,
    callerPath: `src/z${index}-caller.ts`,
    calleePath: `src/z${index}-callee.ts`,
    callerSymbol: `cross${index}`,
    calleeSymbol: `target${index}`,
    sourceOrder: index + 1,
  }));
  const calls = [...localCalls, ...crossCalls];

  const selected = selectBoundedDirectCalls(calls);
  const reversed = selectBoundedDirectCalls([...calls].reverse());

  assert.equal(selected.length, MAXIMUM_DIRECT_CALL_EVIDENCE);
  assert.deepEqual(reversed, selected);
  assert.deepEqual(
    selected.filter((call) => call.callerPath !== call.calleePath),
    crossCalls,
  );
});

test("CALL_RELATION Facts are discoverable by the offline refinement graph without rebinding approval", async () => {
  const { build } = await buildCallFixture();
  const pack = buildGroundedFactPack({ brief: build.brief, evidence: build.evidence });
  const runDeclaration = pack.facts.find(
    (fact) =>
      fact.fact_type === "DECLARATION" &&
      pack.entities.find((entity) => entity.id === fact.object_ref)?.display_label === "run",
  );
  assert.ok(runDeclaration !== undefined);

  const coverage = buildAngleRefinementFactCoverage({
    factPack: pack,
    base_fact_ids: [runDeclaration.id],
  });
  assert.equal(coverage.fact_ir_version, 2);
  assert.equal(coverage.approval_rebound, false);
  assert.ok(
    coverage.related_fact_options.some(
      (option) =>
        option.fact_type === "CALL_RELATION" &&
        option.predicate === "CALLS" &&
        option.relation_distance === "DIRECT",
    ),
  );
});
