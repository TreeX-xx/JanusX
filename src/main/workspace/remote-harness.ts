// Note: .agents/notes/sessions/workspace-runtime-import.md
import type { BrowserWindow, IpcMain } from 'electron'
import { randomInt } from 'node:crypto'
import type { RegisterDocumentHandler } from '../harness/document-handlers'
import { HARNESS_EVENT_CHANNELS } from '../../shared/ipc/harness'
import { parseRuntimeResource, runtimeResource } from '../../shared/workspace-runtime'
import { resolveRuntimeResource, runtimeRequest, prepareRuntimeBackend } from './runtime'

const ownerBase = randomInt(1, 1_000_000_000)
export async function remoteBackendRequest<T>(cwd: string, method: string, args: unknown[] = [], owner = 0): Promise<T> {
  const resource = await resolveRuntimeResource(cwd)
  if (!resource) throw new Error('A remote workspace is required')
  await prepareRuntimeBackend(resource.runtime)
  return runtimeRequest<T>(resource.runtime, 'backend.request', { root: resource.root, path: resource.relative,
    method, args, owner: ownerBase + owner })
}

export function projectRemoteHarnessResult(value: unknown, workspaceId: string): unknown {
  if (Array.isArray(value)) return value.map(item => projectRemoteHarnessResult(item, workspaceId))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    if (['root', 'path', 'cwd', 'sourceRoot'].includes(key) && typeof child === 'string' && child.startsWith('/')) {
      return [key, runtimeResource(workspaceId, child)]
    }
    if ((key === 'projectId' || key === 'id') && typeof child === 'string' && child.startsWith('harness:project:')) {
      return [key, `${child}:workspace:${workspaceId}`]
    }
    return [key, projectRemoteHarnessResult(child, workspaceId)]
  }))
}

export function registerRemoteHarnessHandler(ipc: Pick<IpcMain, 'handle'>, getWindow: () => BrowserWindow | null): RegisterDocumentHandler {
  return (channel, handler) => ipc.handle(channel, async (event, cwd: string, ...args: unknown[]) => {
    const resource = parseRuntimeResource(cwd)
    if (!resource) return handler(event, cwd, ...args)
    const result = await remoteBackendRequest(cwd, channel, args, event.sender.id)
    if (/apply|undo|rescan|set|adopt/.test(channel)) {
      getWindow()?.webContents.send(HARNESS_EVENT_CHANNELS.changed, { root: cwd, rev: Date.now(), kinds: ['change'], external: false })
    }
    return projectRemoteHarnessResult(result, resource.workspaceId)
  })
}
