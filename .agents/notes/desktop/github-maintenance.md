---
{
  "schema": "harness-note/2",
  "id": "a568cc88-94af-5ffe-af61-7b60f787cd43",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-09-17",
  "class": "process",
  "extensions": {
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-09-17-agent-note-github--a568cc88.md",
      "sourceHash": "292d9fb1c1e1939d004872938b1f3af0ca14bedd88781ffc3647ebec0a62b364",
      "originalBodyHash": "33f6e4ec05c1c8d98b48b3dcf5d57ccc3131d5b4a2f069f0813985c73ae92bd0",
      "category": "formal",
      "reason": "Retains the source decision in implemented lifecycle; body documents GitHub 维护标准. No age-based archival.",
      "edits": [
        "Rebased Markdown destination: ../../../../CONTRIBUTING.md -> ../../CONTRIBUTING.md",
        "Removed redundant Agent Note title prefix",
        "Removed lifecycle duplicated by frontmatter"
      ],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/implemented/process/2026-09-17-github-maintenance.md",
        "sourceHash": "292d9fb1c1e1939d004872938b1f3af0ca14bedd88781ffc3647ebec0a62b364",
        "originalBodyHash": "33f6e4ec05c1c8d98b48b3dcf5d57ccc3131d5b4a2f069f0813985c73ae92bd0"
      }
    }
  },
  "updated": "2026-10-27T16:06:18Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/3a4dc304-70dd-49e4-b46a-ee2fc0fbc83e"
}
---
# GitHub 维护标准


## Problem

JanusX heads for a beta cycle and a v1.0 launch with no written GitHub discipline. Tags use a legacy uppercase `V` prefix the release workflow never matches, so twelve pushed tags produce zero Releases. Branch pushes, CI gates, and issue triage all run on unwritten convention, which strands the next agent without a source of truth.

## Decision

Contributors create short-lived branches from `develop` and submit PRs to `develop`; maintainers promote bounded batches to `main` with merge commits. Both destinations receive Windows PR verification before merge. The policy requires a green check and a non-author approval; GitHub rulesets must be configured separately. Authors cannot approve their own PRs. A maintainer may explicitly authorize an exceptional merge for an emergency, infrastructure failure or unavailable reviewer, recording verification, remaining risk and follow-up in the PR; Agent execution does not imply bypass authority.

Tags use lowercase `v`, exactly matching the package version; old uppercase tags remain unchanged. Tag pushes do not trigger builds or publication. Windows releases use local validated artifacts: staging uploads into a resumable draft, and a separate command compares all four remote files before publication. Prerelease versions retain their channel, and drafts do not enter the update feed. The manual Windows workflow only uploads Actions build artifacts. The normal path uses a version PR before tagging the merged main commit. The existing tag helper creates a version commit directly on main; its push mode requires a documented maintainer release exception and compatible repository rules.

Bug, feature and question/documentation forms cover both stable and beta versions; maintainers apply beta labels without asking users to choose an overlapping intake form. Small fixes need no preliminary Issue, and Notes are required only when the change affects lasting recorded facts. Feature proposals focus on scenarios and outcomes rather than requiring a technical design. Issue closure after development integration is distinguished from availability in a published version.

Operational instructions have separate owners:

- [CONTRIBUTING.md](../../../CONTRIBUTING.md) — contributor intake, branches, PRs and validation expectations.
- [Development guide](../../../docs/development.md) — reproducible sibling setup and troubleshooting.
- [Maintainer guide](../../../docs/maintainers.md) — review policy, promotion, release and recovery.

Workflow dependency sources use explicit upstream repositories so Fork verification does not require copies of sibling repositories. Their revisions remain pinned, sibling builds stop on failure and follow dependency order, and the split CI steps include theme and packaging-exclusion checks from the local verify chain.

## Alternatives considered

- Keep pushing `main` directly — strongest case is zero workflow friction for a solo maintainer, but every change then lands without a review trace or a guaranteed green gate, and agents inherit no enforceable handoff.
- Use only feature branches into main — this reduces merge overhead, but loses the existing requested integration destination. Retain develop with explicit contribution and promotion paths; reconsider if batched acceptance no longer serves a purpose.
- Manual-only web uploads — strongest case is full release control, but manual attachment selection can omit or mix update files. Local staging now validates the same four Windows artifacts and their update manifest before uploading a resumable draft; publication remains separate.
- Do nothing / reuse — staying put costs nothing today, but the uppercase-tag mismatch keeps silently producing tags that never release, which is the observed failure.

## Consequences

- **Gains**: contributors can identify the target branch, prepare the same inputs as CI and report problems without understanding maintainer tooling. Review and release duties have separate entry points, and local/CI verification cover the same check chain.
- **Costs and limits**: full Windows verification runs on feature and promotion PRs, with a manual recovery entry; branch pushes no longer duplicate these runs. Branch protection and availability of an independent reviewer remain external administrative concerns; this change does not configure or verify live GitHub settings. If develop no longer supports meaningful batched acceptance, simplify the branch model. New checks added to package.json still require updating the split workflow.
