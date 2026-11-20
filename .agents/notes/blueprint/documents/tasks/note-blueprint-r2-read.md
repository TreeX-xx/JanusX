---
{
  "schema": "harness-note/2",
  "id": "fa17e06b-5f62-4d42-9020-4fb77bcf54de",
  "kind": "task",
  "lifecycle": "accepted",
  "created": "2026-09-25",
  "class": "architecture",
  "tags": ["note","blueprint","wiki","migration","r2"],
  "codeRefs": [
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/notes/note-provider.ts", "role": "entry"},
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "plugins/blueprint/src/main/notes/note-to-blueprint.ts", "role": "implementation"},
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "scripts/migrate-agent-notes.mjs", "role": "implementation"}
  ],
  "relations": [
    {"type":"parent","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/e7c03317-8bb8-4d1d-a1b2-832be6c5a3c5"},
    {
      "type": "implements",
      "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/e7c03317-8bb8-4d1d-a1b2-832be6c5a3c5",
      "criteria": ["AC-2","AC-3"]
    },
    {"type":"depends-on","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/81fc137e-9c56-4d3a-88e4-10f175852c97"}
  ],
  "work": {
    "scope": [
      {
        "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
        "paths": [
          "src/main/notes/",
          "src/main/harness/",
          "src/main/ipc/",
          "src/shared/",
          "src/renderer/src/",
          "tests/unit/",
          "scripts/",
          ".agents/"
        ]
      }
    ],
    "acceptanceRefs": [
      {"uri":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/e7c03317-8bb8-4d1d-a1b2-832be6c5a3c5","criterionId":"AC-2"},
      {"uri":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/e7c03317-8bb8-4d1d-a1b2-832be6c5a3c5","criterionId":"AC-3"}
    ],
    "verification": [
      {
        "id": "V-1",
        "kind": "command",
        "required": true,
        "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
        "cwd": ".",
        "program": "npm",
        "args": ["run","typecheck"]
      }
    ],
    "review": "independent"
  },
  "updated": "2026-11-20T12:06:46Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/bd612cd8-0676-4c46-98ba-81d1dc008505"
}
---

# R2 — 共同读取、中间投影和迁移清单

## Scope

R1 的独立验收及三仓发布组合已经闭合。本任务复用共享 buildNoteIndex/readIndexedNote，把同一快照交给 wiki 和独立蓝图投影层。保留完整身份、元数据、全部正式关系及引用诊断；本机图和缓存继续按 checkout 隔离。UI 只消费中间层结果。全量旧 Note 迁移在 R5 完成，此处建立逐文件可重复清单、无损转换预览和有效试点。

## Acceptance criteria

- [x] AC-1: 共同快照保留 class、repositories、codeRefs、interfaces、execution、AC 勾选原值、全 URI、所有关系类型及 criteria/scope/reason；旧格式、外来格式、损坏与冲突文件均有分类。
- [x] AC-2: 蓝图中间层保持七种正式关系和外部/悬空目标；同 UUID 不同 repo 不别名；目录父关系保留诊断且不会制造递归环；证据完成态保持原有验证入口。
- [x] AC-3: 懒读取返回与所读原始字节一致的哈希及快照失配状态；外部变更或分支切换触发实际活动蓝图刷新，监听错误可见，两个 checkout 隔离。
- [x] AC-4: 全量语料清单逐文件对账；预览可重跑并识别需人工判断项；目录、依赖、决策和代码关联试点通过正式解析，保留正文/UUID/链接且不虚构执行证据。
- [x] AC-5: 针对性单元回归、类型检查及独立 review 通过，修复阻断项后再进入 R3。

## Verification

运行 notes-adapter、harness service/read/refresh 和迁移工具的针对性测试，以及 npm run typecheck。共享索引盘点产生可丢弃的本地报告；迁移前后核对路径、原始正文哈希、UUID、代码和链接。独立 reviewer 根据本 task 固定验收版本复核实际差异。

## Results

共同快照与蓝图中间层已接通，待独立验收。NoteDoc 保留原文、完整 metadata、未知字段和 AC 勾选原值；snapshot 保留全部文件分类、共享 Markdown anchors、正式关系、正文引用、覆盖范围和诊断。七类正式边不降级，跨仓同 UUID 不混用；目录只使用可解析且无环的父关系，声明原边仍可查询。任务完成和 requirement 覆盖继续使用原有回执校验。

readNote 使用共享原始字节读取并返回 fresh hash、indexed hash 和 matchesSnapshot，身份变更拒绝读取。活动 BlueprintView 订阅 checkout 变更；原文及 HEAD 变化触发重建，新子目录受监听，返回窗口也刷新。刷新保留当前选择，监听错误可见，失效发生在请求中时重新加载。

迁移前完整盘点为 183 文件：27 valid、123 legacy、33 malformed。可重复预览为 27 unchanged、119 ready、37 blocked；全部 ready 保留原正文及链接，未知历史状态不产生任务执行记录。37 个待补齐项为 33 个非法关系元数据、3 个归档 disposition 和1个自定义 Proposal 标题，留给 R5 逐项收口。已有已提交事务日志被识别为已完成，无需恢复或清除。

试点原位转换三篇 Note：`implemented/architecture/2026-09-16-harness-project-graph-s4.md`、`implemented/architecture/2026-09-17-maintenance-harness-apply-s6.md`、`proposed/architecture/2026-09-16-unified-note-blueprint-harness.md`。逐文件 after hash、正文末尾原样匹配、正式解析和无 execution 检查通过。已有目录父关系、R2→R1 依赖以及本 task 的显式代码引用组成真实图谱试点；未把正文提及推断为工程依赖。路径和原正文都保持不变。预览与核对证据保存在 `.agents/.local/r2-migration-preview.json` 和 `r2-migration-verification.json`。

针对性读取/刷新/服务/维护应用回归 27 项通过；adapter 16 项、store branch 6 项、IPC 2 项通过。迁移工具的独立实现者自查 24 项通过，完整类型检查通过。固定验收来源为 `959885a`；固定任务契约 hash 为 `274e5ce3e1fd86534e524b1ab51652db7e8dbaba7c127834be59cae15704de34`。最终独立 review 另行记录，R3 尚未实施。

## Progress

Historical delivery statements remain in this document; no v2 execution receipt is asserted.

## Evidence

Original source: Git e433bb8627150126b782a301352da05e2149c18b:.agents/notes/2026-09-25-note-blueprint-r2-read--fa17e06b.md. See docs/migrations/note-v2.json for the raw-source hash and historical execution.

## Handoff

Main Agent owns this Task. Reassess scope, fixed acceptance sources and verification before any new run. Preserve independent-review obligations; subagents read only.
