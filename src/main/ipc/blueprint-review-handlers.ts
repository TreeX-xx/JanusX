import { ipcMain } from 'electron'
import { BLUEPRINT_REVIEW_CHANNELS } from '../../../plugins/blueprint/src/shared/ipc/blueprint-review'
import { requireBlueprintPlugin } from '../plugins/legacy-blueprint'

// Note: old IPC stays actionable without opening stores or listeners — see .agents/notes/planning/blueprint-official-plugin.md
export function registerBlueprintReviewHandlers(): void {
  for (const [name, channel] of Object.entries(BLUEPRINT_REVIEW_CHANNELS)) {
    if (!name.endsWith('Changed')) ipcMain.handle(channel, async () => requireBlueprintPlugin())
  }
}
