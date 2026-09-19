export function createLibrary({ getLocale, openReport }) {
  const $ = id => document.getElementById(id);
  const text = (zh, en) => getLocale() === "en" ? en : zh;
  const el = (tag, value, className = "") => {
    const node = document.createElement(tag); node.textContent = value; node.className = className; return node;
  };
  const selected = new Set();
  const drafts = new Map();
  let entries = [], limit = 20, comparison = null, busy = false, loaded = false;
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
  }
  async function patch(id, value) {
    const updated = await request(`/api/history/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
    entries = entries.map(entry => entry.id === id ? updated : entry); return updated;
  }
  function renderRows() {
    const list = $("library-list"); list.replaceChildren();
    const query = $("library-search").value.toLocaleLowerCase();
    const rows = entries.filter(entry => (!$("library-favorites").checked || entry.starred) &&
      `${entry.repository.owner}/${entry.repository.repository_name} ${entry.repository.name} ${entry.note}`.toLocaleLowerCase().includes(query));
    if (!rows.length) list.append(el("p", !loaded ? text("正在读取本机历史…", "Loading local history…") : entries.length
      ? text("没有符合筛选条件的报告。", "No reports match your filters.")
      : text("还没有历史报告。完成一次分析后，报告会出现在这里；旧版下载文件仍保留在原目录。", "No saved reports yet. Complete an analysis to start your library; older downloads remain in their original folder."), "library-empty"));
    for (const entry of rows.slice(0, limit)) {
      const row = el("article", "", "library-row");
      const choose = el("input", ""); choose.type = "checkbox"; choose.checked = selected.has(entry.id);
      choose.setAttribute("aria-label", text(`选择 ${entry.repository.owner}/${entry.repository.repository_name} 对比`, `Compare ${entry.repository.owner}/${entry.repository.repository_name}`));
      choose.addEventListener("change", () => {
        if (choose.checked && selected.size === 2) { choose.checked = false; message(text("最多选择两份报告，请先取消一份。", "Choose at most two reports; deselect one first.")); return; }
        if (choose.checked) selected.add(entry.id); else selected.delete(entry.id);
        updateSelection();
      });
      const body = el("div", "", "library-row-body");
      const title = button(`${entry.repository.owner}/${entry.repository.repository_name}`, async () => {
        const data = await request(`/api/history/${entry.id}`); openReport(data);
      }, "library-project-name");
      const date = new Date(entry.savedAt).toLocaleString(getLocale());
      body.append(title, el("p", `${date} · ${entry.repository.commit_short} · ${entry.locale} · ${entry.paid ? text("AI 报告", "AI report") : text("免费报告", "Free report")}`, "library-meta"));
      const details = el("details", "", "library-note");
      details.append(el("summary", entry.note ? text("查看 / 编辑笔记", "View / edit note") : text("添加项目笔记", "Add a project note")));
      const label = el("label", text("这份报告的笔记（最多 1500 字，仅保存在本机）", "Note for this report (up to 1500 characters, local only)"));
      const input = el("textarea", ""); input.maxLength = 1500; input.rows = 3; input.value = drafts.get(entry.id) ?? entry.note;
      input.addEventListener("input", () => drafts.set(entry.id, input.value));
      label.append(input);
      const saved = el("span", ""); saved.setAttribute("role", "status");
      const save = button(text("保存笔记", "Save note"), async () => {
        const note = input.value; await patch(entry.id, { note });
        if (input.value === note) drafts.delete(entry.id);
        details.querySelector("summary").textContent = text("查看 / 编辑笔记", "View / edit note");
        saved.textContent = input.value === note ? text("已保存", "Saved") : text("先前内容已保存，新修改尚未保存", "Previous text saved; new edits are unsaved");
        renderComparison();
      });
      details.append(label, save, saved); body.append(details);
      const favorite = button(entry.starred ? text("已收藏", "Favorited") : text("收藏", "Favorite"), async () => { await patch(entry.id, { starred: !entry.starred }); renderRows(); });
      favorite.setAttribute("aria-pressed", String(entry.starred));
      row.append(choose, body, favorite); list.append(row);
    }
    $("library-more").hidden = rows.length <= limit;
    updateSelection();
  }
  function sourceLink(url, label) {
    const node = el("a", label);
    try { const parsed = new URL(url); if (parsed.protocol === "https:" && parsed.hostname === "github.com" && !parsed.username && !parsed.password) { node.href = parsed.href; node.target = "_blank"; node.rel = "noopener noreferrer"; } } catch {}
    return node;
  }
  function excerpts(cell, values) {
    if (!values?.length) { cell.append(el("p", text("信息不足：已读取资料未明确说明。", "Insufficient information in the inspected sources."))); return; }
    for (const value of values.slice(0, 3)) {
      const block = el("div", "", "comparison-excerpt");
      block.append(el(value.format === "code" ? "pre" : "p", value.text), sourceLink(value.url, `${value.path}:${value.line_start}`)); cell.append(block);
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
      [text("项目用途 · 文档原文", "Purpose · documentation"), (cell, r) => excerpts(cell, r.project_guide?.introduction)],
      [text("主要功能 · 文档原文", "Features · documentation"), (cell, r) => excerpts(cell, r.project_guide?.features)],
      [text("上手要求与步骤", "Setup and usage"), (cell, r) => excerpts(cell, r.project_guide?.usage)],
      [text("使用注意事项", "Documented caveats"), (cell, r) => excerpts(cell, r.project_guide?.caveats)],
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
  function render() {
    const labels = {
      "open-library": ["我的项目", "My projects"], "library-title": ["我的项目", "My projects"],
      "library-intro": ["分析结果自动保存在本机。收藏、写笔记，或选两份报告进行对比。", "Reports stay on this computer. Favorite, annotate, or select two reports to compare."],
      "library-refresh": ["刷新列表", "Refresh"], "library-search-label": ["搜索项目或笔记", "Search projects or notes"],
      "library-favorites-label": ["只看收藏", "Favorites only"], "library-clear": ["清空选择", "Clear selection"],
      "library-more": ["显示更多", "Show more"], "comparison-title": ["项目对比", "Project comparison"],
      "comparison-note": ["仅对照已保存报告；没有资料不代表没有功能。点击来源可核对原文，窄屏可左右滑动表格。", "Compares saved reports only. Missing evidence does not mean a feature is absent. Follow source links to verify; scroll the table sideways on narrow screens."],
    };
    for (const [id, value] of Object.entries(labels)) $(id).textContent = text(...value);
    $("library-comparison").querySelector(".comparison-scroll").setAttribute("aria-label", text("项目对比表", "Project comparison table"));
    renderRows(); renderComparison();
  }
  async function refresh() {
    $("library-refresh").disabled = true;
    try {
      const data = await request("/api/history"); entries = data.entries; loaded = true;
      for (const id of selected) if (!entries.some(entry => entry.id === id)) selected.delete(id);
      message(data.unreadable ? text(`${data.unreadable} 份记录不可读，原文件已保留。`, `${data.unreadable} unreadable records were preserved.`) : text(`共 ${entries.length} 份报告 · 查看与对比不调用模型`, `${entries.length} reports · reading and comparison use no model calls`), Boolean(data.unreadable));
      renderRows();
    } catch { message(text("无法读取历史，请确认本机服务正在运行后刷新列表。", "History unavailable. Check the local service and refresh."), true); }
    finally { $("library-refresh").disabled = false; }
  }
  $("library-refresh").addEventListener("click", refresh);
  $("library-search").addEventListener("input", () => { limit = 20; renderRows(); });
  $("library-favorites").addEventListener("change", () => { limit = 20; renderRows(); });
  $("library-more").addEventListener("click", () => { limit += 20; renderRows(); });
  $("library-clear").addEventListener("click", () => { selected.clear(); comparison = null; $("library-comparison").hidden = true; renderRows(); });
  $("library-compare").addEventListener("click", async () => {
    if (selected.size !== 2 || busy) return;
    busy = true; updateSelection();
    try {
      comparison = await Promise.all([...selected].map(id => request(`/api/history/${id}`)));
      renderComparison(); $("library-comparison").focus({ preventScroll: true });
      $("library-comparison").scrollIntoView({ block: "start", behavior: "instant" });
    } catch { message(text("对比加载失败，请刷新列表后重试。", "Comparison could not load. Refresh and retry."), true); }
    finally { busy = false; updateSelection(); }
  });
  render(); void refresh();
  return { refresh, render, warning: () => message(text("本次报告未能保存到历史，请先下载报告，再检查磁盘空间与权限。", "This report could not be saved. Download it now and check disk space and permissions."), true) };
}
