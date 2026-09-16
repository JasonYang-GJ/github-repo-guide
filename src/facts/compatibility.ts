import type { EvidenceRecord } from "../analysis/domain.js";
import type {
  GroundedFactCategory,
  GroundedFactPredicate,
  GroundedFactType,
} from "./domain.js";

type EvidenceType = EvidenceRecord["evidence_type"];

export const FACT_EVIDENCE_COMPATIBILITY = {
  DECLARATION: ["symbol_declaration"],
  TYPE_DECLARATION: ["symbol_declaration", "config_field"],
  EXPORT: ["manifest_field", "symbol_declaration"],
  IMPORT_RELATION: ["source_range"],
  CALL_RELATION: ["direct_call"],
  BRANCH_BEHAVIOR: ["source_range", "symbol_declaration"],
  CONFIGURATION: ["manifest_field", "config_field"],
  MODULE_CONTAINS: ["symbol_declaration"],
} as const satisfies Readonly<Record<GroundedFactType, readonly EvidenceType[]>>;

export const FACT_TYPE_RULES = {
  DECLARATION: { category: "STRUCTURAL", predicates: ["DECLARES"] },
  TYPE_DECLARATION: { category: "TYPE", predicates: ["DECLARES_TYPE"] },
  EXPORT: { category: "CONFIGURATION", predicates: ["EXPORTS"] },
  IMPORT_RELATION: { category: "RELATION", predicates: ["IMPORTS"] },
  CALL_RELATION: { category: "RELATION", predicates: ["CALLS"] },
  BRANCH_BEHAVIOR: {
    category: "BEHAVIORAL",
    predicates: ["SKIPS_WHEN", "CONCATENATES_WHEN", "THROWS_WHEN"],
  },
  CONFIGURATION: {
    category: "CONFIGURATION",
    predicates: ["DECLARES_CONFIGURATION"],
  },
  MODULE_CONTAINS: { category: "STRUCTURAL", predicates: ["CONTAINS"] },
} as const satisfies Readonly<
  Record<
    GroundedFactType,
    {
      readonly category: GroundedFactCategory;
      readonly predicates: readonly GroundedFactPredicate[];
    }
  >
>;

export function isEvidenceTypeCompatible(
  factType: GroundedFactType,
  evidenceType: EvidenceType,
): boolean {
  return (FACT_EVIDENCE_COMPATIBILITY[factType] as readonly EvidenceType[]).includes(
    evidenceType,
  );
}
