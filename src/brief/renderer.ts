import type { GroundedEntity, GroundedFact, GroundedFactPack } from "../facts/domain.js";
import {
  GROUNDED_BRIEF_VERSION,
  type GroundedBrief,
  type GroundedBriefPlan,
  type GroundedBriefStatement,
  type GroundedBriefStatementKind,
} from "./domain.js";

function entityValue(entity: GroundedEntity): string | null {
  if (
    entity.value === null ||
    ["string", "number", "boolean"].includes(typeof entity.value)
  ) {
    return String(entity.value);
  }
  return null;
}

function code(value: string): string {
  return `\`${value.replace(/`/g, "'").replace(/[\r\n]+/g, " ")}\``;
}

function sentenceForFact(
  fact: GroundedFact,
  entities: ReadonlyMap<string, GroundedEntity>,
): { readonly text: string; readonly kind: GroundedBriefStatementKind } {
  const subject = entities.get(fact.subject_ref);
  const object = entities.get(fact.object_ref);
  if (subject === undefined || object === undefined) {
    throw new Error(`Cannot render Fact ${fact.id}: unresolved entity reference.`);
  }

  if (fact.fact_type === "DECLARATION") {
    const symbolKind = object.symbol?.kind ?? "symbol";
    const label = `${symbolKind.slice(0, 1).toUpperCase()}${symbolKind.slice(1)}`;
    return {
      text: `${label} ${code(object.display_label)} is declared in ${code(subject.display_label)}.`,
      kind: "TECHNICAL_FACT",
    };
  }
  if (fact.fact_type === "TYPE_DECLARATION") {
    const label = object.symbol?.kind === "interface" ? "Interface" : "Type";
    return {
      text: `${label} ${code(object.display_label)} is declared in ${code(subject.display_label)}.`,
      kind: "TECHNICAL_FACT",
    };
  }
  if (fact.fact_type === "EXPORT") {
    const value = entityValue(object);
    if (fact.scope === "PACKAGE") {
      return {
        text: `The ${code(subject.display_label)} package exposes export ${code(value ?? object.display_label)}.`,
        kind: "TECHNICAL_FACT",
      };
    }
    return {
      text: `Module ${code(subject.display_label)} exports ${code(object.display_label)}.`,
      kind: "TECHNICAL_FACT",
    };
  }
  if (fact.fact_type === "IMPORT_RELATION") {
    return {
      text: `Module ${code(subject.display_label)} imports ${code(object.display_label)}.`,
      kind: "TECHNICAL_FACT",
    };
  }
  if (fact.fact_type === "BRANCH_BEHAVIOR") {
    const action =
      fact.predicate === "SKIPS_WHEN"
        ? "skips the current key"
        : fact.predicate === "CONCATENATES_WHEN"
          ? "concatenates the two array values"
          : "throws";
    return {
      text: `In ${code(subject.display_label)}, the shown branch ${action} when ${code(object.display_label)}.`,
      kind: "TECHNICAL_FACT",
    };
  }
  if (fact.fact_type === "CONFIGURATION") {
    const value = entityValue(object);
    if (object.field_pointer === "/description" && value !== null) {
      const punctuation = /[.!?]$/.test(value.trim()) ? "" : ".";
      return {
        text: `The ${code(subject.display_label)} package manifest describes itself as “${value}”${punctuation}`,
        kind: "DOCUMENTATION",
      };
    }
    return {
      text: `The ${code(subject.display_label)} package manifest declares ${code(object.field_pointer ?? object.display_label)} as ${code(value ?? object.display_label)}.`,
      kind: "TECHNICAL_FACT",
    };
  }
  return {
    text: `Module ${code(subject.display_label)} contains ${code(object.display_label)}.`,
    kind: "TECHNICAL_FACT",
  };
}

function statementForFact(
  fact: GroundedFact,
  index: number,
  entities: ReadonlyMap<string, GroundedEntity>,
): GroundedBriefStatement {
  const sentence = sentenceForFact(fact, entities);
  return {
    id: `statement_${String(index + 1).padStart(3, "0")}`,
    text: sentence.text,
    kind: sentence.kind,
    scope: fact.scope,
    fact_ids: [fact.id],
    entity_refs: [fact.subject_ref, fact.object_ref],
    assertions: [
      {
        fact_id: fact.id,
        subject_ref: fact.subject_ref,
        predicate: fact.predicate,
        object_ref: fact.object_ref,
      },
    ],
    unknown_ids: [],
    limitations: [...fact.limitations],
  };
}

export function renderDeterministicGroundedBrief(
  plan: GroundedBriefPlan,
  pack: GroundedFactPack,
): GroundedBrief {
  if (
    plan.repository.url !== pack.repository.url ||
    plan.repository.owner !== pack.repository.owner ||
    plan.repository.name !== pack.repository.name ||
    plan.commit !== pack.commit ||
    plan.fact_ir_version !== pack.fact_ir_version
  ) {
    throw new Error("GroundedBrief plan and Fact IR identity do not match.");
  }
  const facts = new Map(pack.facts.map((fact) => [fact.id, fact]));
  const entities = new Map(pack.entities.map((entity) => [entity.id, entity]));
  const statementsByFact = new Map<string, GroundedBriefStatement>();
  for (const [index, selected] of plan.selected_facts.entries()) {
    const fact = facts.get(selected.fact_id);
    if (fact === undefined) {
      throw new Error(`GroundedBrief plan references unknown Fact ${selected.fact_id}.`);
    }
    statementsByFact.set(
      fact.id,
      statementForFact(fact, index, entities),
    );
  }

  const unknowns = plan.known_gaps.map((gap) => ({
    id: gap.id,
    statement: `Not established by this Fact IR: ${gap.reason}`,
    source_gap_ids: [gap.source_unsupported_area_id],
    evidence_needed: gap.evidence_needed,
  }));
  let unknownIndex = 0;
  const sections = plan.section_plan.map((section) => ({
    id: section.id,
    title: section.title,
    statements: [
      ...section.fact_ids.map((factId) => {
        const statement = statementsByFact.get(factId);
        if (statement === undefined) {
          throw new Error(`Section ${section.id} references unrealized Fact ${factId}.`);
        }
        return statement;
      }),
      ...section.known_gap_ids.map((gapId) => {
        const unknown = unknowns.find((candidate) => candidate.id === gapId);
        if (unknown === undefined) {
          throw new Error(`Section ${section.id} references unknown gap ${gapId}.`);
        }
        unknownIndex += 1;
        return {
          id: `statement_unknown_${String(unknownIndex).padStart(3, "0")}`,
          text: unknown.statement,
          kind: "UNKNOWN" as const,
          scope: "NONE" as const,
          fact_ids: [],
          entity_refs: [],
          assertions: [],
          unknown_ids: [unknown.id],
          limitations: [
            "An unavailable fact is not evidence that the opposite statement is true.",
          ],
        };
      }),
    ],
  }));
  const factReferences = plan.selected_facts.map((selected) => {
    const statement = statementsByFact.get(selected.fact_id);
    if (statement === undefined) {
      throw new Error(`Selected Fact ${selected.fact_id} has no statement.`);
    }
    return { statement_id: statement.id, fact_ids: [selected.fact_id] };
  });

  return {
    brief_version: GROUNDED_BRIEF_VERSION,
    repository: { ...pack.repository },
    commit: pack.commit,
    fact_ir_version: pack.fact_ir_version,
    brief_plan_version: plan.brief_plan_version,
    sections,
    fact_references: factReferences,
    unknowns,
    limitations: [
      ...pack.limitations,
      "Only facts selected by GroundedBriefPlan are realized in this Brief.",
      "Known unknowns identify missing evidence; they are not negative facts.",
    ],
    generation_metadata: {
      mode: "deterministic",
      generator: "deterministic-grounded-brief-v1",
      provider: null,
      model: null,
      paid_api_requests: 0,
      real_model_requests: 0,
      repository_executions: 0,
    },
  };
}
