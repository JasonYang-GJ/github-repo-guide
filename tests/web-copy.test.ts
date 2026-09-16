import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";

const html = await readFile(resolve("web/index.html"), "utf8");
const script = await readFile(resolve("web/app.js"), "utf8");
const css = await readFile(resolve("web/app.css"), "utf8");
const declarations = script.slice(script.indexOf("const COPY ="), script.indexOf("function initialLocale()"));
const copy = runInNewContext(`${declarations}\n({ COPY, RUNTIME_COPY })`) as {
  COPY: Record<string, Record<string, string>>;
  RUNTIME_COPY: Record<string, Record<string, string>>;
};

test("page labels exist in both languages and the initial Chinese HTML matches them", () => {
  for (const match of html.matchAll(/data-i18n="([^"]+)"/g)) {
    for (const locale of ["zh-CN", "en"]) {
      assert.ok(copy.COPY[locale]?.[match[1]!] ?? copy.RUNTIME_COPY[locale]?.[match[1]!], `${locale}: ${match[1]}`);
    }
  }
  for (const match of html.matchAll(/<([\w-]+)\b[^>]*data-i18n="([^"]+)"[^>]*>([^<]*)<\/\1>/g)) {
    const expected = copy.COPY["zh-CN"]?.[match[2]!] ?? copy.RUNTIME_COPY["zh-CN"]?.[match[2]!];
    assert.equal(match[3]!.trim(), expected, match[2]);
  }
});

test("page replaces slogans with concrete scope and cost information", () => {
  assert.doesNotMatch(html + script, /别先相信结论|先跟着证据走|不能给自己发证书|Evidence before expression|cannot certify itself/);
  assert.match(html, /不代替安装测试或安全审计/);
  assert.match(html, /仓库文本会发送给所选供应商/);
  assert.match(html, /不自动付费重试/);
  assert.match(html, /不执行脚本或测试/);
});

test("key lifetime copy distinguishes page memory from persistent storage", () => {
  assert.doesNotMatch(html + script, /请求结束即丢弃|Discarded after request/);
  assert.match(copy.COPY["zh-CN"]!.privacyBody!, /页面内存.*刷新后需重新填写/);
  assert.match(copy.COPY.en!.privacyBody!, /page memory.*after reloading/);
});

test("restyled page retains credential controls and report anchors with unique IDs", () => {
  const ids = Array.from(html.matchAll(/\bid="([^"]+)"/g), match => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  for (const id of ["analyze-form", "repository-url", "provider-select", "github-access-mode", "paid-model-consent", "provider-dialog", "connection-api-key", "run-state", "error-panel", "result-shell", "overview", "architecture", "evidence", "content-pack", "downloads"]) {
    assert.ok(ids.includes(id), id);
  }
  assert.match(html, /option value="deterministic"/);
  assert.match(html, /option value="custom"/);
  assert.doesNotMatch(html, /option value="deepseek"|option value="qwen"/);
});

test("layout provides mobile and reduced-motion rules without decorative watermarks", () => {
  assert.match(css, /@media \(max-width: 480px\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /:focus-visible/);
  assert.doesNotMatch(css, /data-watermark|writing-mode: vertical|linear-gradient|rotate\(-?[12]deg\)/);
});
