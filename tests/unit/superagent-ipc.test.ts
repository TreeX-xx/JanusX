import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SUPERAGENT_CHANNELS, type SuperAgentAPI } from '../../src/shared/ipc/superagent'
import { SuperAgentService } from '../../src/main/janus/superagent/service'
import { registerSuperAgentHandlers } from '../../src/main/ipc/superagent-handlers'
import { WorkerSettingsStore, type WorkerSettingsEngines } from '../../src/main/janus/superagent/worker-settings'
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

  function register(workerSettings?: WorkerSettingsEngines) {
    const frame = {}
    const send = vi.fn()
    const contents = { id: 10, mainFrame: frame, isDestroyed: () => false, send }
    const window = { isDestroyed: () => false, webContents: contents }
    const closedWindow = { isDestroyed: () => true, webContents: { ...contents, id: 11, send: vi.fn() } }
    const options = { getAllowedWindows: () => [window, closedWindow] as unknown as BrowserWindow[], resolveWorkspaceRoot: async () => workspace.workspacePath, workerSettings }
    registerSuperAgentHandlers(options, service)
    const handlers = new Map(mocks.handle.mock.calls.map(([channel, callback]) => [channel, callback]))
    const event = { sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent
    return { handlers, event, send, closedWindow }
  }

  it('registers IPC and closes an unused host without constructing an execution service', async () => {
    // This fixture supplies no app data path. Constructing the default service would fail.
    const sender = { id: 10, mainFrame: {}, isDestroyed: () => false }
    const window = { webContents: sender, isDestroyed: () => false } as unknown as BrowserWindow
    const event = { sender, senderFrame: sender.mainFrame }
    const host = registerSuperAgentHandlers({ getAllowedWindows: () => [window], resolveWorkspaceRoot: async () => undefined })
    const available = mocks.handle.mock.calls.find(([channel]) => channel === SUPERAGENT_CHANNELS.available)![1]
    expect(await available(event)).toBe(true)
    expect(() => available({ ...event, senderFrame: {} })).toThrow('main frames')
    const snapshot = mocks.handle.mock.calls.find(([channel]) => channel === SUPERAGENT_CHANNELS.snapshot)![1]
    await expect(snapshot({ sender: {}, senderFrame: {} }, scope)).rejects.toThrow('main frames')
    await host.close()
    expect(await available(event)).toBe(false)
  })

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
      SUPERAGENT_CHANNELS.available, SUPERAGENT_CHANNELS.workerModels,
      SUPERAGENT_CHANNELS.workerDefaults, SUPERAGENT_CHANNELS.workerPolicy, SUPERAGENT_CHANNELS.updateWorkerPolicy, SUPERAGENT_CHANNELS.updateWorkerIdleTimeoutMinutes, SUPERAGENT_CHANNELS.workerIdleTimeoutMinutes, SUPERAGENT_CHANNELS.updateWorkerDefaults, SUPERAGENT_CHANNELS.workerSettings,
      SUPERAGENT_CHANNELS.configureWorker, SUPERAGENT_CHANNELS.refreshWorkerModels,
      SUPERAGENT_CHANNELS.submitInput, SUPERAGENT_CHANNELS.snapshot, SUPERAGENT_CHANNELS.workDetail, SUPERAGENT_CHANNELS.readResource,
      SUPERAGENT_CHANNELS.environments, SUPERAGENT_CHANNELS.decideEnvironmentOperation,
      SUPERAGENT_CHANNELS.prepareWorker, SUPERAGENT_CHANNELS.startWorker, SUPERAGENT_CHANNELS.appendWorker, SUPERAGENT_CHANNELS.continueWorker,
      SUPERAGENT_CHANNELS.workers, SUPERAGENT_CHANNELS.controlWorker, SUPERAGENT_CHANNELS.workerLog,
      SUPERAGENT_CHANNELS.schedule, SUPERAGENT_CHANNELS.workflows, SUPERAGENT_CHANNELS.controlWorkflow, SUPERAGENT_CHANNELS.configureCapacity, SUPERAGENT_CHANNELS.controlWork, SUPERAGENT_CHANNELS.controlQueue,
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

  it('authorizes queue controls before calling the scheduler and validates their public shape', async () => {
    const { handlers, event } = register(), control = handlers.get(SUPERAGENT_CHANNELS.controlQueue)!
    const value = { workspaceId: scope, workId: '00000000-0000-4000-8000-000000000123', expectedVersion: 1, action: 'pause' }
    const dispatch = vi.spyOn(service, 'controlQueue')
    await expect(control({ ...event, senderFrame: {} }, value)).rejects.toThrow('main frames')
    expect(dispatch).not.toHaveBeenCalled()
    await expect(control(event, { ...value, action: 'priority', priority: 'urgent' })).rejects.toThrow()
    await expect(control(event, { ...value, workspaceId: 'missing' })).rejects.toThrow('not registered')
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

  it('authorizes settings IPC, validates saved preferences and resolves only the current execution instance', async () => {
    const state = { selection: { terminal: 'codex', model: null, effort: null }, inherited: true, pending: false }
    const engine = { state: vi.fn(() => state), configure: vi.fn(async () => state), refreshModels: vi.fn(async () => state) }
    const adapter = { defaults: new WorkerSettingsStore(fixture.root), get: vi.fn(() => engine) } as unknown as WorkerSettingsEngines
    const worker = { workspaceId: scope, workId: 'work', executionId: 'execution', instanceId: 'native-instance', phase: 'running', stopConfirmed: false }
    Object.defineProperty(service, 'workers', { value: { snapshots: (workspaceId: string) => workspaceId === scope ? [worker] : [], subscribe: () => () => {} } })
    const { handlers, event } = register(adapter)
    const identity = { workspaceId: scope, workId: 'work', executionId: 'execution' }
    for (const channel of [SUPERAGENT_CHANNELS.workerModels, SUPERAGENT_CHANNELS.workerPolicy, SUPERAGENT_CHANNELS.updateWorkerPolicy, SUPERAGENT_CHANNELS.workerDefaults, SUPERAGENT_CHANNELS.updateWorkerIdleTimeoutMinutes, SUPERAGENT_CHANNELS.workerIdleTimeoutMinutes, SUPERAGENT_CHANNELS.updateWorkerDefaults, SUPERAGENT_CHANNELS.workerSettings, SUPERAGENT_CHANNELS.configureWorker, SUPERAGENT_CHANNELS.refreshWorkerModels]) {
      await expect(handlers.get(channel)!({ ...event, senderFrame: {} }, identity, null)).rejects.toThrow('main frames')
    }
    const defaults = { terminal: 'codex', model: 'alternate', effort: 'high' }
    expect(await handlers.get(SUPERAGENT_CHANNELS.updateWorkerDefaults)!(event, defaults)).toEqual(defaults)
    expect(await handlers.get(SUPERAGENT_CHANNELS.workerDefaults)!(event)).toEqual(defaults)
    expect(await handlers.get(SUPERAGENT_CHANNELS.workerPolicy)!(event)).toEqual({ defaultBackend: 'codex', enabled: ['codex', 'claude'] })
    await handlers.get(SUPERAGENT_CHANNELS.updateWorkerPolicy)!(event, { defaultBackend: 'codex', enabled: ['codex'] })
    expect(await handlers.get(SUPERAGENT_CHANNELS.workerPolicy)!(event)).toEqual({ defaultBackend: 'codex', enabled: ['codex'] })
    await expect(handlers.get(SUPERAGENT_CHANNELS.updateWorkerPolicy)!(event, { defaultBackend: 'claude', enabled: ['codex'] })).rejects.toThrow('must be enabled')
    expect(await handlers.get(SUPERAGENT_CHANNELS.workerIdleTimeoutMinutes)!(event)).toBe(30)
    expect(await handlers.get(SUPERAGENT_CHANNELS.updateWorkerIdleTimeoutMinutes)!(event, 60)).toBe(60)
    expect(await handlers.get(SUPERAGENT_CHANNELS.workerIdleTimeoutMinutes)!(event)).toBe(60)
    await expect(handlers.get(SUPERAGENT_CHANNELS.updateWorkerIdleTimeoutMinutes)!(event, 0)).rejects.toThrow('Invalid Worker idle timeout')
    await expect(handlers.get(SUPERAGENT_CHANNELS.updateWorkerDefaults)!(event, { ...defaults, terminal: 'shell' })).rejects.toThrow('Unsupported Worker backend')
    expect(await handlers.get(SUPERAGENT_CHANNELS.configureWorker)!(event, identity, defaults)).toBe(state)
    expect(adapter.get).toHaveBeenLastCalledWith('native-instance')
    expect(engine.configure).toHaveBeenLastCalledWith(defaults)
    await handlers.get(SUPERAGENT_CHANNELS.configureWorker)!(event, identity, null)
    expect(engine.configure).toHaveBeenLastCalledWith(null)
    await handlers.get(SUPERAGENT_CHANNELS.refreshWorkerModels)!(event, identity)
    expect(engine.refreshModels).toHaveBeenCalledOnce()
    for (const forged of [{ ...identity, executionId: 'old' }, { ...identity, workspaceId: 'other' }, { ...identity, instanceId: 'forged' }]) {
      await expect(handlers.get(SUPERAGENT_CHANNELS.configureWorker)!(event, forged, defaults)).rejects.toThrow()
    }
    worker.phase = 'stopping'
    await expect(handlers.get(SUPERAGENT_CHANNELS.configureWorker)!(event, identity, defaults)).rejects.toThrow('unavailable')
    expect(engine.configure).toHaveBeenCalledTimes(2)
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

  it('preserves queue versions and priority controls through preload', async () => {
    const control = { workspaceId: 'scope', workId: 'work', expectedVersion: 4, action: 'priority' as const, priority: 'background' as const }
    await api.controlQueue(control)
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(SUPERAGENT_CHANNELS.controlQueue, control)
  })
  it('preserves scoped workflow identities, revisions and event unsubscribe through preload', async () => {
    const control = { workspaceId: 'scope', workflowId: 'flow', expectedRevision: 4, action: 'pause' as const }
    await api.workflows('scope'); await api.controlWorkflow(control)
    expect(mocks.invoke.mock.calls).toEqual([[SUPERAGENT_CHANNELS.workflows, 'scope'], [SUPERAGENT_CHANNELS.controlWorkflow, control]])
    const listener = vi.fn(), off = api.onWorkflowsChanged(listener), [channel, callback] = mocks.on.mock.calls[0]
    callback({}, { workspaceId: 'scope' }); expect(listener).toHaveBeenCalledWith({ workspaceId: 'scope' })
    off(); expect(mocks.removeListener).toHaveBeenCalledWith(channel, callback)
  })

  it('passes settings and exact execution identity through preload without rewriting null restores', async () => {
    const identity = { workspaceId: 'scope', workId: 'work', executionId: 'execution' }
    const settings = { terminal: 'codex' as const, model: 'alternate', effort: 'high' }
    await api.workerModels('claude')
    await api.workerDefaults(); await api.workerIdleTimeoutMinutes(); await api.updateWorkerIdleTimeoutMinutes(60); await api.updateWorkerDefaults(settings)
    await api.workerSettings(identity); await api.configureWorker(identity, settings)
    await api.configureWorker(identity, null); await api.refreshWorkerModels(identity)
    expect(mocks.invoke.mock.calls).toEqual([
      [SUPERAGENT_CHANNELS.workerModels, 'claude'],
      [SUPERAGENT_CHANNELS.workerDefaults], [SUPERAGENT_CHANNELS.workerIdleTimeoutMinutes], [SUPERAGENT_CHANNELS.updateWorkerIdleTimeoutMinutes, 60], [SUPERAGENT_CHANNELS.updateWorkerDefaults, settings],
      [SUPERAGENT_CHANNELS.workerSettings, identity], [SUPERAGENT_CHANNELS.configureWorker, identity, settings],
      [SUPERAGENT_CHANNELS.configureWorker, identity, null], [SUPERAGENT_CHANNELS.refreshWorkerModels, identity],
    ])
  })
})
