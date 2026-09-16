import { createHash } from "node:crypto";

import {
  assessHumanNeighborhoodSelectionFreshness,
  type ConnectivityExploration,
  type ExplorationArtifactReference,
  type HumanNeighborhoodSelection,
  type TechnicalNeighborhood,
  type TechnicalNeighborhoodFactView,
} from "./technical-neighborhood.js";

export const NEIGHBORHOOD_EDITORIAL_CONTEXT_VERSION = 1 as const;

export interface CreateHumanNeighborhoodSelectionInput {
  readonly exploration: ConnectivityExploration;
  readonly neighborhoodId: string;
  readonly timestamp: string;
  readonly decisionContext: HumanNeighborhoodSelection["decision_context"];
}

export interface NeighborhoodEditorialFact {
  readonly canonical_fact_ref: string;
  readonly summary: string;
  readonly category: TechnicalNeighborhoodFactView["category"];
  readonly predicate: TechnicalNeighborhoodFactView["predicate"];
  readonly connection_scope: TechnicalNeighborhoodFactView["connection_scope"];
  readonly limitations: readonly string[];
  readonly evidence_provenance: {
    readonly evidence_ids: readonly string[];
    readonly repository_url: string;
    readonly repository_commit: string;
    readonly fact_ir_version: ConnectivityExploration["fact_ir_version"];
    readonly fact_pack_artifact: ExplorationArtifactReference;
  };
}

export interface NeighborhoodKnownUnknown {
  readonly unknown_ref: string;
  readonly namespace: "KNOWN_UNKNOWN";
  readonly relevance: "SELECTED_NEIGHBORHOOD_BOUNDARY";
}

export interface NeighborhoodEditorialContext {
  readonly neighborhood_editorial_context_version:
    typeof NEIGHBORHOOD_EDITORIAL_CONTEXT_VERSION;
  readonly status: "READY";
  readonly repository: ConnectivityExploration["repository"];
  readonly commit: string;
  readonly fact_ir_version: ConnectivityExploration["fact_ir_version"];
  readonly project_identity: {
    readonly repository_full_name: string;
    readonly selected_module_paths: readonly string[];
  };
  readonly selected_neighborhood: {
    readonly neighborhood_version: 1;
    readonly neighborhood_id: string;
    readonly neighborhood_fingerprint_sha256: string;
    readonly seed_label: string;
    readonly seed_entity_refs: readonly string[];
  };
  readonly canonical_fact_refs: readonly string[];
  readonly canonical_facts: readonly NeighborhoodEditorialFact[];
  readonly fact_counts: {
    readonly total: number;
    readonly call: number;
    readonly behavior: number;
    readonly relation: number;
    readonly structural: number;
    readonly configuration: number;
    readonly type: number;
  };
  readonly known_unknowns: readonly NeighborhoodKnownUnknown[];
  readonly truth_boundaries: readonly string[];
  readonly provenance: {
    readonly human_selection_artifact: ExplorationArtifactReference;
    readonly connectivity_exploration_artifact: ExplorationArtifactReference;
    readonly fact_pack_artifact: ExplorationArtifactReference;
    readonly human_selection_fingerprint_sha256: string;
    readonly connectivity_exploration_fingerprint_sha256: string;
    readonly selected_fact_source: "SELECTED_NEIGHBORHOOD_ONLY";
    readonly full_fact_space_loaded: false;
  };
  readonly context_fingerprint_sha256: string;
  readonly generation_metadata: {
    readonly mode: "deterministic_offline_neighborhood_editorial_context";
    readonly paid_api_requests: 0;
    readonly real_model_requests: 0;
    readonly secret_reads: 0;
    readonly repository_executions: 0;
  };
}

export type NeighborhoodModelInputPreview = Omit<
  NeighborhoodEditorialContext,
  "status" | "generation_metadata"
>;

export interface BuildNeighborhoodEditorialContextInput {
  readonly exploration: ConnectivityExploration;
  readonly selection: HumanNeighborhoodSelection;
  readonly selectionArtifact: ExplorationArtifactReference;
  readonly explorationArtifact: ExplorationArtifactReference;
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

function selectionBody(
  selection: HumanNeighborhoodSelection,
): Omit<HumanNeighborhoodSelection, "selection_fingerprint_sha256"> {
  const { selection_fingerprint_sha256: _fingerprint, ...body } = selection;
  return body;
}

function assertTimestamp(timestamp: string): void {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== timestamp) {
    throw new Error("HUMAN_NEIGHBORHOOD_SELECTION_TIMESTAMP_INVALID");
  }
}

export function createHumanNeighborhoodSelection(
  input: CreateHumanNeighborhoodSelectionInput,
): HumanNeighborhoodSelection {
  assertTimestamp(input.timestamp);
  if (input.exploration.status !== "READY") {
    throw new Error("HUMAN_NEIGHBORHOOD_SELECTION_EXPLORATION_NOT_READY");
  }
  const neighborhood = input.exploration.neighborhoods.find(
    (item) => item.neighborhood_id === input.neighborhoodId,
  );
  if (neighborhood === undefined) {
    throw new Error("HUMAN_NEIGHBORHOOD_SELECTION_TARGET_NOT_FOUND");
  }
  const body = {
    human_neighborhood_selection_version: 1 as const,
    status: "VALID" as const,
    repository: { ...input.exploration.repository },
    commit: input.exploration.commit,
    fact_ir_version: input.exploration.fact_ir_version,
    neighborhood_version: 1 as const,
    neighborhood_id: neighborhood.neighborhood_id,
    neighborhood_fingerprint_sha256:
      neighborhood.neighborhood_fingerprint_sha256,
    connectivity_exploration_fingerprint_sha256:
      input.exploration.exploration_fingerprint_sha256,
    human_selected: true as const,
    timestamp: input.timestamp,
    decision_context: input.decisionContext,
    authorization: {
      neighborhood_editorial_context_generation_required: true as const,
      real_model_authorized: false as const,
      script_authorized: false as const,
    },
    generation_metadata: {
      mode: "human_neighborhood_selection" as const,
      paid_api_requests: 0 as const,
      real_model_requests: 0 as const,
      secret_reads: 0 as const,
      repository_executions: 0 as const,
    },
  };
  return {
    ...body,
    selection_fingerprint_sha256: sha256(body),
  };
}

export function assertHumanNeighborhoodSelectionIntegrity(
  selection: HumanNeighborhoodSelection,
): void {
  assertTimestamp(selection.timestamp);
  if (
    selection.selection_fingerprint_sha256 !== sha256(selectionBody(selection))
  ) {
    throw new Error("HUMAN_NEIGHBORHOOD_SELECTION_FINGERPRINT_MISMATCH");
  }
  if (
    selection.status !== "VALID" ||
    selection.human_selected !== true ||
    selection.authorization.neighborhood_editorial_context_generation_required !== true ||
    selection.authorization.real_model_authorized !== false ||
    selection.authorization.script_authorized !== false ||
    selection.generation_metadata.paid_api_requests !== 0 ||
    selection.generation_metadata.real_model_requests !== 0 ||
    selection.generation_metadata.secret_reads !== 0 ||
    selection.generation_metadata.repository_executions !== 0
  ) {
    throw new Error("HUMAN_NEIGHBORHOOD_SELECTION_CONTRACT_INVALID");
  }
}

function assertNeighborhoodProjection(neighborhood: TechnicalNeighborhood): void {
  const factRefs = neighborhood.fact_refs;
  const factViewRefs = neighborhood.fact_views.map((fact) => fact.fact_ref);
  if (
    new Set(factRefs).size !== factRefs.length ||
    new Set(factViewRefs).size !== factViewRefs.length ||
    factRefs.length !== factViewRefs.length ||
    factRefs.some((factRef) => !factViewRefs.includes(factRef)) ||
    neighborhood.fact_views.some(
      (fact) => !fact.evidence_available || fact.evidence_ids.length === 0,
    )
  ) {
    throw new Error("NEIGHBORHOOD_EDITORIAL_CONTEXT_FACT_PROJECTION_INVALID");
  }
  const partition = [
    ...neighborhood.call_fact_refs,
    ...neighborhood.relation_fact_refs,
    ...neighborhood.behavior_fact_refs,
    ...neighborhood.structural_fact_refs,
    ...neighborhood.configuration_fact_refs,
    ...neighborhood.type_fact_refs,
  ];
  if (
    new Set(partition).size !== factRefs.length ||
    factRefs.some((factRef) => !partition.includes(factRef))
  ) {
    throw new Error("NEIGHBORHOOD_EDITORIAL_CONTEXT_FACT_PARTITION_INVALID");
  }
}

function editorialFact(
  fact: TechnicalNeighborhoodFactView,
  exploration: ConnectivityExploration,
  neighborhood: TechnicalNeighborhood,
): NeighborhoodEditorialFact {
  return {
    canonical_fact_ref: fact.fact_ref,
    summary: fact.summary,
    category: fact.category,
    predicate: fact.predicate,
    connection_scope: fact.connection_scope,
    limitations: [...fact.limitations],
    evidence_provenance: {
      evidence_ids: [...fact.evidence_ids],
      repository_url: exploration.repository.url,
      repository_commit: exploration.commit,
      fact_ir_version: exploration.fact_ir_version,
      fact_pack_artifact: { ...neighborhood.provenance.fact_pack_artifact },
    },
  };
}

export function buildNeighborhoodEditorialContext(
  input: BuildNeighborhoodEditorialContextInput,
): NeighborhoodEditorialContext {
  assertHumanNeighborhoodSelectionIntegrity(input.selection);
  const freshness = assessHumanNeighborhoodSelectionFreshness(
    input.selection,
    input.exploration,
  );
  if (!freshness.editorial_context_eligible) {
    throw new Error(
      `NEIGHBORHOOD_EDITORIAL_CONTEXT_SELECTION_STALE:${freshness.reason_codes.join(",")}`,
    );
  }
  const neighborhood = input.exploration.neighborhoods.find(
    (item) => item.neighborhood_id === input.selection.neighborhood_id,
  );
  if (neighborhood === undefined) {
    throw new Error("NEIGHBORHOOD_EDITORIAL_CONTEXT_NEIGHBORHOOD_NOT_FOUND");
  }
  assertNeighborhoodProjection(neighborhood);
  const views = new Map(
    neighborhood.fact_views.map((fact) => [fact.fact_ref, fact] as const),
  );
  const canonicalFacts = neighborhood.fact_refs.map((factRef) => {
    const view = views.get(factRef);
    if (view === undefined) {
      throw new Error(`NEIGHBORHOOD_EDITORIAL_CONTEXT_FACT_VIEW_NOT_FOUND:${factRef}`);
    }
    return editorialFact(view, input.exploration, neighborhood);
  });
  const body = {
    neighborhood_editorial_context_version:
      NEIGHBORHOOD_EDITORIAL_CONTEXT_VERSION,
    status: "READY" as const,
    repository: { ...input.exploration.repository },
    commit: input.exploration.commit,
    fact_ir_version: input.exploration.fact_ir_version,
    project_identity: {
      repository_full_name: `${input.exploration.repository.owner}/${input.exploration.repository.name}`,
      selected_module_paths: [...neighborhood.module_paths],
    },
    selected_neighborhood: {
      neighborhood_version: 1 as const,
      neighborhood_id: neighborhood.neighborhood_id,
      neighborhood_fingerprint_sha256:
        neighborhood.neighborhood_fingerprint_sha256,
      seed_label: neighborhood.neutral_label.replace(/^Seed:\s*/, ""),
      seed_entity_refs: [...neighborhood.seed_entities],
    },
    canonical_fact_refs: [...neighborhood.fact_refs],
    canonical_facts: canonicalFacts,
    fact_counts: {
      total: neighborhood.fact_refs.length,
      call: neighborhood.call_fact_refs.length,
      behavior: neighborhood.behavior_fact_refs.length,
      relation: neighborhood.relation_fact_refs.length,
      structural: neighborhood.structural_fact_refs.length,
      configuration: neighborhood.configuration_fact_refs.length,
      type: neighborhood.type_fact_refs.length,
    },
    known_unknowns: neighborhood.known_unknown_refs.map((unknownRef) => ({
      unknown_ref: unknownRef,
      namespace: "KNOWN_UNKNOWN" as const,
      relevance: "SELECTED_NEIGHBORHOOD_BOUNDARY" as const,
    })),
    truth_boundaries: [...neighborhood.boundary_notes],
    provenance: {
      human_selection_artifact: { ...input.selectionArtifact },
      connectivity_exploration_artifact: { ...input.explorationArtifact },
      fact_pack_artifact: { ...neighborhood.provenance.fact_pack_artifact },
      human_selection_fingerprint_sha256:
        input.selection.selection_fingerprint_sha256,
      connectivity_exploration_fingerprint_sha256:
        input.exploration.exploration_fingerprint_sha256,
      selected_fact_source: "SELECTED_NEIGHBORHOOD_ONLY" as const,
      full_fact_space_loaded: false as const,
    },
    generation_metadata: {
      mode: "deterministic_offline_neighborhood_editorial_context" as const,
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

export function buildNeighborhoodModelInputPreview(
  context: NeighborhoodEditorialContext,
): NeighborhoodModelInputPreview {
  const { status: _status, generation_metadata: _metadata, ...preview } = context;
  return structuredClone(preview);
}

export function renderNeighborhoodModelInputPreviewMarkdown(
  context: NeighborhoodEditorialContext,
): string {
  const facts = context.canonical_facts
    .map(
      (fact) =>
        `- \`${fact.canonical_fact_ref}\`: ${fact.summary}\n  - Evidence: ${fact.evidence_provenance.evidence_ids.map((id) => `\`${id}\``).join(", ")}\n  - Limitation: ${fact.limitations.join(" ")}`,
    )
    .join("\n");
  const unknowns = context.known_unknowns
    .map((item) => `- \`${item.unknown_ref}\``)
    .join("\n");
  return `# Neighborhood Editorial Context — Model Input Preview\n\nStatus: **Model input preview only; no model request is authorized.**\n\nNo Content Angle has been generated. No Script has been generated.\n\n## Binding\n\n- Repository: \`${context.project_identity.repository_full_name}\`\n- Commit: \`${context.commit}\`\n- Fact IR: v${context.fact_ir_version}\n- Neighborhood: \`${context.selected_neighborhood.neighborhood_id}\`\n- Neighborhood fingerprint: \`${context.selected_neighborhood.neighborhood_fingerprint_sha256}\`\n- Context fingerprint: \`${context.context_fingerprint_sha256}\`\n- Seed: \`${context.selected_neighborhood.seed_label}\`\n- Selected module: \`${context.project_identity.selected_module_paths.join("`, `")}\`\n- Scope: ${context.fact_counts.call} Call Facts / ${context.fact_counts.behavior} Behavior Facts\n\n## Canonical Facts\n\n${facts}\n\n## Relevant Known Unknowns\n\n${unknowns}\n\n## Truth Boundaries\n\n${context.truth_boundaries.map((note) => `- ${note}`).join("\n")}\n`;
}
