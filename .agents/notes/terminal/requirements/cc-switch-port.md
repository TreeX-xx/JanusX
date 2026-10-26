---
{
  "schema": "harness-note/2",
  "id": "33cccd84-ffbf-4a67-aa3a-3380c842af04",
  "kind": "requirement",
  "lifecycle": "draft",
  "created": "2026-09-17",
  "class": "feature",
  "extensions": {
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-09-17-agent-note-port-cc-switch-terminal-detection-install-and-llm-config-mech--33cccd84.md",
      "sourceHash": "bc71b913fe7025e73611fd9f12453bec008b5547212db1df0f7a0195ab5f5a98",
      "originalBodyHash": "f564e5f11a5bd90fb34f3226cea4110d6ddc3e5c10bb55176502bebb30aec435",
      "category": "formal",
      "reason": "Retains the source requirement in draft lifecycle; body documents Port cc-switch terminal detection, install, and LLM config mechanisms. No age-based archival.",
      "edits": ["Removed redundant Agent Note title prefix"],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/proposed/feature/2026-09-17-cc-switch-port.md",
        "sourceHash": "bc71b913fe7025e73611fd9f12453bec008b5547212db1df0f7a0195ab5f5a98",
        "originalBodyHash": "f564e5f11a5bd90fb34f3226cea4110d6ddc3e5c10bb55176502bebb30aec435"
      }
    }
  },
  "updated": "2026-10-24T10:01:54Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/bdd26e4e-8207-4c1f-8ea3-21f450ee7570"
}
---

# Port cc-switch terminal detection, install, and LLM config mechanisms

## Expected behavior

JanusX manages its own LLM settings in a closed loop (`llm-config.json` feeds the internal chat) and never writes provider credentials back to the external CLIs it shells out to. Switching a provider today means hand-editing `~/.claude/settings.json`, `~/.codex/config.toml`, or `~/.gemini/settings.json` by hand, with no version visibility and no safety net. The existing external-write path (`src/main/notifications/agent-hook-config.ts`) is non-atomic, has no serial queue, and keeps no backup, so concurrent switches can drop unrelated fields such as `hooks`. The existing existence check (`checkCommandExists` in `src/main/terminal/presets.ts`) reports presence only, never a version, and `registeredCLIs` in `src/main/config/service.ts` is a static registry with no runtime probing. The cost of staying put is repeated manual provider edits plus a latent config-corruption risk every time two writers touch an external settings file.

## Proposal

Port three distilled mechanisms from `farion1231/cc-switch` (verified against a 2026-09-17 depth-1 clone; upstream paths below refer to that tree), reimplemented against JanusX contracts in a new `src/main/cc-switch/` domain. Phase 1 covers Claude Code only; Codex, Gemini CLI, and OpenCode follow once the single-app loop is green. Borrow means product mechanisms reimplemented against JanusX contracts; no Tauri/Rust code moves across the stack boundary.

The version-detection mechanism centers on a three-state probe. Upstream models every probe as `Found` / `FoundButFailed` / `NotFound` (`src-tauri/src/commands/misc.rs`, `ShellProbe`) and surfaces a boolean `installed_but_broken` so the UI distinguishes "not installed" from "installed but not runnable" without matching error strings. Detection runs in two phases: probe the default `PATH` first so the display always equals what the user actually runs, and fall back to directory scanning only on `NotFound`; a broken default never falls back, so a stale shim cannot mask a broken install. The effective `PATH` is reconstructed rather than inherited: on Windows from process `PATH` plus `HKCU`/`HKLM` registry sources with `%VAR%` expansion (`effective_path_string`), on POSIX from the login shell, and the same reconstructed `PATH` feeds both detection and later execution. Scan and full enumeration share one search-path builder (`build_tool_search_paths`), so the single-probe view and the conflict-diagnosis view never observe different worlds. Version strings are reduced with one regex (`extract_version`, first `\d+\.\d+\.\d+` match), and latest-version fetching stays off the critical path: npm `dist-tags` light endpoint first (never the multi-megabyte packument), GitHub release and PyPI as fallbacks, each under its own short timeout, with calendar-version and dirty-tag filtering plus a symmetric semver comparator on both ends so only strictly-greater `latest` raises an update badge. The frontend keeps a module-level ten-minute cache with per-tool concurrent refresh and no polling (`src/components/settings/AboutSection.tsx`).

JanusX lands this as `src/main/cc-switch/tool-registry.ts` plus `src/main/cc-switch/claude-detector.ts`. The registry collapses the upstream trio of small tables into one declaration per tool (`displayName`, `npmPkg`, `installerUrl`, `updateArgs`, `latestStrategy`). The detector follows the dependency-injected shape of `src/main/office/officecli-manager.ts` (`PATH` to known locations to managed root, `--version` under `execa` with timeout, regex parse) and must preserve two invariants: display equals actual run (default `PATH` first), and the detector never bare-invokes a tool name on Windows, only a located real file, so Store aliases and project-local shims cannot hijack a probe.

The install mechanism generates the command in three layers. A fresh install with no anchor uses the static installer-or-npm chain; an upgrade reuses the anchor, meaning the package manager sibling found next to the running binary, invoked by absolute path with its interpreter directory prepended to `PATH`; only an unlocatable anchor falls back to the static command, and then the UI must render the honest `anchored=false` copy. Upstream deliberately excludes Codex from official self-update (its `update` can exit zero while masking a missing binary) and routes broken Codex installs through `uninstall || install` self-healing (`codex_repair_command`). Execution is silent in both shells: POSIX through `bash -c` with `set -e`/`pipefail` plus login-`PATH` injection, Windows through a temp `.bat` with `CREATE_NO_WINDOW`, and failure surfaces only the last lines of stderr. The UI orchestration is probe (read-only distribution map), confirm (a dialog listing every location with its default marker and the exact command, shown only when two or more locations exist), serial execute, re-probe, then graded failure: unchanged-version and not-runnable outcomes are soft warnings with automatic conflict re-diagnosis, hard failures are errors, and a global busy guard forbids concurrent `npm i -g` writes.

JanusX lands this as `src/main/cc-switch/installer.ts`, using a descriptor-driven download-verify-commit flow where a managed binary fits, and plain npm-lifecycle commands otherwise; the former language-service installer has been removed and is not a reusable dependency. Every switch path shares one `SerialQueue` from `src/main/lib/atomic-file.ts`. The rollout order is fixed: read-only detection panel first, then dry-run apply behind a flag, then the full lifecycle with the confirm dialog and busy guard.

The LLM-configuration mechanism is a store-plus-projector split. Upstream keeps SQLite as the single source of truth (`providers` table, per-app heterogeneous `settings_config`, `meta` column that never reaches disk) and treats each app's on-disk file as a live projection written by a per-app projector implementing paths, read, merge, write, and validate (`src-tauri/src/provider.rs`, `src-tauri/src/database/schema.rs`, per-app files under `src-tauri/src/` such as `codex_config.rs`, `gemini_config.rs`, `grok_config.rs`, `opencode_config.rs`, `openclaw_config.rs`, `hermes_config.rs`, `pi_config/`, `mcode_config.rs`). Presets (`src/config/*ProviderPresets.ts`, one file per app) seed only new cards; stock cards keep their creation snapshot. The effective write equals stored settings plus the shared snippet plus injected defaults, and an inverse strip function recovers the stored form for backfill. Every write is atomic (same-directory unique temp file plus rename, `0600` for credentials) with a restorable backup and, for the raciest targets, an optimistic revision lock or a snapshot-and-rollback pair. Switching forks on takeover state: proxy-takeover switches only reroute without touching disk, normal switches backfill, snapshot, set current, write live, then re-project MCP and skills, which live in independent tables with a per-app enable matrix and are never stored inside the provider row. No switch kills a process; affected surfaces show a restart notice instead.

JanusX lands this as `src/main/cc-switch/profile-store.ts` (a `userData/janusx/cc-switch-profiles.json` document modeled on `src/main/llm/ConfigStore.ts`, persisted through `SerialQueue` plus `writeFileAtomic` plus corrupt-file backup), `src/main/cc-switch/settings-applier.ts` (read with BOM tolerance, snapshot `settings.json.bak-<timestamp>`, replace only the owned keys `env.ANTHROPIC_BASE_URL`, `env.ANTHROPIC_AUTH_TOKEN`, `env.ANTHROPIC_MODEL` plus top-level `model`, preserve `hooks`, `permissions`, and every unknown field byte-wise, write through `writeFileAtomic`), and `src/main/cc-switch/service.ts` as the facade owning list, activate, add, update, remove, and rollback. The IPC chain follows the house pattern (`src/shared/ipc/cc-switch.ts` to `src/main/ipc/cc-switch-handlers.ts` to a `ccSwitchAPI` bridge in `src/preload/index.ts` to a renderer service, store, and panel), terminal linkage reuses `withPathPrepend` from `src/main/terminal/manager.ts` for per-profile environment injection, and the post-activate verification re-reads the live file through the existing reader in `src/main/runtime-telemetry/history.ts`. Three rules are load-bearing: only owned keys are replaced, every switch keeps a restorable backup, and presets never mutate stock profiles.

## Alternatives considered

- Adopt SQLite as the profile store for full upstream parity — strongest case is one-to-one reuse of the migration, endpoint, failover-queue, and snapshot schema, plus transactional multi-table switches. The driver that rules it out is fit: JanusX persists everything as JSON through `writeFileAtomic` plus `SerialQueue` today, and SQLite would add a native dependency plus a migration regime for a single-user profile document that the existing primitives already protect.
- Reuse the cc-switch backend directly (sidecar or ported commands) — strongest case is zero reimplementation of the hardest logic (registry-`PATH` merge, WSL probing, anchored upgrades). The driver that rules it out is the stack boundary: JanusX ships Electron with a TypeScript main process, and Tauri commands do not cross that boundary; the borrow travels as mechanism design, reimplemented against `execa`, `node-pty`, and `atomic-file.ts`.
- Extend the former language-service installer descriptors to cover CLI tools instead of a new domain — strongest case is no new module and a proven staged-install layout. The driver that keeps it as reuse rather than home is semantic distance: npm-distributed CLIs need anchor-aware lifecycle commands and live-config projection, which is a different state machine from fetching a versioned binary artifact; the language-service installer has since been removed; the CLI domain owns its lifecycle.
- Do nothing / reuse existing pieces as-is (`checkCommandExists`, static `registeredCLIs`, `agent-hook-config.ts` writes) — staying put costs nothing now and keeps every current path green. The cost is permanent manual provider editing, no version signal, and the unguarded read-modify-write race on external settings files described above.

## Acceptance criteria

- [ ] AC-1: A Claude Code detection panel reports installed version, latest version, and the broken-install state, with display matching the binary the user shell resolves.
- [ ] AC-2: Activating a profile writes only the owned keys to `~/.claude/settings.json`, preserves all other fields, leaves a timestamped restorable backup, and verifies by re-reading the live file.
- [ ] AC-3: Two concurrent activate calls cannot interleave; the second observes the first write (SerialQueue coverage with a regression test).
- [ ] AC-4: An upgrade across two installed locations shows the confirm dialog with per-location source, path, default marker, and exact command before anything executes.
- [ ] AC-5: Every borrow maps to the named JanusX file above; no mechanism floats without a landing point, and no vendor runtime dependency enters the tree through this note.

## Risks

- The live settings file may change between read and write (user hand-edit, running CLI). Mitigation: compare-and-fail on unexpected content rather than silently overwriting, and surface the backup path in the error.
- Detection-time and execution-time `PATH` can diverge after self-updates or shell-config changes. Mitigation: reconstruct the effective `PATH` once per operation and share it between probe and executor, per the upstream `effective_path_string` lesson.
- `npm i -g` concurrent writes corrupt installs. Mitigation: the global busy guard plus serial execution are part of phase 3 scope, not follow-ups.
- Scope creep toward all nine upstream tools before the single-app loop is proven. Mitigation: phase gates above; Codex, Gemini CLI, and OpenCode each need their own acceptance pass.
- License hygiene on verbatim copies. Mitigation: upstream observed MIT-licensed (re-verify at implementation time); default to clean-room reimplementation against JanusX contracts and keep any verbatim snippet attributed.

## Landing status (2026-09-18 reconcile, commit-evidence only)

- Claude detection panel: landed (`024e503` probe/install, `10b1ab5` matrix, multi-terminal series `100a962/67793ba/4c3b49d`, `64f2ae3` pi/janus).
- Claude profile write with owned-keys-only, backup, and re-read verify: landed via `4b4eb65` (supersedes `dc9525c` profile-switch, archived).
- Bindings, Anthropic type, per-terminal projectors, provider collections UI: landed (`2a701aa`, `59752d4` external-cli rename, `5e70d50`).
- Outstanding: SerialQueue concurrent-activate regression test (no test found); multi-location confirm dialog; anchored upgrades; global busy guard; `codex repair` self-heal; per-tool acceptance passes for Codex/Gemini/OpenCode (detection generalized in `117bb52`, live-projector acceptance still per-tool).
