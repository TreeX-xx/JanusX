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
  "updated": "2026-10-23T15:27:38.390Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/19cd1394-b2cb-4819-8fde-5f12de16574c"
}
---
# Runtime drawer cards and drag height

The [Markdown pane migration](./markdown-pane-entry.md) removed the Markdown editor and its view tab from this drawer; the Markdown editor is now a workspace pane and the bottom drawer carries only the runtime monitor. Runtime cards and their adjustable height remain a bottom monitoring surface. The height model below is a single drawer height, not the per-view model this note first recorded.


## Problem

The bottom drawer in `TerminalArea.tsx` lists terminal runtime telemetry as one table row per terminal: provider, model chip, a context bar with its label, and an age column packed into a four-column grid. The row only fits when the terminal area is wide, and the context label and the bar fight for the same column, so the line the user most wants to read is the one that truncates first. The drawer height is fixed per view and the list caps at 141px, so a workspace with more than three terminals scrolls inside a strip too short to compare them, and no gesture lets the reader trade pane height for drawer height.

## Decision

The view is named Usage and renders each terminal as a card in an auto-filling grid with a 260px column floor, capped at the available width in narrower drawers. A card shows provider, status, terminal runtime, model, context bar and the usage statistics directly. Clicking a card activates that terminal; the old hover preview and secondary details overlay are removed. Cards use quiet rounded fills without perimeter borders. The active card keeps its left accent marker, emphasized provider name, slightly stronger neutral fill and `aria-current`. The list fills the drawer and scrolls when the cards exceed it. Field semantics and implementation evidence belong to [direct usage content](../terminal/requirements/usage-panel-direct-content.md).

The drawer has one user-adjustable height. `quick-note-behavior.ts` owns the model: a 28px collapsed height, a 120px floor, a 160px pane reserve, a 320px default and `clampDrawerHeight` which rounds and clamps between the floor and a caller-supplied ceiling. `getDrawerHeight` accepts an optional scalar height. `TerminalArea.tsx` keeps it in component state and renders a 7px `term-drawer-resize` separator across the open drawer's top edge, using pointer capture; the ceiling is the area's height minus the pane reserve. Arrow keys move by 16px and Home/End select the floor/ceiling. `CLITerminal` preserves focus on external controls during layout refits; the drawer's existing short keyboard-focus recovery remains as a fallback. A CSS `max-height` maintains the pane reserve when the window shrinks, and height transitions are suppressed while dragging.

The monitoring surface follows the continuous workspace design. Collapsed, it shares the canvas and has no top rule; expanded, it gains one weak top rule, a faint neutral background and the resize target. The whole 28px toolbar is a native button with expanded state, panel identity and Enter/Space activation. Its rounded Usage label responds locally to hover, focus and expansion, matching the workspace tabs. Identity/model/other-terminal summaries and the semantic context badge have no outlines. The old 208px reservation for a removed header control is gone. Container queries follow the actual project region, excluding global tools: other-terminal summaries hide at 760px, workspace identity at 560px, provider at 420px and model at 360px. Below 360px the context becomes a percentage, preserving Usage and its click target. These rules override generic metadata display styles. The fixed-outer-width splitter regression and two-theme coverage belong to [auxiliary panel controls](./requirements/auxiliary-panels-preview-controls.md). Model labels truncate within their allocation instead of reserving empty width. Card-grid and heading frames remain absent. Tab-strip selection and split boundaries are documented in [workspace tabs and layout](./pane-tab-reorder.md).

The first surface update passed all three `tests/e2e/terminal-usage.spec.ts` cases and the then-13 drawer unit cases. The toolbar follow-up removes the obsolete header-reservation test, leaving 12 drawer cases. Its browser run passes 37 cases across workspace-surface, pane-tab-drag and terminal-usage; four new toolbar scenarios cover both themes at 1280/480px, context visibility and overflow, native keyboard toggles, consecutive resize keys, border states and mounted terminal preservation. The final model-spacing refinement passes another 16 workspace-surface and terminal-usage cases. Scoped ESLint, typecheck and 65 cases across drawer, planche, workspace-sidebar and workspace-pane unit files pass. The final application build and both Electron desktop smoke cases pass, including the real sidebar heading's absent bottom border and 40px height. Desktop screenshots were visually inspected alongside the theme and narrow-width renderer fixtures. Screenshot artifacts live under `artifacts/workspace-chrome`; browser cases use renderer components with Electron IPC fixtures, while desktop cases exercise the built application.

## Alternatives considered

- Persist the drawer height in a store like the right dock width — strongest case is that a chosen height survives restarts. The driver that rules it out is that the drawer is closed on every launch and the two views want different heights, so a persisted value needs a schema and migration for a preference the user re-establishes with one drag; component state keeps the change local and reversible, and persistence can be added when the launch-closed default changes.
- Keep rows and only add the drag handle — strongest case is a smaller diff with no visual change. The driver that rules it out is that a taller drawer makes the row layout worse, since the rows grow no wider and the empty space below them carries nothing.
- Fixed two-column card grid — strongest case is a stable layout that never reflows. The driver that rules it out is that the terminal area width ranges from a narrow split pane to a full window, and two fixed columns either truncate model names at the narrow end or leave half the width empty at the wide end.
- Do nothing / reuse — staying put keeps the row list and the fixed heights. The cost is the truncated context line and the 141px cap that hides most terminals in busy workspaces.

## Consequences

- **Gains**: Each terminal's context usage reads as a unit with its own bar and percentage, and the grid shows as many cards as the width allows. The user can pull the drawer up to compare all terminals and push it down to give the panes room, with a keyboard path on the handle.
- **Costs and limits**: The chosen height lives in component state and is lost on reload; collapse and expand retain it within the mounted area. The handle is absent while collapsed. The pane reserve of 160px is a constant and not derived from the terminal's minimum rows, so a very short window can still leave the terminal cramped. Cards render inside the drawer only, so the sidebar and tab strip keep their existing status forms, owned by [terminal status ring](../terminal/terminal-status-display.md) and [terminal status display](../terminal/terminal-status-display.md).
