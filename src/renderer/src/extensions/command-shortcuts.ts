import { normalizePluginKeybinding } from '@janusx/plugin-sdk'
import { extensionCommands, type ExtensionCommandRegistry } from './commands'
import { openExtensionView } from './workbench'
import { useWorkspaceStore } from '@/stores/workspace'
import { focusWorkspaceFront } from '@/lib/global-tool-entry'

export function isPluginShortcutInput(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],.monaco-editor,.xterm,iframe,webview'))
}

export function installExtensionShortcuts(target: Window, registry: ExtensionCommandRegistry = extensionCommands): () => void {
  const handler = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.repeat || event.isComposing || isPluginShortcutInput(event.target)
      || isPluginShortcutInput(target.document.activeElement)) return
    const key = normalizePluginKeybinding([
      ...(event.ctrlKey ? ['Ctrl'] : []), ...(event.metaKey ? ['Meta'] : []),
      ...(event.altKey ? ['Alt'] : []), ...(event.shiftKey ? ['Shift'] : []), event.key,
    ].join('+'))
    if (!key) return
    const projectOpen = Boolean(useWorkspaceStore.getState().activeWorkspaceId)
    const command = registry.resolveKeybindings(/Mac|iPhone|iPad/.test(target.navigator.platform), projectOpen).active.get(key)
    if (command && registry.execute(command, projectOpen, (viewId) => {
      focusWorkspaceFront()
      return openExtensionView(viewId)
    })) event.preventDefault()
  }
  target.addEventListener('keydown', handler)
  return () => target.removeEventListener('keydown', handler)
}
