import { createHash } from "node:crypto";
import { dirname } from "node:path";

import type { CanonicalGroundedBriefArtifact } from "../brief/canonical.js";
import type {
  GroundedEntity,
  GroundedFact,
  GroundedFactPack,
} from "../facts/domain.js";
import type { SchemaRegistry } from "../schemas/registry.js";
import {
  evaluateContentAngleCandidates,
  type ContentAngleCandidateV2,
  type ContentAngleEvaluationReceipt,
  type ContentAngleGateCode,
} from "./angle-contract.js";
import {
  assertHumanSelectionIntegrity,
  type ArtifactReference,
  type EditorialStrength,
  type HumanSelectableAngle,
  type HumanSelectionArtifact,
} from "./editorial-selection.js";

export const ANGLE_REFINEMENT_CONTEXT_VERSION = 1 as const;
export const MAXIMUM_RELATED_FACT_OPTIONS = 12 as const;
export const MAXIMUM_SELECTED_ADDITIONAL_FACTS = 4 as const;
export const MAXIMUM_TOTAL_REFINEMENT_FACTS = 8 as const;
export const HUMAN_REFINEMENT_SELECTION_VERSION = 1 as const;
export const REFINED_ANGLE_MODEL_INPUT_VERSION = 1 as const;
export const REFINED_ANGLE_DRAFT_VERSION = 1 as const;
export const REFINED_ANGLE_VALIDATION_VERSION = 1 as const;

export type AngleRefinementRelationReason =
  | "SHARED_ENTITY"
  | "DIRECT_RELATION"
  | "SAME_MODULE"
  | "SAME_TECHNICAL_OBJECT"
  | "RELATED_BEHAVIOR"
  | "CONFIGURATION_OR_TYPE"
  | "ONE_HOP";

export interface AngleRefinementFactView {
  readonly model_fact_ref: string;
  readonly canonical_fact_summary: string;
  readonly fact_category: GroundedFact["category"];
  readonly evidence_strength: "VERIFIED";
  readonly evidence_available: true;
  readonly known_limitations: readonly string[];
}

export interface RelatedFactOption extends AngleRefinementFactView {
  readonly related_to_base_fact_refs: readonly string[];
  readonly relation_reason: AngleRefinementRelationReason;
  readonly relation_distance: "DIRECT" | "ONE_HOP";
}

export interface AngleRefinementReferenceEntry {
  readonly model_fact_ref: string;
  readonly role: "BASE_FACT" | "RELATED_FACT_OPTION";
  readonly canonical_fact_id: string;
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: GroundedFactPack["fact_ir_version"];
  readonly evidence_ids: readonly string[];
}

export interface AngleRefinementContext {
  readonly angle_refinement_context_version: typeof ANGLE_REFINEMENT_CONTEXT_VERSION;
  readonly status: "READY" | "NO_REFINEMENT_FACT_AVAILABLE";
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: GroundedFactPack["fact_ir_version"];
  readonly base_candidate: {
    readonly base_candidate_id: string;
    readonly base_candidate_fingerprint_sha256: string;
    readonly title: string;
    readonly angle_type: HumanSelectableAngle["angle"]["angle_type"];
    readonly canonical_grounded_brief_version: CanonicalGroundedBriefArtifact["canonical_grounded_brief_version"];
    readonly editorial_thesis: string;
    readonly why_interesting: string;
    readonly target_audience: HumanSelectableAngle["angle"]["target_audience"];
    readonly editorial_strength: EditorialStrength;
    readonly editorial_scores: HumanSelectableAngle["angle"]["editorial_scores"];
    readonly known_caveats: readonly string[];
    readonly host_validation: HumanSelectableAngle["host_validation"];
  };
  readonly base_fact_refs: readonly string[];
  readonly base_facts: readonly AngleRefinementFactView[];
  readonly related_fact_options: readonly RelatedFactOption[];
  readonly known_unknowns: readonly {
    readonly unknown_ref: string;
    readonly statement: string;
    readonly evidence_needed: string;
  }[];
  readonly search_policy: {
    readonly name: "DETERMINISTIC_LOCAL_FACT_GRAPH_V1";
    readonly allowed_relations: readonly AngleRefinementRelationReason[];
    readonly embedding_search: false;
    readonly vector_search: false;
    readonly llm_search: false;
    readonly global_clustering: false;
    readonly repository_specific_ranking: false;
    readonly ordering: "STRUCTURAL_PROXIMITY_THEN_CANONICAL_FACT_ID";
  };
  readonly refinement_limits: {
    readonly maximum_related_options: number;
    readonly maximum_selected_additional_facts: number;
    readonly maximum_total_supporting_facts: 8;
  };
  readonly host_reference_map: {
    readonly angle_refinement_reference_map_version: 1;
    readonly entries: readonly AngleRefinementReferenceEntry[];
  };
  readonly provenance: {
    readonly human_selection_artifact: ArtifactReference;
    readonly fact_pack_artifact: ArtifactReference;
    readonly canonical_brief_artifact: ArtifactReference;
  };
  readonly context_fingerprint_sha256: string;
  readonly generation_metadata: {
    readonly mode: "deterministic_offline_refinement_context";
    readonly paid_api_requests: 0;
    readonly real_model_requests: 0;
    readonly secret_reads: 0;
    readonly repository_executions: 0;
  };
}

export interface BuildAngleRefinementContextInput {
  readonly selection: HumanSelectionArtifact;
  readonly factPack: GroundedFactPack;
  readonly canonical: CanonicalGroundedBriefArtifact;
  readonly base_candidate_id: string;
  readonly sources: AngleRefinementContext["provenance"];
  readonly maximum_related_options?: number;
}

export interface HumanRefinementSelection {
  readonly human_refinement_selection_version: typeof HUMAN_REFINEMENT_SELECTION_VERSION;
  readonly status: "VALID";
  readonly selection_id: string;
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: GroundedFactPack["fact_ir_version"];
  readonly base_candidate_id: string;
  readonly base_candidate_fingerprint_sha256: string;
  readonly refinement_context_fingerprint_sha256: string;
  readonly selected_additional_fact_refs: readonly string[];
  readonly selected_additional_canonical_fact_ids: readonly string[];
  readonly selected_fact_set: {
    readonly base_fact_refs: readonly string[];
    readonly selected_additional_fact_refs: readonly string[];
    readonly total_supporting_fact_refs: readonly string[];
  };
  readonly selection_timestamp: string;
  readonly human_selected: true;
  readonly decision_context: "USER_ACTION" | "OFFLINE_FIXTURE";
  readonly refined_angle_eligibility: {
    readonly eligible: true;
    readonly status: "ELIGIBLE";
    readonly reason: "CURRENT_HOST_VALIDATED_BASE_AND_VALID_HUMAN_FACT_SELECTION";
    readonly explicit_refined_angle_generation_required: true;
    readonly real_model_authorized: false;
  };
  readonly provenance: {
    readonly refinement_context_artifact: ArtifactReference;
  };
  readonly selection_fingerprint_sha256: string;
  readonly generation_metadata: {
    readonly mode: "offline_human_refinement_selection";
    readonly paid_api_requests: 0;
    readonly real_model_requests: 0;
    readonly secret_reads: 0;
    readonly repository_executions: 0;
  };
}

export interface CreateHumanRefinementSelectionInput {
  readonly context: AngleRefinementContext;
  readonly selected_additional_fact_refs: readonly string[];
  readonly selected_at: string;
  readonly decision_context: "USER_ACTION" | "OFFLINE_FIXTURE";
  readonly source: ArtifactReference;
}

export interface CurrentHumanRefinementBinding {
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: number;
  readonly base_candidate_fingerprint_sha256: string;
  readonly refinement_context_fingerprint_sha256: string;
  readonly selected_additional_canonical_fact_ids: readonly string[];
}

export type HumanRefinementStaleReason =
  | "REPOSITORY_CHANGED"
  | "COMMIT_CHANGED"
  | "FACT_IR_VERSION_CHANGED"
  | "BASE_CANDIDATE_CHANGED"
  | "REFINEMENT_CONTEXT_CHANGED"
  | "SELECTED_FACT_SET_CHANGED";

export interface HumanRefinementFreshness {
  readonly state: "CURRENT" | "STALE";
  readonly reason_codes: readonly HumanRefinementStaleReason[];
  readonly refined_angle_eligible: boolean;
}

export interface RefinedAngleModelInput {
  readonly refined_angle_model_input_version: typeof REFINED_ANGLE_MODEL_INPUT_VERSION;
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: GroundedFactPack["fact_ir_version"];
  readonly base_candidate: {
    readonly base_candidate_id: string;
    readonly base_candidate_fingerprint_sha256: string;
    readonly title: string;
    readonly angle_type: HumanSelectableAngle["angle"]["angle_type"];
    readonly editorial_thesis: string;
    readonly why_interesting: string;
    readonly target_audience: HumanSelectableAngle["angle"]["target_audience"];
    readonly known_caveats: readonly string[];
  };
  readonly approved_fact_set: {
    readonly base_facts: readonly AngleRefinementFactView[];
    readonly human_selected_additional_facts: readonly RelatedFactOption[];
    readonly required_supporting_fact_refs: readonly string[];
    readonly maximum_total_supporting_facts: 8;
  };
  readonly relevant_known_unknowns: AngleRefinementContext["known_unknowns"];
  readonly task_contract: {
    readonly task: "REFRAME_HUMAN_APPROVED_FACT_SET";
    readonly output_contract: "RefinedAngleDraft v1";
    readonly base_candidate_read_only: true;
    readonly required_facts_must_be_retained: true;
    readonly fact_discovery_forbidden: true;
    readonly full_repository_forbidden: true;
    readonly readme_forbidden: true;
    readonly historical_candidates_forbidden: true;
    readonly positive_reference_rubric_forbidden: true;
    readonly external_comparison_forbidden: true;
    readonly novelty_claim_forbidden: true;
    readonly outcome_claim_forbidden: true;
    readonly safety_claim_forbidden: true;
    readonly scope_expansion_forbidden: true;
  };
  readonly provenance: {
    readonly refinement_context_fingerprint_sha256: string;
    readonly refinement_selection_id: string;
    readonly refinement_selection_fingerprint_sha256: string;
  };
  readonly authorization: {
    readonly mode: "OFFLINE_CONTRACT_FIXTURE";
    readonly real_model_authorized: false;
  };
}

export interface BuildRefinedAngleModelInputArgs {
  readonly context: AngleRefinementContext;
  readonly selection: HumanRefinementSelection;
  readonly current_binding: CurrentHumanRefinementBinding;
}

export interface RefinedAngleDraft {
  readonly refined_angle_draft_version: typeof REFINED_ANGLE_DRAFT_VERSION;
  readonly status: "DRAFT";
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: GroundedFactPack["fact_ir_version"];
  readonly refined_candidate_id: string;
  readonly base_candidate_id: string;
  readonly base_candidate_fingerprint_sha256: string;
  readonly refinement_selection_id: string;
  readonly title: string;
  readonly editorial_thesis: string;
  readonly supporting_fact_refs: readonly string[];
  readonly why_interesting: string;
  readonly target_audience: HumanSelectableAngle["angle"]["target_audience"];
  readonly editorial_confidence?: "LOW" | "MEDIUM" | "HIGH";
}

export type RefinedAnglePreflightCode =
  | "REFINED_ANGLE_IDENTITY_MISMATCH"
  | "REFINED_ANGLE_BASE_CANDIDATE_MISMATCH"
  | "REFINED_ANGLE_SELECTION_MISMATCH"
  | "REFINED_ANGLE_MODEL_INPUT_MISMATCH"
  | "REFINED_ANGLE_UNSELECTED_FACT_REFERENCE"
  | "REFINED_ANGLE_REQUIRED_FACT_DROPPED"
  | "REFINED_ANGLE_FACT_LIMIT_EXCEEDED";

export interface RefinedAngleValidationReceipt {
  readonly refined_angle_validation_version: typeof REFINED_ANGLE_VALIDATION_VERSION;
  readonly status: "PASS" | "FAIL";
  readonly scope_lock: "PASS" | "FAIL";
  readonly truth_gate: "PASS" | "FAIL";
  readonly preflight_findings: readonly RefinedAnglePreflightCode[];
  readonly host_findings: readonly ContentAngleGateCode[];
  readonly materialized_candidate: ContentAngleCandidateV2 | null;
  readonly host_evaluation: ContentAngleEvaluationReceipt;
  readonly provenance: {
    readonly base_candidate_id: string;
    readonly base_candidate_fingerprint_sha256: string;
    readonly refinement_selection_id: string;
    readonly refinement_selection_fingerprint_sha256: string;
    readonly refinement_context_fingerprint_sha256: string;
  };
  readonly generation_metadata: {
    readonly mode: "deterministic_offline_refined_angle_validation";
    readonly paid_api_requests: 0;
    readonly real_model_requests: 0;
    readonly secret_reads: 0;
    readonly repository_executions: 0;
  };
}

export interface EvaluateRefinedAngleDraftArgs {
  readonly draft: RefinedAngleDraft;
  readonly model_input: RefinedAngleModelInput;
  readonly context: AngleRefinementContext;
  readonly selection: HumanRefinementSelection;
  readonly fact_pack: GroundedFactPack;
  readonly canonical: CanonicalGroundedBriefArtifact;
  readonly schemas: SchemaRegistry;
}

interface RelatedFactMatch {
  readonly fact: GroundedFact;
  readonly relatedBaseFactIds: readonly string[];
  readonly reason: AngleRefinementRelationReason;
  readonly distance: "DIRECT" | "ONE_HOP";
}

export interface AngleRefinementFactCoverage {
  readonly angle_refinement_fact_coverage_version: 1;
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: GroundedFactPack["fact_ir_version"];
  readonly approval_rebound: false;
  readonly base_fact_ids: readonly string[];
  readonly related_fact_options: readonly {
    readonly canonical_fact_id: string;
    readonly fact_type: GroundedFact["fact_type"];
    readonly category: GroundedFact["category"];
    readonly predicate: GroundedFact["predicate"];
    readonly subject_ref: string;
    readonly object_ref: string;
    readonly canonical_fact_summary: string;
    readonly related_to_base_fact_ids: readonly string[];
    readonly relation_reason: AngleRefinementRelationReason;
    readonly relation_distance: "DIRECT" | "ONE_HOP";
    readonly evidence_ids: readonly string[];
    readonly limitations: readonly string[];
  }[];
}

export interface BuildAngleRefinementFactCoverageInput {
  readonly factPack: GroundedFactPack;
  readonly base_fact_ids: readonly string[];
  readonly maximum_related_options?: number;
}

const RELATION_PRIORITY: Readonly<Record<AngleRefinementRelationReason, number>> = {
  RELATED_BEHAVIOR: 0,
  DIRECT_RELATION: 1,
  CONFIGURATION_OR_TYPE: 2,
  SHARED_ENTITY: 3,
  SAME_TECHNICAL_OBJECT: 4,
  SAME_MODULE: 5,
  ONE_HOP: 6,
};

const ALLOWED_RELATIONS = [
  "SHARED_ENTITY",
  "DIRECT_RELATION",
  "SAME_MODULE",
  "SAME_TECHNICAL_OBJECT",
  "RELATED_BEHAVIOR",
  "CONFIGURATION_OR_TYPE",
  "ONE_HOP",
] as const;

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
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
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

function factEntities(fact: GroundedFact): readonly string[] {
  return [fact.subject_ref, fact.object_ref];
}

function entityPaths(
  fact: GroundedFact,
  entities: ReadonlyMap<string, GroundedEntity>,
): readonly string[] {
  return factEntities(fact)
    .map((entityId) => entities.get(entityId)?.source_path)
    .filter((value): value is string => value !== undefined);
}

function summaryFor(
  fact: GroundedFact,
  entities: ReadonlyMap<string, GroundedEntity>,
): string {
  const subject = entities.get(fact.subject_ref)?.display_label;
  const object = entities.get(fact.object_ref)?.display_label;
  if (subject === undefined || object === undefined) {
    throw new Error(`ANGLE_REFINEMENT_FACT_ENTITY_NOT_FOUND:${fact.id}`);
  }
  return `${subject} ${fact.predicate} ${object} [${fact.scope}]`;
}

function refinementBoundaryTokens(value: string): ReadonlySet<string> {
  const aliases: Readonly<Record<string, string>> = {
    calls: "call",
    called: "call",
    calling: "call",
    invocation: "call",
    invocations: "call",
    invokes: "call",
    invoked: "call",
    mutates: "mutation",
    mutated: "mutation",
    immutability: "mutation",
    benchmarks: "performance",
    performant: "performance",
    secure: "safety",
    security: "safety",
    safe: "safety",
    guarantees: "guarantee",
    guaranteed: "guarantee",
    comparisons: "comparison",
    compared: "comparison",
    novel: "novelty",
    aliases: "alias",
    imports: "import",
    branches: "branch",
  };
  const highSignal = new Set([
    "call",
    "mutation",
    "performance",
    "safety",
    "guarantee",
    "comparison",
    "novelty",
    "alias",
    "import",
    "branch",
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

function relevantKnownUnknownProjection<
  T extends { readonly unknown_ref: string; readonly statement: string; readonly evidence_needed: string },
>(unknowns: readonly T[], truthCorpus: readonly string[]): T[] {
  const truthTokens = refinementBoundaryTokens(truthCorpus.join(" "));
  return unknowns.filter((unknown) => {
    const unknownTokens = refinementBoundaryTokens(
      [unknown.unknown_ref, unknown.statement, unknown.evidence_needed].join(" "),
    );
    return [...unknownTokens].some((token) => truthTokens.has(token));
  });
}

function directReason(
  fact: GroundedFact,
  baseFacts: readonly GroundedFact[],
  entities: ReadonlyMap<string, GroundedEntity>,
): { reason: AngleRefinementRelationReason; baseFactIds: string[] } | null {
  const factEntitySet = new Set(factEntities(fact));
  const sharedEntity = baseFacts.filter((baseFact) =>
    factEntities(baseFact).some((entityId) => factEntitySet.has(entityId)),
  );
  if (sharedEntity.length > 0) {
    const reason: AngleRefinementRelationReason =
      fact.category === "BEHAVIORAL"
        ? "RELATED_BEHAVIOR"
        : fact.category === "CONFIGURATION" || fact.category === "TYPE"
          ? "CONFIGURATION_OR_TYPE"
          : fact.category === "RELATION" || fact.fact_type === "IMPORT_RELATION"
            ? "DIRECT_RELATION"
            : "SHARED_ENTITY";
    return {
      reason,
      baseFactIds: sharedEntity.map((baseFact) => baseFact.id),
    };
  }
  const paths = entityPaths(fact, entities);
  const sameModule = baseFacts.filter((baseFact) => {
    const basePaths = entityPaths(baseFact, entities);
    return paths.some((path) => basePaths.includes(path));
  });
  if (sameModule.length > 0) {
    return {
      reason: "SAME_MODULE",
      baseFactIds: sameModule.map((baseFact) => baseFact.id),
    };
  }
  const sameFamily = baseFacts.filter((baseFact) => {
    const basePaths = entityPaths(baseFact, entities);
    return paths.some((path) =>
      basePaths.some((basePath) => dirname(path) === dirname(basePath)),
    );
  });
  if (sameFamily.length > 0) {
    return {
      reason: "SAME_MODULE",
      baseFactIds: sameFamily.map((baseFact) => baseFact.id),
    };
  }
  const objectLabel = entities.get(fact.object_ref)?.display_label;
  const sameObject = baseFacts.filter(
    (baseFact) =>
      objectLabel !== undefined &&
      entities.get(baseFact.object_ref)?.display_label === objectLabel,
  );
  return sameObject.length > 0
    ? {
        reason: "SAME_TECHNICAL_OBJECT",
        baseFactIds: sameObject.map((baseFact) => baseFact.id),
      }
    : null;
}

function isCanonicalFact(
  fact: GroundedFact,
  pack: GroundedFactPack,
  evidenceIds: ReadonlySet<string>,
): boolean {
  return (
    fact.verification.status === "verified" &&
    fact.verification.confidence === 1 &&
    fact.provenance.repository.url === pack.repository.url &&
    fact.provenance.repository.commit_sha === pack.commit &&
    fact.evidence_ids.length > 0 &&
    fact.evidence_ids.every((evidenceId) => evidenceIds.has(evidenceId))
  );
}

function findRelatedFacts(
  pack: GroundedFactPack,
  baseFacts: readonly GroundedFact[],
  maximum: number,
): RelatedFactMatch[] {
  const baseIds = new Set(baseFacts.map((fact) => fact.id));
  const entities = new Map(pack.entities.map((entity) => [entity.id, entity]));
  const evidenceIds = new Set(
    pack.evidence_refs
      .filter((evidence) => evidence.verification_status === "verified")
      .map((evidence) => evidence.id),
  );
  const available = pack.facts.filter(
    (fact) => !baseIds.has(fact.id) && isCanonicalFact(fact, pack, evidenceIds),
  );
  const direct = available.flatMap((fact): RelatedFactMatch[] => {
    const match = directReason(fact, baseFacts, entities);
    return match === null
      ? []
      : [
          {
            fact,
            relatedBaseFactIds: match.baseFactIds,
            reason: match.reason,
            distance: "DIRECT",
          },
        ];
  });
  const directIds = new Set(direct.map((match) => match.fact.id));
  const firstHopEntities = new Set(
    direct.flatMap((match) => factEntities(match.fact)),
  );
  const baseByFirstHopEntity = new Map<string, Set<string>>();
  for (const match of direct) {
    for (const entity of factEntities(match.fact)) {
      const references = baseByFirstHopEntity.get(entity) ?? new Set<string>();
      match.relatedBaseFactIds.forEach((factId) => references.add(factId));
      baseByFirstHopEntity.set(entity, references);
    }
  }
  const oneHop = available.flatMap((fact): RelatedFactMatch[] => {
    if (directIds.has(fact.id)) return [];
    const shared = factEntities(fact).filter((entity) =>
      firstHopEntities.has(entity),
    );
    if (shared.length === 0) return [];
    const baseFactIds = new Set<string>();
    shared.forEach((entity) =>
      baseByFirstHopEntity
        .get(entity)
        ?.forEach((factId) => baseFactIds.add(factId)),
    );
    return [
      {
        fact,
        relatedBaseFactIds: [...baseFactIds].sort(compareText),
        reason: "ONE_HOP",
        distance: "ONE_HOP",
      },
    ];
  });
  return [...direct, ...oneHop]
    .sort(
      (left, right) =>
        RELATION_PRIORITY[left.reason] - RELATION_PRIORITY[right.reason] ||
        compareText(left.fact.id, right.fact.id),
    )
    .slice(0, maximum);
}

export function buildAngleRefinementFactCoverage(
  input: BuildAngleRefinementFactCoverageInput,
): AngleRefinementFactCoverage {
  const maximum = input.maximum_related_options ?? MAXIMUM_RELATED_FACT_OPTIONS;
  if (!Number.isInteger(maximum) || maximum < 0 || maximum > MAXIMUM_RELATED_FACT_OPTIONS) {
    throw new Error("ANGLE_REFINEMENT_RELATED_OPTION_LIMIT_INVALID");
  }
  if (input.base_fact_ids.length === 0) {
    throw new Error("ANGLE_REFINEMENT_BASE_FACTS_REQUIRED");
  }
  const factById = new Map(input.factPack.facts.map((fact) => [fact.id, fact]));
  const evidenceIds = new Set(
    input.factPack.evidence_refs
      .filter((evidence) => evidence.verification_status === "verified")
      .map((evidence) => evidence.id),
  );
  const baseFacts = [...new Set(input.base_fact_ids)].sort(compareText).map((factId) => {
    const fact = factById.get(factId);
    if (fact === undefined || !isCanonicalFact(fact, input.factPack, evidenceIds)) {
      throw new Error(`ANGLE_REFINEMENT_BASE_FACT_NOT_FOUND:${factId}`);
    }
    return fact;
  });
  const entities = new Map(input.factPack.entities.map((entity) => [entity.id, entity]));
  const matches = findRelatedFacts(input.factPack, baseFacts, maximum);
  return {
    angle_refinement_fact_coverage_version: 1,
    repository: { ...input.factPack.repository },
    commit: input.factPack.commit,
    fact_ir_version: input.factPack.fact_ir_version,
    approval_rebound: false,
    base_fact_ids: baseFacts.map((fact) => fact.id),
    related_fact_options: matches.map((match) => ({
      canonical_fact_id: match.fact.id,
      fact_type: match.fact.fact_type,
      category: match.fact.category,
      predicate: match.fact.predicate,
      subject_ref: match.fact.subject_ref,
      object_ref: match.fact.object_ref,
      canonical_fact_summary: summaryFor(match.fact, entities),
      related_to_base_fact_ids: [...match.relatedBaseFactIds],
      relation_reason: match.reason,
      relation_distance: match.distance,
      evidence_ids: [...match.fact.evidence_ids],
      limitations: [...match.fact.limitations],
    })),
  };
}

function assertTruthContext(
  selection: HumanSelectionArtifact,
  pack: GroundedFactPack,
  canonical: CanonicalGroundedBriefArtifact,
): void {
  if (
    !sameRepository(selection.repository, pack.repository) ||
    !sameRepository(selection.repository, canonical.repository) ||
    selection.commit !== pack.commit ||
    selection.commit !== canonical.commit ||
    selection.fact_ir_version !== pack.fact_ir_version ||
    selection.fact_ir_version !== canonical.fact_ir_version
  ) {
    throw new Error("ANGLE_REFINEMENT_TRUTH_CONTEXT_MISMATCH");
  }
}

function baseCandidate(
  selection: HumanSelectionArtifact,
  candidateId: string,
): HumanSelectableAngle {
  const candidate = selection.candidates.find(
    (item) => item.angle.id === candidateId,
  );
  if (
    candidate === undefined ||
    candidate.host_validation.status !== "PASS" ||
    !candidate.host_validation.decision_codes.includes(
      "ALL_HARD_GATES_PASSED",
    )
  ) {
    throw new Error("REFINEMENT_BASE_CANDIDATE_NOT_HOST_VALIDATED");
  }
  return candidate;
}

export function buildAngleRefinementContext(
  input: BuildAngleRefinementContextInput,
): AngleRefinementContext {
  assertHumanSelectionIntegrity(input.selection);
  assertTruthContext(input.selection, input.factPack, input.canonical);
  const candidate = baseCandidate(input.selection, input.base_candidate_id);
  const maximum = input.maximum_related_options ?? MAXIMUM_RELATED_FACT_OPTIONS;
  if (!Number.isInteger(maximum) || maximum < 0 || maximum > 12) {
    throw new Error("ANGLE_REFINEMENT_RELATED_OPTION_LIMIT_INVALID");
  }
  const factById = new Map(input.factPack.facts.map((fact) => [fact.id, fact]));
  const entities = new Map(
    input.factPack.entities.map((entity) => [entity.id, entity]),
  );
  const baseFacts = candidate.supporting_fact_ids.map((factId) => {
    const fact = factById.get(factId);
    if (fact === undefined) {
      throw new Error(`ANGLE_REFINEMENT_BASE_FACT_NOT_FOUND:${factId}`);
    }
    return fact;
  });
  if (baseFacts.length > MAXIMUM_TOTAL_REFINEMENT_FACTS) {
    throw new Error("ANGLE_REFINEMENT_BASE_FACT_LIMIT_EXCEEDED");
  }
  const matches = findRelatedFacts(input.factPack, baseFacts, maximum);
  const baseViews = baseFacts.map((fact, index): AngleRefinementFactView => ({
    model_fact_ref: modelFactRef(index),
    canonical_fact_summary: summaryFor(fact, entities),
    fact_category: fact.category,
    evidence_strength: "VERIFIED",
    evidence_available: true,
    known_limitations: [...fact.limitations],
  }));
  const options = matches.map((match, index): RelatedFactOption => ({
    model_fact_ref: modelFactRef(baseFacts.length + index),
    canonical_fact_summary: summaryFor(match.fact, entities),
    fact_category: match.fact.category,
    related_to_base_fact_refs: match.relatedBaseFactIds.map((factId) =>
      modelFactRef(baseFacts.findIndex((fact) => fact.id === factId)),
    ),
    relation_reason: match.reason,
    relation_distance: match.distance,
    evidence_strength: "VERIFIED",
    evidence_available: true,
    known_limitations: [...match.fact.limitations],
  }));
  const entries: AngleRefinementReferenceEntry[] = [
    ...baseFacts.map((fact, index) => ({
      model_fact_ref: modelFactRef(index),
      role: "BASE_FACT" as const,
      canonical_fact_id: fact.id,
      repository: { ...input.factPack.repository },
      commit: input.factPack.commit,
      fact_ir_version: input.factPack.fact_ir_version,
      evidence_ids: [...fact.evidence_ids],
    })),
    ...matches.map((match, index) => ({
      model_fact_ref: modelFactRef(baseFacts.length + index),
      role: "RELATED_FACT_OPTION" as const,
      canonical_fact_id: match.fact.id,
      repository: { ...input.factPack.repository },
      commit: input.factPack.commit,
      fact_ir_version: input.factPack.fact_ir_version,
      evidence_ids: [...match.fact.evidence_ids],
    })),
  ];
  const selectedLimit = Math.min(
    MAXIMUM_SELECTED_ADDITIONAL_FACTS,
    Math.max(0, MAXIMUM_TOTAL_REFINEMENT_FACTS - baseFacts.length),
  );
  const canonicalUnknowns = input.canonical.known_unknowns.map((unknown) => ({
    unknown_ref: unknown.id,
    statement: unknown.statement,
    evidence_needed: unknown.evidence_needed,
  }));
  const relevantUnknowns = relevantKnownUnknownProjection(canonicalUnknowns, [
    candidate.angle.title,
    candidate.angle.editorial_thesis,
    candidate.angle.why_interesting,
    ...candidate.known_caveats,
    ...baseViews.flatMap((fact) => [
      fact.canonical_fact_summary,
      ...fact.known_limitations,
    ]),
    ...options.flatMap((option) => [
      option.canonical_fact_summary,
      ...option.known_limitations,
    ]),
  ]);
  const body = {
    angle_refinement_context_version: ANGLE_REFINEMENT_CONTEXT_VERSION,
    status:
      options.length > 0
        ? ("READY" as const)
        : ("NO_REFINEMENT_FACT_AVAILABLE" as const),
    repository: { ...input.factPack.repository },
    commit: input.factPack.commit,
    fact_ir_version: input.factPack.fact_ir_version,
    base_candidate: {
      base_candidate_id: candidate.angle.id,
      base_candidate_fingerprint_sha256:
        candidate.candidate_fingerprint_sha256,
      title: candidate.angle.title,
      angle_type: candidate.angle.angle_type,
      canonical_grounded_brief_version:
        candidate.angle.canonical_grounded_brief_version,
      editorial_thesis: candidate.angle.editorial_thesis,
      why_interesting: candidate.angle.why_interesting,
      target_audience: [...candidate.angle.target_audience],
      editorial_strength: candidate.editorial_signal.strength,
      editorial_scores: { ...candidate.angle.editorial_scores },
      known_caveats: [...candidate.known_caveats],
      host_validation: {
        status: "PASS" as const,
        decision_codes: ["ALL_HARD_GATES_PASSED"] as const,
      },
    },
    base_fact_refs: baseViews.map((fact) => fact.model_fact_ref),
    base_facts: baseViews,
    related_fact_options: options,
    known_unknowns: relevantUnknowns,
    search_policy: {
      name: "DETERMINISTIC_LOCAL_FACT_GRAPH_V1" as const,
      allowed_relations: [...ALLOWED_RELATIONS],
      embedding_search: false as const,
      vector_search: false as const,
      llm_search: false as const,
      global_clustering: false as const,
      repository_specific_ranking: false as const,
      ordering: "STRUCTURAL_PROXIMITY_THEN_CANONICAL_FACT_ID" as const,
    },
    refinement_limits: {
      maximum_related_options: maximum,
      maximum_selected_additional_facts: selectedLimit,
      maximum_total_supporting_facts: MAXIMUM_TOTAL_REFINEMENT_FACTS,
    },
    host_reference_map: {
      angle_refinement_reference_map_version: 1 as const,
      entries,
    },
    provenance: { ...input.sources },
    generation_metadata: {
      mode: "deterministic_offline_refinement_context" as const,
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

export function assertAngleRefinementContextIntegrity(
  context: AngleRefinementContext,
): void {
  const entries = context.host_reference_map.entries;
  const refs = entries.map((entry) => entry.model_fact_ref);
  const canonicalIds = entries.map((entry) => entry.canonical_fact_id);
  const baseEntries = entries.filter((entry) => entry.role === "BASE_FACT");
  const optionEntries = entries.filter(
    (entry) => entry.role === "RELATED_FACT_OPTION",
  );
  const expectedRefs = entries.map((_, index) => modelFactRef(index));
  const expectedSelectionLimit = Math.min(
    MAXIMUM_SELECTED_ADDITIONAL_FACTS,
    Math.max(
      0,
      context.refinement_limits.maximum_total_supporting_facts -
        context.base_fact_refs.length,
    ),
  );
  if (
    entries.some(
      (entry) =>
        !sameRepository(entry.repository, context.repository) ||
        entry.commit !== context.commit ||
        entry.fact_ir_version !== context.fact_ir_version,
    )
  ) {
    throw new Error("ANGLE_REFINEMENT_CROSS_COMMIT_FACT");
  }
  if (
    new Set(refs).size !== refs.length ||
    new Set(canonicalIds).size !== canonicalIds.length ||
    refs.join("\0") !== expectedRefs.join("\0") ||
    context.base_fact_refs.length > MAXIMUM_TOTAL_REFINEMENT_FACTS ||
    context.related_fact_options.length >
      context.refinement_limits.maximum_related_options ||
    context.refinement_limits.maximum_selected_additional_facts !==
      expectedSelectionLimit ||
    entries.some(
      (entry) =>
        !/^fact_\d{3}$/.test(entry.model_fact_ref) ||
        entry.evidence_ids.length === 0,
    ) ||
    baseEntries.map((entry) => entry.model_fact_ref).join("\0") !==
      context.base_fact_refs.join("\0") ||
    context.base_facts.map((fact) => fact.model_fact_ref).join("\0") !==
      context.base_fact_refs.join("\0") ||
    optionEntries.map((entry) => entry.model_fact_ref).join("\0") !==
      context.related_fact_options
        .map((option) => option.model_fact_ref)
        .join("\0") ||
    context.related_fact_options.some((option) =>
      option.related_to_base_fact_refs.some(
        (reference) => !context.base_fact_refs.includes(reference),
      ),
    )
  ) {
    throw new Error("ANGLE_REFINEMENT_REFERENCE_MAP_INVALID");
  }
  if (
    (context.related_fact_options.length === 0) !==
    (context.status === "NO_REFINEMENT_FACT_AVAILABLE")
  ) {
    throw new Error("ANGLE_REFINEMENT_STATUS_INVALID");
  }
  const { context_fingerprint_sha256: fingerprint, ...body } = context;
  if (sha256(body) !== fingerprint) {
    throw new Error("ANGLE_REFINEMENT_CONTEXT_FINGERPRINT_MISMATCH");
  }
}

export function createHumanRefinementSelection(
  input: CreateHumanRefinementSelectionInput,
): HumanRefinementSelection {
  assertAngleRefinementContextIntegrity(input.context);
  const selected = [...input.selected_additional_fact_refs];
  if (
    selected.length === 0 ||
    new Set(selected).size !== selected.length ||
    selected.length >
      input.context.refinement_limits.maximum_selected_additional_facts
  ) {
    throw new Error("ANGLE_REFINEMENT_SELECTION_LIMIT_EXCEEDED");
  }
  const optionEntries = new Map(
    input.context.host_reference_map.entries
      .filter((entry) => entry.role === "RELATED_FACT_OPTION")
      .map((entry) => [entry.model_fact_ref, entry]),
  );
  const selectedEntries = selected.map((reference) => {
    const entry = optionEntries.get(reference);
    if (entry === undefined) {
      throw new Error(`ANGLE_REFINEMENT_UNKNOWN_FACT_REFERENCE:${reference}`);
    }
    return entry;
  });
  if (
    input.context.base_fact_refs.length + selected.length >
    input.context.refinement_limits.maximum_total_supporting_facts
  ) {
    throw new Error("ANGLE_REFINEMENT_TOTAL_FACT_LIMIT_EXCEEDED");
  }
  const timestamp = new Date(input.selected_at);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error("ANGLE_REFINEMENT_SELECTION_TIMESTAMP_INVALID");
  }
  const body = {
    human_refinement_selection_version: HUMAN_REFINEMENT_SELECTION_VERSION,
    status: "VALID" as const,
    repository: { ...input.context.repository },
    commit: input.context.commit,
    fact_ir_version: input.context.fact_ir_version,
    base_candidate_id: input.context.base_candidate.base_candidate_id,
    base_candidate_fingerprint_sha256:
      input.context.base_candidate.base_candidate_fingerprint_sha256,
    refinement_context_fingerprint_sha256:
      input.context.context_fingerprint_sha256,
    selected_additional_fact_refs: selected,
    selected_additional_canonical_fact_ids: selectedEntries.map(
      (entry) => entry.canonical_fact_id,
    ),
    selected_fact_set: {
      base_fact_refs: [...input.context.base_fact_refs],
      selected_additional_fact_refs: selected,
      total_supporting_fact_refs: [
        ...input.context.base_fact_refs,
        ...selected,
      ],
    },
    selection_timestamp: timestamp.toISOString(),
    human_selected: true as const,
    decision_context: input.decision_context,
    refined_angle_eligibility: {
      eligible: true as const,
      status: "ELIGIBLE" as const,
      reason:
        "CURRENT_HOST_VALIDATED_BASE_AND_VALID_HUMAN_FACT_SELECTION" as const,
      explicit_refined_angle_generation_required: true as const,
      real_model_authorized: false as const,
    },
    provenance: {
      refinement_context_artifact: { ...input.source },
    },
    generation_metadata: {
      mode: "offline_human_refinement_selection" as const,
      paid_api_requests: 0 as const,
      real_model_requests: 0 as const,
      secret_reads: 0 as const,
      repository_executions: 0 as const,
    },
  };
  const selectionFingerprint = sha256(body);
  return {
    ...body,
    selection_id: `refinement-selection-${selectionFingerprint.slice(0, 16)}`,
    selection_fingerprint_sha256: selectionFingerprint,
  };
}

export function assertHumanRefinementSelectionIntegrity(
  selection: HumanRefinementSelection,
): void {
  if (
    selection.selected_additional_fact_refs.length === 0 ||
    new Set(selection.selected_additional_fact_refs).size !==
      selection.selected_additional_fact_refs.length ||
    selection.selected_additional_fact_refs.length !==
      selection.selected_additional_canonical_fact_ids.length ||
    selection.selected_additional_fact_refs.length >
      MAXIMUM_SELECTED_ADDITIONAL_FACTS ||
    selection.selected_fact_set.total_supporting_fact_refs.length >
      MAXIMUM_TOTAL_REFINEMENT_FACTS ||
    selection.selected_additional_fact_refs.some(
      (reference) => !/^fact_\d{3}$/.test(reference),
    ) ||
    selection.selected_additional_canonical_fact_ids.some(
      (factId) => factId.length === 0,
    ) ||
    selection.selected_fact_set.total_supporting_fact_refs.join("\0") !==
      [
        ...selection.selected_fact_set.base_fact_refs,
        ...selection.selected_fact_set.selected_additional_fact_refs,
      ].join("\0") ||
    selection.selected_fact_set.selected_additional_fact_refs.join("\0") !==
      selection.selected_additional_fact_refs.join("\0") ||
    selection.refined_angle_eligibility.real_model_authorized !== false ||
    selection.refined_angle_eligibility.explicit_refined_angle_generation_required !==
      true ||
    Number.isNaN(new Date(selection.selection_timestamp).getTime()) ||
    selection.generation_metadata.mode !==
      "offline_human_refinement_selection" ||
    Object.values(selection.generation_metadata).some((value) =>
      typeof value === "number" ? value !== 0 : false,
    )
  ) {
    throw new Error("HUMAN_REFINEMENT_SELECTION_INVALID");
  }
  const {
    selection_id: selectionId,
    selection_fingerprint_sha256: fingerprint,
    ...body
  } = selection;
  const calculated = sha256(body);
  if (
    calculated !== fingerprint ||
    selectionId !== `refinement-selection-${calculated.slice(0, 16)}`
  ) {
    throw new Error("HUMAN_REFINEMENT_SELECTION_FINGERPRINT_MISMATCH");
  }
}

function assertHumanRefinementSelectionAgainstContext(
  context: AngleRefinementContext,
  selection: HumanRefinementSelection,
): void {
  const optionEntries = new Map(
    context.host_reference_map.entries
      .filter((entry) => entry.role === "RELATED_FACT_OPTION")
      .map((entry) => [entry.model_fact_ref, entry]),
  );
  const selectedCanonicalIds = selection.selected_additional_fact_refs.map(
    (reference) => optionEntries.get(reference)?.canonical_fact_id,
  );
  if (
    !sameRepository(context.repository, selection.repository) ||
    context.commit !== selection.commit ||
    context.fact_ir_version !== selection.fact_ir_version ||
    context.base_candidate.base_candidate_id !== selection.base_candidate_id ||
    context.base_candidate.base_candidate_fingerprint_sha256 !==
      selection.base_candidate_fingerprint_sha256 ||
    context.context_fingerprint_sha256 !==
      selection.refinement_context_fingerprint_sha256 ||
    context.base_fact_refs.join("\0") !==
      selection.selected_fact_set.base_fact_refs.join("\0") ||
    selectedCanonicalIds.some((factId) => factId === undefined) ||
    selectedCanonicalIds.join("\0") !==
      selection.selected_additional_canonical_fact_ids.join("\0")
  ) {
    throw new Error("HUMAN_REFINEMENT_SELECTION_CONTEXT_MISMATCH");
  }
}

export function buildRefinedAngleModelInput(
  args: BuildRefinedAngleModelInputArgs,
): RefinedAngleModelInput {
  assertAngleRefinementContextIntegrity(args.context);
  assertHumanRefinementSelectionIntegrity(args.selection);
  assertHumanRefinementSelectionAgainstContext(args.context, args.selection);
  const freshness = evaluateHumanRefinementSelectionFreshness(
    args.selection,
    args.current_binding,
  );
  if (
    freshness.state !== "CURRENT" ||
    !freshness.refined_angle_eligible ||
    !sameRepository(args.context.repository, args.selection.repository) ||
    args.context.commit !== args.selection.commit ||
    args.context.fact_ir_version !== args.selection.fact_ir_version ||
    args.context.base_candidate.base_candidate_id !==
      args.selection.base_candidate_id ||
    args.context.base_candidate.base_candidate_fingerprint_sha256 !==
      args.selection.base_candidate_fingerprint_sha256 ||
    args.context.context_fingerprint_sha256 !==
      args.selection.refinement_context_fingerprint_sha256
  ) {
    throw new Error("ANGLE_REFINEMENT_NOT_ELIGIBLE");
  }
  const selectedSet = new Set(args.selection.selected_additional_fact_refs);
  const selectedOptions = args.context.related_fact_options.filter((option) =>
    selectedSet.has(option.model_fact_ref),
  );
  if (selectedOptions.length !== selectedSet.size) {
    throw new Error("ANGLE_REFINEMENT_NOT_ELIGIBLE");
  }
  return {
    refined_angle_model_input_version: REFINED_ANGLE_MODEL_INPUT_VERSION,
    repository: { ...args.context.repository },
    commit: args.context.commit,
    fact_ir_version: args.context.fact_ir_version,
    base_candidate: {
      base_candidate_id: args.context.base_candidate.base_candidate_id,
      base_candidate_fingerprint_sha256:
        args.context.base_candidate.base_candidate_fingerprint_sha256,
      title: args.context.base_candidate.title,
      angle_type: args.context.base_candidate.angle_type,
      editorial_thesis: args.context.base_candidate.editorial_thesis,
      why_interesting: args.context.base_candidate.why_interesting,
      target_audience: [...args.context.base_candidate.target_audience],
      known_caveats: [...args.context.base_candidate.known_caveats],
    },
    approved_fact_set: {
      base_facts: args.context.base_facts.map((fact) => ({ ...fact })),
      human_selected_additional_facts: selectedOptions.map((option) => ({
        ...option,
      })),
      required_supporting_fact_refs: [
        ...args.context.base_fact_refs,
        ...args.selection.selected_additional_fact_refs,
      ],
      maximum_total_supporting_facts: MAXIMUM_TOTAL_REFINEMENT_FACTS,
    },
    relevant_known_unknowns: relevantKnownUnknownProjection(
      args.context.known_unknowns,
      [
        args.context.base_candidate.title,
        args.context.base_candidate.editorial_thesis,
        args.context.base_candidate.why_interesting,
        ...args.context.base_candidate.known_caveats,
        ...args.context.base_facts.flatMap((fact) => [
          fact.canonical_fact_summary,
          ...fact.known_limitations,
        ]),
        ...selectedOptions.flatMap((option) => [
          option.canonical_fact_summary,
          ...option.known_limitations,
        ]),
      ],
    ).map((unknown) => ({ ...unknown })),
    task_contract: {
      task: "REFRAME_HUMAN_APPROVED_FACT_SET",
      output_contract: "RefinedAngleDraft v1",
      base_candidate_read_only: true,
      required_facts_must_be_retained: true,
      fact_discovery_forbidden: true,
      full_repository_forbidden: true,
      readme_forbidden: true,
      historical_candidates_forbidden: true,
      positive_reference_rubric_forbidden: true,
      external_comparison_forbidden: true,
      novelty_claim_forbidden: true,
      outcome_claim_forbidden: true,
      safety_claim_forbidden: true,
      scope_expansion_forbidden: true,
    },
    provenance: {
      refinement_context_fingerprint_sha256:
        args.context.context_fingerprint_sha256,
      refinement_selection_id: args.selection.selection_id,
      refinement_selection_fingerprint_sha256:
        args.selection.selection_fingerprint_sha256,
    },
    authorization: {
      mode: "OFFLINE_CONTRACT_FIXTURE",
      real_model_authorized: false,
    },
  };
}

function emptyHostEvaluation(
  pack: GroundedFactPack,
  canonical: CanonicalGroundedBriefArtifact,
): ContentAngleEvaluationReceipt {
  return {
    content_angle_evaluation_version: 1,
    status: "NO_STRONG_CONTENT_ANGLE",
    repository: { ...pack.repository },
    commit: pack.commit,
    fact_ir_version: pack.fact_ir_version,
    canonical_grounded_brief_version:
      canonical.canonical_grounded_brief_version,
    accepted_angles: [],
    decision_trace: [],
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

function validationReceipt(
  args: EvaluateRefinedAngleDraftArgs,
  preflight: readonly RefinedAnglePreflightCode[],
  candidate: ContentAngleCandidateV2 | null,
  hostEvaluation: ContentAngleEvaluationReceipt,
): RefinedAngleValidationReceipt {
  const hostFindings = hostEvaluation.decision_trace.flatMap(
    (trace) => trace.decision_reason,
  );
  const passed =
    preflight.length === 0 &&
    hostEvaluation.accepted_angles.some(
      (angle) => angle.id === args.draft.refined_candidate_id,
    );
  return {
    refined_angle_validation_version: REFINED_ANGLE_VALIDATION_VERSION,
    status: passed ? "PASS" : "FAIL",
    scope_lock: preflight.length === 0 ? "PASS" : "FAIL",
    truth_gate: passed ? "PASS" : "FAIL",
    preflight_findings: [...preflight],
    host_findings: hostFindings,
    materialized_candidate: candidate,
    host_evaluation: hostEvaluation,
    provenance: {
      base_candidate_id: args.context.base_candidate.base_candidate_id,
      base_candidate_fingerprint_sha256:
        args.context.base_candidate.base_candidate_fingerprint_sha256,
      refinement_selection_id: args.selection.selection_id,
      refinement_selection_fingerprint_sha256:
        args.selection.selection_fingerprint_sha256,
      refinement_context_fingerprint_sha256:
        args.context.context_fingerprint_sha256,
    },
    generation_metadata: {
      mode: "deterministic_offline_refined_angle_validation",
      paid_api_requests: 0,
      real_model_requests: 0,
      secret_reads: 0,
      repository_executions: 0,
    },
  };
}

function claimedScope(facts: readonly GroundedFact[]): GroundedFact["scope"] {
  const order: Readonly<Record<GroundedFact["scope"], number>> = {
    LOCAL: 0,
    MODULE: 1,
    PACKAGE: 2,
  };
  return facts.reduce(
    (current, fact) => (order[fact.scope] > order[current] ? fact.scope : current),
    "LOCAL" as GroundedFact["scope"],
  );
}

function materializeRefinedCandidate(
  args: EvaluateRefinedAngleDraftArgs,
  entries: readonly AngleRefinementReferenceEntry[],
): ContentAngleCandidateV2 {
  const factById = new Map(
    args.fact_pack.facts.map((fact) => [fact.id, fact]),
  );
  const entityById = new Map(
    args.fact_pack.entities.map((entity) => [entity.id, entity]),
  );
  const facts = entries.map((entry) => {
    const fact = factById.get(entry.canonical_fact_id);
    if (fact === undefined) {
      throw new Error(`REFINED_ANGLE_CANONICAL_FACT_NOT_FOUND:${entry.canonical_fact_id}`);
    }
    return fact;
  });
  const statementByFact = new Map<string, string>();
  for (const trace of args.canonical.statement_to_fact_trace) {
    for (const factId of trace.fact_ids) {
      if (!statementByFact.has(factId)) {
        statementByFact.set(factId, trace.statement_id);
      }
    }
  }
  const technicalEntities = new Map<string, string>();
  for (const fact of facts) {
    for (const entityId of factEntities(fact)) {
      const label = entityById.get(entityId)?.display_label;
      if (label === undefined) {
        throw new Error(`REFINED_ANGLE_ENTITY_NOT_FOUND:${entityId}`);
      }
      technicalEntities.set(entityId, label);
    }
  }
  const supportingStatementIds = [
    ...new Set(
      facts.flatMap((fact) => {
        const statementId = statementByFact.get(fact.id);
        return statementId === undefined ? [] : [statementId];
      }),
    ),
  ];
  const caveats = [
    ...new Set([
      ...args.context.base_candidate.known_caveats,
      ...facts.flatMap((fact) => fact.limitations),
    ]),
  ];
  return {
    content_angle_version: 2,
    id: args.draft.refined_candidate_id,
    status: "CANDIDATE",
    rank: null,
    repository: { ...args.context.repository },
    commit: args.context.commit,
    fact_ir_version: args.context.fact_ir_version,
    canonical_grounded_brief_version:
      args.context.base_candidate.canonical_grounded_brief_version,
    title: args.draft.title,
    angle_type: args.context.base_candidate.angle_type,
    editorial_thesis: args.draft.editorial_thesis,
    editorial_reason: args.draft.why_interesting,
    technical_basis: facts.map((fact) => ({
      fact_id: fact.id,
      canonical_statement_id: statementByFact.get(fact.id) ?? null,
      subject_ref: fact.subject_ref,
      predicate: fact.predicate,
      object_ref: fact.object_ref,
      scope: fact.scope,
    })),
    supporting_fact_ids: facts.map((fact) => fact.id),
    supporting_statement_ids: supportingStatementIds,
    why_interesting: args.draft.why_interesting,
    target_audience: [...args.draft.target_audience],
    confidence: {
      level: args.draft.editorial_confidence ?? "MEDIUM",
      basis: "EDITORIAL_JUDGMENT_NOT_FACT_VERIFICATION",
      rationale:
        "Human-guided refinement confidence does not change Canonical Fact verification.",
    },
    novelty_assessment: {
      status: "NOT_RESEARCHED",
      claim_boundary: "NO_EXTERNAL_NOVELTY_CLAIM",
      rationale:
        "External novelty is outside the repository-only refinement scope.",
    },
    educational_value: args.draft.why_interesting,
    caveats,
    unknown_dependencies: [],
    external_claims: [],
    technical_entities: [...technicalEntities.entries()].map(
      ([entity_ref, label]) => ({ entity_ref, label }),
    ),
    fact_mutation_requests: [],
    claimed_scope: claimedScope(facts),
    editorial_scores: { ...args.context.base_candidate.editorial_scores },
  };
}

export function evaluateRefinedAngleDraft(
  args: EvaluateRefinedAngleDraftArgs,
): RefinedAngleValidationReceipt {
  assertAngleRefinementContextIntegrity(args.context);
  assertHumanRefinementSelectionIntegrity(args.selection);
  assertHumanRefinementSelectionAgainstContext(args.context, args.selection);
  args.schemas.assert("RefinedAngleDraft", args.draft);
  args.schemas.assert("RefinedAngleModelInput", args.model_input);
  const findings: RefinedAnglePreflightCode[] = [];
  if (
    !sameRepository(args.draft.repository, args.model_input.repository) ||
    args.draft.commit !== args.model_input.commit ||
    args.draft.fact_ir_version !== args.model_input.fact_ir_version ||
    !sameRepository(args.fact_pack.repository, args.model_input.repository) ||
    args.fact_pack.commit !== args.model_input.commit ||
    args.fact_pack.fact_ir_version !== args.model_input.fact_ir_version ||
    !sameRepository(args.canonical.repository, args.model_input.repository) ||
    args.canonical.commit !== args.model_input.commit ||
    args.canonical.fact_ir_version !== args.model_input.fact_ir_version
  ) {
    findings.push("REFINED_ANGLE_IDENTITY_MISMATCH");
  }
  if (
    args.draft.base_candidate_id !== args.model_input.base_candidate.base_candidate_id ||
    args.draft.base_candidate_fingerprint_sha256 !==
      args.model_input.base_candidate.base_candidate_fingerprint_sha256 ||
    args.draft.refined_candidate_id === args.draft.base_candidate_id
  ) {
    findings.push("REFINED_ANGLE_BASE_CANDIDATE_MISMATCH");
  }
  if (
    args.draft.refinement_selection_id !==
      args.model_input.provenance.refinement_selection_id ||
    args.draft.refinement_selection_id !== args.selection.selection_id
  ) {
    findings.push("REFINED_ANGLE_SELECTION_MISMATCH");
  }
  const expectedModelInput = buildRefinedAngleModelInput({
    context: args.context,
    selection: args.selection,
    current_binding: {
      repository: args.context.repository,
      commit: args.context.commit,
      fact_ir_version: args.context.fact_ir_version,
      base_candidate_fingerprint_sha256:
        args.context.base_candidate.base_candidate_fingerprint_sha256,
      refinement_context_fingerprint_sha256:
        args.context.context_fingerprint_sha256,
      selected_additional_canonical_fact_ids:
        args.selection.selected_additional_canonical_fact_ids,
    },
  });
  if (sha256(expectedModelInput) !== sha256(args.model_input)) {
    findings.push("REFINED_ANGLE_MODEL_INPUT_MISMATCH");
  }
  const required = args.model_input.approved_fact_set.required_supporting_fact_refs;
  const draftRefs = [...args.draft.supporting_fact_refs];
  if (
    draftRefs.some((reference) => !required.includes(reference)) ||
    new Set(draftRefs).size !== draftRefs.length
  ) {
    findings.push("REFINED_ANGLE_UNSELECTED_FACT_REFERENCE");
  }
  if (required.some((reference) => !draftRefs.includes(reference))) {
    findings.push("REFINED_ANGLE_REQUIRED_FACT_DROPPED");
  }
  if (
    draftRefs.length >
    args.model_input.approved_fact_set.maximum_total_supporting_facts
  ) {
    findings.push("REFINED_ANGLE_FACT_LIMIT_EXCEEDED");
  }
  if (findings.length > 0) {
    return validationReceipt(
      args,
      [...new Set(findings)],
      null,
      emptyHostEvaluation(args.fact_pack, args.canonical),
    );
  }
  const entryByRef = new Map(
    args.context.host_reference_map.entries.map((entry) => [
      entry.model_fact_ref,
      entry,
    ]),
  );
  const entries = draftRefs.map((reference) => {
    const entry = entryByRef.get(reference);
    if (entry === undefined) {
      throw new Error(`REFINED_ANGLE_REFERENCE_MAP_MISSING:${reference}`);
    }
    return entry;
  });
  const candidate = materializeRefinedCandidate(args, entries);
  const hostEvaluation = evaluateContentAngleCandidates(
    [candidate],
    args.fact_pack,
    args.canonical,
    args.schemas,
  );
  return validationReceipt(args, [], candidate, hostEvaluation);
}

export function parseAngleRefinementContext(
  value: unknown,
  schemas: SchemaRegistry,
): AngleRefinementContext {
  schemas.assert("AngleRefinementContext", value);
  const context = value as AngleRefinementContext;
  assertAngleRefinementContextIntegrity(context);
  return context;
}

export function serializeAngleRefinementContext(
  context: AngleRefinementContext,
): string {
  assertAngleRefinementContextIntegrity(context);
  return `${JSON.stringify(context, null, 2)}\n`;
}

function previewLimitations(limitations: readonly string[]): string {
  return limitations.length > 0
    ? limitations.join(" | ")
    : "No additional limitation recorded in the frozen Canonical Fact.";
}

export function renderAngleRefinementPreview(
  context: AngleRefinementContext,
): string {
  assertAngleRefinementContextIntegrity(context);
  const lines = [
    "# Human-Guided Angle Refinement",
    "",
    "## Base Angle",
    "",
    `Candidate: ${context.base_candidate.base_candidate_id}`,
    `Title: ${context.base_candidate.title}`,
    `Editorial Thesis: ${context.base_candidate.editorial_thesis}`,
    `Why Interesting: ${context.base_candidate.why_interesting}`,
    `Host Validation: ${context.base_candidate.host_validation.status}`,
    "",
    "## Current Supporting Facts",
    "",
  ];
  for (const fact of context.base_facts) {
    lines.push(
      `- Fact Ref: ${fact.model_fact_ref}`,
      `  - Canonical Fact Summary: ${fact.canonical_fact_summary}`,
      `  - Category: ${fact.fact_category}`,
      `  - Evidence available: ${fact.evidence_available ? "YES" : "NO"}`,
      `  - Limitation: ${previewLimitations(fact.known_limitations)}`,
    );
  }
  lines.push("", "## Current Caveats", "");
  if (context.base_candidate.known_caveats.length === 0) {
    lines.push("- No additional caveat recorded on the frozen Base Angle.");
  } else {
    context.base_candidate.known_caveats.forEach((caveat) =>
      lines.push(`- ${caveat}`),
    );
  }
  lines.push("", "## Related Grounded Fact Options", "");
  if (context.related_fact_options.length === 0) {
    lines.push(
      "Status: NO_REFINEMENT_FACT_AVAILABLE",
      "Coverage: ANGLE_REFINEMENT_FACT_COVERAGE_LIMIT",
      "No additional Canonical Fact in the frozen input satisfies the deterministic local relation policy.",
      "The Base Angle remains unchanged. No Fact has been selected.",
    );
  } else {
    for (const option of context.related_fact_options) {
      lines.push(
        `- [Select] Fact Ref: ${option.model_fact_ref}`,
        `  - Canonical Fact Summary: ${option.canonical_fact_summary}`,
        `  - Category: ${option.fact_category}`,
        `  - Structural reason: ${option.relation_reason} (${option.relation_distance})`,
        `  - Related Base Fact Refs: ${option.related_to_base_fact_refs.join(", ")}`,
        `  - Evidence available: ${option.evidence_available ? "YES" : "NO"}`,
        `  - Limitation: ${previewLimitations(option.known_limitations)}`,
      );
    }
    lines.push(
      "",
      `Selection limit: up to ${context.refinement_limits.maximum_selected_additional_facts} additional Facts; total supporting Facts must remain at or below ${context.refinement_limits.maximum_total_supporting_facts}.`,
      "Selection is a Human editorial action. It does not change Fact verification or authorize generation.",
    );
  }
  return `${lines.join("\n")}\n`;
}

export function parseHumanRefinementSelection(
  value: unknown,
  schemas: SchemaRegistry,
): HumanRefinementSelection {
  schemas.assert("HumanRefinementSelection", value);
  const selection = value as HumanRefinementSelection;
  assertHumanRefinementSelectionIntegrity(selection);
  return selection;
}

export function serializeHumanRefinementSelection(
  selection: HumanRefinementSelection,
): string {
  assertHumanRefinementSelectionIntegrity(selection);
  return `${JSON.stringify(selection, null, 2)}\n`;
}

function sameStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    [...left].sort(compareText).every(
      (value, index) => value === [...right].sort(compareText)[index],
    )
  );
}

export function evaluateHumanRefinementSelectionFreshness(
  selection: HumanRefinementSelection,
  current: CurrentHumanRefinementBinding,
): HumanRefinementFreshness {
  const reasons: HumanRefinementStaleReason[] = [];
  if (!sameRepository(selection.repository, current.repository)) {
    reasons.push("REPOSITORY_CHANGED");
  }
  if (selection.commit !== current.commit) {
    reasons.push("COMMIT_CHANGED");
  }
  if (selection.fact_ir_version !== current.fact_ir_version) {
    reasons.push("FACT_IR_VERSION_CHANGED");
  }
  if (
    selection.base_candidate_fingerprint_sha256 !==
    current.base_candidate_fingerprint_sha256
  ) {
    reasons.push("BASE_CANDIDATE_CHANGED");
  }
  if (
    selection.refinement_context_fingerprint_sha256 !==
    current.refinement_context_fingerprint_sha256
  ) {
    reasons.push("REFINEMENT_CONTEXT_CHANGED");
  }
  if (
    !sameStringSet(
      selection.selected_additional_canonical_fact_ids,
      current.selected_additional_canonical_fact_ids,
    )
  ) {
    reasons.push("SELECTED_FACT_SET_CHANGED");
  }
  return {
    state: reasons.length === 0 ? "CURRENT" : "STALE",
    reason_codes: reasons,
    refined_angle_eligible: reasons.length === 0,
  };
}
