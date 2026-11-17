---
{
  "schema": "harness-note/2",
  "id": "636764b9-0105-4944-91f7-72fcbd3c4869",
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
      "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/91dac1f7-1814-400f-802e-5229ff6b0228"
    }
  ],
  "extensions": {
    "r5Migration": {
      "sourceHash": "ceac71d615c28b385e2a71d536530c547a2856d463d5d798e47b991f55f7456c",
      "repairs": [
        "relations[0].reason"
      ],
      "originalRelations": [
        {
          "type": "related-to",
          "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/c23ebb35-2d89-4c56-8dee-03bb7e277a22",
          "reason": "Worktree creation and deletion for the session requirement"
        }
      ]
    },
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-09-21-agent-note-worktree-creation-and-deletion-with-scoped-terminals--636764b9.md",
      "sourceHash": "e182455d9ad87ef3cfc401d9653463528f9a730350c1bf17b2e5e191b08c186e",
      "originalBodyHash": "9163ba40cdc80bf425ed50c0ee735d22528bb9b96175c47fcf2f140f2243de1d",
      "category": "formal",
      "reason": "Retains the source decision in implemented lifecycle; body documents Worktree creation and deletion with scoped terminals. No age-based archival.",
      "edits": [
        "Removed redundant Agent Note title prefix"
      ],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/implemented/feature/2026-09-21-worktree-create-delete.md",
        "sourceHash": "e182455d9ad87ef3cfc401d9653463528f9a730350c1bf17b2e5e191b08c186e",
        "originalBodyHash": "9163ba40cdc80bf425ed50c0ee735d22528bb9b96175c47fcf2f140f2243de1d"
      }
    }
  },
  "updated": "2026-11-05T17:44:35.000Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/35d88be6-50e5-466b-9514-9ecd7ac8ba7e"
}
---

# Worktree create, delete and Ship merge

## Problem
Worktree rows could only display checkouts created elsewhere by hand, so the isolation model had no entry point inside JanusX. New terminals always opened in the workspace root, which kept every agent on the main checkout even after switching rows. Deleting a worktree meant dropping to a shell, with no guard for the main checkout, no branch review, and sessions left pointing at removed paths.

### Local Ship merge flow for worktrees
A finished worktree had no delivery path inside JanusX: reviewing meant shelling out, committing leftovers meant switching tools, merging into the base meant hand-typed git, and the worktree stayed behind afterwards with its sessions detached from any outcome. Without an explicit Ship step, parallel work could never land through the same surface that created it.


## Decision
`src/main/git/worktrees.ts` creates linked worktrees on new branches from a verified start point into a collision-proof sibling directory, then shares dependencies best-effort: `node_modules` arrives as a link and `.env` files as owned copies, with every step reported rather than failing creation. Creation runs cancellable in the background through a tracked child process with prune plus partial-directory cleanup on cancel. Removal refuses the main checkout, deletes disk plus branch by default, keeps branches git will not drop for explicit review, never deletes the main checkout's own branch, and archives the removed path's sessions. Dirty and locked states surface through a dedicated status query instead of failing silently.

The composer closes at submit while progress, cancel, and retry live on the sidebar row, and the submitting workspace expands automatically so the row is visible. New terminals open in the active worktree directory through an optional launch override; retry keeps the recorded directory. The workspace context menu carries the single creation entry, and worktree rows carry a hover delete entry with a confirm dialog covering dirty warnings and force deletion. Preserved branches render inline with two-step deletion that escalates to force only after a clean delete fails.

### SuperAgent controlled modes (2026-11-06)

Optional `isolated` creation pins the approved commit, branch and exact path without dependency sharing or configuration copying. Optional `worktree-only` removal refuses dirty or active Git states and preserves the branch without force or implicit prune. These modes leave the manual defaults above unchanged; real Git regression tests cover both paths. SuperAgent environment ownership, approval persistence, execution leases and its controlled merge live in the [Agent environment decision](../../agent/superagent-environments.md), not the manual sidebar flow.

### Local Ship merge flow for worktrees
`WorktreeShipDialog` runs the local Ship in one place: branch diff against the base with per-file counts, commit box for worktree leftovers through the existing stage and commit channels, merge into the base with optional push, and delete-and-archive to finish. Creation records the start point per worktree path in `worktree-meta.ts`, so the base resolves without asking twice; external checkouts fall back to an editable `origin/main`. The merge refuses dirty main checkouts and self merges, returns conflicts as an explicit list with abort instead of merging silently, and reports up-to-date reruns as no-ops. Push failures never roll back a completed merge. The worktree row carries the Ship entry beside delete, gated to branched non-main checkouts, and the dialog closes the loop by reusing the delete flow that archives sessions.



## Alternatives considered
- Foreground modal creation with a spinner — strongest case is fewer moving parts and no cancellation bookkeeping. The driver that rules it out is the accepted proposal semantics: creation closes at once with sidebar progress, cancel, and retry, and a modal lock contradicts it.
- Auto-merge or auto-delete branches on worktree removal — strongest case is one-click cleanup with no review list. The driver that rules it out is silent loss: unmerged commits and protected names belong to explicit review, so the disk goes and the branch waits.
- Full dependency reinstall per worktree — strongest case is perfect isolation with no link quirks. The driver that rules it out is cost: links plus literal secret copies cover the common case, and a missing link only costs an install.
- Do nothing / reuse — keep read-only external rows with terminals pinned to the root. The cost is an isolation model without an entry point and agents that cannot reach task checkouts.

### Local Ship merge flow for worktrees
- Hosted reviews in this slice — strongest case is one complete Ship with PR creation and checks. The driver that rules it out is the missing provider phase: GitHub and self-hosted GitLab need the `HostedProvider` abstraction first, and the local flow stands alone without it.
- Auto-push without a checkbox — strongest case is fewer clicks on the happy path. The driver that rules it out is remote gravity: pushing the base branch deserves an explicit visible default, so the checkbox stays checked but removable.
- Auto-commit leftovers with a generated message — strongest case is skipping the commit box entirely. The driver that rules it out is authorship: the message belongs to the user, and the box blocks merging until dirt is committed.
- Do nothing / reuse — keep terminal-only merging with no review surface. The cost is a creation flow with no delivery and sessions that outlive their purpose.


## Consequences
- **Gains**: worktrees create, cancel, retry, and delete from the sidebar with scoped terminals and archived sessions. Real-git integration checks cover slug, collision, shared deps, merged and unmerged removal, branch review, dirtiness, and the main-checkout guard; the IPC contract suite covers the new channels; project typecheck, touched-file lint, and bilingual key checks pass.
- **Costs and limits**: cancellation kills the git child and prunes, but a mid-checkout kill can still leave admin entries for the next prune; preserved branches live in memory and reset on restart; branch names accept whatever git accepts with errors surfacing at submit. Ship merge, quit-flush restore, and the turn-change island stay scheduled follow-ups. Built-app Electron acceptance was not exercised here.

### Local Ship merge flow for worktrees
- **Gains**: worktrees review, commit, merge, push, and delete from the sidebar with conflicts and aborts handled explicitly. Real-git integration checks cover branch diffs, clean merges, up-to-date reruns, conflict lists with abort recovery, dirty-main refusal, and the self-merge guard; project typecheck, touched-file lint, and bilingual key checks pass.
- **Costs and limits**: hosted review creation, checks, auto-merge, and failure handoff wait for the provider phase; merge strategy is fixed to `--no-ff` with no rebase or squash option yet; push assumes the base tracks a reachable remote. Quit-flush restore and the turn-change island stay scheduled follow-ups. Built-app Electron acceptance was not exercised here.
