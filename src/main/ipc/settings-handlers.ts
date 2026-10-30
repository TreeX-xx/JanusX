import { BrowserWindow, ipcMain } from 'electron'
import { configService } from '../config/service'
import { remoteNotificationDispatcher } from '../remote-notifications/dispatcher'
import { redactErrorText } from '../remote-notifications/secret-redaction'
import type { KnowledgeSettings } from '../../shared/knowledge-settings'
import { KNOWLEDGE_CHANNELS } from '../../shared/ipc/knowledge'
import {
  normalizeRemoteNotificationSettings,
  toAgentNotificationSettingsView,
  type AgentNotificationSettings,
  type RemoteNotificationSettings,
  type RemoteSendResult,
} from '../../shared/notifications'
import { AGENT_SETTINGS_CHANNELS, NOTIFICATION_SETTINGS_CHANNELS } from '../../shared/ipc/settings'
import { EXPERIMENTAL_CHANNELS, type ExperimentalFeatures } from '../../shared/ipc/experimental'
import { THEME_CHANNELS, type AppTheme } from '../../shared/ipc/theme'

export function registerSettingsHandlers(): void {
  ipcMain.handle(AGENT_SETTINGS_CHANNELS.get, async () => ({
    approvalMode: await configService.getAgentApprovalMode(),
    agentMaxSteps: await configService.getAgentMaxSteps(),
    safeCompileAutoAllow: await configService.getSafeCompileAutoAllow(),
  }))
  ipcMain.handle(AGENT_SETTINGS_CHANNELS.update, async (_event, settings: { approvalMode?: unknown; agentMaxSteps?: unknown; safeCompileAutoAllow?: unknown }) => ({
    approvalMode: settings?.approvalMode === undefined
      ? await configService.getAgentApprovalMode()
      : await configService.updateAgentApprovalMode(settings.approvalMode),
    agentMaxSteps: settings?.agentMaxSteps === undefined
      ? await configService.getAgentMaxSteps()
      : await configService.updateAgentMaxSteps(settings.agentMaxSteps),
    safeCompileAutoAllow: settings?.safeCompileAutoAllow === undefined
      ? await configService.getSafeCompileAutoAllow()
      : await configService.updateSafeCompileAutoAllow(settings.safeCompileAutoAllow),
  }))

  ipcMain.handle(NOTIFICATION_SETTINGS_CHANNELS.get, async () => {
    return toAgentNotificationSettingsView(await configService.getNotificationSettings())
  })

  ipcMain.handle(
    NOTIFICATION_SETTINGS_CHANNELS.update,
    async (_event, settings: Partial<AgentNotificationSettings>) => {
      const updated = await configService.updateNotificationSettings(settings ?? {})
      const { feishuInboundRuntime } = await import('../remote-notifications/feishu-inbound/runtime')
      await feishuInboundRuntime.reconfigure(updated.remote)
      return toAgentNotificationSettingsView(updated)
    },
  )

  ipcMain.handle(
    NOTIFICATION_SETTINGS_CHANNELS.testFeishu,
    async (_event, settings?: RemoteNotificationSettings) => {
      const stored = await configService.getRemoteNotificationSettings()
      const supplied = settings?.providers.feishu
      const resolved = normalizeRemoteNotificationSettings({
        ...stored,
        ...settings,
        providers: {
          feishu: {
            ...stored.providers.feishu,
            ...supplied,
            appSecret: supplied?.appSecret.trim() || stored.providers.feishu.appSecret,
          },
        },
      })
      return sanitizeSendResult(
        await remoteNotificationDispatcher.testFeishu(resolved),
        [resolved.providers.feishu.appSecret, resolved.providers.feishu.appId],
      )
    },
  )

  ipcMain.handle(NOTIFICATION_SETTINGS_CHANNELS.feishuControlStatus, async () => {
    const { feishuInboundRuntime } = await import('../remote-notifications/feishu-inbound/runtime')
    return feishuInboundRuntime.getControlStatus()
  })

  ipcMain.handle(KNOWLEDGE_CHANNELS.getPersonalSettings, () => configService.getPersonalMemorySettings())
  ipcMain.handle(KNOWLEDGE_CHANNELS.updatePersonalSettings, async (_event, settings) => {
    const { z } = await import('zod')
    const input = z.object({ captureConversations: z.boolean().optional(), inferEngineeringHabits: z.boolean().optional(),
      useInChat: z.boolean().optional(), episodeTtlDays: z.number().int().min(30).max(90).optional() }).strict().parse(settings)
    const result = await configService.updatePersonalMemorySettings(input)
    const { settleMemoryMutations } = await import('../knowledge/memory-domain-controls')
    await settleMemoryMutations()
    return result
  })

  ipcMain.handle(KNOWLEDGE_CHANNELS.getSettings, async () => {
    return configService.getKnowledgeSettings()
  })

  ipcMain.handle(
    KNOWLEDGE_CHANNELS.updateSettings,
    async (_event, settings: Partial<KnowledgeSettings>) => {
      const next = await configService.updateKnowledgeSettings(settings ?? {})
      return next
    },
  )

  ipcMain.handle(EXPERIMENTAL_CHANNELS.get, async () => {
    return configService.getExperimentalFeatures()
  })

  ipcMain.handle(
    EXPERIMENTAL_CHANNELS.update,
    async (_event, settings: Partial<ExperimentalFeatures>) => {
      const next = await configService.updateExperimentalFeatures(settings ?? {})
      if (!next.remoteControl) {
        const { stopMobileHost } = await import('../remote/mobile-host')
        await stopMobileHost()
      }
      const { settleMemoryMutations } = await import('../knowledge/memory-domain-controls')
      await settleMemoryMutations()
      return next
    },
  )

  ipcMain.handle(THEME_CHANNELS.get, async () => {
    return configService.getTheme()
  })

  ipcMain.handle(THEME_CHANNELS.update, async (_event, theme: AppTheme) => {
    const normalized = await configService.updateTheme(theme)
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(THEME_CHANNELS.changed, normalized)
    }
    return normalized
  })
}

function sanitizeSendResult(result: RemoteSendResult, secrets: string[]): RemoteSendResult {
  if (!result.reason) return result
  return { ...result, reason: redactErrorText(result.reason, secrets, 300) }
}
