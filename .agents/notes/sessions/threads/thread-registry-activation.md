---
{
  "schema": "harness-note/2",
  "id": "d9f1d453-d9cc-5fba-8655-6ac51f3cb75c",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-09-18",
  "class": "architecture",
  "extensions": {
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-09-18-agent-note-thread-registry-with-activation-and-confirmed-close--d9f1d453.md",
      "sourceHash": "5468c18b4366befe3b5835314bcd292e085a4c9c927b943ad053c991d3dfe910",
      "originalBodyHash": "d0471cd506ded09335e0038d67f9a79bac017d7ffd869a33c25f145af95382f9",
      "category": "formal",
      "reason": "Retains the source decision in implemented lifecycle; body documents Thread registry with activation and confirmed close. No age-based archival.",
      "edits": [
        "Rebased Markdown destination: ../../archived/architecture/2026-09-18-thread-close-confirmation.md -> ./2026-09-18-thread-close-confirmation--abb1ccb3.md",
        "Removed redundant Agent Note title prefix",
        "Removed lifecycle duplicated by frontmatter"
      ],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/implemented/architecture/2026-09-18-thread-registry-activation.md",
        "sourceHash": "753c14664990133198900ac3a4e474e9152bc66ef2604c7e500fac71c39a9f48",
        "originalBodyHash": "029490d0ce859af7f4c141394dd0c96f5adc09e787412bde4982aaf588258daf"
      }
    }
  },
  "updated": "2026-11-20T12:06:46Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/0fc34aee-911c-44f3-b873-a1272d93631a"
}
---

# Task 线程的列举、激活与关闭

## Problem

一次运行结束后，后续修复可能还需要它的尝试记录与模型端点。执行状态和线程生命周期需要分别维护。

## Decision

`listTaskThreads` 从本地运行记录与线程文件生成列表。`openTaskThread` 按需创建或载入线程，返回已有尝试与模型信息。关闭通过显式操作进入 `runThreadClose`：IPC 拒绝正在本机执行的 run，后端再检查运行状态；允许关闭时清理线程转录、thread.json 和 briefs。Task Note、运行记录和回执仍可追溯。

## Alternatives considered

单独持久化线程索引会引入需要与运行文件同步的状态。按空闲时间或完成状态自动关闭会让用户失去修复上下文，因此保留显式关闭。

## Consequences

桌面后端保留这组 IPC，旧独立任务面板已退役。后续入口需要表达关闭意图，并处理占用拒绝。源码见[执行适配器](../../../../src/main/harness/execution-adapter.ts)及[IPC](../../../../src/main/ipc/harness-handlers.ts)。
