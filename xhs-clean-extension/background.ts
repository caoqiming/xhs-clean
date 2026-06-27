import {
  LLM_SETTINGS_KEY,
  getProvider,
  normalizeLlmSettings,
  type LlmSettings
} from "./llm-config"
import {
  DEFAULT_REVIEW_PROMPT,
  EXTENSION_SETTINGS_KEY,
  normalizeExtensionSettings,
  type ExtensionSettings
} from "./extension-settings"

type ReviewComment = {
  id: string
  content: string
}

type AiReviewRequest = {
  type: "review-comments"
  comments: ReviewComment[]
}

type AiReviewResult = {
  id: string
  is_low_quality: boolean
}

type AiReviewResponse = {
  results: AiReviewResult[]
}

function getProviderRequestOptions(providerId: string): Record<string, unknown> {
  if (providerId === "zhipu") {
    return {
      thinking: {
        type: "disabled"
      }
    }
  }

  if (providerId === "qwen") {
    return {
      enable_thinking: false
    }
  }

  return {}
}

function getStoredSettings() {
  return new Promise<LlmSettings>((resolve) => {
    chrome.storage.local.get(LLM_SETTINGS_KEY, (items) => {
      resolve(normalizeLlmSettings(items[LLM_SETTINGS_KEY]))
    })
  })
}

function getStoredExtensionSettings() {
  return new Promise<ExtensionSettings>((resolve) => {
    chrome.storage.local.get(EXTENSION_SETTINGS_KEY, (items) => {
      resolve(normalizeExtensionSettings(items[EXTENSION_SETTINGS_KEY]))
    })
  })
}

function extractJson(content: string) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = fenced?.[1] ?? content
  const start = raw.indexOf("{")
  const end = raw.lastIndexOf("}")

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("AI 未返回 JSON")
  }

  return raw.slice(start, end + 1)
}

function getHttpErrorMessage(providerName: string, status: number, body: string) {
  if (providerName === "Ollama" && status === 403) {
    return [
      "Ollama 拒绝了扩展请求：403 Forbidden。",
      "这是 Ollama 的 Origin 白名单拦截，请重启 Ollama 并允许 chrome-extension:// 来源。",
      "macOS 可尝试：launchctl setenv OLLAMA_ORIGINS \"chrome-extension://*\"，然后重启 Ollama。",
      "也可以临时使用：OLLAMA_ORIGINS=\"chrome-extension://*\" ollama serve"
    ].join("\n")
  }

  return `AI 请求失败：${status} ${body.slice(0, 200)}`
}

async function reviewComments(comments: ReviewComment[]) {
  const settings = await getStoredSettings()
  const extensionSettings = await getStoredExtensionSettings()
  const provider = getProvider(settings.provider)
  const apiKey = (settings.apiKeys[provider.id] ?? "").replace(/\s+/g, "")

  if (provider.requiresApiKey !== false && !apiKey) {
    throw new Error(`请先在插件设置中填写 ${provider.name} 的 API Key`)
  }

  let response: Response

  try {
    response = await fetch(provider.baseUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: 0,
        ...getProviderRequestOptions(provider.id),
        response_format: {
          type: "json_object"
        },
        messages: [
          {
            role: "system",
            content: extensionSettings.reviewPrompt.trim() || DEFAULT_REVIEW_PROMPT
          },
          {
            role: "user",
            content: JSON.stringify({ comments }, null, 2)
          }
        ]
      })
    })
  } catch (error) {
    throw new Error(
      `AI 网络请求失败：${provider.name} ${provider.baseUrl}；${error instanceof Error ? error.message : "Failed to fetch"}。请检查网络代理、API Key 是否包含异常空白字符，并确认插件已重新加载。`
    )
  }

  if (!response.ok) {
    const body = await response.text()
    throw new Error(getHttpErrorMessage(provider.name, response.status, body))
  }

  const data = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string
      }
    }>
  }
  const content = data.choices?.[0]?.message?.content

  if (!content) {
    throw new Error("AI 响应为空")
  }

  const parsed = JSON.parse(extractJson(content)) as Partial<AiReviewResponse>

  return {
    results: (parsed.results ?? []).map((result) => ({
      id: String(result.id),
      is_low_quality: Boolean(result.is_low_quality)
    }))
  }
}

chrome.runtime.onMessage.addListener((message: AiReviewRequest, _sender, sendResponse) => {
  if (message?.type !== "review-comments") {
    return false
  }

  void reviewComments(message.comments)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error: unknown) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "AI 判断失败"
      })
    })

  return true
})
