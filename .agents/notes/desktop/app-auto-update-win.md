---
{
  "schema": "harness-note/2",
  "id": "5fdf2273-99b3-5416-9e4a-ef42c63bbfb2",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-07-14",
  "class": "feature",
  "extensions": {
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-07-14-agent-note-win-app-auto-update-via-github-releases--5fdf2273.md",
      "sourceHash": "627e4047096740223a890f7a1f8405cff07a1c20c920d950023b7a83d2febf9e",
      "originalBodyHash": "81caf16d1162b911d170883f64dbbe95594aa5e8add027951f2957b436fe7112",
      "category": "formal",
      "reason": "Retains the source decision in implemented lifecycle; body documents Win app auto-update via GitHub Releases. No age-based archival.",
      "edits": ["Removed redundant Agent Note title prefix","Removed lifecycle duplicated by frontmatter"],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/implemented/feature/2026-07-14-app-auto-update-win.md",
        "sourceHash": "5480c3fe21fe1ccbff9445fa5e3d8a41e7367ef88e08db8a06ebd43cdf4cac37",
        "originalBodyHash": "3b0b29e5105e5c03ea6efd083a44c762de123cd476ff98f4176ae90f29d397f1"
      }
    }
  },
  "updated": "2026-10-27T16:06:18Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/3a4dc304-70dd-49e4-b46a-ee2fc0fbc83e"
}
---
# Win app auto-update via GitHub Releases


## Problem

Every JanusX release scatters installed versions because no in-app update path exists. The [scope boundary](./cli-manager-scope.md) names automatic updates as the sole adoption from the adjacent suite, and its acceptance criterion stays open until a packaged build updates itself.

## Decision

The Windows nsis installer build checks the owning repository's GitHub Releases feed and installs newer versions in-app. `electron-builder.yml` declares a `github` publish target (`TreeX-X/JanusX`, `latest` channel), so each tagged release uploads the installer plus the generated `latest.yml`; no separate update server exists. The target pins `releaseType: release` because the publisher defaults to draft, and drafts never enter the feed the client reads. `src/main/updater/service.ts` owns the update state machine over `electron-updater` and loads the updater library only on a supported runtime. Automatic checks only notify: both `autoDownload` and `autoInstallOnAppQuit` are false. The user clicks Download update (`updater:download`), then separately clicks Restart and install (`updater:install`). Ordinary exit never opts into installation. `src/main/updater/guards.ts` restricts the in-app updater to the packaged Win32 nsis build; dev mode, portable builds, and non-Windows platforms report an explicit unsupported reason. Renderer visibility lives in the About settings page through `src/renderer/src/components/UpdaterSettings.tsx` over the `updater:` IPC contract in `src/shared/ipc/updater.ts`, showing check, download/retry, progress, restart-to-install, and the unsupported-runtime hint. Version tags no longer trigger publication. `.github/workflows/release-win.yml` is a read-only manual artifact build; local `stage:win` uploads validated files into a draft, and `publish:win` compares remote files before explicitly exposing the release. Unsigned Windows installers may still trigger operating-system trust prompts; a complete installed upgrade remains unverified.

An `autoCheck` preference (`updaterSettings` in the global config, default true) governs the background schedule only. Turning it off stops the launch-delayed first check and the 6h poll without touching manual check or restart-to-install; turning it back on reschedules immediately when the service is armed. The persisted value applies at startup before the first schedule, and the settings IPC applies it to the running scheduler only after a successful disk write.

The title bar shows an update badge right of the JanusX wordmark while an update carries action value (available, downloading, downloaded, or retryable failure with a known version). The badge shares its event-to-state mapping with the settings panel through `src/renderer/src/lib/updater-badge.ts`. Every badge click opens the settings About tab, where the user can read release notes and choose download, retry, or installation. Download failures retain the discovered version and a Retry download action; installation dispatch failures retain Restart and install and show an error. Neither failure causes an automatic retry.

Installer downloads set `disableDifferentialDownload = true`. A locally built installer can share the published version number without sharing its bytes, making the published old blockmap incompatible with the cached installer. Downloading the complete installer avoids reconstruction failure followed by an opaque full-download fallback; SHA512 validation remains enabled. This costs a full transfer on each upgrade. Revisit differential downloads only after establishing that the cached base installer and its blockmap refer to identical bytes and exposing fallback stages to the UI. The title badge uses theme tokens and a compact text button with percentage and a thin progress track, with distinct failure and installation-ready labels. Transfer percentages are floored, and 100% while still downloading displays “Verifying installer”; only `update-downloaded` permits installation. The About page shares that verification distinction and shows a progress bar.

Verified installer metadata (version, notes, and completed progress) is stored independently from metadata-check phases. A failed recheck, a later different release, or a feed with no update cannot erase readiness or relabel the cached installer. Pending metadata checks and active downloads exclude competing checks/downloads so provider metadata cannot change mid-transfer. Every state patch emits a complete `{ type: 'state', state }` snapshot, keeping release notes and retry/install actions synchronized in already-open views. The cached installer remains the offered installation target for this process; choosing a newer release after downloading an earlier one is deferred.

The release workflow guards the first-publish footguns: the tag must equal `v` plus the `package.json` version because the publisher derives the release tag and the feed version from the package, and the sibling `janus-agentX` checkout resolves to the public same-owner repository. Snapshots and background events carry the release body as tag-stripped plain text (`formatReleaseNotes` in the updater contract). The updater library and the service failures log through `electron-log` to `userData/logs` with a console mirror. Unsupported runtimes get a fixed download-page entry (`updater:openReleases`, URL allowlist of one) instead of a dead button. The allowlisted URL is `https://treex-x.github.io/JanusX/#downloads`, the gh-pages package chooser, so portable and dev users land on the designed install/portable selection rather than the raw Releases listing; the landing page's own changelog links still target Releases. The auto-check switch disables where no schedule exists.

## Verification status

The maintainer explicitly authorized replacing the published `v0.9.4` tag and Windows assets on 2026-10-22. This one-off release exception is recorded in `docs/maintainers.md`; updated user-facing notes live in `docs/releases/v0.9.4.md`. That historical publisher used an explicit `--replace-existing` option to hide, replace and republish the four Windows assets. The current flow removes that exception entry, refuses public-release replacement, and resumes only unpublished drafts with identical existing assets. Failed uploads leave the draft private for recovery. The operator synchronizes the Release notes and aggregate SHA256 file afterward. All 50 updater/publishing/shutdown regressions pass, including three new replacement-gate checks. Already installed 0.9.4 clients need manual reinstallation because the version is unchanged.

The 2026-10-22 0.9.3 → 0.9.4 report is a completed download with misleading progress resets, not a permanent loop. The installed `userData/logs/main.log` records differential SHA512 rejection and full-download fallback at 09:13:02, then successful download at 09:22:25 (local time). The cached old installer is 137,762,356 bytes with SHA512 `P/mJbCzhMZAxJDgaMwz0BDhpmkjCs/2ApJjaD2+28voz9N2D2nR5WCZrPG9AdZY6E2ed3hOWIBLfCJJbUyTkTA==`; the real v0.9.3 release feed specifies 137,739,950 bytes and `ywrtiA4QGX2j8NgKf+smOReJIS8n620cCyMva7mdOQPosGvTdWwZU+x902NxovwgmOiNZeLhQvIoRQ8ouN/3uQ==`. This proves the cached base differs from the base described by the release feed. The available log establishes one fallback; it does not establish an independent cause for every perceived reset. The user confirmed the ready-to-install UI. No installed upgrade was performed by the agent, and source fixes require a rebuilt installer before they affect existing installations.

Verification for this change: `npm run test:unit -- --run tests/unit/updater tests/unit/publish-win.test.ts tests/unit/app-shutdown.test.ts` passes 47/47, including five real Chromium component tests across English/Chinese and light/dark themes. The new service regression checks that 99.9% remains 99%, 100% cannot install before verified completion, checksum failure stops without retry, and explicit retry resets progress. `npm run typecheck:strict-unused`, changed-source ESLint, `npm run i18n:check`, `npm run theme:check`, and `npm run build:check` pass. A fresh isolated native Electron probe runs the modified service against real `NsisUpdater` and local HTTP: the service enables full downloads, a corrupt 64 KiB payload is rejected, explicit retry succeeds, a failed metadata recheck preserves installation readiness, and explicit NSIS dispatch is intercepted. Probe scripts, five-check results, and light/dark UI screenshots are local evidence under ignored `artifacts/updater-20261022/`; no actual installer was launched.

The 2026-10-19 installed-runtime report exposed an initialization gap in the earlier probes: native ESM does not synthesize the CommonJS `autoUpdater` getter as a named export. Destructuring it directly from `import('electron-updater')` produced `undefined` and failed while setting `autoDownload`, before any network check. The service now reads `autoUpdater` from the module's default export while retaining lazy loading. The service test mock exposes only that default shape, matching the real dependency. A native Node import confirms the named export is absent and the default export owns the getter; all 44 updater/publishing/shutdown regression tests pass after the fix. Existing installed binaries require a rebuilt installer; these checks do not establish a full packaged upgrade.

The 2026-10-18 audit confirms version discovery against the real GitHub provider: an isolated Electron 35.7.5 host identifying as 0.9.1 discovers the published 0.9.2 installer, and a 0.9.2 host reports no update. The release contains `latest.yml`, the setup executable and its blockmap. The real `NsisUpdater` also completes a valid 64 KiB local fixture download, rejects a checksum mismatch, and dispatches the expected `--updated --force-run` installer arguments with process creation intercepted. No installation or replacement of the user's running application occurred. Downloading the complete 137,114,422-byte published installer reached 18,415,607 bytes before the audit's four-minute deadline; its complete SHA512 and an installed-version upgrade remain unverified.

The initial audit reproduced lost installer readiness after a failed recheck and omitted release notes in background events; both are fixed by the independent installer record and full snapshots. It also proved that `AppShutdown` ends through `app.exit()`, bypassing the updater's normal-quit installation hook. The user subsequently required explicit download and installation, so that hook is disabled and `AppShutdown` needs no change. Explicit Restart and install dispatches installation before requesting quit.

Current regression verification runs `npm run test:unit -- --run tests/unit/updater tests/unit/publish-win.test.ts tests/unit/app-shutdown.test.ts`: 44/44 tests cover consent gates, download retry, ready-installer preservation, changed/withdrawn feeds, concurrency, complete events, IPC routing, preferences, publishing, and shutdown. Three of these tests render the actual settings and badge components in headless Chromium, covering English/Chinese download-to-install clicks, progress, failures, retries, and notes in an already-open panel. `npm run typecheck:strict-unused`, changed-source ESLint, `npm run i18n:check`, and `npm run build:check` pass; the build uses isolated artifacts output and reports existing chunking warnings.

A follow-up isolated Electron probe runs the actual modified service with a real `NsisUpdater` against local HTTP. Its five assertions confirm no installer request before explicit download, checksum rejection without automatic retry, a successful manual retry and SHA512 verification of 64 KiB, retained readiness after a real HTTP 503 recheck, and explicit NSIS dispatch with process creation intercepted. No normal-quit installation listener is registered. Build/run commands are `node artifacts/updater-audit-20261018/build-manual-probe.cjs` and `node artifacts/updater-audit-20261018/run-electron.cjs manual-native`; results are in `manual-native-results.json` and `manual-native.log` beside the scripts. The directory README distinguishes this verification from the historical initial audit. That ignored directory is local evidence, not a shipped test dependency. Full packaged upgrade acceptance remains open.

## Alternatives considered

- Self-hosted generic feed (`generic` provider on internal HTTPS): strongest case serves private deployments without touching github.com. The driver that defers it is operational cost before any customer demands it; the publish shape (yml plus artifacts) stays identical, so the switch costs a config change, not a rewrite.
- External download-page-only checker: strongest case covers portable builds and dev mode without an installation state machine. It remains the fallback for unsupported runtimes. Supported Windows installations retain verified in-app download and installation after explicit user actions, avoiding a separate browser-to-installer handoff.
- Do nothing / reuse manual download releases: staying put keeps zero updater machinery. The cost is permanent version fragmentation plus a relitigated scope boundary every release.

## Consequences

- Win nsis gains background notification checks (30s after launch, every 6h), manual check, explicit download/retry, and restart-to-install; every other runtime gains an honest unsupported message instead of a broken button.
- macOS signing plus notarization and the Linux AppImage/deb matrix stay open work under the owning scope note; the guards give those stages explicit extension points.
- Release discipline requires a matching version tag and manifest alignment. Tag pushes never publish; explicit publication compares all four Windows assets against the local candidate before exposing the draft.
- Retracting a bad release has no staged rollout or kill switch yet: deleting the Release stops further detection (the feed entry disappears), but already-downloaded copies remain installable by explicit user action. Recovery requires a patched release; channels and revocation checks remain future work. User consent also means installations may stay on older versions.
