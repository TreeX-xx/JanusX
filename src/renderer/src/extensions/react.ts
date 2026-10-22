import { useSyncExternalStore } from 'react'
import { extensionRegistry } from './registry'
import { extensionCommands } from './commands'

export function useExtensionViews() {
  return useSyncExternalStore(extensionRegistry.subscribe, extensionRegistry.getSnapshot, extensionRegistry.getSnapshot)
}

export function useExtensionCommands() {
  return useSyncExternalStore(extensionCommands.subscribe, extensionCommands.getSnapshot, extensionCommands.getSnapshot)
}
