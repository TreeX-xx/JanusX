---
{
  "schema": "harness-note/2",
  "id": "19cd1394-b2cb-4819-8fde-5f12de16574c",
  "kind": "module",
  "lifecycle": "accepted",
  "created": "2026-09-26",
  "class": "architecture",
  "tags": ["product","surface"],
  "relations": [
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/41a64d3c-2811-4dc8-a1ab-2c5c541ec123"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/93151b7b-6a33-5e5d-bf83-f2109fc85389"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/b1978fa7-4732-553a-83c3-12aefd34c248"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/671574ba-c6e4-54ab-8fee-8d762e72f622"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/48db2e15-9318-5068-b300-b1913abf5463"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/b32f92b5-0256-5402-8a15-d19e9fa4db73"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/5c873080-4f76-597f-9fbd-0bdcc59a02a3"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/8688b5ab-1f7f-5ff9-ba1b-ef75b7fd5917"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/c0b4743b-71be-462a-97da-27e40bc5d67a"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/a162efb4-23a7-4468-95e6-7163fe7efdc0"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/7b4800da-0ea0-4f63-9f15-7ce60e721bd7"}
  ],
  "parent": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/b2e7f160-2d77-4cc4-8828-b9cf3e5d931a",
  "codeRefs": [
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/renderer/src/components/right-tools/RightDock.tsx", "symbol": "RightDock", "role": "entry"},
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/renderer/src/components/FileEditor.tsx", "symbol": "FileEditor", "role": "implementation"},
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/renderer/src/components/janus/JanusIsland.tsx", "symbol": "JanusIsland", "role": "implementation"}
  ],
  "updated": "2026-11-20T12:06:46Z",
  "moduleState": "partial"
}
---

# 工作台与产物界面

## Responsibility

工作台组织 pane、Island、侧边工具、对话和文件编辑窗口。`RightDock` 承载侧栏工具，`FileEditor` 与共享查看器负责文件阅读和编辑，`JanusIsland` 提供对话、动作和通知入口。会话持久化、Agent 执行和 Note 事务分别由所属模块管理。

## Design

工作区和全局工具各有自己的布局与焦点。[分屏与标签](pane-tab-reorder.md)维护拖动和恢复，[右侧工具区](right-dock.md)维护预览、固定和宽度。终端、文件树与对话中的文件通过[统一文件窗口](unified-file-window.md)打开。PDF、Office、Markdown、HTML 和源文件按类型使用[共享查看器](file-editor-experience.md)；旧[产物工作区](product-workspace.md)已退役。

[预览编辑窗口显示风格与外壳 UI 对齐方向](./preview-editor-display-style.md)记录 opencode 文件编辑显示调研：diff 与普通编辑显示同批向“行号色带 + 超淡行底色 + 不变区折叠”收敛（正常显示同批适配），与无色块设计语言同构。外壳 UI 对齐（滑动指示块 tab、文字 + 2px 强调条选中态、MonacoViewer 令牌化）与 A–D（正文薄纱/gutter 色带/词强调 1:4、编辑行高 24px、比较行高 20px、缩进 2 空格、不变区折叠、改动代码与行号同色、同源 +N/−N 徽标）已落地，竖条与缩进参考线经视觉复核撤除/禁用、tab 关闭钮可见性与悬浮反馈补齐；文件树红绿 git 状态色保持独立。

普通终端对话与 SuperAgent 复用输入和展示组件，各自按真实会话能力提供命令和操作。[双模式专题](terminal-dialog-dual-mode.md)维护各引擎的适配、审批、恢复与历史读取。

Codex 原生计划和 Claude 任务共用只读计划卡。每轮回复下方保留最新计划和已修改文件的数量。悬停回复底部的文件摘要可预览路径，点击「查看改动」在右侧按回执顺序列出文件，首次打开时全部收起，点文件名查看差异。Codex 还能从已确认的原生回执恢复历史计划，并在分页历史内按轮次显示文件。数据边界与验证见[轮次附件](./terminal-dialog-dual-mode.md#轮次附件的显示与历史恢复)。

自动化侧栏默认独立显示。点击小眼睛会连接对话，已有且可用的 SuperAgent 标签会被唤出，否则展开 Island 并避让面板，窄窗上下排列。联动时以反色眼睛、标题带和中性轮廓显示连接。关闭、显式收起或切换侧栏后解除连接，会话及草稿保留。界面约定与验证归[自动化专题](./ideas/automation-platform.md#承载方式与界面)。

[通知和眼睛行为](tasks/island-behavior-system.md)维护手势、通知队列与运行反馈。[备忘录](../knowledge/user-todo-janus.md)管理文件、星节点和 Chat 工具，工作台负责其布局与入口。

[主题机制](theme-system.md)维护应用与插件使用的语义颜色和共享样式。[插件契约](plugin-contract-v1.md)维护授权、命令、视图及服务边界；平台交付范围由[阶段计划](../planning/plugin-platform-roadmap.md)跟踪。工程 Note 的命名空间历史归[文档模块](../blueprint/documents/history/own-notes-namespace.md)。

## Acceptance criteria

以下为 2026-09-26 整理的历史验收，原编号、条文与勾选状态保留给已有 Task。篇数与迁移样例记录不代表当前范围。

- [x] AC-1: 本域 31 篇直接子全部携带有效 parent。
- [ ] AC-2: own-namespace 生命周期对保留两篇，不判重复删除。
- [ ] AC-3: 历史迁移样例已清理（2026-09-27 随鹈鹕骑行 Note 一并移除），不再保留隔离样例。
