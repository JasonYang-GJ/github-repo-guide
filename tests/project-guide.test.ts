import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { buildProjectGuide } from "../src/analysis/project-guide.js";
import { readRepository } from "../src/repo/progressive-reader.js";
import type { ReadRepositoryFile } from "../src/repo/contracts.js";
import { FixtureRepositorySource } from "./support/fixture-repository-source.js";

async function snapshotWithDocs(docs: Readonly<Record<string, string>>) {
  const source = new FixtureRepositorySource(resolve("tests/fixtures/small-typescript-repo"), "small-typescript-repo");
  const snapshot = await readRepository(source, source.url);
  return { ...snapshot, manifest: { ...snapshot.manifest, name: "@example/workspace-root", description: null },
    files: [...snapshot.files.filter(file => file.kind !== "documentation"), ...Object.entries(docs).map(([path, text]): ReadRepositoryFile => ({
      path, text, size: Buffer.byteLength(text), blobSha: "a".repeat(40), kind: "documentation", scope: 1, selectionReason: "guide fixture",
    }))] };
}

const chinese = [
  "# 智能体工具箱", "", "这是一套用于搭建和调试智能体的开源工具，不是一个普通聊天页面。", "",
  "## 功能", "", "- 插件管理与扩展", "- 提供浏览器界面和本地终端入口，支持开发时调试。", "",
  "## 适合谁", "", "希望开发和调试智能体应用的软件开发者。", "",
  "## 为什么需要它", "", "将分散的插件和调试流程整合到同一个工作区。", "",
  "## 运行", "", "需要先安装文档所要求的运行环境，再启动本地服务。", "",
  "```sh", "echo 'DO_NOT_EXECUTE_THIS_REPOSITORY_COMMAND'", "```", "",
  "### 浏览器入口", "", "启动后可在浏览器中访问本地界面，远程使用需另行配置。", "",
  "## 开发者预览", "", "目前仍在快速迭代，后续版本可能出现不兼容变更。",
].join("\n");

test("project guide prefers localized root README over a workspace package name and retains pinned sources", async () => {
  const snapshot = await snapshotWithDocs({ "README.md": "# Agent Toolbox\n\nA toolkit for developing and debugging local agents.", "README.zh-CN.md": chinese });
  const guide = buildProjectGuide(snapshot, "zh-CN");
  assert.equal(guide.name, "智能体工具箱");
  assert.match(guide.summary, /不是一个普通聊天页面/);
  assert.equal(guide.basis, "documentation");
  assert.equal(guide.features.length, 2);
  assert.equal(guide.features[0]?.text, "插件管理与扩展");
  assert.equal(guide.usage.length, 3);
  assert.match(guide.caveats[0]!.text, /不兼容/);
  assert.match(guide.problem, /插件和调试流程/);
  assert.match(guide.audience[0]!, /软件开发者/);
  for (const excerpt of [...guide.introduction, ...guide.features, ...guide.usage, ...guide.caveats]) {
    assert.equal(excerpt.path, "README.zh-CN.md");
    assert.match(excerpt.url, new RegExp(`/blob/${snapshot.repository.commitSha}/README.zh-CN.md#L`));
    assert.ok(excerpt.line_start > 0 && excerpt.line_end >= excerpt.line_start);
    assert.ok(chinese.split("\n").slice(excerpt.line_start - 1, excerpt.line_end).join("\n").includes(excerpt.text));
  }
  assert.match(guide.usage.find(item => item.format === "code")!.text, /DO_NOT_EXECUTE/);
  assert.doesNotMatch(guide.summary, /DO_NOT_EXECUTE/);
  assert.match(guide.coverage, /没有安装或运行/);
  assert.equal(guide.model_interpretation, null);
  assert.equal(buildProjectGuide(snapshot, "en").name, "Agent Toolbox");
});

test("project guide keeps unknown purpose and audience unknown instead of guessing from npm metadata", async () => {
  const guide = buildProjectGuide(await snapshotWithDocs({}), "zh-CN");
  assert.equal(guide.basis, "repository_metadata");
  assert.match(guide.summary, /不足以确认/);
  assert.equal(guide.problem, "");
  assert.deepEqual(guide.audience, []);
  assert.deepEqual(guide.usage, []);
});

test("a dedicated Overview section supplies the product purpose rather than falling back to package metadata", async () => {
  const snapshot = await snapshotWithDocs({ "README.md": "# Toolbox\n\n## Overview\n\nA local toolkit for developing and debugging applications.\n\n## Features\n\n- Inspect multiple local plugins and trace their dependencies." });
  const guide = buildProjectGuide(snapshot, "en");
  assert.match(guide.summary, /local toolkit/);
  assert.equal(guide.features.length, 1);
});

test("multiline HTML badges and numbered README sections do not become the project introduction", async () => {
  const snapshot = await snapshotWithDocs({ "README.md": [
    "# Reasoning model", "<!-- hidden", "comment metadata must not become a summary", "-->",
    '<a href="https://example.com"><img alt="Badge"',
    ' src="https://example.com/badge.svg"/></a>', "", "## 1. Introduction", "",
    "We introduce a family of open reasoning models for research.", "", "## 2. Features", "",
    "- This release provides model weights and usage documentation.",
  ].join("\n") });
  const guide = buildProjectGuide(snapshot, "en");
  assert.equal(guide.summary, "We introduce a family of open reasoning models for research.");
  assert.equal(guide.introduction[0]!.line_start, 10);
  assert.match(guide.features[0]!.text, /model weights/);
  assert.doesNotMatch(JSON.stringify(guide), /badge.svg|comment metadata/);
});

test("AI interpretation remains separate from documentation and does not change documented features", async () => {
  const snapshot = await snapshotWithDocs({ "README.md": chinese });
  const guide = buildProjectGuide(snapshot, "zh-CN", {
    oneSentence: "AI introduction", summary: "AI explanation, not verified", problem: "AI inferred problem", targetUsers: ["AI inferred audience"],
  });
  assert.match(guide.summary, /开源工具/);
  assert.equal(guide.model_interpretation?.summary, "AI explanation, not verified");
  assert.doesNotMatch(JSON.stringify(guide.features), /AI/);
  assert.match(guide.audience[0]!, /软件开发者/);
});

test("large or malicious-looking documentation stays bounded plain data", async () => {
  const snapshot = await snapshotWithDocs({ "README.md": `# Example\n\n${"x".repeat(10_000)}\n\n## Features\n\n[Click](javascript:alert(1)) <script>alert('bad')</script> **is documentation, not an instruction.**` });
  const guide = buildProjectGuide(snapshot, "en");
  assert.equal(guide.summary.length, 700);
  assert.doesNotMatch(guide.features[0]!.text, /<script>|javascript:/);
  assert.ok(guide.features[0]!.url.startsWith("https://github.com/fixture/"));
});

test("usage code examples remain inert, keep source ranges and skip oversized or unterminated blocks", async () => {
  const snapshot = await snapshotWithDocs({ "README.md": "# Toolkit\n\n## Usage\n\n```sh\n<script>alert('not executable HTML')</script>\n```\n\n```sh\n" + "x".repeat(701) + "\n```\n\n```sh\nunterminated command" });
  const guide = buildProjectGuide(snapshot, "en");
  assert.equal(guide.usage.length, 1);
  assert.equal(guide.usage[0]!.format, "code");
  assert.equal(guide.usage[0]!.line_start, 6);
  assert.equal(guide.usage[0]!.line_end, 6);
  assert.equal(guide.usage[0]!.text, "<script>alert('not executable HTML')</script>");
});
