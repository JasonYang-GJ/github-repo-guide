import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = await readFile(resolve("web/provider-manager.js"), "utf8");
const html = await readFile(resolve("web/index.html"), "utf8");

function harness() {
  const nodes = new Map<string, any>();
  const element = () => {
    const value: any = {
      value: "", textContent: "", placeholder: "", hidden: false, disabled: false, checked: false,
      dataset: {}, children: [] as any[], handlers: {} as Record<string, (...args: any[]) => any>,
      append(...items: any[]) { value.children.push(...items); },
      replaceChildren(...items: any[]) { value.children = items; },
      addEventListener(name: string, handler: (...args: any[]) => any) { value.handlers[name] = handler; },
      setAttribute(name: string, item: string) { value[name] = item; },
      removeAttribute(name: string) { delete value[name]; },
      reset() {}, reportValidity() { return true; }, showModal() {}, close() { value.handlers.close?.(); }, focus() {},
    };
    return value;
  };
  const node = (selector: string) => {
    if (!nodes.has(selector)) nodes.set(selector, element());
    return nodes.get(selector);
  };
  const configuration = [{
    id: "provider-one", name: "My provider", baseUrl: "https://models.example.com/v1",
    apiFormat: "openai-chat", models: ["my-model"], tokenParameter: "max_tokens", jsonMode: true,
  }];
  const calls: Array<{ url: string; method: string; body?: any }> = [];
  let saved = { providerId: "provider-one", lastFour: "1234", updatedAt: "2026-09-16T08:00:00.000Z" };
  const fetch = async (url: string, options: any = {}) => {
    const method = options.method || "GET";
    calls.push({ url, method, ...(options.body ? { body: JSON.parse(options.body) } : {}) });
    if (url === "/api/credentials" && method === "GET") {
      return Response.json({ storage: "windows_dpapi_current_user", credentials: [saved] });
    }
    if (url === "/api/credentials" && method === "POST") {
      saved = { providerId: options.body ? JSON.parse(options.body).providerId : "", lastFour: "9999", updatedAt: "2026-09-16T09:00:00.000Z" };
      return Response.json({ credential: saved });
    }
    if (url === "/api/credentials/provider-one" && method === "DELETE") return Response.json({ deleted: true });
    return Response.json({ error: { message: "unexpected request" } }, { status: 500 });
  };
  const localStorage = {
    getItem: (key: string) => key === "repo-model-connections-v1" ? JSON.stringify(configuration) : null,
    setItem() {},
  };
  const document = {
    querySelector: node,
    querySelectorAll: () => [],
    createElement: element,
  };
  const { createProviderManager } = runInNewContext(
    `${source.replaceAll("export ", "")}\n({createProviderManager})`,
    { document, localStorage, fetch, Response, URL, Map, Set, JSON, crypto: { randomUUID }, confirm: () => true },
  );
  let changes = 0;
  const manager = createProviderManager({ getLocale: () => "zh-CN", onChange: () => { changes++; } });
  return { manager, node, calls, changes: () => changes };
}

test("saved provider key history is selectable after reload without returning the full key", async () => {
  const ui = harness();
  await ui.manager.ready;
  assert.deepEqual(JSON.parse(JSON.stringify(ui.manager.selected())), {
    configuration: {
      name: "My provider", baseUrl: "https://models.example.com/v1", apiFormat: "openai-chat",
      model: "my-model", tokenParameter: "max_tokens", jsonMode: true,
    },
    apiKey: "",
    credentialId: "provider-one",
  });
  assert.equal(ui.node("#connection-key-saved").hidden, false);
  assert.equal(ui.node("#connection-key-editor").hidden, true);
  assert.match(ui.node("#connection-key-saved-detail").textContent, /尾号 1234.*刷新后可直接使用/);
  assert.equal(ui.node("#connection-api-key").value, "");
  assert.doesNotMatch(JSON.stringify(ui.node("#provider-list")), /full-secret|sk-/);
  assert.match(ui.node("#provider-list").children[0].children[1].textContent, /密钥已保存.*1234/);
  assert.equal(ui.calls[0]?.url, "/api/credentials");
});

test("a replacement key is saved explicitly and the local record can be deleted", async () => {
  const ui = harness();
  await ui.manager.ready;
  ui.node("#replace-connection-key").handlers.click();
  assert.equal(ui.node("#connection-key-saved").hidden, true);
  assert.equal(ui.node("#connection-key-editor").hidden, false);
  assert.match(ui.node("#connection-api-key-label").textContent, /新 API Key/);
  const key = ui.node("#connection-api-key");
  key.value = "replacement-key-9999";
  key.handlers.input();
  assert.equal(ui.manager.selected().apiKey, "replacement-key-9999");
  assert.equal(ui.manager.selected().credentialId, "");

  await ui.node("#save-connection-key").handlers.click();
  const save = ui.calls.find(call => call.method === "POST");
  assert.equal(save?.body.apiKey, "replacement-key-9999");
  assert.equal(ui.manager.selected().apiKey, "");
  assert.equal(ui.manager.selected().credentialId, "provider-one");
  assert.equal(ui.node("#connection-key-saved").hidden, false);
  assert.equal(ui.node("#connection-key-editor").hidden, true);
  assert.match(ui.node("#connection-key-saved-detail").textContent, /9999/);

  await ui.node("#clear-connection-key").handlers.click();
  assert.ok(ui.calls.some(call => call.method === "DELETE" && call.url.endsWith("/provider-one")));
  assert.equal(ui.manager.selected().credentialId, "");
  assert.equal(ui.node("#connection-key-saved").hidden, true);
  assert.equal(ui.node("#connection-key-editor").hidden, false);
  assert.match(ui.node("#connection-status").textContent, /尚未保存密钥/);
});

test("replacement can be cancelled without changing the saved credential", async () => {
  const ui = harness();
  await ui.manager.ready;
  ui.node("#replace-connection-key").handlers.click();
  const key = ui.node("#connection-api-key");
  key.value = "not-saved-key";
  key.handlers.input();
  ui.node("#cancel-connection-key").handlers.click();
  assert.equal(ui.node("#connection-key-saved").hidden, false);
  assert.equal(ui.node("#connection-key-editor").hidden, true);
  assert.equal(key.value, "");
  assert.equal(ui.manager.selected().apiKey, "");
  assert.equal(ui.manager.selected().credentialId, "provider-one");
  assert.equal(ui.calls.filter(call => call.method === "POST").length, 0);
});

test("credential controls and persistent-storage copy are present in the page", () => {
  assert.match(html, /id="save-connection-key"/);
  assert.match(html, /id="replace-connection-key"/);
  assert.match(html, /id="cancel-connection-key"/);
  assert.match(html, /id="clear-connection-key"/);
  assert.match(html, /Windows 当前用户加密/);
  assert.doesNotMatch(html, /刷新页面后需重新填写|仅保留在本次页面内存/);
});
