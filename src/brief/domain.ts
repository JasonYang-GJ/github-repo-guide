import type {
  GroundedFactPredicate,
  GroundedFactPack,
} from "../facts/domain.js";

export const GROUNDED_BRIEF_PLAN_VERSION = 1 as const;
export const GROUNDED_BRIEF_VERSION = 1 as const;
export const FACT_SELECTION_POLICY_VERSION = 1 as const;

export type BriefCoverageCategory =
  | "PACKAGE_SURFACE"
  | "CORE_STRUCTURE"
  | "CORE_RELATIONS"
  | "VERIFIED_BEHAVIOR"
  | "TYPE_SURFACE"
  | "KNOWN_UNKNOWNS";

export type FactSelectionReason =
  | "BEHAVIORAL_EVIDENCE"
  | "PACKAGE_SURFACE"
  | "EXPORTED_SURFACE"
  | "RELATION_PARTICIPATION"
  | "ENTITY_CENTRALITY"
  | "CORE_STRUCTURE"
  | "TYPE_SURFACE"
  | "ENTRY_RELEVANCE"
  | "DOCUMENTED_PURPOSE";

export type FactExclusionReason =
  | "LOW_INFORMATION"
  | "DUPLICATE"
  | "LOW_CENTRALITY"
  | "OUT_OF_BRIEF_SCOPE";

export interface SelectedBriefFact {
  readonly fact_id: string;
  readonly priority: number;
  readonly score: number;
  readonly section_id: string;
  readonly selection_reasons: readonly FactSelectionReason[];
}

export interface ExcludedBriefFact {
  readonly fact_id: string;
  readonly reason: FactExclusionReason;
  readonly detail: string;
}

export interface BriefCoverage {
  readonly category: BriefCoverageCategory;
  readonly status: "AVAILABLE" | "UNAVAILABLE";
  readonly fact_ids: readonly string[];
  readonly note: string;
}

export interface GroundedBriefKnownGap {
  readonly id: string;
  readonly area: string;
  readonly reason: string;
  readonly evidence_needed: string;
  readonly source_unsupported_area_id: string;
}

export interface GroundedBriefSectionPlan {
  readonly id: string;
  readonly title: string;
  readonly purpose: string;
  readonly fact_ids: readonly string[];
  readonly known_gap_ids: readonly string[];
}

export interface GroundedBriefPlan {
  readonly brief_plan_version: typeof GROUNDED_BRIEF_PLAN_VERSION;
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: GroundedFactPack["fact_ir_version"];
  readonly selection_policy_version: typeof FACT_SELECTION_POLICY_VERSION;
  readonly selected_facts: readonly SelectedBriefFact[];
  readonly excluded_facts: readonly ExcludedBriefFact[];
  readonly coverage: readonly BriefCoverage[];
  readonly section_plan: readonly GroundedBriefSectionPlan[];
  readonly known_gaps: readonly GroundedBriefKnownGap[];
}

export type GroundedBriefStatementKind =
  | "TECHNICAL_FACT"
  | "DOCUMENTATION"
  | "INFERENCE"
  | "TRANSITION"
  | "ANALOGY"
  | "UNKNOWN";

export type GroundedBriefStatementScope =
  | "LOCAL"
  | "MODULE"
  | "PACKAGE"
  | "PROJECT"
  | "NONE";

export interface GroundedBriefAssertion {
  readonly fact_id: string;
  readonly subject_ref: string;
  readonly predicate: GroundedFactPredicate;
  readonly object_ref: string;
}

export interface GroundedBriefStatement {
  readonly id: string;
  readonly text: string;
  readonly kind: GroundedBriefStatementKind;
  readonly scope: GroundedBriefStatementScope;
  readonly fact_ids: readonly string[];
  readonly entity_refs: readonly string[];
  readonly assertions: readonly GroundedBriefAssertion[];
  readonly unknown_ids: readonly string[];
  readonly limitations: readonly string[];
}

export interface GroundedBriefSection {
  readonly id: string;
  readonly title: string;
  readonly statements: readonly GroundedBriefStatement[];
}

export interface GroundedBriefUnknown {
  readonly id: string;
  readonly statement: string;
  readonly source_gap_ids: readonly string[];
  readonly evidence_needed: string;
}

export interface GroundedBrief {
  readonly brief_version: typeof GROUNDED_BRIEF_VERSION;
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: GroundedFactPack["fact_ir_version"];
  readonly brief_plan_version: GroundedBriefPlan["brief_plan_version"];
  readonly sections: readonly GroundedBriefSection[];
  readonly fact_references: readonly {
    readonly statement_id: string;
    readonly fact_ids: readonly string[];
  }[];
  readonly unknowns: readonly GroundedBriefUnknown[];
  readonly limitations: readonly string[];
  readonly generation_metadata: {
    readonly mode: "deterministic" | "model_surface";
    readonly generator: string;
    readonly provider: string | null;
    readonly model: string | null;
    readonly paid_api_requests: number;
    readonly real_model_requests: number;
    readonly repository_executions: number;
  };
}
