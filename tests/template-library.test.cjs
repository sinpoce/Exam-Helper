const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const templateDir = path.join(root, 'templates');
const expected = [
  'wjx.json', 'tencent.json', 'jnlab.json', 'moodle.json', 'canvas-classic.json',
  'google-forms.json', 'surveyjs.json', 'open-edx.json',
];
const templates = Object.fromEntries(expected.map(file => [file, JSON.parse(fs.readFileSync(path.join(templateDir, file), 'utf8'))]));
let browser;

before(async () => { browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) }); });
after(async () => { await browser?.close(); });

test('built-in template library is complete, unique and source-backed', () => {
  const ids = new Set();
  for (const [file, template] of Object.entries(templates)) {
    assert.equal(typeof template.siteId, 'string', file);
    assert.equal(ids.has(template.siteId), false, `duplicate ${template.siteId}`);
    ids.add(template.siteId);
    assert.equal(typeof template.selectors?.questionContainer, 'string', file);
    assert.equal(Object.keys(template.selectors?.questionTypes || {}).some(key => ['single', 'multiple', 'fill'].includes(key)), true, file);
    if (!['wjx.json', 'tencent.json', 'jnlab.json'].includes(file)) {
      assert.equal(template.sourceReferences?.length >= 2, true, file);
      assert.equal(template.sourceReferences.every(url => url.startsWith('https://')), true, file);
    }
  }
  const manager = fs.readFileSync(path.join(root, 'modules/template-manager.js'), 'utf8');
  for (const file of expected) assert.match(manager, new RegExp(file.replace('.', '\\.')));
});

test('site matcher uses narrow quiz routes and strong embedded DOM signatures', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<main>普通页面</main>');
    await page.addScriptTag({ path: path.join(root, 'modules/site-matcher.js') });
    await page.evaluate(items => items.forEach(item => siteMatcher.registerTemplate(item)), Object.values(templates));
    const matches = await page.evaluate(() => ({
      moodle: siteMatcher.matchTemplate('https://learn.example.edu/mod/quiz/attempt.php?attempt=7')?.siteId,
      canvas: siteMatcher.matchTemplate('https://canvas.example.edu/courses/12/quizzes/34/take')?.siteId,
      google: siteMatcher.matchTemplate('https://docs.google.com/forms/d/e/example/viewform')?.siteId,
      edx: siteMatcher.matchTemplate('https://learn.example.edu/courses/course-v1:X+Y+Z/courseware/unit')?.siteId,
      ordinary: siteMatcher.matchTemplate('https://learn.example.edu/courses/12/pages/notes')?.siteId || null,
    }));
    assert.deepEqual(matches, {
      moodle: 'moodle_quiz', canvas: 'canvas_classic_quiz', google: 'google_forms',
      edx: 'open_edx_problem', ordinary: null,
    });

    await page.setContent('<div class="sd-question"><input type="radio"></div>');
    assert.equal(await page.evaluate(() => siteMatcher.matchTemplate('https://embedded.invalid/form')), null);
    await page.setContent('<div class="sd-root-modern"><div class="sd-question"><input class="sd-item__control" type="radio"></div></div>');
    assert.equal(await page.evaluate(() => siteMatcher.matchTemplate('https://embedded.invalid/form')?.siteId), 'surveyjs_embedded');
  } finally { await page.close(); }
});

test('new templates expose the right question boundary, title and answer controls', async () => {
  const cases = [
    {
      file: 'moodle.json', title: 'Moodle 合成题', options: ['甲', '乙'],
      html: '<div class="que"><div class="questionflag"><label><input type="checkbox" name="q:flagged">标记</label></div><div class="qtext">Moodle 合成题</div><div class="answer"><div><label><input type="radio" name="mq">甲</label></div><div><label><input type="radio" name="mq">乙</label></div></div></div>',
    },
    {
      file: 'canvas-classic.json', title: 'Canvas 合成题', options: ['甲', '乙'],
      html: '<div class="question" id="question_1"><div class="question_text">Canvas 合成题</div><div class="answers"><div class="answer"><label><input class="question_input" type="radio" name="cq">甲</label></div><div class="answer"><label><input class="question_input" type="radio" name="cq">乙</label></div></div></div>',
    },
    {
      file: 'google-forms.json', title: 'Google 合成题', options: ['甲', '乙'],
      html: '<div role="listitem"><div role="heading">Google 合成题</div><div role="radiogroup"><div role="radio" aria-label="甲" aria-checked="false"></div><div role="radio" aria-label="乙" aria-checked="false"></div></div></div>',
    },
    {
      file: 'surveyjs.json', title: 'SurveyJS 合成题', options: ['甲', '乙'],
      html: '<div class="sd-root-modern"><div class="sd-question"><div class="sd-question__title">SurveyJS 合成题</div><label class="sd-radio"><input class="sd-item__control sd-radio__control" type="radio" name="sq"><span class="sd-item__control-label">甲</span></label><label class="sd-radio"><input class="sd-item__control sd-radio__control" type="radio" name="sq"><span class="sd-item__control-label">乙</span></label></div></div>',
    },
    {
      file: 'open-edx.json', title: 'Open edX 合成题', options: ['甲', '乙'],
      html: '<div class="xblock-student_view"><div class="problem"><h3 class="problem-header">Open edX 合成题</h3><label><input type="radio" name="eq">甲</label><label><input type="radio" name="eq">乙</label></div></div>',
    },
  ];

  for (const fixture of cases) {
    const page = await browser.newPage();
    try {
      await page.setContent(fixture.html);
      await page.addScriptTag({ path: path.join(root, 'modules/question-dom.js') });
      const result = await page.evaluate(template => {
        const scan = new QuestionDOM.Scanner().scan(template);
        return scan.questions.map(question => ({ text: question.text, options: question.options.map(option => option.text) }));
      }, templates[fixture.file]);
      assert.equal(result.length, 1, fixture.file);
      assert.equal(result[0].text, fixture.title, fixture.file);
      assert.deepEqual(result[0].options, fixture.options, fixture.file);
    } finally { await page.close(); }
  }
});
