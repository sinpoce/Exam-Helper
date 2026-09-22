// DOM Elements
const statusBadge = document.getElementById("statusBadge");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const questionCount = document.getElementById("questionCount");
const answeredCount = document.getElementById("answeredCount");
const skippedCount = document.getElementById("skippedCount");
const activeModelSelect = document.getElementById("activeModelSelect");
const activeModelHint = document.getElementById("activeModelHint");
const manageModelsBtn = document.getElementById("manageModelsBtn");

const scanBtn = document.getElementById("scanBtn");
const cancelScanBtn = document.getElementById("cancelScanBtn");
const startBtn = document.getElementById("startBtn");
const startBtnText = document.getElementById("startBtnText");

// Settings Modal Elements
const settingsModal = document.getElementById("settingsModal");
const openSettingsBtn = document.getElementById("openSettingsBtn");
const closeSettingsBtn = document.getElementById("closeSettingsBtn");
const closeSettingsBackdrop = document.getElementById("closeSettingsBackdrop");
const modelList = document.getElementById("modelList");
const addModelBtn = document.getElementById("addModelBtn");
const parallelSearchEnabledInput = document.getElementById("parallelSearchEnabled");
const parallelBatchSizeInput = document.getElementById("parallelBatchSize");
const batchSizeRow = document.getElementById("batchSizeRow");
const smartModeInput = document.getElementById("smartMode");
const requestTimeoutInput = document.getElementById("requestTimeoutSeconds");
const answerSettingsStatus = document.getElementById("answerSettingsStatus");
const autoRescanInput = document.getElementById("autoRescan");
const aiAssistInput = document.getElementById("aiAssist");
const recognitionStrategies = document.getElementById("recognitionStrategies");
const scanSummary = document.getElementById("scanSummary");
const taskProgress = document.getElementById("taskProgress");
const progressLabel = document.getElementById("progressLabel");
const settingsTabs = [...document.querySelectorAll("[data-settings-tab]")];
for (const strategy of globalThis.QuestionDOM.STRATEGIES) {
  const label = document.createElement("label");
  label.className = "setting-toggle smart-mode-toggle";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = true;
  input.dataset.strategy = strategy.id;
  const text = document.createElement("span");
  text.textContent = strategy.name;
  label.title = strategy.description;
  label.append(input, text);
  recognitionStrategies.append(label);
}

// Edit Model Modal Elements
const editModelModal = document.getElementById("editModelModal");
const closeEditBtn = document.getElementById("closeEditBtn");
const closeEditBackdrop = document.getElementById("closeEditBackdrop");
const editModalTitle = document.getElementById("editModalTitle");
const editNameInput = document.getElementById("editName");
const editBaseUrlInput = document.getElementById("editBaseUrl");
const editApiKeyInput = document.getElementById("editApiKey");
const editModelInput = document.getElementById("editModel");
const editStatus = document.getElementById("editStatus");
const saveModelBtn = document.getElementById("saveModelBtn");
const toggleEditApiKeyBtn = document.getElementById("toggleEditApiKey");
const editApiTypeInput = document.getElementById("editApiType");
const editAuthModeInput = document.getElementById("editAuthMode");
const editMaxOutputTokensInput = document.getElementById("editMaxOutputTokens");
const editTokenParameterInput = document.getElementById("editTokenParameter");
const endpointPreview = document.getElementById("endpointPreview");
const providerDocs = document.getElementById("providerDocs");
const modelSuggestions = document.getElementById("modelSuggestions");
const testConnectionBtn = document.getElementById("testConnectionBtn");

const modelPresetInput = document.getElementById("modelPreset");
const modelPresetHint = document.getElementById("modelPresetHint");
const modelPresets = globalThis.ModelPresets;
let editingModelId = null;
let editSession = 0;
let savingModel = false;
let selectingModel = false;
let testingConnection = false;
let connectionTestController = null;
let previousFocus = null;

const logContent = document.getElementById("logContent");
const clearLogBtn = document.getElementById("clearLog");

// State
let isRunning = false;
let isScanning = false;
let scanTabId = null;
let hasScanned = false;

const normalizeAnswerSettings = globalThis.AnswerEngine.normalizeSettings;
const aiClient = globalThis.AIClient;
const modelStorage = chrome.storage.local || chrome.storage.sync;

// Built-in default model
const BUILTIN_MODEL = {
  id: "builtin-default",
  name: "默认（内置代理）",
  baseUrl: "https://d.yikfun.de5.net/",
  apiKey: "default",
  model: "Doubao-1.5-pro",
  apiType: "auto",
  authMode: "api-key",
  tokenParameter: "auto",
  builtin: true,
};

function updateProgress(total = Number(questionCount.textContent) || 0, answered = Number(answeredCount.textContent) || 0) {
  taskProgress.max = Math.max(1, total);
  taskProgress.value = Math.min(answered, total);
  progressLabel.textContent = `${answered} / ${total}`;
}

function taskConfig(model) {
  return aiClient.normalizeConfig(model);
}

// Initialize
document.addEventListener("DOMContentLoaded", async () => {
  await globalThis.ExamI18n?.init();
  initializePresetChoices();
  await initModels();
  await renderMainModelSelector();
  await loadAnswerSettings();

  // Check active session
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]) {
    chrome.tabs.sendMessage(tabs[0].id, { action: "getStatus" }, (response) => {
      if (chrome.runtime.lastError) return;

      if (response) {
        questionCount.textContent = response.questionCount || 0;
        answeredCount.textContent = response.answeredCount || 0;
        skippedCount.textContent = response.skippedCount || 0;
        updateProgress(response.questionCount || 0, response.answeredCount || 0);
        hasScanned = response.questionCount > 0;
        showScanSummary(response.scanReport);

        if (response.isScanning) {
          scanTabId = tabs[0].id;
          setScanningState(true);
        } else if (response.isRunning) {
          setRunningState(true);
          addLog("info", "检测到正在运行的任务");
        } else if (response.questionCount > 0) {
          hasScanned = true;
          startBtn.disabled = false;
          addLog("info", "检测到已扫描题目，可以开始");
          if (response.lastCompletion) showCompletion(response.lastCompletion);
        }
      }
    });
  }
});

async function loadAnswerSettings() {
  const data = await chrome.storage.sync.get(["answerSettings"]);
  const settings = normalizeAnswerSettings(data.answerSettings);
  parallelSearchEnabledInput.checked = settings.parallelSearchEnabled;
  parallelBatchSizeInput.value = settings.batchSize;
  batchSizeRow.hidden = !settings.parallelSearchEnabled;
  smartModeInput.checked = settings.smartMode;
  requestTimeoutInput.value = settings.requestTimeoutSeconds;
  autoRescanInput.checked = settings.autoRescan;
  aiAssistInput.checked = settings.aiAssist;
  recognitionStrategies.querySelectorAll("input").forEach(input => { input.checked = !settings.disabledStrategies.includes(input.dataset.strategy); });
}

async function saveAnswerSettings() {
  const settings = normalizeAnswerSettings({
    parallelSearchEnabled: parallelSearchEnabledInput.checked,
    batchSize: parallelBatchSizeInput.value,
    smartMode: smartModeInput.checked,
    requestTimeoutSeconds: requestTimeoutInput.value,
    autoRescan: autoRescanInput.checked,
    aiAssist: aiAssistInput.checked,
    disabledStrategies: [...recognitionStrategies.querySelectorAll("input")].filter(input => !input.checked).map(input => input.dataset.strategy),
  });

  parallelSearchEnabledInput.checked = settings.parallelSearchEnabled;
  parallelBatchSizeInput.value = settings.batchSize;
  batchSizeRow.hidden = !settings.parallelSearchEnabled;
  requestTimeoutInput.value = settings.requestTimeoutSeconds;
  try {
    await chrome.storage.sync.set({ answerSettings: settings });
    answerSettingsStatus.textContent = "已保存；识别策略请重新扫描，批量设置下次开始时生效";
  } catch (_) {
    answerSettingsStatus.textContent = "保存失败，请稍后重试";
  }
}

parallelSearchEnabledInput.addEventListener("change", saveAnswerSettings);
parallelBatchSizeInput.addEventListener("change", saveAnswerSettings);
smartModeInput.addEventListener("change", saveAnswerSettings);
requestTimeoutInput.addEventListener("change", saveAnswerSettings);
autoRescanInput.addEventListener("change", saveAnswerSettings);
aiAssistInput.addEventListener("change", saveAnswerSettings);
recognitionStrategies.addEventListener("change", saveAnswerSettings);

// --- Modal Logic ---
function openModal() {
  previousFocus = document.activeElement;
  settingsModal.inert = false;
  settingsModal.setAttribute("aria-hidden", "false");
  settingsModal.classList.add("open");
  selectSettingsTab("modelsPanel");
  renderModelList();
  closeSettingsBtn.focus();
}

function closeModal() {
  settingsModal.classList.remove("open");
  settingsModal.setAttribute("aria-hidden", "true");
  settingsModal.inert = true;
  previousFocus?.focus?.();
}

function initializePresetChoices() {
  editApiTypeInput.replaceChildren(...Object.entries(aiClient.apiTypes).map(([id, name]) => new Option(name, id)));
  modelPresetInput.replaceChildren(new Option("自定义配置", "custom"));
  const groups = new Map();
  for (const preset of modelPresets.presets) {
    if (!groups.has(preset.provider)) {
      const group = document.createElement("optgroup");
      group.label = preset.provider;
      groups.set(preset.provider, group);
      modelPresetInput.append(group);
    }
    groups.get(preset.provider).append(new Option(preset.name, preset.id));
  }
  const models = [...new Set(modelPresets.presets.map(p => p.model).filter(Boolean))];
  modelSuggestions.replaceChildren(...models.map(model => new Option(model)));
}

function fillPreset(presetId) {
  const preset = modelPresets.presets.find(p => p.id === presetId);
  if (!preset) {
    modelPresetHint.textContent = "自定义配置支持 OpenAI Chat / Responses、Claude Messages、Gemini 原生协议及兼容服务。";
    providerDocs.hidden = true;
    updateEndpointPreview();
    return;
  }
  // Do not transfer credentials from a different service into this preset.
  if (!modelPresets.sameOrigin(editBaseUrlInput.value, preset.baseUrl)) editApiKeyInput.value = "";
  editNameInput.value = preset.name;
  editBaseUrlInput.value = preset.baseUrl;
  editModelInput.value = preset.model;
  editApiTypeInput.value = preset.apiType || "auto";
  editAuthModeInput.value = preset.authMode || "api-key";
  editMaxOutputTokensInput.value = preset.maxOutputTokens || "";
  editTokenParameterInput.value = preset.tokenParameter || "auto";
  modelPresetHint.textContent = preset.note || "已填入服务地址和模型 ID，请填写该服务商的实际 API Key。";
  providerDocs.hidden = !preset.docs;
  if (preset.docs) providerDocs.href = preset.docs;
  syncAuthUI();
  updateEndpointPreview();
}

function selectSettingsTab(panelId) {
  settingsTabs.forEach(tab => {
    const selected = tab.dataset.settingsTab === panelId;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    document.getElementById(tab.dataset.settingsTab).hidden = !selected;
  });
}
settingsTabs.forEach(tab => tab.addEventListener("click", () => selectSettingsTab(tab.dataset.settingsTab)));

function currentFormConfig() {
  return {
    baseUrl: editBaseUrlInput.value.trim(), apiKey: editApiKeyInput.value.trim(), model: editModelInput.value.trim(),
    apiType: editApiTypeInput.value, authMode: editAuthModeInput.value,
    maxOutputTokens: editMaxOutputTokensInput.value, tokenParameter: editTokenParameterInput.value,
  };
}
function syncAuthUI() {
  const optional = editAuthModeInput.value === "none";
  editApiKeyInput.disabled = optional;
  editApiKeyInput.placeholder = optional ? "本机服务免认证" : "输入该服务商的实际 API Key";
  toggleEditApiKeyBtn.disabled = optional;
}
function updateEndpointPreview() {
  try {
    const config = currentFormConfig();
    if (!config.baseUrl || !config.model) throw new Error();
    const endpoint = aiClient.resolveEndpoint(config.baseUrl, config.apiType, config.model);
    endpointPreview.textContent = `请求地址：${endpoint.url}`;
    endpointPreview.classList.remove("error");
  } catch (error) {
    endpointPreview.textContent = editBaseUrlInput.value || editModelInput.value ? (error.message || "填写地址和模型后显示最终请求地址") : "填写地址和模型后显示最终请求地址";
    endpointPreview.classList.toggle("error", Boolean(editBaseUrlInput.value && editModelInput.value));
  }
}

async function openEditModal(modelId = null, presetId = "custom") {
  const session = ++editSession;
  editingModelId = modelId;
  previousFocus = document.activeElement;
  settingsModal.inert = true;
  editModelModal.inert = false;
  editModelModal.setAttribute("aria-hidden", "false");
  editModelModal.classList.add("open");
  editApiKeyInput.type = "password";
  editApiKeyInput.value = "";
  editStatus.textContent = "";
  editStatus.className = "config-status";
  editNameInput.value = "";
  editBaseUrlInput.value = "https://api.openai.com/v1";
  editModelInput.value = "";
  editApiTypeInput.value = "auto";
  editAuthModeInput.value = "api-key";
  editMaxOutputTokensInput.value = "";
  editTokenParameterInput.value = "auto";
  modelPresetInput.value = presetId;
  fillPreset(presetId);
  editModalTitle.textContent = modelId ? "编辑模型" : "添加模型";
  saveModelBtn.textContent = modelId ? "保存修改" : "保存并启用";
  saveModelBtn.disabled = Boolean(modelId);
  modelPresetInput.disabled = Boolean(modelId);
  syncAuthUI();
  updateEndpointPreview();
  closeEditBtn.focus();
  if (!modelId) return;
  try {
    const models = await getAllModels();
    if (session !== editSession) return;
    const model = models.find(m => m.id === modelId && !m.builtin);
    if (!model) throw new Error("模型不存在，请重新打开设置");
    editNameInput.value = model.name;
    editBaseUrlInput.value = model.baseUrl;
    editApiKeyInput.value = model.apiKey;
    editModelInput.value = model.model;
    editApiTypeInput.value = model.apiType || "auto";
    editAuthModeInput.value = model.authMode || "api-key";
    editMaxOutputTokensInput.value = model.maxOutputTokens || "";
    editTokenParameterInput.value = model.tokenParameter || "auto";
    modelPresetInput.value = modelPresets.findPreset(model)?.id || "custom";
    modelPresetHint.textContent = "保留当前配置；选择其他预设会替换名称、地址和模型 ID。";
    const preset = modelPresets.findPreset(model);
    providerDocs.hidden = !preset?.docs;
    if (preset?.docs) providerDocs.href = preset.docs;
    syncAuthUI(); updateEndpointPreview();
    saveModelBtn.disabled = false;
  } catch (error) {
    showEditStatus("error", error.message);
  } finally {
    if (session === editSession) modelPresetInput.disabled = false;
  }
}

function closeEditModal() {
  if (savingModel) return;
  connectionTestController?.abort(); connectionTestController = null; testingConnection = false;
  editSession++;
  editModelModal.classList.remove("open");
  editModelModal.setAttribute("aria-hidden", "true");
  editModelModal.inert = true;
  if (settingsModal.classList.contains("open")) settingsModal.inert = false;
  editingModelId = null;
  editApiKeyInput.value = "";
  editApiKeyInput.type = "password";
  previousFocus?.focus?.();
}

modelPresetInput.addEventListener("change", () => fillPreset(modelPresetInput.value));
[editNameInput, editBaseUrlInput, editModelInput, editApiTypeInput].forEach(input => {
  input.addEventListener("input", () => {
    modelPresetInput.value = modelPresets.findPreset({
      baseUrl: editBaseUrlInput.value, model: editModelInput.value, apiType: editApiTypeInput.value,
    })?.id || "custom";
    updateEndpointPreview();
  });
});
editAuthModeInput.addEventListener("change", syncAuthUI);
openSettingsBtn.addEventListener("click", openModal);
manageModelsBtn.addEventListener("click", openModal);
closeSettingsBtn.addEventListener("click", closeModal);
closeSettingsBackdrop.addEventListener("click", closeModal);
addModelBtn.addEventListener("click", () => openEditModal());
closeEditBtn.addEventListener("click", closeEditModal);
closeEditBackdrop.addEventListener("click", closeEditModal);

// --- Template Management ---
const openTemplatesBtn = document.getElementById("openTemplatesBtn");
openTemplatesBtn.addEventListener("click", () => {
  window.location.href = "template-manager.html";
});

// --- Model Management Logic ---
toggleEditApiKeyBtn.addEventListener("click", () => {
  const type = editApiKeyInput.type === "password" ? "text" : "password";
  editApiKeyInput.type = type;
  toggleEditApiKeyBtn.style.opacity = type === "text" ? "1" : "0.6";
});

testConnectionBtn.addEventListener("click", async () => {
  if (testingConnection) return;
  let config;
  try { config = aiClient.validateConfig(currentFormConfig()); }
  catch (error) { showEditStatus("error", error.message); return; }
  testingConnection = true;
  connectionTestController = new AbortController();
  testConnectionBtn.disabled = true;
  testConnectionBtn.textContent = "正在验证连接…";
  showEditStatus("", "发送简短 JSON 测试请求…");
  try {
    const text = await aiClient.request(config, 'Reply with exactly {"ok":true}.', { mode: "probe", timeoutMs: 30000, signal: connectionTestController.signal });
    const parsed = globalThis.AnswerEngine.parseJSON(text);
    if (parsed?.ok !== true) throw new Error("服务已响应，但没有遵循 JSON 测试格式");
    showEditStatus("success", "连接成功：认证、接口类型、模型 ID 和 JSON 回复均可用");
  } catch (error) {
    if (error.code !== "CANCELLED") showEditStatus("error", `连接测试失败：${error.message}`);
  } finally {
    testingConnection = false; connectionTestController = null;
    testConnectionBtn.disabled = false; testConnectionBtn.textContent = "测试连接与 JSON 回复";
  }
});

async function initModels() {
  let data = await modelStorage.get([
    "aiModels",
    "activeModelId",
    "baseUrl",
    "apiKey",
    "model",
  ]);
  // Move legacy synced credentials to device-local extension storage. Keep the
  // settings sync area only when local storage is unavailable (test/old hosts).
  if (modelStorage !== chrome.storage.sync && !data.aiModels) {
    const legacy = await chrome.storage.sync.get(["aiModels", "activeModelId", "baseUrl", "apiKey", "model"]);
    if (legacy.aiModels || legacy.apiKey) {
      data = legacy;
      await modelStorage.set(legacy);
      await chrome.storage.sync.remove?.(["aiModels", "activeModelId", "baseUrl", "apiKey", "model"]);
    }
  }

  // Migrate old config to new structure
  if (!data.aiModels && data.apiKey) {
    const customModel = {
      id: "custom-" + Date.now(),
      name: "自定义模型",
      baseUrl: data.baseUrl || "https://api.openai.com/v1",
      apiKey: data.apiKey,
      model: data.model || "gpt-4o-mini",
      apiType: "auto", authMode: "api-key", tokenParameter: "auto",
      builtin: false,
    };
    await modelStorage.set({
      aiModels: [customModel],
      activeModelId: customModel.id,
    });
  } else if (!data.aiModels) {
    // First time, set builtin as active
    await modelStorage.set({
      aiModels: [],
      activeModelId: BUILTIN_MODEL.id,
    });
  }
}

async function getAllModels() {
  const data = await modelStorage.get(["aiModels"]);
  return [BUILTIN_MODEL, ...(data.aiModels || [])];
}

async function getActiveModel() {
  const data = await modelStorage.get(["aiModels", "activeModelId"]);
  const models = [BUILTIN_MODEL, ...(data.aiModels || [])];
  const activeId = data.activeModelId || BUILTIN_MODEL.id;
  const model = models.find(m => m.id === activeId);
  if (!model) throw new Error("所选模型不存在，请重新选择；不会自动切换到其他服务");
  return model;
}

async function getModelForTask() {
  try {
    const model = await getActiveModel();
    aiClient.validateConfig(model);
    return model;
  } catch (error) {
    addLog("error", error.message);
    updateStatus("error", "请检查模型配置");
    return null;
  }
}

async function renderMainModelSelector() {
  const models = await getAllModels();
  const data = await modelStorage.get(["activeModelId"]);
  const activeId = data.activeModelId || BUILTIN_MODEL.id;
  const activeModel = models.find(m => m.id === activeId);
  const configured = document.createElement("optgroup");
  configured.label = "已配置模型";
  models.forEach(model => configured.append(new Option(model.name, model.id)));
  const presets = document.createElement("optgroup");
  presets.label = "添加并配置模型";
  modelPresets.presets.forEach(preset => {
    if (!models.some(model => modelPresets.findPreset(model)?.id === preset.id)) {
      presets.append(new Option(preset.name + "（待配置）", "preset:" + preset.id));
    }
  });
  presets.append(new Option("添加自定义模型…", "preset:custom"));
  activeModelSelect.replaceChildren(configured, presets);
  if (!activeModel) activeModelSelect.prepend(new Option("所选模型已不存在，请重新选择", ""));
  activeModelSelect.value = activeModel?.id || "";
  activeModelSelect.disabled = isRunning || isScanning || selectingModel;
  let apiName = "接口待确认";
  try { apiName = aiClient.apiTypes[aiClient.resolveEndpoint(activeModel?.baseUrl, activeModel?.apiType, activeModel?.model).kind]; } catch (_) {}
  activeModelHint.textContent = activeModel
    ? `${activeModel.model} · ${apiName} · 切换后用于下次扫描和答题`
    : "请选择并保存有效模型，不会自动回退到内置代理。";
}

async function activateModel(modelId) {
  if (selectingModel) return;
  selectingModel = true;
  activeModelSelect.disabled = true;
  try {
    const models = await getAllModels();
    const model = models.find(m => m.id === modelId);
    if (!model) throw new Error("模型已被删除，请重新选择");
    aiClient.validateConfig(model);
    await modelStorage.set({ activeModelId: modelId });
    addLog("success", `已选择 ${model.name}（${model.model}）${isRunning ? "，下次任务生效" : ""}`);
    closeModal();
  } catch (error) {
    addLog("error", `切换失败：${error.message}`);
  } finally {
    selectingModel = false;
    await renderMainModelSelector();
  }
}

activeModelSelect.addEventListener("change", async () => {
  const selected = activeModelSelect.value;
  if (selected.startsWith("preset:")) {
    // Selecting an unconfigured preset must not change the active model.
    await openEditModal(null, selected.slice(7));
    await renderMainModelSelector();
  } else if (selected) await activateModel(selected);
});

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function modelProtocol(model) {
  try {
    const { kind } = aiClient.resolveEndpoint(model.baseUrl, model.apiType, model.model);
    return aiClient.apiTypes[kind] || kind;
  } catch (_) { return "配置待检查"; }
}

async function renderModelList() {
  const models = await getAllModels();
  const data = await modelStorage.get(["activeModelId"]);
  const activeId = data.activeModelId || BUILTIN_MODEL.id;

  modelList.innerHTML = models
    .map(
      (model) => `
    <div class="model-item ${
      model.id === activeId ? "active" : ""
    }" data-model-id="${escapeHTML(model.id)}">
      <input type="radio" name="activeModel" class="model-radio" aria-label="选择 ${escapeHTML(model.name)}" value="${
        escapeHTML(model.id)
      }" ${model.id === activeId ? "checked" : ""}>
      <div class="model-info">
        <div class="model-name">
          ${escapeHTML(model.name)}
          ${model.builtin ? '<span class="model-badge">内置</span>' : ""}
        </div>
        <div class="model-meta">${escapeHTML(model.model)} · ${escapeHTML(modelProtocol(model))}</div>
      </div>
      <div class="model-actions">
        ${
          !model.builtin
            ? `
          <button class="icon-btn edit-model-btn" aria-label="编辑 ${escapeHTML(model.name)}" title="编辑" data-model-id="${escapeHTML(model.id)}">
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
          </button>
          <button class="icon-btn delete-model-btn" aria-label="删除 ${escapeHTML(model.name)}" title="删除" data-model-id="${escapeHTML(model.id)}">
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
          </button>
        `
            : ""
        }
      </div>
    </div>
  `
    )
    .join("");

  // Add click event to entire model card
  document.querySelectorAll(".model-item").forEach((item) => {
    item.addEventListener("click", async (e) => {
      // Don't trigger if clicking on action buttons
      if (
        e.target.closest(".edit-model-btn") ||
        e.target.closest(".delete-model-btn")
      ) {
        return;
      }

      await activateModel(item.dataset.modelId);
    });
  });

  // Add event listeners for edit buttons
  document.querySelectorAll(".edit-model-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const modelId = e.currentTarget.dataset.modelId;
      openEditModal(modelId);
    });
  });

  // Add event listeners for delete buttons
  document.querySelectorAll(".delete-model-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const modelId = e.currentTarget.dataset.modelId;
      if (!confirm("确定要删除这个模型吗？")) return;

      const data = await modelStorage.get(["aiModels", "activeModelId"]);
      const models = (data.aiModels || []).filter((m) => m.id !== modelId);

      const updates = { aiModels: models };
      if (data.activeModelId === modelId) {
        updates.activeModelId = BUILTIN_MODEL.id;
      }

      await modelStorage.set(updates);
      await renderMainModelSelector();
      renderModelList();
    });
  });
}

saveModelBtn.addEventListener("click", async () => {
  if (savingModel || saveModelBtn.disabled) return;
  const name = editNameInput.value.trim();
  const baseUrl = editBaseUrlInput.value.trim().replace(/\/+$/, "");
  const apiKey = editApiKeyInput.value.trim();
  const model = editModelInput.value.trim();
  const rawConfig = currentFormConfig();
  if (!name || !baseUrl || !model || (rawConfig.authMode !== "none" && !apiKey)) {
    showEditStatus("error", "请填写名称、地址、模型 ID，以及该服务需要的实际 API Key");
    return;
  }
  let normalizedConfig;
  try {
    normalizedConfig = aiClient.validateConfig(rawConfig);
  } catch (error) {
    showEditStatus("error", error.message);
    return;
  }
  savingModel = true;
  saveModelBtn.disabled = true;
  saveModelBtn.textContent = "保存中...";
  const idBeingEdited = editingModelId;
  try {
    const data = await modelStorage.get(["aiModels"]);
    const models = [...(data.aiModels || [])];
    let activeId;
    if (idBeingEdited) {
      const index = models.findIndex(m => m.id === idBeingEdited);
      if (index < 0) throw new Error("模型已被删除，请重新添加");
      models[index] = { ...models[index], name, ...normalizedConfig };
    } else {
      activeId = "custom-" + crypto.randomUUID();
      models.push({ id: activeId, name, ...normalizedConfig, builtin: false });
    }
    // Model config and activation are committed in the same storage update.
    await modelStorage.set({ aiModels: models, ...(activeId ? { activeModelId: activeId } : {}) });
    savingModel = false;
    closeEditModal();
    await renderMainModelSelector();
    await renderModelList();
    addLog("success", activeId ? `已保存并启用 ${name}（${normalizedConfig.model}）` : `已保存 ${name} 的配置`);
  } catch (error) {
    showEditStatus("error", `保存失败：${error.message}`);
  } finally {
    savingModel = false;
    saveModelBtn.disabled = false;
    saveModelBtn.textContent = idBeingEdited ? "保存修改" : "保存并启用";
  }
});

function showEditStatus(type, message) {
  editStatus.textContent = message;
  editStatus.className = `config-status ${type}`;
}

document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  if (editModelModal.classList.contains("open") && !savingModel) closeEditModal();
  else if (settingsModal.classList.contains("open")) closeModal();
});

// --- Action Logic ---

// 确保 content script 已注入到目标页面
async function ensureContentScriptInjected(tabId) {
  try {
    // 先尝试发送一个测试消息
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { action: "getStatus" }, (response) => {
        if (chrome.runtime.lastError) {
          // Content script 未加载，尝试注入
          console.log("[popup] Content script 未加载，尝试注入...");
          injectContentScript(tabId)
            .then(resolve)
            .catch(() => resolve(false));
        } else {
          // 已加载
          resolve(true);
        }
      });
    });
  } catch (e) {
    console.error("[popup] 检查 content script 失败:", e);
    return false;
  }
}

// 程序化注入 content script
async function injectContentScript(tabId) {
  try {
    // 检查是否是可以注入的页面
    const tab = await chrome.tabs.get(tabId);
    if (
      !tab.url ||
      tab.url.startsWith("chrome://") ||
      tab.url.startsWith("chrome-extension://") ||
      tab.url.startsWith("edge://") ||
      tab.url.startsWith("about:")
    ) {
      console.log("[popup] 无法在系统页面注入脚本");
      return false;
    }

    // 注入 CSS
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["content.css"],
    });

    // 按顺序注入 JS 模块
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [
        "modules/answer-engine.js",
        "modules/question-dom.js",
        "modules/site-matcher.js",
        "modules/template-manager.js",
        "content.js",
      ],
    });

    console.log("[popup] Content script 注入成功");
    // 等待脚本初始化
    await new Promise((resolve) => setTimeout(resolve, 200));
    return true;
  } catch (e) {
    console.error("[popup] 注入 content script 失败:", e);
    return false;
  }
}

// 1. Scan
scanBtn.addEventListener("click", async () => {
  if (selectingModel || savingModel || isScanning || isRunning) return;
  const activeModel = await getModelForTask();
  if (!activeModel) return;
  const config = taskConfig(activeModel);

  addLog("info", "正在扫描题目...");
  updateStatus("running", "扫描中...");
  scanBtn.disabled = true;

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]) {
    addLog("error", "无法获取当前标签页");
    updateStatus("error", "连接失败");
    scanBtn.disabled = false;
    return;
  }

  const tab = tabs[0];

  // 检查是否是系统页面
  if (
    !tab.url ||
    tab.url.startsWith("chrome://") ||
    tab.url.startsWith("chrome-extension://") ||
    tab.url.startsWith("edge://") ||
    tab.url.startsWith("about:")
  ) {
    addLog("error", "请切换到有题目的网页再扫描");
    updateStatus("error", "系统页面");
    scanBtn.disabled = false;
    return;
  }

  // 确保 content script 已注入
  const injected = await ensureContentScriptInjected(tab.id);
  if (!injected) {
    addLog("error", "无法连接到页面，请刷新页面后重试");
    updateStatus("error", "连接失败");
    scanBtn.disabled = false;
    return;
  }

  scanTabId = tab.id;
  setScanningState(true);
  let storedSettings;
  try { storedSettings = await chrome.storage.sync.get(["answerSettings"]); }
  catch (_) {
    setScanningState(false);
    updateStatus("error", "读取设置失败");
    return;
  }
  const answerSettings = normalizeAnswerSettings(storedSettings.answerSettings);
  chrome.tabs.sendMessage(tab.id, { action: "scan", config, answerSettings }, (response) => {
    setScanningState(false);

    if (chrome.runtime.lastError) {
      addLog("error", "连接失败，请刷新页面后重试");
      updateStatus("error", "连接失败");
      return;
    }

    if (response && response.success) {
      showScanSummary(response.scanReport);
      questionCount.textContent = response.count;
      answeredCount.textContent = "0";
      skippedCount.textContent = "0";
      updateProgress(response.count, 0);
      hasScanned = true;
      startBtn.disabled = false;
      addLog("success", `${response.cancelled ? "扫描已取消，保留" : "扫描完成:"} ${response.count} 题`);
      updateStatus("ready", response.cancelled ? "扫描已取消" : "扫描完成");
    } else {
      questionCount.textContent = response?.count || 0;
      answeredCount.textContent = "0";
      skippedCount.textContent = "0";
      updateProgress(response?.count || 0, 0);
      hasScanned = false;
      startBtn.disabled = true;
      showScanSummary(response?.scanReport);
      addLog("warning", response?.message || "未发现题目");
      updateStatus("ready", "未发现题目");
    }
  });
});

function setScanningState(active) {
  isScanning = active;
  cancelScanBtn.hidden = !active;
  cancelScanBtn.disabled = false;
  scanBtn.disabled = active || isRunning;
  startBtn.disabled = active || (!isRunning && !hasScanned);
  activeModelSelect.disabled = active || isRunning || selectingModel;
  if (active) updateStatus("running", "扫描中...");
}
cancelScanBtn.addEventListener("click", () => {
  if (!isScanning || scanTabId == null) return;
  cancelScanBtn.disabled = true;
  chrome.tabs.sendMessage(scanTabId, { action: "stop" }, () => {
    const failed = Boolean(chrome.runtime.lastError);
    setScanningState(false);
    updateStatus(failed ? "error" : "ready", failed ? "取消失败，请刷新页面" : "扫描已取消");
  });
});

// 2. Start/Pause Toggle
startBtn.addEventListener("click", async () => {
  if ((!hasScanned && !isRunning) || selectingModel || savingModel || isScanning) return;

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]) {
    addLog("error", "无法获取当前标签页");
    return;
  }

  const tab = tabs[0];

  if (isRunning) {
    // Pause/Stop
    setRunningState(false);
    addLog("warning", "已暂停答题");
    chrome.tabs.sendMessage(tab.id, { action: "stop" });
  } else {
    // 检查是否是系统页面
    if (
      !tab.url ||
      tab.url.startsWith("chrome://") ||
      tab.url.startsWith("chrome-extension://") ||
      tab.url.startsWith("edge://") ||
      tab.url.startsWith("about:")
    ) {
      addLog("error", "请切换到有题目的网页");
      return;
    }

    // 确保 content script 已注入
    const injected = await ensureContentScriptInjected(tab.id);
    if (!injected) {
      addLog("error", "无法连接到页面，请刷新页面后重试");
      return;
    }

    // Start
    const activeModel = await getModelForTask();
    if (!activeModel) return;
    const answerSettingsData = await chrome.storage.sync.get(["answerSettings"]);
    const answerSettings = normalizeAnswerSettings(answerSettingsData.answerSettings);
    const config = taskConfig(activeModel);

    setRunningState(true);
    addLog("info", `开始自动答题，模型：${activeModel.name}（${activeModel.model}）`);
    chrome.tabs.sendMessage(
      tab.id,
      {
        action: "start",
        config: config,
        answerSettings,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          setRunningState(false);
          addLog("error", "连接中断，请刷新页面后重试");
        } else if (!response?.success) {
          setRunningState(false);
          addLog("error", response?.error || "启动失败");
        }
      }
    );
  }
});

function setRunningState(active) {
  isRunning = active;
  activeModelSelect.disabled = active || isScanning || selectingModel;
  if (active) {
    startBtn.disabled = false;
    startBtnText.textContent = "暂停答题";
    startBtn.classList.remove("btn-dark");
    startBtn.classList.add("btn-warning");
    scanBtn.disabled = true;
    updateStatus("running", "答题中...");
  } else {
    startBtn.disabled = isScanning || !hasScanned;
    startBtnText.textContent = "开始自动答题";
    startBtn.classList.remove("btn-warning");
    startBtn.classList.add("btn-dark");
    scanBtn.disabled = isScanning;
    updateStatus("ready", "就绪");
  }
}

// --- Helpers ---

function updateStatus(type, text) {
  statusDot.className = `status-dot ${type}`;
  statusText.textContent = text;
}

function addLog(type, message) {
  const time = new Date().toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
  const logItem = document.createElement("div");
  logItem.className = `log-item log-${type}`;
  const timeElement = document.createElement("span");
  timeElement.className = "log-time";
  timeElement.textContent = time;
  const messageElement = document.createElement("span");
  messageElement.className = "log-msg";
  messageElement.textContent = message;
  logItem.append(timeElement, messageElement);
  logContent.appendChild(logItem);
  logContent.scrollTop = logContent.scrollHeight;
}

clearLogBtn.addEventListener("click", () => {
  logContent.innerHTML = "";
  addLog("info", "日志已清空");
});

// Message Listener
function showScanSummary(report) {
  if (!report) return;
  const names = { ...Object.fromEntries(globalThis.QuestionDOM.STRATEGIES.map(s => [s.id, s.name])), 'ai-assisted': 'AI 辅助确认' };
  const parts = Object.entries(report.strategies || {}).map(([id, count]) => `${names[id] || id} ${count} 题`);
  scanSummary.textContent = [...parts, `待确认题块 ${report.candidateCount || 0}`, ...(report.diagnostics || [])].join("；");
}

function showCompletion(message) {
  setRunningState(false);
  answeredCount.textContent = message.answeredCount || 0;
  skippedCount.textContent = message.skippedCount || 0;
  updateProgress(Number(questionCount.textContent) || 0, message.answeredCount || 0);
  const title = message.reason === "stopped" ? "已暂停" : message.reason === "error" ? "任务异常停止" :
    message.skippedCount || message.remainingCount || message.candidateCount || message.hasUnsupportedRegions ? "本轮结束，有题待处理" : "已识别题目填写完成";
  updateStatus(message.reason === "error" ? "error" : "ready", title);
  addLog(message.reason === "error" ? "error" : message.skippedCount ? "warning" : "info",
    `${title}：已填写 ${message.answeredCount || 0} 题，跳过 ${message.skippedCount || 0} 题，未处理 ${message.remainingCount || 0} 题，待确认题块 ${message.candidateCount || 0}。`);
}

chrome.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case "log":
      addLog(message.level, message.text);
      break;
    case "updateStats":
      questionCount.textContent = message.questionCount;
      answeredCount.textContent = message.answeredCount;
      skippedCount.textContent = message.skippedCount || 0;
      updateProgress(message.questionCount || 0, message.answeredCount || 0);
      showScanSummary(message.scanReport);
      hasScanned = message.hasScanned !== false && message.questionCount > 0;
      if (typeof message.isScanning === 'boolean') setScanningState(message.isScanning);
      if (!isRunning) startBtn.disabled = isScanning || !hasScanned;
      break;
    case "complete":
      showCompletion(message);
      break;
    case "error":
      setRunningState(false);
      updateStatus("error", "错误");
      addLog("error", message.text);
      break;
  }
});
