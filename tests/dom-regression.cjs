// Offline Chromium tests. All pages and AI responses are synthetic.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const template = require('../templates/jnlab.json');
let browser;
before(async () => { browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) }); });
after(async () => { await browser?.close(); });
const image = '<img src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E">';
function question(index, { media = false, optionMedia = false, multiple = false, judgment = false } = {}) {
  const cls = multiple ? 'el-checkbox' : 'el-radio';
  const type = multiple ? 'checkbox' : 'radio';
  const labels = judgment ? ['正确', '错误'] : ['A、甲', 'B、乙', 'C、丙'];
  return `<div class="el-form-item" id="anchor${index}"><div class="el-form-item__content"><div>合成题 ${index}${media ? image : ''}</div><div>${labels.map((text, i) =>
    `<label class="${cls}"><input type="${type}" value="${judgment ? i === 0 ? 'true' : 'false' : String.fromCharCode(65 + i)}" ${multiple && i === 1 ? 'checked' : ''}><span class="${cls}__label">${text}${optionMedia && i === 0 ? image : ''}</span></label>`).join('')}</div></div></div>`;
}
function fixture() {
  return '<form class="el-form examForm">' + [
    question(0), question(1, { media: true }), question(2), question(3, { multiple: true }),
    question(4, { optionMedia: true }), question(5, { judgment: true }), question(6), question(7),
  ].join('') + '</form>';
}
async function setup(html = fixture(), customTemplate = template) {
  const page = await browser.newPage();
  // Never contact a real site or API.
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  await page.goto('https://fixture.invalid/');
  await page.evaluate(template => {
    window.messages = []; window.requests = []; window.pending = []; window.listeners = [];
    window.hold = false; window.omit = []; window.ready = false;
    window.chrome = { runtime: {
      onMessage: { addListener: fn => listeners.push(fn) },
      sendMessage: (request, callback) => {
        messages.push(request);
        if (request.action === 'callAI') {
          const batch = JSON.parse(request.prompt.split('\n')[1]);
          requests.push(batch);
          const reply = (letter = 'A') => callback({ success: true, data: JSON.stringify({
            answers: batch.filter(q => !omit.includes(q.questionIndex)).reverse().map(q => ({
              questionIndex: q.questionIndex, type: q.type,
              answer: q.type === 'multiple' ? ['A', 'C'] : q.type === 'fill' ? Array.from({ length: q.blanks }, (_, i) => '空' + (i + 1)) : letter,
            })),
          }) });
          if (hold) pending.push(reply); else setTimeout(reply, 1);
        } else callback?.({ success: true });
      },
    } };
    window.templateManager = { init: async () => { await new Promise(r => setTimeout(r, 20)); ready = true; }, updateStats: async () => {} };
    window.siteMatcher = { matchTemplate: () => ready ? template : null };
    window.dispatch = message => new Promise(resolve => listeners[0](message, {}, resolve));
    // Element UI radios have no name; emulate its reactive group update.
    document.addEventListener('change', event => {
      if (event.target.matches('input[type=radio]')) {
        event.target.closest('.el-form-item').querySelectorAll('input[type=radio]').forEach(input => {
          if (input !== event.target) input.checked = false;
        });
      }
    });
  }, customTemplate);
  for (const file of ['modules/answer-engine.js', 'modules/question-dom.js', 'modules/scanner-enhanced.js', 'content.js']) {
    await page.addScriptTag({ path: path.join(root, file) });
  }
  const scan = await page.evaluate(() => dispatch({ action: 'scan', config: { baseUrl: 'https://example.invalid', model: 'test', apiKey: 'not-a-real-key' } }));
  assert.equal(scan.success, true);
  return page;
}
const start = page => page.evaluate(() => dispatch({
  action: 'start', config: { baseUrl: 'https://example.invalid', model: 'test', apiKey: 'not-a-real-key' },
  answerSettings: { parallelSearchEnabled: true, batchSize: 5, smartMode: true },
}));
const complete = page => page.waitForFunction(() => messages.some(m => m.type === 'complete' && m.reason !== 'stopped'));

test('jnlab-like DOM: image skipping, full batch refill, reversed IDs and exact checkbox state', async () => {
  const page = await setup();
  try {
    await start(page); await complete(page);
    const result = await page.evaluate(() => ({
      batches: requests.map(b => b.map(q => q.questionIndex)),
      complete: messages.find(m => m.type === 'complete'),
      checked: [...document.querySelectorAll('#anchor3 input:checked')].map(i => i.value),
      ignored: document.querySelectorAll('#anchor1 input:checked,#anchor4 input:checked').length,
      judgment: document.querySelector('#anchor5 input:checked')?.value,
    }));
    assert.deepEqual(result.batches, [[0, 2, 3, 5, 6], [7]]);
    assert.equal(result.complete.answeredCount, 6);
    assert.equal(result.complete.skippedCount, 2);
    assert.deepEqual(result.checked, ['A', 'C']);
    assert.equal(result.ignored, 0);
    assert.equal(result.judgment, 'true');
  } finally { await page.close(); }
});
test('missing response skips one item without filling a neighbor or adding requests', async () => {
  const page = await setup();
  try {
    await page.evaluate(() => { omit = [2]; });
    await start(page); await complete(page);
    const result = await page.evaluate(() => ({
      count: requests.length, missing: document.querySelectorAll('#anchor2 input:checked').length,
      complete: messages.find(m => m.type === 'complete'),
    }));
    assert.equal(result.count, 2);
    assert.equal(result.missing, 0);
    assert.equal(result.complete.answeredCount, 5);
    assert.equal(result.complete.skippedCount, 3);
  } finally { await page.close(); }
});
test('pause then restart: old reply cannot fill or finish the new run', async () => {
  const page = await setup('<form class="el-form examForm">' + question(0) + '</form>');
  try {
    await page.evaluate(() => { hold = true; });
    await start(page);
    await page.waitForFunction(() => pending.length === 1);
    await page.evaluate(() => dispatch({ action: 'stop' }));
    await start(page);
    await page.waitForFunction(() => pending.length === 2);
    await page.evaluate(() => pending[0]('B'));
    assert.equal(await page.locator('input:checked').count(), 0);
    await page.evaluate(() => pending[1]('A'));
    await complete(page);
    assert.equal(await page.locator('input:checked').getAttribute('value'), 'A');
    assert.deepEqual(await page.evaluate(() => messages.filter(m => m.type === 'complete').map(m => m.reason)), ['stopped', 'finished']);
    assert.equal(await page.evaluate(() => messages.filter(m => m.action === 'cancelAI').length), 1);
  } finally { await page.close(); }
});
test('DOM changes during request do not produce a false completed count', async () => {
  const page = await setup('<form class="el-form examForm">' + question(0) + '</form>');
  try {
    await page.evaluate(() => { hold = true; });
    await start(page); await page.waitForFunction(() => pending.length === 1);
    await page.evaluate(() => { document.querySelector('#anchor0').remove(); pending[0](); });
    await complete(page);
    const result = await page.evaluate(() => messages.find(m => m.type === 'complete'));
    assert.equal(result.answeredCount, 0); assert.equal(result.skippedCount, 1);
  } finally { await page.close(); }
});
test('each blank is filled separately and input events reach the page', async () => {
  const html = '<div class="fill-question"><h3>合成填空题</h3><input type="text"><textarea></textarea></div>';
  const fillTemplate = { siteId: 'test', siteName: 'test', selectors: {
    questionContainer: '.fill-question', questionTypes: { fill: {
      container: '.fill-question', title: 'h3', inputs: 'input,textarea',
    } },
  } };
  const page = await setup(html, fillTemplate);
  try {
    await page.evaluate(() => { window.edits = 0; document.addEventListener('input', () => edits++); });
    await start(page); await complete(page);
    assert.equal(await page.locator('input').inputValue(), '空1');
    assert.equal(await page.locator('textarea').inputValue(), '空2');
    assert.equal(await page.evaluate(() => edits), 2);
  } finally { await page.close(); }
});

test('settings UI persists batch size, smart mode, timeout and displays truthful completion', async () => {
  const page = await browser.newPage({ viewport: { width: 420, height: 850 } });
  try {
    const allowed = new Set(['popup.html', 'popup.css', 'popup.js', 'modules/answer-engine.js', 'modules/question-dom.js', 'modules/ai-client.js', 'modules/model-presets.js']);
    await page.route('**/*', route => {
      const file = new URL(route.request().url()).pathname.slice(1);
      if (!allowed.has(file)) return route.abort();
      return route.fulfill({ contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript', body: fs.readFileSync(path.join(root, file)) });
    });
    await page.addInitScript(() => {
      window.saved = { aiModels: [], answerSettings: { parallelSearchEnabled: true, batchSize: 7 } };
      window.listeners = [];
      window.chrome = {
        storage: { sync: { get: async () => saved, set: async value => Object.assign(saved, value) } },
        tabs: { query: async () => [{ id: 1 }], sendMessage: (_, message, callback) => callback?.({ questionCount: 8, answeredCount: 0 }) },
        runtime: { onMessage: { addListener: fn => listeners.push(fn) } },
      };
    });
    await page.goto('https://fixture.invalid/popup.html');
    await page.locator('#openSettingsBtn').click();
    await page.locator('#strategiesTab').click();
    assert.equal(await page.locator('#parallelBatchSize').inputValue(), '7');
    assert.equal(await page.locator('#smartMode').isChecked(), true);
    await page.locator('#parallelBatchSize').fill('10');
    await page.locator('#parallelBatchSize').press('Tab');
    await page.locator('#requestTimeoutSeconds').fill('60');
    await page.locator('#requestTimeoutSeconds').press('Tab');
    await page.waitForFunction(() => saved.answerSettings.requestTimeoutSeconds === 60);
    assert.equal(await page.evaluate(() => saved.answerSettings.batchSize), 10);
    await page.locator('#smartMode').uncheck();
    assert.equal(await page.evaluate(() => saved.answerSettings.smartMode), false);
    await page.locator('#parallelSearchEnabled').uncheck();
    assert.equal(await page.locator('#batchSizeRow').isVisible(), false);
    // Keep a local screenshot only when the caller requests a QA output path.
    if (process.env.SETTINGS_SCREENSHOT) await page.screenshot({ path: process.env.SETTINGS_SCREENSHOT });
    await page.locator('#closeSettingsBtn').click();
    await page.evaluate(() => {
      listeners.forEach(fn => fn({ type: 'complete', reason: 'finished', answeredCount: 6, skippedCount: 2, remainingCount: 0 }));
      listeners.forEach(fn => fn({ type: 'log', level: 'warning', text: '<img src=x onerror=alert(1)>' }));
    });
    assert.equal(await page.locator('#skippedCount').textContent(), '2');
    assert.match(await page.locator('#statusText').textContent(), /有题待处理/);
    assert.equal(await page.locator('#logContent img').count(), 0);
  } finally { await page.close(); }
});
