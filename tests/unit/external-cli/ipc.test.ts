import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EXTERNAL_CLI_CHANNELS, type ExternalCliAPI } from '../../../src/shared/ipc/external-cli'
import type { RegisterExternalCliHandlersOptions } from '../../../src/main/ipc/external-cli-handlers'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), handlers: new Map(), api: {} as { externalCli: ExternalCliAPI } }))
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (_: string, api: typeof mocks.api) => { mocks.api = api } },
  ipcRenderer: { invoke: mocks.invoke, send: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
  ipcMain: { handle: (name: string, handler: unknown) => mocks.handlers.set(name, handler), removeHandler: (name: string) => mocks.handlers.delete(name) },
}))
vi.mock('../../../src/main/external-cli/service', () => ({ externalCliService: {} }))
const { registerExternalCliHandlers } = await import('../../../src/main/ipc/external-cli-handlers')
await import('../../../src/preload/index')

describe('external CLI update IPC', () => {
  beforeEach(() => { mocks.invoke.mockReset(); mocks.handlers.clear() })

  it('preserves legacy calls and carries the exact release selection through preload', async () => {
    await mocks.api.externalCli.install('claude')
    await mocks.api.externalCli.install('opencode', { channel: 'v2', version: '2.1.4' })
    expect(mocks.invoke.mock.calls).toEqual([
      [EXTERNAL_CLI_CHANNELS.install, 'claude'],
      [EXTERNAL_CLI_CHANNELS.install, { toolId: 'opencode', channel: 'v2', version: '2.1.4' }],
    ])
  })

  function harness() {
    const service = { install: vi.fn().mockResolvedValue({ toolId: 'opencode', success: true }) }
    const window = { isDestroyed: () => false, webContents: { isDestroyed: () => false } }
    registerExternalCliHandlers({ getAllowedWindows: () => [window], service } as unknown as RegisterExternalCliHandlersOptions)
    return { service, call: (payload: unknown, authorized = true) => mocks.handlers.get(EXTERNAL_CLI_CHANNELS.install)({ sender: authorized ? window.webContents : {} }, payload) }
  }

  it('validates structured options and discards extra renderer fields', async () => {
    const { service, call } = harness()
    expect(await call({ toolId: 'opencode', channel: 'v2', version: '2.1.4', npmPackage: 'untrusted' })).toMatchObject({ success: true })
    expect(service.install).toHaveBeenCalledWith('opencode', { channel: 'v2', version: '2.1.4' })
  })

  it.each([
    { toolId: 'claude', channel: 'v2', version: '2.1.4' },
    { toolId: 'opencode', channel: 'v1', version: '2.1.4' },
    { toolId: 'opencode', channel: 'v2', version: '2.1.4; whoami' },
    { toolId: 'opencode', channel: 'v2', version: 'latest' },
    { toolId: 'opencode' },
  ])('rejects malformed structured requests %j', async payload => {
    const { service, call } = harness()
    expect(await call(payload)).toMatchObject({ success: false })
    expect(service.install).not.toHaveBeenCalled()
  })

  it('rejects unauthorized senders and still supports a legacy OpenCode request', async () => {
    const { service, call } = harness()
    expect(await call({ toolId: 'opencode', channel: 'v2', version: '2.1.4' }, false)).toMatchObject({ success: false, error: 'Unauthorized' })
    expect(service.install).not.toHaveBeenCalled()
    await call('opencode')
    expect(service.install).toHaveBeenCalledWith('opencode')
  })

  it('returns a structured error when an async install fails', async () => {
    const { service, call } = harness()
    service.install.mockRejectedValue(new Error('probe failed'))
    expect(await call({ toolId: 'opencode', channel: 'v2', version: '2.1.4' })).toMatchObject({ success: false, error: 'probe failed' })
  })
})
