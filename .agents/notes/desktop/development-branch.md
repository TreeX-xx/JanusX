---
{
  "schema": "harness-note/2",
  "id": "a91d7003-a6f4-4dd8-9975-e587c1b0f26f",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-09-20",
  "class": "process",
  "tags": ["git","ci"],
  "updated": "2026-10-30T12:21:00Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/3a4dc304-70dd-49e4-b46a-ee2fc0fbc83e"
}
---

# Develop changes on a persistent integration branch

## Problem

A repair branch that accumulates unrelated feature work hides its purpose and delays integration. Development needs a predictable destination while the stable branch retains validation and review requirements.

## Decision

`dev` holds bounded batches of development; `main` holds integrated changes. Contributors branch from the current upstream dev and submit feature PRs into dev, normally using squash merge. At the maintainer's explicit request on October 30, the Windows verification workflow runs only on manual request; neither PRs nor branch pushes start remote verification. Maintainers promote dev into main after documented local verification and the repository's required review conditions are satisfied. Small fixes need no preliminary Issue; larger changes require direction agreement before implementation.

Merges from the persistent development branch retain history through merge commits. Synchronizing `main` back to `dev` keeps their shared ancestry and prevents repeated squash comparisons. The [maintainer guide](../../../docs/maintainers.md) defines fast-forward synchronization and requires a merge-commit synchronization PR with conflict resolution and verification when development has advanced independently or repository rules prevent the sync push. Temporary feature branches are removed after integration; website and active worktree branches have separate lifecycles.

## Alternatives considered

- Keep only short-lived feature branches: this provides clear isolation but does not provide the requested stable destination for everyday development.
- Reuse the repair branch indefinitely / do nothing: this avoids setup but keeps misleading names and encourages unrelated changes to accumulate.
- Squash every integration: this keeps the main log compact but loses shared ancestry with a persistent development branch, increasing repeated comparisons and conflict handling.

## Consequences

Developers have one named contribution destination. Feature and promotion PRs record local verification; remote verification remains an optional manual check. This avoids automatic runner work and waiting, while making maintainers responsible for recording the tested revision, environment, commands and uncovered checks. Maintainers must synchronize after promotion and keep batches bounded. The two-stage path remains justified while integration batches receive separate acceptance; reconsider a single stable branch if that need disappears. GitHub protects `main` with mandatory PR merges, including administrators, and prohibits force pushes and branch deletion. No approval count or status check is currently required by that protection; normal engineering review and verification policy still applies. `dev` remains available for maintainer synchronization. The retired `release/v0.9.4-windows-startup` branch is removed; published tags and release assets remain intact.
