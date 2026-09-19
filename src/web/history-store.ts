import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { WebReport } from "./server.js";

const ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const MAX_BYTES = 8 * 1024 * 1024;
export class HistoryError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}
export interface HistoryEntry {
  version: 1;
  id: string;
  savedAt: string;
  starred: boolean;
  note: string;
  artifactDirectory: string;
  report: WebReport;
}
function validId(id: string): void {
  if (!ID.test(id)) throw new HistoryError(400, "HISTORY_ID_INVALID", "历史记录标识无效。");
}
export function historySummary(entry: HistoryEntry) {
  return { id: entry.id, savedAt: entry.savedAt, starred: entry.starred, note: entry.note,
    repository: entry.report.repository, locale: entry.report.locale, paid: entry.report.analysis.paid };
}
export class HistoryStore {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly outputRoot: string) {}
  private get directory() { return join(this.outputRoot, "history"); }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const next = this.pending.then(action, action);
    this.pending = next.catch(() => undefined);
    return next;
  }
  async get(id: string): Promise<HistoryEntry> {
    validId(id);
    const file = join(this.directory, `${id}.json`);
    try {
      if ((await stat(file)).size > MAX_BYTES) throw new Error("oversize");
      const value = JSON.parse(await readFile(file, "utf8")) as HistoryEntry;
      if (value.version !== 1 || value.id !== id || typeof value.savedAt !== "string" ||
        !Number.isFinite(Date.parse(value.savedAt)) || typeof value.starred !== "boolean" ||
        typeof value.note !== "string" || value.note.length > 1500 ||
        typeof value.artifactDirectory !== "string" || !value.report?.repository?.url ||
        !value.report.analysis || !["PASS", "PASS_WITH_FALLBACK"].includes(value.report.status)) throw new Error("invalid");
      this.artifactPath(value);
      return value;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        throw new HistoryError(404, "HISTORY_NOT_FOUND", "没有找到这份历史报告。");
      throw new HistoryError(422, "HISTORY_INVALID", "历史报告损坏或不可读，原文件已保留。");
    }
  }
  artifactPath(entry: HistoryEntry): string {
    const root = resolve(this.outputRoot, "runs", entry.id);
    const path = resolve(this.outputRoot, entry.artifactDirectory);
    if (!path.startsWith(`${root}${sep}`)) throw new HistoryError(422, "HISTORY_PATH_INVALID", "报告路径无效。");
    return path;
  }
  async list() {
    let files: string[];
    try { files = await readdir(this.directory); }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return { entries: [], unreadable: 0 };
      throw new HistoryError(500, "HISTORY_READ_FAILED", "无法读取历史记录，请检查本机目录权限。");
    }
    const entries: ReturnType<typeof historySummary>[] = [];
    let unreadable = 0;
    for (const file of files.filter(file => file.endsWith(".json") && ID.test(file.slice(0, -5)))) {
      try { entries.push(historySummary(await this.get(file.slice(0, -5)))); } catch { unreadable++; }
    }
    entries.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    return { entries, unreadable };
  }
  private async write(entry: HistoryEntry) {
    const raw = JSON.stringify(entry);
    if (Buffer.byteLength(raw) > MAX_BYTES) throw new HistoryError(413, "HISTORY_TOO_LARGE", "报告太大，未保存到历史；仍可下载当前报告。");
    await mkdir(this.directory, { recursive: true });
    const target = join(this.directory, `${entry.id}.json`);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, raw, { flag: "wx", mode: 0o600 }); await rename(temporary, target); }
    finally { await unlink(temporary).catch(() => undefined); }
  }
  save(id: string, report: WebReport, artifactDirectory: string): Promise<HistoryEntry> {
    validId(id);
    return this.serial(async () => {
      const entry: HistoryEntry = { version: 1, id, savedAt: new Date().toISOString(), starred: false, note: "",
        artifactDirectory: relative(this.outputRoot, artifactDirectory), report };
      this.artifactPath(entry);
      await this.write(entry);
      return entry;
    });
  }
  update(id: string, patch: Record<string, unknown>): Promise<HistoryEntry> {
    validId(id);
    if (!Object.keys(patch).length || Object.keys(patch).some(key => !["starred", "note", "expectedNote"].includes(key)) ||
      (patch.expectedNote !== undefined && (typeof patch.expectedNote !== "string" || patch.expectedNote.length > 1500 || patch.note === undefined)) ||
      (patch.starred !== undefined && typeof patch.starred !== "boolean") ||
      (patch.note !== undefined && (typeof patch.note !== "string" || patch.note.length > 1500)))
      throw new HistoryError(400, "HISTORY_PATCH_INVALID", "只支持修改收藏和最多 1500 字的笔记。");
    return this.serial(async () => {
      const entry = await this.get(id);
      if (typeof patch.expectedNote === "string" && entry.note !== patch.expectedNote)
        throw new HistoryError(409, "NOTE_CONFLICT", "已保存笔记刚被其他页面修改。草稿仍保留，请重新保存并核对差异。");
      if (typeof patch.starred === "boolean") entry.starred = patch.starred;
      if (typeof patch.note === "string") entry.note = patch.note;
      await this.write(entry);
      return entry;
    });
  }
}
