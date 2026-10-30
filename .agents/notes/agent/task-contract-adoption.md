---
{
  "schema": "harness-note/2",
  "id": "6b7c688e-278f-5878-b88f-2bbb9d766fae",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-09-18",
  "class": "architecture",
  "extensions": {
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-09-18-agent-note-explicit-adoption-of-roundtable-task-contracts--6b7c688e.md",
      "sourceHash": "911ef47e7e2732ae94432f75e115653d229ab48535f279e06963cc5cac0c6c8e",
      "originalBodyHash": "932598f61376f22a4ddfbdfbd74cc77fa65fd7beca1571a801ff984271ff7af3",
      "category": "formal",
      "reason": "Retains the source decision in implemented lifecycle; body documents Explicit adoption of roundtable task contracts. No age-based archival.",
      "edits": [
        "Rebased Markdown destination: 2026-09-18-harness-portable-results.md -> ./2026-09-18-harness-portable-results--11d8826d.md",
        "Rebased Markdown destination: ../../../../src/renderer/src/components/janus/HarnessRunPanel.tsx -> ../../src/renderer/src/components/janus/HarnessRunPanel.tsx",
        "Rebased Markdown destination: ../../../../src/renderer/src/components/janus/TaskContractEditor.tsx -> ../../src/renderer/src/components/janus/TaskContractEditor.tsx",
        "Rebased Markdown destination: ../../../../src/main/ipc/harness-handlers.ts -> ../../src/main/ipc/harness-handlers.ts",
        "Rebased Markdown destination: ../../../../src/main/harness/task-adoption.ts -> ../../src/main/harness/task-adoption.ts",
        "Removed redundant Agent Note title prefix",
        "Removed lifecycle duplicated by frontmatter"
      ],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/implemented/architecture/2026-09-18-task-contract-adoption.md",
        "sourceHash": "875b2bd19e4a511191c75f2ade6dac068912f86f4ebfb582c8cdf29e8d6b568c",
        "originalBodyHash": "5d8fa896c7d580f01dae37170ad6be1a737e9caf7ee845b675cce288fcfc6977"
      }
    }
  },
  "updated": "2026-10-30T09:34:45.524Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/95ec5f71-33e3-4f71-aa05-d3e725c33b10"
}
---
# Explicit adoption of roundtable task contracts


## Problem

当前适用性：旧桌面任务契约编辑和执行界面已于 2026-10-30 删除；下文 UI 行为与测试保留为历史记录，源码链接固定到删除前版本。任务契约及运行后端继续保留，当前产品边界见[Agent 模块](module.md)。

Roundtable action artifacts are valid task drafts, but their open scope, acceptance criteria and checks are not executable contracts. A run panel without an adoption step either refuses these drafts without a repair path or risks treating discussion as execution authorization.

## Decision

The task run panel reads the current task and offers a contract editor for draft or proposed tasks without execution. The user supplies scope, allowed repository paths, concrete acceptance criteria, requirement references and verification steps, then explicitly adopts the task. The host checks the lifecycle transition, validates and round-trips the resulting Note, and uses expected-hash replacement through the existing recoverable asset transaction. A stale submission fails with a conflict and can be reloaded. Adoption does not prepare a run or execute a command.

The editor currently targets the selected primary repository. Scope and verification must remain in that repository. External acceptance references must resolve to accepted requirements or initiatives in the same repository; task-local criteria are included automatically. Requirement references determine implements relations, avoiding another independently edited coverage list. Required verification must include at least one concrete step. Placeholder scope or criteria, unknown criteria, escaping paths and malformed inputs are refused before writing. Execution readiness remains subject to the shared baseline validator.

Entry points are the [adoption service](../../../src/main/harness/task-adoption.ts), [IPC handlers](../../../src/main/ipc/harness-handlers.ts), [contract editor](https://github.com/TreeX-xx/JanusX/blob/f2e0194fccab765142b6c58a62e393498ae9c3d2/src/renderer/src/components/janus/TaskContractEditor.tsx) and [run panel](https://github.com/TreeX-xx/JanusX/blob/f2e0194fccab765142b6c58a62e393498ae9c3d2/src/renderer/src/components/janus/HarnessRunPanel.tsx). Formal validity and closeout continue to use [portable task results](./harness-execution-adapter-s8.md), not the adoption lifecycle or UI checkboxes.

## Alternatives considered

- Adopt action artifacts automatically: removes a step but turns an unfinished discussion into an executable agreement.
- Require raw Markdown edits for every missing field: already possible, but does not complete the roundtable-to-task workflow in the desktop surface.
- Add a separate execution plan: offers a specialized form but duplicates task scope, criteria and identity already owned by the Note.

## Consequences

Accepted tasks unlock run preparation; execution and closeout remain separate. The editor can preserve and edit existing manual verification steps, but adding manual steps, supplying manual evidence and editing cross-repository contracts are not implemented in this UI. Repeating adoption with an old hash returns a conflict; adoption is not advertised as an idempotent command.

The integration test builds a real roundtable action bundle, persists its draft, adopts it, prepares and starts through the desktop adapter, and invokes the shared execution kernel with a real Node verification command and a stubbed reviewer. After Git commits, a clone without local runs reconstructs a valid completed result, satisfied closeout and 100 percent requirement coverage. Changing code makes the receipt stale and coverage zero. This proves the shared-kernel boundary, not a full CLI process or desktop model-driven executor.

The focused regression group passes 25 suites and 139 tests; the browser fixture passes two cases, including contract adoption at a 390-pixel viewport. Typecheck, production build, package boundaries and bilingual key checks pass. Existing maintenance tests emit knowledge-processing warnings. Real-model Electron execution, packaged runtime validation and cross-platform release acceptance remain outstanding; the unified standard stays a candidate.
