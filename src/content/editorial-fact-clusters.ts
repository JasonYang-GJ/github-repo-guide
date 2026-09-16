import type {
  GroundedFact,
  GroundedFactCategory,
  GroundedFactPack,
  GroundedFactPredicate,
} from "../facts/domain.js";

export const EDITORIAL_FACT_CLUSTER_SET_VERSION = 1 as const;

export interface EditorialFactRelationPath {
  readonly fact_id: string;
  readonly from_entity_ref: string;
  readonly predicate: GroundedFactPredicate;
  readonly to_entity_ref: string;
}

export interface EditorialFactCluster {
  readonly cluster_id: string;
  readonly fact_ids: readonly string[];
  readonly shared_entities: readonly {
    readonly entity_ref: string;
    readonly label: string;
  }[];
  readonly relation_paths: readonly EditorialFactRelationPath[];
  readonly fact_categories: readonly GroundedFactCategory[];
  readonly cluster_reason:
    | "RELATION_COMPONENT"
    | "SOURCE_DIRECTORY_TYPE_FAMILY"
    | "SUBJECT_BEHAVIOR_FAMILY";
}

export interface EditorialFactClusterSet {
  readonly editorial_fact_cluster_set_version: typeof EDITORIAL_FACT_CLUSTER_SET_VERSION;
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: GroundedFactPack["fact_ir_version"];
  readonly source_fact_count: number;
  readonly clusters: readonly EditorialFactCluster[];
  readonly unclustered_fact_ids: readonly string[];
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

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function selectFacts(
  pack: GroundedFactPack,
  selectedFactIds?: readonly string[],
): readonly GroundedFact[] {
  const factsById = new Map(pack.facts.map((fact) => [fact.id, fact]));

  if (selectedFactIds === undefined) {
    return [...pack.facts].sort((left, right) => compareText(left.id, right.id));
  }

  if (selectedFactIds.length === 0) {
    throw new Error("EDITORIAL_FACT_CLUSTER_EMPTY_SELECTION");
  }

  if (new Set(selectedFactIds).size !== selectedFactIds.length) {
    throw new Error("EDITORIAL_FACT_CLUSTER_DUPLICATE_FACT_ID");
  }

  return [...selectedFactIds]
    .sort(compareText)
    .map((factId) => {
      const fact = factsById.get(factId);
      if (fact === undefined) {
        throw new Error("EDITORIAL_FACT_CLUSTER_UNKNOWN_FACT_ID");
      }
      return fact;
    });
}

function relationComponents(
  relationFacts: readonly GroundedFact[],
): readonly (readonly GroundedFact[])[] {
  const factsByEntity = new Map<string, GroundedFact[]>();
  for (const fact of relationFacts) {
    for (const entityRef of new Set([fact.subject_ref, fact.object_ref])) {
      const relatedFacts = factsByEntity.get(entityRef) ?? [];
      relatedFacts.push(fact);
      factsByEntity.set(entityRef, relatedFacts);
    }
  }

  const visited = new Set<string>();
  const components: GroundedFact[][] = [];
  for (const startingFact of relationFacts) {
    if (visited.has(startingFact.id)) {
      continue;
    }

    const component: GroundedFact[] = [];
    const pending = [startingFact];
    visited.add(startingFact.id);
    while (pending.length > 0) {
      const fact = pending.shift();
      if (fact === undefined) {
        continue;
      }
      component.push(fact);

      for (const entityRef of new Set([fact.subject_ref, fact.object_ref])) {
        for (const relatedFact of factsByEntity.get(entityRef) ?? []) {
          if (!visited.has(relatedFact.id)) {
            visited.add(relatedFact.id);
            pending.push(relatedFact);
          }
        }
      }
    }

    if (component.length >= 2) {
      components.push(component.sort((left, right) => compareText(left.id, right.id)));
    }
  }

  return components.sort((left, right) =>
    compareText(
      left.map((fact) => fact.id).join("\u0000"),
      right.map((fact) => fact.id).join("\u0000"),
    ),
  );
}

interface ClusterDraft {
  readonly facts: readonly GroundedFact[];
  readonly reason: EditorialFactCluster["cluster_reason"];
}

function groupedFactFamilies(
  facts: readonly GroundedFact[],
  keyForFact: (fact: GroundedFact) => string | undefined,
  reason: EditorialFactCluster["cluster_reason"],
): readonly ClusterDraft[] {
  const factsByKey = new Map<string, GroundedFact[]>();
  for (const fact of facts) {
    const key = keyForFact(fact);
    if (key === undefined) {
      continue;
    }
    const family = factsByKey.get(key) ?? [];
    family.push(fact);
    factsByKey.set(key, family);
  }

  return [...factsByKey.values()]
    .filter((family) => family.length >= 2)
    .map((family) => ({
      facts: family.sort((left, right) => compareText(left.id, right.id)),
      reason,
    }));
}

function sourceDirectory(sourcePath: string | undefined): string | undefined {
  if (sourcePath === undefined) {
    return undefined;
  }
  const normalized = sourcePath.replaceAll("\\", "/");
  const separatorIndex = normalized.lastIndexOf("/");
  return separatorIndex < 0 ? "." : normalized.slice(0, separatorIndex);
}

export function buildEditorialFactClusters(
  pack: GroundedFactPack,
  selectedFactIds?: readonly string[],
): EditorialFactClusterSet {
  const selectedFacts = selectFacts(pack, selectedFactIds);
  const relationFacts = selectedFacts.filter((fact) => fact.category === "RELATION");
  const entitiesById = new Map(pack.entities.map((entity) => [entity.id, entity]));
  const clusteredFactIds = new Set<string>();

  const drafts: ClusterDraft[] = [
    ...relationComponents(relationFacts).map((facts) => ({
      facts,
      reason: "RELATION_COMPONENT" as const,
    })),
    ...groupedFactFamilies(
      selectedFacts.filter((fact) => fact.category === "TYPE"),
      (fact) => sourceDirectory(entitiesById.get(fact.subject_ref)?.source_path),
      "SOURCE_DIRECTORY_TYPE_FAMILY",
    ),
    ...groupedFactFamilies(
      selectedFacts.filter((fact) => fact.category === "BEHAVIORAL"),
      (fact) => fact.subject_ref,
      "SUBJECT_BEHAVIOR_FAMILY",
    ),
  ];
  drafts.sort((left, right) => {
    const reasonOrder = compareText(left.reason, right.reason);
    if (reasonOrder !== 0) {
      return reasonOrder;
    }
    return compareText(
      left.facts.map((fact) => fact.id).join("\u0000"),
      right.facts.map((fact) => fact.id).join("\u0000"),
    );
  });

  const clusters = drafts.map((draft, index) => {
    const component = draft.facts;
    const entityUseCounts = new Map<string, number>();
    for (const fact of component) {
      for (const entityRef of new Set([fact.subject_ref, fact.object_ref])) {
        entityUseCounts.set(entityRef, (entityUseCounts.get(entityRef) ?? 0) + 1);
      }
      clusteredFactIds.add(fact.id);
    }

    const sharedEntities = [...entityUseCounts.entries()]
      .filter(([, count]) => count >= 2)
      .map(([entityRef]) => ({
        entity_ref: entityRef,
        label: entitiesById.get(entityRef)?.display_label ?? entityRef,
      }))
      .sort((left, right) => compareText(left.entity_ref, right.entity_ref));

    return {
      cluster_id: `cluster_${String(index + 1).padStart(3, "0")}`,
      fact_ids: component.map((fact) => fact.id),
      shared_entities: sharedEntities,
      relation_paths: component.map((fact) => ({
        fact_id: fact.id,
        from_entity_ref: fact.subject_ref,
        predicate: fact.predicate,
        to_entity_ref: fact.object_ref,
      })),
      fact_categories: [...new Set(component.map((fact) => fact.category))].sort(compareText),
      cluster_reason: draft.reason,
    };
  });

  return {
    editorial_fact_cluster_set_version: EDITORIAL_FACT_CLUSTER_SET_VERSION,
    repository: pack.repository,
    commit: pack.commit,
    fact_ir_version: pack.fact_ir_version,
    source_fact_count: selectedFacts.length,
    clusters,
    unclustered_fact_ids: selectedFacts
      .map((fact) => fact.id)
      .filter((factId) => !clusteredFactIds.has(factId))
      .sort(compareText),
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
