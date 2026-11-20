---
{
  "schema": "harness-note/2",
  "id": "ec2fb5e6-6368-54e6-a3c9-762b982f24b4",
  "kind": "decision",
  "lifecycle": "proposed",
  "created": "2026-08-20",
  "class": "feature",
  "extensions": {
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-08-20-agent-note-team-identity-with-local-email-provider--ec2fb5e6.md",
      "sourceHash": "a4fcb55d336a52dfabf5fc2c6bbb8acdf78e633622e109fa531085bb64a6e37e",
      "originalBodyHash": "98f3cb63479c4e7e2c689a496548f35595b236e597ae441c47863b93c3723fa1",
      "category": "formal",
      "reason": "Retains the source decision in proposed lifecycle; body documents Team identity with local email provider. No age-based archival.",
      "edits": ["Removed redundant Agent Note title prefix","Removed lifecycle duplicated by frontmatter"],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/proposed/feature/2026-08-20-tob-identity.md",
        "sourceHash": "a4fcb55d336a52dfabf5fc2c6bbb8acdf78e633622e109fa531085bb64a6e37e",
        "originalBodyHash": "98f3cb63479c4e7e2c689a496548f35595b236e597ae441c47863b93c3723fa1"
      }
    }
  },
  "updated": "2026-11-20T12:06:46Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/b653bb34-279f-45db-92d1-313d1c6bcdf5"
}
---

# Team identity with local email provider


## Problem

The desktop already has local identities. TeamService registers users, creates and switches tenants, handles invitations and member status. The outstanding product question is how to enforce those permissions across hosts when sharing project resources.

## Decision

Ship a local email provider first with an adapter seam for the rest. Registration builds an account only; organizations come from an explicit create step, and invitation codes join accounts to organizations. One email maps to one user across many tenants with per-tenant roles (Owner, Maintainer, Contributor, Viewer); the client holds an active tenant id and authorizes every level beneath it. The login gate stays skippable so single-machine use never breaks, and team surfaces re-prompt only when touched. Add a pinned team footer with an organization switcher, a team tab in settings, and a setup gate mirroring the existing office gate. Define the `IdentityAdapter` contract now (login, user fetch, org sync, leave hook) and leave enterprise chat login plus standard-protocol providers as later implementations without remodeling.

The current local implementation is in [TeamService](../../../src/main/team/service.ts). The shared-blueprint and knowledge access checks below remain proposed. Android pairs devices separately.

## Alternatives considered

- Enterprise chat SSO first — strongest case reuses the corporate directory for identity and initial org shape. The driver that rules it out is deployment coupling: per-tenant app configs, variable directory permissions, and broken offline plus private-deploy use.
- Standards-only login — strongest case is a clean protocol boundary from day one. The driver that rules it out is the same missing interior: the internal tenant and permission model must exist first, and no customer provider waits on day one.
- Do nothing / reuse single-machine accounts — staying put avoids all account machinery. The cost is that no shared read can open safely.

## Acceptance criteria

- [ ] One organizer invites a second member who sees only authorized projects; disabling revokes shared blueprint and knowledge access immediately.
- [ ] One email joins several organizations with independent per-organization roles, and switching organizations switches data plus permission context.
- [ ] The login gate skips cleanly with all single-machine features intact; team entries re-prompt for login when touched.

## Consequences

- Invitation codes need expiry plus single use, or stale codes become a quiet backdoor.
- Directory sync later must never replace the internal mapping table; external departments are not project permissions.
