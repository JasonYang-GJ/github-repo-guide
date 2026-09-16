import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";

const script = await readFile(resolve("web/app.js"), "utf8");
const html = await readFile(resolve("web/index.html"), "utf8");
const reader = script.slice(script.indexOf("function scrollToElement("), script.indexOf("let navigationFrame ="));

function setup(hasReport = true, reducedMotion = false) {
  const nodes = new Map<string, any>();
  const node = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, {
      hidden: false, href: "", top: 200, focused: false, scroll: null,
      attributes: new Map<string, string>(),
      focus() { this.focused = true; },
      scrollIntoView(options: unknown) { this.scroll = options; },
      getBoundingClientRect() { return { top: this.top }; },
      getAttribute(key: string) { return this.attributes.get(key); },
      setAttribute(key: string, value: string) { this.attributes.set(key, value); },
      removeAttribute(key: string) { this.attributes.delete(key); },
    });
    return nodes.get(id);
  };
  const links = ["overview", "architecture", "evidence", "content-pack", "limits", "downloads"].map(id => {
    const link = node(`link-${id}`);
    link.setAttribute("href", `#${id}`);
    return link;
  });
  const classes = new Set<string>();
  const context = {
    currentResult: hasReport ? { repository: { name: "example" } } : null,
    resultShell: node("#result-shell"), errorPanel: node("#error-panel"), repositoryInput: node("#repository-url"),
    window: { matchMedia: () => ({ matches: reducedMotion }) },
    document: {
      body: { classList: { toggle: (name: string, on: boolean) => on ? classes.add(name) : classes.delete(name) } },
      getElementById: (id: string) => node(`#${id}`),
      querySelector: node,
      querySelectorAll: () => links,
    },
  };
  const run = (code: string) => runInNewContext(`${reader}\n${code}`, context);
  return { run, node, links, classes, context };
}

test("report reading hides setup, preserves the report, and restores input focus on return", () => {
  const { run, node, context, classes } = setup();
  const result = context.currentResult;
  run("setReportView(true)");
  assert.equal(node("#workspace").hidden, true);
  assert.equal(node("#result-shell").hidden, false);
  assert.equal(node("#project-name").focused, true);
  assert.equal(node(".skip-link").href, "#project-name");
  assert.ok(classes.has("reading-report"));
  run("setReportView(false)");
  assert.equal(node("#workspace").hidden, false);
  assert.equal(node("#result-shell").hidden, true);
  assert.equal(node("#repository-url").focused, true);
  assert.equal(node(".skip-link").href, "#workspace");
  assert.equal(context.currentResult, result);
  run("setReportView(true)");
  assert.equal(node("#result-shell").hidden, false);
});

test("opening the reader without a result never hides the workbench", () => {
  const { run, node } = setup(false);
  run("setReportView(true)");
  assert.equal(node("#workspace").hidden, false);
  assert.equal(node("#result-shell").hidden, true);
});

test("reader scrolling respects reduced motion and non-interactive view changes preserve focus", () => {
  const { run, node } = setup(true, true);
  run("setReportView(true, false)");
  assert.equal(node("#project-name").focused, false);
  run("setReportView(true)");
  assert.equal(node("#result-shell").scroll.behavior, "instant");
});

test("report navigation marks one current section including limitations", () => {
  const { run, node, links } = setup();
  run("setReportView(true)");
  assert.equal(links[0].getAttribute("aria-current"), "location");
  node("#overview").top = -600;
  node("#limits").top = 90;
  run("updateReportNavigation()");
  assert.equal(links[4].getAttribute("aria-current"), "location");
  assert.equal(links.filter(link => link.getAttribute("aria-current")).length, 1);
});

test("provider fixed-footer submit still owns its form; optional access settings start collapsed", () => {
  assert.match(html, /type="submit" form="provider-editor-form" id="save-provider"/);
  assert.match(html, /<details class="access-settings" id="access-settings">/);
  assert.match(html, /id="clear-evidence-filter" hidden/);
  assert.match(script, /if \(analyzeButton.disabled\) return;/);
});
