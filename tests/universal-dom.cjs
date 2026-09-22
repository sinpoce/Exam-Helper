const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
let browser;
before(async () => { browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) }); });
after(async () => { await browser?.close(); });
const radio = (id, text = '请选择合成题的答案') => `<fieldset id="${id}"><legend>${text}</legend><label><input type="radio" name="${id}" value="A">甲</label><label><input type="radio" name="${id}" value="B">乙</label></fieldset>`;
async function setup(html, { template = null, settings = {}, beforeLoad = null } = {}) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  await page.goto('https://fixture.invalid/');
  await page.evaluate(({ template, settings }) => {
    window.messages = []; window.listeners = []; window.pending = []; window.hold = false;
    window.batchCalls = []; window.analysisCalls = []; window.testSettings = settings;
    window.answers = {}; window.aiResponse = { questions: [] };
    window.chrome = { runtime: {
      onMessage: { addListener: fn => listeners.push(fn) },
      sendMessage: (message, callback) => {
        messages.push(message);
        if (message.action === 'callAI') {
          const batch = JSON.parse(message.prompt.split('\n')[1]); batchCalls.push(batch);
          const reply = () => callback({ success: true, data: JSON.stringify({ answers: batch.map(q => ({
            questionIndex: q.questionIndex, type: q.type,
            answer: answers[q.questionIndex] ?? (q.type === 'fill' ? Array.from({ length: q.blanks }, (_, i) => '答案' + i) : q.type === 'multiple' ? ['A', 'B'] : 'B'),
          })) }) });
          if (hold) pending.push(reply); else setTimeout(reply, 1);
        } else if (message.action === 'analyzeHTML') {
          analysisCalls.push(message.prompt);
          callback({ success: true, data: JSON.stringify(typeof aiResponse === 'function' ? aiResponse(message.prompt) : aiResponse) });
        } else callback?.({ success: true });
      },
    } };
    window.templateManager = { init: async () => {}, updateStats: async () => {} };
    window.siteMatcher = { matchTemplate: () => template };
    window.dispatch = message => new Promise(resolve => listeners[0](message, {}, resolve));
  }, { template, settings });
  if (beforeLoad) await beforeLoad(page);
  for (const file of ['modules/answer-engine.js', 'modules/question-dom.js', 'content.js']) await page.addScriptTag({ path: path.join(root, file) });
  const scan = await page.evaluate(() => dispatch({ action: 'scan', config: { baseUrl: 'https://example.invalid', apiKey: 'fake-key', model: 'test' }, answerSettings: testSettings }));
  return { page, scan, errors };
}
const start = page => page.evaluate(() => dispatch({ action: 'start', config: { baseUrl: 'https://example.invalid', apiKey: 'fake-key', model: 'test' }, answerSettings: testSettings }));
const completed = async page => {
  await page.waitForFunction(() => messages.some(m => m.type === 'complete'));
  return page.evaluate(() => messages.filter(m => m.type === 'complete').at(-1));
};

test('unknown fieldset site: no AI analysis and independent native radio groups', async () => {
  const { page, scan, errors } = await setup(radio('a') + radio('b'));
  try {
    assert.equal(scan.count, 2);
    assert.equal(await page.evaluate(() => analysisCalls.length), 0);
    await start(page); const done = await completed(page);
    assert.equal(done.answeredCount, 2);
    assert.equal(await page.locator('#a input:checked').inputValue(), 'B');
    assert.equal(await page.locator('#b input:checked').inputValue(), 'B');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
test('partial site template does not suppress different structures on the same page', async () => {
  const html = '<section id="known"><h3>模板题</h3><label><input type="radio" name="known">甲</label><label><input type="radio" name="known">乙</label></section>' + radio('new');
  const template = { selectors: { questionContainer: '#known', questionTypes: { single: { title: 'h3' } } } };
  const { page, scan } = await setup(html, { template });
  try { assert.equal(scan.count, 2); } finally { await page.close(); }
});
test('native select and multiple select exclude placeholder and disabled options', async () => {
  const html = '<fieldset><legend>选择一个合成选项</legend><select id="one"><option value="">请选择</option><option value="a">甲</option><option value="b">乙</option><option disabled value="c">丙</option></select></fieldset>' +
    '<fieldset><legend>选择多个合成选项</legend><select id="many" multiple><option value="a">甲</option><option value="b">乙</option><option value="c">丙</option></select></fieldset>';
  const { page, scan } = await setup(html);
  try {
    assert.equal(scan.count, 2);
    await start(page); assert.equal((await completed(page)).answeredCount, 2);
    assert.equal(await page.locator('#one').inputValue(), 'b');
    assert.deepEqual(await page.locator('#many option:checked').allTextContents(), ['甲', '乙']);
  } finally { await page.close(); }
});
test('ARIA radio and listbox controls use their explicit state without native inputs', async () => {
  const html = '<div role="radiogroup" aria-label="合成判断题"><div role="radio" aria-checked="false">正确</div><div role="radio" aria-checked="false">错误</div></div>' +
    '<div role="listbox" aria-label="合成多选题" aria-multiselectable="true"><div role="option" aria-selected="false">甲</div><div role="option" aria-selected="false">乙</div></div>';
  const { page, scan } = await setup(html, { beforeLoad: page => page.evaluate(() => {
    document.addEventListener('click', event => {
      const el = event.target;
      if (el.matches('[role=radio]')) { el.parentElement.querySelectorAll('[role=radio]').forEach(r => r.setAttribute('aria-checked', String(r === el))); }
      if (el.matches('[role=option]')) el.setAttribute('aria-selected', String(el.getAttribute('aria-selected') !== 'true'));
    });
  }) });
  try {
    assert.equal(scan.count, 2);
    await start(page); assert.equal((await completed(page)).answeredCount, 2);
    assert.equal(await page.locator('[aria-checked=true]').textContent(), '错误');
    assert.equal(await page.locator('[aria-selected=true]').count(), 2);
  } finally { await page.close(); }
});
test('matrix row and column headings become independent questions and options', async () => {
  const html = '<table><caption>判断每项的合成结论</caption><thead><tr><th>项目</th><th>成立</th><th>不成立</th></tr></thead><tbody>' +
    ['x', 'y'].map(id => `<tr><th>项目${id}</th><td><input type="radio" name="${id}" value="yes"></td><td><input type="radio" name="${id}" value="no"></td></tr>`).join('') + '</tbody></table>';
  const { page, scan } = await setup(html);
  try {
    assert.equal(scan.count, 2);
    await start(page); assert.equal((await completed(page)).answeredCount, 2);
    const batch = await page.evaluate(() => batchCalls[0]);
    assert.match(batch[0].text, /项目x/);
    assert.deepEqual(batch[0].options.map(o => o.text), ['成立', '不成立']);
  } finally { await page.close(); }
});
test('simple contenteditable and number answers use correct input types and events', async () => {
  const html = '<fieldset><legend>合成数字填空</legend><input id="number" type="number" min="1" max="20"></fieldset><fieldset><legend>合成简答</legend><div id="editor" contenteditable="true"></div></fieldset>';
  const { page, scan } = await setup(html);
  try {
    assert.equal(scan.count, 2);
    await page.evaluate(() => { answers = { 0: ['12'], 1: ['合成文字'] }; });
    await start(page); assert.equal((await completed(page)).answeredCount, 2);
    assert.equal(await page.locator('#number').inputValue(), '12');
    assert.equal(await page.locator('#editor').textContent(), '合成文字');
  } finally { await page.close(); }
});
test('open Shadow DOM and same-origin iframe questions are discovered and filled', async () => {
  const { page, scan } = await setup('<div id="host"></div><iframe id="child"></iframe>', { beforeLoad: async page => {
    await page.evaluate(html => {
      document.querySelector('#host').attachShadow({ mode: 'open' }).innerHTML = html;
      const doc = document.querySelector('#child').contentDocument;
      doc.open(); doc.write(html); doc.close();
    }, radio('nested'));
  } });
  try {
    assert.equal(scan.count, 2);
    await start(page); assert.equal((await completed(page)).answeredCount, 2);
    assert.equal(await page.evaluate(() => document.querySelector('#host').shadowRoot.querySelector('input:checked').value), 'B');
    assert.equal(await page.evaluate(() => document.querySelector('#child').contentDocument.querySelector('input:checked').value), 'B');
  } finally { await page.close(); }
});
test('cross-origin iframe is reported and not read or silently counted', async () => {
  const { page, scan } = await setup(radio('main') + '<iframe src="https://other.invalid/questions"></iframe>');
  try {
    assert.equal(scan.count, 1);
    assert.match(scan.scanReport.diagnostics.join(' '), /iframe/);
  } finally { await page.close(); }
});
test('hidden, login and search controls are not sent to AI or filled', async () => {
  const html = radio('safe') + '<div hidden>' + radio('hidden') + '</div>' +
    '<form><fieldset><legend>登录</legend><input type="text" value="private-user"><input type="password" value="secret"></fieldset></form>' +
    '<nav><fieldset><legend>搜索</legend><input type="text" value="private-search"></fieldset></nav>' +
    '<fieldset><legend>个人信息</legend><label>邮箱<input type="text" value="private-email"></label></fieldset>';
  const { page, scan } = await setup(html);
  try {
    assert.equal(scan.count, 1);
    await start(page); await completed(page);
    assert.doesNotMatch(await page.evaluate(() => JSON.stringify(batchCalls) + JSON.stringify(analysisCalls)), /private|secret/);
    assert.equal(await page.locator('input[type=password]').inputValue(), 'secret');
  } finally { await page.close(); }
});
test('added question before the next batch is filled once; same-text questions are not deduplicated', async () => {
  const { page, scan } = await setup(radio('first'), { settings: { batchSize: 1 } });
  try {
    assert.equal(scan.count, 1);
    await page.evaluate(() => { hold = true; });
    await start(page); await page.waitForFunction(() => pending.length === 1);
    await page.evaluate(html => { document.body.insertAdjacentHTML('beforeend', html); hold = false; pending[0](); }, radio('second'));
    assert.equal((await completed(page)).answeredCount, 2);
    assert.equal(await page.evaluate(() => batchCalls.length), 2);
  } finally { await page.close(); }
});
test('idle mutations update discovery without an AI request or automatic answering', async () => {
  const { page } = await setup(radio('one'));
  try {
    await page.evaluate(html => document.body.insertAdjacentHTML('beforeend', html), radio('two'));
    await page.waitForFunction(() => messages.some(m => m.type === 'updateStats' && m.questionCount === 2));
    assert.equal(await page.evaluate(() => batchCalls.length + analysisCalls.length), 0);
    assert.equal(await page.locator('input:checked').count(), 0);
  } finally { await page.close(); }
});
test('changed option text during a request blocks the old response', async () => {
  const { page } = await setup(radio('first'));
  try {
    await page.evaluate(() => { hold = true; });
    await start(page); await page.waitForFunction(() => pending.length === 1);
    await page.evaluate(() => { document.querySelector('label').lastChild.textContent = '全新选项'; pending[0](); });
    const result = await completed(page);
    assert.equal(result.answeredCount, 0); assert.equal(result.skippedCount, 1);
    assert.equal(await page.locator('input:checked').count(), 0);
  } finally { await page.close(); }
});
test('replaced controls cannot be rebound by their repeated name or value', async () => {
  const { page } = await setup(radio('first'), { settings: { autoRescan: false } });
  try {
    await page.evaluate(() => { hold = true; });
    await start(page); await page.waitForFunction(() => pending.length === 1);
    await page.evaluate(html => { document.body.innerHTML = html; pending[0](); }, radio('first', '全新的题目'));
    const result = await completed(page);
    assert.equal(result.answeredCount, 0);
    assert.equal(await page.locator('input:checked').count(), 0);
  } finally { await page.close(); }
});
test('route navigation cancels in-flight answering and clears stale questions', async () => {
  const { page } = await setup(radio('first'));
  try {
    await page.evaluate(() => { hold = true; });
    await start(page); await page.waitForFunction(() => pending.length === 1);
    await page.evaluate(() => { location.hash = 'next-paper'; });
    await page.waitForFunction(() => messages.some(m => m.action === 'cancelAI'));
    await page.evaluate(() => pending[0]());
    assert.equal((await completed(page)).reason, 'stopped');
    assert.equal((await page.evaluate(() => dispatch({ action: 'getStatus' }))).questionCount, 0);
    assert.equal(await page.locator('input:checked').count(), 0);
  } finally { await page.close(); }
});
test('malicious or ambiguous AI selectors cannot be bound across questions', async () => {
  const { page } = await setup(radio('first') + radio('second'));
  try {
    const result = await page.evaluate(() => {
      const scanner = new QuestionDOM.Scanner();
      const scan = scanner.scan();
      const candidates = scan.questions.map(q => scanner.candidate(q));
      return scanner.acceptAI(JSON.stringify({ questions: candidates.map(c => ({
        candidateId: c.candidateId, type: 'single', text: c.question.text,
        options: [{ selector: 'input[value="A"]' }, { selector: 'input[value="B"]' }],
        controlIds: ['invented', 'invented2'],
      })) }), candidates).length;
    });
    assert.equal(result, 0);
    assert.equal(await page.locator('input:checked').count(), 0);
  } finally { await page.close(); }
});
test('AI candidate validation rejects duplicate IDs and foreign control IDs', async () => {
  const { page } = await setup(radio('first') + radio('second'));
  try {
    const accepted = await page.evaluate(() => {
      const scanner = new QuestionDOM.Scanner();
      const qs = scanner.scan().questions;
      const records = qs.map(q => scanner.candidate(q));
      const item = i => ({ candidateId: records[i].candidateId, type: qs[i].type, text: qs[i].text, controlIds: qs[i].controls.map(c => scanner.id(c)) });
      const a = scanner.acceptAI(JSON.stringify({ questions: [item(0), item(0)] }), records).length;
      const b = scanner.acceptAI(JSON.stringify({ questions: [{ ...item(0), controlIds: item(1).controlIds }] }), records).length;
      const c = scanner.acceptAI(JSON.stringify({ questions: [item(0), item(1)] }), records).length;
      return [a, b, c];
    });
    assert.deepEqual(accepted, [0, 0, 2]);
  } finally { await page.close(); }
});
test('radio name shared across separate question boundaries is rejected before clicking', async () => {
  const { page } = await setup((radio('first') + radio('second')).replaceAll('name="second"', 'name="first"'));
  try {
    await start(page); const done = await completed(page);
    assert.equal(done.answeredCount, 0); assert.equal(done.skippedCount, 2);
    assert.equal(await page.locator('input:checked').count(), 0);
    assert.equal(await page.evaluate(() => batchCalls.length), 0);
  } finally { await page.close(); }
});
test('unverifiable custom controls and drag/ordering widgets are never blindly clicked', async () => {
  const html = '<fieldset><legend>自定义题</legend><div role="radio">甲</div><div role="radio">乙</div></fieldset><div class="question"><h3>排序题</h3><div draggable="true">项目</div></div>';
  const { page, scan } = await setup(html);
  try {
    assert.match(scan.scanReport.diagnostics.join(' '), /排序/);
    await start(page); const done = await completed(page);
    assert.equal(done.answeredCount, 0); assert.equal(done.skippedCount, 1);
  } finally { await page.close(); }
});
test('late framework state updates are verified, not marked complete immediately', async () => {
  const html = '<div role="radiogroup" aria-label="异步题"><div role="radio" aria-checked="false">甲</div><div role="radio" aria-checked="false">乙</div></div>';
  const { page } = await setup(html, { beforeLoad: page => page.evaluate(() => {
    document.addEventListener('click', e => setTimeout(() => e.target.setAttribute('aria-checked', 'true'), 120));
  }) });
  try { await start(page); assert.equal((await completed(page)).answeredCount, 1); } finally { await page.close(); }
});
test('disabled strategies never re-enter through AI fallback', async () => {
  const { page, scan } = await setup(radio('first'), { settings: { disabledStrategies: ['native'] } });
  try {
    assert.equal(scan.count, 0);
    assert.equal(await page.evaluate(() => analysisCalls.length), 0);
  } finally { await page.close(); }
});
test('long question stems are not silently truncated to 1000 characters', async () => {
  const text = '合成题干'.repeat(300) + '关键末尾';
  const { page } = await setup(radio('long', text));
  try {
    await start(page); await completed(page);
    assert.match(await page.evaluate(() => batchCalls[0][0].text), /关键末尾$/);
  } finally { await page.close(); }
});

const mixedGroups = '<fieldset><legend>合成公共题干</legend><label><input type="radio" name="a">甲</label><label><input type="radio" name="a">乙</label><label><input type="radio" name="b">丙</label><label><input type="radio" name="b">丁</label></fieldset>';
test('AI-assisted candidates survive queue refresh and fill only their registered controls', async () => {
  const { page, scan } = await setup(mixedGroups, { beforeLoad: page => page.evaluate(() => {
    aiResponse = prompt => ({ questions: JSON.parse(prompt.split('\n')[1]).map(c => ({
      candidateId: c.candidateId, type: c.type, text: c.text, controlIds: c.controls.map(c => c.controlId),
    })) });
  }) });
  try {
    assert.equal(scan.count, 2); assert.equal(scan.scanReport.candidateCount, 0);
    assert.equal(scan.scanReport.strategies['ai-assisted'], 2);
    await start(page); const done = await completed(page);
    assert.equal(done.answeredCount, 2);
    assert.equal(await page.locator('input:checked').count(), 2);
    assert.equal(await page.evaluate(() => analysisCalls.length), 1);
    const disabledScan = await page.evaluate(() => dispatch({ action: 'scan', answerSettings: { disabledStrategies: ['native'] } }));
    assert.equal(disabledScan.count, 0);
    assert.equal(await page.evaluate(() => analysisCalls.length), 1);
  } finally { await page.close(); }
});
test('invalid AI analysis does not discard independently recognized native questions', async () => {
  const { page, scan } = await setup(radio('known') + mixedGroups, { beforeLoad: page => page.evaluate(() => {
    aiResponse = { questions: [{ candidateId: 'fabricated', controlIds: ['fabricated'] }] };
  }) });
  try {
    assert.equal(scan.count, 1); assert.equal(scan.scanReport.candidateCount, 2);
    await start(page); const done = await completed(page);
    assert.equal(done.answeredCount, 1); assert.equal(done.candidateCount, 2);
  } finally { await page.close(); }
});
test('cancelled AI scan retains local questions and ignores its late response', async () => {
  const { page } = await setup(radio('known') + mixedGroups);
  try {
    await page.evaluate(() => {
      const original = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = (message, callback) => {
        if (message.action === 'analyzeHTML') { window.analysisReply = callback; return; }
        original(message, callback);
      };
      window.scanResult = null;
      dispatch({ action: 'scan', answerSettings: testSettings }).then(result => { scanResult = result; });
    });
    await page.waitForFunction(() => window.analysisReply);
    await page.evaluate(() => dispatch({ action: 'stop' }));
    await page.waitForFunction(() => window.scanResult);
    const result = await page.evaluate(() => scanResult);
    assert.equal(result.cancelled, true); assert.equal(result.count, 1);
    await page.evaluate(() => analysisReply({ success: true, data: '{"questions":[]}' }));
    assert.equal((await page.evaluate(() => dispatch({ action: 'getStatus' }))).isScanning, false);
    await start(page); assert.equal((await completed(page)).answeredCount, 1);
  } finally { await page.close(); }
});
test('explicit shared reading material is included and revalidated before writing', async () => {
  const html = '<section class="question-group"><div class="passage">公共材料：甲和乙是合成角色。</div>' + radio('reading', '依据材料选择角色') + '</section>';
  const { page } = await setup(html);
  try {
    await page.evaluate(() => { hold = true; }); await start(page);
    await page.waitForFunction(() => pending.length === 1);
    assert.match(await page.evaluate(() => batchCalls[0][0].text), /甲和乙是合成角色/);
    await page.evaluate(() => { document.querySelector('.passage').textContent = '材料已替换'; pending.shift()(); });
    assert.equal((await completed(page)).answeredCount, 0);
    assert.equal(await page.locator('input:checked').count(), 0);
  } finally { await page.close(); }
});
test('image in shared material is skipped without model calls', async () => {
  const html = '<div class="question-group"><div class="passage"><img src="data:image/png;base64,AA==">图片材料</div>' + radio('image') + '</div>';
  const { page } = await setup(html);
  try {
    await start(page); assert.equal((await completed(page)).skippedCount, 1);
    assert.equal(await page.evaluate(() => batchCalls.length), 0);
  } finally { await page.close(); }
});
test('user-edited previous answer is no longer counted as completed', async () => {
  const { page } = await setup(radio('editable'));
  try {
    await start(page); assert.equal((await completed(page)).answeredCount, 1);
    await page.locator('input[value="A"]').check();
    await page.waitForFunction(() => messages.filter(m => m.type === 'updateStats').at(-1)?.answeredCount === 0);
    const status = await page.evaluate(() => dispatch({ action: 'getStatus' }));
    assert.equal(status.answeredCount, 0); assert.equal(status.lastCompletion, null);
    await page.evaluate(() => { messages.length = 0; });
    await start(page); assert.equal((await completed(page)).answeredCount, 1);
    assert.equal(await page.locator('input:checked').inputValue(), 'B');
  } finally { await page.close(); }
});
test('pushState cancels old-page work even without a DOM mutation', async () => {
  const { page } = await setup(radio('route'));
  try {
    await page.evaluate(() => { hold = true; }); await start(page);
    await page.waitForFunction(() => pending.length === 1);
    await page.evaluate(() => history.pushState({}, '', '/new-question'));
    await page.waitForFunction(() => messages.some(m => m.action === 'cancelAI'));
    await page.evaluate(() => pending.shift()());
    assert.equal(await page.locator('input:checked').count(), 0);
    const status = await page.evaluate(() => dispatch({ action: 'getStatus' }));
    assert.equal(status.hasScanned, false); assert.equal(status.questionCount, 0);
  } finally { await page.close(); }
});
test('hidden answer material and prefilled values are not sent in AI candidate payloads', async () => {
  const html = mixedGroups.replace('</fieldset>', '<div hidden>HIDDEN_SECRET</div><div data-answer>ANSWER_SECRET</div><input type="text" value="TYPED_SECRET"></fieldset>');
  const { page } = await setup(html);
  try {
    const payload = await page.evaluate(() => analysisCalls.join(''));
    assert.ok(payload.length > 0);
    assert.doesNotMatch(payload, /HIDDEN_SECRET|ANSWER_SECRET|TYPED_SECRET/);
  } finally { await page.close(); }
});
test('semantic inference can be disabled independently from native semantic markup', async () => {
  const inferred = '<div><h3>推断题</h3><label><input type="radio" name="heuristic">甲</label><label><input type="radio" name="heuristic">乙</label></div>';
  const { page, scan } = await setup(radio('explicit') + inferred, { settings: { disabledStrategies: ['semantic'] } });
  try { assert.equal(scan.count, 1); } finally { await page.close(); }
});
test('a newly inserted checkbox invalidates the whole old multi-choice answer', async () => {
  const { page } = await setup(radio('multiple').replaceAll('type="radio"', 'type="checkbox"'));
  try {
    await page.evaluate(() => { hold = true; }); await start(page);
    await page.waitForFunction(() => pending.length === 1);
    await page.evaluate(() => {
      document.querySelector('fieldset').insertAdjacentHTML('beforeend', '<label><input type="checkbox">新增选项</label>');
      pending.shift()();
    });
    const done = await completed(page);
    assert.equal(done.answeredCount, 0); assert.equal(done.skippedCount, 1);
    assert.equal(await page.locator('input:checked').count(), 0);
    assert.equal(await page.evaluate(() => batchCalls.length), 1);
  } finally { await page.close(); }
});
test('framework recreation of the same question cannot cause a repeated paid-request loop', async () => {
  const { page } = await setup(radio('replace'));
  try {
    await page.evaluate(() => { hold = true; }); await start(page);
    await page.waitForFunction(() => pending.length === 1);
    await page.evaluate(() => {
      const old = document.querySelector('fieldset'); old.replaceWith(old.cloneNode(true));
      pending.shift()();
    });
    assert.equal((await completed(page)).answeredCount, 0);
    assert.equal(await page.evaluate(() => batchCalls.length), 1);
    assert.match((await page.evaluate(() => dispatch({ action: 'getStatus' }))).scanReport.diagnostics.join(' '), /重新创建/);
  } finally { await page.close(); }
});
test('existing WJX template still reads labels and clicks CSS-hidden native inputs', async () => {
  const template = JSON.parse(fs.readFileSync(path.join(root, 'templates/wjx.json'), 'utf8'));
  const html = '<div class="field ui-field-contain" topic="1" type="3"><div class="topichtml">合成模板题</div><div class="ui-controlgroup">' +
    '<div class="ui-radio"><input style="display:none" type="radio" name="wjx" value="A"><div class="label">A. 甲</div></div>' +
    '<div class="ui-radio"><input style="display:none" type="radio" name="wjx" value="B"><div class="label">B. 乙</div></div></div></div>';
  const { page, scan } = await setup(html, { template });
  try {
    assert.equal(scan.count, 1); await start(page);
    assert.equal((await completed(page)).answeredCount, 1);
    assert.deepEqual(await page.evaluate(() => batchCalls[0][0].options.map(o => o.text)), ['甲', '乙']);
    assert.equal(await page.locator('input:checked').inputValue(), 'B');
  } finally { await page.close(); }
});
test('questions inside a layout table retain their own boundaries, not matrix rows', async () => {
  const { page, scan } = await setup('<table><tr><td>' + radio('left', '左侧完整题') + '</td><td>' + radio('right', '右侧完整题') + '</td></tr></table>');
  try {
    assert.equal(scan.count, 2); assert.equal(scan.scanReport.strategies.native, 2);
    await start(page); assert.equal((await completed(page)).answeredCount, 2);
    assert.deepEqual(await page.evaluate(() => batchCalls[0].map(q => q.text)), ['左侧完整题', '右侧完整题']);
  } finally { await page.close(); }
});
test('an unnamed radiogroup uses its exclusive outer question stem', async () => {
  const html = '<div class="question"><h3>外层完整题干</h3><div role="radiogroup"><label><input type="radio" name="nested">甲</label><label><input type="radio" name="nested">乙</label></div></div>';
  const { page, scan } = await setup(html);
  try {
    assert.equal(scan.count, 1); await start(page);
    assert.equal((await completed(page)).answeredCount, 1);
    assert.equal(await page.evaluate(() => batchCalls[0][0].text), '外层完整题干');
  } finally { await page.close(); }
});
test('over-limit stems never enter AI fallback as silently truncated questions', async () => {
  const { page, scan } = await setup(radio('too-long', '题'.repeat(12001)));
  try {
    assert.equal(scan.count, 0); assert.equal(scan.scanReport.candidateCount, 0);
    assert.equal(await page.evaluate(() => analysisCalls.length), 0);
    assert.match(scan.scanReport.diagnostics.join(' '), /未截断/);
  } finally { await page.close(); }
});
