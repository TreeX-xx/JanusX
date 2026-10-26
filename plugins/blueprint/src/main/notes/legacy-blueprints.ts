// Note: .agents/notes/planning/blueprint-official-plugin.md — explicit conversion of preserved legacy data.
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rename } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { NativeServiceError, SerialQueue } from '@janusx/plugin-sdk/native'
import { readHarnessIdentity, type NoteService } from '@janus-agent/harness-node'
import type { Blueprint } from '../../shared/janus/types'
import { migrateBlueprint } from '../janus/blueprint-migration'
import { readMaintenanceAudits } from '../janus/maintenance/audit-records'
import { applyPreparedMigration, prepareMigration } from './legacy-conversion'

const digest = (text: string) => createHash('sha256').update(text).digest('hex')
const validId = (id: string) => /^[a-zA-Z0-9_-]{1,128}$/.test(id)
type Preview = { root: string; owner: number; id: string; hash: string; expires: number; prepared: Awaited<ReturnType<typeof prepareMigration>> }

export class LegacyBlueprints {
  private previews = new Map<string, Preview>()
  private queue = new SerialQueue()
  constructor(private directory: string, private notes: NoteService) {}

  private async source(id: string) {
    if (!validId(id)) throw new NativeServiceError('INVALID_REQUEST')
    const file = join(this.directory, 'legacy', `${id}.json`)
    const info = await lstat(file)
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 16 * 1024 * 1024) throw new NativeServiceError('INVALID_REQUEST')
    const raw = await readFile(file, 'utf8'), blueprint = JSON.parse(raw) as Blueprint
    if (blueprint.id !== id || blueprint.source === 'harness' || !Array.isArray(blueprint.nodeIds) || !blueprint.nodes) throw new Error('SCHEMA_INVALID: invalid legacy blueprint')
    migrateBlueprint(blueprint)
    return { file, blueprint, hash: digest(raw) }
  }

  async list() {
    const files = await readdir(join(this.directory, 'legacy')).catch(error => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    return Promise.all(files.filter(file => file.endsWith('.json') && file !== 'index.json').map(async file => {
      const id = file.slice(0, -5)
      try { const { blueprint } = await this.source(id); return { id, name: blueprint.name, nodes: blueprint.nodeIds.length } }
      catch { return { id, name: file, error: 'Legacy source is unreadable or invalid; original data was preserved.' } }
    }))
  }

  private async inputs(root: string, id: string) {
    const source = await this.source(id), identity = await readHarnessIdentity(root)
    if (!identity.repoId || identity.diagnostics.length) throw new NativeServiceError('NOT_READY')
    const audits = await readMaintenanceAudits(join(this.directory, 'maintenance-audit'), { blueprintId: id })
    return { ...source, repoId: identity.repoId, audits }
  }

  async preview(root: string, id: string, owner: number, signal?: AbortSignal) {
    const input = await this.inputs(root, id)
    const prepared = await prepareMigration(root, input.repoId, input.blueprint, input.audits, this.notes, digest(JSON.stringify([id, input.hash])))
    signal?.throwIfAborted()
    for (const [token, entry] of this.previews) if (entry.expires < Date.now()) this.previews.delete(token)
    const token = randomUUID()
    const result = { token, ...prepared.preview, documents: prepared.documents.map(document => ({
      relativePath: document.fileName, markdown: document.markdown,
    })) }
    if (this.previews.size >= 16 || Buffer.byteLength(JSON.stringify(prepared)) > 16 * 1024 * 1024
      || Buffer.byteLength(JSON.stringify(result)) > 3 * 1024 * 1024) throw new NativeServiceError('FILE_TOO_LARGE')
    this.previews.set(token, { root: resolve(root), owner, id, hash: input.hash, expires: Date.now() + 10 * 60_000, prepared })
    return result
  }

  apply(root: string, token: string, owner: number, signal?: AbortSignal) {
    return this.queue.run(async () => {
      signal?.throwIfAborted()
      const entry = this.previews.get(token)
      if (!entry || entry.owner !== owner || entry.root !== resolve(root) || entry.expires < Date.now()) throw new NativeServiceError('NOT_READY')
      const input = await this.inputs(root, entry.id)
      if (input.hash !== entry.hash || input.repoId !== entry.prepared.preview.targetRepoId) throw new NativeServiceError('RESOURCE_CHANGED')
      const conversionKey = digest(JSON.stringify([entry.id, entry.hash]))
      const snapshot = await this.notes.readSnapshot(root)
      if (snapshot.coverage.status !== 'complete') throw new NativeServiceError('NOT_READY')
      if (snapshot.entries.some(item => (item.doc?.metadata?.extensions?.legacyConversion as { key?: string } | undefined)?.key === conversionKey)) {
        throw new NativeServiceError('RECOVERY_REQUIRED')
      }
      // Consume before writing: no automatic or double-click replay of a committed conversion.
      this.previews.delete(token)
      return applyPreparedMigration(root, input.blueprint, entry.prepared, async () => {
        try {
          const current = await this.source(entry.id)
          if (current.hash !== entry.hash) throw new NativeServiceError('RECOVERY_REQUIRED')
          const archived = join(this.directory, 'legacy', 'archived')
          await mkdir(archived, { recursive: true })
          const target = join(archived, `${entry.id}-${randomUUID()}.json`)
          await rename(current.file, target)
          return target
        } catch { throw new NativeServiceError('RECOVERY_REQUIRED') }
      }, this.notes, signal)
    })
  }

  release(owner: number) {
    for (const [token, entry] of this.previews) if (entry.owner === owner) this.previews.delete(token)
  }
}
