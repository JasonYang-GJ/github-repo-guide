import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { buildEditorialFactClusters } from "../src/content/editorial-fact-clusters.js";
import type { GroundedFact, GroundedFactPack } from "../src/facts/domain.js";

const fixture = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "tests", "fixtures", "positive-multi-fact-pipeline.json"),
    "utf8",
  ),
) as GroundedFactPack;

function fact(factId: string): GroundedFact {
  const found = fixture.facts.find((candidate) => candidate.id === factId);
  assert.ok(found);
  return found;
}

function withFacts(...facts: readonly GroundedFact[]): GroundedFactPack {
  return {
    ...fixture,
    facts: [...fixture.facts, ...facts],
  };
}

test("positive multi-fact pipeline relations are presented as one neutral deterministic cluster", () => {
  const result = buildEditorialFactClusters(fixture);

  assert.equal(result.editorial_fact_cluster_set_version, 1);
  assert.equal(result.source_fact_count, 5);
  assert.equal(result.clusters.length, 1);
  assert.deepEqual(result.clusters[0], {
    cluster_id: "cluster_001",
    fact_ids: [
      "fact_renderer_imports_validator",
      "fact_validator_imports_producer",
    ],
    shared_entities: [
      {
        entity_ref: "entity_module_validator",
        label: "src/validator.ts",
      },
    ],
    relation_paths: [
      {
        fact_id: "fact_renderer_imports_validator",
        from_entity_ref: "entity_module_renderer",
        predicate: "IMPORTS",
        to_entity_ref: "entity_module_validator",
      },
      {
        fact_id: "fact_validator_imports_producer",
        from_entity_ref: "entity_module_validator",
        predicate: "IMPORTS",
        to_entity_ref: "entity_module_producer",
      },
    ],
    fact_categories: ["RELATION"],
    cluster_reason: "RELATION_COMPONENT",
  });
  assert.deepEqual(result.unclustered_fact_ids, [
    "fact_producer_declares_create",
    "fact_renderer_declares_render",
    "fact_validator_declares_validate",
  ]);
  assert.equal(
    /interesting|important|best|architecture angle/i.test(JSON.stringify(result)),
    false,
  );
  assert.deepEqual(result.generation_metadata, {
    mode: "deterministic",
    provider: null,
    model: null,
    paid_api_requests: 0,
    real_model_requests: 0,
    secret_reads: 0,
    repository_executions: 0,
  });
});

test("type declarations in one source directory form a neutral source family", () => {
  const producerDeclaration = fact("fact_producer_declares_create");
  const validatorDeclaration = fact("fact_validator_declares_validate");
  const typeFacts: readonly GroundedFact[] = [
    {
      ...producerDeclaration,
      id: "fact_type_producer_contract",
      fact_type: "TYPE_DECLARATION",
      category: "TYPE",
      predicate: "DECLARES_TYPE",
    },
    {
      ...validatorDeclaration,
      id: "fact_type_validator_contract",
      fact_type: "TYPE_DECLARATION",
      category: "TYPE",
      predicate: "DECLARES_TYPE",
    },
  ];

  const result = buildEditorialFactClusters(
    withFacts(...typeFacts),
    typeFacts.map((item) => item.id),
  );

  assert.deepEqual(result.clusters, [
    {
      cluster_id: "cluster_001",
      fact_ids: ["fact_type_producer_contract", "fact_type_validator_contract"],
      shared_entities: [],
      relation_paths: [
        {
          fact_id: "fact_type_producer_contract",
          from_entity_ref: "entity_module_producer",
          predicate: "DECLARES_TYPE",
          to_entity_ref: "entity_symbol_create_structured_object",
        },
        {
          fact_id: "fact_type_validator_contract",
          from_entity_ref: "entity_module_validator",
          predicate: "DECLARES_TYPE",
          to_entity_ref: "entity_symbol_validate_structured_object",
        },
      ],
      fact_categories: ["TYPE"],
      cluster_reason: "SOURCE_DIRECTORY_TYPE_FAMILY",
    },
  ]);
  assert.deepEqual(result.unclustered_fact_ids, []);
});

test("multiple authored behaviors for one subject form a neutral behavior family", () => {
  const validatorDeclaration = fact("fact_validator_declares_validate");
  const behaviorFacts: readonly GroundedFact[] = [
    {
      ...validatorDeclaration,
      id: "fact_validator_throws_for_missing_shape",
      fact_type: "BRANCH_BEHAVIOR",
      category: "BEHAVIORAL",
      predicate: "THROWS_WHEN",
    },
    {
      ...validatorDeclaration,
      id: "fact_validator_throws_for_unknown_field",
      fact_type: "BRANCH_BEHAVIOR",
      category: "BEHAVIORAL",
      predicate: "THROWS_WHEN",
      object_ref: "entity_symbol_create_structured_object",
    },
  ];

  const result = buildEditorialFactClusters(
    withFacts(...behaviorFacts),
    behaviorFacts.map((item) => item.id),
  );

  assert.deepEqual(result.clusters, [
    {
      cluster_id: "cluster_001",
      fact_ids: [
        "fact_validator_throws_for_missing_shape",
        "fact_validator_throws_for_unknown_field",
      ],
      shared_entities: [
        {
          entity_ref: "entity_module_validator",
          label: "src/validator.ts",
        },
      ],
      relation_paths: [
        {
          fact_id: "fact_validator_throws_for_missing_shape",
          from_entity_ref: "entity_module_validator",
          predicate: "THROWS_WHEN",
          to_entity_ref: "entity_symbol_validate_structured_object",
        },
        {
          fact_id: "fact_validator_throws_for_unknown_field",
          from_entity_ref: "entity_module_validator",
          predicate: "THROWS_WHEN",
          to_entity_ref: "entity_symbol_create_structured_object",
        },
      ],
      fact_categories: ["BEHAVIORAL"],
      cluster_reason: "SUBJECT_BEHAVIOR_FAMILY",
    },
  ]);
  assert.deepEqual(result.unclustered_fact_ids, []);
});

test("cluster output is invariant to pack and selection order", () => {
  const reversedPack: GroundedFactPack = {
    ...fixture,
    entities: [...fixture.entities].reverse(),
    facts: [...fixture.facts].reverse(),
  };

  assert.deepEqual(
    buildEditorialFactClusters(reversedPack, fixture.facts.map((item) => item.id).reverse()),
    buildEditorialFactClusters(fixture, fixture.facts.map((item) => item.id)),
  );
});

test("explicit cluster selection fails closed on empty, duplicate, or unknown Fact IDs", () => {
  assert.throws(
    () => buildEditorialFactClusters(fixture, []),
    /EDITORIAL_FACT_CLUSTER_EMPTY_SELECTION/,
  );
  assert.throws(
    () =>
      buildEditorialFactClusters(fixture, [
        "fact_renderer_imports_validator",
        "fact_renderer_imports_validator",
      ]),
    /EDITORIAL_FACT_CLUSTER_DUPLICATE_FACT_ID/,
  );
  assert.throws(
    () => buildEditorialFactClusters(fixture, ["fact_not_present"]),
    /EDITORIAL_FACT_CLUSTER_UNKNOWN_FACT_ID/,
  );
});
