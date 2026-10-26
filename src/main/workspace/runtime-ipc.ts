// Note: .agents/notes/sessions/workspace-runtime-import.md
import { ipcMain as electronIpc, type IpcMainInvokeEvent } from 'electron'
import { posix } from 'node:path'
import { FILE_CHANNELS, FILE_TREE_CHANNELS } from '../../shared/ipc/workspace'
import { parseRuntimeResource, runtimeResource } from '../../shared/workspace-runtime'
import { resolveRuntimeResource, runtimeRequest } from './runtime'
import { authorizeRendererAction } from '../agent/runtime/shell-runtime'

const mime: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.bmp': 'image/bmp', '.ico': 'image/x-icon' }

export async function remoteFileInvocation(channel: string, args: unknown[]): Promise<{ handled: boolean; result?: unknown }> {
  if (typeof args[0] !== 'string' || !parseRuntimeResource(args[0])) return { handled: false }
  const resource = await resolveRuntimeResource(args[0])
  if (!resource) return { handled: false }
  const { runtime, root, relative } = resource
  const invoke = (method: string, params: Record<string, unknown> = {}) => runtimeRequest(runtime, method, { root, path: relative, ...params })
  if (channel === FILE_CHANNELS.read) return { handled: true, result: await invoke('fs.read') }
  if (channel === FILE_CHANNELS.readBinary) return { handled: true, result: { ...await invoke('fs.binary') as object, mimeType: mime[posix.extname(resource.path).toLowerCase()] || 'application/octet-stream' } }
  if (channel === FILE_CHANNELS.stat) return { handled: true, result: await invoke('fs.stat') }
  if (channel === FILE_CHANNELS.save) return { handled: true, result: await invoke('fs.save', { content: args[1], expectedVersion: args[2] }) }
  if (channel === FILE_TREE_CHANNELS.load || channel === FILE_TREE_CHANNELS.children) {
    const child = typeof args[1] === 'string' ? args[1] : ''
    return { handled: true, result: await invoke('fs.list', { path: posix.join(relative, child) }) }
  }
  const name = (value: unknown): string => {
    if (typeof value !== 'string' || !value || value === '.' || value === '..' || /[\0/\\]/.test(value)) throw new Error('Invalid file name')
    return value
  }
  if (channel === FILE_TREE_CHANNELS.createFile || channel === FILE_TREE_CHANNELS.createDirectory) {
    return { handled: true, result: await invoke('fs.mutate', { operation: channel === FILE_TREE_CHANNELS.createFile ? 'create' : 'mkdir', path: posix.join(relative, String(args[1]), name(args[2])) }) }
  }
  if (channel === FILE_TREE_CHANNELS.rename || channel === FILE_TREE_CHANNELS.move || channel === FILE_TREE_CHANNELS.delete) {
    const path = posix.join(relative, String(args[1]))
    const destination = channel === FILE_TREE_CHANNELS.rename ? posix.join(posix.dirname(path), name(args[2]))
      : channel === FILE_TREE_CHANNELS.move ? posix.join(relative, String(args[2]), posix.basename(path)) : undefined
    return { handled: true, result: await invoke('fs.mutate', { operation: channel === FILE_TREE_CHANNELS.delete ? 'delete' : 'rename', path, destination }) }
  }
  if (channel === FILE_TREE_CHANNELS.reveal) return { handled: true, result: { success: false, error: 'Use the workspace file tree to browse this Linux directory' } }
  throw new Error(`This operation is not available for this workspace yet: ${channel}`)
}

/** Explicit bridge for filesystem handlers; local handler and policy stay intact. */
export const workspaceFileIpc = {
  handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => any): void {
    electronIpc.handle(channel, async (event, ...args) => {
      const mutation = channel === FILE_CHANNELS.save || [FILE_TREE_CHANNELS.createFile, FILE_TREE_CHANNELS.createDirectory, FILE_TREE_CHANNELS.rename, FILE_TREE_CHANNELS.move, FILE_TREE_CHANNELS.delete].includes(channel as never)
      if (parseRuntimeResource(args[0])) {
        if (event.senderFrame !== event.sender.mainFrame) throw new Error('Workspace operations require the application frame')
        if (mutation && !await authorizeRendererAction(event, { workspaceRoot: args[0], toolName: channel, actionRisk: channel === FILE_TREE_CHANNELS.delete ? 'delete' : 'write', source: 'renderer-user', preview: { summary: 'Change workspace file', paths: [args[0]], truncated: false } })) throw new Error('Workspace operation denied')
      }
      const remote = await remoteFileInvocation(channel, args)
      if (remote.handled && mutation && !(remote.result as { conflict?: boolean })?.conflict) {
        const resource = await resolveRuntimeResource(args[0])
        if (resource) event.sender.send(FILE_TREE_CHANNELS.changed, { workspacePath: runtimeResource(resource.workspaceId, resource.root) })
      }
      return remote.handled ? remote.result : listener(event, ...args)
    })
  },
}
