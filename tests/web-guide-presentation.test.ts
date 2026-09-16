import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createContext, runInContext, runInNewContext } from "node:vm";
import test from "node:test";

const script = await readFile(resolve("web/app.js"), "utf8");
const html = await readFile(resolve("web/index.html"), "utf8");
const copy = runInNewContext(`${script.slice(script.indexOf("const COPY ="), script.indexOf("function initialLocale()"))}\n({COPY,RUNTIME_COPY})`);
const renderer = script.slice(script.indexOf("function guidePresentation("), script.indexOf("function renderBoundaries("));

function harness() {
  const nodes = new Map<string, any>();
  const element = () => ({ hidden: false, open: false, textContent: "", children: [] as any[], append(...items: any[]) { this.children.push(...items); } });
  const node = (id: string) => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  let locale = "zh-CN";
  const context = createContext({
    document: { querySelector: node },
    setText: (id: string, text: string) => { node(id).textContent = text; },
    clear: (target: any) => { target.children = []; },
    makeElement: (_tag: string, _class: string, text = "") => ({ ...element(), textContent: text }),
    renderTags: (target: any, values: string[]) => { target.children = values; },
    t: (key: string, replacements: Record<string, string> = {}) => {
      let text = copy.COPY[locale][key] ?? copy.RUNTIME_COPY[locale][key];
      for (const [name, value] of Object.entries(replacements)) text = text.replaceAll(`{${name}}`, value);
      return text;
    },
  });
  runInContext(renderer, context);
  return { node, render: (data: unknown, language = "zh-CN") => {
    locale = language; context.data = data; runInContext("renderGuide(data)", context);
  } };
}

function report(summary: string | null = null) {
  return {
    locale: "zh-CN", overview: { one_sentence: "Original introduction", summary: "Original summary" },
    project_guide: {
      summary: "An English README, not a translation.", problem: "Original problem", audience: ["Original audience"],
      introduction: [{ text: "Original introduction", path: "README.md", line_start: 3, line_end: 3, url: "https://github.com/example/repo/blob/abc/README.md#L3" }],
      features: [], usage: [], caveats: [], coverage: "Selected files only",
      model_interpretation: summary === null ? null : { summary, problem: "模型解释的问题", audience: ["模型推断的用户"] },
    },
  };
}

test("basic report presents repository content without translation-process labels", () => {
  const { render, node } = harness(); const data = report(); render(data);
  assert.equal(node("#project-summary").textContent, data.project_guide.summary);
  assert.equal(node("#guide-original").open, true);
  assert.equal(node("#guide-interpretation").hidden, true);
  assert.equal(node("#configure-ai-analysis").hidden, false);
  assert.equal(node("#problem-basis").textContent, "仓库原文");
  assert.match(node("#guide-sources").children[0].href, /#L3$/);
  assert.doesNotMatch(html, /guide-reading-note|未翻译|无需翻译|已翻译/);
});

test("AI interpretation leads, original sources are expandable, and the source summary is unchanged", () => {
  const { render, node } = harness(); const data = report("这是模型生成的中文解读，不是运行结论。"); render(data);
  assert.equal(node("#guide-interpretation").hidden, false);
  assert.equal(node("#guide-original").open, false);
  assert.equal(node("#guide-model-summary").textContent, data.project_guide.model_interpretation!.summary);
  assert.equal(node("#project-summary").textContent, data.project_guide.summary);
  assert.equal(node("#configure-ai-analysis").hidden, true);
  assert.ok(html.indexOf('id="guide-interpretation"') < html.indexOf('id="guide-original"'));
});

test("switching UI language preserves report text, generation language, and an expanded source disclosure", () => {
  const { render, node } = harness(); const data = report("原有中文解读"); render(data);
  node("#guide-original").open = true;
  render(data, "en");
  assert.equal(node("#guide-original").open, true);
  assert.equal(node("#guide-model-summary").textContent, "原有中文解读");
  assert.equal(copy.COPY.en.guideOriginal, "Repository text and sources");
  assert.doesNotMatch(JSON.stringify(copy.COPY), /not translated|no translation is needed/i);
});

test("fallback and empty AI output never display an empty interpretation", () => {
  const { render, node } = harness(); const data = { ...report("  "), analysis: { paid: true, fallback: { used: true } } }; render(data);
  assert.equal(node("#guide-interpretation").hidden, true);
  assert.equal(node("#guide-original").open, true);
});

test("mode help distinguishes model credits from GitHub limits in both languages", () => {
  assert.match(copy.COPY["zh-CN"].basicModeDetail, /没有赠送或消耗的模型额度/);
  assert.match(copy.COPY["zh-CN"].githubCostNote, /访问限额与模型 API 余额是两回事/);
  assert.match(copy.COPY.en.basicModeDetail, /no model credits granted or used/);
  assert.match(copy.COPY.en.aiModeDetail, /does not guarantee greater accuracy/);
  const action = script.slice(script.indexOf('document.querySelector("#configure-ai-analysis").addEventListener'), script.indexOf('document.querySelector("#resume-report").addEventListener'));
  assert.match(action, /providerChanged\(true\)/);
  assert.doesNotMatch(action, /fetch\(|requestSubmit|\.submit\(|paidModelConsent.checked\s*=\s*true/);
});
