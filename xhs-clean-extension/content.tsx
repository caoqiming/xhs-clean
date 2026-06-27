import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  DEFAULT_EXTENSION_SETTINGS,
  EXTENSION_SETTINGS_KEY,
  normalizeExtensionSettings,
  type ExtensionSettings
} from "./extension-settings"
import {
  DEFAULT_LLM_SETTINGS,
  LLM_SETTINGS_KEY,
  normalizeLlmSettings,
  type LlmSettings
} from "./llm-config"

export const config = {
  matches: ["https://*.xiaohongshu.com/*", "https://edith.xiaohongshu.com/*"]
}

const MENTIONS_EVENT = "xhs-clean-extension:mentions"
const CLEAR_MESSAGES_EVENT = "xhs-clean-extension:clear-messages"
const DELETE_REQUEST_EVENT = "xhs-clean-extension:delete-request"
const DELETE_RESULT_EVENT = "xhs-clean-extension:delete-result"
const AI_REVIEW_RESULTS_STORAGE_KEY = "xhsCleanAiReviewResults"
const MASK_STYLE_ID = "xhs-clean-mask-style"
const AI_REVIEW_TIMEOUT_MS = 30_000
const OLLAMA_AI_REVIEW_TIMEOUT_MS = 180_000
const AI_REVIEW_MAX_ATTEMPTS = 10
const AI_REVIEW_RETRY_BASE_DELAY_MS = 1000
const AI_REVIEW_STALE_GRACE_MS = 60_000
const AI_REVIEW_STALE_CHECK_INTERVAL_MS = 30_000

type MentionMessage = {
  id?: string
  title?: string
  time?: number
  capture_source?: string
  is_notification_message?: boolean
  user_info?: {
    nickname?: string
    userid?: string
    user_id?: string
  }
  item_info?: {
    id?: string
    content?: string
    user_info?: {
      nickname?: string
      userid?: string
      user_id?: string
    }
  }
  comment_info?: {
    id?: string
    content?: string
    status?: number
    illegal_info?: {
      desc?: string
      illegal_status?: string
    }
  }
  current_user_id?: string
  is_current_user_note?: boolean
}

type MentionsEventDetail = {
  messages: MentionMessage[]
  source: string
}

type DeleteRequestEventDetail = {
  requestId: string
  noteId: string
  commentId: string
}

type DeleteResultEventDetail = {
  requestId: string
  ok: boolean
  status?: number
  error?: string
}

type AiReviewResult = {
  id: string
  is_low_quality: boolean
}

type StoredCommentRecord = {
  id: string
  is_low_quality?: boolean
  reviewStartedAt?: number
  reviewedAt?: number
  reviewFailedAt?: number
  reviewError?: string
  reviewAttemptCount?: number
  deleted?: boolean
  deletedAt?: number
}

type ReviewableComment = {
  key: string
  commentId?: string
  noteId?: string
  content: string
  isCurrentUserNote: boolean
  message: MentionMessage
  index: number
}

type MaskedNotificationComment = {
  key: string
  label: string
  content: string
  nickname?: string
}

type AiReviewMessageResponse =
  | {
      ok: true
      result: {
        results: AiReviewResult[]
      }
    }
  | {
      ok: false
      error: string
      attempts?: number
    }

type AiReviewAttemptChange = {
  attempt: number
  commentIds: string[]
}

type AiReviewCommentInput = Record<string, string | undefined>

function getMissingCommentIdError(message: MentionMessage, source?: string) {
  const details = JSON.stringify(
    {
      source,
      message_id: message.id,
      title: message.title,
      time: message.time,
      nickname: message.user_info?.nickname,
      note_id: message.item_info?.id,
      content: message.comment_info?.content
    },
    null,
    2
  )

  return `捕获到缺少 comment_id 的评论消息，请排查接口数据：\n${details}`
}

function reportMissingCommentId(message: MentionMessage, source?: string) {
  const errorMessage = getMissingCommentIdError(message, source)

  window.alert(errorMessage)

  return errorMessage
}

function getMessageKey(message: MentionMessage) {
  const commentId = message.comment_info?.id

  if (commentId) {
    return commentId
  }

  throw new Error(reportMissingCommentId(message, message.capture_source))
}

function getCommentIdFromMessageKey(messageKey: string) {
  return messageKey || undefined
}

function formatTime(time?: number) {
  if (!time) {
    return ""
  }

  return new Date(time * 1000).toLocaleString()
}

function formatDateTime(time?: number) {
  if (!time) {
    return ""
  }

  return new Date(time).toLocaleString()
}

function mergeMessages(current: MentionMessage[], incoming: MentionMessage[]) {
  const merged = new Map<string, MentionMessage>()

  for (const message of current) {
    merged.set(getMessageKey(message), message)
  }

  for (const message of incoming) {
    const key = getMessageKey(message)
    const existingMessage = merged.get(key)

    merged.set(key, {
      ...existingMessage,
      ...message,
      is_notification_message:
        existingMessage?.is_notification_message === true ||
        message.is_notification_message === true
    })
  }

  return Array.from(merged.values())
}

function addSetItems(current: Set<string>, items: string[]) {
  let changed = false
  const next = new Set(current)

  for (const item of items) {
    if (!next.has(item)) {
      changed = true
      next.add(item)
    }
  }

  return changed ? next : current
}

function deleteSetItems(current: Set<string>, items: string[]) {
  let changed = false
  const next = new Set(current)

  for (const item of items) {
    if (next.delete(item)) {
      changed = true
    }
  }

  return changed ? next : current
}

function getInitialPanelPosition() {
  if (typeof window === "undefined") {
    return { x: 16, y: 16 }
  }

  return {
    x: Math.max(16, window.innerWidth - 536),
    y: Math.max(16, window.innerHeight - Math.min(window.innerHeight * 0.82, 720) - 16)
  }
}

function clampPanelPosition(position: { x: number; y: number }) {
  if (typeof window === "undefined") {
    return position
  }

  return {
    x: Math.min(Math.max(0, position.x), Math.max(0, window.innerWidth - 80)),
    y: Math.min(Math.max(0, position.y), Math.max(0, window.innerHeight - 48))
  }
}

function getStoredLlmSettings() {
  return new Promise<LlmSettings>((resolve) => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      resolve(DEFAULT_LLM_SETTINGS)
      return
    }

    try {
      chrome.storage.local.get(LLM_SETTINGS_KEY, (items) => {
        if (chrome.runtime.lastError) {
          resolve(DEFAULT_LLM_SETTINGS)
          return
        }

        resolve(normalizeLlmSettings(items[LLM_SETTINGS_KEY]))
      })
    } catch {
      resolve(DEFAULT_LLM_SETTINGS)
    }
  })
}

async function getAiReviewTimeoutMs() {
  const llmSettings = await getStoredLlmSettings()

  return llmSettings.provider === "ollama"
    ? OLLAMA_AI_REVIEW_TIMEOUT_MS
    : AI_REVIEW_TIMEOUT_MS
}

function getAiReviewStaleTimeoutMs(timeoutMs: number) {
  let retryDelayTotalMs = 0

  for (let attempt = 1; attempt < AI_REVIEW_MAX_ATTEMPTS; attempt += 1) {
    retryDelayTotalMs += getRetryDelayMs(attempt)
  }

  return timeoutMs * AI_REVIEW_MAX_ATTEMPTS + retryDelayTotalMs + AI_REVIEW_STALE_GRACE_MS
}

function getAiReviewOrphanedPendingTimeoutMs(timeoutMs: number) {
  return timeoutMs + AI_REVIEW_STALE_GRACE_MS
}

async function sendAiReview(comments: AiReviewCommentInput[]) {
  const timeoutMs = await getAiReviewTimeoutMs()

  return new Promise<AiReviewMessageResponse>((resolve) => {
    let settled = false
    const timeoutId = window.setTimeout(() => {
      settled = true
      resolve({
        ok: false,
        error: `AI 判断超时（${Math.round(timeoutMs / 1000)} 秒），请检查扩展后台、网络或模型服务`
      })
    }, timeoutMs)
    const finish = (response: AiReviewMessageResponse) => {
      if (settled) {
        return
      }

      settled = true
      window.clearTimeout(timeoutId)
      resolve(response)
    }

    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
      finish({
        ok: false,
        error: "无法连接扩展后台，请确认插件已重新加载"
      })
      return
    }

    try {
      chrome.runtime.sendMessage(
        {
          type: "review-comments",
          comments
        },
        (response: AiReviewMessageResponse | undefined) => {
          const runtimeError = chrome.runtime.lastError

          if (runtimeError) {
            finish({
              ok: false,
              error: runtimeError.message ?? "AI 判断失败"
            })
            return
          }

          finish(
            response ?? {
              ok: false,
              error: "AI 判断无响应"
            }
          )
        }
      )
    } catch (error) {
      finish({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "扩展上下文已失效，请重新加载页面"
      })
    }
  })
}

function getStoredExtensionSettings() {
  return new Promise<ExtensionSettings>((resolve) => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      resolve(DEFAULT_EXTENSION_SETTINGS)
      return
    }

    try {
      chrome.storage.local.get(EXTENSION_SETTINGS_KEY, (items) => {
        if (chrome.runtime.lastError) {
          resolve(DEFAULT_EXTENSION_SETTINGS)
          return
        }

        resolve(normalizeExtensionSettings(items[EXTENSION_SETTINGS_KEY]))
      })
    } catch {
      resolve(DEFAULT_EXTENSION_SETTINGS)
    }
  })
}

function saveExtensionSettings(settings: ExtensionSettings) {
  return new Promise<void>((resolve) => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      resolve()
      return
    }

    try {
      chrome.storage.local.set(
        {
          [EXTENSION_SETTINGS_KEY]: normalizeExtensionSettings(settings)
        },
        () => resolve()
      )
    } catch {
      resolve()
    }
  })
}

function getStoredAiReviewResults() {
  return new Promise<Record<string, StoredCommentRecord>>((resolve) => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      resolve({})
      return
    }

    try {
      chrome.storage.local.get(AI_REVIEW_RESULTS_STORAGE_KEY, (items) => {
        if (chrome.runtime.lastError) {
          resolve({})
          return
        }

        resolve(items[AI_REVIEW_RESULTS_STORAGE_KEY] ?? {})
      })
    } catch {
      resolve({})
    }
  })
}

function saveStoredAiReviewResults(results: Record<string, StoredCommentRecord>) {
  return new Promise<void>((resolve) => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      resolve()
      return
    }

    const entries = Object.entries(results)
      .sort(
        ([, left], [, right]) =>
          Math.max(
            right.reviewedAt ?? 0,
            right.deletedAt ?? 0,
            right.reviewStartedAt ?? 0,
            right.reviewFailedAt ?? 0
          ) -
          Math.max(
            left.reviewedAt ?? 0,
            left.deletedAt ?? 0,
            left.reviewStartedAt ?? 0,
            left.reviewFailedAt ?? 0
          )
      )
      .slice(0, 2000)

    try {
      chrome.storage.local.set(
        {
          [AI_REVIEW_RESULTS_STORAGE_KEY]: Object.fromEntries(entries)
        },
        () => resolve()
      )
    } catch {
      resolve()
    }
  })
}

function clearStoredAiReviewResults() {
  return new Promise<void>((resolve) => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      resolve()
      return
    }

    try {
      chrome.storage.local.remove(AI_REVIEW_RESULTS_STORAGE_KEY, () => resolve())
    } catch {
      resolve()
    }
  })
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function getRetryDelayMs(attempt: number) {
  return AI_REVIEW_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1)
}

function hasAiReviewResult(result?: StoredCommentRecord) {
  return typeof result?.is_low_quality === "boolean"
}

function hasTerminalReviewResult(result?: StoredCommentRecord) {
  return hasAiReviewResult(result) || result?.deleted === true
}

function mergeStoredCommentRecord(
  current: StoredCommentRecord | undefined,
  incoming: StoredCommentRecord
) {
  if (!current) {
    return incoming
  }

  // Terminal states must not be overwritten by older pending writes from scroll-triggered effects.
  if (current.deleted && !incoming.deleted) {
    return current
  }

  if (hasAiReviewResult(current) && !hasAiReviewResult(incoming)) {
    return current
  }

  return {
    ...current,
    ...incoming
  }
}

function mergeAiReviewResults(
  current: Record<string, StoredCommentRecord>,
  incoming: Record<string, StoredCommentRecord>
) {
  const merged: Record<string, StoredCommentRecord> = { ...current }

  for (const [key, incomingRecord] of Object.entries(incoming)) {
    merged[key] = mergeStoredCommentRecord(merged[key], incomingRecord)
  }

  return merged
}

async function saveMergedAiReviewResults(
  incoming: Record<string, StoredCommentRecord>
) {
  const storedResults = await getStoredAiReviewResults()
  const mergedResults = mergeAiReviewResults(storedResults, incoming)

  await saveStoredAiReviewResults(mergedResults)

  return mergedResults
}

function isAiReviewPending(
  result: StoredCommentRecord | undefined,
  now: number,
  staleTimeoutMs: number
) {
  return Boolean(
    result?.reviewStartedAt &&
      !hasAiReviewResult(result) &&
      !result.reviewFailedAt &&
      now - result.reviewStartedAt <= staleTimeoutMs
  )
}

function canQueueAiReview(
  comment: ReviewableComment,
  results: Record<string, StoredCommentRecord>,
  options: {
    now: number
    orphanedPendingTimeoutMs: number
    inFlightKeys: Set<string>
    failedKeys: Set<string>
    deletedKeys: Set<string>
  }
) {
  const cachedResult = results[comment.key]

  return (
    !hasTerminalReviewResult(cachedResult) &&
    !cachedResult?.reviewFailedAt &&
    !isAiReviewPending(cachedResult, options.now, options.orphanedPendingTimeoutMs) &&
    !options.inFlightKeys.has(comment.key) &&
    !options.failedKeys.has(comment.key) &&
    !options.deletedKeys.has(comment.key)
  )
}

function releaseOrphanedPendingAiReviews(
  results: Record<string, StoredCommentRecord>,
  now: number,
  orphanedPendingTimeoutMs: number,
  inFlightKeys: Set<string>
) {
  const releasedKeys: string[] = []
  const nextResults: Record<string, StoredCommentRecord> = { ...results }

  for (const [key, result] of Object.entries(results)) {
    if (
      !result.reviewStartedAt ||
      hasAiReviewResult(result) ||
      result.reviewFailedAt ||
      inFlightKeys.has(key) ||
      now - result.reviewStartedAt <= orphanedPendingTimeoutMs
    ) {
      continue
    }

    releasedKeys.push(key)
    nextResults[key] = {
      ...result,
      id: result.id ?? key,
      reviewStartedAt: undefined,
      reviewError: "AI 检测超时，准备重新检测"
    }
  }

  return {
    results: nextResults,
    releasedKeys
  }
}

function isAiReviewTimedOut(
  result: StoredCommentRecord | undefined,
  now: number,
  staleTimeoutMs: number
) {
  return Boolean(
    result?.reviewStartedAt &&
      !hasAiReviewResult(result) &&
      !result.reviewFailedAt &&
      now - result.reviewStartedAt > staleTimeoutMs
  )
}

function markTimedOutAiReviews(
  results: Record<string, StoredCommentRecord>,
  now: number,
  staleTimeoutMs: number
) {
  const timedOutKeys: string[] = []
  const nextResults: Record<string, StoredCommentRecord> = { ...results }

  for (const [key, result] of Object.entries(results)) {
    if (!isAiReviewTimedOut(result, now, staleTimeoutMs)) {
      continue
    }

    timedOutKeys.push(key)
    nextResults[key] = {
      ...result,
      id: result.id ?? key,
      reviewFailedAt: now,
      reviewError: "AI 检测超时，请重新检测"
    }
  }

  return {
    results: nextResults,
    timedOutKeys
  }
}

function getStoredReviewFailedKeys(results: Record<string, StoredCommentRecord>) {
  return Object.entries(results)
    .filter(([, result]) => Boolean(result.reviewFailedAt) && !hasAiReviewResult(result))
    .map(([key]) => key)
}

async function sendAiReviewWithRetries(
  comments: AiReviewCommentInput[],
  maxAttempts = AI_REVIEW_MAX_ATTEMPTS,
  onAttempt?: (change: AiReviewAttemptChange) => void
) {
  const errors: string[] = []
  const resultsById = new Map<string, AiReviewResult>()
  let pendingComments = comments.filter((comment) => comment.id)
  let receivedSuccessfulResponse = false

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    onAttempt?.({
      attempt,
      commentIds: pendingComments.map((comment) => String(comment.id))
    })

    const response = await sendAiReview(pendingComments)

    if (response.ok === true) {
      receivedSuccessfulResponse = true
      const pendingIds = new Set(
        pendingComments.map((comment) => String(comment.id))
      )

      for (const result of response.result.results) {
        if (pendingIds.has(result.id)) {
          resultsById.set(result.id, result)
        }
      }

      pendingComments = pendingComments.filter(
        (comment) => !resultsById.has(String(comment.id))
      )

      if (pendingComments.length === 0) {
        return {
          ok: true as const,
          result: {
            results: comments
              .map((comment) => resultsById.get(String(comment.id)))
              .filter((result): result is AiReviewResult => Boolean(result))
          },
          attempts: attempt
        }
      }

      errors.push(
        `第 ${attempt} 次：AI 响应缺少评论结果：${pendingComments
          .map((comment) => comment.id)
          .join(", ")}`
      )
    } else {
      errors.push(`第 ${attempt} 次：${response.error}`)
    }

    if (attempt < maxAttempts) {
      await delay(getRetryDelayMs(attempt))
    }
  }

  if (receivedSuccessfulResponse) {
    return {
      ok: true as const,
      result: {
        results: comments
          .map((comment) => resultsById.get(String(comment.id)))
          .filter((result): result is AiReviewResult => Boolean(result))
      },
      attempts: maxAttempts
    }
  }

  return {
    ok: false as const,
    error: errors.join("\n"),
    attempts: maxAttempts
  }
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }

  return chunks
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
) {
  const results: R[] = new Array(items.length)
  let nextIndex = 0

  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex
        nextIndex += 1
        results[currentIndex] = await mapper(items[currentIndex], currentIndex)
      }
    }
  )

  await Promise.all(workers)

  return results
}

async function sendAiReviewInBatchesWithRetries(
  comments: AiReviewCommentInput[],
  options: {
    batchSize: number
    concurrency: number
    maxAttempts?: number
    onAttempt?: (change: AiReviewAttemptChange) => void
  }
) {
  const batchSize = Math.max(1, Math.floor(options.batchSize))
  const concurrency = Math.max(1, Math.floor(options.concurrency))
  const batches = chunkArray(comments, batchSize)
  const errors: string[] = []
  const resultsById = new Map<string, AiReviewResult>()

  await mapWithConcurrency(batches, concurrency, async (batch, batchIndex) => {
    const response = await sendAiReviewWithRetries(
      batch,
      options.maxAttempts ?? AI_REVIEW_MAX_ATTEMPTS,
      options.onAttempt
    )

    if (response.ok === false) {
      errors.push(`第 ${batchIndex + 1} 批：${response.error}`)
      return
    }

    for (const result of response.result.results) {
      resultsById.set(result.id, result)
    }
  })

  const results = comments
    .map((comment) => resultsById.get(String(comment.id)))
    .filter((result): result is AiReviewResult => Boolean(result))

  if (results.length > 0) {
    return {
      ok: true as const,
      result: {
        results
      }
    }
  }

  return {
    ok: false as const,
    error: errors.join("\n") || "AI 判断失败",
    attempts: options.maxAttempts ?? AI_REVIEW_MAX_ATTEMPTS
  }
}

async function markStoredCommentDeleted(messageKey: string) {
  const storedResults = await getStoredAiReviewResults()
  const current = storedResults[messageKey]
  const deletedAt = Date.now()
  const nextStoredResults: Record<string, StoredCommentRecord> = {
    ...storedResults,
    [messageKey]: {
      ...current,
      id: current?.id ?? messageKey,
      deleted: true,
      deletedAt
    }
  }

  await saveStoredAiReviewResults(nextStoredResults)

  return nextStoredResults[messageKey]
}

function isReviewableContent(content?: string) {
  const normalizedContent = content?.trim()

  return Boolean(
    normalizedContent &&
      normalizedContent !== "原评论已删除" &&
      normalizedContent !== "该评论已删除"
  )
}

function normalizeDomText(text?: string | null) {
  return text?.replace(/\s+/g, " ").trim() ?? ""
}

function toReviewableComment(
  message: MentionMessage,
  index: number
): ReviewableComment | null {
  const content = message.comment_info?.content

  if (!isReviewableContent(content)) {
    return null
  }

  return {
    key: getMessageKey(message),
    commentId: message.comment_info?.id,
    noteId: message.item_info?.id,
    content: content ?? "",
    isCurrentUserNote:
      message.is_current_user_note === true || message.title?.includes("你的笔记") === true,
    message,
    index
  }
}

function isReplyToCurrentUserComment(message: MentionMessage) {
  return message.title?.includes("回复了你的评论") === true
}

function isRelatedReviewableComment(comment: ReviewableComment) {
  return comment.isCurrentUserNote || isReplyToCurrentUserComment(comment.message)
}

function ensureMaskStyles() {
  if (typeof document === "undefined" || document.getElementById(MASK_STYLE_ID)) {
    return
  }

  const style = document.createElement("style")
  style.id = MASK_STYLE_ID
  style.textContent = `
#noteContainer .comments-container .comment-item[data-xhs-clean-mask] {
  position: relative !important;
}

#noteContainer .comments-container .comment-item[data-xhs-clean-mask]:not(:active) .content {
  filter: blur(6px);
  opacity: 0.36;
  user-select: none;
}

#noteContainer .comments-container .comment-item[data-xhs-clean-mask]:not(:active)::after {
  content: attr(data-xhs-clean-mask-label);
  position: absolute;
  left: 48px;
  right: 16px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 1;
  pointer-events: none;
  border-radius: 10px;
  padding: 8px 10px;
  background: rgba(0, 0, 0, 0.68);
  color: #fff;
  font-size: 12px;
  line-height: 1.4;
  text-align: center;
  box-sizing: border-box;
}

#noteContainer .comments-container .comment-item[data-xhs-clean-mask]:active .content {
  filter: none;
  opacity: 1;
  user-select: text;
}

#noteContainer .comments-container .comment-item[data-xhs-clean-mask]:active::after {
  opacity: 0;
}

.notification-page .tabs-content-container > .container[data-xhs-clean-mask] {
  position: relative !important;
}

.notification-page .tabs-content-container > .container[data-xhs-clean-mask]:not(:active) .interaction-content {
  filter: blur(6px);
  opacity: 0.36;
  user-select: none;
}

.notification-page .tabs-content-container > .container[data-xhs-clean-mask]:not(:active)::after {
  content: attr(data-xhs-clean-mask-label);
  position: absolute;
  left: 72px;
  right: 72px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 1;
  pointer-events: none;
  border-radius: 10px;
  padding: 8px 10px;
  background: rgba(0, 0, 0, 0.68);
  color: #fff;
  font-size: 12px;
  line-height: 1.4;
  text-align: center;
  box-sizing: border-box;
}

.notification-page .tabs-content-container > .container[data-xhs-clean-mask]:active .interaction-content {
  filter: none;
  opacity: 1;
  user-select: text;
}

.notification-page .tabs-content-container > .container[data-xhs-clean-mask]:active::after {
  opacity: 0;
}
`
  document.head.appendChild(style)
}

function getElementText(element: Element, selector: string) {
  return normalizeDomText(element.querySelector(selector)?.textContent)
}

function isNotificationElementForComment(
  element: HTMLElement,
  comment: MaskedNotificationComment
) {
  const content = normalizeDomText(comment.content)

  if (!content || getElementText(element, ".interaction-content") !== content) {
    return false
  }

  const nickname = normalizeDomText(comment.nickname)

  if (nickname && !getElementText(element, ".user-info").includes(nickname)) {
    return false
  }

  return true
}

function applyMaskedComments(
  maskedCommentLabels: Record<string, string>,
  maskedNotificationComments: MaskedNotificationComment[] = []
) {
  if (typeof document === "undefined") {
    return
  }

  ensureMaskStyles()

  const activeCommentIds = new Set(Object.keys(maskedCommentLabels))
  const activeNotificationKeys = new Set(
    maskedNotificationComments.map((comment) => comment.key)
  )

  for (const element of Array.from(
    document.querySelectorAll<HTMLElement>(
      '#noteContainer .comments-container .comment-item[id^="comment-"][data-xhs-clean-mask]'
    )
  )) {
    const commentId = element.id.replace(/^comment-/, "")

    if (!activeCommentIds.has(commentId)) {
      element.removeAttribute("data-xhs-clean-mask")
      element.removeAttribute("data-xhs-clean-mask-label")
    }
  }

  for (const [commentId, label] of Object.entries(maskedCommentLabels)) {
    const element = document.getElementById(`comment-${commentId}`)

    if (!(element instanceof HTMLElement)) {
      continue
    }

    element.setAttribute("data-xhs-clean-mask", "true")
    element.setAttribute("data-xhs-clean-mask-label", label)
  }

  for (const element of Array.from(
    document.querySelectorAll<HTMLElement>(
      ".notification-page .tabs-content-container > .container[data-xhs-clean-mask]"
    )
  )) {
    const notificationKey = element.dataset.xhsCleanNotificationKey

    if (!notificationKey || !activeNotificationKeys.has(notificationKey)) {
      element.removeAttribute("data-xhs-clean-mask")
      element.removeAttribute("data-xhs-clean-mask-label")
      element.removeAttribute("data-xhs-clean-notification-key")
    }
  }

  const notificationElements = Array.from(
    document.querySelectorAll<HTMLElement>(
      ".notification-page .tabs-content-container > .container"
    )
  )
  const usedNotificationElements = new Set<HTMLElement>()

  for (const comment of maskedNotificationComments) {
    const element = notificationElements.find(
      (candidate) =>
        !usedNotificationElements.has(candidate) &&
        isNotificationElementForComment(candidate, comment)
    )

    if (!element) {
      continue
    }

    usedNotificationElements.add(element)
    element.setAttribute("data-xhs-clean-mask", "true")
    element.setAttribute("data-xhs-clean-mask-label", comment.label)
    element.setAttribute("data-xhs-clean-notification-key", comment.key)
  }
}

function requestDeleteComment(messageKey: string, noteId: string, commentId: string) {
  return new Promise<void>((resolve, reject) => {
    const requestId = `${messageKey}-${Date.now()}`

    const handleDeleteResult = (event: Event) => {
      const detail = (event as CustomEvent<DeleteResultEventDetail>).detail

      if (detail.requestId !== requestId) {
        return
      }

      window.removeEventListener(DELETE_RESULT_EVENT, handleDeleteResult)

      if (detail.ok) {
        resolve()
      } else {
        reject(new Error(detail.error ?? `删除失败：${detail.status ?? "unknown"}`))
      }
    }

    window.addEventListener(DELETE_RESULT_EVENT, handleDeleteResult)
    window.dispatchEvent(
      new CustomEvent<DeleteRequestEventDetail>(DELETE_REQUEST_EVENT, {
        detail: {
          requestId,
          noteId,
          commentId
        }
      })
    )
  })
}

function IndexContent() {
  const [messages, setMessages] = useState<MentionMessage[]>([])
  const [error, setError] = useState("")
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [lastSource, setLastSource] = useState<MentionsEventDetail["source"] | null>(null)
  const [deletingIds, setDeletingIds] = useState<Set<string>>(() => new Set())
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set())
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [aiResults, setAiResults] = useState<Record<string, StoredCommentRecord>>({})
  const [aiReviewing, setAiReviewing] = useState(false)
  const [reviewingIds, setReviewingIds] = useState<Set<string>>(() => new Set())
  const [reviewFailedIds, setReviewFailedIds] = useState<Set<string>>(() => new Set())
  const [reviewAttemptCounts, setReviewAttemptCounts] = useState<Record<string, number>>(
    {}
  )
  const [reviewStaleTimeoutMs, setReviewStaleTimeoutMs] = useState(
    getAiReviewStaleTimeoutMs(AI_REVIEW_TIMEOUT_MS)
  )
  const [reviewOrphanedPendingTimeoutMs, setReviewOrphanedPendingTimeoutMs] = useState(
    getAiReviewOrphanedPendingTimeoutMs(AI_REVIEW_TIMEOUT_MS)
  )
  const [extensionSettings, setExtensionSettings] = useState<ExtensionSettings>(
    DEFAULT_EXTENSION_SETTINGS
  )
  const [panelPosition, setPanelPosition] = useState(getInitialPanelPosition)
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null)
  const inFlightReviewKeysRef = useRef<Set<string>>(new Set())
  const autoDeleteAttemptedKeysRef = useRef<Set<string>>(new Set())

  const commentMessages = useMemo(
    () => messages.filter((message) => Boolean(message.comment_info)),
    [messages]
  )

  const reviewableComments = useMemo(
    () =>
      commentMessages
        .map((message, index) => toReviewableComment(message, index))
        .filter((comment): comment is ReviewableComment => Boolean(comment))
        .filter(
          (comment) =>
            !extensionSettings.onlyRelatedComments ||
            isRelatedReviewableComment(comment)
        ),
    [commentMessages, extensionSettings.onlyRelatedComments]
  )

  useEffect(() => {
    const handleMentions = (event: Event) => {
      const detail = (event as CustomEvent<MentionsEventDetail>).detail
      const capturedMessages = detail.messages.map((message) => ({
        ...message,
        capture_source: detail.source,
        is_notification_message: detail.source.startsWith("mentions:")
      }))
      const missingCommentIdMessages = capturedMessages.filter(
        (message) => !message.comment_info?.id
      )

      if (missingCommentIdMessages.length > 0) {
        const errorMessage = reportMissingCommentId(
          missingCommentIdMessages[0],
          detail.source
        )

        setError(errorMessage)
      }

      const validMessages = capturedMessages.filter((message) =>
        Boolean(message.comment_info?.id)
      )

      if (validMessages.length === 0) {
        setLastSource(detail.source)
        setLastUpdated(new Date())
        return
      }

      setMessages((current) =>
        mergeMessages(current, validMessages)
      )
      setLastSource(detail.source)
      setLastUpdated(new Date())
      if (missingCommentIdMessages.length === 0) {
        setError("")
      }
    }

    window.addEventListener(MENTIONS_EVENT, handleMentions)

    return () => window.removeEventListener(MENTIONS_EVENT, handleMentions)
  }, [])

  useEffect(() => {
    let cancelled = false

    void getStoredExtensionSettings().then((storedSettings) => {
      if (!cancelled) {
        setExtensionSettings(storedSettings)
      }
    })

    const handleStorageChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== "local" || !changes[EXTENSION_SETTINGS_KEY]) {
        return
      }

      setExtensionSettings(
        normalizeExtensionSettings(changes[EXTENSION_SETTINGS_KEY].newValue)
      )
    }

    try {
      chrome.storage?.onChanged?.addListener(handleStorageChanged)
    } catch {
      // The old content script can outlive an extension reload.
    }

    return () => {
      cancelled = true
      try {
        chrome.storage?.onChanged?.removeListener(handleStorageChanged)
      } catch {
        // Ignore cleanup after the extension context has been invalidated.
      }
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    void Promise.all([getStoredAiReviewResults(), getAiReviewTimeoutMs()]).then(
      ([storedResults, timeoutMs]) => {
      if (cancelled) {
        return
      }

      const staleTimeoutMs = getAiReviewStaleTimeoutMs(timeoutMs)
      const orphanedPendingTimeoutMs = getAiReviewOrphanedPendingTimeoutMs(timeoutMs)
      const now = Date.now()
      const { results: releasedResults, releasedKeys } = releaseOrphanedPendingAiReviews(
        storedResults,
        now,
        orphanedPendingTimeoutMs,
        inFlightReviewKeysRef.current
      )
      const { results: normalizedResults, timedOutKeys } = markTimedOutAiReviews(
        releasedResults,
        now,
        staleTimeoutMs
      )
      const failedKeys = getStoredReviewFailedKeys(normalizedResults)

      setReviewStaleTimeoutMs(staleTimeoutMs)
      setReviewOrphanedPendingTimeoutMs(orphanedPendingTimeoutMs)
      setAiResults((current) => mergeAiReviewResults(current, normalizedResults))
      setDeletedIds(
        new Set(
          Object.entries(normalizedResults)
            .filter(([, result]) => result.deleted)
            .map(([key]) => key)
        )
      )
      setReviewFailedIds((current) => addSetItems(current, failedKeys))

      if (releasedKeys.length > 0 || timedOutKeys.length > 0) {
        void saveMergedAiReviewResults(normalizedResults)
      }
    }
    )

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const hasPendingReview = Object.values(aiResults).some((result) =>
      isAiReviewPending(result, Date.now(), reviewStaleTimeoutMs)
    )

    if (!hasPendingReview) {
      return
    }

    const intervalId = window.setInterval(() => {
      setAiResults((current) => {
        const now = Date.now()
        const { results: releasedResults, releasedKeys } = releaseOrphanedPendingAiReviews(
          current,
          now,
          reviewOrphanedPendingTimeoutMs,
          inFlightReviewKeysRef.current
        )
        const { results: normalizedResults, timedOutKeys } = markTimedOutAiReviews(
          releasedResults,
          now,
          reviewStaleTimeoutMs
        )

        if (releasedKeys.length === 0 && timedOutKeys.length === 0) {
          return current
        }

        if (timedOutKeys.length > 0) {
          setReviewFailedIds((failedIds) => addSetItems(failedIds, timedOutKeys))
        }

        if (releasedKeys.length > 0) {
          setReviewFailedIds((failedIds) => deleteSetItems(failedIds, releasedKeys))
        }

        void saveMergedAiReviewResults(normalizedResults)

        return mergeAiReviewResults(current, normalizedResults)
      })
    }, AI_REVIEW_STALE_CHECK_INTERVAL_MS)

    return () => window.clearInterval(intervalId)
  }, [aiResults, reviewOrphanedPendingTimeoutMs, reviewStaleTimeoutMs])

  useEffect(() => {
    if (!extensionSettings.enabled) {
      applyMaskedComments({})
      return
    }

    const maskedCommentLabels: Record<string, string> = {}
    const maskedNotificationComments: MaskedNotificationComment[] = []

    const addNotificationMask = (comment: ReviewableComment, label: string) => {
      if (!comment.message.is_notification_message) {
        return
      }

      maskedNotificationComments.push({
        key: comment.key,
        label,
        content: comment.content,
        nickname: comment.message.user_info?.nickname
      })
    }

    for (const [messageKey, aiResult] of Object.entries(aiResults)) {
      if (!aiResult.is_low_quality) {
        continue
      }

      const commentId = getCommentIdFromMessageKey(messageKey)

      if (commentId && document.getElementById(`comment-${commentId}`)) {
        maskedCommentLabels[commentId] = "检测到低素质评论"
      }
    }

    for (const comment of reviewableComments) {
      const aiResult = aiResults[comment.key]

      if (aiResult?.is_low_quality) {
        if (comment.commentId) {
          maskedCommentLabels[comment.commentId] = "检测到低素质评论"
        }
        addNotificationMask(comment, "检测到低素质评论")

        continue
      }

      if (
        !hasAiReviewResult(aiResult) &&
        !deletedIds.has(comment.key) &&
        extensionSettings.maskBeforeReview
      ) {
        const isStoredReviewPending = isAiReviewPending(
          aiResult,
          Date.now(),
          reviewStaleTimeoutMs
        )
        const isReviewFailed =
          reviewFailedIds.has(comment.key) ||
          Boolean(aiResult?.reviewFailedAt && !hasAiReviewResult(aiResult))
        const label =
          reviewingIds.has(comment.key) || isStoredReviewPending
            ? "检测中"
            : isReviewFailed
              ? "检测失败"
              : "等待检测"

        if (comment.commentId) {
          maskedCommentLabels[comment.commentId] = label
        }
        addNotificationMask(comment, label)
      }
    }

    applyMaskedComments(maskedCommentLabels, maskedNotificationComments)
  }, [
    aiResults,
    deletedIds,
    extensionSettings.currentUserLowQualityAction,
    extensionSettings.enabled,
    extensionSettings.maskBeforeReview,
    reviewFailedIds,
    reviewStaleTimeoutMs,
    reviewingIds,
    reviewableComments
  ])

  useEffect(() => {
    if (!extensionSettings.enabled || reviewableComments.length === 0) {
      return
    }

    const now = Date.now()
    const candidateComments = reviewableComments.filter((comment) =>
      canQueueAiReview(comment, aiResults, {
        now,
        orphanedPendingTimeoutMs: reviewOrphanedPendingTimeoutMs,
        inFlightKeys: inFlightReviewKeysRef.current,
        failedKeys: reviewFailedIds,
        deletedKeys: deletedIds
      })
    )

    if (candidateComments.length === 0) {
      return
    }

    const candidateKeys = candidateComments.map((comment) => comment.key)

    for (const key of candidateKeys) {
      inFlightReviewKeysRef.current.add(key)
    }

    const runAutoReview = async () => {
      const storedResults = await getStoredAiReviewResults()
      const combinedResults = mergeAiReviewResults(storedResults, aiResults)
      const { results: cachedResults, timedOutKeys } = markTimedOutAiReviews(
        combinedResults,
        now,
        reviewStaleTimeoutMs
      )

      if (timedOutKeys.length > 0) {
        const mergedResults = await saveMergedAiReviewResults(cachedResults)
        setAiResults((current) => mergeAiReviewResults(current, mergedResults))
        setReviewFailedIds((current) => addSetItems(current, timedOutKeys))
      }

      const reservedCandidateKeys = new Set(candidateKeys)
      const commentsToReview = candidateComments.filter((comment) => {
        const cachedResult = cachedResults[comment.key]

        return (
          reservedCandidateKeys.has(comment.key) &&
          !hasTerminalReviewResult(cachedResult) &&
          !cachedResult?.reviewFailedAt &&
          !isAiReviewPending(cachedResult, now, reviewOrphanedPendingTimeoutMs) &&
          !reviewFailedIds.has(comment.key) &&
          !deletedIds.has(comment.key)
        )
      })

      if (commentsToReview.length === 0) {
        for (const key of candidateKeys) {
          inFlightReviewKeysRef.current.delete(key)
        }

        return
      }

      const reviewingKeys = commentsToReview.map((comment) => comment.key)

      setReviewFailedIds((current) => deleteSetItems(current, reviewingKeys))
      const reviewStartedAt = Date.now()
      const startedResults: Record<string, StoredCommentRecord> = {
        ...cachedResults
      }

      for (const key of reviewingKeys) {
        startedResults[key] = {
          ...startedResults[key],
          id: startedResults[key]?.id ?? key,
          reviewStartedAt,
          reviewFailedAt: undefined,
          reviewError: undefined,
          reviewAttemptCount: 0
        }
      }

      const mergedStartedResults = await saveMergedAiReviewResults(startedResults)
      setAiResults((current) => mergeAiReviewResults(current, mergedStartedResults))
      setReviewingIds((current) => {
        const next = new Set(current)

        for (const key of reviewingKeys) {
          next.add(key)
        }

        return next
      })

      try {
        const response = await sendAiReviewInBatchesWithRetries(
          commentsToReview.map((comment) => ({
            id: comment.key,
            content: comment.content
          })),
          {
            batchSize: extensionSettings.aiReviewBatchSize,
            concurrency: extensionSettings.aiReviewConcurrency,
            maxAttempts: AI_REVIEW_MAX_ATTEMPTS,
            onAttempt: ({ attempt, commentIds }) => {
              setReviewAttemptCounts((current) => {
                const next = { ...current }

                for (const commentId of commentIds) {
                  next[commentId] = attempt
                }

                return next
              })
            }
          }
        )

        if (response.ok === false) {
          throw new Error(
            `AI 自动检测连续失败 ${AI_REVIEW_MAX_ATTEMPTS} 次，已自动关闭插件总开关。\n\n${response.error}\n\n评论数量：${commentsToReview.length}\n评论 ID：${reviewingKeys.join(", ")}`
          )
        }

        const reviewedAt = Date.now()
        const nextStoredResults: Record<string, StoredCommentRecord> = {
          ...startedResults
        }

        for (const result of response.result.results) {
          nextStoredResults[result.id] = {
            ...nextStoredResults[result.id],
            ...result,
            reviewedAt,
            reviewFailedAt: undefined,
            reviewError: undefined
          }
        }

        const returnedIds = new Set(response.result.results.map((result) => result.id))
        const missingResultKeys = reviewingKeys.filter((key) => !returnedIds.has(key))

        for (const key of missingResultKeys) {
          nextStoredResults[key] = {
            ...nextStoredResults[key],
            id: nextStoredResults[key]?.id ?? key,
            reviewFailedAt: reviewedAt,
            reviewError: "AI 响应缺少该评论结果"
          }
        }

        const mergedNextStoredResults = await saveMergedAiReviewResults(nextStoredResults)

        setAiResults((current) => {
          return mergeAiReviewResults(current, mergedNextStoredResults)
        })
        setReviewFailedIds((current) =>
          addSetItems(
            deleteSetItems(
              current,
              response.result.results.map((result) => result.id)
            ),
            missingResultKeys
          )
        )

        if (missingResultKeys.length > 0) {
          setError(
            `AI 响应缺少部分评论结果，已标记为检测失败：${missingResultKeys.join(", ")}`
          )
        }

      } catch (reviewError) {
        const errorMessage =
          reviewError instanceof Error ? reviewError.message : "AI 判断失败"
        const failedAt = Date.now()
        const failedResults: Record<string, StoredCommentRecord> = {}

        for (const key of reviewingKeys) {
          const currentResult = cachedResults[key]

          failedResults[key] = {
            ...currentResult,
            id: currentResult?.id ?? key,
            reviewStartedAt: currentResult?.reviewStartedAt ?? failedAt,
            reviewFailedAt: failedAt,
            reviewError: errorMessage
          }
        }

        const mergedFailedResults = await saveMergedAiReviewResults(failedResults)
        setAiResults((current) => mergeAiReviewResults(current, mergedFailedResults))

        setReviewFailedIds((current) => addSetItems(current, reviewingKeys))
        const disabledSettings = normalizeExtensionSettings({
          ...extensionSettings,
          enabled: false
        })

        setExtensionSettings(disabledSettings)
        void saveExtensionSettings(disabledSettings)
        setError(errorMessage)
        window.alert(errorMessage)
      } finally {
        for (const key of candidateKeys) {
          inFlightReviewKeysRef.current.delete(key)
        }

        setReviewingIds((current) => {
          const next = new Set(current)

          for (const key of reviewingKeys) {
            next.delete(key)
          }

          return next
        })
      }
    }

    void runAutoReview()
  }, [
    aiResults,
    deletedIds,
    extensionSettings.aiReviewBatchSize,
    extensionSettings.aiReviewConcurrency,
    extensionSettings.currentUserLowQualityAction,
    extensionSettings.enabled,
    reviewFailedIds,
    reviewOrphanedPendingTimeoutMs,
    reviewStaleTimeoutMs,
    reviewableComments
  ])

  useEffect(() => {
    if (
      !extensionSettings.enabled ||
      extensionSettings.currentUserLowQualityAction !== "delete"
    ) {
      return
    }

    const commentsToDelete = reviewableComments.filter(
      (comment) =>
        comment.isCurrentUserNote &&
        comment.noteId &&
        comment.commentId &&
        aiResults[comment.key]?.is_low_quality &&
        !aiResults[comment.key]?.deleted &&
        !deletedIds.has(comment.key) &&
        !autoDeleteAttemptedKeysRef.current.has(comment.key)
    )

    if (commentsToDelete.length === 0) {
      return
    }

    let cancelled = false

    for (const comment of commentsToDelete) {
      autoDeleteAttemptedKeysRef.current.add(comment.key)
    }

    const runAutoDelete = async () => {
      for (const comment of commentsToDelete) {
        if (cancelled || !comment.noteId || !comment.commentId) {
          continue
        }

        setDeletingIds((current) => new Set(current).add(comment.key))

        try {
          await requestDeleteComment(comment.key, comment.noteId, comment.commentId)
          const deletedRecord = await markStoredCommentDeleted(comment.key)

          if (!cancelled) {
            setAiResults((current) =>
              mergeAiReviewResults(current, {
                [comment.key]: deletedRecord
              })
            )
            setDeletedIds((current) => new Set(current).add(comment.key))
          }
        } catch (deleteError) {
          if (!cancelled) {
            setError(deleteError instanceof Error ? deleteError.message : "删除失败")
          }
        } finally {
          setDeletingIds((current) => {
            const next = new Set(current)
            next.delete(comment.key)
            return next
          })
        }
      }
    }

    void runAutoDelete()

    return () => {
      cancelled = true
    }
  }, [
    aiResults,
    deletedIds,
    extensionSettings.currentUserLowQualityAction,
    extensionSettings.enabled,
    reviewableComments
  ])

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const dragOffset = dragOffsetRef.current

      if (!dragOffset) {
        return
      }

      setPanelPosition(
        clampPanelPosition({
          x: event.clientX - dragOffset.x,
          y: event.clientY - dragOffset.y
        })
      )
    }

    const stopDragging = () => {
      dragOffsetRef.current = null
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", stopDragging)
    window.addEventListener("pointercancel", stopDragging)

    return () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", stopDragging)
      window.removeEventListener("pointercancel", stopDragging)
    }
  }, [])

  const selectedComments = useMemo(
    () =>
      commentMessages
        .map((message) => ({
          key: getMessageKey(message),
          message
        }))
        .filter(({ key, message }) => selectedIds.has(key) && message.comment_info?.content),
    [commentMessages, selectedIds]
  )

  const reviewSelectedComments = useCallback(async () => {
    if (selectedComments.length === 0) {
      setError("请先选择要判断的评论")
      return
    }

    setError("")
    setAiReviewing(true)

    let reviewingKeys: string[] = []
    let cachedResultsForManualReview: Record<string, StoredCommentRecord> = {}

    try {
      const storedResults = await getStoredAiReviewResults()
      const combinedResults = mergeAiReviewResults(storedResults, aiResults)
      const now = Date.now()
      const { results: cachedResults, timedOutKeys } = markTimedOutAiReviews(
        combinedResults,
        now,
        reviewStaleTimeoutMs
      )
      cachedResultsForManualReview = cachedResults
      const commentsToReview = selectedComments.filter(({ key }) => {
        const cachedResult = cachedResults[key]

        return (
          !hasTerminalReviewResult(cachedResult) &&
          !inFlightReviewKeysRef.current.has(key)
        )
      })

      setAiResults((current) => mergeAiReviewResults(current, cachedResults))
      setReviewFailedIds((current) =>
        addSetItems(current, getStoredReviewFailedKeys(cachedResults))
      )

      if (timedOutKeys.length > 0) {
        await saveMergedAiReviewResults(cachedResults)
      }

      if (commentsToReview.length === 0) {
        setError("选中评论均已由 AI 判断过，不再重复处理")
        return
      }

      reviewingKeys = commentsToReview.map(({ key }) => key)

      setReviewFailedIds((current) => deleteSetItems(current, reviewingKeys))
      const reviewStartedAt = Date.now()
      const startedResults: Record<string, StoredCommentRecord> = {
        ...cachedResults
      }

      for (const key of reviewingKeys) {
        startedResults[key] = {
          ...startedResults[key],
          id: startedResults[key]?.id ?? key,
          reviewStartedAt,
          reviewFailedAt: undefined,
          reviewError: undefined,
          reviewAttemptCount: 0
        }
        inFlightReviewKeysRef.current.add(key)
      }

      const mergedStartedResults = await saveMergedAiReviewResults(startedResults)
      setAiResults((current) => mergeAiReviewResults(current, mergedStartedResults))
      setReviewingIds((current) => {
        const next = new Set(current)

        for (const key of reviewingKeys) {
          next.add(key)
        }

        return next
      })

      const response = await sendAiReviewInBatchesWithRetries(
        commentsToReview.map(({ key, message }) => ({
          id: key,
          content: message.comment_info?.content
        })),
        {
          batchSize: extensionSettings.aiReviewBatchSize,
          concurrency: extensionSettings.aiReviewConcurrency,
          maxAttempts: AI_REVIEW_MAX_ATTEMPTS,
          onAttempt: ({ attempt, commentIds }) => {
            setReviewAttemptCounts((current) => {
              const next = { ...current }

              for (const commentId of commentIds) {
                next[commentId] = attempt
              }

              return next
            })
          }
        }
      )

      if (response.ok === false) {
        throw new Error(
          `AI 手动检测连续失败 ${AI_REVIEW_MAX_ATTEMPTS} 次，已自动关闭插件总开关。\n\n${response.error}\n\n评论数量：${commentsToReview.length}\n评论 ID：${reviewingKeys.join(", ")}`
        )
      }

      const reviewedAt = Date.now()
      const nextStoredResults: Record<string, StoredCommentRecord> = {
        ...startedResults
      }

      for (const result of response.result.results) {
        nextStoredResults[result.id] = {
          ...nextStoredResults[result.id],
          ...result,
          reviewedAt,
          reviewFailedAt: undefined,
          reviewError: undefined
        }
      }

      const returnedIds = new Set(response.result.results.map((result) => result.id))
      const missingResultKeys = reviewingKeys.filter((key) => !returnedIds.has(key))

      for (const key of missingResultKeys) {
        nextStoredResults[key] = {
          ...nextStoredResults[key],
          id: nextStoredResults[key]?.id ?? key,
          reviewFailedAt: reviewedAt,
          reviewError: "AI 响应缺少该评论结果"
        }
      }

      const mergedNextStoredResults = await saveMergedAiReviewResults(nextStoredResults)

      setAiResults((current) => {
        return mergeAiReviewResults(current, mergedNextStoredResults)
      })
      setReviewFailedIds((current) =>
        addSetItems(
          deleteSetItems(
            current,
            response.result.results.map((result) => result.id)
          ),
          missingResultKeys
        )
      )

      if (missingResultKeys.length > 0) {
        setError(
          `AI 响应缺少部分评论结果，已标记为检测失败：${missingResultKeys.join(", ")}`
        )
      }
    } catch (reviewError) {
      const errorMessage =
        reviewError instanceof Error ? reviewError.message : "AI 判断失败"
      const failedAt = Date.now()
      const failedKeys =
        reviewingKeys.length > 0
          ? reviewingKeys
          : selectedComments.map(({ key }) => key)
      const failedResults: Record<string, StoredCommentRecord> = {}

      for (const key of failedKeys) {
        const currentResult = cachedResultsForManualReview[key]

        failedResults[key] = {
          ...currentResult,
          id: currentResult?.id ?? key,
          reviewStartedAt: currentResult?.reviewStartedAt ?? failedAt,
          reviewFailedAt: failedAt,
          reviewError: errorMessage
        }
      }

      const mergedFailedResults = await saveMergedAiReviewResults(failedResults)
      setAiResults((current) => mergeAiReviewResults(current, mergedFailedResults))

      setReviewFailedIds((current) =>
        addSetItems(current, failedKeys)
      )
      const disabledSettings = normalizeExtensionSettings({
        ...extensionSettings,
        enabled: false
      })

      setExtensionSettings(disabledSettings)
      void saveExtensionSettings(disabledSettings)
      setError(errorMessage)
      window.alert(errorMessage)
    } finally {
      for (const key of reviewingKeys) {
        inFlightReviewKeysRef.current.delete(key)
      }

      setReviewingIds((current) => {
        const next = new Set(current)

        for (const key of reviewingKeys) {
          next.delete(key)
        }

        return next
      })
      setAiReviewing(false)
    }
  }, [aiResults, extensionSettings, reviewStaleTimeoutMs, selectedComments])

  const deleteComment = useCallback((message: MentionMessage) => {
    const noteId = message.item_info?.id
    const commentId = message.comment_info?.id
    const messageKey = getMessageKey(message)

    if (!noteId || !commentId) {
      setError("缺少 note_id 或 comment_id，无法删除")
      return
    }

    setError("")
    setDeletingIds((current) => new Set(current).add(messageKey))

    void requestDeleteComment(messageKey, noteId, commentId)
      .then(async () => {
        const deletedRecord = await markStoredCommentDeleted(messageKey)

        setAiResults((current) =>
          mergeAiReviewResults(current, {
            [messageKey]: deletedRecord
          })
        )
        setDeletedIds((current) => new Set(current).add(messageKey))
        setSelectedIds((current) => {
          const next = new Set(current)
          next.delete(messageKey)
          return next
        })
      })
      .catch((deleteError) => {
        setError(deleteError instanceof Error ? deleteError.message : "删除失败")
      })
      .finally(() => {
        setDeletingIds((current) => {
          const next = new Set(current)
          next.delete(messageKey)
          return next
        })
      })
  }, [])

  const clearAiReviewCache = useCallback(() => {
    void clearStoredAiReviewResults().then(() => {
      inFlightReviewKeysRef.current.clear()
      autoDeleteAttemptedKeysRef.current.clear()
      setAiResults({})
      setDeletedIds(new Set())
      setReviewingIds(new Set())
      setReviewFailedIds(new Set())
      setReviewAttemptCounts({})
      setError("")
    })
  }, [])

  if (!extensionSettings.showDebugPanel) {
    return null
  }

  return (
    <div
      style={{
        position: "fixed",
        left: panelPosition.x,
        top: panelPosition.y,
        zIndex: 2147483647,
        width: 520,
        maxHeight: "min(82vh, 720px)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        borderRadius: 12,
        boxShadow: "0 12px 32px rgba(0, 0, 0, 0.24)",
        border: "1px solid rgba(0, 0, 0, 0.08)",
        background: "#fff",
        color: "#222",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        fontSize: 13
      }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "12px 14px",
          borderBottom: "1px solid #eee",
          background: "#fafafa",
          cursor: "move",
          userSelect: "none",
          touchAction: "none"
        }}
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("button,input,select,textarea,a")) {
            return
          }

          dragOffsetRef.current = {
            x: event.clientX - panelPosition.x,
            y: event.clientY - panelPosition.y
          }
        }}>
        <div>
          <div style={{ fontWeight: 700 }}>评论接口调试</div>
          <div style={{ marginTop: 2, color: "#777", fontSize: 12 }}>
            {lastUpdated
              ? `捕获于 ${lastUpdated.toLocaleTimeString()} · ${lastSource}`
              : "等待页面请求 mentions/comment page"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button
            onClick={clearAiReviewCache}
            style={{
              border: "1px solid #ddd",
              borderRadius: 6,
              background: "#fff",
              cursor: "pointer",
              padding: "5px 10px"
            }}>
            清除缓存
          </button>
          <button
            onClick={() => {
              window.dispatchEvent(new CustomEvent(CLEAR_MESSAGES_EVENT))
              setMessages([])
              setDeletedIds(new Set())
              setSelectedIds(new Set())
              setError("")
              setLastUpdated(null)
              setLastSource(null)
            }}
            style={{
              border: "1px solid #ddd",
              borderRadius: 6,
              background: "#fff",
              cursor: "pointer",
              padding: "5px 10px"
            }}>
            清空
          </button>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "10px 12px",
          borderBottom: "1px solid #eee",
          flexShrink: 0
        }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={
              commentMessages.length > 0 &&
              commentMessages.every((message) =>
                selectedIds.has(getMessageKey(message))
              )
            }
            onChange={(event) => {
              if (event.target.checked) {
                setSelectedIds(
                  new Set(
                    commentMessages.map((message) => getMessageKey(message))
                  )
                )
                return
              }

              setSelectedIds(new Set())
            }}
          />
          <span>已选 {selectedIds.size} 条</span>
        </label>
        <button
          disabled={selectedComments.length === 0 || aiReviewing}
          onClick={() => void reviewSelectedComments()}
          style={{
            border: "none",
            borderRadius: 6,
            background: "#1677ff",
            color: "#fff",
            cursor:
              selectedComments.length === 0 || aiReviewing ? "not-allowed" : "pointer",
            opacity: selectedComments.length === 0 || aiReviewing ? 0.55 : 1,
            padding: "6px 10px"
          }}>
          {aiReviewing ? "AI 判断中" : "AI 判断选中"}
        </button>
      </div>

      {error ? (
        <div
          style={{
            margin: 12,
            padding: 10,
            borderRadius: 8,
            background: "#fff1f0",
            color: "#b42318",
            wordBreak: "break-word"
          }}>
          {error}
        </div>
      ) : null}

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: 12
        }}>
        {commentMessages.length === 0 ? (
          <div style={{ color: "#777", padding: "18px 4px", textAlign: "center" }}>
            暂无评论消息，打开通知/笔记页后会自动捕获评论响应
          </div>
        ) : (
          commentMessages.map((message) => {
            const messageKey = getMessageKey(message)
            const commentId = message.comment_info?.id
            const noteId = message.item_info?.id
            const isDeleting = deletingIds.has(messageKey)
            const isDeleted = deletedIds.has(messageKey)
            const isSelected = selectedIds.has(messageKey)
            const aiResult = aiResults[messageKey]
            const isReviewing =
              !hasTerminalReviewResult(aiResult) &&
              (reviewingIds.has(messageKey) ||
                isAiReviewPending(aiResult, Date.now(), reviewStaleTimeoutMs))
            const isReviewFailed =
              reviewFailedIds.has(messageKey) ||
              Boolean(aiResult?.reviewFailedAt && !hasAiReviewResult(aiResult))
            const reviewAttemptCount =
              reviewAttemptCounts[messageKey] ?? aiResult?.reviewAttemptCount ?? 0
            const reviewStartedAtText = formatDateTime(aiResult?.reviewStartedAt)
            const canDelete =
              message.is_current_user_note === true ||
              message.title?.includes("你的笔记") === true

            return (
              <div
                key={messageKey}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  gap: 10,
                  padding: "10px 0",
                  borderBottom: "1px solid #f0f0f0"
                }}>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={(event) => {
                    setSelectedIds((current) => {
                      const next = new Set(current)

                      if (event.target.checked) {
                        next.add(messageKey)
                      } else {
                        next.delete(messageKey)
                      }

                      return next
                    })
                  }}
                  style={{ marginTop: 4 }}
                />
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      alignItems: "baseline",
                      flexWrap: "wrap"
                    }}>
                    <strong>{message.user_info?.nickname ?? "未知用户"}</strong>
                    <span style={{ color: "#777" }}>{message.title}</span>
                    <span style={{ color: "#999", fontSize: 12 }}>
                      {formatTime(message.time)}
                    </span>
                  </div>
                  <div
                    style={{
                      marginTop: 6,
                      lineHeight: 1.45,
                      wordBreak: "break-word"
                    }}>
                    {message.comment_info?.content ?? "(空评论)"}
                  </div>
                  <div
                    style={{
                      marginTop: 6,
                      color: "#999",
                      fontSize: 12,
                      wordBreak: "break-all"
                    }}>
                    note_id: {noteId ?? "-"} · comment_id: {commentId ?? "-"}
                  </div>
                  {!canDelete ? (
                    <div style={{ marginTop: 4, color: "#999", fontSize: 12 }}>
                      非当前用户笔记，不显示删除操作
                    </div>
                  ) : null}
                  {message.comment_info?.illegal_info?.desc ? (
                    <div style={{ marginTop: 4, color: "#999", fontSize: 12 }}>
                      状态：{message.comment_info.illegal_info.desc}
                    </div>
                  ) : null}
                  {isReviewing ? (
                    <div
                      style={{
                        marginTop: 8,
                        padding: 8,
                        borderRadius: 8,
                        background: "#e6f4ff",
                        color: "#0958d9",
                        lineHeight: 1.45
                      }}>
                      <strong>
                        AI：检测中（第 {Math.max(1, reviewAttemptCount)}/
                        {AI_REVIEW_MAX_ATTEMPTS} 次）
                      </strong>
                      {reviewStartedAtText ? (
                        <div style={{ marginTop: 4, fontSize: 12 }}>
                          开始检测：{reviewStartedAtText}
                        </div>
                      ) : null}
                    </div>
                  ) : isReviewFailed ? (
                    <div
                      style={{
                        marginTop: 8,
                        padding: 8,
                        borderRadius: 8,
                        background: "#fff7e6",
                        color: "#ad6800",
                        lineHeight: 1.45
                      }}>
                      <strong>
                        AI：检测失败（已尝试{" "}
                        {Math.max(reviewAttemptCount, AI_REVIEW_MAX_ATTEMPTS)} 次）
                      </strong>
                      {reviewStartedAtText ? (
                        <div style={{ marginTop: 4, fontSize: 12 }}>
                          开始检测：{reviewStartedAtText}
                        </div>
                      ) : null}
                    </div>
                  ) : typeof aiResult?.is_low_quality === "boolean" ? (
                    <div
                      style={{
                        marginTop: 8,
                        padding: 8,
                        borderRadius: 8,
                        background: aiResult.is_low_quality ? "#fff1f0" : "#f6ffed",
                        color: aiResult.is_low_quality ? "#a8071a" : "#237804",
                        lineHeight: 1.45
                      }}>
                      <strong>
                        AI：{aiResult.is_low_quality ? "低素质" : "非低素质"}
                      </strong>
                      {reviewStartedAtText ? (
                        <div style={{ marginTop: 4, fontSize: 12 }}>
                          开始检测：{reviewStartedAtText}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {canDelete ? (
                  <button
                    disabled={!noteId || !commentId || isDeleting || isDeleted}
                    onClick={() => void deleteComment(message)}
                    style={{
                      alignSelf: "start",
                      border: "none",
                      borderRadius: 6,
                      background: isDeleted ? "#e8f5e9" : "#ff4d4f",
                      color: isDeleted ? "#237804" : "#fff",
                      cursor:
                        !noteId || !commentId || isDeleting || isDeleted
                          ? "not-allowed"
                          : "pointer",
                      opacity: !noteId || !commentId || isDeleting ? 0.65 : 1,
                      padding: "6px 10px",
                      whiteSpace: "nowrap"
                    }}>
                    {isDeleted ? "已删除" : isDeleting ? "删除中" : "删除"}
                  </button>
                ) : (
                  <div />
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

export default IndexContent
