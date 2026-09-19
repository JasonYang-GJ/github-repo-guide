const PREFIX = "repo-note-draft-v1:";
const ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
function parse(raw) {
  if (raw === null) return null;
  if (raw.length > 20000) throw new Error("DRAFT_INVALID");
  const value = JSON.parse(raw);
  if (value?.version !== 1 || typeof value.text !== "string" || value.text.length > 1500 ||
    typeof value.baseNote !== "string" || value.baseNote.length > 1500 || !Number.isFinite(value.updatedAt)) throw new Error("DRAFT_INVALID");
  return { version: 1, text: value.text, baseNote: value.baseNote, updatedAt: value.updatedAt };
}
export function createNoteDrafts(getStorage = () => globalThis.localStorage) {
  const fallback = new Map();
  const key = id => { if (!ID.test(id)) throw new Error("DRAFT_ID_INVALID"); return `${PREFIX}${id}`; };
  function get(id) {
    const name = key(id);
    try { const draft = parse(getStorage().getItem(name)); return { draft: fallback.get(id) ?? draft, error: fallback.has(id) }; }
    catch { return { draft: fallback.get(id) ?? null, error: true }; }
  }
  function set(id, text, baseNote) {
    const name = key(id);
    const draft = parse(JSON.stringify({ version: 1, text, baseNote, updatedAt: Date.now() }));
    try {
      // Preserve damaged records instead of silently overwriting recoverable text.
      parse(getStorage().getItem(name));
      getStorage().setItem(name, JSON.stringify(draft)); fallback.delete(id);
      return { draft, saved: true };
    } catch { fallback.set(id, draft); return { draft, saved: false }; }
  }
  function clearIf(id, expectedText) {
    const name = key(id);
    try {
      const persisted = parse(getStorage().getItem(name));
      if (persisted && persisted.text !== expectedText) return false;
      const memory = fallback.get(id);
      if (memory && memory.text !== expectedText) return false;
      getStorage().removeItem(name); fallback.delete(id); return true;
    } catch { return false; }
  }
  return { get, set, clearIf };
}
