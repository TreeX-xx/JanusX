import { useAppStore } from '@/stores/app'
import { useGlobalToolsStore } from '@/stores/global-tools'
import { useIslandStore } from '@/stores/island'
import { useSuperAgentUIStore } from '@/stores/superagent-ui'

/** Both launchers reveal one global pane and reuse the existing Janus controller. */
export function openSuperAgent() {
  useSuperAgentUIStore.getState().start()
  useAppStore.getState().setActiveWorkbench(null)
  const tools = useGlobalToolsStore.getState()
  if (!tools.paneTree) tools.setProjectRatio(.34)
  tools.openContent({ type: 'superagent', id: 'superagent' })
  useIslandStore.getState().dispatch({ type: 'dismiss' })
  // Reuse the ordinary Janus opening-context path without opening the Island chat.
  useIslandStore.setState(current => ({ openSequence: current.openSequence + 1 }))
}

/** Browse the actual checkout through the existing Git/Diff tool; no Worker input is changed. */
export async function openSuperAgentChanges(workspaceId: string, path: string) {
  const [{ useWorkspaceStore }, { switchActiveWorktree }, { useRightToolStore }] = await Promise.all([
    import('@/stores/workspace'), import('@/features/workspace/actions'), import('@/stores/right-tools'),
  ])
  if (useWorkspaceStore.getState().activeWorkspaceId !== workspaceId) return
  await switchActiveWorktree(workspaceId, path)
  if (useWorkspaceStore.getState().activeWorkspaceId === workspaceId) useRightToolStore.getState().openTool('git')
}
