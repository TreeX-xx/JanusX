// Note: .agents/notes/workbench/plugin-contract-v1.md — configuration defaults and scoped overrides.
import { createHash } from 'node:crypto'
import { PluginError, isPluginSettingValue, type PluginConfiguration as Configuration,
  type PluginManifest, type PluginSettingValue } from '@janusx/plugin-sdk'
import { SerialQueue } from '../lib/atomic-file'
import { PluginStorage } from './storage'
import type { PluginConfigurationState } from '../../shared/ipc/plugins'

export class PluginConfigurationStore {
  private storage: PluginStorage
  private queue = new SerialQueue()
  constructor(directory: string) { this.storage = new PluginStorage(directory) }
  /** Snapshot/subscribe and writes share one queue, including application inheritance. */
  run<T>(operation: () => Promise<T>): Promise<T> { return this.queue.run(operation) }
  deletePlugin(id: string): Promise<void> { return this.run(() => this.storage.deletePlugin(id)) }
  private async stored(id: string, scope: string) {
    const entry = await this.storage.get(id, scope, 'configuration')
    if (typeof entry.found !== 'boolean' || !Number.isSafeInteger(entry.revision) || entry.revision < 0) {
      throw new PluginError('STORAGE_UNAVAILABLE', 'Configuration is unavailable.')
    }
    const values = entry.found ? entry.value : {}
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new PluginError('STORAGE_UNAVAILABLE', 'Configuration is unavailable.')
    return { revision: entry.revision, values: values as Record<string, unknown> }
  }
  async get(manifest: PluginManifest, scope: string | null): Promise<Configuration> {
    const application = await this.stored(manifest.id, 'application')
    const project = scope ? await this.stored(manifest.id, scope) : null
    const settings = manifest.contributes.settings ?? []
    const values: Configuration['values'] = Object.create(null)
    const overrides: Configuration['overrides'] = Object.create(null)
    let inherited: Configuration['inherited'] = Object.create(null)
    const issues: string[] = []
    for (const setting of settings) values[setting.key] = setting.default
    inherited = { ...values }
    for (const [layer, local] of [[application, !scope], [project, true]] as const) if (layer) {
      for (const [key, value] of Object.entries(layer.values)) {
        const setting = settings.find(item => item.key === key)
        if (!setting || layer === project && setting.scope !== 'project' || !isPluginSettingValue(setting, value)) {
          issues.push(key); continue
        }
        values[key] = value
        if (local) overrides[key] = value
      }
      if (scope && layer === application) inherited = { ...values }
    }
    const revision = createHash('sha256').update(JSON.stringify([manifest.id, scope, settings, manifest.contributes.settingMigrations ?? [], application.revision, project?.revision ?? null])).digest('hex')
    return { values, overrides, inherited, revision, issues: [...new Set(issues)] }
  }
  async management(manifest: PluginManifest, scope: string | null): Promise<PluginConfigurationState> {
    const configuration = await this.get(manifest, scope)
    const { values } = await this.stored(manifest.id, scope ?? 'application')
    const migrations: PluginConfigurationState['migrations'] = []
    for (const { from, to } of manifest.contributes.settingMigrations ?? []) if (Object.hasOwn(values, from)) {
      const setting = manifest.contributes.settings!.find(item => item.key === to)!
      migrations.push({ from, to, status: Object.hasOwn(values, to) ? 'occupied'
        : scope && setting.scope !== 'project' || !isPluginSettingValue(setting, values[from]) ? 'incompatible' : 'ready' })
    }
    return { ...configuration, migrations }
  }
  /** Must run inside run(), so checking both layers and committing is serialized. */
  async update(manifest: PluginManifest, scope: string | null, expected: string,
    patch: Record<string, PluginSettingValue | null>, reset: boolean, valid: () => void, migrate = false): Promise<void> {
    valid()
    if (migrate && (reset || Object.keys(patch).length)) throw new PluginError('INVALID_REQUEST', 'Migration cannot be combined with edits or reset.')
    const current = await this.get(manifest, scope)
    if (current.revision !== expected) throw new PluginError('CONFIGURATION_CONFLICT', 'Configuration changed. Reload before saving.')
    const stored = await this.stored(manifest.id, scope ?? 'application')
    const values = reset ? {} : { ...stored.values }
    if (migrate) {
      const preview = await this.management(manifest, scope)
      const ready = preview.migrations.filter(item => item.status === 'ready')
      if (!ready.length) throw new PluginError('INVALID_REQUEST', 'No compatible setting migration is available.')
      for (const item of ready) { values[item.to] = values[item.from]; delete values[item.from] }
    }
    for (const [key, value] of Object.entries(patch)) {
      const setting = manifest.contributes.settings?.find(item => item.key === key)
      if (!setting || scope && setting.scope !== 'project' || value !== null && !isPluginSettingValue(setting, value)) {
        throw new PluginError('INVALID_REQUEST', 'Invalid setting value or scope.')
      }
      if (value === null) delete values[key]
      else values[key] = value
    }
    await this.storage.mutate(manifest.id, scope ?? 'application', 'configuration', values as Record<string, PluginSettingValue>, stored.revision, valid)
  }
}
