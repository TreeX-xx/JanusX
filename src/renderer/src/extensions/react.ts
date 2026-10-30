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
  useExtensionViews()
  useExtensionCommands()
  return extensionCommands.getToolbarWorkbenches(projectOpen)
}
