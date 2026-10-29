// Note: .agents/notes/workbench/plugin-contract-v1.md — explicit read-only document binding.
import { matchesPluginViewer, type PluginViewer } from '@janusx/plugin-sdk'
import type { PluginHostSnapshot } from '../../../shared/ipc/plugins'
import { hasPluginProjectAccess } from '../../../shared/plugin-project-access'

export interface AvailableDocumentViewer extends PluginViewer { key: string; pluginId: string; pluginName: string; digest: string }

export function documentViewerCandidates(snapshot: PluginHostSnapshot, projectId: string, path: string): AvailableDocumentViewer[] {
  if (!snapshot.developmentMode) return []
  return snapshot.plugins.flatMap(record => record.enabled && hasPluginProjectAccess(record, projectId)
    && (['ready', 'loading', 'active'].includes(record.state) || record.state === 'error' && record.error === 'VIEW_LOAD_FAILED')
    ? (record.manifest.contributes.viewers ?? []).filter(viewer => matchesPluginViewer(viewer, path)).map(viewer => ({
      ...viewer, key: `${record.manifest.id}/${viewer.id}`, pluginId: record.manifest.id, pluginName: record.manifest.name, digest: record.digest,
    })) : []).sort((a, b) => a.key.localeCompare(b.key))
}

export function documentPreferenceKey(path: string): string {
  const name = path.replaceAll('\\', '/').split('/').pop()!.toLowerCase()
  const dot = name.lastIndexOf('.')
  return dot > 0 ? `extension:${name.slice(dot)}` : `filename:${name}`
}

const preferenceKey = 'janusx.document-viewers.v1'
export function readDocumentViewerDefault(path: string): string {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(preferenceKey) ?? '{}')
    const value = saved && typeof saved === 'object' ? (saved as Record<string, unknown>)[documentPreferenceKey(path)] : null
    return typeof value === 'string' && value.length <= 256 ? value : 'builtin'
  } catch { return 'builtin' }
}
export function saveDocumentViewerDefault(path: string, viewer: string): void {
  let saved: unknown
  try { saved = JSON.parse(localStorage.getItem(preferenceKey) ?? '{}') } catch { saved = {} }
  const values = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}
  // Commit storage first; a failure must not look like a persisted preference.
  localStorage.setItem(preferenceKey, JSON.stringify({ ...values, [documentPreferenceKey(path)]: viewer }))
}
