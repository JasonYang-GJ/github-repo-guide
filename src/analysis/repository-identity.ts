import type { ReadRepositoryFile, RepositorySnapshot } from "../repo/contracts.js";

export interface RepositoryIdentity {
  readonly displayName: string;
  readonly description: string;
  readonly problem: string;
  readonly source: "root_readme" | "manifest";
  readonly sourceFile: ReadRepositoryFile;
  readonly lineStart?: number;
  readonly lineEnd?: number;
  readonly excerpt: string;
  readonly analyzedScope: string;
  readonly analyzedScopeEn: string;
}

function stripMarkdown(value: string): string {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function displayNameFromHeading(value: string): string {
  const plain = stripMarkdown(value);
  const bilingual = /^([\u3400-\u9fff][\u3400-\u9fff\s·]*)\s+([A-Za-z][A-Za-z0-9 ._-]+)$/.exec(
    plain,
  );
  return bilingual === null
    ? plain
    : `${bilingual[1]?.trim() ?? ""}（${bilingual[2]?.trim() ?? ""}）`;
}

interface ReadmeParagraph {
  readonly text: string;
  readonly lineStart: number;
  readonly lineEnd: number;
}

function readmeParagraphs(lines: readonly string[], headingLine: number): ReadmeParagraph[] {
  const paragraphs: ReadmeParagraph[] = [];
  let index = headingLine + 1;
  while (index < lines.length) {
    const raw = lines[index] ?? "";
    if (
      raw.trim().length === 0 ||
      /^\s*(?:#|```|~~~|\||!\[|\[!\[|<)/.test(raw)
    ) {
      index += 1;
      continue;
    }
    const start = index;
    const parts: string[] = [];
    while (index < lines.length) {
      const line = lines[index] ?? "";
      if (line.trim().length === 0 || /^\s*(?:#|```|~~~|\|)/.test(line)) break;
      parts.push(line.trim());
      index += 1;
    }
    const text = stripMarkdown(parts.join(" "));
    if (text.length >= 12) {
      paragraphs.push({ text, lineStart: start + 1, lineEnd: index });
    }
    index += 1;
  }
  return paragraphs;
}

function rootReadme(snapshot: RepositorySnapshot): ReadRepositoryFile | undefined {
  return snapshot.files.find(
    (file) =>
      file.kind === "documentation" &&
      !file.path.includes("/") &&
      /^readme(?:[_\.-][a-z0-9_-]+)?\.md$/i.test(file.path),
  );
}

export function deriveRepositoryIdentity(snapshot: RepositorySnapshot): RepositoryIdentity {
  const manifestFile = snapshot.files.find(
    (file) => file.path === snapshot.manifest.manifestPath,
  );
  if (manifestFile === undefined) {
    throw new Error(`Selected manifest was not read: ${snapshot.manifest.manifestPath}`);
  }

  const generic = snapshot.manifest.format === "generic";
  const ambiguousPackages =
    snapshot.manifest.genericReason === "ambiguous_package_manifests";
  const analyzedScope =
    generic
      ? ambiguousPackages
        ? "通用仓库文本范围（检测到多个同层 package.json，未擅自选择子项目）"
        : "通用仓库文本范围（未检测到 package.json）"
      : snapshot.manifest.packageRoot.length === 0
      ? `TypeScript/npm 代码范围（${snapshot.manifest.manifestPath}）`
      : `前端 TypeScript 子包 ${snapshot.manifest.name}（${snapshot.manifest.manifestPath}）`;
  const analyzedScopeEn =
    generic
      ? ambiguousPackages
        ? "the bounded generic repository text scope (multiple peer package.json files; no subproject was chosen arbitrarily)"
        : "the bounded generic repository text scope (no package.json detected)"
      : snapshot.manifest.packageRoot.length === 0
      ? `the TypeScript/npm code scope (${snapshot.manifest.manifestPath})`
      : `the frontend TypeScript package ${snapshot.manifest.name} (${snapshot.manifest.manifestPath})`;
  const readme = rootReadme(snapshot);
  if ((generic || snapshot.manifest.packageRoot.length > 0) && readme !== undefined) {
    const lines = readme.text.split(/\r?\n/);
    const headingIndex = lines.findIndex((line) => /^#\s+\S/.test(line));
    if (headingIndex >= 0) {
      const heading = /^#\s+(.+)$/.exec(lines[headingIndex] ?? "")?.[1] ?? "";
      const paragraphs = readmeParagraphs(lines, headingIndex);
      const description =
        paragraphs.find((paragraph) =>
          /(?:是一款|是一个|是一种|\bis\s+(?:an?|the)\b|\bprovides?\b|\bhelps?\b)/i.test(
            paragraph.text,
          ),
        ) ?? paragraphs[0];
      if (heading.trim().length > 0 && description !== undefined) {
        const problem = paragraphs.find(
          (paragraph) => paragraph !== description && paragraph.lineStart < description.lineStart,
        );
        const evidenceStart = problem?.lineStart ?? description.lineStart;
        return {
          displayName: displayNameFromHeading(heading),
          description: description.text,
          problem: problem?.text ?? "",
          source: "root_readme",
          sourceFile: readme,
          lineStart: evidenceStart,
          lineEnd: description.lineEnd,
          excerpt: lines.slice(evidenceStart - 1, description.lineEnd).join("\n").slice(0, 1200),
          analyzedScope,
          analyzedScopeEn,
        };
      }
    }
  }

  const description =
    snapshot.manifest.description ??
    (generic
      ? `A public GitHub repository named ${snapshot.repository.name}.`
      : `一个名为 ${snapshot.manifest.name} 的 npm 子包。`);
  return {
    displayName: snapshot.manifest.name,
    description,
    problem: "",
    source: "manifest",
    sourceFile: manifestFile,
    excerpt: JSON.stringify(snapshot.manifest.description ?? snapshot.manifest.name),
    analyzedScope,
    analyzedScopeEn,
  };
}
