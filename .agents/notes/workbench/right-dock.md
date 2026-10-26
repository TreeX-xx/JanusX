---
{
  "schema": "harness-note/2",
  "id": "a73f2f05-7198-52b1-90ca-187f682460c1",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-07-19",
  "class": "architecture",
  "extensions": {
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-07-19-agent-note-right-dock-rail-with-semantic-file-icons--a73f2f05.md",
      "sourceHash": "1f9832e09ef28f7203c6aef35005d94ee0be06cb94fa41123eff164448cb0a67",
      "originalBodyHash": "364955ecc709a743e53d569237272defdfbcff2ad862813402e823f358ac15e1",
      "category": "formal",
      "reason": "Retains the source decision in implemented lifecycle; body documents Right dock rail with semantic file icons. No age-based archival.",
      "edits": ["Removed redundant Agent Note title prefix","Removed lifecycle duplicated by frontmatter"],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/implemented/architecture/2026-07-19-right-dock.md",
        "sourceHash": "1f9832e09ef28f7203c6aef35005d94ee0be06cb94fa41123eff164448cb0a67",
        "originalBodyHash": "364955ecc709a743e53d569237272defdfbcff2ad862813402e823f358ac15e1"
      }
    }
  },
  "updated": "2026-10-24T17:01:29.510Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/19cd1394-b2cb-4819-8fde-5f12de16574c"
}
---
# Right dock rail with semantic file icons


## Problem

The right side freezes four singleton tabs in a fixed strip while the file tree speaks no visual language. Adding a tool squeezes the tab row, tool state drifts across stores, and file kinds, selection, and version-control states collide in one channel.

## Decision

Files, Git and sessions now register as trusted bundled extensions through `extensions/builtins.tsx`. The adapter keeps their original tool IDs, translated labels, icons, order, gates and saved widths; the rail and content host no longer branch on these three tools. Disabling removes an entry and unmounts its view, while re-enabling retains its width and leaves it closed. Application-scoped shells preserve existing local state across project switches while the original stores own project/worktree context. Host services remain independent of the view lifecycle. The container supplies the same retry/close boundary for every right-hand contribution. Migration verification and limits are recorded in the [plugin delivery plan](../planning/plugin-platform-roadmap.md).

The right side composes a fixed tool rail, floating previews and a docked persistent panel. The rail icons are the only navigation and collapse controls: clicking another tool selects and keeps its card open; clicking the active tool collapses or expands it. There is no top tab row or separate collapse button. Multiple opened tools retain mounted state with exactly one visible, and each tool runs as a singleton. Collapse keeps a single source of truth and tool business state follows existing stores per workspace. File icons lead with semantic shape plus low-saturation color inside the monochrome-plus-accent language, and file kind, selection, and version-control states travel three independent visual channels. Icon taxonomy shares one source with the file viewer classification. Office preview stays a transient middle workspace outside the rail.

When the dock is rail-only, initial pointer hover or keyboard focus waits 220ms before showing the actual tool content in a floating card. Once a transient card is mounted, moving or focusing between rail icons selects the next tool immediately, including re-entry during its 320ms exit lifetime. Each entry cancels any pending dismissal. Leaving schedules dismissal after 180ms, allowing movement across the gap into the interactive card. Focus within the card keeps it open for keyboard work. ArrowLeft enters the visible card from a rail icon. Escape cancels pending or visible previews and restores focus to the icon when focus was inside the card; dismissal runs after focus restoration so the icon's focus handler cannot reopen the card. Outside pointerdown, viewport resize, workspace changes and contribution/gate changes dismiss previews. Touch uses click activation. Expanded tools keep ordinary label tooltips; collapsed tools suppress those labels in favor of content previews.

Preview selection is local to RightDock and does not change the persisted open/active tool state or the workbench grid width. A single keyed RightToolHost renders both floating preview and docked panel content, preserving an already opened tool's input state on click activation. A previously closed tool is mounted while previewed and stays mounted for the rest of the floating card's lifetime, so moving between rail icons reuses the subtree instead of unmounting and refetching; it is released when the card itself exits. Its existing active-view effects may run during preview; backend work remains owned by that view's existing cache/lifecycle. Builtin tool chunks also warm during idle time so a first hover does not reveal a blank card. The card is inset 8px vertically, offset 6px from the permanent 48px rail, and constrained to the viewport. Transient previews cannot resize or overwrite saved widths. Clicked panels stay open when the pointer leaves and retain the existing per-tool resize handle. Transient previews leave the center geometry unchanged. Persistent panels reserve only their tool width alongside the 48px rail, so the terminal/editor and its right-side island are not obscured. Clicking a preview keeps the same visible host while its 8px vertical inset, 6px rail gap, rounded corners, border and shadow transition to a full-height docked surface over 240ms, synchronized with the center workspace reservation. Tool width also interpolates when responsive constraints differ from the preview preference. The current presentation is retained during exit, preventing a closing docked panel from flashing back into a card. Below the 320px center plus tool minimum, responsive collapse leaves a bounded temporary card available through hover/click without overwriting the manual collapse preference. Revisit a portal host only if future ancestor clipping or stacking changes require it.

Panel width now follows the active tool. Sessions and Git start at 360px with a 340px minimum and 520px maximum. The file tree starts at 260px with a 240px minimum and 420px maximum; the assistant retains the 280px default and the same 240–420px range. Dragging records a preference for that tool, so tool switches restore each width. The viewport may constrain the displayed width without persisting that constraint. Card appearance uses 240ms opacity and a 320ms horizontal slide. useAnimatedOpen retains the selected content during exit, while the card immediately becomes inert and hidden from accessibility. Reopening during exit cancels dismissal. Tool switches keep the 160ms content fade; resize stays immediate and reduced motion disables transitions. Open tool subtrees remain mounted to preserve local state. Mounting alone does not shorten an individual IPC/data fetch, but reusing a mounted subtree avoids repeating that fetch on every switch.

The far-right vertical rail moves a shared selection background immediately over 160ms, while a shared 100ms activation window coalesces rapid clicks to the last requested tool. Pending state stays local to the control, leaving the current panel visible until activation. aria-pressed describes the committed expanded tool and aria-expanded also announces a transient preview, with aria-busy marking pending work. Repeating the same pending target does not extend the deadline; reversing to the current tool cancels it. A fresh rail click on the current tool retains immediate collapse/expand behavior. Closing tools, changing the active tool externally, hiding the dock or removing the pending target cancels queued work; the rail also resets on workspace and responsive-collapse changes. Timers clear on unmount. Indicators follow layout geometry and resizing, with reduced motion disabling animation while retaining coalescing. Terminal/pane tabs use the same sliding presentation with immediate content selection; their behavior is recorded in [workspace tabs](./pane-tab-reorder.md).

Before rail click coalescing was added, every fast click synchronously updated the global tool state, activating intermediate panels and rerendering unrelated mounted tool content. ToolContent now memoizes stable view/context/active props, so unaffected hidden tools skip parent-driven rendering while their own subscriptions and registry changes still work. The 100ms window adds a small activation delay in exchange for fewer redundant panel changes; it cannot interrupt a synchronous render already underway or shorten IPC reads. Revisit if real desktop profiling still shows long commits after coalescing.

The file search input and adjacent external-editor button use shell tokens for borders, fill, text and focus. The input uses a neutral border at rest and the active theme accent while focused; its border belongs to CSS rather than an inline style so focus can override it. The external-editor button shares the same theme colors while keeping its disabled state.

The right rail now selects tools with neutral fill and foreground contrast, without the accent stripe. Inactive tools have no dot or other status ornament; selection uses neutral fill and foreground. Tool entries remain at fixed top positions as the panel opens and closes; no bottom toggle is rendered. Per-tool width preferences remain unchanged. File and session searches share 28px height, 12px horizontal toolbar padding and neutral card fill; focus keeps the accent outline. The session toolbar omits the duplicate current-tool heading. Git uses a neutral branch marker, nonzero-only plain-text change statistics and unfilled section headers with 11px labels. Existing staging, commit, remote operations and history controls retain their behavior.

Search control verification: an isolated browser stylesheet check passes default, hover and focus in planche/dark; screenshots are under artifacts/file-search-theme. The existing file-explorer-delete, file-tree-drag and planche-theme unit files pass 27 cases; typecheck, theme:check and scoped ESLint pass (two existing hook warnings). This does not establish live Electron validation.

The dock maps its local shell canvas, chrome, card and hover roles to tool-canvas/card/chrome/hover from the central theme definition. Planche keeps the dock ground identical to the central warm paper (#EFE4C5), with slightly lighter cards (#F2E9D2) and popovers (#F3EBD7). Large near-white tool surfaces were rejected because they split the workspace into mismatched color blocks. Workspace, file-tree and terminal-preset menus plus Select dropdowns share popover-background/hover/shadow and control-border, replacing yellow-brown fills and hard offset shadows. New themes supply these roles once rather than branching inside each component. Browser coverage in tests/e2e/tool-palette.spec.ts mounts the real Sidebar and RightDock in planche/dark, checks dock/menu colors, hover and Escape dismissal, and renders session cards; screenshots are under artifacts/tool-palette. IPC uses fallbacks, so this is not live Electron validation.

While expanded, right-rail icon hints prefer the left side and align with their own button, keeping the vertical control column clear. ThemedTooltip measures its rendered size before choosing a flipped position and clamping to an 8px viewport margin. Pointer input passes through all hints; pointerdown/click cancels visible and pending hints, while keyboard focus still explains controls. Scroll, resize and Escape also cancel pending timers. Git commit previews now follow the same non-blocking policy: leaving the row dismisses immediately, the preview does not capture pointer input or scroll, and clicking a commit expands its file details in the panel. Changing the active tool or workspace dismisses Git previews. The trade-off is that hover previews are bounded summaries; longer content is read in the expanded row. These behaviors are covered in tests/e2e/right-tool-tooltips.spec.ts with actual rail controls, long edge hints, keyboard focus and a clickable control underneath the Git preview in planche/dark. Verification: 4 browser cases pass across the tooltip and palette files, along with typecheck, scoped ESLint, theme:check, 47 planche/right-tool-state/theme-audit unit cases and check:notes (0 errors; 17 existing external-link diagnostics). Browser IPC uses fallbacks; live Electron behavior was not tested.

ThemedTooltip subscribes to global scroll, resize, pointerdown and Escape only while a hint is pending or visible, then removes those listeners on dismissal. This preserves cancellation during the delay without installing four global listeners for every idle instance. Both theme cases in `tests/e2e/right-tool-tooltips.spec.ts` pass after this lifecycle change; packaged long-session latency remains unmeasured.

## Click-switch layout and persistence verification, 2026-10-24

The panel shell still animates its width, but its content host now takes the destination width immediately, minus the shell's two border pixels. The host stays right-aligned and clipped by the shell, including viewport-bounded transient previews. This restores the intended one-width content layout: the former `width: 100%` made lists and text reflow on every width-animation frame. The workspace grid still interpolates, so center terminal/editor resize work is outside this fix.

Right-tool persistence skips identical serialized synchronous writes after the first successful write and invalidates that cache on storage removal. Width changes remain immediately durable; asynchronous storage retains its original behavior. Expand/collapse commands also skip an already-matching app state. The existing 100ms activation window and local-state retention remain unchanged.

Both regressions failed before the fix: content deviated up to 260px during animated switches, and eight Git/files round trips caused 16 duplicate preference writes. Afterward content stays within 1px of its destination and unchanged preferences cause no extra writes.

## Real workspace switch profiling, 2026-10-25

Retained hidden RoundtableStage previously polled geometry on every frame; the baseline CPU profile attributed 39.8 seconds to its getBoundingClientRect calls. IntersectionObserver and document visibility now stop hidden polling, and visible polling reads all geometry before writing labels. Git file rows use memoized complete file-field/action comparison, so both tool activation and unchanged background status snapshots reuse rows. Files render in groups of 16 with content-visibility:auto, while commit history skips offscreen row layout and shares its date formatter. This retains DOM/accessibility and native scrolling; estimated group heights are remembered after layout. Revisit batching if variable-height file rows are introduced. A 500-file browser regression reaches and stages the last row after switching and verifies a genuine status change still renders.

External OpenCode discovery was a second, independent cause: synchronous historical answer queries blocked the Electron main thread for up to 5315ms. Reverse latest-answer lookup and per-session event-loop yielding are owned by [OpenCode discovery](../sessions/records/opencode-session-driver.md). Hidden animation suspension alone did not resolve large Git transitions; repeated real profiles drove the row-layout and rendering fixes.

Six complete runs each perform 600 seeded random switches in real Electron against the actual JanusX workspace, with normal file/Git/provider IPC and background services. The final run loads 459 changed files, 100 commits and 171 workspace sessions (200 registered, 20 list cards), with 9770 DOM nodes. Baseline versus final: renderer long tasks 165 -> 0, frame intervals over 50ms 172 -> 1, over 100ms 34 -> 0, maximum frame interval 159.6 -> 55.2ms, click-to-next-frame P95 213.3 -> 135.9ms and maximum 266.7 -> 152.5ms. Git alone improves P95 232.4 -> 140.2ms. The final 339-second sample includes 24 Git status reads and 15 external scans. All 600 switches complete.

The next-frame metric observes aria-pressed commit followed by rAF, includes the existing 100ms activation window, and does not measure physical compositor presentation. A 55ms frame remains. Main-thread startup Note indexing still blocks up to 1000ms; after the first 30 seconds its measured maximum is 277ms. This does not claim zero jank with live terminal output, populated knowledge stores, larger pathological sessions, or other machine load. The test uses an isolated app profile and copied session registry with real provider stores; no active terminal process or personal knowledge corpus is loaded. Unrelated workspace edits continue during runs, so dataset sizes vary. The installed application is not replaced.

Reproduce with `npx electron-vite build --outDir artifacts/right-switch-build-verified`, set `NO_PROXY=127.0.0.1,localhost` and `RIGHT_SWITCH_BUILD=artifacts/right-switch-build-verified`, then `node scripts/probe-right-tool-switch.mjs artifacts/right-switch-recheck 600`. Evidence is local at `artifacts/right-switch-performance-report.md` and `artifacts/right-switch-live-{before,after,final,grouped,memo,verified}` (summaries, measurements, both CPU profiles and screenshots). Unit suites pass 65 cases; final Git/layout/tooltip browser suites pass 6 cases, with the preceding hover/motion/rail/roundtable suite passing 19. Build and scoped lint pass; the final typecheck reports unrelated unknown result destructuring in `plugins/blueprint/src/main/janus/maintenance/service.ts`.

## Alternatives considered

- Per-tool windows — strongest case gives every tool full space. The driver that rules it out is frame fragmentation: tools scatter beyond the working context.
- Repeatable tool instances — strongest case mirrors document tabs. The driver that rules it out is semantic mismatch: tools are capability entries, not documents.
- Full-color file icons — strongest case reads faster at a glance. The driver that rules it out is noise: saturated rainbows fight the restrained shell.
- Do nothing / reuse fixed tabs — staying put avoids all migration risk. The cost is an unextendable strip and a mute file tree.

## Consequences

- **Gains**: New tools arrive through registry order without squeezing chrome; file kinds read instantly across tree and viewer from one taxonomy.
- **Costs and limits**: Singleton tools cannot split side by side; rail drag sorting stays out until range pressure demands it.
- **Width behavior**: Narrow viewports constrain persistent widths or auto-collapse below the tool minimum; transient cards remain viewport-bounded. Saved manual widths return when space is available again. The v1 persisted shared width remains the fallback for tools without a dedicated drag preference.

## Hover navigation verification, 2026-10-22

The original implementation restarted the 220ms initial dwell on every icon entry, delaying both the shared indicator and content even while a preview was open. The new browser regression fails on the original code with Git still hidden after advancing 32ms, and passes after limiting dwell to initial entry. It checks five successive target changes, retained initial dwell, exit-time re-entry and cancellation of dismissal. This is a controlled browser-clock assertion, not a real desktop latency measurement. The hover, dock-motion, rail-feedback, switch-performance and tooltip suites pass 19 browser cases with seeded IPC. The dock/state/collapse unit suites pass 37 cases; typecheck and scoped ESLint pass. Real Electron workloads may still have additional render or IPC latency, which has not been profiled here.

## Preview-to-panel verification, 2026-10-20

After changing persistent surfaces to docked panels, the hover, motion, tooltip and workspace-design files pass 14 browser cases. The hover tests sample an intermediate corner radius in both themes, verify uninterrupted opacity and retained search state, and confirm that the center yields exactly the tool width. The motion tests cover full-height square corners, resizing and reduced motion. Screenshots are under `artifacts/right-dock-morph` and `artifacts/right-dock-morph-final`; the planche docked screenshot was visually inspected. The 37 related unit cases, typecheck, scoped ESLint, theme check and Note validation pass. Pointer-drag verification waits for the opening geometry to settle before targeting the resize handle. Live Electron placement remains unverified.

## Earlier floating card verification, 2026-10-20

The hover, motion, tooltip, workspace design, bundled extension, rail feedback, switch performance and palette Playwright files pass 25 browser cases. They cover transient versus persistent geometry, narrow viewport bounds, state retention, exit-time inertness, resizing, reduced motion and nested tooltip Escape dismissal. Escape dismisses transient cards but leaves persistent panels open so tool-local dialogs and hints can handle it. Screenshots are under `artifacts/right-card-reserved` and `artifacts/right-card-final`. The three right-tool-dock/right-tool-state/side-panel-collapse-ui unit files pass 37 cases. Typecheck, application build, scoped ESLint, theme and i18n checks pass. Browser fixtures use seeded IPC; live Electron terminal island placement and physical macOS controls have not been verified.

## Historical verification of the retired tab design

The following records describe the earlier top-tab and separate-toggle implementation; those controls and their dedicated tests have been removed. Current interaction coverage lives in `tests/e2e/right-dock-hover.spec.ts` and the adapted rail, motion and lifecycle suites.

## Tab appearance verification, 2026-10-14

The four existing right-dock, state, collapse and planche-theme unit files pass 58 cases. A temporary browser fixture mounts the real `RightToolTabs` and styles beside the middle header. Eight scenarios cover planche/dark at 240, 260, 360 and 520px, checking compact height, inherited font, unclipped text height, borderless rounded tabs, overflow visibility, End/Enter activation and closing the active tool with the keyboard. Screenshots and measured results are under `artifacts/right-tabs-alignment`; the fixture uses browser IPC fallbacks and does not establish live Electron validation.

Verification of the compact right-tool design: 8 browser cases pass across right-workspace-design, tool-palette and right-tool-tooltips, covering planche/dark, 340/520px panels, keyboard expansion, search, stable tool positions after the last close, and tooltip dismissal. Four related unit files pass 58 cases. Typecheck and scoped ESLint pass; FileExplorerTool retains its two existing hook warnings. Browser IPC is seeded, so this does not establish live Electron verification. Preview: artifacts/right-workspace-preview/comparison.png.

## Width transition verification, 2026-10-15

The browser palette fixture uses the production layout calculation and shared grid transition, including per-tool widths, collapse and immediate pointer resizing. `right-dock-motion`, `right-workspace-design`, `tool-palette` and `right-tool-tooltips` pass 12 browser cases in planche/dark. Frame samples verify a changing shell width, constant 520px destination content and a stationary rail; other checks cover return to file width, rapid switches with retained search, saved drag width and reduced motion. Screenshots use `artifacts/right-dock-motion`. The right-tool dock/state unit files pass 42 cases; typecheck and scoped ESLint pass. IPC is seeded in the browser fixture; live Electron performance has not been measured.

## Tab feedback verification, 2026-10-19

Four `right-tool-tab-feedback.spec.ts` browser cases pass: planche/dark observe marker movement while the old panel is still visible, cross-frame Git/session reversals activate only the final target, returning to the current tab/closing/collapsing cancels pending activation, and keyboard activation/close plus reduced motion remain usable. Screenshots under `artifacts/right-tab-feedback/motion` were visually inspected. Six existing motion and switch-performance cases pass; the width sampler now starts measuring the destination content once that panel is activated. Eight lifecycle, tooltip and 340/520px workspace cases pass under `artifacts/right-tab-feedback/regression`. These 18 cases use real components and seeded IPC. The initial motion assertions sampled native CSS transitions as though Playwright's JS clock controlled them; switching to frame-position polling fixed the assertions. Real desktop frame latency remains unmeasured.

`npx vitest run tests/unit/right-tool-dock.test.ts tests/unit/right-tool-state.test.ts tests/unit/planche-theme.test.ts` passes 56 cases. Typecheck and scoped ESLint pass. Verification retains the previous session data reuse changes and does not package or restart the user's dev process.

## Vertical rail and pane feedback verification, 2026-10-19

The new rail test first fails in both themes against immediate activation, confirming that the actual far-right entry bypassed the feedback window. After the change, five rail cases cover cross-frame latest-target activation, reversal, close/gate removal, reopening, collapse/expand, external activation, repeated-target deadlines and native keyboard use. A reduced-motion failure exposed CSS rule ordering; moving the indicator definition before the media override fixes it. The final seven-case rail/performance run passes under `artifacts/right-rail-feedback/final`. Eight real rail round trips commit all 16 Git/session transitions yet read the scoped session list only once. This proves work reuse in the seeded fixture, not real desktop frame latency.

Across the targeted runs, 55 distinct browser cases pass: rail/top-tab feedback, pane feedback/dragging, width motion, extension lifecycle, session reuse and workspace surfaces. The five dock/state/theme/pane/drop-hint unit files pass 98 cases. Typecheck, scoped implementation ESLint, diff whitespace and Note validation pass (322 Notes, zero errors, 17 existing external-link diagnostics). Rail planche and pane dark screenshots were visually inspected. These tests use real components with fixture IPC; the user's existing dev process remains available for real workload testing.
