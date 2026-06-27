export type LowQualityAction = "mask" | "delete"

export type ExtensionSettings = {
  enabled: boolean
  showDebugPanel: boolean
  reviewPrompt: string
  maskBeforeReview: boolean
  onlyRelatedComments: boolean
  aiReviewBatchSize: number
  aiReviewConcurrency: number
  currentUserLowQualityAction: LowQualityAction
}

export const EXTENSION_SETTINGS_KEY = "xhsCleanExtensionSettings"

export const DEFAULT_REVIEW_PROMPT = `你是一个中文社区评论审核助手，任务是判断小红书评论是否属于“低素质评论”。

“低素质评论”包括但不限于：
- 人身攻击、辱骂、阴阳怪气、挑衅、嘲讽、恶意贬低。
- 性骚扰、低俗色情、恶意凝视、令人不适的身体评价。
- 仇恨、歧视、地域黑、性别攻击、群体攻击。
- 引战、恶意抬杠、明显破坏讨论氛围的攻击性表达。
- 垃圾广告、引流、诈骗、刷屏、无意义重复内容。
- 对作者或其他评论者的恶意揣测、造谣、威胁、诅咒。

不要把以下内容误判为低素质：
- 普通负面反馈、理性反对、礼貌纠错。
- 中性吐槽、自嘲、玩梗、轻微口语化表达。
- 与笔记内容相关的正常争议。

输入是一组 JSON 评论，每条包含：
- id: 评论 ID
- content: 评论正文

请输出严格 JSON，不要包含 Markdown，不要解释规则。格式如下：

{
  "results": [
    {
      "id": "评论 ID",
      "is_low_quality": true
    }
  ]
}

要求：
- 每条输入评论都必须有一条结果，id 必须与输入完全一致。
- 不要输出多余字段。
`

export const DEFAULT_EXTENSION_SETTINGS: ExtensionSettings = {
  enabled: true,
  showDebugPanel: false,
  reviewPrompt: DEFAULT_REVIEW_PROMPT,
  maskBeforeReview: true,
  onlyRelatedComments: false,
  aiReviewBatchSize: 20,
  aiReviewConcurrency: 1,
  currentUserLowQualityAction: "mask"
}

function normalizePositiveInteger(value: unknown, fallback: number) {
  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN

  if (!Number.isFinite(numberValue) || numberValue < 1) {
    return fallback
  }

  return Math.floor(numberValue)
}

export function normalizeExtensionSettings(
  settings?: Partial<ExtensionSettings>
): ExtensionSettings {
  return {
    enabled: settings?.enabled ?? DEFAULT_EXTENSION_SETTINGS.enabled,
    showDebugPanel:
      settings?.showDebugPanel ?? DEFAULT_EXTENSION_SETTINGS.showDebugPanel,
    reviewPrompt:
      typeof settings?.reviewPrompt === "string"
        ? settings.reviewPrompt
        : DEFAULT_EXTENSION_SETTINGS.reviewPrompt,
    maskBeforeReview:
      settings?.maskBeforeReview ?? DEFAULT_EXTENSION_SETTINGS.maskBeforeReview,
    onlyRelatedComments:
      settings?.onlyRelatedComments ?? DEFAULT_EXTENSION_SETTINGS.onlyRelatedComments,
    aiReviewBatchSize: normalizePositiveInteger(
      settings?.aiReviewBatchSize,
      DEFAULT_EXTENSION_SETTINGS.aiReviewBatchSize
    ),
    aiReviewConcurrency: normalizePositiveInteger(
      settings?.aiReviewConcurrency,
      DEFAULT_EXTENSION_SETTINGS.aiReviewConcurrency
    ),
    currentUserLowQualityAction:
      settings?.currentUserLowQualityAction === "delete"
        ? "delete"
        : DEFAULT_EXTENSION_SETTINGS.currentUserLowQualityAction
  }
}
