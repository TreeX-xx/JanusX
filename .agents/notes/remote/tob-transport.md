---
{
  "schema": "harness-note/2",
  "id": "abb5ed88-3467-505f-be6e-de09801eea6f",
  "kind": "decision",
  "lifecycle": "proposed",
  "created": "2026-08-20",
  "class": "architecture",
  "extensions": {
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-08-20-agent-note-team-sync-transport-foundation--abb5ed88.md",
      "sourceHash": "6be08428ed128667710e3950b9245831bbb72b6f4f20cb128a63f7e1355dda43",
      "originalBodyHash": "c1300ef1a4b7797e71024e66002ec5dd70d4020129c980e4479b709e5cc05537",
      "category": "formal",
      "reason": "Retains the source decision in proposed lifecycle; body documents Team sync transport foundation. No age-based archival.",
      "edits": ["Removed redundant Agent Note title prefix","Removed lifecycle duplicated by frontmatter"],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/proposed/architecture/2026-08-20-tob-transport.md",
        "sourceHash": "6be08428ed128667710e3950b9245831bbb72b6f4f20cb128a63f7e1355dda43",
        "originalBodyHash": "c1300ef1a4b7797e71024e66002ec5dd70d4020129c980e4479b709e5cc05537"
      }
    }
  },
  "updated": "2026-11-20T12:06:46Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/b653bb34-279f-45db-92d1-313d1c6bcdf5"
}
---
# Team sync transport foundation


## Problem

工程 Note 保存在各自 checkout 的 .agents/notes，个人记忆由桌面本地服务维护。团队身份与终端连接已有各自入口。跨设备共享内容仍需要确定资源归属、版本和冲突处理，才能将一次修改安全地传播给其他成员。

## Decision

Build the transport floor in this order: identity-authenticated connections carrying short sessions authorized level by level (tenant, project, resource); `Repository` and `Storage` abstractions with optimistic concurrency on a base version; server-side monotonic versions plus domain events; client snapshots with sync cursors and an outbound queue. Read incrementally online, read the latest snapshot offline, submit the queue on reconnect, merge field-level conflicts, and route state-transition conflicts to human handling. Reuse the personal-edition dual-mode peer and transport selection as the shared library with the device pairing upgraded to session tokens. Forbid sharing local JSON files and absolute paths from the start. This floor later carries the account-system remote control in `../feature/2026-08-20-tob-lan-remote.md` and the published project memory in `../../implemented/architecture/2026-09-03-knowledge-pipeline.md`.

## Alternatives considered

- Sync raw local files — strongest case needs no server at all. The driver that rules it out is concurrent overwrite plus privilege leakage across tenants.
- Realtime collaborative editing — strongest case matches document-suite expectations. The driver that rules it out is unit mismatch: the first version collaborates on nodes, comments, changesets, entries, and reviews, not characters.
- Do nothing / reuse single-disk storage — staying put keeps every current path untouched. The cost is permanent multi-end divergence.

## Acceptance criteria

- [ ] Blueprint and knowledge read through versioned endpoints with snapshot plus incremental sync and offline queues.
- [ ] Conflicting writes never overwrite the remote; field merges apply automatically and state conflicts surface for handling.
- [ ] The personal-edition transport selection reuses as a shared library with token-based auth replacing device pairing.

## Consequences

- Sharing private resources by default leaks personal data; private stays person-only with publishing as the sole explicit action.
- Notification failures must never roll back business writes; keep the outbox asynchronous.
