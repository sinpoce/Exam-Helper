// Explicit provider contracts; presets are editable examples, not an availability guarantee.
// Sources and verification notes are maintained in API_PROVIDERS.md.
(function (root) {
  'use strict';
  const presets = Object.freeze([
    Object.freeze({ id: 'openai-responses', provider: 'OpenAI', name: 'GPT-4.1 mini · Responses',
      baseUrl: 'https://api.openai.com/v1/responses', apiType: 'responses', model: 'gpt-4.1-mini',
      docs: 'https://developers.openai.com/api/docs/models/gpt-4.1-mini', note: 'OpenAI 官方 API Key；ChatGPT 订阅不等于 API 调用额度。模型 ID 可改为账户可用的文本模型。' }),
    Object.freeze({ id: 'openai-chat', provider: 'OpenAI', name: 'GPT-4.1 mini · Chat',
      baseUrl: 'https://api.openai.com/v1/chat/completions', apiType: 'chat', model: 'gpt-4.1-mini',
      docs: 'https://developers.openai.com/api/reference/resources/chat', note: 'OpenAI Chat Completions。较新的推理模型如需指定输出上限，使用 max_completion_tokens。' }),
    Object.freeze({ id: 'deepseek-official', provider: 'DeepSeek 官方', name: 'DeepSeek V4 Flash（官方）',
      baseUrl: 'https://api.deepseek.com/v1', apiType: 'chat', model: 'deepseek-v4-flash',
      docs: 'https://api-docs.deepseek.com/', note: '使用 DeepSeek 官方 API Key，不使用火山方舟密钥。' }),
    Object.freeze({ id: 'deepseek-official-pro', provider: 'DeepSeek 官方', name: 'DeepSeek V4 Pro（官方）',
      baseUrl: 'https://api.deepseek.com/v1', apiType: 'chat', model: 'deepseek-v4-pro',
      docs: 'https://api-docs.deepseek.com/', note: '推理模型可能响应较慢，请按需增加任务超时；不会将 reasoning_content 当作答案。' }),
    Object.freeze({ id: 'anthropic', provider: 'Anthropic', name: 'Claude Sonnet 4.6',
      baseUrl: 'https://api.anthropic.com/v1/messages', apiType: 'anthropic', model: 'claude-sonnet-4-6',
      docs: 'https://platform.claude.com/docs/en/build-with-claude/working-with-messages', note: 'Claude Messages 原生协议，使用 Anthropic API Key。输出上限留空时为 4096；请使用已授权目标 workspace 的密钥。' }),
    Object.freeze({ id: 'google-gemini', provider: 'Google', name: 'Gemini Flash（原生 API）',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiType: 'gemini', model: 'gemini-3.8-flash',
      docs: 'https://ai.google.dev/api/generate-content', note: '使用 Google AI Studio 的 Gemini API Key，不是 Vertex AI 服务账户。自动根据模型 ID 生成 generateContent 地址。' }),
    Object.freeze({ id: 'qwen', provider: '阿里云百炼', name: '通义千问 Qwen Plus',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiType: 'chat', model: 'qwen-plus',
      docs: 'https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope', note: '预设为北京地域兼容地址。不同地域、业务空间需要使用对应的地址和 API Key，可按控制台修改。' }),
    Object.freeze({ id: 'moonshot', provider: 'Moonshot / Kimi', name: 'Kimi K3',
      baseUrl: 'https://api.moonshot.cn/v1', apiType: 'chat', model: 'kimi-k3',
      docs: 'https://platform.kimi.com/docs/get-api-key', note: '使用 Kimi 开放平台 API Key。推理耗时较长时可增加超时或修改模型 ID。' }),
    Object.freeze({ id: 'zhipu', provider: '智谱 BigModel', name: '智谱 GLM',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiType: 'chat', model: 'glm-5.2',
      docs: 'https://docs.bigmodel.cn/api-reference/模型-api/对话补全', note: '通用按量计费 API 地址；Coding Plan 的专用地址与额度不同，请勿混用。' }),
    Object.freeze({ id: 'siliconflow', provider: '硅基流动', name: 'SiliconFlow（自选模型）',
      baseUrl: 'https://api.siliconflow.cn/v1', apiType: 'chat', model: '',
      docs: 'https://docs.siliconflow.cn/docs/userguide/quickstart', note: '从控制台复制完整文本模型 ID（含组织前缀）；不同模型可用性及额度不同。' }),
    Object.freeze({ id: 'openrouter', provider: 'OpenRouter', name: 'OpenRouter（自选模型）',
      baseUrl: 'https://openrouter.ai/api/v1', apiType: 'chat', model: '',
      docs: 'https://openrouter.ai/docs/quickstart', note: '填写 OpenRouter 模型 ID，通常为 provider/model 格式；使用 OpenRouter API Key。不会自动切换其他模型。' }),
    Object.freeze({ id: 'ollama', provider: '本地服务', name: 'Ollama（本机）',
      baseUrl: 'http://localhost:11434/v1', apiType: 'chat', model: 'gpt-oss:20b', authMode: 'none',
      docs: 'https://docs.ollama.com/api/openai-compatibility', note: '先启动 Ollama 并下载模型，改为本机已安装的模型 ID。仅本机回环地址可免认证，不会自动安装或启动服务。' }),
    Object.freeze({ id: 'lm-studio', provider: '本地服务', name: 'LM Studio（本机）',
      baseUrl: 'http://localhost:1234/v1', apiType: 'chat', model: '', authMode: 'none',
      docs: 'https://lmstudio.ai/docs/developer/openai-compat', note: '先启动 LM Studio API Server，并填写已加载的模型 ID；若服务启用认证，请切换到 API Key。' }),
    Object.freeze({
      id: 'ark-deepseek', provider: '火山方舟', name: 'DeepSeek V4 Flash（火山方舟）', apiType: 'chat',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
      model: 'deepseek-v4-flash-ga-260731',
      note: '保留原有火山方舟预设。请填写实际 ARK API Key，并确认此模型 ID 在账户中可用。',
    }),
    Object.freeze({
      id: 'ark-doubao', provider: '火山方舟', name: '豆包 Seed 2.1 Pro（火山方舟）', apiType: 'responses',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3/responses',
      model: 'doubao-seed-2-1-pro-260628',
      note: '保留原有豆包 Responses 预设。请使用有相应模型权限的火山方舟 API Key。',
    }),
  ]);
  const normalizeUrl = url => String(url || '').trim().replace(/\/+$/, '');
  function findPreset(config) {
    return presets.find(p => p.model && p.model === config?.model && normalizeUrl(p.baseUrl) === normalizeUrl(config?.baseUrl) &&
      (!config?.apiType || config.apiType === 'auto' || config.apiType === p.apiType));
  }
  function sameOrigin(a, b) {
    try { return new URL(a).origin === new URL(b).origin; } catch (_) { return false; }
  }
  const api = { presets, findPreset, sameOrigin };
  root.ModelPresets = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
