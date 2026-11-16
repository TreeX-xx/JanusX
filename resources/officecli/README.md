# Bundled OfficeCLI

OfficeCLI is pinned to `1.0.135`. The asset names, platform-specific SHA256 values,
and staged paths are defined once in [`src/shared/officecli-release.json`](../../src/shared/officecli-release.json).
Preparation downloads the official release at build time and verifies it before
replacing a local resource. The npm command uses Node's environment proxy support
(`HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`). Binaries are ignored by Git.

| Target | Staged path relative to this directory |
| --- | --- |
| Windows x64 / arm64 | `officecli.exe` (one architecture at a time) |
| macOS Apple Silicon | `darwin-arm64/officecli` |
| macOS Intel | `darwin-x64/officecli` |

```bash
# Default: the current Node process platform and architecture.
npm run officecli:prepare

# Explicit targets; --check verifies an existing resource without downloading.
npm run officecli:prepare -- --platform win32 --arch x64
npm run officecli:prepare -- --platform darwin --arch arm64
npm run officecli:prepare -- --platform darwin --arch x64 --check
```

On a Mac, after installing/building the normal project dependencies for the target:

```bash
# Apple Silicon; use x64 in both commands for Intel.
npm run officecli:prepare -- --platform darwin --arch arm64
npm run check:macos-resources -- --arch arm64
npm run package:mac -- --arm64
```

The builder hook verifies the actual packaging target, restores macOS executable
permissions, and rejects missing, altered, or wrong-architecture resources. Each
package copies only its target binary outside `app.asar`. Windows keeps its
existing installed path. macOS uses `<resources>/officecli/darwin-<arch>/officecli`,
matching the Node/Electron process architecture (including x64 under Rosetta).
Universal bundles are not supported; build separate x64 and arm64 packages.

The current distribution configuration requires macOS 15.0 or later. The resource
check also verifies node-pty's Mach-O architecture and deployment target; it does
not load Mac binaries when run on Windows. The dependency rationale and pending
minimum-version acceptance are recorded in [macOS compatibility](../../.agents/notes/desktop/macos-compatibility.md).

The macOS signing configuration preserves OfficeCLI's upstream signature because
re-signing it changes the bytes checked by the broker. App signing and notarization
still require the normal macOS environment and credentials. This adaptation has
Windows-hosted tests; macOS execution, preview, and signed DMG/ZIP installation
still require validation on real Macs.

Development resolves the same layout under the checkout's `resources` directory.
`JANUSX_OFFICECLI_BINARY` accepts an absolute development override; the version,
capability and broker checksum checks still apply. The app never downloads,
installs, or prompts for OfficeCLI at runtime. See the
[bundling decision](../../.agents/notes/desktop/officecli-bundled.md) for ownership
and validation boundaries.
