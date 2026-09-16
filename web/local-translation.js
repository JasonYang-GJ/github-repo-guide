// Optional, on-device reading aid. Never sends content or keys to a server.
export class TranslationError extends Error {
  constructor(code) { super(code); this.code = code; }
}

function languageCode(value) {
  try {
    const canonical = Intl.getCanonicalLocales(String(value).trim())[0];
    return canonical.toLowerCase().split("-")[0];
  } catch {
    throw new TranslationError("translationLanguageInvalid");
  }
}

function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) { promise.catch(() => {}); reject(signal.reason); return; }
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function guideTexts(guide) {
  const values = [];
  const add = value => { if (typeof value === "string" && value.trim()) values.push(value.trim()); };
  const model = guide.model_interpretation;
  add(model?.summary); add(model?.problem);
  for (const value of model?.audience || []) add(value);
  add(guide.summary); add(guide.problem);
  for (const value of guide.audience || []) add(value);
  for (const key of ["introduction", "features", "usage", "caveats"]) {
    for (const item of guide[key] || []) if (item.format !== "code") add(item.text);
  }
  return values;
}

function fallbackLanguage(text) {
  const count = pattern => text.match(pattern)?.length || 0;
  const kana = count(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu);
  const hangul = count(/\p{Script=Hangul}/gu);
  const han = count(/\p{Script=Han}/gu);
  const latin = count(/\p{Script=Latin}/gu);
  if (kana >= 2) return "ja";
  if (hangul >= 2) return "ko";
  if (han >= 6 && han >= latin * 0.08) return "zh";
  const englishWords = count(/\b(the|and|to|of|in|for|with|is|this|that|from|use|you|project|install)\b/gi);
  if (latin >= 24 && englishWords >= 2) return "en";
  return null;
}

export async function detectGuideLanguage(guide, {
  detectorApi = globalThis.LanguageDetector,
  signal,
  onProgress = () => {},
  timeoutMs = 30000,
} = {}) {
  const sample = guideTexts(guide).join("\n\n").slice(0, 12000);
  if (!sample) throw new TranslationError("translationEmpty");
  const fallback = fallbackLanguage(sample);
  if (!detectorApi?.create) {
    if (fallback) return fallback;
    throw new TranslationError("translationLanguageInvalid");
  }

  const controller = new AbortController();
  const cancel = () => controller.abort(new TranslationError("translationCancelled"));
  if (signal?.aborted) cancel();
  signal?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new TranslationError("translationTimeout")),
    timeoutMs,
  );
  let detector;
  try {
    controller.signal.throwIfAborted();
    onProgress({ phase: "detecting" });
    if (typeof detectorApi.availability === "function") {
      const availability = await abortable(
        Promise.resolve(detectorApi.availability()),
        controller.signal,
      );
      if (availability === "unavailable") {
        if (fallback) return fallback;
        throw new TranslationError("translationLanguageInvalid");
      }
    }
    const creation = Promise.resolve(detectorApi.create({
      signal: controller.signal,
      monitor: monitor => monitor.addEventListener("downloadprogress", event => {
        if (!controller.signal.aborted) {
          onProgress({
            phase: "detectionDownloading",
            percent: Math.round(Math.min(1, Math.max(0, event.loaded)) * 100),
          });
        }
      }),
    }));
    creation.then(value => { if (controller.signal.aborted) value.destroy?.(); }, () => {});
    detector = await abortable(creation, controller.signal);
    const results = await abortable(Promise.resolve(detector.detect(sample)), controller.signal);
    const best = Array.isArray(results)
      ? results.find(item => typeof item?.detectedLanguage === "string" && (item.confidence === undefined || item.confidence >= 0.2))
      : null;
    if (best) return languageCode(best.detectedLanguage);
    if (fallback) return fallback;
    throw new TranslationError("translationLanguageInvalid");
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    if (error instanceof TranslationError) throw error;
    if (fallback) return fallback;
    throw new TranslationError("translationLanguageInvalid");
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
    detector?.destroy?.();
  }
}

async function translateProtected(text, guide, translator, signal) {
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const literals = [...(guide.translation_literals || []), guide.name]
    .filter(value => typeof value === "string" && value.length > 1 && value.length <= 700)
    .slice(0, 129);
  literals.sort((a, b) => b.length - a.length);
  // Keep technical literals intact even when the browser translates product names.
  const pattern = new RegExp(`(${["https?:\\/\\/[^\\s<>]+", "[a-zA-Z0-9_/-]+(?:\\.[a-zA-Z0-9_-]+)+", ...literals.map(escape)].join("|")})`, "gi");
  const parts = text.split(pattern);
  if (parts.length === 1) return abortable(Promise.resolve(translator.translate(text, { signal })), signal);
  let prefix = "ZXQCODE";
  while (text.includes(prefix)) prefix += "X";
  const protectedValues = [];
  const masked = parts.map((part, index) => {
    if (index % 2 === 0) return part;
    protectedValues.push(part); return `${prefix}${protectedValues.length - 1}QXZ`;
  }).join("");
  const result = await abortable(Promise.resolve(translator.translate(masked, { signal })), signal);
  if (typeof result === "string" && protectedValues.every((_part, index) => result.split(`${prefix}${index}QXZ`).length === 2)) {
    return result.replace(new RegExp(`${prefix}(\\d+)QXZ`, "g"), (_match, index) => protectedValues[Number(index)]);
  }
  // If placeholders are changed or dropped, translate prose separately rather
  // than publishing a corrupted command. No cloud calls and no code execution.
  const translated = [];
  for (const [index, part] of parts.entries()) {
    signal.throwIfAborted();
    if (index % 2 || !/[\p{L}]/u.test(part)) translated.push(part);
    else {
      const value = await abortable(Promise.resolve(translator.translate(part.trim(), { signal })), signal);
      if (typeof value !== "string" || !value.trim()) throw new TranslationError("translationFailed");
      translated.push(`${part.match(/^\s*/)[0]}${value.trim()}${part.match(/\s*$/)[0]}`);
    }
  }
  return translated.join("");
}

export async function translateGuide(guide, {
  sourceLanguage,
  targetLanguage,
  translatorApi = globalThis.Translator,
  signal,
  onProgress = () => {},
  timeoutMs = 120000,
}) {
  sourceLanguage = languageCode(sourceLanguage);
  targetLanguage = languageCode(targetLanguage);
  if (!sourceLanguage || !targetLanguage) throw new TranslationError("translationLanguageInvalid");
  if (sourceLanguage === targetLanguage) throw new TranslationError("translationSameLanguage");
  if (!translatorApi?.create) throw new TranslationError("translationUnsupported");
  const texts = new Set();
  const collect = text => { for (const part of (text || "").split(/\n\n+/)) if (part.trim()) texts.add(part); };
  const model = guide.model_interpretation;
  collect(model?.summary); collect(model?.problem);
  for (const text of model?.audience || []) collect(text);
  collect(guide.summary); collect(guide.problem);
  for (const text of guide.audience || []) collect(text);
  for (const key of ["introduction", "features", "usage", "caveats"]) {
    for (const item of guide[key] || []) if (item.format !== "code") collect(item.text);
  }
  if (!texts.size) throw new TranslationError("translationEmpty");
  if (texts.size > 128 || [...texts].reduce((sum, text) => sum + text.length, 0) > 50000) {
    throw new TranslationError("translationTooLong");
  }
  const controller = new AbortController();
  const cancel = () => controller.abort(new TranslationError("translationCancelled"));
  if (signal?.aborted) cancel();
  signal?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(() => controller.abort(new TranslationError("translationTimeout")), timeoutMs);
  let translator;
  try {
    controller.signal.throwIfAborted();
    onProgress({ phase: "preparing" });
    const creation = Promise.resolve(translatorApi.create({
      sourceLanguage,
      targetLanguage,
      signal: controller.signal,
      monitor: monitor => monitor.addEventListener("downloadprogress", event => {
        if (!controller.signal.aborted) {
          onProgress({ phase: "downloading", percent: Math.round(Math.min(1, Math.max(0, event.loaded)) * 100) });
        }
      }),
    }));
    creation.then(value => { if (controller.signal.aborted) value.destroy?.(); }, () => {});
    translator = await abortable(creation, controller.signal);
    const translated = new Map();
    for (const text of texts) {
      controller.signal.throwIfAborted();
      onProgress({ phase: "translating", current: translated.size + 1, total: texts.size });
      const result = await translateProtected(text, guide, translator, controller.signal);
      if (typeof result !== "string" || !result.trim() || result.length > 50000) throw new TranslationError("translationFailed");
      translated.set(text, result.trim());
    }
    const convert = text => (text || "").split(/\n\n+/).map(part => translated.get(part) ?? part).join("\n\n");
    const excerpts = key => (guide[key] || []).map(item => ({ ...item, text: item.format === "code" ? item.text : convert(item.text) }));
    return {
      engine: "browser-translator",
      source_language: sourceLanguage,
      target_language: targetLanguage,
      summary: convert(guide.summary),
      problem: convert(guide.problem),
      audience: (guide.audience || []).map(convert),
      introduction: excerpts("introduction"),
      features: excerpts("features"),
      usage: excerpts("usage"),
      caveats: excerpts("caveats"),
      model_interpretation: model ? {
        ...model,
        summary: convert(model.summary),
        problem: convert(model.problem),
        audience: (model.audience || []).map(convert),
      } : null,
    };
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    if (error instanceof TranslationError) throw error;
    throw new TranslationError(error?.name === "NotSupportedError" ? "translationPairUnsupported" : "translationFailed");
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
    translator?.destroy?.();
  }
}

export async function translateGuideAutomatically(guide, {
  targetLanguage,
  detectorApi = globalThis.LanguageDetector,
  translatorApi = globalThis.Translator,
  signal,
  onProgress = () => {},
}) {
  targetLanguage = languageCode(targetLanguage);
  if (!["zh", "en"].includes(targetLanguage)) throw new TranslationError("translationLanguageInvalid");
  const sourceLanguage = await detectGuideLanguage(guide, { detectorApi, signal, onProgress });
  if (sourceLanguage === targetLanguage) return { sourceLanguage, translation: null };
  const translation = await translateGuide(guide, {
    sourceLanguage,
    targetLanguage,
    translatorApi,
    signal,
    onProgress,
  });
  return { sourceLanguage, translation };
}

export function createLocalTranslation({ document, t }) {
  const node = id => document.querySelector(`#${id}`);
  const cache = new WeakMap();
  const prepared = new Map();
  let report = null, target = "zh", active = null, status = null;
  const entry = () => cache.get(report)?.get(target);
  const result = () => entry()?.translation || undefined;
  const element = (tag, text, className = "") => {
    const value = document.createElement(tag); value.textContent = text; value.className = className; return value;
  };
  const link = item => {
    const value = element("a", `${item.path}:${item.line_start}–${item.line_end}`, "guide-source");
    value.href = item.url; value.target = "_blank"; value.rel = "noopener noreferrer"; return value;
  };
  const render = () => {
    const cached = entry();
    const value = cached?.translation;
    const displayStatus = status?.state === "error" ? status : null;
    const statusNode = node("translation-status");
    statusNode.hidden = !displayStatus;
    statusNode.textContent = displayStatus ? t(displayStatus.key, displayStatus.args) : "";
    if (displayStatus) statusNode.dataset.state = displayStatus.state || "working";
    else delete statusNode.dataset.state;
    node("translation-result").hidden = !value;
    node("translation-result").lang = target;
    node("translation-body").replaceChildren();
    const guide = report?.project_guide;
    node("translation-original-extra").hidden = !value;
    node("translation-original-extra").replaceChildren();
    if (!value || !guide) return;

    const translatedModel = value.model_interpretation;
    if (translatedModel?.summary?.trim()) node("guide-model-summary").textContent = translatedModel.summary;
    const problem = translatedModel?.problem || value.problem;
    const audience = translatedModel?.audience?.length ? translatedModel.audience : value.audience;
    node("project-problem").textContent = problem || t("unconfirmed");
    node("problem-basis").textContent = problem ? t("guideDocumented") : "";
    node("audience-basis").textContent = audience?.length ? t("guideDocumented") : "";
    node("target-users").replaceChildren(...(audience?.length ? audience : [t("unconfirmed")]).map(text => element("span", text, "tag")));
    for (const [title, text] of [["problemHeading", guide.problem], ["audienceHeading", (guide.audience || []).join("\n\n")]]) {
      if (text) node("translation-original-extra").append(element("h4", t(title)), element("p", text, "lead-copy"));
    }

    const body = node("translation-body");
    body.append(element("p", value.summary, "lead-copy"));
    const sources = element("div", "", "guide-sources");
    for (const item of value.introduction.slice(0, 3)) sources.append(link(item));
    body.append(sources);
    const details = element("div", "", "guide-details");
    for (const [name, title] of [["features", "guideFeatures"], ["usage", "guideUsage"], ["caveats", "guideCaveats"]]) {
      const items = value[name];
      if (!items.length) continue;
      const section = element("section", ""); section.append(element("h4", t(title)));
      const list = element("ul", "");
      for (const item of items) {
        const row = element("li", "");
        if (item.format === "code") {
          row.append(element("p", t("guideCode"), "guide-label"));
          const code = element("pre", "", "guide-code"); code.append(element("code", item.text)); row.append(code);
        } else row.append(element("p", item.text));
        if (item.url) row.append(link(item));
        list.append(row);
      }
      section.append(list); details.append(section);
    }
    body.append(details);
  };
  const cancel = (renderAfter = true) => {
    if (active) active.controller.abort();
    active = null;
    status = null;
    if (renderAfter) render();
  };
  const prepare = locale => {
    const preparedTarget = locale === "en" ? "en" : "zh";
    const preparedSource = preparedTarget === "zh" ? "en" : "zh";
    const key = `${preparedSource}:${preparedTarget}`;
    if (prepared.has(key)) return prepared.get(key);
    if (!globalThis.Translator?.create) return Promise.resolve(false);
    const promise = Promise.resolve(globalThis.Translator.create({
      sourceLanguage: preparedSource,
      targetLanguage: preparedTarget,
    })).then(translator => {
      translator.destroy?.();
      return true;
    }).catch(() => {
      prepared.delete(key);
      return false;
    });
    prepared.set(key, promise);
    return promise;
  };
  const start = () => {
    const job = { report, target, controller: new AbortController(), promise: null };
    active = job;
    status = null;
    job.promise = (async () => {
      try {
        const outcome = await translateGuideAutomatically(job.report.project_guide, {
          targetLanguage: job.target,
          signal: job.controller.signal,
          translatorApi: globalThis.Translator?.create ? {
            create: options => {
              const key = `${languageCode(options.sourceLanguage)}:${languageCode(options.targetLanguage)}`;
              return Promise.resolve(prepared.get(key)).then(() => globalThis.Translator?.create(options));
            },
          } : globalThis.Translator,
        });
        if (active !== job) return;
        if (!cache.has(job.report)) cache.set(job.report, new Map());
        cache.get(job.report).set(job.target, outcome);
        status = null;
        node("guide-original").open = !outcome.translation;
      } catch (error) {
        if (active !== job) return;
        const key = error instanceof TranslationError ? error.code : "translationFailed";
        status = key === "translationCancelled" ? null : { key, state: "error" };
        node("guide-original").open = true;
      } finally {
        if (active === job) { active = null; render(); }
      }
    })();
    return job.promise;
  };
  return {
    cancel,
    current: result,
    prepare,
    show(data, locale) {
      const nextTarget = locale === "en" ? "en" : "zh";
      const changed = data !== report || nextTarget !== target;
      if (changed) {
        cancel(false);
        report = data;
        target = nextTarget;
        status = null;
      }
      render();
      if (entry()) return Promise.resolve();
      if (active) return active.promise;
      if (!report?.project_guide) return Promise.resolve();
      return start();
    },
  };
}
