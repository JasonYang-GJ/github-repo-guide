import type {
  BriefClaim,
  CodebaseBrief,
  ContentAngle,
  EvidenceRecord,
} from "../analysis/domain.js";

export interface AngleNarrative {
  readonly title: string;
  readonly hook: string;
  readonly whyInteresting: string;
  readonly candidates?: readonly AngleCandidateNarrative[];
}

export interface AngleCandidateNarrative {
  readonly title: string;
  readonly hook: string;
  readonly whyInteresting: string;
  readonly claimIds: readonly string[];
  readonly decision: "select" | "reject";
  readonly rank: number | null;
  readonly rejectionReason: string;
}

function evidenceForClaims(
  claims: readonly BriefClaim[],
  evidence: readonly EvidenceRecord[],
): string[] {
  const allowed = new Set(claims.flatMap((claim) => claim.evidence_ids));
  return evidence
    .filter((record) => allowed.has(record.id))
    .map((record) => record.id)
    .sort();
}

export function buildContentAngles(
  brief: CodebaseBrief,
  evidence: readonly EvidenceRecord[],
  narrative: AngleNarrative,
  generatedAt: string,
): ContentAngle[] {
  const relationshipClaims = brief.claims.filter(
    (claim) => claim.category === "relationship" && claim.status === "verified",
  );
  const fallbackClaims = brief.claims.filter(
    (claim) =>
      (claim.category === "technology" || claim.category === "purpose") &&
      (claim.status === "verified" || claim.status === "documentation"),
  );
  const allowedClaims = new Map(
    brief.claims
      .filter((claim) => claim.status === "verified" || claim.status === "documentation")
      .map((claim) => [claim.id, claim]),
  );

  const buildAngle = (
    candidate: Pick<AngleCandidateNarrative, "title" | "hook" | "whyInteresting">,
    selectedClaims: readonly BriefClaim[],
    id: string,
    rank: number,
    modelRanked: boolean,
  ): ContentAngle | null => {
    if (selectedClaims.length === 0) return null;
    const evidenceIds = evidenceForClaims(selectedClaims, evidence);
    if (evidenceIds.length === 0) return null;
    const confidence = Math.max(
      0,
      Math.min(...selectedClaims.map((claim) => claim.confidence)) - 0.1,
    );
    const includesRelationship = selectedClaims.some(
      (claim) => claim.category === "relationship",
    );
    return {
      content_angle_version: 1,
      id,
      brief_id: brief.brief_id,
      repository_commit_sha: brief.repository.commit_sha,
      generated_at: generatedAt,
      selection_status: "selected",
      rank,
      category: includesRelationship ? "architecture_insight" : "educational_value",
      title: candidate.title,
      hook: candidate.hook,
      why_interesting: candidate.whyInteresting,
      technical_basis: selectedClaims.map((claim) => claim.statement).join(" "),
      target_audience: ["technical_creator", "beginner_developer"],
      claim_ids: selectedClaims.map((claim) => claim.id),
      evidence_ids: evidenceIds,
      script_safe_claim_ids: selectedClaims.map((claim) => claim.id),
      confidence,
      novelty: {
        level: modelRanked ? "unknown" : "medium",
        basis: modelRanked ? "insufficient_evidence" : "repository_internal",
        assessment: modelRanked
          ? "The candidate was ranked within this repository only; novelty was not compared externally."
          : "The angle is selected from verified relationships or repository-local facts.",
        comparison_sources: [],
      },
      scores: {
        evidence_strength: confidence,
        audience_relevance: 0.8,
        teachability: 0.9,
        differentiation: modelRanked ? 0.5 : 0.6,
      },
      caveats: ["Novelty was not compared with other repositories."],
      selection_reason: modelRanked
        ? "The model ranked the wording; the host retained it only after validating every Claim and Evidence ID."
        : "Selected because every included claim has commit-bound evidence.",
    };
  };

  if (narrative.candidates !== undefined) {
    return narrative.candidates
      .filter(
        (candidate) =>
          candidate.decision === "select" &&
          candidate.rank !== null &&
          candidate.claimIds.every((id) => allowedClaims.has(id)),
      )
      .sort((left, right) => (left.rank ?? 99) - (right.rank ?? 99))
      .slice(0, 2)
      .map((candidate, index) => {
        const selectedClaims = [
          ...new Set(candidate.claimIds),
        ]
          .map((id) => allowedClaims.get(id))
          .filter((claim) => claim !== undefined)
          .slice(0, 3);
        return buildAngle(candidate, selectedClaims, `angle_${index + 1}`, index + 1, true);
      })
      .filter((angle) => angle !== null);
  }

  const selectedClaims = (relationshipClaims.length > 0 ? relationshipClaims : fallbackClaims).slice(
    0,
    3,
  );
  const legacy = buildAngle(narrative, selectedClaims, "angle_primary", 1, false);
  return legacy === null ? [] : [legacy];
}
