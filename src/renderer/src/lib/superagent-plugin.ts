import { hasPluginProjectAccess } from '../../../shared/plugin-project-access'
import type { PluginHostSnapshot } from '../../../shared/ipc/plugins'
import { usePluginSnapshot } from '@/extensions/plugin-snapshot'
import { useSuperAgentUIStore } from '@/stores/superagent-ui'
import { useWorkspaceStore } from '@/stores/workspace'

function enabled(snapshot: PluginHostSnapshot, workspaceId: string | null) {
  return snapshot.plugins.some(plugin =>
    plugin.manifest.id === 'official.superagent' && plugin.source.kind === 'official' && plugin.enabled
    && (!workspaceId || hasPluginProjectAccess(plugin, workspaceId))
    && (['ready', 'loading', 'active'].includes(plugin.state) || (plugin.state === 'error' && plugin.error === 'VIEW_LOAD_FAILED')),
  )
}

export function isSuperAgentEnabled(workspaceId = useWorkspaceStore.getState().activeWorkspaceId) {
  return enabled(usePluginSnapshot.getState(), workspaceId)
}

export function useSuperAgentEnabled() {
  const workspaceId = useWorkspaceStore(state => state.activeWorkspaceId)
  return usePluginSnapshot(snapshot => enabled(snapshot, workspaceId))
}

export function superAgentOwnsChat() {
  return isSuperAgentEnabled() && useSuperAgentUIStore.getState().started
}
