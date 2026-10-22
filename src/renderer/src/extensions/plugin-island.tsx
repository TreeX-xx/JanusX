// Note: .agents/notes/workbench/plugin-contract-v1.md — bounded text only, no HTML/URLs or plugin DOM.
import type { PluginHostSnapshot } from '../../../shared/ipc/plugins'
import type { IslandNotification } from '@/components/janus/islandNotifications'

export function pluginIslandNotifications(snapshot: PluginHostSnapshot): IslandNotification[] {
  return (snapshot.island ?? []).flatMap(entry => {
    const record = snapshot.plugins.find(record => record.manifest.id === entry.pluginId && record.enabled)
    const contribution = record?.manifest.contributes.island?.find(item => item.id === entry.id)
    if (!contribution || !snapshot.developmentMode) return []
    const commands = contribution.actions?.flatMap(id => record?.manifest.contributes.commands?.filter(command => command.id === id) ?? []) ?? []
    return [{ id: `plugin:${entry.pluginId}/${entry.id}:${entry.instanceId}`, kind: 'plugin',
      severity: entry.status.state === 'error' ? 'failed' : entry.status.state === 'warning' ? 'attention' : entry.status.state === 'success' ? 'success' : 'info',
      copy: { titleKey: '', titleText: entry.status.title, subtitleText: entry.status.description },
      actions: commands.map(command => ({ id: 'open-plugin', label: command.title, command: command.id })),
      createdAt: entry.createdAt, progress: entry.status.progress, plugin: entry, order: contribution.order } satisfies IslandNotification]
  })
}

export function PluginIslandPreview({ notification }: { notification: IslandNotification }) {
  const entry = notification.plugin
  if (!entry) return null
  return <div data-plugin-island-preview={`${entry.pluginId}/${entry.id}`} className="plugin-island-preview">
    {entry.status.badge && <span className="plugin-island-badge">{entry.status.badge}</span>}
    {entry.status.preview && <>
      <p>{entry.status.preview.text}</p>
      {entry.status.preview.rows?.map((row, index) => <dl key={index}><dt>{row.label}</dt><dd>{row.value}</dd></dl>)}
    </>}
  </div>
}
