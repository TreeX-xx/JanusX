---
{
  "schema": "harness-note/2",
  "id": "4ffa1606-df23-5880-a1a5-003ab5fac9e3",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-09-18",
  "class": "architecture",
  "extensions": {
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-09-18-agent-note-one-project-conversation-for-chat-and-note-blueprints--4ffa1606.md",
      "sourceHash": "43b907ca49d01c07669135d227d7ad4d05af9fbbaa956a934f73b38240849b9a",
      "originalBodyHash": "12f0c72c63d289f902764af40cd795d943edc02c556fef60d4a00123cc848907",
      "category": "formal",
      "reason": "Retains the source decision in implemented lifecycle; body documents One project conversation for Chat and Note blueprints. No age-based archival.",
      "edits": [
        "Rebased Markdown destination: 2026-09-18-task-contract-adoption.md -> ./2026-09-18-task-contract-adoption--6b7c688e.md",
        "Rebased Markdown destination: 2026-09-18-legacy-loop-removal.md -> ./2026-09-18-legacy-loop-removal--b766003d.md",
        "Rebased Markdown destination: ../../proposed/architecture/2026-09-16-roundtable-chat-harness-loop.md -> ./2026-09-16-roundtable-chat-harness-loop--f8f6586b.md",
        "Rebased Markdown destination: ../../../../src/main/janus/maintenance/service.ts -> ../../src/main/janus/maintenance/service.ts",
        "Rebased Markdown destination: ../../../../src/main/harness/chat-context.ts -> ../../src/main/harness/chat-context.ts",
        "Rebased Markdown destination: ../../../../src/main/llm/chat-orchestrator.ts -> ../../src/main/llm/chat-orchestrator.ts",
        "Rebased Markdown destination: ../../../../src/renderer/src/components/blueprint/BlueprintMaintenancePanel.tsx -> ../../src/renderer/src/components/blueprint/BlueprintMaintenancePanel.tsx",
        "Rebased Markdown destination: ../../../../src/renderer/src/components/janus/janusChatConversations.ts -> ../../src/renderer/src/components/janus/janusChatConversations.ts",
        "Removed redundant Agent Note title prefix",
        "Removed lifecycle duplicated by frontmatter"
      ],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/implemented/architecture/2026-09-18-project-conversation-controller.md",
        "sourceHash": "4f671331cf5117686fd3cd401e2a6a8ec3c3dd514bedfd6d9189aa79698fc838",
        "originalBodyHash": "45277e232f05a8aa9072212ae3b6335c2238786b2e5705dcb8b11b02dbfcdd31"
      }
    }
  },
  "updated": "2026-10-26T14:16:34Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/0fc34aee-911c-44f3-b873-a1272d93631a"
}
---
# One project conversation for Chat and Note blueprints

The October 26 plugin split retired the host Blueprint panel and its maintenance route. The links below pin that historical implementation. The generic host conversation registry remains, while downloaded Blueprint discussion and maintenance now belong to the plugin. Shared-controller equivalence is not claimed for the plugin; current boundaries and gaps are recorded in the [official plugin plan](../../planning/blueprint-official-plugin.md).

## Problem

Sharing the chat engine did not share conversation ownership. The main Chat and blueprint maintenance panel could retain separate messages, resources, cancellation and questions. A project discussion also needed validated Note contents rather than trusting renderer paths or treating a selected node as workspace authorization.

## Decision

The conversation registry binds a Note blueprint through its owner repository and view identity. Both entries use the same persisted conversation and runtime controller. Messages, model selection, workspace resources, questions, approvals, steering and stop have one owner. Closing a panel leaves the turn running; opening it again reuses the conversation. Switching the main entry to a personal thread leaves the project controller and its status available by view identity. Existing resource choices survive binding and reload.

The main process resolves selected Note URIs and hashes from validated workspace sessions under the asset lock. Missing, stale or ambiguous checkouts fail explicitly. Project discussion uses read-only workspace tools plus questions and todos. Project turns without a workspace do not fall back to personal memory capture. Selection is context, not a grant to write.

New Note maintenance tasks link to the conversation and retain only proposal operations, evidence and audit state. Proposal generation runs within the ordinary chat turn's ownership, signal and session, using shared history. Steering revises the proposal before the final response. Duplicate steering identities are idempotent even when the queue is full; conflicting text is refused. Applying a proposal remains an explicit action through the existing evidence recheck, selected-operation transaction and undo path.

Entry points are [conversation binding](../../../../src/renderer/src/components/janus/janusChatConversations.ts), [blueprint panel](https://github.com/TreeX-X/JanusX/blob/26b3ad3bfda24070c5720b831ab5c85b54704a72/src/renderer/src/components/blueprint/BlueprintMaintenancePanel.tsx), [chat host](../../../../src/main/llm/chat-orchestrator.ts), [Note context](../../../../src/main/harness/chat-context.ts) and [proposal service](https://github.com/TreeX-X/JanusX/blob/26b3ad3bfda24070c5720b831ab5c85b54704a72/src/main/janus/maintenance/service.ts). The overall contract remains the [candidate discussion and execution design](../../agent/roundtable-chat-harness-loop.md).

## Alternatives considered

- Share only the message renderer: minimizes UI changes but leaves competing turns, resource grants and stores.
- Move proposal application into unrestricted chat tools: simplifies dispatch but loses explicit selection and the existing evidence and undo boundaries.
- Delete the old maintenance path immediately: simplifies ownership, but interrupts active unlinked tasks and legacy JSON blueprints before the standard cutover has been verified.

## Consequences

New Note blueprint conversations share their controller end to end. The service-owned discussion loop has exited (see [legacy loop removal](../../agent/legacy-loop-removal.md)): legacy JSON blueprints and unlinked maintenance tasks keep frozen settlement of pending proposals, audits, undo, cancel, and complete, with discussion and new starts moving through migration and the shared conversation. Proposal generation still uses the maintenance service's structured output and evidence logic inside the shared turn. It does not execute task contracts or issue formal completion evidence.

Focused tests cover turn exclusion, proposal cancellation, steering identity, conversation restoration, proposal history and workspace ownership. The browser fixture uses real renderer components with mocked Electron and model ports to exercise messages, questions, approvals, model changes, resource removal, panel remount, personal-thread switching and reload. It is not full Electron or real-model acceptance. Typecheck, production build, package boundaries and bilingual key checks pass. The task adoption Note records the adjoining [draft-to-evidence boundary](../../agent/task-contract-adoption.md).
