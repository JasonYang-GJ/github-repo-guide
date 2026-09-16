import type { EvidenceRecord } from "../analysis/domain.js";

export const FACT_IR_VERSION = 2 as const;
export type FactIrVersion = 1 | typeof FACT_IR_VERSION;

export type GroundedFactType =
  | "DECLARATION"
  | "TYPE_DECLARATION"
  | "EXPORT"
  | "IMPORT_RELATION"
  | "CALL_RELATION"
  | "BRANCH_BEHAVIOR"
  | "CONFIGURATION"
  | "MODULE_CONTAINS";

export type GroundedFactPredicate =
  | "DECLARES"
  | "DECLARES_TYPE"
  | "EXPORTS"
  | "IMPORTS"
  | "CALLS"
  | "SKIPS_WHEN"
  | "CONCATENATES_WHEN"
  | "THROWS_WHEN"
  | "DECLARES_CONFIGURATION"
  | "CONTAINS";

export type GroundedFactCategory =
  | "STRUCTURAL"
  | "BEHAVIORAL"
  | "CONFIGURATION"
  | "TYPE"
  | "RELATION";

export type GroundedEntityKind =
  | "package"
  | "module"
  | "symbol"
  | "manifest_field"
  | "config_field"
  | "condition";

export type GroundedQualifierKey =
  | "ACTION"
  | "EXPORT_SURFACE"
  | "RELATIONSHIP_TYPE"
  | "SYMBOL_KIND"
  | "CONFIGURATION_FIELD"
  | "CONTAINER_RELATION";

export interface GroundedConditionTerm {
  readonly left: string;
  readonly operator: "EQUALS";
  readonly right: string | null;
}

export interface GroundedNullishConditionExpression {
  readonly operator: "OR";
  readonly terms: readonly GroundedConditionTerm[];
}

export interface GroundedArrayConditionTerm {
  readonly operand: string;
  readonly predicate: "IS_ARRAY";
}

export interface GroundedArrayConditionExpression {
  readonly operator: "AND";
  readonly terms: readonly GroundedArrayConditionTerm[];
}

export type GroundedConditionExpression =
  | GroundedNullishConditionExpression
  | GroundedArrayConditionExpression;

export type GroundedEntityValue =
  | string
  | number
  | boolean
  | null
  | GroundedConditionExpression;

export interface GroundedEntity {
  readonly id: string;
  readonly kind: GroundedEntityKind;
  readonly display_label: string;
  readonly source_path?: string;
  readonly symbol?: NonNullable<EvidenceRecord["locator"]>["symbol"];
  readonly field_pointer?: string;
  readonly value?: GroundedEntityValue;
  readonly evidence_ids: readonly string[];
}

export interface GroundedFact {
  readonly id: string;
  readonly fact_type: GroundedFactType;
  readonly category: GroundedFactCategory;
  readonly subject_ref: string;
  readonly predicate: GroundedFactPredicate;
  readonly object_ref: string;
  readonly scope: "LOCAL" | "MODULE" | "PACKAGE";
  readonly evidence_ids: readonly string[];
  readonly source_kind: EvidenceRecord["source_kind"];
  readonly verification: {
    readonly status: "verified";
    readonly confidence: 1;
  };
  readonly qualifiers: readonly {
    readonly key: GroundedQualifierKey;
    readonly value: string;
  }[];
  readonly limitations: readonly string[];
  readonly provenance: {
    readonly repository: { readonly url: string; readonly commit_sha: string };
    readonly extractor:
      | "deterministic-evidence-to-fact-v1"
      | "deterministic-evidence-to-fact-v2";
    readonly evidence_ids: readonly string[];
  };
}

export interface GroundedEvidenceRef {
  readonly id: string;
  readonly evidence_type: EvidenceRecord["evidence_type"];
  readonly source_kind: EvidenceRecord["source_kind"];
  readonly verification_status: EvidenceRecord["verification_status"];
  readonly source_path?: string;
  readonly blob_sha?: string;
  readonly symbol?: NonNullable<EvidenceRecord["locator"]>["symbol"];
  readonly field_pointer?: string;
  readonly line_start?: number;
  readonly line_end?: number;
  readonly excerpt_sha256?: string;
  readonly call_relation?: EvidenceRecord["call_relation"];
}

export interface GroundedFactPack {
  readonly fact_ir_version: FactIrVersion;
  readonly repository: {
    readonly url: string;
    readonly owner: string;
    readonly name: string;
  };
  readonly commit: string;
  readonly entities: readonly GroundedEntity[];
  readonly facts: readonly GroundedFact[];
  readonly evidence_refs: readonly GroundedEvidenceRef[];
  readonly unsupported_areas: readonly {
    readonly id: string;
    readonly reason: string;
    readonly evidence_needed: string;
  }[];
  readonly limitations: readonly string[];
}
