// Universal answering coordinator. Discovery and interaction live in QuestionDOM.
(function () {
  'use strict';
  if (globalThis.__aiAnswerCoordinator) return;
  globalThis.__aiAnswerCoordinator = true;
  const engine = globalThis.AnswerEngine;
  const dom = globalThis.QuestionDOM;
  const scanner = new dom.Scanner();
  let questions = [], nextIndex = 0, config = null, settings = engine.normalizeSettings();
  let currentRun = null, scanSession = null, lastCompletion = null;
  let hasScanned = false, pageUrl = location.href, rescanTimer = null;
  let scanReport = { strategies: {}, candidateCount: 0, diagnostics: [] };
  let discoveredCandidates = [];
  const observers = new Map(), frameListeners = new Map(), routeListeners = new Map();
  let disposed = false;
  const templatesReady = window.templateManager?.init().catch(() => log('warning', '站点模板加载失败，继续使用通用策略')) || Promise.resolve();

  function notify(message) {
    if (disposed) return;
    try {
      chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError);
    } catch (_) { dispose(); }
  }
  function log(level, text) { notify({ type: 'log', level, text }); }
  function counts() {
    return {
      questionCount: questions.length,
      answeredCount: questions.filter(q => q.answered).length,
      skippedCount: questions.filter(q => q.skipReason && !q.answered).length,
    };
  }
  function updateStats() { notify({ type: 'updateStats', ...counts(), scanReport, hasScanned, isScanning: Boolean(scanSession) }); }
  function reconcileAnswers() {
    let changed = false;
    for (const q of questions) {
      if (q.answered && (scanner.inspect(q) || !dom.matchesAnswer(q, q.answer))) {
        q.answered = false;
        q.skipReason = '页面上的已填答案或题目已变化，请重新扫描后核对';
        changed = true;
      }
    }
    if (changed) lastCompletion = null;
  }
  function complete(reason = 'finished', error) {
    reconcileAnswers();
    lastCompletion = { reason, ...counts(), remainingCount: questions.filter(q => !q.answered && !q.skipReason).length,
      candidateCount: scanReport.candidateCount, hasUnsupportedRegions: scanReport.diagnostics.length > 0 };
    if (error) log('error', error);
    notify({ type: 'complete', ...lastCompletion });
  }
  function active(run) { return currentRun === run && !run.cancelled && location.href === run.url; }
  function assertActive(run) {
    if (!active(run)) throw Object.assign(new Error('任务已取消或页面已切换'), { code: 'CANCELLED' });
  }
  function stop(reason = 'stopped', error) {
    const run = currentRun;
    if (run) {
      run.cancelled = true;
      run.cancelRequest?.();
      currentRun = null;
      complete(reason, error);
    }
    if (scanSession) {
      scanSession.cancelled = true;
      scanSession.cancelRequest?.();
      scanSession = null;
    }
  }
  function pageChanged() {
    if (location.href === pageUrl) return false;
    stop('stopped', '页面地址已变化，旧任务已取消。请重新扫描后开始。');
    pageUrl = location.href;
    questions = []; nextIndex = 0; discoveredCandidates = [];
    scanReport = { strategies: {}, candidateCount: 0, diagnostics: [] };
    hasScanned = false; lastCompletion = null;
    disconnectObservers();
    updateStats();
    return true;
  }
  function currentTemplate() {
    try { return window.siteMatcher?.matchTemplate(location.href) || null; } catch (_) { return null; }
  }
  function mergeQuestions(fresh, { reset = false } = {}) {
    const previous = new Map(questions.map(q => [q.key, q]));
    const merged = fresh.map(q => {
      const old = previous.get(q.key);
      if (old && old.snapshot === q.snapshot) {
        q.index = old.index;
        q.answered = old.answered;
        q.answer = old.answer;
        if (!reset) q.skipReason = old.skipReason;
      } else if (old && currentRun) {
        q.index = old.index;
      } else {
        q.index = nextIndex++;
      }
      return q;
    });
    // During a task, do not replace or reinterpret any record already in its
    // queue. A removed/changed question is inspected and skipped, not rebound.
    if (currentRun) {
      const existing = new Set(questions.map(q => q.key));
      const sameContent = (a, b) => a.type === b.type && a.widget === b.widget && a.text === b.text &&
        a.inputs.length === b.inputs.length && JSON.stringify(a.options.map(o => o.text)) === JSON.stringify(b.options.map(o => o.text));
      merged.forEach(q => {
        if (existing.has(q.key)) return;
        if (questions.some(old => old.controls.some(el => q.controls.includes(el)))) {
          scanner.diagnostics.push('已有题目的控件集合发生变化，旧答案已拦截，请重新扫描');
          return;
        }
        if (questions.some(old => old.controls.some(el => !el.isConnected) &&
          (old.element === q.element || sameContent(old, q)))) {
          scanner.diagnostics.push('已有题目控件被网页重新创建，未重复请求，请重新扫描后核对');
          return;
        }
        questions.push(q);
      });
    } else questions = merged;
  }
  function localScan({ reset = false } = {}) {
    reconcileAnswers();
    const result = scanner.scan(currentTemplate(), settings);
    const used = new Set(result.questions.flatMap(q => q.controls));
    questions.filter(q => q.strategy === 'ai-assisted' && !settings.disabledStrategies.includes(q.baseStrategy)).forEach(q => {
      if (!q.controls.some(el => used.has(el)) && !scanner.inspect(q)) {
        result.questions.push(q);
        q.controls.forEach(el => used.add(el));
        result.candidates = result.candidates.filter(c => c.question.key !== q.key);
      }
    });
    mergeQuestions(result.questions, { reset });
    discoveredCandidates = result.candidates;
    const strategies = {};
    questions.forEach(q => { strategies[q.strategy] = (strategies[q.strategy] || 0) + 1; });
    scanReport = { strategies, candidateCount: result.candidates.length, diagnostics: [...new Set(scanner.diagnostics)] };
    if (settings.autoRescan) attachObservers(result.roots);
    else disconnectObservers();
    updateStats();
    return result;
  }
  function scheduleRescan() {
    if (disposed || !hasScanned || !settings.autoRescan) return;
    clearTimeout(rescanTimer);
    rescanTimer = setTimeout(() => {
      if (pageChanged()) return;
      if (currentRun || scanSession) return;
      const before = questions.map(q => q.key + q.snapshot).join('|');
      localScan();
      if (questions.map(q => q.key + q.snapshot).join('|') !== before) {
        lastCompletion = null;
        log('info', `页面变化后已更新识别结果：${questions.length} 道题。未自动发送 AI 请求。`);
      }
    }, 250);
  }
  function disconnectObservers() {
    clearTimeout(rescanTimer);
    observers.forEach((o, tree) => {
      o.disconnect();
      tree.removeEventListener('input', scheduleRescan, true);
      tree.removeEventListener('change', scheduleRescan, true);
    }); observers.clear();
    frameListeners.forEach((listener, frame) => frame.removeEventListener('load', listener)); frameListeners.clear();
    routeListeners.forEach((listener, win) => {
      try {
        win.removeEventListener('hashchange', listener); win.removeEventListener('popstate', listener);
        win.navigation?.removeEventListener('navigatesuccess', listener);
      } catch (_) {}
    });
    routeListeners.clear();
  }
  function attachObservers(roots) {
    for (const [tree, observer] of observers) {
      if (!roots.includes(tree)) {
        observer.disconnect(); observers.delete(tree);
        tree.removeEventListener('input', scheduleRescan, true);
        tree.removeEventListener('change', scheduleRescan, true);
      }
    }
    for (const tree of roots) {
      if (!observers.has(tree)) {
        const observer = new MutationObserver(records => {
          if (records.every(r => r.type === 'attributes' && r.attributeName?.startsWith('data-ai-'))) return;
          if (!pageChanged()) scheduleRescan();
        });
        observer.observe(tree, { childList: true, subtree: true, characterData: true, attributes: true,
          attributeFilter: ['id', 'name', 'type', 'role', 'class', 'style', 'hidden', 'inert', 'disabled', 'readonly', 'checked', 'selected', 'aria-checked', 'aria-selected', 'aria-disabled', 'aria-label', 'aria-labelledby', 'aria-hidden', 'src', 'min', 'max', 'maxlength', 'pattern'] });
        observers.set(tree, observer);
        tree.addEventListener('input', scheduleRescan, true);
        tree.addEventListener('change', scheduleRescan, true);
      }
      const win = tree.defaultView;
      if (win && win !== window && !routeListeners.has(win)) {
        const listener = () => {
          stop('stopped', '子页面已切换，请重新扫描后继续。');
          hasScanned = false; questions = []; updateStats();
        };
        win.addEventListener('hashchange', listener); win.addEventListener('popstate', listener);
        win.navigation?.addEventListener('navigatesuccess', listener);
        routeListeners.set(win, listener);
      }
      for (const frame of tree.querySelectorAll('iframe')) {
        if (!frameListeners.has(frame)) {
          const listener = () => {
            if (currentRun) stop('stopped', '内嵌页面已重新加载，请重新扫描。');
            scheduleRescan();
          };
          frame.addEventListener('load', listener); frameListeners.set(frame, listener);
        }
      }
    }
    for (const [frame, listener] of frameListeners) {
      if (!frame.isConnected) { frame.removeEventListener('load', listener); frameListeners.delete(frame); }
    }
    for (const [win, listener] of routeListeners) {
      if (!roots.some(tree => tree.defaultView === win)) {
        try {
          win.removeEventListener('hashchange', listener); win.removeEventListener('popstate', listener);
          win.navigation?.removeEventListener('navigatesuccess', listener);
        } catch (_) {}
        routeListeners.delete(win);
      }
    }
  }
  async function handleScan(message) {
    pageChanged();
    if (message.answerSettings) settings = engine.normalizeSettings(message.answerSettings);
    config = message.config || config;
    const session = { cancelled: false, url: location.href };
    scanSession = session;
    hasScanned = true;
    lastCompletion = null;
    try {
      await templatesReady;
      if (session.cancelled || location.href !== session.url) return { success: false, count: 0, message: '扫描已取消' };
      localScan({ reset: true });
      log('info', `本地多策略扫描：${questions.length} 道题，${discoveredCandidates.length} 个待确认题块`);
      scanReport.diagnostics.forEach(reason => log('warning', reason));
      if (settings.aiAssist && discoveredCandidates.length && config) {
        // Bound payloads by both records and characters; do not send the whole
        // page, current input values, scripts, credentials or unrelated forms.
        const batches = [];
        let batch = [], length = 0;
        for (const candidate of discoveredCandidates) {
          const size = JSON.stringify(candidate.payload).length;
          if (size > 24000) { log('warning', '一个题块过长，未发送 AI 分析'); continue; }
          if (batch.length && (batch.length >= 8 || length + size > 24000)) {
            batches.push(batch); batch = []; length = 0;
          }
          batch.push(candidate); length += size;
        }
        if (batch.length) batches.push(batch);
        // Limit expensive analysis in a single scan; remaining candidates stay visible.
        for (const records of batches.slice(0, 5)) {
          if (session.cancelled || location.href !== session.url) break;
          log('info', `AI 补充确认 ${records.length} 个题块（仅使用本地元素编号）`);
          const prompt = '确认以下候选记录中确实是题目的项目，不能把不同题块合并。仅返回 {"questions":[{"candidateId":"原编号","type":"原类型","controlIds":["原控件编号"],"text":"来自该题块的原文题干"}]}；不能完整确认时返回 candidateId 和 status:"skip"。不得生成 CSS 或代码。\n' +
            JSON.stringify(records.map(c => c.payload));
          try {
            const response = await requestAI(prompt, session, 'analyze');
            if (session.cancelled || location.href !== session.url) break;
            const accepted = scanner.acceptAI(response, records, questions);
            accepted.forEach(q => { q.index = nextIndex++; questions.push(q); });
            const ids = new Set(accepted.map(q => 'q-' + q.key));
            discoveredCandidates = discoveredCandidates.filter(c => !ids.has(c.candidateId));
          } catch (error) {
            if (!session.cancelled) log('warning', `AI补充识别未完成：${error.message}；已识别题目保留`);
            break;
          }
        }
        if (batches.length > 5) log('warning', '本次 AI 分析达到 5 批上限，剩余候选题块需人工检查');
      }
      scanReport.candidateCount = discoveredCandidates.length;
      const strategies = {};
      questions.forEach(q => { strategies[q.strategy] = (strategies[q.strategy] || 0) + 1; });
      scanReport.strategies = strategies;
      if (session.cancelled || location.href !== session.url) return { success: questions.length > 0,
        cancelled: true, count: questions.length, scanReport, message: '扫描已取消，保留已识别题目' };
      updateStats();
      log(questions.length ? 'success' : 'warning', `扫描结束：${questions.length} 道已识别题，${scanReport.candidateCount} 个题块仍需检查`);
      return { success: questions.length > 0, count: questions.length, scanReport,
        message: questions.length ? '' : '未识别到可处理题目；请检查题目是否已加载、是否位于跨域框架或特殊控件中' };
    } finally {
      if (scanSession === session) scanSession = null;
      updateStats();
    }
  }
  async function start(message) {
    if (!hasScanned || !questions.length) return { success: false, error: '请先扫描题目' };
    if (pageChanged()) return { success: false, error: '页面已变化，请重新扫描' };
    config = message.config || config;
    settings = engine.normalizeSettings(message.answerSettings || settings);
    reconcileAnswers();
    // Validate current contents before creating a run; retain AI-confirmed
    // records if they are unchanged rather than rerunning paid analysis.
    questions.forEach(q => { delete q.skipReason; });
    const run = { cancelled: false, url: location.href, config: { ...config }, settings: { ...settings } };
    currentRun = run; lastCompletion = null;
    log('info', `开始通用答题：每批 ${settings.parallelSearchEnabled ? settings.batchSize : 1} 题，题目变化会重新校验`);
    updateStats();
    void execute(run);
    return { success: true };
  }
  async function execute(run) {
    try {
      const result = await engine.runQueue({
        questions, settings: run.settings, isActive: () => active(run),
        refresh: async () => {
          assertActive(run);
          if (run.settings.autoRescan) {
            localScan();
            if (questions.length > 1000) throw Object.assign(new Error('本轮已达 1000 道题上限，请分段处理'), { fatal: true });
          }
          return questions;
        },
        inspect: q => run.settings.disabledStrategies.includes(q.baseStrategy || q.strategy) ? '此题识别策略已关闭，请重新扫描' : scanner.inspect(q),
        request: async batch => {
          assertActive(run);
          run.inFlight = batch;
          const started = performance.now();
          const text = await requestAI(engine.makePrompt(batch), run, 'batch');
          assertActive(run);
          log('info', `本批 ${batch.length} 题返回，耗时 ${((performance.now() - started) / 1000).toFixed(1)} 秒`);
          return text;
        },
        apply: async (q, answer) => {
          assertActive(run);
          await dom.apply(q, answer, scanner, () => assertActive(run));
          assertActive(run);
          q.answer = answer; q.answered = true;
          updateStats();
          log('success', `第 ${q.index + 1} 题已填写（${q.strategy}）`);
        },
        onSkip: (q, reason) => { q.skipReason = reason; updateStats(); log('warning', `跳过第 ${q.index + 1} 题：${reason}`); },
        onBatch: batch => log('info', `一次请求 ${batch.length} 题，题号：${batch.map(q => q.index + 1).join('、')}`),
      });
      if (currentRun !== run) return;
      currentRun = null;
      complete(result.reason, result.error);
    } catch (error) {
      if (currentRun === run) { currentRun = null; complete(error.code === 'CANCELLED' ? 'stopped' : 'error', error.message); }
    }
  }
  function requestAI(prompt, owner, mode) {
    const requestId = crypto.randomUUID();
    const timeoutMs = (owner.settings || settings).requestTimeoutSeconds * 1000;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, data) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (owner.cancelRequest === cancel) owner.cancelRequest = null;
        if (error) reject(error); else resolve(data);
      };
      const abortRemote = () => {
        try { chrome.runtime.sendMessage({ action: 'cancelAI', requestId }, () => void chrome.runtime.lastError); } catch (_) {}
      };
      const cancel = () => { abortRemote(); finish(Object.assign(new Error('请求已取消'), { code: 'CANCELLED' })); };
      const timer = setTimeout(() => { abortRemote(); finish(Object.assign(new Error('AI请求超时或后台连接中断'), { code: 'TIMEOUT' })); }, timeoutMs + 1500);
      owner.cancelRequest = cancel;
      if (owner.cancelled || location.href !== owner.url) { cancel(); return; }
      try {
        chrome.runtime.sendMessage({
          action: mode === 'analyze' ? 'analyzeHTML' : 'callAI', mode, requestId, timeoutMs,
          config: owner.config || config, prompt,
        }, response => {
          if (chrome.runtime.lastError) finish(Object.assign(new Error('后台连接中断，请刷新页面重试'), { fatal: true }));
          else if (!response?.success) finish(Object.assign(new Error(response?.error || 'AI请求失败'), { code: response?.code, fatal: response?.fatal }));
          else finish(null, response.data);
        });
      } catch (error) { finish(error); }
    });
  }
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (disposed) return;
    if (message.action === 'getStatus') {
      pageChanged();
      sendResponse({ ...counts(), isRunning: Boolean(currentRun), isScanning: Boolean(scanSession), hasScanned, lastCompletion, scanReport });
    } else if (message.action === 'stop') {
      stop(); sendResponse({ success: true });
    } else if (message.action === 'scan' || message.action === 'start') {
      if (currentRun || scanSession) { sendResponse({ success: false, error: '任务进行中，请先暂停', message: '任务进行中，请先暂停' }); return; }
      const action = message.action === 'scan' ? handleScan(message) : start(message);
      action.then(sendResponse).catch(error => sendResponse({ success: false, message: error.message, error: error.message }));
      return true;
    }
  });
  const navigation = () => { if (!pageChanged()) scheduleRescan(); };
  window.addEventListener('hashchange', navigation);
  window.addEventListener('popstate', navigation);
  // The Navigation API also catches pushState route changes without monkey-patching page code.
  window.navigation?.addEventListener('navigatesuccess', navigation);
  function dispose() {
    disposed = true; stop(); disconnectObservers();
    window.removeEventListener('hashchange', navigation);
    window.removeEventListener('popstate', navigation);
    window.navigation?.removeEventListener('navigatesuccess', navigation);
  }
  window.addEventListener('pagehide', () => { stop(); disconnectObservers(); });
})();
