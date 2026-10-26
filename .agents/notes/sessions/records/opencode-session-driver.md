---
{
  "schema": "harness-note/2",
  "id": "ba08f562-a2bc-4a97-98dc-8b835bcc9107",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-09-22",
  "class": "feature",
  "relations": [
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/3e9ec8d6-9ccc-44ee-ba3f-c1b577d88b7b"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/18fffeff-4922-423d-9f15-0e27f69048d2"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/1a6947ed-0b47-4d33-aa9a-21d37be1db07"}
  ],
  "extensions": {
    "r5Migration": {
      "sourceHash": "ba0a686dec5ff917dcf159ce93bb52d611bd69df6baf7ecfbb6e0808367e01fc",
      "repairs": ["relations[0].reason","relations[1].reason","relations[2].reason"],
      "originalRelations": [
        {
          "type": "related-to",
          "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/3e9ec8d6-9ccc-44ee-ba3f-c1b577d88b7b",
          "reason": "Orca-aligned requirement assumes every CLI leaves a readable store; opencode is that store"
        },
        {
          "type": "related-to",
          "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/18fffeff-4922-423d-9f15-0e27f69048d2",
          "reason": "Pull-mode transcript backfill gains its third engine beside claude and codex"
        },
        {
          "type": "related-to",
          "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/1a6947ed-0b47-4d33-aa9a-21d37be1db07",
          "reason": "Transcript detail reads serve opencode pairs through the same session-keyed channel"
        }
      ]
    },
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-09-22-agent-note-opencode-sqlite-session-driver--ba08f562.md",
      "sourceHash": "1728cc4d07b87f4ee4641120281d997ef1bf4aa77da7070ee34cf41e584be104",
      "originalBodyHash": "a4eb6e9f691ea3f0feed6a7879c012481b4ff79107e8017fc9632699f0575603",
      "category": "formal",
      "reason": "Retains the source decision in implemented lifecycle; body documents Opencode sqlite session driver. No age-based archival.",
      "edits": ["Removed redundant Agent Note title prefix"],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/implemented/feature/2026-09-22-opencode-session-driver.md",
        "sourceHash": "1728cc4d07b87f4ee4641120281d997ef1bf4aa77da7070ee34cf41e584be104",
        "originalBodyHash": "a4eb6e9f691ea3f0feed6a7879c012481b4ff79107e8017fc9632699f0575603"
      }
    }
  },
  "updated": "2026-10-24T16:26:51.774Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/0cb931e1-e33c-4e38-a9d9-9d652796d935"
}
---

# Opencode sqlite session driver

## Problem

`src/main/sessions/external-session-scanner.ts` walks only claude and codex transcript files, and the capability table marks opencode sessionStore null with no driver in the repo. Afternoon opencode conversations therefore never appear in session management: no list rows, no detail prose, no resume path. Field evidence on this machine shows the opencode sqlite store holding hundreds of sessions with directory, title, timestamps, message roles, and text parts, while the registry holds no rows for them.

## Decision

`src/main/sessions/transcript-reader.ts` shares its turn and character caps through an exported truncate helper. `src/main/sessions/opencode-sessions.ts` owns the sqlite driver behind `node:sqlite` read-only handles, following the runtime-telemetry precedent: newest-first session rows with the first user text, the tail assistant text, and the user-message count resolved per session through indexed message queries plus bounded part reads, and full ordered question-plus-answer pairs per session for detail reads. Every query layer tolerates missing files, locked databases, corrupt rows, and schema drift by resolving empty or null, and one bad session never fails a list. The capability table gains the `opencode-sqlite` store kind with the database resolved under the home profile; the scanner lists the newest rows instead of walking files for this engine and imports them through the existing engine-plus-provider deduplication, so hook-owned opencode rows keep authority. The transcript detail channel routes opencode sessions into the same pair reader by session id. Resume reuses the shared provider command builder with `opencode --session <id>`, verified against the installed CLI help, and the existing preset-plus-argv spawn path wires hooks without new terminal plumbing.

## Background discovery responsiveness

`listOpencodeSessions` returns a Promise and yields with `setImmediate` between sessions. It keeps the existing 500-message window, first user text and user-turn count, then searches assistant messages backwards until it finds the latest nonempty text. Reading every historical assistant body on every poll previously issued thousands of synchronous SQLite queries; the scanner now awaits the incremental list. Detail reads retain their existing behavior.

Real Electron profiling against the JanusX workspace found recurring 3-5 second main-thread stalls inside `lastTextOfParts` and `messagesOf` during external discovery. The 600-switch baseline reached 5315ms event-loop delay. After reverse lookup and yielding, recurring multi-second OpenCode stalls disappeared in the measured runs; startup Markdown validation and native usage accounting remain separate synchronous work. Full comparison and reproduction are recorded in [right dock](../../workbench/right-dock.md).

The database remains read-only and each individual session query is synchronous; yielding between sessions is not a hard latency bound for a pathological single session or locked store. The existing empty/malformed database behavior and output limits are unchanged. The long-history regression verifies first prompt, latest nonempty answer, count and event-loop progress across three sessions; related scanner/transcript and dock unit suites pass 65 cases.

## Alternatives considered

- Add a native sqlite dependency for faster queries — strongest case is full SQL expressiveness with prepared-statement caching. The driver that rules it out is build cost: native rebuilds for packaged Electron plus test-environment mismatch, while the built-in reader measures 708ms for 200 sessions on a 4.9GB store.
- Parse `opencode export` CLI output per session — strongest case is canonical serialization. The driver that rules it out is fragility plus cost: a subprocess per session against a store that already reads stably through indexed queries.
- Mirror the cwd scope matcher into the sqlite layer for pre-filtered lists — strongest case is less import churn. The driver that rules it out is layering: scope filtering belongs to the registry list path that already serves every engine.
- Wire opencode turn-end excerpts through the same database — strongest case is live answer prose on hook-owned opencode turns. The driver that rules it out is hot-path latency: per-turn database opens on every turn end for prose the detail channel already serves on demand; status-only turns stay until a measured need arrives.
- Do nothing / keep claude-plus-codex backfill — no churn. The cost is the reported symptom: the engine hosting the current work stays invisible to session management.

## Consequences

The database location is shared with telemetry, recovery and knowledge transcript fallback through `opencode-store-path.ts`: `OPENCODE_DB` selects an absolute database or a path relative to the OpenCode data directory; `XDG_DATA_HOME` overrides its default `~/.local/share` parent. Usage accounting now reads native v1/v2 messages into the existing ledger, described in [native usage accounting](../../terminal/requirements/usage-telemetry-single-source.md). This does not extend the transcript-detail driver to OpenCode v2.

- **Gains**: opencode sessions list with correct directory, first question, tail answer, and counts; detail windows read full pairs; resume runs the verified provider command in a hook-wired terminal; hook-owned opencode rows keep their live behavior untouched.
- **Costs and limits**: scans cap at 200 newest sessions per pass with per-session message windows of 500; sides above 2000 characters and lists above 100 pairs truncate with counts disclosed; turn-end excerpts stay status-only for opencode; per-session provider environment is inherited, not tracked. Revisit when opencode changes its sqlite schema or a live opencode feed becomes ownable.
- **Verification**: machine evidence on touched paths — `npx tsc --noEmit` with strict unused flags is clean, `npx eslint` on touched files reports zero errors, and unit runs pass on `opencode-sessions` 5/5, `transcript-reader` 6/6, `external-session-scanner` 6/6, `agent-session-registry` 14/14, and `agent-engine-capabilities` 5/5. Desktop e2e is not run: provider CLIs are not drivable in CI.
