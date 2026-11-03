---
{
  "schema": "harness-note/2",
  "id": "80f207b2-591b-5a1d-824e-e169dc5b80c0",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-09-21",
  "class": "bug-fix",
  "extensions": {
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-09-21-agent-note-workspace-switch-sweep-survives-background-file-tree-refreshe--80f207b2.md",
      "sourceHash": "5db139480b9681ca64ca6c92ba11efc97ef9d9b4d752ae2b3061b85102ffcec1",
      "originalBodyHash": "03ef7e4c93ae0febf82ca0e7b12a7b5481ca62279d76ad10384784abdb449fa9",
      "category": "formal",
      "reason": "Retains the source decision in implemented lifecycle; body documents Workspace switch sweep survives background file-tree refreshes. No age-based archival.",
      "edits": ["Removed redundant Agent Note title prefix","Removed lifecycle duplicated by frontmatter"],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/implemented/bug-fix/2026-09-21-file-tree-reveal-race.md",
        "sourceHash": "5db139480b9681ca64ca6c92ba11efc97ef9d9b4d752ae2b3061b85102ffcec1",
        "originalBodyHash": "03ef7e4c93ae0febf82ca0e7b12a7b5481ca62279d76ad10384784abdb449fa9"
      }
    }
  },
  "updated": "2026-11-03T07:45:02Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/19cd1394-b2cb-4819-8fde-5f12de16574c"
}
---
# Workspace context blur and loading readiness

## Problem

The file-tree scan expressed only one part of a workspace change, while Git and Sessions updated separately. It also coupled a fixed visual reveal to asynchronous refresh ordering. The workspace needs one transition language with a reliable end tied to the current panel's data.

## Decision

Workspace and worktree changes use the same `WorkspaceTransition` content boundary in Files, Git and Sessions. The visible content defocuses through a theme-tinted 5px glass layer for 120ms, holds until that panel's data settles, then refocuses over 220ms. The previous rendered content remains beneath the glass until replacement data or an error is ready. There is no fixed loading delay beyond the short entry motion. Loading lasting 600ms shows a clear target-workspace label above the glass. Navigation, search controls and the Git branch bar stay readable; the transitioning content is inert for both pointer and keyboard input.

Only the visible panel waits for its own data. Files follow the full-tree load, Git follows status and history for the active worktree, and Sessions follows its selected filter. Global/all-session scopes keep their own identity. Hidden panels do not run motion. Returning to a hidden panel with unfinished data starts the same feedback; background updates in an already visible scope do not replay it. Reduced-motion mode removes blur and entry/exit delays while keeping loading feedback and interaction protection. The glass is disabled at rest, avoiding a permanent filtered surface.

## Data ordering and failure recovery

File-tree state describes data only: `idle`, `loading`, or `error`. The retired scan overlay, scan timing utility and store-owned `revealing` phase have been removed. `pendingVisualLoadPath` records the requested scope so a newer background load inherits its completion or failure. Generation and scope guards reject stale responses. If a directory mutation invalidates the latest root snapshot, the loader reads again rather than leaving the visible load waiting without a future commit.

Git status exposes its pending state; history additionally tracks its scope and request generation, and keeps its own error so a later status success cannot erase a history failure. A late history response cannot replace the current scope, including A → B → A navigation. The Git panel reads and acts on the same active worktree as Files and Sessions. Failed session switches clear the previous scope's cards before revealing the error; same-scope background failures retain current data. Retry and subsequent switches remain available after failures.

The presentation timer belongs to each content boundary and is canceled on scope changes, hiding and unmount. Background store commits cannot cut a transition short or restart it. Rendering the old content briefly is a visual bridge only: `inert` prevents its captured actions from targeting the previous workspace.

## Alternatives considered

A shared content boundary keeps the existing panel and navigation layouts while expressing that all three tools belong to the workspace. A full-window blur would also obscure the workspace picker; independent scan animations would preserve the fragmented loading feedback. Holding the previous React content adds a short presentation lifetime and does not duplicate the underlying stores. A view that replaces its own subscribed content outside this boundary will need to expose readiness before joining this transition. Browser tests cover the current three built-in tools; remote connection timeouts remain owned by their existing IPC services.

## Consequences

The three built-in tools share one visual lifecycle without serializing their data loads. The boundary retains one rendered subtree while waiting and uses a viewport-sized backdrop filter only during motion. Revisit the blur radius or use a tint-only fallback if packaged-app profiling identifies a GPU cost on large panels; current browser coverage does not establish packaged-app performance.

## Verification

The focused Git/session/file-tree/workspace checks pass 63 unit cases across the initial five-file run and the final Git-store rerun. Nine workspace-transition browser cases pass across focused runs, covering both themes, pending data, rapid switches, errors/retry, independent visible-panel readiness, worktree scope, quiet background refresh, reduced motion and global session filters without an active workspace. Eight existing right-workspace-design and right-tool-switch-performance browser cases also pass, including keyboard actions, scrolling a 500-file Git list and cached tool activation. Typecheck and locale parity pass; scoped ESLint has no errors and retains two pre-existing hook warnings in FileExplorerTool. Note validation has no errors and reports 17 pre-existing external-link diagnostics. The planche/dark blur and clear screenshots were visually inspected and copied to `artifacts/workspace-transition/`.

Commands: `npx vitest run tests/unit/git-store.test.ts tests/unit/session-store.test.ts tests/unit/file-tree-load-pressure.test.ts tests/unit/workspace-pane.test.ts tests/unit/workspace-sidebar.test.ts`, then `npx vitest run tests/unit/git-store.test.ts`; `npx playwright test tests/e2e/workspace-transition.spec.ts tests/e2e/right-workspace-design.spec.ts tests/e2e/right-tool-switch-performance.spec.ts --project=island --workers=2`, followed by the corrected workspace-transition suite and focused `--grep 'git waits'` / `--grep 'global session'` reruns; `npm run typecheck`; scoped `npx eslint`; `npm run i18n:check`; `npm run check:notes`. The initial browser fixtures needed to await the rail's existing deferred activation before testing a content boundary; the corrected tests await visible, ready panels. One isolated rerun exceeded the 20-second page-navigation budget; its 60-second retry passed. Browser IPC is controlled to exercise pending, failure and late responses; this does not establish packaged-app GPU or remote-network performance.

## Background refresh pressure

File watcher refreshes run one active pass and keep at most one merged trailing pass. Multiple changed paths invalidate all open editors instead of retaining only the final filename. A workspace switch discards obsolete root responses before directory expansion; expanded-directory reads use at most four workers and stop scheduling when superseded. The loading-readiness handoff described above still applies.

`src/main/ipc/file-tree-ignore.ts` batches queued directory candidates by workspace root and runs at most two Git ignore checks across roots. Each check has a three-second timeout; Windows cleanup targets the process tree because Git may launch a second executable. Failed checks leave ignore decoration unavailable for that pass and retry on the next refresh. There is no persistent ignore cache to invalidate after `.gitignore` changes.

Raw watcher subscribers continue receiving all events. Renderer broadcasts omit Git lock/object/log churn and hidden `.janusX` state, while index, HEAD and refs changes remain visible. Git service commands use `GIT_OPTIONAL_LOCKS=0` so read-only status refreshes do not rewrite the index and feed their own watcher. A three-second timeout can temporarily remove ignore dimming on unusually slow disks; directory contents still load. The bounds reduce competing work; they do not establish a measured end-to-end input latency guarantee or replace testing an updated packaged application.

Renderer broadcasts also exclude actual application userData/sessionData and explicit disk-cache-dir subtrees within the watched workspace, resolving absolute paths and junction aliases once at registration. Ordinary directories named data, adjacent prefixes and external/ancestor application paths remain visible; unknown filenames still refresh conservatively. Raw subscribers retain these events. Same-root review registration coalesces pending context reads; children loads do not rescan an already registered root, while root reloads retain branch checks and retries. `workspace-event-filter.test.ts`, `blueprint-review-registration.test.ts` and the watcher coordinator tests cover boundaries, aliases, 1,000-event delivery/filtering, late close results and retries. Current implementation and isolated performance evidence are maintained in [long-session performance](./long-session-performance.md).

Regression coverage: `file-tree-ignore-pressure.test.ts` checks batching, concurrent roots and timeout cleanup; `file-tree-refresh-pressure.test.ts` checks 1,000 overlapping events, scope changes and failure recovery; `file-tree-load-pressure.test.ts` checks directory concurrency and stale scans; `office/workspace-watcher-coordinator.test.ts` checks raw subscriber delivery, Git event filtering and merged editor invalidation.

Validation for refresh pressure: 38 tests across eight focused files passed; targeted ESLint, `npm run build:check` and `npm run check:notes` passed (the latter reports 17 existing external-link diagnostics). The final whole-repository `npm run typecheck` reports TS2702/TS2538 in the separately modified `src/main/blueprint/review/models.ts:140`; it does not report errors in the performance changes. Packaged long-session latency has not been remeasured.
