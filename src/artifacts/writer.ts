import { randomUUID } from "node:crypto";
import { access, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

import type { ReportBundle as AnalysisBundle } from "../analysis/pipeline.js";
import type { GuideExcerpt, ProjectGuide } from "../analysis/project-guide.js";
import { zhStatus, zhText } from "../presentation/zh-cn.js";
import { localized, type AnalysisLocale } from "../presentation/locale.js";

export interface ArtifactWriteOptions {
  readonly outputRoot: string;
  readonly durationMs: number;
  readonly licenseSpdx: string | null;
  readonly verticalSlice?: "01" | "02";
  readonly status?:
    | "PASS"
    | "BLOCKED_PENDING_HUMAN_REVIEW"
    | "BLOCKED_PENDING_STRONGER_MODEL";
  readonly additionalArtifacts?: readonly {
    readonly name: string;
    readonly content: string;
  }[];
  readonly receiptExtension?: Readonly<Record<string, unknown>>;
  readonly reportNotice?: string;
  readonly reportLocale?: AnalysisLocale;
}

export interface ArtifactWriteResult {
  readonly outputDirectory: string;
  readonly files: readonly string[];
}

export interface FailureReceiptInput {
  readonly validationDetails?: {
    readonly failed_gates: readonly string[];
    readonly field_limits: readonly { readonly field: string; readonly character_limit: number }[];
  };
  readonly outputRoot: string;
  readonly generatedAt: string;
  readonly failureCode: string;
  readonly message: string;
  readonly repositoryUrl: string | null;
  readonly commitSha: string | null;
  readonly failedGates: readonly string[];
  readonly verticalSlice?: "01" | "02";
}

const CORE_ARTIFACT_FILES = [
  "architecture.mmd",
  "codebase-brief.json",
  "content-angles.json",
  "evidence.json",
  "report.md",
  "run-receipt.json",
  "script.json",
] as const;

function additionalArtifacts(options: ArtifactWriteOptions) {
  const artifacts = options.additionalArtifacts ?? [];
  const names = new Set<string>(CORE_ARTIFACT_FILES);
  names.add("project-guide.json");
  for (const artifact of artifacts) {
    if (
      artifact.name !== basename(artifact.name) ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(artifact.name) ||
      names.has(artifact.name)
    ) {
      throw new Error(`Unsafe or duplicate additional artifact name: ${artifact.name}`);
    }
    names.add(artifact.name);
  }
  return artifacts;
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

function tableCell(value: string): string {
  return markdown(value).replace(/\r?\n/g, " ");
}

function renderGuide(guide: ProjectGuide, locale: AnalysisLocale): string {
  const excerptText = (item: GuideExcerpt) => item.format === "code"
    ? `${localized(locale, "文档示例（未执行，使用前请核对原文和环境）：", "Documentation example (not executed; check the source and environment first):")}\n\n${item.text.split("\n").map(line => `    ${line}`).join("\n")}\n\n[${markdown(`${item.path}:${item.line_start}`)}](${item.url})`
    : `- ${markdown(item.text)} [${markdown(`${item.path}:${item.line_start}`)}](${item.url})`;
  const section = (title: string, excerpts: readonly GuideExcerpt[]) =>
    `### ${title}\n\n${excerpts.length ? excerpts.map(excerptText).join("\n\n") : localized(locale, "已读取的说明没有足够信息，暂不补充推测。", "The selected documentation does not provide enough information.")}`;
  const model = guide.model_interpretation;
  return [
    localized(locale, "以下为仓库说明的摘录整理，代表作者声明，未验证实际运行效果。", "The following excerpts reflect the repository author's documentation, not verified runtime outcomes."),
    markdown(guide.summary),
    section(localized(locale, "说明来源", "Introduction sources"), guide.introduction),
    ...(model ? [`### ${localized(locale, "AI 详细解读（需结合原文核对）", "AI interpretation (check against the sources)")}\n\n${markdown(model.summary)}`] : []),
    `### ${localized(locale, "解决的问题", "Problem addressed")}${model?.problem ? localized(locale, "（AI 辅助判断，未验证）", " (AI interpretation, unverified)") : ""}\n\n${markdown(model?.problem || guide.problem || localized(locale, "已读取的说明没有明确陈述。", "Not explicitly stated in the selected documentation."))}`,
    `### ${localized(locale, "适合谁", "Audience")}${model?.audience.length ? localized(locale, "（AI 辅助判断，未验证）", " (AI interpretation, unverified)") : ""}\n\n${(model?.audience.length ? model.audience : guide.audience).map(item => `- ${markdown(item)}`).join("\n") || localized(locale, "暂未从说明中确认；不根据编程语言猜测用户。", "Not established by the documentation; language alone does not determine the audience.")}`,
    section(localized(locale, "主要功能与特点（文档声明）", "Capabilities (documented)"), guide.features),
    section(localized(locale, "怎样开始使用（文档说明）", "Getting started (documented)"), guide.usage),
    section(localized(locale, "使用前注意", "Before using it"), guide.caveats),
    markdown(guide.coverage),
  ].join("\n\n");
}

function renderReport(
  bundle: AnalysisBundle,
  reportNotice?: string,
  locale: AnalysisLocale = "zh-CN",
): string {
  const localText = locale === "zh-CN" ? zhText : (text: string) => text;
  const localStatus = locale === "zh-CN" ? zhStatus : (status: string) => status;
  const evidenceRows = bundle.evidence.map((record) => {
    const locator = record.locator;
    const location =
      locator === undefined
        ? localized(locale, "分析推理", "analysis reasoning")
        : `${locator.source_path}${
            locator.line_start === undefined
              ? ""
              : `:${locator.line_start}${
                  locator.line_end === undefined || locator.line_end === locator.line_start
                    ? ""
                    : `-${locator.line_end}`
                }`
          }`;
    return `| ${tableCell(record.id)} | ${tableCell(localStatus(record.verification_status))} | ${tableCell(location)} | ${tableCell(localText(record.claim))} |`;
  });
  const angleSections = bundle.angles.map(
    (angle) =>
      `### ${markdown(angle.title)}\n\n${markdown(angle.hook)}\n\n${markdown(angle.why_interesting)}`,
  );

  const notice =
    reportNotice === undefined
      ? ""
      : `\n> **${localized(locale, "分析模式说明：", "Analysis mode note:")}** ${markdown(reportNotice)}\n`;

  const scriptSection = bundle.script === null ? "" : `## ${localized(locale, "可选口播稿", "Optional spoken explainer")}\n\n${localized(locale, `预计口播时长：${bundle.script.estimated_seconds} 秒。`, `Estimated speaking time: ${bundle.script.estimated_seconds} seconds.`)}\n\n${bundle.script.segments.map(segment => markdown(localText(segment.text))).join("\n\n")}\n`;

  return `# ${markdown(bundle.project_guide?.name ?? bundle.brief.overview.project_name)} — ${localized(locale, "仓库分析报告", "Repository analysis report")}

${localized(locale, "固定提交：", "Fixed commit:")} \`${bundle.brief.repository.commit_sha}\`
${notice}

## ${localized(locale, "项目概览", "Project overview")}

${bundle.project_guide ? renderGuide(bundle.project_guide, locale) : `${markdown(bundle.brief.overview.one_sentence)}\n\n${markdown(bundle.brief.overview.summary)}`}

## ${localized(locale, "分析范围", "Analysis scope")}

${localized(
  locale,
  `本次在 Scope ${bundle.brief.analysis_scope.highest_scope} 中读取了 ${bundle.brief.analysis_scope.files_read} 个选定文件，只使用仓库配置、文件树、符号和本地导入关系做静态验证，没有运行目标仓库代码。`,
  `The analysis read ${bundle.brief.analysis_scope.files_read} selected files at Scope ${bundle.brief.analysis_scope.highest_scope}. It used repository configuration, the file tree, symbols, and local import relationships for static verification. No target-repository code was executed.`,
)}

## ${localized(locale, "架构关系", "Architecture relationships")}

\`\`\`mermaid
${bundle.mermaid.trimEnd()}
\`\`\`

## ${localized(locale, "证据", "Evidence")}

| ID | ${localized(locale, "状态", "Status")} | ${localized(locale, "位置", "Location")} | ${localized(locale, "结论", "Conclusion")} |
|---|---|---|---|
${evidenceRows.join("\n")}

## ${localized(locale, "值得讲解的内容", "Topics worth explaining")}

${angleSections.length > 0 ? angleSections.join("\n\n") : localized(locale, "没有内容角度达到证据门槛。", "No content angle met the evidence threshold.")}

${scriptSection}

## ${localized(locale, "分析边界", "Analysis limits")}

${bundle.brief.limitations.map((item) => `- ${markdown(localText(item.description))} ${markdown(localText(item.impact))}`).join("\n")}
`;
}

function assertChild(root: string, candidate: string): void {
  const pathFromRoot = relative(root, candidate);
  if (pathFromRoot === "" || pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    throw new Error("Artifact path escaped its output root");
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function writeArtifacts(
  bundle: AnalysisBundle,
  options: ArtifactWriteOptions,
): Promise<ArtifactWriteResult> {
  const additional = additionalArtifacts(options);
  const artifactFiles = [
    ...CORE_ARTIFACT_FILES.filter(name => name !== "script.json" || bundle.script !== null),
    ...(bundle.project_guide ? ["project-guide.json"] : []),
    ...additional.map((artifact) => artifact.name),
  ];
  const root = resolve(options.outputRoot);
  await mkdir(root, { recursive: true });
  const repositoryDirectory = `${bundle.brief.repository.owner}-${bundle.brief.repository.name}`;
  const target = resolve(
    root,
    repositoryDirectory,
    bundle.brief.repository.commit_sha.slice(0, 12),
  );
  assertChild(root, target);
  if (await pathExists(target)) {
    throw new Error(`Artifact directory already exists: ${target}`);
  }

  const temporary = resolve(root, `.tmp-${randomUUID()}`);
  assertChild(root, temporary);
  await mkdir(temporary, { recursive: false });
  try {
    const receiptCore = {
      vertical_slice: options.verticalSlice ?? "01",
      status: options.status ?? "PASS",
      generated_at: bundle.brief.generated_at,
      repository_url: bundle.brief.repository.url,
      commit_sha: bundle.brief.repository.commit_sha,
      default_branch: bundle.brief.repository.default_branch,
      license_spdx: options.licenseSpdx,
      duration_ms: Math.max(0, Math.round(options.durationMs)),
      tree_entry_count: bundle.brief.analysis_scope.files_seen,
      files_read_count: bundle.brief.analysis_scope.files_read,
      files_read: bundle.brief.analysis_scope.scope_events.flatMap(
        (event) => event.selected_paths,
      ),
      highest_scope: bundle.brief.analysis_scope.highest_scope,
      bytes_read: bundle.brief.analysis_scope.bytes_read,
      provider_invocations: bundle.provider_invocations,
      quality_gates: bundle.quality.gates,
      repository_code_executions: bundle.security.repository_code_executions,
      network_hosts: bundle.security.network_hosts,
      artifacts: artifactFiles,
    };
    const receiptExtension = options.receiptExtension ?? {};
    for (const key of Object.keys(receiptExtension)) {
      if (key in receiptCore) {
        throw new Error(`Receipt extension cannot replace core field: ${key}`);
      }
    }
    const receipt = { ...receiptCore, ...receiptExtension };
    await Promise.all([
      writeFile(join(temporary, "architecture.mmd"), bundle.mermaid, "utf8"),
      writeFile(join(temporary, "codebase-brief.json"), json(bundle.brief), "utf8"),
      writeFile(join(temporary, "content-angles.json"), json(bundle.angles), "utf8"),
      writeFile(join(temporary, "evidence.json"), json(bundle.evidence), "utf8"),
      writeFile(
        join(temporary, "report.md"),
        renderReport(bundle, options.reportNotice, options.reportLocale),
        "utf8",
      ),
      writeFile(join(temporary, "run-receipt.json"), json(receipt), "utf8"),
      ...(bundle.script === null ? [] : [writeFile(join(temporary, "script.json"), json(bundle.script), "utf8")]),
      ...(bundle.project_guide ? [writeFile(join(temporary, "project-guide.json"), json(bundle.project_guide), "utf8")] : []),
      ...additional.map((artifact) =>
        writeFile(join(temporary, artifact.name), artifact.content, "utf8"),
      ),
    ]);
    await mkdir(resolve(target, ".."), { recursive: true });
    await rename(temporary, target);
    return { outputDirectory: target, files: artifactFiles };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

export async function writeFailureReceipt(input: FailureReceiptInput): Promise<string> {
  const root = resolve(input.outputRoot);
  const target = resolve(root, "failures", `failure-${randomUUID()}`);
  assertChild(root, target);
  await mkdir(target, { recursive: true });
  const path = join(target, "failure-receipt.json");
  await writeFile(
    path,
    json({
      vertical_slice: input.verticalSlice ?? "01",
      status: "FAIL",
      generated_at: input.generatedAt,
      failure_code: input.failureCode,
      message: input.message,
      repository_url: input.repositoryUrl,
      commit_sha: input.commitSha,
      failed_gates: input.failedGates,
      ...(input.validationDetails === undefined ? {} : { validation_details: input.validationDetails }),
      normal_artifacts_written: false,
      repository_code_executions: 0,
    }),
    "utf8",
  );
  return path;
}
