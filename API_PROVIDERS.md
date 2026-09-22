# Exam Helper API provider notes

Exam Helper 1.5 supports four request contracts:

| Interface type | Request path | Authentication | Built-in examples |
| --- | --- | --- | --- |
| OpenAI Chat Completions | `/chat/completions` | `Authorization: Bearer` | OpenAI, DeepSeek, Qwen, Kimi, GLM, SiliconFlow, OpenRouter, Ollama, LM Studio, Ark DeepSeek |
| OpenAI Responses | `/responses` | `Authorization: Bearer` | OpenAI, Ark Doubao |
| Anthropic Messages | `/messages` | `x-api-key` and `anthropic-version` | Claude |
| Gemini native | `/models/{model}:generateContent` | `x-goog-api-key` | Google Gemini |

Presets are editable examples, not a guarantee of account access, pricing, regional availability, or a model's continued existence. Always copy an available model ID from the provider console. No API key is bundled with a preset.

Official references checked for this integration:

- [OpenAI Responses](https://developers.openai.com/api/reference/resources/responses/methods/create) and [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
- [Claude Messages API](https://platform.claude.com/docs/en/build-with-claude/working-with-messages)
- [Gemini generateContent](https://ai.google.dev/api/generate-content)
- [DeepSeek API](https://api-docs.deepseek.com/)
- [Alibaba Model Studio OpenAI compatibility](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope)
- [Kimi API quickstart](https://platform.kimi.com/docs/get-api-key)
- [Zhipu Chat Completions](https://docs.bigmodel.cn/api-reference/模型-api/对话补全)
- [SiliconFlow quickstart](https://docs.siliconflow.cn/docs/userguide/quickstart)
- [OpenRouter quickstart](https://openrouter.ai/docs/quickstart)
- [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)
- [LM Studio OpenAI compatibility](https://lmstudio.ai/docs/developer/openai-compat)

Security behavior:

- Remote APIs must use HTTPS. Plain HTTP and no-auth mode are accepted only for `localhost`, `127.0.0.1`, or `[::1]`.
- Keys in URL query parameters are rejected. Secrets are sent only through the header required by the selected interface.
- Model credentials are stored in device-local extension storage. On upgrade, legacy synchronized credentials are copied locally and removed from sync storage after a successful copy.
- The connection test sends only a fixed JSON probe and may incur a small provider charge. It never sends page or question content.
- Provider error bodies and API keys are not copied to the activity log.
