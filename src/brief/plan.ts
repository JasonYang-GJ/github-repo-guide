import type {
  GroundedEntity,
  GroundedFact,
  GroundedFactPack,
} from "../facts/domain.js";
import {
  FACT_SELECTION_POLICY_VERSION,
  GROUNDED_BRIEF_PLAN_VERSION,
  type BriefCoverage,
  type BriefCoverageCategory,
  type ExcludedBriefFact,
  type FactExclusionReason,
  type FactSelectionReason,
  type GroundedBriefKnownGap,
  type GroundedBriefPlan,
  type GroundedBriefSectionPlan,
  type SelectedBriefFact,
} from "./domain.js";

const COVERAGE_ORDER: readonly BriefCoverageCategory[] = [
  "PACKAGE_SURFACE",
  "CORE_STRUCTURE",
  "CORE_RELATIONS",
  "VERIFIED_BEHAVIOR",
  "TYPE_SURFACE",
  "KNOWN_UNKNOWNS",
];

const REASON_ORDER: readonly FactSelectionReason[] = [
  "BEHAVIORAL_EVIDENCE",
  "PACKAGE_SURFACE",
  "EXPORTED_SURFACE",
  "RELATION_PARTICIPATION",
  "ENTITY_CENTRALITY",
  "CORE_STRUCTURE",
  "TYPE_SURFACE",
  "ENTRY_RELEVANCE",
  "DOCUMENTED_PURPOSE",
];

const SECTION_ORDER = [
  "overview",
  "public_surface",
  "core_structure",
  "structure_relationships",
  "verified_behavior",
  "type_surface",
  "not_proven",
] as const;

const SECTION_DEFINITIONS: Readonly<
  Record<
    (typeof SECTION_ORDER)[number],
    { readonly title: string; readonly purpose: string }
  >
> = {
  overview: {
    title: "Overview",
    purpose: "Attribute the package's documented purpose without promoting it to runtime fact.",
  },
  public_surface: {
    title: "Public surface",
    purpose: "Describe package and source export declarations at their exact scopes.",
  },
  core_structure: {
    title: "Core structure",
    purpose: "Identify a small set of central declarations without listing the whole tree.",
  },
  structure_relationships: {
    title: "Structure and relationships",
    purpose: "Describe direct module relationships preserved by Fact IR.",
  },
  verified_behavior: {
    title: "Verified behavior",
    purpose: "Describe only exact local branch behavior and its conditions.",
  },
  type_surface: {
    title: "Type surface",
    purpose: "Describe selected type declarations without inferring runtime correspondence.",
  },
  not_proven: {
    title: "What is not proven",
    purpose: "Preserve known unknowns as evidence gaps rather than negative facts.",
  },
};

const BASE_SCORE: Readonly<Record<GroundedFact["fact_type"], number>> = {
  BRANCH_BEHAVIOR: 100,
  EXPORT: 82,
  CONFIGURATION: 80,
  CALL_RELATION: 79,
  IMPORT_RELATION: 78,
  DECLARATION: 62,
  TYPE_DECLARATION: 56,
  MODULE_CONTAINS: 12,
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function entityMap(pack: GroundedFactPack): ReadonlyMap<string, GroundedEntity> {
  return new Map(pack.entities.map((entity) => [entity.id, entity]));
}

function isTypeEntity(entity: GroundedEntity | undefined): boolean {
  return ["type", "interface"].includes(entity?.symbol?.kind ?? "");
}

function sourcePathFor(
  fact: GroundedFact,
  entities: ReadonlyMap<string, GroundedEntity>,
): string | undefined {
  return (
    entities.get(fact.subject_ref)?.source_path ??
    entities.get(fact.object_ref)?.source_path
  );
}

function descriptionFact(
  fact: GroundedFact,
  entities: ReadonlyMap<string, GroundedEntity>,
): boolean {
  return (
    fact.fact_type === "CONFIGURATION" &&
    entities.get(fact.object_ref)?.field_pointer === "/description"
  );
}

function referenceCounts(pack: GroundedFactPack): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const fact of pack.facts) {
    counts.set(fact.subject_ref, (counts.get(fact.subject_ref) ?? 0) + 1);
    counts.set(fact.object_ref, (counts.get(fact.object_ref) ?? 0) + 1);
  }
  return counts;
}

function runtimeEntryModules(
  pack: GroundedFactPack,
  entities: ReadonlyMap<string, GroundedEntity>,
): ReadonlySet<string> {
  const counts = new Map<string, number>();
  for (const fact of pack.facts) {
    if (
      fact.fact_type !== "EXPORT" ||
      fact.scope !== "MODULE" ||
      isTypeEntity(entities.get(fact.object_ref))
    ) {
      continue;
    }
    const subject = entities.get(fact.subject_ref);
    if (!(subject?.source_path ?? "").startsWith("src/")) continue;
    counts.set(fact.subject_ref, (counts.get(fact.subject_ref) ?? 0) + 1);
  }
  const maximum = Math.max(0, ...counts.values());
  return new Set(
    [...counts.entries()]
      .filter(([, count]) => count === maximum && maximum > 0)
      .map(([id]) => id),
  );
}

interface FactContext {
  readonly entities: ReadonlyMap<string, GroundedEntity>;
  readonly counts: ReadonlyMap<string, number>;
  readonly exportedObjects: ReadonlySet<string>;
  readonly relationEntities: ReadonlySet<string>;
  readonly behaviorSubjects: ReadonlySet<string>;
  readonly entryModules: ReadonlySet<string>;
}

function factContext(pack: GroundedFactPack): FactContext {
  const entities = entityMap(pack);
  const relationFacts = pack.facts.filter(
    (fact) => fact.fact_type === "IMPORT_RELATION",
  );
  return {
    entities,
    counts: referenceCounts(pack),
    exportedObjects: new Set(
      pack.facts
        .filter((fact) => fact.fact_type === "EXPORT")
        .map((fact) => fact.object_ref),
    ),
    relationEntities: new Set(
      relationFacts.flatMap((fact) => [fact.subject_ref, fact.object_ref]),
    ),
    behaviorSubjects: new Set(
      pack.facts
        .filter((fact) => fact.fact_type === "BRANCH_BEHAVIOR")
        .map((fact) => fact.subject_ref),
    ),
    entryModules: runtimeEntryModules(pack, entities),
  };
}

function factScore(fact: GroundedFact, context: FactContext): number {
  let score = BASE_SCORE[fact.fact_type];
  score += Math.min(context.counts.get(fact.subject_ref) ?? 0, 5) * 2;
  score += Math.min(context.counts.get(fact.object_ref) ?? 0, 5) * 2;
  if (fact.scope === "PACKAGE") score += 12;
  if (context.exportedObjects.has(fact.object_ref)) score += 10;
  if (
    context.relationEntities.has(fact.subject_ref) ||
    context.relationEntities.has(fact.object_ref)
  ) {
    score += 8;
  }
  if (context.behaviorSubjects.has(fact.subject_ref)) score += 12;
  if (context.entryModules.has(fact.subject_ref)) score += 10;
  if (descriptionFact(fact, context.entities)) score += 16;
  return score;
}

function selectionReasons(
  fact: GroundedFact,
  context: FactContext,
): readonly FactSelectionReason[] {
  const reasons = new Set<FactSelectionReason>();
  if (fact.fact_type === "BRANCH_BEHAVIOR") reasons.add("BEHAVIORAL_EVIDENCE");
  if (fact.scope === "PACKAGE" || fact.fact_type === "CONFIGURATION") {
    reasons.add("PACKAGE_SURFACE");
  }
  if (fact.fact_type === "EXPORT") reasons.add("EXPORTED_SURFACE");
  if (fact.fact_type === "IMPORT_RELATION") reasons.add("RELATION_PARTICIPATION");
  if (
    (context.counts.get(fact.subject_ref) ?? 0) >= 3 ||
    (context.counts.get(fact.object_ref) ?? 0) >= 3
  ) {
    reasons.add("ENTITY_CENTRALITY");
  }
  if (["DECLARATION", "MODULE_CONTAINS"].includes(fact.fact_type)) {
    reasons.add("CORE_STRUCTURE");
  }
  if (fact.fact_type === "TYPE_DECLARATION") reasons.add("TYPE_SURFACE");
  if (context.entryModules.has(fact.subject_ref) || fact.scope === "PACKAGE") {
    reasons.add("ENTRY_RELEVANCE");
  }
  if (descriptionFact(fact, context.entities)) reasons.add("DOCUMENTED_PURPOSE");
  return REASON_ORDER.filter((reason) => reasons.has(reason));
}

function ranked(
  facts: readonly GroundedFact[],
  context: FactContext,
): readonly GroundedFact[] {
  return [...facts].sort(
    (left, right) =>
      factScore(right, context) - factScore(left, context) ||
      compareText(left.id, right.id),
  );
}

function sectionFor(
  fact: GroundedFact,
  entities: ReadonlyMap<string, GroundedEntity>,
): (typeof SECTION_ORDER)[number] {
  if (descriptionFact(fact, entities)) return "overview";
  if (["EXPORT", "CONFIGURATION"].includes(fact.fact_type)) {
    return "public_surface";
  }
  if (fact.fact_type === "DECLARATION") return "core_structure";
  if (fact.fact_type === "IMPORT_RELATION") return "structure_relationships";
  if (fact.fact_type === "BRANCH_BEHAVIOR") return "verified_behavior";
  if (fact.fact_type === "TYPE_DECLARATION") return "type_surface";
  return "core_structure";
}

function addTop(
  selected: Map<string, GroundedFact>,
  facts: readonly GroundedFact[],
  limit: number,
  context: FactContext,
): void {
  for (const fact of ranked(facts, context).slice(0, limit)) {
    selected.set(fact.id, fact);
  }
}

function selectFacts(
  pack: GroundedFactPack,
  context: FactContext,
): ReadonlyMap<string, GroundedFact> {
  const selected = new Map<string, GroundedFact>();
  addTop(
    selected,
    pack.facts.filter((fact) => fact.fact_type === "CONFIGURATION"),
    2,
    context,
  );
  addTop(
    selected,
    pack.facts.filter(
      (fact) => fact.fact_type === "EXPORT" && fact.scope === "PACKAGE",
    ),
    2,
    context,
  );
  addTop(
    selected,
    pack.facts.filter(
      (fact) =>
        fact.fact_type === "EXPORT" &&
        fact.scope === "MODULE" &&
        !isTypeEntity(context.entities.get(fact.object_ref)),
    ),
    4,
    context,
  );
  addTop(
    selected,
    pack.facts.filter((fact) => fact.fact_type === "BRANCH_BEHAVIOR"),
    4,
    context,
  );
  addTop(
    selected,
    pack.facts.filter((fact) => fact.fact_type === "IMPORT_RELATION"),
    4,
    context,
  );

  const selectedObjectRefs = new Set(
    [...selected.values()].map((fact) => fact.object_ref),
  );
  addTop(
    selected,
    pack.facts.filter(
      (fact) =>
        fact.fact_type === "DECLARATION" &&
        !selectedObjectRefs.has(fact.object_ref),
    ),
    3,
    context,
  );
  if (
    selected.size < 20 &&
    ![...selected.values()].some((fact) =>
      ["DECLARATION", "MODULE_CONTAINS"].includes(fact.fact_type),
    )
  ) {
    addTop(
      selected,
      pack.facts.filter((fact) => fact.fact_type === "MODULE_CONTAINS"),
      1,
      context,
    );
  }
  addTop(
    selected,
    pack.facts.filter((fact) => {
      const path = sourcePathFor(fact, context.entities) ?? "";
      return (
        fact.fact_type === "TYPE_DECLARATION" &&
        !/(?:^|\/)lib\//.test(path) &&
        (/\.schema\.json$/i.test(path) || context.exportedObjects.has(fact.object_ref))
      );
    }),
    3,
    context,
  );
  return selected;
}

function exclusionReason(
  fact: GroundedFact,
  selected: ReadonlyMap<string, GroundedFact>,
  pack: GroundedFactPack,
  context: FactContext,
): { readonly reason: FactExclusionReason; readonly detail: string } {
  const path = sourcePathFor(fact, context.entities) ?? "";
  if (path.startsWith("lib/") && fact.fact_type === "TYPE_DECLARATION") {
    return {
      reason: "OUT_OF_BRIEF_SCOPE",
      detail: "Generated declaration output is omitted while canonical source type facts are available.",
    };
  }
  if (fact.fact_type === "MODULE_CONTAINS") {
    const hasSpecificFact = pack.facts.some(
      (candidate) =>
        candidate.object_ref === fact.object_ref &&
        ["DECLARATION", "TYPE_DECLARATION"].includes(candidate.fact_type),
    );
    return hasSpecificFact
      ? {
          reason: "DUPLICATE",
          detail: "A declaration or type-declaration fact carries more specific information for this entity.",
        }
      : {
          reason: "LOW_INFORMATION",
          detail: "Containment alone adds little explanatory value to the bounded Brief.",
        };
  }
  const sameObjectSelected = [...selected.values()].some(
    (candidate) => candidate.object_ref === fact.object_ref,
  );
  if (
    sameObjectSelected &&
    ["DECLARATION", "TYPE_DECLARATION", "EXPORT"].includes(fact.fact_type)
  ) {
    return {
      reason: "DUPLICATE",
      detail: "Another selected fact already introduces this entity at a more useful surface.",
    };
  }
  if (["DECLARATION", "TYPE_DECLARATION", "EXPORT"].includes(fact.fact_type)) {
    return {
      reason: "LOW_CENTRALITY",
      detail: "The bounded section quota favors more central or entry-relevant entities.",
    };
  }
  return {
    reason: "OUT_OF_BRIEF_SCOPE",
    detail: "The fact is valid but outside the minimum grounded Brief scope.",
  };
}

function coverageFor(
  pack: GroundedFactPack,
  selected: ReadonlyMap<string, GroundedFact>,
): readonly BriefCoverage[] {
  const definitions: Readonly<
    Record<
      Exclude<BriefCoverageCategory, "KNOWN_UNKNOWNS">,
      { readonly matches: (fact: GroundedFact) => boolean; readonly available: string; readonly unavailable: string }
    >
  > = {
    PACKAGE_SURFACE: {
      matches: (fact) => ["EXPORT", "CONFIGURATION"].includes(fact.fact_type),
      available: "Selected package or module surface declarations are available.",
      unavailable: "No package, export, or configuration fact is available.",
    },
    CORE_STRUCTURE: {
      matches: (fact) => ["DECLARATION", "MODULE_CONTAINS"].includes(fact.fact_type),
      available: "Selected central declarations are available.",
      unavailable: "No structural declaration fact is available.",
    },
    CORE_RELATIONS: {
      matches: (fact) => fact.fact_type === "IMPORT_RELATION",
      available: "Direct import relations are available.",
      unavailable: "No direct relation fact is available.",
    },
    VERIFIED_BEHAVIOR: {
      matches: (fact) => fact.fact_type === "BRANCH_BEHAVIOR",
      available: "Exact local branch behavior is available.",
      unavailable: "No deterministic behavior fact is available.",
    },
    TYPE_SURFACE: {
      matches: (fact) => fact.fact_type === "TYPE_DECLARATION",
      available: "Selected source type declarations are available.",
      unavailable: "No type declaration fact is available.",
    },
  };

  return COVERAGE_ORDER.map((category) => {
    if (category === "KNOWN_UNKNOWNS") {
      const available = pack.unsupported_areas.length > 0;
      return {
        category,
        status: available ? "AVAILABLE" : "UNAVAILABLE",
        fact_ids: [],
        note: available
          ? "Fact IR records explicit unsupported areas and required evidence."
          : "Fact IR records no explicit unsupported area.",
      };
    }
    const definition = definitions[category];
    const availableInPack = pack.facts.some(definition.matches);
    const factIds = [...selected.values()]
      .filter(definition.matches)
      .map((fact) => fact.id)
      .sort(compareText);
    return {
      category,
      status: availableInPack && factIds.length > 0 ? "AVAILABLE" : "UNAVAILABLE",
      fact_ids: factIds,
      note:
        availableInPack && factIds.length > 0
          ? definition.available
          : definition.unavailable,
    };
  });
}

function knownGaps(pack: GroundedFactPack): readonly GroundedBriefKnownGap[] {
  return [...pack.unsupported_areas]
    .sort((left, right) => compareText(left.id, right.id))
    .map((area) => ({
      id: `gap_${area.id}`,
      area: area.id,
      reason: area.reason,
      evidence_needed: area.evidence_needed,
      source_unsupported_area_id: area.id,
    }));
}

function sectionPlans(
  selected: readonly SelectedBriefFact[],
  gaps: readonly GroundedBriefKnownGap[],
): readonly GroundedBriefSectionPlan[] {
  return SECTION_ORDER.flatMap((id) => {
    const factIds = selected
      .filter((item) => item.section_id === id)
      .map((item) => item.fact_id);
    const gapIds = id === "not_proven" ? gaps.map((gap) => gap.id) : [];
    if (factIds.length === 0 && gapIds.length === 0) return [];
    return [
      {
        id,
        ...SECTION_DEFINITIONS[id],
        fact_ids: factIds,
        known_gap_ids: gapIds,
      },
    ];
  });
}

export function buildGroundedBriefPlan(
  pack: GroundedFactPack,
): GroundedBriefPlan {
  const context = factContext(pack);
  const selected = selectFacts(pack, context);
  const sectionIndex = new Map(
    SECTION_ORDER.map((section, index) => [section, index]),
  );
  const selectedFacts: SelectedBriefFact[] = [...selected.values()]
    .map((fact) => ({
      fact_id: fact.id,
      priority: 0,
      score: factScore(fact, context),
      section_id: sectionFor(fact, context.entities),
      selection_reasons: selectionReasons(fact, context),
    }))
    .sort(
      (left, right) =>
        (sectionIndex.get(left.section_id) ?? Number.MAX_SAFE_INTEGER) -
          (sectionIndex.get(right.section_id) ?? Number.MAX_SAFE_INTEGER) ||
        right.score - left.score ||
        compareText(left.fact_id, right.fact_id),
    )
    .map((item, index) => ({ ...item, priority: index + 1 }));

  const excludedFacts: ExcludedBriefFact[] = [...pack.facts]
    .filter((fact) => !selected.has(fact.id))
    .sort((left, right) => compareText(left.id, right.id))
    .map((fact) => ({
      fact_id: fact.id,
      ...exclusionReason(fact, selected, pack, context),
    }));
  const gaps = knownGaps(pack);

  return {
    brief_plan_version: GROUNDED_BRIEF_PLAN_VERSION,
    repository: { ...pack.repository },
    commit: pack.commit,
    fact_ir_version: pack.fact_ir_version,
    selection_policy_version: FACT_SELECTION_POLICY_VERSION,
    selected_facts: selectedFacts,
    excluded_facts: excludedFacts,
    coverage: coverageFor(pack, selected),
    section_plan: sectionPlans(selectedFacts, gaps),
    known_gaps: gaps,
  };
}
