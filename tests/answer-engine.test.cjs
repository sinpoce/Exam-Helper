const { test } = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../modules/answer-engine.js');
const single = index => ({ index, type: 'single', text: '合成测试题', options: [{ label: 'A', text: '甲' }, { label: 'B', text: '乙' }] });
const response = batch => JSON.stringify({ answers: batch.map(q => ({ questionIndex: q.index, type: q.type, answer: 'A' })) });

test('settings migrate without losing explicit choices; clamp numeric input', () => {
  assert.equal(engine.normalizeSettings().smartMode, true);
  assert.equal(engine.normalizeSettings().parallelSearchEnabled, true);
  assert.equal(engine.normalizeSettings({ parallelSearchEnabled: false }).parallelSearchEnabled, false);
  assert.equal(engine.normalizeSettings({ batchSize: 100 }).batchSize, 20);
  assert.equal(engine.normalizeSettings({ batchSize: 0 }).batchSize, 1);
  assert.equal(engine.normalizeSettings({ batchSize: '' }).batchSize, 5);
  assert.equal(engine.normalizeSettings(null).requestTimeoutSeconds, 45);
  assert.equal(engine.normalizeSettings({ requestTimeoutSeconds: Infinity }).requestTimeoutSeconds, 45);
  assert.equal(engine.normalizeSettings({ requestTimeoutSeconds: 999 }).requestTimeoutSeconds, 180);
});
test('strict ID matching handles reversed, missing, foreign, duplicate and absent IDs', () => {
  const batch = [single(0), single(2), single(4)];
  const items = [{ questionIndex: 4, type: 'single', answer: 'B' }, { questionIndex: 0, type: 'single', answer: 'A' }];
  const matched = engine.matchAnswers(batch, JSON.stringify(items));
  assert.equal(matched.get(4).answer, 'B');
  assert.ok(matched.get(2).reason);
  assert.equal(matched.get(0).answer, 'A');
  const invalid = engine.matchAnswers(batch, JSON.stringify([
    ...items, items[1], { questionIndex: 99, type: 'single', answer: 'A' }, { type: 'single', answer: 'B' },
  ]));
  assert.match(invalid.get(0).reason, /重复/);
  assert.ok(invalid.get(2).reason);
});
test('JSON extraction tolerates fences but does not invent missing answers', () => {
  assert.deepEqual(engine.parseJSON('说明\n```json\n{"answers":[]}\n```'), { answers: [] });
  assert.throws(() => engine.matchAnswers([single(0)], '{"answer":"A"}'), /数组/);
  assert.throws(() => engine.parseJSON('{"answers":['));
});
test('validate answer types, labels, fill count and skip requests', () => {
  const q = single(1);
  const match = item => engine.matchAnswers([q], JSON.stringify([item])).get(1);
  assert.ok(match({ questionIndex: 1, type: 'multiple', answer: ['A'] }).reason);
  assert.ok(match({ questionIndex: 1, type: 'single', answer: 'C' }).reason);
  assert.ok(match({ questionIndex: 1, type: 'single', answer: ['A'] }).reason);
  assert.equal(match({ questionIndex: 1, status: 'skip', reason: '缺少信息' }).reason, '缺少信息');
  q.type = 'fill'; q.inputs = [{}, {}];
  assert.ok(match({ questionIndex: 1, type: 'fill', answer: ['一'] }).reason);
  assert.deepEqual(match({ questionIndex: 1, type: 'fill', answer: ['一', '二'] }).answer, ['一', '二']);
  q.type = 'multiple';
  assert.deepEqual(match({ questionIndex: 1, type: 'multiple', answer: ['a', 'B', 'a'] }).answer, ['A', 'B']);
});

async function run(overrides = {}) {
  const calls = [], applied = [], skipped = [];
  const outcome = await engine.runQueue({
    questions: Array.from({ length: 12 }, (_, i) => single(i)),
    settings: { batchSize: 5 }, isActive: () => true,
    request: async batch => { calls.push(batch.map(q => q.index)); return response(batch); },
    apply: async (q, answer) => applied.push([q.index, answer]),
    onSkip: (q, reason) => skipped.push([q.index, reason]),
    ...overrides,
  });
  return { calls, applied, skipped, outcome };
}
test('12 questions use exactly 3 AI calls, never 12; final batch is partial', async () => {
  const { calls, applied, outcome } = await run();
  assert.deepEqual(calls.map(b => b.length), [5, 5, 2]);
  assert.equal(applied.length, 12);
  assert.equal(outcome.reason, 'finished');
});
test('long payloads split at a bounded size without truncating questions or repeating requests', async () => {
  const questions = Array.from({ length: 5 }, (_, i) => ({ ...single(i), text: '材料'.repeat(5500) }));
  const result = await run({ questions });
  assert.deepEqual(result.calls.map(batch => batch.length), [2, 2, 1]);
  assert.equal(result.applied.length, 5);
  const tooLarge = { ...single(0), options: [{ label: 'A', text: '甲'.repeat(33000) }, { label: 'B', text: '乙' }] };
  const next = await run({ questions: [tooLarge, single(1), single(2)] });
  assert.deepEqual(next.calls, [[1, 2]]); assert.match(next.skipped[0][1], /过长/);
});
test('image and invalid questions do not occupy batch slots', async () => {
  const questions = Array.from({ length: 14 }, (_, i) => single(i));
  questions[0].hasUnsupportedMedia = true;
  questions[3].text = '';
  questions[7].hasUnsupportedMedia = true;
  const result = await run({ questions });
  assert.deepEqual(result.calls.map(b => b.length), [5, 5, 1]);
  assert.deepEqual(result.calls[0], [1, 2, 4, 5, 6]);
  assert.deepEqual(result.skipped.map(s => s[0]), [0, 3, 7]);
});
test('all-image input makes zero requests', async () => {
  const result = await run({ questions: [0, 1].map(i => ({ ...single(i), hasUnsupportedMedia: true })) });
  assert.equal(result.calls.length, 0);
  assert.equal(result.skipped.length, 2);
});
test('single mode sends one question per request', async () => {
  const result = await run({ settings: { parallelSearchEnabled: false } });
  assert.equal(result.calls.length, 12);
});
test('missing answer skips only that question, without single-question fallback', async () => {
  let requests = 0;
  const result = await run({ request: async batch => { requests++; return response(batch.filter(q => q.index !== 2)); } });
  assert.equal(requests, 3);
  assert.equal(result.applied.length, 11);
  assert.deepEqual(result.skipped.map(s => s[0]), [2]);
});
test('timeout skips first batch, fills following batch and does not retry', async () => {
  let requests = 0;
  const result = await run({ request: async batch => {
    if (++requests === 1) throw Object.assign(new Error('超时'), { code: 'TIMEOUT' });
    return response(batch);
  } });
  assert.equal(requests, 3);
  assert.equal(result.skipped.length, 5);
  assert.equal(result.applied.length, 7);
});
test('two consecutive service errors stop, leaving remaining questions pending', async () => {
  let requests = 0;
  const result = await run({ request: async () => { requests++; throw new Error('超时'); } });
  assert.equal(requests, 2);
  assert.equal(result.outcome.reason, 'error');
  assert.equal(result.skipped.length, 5);
});
test('fatal auth/limit errors stop immediately without skipping every question', async () => {
  let requests = 0;
  const result = await run({ request: async () => { requests++; throw Object.assign(new Error('限流'), { fatal: true }); } });
  assert.equal(requests, 1);
  assert.equal(result.skipped.length, 0);
  assert.equal(result.outcome.reason, 'error');
});
test('normal mode stops at an unprocessable question', async () => {
  const result = await run({ questions: [{ ...single(0), hasUnsupportedMedia: true }], settings: { smartMode: false } });
  assert.equal(result.outcome.reason, 'error');
  assert.equal(result.calls.length, 0);
});
test('stop while awaiting request prevents any answer application', async () => {
  let active = true;
  const result = await run({ isActive: () => active, request: async batch => { active = false; return response(batch); } });
  assert.equal(result.applied.length, 0);
  assert.equal(result.outcome.reason, 'stopped');
});
test('an application failure is skipped, not counted as success', async () => {
  const result = await run({ apply: async () => { throw new Error('控件失效'); } });
  assert.equal(result.skipped.length, 12);
});
test('prompts are compact and include immutable IDs and skip contract', () => {
  const prompt = engine.makePrompt([single(3), single(8)]);
  assert.match(prompt, /"questionIndex":3/);
  assert.match(prompt, /"questionIndex":8/);
  assert.match(prompt, /status/);
  assert.match(prompt, /不输出解题过程/);
});
