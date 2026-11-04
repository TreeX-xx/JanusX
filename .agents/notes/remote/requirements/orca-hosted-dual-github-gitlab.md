---
{
  "schema": "harness-note/2",
  "id": "672b902d-39ba-479b-9cc5-91c0d7cc55db",
  "kind": "requirement",
  "lifecycle": "draft",
  "created": "2026-09-19",
  "class": "feature",
  "extensions": {
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-09-19-agent-note-orca-hosted-github-gitlab--672b902d.md",
      "sourceHash": "391b7e272284c236d8f54306bd0a24b2d62a706d0d62342564d6cae911948bde",
      "originalBodyHash": "5cd7a46e3bd7fbcbc569619c451a2eff34358e7198d2e0150b071834798c485f",
      "category": "formal",
      "reason": "Retains the source requirement in draft lifecycle; body documents Orca hosted双适配 GitHub/GitLab 中国端方案. No age-based archival.",
      "edits": ["Removed redundant Agent Note title prefix"],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/proposed/feature/2026-09-19-orca-hosted-dual-github-gitlab.md",
        "sourceHash": "391b7e272284c236d8f54306bd0a24b2d62a706d0d62342564d6cae911948bde",
        "originalBodyHash": "5cd7a46e3bd7fbcbc569619c451a2eff34358e7198d2e0150b071834798c485f"
      }
    }
  },
  "updated": "2026-11-03T17:06:50.881Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/b653bb34-279f-45db-92d1-313d1c6bcdf5"
}
---

# GitHub.com and GitLab.com repository collaboration

## Expected behavior

The user wants to browse repository Issues and PRs/MRs, enter development through worktrees and perform collaboration actions inside JanusX. Repository identity and public owner avatars require no login; private content and writes require platform authorization.

The selected scope is GitHub.com and GitLab.com only. GitHub reuses the desktop gh CLI; GitLab reuses glab. Existing CLI authorization is used immediately. Missing authorization opens official CLI browser sign-in from the workspace three-dot menu or the repository panel's unauthenticated state; the application shows its interactive prompts and rechecks completion; JanusX has no independent account, OAuth application or hosting credential store. Self-managed instances, including public custom hosts, and their settings are excluded.

## Proposal

Keep one worktree workflow with platform-specific Hosted providers in the main process. Renderer views consume IPC, while providers own remote queries and operation errors. The Git panel continues to own local changes, commits and Git transport.

The [repository sidebar](../../workbench/ideas/repository-sidebar.md) now provides repository-level lists, details, filtering/pagination, ordinary comments, creation/editing, close/reopen, SHA-guarded merge and Issue-to-worktree prefill. Login is directly available on workspace rows instead of the three-dot menu. Existing composer and Ship operations remain usable. Multi-remote selection, review threads, approvals and conversation handoff remain future scope.

Provider capabilities must reflect implemented operations and actual permissions. Project access failures must be distinguished from empty lists. Checks and logs for future repository details must bind to the selected review and commit. A successful connection check alone does not prove merge permission.

The current [GitHub Provider](../hosted-github-reviews.md) and [GitLab Provider](../gitlab-provider-reviews.md) own implementation details and limits. Custom-instance credentials, private CA settings and multiple-instance setup are removed from the roadmap.

## Alternatives considered

- Only GitHub would reduce maintenance but omit the requested GitLab.com collaboration.
- Self-managed GitLab support would reach corporate deployments, but its setup and compatibility costs were explicitly excluded by the user.
- Native OAuth would remove the CLI dependency but require app registration and token lifecycle. Reusing gh/glab matches the selected simplicity goal.
- Browser-only collaboration would require less integration but would not satisfy in-app Issue/PR/MR actions and worktree handoff.

## Acceptance criteria

- [ ] AC-1: Hosted providers remain in the main process; UI capability differences are explicit.
- [ ] AC-2: A shared composer can create worktrees from GitHub Issues/PRs and GitLab Issues/MRs with the correct provider, issue/review and push-target metadata.
- [ ] AC-3: GitHub.com and GitLab.com browse/check/comment/merge workflows use the user's gh/glab authorization, with installation, authorization and network errors shown at the entry point.
- [ ] AC-4: Unsupported operations are hidden or explained using provider capabilities and project permissions; a green check is not treated as merge authorization.
- [ ] AC-5: Missing hosting credentials do not block local Git/worktree operations; the hosting settings page and self-managed instance configuration are absent.

## Risks

CLI availability and version differences require explicit errors and regression coverage. Desktop reachability remains necessary even when a remote workspace can access the service. Authenticated API failures must remain visible rather than being misreported as empty repositories. Repository paging and head-commit checks are implemented with documented service limits. Permission-aware affordances, richer worktree/context handoff and real-account acceptance remain obligations of the broader collaboration feature.
