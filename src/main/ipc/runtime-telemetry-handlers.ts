import { dialog, ipcMain } from 'electron'
import { HISTORY_ENGINES, HISTORY_SOURCE_CHANNELS, type HistoryEngine } from '../../shared/history-sources'
import { getHistorySourcesView, saveHistorySources } from '../sessions/history-source-service'
import { terminalContextCoordinator } from '../runtime-telemetry/coordinator'
import { SYSTEM_CHANNELS } from '../../shared/ipc/system'
import type { RuntimeTelemetryRequest } from '../../shared/ipc/system'
import type { UsageLedgerQuery } from '../../shared/usage'

export function registerRuntimeTelemetryHandlers(): void {
  ipcMain.handle(HISTORY_SOURCE_CHANNELS.get, () => getHistorySourcesView())
  ipcMain.handle(HISTORY_SOURCE_CHANNELS.pick, async (_event, engine: HistoryEngine) => {
    if (!HISTORY_ENGINES.includes(engine)) throw new Error('Unknown history provider')
    const result = await dialog.showOpenDialog({ properties: [engine === 'opencode' ? 'openFile' : 'openDirectory', 'showHiddenFiles'] })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  ipcMain.handle(HISTORY_SOURCE_CHANNELS.save, async (_event, settings: unknown) => {
    const result = await saveHistorySources(settings)
    // Wait out any old scan before refreshing the newly saved sources.
    const { refreshExternalSessionSources } = await import('./session-handlers')
    const refresh = await Promise.allSettled([refreshExternalSessionSources(), terminalContextCoordinator.refreshHistorySources()])
    const failures = refresh.flatMap(item => item.status === 'rejected' ? [String(item.reason)] : [])
    return failures.length ? { ...result, refreshWarning: failures.join('\n') } : result
  })
  ipcMain.handle(SYSTEM_CHANNELS.runtimeTelemetry, async (_event, request: RuntimeTelemetryRequest) => {
    return terminalContextCoordinator.getSnapshot(request)
  })
  ipcMain.handle(SYSTEM_CHANNELS.usageLedger, (_event, query: UsageLedgerQuery) => terminalContextCoordinator.listUsage(query))
}
