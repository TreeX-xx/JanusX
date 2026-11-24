---
{
  "schema": "harness-note/2",
  "id": "35d88be6-50e5-466b-9514-9ecd7ac8ba7e",
  "kind": "module",
  "lifecycle": "accepted",
  "created": "2026-10-08",
  "updated": "2026-11-24T15:03:40.855Z",
  "parent": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/dc1aca7c-408f-406d-add4-ba78d556b662",
  "moduleState": "partial",
  "relations": [
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/91dac1f7-1814-400f-802e-5229ff6b0228" }
  ],
  "codeRefs": [
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/main/git/worktrees.ts",
      "role": "entry"
    },
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/main/ipc/worktree-handlers.ts",
      "role": "implementation"
    },
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/renderer/src/features/workspace/actions.ts",
      "role": "implementation"
    },
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/renderer/src/stores/worktree.ts",
      "role": "implementation"
    }
  ]
}
---

# 工作树隔离与切换

## Responsibility

管理 Git worktree 的发现、创建、删除、Ship 合并，以及活动工作树对终端、文件树和界面状态的作用范围。工作区保留工程注册身份。

## Design

工作树从本地 Git 事实读取，路径归一后再作为选择和缓存键；切换只改变有效目录及对应视图。创建、删除、合并和推送保持各自明确操作。会话与快照通过作用目录和 sessionId 协作，不复制它们的持久化职责。

SuperAgent P2 通过显式 `isolated` 创建和 `worktree-only` 删除模式复用 API：固定提交、路径和分支，不自动共享依赖／复制配置，删除保留分支；旧手动入口默认行为保持兼容。Git 检查与受控合并归 `controlled-worktree.ts`，工作绑定、具体批准与执行占用由 [Agent 环境模块](../../agent/superagent-environments.md)负责，不在手动侧栏维护第二套批准状态。

## Related documents

[Worktree create, delete and Ship merge](worktree-create-delete.md) 维护生命周期操作；[sidebar-scoping](worktree-sidebar-scoping.md) 维护侧栏行、文件树作用域与选择器；[path-avatar](worktree-path-avatar.md) 维护路径归一与工作区文件夹图标。
