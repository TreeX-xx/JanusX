// Note: S1 registration and lifecycle contract — see .agents/notes/workbench/requirements/plugin-architecture-forms.md
import type { ExtensionDefinition, ExtensionViewId, RegisteredExtensionView } from './types'
import { pluginCommandSchema, pluginMenuSchema, pluginKeybindingSchema } from '@janusx/plugin-sdk'

const ID_PATTERN = /^[a-z][a-z0-9.-]*$/

interface ExtensionRegistration {
  definition: ExtensionDefinition
  views: readonly RegisteredExtensionView[]
  enabled: boolean
  activationId: number
  dispose?: () => void
}

/** Trusted in-code registrations only. This does not load external JavaScript. */
export class ExtensionRegistry {
  private registrations = new Map<string, ExtensionRegistration>()
  private listeners = new Set<() => void>()
  private views: readonly RegisteredExtensionView[] = []
  private definitions: readonly ExtensionDefinition[] = []
  private nextActivationId = 0

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot = (): readonly RegisteredExtensionView[] => this.views
  getDefinitions = (): readonly ExtensionDefinition[] => this.definitions

  getView = (id: string): RegisteredExtensionView | undefined => this.views.find((view) => view.id === id)

  register(definition: ExtensionDefinition): () => void {
    if (!ID_PATTERN.test(definition.id)) throw new Error(`Invalid extension id: ${definition.id}`)
    if (this.registrations.has(definition.id)) throw new Error(`Duplicate extension: ${definition.id}`)
    const ids = new Set<string>()
    const views = definition.views.map((view): RegisteredExtensionView => {
      if (!ID_PATTERN.test(view.id) || ids.has(view.id)) throw new Error(`Invalid or duplicate view: ${view.id}`)
      if (!view.title.trim() || !['workspace', 'right', 'workbench', 'island', 'window'].includes(view.location)
        || !['application', 'project'].includes(view.scope)
        || (view.launcher !== undefined && (view.location !== 'workspace' || !['workspace-menu', 'tool-menu'].includes(view.launcher)))
        || (view.order !== undefined && !Number.isFinite(view.order))) throw new Error(`Invalid view: ${view.id}`)
      ids.add(view.id)
      return Object.freeze({ ...view, id: `extension:${definition.id}/${view.id}`, extensionId: definition.id, activationId: 0 })
    })
    const registration: ExtensionRegistration = { definition, views, enabled: false, activationId: 0 }
    const commands = definition.commands?.map((command) => pluginCommandSchema.parse(command)) ?? []
    if (new Set(commands.map((command) => command.id)).size !== commands.length
      || commands.some((command) => !ids.has(command.action.view))) throw new Error('Invalid extension command')
    const menus = definition.menus?.map((menu) => pluginMenuSchema.parse(menu)) ?? []
    const keybindings = definition.keybindings?.map((binding) => pluginKeybindingSchema.parse(binding)) ?? []
    if ([...menus, ...keybindings].some((entry) => !commands.some((command) => command.id === entry.command))
      || new Set(menus.map((menu) => `${menu.location}:${menu.command}`)).size !== menus.length) throw new Error('Invalid extension entry')
    registration.definition = Object.freeze({ ...definition, views: Object.freeze([...definition.views]),
      ...(definition.commands ? { commands: Object.freeze(commands) } : {}),
      menus: Object.freeze(menus), keybindings: Object.freeze(keybindings) })
    this.registrations.set(definition.id, registration)
    try {
      this.enable(definition.id)
    } catch (error) {
      this.registrations.delete(definition.id)
      throw error
    }
    return () => {
      if (this.registrations.get(definition.id) !== registration) return
      try { this.disable(definition.id) } finally { this.registrations.delete(definition.id) }
    }
  }

  enable(id: string): void {
    const registration = this.registrations.get(id)
    if (!registration) throw new Error(`Unknown extension: ${id}`)
    if (registration.enabled) return
    const dispose = registration.definition.activate?.()
    registration.dispose = typeof dispose === 'function' ? dispose : undefined
    registration.enabled = true
    registration.activationId = ++this.nextActivationId
    this.publish()
  }

  disable(id: string): void {
    const registration = this.registrations.get(id)
    if (!registration?.enabled) return
    registration.enabled = false
    const dispose = registration.dispose
    registration.dispose = undefined
    // Remove contributions even when an extension's cleanup throws.
    try { dispose?.() } finally { this.publish() }
  }

  private publish(): void {
    this.definitions = Object.freeze([...this.registrations.values()].filter((registration) => registration.enabled).map((registration) => registration.definition))
    this.views = Object.freeze([...this.registrations.values()]
      .filter((registration) => registration.enabled)
      .flatMap((registration) => registration.views.map((view) => Object.freeze({ ...view, activationId: registration.activationId })))
      .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.id.localeCompare(b.id)))
    for (const listener of this.listeners) {
      try { listener() } catch (error) { console.error('Extension registry subscriber failed', error) }
    }
  }
}

export const extensionRegistry = new ExtensionRegistry()

export function isExtensionViewId(id: string): id is ExtensionViewId {
  return /^extension:[a-z][a-z0-9.-]*\/[a-z][a-z0-9.-]*$/.test(id)
}
