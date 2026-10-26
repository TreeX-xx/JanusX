import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { EXTERNAL_CLI_CHANNELS, isExternalCliInstallOptions, type ExternalCliApplyProviderRequest, type ExternalCliToolId, type TerminalApplyModelRequest } from '../../shared/ipc/external-cli'
import { getExternalCliTool } from '../external-cli/tool-registry'
import { externalCliService, type ExternalCliService } from '../external-cli/service'

export interface RegisterExternalCliHandlersOptions {
  getAllowedWindows: () => readonly BrowserWindow[]
  service?: ExternalCliService
}

function isAuthorizedSender(event: IpcMainInvokeEvent, getAllowedWindows: () => readonly BrowserWindow[]): boolean {
  return getAllowedWindows().some(
    (window) =>
      !window.isDestroyed() &&
      !window.webContents.isDestroyed() &&
      event.sender === window.webContents,
  )
}

function isSupportedToolId(value: unknown): value is ExternalCliToolId {
  return typeof value === 'string' && getExternalCliTool(value) !== undefined
}

function isApplyProviderRequest(value: unknown): value is ExternalCliApplyProviderRequest {
  if (typeof value !== 'object' || value === null) return false
  const request = value as Record<string, unknown>
  return isSupportedToolId(request.toolId) &&
    (request.providerId === null || typeof request.providerId === 'string')
}

function isApplyModelRequest(value: unknown): value is TerminalApplyModelRequest {
  if (typeof value !== 'object' || value === null) return false
  const request = value as Record<string, unknown>
  return isSupportedToolId(request.toolId) && typeof request.model === 'string'
}

export function registerExternalCliHandlers(options: RegisterExternalCliHandlersOptions): () => void {
  const service = options.service ?? externalCliService
  const channels = [
    EXTERNAL_CLI_CHANNELS.detect,
    EXTERNAL_CLI_CHANNELS.latest,
    EXTERNAL_CLI_CHANNELS.install,
    EXTERNAL_CLI_CHANNELS.applyProvider,
    EXTERNAL_CLI_CHANNELS.syncState,
    EXTERNAL_CLI_CHANNELS.rollbackProfile,
    EXTERNAL_CLI_CHANNELS.terminalRead,
    EXTERNAL_CLI_CHANNELS.terminalApply,
    EXTERNAL_CLI_CHANNELS.terminalRollback,
  ] as const

  for (const channel of channels) {
    ipcMain.handle(channel, async (event, payload: unknown) => {
      const fallbackTool: ExternalCliToolId = 'claude'
      if (!isAuthorizedSender(event, options.getAllowedWindows)) {
        if (channel === EXTERNAL_CLI_CHANNELS.latest) return { toolId: fallbackTool }
        if (channel === EXTERNAL_CLI_CHANNELS.syncState) return { claude: null }
        if (channel === EXTERNAL_CLI_CHANNELS.rollbackProfile) return { success: false, error: 'Unauthorized' }
        if (channel === EXTERNAL_CLI_CHANNELS.terminalRead) {
          return { toolId: fallbackTool, configPath: null, exists: false, error: 'Unauthorized' }
        }
        if (channel === EXTERNAL_CLI_CHANNELS.terminalApply || channel === EXTERNAL_CLI_CHANNELS.terminalRollback) {
          return { success: false, error: 'Unauthorized' }
        }
        return { toolId: fallbackTool, success: false, error: 'Unauthorized' }
      }
      try {
        if (channel === EXTERNAL_CLI_CHANNELS.latest) {
          if (!isSupportedToolId(payload)) return { toolId: fallbackTool }
          return service.latest(payload)
        }
        if (channel === EXTERNAL_CLI_CHANNELS.install && typeof payload === 'object' && payload !== null) {
          const request = payload as Record<string, unknown>
          if (request.toolId !== 'opencode' || !isExternalCliInstallOptions(request)) {
            return { toolId: fallbackTool, success: false, error: 'Invalid install request.' }
          }
          return await service.install('opencode', { channel: request.channel, version: request.version })
        }
        if (channel === EXTERNAL_CLI_CHANNELS.syncState) return service.syncState()
        if (channel === EXTERNAL_CLI_CHANNELS.rollbackProfile) return service.rollbackProfile()
        if (channel === EXTERNAL_CLI_CHANNELS.applyProvider) {
          if (!isApplyProviderRequest(payload)) return { success: false, error: 'Invalid request.' }
          return service.applyProvider(payload.toolId, payload.providerId)
        }
        if (channel === EXTERNAL_CLI_CHANNELS.terminalRead) {
          if (!isSupportedToolId(payload)) {
            return { toolId: fallbackTool, configPath: null, exists: false, error: 'Unsupported tool.' }
          }
          return service.readTerminalModel(payload)
        }
        if (channel === EXTERNAL_CLI_CHANNELS.terminalApply) {
          if (!isApplyModelRequest(payload)) return { success: false, error: 'Invalid request.' }
          return service.applyTerminalModel(payload)
        }
        if (channel === EXTERNAL_CLI_CHANNELS.terminalRollback) {
          if (!isSupportedToolId(payload)) return { success: false, error: 'Unsupported tool.' }
          return service.rollbackTerminal(payload)
        }
        if (!isSupportedToolId(payload)) return { toolId: fallbackTool, success: false, error: 'Unsupported tool.' }
        if (channel === EXTERNAL_CLI_CHANNELS.detect) return service.detect(payload)
        return service.install(payload)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (channel === EXTERNAL_CLI_CHANNELS.latest) return { toolId: fallbackTool }
        if (channel === EXTERNAL_CLI_CHANNELS.syncState) return { claude: null }
        if (channel === EXTERNAL_CLI_CHANNELS.detect) {
          return { toolId: isSupportedToolId(payload) ? payload : fallbackTool, installed: false, runnable: false, hint: message }
        }
        if (channel === EXTERNAL_CLI_CHANNELS.terminalRead) {
          return { toolId: isSupportedToolId(payload) ? payload : fallbackTool, configPath: null, exists: false, error: message }
        }
        if (
          channel === EXTERNAL_CLI_CHANNELS.rollbackProfile ||
          channel === EXTERNAL_CLI_CHANNELS.applyProvider ||
          channel === EXTERNAL_CLI_CHANNELS.terminalApply ||
          channel === EXTERNAL_CLI_CHANNELS.terminalRollback
        ) {
          return { success: false, error: message }
        }
        return { toolId: isSupportedToolId(payload) ? payload : fallbackTool, success: false, error: message }
      }
    })
  }

  return () => channels.forEach((channel) => ipcMain.removeHandler(channel))
}
