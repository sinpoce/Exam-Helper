// Lightweight UI localization shared by the popup and template manager.
(() => {
  const STORAGE_KEY = "uiLanguage";
  const languageNames = { "zh-CN": "中文", en: "English" };
  const zhToEn = new Map([
    ["多模型 · 网页练习助手", "Multi-model · Web practice assistant"],
    ["站点题型模板", "Site question templates"],
    ["模板管理", "Templates"],
    ["返回", "Back"],
    ["设置", "Settings"],
    ["打开设置", "Open settings"],
    ["学习工作台", "Study workspace"],
    ["识别题目，连接你的模型。", "Recognize questions. Connect your model."],
    ["先扫描，再批量处理。每一步都有状态可核对。", "Scan first, then process in batches. Every step is verifiable."],
    ["等待开始", "Ready to start"],
    ["识别题目", "Questions found"],
    ["已填写", "Answered"],
    ["已跳过", "Skipped"],
    ["填写进度", "Answer progress"],
    ["当前模型", "Active model"],
    ["管理模型", "Manage models"],
    ["正在加载模型…", "Loading models…"],
    ["识别详情与兼容性提示", "Recognition details and compatibility"],
    ["支持多种题型策略；请先扫描，确认识别数量。", "Multiple question strategies are supported. Scan first to verify the count."],
    ["扫描页面题目", "Scan page questions"],
    ["开始自动答题", "Start answering"],
    ["暂停答题", "Pause answering"],
    ["取消扫描，保留已识别题目", "Cancel scan and keep recognized questions"],
    ["运行日志", "Activity log"],
    ["清空", "Clear"],
    ["准备就绪，请先扫描题目", "Ready. Scan questions to begin."],
    ["仅用于获准的练习与测试。内容发送至你选择的服务，答案需核对，不自动提交。", "For authorized practice and testing only. Content is sent to your selected service; review answers before submitting."],
    ["设置与模型管理", "Settings and model management"],
    ["关闭设置", "Close settings"],
    ["设置分类", "Settings categories"],
    ["模型服务", "Model services"],
    ["答题与识别", "Answering and recognition"],
    ["独立保存多个服务，按需切换。新配置不会继承其他服务的密钥。", "Save multiple services independently and switch as needed. New configurations never inherit another service's key."],
    ["添加 API / 模型", "Add API / model"],
    ["模型修改在下次扫描或开始时生效；正在运行的任务继续使用启动时的模型。", "Model changes take effect on the next scan or run. Active tasks keep their starting model."],
    ["密钥保存在浏览器扩展存储中，并非加密密钥库。不要使用共享电脑保存生产密钥。", "Keys are stored in extension storage, not an encrypted vault. Do not save production keys on shared computers."],
    ["答题策略", "Answering strategy"],
    ["批量搜索（一次请求多题）", "Batch search (multiple questions per request)"],
    ["单次搜索题目数量", "Questions per request"],
    ["只调用当前选中的一个模型，每批一个请求，不是同时发出多次请求。末批不足按实际数量处理；题干与选项合计过长时会自动拆批。", "Only the selected model is called, with one request per batch. The final batch may be smaller, and long prompts are split automatically."],
    ["智能模式：跳过无法处理的题目", "Smart mode: skip unprocessable questions"],
    ["自动跳过图片、题干不完整、答案缺失或无效的题目；从后续可处理题目补足下一批。当前仅支持文字搜索，不识别图片内容。关闭后遇到这些问题会停止，等待人工处理。", "Automatically skip image-based, incomplete, or invalid questions and refill the next batch with processable ones. Text-only search is supported; image understanding is not. When disabled, the task pauses for manual handling."],
    ["单次请求超时（秒）", "Request timeout (seconds)"],
    ["默认 45 秒。超时不逐题重试；连续两批请求异常或遇到密钥、限流错误会停止任务。设置在下次开始时生效。", "Default: 45 seconds. Timeouts are not retried per question. Two consecutive request failures or authentication/rate-limit errors stop the task. Changes apply next time."],
    ["通用网页识别", "Universal web recognition"],
    ["页面变化时增量扫描", "Incrementally scan page changes"],
    ["扫描后监听已加载题块；任务中补入新增题目，空闲时只更新识别结果，不调用 AI。不自动翻页或提交；换页后请重新确认并开始。", "Watch loaded question blocks after scanning and add new questions during a run. Idle updates do not call AI. No automatic pagination or submission; rescan after changing pages."],
    ["AI 补充确认未识别题块", "Use AI to confirm unrecognized blocks"],
    ["只在点击扫描时发送候选题干与本地控件编号，不发送整页 HTML 或已填答案。每次扫描最多 5 批。", "Only candidate text and local control IDs are sent when you click Scan; full-page HTML and existing answers are excluded. Up to 5 batches per scan."],
    ["支持开放 Shadow DOM 与同源 iframe。跨域框架、封闭组件、拖拽/排序/连线、图片和复杂富文本仍需人工处理。", "Open Shadow DOM and same-origin iframes are supported. Cross-origin frames, closed components, drag/order/connect widgets, images, and complex rich text may need manual handling."],
    ["添加模型", "Add model"],
    ["编辑模型", "Edit model"],
    ["关闭模型编辑", "Close model editor"],
    ["服务商与模型预设", "Provider and model preset"],
    ["选择预设可自动填写地址和模型 ID，也可保留自定义配置。", "Choose a preset to fill the endpoint and model ID, or keep a custom configuration."],
    ["查看服务商官方文档 ↗", "Open provider documentation ↗"],
    ["配置名称", "Configuration name"],
    ["我的模型", "My model"],
    ["接口类型", "API type"],
    ["API Key", "API key"],
    ["输入该服务商的实际 API Key", "Enter the provider's actual API key"],
    ["显示或隐藏 API Key", "Show or hide API key"],
    ["模型ID", "Model ID"],
    ["填写控制台中可用的完整模型 ID", "Enter the complete model ID available in the provider console"],
    ["预设不是完整模型列表，支持手动输入；模型是否可用以服务商账户为准。", "Presets are examples, not a complete model list. You can enter an ID manually; availability depends on your provider account."],
    ["高级连接设置", "Advanced connection settings"],
    ["认证方式", "Authentication"],
    ["API Key（按接口自动设置请求头）", "API key (request headers are selected by API type)"],
    ["免认证（仅本机服务）", "No authentication (local services only)"],
    ["最大输出 tokens（可选）", "Max output tokens (optional)"],
    ["服务默认；Claude 留空为 4096", "Provider default; Claude uses 4096 when blank"],
    ["Chat 输出限制参数", "Chat output limit parameter"],
    ["自动（OpenAI 官方使用新版参数）", "Automatic (official OpenAI uses the newer parameter)"],
    ["max_tokens（常见兼容服务）", "max_tokens (common compatible services)"],
    ["max_completion_tokens（新版 OpenAI）", "max_completion_tokens (new OpenAI)"],
    ["仅影响 Chat 且设置了输出上限的请求。不会强加 temperature、推理或工具参数。", "Only affects Chat requests with an output limit. No temperature, reasoning, or tool parameters are forced."],
    ["测试连接与 JSON 回复", "Test connection and JSON response"],
    ["点击才发送一次简短测试，不含网页题目，可能产生少量费用；关闭编辑窗口会取消等待。", "A short test is sent only after clicking. It contains no page questions and may incur a small charge; closing the editor cancels the wait."],
    ["保存", "Save"],
    ["保存修改", "Save changes"],
    ["保存并启用", "Save and activate"],
    ["内置", "Built-in"],
    ["暂无模板", "No templates"],
    ["版本:", "Version:"],
    ["更新:", "Updated:"],
    ["嵌入式组件 · DOM 自动识别", "Embedded component · DOM recognition"],
    ["正则路径匹配", "Regex path matching"],
    ["个上游参考", " upstream references"],
    ["自定义配置", "Custom configuration"],
    ["添加自定义模型…", "Add custom model…"],
    ["配置待检查", "Configuration needs review"],
    ["接口待确认", "API type pending"],
    ["所选模型已不存在，请重新选择", "The selected model no longer exists. Choose another model."],
    ["请选择并保存有效模型，不会自动回退到内置代理。", "Select and save a valid model. The built-in proxy will not be selected automatically."],
    ["页面变化后已更新识别结果：", "Recognition updated after page changes: "],
    ["扫描结束：", "Scan finished: "],
    ["开始自动答题，模型：", "Started answering with model: "],
    ["连接失败", "Connection failed"],
    ["扫描中...", "Scanning..."],
    ["答题中...", "Answering..."],
    ["就绪", "Ready"],
    ["错误", "Error"],
    ["日志已清空", "Activity log cleared"],
    ["检测到正在运行的任务", "An active task was detected"],
    ["检测到已扫描题目，可以开始", "Scanned questions are ready"],
    ["正在扫描题目...", "Scanning questions..."],
    ["未发现题目", "No questions found"],
    ["扫描完成", "Scan complete"],
    ["扫描已取消", "Scan cancelled"],
    ["已暂停", "Paused"],
    ["任务异常停止", "Task stopped with an error"],
    ["本轮结束，有题待处理", "Run finished with questions pending"],
    ["已识别题目填写完成", "All recognized questions answered"],
  ]);
  const enToZh = new Map([...zhToEn].map(([zh, en]) => [en, zh]));
  let language = "zh-CN";
  let applying = false;

  function mapFor(target) { return target === "en" ? zhToEn : enToZh; }

  function replacePhrases(value, target) {
    let result = String(value ?? "");
    const entries = [...mapFor(target)].sort((a, b) => b[0].length - a[0].length);
    for (const [source, destination] of entries) result = result.split(source).join(destination);
    return result;
  }

  function translateTextNode(node) {
    if (!node?.nodeValue || /^(SCRIPT|STYLE|SVG)$/i.test(node.parentElement?.tagName || "")) return;
    const target = language === "en" ? "en" : "zh";
    const next = replacePhrases(node.nodeValue, target);
    if (next !== node.nodeValue) node.nodeValue = next;
  }

  function apply(root = document) {
    if (applying || !root) return;
    applying = true;
    try {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(translateTextNode);
      const target = language === "en" ? "en" : "zh";
      root.querySelectorAll?.("[title], [aria-label], [placeholder], [alt]").forEach(element => {
        for (const attribute of ["title", "aria-label", "placeholder", "alt"]) {
          if (element.hasAttribute(attribute)) element.setAttribute(attribute, replacePhrases(element.getAttribute(attribute), target));
        }
      });
      document.documentElement.lang = language === "en" ? "en" : "zh-CN";
      const toggle = document.getElementById("languageToggle");
      if (toggle) {
        toggle.textContent = language === "en" ? "中" : "EN";
        toggle.title = language === "en" ? "切换到中文" : "Switch to English";
        toggle.setAttribute("aria-label", toggle.title);
      }
    } finally {
      applying = false;
    }
  }

  async function setLanguage(next) {
    language = next === "en" ? "en" : "zh-CN";
    try { await chrome.storage.local.set({ [STORAGE_KEY]: language }); } catch (_) { /* local storage may be unavailable in a preview */ }
    apply();
    return language;
  }

  async function init() {
    try {
      const data = await chrome.storage.local.get(STORAGE_KEY);
      language = data[STORAGE_KEY] === "en" ? "en" : "zh-CN";
    } catch (_) { language = "zh-CN"; }
    apply();
    const toggle = document.getElementById("languageToggle");
    toggle?.addEventListener("click", () => setLanguage(language === "en" ? "zh-CN" : "en"));
    if (typeof MutationObserver !== "undefined") {
      new MutationObserver(records => {
        if (applying) return;
        records.forEach(record => {
          if (record.type === "characterData") translateTextNode(record.target);
          record.addedNodes?.forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
            else if (node.nodeType === Node.ELEMENT_NODE) apply(node);
          });
        });
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    }
    return language;
  }

  globalThis.ExamI18n = Object.freeze({ init, setLanguage, apply, get language() { return language; }, t: value => replacePhrases(value, language === "en" ? "en" : "zh") , languageNames });
})();
