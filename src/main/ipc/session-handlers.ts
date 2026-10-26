import { ipcMain, type BrowserWindow } from 'electron'
import {
  SESSION_CHANNELS,
  type SessionContinueInput,
  type SessionFilter,
  type ShellRestoreManifest,
} from '../../shared/ipc/session'
import { agentSessionRegistry } from '../sessions/session-registry'
import { scanExternalSessions, type ExternalScanSummary } from '../sessions/external-session-scanner'
import { readTranscriptDetail } from '../sessions/transcript-reader'
import { continueAgentSession, resendSessionHandoff } from './terminal-handlers'
import { scanRemoteSessions, readRemoteTranscript } from '../workspace/remote-sessions'
import { parseRuntimeResource } from '../../shared/workspace-runtime'

// Panel mounts, scope tabs, and boot each trigger a scan; one pass walks
// hundreds of transcript files for ~60s. Overlapping passes redo the same
// work and emit duplicate event bursts, so concurrent callers share one
// in-flight pass instead of starting their own.
// See .agents/notes/sessions/records/session-flicker-storm.md
let scanInFlight: Promise<ExternalScanSummary> | null = null

function runScanSerialized(): Promise<ExternalScanSummary> {
  if (!scanInFlight) {
    scanInFlight = (async () => {
      await agentSessionRegistry.load().catch(() => undefined)
      const local = await scanExternalSessions(agentSessionRegistry)
      const remote = await scanRemoteSessions()
      return { ...local, remote }
    })().finally(() => {
      scanInFlight = null
    })
  }
  return scanInFlight
}

export function registerSessionHandlers(getMainWindow: () => BrowserWindow | null): void {
  void agentSessionRegistry
    .load()
    .then(() => runScanSerialized().catch((err) => console.error('[sessions] boot backfill failed:', err)))
    .catch((err) => {
      console.error('[sessions] load failed:', err)
    })
  agentSessionRegistry.setChangeListener((sessionId) => {
    const window = getMainWindow()
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
    try {
      window.webContents.send(SESSION_CHANNELS.event, { type: 'updated', sessionId })
    } catch (err) {
      console.error('[sessions] event send failed:', err)
    }
  })

  ipcMain.handle(SESSION_CHANNELS.list, async (_event, filter?: SessionFilter) => {
    await agentSessionRegistry.load().catch(() => undefined)
    return agentSessionRegistry.listSessions(filter)
  })

  ipcMain.handle(SESSION_CHANNELS.get, async (_event, { sessionId }: { sessionId: string }) => {
    await agentSessionRegistry.load().catch(() => undefined)
    return agentSessionRegistry.getSession(sessionId)
  })

  ipcMain.handle(SESSION_CHANNELS.continue, async (_event, input: SessionContinueInput) => {
    return continueAgentSession(input.sessionId, {
      engine: input.engine,
      mode: input.mode,
      workspaceId: input.workspaceId,
    })
  })

  ipcMain.handle(SESSION_CHANNELS.resendHandoff, async (_event, { sessionId }: { sessionId: string }) => {
    return resendSessionHandoff(sessionId)
  })

  ipcMain.handle(SESSION_CHANNELS.scanExternal, async () => {
    return runScanSerialized()
  })

  ipcMain.handle(SESSION_CHANNELS.getTranscript, async (_event, { sessionId }: { sessionId: string }) => {
    await agentSessionRegistry.load().catch(() => undefined)
    const record = agentSessionRegistry.getSession(sessionId)
    if (!record) return null
    if (parseRuntimeResource(record.cwd)) return readRemoteTranscript(record)
    // Janus history resolves from the provider session id when the record
    // carries no transcript path; other engines need the recorded path.
    if (!record.transcriptPath && record.engine !== 'janus') return null
    return readTranscriptDetail(record.transcriptPath ?? '', record.engine, record.providerSessionId)
  })

  ipcMain.handle(SESSION_CHANNELS.saveLayout, async (_event, layout: ShellRestoreManifest) => {
    await agentSessionRegistry.saveLayout(layout)
    return { success: true }
  })

  ipcMain.handle(SESSION_CHANNELS.getLayout, async () => {
    return agentSessionRegistry.getLayout()
  })

  ipcMain.handle(SESSION_CHANNELS.clearLayout, async () => {
    await agentSessionRegistry.clearLayout()
    return { success: true }
  })
}
