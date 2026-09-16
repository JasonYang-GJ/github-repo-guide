import type { GroundedFactPack, GroundedFactType } from "../facts/domain.js";
import type { GroundedBrief, GroundedBriefPlan } from "./domain.js";
import type { GroundedBriefValidationReceipt } from "./validation.js";

export type OfflineVerdict = "PASS" | "PARTIAL" | "FAIL";

export interface GroundedBriefOfflineAssessment {
  readonly assessment_version: 1;
  readonly status: OfflineVerdict;
  readonly facts_available: number;
  readonly facts_selected: number;
  readonly facts_excluded: number;
  readonly sections_generated: number;
  readonly statements_generated: number;
  readonly technical_statements: number;
  readonly documentation_statements: number;
  readonly unknown_statements: number;
  readonly factual_statements_with_valid_fact_trace: number;
  readonly facts_with_valid_evidence_trace: number;
  readonly selected_fact_type_counts: Readonly<Record<GroundedFactType, number>>;
  readonly declaration_like_selected: number;
  readonly declaration_like_share: number;
  readonly known_unknowns_preserved: number;
  readonly blocking_fact_coverage_gaps: readonly {
    readonly code: "FACT_COVERAGE_GAP";
    readonly category: string;
    readonly reason: string;
  }[];
  readonly verdicts: {
    readonly grounding: OfflineVerdict;
    readonly traceability: OfflineVerdict;
    readonly technical_utility: OfflineVerdict;
    readonly readability: OfflineVerdict;
    readonly fact_selection: OfflineVerdict;
    readonly declaration_dump_check: OfflineVerdict;
  };
  readonly notes: readonly string[];
}

const FACT_TYPES: readonly GroundedFactType[] = [
  "DECLARATION",
  "TYPE_DECLARATION",
  "EXPORT",
  "IMPORT_RELATION",
  "BRANCH_BEHAVIOR",
  "CONFIGURATION",
  "MODULE_CONTAINS",
];

function allPass(values: readonly OfflineVerdict[]): OfflineVerdict {
  if (values.every((value) => value === "PASS")) return "PASS";
  if (values.includes("FAIL")) return "FAIL";
  return "PARTIAL";
}

export function evaluateGroundedBriefOffline(
  plan: GroundedBriefPlan,
  brief: GroundedBrief,
  pack: GroundedFactPack,
  receipt: GroundedBriefValidationReceipt,
): GroundedBriefOfflineAssessment {
  const facts = new Map(pack.facts.map((fact) => [fact.id, fact]));
  const evidenceIds = new Set(pack.evidence_refs.map((record) => record.id));
  const selectedIds = new Set(plan.selected_facts.map((item) => item.fact_id));
  const excludedIds = new Set(plan.excluded_facts.map((item) => item.fact_id));
  const statements = brief.sections.flatMap((section) => section.statements);
  const factualStatements = statements.filter((statement) =>
    ["TECHNICAL_FACT", "DOCUMENTATION"].includes(statement.kind),
  );
  const resultByStatement = new Map(
    receipt.statements.map((result) => [result.statement_id, result]),
  );
  const validFactualStatements = factualStatements.filter(
    (statement) =>
      receipt.passed &&
      statement.fact_ids.length > 0 &&
      resultByStatement.get(statement.id)?.passed === true,
  );
  const factsWithEvidence = new Set<string>();
  for (const statement of validFactualStatements) {
    for (const factId of statement.fact_ids) {
      const fact = facts.get(factId);
      if (
        fact !== undefined &&
        fact.evidence_ids.length > 0 &&
        fact.evidence_ids.every((id) => evidenceIds.has(id))
      ) {
        factsWithEvidence.add(factId);
      }
    }
  }

  const selectedFacts = pack.facts.filter((fact) => selectedIds.has(fact.id));
  const selectedFactTypeCounts = Object.fromEntries(
    FACT_TYPES.map((factType) => [
      factType,
      selectedFacts.filter((fact) => fact.fact_type === factType).length,
    ]),
  ) as Record<GroundedFactType, number>;
  const declarationLikeSelected = selectedFacts.filter((fact) =>
    ["DECLARATION", "TYPE_DECLARATION", "MODULE_CONTAINS"].includes(
      fact.fact_type,
    ),
  ).length;
  const declarationLikeShare =
    selectedFacts.length === 0
      ? 0
      : declarationLikeSelected / selectedFacts.length;

  const blockingFactCoverageGaps = plan.coverage
    .filter(
      (item) =>
        item.category !== "KNOWN_UNKNOWNS" && item.status === "UNAVAILABLE",
    )
    .map((item) => ({
      code: "FACT_COVERAGE_GAP" as const,
      category: item.category,
      reason: item.note,
    }));
  const partitionValid =
    selectedIds.size === plan.selected_facts.length &&
    excludedIds.size === plan.excluded_facts.length &&
    [...selectedIds].every((id) => !excludedIds.has(id)) &&
    selectedIds.size + excludedIds.size === pack.facts.length;
  const prioritiesValid = plan.selected_facts.every(
    (item, index) => item.priority === index + 1,
  );
  const unknownsPreserved = statements.filter(
    (statement) => statement.kind === "UNKNOWN",
  ).length;
  const unknownHandlingValid =
    unknownsPreserved === plan.known_gaps.length &&
    brief.unknowns.length === plan.known_gaps.length;
  const uniqueTexts = new Set(statements.map((statement) => statement.text));
  const readable =
    brief.sections.length > 0 &&
    brief.sections.every(
      (section) => section.title.trim().length > 0 && section.statements.length > 0,
    ) &&
    statements.every(
      (statement) =>
        statement.text.trim() === statement.text &&
        statement.text.length >= 10 &&
        statement.text.length <= 360 &&
        /[.!?”]$/.test(statement.text),
    ) &&
    uniqueTexts.size === statements.length;
  const declarationDumpPass =
    declarationLikeShare <= 0.4 &&
    selectedFactTypeCounts.BRANCH_BEHAVIOR > 0 &&
    selectedFactTypeCounts.IMPORT_RELATION > 0 &&
    selectedFactTypeCounts.EXPORT > 0;

  const verdicts = {
    grounding: receipt.passed ? ("PASS" as const) : ("FAIL" as const),
    traceability:
      validFactualStatements.length === factualStatements.length &&
      factsWithEvidence.size === selectedFacts.length
        ? ("PASS" as const)
        : validFactualStatements.length > 0
          ? ("PARTIAL" as const)
          : ("FAIL" as const),
    technical_utility:
      blockingFactCoverageGaps.length === 0 &&
      selectedFactTypeCounts.BRANCH_BEHAVIOR > 0 &&
      selectedFactTypeCounts.IMPORT_RELATION > 0 &&
      unknownHandlingValid
        ? ("PASS" as const)
        : selectedFacts.length > 0
          ? ("PARTIAL" as const)
          : ("FAIL" as const),
    readability: readable ? ("PASS" as const) : ("FAIL" as const),
    fact_selection:
      partitionValid &&
      prioritiesValid &&
      plan.selected_facts.every((item) => item.selection_reasons.length > 0)
        ? ("PASS" as const)
        : ("FAIL" as const),
    declaration_dump_check: declarationDumpPass
      ? ("PASS" as const)
      : ("FAIL" as const),
  };

  return {
    assessment_version: 1,
    status: allPass(Object.values(verdicts)),
    facts_available: pack.facts.length,
    facts_selected: selectedFacts.length,
    facts_excluded: plan.excluded_facts.length,
    sections_generated: brief.sections.length,
    statements_generated: statements.length,
    technical_statements: statements.filter(
      (statement) => statement.kind === "TECHNICAL_FACT",
    ).length,
    documentation_statements: statements.filter(
      (statement) => statement.kind === "DOCUMENTATION",
    ).length,
    unknown_statements: unknownsPreserved,
    factual_statements_with_valid_fact_trace: validFactualStatements.length,
    facts_with_valid_evidence_trace: factsWithEvidence.size,
    selected_fact_type_counts: selectedFactTypeCounts,
    declaration_like_selected: declarationLikeSelected,
    declaration_like_share: declarationLikeShare,
    known_unknowns_preserved: unknownsPreserved,
    blocking_fact_coverage_gaps: blockingFactCoverageGaps,
    verdicts,
    notes: [
      "No aggregate quality score is calculated.",
      "Readability is an offline structural check; the human review remains authoritative.",
      "Known unknowns are preserved as evidence gaps, not negative facts.",
    ],
  };
}
