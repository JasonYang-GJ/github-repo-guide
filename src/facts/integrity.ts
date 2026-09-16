import { FACT_TYPE_RULES, isEvidenceTypeCompatible } from "./compatibility.js";
import type { GroundedFactPack } from "./domain.js";

export interface FactPackIntegrityResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

function duplicateIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates].sort();
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function validateGroundedFactPackIntegrity(
  pack: GroundedFactPack,
): FactPackIntegrityResult {
  const errors: string[] = [];
  const entityIds = new Set(pack.entities.map((entity) => entity.id));
  const evidenceById = new Map(pack.evidence_refs.map((record) => [record.id, record]));

  for (const [label, ids] of [
    ["entity", pack.entities.map((entity) => entity.id)],
    ["fact", pack.facts.map((fact) => fact.id)],
    ["evidence", pack.evidence_refs.map((record) => record.id)],
  ] as const) {
    for (const id of duplicateIds(ids)) errors.push(`Duplicate ${label} id: ${id}`);
  }

  for (const entity of pack.entities) {
    for (const evidenceId of entity.evidence_ids) {
      if (!evidenceById.has(evidenceId)) {
        errors.push(`Entity ${entity.id} references missing evidence ${evidenceId}`);
      }
    }
  }

  for (const evidence of pack.evidence_refs) {
    if (evidence.verification_status !== "verified") {
      errors.push(`Evidence ${evidence.id} is not verified`);
    }
  }

  for (const fact of pack.facts) {
    const rule = FACT_TYPE_RULES[fact.fact_type];
    if (fact.category !== rule.category) {
      errors.push(`Fact ${fact.id} has category ${fact.category}, expected ${rule.category}`);
    }
    if (!(rule.predicates as readonly string[]).includes(fact.predicate)) {
      errors.push(`Fact ${fact.id} uses incompatible predicate ${fact.predicate}`);
    }
    if (!entityIds.has(fact.subject_ref)) {
      errors.push(`Fact ${fact.id} references missing subject ${fact.subject_ref}`);
    }
    if (!entityIds.has(fact.object_ref)) {
      errors.push(`Fact ${fact.id} references missing object ${fact.object_ref}`);
    }
    if (!sameStrings(fact.evidence_ids, fact.provenance.evidence_ids)) {
      errors.push(`Fact ${fact.id} provenance evidence does not match fact evidence`);
    }
    if (
      fact.provenance.repository.url !== pack.repository.url ||
      fact.provenance.repository.commit_sha !== pack.commit
    ) {
      errors.push(`Fact ${fact.id} provenance does not match pack repository and commit`);
    }
    for (const evidenceId of fact.evidence_ids) {
      const evidence = evidenceById.get(evidenceId);
      if (evidence === undefined) {
        errors.push(`Fact ${fact.id} references missing evidence ${evidenceId}`);
      } else if (!isEvidenceTypeCompatible(fact.fact_type, evidence.evidence_type)) {
        errors.push(
          `Fact ${fact.id} type ${fact.fact_type} is incompatible with ${evidence.evidence_type}`,
        );
      }
    }
  }

  return { valid: errors.length === 0, errors: errors.sort() };
}
