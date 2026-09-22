const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function setup() {
  const listeners = [], requests = [];
  const context = vm.createContext({
    AbortController, crypto: require('node:crypto').webcrypto,
    importScripts: file => assert.equal(file, 'modules/ai-client.js'),
    AIClient: { request: (config, prompt, options) => new Promise((resolve, reject) => {
      requests.push({ config, prompt, options, resolve, reject });
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { code: 'CANCELLED' })));
    }) },
    chrome: {
      runtime: { onInstalled: { addListener() {} }, onMessage: { addListener: fn => listeners.push(fn) } },
      action: { onClicked: { addListener() {} } }, sidePanel: {},
    },
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), context);
  const send = (request, tabId = 1, frameId = 0) => new Promise(resolve => listeners[0](request, { tab: { id: tabId }, frameId }, resolve));
  return { context, requests, send };
}
test('background forwards batch mode and cleans completed request', async () => {
  const { send, requests, context } = setup();
  const result = send({ action: 'callAI', mode: 'batch', requestId: 'a', prompt: 'q', timeoutMs: 12345 });
  assert.equal(requests[0].options.mode, 'batch');
  assert.equal(requests[0].options.timeoutMs, 12345);
  requests[0].resolve('[]');
  assert.equal((await result).data, '[]');
  await new Promise(setImmediate);
  assert.equal(vm.runInContext('pendingRequests.size', context), 0);
});
test('cancellation is scoped by tab and frame, not just request ID', async () => {
  const { send, requests } = setup();
  const result = send({ action: 'callAI', requestId: 'a' }, 1, 0);
  await send({ action: 'cancelAI', requestId: 'a' }, 2, 0);
  await send({ action: 'cancelAI', requestId: 'a' }, 1, 1);
  assert.equal(requests[0].options.signal.aborted, false);
  await send({ action: 'cancelAI', requestId: 'a' }, 1, 0);
  assert.equal((await result).code, 'CANCELLED');
});
test('analysis and fatal provider errors keep their intended mode and metadata', async () => {
  const { send, requests } = setup();
  const result = send({ action: 'analyzeHTML', requestId: 'a' });
  assert.equal(requests[0].options.mode, 'analyze');
  requests[0].reject(Object.assign(new Error('bad key'), { code: 'HTTP', status: 401, fatal: true }));
  const reply = await result;
  assert.equal(reply.fatal, true); assert.equal(reply.status, 401);
});
test('manifest, sidepanel and programmatic injection all load the shared engine first', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
  for (const group of manifest.content_scripts) {
    assert.ok(group.js.indexOf('modules/answer-engine.js') < group.js.indexOf('content.js'));
    assert.ok(group.js.indexOf('modules/question-dom.js') < group.js.indexOf('content.js'));
    group.js.forEach(file => assert.ok(fs.existsSync(path.join(root, file))));
  }
  const popup = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
  assert.ok(popup.indexOf('modules/answer-engine.js') < popup.indexOf('src="popup.js"'));
  assert.ok(popup.indexOf('modules/ai-client.js') < popup.indexOf('src="popup.js"'));
  assert.ok(popup.indexOf('modules/model-presets.js') < popup.indexOf('src="popup.js"'));
  const source = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
  assert.match(source, /files: \[\s*"modules\/answer-engine.js"/);
});
