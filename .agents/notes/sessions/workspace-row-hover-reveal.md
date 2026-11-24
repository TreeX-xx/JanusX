---
{
  "schema": "harness-note/2",
  "id": "ce93b420-be7c-5f68-95f7-12f7d4703d06",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-09-21",
  "class": "feature",
  "extensions": {
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-09-21-agent-note-hover-revealed-actions-button-on-the-workspace-row--ce93b420.md",
      "sourceHash": "1c319427ce40bc28e2f85601195478f70de0add579d9454df1691c85a743a131",
      "originalBodyHash": "85b346e9920a7b1630ee706d110e5cfaed507080f6b69cd0a98c55215c445449",
      "category": "formal",
      "reason": "Retains the source decision in implemented lifecycle; body documents Hover-revealed actions button on the workspace row. No age-based archival.",
      "edits": [
        "Rebased Markdown destination: ./2026-09-19-workspace-row-actions-menu.md -> ./2026-09-19-workspace-row-actions-menu--9108f4a9.md",
        "Rebased Markdown destination: ./2026-09-19-workspace-row-actions-menu.md -> ./2026-09-19-workspace-row-actions-menu--9108f4a9.md",
        "Removed redundant Agent Note title prefix",
        "Removed lifecycle duplicated by frontmatter"
      ],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/implemented/feature/2026-09-21-workspace-row-hover-reveal.md",
        "sourceHash": "409ad2a46a23f710725080b8f005fb23ea3adb36313c6d0b7ea30a7cd71898c5",
        "originalBodyHash": "786ad8bebb0554fd25716a55e63a14fcfb852f029a44b7da061ee983f9e99d9e"
      }
    }
  },
  "updated": "2026-11-24T15:33:40Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/dc1aca7c-408f-406d-add4-ba78d556b662"
}
---
# Hover-revealed actions button on the workspace row


## Problem

An expanded workspace row in `Sidebar.tsx` ends with four controls: the chevron, the folder glyph, the workspace name, and a terminal badge that carries the workspace's terminal count with one status dot per state. The `⋯` button that opens the row's action menu sits after the badge at a permanent 20px width plus the row's 8px gap, so the badge — the element a reader scans down the list to see which workspace needs attention — stops 28px short of the row's right edge and reads as inset from the vertical reference the eye uses while scrolling. Every row also carries a permanent grey glyph at its right edge, which puts a second anchor beside the chevron and the folder icon for a control that matters only at the moment the reader wants an action on that one row. The row therefore looks busy at rest, and the status column is the thing that pays for it.

## Decision

Workspace rows reserve a 24px slot for the action menu. Hover, keyboard focus or an open menu reveals its button. The leading button crossfades between closed and open folders as the child list folds or unfolds. Both transitions run for 200ms and switch immediately with reduced motion. Linked worktrees show their terminal count and action menu in the same trailing slot. Names keep their width when controls appear. On touch devices the controls are directly visible.

## Alternatives considered

- The former zero-width slide gives names more room at rest. It also shifts their truncation point during hover and moves the menu anchor; the current revision prioritizes stable scanning over reclaiming this small slot.
- Drop the button and return to a right-click-only menu — strongest case is the quietest possible row with no hover state and no negative margin. The driver that rules it out is discoverability: [the row-actions note](./workspace-row-actions-menu.md) records that the button exists because run configuration and grouping were unreachable for readers who never right-click, and a hover-revealed button still beats a gesture with no on-screen cue.
- Reveal only on the row's right edge rather than anywhere on the row — strongest case is that the control appears exactly where the pointer must travel to reach it, so the slide starts later and disturbs the reading position less. The driver that rules it out is that a hover zone narrower than the row has no visible boundary, so the glyph appears to arrive from nowhere for a pointer crossing the row's middle, and the badge slides under the pointer with no cue for why.
- Do nothing / reuse — staying put keeps the persistent button described in [the row-actions note](./workspace-row-actions-menu.md). The cost is a permanent control for an occasional action on every row, and a status badge that never reaches the panel edge.

## Consequences

- **Gains**: hover and keyboard reveal actions without shifting project names or the menu anchor. Counts now belong to worktree rows; project rows contain no count badge.
- **Costs and limits**: each project permanently reserves a 24px action slot plus its gap. The control remains quiet until hover/focus, so the blank slot trades some name space for stability. `Shift+F10` on the project row remains available. Revisit if long project names become more costly than hover movement.
