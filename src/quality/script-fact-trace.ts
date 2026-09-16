import type { AnalysisBundle } from "../analysis/pipeline.js";

export interface ScriptFactTraceEntry {
  readonly segment_id: string;
  readonly sentence: string;
  readonly claim_ids: readonly string[];
  readonly evidence_ids: readonly string[];
  readonly trace_status: "exact_claim" | "untraceable";
  readonly reason: string;
}

export interface ScriptFactTrace {
  readonly script_fact_trace_version: 1;
  readonly repository_commit_sha: string;
  readonly entries: readonly ScriptFactTraceEntry[];
  readonly untraced_core_sentences: readonly string[];
  readonly untraced_transition_assertions: readonly {
    readonly segment_id: string;
    readonly sentence: string;
    readonly reason: string;
  }[];
}

const FACTUAL_TRANSITION_PATTERN =
  /(?:确保|正确无误|定义了|被声明|接口|用于处理|支持|避免|提高.*效率|核心函数|配置管理工具|值得信赖|灵活性和安全性|ensures?|supports?|provides?|prevents?|improves?|\bdefined\b|\bdeclared\b|\binterface\b)/i;

export function findUntracedTransitionAssertions(bundle: AnalysisBundle) {
  return bundle.script.segments
    .filter(
      (segment) =>
        segment.kind === "transition" && FACTUAL_TRANSITION_PATTERN.test(segment.text),
    )
    .map((segment) => ({
      segment_id: segment.id,
      sentence: segment.text,
      reason:
        "Transition contains a repository-specific factual or outcome assertion but is not an exact traced Claim sentence.",
    }));
}

export function buildScriptFactTrace(bundle: AnalysisBundle): ScriptFactTrace {
  const claims = new Map(bundle.brief.claims.map((claim) => [claim.id, claim]));
  const evidence = new Set(bundle.evidence.map((record) => record.id));
  const entries = bundle.script.segments
    .filter((segment) => segment.kind === "claim")
    .map((segment): ScriptFactTraceEntry => {
      const referencedClaims = segment.claim_ids
        .map((id) => claims.get(id))
        .filter((claim) => claim !== undefined);
      const expectedEvidence = new Set(
        referencedClaims.flatMap((claim) => claim.evidence_ids),
      );
      const exactClaim = referencedClaims.some((claim) => claim.statement === segment.text);
      const claimsExist = referencedClaims.length === segment.claim_ids.length;
      const evidenceMatches =
        segment.evidence_ids.length > 0 &&
        segment.evidence_ids.every(
          (id) => evidence.has(id) && expectedEvidence.has(id),
        );
      const traced = exactClaim && claimsExist && evidenceMatches;
      return {
        segment_id: segment.id,
        sentence: segment.text,
        claim_ids: segment.claim_ids,
        evidence_ids: segment.evidence_ids,
        trace_status: traced ? "exact_claim" : "untraceable",
        reason: traced
          ? "Sentence exactly matches a referenced claim and its commit-bound evidence."
          : "Sentence, Claim ID, or Evidence ID could not be matched exactly.",
      };
    });
  return {
    script_fact_trace_version: 1,
    repository_commit_sha: bundle.brief.repository.commit_sha,
    entries,
    untraced_core_sentences: entries
      .filter((entry) => entry.trace_status === "untraceable")
      .map((entry) => entry.sentence),
    untraced_transition_assertions: findUntracedTransitionAssertions(bundle),
  };
}
