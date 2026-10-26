// Note: .agents/notes/sessions/workspace-runtime-import.md
import { app } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile, rename, rm } from 'node:fs/promises'
import { join, posix } from 'node:path'
import { resolveRuntimeResource, runtimeRequest } from '../workspace/runtime'
import type { TrustedOfficeFile } from './office-workspace-guard'

/** A single-file preview cache, never an editable workspace mirror. */
export async function remoteOfficeFile(workspaceId: string, scope: string, relPath: string): Promise<TrustedOfficeFile> {
  const resource = await resolveRuntimeResource(scope)
  if (!resource || resource.workspaceId !== workspaceId) throw new Error('Office workspace does not match its scope')
  const digest = createHash('sha256').update(scope + '\0' + relPath).digest('hex')
  const rootPath = join(app.getPath('userData'), 'janusx', 'cache', 'workspace-office', workspaceId)
  return { workspaceId, rootPath, filePath: join(rootPath, digest + posix.extname(relPath).toLowerCase()), relPath,
    remote: { runtime: resource.runtime, root: resource.root, path: posix.join(resource.relative, relPath) } }
}

const versions = new Map<string, string>()
const pending = new Map<string, Promise<void>>()
const leases = new Map<string, string>()
const watching = new Map<string, { file: TrustedOfficeFile; timer?: NodeJS.Timeout }>()

export function syncRemoteOfficeFile(file: TrustedOfficeFile, force = false): Promise<void> {
  if (!file.remote) return Promise.resolve()
  const existing = pending.get(file.filePath)
  if (existing) return existing
  const task = (async () => {
    const remote = file.remote!
    const info = await runtimeRequest<{ isFile: boolean; mtime: number; size: number }>(remote.runtime, 'fs.stat', remote)
    if (!info.isFile || info.size > 32 * 1024 * 1024) throw new Error('Office preview file is unavailable or exceeds 32 MB')
    const version = `${info.mtime}:${info.size}`
    if (!force && versions.get(file.filePath) === version) return
    const content = await runtimeRequest<{ base64: string }>(remote.runtime, 'fs.binary', remote)
    await mkdir(file.rootPath, { recursive: true })
    const temporary = file.filePath + '.' + randomUUID() + '.tmp'
    try {
      await writeFile(temporary, Buffer.from(content.base64, 'base64'), { flag: 'wx' })
      await rename(temporary, file.filePath)
      versions.set(file.filePath, version)
    } finally { await rm(temporary, { force: true }).catch(() => undefined) }
  })()
  pending.set(file.filePath, task)
  void task.finally(() => pending.delete(file.filePath)).catch(() => undefined)
  return task
}

export function retainRemoteOfficePreview(id: string, file: TrustedOfficeFile): void {
  if (!file.remote) return
  leases.set(id, file.filePath)
  if (watching.has(file.filePath)) return
  const entry = { file, timer: undefined as NodeJS.Timeout | undefined }
  watching.set(file.filePath, entry)
  const refresh = async () => {
    let delay = 2000
    try { await syncRemoteOfficeFile(file) } catch { delay = 10000 }
    if (watching.get(file.filePath) !== entry) return
    entry.timer = setTimeout(() => { void refresh() }, delay)
    entry.timer.unref()
  }
  entry.timer = setTimeout(() => { void refresh() }, 2000)
  entry.timer.unref()
}

export function releaseRemoteOfficePreviews(ids: string[]): void {
  for (const id of ids) {
    const path = leases.get(id)
    leases.delete(id)
    if (!path || [...leases.values()].includes(path)) continue
    const entry = watching.get(path)
    if (entry?.timer) clearTimeout(entry.timer)
    watching.delete(path)
    versions.delete(path)
    // Cache cleanup follows any in-flight download to avoid resurrecting a
    // released cache. A newly acquired lease owns the file and prevents removal.
    void (pending.get(path) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      if (!watching.has(path)) await rm(path, { force: true }).catch(() => undefined)
    })
  }
}
