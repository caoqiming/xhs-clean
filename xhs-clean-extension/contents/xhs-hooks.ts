export const config = {
  matches: ["https://*.xiaohongshu.com/*", "https://edith.xiaohongshu.com/*"],
  run_at: "document_start",
  world: "MAIN"
}

const MENTIONS_PATH = "/api/sns/web/v1/you/mentions"
const COMMENT_PAGE_PATH = "/api/sns/web/v2/comment/page"
const SUB_COMMENT_PAGE_PATH = "/api/sns/web/v2/comment/sub/page"
const FEED_PATH = "/api/sns/web/v1/feed"
const USER_ME_PATH = "/api/sns/web/v2/user/me"
const MENTIONS_EVENT = "xhs-clean-extension:mentions"
const CLEAR_MESSAGES_EVENT = "xhs-clean-extension:clear-messages"
const DELETE_REQUEST_EVENT = "xhs-clean-extension:delete-request"
const DELETE_RESULT_EVENT = "xhs-clean-extension:delete-result"

type XhsUserInfo = {
  nickname?: string
  user_id?: string
  userid?: string
}

type MentionMessage = {
  id?: string
  title?: string
  time?: number
  user_info?: XhsUserInfo
  item_info?: {
    id?: string
    content?: string
    user_info?: XhsUserInfo
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

type CommentPageComment = {
  id?: string
  note_id?: string
  content?: string
  create_time?: number
  status?: number
  user_info?: {
    nickname?: string
    user_id?: string
    userid?: string
  }
  show_tags?: string[]
  sub_comments?: CommentPageComment[]
}

type MentionsResponse = {
  data?: {
    message_list?: MentionMessage[]
  }
}

type CommentPageResponse = {
  data?: {
    user_id?: string
    comments?: CommentPageComment[]
    sub_comments?: CommentPageComment[]
  }
}

type UserMeResponse = {
  data?: {
    user_id?: string
  }
}

type FeedResponse = {
  data?: {
    items?: Array<{
      id?: string
      note_card?: {
        note_id?: string
        user?: {
          user_id?: string
          userid?: string
        }
      }
    }>
  }
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

type PageDeleteCommentApi = (
  payload: {
    noteId: string
    commentId: string
  },
  options?: Record<string, unknown>
) => Promise<unknown>

type WebpackRequire = ((moduleId: string) => Record<string, unknown>) & {
  m: Record<string, unknown>
  c: Record<string, { exports?: Record<string, unknown> }>
}

type WebpackChunk = Array<unknown> & {
  push: (chunk: [unknown[], Record<string, unknown>, (require: WebpackRequire) => void]) => number
}

type XhsCleanHookState = {
  installed: boolean
  xhrInstalled: boolean
  deleteCommentApi?: PageDeleteCommentApi
  ensureFetchWrapped?: () => void
  fetchInterval?: number
  currentUserId?: string
  noteOwnerUserIds: Record<string, string>
  commentPageResponses: Record<string, CommentPageResponse>
  subCommentPageResponses: Record<
    string,
    {
      noteId: string
      parentCommentId?: string
      response: CommentPageResponse
    }
  >
  clearGeneration: number
}

declare global {
  interface Window {
    __xhsCleanHookState?: XhsCleanHookState
    webpackChunkxhs_pc_web?: WebpackChunk
  }
}

function isMentionsUrl(url: string) {
  return url.includes(MENTIONS_PATH)
}

function isCommentPageUrl(url: string) {
  return url.includes(COMMENT_PAGE_PATH)
}

function isSubCommentPageUrl(url: string) {
  return url.includes(SUB_COMMENT_PAGE_PATH)
}

function isCapturedCommentUrl(url: string) {
  return isMentionsUrl(url) || isCommentPageUrl(url) || isSubCommentPageUrl(url)
}

function isFeedUrl(url: string) {
  return url.includes(FEED_PATH)
}

function isUserMeUrl(url: string) {
  return url.includes(USER_ME_PATH)
}

function isTrackedUrl(url: string) {
  return isCapturedCommentUrl(url) || isFeedUrl(url) || isUserMeUrl(url)
}

function getFetchUrl(input: RequestInfo | URL) {
  if (typeof input === "string") {
    return input
  }

  if (input instanceof URL) {
    return input.toString()
  }

  return input.url
}

function getCommentPageNoteId(url: string) {
  try {
    return new URL(url, window.location.href).searchParams.get("note_id") ?? undefined
  } catch {
    return undefined
  }
}

function getSubCommentPageParentCommentId(url: string) {
  try {
    const searchParams = new URL(url, window.location.href).searchParams

    return (
      searchParams.get("comment_id") ??
      searchParams.get("root_comment_id") ??
      searchParams.get("top_comment_id") ??
      undefined
    )
  } catch {
    return undefined
  }
}

function getCommentPageCursor(url: string) {
  try {
    return new URL(url, window.location.href).searchParams.get("cursor") ?? ""
  } catch {
    return ""
  }
}

function normalizeCommentPageComment(
  comment: CommentPageComment,
  title: string,
  state: XhsCleanHookState,
  parentComment?: CommentPageComment
): MentionMessage {
  const noteId = comment.note_id ?? parentComment?.note_id
  const noteOwnerUserId = noteId ? state.noteOwnerUserIds[noteId] : undefined

  return {
    id: `${noteId ?? "note"}-${comment.id ?? ""}`,
    title,
    time: comment.create_time ? Math.floor(comment.create_time / 1000) : undefined,
    user_info: comment.user_info,
    item_info: {
      id: noteId,
      user_info: noteOwnerUserId ? { user_id: noteOwnerUserId } : undefined
    },
    comment_info: {
      id: comment.id,
      content: comment.content,
      status: comment.status
    },
    current_user_id: state.currentUserId,
    is_current_user_note: isCurrentUserNote(state, noteOwnerUserId, title)
  }
}

function flattenCommentPageComments(
  comments: CommentPageComment[] = [],
  state: XhsCleanHookState
) {
  return comments.flatMap((comment) => [
    normalizeCommentPageComment(comment, "笔记评论", state),
    ...(comment.sub_comments ?? []).map((subComment) =>
      normalizeCommentPageComment(subComment, "评论回复", state, comment)
    )
  ])
}

function getSubCommentPageComments(response: CommentPageResponse) {
  return response.data?.comments ?? response.data?.sub_comments ?? []
}

function flattenSubCommentPageComments(
  response: CommentPageResponse,
  state: XhsCleanHookState,
  noteId?: string,
  parentCommentId?: string
) {
  const parentComment =
    noteId || parentCommentId
      ? {
          id: parentCommentId,
          note_id: noteId
        }
      : undefined

  return getSubCommentPageComments(response).map((comment) =>
    normalizeCommentPageComment(comment, "评论回复", state, parentComment)
  )
}

function getUserId(userInfo?: XhsUserInfo) {
  return userInfo?.user_id ?? userInfo?.userid
}

function rememberNoteOwner(state: XhsCleanHookState, noteId?: string, userInfo?: XhsUserInfo) {
  const userId = getUserId(userInfo)

  if (noteId && userId) {
    state.noteOwnerUserIds[noteId] = userId
  }
}

function isCurrentUserNote(
  state: XhsCleanHookState,
  noteOwnerUserId?: string,
  messageTitle?: string
) {
  if (noteOwnerUserId && state.currentUserId) {
    return noteOwnerUserId === state.currentUserId
  }

  return messageTitle?.includes("你的笔记") === true
}

function rememberAuthorTags(state: XhsCleanHookState, comments: CommentPageComment[] = []) {
  for (const comment of comments) {
    if (comment.show_tags?.includes("is_author")) {
      rememberNoteOwner(state, comment.note_id, comment.user_info)
    }

    rememberAuthorTags(state, comment.sub_comments)
  }
}

function updateKnownState(state: XhsCleanHookState, url: string, response: unknown) {
  if (isUserMeUrl(url)) {
    state.currentUserId = (response as UserMeResponse).data?.user_id ?? state.currentUserId
    return
  }

  if (isCommentPageUrl(url)) {
    const commentPageResponse = response as CommentPageResponse
    const noteId =
      getCommentPageNoteId(url) ??
      commentPageResponse.data?.comments?.find((comment) => comment.note_id)?.note_id

    state.currentUserId = commentPageResponse.data?.user_id ?? state.currentUserId
    rememberAuthorTags(state, commentPageResponse.data?.comments)

    if (noteId) {
      state.commentPageResponses[noteId] = commentPageResponse
    }

    return
  }

  if (isSubCommentPageUrl(url)) {
    const commentPageResponse = response as CommentPageResponse
    const comments = getSubCommentPageComments(commentPageResponse)
    const noteId =
      getCommentPageNoteId(url) ?? comments.find((comment) => comment.note_id)?.note_id
    const parentCommentId = getSubCommentPageParentCommentId(url)

    state.currentUserId = commentPageResponse.data?.user_id ?? state.currentUserId
    rememberAuthorTags(state, comments)

    if (noteId) {
      const cursor = getCommentPageCursor(url)
      const key = `${noteId}:${parentCommentId ?? "unknown"}:${cursor}`

      state.subCommentPageResponses[key] = {
        noteId,
        parentCommentId,
        response: commentPageResponse
      }
    }

    return
  }

  if (isFeedUrl(url)) {
    for (const item of (response as FeedResponse).data?.items ?? []) {
      rememberNoteOwner(state, item.note_card?.note_id ?? item.id, item.note_card?.user)
    }
  }
}

function getCapturedMessages(url: string, response: unknown, state: XhsCleanHookState) {
  if (isMentionsUrl(url)) {
    return ((response as MentionsResponse).data?.message_list ?? []).map((message) => {
      rememberNoteOwner(state, message.item_info?.id, message.item_info?.user_info)
      const noteOwnerUserId = getUserId(message.item_info?.user_info)

      return {
        ...message,
        current_user_id: state.currentUserId,
        is_current_user_note: isCurrentUserNote(
          state,
          noteOwnerUserId,
          message.title
        )
      }
    })
  }

  if (isCommentPageUrl(url)) {
    return flattenCommentPageComments(
      (response as CommentPageResponse).data?.comments ?? [],
      state
    )
  }

  if (isSubCommentPageUrl(url)) {
    const commentPageResponse = response as CommentPageResponse
    const comments = getSubCommentPageComments(commentPageResponse)
    const noteId =
      getCommentPageNoteId(url) ?? comments.find((comment) => comment.note_id)?.note_id

    return flattenSubCommentPageComments(
      commentPageResponse,
      state,
      noteId,
      getSubCommentPageParentCommentId(url)
    )
  }

  return []
}

function getCaptureSource(url: string, transport: "fetch" | "xhr") {
  if (isSubCommentPageUrl(url)) {
    return `comment/sub/page:${transport}`
  }

  if (isCommentPageUrl(url)) {
    return `comment/page:${transport}`
  }

  return `mentions:${transport}`
}

function emitCapturedMessages(
  state: XhsCleanHookState,
  url: string,
  response: unknown,
  transport: "fetch" | "xhr",
  requestGeneration: number
) {
  if (requestGeneration !== state.clearGeneration) {
    return
  }

  updateKnownState(state, url, response)

  const messages = getCapturedMessages(url, response, state)

  if (messages.length === 0) {
    return
  }

  window.dispatchEvent(
    new CustomEvent(MENTIONS_EVENT, {
      detail: {
        messages,
        source: getCaptureSource(url, transport)
      }
    })
  )
}

function emitStoredCommentPageMessages(state: XhsCleanHookState) {
  for (const [noteId, response] of Object.entries(state.commentPageResponses)) {
    if (!state.noteOwnerUserIds[noteId]) {
      continue
    }

    const messages = flattenCommentPageComments(response.data?.comments ?? [], state)

    if (messages.length === 0) {
      continue
    }

    window.dispatchEvent(
      new CustomEvent(MENTIONS_EVENT, {
        detail: {
          messages,
          source: "comment/page:owner-updated"
        }
      })
    )
  }

  for (const { noteId, parentCommentId, response } of Object.values(
    state.subCommentPageResponses
  )) {
    if (!state.noteOwnerUserIds[noteId]) {
      continue
    }

    const messages = flattenSubCommentPageComments(response, state, noteId, parentCommentId)

    if (messages.length === 0) {
      continue
    }

    window.dispatchEvent(
      new CustomEvent(MENTIONS_EVENT, {
        detail: {
          messages,
          source: "comment/sub/page:owner-updated"
        }
      })
    )
  }
}

function getWebpackRequire() {
  let webpackRequire: WebpackRequire | undefined
  window.webpackChunkxhs_pc_web?.push([
    [`xhs_clean_runtime_${Date.now()}`],
    {},
    (require) => {
      webpackRequire = require
    }
  ])

  return webpackRequire
}

function findDeleteCommentApi(state: XhsCleanHookState) {
  if (state.deleteCommentApi) {
    return state.deleteCommentApi
  }

  const webpackRequire = getWebpackRequire()

  if (!webpackRequire) {
    throw new Error("未找到小红书 webpack runtime")
  }

  const findApiInExports = (exports?: Record<string, unknown>) => {
    if (!exports) {
      return undefined
    }

    return Object.values(exports).find((value): value is PageDeleteCommentApi => {
      if (typeof value !== "function") {
        return false
      }

      const source = Function.prototype.toString.call(value)
      return (
        source.includes("postApiSnsWebV1CommentDelete") ||
        source.includes("/api/sns/web/v1/comment/delete") ||
        source.includes("web-删除评论")
      )
    })
  }

  for (const moduleRecord of Object.values(webpackRequire.c)) {
    const api = findApiInExports(moduleRecord.exports)

    if (api) {
      state.deleteCommentApi = api
      return api
    }
  }

  for (const [moduleId, moduleFactory] of Object.entries(webpackRequire.m)) {
    if (
      !Function.prototype.toString
        .call(moduleFactory)
        .includes("postApiSnsWebV1CommentDelete")
    ) {
      continue
    }

    const moduleExports = webpackRequire(moduleId)
    const api = findApiInExports(moduleExports)

    if (api) {
      state.deleteCommentApi = api
      return api
    }
  }

  throw new Error("未找到小红书评论删除 API")
}

function installPageHooks() {
  const state = (window.__xhsCleanHookState ??= {
    installed: false,
    xhrInstalled: false,
    noteOwnerUserIds: {},
    commentPageResponses: {},
    subCommentPageResponses: {},
    clearGeneration: 0
  })

  state.noteOwnerUserIds ??= {}
  state.commentPageResponses ??= {}
  state.subCommentPageResponses ??= {}
  state.clearGeneration ??= 0

  if (!state.ensureFetchWrapped) {
    state.ensureFetchWrapped = () => {
      const currentFetch = window.fetch

      if (!currentFetch || (currentFetch as { __xhsCleanWrapped?: boolean }).__xhsCleanWrapped) {
        return
      }

      const wrappedFetch = async function (
        this: typeof window,
        input: RequestInfo | URL,
        init?: RequestInit
      ) {
        const url = getFetchUrl(input)
        const requestGeneration = state.clearGeneration
        const response = await currentFetch.call(this, input, init)

        if (isTrackedUrl(url)) {
          response
            .clone()
            .json()
            .then((result: unknown) => {
              emitCapturedMessages(state, url, result, "fetch", requestGeneration)

              if (isFeedUrl(url) && requestGeneration === state.clearGeneration) {
                emitStoredCommentPageMessages(state)
              }
            })
            .catch(() => undefined)
        }

        return response
      } as typeof fetch & { __xhsCleanWrapped?: boolean }

      wrappedFetch.__xhsCleanWrapped = true
      window.fetch = wrappedFetch
    }
  }

  state.ensureFetchWrapped()

  if (!state.fetchInterval) {
    state.fetchInterval = window.setInterval(() => {
      state.ensureFetchWrapped?.()
    }, 1000)
  }

  if (!state.xhrInstalled) {
    state.xhrInstalled = true

    const originalOpen = XMLHttpRequest.prototype.open
    const originalSend = XMLHttpRequest.prototype.send

    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null
    ) {
      ;(this as XMLHttpRequest & { __xhsCleanUrl?: string }).__xhsCleanUrl =
        typeof url === "string" ? url : url.toString()

      return originalOpen.call(this, method, url, async ?? true, username, password)
    }

    XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
      ;(this as XMLHttpRequest & { __xhsCleanGeneration?: number }).__xhsCleanGeneration =
        state.clearGeneration

      this.addEventListener("loadend", () => {
        const xhr = this as XMLHttpRequest & {
          __xhsCleanUrl?: string
          __xhsCleanGeneration?: number
        }

        if (
          !xhr.__xhsCleanUrl ||
          !isTrackedUrl(xhr.__xhsCleanUrl) ||
          !xhr.responseText
        ) {
          return
        }

        try {
          emitCapturedMessages(
            state,
            xhr.__xhsCleanUrl,
            JSON.parse(xhr.responseText),
            "xhr",
            xhr.__xhsCleanGeneration ?? state.clearGeneration
          )

          if (isFeedUrl(xhr.__xhsCleanUrl) && xhr.__xhsCleanGeneration === state.clearGeneration) {
            emitStoredCommentPageMessages(state)
          }
        } catch {
          // Ignore non-JSON responses from unrelated browser instrumentation.
        }
      })

      return originalSend.call(this, body)
    }
  }

  if (!state.installed) {
    state.installed = true

    window.addEventListener(CLEAR_MESSAGES_EVENT, () => {
      state.clearGeneration += 1
      state.commentPageResponses = {}
      state.subCommentPageResponses = {}
    })

    window.addEventListener(DELETE_REQUEST_EVENT, (event) => {
      const detail = (event as CustomEvent<DeleteRequestEventDetail>).detail

      if (!detail?.requestId || !detail.noteId || !detail.commentId) {
        return
      }

      let deleteApi: PageDeleteCommentApi

      try {
        deleteApi = findDeleteCommentApi(state)
      } catch (error) {
        window.dispatchEvent(
          new CustomEvent<DeleteResultEventDetail>(DELETE_RESULT_EVENT, {
            detail: {
              requestId: detail.requestId,
              ok: false,
              error: error instanceof Error ? error.message : "未找到小红书评论删除 API"
            }
          })
        )
        return
      }

      void window.Promise.resolve(
        deleteApi({
          noteId: detail.noteId,
          commentId: detail.commentId
        })
      )
        .then((result) => {
          const response =
            result && typeof result === "object"
              ? (result as {
                  code?: number
                  success?: boolean
                  msg?: string
                  message?: string
                })
              : undefined
          const ok = response?.success !== false && response?.code !== -1

          window.dispatchEvent(
            new CustomEvent<DeleteResultEventDetail>(DELETE_RESULT_EVENT, {
              detail: {
                requestId: detail.requestId,
                ok,
                error: ok ? undefined : response?.msg ?? response?.message ?? "删除失败"
              }
            })
          )
        })
        .catch((error: unknown) => {
          window.dispatchEvent(
            new CustomEvent<DeleteResultEventDetail>(DELETE_RESULT_EVENT, {
              detail: {
                requestId: detail.requestId,
                ok: false,
                error: error instanceof Error ? error.message : "删除失败"
              }
            })
          )
        })
    })
  }
}

installPageHooks()
