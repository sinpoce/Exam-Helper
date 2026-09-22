// Offline UI tests: no real provider requests, credentials or user tabs.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { presets } = require('../modules/model-presets.js');
const root = path.resolve(__dirname, '..');
const deepseek = presets.find(p => p.id === 'ark-deepseek');
const savedModel = { ...deepseek, id: 'saved-deepseek', apiKey: 'test-only-not-a-key', builtin: false };
let browser;
before(async () => { browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) }); });
after(async () => { await browser?.close(); });
async function setup(data = { aiModels: [], activeModelId: 'builtin-default' }) {
  const page = await browser.newPage({ viewport: { width: 420, height: 850 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const allowed = new Set(['popup.html', 'popup.css', 'popup.js', 'icons/icon128.png', 'modules/answer-engine.js', 'modules/question-dom.js', 'modules/ai-client.js', 'modules/model-presets.js']);
  await page.route('**/*', route => {
    const file = new URL(route.request().url()).pathname.slice(1);
    if (!allowed.has(file)) return route.abort();
    return route.fulfill({ contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'text/javascript', body: fs.readFileSync(path.join(root, file)) });
  });
  await page.addInitScript(data => {
    window.saved = data; window.sent = []; window.writes = []; window.listeners = []; window.failWrites = false;
    window.chrome = {
      storage: { sync: {
        get: async () => structuredClone(saved),
        set: async update => {
          if (failWrites) throw new Error('storage unavailable');
          writes.push(structuredClone(update));
          Object.assign(saved, structuredClone(update));
        },
      } },
      tabs: {
        query: async () => [{ id: 1, url: 'https://fixture.invalid/questions' }],
        sendMessage: (_, message, callback) => {
          sent.push(message);
          callback?.(message.action === 'getStatus' ? { questionCount: 8, answeredCount: 0 } : { success: true, count: 8 });
        },
      },
      runtime: { onMessage: { addListener: fn => listeners.push(fn) } },
    };
  }, data);
  await page.goto('https://fixture.invalid/popup.html');
  await page.waitForFunction(() => !document.querySelector('#activeModelSelect').disabled);
  return { page, errors };
}
async function chooseDeepseek(page) {
  await page.selectOption('#activeModelSelect', 'preset:ark-deepseek');
  await page.waitForFunction(() => document.querySelector('#editModelModal').classList.contains('open'));
}

test('DeepSeek preset fills exact contract, validates key, saves atomically and is used for both scan and start', async () => {
  const { page, errors } = await setup();
  try {
    await chooseDeepseek(page);
    assert.equal(await page.inputValue('#modelPreset'), deepseek.id);
    assert.equal(await page.inputValue('#editBaseUrl'), deepseek.baseUrl);
    assert.equal(await page.inputValue('#editModel'), deepseek.model);
    assert.equal(await page.inputValue('#editApiKey'), '');
    await page.click('#saveModelBtn');
    assert.match(await page.textContent('#editStatus'), /实际 API Key/);
    await page.fill('#editApiKey', '$ARK_API_KEY');
    await page.click('#saveModelBtn');
    assert.match(await page.textContent('#editStatus'), /占位符/);
    assert.equal(await page.evaluate(() => saved.activeModelId), 'builtin-default');
    await page.fill('#editApiKey', 'test-only-not-a-key');
    await page.click('#saveModelBtn');
    await page.waitForFunction(() => saved.aiModels.length === 1 && !document.querySelector('#editModelModal').classList.contains('open'));
    const model = await page.evaluate(() => saved.aiModels[0]);
    assert.equal(model.model, deepseek.model);
    assert.equal(await page.inputValue('#activeModelSelect'), model.id);
    assert.equal(await page.evaluate(() => writes.filter(w => w.aiModels && w.activeModelId).length), 1);
    await page.click('#scanBtn');
    await page.waitForFunction(() => sent.some(m => m.action === 'scan'));
    await page.click('#startBtn');
    await page.waitForFunction(() => sent.some(m => m.action === 'start'));
    for (const message of await page.evaluate(() => sent.filter(m => ['scan', 'start'].includes(m.action)))) {
      assert.equal(message.config.model, deepseek.model);
      assert.equal(message.config.baseUrl, deepseek.baseUrl);
      assert.equal(message.config.apiKey, 'test-only-not-a-key');
    }
    assert.equal(await page.locator('#activeModelSelect').isDisabled(), true);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
test('existing configuration remains selected; selecting and cancelling an unconfigured preset does not transfer credentials', async () => {
  const custom = { ...savedModel, id: 'existing', name: '我的原有模型', baseUrl: 'https://other.invalid/v1', model: 'custom-model' };
  const { page } = await setup({ aiModels: [custom], activeModelId: custom.id });
  try {
    assert.equal(await page.inputValue('#activeModelSelect'), custom.id);
    await chooseDeepseek(page);
    assert.equal(await page.inputValue('#editApiKey'), '');
    await page.click('#closeEditBtn');
    assert.equal(await page.evaluate(() => saved.activeModelId), custom.id);
    assert.equal(await page.inputValue('#activeModelSelect'), custom.id);
    assert.equal(await page.evaluate(() => saved.aiModels[0].model), 'custom-model');
  } finally { await page.close(); }
});
test('configured models switch through dropdown and radio without duplicate writes', async () => {
  const { page } = await setup({ aiModels: [savedModel], activeModelId: savedModel.id });
  try {
    assert.equal(await page.locator('option[value="preset:ark-deepseek"]').count(), 0);
    await page.selectOption('#activeModelSelect', 'builtin-default');
    await page.waitForFunction(() => saved.activeModelId === 'builtin-default');
    await page.click('#manageModelsBtn');
    await page.locator('.model-radio[value="saved-deepseek"]').click();
    await page.waitForFunction(() => saved.activeModelId === 'saved-deepseek' && !document.querySelector('#settingsModal').classList.contains('open'));
    assert.equal(await page.evaluate(() => writes.filter(w => w.activeModelId).length), 2);
    assert.equal(await page.inputValue('#activeModelSelect'), savedModel.id);
  } finally { await page.close(); }
});
test('editing an inactive model preserves its ID, the active model and user overrides', async () => {
  const { page } = await setup({ aiModels: [savedModel], activeModelId: 'builtin-default' });
  try {
    await page.click('#manageModelsBtn');
    await page.locator('.edit-model-btn[data-model-id="saved-deepseek"]').click();
    await page.waitForFunction(() => !document.querySelector('#saveModelBtn').disabled);
    assert.equal(await page.inputValue('#editModel'), deepseek.model);
    await page.fill('#editModel', 'user-custom-model');
    assert.equal(await page.inputValue('#modelPreset'), 'custom');
    await page.click('#saveModelBtn');
    await page.waitForFunction(() => saved.aiModels[0].model === 'user-custom-model');
    assert.equal(await page.evaluate(() => saved.aiModels[0].id), savedModel.id);
    assert.equal(await page.evaluate(() => saved.activeModelId), 'builtin-default');
  } finally { await page.close(); }
});
test('switching a form to another service clears its key; switching between Ark presets can retain the typed Ark key', async () => {
  const { page } = await setup();
  try {
    await chooseDeepseek(page);
    await page.fill('#editApiKey', 'test-only-ark-key');
    await page.selectOption('#modelPreset', 'ark-doubao');
    assert.equal(await page.inputValue('#editApiKey'), 'test-only-ark-key');
    assert.match(await page.inputValue('#editBaseUrl'), /\/responses$/);
    await page.fill('#editBaseUrl', 'https://other.invalid/v1');
    await page.fill('#editApiKey', 'test-only-other-key');
    await page.selectOption('#modelPreset', 'ark-deepseek');
    assert.equal(await page.inputValue('#editApiKey'), '');
  } finally { await page.close(); }
});
test('connection test sends native Anthropic and Gemini contracts without page question data', async () => {
  const { page, errors } = await setup();
  try {
    await page.evaluate(() => {
      window.fetchCalls = [];
      window.fetch = async (url, init) => {
        const body = JSON.parse(init.body);
        fetchCalls.push({ url, headers: init.headers, body });
        const isAnthropic = String(url).includes('anthropic.com');
        return {
          ok: true,
          json: async () => isAnthropic
            ? { content: [{ type: 'text', text: '{"ok":true}' }], stop_reason: 'end_turn' }
            : { candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: 'STOP' }] },
        };
      };
    });

    await page.selectOption('#activeModelSelect', 'preset:anthropic');
    await page.fill('#editApiKey', 'test-only-anthropic-key');
    await page.click('#testConnectionBtn');
    await page.waitForFunction(() => document.querySelector('#editStatus').textContent.includes('连接成功'));
    await page.click('#closeEditBtn');

    await page.selectOption('#activeModelSelect', 'preset:google-gemini');
    await page.fill('#editApiKey', 'test-only-gemini-key');
    await page.click('#testConnectionBtn');
    await page.waitForFunction(() => document.querySelector('#editStatus').textContent.includes('连接成功'));

    const calls = await page.evaluate(() => fetchCalls);
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /api\.anthropic\.com\/v1\/messages$/);
    assert.equal(calls[0].headers['x-api-key'], 'test-only-anthropic-key');
    assert.equal(calls[0].body.messages[0].content, 'Reply with exactly {"ok":true}.');
    assert.equal(calls[0].body.system.includes('connectivity'), true);
    assert.match(calls[1].url, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-3\.8-flash:generateContent$/);
    assert.equal(calls[1].headers['x-goog-api-key'], 'test-only-gemini-key');
    assert.equal(calls[1].body.contents[0].parts[0].text.includes('题目'), false);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
test('save and selection failures retain the old model and recover controls', async () => {
  const { page, errors } = await setup({ aiModels: [savedModel], activeModelId: 'builtin-default' });
  try {
    await page.evaluate(() => { failWrites = true; });
    await page.selectOption('#activeModelSelect', savedModel.id);
    await page.waitForFunction(() => !document.querySelector('#activeModelSelect').disabled);
    assert.equal(await page.inputValue('#activeModelSelect'), 'builtin-default');
    await page.selectOption('#activeModelSelect', 'preset:ark-doubao');
    await page.fill('#editApiKey', 'test-only-not-a-key');
    await page.click('#saveModelBtn');
    await page.waitForFunction(() => document.querySelector('#editStatus').textContent.includes('保存失败'));
    assert.equal(await page.locator('#saveModelBtn').isDisabled(), false);
    assert.equal(await page.evaluate(() => saved.aiModels.length), 1);
    assert.equal(await page.evaluate(() => saved.activeModelId), 'builtin-default');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
test('a missing selected model never silently falls back to the built-in proxy', async () => {
  const { page } = await setup({ aiModels: [], activeModelId: 'deleted-model' });
  try {
    assert.equal(await page.inputValue('#activeModelSelect'), '');
    await page.click('#startBtn');
    await page.waitForFunction(() => document.querySelector('#statusText').textContent === '请检查模型配置');
    assert.equal(await page.evaluate(() => sent.filter(m => m.action === 'start').length), 0);
    await page.selectOption('#activeModelSelect', 'builtin-default');
    await page.waitForFunction(() => saved.activeModelId === 'builtin-default');
  } finally { await page.close(); }
});
test('model names are displayed as text and not executed as markup', async () => {
  const { page } = await setup({ aiModels: [{ ...savedModel, name: '<img src=x onerror=alert(1)>' }], activeModelId: savedModel.id });
  try {
    await page.click('#manageModelsBtn');
    await page.waitForFunction(() => document.querySelectorAll('.model-item').length === 2);
    assert.equal(await page.locator('#modelList img').count(), 0);
    assert.match(await page.textContent('#modelList'), /<img/);
  } finally { await page.close(); }
});
test('legacy single-model settings migrate without replacing their endpoint or key', async () => {
  const { page } = await setup({ baseUrl: 'https://old.invalid/v1', apiKey: 'test-only-legacy', model: 'legacy-model' });
  try {
    const model = await page.evaluate(() => saved.aiModels[0]);
    assert.equal(model.baseUrl, 'https://old.invalid/v1');
    assert.equal(model.apiKey, 'test-only-legacy');
    assert.equal(model.model, 'legacy-model');
    assert.equal(await page.inputValue('#activeModelSelect'), model.id);
  } finally { await page.close(); }
});
test('model selector and DeepSeek editor fit the sidepanel', async () => {
  const { page } = await setup({ aiModels: [savedModel], activeModelId: savedModel.id });
  try {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.MODEL_SCREENSHOT) {
      await page.evaluate(() => {
        listeners.forEach(fn => fn({
          type: 'updateStats', questionCount: 12, answeredCount: 8, skippedCount: 1, hasScanned: true,
          scanReport: { strategies: { native: 5, select: 2, text: 3, matrix: 2 }, candidateCount: 0, diagnostics: [] },
        }));
        listeners.forEach(fn => fn({ type: 'log', level: 'success', text: '已完成第 2 批：本批填写 4 题' }));
        listeners.forEach(fn => fn({ type: 'log', level: 'info', text: '智能模式已跳过 1 道图片题，继续补足下一批' }));
      });
    }
    if (process.env.MODEL_SCREENSHOT) await page.screenshot({ path: process.env.MODEL_SCREENSHOT, animations: 'disabled' });
    await page.click('#manageModelsBtn');
    if (process.env.SETTINGS_SCREENSHOT) await page.screenshot({ path: process.env.SETTINGS_SCREENSHOT, animations: 'disabled' });
    await page.locator('.edit-model-btn[data-model-id="saved-deepseek"]').click();
    await page.waitForFunction(() => !document.querySelector('#saveModelBtn').disabled);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.MODEL_EDITOR_SCREENSHOT) await page.screenshot({ path: process.env.MODEL_EDITOR_SCREENSHOT, animations: 'disabled' });
  } finally { await page.close(); }
});
test('all six recognition strategies persist, including explicit opt-out settings', async () => {
  const { page, errors } = await setup({ aiModels: [savedModel], activeModelId: savedModel.id });
  try {
    await page.click('#manageModelsBtn');
    await page.click('#strategiesTab');
    assert.equal(await page.locator('#recognitionStrategies input').count(), 6);
    await page.uncheck('#autoRescan'); await page.uncheck('#aiAssist');
    await page.uncheck('[data-strategy="matrix"]');
    await page.waitForFunction(() => saved.answerSettings?.disabledStrategies.includes('matrix'));
    assert.equal(await page.evaluate(() => saved.answerSettings.autoRescan), false);
    assert.equal(await page.evaluate(() => saved.answerSettings.aiAssist), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator('#recognitionStrategies').scrollIntoViewIfNeeded();
    if (process.env.RECOGNITION_SCREENSHOT) {
      await page.locator('#strategiesPanel').evaluate(element => element.closest('.modal-body').scrollTop = 0);
      await page.screenshot({ path: process.env.RECOGNITION_SCREENSHOT, animations: 'disabled' });
    }
    await page.click('#closeSettingsBtn');
    await page.click('#scanBtn');
    await page.waitForFunction(() => sent.some(m => m.action === 'scan'));
    const settings = await page.evaluate(() => sent.find(m => m.action === 'scan').answerSettings);
    assert.deepEqual(settings.disabledStrategies, ['matrix']);
    assert.equal(settings.autoRescan, false); assert.equal(settings.aiAssist, false);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
test('pending scan disables start and exposes a working cancel action', async () => {
  const { page, errors } = await setup();
  try {
    await page.evaluate(() => {
      const send = chrome.tabs.sendMessage;
      chrome.tabs.sendMessage = (tabId, message, callback) => {
        if (message.action === 'scan') { window.pendingScan = callback; return; }
        if (message.action === 'stop') {
          sent.push(message); pendingScan({ success: true, cancelled: true, count: 8 }); callback({ success: true }); return;
        }
        send(tabId, message, callback);
      };
    });
    await page.click('#scanBtn');
    await page.waitForFunction(() => window.pendingScan);
    assert.equal(await page.locator('#startBtn').isDisabled(), true);
    assert.equal(await page.locator('#activeModelSelect').isDisabled(), true);
    assert.equal(await page.locator('#cancelScanBtn').isVisible(), true);
    await page.click('#cancelScanBtn');
    assert.equal(await page.locator('#cancelScanBtn').isVisible(), false);
    assert.equal(await page.locator('#startBtn').isEnabled(), true);
    assert.equal(await page.locator('#activeModelSelect').isEnabled(), true);
    assert.equal(await page.evaluate(() => sent.filter(m => m.action === 'stop').length), 1);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
