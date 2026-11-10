---
{
  "schema": "harness-note/2",
  "id": "640a69dd-bbea-4606-b51a-f9b545de37a5",
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
      "sourceHash": "d0d595ae940b31b781031ffa81ff340965b677de1f374a899ab7f3ee22f185dd",
      "repairs": [
        "relations[0].reason"
      ],
      "originalRelations": [
        {
          "type": "related-to",
          "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/c23ebb35-2d89-4c56-8dee-03bb7e277a22",
          "reason": "GitLab self-hosted provider for the session requirement"
        }
      ]
    },
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-09-21-agent-note-gitlab-self-hosted-provider-over-instance-v4-api--640a69dd.md",
      "sourceHash": "046993580530a857baa5125dbbcc39b01d9dc0bbbdf46b9659ff94700e32a0f1",
      "originalBodyHash": "5556a93fb54f368540c20c096931e5103328c0c89c178d985feed68558442d8c",
      "category": "formal",
      "reason": "Retains the source decision in implemented lifecycle; body documents GitLab self-hosted provider over instance v4 API. No age-based archival.",
      "edits": [
        "Removed redundant Agent Note title prefix"
      ],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/implemented/feature/2026-09-21-gitlab-provider-reviews.md",
        "sourceHash": "046993580530a857baa5125dbbcc39b01d9dc0bbbdf46b9659ff94700e32a0f1",
        "originalBodyHash": "5556a93fb54f368540c20c096931e5103328c0c89c178d985feed68558442d8c"
      }
    }
  },
  "updated": "2026-11-03T17:06:50.881Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/b653bb34-279f-45db-92d1-313d1c6bcdf5"
}
---

# GitLab.com reviews through glab

## Problem

Repository collaboration needs authenticated Issue/MR, pipeline, comment and merge operations. Public owner avatars do not establish API authorization. The former self-managed instance form required a URL, PAT, certificate bypass and timeout, adding configuration and credential ownership that the user no longer wants.

## Decision

Hosting supports GitHub.com and GitLab.com. GitHub reuses gh; GitLab reuses glab. Both CLIs must be installed on the desktop and available on PATH. JanusX does not register its own OAuth application, store hosting credentials, or maintain token refresh. Users with an existing CLI authorization can use collaboration immediately; otherwise the workspace three-dot menu opens an application dialog running the official CLI browser login. The right repository panel offers the same entry when unauthenticated. Missing CLI installation and retry are explained there; the existing Issue composer and Ship retain their fallback guidance.

Platform detection reads the origin remote independently of authentication. A separate hosted connection IPC checks the appropriate CLI against the public host. Missing CLI, missing authorization and other failures have distinct states. Status output is discarded; no token is requested or returned to the renderer. The shared runner pins the public host, limits execution time, hides subprocess windows and passes JSON request bodies through stdin without shell interpolation. GitHub operations explicitly select the repository; GitLab API paths explicitly encode the project, including nested groups.

The self-managed GitLab settings panel, settings navigation entry, configuration/credential store, PAT form, certificate bypass and configuration IPC are removed. No old JanusX credential is imported into glab. Existing userData files are left untouched and no longer read by Hosted; JanusX does not silently erase a user's stored files. Self-managed GitLab, including publicly reachable custom instances, is outside this scope. Git transport still uses the user's existing Git authentication.

The GitLab Provider uses glab api for branch MR lists, checks, failed traces, MR creation and merge, Issue search, MR comments and auto-merge. Draft creation prefixes the title with Draft:. Merge IPC selects the detected provider rather than always selecting GitHub; a successful merge must return a merged state. Auto-merge uses auto_merge and checks the outcome. Cancellation uses the still-supported cancel_merge_when_pipeline_succeeds endpoint and checks its status field. Both comments and auto-merge are declared capabilities.

Issue/MR request errors propagate to the UI rather than being converted to empty lists. Failed-log retrieval filters failed jobs on the server before selecting up to three traces, so newer successful jobs cannot hide a failure beyond the first page. It can retain readable logs if another job fails; when all requested traces fail, it surfaces the error. Connection checks do not prove project membership or merge permission; the requested operation remains authoritative.

## Alternatives considered

- Native browser OAuth with PKCE would remove the CLI dependency, but requires an app registration and credential lifecycle. The user selected existing CLI authorization to reduce product configuration and implementation work.
- Anonymous public reads could avoid authorization for some browsing, but the requested experience includes private content and write operations. This change keeps collaboration on the CLI path; repository identity and GitHub owner avatars remain login-free.
- Retaining custom instances would serve self-managed teams, but requires deployment, certificate, network and credential handling explicitly removed from scope.
- Dropping GitLab entirely would minimize maintenance, but loses the requested GitLab.com Issue/MR workflow.

## Consequences

The collaboration UI no longer needs a hosting settings page. CLI-managed authorization is reused, and failures offer a concrete next step without creating a JanusX account. Credentials remain with gh/glab.

The CLIs are external dependencies, not bundled or automatically installed. Users can authorize in the application's dedicated login terminal, which displays the official CLI prompts and device code; credentials remain with the CLI. Closing the dialog, destroying its window or reaching the ten-minute timeout terminates the process. Authorization is rechecked after completion. Both providers resolve remotes through the workspace runtime; CLI API requests execute on the desktop, whose network must reach the public service.

The legacy worktree Provider remains branch-oriented: MR lists cap at ten, Issue search at twenty and MR comments at fifty. Its checks use the latest branch pipeline. The implemented [repository sidebar](../workbench/ideas/repository-sidebar.md) uses the separate repository service for twenty-item pages, detail, ordinary comments, creation/editing, close/reopen and SHA-guarded merge. Its MR checks use the matching head pipeline. Full review threads, approvals and multi-remote selection remain outside this delivery.

Verification covers CLI host selection, stdin bodies, missing/expired authorization, network errors, Provider operations, merge IPC dispatch, preload contracts and connection-guidance interactions in Chromium. Tests mock authenticated CLI/API responses; they do not establish live GitLab.com writes or packaged Electron acceptance.

Validated with `npm run test:unit -- tests/unit/gitlab-provider.test.ts tests/unit/hosted-github.test.ts tests/unit/hosted-cli.test.ts tests/unit/hosted-handlers.test.ts tests/unit/remaining-ipc-contract.test.ts tests/unit/hosted-connection-ui.test.ts tests/unit/worktree-git.test.ts`: 86 tests passed in seven files, including four Chromium UI tests and forty real-Git tests. Type checking, lint on changed production files, locale synchronization and Notes validation also passed; Notes retain seventeen explicit external-link diagnostics.
