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
  const sessionKeys = new Map();
  const storedKeys = new Map();
  let connections = [];
  let configurationStorageProblem = false;
  let credentialStorageProblem = false;
  let credentialStorage = "loading";
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      if (raw.length > 100_000) throw new Error("Oversized configuration");
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length > 20) throw new Error("Invalid list");
      connections = parsed.map(metadata);
      if (new Set(connections.map(item => item.id)).size !== connections.length) throw new Error("Duplicate connections");
    }
  } catch { configurationStorageProblem = true; }
  let selectedId = connections[0]?.id ?? "";
  let selectedModel = connections[0]?.models[0] ?? "";
  let editingId = null;
  let version = 0;
  let busy = false;
  let replacingCredentialId = null;

  function selectedConnection() { return connections.find(item => item.id === selectedId); }
  function configuration(item, model) {
    return { name: item.name, baseUrl: item.baseUrl, apiFormat: item.apiFormat, model,
      tokenParameter: item.tokenParameter, jsonMode: item.jsonMode };
  }
  function selected() {
    const item = selectedConnection();
    if (!item || !item.models.includes(selectedModel)) return null;
    const apiKey = sessionKeys.get(item.id) || "";
    return {
      configuration: configuration(item, selectedModel),
      apiKey,
      credentialId: !apiKey && storedKeys.has(item.id) ? item.id : "",
    };
  }
  function status(message, failed = false) {
    $("#provider-editor-status").textContent = message;
    $("#provider-editor-status").dataset.state = failed ? "fail" : "";
  }
  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(connections.map(metadata))); configurationStorageProblem = false; }
    catch { configurationStorageProblem = true; }
  }
  async function credentialRequest(url, options = {}) {
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || text("本机密钥操作失败。", "Local credential operation failed."));
    return data;
  }
  async function loadCredentials() {
    try {
      const data = await credentialRequest("/api/credentials");
      credentialStorage = data.storage;
      storedKeys.clear();
      for (const item of data.credentials || []) storedKeys.set(item.providerId, item);
      credentialStorageProblem = false;
    } catch {
      credentialStorage = "unavailable";
      credentialStorageProblem = true;
    }
    render(); renderEditorLabels(); onChange();
  }
  async function saveCredential(item, apiKey) {
    const data = await credentialRequest("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: item.id, configuration: configuration(item, item.models[0]), apiKey }),
    });
    storedKeys.set(item.id, data.credential);
    credentialStorage = "windows_dpapi_current_user";
    credentialStorageProblem = false;
    return data.credential;
  }
  async function deleteCredential(id) {
    await credentialRequest(`/api/credentials/${encodeURIComponent(id)}`, { method: "DELETE" });
    storedKeys.delete(id);
    sessionKeys.delete(id);
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
    const stored = storedKeys.get(selectedId);
    const replacing = Boolean(item && stored && replacingCredentialId === item.id);
    const loadingCredentials = credentialStorage === "loading";
    const showSavedCredential = Boolean(item && stored && !replacing);
    const showKeyEditor = Boolean(item && !loadingCredentials && (!stored || replacing));
    $("#connection-key-saved").hidden = !showSavedCredential;
    $("#connection-key-editor").hidden = !showKeyEditor;
    keyInput.disabled = !showKeyEditor || busy;
    keyInput.value = showKeyEditor ? sessionKeys.get(selectedId) || "" : "";
    keyInput.placeholder = replacing
      ? text("填写新的 API Key", "Enter the new API key")
      : text("填写这个供应商自己的 API Key", "Enter this provider's API key");
    $("#save-connection-key").disabled = !showKeyEditor || !keyInput.value || busy;
    $("#cancel-connection-key").hidden = !replacing;
    $("#cancel-connection-key").disabled = busy;
    $("#replace-connection-key").disabled = !showSavedCredential || busy;
    $("#clear-connection-key").disabled = !showSavedCredential || busy;
    $("#connection-key-saved-title").textContent = text("密钥已安全保存", "API key saved securely");
    $("#connection-key-saved-detail").textContent = stored
      ? text(`尾号 ${stored.lastFour} · 刷新后可直接使用`, `Ends in ${stored.lastFour} · ready after reload`)
      : "";
    $("#connection-empty").hidden = connections.length > 0;
    set("#connection-empty", "还没有供应商。点击“管理供应商”添加自己的 API 接点。", "No providers yet. Open Manage providers to add your API connection.");
    set("#connection-select-label", "模型供应商", "Model provider");
    set("#connection-model-label", "模型", "Model");
    set("#manage-providers", "管理供应商", "Manage providers");
    set("#connection-api-key-label", replacing ? "新 API Key" : "API Key", replacing ? "New API key" : "API key");
    set("#save-connection-key", replacing ? "保存新密钥" : "保存密钥", replacing ? "Save new key" : "Save key");
    set("#cancel-connection-key", "取消更换", "Cancel replacement");
    set("#replace-connection-key", "更换密钥", "Replace key");
    set("#clear-connection-key", "删除密钥", "Delete key");
    $("#connection-destination").textContent = item ? `${item.apiFormat === "openai-chat" ? "Chat Completions" : "Anthropic Messages"} · ${item.baseUrl}` : "";
    if (configurationStorageProblem) {
      $("#connection-status").textContent = text("浏览器无法保存供应商配置；当前修改仅在本页有效。", "The browser cannot save provider settings; current changes are page-only.");
    } else if (credentialStorageProblem) {
      $("#connection-status").textContent = text("无法读取本机密钥记录；请确认本地服务正在运行。", "Saved credentials could not be loaded; confirm the local service is running.");
    } else if (stored) {
      $("#connection-status").textContent = "";
    } else if (credentialStorage === "loading") {
      $("#connection-status").textContent = text("正在读取本机密钥记录…", "Loading saved credentials…");
    } else {
      $("#connection-status").textContent = text("尚未保存密钥。填入后点击“保存密钥”。", "No saved key yet. Enter one, then choose Save key.");
    }
    $("#connection-status").dataset.state = credentialStorageProblem ? "fail" : "";
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
      const stored = storedKeys.get(item.id);
      const keyState = stored
        ? text(`密钥已保存 · 尾号 ${stored.lastFour}`, `key saved · ends in ${stored.lastFour}`)
        : sessionKeys.has(item.id) ? text("密钥待保存", "key not saved yet") : text("需填写密钥", "key required");
      const detail = document.createElement("small"); detail.textContent = `${item.models.length} ${text("个模型", "models")} · ${keyState}`;
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
    editorKey.value = "";
    for (const model of item?.models ?? [""]) addModel(model);
    status(""); renderEditorLabels(); renderSidebar();
  }
  function renderEditorLabels() {
    set("#provider-list-heading", "我的模型供应商", "My model providers");
    set("#provider-storage-note", "供应商和密钥记录保存在这台电脑；密钥由 Windows 当前用户加密。", "Providers and key records stay on this computer; keys are protected for the current Windows user.");
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
    const stored = editingId ? storedKeys.get(editingId) : null;
    editorKey.placeholder = stored
      ? text(`已保存尾号 ${stored.lastFour}；留空继续使用，填写可替换`, `Saved key ends in ${stored.lastFour}; leave blank to keep it or enter a replacement`)
      : text("自己的 API Key（保存后刷新仍可使用）", "Your API key (available after reload once saved)");
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
      const previous = connections.find(item => item.id === draft.id);
      const destinationChanged = previous && (previous.baseUrl !== draft.baseUrl || previous.apiFormat !== draft.apiFormat);
      if (draftKey) {
        status(text("正在用 Windows 当前用户加密保存密钥…", "Protecting the key for the current Windows user…"));
        await saveCredential(draft, draftKey);
      } else if (destinationChanged && storedKeys.has(draft.id)) {
        await deleteCredential(draft.id);
      }
      const index = connections.findIndex(item => item.id === draft.id);
      if (index < 0) connections.push(draft); else connections[index] = draft;
      sessionKeys.delete(draft.id);
      selectedId = draft.id; selectedModel = draft.models[0]; persist(); render(); onChange();
      dialog.close(); editorKey.value = "";
    } catch (error) { if (before === version) status(error instanceof Error ? error.message : text("无法连接本地服务，配置未保存。", "Cannot reach the local service. Configuration not saved."), true); }
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
    editorKey.value = ""; renderEditorLabels();
    status(text("地址或接口格式如有变化，保存时会停用旧密钥；请填写新端点对应的密钥。", "If the endpoint or API format changed, saving will retire the old key. Enter the key for the new destination."));
  });
  editor.addEventListener("submit", event => { event.preventDefault(); validateDraft(true); });
  $("#check-provider").addEventListener("click", () => validateDraft(false));
  $("#delete-provider").addEventListener("click", async () => {
    const item = connections.find(item => item.id === editingId);
    if (!item || busy || !confirm(text(`删除“${item.name}”及其本机密钥记录？不会注销服务商账户。`, `Delete ${item.name} and its local key record? This does not delete the provider account.`))) return;
    busy = true; $("#delete-provider").disabled = true;
    try {
      if (storedKeys.has(item.id)) await deleteCredential(item.id);
      connections = connections.filter(other => other.id !== item.id); sessionKeys.delete(item.id); version++;
      if (replacingCredentialId === item.id) replacingCredentialId = null;
      if (selectedId === item.id) { selectedId = connections[0]?.id || ""; selectedModel = connections[0]?.models[0] || ""; }
      persist(); render(); onChange(); edit(selectedId || null);
    } catch (error) {
      status(error instanceof Error ? error.message : text("删除本机密钥记录失败。", "Failed to delete the local key record."), true);
    } finally { busy = false; $("#delete-provider").disabled = false; }
  });
  picker.addEventListener("change", () => {
    if (replacingCredentialId) sessionKeys.delete(replacingCredentialId);
    replacingCredentialId = null; selectedId = picker.value; selectedModel = selectedConnection()?.models[0] || ""; render(); onChange();
  });
  modelPicker.addEventListener("change", () => { selectedModel = modelPicker.value; onChange(); });
  keyInput.addEventListener("input", () => {
    if (keyInput.value) sessionKeys.set(selectedId, keyInput.value); else sessionKeys.delete(selectedId);
    $("#save-connection-key").disabled = !keyInput.value;
    renderSidebar(); onChange();
  });
  $("#replace-connection-key").addEventListener("click", () => {
    const item = selectedConnection();
    if (!item || !storedKeys.has(item.id) || busy) return;
    sessionKeys.delete(item.id); replacingCredentialId = item.id; render(); keyInput.focus(); onChange();
  });
  $("#cancel-connection-key").addEventListener("click", () => {
    const item = selectedConnection();
    if (!item || replacingCredentialId !== item.id || busy) return;
    sessionKeys.delete(item.id); replacingCredentialId = null; keyInput.value = ""; render(); onChange();
  });
  $("#save-connection-key").addEventListener("click", async () => {
    const item = selectedConnection();
    const apiKey = keyInput.value.trim();
    if (!item || !apiKey || busy) return;
    busy = true; $("#save-connection-key").disabled = true; $("#cancel-connection-key").disabled = true;
    $("#connection-status").textContent = text("正在用 Windows 当前用户加密保存密钥…", "Protecting the key for the current Windows user…");
    $("#connection-status").dataset.state = "";
    let succeeded = false;
    try {
      await saveCredential(item, apiKey);
      sessionKeys.delete(item.id); replacingCredentialId = null; keyInput.value = ""; succeeded = true; onChange();
    } catch (error) {
      $("#connection-status").textContent = error instanceof Error ? error.message : text("密钥没有保存。", "The key was not saved.");
      $("#connection-status").dataset.state = "fail";
    } finally {
      busy = false;
      if (succeeded) render();
      else { $("#save-connection-key").disabled = !keyInput.value; $("#cancel-connection-key").disabled = false; }
    }
  });
  $("#clear-connection-key").addEventListener("click", async () => {
    const item = selectedConnection();
    if (!item || busy) return;
    if (!storedKeys.has(item.id) || !confirm(text(`删除“${item.name}”的本机密钥记录？`, `Delete the local key record for ${item.name}?`))) return;
    busy = true; $("#clear-connection-key").disabled = true; $("#replace-connection-key").disabled = true;
    let succeeded = false;
    try { await deleteCredential(item.id); replacingCredentialId = null; succeeded = true; onChange(); }
    catch (error) {
      $("#connection-status").textContent = error instanceof Error ? error.message : text("密钥记录没有删除。", "The key record was not deleted.");
      $("#connection-status").dataset.state = "fail";
    } finally {
      busy = false;
      if (succeeded) render();
      else { $("#clear-connection-key").disabled = false; $("#replace-connection-key").disabled = false; }
    }
  });
  const ready = loadCredentials();
  return { selected, open, ready, render: () => { render(); renderEditorLabels(); } };
}
