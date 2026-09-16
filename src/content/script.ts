import type {
  BriefClaim,
  CodebaseBrief,
  ContentAngle,
  EvidenceRecord,
  GroundedScript,
  ScriptSegment,
} from "../analysis/domain.js";
import { localized, type AnalysisLocale } from "../presentation/locale.js";

export interface ContentNarrative {
  readonly opening: string;
  readonly closing: string;
  readonly claimOrder?: readonly string[];
  readonly transitions?: readonly string[];
}

function speechUnits(text: string): number {
  const chineseCharacters = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const latinWords = text.match(/[A-Za-z0-9_.:/-]+/g)?.length ?? 0;
  return chineseCharacters + latinWords;
}

function estimateSeconds(text: string, locale: AnalysisLocale): number {
  return Math.ceil(speechUnits(text) / (locale === "zh-CN" ? 3.6 : 2.5));
}

function evidenceIdsForClaims(
  claimIds: readonly string[],
  claimById: ReadonlyMap<string, BriefClaim>,
): string[] {
  return [
    ...new Set(
      claimIds.flatMap((claimId) => claimById.get(claimId)?.evidence_ids ?? []),
    ),
  ];
}

function entitiesInText(brief: CodebaseBrief, text: string): string[] {
  const candidates = [
    brief.overview.project_name,
    ...brief.technologies.map((technology) => technology.name),
    ...brief.core_modules.map((module) => module.name),
  ];
  return [...new Set(candidates.filter((candidate) => text.includes(candidate)))];
}

export function buildGroundedScript(
  brief: CodebaseBrief,
  angles: readonly ContentAngle[],
  evidence: readonly EvidenceRecord[],
  narrative: ContentNarrative,
  locale: AnalysisLocale = "zh-CN",
): GroundedScript {
  const claimById = new Map(brief.claims.map((claim) => [claim.id, claim]));
  const evidenceIds = new Set(evidence.map((record) => record.id));
  const primaryAngle = [...angles].sort(
    (left, right) => (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER),
  )[0];
  const angleClaimIds = primaryAngle?.script_safe_claim_ids ?? [];
  const fallbackClaimIds = brief.claims
    .filter((claim) => claim.status === "verified" || claim.status === "documentation")
    .map((claim) => claim.id);
  const availableClaimIds = [...new Set(angleClaimIds.length > 0 ? angleClaimIds : fallbackClaimIds)]
    .filter((claimId) => claimById.has(claimId));
  const safeClaimIds = (
    narrative.claimOrder === undefined
      ? availableClaimIds
      : [...new Set(narrative.claimOrder)].filter((id) => availableClaimIds.includes(id))
  ).slice(0, 3);
  const segments: ScriptSegment[] = [];
  const addSegment = (kind: "claim" | "transition", text: string, claimIds = safeClaimIds) => {
    segments.push({
      id: `segment_${segments.length + 1}`,
      kind,
      text,
      claim_ids: claimIds,
      evidence_ids: evidenceIdsForClaims(claimIds, claimById).filter((id) =>
        evidenceIds.has(id),
      ),
      asserted_entities: entitiesInText(brief, text),
    });
  };

  addSegment("transition", narrative.opening);
  const modelTransitions = (narrative.transitions ?? [])
    .filter((text) => text.trim().length > 0)
    .slice(0, 6);
  let modelTransitionIndex = 0;
  for (const claimId of safeClaimIds) {
    const claim = claimById.get(claimId);
    if (claim !== undefined) {
      addSegment("claim", claim.statement, [claimId]);
      const transition = modelTransitions[modelTransitionIndex];
      if (transition !== undefined) {
        addSegment("transition", transition);
        modelTransitionIndex += 1;
      }
    }
  }

  const groundingTransitions = locale === "zh-CN"
    ? [
        "这里的重点不是把目录名称想象成完整架构，而是让每一句技术判断都能回到固定提交中的具体文件。",
        "导入关系只说明代码之间存在静态连接；它不自动证明运行顺序、调用频率，也不证明线上表现。",
        "符号和行号只有在语法树与原文都能复核时才会进入证据，缺少验证的内容会继续标成未知。",
        "这种做法牺牲了一点故事感，却保住了可追溯性：别人可以沿着同一提交重复检查这些结论。",
        "所以这份说明展示的是当前读取范围内可以确认的部分，不代表已经运行、测试或审计了整个项目。",
        "内容角度也只从已经放行的结论中挑选，后面的文案没有权限重新读取仓库或补充新技术事实。",
      ]
    : [
        "The point is not to turn directory names into an imagined architecture, but to connect each technical statement to a file in the fixed commit.",
        "An import proves a static connection. It does not by itself prove runtime order, call frequency, or production behavior.",
        "Symbols and locations enter the evidence only when both syntax and source text can be checked; unsupported details stay unknown.",
        "This approach trades some storytelling for traceability, so another reader can inspect the same commit and repeat the check.",
        "The explanation covers only what the selected files establish. It does not mean the entire project was run, tested, or audited.",
        "Content angles are selected only from allowed claims; the script cannot read the repository again or introduce new technical facts.",
      ];
  let transitionIndex = 0;
  while (
    estimateSeconds([...segments.map((segment) => segment.text), narrative.closing].join("\n"), locale) < 60 &&
    modelTransitionIndex < modelTransitions.length
  ) {
    addSegment("transition", modelTransitions[modelTransitionIndex] ?? "");
    modelTransitionIndex += 1;
  }
  while (
    estimateSeconds([...segments.map((segment) => segment.text), narrative.closing].join("\n"), locale) < 60 &&
    transitionIndex < groundingTransitions.length
  ) {
    addSegment("transition", groundingTransitions[transitionIndex] ?? "");
    transitionIndex += 1;
  }
  addSegment("transition", narrative.closing);

  const text = segments.map((segment) => segment.text).join("\n");
  return {
    script_version: 1,
    repository_commit_sha: brief.repository.commit_sha,
    title: primaryAngle?.title ?? localized(
      locale,
      `${brief.overview.project_name} 的证据解读`,
      `Evidence-backed view of ${brief.overview.project_name}`,
    ),
    estimated_seconds: estimateSeconds(text, locale),
    segments,
    text,
  };
}
