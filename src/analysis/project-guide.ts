import type { RepositorySnapshot } from "../repo/contracts.js";
import type { AnalysisLocale } from "../presentation/locale.js";
import { localized } from "../presentation/locale.js";
import { boundedText } from "../presentation/bounded-text.js";
import type { BriefNarrative } from "./brief-builder.js";

export interface GuideExcerpt {
  readonly format?: "code";
  readonly text: string;
  readonly path: string;
  readonly line_start: number;
  readonly line_end: number;
  readonly url: string;
}

export interface ProjectGuide {
  readonly translation_literals?: readonly string[];
  readonly name: string;
  readonly summary: string;
  readonly problem: string;
  readonly audience: readonly string[];
  readonly basis: "documentation" | "repository_metadata";
  readonly introduction: readonly GuideExcerpt[];
  readonly features: readonly GuideExcerpt[];
  readonly usage: readonly GuideExcerpt[];
  readonly caveats: readonly GuideExcerpt[];
  readonly coverage: string;
  readonly model_interpretation: {
    readonly summary: string;
    readonly problem: string;
    readonly audience: readonly string[];
  } | null;
}

function plain(value: string): string {
  const code: string[] = [];
  let prefix = "INLINECODEPLACEHOLDER";
  while (value.includes(prefix)) prefix += "X";
  const masked = value.replace(/(`+)([^`\r\n]+)\1/g, (_match, _ticks, text: string) => {
    code.push(text); return `${prefix}${code.length - 1}END`;
  });
  return masked.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, "").replace(/^[\s>*+-]+/, "")
    .replace(/[`*_~]/g, "").replace(/\s+/g, " ").trim()
    .replace(new RegExp(`${prefix}(\\d+)END`, "g"), (_match, index: string) => code[Number(index)] ?? "");
}

export function buildProjectGuide(
  snapshot: RepositorySnapshot,
  locale: AnalysisLocale,
  interpretation?: BriefNarrative,
): ProjectGuide {
  const readmes = snapshot.files.filter(file => file.kind === "documentation" &&
    !file.path.includes("/") && /^readme(?:[_.-][a-z0-9_-]+)?\.md$/i.test(file.path));
  const preferred = (path: string) => locale === "zh-CN"
    ? /[_.-](?:zh|cn|chinese)(?:[_.-]|\.)/i.test(path)
    : /^(?:readme|readme[_.-]en)\.md$/i.test(path);
  const readme = [...readmes].sort((a, b) => Number(preferred(b.path)) - Number(preferred(a.path)) || a.path.localeCompare(b.path))[0];
  const groups = { introduction: [] as GuideExcerpt[], features: [] as GuideExcerpt[], usage: [] as GuideExcerpt[], caveats: [] as GuideExcerpt[], audience: [] as GuideExcerpt[], problem: [] as GuideExcerpt[] };
  const translationLiterals = new Set<string>();
  let name = snapshot.manifest.name;
  if (readme) {
    const lines = readme.text.split(/\r?\n/);
    let section: keyof typeof groups | null = "introduction";
    let fence: string | null = null;
    let codeStart = 0;
    let codeLines: string[] = [];
    let htmlEnd: ">" | "-->" | null = null;
    for (let i = 0; i < lines.length;) {
      const raw = lines[i] ?? "";
      const marker = /^\s*(`{3,}|~{3,})/.exec(raw)?.[1];
      if (marker) {
        if (fence === null) { fence = marker; codeStart = i + 1; codeLines = []; }
        else if (marker[0] === fence[0] && marker.length >= fence.length && raw.trim() === marker) {
          const text = codeLines.join("\n");
          if (section === "usage" && text.trim() && text.length <= 700 && codeLines.length <= 12 && groups.usage.length < 6) {
            groups.usage.push({ format: "code", text, path: readme.path, line_start: codeStart + 1, line_end: i,
              url: `${snapshot.repository.url}/blob/${snapshot.repository.commitSha}/${readme.path.split("/").map(encodeURIComponent).join("/")}#L${codeStart + 1}-L${i}` });
          }
          fence = null;
        }
        i++; continue;
      }
      if (fence !== null) { codeLines.push(raw); i++; continue; }
      // Ignore whole multiline tags/comments, not just the line beginning '<'.
      // A closed anchor may precede an unclosed image tag on the same line.
      if (htmlEnd !== null) {
        if (raw.includes(htmlEnd)) htmlEnd = null;
        i++; continue;
      }
      if (/^\s*</.test(raw)) {
        if (raw.includes("<!--") && !raw.includes("-->")) htmlEnd = "-->";
        else if (raw.lastIndexOf("<") > raw.lastIndexOf(">")) htmlEnd = ">";
        i++; continue;
      }
      const heading = /^\s*(#{1,6})\s+(.+)$/.exec(raw);
      if (heading) {
        const headingText = plain(heading[2] ?? "");
        const title = headingText.replace(/^\d+(?:\.\d+)*[.)、]?\s+/, "");
        if (heading[1] === "#") { name = headingText || name; section = "introduction"; }
        else if (/^(?:overview|about|introduction|what is\b)|概览|概述|简介|介绍/i.test(title)) section = "introduction";
        else if (/feature|capabilit|功能|特性|能力/i.test(title)) section = "features";
        else if (/quick.?start|getting started|install|usage|^run|运行|安装|开始|使用/i.test(title)) section = "usage";
        else if (/limit|caveat|preview|warning|security|safety|注意|限制|预览|安全/i.test(title)) section = "caveats";
        else if (/audience|who.*for|适合|面向|用户|人群/i.test(title)) section = "audience";
        else if (/^why|problem|motivation|解决|为什么|背景/i.test(title)) section = "problem";
        else if (heading[1]!.length <= 2) section = null;
        i++; continue;
      }
      if (!raw.trim() || /^\s*(?:<|\||!\[|\[!\[)/.test(raw) || section === null) { i++; continue; }
      const start = i;
      const parts = [raw];
      i++;
      while (i < lines.length && lines[i]!.trim() && !/^\s*(?:#|```|~~~|[-*+]\s|<|\|)/.test(lines[i]!)) parts.push(lines[i++]!);
      const text = plain(parts.join(" "));
      if (text.length < (/[\u3400-\u9fff]/.test(text) ? 6 : 16) || /^(?:documentation|文档|english|中文)\s*[:：|｜]/i.test(text)) continue;
      if (groups[section].length >= 6) continue;
      for (const match of parts.join(" ").matchAll(/(`+)([^`\r\n]+)\1/g)) {
        const literal = match[2]!;
        if (literal.length <= 700 && translationLiterals.size < 128) translationLiterals.add(literal);
      }
      groups[section].push({ text: boundedText(text, 700), path: readme.path, line_start: start + 1, line_end: i,
        url: `${snapshot.repository.url}/blob/${snapshot.repository.commitSha}/${readme.path.split("/").map(encodeURIComponent).join("/")}#L${start + 1}-L${i}` });
    }
  }
  const summary = groups.introduction.slice(0, 3).map(item => item.text).join("\n\n") || snapshot.manifest.description || localized(locale,
    `这是 ${snapshot.repository.owner} 发布的 ${snapshot.repository.name} 仓库。已读取的说明尚不足以确认其具体用途，请结合下面的源码结构判断。`,
    `This is ${snapshot.repository.name}, published by ${snapshot.repository.owner}. The selected documentation is insufficient to establish its purpose; consult the source structure below.`);
  return {
    translation_literals: [...translationLiterals],
    name, summary,
    problem: groups.problem.map(item => item.text).join("\n\n"),
    audience: groups.audience.map(item => item.text),
    basis: groups.introduction.length ? "documentation" : "repository_metadata",
    introduction: groups.introduction,
    features: groups.features.length ? groups.features : groups.introduction.slice(1),
    usage: groups.usage, caveats: groups.caveats,
    coverage: localized(locale,
      `本次索引包含 ${snapshot.filesSeen} 个文件和目录条目，选读 ${snapshot.files.length} 个文件、约 ${Math.ceil(snapshot.bytesRead / 1024)} KB 正文。这里只说明所选文件覆盖的内容；没有安装或运行这个项目，未验证性能、实际效果或部署是否成功。`,
      `The index contains ${snapshot.filesSeen} entries; ${snapshot.files.length} files and approximately ${Math.ceil(snapshot.bytesRead / 1024)} KB of content were selected. Coverage is limited to those files. The project was not installed or run; performance, outcomes and deployment remain unverified.`),
    model_interpretation: interpretation ? { summary: interpretation.summary, problem: interpretation.problem, audience: interpretation.targetUsers } : null,
  };
}
