import { runtimeCapability } from '../../shared/runtime/capabilities'
import { localRuntimeContext } from '../platform/runtime-context'
import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { SUPERAGENT_CHANNELS } from '../../shared/ipc/superagent'
import { SuperAgentPersistence } from '../janus/superagent/persistence'
import { SuperAgentService } from '../janus/superagent/service'
import { SuperAgentStore } from '../janus/superagent/store'
import { SuperAgentEnvironmentStore } from '../janus/superagent/environment-store'
import { SuperAgentEnvironments } from '../janus/superagent/environments'
import { SuperAgentWorkers } from '../janus/superagent/workers'
import { CliDetector } from '../external-cli/cli-detector'
import { managedCliEnv } from '../external-cli/managed-paths'
import { bindSuperAgentService } from '../janus/superagent/host'
import { WorkerSettingsEngines, WorkerSettingsStore } from '../janus/superagent/worker-settings'
import { DesktopSuperAgentService } from '../janus/superagent/desktop-service'
import { WorkerModelCatalog } from '../janus/superagent/worker-model-catalog'

const settingsByService = new WeakMap<SuperAgentService, WorkerSettingsEngines>()

interface SuperAgentHandlerOptions {
  getAllowedWindows(): readonly BrowserWindow[]
  resolveWorkspaceRoot(workspaceId: string): Promise<string | undefined>
  getOccupiedPaths?(): readonly string[]
  workerSettings?: WorkerSettingsEngines
}

function createService(options: SuperAgentHandlerOptions): SuperAgentService {
  const directory = join(app.getPath('userData'), 'janusx', 'superagent')
  const store = new SuperAgentStore(new SuperAgentPersistence(directory))
  const environments = new SuperAgentEnvironments(new SuperAgentEnvironmentStore(directory), store, options.resolveWorkspaceRoot, options.getOccupiedPaths)
  const settings = new WorkerSettingsEngines(new WorkerSettingsStore(directory))
  const workers = new SuperAgentWorkers(store, environments, directory, async backend => {
    const selected = await settings.defaults.resolveBackend(backend)
    const capability = runtimeCapability('managed-worker', selected, localRuntimeContext().identity)
    if (capability.status !== 'available') throw new Error(capability.message)
    const binary = await new CliDetector(selected).findCandidate()
    if (!binary) throw new Error(selected + ' is not installed. Use the existing terminal management setup first.')
    // IPC registration is emitted under main/chunks in both development and packaged builds.
    return { backend: selected, command: binary.path, env: managedCliEnv(), mcpCommand: process.execPath, mcpEntry: join(__dirname, '..', 'worker-mcp.js') }
  }, settings.create, undefined, undefined, undefined, undefined, async () => (await settings.defaults.getIdleMinutes()) * 60_000)
  const service = new DesktopSuperAgentService(store, options.resolveWorkspaceRoot, environments, workers)
  service.workerPolicy = settings.defaults
  settingsByService.set(service, settings)
  return service
}

export function registerSuperAgentHandlers(options: SuperAgentHandlerOptions, service = createService(options)): SuperAgentService {
  bindSuperAgentService(service, senderId => options.getAllowedWindows().some(window => !window.isDestroyed()
    && !window.webContents.isDestroyed() && window.webContents.id === senderId))
  const authorize = (event: IpcMainInvokeEvent): void => {
    const allowed = options.getAllowedWindows().some(window => !window.isDestroyed()
      && !window.webContents.isDestroyed() && window.webContents.id === event.sender.id)
    if (!allowed || !event.senderFrame || event.senderFrame !== event.sender.mainFrame) {
      throw new Error('SuperAgent records are only available to application main frames')
    }
  }
  const settings = settingsByService.get(service) ?? options.workerSettings
  const modelCatalog = new WorkerModelCatalog()
  ipcMain.handle(SUPERAGENT_CHANNELS.workerModels, async (event, backend: unknown) => { authorize(event); return modelCatalog.get(backend) })
  let fallbackDefaults: WorkerSettingsStore | undefined
  const defaults = () => settings?.defaults ?? (fallbackDefaults ??= new WorkerSettingsStore(join(app.getPath('userData'), 'janusx', 'superagent')))
  const executionSettings = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Worker identity')
    const row = value as Record<string, unknown>
    if (Object.keys(row).some(key => !['workspaceId', 'workId', 'executionId'].includes(key))
      || !['workspaceId', 'workId', 'executionId'].every(key => typeof row[key] === 'string' && (row[key] as string).length > 0 && (row[key] as string).length <= 128)) throw new Error('Invalid Worker identity')
    const current = service.workers?.snapshots(row.workspaceId as string).find(worker => worker.workId === row.workId && worker.executionId === row.executionId)
    if (!current || current.restored || current.stopConfirmed || current.retiredAt !== undefined || ['stopping', 'stopped', 'failed', 'interrupted'].includes(current.phase)) throw new Error('Worker execution changed or is unavailable')
    if (!settings) throw new Error('Worker settings adapter is unavailable')
    return settings.get(current.instanceId)
  }
  ipcMain.handle(SUPERAGENT_CHANNELS.workerDefaults, async (event, backend) => { authorize(event); return defaults().get(backend) })
  ipcMain.handle(SUPERAGENT_CHANNELS.workerPolicy, async event => { authorize(event); return defaults().policy() })
  ipcMain.handle(SUPERAGENT_CHANNELS.updateWorkerPolicy, async (event, value) => { authorize(event); return defaults().updatePolicy(value) })
  ipcMain.handle(SUPERAGENT_CHANNELS.updateWorkerIdleTimeoutMinutes, async (event, minutes: unknown) => { authorize(event); return defaults().updateIdleMinutes(minutes) })
  ipcMain.handle(SUPERAGENT_CHANNELS.workerIdleTimeoutMinutes, async event => { authorize(event); return defaults().getIdleMinutes() })
  ipcMain.handle(SUPERAGENT_CHANNELS.updateWorkerDefaults, async (event, value: unknown) => { authorize(event); return defaults().update(value) })
  ipcMain.handle(SUPERAGENT_CHANNELS.workerSettings, async (event, identity: unknown) => { authorize(event); return executionSettings(identity).state() })
  ipcMain.handle(SUPERAGENT_CHANNELS.configureWorker, async (event, identity: unknown, value: unknown) => { authorize(event); return executionSettings(identity).configure(value) })
  ipcMain.handle(SUPERAGENT_CHANNELS.refreshWorkerModels, async (event, identity: unknown) => { authorize(event); return executionSettings(identity).refreshModels() })
  ipcMain.handle(SUPERAGENT_CHANNELS.submitInput, async (event, input: unknown) => {
    authorize(event); return service.submitInput(input)
  })
  ipcMain.handle(SUPERAGENT_CHANNELS.snapshot, async (event, workspaceId: unknown) => {
    authorize(event); return service.snapshot(workspaceId)
  })
  ipcMain.handle(SUPERAGENT_CHANNELS.workDetail, async (event, workspaceId: unknown, workId: unknown) => {
    authorize(event); return service.workDetail(workspaceId, workId)
  })
  ipcMain.handle(SUPERAGENT_CHANNELS.readResource, async (event, workspaceId: unknown, resourceId: unknown) => {
    authorize(event); return service.readResource(workspaceId, resourceId)
  })
  ipcMain.handle(SUPERAGENT_CHANNELS.environments, async (event, workspaceId: unknown) => {
    authorize(event); return service.environmentSnapshot(workspaceId)
  })
  ipcMain.handle(SUPERAGENT_CHANNELS.decideEnvironmentOperation, async (event, value: unknown) => {
    authorize(event); return service.decideEnvironmentOperation(value)
  })
  ipcMain.handle(SUPERAGENT_CHANNELS.prepareWorker, async (event, input) => { authorize(event); return service.prepareWorker(input) })
  ipcMain.handle(SUPERAGENT_CHANNELS.startWorker, async (event, workspaceId, workId) => { authorize(event); return service.startWorker(workspaceId, workId) })
  ipcMain.handle(SUPERAGENT_CHANNELS.appendWorker, async (event, input) => { authorize(event); return service.appendWorker(input) })
  ipcMain.handle(SUPERAGENT_CHANNELS.continueWorker, async (event, input) => { authorize(event); return service.continueWorker(input) })
  ipcMain.handle(SUPERAGENT_CHANNELS.workers, async (event, workspaceId) => { authorize(event); return service.workerSnapshots(workspaceId) })
  ipcMain.handle(SUPERAGENT_CHANNELS.controlWorker, async (event, control) => { authorize(event); return service.controlWorker(control) })
  ipcMain.handle(SUPERAGENT_CHANNELS.workerLog, async (event, workspaceId, executionId) => { authorize(event); return service.workerLog(workspaceId, executionId) })
  ipcMain.handle(SUPERAGENT_CHANNELS.schedule, async (event, workspaceId) => { authorize(event); return service.scheduleSnapshot(workspaceId) })
  ipcMain.handle(SUPERAGENT_CHANNELS.workflows, async (event, workspaceId) => { authorize(event); return service.workflowSnapshot(workspaceId) })
  ipcMain.handle(SUPERAGENT_CHANNELS.controlWorkflow, async (event, control) => { authorize(event); return service.controlWorkflow(control) })
  ipcMain.handle(SUPERAGENT_CHANNELS.configureCapacity, async (event, value) => { authorize(event); return service.configureCapacity(value) })
  ipcMain.handle(SUPERAGENT_CHANNELS.controlWork, async (event, value) => { authorize(event); return service.controlWork(value) })
  ipcMain.handle(SUPERAGENT_CHANNELS.controlQueue, async (event, value) => { authorize(event); return service.controlQueue(value) })
  const publish = (channel: string, change: unknown) => {
    for (const window of options.getAllowedWindows()) {
      if (window.isDestroyed() || window.webContents.isDestroyed()) continue
      try { window.webContents.send(channel, change) }
      catch (error) { console.error('[superagent] window notification failed', error) }
    }
  }
  service.store.subscribe(change => publish(SUPERAGENT_CHANNELS.changed, change))
  service.environments?.store.subscribe(change => publish(SUPERAGENT_CHANNELS.environmentsChanged, change))
  service.workers?.subscribe(snapshot => publish(SUPERAGENT_CHANNELS.workerChanged, snapshot))
  service.scheduler?.subscribe(workspaceId => publish(SUPERAGENT_CHANNELS.scheduleChanged, { workspaceId }))
  service.workflows?.subscribe(workspaceId => publish(SUPERAGENT_CHANNELS.workflowsChanged, { workspaceId }))
  return service
}
