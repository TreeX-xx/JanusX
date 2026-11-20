---
{
  "schema": "harness-note/2",
  "id": "b766003d-d1a9-5e67-9b92-d32167421cc4",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-09-18",
  "class": "architecture",
  "extensions": {
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-09-18-agent-note-legacy-maintenance-loop-exits-settlement-stays--b766003d.md",
      "sourceHash": "65c73f72141a803a93bff4bc9303444645fb5511f99e36f7da097bf9a6b58405",
      "originalBodyHash": "c3aca6c0b30cfa8341c696878c85b2974f8ca0f4040d1b127161641138d8c793",
      "category": "formal",
      "reason": "Retains the source decision in implemented lifecycle; body documents Legacy maintenance loop exits, settlement stays. No age-based archival.",
      "edits": [
        "Rebased Markdown destination: 2026-09-17-maintenance-harness-apply-s6.md -> ./2026-09-17-maintenance-harness-apply-s6--66bf1be8.md",
        "Rebased Markdown destination: 2026-09-18-project-conversation-controller.md -> ./2026-09-18-project-conversation-controller--4ffa1606.md",
        "Rebased Markdown destination: 2026-09-18-blueprint-migration.md -> ./2026-09-18-blueprint-migration--1915e29e.md",
        "Rebased Markdown destination: ../../proposed/architecture/2026-09-18-legacy-loop-removal.md -> ./2026-09-18-legacy-loop-removal--cddc53a5.md",
        "Removed redundant Agent Note title prefix",
        "Removed lifecycle duplicated by frontmatter"
      ],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/implemented/architecture/2026-09-18-legacy-loop-removal.md",
        "sourceHash": "0270ac48c3a13d41ac748f8d7ed4626f27dc03eae363b591a117dc927d119841",
        "originalBodyHash": "132d2ddf2f2e16159035523f8851369727e7ae00c3988b0e0f4241aaa0e6c5c1"
      }
    }
  },
  "updated": "2026-11-20T12:06:46Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/95ec5f71-33e3-4f71-aa05-d3e725c33b10"
}
---

# 旧蓝图维护循环退役

## Problem

早期蓝图维护和项目对话分别持有消息、转向及提案的执行循环，同一会话故障需要在两处修复。

## Decision

当时保留旧数据迁移和结算能力，移除旧维护循环的独立消息、追踪及转向入口。当前维护业务由[蓝图插件](../blueprint/maintenance/module.md)承接，原始旧 JSON 通过显式预览转换。普通讨论与授权修改有各自的入口；确认后的文件变更走共享 Note 事务。

## Alternatives considered

一次移除所有旧数据读取与转换会让已有工作区失去导入路径。继续并行维护两套对话循环则会再次分散状态归属。

## Consequences

旧宿主阶段留下的审计和通用撤销约定已退出普通维护对话。插件的建议修复、复核与局部撤回见[建议交接](../blueprint/navigation/note-updates-and-suggestion-navigation.md#建议定向修复)。
