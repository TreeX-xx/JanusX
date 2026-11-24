---
{
  "schema": "harness-note/2",
  "id": "bda5aa81-dc65-4408-9544-60fdfdf8c836",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-09-21",
  "class": "feature",
  "relations": [
    {
      "type": "related-to",
      "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/c23ebb35-2d89-4c56-8dee-03bb7e277a22"
    },
    {
      "type": "related-to",
      "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/636764b9-0105-4944-91f7-72fcbd3c4869"
    }
  ],
  "extensions": {
    "r5Migration": {
      "sourceHash": "361b01930cf98b6686e53875a0a5cba77f73b049a9a65d74000b6598773e8880",
      "repairs": [
        "relations[0].reason"
      ],
      "originalRelations": [
        {
          "type": "related-to",
          "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/c23ebb35-2d89-4c56-8dee-03bb7e277a22",
          "reason": "Worktree sidebar rows, right-side rescoping, and repo avatars for the session requirement"
        }
      ]
    },
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-09-21-agent-note-worktree-sidebar-rows-with-scoped-surfaces-and-repo-avatars--bda5aa81.md",
      "sourceHash": "393520f9c1d0c220e365defc131726a94eadf937a46a850664cb8c495b205e7f",
      "originalBodyHash": "4e7665ce188130447818a4c85875b00dee43c11bbd9a7c630fa2566b08ab9841",
      "category": "formal",
      "reason": "Retains the source decision in implemented lifecycle; body documents Worktree sidebar rows with scoped surfaces and repo avatars. No age-based archival.",
      "edits": [
        "Removed redundant Agent Note title prefix"
      ],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/implemented/feature/2026-09-21-worktree-sidebar-scoping.md",
        "sourceHash": "393520f9c1d0c220e365defc131726a94eadf937a46a850664cb8c495b205e7f",
        "originalBodyHash": "4e7665ce188130447818a4c85875b00dee43c11bbd9a7c630fa2566b08ab9841"
      }
    }
  },
  "updated": "2026-11-24T15:03:06.844Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/35d88be6-50e5-466b-9514-9ecd7ac8ba7e"
}
---

# Worktree sidebar and file tree scoping

## Problem
The sidebar listed workspaces as flat rows with no notion of worktrees, so linked checkouts created by plain `git worktree add` stayed invisible and every review surface stayed pinned to the workspace root. Repository identity came from nothing: project rows showed a generic folder even when the checkout resolved to a recognizable hosted project. Switching context meant switching workspaces, and returning never restored what the right side had shown.

### Worktree switch rescopes the file tree with a sweep
The sidebar worktree rows switch only `activePaths` in the worktree store, while `FileExplorerTool` derives its root from `Workspace.path`. The tree therefore keeps showing the previous checkout after a switch, and per-worktree file differences never appear. Mutations, search loading, VS Code reveal, and the file watcher all resolve against the workspace root as well, so operating the tree while a linked worktree is active touches the wrong checkout. Session cards and terminal creation already follow the active worktree path; the file tree is the outlier.


## Decision
`src/main/git/worktrees.ts` derives worktrees offline: the workspace root is always the main entry, and `git worktree list --porcelain` contributes linked checkouts with branch, detached, locked, and prunable flags. Bare entries and non-git checkouts resolve to the main row alone, and every git failure degrades to it without surfacing. Remote parsing covers https, ssh, and scp-like forms into host, owner, and repo with an upstream fork hint, all without network access.

The workspace list reads repository identity for its hosted-repository menu. It does not fetch owner images.

The sidebar renders worktrees under expanded workspaces with branch icons and branch-first labels, including a single main checkout. The 2026-10-15 revision moves paths to tooltips and removes the repeated branch line; terminal grouping and direct navigation are owned by [terminal hierarchy](../../terminal/terminal-sidebar-states.md). Rows switch the active worktree path per workspace, and session cards, checkpoints, and diffs re-scope to that path on every switch. Expanded session and checkpoint selections persist per path and restore on return. Every expanded workspace row uses a fixed 14px folder glyph, including on hover and selection.

### Worktree switch rescopes the file tree with a sweep
`src/renderer/src/features/workspace/actions.ts` owns the effective root: `getActiveScopePath` returns the active worktree path when set and falls back to the workspace root, and `getScopePathForWorkspace` resolves the same mapping for a workspace that is not yet active. `switchActiveWorktree` guards same-path clicks, sets the active path, then runs `refreshScopeFileTree`, which clears the selection, invalidates the editor cache for the scope, fetches git status for the scope, and reloads through the single `loadWorkspaceFileTree` entry with `visualTransition`, so every switch plays the existing loading-to-revealing sweep. Creation, retry, deletion, and post-ship deletion refresh the resulting scope through the same helper and only when the affected workspace is active; deleting a non-active worktree issues no reload.

`FileExplorerTool` binds to the scope path instead of the workspace root for display, directory loading keys, search backfill, mutations, editor handoff, and the scan overlay key, and it resets expansion, loading keys, search, and scroll on scope change. Workspace switching loads the target scope rather than the root, so returning to a workspace restores its worktree view. The bootstrap watcher subscribes to both stores, fetches status per scope, and filters file events by scope equality, which keeps the pending-reveal race guarantee intact because commits still flow through the same generation guard.



## Alternatives considered
- Full worktree creation and deletion in this slice — strongest case is one complete worktree feature instead of two landings. The driver that rules it out is review size: creation needs branch naming, dependency sharing, and delete-with-preserved-branches semantics that each deserve their own acceptance, while rows plus rescoping are independently reviewable against real external worktrees.
- Direct remote image URLs in the renderer — strongest case is zero main-process code for avatars. The driver that rules it out is offline behavior and request storms: the disk cache serves every row render without network, and stale bytes beat letter fallback when offline.
- GitLab avatar support now — strongest case is parity for self-hosted teams. The driver that rules it out is authentication: GitLab exposes no unauthenticated owner image path, so support waits for the per-host credential phase.
- Do nothing / reuse — keep flat workspace rows pinned to the root with folder glyphs. The cost is invisible linked checkouts, unscoped review surfaces, and recognizability left on the table.

### Worktree switch rescopes the file tree with a sweep
- Switch-only reload that keeps the tree root on `Workspace.path` — strongest case is the smallest diff for the reported symptom. The driver that rules it out is correctness: the tree would reload the wrong directory and every mutation would still target the root checkout.
- Auto-load on scope change inside `FileExplorerTool` — strongest case is one subscriber covering switch, create, and delete without touching callers. The driver that rules it out is double loading: workspace switching already loads explicitly from the sidebar, and two loaders racing on the same generation counter wastes IPC and risks reveal flicker.
- Debounced silent reload without the sweep — strongest case is fewer visual interruptions. The driver that rules it out is the request itself: scope changes swap the entire visible tree, and the sweep is the established signal that the swap completed.
- Do nothing / reuse — keep the tree pinned to the workspace root. The cost is stale trees on every switch, file operations landing in the wrong checkout, and watcher refreshes filtered against the wrong path.


## Consequences
- **Gains**: linked worktrees appear, switch, and rescope both review surfaces with restored selections. Worktree git parsing plus avatar cache carry 17 unit checks; the IPC contract suite covers the new channels; project typecheck, touched-file lint, and bilingual key checks pass.
- **Costs and limits**: worktree enumeration shells out to git per expansion with no caching yet; active paths live in memory and reset on restart. Worktree creation, Ship merge, quit-flush restore, and the turn-change island stay scheduled follow-ups. Built-app Electron acceptance was not exercised here.

### Worktree switch rescopes the file tree with a sweep
- **Gains**: switching, creating, retrying, deleting, and shipping worktrees rescope the tree, git status, editor cache, and watcher to the same path session cards and terminals already use, each with one complete sweep.
- **Costs and limits**: scope helpers add one worktree-store read per guard; `getActiveWorkspacePath` stays exported with no in-tree callers for compatibility. Active paths remain in-memory and reset on restart, so the scope falls back to the root after relaunch. File operations in a worktree resolve within that checkout and never reach the workspace root.
- **Verification**: `npx tsc --noEmit` passes; `npx eslint` on the five touched renderer files reports no errors; `npx vitest run` over the file-tree, workspace-sidebar, workspace-pane, and worktree suites passes (9 files, 99 tests). Built-app Electron acceptance was not exercised here.
