import { ipcMain, app, type BrowserWindow } from 'electron'
import { WORKSPACE_RUNTIME_CHANNELS, type RuntimeProbe, type RuntimeDirectory, type RuntimeTerminal } from '../../shared/workspace-runtime'
import { disconnectRuntimeTransports, listSshHosts, listWslDistributions, readWorkspaceRecord, runtimeRequest, validateRuntime } from '../workspace/runtime'
import { detectRemoteCli, installRemoteCli, remoteCliInstallStatus } from '../workspace/remote-cli'

export function registerWorkspaceRuntimeHandlers(getAllowedWindows: () => readonly BrowserWindow[]): void {
  const handle = (channel: string, operation: (...args: any[]) => Promise<unknown>) => ipcMain.handle(channel, (event, ...args) => {
    if (event.senderFrame !== event.sender.mainFrame || !getAllowedWindows().some(window => !window.isDestroyed() && window.webContents === event.sender)) throw new Error('Workspace request is not authorized')
    return operation(...args)
  })
  handle(WORKSPACE_RUNTIME_CHANNELS.distributions, listWslDistributions)
  handle(WORKSPACE_RUNTIME_CHANNELS.detectCli, detectRemoteCli)
  handle(WORKSPACE_RUNTIME_CHANNELS.installCli, installRemoteCli)
  handle(WORKSPACE_RUNTIME_CHANNELS.cliInstallStatus, remoteCliInstallStatus)
  handle(WORKSPACE_RUNTIME_CHANNELS.hosts, listSshHosts)
  handle(WORKSPACE_RUNTIME_CHANNELS.connect, runtime => runtimeRequest<RuntimeProbe>(validateRuntime(runtime), 'hello'))
  handle(WORKSPACE_RUNTIME_CHANNELS.browse, (runtime, path) => runtimeRequest<{ path: string; entries: RuntimeDirectory[] }>(validateRuntime(runtime), 'browse', { path }))
  handle(WORKSPACE_RUNTIME_CHANNELS.terminals, async id => {
    const workspace = await readWorkspaceRecord(id)
    if (!workspace.runtime || workspace.runtime.kind === 'windows') return []
    return runtimeRequest<RuntimeTerminal[]>(workspace.runtime, 'terminal.list', { workspaceId: id })
  })
  app.once('will-quit', disconnectRuntimeTransports)
}
