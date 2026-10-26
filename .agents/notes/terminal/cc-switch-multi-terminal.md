---
{
  "schema": "harness-note/2",
  "id": "434babf4-fac2-5482-aeb8-3a091332ee09",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-09-17",
  "parent": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/33cccd84-ffbf-4a67-aa3a-3380c842af04",
  "class": "feature",
  "extensions": {
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-09-17-agent-note-multi-terminal-detection-with-icon-rows--434babf4.md",
      "sourceHash": "9ec2df1f6f655a05dce7676fe26a67b2700fc7378cbc9f96f751b0d5df534194",
      "originalBodyHash": "d27074f8b579e5bab77360b54b392bdc59f7348b5bfbb4235c48bf650d3a27f9",
      "category": "formal",
      "reason": "Retains the source decision in implemented lifecycle; body documents Multi-terminal detection with icon rows. No age-based archival.",
      "edits": [
        "Removed redundant Agent Note title prefix",
        "Removed lifecycle duplicated by frontmatter"
      ],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/implemented/feature/2026-09-17-cc-switch-multi-terminal.md",
        "sourceHash": "9ec2df1f6f655a05dce7676fe26a67b2700fc7378cbc9f96f751b0d5df534194",
        "originalBodyHash": "d27074f8b579e5bab77360b54b392bdc59f7348b5bfbb4235c48bf650d3a27f9"
      }
    }
  },
  "updated": "2026-10-24T10:01:54Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/bdd26e4e-8207-4c1f-8ea3-21f450ee7570"
}
---
# cc-switch 多 CLI 检测、安装、同步与生命周期

## Problem
The external-terminal surface probes exactly one tool while the workspace shells out to several: terminal presets already offer Claude Code, Codex, and OpenCode, but Settings stays blind to everything except Claude. Each new tool risks a copy-paste detector with its own mappings; meanwhile four stacked cards waste vertical space and carry no visual identity. The detector, installer, and registry must grow by declaration, not by duplication.

### Claude Code version detection and install in Settings
JanusX shells out to Claude Code but never inspects it: the only readiness signal is a boolean presence check (`checkCommandExists` in `src/main/terminal/presets.ts`), and installing or upgrading means leaving the app for a terminal. The existing external-write path (`src/main/notifications/agent-hook-config.ts`) is non-atomic and queue-free, so it cannot host a safe install flow. Without a version signal the settings surface cannot tell "not installed" from "installed but broken" from "upgrade available", and every provider switch stays a manual file edit.

### LLM-side multi-CLI matrix with sync state
Provider credentials live in the LLM engine panel, but spending them anywhere outside JanusX means retyping secrets into external files. The first sync design put a sync block on the general settings card, which mixes two responsibilities: terminal health (is Claude Code installed, is it current) and credential distribution (which provider feeds which CLI). The general card must stay a pure detection and install surface, while the question "who uses my providers" belongs where providers are edited — including JanusX itself as the first consumer.

### Pi and self-built Janus lifecycle
The terminal matrix covers third-party npm tools but not the two CLIs closest to home: Pi Agent never appears, and Janus — built from the sibling janus-agentX source and globally linked — has no update story at all. A registry that cannot express "built here, not downloaded" forces the self-owned tool into manual rebuilds while third-party tools enjoy one-click upgrades.


## Decision
The registry declares three tools (Claude Code, Codex, OpenCode — the external CLIs the workspace presets actually launch) with npm package, binary names, manual command, and native-installer leftover directories in one row each, and the shared contract carries display metadata (monogram plus brand color) so main and renderer never fork a mapping. `ClaudeDetector` becomes descriptor-driven `CliDetector`, constructed per tool id, with Windows executable variants expanded from the base name and per-tool extra directories resolved through case-insensitive `%VAR%` expansion; the installer follows the same descriptor for its npm target. The service keeps one installer and one sync chain but fans detection out through a lazily built per-tool detector map, and the IPC allowlist validates against the registry instead of a literal. Settings renders one compact row per tool in registry order inside a single card — Janus first as the in-house tool, then the externals — using the official brand SVGs from `src/renderer/src/assets/icons/` (the same assets the terminal sidebar uses) with the monogram badge as load fallback. The card fills the settings control column like its neighbors (the column is a non-stretching flex row, so the card carries its own full width). Rows paint from the local probe behind a spinner, fold the latest version in when it arrives, and manual re-detect holds its own spinner state so fast no-change probes still read as acknowledged. Credential sync stays Claude-only by explicit guard; detection, latest, and install are the generalized surface.

### Claude Code version detection and install in Settings
The settings general tab owns a Claude Code card backed by a new `src/main/cc-switch/` domain behind `CcSwitchService`. Detection probes the default `PATH` first so the display always equals the binary the user shell resolves, and falls back to known install directories (`%APPDATA%\npm`, `%LOCALAPPDATA%\Programs\claude`, `~/.local/bin`, `/usr/local/bin`, Homebrew on macOS) only on a miss; a binary that fails `--version` reports installed-but-broken with a diagnostic tail instead of being masked as missing. Windows probes and installs run through PowerShell with output encoding pinned to UTF-8 and the located absolute path single-quoted, and the detector never bare-invokes a tool name. Latest-version lookup stays off the card critical path on the npm `dist-tags` light endpoint under a 15-second timeout, and only a strictly-greater latest raises the upgrade badge via a semver comparator shared verbatim between main and renderer. The card paints from the local probe first and folds the latest version in when it arrives, so a slow registry never holds the first paint hostage. Install and upgrade share one `npm i -g @anthropic-ai/claude-code@latest` path executed silently (Windows PowerShell, POSIX direct spawn, five-minute timeout, child `PATH` augmented with the known npm directories), guarded by a synchronously-set busy flag because npm global writes must never overlap, and every install re-probes before reporting success so a zero exit code alone never claims victory. Wiring follows the house IPC chain (`src/shared/ipc/cc-switch.ts` to `src/main/ipc/cc-switch-handlers.ts` to a `ccSwitch` preload bridge to `src/renderer/src/services/cc-switch.ts`), and the card (`src/renderer/src/components/CcSwitchManager.tsx`) renders the four states with install, upgrade, and re-detect actions plus zh-CN/en copy. This serves [the cc-switch port proposal](./requirements/cc-switch-port.md), scoped to its phase 1.


### LLM-side multi-CLI matrix with sync state
The LLM engine tab owns a CLI section below the provider list. It renders one row per consumer: JanusX internal, pinned to the default provider with no action, and Claude Code, showing its last sync source and time or an unsynced state, with sync-default and rollback actions. Provider identity for the sync call travels explicitly (`applyProvider` takes a provider id, null for the default), so the panel never depends on ambient selection. Sync results persist in `userData/janusx/cc-switch-sync.json` through the house `SerialQueue` plus atomic-write pattern: the record keeps provider id, display name, endpoint, model, timestamp, and backup path, and never a secret. Rollback clears the record because the live file no longer matches it, and a record whose provider id no longer exists renders as source-deleted rather than silently passing. The general card drops its sync block and returns to detection, install, upgrade, and re-detect only. This supersedes [the card-side sync](./history/cc-switch-llm-sync.md), keeping its backup, verify, and rollback chain and moving only the entry point and the source tracking.


### Pi and self-built Janus lifecycle
The registry gains two rows with different strategies. Pi Agent is a standard npm row (`@earendil-works/pi-coding-agent`, dist-tags latest) reusing the shared probe, silent install, and badge flow untouched. Janus declares a `localLifecycle` instead of an npm package: the installer locates the sibling source through an injectable root resolver defaulting to `../janus-agentX`, verifies `packages/cli/package.json` carries `@janus-agent/cli`, reads its version as the latest signal, and updates by running `npm run build` then `npm link` in the package directory with the working directory pinned per step — any step failure stops the chain and surfaces its tail. Missing source (packaged app, moved checkout) degrades to the manual command instead of a fake install, and an unknown latest never blocks the card. The service routes latest by strategy and otherwise treats both tools like any other row; the run plumbing carries an optional working directory. Official `pi.svg` and `janus.svg` from the existing asset set back the new rows.



### OpenCode v1 and v2 updates

The shared version probe accepts both bare semantic versions and a leading `v` (OpenCode v2 prints `opencode v<major>.<minor>.<patch>`). It returns the normalized numeric version for release-line selection; nonzero exits still report broken. The former word-boundary regex rejected the v-prefixed output despite exit code zero. Regression coverage in `cli-detector.test.ts` includes v1, v2, prereleases and failed probes. On 2026-10-24, the actual Windows npm shim was probed with the corrected `CliDetector`: installed=true, runnable=true, version=2.1.4. All 135 external-cli unit tests passed; the running desktop UI was not exercised for this fix.

OpenCode maintains separate npm packages: `opencode-ai` for v1 and `@opencode/cli` for v2. The official [installation instructions](https://github.com/anomalyco/opencode/blob/dev/README.md) and both npm manifests were checked on 2026-10-24. The historical `tui-v2` tag on `opencode-ai` is a snapshot, not the current v2 release source. Package mappings live in `tool-registry.ts`; `opencode-releases.ts` queries each package's `latest` independently and accepts only stable versions belonging to the expected major. A failed query leaves that line unknown without hiding the other line.

Settings offers a same-line update plus a separate explicit upgrade-to-v2 action for v1. Existing v2 installs update only v2; new installations default to v2. The shared IPC options carry the release line and exact version displayed. Main validates both, computes the npm package itself, rejects downgrades, and requires the post-install active command to report the exact target. The legacy install call also detects the current line before choosing a target; an existing unversioned binary requires an explicit choice. There is no v2-to-v1 downgrade action because installation rollback does not establish configuration or session-format downgrade compatibility.

Both npm packages publish the `opencode` command. During migration to v2, the installer inspects the installed v1 npm version, removes that package only if present, and installs the pinned v2 version under one lock. A failed installation removes the partial target and attempts to restore the exact previous npm version, reporting recovery failure. An empty filtered `npm ls` result may exit 1 and is accepted only with valid root JSON. Unreliable package inspection stops before removal. Existing v2 updates do not remove a stale v1 package or invoke migration recovery. The service lock also covers detection, version lookup and post-install verification.

This remains an npm update path. A native installer or another npm prefix earlier on PATH can shadow the result; main reports the mismatch and active path instead of claiming success or deleting that binary. Recovery relies on npm/cache availability and is not a backup of user configuration or sessions. Revisit installer-specific routing if users need automatic migration from native installs.

Verification: `npx vitest run tests/unit/external-cli --maxWorkers=2` covers release routing, stable/prerelease boundaries, exact targets, invalid IPC input, concurrency, package migration and recovery. `npx playwright test tests/e2e/external-cli-settings.spec.ts --project=island --workers=2` covers v1 updates, explicit v2 upgrades, v2 updates, new installs, unavailable releases, persistent failures and layout at 390/640/1100 px in both themes. These are isolated mocked installs; the developer's global CLI packages were not upgraded. Local Playwright runs bypass the configured HTTP proxy for localhost using `NO_PROXY=127.0.0.1,localhost`.

## Alternatives considered
- Copy the Claude files per tool — strongest case is zero abstraction risk and per-tool quirks stay local. The driver that rules it out is per-tool drift: probe priority, PowerShell encoding, busy-guard, and semver fixes would need a landing per tool, and the GBK fix already proved single-point fixes matter.
- Third-party brand SVGs per tool — strongest case is real product icons with zero drawing work. The driver that rules it out is provenance: the repo already vendors the terminal icon set the sidebar uses, so rows reuse those assets with the monogram badge as load fallback instead of pulling new vendor marks.
- Generalize credential sync to all tools now — strongest case is symmetry. The driver that rules it out is per-app live-file divergence: each CLI owns a different config dialect and path, and each deserves its own applier plus acceptance pass rather than a shared guess.
- Do nothing / Claude-only cards — staying put keeps every current path green. The cost is the gap above: the presets launch tools Settings cannot see, and users install or upgrade blind.

### Claude Code version detection and install in Settings
- Reuse the former language-service staged-binary flow for the install — strongest case is a proven download-verify-commit layout with progress events. The driver that rules it out is distribution shape: Claude Code ships via npm, so the correct primitive is an anchored package-manager command with `PATH` augmentation, not an artifact fetch; the language-service installer has since been removed and is not a runtime dependency.
- Poll latest versions on a timer — strongest case is always-fresh badges. The driver that rules it out is cost without benefit: versions change rarely, probes spawn processes, and the card re-checks on every mount and on demand, which covers the freshness need with zero background load.
- Fold detection into `terminal/presets.ts checkCommandExists` — strongest case is one home for CLI readiness. The driver that rules it out is contract depth: presence booleans cannot carry versions, sources, or broken states, and terminal launch must stay a pure string splice with no probe latency on the spawn path.
- Do nothing / reuse manual terminal installs — staying put keeps every current path green. The cost is the gap above: no version signal, no in-app install, and provider changes remain hand edits outside the app.

### LLM-side multi-CLI matrix with sync state
- Per-provider "sync to CLI" buttons on every provider row — strongest case is fewer clicks for non-default relays. The driver that rules it out is state clarity: the consumer matrix shows at a glance who uses what, while scattered row buttons hide the current distribution; explicit provider ids in the protocol keep the per-provider path open without UI commitment.
- Persist the synced secret for drift comparison — strongest case is detecting hand edits after a sync. The driver that rules it out is secret sprawl: a second copy of the key on disk exists only to diff, and staleness is already visible through the source record plus the backup chain.
- Keep the sync block on the general card as well — strongest case is discoverability from the terminal-health view. The driver that rules it out is the stated home rule: general stays pure detection and install, and two sync entries invite divergent behavior over time.
- Do nothing / keep sync on the general card — staying put costs nothing now. The cost is the category error above: credential distribution living next to binary health, with no room for the internal consumer or the next CLI.

### Pi and self-built Janus lifecycle
- Publish Janus CLI to npm and treat it like the rest — strongest case is a uniform pipeline with no special cases. The driver that rules it out is release reality: the CLI ships with the sibling source today, and a registry release is a separate distribution decision; the local strategy models what exists.
- Rebuild unconditionally without verifying the package name — strongest case is fewer failure modes. The driver that rules it out is directory confusion: a stale or foreign checkout at the expected path must refuse loudly rather than link the wrong binary globally.
- Resolve the sibling root from the workspace file layout — strongest case is no Electron dependency. The driver that rules it out is packaged truth: only `app.getAppPath()` knows the dev root, guarded so tests and packaged runs degrade cleanly.
- Do nothing / update Janus by hand — staying put costs nothing now. The cost is the asymmetry above: every other row self-updates while the in-house tool needs a terminal ritual its own app could perform.


## Consequences
- **Gains**: Three terminal rows with official icon, version, latest, and install or upgrade actions in one card; new-tool cost is one registry row plus one meta row plus one icon asset. Six new tests pin registry-driven probing, per-tool manual hints, registry consistency, and the sync-stays-Claude guard (32 tests green in the domain).
- **Costs and limits**: Credential sync and sync state remain Claude-scoped; the matrix panel names only Claude until per-app appliers land. Latest-version strategies are npm-only, so a future non-npm tool needs a strategy field plus a fetcher. Gemini is deliberately out of scope: only the external CLIs the workspace presets launch are managed.

### Claude Code version detection and install in Settings
- **Gains**: Settings shows Claude Code state (not installed, broken, ready, update available) with current and latest versions, and installs or upgrades in one click; 28 unit tests pin the probe priority, the broken-state distinction, the PowerShell UTF-8 invocation shape, the busy-guard race, and the semver boundary (`tests/unit/cc-switch/`). Follow-up: broken Codex self-heals through `uninstall || install` (removal best effort, reinstall always runs, re-probe decides); `listLocations` enumerates every install with the probe default marked first as the confirm-dialog data foundation; a 12-check tool matrix pins all five registry rows plus per-tool detect, broken-state, and npm-command coverage.
- **Costs and limits**: Install needs npm on a discoverable path, otherwise the card degrades to a copyable manual command by design; latest lookup needs registry access and degrades to unknown offline. The busy guard is process-local, so two JanusX instances could still race npm. Self-heal is Codex-only (no official self-update there); anchored upgrades with honest `anchored=false` copy and the multi-location confirm dialog UI remain open. Adding the next tool means a new registry row plus its detector and projector, not a framework change; provider credential switching stays out of scope until the profile-store phase lands.

### LLM-side multi-CLI matrix with sync state
- **Gains**: Providers show their consumers in one matrix; sync source survives restarts and provider deletions render honestly; four sync-state tests pin the record lifecycle and malformed-record tolerance (`tests/unit/cc-switch/sync-state.test.ts` — 26 tests green in the domain). The applier concurrency test now proves serialization instead of asserting it: under two concurrent applies one backup is the initial file and the other is the first writer's output, so the second writer observably saw the first.
- **Costs and limits**: Only the default provider syncs from the UI today; the protocol already accepts explicit ids for later rows. One record per CLI means the matrix grows a row and a record field per tool, which fits the current two consumers but wants a table past a handful. Sync state is local-only with no cross-device story.

### Pi and self-built Janus lifecycle
- **Gains**: Pi probes, installs, and upgrades like the rest; Janus shows source-version drift and rebuilds plus relinks in one click when the source is present. Five new tests pin the build-then-link sequence with pinned working directories, build-failure short-circuit, missing-source guidance, and both known and unknown local latest (`installer.test.ts`, `llm-sync.test.ts` — 37 tests green in the domain).
- **Costs and limits**: Local updates need the sibling checkout with installed dependencies beside the app; otherwise the row is detect-only with manual steps. The link step mutates the global npm prefix, so concurrent JanusX instances share the existing npm-level serialization only through the installer busy guard.
