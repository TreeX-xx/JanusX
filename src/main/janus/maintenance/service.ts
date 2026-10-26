// Desktop compatibility adapter; the maintenance domain is owned by the downloaded plugin.
import { app, type BrowserWindow } from 'electron'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { generateObject } from '../../llm/ai-runtime'
import { llmService } from '../../llm/LlmService'
import { legacyBlueprintNotes } from '../../blueprint/note-service'
import { blueprintStore } from '../blueprint-store'
import { workspacesDir } from '../blueprint-paths'
import { JANUS_EVENT_CHANNELS } from '../../../shared/ipc/janus'
import { readJson } from '../../../../plugins/blueprint/src/main/janus/blueprint-persistence'
import { BlueprintMaintenanceService } from '../../../../plugins/blueprint/src/main/janus/maintenance/service'
import type { MaintenanceModelPort } from '../../../../plugins/blueprint/src/main/janus/maintenance/ports'
export { toMaintenanceChatEvent, toMaintenanceTraceEntry, toChatTraceEntry } from '../../../../plugins/blueprint/src/main/janus/maintenance/service'

let mainWindow: BrowserWindow | null = null
const models: MaintenanceModelPort = {
  async select(providerId, modelId) {
    const selected = providerId ? { provider: { id: providerId }, modelId: modelId ?? '' } : await llmService.getDefaultModel()
    if (!selected) throw new Error('MODEL_UNAVAILABLE')
    const id = modelId || selected.modelId
    const listed = typeof llmService.listModels === 'function' ? (await llmService.listModels('janus', selected.provider.id).catch(() => [])).find(model => model.id === id) : undefined
    return { providerId: selected.provider.id, modelId: id, contextWindow: listed?.contextWindow, maxOutputTokens: listed?.maxOutputTokens }
  },
  async generate(input) {
    const { model: selected, ...options } = input
    const model = await llmService.getLanguageModel('janus', selected.providerId, selected.modelId)
    return generateObject({ ...options, model } as never) as Promise<{ object: never }>
  },
}
export const blueprintMaintenanceService = Object.assign(new BlueprintMaintenanceService({
  notes: legacyBlueprintNotes, store: blueprintStore, models,
  async workspaces() {
    const directory = workspacesDir(), files = await readdir(directory).catch(() => [])
    const records = await Promise.all(files.filter(file => file.endsWith('.json')).map(file => readJson<{ id: string; path: string }>(join(directory, file))))
    return records.filter((record): record is { id: string; path: string } => Boolean(record?.id && record.path))
  },
  get auditDirectory() { return join(app.getPath('userData'), 'janusx', 'blueprint-maintenance-audit') },
  changed(task) {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send(JANUS_EVENT_CHANNELS.maintenance, { task })
  },
}), { setMainWindow(window: BrowserWindow | null) { mainWindow = window } })
