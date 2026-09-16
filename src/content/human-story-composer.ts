import { createHash } from "node:crypto";

import type { CanonicalGroundedBriefArtifact } from "../brief/canonical.js";
import type {
  GroundedEntity,
  GroundedEvidenceRef,
  GroundedFact,
  GroundedFactPack,
} from "../facts/domain.js";
import type {
  NeighborhoodEditorialContext,
  NeighborhoodEditorialFact,
} from "../exploration/neighborhood-editorial-context.js";
import { HOST_ANGLE_SEMANTICS_VERSION } from "./angle-semantics.js";
import type { AngleSemanticClauseTrace } from "./angle-semantics.js";
import { evaluateMinimalAngleDecisionDraftV2 } from "./editorial-retest.js";
import type { ApprovedEditorialAngle } from "./editorial-selection.js";
import type { SchemaRegistry } from "../schemas/registry.js";

export const HUMAN_STORY_COMPOSER_CONTEXT_VERSION = 1 as const;
export const HUMAN_STORY_COMPOSER_CONTRACT_VERSION = 1 as const;
export const HUMAN_EDITORIAL_COMPOSITION_DRAFT_VERSION = 1 as const;
export const HUMAN_COMPOSITION_VALIDATION_VERSION = 1 as const;
export const HUMAN_COMPOSITION_DECISION_VERSION = 1 as const;
export const APPROVED_EDITORIAL_STORY_VERSION = 1 as const;

export interface ComposerArtifactReference {
  readonly artifact_path: string;
  readonly sha256: string;
}

export interface ComposerFactOption {
  readonly display_id: string;
  readonly plain_language_summary: string;
  readonly fact_kind: "DIRECT_STATIC_CALL" | "LOCAL_THROW_BRANCH";
  readonly canonical_fact_id: string;
  readonly evidence_available: true;
  readonly source_location: {
    readonly path: string;
    readonly line_start: null;
    readonly line_end: null;
  } | null;
  readonly boundary_note: string;
  readonly evidence_trace: {
    readonly evidence_ids: readonly string[];
    readonly repository_url: string;
    readonly repository_commit: string;
    readonly fact_ir_version: number;
    readonly fact_pack_artifact: ComposerArtifactReference;
  };
  readonly host_truth: {
    readonly subject: string;
    readonly predicate: "CALLS" | "THROWS_WHEN";
    readonly object: string;
    readonly scope: "LOCAL" | "MODULE";
    readonly limitations: readonly string[];
  };
}

export interface ComposerKnownUnknown {
  readonly unknown_ref: string;
  readonly plain_language_summary: string;
  readonly namespace: "KNOWN_UNKNOWN";
}

export interface HumanStoryComposerContext {
  readonly human_story_composer_context_version:
    typeof HUMAN_STORY_COMPOSER_CONTEXT_VERSION;
  readonly composer_context_version: typeof HUMAN_STORY_COMPOSER_CONTRACT_VERSION;
  readonly status: "READY";
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: number;
  readonly host_semantics_version: typeof HOST_ANGLE_SEMANTICS_VERSION;
  readonly neighborhood: {
    readonly neighborhood_id: string;
    readonly neighborhood_fingerprint_sha256: string;
    readonly seed_label: string;
  };
  readonly minimal_project_identity: {
    readonly repository_full_name: string;
    readonly technical_area: string;
    readonly selected_module_paths: readonly string[];
  };
  readonly fact_options: readonly ComposerFactOption[];
  readonly known_unknowns: readonly ComposerKnownUnknown[];
  readonly verified_boundary: readonly string[];
  readonly not_proven_boundary: readonly string[];
  readonly provenance: {
    readonly neighborhood_editorial_context: ComposerArtifactReference;
    readonly source_context_fingerprint_sha256: string;
    readonly selected_fact_source: "SELECTED_NEIGHBORHOOD_ONLY";
    readonly full_fact_space_loaded: false;
  };
  readonly generation_metadata: {
    readonly mode: "deterministic_offline_human_story_composer";
    readonly paid_api_requests: 0;
    readonly real_model_requests: 0;
    readonly secret_reads: 0;
    readonly repository_executions: 0;
  };
  readonly context_fingerprint_sha256: string;
}

export interface BuildHumanStoryComposerContextInput {
  readonly neighborhoodContext: NeighborhoodEditorialContext;
  readonly sourceArtifact: ComposerArtifactReference;
}

export type HumanCompositionState =
  | "DRAFT"
  | "HOST_VALIDATED"
  | "HOST_REJECTED"
  | "HUMAN_CONFIRMED"
  | "STALE";

export interface HumanEditorialCompositionDraft {
  readonly human_editorial_composition_draft_version:
    typeof HUMAN_EDITORIAL_COMPOSITION_DRAFT_VERSION;
  readonly composition_id: string;
  readonly composition_status: "DRAFT";
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: number;
  readonly host_semantics_version: typeof HOST_ANGLE_SEMANTICS_VERSION;
  readonly neighborhood_id: string;
  readonly neighborhood_fingerprint_sha256: string;
  readonly composer_context_fingerprint_sha256: string;
  readonly source: "HUMAN";
  readonly title: string;
  readonly editorial_thesis: string;
  readonly why_this_story: string;
  readonly target_audience: readonly string[];
  readonly selected_fact_display_ids: readonly string[];
  readonly selected_canonical_fact_ids: readonly string[];
  readonly selected_known_unknowns: readonly string[];
  readonly human_authored: true;
  readonly created_at: string;
  readonly draft_fingerprint_sha256: string;
}

export interface CreateHumanEditorialCompositionDraftInput {
  readonly context: HumanStoryComposerContext;
  readonly composition_id: string;
  readonly title: string;
  readonly editorial_thesis: string;
  readonly why_this_story: string;
  readonly target_audience: readonly string[];
  readonly selected_fact_display_ids: readonly string[];
  readonly selected_known_unknowns?: readonly string[];
  readonly created_at: string;
}

export type HumanClauseClassification =
  | "TECHNICAL_CLAIM"
  | "EDITORIAL_FRAMING"
  | "QUESTION"
  | "OUTCOME"
  | "SAFETY"
  | "DESIGN_INTENT"
  | "UNKNOWN";

export interface HumanCompositionClauseTrace {
  readonly field: "title" | "editorial_thesis" | "why_this_story";
  readonly clause_index: number;
  readonly text: string;
  readonly classification: HumanClauseClassification;
  readonly status: "PASS" | "FAIL";
  readonly supporting_canonical_fact_ids: readonly string[];
  readonly unsupported_anchors: readonly string[];
}

export interface HumanCompositionValidation {
  readonly human_composition_validation_version:
    typeof HUMAN_COMPOSITION_VALIDATION_VERSION;
  readonly composition_id: string;
  readonly validation_version: 1;
  readonly host_semantics_version: typeof HOST_ANGLE_SEMANTICS_VERSION;
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: number;
  readonly neighborhood_id: string;
  readonly neighborhood_fingerprint_sha256: string;
  readonly composer_context_fingerprint_sha256: string;
  readonly draft_fingerprint_sha256: string;
  readonly selected_facts_valid: boolean;
  readonly selected_fact_resolution: readonly {
    readonly display_id: string;
    readonly canonical_fact_id: string | null;
    readonly status: "RESOLVED" | "REJECTED";
  }[];
  readonly technical_clause_traces: readonly HumanCompositionClauseTrace[];
  readonly editorial_clauses: readonly HumanCompositionClauseTrace[];
  readonly unsupported_clauses: readonly HumanCompositionClauseTrace[];
  readonly known_unknown_conflicts: readonly string[];
  readonly reason_codes: readonly string[];
  readonly truth_status: "PASS" | "FAIL";
  readonly composition_status: Exclude<HumanCompositionState, "DRAFT" | "HUMAN_CONFIRMED">;
  readonly script_eligibility: {
    readonly eligible: false;
    readonly status: "NOT_ELIGIBLE";
    readonly reason:
      | "HUMAN_CONFIRMATION_REQUIRED"
      | "HOST_TRUTH_VALIDATION_FAILED"
      | "COMPOSITION_BINDING_STALE";
  };
  readonly generation_metadata: {
    readonly mode: "deterministic_offline_human_composition_validation";
    readonly paid_api_requests: 0;
    readonly real_model_requests: 0;
    readonly secret_reads: 0;
    readonly repository_executions: 0;
  };
  readonly validation_fingerprint_sha256: string;
}

export interface ValidateHumanEditorialCompositionInput {
  readonly context: HumanStoryComposerContext;
  readonly draft: HumanEditorialCompositionDraft;
  readonly schemas: SchemaRegistry;
}

export interface HumanCompositionDecisionArtifact {
  readonly human_composition_decision_version:
    typeof HUMAN_COMPOSITION_DECISION_VERSION;
  readonly composition_id: string;
  readonly composition_status: "HUMAN_CONFIRMED";
  readonly source: "HUMAN_COMPOSITION";
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: number;
  readonly host_semantics_version: typeof HOST_ANGLE_SEMANTICS_VERSION;
  readonly neighborhood_id: string;
  readonly neighborhood_fingerprint_sha256: string;
  readonly composer_context_fingerprint_sha256: string;
  readonly draft_fingerprint_sha256: string;
  readonly validation_fingerprint_sha256: string;
  readonly title: string;
  readonly editorial_thesis: string;
  readonly why_this_story: string;
  readonly target_audience: readonly string[];
  readonly selected_fact_display_ids: readonly string[];
  readonly selected_canonical_fact_ids: readonly string[];
  readonly selected_known_unknowns: readonly string[];
  readonly known_caveats: readonly string[];
  readonly host_validation: {
    readonly status: "PASS";
    readonly host_semantics_version: typeof HOST_ANGLE_SEMANTICS_VERSION;
    readonly validation_fingerprint_sha256: string;
  };
  readonly human_confirmed: true;
  readonly confirmation_timestamp: string;
  readonly decision_context: "USER_ACTION" | "OFFLINE_FIXTURE";
  readonly script_eligibility: {
    readonly eligible: true;
    readonly status: "ELIGIBLE_FOR_EXPLICIT_SCRIPT_ACTION";
    readonly explicit_script_generation_required: true;
  };
  readonly generation_metadata: {
    readonly mode: "offline_human_composition_confirmation";
    readonly paid_api_requests: 0;
    readonly real_model_requests: 0;
    readonly secret_reads: 0;
    readonly repository_executions: 0;
  };
  readonly decision_fingerprint_sha256: string;
}

export interface ConfirmHumanEditorialCompositionInput {
  readonly context: HumanStoryComposerContext;
  readonly draft: HumanEditorialCompositionDraft;
  readonly validation: HumanCompositionValidation;
  readonly explicit_confirmation: boolean;
  readonly confirmed_at: string;
  readonly decision_context: "USER_ACTION" | "OFFLINE_FIXTURE";
}

export interface ApprovedEditorialStory {
  readonly approved_editorial_story_version: typeof APPROVED_EDITORIAL_STORY_VERSION;
  readonly story_id: string;
  readonly source: "MODEL_SUGGESTED_ANGLE" | "HUMAN_COMPOSITION";
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: number;
  readonly host_semantics_version: typeof HOST_ANGLE_SEMANTICS_VERSION;
  readonly title: string;
  readonly editorial_thesis: string;
  readonly why_this_story: string;
  readonly target_audience: readonly string[];
  readonly supporting_fact_ids: readonly string[];
  readonly known_caveats: readonly string[];
  readonly approval_provenance: {
    readonly source: "MODEL_SUGGESTED_ANGLE" | "HUMAN_COMPOSITION";
    readonly human_confirmed: true;
    readonly approval_artifact_fingerprint_sha256: string;
    readonly approved_at: string;
    readonly decision_context: "USER_ACTION" | "OFFLINE_FIXTURE";
  };
  readonly host_validation: {
    readonly status: "PASS";
    readonly host_semantics_version: typeof HOST_ANGLE_SEMANTICS_VERSION;
    readonly validation_fingerprint_sha256: string;
  };
  readonly script_eligibility: {
    readonly contract_eligible: true;
    readonly execution_authorized: false;
    readonly explicit_script_generation_action_required: true;
  };
  readonly story_fingerprint_sha256: string;
}

export interface NormalizeApprovedEditorialStoryFromHumanInput {
  readonly context: HumanStoryComposerContext;
  readonly draft: HumanEditorialCompositionDraft;
  readonly validation: HumanCompositionValidation;
  readonly decision: HumanCompositionDecisionArtifact;
}

export interface NormalizeApprovedEditorialStoryFromModelInput {
  readonly approval: ApprovedEditorialAngle;
  readonly current_host_validation: ApprovedEditorialStory["host_validation"];
  readonly why_this_story: string;
  readonly target_audience: readonly string[];
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

function assertIsoTimestamp(value: string): void {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error("HUMAN_COMPOSITION_TIMESTAMP_INVALID");
  }
}

function sameRepository(
  left: GroundedFactPack["repository"],
  right: GroundedFactPack["repository"],
): boolean {
  return left.url === right.url && left.owner === right.owner && left.name === right.name;
}

function sourceContextBody(
  context: NeighborhoodEditorialContext,
): Omit<NeighborhoodEditorialContext, "context_fingerprint_sha256"> {
  const { context_fingerprint_sha256: _fingerprint, ...body } = context;
  return body;
}

function assertSourceContextIntegrity(context: NeighborhoodEditorialContext): void {
  if (
    context.status !== "READY" ||
    context.context_fingerprint_sha256 !== sha256(sourceContextBody(context)) ||
    context.canonical_fact_refs.length !== context.canonical_facts.length ||
    context.canonical_fact_refs.some(
      (factId, index) => context.canonical_facts[index]?.canonical_fact_ref !== factId,
    ) ||
    context.provenance.selected_fact_source !== "SELECTED_NEIGHBORHOOD_ONLY" ||
    context.provenance.full_fact_space_loaded !== false
  ) {
    throw new Error("HUMAN_STORY_COMPOSER_SOURCE_CONTEXT_INVALID");
  }
}

function parseFact(fact: NeighborhoodEditorialFact): ComposerFactOption["host_truth"] {
  const match = /^(.+?) (CALLS|THROWS_WHEN) (.+?) \[(.+)]$/.exec(fact.summary);
  if (match === null || match[1] === undefined || match[2] === undefined || match[3] === undefined) {
    throw new Error(`HUMAN_STORY_COMPOSER_FACT_TEMPLATE_UNSUPPORTED:${fact.canonical_fact_ref}`);
  }
  const predicate = match[2];
  if (
    (predicate !== "CALLS" && predicate !== "THROWS_WHEN") ||
    predicate !== fact.predicate
  ) {
    throw new Error(`HUMAN_STORY_COMPOSER_FACT_PREDICATE_MISMATCH:${fact.canonical_fact_ref}`);
  }
  return {
    subject: match[1],
    predicate,
    object: match[3],
    scope: fact.connection_scope === "CROSS_MODULE" ? "MODULE" : "LOCAL",
    limitations: [...fact.limitations],
  };
}

function plainLanguageSummary(
  truth: ComposerFactOption["host_truth"],
): string {
  return truth.predicate === "CALLS"
    ? `${truth.subject} contains a direct static call expression to ${truth.object}.`
    : `${truth.subject} contains an authored local throw branch for condition: ${truth.object}.`;
}

function knownUnknownSummary(unknownRef: string): string {
  const summaries: Readonly<Record<string, string>> = {
    gap_call_relation_coverage_gap_alias:
      "Alias and re-export resolution is not established by this bounded context.",
    gap_call_relation_dynamic_and_indirect:
      "Dynamic and indirect call targets are not established by this bounded context.",
    gap_general_branch_behavior:
      "Complete branch behavior and runtime coverage are not established by this bounded context.",
  };
  return (
    summaries[unknownRef] ??
    "This area is not established by the selected bounded evidence."
  );
}

function factOption(
  fact: NeighborhoodEditorialFact,
  index: number,
  context: NeighborhoodEditorialContext,
): ComposerFactOption {
  const hostTruth = parseFact(fact);
  const sourceLocation =
    context.project_identity.selected_module_paths.length === 1 &&
    context.project_identity.selected_module_paths[0] !== undefined
      ? {
          path: context.project_identity.selected_module_paths[0],
          line_start: null,
          line_end: null,
        }
      : null;
  return {
    display_id: `F${index + 1}`,
    plain_language_summary: plainLanguageSummary(hostTruth),
    fact_kind:
      hostTruth.predicate === "CALLS"
        ? "DIRECT_STATIC_CALL"
        : "LOCAL_THROW_BRANCH",
    canonical_fact_id: fact.canonical_fact_ref,
    evidence_available: true,
    source_location: sourceLocation,
    boundary_note: fact.limitations.join(" "),
    evidence_trace: {
      evidence_ids: [...fact.evidence_provenance.evidence_ids],
      repository_url: fact.evidence_provenance.repository_url,
      repository_commit: fact.evidence_provenance.repository_commit,
      fact_ir_version: fact.evidence_provenance.fact_ir_version,
      fact_pack_artifact: { ...fact.evidence_provenance.fact_pack_artifact },
    },
    host_truth: hostTruth,
  };
}

function contextBody(
  context: HumanStoryComposerContext,
): Omit<HumanStoryComposerContext, "context_fingerprint_sha256"> {
  const { context_fingerprint_sha256: _fingerprint, ...body } = context;
  return body;
}

export function buildHumanStoryComposerContext(
  input: BuildHumanStoryComposerContextInput,
): HumanStoryComposerContext {
  assertSourceContextIntegrity(input.neighborhoodContext);
  const source = input.neighborhoodContext;
  const body = {
    human_story_composer_context_version: HUMAN_STORY_COMPOSER_CONTEXT_VERSION,
    composer_context_version: HUMAN_STORY_COMPOSER_CONTRACT_VERSION,
    status: "READY" as const,
    repository: { ...source.repository },
    commit: source.commit,
    fact_ir_version: source.fact_ir_version,
    host_semantics_version: HOST_ANGLE_SEMANTICS_VERSION,
    neighborhood: {
      neighborhood_id: source.selected_neighborhood.neighborhood_id,
      neighborhood_fingerprint_sha256:
        source.selected_neighborhood.neighborhood_fingerprint_sha256,
      seed_label: source.selected_neighborhood.seed_label,
    },
    minimal_project_identity: {
      repository_full_name: source.project_identity.repository_full_name,
      technical_area: source.selected_neighborhood.seed_label,
      selected_module_paths: [...source.project_identity.selected_module_paths],
    },
    fact_options: source.canonical_facts.map((fact, index) =>
      factOption(fact, index, source),
    ),
    known_unknowns: source.known_unknowns.map((unknown) => ({
      unknown_ref: unknown.unknown_ref,
      plain_language_summary: knownUnknownSummary(unknown.unknown_ref),
      namespace: "KNOWN_UNKNOWN" as const,
    })),
    verified_boundary: [
      "The selected CALL facts verify authored direct static call expressions only.",
      "The selected behavioral facts verify three authored local throw branches for their stated conditions.",
    ],
    not_proven_boundary: [
      "security, SSRF prevention, attack prevention, or safe remote-request guarantees are not proven.",
      "Author design intent, correctness, and quality guarantees are not proven.",
      "Runtime execution, data flow, call frequency, and guaranteed runtime order are not proven.",
      "All runtime paths, alias or dynamic call targets, and complete branch semantics are not proven.",
    ],
    provenance: {
      neighborhood_editorial_context: { ...input.sourceArtifact },
      source_context_fingerprint_sha256: source.context_fingerprint_sha256,
      selected_fact_source: "SELECTED_NEIGHBORHOOD_ONLY" as const,
      full_fact_space_loaded: false as const,
    },
    generation_metadata: {
      mode: "deterministic_offline_human_story_composer" as const,
      paid_api_requests: 0 as const,
      real_model_requests: 0 as const,
      secret_reads: 0 as const,
      repository_executions: 0 as const,
    },
  };
  return {
    ...body,
    context_fingerprint_sha256: sha256(body),
  };
}

export function assertHumanStoryComposerContextIntegrity(
  context: HumanStoryComposerContext,
): void {
  const displayIds = context.fact_options.map((option) => option.display_id);
  const canonicalIds = context.fact_options.map(
    (option) => option.canonical_fact_id,
  );
  if (
    context.status !== "READY" ||
    context.host_semantics_version !== HOST_ANGLE_SEMANTICS_VERSION ||
    context.context_fingerprint_sha256 !== sha256(contextBody(context)) ||
    context.fact_options.length < 1 ||
    context.fact_options.length > 30 ||
    new Set(displayIds).size !== displayIds.length ||
    new Set(canonicalIds).size !== canonicalIds.length ||
    context.fact_options.some(
      (option, index) =>
        option.display_id !== `F${index + 1}` ||
        option.evidence_available !== true ||
        option.evidence_trace.repository_commit !== context.commit ||
        option.evidence_trace.fact_ir_version !== context.fact_ir_version ||
        option.evidence_trace.evidence_ids.length === 0,
    ) ||
    context.provenance.full_fact_space_loaded !== false
  ) {
    throw new Error("HUMAN_STORY_COMPOSER_CONTEXT_INTEGRITY_FAILED");
  }
}

function draftBody(
  draft: HumanEditorialCompositionDraft,
): Omit<HumanEditorialCompositionDraft, "draft_fingerprint_sha256"> {
  const { draft_fingerprint_sha256: _fingerprint, ...body } = draft;
  return body;
}

function resolveDisplayFacts(
  context: HumanStoryComposerContext,
  displayIds: readonly string[],
): {
  readonly options: readonly ComposerFactOption[];
  readonly resolution: HumanCompositionValidation["selected_fact_resolution"];
} {
  const byDisplayId = new Map(
    context.fact_options.map((option) => [option.display_id, option] as const),
  );
  const resolution = displayIds.map((displayId) => {
    const option = byDisplayId.get(displayId);
    return {
      display_id: displayId,
      canonical_fact_id: option?.canonical_fact_id ?? null,
      status: option === undefined ? ("REJECTED" as const) : ("RESOLVED" as const),
    };
  });
  return {
    options: resolution.flatMap((item) => {
      const option = byDisplayId.get(item.display_id);
      return option === undefined ? [] : [option];
    }),
    resolution,
  };
}

export function createHumanEditorialCompositionDraft(
  input: CreateHumanEditorialCompositionDraftInput,
): HumanEditorialCompositionDraft {
  assertHumanStoryComposerContextIntegrity(input.context);
  assertIsoTimestamp(input.created_at);
  if (!/^composition_[a-z0-9_]+$/.test(input.composition_id)) {
    throw new Error("HUMAN_COMPOSITION_ID_INVALID");
  }
  if (
    input.title.trim().length === 0 ||
    input.editorial_thesis.trim().length === 0 ||
    input.why_this_story.trim().length === 0 ||
    input.target_audience.length === 0 ||
    input.target_audience.some((audience) => audience.trim().length === 0) ||
    input.selected_fact_display_ids.length < 1 ||
    input.selected_fact_display_ids.length > 8 ||
    new Set(input.selected_fact_display_ids).size !== input.selected_fact_display_ids.length
  ) {
    throw new Error("HUMAN_COMPOSITION_DRAFT_INPUT_INVALID");
  }
  const resolved = resolveDisplayFacts(
    input.context,
    input.selected_fact_display_ids,
  );
  if (
    resolved.options.length !== input.selected_fact_display_ids.length ||
    resolved.resolution.some((item) => item.status !== "RESOLVED")
  ) {
    throw new Error("HUMAN_COMPOSITION_UNKNOWN_DISPLAY_FACT_REFERENCE");
  }
  const selectedKnownUnknowns = input.selected_known_unknowns ?? [];
  const knownUnknownIds = new Set(
    input.context.known_unknowns.map((unknown) => unknown.unknown_ref),
  );
  if (
    new Set(selectedKnownUnknowns).size !== selectedKnownUnknowns.length ||
    selectedKnownUnknowns.some((unknownId) => !knownUnknownIds.has(unknownId))
  ) {
    throw new Error("HUMAN_COMPOSITION_UNKNOWN_KNOWN_UNKNOWN_REFERENCE");
  }
  const body = {
    human_editorial_composition_draft_version:
      HUMAN_EDITORIAL_COMPOSITION_DRAFT_VERSION,
    composition_id: input.composition_id,
    composition_status: "DRAFT" as const,
    repository: { ...input.context.repository },
    commit: input.context.commit,
    fact_ir_version: input.context.fact_ir_version,
    host_semantics_version: input.context.host_semantics_version,
    neighborhood_id: input.context.neighborhood.neighborhood_id,
    neighborhood_fingerprint_sha256:
      input.context.neighborhood.neighborhood_fingerprint_sha256,
    composer_context_fingerprint_sha256:
      input.context.context_fingerprint_sha256,
    source: "HUMAN" as const,
    title: input.title.trim(),
    editorial_thesis: input.editorial_thesis.trim(),
    why_this_story: input.why_this_story.trim(),
    target_audience: input.target_audience.map((audience) => audience.trim()),
    selected_fact_display_ids: [...input.selected_fact_display_ids],
    selected_canonical_fact_ids: resolved.options.map(
      (option) => option.canonical_fact_id,
    ),
    selected_known_unknowns: [...selectedKnownUnknowns],
    human_authored: true as const,
    created_at: input.created_at,
  };
  return {
    ...body,
    draft_fingerprint_sha256: sha256(body),
  };
}

function entityId(kind: "symbol" | "condition", label: string): string {
  return `composer_entity_${kind}_${sha256({ kind, label }).slice(0, 20)}`;
}

function buildComposerHostTruthProjection(context: HumanStoryComposerContext): {
  readonly pack: GroundedFactPack;
  readonly canonical: CanonicalGroundedBriefArtifact;
} {
  const evidenceTypes = new Map<string, GroundedEvidenceRef["evidence_type"]>();
  const entityDetails = new Map<
    string,
    { readonly kind: "symbol" | "condition"; readonly label: string; readonly evidenceIds: Set<string>; readonly sourcePath: string }
  >();
  const facts: GroundedFact[] = context.fact_options.map((option) => {
    const subjectRef = entityId("symbol", option.host_truth.subject);
    const objectKind = option.host_truth.predicate === "CALLS" ? "symbol" : "condition";
    const objectRef = entityId(objectKind, option.host_truth.object);
    const sourcePath = option.source_location?.path ?? context.minimal_project_identity.selected_module_paths[0]!;
    for (const [id, kind, label] of [
      [subjectRef, "symbol", option.host_truth.subject],
      [objectRef, objectKind, option.host_truth.object],
    ] as const) {
      const existing = entityDetails.get(id);
      const evidenceIds = existing?.evidenceIds ?? new Set<string>();
      option.evidence_trace.evidence_ids.forEach((evidenceId) => evidenceIds.add(evidenceId));
      entityDetails.set(id, { kind, label, evidenceIds, sourcePath });
    }
    for (const evidenceId of option.evidence_trace.evidence_ids) {
      evidenceTypes.set(
        evidenceId,
        option.host_truth.predicate === "CALLS" ? "direct_call" : "source_range",
      );
    }
    return {
      id: option.canonical_fact_id,
      fact_type:
        option.host_truth.predicate === "CALLS" ? "CALL_RELATION" : "BRANCH_BEHAVIOR",
      category: option.host_truth.predicate === "CALLS" ? "RELATION" : "BEHAVIORAL",
      subject_ref: subjectRef,
      predicate: option.host_truth.predicate,
      object_ref: objectRef,
      scope: option.host_truth.scope,
      evidence_ids: [...option.evidence_trace.evidence_ids],
      source_kind: "source_code",
      verification: { status: "verified", confidence: 1 },
      qualifiers:
        option.host_truth.predicate === "CALLS"
          ? [{ key: "RELATIONSHIP_TYPE", value: "DIRECT_STATIC_CALL" }]
          : [{ key: "ACTION", value: "THROW" }],
      limitations: [...option.host_truth.limitations],
      provenance: {
        repository: { url: context.repository.url, commit_sha: context.commit },
        extractor: "deterministic-evidence-to-fact-v2",
        evidence_ids: [...option.evidence_trace.evidence_ids],
      },
    };
  });
  const entities: GroundedEntity[] = [...entityDetails.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([id, details]) => ({
      id,
      kind: details.kind,
      display_label: details.label,
      source_path: details.sourcePath,
      ...(details.kind === "symbol"
        ? { symbol: { name: details.label, kind: "function" as const } }
        : {}),
      evidence_ids: [...details.evidenceIds].sort(compareText),
    }));
  const evidenceRefs: GroundedEvidenceRef[] = [...evidenceTypes.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([id, evidence_type]) => ({
      id,
      evidence_type,
      source_kind: "source_code",
      verification_status: "verified",
    }));
  const pack: GroundedFactPack = {
    fact_ir_version: context.fact_ir_version as GroundedFactPack["fact_ir_version"],
    repository: { ...context.repository },
    commit: context.commit,
    entities,
    facts,
    evidence_refs: evidenceRefs,
    unsupported_areas: context.known_unknowns.map((unknown) => ({
      id: unknown.unknown_ref.replace(/^gap_/, ""),
      reason: unknown.plain_language_summary,
      evidence_needed: "Additional scoped Evidence bound to the same repository and commit.",
    })),
    limitations: [...context.not_proven_boundary],
  };
  const statements = facts.map((fact, index) => ({
    id: `composer_statement_${String(index + 1).padStart(3, "0")}`,
    text: context.fact_options[index]!.plain_language_summary,
    kind: "TECHNICAL_FACT" as const,
    scope: fact.scope,
    fact_ids: [fact.id],
    entity_refs: [fact.subject_ref, fact.object_ref],
    assertions: [{
      fact_id: fact.id,
      subject_ref: fact.subject_ref,
      predicate: fact.predicate,
      object_ref: fact.object_ref,
    }],
    unknown_ids: [],
    limitations: [...fact.limitations],
  }));
  const unknowns = context.known_unknowns.map((unknown) => ({
    id: unknown.unknown_ref,
    statement: unknown.plain_language_summary,
    source_gap_ids: [unknown.unknown_ref.replace(/^gap_/, "")],
    evidence_needed: "Additional scoped Evidence bound to the same repository and commit.",
  }));
  const brief = {
    brief_version: 1 as const,
    repository: { ...context.repository },
    commit: context.commit,
    fact_ir_version: pack.fact_ir_version,
    brief_plan_version: 1 as const,
    sections: [
      { id: "selected_composer_facts", title: "Selected Composer Facts", statements },
      {
        id: "known_unknowns",
        title: "Known Unknowns",
        statements: unknowns.map((unknown, index) => ({
          id: `composer_unknown_${String(index + 1).padStart(3, "0")}`,
          text: unknown.statement,
          kind: "UNKNOWN" as const,
          scope: "NONE" as const,
          fact_ids: [],
          entity_refs: [],
          assertions: [],
          unknown_ids: [unknown.id],
          limitations: ["Human-authored text is not Evidence."],
        })),
      },
    ],
    fact_references: statements.map((statement) => ({
      statement_id: statement.id,
      fact_ids: [...statement.fact_ids],
    })),
    unknowns,
    limitations: [...context.not_proven_boundary],
    generation_metadata: {
      mode: "deterministic" as const,
      generator: "human-story-composer-context-v1-host-projection",
      provider: null,
      model: null,
      paid_api_requests: 0,
      real_model_requests: 0,
      repository_executions: 0,
    },
  };
  const canonical: CanonicalGroundedBriefArtifact = {
    canonical_grounded_brief_version: 1,
    status: "ACCEPTED",
    repository: { ...context.repository },
    commit: context.commit,
    fact_ir_version: pack.fact_ir_version,
    brief_contract_version: 1,
    brief_plan_version: 1,
    selection_policy_version: 1,
    generation_mode: "deterministic",
    selected_fact_ids: facts.map((fact) => fact.id),
    statement_to_fact_trace: statements.map((statement) => ({
      statement_id: statement.id,
      statement_kind: "TECHNICAL_FACT",
      fact_ids: [...statement.fact_ids],
    })),
    fact_to_evidence_trace: facts.map((fact) => ({
      fact_id: fact.id,
      evidence_ids: [...fact.evidence_ids],
      evidence_refs: evidenceRefs.filter((evidence) => fact.evidence_ids.includes(evidence.id)),
    })),
    known_unknowns: unknowns,
    limitations: [...context.not_proven_boundary],
    brief,
    acceptance: {
      schema: "PASS",
      fact_references: "PASS",
      statement_to_fact_trace: "PASS",
      fact_to_evidence_trace: "PASS",
      unsupported_entities: 0,
      predicate_expansions: 0,
      scope_expansions: 0,
      unsupported_safety_or_outcome: 0,
      compound_claim_leakage: 0,
      documentation_boundary: "PASS",
      known_unknown_preservation: "PASS",
      repository_commit_binding: "PASS",
      determinism: "PASS",
      technical_utility: "PASS",
      readability: "PASS",
    },
    source_artifacts: {
      grounded_fact_pack: "grounded-fact-pack.json",
      brief_plan: "brief-plan.json",
    },
    downstream_truth_source: {
      allowed_inputs: [
        "grounded_fact_pack",
        "canonical_grounded_brief",
        "known_unknowns",
        "canonical_evidence_when_needed",
      ],
      forbidden_inputs: [
        "raw_llm_brief",
        "raw_repository",
        "vs02_model_outputs",
        "vs03_c_draft",
        "vs03_c2_draft",
      ],
      content_angle_permissions: ["select", "rank", "group", "frame"],
      canonical_fact_prohibitions: ["create", "upgrade", "rewrite", "replace"],
    },
  };
  return { pack, canonical };
}

function mappedField(
  field: AngleSemanticClauseTrace["field"],
): HumanCompositionClauseTrace["field"] | null {
  if (field === "title" || field === "editorial_thesis") return field;
  if (field === "why_interesting") return "why_this_story";
  return null;
}

function classifyClause(trace: AngleSemanticClauseTrace): HumanClauseClassification {
  if (/[?？]\s*$/.test(trace.text)) return "QUESTION";
  if (/\b(?:designed?|intended|purpose|aims? to|in order to|why the author|authors? added)\b|为了|意图|旨在/i.test(trace.text)) {
    return "DESIGN_INTENT";
  }
  switch (trace.clause_type) {
    case "TECHNICAL":
    case "BOUNDARY_CLAIM":
    case "ABSENCE_CLAIM":
    case "SYMBOL_NAME_SEMANTIC_INFERENCE":
    case "ENGINEERING_IMPLICATION":
    case "TECHNICAL_CAUSALITY":
    case "EXTERNAL_COMPARISON":
    case "NOVELTY":
      return "TECHNICAL_CLAIM";
    case "EDITORIAL_JUDGMENT":
      return "EDITORIAL_FRAMING";
    case "OUTCOME":
      return "OUTCOME";
    case "SAFETY":
      return "SAFETY";
    default:
      return "UNKNOWN";
  }
}

function clausePreview(
  traces: readonly AngleSemanticClauseTrace[],
): HumanCompositionClauseTrace[] {
  return traces.flatMap((trace) => {
    const field = mappedField(trace.field);
    if (field === null) return [];
    const classification = classifyClause(trace);
    return [{
      field,
      clause_index: trace.clause_index,
      text: trace.text,
      classification,
      status:
        trace.status === "FACT_TRACED" || trace.status === "EDITORIAL_ALLOWED"
          ? ("PASS" as const)
          : ("FAIL" as const),
      supporting_canonical_fact_ids: [...trace.fact_ids],
      unsupported_anchors: [...trace.untraced_anchors],
    }];
  });
}

function bindingReasons(
  context: HumanStoryComposerContext,
  draft: HumanEditorialCompositionDraft,
): string[] {
  const reasons: string[] = [];
  if (!sameRepository(context.repository, draft.repository)) reasons.push("REPOSITORY_CHANGED");
  if (context.commit !== draft.commit) reasons.push("REPOSITORY_COMMIT_CHANGED");
  if (context.fact_ir_version !== draft.fact_ir_version) reasons.push("FACT_IR_VERSION_CHANGED");
  if (context.host_semantics_version !== draft.host_semantics_version) reasons.push("HOST_SEMANTICS_VERSION_CHANGED");
  if (context.neighborhood.neighborhood_id !== draft.neighborhood_id) reasons.push("NEIGHBORHOOD_CHANGED");
  if (context.neighborhood.neighborhood_fingerprint_sha256 !== draft.neighborhood_fingerprint_sha256) reasons.push("NEIGHBORHOOD_FINGERPRINT_CHANGED");
  if (context.context_fingerprint_sha256 !== draft.composer_context_fingerprint_sha256) reasons.push("COMPOSER_CONTEXT_CHANGED");
  return reasons;
}

function validationBody(
  validation: HumanCompositionValidation,
): Omit<HumanCompositionValidation, "validation_fingerprint_sha256"> {
  const { validation_fingerprint_sha256: _fingerprint, ...body } = validation;
  return body;
}

export function validateHumanEditorialComposition(
  input: ValidateHumanEditorialCompositionInput,
): HumanCompositionValidation {
  assertHumanStoryComposerContextIntegrity(input.context);
  const binding = bindingReasons(input.context, input.draft);
  const resolved = resolveDisplayFacts(
    input.context,
    input.draft.selected_fact_display_ids,
  );
  const expectedCanonicalIds = resolved.options.map((option) => option.canonical_fact_id);
  const selectionShapeValid =
    input.draft.selected_fact_display_ids.length >= 1 &&
    input.draft.selected_fact_display_ids.length <= 8 &&
    new Set(input.draft.selected_fact_display_ids).size === input.draft.selected_fact_display_ids.length;
  const referencesValid =
    resolved.resolution.every((item) => item.status === "RESOLVED") &&
    expectedCanonicalIds.length === input.draft.selected_fact_display_ids.length;
  const hostDerivedIdsValid =
    JSON.stringify(expectedCanonicalIds) ===
    JSON.stringify(input.draft.selected_canonical_fact_ids);
  const knownUnknownIds = new Set(
    input.context.known_unknowns.map((unknown) => unknown.unknown_ref),
  );
  const knownUnknownsValid =
    new Set(input.draft.selected_known_unknowns).size ===
      input.draft.selected_known_unknowns.length &&
    input.draft.selected_known_unknowns.every((unknownId) =>
      knownUnknownIds.has(unknownId),
    );
  const fingerprintValid =
    input.draft.draft_fingerprint_sha256 === sha256(draftBody(input.draft));
  const reasonCodes: string[] = [...binding];
  if (!selectionShapeValid) reasonCodes.push("SELECTED_FACT_COUNT_OR_UNIQUENESS_INVALID");
  if (!referencesValid) reasonCodes.push("UNKNOWN_DISPLAY_FACT_REFERENCE");
  if (!hostDerivedIdsValid) reasonCodes.push("HOST_DERIVED_FACT_SET_MISMATCH");
  if (!knownUnknownsValid) reasonCodes.push("UNKNOWN_KNOWN_UNKNOWN_REFERENCE");
  if (!fingerprintValid) reasonCodes.push("DRAFT_FINGERPRINT_MISMATCH");

  let traces: HumanCompositionClauseTrace[] = [];
  let formalDecision: "ACCEPT" | "DOWNGRADE" | "REJECT" | "DEDUPLICATE" | null = null;
  let knownUnknownConflicts: readonly string[] = [];
  if (
    binding.length === 0 &&
    selectionShapeValid &&
    referencesValid &&
    hostDerivedIdsValid &&
    knownUnknownsValid &&
    fingerprintValid
  ) {
    const truth = buildComposerHostTruthProjection(input.context);
    const formal = evaluateMinimalAngleDecisionDraftV2(
      {
        minimal_angle_draft_version: 2,
        candidates: [{
          candidate_id: input.draft.composition_id,
          title: input.draft.title,
          angle_type: "EDUCATIONAL_INSIGHT",
          editorial_thesis: input.draft.editorial_thesis,
          supporting_fact_ids: expectedCanonicalIds,
          why_interesting: input.draft.why_this_story,
          target_audience: ["TECH_CREATOR"],
          editorial_confidence: "MEDIUM",
        }],
      },
      truth.pack,
      truth.canonical,
      input.schemas,
    );
    const decision = formal.decisions[0];
    formalDecision = decision?.decision ?? null;
    reasonCodes.push(
      ...(decision?.reason_codes ?? []).filter(
        (reason) => reason !== "ALL_HARD_GATES_PASSED",
      ),
    );
    knownUnknownConflicts = formal.enrichment[0]?.known_unknown_conflicts ?? [];
    traces = clausePreview(
      formal.hostEvaluation.decision_trace[0]?.semantic_clause_trace ?? [],
    );
    const corpus = [input.draft.title, input.draft.editorial_thesis, input.draft.why_this_story].join(" ");
    if (/\b(?:designed?|intended|purpose|aims? to|in order to|why the author|authors? added)\b|为了|意图|旨在/i.test(corpus)) {
      reasonCodes.push("DESIGN_INTENT_UNSUPPORTED");
    }
    if (
      /[?？]/.test(corpus) &&
      /\b(?:prevents?|protects?|guarantees?|ensures?|malicious|hostile|attacks?|safe|secure)\b|恶意|防止|保护|安全/i.test(corpus)
    ) {
      reasonCodes.push("QUESTION_PREMISE_UNSUPPORTED");
    }
    if (/\b(?:only|sole|unique)\s+(?:function|method|module|path|call|implementation)\b|唯一(?:函数|方法|模块|路径|调用|实现)/i.test(corpus)) {
      reasonCodes.push("EXCLUSIVITY_UNSUPPORTED");
    }
  }
  const uniqueReasons = [...new Set(reasonCodes)];
  const stale = binding.length > 0;
  const pass =
    !stale &&
    selectionShapeValid &&
    referencesValid &&
    hostDerivedIdsValid &&
    knownUnknownsValid &&
    fingerprintValid &&
    formalDecision === "ACCEPT" &&
    uniqueReasons.length === 0;
  const body = {
    human_composition_validation_version: HUMAN_COMPOSITION_VALIDATION_VERSION,
    composition_id: input.draft.composition_id,
    validation_version: 1 as const,
    host_semantics_version: HOST_ANGLE_SEMANTICS_VERSION,
    repository: { ...input.context.repository },
    commit: input.context.commit,
    fact_ir_version: input.context.fact_ir_version,
    neighborhood_id: input.context.neighborhood.neighborhood_id,
    neighborhood_fingerprint_sha256:
      input.context.neighborhood.neighborhood_fingerprint_sha256,
    composer_context_fingerprint_sha256:
      input.context.context_fingerprint_sha256,
    draft_fingerprint_sha256: input.draft.draft_fingerprint_sha256,
    selected_facts_valid:
      selectionShapeValid && referencesValid && hostDerivedIdsValid,
    selected_fact_resolution: resolved.resolution,
    technical_clause_traces: traces.filter(
      (trace) => trace.classification !== "EDITORIAL_FRAMING",
    ),
    editorial_clauses: traces.filter(
      (trace) => trace.classification === "EDITORIAL_FRAMING",
    ),
    unsupported_clauses: traces.filter((trace) => trace.status === "FAIL"),
    known_unknown_conflicts: [...knownUnknownConflicts],
    reason_codes: uniqueReasons,
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
      mode: "deterministic_offline_human_composition_validation" as const,
      paid_api_requests: 0 as const,
      real_model_requests: 0 as const,
      secret_reads: 0 as const,
      repository_executions: 0 as const,
    },
  };
  return {
    ...body,
    validation_fingerprint_sha256: sha256(body),
  };
}

export function assertHumanCompositionValidationIntegrity(
  validation: HumanCompositionValidation,
): void {
  if (
    validation.host_semantics_version !== HOST_ANGLE_SEMANTICS_VERSION ||
    validation.validation_fingerprint_sha256 !== sha256(validationBody(validation)) ||
    validation.generation_metadata.paid_api_requests !== 0 ||
    validation.generation_metadata.real_model_requests !== 0 ||
    validation.generation_metadata.secret_reads !== 0 ||
    validation.generation_metadata.repository_executions !== 0
  ) {
    throw new Error("HUMAN_COMPOSITION_VALIDATION_INTEGRITY_FAILED");
  }
}

function decisionBody(
  decision: HumanCompositionDecisionArtifact,
): Omit<HumanCompositionDecisionArtifact, "decision_fingerprint_sha256"> {
  const { decision_fingerprint_sha256: _fingerprint, ...body } = decision;
  return body;
}

function selectedCaveats(
  context: HumanStoryComposerContext,
  draft: HumanEditorialCompositionDraft,
): string[] {
  const selected = new Set(draft.selected_fact_display_ids);
  const selectedUnknowns = new Set(draft.selected_known_unknowns);
  return [
    ...new Set([
      ...context.fact_options
        .filter((option) => selected.has(option.display_id))
        .map((option) => option.boundary_note),
      ...context.known_unknowns
        .filter((unknown) => selectedUnknowns.has(unknown.unknown_ref))
        .map((unknown) => unknown.plain_language_summary),
    ]),
  ];
}

export function confirmHumanEditorialComposition(
  input: ConfirmHumanEditorialCompositionInput,
): HumanCompositionDecisionArtifact {
  if (input.explicit_confirmation !== true) {
    throw new Error("EXPLICIT_HUMAN_CONFIRMATION_REQUIRED");
  }
  assertIsoTimestamp(input.confirmed_at);
  assertHumanStoryComposerContextIntegrity(input.context);
  assertHumanCompositionValidationIntegrity(input.validation);
  if (
    input.validation.truth_status !== "PASS" ||
    input.validation.composition_status !== "HOST_VALIDATED" ||
    input.validation.selected_facts_valid !== true
  ) {
    throw new Error("HUMAN_COMPOSITION_HOST_VALIDATION_REQUIRED");
  }
  if (
    bindingReasons(input.context, input.draft).length > 0 ||
    input.draft.draft_fingerprint_sha256 !== sha256(draftBody(input.draft)) ||
    input.validation.composition_id !== input.draft.composition_id ||
    input.validation.draft_fingerprint_sha256 !== input.draft.draft_fingerprint_sha256 ||
    input.validation.composer_context_fingerprint_sha256 !== input.context.context_fingerprint_sha256 ||
    input.validation.host_semantics_version !== input.context.host_semantics_version
  ) {
    throw new Error("HUMAN_COMPOSITION_CONFIRMATION_BINDING_STALE");
  }
  const body = {
    human_composition_decision_version: HUMAN_COMPOSITION_DECISION_VERSION,
    composition_id: input.draft.composition_id,
    composition_status: "HUMAN_CONFIRMED" as const,
    source: "HUMAN_COMPOSITION" as const,
    repository: { ...input.context.repository },
    commit: input.context.commit,
    fact_ir_version: input.context.fact_ir_version,
    host_semantics_version: input.context.host_semantics_version,
    neighborhood_id: input.context.neighborhood.neighborhood_id,
    neighborhood_fingerprint_sha256:
      input.context.neighborhood.neighborhood_fingerprint_sha256,
    composer_context_fingerprint_sha256:
      input.context.context_fingerprint_sha256,
    draft_fingerprint_sha256: input.draft.draft_fingerprint_sha256,
    validation_fingerprint_sha256:
      input.validation.validation_fingerprint_sha256,
    title: input.draft.title,
    editorial_thesis: input.draft.editorial_thesis,
    why_this_story: input.draft.why_this_story,
    target_audience: [...input.draft.target_audience],
    selected_fact_display_ids: [...input.draft.selected_fact_display_ids],
    selected_canonical_fact_ids: [...input.draft.selected_canonical_fact_ids],
    selected_known_unknowns: [...input.draft.selected_known_unknowns],
    known_caveats: selectedCaveats(input.context, input.draft),
    host_validation: {
      status: "PASS" as const,
      host_semantics_version: input.validation.host_semantics_version,
      validation_fingerprint_sha256:
        input.validation.validation_fingerprint_sha256,
    },
    human_confirmed: true as const,
    confirmation_timestamp: input.confirmed_at,
    decision_context: input.decision_context,
    script_eligibility: {
      eligible: true as const,
      status: "ELIGIBLE_FOR_EXPLICIT_SCRIPT_ACTION" as const,
      explicit_script_generation_required: true as const,
    },
    generation_metadata: {
      mode: "offline_human_composition_confirmation" as const,
      paid_api_requests: 0 as const,
      real_model_requests: 0 as const,
      secret_reads: 0 as const,
      repository_executions: 0 as const,
    },
  };
  return {
    ...body,
    decision_fingerprint_sha256: sha256(body),
  };
}

export function assertHumanCompositionDecisionIntegrity(
  decision: HumanCompositionDecisionArtifact,
): void {
  if (
    decision.human_confirmed !== true ||
    decision.composition_status !== "HUMAN_CONFIRMED" ||
    decision.host_validation.status !== "PASS" ||
    decision.host_semantics_version !== HOST_ANGLE_SEMANTICS_VERSION ||
    decision.decision_fingerprint_sha256 !== sha256(decisionBody(decision))
  ) {
    throw new Error("HUMAN_COMPOSITION_DECISION_INTEGRITY_FAILED");
  }
}

function approvedStoryBody(
  story: ApprovedEditorialStory,
): Omit<ApprovedEditorialStory, "story_fingerprint_sha256"> {
  const { story_fingerprint_sha256: _fingerprint, ...body } = story;
  return body;
}

export function normalizeApprovedEditorialStoryFromHuman(
  input: NormalizeApprovedEditorialStoryFromHumanInput,
): ApprovedEditorialStory {
  assertHumanStoryComposerContextIntegrity(input.context);
  assertHumanCompositionValidationIntegrity(input.validation);
  assertHumanCompositionDecisionIntegrity(input.decision);
  if (
    input.decision.composition_id !== input.draft.composition_id ||
    input.decision.draft_fingerprint_sha256 !== input.draft.draft_fingerprint_sha256 ||
    input.decision.validation_fingerprint_sha256 !== input.validation.validation_fingerprint_sha256 ||
    input.decision.composer_context_fingerprint_sha256 !== input.context.context_fingerprint_sha256 ||
    !sameRepository(input.decision.repository, input.context.repository) ||
    input.decision.commit !== input.context.commit ||
    input.decision.fact_ir_version !== input.context.fact_ir_version
  ) {
    throw new Error("APPROVED_EDITORIAL_STORY_HUMAN_BINDING_MISMATCH");
  }
  const storyId = `story_${sha256({
    source: "HUMAN_COMPOSITION",
    composition_id: input.decision.composition_id,
    decision_fingerprint: input.decision.decision_fingerprint_sha256,
  }).slice(0, 24)}`;
  const body = {
    approved_editorial_story_version: APPROVED_EDITORIAL_STORY_VERSION,
    story_id: storyId,
    source: "HUMAN_COMPOSITION" as const,
    repository: { ...input.decision.repository },
    commit: input.decision.commit,
    fact_ir_version: input.decision.fact_ir_version,
    host_semantics_version: input.decision.host_semantics_version,
    title: input.decision.title,
    editorial_thesis: input.decision.editorial_thesis,
    why_this_story: input.decision.why_this_story,
    target_audience: [...input.decision.target_audience],
    supporting_fact_ids: [...input.decision.selected_canonical_fact_ids],
    known_caveats: [...input.decision.known_caveats],
    approval_provenance: {
      source: "HUMAN_COMPOSITION" as const,
      human_confirmed: true as const,
      approval_artifact_fingerprint_sha256:
        input.decision.decision_fingerprint_sha256,
      approved_at: input.decision.confirmation_timestamp,
      decision_context: input.decision.decision_context,
    },
    host_validation: { ...input.decision.host_validation },
    script_eligibility: {
      contract_eligible: true as const,
      execution_authorized: false as const,
      explicit_script_generation_action_required: true as const,
    },
  };
  return {
    ...body,
    story_fingerprint_sha256: sha256(body),
  };
}

export function normalizeApprovedEditorialStoryFromModel(
  input: NormalizeApprovedEditorialStoryFromModelInput,
): ApprovedEditorialStory {
  if (
    input.approval.decision !== "APPROVE" ||
    input.approval.status !== "HUMAN_APPROVED" ||
    input.approval.approved_by !== "human" ||
    input.approval.approval_timestamp === null ||
    input.approval.script_eligibility.eligible !== true ||
    input.current_host_validation.status !== "PASS" ||
    input.current_host_validation.host_semantics_version !==
      HOST_ANGLE_SEMANTICS_VERSION ||
    input.why_this_story.trim().length === 0 ||
    input.target_audience.length === 0
  ) {
    throw new Error("APPROVED_EDITORIAL_STORY_MODEL_SOURCE_NOT_CURRENT");
  }
  const approvalFingerprint = sha256(input.approval);
  const storyId = `story_${sha256({
    source: "MODEL_SUGGESTED_ANGLE",
    candidate_id: input.approval.candidate_id,
    approval_fingerprint: approvalFingerprint,
    host_validation: input.current_host_validation.validation_fingerprint_sha256,
  }).slice(0, 24)}`;
  const body = {
    approved_editorial_story_version: APPROVED_EDITORIAL_STORY_VERSION,
    story_id: storyId,
    source: "MODEL_SUGGESTED_ANGLE" as const,
    repository: { ...input.approval.repository },
    commit: input.approval.commit,
    fact_ir_version: input.approval.fact_ir_version,
    host_semantics_version: HOST_ANGLE_SEMANTICS_VERSION,
    title: input.approval.title,
    editorial_thesis: input.approval.editorial_thesis,
    why_this_story: input.why_this_story.trim(),
    target_audience: input.target_audience.map((audience) => audience.trim()),
    supporting_fact_ids: [...input.approval.supporting_fact_ids],
    known_caveats: [...input.approval.known_caveats],
    approval_provenance: {
      source: "MODEL_SUGGESTED_ANGLE" as const,
      human_confirmed: true as const,
      approval_artifact_fingerprint_sha256: approvalFingerprint,
      approved_at: input.approval.approval_timestamp,
      decision_context: input.approval.decision_context,
    },
    host_validation: { ...input.current_host_validation },
    script_eligibility: {
      contract_eligible: true as const,
      execution_authorized: false as const,
      explicit_script_generation_action_required: true as const,
    },
  };
  return {
    ...body,
    story_fingerprint_sha256: sha256(body),
  };
}

export function assertApprovedEditorialStoryIntegrity(
  story: ApprovedEditorialStory,
): void {
  if (
    story.host_validation.status !== "PASS" ||
    story.approval_provenance.human_confirmed !== true ||
    story.script_eligibility.execution_authorized !== false ||
    story.story_fingerprint_sha256 !== sha256(approvedStoryBody(story))
  ) {
    throw new Error("APPROVED_EDITORIAL_STORY_INTEGRITY_FAILED");
  }
}

export function parseHumanStoryComposerContext(
  value: unknown,
  schemas: SchemaRegistry,
): HumanStoryComposerContext {
  schemas.assert("HumanStoryComposerContext", value);
  const context = value as HumanStoryComposerContext;
  assertHumanStoryComposerContextIntegrity(context);
  return context;
}

export function parseHumanEditorialCompositionDraft(
  value: unknown,
  schemas: SchemaRegistry,
): HumanEditorialCompositionDraft {
  schemas.assert("HumanEditorialCompositionDraft", value);
  const draft = value as HumanEditorialCompositionDraft;
  assertIsoTimestamp(draft.created_at);
  return draft;
}

export function parseHumanCompositionValidation(
  value: unknown,
  schemas: SchemaRegistry,
): HumanCompositionValidation {
  schemas.assert("HumanCompositionValidation", value);
  const validation = value as HumanCompositionValidation;
  assertHumanCompositionValidationIntegrity(validation);
  return validation;
}

export function serializeHumanCompositionArtifact(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function renderHumanStoryComposerPreview(
  context: HumanStoryComposerContext,
): string {
  assertHumanStoryComposerContextIntegrity(context);
  const factOptions = context.fact_options
    .map(
      (option) =>
        `- [ ] ${option.display_id} — ${option.plain_language_summary}\n  - Boundary: ${option.boundary_note}`,
    )
    .join("\n");
  const evidence = context.fact_options
    .map(
      (option) =>
        `- ${option.display_id}\n  - Canonical Fact: \`${option.canonical_fact_id}\`\n  - Evidence: ${option.evidence_trace.evidence_ids.map((id) => `\`${id}\``).join(", ")}\n  - Source: \`${option.source_location?.path ?? "Location unavailable in bounded context"}\``,
    )
    .join("\n");
  return `# Archify Human Story Composer — Offline Preview

Repository: \`${context.minimal_project_identity.repository_full_name}\`

Technical Area: \`${context.minimal_project_identity.technical_area}\`

This workbench is a deterministic offline preview. Selecting a Fact does not approve a story or authorize Script generation.

## Choose Facts

${factOptions}

Choose at least 1 Fact. Two to six is the practical range; eight is the hard maximum.

## Verified

${context.verified_boundary.map((item) => `- ${item}`).join("\n")}

## Not Proven

${context.not_proven_boundary.map((item) => `- ${item}`).join("\n")}

## Story Fields

Title:

Core idea:

Why this story:

Audience:

## Clause Classification Preview

Host validation classifies each Title and Core idea clause as Technical Claim, Editorial Framing, Question, Outcome, Safety, Design Intent, or Unknown. Every technical clause must be supported by a selected Fact. Host PASS still requires a separate Human confirmation.

<details>
<summary>Evidence available — expand Canonical trace</summary>

${evidence}

</details>
`;
}
