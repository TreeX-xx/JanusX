---
{
  "schema": "harness-note/2",
  "id": "dcc5e8a0-7733-52a4-83c8-695c14ed8dd7",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-09-03",
  "parent": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/c0a75c6a-5d06-4088-b7ed-9ecdd835b3d3",
  "class": "architecture",
  "extensions": {
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-09-03-agent-note-queue-owned-dual-path-knowledge-pipeline--dcc5e8a0.md",
      "sourceHash": "09816c2aa45f2cdb1de5f3efcf8a7b1105fd5778bd1ab85a3014ccf427bfa680",
      "originalBodyHash": "389a695ce631ed1eb89090f499a0de269f056498166ba991cbd1137d92dae786",
      "category": "formal",
      "reason": "Retains the source decision in implemented lifecycle; body documents Queue-owned dual-path knowledge pipeline. No age-based archival.",
      "edits": ["Removed redundant Agent Note title prefix","Removed lifecycle duplicated by frontmatter"],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/implemented/architecture/2026-09-03-knowledge-pipeline.md",
        "sourceHash": "09816c2aa45f2cdb1de5f3efcf8a7b1105fd5778bd1ab85a3014ccf427bfa680",
        "originalBodyHash": "389a695ce631ed1eb89090f499a0de269f056498166ba991cbd1137d92dae786"
      }
    }
  },
  "updated": "2026-11-20T12:06:46Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/c1c04881-a2fb-430f-bc26-528027d0e5cf"
}
---

# 个人记忆处理队列与候选事实

## Problem

终端事件、个人对话和显式保存的来源不同。采集、异步处理与人工确认需要能独立恢复，以免重放观察时重复写入事实。

## Decision

`CaptureInbox` 在持久化和重放时检查个人采集策略。个人来源可进入处理队列；来自工程会话的用户陈述只有在画像和工程习惯采集同时开启时才作为习惯证据。`KnowledgeProcessingQueue` 管理调度和处理进度。确定性提取器保留个人事实路径，工程观察已退出项目事实生成。

候选进入个人审核与来源校验，已确认的个人记忆供 Chat 召回。工程文档通过[蓝图读取模块](../blueprint/documents/module.md)访问。迁移与保留的数据范围见[模块入口](module.md)。

## Alternatives considered

直接把处理状态写回每份观察会让采集与重试争用同一批文件。保留独立处理状态，允许重复调度按来源复核，并可在关闭采集后拦住排队输入。

## Consequences

个人记忆可以在本机保留来源、完成确认及撤回。旧双域队列、工程检索与 Wiki 的实验和交付条件保存在[历史需求](requirements/unified-memory-laya-primary.md)。
