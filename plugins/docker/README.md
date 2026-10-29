# Docker official plugin

Optional application-wide Docker management for JanusX. The toolbox opens one container list and one detail area with Overview, Logs and Terminal. It works without a project; changing projects never rebinds the local engine or container shells.

The first version manages existing local containers using an installed Docker CLI. It supports search and running filters, start/stop/restart, Compose label groups and group start/stop, live logs with search/copy/scroll pause, interactive container shells, and published TCP port candidates in the JanusX browser. Group actions run existing containers in stable name order with individual results; they do not implement Compose dependency orchestration or deployment.

The environment selector offers existing local Docker, an existing WSL2 Ubuntu, or the dedicated Linux environment on Windows. The choice survives page closure and plugin restart, independently of projects. Only one engine is managed at a time. Changing environments clears the previous view, log collectors and container shells; engines and containers keep running. Local Docker uses its selected context, pinned to an inspected Unix socket or Windows Docker pipe; TCP and SSH endpoints are rejected, including loopback TCP. No image/volume/network management or remote environments are included.

Existing WSL inventory is read-only. Selecting a distribution inspects WSL2, Ubuntu and Docker availability. If Docker is missing, installation requires an explicit confirmation naming that Ubuntu; it uses Ubuntu's signed `docker.io` packages and refuses to replace a detected client or daemon. Existing Docker starts through that distribution's systemd/service configuration. Other distributions and WSL1 are reported unsupported, without conversion. Code mounts use paths inside the selected environment; a separate distribution isolates files and Docker data but still shares host CPU and memory.

On Windows x64/ARM64, choosing the dedicated environment offers an optional **Install and start** action. It prepares WSL2 when needed (Windows UAC and a restart may be required), imports a dedicated `JanusX-Docker` distribution and installs Docker Engine from Ubuntu's signed repositories. Docker Desktop is not required. A pinned Ubuntu Base 24.04.5 rootfs is streamed through the application proxy, SHA-256 verified and limited to 256 MiB.

For the dedicated environment, apt and a newly started daemon use an authenticated relay to the app's proxy when one is configured. It binds only the Windows interface matching WSL's NAT gateway; it does not change `.wslconfig`, Windows Firewall, user apt files or daemon configuration. Saved relay credentials/port allow reconnection after plugin reactivation. Windows Firewall must allow that interface. The relay lives with the plugin: containers and the engine keep running after disable/app exit, but downloads through its relay require JanusX to be running. Network/address changes or a daemon started before this support may require a runtime restart. Existing Ubuntu keeps its own networking/proxy configuration. The WSL localhost-proxy warning may still appear in manually opened terminals; successful relay routing does not change WSL's global auto-proxy behavior.

Setup continues when the page closes, reports progress and supports retry after interruption. Reopening starts an owned, installed runtime when needed. An existing external CLI error or remote context never silently switches to the managed engine. The dedicated distro must match both Windows and Linux ownership markers; unknown same-name distributions are untouched. Runtime files and container data live outside plugin data at `%LOCALAPPDATA%/JanusX/docker-runtime` and survive plugin removal. Disabling stops preparation requests, not the engine or containers. No global WSL shutdown, distribution deletion, automatic reboot, daemon upgrade or runtime deletion is implemented.

WSL queries, logs and PTYs use `wsl.exe --distribution <selected distribution> --user root --exec /usr/bin/docker --host unix:///var/run/docker.sock`. Before opening a PTY, the host independently verifies that the selected distribution is registered and binds sessions to that target. The dedicated daemon runs through a hidden `Start-Process` WSL client with a Linux lock, so it can outlive JanusX without requesting Node's detached console. Other platforms continue to use their existing local Docker installation.

The host owns each PTY under the plugin activation, engine and full container ID. One live shell per container, up to eight shells per activation. Switching containers, projects or closing the page retains shells; reopening reattaches. Shell history is bounded at 256 Ki characters per session; the terminal renderer keeps 3,000 lines. Stop/restart ends that container's shell. Disable/reload/uninstall, native failure or app exit releases owned shells and CLI collectors, while containers and the Docker engine keep running. Application restart cannot restore an old shell.

Logs use a tail of 500 lines, 120 ms event batches and 256 Ki character buffers in the collector and page. Closing or hiding the page stops its log collectors; reopening reads a fresh bounded tail. The active page refreshes containers every two seconds. Display preferences and shell buffers last for the current activation. Native exit hooks stop collectors on an uncaught exception or SIGTERM; immediate descendant cleanup after an uncatchable OS kill is not guaranteed or verified.

```powershell
npm ci
npm ci --prefix plugins/docker
npm run dev:docker
```

This builds and automatically installs a locally signed package into an isolated `.cache/docker-local/profile`. Enable Docker under Settings → Plugins, then open Docker in the toolbox. `npm run dev:docker -- --prepare-only` creates the package and `.cache/docker-local/build.json` without launching Electron. Ordinary `npm run dev` and released applications do not trust this local signing identity; production signing and catalog publication remain release steps. Preparing a missing runtime and opening Docker Desktop are explicit actions.

```powershell
npm run plugins:docker:check
npm run test:docker:desktop
npx vitest run docker-environments docker-plugin docker-managed-wsl docker-runtime-download docker-runtime-proxy container-terminals plugin-native-desktop
```

The independent build check installs a packed public SDK outside this repository, validates package resources and activates/stops the actual backend bundle in a child process. Windows Electron tests use explicitly synthetic Docker and installer fixtures to verify UI, preparation/retry, page release, environment switching, Ubuntu installation confirmation, structured argv, terminal input/reconnection and service routing. They do not install WSL or Docker and do not replace acceptance against a real engine. Actual WSL2 installation, UAC/reboot, apt, existing Ubuntu service startup, engine survival and macOS/Linux remain unverified on this machine.
