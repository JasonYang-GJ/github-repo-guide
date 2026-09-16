import assert from "node:assert/strict";
import test from "node:test";
import { boundedText } from "../src/presentation/bounded-text.js";
import { qualityFailureDetails } from "../src/quality/failure-details.js";

test("display clipping preserves exact short text and respects Unicode schema character limits", () => {
  for (const limit of [200, 500, 1000, 2000, 4000]) {
    assert.equal(boundedText("a".repeat(limit), limit), "a".repeat(limit));
    assert.equal(boundedText("a".repeat(limit + 1), limit), "a".repeat(limit - 1) + "…");
    const clipped = boundedText("😀".repeat(limit + 1), limit);
    assert.equal(Array.from(clipped).length, limit);
    assert.equal(clipped, "😀".repeat(limit - 1) + "…");
  }
});

test("failure diagnostics expose only known field/gate identifiers and character limits", () => {
  const details = qualityFailureDetails({ passed: false, gates: [
    { id: "schema_validity", critical: true, passed: false, details: "brief: /overview/one_sentence must NOT have more than 500 characters; secret-content; brief: /overview/secret_field must NOT have more than 999 characters" },
    { id: "secret-gate", critical: true, passed: false, details: "secret-content" },
  ] });
  assert.deepEqual(details, { failed_gates: ["schema_validity"], field_limits: [{ field: "/overview/one_sentence", character_limit: 500 }] });
  assert.doesNotMatch(JSON.stringify(details), /secret/);
});
