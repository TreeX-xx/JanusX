---
{
  "schema": "harness-note/2",
  "id": "5559a0b8-d437-5e79-8bb5-c593bf30e8fc",
  "kind": "decision",
  "lifecycle": "archived",
  "created": "2026-09-18",
  "parent": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/19cd1394-b2cb-4819-8fde-5f12de16574c",
  "class": "architecture",
  "extensions": {
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-09-18-agent-note-own-working-notes-live-outside-the-harness-graph--5559a0b8.md",
      "sourceHash": "eccdfda642726d69521b795d9e54573e0da4902befb7cce67b31ec09c7c440a7",
      "originalBodyHash": "66cec5e775a3c6381143eb2557f6bfd5600b8b8bfdc61e3a6c4c7da427a8b3e3",
      "category": "formal",
      "reason": "Retains the source decision in implemented lifecycle; body documents Own working notes live outside the harness graph. No age-based archival.",
      "edits": [
        "Rebased Markdown destination: 2026-09-18-harness-s9-readiness.md -> ./2026-09-18-harness-s9-readiness--28ce4fe4.md",
        "Rebased Markdown destination: 2026-09-16-harness-project-graph-s4.md -> ./2026-09-16-harness-project-graph-s4--bcadcdc9.md",
        "Rebased Markdown destination: ../../proposed/architecture/2026-09-18-own-notes-namespace.md -> ./2026-09-18-own-notes-namespace--134ce6f7.md",
        "Removed redundant Agent Note title prefix",
        "Removed lifecycle duplicated by frontmatter"
      ],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/implemented/architecture/2026-09-18-own-notes-namespace.md",
        "sourceHash": "cc3eec764fdcd6b394382d17749132c74015d4e8424a31a55c1a2720a7e96c13",
        "originalBodyHash": "488d14ed9ea73246858e6529c4cde1d65f5d3f6386255c3dbeb74c1b1837b0a4"
      }
    }
  },
  "updated": "2026-11-20T12:06:46Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/bd612cd8-0676-4c46-98ba-81d1dc008505",
  "disposition": {
    "reason": "Historical namespace policy; repository Notes are maintained v2 documents. Foreign-source diagnostics remain available for actual foreign files."
  }
}
---

# 早期工作笔记与 Harness 图的命名空间

## Problem

接入初期，人工工作笔记与声明 Harness schema 的文件共用目录。把所有普通文件都显示为格式错误，使真正的坏文档难以发现。

## Decision

旧读取器先判断文件是否声明 Harness schema，再区分有效、无效和外来源。普通文件可保留路径及哈希，声明了不支持版本或损坏 schema 的文件则保留诊断。JanusX 的正式 Note 此后迁入 v2，当前读取边界见[所属模块](../module.md)。

## Alternatives considered

整体搬离目录会打断既有引用；当时批量转换普通笔记也会为尚未定稿的讨论强加交付语义。

## Consequences

缺少 schema 的文件不能仅凭路径认定为有效 Note。旧策略和迁移依据保存在 Git，原始验收见[迁移 Task](../tasks/migrate-notes-v2.md)。
