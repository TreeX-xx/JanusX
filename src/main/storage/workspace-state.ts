// Note: .agents/notes/desktop/workspace-state-storage.md
import { randomUUID, createHash } from 'node:crypto'
import { lstat, realpath, opendir, mkdir, open, readFile, rename, unlink, rmdir } from 'node:fs/promises'
import { dirname, join, relative, resolve, isAbsolute, sep } from 'node:path'
import { workspaceIo, workspaceStorageInUse, suspendWorkspaceStorage, type WorkspaceStorage } from '@janus-agent/agent-core'
import type { WorkspaceMigrationItem } from '../../shared/ipc/workspace-storage'

interface Entry { id: string; path: string; identity: string; legacy: boolean }
interface Registry { schema: 1; promptDismissed: boolean; entries: Entry[] }
interface CopiedFile { source: string; target: string; hash: string; size: number }
interface Manifest { schema: 1; storageId: string; path: string; retentionStartedAt?: string; migration?: { completedAt: string; files: CopiedFile[]; cleanupComplete: boolean } }
const CATEGORIES = ['janusX.launch.json', 'checkpoints', 'logs'] as const
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

  constructor(userData: string, private readonly beforeMigration: (cwd: string) => Promise<void> = async () => {}) {
    this.root = join(resolve(userData), 'janusx', 'workspace-state')
  }

  private async load(): Promise<Registry> {
    if (this.registry) return this.registry
    this.loading ??= (async () => {
      try {
        const data = JSON.parse(await readFile(join(this.root, 'registry.json'), 'utf8')) as Registry
        if (data.schema !== 1 || !Array.isArray(data.entries) || data.entries.some(e => !/^[a-f0-9-]{36}$/.test(e.id) || typeof e.path !== 'string' || typeof e.identity !== 'string')) throw new Error('Unknown workspace storage registry')
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
      const data = JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8')) as Manifest
      if (data.schema !== 1 || data.storageId !== entry.id || (data.retentionStartedAt !== undefined && !Number.isFinite(Date.parse(data.retentionStartedAt))) || (data.migration && (!Array.isArray(data.migration.files) || typeof data.migration.cleanupComplete !== 'boolean' || !Number.isFinite(Date.parse(data.migration.completedAt))))) throw new Error('Unknown workspace storage manifest')
      if (data.migration?.files.some(file => !supported(file.source) || file.target !== (file.source === 'janusX.launch.json' ? 'launch.json' : file.source) || !/^[a-f0-9]{64}$/.test(file.hash))) throw new Error('Invalid workspace migration receipt')
      this.manifests.set(entry.id, data)
      return data
    } catch (error) { if (missing(error)) return undefined; throw error }
  }

  async resolve(cwd: string, write = false): Promise<WorkspaceStorage> {
    return workspaceIo.run(cwd, async () => {
      const entry = await this.entry(cwd)
      const manifest = await this.manifest(entry)
      const legacy = entry.legacy && !manifest?.migration
      const root = legacy ? join(entry.path, '.janusX') : join(this.root, entry.id)
      if (write) {
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
      }
      return { root, launchPath: join(root, legacy ? 'janusX.launch.json' : 'launch.json'), checkpointsPath: join(root, 'checkpoints'), logsPath: join(root, 'logs'), retentionStartedAt: manifest?.retentionStartedAt }
    })
  }

  async inspect(cwd: string, id: string, name: string): Promise<WorkspaceMigrationItem> {
    return workspaceIo.run(cwd, async () => {
      const source = join(cwd, '.janusX')
      try {
        const entry = await this.entry(cwd)
        const manifest = await this.manifest(entry)
        const categories: string[] = []
        for (const category of CATEGORIES) if (await exists(join(source, category))) categories.push(category)
        return { id, name, source, target: join(this.root, entry.id), categories,
          status: manifest?.migration ? manifest.migration.cleanupComplete ? 'migrated' : 'cleanup-pending' : categories.length ? 'pending' : 'new' }
      } catch (error) {
        return { id, name, source, target: this.root, categories: [], status: missing(error) ? 'offline' : 'failed', error: String(error) }
      }
    }, { background: true })
  }

  async promptDismissed(): Promise<boolean> { return (await this.load()).promptDismissed }
  async dismissPrompt(): Promise<void> {
    await workspaceIo.run(this.root, async () => { (await this.load()).promptDismissed = true; this.registryDirty = true; await this.saveRegistry() })
  }

  private async *inventory(root: string, dir = root): AsyncGenerator<string> {
    await plain(dir)
    for await (const item of await opendir(dir)) {
      const path = join(dir, item.name)
      await workspaceIo.step()
      if (item.isSymbolicLink()) throw new Error(`Linked migration source is unavailable: ${path}`)
      if (item.isDirectory()) {
        if (dir === root && item.name === 'blobs' && root.endsWith(`${sep}checkpoints`)) yield* this.inventory(root, path)
      }
      else if (item.isFile()) yield relative(root, path)
      else throw new Error(`Unsupported migration file: ${path}`)
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
        if (!manifest?.migration) {
          if (!await exists(source)) throw new Error('No legacy workspace data was found')
          await plain(source)
          if (within(source, target) || within(target, source) || normalize(source) === normalize(target)) throw new Error('Migration paths overlap')
          await this.safeDestination()
          if (await exists(target)) await plain(target)
          await mkdir(target, { recursive: true })
          // Persist identity before copying, so interruption always returns to this target.
          await this.saveRegistry()
          const files: CopiedFile[] = []
          for (const category of CATEGORIES) {
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
          if (!files.length) throw new Error('No supported legacy files were found')
          // Check parseability and blob references before allowing snapshot source cleanup.
          const copiedSources = new Set(files.map(file => file.source))
          for (const file of files) {
            if (file.source === 'janusX.launch.json' || (file.source.startsWith(`checkpoints${sep}`) && file.source.endsWith('.json'))) {
              const data = JSON.parse(await readFile(this.checked(target, file.target), 'utf8'))
              if (file.source === 'janusX.launch.json') {
                if (!Array.isArray(data.configurations)) throw new Error('Invalid legacy launch configuration')
              } else if (!file.source.endsWith(`${sep}index.json`)) {
                if ((data.schemaVersion !== undefined && data.schemaVersion > 2) || typeof data.id !== 'string' || /[\\/\0]/.test(data.id) || !data.terminalId || typeof data.conversationIndex !== 'number' || !data.createdAt || !data.engine || !data.branch || typeof data.prompt !== 'string' || !data.filesSnapshot || typeof data.filesSnapshot !== 'object' || Array.isArray(data.filesSnapshot)) throw new Error('Unknown legacy checkpoint format')
                for (const item of Object.values(data.filesSnapshot) as { hash?: string; beforeHash?: string }[]) {
                  if (!item || typeof item !== 'object') throw new Error('Invalid legacy checkpoint entry')
                  const hash = item.hash ?? item.beforeHash
                  if (hash && (!/^[a-f0-9]{40}$/.test(hash) || !await exists(join(target, 'checkpoints', 'blobs', hash)))) throw new Error('Legacy checkpoint references missing blob data')
                }
              }
            }
            const current = await this.digest(this.checked(source, file.source))
            if (current.hash !== file.hash) throw new Error('Migration source changed before commit')
          }
          // Re-enumeration catches files added while copying, before committing a partial migration.
          const currentFiles: string[] = []
          for (const category of CATEGORIES) {
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
        }
        const migration = manifest.migration!
        if (migration.cleanupComplete) return
        // Only receipt files are eligible. Never sweep new/unknown source files or reimport them.
        for (const file of migration.files) {
          const path = this.checked(source, file.source)
          if (!await exists(path)) continue
          await plain(source)
          await plain(dirname(path))
          if ((await this.digest(path)).hash !== file.hash) throw new Error(`Legacy file changed; retained: ${path}`)
          if ((await this.digest(this.checked(target, file.target))).hash !== file.hash) throw new Error(`Migrated file changed; legacy copy retained: ${path}`)
          await unlink(path)
          await workspaceIo.step()
        }
        // Only known directories; never traverse or remove unknown directory trees.
        const removeEmpty = async (dir: string): Promise<void> => {
          if (!await exists(dir)) return
          await plain(dir)
          await rmdir(dir).catch(error => { if (!['ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error })
        }
        for (const category of ['checkpoints/blobs', 'checkpoints', 'logs']) await removeEmpty(join(source, category))
        if (await exists(source)) await rmdir(source).catch(error => { if (!['ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error })
        const complete = { ...manifest, migration: { ...migration, cleanupComplete: true } }
        await atomicJson(join(target, 'manifest.json'), complete)
        this.manifests.set(entry.id, complete)
      } finally { resumeStorage() }
    }, { background: true })
  }
}
