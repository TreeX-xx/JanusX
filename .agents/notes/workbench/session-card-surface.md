---
{
  "schema": "harness-note/2",
  "id": "764d5d26-8d0d-4307-9b77-af3e22e2ac11",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-09-29",
  "class": "bug-fix",
  "updated": "2026-11-20T12:35:49Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/19cd1394-b2cb-4819-8fde-5f12de16574c"
}
---

# Session card surfaces, summary and expansion

## Problem
Dark-only literal fills and white-alpha borders made session content muddy or invisible on the default paper theme. A fixed yellow-brown card later preserved the same excess warmth as the surrounding dock.

### Session list summary prioritizes title and freshness
A collapsed session card shows one title line and a chevron. Engine, progress, freshness, and what the session is about all sit behind the expand, so the list cannot be scanned: identifying a session costs an expand per card, and the collapsed state loses the glanceable summary the dock list exists for. The v6 design in `design/session-mgmt-hifi.html` specifies three always-on rows for exactly this scan.

### Session card expansion and responsive toggles
Session cards need continuous open/close motion without making each toggle render the entire list. Keeping every unopened body mounted adds prompt layout, copy controls and action buttons to large lists. Reopening also used to request the full detail again, including when the prior request was still pending. These costs can delay a toggle independently of the animation duration.


## Decision
The right dock maps its local shell surfaces to the centralized tool palette. Collapsed session rows rest directly on shell-canvas with a soft bottom separator; hover uses shell-hover without an accent border or shadow. Expanded rows use tool-card and a 6px radius to group their details. Planche keeps the same warm-paper ground as the central workspace (#EFE4C5); dark keeps its neutral tool canvas. A near-white dock was rejected because its large area broke continuity with the central paper. Expanded first-prompt and recent-turn sheets mix 84% canvas with white in light themes and 96% in dark, without nested outlines. Codex icons invert locally on the dark theme to retain contrast.

In View details, the turn cards and navigation rail mix shell-chrome with shell-text at 94% and 90% chrome respectively. The current turn uses shell-active and a semibold label in the rail, with a one-pixel shell-dim border on the matching card. Other cards use shell-border. The status dot follows the turn outcome independently of selection.

Expanded list actions separate reading from continuation: View details is a quiet text button on its own row; resume and continue share two equal columns below. All action controls inherit the UI font at 12px, use 6px corners and at least 32px height. Resume uses a neutral hover-role fill when available; secondary actions use a neutral outline. Disabled resume has reduced opacity and retains its explanatory tooltip. When only one continuation choice exists it fills the row. The detail window reuses the same neutral button classes. Accent color is reserved for keyboard focus, rather than coloring both reading and resuming as primary actions. Labels, native-resume eligibility and continuation handlers retain their behavior.

### Session list summary prioritizes title and freshness
`SessionCard` renders a 13px provider-authored conversation title beside the engine icon, a secondary status and a persistent chevron. Missing titles fall back to the engine name. A muted one-line preview shows the latest discussion, independently of the first prompt; titles are no longer derived by cutting the first prompt. Search covers the title, recent discussion and original first prompt. The detail dialog shares the conversation title, while the original first prompt remains in expanded details. Provider sources, synchronization and cached injection repair belong to [transcript content truth](../sessions/records/session-content-truth-kernel.md). An 11px inherited-font meta row carries engine, optional external-source text and turns, with relative time aligned right. The L2 region keeps cwd/branch and detailed prompt/turn content described in Session list surfaces; checkpoint counts remain absent. The header row and its keyboard-focusable chevron share one expand toggle.


### Session card expansion and responsive toggles
`SessionCard` in `src/renderer/src/components/SessionPanel.tsx` uses React memoization with stable parent callbacks; toggling changes props only for the cards opening and closing. Collapsed cards receive no changing live-event tick. The grid wrapper stays mounted, but its body mounts on first expansion and is retained thereafter for reversible exit motion. `.expand` in `SessionPanel.module.css` animates `0fr → 1fr` in 160 ms with `cubic-bezier(0.2, 0.8, 0.2, 1)`; opacity takes 120 ms and the -4 px translation and chevron take 160 ms. Closed bodies remain inert. Reduced motion disables these transitions.

Each card retains one detail-request promise, including its successful result. Reopening reuses pending or completed reads when session identity, updated time, turn count, status, transcript path and the panel event tick are unchanged. Changed summaries or debounced live events trigger another read; the prior preview remains visible during refresh. Null or rejected results clear the cache for a subsequent retry. Effect cleanup prevents superseded results from replacing the current preview. Fetch completion never controls the expanded flag. Surface styling remains owned by Session surfaces derive from the chrome token instead of hand-written literals.



## Alternatives considered
Changing global shell-card would recolor the central paper workspace and unrelated panels. A dedicated tool palette gives new themes one discoverable resource while limiting the change to tool surfaces. Per-component theme-id branches would duplicate palette ownership and make future themes harder to add.

### Session list summary prioritizes title and freshness
- Keep the single title row — strongest case is the smallest chrome and no duplication with L2. The driver that rules it out is scanning: one line forces expand-to-identify on a list whose job is triage.
- Title row shows the full `firstPrompt` while status and counts stay in L2 — strongest case is zero derived strings. The driver that rules it out is width: at dock width a lone long title ellipsizes into uselessness, and the three-row density is the design's actual content.
- Derive the title from cwd/branch instead of the prompt — strongest case is stability, since prompts vary in shape. The driver that rules it out is identity: the prompt is what the user remembers about a session.
- Do nothing / keep the one-line L1 — no code and no derived strings. That is the entire benefit.

### Session card expansion and responsive toggles
- Conditional mount with a keyframe entrance — strongest case is the smallest diff and no retained DOM. The driver that rules it out is the exit: collapse still snaps, and fading in over an instantly-tall block is not an expand.
- JS height measurement (scrollHeight, then transition to auto) — strongest case is animating to the natural height even when content reflows mid-open. The driver that rules it out is machinery: resize handling and transition-end bookkeeping where one CSS property covers both directions.
- `max-height` transition on a guessed ceiling — strongest case is zero structural change. The driver that rules it out is easing distortion: a ceiling well above the body spends most of the duration in invisible height, so the motion reads slow then abrupt.
- Do nothing / keep the pop — no code and no motion cost. That is the entire benefit; the chevron keeps rotating against a body that does not move.


## Consequences
Expanded rows use a restrained lightness step above the shared paper ground; resting rows avoid repeated boxes. Popovers avoid deep yellow-brown fills and hard offset shadows. New themes must provide tool tokens in definition.ts. The dock aliases affect inherited child surfaces; portals use their own shared popover tokens. Detail-window mixes and existing modal scrims remain separate migration work. The sheet mixes require color-mix, supported by Electron 35.

Verification: theme registry, planche contract and theme-audit unit files pass 26 cases. The tool-palette browser fixture mounts the real Sidebar and RightDock, checks both themes' dock and workspace-menu colors, hover and Escape dismissal, and renders a seeded session card. Screenshots are under artifacts/tool-palette. This fixture uses IPC fallbacks and does not establish live Electron validation.

### Session list summary prioritizes title and freshness
- **Gains**: a collapsed card answers engine, state, progress, freshness and gist without expanding; expand shows depth instead of identity.
- **Costs and limits**: the title is a derived string — punctuation-free prompts fall back to a 24-character slice and read truncated. The fold control occupies 20px of header width on every card, always-on rather than hover-revealed; archived cards keep their toggle and show `归档` plus the chevron where the design uses a bare `归档`. The meta line lives only in L1, so consumers looking for it in the expanded body will not find it.
- **Verification**: `npm run typecheck` and component eslint pass; `tests/unit/planche-theme.test.ts` passes 14/14 with the remaining two surface declarations and current use sites. Desktop reading and continuation checks plus the unrelated strict-unused failures are recorded in [windowed session reading](../sessions/records/session-windowed-reading.md).

### Session card expansion and responsive toggles
- **Gains**: open and close each run as one continuous height, fade, and chevron motion on the shared panel curve, so the cards below glide to their new positions instead of snapping and a toggle mid-scroll keeps the list's place.
- **Costs and limits**: visited bodies and one request result per visited card remain until unmount. This reduces unopened DOM cost but is not list virtualization. Background summary replacements can still rerender cards, and a first detail read still transfers the full ledger through IPC. No claim is made about native Electron latency under real main-process load; the browser fixture isolates renderer behavior.
- **Verification (2026-10-16)**: `npm run typecheck` and `npx eslint src/renderer/src/components/SessionPanel.tsx` pass. `npx vitest run tests/unit/worktree-store.test.ts tests/unit/planche-theme.test.ts tests/unit/session-turn-merge.test.ts tests/unit/external-session-sync.test.ts --maxWorkers=2` passes 24 tests. The browser fixture contains 200 long-prompt summaries; [scroll pagination](../sessions/records/session-open-stall.md) now mounts the first 20 only. `tests/e2e/session-card-performance.spec.ts` covers unresolved reads permitting close/reopen with one IPC, completed-result reuse, live refresh retaining prose, failed-read retry and single-card expansion, alongside scroll pagination.
