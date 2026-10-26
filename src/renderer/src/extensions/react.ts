import { useSyncExternalStore } from 'react'
import { extensionRegistry } from './registry'
import { extensionCommands } from './commands'

export function useExtensionViews() {
  return useSyncExternalStore(extensionRegistry.subscribe, extensionRegistry.getSnapshot, extensionRegistry.getSnapshot)
}

export function useExtensionCommands() {
  return useSyncExternalStore(extensionCommands.subscribe, extensionCommands.getSnapshot, extensionCommands.getSnapshot)
}

// Note: .agents/notes/workbench/plugin-contract-v1.md — one visible launcher per workbench.
export function useToolbarWorkbenches(projectOpen: boolean) {
  const views = useExtensionViews()
  useExtensionCommands()
  const toolboxViews = new Set(extensionCommands.getMenus('toolbox', projectOpen).map(entry => entry.view.id))
  return views.filter(view => view.location === 'workbench'
    && (view.scope === 'application' || projectOpen) && !toolboxViews.has(view.id))
}
