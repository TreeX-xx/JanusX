/**
 * 外部 CLI 工具的版本检测、安装与模型投影契约。
 * 主进程与渲染进程共享：通道名、结果类型、工具元数据，以及两端对称的 semver 比较。
 */
export const EXTERNAL_CLI_CHANNELS = {
  detect: 'external-cli:detect',
  latest: 'external-cli:latest',
  install: 'external-cli:install',
  applyProvider: 'external-cli:provider:apply',
  syncState: 'external-cli:sync-state',
  rollbackProfile: 'external-cli:profile:rollback',
  terminalRead: 'external-cli:terminal:read',
  terminalApply: 'external-cli:terminal:apply',
  terminalRollback: 'external-cli:terminal:rollback',
} as const

export type ExternalCliChannel = (typeof EXTERNAL_CLI_CHANNELS)[keyof typeof EXTERNAL_CLI_CHANNELS]

/** 受管外部终端白名单；与 JanusX 终端预设的外部 CLI 对齐（claude/codex/opencode/pi 为第三方，janus 为自有 sibling 源码构建） */
export type ExternalCliToolId = 'claude' | 'codex' | 'opencode' | 'pi' | 'janus' | 'dsh'

export const EXTERNAL_CLI_TOOL_ORDER: readonly ExternalCliToolId[] = ['janus', 'claude', 'codex', 'opencode', 'pi', 'dsh']

/** 两端共享的展示元数据：首字母徽标＋品牌色，不引入二进制图标资产。 */
export interface ExternalCliToolMeta {
  id: ExternalCliToolId
  displayName: string
  monogram: string
  color: string
}

export const EXTERNAL_CLI_TOOL_META: Record<ExternalCliToolId, ExternalCliToolMeta> = {
  claude: { id: 'claude', displayName: 'Claude Code', monogram: 'C', color: '#d97757' },
  codex: { id: 'codex', displayName: 'Codex', monogram: 'X', color: '#6e6e6e' },
  opencode: { id: 'opencode', displayName: 'OpenCode', monogram: 'O', color: '#8b8b8b' },
  pi: { id: 'pi', displayName: 'Pi Agent', monogram: 'P', color: '#7aa2f7' },
  janus: { id: 'janus', displayName: 'Janus', monogram: 'J', color: '#9ece6a' },
  dsh: { id: 'dsh', displayName: 'DeepSeek Harness', monogram: 'D', color: '#4D6BFE' },
}

export type ExternalCliBinarySource = 'path' | 'known-location'

export interface ExternalCliDetectResult {
  toolId: ExternalCliToolId
  /** false = 未安装；true 但 runnable=false = 装了但跑不起来（与 external-cli installed_but_broken 同义）。 */
  installed: boolean
  runnable: boolean
  version?: string
  path?: string
  source?: ExternalCliBinarySource
  /** 未安装时给出可复制的手动安装命令；跑不起来时给出诊断摘要。 */
  hint?: string
  existingTerminalNotice?: string
}

export interface ExternalCliLatestResult {
  toolId: ExternalCliToolId
  /** 查不到（离线/超时/注册表异常）时为 undefined，调用方展示 unknown 且不阻塞卡片。 */
  latestVersion?: string
  /** OpenCode uses separate npm packages for its two maintained release lines. */
  versions?: Partial<Record<OpenCodeChannel, string>>
}

export type OpenCodeChannel = 'v1' | 'v2'

export interface ExternalCliInstallOptions {
  channel: OpenCodeChannel
  /** Exact version shown in Settings; the host validates the release line. */
  version: string
}

export function openCodeChannel(version: string | undefined): OpenCodeChannel | undefined {
  const major = version?.match(/^([12])\.\d+\.\d+(?:-[\da-zA-Z.-]+)?(?:\+[\da-zA-Z.-]+)?$/)?.[1]
  return major === '1' ? 'v1' : major === '2' ? 'v2' : undefined
}

export function isExternalCliInstallOptions(value: unknown): value is ExternalCliInstallOptions {
  if (!value || typeof value !== 'object') return false
  const { channel, version } = value as Record<string, unknown>
  return (channel === 'v1' || channel === 'v2') && typeof version === 'string' &&
    /^\d+\.\d+\.\d+$/.test(version) && openCodeChannel(version) === channel
}

export interface ExternalCliInstallResult {
  toolId: ExternalCliToolId
  success: boolean
  /** 成功时为安装后重探到的版本号。 */
  version?: string
  /** 实际执行的命令（回显用，执行侧重算，绝不信任渲染端回传）。 */
  command?: string
  error?: string
}

export interface ExternalCliAPI {
  detect(toolId: ExternalCliToolId): Promise<ExternalCliDetectResult>
  latest(toolId: ExternalCliToolId): Promise<ExternalCliLatestResult>
  install(toolId: ExternalCliToolId, options?: ExternalCliInstallOptions): Promise<ExternalCliInstallResult>
  applyProvider(request: ExternalCliApplyProviderRequest): Promise<ExternalCliApplyResult>
  syncState(): Promise<ExternalCliSyncState>
  rollbackProfile(): Promise<ExternalCliRollbackResult>
  readTerminalModel(toolId: ExternalCliToolId): Promise<TerminalModelState>
  applyTerminalModel(request: TerminalApplyModelRequest): Promise<TerminalApplyModelResult>
  rollbackTerminal(toolId: ExternalCliToolId): Promise<TerminalRollbackResult>
}

/** 精简 projector 仅管理各终端拥有的 model 键；janus 为内部绑定，无外部文件。 */
export type TerminalModelToolId = 'codex' | 'opencode' | 'pi'

export interface TerminalModelState {
  toolId: ExternalCliToolId
  /** JanusX 实际读写的文件；opencode 优先沿用已存在的同名文件。 */
  configPath: string | null
  exists: boolean
  model?: string
  error?: string
}

export interface TerminalApplyModelRequest {
  toolId: ExternalCliToolId
  model: string
}

export interface TerminalApplyModelResult {
  success: boolean
  backupPath?: string | null
  error?: string
}

export interface TerminalRollbackResult {
  success: boolean
  backupPath?: string
  error?: string
}

/** 同步凭证输入：调用方只给三元组，绝不经过画像存储。 */
export interface ExternalCliApplyInput {
  baseURL: string
  authToken: string
  model?: string
}

export interface ExternalCliApplyResult {
  success: boolean
  providerName?: string
  backupPath?: string | null
  /** 'NO_LLM_PROVIDER' 由渲染端映射为本地化文案，其余为原文透出。 */
  error?: string
}

export interface ExternalCliApplyProviderRequest {
  toolId: ExternalCliToolId
  /** null 表示沿用 LLM 引擎默认配置。 */
  providerId: string | null
}

export interface ClaudeSyncRecordState {
  providerId: string
  providerName: string
  baseURL: string
  model?: string
  syncedAt: number
  backupPath: string | null
}

export interface ExternalCliSyncState {
  claude: ClaudeSyncRecordState | null
}

export interface ExternalCliRollbackResult {
  success: boolean
  backupPath?: string
  error?: string
}

interface ParsedCliVersion {
  core: number[]
  prerelease: string[]
}

function parseCliVersion(version: string): ParsedCliVersion | undefined {
  const match = version.trim().match(/^(\d+(?:\.\d+){0,2})(?:-([\w.]+))?/)
  if (!match) return undefined
  return {
    core: match[1].split('.').map(Number),
    prerelease: match[2] ? match[2].split('.') : [],
  }
}

/**
 * 两端对称的 semver 比较：>0 表示 a 更新，<0 表示 b 更新，0 表示相等或不可比。
 * 正式版高于预发布版；预发布标识中纯数字段按数值比，其余按字典序。
 */
export function compareCliVersions(a: string, b: string): number {
  const parsedA = parseCliVersion(a)
  const parsedB = parseCliVersion(b)
  if (!parsedA || !parsedB) return 0
  for (let index = 0; index < Math.max(parsedA.core.length, parsedB.core.length); index += 1) {
    const diff = (parsedA.core[index] ?? 0) - (parsedB.core[index] ?? 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  if (parsedA.prerelease.length === 0 && parsedB.prerelease.length === 0) return 0
  if (parsedA.prerelease.length === 0) return 1
  if (parsedB.prerelease.length === 0) return -1
  for (let index = 0; index < Math.max(parsedA.prerelease.length, parsedB.prerelease.length); index += 1) {
    const idA = parsedA.prerelease[index]
    const idB = parsedB.prerelease[index]
    if (idA === undefined) return -1
    if (idB === undefined) return 1
    if (idA === idB) continue
    const numA = /^\d+$/.test(idA) ? Number(idA) : undefined
    const numB = /^\d+$/.test(idB) ? Number(idB) : undefined
    if (numA !== undefined && numB !== undefined) return numA > numB ? 1 : -1
    if (numA !== undefined) return -1
    if (numB !== undefined) return 1
    return idA > idB ? 1 : -1
  }
  return 0
}

/** 仅 latest 严格大于 current 才提示升级；相等、落后或不可解析一律不打扰。 */
export function isCliUpdateAvailable(current: string | undefined, latest: string | undefined): boolean {
  if (!current || !latest) return false
  return compareCliVersions(latest, current) > 0
}
