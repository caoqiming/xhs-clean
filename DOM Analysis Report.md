# DOM Analysis Report

## Scope

分析页面：`https://www.xiaohongshu.com/notification`

分析方式：Chrome DevTools DOM / accessibility snapshot / 只读页面脚本。未使用 XPath。

当前页面是小红书通知页，顶部有三个 tab：

- `评论和@`
- `赞和收藏`
- `新增关注`

当前激活的是 `评论和@` tab。评论消息和 @ / 回复类消息没有拆成两个独立列表，而是混在同一个通知列表中，需要通过动作文本区分。

## 1. 评论区域

评论区域位于通知页主体：

```css
.notification-page .tabs-content-container
```

当前列表容器：

```css
.tabs-content-container
```

当前已加载通知项数量约为 `300` 条。列表内每条通知项是 `.container`：

```css
.tabs-content-container > .container
```

观察到的结构：

```text
div.notification-page.ai-mode
  div.reds-sticky
    div.reds-tabs-list
      div.reds-tab-item.active.tab-item  -> 评论和@
      div.reds-tab-item.tab-item         -> 赞和收藏
      div.reds-tab-item.tab-item         -> 新增关注
  div.tabs-content-container
    div.container
    div.container
    div.container
```

## 2. @ 区域

当前页面没有发现独立的 `@` 区域 DOM 容器。

小红书把评论和 @ 类通知放在同一个 tab：

```css
.reds-tab-item.active.tab-item
```

其文本为：

```text
评论和@
```

因此推荐把 `评论和@` 作为统一消息区域处理，再根据每条通知的动作文本分类：

```css
.tabs-content-container > .container .interaction-hint
```

当前观察到的动作类型包括：

- `评论了你的笔记`
- `回复了你的评论`

如果后续出现 `@了你` / `提到了你`，预期也会出现在同一个 `.interaction-hint` 区域中。

## 3. 每条评论对应的 DOM

每条评论 / 回复通知对应的最外层 DOM 是：

```css
.tabs-content-container > .container
```

单条通知结构：

```text
div.container
  a.user-avatar
    img.avatar-item.user-avatar
  div.main
    div.info
      div.user-info
      div.interaction-hint
      div.interaction-content
      div.quote-info        // 部分通知存在
      div.actions           // 可回复/点赞时存在
    div.extra
      img.extra-image
```

推荐把 `div.container` 作为隐藏目标，因为它包含头像、用户名、评论正文、引用笔记、回复入口和右侧图片。

## 4. 评论正文

评论正文位于：

```css
.tabs-content-container > .container .interaction-content
```

示例文本：

```text
就是个人用 好用了以后才可能分享。赚钱。毕竟是vibe coding
```

```text
极速降低购买欲
```

```text
做了一个自己出创意 脚本 到出提示词 做图 做视频的网站 目前还在继续完善ing 感觉是够用了。谁有便宜买api的渠道可以私信我[图片]
```

注意：

- `.interaction-content` 是评论者本次评论 / 回复正文。
- `.quote-info` 是被评论的原笔记或原评论上下文，不应该当作待审核评论正文。
- `原评论已删除` / `该评论已删除` 也出现在 `.interaction-content`，这类应跳过分析。

## 5. 用户名

用户名位于：

```css
.tabs-content-container > .container .user-info a
```

或兜底：

```css
.tabs-content-container > .container .user-info
```

示例：

```text
陈十七在读书
Z_Zeh
momo
吃啥有答案
```

用户主页链接可从同一条通知内的 `a[href^="/user/profile/"]` 提取：

```css
.tabs-content-container > .container a[href^="/user/profile/"]
```

链接中包含用户 ID，例如：

```text
/user/profile/640d72a8000000001001f460?channelType=web_engagement_notification_page&channelTabId=mentions&xsec_token=...
```

## 6. 评论唯一标识

当前 DOM 中没有发现明确的评论 ID，例如 `commentId` / `comment_id` / `data-comment-id`。

可提取到的候选信息：

- 用户 ID：来自 `/user/profile/{userId}`。
- `xsec_token`：来自用户主页链接 query，但这是跳转安全 token，不是评论唯一 ID。
- 笔记图片 URL：来自 `.extra-image`，可辅助识别对应笔记，但不是评论唯一 ID。
- 动作时间：来自 `.interaction-hint .interaction-time`。
- 评论正文：来自 `.interaction-content`。

推荐临时唯一键：

```text
hash(userProfileId + actionText + interactionTime + commentText + noteImageUrl)
```

如果后续网络请求中能拿到服务端通知 ID 或评论 ID，应优先使用服务端 ID。

## 7. React 动态 class 判断

当前页面 DOM 更像 Vue scoped CSS，而不是 React 运行时动态 class。

证据：

- 大量节点带有 `data-v-xxxxxxx` 属性，例如 `data-v-2b3b44c7`、`data-v-7498b3b4`。
- 这是 Vue SFC scoped style 的典型输出。
- 没有观察到类似 CSS Module hash class 或 React 框架特征 class。

不建议依赖的动态 / 易变属性：

```text
data-v-2b3b44c7
data-v-7498b3b4
data-v-4373672f
data-v-b6f1d5f2
data-v-39c21606
data-v-6baa03d9
data-v-9403e00c
data-v-76bb4847
```

这些 `data-v-*` 是构建产物，版本变化后可能改变。

相对稳定的语义 class：

```text
notification-page
tabs-content-container
container
main
info
user-info
interaction-hint
interaction-time
interaction-content
quote-info
actions
extra
extra-image
user-avatar
avatar-item
reds-tab-item
reds-tabs-list
active
```

其中 `container` / `main` / `info` 名称较通用，建议一定要限定在 `.notification-page .tabs-content-container` 下使用，避免误匹配。

## 8. 推荐最稳定 selector

页面根节点：

```css
.notification-page
```

通知 tab 列表：

```css
.notification-page .reds-tabs-list
```

当前激活 tab：

```css
.notification-page .reds-tab-item.active
```

评论和 @ 列表容器：

```css
.notification-page .tabs-content-container
```

每条评论 / 回复通知：

```css
.notification-page .tabs-content-container > .container
```

用户名：

```css
.notification-page .tabs-content-container > .container .user-info a
```

用户名兜底：

```css
.notification-page .tabs-content-container > .container .user-info
```

用户主页链接：

```css
.notification-page .tabs-content-container > .container a[href^="/user/profile/"]
```

动作文本和时间：

```css
.notification-page .tabs-content-container > .container .interaction-hint
```

时间：

```css
.notification-page .tabs-content-container > .container .interaction-time
```

评论正文：

```css
.notification-page .tabs-content-container > .container .interaction-content
```

被评论内容 / 笔记上下文：

```css
.notification-page .tabs-content-container > .container .quote-info
```

右侧笔记图片：

```css
.notification-page .tabs-content-container > .container .extra-image
```

隐藏目标：

```css
.notification-page .tabs-content-container > .container
```

## 9. 推荐解析策略

对每个 `.notification-page .tabs-content-container > .container`：

1. 读取 `.interaction-hint`，判断消息类型。
2. 只处理包含以下文本的通知：
   - `评论了你的笔记`
   - `回复了你的评论`
   - 后续可扩展：`@了你` / `提到了你`
3. 读取 `.interaction-content` 作为待分析评论正文。
4. 如果正文是 `原评论已删除` 或 `该评论已删除`，跳过。
5. 从 `.user-info` 读取用户名。
6. 从 `a[href^="/user/profile/"]` 提取用户 ID。
7. 从 `.interaction-time` 或 `.interaction-hint` 提取时间。
8. 从 `.extra-image` 提取笔记图片 URL。
9. 生成 fingerprint 作为临时去重 key。
10. 如果 AI 判定低质量，隐藏整条 `.container`。

## 10. MutationObserver 建议

推荐 observer 目标：

```css
.notification-page .tabs-content-container
```

配置：

```js
{
  childList: true,
  subtree: false
}
```

原因：

- 新通知项以 `.container` 作为直接子节点追加到 `.tabs-content-container`。
- 不需要观察整页 `document.body`。
- `subtree: false` 可以减少头像、图片、点赞弹窗等内部变化带来的噪音。

如果进入页面时 `.tabs-content-container` 尚未出现，可以短暂观察：

```css
document.body
```

找到 `.notification-page .tabs-content-container` 后立刻切换到精确 observer。

## 11. 风险和注意事项

- `data-v-*` 不稳定，不要写入 selector。
- `.container` 名称过于通用，必须加上 `.notification-page .tabs-content-container >` 作为上下文。
- 当前 DOM 未暴露真实评论 ID，初期需要 fingerprint 去重。
- `评论和@` 是同一个 tab，不要假设存在独立 @ 容器。
- `.quote-info` 是上下文，不是本次评论正文。
- 小红书是 SPA，页面切换后需要重新查找 `.notification-page` 和 `.tabs-content-container`。

## 12. 笔记详情页评论区分析

分析页面：

```text
https://www.xiaohongshu.com/explore/6a37dea900000000070220a7?xsec_token=...&xsec_source=pc_notice
```

页面标题：

```text
秀一下你们vibe coding的成果 - 小红书
```

注意：小红书 SPA 页面切换后，DOM 中可能仍残留通知页 `.notification-page` 和 `.tabs-content-container` 节点。分析笔记详情页时必须限定在 `#noteContainer` 下，避免误选通知页评论。

笔记详情页根节点：

```css
#noteContainer
```

详情页评论区：

```css
#noteContainer .comments-el
#noteContainer .comments-container
```

评论列表容器：

```css
#noteContainer .comments-container .list-container
```

当前首屏已加载评论项数量：

```text
18
```

页面显示评论总数：

```text
共 411 条评论
```

## 13. 笔记详情页每条评论 DOM

一级评论：

```css
#noteContainer .comments-container .comment-item:not(.comment-item-sub)
```

二级回复：

```css
#noteContainer .comments-container .comment-item.comment-item-sub
```

一级评论通常包在：

```css
#noteContainer .comments-container .parent-comment
```

回复列表通常包在：

```css
#noteContainer .comments-container .reply-container
```

单条评论结构：

```text
div.comment-item#comment-{commentId}
  div.comment-inner-container
    div.avatar
      a[href^="/user/profile/"]
    div.right
      div.author-wrapper
        a.name
      div.content
        span.note-text
      div.comment-picture       // 部分评论存在
      div.date
      div.interactions
        div.like
        div.reply
    div.comment-menu
      div.delete-dropdown
        svg.more
```

二级回复结构类似，但外层多一个 class：

```css
.comment-item.comment-item-sub
```

## 14. 评论 ID 获取方式

详情页 DOM 中可以直接获取评论 ID。

评论节点格式：

```html
<div id="comment-6a3e41e20000000015009157" class="comment-item comment-item-sub">
```

提取规则：

```text
commentId = element.id.replace("comment-", "")
```

示例：

```text
DOM id: comment-6a3b673d0000000015007e10
commentId: 6a3b673d0000000015007e10
```

```text
DOM id: comment-6a3e41e20000000015009157
commentId: 6a3e41e20000000015009157
```

这个 ID 与评论接口返回字段一致：

```json
{
  "id": "6a3e41e20000000015009157",
  "note_id": "6a37dea900000000070220a7",
  "content": "极速降低购买欲[doge]"
}
```

一级评论 ID 来自：

```text
data.comments[].id
```

二级回复 ID 来自：

```text
data.comments[].sub_comments[].id
```

二级回复还会带目标评论：

```text
target_comment.id
```

示例：

```json
{
  "id": "6a3e41e20000000015009157",
  "target_comment": {
    "id": "6a3b673d0000000015007e10"
  }
}
```

## 15. 笔记 ID 获取方式

笔记 ID 可以从 URL path 获取：

```text
/explore/6a37dea900000000070220a7
```

提取结果：

```text
noteId = 6a37dea900000000070220a7
```

接口响应中的评论也带同一个字段：

```json
{
  "note_id": "6a37dea900000000070220a7"
}
```

## 16. 评论正文、用户名和用户 ID

评论正文：

```css
#noteContainer .comments-container .comment-item .content
```

更精确：

```css
#noteContainer .comments-container .comment-item .content .note-text
```

用户名：

```css
#noteContainer .comments-container .comment-item .name
```

用户 ID：

```css
#noteContainer .comments-container .comment-item .name[data-user-id]
```

示例 DOM：

```html
<a class="name" data-user-id="640d72a8000000001001f460">
  陈十七在读书
</a>
```

可提取：

```text
username = 陈十七在读书
userId = 640d72a8000000001001f460
```

评论时间和地区：

```css
#noteContainer .comments-container .comment-item .date
```

示例：

```text
1小时前上海
2天前浙江
昨天 15:59湖北
```

## 17. 删除评论按钮

每条评论右上角都有评论菜单：

```css
#noteContainer .comments-container .comment-item .comment-menu
```

菜单里的更多按钮：

```css
#noteContainer .comments-container .comment-item .comment-menu .delete-dropdown
```

更多图标：

```css
#noteContainer .comments-container .comment-item .comment-menu .delete-dropdown svg.more
```

观察到的 DOM：

```html
<div class="comment-menu">
  <div class="delete-dropdown">
    <svg class="reds-icon more" width="16" height="16">
      <use xlink:href="#more"></use>
    </svg>
  </div>
</div>
```

二级回复的菜单多一个 class：

```css
#noteContainer .comments-container .comment-item.comment-item-sub .comment-menu.comment-menu-sub
```

删除入口判断：

- `delete-dropdown` 是删除/更多菜单的触发器，不是最终删除按钮。
- 最终删除菜单项应在点击或 hover `.delete-dropdown` 后出现。
- 本次分析没有点击实际 `删除` 菜单项，避免误删评论。
- 当前 DOM 中已稳定存在 `.delete-dropdown`，但弹层菜单内容未在静态 DOM 中常驻。

推荐交互链路：

```text
commentItem
  -> .comment-menu .delete-dropdown
  -> click / hover 打开菜单
  -> 在弹层中寻找文本为“删除”的 .menu-item
  -> 点击“删除”
  -> 如出现确认弹窗，再点击确认
```

不建议直接依赖全局 `.menu-item`，因为页面中多个菜单、弹窗和通知页残留节点可能同时存在。应先记录目标 `commentId`，打开该评论的 `.delete-dropdown`，再从新出现的可见弹层中找 `删除`。

## 18. 评论接口

详情页评论通过下面接口加载：

```text
GET https://edith.xiaohongshu.com/api/sns/web/v2/comment/page
```

当前捕获请求：

```text
/api/sns/web/v2/comment/page?note_id=6a37dea900000000070220a7&cursor=&top_comment_id=6a3e41e20000000015009157&image_formats=jpg,webp,avif&xsec_token=...
```

关键 query：

```text
note_id
cursor
top_comment_id
xsec_token
```

响应结构：

```text
data.comments[]
data.comments[].sub_comments[]
```

关键字段：

```text
id
note_id
content
user_info.user_id
user_info.nickname
create_time
ip_location
like_count
sub_comment_count
target_comment.id
```

本次未捕获到删除接口请求，因为没有实际点击删除确认。后续实现自动删除前，应单独在 DevTools Network 中手动删除一条测试评论，确认删除接口、method、payload 和确认弹窗流程。

## 19. 详情页推荐 Selector

详情页评论区根节点：

```css
#noteContainer .comments-container
```

所有已加载评论：

```css
#noteContainer .comments-container .comment-item[id^="comment-"]
```

一级评论：

```css
#noteContainer .comments-container .comment-item[id^="comment-"]:not(.comment-item-sub)
```

二级回复：

```css
#noteContainer .comments-container .comment-item[id^="comment-"].comment-item-sub
```

评论正文：

```css
#noteContainer .comments-container .comment-item[id^="comment-"] .content
```

用户名：

```css
#noteContainer .comments-container .comment-item[id^="comment-"] .name
```

用户 ID：

```css
#noteContainer .comments-container .comment-item[id^="comment-"] .name[data-user-id]
```

评论时间：

```css
#noteContainer .comments-container .comment-item[id^="comment-"] .date
```

更多/删除菜单触发器：

```css
#noteContainer .comments-container .comment-item[id^="comment-"] .comment-menu .delete-dropdown
```

隐藏目标：

```css
#noteContainer .comments-container .comment-item[id^="comment-"]
```

## 20. 详情页解析建议

对每个：

```css
#noteContainer .comments-container .comment-item[id^="comment-"]
```

执行：

1. 从 `element.id` 提取 `commentId`。
2. 从 URL 提取 `noteId`。
3. 从 `.name` 提取用户名。
4. 从 `.name[data-user-id]` 提取用户 ID。
5. 从 `.content` 提取评论正文。
6. 从 `.date` 提取时间和地区。
7. 用 `.comment-item-sub` 判断是否二级回复。
8. 如需删除，先点击该评论内的 `.comment-menu .delete-dropdown`。
9. 在新出现的可见弹层中找 `删除` 菜单项。
10. 删除前再次校验 `commentId` 与当前目标一致。

详情页比通知页更适合做删除动作，因为它能直接拿到真实 `commentId`，而通知页目前没有在 DOM 中暴露评论 ID。
