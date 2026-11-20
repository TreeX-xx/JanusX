import { hasPluginProjectAccess } from '../../../shared/plugin-project-access'
import type { PluginHostSnapshot } from '../../../shared/ipc/plugins'
import { usePluginSnapshot } from '@/extensions/plugin-snapshot'
import { useGlobalToolsStore } from '@/stores/global-tools'
import { useWorkspaceStore } from '@/stores/workspace'
import { getPaneContentById, type WorkspacePaneNode } from './workspace-pane'

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

const hasSuperAgentTab = (tree: WorkspacePaneNode | null) => getPaneContentById(tree, 'superagent')?.type === 'superagent'

// Note: .agents/notes/workbench/island-hifi-optimized-alignment.md — chat routing follows the open tab.
export function superAgentOwnsChat() {
  return isSuperAgentEnabled() && hasSuperAgentTab(useGlobalToolsStore.getState().paneTree)
}

export function useSuperAgentOwnsChat() {
  const enabled = useSuperAgentEnabled()
  const tabOpen = useGlobalToolsStore(state => hasSuperAgentTab(state.paneTree))
  return enabled && tabOpen
}
