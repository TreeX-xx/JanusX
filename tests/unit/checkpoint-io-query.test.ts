import { expect, it, vi } from 'vitest'
const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => Promise<unknown>>())
vi.mock('electron', () => ({ ipcMain: { handle: (key: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(key, handler) } }))
import { registerCheckpointHandlers } from '../../src/main/ipc/checkpoint-handlers'
import { CHECKPOINT_CHANNELS } from '../../src/shared/ipc/checkpoint'
it('retires snapshot operations without opening legacy storage', async () => {
  registerCheckpointHandlers()
  expect(await handlers.get(CHECKPOINT_CHANNELS.list)!({}, { cwd: '/missing' })).toEqual([])
  for (const channel of Object.values(CHECKPOINT_CHANNELS).filter(channel => channel !== CHECKPOINT_CHANNELS.list)) {
    await expect(handlers.get(channel)!({}, { cwd: '/missing' })).rejects.toThrow('retired')
  }
})
