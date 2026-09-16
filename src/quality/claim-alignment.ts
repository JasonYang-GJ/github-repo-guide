import { posix } from "node:path";

import type { EvidenceRecord } from "../analysis/domain.js";
import { claimProse } from "./claim-evidence-compatibility.js";

export interface ClaimSemanticAnchors {
  readonly entities: readonly string[];
  readonly predicates: readonly string[];
  readonly objects: readonly string[];
  readonly outcomes: readonly string[];
}

export interface NarrowingAlignmentResult {
  readonly aligned: boolean;
  readonly originalAnchors: ClaimSemanticAnchors;
  readonly candidateAnchors: ClaimSemanticAnchors;
  readonly preservedAnchors: ClaimSemanticAnchors;
  readonly removedModifiers: readonly string[];
  readonly addedScopeQualifier: string | null;
  readonly reasonCodes: readonly string[];
}

const PREDICATE_RULES = [
  ["assign", /\bassign(?:s|ed|ing)?\b/i],
  ["check", /\bcheck(?:s|ed|ing)?\b/i],
  ["concatenate", /\bconcat(?:enate)?(?:s|d|ing)?\b/i],
  ["declare", /\bdeclar(?:e|es|ed|ing)\b/i],
  ["define", /\bdefin(?:e|es|ed|ing)\b/i],
  ["exist", /\bexist(?:s|ed|ing)?\b/i],
  ["export", /\b(?:export|expose)(?:s|ed|ing)?\b/i],
  ["handle", /\bhandl(?:e|es|ed|ing)\b/i],
  ["implement", /\bimplement(?:s|ed|ing)?\b/i],
  ["import", /\bimport(?:s|ed|ing)?\b/i],
  ["leak", /\bleak(?:s|ed|ing|age)?\b/i],
  ["match", /\bmatch(?:es|ed|ing)?\b/i],
  [
    "merge",
    /\b(?:merges|merged|merging)\b|\bmerge(?=\s+(?:arrays?|objects?|values?|inputs?|configuration|defaults?))\b/i,
  ],
  ["mutate", /\bmutat(?:e|es|ed|ing|ion)\b/i],
  ["override", /\boverrid(?:e|es|den|ing)\b/i],
  ["preserve", /\bpreserv(?:e|es|ed|ing)\b/i],
  ["prevent", /\bprevent(?:s|ed|ing)?\b/i],
  ["protect", /\bprotect(?:s|ed|ing|ion)?\b/i],
  ["provide", /\bprovid(?:e|es|ed|ing)\b/i],
  ["read", /\bread(?:s|ing)?\b/i],
  ["rely", /\bre(?:ly|lies|lied|lying)\b/i],
  ["return", /\breturn(?:s|ed|ing)?\b/i],
  ["skip", /\bskip(?:s|ped|ping)?\b/i],
  ["write", /\bwrit(?:e|es|ten|ing)\b/i],
] as const;

const OBJECT_RULES = [
  ["array", /\barrays?\b/i],
  ["configuration", /\b(?:configuration|config|options?)\b/i],
  ["cjs_entry", /\b(?:commonjs|cjs)\b/i],
  ["default_value", /\b(?:defaults?|default\s+(?:properties|values?))\b/i],
  ["error", /\berrors?\b/i],
  ["esm_entry", /\b(?:esm|es\s+module)\b/i],
  ["export_entry", /\b(?:exports?|entry\s+points?)\b/i],
  ["input", /\b(?:inputs?|source|arguments?)\b/i],
  ["nullish_value", /\b(?:nullish|null|undefined)\b/i],
  ["object", /\bobjects?\b/i],
  ["protected_key", /__proto__|\bconstructor\s+keys?\b/i],
  ["runtime", /\bruntime\b/i],
  ["type_system", /\b(?:types?|typing|typescript)\b/i],
  ["value", /\bvalues?\b/i],
] as const;

const OUTCOME_RULES = [
  ["efficiency", /\b(?:efficient|efficiency)\b/i],
  ["faster", /\b(?:fast|faster|performance)\b/i],
  ["reliability", /\b(?:reliable|reliability)\b/i],
  ["safety", /\b(?:safe|safely|safety|secure|securely|security)\b/i],
  ["risk", /\b(?:risk|risks|risk-free|vulnerab(?:le|ility|ilities))\b/i],
] as const;

const REMOVABLE_MODIFIERS = [
  /\ball\b/gi,
  /\balways\b/gi,
  /\bevery\b/gi,
  /\bfully\b/gi,
  /\bcompletely\b/gi,
  /\bguaranteed?\b/gi,
  /\bsafe(?:ly|ty)?\b/gi,
  /\bsecure(?:ly)?\b/gi,
] as const;

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function matches(
  statement: string,
  rules: readonly (readonly [string, RegExp])[],
): readonly string[] {
  return unique(rules.filter(([, pattern]) => pattern.test(statement)).map(([name]) => name));
}

function pathEntities(statement: string): readonly string[] {
  const paths = statement.match(/(?:^|\s)((?:src|lib|app|packages)\/[A-Za-z0-9_./-]+)/gi) ?? [];
  return paths.flatMap((raw) => {
    const path = raw.trim().replace(/[.,;:]$/, "");
    const base = posix.basename(path).replace(/\.[^.]+$/, "").toLowerCase();
    return [path.toLowerCase(), base];
  });
}

function entityAnchors(statement: string, evidence: readonly EvidenceRecord[]): readonly string[] {
  const identifiers = [...statement.matchAll(/`([^`]+)`/g)].map((match) =>
    (match[1] ?? "").toLowerCase(),
  );
  const evidenceSymbols = evidence
    .map((record) => record.locator?.symbol?.name)
    .filter((name): name is string => name !== undefined)
    .filter((name) => new RegExp(`(?:^|[^A-Za-z0-9_$])${escapePattern(name)}(?:$|[^A-Za-z0-9_$])`).test(statement))
    .map((name) => name.toLowerCase());
  const named = /\bdefu\b/i.test(statement) ? ["defu"] : [];
  return unique([...identifiers, ...evidenceSymbols, ...named, ...pathEntities(statement)]);
}

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractClaimSemanticAnchors(
  statement: string,
  evidence: readonly EvidenceRecord[] = [],
): ClaimSemanticAnchors {
  return {
    entities: entityAnchors(statement, evidence),
    predicates: matches(statement, PREDICATE_RULES),
    objects: matches(statement, OBJECT_RULES),
    outcomes: matches(claimProse(statement), OUTCOME_RULES),
  };
}

function intersection(left: readonly string[], right: readonly string[]): readonly string[] {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

function evidenceScopeEntities(evidence: readonly EvidenceRecord[]): ReadonlySet<string> {
  const values = new Set<string>();
  for (const record of evidence) {
    const path = record.locator?.source_path;
    if (path !== undefined) {
      values.add(path.toLowerCase());
      values.add(posix.basename(path).replace(/\.[^.]+$/, "").toLowerCase());
    }
    const symbol = record.locator?.symbol?.name;
    if (symbol !== undefined) values.add(symbol.toLowerCase());
  }
  return values;
}

function removedModifiers(original: string, candidate: string): readonly string[] {
  const removed: string[] = [];
  for (const pattern of REMOVABLE_MODIFIERS) {
    for (const match of original.matchAll(pattern)) {
      const value = match[0].toLowerCase();
      if (!new RegExp(`\\b${escapePattern(value)}\\b`, "i").test(candidate)) removed.push(value);
    }
  }
  return unique(removed);
}

function scopeQualifier(candidate: string): string | null {
  const match = /^(In\s+(?:src|lib|app|packages)\/[A-Za-z0-9_./-]+,\s+(?:the|this)\s+shown\s+branch)/i.exec(
    candidate.trim(),
  );
  return match?.[1] ?? null;
}

export function evaluateNarrowingAlignment(
  original: string,
  candidate: string,
  evidence: readonly EvidenceRecord[],
): NarrowingAlignmentResult {
  const originalAnchors = extractClaimSemanticAnchors(original, evidence);
  const candidateAnchors = extractClaimSemanticAnchors(candidate, evidence);
  const preservedAnchors: ClaimSemanticAnchors = {
    entities: intersection(originalAnchors.entities, candidateAnchors.entities),
    predicates: intersection(originalAnchors.predicates, candidateAnchors.predicates),
    objects: intersection(originalAnchors.objects, candidateAnchors.objects),
    outcomes: intersection(originalAnchors.outcomes, candidateAnchors.outcomes),
  };
  const reasonCodes: string[] = [];
  if (originalAnchors.entities.length > 0 && preservedAnchors.entities.length === 0) {
    reasonCodes.push("PRIMARY_ENTITY_NOT_PRESERVED");
  }
  if (preservedAnchors.predicates.length === 0) {
    reasonCodes.push("PRIMARY_PREDICATE_NOT_PRESERVED");
  }
  if (
    originalAnchors.objects.length > 0 &&
    candidateAnchors.objects.length > 0 &&
    preservedAnchors.objects.length === 0
  ) {
    reasonCodes.push("RELEVANT_OBJECT_NOT_PRESERVED");
  }
  const originalOutcomes = new Set(originalAnchors.outcomes);
  if (candidateAnchors.outcomes.some((outcome) => !originalOutcomes.has(outcome))) {
    reasonCodes.push("NEW_OUTCOME_INTRODUCED");
  }
  const originalEntities = new Set(originalAnchors.entities);
  const allowedScopeEntities = evidenceScopeEntities(evidence);
  const unsupportedEntities = candidateAnchors.entities.filter(
    (entity) => !originalEntities.has(entity) && !allowedScopeEntities.has(entity),
  );
  if (unsupportedEntities.length > 0) {
    reasonCodes.push("NEW_ENTITY_NOT_EVIDENCE_BOUND");
  }
  return {
    aligned: reasonCodes.length === 0,
    originalAnchors,
    candidateAnchors,
    preservedAnchors,
    removedModifiers: removedModifiers(original, candidate),
    addedScopeQualifier: scopeQualifier(candidate),
    reasonCodes,
  };
}
