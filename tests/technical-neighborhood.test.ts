import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import {
  assessHumanNeighborhoodSelectionFreshness,
  buildConnectivityExploration,
  renderConnectivityExplorationMarkdown,
  type HumanNeighborhoodSelection,
} from "../src/exploration/technical-neighborhood.js";
import type {
  GroundedEntity,
  GroundedFact,
  GroundedFactPack,
} from "../src/facts/domain.js";
import { createSchemaRegistry } from "../src/schemas/registry.js";

const repository = {
  url: "https://github.com/example/connectivity-fixture",
  owner: "example",
  name: "connectivity-fixture",
} as const;
const commit = "a".repeat(40);

function entity(id: string, sourcePath: string): GroundedEntity {
  return {
    id,
    kind: id === "condition_x" ? "condition" : "symbol",
    display_label: id,
    source_path: sourcePath,
    ...(id === "condition_x" ? {} : { symbol: { name: id, kind: "function" } }),
    evidence_ids: [`evidence_${id}`],
  };
}

function moduleEntity(id: string, sourcePath: string): GroundedEntity {
  return {
    id,
    kind: "module",
    display_label: id,
    source_path: sourcePath,
    evidence_ids: [`evidence_${id}`],
  };
}

function fact(
  id: string,
  subject: string,
  predicate: GroundedFact["predicate"],
  object: string,
  overrides: Partial<GroundedFact> = {},
): GroundedFact {
  const evidenceId = `evidence_${id}`;
  return {
    id,
    fact_type: predicate === "CALLS" ? "CALL_RELATION" : "BRANCH_BEHAVIOR",
    category: predicate === "CALLS" ? "RELATION" : "BEHAVIORAL",
    subject_ref: subject,
    predicate,
    object_ref: object,
    scope: predicate === "CALLS" ? "MODULE" : "LOCAL",
    evidence_ids: [evidenceId],
    source_kind: "source_code",
    verification: { status: "verified", confidence: 1 },
    qualifiers: [],
    limitations:
      predicate === "CALLS"
        ? ["Direct static call only; runtime execution is not proven."]
        : ["Local branch only."],
    provenance: {
      repository: { url: repository.url, commit_sha: commit },
      extractor: predicate === "CALLS" ? "deterministic-evidence-to-fact-v2" : "deterministic-evidence-to-fact-v1",
      evidence_ids: [evidenceId],
    },
    ...overrides,
  };
}

function pack(
  entities: readonly GroundedEntity[],
  facts: readonly GroundedFact[],
): GroundedFactPack {
  return {
    fact_ir_version: 2,
    repository,
    commit,
    entities,
    facts,
    evidence_refs: facts.map((item) => ({
      id: item.evidence_ids[0] as string,
      evidence_type: item.fact_type === "CALL_RELATION" ? "direct_call" : "source_range",
      source_kind: "source_code",
      verification_status: "verified",
    })),
    unsupported_areas: [
      {
        id: "call_relation_dynamic_and_indirect",
        reason: "Dynamic and indirect calls are unresolved.",
        evidence_needed: "A separately reviewed resolver or runtime trace.",
      },
    ],
    limitations: ["Synthetic Canonical Fact fixture."],
  };
}

function richFixture(): GroundedFactPack {
  const entities = [
    entity("symbol_a", "src/a.ts"),
    entity("symbol_b", "src/b.ts"),
    entity("symbol_c", "src/c.ts"),
    entity("symbol_d", "src/d.ts"),
    entity("condition_x", "src/b.ts"),
    moduleEntity("module_a", "src/a.ts"),
    moduleEntity("module_b", "src/b.ts"),
  ];
  const facts = [
    fact("fact_call_a_b", "symbol_a", "CALLS", "symbol_b"),
    fact("fact_call_b_c", "symbol_b", "CALLS", "symbol_c"),
    fact("fact_call_d_b", "symbol_d", "CALLS", "symbol_b"),
    fact("fact_behavior_b_x", "symbol_b", "THROWS_WHEN", "condition_x"),
    fact("fact_structure_b", "module_b", "CONTAINS", "symbol_b", {
      fact_type: "MODULE_CONTAINS",
      category: "STRUCTURAL",
      scope: "MODULE",
    }),
    fact("fact_import_a_b", "module_a", "IMPORTS", "module_b", {
      fact_type: "IMPORT_RELATION",
      category: "RELATION",
      scope: "MODULE",
    }),
  ];
  return pack(entities, facts);
}

function richAndUtilityFixture(): GroundedFactPack {
  const rich = richFixture();
  const utility = entity("symbol_utility", "src/utility.ts");
  const callers = Array.from({ length: 20 }, (_, index) =>
    entity(`symbol_utility_caller_${String(index + 1).padStart(2, "0")}`, `src/caller-${index + 1}.ts`),
  );
  const utilityFacts = callers.map((caller, index) =>
    fact(
      `fact_utility_call_${String(index + 1).padStart(2, "0")}`,
      caller.id,
      "CALLS",
      utility.id,
    ),
  );
  return pack([...rich.entities, utility, ...callers], [...rich.facts, ...utilityFacts]);
}

test("A→B→C, D→B, and Behavior X form one bounded neutral TechnicalNeighborhood", () => {
  const result = buildConnectivityExploration({
    factPack: richFixture(),
    analyzerVersion: "bounded-direct-call-static-v1",
    factPackArtifact: {
      artifact_path: "tests/fixtures/connectivity/grounded-fact-pack.json",
      sha256: "1".repeat(64),
    },
  });

  assert.equal(result.connectivity_exploration_version, 1);
  assert.equal(result.neighborhoods.length, 1);
  const neighborhood = result.neighborhoods[0];
  assert.equal(neighborhood?.technical_neighborhood_version, 1);
  assert.deepEqual(neighborhood?.seed_entities, ["symbol_b"]);
  assert.deepEqual(neighborhood?.call_fact_refs, [
    "fact_call_a_b",
    "fact_call_b_c",
    "fact_call_d_b",
  ]);
  assert.deepEqual(neighborhood?.behavior_fact_refs, ["fact_behavior_b_x"]);
  assert.deepEqual(neighborhood?.relation_fact_refs, ["fact_import_a_b"]);
  assert.deepEqual(neighborhood?.structural_fact_refs, ["fact_structure_b"]);
  assert.equal(neighborhood?.direct_call_count, 3);
  assert.equal(neighborhood?.cross_module_edge_count, 3);
  assert.equal(neighborhood?.module_count, 4);
  assert.equal(neighborhood?.selection_reason.components.behavior_presence, 24);
  assert.equal(neighborhood?.selection_reason.components.grounded_context_presence, 30);
  assert.equal(neighborhood?.selection_reason.kind, "CONNECTIVITY_HEURISTIC_NOT_EDITORIAL_SCORE");
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    "editorial_thesis",
    "why_interesting",
    "content_potential",
    "viral_score",
    "best angle",
    "pipeline",
  ]) {
    assert.equal(serialized.toLowerCase().includes(forbidden), false);
  }
});

test("isolated Schema and cross-commit Facts are excluded, while reversed input stays byte-stable", () => {
  const base = richFixture();
  const schemaModule = moduleEntity("module_schema", "schemas/isolated.schema.json");
  const schemaEntity = {
    ...entity("schema_isolated", "schemas/isolated.schema.json"),
    kind: "config_field" as const,
  };
  const isolatedSchema = fact(
    "fact_isolated_schema",
    schemaModule.id,
    "DECLARES_TYPE",
    schemaEntity.id,
    {
      fact_type: "TYPE_DECLARATION",
      category: "TYPE",
      scope: "MODULE",
      source_kind: "configuration",
    },
  );
  const crossLeft = entity("cross_left", "src/cross-left.ts");
  const crossRight = entity("cross_right", "src/cross-right.ts");
  const crossCommitCall = fact("fact_cross_commit", crossLeft.id, "CALLS", crossRight.id, {
    provenance: {
      repository: { url: repository.url, commit_sha: "b".repeat(40) },
      extractor: "deterministic-evidence-to-fact-v2",
      evidence_ids: ["evidence_fact_cross_commit"],
    },
  });
  const expanded = pack(
    [...base.entities, schemaModule, schemaEntity, crossLeft, crossRight],
    [...base.facts, isolatedSchema, crossCommitCall],
  );
  const input = {
    analyzerVersion: "bounded-direct-call-static-v1",
    factPackArtifact: {
      artifact_path: "tests/fixtures/connectivity/grounded-fact-pack.json",
      sha256: "3".repeat(64),
    },
  } as const;
  const forward = buildConnectivityExploration({ factPack: expanded, ...input });
  const reversed = buildConnectivityExploration({
    factPack: {
      ...expanded,
      entities: [...expanded.entities].reverse(),
      facts: [...expanded.facts].reverse(),
      evidence_refs: [...expanded.evidence_refs].reverse(),
    },
    ...input,
  });

  assert.deepEqual(reversed, forward);
  assert.ok(forward.neighborhoods.length <= 5);
  assert.ok(forward.neighborhoods.every((item) => item.fact_refs.length <= 20));
  assert.ok(
    forward.neighborhoods.every(
      (item) =>
        !item.fact_refs.includes("fact_isolated_schema") &&
        !item.fact_refs.includes("fact_cross_commit"),
    ),
  );
  assert.equal(forward.connectivity_policy.unresolved_calls_used, 0);
});

test("a high-degree utility without behavior or relation diversity does not outrank a richer neighborhood", () => {
  const result = buildConnectivityExploration({
    factPack: richAndUtilityFixture(),
    analyzerVersion: "bounded-direct-call-static-v1",
    factPackArtifact: {
      artifact_path: "tests/fixtures/connectivity/grounded-fact-pack.json",
      sha256: "2".repeat(64),
    },
  });

  assert.ok(result.neighborhoods.length >= 2);
  assert.deepEqual(result.neighborhoods[0]?.seed_entities, ["symbol_b"]);
  const utility = result.neighborhoods.find((item) =>
    item.seed_entities.includes("symbol_utility"),
  );
  assert.ok(utility !== undefined);
  assert.equal(utility.behavior_fact_count, 0);
  assert.equal(utility.relation_diversity.length, 1);
  assert.equal(utility.selection_reason.components.utility_hotspot_penalty, -25);
  assert.ok(
    (result.neighborhoods[0]?.selection_reason.connectivity_score ?? 0) >
      utility.selection_reason.connectivity_score,
  );
});

test("TechnicalNeighborhood and future HumanNeighborhoodSelection contracts validate and fail stale across commits", () => {
  const schemas = createSchemaRegistry(resolve(process.cwd(), "schemas"));
  const exploration = buildConnectivityExploration({
    factPack: richFixture(),
    analyzerVersion: "bounded-direct-call-static-v1",
    factPackArtifact: {
      artifact_path: "tests/fixtures/connectivity/grounded-fact-pack.json",
      sha256: "4".repeat(64),
    },
  });
  schemas.assert("ConnectivityExploration", exploration);
  const neighborhood = exploration.neighborhoods[0];
  assert.ok(neighborhood !== undefined);
  const selection: HumanNeighborhoodSelection = {
    human_neighborhood_selection_version: 1,
    status: "VALID",
    repository,
    commit,
    fact_ir_version: 2,
    neighborhood_version: 1,
    neighborhood_id: neighborhood.neighborhood_id,
    neighborhood_fingerprint_sha256: neighborhood.neighborhood_fingerprint_sha256,
    connectivity_exploration_fingerprint_sha256:
      exploration.exploration_fingerprint_sha256,
    human_selected: true,
    timestamp: "2026-09-02T00:00:00.000Z",
    decision_context: "OFFLINE_FIXTURE",
    authorization: {
      neighborhood_editorial_context_generation_required: true,
      real_model_authorized: false,
      script_authorized: false,
    },
    selection_fingerprint_sha256: "5".repeat(64),
    generation_metadata: {
      mode: "human_neighborhood_selection",
      paid_api_requests: 0,
      real_model_requests: 0,
      secret_reads: 0,
      repository_executions: 0,
    },
  };
  schemas.assert("HumanNeighborhoodSelection", selection);
  assert.deepEqual(
    assessHumanNeighborhoodSelectionFreshness(selection, exploration),
    { state: "CURRENT", reason_codes: [], editorial_context_eligible: true },
  );
  assert.deepEqual(
    assessHumanNeighborhoodSelectionFreshness(
      { ...selection, commit: "b".repeat(40) },
      exploration,
    ),
    {
      state: "STALE",
      reason_codes: ["COMMIT_CHANGED"],
      editorial_context_eligible: false,
    },
  );
});

test("Human preview shows grounded connections and a future Explore action without recommendation language", () => {
  const exploration = buildConnectivityExploration({
    factPack: richFixture(),
    analyzerVersion: "bounded-direct-call-static-v1",
    factPackArtifact: {
      artifact_path: "tests/fixtures/connectivity/grounded-fact-pack.json",
      sha256: "6".repeat(64),
    },
  });
  const markdown = renderConnectivityExplorationMarkdown(exploration);

  for (const required of [
    "Technical Neighborhood 01",
    "Seed: symbol_b",
    "symbol_a CALLS symbol_b [CROSS-MODULE]",
    "STATIC CALL PATH",
    "Future action: `Explore neighborhood_",
    "No Neighborhood is selected by this Artifact",
  ]) {
    assert.ok(markdown.includes(required), `missing preview text: ${required}`);
  }
  for (const forbidden of [
    "Recommended Neighborhood",
    "best angle",
    "most innovative",
    "content potential",
  ]) {
    assert.equal(markdown.toLowerCase().includes(forbidden.toLowerCase()), false);
  }
});

test("invalid Fact limits and a two-entity repeated-call pair cannot create a schema-invalid neighborhood", () => {
  const base = richFixture();
  assert.throws(
    () =>
      buildConnectivityExploration({
        factPack: base,
        analyzerVersion: "bounded-direct-call-static-v1",
        factPackArtifact: {
          artifact_path: "tests/fixtures/connectivity/grounded-fact-pack.json",
          sha256: "7".repeat(64),
        },
        maximumFactsPerNeighborhood: 1,
      }),
    /CONNECTIVITY_FACT_LIMIT_INVALID/,
  );

  const left = entity("symbol_left", "src/left.ts");
  const right = entity("symbol_right", "src/right.ts");
  const repeatedPair = pack(
    [left, right],
    [
      fact("fact_call_left_right_1", left.id, "CALLS", right.id),
      fact("fact_call_left_right_2", left.id, "CALLS", right.id),
    ],
  );
  const result = buildConnectivityExploration({
    factPack: repeatedPair,
    analyzerVersion: "bounded-direct-call-static-v1",
    factPackArtifact: {
      artifact_path: "tests/fixtures/connectivity/grounded-fact-pack.json",
      sha256: "8".repeat(64),
    },
  });
  assert.equal(result.status, "NO_TECHNICAL_NEIGHBORHOOD");
  assert.deepEqual(result.neighborhoods, []);
});
