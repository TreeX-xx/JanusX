// Note: .agents/notes/desktop/workspace-state-storage.md
import { randomUUID, createHash } from 'node:crypto'
import { lstat, realpath, opendir, mkdir, open, readFile, rename, unlink, rmdir } from 'node:fs/promises'
import { dirname, join, relative, resolve, isAbsolute, sep, basename } from 'node:path'
import { workspaceIo, workspaceStorageInUse, suspendWorkspaceStorage, assertWorkspaceStorageAvailable, type WorkspaceStorage } from '@janus-agent/agent-core'
import type { WorkspaceMigrationItem, WorkspaceDataItem, WorkspaceDataRecord, WorkspaceCleanupCategory } from '../../shared/ipc/workspace-storage'

interface Entry { id: string; path: string; identity: string; legacy: boolean; managed?: boolean; name?: string; relocatingTo?: string; purging?: boolean }
interface Registry { schema: 1; promptDismissed: boolean; entries: Entry[] }
interface CopiedFile { source: string; target: string; hash: string; size: number }
interface Manifest { schema: 1; storageId: string; path: string; retentionStartedAt?: string; detachedAt?: string; purging?: boolean; cleanupError?: string; migration?: { completedAt: string; files: CopiedFile[]; cleanupComplete: boolean } }
export const WORKSPACE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const CATEGORIES = ['janusX.launch.json', 'checkpoints', 'logs'] as const
const COPY_CATEGORIES = ['janusX.launch.json', 'logs'] as const
const normalize = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path)
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true } catch (error) { if (missing(error)) return false; throw error }
}
function within(root: string, path: string): boolean {
  const rel = relative(root, path)
  return !!rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}
/** Reject redirected roots/parents, including Windows junctions, before any copy/delete. */
async function plain(path: string): Promise<void> {
  const info = await lstat(path)
  if (info.isSymbolicLink() || normalize(await realpath(path)) !== normalize(path)) throw new Error(`Linked storage path is unavailable: ${path}`)
}
async function ensureDirectory(root: string, path: string): Promise<void> {
  if (normalize(root) !== normalize(path) && !within(root, path)) throw new Error('Destination escapes workspace storage')
  await plain(root)
  let current = root
  for (const part of relative(root, path).split(sep).filter(Boolean)) {
    current = join(current, part)
    if (await exists(current)) await plain(current)
    else await mkdir(current)
  }
}
function supported(source: string): boolean {
  const path = source.split(sep).join('/')
  return path === 'janusX.launch.json' || /^checkpoints\/[^/]+\.json$/.test(path)
    || /^checkpoints\/blobs\/[a-f0-9]{40}$/.test(path) || /^logs\/[^/]+\.log$/.test(path)
}
async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx')
  try { await handle.writeFile(JSON.stringify(value, null, 2)); await handle.sync() }
  catch (error) { await handle.close(); await unlink(temporary).catch(() => {}); throw error }
  await handle.close()
  try { await rename(temporary, path) } catch (error) { await unlink(temporary).catch(() => {}); throw error }
}

/** Local profile owner. All public methods run inside the shared workspace lane. */
export class WorkspaceStateStore {
  readonly root: string
  private registry?: Registry
  private loading?: Promise<Registry>
  private manifests = new Map<string, Manifest>()
  private registryDirty = false
  private maintenanceAt = new Map<string, number>()
  hasDeferredMaintenance = false
  onChange?: () => void
  completeRelocation?: (oldPath: string, newPath: string) => Promise<void>

  constructor(userData: string, private readonly beforeMigration: (cwd: string) => Promise<void> = async () => {}) {
    this.root = join(resolve(userData), 'janusx', 'workspace-state')
  }

  private async load(): Promise<Registry> {
    if (this.registry) return this.registry
    this.loading ??= (async () => {
      try {
        const data = JSON.parse(await readFile(join(this.root, 'registry.json'), 'utf8')) as Registry
        if (data.schema !== 1 || !Array.isArray(data.entries) || data.entries.some(e => !/^[a-f0-9-]{36}$/.test(e.id) || typeof e.path !== 'string' || typeof e.identity !== 'string' || (e.purging !== undefined && typeof e.purging !== 'boolean') || (e.relocatingTo !== undefined && typeof e.relocatingTo !== 'string'))) throw new Error('Unknown workspace storage registry')
        return this.registry = data
      } catch (error) {
        if (!missing(error)) throw error
        return this.registry = { schema: 1, promptDismissed: false, entries: [] }
      }
    })().catch(error => { this.loading = undefined; throw error })
    return this.loading
  }

  private async saveRegistry(): Promise<void> {
    if (!this.registryDirty) return
    await this.safeDestination()
    await atomicJson(join(this.root, 'registry.json'), this.registry)
    this.registryDirty = false
  }

  private async safeDestination(): Promise<void> {
    // Check every existing ancestor before mkdir; missing children are created below this verified chain.
    const ancestors: string[] = []
    for (let path = this.root; ; path = dirname(path)) {
      ancestors.push(path)
      if (dirname(path) === path) break
    }
    for (const path of ancestors.reverse()) if (await exists(path)) await plain(path)
    await mkdir(this.root, { recursive: true })
    await plain(this.root)
  }

  private async entry(cwd: string): Promise<Entry> {
    const canonical = await realpath(cwd)
    const info = await lstat(canonical, { bigint: true })
    if (!info.isDirectory()) throw new Error('Workspace is not a directory')
    const registry = await this.load()
    const identity = `${info.dev}:${info.ino}:${info.birthtimeNs}`
    if (registry.entries.some(e => e.relocatingTo && normalize(e.relocatingTo) === normalize(canonical) && e.identity === identity)) throw new Error('Workspace relocation is pending; check workspace data before retrying')
    let entry = registry.entries.find(e => normalize(e.path) === normalize(canonical) && e.identity === identity)
    if (!entry) {
      // Path reuse gets a new id. Moves require explicit reassociation in the lifecycle stage.
      let legacy = false
      for (const category of CATEGORIES) if (await exists(join(canonical, '.janusX', category))) legacy = true
      entry = { id: randomUUID(), path: canonical, identity, legacy }
      registry.entries.push(entry)
      this.registryDirty = true
      // Read-only discovery keeps this association in memory; first real write persists it.
    }
    return entry
  }

  private async manifest(entry: Entry): Promise<Manifest | undefined> {
    const cached = this.manifests.get(entry.id)
    if (cached) return cached
    try {
      const path = join(this.root, entry.id)
      await plain(path)
      await plain(join(path, 'manifest.json'))
      const data = JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8')) as Manifest
      if (data.schema !== 1 || data.storageId !== entry.id || (data.detachedAt !== undefined && !Number.isFinite(Date.parse(data.detachedAt))) || (data.purging !== undefined && typeof data.purging !== 'boolean') || (data.retentionStartedAt !== undefined && !Number.isFinite(Date.parse(data.retentionStartedAt))) || (data.migration && (!Array.isArray(data.migration.files) || typeof data.migration.cleanupComplete !== 'boolean' || !Number.isFinite(Date.parse(data.migration.completedAt))))) throw new Error('Unknown workspace storage manifest')
      if (data.migration?.files.some(file => !supported(file.source) || file.target !== (file.source === 'janusX.launch.json' ? 'launch.json' : file.source) || !/^[a-f0-9]{64}$/.test(file.hash))) throw new Error('Invalid workspace migration receipt')
      this.manifests.set(entry.id, data)
      return data
    } catch (error) { if (missing(error)) return undefined; throw error }
  }

  async resolve(cwd: string, write = false): Promise<WorkspaceStorage> {
    return workspaceIo.run(cwd, async () => {
      assertWorkspaceStorageAvailable(cwd)
      const entry = await this.entry(cwd)
      const manifest = await this.manifest(entry)
      if (manifest?.purging || entry.purging) throw new Error('Workspace data removal is in progress')
      const legacy = entry.legacy && !manifest?.migration
      const root = legacy ? join(entry.path, '.janusX') : join(this.root, entry.id)
      if (write) {
        if (manifest?.detachedAt) await this.saveManifest(entry, { ...manifest, detachedAt: undefined, cleanupError: undefined })
        await this.saveRegistry()
        if (!legacy) {
          await this.safeDestination()
          if (await exists(root)) await plain(root)
          if (!manifest) {
            const created: Manifest = { schema: 1, storageId: entry.id, path: entry.path }
            await atomicJson(join(root, 'manifest.json'), created)
            this.manifests.set(entry.id, created)
          }
        }
        const next = Math.min(this.maintenanceAt.get(entry.id) ?? 0, Date.now() + WORKSPACE_RETENTION_MS)
        if (this.maintenanceAt.get(entry.id) !== next) {
          this.maintenanceAt.set(entry.id, next)
          this.onChange?.()
        }
      }
      return { root, launchPath: join(root, legacy ? 'janusX.launch.json' : 'launch.json'), checkpointsPath: join(root, 'checkpoints'), logsPath: join(root, 'logs'), retentionStartedAt: manifest?.retentionStartedAt }
    })
  }

  private async saveManifest(entry: Entry, value: Manifest): Promise<void> {
    await this.safeDestination()
    const root = join(this.root, entry.id)
    if (await exists(root)) await plain(root)
    await atomicJson(join(root, 'manifest.json'), value)
    this.manifests.set(entry.id, value)
  }

  private async associated(entry: Entry, record: WorkspaceDataRecord): Promise<boolean> {
    if (normalize(record.path) !== normalize(entry.path)) return false
    try {
      const info = await lstat(await realpath(record.path), { bigint: true })
      return `${info.dev}:${info.ino}:${info.birthtimeNs}` === entry.identity
    } catch { return true /* Unavailable is not deleted. */ }
  }

  /** Derive persistent ownership from workspace records, never from an extra reference counter. */
  async sync(records: WorkspaceDataRecord[], now = Date.now()): Promise<void> {
    await workspaceIo.run(this.root, async batch => {
      const registry = await this.load()
      for (const entry of registry.entries) {
        if (!entry.relocatingTo) continue
        if (records.some(record => normalize(record.path) === normalize(entry.relocatingTo!))) {
          const canonical = await realpath(entry.relocatingTo)
          const info = await lstat(canonical, { bigint: true })
          if (`${info.dev}:${info.ino}:${info.birthtimeNs}` !== entry.identity) throw new Error('Relocated directory identity changed')
          await this.completeRelocation?.(entry.path, canonical)
          for (const record of records) if (normalize(record.path) === normalize(entry.path)) record.path = canonical
          entry.path = canonical
          const manifest = await this.manifest(entry)
          if (manifest) await this.saveManifest(entry, { ...manifest, path: canonical })
        }
        delete entry.relocatingTo; this.registryDirty = true
      }
      const updated = new Set<string>()
      for (const record of records) {
        try {
          const entry = await this.entry(record.path)
          if (updated.has(entry.id)) { await batch.step(); continue }
          updated.add(entry.id)
          if (!entry.managed || entry.name !== record.name) {
            entry.managed = true; entry.name = record.name; this.registryDirty = true
          }
          const manifest = await this.manifest(entry)
          if (manifest?.detachedAt && !manifest.purging && !entry.purging) {
            await this.saveManifest(entry, { ...manifest, detachedAt: undefined, cleanupError: undefined })
            this.maintenanceAt.delete(entry.id)
          }
        } catch {
          // P2 entries predate managed/name fields; preserve ownership even while offline.
          for (const entry of registry.entries) if (normalize(entry.path) === normalize(record.path) && !entry.managed) {
            entry.managed = true; entry.name = record.name; this.registryDirty = true
          }
          // Unknown manifests are retained rather than rewritten.
        }
        await batch.step()
      }
      for (const entry of [...registry.entries]) {
        let associated = false
        for (const record of records) if (await this.associated(entry, record)) { associated = true; break }
        if (!entry.managed || associated) continue
        try {
          const manifest = await this.manifest(entry)
          if (manifest && !manifest.detachedAt && !manifest.purging) {
            await this.saveManifest(entry, { ...manifest, detachedAt: new Date(now).toISOString() })
            this.maintenanceAt.delete(entry.id)
          }
          if (!manifest && !entry.purging && !await exists(join(this.root, entry.id))) {
            registry.entries = registry.entries.filter(item => item !== entry); this.registryDirty = true
          }
        } catch { /* Unknown or unreadable data is preserved and reported by data(). */ }
        await batch.step()
      }
      await this.saveRegistry()
    })
  }

  async data(records: WorkspaceDataRecord[]): Promise<WorkspaceDataItem[]> {
    await this.sync(records)
    return workspaceIo.run(this.root, async batch => {
      const items: WorkspaceDataItem[] = []
      for (const entry of (await this.load()).entries) {
        const workspaceIds: string[] = []
        for (const record of records) if (await this.associated(entry, record)) workspaceIds.push(record.id)
        const item: WorkspaceDataItem = { id: entry.id, name: entry.name ?? basename(entry.path), path: entry.path, target: join(this.root, entry.id), workspaceIds, legacy: entry.legacy, status: 'associated' }
        try {
          const manifest = await this.manifest(entry)
          item.legacy = entry.legacy && !manifest?.migration
          if (manifest?.detachedAt) {
            item.detachedAt = manifest.detachedAt
            item.expiresAt = new Date(Date.parse(manifest.detachedAt) + WORKSPACE_RETENTION_MS).toISOString()
            item.status = 'detached'
          } else {
            try {
              const info = await lstat(await realpath(entry.path), { bigint: true })
              if (`${info.dev}:${info.ino}:${info.birthtimeNs}` !== entry.identity) item.status = 'offline'
            } catch { item.status = 'offline' }
          }
          if (manifest?.purging || entry.purging) item.status = 'purging'
          if (manifest?.cleanupError) {
            if (item.status !== 'purging') item.status = 'failed'
            item.error = manifest.cleanupError
          }
        } catch (error) { item.status = 'failed'; item.error = String(error) }
        items.push(item); await batch.step()
      }
      for (const record of records) if (!items.some(item => item.workspaceIds.includes(record.id))) {
        items.push({ id: `unavailable:${record.id}`, name: record.name, path: record.path, target: '', workspaceIds: [record.id], legacy: false, status: 'offline' })
      }
      return items
    }, { background: true })
  }

  async relocate(id: string, destination: string, commitRecords: (oldPath: string, newPath: string) => Promise<void>): Promise<void> {
    await workspaceIo.run(this.root, async () => {
      const entry = (await this.load()).entries.find(item => item.id === id)
      if (!entry) throw new Error('Workspace storage is no longer registered')
      const canonical = await realpath(destination), info = await lstat(canonical, { bigint: true })
      if (!info.isDirectory() || `${info.dev}:${info.ino}:${info.birthtimeNs}` !== entry.identity) throw new Error('WORKSPACE_IDENTITY_MISMATCH')
      if ((await this.load()).entries.some(item => item !== entry && normalize(item.path) === normalize(canonical))) throw new Error('Destination is already associated; remove the duplicate workspace first')
      if ((await this.manifest(entry))?.purging || entry.purging) throw new Error('Workspace data removal is in progress')
      await this.beforeMigration(entry.path)
      if (workspaceStorageInUse(entry.path) || workspaceStorageInUse(canonical)) throw new Error('Close workspace commands before relocating')
      const releaseOld = suspendWorkspaceStorage(entry.path), releaseNew = normalize(entry.path) === normalize(canonical) ? () => {} : suspendWorkspaceStorage(canonical)
      try {
        entry.relocatingTo = canonical; this.registryDirty = true; await this.saveRegistry()
        await commitRecords(entry.path, canonical)
        entry.path = canonical
        const manifest = await this.manifest(entry)
        if (manifest) await this.saveManifest(entry, { ...manifest, path: canonical })
        delete entry.relocatingTo; this.registryDirty = true; await this.saveRegistry()
      } finally { releaseNew(); releaseOld() }
    })
  }

  private async *privateFiles(root: string, directory = root): AsyncGenerator<string> {
    if (!await exists(directory)) return
    await plain(directory)
    for await (const item of await opendir(directory)) {
      const path = join(directory, item.name)
      await plain(path)
      if (item.isDirectory()) {
        const rel = relative(root, path).split(sep).join('/')
        if (!['logs', 'checkpoints', 'checkpoints/blobs'].includes(rel)) throw new Error(`Unknown private directory retained: ${rel}`)
        yield* this.privateFiles(root, path)
      }
      else if (item.isFile()) yield path
      else throw new Error('Unsupported private data entry')
      await workspaceIo.step()
    }
  }

  async measure(id: string): Promise<number> {
    return workspaceIo.run(this.root, async () => {
      const entry = (await this.load()).entries.find(item => item.id === id)
      if (!entry) throw new Error('Workspace storage is no longer registered')
      await this.manifest(entry)
      let bytes = 0
      for await (const path of this.privateFiles(join(this.root, entry.id))) bytes += (await lstat(path)).size
      return bytes
    }, { background: true })
  }

  private async removeTree(path: string): Promise<void> {
    if (!await exists(path)) return
    await plain(path)
    for await (const item of await opendir(path)) {
      const child = join(path, item.name)
      await plain(child)
      if (item.isDirectory()) await this.removeTree(child)
      else if (item.isFile()) await unlink(child)
      else throw new Error('Unsupported private data entry')
      await workspaceIo.step()
    }
    await rmdir(path)
  }

  async cleanup(id: string, category: WorkspaceCleanupCategory): Promise<void> {
    await workspaceIo.run(this.root, async () => {
      const registry = await this.load(), entry = registry.entries.find(item => item.id === id)
      if (!entry) throw new Error('Workspace storage is no longer registered')
      const manifest = await this.manifest(entry) ?? (entry.purging ? { schema: 1 as const, storageId: entry.id, path: entry.path, purging: true } : undefined)
      if (!manifest) throw new Error('No verified private data manifest')
      if (workspaceStorageInUse(entry.path)) throw new Error('Close workspace commands before clearing data')
      await this.beforeMigration(entry.path)
      const release = suspendWorkspaceStorage(entry.path)
      try {
        const root = join(this.root, entry.id)
        if (category === 'all') {
          if (!manifest.detachedAt && !manifest.purging) throw new Error('Remove the workspace before permanently clearing its data')
          // Validate the complete tree before committing deletion; redirects are never followed.
          for await (const path of this.privateFiles(root)) {
            const rel = relative(root, path)
            if (rel !== 'manifest.json' && rel !== 'launch.json' && !supported(rel)) throw new Error(`Unknown private file retained: ${rel}`)
          }
          entry.purging = true; this.registryDirty = true; await this.saveRegistry()
          if (await exists(root)) await this.saveManifest(entry, { ...manifest, purging: true, cleanupError: undefined })
          // Keep the manifest until last, so interrupted deletion remains discoverable.
          if (await exists(root)) {
            for await (const item of await opendir(root)) if (item.name !== 'manifest.json') {
              const path = join(root, item.name)
              if (item.isDirectory()) await this.removeTree(path); else { await plain(path); await unlink(path) }
              await workspaceIo.step()
            }
            await unlink(join(root, 'manifest.json')); await rmdir(root)
          }
          registry.entries = registry.entries.filter(item => item !== entry)
          this.manifests.delete(entry.id); this.registryDirty = true; await this.saveRegistry()
        } else {
          if (entry.purging || manifest.purging) throw new Error('Workspace data removal is in progress')
          if (category === 'checkpoints') await this.removeSnapshots(root)
          else {
            for await (const path of this.privateFiles(root, join(root, category))) {
              const rel = relative(root, path)
              if (rel.startsWith(category + sep) && !supported(rel)) throw new Error(`Unknown private file retained: ${rel}`)
            }
            await this.removeTree(join(root, category))
          }
          if (manifest.cleanupError) await this.saveManifest(entry, { ...manifest, cleanupError: undefined })
        }
      } catch (error) {
        const current = this.manifests.get(entry.id)
        if (current && await exists(join(this.root, entry.id))) await this.saveManifest(entry, { ...current, cleanupError: String(error) })
        throw error
      } finally { release() }
    }, { background: true })
  }

  /** Retired snapshots are discarded by explicit migration/cleanup, never copied or aged. */
  private async removeSnapshots(root: string): Promise<void> {
    const directory = join(root, 'checkpoints')
    if (!await exists(directory)) return
    await plain(root)
    for await (const path of this.privateFiles(root, directory)) {
      const rel = relative(root, path)
      const original = rel.endsWith('.migration-tmp') ? rel.slice(0, -'.migration-tmp'.length) : rel
      if (!supported(original)) throw new Error('Unknown snapshot file retained: ' + rel)
    }
    await this.removeTree(directory)
  }

  /** Metadata-only expiry; no source scans or log-body reads. Returns one next wake time. */
  async maintain(records: WorkspaceDataRecord[], now = Date.now()): Promise<number | undefined> {
    return workspaceIo.run(this.root, async () => {
      await this.sync(records, now)
      this.hasDeferredMaintenance = false
      let next: number | undefined
      const later = (date: number) => { if (Number.isFinite(date) && date > now) next = Math.min(next ?? Infinity, date) }
      for (const entry of [...(await this.load()).entries]) {
        await workspaceIo.step()
        try {
          const manifest = await this.manifest(entry)
          if (entry.purging) {
            if (workspaceStorageInUse(entry.path)) { this.hasDeferredMaintenance = true; continue }
            try { await this.beforeMigration(entry.path) } catch { this.hasDeferredMaintenance = true; continue }
            await this.cleanup(entry.id, 'all'); continue
          }
          if (!manifest) continue
          // Keep receipt copies intact until the explicit P2 source cleanup finishes.
          if (manifest.migration && !manifest.migration.cleanupComplete) continue
          const expiry = manifest.detachedAt ? Date.parse(manifest.detachedAt) + WORKSPACE_RETENTION_MS : undefined
          const scheduled = this.maintenanceAt.get(entry.id)
          if (!manifest.purging && (expiry === undefined || expiry > now) && scheduled !== undefined && scheduled > now) {
            if (expiry) later(expiry)
            later(scheduled)
            continue
          }
          if (workspaceStorageInUse(entry.path)) { this.hasDeferredMaintenance = true; continue }
          try { await this.beforeMigration(entry.path) } catch { this.hasDeferredMaintenance = true; continue }
          if (manifest.purging || expiry !== undefined && expiry <= now) { await this.cleanup(entry.id, 'all'); continue }
          if (expiry) later(expiry)
          const resume = suspendWorkspaceStorage(entry.path)
          try {
            let entryNext = Infinity
            const logs = join(this.root, entry.id, 'logs')
            if (!await exists(logs)) { this.maintenanceAt.set(entry.id, entryNext); continue }
            await plain(logs)
            for await (const item of await opendir(logs)) {
              await workspaceIo.step()
              if (!item.isFile() || !item.name.endsWith('.log')) continue
              const path = join(logs, item.name)
              await plain(path)
              const info = await lstat(path)
              const expires = Math.max(info.mtimeMs, manifest.retentionStartedAt ? Date.parse(manifest.retentionStartedAt) : 0) + WORKSPACE_RETENTION_MS
              if (expires <= now) {
                if (workspaceStorageInUse(entry.path)) break
                await this.beforeMigration(entry.path)
                const current = await lstat(path)
                if (current.mtimeMs === info.mtimeMs && current.size === info.size) await unlink(path)
              } else { later(expires); entryNext = Math.min(entryNext, expires) }
            }
            this.maintenanceAt.set(entry.id, entryNext)
            if (manifest.cleanupError) await this.saveManifest(entry, { ...manifest, cleanupError: undefined })
          } finally { resume() }
        } catch (error) {
          const manifest = this.manifests.get(entry.id)
          if (manifest && !manifest.cleanupError) await this.saveManifest(entry, { ...manifest, cleanupError: String(error) })
        }
      }
      return next
    }, { background: true })
  }

  async inspect(cwd: string, id: string, name: string): Promise<WorkspaceMigrationItem> {
    return workspaceIo.run(cwd, async () => {
      const source = join(cwd, '.janusX')
      try {
        const entry = await this.entry(cwd)
        const manifest = await this.manifest(entry)
        const categories: string[] = []
        for (const category of CATEGORIES) if (await exists(join(source, category))) categories.push(category)
        const retired = await exists(join(this.root, entry.id, 'checkpoints'))
        if (retired && !categories.includes('checkpoints')) categories.push('checkpoints')
        return { id, name, source, target: join(this.root, entry.id), categories,
          status: manifest?.migration ? manifest.migration.cleanupComplete && !categories.includes('checkpoints') ? 'migrated' : 'cleanup-pending' : categories.length ? 'pending' : 'new' }
      } catch (error) {
        return { id, name, source, target: this.root, categories: [], status: missing(error) ? 'offline' : 'failed', error: String(error) }
      }
    }, { background: true })
  }

  async promptDismissed(): Promise<boolean> { return (await this.load()).promptDismissed }
  async dismissPrompt(): Promise<void> {
    await workspaceIo.run(this.root, async () => { (await this.load()).promptDismissed = true; this.registryDirty = true; await this.saveRegistry() })
  }

  private async *inventory(root: string): AsyncGenerator<string> {
    await plain(root)
    for await (const item of await opendir(root)) {
      await workspaceIo.step()
      if (item.isSymbolicLink()) throw new Error('Linked migration source is unavailable: ' + join(root, item.name))
      if (item.isFile()) yield item.name
      else if (!item.isDirectory()) throw new Error('Unsupported migration file: ' + join(root, item.name))
    }
  }

  private async digest(path: string, destination?: string): Promise<{ hash: string; size: number }> {
    await plain(path)
    const before = await lstat(path)
    const source = await open(path, 'r')
    let output: Awaited<ReturnType<typeof open>> | undefined
    const hash = createHash('sha256')
    let size = 0
    try {
      if (destination) output = await open(destination, 'wx')
      const buffer = Buffer.allocUnsafe(64 * 1024)
      for (;;) {
        const { bytesRead } = await source.read(buffer, 0, buffer.length, null)
        if (!bytesRead) break
        size += bytesRead
        if (size > before.size) throw new Error('Migration source grew during copy')
        hash.update(buffer.subarray(0, bytesRead))
        if (output) {
          for (let offset = 0; offset < bytesRead;) {
            const { bytesWritten } = await output.write(buffer, offset, bytesRead - offset)
            if (!bytesWritten) throw new Error('Migration write made no progress')
            offset += bytesWritten
          }
        }
        if (bytesRead === buffer.length) await workspaceIo.yield()
      }
      await output?.sync()
    } finally { await source.close(); await output?.close() }
    const after = await lstat(path)
    if (size !== before.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.ino !== after.ino) throw new Error(`Migration source changed: ${path}`)
    return { hash: hash.digest('hex'), size }
  }

  private checked(root: string, rel: string): string {
    const path = resolve(root, rel)
    if (!within(root, path) || !rel || rel.includes('\0')) throw new Error('Invalid migration receipt path')
    return path
  }

  async migrate(cwd: string): Promise<void> {
    await workspaceIo.run(cwd, async () => {
      const entry = await this.entry(cwd)
      if (workspaceStorageInUse(entry.path)) throw new Error('Close workspace commands before migrating')
      const resumeStorage = suspendWorkspaceStorage(entry.path)
      try {
        await this.beforeMigration(entry.path)
        const source = join(entry.path, '.janusX'), target = join(this.root, entry.id)
        let manifest = await this.manifest(entry)
        if (entry.purging || manifest?.purging) throw new Error('Workspace data removal is in progress')
        if (!manifest?.migration) {
          if (!await exists(source) && !await exists(join(target, 'checkpoints'))) throw new Error('No legacy workspace data was found')
          if (await exists(source)) await plain(source)
          if (within(source, target) || within(target, source) || normalize(source) === normalize(target)) throw new Error('Migration paths overlap')
          await this.safeDestination()
          if (await exists(target)) await plain(target)
          await mkdir(target, { recursive: true })
          // Persist identity before copying, so interruption always returns to this target.
          await this.saveRegistry()
          const files: CopiedFile[] = []
          for (const category of COPY_CATEGORIES) {
            const from = join(source, category)
            if (!await exists(from)) continue
            await plain(from)
            const info = await lstat(from)
            const paths = info.isDirectory() ? this.inventory(from) : (async function* () { yield '' })()
            for await (const rel of paths) {
              const sourceRel = rel ? join(category, rel) : category
              if (!supported(sourceRel)) continue
              const targetRel = category === 'janusX.launch.json' ? 'launch.json' : sourceRel
              const sourcePath = this.checked(source, sourceRel), targetPath = this.checked(target, targetRel)
              await ensureDirectory(target, dirname(targetPath))
              const original = await this.digest(sourcePath)
              if (await exists(targetPath)) {
                const current = await this.digest(targetPath)
                if (current.hash !== original.hash) throw new Error(`Migration destination conflict: ${targetPath}`)
              } else {
                const temporary = `${targetPath}.migration-tmp`
                // Only a deterministic private temporary file is disposable on retry.
                if (await exists(temporary)) { await plain(temporary); await unlink(temporary) }
                await this.digest(sourcePath, temporary)
                if ((await this.digest(temporary)).hash !== original.hash) throw new Error(`Migration verification failed: ${sourcePath}`)
                await rename(temporary, targetPath)
              }
              files.push({ source: sourceRel, target: targetRel, ...original })
              await workspaceIo.step()
            }
          }
          if (!files.length && !await exists(join(source, 'checkpoints')) && !await exists(join(target, 'checkpoints'))) throw new Error('No supported legacy files were found')
          // Validate only data that is being migrated; retired snapshot bodies are never read.
          const copiedSources = new Set(files.map(file => file.source))
          for (const file of files) {
            if (file.source === 'janusX.launch.json') {
              const data = JSON.parse(await readFile(this.checked(target, file.target), 'utf8'))
              if (!Array.isArray(data.configurations)) throw new Error('Invalid legacy launch configuration')
            }
            const current = await this.digest(this.checked(source, file.source))
            if (current.hash !== file.hash) throw new Error('Migration source changed before commit')
          }
          // Re-enumeration catches files added while copying, before committing a partial migration.
          const currentFiles: string[] = []
          for (const category of COPY_CATEGORIES) {
            const path = join(source, category)
            if (!await exists(path)) continue
            if ((await lstat(path)).isDirectory()) for await (const rel of this.inventory(path)) { const entry = join(category, rel); if (supported(entry)) currentFiles.push(entry) }
            else currentFiles.push(category)
          }
          if (currentFiles.length !== files.length || currentFiles.some(path => !copiedSources.has(path))) throw new Error('Migration source inventory changed')
          const completedAt = new Date().toISOString()
          manifest = { schema: 1, storageId: entry.id, path: entry.path, retentionStartedAt: completedAt, migration: { completedAt, files, cleanupComplete: false } }
          await atomicJson(join(target, 'manifest.json'), manifest)
          this.manifests.set(entry.id, manifest)
          this.maintenanceAt.delete(entry.id)
        }
        if (manifest.migration!.cleanupComplete) {
          if (!await exists(join(source, 'checkpoints')) && !await exists(join(target, 'checkpoints'))) return
          manifest = { ...manifest, migration: { ...manifest.migration!, cleanupComplete: false } }
          await this.saveManifest(entry, manifest)
        }
        const migration = manifest.migration!
        // Only receipt files are eligible. Never sweep new/unknown source files or reimport them.
        for (const file of migration.files) {
          if (file.source.startsWith(`checkpoints${sep}`)) continue
          const path = this.checked(source, file.source)
          if (!await exists(path)) continue
          await plain(source)
          await plain(dirname(path))
          if ((await this.digest(path)).hash !== file.hash) throw new Error(`Legacy file changed; retained: ${path}`)
          if ((await this.digest(this.checked(target, file.target))).hash !== file.hash) throw new Error(`Migrated file changed; legacy copy retained: ${path}`)
          await unlink(path)
          await workspaceIo.step()
        }
        await this.removeSnapshots(source)
        await this.removeSnapshots(target)
        // Only known directories; never traverse or remove unknown directory trees.
        const removeEmpty = async (dir: string): Promise<void> => {
          if (!await exists(dir)) return
          await plain(dir)
          await rmdir(dir).catch(error => { if (!['ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error })
        }
        for (const category of ['checkpoints/blobs', 'checkpoints', 'logs']) await removeEmpty(join(source, category))
        if (await exists(source)) { await plain(source); await rmdir(source).catch(error => { if (!['ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error }) }
        const complete = { ...manifest, migration: { ...migration, cleanupComplete: true } }
        await atomicJson(join(target, 'manifest.json'), complete)
        this.manifests.set(entry.id, complete)
      } finally { resumeStorage() }
    }, { background: true })
  }
}
