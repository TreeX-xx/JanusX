import { beforeEach, expect, it, vi } from 'vitest'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
const fixtures = vi.hoisted(() => ({ handlers: new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>(), scan: vi.fn(async () => ({})), read: vi.fn(), save: vi.fn(), revealPath: vi.fn(), probeConfiguration: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, callback: (...args: unknown[]) => unknown) => fixtures.handlers.set(channel, callback) }, shell: { showItemInFolder: vi.fn() } }))
vi.mock('../../src/main/local-integrations/service', () => ({ LocalIntegrationService: class { scan = fixtures.scan; read = fixtures.read; save = fixtures.save; revealPath = fixtures.revealPath; probeConfiguration = fixtures.probeConfiguration } }))
import { registerLocalIntegrationHandlers } from '../../src/main/ipc/local-integrations-handlers'
import { LOCAL_INTEGRATION_CHANNELS } from '../../src/shared/local-integrations'

const frame = {}, sender = { mainFrame: frame }
const event = { sender, senderFrame: frame } as IpcMainInvokeEvent
beforeEach(() => { vi.clearAllMocks(); fixtures.handlers.clear(); registerLocalIntegrationHandlers(() => [{ isDestroyed: () => false, webContents: sender }] as unknown as BrowserWindow[], async () => undefined, () => undefined) })

it('rejects foreign windows and subframes before reading user configuration', () => {
  const scan = fixtures.handlers.get(LOCAL_INTEGRATION_CHANNELS.scan)!
  expect(() => scan({ ...event, sender: { mainFrame: frame } } as IpcMainInvokeEvent, { client: 'codex', scope: 'user' })).toThrow('not authorized')
  expect(() => scan({ ...event, senderFrame: {} } as IpcMainInvokeEvent, { client: 'codex', scope: 'user' })).toThrow('not authorized')
  expect(fixtures.scan).not.toHaveBeenCalled()
})

it('accepts the trusted main frame and rejects path injection through query properties', async () => {
  const scan = fixtures.handlers.get(LOCAL_INTEGRATION_CHANNELS.scan)!
  await scan(event, { client: 'claude', scope: 'workspace', workspaceId: 'demo' })
  expect(fixtures.scan).toHaveBeenCalledWith({ client: 'claude', scope: 'workspace', workspaceId: 'demo' })
  expect(() => scan(event, { client: 'claude', scope: 'user', path: 'C:/outside.json' })).toThrow()
  expect(() => scan(event, { client: 'claude', scope: 'workspace', workspaceId: '../outside' })).toThrow()
  expect(fixtures.scan).toHaveBeenCalledTimes(1)
})

it('rejects unversioned saves before any mutation', () => {
  const save = fixtures.handlers.get(LOCAL_INTEGRATION_CHANNELS.save)!
  expect(() => save(event, { query: { client: 'codex', scope: 'user' }, sourceId: 'source', name: 'server', content: '{"command":"node"}' })).toThrow()
  expect(fixtures.save).not.toHaveBeenCalled()
})
