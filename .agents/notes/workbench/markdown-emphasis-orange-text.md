---
{
  "schema": "harness-note/2",
  "id": "0d703ca1-d703-451f-9ac6-15792c08f45d",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-09-27",
  "class": "feature",
  "updated": "2026-11-20T05:15:30Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/19cd1394-b2cb-4819-8fde-5f12de16574c"
}
---

# Markdown 强调与行内代码的颜色边界

## Problem

用户反馈正文强调与橙色行内代码混杂，难以辨认重点。此前仅调整 strong 的颜色遗漏了 em、行内代码及链接继承的旧橙色样式。

## Decision

2026-11-13 输入84优化设置页的表达：色块与十六进制输入组合为一个中性边框控件，恢复默认保留独立操作；旧说明句改成并列的“正文重点 · 加粗／关键内容”和“行内代码 · 颜色／field_name”样例。只有代码样例使用当前配置色，标签使用弱化正文色，关键内容保持600字重。颜色存储、按主题隔离、无效输入恢复及跨窗口同步沿用原机制。证据见 artifacts/superagent-settings-e237da38/color/ 与浏览器回归记录。

2026-11-13 回答文字规则（按用户最新反馈修订）：正文强调只通过600字重表达，strong／em／mark 不再染色；普通链接继承正文色并常驻下划线，链接内代码继续使用代码色。只有反引号形成的行内代码（字段名、命令等）使用 conversation-emphasis；列表、表格、引用和嵌套加粗中的行内代码遵循同一规则。有语言和无语言代码块都保持正文色，不能凭 className 是否为空将无语言代码块误判为行内代码。普通对话、SuperAgent 流式／完成回答及 Worker 报告共用此规则，辅助聊天也由 ChatContent 的 chat-markdown 统一覆盖。

设置 → 常规 → 外观与语言的“内容强调色”同时控制对话行内代码与文件预览的强调色，示例展示正文加粗与彩色 field_name。保存、恢复默认和跨窗口同步见[主题机制](theme-system.md)。

MarkdownViewer、LocalFileStage、QuickNote 和 NoteWikiPanel 共享 Markdown 渲染组件，加粗、斜体和行内代码读取 shell-accent-strong，背景透明。双击文件打开的内嵌编辑区和浮窗将本地强调令牌映射到内容强调色。产物阅读、QuickNote 和 NoteWikiPanel 继续使用应用主题的强调色。聊天使用自己的 Markdown 排版规则。

## Alternatives considered

- 继续让加粗文字使用自定义色：不符合用户最新要求，且仍会与代码争夺视觉重点。
- 全部恢复橙色：保留了用户指出的辨识问题。
- 同时修改所有文档预览：本次范围是回答输出，文档阅读器继续保留既有规则。

## Consequences

对话用字重表达正文重点，用可配置颜色区分行内代码，并用下划线标记链接。文件编辑窗口沿用预览文档的强调规则，并与对话共享用户选择的强调色。图片、表格和代码块复制行为继续复用共享组件。

原先无底色的橙色强调决定已被聊天范围内的新规则取代。2026-10-08 的历史验证为类型、定向 lint 与 QuickNote 单测13项通过；该证据不代表本轮聊天规则的验证。当前验证记录归主题机制 Note 与 artifacts/inline-code-color-20261113/。
