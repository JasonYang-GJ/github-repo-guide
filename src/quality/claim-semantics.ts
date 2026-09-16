import { posix } from "node:path";

import ts from "typescript";

import type { EvidenceRecord, FactStatus } from "../analysis/domain.js";
import {
  evaluateNarrowingAlignment,
  type ClaimSemanticAnchors,
  type NarrowingAlignmentResult,
} from "./claim-alignment.js";
import {
  claimProse,
  classifyClaimType,
  evaluateEvidenceCompatibility,
  extractOutcomeModifiers,
  extractSafetyModifiers,
  type ClaimType,
  type EvidenceCompatibilityAssessment,
} from "./claim-evidence-compatibility.js";

export type ClaimScope = "LOCAL" | "MODULE" | "PROJECT" | "UNIVERSAL";

export type ClaimStrength =
  | "DESCRIPTIVE"
  | "BEHAVIOR"
  | "OUTCOME"
  | "SAFETY"
  | "UNIVERSAL";

export type ClaimSemanticStatus =
  | "SUPPORTED"
  | "COMPOUND_UNATOMIZED"
  | "OVERBROAD"
  | "OUTCOME_UNSUPPORTED"
  | "UNIVERSAL_UNSUPPORTED"
  | "SAFETY_UNSUPPORTED"
  | "TYPE_RUNTIME_UNSUPPORTED"
  | "IMMUTABILITY_UNSUPPORTED"
  | "INSUFFICIENT_SCOPE"
  | "DOCUMENTATION_ONLY";

export type ClaimSemanticAction = "ALLOW" | "NARROW" | "DOWNGRADE" | "REJECT";

export interface ClaimSemanticCandidate {
  readonly statement: string;
  readonly requestedStatus: FactStatus;
}

export interface ClaimSemanticAssessment {
  readonly claimType: ClaimType;
  readonly evidenceCompatibility: EvidenceCompatibilityAssessment;
  readonly scope: ClaimScope;
  readonly strength: ClaimStrength;
  readonly semanticStatus: ClaimSemanticStatus;
  readonly verifiedAllowed: boolean;
  readonly allowedStatus: FactStatus;
  readonly recommendedAction: ClaimSemanticAction;
  readonly supportingEvidenceIds: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly reason: string;
  readonly narrowedStatement?: string;
  readonly narrowingAlignment?: NarrowingAlignmentResult;
  readonly narrowingProvenance?: NarrowingProvenance;
}

export interface NarrowingProvenance {
  readonly originalClaim: string;
  readonly finalClaim: string;
  readonly removedModifiers: readonly string[];
  readonly addedScopeQualifier: string | null;
  readonly preservedSemanticAnchors: ClaimSemanticAnchors;
  readonly evidenceIds: readonly string[];
  readonly reason: string;
}

const UNIVERSAL_PATTERN =
  /\b(?:always|never|all|every|guarantees?|ensures?|cannot\s+fail|zero\s+overhead|error[- ]free|fully|completely|automatically\s+avoids?)\b/i;
const BEHAVIOR_PATTERN =
  /\b(?:skips?|merges?|concatenates?|returns?|imports?|reads?|writes?|calls?|assigns?|ignores?|preserves?|overrides?|handles?)\b/i;
const UNDEFINED_CONTINUE_PATTERN =
  /if\s*\([^)]*\bvalue\s*===\s*undefined[^)]*\)\s*(?:\{\s*continue\s*;?\s*\}|continue\s*;?)/;
const NULL_CONTINUE_PATTERN =
  /if\s*\([^)]*\bvalue\s*===\s*null[^)]*\)\s*(?:\{\s*continue\s*;?\s*\}|continue\s*;?)/;
const PROTECTED_KEY_CONTINUE_PATTERN =
  /if\s*\([^)]*key\s*===\s*["']__proto__["'][^)]*key\s*===\s*["']constructor["'][^)]*\)\s*(?:\{\s*continue\s*;?\s*\}|continue\s*;?)/;
const UNDEFINED_CHECK_PATTERN = /\bvalue\s*===\s*undefined\b/;

function inferScope(statement: string): ClaimScope {
  const trimmed = statement.trim();
  const prose = claimProse(statement);
  if (
    /^(?:function|method|class|interface|type|module|variable|constant|other)\s+[^\s]+\s+is declared in\s+.+\.$/i.test(
      trimmed,
    ) ||
    /^(?:src|lib|app|packages)\/[\w./-]+\s+exports?\s+`[^`]+`\.$/i.test(trimmed) ||
    /^.+\s+imports\s+.+\s+through\s+.+\.$/i.test(trimmed)
    || /^[A-Za-z_$][A-Za-z0-9_$]* in .+ contains a direct static call to [A-Za-z_$][A-Za-z0-9_$]* in .+\.$/.test(trimmed)
  ) {
    return "LOCAL";
  }
  if (/^Source module .+ exists at the resolved commit\.$/.test(trimmed)) return "MODULE";
  if (
    /^The repository tree contains TypeScript source at .+\.$/.test(trimmed) ||
    /^.+ is declared in (?:[A-Za-z0-9_.-]+\/)*package\.json dependencies\.$/.test(trimmed)
  ) {
    return "PROJECT";
  }
  if (UNIVERSAL_PATTERN.test(prose)) return "UNIVERSAL";
  if (
    /\b(?:this\s+branch|the\s+branch|function|method|class|interface|type|constant|variable)\b/i.test(
      statement,
    ) ||
    /(?:^|\s)(?:src|lib|app|packages)\/[\w./-]+/i.test(statement)
  ) {
    return "LOCAL";
  }
  if (/\bmodule\b/i.test(statement)) return "MODULE";
  return "PROJECT";
}

function inferStrength(statement: string): ClaimStrength {
  if (/^(?:function|method|class|interface|type|module|variable|constant|other)\s+[^\s]+\s+is declared in\s+.+\.$/i.test(statement.trim())) {
    return "DESCRIPTIVE";
  }
  if (/^(?:src|lib|app|packages)\/[\w./-]+\s+exports?\s+`[^`]+`\.$/i.test(statement.trim())) {
    return "DESCRIPTIVE";
  }
  const prose = claimProse(statement);
  if (extractSafetyModifiers(prose).length > 0) return "SAFETY";
  if (extractOutcomeModifiers(prose).length > 0) return "OUTCOME";
  if (UNIVERSAL_PATTERN.test(prose)) return "UNIVERSAL";
  if (BEHAVIOR_PATTERN.test(statement)) return "BEHAVIOR";
  return "DESCRIPTIVE";
}

function isVerified(record: EvidenceRecord): boolean {
  return (
    record.verification_status === "verified" &&
    record.verification.commit_resolved &&
    record.verification.path_exists === true
  );
}

function supportsExactDeclaration(
  statement: string,
  evidence: readonly EvidenceRecord[],
): boolean {
  const match =
    /^(function|method|class|interface|type|module|variable|constant|other)\s+([^\s]+)\s+is declared in\s+(.+)\.$/i.exec(
      statement.trim(),
    );
  if (match === null) return false;
  const [, kind, name, path] = match;
  return evidence.some((record) => {
    const locator = record.locator;
    const symbol = locator?.symbol;
    return (
      isVerified(record) &&
      record.evidence_type === "symbol_declaration" &&
      locator?.source_path === path &&
      symbol !== undefined &&
      symbol.name === name &&
      (symbol.kind === undefined || symbol.kind.toLowerCase() === kind?.toLowerCase())
    );
  });
}

function supportsExactSourceExport(
  statement: string,
  evidence: readonly EvidenceRecord[],
): boolean {
  const match = /^((?:src|lib|app|packages)\/[\w./-]+)\s+exports?\s+`([^`]+)`\.$/i.exec(
    statement.trim(),
  );
  if (match?.[1] === undefined || match[2] === undefined) return false;
  const [, path, name] = match;
  return evidence.some((record) => {
    const excerpt = record.locator?.excerpt;
    return (
      isVerified(record) &&
      record.evidence_type === "symbol_declaration" &&
      record.locator?.source_path === path &&
      record.locator.symbol?.name === name &&
      excerpt !== undefined &&
      /\bexport\b/.test(excerpt)
    );
  });
}

function supportsExactUndefinedBranch(
  statement: string,
  evidence: readonly EvidenceRecord[],
): boolean {
  if (
    !/\bbranch\b/i.test(statement) ||
    !/\bskips?\b/i.test(statement) ||
    !/\bundefined\b/i.test(statement) ||
    /\b(?:nullish|all|always|every)\b/i.test(statement)
  ) {
    return false;
  }
  return evidence.some((record) => {
    if (!isVerified(record) || record.source_kind !== "source_code") return false;
    const path = record.locator?.source_path;
    const excerpt = record.locator?.excerpt;
    const conditionSupportsUndefined =
      excerpt !== undefined && UNDEFINED_CONTINUE_PATTERN.test(excerpt);
    const conditionSupportsNull =
      excerpt !== undefined && NULL_CONTINUE_PATTERN.test(excerpt);
    const statementRequiresNull = /\bnull\s+or\s+undefined\b/i.test(statement);
    return (
      path !== undefined &&
      statement.includes(path) &&
      conditionSupportsUndefined &&
      (!statementRequiresNull || conditionSupportsNull)
    );
  });
}

function supportsExactProtectedKeyBranch(
  statement: string,
  evidence: readonly EvidenceRecord[],
): boolean {
  if (
    !/\bbranch\b/i.test(statement) ||
    !/\bskips?\b/i.test(statement) ||
    !statement.includes("__proto__") ||
    !/\bconstructor\b/i.test(statement)
  ) {
    return false;
  }
  return evidence.some((record) => {
    const locator = record.locator;
    const excerpt = locator?.excerpt;
    return (
      isVerified(record) &&
      record.source_kind === "source_code" &&
      locator !== undefined &&
      statement.includes(locator.source_path) &&
      excerpt !== undefined &&
      PROTECTED_KEY_CONTINUE_PATTERN.test(excerpt)
    );
  });
}

function supportsExactUndefinedCheck(
  statement: string,
  evidence: readonly EvidenceRecord[],
): boolean {
  if (
    !/\bbranch\b/i.test(statement) ||
    !/\bchecks?\b/i.test(statement) ||
    !/`?value\s*===\s*undefined`?/i.test(statement)
  ) {
    return false;
  }
  return evidence.some((record) => {
    const path = record.locator?.source_path;
    const excerpt = record.locator?.excerpt;
    return (
      isVerified(record) &&
      record.source_kind === "source_code" &&
      path !== undefined &&
      statement.includes(path) &&
      excerpt !== undefined &&
      UNDEFINED_CHECK_PATTERN.test(excerpt)
    );
  });
}

function supportsExactTreeFact(statement: string, evidence: readonly EvidenceRecord[]): boolean {
  return evidence.some((record) => {
    const path = record.locator?.source_path;
    if (!isVerified(record) || record.evidence_type !== "tree_entry" || path === undefined) {
      return false;
    }
    return (
      statement === `Source module ${path} exists at the resolved commit.` ||
      statement === `The repository tree contains TypeScript source at ${path}.` ||
      statement === `The repository tree contains JavaScript source at ${path}.`
    );
  });
}

function supportsExactManifestFact(
  statement: string,
  evidence: readonly EvidenceRecord[],
): boolean {
  const match = /^(.+) is declared in ((?:[A-Za-z0-9_.-]+\/)*package\.json) dependencies\.$/.exec(
    statement.trim(),
  );
  if (match === null) return false;
  const dependency = match[1];
  const manifestPath = match[2];
  const pointer =
    dependency === undefined
      ? undefined
      : `/dependencies/${dependency.replace(/~/g, "~0").replace(/\//g, "~1")}`;
  return evidence.some(
    (record) =>
      isVerified(record) &&
      record.evidence_type === "manifest_field" &&
      record.locator?.source_path === manifestPath &&
      record.locator?.field_pointer === pointer,
  );
}

function supportsExactPackageType(
  statement: string,
  evidence: readonly EvidenceRecord[],
): boolean {
  const match = /^((?:[A-Za-z0-9_.-]+\/)*package\.json) declares package type (.+)\.$/.exec(
    statement.trim(),
  );
  if (match?.[1] === undefined || match[2] === undefined) return false;
  let expected: unknown;
  try {
    expected = JSON.parse(match[2]);
  } catch {
    return false;
  }
  if (typeof expected !== "string") return false;
  return evidence.some(
    (record) =>
      isVerified(record) &&
      record.evidence_type === "manifest_field" &&
      record.locator?.source_path === match[1] &&
      record.locator?.field_pointer === "/type" &&
      record.locator?.excerpt === JSON.stringify(expected),
  );
}

function supportsExactPackageBin(
  statement: string,
  evidence: readonly EvidenceRecord[],
): boolean {
  const match = /^((?:[A-Za-z0-9_.-]+\/)*package\.json) declares CLI command ("(?:\\.|[^"\\])*") at ("(?:\\.|[^"\\])*")\.$/.exec(
    statement.trim(),
  );
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) {
    return false;
  }
  let command: unknown;
  let target: unknown;
  try {
    command = JSON.parse(match[2]);
    target = JSON.parse(match[3]);
  } catch {
    return false;
  }
  if (typeof command !== "string" || typeof target !== "string") return false;
  const encodedCommand = command.replace(/~/g, "~0").replace(/\//g, "~1");
  return evidence.some((record) => {
    const pointer = record.locator?.field_pointer;
    return (
      isVerified(record) &&
      record.evidence_type === "manifest_field" &&
      record.locator?.source_path === match[1] &&
      (pointer === `/bin/${encodedCommand}` || (command === "." && pointer === "/bin")) &&
      record.locator?.excerpt === JSON.stringify(target)
    );
  });
}

function supportsExactJsonSchema(
  statement: string,
  evidence: readonly EvidenceRecord[],
): boolean {
  const match = /^((?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.schema\.json) declares a JSON Schema document at (\/\$schema|\/type|\/title)\.$/.exec(
    statement.trim(),
  );
  if (match?.[1] === undefined || match[2] === undefined) return false;
  return evidence.some(
    (record) =>
      isVerified(record) &&
      record.evidence_type === "config_field" &&
      record.source_kind === "configuration" &&
      record.locator?.source_path === match[1] &&
      record.locator?.field_pointer === match[2] &&
      record.locator?.excerpt !== undefined,
  );
}

function hasDirectThrow(statement: ts.Statement): boolean {
  return (
    ts.isThrowStatement(statement) ||
    (ts.isBlock(statement) && statement.statements.some((item) => ts.isThrowStatement(item)))
  );
}

function excerptContainsExactThrow(excerpt: string, expectedCondition: string): boolean {
  const source = ts.createSourceFile(
    "claim-branch.mjs",
    excerpt,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  let found = false;
  function visit(node: ts.Node): void {
    if (found) return;
    if (ts.isIfStatement(node) && hasDirectThrow(node.thenStatement)) {
      const condition = node.expression.getText(source).replace(/\s+/g, " ").trim().slice(0, 300);
      if (condition === expectedCondition) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}

function supportsExactLocalThrow(
  statement: string,
  evidence: readonly EvidenceRecord[],
): boolean {
  const match = /^In ([A-Za-z_$][A-Za-z0-9_$]*) at ([A-Za-z0-9_./-]+\.(?:[cm]?[jt]sx?)), a local branch throws when (.+)\.$/.exec(
    statement.trim(),
  );
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) {
    return false;
  }
  return evidence.some((record) => {
    const excerpt = record.locator?.excerpt;
    return (
      isVerified(record) &&
      record.evidence_type === "source_range" &&
      record.source_kind === "source_code" &&
      record.locator?.source_path === match[2] &&
      record.locator?.symbol?.name === match[1] &&
      excerpt !== undefined &&
      excerptContainsExactThrow(excerpt, match[3] ?? "")
    );
  });
}

function escapeJsonPointer(value: string): string {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}

function supportsExactPackageExport(
  statement: string,
  evidence: readonly EvidenceRecord[],
): boolean {
  const exportMatch = /^package\.json declares export "([^"]+)"\.$/.exec(statement.trim());
  if (exportMatch?.[1] !== undefined) {
    const pointer = `/exports/${escapeJsonPointer(exportMatch[1])}`;
    return evidence.some(
      (record) =>
        isVerified(record) &&
        record.evidence_type === "manifest_field" &&
        record.locator?.source_path === "package.json" &&
        (record.locator.field_pointer === pointer ||
          (exportMatch[1] === "." && record.locator.field_pointer === "/exports")),
    );
  }
  const esmMatch = /^package\.json declares ESM entry "([^"]+)"\.$/.exec(statement.trim());
  if (esmMatch?.[1] === undefined) return false;
  const expectedExcerpt = JSON.stringify(esmMatch[1]);
  return evidence.some((record) => {
    const pointer = record.locator?.field_pointer;
    return (
      isVerified(record) &&
      record.evidence_type === "manifest_field" &&
      record.locator?.source_path === "package.json" &&
      record.locator.excerpt === expectedExcerpt &&
      pointer !== undefined &&
      (pointer === "/module" ||
        /^\/exports\/(?:.+\/)?(?:import|module|default)$/.test(pointer))
    );
  });
}

function supportsExactImport(statement: string, evidence: readonly EvidenceRecord[]): boolean {
  const match = /^(.+) imports (.+) through (.+)\.$/.exec(statement.trim());
  if (match === null) return false;
  const [, fromPath, toPath, specifier] = match;
  if (fromPath === undefined || toPath === undefined || specifier === undefined) return false;
  const joined = posix.normalize(posix.join(posix.dirname(fromPath), specifier));
  const withoutExtension = (path: string): string =>
    path.replace(/\.(?:[cm]?[jt]sx?)$/i, "").replace(/\/index$/i, "");
  const resolvesToTarget = withoutExtension(joined) === withoutExtension(toPath);
  if (!resolvesToTarget) return false;
  return evidence.some((record) => {
    const excerpt = record.locator?.excerpt;
    return (
      isVerified(record) &&
      record.evidence_type === "source_range" &&
      record.locator?.source_path === fromPath &&
      excerpt !== undefined &&
      (excerpt.includes(`"${specifier}"`) || excerpt.includes(`'${specifier}'`))
    );
  });
}

function supportsExactDirectCall(
  statement: string,
  evidence: readonly EvidenceRecord[],
): boolean {
  const match = /^([A-Za-z_$][A-Za-z0-9_$]*) in (.+) contains a direct static call to ([A-Za-z_$][A-Za-z0-9_$]*) in (.+)\.$/.exec(
    statement.trim(),
  );
  if (
    match?.[1] === undefined ||
    match[2] === undefined ||
    match[3] === undefined ||
    match[4] === undefined
  ) {
    return false;
  }
  return evidence.some((record) => {
    const relation = record.call_relation;
    return (
      isVerified(record) &&
      record.evidence_type === "direct_call" &&
      record.verification.method === "ast_call_expression" &&
      relation?.relation === "CALLS" &&
      relation.direct === true &&
      relation.runtime_execution_guaranteed === false &&
      relation.caller.symbol.name === match[1] &&
      relation.caller.source_path === match[2] &&
      relation.callee.symbol.name === match[3] &&
      relation.callee.source_path === match[4]
    );
  });
}

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function declarationNarrowing(
  statement: string,
  evidence: readonly EvidenceRecord[],
): string | undefined {
  for (const record of evidence) {
    const locator = record.locator;
    const symbol = locator?.symbol;
    if (
      isVerified(record) &&
      record.evidence_type === "symbol_declaration" &&
      locator !== undefined &&
      symbol !== undefined
    ) {
      const nameAppears = new RegExp(
        `(?:^|[^A-Za-z0-9_$])${escapePattern(symbol.name)}(?:$|[^A-Za-z0-9_$])`,
      ).test(statement);
      const kindAppears =
        symbol.kind !== undefined &&
        new RegExp(`\\b${escapePattern(symbol.kind)}\\b`, "i").test(statement);
      if (!nameAppears || !kindAppears) continue;
      return `${symbol.kind ?? "symbol"} ${symbol.name} is declared in ${locator.source_path}.`;
    }
  }
  return undefined;
}

function safetyBehaviorNarrowing(evidence: readonly EvidenceRecord[]): string | undefined {
  for (const record of evidence) {
    const locator = record.locator;
    const excerpt = locator?.excerpt;
    if (
      isVerified(record) &&
      record.source_kind === "source_code" &&
      locator !== undefined &&
      excerpt !== undefined &&
      PROTECTED_KEY_CONTINUE_PATTERN.test(excerpt)
    ) {
      return `In ${locator.source_path}, the shown branch skips the "__proto__" and "constructor" keys.`;
    }
  }
  return undefined;
}

function undefinedBehaviorNarrowing(evidence: readonly EvidenceRecord[]): string | undefined {
  for (const record of evidence) {
    const locator = record.locator;
    const excerpt = locator?.excerpt;
    if (
      isVerified(record) &&
      record.source_kind === "source_code" &&
      locator !== undefined &&
      excerpt !== undefined &&
      UNDEFINED_CONTINUE_PATTERN.test(excerpt)
    ) {
      const includesNull = /\bvalue\s*===\s*null\b/.test(excerpt);
      return includesNull
        ? `In ${locator.source_path}, the shown branch skips a value when value is null or undefined.`
        : `In ${locator.source_path}, the shown branch skips a value when value is undefined.`;
    }
  }
  return undefined;
}

function isDocumentationOnly(evidence: readonly EvidenceRecord[]): boolean {
  return (
    evidence.length > 0 &&
    evidence.every(
      (record) =>
        record.source_kind === "documentation" ||
        record.evidence_type === "documentation_statement" ||
        record.verification_status === "documentation",
    )
  );
}

function matchingEvidenceIds(
  statement: string,
  evidence: readonly EvidenceRecord[],
): readonly string[] {
  return evidence
    .filter(
      (record) =>
        supportsExactDeclaration(statement, [record]) ||
        supportsExactSourceExport(statement, [record]) ||
        supportsExactUndefinedBranch(statement, [record]) ||
        supportsExactUndefinedCheck(statement, [record]) ||
        supportsExactProtectedKeyBranch(statement, [record]) ||
        supportsExactTreeFact(statement, [record]) ||
        supportsExactManifestFact(statement, [record]) ||
        supportsExactPackageType(statement, [record]) ||
        supportsExactPackageBin(statement, [record]) ||
        supportsExactJsonSchema(statement, [record]) ||
        supportsExactLocalThrow(statement, [record]) ||
        supportsExactPackageExport(statement, [record]) ||
        supportsExactImport(statement, [record]) ||
        supportsExactDirectCall(statement, [record]),
    )
    .map((record) => record.id);
}

function assessment(
  candidate: ClaimSemanticCandidate,
  evidence: readonly EvidenceRecord[],
  input: Omit<
    ClaimSemanticAssessment,
    "scope" | "strength" | "claimType" | "evidenceCompatibility"
  >,
): ClaimSemanticAssessment {
  return {
    claimType: classifyClaimType(candidate.statement),
    evidenceCompatibility: evaluateEvidenceCompatibility(candidate.statement, evidence),
    scope: inferScope(candidate.statement),
    strength: inferStrength(candidate.statement),
    ...input,
  };
}

interface NarrowingResolution {
  readonly proposedStatement?: string;
  readonly narrowedStatement?: string;
  readonly alignment?: NarrowingAlignmentResult;
  readonly provenance?: NarrowingProvenance;
}

function resolveNarrowing(
  original: string,
  candidate: string | undefined,
  evidence: readonly EvidenceRecord[],
): NarrowingResolution {
  if (candidate === undefined) return {};
  const alignment = evaluateNarrowingAlignment(original, candidate, evidence);
  if (!alignment.aligned) return { proposedStatement: candidate, alignment };
  const evidenceIds = matchingEvidenceIds(candidate, evidence);
  if (evidenceIds.length === 0) {
    return {
      proposedStatement: candidate,
      alignment: {
        ...alignment,
        aligned: false,
        reasonCodes: [...alignment.reasonCodes, "CANDIDATE_NOT_DIRECTLY_SUPPORTED"],
      },
    };
  }
  return {
    proposedStatement: candidate,
    narrowedStatement: candidate,
    alignment,
    provenance: {
      originalClaim: original,
      finalClaim: candidate,
      removedModifiers: alignment.removedModifiers,
      addedScopeQualifier: alignment.addedScopeQualifier,
      preservedSemanticAnchors: alignment.preservedAnchors,
      evidenceIds,
      reason:
        "The narrowed claim preserves the original predicate and object while adding only an evidence-bound local scope.",
    },
  };
}

export function evaluateClaimSemantics(
  candidate: ClaimSemanticCandidate,
  evidence: readonly EvidenceRecord[],
): ClaimSemanticAssessment {
  if (
    supportsExactDeclaration(candidate.statement, evidence) ||
    supportsExactSourceExport(candidate.statement, evidence) ||
    supportsExactTreeFact(candidate.statement, evidence) ||
    supportsExactManifestFact(candidate.statement, evidence) ||
    supportsExactPackageType(candidate.statement, evidence) ||
    supportsExactPackageBin(candidate.statement, evidence) ||
    supportsExactJsonSchema(candidate.statement, evidence) ||
    supportsExactLocalThrow(candidate.statement, evidence) ||
    supportsExactPackageExport(candidate.statement, evidence) ||
    supportsExactImport(candidate.statement, evidence) ||
    supportsExactDirectCall(candidate.statement, evidence)
  ) {
    return assessment(candidate, evidence, {
      semanticStatus: "SUPPORTED",
      verifiedAllowed: true,
      allowedStatus: "verified",
      recommendedAction: "ALLOW",
      supportingEvidenceIds: matchingEvidenceIds(candidate.statement, evidence),
      reasonCodes: ["EXACT_STRUCTURAL_EVIDENCE"],
      reason:
        "The claim is an exact structural fact deterministically matched to its verified locator.",
    });
  }

  const claimType = classifyClaimType(candidate.statement);
  const compatibility = evaluateEvidenceCompatibility(candidate.statement, evidence);

  if (isDocumentationOnly(evidence)) {
    return assessment(candidate, evidence, {
      semanticStatus: "DOCUMENTATION_ONLY",
      verifiedAllowed: false,
      allowedStatus: "documentation",
      recommendedAction: candidate.requestedStatus === "documentation" ? "ALLOW" : "DOWNGRADE",
      supportingEvidenceIds: evidence.map((record) => record.id),
      reasonCodes: ["DOCUMENTATION_IS_NOT_VERIFICATION", "MARKETING_LANGUAGE_UNMEASURED"],
      reason:
        "The statement is attributable to project documentation, but documentation alone does not verify a structural, runtime, safety, or measured outcome claim.",
    });
  }

  if (claimType === "PACKAGE_EXPORT") {
    return assessment(candidate, evidence, {
      semanticStatus: "INSUFFICIENT_SCOPE",
      verifiedAllowed: false,
      allowedStatus: "unknown",
      recommendedAction: "DOWNGRADE",
      supportingEvidenceIds: [],
      reasonCodes: compatibility.reasonCodes,
      reason:
        "A package export or ESM entry must be matched to the exact package.json exports/module field; source declarations and unrelated files are not entry-point evidence.",
    });
  }

  if (claimType === "TYPE_RUNTIME") {
    return assessment(candidate, evidence, {
      semanticStatus: "TYPE_RUNTIME_UNSUPPORTED",
      verifiedAllowed: false,
      allowedStatus: "unknown",
      recommendedAction: "DOWNGRADE",
      supportingEvidenceIds: [],
      reasonCodes: [
        ...compatibility.reasonCodes,
        "TYPE_DECLARATION_CANNOT_PROVE_RUNTIME",
      ].filter((value, index, values) => values.indexOf(value) === index),
      reason:
        "Type declarations describe the type system only. Runtime correspondence requires independent runtime implementation evidence, and an absolute match still cannot be inferred from one side.",
    });
  }

  if (claimType === "IMMUTABILITY") {
    return assessment(candidate, evidence, {
      semanticStatus: "IMMUTABILITY_UNSUPPORTED",
      verifiedAllowed: false,
      allowedStatus: "unknown",
      recommendedAction: "DOWNGRADE",
      supportingEvidenceIds: [],
      reasonCodes: [
        ...compatibility.reasonCodes,
        "IMMUTABILITY_REQUIRES_DIRECT_IMPLEMENTATION_EVIDENCE",
      ].filter((value, index, values) => values.indexOf(value) === index),
      reason:
        "A signature or type declaration cannot prove that inputs remain unchanged; direct implementation evidence and a claim-specific deterministic rule are required.",
    });
  }

  if (inferStrength(candidate.statement) === "SAFETY") {
    const proposedNarrowing =
      undefinedBehaviorNarrowing(evidence) ?? safetyBehaviorNarrowing(evidence);
    const narrowing = resolveNarrowing(
      candidate.statement,
      proposedNarrowing,
      evidence,
    );
    const narrowedStatement = narrowing.narrowedStatement;
    return assessment(candidate, evidence, {
      semanticStatus: "SAFETY_UNSUPPORTED",
      verifiedAllowed: false,
      allowedStatus: "unknown",
      recommendedAction: narrowedStatement === undefined ? "REJECT" : "NARROW",
      supportingEvidenceIds:
        narrowedStatement === undefined ? [] : matchingEvidenceIds(narrowedStatement, evidence),
      reasonCodes: [
        "GLOBAL_SAFETY_CLAIM_PROHIBITED",
        "NO_DEDICATED_SECURITY_EVIDENCE",
        ...(proposedNarrowing !== undefined && narrowedStatement === undefined
          ? ["NARROWING_SEMANTIC_ALIGNMENT_FAILED"]
          : []),
      ],
      reason:
        "Ordinary source inspection cannot establish that a project is safe or has no security risk; dedicated, bounded security evidence would still need a narrower claim.",
      ...(narrowedStatement === undefined ? {} : { narrowedStatement }),
      ...(narrowing.alignment === undefined
        ? {}
        : { narrowingAlignment: narrowing.alignment }),
      ...(narrowing.provenance === undefined
        ? {}
        : { narrowingProvenance: narrowing.provenance }),
    });
  }

  if (inferStrength(candidate.statement) === "OUTCOME") {
    const proposedNarrowing = declarationNarrowing(candidate.statement, evidence);
    const narrowing = resolveNarrowing(
      candidate.statement,
      proposedNarrowing,
      evidence,
    );
    const narrowedStatement = narrowing.narrowedStatement;
    return assessment(candidate, evidence, {
      semanticStatus: "OUTCOME_UNSUPPORTED",
      verifiedAllowed: false,
      allowedStatus: "inferred",
      recommendedAction: narrowedStatement === undefined ? "DOWNGRADE" : "NARROW",
      supportingEvidenceIds:
        narrowedStatement === undefined ? [] : matchingEvidenceIds(narrowedStatement, evidence),
      reasonCodes: [
        "OUTCOME_REQUIRES_MEASUREMENT",
        "SOURCE_EXISTENCE_IS_NOT_OUTCOME_EVIDENCE",
        ...(proposedNarrowing !== undefined && narrowedStatement === undefined
          ? ["NARROWING_SEMANTIC_ALIGNMENT_FAILED"]
          : []),
      ],
      reason:
        "A declaration or source excerpt cannot verify an efficiency, performance, reliability, or error-reduction outcome without a benchmark, test, measurement, or explicit bounded documentation.",
      ...(narrowedStatement === undefined ? {} : { narrowedStatement }),
      ...(narrowing.alignment === undefined
        ? {}
        : { narrowingAlignment: narrowing.alignment }),
      ...(narrowing.provenance === undefined
        ? {}
        : { narrowingProvenance: narrowing.provenance }),
    });
  }

  if (inferScope(candidate.statement) === "UNIVERSAL") {
    const proposedNarrowing = undefinedBehaviorNarrowing(evidence);
    const narrowing = resolveNarrowing(
      candidate.statement,
      proposedNarrowing,
      evidence,
    );
    const narrowedStatement = narrowing.narrowedStatement;
    return assessment(candidate, evidence, {
      semanticStatus: "UNIVERSAL_UNSUPPORTED",
      verifiedAllowed: false,
      allowedStatus: "unknown",
      recommendedAction: narrowedStatement === undefined ? "REJECT" : "NARROW",
      supportingEvidenceIds:
        narrowedStatement === undefined ? [] : matchingEvidenceIds(narrowedStatement, evidence),
      reasonCodes: [
        "UNIVERSAL_QUANTIFIER_UNSUPPORTED",
        "LOCAL_EVIDENCE_CANNOT_PROVE_ALL_CASES",
        ...(proposedNarrowing !== undefined && narrowedStatement === undefined
          ? ["NARROWING_SEMANTIC_ALIGNMENT_FAILED"]
          : []),
      ],
      reason:
        "A local branch proves only its explicit condition and cannot establish an always, all, every, never, or guarantee claim.",
      ...(narrowedStatement === undefined ? {} : { narrowedStatement }),
      ...(narrowing.alignment === undefined
        ? {}
        : { narrowingAlignment: narrowing.alignment }),
      ...(narrowing.provenance === undefined
        ? {}
        : { narrowingProvenance: narrowing.provenance }),
    });
  }

  if (
    inferStrength(candidate.statement) === "BEHAVIOR" &&
    inferScope(candidate.statement) !== "LOCAL"
  ) {
    const proposedNarrowing =
      undefinedBehaviorNarrowing(evidence) ?? safetyBehaviorNarrowing(evidence);
    const narrowing = resolveNarrowing(
      candidate.statement,
      proposedNarrowing,
      evidence,
    );
    const narrowedStatement = narrowing.narrowedStatement;
    return assessment(candidate, evidence, {
      semanticStatus: proposedNarrowing === undefined ? "INSUFFICIENT_SCOPE" : "OVERBROAD",
      verifiedAllowed: false,
      allowedStatus: "inferred",
      recommendedAction: narrowedStatement === undefined ? "DOWNGRADE" : "NARROW",
      supportingEvidenceIds:
        narrowedStatement === undefined ? [] : matchingEvidenceIds(narrowedStatement, evidence),
      reasonCodes: [
        "CLAIM_SCOPE_EXCEEDS_EVIDENCE",
        "LOCAL_BEHAVIOR_MUST_STAY_LOCAL",
        ...(proposedNarrowing !== undefined && narrowedStatement === undefined
          ? ["NARROWING_SEMANTIC_ALIGNMENT_FAILED"]
          : []),
      ],
      reason:
        "A source branch supports only a claim about that branch; it does not establish behavior for the whole implementation or project.",
      ...(narrowedStatement === undefined ? {} : { narrowedStatement }),
      ...(narrowing.alignment === undefined
        ? {}
        : { narrowingAlignment: narrowing.alignment }),
      ...(narrowing.provenance === undefined
        ? {}
        : { narrowingProvenance: narrowing.provenance }),
    });
  }

  if (
    supportsExactUndefinedBranch(candidate.statement, evidence) ||
    supportsExactUndefinedCheck(candidate.statement, evidence) ||
    supportsExactProtectedKeyBranch(candidate.statement, evidence)
  ) {
    return assessment(candidate, evidence, {
      semanticStatus: "SUPPORTED",
      verifiedAllowed: true,
      allowedStatus: "verified",
      recommendedAction: "ALLOW",
      supportingEvidenceIds: matchingEvidenceIds(candidate.statement, evidence),
      reasonCodes: ["EXACT_LOCAL_EVIDENCE"],
      reason: "The claim is limited to a source location and is directly entailed by verified evidence.",
    });
  }

  return assessment(candidate, evidence, {
    semanticStatus: "INSUFFICIENT_SCOPE",
    verifiedAllowed: false,
    allowedStatus: candidate.requestedStatus === "verified" ? "inferred" : candidate.requestedStatus,
    recommendedAction: candidate.requestedStatus === "verified" ? "DOWNGRADE" : "ALLOW",
    supportingEvidenceIds: [],
    reasonCodes: [
      ...compatibility.reasonCodes,
      "NO_DETERMINISTIC_ENTAILMENT_RULE",
    ].filter((value, index, values) => values.indexOf(value) === index),
    reason: "Verified evidence exists only as a locator; no deterministic rule entails this claim.",
  });
}
