import { createHash } from "node:crypto";

import type { CanonicalGroundedBriefArtifact } from "../brief/canonical.js";
import type { GroundedFact, GroundedFactPack } from "../facts/domain.js";
import type { SchemaRegistry } from "../schemas/registry.js";
import { analyzeAngleSemanticFields } from "./angle-semantics.js";
import {
  evaluateEditorialDecisionFreshness,
  type ApprovedEditorialAngle,
  type ArtifactReference,
  type CurrentEditorialBinding,
} from "./editorial-selection.js";

export const SCRIPT_FACT_PACK_VERSION = 1 as const;
export const SCRIPT_STYLE_PROFILE_VERSION = 1 as const;
export const SCRIPT_INPUT_VERSION = 1 as const;
export const DEFAULT_CONTEXT_FACT_LIMIT = 6 as const;

export type ScriptLanguage = "en" | "zh-CN";
export type ScriptFactRole = "CORE_FACT" | "CONTEXT_FACT";

export interface ScriptEligibilityReceipt {
  readonly script_eligibility_version: 1;
  readonly status: "ELIGIBLE";
  readonly reason:
    | "CURRENT_HOST_VALIDATED_HUMAN_APPROVED_USEFUL_OR_STRONG"
    | "CURRENT_HOST_VALIDATED_HUMAN_CONFIRMED_STORY";
  readonly fixture_only: boolean;
  readonly real_model_authorized: boolean;
}

export interface ScriptModelFact {
  readonly model_fact_ref: string;
  readonly fact_type: GroundedFact["fact_type"];
  readonly category: GroundedFact["category"];
  readonly subject: string;
  readonly predicate: GroundedFact["predicate"];
  readonly object: string;
  readonly scope: GroundedFact["scope"];
  readonly limitations: readonly string[];
}

export interface ScriptKnownUnknown {
  readonly unknown_ref: string;
  readonly statement: string;
  readonly evidence_needed: string;
}

export interface ScriptFactPack {
  readonly script_fact_pack_version: typeof SCRIPT_FACT_PACK_VERSION;
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: GroundedFactPack["fact_ir_version"];
  readonly approved_angle_ref: string;
  readonly approved_angle_fingerprint_sha256: string;
  readonly core_facts: readonly ScriptModelFact[];
  readonly context_facts: readonly ScriptModelFact[];
  readonly known_unknowns: readonly ScriptKnownUnknown[];
  readonly context_policy: {
    readonly policy: "PACKAGE_IDENTITY_THEN_DIRECT_ENTITY_ONE_HOP";
    readonly limit: number;
    readonly angle_drift_forbidden: true;
  };
  readonly reference_contract: {
    readonly authoritative_fact_reference: "fact_###";
    readonly authoritative_unknown_reference: "gap_*";
    readonly canonical_fact_ids_model_visible: false;
    readonly alternate_fact_aliases_model_visible: false;
  };
  readonly provenance: {
    readonly approved_angle_artifact: ArtifactReference;
    readonly fact_pack_artifact: ArtifactReference;
    readonly canonical_brief_artifact: ArtifactReference;
  };
  readonly generation_metadata: {
    readonly mode: "deterministic_offline_contract";
    readonly paid_api_requests: 0;
    readonly real_model_requests: 0;
    readonly secret_reads: 0;
    readonly repository_executions: 0;
  };
}

export interface ScriptFactReferenceEntry {
  readonly model_fact_ref: string;
  readonly role: ScriptFactRole;
  readonly canonical_fact_id: string;
  readonly evidence_ids: readonly string[];
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: GroundedFactPack["fact_ir_version"];
}

export interface ScriptFactReferenceMap {
  readonly script_fact_reference_map_version: 1;
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: GroundedFactPack["fact_ir_version"];
  readonly entries: readonly ScriptFactReferenceEntry[];
}

export interface ScriptStyleProfile {
  readonly script_style_profile_version: typeof SCRIPT_STYLE_PROFILE_VERSION;
  readonly language: ScriptLanguage;
  readonly audience: "TECHNICAL_CREATOR";
  readonly tone: "CLEAR_TECHNICAL";
  readonly sentence_length: "SHORT_TO_MEDIUM";
  readonly verbosity: "CONCISE";
  readonly spoken_rhythm: "NATURAL";
  readonly target_duration_seconds: { readonly min: 60; readonly max: 90 };
  readonly speech_rate:
    | { readonly unit: "WORDS_PER_MINUTE"; readonly value: 150 }
    | { readonly unit: "CHARACTERS_PER_SECOND"; readonly value: 4 };
  readonly truth_authority: "NONE";
}

export interface GroundedScriptModelInput {
  readonly script_input_version: typeof SCRIPT_INPUT_VERSION;
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: GroundedFactPack["fact_ir_version"];
  readonly approved_angle: {
    readonly approved_angle_ref: string;
    readonly title: string;
    readonly editorial_thesis: string;
    readonly known_caveats: readonly string[];
  } & (
    | {
        readonly editorial_strength: "USEFUL" | "STRONG";
        readonly source_kind?: never;
        readonly human_confirmed?: never;
      }
    | {
        readonly editorial_strength?: never;
        readonly source_kind: "HUMAN_COMPOSITION";
        readonly human_confirmed: true;
      }
  );
  readonly script_fact_pack: ScriptFactPack;
  readonly style_profile: ScriptStyleProfile;
  readonly output_contract: {
    readonly schema: "GroundedScriptDraft v1";
    readonly structured_output_only: true;
    readonly approved_angle_read_only: true;
    readonly fact_discovery_forbidden: true;
    readonly analogy_forbidden: true;
  };
  readonly authorization: {
    readonly mode: "OFFLINE_CONTRACT_FIXTURE";
    readonly real_model_authorized: false;
  } | {
    readonly mode: "REAL_SCRIPT_CANARY";
    readonly real_model_authorized: true;
    readonly authorization_id: "VS07-E";
    readonly max_paid_requests: 1;
    readonly max_http_attempts: 1;
    readonly retries: 0;
    readonly resampling: 0;
    readonly fallbacks: 0;
  };
}

export interface GroundedScriptContractInput {
  readonly eligibility: ScriptEligibilityReceipt;
  readonly script_fact_pack: ScriptFactPack;
  readonly reference_map: ScriptFactReferenceMap;
  readonly model_input: GroundedScriptModelInput;
  readonly input_fingerprint_sha256: string;
}

export const GROUNDED_SCRIPT_DRAFT_VERSION = 1 as const;
export const GROUNDED_SCRIPT_VALIDATION_VERSION = 1 as const;
export const SCRIPT_CLAUSE_ALIGNMENT_VERSION = 2 as const;

export type ScriptRole =
  | "HOOK"
  | "SETUP"
  | "TECHNICAL_EXPLANATION"
  | "TRANSITION"
  | "CAVEAT"
  | "CLOSE";

export type ScriptStatementKind =
  | "TECHNICAL_FACT"
  | "EDITORIAL_FRAMING"
  | "TRANSITION"
  | "DOCUMENTATION"
  | "CAVEAT"
  | "UNKNOWN"
  | "QUESTION";

export interface GroundedScriptSegment {
  readonly segment_id: string;
  readonly role: ScriptRole;
  readonly text: string;
  readonly statement_kind: ScriptStatementKind;
  readonly supporting_fact_refs: readonly string[];
  readonly context_fact_refs: readonly string[];
  readonly known_unknown_refs: readonly string[];
  readonly approved_angle_ref: string;
}

export interface GroundedScriptDraft {
  readonly script_version: typeof GROUNDED_SCRIPT_DRAFT_VERSION;
  readonly status: "GENERATED";
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: GroundedFactPack["fact_ir_version"];
  readonly approved_angle_ref: string;
  readonly language: ScriptLanguage;
  readonly target_duration_seconds: { readonly min: 60; readonly max: 90 };
  readonly segments: readonly GroundedScriptSegment[];
  readonly generation_metadata: {
    readonly mode: "deterministic_offline_fixture";
    readonly provider: "FAKE_DETERMINISTIC";
    readonly model: null;
    readonly paid_api_requests: 0;
    readonly real_model_requests: 0;
    readonly secret_reads: 0;
    readonly repository_executions: 0;
  } | {
    readonly mode: "real_model_canary";
    readonly provider: "dashscope";
    readonly model: "qwen3.8-max";
    readonly paid_api_requests: 1;
    readonly real_model_requests: 1;
    readonly secret_reads: 1;
    readonly repository_executions: 0;
  };
}

export interface ScriptClauseTrace {
  readonly segment_id: string;
  readonly clause_index: number;
  readonly text: string;
  readonly statement_kind: ScriptStatementKind;
  readonly supporting_fact_refs: readonly string[];
  readonly canonical_fact_ids: readonly string[];
  readonly evidence_ids: readonly string[];
  readonly alignment_methods: readonly ScriptClauseAlignmentMethod[];
  readonly status: "FACT_TRACED" | "NON_TECHNICAL_ALLOWED" | "REJECTED";
}

export type ScriptClauseAlignmentMethod =
  | "FACT_REF_SCOPE_BOUND"
  | "EXPLICIT_CANONICAL_SUBJECT"
  | "BOUNDED_ADJACENT_SUBJECT_CARRYOVER_V1"
  | "DIRECT_STATIC_CALL_ALIGNMENT"
  | "OPERATOR_PARAPHRASE_GTE"
  | "OPERATOR_PARAPHRASE_LTE"
  | "BOOLEAN_NEGATION_PARAPHRASE"
  | "LOCATION_FALSY_SAFE_NARROWING_V1"
  | "REDIRECT_EXACT_EQUALITY_PARAPHRASE_V1"
  | "LOCAL_THROW_BRANCH_PARAPHRASE_V1"
  | "HOST_SEMANTICS_V3_FALLBACK";

export interface ScriptValidationFinding {
  readonly code: string;
  readonly segment_id: string | null;
  readonly details: string;
}

export interface GroundedScriptValidationReceipt {
  readonly script_validation_version: typeof GROUNDED_SCRIPT_VALIDATION_VERSION;
  readonly clause_alignment_version: typeof SCRIPT_CLAUSE_ALIGNMENT_VERSION;
  readonly status: "PASS" | "FAIL";
  readonly decision: "HOST_VALIDATED" | "HOST_REJECTED";
  readonly truth_gate: "PASS" | "FAIL";
  readonly findings: readonly ScriptValidationFinding[];
  readonly clause_trace: readonly ScriptClauseTrace[];
  readonly duration_estimate: {
    readonly status: "ESTIMATE";
    readonly language: ScriptLanguage;
    readonly estimated_seconds: number;
    readonly target_min_seconds: 60;
    readonly target_max_seconds: 90;
    readonly range_result: "TARGET" | "SOFT_WARNING" | "OUT_OF_RANGE";
  };
}

export interface ValidateGroundedScriptDraftInput {
  readonly draft: GroundedScriptDraft;
  readonly contract: GroundedScriptContractInput;
  readonly factPack: GroundedFactPack;
  readonly canonical: CanonicalGroundedBriefArtifact;
}

export interface CurrentGroundedScriptBinding {
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: number;
  readonly approved_angle_fingerprint_sha256: string;
  readonly script_input_fingerprint_sha256: string;
}

export type GroundedScriptStaleReason =
  | "REPOSITORY_CHANGED"
  | "COMMIT_CHANGED"
  | "FACT_IR_VERSION_CHANGED"
  | "APPROVED_ANGLE_CHANGED"
  | "SCRIPT_INPUT_CHANGED"
  | "SCRIPT_DRAFT_BINDING_CHANGED";

export interface GroundedScriptFreshness {
  readonly state: "CURRENT" | "STALE";
  readonly reason_codes: readonly GroundedScriptStaleReason[];
  readonly grounded_status_current: boolean;
}

export type ScriptQualityRating = "PASS" | "PARTIAL" | "FAIL" | "NOT_EVALUATED";

export interface ScriptQualityReview {
  readonly script_quality_review_version: 1;
  readonly basis: "QUALITATIVE_EDITORIAL_REVIEW_NOT_TRUTH";
  readonly truth_gate_status: "PASS" | "FAIL";
  readonly dimensions: {
    readonly angle_fidelity: ScriptQualityRating;
    readonly clarity: ScriptQualityRating;
    readonly narrative_coherence: ScriptQualityRating;
    readonly spoken_naturalness: ScriptQualityRating;
    readonly conciseness: ScriptQualityRating;
    readonly technical_density: ScriptQualityRating;
    readonly hook_quality: ScriptQualityRating;
    readonly caveat_handling: ScriptQualityRating;
  };
  readonly overall: ScriptQualityRating;
  readonly release_status:
    | "HUMAN_REVIEW_READY"
    | "QUALITY_REVIEW_NEEDED"
    | "BLOCKED_BY_TRUTH";
}

export interface GroundedScriptReviewArtifact {
  readonly script_review_version: 1;
  readonly status: "HUMAN_REVIEW_READY" | "HOST_REJECTED";
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: GroundedFactPack["fact_ir_version"];
  readonly approved_angle: GroundedScriptModelInput["approved_angle"];
  readonly script_fact_pack_summary: {
    readonly core_fact_count: number;
    readonly context_fact_count: number;
    readonly known_unknown_count: number;
    readonly evidence_count: number;
  };
  readonly draft: GroundedScriptDraft;
  readonly host_validation: GroundedScriptValidationReceipt;
  readonly quality_review: ScriptQualityReview;
  readonly fact_trace: readonly {
    readonly model_fact_ref: string;
    readonly role: ScriptFactRole;
    readonly canonical_fact_id: string;
    readonly canonical_fact_summary: string;
    readonly evidence_ids: readonly string[];
    readonly evidence_available: boolean;
  }[];
  readonly known_caveats: readonly string[];
  readonly provenance: ScriptFactPack["provenance"] & {
    readonly script_input_fingerprint_sha256: string;
  };
  readonly generation_metadata: ScriptFactPack["generation_metadata"] & {
    readonly script_generation_executed: false;
  };
}

export interface BuildGroundedScriptReviewInput {
  readonly contract: GroundedScriptContractInput;
  readonly draft: GroundedScriptDraft;
  readonly validation: GroundedScriptValidationReceipt;
  readonly quality: ScriptQualityReview;
  readonly factPack: GroundedFactPack;
}

export interface BuildGroundedScriptContractInput {
  readonly approval: ApprovedEditorialAngle;
  readonly factPack: GroundedFactPack;
  readonly canonical: CanonicalGroundedBriefArtifact;
  readonly currentBinding: CurrentEditorialBinding;
  readonly sources: {
    readonly approved_angle_artifact: ArtifactReference;
    readonly fact_pack_artifact: ArtifactReference;
    readonly canonical_brief_artifact: ArtifactReference;
  };
  readonly language: ScriptLanguage;
  readonly context_fact_limit?: number;
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

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function modelFactRef(index: number): string {
  return `fact_${String(index + 1).padStart(3, "0")}`;
}

function assertEligible(
  approval: ApprovedEditorialAngle,
  currentBinding: CurrentEditorialBinding,
  factPack: GroundedFactPack,
  canonical: CanonicalGroundedBriefArtifact,
): ScriptEligibilityReceipt {
  const freshness = evaluateEditorialDecisionFreshness(
    approval,
    currentBinding,
  );
  if (
    approval.decision !== "APPROVE" ||
    approval.status !== "HUMAN_APPROVED" ||
    approval.approved_by !== "human" ||
    approval.host_validation.status !== "PASS" ||
    !approval.host_validation.decision_codes.includes(
      "ALL_HARD_GATES_PASSED",
    ) ||
    approval.script_eligibility.eligible !== true ||
    !["USEFUL", "STRONG"].includes(approval.editorial_signal.strength) ||
    freshness.state !== "CURRENT" ||
    !freshness.script_eligible ||
    !sameRepository(approval.repository, factPack.repository) ||
    !sameRepository(approval.repository, canonical.repository) ||
    approval.commit !== factPack.commit ||
    approval.commit !== canonical.commit ||
    approval.fact_ir_version !== factPack.fact_ir_version ||
    approval.fact_ir_version !== canonical.fact_ir_version
  ) {
    throw new Error("SCRIPT_NOT_ELIGIBLE");
  }
  return {
    script_eligibility_version: 1,
    status: "ELIGIBLE",
    reason: "CURRENT_HOST_VALIDATED_HUMAN_APPROVED_USEFUL_OR_STRONG",
    fixture_only: approval.decision_context === "OFFLINE_FIXTURE",
    real_model_authorized: false,
  };
}

function deterministicContextFacts(
  pack: GroundedFactPack,
  coreFacts: readonly GroundedFact[],
  limit: number,
): GroundedFact[] {
  const coreIds = new Set(coreFacts.map((fact) => fact.id));
  const coreEntities = new Set(
    coreFacts.flatMap((fact) => [fact.subject_ref, fact.object_ref]),
  );
  const entityById = new Map(pack.entities.map((entity) => [entity.id, entity]));
  const available = pack.facts.filter((fact) => !coreIds.has(fact.id));
  const packageIdentity = available.filter((fact) => {
    const subject = entityById.get(fact.subject_ref);
    return fact.scope === "PACKAGE" && subject?.kind === "package";
  });
  const direct = available.filter(
    (fact) =>
      coreEntities.has(fact.subject_ref) || coreEntities.has(fact.object_ref),
  );
  const selected: GroundedFact[] = [];
  for (const fact of [...packageIdentity, ...direct].sort((left, right) =>
    compareText(left.id, right.id),
  )) {
    if (!selected.some((item) => item.id === fact.id)) selected.push(fact);
    if (selected.length === limit) break;
  }
  return selected;
}

function projectFact(
  fact: GroundedFact,
  index: number,
  pack: GroundedFactPack,
): ScriptModelFact {
  const entities = new Map(pack.entities.map((entity) => [entity.id, entity]));
  const subject = entities.get(fact.subject_ref);
  const object = entities.get(fact.object_ref);
  if (subject === undefined || object === undefined) {
    throw new Error(`SCRIPT_FACT_ENTITY_NOT_FOUND:${fact.id}`);
  }
  return {
    model_fact_ref: modelFactRef(index),
    fact_type: fact.fact_type,
    category: fact.category,
    subject: subject.display_label,
    predicate: fact.predicate,
    object: object.display_label,
    scope: fact.scope,
    limitations: [...fact.limitations],
  };
}

function styleProfile(language: ScriptLanguage): ScriptStyleProfile {
  return {
    script_style_profile_version: SCRIPT_STYLE_PROFILE_VERSION,
    language,
    audience: "TECHNICAL_CREATOR",
    tone: "CLEAR_TECHNICAL",
    sentence_length: "SHORT_TO_MEDIUM",
    verbosity: "CONCISE",
    spoken_rhythm: "NATURAL",
    target_duration_seconds: { min: 60, max: 90 },
    speech_rate:
      language === "en"
        ? { unit: "WORDS_PER_MINUTE", value: 150 }
        : { unit: "CHARACTERS_PER_SECOND", value: 4 },
    truth_authority: "NONE",
  };
}

function boundaryTokens(value: string): Set<string> {
  const aliases: Readonly<Record<string, string>> = {
    invocation: "call",
    invokes: "call",
    invoked: "call",
    calls: "call",
    types: "type",
    schemas: "schema",
    inputs: "input",
    mutated: "mutation",
    mutates: "mutation",
    immutability: "mutation",
    benchmarks: "performance",
    reliable: "safety",
    reliability: "safety",
    guarantees: "guarantee",
  };
  const highSignal = new Set([
    "call",
    "runtime",
    "input",
    "mutation",
    "type",
    "schema",
    "performance",
    "safety",
    "security",
    "guarantee",
  ]);
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .map((token) => aliases[token] ?? token)
      .filter((token) => highSignal.has(token)),
  );
}

function relevantKnownUnknowns(
  approval: ApprovedEditorialAngle,
  canonical: CanonicalGroundedBriefArtifact,
): CanonicalGroundedBriefArtifact["known_unknowns"] {
  const angleTokens = boundaryTokens(
    [approval.title, approval.editorial_thesis, ...approval.known_caveats].join(
      " ",
    ),
  );
  return canonical.known_unknowns.filter((unknown) => {
    const source = unknown.source_gap_ids.join(" ");
    if (/performance|safety|security|guarantee/i.test(source)) return true;
    const unknownTokens = boundaryTokens(
      [unknown.statement, unknown.evidence_needed, source].join(" "),
    );
    return [...unknownTokens].some((token) => angleTokens.has(token));
  });
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function buildGroundedScriptContractInput(
  input: BuildGroundedScriptContractInput,
): GroundedScriptContractInput {
  const eligibility = assertEligible(
    input.approval,
    input.currentBinding,
    input.factPack,
    input.canonical,
  );
  const contextLimit = input.context_fact_limit ?? DEFAULT_CONTEXT_FACT_LIMIT;
  if (!Number.isInteger(contextLimit) || contextLimit < 0 || contextLimit > 8) {
    throw new Error("SCRIPT_CONTEXT_FACT_LIMIT_INVALID");
  }
  const factById = new Map(input.factPack.facts.map((fact) => [fact.id, fact]));
  const coreFacts = input.approval.supporting_fact_ids.map((factId) => {
    const fact = factById.get(factId);
    if (fact === undefined) throw new Error(`SCRIPT_CORE_FACT_NOT_FOUND:${factId}`);
    return fact;
  });
  const contextFacts = deterministicContextFacts(
    input.factPack,
    coreFacts,
    contextLimit,
  );
  const orderedFacts = [...coreFacts, ...contextFacts];
  const projected = orderedFacts.map((fact, index) =>
    projectFact(fact, index, input.factPack),
  );
  const referenceMap: ScriptFactReferenceMap = {
    script_fact_reference_map_version: 1,
    repository: { ...input.factPack.repository },
    commit: input.factPack.commit,
    fact_ir_version: input.factPack.fact_ir_version,
    entries: orderedFacts.map((fact, index) => ({
      model_fact_ref: modelFactRef(index),
      role: index < coreFacts.length ? "CORE_FACT" : "CONTEXT_FACT",
      canonical_fact_id: fact.id,
      evidence_ids: [...fact.evidence_ids],
      repository: { ...input.factPack.repository },
      commit: input.factPack.commit,
      fact_ir_version: input.factPack.fact_ir_version,
    })),
  };
  const scriptFactPack: ScriptFactPack = {
    script_fact_pack_version: SCRIPT_FACT_PACK_VERSION,
    repository: { ...input.factPack.repository },
    commit: input.factPack.commit,
    fact_ir_version: input.factPack.fact_ir_version,
    approved_angle_ref: input.approval.candidate_id,
    approved_angle_fingerprint_sha256:
      input.approval.candidate_fingerprint_sha256,
    core_facts: projected.slice(0, coreFacts.length),
    context_facts: projected.slice(coreFacts.length),
    known_unknowns: relevantKnownUnknowns(input.approval, input.canonical).map((unknown) => ({
      unknown_ref: unknown.id,
      statement: unknown.statement,
      evidence_needed: unknown.evidence_needed,
    })),
    context_policy: {
      policy: "PACKAGE_IDENTITY_THEN_DIRECT_ENTITY_ONE_HOP",
      limit: contextLimit,
      angle_drift_forbidden: true,
    },
    reference_contract: {
      authoritative_fact_reference: "fact_###",
      authoritative_unknown_reference: "gap_*",
      canonical_fact_ids_model_visible: false,
      alternate_fact_aliases_model_visible: false,
    },
    provenance: { ...input.sources },
    generation_metadata: {
      mode: "deterministic_offline_contract",
      paid_api_requests: 0,
      real_model_requests: 0,
      secret_reads: 0,
      repository_executions: 0,
    },
  };
  const profile = styleProfile(input.language);
  const modelInput: GroundedScriptModelInput = {
    script_input_version: SCRIPT_INPUT_VERSION,
    repository: { ...input.factPack.repository },
    commit: input.factPack.commit,
    fact_ir_version: input.factPack.fact_ir_version,
    approved_angle: {
      approved_angle_ref: input.approval.candidate_id,
      title: input.approval.title,
      editorial_thesis: input.approval.editorial_thesis,
      editorial_strength: input.approval.editorial_signal.strength as
        | "USEFUL"
        | "STRONG",
      known_caveats: [...input.approval.known_caveats],
    },
    script_fact_pack: scriptFactPack,
    style_profile: profile,
    output_contract: {
      schema: "GroundedScriptDraft v1",
      structured_output_only: true,
      approved_angle_read_only: true,
      fact_discovery_forbidden: true,
      analogy_forbidden: true,
    },
    authorization: {
      mode: "OFFLINE_CONTRACT_FIXTURE",
      real_model_authorized: false,
    },
  };
  return {
    eligibility,
    script_fact_pack: scriptFactPack,
    reference_map: referenceMap,
    model_input: modelInput,
    input_fingerprint_sha256: sha256(modelInput),
  };
}

function makeSegment(
  input: GroundedScriptModelInput,
  index: number,
  role: ScriptRole,
  statementKind: ScriptStatementKind,
  text: string,
  supportingFactRefs: readonly string[] = [],
  knownUnknownRefs: readonly string[] = [],
): GroundedScriptSegment {
  return {
    segment_id: `segment_${String(index).padStart(2, "0")}`,
    role,
    text,
    statement_kind: statementKind,
    supporting_fact_refs: [...supportingFactRefs],
    context_fact_refs: [],
    known_unknown_refs: [...knownUnknownRefs],
    approved_angle_ref: input.approved_angle.approved_angle_ref,
  };
}

function factSentence(fact: ScriptModelFact): string {
  const predicates: Readonly<Record<GroundedFact["predicate"], string>> = {
    DECLARES: "declares",
    DECLARES_TYPE: "declares the type",
    EXPORTS: "exports",
    IMPORTS: "imports",
    CALLS: "calls",
    SKIPS_WHEN: "skips when",
    CONCATENATES_WHEN: "concatenates when",
    THROWS_WHEN: "throws when",
    DECLARES_CONFIGURATION: "declares the configuration",
    CONTAINS: "contains",
  };
  return `In the frozen commit, ${fact.subject} ${predicates[fact.predicate]} ${fact.object}.`;
}

export function createDeterministicGroundedScriptDraft(
  input: GroundedScriptModelInput,
): GroundedScriptDraft {
  const coreRefs = input.script_fact_pack.core_facts.map(
    (fact) => fact.model_fact_ref,
  );
  const callGap = input.script_fact_pack.known_unknowns.find((unknown) =>
    unknown.unknown_ref.includes("call_relations"),
  );
  const segments: GroundedScriptSegment[] = [
    makeSegment(
      input,
      1,
      "HOOK",
      "QUESTION",
      `What does ${input.repository.name} actually define when its diagram types are expressed as explicit JSON Schema documents?`,
      coreRefs,
    ),
    makeSegment(
      input,
      2,
      "SETUP",
      "EDITORIAL_FRAMING",
      "The approved angle is a useful way to explain the visible type surface. These static declarations do not prove runtime behavior, quality, or guarantees.",
      coreRefs,
    ),
    ...input.script_fact_pack.core_facts.map((fact, index) =>
      makeSegment(
        input,
        index + 3,
        "TECHNICAL_EXPLANATION",
        "TECHNICAL_FACT",
        factSentence(fact),
        [fact.model_fact_ref],
      ),
    ),
  ];
  const nextIndex = segments.length + 1;
  segments.push(
    makeSegment(
      input,
      nextIndex,
      "TRANSITION",
      "TRANSITION",
      "Next, keep the explanation on the approved schema type surface.",
      coreRefs,
    ),
    makeSegment(
      input,
      nextIndex + 1,
      "CAVEAT",
      "CAVEAT",
      input.approved_angle.known_caveats[0] ??
        "The supplied Facts do not prove broader runtime behavior.",
      coreRefs,
      callGap === undefined ? [] : [callGap.unknown_ref],
    ),
    makeSegment(
      input,
      nextIndex + 2,
      "CLOSE",
      "EDITORIAL_FRAMING",
      "This is a useful way to explain the schema-first type surface. The supplied Facts do not prove performance, safety, correctness, or runtime guarantees.",
      coreRefs,
    ),
  );
  return {
    script_version: GROUNDED_SCRIPT_DRAFT_VERSION,
    status: "GENERATED",
    repository: { ...input.repository },
    commit: input.commit,
    fact_ir_version: input.fact_ir_version,
    approved_angle_ref: input.approved_angle.approved_angle_ref,
    language: input.style_profile.language,
    target_duration_seconds: { min: 60, max: 90 },
    segments,
    generation_metadata: {
      mode: "deterministic_offline_fixture",
      provider: "FAKE_DETERMINISTIC",
      model: null,
      paid_api_requests: 0,
      real_model_requests: 0,
      secret_reads: 0,
      repository_executions: 0,
    },
  };
}

function estimateDurationSeconds(
  draft: GroundedScriptDraft,
  profile: ScriptStyleProfile,
): number {
  const text = draft.segments.map((segment) => segment.text).join(" ");
  if (profile.speech_rate.unit === "WORDS_PER_MINUTE") {
    const words = text.match(/[A-Za-z0-9_.:/-]+/g)?.length ?? 0;
    return Math.ceil((words / profile.speech_rate.value) * 60);
  }
  const characters = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const latinWords = text.match(/[A-Za-z0-9_.:/-]+/g)?.length ?? 0;
  return Math.ceil(characters / profile.speech_rate.value + latinWords / 2.5);
}

interface ExactScriptTechnicalClause {
  readonly field: "title";
  readonly clause_index: number;
  readonly text: string;
  readonly clause_type: "TECHNICAL";
  readonly editorial_predicate: null;
  readonly causal_target: null;
  readonly fact_ids: readonly string[];
  readonly untraced_anchors: readonly string[];
  readonly status: "FACT_TRACED";
}

interface ExactScriptTechnicalAlignment {
  readonly clauses: readonly ExactScriptTechnicalClause[];
  readonly canonical_subject: string;
  readonly alignment_methods: readonly ScriptClauseAlignmentMethod[];
}

function normalizedScriptText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[“”`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function containsEvery(value: string, parts: readonly string[]): boolean {
  return parts.every((part) => value.includes(part.toLowerCase()));
}

function exactScriptTechnicalClause(
  segment: GroundedScriptSegment,
  referencedFacts: readonly GroundedFact[],
  factPack: GroundedFactPack,
  previousTechnicalSubject: string | null,
): ExactScriptTechnicalAlignment | null {
  if (
    segment.statement_kind !== "TECHNICAL_FACT" ||
    segment.supporting_fact_refs.length !== 1 ||
    segment.context_fact_refs.length !== 0 ||
    referencedFacts.length !== 1
  ) {
    return null;
  }
  const fact = referencedFacts[0];
  if (fact === undefined) return null;
  const entityById = new Map(factPack.entities.map((entity) => [entity.id, entity]));
  const subject = entityById.get(fact.subject_ref)?.display_label;
  const object = entityById.get(fact.object_ref)?.display_label;
  if (subject === undefined || object === undefined) return null;
  const text = normalizedScriptText(segment.text);
  const normalizedSubject = normalizedScriptText(subject);
  const explicitSubject = text.includes(normalizedSubject);
  const otherFactSubjects = [
    ...new Set(
      factPack.facts.flatMap((candidate) => {
        const label = entityById.get(candidate.subject_ref)?.display_label;
        return label === undefined ? [] : [normalizedScriptText(label)];
      }),
    ),
  ].filter((candidate) => candidate !== normalizedSubject);
  const namesAnotherCanonicalSubject = otherFactSubjects.some((candidate) =>
    text.includes(candidate),
  );
  const adjacentCarryCue =
    /^(?:同一个函数内|该函数(?:内)?|这个函数(?:内)?|这里|此外|同时|当[^。！？!?]{1,180}时|如果)/i.test(
      text,
    );
  const subjectMethod: ScriptClauseAlignmentMethod | null = explicitSubject
    ? "EXPLICIT_CANONICAL_SUBJECT"
    : previousTechnicalSubject === subject &&
        adjacentCarryCue &&
        !namesAnotherCanonicalSubject
      ? "BOUNDED_ADJACENT_SUBJECT_CARRYOVER_V1"
      : null;
  if (subjectMethod === null) return null;
  const forbiddenUpgrade =
    /(?:因此|所以|从而|进而)[^。！？!?]*(?:保证|确保|证明|安全|可靠|正确|性能)|(?:保证|确保)(?:请求)?(?:安全|可靠|正确)|作者(?:的)?(?:意图|设计)|所有运行|每次运行|一定会|必然会|(?:location|地址)[^。！？!?]*(?:不安全|恶意|非法|危险)|(?:请求|网络|服务器)失败时|\b(?:therefore|thus|guarantees?|ensures?|safe|secure|reliable|correctness|runtime always)\b/i;
  if (forbiddenUpgrade.test(segment.text)) return null;

  let predicateAligned = false;
  const alignmentMethods: ScriptClauseAlignmentMethod[] = [
    "FACT_REF_SCOPE_BOUND",
    subjectMethod,
  ];
  if (fact.predicate === "CALLS") {
    predicateAligned =
      text.includes(object.toLowerCase()) &&
      /调用|\bcall(?:s|ed|ing)?\b/i.test(segment.text) &&
      /静态|源码|代码|\bdirect\s+static\b/i.test(segment.text);
    if (predicateAligned) alignmentMethods.push("DIRECT_STATIC_CALL_ALIGNMENT");
  } else if (fact.predicate === "THROWS_WHEN") {
    const throwCue = /抛出|报错|throw/i.test(segment.text);
    const authoredCue = /源码|代码|编写|存在|触发|分支|authored/i.test(
      segment.text,
    );
    const localBranchCue =
      /本地[^。！？?]{0,16}抛出[^。！？?]{0,16}分支|(?:源码|代码)[^。！？?]{0,32}分支[^。！？?]{0,96}(?:抛出|报错)|(?:抛出|报错)[^。！？?]{0,32}(?:源码|代码)[^。！？?]{0,16}分支|local[^.!?;]{0,24}throw[^.!?;]{0,24}branch/i.test(
        segment.text,
      );
    if (object.includes("Date.now()") && object.includes("deadline")) {
      const operatorMethod: ScriptClauseAlignmentMethod | null = object.includes(
        ">=",
      )
        ? /大于等于|>=/.test(segment.text)
          ? "OPERATOR_PARAPHRASE_GTE"
          : null
        : object.includes("<=") && /小于等于|<=/.test(segment.text)
          ? "OPERATOR_PARAPHRASE_LTE"
          : null;
      predicateAligned =
        containsEvery(text, ["date.now()", "deadline"]) &&
        operatorMethod !== null &&
        throwCue &&
        authoredCue &&
        localBranchCue;
      if (predicateAligned && operatorMethod !== null) {
        alignmentMethods.push(operatorMethod);
      }
    } else if (object.includes("location") && object.includes("redirects")) {
      const exactLocation = /location\s*(?:为|是)?\s*空|没有\s*location|不存在\s*location|!location|\bno\s+location\b/i.test(
        segment.text,
      );
      const exactRedirectVariable =
        /\bredirects\b/i.test(segment.text) || /重定向次数/.test(segment.text);
      const exactRedirectEquality =
        /(?:redirects|重定向次数)[^。！？!?]{0,16}(?:等于三(?:次)?|等于3(?:次)?|恰好三次|恰好3次|达到三次|达到3次|===\s*3|equals?\s+(?:three|3))/i.test(
          segment.text,
        ) &&
        !/(?:redirects|重定向次数)[^。！？!?]{0,16}(?:至少|不低于|超过|大于|三次以上|3次以上|>=)/i.test(
          segment.text,
        );
      predicateAligned =
        text.includes("location") &&
        exactLocation &&
        exactRedirectVariable &&
        exactRedirectEquality &&
        throwCue &&
        authoredCue &&
        localBranchCue;
      if (predicateAligned) {
        alignmentMethods.push(
          "LOCATION_FALSY_SAFE_NARROWING_V1",
          "REDIRECT_EXACT_EQUALITY_PARAPHRASE_V1",
        );
      }
    } else if (object.includes("response.ok")) {
      predicateAligned =
        text.includes("response.ok") &&
        /response\.ok\s*(?:为|是)?\s*(?:假|false)|response\.ok\s*不成立|!response\.ok|\bresponse\.ok\s+is\s+(?:false|not\s+true)\b/i.test(
          segment.text,
        ) &&
        throwCue &&
        authoredCue &&
        localBranchCue;
      if (predicateAligned) alignmentMethods.push("BOOLEAN_NEGATION_PARAPHRASE");
    }
    if (predicateAligned) alignmentMethods.push("LOCAL_THROW_BRANCH_PARAPHRASE_V1");
  }
  if (!predicateAligned) return null;
  return {
    clauses: [
      {
        field: "title",
        clause_index: 0,
        text: segment.text,
        clause_type: "TECHNICAL",
        editorial_predicate: null,
        causal_target: null,
        fact_ids: [fact.id],
        untraced_anchors: [],
        status: "FACT_TRACED",
      },
    ],
    canonical_subject: subject,
    alignment_methods: alignmentMethods,
  };
}

export function validateGroundedScriptDraft(
  input: ValidateGroundedScriptDraftInput,
): GroundedScriptValidationReceipt {
  const findings: ScriptValidationFinding[] = [];
  const referenceEntries = input.contract.reference_map.entries;
  const referenceMapContextMatches =
    sameRepository(
      input.contract.reference_map.repository,
      input.contract.model_input.repository,
    ) &&
    input.contract.reference_map.commit === input.contract.model_input.commit &&
    input.contract.reference_map.fact_ir_version ===
      input.contract.model_input.fact_ir_version &&
    referenceEntries.every(
      (entry) =>
        sameRepository(entry.repository, input.contract.model_input.repository) &&
        entry.commit === input.contract.model_input.commit &&
        entry.fact_ir_version === input.contract.model_input.fact_ir_version,
    );
  if (!referenceMapContextMatches) {
    findings.push({
      code: "SCRIPT_REFERENCE_MAP_CROSS_COMMIT",
      segment_id: null,
      details:
        "Every Model Fact reference must resolve inside the frozen repository, commit, and Fact IR binding.",
    });
  }
  const referenceValues = referenceEntries.map((entry) => entry.model_fact_ref);
  const canonicalValues = referenceEntries.map(
    (entry) => entry.canonical_fact_id,
  );
  if (
    new Set(referenceValues).size !== referenceValues.length ||
    new Set(canonicalValues).size !== canonicalValues.length ||
    referenceEntries.some(
      (entry) =>
        !/^fact_\d{3}$/.test(entry.model_fact_ref) ||
        !input.factPack.facts.some(
          (fact) =>
            fact.id === entry.canonical_fact_id &&
            fact.evidence_ids.length > 0 &&
            fact.evidence_ids.every((evidenceId) =>
              entry.evidence_ids.includes(evidenceId),
            ),
        ),
    )
  ) {
    findings.push({
      code: "SCRIPT_REFERENCE_MAP_INVALID",
      segment_id: null,
      details:
        "Model Fact references must be unique one-to-one entries backed by canonical Facts and Evidence.",
    });
  }
  const sameContext =
    sameRepository(input.draft.repository, input.contract.model_input.repository) &&
    input.draft.commit === input.contract.model_input.commit &&
    input.draft.fact_ir_version === input.contract.model_input.fact_ir_version &&
    input.draft.approved_angle_ref ===
      input.contract.model_input.approved_angle.approved_angle_ref;
  if (!sameContext) {
    findings.push({
      code: "SCRIPT_CONTEXT_MISMATCH",
      segment_id: null,
      details: "Draft identity does not match the frozen Script input.",
    });
  }
  if (input.draft.commit !== input.contract.model_input.commit) {
    findings.push({
      code: "SCRIPT_CROSS_COMMIT",
      segment_id: null,
      details: "Draft commit differs from the approved Script Fact Pack commit.",
    });
  }
  const mapByRef = new Map(
    referenceEntries.map((entry) => [
      entry.model_fact_ref,
      entry,
    ]),
  );
  const canonicalFactById = new Map(
    input.factPack.facts.map((fact) => [fact.id, fact]),
  );
  const knownUnknownRefs = new Set(
    input.contract.script_fact_pack.known_unknowns.map(
      (unknown) => unknown.unknown_ref,
    ),
  );
  let previousTechnicalAlignment: {
    readonly segmentIndex: number;
    readonly canonicalSubject: string;
  } | null = null;
  const clauseTrace: ScriptClauseTrace[] = input.draft.segments.flatMap((segment, segmentIndex) => {
    if (segment.statement_kind === "UNKNOWN") {
      findings.push({
        code: "SCRIPT_UNKNOWN_STATEMENT",
        segment_id: segment.segment_id,
        details:
          "UNKNOWN may preserve uncertainty in a Draft but cannot pass Host Script acceptance.",
      });
    }
    if (segment.role === "HOOK") {
      const novelty =
        /\b(?:first|only|unique|revolutionary|industry[- ]first)\b|首个|唯一|革命性/i.test(
          segment.text,
        );
      const safetyOrOutcome =
        /\b(?:absolutely|guarantees?|reliable|reliability|safe|safest|secure|fastest|10x|correctness)\b|绝对可靠|最安全|最快|保证正确/i.test(
          segment.text,
        );
      if (novelty || safetyOrOutcome) {
        findings.push({
          code: "HOOK_INTEGRITY_VIOLATION",
          segment_id: segment.segment_id,
          details: "Hook introduces unsupported novelty, safety, or outcome language.",
        });
      }
      if (novelty) {
        findings.push({
          code: "NOVELTY_UNSUPPORTED",
          segment_id: segment.segment_id,
          details: "Novelty requires separately authorized external evidence.",
        });
      }
      if (safetyOrOutcome) {
        findings.push({
          code: "SAFETY_OUTCOME_UNSUPPORTED",
          segment_id: segment.segment_id,
          details: "Safety and outcome claims are not licensed by the Script Fact Pack.",
        });
      }
    }
    const unknownReferencesValid = segment.known_unknown_refs.every((reference) =>
      knownUnknownRefs.has(reference),
    );
    if (!unknownReferencesValid) {
      findings.push({
        code: "UNKNOWN_KNOWN_UNKNOWN_REFERENCE",
        segment_id: segment.segment_id,
        details: "Segment references a Known Unknown outside the frozen gap_* set.",
      });
    }
    const isBoundaryCaveat =
      /\b(?:do(?:es)? not|cannot|can't|not)\s+(?:establish|prove|show|guarantee|claim|verified)\b|\bnot (?:established|proven|verified)\b|不证明|不能证明|无法证明|不代表|并不意味着|未证明|没有被证明/i.test(
        segment.text,
      );
    if (
      segment.known_unknown_refs.length > 0 &&
      !isBoundaryCaveat &&
      /\b(?:all|every|always|never|guarantees?|certainly|definitely|must)\b|所有|全部|每次|总是|从不|一定|必然|保证/i.test(
        segment.text,
      )
    ) {
      findings.push({
        code: "KNOWN_UNKNOWN_PROMOTION",
        segment_id: segment.segment_id,
        details:
          "An unresolved gap cannot be promoted to a positive or negative runtime Fact.",
      });
    }
    const entries = segment.supporting_fact_refs.flatMap((reference) => {
      const entry = mapByRef.get(reference);
      if (entry === undefined) {
        findings.push({
          code: "UNKNOWN_FACT_REFERENCE",
          segment_id: segment.segment_id,
          details: `Unknown Fact reference ${reference}.`,
        });
        return [];
      }
      return [entry];
    });
    if (
      segment.statement_kind === "TECHNICAL_FACT" &&
      entries.length === 0
    ) {
      findings.push({
        code: "TECHNICAL_CLAUSE_UNGROUNDED",
        segment_id: segment.segment_id,
        details: "Technical Fact segment has no resolvable Fact reference.",
      });
    }
    if (
      segment.statement_kind === "TECHNICAL_FACT" &&
      entries.length > 0 &&
      entries.every((entry) => entry.role === "CONTEXT_FACT")
    ) {
      findings.push({
        code: "SCRIPT_ANGLE_DRIFT",
        segment_id: segment.segment_id,
        details:
          "Context Facts may explain the approved story but cannot become a second technical thesis.",
      });
    }
    const referencedFacts = entries.flatMap((entry) => {
      const fact = canonicalFactById.get(entry.canonical_fact_id);
      return fact === undefined ? [] : [fact];
    });
    if (segment.statement_kind === "DOCUMENTATION") {
      const entityById = new Map(
        input.factPack.entities.map((entity) => [entity.id, entity]),
      );
      const documentationSources = referencedFacts.length > 0 &&
        referencedFacts.every(
          (fact) =>
            fact.source_kind === "documentation" ||
            entityById.get(fact.object_ref)?.field_pointer === "/description",
        );
      const attributed =
        /\b(?:project|package|readme|documentation)\b[^.!?;]*\b(?:describes|positions|states|calls itself|documents)\b|\baccording to\b/i.test(
          segment.text,
        );
      if (!documentationSources || !attributed) {
        findings.push({
          code: "DOCUMENTATION_ATTRIBUTION_REQUIRED",
          segment_id: segment.segment_id,
          details:
            "Documentation prose must use documentation provenance and explicit attribution.",
        });
      }
    }
    if (
      segment.statement_kind === "TECHNICAL_FACT" &&
      segment.supporting_fact_refs.length !== 1
    ) {
      findings.push({
        code: "SCRIPT_TECHNICAL_SEGMENT_NOT_ATOMIC",
        segment_id: segment.segment_id,
        details:
          "A real Script technical segment must express exactly one independently traceable Fact.",
      });
    }
    const exactTechnical = exactScriptTechnicalClause(
      segment,
      referencedFacts,
      input.factPack,
      previousTechnicalAlignment?.segmentIndex === segmentIndex - 1
        ? previousTechnicalAlignment.canonicalSubject
        : null,
    );
    const semantic =
      exactTechnical?.clauses ??
      analyzeAngleSemanticFields(
        {
          title: segment.text,
          editorial_thesis: "This is a useful way to explain.",
          why_interesting: "This is a useful way to explain.",
          editorial_reason: "This is a useful way to explain.",
          educational_value: "This is a useful way to explain.",
        },
        referencedFacts,
        input.factPack,
        input.canonical,
      ).clause_trace.filter((clause) => clause.field === "title");
    previousTechnicalAlignment =
      exactTechnical === null
        ? null
        : {
            segmentIndex,
            canonicalSubject: exactTechnical.canonical_subject,
          };

    for (const clause of semantic) {
      if (clause.clause_type === "EXTERNAL_COMPARISON") {
        findings.push({
          code: "EXTERNAL_COMPARISON_UNSUPPORTED",
          segment_id: segment.segment_id,
          details: "External comparison requires an authorized external Evidence layer.",
        });
      }
      if (clause.clause_type === "NOVELTY") {
        findings.push({
          code: "NOVELTY_UNSUPPORTED",
          segment_id: segment.segment_id,
          details: "Novelty requires an authorized external Evidence layer.",
        });
      }
      if (
        (clause.clause_type === "SAFETY" || clause.clause_type === "OUTCOME") &&
        !isBoundaryCaveat
      ) {
        findings.push({
          code: "SAFETY_OUTCOME_UNSUPPORTED",
          segment_id: segment.segment_id,
          details: "Safety or outcome prose is not supported by the frozen Facts.",
        });
      }
      if (clause.clause_type === "TECHNICAL_CAUSALITY") {
        findings.push({
          code: "TECHNICAL_CAUSALITY_UNSUPPORTED",
          segment_id: segment.segment_id,
          details: "Technical causality is not established by the cited Facts.",
        });
        if (
          /\bguarantees?\b[^.!?;]*\b(?:correct|correctness|reliable|safe)\b/i.test(
            clause.text,
          )
        ) {
          findings.push({
            code: "SAFETY_OUTCOME_UNSUPPORTED",
            segment_id: segment.segment_id,
            details: "A guarantee cannot be inferred from structural Facts.",
          });
        }
      }
      if (
        segment.statement_kind === "TECHNICAL_FACT" &&
        clause.status !== "FACT_TRACED"
      ) {
        findings.push({
          code: "TECHNICAL_CLAUSE_UNGROUNDED",
          segment_id: segment.segment_id,
          details: `Technical clause is not independently grounded: ${clause.text}`,
        });
      }
    }
    if (
      segment.statement_kind === "TRANSITION" &&
      semantic.some((clause) => clause.status === "REJECTED")
    ) {
      findings.push({
        code: "TRANSITION_TECHNICAL_CLAIM",
        segment_id: segment.segment_id,
        details:
          "A Transition label cannot exempt technical, safety, outcome, comparison, or causality prose.",
      });
    }
    if (
      semantic.length > 1 &&
      semantic.some((clause) =>
        segment.statement_kind === "TECHNICAL_FACT"
          ? clause.status !== "FACT_TRACED"
          : clause.status === "REJECTED",
      )
    ) {
      findings.push({
        code: "COMPOUND_CLAIM_UNGROUNDED",
        segment_id: segment.segment_id,
        details: "At least one atomic clause in the compound sentence is not grounded.",
      });
    }
    return semantic.map((clause) => {
      const clauseEntries = entries.filter((entry) =>
        clause.fact_ids.includes(entry.canonical_fact_id),
      );
      return {
        segment_id: segment.segment_id,
        clause_index: clause.clause_index,
        text: clause.text,
        statement_kind: segment.statement_kind,
        supporting_fact_refs: clauseEntries.map((entry) => entry.model_fact_ref),
        canonical_fact_ids: [...clause.fact_ids],
        evidence_ids: [
          ...new Set(clauseEntries.flatMap((entry) => entry.evidence_ids)),
        ],
        alignment_methods:
          exactTechnical?.alignment_methods ?? ["HOST_SEMANTICS_V3_FALLBACK"],
        status:
          clause.status === "FACT_TRACED"
            ? ("FACT_TRACED" as const)
            : clause.status === "EDITORIAL_ALLOWED"
              ? ("NON_TECHNICAL_ALLOWED" as const)
              : ("REJECTED" as const),
      };
    });
  });
  const estimatedSeconds = estimateDurationSeconds(
    input.draft,
    input.contract.model_input.style_profile,
  );
  const rangeResult =
    estimatedSeconds >= 60 && estimatedSeconds <= 90
      ? "TARGET"
      : estimatedSeconds >= 50 && estimatedSeconds <= 100
        ? "SOFT_WARNING"
        : "OUT_OF_RANGE";
  if (rangeResult === "OUT_OF_RANGE") {
    findings.push({
      code: "SCRIPT_DURATION_OUT_OF_RANGE",
      segment_id: null,
      details: `Estimated duration ${estimatedSeconds}s is outside the accepted contract range.`,
    });
  }
  const passed = findings.length === 0;
  return {
    script_validation_version: GROUNDED_SCRIPT_VALIDATION_VERSION,
    clause_alignment_version: SCRIPT_CLAUSE_ALIGNMENT_VERSION,
    status: passed ? "PASS" : "FAIL",
    decision: passed ? "HOST_VALIDATED" : "HOST_REJECTED",
    truth_gate: passed ? "PASS" : "FAIL",
    findings,
    clause_trace: clauseTrace,
    duration_estimate: {
      status: "ESTIMATE",
      language: input.draft.language,
      estimated_seconds: estimatedSeconds,
      target_min_seconds: 60,
      target_max_seconds: 90,
      range_result: rangeResult,
    },
  };
}

export function evaluateGroundedScriptFreshness(
  draft: GroundedScriptDraft,
  contract: GroundedScriptContractInput,
  current: CurrentGroundedScriptBinding,
): GroundedScriptFreshness {
  const reasons: GroundedScriptStaleReason[] = [];
  if (!sameRepository(contract.model_input.repository, current.repository)) {
    reasons.push("REPOSITORY_CHANGED");
  }
  if (contract.model_input.commit !== current.commit) {
    reasons.push("COMMIT_CHANGED");
  }
  if (contract.model_input.fact_ir_version !== current.fact_ir_version) {
    reasons.push("FACT_IR_VERSION_CHANGED");
  }
  if (
    contract.script_fact_pack.approved_angle_fingerprint_sha256 !==
    current.approved_angle_fingerprint_sha256
  ) {
    reasons.push("APPROVED_ANGLE_CHANGED");
  }
  if (
    contract.input_fingerprint_sha256 !==
    current.script_input_fingerprint_sha256
  ) {
    reasons.push("SCRIPT_INPUT_CHANGED");
  }
  if (
    !sameRepository(draft.repository, contract.model_input.repository) ||
    draft.commit !== contract.model_input.commit ||
    draft.fact_ir_version !== contract.model_input.fact_ir_version ||
    draft.approved_angle_ref !==
      contract.model_input.approved_angle.approved_angle_ref
  ) {
    reasons.push("SCRIPT_DRAFT_BINDING_CHANGED");
  }
  return {
    state: reasons.length === 0 ? "CURRENT" : "STALE",
    reason_codes: reasons,
    grounded_status_current: reasons.length === 0,
  };
}

function wordCount(value: string): number {
  return value.match(/[A-Za-z0-9_.:/-]+/g)?.length ?? 0;
}

export function evaluateScriptQuality(
  draft: GroundedScriptDraft,
  validation: GroundedScriptValidationReceipt,
): ScriptQualityReview {
  if (validation.truth_gate !== "PASS") {
    const notEvaluated = {
      angle_fidelity: "NOT_EVALUATED",
      clarity: "NOT_EVALUATED",
      narrative_coherence: "NOT_EVALUATED",
      spoken_naturalness: "NOT_EVALUATED",
      conciseness: "NOT_EVALUATED",
      technical_density: "NOT_EVALUATED",
      hook_quality: "NOT_EVALUATED",
      caveat_handling: "NOT_EVALUATED",
    } as const;
    return {
      script_quality_review_version: 1,
      basis: "QUALITATIVE_EDITORIAL_REVIEW_NOT_TRUTH",
      truth_gate_status: "FAIL",
      dimensions: notEvaluated,
      overall: "NOT_EVALUATED",
      release_status: "BLOCKED_BY_TRUTH",
    };
  }
  const roles = new Set(draft.segments.map((segment) => segment.role));
  const hook = draft.segments.find((segment) => segment.role === "HOOK");
  const technicalCount = draft.segments.filter(
    (segment) => segment.statement_kind === "TECHNICAL_FACT",
  ).length;
  const dimensions = {
    angle_fidelity: validation.findings.some(
      (finding) => finding.code === "SCRIPT_ANGLE_DRIFT",
    )
      ? ("FAIL" as const)
      : ("PASS" as const),
    clarity: draft.segments.every((segment) => segment.text.length <= 260)
      ? ("PASS" as const)
      : ("PARTIAL" as const),
    narrative_coherence: ["HOOK", "SETUP", "TECHNICAL_EXPLANATION", "CAVEAT", "CLOSE"].every(
      (role) => roles.has(role as ScriptRole),
    )
      ? ("PASS" as const)
      : ("PARTIAL" as const),
    spoken_naturalness: draft.segments.every(
      (segment) => !/^(?:#{1,6}|[-*]\s|\d+\.\s)/m.test(segment.text),
    )
      ? ("PASS" as const)
      : ("FAIL" as const),
    conciseness:
      validation.duration_estimate.range_result === "TARGET"
        ? ("PASS" as const)
        : ("PARTIAL" as const),
    technical_density:
      technicalCount >= 2 && technicalCount <= 8
        ? ("PASS" as const)
        : ("PARTIAL" as const),
    hook_quality:
      hook !== undefined && wordCount(hook.text) >= 6 && wordCount(hook.text) <= 30
        ? ("PASS" as const)
        : ("PARTIAL" as const),
    caveat_handling: roles.has("CAVEAT") ? ("PASS" as const) : ("FAIL" as const),
  };
  const values = Object.values(dimensions);
  const overall = values.includes("FAIL")
    ? "FAIL"
    : values.includes("PARTIAL")
      ? "PARTIAL"
      : "PASS";
  return {
    script_quality_review_version: 1,
    basis: "QUALITATIVE_EDITORIAL_REVIEW_NOT_TRUTH",
    truth_gate_status: "PASS",
    dimensions,
    overall,
    release_status:
      overall === "PASS" ? "HUMAN_REVIEW_READY" : "QUALITY_REVIEW_NEEDED",
  };
}

export function buildGroundedScriptReviewArtifact(
  input: BuildGroundedScriptReviewInput,
): GroundedScriptReviewArtifact {
  const factById = new Map(input.factPack.facts.map((fact) => [fact.id, fact]));
  const entityById = new Map(
    input.factPack.entities.map((entity) => [entity.id, entity]),
  );
  const referenced = new Set(
    input.draft.segments.flatMap((segment) => segment.supporting_fact_refs),
  );
  const factTrace = input.contract.reference_map.entries
    .filter((entry) => referenced.has(entry.model_fact_ref))
    .map((entry) => {
      const fact = factById.get(entry.canonical_fact_id);
      if (fact === undefined) {
        throw new Error(`SCRIPT_REVIEW_FACT_NOT_FOUND:${entry.canonical_fact_id}`);
      }
      const subject = entityById.get(fact.subject_ref)?.display_label;
      const object = entityById.get(fact.object_ref)?.display_label;
      if (subject === undefined || object === undefined) {
        throw new Error(`SCRIPT_REVIEW_ENTITY_NOT_FOUND:${fact.id}`);
      }
      return {
        model_fact_ref: entry.model_fact_ref,
        role: entry.role,
        canonical_fact_id: entry.canonical_fact_id,
        canonical_fact_summary: `${subject} ${fact.predicate} ${object} [${fact.scope}]`,
        evidence_ids: [...entry.evidence_ids],
        evidence_available: entry.evidence_ids.length > 0,
      };
    });
  return {
    script_review_version: 1,
    status:
      input.validation.truth_gate === "PASS"
        ? "HUMAN_REVIEW_READY"
        : "HOST_REJECTED",
    repository: { ...input.draft.repository },
    commit: input.draft.commit,
    fact_ir_version: input.draft.fact_ir_version,
    approved_angle: { ...input.contract.model_input.approved_angle },
    script_fact_pack_summary: {
      core_fact_count: input.contract.script_fact_pack.core_facts.length,
      context_fact_count: input.contract.script_fact_pack.context_facts.length,
      known_unknown_count: input.contract.script_fact_pack.known_unknowns.length,
      evidence_count: new Set(factTrace.flatMap((trace) => trace.evidence_ids)).size,
    },
    draft: input.draft,
    host_validation: input.validation,
    quality_review: input.quality,
    fact_trace: factTrace,
    known_caveats: [...input.contract.model_input.approved_angle.known_caveats],
    provenance: {
      ...input.contract.script_fact_pack.provenance,
      script_input_fingerprint_sha256: input.contract.input_fingerprint_sha256,
    },
    generation_metadata: {
      ...input.contract.script_fact_pack.generation_metadata,
      script_generation_executed: false,
    },
  };
}

function inline(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function renderGroundedScriptReviewPreview(
  review: GroundedScriptReviewArtifact,
): string {
  const traceByRef = new Map(
    review.fact_trace.map((trace) => [trace.model_fact_ref, trace]),
  );
  const lines = [
    "# Grounded Script Human Review",
    "",
    `Approved Angle: ${inline(review.approved_angle.title)}`,
    `Grounded: ${review.host_validation.truth_gate}`,
    `Quality Review: ${review.quality_review.overall}`,
    `Estimated Duration: ${review.host_validation.duration_estimate.estimated_seconds}s (ESTIMATE)`,
    `Evidence Count: ${review.script_fact_pack_summary.evidence_count}`,
    "",
    "## Script",
  ];
  for (const segment of review.draft.segments) {
    lines.push(
      "",
      `### ${segment.role} — ${segment.segment_id}`,
      "",
      inline(segment.text),
      "",
      `Statement Kind: ${segment.statement_kind}`,
      `Fact IDs: ${segment.supporting_fact_refs.length > 0 ? segment.supporting_fact_refs.join(", ") : "None"}`,
    );
  }
  lines.push("", "## Known Caveats", "");
  if (review.known_caveats.length === 0) {
    lines.push("- None recorded.");
  } else {
    lines.push(...review.known_caveats.map((caveat) => `- ${inline(caveat)}`));
  }
  lines.push(
    "",
    "<details>",
    "<summary>Show evidence and clause trace</summary>",
    "",
  );
  for (const clause of review.host_validation.clause_trace) {
    lines.push(
      `### ${clause.segment_id}.${clause.clause_index}`,
      "",
      `Clause: ${inline(clause.text)}`,
      `Trace Status: ${clause.status}`,
      `Fact IDs: ${clause.supporting_fact_refs.length > 0 ? clause.supporting_fact_refs.join(", ") : "None"}`,
    );
    for (const reference of clause.supporting_fact_refs) {
      const trace = traceByRef.get(reference);
      if (trace !== undefined) {
        lines.push(
          `- ${reference}`,
          `  - Canonical Fact Summary: ${inline(trace.canonical_fact_summary)}`,
          `  - Evidence available: ${trace.evidence_available ? "YES" : "NO"}`,
          `  - Evidence IDs: ${trace.evidence_ids.join(", ")}`,
        );
      }
    }
    lines.push("");
  }
  lines.push("</details>");
  return `${lines.join("\n").trimEnd()}\n`;
}

export function assertGroundedScriptReviewIntegrity(
  review: GroundedScriptReviewArtifact,
): void {
  const failures: string[] = [];
  if (
    !sameRepository(review.repository, review.draft.repository) ||
    review.commit !== review.draft.commit ||
    review.fact_ir_version !== review.draft.fact_ir_version
  ) {
    failures.push("SCRIPT_REVIEW_CONTEXT_MISMATCH");
  }
  if (
    review.approved_angle.approved_angle_ref !== review.draft.approved_angle_ref
  ) {
    failures.push("SCRIPT_REVIEW_ANGLE_MISMATCH");
  }
  if (
    (review.host_validation.truth_gate === "PASS") !==
    (review.status === "HUMAN_REVIEW_READY")
  ) {
    failures.push("SCRIPT_REVIEW_STATUS_MISMATCH");
  }
  if (
    review.quality_review.truth_gate_status !==
    review.host_validation.truth_gate
  ) {
    failures.push("SCRIPT_REVIEW_QUALITY_TRUTH_MISMATCH");
  }
  const traceRefs = review.fact_trace.map((trace) => trace.model_fact_ref);
  if (new Set(traceRefs).size !== traceRefs.length) {
    failures.push("SCRIPT_REVIEW_DUPLICATE_FACT_REFERENCE");
  }
  if (
    review.fact_trace.some(
      (trace) =>
        trace.evidence_available !== (trace.evidence_ids.length > 0),
    )
  ) {
    failures.push("SCRIPT_REVIEW_EVIDENCE_STATUS_MISMATCH");
  }
  const counters = review.generation_metadata;
  if (
    counters.paid_api_requests !== 0 ||
    counters.real_model_requests !== 0 ||
    counters.secret_reads !== 0 ||
    counters.repository_executions !== 0 ||
    counters.script_generation_executed !== false
  ) {
    failures.push("SCRIPT_REVIEW_OFFLINE_BOUNDARY_BROKEN");
  }
  if (failures.length > 0) {
    throw new Error(`GroundedScriptReview integrity failed: ${failures.join(", ")}`);
  }
}

export function parseGroundedScriptReviewArtifact(
  value: unknown,
  schemas: SchemaRegistry,
): GroundedScriptReviewArtifact {
  schemas.assert("GroundedScriptReview", value);
  const review = value as GroundedScriptReviewArtifact;
  assertGroundedScriptReviewIntegrity(review);
  return review;
}

export function serializeGroundedScriptReviewArtifact(
  review: GroundedScriptReviewArtifact,
): string {
  assertGroundedScriptReviewIntegrity(review);
  return `${JSON.stringify(review, null, 2)}\n`;
}
