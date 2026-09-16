import type { CanonicalGroundedBriefArtifact } from "../brief/canonical.js";

export interface CanonicalUnknown {
  readonly unknown_id: string;
  readonly category: string;
  readonly canonical_text: string;
  readonly scope: "FACT_IR";
  readonly status: "UNRESOLVED";
  readonly provenance: {
    readonly repository: CanonicalGroundedBriefArtifact["repository"];
    readonly commit: string;
    readonly canonical_truth_version: number;
    readonly source_gap_ids: readonly string[];
    readonly evidence_needed: string;
  };
}

export type UnknownReferenceDecision =
  | "EXACT_ID_REFERENCE"
  | "REFERENCE_CANONICALIZED"
  | "AMBIGUOUS_UNKNOWN_REFERENCE"
  | "UNSUPPORTED_UNKNOWN_INTRODUCTION"
  | "UNKNOWN_UNKNOWN_REFERENCE";

export interface UnknownReferenceResolution {
  readonly input_reference: string;
  readonly decision: UnknownReferenceDecision;
  readonly unknown_id: string | null;
  readonly candidate_unknown_ids: readonly string[];
}

export interface UnknownReferenceReconciliation {
  readonly status: "RESOLVED" | "REJECTED";
  readonly canonical_unknown_ids: readonly string[];
  readonly references: readonly UnknownReferenceResolution[];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeReference(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function projectCanonicalUnknowns(
  canonical: CanonicalGroundedBriefArtifact,
): readonly CanonicalUnknown[] {
  return canonical.known_unknowns
    .map((unknown) => ({
      unknown_id: unknown.id,
      category: unknown.source_gap_ids[0] ?? "unspecified",
      canonical_text: unknown.statement,
      scope: "FACT_IR" as const,
      status: "UNRESOLVED" as const,
      provenance: {
        repository: { ...canonical.repository },
        commit: canonical.commit,
        canonical_truth_version: canonical.canonical_grounded_brief_version,
        source_gap_ids: [...unknown.source_gap_ids].sort(compareText),
        evidence_needed: unknown.evidence_needed,
      },
    }))
    .sort((left, right) => compareText(left.unknown_id, right.unknown_id));
}

export function reconcileUnknownReferences(
  inputReferences: readonly string[],
  canonicalUnknowns: readonly CanonicalUnknown[],
): UnknownReferenceReconciliation {
  const unknownsById = new Map(
    canonicalUnknowns.map((unknown) => [unknown.unknown_id, unknown]),
  );
  const unknownsByText = new Map<string, CanonicalUnknown[]>();
  for (const unknown of canonicalUnknowns) {
    const normalized = normalizeReference(unknown.canonical_text);
    const matches = unknownsByText.get(normalized) ?? [];
    matches.push(unknown);
    unknownsByText.set(normalized, matches);
  }
  const references = inputReferences.map((inputReference) => {
    const exact = unknownsById.get(inputReference);
    if (exact !== undefined) {
      return {
        input_reference: inputReference,
        decision: "EXACT_ID_REFERENCE" as const,
        unknown_id: exact.unknown_id,
        candidate_unknown_ids: [exact.unknown_id],
      };
    }
    const textMatches = unknownsByText.get(normalizeReference(inputReference)) ?? [];
    if (textMatches.length === 1) {
      const [textMatch] = textMatches;
      if (textMatch === undefined) {
        throw new Error("UNKNOWN_REFERENCE_TEXT_LOOKUP_DRIFT");
      }
      return {
        input_reference: inputReference,
        decision: "REFERENCE_CANONICALIZED" as const,
        unknown_id: textMatch.unknown_id,
        candidate_unknown_ids: [textMatch.unknown_id],
      };
    }
    if (textMatches.length > 1) {
      return {
        input_reference: inputReference,
        decision: "AMBIGUOUS_UNKNOWN_REFERENCE" as const,
        unknown_id: null,
        candidate_unknown_ids: textMatches
          .map((unknown) => unknown.unknown_id)
          .sort(compareText),
      };
    }
    return {
      input_reference: inputReference,
      decision: /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/i.test(inputReference)
        ? ("UNKNOWN_UNKNOWN_REFERENCE" as const)
        : ("UNSUPPORTED_UNKNOWN_INTRODUCTION" as const),
      unknown_id: null,
      candidate_unknown_ids: [],
    };
  });
  const resolvedIds = references.flatMap((reference) =>
    reference.unknown_id === null ? [] : [reference.unknown_id],
  );
  return {
    status: references.every((reference) => reference.unknown_id !== null)
      ? "RESOLVED"
      : "REJECTED",
    canonical_unknown_ids: [...new Set(resolvedIds)].sort(compareText),
    references,
  };
}

export function validateUnknownIdReferences(
  inputReferences: readonly string[],
  canonicalUnknowns: readonly CanonicalUnknown[],
): UnknownReferenceReconciliation {
  const unknownsById = new Map(
    canonicalUnknowns.map((unknown) => [unknown.unknown_id, unknown]),
  );
  const references = inputReferences.map((inputReference) => {
    const exact = unknownsById.get(inputReference);
    if (exact !== undefined) {
      return {
        input_reference: inputReference,
        decision: "EXACT_ID_REFERENCE" as const,
        unknown_id: exact.unknown_id,
        candidate_unknown_ids: [exact.unknown_id],
      };
    }
    return {
      input_reference: inputReference,
      decision: /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/i.test(inputReference)
        ? ("UNKNOWN_UNKNOWN_REFERENCE" as const)
        : ("UNSUPPORTED_UNKNOWN_INTRODUCTION" as const),
      unknown_id: null,
      candidate_unknown_ids: [],
    };
  });
  const resolvedIds = references.flatMap((reference) =>
    reference.unknown_id === null ? [] : [reference.unknown_id],
  );
  return {
    status: references.every((reference) => reference.unknown_id !== null)
      ? "RESOLVED"
      : "REJECTED",
    canonical_unknown_ids: [...new Set(resolvedIds)].sort(compareText),
    references,
  };
}
