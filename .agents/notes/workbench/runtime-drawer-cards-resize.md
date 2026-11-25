---
{
  "schema": "harness-note/2",
  "id": "faacdaf7-3feb-5b33-90e0-eeb59d6b0c62",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-09-19",
  "class": "feature",
  "extensions": {
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-09-19-agent-note-runtime-drawer-cards-and-drag-height--faacdaf7.md",
      "sourceHash": "cf14e8f4f5c288759c3b9797adb94f81e6c97797e40e0dcd28271191231966c0",
      "originalBodyHash": "5ba91f7e3be31ef5b0431e8b37399ae127104ca3ae73d32b9413f9ac46cb683e",
      "category": "formal",
      "reason": "Retains the source decision in implemented lifecycle; body documents Runtime drawer cards and drag height. No age-based archival.",
      "edits": [
        "Rebased Markdown destination: ./2026-09-12-terminal-status-display.md -> ./2026-09-12-terminal-status-display--27891818.md",
        "Rebased Markdown destination: ./2026-09-19-terminal-status-ring.md -> ./2026-09-19-terminal-status-ring--fc9a87e5.md",
        "Removed redundant Agent Note title prefix",
        "Removed lifecycle duplicated by frontmatter"
      ],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/implemented/feature/2026-09-19-runtime-drawer-cards-resize.md",
        "sourceHash": "ce64a8a258a62163b7547380fcae409228c6a5ae4134a232c8b1a07ce1a51235",
        "originalBodyHash": "b7bc959ac249934d78e9bad85135cb886dc1540bb2f7e134406d3c5328d367a0"
      }
    }
  },
  "updated": "2026-11-25T14:33:38Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/19cd1394-b2cb-4819-8fde-5f12de16574c"
}
---
# Runtime drawer cards and drag height

The [Markdown pane migration](./markdown-pane-entry.md) removed the Markdown editor and its view tab from this drawer; the Markdown editor is now a workspace pane and the bottom drawer carries only the runtime monitor. Runtime cards and their adjustable height remain a bottom monitoring surface. The height model below is a single drawer height, not the per-view model this note first recorded.


## Problem

The bottom drawer in `TerminalArea.tsx` lists terminal runtime telemetry as one table row per terminal: provider, model chip, a context bar with its label, and an age column packed into a four-column grid. The row only fits when the terminal area is wide, and the context label and the bar fight for the same column, so the line the user most wants to read is the one that truncates first. The drawer height is fixed per view and the list caps at 141px, so a workspace with more than three terminals scrolls inside a strip too short to compare them, and no gesture lets the reader compare more usage cards.

## Decision

The 2026-11-13 implementation follows the accepted [conversation prototype](./ideas/conversation-interface-prototype.md) for the existing project-region Usage footer. The toolbar keeps its 28px allocation. Its panel is positioned above the bar and overlays the pane: opening, closing, expanding statistics and resizing do not change pane geometry or scrollback. This replaces the earlier height-consuming drawer. The panel uses the existing theme tokens; it does not move the footer to the global tools region or invent SuperAgent telemetry.

The toolbar shows the active terminal's provider, workspace/model where space permits, an 18px hollow context ring with a persistent external percentage, and a session count. The arc and the percentage in its tooltip share the active theme’s context colors, interpolated between 0%, 50%, 85% and 100% usage. A lighter tint on the track keeps the color visible at low usage. At zero the ring shows only the tinted track beside 0.0%. Unknown usage shows a neutral track beside “–”. The ring opens the existing exact usage details on hover, keyboard focus or click without toggling the panel. Escape dismisses that tooltip before the panel. The Usage button supports Enter/Space; toolbar blank space and the count also toggle it. Close and Escape restore focus to Usage; outside pointer/focus closes without stealing the new focus. Selecting a card activates its terminal; when that terminal takes focus the panel closes.

The panel has a fixed heading/close control and an internally scrolling list with overscroll containment. Cards use three columns above 1000px, two above 600px, and one below, with a 1320px grid maximum, 12px gaps, 15px card padding and 11px corners. Current identity follows the HTML prototype: a 2px × 19px neutral marker beside the identity and aria-current. Every card retains the same quiet border; selection does not brighten the full perimeter. Main statistics remain directly visible: context, cumulative cache hit/read/write, total tokens, input/output, confirmed compactions and instance runtime. More statistics exposes remaining context, runtime window and model capacity. Card and tooltip values remain derived from existing terminal fields and cacheSplitFor; unknowns are not synthesized. More-statistics disclosure survives footer collapse, while runtime timers pause when the panel is closed.

The panel now fits its content, with a 120px floor and an initial ceiling of min(360px,50dvh), plus the existing short-window cap. This replaces the fixed 440px initial height after the user found the first implementation too large. The heading and outer padding are tighter, and the upper shadow/glow is removed. Explicit resizing can still use the existing 60dvh ceiling; resize gestures start from the measured panel height, and a ResizeObserver keeps the separator value synchronized with content changes. The existing pointer-capture resize handle and 16px keyboard increments remain; resizing affects only the overlay, preserves the 120px floor and 160px pane reserve in the height clamp, and is not persisted. Reduced motion removes animation; normal enter/exit uses 180ms opacity/translation. Closing immediately makes the panel inert, then hides it after 190ms; rapid reopen cancels the pending hide. Each opening resets only the panel's internal scroll. Native browser surfaces are occluded while the panel is presented because DOM z-index cannot cover native web views. The retained height helpers in quick-note-behavior.ts remain compatibility utilities; TerminalArea no longer calls getDrawerHeight to size the workspace.

The first surface update passed all three `tests/e2e/terminal-usage.spec.ts` cases and the then-13 drawer unit cases. The toolbar follow-up removes the obsolete header-reservation test, leaving 12 drawer cases. Its browser run passes 37 cases across workspace-surface, pane-tab-drag and terminal-usage; four new toolbar scenarios cover both themes at 1280/480px, context visibility and overflow, native keyboard toggles, consecutive resize keys, border states and mounted terminal preservation. The final model-spacing refinement passes another 16 workspace-surface and terminal-usage cases. Scoped ESLint, typecheck and 65 cases across drawer, planche, workspace-sidebar and workspace-pane unit files pass. The final application build and both Electron desktop smoke cases pass, including the real sidebar heading's absent bottom border and 40px height. Desktop screenshots were visually inspected alongside the theme and narrow-width renderer fixtures. Screenshot artifacts live under `artifacts/workspace-chrome`; browser cases use renderer components with Electron IPC fixtures, while desktop cases exercise the built application.

2026-11-13 验证：`npx playwright test tests/e2e/terminal-usage.spec.ts tests/e2e/workspace-surface.spec.ts tests/e2e/runtime-drawer-overlay.spec.ts --project=island --workers=1 --timeout=60000 --output artifacts/runtime-drawer-production-20261113/final-browser` 共23项通过（用量3、覆盖式交互7、工作区13）。覆盖圆环独立点击/悬浮/键盘焦点、Esc优先级、关闭归焦与inert、真实xterm几何和历史阅读位置、连续开合、更多统计状态保留、指针/键盘调高、三种主题及360–1440px布局。已目视检查白色桌面、纸色390px和深色360px最终截图。严格类型、定向ESLint、翻译一致性及最终build:check通过；Notes校验0错误、17条既有外部链接诊断。日志和截图位于 `artifacts/runtime-drawer-production-20261113/`。首轮卡片切换断言按移焦自动关闭的交互更新；一次首次页面加载超时以60秒测试时限复跑通过；截图检查发现的减少动态选择器优先级问题及夹具未实际选择纸色主题均已修复并复验。未运行完整测试套件、live Electron、真实模型/CLI用量对账或打包替换安装版。

2026-11-13 紧凑化复验：`npx playwright test tests/e2e/runtime-drawer-overlay.spec.ts tests/e2e/workspace-surface.spec.ts --project=island --workers=1 --timeout=60000 -g "usage|context details|opening, details" --output artifacts/runtime-drawer-compact-20261113/browser` 的11项相关用例通过。定向浏览器检查确认1280×800下多会话360px、单会话352.5px、无会话120px；调高从实际高度开始，卡片边框一致，仅当前卡片有19px短标记，面板box-shadow为none。已目视检查深浅主题及单会话截图。严格类型、定向ESLint和diff空白检查通过；证据位于 `artifacts/runtime-drawer-compact-20261113/`。本轮未重跑生产构建、完整测试或安装版Electron。

## Codex subscription quota

The active local Codex terminal shows the remaining subscription windows beside its context ring. A narrow footer keeps the window with the lowest remaining percentage. Its button opens both windows, reset times, the last update and manual refresh. The composer shows a restriction only on explicit backend evidence, accounts for available credits and includes the next known exhausted-window reset.

For direct official endpoints the main process uses the terminal’s own App Server to verify the thread provider, ChatGPT account and native sign-in mode. Only a verified user and workspace pair can share account quota across terminals. The renderer receives window values, timestamps and status flags. Changing the account or provider invalidates the binding and rejects late responses.

For a local HTTP or HTTPS proxy such as Magpie, the footer uses the most recent Codex rate-limit report from the active thread’s own rollout. Details identify the session as the source and show the record’s timestamp. Native usage and turn-completion events prompt the visible footer to reread the file. The reader searches backwards through up to 8 MiB, skips unrelated limit IDs and drops expired or zero-duration windows. Each thread keeps its own readings. This path makes no account quota or credential requests and only shows a percentage once the session reports a window. Other remote gateways remain ineligible.

The first visible eligible terminal reads immediately. Native updates merge the windows they contain. Returning to the foreground, selecting a terminal or opening details checks for a window at least 60 seconds old. Open, foreground details check every five minutes. A known reset triggers one visible read at its deadline. Collapsed and background views have no periodic polling. Requests in flight are shared, manual reads have a ten-second minimum interval, and errors retain the last snapshot and respect the server’s retry delay.

The clock and routing cases live in `tests/unit/codex-quota.test.ts`. Browser coverage in `tests/e2e/terminal-usage.spec.ts` exercises the footer in wide and narrow layouts, sign-out, the details timer and resets.

## Alternatives considered

- Persist the drawer height in a store like the right dock width — strongest case is that a chosen height survives restarts. The driver that rules it out is that the drawer is closed on every launch and the two views want different heights, so a persisted value needs a schema and migration for a preference the user re-establishes with one drag; component state keeps the change local and reversible, and persistence can be added when the launch-closed default changes.
- Keep rows and only add the drag handle — strongest case is a smaller diff with no visual change. The driver that rules it out is that a taller drawer makes the row layout worse, since the rows grow no wider and the empty space below them carries nothing.
- Fixed two-column card grid — strongest case is a stable layout that never reflows. The driver that rules it out is that the terminal area width ranges from a narrow split pane to a full window, and two fixed columns either truncate model names at the narrow end or leave half the width empty at the wide end.
- Do nothing / reuse — staying put keeps the row list and the fixed heights. The cost is the truncated context line and the 141px cap that hides most terminals in busy workspaces.

## Consequences

- **Gains**: Each terminal's context usage reads as a unit with its own bar and percentage, and the grid shows as many cards as the width allows. The user can resize the overlay to compare terminals without changing the panes, with a keyboard path on the handle.
- **Costs and limits**: The chosen height lives in component state and is lost on reload; collapse and expand retain it within the mounted area. The handle is absent while collapsed. The 160px uncovered-space reserve is a clamp, not a reduction of terminal rows; short windows scroll inside the overlay. Cards render inside the drawer only, so the sidebar and tab strip keep their existing status forms, owned by [terminal status ring](../terminal/terminal-status-display.md) and [terminal status display](../terminal/terminal-status-display.md).
