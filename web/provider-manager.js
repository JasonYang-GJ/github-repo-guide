const STORAGE_KEY = "repo-model-connections-v1";
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
const validModel = value => typeof value === "string" && MODEL_ID.test(value) && !/^sk-/i.test(value) && !value.includes("://");

// Never spread imported objects into storage: copy only known non-secret fields.
function metadata(value) {
  if (!value || typeof value !== "object" || typeof value.id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(value.id)) throw new Error("Invalid connection");
  if (typeof value.name !== "string" || !value.name.trim() || value.name.length > 80 || /[\u0000-\u001f\u007f]/.test(value.name)) throw new Error("Invalid name");
  if (typeof value.baseUrl !== "string" || value.baseUrl.length > 500 || /[\s\\%]/.test(value.baseUrl)) throw new Error("Invalid URL");
  const url = new URL(value.baseUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("Invalid URL");
  if (!["openai-chat", "anthropic-messages"].includes(value.apiFormat)) throw new Error("Invalid format");
  if (!Array.isArray(value.models) || !value.models.length || value.models.length > 30 || !value.models.every(validModel) || new Set(value.models).size !== value.models.length) throw new Error("Invalid models");
  if (!["max_tokens", "max_completion_tokens"].includes(value.tokenParameter) || typeof value.jsonMode !== "boolean") throw new Error("Invalid options");
  return { id: value.id, name: value.name.trim(), baseUrl: value.baseUrl.replace(/\/+$/, ""), apiFormat: value.apiFormat, models: [...value.models], tokenParameter: value.tokenParameter, jsonMode: value.jsonMode };
}

export function createProviderManager({ getLocale, onChange }) {
  const $ = selector => document.querySelector(selector);
  const text = (zh, en) => getLocale() === "en" ? en : zh;
  const set = (id, zh, en) => { $(id).textContent = text(zh, en); };
  const dialog = $("#provider-dialog");
  const picker = $("#connection-select");
  const modelPicker = $("#connection-model");
  const keyInput = $("#connection-api-key");
  const editor = $("#provider-editor-form");
  const editorKey = $("#provider-editor-key");
  const keys = new Map(); // Page-memory only. Never passed to persistence.
  let connections = [];
  let storageProblem = false;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      if (raw.length > 100_000) throw new Error("Oversized configuration");
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length > 20) throw new Error("Invalid list");
      connections = parsed.map(metadata);
      if (new Set(connections.map(item => item.id)).size !== connections.length) throw new Error("Duplicate connections");
    }
  } catch { storageProblem = true; }
  let selectedId = connections[0]?.id ?? "";
  let selectedModel = connections[0]?.models[0] ?? "";
  let editingId = null;
  let version = 0;
  let busy = false;

  function selectedConnection() { return connections.find(item => item.id === selectedId); }
  function configuration(item, model) {
    return { name: item.name, baseUrl: item.baseUrl, apiFormat: item.apiFormat, model,
      tokenParameter: item.tokenParameter, jsonMode: item.jsonMode };
  }
  function selected() {
    const item = selectedConnection();
    return item && item.models.includes(selectedModel) ? { configuration: configuration(item, selectedModel), apiKey: keys.get(item.id) || "" } : null;
  }
  function status(message, failed = false) {
    $("#provider-editor-status").textContent = message;
    $("#provider-editor-status").dataset.state = failed ? "fail" : "";
  }
  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(connections.map(metadata))); storageProblem = false; }
    catch { storageProblem = true; }
  }
  function option(value, label) {
    const element = document.createElement("option"); element.value = value; element.textContent = label; return element;
  }
  function render() {
    const item = selectedConnection();
    picker.replaceChildren(...(connections.length ? connections.map(item => option(item.id, item.name)) : [option("", text("请先添加供应商", "Add a provider first"))]));
    picker.value = selectedId;
    modelPicker.replaceChildren(...(item ? item.models.map(id => option(id, id)) : [option("", text("尚无模型", "No models"))]));
    modelPicker.value = selectedModel;
    picker.disabled = !connections.length; modelPicker.disabled = !item;
    keyInput.disabled = !item; keyInput.value = keys.get(selectedId) || "";
    keyInput.placeholder = text("填写这个供应商自己的密钥（不保存）", "This provider's API key (not saved)");
    $("#connection-empty").hidden = connections.length > 0;
    set("#connection-empty", "还没有供应商。点击“管理供应商”添加自己的 API 接点。", "No providers yet. Open Manage providers to add your API connection.");
    set("#connection-select-label", "模型供应商", "Model provider");
    set("#connection-model-label", "模型", "Model");
    set("#manage-providers", "管理供应商", "Manage providers");
    $("#connection-destination").textContent = item ? `${item.apiFormat === "openai-chat" ? "Chat Completions" : "Anthropic Messages"} · ${item.baseUrl}` : "";
    $("#connection-status").textContent = storageProblem
      ? text("浏览器配置存储不可用或内容损坏；当前修改仅在本页有效。", "Browser configuration storage is unavailable or invalid; current changes are page-only.")
      : text("配置保存在此浏览器；密钥仅在本页内存，刷新后需重填。不会借用本机环境密钥。", "Settings stay in this browser; keys stay only in page memory and must be re-entered after reload. Environment keys are never used.");
    renderSidebar();
  }
  function renderSidebar() {
    const list = $("#provider-list"); list.replaceChildren();
    if (!connections.length) {
      const note = document.createElement("p"); note.className = "provider-list-empty";
      note.textContent = text("尚未添加供应商", "No providers yet"); list.append(note);
    }
    for (const item of connections) {
      const button = document.createElement("button"); button.type = "button"; button.className = "provider-list-item";
      button.setAttribute("aria-pressed", String(item.id === editingId));
      const name = document.createElement("strong"); name.textContent = item.name;
      const detail = document.createElement("small"); detail.textContent = `${item.models.length} ${text("个模型", "models")} · ${keys.has(item.id) ? text("已填密钥，未验证", "key entered, unverified") : text("需填写密钥", "key required")}`;
      button.append(name, detail); button.addEventListener("click", () => edit(item.id)); list.append(button);
    }
  }
  function addModel(value = "") {
    if ($("#provider-model-rows").children.length >= 30) { status(text("每个供应商最多 30 个模型。", "Up to 30 models per provider."), true); return; }
    const row = document.createElement("div"); row.className = "provider-model-row";
    const input = document.createElement("input"); input.value = value; input.maxLength = 100; input.required = true; input.autocomplete = "off"; input.spellcheck = false;
    input.placeholder = text("填写模型 ID，不是显示昵称", "Model ID, not a display nickname"); input.setAttribute("aria-label", text("模型 ID", "Model ID"));
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "utility-button"; remove.textContent = text("移除", "Remove");
    remove.addEventListener("click", () => { row.remove(); version++; status(""); });
    row.append(input, remove); $("#provider-model-rows").append(row); version++;
  }
  function edit(id) {
    editingId = id; version++; editor.reset(); $("#provider-model-rows").replaceChildren();
    const item = connections.find(item => item.id === id);
    $("#provider-name").value = item?.name ?? "";
    $("#provider-base-url").value = item?.baseUrl ?? "";
    $("#provider-api-format").value = item?.apiFormat ?? "openai-chat";
    $("#provider-token-parameter").value = item?.tokenParameter ?? "max_tokens";
    $("#provider-json-mode").checked = item?.jsonMode ?? true;
    editorKey.value = item ? keys.get(item.id) || "" : "";
    for (const model of item?.models ?? [""]) addModel(model);
    status(""); renderEditorLabels(); renderSidebar();
  }
  function renderEditorLabels() {
    set("#provider-list-heading", "我的模型供应商", "My model providers");
    set("#provider-storage-note", "只记住连接配置，密钥不保存。", "Connection settings are saved. Keys are not.");
    set("#new-provider", "＋ 添加供应商", "+ Add provider");
    set("#provider-dialog-title", editingId ? "编辑模型供应商" : "添加模型供应商", editingId ? "Edit model provider" : "Add model provider");
    set("#provider-dialog-intro", "配置自己的 API 端点与模型，不限定供应商品牌。", "Configure your own API endpoint and models, without a vendor catalogue.");
    set("#provider-name-label", "名称", "Name"); set("#provider-format-label", "API 格式", "API format");
    set("#provider-models-heading", "模型列表", "Models"); set("#add-provider-model", "＋ 添加模型", "+ Add model");
    set("#provider-url-help", "填写 API 基础地址，不含 /chat/completions 或 /messages；仅支持公网 HTTPS。", "Enter the base address without /chat/completions or /messages. Public HTTPS only.");
    set("#provider-advanced-label", "兼容性选项（通常无需修改）", "Compatibility options");
    set("#provider-token-label", "输出上限参数", "Output token limit parameter");
    set("#provider-json-label", "发送 JSON 模式参数（不兼容时可关闭，本地仍验证结果）", "Send JSON mode parameter (disable if unsupported; local validation remains)");
    set("#provider-check-note", "检查配置不会调用模型，也不代表密钥有效；开始分析前需另行确认费用。", "Configuration checks never generate content or verify keys. Analysis needs separate billing consent.");
    set("#delete-provider", "删除供应商", "Delete provider"); set("#check-provider", "检查配置", "Check configuration");
    set("#save-provider", editingId ? "保存修改" : "添加供应商", editingId ? "Save changes" : "Add provider");
    $("#delete-provider").hidden = !editingId;
    $("#provider-advanced").hidden = $("#provider-api-format").value !== "openai-chat";
    $("#provider-name").placeholder = text("如：我的 Kimi / Claude / 自建中转", "e.g. My Kimi / Claude / gateway");
    editorKey.placeholder = text("自己的 API Key（仅保留在本页内存）", "Your API key (page-memory only)");
    $("#close-provider-dialog").setAttribute("aria-label", text("关闭", "Close"));
  }
  async function validateDraft(save) {
    if (busy || !editor.reportValidity()) return;
    let draft;
    try {
      draft = metadata({ id: editingId || crypto.randomUUID(), name: $("#provider-name").value.trim(), baseUrl: $("#provider-base-url").value.trim(),
        apiFormat: $("#provider-api-format").value, models: [...document.querySelectorAll("#provider-model-rows input")].map(input => input.value.trim()),
        tokenParameter: $("#provider-token-parameter").value, jsonMode: $("#provider-json-mode").checked });
    } catch { status(text("请填写有效名称、无密钥的 HTTPS 地址，并添加至少一个不重复的模型 ID。", "Enter a name, credential-free HTTPS address and at least one unique model ID."), true); return; }
    if (!editingId && connections.length >= 20) { status(text("最多保存 20 个供应商，请先移除不需要的配置。", "Up to 20 providers; remove an unused connection first."), true); return; }
    const draftKey = editorKey.value.trim();
    if (draftKey.length > 1024 || /[\u0000-\u001f\u007f]/.test(draftKey)) { status(text("密钥包含无效字符。", "Invalid characters in API key."), true); return; }
    const before = version;
    busy = true; $("#save-provider").disabled = true; $("#check-provider").disabled = true;
    status(text("正在检查配置格式（不发送密钥、不调用模型）…", "Checking configuration only (no key or inference)…"));
    try {
      const response = await fetch("/api/connections/test", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "custom", configuration: configuration(draft, draft.models[0]) }) });
      const data = await response.json();
      if (before !== version) return;
      if (!response.ok) { status(getLocale() === "en" ? "Invalid connection. Use a public HTTPS base URL and a valid model ID." : data.error?.message || "配置检查失败。", true); return; }
      if (!save) { status(text("配置格式通过；没有连接供应商，未验证密钥、余额或模型可用性。", "Configuration format passed; no provider connection. Key, balance and model availability are unverified.")); return; }
      draft = metadata({ ...draft, baseUrl: data.configuration.baseUrl });
      const index = connections.findIndex(item => item.id === draft.id);
      if (index < 0) connections.push(draft); else connections[index] = draft;
      if (draftKey) keys.set(draft.id, draftKey); else keys.delete(draft.id);
      selectedId = draft.id; selectedModel = draft.models[0]; persist(); render(); onChange();
      dialog.close(); editorKey.value = "";
    } catch { if (before === version) status(text("无法连接本地服务，配置未保存。", "Cannot reach the local service. Configuration not saved."), true); }
    finally { busy = false; $("#save-provider").disabled = false; $("#check-provider").disabled = false; }
  }
  function open() { edit(selectedId || null); dialog.showModal(); $("#provider-name").focus(); }
  $("#manage-providers").addEventListener("click", open);
  $("#new-provider").addEventListener("click", () => { edit(null); $("#provider-name").focus(); });
  $("#add-provider-model").addEventListener("click", () => addModel());
  $("#close-provider-dialog").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { version++; editorKey.value = ""; });
  editor.addEventListener("input", () => { version++; status(""); });
  for (const id of ["#provider-base-url", "#provider-api-format"]) $(id).addEventListener("input", () => {
    editorKey.value = ""; if (editingId) keys.delete(editingId); render(); onChange(); renderEditorLabels();
    status(text("地址或接口格式改变，旧密钥已清空。请填写新端点对应的密钥。", "Endpoint or API format changed. Old key cleared; enter the key for the new destination."));
  });
  editor.addEventListener("submit", event => { event.preventDefault(); validateDraft(true); });
  $("#check-provider").addEventListener("click", () => validateDraft(false));
  $("#delete-provider").addEventListener("click", () => {
    const item = connections.find(item => item.id === editingId);
    if (!item || !confirm(text(`删除“${item.name}”的连接配置和本页密钥？不会注销服务商账户。`, `Delete ${item.name}'s connection and in-page key? This does not delete the provider account.`))) return;
    connections = connections.filter(other => other.id !== item.id); keys.delete(item.id); version++;
    if (selectedId === item.id) { selectedId = connections[0]?.id || ""; selectedModel = connections[0]?.models[0] || ""; }
    persist(); render(); onChange(); edit(selectedId || null);
  });
  picker.addEventListener("change", () => { selectedId = picker.value; selectedModel = selectedConnection()?.models[0] || ""; render(); onChange(); });
  modelPicker.addEventListener("change", () => { selectedModel = modelPicker.value; onChange(); });
  keyInput.addEventListener("input", () => { if (keyInput.value) keys.set(selectedId, keyInput.value); else keys.delete(selectedId); onChange(); });
  $("#clear-connection-key").addEventListener("click", () => { keys.delete(selectedId); keyInput.value = ""; onChange(); renderSidebar(); });
  return { selected, open, render: () => { render(); renderEditorLabels(); } };
}
