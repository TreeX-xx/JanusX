---
{
  "schema": "harness-note/2",
  "id": "70beb72a-424d-5e96-a0d0-8e1a29635220",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-09-23",
  "class": "feature",
  "extensions": {
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-09-23-agent-note-terminal-right-island-turn-file-history--70beb72a.md",
      "sourceHash": "6919857c310698fdebb7ccae62292c930ac407f5ee15cf07c7b56bfee93e5cc1",
      "originalBodyHash": "032624db129185f8413dd12e8b3c3a6b4378c9383a47ecbdcee2c176525adc31",
      "category": "formal",
      "reason": "Retains the source decision in implemented lifecycle; body documents Terminal right-island turn file history. No age-based archival.",
      "edits": ["Removed redundant Agent Note title prefix","Removed lifecycle duplicated by frontmatter"],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/implemented/feature/2026-09-23-terminal-right-island-turn-history.md",
        "sourceHash": "2b70756b0357c085763307b7f5438033aa785d3a53db340cba7602b8c3232563",
        "originalBodyHash": "5ec25512db3dd918d3bbce1987b7ad955f716b2d0dc64c7c6a3d800056b70427"
      }
    }
  },
  "updated": "2026-10-22T10:17:09.861Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/bdd26e4e-8207-4c1f-8ea3-21f450ee7570"
}
---
# Terminal right-island turn file history

## Problem

A terminal's file-change signal must describe the difference between consecutive completed conversations. Reusing a submission checkpoint ties this signal to input parsing and can combine several conversations. Multiple mounted islands subscribe to the same global event, so unguarded appends create duplicate history entries. Empty turns require an empty latest view while prior change records remain accessible.

## Decision

`TerminalTurnChangeTracker` owns one in-memory file baseline per terminal. The initial capture precedes CLI creation; each accepted turn end compares its captured state with the previous completed turn and advances the baseline, including quiet turns. Start/end gating ignores duplicate completion hooks, per-terminal queues preserve event order, and unregistering discards pending results. Snapshot failures clear the baseline and publish an unavailable result; the next successful capture re-establishes the baseline without claiming a cumulative change.

The tracker reads Git's tracked and nonignored untracked paths, with a directory walk for folders without Git. Internal checkpoint and build directories are excluded. Small regular files use content hashes; files at least 2 MiB use size and modification metadata and have no content diff. Text retention is bounded at 16 MiB per terminal snapshot. The `diff` library counts added and deleted lines in chronological order with a per-file time limit; omitted content or a diff timeout leaves counts unknown. Captures are observational filesystem reads, so concurrent writers can affect a boundary; a detected size change during a read invalidates that capture.

The renderer shares one reference-counted IPC subscription. Turn identity and sequence reject duplicates and stale results. Only nonempty successful changes append to the twenty-record history; every quiet or unavailable turn clears latest independently. Identical file lists from different turns remain separate valid records. Terminal teardown clears both views. History stores immutable summaries in memory. File clicks in latest and history use the same native editor window IPC as the file tree, retaining its tab reuse, system always-on-top control and desktop titlebar dragging. Deleted files and terminals without a working directory cannot open a preview.

File paths remain relative to the terminal cwd. The editor window identity uses the most specific containing root among the terminal's owning workspace, its active scope and its known worktrees. Windows drive and UNC paths compare without case or separator differences; POSIX paths preserve case. This groups subdirectory terminals with their file tree window, keeps nested and sibling worktrees separate, and resolves background terminal snapshots by their owning workspace rather than the visible workspace. A cwd outside all known roots remains its own editor scope. Worktree discovery is not triggered by a click; a missing worktree listing can therefore prevent reuse until that scope is known.

The right-edge file dock is 32 px wide and 64 px tall when collapsed, with 2 px horizontal padding to keep the 99+ badge readable. A separate 32 px wide, two-button scrolling capsule sits 8 px above it; the group meets the pane edge in fullscreen or without history, and moves inward 22 px only when a normal buffer has scrollback, leaving its scrollbar rail reachable. Buffer history controls the inset, so a fading thumb does not move the island. Attached controls have only left-side rounding; inset controls have a full border and rounded corners. It displays only the latest nonzero file count, caps its compact label at 99+, and keeps the exact count in the accessible label. A quiet dock hides the number and remains operable for latest and history. Single click opens latest; double click opens history; keyboard activation and explicit view buttons provide the same access. Expanded views are fixed-size and scroll inside: latest is 340 × 320 px and history is 370 × 420 px, with the total tool group capped at the pane height minus 16 px. The file panel shrinks inside that space, while the scrolling capsule keeps its size; panel width stays within the pane. Switching views changes the shell size instead of hugging content. History renders one card per batch (1 px `--shell-border-soft` hairline, 6 px radius, `color-mix` of `--shell-chrome` toward `--shell-text`, the session turn-card material), while latest stays a flat current-turn list. Cards emphasize filenames over directory paths, align line counts, use localized status and timestamps, and share dark/paper theme tokens with reduced-motion support. The morph is owned by `TurnChangeIsland.css`: width and height animate on the elastic overshoot curve when expanding or switching views and on a snappy curve when collapsing, the body fades in behind the shell, and the superseded `turn-island-*` block in `globals.css` (dead class names plus a transition the component had overridden) is removed.

The focused terminal auto-expands latest on a nonempty turn result when its pane is at least 240 px wide. Automatic and manual expansion both collapse after six seconds outside pointer hover and keyboard focus; leaving the island restarts the timer. Outside pointer-down collapses immediately, including when the terminal stops event propagation, because dismissal listens in capture phase. Escape and the collapse button remain available. The right-pointing collapse chevron follows the panel’s motion back to the right edge, has a 28 × 28 px target, and restores focus to the same terminal when clicked. Background terminals retain counts without stealing focus. Manual expansion remains available below 240 px. The file dock keeps its file-only latest/history views. The separate scrolling capsule pages on click and repeats while held, without changing PTY geometry. Its native-buffer and CLI protocol behavior, stop conditions and verification are owned by [terminal scrolling](./terminal-scrollback-navigation.md).

Verification on 2026-10-20: `npx playwright test tests/e2e/turn-changes.spec.ts --project=island --workers=1 --output=artifacts/turn-island-auto-collapse` passed 10 browser cases, including timed automatic expansion/collapse, manual expansion with hover pause, and outside dismissal through stopped event propagation. Existing history, theme, keyboard and editor-routing cases also passed. This uses production React components with simulated IPC, not packaged desktop acceptance.

## Alternatives considered

- Reuse submission checkpoints and filter empty renderer events. This keeps one snapshot mechanism, but its baseline depends on input recognition and represents submission time rather than the previous completed conversation.
- Persist additional end-of-turn checkpoints. This reuses blob storage, but mixes transient UI tracking with restore-point retention and session checkpoint counts.
- Keep one event subscription per island with content-based deduplication. This minimizes lifecycle plumbing, but repeats global work and can erase legitimate identical changes in different conversations.

## Consequences

Latest reflects the current conversation while history contains only actual change records. Independent baselines add filesystem reads and bounded text retention per open terminal; large-file metadata is approximate, and shared-workspace edits from other terminals are included. History is not persisted, and editor previews are current files rather than archived contents.

Startup investigation on 2026-10-18 (source revision `403a8ea`, Windows, JanusX repository cwd): three sequential calls to the production `captureTurnFiles` implementation captured 2,076 files each in 2,226 / 1,981 / 1,973 ms. Measurement used `node --input-type=module`, TypeScript `transpileModule` in memory, and `performance.now()` around each awaited capture; no CLI was launched and no filesystem cache was flushed. These are isolated baseline timings, not end-to-end terminal startup measurements. At that revision, `createTerminalLifecycle` awaited `turnChangeTracker.register` after program/hook/OfficeCLI preparation and before PTY creation on every non-shell launch. The scanner serially read eligible files, adding roughly two seconds before CLI startup in this workspace, including repeated launches. The 16 MiB limit bounds retained text, not all file reads. Ordinary shell terminals skip the baseline.

The user clarified that every terminal type opens blank on every new launch; AI-only baseline work cannot explain the whole report. Startup now displays a localized, nonblocking hint immediately, switching to waiting-for-output once the PID arrives. Only xterm rendering nonblank buffer text dismisses it; ANSI-only output does not. Failed/exited terminals hide the hint, and replay dismisses it when a pane remounts. All terminal launches and terminal warmups now use the OfficeCLI verification completed before the app window opens, without capability probes on the create path; see [OfficeCLI bundled](../desktop/officecli-bundled.md). Main-process diagnostics record preparation, baseline, spawn-total and first-output-total durations, excluding renderer mount/paint. Existing portable logs contained AI request-to-ConPTY waits of 15–193 seconds with native spawn taking 68–228 ms for those samples; they contained no shell sample and do not establish the common cause for all presets.

File capture now reads batches of at most eight files concurrently and commits in sorted path order. This keeps the pre-CLI baseline boundary, file hashes, ignore behavior and deterministic 16 MiB text retention; temporary buffers/text increase by a bounded batch. Very large directories still require a complete scan, so this does not guarantee instant CLI readiness. An alternating comparison of `git show HEAD:src/main/terminal/turn-file-snapshot.ts` against the edited implementation (same in-memory transpilation command, 2,079 files, three samples, no cache flush, other verification running) measured 1,305 / 1,336 / 1,405 ms before and 661 / 734 / 729 ms after. These are component measurements, not a packaged-app speedup claim.

Startup verification: the six targeted Vitest files (`terminal-ipc-contract`, `terminal-launch`, `terminal-officecli-path`, `terminal-output-scheduler`, `turn-change-tracker`, `office/officecli-manager`) passed 43 unique tests, including repeated shell creation with a never-resolving Office probe and deterministic retention across concurrent batches. `npx playwright test tests/e2e/terminal-startup.spec.ts --project=island --workers=1` passed three browser cases covering repeated Shell/Codex launches, control-only output, replay, failure/retry, and English/Chinese in paper/dark themes; screenshots were inspected. Tests use simulated PTY events with the actual xterm renderer, not a live CLI. Typecheck, strict-unused typecheck, i18n consistency and scoped ESLint passed. The running portable executable was not replaced.

Verification uses `npx vitest run tests/unit/turn-change-tracker.test.ts tests/unit/turn-changes-store.test.ts` for adjacent turns, quiet turns, duplicate subscriptions, failures, teardown, Git ignores, and binary/large files. `npx vitest run tests/unit/terminal-editor-scope.test.ts tests/unit/editor-window-manager.test.ts` checks scope boundaries, path spelling, fallback and native window reuse. `npx playwright test tests/e2e/turn-changes.spec.ts --project=island --workers=1` checks latest clearing, retained history, compact counts, keyboard access, dark/paper screenshots, and native editor IPC payloads for latest/history clicks, subdirectories, worktrees and background snapshots. `tests/e2e/editor-window-tabs.spec.ts` checks native drag regions, tab reuse and the system always-on-top state after clicking pin/unpin; actual pointer dragging outside the main window is not automated.

On 2026-10-15, the scope, window-manager and turn-store unit suite passed 15 tests; the island browser suite passed 8 tests on rerun after one existing dark-theme click timeout; the desktop editor suite passed 1 test after its added pin locator was made bilingual. Typecheck, targeted ESLint, application build and Note checks passed (the Note checker reported 17 existing external-link diagnostics and no errors). Playwright ran with `JANUS_E2E_PORT=49387` and `NO_PROXY=127.0.0.1,localhost` because the local HTTP proxy otherwise misreported free ports as occupied. Desktop artifacts used `artifacts/island-editor-e2e` to avoid concurrent test output collisions.
