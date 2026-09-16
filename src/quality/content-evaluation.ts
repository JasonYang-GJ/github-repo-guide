import type { AnalysisBundle } from "../analysis/pipeline.js";
import type { ContentAngle } from "../analysis/domain.js";
import { buildScriptFactTrace, type ScriptFactTrace } from "./script-fact-trace.js";

export type ContentQualityDimensionId =
  | "technical_accuracy"
  | "evidence_grounding"
  | "relevance"
  | "differentiation"
  | "clarity"
  | "non_hype"
  | "shareability"
  | "internal_consistency";

export interface ContentQualityDimension {
  readonly id: ContentQualityDimensionId;
  readonly label: string;
  readonly status: "pass" | "concern" | "fail";
  readonly reason: string;
  readonly evidence: readonly string[];
}

export interface RejectedAngle {
  readonly title: string;
  readonly reason: string;
}

export interface HallucinationFinding {
  readonly text: string;
  readonly reason: string;
  readonly source: "angle" | "script" | "quality_gate";
}

export interface ContentQualityEvaluation {
  readonly content_quality_version: 1;
  readonly dimensions: readonly ContentQualityDimension[];
  readonly rejected_angles: readonly RejectedAngle[];
  readonly hallucination_findings: readonly HallucinationFinding[];
  readonly marketing_claim_isolation: {
    readonly passed: boolean;
    readonly reason: string;
    readonly evidence: readonly string[];
  };
  readonly shareability: "YES" | "PARTIAL" | "NO";
  readonly release_status:
    | "PASS"
    | "BLOCKED_PENDING_HUMAN_REVIEW"
    | "BLOCKED_PENDING_STRONGER_MODEL";
}

export interface AdditionalArtifact {
  readonly name: string;
  readonly content: string;
}

export interface QualityReviewArtifacts {
  readonly evaluation: ContentQualityEvaluation;
  readonly factTrace: ScriptFactTrace;
  readonly files: readonly AdditionalArtifact[];
}

const DIMENSION_ORDER: readonly ContentQualityDimensionId[] = [
  "technical_accuracy",
  "evidence_grounding",
  "relevance",
  "differentiation",
  "clarity",
  "non_hype",
  "shareability",
  "internal_consistency",
];

const LABELS: Readonly<Record<ContentQualityDimensionId, string>> = {
  technical_accuracy: "Technical Accuracy",
  evidence_grounding: "Evidence Grounding",
  relevance: "Relevance",
  differentiation: "Differentiation",
  clarity: "Clarity",
  non_hype: "Non-Hype",
  shareability: "Shareability",
  internal_consistency: "Internal Consistency",
};

const GENERIC_ANGLE_PATTERNS = [
  /how .+ connects (?:its|the) modules/i,
  /what can be verified about/i,
  /.+的模块如何连接/,
  /.+目前能够核验什么/,
  /\b(?:uses?|built with)\s+(?:typescript|json|a cli)\b/i,
  /\b(?:typescript|json|cli)\s+(?:project|tool|architecture)\b/i,
  /.+['’]s core functionality/i,
  /^type safety with /i,
] as const;

const HYPE_PATTERN =
  /(?:史上最快|彻底颠覆|革命性|行业第一|遥遥领先|封神|炸裂|秒杀|强大(?:的)?|值得信赖|轻松管理|正确无误|revolutionary|game[- ]changing|best[- ]in[- ]class|fastest)/i;

function dimension(
  id: ContentQualityDimensionId,
  status: ContentQualityDimension["status"],
  reason: string,
  evidence: readonly string[],
): ContentQualityDimension {
  return { id, label: LABELS[id], status, reason, evidence };
}

function gateStatus(bundle: AnalysisBundle, ids: readonly string[]): {
  readonly passed: boolean;
  readonly evidence: readonly string[];
} {
  const gates = ids.map((id) => bundle.quality.gates.find((gate) => gate.id === id));
  return {
    passed: gates.every((gate) => gate?.passed === true),
    evidence: gates.map((gate, index) =>
      gate === undefined
        ? `${ids[index] ?? "unknown_gate"}: missing`
        : `${gate.id}: ${gate.passed ? "PASS" : `FAIL — ${gate.details}`}`,
    ),
  };
}

function rejectedAngles(angles: readonly ContentAngle[]): RejectedAngle[] {
  return angles
    .filter(
      (angle) =>
        angle.selection_status === "selected" &&
        GENERIC_ANGLE_PATTERNS.some((pattern) => pattern.test(angle.title)),
    )
    .map((angle) => ({
      title: angle.title,
      reason:
        "Rejected by the publication gate because the title is a generic technology/module description, not a repository-specific insight.",
    }));
}

function allRejectedAngles(bundle: AnalysisBundle): RejectedAngle[] {
  const combined = [
    ...bundle.model_insights.rejected_angles,
    ...rejectedAngles(bundle.angles),
  ];
  const seen = new Set<string>();
  return combined.filter((item) => {
    const key = `${item.title}\u0000${item.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function acceptedAngles(
  angles: readonly ContentAngle[],
  rejected: readonly RejectedAngle[],
): ContentAngle[] {
  const rejectedTitles = new Set(rejected.map((item) => item.title));
  return angles.filter(
    (angle) => angle.selection_status === "selected" && !rejectedTitles.has(angle.title),
  );
}

function hypeFindings(bundle: AnalysisBundle): HallucinationFinding[] {
  const findings: HallucinationFinding[] = [];
  for (const angle of bundle.angles) {
    for (const text of [angle.title, angle.hook, angle.why_interesting]) {
      if (HYPE_PATTERN.test(text)) {
        findings.push({
          text,
          reason: "Unsupported hype or a superlative is not backed by comparative evidence.",
          source: "angle",
        });
      }
    }
  }
  for (const segment of bundle.script.segments) {
    if (HYPE_PATTERN.test(segment.text)) {
      findings.push({
        text: segment.text,
        reason: "Unsupported hype or a superlative appears in the script.",
        source: "script",
      });
    }
  }
  for (const item of bundle.model_insights.module_interpretations) {
    for (const text of [item.semantic_name, item.responsibility, item.why_important]) {
      if (HYPE_PATTERN.test(text)) {
        findings.push({
          text,
          reason: "Unsupported hype appears in an unverified model interpretation.",
          source: "angle",
        });
      }
    }
  }
  for (const gate of bundle.quality.gates.filter((candidate) => !candidate.passed)) {
    findings.push({
      text: gate.details,
      reason: `Critical grounding gate ${gate.id} failed.`,
      source: "quality_gate",
    });
  }
  for (const finding of buildScriptFactTrace(bundle).untraced_transition_assertions) {
    findings.push({
      text: finding.sentence,
      reason: finding.reason,
      source: "script",
    });
  }
  return findings;
}

function marketingIsolation(bundle: AnalysisBundle) {
  const documentationClaims = bundle.brief.claims.filter(
    (claim) => claim.status === "documentation",
  );
  const wronglyVerified = bundle.brief.claims.filter(
    (claim) =>
      claim.category === "purpose" &&
      claim.status === "verified" &&
      /describes|readme|documentation/i.test(claim.statement),
  );
  return {
    passed: wronglyVerified.length === 0,
    reason:
      wronglyVerified.length === 0
        ? "Repository-authored descriptions remain documentation and are not promoted to verified runtime truth."
        : "At least one documentation-backed marketing claim was promoted to verified truth.",
    evidence:
      documentationClaims.length > 0
        ? documentationClaims.map((claim) => `${claim.id}: documentation`)
        : ["No repository-authored marketing statement was used as evidence."],
  } as const;
}

function latinRatio(text: string): number {
  const latinWords = text.match(/[A-Za-z][A-Za-z0-9_.:/-]*/g)?.length ?? 0;
  const chineseRuns = text.match(/[\u3400-\u9fff]+/g)?.reduce(
    (total, run) => total + Math.ceil(run.length / 2),
    0,
  ) ?? 0;
  const total = latinWords + chineseRuns;
  return total === 0 ? 0 : latinWords / total;
}

export function evaluateContentQuality(bundle: AnalysisBundle): ContentQualityEvaluation {
  const trace = buildScriptFactTrace(bundle);
  const rejected = allRejectedAngles(bundle);
  const accepted = acceptedAngles(bundle.angles, rejected);
  const hallucinations = hypeFindings(bundle);
  const marketing = marketingIsolation(bundle);
  const accuracyGates = gateStatus(bundle, [
    "schema_validity",
    "evidence_paths",
    "verified_claims",
    "claim_semantics",
    "script_grounding",
  ]);
  const groundingGates = gateStatus(bundle, [
    "evidence_paths",
    "claim_semantics",
    "angle_references",
    "confidence_escalation",
    "script_grounding",
  ]);
  const consistencyGates = gateStatus(bundle, [
    "schema_validity",
    "relationship_nodes",
    "mermaid_grounding",
    "output_binding",
  ]);
  const languageMix = latinRatio(bundle.script.text);
  const hasCoreFactTrace = trace.entries.length > 0;
  const untracedTransitionCount = trace.untraced_transition_assertions.length;
  const hypeCount = hallucinations.filter((finding) =>
    finding.reason.startsWith("Unsupported hype"),
  ).length;
  const hasHype = hypeCount > 0;
  const relevanceStatus = accepted.length > 0 ? "pass" : "fail";
  const differentiationStatus =
    accepted.length === 0
      ? "fail"
      : accepted.every(
            (angle) =>
              angle.novelty.basis === "external_comparison" &&
              angle.novelty.comparison_sources.length > 0,
          )
        ? "pass"
        : "concern";
  const clarityStatus = languageMix > 0.28 ? "concern" : "pass";
  const shareabilityStatus =
    accepted.length === 0 ||
    clarityStatus !== "pass" ||
    hasHype ||
    !hasCoreFactTrace ||
    untracedTransitionCount > 0 ||
    trace.untraced_core_sentences.length > 0
      ? "fail"
      : differentiationStatus === "concern"
        ? "concern"
        : "pass";

  const dimensions: ContentQualityDimension[] = [
    dimension(
      "technical_accuracy",
      accuracyGates.passed && untracedTransitionCount === 0 ? "pass" : "fail",
      accuracyGates.passed && untracedTransitionCount === 0
        ? "Every in-scope technical statement passed the static accuracy gates; this does not claim runtime behavior or benchmark performance."
        : "One or more in-scope technical statements failed a critical accuracy gate.",
      [...accuracyGates.evidence, `untraced_transition_assertions=${untracedTransitionCount}`],
    ),
    dimension(
      "evidence_grounding",
      groundingGates.passed &&
        hasCoreFactTrace &&
        trace.untraced_core_sentences.length === 0 &&
        untracedTransitionCount === 0
        ? "pass"
        : "fail",
      groundingGates.passed &&
      hasCoreFactTrace &&
      trace.untraced_core_sentences.length === 0 &&
      untracedTransitionCount === 0
        ? "Every core script fact resolves to allowed Claim and Evidence IDs at the fixed commit."
        : "At least one content fact is missing an exact evidence trace.",
      [
        ...groundingGates.evidence,
        `fact_trace_entries=${trace.entries.length}`,
        `fact_trace_untraced=${trace.untraced_core_sentences.length}`,
        `untraced_transition_assertions=${untracedTransitionCount}`,
      ],
    ),
    dimension(
      "relevance",
      relevanceStatus,
      accepted.length > 0
        ? "At least one selected angle survives the repository-specific publication filter."
        : "No selected angle survives the publication filter; generic module/technology framing is not enough.",
      [
        `selected_angles=${bundle.angles.filter((angle) => angle.selection_status === "selected").length}`,
        `publication_ready_angles=${accepted.length}`,
      ],
    ),
    dimension(
      "differentiation",
      differentiationStatus,
      differentiationStatus === "pass"
        ? "Differentiation is backed by explicit comparison sources."
        : differentiationStatus === "concern"
          ? "The angle is repository-specific, but novelty was not independently compared."
          : "The available angle is generic and does not expose a distinctive mechanism or tradeoff.",
      [
        `generic_angles_rejected=${rejected.length}`,
        `externally_compared_angles=${accepted.filter((angle) => angle.novelty.comparison_sources.length > 0).length}`,
      ],
    ),
    dimension(
      "clarity",
      clarityStatus,
      clarityStatus === "pass"
        ? "The script is readable in one consistent voice."
        : "The script mixes Chinese narration with too many raw English claim sentences for a polished 60–90 second piece.",
      [
        `estimated_seconds=${bundle.script.estimated_seconds}`,
        `latin_word_ratio=${languageMix.toFixed(3)}`,
      ],
    ),
    dimension(
      "non_hype",
      hasHype ? "fail" : "pass",
      hasHype
        ? "Unsupported superlatives or hype language were found."
        : "No unsupported superlative or hype phrase was detected by the deterministic publication filter.",
      [`hype_findings=${hypeCount}`],
    ),
    dimension(
      "shareability",
      shareabilityStatus,
      shareabilityStatus === "pass"
        ? "The draft has a specific angle, a clear voice, complete fact trace, and no hype finding."
        : shareabilityStatus === "concern"
          ? "The draft is coherent but still needs human differentiation review before publication."
          : "The draft is not publication-ready because its angle or voice fails the minimum content bar.",
      [
        `publication_ready_angles=${accepted.length}`,
        `fact_trace_untraced=${trace.untraced_core_sentences.length}`,
        `clarity=${clarityStatus}`,
        `hype=${hasHype}`,
      ],
    ),
    dimension(
      "internal_consistency",
      consistencyGates.passed ? "pass" : "fail",
      consistencyGates.passed
        ? "Schema, graph, diagram, and commit binding agree with one another."
        : "At least one internal consistency gate failed.",
      consistencyGates.evidence,
    ),
  ];

  if (dimensions.map((item) => item.id).join("|") !== DIMENSION_ORDER.join("|")) {
    throw new Error("Content quality dimensions are incomplete or out of order.");
  }
  const hasFailure = dimensions.some((item) => item.status === "fail") || !marketing.passed;
  const hasConcern = dimensions.some((item) => item.status === "concern");
  return {
    content_quality_version: 1,
    dimensions,
    rejected_angles: rejected,
    hallucination_findings: hallucinations,
    marketing_claim_isolation: marketing,
    shareability: hasFailure ? "NO" : hasConcern ? "PARTIAL" : "YES",
    release_status: hasFailure
      ? "BLOCKED_PENDING_STRONGER_MODEL"
      : hasConcern
        ? "BLOCKED_PENDING_HUMAN_REVIEW"
        : "PASS",
  };
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function markdown(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([\\`*_{}[\]()#+.!|-])/g, "\\$1")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

function renderHumanReview(
  bundle: AnalysisBundle,
  evaluation: ContentQualityEvaluation,
  trace: ScriptFactTrace,
): string {
  const rejected = new Set(evaluation.rejected_angles.map((item) => item.title));
  const topAngles = bundle.angles.filter(
    (angle) => angle.selection_status === "selected" && !rejected.has(angle.title),
  );
  const providers = [
    ...new Set(bundle.provider_invocations.map((invocation) => `${invocation.provider}/${invocation.model}`)),
  ];
  const filesRead = bundle.provider_invocations[0]?.files_read ?? [];
  const contextRows = bundle.provider_invocations.map(
    (invocation) =>
      `| ${markdown(invocation.prompt_stage)} | ${markdown(invocation.files_passed.join(", ") || "validated signals only")} | ${invocation.repository_characters_passed} | ${invocation.input_tokens} | ${markdown(invocation.repair_actions.join(", ") || "none")} |`,
  );
  const traceRows = trace.entries.map(
    (entry) =>
      `| ${markdown(entry.sentence)} | ${markdown(entry.claim_ids.join(", "))} | ${markdown(entry.evidence_ids.join(", "))} | ${markdown(entry.trace_status)} |`,
  );
  const concerns = evaluation.dimensions.filter((item) => item.status !== "pass");
  const modelSummary = bundle.model_insights.project_summary;
  const moduleInterpretations = bundle.model_insights.module_interpretations;

  return `# Human Review — Vertical Slice 02

## Repository and Commit

- Repository: ${markdown(bundle.brief.repository.url)}
- Commit: \`${bundle.brief.repository.commit_sha}\`
- Model provider/model: ${markdown(providers.join(", "))}
- Read scope: ${bundle.brief.analysis_scope.highest_scope}
- Repository code executions: ${bundle.security.repository_code_executions}

## Files Read and Model Context

Files read by the host (${filesRead.length}): ${filesRead.map(markdown).join(", ")}

| Prompt stage | Repository files passed | Repository characters | Input tokens | Repair actions |
|---|---|---:|---:|---|
${contextRows.join("\n")}

## Summary

Evidence-bound host summary: ${markdown(bundle.brief.overview.summary)}

Unverified model interpretation: ${modelSummary === null ? "not used" : markdown(modelSummary)}

## Model Interpretations

Status: ${markdown(bundle.model_insights.interpretation_status)}

${moduleInterpretations.length > 0 ? moduleInterpretations.map((item) => `- ${markdown(item.source_path)} → ${markdown(item.semantic_name)}: ${markdown(item.responsibility)} Why it may matter: ${markdown(item.why_important)}`).join("\n") : "No valid source-bound module interpretation was retained."}

## Top Angles

${topAngles.length > 0 ? topAngles.map((angle) => `- ${markdown(angle.title)} — ${markdown(angle.why_interesting)}`).join("\n") : "No angle passed the publication filter."}

## Rejected Angles

${evaluation.rejected_angles.length > 0 ? evaluation.rejected_angles.map((angle) => `- ${markdown(angle.title)} — ${markdown(angle.reason)}`).join("\n") : "None recorded."}

## Script

${bundle.script.segments.map((segment) => markdown(segment.text)).join("\n\n")}

## Evidence and Fact Trace

| Core sentence | Claim IDs | Evidence IDs | Trace status |
|---|---|---|---|
${traceRows.join("\n")}

## Unknowns

${bundle.brief.unknowns.map((item) => `- ${markdown(item.question)} — ${markdown(item.reason)}`).join("\n")}

## Hallucination Findings

${evaluation.hallucination_findings.length > 0 ? evaluation.hallucination_findings.map((item) => `- ${markdown(item.text)} — ${markdown(item.reason)}`).join("\n") : "No deterministic hallucination indicator was found; semantic human review is still required."}

## Marketing Claim Isolation

${markdown(evaluation.marketing_claim_isolation.reason)}

## Quality Concerns

${concerns.length > 0 ? concerns.map((item) => `- ${item.label} [${item.status}]: ${markdown(item.reason)}`).join("\n") : "No automated concern recorded."}

## Human Reviewer Decision

Reviewer score (1–5): ____

Reviewer concerns: ____

Publication decision (approve / revise / reject): ____
`;
}

export function buildQualityReviewArtifacts(bundle: AnalysisBundle): QualityReviewArtifacts {
  const evaluation = evaluateContentQuality(bundle);
  const factTrace = buildScriptFactTrace(bundle);
  return {
    evaluation,
    factTrace,
    files: [
      { name: "content-quality.json", content: json(evaluation) },
      { name: "script-fact-trace.json", content: json(factTrace) },
      { name: "rejected-angles.json", content: json(evaluation.rejected_angles) },
      { name: "model-insights.json", content: json(bundle.model_insights) },
      { name: "human-review.md", content: renderHumanReview(bundle, evaluation, factTrace) },
    ],
  };
}
