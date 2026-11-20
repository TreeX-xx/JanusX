---
{
  "schema": "harness-note/2",
  "id": "ee0e8ff1-8aba-560e-8585-498c71f1718c",
  "kind": "decision",
  "lifecycle": "archived",
  "created": "2026-09-18",
  "class": "architecture",
  "extensions": {
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-09-18-agent-note-reversible-managed-writes--ee0e8ff1.md",
      "sourceHash": "65f3b40a30536702887f847e228eb2f9e7cffd7f20b7f4f9d5059397cd75846f",
      "originalBodyHash": "48511af8329d34d975e5676c89ef5b8b7b7947c655f722d36b2b84127c5216d0",
      "category": "formal",
      "reason": "Retains the source decision in implemented lifecycle; body documents Reversible managed writes. No age-based archival.",
      "edits": ["Removed redundant Agent Note title prefix","Removed lifecycle duplicated by frontmatter"],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/implemented/architecture/2026-09-18-harness-undo.md",
        "sourceHash": "65f3b40a30536702887f847e228eb2f9e7cffd7f20b7f4f9d5059397cd75846f",
        "originalBodyHash": "48511af8329d34d975e5676c89ef5b8b7b7947c655f722d36b2b84127c5216d0"
      }
    }
  },
  "updated": "2026-11-20T12:06:46Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/a09981f4-1a94-42ce-9255-2e1127cfa37b",
  "disposition": {"reason": "旧宿主的通用维护撤销面板已退出。共享事务的反向操作和建议修复撤回有各自的调用边界。"}
}
---

# 旧宿主维护写入的撤销设计

## Problem

旧宿主允许维护面板直接修改多个 Note，误操作需要在后续编辑之后仍能识别可逆的文件。

## Decision

当时的实现按写入前后哈希预览整批反向变更。存在冲突时整批停止，能够撤回时另开事务，保留原回执。当前官方插件的[维护确认](blueprint-maintenance-approval-gap.md)采用文件预览和确认写入，普通维护对话已撤下独立审计与通用撤销入口。

## Alternatives considered

Git 恢复只能找回版本控制中已有的内容。跳过冲突文件会留下半次撤销的状态，因此历史方案采用整批核验。

## Consequences

共享引擎仍可承载需要反向操作的调用。插件的[建议定向修复](../navigation/note-updates-and-suggestion-navigation.md#建议定向修复)有独立的修复身份和撤回条件。
