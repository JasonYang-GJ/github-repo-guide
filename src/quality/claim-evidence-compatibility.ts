import type { EvidenceRecord } from "../analysis/domain.js";

export type ClaimType =
  | "DECLARATION"
  | "PACKAGE_EXPORT"
  | "BRANCH_BEHAVIOR"
  | "IMPORT_RELATIONSHIP"
  | "CALL_RELATIONSHIP"
  | "TYPE_RUNTIME"
  | "IMMUTABILITY"
  | "SAFETY"
  | "OUTCOME"
  | "OTHER";

export interface EvidenceCompatibilityAssessment {
  readonly claimType: ClaimType;
  readonly candidateEvidenceIds: readonly string[];
  readonly compatibleEvidenceIds: readonly string[];
  readonly requiredEvidenceRoles: readonly string[];
  readonly missingEvidenceRoles: readonly string[];
  readonly reasonCodes: readonly string[];
}

const SAFETY_MODIFIER_PATTERNS = [
  /\bsafe\b/gi,
  /\bsafely\b/gi,
  /\bsafety\b/gi,
  /\bsecure\b/gi,
  /\bsecurely\b/gi,
  /\bsecurity\b/gi,
  /\brisks?\b/gi,
  /\brisk-free\b/gi,
  /\bwithout\s+risk\b/gi,
  /\bno\s+risk\b/gi,
  /\bvulnerable\b/gi,
  /\bvulnerabilit(?:y|ies)\b/gi,
  /\bprotect(?:s|ed|ion)?\b/gi,
  /\bprevents?\s+attacks?\b/gi,
  /\bleaks?\b/gi,
  /\bleakage\b/gi,
  /\bcannot\s+leak\b/gi,
] as const;

const OUTCOME_MODIFIER_PATTERNS = [
  /\bimproves?\b/gi,
  /\bincreases?\b/gi,
  /\breduces?\b/gi,
  /\bprevents?\b/gi,
  /\beliminates?\b/gi,
  /\benables?\b/gi,
  /\bfacilitates?\b/gi,
  /\blightweight\b/gi,
  /\b(?:blazing\s+fast|fast|faster|performance)\b/gi,
  /\b(?:efficient|efficiency)\b/gi,
  /\b(?:reliable|reliability)\b/gi,
  /\bsafer\b/gi,
  /\bfewer\s+errors?\b/gi,
] as const;

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function maskMatch(value: string): string {
  return " ".repeat(value.length);
}

export function claimProse(statement: string): string {
  return statement
    .replace(/`[^`]*`/g, maskMatch)
    .replace(/\b(?:src|lib|app|packages)\/[A-Za-z0-9_./-]+/gi, maskMatch)
    .replace(/\b[A-Za-z0-9_.-]+\.(?:[cm]?[jt]sx?|json|md)\b/gi, maskMatch);
}

function matchedModifiers(
  statement: string,
  patterns: readonly RegExp[],
): readonly string[] {
  const prose = claimProse(statement);
  const matches: { value: string; index: number; end: number }[] = [];
  for (const pattern of patterns) {
    for (const match of prose.matchAll(pattern)) {
      const value = (match[0] ?? "").toLowerCase();
      const index = match.index ?? 0;
      matches.push({ value, index, end: index + value.length });
    }
  }
  const retained: typeof matches = [];
  for (const match of matches.sort(
    (left, right) => left.index - right.index || right.value.length - left.value.length,
  )) {
    if (retained.some((item) => match.index < item.end && match.end > item.index)) continue;
    retained.push(match);
  }
  return unique(retained.map((match) => match.value));
}

export function extractSafetyModifiers(statement: string): readonly string[] {
  return matchedModifiers(statement, SAFETY_MODIFIER_PATTERNS);
}

export function extractOutcomeModifiers(statement: string): readonly string[] {
  return matchedModifiers(statement, OUTCOME_MODIFIER_PATTERNS);
}

function isPackageExportClaim(statement: string): boolean {
  return (
    /^package\.json declares (?:export|ESM entry)\b/i.test(statement.trim()) ||
    /\b(?:ESM|ES\s+module)\b.{0,48}\b(?:entry|entries|export|exports)\b/i.test(statement)
  );
}

function isTypeRuntimeClaim(statement: string): boolean {
  const prose = claimProse(statement);
  return (
    /\b(?:type|types|typing|typescript|signature)\b/i.test(prose) &&
    /\bruntime\b/i.test(prose)
  );
}

function isImmutabilityClaim(statement: string): boolean {
  return /\b(?:does\s+not\s+mutate|without\s+mutating|avoid(?:s|ed|ing)?\s+mutation|preserv(?:e|es|ed|ing)\s+(?:its\s+)?inputs?|immutab(?:le|ility)|leaves?\s+(?:the\s+)?inputs?\s+untouched)\b/i.test(
    claimProse(statement),
  );
}

export function classifyClaimType(statement: string): ClaimType {
  const trimmed = statement.trim();
  if (
    /^(?:function|method|class|interface|type|module|variable|constant|other)\s+[^\s]+\s+is declared in\s+.+\.$/i.test(
      trimmed,
    )
  ) {
    return "DECLARATION";
  }
  if (/^(?:src|lib|app|packages)\/[\w./-]+\s+exports?\s+`[^`]+`\.$/i.test(trimmed)) {
    return "DECLARATION";
  }
  if (isPackageExportClaim(trimmed)) return "PACKAGE_EXPORT";
  if (/^.+\s+imports\s+.+\s+through\s+.+\.$/.test(trimmed)) {
    return "IMPORT_RELATIONSHIP";
  }
  if (/^[A-Za-z_$][A-Za-z0-9_$]* in .+ contains a direct static call to [A-Za-z_$][A-Za-z0-9_$]* in .+\.$/.test(trimmed)) {
    return "CALL_RELATIONSHIP";
  }
  if (isTypeRuntimeClaim(trimmed)) return "TYPE_RUNTIME";
  if (extractSafetyModifiers(trimmed).length > 0) return "SAFETY";
  if (isImmutabilityClaim(trimmed)) return "IMMUTABILITY";
  if (/\b(?:this|the|shown)\s+branch\b/i.test(trimmed)) return "BRANCH_BEHAVIOR";
  if (extractOutcomeModifiers(trimmed).length > 0) return "OUTCOME";
  return "OTHER";
}

function isVerified(record: EvidenceRecord): boolean {
  return (
    record.verification_status === "verified" &&
    record.verification.commit_resolved &&
    record.verification.path_exists === true
  );
}

function isTypeDeclaration(record: EvidenceRecord): boolean {
  return (
    isVerified(record) &&
    record.evidence_type === "symbol_declaration" &&
    ["type", "interface"].includes(record.locator?.symbol?.kind ?? "")
  );
}

function isDirectRuntimeSource(record: EvidenceRecord): boolean {
  const kind = record.locator?.symbol?.kind;
  return (
    isVerified(record) &&
    record.source_kind === "source_code" &&
    record.locator?.excerpt !== undefined &&
    !/^\s*import\b/m.test(record.locator.excerpt) &&
    record.evidence_type !== "tree_entry" &&
    !["type", "interface", "module"].includes(kind ?? "")
  );
}

function isManifestExport(record: EvidenceRecord): boolean {
  const pointer = record.locator?.field_pointer;
  return (
    isVerified(record) &&
    record.evidence_type === "manifest_field" &&
    record.locator?.source_path === "package.json" &&
    pointer !== undefined &&
    (pointer === "/module" || pointer === "/exports" || pointer.startsWith("/exports/"))
  );
}

function isImportEvidence(record: EvidenceRecord): boolean {
  return (
    isVerified(record) &&
    record.evidence_type === "source_range" &&
    record.source_kind === "source_code" &&
    /^\s*import\b/m.test(record.locator?.excerpt ?? "")
  );
}

function isDirectCallEvidence(record: EvidenceRecord): boolean {
  return (
    isVerified(record) &&
    record.evidence_type === "direct_call" &&
    record.source_kind === "source_code" &&
    record.call_relation?.relation === "CALLS" &&
    record.call_relation.direct === true &&
    record.call_relation.runtime_execution_guaranteed === false
  );
}

function isBranchEvidence(record: EvidenceRecord): boolean {
  return (
    isVerified(record) &&
    record.source_kind === "source_code" &&
    record.locator?.excerpt !== undefined &&
    /\bif\s*\(/.test(record.locator.excerpt)
  );
}

export function evaluateEvidenceCompatibility(
  statement: string,
  evidence: readonly EvidenceRecord[],
): EvidenceCompatibilityAssessment {
  const claimType = classifyClaimType(statement);
  const candidateEvidenceIds = evidence.map((record) => record.id);
  let compatible: EvidenceRecord[] = [];
  let requiredEvidenceRoles: readonly string[] = [];
  let missingEvidenceRoles: readonly string[] = [];
  const reasonCodes: string[] = [];

  if (claimType === "DECLARATION") {
    requiredEvidenceRoles = ["symbol_declaration"];
    compatible = evidence.filter(
      (record) => isVerified(record) && record.evidence_type === "symbol_declaration",
    );
    if (compatible.length === 0) {
      missingEvidenceRoles = requiredEvidenceRoles;
      reasonCodes.push("DECLARATION_REQUIRES_SYMBOL_EVIDENCE");
    }
  } else if (claimType === "PACKAGE_EXPORT") {
    requiredEvidenceRoles = ["package_manifest_export"];
    compatible = evidence.filter(isManifestExport);
    if (compatible.length === 0) {
      missingEvidenceRoles = requiredEvidenceRoles;
      reasonCodes.push("PACKAGE_EXPORT_REQUIRES_MANIFEST_EVIDENCE");
    }
  } else if (claimType === "BRANCH_BEHAVIOR") {
    requiredEvidenceRoles = ["source_branch"];
    compatible = evidence.filter(isBranchEvidence);
    if (compatible.length === 0) {
      missingEvidenceRoles = requiredEvidenceRoles;
      reasonCodes.push("BRANCH_BEHAVIOR_REQUIRES_SOURCE_BRANCH");
    }
  } else if (claimType === "IMPORT_RELATIONSHIP") {
    requiredEvidenceRoles = ["source_import"];
    compatible = evidence.filter(isImportEvidence);
    if (compatible.length === 0) {
      missingEvidenceRoles = requiredEvidenceRoles;
      reasonCodes.push("IMPORT_RELATIONSHIP_REQUIRES_SOURCE_IMPORT");
    }
  } else if (claimType === "CALL_RELATIONSHIP") {
    requiredEvidenceRoles = ["direct_call_expression"];
    compatible = evidence.filter(isDirectCallEvidence);
    if (compatible.length === 0) {
      missingEvidenceRoles = requiredEvidenceRoles;
      reasonCodes.push("CALL_RELATIONSHIP_REQUIRES_DIRECT_CALL_EVIDENCE");
    }
  } else if (claimType === "TYPE_RUNTIME") {
    requiredEvidenceRoles = ["type_declaration", "runtime_implementation"];
    const typeEvidence = evidence.filter(isTypeDeclaration);
    const runtimeEvidence = evidence.filter(isDirectRuntimeSource);
    compatible = [...typeEvidence, ...runtimeEvidence];
    missingEvidenceRoles = [
      ...(typeEvidence.length === 0 ? ["type_declaration"] : []),
      ...(runtimeEvidence.length === 0 ? ["runtime_implementation"] : []),
    ];
    if (typeEvidence.length > 0 && runtimeEvidence.length === 0) {
      reasonCodes.push("TYPE_DECLARATION_CANNOT_PROVE_RUNTIME");
    }
    if (missingEvidenceRoles.length > 0) reasonCodes.push("TYPE_RUNTIME_REQUIRES_BOTH_SIDES");
  } else if (claimType === "IMMUTABILITY") {
    requiredEvidenceRoles = ["direct_implementation_behavior"];
    compatible = evidence.filter(isDirectRuntimeSource);
    if (compatible.length === 0) {
      missingEvidenceRoles = requiredEvidenceRoles;
      reasonCodes.push("DIRECT_IMPLEMENTATION_EVIDENCE_REQUIRED");
      if (evidence.some(isTypeDeclaration)) {
        reasonCodes.push("TYPE_OR_SIGNATURE_CANNOT_PROVE_IMMUTABILITY");
      }
    }
  } else if (claimType === "SAFETY") {
    requiredEvidenceRoles = ["dedicated_bounded_safety_evidence"];
    missingEvidenceRoles = requiredEvidenceRoles;
    reasonCodes.push("DEDICATED_SAFETY_EVIDENCE_REQUIRED");
  } else if (claimType === "OUTCOME") {
    requiredEvidenceRoles = ["measurement_or_benchmark"];
    missingEvidenceRoles = requiredEvidenceRoles;
    reasonCodes.push("MEASUREMENT_EVIDENCE_REQUIRED");
  } else {
    compatible = evidence.filter(isVerified);
  }

  return {
    claimType,
    candidateEvidenceIds,
    compatibleEvidenceIds: unique(compatible.map((record) => record.id)),
    requiredEvidenceRoles,
    missingEvidenceRoles,
    reasonCodes: unique(reasonCodes),
  };
}
