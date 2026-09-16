import { createHash } from "node:crypto";

import { assertHumanStoryComposerContextIntegrity } from "./human-story-composer.js";
import type {
  HumanEditorialCompositionDraft,
  ComposerFactOption,
  HumanStoryComposerContext,
} from "./human-story-composer.js";
import type { SchemaRegistry } from "../schemas/registry.js";

export const HUMAN_INPUT_HOST_SEMANTICS_VERSION = 3 as const;

export type HumanEditorialSourceField =
  | "title"
  | "editorial_thesis"
  | "why_this_story";

export type HumanAssertionPolarity =
  | "AFFIRMED"
  | "NEGATED"
  | "QUESTIONED"
  | "MENTIONED";

export type HumanSemanticClauseKind =
  | "TECHNICAL_CLAIM"
  | "EDITORIAL_FRAMING"
  | "QUESTION"
  | "BOUNDARY_CAVEAT"
  | "SAFETY"
  | "OUTCOME"
  | "DESIGN_INTENT"
  | "UNKNOWN";

export interface HumanSemanticClauseV3 {
  readonly clause_id: string;
  readonly source_field: HumanEditorialSourceField;
  readonly source_span: {
    readonly start: number;
    readonly end: number;
  };
  readonly text: string;
  readonly clause_kind: HumanSemanticClauseKind;
  readonly polarity: HumanAssertionPolarity;
  readonly supporting_fact_refs: readonly string[];
  readonly unsupported_anchors: readonly string[];
  readonly failure_codes: readonly string[];
  readonly truth_status: "PASS" | "FAIL";
  readonly diagnostic: {
    readonly what_is_supported: string;
    readonly what_is_missing: string | null;
    readonly classification_uncertainty: string | null;
  };
}

export interface AnalyzeHumanEditorialFieldsV3Input {
  readonly fields: Readonly<Record<HumanEditorialSourceField, string>>;
  readonly selected_fact_options: readonly ComposerFactOption[];
  readonly minimal_project_identity: HumanStoryComposerContext["minimal_project_identity"];
}

export interface HumanEditorialSemanticAnalysisV3 {
  readonly host_semantics_version: typeof HUMAN_INPUT_HOST_SEMANTICS_VERSION;
  readonly field_local_semantic_isolation: true;
  readonly clauses: readonly HumanSemanticClauseV3[];
}

export interface HumanCompositionValidationV2 {
  readonly human_composition_validation_version: 2;
  readonly composition_id: string;
  readonly validation_version: 2;
  readonly source_host_semantics_version: 2;
  readonly host_semantics_version: typeof HUMAN_INPUT_HOST_SEMANTICS_VERSION;
  readonly repository: HumanStoryComposerContext["repository"];
  readonly commit: string;
  readonly fact_ir_version: number;
  readonly neighborhood_id: string;
  readonly neighborhood_fingerprint_sha256: string;
  readonly composer_context_fingerprint_sha256: string;
  readonly original_draft_fingerprint_sha256: string;
  readonly replay_draft_fingerprint_sha256: string;
  readonly semantic_input_unchanged: true;
  readonly selected_facts_valid: boolean;
  readonly selected_fact_resolution: readonly {
    readonly display_id: string;
    readonly canonical_fact_id: string | null;
    readonly status: "RESOLVED" | "REJECTED";
  }[];
  readonly clause_traces: readonly HumanSemanticClauseV3[];
  readonly unsupported_clauses: readonly HumanSemanticClauseV3[];
  readonly known_unknown_conflicts: readonly string[];
  readonly reason_codes: readonly string[];
  readonly truth_status: "PASS" | "FAIL";
  readonly composition_status: "HOST_VALIDATED" | "HOST_REJECTED" | "STALE";
  readonly script_eligibility: {
    readonly eligible: false;
    readonly status: "NOT_ELIGIBLE";
    readonly reason:
      | "HUMAN_CONFIRMATION_REQUIRED"
      | "HOST_TRUTH_VALIDATION_FAILED"
      | "COMPOSITION_BINDING_STALE";
  };
  readonly generation_metadata: {
    readonly mode: "deterministic_offline_human_composition_validation_v2";
    readonly paid_api_requests: 0;
    readonly real_model_requests: 0;
    readonly secret_reads: 0;
    readonly repository_executions: 0;
  };
  readonly validation_fingerprint_sha256: string;
}

export interface ValidateHumanEditorialCompositionV2Input {
  readonly context: HumanStoryComposerContext;
  readonly draft: HumanEditorialCompositionDraft;
  readonly schemas: SchemaRegistry;
}

interface SegmentedClause {
  readonly source_field: HumanEditorialSourceField;
  readonly source_span: HumanSemanticClauseV3["source_span"];
  readonly text: string;
  readonly polarity_hint?: "NEGATED" | "MENTIONED";
}

function hasNegatedAssertion(value: string): boolean {
  return /(?:^|[，,:：\s“”'"（(])(?:这|那)?(?:并)?不是|没有(?:被)?证明|不能证明|无法证明|不意味着|不代表|我不是在说|不要把[^。！？!?]*理解成|(?:我的?|我想讲的)重点不是/i.test(
    value,
  );
}

function hasSafetyLanguage(value: string): boolean {
  return /\b(?:safe|safer|secure|security|guarantees? safety|prevents? all attacks?)\b|安全|阻止所有攻击|防止所有攻击/i.test(
    value,
  );
}

function hasUniversalTechnicalClaim(value: string): boolean {
  return /(?:所有|全部|每个)(?:请求|路径|调用|情况)|\b(?:all|every)\s+(?:requests?|paths?|calls?|cases?)\b/i.test(
    value,
  );
}

function hasEditorialFraming(value: string): boolean {
  return /我(?:更)?想(?:讲|借|提醒)|我觉得|我的重点|值得(?:看|检查|讲|关注|解释)|对于[^。！？!?]*(?:用户|开发者)|HUMAN\s+EDITORIAL\s+FRAMING|功能写出来不算完/i.test(
    value,
  );
}

function hasObjectiveGateLanguage(value: string): boolean {
  return (
    hasSafetyLanguage(value) ||
    hasUniversalTechnicalClaim(value) ||
    /(?:设计意图|Design Intent|保证|可靠|正确性|运行时|阻止|防止)/i.test(value)
  );
}

function hasDesignIntentClaim(value: string): boolean {
  return /(?:作者|设计者)[^。！？!?]*(?:意图|为了|旨在|想要)|\b(?:design intent|designed to|intended to|purpose is)\b/i.test(
    value,
  );
}

function hasOutcomeClaim(value: string): boolean {
  return /(?:可靠性|正确性|性能|无错误|避免错误|保证正确|保证可靠)|\b(?:reliable|correctness|bug-free|improves? performance|prevents? errors?)\b/i.test(
    value,
  );
}

function hasAbsenceClaim(value: string): boolean {
  return /(?:没有|不存在|唯一)(?:其他|任何)?(?:路径|调用|分支|方法|函数|模块)|\b(?:no|only|never)\s+(?:other\s+)?(?:path|call|branch|method|function|module)s?\b/i.test(
    value,
  );
}

function hasEditorialTransition(value: string): boolean {
  return /(?:切进去|看它周围|这里属于|而是|除了成功路径|这段局部代码里)[^。！？!?]*[，,:：]$/i.test(
    value,
  );
}

function matchingSelectedFacts(
  value: string,
  facts: readonly ComposerFactOption[],
): ComposerFactOption[] {
  const normalized = value.toLowerCase();
  const genericCalls = /direct\s+static\s+calls?|静态调用/i.test(value);
  const genericBranches =
    /(?:失败|处理|throw)\s*(?:条件|路径|分支|branches?)|失败分支|失败条件|处理分支/i.test(
      value,
    ) ||
    (/失败/.test(value) && /(?:情况|条件|路径|分支)/.test(value));
  return facts.filter((fact) => {
    if (genericCalls && fact.host_truth.predicate === "CALLS") return true;
    if (genericBranches && fact.host_truth.predicate === "THROWS_WHEN") return true;
    const subject = fact.host_truth.subject.toLowerCase();
    const object = fact.host_truth.object.toLowerCase();
    if (normalized.includes(object)) return true;
    if (
      fact.host_truth.predicate === "CALLS" &&
      normalized.includes(subject) &&
      normalized.includes(fact.host_truth.object.toLowerCase())
    ) {
      return true;
    }
    if (
      fact.host_truth.predicate === "THROWS_WHEN" &&
      ((object.includes("deadline") && normalized.includes("deadline")) ||
        (object.includes("location") && /location|redirect/.test(normalized)) ||
        (object.includes("response.ok") && /response\.ok|非\s*ok|not\s+ok/.test(normalized)))
    ) {
      return true;
    }
    return false;
  });
}

function hasTechnicalClaim(value: string): boolean {
  return /\b(?:direct\s+static\s+calls?|throw\s+branches?|calls?|runtime|branch|condition)\b|调用|分支|条件|源码明确证明|`[^`]+`|\b[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*(?:\(\))?/i.test(
    value,
  );
}

function unsupportedTechnicalAnchors(
  value: string,
  facts: readonly ComposerFactOption[],
): string[] {
  const known = new Set(
    facts.flatMap((fact) => [
      fact.host_truth.subject.toLowerCase(),
      fact.host_truth.object.toLowerCase(),
      ...fact.host_truth.object
        .match(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*(?:\(\))?)?/g)
        ?.map((item) => item.toLowerCase()) ?? [],
    ]),
  );
  const ignored = new Set([
    "direct",
    "static",
    "calls",
    "call",
    "throw",
    "branch",
    "condition",
  ]);
  return [
    ...new Set(
      (value.match(/\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*(?:\(\))?)?\b/g) ?? [])
        .filter((anchor) => {
          const normalized = anchor.toLowerCase();
          return !known.has(normalized) && !ignored.has(normalized);
        }),
    ),
  ];
}

function classifyClause(
  clause: SegmentedClause,
  selectedFacts: readonly ComposerFactOption[],
): Pick<
  HumanSemanticClauseV3,
  | "clause_kind"
  | "polarity"
  | "failure_codes"
  | "truth_status"
  | "diagnostic"
> {
  const matchedFacts = matchingSelectedFacts(clause.text, selectedFacts);
  if (clause.polarity_hint === "NEGATED" || hasNegatedAssertion(clause.text)) {
    return {
      clause_kind: "BOUNDARY_CAVEAT",
      polarity: "NEGATED",
      failure_codes: [],
      truth_status: "PASS",
      diagnostic: {
        what_is_supported:
          "The clause limits or rejects a claim; it does not assert the inverse as fact.",
        what_is_missing: null,
        classification_uncertainty: null,
      },
    };
  }
  if (
    clause.polarity_hint === "MENTIONED" ||
    /^(?:“[\s\S]+”|"[\s\S]+"|'[\s\S]+')$/.test(clause.text)
  ) {
    return {
      clause_kind: "BOUNDARY_CAVEAT",
      polarity: "MENTIONED",
      failure_codes: [],
      truth_status: "PASS",
      diagnostic: {
        what_is_supported:
          "The clause mentions a claim without treating the quoted text as an affirmed fact.",
        what_is_missing: null,
        classification_uncertainty: null,
      },
    };
  }
  if (/[?？]\s*$/.test(clause.text)) {
    const unsupportedPremise =
      hasSafetyLanguage(clause.text) ||
      hasUniversalTechnicalClaim(clause.text) ||
      hasDesignIntentClaim(clause.text) ||
      hasOutcomeClaim(clause.text) ||
      hasAbsenceClaim(clause.text) ||
      (/(?:失败分支|失败条件|处理分支|direct\s+static\s+calls?)/i.test(
        clause.text,
      ) &&
        matchedFacts.length === 0);
    return {
      clause_kind: "QUESTION",
      polarity: "QUESTIONED",
      failure_codes: unsupportedPremise
        ? ["QUESTION_PREMISE_UNSUPPORTED"]
        : [],
      truth_status: unsupportedPremise ? "FAIL" : "PASS",
      diagnostic: {
        what_is_supported:
          matchedFacts.length > 0
            ? `${matchedFacts.length} selected Fact(s) support the question premise.`
            : "The question is editorial framing and contains no unsupported objective premise.",
        what_is_missing: unsupportedPremise
          ? "Selected Facts supporting the question's own technical premise."
          : null,
        classification_uncertainty: null,
      },
    };
  }
  if (hasDesignIntentClaim(clause.text)) {
    return {
      clause_kind: "DESIGN_INTENT",
      polarity: "AFFIRMED",
      failure_codes: ["DESIGN_INTENT_UNSUPPORTED"],
      truth_status: "FAIL",
      diagnostic: {
        what_is_supported: "Selected Facts describe authored code structure only.",
        what_is_missing:
          "Selected Evidence directly establishing the author's stated design intent.",
        classification_uncertainty: null,
      },
    };
  }
  if (hasOutcomeClaim(clause.text)) {
    return {
      clause_kind: "OUTCOME",
      polarity: "AFFIRMED",
      failure_codes: ["OUTCOME_CLAIM_UNSUPPORTED"],
      truth_status: "FAIL",
      diagnostic: {
        what_is_supported: "Selected Facts do not establish the claimed outcome.",
        what_is_missing: "Runtime or outcome Evidence supporting this exact claim.",
        classification_uncertainty: null,
      },
    };
  }
  if (hasAbsenceClaim(clause.text)) {
    return {
      clause_kind: "TECHNICAL_CLAIM",
      polarity: "AFFIRMED",
      failure_codes: ["ABSENCE_CLAIM_UNSUPPORTED"],
      truth_status: "FAIL",
      diagnostic: {
        what_is_supported: "Selected Facts are positive bounded observations.",
        what_is_missing: "Completeness Evidence supporting the absence claim.",
        classification_uncertainty: null,
      },
    };
  }
  if (hasSafetyLanguage(clause.text)) {
    return {
      clause_kind: "SAFETY",
      polarity: "AFFIRMED",
      failure_codes: ["SAFETY_CLAIM_UNSUPPORTED"],
      truth_status: "FAIL",
      diagnostic: {
        what_is_supported: "No selected Fact establishes a safety guarantee.",
        what_is_missing: "Selected Safety Evidence supporting this exact claim.",
        classification_uncertainty: null,
      },
    };
  }
  if (hasUniversalTechnicalClaim(clause.text)) {
    return {
      clause_kind: "TECHNICAL_CLAIM",
      polarity: "AFFIRMED",
      failure_codes: ["UNIVERSAL_QUANTIFIER_UNSUPPORTED"],
      truth_status: "FAIL",
      diagnostic: {
        what_is_supported: "The selected Facts are bounded local observations.",
        what_is_missing:
          "Completeness Evidence proving the universal coverage asserted by this clause.",
        classification_uncertainty: null,
      },
    };
  }
  if (hasEditorialFraming(clause.text) || hasEditorialTransition(clause.text)) {
    return {
      clause_kind: "EDITORIAL_FRAMING",
      polarity: "AFFIRMED",
      failure_codes: [],
      truth_status: "PASS",
      diagnostic: {
        what_is_supported:
          "This is a Human editorial choice or judgment, not an objective repository outcome.",
        what_is_missing: null,
        classification_uncertainty: null,
      },
    };
  }
  if (hasTechnicalClaim(clause.text)) {
    const supported = matchedFacts.length > 0;
    return {
      clause_kind: "TECHNICAL_CLAIM",
      polarity: "AFFIRMED",
      failure_codes: supported
        ? []
        : ["NO_SELECTED_FACT_SUPPORTS_THIS_CLAUSE"],
      truth_status: supported ? "PASS" : "FAIL",
      diagnostic: {
        what_is_supported: supported
          ? `${matchedFacts.length} selected Fact(s) support this exact bounded technical clause.`
          : "No selected Fact supports this technical clause.",
        what_is_missing: supported
          ? null
          : "A Selected Fact bound to this repository and commit that supports the exact clause.",
        classification_uncertainty: null,
      },
    };
  }
  return {
    clause_kind: "UNKNOWN",
    polarity: /[?？]\s*$/.test(clause.text) ? "QUESTIONED" : "AFFIRMED",
    failure_codes: ["CLASSIFICATION_UNCERTAIN"],
    truth_status: "FAIL",
    diagnostic: {
      what_is_supported: "The clause boundary is known, but its semantic role is not.",
      what_is_missing:
        "A recognizable editorial form or an exact Selected Fact trace.",
      classification_uncertainty:
        "The clause is neither recognized editorial framing nor a traceable technical claim.",
    },
  };
}

function isAsciiSentencePeriod(value: string, index: number): boolean {
  if (value[index] !== ".") return false;
  const next = value[index + 1];
  return next === undefined || /\s/.test(next);
}

function trimSegment(
  value: string,
  field: HumanEditorialSourceField,
  rawStart: number,
  rawEnd: number,
): SegmentedClause | null {
  const raw = value.slice(rawStart, rawEnd);
  const leading = raw.match(/^\s*(?:[-*+]\s+)?/)?.[0].length ?? 0;
  const trailing = raw.match(/\s*$/)?.[0].length ?? 0;
  const start = rawStart + leading;
  const end = Math.max(start, rawEnd - trailing);
  const text = value.slice(start, end);
  if (text.length === 0) return null;
  return {
    source_field: field,
    source_span: { start, end },
    text,
  };
}

function segmentField(
  field: HumanEditorialSourceField,
  value: string,
): SegmentedClause[] {
  const clauses: SegmentedClause[] = [];
  let start = 0;
  const push = (end: number) => {
    const clause = trimSegment(value, field, start, end);
    if (clause !== null) clauses.push(clause);
    start = end;
  };
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (
      character === "。" ||
      character === "？" ||
      character === "！" ||
      character === "；" ||
      character === "?" ||
      character === "!" ||
      character === ";" ||
      isAsciiSentencePeriod(value, index)
    ) {
      push(index + 1);
      continue;
    }
    if (character === "\n") push(index);
  }
  push(value.length);
  const split = clauses.flatMap((clause) => splitEditorialWrapper(clause));
  let pendingNegation = false;
  return split.map((clause) => {
    const polarityHint = pendingNegation
      ? ("NEGATED" as const)
      : undefined;
    pendingNegation = /(?:不是|并不是|我不是在说|重点不是)\s*[:：]\s*$/.test(
      clause.text,
    );
    return polarityHint === undefined
      ? clause
      : { ...clause, polarity_hint: polarityHint };
  });
}

function splitEditorialWrapper(clause: SegmentedClause): SegmentedClause[] {
  const match = /^(.*?[，,])\s*(.+)$/s.exec(clause.text);
  if (
    match === null ||
    match[1] === undefined ||
    match[2] === undefined ||
    !hasEditorialFraming(match[1]) ||
    !hasObjectiveGateLanguage(match[2])
  ) {
    return [clause];
  }
  const suffixOffset = clause.text.indexOf(match[2]);
  return [
    {
      source_field: clause.source_field,
      source_span: {
        start: clause.source_span.start,
        end: clause.source_span.start + match[1].length,
      },
      text: match[1],
    },
    {
      source_field: clause.source_field,
      source_span: {
        start: clause.source_span.start + suffixOffset,
        end: clause.source_span.end,
      },
      text: match[2],
    },
  ];
}

export function analyzeHumanEditorialFieldsV3(
  input: AnalyzeHumanEditorialFieldsV3Input,
): HumanEditorialSemanticAnalysisV3 {
  const segmented = (
    ["title", "editorial_thesis", "why_this_story"] as const
  ).flatMap((field) => segmentField(field, input.fields[field]));
  const counters = new Map<HumanEditorialSourceField, number>();
  return {
    host_semantics_version: HUMAN_INPUT_HOST_SEMANTICS_VERSION,
    field_local_semantic_isolation: true,
    clauses: segmented.map((clause) => {
      const index = counters.get(clause.source_field) ?? 0;
      counters.set(clause.source_field, index + 1);
      const classification = classifyClause(clause, input.selected_fact_options);
      const matchedFacts = matchingSelectedFacts(
        clause.text,
        input.selected_fact_options,
      );
      return {
        clause_id: `${clause.source_field}_${String(index + 1).padStart(3, "0")}`,
        source_field: clause.source_field,
        source_span: clause.source_span,
        text: clause.text,
        ...classification,
        supporting_fact_refs:
          classification.clause_kind === "QUESTION" ||
          classification.clause_kind === "TECHNICAL_CLAIM"
            ? matchedFacts.map((fact) => fact.canonical_fact_id)
            : [],
        unsupported_anchors:
          classification.failure_codes.includes(
            "NO_SELECTED_FACT_SUPPORTS_THIS_CLAUSE",
          )
            ? unsupportedTechnicalAnchors(
                clause.text,
                input.selected_fact_options,
              )
            : [],
      };
    }),
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

function sha256(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(value)), "utf8")
    .digest("hex");
}

function sameRepository(
  left: HumanStoryComposerContext["repository"],
  right: HumanEditorialCompositionDraft["repository"],
): boolean {
  return left.url === right.url && left.owner === right.owner && left.name === right.name;
}

function validationBodyV2(
  validation: HumanCompositionValidationV2,
): Omit<HumanCompositionValidationV2, "validation_fingerprint_sha256"> {
  const { validation_fingerprint_sha256: _fingerprint, ...body } = validation;
  return body;
}

export function validateHumanEditorialCompositionV2(
  input: ValidateHumanEditorialCompositionV2Input,
): HumanCompositionValidationV2 {
  assertHumanStoryComposerContextIntegrity(input.context);
  input.schemas.assert("HumanStoryComposerContext", input.context);
  input.schemas.assert("HumanEditorialCompositionDraft", input.draft);

  const bindingReasons: string[] = [];
  if (!sameRepository(input.context.repository, input.draft.repository)) {
    bindingReasons.push("REPOSITORY_CHANGED");
  }
  if (input.context.commit !== input.draft.commit) {
    bindingReasons.push("REPOSITORY_COMMIT_CHANGED");
  }
  if (input.context.fact_ir_version !== input.draft.fact_ir_version) {
    bindingReasons.push("FACT_IR_VERSION_CHANGED");
  }
  if (input.context.host_semantics_version !== input.draft.host_semantics_version) {
    bindingReasons.push("SOURCE_HOST_SEMANTICS_VERSION_CHANGED");
  }
  if (input.context.neighborhood.neighborhood_id !== input.draft.neighborhood_id) {
    bindingReasons.push("NEIGHBORHOOD_CHANGED");
  }
  if (
    input.context.neighborhood.neighborhood_fingerprint_sha256 !==
    input.draft.neighborhood_fingerprint_sha256
  ) {
    bindingReasons.push("NEIGHBORHOOD_FINGERPRINT_CHANGED");
  }
  if (
    input.context.context_fingerprint_sha256 !==
    input.draft.composer_context_fingerprint_sha256
  ) {
    bindingReasons.push("COMPOSER_CONTEXT_CHANGED");
  }
  const { draft_fingerprint_sha256: _fingerprint, ...draftBody } = input.draft;
  if (input.draft.draft_fingerprint_sha256 !== sha256(draftBody)) {
    bindingReasons.push("DRAFT_FINGERPRINT_MISMATCH");
  }

  const byDisplayId = new Map(
    input.context.fact_options.map((option) => [option.display_id, option] as const),
  );
  const selectedFactResolution = input.draft.selected_fact_display_ids.map(
    (displayId) => {
      const option = byDisplayId.get(displayId);
      return {
        display_id: displayId,
        canonical_fact_id: option?.canonical_fact_id ?? null,
        status: option === undefined ? ("REJECTED" as const) : ("RESOLVED" as const),
      };
    },
  );
  const selectedFacts = selectedFactResolution.flatMap((resolution) => {
    const option = byDisplayId.get(resolution.display_id);
    return option === undefined ? [] : [option];
  });
  const selectedCanonicalIds = selectedFacts.map((fact) => fact.canonical_fact_id);
  const selectedFactsValid =
    selectedFacts.length === input.draft.selected_fact_display_ids.length &&
    selectedFactResolution.every((resolution) => resolution.status === "RESOLVED") &&
    JSON.stringify(selectedCanonicalIds) ===
      JSON.stringify(input.draft.selected_canonical_fact_ids);
  if (!selectedFactsValid) bindingReasons.push("SELECTED_FACT_BINDING_INVALID");

  const analysis = analyzeHumanEditorialFieldsV3({
    fields: {
      title: input.draft.title,
      editorial_thesis: input.draft.editorial_thesis,
      why_this_story: input.draft.why_this_story,
    },
    selected_fact_options: selectedFacts,
    minimal_project_identity: input.context.minimal_project_identity,
  });
  const unsupportedClauses = analysis.clauses.filter(
    (clause) => clause.truth_status === "FAIL",
  );
  const reasonCodes = [
    ...new Set([
      ...bindingReasons,
      ...unsupportedClauses.flatMap((clause) => clause.failure_codes),
    ]),
  ];
  const stale = bindingReasons.length > 0;
  const pass = !stale && selectedFactsValid && unsupportedClauses.length === 0;
  const body = {
    human_composition_validation_version: 2 as const,
    composition_id: input.draft.composition_id,
    validation_version: 2 as const,
    source_host_semantics_version: 2 as const,
    host_semantics_version: HUMAN_INPUT_HOST_SEMANTICS_VERSION,
    repository: { ...input.context.repository },
    commit: input.context.commit,
    fact_ir_version: input.context.fact_ir_version,
    neighborhood_id: input.context.neighborhood.neighborhood_id,
    neighborhood_fingerprint_sha256:
      input.context.neighborhood.neighborhood_fingerprint_sha256,
    composer_context_fingerprint_sha256:
      input.context.context_fingerprint_sha256,
    original_draft_fingerprint_sha256: input.draft.draft_fingerprint_sha256,
    replay_draft_fingerprint_sha256: input.draft.draft_fingerprint_sha256,
    semantic_input_unchanged: true as const,
    selected_facts_valid: selectedFactsValid,
    selected_fact_resolution: selectedFactResolution,
    clause_traces: analysis.clauses,
    unsupported_clauses: unsupportedClauses,
    known_unknown_conflicts: [] as string[],
    reason_codes: reasonCodes,
    truth_status: pass ? ("PASS" as const) : ("FAIL" as const),
    composition_status: stale
      ? ("STALE" as const)
      : pass
        ? ("HOST_VALIDATED" as const)
        : ("HOST_REJECTED" as const),
    script_eligibility: {
      eligible: false as const,
      status: "NOT_ELIGIBLE" as const,
      reason: stale
        ? ("COMPOSITION_BINDING_STALE" as const)
        : pass
          ? ("HUMAN_CONFIRMATION_REQUIRED" as const)
          : ("HOST_TRUTH_VALIDATION_FAILED" as const),
    },
    generation_metadata: {
      mode: "deterministic_offline_human_composition_validation_v2" as const,
      paid_api_requests: 0 as const,
      real_model_requests: 0 as const,
      secret_reads: 0 as const,
      repository_executions: 0 as const,
    },
  };
  const validation: HumanCompositionValidationV2 = {
    ...body,
    validation_fingerprint_sha256: sha256(body),
  };
  input.schemas.assert("HumanCompositionValidationV2", validation);
  return validation;
}

export function assertHumanCompositionValidationV2Integrity(
  validation: HumanCompositionValidationV2,
): void {
  if (
    validation.host_semantics_version !== HUMAN_INPUT_HOST_SEMANTICS_VERSION ||
    validation.semantic_input_unchanged !== true ||
    validation.original_draft_fingerprint_sha256 !==
      validation.replay_draft_fingerprint_sha256 ||
    validation.validation_fingerprint_sha256 !== sha256(validationBodyV2(validation))
  ) {
    throw new Error("HUMAN_COMPOSITION_VALIDATION_V2_INTEGRITY_FAILED");
  }
}
