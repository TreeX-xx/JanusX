import { useRightToolStore } from '@/stores/right-tools'
import { useWorkspaceStore } from '@/stores/workspace'
import { isRightToolEnabled } from '@/right-tools/registry'
import { useExperimentalStore } from '@/stores/experimental'
import { extensionRegistry } from './registry'
import type { ExtensionViewId } from './types'
import { useAppStore } from '@/stores/app'
import { useIslandStore } from '@/stores/island'
import { PLUGIN_SETTINGS_EVENT } from './plugin-configuration-navigation'

/** Opens an enabled contribution; project views require a selected project. */
export function openExtensionView(viewId: ExtensionViewId, instanceKey?: string): boolean {
  const view = extensionRegistry.getView(viewId)
  if (!view || (view.scope === 'project' && !useWorkspaceStore.getState().activeWorkspaceId)) return false
  if (view.location === 'settings') { window.dispatchEvent(new CustomEvent(PLUGIN_SETTINGS_EVENT, { detail: viewId })); return true }
  if (view.location === 'window') { window.dispatchEvent(new CustomEvent('janusx:plugin-window-open', { detail: viewId })); return true }
  if (view.location === 'right' && !isRightToolEnabled(viewId, useExperimentalStore.getState())) return false
  if (view.location !== 'island') useIslandStore.getState().dispatch({ type: 'dismiss' })
  if ((view.location === 'workspace' || view.location === 'right') && useAppStore.getState().activeWorkbench?.startsWith('extension:')) {
    useAppStore.getState().closePluginWorkbench()
  }
  if (view.location === 'workspace') useWorkspaceStore.getState().openExtensionView(viewId, instanceKey)
  else if (view.location === 'right') useRightToolStore.getState().openTool(viewId)
  else if (view.location === 'workbench') useAppStore.getState().openPluginWorkbench(viewId)
  else useIslandStore.getState().openPluginView(viewId)
  return true
}
