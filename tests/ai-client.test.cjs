const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const client = require('../modules/ai-client.js');
const modelPresets = require('../modules/model-presets.js');
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });
const config = { baseUrl: 'https://example.invalid/api/v3/responses', apiKey: 'test-only-not-a-key', model: 'test-model' };
const output = { output: [{ type: 'message', content: [{ type: 'output_text', text: '{"answers":[]}' }] }] };

test('Responses and Chat endpoints retain configured paths', () => {
  assert.deepEqual(client.resolveEndpoint(config.baseUrl + '/'), { url: config.baseUrl, kind: 'responses' });
  assert.equal(client.resolveEndpoint('https://example.invalid/api/v3').url, 'https://example.invalid/api/v3/chat/completions');
});
test('batch request uses batch system contract, exactly one fetch', async () => {
  let calls = 0;
  global.fetch = async (url, init) => {
    calls++;
    const body = JSON.parse(init.body);
    assert.equal(url, config.baseUrl);
    assert.match(body.input[0].content, /answers/);
    assert.match(body.input[0].content, /questionIndex/);
    assert.equal(body.input[1].content, 'three questions');
    return { ok: true, json: async () => output };
  };
  assert.equal(await client.request(config, 'three questions', { mode: 'batch' }), '{"answers":[]}');
  assert.equal(calls, 1);
});
test('Chat API uses same batch contract and parses returned text', async () => {
  global.fetch = async (_, init) => {
    assert.match(JSON.parse(init.body).messages[0].content, /answers/);
    return { ok: true, json: async () => ({ choices: [{ message: { content: '[]' } }] }) };
  };
  assert.equal(await client.request({ ...config, baseUrl: 'https://example.invalid/v1' }, 'q', { mode: 'batch' }), '[]');
});
test('timeout aborts a hung fetch', async () => {
  let signal;
  global.fetch = async (_, init) => { signal = init.signal; return new Promise(() => {}); };
  await assert.rejects(client.request(config, 'q', { timeoutMs: 15 }), { code: 'TIMEOUT' });
  assert.equal(signal.aborted, true);
});
test('timeout also bounds reading a hung response body', async () => {
  global.fetch = async () => ({ ok: true, json: () => new Promise(() => {}) });
  await assert.rejects(client.request(config, 'q', { timeoutMs: 15 }), { code: 'TIMEOUT' });
});
test('explicit cancellation aborts without waiting for timeout', async () => {
  global.fetch = async () => new Promise(() => {});
  const controller = new AbortController();
  const pending = client.request(config, 'q', { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { code: 'CANCELLED' });
});
test('an already cancelled request never calls fetch', async () => {
  global.fetch = () => assert.fail('must not call network');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(client.request(config, 'q', { signal: controller.signal }), { code: 'CANCELLED' });
});
test('fatal HTTP status propagates without retry or response-body logging', async () => {
  for (const status of [400, 401, 403, 404, 429]) {
    global.fetch = async () => ({ ok: false, status });
    await assert.rejects(client.request(config, 'q'), { status, fatal: true, code: 'HTTP' });
  }
});
test('server error is nonfatal so queue can apply bounded recovery', async () => {
  global.fetch = async () => ({ ok: false, status: 503 });
  await assert.rejects(client.request(config, 'q'), { status: 503, fatal: false });
});
test('invalid config fails before fetching', async () => {
  global.fetch = () => assert.fail('must not call network');
  await assert.rejects(client.request({}, 'q'), { code: 'CONFIG', fatal: true });
});
test('reasoning output is never treated as final answer', () => {
  assert.equal(client.extractModelText({ output: [{ type: 'reasoning', content: [{ type: 'text', text: 'private reasoning' }] }, ...output.output] }), '{"answers":[]}');
  assert.throws(() => client.extractModelText({ output: [{ type: 'reasoning', content: [] }] }));
});
test('DeepSeek preset sends the user-provided Ark chat endpoint, model ID and Bearer header', async () => {
  const preset = modelPresets.presets.find(p => p.id === 'ark-deepseek');
  assert.equal(preset.model, 'deepseek-v4-flash-ga-260731');
  assert.equal(preset.baseUrl, 'https://ark.cn-beijing.volces.com/api/v3/chat/completions');
  assert.equal(preset.apiKey, undefined);
  let calls = 0;
  global.fetch = async (url, init) => {
    calls++;
    assert.equal(url, preset.baseUrl);
    assert.equal(init.headers.Authorization, 'Bearer test-only-not-a-key');
    assert.equal(init.headers['Content-Type'], 'application/json');
    const body = JSON.parse(init.body);
    assert.deepEqual(Object.keys(body).sort(), ['messages', 'model']);
    assert.equal(body.model, preset.model);
    assert.deepEqual(body.messages.map(m => m.role), ['system', 'user']);
    assert.match(body.messages[0].content, /answers/);
    return { ok: true, json: async () => ({ choices: [{ message: {
      reasoning_content: 'must not use reasoning as the answer',
      content: '{"answers":[{"questionIndex":2,"type":"single","answer":"A"}]}',
    } }] }) };
  };
  const text = await client.request({ ...preset, apiKey: 'test-only-not-a-key' }, 'synthetic batch', { mode: 'batch' });
  assert.equal(JSON.parse(text).answers[0].questionIndex, 2);
  assert.equal(calls, 1);
});
test('preset selection does not turn an arbitrary custom model into DeepSeek', () => {
  const preset = modelPresets.presets.find(p => p.id === 'ark-deepseek');
  assert.equal(modelPresets.findPreset({ ...preset, baseUrl: preset.baseUrl + '/' }).id, 'ark-deepseek');
  assert.equal(modelPresets.findPreset({ ...preset, model: 'my-other-model' }), undefined);
  assert.equal(modelPresets.sameOrigin(preset.baseUrl, 'https://unrelated.example/v1'), false);
  assert.equal(modelPresets.sameOrigin(preset.baseUrl, 'https://ark.cn-beijing.volces.com/api/v3/responses'), true);
});
test('mainstream provider presets expose explicit protocol contracts without bundled credentials', () => {
  const ids = new Set(modelPresets.presets.map(p => p.id));
  for (const id of ['openai-responses', 'deepseek-official', 'anthropic', 'google-gemini', 'qwen', 'moonshot', 'zhipu', 'siliconflow', 'openrouter', 'ollama', 'lm-studio']) {
    assert.equal(ids.has(id), true, `missing ${id}`);
  }
  assert.equal(modelPresets.presets.some(p => p.apiKey), false);
  assert.equal(modelPresets.presets.every(p => ['chat', 'responses', 'anthropic', 'gemini'].includes(p.apiType)), true);
});
test('Anthropic Messages uses provider headers, top-level system and safe output limit', () => {
  const request = client.buildRequest({
    baseUrl: 'https://api.anthropic.com/v1/messages', apiType: 'anthropic', apiKey: 'test-key', model: 'claude-sonnet-4-6',
  }, 'q', 'batch');
  assert.equal(request.kind, 'anthropic');
  assert.equal(request.headers['x-api-key'], 'test-key');
  assert.equal(request.headers.Authorization, undefined);
  assert.equal(request.headers['anthropic-version'], '2023-06-01');
  assert.match(request.body.system, /answers/);
  assert.deepEqual(request.body.messages, [{ role: 'user', content: 'q' }]);
  assert.equal(request.body.max_tokens, 4096);
  assert.equal(client.extractModelText({ content: [{ type: 'text', text: '{"answers":[]}' }], stop_reason: 'end_turn' }), '{"answers":[]}');
});
test('Gemini native API derives the model endpoint and parses only final text parts', () => {
  const request = client.buildRequest({
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiType: 'gemini', apiKey: 'test-key', model: 'gemini-3.8-flash', maxOutputTokens: 2048,
  }, 'q', 'batch');
  assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
  assert.equal(request.headers['x-goog-api-key'], 'test-key');
  assert.equal(request.body.generationConfig.maxOutputTokens, 2048);
  assert.match(request.body.systemInstruction.parts[0].text, /answers/);
  assert.equal(client.extractModelText({ candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'private' }, { text: '{"answers":[]}' }] } }] }), '{"answers":[]}');
});
test('Responses, Chat and local APIs use the selected endpoint and output parameter', () => {
  const responses = client.buildRequest({ baseUrl: 'https://api.openai.com/v1', apiType: 'responses', apiKey: 'key', model: 'gpt-4.1-mini', maxOutputTokens: 500 }, 'q');
  assert.equal(responses.url, 'https://api.openai.com/v1/responses');
  assert.equal(responses.body.max_output_tokens, 500);
  const chat = client.buildRequest({ baseUrl: 'https://api.openai.com/v1', apiType: 'chat', apiKey: 'key', model: 'gpt-4.1-mini', maxOutputTokens: 500 }, 'q');
  assert.equal(chat.body.max_completion_tokens, 500);
  const compatible = client.buildRequest({ baseUrl: 'https://api.example.com/v1', apiType: 'chat', apiKey: 'key', model: 'model', maxOutputTokens: 500 }, 'q');
  assert.equal(compatible.body.max_tokens, 500);
  const local = client.buildRequest({ baseUrl: 'http://localhost:11434/v1', apiType: 'chat', authMode: 'none', model: 'local-model' }, 'q');
  assert.equal(local.headers.Authorization, undefined);
});
test('configuration validation blocks insecure remote, secret URL, remote no-auth and mismatched endpoints', () => {
  const base = { apiKey: 'key', model: 'model' };
  assert.throws(() => client.validateConfig({ ...base, baseUrl: 'http://api.example.com/v1' }), /HTTPS/);
  assert.throws(() => client.validateConfig({ ...base, baseUrl: 'https://api.example.com/v1?api_key=secret' }), /密钥/);
  assert.throws(() => client.validateConfig({ ...base, baseUrl: 'https://api.example.com/v1', authMode: 'none' }), /本机/);
  assert.throws(() => client.validateConfig({ ...base, baseUrl: 'https://api.example.com/v1/responses', apiType: 'chat' }), /不一致/);
  assert.throws(() => client.validateConfig({ ...base, baseUrl: 'https://api.example.com/v1', apiKey: '$API_KEY' }), /占位符/);
});
test('truncated and blocked provider responses are never accepted as final answers', () => {
  assert.throws(() => client.extractModelText({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }), /不完整/);
  assert.throws(() => client.extractModelText({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] }), /拒绝/);
  assert.throws(() => client.extractModelText({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{}' }] }), /不完整/);
});
