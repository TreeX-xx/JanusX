import { localDefaultShell } from '../../platform/local-shell'
import { createHash } from 'node:crypto'
import { app, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  FeishuControlStatus,
  FeishuRemoteProviderConfig,
  RemoteNotificationSettings,
} from '../../../shared/notifications'
import { configService } from '../../config/service'
import {
  CompanionActionTokens,
  CompanionAuditStore,
  CompanionBindingStore,
  CompanionDedupe,
  CompanionGateway,
  MainProcessTerminalControl,
} from '../../companion'
import { createCompanionTerminal, submitCompanionTerminalLine } from '../../ipc/terminal-handlers'
import { listRegisteredWorkspaces, resolveRegisteredWorkspace } from '../../companion/workspace-registry'
import { configureFeishuCardActionTokenIssuer, configureFeishuWorkspaceActionTokenIssuer } from '../providers/feishu-provider'
import { redactErrorText } from '../secret-redaction'
import { FeishuInboundClient } from './client'
import type { FeishuSdkChannelConfig } from './sdk-channel'
import type { FeishuConnectionStatus, FeishuInboundChannel } from './types'

type ChannelFactory = (config: FeishuSdkChannelConfig) => FeishuInboundChannel | Promise<FeishuInboundChannel>

// Keep the SDK out of desktop-only startup. The serialized reconfigure queue
// also owns asynchronous loading, so disabling/shutdown still closes the client.
const createChannelOnDemand: ChannelFactory = async (config) => {
  const { createFeishuSdkChannel } = await import('./sdk-channel')
  return createFeishuSdkChannel(config)
}

export class FeishuInboundRuntime {
  private mainWindow: BrowserWindow | null = null
  private client: FeishuInboundClient | null = null
  private gateway: CompanionGateway | null = null
  private currentConfig: FeishuRemoteProviderConfig | null = null
  private configKey = ''
  private queue = Promise.resolve()
  private status: FeishuConnectionStatus = { state: 'disabled' }
  private statusUpdatedAt = Date.now()
  private controlEnabled = false

  constructor(private readonly channelFactory: ChannelFactory = createChannelOnDemand) {}

  configure(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow
    configureFeishuCardActionTokenIssuer((context, terminalId, action, expiresAt) => (
      this.gateway?.issueActionToken(context, terminalId, action, expiresAt)
    ))
    configureFeishuWorkspaceActionTokenIssuer((context, workspaceId, engine, expiresAt) => (
      this.gateway?.issueWorkspaceActionToken(context, workspaceId, engine, expiresAt)
    ))
  }

  reconfigure(settings?: RemoteNotificationSettings): Promise<void> {
    const operation = this.queue.then(async () => {
      const resolved = settings ?? await configService.getRemoteNotificationSettings()
      const config = resolved.providers.feishu
      this.currentConfig = config
      const enabled = resolved.enabled && config.enabled && config.mode === 'app'
        && config.inboundControlEnabled && Boolean(config.appId.trim() && config.appSecret.trim())
      this.controlEnabled = enabled
      const key = enabled ? fingerprint(config) : ''
      if (!enabled || !this.mainWindow) {
        await this.stopClient()
        this.gateway = null
        this.setStatus('disabled')
        return
      }
      if (this.client && key === this.configKey) return
      await this.stopClient()
      this.configKey = key
      let channel: FeishuInboundChannel | null = null
      let client: FeishuInboundClient | null = null
      try {
        this.gateway = this.createGateway(config)
        channel = await this.channelFactory({ appId: config.appId.trim(), appSecret: config.appSecret.trim() })
        client = new FeishuInboundClient(
          channel,
          this.gateway,
          (status) => this.updateStatus(redactStatus(status, config)),
          config.groupPromptPrefix,
        )
        this.client = client
        await client.start()
      } catch (error) {
        const message = redactError(error, config)
        console.error('[FeishuInbound] connection failed:', message)
        if (client && this.client === client) this.client = null
        this.configKey = ''
        if (client) await client.stop().catch(() => undefined)
        else if (channel) await channel.disconnect().catch(() => undefined)
        this.gateway = null
        this.updateStatus({ state: 'failed', error: message })
      }
    })
    this.queue = operation.catch(() => undefined)
    return operation
  }

  stop(): Promise<void> {
    const operation = this.queue.then(async () => {
      await this.stopClient()
      this.currentConfig = null
      this.gateway = null
      this.controlEnabled = false
      this.setStatus('disabled')
    })
    this.queue = operation.catch(() => undefined)
    return operation
  }

  getStatus(): FeishuConnectionStatus {
    return { ...this.status }
  }

  getControlStatus(): FeishuControlStatus {
    const config = this.currentConfig
    const configured = Boolean(
      config?.appId.trim()
      && config.appSecret.trim()
      && config.receiveId.trim()
      && config.allowedOpenIds.length,
    )
    const error = this.status.error ? redactError(this.status.error, config) : undefined
    return {
      state: publicState(this.status.state),
      enabled: this.controlEnabled,
      configured,
      ...(error ? { error } : {}),
      updatedAt: this.statusUpdatedAt,
    }
  }

  private async stopClient(): Promise<void> {
    const client = this.client
    this.client = null
    this.configKey = ''
    if (client) await client.stop()
  }

  private createGateway(config: FeishuRemoteProviderConfig): CompanionGateway {
    const root = join(app.getPath('userData'), 'janusx', 'companion')
    return new CompanionGateway({
      policy: () => ({
        enabled: Boolean(this.currentConfig?.inboundControlEnabled),
        mode: this.currentConfig?.mode ?? 'webhook',
        allowedOpenIds: this.currentConfig?.allowedOpenIds ?? [],
        maxPromptLength: this.currentConfig?.maxPromptLength,
      }),
      bindings: new CompanionBindingStore(join(root, 'bindings.json')),
      tokens: new CompanionActionTokens(createHash('sha256').update(
        `janusx:${config.appId}:${config.appSecret}`,
      ).digest('hex')),
      dedupe: new CompanionDedupe(join(root, 'dedupe.json')),
      audit: new CompanionAuditStore(
        join(root, 'audit.jsonl'),
        config.auditRetentionDays * 24 * 60 * 60 * 1000,
      ),
      terminals: new MainProcessTerminalControl((id, text) => submitCompanionTerminalLine(id, text)),
      createTerminal: async (workspaceId, engine) => {
        const rootDir = join(app.getPath('userData'), 'janusx', 'workspaces')
        const record = await resolveRegisteredWorkspace(rootDir, workspaceId)
        const workspacePath = record.path
        const terminalId = randomUUID()
        await createCompanionTerminal({
          id: terminalId,
          workspaceId,
          cwd: workspacePath,
          shell: localDefaultShell(),
          preset: engine,
        })
        return terminalId
      },
      listWorkspaces: async () => {
        const rootDir = join(app.getPath('userData'), 'janusx', 'workspaces')
        return listRegisteredWorkspaces(rootDir)
      },
      bindingTtlMs: config.bindingTtlMinutes * 60 * 1000,
    })
  }

  private setStatus(state: FeishuConnectionStatus['state']): void {
    this.updateStatus({ state })
  }

  private updateStatus(status: FeishuConnectionStatus): void {
    this.status = status
    this.statusUpdatedAt = Date.now()
  }
}

function publicState(state: FeishuConnectionStatus['state']): FeishuControlStatus['state'] {
  if (state === 'connected') return 'connected'
  if (state === 'connecting' || state === 'reconnecting') return 'connecting'
  if (state === 'failed') return 'error'
  return 'disabled'
}

function fingerprint(config: FeishuRemoteProviderConfig): string {
  return createHash('sha256').update(JSON.stringify({
    appId: config.appId.trim(),
    appSecret: config.appSecret,
    allowedOpenIds: [...config.allowedOpenIds].sort(),
    bindingTtlMinutes: config.bindingTtlMinutes,
    actionTokenTtlMinutes: config.actionTokenTtlMinutes,
    auditRetentionDays: config.auditRetentionDays,
    maxPromptLength: config.maxPromptLength,
    groupPromptPrefix: config.groupPromptPrefix,
  })).digest('hex')
}

function redactError(error: unknown, config: FeishuRemoteProviderConfig | null): string {
  return redactErrorText(error, [config?.appSecret, config?.appId], 200)
}

function redactStatus(
  status: FeishuConnectionStatus,
  config: FeishuRemoteProviderConfig,
): FeishuConnectionStatus {
  return status.error ? { ...status, error: redactError(status.error, config) } : status
}

export const feishuInboundRuntime = new FeishuInboundRuntime()
