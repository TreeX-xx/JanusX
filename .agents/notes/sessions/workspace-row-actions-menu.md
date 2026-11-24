---
{
  "schema": "harness-note/2",
  "id": "9108f4a9-39d6-5d2a-9a6b-5b79bbef493a",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-09-19",
  "class": "feature",
  "extensions": {
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-09-19-agent-note-workspace-row-actions-menu--9108f4a9.md",
      "sourceHash": "fb3466abacd5a73ff7cb4ce85e6ac9acfc8189616cdadbdcc0abd2eff951534e",
      "originalBodyHash": "ac65a63161190c9ff14d4bcd0b9b4156efdb9c30ddc5f4fcfa84ba5444cc5237",
      "category": "formal",
      "reason": "Retains the source decision in implemented lifecycle; body documents Workspace row actions menu. No age-based archival.",
      "edits": [
        "Rebased Markdown destination: ./2026-09-21-workspace-row-hover-reveal.md -> ./2026-09-21-workspace-row-hover-reveal--ce93b420.md",
        "Removed redundant Agent Note title prefix",
        "Removed lifecycle duplicated by frontmatter"
      ],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/implemented/feature/2026-09-19-workspace-row-actions-menu.md",
        "sourceHash": "23e0ed223a56a5722f594016994aa323ef7da64df15890cbd45edced4616036d",
        "originalBodyHash": "b88230f826f6f391008b3a35a5e6d77522b0111f30f07f4ceeabd6e7dcfb3867"
      }
    }
  },
  "updated": "2026-11-24T15:33:40Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/dc1aca7c-408f-406d-add4-ba78d556b662"
}
---
# Workspace row actions menu


## Problem

An expanded workspace row in `Sidebar.tsx` exposes its actions through two channels that hide from a first-time reader. The only visible control is a `×` that appears on hover and jumps straight to the delete confirmation, so the most destructive action is the only one with a button. Run configuration, group rename, and remove-from-group live in a right-click menu that nothing on screen announces except a tooltip sentence, and users who never right-click a sidebar row never find them. The row also starts with a chevron and a bare name, so a workspace reads as a text line rather than a folder on disk.

## Decision

Each expanded workspace row has a folder disclosure button on the left and a fixed action slot on the right. The folder toggles the children, and selecting the name activates and expands the workspace. The action slot reveals its `⋯` button on hover or keyboard focus. Clicking `⋯` opens the same `WorkspaceContextMenu` that right-click opens elsewhere, anchored under the button with its right edge aligned to the button's right edge; a second click on the same button closes it. The button carries `aria-expanded` and the `common:workspace.moreActions` label, and the hover `×` shortcut to delete is gone, so delete is reachable only through the menu's red item and its confirmation dialog. The `onContextMenu` handler is removed from expanded rows, so right-click on an expanded row falls through to the default and opens nothing. Right-click stays on the collapsed rail, where no button fits in a 36px square, and on group headers, which have no button of their own. `Shift+F10` on a focused row still opens the menu near the row's top-left corner so keyboard users keep a path that does not depend on the pointer. The row tooltip and aria description drop the "right-click for run configuration" clause in both locales because the sentence would be false.

## Alternatives considered

- Keep right-click on expanded rows alongside the button — strongest case is that no existing habit breaks and the e2e path stays untouched. The driver that rules it out is the user's request to have one visible entry per row; two entries for one menu keep the discoverability gap for people who never right-click while adding nothing the button lacks.
- Show the `⋯` only on hover like the old `×` — strongest case is a quieter row with no permanent glyph beside every workspace. The driver that rules it out is that a hover-only control is invisible to the reader who does not know it exists, which is the same failure the hover `×` had; a persistent button also gives touch and keyboard users a target.
- Keep the hover `×` next to the new button — strongest case is one-click delete for people who prune workspaces often. The driver that rules it out is that a bare one-step delete beside a menu that also contains delete is a duplicate whose only distinction is being easier to hit by accident.
- Do nothing / reuse — staying put keeps right-click plus hover `×`. The cost is that run configuration and grouping actions stay hidden behind a gesture with no on-screen cue, and the visible affordance is the destructive one.

## Consequences

- **Gains**: Every action on a workspace row is reachable from one visible button, and delete sits behind the menu plus its confirmation rather than a hover target. The folder glyph gives rows the same visual anchor the empty-workspace screen uses. The `desktop-smoke` e2e drives the menu through the button's accessible name instead of a right-click, so the spec documents the discoverable path.
- **Costs and limits**: Right-click on an expanded row does nothing, which surprises users who learned the old gesture; the collapsed rail and group headers keep right-click, so the sidebar has two menu-opening conventions. The `⋯` button anchors the menu by subtracting `MENU_WIDTH` from the button's right edge and lets the menu's own clamp keep it on screen, so a change to the menu width must update the constant, never the inline style. The [row reveal behavior](./workspace-row-hover-reveal.md) keeps the menu anchor stable. The folder icon shows whether the workspace is open or closed.
