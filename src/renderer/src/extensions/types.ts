// Note: trusted contribution API; isolated packages use authorized shells — see .agents/notes/workbench/requirements/plugin-architecture-forms.md
import type { ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { PluginCommand, PluginMenu, PluginKeybinding } from '@janusx/plugin-sdk'

export type ExtensionViewLocation = 'workspace' | 'right' | 'workbench' | 'island' | 'window'
export type ExtensionViewScope = 'application' | 'project'
export type ExtensionViewId = `extension:${string}/${string}`

export interface ExtensionViewProps {
  viewId: ExtensionViewId
  location: ExtensionViewLocation
  active: boolean
  workspaceId: string | null
  workspacePath: string | null
}

export interface ExtensionView {
  id: string
  title: string
  location: ExtensionViewLocation
  scope: ExtensionViewScope
  /** Workspace launcher; defaults to the pane's add menu. */
  launcher?: 'workspace-menu' | 'tool-menu'
  icon?: LucideIcon
  order?: number
  component: ComponentType<ExtensionViewProps>
}

export interface ExtensionDefinition {
  id: string
  views: readonly ExtensionView[]
  /** Omit commands to adapt legacy workspace launchers automatically. */
  commands?: readonly PluginCommand[]
  menus?: readonly PluginMenu[]
  keybindings?: readonly PluginKeybinding[]
  /** Synchronous, trusted renderer setup. Return a disposer for owned resources. */
  activate?: () => void | (() => void)
}

export interface RegisteredExtensionView extends Omit<ExtensionView, 'id'> {
  id: ExtensionViewId
  extensionId: string
  activationId: number
}
