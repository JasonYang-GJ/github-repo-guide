import type { GroundedEntity, GroundedFact, GroundedFactPack } from "../facts/domain.js";
import {
  claimProse,
  classifyClaimType,
  extractOutcomeModifiers,
  extractSafetyModifiers,
} from "../quality/claim-evidence-compatibility.js";
import type {
  GroundedBrief,
  GroundedBriefPlan,
  GroundedBriefStatement,
} from "./domain.js";

export type GroundedBriefGateCode =
  | "REPOSITORY_MISMATCH"
  | "COMMIT_MISMATCH"
  | "FACT_IR_VERSION_MISMATCH"
  | "BRIEF_PLAN_VERSION_MISMATCH"
  | "DUPLICATE_STATEMENT_ID"
  | "UNKNOWN_FACT_REFERENCE"
  | "UNSELECTED_FACT_REFERENCE"
  | "SELECTED_FACT_NOT_REALIZED"
  | "FACT_REFERENCE_MISMATCH"
  | "ASSERTION_FACT_MISMATCH"
  | "ASSERTION_ENTITY_REFERENCE_MISSING"
  | "FACT_EVIDENCE_TRACE_BROKEN"
  | "TECHNICAL_FACT_REQUIRES_FACT"
  | "UNKNOWN_ENTITY_REFERENCE"
  | "STATEMENT_FACT_INCOMPATIBLE"
  | "TYPE_DECLARATION_CANNOT_PROVE_RUNTIME"
  | "UNSUPPORTED_ENTITY_INTRODUCTION"
  | "PREDICATE_EXPANSION"
  | "SCOPE_EXPANSION"
  | "TECHNICAL_FACT_HIDDEN_IN_TRANSITION"
  | "COMPOUND_STATEMENT_REQUIRES_ATOMIZATION"
  | "UNKNOWN_GAP_REFERENCE"
  | "UNKNOWN_ASSERTED_AS_FALSE";

export interface GroundedBriefGateFinding {
  readonly code: GroundedBriefGateCode;
  readonly statement_id: string | null;
  readonly detail: string;
}

export interface GroundedBriefStatementResult {
  readonly statement_id: string;
  readonly passed: boolean;
  readonly action: "ACCEPT" | "ATOMIZE" | "REJECT";
  readonly fact_ids: readonly string[];
  readonly reason_codes: readonly GroundedBriefGateCode[];
}

export interface GroundedBriefValidationReceipt {
  readonly gate_version: 1;
  readonly passed: boolean;
  readonly findings: readonly GroundedBriefGateFinding[];
  readonly statements: readonly GroundedBriefStatementResult[];
  readonly metrics: {
    readonly total_statements: number;
    readonly technical_statements: number;
    readonly statements_with_valid_fact_trace: number;
  };
}

export interface GroundedBriefValidationOptions {
  readonly requiredFactIds?: readonly string[];
}

const SCOPE_RANK = {
  NONE: -1,
  LOCAL: 0,
  MODULE: 1,
  PACKAGE: 2,
  PROJECT: 3,
} as const;

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

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function includesEntityLabel(
  statement: string,
  entity: GroundedEntity | undefined,
): boolean {
  if (entity === undefined) return false;
  return statement.toLowerCase().includes(entity.display_label.toLowerCase());
}

function exactAssertionMatches(
  statement: GroundedBriefStatement,
  facts: ReadonlyMap<string, GroundedFact>,
): boolean {
  if (statement.assertions.length !== statement.fact_ids.length) return false;
  return statement.assertions.every((assertion) => {
    const fact = facts.get(assertion.fact_id);
    return (
      fact !== undefined &&
      statement.fact_ids.includes(assertion.fact_id) &&
      assertion.subject_ref === fact.subject_ref &&
      assertion.predicate === fact.predicate &&
      assertion.object_ref === fact.object_ref
    );
  });
}

function declarationCompatible(
  statement: GroundedBriefStatement,
  fact: GroundedFact,
  entities: ReadonlyMap<string, GroundedEntity>,
): boolean {
  if (fact.predicate !== "DECLARES") return false;
  return (
    /\b(?:function|method|class|variable|constant|symbol)\b/i.test(statement.text) &&
    /\b(?:exists?|declar(?:e|es|ed))\b/i.test(statement.text) &&
    includesEntityLabel(statement.text, entities.get(fact.object_ref))
  );
}

function branchCompatible(
  statement: GroundedBriefStatement,
  fact: GroundedFact,
  entities: ReadonlyMap<string, GroundedEntity>,
): boolean {
  if (fact.fact_type !== "BRANCH_BEHAVIOR") return false;
  const subject = entities.get(fact.subject_ref);
  const condition = entities.get(fact.object_ref);
  const actionMatches =
    fact.predicate === "SKIPS_WHEN"
      ? /\b(?:skip|skips|continue|continues)\b/i.test(statement.text)
      : fact.predicate === "CONCATENATES_WHEN"
        ? /\bconcat(?:enate|enates|enated|enating)?\b/i.test(statement.text)
        : /\bthrow(?:s|n|ing)?\b/i.test(statement.text);
  return (
    actionMatches &&
    /\b(?:when|if|condition)\b/i.test(statement.text) &&
    includesEntityLabel(statement.text, subject) &&
    includesEntityLabel(statement.text, condition)
  );
}

function typeDeclarationCompatible(
  statement: GroundedBriefStatement,
  fact: GroundedFact,
  entities: ReadonlyMap<string, GroundedEntity>,
): boolean {
  return (
    fact.predicate === "DECLARES_TYPE" &&
    /\b(?:type|interface)\b/i.test(statement.text) &&
    /\b(?:exists?|declar(?:e|es|ed))\b/i.test(statement.text) &&
    includesEntityLabel(statement.text, entities.get(fact.object_ref))
  );
}

function entityValueAnchor(entity: GroundedEntity | undefined): string | null {
  if (
    entity === undefined ||
    !["string", "number", "boolean"].includes(typeof entity.value)
  ) {
    return entity?.value === null ? "null" : null;
  }
  return String(entity.value);
}

function exportCompatible(
  statement: GroundedBriefStatement,
  fact: GroundedFact,
  entities: ReadonlyMap<string, GroundedEntity>,
): boolean {
  if (fact.predicate !== "EXPORTS") return false;
  const subject = entities.get(fact.subject_ref);
  const object = entities.get(fact.object_ref);
  const valueAnchor = entityValueAnchor(object);
  const objectMatches =
    includesEntityLabel(statement.text, object) ||
    (valueAnchor !== null && statement.text.includes(`\`${valueAnchor}\``));
  const subjectMatches =
    includesEntityLabel(statement.text, subject) ||
    (fact.scope === "PACKAGE" && /\bpackage\b/i.test(statement.text)) ||
    (fact.scope === "MODULE" && /\bmodule\b/i.test(statement.text));
  return (
    /\b(?:export|exports|expose|exposes|exposed)\b/i.test(statement.text) &&
    subjectMatches &&
    objectMatches
  );
}

function isDocumentationFact(
  fact: GroundedFact,
  entities: ReadonlyMap<string, GroundedEntity>,
): boolean {
  return (
    fact.source_kind === "documentation" ||
    (fact.fact_type === "CONFIGURATION" &&
      entities.get(fact.object_ref)?.field_pointer === "/description")
  );
}

function configurationCompatible(
  statement: GroundedBriefStatement,
  fact: GroundedFact,
  entities: ReadonlyMap<string, GroundedEntity>,
): boolean {
  if (fact.predicate !== "DECLARES_CONFIGURATION") return false;
  const subject = entities.get(fact.subject_ref);
  const object = entities.get(fact.object_ref);
  const value = entityValueAnchor(object);
  const subjectMatches =
    includesEntityLabel(statement.text, subject) || /\bpackage\b/i.test(statement.text);
  const objectMatches =
    includesEntityLabel(statement.text, object) ||
    (object?.field_pointer !== undefined &&
      statement.text.includes(object.field_pointer)) ||
    (value !== null && statement.text.includes(value));
  const predicateMatches =
    statement.kind === "DOCUMENTATION"
      ? /\b(?:describe|describes|document|documents)\b/i.test(statement.text)
      : /\b(?:declare|declares|declared|set|sets|lists)\b/i.test(statement.text);
  return subjectMatches && objectMatches && predicateMatches;
}

function importCompatible(
  statement: GroundedBriefStatement,
  fact: GroundedFact,
  entities: ReadonlyMap<string, GroundedEntity>,
): boolean {
  return (
    fact.predicate === "IMPORTS" &&
    /\b(?:import|imports|imported)\b/i.test(statement.text) &&
    includesEntityLabel(statement.text, entities.get(fact.subject_ref)) &&
    includesEntityLabel(statement.text, entities.get(fact.object_ref))
  );
}

function containmentCompatible(
  statement: GroundedBriefStatement,
  fact: GroundedFact,
  entities: ReadonlyMap<string, GroundedEntity>,
): boolean {
  return (
    fact.predicate === "CONTAINS" &&
    /\b(?:contain|contains|contained)\b/i.test(statement.text) &&
    includesEntityLabel(statement.text, entities.get(fact.subject_ref)) &&
    includesEntityLabel(statement.text, entities.get(fact.object_ref))
  );
}

function hasUnsupportedPredicateExpansion(statement: string): boolean {
  const prose = claimProse(statement);
  const outcomeModifiers = extractOutcomeModifiers(statement).filter(
    (modifier) => modifier !== "enables" && modifier !== "facilitates",
  );
  return (
    extractSafetyModifiers(statement).length > 0 ||
    outcomeModifiers.length > 0 ||
    /\b(?:guarantee|guarantees|guaranteed|secure|secures|secured|accelerate|accelerates|accelerated|ensure|ensures|ensured)\b/i.test(
      prose,
    ) ||
    /\b(?:does\s+not\s+mutate|without\s+mutating|immutable|immutability)\b/i.test(
      prose,
    )
  );
}

const TECHNICAL_ENTITY_NAMES = [
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

const GENERIC_CAPITALIZED_TERMS = new Set([
  "brief",
  "class",
  "constant",
  "core",
  "fact",
  "function",
  "grounded",
  "in",
  "interface",
  "local",
  "method",
  "module",
  "overview",
  "package",
  "public",
  "runtime",
  "source",
  "structure",
  "symbol",
  "technical",
  "the",
  "this",
  "type",
  "typescript",
  "variable",
  "verified",
  "what",
]);

function normalizedKnownEntityText(
  entities: ReadonlyMap<string, GroundedEntity>,
): readonly string[] {
  return [...entities.values()].flatMap((entity) => {
    const values = [entity.display_label, entity.source_path, entity.symbol?.name];
    const valueAnchor = entityValueAnchor(entity);
    if (valueAnchor !== null) values.push(valueAnchor);
    return values
      .filter((value): value is string => value !== undefined)
      .map((value) => value.toLowerCase());
  });
}

function unsupportedEntityMentions(
  statement: string,
  entities: ReadonlyMap<string, GroundedEntity>,
): readonly string[] {
  const known = normalizedKnownEntityText(entities);
  const candidates = new Set<string>();
  for (const technology of TECHNICAL_ENTITY_NAMES) {
    const escaped = technology.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?:^|[^A-Za-z0-9_])${escaped}(?:$|[^A-Za-z0-9_])`, "i").test(statement)) {
      candidates.add(technology);
    }
  }
  for (const match of statement.matchAll(/\b[A-Z][A-Za-z0-9_.+-]{2,}\b/g)) {
    const value = match[0];
    if (value !== undefined && !GENERIC_CAPITALIZED_TERMS.has(value.toLowerCase())) {
      candidates.add(value);
    }
  }
  return [...candidates]
    .filter((candidate) => {
      const normalized = candidate.toLowerCase();
      return !known.some(
        (value) => value === normalized || value.includes(normalized),
      );
    })
    .sort();
}

function requiresAtomization(statement: GroundedBriefStatement): boolean {
  if (statement.kind !== "TECHNICAL_FACT") return false;
  if (statement.assertions.length > 2) return true;
  const prose = claimProse(statement.text);
  const predicateGroups = [
    /\b(?:declare|declares|declared|exist|exists)\b/i,
    /\b(?:export|exports|expose|exposes|exposed)\b/i,
    /\b(?:import|imports|imported)\b/i,
    /\b(?:contain|contains|contained)\b/i,
    /\b(?:skip|skips|skipped|continue|continues)\b/i,
    /\bconcat(?:enate|enates|enated|enating)?\b/i,
    /\b(?:call|calls|read|reads|write|writes|store|stores|return|returns)\b/i,
  ].filter((pattern) => pattern.test(prose)).length;
  const expandedPredicate = hasUnsupportedPredicateExpansion(statement.text) ? 1 : 0;
  const clauseBoundary = /\b(?:and|while|whereas)\b|;|\.\s+[A-Z]/.test(prose);
  return (
    clauseBoundary &&
    predicateGroups + expandedPredicate > Math.max(1, statement.assertions.length)
  );
}

function hasTextScopeExpansion(statement: string): boolean {
  return /\b(?:whole|entire)\s+(?:project|repository|codebase)\b|\bacross\s+(?:the\s+)?(?:whole\s+)?(?:project|repository|codebase)\b|\balways\b|\ball\s+(?:nullish\s+)?(?:inputs?|values?|cases?|branches?)\b|\bevery\s+(?:input|value|case|branch)\b/i.test(
    statement,
  );
}

function pushFinding(
  findings: GroundedBriefGateFinding[],
  code: GroundedBriefGateCode,
  statementId: string | null,
  detail: string,
): void {
  findings.push({ code, statement_id: statementId, detail });
}

export function validateGroundedBrief(
  brief: GroundedBrief,
  plan: GroundedBriefPlan,
  pack: GroundedFactPack,
  options: GroundedBriefValidationOptions = {},
): GroundedBriefValidationReceipt {
  const findings: GroundedBriefGateFinding[] = [];
  if (
    !sameRepository(brief.repository, pack.repository) ||
    !sameRepository(plan.repository, pack.repository)
  ) {
    pushFinding(
      findings,
      "REPOSITORY_MISMATCH",
      null,
      "Brief, plan, and Fact IR must name the same repository.",
    );
  }
  if (brief.commit !== pack.commit || plan.commit !== pack.commit) {
    pushFinding(
      findings,
      "COMMIT_MISMATCH",
      null,
      "Brief, plan, and Fact IR must use the same pinned commit.",
    );
  }
  if (
    brief.fact_ir_version !== pack.fact_ir_version ||
    plan.fact_ir_version !== pack.fact_ir_version
  ) {
    pushFinding(
      findings,
      "FACT_IR_VERSION_MISMATCH",
      null,
      "Brief and plan must use the supplied Fact IR version.",
    );
  }
  if (brief.brief_plan_version !== plan.brief_plan_version) {
    pushFinding(
      findings,
      "BRIEF_PLAN_VERSION_MISMATCH",
      null,
      "Brief must identify the supplied plan contract version.",
    );
  }
  const identityValid = findings.length === 0;

  const facts = new Map(pack.facts.map((fact) => [fact.id, fact]));
  const entities = new Map(pack.entities.map((entity) => [entity.id, entity]));
  const selectedIds = new Set(plan.selected_facts.map((item) => item.fact_id));
  const referenceMap = new Map(
    brief.fact_references.map((reference) => [
      reference.statement_id,
      reference.fact_ids,
    ]),
  );
  const planGapIds = new Set(plan.known_gaps.map((gap) => gap.id));
  const briefUnknownIds = new Set(brief.unknowns.map((unknown) => unknown.id));
  const statements = brief.sections.flatMap((section) => section.statements);
  const statementIds = new Set(statements.map((statement) => statement.id));
  const seenReferenceStatementIds = new Set<string>();
  for (const reference of brief.fact_references) {
    if (
      seenReferenceStatementIds.has(reference.statement_id) ||
      !statementIds.has(reference.statement_id)
    ) {
      pushFinding(
        findings,
        "FACT_REFERENCE_MISMATCH",
        reference.statement_id,
        "The top-level Fact index contains a duplicate or unknown Statement ID.",
      );
    }
    seenReferenceStatementIds.add(reference.statement_id);
  }
  const seenStatements = new Set<string>();
  const statementResults: GroundedBriefStatementResult[] = [];

  for (const statement of statements) {
    const start = findings.length;
    if (seenStatements.has(statement.id)) {
      pushFinding(
        findings,
        "DUPLICATE_STATEMENT_ID",
        statement.id,
        "Statement identifiers must be unique within one Brief.",
      );
    }
    seenStatements.add(statement.id);

    if (statement.kind === "TECHNICAL_FACT" && statement.fact_ids.length === 0) {
      pushFinding(
        findings,
        "TECHNICAL_FACT_REQUIRES_FACT",
        statement.id,
        "Every technical statement requires at least one selected Fact reference.",
      );
    }
    if (
      statement.kind === "TECHNICAL_FACT" &&
      statement.scope === "NONE"
    ) {
      pushFinding(
        findings,
        "STATEMENT_FACT_INCOMPATIBLE",
        statement.id,
        "A technical Fact statement must retain the local, module, package, or project scope it asserts.",
      );
    }
    if (
      statement.kind === "DOCUMENTATION" &&
      statement.fact_ids.length === 0
    ) {
      pushFinding(
        findings,
        "STATEMENT_FACT_INCOMPATIBLE",
        statement.id,
        "Documentation in a Grounded Brief must retain its selected documentation/configuration Fact reference.",
      );
    }
    for (const factId of statement.fact_ids) {
      if (!facts.has(factId)) {
        pushFinding(
          findings,
          "UNKNOWN_FACT_REFERENCE",
          statement.id,
          `Fact ${factId} does not exist in the supplied Fact IR.`,
        );
      } else if (!selectedIds.has(factId)) {
        pushFinding(
          findings,
          "UNSELECTED_FACT_REFERENCE",
          statement.id,
          `Fact ${factId} was not selected by the supplied Brief plan.`,
        );
      }
    }
    const listedReference = referenceMap.get(statement.id) ?? [];
    if (!sameStrings(listedReference, statement.fact_ids)) {
      pushFinding(
        findings,
        "FACT_REFERENCE_MISMATCH",
        statement.id,
        "The top-level statement-to-Fact index must exactly match the statement Fact IDs.",
      );
    }
    if (!exactAssertionMatches(statement, facts)) {
      pushFinding(
        findings,
        "ASSERTION_FACT_MISMATCH",
        statement.id,
        "Every structured assertion must reproduce its referenced Fact without modification.",
      );
    }
    const assertionEntityIds = new Set(
      statement.assertions.flatMap((assertion) => [
        assertion.subject_ref,
        assertion.object_ref,
      ]),
    );
    if (
      [...assertionEntityIds].some(
        (entityId) => !statement.entity_refs.includes(entityId),
      )
    ) {
      pushFinding(
        findings,
        "ASSERTION_ENTITY_REFERENCE_MISSING",
        statement.id,
        "Statement entity references must include every subject and object used by its assertions.",
      );
    }
    if (
      ["TECHNICAL_FACT", "DOCUMENTATION"].includes(statement.kind) &&
      statement.entity_refs.some((entityId) => !assertionEntityIds.has(entityId))
    ) {
      pushFinding(
        findings,
        "UNSUPPORTED_ENTITY_INTRODUCTION",
        statement.id,
        "A factual Statement cannot attach an entity that is absent from its exact Fact assertions.",
      );
    }
    if (
      statement.kind === "TECHNICAL_FACT" &&
      hasTextScopeExpansion(statement.text)
    ) {
      pushFinding(
        findings,
        "SCOPE_EXPANSION",
        statement.id,
        "Universal or whole-project wording exceeds the bounded scope recorded by Fact IR.",
      );
    }
    if (statement.kind === "TECHNICAL_FACT") {
      const unsupportedEntities = unsupportedEntityMentions(
        statement.text,
        entities,
      );
      if (unsupportedEntities.length > 0) {
        pushFinding(
          findings,
          "UNSUPPORTED_ENTITY_INTRODUCTION",
          statement.id,
          `Technical entities are absent from Fact IR: ${unsupportedEntities.join(", ")}.`,
        );
      }
      if (requiresAtomization(statement)) {
        pushFinding(
          findings,
          "COMPOUND_STATEMENT_REQUIRES_ATOMIZATION",
          statement.id,
          "The statement contains more independent predicates than its exact Fact assertions support.",
        );
      }
    }
    if (statement.kind === "UNKNOWN") {
      if (
        statement.fact_ids.length > 0 ||
        statement.assertions.length > 0 ||
        statement.entity_refs.length > 0 ||
        statement.unknown_ids.length === 0 ||
        statement.unknown_ids.some(
          (id) => !planGapIds.has(id) || !briefUnknownIds.has(id),
        )
      ) {
        pushFinding(
          findings,
          "UNKNOWN_GAP_REFERENCE",
          statement.id,
          "An Unknown statement must point only to a formal gap shared by the plan and Brief unknown index.",
        );
      }
      if (
        !/\b(?:not\s+established|not\s+proven|unknown|unavailable|does\s+not\s+establish|cannot\s+establish)\b/i.test(
          statement.text,
        )
      ) {
        pushFinding(
          findings,
          "UNKNOWN_ASSERTED_AS_FALSE",
          statement.id,
          "Known-unknown prose must state the evidence boundary; it cannot assert that the unavailable fact is false.",
        );
      }
    } else if (statement.unknown_ids.length > 0) {
      pushFinding(
        findings,
        "UNKNOWN_GAP_REFERENCE",
        statement.id,
        "Only UNKNOWN statements may reference a formal known gap.",
      );
    }
    if (
      statement.kind === "TRANSITION" &&
      (statement.fact_ids.length > 0 ||
        statement.entity_refs.length > 0 ||
        hasUnsupportedPredicateExpansion(statement.text) ||
        /\b(?:declare|declares|export|exports|expose|exposes|import|imports|contain|contains|skip|skips|concat(?:enate|enates)?|call|calls|read|reads|write|writes|store|stores|return|returns)\b/i.test(
          claimProse(statement.text),
        ))
    ) {
      pushFinding(
        findings,
        "TECHNICAL_FACT_HIDDEN_IN_TRANSITION",
        statement.id,
        "Transition prose cannot carry technical, outcome, safety, or performance assertions.",
      );
    }
    for (const entityId of statement.entity_refs) {
      if (!entities.has(entityId)) {
        pushFinding(
          findings,
          "UNKNOWN_ENTITY_REFERENCE",
          statement.id,
          `Entity ${entityId} does not exist in the supplied Fact IR.`,
        );
      }
    }

    const statementFacts = statement.fact_ids
      .map((factId) => facts.get(factId))
      .filter((fact): fact is GroundedFact => fact !== undefined);
    const evidenceIds = new Set(pack.evidence_refs.map((record) => record.id));
    if (
      statementFacts.some(
        (fact) =>
          fact.evidence_ids.length === 0 ||
          fact.evidence_ids.some((id) => !evidenceIds.has(id)),
      )
    ) {
      pushFinding(
        findings,
        "FACT_EVIDENCE_TRACE_BROKEN",
        statement.id,
        "A referenced Fact has no closed trace to the supplied compact Evidence index.",
      );
    }
    const claimType = classifyClaimType(statement.text);
    if (
      statement.kind === "TECHNICAL_FACT" &&
      claimType === "TYPE_RUNTIME" &&
      statementFacts.some((fact) => fact.fact_type === "TYPE_DECLARATION")
    ) {
      pushFinding(
        findings,
        "TYPE_DECLARATION_CANNOT_PROVE_RUNTIME",
        statement.id,
        "A type declaration describes the type surface and cannot prove runtime correspondence.",
      );
    }
    if (
      statement.kind === "TECHNICAL_FACT" &&
      claimType !== "TYPE_RUNTIME" &&
      hasUnsupportedPredicateExpansion(statement.text)
    ) {
      pushFinding(
        findings,
        "PREDICATE_EXPANSION",
        statement.id,
        "The prose adds an outcome, safety, immutability, or guarantee predicate that the referenced Fact does not contain.",
      );
    }
    for (const fact of statementFacts) {
      const documentationFact = isDocumentationFact(fact, entities);
      if (
        (statement.kind === "TECHNICAL_FACT" && documentationFact) ||
        (statement.kind === "DOCUMENTATION" && !documentationFact) ||
        (!["TECHNICAL_FACT", "DOCUMENTATION"].includes(statement.kind) &&
          statement.fact_ids.length > 0)
      ) {
        pushFinding(
          findings,
          "STATEMENT_FACT_INCOMPATIBLE",
          statement.id,
          "Statement status must preserve the Fact source boundary; documentation cannot become a verified technical fact.",
        );
      }
      if (SCOPE_RANK[statement.scope] > SCOPE_RANK[fact.scope]) {
        pushFinding(
          findings,
          "SCOPE_EXPANSION",
          statement.id,
          `Statement scope ${statement.scope} exceeds Fact scope ${fact.scope}.`,
        );
      }
      if (
        fact.fact_type === "DECLARATION" &&
        !declarationCompatible(statement, fact, entities)
      ) {
        pushFinding(
          findings,
          "STATEMENT_FACT_INCOMPATIBLE",
          statement.id,
          "The declaration wording does not preserve the referenced entity and predicate.",
        );
      }
      if (
        fact.fact_type === "BRANCH_BEHAVIOR" &&
        !branchCompatible(statement, fact, entities)
      ) {
        pushFinding(
          findings,
          "STATEMENT_FACT_INCOMPATIBLE",
          statement.id,
          "A branch statement must preserve its local subject, exact condition, and bounded action.",
        );
      }
      if (
        fact.fact_type === "TYPE_DECLARATION" &&
        !typeDeclarationCompatible(statement, fact, entities)
      ) {
        pushFinding(
          findings,
          "STATEMENT_FACT_INCOMPATIBLE",
          statement.id,
          "Type facts support declaration wording only; they do not establish runtime behavior.",
        );
      }
      if (
        fact.fact_type === "EXPORT" &&
        !exportCompatible(statement, fact, entities)
      ) {
        pushFinding(
          findings,
          "STATEMENT_FACT_INCOMPATIBLE",
          statement.id,
          "Export wording must preserve the exact package or module surface and exported entity.",
        );
      }
      if (
        fact.fact_type === "CONFIGURATION" &&
        !configurationCompatible(statement, fact, entities)
      ) {
        pushFinding(
          findings,
          "STATEMENT_FACT_INCOMPATIBLE",
          statement.id,
          "Configuration wording must preserve the exact manifest field and literal value or attribution.",
        );
      }
      if (
        fact.fact_type === "IMPORT_RELATION" &&
        !importCompatible(statement, fact, entities)
      ) {
        pushFinding(
          findings,
          "STATEMENT_FACT_INCOMPATIBLE",
          statement.id,
          "An import relation supports only an exact import statement between the recorded modules.",
        );
      }
      if (
        fact.fact_type === "MODULE_CONTAINS" &&
        !containmentCompatible(statement, fact, entities)
      ) {
        pushFinding(
          findings,
          "STATEMENT_FACT_INCOMPATIBLE",
          statement.id,
          "A containment Fact supports only the exact module-to-entity containment relation.",
        );
      }
    }

    const statementFindings = findings.slice(start);
    statementResults.push({
      statement_id: statement.id,
      passed: statementFindings.length === 0,
      action: statementFindings.some(
        (finding) =>
          finding.code === "COMPOUND_STATEMENT_REQUIRES_ATOMIZATION",
      )
        ? "ATOMIZE"
        : statementFindings.length === 0
          ? "ACCEPT"
          : "REJECT",
      fact_ids: [...statement.fact_ids],
      reason_codes: statementFindings.map((finding) => finding.code),
    });
  }

  const technicalStatements = statements.filter(
    (statement) => statement.kind === "TECHNICAL_FACT",
  );
  const validTechnicalIds = new Set(
    identityValid
      ? statementResults
          .filter((result) => result.passed)
          .map((result) => result.statement_id)
      : [],
  );
  if (brief.generation_metadata.mode === "model_surface") {
    const realizedFactIds = new Set(
      statements.flatMap((statement) => statement.fact_ids),
    );
    const requiredFactIds =
      options.requiredFactIds ?? plan.selected_facts.map((item) => item.fact_id);
    for (const factId of requiredFactIds) {
      if (!selectedIds.has(factId) || !realizedFactIds.has(factId)) {
        pushFinding(
          findings,
          "SELECTED_FACT_NOT_REALIZED",
          null,
          `Model-surface draft omitted required selected Fact ${factId}.`,
        );
      }
    }
  }
  return {
    gate_version: 1,
    passed: findings.length === 0,
    findings,
    statements: statementResults,
    metrics: {
      total_statements: statements.length,
      technical_statements: technicalStatements.length,
      statements_with_valid_fact_trace: technicalStatements.filter((statement) =>
        validTechnicalIds.has(statement.id),
      ).length,
    },
  };
}
