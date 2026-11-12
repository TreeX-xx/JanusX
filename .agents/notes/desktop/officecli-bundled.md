---
{
  "schema": "harness-note/2",
  "id": "02b7c101-50c6-5501-a4be-262dd867ba7c",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-09-18",
  "class": "feature",
  "extensions": {
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-09-18-agent-note-officecli-bundled--02b7c101.md",
      "sourceHash": "2499c93dc64a46e47def18326a6921e6ff3d87b8d6170fe221c3e594c8a72a61",
      "originalBodyHash": "4ce859341f961a1c737ca68bf23fc0486f015a890af6847bfec3ec6b6b5949c5",
      "category": "formal",
      "reason": "Retains the source decision in implemented lifecycle; body documents OfficeCLI bundled. No age-based archival.",
      "edits": ["Removed redundant Agent Note title prefix","Removed lifecycle duplicated by frontmatter"],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/implemented/feature/2026-09-18-officecli-bundled.md",
        "sourceHash": "2499c93dc64a46e47def18326a6921e6ff3d87b8d6170fe221c3e594c8a72a61",
        "originalBodyHash": "4ce859341f961a1c737ca68bf23fc0486f015a890af6847bfec3ec6b6b5949c5"
      }
    }
  },
  "updated": "2026-11-12T06:58:41Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/3a4dc304-70dd-49e4-b46a-ee2fc0fbc83e"
}
---
# OfficeCLI bundled


## Problem

Office preview depends on a version-pinned OfficeCLI. The original runtime installation flow added user friction and a separate update channel; bundling removed those costs. The first bundle resolved only `officecli.exe` and selected checksums by architecture alone, so macOS could neither find its executable nor pass the broker's checksum check, even though upstream publishes macOS binaries.

## Decision

OfficeCLI remains a bundled asset pinned to `1.0.135`. `src/shared/officecli-release.json` owns asset names, paths and SHA256 values for Windows and macOS, each with x64 and arm64 targets. Windows keeps `resources/officecli/officecli.exe`; macOS stages separate `resources/officecli/darwin-<arch>/officecli` binaries. `office-bundled-path.ts` resolves the process platform/architecture and retains the absolute `JANUSX_OFFICECLI_BINARY` development override. The broker selects its pinned hash by both platform and architecture. `officecli-manager.ts` probes `--version` and `watch/create/batch` capabilities, and reports `source: 'bundled'`. Missing or incompatible binaries surface reinstall copy ("reinstall JanusX"), never an install prompt.

`npm run officecli:prepare` downloads the selected official release at build time, verifies bytes before replacement, reuses valid files and sets executable permissions for macOS. `--check` performs no download. `scripts/officecli-before-pack.cjs` verifies the builder's actual target, so cross-architecture packaging cannot silently copy the host's binary. Platform-specific `extraResources` copies only that binary; all staged OfficeCLI files are excluded from `app.asar`. The Windows release workflow uses the same preparation command and manifest. Usage is maintained in [the resource README](../../../resources/officecli/README.md).

macOS signing excludes only the bundled OfficeCLI executable from re-signing, preserving upstream's signature and the broker's byte-level pin. JanusX app signing and notarization still require a Mac environment and credentials. Universal packages are rejected; separate arm64 and x64 apps keep the resource and process architecture aligned, including an x64 app under Rosetta. Linux is outside this bundled target contract. This change adapts OfficeCLI integration, not the complete desktop/native-dependency release pipeline.

Terminal creation reads `getVerifiedBinary()` synchronously. Application bootstrap already awaits `initializeOfficecliProvider()` before opening the window, so terminal registration, warmup and create do not repeat probes or refresh a missing result. A missing/incompatible OfficeCLI therefore cannot delay Shell or AI terminal startup; the terminal receives no verified OfficeCLI override in that case. Explicit Office consumers may still detect/refresh, and only subsequently created terminals receive a newly verified path. The Office manager and terminal IPC tests cover this behavior; the [startup investigation](../terminal/terminal-right-island-turn-history.md) owns timing evidence and UI feedback.

Development bootstrap resolves the same pinned asset under `app.getAppPath()/resources/officecli`; packaged bootstrap uses `process.resourcesPath/officecli`. Electron's development `process.resourcesPath` points into `node_modules/electron/dist/resources`, which does not contain the checkout asset and previously caused a false missing-engine result. An explicit `JANUSX_OFFICECLI_BINARY` override retains precedence. Changing this bootstrap path requires restarting the development main process.

Verification on 2026-10-20: the checkout binary matched the pinned x64 SHA256, reported `1.0.135`, and ran `watch/create/batch --help` successfully. The manager and launcher Vitest suites passed 13 tests. The running development process was not restarted and a real PPTX preview was not re-tested.

Verification on 2026-11-12 (Windows host): the full Office unit directory passed 121 tests; the resource suite then passed 8 tests after adding two successful staging/offline-reuse cases (123 distinct tests in total). TypeScript, scoped ESLint, `build:check`, electron-builder configuration validation, Windows resource SHA256 and the Windows `beforePack` hook passed. Note validation reported zero errors and 17 existing external-link diagnostics. Real macOS asset downloads timed out on this network, including a proxy-enabled retry, without replacing local resources. macOS execution, POSIX permission enforcement, preview, signed DMG/ZIP creation and installation remain not-run; no Mac support claim follows from the Windows-hosted checks.

## Alternatives considered

- Keep the managed download flow (user-data `current.json` manifest, GitHub fetch, `installerStatus/Start/Cancel/Remove` channels, `OfficeSetupGate` plus settings `OfficeCliManager`). The strongest case is a slim installer and on-demand arch selection. The driver against it is permanent user friction plus a parallel update channel: every OfficeCLI release needs installer, manifest, hash, and dialog maintenance, and every preview failure needs install-versus-runtime triage.
- Keep PATH and known-location probing alongside the bundle as fallbacks. The strongest case is developer convenience and power-user overrides. The driver against it is hijack surface and nondeterminism: a stale PATH binary silently wins over the pinned bundle and breaks the version guarantee the broker enforces. The dev override survives as the explicit `JANUSX_OFFICECLI_BINARY` variable only.
- Do nothing and reuse the manual-install guidance (`manualInstallSuffix`, release URL, copy-item steps). The cost is the status quo: new users meet `NOT_INSTALLED` on first Office preview and must leave the app to fix it, while the product workspace promises generation-to-preview in one click.

## Consequences

The runtime remains free of managed downloads, PATH fallback, installer dialogs and a separate OfficeCLI update channel. Each package grows by one target binary. Unsupported targets fail closed, and packaging checks catch missing or mismatched assets before producing a package. Development still needs explicit preparation. Adding Linux, universal macOS apps, or changing OfficeCLI's upstream signing/release process requires extending the manifest and packaging contract; it must not weaken the broker checksum to accommodate altered binaries.
