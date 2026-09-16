import { createHash } from "node:crypto";

import type {
  GroundedEntity,
  GroundedFact,
  GroundedFactCategory,
  GroundedFactPack,
} from "../facts/domain.js";

export const TECHNICAL_NEIGHBORHOOD_VERSION = 1 as const;
export const CONNECTIVITY_EXPLORATION_VERSION = 1 as const;
export const MAXIMUM_VISIBLE_NEIGHBORHOODS = 5 as const;
export const DEFAULT_MAXIMUM_FACTS_PER_NEIGHBORHOOD = 20 as const;
export const HARD_MAXIMUM_FACTS_PER_NEIGHBORHOOD = 30 as const;
export const NEIGHBORHOOD_OVERLAP_THRESHOLD = 0.8 as const;

export interface ExplorationArtifactReference {
  readonly artifact_path: string;
  readonly sha256: string;
}

export interface TechnicalNeighborhoodFactView {
  readonly fact_ref: string;
  readonly summary: string;
  readonly category: GroundedFactCategory;
  readonly predicate: GroundedFact["predicate"];
  readonly connection_scope: "CROSS_MODULE" | "SAME_MODULE" | "NOT_APPLICABLE";
  readonly evidence_ids: readonly string[];
  readonly evidence_available: true;
  readonly limitations: readonly string[];
}

export interface TechnicalNeighborhood {
  readonly technical_neighborhood_version: typeof TECHNICAL_NEIGHBORHOOD_VERSION;
  readonly neighborhood_id: string;
  readonly neighborhood_fingerprint_sha256: string;
  readonly neutral_label: string;
  readonly seed_entities: readonly string[];
  readonly entity_ids: readonly string[];
  readonly fact_refs: readonly string[];
  readonly call_fact_refs: readonly string[];
  readonly relation_fact_refs: readonly string[];
  readonly behavior_fact_refs: readonly string[];
  readonly structural_fact_refs: readonly string[];
  readonly configuration_fact_refs: readonly string[];
  readonly type_fact_refs: readonly string[];
  readonly fact_views: readonly TechnicalNeighborhoodFactView[];
  readonly cross_module_edge_count: number;
  readonly direct_call_count: number;
  readonly behavior_fact_count: number;
  readonly module_count: number;
  readonly module_paths: readonly string[];
  readonly relation_diversity: readonly string[];
  readonly known_unknown_refs: readonly string[];
  readonly boundary_notes: readonly string[];
  readonly selection_reason: {
    readonly kind: "CONNECTIVITY_HEURISTIC_NOT_EDITORIAL_SCORE";
    readonly connectivity_score: number;
    readonly components: {
      readonly bounded_seed_centrality: number;
      readonly cross_module_edges: number;
      readonly direct_calls: number;
      readonly behavior_presence: number;
      readonly grounded_context_presence: number;
      readonly relation_diversity: number;
      readonly module_coverage: number;
      readonly utility_hotspot_penalty: number;
    };
    readonly editorial_score_used: false;
  };
  readonly provenance: {
    readonly repository: GroundedFactPack["repository"];
    readonly commit: string;
    readonly fact_ir_version: GroundedFactPack["fact_ir_version"];
    readonly analyzer_version: string;
    readonly fact_pack_artifact: ExplorationArtifactReference;
    readonly connectivity_policy: "DETERMINISTIC_CANONICAL_CONNECTIVITY_V1";
  };
}

export interface ConnectivityExploration {
  readonly connectivity_exploration_version: typeof CONNECTIVITY_EXPLORATION_VERSION;
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: GroundedFactPack["fact_ir_version"];
  readonly analyzer_version: string;
  readonly status: "READY" | "NO_TECHNICAL_NEIGHBORHOOD";
  readonly connectivity_policy: {
    readonly name: "DETERMINISTIC_CANONICAL_CONNECTIVITY_V1";
    readonly source: "CANONICAL_FACT_GRAPH_ONLY";
    readonly maximum_visible_neighborhoods: number;
    readonly default_maximum_facts_per_neighborhood: number;
    readonly hard_maximum_facts_per_neighborhood: 30;
    readonly overlap_threshold: 0.8;
    readonly unresolved_calls_used: 0;
    readonly llm_used: false;
    readonly embedding_used: false;
    readonly vector_search_used: false;
    readonly clustered_v2_used: false;
    readonly repository_specific_rules_used: false;
    readonly editorial_score_used: false;
  };
  readonly neighborhoods: readonly TechnicalNeighborhood[];
  readonly deduplication: {
    readonly method: "FACT_OR_ENTITY_JACCARD";
    readonly threshold: 0.8;
    readonly candidates_before: number;
    readonly candidates_after: number;
    readonly removed_candidate_ids: readonly string[];
  };
  readonly human_action: {
    readonly available_action: "EXPLORE_NEIGHBORHOOD";
    readonly automatically_selected: false;
    readonly model_authorized: false;
    readonly script_authorized: false;
  };
  readonly provenance: {
    readonly fact_pack_artifact: ExplorationArtifactReference;
  };
  readonly exploration_fingerprint_sha256: string;
  readonly generation_metadata: {
    readonly mode: "deterministic_offline_connectivity_exploration";
    readonly paid_api_requests: 0;
    readonly real_model_requests: 0;
    readonly secret_reads: 0;
    readonly repository_executions: 0;
  };
}

export interface BuildConnectivityExplorationInput {
  readonly factPack: GroundedFactPack;
  readonly analyzerVersion: string;
  readonly factPackArtifact: ExplorationArtifactReference;
  readonly maximumNeighborhoods?: number;
  readonly maximumFactsPerNeighborhood?: number;
}

export interface HumanNeighborhoodSelection {
  readonly human_neighborhood_selection_version: 1;
  readonly status: "VALID";
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: GroundedFactPack["fact_ir_version"];
  readonly neighborhood_version: 1;
  readonly neighborhood_id: string;
  readonly neighborhood_fingerprint_sha256: string;
  readonly connectivity_exploration_fingerprint_sha256: string;
  readonly human_selected: true;
  readonly timestamp: string;
  readonly decision_context: "USER_ACTION" | "OFFLINE_FIXTURE";
  readonly authorization: {
    readonly neighborhood_editorial_context_generation_required: true;
    readonly real_model_authorized: false;
    readonly script_authorized: false;
  };
  readonly selection_fingerprint_sha256: string;
  readonly generation_metadata: {
    readonly mode: "human_neighborhood_selection";
    readonly paid_api_requests: 0;
    readonly real_model_requests: 0;
    readonly secret_reads: 0;
    readonly repository_executions: 0;
  };
}

export type HumanNeighborhoodSelectionStaleReason =
  | "REPOSITORY_CHANGED"
  | "COMMIT_CHANGED"
  | "FACT_IR_VERSION_CHANGED"
  | "NEIGHBORHOOD_VERSION_CHANGED"
  | "NEIGHBORHOOD_NOT_FOUND"
  | "NEIGHBORHOOD_FINGERPRINT_CHANGED"
  | "EXPLORATION_CHANGED";

export interface HumanNeighborhoodSelectionFreshness {
  readonly state: "CURRENT" | "STALE";
  readonly reason_codes: readonly HumanNeighborhoodSelectionStaleReason[];
  readonly editorial_context_eligible: boolean;
}

interface Candidate {
  readonly neighborhood: TechnicalNeighborhood;
  readonly seedDegree: number;
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
    fact.evidence_ids.every((id) => evidenceIds.has(id))
  );
}

function factEntityIds(fact: GroundedFact): readonly string[] {
  return [fact.subject_ref, fact.object_ref];
}

function incident(fact: GroundedFact, entities: ReadonlySet<string>): boolean {
  return entities.has(fact.subject_ref) || entities.has(fact.object_ref);
}

function crossModule(
  fact: GroundedFact,
  entities: ReadonlyMap<string, GroundedEntity>,
): boolean {
  const left = entities.get(fact.subject_ref)?.source_path;
  const right = entities.get(fact.object_ref)?.source_path;
  return left !== undefined && right !== undefined && left !== right;
}

function compareCallFacts(
  entities: ReadonlyMap<string, GroundedEntity>,
  left: GroundedFact,
  right: GroundedFact,
): number {
  return (
    Number(crossModule(right, entities)) - Number(crossModule(left, entities)) ||
    compareText(left.id, right.id)
  );
}

function takeFacts(
  facts: readonly GroundedFact[],
  maximum: number,
): GroundedFact[] {
  return [...facts].sort((left, right) => compareText(left.id, right.id)).slice(0, maximum);
}

function factSummary(
  fact: GroundedFact,
  entities: ReadonlyMap<string, GroundedEntity>,
): string {
  const subject = entities.get(fact.subject_ref)?.display_label;
  const object = entities.get(fact.object_ref)?.display_label;
  if (subject === undefined || object === undefined) {
    throw new Error(`TECHNICAL_NEIGHBORHOOD_ENTITY_NOT_FOUND:${fact.id}`);
  }
  const scope =
    fact.predicate === "CALLS"
      ? crossModule(fact, entities)
        ? "CROSS-MODULE"
        : "SAME-MODULE"
      : fact.scope;
  return `${subject} ${fact.predicate} ${object} [${scope}]`;
}

function jaccard(left: readonly string[], right: readonly string[]): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const intersection = [...leftSet].filter((value) => rightSet.has(value)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  return union === 0 ? 0 : intersection / union;
}

function candidateFor(
  seedId: string,
  pack: GroundedFactPack,
  facts: readonly GroundedFact[],
  entities: ReadonlyMap<string, GroundedEntity>,
  analyzerVersion: string,
  factPackArtifact: ExplorationArtifactReference,
  maximumFacts: number,
): Candidate | null {
  const callFacts = facts.filter((fact) => fact.fact_type === "CALL_RELATION");
  const direct = callFacts
    .filter((fact) => fact.subject_ref === seedId || fact.object_ref === seedId)
    .sort((left, right) => compareCallFacts(entities, left, right));
  if (direct.length === 0) return null;
  const directNeighborIds = new Set(
    direct.flatMap((fact) => factEntityIds(fact)).filter((id) => id !== seedId),
  );
  const directIds = new Set(direct.map((fact) => fact.id));
  const oneHop = callFacts
    .filter((fact) => !directIds.has(fact.id) && incident(fact, directNeighborIds))
    .sort((left, right) => compareCallFacts(entities, left, right));
  const selectedCalls = [...direct.slice(0, 8), ...oneHop.slice(0, 4)]
    .filter((fact, index, values) => values.findIndex((item) => item.id === fact.id) === index)
    .slice(0, 12);
  if (selectedCalls.length < 2) return null;

  const connectedEntityIds = new Set(selectedCalls.flatMap((fact) => factEntityIds(fact)));
  const behavior = takeFacts(
    facts.filter((fact) => fact.category === "BEHAVIORAL" && incident(fact, connectedEntityIds)),
    3,
  );
  behavior.flatMap((fact) => factEntityIds(fact)).forEach((id) => connectedEntityIds.add(id));
  const structural = takeFacts(
    facts.filter((fact) => fact.category === "STRUCTURAL" && incident(fact, connectedEntityIds)),
    4,
  );
  structural.flatMap((fact) => factEntityIds(fact)).forEach((id) => connectedEntityIds.add(id));
  const nonCallRelation = takeFacts(
    facts.filter(
      (fact) =>
        fact.category === "RELATION" &&
        fact.fact_type !== "CALL_RELATION" &&
        incident(fact, connectedEntityIds),
    ),
    3,
  );
  const configuration = takeFacts(
    facts.filter((fact) => fact.category === "CONFIGURATION" && incident(fact, connectedEntityIds)),
    2,
  );
  const type = takeFacts(
    facts.filter((fact) => fact.category === "TYPE" && incident(fact, connectedEntityIds)),
    2,
  );
  const selectedFacts = [
    ...selectedCalls,
    ...behavior,
    ...nonCallRelation,
    ...structural,
    ...configuration,
    ...type,
  ]
    .filter((fact, index, values) => values.findIndex((item) => item.id === fact.id) === index)
    .slice(0, maximumFacts);
  const selectedIds = new Set(selectedFacts.map((fact) => fact.id));
  const finalCalls = selectedCalls.filter((fact) => selectedIds.has(fact.id));
  const finalBehavior = behavior.filter((fact) => selectedIds.has(fact.id));
  const finalRelations = nonCallRelation.filter((fact) => selectedIds.has(fact.id));
  const finalStructural = structural.filter((fact) => selectedIds.has(fact.id));
  const finalConfiguration = configuration.filter((fact) => selectedIds.has(fact.id));
  const finalType = type.filter((fact) => selectedIds.has(fact.id));
  const finalEntityIds = [...new Set(selectedFacts.flatMap((fact) => factEntityIds(fact)))].sort(
    compareText,
  );
  if (finalEntityIds.length < 3) return null;
  const modulePaths = [...new Set(
    finalEntityIds
      .map((id) => entities.get(id)?.source_path)
      .filter((path): path is string => path !== undefined),
  )].sort(compareText);
  const moduleCount = modulePaths.length;
  const crossModuleCount = finalCalls.filter((fact) => crossModule(fact, entities)).length;
  const relationDiversity = [
    ...new Set(selectedFacts.map((fact) => `${fact.category}:${fact.predicate}`)),
  ].sort(compareText);
  const contextualFacts =
    finalBehavior.length +
    finalRelations.length +
    finalStructural.length +
    finalConfiguration.length +
    finalType.length;
  const utilityPenalty = contextualFacts === 0 ? -25 : 0;
  const components = {
    bounded_seed_centrality: Math.min(direct.length, 6),
    cross_module_edges: Math.min(crossModuleCount, 4) * 8,
    direct_calls: Math.min(finalCalls.length, 8) * 2,
    behavior_presence: Math.min(finalBehavior.length, 1) * 24,
    grounded_context_presence: contextualFacts > 0 ? 30 : 0,
    relation_diversity: Math.min(relationDiversity.length, 5) * 5,
    module_coverage: Math.min(moduleCount, 5) * 3,
    utility_hotspot_penalty: utilityPenalty,
  };
  const connectivityScore = Object.values(components).reduce((sum, value) => sum + value, 0);
  const knownUnknownRefs = pack.unsupported_areas
    .filter(
      (area) =>
        area.id.startsWith("call_relation_") ||
        (finalBehavior.length > 0 && area.id === "general_branch_behavior"),
    )
    .map((area) => `gap_${area.id}`)
    .sort(compareText);
  const body = {
    technical_neighborhood_version: TECHNICAL_NEIGHBORHOOD_VERSION,
    neighborhood_id: `neighborhood_${sha256(seedId).slice(0, 16)}`,
    neutral_label: `Seed: ${entities.get(seedId)?.display_label ?? seedId}`,
    seed_entities: [seedId],
    entity_ids: finalEntityIds,
    fact_refs: selectedFacts.map((fact) => fact.id),
    call_fact_refs: finalCalls.map((fact) => fact.id).sort(compareText),
    relation_fact_refs: finalRelations.map((fact) => fact.id).sort(compareText),
    behavior_fact_refs: finalBehavior.map((fact) => fact.id).sort(compareText),
    structural_fact_refs: finalStructural.map((fact) => fact.id).sort(compareText),
    configuration_fact_refs: finalConfiguration.map((fact) => fact.id).sort(compareText),
    type_fact_refs: finalType.map((fact) => fact.id).sort(compareText),
    fact_views: selectedFacts.map((fact) => ({
      fact_ref: fact.id,
      summary: factSummary(fact, entities),
      category: fact.category,
      predicate: fact.predicate,
      connection_scope:
        fact.predicate === "CALLS"
          ? crossModule(fact, entities)
            ? "CROSS_MODULE" as const
            : "SAME_MODULE" as const
          : "NOT_APPLICABLE" as const,
      evidence_ids: [...fact.evidence_ids],
      evidence_available: true as const,
      limitations: [...fact.limitations],
    })),
    cross_module_edge_count: crossModuleCount,
    direct_call_count: finalCalls.length,
    behavior_fact_count: finalBehavior.length,
    module_count: moduleCount,
    module_paths: modulePaths,
    relation_diversity: relationDiversity,
    known_unknown_refs: knownUnknownRefs,
    boundary_notes: [
      "CALLS records authored direct static call expressions and does not prove runtime execution.",
      "One-hop display is a STATIC CALL PATH, not data flow or runtime order.",
      "Unresolved calls and Facts outside the Canonical emitted set are excluded.",
    ],
    selection_reason: {
      kind: "CONNECTIVITY_HEURISTIC_NOT_EDITORIAL_SCORE" as const,
      connectivity_score: connectivityScore,
      components,
      editorial_score_used: false as const,
    },
    provenance: {
      repository: { ...pack.repository },
      commit: pack.commit,
      fact_ir_version: pack.fact_ir_version,
      analyzer_version: analyzerVersion,
      fact_pack_artifact: { ...factPackArtifact },
      connectivity_policy: "DETERMINISTIC_CANONICAL_CONNECTIVITY_V1" as const,
    },
  };
  return {
    neighborhood: {
      ...body,
      neighborhood_fingerprint_sha256: sha256(body),
    },
    seedDegree: direct.length,
  };
}

function validateLimits(maximumNeighborhoods: number, maximumFacts: number): void {
  if (
    !Number.isInteger(maximumNeighborhoods) ||
    maximumNeighborhoods < 0 ||
    maximumNeighborhoods > MAXIMUM_VISIBLE_NEIGHBORHOODS
  ) {
    throw new Error("CONNECTIVITY_NEIGHBORHOOD_LIMIT_INVALID");
  }
  if (
    !Number.isInteger(maximumFacts) ||
    maximumFacts < 2 ||
    maximumFacts > HARD_MAXIMUM_FACTS_PER_NEIGHBORHOOD
  ) {
    throw new Error("CONNECTIVITY_FACT_LIMIT_INVALID");
  }
}

function sameRepository(
  left: GroundedFactPack["repository"],
  right: GroundedFactPack["repository"],
): boolean {
  return left.url === right.url && left.owner === right.owner && left.name === right.name;
}

export function assessHumanNeighborhoodSelectionFreshness(
  selection: HumanNeighborhoodSelection,
  exploration: ConnectivityExploration,
): HumanNeighborhoodSelectionFreshness {
  const reasons: HumanNeighborhoodSelectionStaleReason[] = [];
  if (!sameRepository(selection.repository, exploration.repository)) {
    reasons.push("REPOSITORY_CHANGED");
  }
  if (selection.commit !== exploration.commit) reasons.push("COMMIT_CHANGED");
  if (selection.fact_ir_version !== exploration.fact_ir_version) {
    reasons.push("FACT_IR_VERSION_CHANGED");
  }
  if (selection.neighborhood_version !== TECHNICAL_NEIGHBORHOOD_VERSION) {
    reasons.push("NEIGHBORHOOD_VERSION_CHANGED");
  }
  const neighborhood = exploration.neighborhoods.find(
    (item) => item.neighborhood_id === selection.neighborhood_id,
  );
  if (neighborhood === undefined) {
    reasons.push("NEIGHBORHOOD_NOT_FOUND");
  } else if (
    neighborhood.neighborhood_fingerprint_sha256 !==
    selection.neighborhood_fingerprint_sha256
  ) {
    reasons.push("NEIGHBORHOOD_FINGERPRINT_CHANGED");
  }
  if (
    selection.connectivity_exploration_fingerprint_sha256 !==
    exploration.exploration_fingerprint_sha256
  ) {
    reasons.push("EXPLORATION_CHANGED");
  }
  return {
    state: reasons.length === 0 ? "CURRENT" : "STALE",
    reason_codes: reasons,
    editorial_context_eligible: reasons.length === 0,
  };
}

export function buildConnectivityExploration(
  input: BuildConnectivityExplorationInput,
): ConnectivityExploration {
  const maximumNeighborhoods = input.maximumNeighborhoods ?? MAXIMUM_VISIBLE_NEIGHBORHOODS;
  const maximumFacts =
    input.maximumFactsPerNeighborhood ?? DEFAULT_MAXIMUM_FACTS_PER_NEIGHBORHOOD;
  validateLimits(maximumNeighborhoods, maximumFacts);
  const evidenceIds = new Set(
    input.factPack.evidence_refs
      .filter((evidence) => evidence.verification_status === "verified")
      .map((evidence) => evidence.id),
  );
  const facts = input.factPack.facts.filter((fact) =>
    isCanonicalFact(fact, input.factPack, evidenceIds),
  );
  const entities = new Map(input.factPack.entities.map((entity) => [entity.id, entity]));
  const seedIds = [
    ...new Set(
      facts
        .filter((fact) => fact.fact_type === "CALL_RELATION")
        .flatMap((fact) => factEntityIds(fact)),
    ),
  ].sort(compareText);
  const candidates = seedIds
    .map((seedId) =>
      candidateFor(
        seedId,
        input.factPack,
        facts,
        entities,
        input.analyzerVersion,
        input.factPackArtifact,
        maximumFacts,
      ),
    )
    .filter((candidate): candidate is Candidate => candidate !== null)
    .sort(
      (left, right) =>
        right.neighborhood.selection_reason.connectivity_score -
          left.neighborhood.selection_reason.connectivity_score ||
        right.seedDegree - left.seedDegree ||
        compareText(left.neighborhood.neighborhood_id, right.neighborhood.neighborhood_id),
    );
  const kept: Candidate[] = [];
  const removed: string[] = [];
  for (const candidate of candidates) {
    const duplicate = kept.some(
      (existing) =>
        jaccard(
          candidate.neighborhood.fact_refs,
          existing.neighborhood.fact_refs,
        ) >= NEIGHBORHOOD_OVERLAP_THRESHOLD ||
        jaccard(
          candidate.neighborhood.entity_ids,
          existing.neighborhood.entity_ids,
        ) >= NEIGHBORHOOD_OVERLAP_THRESHOLD,
    );
    if (duplicate || kept.length >= maximumNeighborhoods) {
      removed.push(candidate.neighborhood.neighborhood_id);
      continue;
    }
    kept.push(candidate);
  }
  const body = {
    connectivity_exploration_version: CONNECTIVITY_EXPLORATION_VERSION,
    repository: { ...input.factPack.repository },
    commit: input.factPack.commit,
    fact_ir_version: input.factPack.fact_ir_version,
    analyzer_version: input.analyzerVersion,
    status:
      kept.length > 0 ? ("READY" as const) : ("NO_TECHNICAL_NEIGHBORHOOD" as const),
    connectivity_policy: {
      name: "DETERMINISTIC_CANONICAL_CONNECTIVITY_V1" as const,
      source: "CANONICAL_FACT_GRAPH_ONLY" as const,
      maximum_visible_neighborhoods: maximumNeighborhoods,
      default_maximum_facts_per_neighborhood: maximumFacts,
      hard_maximum_facts_per_neighborhood: HARD_MAXIMUM_FACTS_PER_NEIGHBORHOOD,
      overlap_threshold: NEIGHBORHOOD_OVERLAP_THRESHOLD,
      unresolved_calls_used: 0 as const,
      llm_used: false as const,
      embedding_used: false as const,
      vector_search_used: false as const,
      clustered_v2_used: false as const,
      repository_specific_rules_used: false as const,
      editorial_score_used: false as const,
    },
    neighborhoods: kept.map((candidate) => candidate.neighborhood),
    deduplication: {
      method: "FACT_OR_ENTITY_JACCARD" as const,
      threshold: NEIGHBORHOOD_OVERLAP_THRESHOLD,
      candidates_before: candidates.length,
      candidates_after: kept.length,
      removed_candidate_ids: removed,
    },
    human_action: {
      available_action: "EXPLORE_NEIGHBORHOOD" as const,
      automatically_selected: false as const,
      model_authorized: false as const,
      script_authorized: false as const,
    },
    provenance: {
      fact_pack_artifact: { ...input.factPackArtifact },
    },
    generation_metadata: {
      mode: "deterministic_offline_connectivity_exploration" as const,
      paid_api_requests: 0 as const,
      real_model_requests: 0 as const,
      secret_reads: 0 as const,
      repository_executions: 0 as const,
    },
  };
  return {
    ...body,
    exploration_fingerprint_sha256: sha256(body),
  };
}

export function renderConnectivityExplorationMarkdown(
  exploration: ConnectivityExploration,
): string {
  const lines = [
    "# Connectivity-Guided Human Exploration",
    "",
    `Repository: ${exploration.repository.url}`,
    `Commit: ${exploration.commit}`,
    `Fact IR: v${exploration.fact_ir_version}`,
    `Analyzer: ${exploration.analyzer_version}`,
    "",
    "This is a deterministic Truth-navigation view. It does not rank Content Angles or prove runtime data flow.",
    "",
  ];
  exploration.neighborhoods.forEach((neighborhood, index) => {
    const callViews = neighborhood.fact_views.filter((fact) => fact.predicate === "CALLS");
    const behaviorViews = neighborhood.fact_views.filter(
      (fact) => fact.category === "BEHAVIORAL",
    );
    const relationViews = neighborhood.fact_views.filter(
      (fact) => fact.category === "RELATION" && fact.predicate !== "CALLS",
    );
    const structuralViews = neighborhood.fact_views.filter(
      (fact) => fact.category === "STRUCTURAL",
    );
    lines.push(
      `## Technical Neighborhood ${String(index + 1).padStart(2, "0")}`,
      "",
      `ID: ${neighborhood.neighborhood_id}`,
      `Seed: ${neighborhood.neutral_label.replace(/^Seed:\s*/, "")}`,
      `Modules (${neighborhood.module_count}): ${neighborhood.module_paths.join(", ")}`,
      `Facts: ${neighborhood.fact_refs.length}`,
      `Direct Calls: ${neighborhood.direct_call_count}`,
      `Cross-module Calls: ${neighborhood.cross_module_edge_count}`,
      `Behavior Facts: ${neighborhood.behavior_fact_count}`,
      `Relation Diversity: ${neighborhood.relation_diversity.join(", ")}`,
      "",
      "### Direct and bounded call connections",
      "",
      ...(callViews.length === 0
        ? ["None."]
        : callViews.map((fact) => `- ${fact.summary} — ${fact.fact_ref}`)),
      "",
      "### Attached Behavior Facts",
      "",
      ...(behaviorViews.length === 0
        ? ["None."]
        : behaviorViews.map((fact) => `- ${fact.summary} — ${fact.fact_ref}`)),
      "",
      "### Structural and non-call Relations",
      "",
      ...([...relationViews, ...structuralViews].length === 0
        ? ["None."]
        : [...relationViews, ...structuralViews].map(
            (fact) => `- ${fact.summary} — ${fact.fact_ref}`,
          )),
      "",
      `Known Unknowns: ${neighborhood.known_unknown_refs.join(", ") || "None attached."}`,
      "Evidence available: YES for every displayed Fact.",
      "",
      ...neighborhood.boundary_notes.map((note) => `- ${note}`),
      "",
      `Future action: \`Explore ${neighborhood.neighborhood_id}\``,
      "",
    );
  });
  if (exploration.neighborhoods.length === 0) {
    lines.push(
      "No bounded technical neighborhood met the current Canonical connectivity policy.",
      "",
    );
  }
  lines.push(
    "No Neighborhood is selected by this Artifact. A future explicit Human action is required before any local Editorial Context can exist.",
    "",
    "STATIC CALL PATH means composition of verified direct static CALLS edges. It is not runtime-guaranteed order or data flow.",
    "",
  );
  return lines.join("\n");
}
