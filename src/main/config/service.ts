import { app } from 'electron'
import { join } from 'node:path'
import { readFile, rename } from 'node:fs/promises'
import { SerialQueue, writeFileAtomic } from '../lib/atomic-file'
import type { GlobalConfig } from '../workspace/types'
import {
  DEFAULT_AGENT_NOTIFICATION_SETTINGS,
  normalizeAgentNotificationSettings,
  normalizeRemoteNotificationSettings,
  isValidFeishuGroupPrefix,
  validateFeishuControlConfig,
  type AgentNotificationSettings,
  type RemoteNotificationSettings,
} from '../../shared/notifications'
import {
  DEFAULT_KNOWLEDGE_SETTINGS,
  normalizeKnowledgeSettings,
  type KnowledgeSettings,
} from '../../shared/knowledge-settings'
import {
  normalizeUpdaterSettings,
  type UpdaterSettings,
} from '../../shared/ipc/updater'
import {
  normalizeExperimentalFeatures,
  type ExperimentalFeatures,
} from '../../shared/ipc/experimental'
import { normalizeAgentApprovalMode, type AgentApprovalMode } from '../../shared/ipc/agent-runtime'
import { DEFAULT_APP_THEME, normalizeAppTheme, type AppTheme } from '../../shared/ipc/theme'
import {
  createShellProfileSeed,
  DEFAULT_HIDDEN_CLI_PRESETS,
  normalizeShellProfiles,
  type ShellProfilesSettings,
} from '../../shared/shellProfiles'

/** P6：janus-chat 循环步数默认 40（P6 前为硬编码 20），钳制 1~100。 */
export const DEFAULT_AGENT_MAX_STEPS = 40
export const MAX_AGENT_MAX_STEPS = 100

export function normalizeAgentMaxSteps(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return DEFAULT_AGENT_MAX_STEPS
  return Math.min(MAX_AGENT_MAX_STEPS, Math.max(1, Math.floor(parsed)))
}

/** R2：安全编译自动放行总开关；缺席/非法一律默认 true（保持 P5 已落地行为）。 */
export const DEFAULT_SAFE_COMPILE_AUTO_ALLOW = true

export function normalizeSafeCompileAutoAllow(value: unknown): boolean {
  return value === undefined ? DEFAULT_SAFE_COMPILE_AUTO_ALLOW : value === true
}

const DEFAULT_CONFIG: GlobalConfig = {
  theme: DEFAULT_APP_THEME,
  defaultTerminalPreset: 'shell',
  defaultShell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash',
  // 首版种子：全新用户只预置 PowerShell 一条默认项，其余 shell 经检测候选区确认。
  shellProfiles: {
    entries: [createShellProfileSeed(process.platform)],
    hiddenCliPresets: [...DEFAULT_HIDDEN_CLI_PRESETS],
  },
  registeredCLIs: [
    {
      id: 'claude-code',
      name: 'Claude Code',
      command: 'claude',
      args: [],
      description: 'Anthropic Claude Code CLI',
    },
    {
      id: 'codex',
      name: 'Codex',
      command: 'codex',
      args: [],
      description: 'OpenAI Codex CLI',
    },
  ],
  recentWorkspaces: [],
  notificationSettings: DEFAULT_AGENT_NOTIFICATION_SETTINGS,
  knowledgeSettings: DEFAULT_KNOWLEDGE_SETTINGS,
  agentApprovalMode: 'per-action',
}

export class ConfigService {
  private configPathValue: string | null = null
  private config: GlobalConfig | null = null
  private writeQueue = new SerialQueue()

  private get configPath(): string {
    // 延迟解析 userData，避免模块导入期（单测 mock electron 前）即触碰 app。
    if (!this.configPathValue) {
      this.configPathValue = join(app.getPath('userData'), 'janusx', 'config.json')
    }
    return this.configPathValue
  }

  async load(): Promise<GlobalConfig> {
    try {
      const data = await readFile(this.configPath, 'utf-8')
      const parsed = JSON.parse(data) as Partial<GlobalConfig>
      this.config = {
        ...DEFAULT_CONFIG,
        ...parsed,
        theme: normalizeAppTheme(parsed.theme),
        notificationSettings: normalizeAgentNotificationSettings(parsed.notificationSettings),
        knowledgeSettings: normalizeKnowledgeSettings(parsed.knowledgeSettings),
        updaterSettings: normalizeUpdaterSettings(parsed.updaterSettings),
        agentApprovalMode: normalizeAgentApprovalMode(parsed.agentApprovalMode),
        agentMaxSteps: normalizeAgentMaxSteps(parsed.agentMaxSteps),
        safeCompileAutoAllow: normalizeSafeCompileAutoAllow(parsed.safeCompileAutoAllow),
        experimentalFeatures: normalizeExperimentalFeatures(parsed.experimentalFeatures),
        // 缺席（旧配置）时沿用 DEFAULT_CONFIG 的 PowerShell 种子，不写空列表。
        shellProfiles: parsed.shellProfiles
          ? normalizeShellProfiles(parsed.shellProfiles)
          : DEFAULT_CONFIG.shellProfiles,
      }
    } catch (error) {
      // 解析失败（文件存在但损坏）时先备份，避免默认配置覆盖后用户数据无法恢复
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        await this.backupCorruptFile()
      }
      this.config = { ...DEFAULT_CONFIG }
      await this.persist()
    }
    return this.config!
  }

  private async backupCorruptFile(): Promise<void> {
    try {
      await rename(this.configPath, `${this.configPath}.corrupt-${Date.now()}`)
    } catch {
      /* 备份失败不阻塞启动 */
    }
  }

  async save(): Promise<void> {
    await this.writeQueue.run(() => this.persist())
  }

  private async persist(): Promise<void> {
    if (!this.config) return
    await writeFileAtomic(this.configPath, JSON.stringify(this.config, null, 2))
  }

  async get(): Promise<GlobalConfig> {
    if (!this.config) {
      this.config = await this.load()
    }
    return this.config
  }

  async update(partial: Partial<GlobalConfig>): Promise<GlobalConfig> {
    // merge 与写盘同队列执行，防止并发 update 交错丢字段
    return this.writeQueue.run(async () => {
      const current = await this.get()
      this.config = { ...current, ...partial }
      if (partial.theme !== undefined) {
        this.config.theme = normalizeAppTheme(partial.theme)
      }
      if (partial.notificationSettings) {
        this.config.notificationSettings = normalizeAgentNotificationSettings({
          ...current.notificationSettings,
          ...partial.notificationSettings,
        })
      }
      if (partial.knowledgeSettings) {
        this.config.knowledgeSettings = normalizeKnowledgeSettings({
          ...current.knowledgeSettings,
          ...partial.knowledgeSettings,
        })
      }
      if (partial.agentApprovalMode !== undefined) {
        this.config.agentApprovalMode = normalizeAgentApprovalMode(partial.agentApprovalMode)
      }
      await this.persist()
      return this.config
    })
  }

  async getNotificationSettings(): Promise<AgentNotificationSettings> {
    const config = await this.get()
    return normalizeAgentNotificationSettings(config.notificationSettings)
  }

  async updateNotificationSettings(
    partial: Partial<AgentNotificationSettings>,
  ): Promise<AgentNotificationSettings> {
    const current = await this.getNotificationSettings()
    const requestedSecret = partial.remote?.providers?.feishu?.appSecret
    const requestedFeishu = partial.remote?.providers?.feishu
    if (
      requestedFeishu?.groupPromptPrefix !== undefined
      && !isValidFeishuGroupPrefix(requestedFeishu.groupPromptPrefix)
    ) throw new Error('Group prompt prefix must be a non-reserved /name value')

    const notificationSettings = normalizeAgentNotificationSettings({
      ...current,
      ...partial,
      remote: normalizeRemoteNotificationSettings({
        ...current.remote,
        ...partial.remote,
        providers: {
          ...current.remote.providers,
          ...partial.remote?.providers,
          feishu: {
            ...current.remote.providers.feishu,
            ...partial.remote?.providers?.feishu,
            appSecret: requestedSecret?.trim()
              ? requestedSecret
              : current.remote.providers.feishu.appSecret,
          },
        },
      }),
    })
    const feishu = notificationSettings.remote.providers.feishu
    if (
      requestedFeishu?.enabled === false
      || requestedFeishu?.mode === 'webhook'
      || (Array.isArray(requestedFeishu?.allowedOpenIds) && feishu.allowedOpenIds.length === 0
        && current.remote.providers.feishu.inboundControlEnabled)
    ) feishu.inboundControlEnabled = false
    const validationError = validateFeishuControlConfig(feishu)
    if (validationError) throw new Error(validationError)
    await this.update({ notificationSettings })
    return notificationSettings
  }

  async getRemoteNotificationSettings(): Promise<RemoteNotificationSettings> {
    const settings = await this.getNotificationSettings()
    return normalizeRemoteNotificationSettings(settings.remote)
  }

  async getPersonalMemorySettings() {
    const { normalizePersonalMemorySettings } = await import('../../shared/personal-memory-settings')
    return normalizePersonalMemorySettings((await this.get()).personalMemorySettings)
  }

  async updatePersonalMemorySettings(partial: Partial<import('../../shared/personal-memory-settings').PersonalMemorySettings>) {
    const { normalizePersonalMemorySettings } = await import('../../shared/personal-memory-settings')
    return this.writeQueue.run(async () => {
      const current = await this.get()
      const personalMemorySettings = normalizePersonalMemorySettings({ ...current.personalMemorySettings, ...partial })
      this.config = { ...current, personalMemorySettings }
      await this.persist()
      return personalMemorySettings
    })
  }

  async getKnowledgeSettings(): Promise<KnowledgeSettings> {
    const config = await this.get()
    return normalizeKnowledgeSettings(config.knowledgeSettings)
  }

  async updateKnowledgeSettings(partial: Partial<KnowledgeSettings>): Promise<KnowledgeSettings> {
    const current = await this.getKnowledgeSettings()
    const knowledgeSettings = normalizeKnowledgeSettings({
      ...current,
      ...partial,
    })
    if (knowledgeSettings.automation?.enabled && !knowledgeSettings.automation.enabledSince) {
      knowledgeSettings.automation.enabledSince = new Date().toISOString()
    }
    await this.update({ knowledgeSettings })
    return knowledgeSettings
  }

  async getUpdaterSettings(): Promise<UpdaterSettings> {
    const config = await this.get()
    return normalizeUpdaterSettings(config.updaterSettings)
  }

  async updateUpdaterSettings(partial: Partial<UpdaterSettings>): Promise<UpdaterSettings> {
    const current = await this.getUpdaterSettings()
    const updaterSettings = normalizeUpdaterSettings({
      ...current,
      ...partial,
    })
    await this.update({ updaterSettings })
    return updaterSettings
  }

  async getAgentApprovalMode(): Promise<AgentApprovalMode> {
    return normalizeAgentApprovalMode((await this.get()).agentApprovalMode)
  }

  async updateAgentApprovalMode(mode: unknown): Promise<AgentApprovalMode> {
    const normalized = normalizeAgentApprovalMode(mode)
    await this.update({ agentApprovalMode: normalized })
    return normalized
  }

  async getAgentMaxSteps(): Promise<number> {
    return normalizeAgentMaxSteps((await this.get()).agentMaxSteps)
  }

  async updateAgentMaxSteps(value: unknown): Promise<number> {
    const normalized = normalizeAgentMaxSteps(value)
    await this.update({ agentMaxSteps: normalized })
    return normalized
  }

  async getSafeCompileAutoAllow(): Promise<boolean> {
    return normalizeSafeCompileAutoAllow((await this.get()).safeCompileAutoAllow)
  }

  async updateSafeCompileAutoAllow(value: unknown): Promise<boolean> {
    const normalized = normalizeSafeCompileAutoAllow(value)
    await this.update({ safeCompileAutoAllow: normalized })
    return normalized
  }

  async getExperimentalFeatures(): Promise<ExperimentalFeatures> {
    const config = await this.get()
    return normalizeExperimentalFeatures(config.experimentalFeatures)
  }

  async updateExperimentalFeatures(partial: Partial<ExperimentalFeatures>): Promise<ExperimentalFeatures> {
    const current = await this.getExperimentalFeatures()
    const experimentalFeatures = normalizeExperimentalFeatures({
      ...current,
      ...partial,
    })
    await this.update({ experimentalFeatures })
    return experimentalFeatures
  }

  async addRecentWorkspace(id: string): Promise<void> {
    const config = await this.get()
    const recent = config.recentWorkspaces.filter((r) => r !== id)
    recent.unshift(id)
    if (recent.length > 10) recent.pop()
    await this.update({ recentWorkspaces: recent })
  }

  getRegisteredCLIs(): GlobalConfig['registeredCLIs'] {
    return this.config?.registeredCLIs ?? DEFAULT_CONFIG.registeredCLIs
  }

  /** 同步读缓存（PTY 启动热路径用，不做 IO；未加载时回落种子）。 */
  getShellProfiles(): ShellProfilesSettings {
    return normalizeShellProfiles(this.config?.shellProfiles ?? DEFAULT_CONFIG.shellProfiles)
  }

  async updateShellProfiles(settings: unknown): Promise<ShellProfilesSettings> {
    const normalized = normalizeShellProfiles(settings)
    await this.update({ shellProfiles: normalized })
    return normalized
  }

  /** 同步读缓存主题（PTY OSC 探针热路径用，不做 IO；未加载时回落默认）。 */
  getCachedTheme(): AppTheme {
    return normalizeAppTheme(this.config?.theme)
  }

  async getTheme(): Promise<AppTheme> {
    return normalizeAppTheme((await this.get()).theme)
  }

  async updateTheme(theme: unknown): Promise<AppTheme> {
    const normalized = normalizeAppTheme(theme)
    await this.update({ theme: normalized })
    return normalized
  }

  async getLanguage(): Promise<string | null> {
    const config = await this.get()
    const lang = config.language
    return lang === 'zh-CN' || lang === 'en' ? lang : null
  }

  async setLanguage(lang: string): Promise<void> {
    if (lang !== 'zh-CN' && lang !== 'en') {
      throw new Error(`Unsupported language: ${lang}`)
    }
    await this.update({ language: lang })
  }
}

export const configService = new ConfigService()
