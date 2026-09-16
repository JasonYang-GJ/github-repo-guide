import { createHash } from "node:crypto";

import {
  assertHumanStoryComposerContextIntegrity,
  type HumanEditorialCompositionDraft,
  type HumanStoryComposerContext,
} from "./human-story-composer.js";
import {
  assertHumanCompositionValidationV2Integrity,
  HUMAN_INPUT_HOST_SEMANTICS_VERSION,
  type HumanCompositionValidationV2,
} from "./human-input-semantics.js";
import type { SchemaRegistry } from "../schemas/registry.js";
import type {
  ScriptFactPack,
  ScriptFactReferenceMap,
} from "./grounded-script.js";
import type { ArtifactReference } from "./editorial-selection.js";

export const REAL_HUMAN_CONFIRMATION_EVENT_VERSION = 1 as const;

export interface RealHumanConfirmationEventV1 {
  readonly real_human_confirmation_event_version:
    typeof REAL_HUMAN_CONFIRMATION_EVENT_VERSION;
  readonly confirmation_source: "USER_EXPLICIT_CONFIRMATION";
  readonly confirmation_text: "CONFIRM THIS HUMAN COMPOSITION";
  readonly confirmed_at: string;
  readonly vs07_c_final_sha: string;
  readonly target: {
    readonly repository: HumanStoryComposerContext["repository"];
    readonly commit: string;
    readonly neighborhood_id: string;
    readonly title: string;
    readonly target_audience: readonly string[];
    readonly selected_fact_display_ids: readonly string[];
    readonly host_semantics_version: typeof HUMAN_INPUT_HOST_SEMANTICS_VERSION;
    readonly truth_status: "PASS";
    readonly composition_status: "HOST_VALIDATED";
    readonly unsupported_clause_count: 0;
    readonly clause_fact_trace_status: "PASS";
  };
}

export interface HumanCompositionDecisionArtifactV3 {
  readonly human_composition_decision_version: 1;
  readonly decision_id: string;
  readonly composition_id: string;
  readonly composition_status: "HUMAN_CONFIRMED";
  readonly source: "HUMAN";
  readonly repository: HumanStoryComposerContext["repository"];
  readonly commit: string;
  readonly fact_ir_version: number;
  readonly host_semantics_version: typeof HUMAN_INPUT_HOST_SEMANTICS_VERSION;
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
    readonly host_semantics_version: typeof HUMAN_INPUT_HOST_SEMANTICS_VERSION;
    readonly validation_fingerprint_sha256: string;
  };
  readonly human_confirmed: true;
  readonly confirmation_timestamp: string;
  readonly decision_context: "USER_ACTION";
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

export interface ConfirmHumanEditorialCompositionV3Input {
  readonly context: HumanStoryComposerContext;
  readonly draft: HumanEditorialCompositionDraft;
  readonly validation: HumanCompositionValidationV2;
  readonly confirmation: RealHumanConfirmationEventV1;
  readonly current_system_baseline_sha: string;
}

export interface ApprovedEditorialStoryV1FromHuman {
  readonly approved_editorial_story_version: 1;
  readonly story_id: string;
  readonly source: "HUMAN_COMPOSITION";
  readonly source_kind: "HUMAN_COMPOSITION";
  readonly status: "CURRENT";
  readonly human_decision_artifact_id: string;
  readonly host_validation_fingerprint_sha256: string;
  readonly composer_context_fingerprint_sha256: string;
  readonly composition_fingerprint_sha256: string;
  readonly repository: HumanStoryComposerContext["repository"];
  readonly commit: string;
  readonly fact_ir_version: number;
  readonly host_semantics_version: typeof HUMAN_INPUT_HOST_SEMANTICS_VERSION;
  readonly title: string;
  readonly editorial_thesis: string;
  readonly why_this_story: string;
  readonly target_audience: readonly string[];
  readonly supporting_fact_ids: readonly string[];
  readonly known_caveats: readonly string[];
  readonly approval_provenance: {
    readonly source: "HUMAN_COMPOSITION";
    readonly human_confirmed: true;
    readonly approval_artifact_fingerprint_sha256: string;
    readonly approved_at: string;
    readonly decision_context: "USER_ACTION";
  };
  readonly host_validation: {
    readonly status: "PASS";
    readonly host_semantics_version: typeof HUMAN_INPUT_HOST_SEMANTICS_VERSION;
    readonly validation_fingerprint_sha256: string;
  };
  readonly script_eligibility: {
    readonly contract_eligible: true;
    readonly execution_authorized: false;
    readonly explicit_script_generation_action_required: true;
  };
  readonly story_fingerprint_sha256: string;
}

export interface MaterializeApprovedEditorialStoryV1Input {
  readonly context: HumanStoryComposerContext;
  readonly draft: HumanEditorialCompositionDraft;
  readonly validation: HumanCompositionValidationV2;
  readonly decision: HumanCompositionDecisionArtifactV3;
}

export interface ApprovedEditorialStoryCurrentBindingV1 {
  readonly repository: HumanStoryComposerContext["repository"];
  readonly commit: string;
  readonly fact_ir_version: number;
  readonly host_semantics_version: typeof HUMAN_INPUT_HOST_SEMANTICS_VERSION;
  readonly composer_context_fingerprint_sha256: string;
  readonly composition_fingerprint_sha256: string;
  readonly validation_fingerprint_sha256: string;
  readonly selected_canonical_fact_ids: readonly string[];
}

export type ApprovedEditorialStoryStaleReasonV1 =
  | "REPOSITORY_CHANGED"
  | "REPOSITORY_COMMIT_CHANGED"
  | "FACT_IR_VERSION_CHANGED"
  | "HOST_SEMANTICS_VERSION_CHANGED"
  | "COMPOSER_CONTEXT_CHANGED"
  | "COMPOSITION_CHANGED"
  | "HOST_VALIDATION_CHANGED"
  | "SELECTED_FACTS_CHANGED"
  | "STORY_NOT_CURRENT";

export interface ApprovedEditorialStoryFreshnessV1 {
  readonly approved_editorial_story_freshness_version: 1;
  readonly story_id: string;
  readonly story_fingerprint_sha256: string;
  readonly story_status: "CURRENT" | "STALE";
  readonly script_eligibility: "ELIGIBLE" | "NOT_ELIGIBLE";
  readonly script_authorization: "NO";
  readonly reason_codes: readonly ApprovedEditorialStoryStaleReasonV1[];
}

export interface BuildApprovedStoryScriptFactPackDryRunInput {
  readonly context: HumanStoryComposerContext;
  readonly story: ApprovedEditorialStoryV1FromHuman;
  readonly freshness: ApprovedEditorialStoryFreshnessV1;
  readonly sources: {
    readonly approved_story_artifact: ArtifactReference;
    readonly fact_pack_artifact: ArtifactReference;
    readonly canonical_brief_artifact: ArtifactReference;
  };
  readonly schemas: SchemaRegistry;
}

export interface ApprovedStoryGroundedScriptCompatibilityV1 {
  readonly approved_story_grounded_script_compatibility_version: 1;
  readonly status: "PASS";
  readonly normalization_boundary:
    "ApprovedEditorialStory v1 -> ScriptFactPack v1 -> future GroundedScriptInput v1";
  readonly source_kind: "HUMAN_COMPOSITION";
  readonly fact_ir_version: 2;
  readonly core_fact_count: number;
  readonly context_fact_count: 0;
  readonly known_unknown_count: number;
  readonly grounded_script_input_compatible: true;
  readonly model_input_built: false;
  readonly script_request_built: false;
  readonly script_generated: 0;
  readonly model_selected: false;
  readonly script_authorization: "NO";
}

export interface ApprovedStoryScriptFactPackDryRunV1 {
  readonly script_fact_pack: ScriptFactPack;
  readonly reference_map: ScriptFactReferenceMap;
  readonly compatibility: ApprovedStoryGroundedScriptCompatibilityV1;
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
  right: HumanStoryComposerContext["repository"],
): boolean {
  return left.url === right.url && left.owner === right.owner && left.name === right.name;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertIsoTimestamp(value: string): void {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error("CONFIRMATION_TIMESTAMP_INVALID");
  }
}

function draftFingerprint(draft: HumanEditorialCompositionDraft): string {
  const { draft_fingerprint_sha256: _fingerprint, ...body } = draft;
  return sha256(body);
}

function selectedCaveatsV3(
  context: HumanStoryComposerContext,
  draft: HumanEditorialCompositionDraft,
): string[] {
  const selected = new Set(draft.selected_fact_display_ids);
  return [
    ...new Set([
      ...context.fact_options
        .filter((option) => selected.has(option.display_id))
        .map((option) => option.boundary_note),
      ...context.not_proven_boundary,
      ...context.known_unknowns.map((unknown) => unknown.plain_language_summary),
      "Correctness and reliability guarantees are not proven by the selected Facts.",
    ]),
  ];
}

function assertConfirmationTargetMatches(
  input: ConfirmHumanEditorialCompositionV3Input,
): void {
  const { context, draft, validation, confirmation } = input;
  const target = confirmation.target;
  const selectedResolutionMatches = validation.selected_fact_resolution.every(
    (resolution, index) =>
      resolution.display_id === draft.selected_fact_display_ids[index] &&
      resolution.canonical_fact_id === draft.selected_canonical_fact_ids[index] &&
      resolution.status === "RESOLVED",
  );
  const matches =
    confirmation.real_human_confirmation_event_version === 1 &&
    confirmation.confirmation_source === "USER_EXPLICIT_CONFIRMATION" &&
    confirmation.confirmation_text === "CONFIRM THIS HUMAN COMPOSITION" &&
    confirmation.vs07_c_final_sha === input.current_system_baseline_sha &&
    sameRepository(target.repository, context.repository) &&
    sameRepository(draft.repository, context.repository) &&
    sameRepository(validation.repository, context.repository) &&
    target.commit === context.commit &&
    draft.commit === context.commit &&
    validation.commit === context.commit &&
    target.neighborhood_id === context.neighborhood.neighborhood_id &&
    draft.neighborhood_id === context.neighborhood.neighborhood_id &&
    validation.neighborhood_id === context.neighborhood.neighborhood_id &&
    draft.fact_ir_version === context.fact_ir_version &&
    validation.fact_ir_version === context.fact_ir_version &&
    draft.neighborhood_fingerprint_sha256 ===
      context.neighborhood.neighborhood_fingerprint_sha256 &&
    validation.neighborhood_fingerprint_sha256 ===
      context.neighborhood.neighborhood_fingerprint_sha256 &&
    draft.composer_context_fingerprint_sha256 === context.context_fingerprint_sha256 &&
    validation.composer_context_fingerprint_sha256 === context.context_fingerprint_sha256 &&
    target.title === draft.title &&
    sameStrings(target.target_audience, draft.target_audience) &&
    sameStrings(target.selected_fact_display_ids, draft.selected_fact_display_ids) &&
    validation.composition_id === draft.composition_id &&
    validation.original_draft_fingerprint_sha256 === draft.draft_fingerprint_sha256 &&
    validation.replay_draft_fingerprint_sha256 === draft.draft_fingerprint_sha256 &&
    draft.draft_fingerprint_sha256 === draftFingerprint(draft) &&
    validation.semantic_input_unchanged === true &&
    selectedResolutionMatches;
  if (!matches) throw new Error("CONFIRMATION_TARGET_MISMATCH");
}

function assertConfirmationEligible(
  validation: HumanCompositionValidationV2,
  confirmation: RealHumanConfirmationEventV1,
): void {
  if (
    validation.truth_status !== "PASS" ||
    validation.composition_status !== "HOST_VALIDATED" ||
    validation.host_semantics_version !== HUMAN_INPUT_HOST_SEMANTICS_VERSION ||
    validation.selected_facts_valid !== true ||
    validation.unsupported_clauses.length !== 0 ||
    confirmation.target.host_semantics_version !== HUMAN_INPUT_HOST_SEMANTICS_VERSION ||
    confirmation.target.truth_status !== validation.truth_status ||
    confirmation.target.composition_status !== validation.composition_status ||
    confirmation.target.unsupported_clause_count !== validation.unsupported_clauses.length ||
    confirmation.target.clause_fact_trace_status !== "PASS"
  ) {
    throw new Error("CONFIRMATION_NOT_ELIGIBLE");
  }
}

function decisionBody(
  decision: HumanCompositionDecisionArtifactV3,
): Omit<HumanCompositionDecisionArtifactV3, "decision_fingerprint_sha256"> {
  const { decision_fingerprint_sha256: _fingerprint, ...body } = decision;
  return body;
}

export function confirmHumanEditorialCompositionV3(
  input: ConfirmHumanEditorialCompositionV3Input,
): HumanCompositionDecisionArtifactV3 {
  assertIsoTimestamp(input.confirmation.confirmed_at);
  assertHumanStoryComposerContextIntegrity(input.context);
  assertHumanCompositionValidationV2Integrity(input.validation);
  assertConfirmationEligible(input.validation, input.confirmation);
  assertConfirmationTargetMatches(input);

  const decisionId = `decision_${sha256({
    composition_id: input.draft.composition_id,
    draft_fingerprint: input.draft.draft_fingerprint_sha256,
    validation_fingerprint: input.validation.validation_fingerprint_sha256,
    confirmed_at: input.confirmation.confirmed_at,
    source: input.confirmation.confirmation_source,
  }).slice(0, 24)}`;
  const body = {
    human_composition_decision_version: 1 as const,
    decision_id: decisionId,
    composition_id: input.draft.composition_id,
    composition_status: "HUMAN_CONFIRMED" as const,
    source: "HUMAN" as const,
    repository: { ...input.context.repository },
    commit: input.context.commit,
    fact_ir_version: input.context.fact_ir_version,
    host_semantics_version: HUMAN_INPUT_HOST_SEMANTICS_VERSION,
    neighborhood_id: input.context.neighborhood.neighborhood_id,
    neighborhood_fingerprint_sha256:
      input.context.neighborhood.neighborhood_fingerprint_sha256,
    composer_context_fingerprint_sha256: input.context.context_fingerprint_sha256,
    draft_fingerprint_sha256: input.draft.draft_fingerprint_sha256,
    validation_fingerprint_sha256: input.validation.validation_fingerprint_sha256,
    title: input.draft.title,
    editorial_thesis: input.draft.editorial_thesis,
    why_this_story: input.draft.why_this_story,
    target_audience: [...input.draft.target_audience],
    selected_fact_display_ids: [...input.draft.selected_fact_display_ids],
    selected_canonical_fact_ids: [...input.draft.selected_canonical_fact_ids],
    selected_known_unknowns: [...input.draft.selected_known_unknowns],
    known_caveats: selectedCaveatsV3(input.context, input.draft),
    host_validation: {
      status: "PASS" as const,
      host_semantics_version: HUMAN_INPUT_HOST_SEMANTICS_VERSION,
      validation_fingerprint_sha256: input.validation.validation_fingerprint_sha256,
    },
    human_confirmed: true as const,
    confirmation_timestamp: input.confirmation.confirmed_at,
    decision_context: "USER_ACTION" as const,
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

export function assertHumanCompositionDecisionV3Integrity(
  decision: HumanCompositionDecisionArtifactV3,
): void {
  const expectedDecisionId = `decision_${sha256({
    composition_id: decision.composition_id,
    draft_fingerprint: decision.draft_fingerprint_sha256,
    validation_fingerprint: decision.validation_fingerprint_sha256,
    confirmed_at: decision.confirmation_timestamp,
    source: "USER_EXPLICIT_CONFIRMATION",
  }).slice(0, 24)}`;
  if (
    decision.decision_id !== expectedDecisionId ||
    decision.source !== "HUMAN" ||
    decision.human_confirmed !== true ||
    decision.host_semantics_version !== HUMAN_INPUT_HOST_SEMANTICS_VERSION ||
    decision.host_validation.status !== "PASS" ||
    decision.host_validation.host_semantics_version !== HUMAN_INPUT_HOST_SEMANTICS_VERSION ||
    decision.script_eligibility.eligible !== true ||
    decision.decision_fingerprint_sha256 !== sha256(decisionBody(decision))
  ) {
    throw new Error("HUMAN_COMPOSITION_DECISION_V3_INTEGRITY_FAILED");
  }
}

function storyBody(
  story: ApprovedEditorialStoryV1FromHuman,
): Omit<ApprovedEditorialStoryV1FromHuman, "story_fingerprint_sha256"> {
  const { story_fingerprint_sha256: _fingerprint, ...body } = story;
  return body;
}

export function materializeApprovedEditorialStoryV1(
  input: MaterializeApprovedEditorialStoryV1Input,
): ApprovedEditorialStoryV1FromHuman {
  assertHumanStoryComposerContextIntegrity(input.context);
  assertHumanCompositionValidationV2Integrity(input.validation);
  assertHumanCompositionDecisionV3Integrity(input.decision);
  const bound =
    input.decision.composition_id === input.draft.composition_id &&
    input.decision.draft_fingerprint_sha256 === input.draft.draft_fingerprint_sha256 &&
    input.decision.validation_fingerprint_sha256 ===
      input.validation.validation_fingerprint_sha256 &&
    input.decision.composer_context_fingerprint_sha256 ===
      input.context.context_fingerprint_sha256 &&
    sameRepository(input.decision.repository, input.context.repository) &&
    input.decision.commit === input.context.commit &&
    input.decision.fact_ir_version === input.context.fact_ir_version &&
    input.decision.host_semantics_version === input.validation.host_semantics_version &&
    input.decision.neighborhood_id === input.context.neighborhood.neighborhood_id &&
    input.decision.neighborhood_fingerprint_sha256 ===
      input.context.neighborhood.neighborhood_fingerprint_sha256 &&
    sameStrings(input.decision.selected_fact_display_ids, draftSelectedDisplayIds(input.draft)) &&
    sameStrings(input.decision.selected_canonical_fact_ids, input.draft.selected_canonical_fact_ids) &&
    input.decision.title === input.draft.title &&
    input.decision.editorial_thesis === input.draft.editorial_thesis &&
    input.decision.why_this_story === input.draft.why_this_story &&
    sameStrings(input.decision.target_audience, input.draft.target_audience);
  if (!bound) throw new Error("APPROVED_EDITORIAL_STORY_HUMAN_BINDING_MISMATCH");

  const storyId = `story_${sha256({
    source: "HUMAN_COMPOSITION",
    decision_id: input.decision.decision_id,
    decision_fingerprint: input.decision.decision_fingerprint_sha256,
  }).slice(0, 24)}`;
  const body = {
    approved_editorial_story_version: 1 as const,
    story_id: storyId,
    source: "HUMAN_COMPOSITION" as const,
    source_kind: "HUMAN_COMPOSITION" as const,
    status: "CURRENT" as const,
    human_decision_artifact_id: input.decision.decision_id,
    host_validation_fingerprint_sha256:
      input.validation.validation_fingerprint_sha256,
    composer_context_fingerprint_sha256:
      input.context.context_fingerprint_sha256,
    composition_fingerprint_sha256: input.draft.draft_fingerprint_sha256,
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
      decision_context: "USER_ACTION" as const,
    },
    host_validation: {
      status: "PASS" as const,
      host_semantics_version: HUMAN_INPUT_HOST_SEMANTICS_VERSION,
      validation_fingerprint_sha256:
        input.validation.validation_fingerprint_sha256,
    },
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

function draftSelectedDisplayIds(
  draft: HumanEditorialCompositionDraft,
): readonly string[] {
  return draft.selected_fact_display_ids;
}

export function assertApprovedEditorialStoryV1FromHumanIntegrity(
  story: ApprovedEditorialStoryV1FromHuman,
): void {
  const expectedStoryId = `story_${sha256({
    source: "HUMAN_COMPOSITION",
    decision_id: story.human_decision_artifact_id,
    decision_fingerprint:
      story.approval_provenance.approval_artifact_fingerprint_sha256,
  }).slice(0, 24)}`;
  if (
    story.story_id !== expectedStoryId ||
    story.status !== "CURRENT" ||
    story.source_kind !== "HUMAN_COMPOSITION" ||
    story.host_semantics_version !== HUMAN_INPUT_HOST_SEMANTICS_VERSION ||
    story.approval_provenance.human_confirmed !== true ||
    story.host_validation.status !== "PASS" ||
    story.script_eligibility.contract_eligible !== true ||
    story.script_eligibility.execution_authorized !== false ||
    story.story_fingerprint_sha256 !== sha256(storyBody(story))
  ) {
    throw new Error("APPROVED_EDITORIAL_STORY_V1_HUMAN_INTEGRITY_FAILED");
  }
}

export function evaluateApprovedEditorialStoryFreshnessV1(
  story: ApprovedEditorialStoryV1FromHuman,
  current: ApprovedEditorialStoryCurrentBindingV1,
): ApprovedEditorialStoryFreshnessV1 {
  assertApprovedEditorialStoryV1FromHumanIntegrity(story);
  const reasons: ApprovedEditorialStoryStaleReasonV1[] = [];
  if (!sameRepository(story.repository, current.repository)) {
    reasons.push("REPOSITORY_CHANGED");
  }
  if (story.commit !== current.commit) {
    reasons.push("REPOSITORY_COMMIT_CHANGED");
  }
  if (story.fact_ir_version !== current.fact_ir_version) {
    reasons.push("FACT_IR_VERSION_CHANGED");
  }
  if (story.host_semantics_version !== current.host_semantics_version) {
    reasons.push("HOST_SEMANTICS_VERSION_CHANGED");
  }
  if (
    story.composer_context_fingerprint_sha256 !==
    current.composer_context_fingerprint_sha256
  ) {
    reasons.push("COMPOSER_CONTEXT_CHANGED");
  }
  if (
    story.composition_fingerprint_sha256 !==
    current.composition_fingerprint_sha256
  ) {
    reasons.push("COMPOSITION_CHANGED");
  }
  if (
    story.host_validation_fingerprint_sha256 !==
    current.validation_fingerprint_sha256
  ) {
    reasons.push("HOST_VALIDATION_CHANGED");
  }
  if (!sameStrings(story.supporting_fact_ids, current.selected_canonical_fact_ids)) {
    reasons.push("SELECTED_FACTS_CHANGED");
  }
  if (story.status !== "CURRENT") reasons.push("STORY_NOT_CURRENT");
  const isCurrent = reasons.length === 0;
  return {
    approved_editorial_story_freshness_version: 1,
    story_id: story.story_id,
    story_fingerprint_sha256: story.story_fingerprint_sha256,
    story_status: isCurrent ? "CURRENT" : "STALE",
    script_eligibility: isCurrent ? "ELIGIBLE" : "NOT_ELIGIBLE",
    script_authorization: "NO",
    reason_codes: reasons,
  };
}

function evidenceNeededForKnownUnknown(unknownRef: string): string {
  if (unknownRef.includes("alias")) {
    return "Symbol-resolved call analysis covering aliases and re-exports.";
  }
  if (unknownRef.includes("dynamic") || unknownRef.includes("indirect")) {
    return "Dynamic, indirect, callback, and higher-order call-target analysis.";
  }
  if (unknownRef.includes("branch")) {
    return "Control-flow coverage plus bounded runtime evidence for every relevant branch.";
  }
  return "Additional repository Evidence bound to the same commit and Fact IR.";
}

export function buildApprovedStoryScriptFactPackDryRun(
  input: BuildApprovedStoryScriptFactPackDryRunInput,
): ApprovedStoryScriptFactPackDryRunV1 {
  assertHumanStoryComposerContextIntegrity(input.context);
  assertApprovedEditorialStoryV1FromHumanIntegrity(input.story);
  if (
    input.freshness.story_id !== input.story.story_id ||
    input.freshness.story_fingerprint_sha256 !==
      input.story.story_fingerprint_sha256 ||
    input.freshness.story_status !== "CURRENT" ||
    input.freshness.script_eligibility !== "ELIGIBLE" ||
    input.freshness.script_authorization !== "NO" ||
    !sameRepository(input.story.repository, input.context.repository) ||
    input.story.commit !== input.context.commit ||
    input.story.fact_ir_version !== input.context.fact_ir_version ||
    input.story.fact_ir_version !== 2
  ) {
    throw new Error("APPROVED_STORY_SCRIPT_FACT_PACK_NOT_ELIGIBLE");
  }

  const optionsByCanonicalId = new Map(
    input.context.fact_options.map((option) => [option.canonical_fact_id, option] as const),
  );
  const selectedOptions = input.story.supporting_fact_ids.map((factId) => {
    const option = optionsByCanonicalId.get(factId);
    if (option === undefined) {
      throw new Error(`SCRIPT_CORE_FACT_NOT_FOUND:${factId}`);
    }
    return option;
  });
  const coreFacts = selectedOptions.map((option, index) => ({
    model_fact_ref: `fact_${String(index + 1).padStart(3, "0")}`,
    fact_type:
      option.fact_kind === "DIRECT_STATIC_CALL"
        ? ("CALL_RELATION" as const)
        : ("BRANCH_BEHAVIOR" as const),
    category:
      option.fact_kind === "DIRECT_STATIC_CALL"
        ? ("RELATION" as const)
        : ("BEHAVIORAL" as const),
    subject: option.host_truth.subject,
    predicate: option.host_truth.predicate,
    object: option.host_truth.object,
    scope: option.host_truth.scope,
    limitations: [...option.host_truth.limitations],
  }));
  const referenceMap: ScriptFactReferenceMap = {
    script_fact_reference_map_version: 1,
    repository: { ...input.context.repository },
    commit: input.context.commit,
    fact_ir_version: 2,
    entries: selectedOptions.map((option, index) => ({
      model_fact_ref: `fact_${String(index + 1).padStart(3, "0")}`,
      role: "CORE_FACT" as const,
      canonical_fact_id: option.canonical_fact_id,
      evidence_ids: [...option.evidence_trace.evidence_ids],
      repository: { ...input.context.repository },
      commit: input.context.commit,
      fact_ir_version: 2,
    })),
  };
  const scriptFactPack: ScriptFactPack = {
    script_fact_pack_version: 1,
    repository: { ...input.context.repository },
    commit: input.context.commit,
    fact_ir_version: 2,
    approved_angle_ref: input.story.story_id,
    approved_angle_fingerprint_sha256: input.story.story_fingerprint_sha256,
    core_facts: coreFacts,
    context_facts: [],
    known_unknowns: input.context.known_unknowns.map((unknown) => ({
      unknown_ref: unknown.unknown_ref,
      statement: unknown.plain_language_summary,
      evidence_needed: evidenceNeededForKnownUnknown(unknown.unknown_ref),
    })),
    context_policy: {
      policy: "PACKAGE_IDENTITY_THEN_DIRECT_ENTITY_ONE_HOP",
      limit: 0,
      angle_drift_forbidden: true,
    },
    reference_contract: {
      authoritative_fact_reference: "fact_###",
      authoritative_unknown_reference: "gap_*",
      canonical_fact_ids_model_visible: false,
      alternate_fact_aliases_model_visible: false,
    },
    provenance: {
      approved_angle_artifact: { ...input.sources.approved_story_artifact },
      fact_pack_artifact: { ...input.sources.fact_pack_artifact },
      canonical_brief_artifact: { ...input.sources.canonical_brief_artifact },
    },
    generation_metadata: {
      mode: "deterministic_offline_contract",
      paid_api_requests: 0,
      real_model_requests: 0,
      secret_reads: 0,
      repository_executions: 0,
    },
  };
  input.schemas.assert("ScriptFactPack", scriptFactPack);
  return {
    script_fact_pack: scriptFactPack,
    reference_map: referenceMap,
    compatibility: {
      approved_story_grounded_script_compatibility_version: 1,
      status: "PASS",
      normalization_boundary:
        "ApprovedEditorialStory v1 -> ScriptFactPack v1 -> future GroundedScriptInput v1",
      source_kind: "HUMAN_COMPOSITION",
      fact_ir_version: 2,
      core_fact_count: coreFacts.length,
      context_fact_count: 0,
      known_unknown_count: scriptFactPack.known_unknowns.length,
      grounded_script_input_compatible: true,
      model_input_built: false,
      script_request_built: false,
      script_generated: 0,
      model_selected: false,
      script_authorization: "NO",
    },
  };
}
