---
{
  "schema": "harness-note/2",
  "id": "c1c04881-a2fb-430f-bc26-528027d0e5cf",
  "kind": "module",
  "lifecycle": "accepted",
  "created": "2026-10-03",
  "class": "architecture",
  "tags": ["memory","knowledge"],
  "parent": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/b2e7f160-2d77-4cc4-8828-b9cf3e5d931a",
  "codeRefs": [
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/main/memo/store.ts",
      "symbol": "MemoStore",
      "role": "entry"
    },
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/main/knowledge/memory-domain-controls.ts",
      "symbol": "installMemoryDomainControls",
      "role": "entry"
    },
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/main/knowledge/processing-queue.ts",
      "symbol": "KnowledgeProcessingQueue",
      "role": "entry"
    },
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/main/knowledge/retire-engineering-assets.ts",
      "role": "implementation"
    }
  ],
  "relations": [
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/8688b5ab-1f7f-5ff9-ba1b-ef75b7fd5917"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/844bc2f1-3be4-4b47-83ca-0ef792bc5c1d"}
  ],
  "updated": "2026-11-20T12:06:46Z",
  "moduleState": "partial"
}
---

# 个人记忆与共享来源

## Responsibility

本模块维护个人记忆、画像与对话召回，以及供用户和 Chat 共用的备忘录。工程文档和工程审核由[蓝图](../blueprint/module.md)维护。

## Design

[采集与处理队列](knowledge-pipeline.md)保存来源并调度个人候选处理。工程会话中可归因到用户的陈述，只有在画像及工程习惯采集同时开启时才进入习惯证据。个人工作台支持查看来源、人工确认、纠正和遗忘，Chat 使用个人 BM25 召回。设置与采集的约束见[分域控制](memory-domain-controls.md)。

[备忘录](user-todo-janus.md)以独立文件保存星节点和记录。手动编辑和模型工具共用局部操作与修订检查，发送时捕获对应的选星。备忘录和个人记忆有各自的数据与操作入口。

旧工程 Wiki、图谱、工程召回和独立知识 MCP 已退出。`retireEngineeringAssets` 只清理可识别的旧工程产物，混合事实中保留个人及归属不明的记录。Laya 运行时与设置已退出。迁移和验证边界见[实施基线](../blueprint/implementation-baseline.md)。

## Related documents

[个人工作台](personal-memory-workspace.md)记录后续产品方向。[记忆与知识演进专题](requirements/memory-knowledge.md)保留 M1–M4 和旧方案索引；[知识审核交付 Task](tasks/knowledge-review-status-audit-plan.md)保存当时的固定验收与执行证据。

## Acceptance criteria

- [x] AC-1: 队列与个人召回职责可定位到当前代码，工程专用生成和检索入口已退出。
- [x] AC-2: 当前能力、后置个人建设与未验收项分别说明，不以旧模型实验替代新审核验收。
