import type { QualityReceipt } from "../analysis/domain.js";

const GATES = new Set(["schema_validity", "evidence_paths", "verified_claims", "claim_semantics", "relationship_nodes", "angle_references", "confidence_escalation", "mermaid_grounding", "script_grounding", "instruction_isolation", "output_binding"]);
const FIELDS = new Set(["project_name", "one_sentence", "summary", "problem"]);

/** Expose host-owned identifiers and numeric constraints, never raw exception text,
 * repository strings, prompts or credentials. */
export function qualityFailureDetails(receipt: QualityReceipt) {
  const failed = receipt.gates.filter(gate => !gate.passed);
  const fieldLimits = failed.filter(gate => gate.id === "schema_validity").flatMap(gate =>
    [...gate.details.matchAll(/brief: \/overview\/(\w+) must NOT have more than (\d+) characters/g)]
      .filter(match => FIELDS.has(match[1]!))
      .map(match => ({ field: `/overview/${match[1]!}`, character_limit: Number(match[2]) })),
  );
  return { failed_gates: failed.map(gate => gate.id).filter(id => GATES.has(id)), field_limits: fieldLimits };
}
