import { useEffect, useMemo, useState } from "react"

import {
  DEFAULT_LLM_SETTINGS,
  LLM_PROVIDERS,
  LLM_SETTINGS_KEY,
  getProvider,
  normalizeLlmSettings,
  type LlmProviderId,
  type LlmSettings
} from "./llm-config"
import {
  DEFAULT_REVIEW_PROMPT,
  DEFAULT_EXTENSION_SETTINGS,
  EXTENSION_SETTINGS_KEY,
  normalizeExtensionSettings,
  type ExtensionSettings,
  type LowQualityAction
} from "./extension-settings"

const OLLAMA_TAGS_URL = "http://localhost:11434/api/tags"

type OllamaTagsResponse = {
  models?: Array<{
    name?: string
    model?: string
  }>
}

function IndexPopup() {
  const [llmSettings, setLlmSettings] = useState<LlmSettings>(DEFAULT_LLM_SETTINGS)
  const [extensionSettings, setExtensionSettings] = useState<ExtensionSettings>(
    DEFAULT_EXTENSION_SETTINGS
  )
  const [status, setStatus] = useState("")
  const [ollamaModels, setOllamaModels] = useState<string[]>([])
  const [ollamaModelsLoading, setOllamaModelsLoading] = useState(false)
  const [ollamaModelsError, setOllamaModelsError] = useState("")
  const [ollamaManualModelInput, setOllamaManualModelInput] = useState(false)

  const currentProvider = useMemo(
    () => getProvider(llmSettings.provider),
    [llmSettings.provider]
  )

  useEffect(() => {
    chrome.storage.local.get([LLM_SETTINGS_KEY, EXTENSION_SETTINGS_KEY], (items) => {
      setLlmSettings(normalizeLlmSettings(items[LLM_SETTINGS_KEY]))
      setExtensionSettings(normalizeExtensionSettings(items[EXTENSION_SETTINGS_KEY]))
    })
  }, [])

  const updateLlmSettings = (nextSettings: LlmSettings) => {
    setLlmSettings(nextSettings)
    chrome.storage.local.set(
      {
        [LLM_SETTINGS_KEY]: nextSettings
      },
      () => {
        setStatus("已保存")
        window.setTimeout(() => setStatus(""), 1500)
      }
    )
  }

  const loadOllamaModels = async () => {
    setOllamaModelsLoading(true)
    setOllamaModelsError("")

    try {
      const response = await fetch(OLLAMA_TAGS_URL)

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`)
      }

      const data = (await response.json()) as OllamaTagsResponse
      const modelNames = Array.from(
        new Set(
          (data.models ?? [])
            .map((model) => model.name ?? model.model)
            .filter((name): name is string => Boolean(name))
        )
      ).sort((left, right) => left.localeCompare(right))

      setOllamaModels(modelNames)
    } catch (error) {
      setOllamaModels([])
      setOllamaModelsError(
        error instanceof Error
          ? `无法获取 Ollama 模型：${error.message}`
          : "无法获取 Ollama 模型"
      )
    } finally {
      setOllamaModelsLoading(false)
    }
  }

  const updateExtensionSettings = (nextSettings: ExtensionSettings) => {
    const normalizedSettings = normalizeExtensionSettings(nextSettings)

    setExtensionSettings(normalizedSettings)
    chrome.storage.local.set(
      {
        [EXTENSION_SETTINGS_KEY]: normalizedSettings
      },
      () => {
        setStatus("已保存")
        window.setTimeout(() => setStatus(""), 1500)
      }
    )
  }

  const changeProvider = (providerId: LlmProviderId) => {
    const provider = getProvider(providerId)
    setOllamaManualModelInput(false)
    updateLlmSettings({
      ...llmSettings,
      provider: provider.id,
      model: provider.defaultModel
    })
  }

  useEffect(() => {
    if (llmSettings.provider !== "ollama") {
      return
    }

    void loadOllamaModels()
  }, [llmSettings.provider])

  const showOllamaModelSelect =
    currentProvider.id === "ollama" &&
    ollamaModels.length > 0 &&
    !ollamaManualModelInput
  const currentApiKey = llmSettings.apiKeys[currentProvider.id] ?? ""

  return (
    <div
      style={{
        width: 380,
        padding: 16,
        color: "#222",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
      }}>
      <h2 style={{ margin: "0 0 12px", fontSize: 18 }}>XHS Clean 设置</h2>

      <section style={{ display: "grid", gap: 10, marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>功能设置</h3>

        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={extensionSettings.enabled}
            onChange={(event) =>
              updateExtensionSettings({
                ...extensionSettings,
                enabled: event.target.checked
              })
            }
          />
          <span>启用自动检测</span>
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={extensionSettings.showDebugPanel}
            onChange={(event) =>
              updateExtensionSettings({
                ...extensionSettings,
                showDebugPanel: event.target.checked
              })
            }
          />
          <span>显示调试悬浮窗口</span>
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={extensionSettings.maskBeforeReview}
            onChange={(event) =>
              updateExtensionSettings({
                ...extensionSettings,
                maskBeforeReview: event.target.checked
              })
            }
          />
          <span>检测完成前遮挡评论</span>
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={extensionSettings.onlyRelatedComments}
            onChange={(event) =>
              updateExtensionSettings({
                ...extensionSettings,
                onlyRelatedComments: event.target.checked
              })
            }
          />
          <span>仅检测回复我的评论和我的笔记下的评论</span>
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontWeight: 600 }}>单次 AI 请求最多评论数</span>
          <input
            type="number"
            min={1}
            step={1}
            value={extensionSettings.aiReviewBatchSize}
            onChange={(event) =>
              updateExtensionSettings({
                ...extensionSettings,
                aiReviewBatchSize: event.target.valueAsNumber
              })
            }
            style={{ padding: 8, border: "1px solid #ddd", borderRadius: 6 }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontWeight: 600 }}>同时进行中的 AI 请求数</span>
          <input
            type="number"
            min={1}
            step={1}
            value={extensionSettings.aiReviewConcurrency}
            onChange={(event) =>
              updateExtensionSettings({
                ...extensionSettings,
                aiReviewConcurrency: event.target.valueAsNumber
              })
            }
            style={{ padding: 8, border: "1px solid #ddd", borderRadius: 6 }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontWeight: 600 }}>当前用户笔记低素质评论处理</span>
          <select
            value={extensionSettings.currentUserLowQualityAction}
            onChange={(event) =>
              updateExtensionSettings({
                ...extensionSettings,
                currentUserLowQualityAction: event.target.value as LowQualityAction
              })
            }
            style={{ padding: 8, border: "1px solid #ddd", borderRadius: 6 }}>
            <option value="mask">遮挡</option>
            <option value="delete">删除</option>
          </select>
          <span style={{ color: "#777", fontSize: 12 }}>
            不勾选时会检测全部捕获到的评论；非当前用户笔记上的评论不会显示删除操作。
          </span>
        </label>
      </section>

      <section style={{ display: "grid", gap: 10, marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8
          }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>审核 Prompt</h3>
          <button
            onClick={() =>
              updateExtensionSettings({
                ...extensionSettings,
                reviewPrompt: DEFAULT_REVIEW_PROMPT
              })
            }
            style={{
              border: "1px solid #ddd",
              borderRadius: 6,
              background: "#fff",
              cursor: "pointer",
              padding: "5px 10px"
            }}>
            Reset
          </button>
        </div>
        <textarea
          value={extensionSettings.reviewPrompt}
          onChange={(event) =>
            updateExtensionSettings({
              ...extensionSettings,
              reviewPrompt: event.target.value
            })
          }
          rows={8}
          style={{
            resize: "vertical",
            padding: 8,
            border: "1px solid #ddd",
            borderRadius: 6,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 12,
            lineHeight: 1.45
          }}
        />
      </section>

      <section style={{ borderTop: "1px solid #eee", paddingTop: 14 }}>
        <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>LLM 设置</h3>

        <label style={{ display: "grid", gap: 6, marginBottom: 12 }}>
          <span style={{ fontWeight: 600 }}>LLM 服务商</span>
          <select
            value={llmSettings.provider}
            onChange={(event) => changeProvider(event.target.value as LlmProviderId)}
            style={{ padding: 8, border: "1px solid #ddd", borderRadius: 6 }}>
            {LLM_PROVIDERS.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "grid", gap: 6, marginBottom: 12 }}>
          <span style={{ fontWeight: 600 }}>模型</span>
          {currentProvider.allowCustomModel ? (
            <>
              <div style={{ display: "flex", gap: 8 }}>
                {showOllamaModelSelect ? (
                  <select
                    value={llmSettings.model}
                    onChange={(event) => {
                      if (event.target.value === "__manual__") {
                        setOllamaManualModelInput(true)
                        return
                      }

                      updateLlmSettings({
                        ...llmSettings,
                        model: event.target.value
                      })
                    }}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      padding: 8,
                      border: "1px solid #ddd",
                      borderRadius: 6
                    }}>
                    {llmSettings.model && !ollamaModels.includes(llmSettings.model) ? (
                      <option value={llmSettings.model}>
                        {llmSettings.model}（当前手动值）
                      </option>
                    ) : null}
                    {ollamaModels.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                    <option value="__manual__">手动输入...</option>
                  </select>
                ) : (
                  <input
                    type="text"
                    value={llmSettings.model}
                    placeholder={currentProvider.defaultModel}
                    onChange={(event) =>
                      updateLlmSettings({
                        ...llmSettings,
                        model: event.target.value
                      })
                    }
                    style={{
                      flex: 1,
                      minWidth: 0,
                      padding: 8,
                      border: "1px solid #ddd",
                      borderRadius: 6
                    }}
                  />
                )}
                {currentProvider.id === "ollama" ? (
                  <button
                    type="button"
                    disabled={ollamaModelsLoading}
                    onClick={() => void loadOllamaModels()}
                    style={{
                      border: "1px solid #ddd",
                      borderRadius: 6,
                      background: "#fff",
                      cursor: ollamaModelsLoading ? "not-allowed" : "pointer",
                      padding: "0 10px",
                      whiteSpace: "nowrap"
                    }}>
                    {ollamaModelsLoading ? "获取中" : "刷新"}
                  </button>
                ) : null}
                {currentProvider.id === "ollama" &&
                ollamaModels.length > 0 &&
                ollamaManualModelInput ? (
                  <button
                    type="button"
                    onClick={() => setOllamaManualModelInput(false)}
                    style={{
                      border: "1px solid #ddd",
                      borderRadius: 6,
                      background: "#fff",
                      cursor: "pointer",
                      padding: "0 10px",
                      whiteSpace: "nowrap"
                    }}>
                    选择
                  </button>
                ) : null}
              </div>
              <span style={{ color: "#777", fontSize: 12 }}>
                {currentProvider.id === "ollama"
                  ? ollamaModelsLoading
                    ? "正在从本机 Ollama 获取模型列表..."
                    : ollamaModels.length > 0
                      ? `已获取 ${ollamaModels.length} 个本机模型，可选择或切换手动输入。`
                      : "填写本机 Ollama 中已拉取的模型名，例如 llama3.1、qwen2.5。"
                  : "可手动填写模型名。"}
              </span>
              {ollamaModelsError ? (
                <span style={{ color: "#b42318", fontSize: 12 }}>
                  {ollamaModelsError}，请确认 Ollama 已启动。
                </span>
              ) : null}
              {currentProvider.id === "ollama" ? (
                <span style={{ color: "#777", fontSize: 12, lineHeight: 1.5 }}>
                  如果审核时报 403，请设置 OLLAMA_ORIGINS="chrome-extension://*"
                  后重启 Ollama。
                </span>
              ) : null}
            </>
          ) : (
            <select
              value={llmSettings.model}
              onChange={(event) =>
                updateLlmSettings({
                  ...llmSettings,
                  model: event.target.value
                })
              }
              style={{ padding: 8, border: "1px solid #ddd", borderRadius: 6 }}>
              {currentProvider.models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          )}
        </label>

        {currentProvider.requiresApiKey === false ? null : (
          <label style={{ display: "grid", gap: 6, marginBottom: 12 }}>
            <span style={{ fontWeight: 600 }}>{currentProvider.name} API Key</span>
            <input
              type="password"
              value={currentApiKey}
              placeholder={`填入 ${currentProvider.name} 的 API Key`}
              onChange={(event) =>
                updateLlmSettings({
                  ...llmSettings,
                  apiKeys: {
                    ...llmSettings.apiKeys,
                    [currentProvider.id]: event.target.value
                  }
                })
              }
              style={{ padding: 8, border: "1px solid #ddd", borderRadius: 6 }}
            />
          </label>
        )}

      </section>
      {status ? <div style={{ marginTop: 8, color: "#237804" }}>{status}</div> : null}
    </div>
  )
}

export default IndexPopup
