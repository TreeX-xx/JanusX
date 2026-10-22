import { readFile, rm, mkdir, writeFile, rename } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { PluginError, type JsonValue, type PluginStoredValue } from '@janusx/plugin-sdk'
import { SerialQueue } from '../lib/atomic-file'

interface ScopeData { revision: number; values: Record<string, { value?: JsonValue; revision: number; found: boolean }> }
export class PluginStorage {
  private queue = new SerialQueue()
  constructor(private directory: string) {}
  private pluginPath(plugin: string): string { return join(this.directory, createHash('sha256').update(plugin).digest('hex')) }
  private path(plugin: string, scope: string): string { return join(this.pluginPath(plugin), `${createHash('sha256').update(scope).digest('hex')}.json`) }
  deletePlugin(plugin: string): Promise<void> { return this.queue.run(() => rm(this.pluginPath(plugin), { recursive: true, force: true })) }
  private async read(plugin: string, scope: string): Promise<ScopeData> {
    try {
      const data = JSON.parse(await readFile(this.path(plugin, scope), 'utf8')) as ScopeData
      if (!data || !Number.isSafeInteger(data.revision) || data.revision < 0 || !data.values || Array.isArray(data.values)) throw new Error('Invalid store')
      return data
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { revision: 0, values: Object.create(null) }
      throw new PluginError('STORAGE_UNAVAILABLE', 'Plugin storage is unavailable.')
    }
  }
  async get(plugin: string, scope: string, key: string): Promise<PluginStoredValue> {
    const data = await this.read(plugin, scope)
    return Object.hasOwn(data.values, key) ? data.values[key] : { found: false, revision: 0 }
  }
  mutate(plugin: string, scope: string, key: string, value: JsonValue | undefined, expected: number | undefined, valid: () => void): Promise<PluginStoredValue> {
    return this.queue.run(async () => {
      valid()
      const data = await this.read(plugin, scope)
      const old = Object.hasOwn(data.values, key) ? data.values[key] : { revision: 0, found: false }
      if (expected !== undefined && expected !== old.revision) throw new PluginError('STORAGE_CONFLICT', 'Stored value has changed.')
      if (value === undefined && !old.found) return { found: false, revision: old.revision }
      const revision = data.revision + 1
      const result = value === undefined ? { found: false, revision } : { found: true, value, revision }
      const updated: ScopeData = { revision, values: { ...data.values, [key]: result } }
      if (Object.keys(updated.values).length > 1024 || Buffer.byteLength(JSON.stringify(updated)) > 1024 * 1024) throw new PluginError('STORAGE_QUOTA_EXCEEDED', 'Plugin storage quota exceeded.')
      valid()
      const target = this.path(plugin, scope)
      const temporary = `${target}.${randomUUID()}.tmp`
      try {
        await mkdir(dirname(target), { recursive: true })
        await writeFile(temporary, JSON.stringify(updated), { flag: 'wx' })
        // The rename is the commit boundary; staging IO can outlive revocation.
        valid()
        await rename(temporary, target)
      } catch (cause) {
        if (cause instanceof PluginError) throw cause
        throw new PluginError('STORAGE_UNAVAILABLE', 'Plugin storage could not be saved.')
      } finally { await rm(temporary, { force: true }).catch(() => {}) }
      return result
    })
  }
  /** Serialize initial snapshots and subscriptions with mutations to avoid a watch gap. */
  watch<T>(readAndSubscribe: () => Promise<T>): Promise<T> { return this.queue.run(readAndSubscribe) }
}
