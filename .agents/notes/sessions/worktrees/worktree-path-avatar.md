---
{
  "schema": "harness-note/2",
  "id": "62676495-9b5f-4ec1-9460-f4d8f726f676",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-09-21",
  "class": "bug-fix",
  "relations": [
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/c23ebb35-2d89-4c56-8dee-03bb7e277a22"}
  ],
  "extensions": {
    "r5Migration": {
      "sourceHash": "8e88e74f6114ab6ff05bcf6b61b1feb2139e44a44949ce31554ff912e790bec2",
      "repairs": ["relations[0].reason"],
      "originalRelations": [
        {
          "type": "related-to",
          "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/c23ebb35-2d89-4c56-8dee-03bb7e277a22",
          "reason": "Duplicate main rows and avatar restyle"
        }
      ]
    },
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-09-21-agent-note-worktree-path-normalization-and-hover-avatar--62676495.md",
      "sourceHash": "f39ab4c93163f82fdee9aa6c6d776f7fd39c198e3319cdd617d7f8b5782a7c20",
      "originalBodyHash": "b97714215d1641b9773ed0b6047fff18e7ace100caa5e1700e1ae7cfaa3578f1",
      "category": "formal",
      "reason": "Retains the source decision in implemented lifecycle; body documents Worktree path normalization and hover avatar. No age-based archival.",
      "edits": ["Removed redundant Agent Note title prefix"],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/implemented/bug-fix/2026-09-21-worktree-path-avatar.md",
        "sourceHash": "f39ab4c93163f82fdee9aa6c6d776f7fd39c198e3319cdd617d7f8b5782a7c20",
        "originalBodyHash": "b97714215d1641b9773ed0b6047fff18e7ace100caa5e1700e1ae7cfaa3578f1"
      }
    }
  },
  "updated": "2026-11-24T15:33:40Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/35d88be6-50e5-466b-9514-9ecd7ac8ba7e"
}
---

# Worktree path normalization and workspace icons

## Problem

Every workspace listed its main checkout twice. Git prints worktree paths with forward slashes while the workspace registry keeps native separators, so the main-row filter compared two spellings of the same directory and never matched. Separately, always-on repo avatars crowded multi-workspace sidebars with boxed images that competed against the file tree.

## Decision

All worktree path comparisons go through a normalized form that resolves separators, symlinks, and subst drives with case folding on Windows, with linked entries rewritten to native paths once at listing time so renderer keys, active-path checks, and metadata lookups share one spelling. A real-git regression test locks the lone-checkout count. The workspace folder reflects child-list expansion. Hover and focus leave the current open or closed glyph in place. The collapsed rail shows workspace initials.

## Alternatives considered

- Normalize inside the parser — strongest case is one fixed point. The driver that rules it out is layering: parsing stays byte-faithful for diagnostics while comparison owns filesystem semantics.
- Avatar toggle in settings — strongest case is explicit user control. The driver that rules it out is default quality: workspace rows use the open and closed forms of the same folder icon.
- Do nothing / reuse — keep duplicated mains and permanent avatars. The cost is a phantom row per workspace and a noisy rail.

## Consequences

- **Gains**: lone checkouts list exactly once with native paths end to end; workspace folder icons stay stable during navigation. Unit coverage spans normalization, lone and linked listings, plus typecheck and touched-file lint.
- **Costs and limits**: case folding assumes case-insensitive filesystems on Windows only; exotic mount behavior still falls back to raw comparison. Built-app Electron acceptance was not exercised here.
