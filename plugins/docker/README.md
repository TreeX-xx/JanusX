# Docker official plugin

Optional application-wide Docker management for JanusX. The toolbox opens one container list and one detail area with Overview, Logs and Terminal. It works without a project; changing projects never rebinds the local engine or container shells.

The first version manages existing local containers using an installed Docker CLI. It supports search and running filters, start/stop/restart, Compose label groups and group start/stop, live logs with search/copy/scroll pause, interactive container shells, and published TCP port candidates in the JanusX browser. Group actions run existing containers in stable name order with individual results; they do not implement Compose dependency orchestration or deployment.

No Docker runtime installation, image/volume/network management or remote environments are included. Select a local Docker context before connecting. TCP and SSH endpoints are rejected, including loopback TCP. Every query, log process and terminal is pinned to the same inspected Unix socket or Windows Docker pipe; reconnecting to a different engine requires a plugin reload.

The host owns each PTY under the plugin activation, engine and full container ID. One live shell per container, up to eight shells per activation. Switching containers, projects or closing the page retains shells; reopening reattaches. Shell history is bounded at 256 Ki characters per session; the terminal renderer keeps 3,000 lines. Stop/restart ends that container's shell. Disable/reload/uninstall, native failure or app exit releases owned shells and CLI collectors, while containers and the Docker engine keep running. Application restart cannot restore an old shell.

Logs use a tail of 500 lines, 120 ms event batches and 256 Ki character buffers in the collector and page. Closing or hiding the page stops its log collectors; reopening reads a fresh bounded tail. The active page refreshes containers every two seconds. Display preferences and shell buffers last for the current activation. Native exit hooks stop collectors on an uncaught exception or SIGTERM; immediate descendant cleanup after an uncatchable OS kill is not guaranteed or verified.

```powershell
npm ci
npm ci --prefix plugins/docker
npm run dev:docker
```

This builds and automatically installs a locally signed package into an isolated `.cache/docker-local/profile`. Enable Docker under Settings → Plugins, then open Docker in the toolbox. `npm run dev:docker -- --prepare-only` creates the package and `.cache/docker-local/build.json` without launching Electron. Ordinary `npm run dev` and released applications do not trust this local signing identity; production signing and catalog publication remain release steps. Docker CLI/Desktop must already be installed; opening Docker Desktop is always an explicit action.

```powershell
npm run plugins:docker:check
npm run test:docker:desktop
npx vitest run docker-plugin container-terminals plugin-native-desktop
```

The independent build check installs a packed public SDK outside this repository, validates package resources and activates/stops the actual backend bundle in a child process. Windows Electron tests use an explicitly synthetic Docker executable to verify UI, structured argv, terminal input/reconnection, service routing and cleanup. They do not replace acceptance against a real Docker engine. This machine currently has no Docker CLI/engine, so real containers, Docker Desktop/WSL and macOS/Linux are unverified.
