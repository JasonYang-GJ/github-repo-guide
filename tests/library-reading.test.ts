import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";

const dataSource = await readFile("web/library-data.js", "utf8");
const draftSource = await readFile("web/note-drafts.js", "utf8");
const data = runInNewContext(`${dataSource.replaceAll("export ", "")}\n({groupReports,comparisonDimensions,matchingTranslation})`);
const createDrafts = runInNewContext(`${draftSource.replaceAll("export ", "")}\ncreateNoteDrafts`);
const first = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";
const record = (id: string, owner: string, name: string, date: string, note = "", starred = false) => ({ id, savedAt: date, note, starred,
  repository: { owner, repository_name: name, name, commit_sha: id.replaceAll("-", ""), commit_short: id.slice(0, 8) } });

test("history groups case-insensitive repository identities without merging version notes or favorites", () => {
  const entries = [record(first, "Example", "Project", "2026-09-01", "older note", true), record(second, "example", "project", "2026-09-19", "new note"), record("other", "other", "project", "2026-09-18")];
  const before = JSON.stringify(entries);
  const groups = data.groupReports(entries);
  assert.equal(groups.length, 2); assert.equal(groups[0].total, 2);
  assert.equal(groups[0].entries[0].id, second); assert.equal(groups[0].entries[1].note, "older note");
  assert.equal(data.groupReports(entries, { favoritesOnly: true })[0].entries[0].id, first);
  assert.equal(data.groupReports(entries, { query: "older note" })[0].total, 2);
  assert.equal(data.groupReports(entries, { query: "older note" })[0].entries.length, 1);
  assert.equal(data.groupReports(entries, { query: "not found" }).length, 0);
  assert.equal(JSON.stringify(entries), before);
});

function memoryStorage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
}
test("note drafts survive a new page instance, keep empty deletions and isolate report versions", () => {
  const storage = memoryStorage(); const drafts = createDrafts(() => storage);
  assert.equal(drafts.set(first, "未保存的笔记", "已保存笔记").saved, true);
  drafts.set(second, "", "previous note");
  const restored = createDrafts(() => storage);
  assert.equal(restored.get(first).draft.text, "未保存的笔记");
  assert.equal(restored.get(first).draft.baseNote, "已保存笔记");
  assert.equal(restored.get(second).draft.text, "");
  assert.equal(restored.clearIf(first, "different text"), false);
  assert.equal(restored.clearIf(first, "未保存的笔记"), true);
  assert.equal(restored.get(first).draft, null);
  assert.equal(restored.get(second).draft.baseNote, "previous note");
});
test("quota, unavailable storage and corrupt drafts never report a successful autosave", () => {
  const denied = createDrafts(() => { throw Error("blocked"); });
  assert.equal(denied.set(first, "keep this text", "").saved, false);
  assert.equal(denied.get(first).draft.text, "keep this text");
  assert.equal(denied.get(first).error, true);
  const storage = memoryStorage(); storage.setItem(`repo-note-draft-v1:${first}`, "{damaged");
  const drafts = createDrafts(() => storage);
  assert.equal(drafts.set(first, "new draft", "").saved, false);
  assert.equal(storage.getItem(`repo-note-draft-v1:${first}`), "{damaged");
  assert.equal(drafts.clearIf(first, "new draft"), false);
  assert.throws(() => drafts.set(second, "x".repeat(1501), ""));
  assert.throws(() => drafts.get("../another-key"));
});
test("saving an older tab does not delete another tab's newer draft", () => {
  const storage = memoryStorage(); const a = createDrafts(() => storage), b = createDrafts(() => storage);
  a.set(first, "old draft", ""); b.set(first, "new draft", "");
  assert.equal(a.clearIf(first, "old draft"), false);
  assert.equal(b.get(first).draft.text, "new draft");
});

const excerpt = (text: string, line: number, format?: string) => ({ text, format, path: "README.md", line_start: line, line_end: line, url: `https://github.com/example/project/blob/abc/README.md#L${line}` });
test("comparison dimensions retain exact supporting excerpts without inferring support from keywords", () => {
  const windows = excerpt("Windows is not supported. Linux support is experimental.", 3);
  const api = excerpt("An API key is optional; the default mode works offline.", 4);
  const setup = excerpt("npm install example\nnode app.js", 8, "code");
  const local = excerpt("Data is saved locally in a SQLite database.", 10);
  const guide = { introduction: [windows], features: [api, windows], usage: [setup], caveats: [local] };
  const dimensions = data.comparisonDimensions(guide);
  assert.equal(dimensions[0].excerpts.length, 1);
  assert.equal(dimensions[0].excerpts[0].text, windows.text);
  assert.equal(dimensions[1].excerpts[0].url, api.url);
  assert.equal(dimensions[2].excerpts[0].format, "code");
  assert.equal(dimensions[3].excerpts[0].text, local.text);
  assert.ok(data.comparisonDimensions({}).every((d: any) => d.excerpts.length === 0));
  assert.equal(data.comparisonDimensions({ usage: [excerpt("npm install windows-helper", 2, "code")] })[0].excerpts.length, 0);
});
test("comparison translation matches source location, leaves code unchanged and preserves original input", () => {
  const original = excerpt("Install the app.", 4);
  const translated = { usage: [excerpt("安装这个应用。", 4)] };
  assert.equal(data.matchingTranslation(original, translated), "安装这个应用。");
  assert.equal(original.text, "Install the app.");
  assert.equal(data.matchingTranslation(excerpt("npm install app", 4, "code"), translated), null);
  assert.equal(data.matchingTranslation(excerpt("Other text", 10), translated), null);
});
