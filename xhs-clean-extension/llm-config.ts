export type LlmProviderId = "zhipu" | "deepseek" | "qwen" | "moonshot" | "ollama"

export type LlmModel = {
  id: string
  name: string
}

export type LlmProvider = {
  id: LlmProviderId
  name: string
  baseUrl: string
  defaultModel: string
  models: LlmModel[]
  allowCustomModel?: boolean
  requiresApiKey?: boolean
}

export type LlmSettings = {
  provider: LlmProviderId
  model: string
  apiKeys: Partial<Record<LlmProviderId, string>>
}

export const LLM_SETTINGS_KEY = "xhsCleanLlmSettings"

export const LLM_PROVIDERS: LlmProvider[] = [
  {
    id: "zhipu",
    name: "智谱 AI",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    defaultModel: "glm-4.7-flash",
    models: [
      { id: "glm-4.7-flash", name: "GLM-4.7-Flash（默认，低价）" },
      { id: "glm-4-flash", name: "GLM-4-Flash" },
      { id: "glm-4-plus", name: "GLM-4-Plus" }
    ]
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/chat/completions",
    defaultModel: "deepseek-v4-flash",
    models: [
      { id: "deepseek-v4-flash", name: "DeepSeek-V4-Flash（默认）" },
      { id: "deepseek-chat", name: "deepseek-chat" },
      { id: "deepseek-reasoner", name: "deepseek-reasoner" }
    ]
  },
  {
    id: "qwen",
    name: "通义千问",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    defaultModel: "qwen-turbo",
    models: [
      { id: "qwen-turbo", name: "qwen-turbo（默认，低价）" },
      { id: "qwen-plus", name: "qwen-plus" },
      { id: "qwen-max", name: "qwen-max" }
    ]
  },
  {
    id: "moonshot",
    name: "Moonshot",
    baseUrl: "https://api.moonshot.cn/v1/chat/completions",
    defaultModel: "moonshot-v1-8k",
    models: [
      { id: "moonshot-v1-8k", name: "moonshot-v1-8k（默认，低价）" },
      { id: "moonshot-v1-32k", name: "moonshot-v1-32k" },
      { id: "moonshot-v1-128k", name: "moonshot-v1-128k" }
    ]
  },
  {
    id: "ollama",
    name: "Ollama",
    baseUrl: "http://localhost:11434/v1/chat/completions",
    defaultModel: "llama3.1",
    allowCustomModel: true,
    requiresApiKey: false,
    models: [
      { id: "llama3.1", name: "llama3.1（默认）" },
      { id: "qwen2.5", name: "qwen2.5" },
      { id: "gemma3", name: "gemma3" }
    ]
  }
]

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  provider: "zhipu",
  model: "glm-4.7-flash",
  apiKeys: {}
}

export function getProvider(providerId: string) {
  return (
    LLM_PROVIDERS.find((provider) => provider.id === providerId) ??
    LLM_PROVIDERS[0]
  )
}

export function normalizeLlmSettings(settings?: Partial<LlmSettings>): LlmSettings {
  const provider = getProvider(settings?.provider ?? DEFAULT_LLM_SETTINGS.provider)
  const model =
    settings?.model &&
    (provider.allowCustomModel || provider.models.some((item) => item.id === settings.model))
      ? settings.model
      : provider.defaultModel
  const legacyApiKey =
    typeof (settings as Partial<LlmSettings> & { apiKey?: unknown })?.apiKey === "string"
      ? (settings as Partial<LlmSettings> & { apiKey?: string }).apiKey
      : ""
  const apiKeys =
    settings?.apiKeys && typeof settings.apiKeys === "object"
      ? { ...settings.apiKeys }
      : {}

  if (legacyApiKey && !apiKeys[provider.id]) {
    apiKeys[provider.id] = legacyApiKey
  }

  return {
    provider: provider.id,
    model,
    apiKeys
  }
}
