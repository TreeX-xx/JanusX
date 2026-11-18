import { runtimeCapability } from '../../shared/runtime/capabilities'
import { localRuntimeContext } from '../platform/runtime-context'
import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { access } from 'node:fs/promises'
import type { WorkerBackend } from '../../shared/superagent'
import { SUPERAGENT_CHANNELS } from '../../shared/ipc/superagent'
import { SuperAgentPersistence } from '../janus/superagent/persistence'
import { SuperAgentService } from '../janus/superagent/service'
import { SuperAgentHistory } from '../janus/superagent/history'
import { SuperAgentStore } from '../janus/superagent/store'
import { SuperAgentEnvironmentStore } from '../janus/superagent/environment-store'
import { SuperAgentEnvironments } from '../janus/superagent/environments'
import { SuperAgentWorkers } from '../janus/superagent/workers'
import { CliDetector } from '../external-cli/cli-detector'
import { managedCliEnv } from '../external-cli/managed-paths'
import { bindSuperAgentService, superAgentAvailable } from '../janus/superagent/host'
import { WorkerSettingsEngines, WorkerSettingsStore } from '../janus/superagent/worker-settings'
import { DesktopSuperAgentService } from '../janus/superagent/desktop-service'
import type { NativePluginService } from '../plugins/native-service'
import { SuperAgentRemoval, type ChooseRemoval } from '../janus/superagent/removal'
import { WorkerModelCatalog } from '../janus/superagent/worker-model-catalog'

// Note: .agents/notes/agent/superagent-plugin-migration.md — construct orchestration on first use.

interface SuperAgentHandlerOptions {
  activation?(workspaceId?: string): NativePluginService | undefined
  getAllowedWindows(): readonly BrowserWindow[]
  resolveWorkspaceRoot(workspaceId: string): Promise<string | undefined>
  getOccupiedPaths?(): readonly string[]
  workerSettings?: WorkerSettingsEngines
}

function createService(options: SuperAgentHandlerOptions, settings: WorkerSettingsEngines): SuperAgentService {
  const directory = join(app.getPath('userData'), 'janusx', 'superagent')
  const store = new SuperAgentStore(new SuperAgentPersistence(directory))
  const environments = new SuperAgentEnvironments(new SuperAgentEnvironmentStore(directory), store, options.resolveWorkspaceRoot, options.getOccupiedPaths)
  const resolveLaunch = async (backend?: WorkerBackend) => {
    const selected = await settings.defaults.resolveBackend(backend)
    const capability = runtimeCapability('managed-worker', selected, localRuntimeContext().identity)
    if (capability.status !== 'available') throw new Error(capability.message)
    const binary = await new CliDetector(selected).findCandidate()
    if (!binary) throw new Error(selected + ' is not installed. Use the existing terminal management setup first.')
    // IPC registration is emitted under main/chunks in both development and packaged builds.
    const mcpEntry = join(__dirname, '..', 'worker-mcp.js')
    try { await access(mcpEntry) } catch { throw new Error('The packaged Worker MCP entry is missing: ' + mcpEntry) }
    return { backend: selected, command: binary.path, env: managedCliEnv(), mcpCommand: process.execPath, mcpEntry }
  }
  const workers = new SuperAgentWorkers(store, environments, directory, resolveLaunch, settings.create, undefined, undefined, undefined, undefined, async () => (await settings.defaults.getIdleMinutes()) * 60_000)
  const service = new DesktopSuperAgentService(store, options.resolveWorkspaceRoot, environments, workers)
  service.workerPolicy = settings.defaults
  service.requireBackend = async backend => { await resolveLaunch(backend) }
  return service
}

export function registerSuperAgentHandlers(options: SuperAgentHandlerOptions, injected?: SuperAgentService) {
  let service: SuperAgentService | undefined
  let draining: Promise<void> | undefined
  let removal: SuperAgentRemoval | undefined
  let stopError: unknown
  const retire = () => {
    if (!service || draining) return draining ?? Promise.resolve()
    const previous = service
    removal?.freeze()
    removal = undefined
    service = undefined
    draining = previous.close().catch(error => {
      stopError = error
      console.error('[superagent] execution shutdown was not confirmed', error)
      throw error
    }).finally(() => { draining = undefined })
    return draining
  }
  let settings = options.workerSettings
  let history: SuperAgentHistory | undefined
  const getHistory = () => injected ?? (history ??= new SuperAgentHistory(join(app.getPath('userData'), 'janusx', 'superagent'), options.resolveWorkspaceRoot))
  let closed = false
  let storedDefaults: WorkerSettingsStore | undefined
  const defaults = () => settings?.defaults ?? (storedDefaults ??= new WorkerSettingsStore(join(app.getPath('userData'), 'janusx', 'superagent')))
  const publish = (channel: string, change: unknown) => {
    for (const window of options.getAllowedWindows()) {
      if (window.isDestroyed() || window.webContents.isDestroyed()) continue
      try { window.webContents.send(channel, change) }
      catch (error) { console.error('[superagent] window notification failed', error) }
    }
  }
  const available = (workspaceId?: string) => !closed && !draining && !stopError && Boolean(injected || options.activation?.(workspaceId))
  const getService = (scope?: unknown) => {
    if (closed) throw new Error('SuperAgent is shutting down')
    const workspaceId = typeof scope === 'string' ? scope : scope && typeof scope === 'object' && 'workspaceId' in scope && typeof scope.workspaceId === 'string' ? scope.workspaceId : undefined
    const activation = options.activation?.(workspaceId)
    if (!available(workspaceId)) throw new Error('SuperAgent is unavailable')
    if (service) return service
    const current = injected ?? createService(options, settings ??= new WorkerSettingsEngines(defaults()))
    if (activation && current instanceof DesktopSuperAgentService) {
      current.activation = activation
      removal = new SuperAgentRemoval(current, activation)
      current.removal = removal
      activation.ownCleanup(retire)
    }
    current.store.subscribe(change => publish(SUPERAGENT_CHANNELS.changed, change))
    current.environments?.store.subscribe(change => publish(SUPERAGENT_CHANNELS.environmentsChanged, change))
    current.workers?.subscribe(snapshot => publish(SUPERAGENT_CHANNELS.workerChanged, snapshot))
    current.scheduler?.subscribe(workspaceId => publish(SUPERAGENT_CHANNELS.scheduleChanged, { workspaceId }))
    current.workflows?.subscribe(workspaceId => publish(SUPERAGENT_CHANNELS.workflowsChanged, { workspaceId }))
    service = current
    return current
  }
  const admit = (scope?: unknown) => { removal?.assertAccepting(); return getService(scope) }
  const unbind = bindSuperAgentService(admit, (senderId, workspaceId) => available(workspaceId) && options.getAllowedWindows().some(window => !window.isDestroyed()
    && !window.webContents.isDestroyed() && window.webContents.id === senderId), workspaceId => {
      const signal = options.activation?.(workspaceId)?.signal
      return signal && removal ? AbortSignal.any([signal, removal.admission.signal]) : signal
    })
  const authorize = (event: IpcMainInvokeEvent): void => {
    const allowed = options.getAllowedWindows().some(window => !window.isDestroyed()
      && !window.webContents.isDestroyed() && window.webContents.id === event.sender.id)
    if (!allowed || !event.senderFrame || event.senderFrame !== event.sender.mainFrame) {
      throw new Error('SuperAgent records are only available to application main frames')
    }
  }
  ipcMain.handle(SUPERAGENT_CHANNELS.available, (event, workspaceId?: string) => { authorize(event); return superAgentAvailable(event.sender.id, workspaceId) })
  const configureDefaults = () => {
    if (!available()) throw new Error('SuperAgent is unavailable')
    removal?.assertAccepting()
    return defaults()
  }
  const modelCatalog = new WorkerModelCatalog()
  ipcMain.handle(SUPERAGENT_CHANNELS.workerModels, async (event, backend: unknown) => { authorize(event); return modelCatalog.get(backend) })
  const executionSettings = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Worker identity')
    const row = value as Record<string, unknown>
    if (Object.keys(row).some(key => !['workspaceId', 'workId', 'executionId'].includes(key))
      || !['workspaceId', 'workId', 'executionId'].every(key => typeof row[key] === 'string' && (row[key] as string).length > 0 && (row[key] as string).length <= 128)) throw new Error('Invalid Worker identity')
    const current = getService(row.workspaceId).workers?.snapshots(row.workspaceId as string).find(worker => worker.workId === row.workId && worker.executionId === row.executionId)
    if (!current || current.restored || current.stopConfirmed || current.retiredAt !== undefined || ['stopping', 'stopped', 'failed', 'interrupted'].includes(current.phase)) throw new Error('Worker execution changed or is unavailable')
    if (!settings) throw new Error('Worker settings adapter is unavailable')
    return settings.get(current.instanceId)
  }
  ipcMain.handle(SUPERAGENT_CHANNELS.workerDefaults, async (event, backend) => { authorize(event); return defaults().get(backend) })
  ipcMain.handle(SUPERAGENT_CHANNELS.workerPolicy, async event => { authorize(event); return defaults().policy() })
  ipcMain.handle(SUPERAGENT_CHANNELS.updateWorkerPolicy, async (event, value) => { authorize(event); return configureDefaults().updatePolicy(value) })
  ipcMain.handle(SUPERAGENT_CHANNELS.updateWorkerIdleTimeoutMinutes, async (event, minutes: unknown) => { authorize(event); return configureDefaults().updateIdleMinutes(minutes) })
  ipcMain.handle(SUPERAGENT_CHANNELS.workerIdleTimeoutMinutes, async event => { authorize(event); return defaults().getIdleMinutes() })
  ipcMain.handle(SUPERAGENT_CHANNELS.updateWorkerDefaults, async (event, value: unknown) => { authorize(event); return configureDefaults().update(value) })
  ipcMain.handle(SUPERAGENT_CHANNELS.workerSettings, async (event, identity: unknown) => { authorize(event); return executionSettings(identity).state() })
  ipcMain.handle(SUPERAGENT_CHANNELS.configureWorker, async (event, identity: unknown, value: unknown) => { authorize(event); return executionSettings(identity).configure(value) })
  ipcMain.handle(SUPERAGENT_CHANNELS.refreshWorkerModels, async (event, identity: unknown) => { authorize(event); return executionSettings(identity).refreshModels() })
  ipcMain.handle(SUPERAGENT_CHANNELS.submitInput, async (event, input: unknown) => {
    authorize(event); return admit(input).submitInput(input)
  })
  ipcMain.handle(SUPERAGENT_CHANNELS.snapshot, async (event, workspaceId: unknown) => {
    authorize(event); return getHistory().snapshot(workspaceId)
  })
  ipcMain.handle(SUPERAGENT_CHANNELS.workDetail, async (event, workspaceId: unknown, workId: unknown) => {
    authorize(event); return getHistory().workDetail(workspaceId, workId)
  })
  ipcMain.handle(SUPERAGENT_CHANNELS.readResource, async (event, workspaceId: unknown, resourceId: unknown) => {
    authorize(event); return getHistory().readResource(workspaceId, resourceId)
  })
  ipcMain.handle(SUPERAGENT_CHANNELS.environments, async (event, workspaceId: unknown) => {
    authorize(event); return getService(workspaceId).environmentSnapshot(workspaceId)
  })
  ipcMain.handle(SUPERAGENT_CHANNELS.decideEnvironmentOperation, async (event, value: unknown) => {
    authorize(event); return getService(value).decideEnvironmentOperation(value)
  })
  ipcMain.handle(SUPERAGENT_CHANNELS.prepareWorker, async (event, input) => { authorize(event); return admit(input).prepareWorker(input) })
  ipcMain.handle(SUPERAGENT_CHANNELS.startWorker, async (event, workspaceId, workId) => { authorize(event); return admit(workspaceId).startWorker(workspaceId, workId) })
  ipcMain.handle(SUPERAGENT_CHANNELS.appendWorker, async (event, input) => { authorize(event); return admit(input).appendWorker(input) })
  ipcMain.handle(SUPERAGENT_CHANNELS.continueWorker, async (event, input) => { authorize(event); return admit(input).continueWorker(input) })
  ipcMain.handle(SUPERAGENT_CHANNELS.workers, async (event, workspaceId) => { authorize(event); return getService(workspaceId).workerSnapshots(workspaceId) })
  ipcMain.handle(SUPERAGENT_CHANNELS.controlWorker, async (event, control) => { authorize(event); return getService(control).controlWorker(control) })
  ipcMain.handle(SUPERAGENT_CHANNELS.workerLog, async (event, workspaceId, executionId) => { authorize(event); return getService(workspaceId).workerLog(workspaceId, executionId) })
  ipcMain.handle(SUPERAGENT_CHANNELS.schedule, async (event, workspaceId) => { authorize(event); return getService(workspaceId).scheduleSnapshot(workspaceId) })
  ipcMain.handle(SUPERAGENT_CHANNELS.workflows, async (event, workspaceId) => { authorize(event); return getService(workspaceId).workflowSnapshot(workspaceId) })
  ipcMain.handle(SUPERAGENT_CHANNELS.controlWorkflow, async (event, control) => { authorize(event); return admit(control).controlWorkflow(control) })
  ipcMain.handle(SUPERAGENT_CHANNELS.configureCapacity, async (event, value) => { authorize(event); return admit().configureCapacity(value) })
  ipcMain.handle(SUPERAGENT_CHANNELS.controlWork, async (event, value) => { authorize(event); return getService(value).controlWork(value) })
  ipcMain.handle(SUPERAGENT_CHANNELS.controlQueue, async (event, value) => { authorize(event); return admit(value).controlQueue(value) })
  return {
    async pluginCall(method: string, value: import('@janusx/plugin-sdk').JsonValue) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid SuperAgent request')
      const workspace = typeof value.workspaceId === 'string' ? value.workspaceId : undefined
      if (!available(workspace)) throw new Error('SuperAgent is unavailable')
      if (method === 'superagent.settings.read') return { ...await defaults().policy() }
      if (method === 'superagent.settings.save') return { ...await defaults().updatePolicy(value.input) }
      if (method === 'superagent.workers.list' && workspace) {
        const current = getService(workspace)
        const [list, records, queue] = await Promise.all([current.workerSnapshots(workspace), current.snapshot(workspace), current.scheduleSnapshot(workspace)])
        return queue.entries.map(row => {
          const worker = list.find(w => w.workId === row.workId && w.executionId === row.executionId)
          return { title: records.works.find(w => w.id === row.workId)?.title ?? row.workId,
            phase: worker?.phase ?? row.status, backend: worker?.conversation.engine ?? null, queuePosition: row.queuePosition ?? null }
        })
      }
      throw new Error('Unknown SuperAgent request')
    },
    prepareRemoval: (choose: ChooseRemoval) => removal?.prepare(choose) ?? Promise.resolve(true),
    async close() {
      closed = true
      unbind()
      await retire()
      if (stopError) throw stopError
    },
  }
}
