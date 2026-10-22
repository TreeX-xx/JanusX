import { describe, expect, it, vi } from 'vitest'
import { ExtensionRegistry } from '../../src/renderer/src/extensions/registry'
import { ExtensionCommandRegistry } from '../../src/renderer/src/extensions/commands'
import type { ExtensionDefinition } from '../../src/renderer/src/extensions/types'
import { manifestContribution } from '../../src/renderer/src/extensions/manifest'
import { parsePluginManifest } from '../../packages/plugin-sdk/src/index'
import { readFileSync } from 'node:fs'

const definition = (id = 'test.commands'): ExtensionDefinition => ({
  id, views: [{ id: 'details', title: 'Details', location: 'workspace', scope: 'project', component: () => null }],
  commands: [{ id: 'open', title: 'Open details', action: { type: 'openView', view: 'details' } }],
  menus: [{ location: 'toolbox', command: 'open' }, { location: 'workspace-add', command: 'open', when: 'projectOpen' }],
  keybindings: [{ command: 'open', key: 'Ctrl+Alt+Shift+R', mac: 'Meta+Alt+Shift+R' }],
})

describe('commands independent of view positions and menu entries', () => {
  it('adapts only explicit public commands and never invents a legacy launcher for a manifest', () => {
    const manifest = parsePluginManifest(readFileSync('packages/plugin-sdk/template/manifest.json', 'utf8'))
    manifest.contributes.commands = []
    manifest.contributes.menus = []
    manifest.contributes.keybindings = []
    manifest.contributes.island = []
    const source = new ExtensionRegistry()
    const registry = new ExtensionCommandRegistry(source)
    const component = vi.fn(() => () => null)
    source.register(manifestContribution(manifest, component))
    expect(component).toHaveBeenCalledTimes(4)
    expect(source.getSnapshot()).toHaveLength(4)
    expect(registry.getSnapshot().commands).toEqual([])
    expect(registry.getSnapshot().menus).toEqual([])
    registry.dispose()
  })

  it('keeps two commands targeting one view as distinct entries', () => {
    const source = new ExtensionRegistry()
    const registry = new ExtensionCommandRegistry(source)
    const value = definition()
    source.register({ ...value,
      commands: [...value.commands!, { id: 'inspect', title: 'Inspect', action: { type: 'openView', view: 'details' } }],
      menus: [...value.menus!, { location: 'toolbox', command: 'inspect' }],
    })
    const entries = registry.getMenus('toolbox', true)
    expect(entries).toHaveLength(2)
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(2)
    expect(entries[0].view.id).toBe(entries[1].view.id)
    registry.dispose()
  })

  it('uses the same command for toolbox and shortcut; hiding an entry leaves the command usable', () => {
    const source = new ExtensionRegistry()
    const registry = new ExtensionCommandRegistry(source)
    source.register(definition())
    const menus = registry.getMenus('toolbox', true)
    const open = vi.fn(() => true)
    expect(registry.getMenus('workspace-add', true)[0].commandId).toBe(menus[0].commandId)
    const command = registry.resolveKeybindings(false, true).active.get('Ctrl+Alt+Shift+R')!
    expect(registry.execute(command, true, open)).toBe(true)
    expect(open).toHaveBeenCalledWith('extension:test.commands/details')
    registry.setMenuPreference(menus[0].id, { hidden: true })
    expect(registry.getMenus('toolbox', true)).toEqual([])
    expect(registry.execute(command, true, open)).toBe(true)
    expect(registry.getMenus('workspace-add', true)).toHaveLength(1)
    registry.dispose()
  })

  it('enforces project context at execution and condition evaluation', () => {
    const source = new ExtensionRegistry()
    const registry = new ExtensionCommandRegistry(source)
    source.register(definition())
    expect(registry.getMenus('workspace-add', false)).toEqual([])
    expect(registry.getMenus('toolbox', false)).toHaveLength(1)
    const open = vi.fn(() => true)
    expect(registry.execute('command:test.commands/open', false, open)).toBe(false)
    expect(open).not.toHaveBeenCalled()
    expect(registry.resolveKeybindings(false, false).active.size).toBe(0)
    registry.dispose()
  })

  it('adapts legacy launchers exactly once and removes all entries on disable/unregister', () => {
    const source = new ExtensionRegistry()
    const registry = new ExtensionCommandRegistry(source)
    const value = definition()
    const unregister = source.register({ id: value.id, views: [{ ...value.views[0], launcher: 'tool-menu' }] })
    expect(registry.getSnapshot().commands).toHaveLength(1)
    expect(registry.getMenus('toolbox', true)).toHaveLength(1)
    expect(registry.getMenus('workspace-add', true)).toHaveLength(0)
    source.disable(value.id)
    expect(registry.getSnapshot().commands).toEqual([])
    source.enable(value.id)
    expect(registry.getMenus('toolbox', true)).toHaveLength(1)
    unregister()
    expect(registry.getSnapshot().menus).toEqual([])
    expect(registry.execute('command:test.commands/details', true, vi.fn())).toBe(false)
    registry.dispose()
  })

  it('disables equal-priority shortcut conflicts and gives a user binding priority over defaults', () => {
    const source = new ExtensionRegistry()
    const registry = new ExtensionCommandRegistry(source)
    source.register(definition())
    source.register(definition('other.commands'))
    expect(registry.resolveKeybindings(false, true).active.size).toBe(0)
    expect(registry.resolveKeybindings(false, true).conflicts).toHaveLength(2)
    expect(registry.resolveKeybindings(false, true).diagnostics[0]).toMatchObject({ code: 'KEYBINDING_CONFLICT', key: 'Ctrl+Alt+Shift+R' })
    registry.setKeybinding('command:test.commands/open', 'Ctrl+Alt+Shift+R')
    expect(registry.resolveKeybindings(false, true).active.get('Ctrl+Alt+Shift+R')).toBe('command:test.commands/open')
    registry.setKeybinding('command:other.commands/open', 'Ctrl+Alt+Shift+R')
    expect(registry.resolveKeybindings(false, true).active.size).toBe(0)
    registry.setKeybinding('command:other.commands/open', null)
    expect(registry.resolveKeybindings(false, true).active.size).toBe(1)
    expect(() => registry.setKeybinding('command:test.commands/open', 'Ctrl+P')).toThrow('Reserved')
    registry.dispose()
  })

  it('persists entry ordering and shortcuts, tolerates stale IDs and corrupt preferences', () => {
    const source = new ExtensionRegistry()
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
    const registry = new ExtensionCommandRegistry(source, storage)
    source.register(definition())
    source.register(definition('other.commands'))
    const entry = registry.getMenus('toolbox', true).find((item) => item.commandId === 'command:test.commands/open')!
    registry.setMenuPreference(entry.id, { order: -10 })
    registry.setMenuPreference(entry.id, { hidden: true })
    registry.setMenuPreference(entry.id, { hidden: false })
    expect(registry.getPreferences().menus[entry.id]).toEqual({ order: -10, hidden: false })
    registry.setKeybinding(entry.commandId, 'Ctrl+Alt+Shift+Q')
    registry.dispose()
    const restored = new ExtensionCommandRegistry(source, storage)
    expect(restored.getMenus('toolbox', true)[0].id).toBe(entry.id)
    expect(restored.resolveKeybindings(false, true).active.get('Ctrl+Alt+Shift+Q')).toBe(entry.commandId)
    restored.dispose()
    expect(() => new ExtensionCommandRegistry(source, { getItem: () => '{broken', setItem: () => {} }).dispose()).not.toThrow()
  })

  it('retains the prior in-memory preference when persistence fails', () => {
    const source = new ExtensionRegistry()
    const registry = new ExtensionCommandRegistry(source, { getItem: () => null, setItem: () => { throw new Error('full') } })
    source.register(definition())
    const entry = registry.getMenus('toolbox', true)[0]
    expect(() => registry.setMenuPreference(entry.id, { hidden: true })).toThrow('full')
    expect(registry.getMenus('toolbox', true)).toHaveLength(1)
    registry.dispose()
  })

  it('rejects malformed commands and dangling entries before activation', () => {
    const source = new ExtensionRegistry()
    const value = definition()
    const activate = vi.fn()
    expect(() => source.register({ ...value, activate, commands: [{ id: 'bad', title: 'Bad', action: { type: 'openView', view: 'missing' } }] })).toThrow()
    expect(() => source.register({ ...value, activate, menus: [{ location: 'toolbox', command: 'missing' }] })).toThrow()
    expect(activate).not.toHaveBeenCalled()
    expect(source.getSnapshot()).toEqual([])
  })
})
