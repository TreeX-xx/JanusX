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

interface SuperAgentHandlerOptions {
  getAllowedWindows(): readonly BrowserWindow[]
  resolveWorkspaceRoot(workspaceId: string): Promise<string | undefined>
  getOccupiedPaths?(): readonly string[]
}

function createService(options: SuperAgentHandlerOptions): SuperAgentService {
  const directory = join(app.getPath('userData'), 'janusx', 'superagent')
  const store = new SuperAgentStore(new SuperAgentPersistence(directory))
  const environments = new SuperAgentEnvironments(new SuperAgentEnvironmentStore(directory), store, options.resolveWorkspaceRoot, options.getOccupiedPaths)
  const workers = new SuperAgentWorkers(store, environments, directory, async () => {
    if (process.platform !== 'win32') throw new Error('Managed Worker permissions are currently verified on Windows MXC; this platform is not enabled yet')
    const binary = await new CliDetector('codex').findCandidate()
    if (!binary) throw new Error('Codex is not installed. Use the existing terminal management setup first.')
    // IPC registration is emitted under main/chunks in both development and packaged builds.
    return { command: binary.path, env: managedCliEnv(), mcpCommand: process.execPath, mcpEntry: join(__dirname, '..', 'worker-mcp.js') }
  })
  return new SuperAgentService(store, options.resolveWorkspaceRoot, environments, workers)
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
  ipcMain.handle(SUPERAGENT_CHANNELS.configureCapacity, async (event, value) => { authorize(event); return service.configureCapacity(value) })
  ipcMain.handle(SUPERAGENT_CHANNELS.controlWork, async (event, value) => { authorize(event); return service.controlWork(value) })
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
  return service
}
