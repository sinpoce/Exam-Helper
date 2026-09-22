// Site-independent question discovery and verified interaction. No AI-generated
// selector is ever executed: model replies may only refer to registered controls.
(function (root) {
  'use strict';
  const STRATEGIES = Object.freeze([
    { id: 'native', name: '原生单选 / 多选 / 判断', description: 'radio、checkbox 与 label 关联' },
    { id: 'semantic', name: '无模板题块结构推断', description: '当没有语义容器或站点模板时，结合标题与相邻控件推断题目范围' },
    { id: 'aria', name: 'ARIA 自定义选项', description: 'radio、checkbox、listbox / option 的可验证状态' },
    { id: 'select', name: '下拉选择 / 多选列表', description: '原生 select，逐项校验实际选中状态' },
    { id: 'matrix', name: '矩阵 / 表格子题', description: '按行或独立控件组拆题，保留行列标题' },
    { id: 'text', name: '填空 / 数字 / 简答', description: 'input、textarea、简单 contenteditable；多个空逐一填写' },
  ]);
  const CONTROL = 'input[type="radio"],input[type="checkbox"],input[type="text"],input[type="number"],input:not([type]),textarea,select,[contenteditable="true"],[role="radio"],[role="checkbox"],[role="option"]';
  const CONTAINER = 'fieldset,[data-question-id],[data-question],.question,.question-item,.questionItem,.exam-question,.quiz-question,.problem,.subject,.exercise,.que,.field[topic],.el-form-item,.ant-form-item,[role="radiogroup"],[role="listbox"],[role="group"][aria-label],[role="group"][aria-labelledby]';
  const TITLE = 'legend,.question-title,.question-text,.question-stem,.stem,.topichtml,.richText,.qtext,.title,h1,h2,h3,h4,h5,h6,[data-question-title]';
  const MATERIAL = '[data-question-material],.question-material,.reading-material,.passage';
  const MEDIA = 'img:not(.selectImg):not([aria-hidden="true"]),canvas,video,audio,object,iframe,svg:not([aria-hidden="true"]):not([role="presentation"])';
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const query = (node, selector) => { try { return [...node.querySelectorAll(selector)]; } catch (_) { return []; } };
  const matches = (node, selector) => { try { return Boolean(selector && node.matches(selector)); } catch (_) { return false; } };
  const parent = el => el?.parentElement || el?.getRootNode()?.host || null;
  const nativeChoice = el => el?.matches('input[type="radio"],input[type="checkbox"]');
  const kind = el => el.tagName === 'SELECT' ? 'select' : el.matches('[role="option"]') ? 'listbox' :
    el.matches('[role="radio"],input[type="radio"]') ? 'single' :
    el.matches('[role="checkbox"],input[type="checkbox"]') ? 'multiple' : 'fill';
  const descendants = (node, selector) => query(node, selector);

  function connected(el) {
    if (!el?.isConnected) return false;
    try {
      let doc = el.ownerDocument;
      while (doc && doc !== document) {
        const frame = doc.defaultView?.frameElement;
        if (!frame?.isConnected) return false;
        doc = frame.ownerDocument;
      }
      return doc === document;
    } catch (_) { return false; }
  }
  function visible(el) {
    if (!connected(el)) return false;
    for (let node = el; node; node = parent(node)) {
      if (node.hidden || node.hasAttribute('inert') || node.getAttribute('aria-hidden') === 'true') return false;
      const css = node.ownerDocument.defaultView.getComputedStyle(node);
      if (css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse') return false;
    }
    try {
      const frame = el.ownerDocument.defaultView.frameElement;
      if (frame && !visible(frame)) return false;
    } catch (_) { return false; }
    return true;
  }
  function interactiveVisible(el) {
    if (visible(el)) return true;
    // Many UI libraries hide only the native input and expose a visible label.
    if (!nativeChoice(el) || !connected(el) || el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
    const labels = [...(el.labels || [])];
    return (labels.length ? labels : [el.parentElement]).some(label => label && visible(label));
  }
  function sensitive(el) {
    if (el.closest('nav,header,footer,[role="search"],[data-ai-assistant-ui]')) return true;
    if (el.matches('input[type="password"],input[type="email"],input[type="tel"],input[type="search"],input[type="hidden"]')) return true;
    const labels = kind(el) === 'fill' ? [...(el.labels || [])].map(textWithoutAnswers).join(' ') : '';
    const identity = [el.name, el.id, el.getAttribute('autocomplete'), el.getAttribute('placeholder'), el.getAttribute('aria-label'), labels].join(' ');
    if (/password|passwd|username|e-?mail|phone|captcha|verification|api.?key|token|credit.?card|身份证|手机号|密码|验证码|姓名|学号|邮箱/i.test(identity)) return true;
    return Boolean(el.form?.querySelector('input[type="password"]'));
  }
  function available(el) {
    return connected(el) && interactiveVisible(el) && !sensitive(el) &&
      !el.matches(':disabled') && !el.disabled && !el.readOnly && el.getAttribute('aria-disabled') !== 'true';
  }
  function textWithoutAnswers(node) {
    if (!node) return '';
    const clone = node.cloneNode(true);
    query(clone, 'input,textarea,select,[contenteditable],script,style,button,[role="button"],.analysis,.explanation,.answer-analysis,[data-answer],[hidden],[aria-hidden="true"]').forEach(el => el.remove());
    return clean(clone.textContent);
  }
  function accessibleName(el) {
    const tree = el.getRootNode();
    const refs = clean(el.getAttribute('aria-labelledby')).split(' ').filter(Boolean);
    const linked = refs.map(id => tree.getElementById?.(id)).filter(Boolean).map(n => textWithoutAnswers(n)).join(' ');
    return clean(linked || el.getAttribute('aria-label'));
  }
  function controlLabel(el, group) {
    if (el.tagName === 'OPTION') return clean(el.label || el.textContent);
    let text = accessibleName(el);
    if (!text) text = [...(el.labels || [])].map(textWithoutAnswers).join(' ');
    if (!text) text = textWithoutAnswers(el.closest('label,.ui-radio,.ui-checkbox,.checkbox-option,.el-radio,.el-checkbox,.ant-radio-wrapper,.ant-checkbox-wrapper,.option,.choice') || (nativeChoice(el) ? el.parentElement : el));
    if (!text && el.closest('td,th,[role="cell"],[role="gridcell"]')) {
      const cell = el.closest('td,th,[role="cell"],[role="gridcell"]');
      const row = cell.parentElement;
      const cells = [...row.children];
      const table = row.closest('table,[role="grid"]');
      const header = table?.querySelector('thead tr,tr,[role="row"]');
      if (header && header !== row) text = textWithoutAnswers(header.children[cells.indexOf(cell)]);
    }
    return clean(text).replace(/^[A-Z][.．、)）\s]+/, '');
  }
  function titleFor(container, controls, hint) {
    if (hint?.isConnected && visible(hint) && container.contains(hint)) return textWithoutAnswers(hint);
    const own = accessibleName(container);
    if (own) return own;
    const controlSet = new Set(controls);
    const title = query(container, TITLE).find(el => {
      if (!visible(el) || el.closest('label') || controls.some(c => c.contains(el))) return false;
      const nearest = el.closest(CONTAINER);
      return !nearest || nearest === container || !query(nearest, CONTROL).some(c => !controlSet.has(c));
    });
    if (title) return textWithoutAnswers(title);
    if (container.matches('tr,[role="row"]')) {
      const table = container.closest('table,[role="grid"]');
      const heading = textWithoutAnswers(table?.querySelector('caption')) || accessibleName(table || container);
      const rowText = [...container.children].filter(cell => !cell.querySelector(CONTROL)).map(textWithoutAnswers).join(' ');
      return clean(heading + ' ' + rowText);
    }
    const clone = container.cloneNode(true);
    query(clone, CONTROL + ',label,.option,.choice,.el-radio,.el-checkbox,.ant-radio-wrapper,.ant-checkbox-wrapper,script,style,button,.analysis,.explanation,.answer-analysis,[data-answer],[hidden],[aria-hidden="true"]').forEach(el => el.remove());
    const text = clean(clone.textContent);
    return text || (controls.length === 1 ? accessibleName(controls[0]) || [...(controls[0].labels || [])].map(textWithoutAnswers).join(' ') : '');
  }
  function hasMedia(container, title, controls) {
    // Only media in the question scope; decorated checkmarks are not question images.
    return query(container, MEDIA).some(el => visible(el) && !el.closest('.selectImg,[data-ai-assistant-ui]')) ||
      materialNodes(container).some(el => query(el, MEDIA).some(visible));
  }
  function materialNodes(container) {
    const scope = container.closest('[data-question-group],.question-group,.question-set,.reading-comprehension,.composite-question') || container;
    return query(scope, MATERIAL).filter(el => visible(el) && !el.querySelector(CONTROL) &&
      (container.contains(el) || el.closest(CONTAINER) === scope || !el.closest(CONTAINER)));
  }
  function withMaterial(container, text) {
    const materials = materialNodes(container).map(textWithoutAnswers).filter(part => part && !text.includes(part));
    return materials.length ? '材料：' + materials.join(' ') + '\n题目：' + text : text;
  }

  class Scanner {
    constructor() {
      this.ids = new WeakMap();
      this.sequence = 0;
      this.registry = new Map();
      this.labelNodes = new WeakMap();
      this.roots = [];
      this.diagnostics = [];
    }
    id(el) {
      if (!this.ids.has(el)) this.ids.set(el, 'e' + (++this.sequence));
      const id = this.ids.get(el);
      this.registry.set(id, el);
      return id;
    }
    collectRoots() {
      this.roots = [];
      let elements = 0;
      const visit = tree => {
        if (this.roots.includes(tree)) return;
        if (this.roots.length >= 64) { this.diagnostics.push('页面子树超过 64 个，未全部扫描'); return; }
        this.roots.push(tree);
        for (const el of query(tree, '*')) {
          if (++elements > 100000) { this.diagnostics.push('页面节点过多，扫描已达安全上限'); return; }
          if (el.shadowRoot && visible(el)) visit(el.shadowRoot);
          if (el.tagName === 'IFRAME' && visible(el)) {
            try {
              const doc = el.contentDocument;
              if (doc?.documentElement && doc.defaultView?.frameElement) visit(doc);
              else this.diagnostics.push('发现不可访问的 iframe，请在对应页面单独运行插件');
            } catch (_) { this.diagnostics.push('发现跨域 iframe，当前扫描不跨越其边界'); }
          }
        }
      };
      visit(document);
    }
    controls(tree) {
      return query(tree, CONTROL).filter(el => available(el) &&
        !(el.matches('[role="radio"],[role="checkbox"]') && el.querySelector('input[type="radio"],input[type="checkbox"]')) &&
        !(el.matches('[contenteditable="true"]') && el.parentElement?.closest('[contenteditable="true"]')));
    }
    containerFor(el, templateContainers, allowHeuristic = true) {
      const row = el.closest('tr,[role="row"]');
      let semantic = el.closest(CONTAINER);
      if (semantic?.matches('[role="radiogroup"],[role="listbox"]') && !accessibleName(semantic) && !semantic.querySelector(TITLE)) {
        const outer = semantic.parentElement?.closest(CONTAINER);
        if (outer && query(outer, CONTROL).every(control => semantic.contains(control))) semantic = outer;
      }
      // Layout tables may contain complete questions. A nested fieldset/question
      // keeps its own boundary; only actual row-level controls use matrix logic.
      if (row && semantic && semantic !== row && row.contains(semantic)) return semantic;
      if (row && row.querySelector(CONTROL)) return row;
      const templated = templateContainers.find(c => c.contains(el));
      if (templated && semantic?.matches('[role="radiogroup"],[role="listbox"]') &&
        !accessibleName(semantic) && !semantic.querySelector(TITLE) && templated.contains(semantic)) return templated;
      if (semantic && (!templated || templated.contains(semantic))) return semantic;
      if (templated) return templated;
      if (!allowHeuristic) return null;
      // Stop before a page/form containing separate control groups. Do not treat
      // arbitrary text fields as questions merely because they exist.
      let candidate = el.parentElement;
      for (let depth = 0; candidate && depth < 6; depth++, candidate = candidate.parentElement) {
        if (candidate.matches('body,html,form,main')) break;
        const items = query(candidate, CONTROL);
        const radios = items.filter(nativeChoice);
        const names = new Set(radios.map(c => c.name).filter(Boolean));
        if (names.size > 1) break;
        if (titleFor(candidate, items) && (items.length >= 2 || candidate.querySelector(TITLE))) return candidate;
      }
      return null;
    }
    templateHints(template, tree) {
      const containers = query(tree, template?.selectors?.questionContainer || ':not(*)');
      const hints = new Map();
      for (const container of containers) {
        for (const [type, rule] of Object.entries(template?.selectors?.questionTypes || {})) {
          if (!['single', 'multiple', 'fill'].includes(type) || !rule || typeof rule !== 'object') continue;
          const title = query(container, rule.title)[0];
          if (title) hints.set(container, { title, type });
          for (const item of query(container, rule.optionItem)) {
            const input = query(item, rule.optionInput)[0];
            const label = query(item, rule.optionLabel)[0];
            if (input && label) this.labelNodes.set(input, label);
          }
        }
      }
      return { containers, hints };
    }
    optionText(el, container) {
      const hint = this.labelNodes.get(el);
      return hint?.isConnected && container.contains(hint) ? textWithoutAnswers(hint).replace(/^[A-Z][.．、)）\s]+/, '') : controlLabel(el, container);
    }
    build(container, controls, { titleElement, strategy, groupLabel = '', forcedText = '' } = {}) {
      const kinds = new Set(controls.map(kind));
      let widget, type;
      if (kinds.size !== 1) return null;
      const first = controls[0];
      switch ([...kinds][0]) {
        case 'single': widget = nativeChoice(first) ? 'native' : 'aria'; type = 'single'; break;
        case 'multiple': widget = nativeChoice(first) ? 'native' : 'aria'; type = 'multiple'; break;
        case 'fill': widget = 'text'; type = 'fill'; break;
        case 'select':
          if (controls.length !== 1) return null;
          widget = 'select'; type = first.multiple ? 'multiple' : 'single'; break;
        case 'listbox': {
          const list = first.closest('[role="listbox"]');
          if (!list) return null;
          widget = 'aria'; type = list.getAttribute('aria-multiselectable') === 'true' ? 'multiple' : 'single'; break;
        }
        default: return null;
      }
      let text = forcedText || titleFor(container, controls, titleElement);
      if (groupLabel) text = clean(text + ' ' + groupLabel);
      text = withMaterial(container, text);
      const q = { type, widget, strategy: strategy || (widget === 'native' ? 'native' : widget),
        text, element: container, controls: [...controls], titleElement, groupLabel,
        options: [], inputs: [], answered: false, hasUnsupportedMedia: hasMedia(container, titleElement, controls) };
      if (type === 'fill') {
        q.inputs = controls.map(el => ({ element: el, controlId: this.id(el) }));
      } else {
        const items = widget === 'select' ? [...first.options].filter(o => !o.disabled && !o.parentElement?.disabled && o.value !== '' && !/^请选择|^please select|^choose\.\.\./i.test(clean(o.textContent))) : controls;
        q.options = items.map((el, i) => ({
          element: el, controlId: this.id(el), label: i < 26 ? String.fromCharCode(65 + i) : 'O' + (i + 1),
          text: this.optionText(el, container),
        }));
      }
      q.key = controls.map(el => this.id(el)).join('.');
      q.snapshot = this.signature(q);
      q.readText = () => forcedText ? q.text : withMaterial(container, clean(titleFor(container, controls, titleElement) + (groupLabel ? ' ' + groupLabel : '')));
      return q;
    }
    signature(q) {
      const title = q.readText ? q.readText() : q.text;
      const options = q.widget === 'select' ? [...q.controls[0].options].map(el => [this.id(el), el.value, el.disabled, Boolean(el.parentElement?.disabled), clean(el.textContent)]) :
        q.options.map(o => [this.id(o.element), this.optionText(o.element, q.element), o.element.getAttribute('value')]);
      return JSON.stringify([q.type, title, options, q.controls.map(el => [
        this.id(el), el.tagName, el.getAttribute('type'), el.getAttribute('name'), el.getAttribute('role'),
        el.getAttribute('min'), el.getAttribute('max'), el.getAttribute('pattern'), el.getAttribute('maxlength'),
        el.getAttribute('step'), el.getAttribute('multiple'), el.getAttribute('contenteditable'), el.getAttribute('required'),
      ]), query(q.element, CONTROL).map(el => this.id(el)), hasMedia(q.element, q.titleElement, q.controls)]);
    }
    scan(template = null, settings = {}) {
      this.registry.clear();
      this.diagnostics = [];
      this.collectRoots();
      const questions = [], candidates = [], claimed = new Set();
      const enabled = id => settings.disabledStrategies?.includes(id) !== true;
      const add = q => {
        if (!q || q.controls.some(c => claimed.has(c))) return false;
        if (!q.text || q.text.length > 12000 || (q.type !== 'fill' && q.options.length < 2)) return false;
        q.controls.forEach(c => claimed.add(c));
        questions.push(q);
        return true;
      };
      for (const tree of this.roots) {
        const { containers, hints } = this.templateHints(template, tree);
        const grouped = new Map();
        const ignoreControls = template?.selectors?.ignoreControls;
        const controls = this.controls(tree).filter(el => !matches(el, ignoreControls));
        if (controls.length > 4000) this.diagnostics.push('控件超过 4000 个，扫描已达安全上限');
        for (const el of controls.slice(0, 4000)) {
          this.id(el);
          const container = this.containerFor(el, containers, enabled('semantic'));
          if (!container || !visible(container)) continue;
          if (!grouped.has(container)) grouped.set(container, []);
          grouped.get(container).push(el);
        }
        for (const [container, controls] of grouped) {
          const isMatrix = container.matches('tr,[role="row"]');
          const hint = hints.get(container);
          // A semantic parent with multiple named groups is split, never flattened.
          const subgroups = new Map();
          for (const control of controls) {
            const k = kind(control);
            const group = k === 'select' ? this.id(control) :
              k === 'single' && control.name ? 'radio:' + control.name :
              k === 'listbox' ? this.id(control.closest('[role="listbox"]')) : k;
            if (!subgroups.has(group)) subgroups.set(group, []);
            subgroups.get(group).push(control);
          }
          for (const groupControls of subgroups.values()) {
            const k = kind(groupControls[0]);
            const strategy = isMatrix ? 'matrix' : k === 'select' ? 'select' :
              k === 'fill' ? 'text' : nativeChoice(groupControls[0]) ? 'native' : 'aria';
            const groupLabel = subgroups.size > 1 ? accessibleName(groupControls[0]) ||
              (k === 'select' ? [...(groupControls[0].labels || [])].map(textWithoutAnswers).join(' ') : '') : '';
            const q = this.build(container, groupControls, { titleElement: hint?.title, strategy, groupLabel });
            // Mixed or nested groups without a row/group label require explicit review.
            const ambiguous = subgroups.size > 1 && !groupLabel && !isMatrix;
            if (enabled(strategy) && !ambiguous && add(q)) continue;
            if (!enabled(strategy)) {
              this.diagnostics.push('已关闭策略：' + strategy); continue;
            }
            if (q?.text.length > 12000) {
              this.diagnostics.push('发现超过 12000 字符的题干，未截断发送，请拆分后处理'); continue;
            }
            if (q) candidates.push(this.candidate(q));
          }
        }
        // Unverifiable custom widgets are reported but never clicked blindly.
        query(tree, CONTAINER).filter(el => visible(el) && !controls.some(c => el.contains(c))).forEach(el => {
          if (el.querySelector('[draggable="true"],.sortable,canvas')) this.diagnostics.push('发现拖拽、排序或画布题，需要人工处理');
          else if (el.querySelector('img,svg,object')) this.diagnostics.push('发现没有可填写控件的图片或图形题，需要人工处理');
          else if (el.querySelector('.option,.choice,button')) this.diagnostics.push('发现没有标准状态的自定义题目控件，需要人工处理');
        });
      }
      this.diagnostics = [...new Set(this.diagnostics)];
      const unique = new Map(candidates.map(c => [c.candidateId, c]));
      return { questions, candidates: [...unique.values()], diagnostics: this.diagnostics, roots: this.roots };
    }
    candidate(q) {
      return { candidateId: 'q-' + q.key, question: q, signature: this.signature(q),
        payload: {
          candidateId: 'q-' + q.key, text: q.text.slice(0, 12000), type: q.type,
          scopeText: textWithoutAnswers(q.element).slice(0, 12000),
          controls: q.controls.map(el => ({ controlId: this.id(el), kind: kind(el), label: controlLabel(el, q.element) })),
          options: q.options.map(o => ({ controlId: o.controlId, label: o.label, text: o.text })),
        } };
    }
    acceptAI(text, candidates, existing = []) {
      const parsed = root.AnswerEngine.parseJSON(text);
      if (!Array.isArray(parsed?.questions)) throw new Error('AI结构响应缺少 questions 数组');
      const records = new Map(candidates.map(c => [c.candidateId, c]));
      const counts = new Map();
      parsed.questions.forEach(item => counts.set(item?.candidateId, (counts.get(item?.candidateId) || 0) + 1));
      const accepted = [], used = new Set(existing.flatMap(q => q.controls));
      for (const item of parsed.questions) {
        const record = records.get(item?.candidateId);
        if (!record || counts.get(item.candidateId) !== 1 || item.status === 'skip') continue;
        const q = record.question;
        if (item.type !== q.type || !Array.isArray(item.controlIds) ||
          item.controlIds.length !== q.controls.length || new Set(item.controlIds).size !== q.controls.length ||
          !q.controls.every(el => item.controlIds.includes(this.id(el))) ||
          this.signature(q) !== record.signature || q.controls.some(el => !available(el) || used.has(el))) continue;
        // Text is accepted only when grounded verbatim in this candidate's scope.
        const proposed = clean(item.text);
        if (!proposed || !textWithoutAnswers(q.element).includes(proposed)) continue;
        q.text = withMaterial(q.element, proposed);
        const originalRead = q.readText;
        q.readText = () => clean(originalRead()) + '|' + textWithoutAnswers(q.element);
        q.snapshot = this.signature(q);
        q.baseStrategy = q.baseStrategy || q.strategy;
        q.strategy = 'ai-assisted';
        q.controls.forEach(el => used.add(el));
        accepted.push(q);
      }
      return accepted;
    }
    inspect(q) {
      if (!connected(q.element) || q.controls.some(el => !available(el) || !q.element.contains(el))) return '题目控件失效或不可编辑，请重新扫描';
      if (this.signature(q) !== q.snapshot) return '题干、选项或控件已变化，旧答案已拦截，请重新扫描';
      if (q.widget === 'native' && q.type === 'single') {
        const first = q.controls[0];
        if (first.name) {
          const peers = query(first.getRootNode(), 'input[type="radio"]').filter(el => el.name === first.name && el.form === first.form);
          if (peers.some(el => !q.controls.includes(el))) return '原生单选组跨越题目边界，不能安全填写';
        }
      }
      if (q.controls.some(el => sensitive(el))) return '敏感表单字段不处理';
      if (q.hasUnsupportedMedia || /下图|如图所示|图中所示|看图|见图|图示标[识志]/.test(q.text)) return '含图片或图示，当前文字搜索无法识别，请人工处理';
      if (q.text.length > 12000) return '题干超过安全长度，请拆分题目';
      if (q.widget === 'aria' && q.options.some(o => state(o.element) === null)) return '自定义选项缺少可验证的选中状态';
      return root.AnswerEngine.preflight(q);
    }
  }

  function state(el) {
    if (nativeChoice(el)) return el.checked;
    if (el.tagName === 'OPTION') return el.selected;
    const attr = el.getAttribute('role') === 'option' ? 'aria-selected' : 'aria-checked';
    const value = el.getAttribute(attr);
    return value === 'true' ? true : value === 'false' ? false : null;
  }
  function matchesAnswer(q, answer) {
    if (answer == null || q.controls.some(el => !connected(el))) return false;
    const values = Array.isArray(answer) ? answer : [answer];
    if (q.widget === 'text') return values.length === q.controls.length && q.controls.every((el, i) =>
      String(el.isContentEditable ? el.textContent : el.value) === values[i]);
    const selected = new Set(values);
    if (!selected.size || values.some(value => !q.options.some(o => o.label === value))) return false;
    if (q.widget === 'select') {
      const elements = new Set(q.options.filter(o => selected.has(o.label)).map(o => o.element));
      return [...q.controls[0].options].every(el => el.selected === elements.has(el));
    }
    return q.options.every(o => state(o.element) === selected.has(o.label));
  }
  function event(el, type) {
    el.dispatchEvent(new el.ownerDocument.defaultView.Event(type, { bubbles: true, composed: true }));
  }
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function verify(check, assertActive, timeout = 700) {
    const end = performance.now() + timeout;
    do {
      assertActive();
      if (check()) {
        await sleep(35);
        assertActive();
        if (check()) return;
      }
      await sleep(25);
    } while (performance.now() < end);
    throw new Error('页面未保留所选答案，未计为完成');
  }
  async function apply(q, answer, scanner, assertActive) {
    assertActive();
    const reason = scanner.inspect(q);
    if (reason) throw new Error(reason);
    const validate = () => {
      assertActive();
      const changed = scanner.inspect(q);
      if (changed) throw new Error(changed);
    };
    if (q.widget === 'text') {
      const values = Array.isArray(answer) ? answer : [answer];
      // Validate every blank before making the first edit.
      q.controls.forEach((el, i) => {
        if (el.maxLength >= 0 && values[i].length > el.maxLength) throw new Error('答案超过输入框字数限制');
        if (el.matches('input[type="number"]') && (!values[i].trim() || !Number.isFinite(Number(values[i])))) throw new Error('数字输入框需要数值答案');
        if (el.isContentEditable && el.querySelector('img,table,[contenteditable],iframe')) throw new Error('复杂富文本编辑器需要人工处理');
      });
      for (const [i, el] of q.controls.entries()) {
        validate();
        if (el.isContentEditable) el.textContent = values[i];
        else {
          const view = el.ownerDocument.defaultView;
          const prototype = el.tagName === 'TEXTAREA' ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(prototype, 'value').set.call(el, values[i]);
        }
        event(el, 'input'); event(el, 'change');
      }
      await verify(() => q.controls.every((el, i) => connected(el) &&
        String(el.isContentEditable ? el.textContent : el.value) === values[i] && (!el.validity || el.validity.valid)), assertActive);
    } else if (q.widget === 'select') {
      const selected = new Set(Array.isArray(answer) ? answer : [answer]);
      const elements = new Set(q.options.filter(o => selected.has(o.label)).map(o => o.element));
      const select = q.controls[0];
      validate();
      [...select.options].forEach(option => { option.selected = elements.has(option); });
      event(select, 'input'); event(select, 'change');
      await verify(() => connected(select) && [...select.options].every(el => el.selected === elements.has(el)), assertActive);
    } else {
      const selected = new Set(Array.isArray(answer) ? answer : [answer]);
      for (const option of q.options) {
        validate();
        const wanted = selected.has(option.label);
        if (state(option.element) !== wanted && (wanted || q.type === 'multiple')) {
          option.element.click();
          await sleep(25);
        }
      }
      await verify(() => q.options.every(o => connected(o.element) && state(o.element) === selected.has(o.label)), assertActive);
    }
    validate();
  }
  root.QuestionDOM = { Scanner, STRATEGIES, apply, matchesAnswer, state, available, textWithoutAnswers };
})(globalThis);
