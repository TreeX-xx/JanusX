import { useSyncExternalStore } from 'react'
const en = {
  runtimeProxyNetwork: 'The app proxy could not be connected to this WSL network. The dedicated environment currently requires a NAT gateway reachable from Windows.', runtimeProxyUnavailable: 'The Docker proxy relay could not start. Check whether its saved port is in use or blocked by Windows Firewall, then retry.',
  localEnvironmentSummary: 'Docker Desktop or a local engine', wslEnvironmentSummary: 'Use this Linux environment', managedEnvironmentSummary: 'An isolated environment for Docker',
  environment: 'Environment', changeEnvironment: 'Change environment', detectEnvironments: 'Detect environments', existingDocker: 'Existing local Docker', existingWsl: 'Existing WSL Ubuntu', dedicatedEnvironment: 'Dedicated Linux environment',
  existingDockerHelp: 'Connect using the local Docker CLI and its selected local context.', existingWslHelp: 'Use Docker in this Ubuntu. Code mounts use paths inside this environment.', detectingEnvironments: 'Detecting WSL environments…', wslDetectionFailed: 'WSL environments could not be detected. Refresh to retry, or choose a dedicated environment to prepare WSL.',
  installInUbuntu: 'Install Docker in this Ubuntu', installInUbuntuConfirm: 'Install Docker Engine packages in “{name}”? This changes the existing Ubuntu system. Existing Docker configurations will not be replaced.', confirmInstall: 'Confirm installation', cancel: 'Cancel', ubuntuOnly: 'This environment is unsupported. Existing environment installation requires Ubuntu on WSL2.',
  existingWslDataHelp: 'Your Ubuntu, Docker configuration and container data remain when this plugin is removed.', switchEnvironmentHelp: 'Switching ends plugin shells and log subscriptions. Engines and containers keep running.',
  containers: 'Containers', local: 'Local engine', all: 'All', running: 'Running', search: 'Search containers', refresh: 'Refresh', desktop: 'Open Docker Desktop', connect: 'Connect', retry: 'Retry',
  overview: 'Overview', logs: 'Logs', terminal: 'Terminal', start: 'Start', stop: 'Stop', restart: 'Restart', startGroup: 'Start group', stopGroup: 'Stop group',
  empty: 'No containers yet', emptyHelp: 'Containers created on this local engine will appear here.', noMatch: 'No matching containers', select: 'Select a container', selectHelp: 'View its details, logs and terminal here.',
  disconnected: 'Connect to local Docker', connectHelp: 'Connect an existing engine, or prepare a local runtime without Docker Desktop.', missing: 'No Docker CLI found. You can prepare a local runtime below, or connect an existing installation.', remote: 'The selected Docker context points to a remote endpoint. Select a local socket or Docker Desktop context.',
  connectionFailed: 'Cannot connect to Docker. Check the engine and try again.', image: 'Image', status: 'Status', id: 'Container ID', project: 'Compose project', ports: 'Published ports', noPorts: 'No published TCP ports', portHelp: 'Open an HTTP candidate in the JanusX browser. A published port may use another protocol.',
  standalone: 'Containers', follow: 'Auto scroll', pause: 'Pause scroll', copy: 'Copy', copied: 'Copied', logSearch: 'Search logs', logWaiting: 'Waiting for logs…', truncated: 'Earlier output was trimmed to keep history bounded.', logEnded: 'Log stream ended. Switch away and return to reconnect.',
  openTerminal: 'Open terminal', closeTerminal: 'Close shell', shell: 'Shell', terminalHelp: 'Open a shell inside this container. Closing this panel keeps it connected.', ended: 'Shell ended', notRunning: 'Start the container to open a shell.', back: 'Containers', working: 'Working…', complete: 'Operation completed', failed: 'Some operations failed', groupHelp: 'Controls existing containers; Compose dependency order is not applied.',
  stopped: 'Stopped', engine: 'Engine', connected: 'Connected', clear: 'Dismiss', none: '—', terminalLimit: 'Eight container shells are open. Close one before opening another.', shellMissing: 'The shell exited. Try another shell if this image does not include it.',
  runtimeTitle: 'Local runtime', runtimeHelp: 'Prepare a dedicated WSL2 environment with Docker Engine. Docker Desktop is not required. Windows may ask for administrator permission and a restart.',
  runtimeInstall: 'Install and start', runtimeStart: 'Start runtime', runtimeContinue: 'Continue after restart', runtimeRestartHelp: 'Restart Windows if requested, then reopen this page and continue. JanusX will not restart your computer.', runtimeDataHelp: 'Closing this page keeps setup running. The runtime and container data remain when the plugin is disabled or removed.',
  runtime_checking: 'Checking environment…',
  'runtime_wsl-required': 'WSL2 needs to be prepared', 'runtime_not-installed': 'Runtime is not installed', runtime_stopped: 'Runtime is stopped', runtime_ready: 'Runtime is ready', 'runtime_preparing-wsl': 'Preparing WSL2…', 'runtime_restart-required': 'Windows preparation finished; a restart may be required', runtime_downloading: 'Downloading Ubuntu…', runtime_importing: 'Creating the local environment…', runtime_installing: 'Installing Docker Engine…', runtime_starting: 'Starting Docker Engine…', runtime_error: 'Setup could not finish', runtime_unsupported: 'Managed installation is available on Windows x64 and ARM64',
  runtimeOwnership: 'An environment with this name already exists and cannot be verified as owned by JanusX. It was left unchanged.', runtimeWsl2: 'The selected environment must use WSL2. Choose a WSL2 environment or check virtualization and update WSL.', runtimeChecksum: 'The downloaded runtime failed verification. Retry to download it again.', runtimeBusy: 'Another JanusX instance is preparing the runtime. Wait for it to finish.',
  runtimeFailure: 'Runtime preparation failed. Check the connection, Windows virtualization and available disk space, then retry.',
}
const zh: typeof en = {
  runtimeProxyNetwork: '无法将应用代理接入此 WSL 网络。专用环境目前需要 Windows 可访问的 NAT 网关。', runtimeProxyUnavailable: 'Docker 代理转接未能启动。请检查其保存的端口是否被占用或被 Windows 防火墙拦截，然后重试。',
  localEnvironmentSummary: 'Docker Desktop 或本机引擎', wslEnvironmentSummary: '使用此 Linux 环境', managedEnvironmentSummary: '为 Docker 创建独立环境',
  environment: '运行环境', changeEnvironment: '切换运行环境', detectEnvironments: '检测环境', existingDocker: '已有本机 Docker', existingWsl: '已有 WSL Ubuntu', dedicatedEnvironment: '独立 Linux 环境',
  existingDockerHelp: '通过本机 Docker CLI 连接其已选择的本地 context。', existingWslHelp: '使用此 Ubuntu 中的 Docker。代码挂载使用该环境内部的路径。', detectingEnvironments: '正在检测 WSL 环境…', wslDetectionFailed: '未能检测 WSL 环境。可刷新重试，或选择独立环境以准备 WSL。',
  installInUbuntu: '在此 Ubuntu 安装 Docker', installInUbuntuConfirm: '在“{name}”中安装 Docker Engine 软件包？这会修改现有 Ubuntu 系统，不会替换已有 Docker 配置。', confirmInstall: '确认安装', cancel: '取消', ubuntuOnly: '暂不支持此环境。已有环境安装需要 WSL2 上的 Ubuntu。',
  existingWslDataHelp: '卸载插件会保留你的 Ubuntu、Docker 配置及容器数据。', switchEnvironmentHelp: '切换环境会结束插件终端及日志订阅，引擎与容器继续运行。',
  containers: '容器', local: '本机引擎', all: '全部', running: '运行中', search: '搜索容器', refresh: '刷新', desktop: '打开 Docker Desktop', connect: '连接', retry: '重试',
  overview: '概览', logs: '日志', terminal: '终端', start: '启动', stop: '停止', restart: '重启', startGroup: '启动组', stopGroup: '停止组',
  empty: '暂无容器', emptyHelp: '本机引擎中创建的容器会显示在这里。', noMatch: '没有匹配的容器', select: '选择一个容器', selectHelp: '在这里查看详情、日志和终端。',
  disconnected: '连接本机 Docker', connectHelp: '连接已有引擎，或准备无需 Docker Desktop 的本机运行环境。', missing: '未找到 Docker CLI。可以在下方准备本机运行环境，或连接已有安装。', remote: '当前 Docker context 指向远程环境。请选择本机 socket 或 Docker Desktop context。',
  connectionFailed: '无法连接 Docker，请检查引擎后重试。', image: '镜像', status: '状态', id: '容器 ID', project: 'Compose 项目', ports: '已发布端口', noPorts: '没有已发布的 TCP 端口', portHelp: '在 JanusX 浏览器中打开 HTTP 候选地址。已发布端口也可能使用其他协议。',
  standalone: '独立容器', follow: '自动滚动', pause: '暂停滚动', copy: '复制', copied: '已复制', logSearch: '搜索日志', logWaiting: '等待日志…', truncated: '较早的输出已截断，历史记录保留在限额内。', logEnded: '日志流已结束，切换后返回可重新连接。',
  openTerminal: '打开终端', closeTerminal: '关闭 shell', shell: 'Shell', terminalHelp: '在容器内打开 shell，关闭面板后保持连接。', ended: 'Shell 已结束', notRunning: '请先启动容器，再打开 shell。', back: '容器列表', working: '处理中…', complete: '操作已完成', failed: '部分操作失败', groupHelp: '只控制已有容器，不应用 Compose 依赖顺序。',
  stopped: '已停止', engine: '引擎', connected: '已连接', clear: '关闭提示', none: '—', terminalLimit: '已打开 8 个容器 shell，请先关闭一个。', shellMissing: 'Shell 已退出。如果镜像不包含此 shell，请尝试其他选项。',
  runtimeTitle: '本机运行环境', runtimeHelp: '在独立的 WSL2 环境中准备 Docker Engine，无需 Docker Desktop。Windows 可能请求管理员授权和重启。',
  runtimeInstall: '安装并启动', runtimeStart: '启动运行环境', runtimeContinue: '重启后继续', runtimeRestartHelp: '若 Windows 提示需要重启，请重启后重新打开此页继续。JanusX 不会自动重启电脑。', runtimeDataHelp: '关闭页面后继续准备。停用或卸载插件会保留运行环境及容器数据。',
  runtime_checking: '正在检测环境…',
  'runtime_wsl-required': '需要准备 WSL2', 'runtime_not-installed': '尚未安装运行环境', runtime_stopped: '运行环境已停止', runtime_ready: '运行环境已就绪', 'runtime_preparing-wsl': '正在准备 WSL2…', 'runtime_restart-required': 'Windows 准备已完成，可能需要重启', runtime_downloading: '正在下载 Ubuntu…', runtime_importing: '正在创建本机环境…', runtime_installing: '正在安装 Docker Engine…', runtime_starting: '正在启动 Docker Engine…', runtime_error: '未能完成准备', runtime_unsupported: '托管安装支持 Windows x64 和 ARM64',
  runtimeOwnership: '已存在同名环境，无法确认由 JanusX 创建，已保持原样。', runtimeWsl2: '所选环境需要使用 WSL2。请选择 WSL2 环境，或检查虚拟化并更新 WSL。', runtimeChecksum: '运行环境下载校验失败，请重试以重新下载。', runtimeBusy: '另一个 JanusX 实例正在准备运行环境，请等待完成。',
  runtimeFailure: '运行环境准备失败，请检查网络、Windows 虚拟化与可用磁盘空间后重试。',
}
let locale = 'en'
const listeners = new Set<() => void>()
export function setLocale(value: string) { locale = value; for (const listener of listeners) listener() }
export function t(key: keyof typeof en): string { return (locale.startsWith('zh') ? zh : en)[key] }
export function useLocale() { useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => locale); return t }
export function errorText(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause)
  if (message === 'docker-cli-missing') return t('missing')
  if (message === 'docker-remote-endpoint') return t('remote')
  if (message === 'terminal-limit') return t('terminalLimit')
  if (message === 'docker-runtime-ownership') return t('runtimeOwnership')
  if (message === 'docker-runtime-wsl2-required') return t('runtimeWsl2')
  if (message === 'docker-runtime-checksum-failed') return t('runtimeChecksum')
  if (message === 'docker-runtime-busy') return t('runtimeBusy')
  if (message === 'docker-runtime-proxy-network') return t('runtimeProxyNetwork')
  if (message === 'docker-runtime-proxy-unavailable') return t('runtimeProxyUnavailable')
  if (message.startsWith('docker-runtime-')) return `${t('runtimeFailure')} (${message})`
  return message.startsWith('docker-') ? `${t('connectionFailed')} (${message})` : message
}
