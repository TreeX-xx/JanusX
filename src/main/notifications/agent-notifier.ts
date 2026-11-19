// Note: platform delivery and click routing — see .agents/notes/agent/agent-notifications.md
import { localPlatform } from '../platform/local-platform'
import type { BrowserWindow, Notification } from 'electron'
import * as electron from 'electron'
import type { AgentEvent, AgentSpawnOptions } from '../janus-runner/types'
import {
  DEFAULT_AGENT_NOTIFICATION_SETTINGS,
  normalizeAgentNotificationSettings,
  type AgentNotificationSettings,
} from '../../shared/notifications'
import { desktopToastWindow, type DesktopToastPayload } from './desktop-toast-window'
import { AGENT_CHANNELS } from '../../shared/ipc/janus-runner'

interface AgentNotificationContext {
  sessionId: string
  engine: AgentSpawnOptions['engine']
  startedAt?: string
  endedAt?: string
}

interface AgentNotificationOptions {
  onClick?: () => void
  onDesktopToastShown?: () => void
  onDesktopToastFailure?: (error: string) => void
  terminalId?: string
  workspaceId?: string
}

interface AgentNotificationPayload {
  type: 'completed' | 'failed' | 'attention'
  engine: AgentNotificationContext['engine']
  title: string
  body: string
  terminalId?: string
  workspaceId?: string
}

// Electron can remove a delivered notification when its JS object is collected.
// Keep recent notifications clickable even on systems that omit close events.
const MAX_NATIVE_NOTIFICATIONS = 64
const activeNativeNotifications = new Set<Notification>()

function getElapsedSeconds(startedAt?: string, endedAt?: string): number | null {
  if (!startedAt) return null
  const timestamp = Date.parse(startedAt)
  if (!Number.isFinite(timestamp)) return null
  const endedTimestamp = endedAt ? Date.parse(endedAt) : NaN
  const end = Number.isFinite(endedTimestamp) ? endedTimestamp : Date.now()
  return Math.max(0, Math.floor((end - timestamp) / 1000))
}

function truncateMessage(message: string, maxLength: number): string {
  const clean = message.replace(/\s+/g, ' ').trim()
  if (clean.length <= maxLength) return clean
  return `${clean.slice(0, Math.max(0, maxLength - 3))}...`
}

function focusMainWindow(mainWindow: BrowserWindow, options: AgentNotificationOptions): void {
  if (mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  options.onClick?.()
}

function sendRendererNotification(
  mainWindow: BrowserWindow,
  payload: DesktopToastPayload,
): boolean {
  if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return false

  mainWindow.webContents.send(AGENT_CHANNELS.notification, {
    ...payload,
  })
  return true
}

function sendNativeNotification(
  mainWindow: BrowserWindow,
  payload: DesktopToastPayload,
  options: AgentNotificationOptions,
): boolean {
  const { Notification: NativeNotification } = electron
  let notification: Notification | undefined
  try {
    if (!NativeNotification?.isSupported()) return false
    const notice = new NativeNotification({ title: payload.title, body: payload.body, silent: localPlatform() === 'darwin' })
    notification = notice
    const release = () => { activeNativeNotifications.delete(notice) }
    notice.once('show', () => options.onDesktopToastShown?.())
    notice.once('click', () => {
      release()
      focusMainWindow(mainWindow, options)
    })
    notice.once('close', release)
    notice.once('failed', (_event, error) => {
      release()
      options.onDesktopToastFailure?.(String(error || 'native-notification-failed'))
      sendRendererNotification(mainWindow, payload)
    })
    activeNativeNotifications.add(notice)
    notice.show()
    if (activeNativeNotifications.size > MAX_NATIVE_NOTIFICATIONS) {
      const oldest = activeNativeNotifications.values().next()
      if (!oldest.done) activeNativeNotifications.delete(oldest.value)
    }
    return true
  } catch (error) {
    if (notification) activeNativeNotifications.delete(notification)
    options.onDesktopToastFailure?.(error instanceof Error ? error.message : String(error))
    return false
  }
}

function createNotificationPayload(payload: AgentNotificationPayload): DesktopToastPayload {
  return {
    id: `${payload.type}:${payload.engine}:${Date.now()}`,
    createdAt: new Date().toISOString(),
    ...payload,
  }
}

function showLocalNotification(
  mainWindow: BrowserWindow,
  input: AgentNotificationPayload,
  options: AgentNotificationOptions,
): boolean {
  const payload = createNotificationPayload(input)
  // On macOS a separate BrowserWindow participates in Spaces. Leave display
  // to Notification Center and activate JanusX only on a notification click.
  if (localPlatform() === 'darwin') {
    return sendNativeNotification(mainWindow, payload, options) || sendRendererNotification(mainWindow, payload)
  }

  let desktopShown = false
  let fallbackDelivered: boolean | undefined
  const sendFallback = (): boolean => {
    if (fallbackDelivered !== undefined) return fallbackDelivered
    if (sendNativeNotification(mainWindow, payload, options)) {
      fallbackDelivered = true
      console.warn(`[notifications] using native fallback for ${payload.type}`)
    } else {
      fallbackDelivered = sendRendererNotification(mainWindow, payload)
      if (fallbackDelivered) console.warn(`[notifications] using main-renderer fallback for ${payload.type}`)
    }
    return fallbackDelivered
  }
  const desktopDelivered = desktopToastWindow.show(payload, {
    onClick: () => focusMainWindow(mainWindow, options),
    onShown: () => {
      desktopShown = true
      options.onDesktopToastShown?.()
    },
    onError: (error) => {
      options.onDesktopToastFailure?.(error)
      if (!desktopShown) sendFallback()
    },
  })

  return desktopDelivered || sendFallback()
}

export function notifyAgentEvent(
  mainWindow: BrowserWindow,
  context: AgentNotificationContext,
  event: AgentEvent,
  settings: AgentNotificationSettings = DEFAULT_AGENT_NOTIFICATION_SETTINGS,
  options: AgentNotificationOptions = {},
): boolean {
  if (event.type !== 'done' && event.type !== 'error') return false
  if (mainWindow.isDestroyed()) return false

  const resolvedSettings = normalizeAgentNotificationSettings(settings)
  if (!resolvedSettings.desktopEnabled) return false

  const isFailure =
    event.type === 'error' ||
    (event.type === 'done' && typeof event.exitCode === 'number' && event.exitCode !== 0)

  if (!isFailure && !resolvedSettings.notifyOnSuccess) return false
  if (isFailure && !resolvedSettings.notifyOnFailure) return false

  const elapsedSeconds = getElapsedSeconds(context.startedAt, context.endedAt)
  if (
    elapsedSeconds !== null &&
    resolvedSettings.minDurationSeconds > 0 &&
    elapsedSeconds < resolvedSettings.minDurationSeconds
  ) {
    return false
  }

  const failureBody =
    resolvedSettings.includeErrorMessage && event.type === 'error' && event.message.trim()
      ? `${context.engine} session failed: ${truncateMessage(
          event.message,
          resolvedSettings.errorMessageMaxLength,
        )}`
      : `${context.engine} session needs attention. Click to return to JanusX.`

  const title = isFailure ? 'JanusX - Agent failed' : 'JanusX - Agent completed'
  const body = isFailure ? failureBody : `${context.engine} session completed. Click to return to JanusX.`

  return showLocalNotification(mainWindow, {
    type: isFailure ? 'failed' : 'completed',
    engine: context.engine,
    title,
    body,
    terminalId: options.terminalId,
    workspaceId: options.workspaceId,
  }, options)
}

export function notifyAgentAttention(
  mainWindow: BrowserWindow,
  context: AgentNotificationContext,
  message: string | undefined,
  settings: AgentNotificationSettings = DEFAULT_AGENT_NOTIFICATION_SETTINGS,
  options: AgentNotificationOptions = {},
): boolean {
  if (mainWindow.isDestroyed()) return false

  const resolvedSettings = normalizeAgentNotificationSettings(settings)
  if (!resolvedSettings.desktopEnabled) return false

  const title = `JanusX - ${context.engine} needs attention`
  const body = message?.trim()
    ? truncateMessage(message, resolvedSettings.errorMessageMaxLength)
    : `Click to return to JanusX and handle the ${context.engine} request.`

  return showLocalNotification(mainWindow, {
    type: 'attention',
    engine: context.engine,
    title,
    body,
    terminalId: options.terminalId,
    workspaceId: options.workspaceId,
  }, options)
}
