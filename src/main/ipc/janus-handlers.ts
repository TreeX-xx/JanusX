// Note: .agents/notes/planning/blueprint-official-plugin.md; legacy Blueprint IPC never loads plugin business code.
import { ipcMain } from 'electron'
import { JANUS_COMMAND_CHANNELS } from '../../shared/ipc/janus'
import { requireBlueprintPlugin } from '../plugins/legacy-blueprint'

export function registerJanusHandlers(): void {
  for (const channel of Object.values(JANUS_COMMAND_CHANNELS)) {
    ipcMain.handle(channel, async () => requireBlueprintPlugin())
  }
}
