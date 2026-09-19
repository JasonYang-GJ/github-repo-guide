import { groupReports, comparisonDimensions, matchingTranslation } from "./library-data.js";
import { createNoteDrafts } from "./note-drafts.js";
import { translateGuideAutomatically } from "./local-translation.js";

export function createLibrary({ getLocale, openReport }) {
  const $ = id => document.getElementById(id);
  const text = (zh, en) => getLocale() === "en" ? en : zh;
  const el = (tag, value, className = "") => {
    const node = document.createElement(tag); node.textContent = value; node.className = className; return node;
  };
  const selected = new Set();
  const drafts = createNoteDrafts();
  const expanded = new Map();
  const translated = new Map();
  let readingController = null, readingVersion = 0, readingEnabled = false;
  let readingStatus = "idle", readingProgress = "";
  let lastLocale = getLocale();
  let entries = [], limit = 20, comparison = null, busy = false, loaded = false, comparisonVersion = 0;
  async function request(path, options) {
    const response = await fetch(path, options);
    const value = await response.json();
    if (!response.ok) throw new Error(text(value.error?.message || "操作失败，请重试。", "The local operation failed. Please retry."));
    return value;
  }
  function message(value, failed = false) { $("library-status").textContent = value; $("library-status").dataset.state = failed ? "fail" : ""; }
  function button(label, action, className = "utility-button") {
    const node = el("button", label, className); node.type = "button";
    node.addEventListener("click", async () => {
      node.disabled = true;
      try { await action(); } catch (error) { message(error.message, true); }
      finally { node.disabled = false; }
    }); return node;
  }
  function updateSelection() {
    $("library-compare").textContent = text(`对比已选（${selected.size}/2）`, `Compare selected (${selected.size}/2)`);
    $("library-compare").disabled = selected.size !== 2 || busy;
    $("library-clear").disabled = !selected.size;
    $("library-selection").textContent = [...selected].map(id => {
      const e = entries.find(e => e.id === id);
      return e ? `${e.repository.owner}/${e.repository.repository_name} · ${e.repository.commit_short}` : "";
    }).filter(Boolean).join(" / ");
  }
  async function patch(id, value) {
    const updated = await request(`/api/history/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
    entries = entries.map(entry => entry.id === id ? updated : entry); return updated;
  }
  function renderRows() {
    const list = $("library-list"); list.replaceChildren();
    const groups = groupReports(entries, { query: $("library-search").value, favoritesOnly: $("library-favorites").checked });
    if (!groups.length) list.append(el("p", !loaded ? text("正在读取本机历史…", "Loading local history…") : entries.length
      ? text("没有符合筛选条件的报告。", "No reports match your filters.")
      : text("还没有历史报告。完成一次分析后，报告会出现在这里；旧版下载文件仍保留在原目录。", "No saved reports yet. Complete an analysis to start your library; older downloads remain in their original folder."), "library-empty"));
    for (const group of groups.slice(0, limit)) {
      const section = el("details", "", "library-group"); section.dataset.repository = group.key;
      section.open = expanded.get(group.key) ?? group.entries.length === 1;
      section.addEventListener("toggle", () => expanded.set(group.key, section.open));
      const summary = el("summary", "");
      summary.append(el("strong", group.name), el("span", text(`${group.entries.length}/${group.total} 份报告 · 最近 ${new Date(group.entries[0].savedAt).toLocaleDateString(getLocale())}`, `${group.entries.length}/${group.total} reports · latest ${new Date(group.entries[0].savedAt).toLocaleDateString(getLocale())}`), "library-group-meta"));
      section.append(summary);
      for (const entry of group.entries) {
      const row = el("article", "", "library-row");
      row.dataset.reportId = entry.id;
      const choose = el("input", ""); choose.type = "checkbox"; choose.checked = selected.has(entry.id);
      choose.setAttribute("aria-label", text(`选择 ${group.name} ${entry.repository.commit_short} ${entry.id.slice(-6)} 对比`, `Compare ${group.name} ${entry.repository.commit_short} ${entry.id.slice(-6)}`));
      choose.addEventListener("change", () => {
        if (choose.checked && selected.size === 2) { choose.checked = false; message(text("最多选择两份报告，请先取消一份。", "Choose at most two reports; deselect one first.")); return; }
        if (choose.checked) selected.add(entry.id); else selected.delete(entry.id);
        comparisonVersion++;
        updateSelection();
      });
      const body = el("div", "", "library-row-body");
      const title = button(text("阅读这份报告", "Open this report"), async () => {
        const data = await request(`/api/history/${entry.id}`); openReport(data);
      }, "library-project-name");
      const date = new Date(entry.savedAt).toLocaleString(getLocale());
      body.append(title, el("p", `${date} · ${entry.repository.commit_short} · ${entry.locale} · ${entry.paid ? text("AI 报告", "AI report") : text("免费报告", "Free report")}`, "library-meta"));
      const details = el("details", "", "library-note");
      details.append(el("summary", entry.note ? text("查看 / 编辑笔记", "View / edit note") : text("添加项目笔记", "Add a project note")));
      const label = el("label", text("这份报告的笔记（最多 1500 字，仅保存在本机）", "Note for this report (up to 1500 characters, local only)"));
      const restored = drafts.get(entry.id);
      let baseNote = restored.draft?.baseNote ?? entry.note;
      const input = el("textarea", ""); input.maxLength = 1500; input.rows = 3; input.value = restored.draft?.text ?? entry.note;
      label.append(input);
      const saved = el("span", ""); saved.setAttribute("role", "status");
      if (restored.draft || restored.error) {
        details.open = true;
        saved.textContent = restored.error ? text("草稿存储不可用或损坏，请先复制文字备份。", "Draft storage is unavailable or damaged. Copy your text before leaving.") : baseNote !== entry.note
          ? text("草稿已恢复；已保存笔记有变化，保存前请核对。", "Draft restored; the saved note changed. Review before saving.")
          : text("已恢复浏览器草稿，尚未保存到报告。", "Browser draft restored; not yet saved to the report.");
        saved.dataset.state = restored.error ? "fail" : "";
      }
      input.addEventListener("input", () => {
        const result = drafts.set(entry.id, input.value, baseNote);
        saved.textContent = result.saved ? text("草稿已自动保存到此浏览器", "Draft saved automatically in this browser") : text("草稿仅在本页内存，刷新会丢失。请保存笔记或复制文字。", "Draft is in page memory only. Save the note or copy it before reloading.");
        saved.dataset.state = result.saved ? "" : "fail";
      });
      const save = button(text("保存笔记", "Save note"), async () => {
        const note = input.value;
        const current = await request(`/api/history/${entry.id}`);
        if (current.history.note !== baseNote && current.history.note !== note && !confirm(text(`已保存的笔记发生变化。是否用当前草稿替换？\n\n已保存：\n${current.history.note}\n\n当前草稿：\n${note}`, `The saved note changed. Replace it with this draft?\n\nSaved:\n${current.history.note}\n\nDraft:\n${note}`))) return;
        await patch(entry.id, { note, expectedNote: current.history.note });
        baseNote = note;
        const cleared = input.value === note ? drafts.clearIf(entry.id, note) : drafts.set(entry.id, input.value, baseNote).saved;
        details.querySelector("summary").textContent = text("查看 / 编辑笔记", "View / edit note");
        saved.textContent = !cleared ? text("笔记已保存，但另有草稿或草稿清理失败，请核对。", "Note saved; another draft remains or cleanup failed. Review it.") : input.value === note ? text("笔记已保存到报告", "Note saved to the report") : text("先前内容已保存，新修改仍为草稿", "Previous text saved; new edits remain a draft");
        saved.dataset.state = !cleared ? "fail" : "";
        renderComparison();
      });
      const discard = button(text("放弃草稿", "Discard draft"), async () => {
        if (!confirm(text("放弃这份报告的浏览器草稿？已保存笔记不受影响。", "Discard this report's browser draft? The saved note is kept."))) return;
        if (!drafts.clearIf(entry.id, input.value)) throw new Error(text("草稿已在其他页面变化或无法清理，请先复制文字再刷新。", "The draft changed elsewhere or cannot be cleared. Copy your text before reloading."));
        input.value = entries.find(e => e.id === entry.id)?.note ?? entry.note; baseNote = input.value;
        saved.textContent = text("草稿已放弃，显示已保存笔记", "Draft discarded; showing the saved note"); saved.dataset.state = "";
      });
      details.append(label, save, discard, saved); body.append(details);
      const favorite = button(entry.starred ? text("已收藏", "Favorited") : text("收藏", "Favorite"), async () => { await patch(entry.id, { starred: !entry.starred }); renderRows(); });
      favorite.setAttribute("aria-pressed", String(entry.starred));
      row.append(choose, body, favorite); section.append(row);
      }
      list.append(section);
    }
    $("library-more").hidden = groups.length <= limit;
    updateSelection();
  }
  function sourceLink(url, label) {
    const node = el("a", label);
    try { const parsed = new URL(url); if (parsed.protocol === "https:" && parsed.hostname === "github.com" && !parsed.username && !parsed.password) { node.href = parsed.href; node.target = "_blank"; node.rel = "noopener noreferrer"; } } catch {}
    return node;
  }
  function excerpts(cell, values, report) {
    if (!values?.length) { cell.append(el("p", text("信息不足：已读取资料未明确说明。", "Insufficient information in the inspected sources."))); return; }
    for (const value of values.slice(0, 3)) {
      const block = el("div", "", "comparison-excerpt");
      const reading = readingEnabled ? translated.get(`${report.history.id}:${getLocale()}`)?.translation : null;
      const translatedText = matchingTranslation(value, reading);
      if (translatedText) {
        block.append(el("p", translatedText), el("small", text("本机译文 · 请核对原文", "On-device translation · check the original"), "comparison-translation-label"));
        const original = el("details", "", "comparison-original"); original.append(el("summary", text("查看原文", "Original text")), el("p", value.text)); block.append(original);
      } else block.append(el(value.format === "code" ? "pre" : "p", value.text));
      block.append(sourceLink(value.url, `${value.path}:${value.line_start}`)); cell.append(block);
    }
    if (values.length > 3) cell.append(el("small", text("此处显示前 3 条，完整内容请打开报告。", "First 3 excerpts shown; open the report for all details.")));
  }
  function renderComparison() {
    if (!comparison) return;
    const table = $("comparison-table"); table.replaceChildren();
    const head = el("thead", ""), heading = el("tr", ""); heading.append(el("th", text("对照维度", "Dimension")));
    for (const report of comparison) {
      const cell = el("th", ""); cell.scope = "col";
      cell.append(sourceLink(report.repository.url, `${report.repository.owner}/${report.repository.repository_name}`)); heading.append(cell);
    }
    head.append(heading); table.append(head);
    const body = el("tbody", "");
    const fields = [
      [text("报告版本", "Snapshot"), (cell, r) => { cell.append(el("p", `${new Date(r.history.savedAt).toLocaleString(getLocale())} · ${r.locale}`), sourceLink(`${r.repository.url}/tree/${r.repository.commit_sha}`, r.repository.commit_short)); }],
      [text("项目用途", "Purpose"), (cell, r) => excerpts(cell, r.project_guide?.introduction, r)],
      [text("主要功能", "Features"), (cell, r) => excerpts(cell, r.project_guide?.features, r)],
      ...comparisonDimensions(null).map(dimension => [getLocale() === "en" ? dimension.en : dimension.zh, (cell, r) => {
        const values = comparisonDimensions(r.project_guide).find(item => item.id === dimension.id).excerpts;
        if (values.length) cell.append(el("p", text("找到相关原文，具体条件请核对：", "Related documentation found; verify its conditions:"), "comparison-basis"));
        excerpts(cell, values, r);
      }]),
      [text("使用注意事项", "Documented caveats"), (cell, r) => excerpts(cell, r.project_guide?.caveats, r)],
      [text("已读取的技术信息", "Observed technologies"), (cell, r) => { cell.append(el("p", r.technologies?.map(t => t.name).join(" / ") || text("信息不足", "Insufficient information"))); }],
      [text("覆盖范围与限制", "Coverage and limitations"), (cell, r) => { cell.append(el("p", text(`读取 ${r.analysis.files_read} 个文件；${r.analysis.truncated ? "读取范围已截断" : "有限范围分析"}。`, `${r.analysis.files_read} files read; ${r.analysis.truncated ? "truncated" : "bounded analysis"}.`))); for (const item of (r.limitations || []).slice(0, 3)) cell.append(el("p", item.description)); }],
      [text("我的笔记", "My note"), (cell, r) => cell.append(el("p", entries.find(e => e.id === r.history.id)?.note || text("尚未填写", "No note yet")))],
    ];
    for (const [name, fill] of fields) {
      const row = el("tr", ""), label = el("th", name); label.scope = "row"; row.append(label);
      for (const report of comparison) { const cell = el("td", ""); fill(cell, report); row.append(cell); } body.append(row);
    }
    table.append(body); $("library-comparison").hidden = false;
  }
  function cancelReading() {
    readingVersion++; readingController?.abort(); readingController = null;
    if (readingStatus === "working") readingStatus = "cancelled";
  }
  function renderReadingControls() {
    $("comparison-read").textContent = text("中文阅读（本机）", "Read in English (on-device)");
    $("comparison-read").disabled = !comparison || readingStatus === "working";
    $("comparison-original").textContent = text("显示原文", "Show originals");
    $("comparison-original").disabled = !readingEnabled;
    $("comparison-cancel").textContent = text("取消翻译", "Cancel translation");
    $("comparison-cancel").hidden = readingStatus !== "working";
    const status = {
      idle: text("按需使用浏览器本地翻译；代码、原文和出处保留，不调用模型 API。", "Optional on-device translation. Code, originals and sources are preserved; no model API calls."),
      working: readingProgress || text("正在准备本机翻译…", "Preparing on-device translation…"),
      ready: text("当前语言阅读已就绪。译文仅供辅助阅读，展开可看原文。", "Reading view ready. Translations are reading aids; expand to inspect originals."),
      partial: text("部分内容未能翻译，已保留原文。可重试；已完成的结果会复用。", "Some content could not be translated; originals remain. Retry reuses completed results."),
      unavailable: text("当前浏览器或语言包无法完成本机翻译，已保留原文。可在支持此功能的桌面 Chrome 中重试。", "On-device translation is unavailable in this browser or language pack. Originals remain; retry in a supported desktop Chrome browser."),
      cancelled: text("翻译已取消，原文和已完成的译文仍可阅读。", "Translation cancelled; originals and completed translations remain readable."),
    };
    $("comparison-reading-status").textContent = status[readingStatus];
    $("comparison-reading-status").dataset.state = ["partial", "unavailable"].includes(readingStatus) ? "fail" : "";
  }
  async function startReading() {
    if (!comparison || readingStatus === "working") return;
    cancelReading();
    const version = readingVersion, locale = getLocale();
    const controller = new AbortController(); readingController = controller;
    readingEnabled = true; readingStatus = "working"; readingProgress = "";
    renderReadingControls();
    const results = await Promise.allSettled(comparison.map(async report => {
      const key = `${report.history.id}:${locale}`;
      if (translated.has(key)) return;
      if (!report.project_guide) throw new Error("Missing source text");
      const value = await translateGuideAutomatically(report.project_guide, {
        targetLanguage: locale === "en" ? "en" : "zh", signal: controller.signal,
        onProgress: progress => {
          if (version !== readingVersion) return;
          const label = progress.phase.includes("Downloading") || progress.phase === "downloading"
            ? text(`下载本机语言包 ${progress.percent ?? 0}%`, `Downloading language pack ${progress.percent ?? 0}%`)
            : progress.phase === "translating" ? text(`翻译 ${progress.current}/${progress.total}`, `Translating ${progress.current}/${progress.total}`)
              : text("准备本机翻译", "Preparing on-device translation");
          readingProgress = `${report.repository.repository_name} · ${label}`; renderReadingControls();
        },
      });
      if (version !== readingVersion || controller.signal.aborted) return;
      translated.set(key, value);
      while (translated.size > 12) translated.delete(translated.keys().next().value);
      renderComparison();
    }));
    if (version !== readingVersion) return;
    const failed = results.filter(result => result.status === "rejected").length;
    readingStatus = failed === results.length ? "unavailable" : failed ? "partial" : "ready";
    readingController = null;
    renderComparison(); renderReadingControls();
  }
  function render() {
    if (lastLocale !== getLocale()) {
      cancelReading(); readingEnabled = false; readingStatus = "idle"; lastLocale = getLocale();
    }
    const labels = {
      "open-library": ["我的项目", "My projects"], "library-title": ["我的项目", "My projects"],
      "library-intro": ["同一项目的报告归在一起。展开查看版本、收藏和笔记，也可选择两份报告对比。", "Reports are grouped by project. Expand versions, favorites and notes, or choose two reports to compare."],
      "library-refresh": ["刷新列表", "Refresh"], "library-search-label": ["搜索项目或笔记", "Search projects or notes"],
      "library-favorites-label": ["只看收藏", "Favorites only"], "library-clear": ["清空选择", "Clear selection"],
      "library-more": ["显示更多项目", "Show more projects"], "comparison-title": ["项目与版本对比", "Compare projects and versions"],
      "comparison-note": ["各维度从已保存报告中查找相关原文，不代表已经验证支持情况。资料不足会明确标出；窄屏可左右滑动。", "Dimensions retrieve related excerpts from saved reports, not verified capability claims. Missing evidence is explicit; scroll sideways on narrow screens."],
    };
    for (const [id, value] of Object.entries(labels)) $(id).textContent = text(...value);
    $("library-comparison").querySelector(".comparison-scroll").setAttribute("aria-label", text("项目对比表", "Project comparison table"));
    renderRows(); renderComparison(); renderReadingControls();
  }
  async function refresh() {
    $("library-refresh").disabled = true;
    try {
      const data = await request("/api/history"); entries = data.entries; loaded = true;
      for (const id of selected) if (!entries.some(entry => entry.id === id)) selected.delete(id);
      const count = groupReports(entries).length;
      message(data.unreadable ? text(`${data.unreadable} 份记录不可读，原文件已保留。`, `${data.unreadable} unreadable records were preserved.`) : text(`${count} 个项目 · ${entries.length} 份报告 · 查看与对比不调用模型`, `${count} projects · ${entries.length} reports · reading and comparison use no model calls`), Boolean(data.unreadable));
      renderRows();
    } catch { message(text("无法读取历史，请确认本机服务正在运行后刷新列表。", "History unavailable. Check the local service and refresh."), true); }
    finally { $("library-refresh").disabled = false; }
  }
  $("library-refresh").addEventListener("click", refresh);
  $("library-search").addEventListener("input", () => { limit = 20; renderRows(); });
  $("library-favorites").addEventListener("change", () => { limit = 20; renderRows(); });
  $("library-more").addEventListener("click", () => { limit += 20; renderRows(); });
  $("library-clear").addEventListener("click", () => { comparisonVersion++; cancelReading(); readingEnabled = false; readingStatus = "idle"; selected.clear(); comparison = null; $("library-comparison").hidden = true; renderRows(); renderReadingControls(); });
  $("library-compare").addEventListener("click", async () => {
    if (selected.size !== 2 || busy) return;
    cancelReading(); readingEnabled = false; readingStatus = "idle";
    busy = true; updateSelection();
    const version = ++comparisonVersion;
    try {
      const reports = await Promise.all([...selected].map(id => request(`/api/history/${id}`)));
      if (version !== comparisonVersion) return;
      comparison = reports;
      renderComparison(); renderReadingControls(); $("library-comparison").focus({ preventScroll: true });
      $("library-comparison").scrollIntoView({ block: "start", behavior: "instant" });
    } catch { message(text("对比加载失败，请刷新列表后重试。", "Comparison could not load. Refresh and retry."), true); }
    finally { busy = false; updateSelection(); }
  });
  $("comparison-read").addEventListener("click", startReading);
  $("comparison-original").addEventListener("click", () => { cancelReading(); readingEnabled = false; readingStatus = "idle"; renderComparison(); renderReadingControls(); });
  $("comparison-cancel").addEventListener("click", () => { cancelReading(); renderReadingControls(); });
  render(); void refresh();
  return { refresh, render, warning: () => message(text("本次报告未能保存到历史，请先下载报告，再检查磁盘空间与权限。", "This report could not be saved. Download it now and check disk space and permissions."), true) };
}
