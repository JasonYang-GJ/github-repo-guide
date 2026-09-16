import type { BriefNarrative } from "../analysis/brief-builder.js";
import type { EvidenceRecord, FactStatus } from "../analysis/domain.js";
import {
  evaluateClaimSemantics,
  type NarrowingProvenance,
  type ClaimScope,
  type ClaimSemanticStatus,
  type ClaimStrength,
} from "./claim-semantics.js";
import {
  extractClaimSemanticAnchors,
  type ClaimSemanticAnchors,
  type NarrowingAlignmentResult,
} from "./claim-alignment.js";
import {
  extractOutcomeModifiers,
  extractSafetyModifiers,
  type ClaimType,
} from "./claim-evidence-compatibility.js";

export type BriefNarrativeClaimSource =
  | "one_sentence"
  | "summary"
  | "problem"
  | "module_responsibility"
  | "module_importance";

export type BriefNarrativeFinalAction = "ACCEPT" | "NARROW" | "DOWNGRADE" | "REJECT";
export type ClaimAtomizationStatus = "ATOMIC" | "ATOMIZED" | "COMPOUND_UNATOMIZED";

export interface DecisionEvidenceTrace {
  readonly id: string;
  readonly evidenceType: EvidenceRecord["evidence_type"];
  readonly sourceKind: EvidenceRecord["source_kind"];
  readonly sourcePath: string | null;
  readonly compatible: boolean;
}

export interface BriefNarrativeClaimDecision {
  readonly id: string;
  readonly parentClaimId: string;
  readonly rawClaim: string;
  readonly atomizationStatus: ClaimAtomizationStatus;
  readonly atomicClaimIndex: number;
  readonly source: BriefNarrativeClaimSource;
  readonly sourcePath?: string;
  readonly originalClaim: string;
  readonly claimType: ClaimType;
  readonly evidenceCandidates: readonly DecisionEvidenceTrace[];
  readonly selectedEvidence: readonly DecisionEvidenceTrace[];
  readonly semanticAnchors: ClaimSemanticAnchors;
  readonly safetyModifiers: readonly string[];
  readonly outcomeModifiers: readonly string[];
  readonly detectedScope: ClaimScope;
  readonly detectedStrength: ClaimStrength;
  readonly semanticStatus: ClaimSemanticStatus;
  readonly finalAction: BriefNarrativeFinalAction;
  readonly finalClaim: string | null;
  readonly finalStatus: FactStatus;
  readonly evidenceIds: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly reason: string;
  readonly traceValid: boolean;
  readonly narrowingAlignment?: NarrowingAlignmentResult;
  readonly narrowingProvenance?: NarrowingProvenance;
}

export interface BriefNarrativeSemanticGap {
  readonly decisionId: string;
  readonly pattern: "COMPARATIVE" | "CAUSAL" | "TEMPORAL" | "COMPLETENESS" | "EXCLUSIVITY";
  readonly claim: string;
}

export interface BriefNarrativeSemanticsReceipt {
  readonly claimSemanticsVersion: 2;
  readonly passed: boolean;
  readonly decisions: readonly BriefNarrativeClaimDecision[];
  readonly newSemanticGaps: readonly BriefNarrativeSemanticGap[];
}

interface RawNarrativeCandidate {
  readonly source: BriefNarrativeClaimSource;
  readonly sourcePath?: string;
  readonly statement: string;
}

interface AtomicNarrativeCandidate extends RawNarrativeCandidate {
  readonly parentClaimId: string;
  readonly rawClaim: string;
  readonly atomizationStatus: ClaimAtomizationStatus;
  readonly atomicClaimIndex: number;
}

const SEMANTIC_GAP_PATTERNS = [
  {
    pattern: "COMPARATIVE",
    expression: /\b(?:better|worse|more|less|faster|slower|safer|stronger|weaker)\s+than\b|\bcompared\s+(?:to|with)\b/i,
  },
  {
    pattern: "CAUSAL",
    expression: /\b(?:because|therefore|thereby|leads?\s+to|results?\s+in|causes?)\b/i,
  },
  {
    pattern: "TEMPORAL",
    expression: /\b(?:before|after|eventually|subsequently|previously|later)\b/i,
  },
  {
    pattern: "COMPLETENESS",
    expression: /\b(?:complete|comprehensive|exhaustive|entire)\b/i,
  },
  {
    pattern: "EXCLUSIVITY",
    expression: /\b(?:only|solely|exclusively)\b/i,
  },
] as const;

function splitSentences(value: string): readonly string[] {
  return value
    .split(/(?<=[.!?;])\s+(?=\S)/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

const PREDICATE_WORD =
  "(?:assign(?:s|ed|ing)?|check(?:s|ed|ing)?|concatenate(?:s|d|ing)?|declar(?:e|es|ed|ing)|defin(?:e|es|ed|ing)|exist(?:s|ed|ing)?|export(?:s|ed|ing)?|expos(?:e|es|ed|ing)|handl(?:e|es|ed|ing)|implement(?:s|ed|ing)?|import(?:s|ed|ing)?|leak(?:s|ed|ing|age)?|match(?:es|ed|ing)?|merg(?:e|es|ed|ing)|mutat(?:e|es|ed|ing|ion)|overrid(?:e|es|den|ing)|preserv(?:e|es|ed|ing)|prevent(?:s|ed|ing)?|protect(?:s|ed|ing|ion)?|provid(?:e|es|ed|ing)|read(?:s|ing)?|re(?:ly|lies|lied|lying)|return(?:s|ed|ing)?|skip(?:s|ped|ping)?|writ(?:e|es|ten|ing))";
const LEADING_PREDICATE = new RegExp(`^${PREDICATE_WORD}\\b`, "i");
const SUBJECT_BEFORE_PREDICATE = new RegExp(`^(.+?)\\s+(?=${PREDICATE_WORD}\\b)`, "i");
const COMMA_PREDICATE_BOUNDARY = new RegExp(
  `,\\s+(?:and\\s+)?(?=${PREDICATE_WORD}\\b)`,
  "i",
);

function withTerminalPunctuation(value: string, punctuation: string): string {
  const trimmed = value.trim().replace(/[.!?;]+$/, "");
  return `${trimmed}${punctuation || "."}`;
}

function splitIndependentPredicates(statement: string): readonly string[] {
  if (/\bwhich\s+also\b/i.test(statement)) return [statement.trim()];
  const normalized = statement;
  const punctuation = /[.!?;]$/.exec(normalized.trim())?.[0] ?? ".";
  const withoutPunctuation = normalized.trim().replace(/[.!?;]$/, "");
  const commaParts = withoutPunctuation.split(COMMA_PREDICATE_BOUNDARY);
  if (commaParts.length > 1) {
    const first = commaParts[0]?.trim() ?? "";
    if (LEADING_PREDICATE.test(first)) {
      if (commaParts.slice(1).some((part) => /^(?:matching|giving|avoiding)\b/i.test(part.trim()))) {
        return [statement.trim()];
      }
      return commaParts.map((part) =>
        withTerminalPunctuation(
          part.length === 0 ? part : `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`,
          punctuation,
        ),
      );
    }
    const subject = SUBJECT_BEFORE_PREDICATE.exec(first)?.[1]?.trim();
    if (subject !== undefined && subject.length > 0) {
      return commaParts.map((part, index) =>
        withTerminalPunctuation(index === 0 ? part : `${subject} ${part}`, punctuation),
      );
    }
  }
  const match = /^(.*?)(?:,?\s+)\b(?:and|but|while)\b\s+(.+)$/.exec(withoutPunctuation);
  if (match?.[1] === undefined || match[2] === undefined) return [statement.trim()];
  const left = match[1].trim();
  const right = match[2].trim();
  if (
    extractClaimSemanticAnchors(left).predicates.length === 0 ||
    extractClaimSemanticAnchors(right).predicates.length === 0 ||
    !LEADING_PREDICATE.test(right)
  ) {
    return [statement.trim()];
  }
  const subject = SUBJECT_BEFORE_PREDICATE.exec(left)?.[1]?.trim();
  if (LEADING_PREDICATE.test(left)) {
    return [
      withTerminalPunctuation(left, punctuation),
      withTerminalPunctuation(
        `${right[0]?.toUpperCase() ?? ""}${right.slice(1)}`,
        punctuation,
      ),
    ];
  }
  if (subject === undefined || subject.length === 0) return [statement.trim()];
  return [
    withTerminalPunctuation(left, punctuation),
    withTerminalPunctuation(`${subject} ${right}`, punctuation),
  ];
}

function splitTechnicalIdentifierList(
  statement: string,
  sourcePath: string | undefined,
): readonly string[] {
  const punctuation = /[.!?]$/.exec(statement.trim())?.[0] ?? ".";
  const withoutPunctuation = statement.trim().replace(/[.!?]$/, "");
  const match = /^(.*?\b(?:exports?|declares?))\s+(.+)$/i.exec(withoutPunctuation);
  if (match?.[1] === undefined || match[2] === undefined) return [statement.trim()];
  const identifiers = [...match[2].matchAll(/`([^`]+)`/g)]
    .map((identifier) => identifier[1])
    .filter((identifier): identifier is string => identifier !== undefined);
  if (identifiers.length < 2) return [statement.trim()];
  const residue = match[2]
    .replace(/`[^`]+`/g, "")
    .replace(/,/g, "")
    .replace(/\band\b/gi, "")
    .trim();
  if (residue.length > 0) return [statement.trim()];

  let prefix = match[1].trim();
  if (sourcePath !== undefined && /^(?:it\s+)?exports?$/i.test(prefix)) {
    prefix = `${sourcePath} exports`;
  } else if (sourcePath !== undefined && /^(?:it\s+)?declares?$/i.test(prefix)) {
    prefix = `${sourcePath} declares`;
  }
  return identifiers.map((identifier) =>
    withTerminalPunctuation(`${prefix} \`${identifier}\``, punctuation),
  );
}

function appearsCompound(statement: string): boolean {
  if (/;|,\s*which\s+also\s+/i.test(statement)) return true;
  if (COMMA_PREDICATE_BOUNDARY.test(statement)) return true;
  const anchors = extractClaimSemanticAnchors(statement);
  if (
    /\band\b/i.test(statement) &&
    anchors.objects.includes("esm_entry") &&
    anchors.objects.includes("cjs_entry")
  ) {
    return true;
  }
  const boundary = /,?\s+\b(?:and|but|while)\b\s+/i.exec(statement);
  if (boundary === null) return false;
  const left = statement.slice(0, boundary.index);
  const right = statement.slice(boundary.index + boundary[0].length);
  const hasTechnicalPredicate = (clause: string): boolean =>
    extractClaimSemanticAnchors(clause).predicates.length > 0 ||
    /\b(?:merge|runtime|export|mutation|safety)\s+(?:behavior|semantics|entry|strategy)\b/i.test(
      clause,
    );
  return (
    hasTechnicalPredicate(left) &&
    hasTechnicalPredicate(right)
  );
}

function rawCandidatesFor(narrative: BriefNarrative): readonly RawNarrativeCandidate[] {
  const candidates: RawNarrativeCandidate[] = [
    { source: "one_sentence", statement: narrative.oneSentence.trim() },
    { source: "summary", statement: narrative.summary.trim() },
    { source: "problem", statement: narrative.problem.trim() },
  ];
  for (const module of narrative.moduleInterpretations ?? []) {
    candidates.push(
      {
        source: "module_responsibility",
        sourcePath: module.sourcePath,
        statement: module.responsibility.trim(),
      },
      {
        source: "module_importance",
        sourcePath: module.sourcePath,
        statement: module.whyImportant.trim(),
      },
    );
  }
  return candidates.filter((candidate) => candidate.statement.length > 0);
}

function candidatesFor(narrative: BriefNarrative): readonly AtomicNarrativeCandidate[] {
  return rawCandidatesFor(narrative).flatMap((candidate, parentIndex) => {
    const parentClaimId = `brief_narrative_parent_${String(parentIndex + 1).padStart(3, "0")}`;
    const sentenceParts = splitSentences(candidate.statement);
    const statements = sentenceParts
      .flatMap((statement) => splitIndependentPredicates(statement))
      .flatMap((statement) => splitTechnicalIdentifierList(statement, candidate.sourcePath));
    const atomized = statements.length > 1;
    return statements.map((statement, atomicIndex) => ({
      ...candidate,
      statement,
      parentClaimId,
      rawClaim: candidate.statement,
      atomizationStatus: appearsCompound(statement)
        ? ("COMPOUND_UNATOMIZED" as const)
        : atomized
          ? ("ATOMIZED" as const)
          : ("ATOMIC" as const),
      atomicClaimIndex: atomicIndex + 1,
    }));
  });
}

function evidenceForCandidate(
  candidate: AtomicNarrativeCandidate,
  evidence: readonly EvidenceRecord[],
): readonly EvidenceRecord[] {
  if (candidate.sourcePath === undefined) return evidence;
  return evidence.filter((record) => record.locator?.source_path === candidate.sourcePath);
}

function evidenceByIds(
  ids: readonly string[],
  evidence: readonly EvidenceRecord[],
): readonly EvidenceRecord[] {
  const idSet = new Set(ids);
  return evidence.filter((record) => idSet.has(record.id));
}

function evidenceTrace(
  evidence: readonly EvidenceRecord[],
  compatibleEvidenceIds: readonly string[],
): readonly DecisionEvidenceTrace[] {
  const compatible = new Set(compatibleEvidenceIds);
  return evidence.map((record) => ({
    id: record.id,
    evidenceType: record.evidence_type,
    sourceKind: record.source_kind,
    sourcePath: record.locator?.source_path ?? null,
    compatible: compatible.has(record.id),
  }));
}

function makeDecision(
  candidate: AtomicNarrativeCandidate,
  evidence: readonly EvidenceRecord[],
  index: number,
): BriefNarrativeClaimDecision {
  const assessment = evaluateClaimSemantics(
    { statement: candidate.statement, requestedStatus: "verified" },
    evidence,
  );
  const evidenceCandidates = evidenceTrace(
    evidence,
    assessment.evidenceCompatibility.compatibleEvidenceIds,
  );
  const selectedTrace = (
    ids: readonly string[],
    compatibleEvidenceIds: readonly string[] =
      assessment.evidenceCompatibility.compatibleEvidenceIds,
  ): readonly DecisionEvidenceTrace[] => {
    const selected = new Set(ids);
    return evidenceTrace(evidence, compatibleEvidenceIds).filter((item) => selected.has(item.id));
  };
  const base = {
    id: `brief_narrative_claim_${String(index + 1).padStart(3, "0")}`,
    parentClaimId: candidate.parentClaimId,
    rawClaim: candidate.rawClaim,
    atomizationStatus: candidate.atomizationStatus,
    atomicClaimIndex: candidate.atomicClaimIndex,
    source: candidate.source,
    ...(candidate.sourcePath === undefined ? {} : { sourcePath: candidate.sourcePath }),
    originalClaim: candidate.statement,
    claimType: assessment.claimType,
    evidenceCandidates,
    selectedEvidence: [] as readonly DecisionEvidenceTrace[],
    semanticAnchors: extractClaimSemanticAnchors(candidate.statement, evidence),
    safetyModifiers: extractSafetyModifiers(candidate.statement),
    outcomeModifiers: extractOutcomeModifiers(candidate.statement),
    detectedScope: assessment.scope,
    detectedStrength: assessment.strength,
    semanticStatus: assessment.semanticStatus,
    reasonCodes: assessment.reasonCodes,
    reason: assessment.reason,
    ...(assessment.narrowingAlignment === undefined
      ? {}
      : { narrowingAlignment: assessment.narrowingAlignment }),
    ...(assessment.narrowingProvenance === undefined
      ? {}
      : { narrowingProvenance: assessment.narrowingProvenance }),
  };

  if (candidate.atomizationStatus === "COMPOUND_UNATOMIZED") {
    return {
      ...base,
      semanticStatus: "COMPOUND_UNATOMIZED",
      finalAction: "DOWNGRADE",
      finalClaim: candidate.statement,
      finalStatus: "unknown",
      evidenceIds: [],
      reasonCodes: ["COMPOUND_UNATOMIZED"],
      reason:
        "The statement appears to contain multiple independently verifiable predicates but could not be split conservatively.",
      traceValid: true,
    };
  }

  if (assessment.verifiedAllowed && assessment.supportingEvidenceIds.length > 0) {
    return {
      ...base,
      finalAction: "ACCEPT",
      finalClaim: candidate.statement,
      finalStatus: "verified",
      evidenceIds: assessment.supportingEvidenceIds,
      selectedEvidence: selectedTrace(assessment.supportingEvidenceIds),
      traceValid: true,
    };
  }

  if (
    assessment.recommendedAction === "NARROW" &&
    assessment.narrowedStatement !== undefined &&
    assessment.supportingEvidenceIds.length > 0
  ) {
    const narrowedEvidence = evidenceByIds(assessment.supportingEvidenceIds, evidence);
    const narrowed = evaluateClaimSemantics(
      { statement: assessment.narrowedStatement, requestedStatus: "verified" },
      narrowedEvidence,
    );
    const traceValid =
      narrowed.verifiedAllowed &&
      narrowed.supportingEvidenceIds.length > 0 &&
      narrowed.supportingEvidenceIds.every((id) => assessment.supportingEvidenceIds.includes(id));
    if (traceValid) {
      return {
        ...base,
        finalAction: "NARROW",
        finalClaim: assessment.narrowedStatement,
        finalStatus: "verified",
        evidenceIds: narrowed.supportingEvidenceIds,
        selectedEvidence: selectedTrace(
          narrowed.supportingEvidenceIds,
          narrowed.evidenceCompatibility.compatibleEvidenceIds,
        ),
        traceValid: true,
      };
    }
  }

  if (assessment.recommendedAction === "REJECT") {
    return {
      ...base,
      finalAction: "REJECT",
      finalClaim: null,
      finalStatus: "unknown",
      evidenceIds: [],
      traceValid: true,
    };
  }

  return {
    ...base,
    finalAction: "DOWNGRADE",
    finalClaim: candidate.statement,
    finalStatus:
      assessment.supportingEvidenceIds.length > 0 && assessment.allowedStatus !== "verified"
        ? assessment.allowedStatus
        : "unknown",
    evidenceIds: assessment.supportingEvidenceIds,
    selectedEvidence: selectedTrace(assessment.supportingEvidenceIds),
    traceValid: true,
  };
}

function findSemanticGaps(
  decisions: readonly BriefNarrativeClaimDecision[],
): readonly BriefNarrativeSemanticGap[] {
  const gaps: BriefNarrativeSemanticGap[] = [];
  for (const decision of decisions) {
    if (decision.semanticStatus !== "INSUFFICIENT_SCOPE") continue;
    for (const candidate of SEMANTIC_GAP_PATTERNS) {
      if (candidate.expression.test(decision.originalClaim)) {
        gaps.push({
          decisionId: decision.id,
          pattern: candidate.pattern,
          claim: decision.originalClaim,
        });
      }
    }
  }
  return gaps;
}

export function evaluateBriefNarrativeSemantics(
  narrative: BriefNarrative,
  evidence: readonly EvidenceRecord[],
): BriefNarrativeSemanticsReceipt {
  const decisions = candidatesFor(narrative).map((candidate, index) =>
    makeDecision(candidate, evidenceForCandidate(candidate, evidence), index),
  );
  const newSemanticGaps = findSemanticGaps(decisions);
  return {
    claimSemanticsVersion: 2,
    passed: decisions.every((decision) => decision.traceValid) && newSemanticGaps.length === 0,
    decisions,
    newSemanticGaps,
  };
}
