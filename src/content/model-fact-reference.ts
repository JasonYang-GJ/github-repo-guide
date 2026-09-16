import type {
  GroundedFact,
  GroundedFactCategory,
  GroundedFactPack,
} from "../facts/domain.js";
import type { CanonicalEditorialAngleInputV2 } from "./editorial-angle-input.js";
import type { EditorialFactCluster } from "./editorial-fact-clusters.js";
import type { DeterministicContentAngleInput } from "./angle-contract.js";

export const MODEL_FACT_REFERENCE_MAP_VERSION = 1 as const;

export interface ModelFactReferenceEntry {
  readonly model_ref: string;
  readonly frozen_source_ref: string;
  readonly canonical_fact_id: string;
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: GroundedFactPack["fact_ir_version"];
}

export interface ModelFactReferenceMap {
  readonly model_fact_reference_map_version: typeof MODEL_FACT_REFERENCE_MAP_VERSION;
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: GroundedFactPack["fact_ir_version"];
  readonly source_editorial_angle_input_version: 2;
  readonly authoritative_model_ref_format: "fact_{three-digit one-based frozen fact position}";
  readonly frozen_source_ref_format: "F{three-digit one-based canonical fact position}";
  readonly entries: readonly ModelFactReferenceEntry[];
}

export interface FlatModelFactReferenceEntry {
  readonly model_ref: string;
  readonly canonical_fact_id: string;
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: GroundedFactPack["fact_ir_version"];
}

/**
 * Host-only mapping for the stable Flat v1 editorial input. Only model_ref is
 * projected to a model; Canonical Fact IDs remain behind the Host boundary.
 */
export interface FlatModelFactReferenceMap {
  readonly model_fact_reference_map_version: typeof MODEL_FACT_REFERENCE_MAP_VERSION;
  readonly source_input: "FLAT_V1";
  readonly source_content_angle_input_version: 1;
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: GroundedFactPack["fact_ir_version"];
  readonly authoritative_model_ref_format: "fact_{three-digit one-based flat fact position}";
  readonly entries: readonly FlatModelFactReferenceEntry[];
}

export interface FutureEditorialAngleModelProjection {
  readonly model_projection_version: 1;
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: GroundedFactPack["fact_ir_version"];
  readonly canonical_brief_version: number;
  readonly truth_boundary: CanonicalEditorialAngleInputV2["truth_boundary"];
  readonly reference_contract: {
    readonly authoritative_fact_input_field: "model_fact_ref";
    readonly authoritative_fact_output_field: "supporting_model_fact_refs";
    readonly fact_reference_namespace: "fact_*";
    readonly known_unknown_reference_namespace: "gap_*";
    readonly canonical_fact_ids_model_visible: false;
    readonly frozen_source_refs_model_visible: false;
    readonly host_resolution_required_before_truth_gate: true;
  };
  readonly input_scope: CanonicalEditorialAngleInputV2["input_scope"];
  readonly canonical_brief: {
    readonly fields: readonly ["statement_id", "text", "model_fact_refs"];
    readonly items: readonly (readonly [string, string, readonly string[]])[];
  };
  readonly clusters: {
    readonly fields: readonly [
      "cluster_id",
      "cluster_reason",
      "model_fact_refs",
      "shared_entity_labels",
    ];
    readonly items: readonly (readonly [
      string,
      EditorialFactCluster["cluster_reason"],
      readonly string[],
      readonly string[],
    ])[];
    readonly unclustered_model_fact_refs: readonly string[];
  };
  readonly facts: {
    readonly groups: readonly {
      readonly category: GroundedFactCategory;
      readonly fields: readonly [
        "model_fact_ref",
        "fact_type",
        "subject",
        "predicate",
        "object",
        "scope",
        "limitation_ids",
      ];
      readonly items: readonly (readonly [
        string,
        GroundedFact["fact_type"],
        string,
        GroundedFact["predicate"],
        string,
        GroundedFact["scope"],
        readonly string[],
      ])[];
    }[];
    readonly limitations: CanonicalEditorialAngleInputV2["facts"]["limitations"];
  };
  readonly known_unknowns: CanonicalEditorialAngleInputV2["known_unknowns"];
  readonly limitations: CanonicalEditorialAngleInputV2["limitations"];
  readonly editorial_task_contract: {
    readonly task: "GROUNDED_CONTENT_ANGLE_DISCOVERY";
    readonly output_contract: "MINIMAL_ANGLE_DECISION_WITH_MODEL_FACT_REFS";
    readonly model_output_fields: readonly [
      "candidate_id",
      "title",
      "angle_type",
      "editorial_thesis",
      "supporting_model_fact_refs",
      "why_interesting",
      "target_audience",
      "editorial_confidence",
    ];
    readonly clusters_organize_truth_without_interpreting_importance: true;
  };
  readonly generation_metadata: CanonicalEditorialAngleInputV2["generation_metadata"];
}

export type ModelFactReferenceNamespace =
  | "AUTHORITATIVE_MODEL_REF"
  | "FROZEN_VS05_E_SOURCE_REF";

export interface ExactModelFactReferenceRequest {
  readonly raw_reference: string;
  readonly accepted_namespace: ModelFactReferenceNamespace;
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: GroundedFactPack["fact_ir_version"];
}

export type ExactModelFactReferenceResolution =
  | {
      readonly status: "RESOLVED";
      readonly raw_reference: string;
      readonly model_ref: string;
      readonly canonical_fact_id: string;
      readonly resolution_reason: "MODEL_REFERENCE_CANONICALIZED";
    }
  | {
      readonly status: "REJECTED";
      readonly raw_reference: string;
      readonly resolved_reference: null;
      readonly failure_code:
        | "UNKNOWN_MODEL_FACT_REFERENCE"
        | "AMBIGUOUS_MODEL_FACT_REFERENCE"
        | "MODEL_FACT_REFERENCE_CONTEXT_MISMATCH";
    };

function compareRepository(
  left: GroundedFactPack["repository"],
  right: GroundedFactPack["repository"],
): boolean {
  return (
    left.url === right.url &&
    left.owner === right.owner &&
    left.name === right.name
  );
}

function authoritativeModelRef(index: number): string {
  return `fact_${String(index + 1).padStart(3, "0")}`;
}

function frozenSourceRef(index: number): string {
  return `F${String(index + 1).padStart(3, "0")}`;
}

function assertOneToOne(entries: readonly ModelFactReferenceEntry[]): void {
  const dimensions = [
    entries.map((entry) => entry.model_ref),
    entries.map((entry) => entry.frozen_source_ref),
    entries.map((entry) => entry.canonical_fact_id),
  ];
  if (dimensions.some((values) => new Set(values).size !== values.length)) {
    throw new Error("AMBIGUOUS_MODEL_FACT_REFERENCE");
  }
}

function assertFlatOneToOne(
  entries: readonly FlatModelFactReferenceEntry[],
): void {
  const dimensions = [
    entries.map((entry) => entry.model_ref),
    entries.map((entry) => entry.canonical_fact_id),
  ];
  if (dimensions.some((values) => new Set(values).size !== values.length)) {
    throw new Error("AMBIGUOUS_MODEL_FACT_REFERENCE");
  }
}

export function buildFlatModelFactReferenceMap(
  input: DeterministicContentAngleInput,
): FlatModelFactReferenceMap {
  if (input.content_angle_input_version !== 1) {
    throw new Error("MODEL_FACT_REFERENCE_INPUT_BINDING_MISMATCH");
  }
  const entries = input.facts_by_category
    .flatMap((group) => group.facts)
    .map((fact, index) => ({
      model_ref: authoritativeModelRef(index),
      canonical_fact_id: fact.fact_id,
      repository: { ...input.repository },
      commit: input.commit,
      fact_ir_version: input.fact_ir_version,
    }));
  assertFlatOneToOne(entries);

  return {
    model_fact_reference_map_version: MODEL_FACT_REFERENCE_MAP_VERSION,
    source_input: "FLAT_V1",
    source_content_angle_input_version: input.content_angle_input_version,
    repository: { ...input.repository },
    commit: input.commit,
    fact_ir_version: input.fact_ir_version,
    authoritative_model_ref_format:
      "fact_{three-digit one-based flat fact position}",
    entries,
  };
}

export function buildModelFactReferenceMap(
  input: CanonicalEditorialAngleInputV2,
): ModelFactReferenceMap {
  const entries = input.facts.groups.flatMap((group) =>
    group.items.map((item) => ({
      frozen_source_ref: item[0],
      canonical_fact_id: item[1],
    })),
  ).map((item, index) => ({
    model_ref: authoritativeModelRef(index),
    frozen_source_ref: item.frozen_source_ref,
    canonical_fact_id: item.canonical_fact_id,
    repository: { ...input.repository },
    commit: input.commit,
    fact_ir_version: input.fact_ir_version,
  }));
  if (
    entries.some(
      (entry, index) => entry.frozen_source_ref !== frozenSourceRef(index),
    )
  ) {
    throw new Error("MODEL_FACT_REFERENCE_INPUT_BINDING_MISMATCH");
  }
  assertOneToOne(entries);

  return {
    model_fact_reference_map_version: MODEL_FACT_REFERENCE_MAP_VERSION,
    repository: { ...input.repository },
    commit: input.commit,
    fact_ir_version: input.fact_ir_version,
    source_editorial_angle_input_version: input.input_version,
    authoritative_model_ref_format:
      "fact_{three-digit one-based frozen fact position}",
    frozen_source_ref_format:
      "F{three-digit one-based canonical fact position}",
    entries,
  };
}

function assertMapMatchesInput(
  input: CanonicalEditorialAngleInputV2,
  map: ModelFactReferenceMap,
): void {
  if (
    !compareRepository(input.repository, map.repository) ||
    input.commit !== map.commit ||
    input.fact_ir_version !== map.fact_ir_version
  ) {
    throw new Error("MODEL_FACT_REFERENCE_CONTEXT_MISMATCH");
  }
  assertOneToOne(map.entries);
  const sourceFacts = input.facts.groups.flatMap((group) => group.items);
  if (
    sourceFacts.length !== map.entries.length ||
    sourceFacts.some((item, index) => {
      const entry = map.entries[index];
      return (
        entry === undefined ||
        entry.model_ref !== authoritativeModelRef(index) ||
        entry.frozen_source_ref !== item[0] ||
        entry.canonical_fact_id !== item[1] ||
        !compareRepository(entry.repository, input.repository) ||
        entry.commit !== input.commit ||
        entry.fact_ir_version !== input.fact_ir_version
      );
    })
  ) {
    throw new Error("MODEL_FACT_REFERENCE_INPUT_BINDING_MISMATCH");
  }
}

export function buildFutureEditorialAngleModelProjection(
  input: CanonicalEditorialAngleInputV2,
  map: ModelFactReferenceMap,
): FutureEditorialAngleModelProjection {
  assertMapMatchesInput(input, map);
  const byFrozenSourceRef = new Map(
    map.entries.map((entry) => [entry.frozen_source_ref, entry]),
  );
  const byCanonicalFactId = new Map(
    map.entries.map((entry) => [entry.canonical_fact_id, entry]),
  );
  const modelRefForSource = (sourceRef: string): string => {
    const entry = byFrozenSourceRef.get(sourceRef);
    if (entry === undefined) {
      throw new Error("MODEL_FACT_REFERENCE_PROJECTION_GAP");
    }
    return entry.model_ref;
  };
  const modelRefForCanonical = (canonicalFactId: string): string => {
    const entry = byCanonicalFactId.get(canonicalFactId);
    if (entry === undefined) {
      throw new Error("MODEL_FACT_REFERENCE_PROJECTION_GAP");
    }
    return entry.model_ref;
  };

  return {
    model_projection_version: 1,
    repository: { ...input.repository },
    commit: input.commit,
    fact_ir_version: input.fact_ir_version,
    canonical_brief_version: input.canonical_brief_version,
    truth_boundary: input.truth_boundary,
    reference_contract: {
      authoritative_fact_input_field: "model_fact_ref",
      authoritative_fact_output_field: "supporting_model_fact_refs",
      fact_reference_namespace: "fact_*",
      known_unknown_reference_namespace: "gap_*",
      canonical_fact_ids_model_visible: false,
      frozen_source_refs_model_visible: false,
      host_resolution_required_before_truth_gate: true,
    },
    input_scope: input.input_scope,
    canonical_brief: {
      fields: ["statement_id", "text", "model_fact_refs"],
      items: input.canonical_brief.items.map((item) => [
        item[0],
        item[1],
        item[2].map(modelRefForCanonical),
      ]),
    },
    clusters: {
      fields: [
        "cluster_id",
        "cluster_reason",
        "model_fact_refs",
        "shared_entity_labels",
      ],
      items: input.clusters.items.map((item) => [
        item[0],
        item[1],
        item[2].map(modelRefForSource),
        [...item[3]],
      ]),
      unclustered_model_fact_refs:
        input.clusters.unclustered_fact_refs.map(modelRefForSource),
    },
    facts: {
      groups: input.facts.groups.map((group) => ({
        category: group.category,
        fields: [
          "model_fact_ref",
          "fact_type",
          "subject",
          "predicate",
          "object",
          "scope",
          "limitation_ids",
        ],
        items: group.items.map((item) => [
          modelRefForSource(item[0]),
          item[2],
          item[3],
          item[4],
          item[5],
          item[6],
          [...item[7]],
        ]),
      })),
      limitations: input.facts.limitations,
    },
    known_unknowns: input.known_unknowns,
    limitations: input.limitations,
    editorial_task_contract: {
      task: "GROUNDED_CONTENT_ANGLE_DISCOVERY",
      output_contract: "MINIMAL_ANGLE_DECISION_WITH_MODEL_FACT_REFS",
      model_output_fields: [
        "candidate_id",
        "title",
        "angle_type",
        "editorial_thesis",
        "supporting_model_fact_refs",
        "why_interesting",
        "target_audience",
        "editorial_confidence",
      ],
      clusters_organize_truth_without_interpreting_importance: true,
    },
    generation_metadata: input.generation_metadata,
  };
}

export function resolveExactModelFactReference(
  map: ModelFactReferenceMap,
  request: ExactModelFactReferenceRequest,
): ExactModelFactReferenceResolution {
  if (
    !compareRepository(map.repository, request.repository) ||
    map.commit !== request.commit ||
    map.fact_ir_version !== request.fact_ir_version
  ) {
    return {
      status: "REJECTED",
      raw_reference: request.raw_reference,
      resolved_reference: null,
      failure_code: "MODEL_FACT_REFERENCE_CONTEXT_MISMATCH",
    };
  }

  const matches = map.entries.filter((entry) =>
    request.accepted_namespace === "AUTHORITATIVE_MODEL_REF"
      ? entry.model_ref === request.raw_reference
      : entry.frozen_source_ref === request.raw_reference,
  );
  if (matches.length === 0) {
    return {
      status: "REJECTED",
      raw_reference: request.raw_reference,
      resolved_reference: null,
      failure_code: "UNKNOWN_MODEL_FACT_REFERENCE",
    };
  }
  if (matches.length !== 1) {
    return {
      status: "REJECTED",
      raw_reference: request.raw_reference,
      resolved_reference: null,
      failure_code: "AMBIGUOUS_MODEL_FACT_REFERENCE",
    };
  }

  const match = matches[0];
  if (match === undefined) {
    throw new Error("MODEL_FACT_REFERENCE_RESOLUTION_INVARIANT");
  }
  if (
    !compareRepository(match.repository, request.repository) ||
    match.commit !== request.commit ||
    match.fact_ir_version !== request.fact_ir_version
  ) {
    return {
      status: "REJECTED",
      raw_reference: request.raw_reference,
      resolved_reference: null,
      failure_code: "MODEL_FACT_REFERENCE_CONTEXT_MISMATCH",
    };
  }
  return {
    status: "RESOLVED",
    raw_reference: request.raw_reference,
    model_ref: match.model_ref,
    canonical_fact_id: match.canonical_fact_id,
    resolution_reason: "MODEL_REFERENCE_CANONICALIZED",
  };
}
