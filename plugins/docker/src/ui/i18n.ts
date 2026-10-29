import { useSyncExternalStore } from 'react'
const en = {
  containers: 'Containers', local: 'Local engine', all: 'All', running: 'Running', search: 'Search containers', refresh: 'Refresh', desktop: 'Open Docker Desktop', connect: 'Connect', retry: 'Retry',
  overview: 'Overview', logs: 'Logs', terminal: 'Terminal', start: 'Start', stop: 'Stop', restart: 'Restart', startGroup: 'Start group', stopGroup: 'Stop group',
  empty: 'No containers yet', emptyHelp: 'Containers created on this local engine will appear here.', noMatch: 'No matching containers', select: 'Select a container', selectHelp: 'View its details, logs and terminal here.',
  disconnected: 'Connect to local Docker', connectHelp: 'Make sure Docker is installed and its engine is running.', missing: 'Docker CLI was not found. Install Docker Desktop or add Docker to PATH.', remote: 'The selected Docker context points to a remote endpoint. Select a local socket or Docker Desktop context.',
  connectionFailed: 'Cannot connect to Docker. Check the engine and try again.', image: 'Image', status: 'Status', id: 'Container ID', project: 'Compose project', ports: 'Published ports', noPorts: 'No published TCP ports', portHelp: 'Open an HTTP candidate in the JanusX browser. A published port may use another protocol.',
  standalone: 'Containers', follow: 'Auto scroll', pause: 'Pause scroll', copy: 'Copy', copied: 'Copied', logSearch: 'Search logs', logWaiting: 'Waiting for logs…', truncated: 'Earlier output was trimmed to keep history bounded.', logEnded: 'Log stream ended. Switch away and return to reconnect.',
  openTerminal: 'Open terminal', closeTerminal: 'Close shell', shell: 'Shell', terminalHelp: 'Open a shell inside this container. Closing this panel keeps it connected.', ended: 'Shell ended', notRunning: 'Start the container to open a shell.', back: 'Containers', working: 'Working…', complete: 'Operation completed', failed: 'Some operations failed', groupHelp: 'Controls existing containers; Compose dependency order is not applied.',
  stopped: 'Stopped', engine: 'Engine', connected: 'Connected', clear: 'Dismiss', none: '—', terminalLimit: 'Eight container shells are open. Close one before opening another.', shellMissing: 'The shell exited. Try another shell if this image does not include it.',
}
const zh: typeof en = {
  containers: '容器', local: '本机引擎', all: '全部', running: '运行中', search: '搜索容器', refresh: '刷新', desktop: '打开 Docker Desktop', connect: '连接', retry: '重试',
  overview: '概览', logs: '日志', terminal: '终端', start: '启动', stop: '停止', restart: '重启', startGroup: '启动组', stopGroup: '停止组',
  empty: '暂无容器', emptyHelp: '本机引擎中创建的容器会显示在这里。', noMatch: '没有匹配的容器', select: '选择一个容器', selectHelp: '在这里查看详情、日志和终端。',
  disconnected: '连接本机 Docker', connectHelp: '请确认 Docker 已安装，并且引擎正在运行。', missing: '未找到 Docker CLI。请安装 Docker Desktop，或将 Docker 加入 PATH。', remote: '当前 Docker context 指向远程环境。请选择本机 socket 或 Docker Desktop context。',
  connectionFailed: '无法连接 Docker，请检查引擎后重试。', image: '镜像', status: '状态', id: '容器 ID', project: 'Compose 项目', ports: '已发布端口', noPorts: '没有已发布的 TCP 端口', portHelp: '在 JanusX 浏览器中打开 HTTP 候选地址。已发布端口也可能使用其他协议。',
  standalone: '独立容器', follow: '自动滚动', pause: '暂停滚动', copy: '复制', copied: '已复制', logSearch: '搜索日志', logWaiting: '等待日志…', truncated: '较早的输出已截断，历史记录保留在限额内。', logEnded: '日志流已结束，切换后返回可重新连接。',
  openTerminal: '打开终端', closeTerminal: '关闭 shell', shell: 'Shell', terminalHelp: '在容器内打开 shell，关闭面板后保持连接。', ended: 'Shell 已结束', notRunning: '请先启动容器，再打开 shell。', back: '容器列表', working: '处理中…', complete: '操作已完成', failed: '部分操作失败', groupHelp: '只控制已有容器，不应用 Compose 依赖顺序。',
  stopped: '已停止', engine: '引擎', connected: '已连接', clear: '关闭提示', none: '—', terminalLimit: '已打开 8 个容器 shell，请先关闭一个。', shellMissing: 'Shell 已退出。如果镜像不包含此 shell，请尝试其他选项。',
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
  return message.startsWith('docker-') ? `${t('connectionFailed')} (${message})` : message
}
