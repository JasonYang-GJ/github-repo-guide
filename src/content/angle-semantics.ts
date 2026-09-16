import type { CanonicalGroundedBriefArtifact } from "../brief/canonical.js";
import type { GroundedFact, GroundedFactPack } from "../facts/domain.js";

export type AngleSemanticField =
  | "title"
  | "editorial_thesis"
  | "why_interesting"
  | "editorial_reason"
  | "educational_value";

export type AngleClauseType =
  | "TECHNICAL"
  | "EDITORIAL_JUDGMENT"
  | "BOUNDARY_CLAIM"
  | "ABSENCE_CLAIM"
  | "SYMBOL_NAME_SEMANTIC_INFERENCE"
  | "ENGINEERING_IMPLICATION"
  | "TECHNICAL_CAUSALITY"
  | "EXTERNAL_COMPARISON"
  | "OUTCOME"
  | "SAFETY"
  | "NOVELTY"
  | "UNKNOWN_AMBIGUOUS";

export type AngleClauseStatus =
  | "FACT_TRACED"
  | "EDITORIAL_ALLOWED"
  | "REJECTED"
  | "AMBIGUOUS";

export interface AngleSemanticClauseTrace {
  readonly field: AngleSemanticField;
  readonly clause_index: number;
  readonly text: string;
  readonly clause_type: AngleClauseType;
  readonly editorial_predicate: string | null;
  readonly causal_target: "TECHNICAL" | "EDITORIAL" | null;
  readonly fact_ids: readonly string[];
  readonly untraced_anchors: readonly string[];
  readonly status: AngleClauseStatus;
}

export interface AngleSemanticAnalysis {
  readonly clause_trace: readonly AngleSemanticClauseTrace[];
  readonly technical_causality_unsupported: boolean;
  readonly untraced_technical_clause: boolean;
  readonly external_comparison_unsupported: boolean;
  readonly safety_claim_unsupported: boolean;
  readonly novelty_research_required: boolean;
  readonly boundary_claim_unsupported: boolean;
  readonly absence_claim_unsupported: boolean;
  readonly symbol_name_semantic_inference_unsupported: boolean;
  readonly engineering_implication_unsupported: boolean;
}

export const HOST_ANGLE_SEMANTICS_VERSION = 2 as const;

const TRUTH_BOUNDARY_CAVEAT_PATTERN =
  /\b(?:do(?:es)? not|doesn't|cannot|can't)\s+(?:establish|prove|show|guarantee|claim)\b|\b(?:not established|not proven|without (?:claiming|proving|overstating|inventing))\b/i;

export const EDITORIAL_PREDICATES = [
  {
    id: "truth_boundary_caveat",
    pattern: TRUTH_BOUNDARY_CAVEAT_PATTERN,
  },
  {
    id: "useful_to_teach",
    pattern:
      /\b(?:useful|good)\s+(?:(?:educational|teaching|content)\s+)?angle\b|\buseful\s+(?:way|entry point)\s+to\s+(?:teach|explain)\b/i,
  },
  {
    id: "worth_explaining",
    pattern:
      /\bworth\s+(?:explaining|teaching|examining\s+as\s+(?:an?\s+)?code[- ]organization\s+pattern)\b/i,
  },
  {
    id: "clearer_entry_point",
    pattern:
      /\bclearer\s+(?:entry point|framing|way)\b|\beasier\s+to\s+(?:navigate|understand|explain|teach)\b/i,
  },
  {
    id: "interesting_to_developers",
    pattern: /\binteresting\s+(?:to|for)\s+(?:developers?|maintainers?|creators?)\b/i,
  },
  {
    id: "helps_frame",
    pattern: /\bhelps?\s+(?:to\s+)?(?:frame|explain|teach)\b/i,
  },
  {
    id: "educationally_useful",
    pattern: /\beducational(?:ly)?\s+(?:useful|valuable)\b|\beducational value\b/i,
  },
  {
    id: "teachable_or_explainable",
    pattern: /\b(?:teachable|explainable|teaching angle|teaching seed)\b/i,
  },
] as const;

function normalized(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9_./\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SEMANTIC_STOP_WORDS = new Set([
  "the",
  "this",
  "that",
  "these",
  "those",
  "with",
  "from",
  "into",
  "together",
  "useful",
  "angle",
  "teaching",
  "explaining",
  "system",
  "shown",
  "local",
  "path",
  "how",
  "for",
  "and",
  "when",
  "makes",
  "make",
  "treats",
]);

const HIGH_SIGNAL_TECHNICAL_TERMS = new Set([
  "undefined",
  "null",
  "array",
  "export",
  "import",
  "declare",
  "type",
  "interface",
  "branch",
  "schema",
  "validator",
  "validate",
  "skip",
  "concatenate",
  "__proto__",
  "constructor",
]);

const BEHAVIOR_ACTION_TERMS = new Set([
  "authorize",
  "authenticate",
  "calculate",
  "check",
  "clean",
  "compute",
  "create",
  "delete",
  "ensure",
  "fetch",
  "format",
  "guard",
  "load",
  "optimize",
  "parse",
  "protect",
  "read",
  "render",
  "resolve",
  "sanitize",
  "save",
  "secure",
  "update",
  "validate",
  "verify",
  "write",
]);

function stemToken(value: string): string {
  const aliases: Readonly<Record<string, string>> = {
    exports: "export",
    exported: "export",
    imports: "import",
    imported: "import",
    declares: "declare",
    declared: "declare",
    declarations: "declare",
    types: "type",
    utilities: "utils",
    skips: "skip",
    skipped: "skip",
    concatenates: "concatenate",
    concatenation: "concatenate",
    validation: "validate",
    validates: "validate",
    validated: "validate",
    sanitizes: "sanitize",
    sanitized: "sanitize",
    sanitization: "sanitize",
    checks: "check",
    checked: "check",
    checking: "check",
    optimizes: "optimize",
    optimized: "optimize",
    optimization: "optimize",
    fetches: "fetch",
    fetched: "fetch",
    fetching: "fetch",
    safely: "secure",
    safety: "secure",
    securely: "secure",
    security: "secure",
    secures: "secure",
    secured: "secure",
  };
  return aliases[value] ?? value;
}

function semanticTokens(value: string): Set<string> {
  const values = normalized(value)
    .replace(/[_./\-]+/g, " ")
    .split(/\s+/)
    .map(stemToken)
    .filter((token) => token.length > 1 && !SEMANTIC_STOP_WORDS.has(token));
  const tokens = new Set(values);
  if (tokens.has("nullish")) {
    tokens.add("null");
    tokens.add("undefined");
  }
  return tokens;
}

function extractCodeAnchors(value: string): string[] {
  return [...value.matchAll(/`([^`]+)`/g)]
    .map((match) => normalized(match[1] ?? ""))
    .filter((anchor) => anchor.length > 0);
}

function factCorpus(
  fact: GroundedFact,
  pack: GroundedFactPack,
  canonical: CanonicalGroundedBriefArtifact,
): string {
  const entityById = new Map(pack.entities.map((entity) => [entity.id, entity]));
  const statements = canonical.brief.sections
    .flatMap((section) => section.statements)
    .filter((statement) => statement.fact_ids.includes(fact.id));
  const entities = [fact.subject_ref, fact.object_ref].flatMap((entityId) => {
    const entity = entityById.get(entityId);
    return entity === undefined
      ? []
      : [entity.display_label, entity.source_path, entity.symbol?.name ?? ""];
  });
  return normalized(
    [
      fact.fact_type,
      fact.category,
      fact.predicate,
      fact.scope,
      ...entities,
      ...statements.map((statement) => statement.text),
    ].join(" "),
  );
}

function splitClauses(value: string): string[] {
  const sentences = value
    .split(/(?<=[.!?;])\s+/)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
  return sentences.flatMap((sentence) => splitCoordinatedClause(sentence));
}

function hasFinitePredicate(value: string): boolean {
  return /\b(?:is|are|has|have|exports?|imports?|declares?|contains?|checks?|validates?|skips?|concatenates?|uses?|points?|exposes?|makes?|causes?|prevents?|ensures?|guarantees?|improves?|reduces?|shows?|suggests?|establishes?|proves?)\b/i.test(
    value,
  );
}

function splitCoordinatedClause(value: string): string[] {
  const parts = value.split(/\s+(?:,\s*)?(?:and|but|while|whereas|though)\s+/i);
  if (
    parts.length <= 1 ||
    !parts.every((part) => hasFinitePredicate(part.trim()))
  ) {
    return [value];
  }
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

function editorialPredicate(value: string): string | null {
  return EDITORIAL_PREDICATES.find((predicate) => predicate.pattern.test(value))
    ?.id ?? null;
}

function hasCausalLanguage(value: string): boolean {
  return /\b(?:because|therefore|causes?|leads? to|results? in|prevents?|ensures?|guarantees?|improves?|reduces?|makes?)\b/i.test(
    value,
  );
}

function hasTechnicalLanguage(value: string): boolean {
  return /`[^`]+`|\b(?:module|package|function|type|interface|schema|validator|branch|runtime|export|import|declare|contain|check|validate|skip|concatenate|undefined|null|array|configuration)\w*\b/i.test(
    value,
  );
}

function hasExternalComparison(value: string): boolean {
  return /\b(?:unlike|compared (?:with|to)|(?:(?:more|less)\s+(?:reliable|safe|secure|efficient)|better|worse|faster|slower|safer)\s+than\s+(?:traditional|competing|other|most|every)\s+(?:libraries|projects|systems|tools|implementations|architecture tools?))\b|不同于|相比于|优于|胜过/i.test(
    value,
  );
}

function hasSafetyClaim(value: string): boolean {
  if (TRUTH_BOUNDARY_CAVEAT_PATTERN.test(value)) return false;
  return /\b(?:safe|safer|secure|security|vulnerability-free|production-safe|prototype[- ]pollution|dangerous prototype keys?|guard against prototype)\b|安全|无漏洞/i.test(
    value,
  );
}

function hasNoveltyClaim(value: string): boolean {
  return /\b(?:first (?:implementation|library|project|tool|use)|novel|unprecedented|world[- ]first)\b|首次|首个|前所未有/i.test(
    value,
  );
}

function hasOutcomeClaim(value: string): boolean {
  return /\b(?:bug-free|reliable|reliability outcome|correctness outcome|low latency|high throughput|memory efficient)\b|\b(?:prevents?|eliminates?|reduces?)\s+(?:runtime\s+)?(?:bugs?|errors?)\b|\bimproves?\s+(?:reliability|correctness|performance)\b|\bguarantees?\b[^.!?;]*\b(?:correct|correctness|reliable|safe)\b|避免运行时错误|防止错误|无错误|可靠性/i.test(
    value,
  );
}

function hasBoundaryClaim(value: string): boolean {
  if (TRUTH_BOUNDARY_CAVEAT_PATTERN.test(value)) return false;
  return /\b(?:strict|clear|hard|isolated|architectural)\s+(?:(?:cross[- ]module|engineering|technical|static|dependency)\s+)*boundary\b|\benforces?\s+(?:an?\s+)?(?:(?:strict|clear|hard|isolated|architectural)\s+)?(?:(?:cross[- ]module|engineering|technical|static|dependency)\s+)*boundary\b/i.test(
    value,
  );
}

function hasAbsenceClaim(value: string): boolean {
  if (TRUTH_BOUNDARY_CAVEAT_PATTERN.test(value)) return false;
  return /\bwithout\s+(?:(?:an?|any)\s+)?(?:(?:intermediate|local)\s+)*(?:wrappers?|layers?|adapters?|indirection)\b|\bno\s+(?:(?:other|intermediate|local)\s+)*(?:wrappers?|layers?|adapters?|modules?|functions?|methods?|paths?|calls?|dependencies)\b|\bno\s+way\s+to\s+bypass\b|\bnever\s+(?:calls?|invokes?|imports?|depends?)\b|\bdoes\s+not\s+depend\b|\bnothing\s+else\b|\bonly\s+(?:function|method|module|path|call|implementation)\b/i.test(
    value,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function modelVisibleEntityNames(
  facts: readonly GroundedFact[],
  pack: GroundedFactPack,
): string[] {
  const referencedEntityIds = new Set(
    facts.flatMap((fact) => [fact.subject_ref, fact.object_ref]),
  );
  return [
    ...new Set(
      pack.entities
        .filter((entity) => referencedEntityIds.has(entity.id))
        .flatMap((entity) => [entity.symbol?.name, entity.display_label])
        .filter((value): value is string => value !== undefined && value.length > 1),
    ),
  ].sort((left, right) => right.length - left.length || left.localeCompare(right));
}

function withoutEntityNames(value: string, names: readonly string[]): string {
  const variants = [
    ...new Set(names.flatMap((name) => [name, normalized(name)])),
  ].sort((left, right) => right.length - left.length || left.localeCompare(right));
  return variants.reduce(
    (remaining, name) =>
      remaining.replace(new RegExp(escapeRegExp(name), "gi"), " "),
    value,
  );
}

function hasUnsupportedSymbolNameInference(
  clause: string,
  facts: readonly GroundedFact[],
  pack: GroundedFactPack,
  canonical: CanonicalGroundedBriefArtifact,
): boolean {
  if (
    TRUTH_BOUNDARY_CAVEAT_PATTERN.test(clause) ||
    editorialPredicate(clause) !== null ||
    facts.some((fact) => fact.category === "BEHAVIORAL")
  ) {
    return false;
  }
  const names = modelVisibleEntityNames(facts, pack);
  const nameActionTerms = new Set(
    names.flatMap((name) =>
      [...semanticTokens(name)].filter((token) => BEHAVIOR_ACTION_TERMS.has(token)),
    ),
  );
  if (nameActionTerms.size === 0) return false;
  const proseTokens = semanticTokens(
    withoutEntityNames(clause.replace(/`[^`]+`/g, " "), names),
  );
  const evidenceTokens = new Set(
    facts.flatMap((fact) => [
      ...semanticTokens(withoutEntityNames(factCorpus(fact, pack, canonical), names)),
    ]),
  );
  return [...nameActionTerms].some(
    (term) => proseTokens.has(term) && !evidenceTokens.has(term),
  );
}

function hasEngineeringImplication(value: string): boolean {
  if (TRUTH_BOUNDARY_CAVEAT_PATTERN.test(value)) return false;
  return /\bmaintainab(?:ility|le)\b|\btestab(?:ility|le)\b|\beasier\s+(?:to\s+test|testing)\b|\bclear\s+maintenance\s+boundary\b|\bboundary\s+for\s+(?:maintenance|testing)(?:\s+and\s+(?:maintenance|testing))?\b|\b(?:maintenance|testing)(?:\s+and\s+(?:maintenance|testing))?\s+boundary\b|\bmodularity\s+benefit\b|\b(?:improves?|increases?|strengthens?|provides?|delivers?|ensures?|guarantees?)\b[^.!?;]{0,80}\b(?:reliability|extensibility|scalability|performance|correctness|robustness|maintainability|testability)\b|\b(?:more|highly)\s+(?:reliable|extensible|scalable|performant|correct|robust|maintainable|testable)\b/i.test(
    value,
  );
}

function hasSupportedModuleAggregate(
  clause: string,
  facts: readonly GroundedFact[],
  pack: GroundedFactPack,
): boolean {
  const countMatch = clause.match(/\b(two|2)\b[^.!?;]{0,50}\bmodules?\b/i);
  if (countMatch === null || !/\b(?:verified|cited)\b/i.test(clause)) return false;
  const entityById = new Map(pack.entities.map((entity) => [entity.id, entity]));
  const pathCount = (entityIds: readonly string[]) =>
    new Set(
      entityIds
        .map((entityId) => entityById.get(entityId)?.source_path)
        .filter((path): path is string => path !== undefined),
    ).size;
  if (/\b(?:callees?|targets?)\b/i.test(clause)) {
    return pathCount(facts.map((fact) => fact.object_ref)) === 2;
  }
  if (/\b(?:call sites?|call relations?)\b/i.test(clause)) {
    return pathCount(facts.map((fact) => fact.subject_ref)) === 2;
  }
  return false;
}

export function analyzeAngleSemanticFields(
  fields: Readonly<Record<AngleSemanticField, string>>,
  facts: readonly GroundedFact[],
  pack: GroundedFactPack,
  canonical: CanonicalGroundedBriefArtifact,
): AngleSemanticAnalysis {
  const corpora = new Map(
    facts.map((fact) => [fact.id, factCorpus(fact, pack, canonical)]),
  );
  const clauseTrace: AngleSemanticClauseTrace[] = [];
  let symbolNameSemanticInferenceUnsupported = false;
  let engineeringImplicationUnsupported = false;

  for (const field of [
    "title",
    "editorial_thesis",
    "why_interesting",
    "editorial_reason",
    "educational_value",
  ] as const) {
    splitClauses(fields[field]).forEach((clause, clauseIndex) => {
      const predicate = editorialPredicate(clause);
      const causal = hasCausalLanguage(clause);
      const externalComparison = hasExternalComparison(clause);
      const noveltyClaim = hasNoveltyClaim(clause);
      const safetyClaim = hasSafetyClaim(clause);
      const technicalCausality =
        causal &&
        predicate === null &&
        !externalComparison &&
        !noveltyClaim &&
        !safetyClaim;
      const outcomeClaim = hasOutcomeClaim(clause);
      const boundaryClaim = hasBoundaryClaim(clause);
      const absenceClaim = hasAbsenceClaim(clause);
      const symbolNameInference = hasUnsupportedSymbolNameInference(
        clause,
        facts,
        pack,
        canonical,
      );
      symbolNameSemanticInferenceUnsupported ||= symbolNameInference;
      const engineeringImplication = hasEngineeringImplication(clause);
      engineeringImplicationUnsupported ||= engineeringImplication;
      const technical = hasTechnicalLanguage(clause);
      const anchors = extractCodeAnchors(clause);
      const clauseTokens = semanticTokens(clause);
      const supportedModuleAggregate = hasSupportedModuleAggregate(
        clause,
        facts,
        pack,
      );
      const matchedFacts = facts
        .filter((fact) => {
          if (supportedModuleAggregate) return true;
          const corpus = corpora.get(fact.id) ?? "";
          if (anchors.some((anchor) => corpus.includes(anchor))) return true;
          const factTokens = semanticTokens(corpus);
          return [...clauseTokens].some(
            (token) =>
              HIGH_SIGNAL_TECHNICAL_TERMS.has(token) && factTokens.has(token),
          );
        })
        .map((fact) => fact.id);
      const untracedAnchors = anchors.filter(
        (anchor) =>
          ![...corpora.values()].some((corpus) => corpus.includes(anchor)),
      );
      const clauseType: AngleClauseType = externalComparison
        ? "EXTERNAL_COMPARISON"
        : noveltyClaim
          ? "NOVELTY"
          : safetyClaim
            ? "SAFETY"
            : absenceClaim
              ? "ABSENCE_CLAIM"
              : boundaryClaim
              ? "BOUNDARY_CLAIM"
              : technicalCausality
              ? "TECHNICAL_CAUSALITY"
              : outcomeClaim
                ? "OUTCOME"
                  : technical && predicate === null
                  ? "TECHNICAL"
                  : predicate === null
                    ? "UNKNOWN_AMBIGUOUS"
                    : engineeringImplication
                      ? "ENGINEERING_IMPLICATION"
                      : symbolNameInference
                      ? "SYMBOL_NAME_SEMANTIC_INFERENCE"
                      : "EDITORIAL_JUDGMENT";
      const status: AngleClauseStatus =
        externalComparison ||
        noveltyClaim ||
        safetyClaim ||
        absenceClaim ||
        boundaryClaim ||
        technicalCausality ||
        outcomeClaim
          ? "REJECTED"
          : predicate !== null && untracedAnchors.length > 0
            ? "REJECTED"
            : predicate !== null
              ? "EDITORIAL_ALLOWED"
              : technical &&
                  (untracedAnchors.length > 0 || matchedFacts.length === 0)
                ? "REJECTED"
                : technical
                  ? "FACT_TRACED"
                  : "AMBIGUOUS";
      clauseTrace.push({
        field,
        clause_index: clauseIndex,
        text: clause,
        clause_type: clauseType,
        editorial_predicate: predicate,
        causal_target:
          technicalCausality || (safetyClaim && causal)
            ? "TECHNICAL"
            : causal && predicate !== null
              ? "EDITORIAL"
              : null,
        fact_ids: matchedFacts,
        untraced_anchors: untracedAnchors,
        status,
      });
    });
  }

  return {
    clause_trace: clauseTrace,
    technical_causality_unsupported: clauseTrace.some(
      (clause) => clause.causal_target === "TECHNICAL",
    ),
    untraced_technical_clause: clauseTrace.some(
      (clause) =>
        (clause.clause_type === "TECHNICAL" &&
          clause.status === "REJECTED") ||
        (clause.untraced_anchors.length > 0 &&
          clause.editorial_predicate !== "truth_boundary_caveat"),
    ),
    external_comparison_unsupported: clauseTrace.some(
      (clause) => clause.clause_type === "EXTERNAL_COMPARISON",
    ),
    safety_claim_unsupported: clauseTrace.some(
      (clause) => clause.clause_type === "SAFETY",
    ),
    novelty_research_required: clauseTrace.some(
      (clause) => clause.clause_type === "NOVELTY",
    ),
    boundary_claim_unsupported: clauseTrace.some(
      (clause) => clause.clause_type === "BOUNDARY_CLAIM",
    ),
    absence_claim_unsupported: clauseTrace.some(
      (clause) => clause.clause_type === "ABSENCE_CLAIM",
    ),
    symbol_name_semantic_inference_unsupported:
      symbolNameSemanticInferenceUnsupported,
    engineering_implication_unsupported: engineeringImplicationUnsupported,
  };
}
