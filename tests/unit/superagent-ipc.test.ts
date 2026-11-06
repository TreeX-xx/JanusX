import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SUPERAGENT_CHANNELS, type SuperAgentAPI } from '../../src/shared/ipc/superagent'
import { SuperAgentService } from '../../src/main/janus/superagent/service'
import { registerSuperAgentHandlers } from '../../src/main/ipc/superagent-handlers'
import { createWork, otherWorkspace, submission, superAgentFixture, workspace } from '../helpers/superagent-fixture'

const mocks = vi.hoisted(() => ({ handle: vi.fn(), invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn(), expose: vi.fn() }))
vi.mock('electron', () => ({
  app: { getPath: vi.fn() },
  ipcMain: { handle: mocks.handle },
  contextBridge: { exposeInMainWorld: mocks.expose },
  ipcRenderer: { invoke: mocks.invoke, on: mocks.on, removeListener: mocks.removeListener, send: vi.fn() },
}))

describe('SuperAgent host admission and IPC', () => {
  let fixture: Awaited<ReturnType<typeof superAgentFixture>>
  let service: SuperAgentService
  const scope = workspace.workspaceId
  beforeEach(async () => {
    vi.clearAllMocks()
    fixture = await superAgentFixture()
    service = new SuperAgentService(fixture.store, async id => [workspace, otherWorkspace].find(row => row.workspaceId === id)?.workspacePath)
  })
  afterEach(async () => { await fixture.dispose() })

  it('uses registered workspace paths and captures submission values before asynchronous lookup', async () => {
    const lookup = Promise.withResolvers<string>()
    service = new SuperAgentService(fixture.store, () => lookup.promise)
    const input = submission('Original text')
    const pending = service.submitInput(input)
    input.text = 'Mutated text'; input.workspaceId = otherWorkspace.workspaceId
    lookup.resolve(workspace.workspacePath)
    const receipt = await pending
    expect(receipt.input).toMatchObject(workspace)
    expect((await fixture.store.readResource(scope, receipt.input.resourceId)).text).toBe('Original text')
  })

  it('rejects unknown workspaces, empty input and forged host fields without writing', async () => {
    await expect(service.submitInput({ ...submission(), workspaceId: 'missing' })).rejects.toThrow('not registered')
    await expect(service.submitInput(submission('  '))).rejects.toThrow()
    for (const extra of [{ workspacePath: 'C:/forged' }, { workId: 'forged' }, { status: 'delivered' }]) {
      await expect(service.submitInput({ ...submission(), ...extra })).rejects.toThrow()
    }
    expect((await fixture.store.snapshot(scope)).inputs).toEqual([])
  })

  function register() {
    const frame = {}
    const send = vi.fn()
    const contents = { id: 10, mainFrame: frame, isDestroyed: () => false, send }
    const window = { isDestroyed: () => false, webContents: contents }
    const closedWindow = { isDestroyed: () => true, webContents: { ...contents, id: 11, send: vi.fn() } }
    const options = { getAllowedWindows: () => [window, closedWindow] as unknown as BrowserWindow[], resolveWorkspaceRoot: async () => workspace.workspacePath }
    registerSuperAgentHandlers(options, service)
    const handlers = new Map(mocks.handle.mock.calls.map(([channel, callback]) => [channel, callback]))
    const event = { sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent
    return { handlers, event, send, closedWindow }
  }

  it('permits only allowed main frames and broadcasts minimal changes after saving', async () => {
    const { handlers, event, send, closedWindow } = register()
    const submit = handlers.get(SUPERAGENT_CHANNELS.submitInput)!
    await expect(submit({ ...event, sender: { id: 99 } }, submission())).rejects.toThrow('main frames')
    await expect(submit({ ...event, senderFrame: {} }, submission())).rejects.toThrow('main frames')
    expect(send).not.toHaveBeenCalled()
    const input = submission()
    const receipt = await submit(event, input)
    expect(send).toHaveBeenCalledExactlyOnceWith(SUPERAGENT_CHANNELS.changed, { workspaceId: scope, revision: 1, kind: 'input' })
    expect(closedWindow.webContents.send).not.toHaveBeenCalled()
    expect((await handlers.get(SUPERAGENT_CHANNELS.readResource)!(event, scope, receipt.input.resourceId)).text).toBe(input.text)
    await submit(event, input)
    expect(send).toHaveBeenCalledTimes(1)
    expect([...handlers.keys()]).toEqual([
      SUPERAGENT_CHANNELS.submitInput, SUPERAGENT_CHANNELS.snapshot, SUPERAGENT_CHANNELS.workDetail, SUPERAGENT_CHANNELS.readResource,
      SUPERAGENT_CHANNELS.environments, SUPERAGENT_CHANNELS.decideEnvironmentOperation,
      SUPERAGENT_CHANNELS.prepareWorker, SUPERAGENT_CHANNELS.startWorker, SUPERAGENT_CHANNELS.appendWorker, SUPERAGENT_CHANNELS.continueWorker,
      SUPERAGENT_CHANNELS.workers, SUPERAGENT_CHANNELS.controlWorker, SUPERAGENT_CHANNELS.workerLog,
      SUPERAGENT_CHANNELS.schedule, SUPERAGENT_CHANNELS.configureCapacity, SUPERAGENT_CHANNELS.controlWork,
    ])
  })

  it('enforces workspace scoping through IPC even when the foreign workspace is registered', async () => {
    const { handlers, event } = register()
    const work = await createWork(fixture.store)
    const detail = await handlers.get(SUPERAGENT_CHANNELS.workDetail)!(event, scope, work.id)
    expect(detail.work.id).toBe(work.id)
    await expect(handlers.get(SUPERAGENT_CHANNELS.workDetail)!(event, otherWorkspace.workspaceId, work.id)).rejects.toThrow('not found')
    await expect(handlers.get(SUPERAGENT_CHANNELS.readResource)!(event, otherWorkspace.workspaceId, detail.inputs[0].resourceId)).rejects.toThrow('not found')
    expect((await handlers.get(SUPERAGENT_CHANNELS.snapshot)!(event, scope)).works).toHaveLength(1)
  })

  it('requires the trusted main frame for user Git decisions and rejects replacement operation targets', async () => {
    const { handlers, event } = register()
    const decide = handlers.get(SUPERAGENT_CHANNELS.decideEnvironmentOperation)!
    const decision = { workspaceId: scope, operationId: '00000000-0000-4000-8000-000000000123', approved: true }
    const dispatch = vi.spyOn(service, 'decideEnvironmentOperation')
    await expect(decide({ ...event, senderFrame: {} }, decision)).rejects.toThrow('main frames')
    expect(dispatch).not.toHaveBeenCalled()
    await expect(decide(event, { ...decision, targetPath: 'C:/forged' })).rejects.toThrow()
    dispatch.mockResolvedValueOnce({ id: decision.operationId, status: 'rejected' } as any)
    expect(await decide(event, decision)).toMatchObject({ id: decision.operationId, status: 'rejected' })
    expect(dispatch).toHaveBeenLastCalledWith(decision)
    dispatch.mockRestore()
  })
})

describe('SuperAgent preload contract', () => {
  let api: SuperAgentAPI
  beforeAll(async () => {
    await import('../../src/preload/index')
    api = mocks.expose.mock.calls.find(([name]) => name === 'electron')![1].superAgent
  })
  beforeEach(() => { mocks.invoke.mockClear(); mocks.on.mockClear(); mocks.removeListener.mockClear() })

  it('exposes the typed host input and query methods with unchanged identities', async () => {
    const input = submission()
    await api.submitInput(input)
    await api.snapshot(workspace.workspaceId)
    await api.workDetail(workspace.workspaceId, 'work')
    await api.readResource(workspace.workspaceId, 'resource')
    await api.environments(workspace.workspaceId)
    const decision = { workspaceId: workspace.workspaceId, operationId: 'operation', approved: true }
    await api.decideEnvironmentOperation(decision)
    expect(mocks.invoke.mock.calls).toEqual([
      [SUPERAGENT_CHANNELS.submitInput, input], [SUPERAGENT_CHANNELS.snapshot, workspace.workspaceId],
      [SUPERAGENT_CHANNELS.workDetail, workspace.workspaceId, 'work'], [SUPERAGENT_CHANNELS.readResource, workspace.workspaceId, 'resource'],
      [SUPERAGENT_CHANNELS.environments, workspace.workspaceId], [SUPERAGENT_CHANNELS.decideEnvironmentOperation, decision],
    ])
  })

  it('hides native Electron events and unsubscribes the exact listener', () => {
    const callback = vi.fn()
    const unsubscribe = api.onChanged(callback)
    const [channel, listener] = mocks.on.mock.calls[0]
    const change = { workspaceId: workspace.workspaceId, revision: 1, kind: 'input' }
    listener({ sender: 'private Electron event' }, change)
    expect(callback).toHaveBeenCalledExactlyOnceWith(change)
    unsubscribe()
    expect(mocks.removeListener).toHaveBeenCalledWith(channel, listener)
    const environmentCallback = vi.fn()
    const off = api.onEnvironmentsChanged(environmentCallback)
    const [environmentChannel, environmentListener] = mocks.on.mock.calls[1]
    environmentListener({ sender: 'private' }, { workspaceId: workspace.workspaceId, revision: 1 })
    expect(environmentCallback).toHaveBeenCalledWith({ workspaceId: workspace.workspaceId, revision: 1 })
    off()
    expect(mocks.removeListener).toHaveBeenCalledWith(environmentChannel, environmentListener)
  })
})
