import type { CanonicalGroundedBriefArtifact } from "../brief/canonical.js";
import type {
  GroundedFactCategory,
  GroundedFactPack,
} from "../facts/domain.js";
import {
  buildDeterministicContentAngleInput,
  type ContentAngleInputSelection,
  type DeterministicContentAngleInput,
} from "./angle-contract.js";
import {
  buildCompactContentAngleRoutingModelInput,
  type CompactContentAngleRoutingModelInput,
} from "./angle-routing.js";
import {
  buildEditorialFactClusters,
  type EditorialFactCluster,
} from "./editorial-fact-clusters.js";

export const EDITORIAL_ANGLE_INPUT_VERSION = 2 as const;
export const EDITORIAL_TASK_CONTRACT_VERSION = 1 as const;

type CompactFactItem = CompactContentAngleRoutingModelInput["fact_groups"][number]["items"][number];

export interface EditorialAngleInputV2 {
  readonly editorial_angle_input_version: typeof EDITORIAL_ANGLE_INPUT_VERSION;
  readonly source_content_angle_input_version: 1;
  readonly source_compact_input_contract_version: 3;
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: GroundedFactPack["fact_ir_version"];
  readonly canonical_grounded_brief_version: CanonicalGroundedBriefArtifact["canonical_grounded_brief_version"];
  readonly truth_boundary: CompactContentAngleRoutingModelInput["truth_boundary"];
  readonly organization_contract: {
    readonly fact_ref_format: "F{three-digit one-based canonical fact position}";
    readonly fact_refs_resolve_only_to_existing_fact_ids: true;
    readonly cluster_membership_is_not_new_truth: true;
    readonly clusters_do_not_rank_select_or_frame: true;
    readonly facts_remain_canonical_truth_anchors: true;
  };
  readonly input_scope: {
    readonly selection_policy:
      | "ALL_FACTS_SMALL_REPOSITORY"
      | "EXPLICIT_BOUNDED_SELECTION";
    readonly selected_fact_count: number;
    readonly total_fact_count: number;
    readonly future_large_repository_policy: "BOUNDED_SELECTION_REQUIRED";
  };
  readonly canonical_brief: CompactContentAngleRoutingModelInput["canonical_brief"];
  readonly fact_groups: readonly {
    readonly category: GroundedFactCategory;
    readonly fields: readonly [
      "fact_ref",
      "fact_id",
      "fact_type",
      "subject",
      "predicate",
      "object",
      "scope",
      "limitation_ids",
    ];
    readonly items: readonly (readonly [string, ...CompactFactItem])[];
  }[];
  readonly fact_clusters: {
    readonly fields: readonly [
      "cluster_id",
      "cluster_reason",
      "fact_refs",
      "shared_entity_labels",
    ];
    readonly items: readonly (readonly [
      string,
      EditorialFactCluster["cluster_reason"],
      readonly string[],
      readonly string[],
    ])[];
    readonly unclustered_fact_refs: readonly string[];
  };
  readonly fact_limitations: CompactContentAngleRoutingModelInput["fact_limitations"];
  readonly known_unknowns: CompactContentAngleRoutingModelInput["known_unknowns"];
  readonly limitations: readonly string[];
  readonly generation_metadata: {
    readonly mode: "deterministic";
    readonly provider: null;
    readonly model: null;
    readonly paid_api_requests: 0;
    readonly real_model_requests: 0;
    readonly secret_reads: 0;
    readonly repository_executions: 0;
  };
}

export interface CanonicalEditorialAngleInputV2 {
  readonly input_version: typeof EDITORIAL_ANGLE_INPUT_VERSION;
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: GroundedFactPack["fact_ir_version"];
  readonly canonical_brief_version: CanonicalGroundedBriefArtifact["canonical_grounded_brief_version"];
  readonly source_contracts: {
    readonly content_angle_input_version: 1;
    readonly compact_input_contract_version: 3;
    readonly editorial_angle_input_candidate_version: 2;
  };
  readonly truth_boundary: EditorialAngleInputV2["truth_boundary"];
  readonly organization_contract: EditorialAngleInputV2["organization_contract"] & {
    readonly cluster_naming_policy: "NEUTRAL_SEQUENTIAL_ID";
    readonly cluster_ordering_policy: "CLUSTER_REASON_ASC_THEN_FACT_ID_SEQUENCE_ASC";
    readonly relationship_summary_boundary: "STRUCTURAL_REFERENCES_ONLY_NO_FREE_TEXT_SYNTHESIS";
    readonly free_text_relationship_summaries_present: false;
  };
  readonly input_scope: EditorialAngleInputV2["input_scope"];
  readonly canonical_brief: EditorialAngleInputV2["canonical_brief"];
  readonly clusters: EditorialAngleInputV2["fact_clusters"];
  readonly facts: {
    readonly groups: EditorialAngleInputV2["fact_groups"];
    readonly limitations: EditorialAngleInputV2["fact_limitations"];
  };
  readonly known_unknowns: EditorialAngleInputV2["known_unknowns"];
  readonly limitations: EditorialAngleInputV2["limitations"];
  readonly editorial_task_contract: {
    readonly contract_version: typeof EDITORIAL_TASK_CONTRACT_VERSION;
    readonly task: "GROUNDED_CONTENT_ANGLE_DISCOVERY";
    readonly provider_contract: "GENERIC_MODEL_PROVIDER";
    readonly truth_source: "CANONICAL_FACTS_BRIEF_AND_KNOWN_UNKNOWNS";
    readonly allowed_editorial_actions: readonly ["select", "group", "rank", "frame"];
    readonly prohibited_fact_actions: readonly ["create", "upgrade", "rewrite", "replace"];
    readonly clusters_organize_truth_without_interpreting_importance: true;
    readonly output_contract: "MINIMAL_ANGLE_DECISION_DRAFT_V2";
    readonly candidate_count: { readonly minimum: 0; readonly maximum: 4 };
    readonly supporting_fact_reference_limit: {
      readonly minimum: 1;
      readonly maximum: 8;
      readonly bounded: true;
    };
    readonly model_output_fields: readonly [
      "candidate_id",
      "title",
      "angle_type",
      "editorial_thesis",
      "supporting_fact_ids",
      "why_interesting",
      "target_audience",
      "editorial_confidence",
    ];
    readonly optional_model_output_fields: readonly ["editorial_confidence"];
    readonly host_owned_fields_remain_excluded: true;
  };
  readonly generation_metadata: EditorialAngleInputV2["generation_metadata"];
}

export interface EditorialTruthSetEquivalenceAudit {
  readonly status: "PASS" | "FAIL";
  readonly flat_fact_count: number;
  readonly clustered_fact_count: number;
  readonly fact_ids_only_in_flat: readonly string[];
  readonly fact_ids_only_in_clustered: readonly string[];
  readonly fact_tuple_mismatches: readonly string[];
  readonly cluster_membership_unknown_fact_refs: number;
  readonly human_written_technical_summaries_added: 0 | 1;
}

function factReference(index: number): string {
  return `F${String(index + 1).padStart(3, "0")}`;
}

export function buildEditorialAngleInputV2(
  pack: GroundedFactPack,
  canonical: CanonicalGroundedBriefArtifact,
  selection: ContentAngleInputSelection = {},
): EditorialAngleInputV2 {
  const deterministicInput = buildDeterministicContentAngleInput(
    pack,
    canonical,
    selection,
  );
  const compactInput = buildCompactContentAngleRoutingModelInput(deterministicInput);
  const orderedFactIds = compactInput.fact_groups.flatMap((group) =>
    group.items.map((item) => item[0]),
  );
  const factRefById = new Map(
    orderedFactIds.map((factId, index) => [factId, factReference(index)]),
  );
  const clusterSet = buildEditorialFactClusters(pack, orderedFactIds);
  const resolveFactRef = (factId: string): string => {
    const factRef = factRefById.get(factId);
    if (factRef === undefined) {
      throw new Error("EDITORIAL_ANGLE_INPUT_CLUSTER_FACT_REFERENCE_MISMATCH");
    }
    return factRef;
  };

  let globalFactIndex = 0;
  const factGroups = compactInput.fact_groups.map((group) => ({
    category: group.category,
    fields: [
      "fact_ref",
      "fact_id",
      "fact_type",
      "subject",
      "predicate",
      "object",
      "scope",
      "limitation_ids",
    ] as const,
    items: group.items.map((item) => {
      const factRef = factReference(globalFactIndex);
      globalFactIndex += 1;
      return [factRef, ...item] as const;
    }),
  }));

  return {
    editorial_angle_input_version: EDITORIAL_ANGLE_INPUT_VERSION,
    source_content_angle_input_version: deterministicInput.content_angle_input_version,
    source_compact_input_contract_version: compactInput.input_contract_version,
    repository: compactInput.repository,
    commit: compactInput.commit,
    fact_ir_version: compactInput.fact_ir_version,
    canonical_grounded_brief_version:
      compactInput.canonical_grounded_brief_version,
    truth_boundary: compactInput.truth_boundary,
    organization_contract: {
      fact_ref_format: "F{three-digit one-based canonical fact position}",
      fact_refs_resolve_only_to_existing_fact_ids: true,
      cluster_membership_is_not_new_truth: true,
      clusters_do_not_rank_select_or_frame: true,
      facts_remain_canonical_truth_anchors: true,
    },
    input_scope: deterministicInput.input_scope,
    canonical_brief: compactInput.canonical_brief,
    fact_groups: factGroups,
    fact_clusters: {
      fields: [
        "cluster_id",
        "cluster_reason",
        "fact_refs",
        "shared_entity_labels",
      ],
      items: clusterSet.clusters.map((cluster) => [
        cluster.cluster_id,
        cluster.cluster_reason,
        cluster.fact_ids.map(resolveFactRef),
        cluster.shared_entities.map((entity) => entity.label),
      ]),
      unclustered_fact_refs: clusterSet.unclustered_fact_ids.map(resolveFactRef),
    },
    fact_limitations: compactInput.fact_limitations,
    known_unknowns: compactInput.known_unknowns,
    limitations: compactInput.limitations,
    generation_metadata: {
      mode: "deterministic",
      provider: null,
      model: null,
      paid_api_requests: 0,
      real_model_requests: 0,
      secret_reads: 0,
      repository_executions: 0,
    },
  };
}

export function freezeEditorialAngleInputV2(
  pack: GroundedFactPack,
  canonical: CanonicalGroundedBriefArtifact,
  selection: ContentAngleInputSelection = {},
): CanonicalEditorialAngleInputV2 {
  const candidate = buildEditorialAngleInputV2(pack, canonical, selection);

  return {
    input_version: EDITORIAL_ANGLE_INPUT_VERSION,
    repository: candidate.repository,
    commit: candidate.commit,
    fact_ir_version: candidate.fact_ir_version,
    canonical_brief_version: candidate.canonical_grounded_brief_version,
    source_contracts: {
      content_angle_input_version: candidate.source_content_angle_input_version,
      compact_input_contract_version: candidate.source_compact_input_contract_version,
      editorial_angle_input_candidate_version:
        candidate.editorial_angle_input_version,
    },
    truth_boundary: candidate.truth_boundary,
    organization_contract: {
      ...candidate.organization_contract,
      cluster_naming_policy: "NEUTRAL_SEQUENTIAL_ID",
      cluster_ordering_policy:
        "CLUSTER_REASON_ASC_THEN_FACT_ID_SEQUENCE_ASC",
      relationship_summary_boundary:
        "STRUCTURAL_REFERENCES_ONLY_NO_FREE_TEXT_SYNTHESIS",
      free_text_relationship_summaries_present: false,
    },
    input_scope: candidate.input_scope,
    canonical_brief: candidate.canonical_brief,
    clusters: candidate.fact_clusters,
    facts: {
      groups: candidate.fact_groups,
      limitations: candidate.fact_limitations,
    },
    known_unknowns: candidate.known_unknowns,
    limitations: candidate.limitations,
    editorial_task_contract: {
      contract_version: EDITORIAL_TASK_CONTRACT_VERSION,
      task: "GROUNDED_CONTENT_ANGLE_DISCOVERY",
      provider_contract: "GENERIC_MODEL_PROVIDER",
      truth_source: "CANONICAL_FACTS_BRIEF_AND_KNOWN_UNKNOWNS",
      allowed_editorial_actions: ["select", "group", "rank", "frame"],
      prohibited_fact_actions: ["create", "upgrade", "rewrite", "replace"],
      clusters_organize_truth_without_interpreting_importance: true,
      output_contract: "MINIMAL_ANGLE_DECISION_DRAFT_V2",
      candidate_count: { minimum: 0, maximum: 4 },
      supporting_fact_reference_limit: {
        minimum: 1,
        maximum: 8,
        bounded: true,
      },
      model_output_fields: [
        "candidate_id",
        "title",
        "angle_type",
        "editorial_thesis",
        "supporting_fact_ids",
        "why_interesting",
        "target_audience",
        "editorial_confidence",
      ],
      optional_model_output_fields: ["editorial_confidence"],
      host_owned_fields_remain_excluded: true,
    },
    generation_metadata: candidate.generation_metadata,
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function auditEditorialTruthSetEquivalence(
  flat: DeterministicContentAngleInput,
  clustered: CanonicalEditorialAngleInputV2,
): EditorialTruthSetEquivalenceAudit {
  const flatTuples = new Map(
    flat.facts_by_category.flatMap((group) =>
      group.facts.map((fact) => [
        fact.fact_id,
        JSON.stringify([
          group.category,
          fact.fact_type,
          fact.subject.label,
          fact.predicate,
          fact.object.label,
          fact.scope,
          fact.limitations,
        ]),
      ] as const),
    ),
  );
  const limitationText = new Map(clustered.facts.limitations.items);
  const clusteredFacts = clustered.facts.groups.flatMap((group) =>
    group.items.map((item) => ({
      factRef: item[0],
      factId: item[1],
      tuple: JSON.stringify([
        group.category,
        item[2],
        item[3],
        item[4],
        item[5],
        item[6],
        item[7].map((limitationId) => limitationText.get(limitationId) ?? null),
      ]),
    })),
  );
  const clusteredTuples = new Map(
    clusteredFacts.map((fact) => [fact.factId, fact.tuple]),
  );
  const flatIds = [...flatTuples.keys()].sort(compareText);
  const clusteredIds = [...clusteredTuples.keys()].sort(compareText);
  const onlyInFlat = flatIds.filter((factId) => !clusteredTuples.has(factId));
  const onlyInClustered = clusteredIds.filter((factId) => !flatTuples.has(factId));
  const tupleMismatches = flatIds.filter(
    (factId) =>
      clusteredTuples.has(factId) &&
      clusteredTuples.get(factId) !== flatTuples.get(factId),
  );
  const knownFactRefs = new Set(clusteredFacts.map((fact) => fact.factRef));
  const unknownClusterFactRefs = clustered.clusters.items
    .flatMap((cluster) => cluster[2])
    .filter((factRef) => !knownFactRefs.has(factRef));
  const humanWrittenTechnicalSummariesAdded = clustered.organization_contract
    .free_text_relationship_summaries_present
    ? 1
    : 0;
  const passed =
    flatTuples.size === flatIds.length &&
    clusteredTuples.size === clusteredFacts.length &&
    onlyInFlat.length === 0 &&
    onlyInClustered.length === 0 &&
    tupleMismatches.length === 0 &&
    unknownClusterFactRefs.length === 0 &&
    humanWrittenTechnicalSummariesAdded === 0;

  return {
    status: passed ? "PASS" : "FAIL",
    flat_fact_count: flatIds.length,
    clustered_fact_count: clusteredIds.length,
    fact_ids_only_in_flat: onlyInFlat,
    fact_ids_only_in_clustered: onlyInClustered,
    fact_tuple_mismatches: tupleMismatches,
    cluster_membership_unknown_fact_refs: unknownClusterFactRefs.length,
    human_written_technical_summaries_added: humanWrittenTechnicalSummariesAdded,
  };
}

export function serializeEditorialAngleInputV2(
  input: EditorialAngleInputV2,
): string {
  return `${JSON.stringify(input, null, 2)}\n`;
}

export function serializeCanonicalEditorialAngleInputV2(
  input: CanonicalEditorialAngleInputV2,
): string {
  return `${JSON.stringify(input, null, 2)}\n`;
}

export function renderCanonicalEditorialAngleInputV2Markdown(
  input: CanonicalEditorialAngleInputV2,
): string {
  const factCount = input.facts.groups.reduce(
    (total, group) => total + group.items.length,
    0,
  );
  const lines = [
    "# EditorialAngleInput v2",
    "",
    "Status: FROZEN_CANONICAL_EDITORIAL_INPUT",
    `Repository: ${input.repository.url}`,
    `Commit: ${input.commit}`,
    `Fact IR Version: ${input.fact_ir_version}`,
    `Canonical Brief Version: ${input.canonical_brief_version}`,
    `Facts: ${factCount}`,
    `Clusters: ${input.clusters.items.length}`,
    `Known Unknowns: ${input.known_unknowns.items.length}`,
    `Cluster Naming Policy: ${input.organization_contract.cluster_naming_policy}`,
    `Cluster Ordering Policy: ${input.organization_contract.cluster_ordering_policy}`,
    `Relationship Summary Boundary: ${input.organization_contract.relationship_summary_boundary}`,
    "",
    "The JSON block below is the lossless canonical input. This Markdown view adds no technical summary or editorial conclusion.",
    "",
    "```json",
    serializeCanonicalEditorialAngleInputV2(input).trimEnd(),
    "```",
    "",
  ];
  return lines.join("\n");
}
