---
{
  "schema": "harness-note/2",
  "id": "6083ec32-a6b4-4f31-826c-b2a05573b326",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-09-30",
  "class": "feature",
  "tags": ["blueprint","janus-chat","note-context","maintenance"],
  "updated": "2026-10-26T14:16:34Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/a09981f4-1a94-42ce-9255-2e1127cfa37b"
}
---

# 蓝图对话上下文跟随画布焦点成批注入

10-26 插件拆分已移除下述宿主画布焦点与维护面板，代码链接固定到清理前版本，保留原设计依据。插件目前支持当前 Note／子树／工作区范围，未据此签收原批量焦点、筛选和跨 checkout 的全部交互；当前边界归[官方插件计划](../../planning/blueprint-official-plugin.md)。
## Problem

蓝图右侧的 Janus 面板只能通过节点详情里的「维护此节点」进入。点一下，对话就被钉死在那一篇 Note 上——`BlueprintMaintenancePanel` 把 `noteRefs` 固定写成单元素数组（选中节点），用户想讨论一组相关节点，就必须逐个点、逐个重开。板面本身已经有筛选、搜索和选中这些「我在看哪一批」的表达，却没有任何一条通路把它们送到 Agent 手里。

这不是缺功能，是接线缺失。下游三段早就存在且互相兼容：

- `projectChatContext`（`src/main/harness/chat-context.ts`）本来就接受 ref 数组，上限 64 篇，逐篇读全文并做 hash 校验
- `normalizeEngineeringContext` 本来就接受 `noteRefs` 数组
- `bindProjectConversation` 只按 `viewRef` 认会话，所以批次变化不会重建对话

于是修复方向不是造新通道，而是把批次算出来送进去，并把「维护此节点」这个纯中转按钮删掉。

真正的障碍是字节预算：主进程原本在超过 120KB 时直接抛 `NOT_READY`。批量一旦成为常态，这个硬失败就从「保护」变成「打断」。

## Decision

新增纯函数 [blueprint-focus.ts](https://github.com/TreeX-X/JanusX/blob/26b3ad3bfda24070c5720b831ab5c85b54704a72/src/renderer/src/features/blueprint/blueprint-focus.ts)，按优先级把画布焦点解析成一次上下文范围：

1. 搜索词 / 状态 / kind 任一激活 → 命中的全部节点（`reason: 'filter'`）
2. 否则有选中节点 → 该节点的整棵子树（`reason: 'selection'`）
3. 否则 → 整张蓝图（`reason: 'view'`）

[BlueprintMaintenancePanel](https://github.com/TreeX-X/JanusX/blob/26b3ad3bfda24070c5720b831ab5c85b54704a72/src/renderer/src/components/blueprint/BlueprintMaintenancePanel.tsx) 直接消费这份结果：批量 `noteRefs`、以及面板顶部一行可见的范围声明。搜索词走 `useDeferredValue`，与画布自身一致，避免每敲一个字就重切一次 200 节点。`contextSelection` 退化为非工作台入口的回退来源，不再是进入对话的前提。

读写范围刻意分开：筛选命中整批时可写范围才放宽到 `{ type: 'blueprint' }`；仅仅选中一个节点时仍保持 `{ type: 'node', nodeId }`。用户没有表达批量意图时，写入权限不因为「看得见更多」而自动变宽。

[BlueprintMaintenanceActions](https://github.com/TreeX-X/JanusX/blob/26b3ad3bfda24070c5720b831ab5c85b54704a72/src/renderer/src/components/blueprint/BlueprintActionBar.tsx) 改为接收显式的 `nodeScope` 而非 `nodeId`，不再自行推断目标。跨 checkout 的组合成员按节点判定归属：解析不到就计入 `foreignNodeIds`，当整批都读不到时给出唯一可切换的 `foreignCheckoutPath`；批次横跨多个 checkout 时不提供切换目标，因为没有唯一答案。

[chat-context.ts](../../../../src/main/harness/chat-context.ts) 的字节预算改为降级而非失败：按调用方顺序注入，超出部分按 Note 标识逐条披露，并明确要求 Agent 不要对这些未注入的 Note 做推断。第一篇始终放行，否则单篇超大 Note 会让对话完全没有仓库视图。身份类失败（checkout 不可解析、hash 过期）保持硬失败——读到错基线的残缺内容比拒绝更糟。

## Alternatives considered

- 让 Agent 自己去调工具读 wiki：把裁剪责任交给模型，200 篇 Note 的语料既贵又不确定，且丢掉宿主的 hash 校验
- 保留「维护此节点」，只是让它多选：仍然要求一次显式点击，没解决「面板为什么是空的」
- 在渲染进程估算 Note 体积来提前裁剪：渲染进程只有 slim 快照，没有字节数，只能新增 N 次 IPC 去量，得不偿失
- 放宽 120KB 上限：把风险推给模型的上下文窗口，而不是在这里显式披露

## Consequences

打开工作台即有上下文：不再需要点击，右侧面板默认展开并自带范围声明行，声明什么被读了、什么因超限或跨 checkout 被跳过。跨 checkout 的组合节点从「整个面板死掉」变成「可切换工作区继续」。

`switchToSource` 的文案从「在 X 中维护」改为「切换到 X」——它现在确实只做切换。`action.maintainNode` 与其 i18n 字面量一并删除。

`projectChatContext` 不再对超限抛错。调用方若依赖 `NOT_READY` 提示用户缩小范围，会改为收到一段披露文本；这是有意的取舍，因为批量是新的常态。

## Verification

2026-09-30 落盘验证：范围解析与上下文预算各有单测，蓝图相关测试组保持通过；e2e 断言已从「单节点 Note 引用」改为「按画布焦点的批次」。

```text
npx vitest run tests/unit/blueprint-context-scope.test.ts tests/unit/project-chat-context.test.ts
npx vitest run tests/unit
npm run typecheck
npm run lint
```

新单测覆盖：空焦点读全图、选中读子树、筛选放宽写范围、失效选中、组合成员跨 checkout 分离、批次横跨多 checkout 时无切换目标、无 Note 身份的节点、URI 去重与 64 条上限；以及首篇必放行与 hash 过期仍硬失败。

`npx vitest run tests/unit` 剩余失败均为存量：`agent-notes-check` 报的 4 条是 debug-mode-plan 缺 Proposal/Risks、worktree-composer-entry-motion 缺 supersedes 范围字段、dsh-integration 路径不合规，与本次改动无关；`experimental-features`、`planche-theme`、`theme-registry` 为存量主题与开关漂移。

复查点：若日后要给 Janus 开放任意 Note 集合的写权限，应新增 `{ type: 'nodes' }` 范围变体，而不是继续复用 `blueprint` 全图范围。
