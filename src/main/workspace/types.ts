import type { AgentNotificationSettings } from '../../shared/notifications'
import type { WorkspaceRuntime } from '../../shared/workspace-runtime'
import type { KnowledgeSettings } from '../../shared/knowledge-settings'
import type { UpdaterSettings } from '../../shared/ipc/updater'
import type { AgentApprovalMode } from '../../shared/ipc/agent-runtime'
import type { ExperimentalFeatures } from '../../shared/ipc/experimental'
import type { AppTheme } from '../../shared/ipc/theme'
import type { ShellProfilesSettings } from '../../shared/shellProfiles'

export interface Workspace {
  id: string
  name: string
  path: string
  runtime?: WorkspaceRuntime
  clis: CLIConfig[]
  layout: LayoutConfig
  lastTerminalType?: string
  createdAt: string
  updatedAt: string
}

export interface CLIConfig {
  id: string
  type: string
  command: string
  args: string[]
  env: Record<string, string>
}

export interface LayoutConfig {
  mode: 'grid' | 'tabs'
  positions: LayoutPosition[]
}

export interface LayoutPosition {
  id: string
  x: number
  y: number
  w: number
  h: number
}

export interface CreateWorkspaceDto {
  name: string
  path: string
}

export interface UpdateWorkspaceDto {
  name?: string
  path?: string
  clis?: CLIConfig[]
  layout?: LayoutConfig
  lastTerminalType?: string
}

export interface GlobalConfig {
  cpaSettings?: unknown // Only read by the official CPA plugin's one-time legacy migration.
  theme: AppTheme
  /** 历史石板色迁移标记，仅兼容旧配置；不再用于改写用户主题。 */
  themeMigratedToSlate?: boolean
  language?: string
  defaultTerminalPreset: string
  defaultShell: string
  /** 用户自建 shell 条目与 CLI 预设显隐；缺席即默认种子（兼容旧配置）。 */
  shellProfiles?: ShellProfilesSettings
  registeredCLIs: CLIRegistration[]
  recentWorkspaces: string[]
  notificationSettings: AgentNotificationSettings
  personalMemorySettings?: import('../../shared/personal-memory-settings').PersonalMemorySettings
  knowledgeSettings: KnowledgeSettings
  /** 自动更新偏好；缺席即默认（自动检查开启），兼容旧配置。 */
  updaterSettings?: UpdaterSettings
  agentApprovalMode: AgentApprovalMode
  /** P6：janus-chat 循环步数（默认 40，上限 100；缺席即默认，兼容旧配置）。 */
  agentMaxSteps?: number
  /** R2：安全编译自动放行总开关（默认 true；false 则安全编译命令也走逐次审批）。 */
  safeCompileAutoAllow?: boolean
  /** 创新实验功能三路开关（知识库/圆桌/个人画像）；缺席即默认全关，兼容旧配置。 */
  experimentalFeatures?: ExperimentalFeatures
}

export interface CLIRegistration {
  id: string
  name: string
  command: string
  args: string[]
  description: string
}
