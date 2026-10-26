// Note: .agents/notes/planning/blueprint-official-plugin.md - enabled plugins own their settings pages.
import type { PluginHostSnapshot } from '../../../shared/ipc/plugins'
import type { ExtensionViewId } from './types'

export interface PluginSettingsPage {
  id: ExtensionViewId
  pluginId: string
  viewId: string
  title: string
  pluginName: string
  digest: string
  enabled: boolean
  order: number
}

/**
 * Activation controls navigation: a plugin only contributes settings pages once the user has
 * granted and enabled it. `enabled` on the page then reports whether its code may run right now
 * (an activated plugin can still be blocked or failing, which shows the host fallback instead).
 */
export function installedPluginSettings(snapshot: PluginHostSnapshot): PluginSettingsPage[] {
  return snapshot.plugins.filter(record => record.enabled && (record.source.kind === 'official' || snapshot.developmentMode)).flatMap(record =>
    record.manifest.contributes.views.filter(view => view.location === 'settings').map(view => ({
      id: `extension:${record.manifest.id}/${view.id}` as ExtensionViewId,
      pluginId: record.manifest.id, viewId: view.id, title: view.title, pluginName: record.manifest.name,
      digest: record.digest, order: view.order ?? 100,
      enabled: record.enabled && (['ready', 'loading', 'active'].includes(record.state) || record.state === 'error' && record.error === 'VIEW_LOAD_FAILED'),
    }))).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}
