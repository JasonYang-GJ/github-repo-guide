import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import {
  CORE_SCHEMA_IDS,
  createSchemaRegistry,
} from "../src/schemas/registry.js";

const schemaDirectory = resolve(process.cwd(), "schemas");

test("all three core schemas compile under Draft 2020-12", () => {
  const registry = createSchemaRegistry(schemaDirectory);

  assert.deepEqual(registry.schemaIds(), CORE_SCHEMA_IDS);
});
test("EvidenceRecord conditions reject a fake verified record", () => {
  const registry = createSchemaRegistry(schemaDirectory);
  const result = registry.validate("EvidenceRecord", {
    evidence_record_version: 1,
    id: "evidence_fake",
    claim_id: "claim_fake",
    claim: "This is not actually verified.",
    evidence_type: "unresolved",
    source_kind: "analysis_reasoning",
    confidence: 1,
    verification_status: "verified",
    verification: {
      method: "not_checked",
      checked_at: "2026-08-31T00:00:00.000Z",
      commit_resolved: false,
      path_exists: null,
      symbol_exists: null,
      line_range_valid: null,
      excerpt_matches: null
    },
    notes: "",
    limitations: []
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
});
