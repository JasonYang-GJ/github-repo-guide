import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createWebServer } from "../src/web/server.js";
import { FixtureRepositorySource } from "./support/fixture-repository-source.js";

const root = resolve(process.cwd());
async function serve(outputRoot: string, action: (url: string) => Promise<void>) {
  const server = createWebServer({ outputRoot, assetRoot: join(root, "web"), schemaDirectory: join(root, "schemas"),
    source: new FixtureRepositorySource(join(root, "tests/fixtures/small-typescript-repo"), "small-typescript-repo") });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  try { await action(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); }
  finally { await new Promise<void>((done, fail) => server.close(error => error ? fail(error) : done())); }
}
async function post(url: string, value: unknown) {
  return fetch(`${url}/api/analyze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
}
test("history persists a real report, concurrent notes/favorite, downloads and two snapshots across restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "repo-history-"));
  let id = "", artifact = "";
  await serve(directory, async url => {
    const response = await post(url, { url: "https://github.com/fixture/small-typescript-repo", githubAuthMode: "anonymous", githubToken: "fixture-token-not-to-persist" });
    const report = await response.json();
    assert.equal(response.status, 200, JSON.stringify(report.error));
    assert.ok(report.history, JSON.stringify(report));
    id = report.history.id;
    artifact = report.artifacts.downloads.find((item: { name: string }) => item.name === "report.md").url;
    const patches = [{ note: "研究用途 <script>alert(1)</script>" }, { starred: true }];
    const responses = await Promise.all(patches.map(patch => fetch(`${url}/api/history/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) })));
    assert.ok(responses.every(r => r.status === 200));
    assert.equal((await post(url, { url: "https://github.com/fixture/small-typescript-repo", locale: "en" })).status, 200);
    const raw = await readFile(join(directory, "history", `${id}.json`), "utf8");
    assert.ok(!raw.includes("fixture-token-not-to-persist"));
  });
  await serve(directory, async url => {
    const list = await (await fetch(`${url}/api/history`)).json();
    assert.equal(list.entries.length, 2);
    const report = await (await fetch(`${url}/api/history/${id}`)).json();
    assert.equal(report.history.starred, true);
    assert.equal(report.history.note, "研究用途 <script>alert(1)</script>");
    const conflict = await fetch(`${url}/api/history/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note: "must not overwrite", expectedNote: "stale note" }) });
    assert.equal(conflict.status, 409);
    const stillSaved = await (await fetch(`${url}/api/history/${id}`)).json();
    assert.equal(stillSaved.history.note, report.history.note);
    const download = await fetch(`${url}${artifact}`);
    assert.equal(download.status, 200);
    assert.ok((await download.text()).length > 100);
    for (const patch of [{ note: "x".repeat(1501) }, { starred: "yes" }, { report: {} }]) {
      assert.equal((await fetch(`${url}/api/history/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) })).status, 400);
    }
    assert.equal((await fetch(`${url}/api/history/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json", Origin: "https://attacker.example" }, body: '{"starred":false}' })).status, 403);
    assert.equal((await fetch(`${url}/api/history`, { headers: { Origin: "https://attacker.example" } })).status, 403);
    assert.equal((await fetch(`${url}/api/history/not-an-id`)).status, 400);
    const persisted = JSON.parse(await readFile(join(directory, "history", `${id}.json`), "utf8"));
    persisted.artifactDirectory = "../../outside";
    await writeFile(join(directory, "history", `${id}.json`), JSON.stringify(persisted));
    assert.equal((await fetch(`${url}${artifact}`)).status, 404);
    const damaged = await (await fetch(`${url}/api/history`)).json();
    assert.equal(damaged.unreadable, 1);
    assert.equal(damaged.entries.length, 1);
    assert.ok((await readdir(join(directory, "history"))).includes(`${id}.json`));
  });
});
