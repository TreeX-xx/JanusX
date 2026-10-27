/** Win P0 自动更新 IPC 契约：nsis 安装版经 GitHub Releases 拉取，其余形态降级提示。 */
export const UPDATER_CHANNELS = {
  getState: 'updater:get-state',
  check: 'updater:check',
  download: 'updater:download',
  install: 'updater:install',
  getSettings: 'updater:get-settings',
  updateSettings: 'updater:update-settings',
  openReleases: 'updater:open-releases',
  openRepository: 'updater:open-repository',
} as const

// Note: unsupported runtimes open the designed download page, not raw Releases — see .agents/notes/desktop/app-auto-update-win.md
/** 单一来源：便携版/开发版手动下载入口，main 与 fallback 共用。 */
export const UPDATER_RELEASES_URL = 'https://treex-xx.github.io/JanusX/#downloads'
export const APP_REPOSITORY_URL = 'https://github.com/TreeX-xx/JanusX'

export const UPDATER_EVENT_CHANNELS = {
  event: 'updater:event',
} as const

export type UpdaterUnsupportedReason = 'non-windows-p0' | 'dev-mode' | 'portable' | null

export type UpdaterPhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'up-to-date'
  | 'error'
  | 'unsupported'

export interface UpdaterState {
  phase: UpdaterPhase
  supported: boolean
  unsupportedReason: UpdaterUnsupportedReason
  currentVersion: string
  availableVersion: string | null
  downloadPercent: number | null
  /** 去标签纯文本的新版说明；无正文为 null。 */
  releaseNotes: string | null
  error: string | null
}

/** 完整快照让后台事件与首次读取保持相同的版本、说明和安装状态。 */
export interface UpdaterEvent {
  type: 'state'
  state: UpdaterState
}

export interface UpdaterAPI {
  getState(): Promise<UpdaterState>
  check(): Promise<UpdaterState>
  download(): Promise<UpdaterState>
  install(): Promise<{ ok: boolean; error?: string }>
  onEvent(callback: (event: UpdaterEvent) => void): () => void
  getSettings(): Promise<UpdaterSettings>
  updateSettings(settings: Partial<UpdaterSettings>): Promise<UpdaterSettings>
  /** 固定下载页，主进程 shell 打开，不接受外部输入。 */
  openReleases(): Promise<void>
  /** 关于页的固定项目仓库入口，不接受渲染端 URL。 */
  openRepository(): Promise<void>
}

export interface UpdaterSettings {
  /** 启动延迟首检 + 6h 轮询；关闭后仅保留手动检查。默认 true。 */
  autoCheck: boolean
}

export const DEFAULT_UPDATER_SETTINGS: UpdaterSettings = {
  autoCheck: true,
}

export function normalizeUpdaterSettings(value: unknown): UpdaterSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_UPDATER_SETTINGS }
  const autoCheck = (value as { autoCheck?: unknown }).autoCheck
  return { autoCheck: autoCheck === undefined ? DEFAULT_UPDATER_SETTINGS.autoCheck : autoCheck === true }
}

const RELEASE_NOTES_LIMIT = 600

function stripReleaseHtml(input: string): string {
  return input
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * electron-updater 的 releaseNotes 可能是 HTML 字符串或分版本数组；
 * 统一成去标签纯文本，超长截断，无正文返回 null。
 */
export function formatReleaseNotes(value: unknown): string | null {
  if (typeof value === 'string') {
    const text = stripReleaseHtml(value)
    return text ? truncate(text) : null
  }
  if (Array.isArray(value)) {
    const parts: string[] = []
    for (const entry of value) {
      if (!entry || typeof entry !== 'object') continue
      const { version, note } = entry as { version?: unknown; note?: unknown }
      if (typeof note !== 'string') continue
      const text = stripReleaseHtml(note)
      if (!text) continue
      parts.push(typeof version === 'string' && version ? `v${version} ${text}` : text)
    }
    if (parts.length === 0) return null
    return truncate(parts.join('\n'))
  }
  return null
}

function truncate(text: string): string {
  return text.length > RELEASE_NOTES_LIMIT ? `${text.slice(0, RELEASE_NOTES_LIMIT)}…` : text
}
