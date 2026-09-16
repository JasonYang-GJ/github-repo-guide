import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = await readFile(resolve("web/local-translation.js"), "utf8");
const app = await readFile(resolve("web/app.js"), "utf8");
const html = await readFile(resolve("web/index.html"), "utf8");
const { COPY, RUNTIME_COPY } = runInNewContext(`${app.slice(app.indexOf("const COPY ="), app.indexOf("function initialLocale()"))}\n({COPY,RUNTIME_COPY})`);
const api = ({ Translator, LanguageDetector }: { Translator?: unknown; LanguageDetector?: unknown } = {}) => runInNewContext(
  `${source.replaceAll("export ", "")}\n({detectGuideLanguage,translateGuide,translateGuideAutomatically,createLocalTranslation})`,
  { AbortController, setTimeout, clearTimeout, Intl, Translator, LanguageDetector },
);
const excerpt = (text: string, format?: string) => ({ text, format, path: "README.md", line_start: 3, line_end: 5, url: "https://github.com/example/project/blob/abc/README.md#L3-L5" });
const guide = () => ({ summary: "Purpose.\n\nSetup for the project.", problem: "This project solves a problem.", audience: ["Developers use this project."],
  introduction: [excerpt("Purpose.")], features: [excerpt("Purpose.")],
  usage: [excerpt("Setup for the project."), excerpt("npm install <name>\nnode app.js", "code")], caveats: [excerpt("The project is not tested.")], model_interpretation: null,
});
const chineseGuide = () => ({ ...guide(), summary: "这个项目帮助用户整理仓库资料。", problem: "它解决阅读项目文档的问题。", audience: ["需要了解项目的用户。"] });

function translator() {
  const calls: string[] = []; const pairs: Array<{ sourceLanguage: string; targetLanguage: string }> = [];
  let created = 0, destroyed = 0;
  return { calls, pairs, get created() { return created; }, get destroyed() { return destroyed; },
    api: { create: async (pair: { sourceLanguage: string; targetLanguage: string }) => {
      pairs.push({ sourceLanguage: pair.sourceLanguage, targetLanguage: pair.targetLanguage });
      created++; return { translate: async (text: string) => { calls.push(text); return `译文：${text}`; }, destroy: () => { destroyed++; } };
    } },
  };
}

function detector(language = "en") {
  let created = 0, destroyed = 0;
  return { get created() { return created; }, get destroyed() { return destroyed; }, api: {
    availability: async () => "available",
    create: async () => {
      created++;
      return { detect: async () => [{ detectedLanguage: language, confidence: 0.99 }], destroy: () => { destroyed++; } };
    },
  } };
}

test("local translation covers prose, deduplicates excerpts and preserves raw sources and code", async () => {
  const engine = translator(); const original = guide(); const before = JSON.stringify(original);
  const phases: string[] = [];
  const value = await api().translateGuide(original, { sourceLanguage: "en", targetLanguage: "zh", translatorApi: engine.api, onProgress: (p: any) => phases.push(p.phase) });
  assert.match(value.summary, /译文：Purpose.*\n\n译文：Setup/s);
  assert.match(value.problem, /译文/); assert.match(value.audience[0], /译文/);
  assert.equal(value.usage[1].text, original.usage[1]!.text);
  assert.equal(value.features[0].url, original.features[0]!.url);
  assert.equal(engine.calls.length, 5); assert.equal(engine.destroyed, 1);
  assert.equal(JSON.stringify(original), before);
  assert.equal(value.engine, "browser-translator"); assert.equal(value.target_language, "zh");
  assert.ok(phases.includes("translating"));
});

test("automatic detection translates only when the top Chinese or English target differs", async () => {
  const englishDetector = detector("en"); const zhTranslator = translator();
  const translated = await api().translateGuideAutomatically(guide(), {
    targetLanguage: "zh", detectorApi: englishDetector.api, translatorApi: zhTranslator.api,
  });
  assert.equal(translated.sourceLanguage, "en");
  assert.equal(translated.translation.target_language, "zh");
  assert.deepEqual(zhTranslator.pairs, [{ sourceLanguage: "en", targetLanguage: "zh" }]);

  const sameDetector = detector("zh"); const unusedTranslator = translator();
  const unchanged = await api().translateGuideAutomatically(chineseGuide(), {
    targetLanguage: "zh", detectorApi: sameDetector.api, translatorApi: unusedTranslator.api,
  });
  assert.equal(unchanged.translation, null);
  assert.equal(unusedTranslator.created, 0);
});

test("a missing detector has a bounded Chinese-English fallback without adding language choices", async () => {
  assert.equal(await api().detectGuideLanguage(guide(), {}), "en");
  assert.equal(await api().detectGuideLanguage(chineseGuide(), {}), "zh");
  assert.doesNotMatch(html, /translation-source|translation-start|translationJapanese|翻译为中文/);
  assert.doesNotMatch(`${html}\n${app}`, /未翻译|无需翻译|已翻译|not translated|no translation is needed/i);
  assert.doesNotMatch(html, /guide-reading-note|translation-disclaimer|report-language-notice/);
  assert.match(html, /id="language-switch"/);
});

test("unsupported browser, invalid pair, empty and oversized input fail without cloud fallback", async () => {
  const { translateGuide } = api();
  await assert.rejects(translateGuide(guide(), { sourceLanguage: "en", targetLanguage: "zh" }), /translationUnsupported/);
  const engine = translator();
  for (const [sourceLanguage, targetLanguage, code] of [["en", "en", "translationSameLanguage"], ["???", "zh", "translationLanguageInvalid"]]) {
    await assert.rejects(translateGuide(guide(), { sourceLanguage, targetLanguage, translatorApi: engine.api }), new RegExp(code!));
  }
  await assert.rejects(translateGuide({ summary: "" }, { sourceLanguage: "en", targetLanguage: "zh", translatorApi: engine.api }), /translationEmpty/);
  await assert.rejects(translateGuide({ summary: "a".repeat(50001) }, { sourceLanguage: "en", targetLanguage: "zh", translatorApi: engine.api }), /translationTooLong/);
  assert.equal(engine.created, 0);
  assert.doesNotMatch(source, /\bfetch\s*\(|localStorage|apiKey|api\/analyze/);
});

test("inline commands, project names and URLs survive damaged placeholders", async () => {
  const original = { ...guide(), name: "Impeccable", summary: "Impeccable: run npx impeccable install; visit https://impeccable.style.",
    translation_literals: ["npx impeccable install"] };
  for (const damage of [false, true]) {
    const result = await api().translateGuide(original, { sourceLanguage: "en", targetLanguage: "zh", translatorApi: {
      create: async () => ({ translate: async (text: string) => `译：${damage ? text.replace(/ZXQCODE\d+QXZ/g, "changed") : text}`, destroy() {} }),
    } });
    assert.match(result.summary, /Impeccable/);
    assert.match(result.summary, /npx impeccable install/);
    assert.match(result.summary, /https:\/\/impeccable.style/);
    assert.doesNotMatch(result.summary, /ZXQCODE|changed/);
  }
});

test("cancellation stops pending translation, destroys the session and leaves originals intact", async () => {
  const controller = new AbortController(); let destroyed = 0; let pending!: () => void;
  const started = new Promise<void>(resolve => { pending = resolve; });
  const promise = api().translateGuide(guide(), { sourceLanguage: "en", targetLanguage: "zh", signal: controller.signal,
    translatorApi: { create: async () => ({ translate: () => { pending(); return new Promise(() => {}); }, destroy: () => { destroyed++; } }) },
  });
  await started; controller.abort();
  await assert.rejects(promise, /translationCancelled/); assert.equal(destroyed, 1);
});

test("download timeout destroys a late-arriving translator", async () => {
  let finish!: (value: unknown) => void; let destroyed = 0;
  await assert.rejects(api().translateGuide(guide(), { sourceLanguage: "en", targetLanguage: "zh", timeoutMs: 5,
    translatorApi: { create: () => new Promise(resolve => { finish = resolve; }) },
  }), /translationTimeout/);
  finish({ destroy: () => { destroyed++; } }); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(destroyed, 1);
});

function page(Translator: any, LanguageDetector: any) {
  const nodes = new Map<string, any>();
  const element = () => ({ textContent: "", value: "", hidden: false, disabled: false, open: true, lang: "", className: "", dataset: {}, children: [] as any[], handlers: {} as Record<string, () => any>,
    append(...items: any[]) { this.children.push(...items); }, replaceChildren(...items: any[]) { this.children = items; },
    addEventListener(name: string, fn: () => any) { this.handlers[name] = fn; },
  });
  const node = (selector: string) => { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); };
  let locale = "zh-CN";
  const t = (key: string, args: Record<string, any> = {}) => {
    let text = COPY[locale][key] ?? RUNTIME_COPY[locale][key];
    assert.equal(typeof text, "string", key);
    for (const [name, value] of Object.entries(args || {})) text = text.replaceAll(`{${name}}`, String(value));
    return text;
  };
  const view = api({ Translator, LanguageDetector }).createLocalTranslation({ document: { querySelector: node, createElement: element }, t });
  return { view, node, show: (report: any, language = "zh-CN") => { locale = language; return view.show(report, language); } };
}
const report = (projectGuide = guide()) => ({ project_guide: projectGuide, repository: { name: "Example", url: "https://github.com/example/project", commit_sha: "abcdef", repository_name: "project" } });

test("the top language action prepares only the common Chinese-English pack without translating content", async () => {
  const engine = translator(); const language = detector("en"); const ui = page(engine.api, language.api);
  await ui.view.prepare("zh-CN");
  await ui.view.prepare("zh-CN");
  assert.equal(engine.created, 1);
  assert.deepEqual(engine.pairs, [{ sourceLanguage: "en", targetLanguage: "zh" }]);
  assert.equal(engine.calls.length, 0);
  await ui.view.prepare("en");
  assert.equal(engine.created, 2);
  assert.deepEqual(engine.pairs[1], { sourceLanguage: "zh", targetLanguage: "en" });
});

test("report display translates automatically from the single top language switch and caches both targets", async () => {
  const engine = translator(); const language = detector("en"); const ui = page(engine.api, language.api); const data = report();
  await ui.show(data);
  assert.equal(engine.created, 1); assert.equal(ui.node("#translation-result").hidden, false);
  assert.equal(ui.node("#translation-status").hidden, true);
  assert.match(ui.node("#project-problem").textContent, /译文/);
  assert.equal(ui.node("#guide-original").open, false);
  assert.equal(ui.view.current().target_language, "zh");
  await ui.show(data, "en");
  assert.equal(ui.node("#translation-result").hidden, true);
  assert.equal(ui.node("#translation-status").hidden, true);
  assert.equal(engine.created, 1);
  await ui.show(data);
  assert.equal(ui.node("#translation-result").hidden, false);
  assert.equal(engine.created, 1);
});

test("switching report or top language cancels an in-flight automatic translation", async () => {
  let finish!: (value: unknown) => void;
  const language = detector("en");
  const ui = page({ create: () => new Promise(resolve => { finish = resolve; }) }, language.api);
  const pending = ui.show(report());
  while (!finish) await Promise.resolve();
  await ui.show(report(), "en");
  finish({ translate: async () => "stale", destroy() {} }); await pending;
  assert.equal(ui.view.current(), undefined);
  assert.equal(ui.node("#translation-result").hidden, true);
});

test("unsupported automatic translation leaves the original readable with only an error message", async () => {
  const language = detector("en"); const ui = page(undefined, language.api);
  await ui.show(report());
  assert.match(ui.node("#translation-status").textContent, /无法自动显示中文/);
  assert.equal(ui.node("#translation-status").dataset.state, "error");
  assert.equal(ui.node("#translation-result").hidden, true);
  assert.equal(ui.node("#guide-original").open, true);
});
