// Note: .agents/notes/workbench/plugin-contract-v1.md — P1 commands and entry compatibility.
import type { PluginMenu } from '@janusx/plugin-sdk'
import { isReservedPluginKeybinding, normalizePluginKeybinding } from '@janusx/plugin-sdk'
import { ExtensionRegistry, extensionRegistry } from './registry'
import type { ExtensionViewId, RegisteredExtensionView } from './types'

export interface ExtensionCommand {
  id: string
  title: string
  viewId: ExtensionViewId
  scope: 'application' | 'project'
}
export interface ExtensionMenuEntry {
  id: string
  location: PluginMenu['location']
  commandId: string
  view: RegisteredExtensionView
  when: 'always' | 'projectOpen'
  order: number
}
interface Binding { commandId: string; key: string; mac?: string; when: 'always' | 'projectOpen' }
export interface CommandPreferences {
  menus: Record<string, { hidden?: boolean; order?: number }>
  keybindings: Record<string, string | null>
}
export interface ExtensionCommandSnapshot {
  commands: readonly ExtensionCommand[]
  menus: readonly ExtensionMenuEntry[]
  bindings: readonly Binding[]
}
const emptyPreferences = (): CommandPreferences => ({ menus: Object.create(null), keybindings: Object.create(null) })
const PREFERENCE_KEY = 'janusx:extension-commands:v1'

export class ExtensionCommandRegistry {
  private listeners = new Set<() => void>()
  private snapshot: ExtensionCommandSnapshot = { commands: [], menus: [], bindings: [] }
  private preferences = emptyPreferences()
  private unsubscribe: () => void

  constructor(private source: ExtensionRegistry, private storage?: Pick<Storage, 'getItem' | 'setItem'>) {
    try {
      const raw: unknown = JSON.parse(storage?.getItem(PREFERENCE_KEY) ?? 'null')
      if (raw && typeof raw === 'object' && 'menus' in raw && 'keybindings' in raw) {
        const preferences = raw as CommandPreferences
        if (preferences.menus && typeof preferences.menus === 'object' && !Array.isArray(preferences.menus)
          && preferences.keybindings && typeof preferences.keybindings === 'object' && !Array.isArray(preferences.keybindings)) {
          for (const [id, item] of Object.entries(preferences.menus)) {
            if (id.startsWith('menu:') && item && typeof item === 'object') this.preferences.menus[id] = {
              ...(typeof item.hidden === 'boolean' ? { hidden: item.hidden } : {}),
              ...(typeof item.order === 'number' && Number.isFinite(item.order) ? { order: item.order } : {}),
            }
          }
          for (const [id, key] of Object.entries(preferences.keybindings)) {
            if (id.startsWith('command:') && (key === null || (typeof key === 'string' && normalizePluginKeybinding(key) && !isReservedPluginKeybinding(key)))) this.preferences.keybindings[id] = key
          }
        }
      }
    } catch { /* Unavailable/corrupt preferences fall back to contribution defaults. */ }
    this.rebuild()
    this.unsubscribe = source.subscribe(() => this.rebuild())
  }

  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  getSnapshot = (): ExtensionCommandSnapshot => this.snapshot
  getPreferences = (): CommandPreferences => structuredClone(this.preferences)
  dispose = (): void => { this.unsubscribe(); this.listeners.clear() }

  setMenuPreference(id: string, preference: { hidden?: boolean; order?: number }): void {
    if (!id.startsWith('menu:') || (preference.hidden !== undefined && typeof preference.hidden !== 'boolean')
      || (preference.order !== undefined && !Number.isFinite(preference.order))) throw new Error('Invalid menu preference')
    this.save({ ...this.preferences, menus: { ...this.preferences.menus, [id]: { ...this.preferences.menus[id], ...preference } } })
  }

  setKeybinding(commandId: string, key: string | null | undefined): void {
    if (!commandId.startsWith('command:') || (key !== undefined && key !== null && (!normalizePluginKeybinding(key) || isReservedPluginKeybinding(key)))) throw new Error('Reserved or invalid keybinding')
    const keybindings = { ...this.preferences.keybindings }
    if (key === undefined) delete keybindings[commandId]
    else keybindings[commandId] = key
    this.save({ ...this.preferences, keybindings })
  }

  getMenus(location: PluginMenu['location'], projectOpen: boolean): readonly ExtensionMenuEntry[] {
    return this.snapshot.menus.filter((entry) => entry.location === location && (projectOpen || entry.when !== 'projectOpen')
      && !(location === 'workspace-add' && !projectOpen && entry.view.scope === 'project'))
  }

  getToolbarWorkbenches(projectOpen: boolean): readonly RegisteredExtensionView[] {
    const toolboxViews = new Set(this.source.getDefinitions().flatMap(definition => (definition.menus ?? [])
      .filter(menu => menu.location === 'toolbox')
      .flatMap(menu => {
        const command = definition.commands?.find(command => command.id === menu.command)
        return command ? ['extension:' + definition.id + '/' + command.action.view] : []
      })))
    return this.source.getSnapshot().filter(view => view.location === 'workbench'
      && (view.scope === 'application' || projectOpen) && !toolboxViews.has(view.id))
  }

  canExecute(id: string, projectOpen: boolean): boolean {
    const command = this.snapshot.commands.find((item) => item.id === id)
    return Boolean(command && (command.scope === 'application' || projectOpen))
  }

  execute(id: string, projectOpen: boolean, openView: (id: ExtensionViewId) => boolean): boolean {
    const command = this.snapshot.commands.find((item) => item.id === id)
    return Boolean(command && this.canExecute(id, projectOpen) && openView(command.viewId))
  }

  resolveKeybindings(mac: boolean, projectOpen: boolean): { active: Map<string, string>; conflicts: string[]; diagnostics: Array<{ code: 'KEYBINDING_CONFLICT'; key: string; commandIds: string[] }> } {
    const groups = new Map<string, Array<{ commandId: string; user: boolean }>>()
    const seen = new Set<string>()
    for (const binding of this.snapshot.bindings) {
      if ((!projectOpen && binding.when === 'projectOpen') || !this.canExecute(binding.commandId, projectOpen)) continue
      const user = Object.hasOwn(this.preferences.keybindings, binding.commandId)
      const value = user ? this.preferences.keybindings[binding.commandId] : mac ? binding.mac ?? binding.key : binding.key
      if (!value) continue
      const key = normalizePluginKeybinding(value)
      if (!key || isReservedPluginKeybinding(key) || seen.has(`${key}:${binding.commandId}`)) continue
      seen.add(`${key}:${binding.commandId}`)
      const group = groups.get(key) ?? []
      group.push({ commandId: binding.commandId, user })
      groups.set(key, group)
    }
    const active = new Map<string, string>()
    const conflicts: string[] = []
    const diagnostics: Array<{ code: 'KEYBINDING_CONFLICT'; key: string; commandIds: string[] }> = []
    for (const [key, entries] of groups) {
      const users = entries.filter((entry) => entry.user)
      const winners = users.length ? users : entries
      if (winners.length === 1) active.set(key, winners[0].commandId)
      else {
        const commandIds = winners.map((entry) => entry.commandId)
        conflicts.push(...commandIds)
        diagnostics.push({ code: 'KEYBINDING_CONFLICT', key, commandIds })
      }
    }
    return { active, conflicts, diagnostics }
  }

  private save(preferences: CommandPreferences): void {
    // A failed disk write must not claim a persisted preference or alter this session silently.
    this.storage?.setItem(PREFERENCE_KEY, JSON.stringify(preferences))
    this.preferences = preferences
    this.rebuild()
  }

  private rebuild(): void {
    const commands: ExtensionCommand[] = []
    const menus: ExtensionMenuEntry[] = []
    const bindings: Binding[] = []
    for (const definition of this.source.getDefinitions()) {
      const views = this.source.getSnapshot().filter((view) => view.extensionId === definition.id)
      const contributions = definition.commands ?? views.filter((view) => view.location === 'workspace').map((view) => ({
        id: view.id.slice(view.id.lastIndexOf('/') + 1), title: view.title, action: { type: 'openView' as const, view: view.id.slice(view.id.lastIndexOf('/') + 1) },
      }))
      const fullCommand = (id: string) => `command:${definition.id}/${id}`
      for (const contribution of contributions) {
        const view = views.find((view) => view.id === `extension:${definition.id}/${contribution.action.view}`)
        if (view) commands.push({ id: fullCommand(contribution.id), title: contribution.title, viewId: view.id, scope: view.scope })
      }
      const entries: readonly PluginMenu[] = definition.commands !== undefined ? definition.menus ?? [] : views.filter((view) => view.location === 'workspace').map((view) => ({
        location: view.launcher === 'tool-menu' ? 'toolbox' : 'workspace-add', command: view.id.slice(view.id.lastIndexOf('/') + 1), order: view.order,
      }))
      for (const entry of entries) {
        const command = commands.find((command) => command.id === fullCommand(entry.command))
        const view = views.find((view) => view.id === command?.viewId)
        if (!command || !view) continue
        const id = `menu:${definition.id}/${entry.location}/${entry.command}`
        const preference = this.preferences.menus[id]
        if (!preference?.hidden) menus.push({ id, location: entry.location, commandId: command.id, view,
          when: entry.when ?? 'always', order: preference?.order ?? entry.order ?? 100 })
      }
      for (const binding of definition.keybindings ?? []) bindings.push({ ...binding, commandId: fullCommand(binding.command), when: binding.when ?? 'always' })
      // A user can bind a command even when it has no default shortcut.
      for (const command of contributions) {
        const commandId = fullCommand(command.id)
        if (Object.hasOwn(this.preferences.keybindings, commandId) && !bindings.some((binding) => binding.commandId === commandId)) {
          bindings.push({ commandId, key: this.preferences.keybindings[commandId] ?? '', when: 'always' })
        }
      }
    }
    menus.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    this.snapshot = { commands, menus, bindings }
    for (const listener of this.listeners) {
      try { listener() } catch (error) { console.error('Extension command subscriber failed', error) }
    }
  }
}

let preferenceStorage: Storage | undefined
try { preferenceStorage = globalThis.localStorage } catch { /* Storage can be blocked. */ }
export const extensionCommands = new ExtensionCommandRegistry(extensionRegistry, preferenceStorage)
