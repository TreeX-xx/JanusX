import { beforeAll, expect, it, vi } from 'vitest'
import { BLUEPRINT_REVIEW_CHANNELS, type BlueprintReviewAPI } from '../../plugins/blueprint/src/shared/ipc/blueprint-review'

const mocks = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>(),
  listeners: new Map<string, (...args: unknown[]) => unknown>(), removeListener: vi.fn(), invoke: vi.fn() }))
let api: BlueprintReviewAPI
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => mocks.handlers.set(channel, handler) },
  ipcRenderer: { invoke: mocks.invoke, on: (channel: string, listener: (...args: unknown[]) => unknown) => mocks.listeners.set(channel, listener), removeListener: mocks.removeListener, send: vi.fn() },
  contextBridge: { exposeInMainWorld: (_name: string, exposed: { blueprintReview: BlueprintReviewAPI }) => { api = exposed.blueprintReview } },
}))
beforeAll(async () => {
  const { registerBlueprintReviewHandlers } = await import('../../src/main/ipc/blueprint-review-handlers')
  registerBlueprintReviewHandlers()
  mocks.invoke.mockImplementation((channel: string, ...args: unknown[]) => mocks.handlers.get(channel)!({}, ...args))
  await import('../../src/preload/index')
})

it('keeps all retired invoke endpoints actionable and never registers event channels as commands', async () => {
  for (const [name, channel] of Object.entries(BLUEPRINT_REVIEW_CHANNELS)) {
    if (name.endsWith('Changed')) expect(mocks.handlers.has(channel)).toBe(false)
    else await expect(mocks.handlers.get(channel)!({}, '/fixture')).rejects.toThrow('BLUEPRINT_PLUGIN_REQUIRED')
  }
})

it('returns the plugin-required error through the actual preload for read, write, credentials and MCP', async () => {
  await expect(api.read('/fixture')).rejects.toThrow('BLUEPRINT_PLUGIN_REQUIRED')
  await expect(api.run('/fixture', 'note')).rejects.toThrow('BLUEPRINT_PLUGIN_REQUIRED')
  await expect(api.repairPrepare({} as never)).rejects.toThrow('BLUEPRINT_PLUGIN_REQUIRED')
  await expect(api.credentialGet()).rejects.toThrow('BLUEPRINT_PLUGIN_REQUIRED')
  await expect(api.credentialSet('new-value')).rejects.toThrow('BLUEPRINT_PLUGIN_REQUIRED')
  await expect(api.mcpChange({} as never)).rejects.toThrow('BLUEPRINT_PLUGIN_REQUIRED')
})

it('allows legacy renderer subscriptions to dispose without opening a review runtime', () => {
  const receive = vi.fn()
  const stop = api.onActivityChanged(receive)
  expect(receive).not.toHaveBeenCalled()
  stop()
  expect(mocks.removeListener).toHaveBeenCalledWith(BLUEPRINT_REVIEW_CHANNELS.activityChanged, expect.any(Function))
})
