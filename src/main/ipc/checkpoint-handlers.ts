// Note: retired snapshots; .agents/notes/sessions/checkpoints/module.md
import { ipcMain } from 'electron'
import { CHECKPOINT_CHANNELS } from '../../shared/ipc/checkpoint'

/** Old renderer contracts fail explicitly; never initialize or mutate snapshot storage. */
export function registerCheckpointHandlers(): void {
  for (const channel of Object.values(CHECKPOINT_CHANNELS)) {
    ipcMain.handle(channel, async () => {
      if (channel === CHECKPOINT_CHANNELS.list) return []
      throw new Error('File checkpoints have been retired')
    })
  }
}
