---
{
  "schema": "harness-note/2",
  "id": "97a21dee-2b5e-4cf8-8298-28263eeb02bb",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-09-21",
  "class": "feature",
  "relations": [
    {
      "type": "related-to",
      "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/c23ebb35-2d89-4c56-8dee-03bb7e277a22"
    }
  ],
  "extensions": {
    "r5Migration": {
      "sourceHash": "21e3beef9c3a5e773194188563a8ae65714c9b88f33121500cb54388743add3c",
      "repairs": [
        "relations[0].reason"
      ],
      "originalRelations": [
        {
          "type": "related-to",
          "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/c23ebb35-2d89-4c56-8dee-03bb7e277a22",
          "reason": "Hosted GitHub reviews and checks for the session requirement"
        }
      ]
    },
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-09-21-agent-note-hosted-github-reviews-and-checks-over-gh--97a21dee.md",
      "sourceHash": "95a88d2fb9bf878abe8f32fbde68f18cbecaa0003134a29a153937d63d207d8e",
      "originalBodyHash": "e8b7cd5293e2bbb783d0311a9e982c3009f3ad926b5018196440767e5ac3c642",
      "category": "formal",
      "reason": "Retains the source decision in implemented lifecycle; body documents Hosted GitHub reviews and checks over gh. No age-based archival.",
      "edits": [
        "Removed redundant Agent Note title prefix"
      ],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/implemented/feature/2026-09-21-hosted-github-reviews.md",
        "sourceHash": "95a88d2fb9bf878abe8f32fbde68f18cbecaa0003134a29a153937d63d207d8e",
        "originalBodyHash": "e8b7cd5293e2bbb783d0311a9e982c3009f3ad926b5018196440767e5ac3c642"
      }
    }
  },
  "updated": "2026-11-04T11:12:58.598Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/b653bb34-279f-45db-92d1-313d1c6bcdf5"
}
---

# Hosted GitHub reviews, issues, comments and auto-merge

## Problem

Worktree creation and Ship need the remote task, review, checks and discussion context. A repository's public owner avatar can be displayed without authorization, but private content and write operations require a platform identity. An unavailable CLI must not make collaboration silently disappear.

## Decision

The GitHub Provider supports github.com and delegates to the user's gh installation. Detection reads origin independently of authentication; the hosted connection IPC checks `gh auth status --hostname github.com --active`, so invalid credentials on inactive accounts do not block the active identity. Invalid keyring credentials require login; other failures retain their details without assuming a network cause. GitLab retains its separate glab status command. CLI authorization is never stored by JanusX. Normal repository panel/menu activation reuses successful connection status for sixty seconds. Explicit connection retry and login completion recheck authorization; repository content refresh only refreshes content. The bounded session content cache and invalidation rules are documented in the [repository sidebar](../workbench/ideas/repository-sidebar.md).

Commands select the full GitHub repository explicitly, so a desktop CLI can query a project discovered through the existing Windows, WSL or SSH workspace runtime. The workspace three-dot menu launches official CLI browser authorization in an application dialog. The right repository panel also exposes sign-in when unauthenticated; missing installation is explained and completion rechecks authorization. The Issue composer and Ship retain their fallback guidance. Ready connections show status without another login prompt. The independent hosting settings page is removed. GitLab.com follows the same ownership model through [glab](./gitlab-provider-reviews.md).

The composer searches open Issues and can prefill a task name and branch, then records the Issue reference in worktree metadata. Ship reads branch-associated reviews and checks, creates draft reviews, merges, reads/replies to comments and requests auto-merge. Merge IPC routes through the detected provider. Failed-check logs and their copyable repair prompt remain on demand.

Repository identity and public GitHub owner avatars keep their login-free path. Collaboration still requires a configured CLI identity; an anonymous public API client is not added. Query errors remain visible at the Issue/Ship entry points, and local worktree operations are not gated by hosting authorization.

## Alternatives considered

- A JanusX OAuth application would avoid a CLI prerequisite but add registration and token lifecycle responsibilities. The selected product scope prioritizes reusing existing gh/glab authorization.
- A separate hosting settings page would centralize configuration, but fixed public hosts and CLI-managed credentials leave no instance or token form to maintain. Connection guidance belongs at the collaboration entry.
- Automatic merge by default would reduce clicks but change shared branches without a per-review choice. The existing explicit action remains.
- Repository-wide collaboration now lives in the separate [repository sidebar](../workbench/ideas/repository-sidebar.md), keeping local Git and task-specific Ship responsibilities focused.

## Consequences

Existing gh authorization works without a JanusX login system. Missing CLI or authorization produces guidance instead of a hidden review section. API calls use the selected repository and do not depend on a local path for WSL/SSH checkouts.

The legacy worktree Issue search caps at twenty and branch review lists at ten without paging. The repository service adds twenty-item pages, literal repository-constrained search, details, ordinary discussion comments and writes. GitHub search caps at one thousand matches and reports truncation. Review checks use the displayed head SHA, and merge submits that SHA for server validation. Comments are rendered as plain text; full review threads, reactions and stacked reviews remain incomplete. Failed-log output is bounded to three runs and six kilobytes each. The UI auto-merge toggle is not a complete initial projection of server state; users still need fresh platform state for richer collaboration.

Parser, CLI routing, connection, merge IPC and preload tests cover the implementation. Chromium interaction tests cover connection guidance. These checks do not replace real-account GitHub/GitLab write acceptance or a packaged Electron run.
