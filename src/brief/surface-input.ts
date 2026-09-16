import type {
  GroundedEntity,
  GroundedEntityValue,
  GroundedFact,
  GroundedFactPack,
} from "../facts/domain.js";
import type { GroundedBriefPlan } from "./domain.js";

export const GROUNDED_BRIEF_SURFACE_INPUT_VERSION = 1 as const;

export interface GroundedBriefSurfaceFact {
  readonly id: string;
  readonly fact_type: GroundedFact["fact_type"];
  readonly category: GroundedFact["category"];
  readonly subject_ref: string;
  readonly predicate: GroundedFact["predicate"];
  readonly object_ref: string;
  readonly scope: GroundedFact["scope"];
  readonly source_kind: GroundedFact["source_kind"];
  readonly verification: GroundedFact["verification"];
  readonly qualifiers: GroundedFact["qualifiers"];
}

export interface GroundedBriefSurfaceEntity {
  readonly id: string;
  readonly kind: GroundedEntity["kind"];
  readonly display_label: string;
  readonly source_path?: string;
  readonly symbol_name?: string;
  readonly symbol_kind?: NonNullable<GroundedEntity["symbol"]>["kind"];
  readonly field_pointer?: string;
  readonly literal_value?: Exclude<GroundedEntityValue, object>;
}

export interface GroundedBriefSurfaceInput {
  readonly surface_input_version: typeof GROUNDED_BRIEF_SURFACE_INPUT_VERSION;
  readonly repository: GroundedFactPack["repository"];
  readonly commit: string;
  readonly fact_ir_version: GroundedFactPack["fact_ir_version"];
  readonly brief_plan_version: GroundedBriefPlan["brief_plan_version"];
  readonly plan: GroundedBriefSurfacePlan;
  readonly selected_facts: readonly GroundedBriefSurfaceFact[];
  readonly required_entities: readonly GroundedBriefSurfaceEntity[];
  readonly fact_limitations: readonly {
    readonly fact_id: string;
    readonly limitations: readonly string[];
  }[];
  readonly output_constraints: readonly [
    "no_new_fact_ids",
    "no_missing_fact_ids",
    "no_fact_modification",
    "unsupported_areas_are_not_facts",
  ];
}

export interface GroundedBriefSurfacePlan {
  readonly brief_plan_version: GroundedBriefPlan["brief_plan_version"];
  readonly selection_policy_version: GroundedBriefPlan["selection_policy_version"];
  readonly selected_facts: GroundedBriefPlan["selected_facts"];
  readonly coverage: GroundedBriefPlan["coverage"];
  readonly section_plan: GroundedBriefPlan["section_plan"];
  readonly known_gaps: GroundedBriefPlan["known_gaps"];
}

function compactFact(fact: GroundedFact): GroundedBriefSurfaceFact {
  return {
    id: fact.id,
    fact_type: fact.fact_type,
    category: fact.category,
    subject_ref: fact.subject_ref,
    predicate: fact.predicate,
    object_ref: fact.object_ref,
    scope: fact.scope,
    source_kind: fact.source_kind,
    verification: { ...fact.verification },
    qualifiers: fact.qualifiers.map((qualifier) => ({ ...qualifier })),
  };
}

function compactEntity(entity: GroundedEntity): GroundedBriefSurfaceEntity {
  const literalValue =
    typeof entity.value === "object" && entity.value !== null
      ? undefined
      : entity.value;
  return {
    id: entity.id,
    kind: entity.kind,
    display_label: entity.display_label,
    ...(entity.source_path === undefined
      ? {}
      : { source_path: entity.source_path }),
    ...(entity.symbol?.name === undefined
      ? {}
      : { symbol_name: entity.symbol.name }),
    ...(entity.symbol?.kind === undefined
      ? {}
      : { symbol_kind: entity.symbol.kind }),
    ...(entity.field_pointer === undefined
      ? {}
      : { field_pointer: entity.field_pointer }),
    ...(literalValue === undefined ? {} : { literal_value: literalValue }),
  };
}

export function buildGroundedBriefSurfaceInput(
  plan: GroundedBriefPlan,
  pack: GroundedFactPack,
): GroundedBriefSurfaceInput {
  if (
    plan.repository.url !== pack.repository.url ||
    plan.repository.owner !== pack.repository.owner ||
    plan.repository.name !== pack.repository.name ||
    plan.commit !== pack.commit ||
    plan.fact_ir_version !== pack.fact_ir_version
  ) {
    throw new Error("GroundedBrief surface plan and Fact IR identity do not match.");
  }
  const facts = new Map(pack.facts.map((fact) => [fact.id, fact]));
  const entities = new Map(pack.entities.map((entity) => [entity.id, entity]));
  const selectedFacts = plan.selected_facts.map((selected) => {
    const fact = facts.get(selected.fact_id);
    if (fact === undefined) {
      throw new Error(`GroundedBrief surface plan references unknown Fact ${selected.fact_id}.`);
    }
    return fact;
  });
  const requiredEntityIds: string[] = [];
  const seenEntityIds = new Set<string>();
  for (const fact of selectedFacts) {
    for (const entityId of [fact.subject_ref, fact.object_ref]) {
      if (!seenEntityIds.has(entityId)) {
        requiredEntityIds.push(entityId);
        seenEntityIds.add(entityId);
      }
    }
  }

  return {
    surface_input_version: GROUNDED_BRIEF_SURFACE_INPUT_VERSION,
    repository: { ...pack.repository },
    commit: pack.commit,
    fact_ir_version: pack.fact_ir_version,
    brief_plan_version: plan.brief_plan_version,
    plan: {
      brief_plan_version: plan.brief_plan_version,
      selection_policy_version: plan.selection_policy_version,
      selected_facts: plan.selected_facts.map((item) => ({
        ...item,
        selection_reasons: [...item.selection_reasons],
      })),
      coverage: plan.coverage.map((item) => ({
        ...item,
        fact_ids: [...item.fact_ids],
      })),
      section_plan: plan.section_plan.map((section) => ({
        ...section,
        fact_ids: [...section.fact_ids],
        known_gap_ids: [...section.known_gap_ids],
      })),
      known_gaps: plan.known_gaps.map((gap) => ({ ...gap })),
    },
    selected_facts: selectedFacts.map(compactFact),
    required_entities: requiredEntityIds.map((entityId) => {
      const entity = entities.get(entityId);
      if (entity === undefined) {
        throw new Error(`Selected Fact references unknown entity ${entityId}.`);
      }
      return compactEntity(entity);
    }),
    fact_limitations: selectedFacts.map((fact) => ({
      fact_id: fact.id,
      limitations: [...fact.limitations],
    })),
    output_constraints: [
      "no_new_fact_ids",
      "no_missing_fact_ids",
      "no_fact_modification",
      "unsupported_areas_are_not_facts",
    ],
  };
}
