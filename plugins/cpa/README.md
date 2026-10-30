# CPA official plugin

CPA is optional. Install a signed `official.cpa` package in Settings → Plugins, review its native permission and enable it. Its application-wide toolbox entry and settings page work without an open project. The main application contains no CPA installer, runtime or settings UI.

Local managed mode downloads and verifies upstream CPA 8.x and management frontend 1.x components on first use. External mode connects an existing HTTP(S) management page. Account authorization, quota and API routing remain upstream CPA features; this plugin does not import CLI accounts or change JanusX model credentials.

The native activation owns the managed process and proxy. Opening the management page, saving an enabled managed configuration or explicitly starting CPA launches it; application startup alone does not. Closing the panel releases its browser guest and keeps CPA running. Switching projects preserves the application-wide page and its login. Stop, plugin disable/reload/uninstall and application exit stop the owned instance. External instances are never terminated. Stop leaves configuration intact; opening the page again can start it.

First activation copies legacy `janusx/components/cpa` and `cpaSettings` into plugin data using a staged rename. Original files remain intact. The same origin retains the existing isolated login partition. An explicit plugin data reset prevents reimport. Port conflicts fail without terminating the occupying service.

The plugin UI is offline. A trusted native callback asks the host to attach a separate sandboxed management browser, with no preload, SDK bridge or Node access. Its persistent profile is private to the plugin and origin. Managed OAuth routes and callback ports are declared by the plugin, with system-browser authorization and the existing manual callback fallback.

For local development:

```powershell
npm ci
npm ci --prefix plugins/cpa
npm run dev:cpa
```

This builds a locally signed package and launches an isolated `.cache/cpa-local/profile`. Enable CPA in Settings → Plugins. Use `npm run dev:cpa -- --prepare-only` to create the signed package without opening the app. These keys are local development keys; production catalog trust is unchanged. Production signing and catalog publication are separate release steps.

Electron's install script must run. If dependencies were installed with `--ignore-scripts`, run `npm rebuild electron` before starting the app. The CPA launcher checks this prerequisite before building.

Verification:

```powershell
npm run plugins:cpa:check
npm run test:cpa:desktop
```

The build check installs a packed public SDK in a temporary directory outside this repository, then typechecks, builds and validates package resources. Desktop tests cover signed installation, no-project access, cross-project identity, settings synchronization, isolated login and panel/activation lifetimes. The real Windows runtime test additionally requires either `JANUSX_E2E_CPA_COMPONENTS` pointing to an immutable component root containing `versions/v8.0.31-v1.26.5-28bde34eb33a/`, or `JANUSX_E2E_CPA_ZIP` and `JANUSX_E2E_CPA_HTML` pointing to the pinned 8.0.31 / 1.26.5 assets. Hashes are checked before execution; cached source accounts and keys are never copied. `JANUS_ELECTRON_PATH` can select an existing matching Electron executable.
