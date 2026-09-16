import type { CanonicalGroundedBriefArtifact } from "../brief/canonical.js";
import type {
  GroundedFact,
  GroundedFactCategory,
  GroundedFactPack,
  GroundedFactPredicate,
} from "../facts/domain.js";
import type { SchemaRegistry } from "../schemas/registry.js";
import {
  analyzeAngleSemanticFields,
  type AngleSemanticClauseTrace,
} from "./angle-semantics.js";

export const CONTENT_ANGLE_VERSION = 2 as const;
export const CONTENT_ANGLE_INPUT_VERSION = 1 as const;

export type ContentAngleType =
  | "ENGINEERING_BOUNDARY"
  | "ARCHITECTURE_PATTERN"
  | "LOCAL_BEHAVIOR"
  | "DESIGN_TRADEOFF"
  | "TYPE_SURFACE"
  | "PACKAGE_SURFACE"
  | "EVIDENCE_METHOD"
  | "EDUCATIONAL_INSIGHT"
  | "UNUSUAL_IMPLEMENTATION";

export type ContentAngleTargetAudience =
  | "DEVELOPER"
  | "AI_ENGINEER"
  | "OPEN_SOURCE_MAINTAINER"
  | "TECH_CREATOR"
  | "GENERAL_TECH";

export type ContentAngleClaimedScope =
  | GroundedFact["scope"]
  | "PROJECT";

export interface ContentAngleTechnicalBasis {
  readonly fact_id: string;
  readonly canonical_statement_id: string | null;
  readonly subject_ref: string;
  readonly predicate: GroundedFactPredicate;
  readonly object_ref: string;
  readonly scope: GroundedFact["scope"];
}

export interface ContentAngleEditorialScores {
  readonly technical_significance: number;
  readonly educational_value: number;
  readonly clarity: number;
  readonly evidence_strength: number;
  readonly distinctiveness: number;
  readonly content_potential: number;
}

export interface ContentAngleCandidateV2 {
  readonly content_angle_version: typeof CONTENT_ANGLE_VERSION;
  readonly id: string;
  readonly status: "CANDIDATE";
  readonly rank: null;
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: GroundedFactPack["fact_ir_version"];
  readonly canonical_grounded_brief_version: CanonicalGroundedBriefArtifact["canonical_grounded_brief_version"];
  readonly title: string;
  readonly angle_type: ContentAngleType;
  readonly editorial_thesis: string;
  readonly editorial_reason: string;
  readonly technical_basis: readonly ContentAngleTechnicalBasis[];
  readonly supporting_fact_ids: readonly string[];
  readonly supporting_statement_ids: readonly string[];
  readonly why_interesting: string;
  readonly target_audience: readonly ContentAngleTargetAudience[];
  readonly confidence: {
    readonly level: "LOW" | "MEDIUM" | "HIGH";
    readonly basis: "EDITORIAL_JUDGMENT_NOT_FACT_VERIFICATION";
    readonly rationale: string;
  };
  readonly novelty_assessment: {
    readonly status:
      | "NOT_RESEARCHED"
      | "REPOSITORY_LOCAL_ONLY"
      | "EXTERNALLY_RESEARCHED";
    readonly claim_boundary: "NO_EXTERNAL_NOVELTY_CLAIM";
    readonly rationale: string;
  };
  readonly educational_value: string;
  readonly caveats: readonly string[];
  readonly unknown_dependencies: readonly string[];
  readonly external_claims: readonly string[];
  readonly technical_entities: readonly {
    readonly entity_ref: string;
    readonly label: string;
  }[];
  readonly fact_mutation_requests: readonly string[];
  readonly claimed_scope: ContentAngleClaimedScope;
  readonly editorial_scores: ContentAngleEditorialScores;
}

export interface AcceptedContentAngleV2
  extends Omit<ContentAngleCandidateV2, "status" | "rank"> {
  readonly status: "ACCEPTED";
  readonly rank: 1 | 2 | 3;
}

export type ContentAngleGateCode =
  | "ALL_HARD_GATES_PASSED"
  | "SCHEMA_INVALID"
  | "IDENTITY_MISMATCH"
  | "UNKNOWN_FACT_REFERENCE"
  | "UNKNOWN_STATEMENT_REFERENCE"
  | "FACT_STATEMENT_BINDING_MISMATCH"
  | "TECHNICAL_BASIS_REFERENCE_MISMATCH"
  | "TECHNICAL_BASIS_NOT_ENTAILED"
  | "THESIS_TECHNICAL_CLAUSE_UNGROUNDED"
  | "BOUNDARY_CLAIM_UNSUPPORTED"
  | "ABSENCE_CLAIM_UNSUPPORTED"
  | "SYMBOL_NAME_SEMANTIC_INFERENCE_UNSUPPORTED"
  | "ENGINEERING_IMPLICATION_UNSUPPORTED"
  | "FACT_MUTATION_FORBIDDEN"
  | "UNSUPPORTED_ENTITY_INTRODUCTION"
  | "EDITORIAL_JUDGMENT_MASQUERADES_AS_VERIFIED"
  | "EXTERNAL_COMPARISON_UNSUPPORTED"
  | "CAUSALITY_UNSUPPORTED"
  | "TECHNICAL_CAUSALITY_UNSUPPORTED"
  | "EXCLUSIVITY_UNSUPPORTED"
  | "SCOPE_EXPANSION"
  | "PERFORMANCE_CLAIM_UNSUPPORTED"
  | "SAFETY_CLAIM_UNSUPPORTED"
  | "OUTCOME_CLAIM_UNSUPPORTED"
  | "DOCUMENTATION_UPGRADE_FORBIDDEN"
  | "KNOWN_UNKNOWN_DEPENDENCY_UNRESOLVED"
  | "KNOWN_UNKNOWN_PROMOTED"
  | "UNKNOWN_UNKNOWN_REFERENCE"
  | "NOVELTY_RESEARCH_REQUIRED"
  | "EDITORIAL_STRENGTH_BELOW_THRESHOLD"
  | "DUPLICATE_FACTS_AND_THESIS"
  | "ANGLE_COUNT_CAP";

export interface ContentAngleDecisionTrace {
  readonly candidate_id: string;
  readonly technical_basis: readonly ContentAngleTechnicalBasis[];
  readonly supporting_fact_ids: readonly string[];
  readonly supporting_statement_ids: readonly string[];
  readonly editorial_thesis: string;
  readonly editorial_reason: string;
  readonly angle_type: ContentAngleType;
  readonly evidence_strength: "STRONG" | "MODERATE" | "WEAK";
  readonly novelty_status: ContentAngleCandidateV2["novelty_assessment"]["status"];
  readonly external_claims: readonly string[];
  readonly semantic_clause_trace: readonly AngleSemanticClauseTrace[];
  readonly decision: "ACCEPT" | "DOWNGRADE" | "REJECT" | "DEDUPLICATE";
  readonly decision_reason: readonly ContentAngleGateCode[];
  readonly rank: number | null;
}

export interface ContentAngleEvaluationReceipt {
  readonly content_angle_evaluation_version: 1;
  readonly status: "ACCEPTED" | "NO_STRONG_CONTENT_ANGLE";
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: GroundedFactPack["fact_ir_version"];
  readonly canonical_grounded_brief_version: CanonicalGroundedBriefArtifact["canonical_grounded_brief_version"];
  readonly accepted_angles: readonly AcceptedContentAngleV2[];
  readonly decision_trace: readonly ContentAngleDecisionTrace[];
  readonly angle_count_policy: {
    readonly minimum: 0;
    readonly maximum: 3;
    readonly forced_count: false;
    readonly no_strong_content_angle_is_valid: true;
  };
  readonly ranking_model: {
    readonly kind: "EDITORIAL_HEURISTIC_NOT_OBJECTIVE_TRUTH";
    readonly dimensions: readonly [
      "technical_significance",
      "educational_value",
      "clarity",
      "evidence_strength",
      "distinctiveness",
      "content_potential",
    ];
    readonly hard_gate_precedes_ranking: true;
  };
  readonly generation_metadata: {
    readonly mode: "deterministic_host_validation";
    readonly provider: null;
    readonly model: null;
    readonly paid_api_requests: 0;
    readonly real_model_requests: 0;
    readonly secret_reads: 0;
    readonly repository_executions: 0;
  };
}

interface EligibleCandidate {
  readonly candidate: ContentAngleCandidateV2;
  readonly evidenceStrength: ContentAngleDecisionTrace["evidence_strength"];
  readonly evidenceScore: number;
  readonly editorialScore: number;
  readonly semanticClauseTrace: readonly AngleSemanticClauseTrace[];
}

const SCOPE_ORDER: Readonly<Record<ContentAngleClaimedScope, number>> = {
  LOCAL: 0,
  MODULE: 1,
  PACKAGE: 2,
  PROJECT: 3,
};

const FACT_CATEGORY_ORDER: readonly GroundedFactCategory[] = [
  "BEHAVIORAL",
  "RELATION",
  "STRUCTURAL",
  "TYPE",
  "CONFIGURATION",
];

const WELL_KNOWN_TECHNICAL_ENTITY_NAMES = [
  "PostgreSQL",
  "Postgres",
  "MySQL",
  "SQLite",
  "MongoDB",
  "Redis",
  "Kafka",
  "RabbitMQ",
  "DynamoDB",
  "Amazon S3",
  "AWS",
  "Azure",
  "GCP",
  "Docker",
  "Kubernetes",
  "React",
  "Vue",
  "Next.js",
  "Express",
] as const;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameRepository(
  left: GroundedFactPack["repository"],
  right: GroundedFactPack["repository"],
): boolean {
  return (
    left.url === right.url &&
    left.owner === right.owner &&
    left.name === right.name
  );
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const normalizedLeft = [...new Set(left)].sort(compareText);
  const normalizedRight = [...new Set(right)].sort(compareText);
  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
}

function uniqueCodes(codes: readonly ContentAngleGateCode[]): ContentAngleGateCode[] {
  return [...new Set(codes)];
}

function candidateCorpus(candidate: ContentAngleCandidateV2): string {
  return [
    candidate.title,
    candidate.editorial_thesis,
    candidate.editorial_reason,
    candidate.why_interesting,
    candidate.educational_value,
    ...candidate.external_claims,
  ]
    .join(" ")
    .toLowerCase();
}

function evidenceStrength(
  facts: readonly GroundedFact[],
): Pick<EligibleCandidate, "evidenceStrength" | "evidenceScore"> {
  if (facts.length === 0) {
    return { evidenceStrength: "WEAK", evidenceScore: 0 };
  }
  if (facts.every((fact) => fact.source_kind === "documentation")) {
    return { evidenceStrength: "WEAK", evidenceScore: 1 };
  }
  const categories = new Set(facts.map((fact) => fact.category));
  if (
    facts.some((fact) => fact.fact_type === "BRANCH_BEHAVIOR") ||
    (facts.length >= 3 && categories.size >= 2)
  ) {
    return { evidenceStrength: "STRONG", evidenceScore: 3 };
  }
  return { evidenceStrength: "MODERATE", evidenceScore: 2 };
}

function normalizedThesisTerms(value: string): Set<string> {
  const stopWords = new Set([
    "a",
    "an",
    "the",
    "this",
    "that",
    "through",
    "makes",
    "make",
    "becomes",
    "become",
    "is",
    "are",
    "to",
    "of",
  ]);
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
      .split(/\s+/)
      .filter((term) => term.length > 0 && !stopWords.has(term)),
  );
}

function thesisSimilarity(left: string, right: string): number {
  const leftTerms = normalizedThesisTerms(left);
  const rightTerms = normalizedThesisTerms(right);
  if (leftTerms.size === 0 || rightTerms.size === 0) return 0;
  const intersection = [...leftTerms].filter((term) => rightTerms.has(term)).length;
  const union = new Set([...leftTerms, ...rightTerms]).size;
  return union === 0 ? 0 : intersection / union;
}

function validateTruthContext(
  pack: GroundedFactPack,
  canonical: CanonicalGroundedBriefArtifact,
  schemas: SchemaRegistry,
): void {
  schemas.assert("GroundedFactPack", pack);
  schemas.assert("CanonicalGroundedBrief", canonical);
  if (
    canonical.status !== "ACCEPTED" ||
    !sameRepository(pack.repository, canonical.repository) ||
    pack.commit !== canonical.commit ||
    pack.fact_ir_version !== canonical.fact_ir_version
  ) {
    throw new Error(
      "Content Angle truth context must bind one accepted Canonical Brief to the same Fact IR repository and commit.",
    );
  }
}

function validateCandidate(
  candidate: ContentAngleCandidateV2,
  pack: GroundedFactPack,
  canonical: CanonicalGroundedBriefArtifact,
  schemas: SchemaRegistry,
): {
  readonly findings: readonly ContentAngleGateCode[];
  readonly facts: readonly GroundedFact[];
  readonly evidenceStrength: ContentAngleDecisionTrace["evidence_strength"];
  readonly evidenceScore: number;
  readonly editorialScore: number;
  readonly semanticClauseTrace: readonly AngleSemanticClauseTrace[];
} {
  const findings: ContentAngleGateCode[] = [];
  const schemaResult = schemas.validate("ContentAngleV2", candidate);
  if (!schemaResult.valid) findings.push("SCHEMA_INVALID");

  if (
    !sameRepository(candidate.repository, pack.repository) ||
    candidate.commit !== pack.commit ||
    candidate.fact_ir_version !== pack.fact_ir_version ||
    candidate.canonical_grounded_brief_version !==
      canonical.canonical_grounded_brief_version
  ) {
    findings.push("IDENTITY_MISMATCH");
  }

  const factsById = new Map(pack.facts.map((fact) => [fact.id, fact]));
  const statements = canonical.brief.sections.flatMap(
    (section) => section.statements,
  );
  const statementsById = new Map(
    statements.map((statement) => [statement.id, statement]),
  );
  const unknownIds = new Set(
    canonical.known_unknowns.map((unknown) => unknown.id),
  );
  const referencedFacts: GroundedFact[] = [];

  for (const factId of candidate.supporting_fact_ids) {
    if (!factsById.has(factId)) findings.push("UNKNOWN_FACT_REFERENCE");
  }
  for (const statementId of candidate.supporting_statement_ids) {
    if (!statementsById.has(statementId)) {
      findings.push("UNKNOWN_STATEMENT_REFERENCE");
    }
  }

  if (
    !sameStringSet(
      candidate.supporting_fact_ids,
      candidate.technical_basis.map((basis) => basis.fact_id),
    ) ||
    !sameStringSet(
      candidate.supporting_statement_ids,
      candidate.technical_basis.flatMap((basis) =>
        basis.canonical_statement_id === null
          ? []
          : [basis.canonical_statement_id],
      ),
    )
  ) {
    findings.push("TECHNICAL_BASIS_REFERENCE_MISMATCH");
  }

  for (const basis of candidate.technical_basis) {
    const fact = factsById.get(basis.fact_id);
    if (fact === undefined) {
      findings.push("UNKNOWN_FACT_REFERENCE");
      continue;
    }
    referencedFacts.push(fact);
    if (
      basis.subject_ref !== fact.subject_ref ||
      basis.predicate !== fact.predicate ||
      basis.object_ref !== fact.object_ref ||
      basis.scope !== fact.scope
    ) {
      findings.push("TECHNICAL_BASIS_NOT_ENTAILED");
    }
    if (basis.canonical_statement_id !== null) {
      const statement = statementsById.get(basis.canonical_statement_id);
      if (statement === undefined) {
        findings.push("UNKNOWN_STATEMENT_REFERENCE");
      } else if (!statement.fact_ids.includes(fact.id)) {
        findings.push("FACT_STATEMENT_BINDING_MISMATCH");
      }
    }
  }

  if (candidate.fact_mutation_requests.length > 0) {
    findings.push("FACT_MUTATION_FORBIDDEN");
  }

  const knownEntities = new Set(pack.entities.map((entity) => entity.id));
  const supportedEntities = new Set(
    referencedFacts.flatMap((fact) => [fact.subject_ref, fact.object_ref]),
  );
  for (const entity of candidate.technical_entities) {
    if (
      !knownEntities.has(entity.entity_ref) ||
      !supportedEntities.has(entity.entity_ref)
    ) {
      findings.push("UNSUPPORTED_ENTITY_INTRODUCTION");
    }
  }

  const corpus = candidateCorpus(candidate);
  const knownEntityLabels = pack.entities.flatMap((entity) =>
    [entity.display_label, entity.source_path, entity.symbol?.name]
      .filter((value): value is string => value !== undefined)
      .map((value) => value.toLowerCase()),
  );
  const ungroundedNamedTechnology = WELL_KNOWN_TECHNICAL_ENTITY_NAMES.some(
    (technology) => {
      const normalized = technology.toLowerCase();
      const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const mentioned = new RegExp(
        `(?:^|[^a-z0-9_])${escaped}(?:$|[^a-z0-9_])`,
      ).test(corpus);
      return (
        mentioned &&
        !knownEntityLabels.some(
          (label) => label === normalized || label.includes(normalized),
        )
      );
    },
  );
  if (ungroundedNamedTechnology) {
    findings.push("UNSUPPORTED_ENTITY_INTRODUCTION");
  }
  const hasExternalComparison =
    candidate.external_claims.length > 0 ||
    /\b(unlike|compared (?:with|to)|better than|worse than|more than other|less than other)\b|不同于|相比于|优于|胜过/.test(
      corpus,
    );
  if (hasExternalComparison) {
    findings.push("EXTERNAL_COMPARISON_UNSUPPORTED");
  }

  if (
    /\b(always|entire project|whole project|project-wide|only (?:library|project|implementation|tool)|sole|unique)\b|整个项目|全项目|始终|唯一|独有/.test(
      corpus,
    )
  ) {
    findings.push("EXCLUSIVITY_UNSUPPORTED");
  }
  if (
    /\b(faster|fastest|performance|performant|lightweight|more efficient|efficiency gain)\b|更快|最快|高性能|轻量|效率提升/.test(
      corpus,
    )
  ) {
    findings.push("PERFORMANCE_CLAIM_UNSUPPORTED");
  }
  if (
    /\b(prevents? (?:runtime )?(?:bugs?|errors?)|bug-free|eliminates? (?:bugs?|errors?)|reduces? (?:bugs?|errors?)|improves? (?:reliability|correctness|performance)|reliable|reliability outcome)\b|避免运行时错误|防止错误|无错误|可靠性/.test(
      corpus,
    )
  ) {
    findings.push("OUTCOME_CLAIM_UNSUPPORTED");
  }
  if (
    /\b(verified fact|proven fact|source code (?:proves|verifies)|verified by (?:the )?source code)\b|源码证明|已验证事实/.test(
      corpus,
    )
  ) {
    findings.push("EDITORIAL_JUDGMENT_MASQUERADES_AS_VERIFIED");
  }

  const documentationFactIds = new Set(
    referencedFacts
      .filter((fact) => fact.source_kind === "documentation")
      .map((fact) => fact.id),
  );
  const usesDocumentationStatement = candidate.technical_basis.some((basis) => {
    if (basis.canonical_statement_id === null) return false;
    return statementsById.get(basis.canonical_statement_id)?.kind === "DOCUMENTATION";
  });
  if (
    (documentationFactIds.size > 0 || usesDocumentationStatement) &&
    /\b(verif(?:y|ies|ied)|prov(?:e|es|ed)|fact|measured)\b|验证|证明|实测/.test(
      corpus,
    )
  ) {
    findings.push("DOCUMENTATION_UPGRADE_FORBIDDEN");
  }

  for (const unknownId of candidate.unknown_dependencies) {
    if (!unknownIds.has(unknownId)) findings.push("UNKNOWN_UNKNOWN_REFERENCE");
  }
  if (candidate.unknown_dependencies.length > 0) {
    findings.push("KNOWN_UNKNOWN_DEPENDENCY_UNRESOLVED");
  }
  const knownUnknownCorpus = canonical.known_unknowns
    .map((unknown) => `${unknown.statement} ${unknown.evidence_needed}`)
    .join(" ")
    .toLowerCase();
  const promotesKnownMutationGap =
    /\b(does not mutate|without mutating|never mutates|immutable|immutability)\b|不修改输入|不可变/.test(
      corpus,
    ) && /mutat|immutab|修改输入|不可变/.test(knownUnknownCorpus);
  const promotesKnownCallGap =
    /\b(?:resolved|complete|full)\s+call\s+graph\b|\b(?:all|every)\s+(?:runtime\s+)?calls?\b|\b(?:dynamic|indirect|aliased?)\s+calls?\b|完整调用图|所有调用|动态调用|间接调用|别名调用/.test(
      corpus,
    ) &&
    /call|调用/.test(knownUnknownCorpus);
  const promotesKnownResolutionGap =
    /\b(resolves? aliases?|follows? re-exports?|re-export chains?)\b|解析别名|重导出链/.test(
      corpus,
    ) && /alias|re-export|别名|重导出/.test(knownUnknownCorpus);
  if (
    promotesKnownMutationGap ||
    promotesKnownCallGap ||
    promotesKnownResolutionGap
  ) {
    findings.push("KNOWN_UNKNOWN_PROMOTED");
  }
  if (candidate.novelty_assessment.status === "EXTERNALLY_RESEARCHED") {
    findings.push("NOVELTY_RESEARCH_REQUIRED");
  }

  const highestFactScope = referencedFacts.reduce(
    (highest, fact) => Math.max(highest, SCOPE_ORDER[fact.scope]),
    -1,
  );
  if (
    highestFactScope >= 0 &&
    SCOPE_ORDER[candidate.claimed_scope] > highestFactScope
  ) {
    findings.push("SCOPE_EXPANSION");
  }
  if (
    /\b(entire project|whole project|project-wide|across the project|always in all cases)\b|整个项目|全项目|所有情况/.test(
      corpus,
    )
  ) {
    findings.push("SCOPE_EXPANSION");
  }

  const strength = evidenceStrength(referencedFacts);
  const evidenceScore = Math.min(
    strength.evidenceScore,
    candidate.editorial_scores.evidence_strength,
  );
  const editorialScore =
    candidate.editorial_scores.technical_significance +
    candidate.editorial_scores.educational_value +
    candidate.editorial_scores.clarity +
    evidenceScore +
    candidate.editorial_scores.distinctiveness +
    candidate.editorial_scores.content_potential;
  const semanticAnalysis = analyzeAngleSemanticFields(
    {
      title: candidate.title,
      editorial_thesis: candidate.editorial_thesis,
      why_interesting: candidate.why_interesting,
      editorial_reason: candidate.editorial_reason,
      educational_value: candidate.educational_value,
    },
    referencedFacts,
    pack,
    canonical,
  );
  if (semanticAnalysis.technical_causality_unsupported) {
    findings.push("TECHNICAL_CAUSALITY_UNSUPPORTED");
    findings.push("CAUSALITY_UNSUPPORTED");
  }
  if (semanticAnalysis.untraced_technical_clause) {
    findings.push("THESIS_TECHNICAL_CLAUSE_UNGROUNDED");
  }
  if (semanticAnalysis.external_comparison_unsupported) {
    findings.push("EXTERNAL_COMPARISON_UNSUPPORTED");
  }
  if (semanticAnalysis.safety_claim_unsupported) {
    findings.push("SAFETY_CLAIM_UNSUPPORTED");
  }
  if (semanticAnalysis.novelty_research_required) {
    findings.push("NOVELTY_RESEARCH_REQUIRED");
  }
  if (semanticAnalysis.boundary_claim_unsupported) {
    findings.push("BOUNDARY_CLAIM_UNSUPPORTED");
  }
  if (semanticAnalysis.absence_claim_unsupported) {
    findings.push("ABSENCE_CLAIM_UNSUPPORTED");
  }
  if (semanticAnalysis.symbol_name_semantic_inference_unsupported) {
    findings.push("SYMBOL_NAME_SEMANTIC_INFERENCE_UNSUPPORTED");
  }
  if (semanticAnalysis.engineering_implication_unsupported) {
    findings.push("ENGINEERING_IMPLICATION_UNSUPPORTED");
  }

  return {
    findings: uniqueCodes(findings),
    facts: referencedFacts,
    evidenceStrength: strength.evidenceStrength,
    evidenceScore,
    editorialScore,
    semanticClauseTrace: semanticAnalysis.clause_trace,
  };
}

function traceFor(
  candidate: ContentAngleCandidateV2,
  evidenceStrengthValue: ContentAngleDecisionTrace["evidence_strength"],
  decision: ContentAngleDecisionTrace["decision"],
  decisionReason: readonly ContentAngleGateCode[],
  rank: number | null,
  semanticClauseTrace: readonly AngleSemanticClauseTrace[],
): ContentAngleDecisionTrace {
  return {
    candidate_id: candidate.id,
    technical_basis: candidate.technical_basis,
    supporting_fact_ids: candidate.supporting_fact_ids,
    supporting_statement_ids: candidate.supporting_statement_ids,
    editorial_thesis: candidate.editorial_thesis,
    editorial_reason: candidate.editorial_reason,
    angle_type: candidate.angle_type,
    evidence_strength: evidenceStrengthValue,
    novelty_status: candidate.novelty_assessment.status,
    external_claims: candidate.external_claims,
    semantic_clause_trace: semanticClauseTrace,
    decision,
    decision_reason: decisionReason,
    rank,
  };
}

export function evaluateContentAngleCandidates(
  candidates: readonly ContentAngleCandidateV2[],
  pack: GroundedFactPack,
  canonical: CanonicalGroundedBriefArtifact,
  schemas: SchemaRegistry,
): ContentAngleEvaluationReceipt {
  validateTruthContext(pack, canonical, schemas);
  const traceById = new Map<string, ContentAngleDecisionTrace>();
  const eligible: EligibleCandidate[] = [];

  for (const candidate of candidates) {
    const validation = validateCandidate(candidate, pack, canonical, schemas);
    if (validation.findings.length > 0) {
      traceById.set(
        candidate.id,
        traceFor(
          candidate,
          validation.evidenceStrength,
          "REJECT",
          validation.findings,
          null,
          validation.semanticClauseTrace,
        ),
      );
      continue;
    }
    const strongEnough =
      validation.editorialScore >= 10 &&
      validation.evidenceScore >= 2 &&
      candidate.editorial_scores.educational_value >= 2 &&
      candidate.editorial_scores.clarity >= 2;
    if (!strongEnough) {
      traceById.set(
        candidate.id,
        traceFor(
          candidate,
          validation.evidenceStrength,
          "DOWNGRADE",
          ["EDITORIAL_STRENGTH_BELOW_THRESHOLD"],
          null,
          validation.semanticClauseTrace,
        ),
      );
      continue;
    }
    eligible.push({
      candidate,
      evidenceStrength: validation.evidenceStrength,
      evidenceScore: validation.evidenceScore,
      editorialScore: validation.editorialScore,
      semanticClauseTrace: validation.semanticClauseTrace,
    });
  }

  const uniqueEligible: EligibleCandidate[] = [];
  for (const item of eligible) {
    const duplicate = uniqueEligible.find(
      (existing) =>
        sameStringSet(
          existing.candidate.supporting_fact_ids,
          item.candidate.supporting_fact_ids,
        ) &&
        thesisSimilarity(
          existing.candidate.editorial_thesis,
          item.candidate.editorial_thesis,
        ) >= 0.75,
    );
    if (duplicate !== undefined) {
      traceById.set(
        item.candidate.id,
        traceFor(
          item.candidate,
          item.evidenceStrength,
          "DEDUPLICATE",
          ["DUPLICATE_FACTS_AND_THESIS"],
          null,
          item.semanticClauseTrace,
        ),
      );
    } else {
      uniqueEligible.push(item);
    }
  }

  const ranked = [...uniqueEligible].sort(
    (left, right) =>
      right.editorialScore - left.editorialScore ||
      right.evidenceScore - left.evidenceScore ||
      compareText(left.candidate.id, right.candidate.id),
  );
  const acceptedAngles: AcceptedContentAngleV2[] = [];
  ranked.forEach((item, index) => {
    if (index >= 3) {
      traceById.set(
        item.candidate.id,
        traceFor(
          item.candidate,
          item.evidenceStrength,
          "DOWNGRADE",
          ["ANGLE_COUNT_CAP"],
          null,
          item.semanticClauseTrace,
        ),
      );
      return;
    }
    const rank = (index + 1) as 1 | 2 | 3;
    const accepted: AcceptedContentAngleV2 = {
      ...item.candidate,
      status: "ACCEPTED",
      rank,
    };
    schemas.assert("ContentAngleV2", accepted);
    acceptedAngles.push(accepted);
    traceById.set(
      item.candidate.id,
      traceFor(
        item.candidate,
        item.evidenceStrength,
        "ACCEPT",
        ["ALL_HARD_GATES_PASSED"],
        rank,
        item.semanticClauseTrace,
      ),
    );
  });

  const decisionTrace = candidates.map((candidate) => {
    const trace = traceById.get(candidate.id);
    if (trace === undefined) {
      throw new Error(`Content Angle evaluation lost candidate ${candidate.id}.`);
    }
    return trace;
  });

  return {
    content_angle_evaluation_version: 1,
    status:
      acceptedAngles.length > 0 ? "ACCEPTED" : "NO_STRONG_CONTENT_ANGLE",
    repository: pack.repository,
    commit: pack.commit,
    fact_ir_version: pack.fact_ir_version,
    canonical_grounded_brief_version:
      canonical.canonical_grounded_brief_version,
    accepted_angles: acceptedAngles,
    decision_trace: decisionTrace,
    angle_count_policy: {
      minimum: 0,
      maximum: 3,
      forced_count: false,
      no_strong_content_angle_is_valid: true,
    },
    ranking_model: {
      kind: "EDITORIAL_HEURISTIC_NOT_OBJECTIVE_TRUTH",
      dimensions: [
        "technical_significance",
        "educational_value",
        "clarity",
        "evidence_strength",
        "distinctiveness",
        "content_potential",
      ],
      hard_gate_precedes_ranking: true,
    },
    generation_metadata: {
      mode: "deterministic_host_validation",
      provider: null,
      model: null,
      paid_api_requests: 0,
      real_model_requests: 0,
      secret_reads: 0,
      repository_executions: 0,
    },
  };
}

export interface DeterministicContentAngleInput {
  readonly content_angle_input_version: typeof CONTENT_ANGLE_INPUT_VERSION;
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: GroundedFactPack["fact_ir_version"];
  readonly canonical_grounded_brief_version: CanonicalGroundedBriefArtifact["canonical_grounded_brief_version"];
  readonly reasoning_mode: "TO_BE_EVALUATED";
  readonly task_contract: {
    readonly task: "CONTENT_ANGLE_CANDIDATE_GENERATION";
    readonly provider_contract: "GENERIC_MODEL_PROVIDER";
    readonly output_contract: "CONTENT_ANGLE_V2_CANDIDATE";
    readonly fact_ids_are_truth_anchors: true;
    readonly allowed_editorial_actions: readonly ["select", "rank", "group", "frame"];
    readonly prohibited_fact_actions: readonly ["create", "upgrade", "rewrite", "replace"];
  };
  readonly input_scope: {
    readonly selection_policy:
      | "ALL_FACTS_SMALL_REPOSITORY"
      | "EXPLICIT_BOUNDED_SELECTION";
    readonly selected_fact_count: number;
    readonly total_fact_count: number;
    readonly future_large_repository_policy: "BOUNDED_SELECTION_REQUIRED";
  };
  readonly canonical_brief: {
    readonly context_role: "EDITORIAL_CONTEXT_NOT_TRUTH_REPLACEMENT";
    readonly statements: readonly {
      readonly section_id: string;
      readonly section_title: string;
      readonly statement_id: string;
      readonly text: string;
      readonly kind: string;
      readonly scope: string;
      readonly fact_ids: readonly string[];
      readonly entity_refs: readonly string[];
      readonly unknown_ids: readonly string[];
    }[];
  };
  readonly facts_by_category: readonly {
    readonly category: GroundedFactCategory;
    readonly facts: readonly {
      readonly fact_id: string;
      readonly fact_type: GroundedFact["fact_type"];
      readonly subject: { readonly entity_ref: string; readonly label: string };
      readonly predicate: GroundedFactPredicate;
      readonly object: { readonly entity_ref: string; readonly label: string };
      readonly scope: GroundedFact["scope"];
      readonly source_kind: GroundedFact["source_kind"];
      readonly evidence_ids: readonly string[];
      readonly limitations: readonly string[];
    }[];
  }[];
  readonly known_unknowns: CanonicalGroundedBriefArtifact["known_unknowns"];
  readonly limitations: readonly string[];
  readonly generation_metadata: {
    readonly mode: "deterministic";
    readonly provider: null;
    readonly model: null;
    readonly paid_api_requests: 0;
    readonly real_model_requests: 0;
    readonly secret_reads: 0;
    readonly repository_executions: 0;
  };
}

export interface ContentAngleInputSelection {
  readonly selected_fact_ids?: readonly string[];
}

export function buildDeterministicContentAngleInput(
  pack: GroundedFactPack,
  canonical: CanonicalGroundedBriefArtifact,
  selection: ContentAngleInputSelection = {},
): DeterministicContentAngleInput {
  if (
    canonical.status !== "ACCEPTED" ||
    !sameRepository(pack.repository, canonical.repository) ||
    pack.commit !== canonical.commit ||
    pack.fact_ir_version !== canonical.fact_ir_version
  ) {
    throw new Error(
      "Content Angle input requires one accepted Canonical Brief bound to the same Fact IR repository and commit.",
    );
  }
  const maximumFacts = 80;
  const allFactIds = new Set(pack.facts.map((fact) => fact.id));
  const explicitlySelected = selection.selected_fact_ids;
  if (explicitlySelected === undefined && pack.facts.length > maximumFacts) {
    throw new Error(
      `CONTENT_ANGLE_FACT_SELECTION_REQUIRED: ${pack.facts.length} Facts exceed the ${maximumFacts}-Fact small-repository boundary.`,
    );
  }
  if (
    explicitlySelected !== undefined &&
    (explicitlySelected.length === 0 ||
      explicitlySelected.length > maximumFacts ||
      new Set(explicitlySelected).size !== explicitlySelected.length)
  ) {
    throw new Error(
      "CONTENT_ANGLE_FACT_SELECTION_INVALID: explicit selection must contain 1-80 unique Fact IDs.",
    );
  }
  if (
    explicitlySelected !== undefined &&
    explicitlySelected.some((factId) => !allFactIds.has(factId))
  ) {
    throw new Error(
      "CONTENT_ANGLE_FACT_SELECTION_INVALID: explicit selection contains an unknown Fact ID.",
    );
  }
  const selectedFactIds = new Set(
    explicitlySelected ?? pack.facts.map((fact) => fact.id),
  );
  const selectedFacts = pack.facts.filter((fact) => selectedFactIds.has(fact.id));
  const entities = new Map(
    pack.entities.map((entity) => [entity.id, entity.display_label]),
  );
  const factsByCategory = FACT_CATEGORY_ORDER.map((category) => ({
    category,
    facts: selectedFacts
      .filter((fact) => fact.category === category)
      .sort((left, right) => compareText(left.id, right.id))
      .map((fact) => ({
        fact_id: fact.id,
        fact_type: fact.fact_type,
        subject: {
          entity_ref: fact.subject_ref,
          label: entities.get(fact.subject_ref) ?? fact.subject_ref,
        },
        predicate: fact.predicate,
        object: {
          entity_ref: fact.object_ref,
          label: entities.get(fact.object_ref) ?? fact.object_ref,
        },
        scope: fact.scope,
        source_kind: fact.source_kind,
        evidence_ids: [...fact.evidence_ids],
        limitations: [...fact.limitations],
      })),
  })).filter((group) => group.facts.length > 0);
  const statements = canonical.brief.sections.flatMap((section) =>
    section.statements
      .filter(
        (statement) =>
          statement.fact_ids.length === 0 ||
          statement.fact_ids.every((factId) => selectedFactIds.has(factId)),
      )
      .map((statement) => ({
      section_id: section.id,
      section_title: section.title,
      statement_id: statement.id,
      text: statement.text,
      kind: statement.kind,
      scope: statement.scope,
      fact_ids: [...statement.fact_ids],
      entity_refs: [...statement.entity_refs],
      unknown_ids: [...statement.unknown_ids],
      })),
  );

  return {
    content_angle_input_version: CONTENT_ANGLE_INPUT_VERSION,
    repository: { ...pack.repository },
    commit: pack.commit,
    fact_ir_version: pack.fact_ir_version,
    canonical_grounded_brief_version:
      canonical.canonical_grounded_brief_version,
    reasoning_mode: "TO_BE_EVALUATED",
    task_contract: {
      task: "CONTENT_ANGLE_CANDIDATE_GENERATION",
      provider_contract: "GENERIC_MODEL_PROVIDER",
      output_contract: "CONTENT_ANGLE_V2_CANDIDATE",
      fact_ids_are_truth_anchors: true,
      allowed_editorial_actions: ["select", "rank", "group", "frame"],
      prohibited_fact_actions: ["create", "upgrade", "rewrite", "replace"],
    },
    input_scope: {
      selection_policy:
        explicitlySelected === undefined
          ? "ALL_FACTS_SMALL_REPOSITORY"
          : "EXPLICIT_BOUNDED_SELECTION",
      selected_fact_count: selectedFacts.length,
      total_fact_count: pack.facts.length,
      future_large_repository_policy: "BOUNDED_SELECTION_REQUIRED",
    },
    canonical_brief: {
      context_role: "EDITORIAL_CONTEXT_NOT_TRUTH_REPLACEMENT",
      statements,
    },
    facts_by_category: factsByCategory,
    known_unknowns: canonical.known_unknowns.map((unknown) => ({ ...unknown })),
    limitations: [
      ...canonical.limitations,
      "Repository-local evidence cannot establish external novelty or comparative superiority.",
      "Editorial scores are heuristics, not objective truth or source-code verification.",
    ],
    generation_metadata: {
      mode: "deterministic",
      provider: null,
      model: null,
      paid_api_requests: 0,
      real_model_requests: 0,
      secret_reads: 0,
      repository_executions: 0,
    },
  };
}

export function serializeContentAngleInput(
  input: DeterministicContentAngleInput,
): string {
  return `${JSON.stringify(input, null, 2)}\n`;
}

function inline(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function renderContentAngleInputMarkdown(
  input: DeterministicContentAngleInput,
): string {
  const lines = [
    "# Deterministic Content Angle Input",
    "",
    "> Exactly what a future model sees. Fact IDs are the truth anchors; Canonical Brief prose is context only.",
    "",
    `Repository: ${inline(input.repository.url)}`,
    `Commit: ${input.commit}`,
    `Fact IR Version: ${input.fact_ir_version}`,
    `Canonical Grounded Brief Version: ${input.canonical_grounded_brief_version}`,
    `Reasoning Mode: ${input.reasoning_mode}`,
    `Provider Contract: ${input.task_contract.provider_contract}`,
    `Output Contract: ${input.task_contract.output_contract}`,
    `Selection Policy: ${input.input_scope.selection_policy}`,
    `Facts Included: ${input.input_scope.selected_fact_count}/${input.input_scope.total_fact_count}`,
    `Future Large Repository Policy: ${input.input_scope.future_large_repository_policy}`,
    "",
    "## Editorial task boundary",
    "",
    `- Allowed: ${input.task_contract.allowed_editorial_actions.join(", ")}`,
    `- Facts may not be: ${input.task_contract.prohibited_fact_actions.join(", ")}`,
    "- A combination of true Facts is not automatically a new verified Fact.",
    "- Novelty, interest, audience fit and content potential remain editorial judgments.",
    "",
    "## Canonical Brief",
    "",
  ];

  for (const statement of input.canonical_brief.statements) {
    lines.push(
      `- [${statement.kind}; ${statement.scope}] ${inline(statement.text)}`,
      `  - Statement: \`${statement.statement_id}\``,
      `  - Facts: ${
        statement.fact_ids.length === 0
          ? "none"
          : statement.fact_ids.map((id) => `\`${id}\``).join(", ")
      }`,
      `  - Unknowns: ${
        statement.unknown_ids.length === 0
          ? "none"
          : statement.unknown_ids.map((id) => `\`${id}\``).join(", ")
      }`,
    );
  }

  for (const group of input.facts_by_category) {
    lines.push("", `## Fact category: ${group.category}`, "");
    for (const fact of group.facts) {
      lines.push(
        `- \`${fact.fact_id}\`: \`${fact.subject.entity_ref}\` (${inline(
          fact.subject.label,
        )}) ${fact.predicate} \`${fact.object.entity_ref}\` (${inline(
          fact.object.label,
        )})`,
        `  - Type: ${fact.fact_type}; Scope: ${fact.scope}; Source: ${fact.source_kind}`,
        `  - Evidence: ${fact.evidence_ids.map((id) => `\`${id}\``).join(", ")}`,
        `  - Limitations: ${
          fact.limitations.length === 0
            ? "none"
            : fact.limitations.map(inline).join(" | ")
        }`,
      );
    }
  }

  lines.push("", "## Known unknowns", "");
  for (const unknown of input.known_unknowns) {
    lines.push(
      `- \`${unknown.id}\`: ${inline(unknown.statement)}`,
      `  - Evidence needed: ${inline(unknown.evidence_needed)}`,
    );
  }
  lines.push("", "## Limitations", "");
  for (const limitation of input.limitations) {
    lines.push(`- ${inline(limitation)}`);
  }
  lines.push(
    "",
    "## Offline generation receipt",
    "",
    `- Paid API requests: ${input.generation_metadata.paid_api_requests}`,
    `- Real model requests: ${input.generation_metadata.real_model_requests}`,
    `- Secret reads: ${input.generation_metadata.secret_reads}`,
    `- Repository executions: ${input.generation_metadata.repository_executions}`,
  );
  return `${lines.join("\n")}\n`;
}
