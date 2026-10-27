import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { parsePluginManifest, validatePluginCall } from '../../packages/plugin-sdk/src/index'
import { pluginIslandNotifications, PluginIslandPreview } from '../../src/renderer/src/extensions/plugin-island'
import { assembleNotifications, type IslandNotification } from '../../src/renderer/src/components/janus/islandNotifications'
import { ExtensionRegistry, extensionRegistry } from '../../src/renderer/src/extensions/registry'
import { useAppStore } from '../../src/renderer/src/stores/app'
import { useIslandStore } from '../../src/renderer/src/stores/island'
import { useWorkspaceStore } from '../../src/renderer/src/stores/workspace'
import { useRightToolStore } from '../../src/renderer/src/stores/right-tools'
import { openExtensionView } from '../../src/renderer/src/extensions/workbench'
import { useExperimentalStore } from '../../src/renderer/src/stores/experimental'
import type { PluginHostSnapshot } from '../../src/shared/ipc/plugins'

vi.hoisted(() => Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem: () => {} } }))
const manifest = () => parsePluginManifest(readFileSync('packages/plugin-sdk/template/manifest.json', 'utf8'))
afterEach(() => { useAppStore.setState({ activeWorkbench: null, returnWorkbench: null }); useIslandStore.setState({ stage: 'collapsed', pluginViewRequest: null }); vi.restoreAllMocks() })

describe('P3 contribution policy and rendering', () => {
  it('requires an explicit capability for a plugin frame and rejects it outside workbench views', () => {
    const value = manifest()
    value.contributes.views.find(view => view.id === 'desk')!.frame = 'plugin'
    expect(() => parsePluginManifest(JSON.stringify(value))).toThrow()
    value.capabilities.required.push('views.workbench.frame')
    expect(parsePluginManifest(JSON.stringify(value)).contributes.views.find(view => view.id === 'desk')?.frame).toBe('plugin')
    value.contributes.views.find(view => view.id === 'details')!.frame = 'plugin'
    expect(() => parsePluginManifest(JSON.stringify(value))).toThrow()
    expect(() => validatePluginCall(manifest(), 'views.requestFrame', { action: 'close' })).toThrow()
    expect(() => validatePluginCall(value, 'views.requestFrame', { action: 'close', script: 'x' })).toThrow()
    expect(() => validatePluginCall(value, 'views.requestFrame', { action: 'selectWorktree', worktreeId: 'a'.repeat(64) })).toThrow()
    value.capabilities.required.push('views.workbench.worktrees')
    expect(() => validatePluginCall(value, 'views.requestFrame', { action: 'selectWorktree', worktreeId: 'a'.repeat(64) })).not.toThrow()
    expect(() => validatePluginCall(value, 'views.requestFrame', { action: 'selectWorktree', worktreeId: '/arbitrary/root' })).toThrow()
    const rebound = manifest(); rebound.capabilities.required.push('views.workbench.rebind')
    expect(() => parsePluginManifest(JSON.stringify(rebound))).toThrow()
    rebound.contributes.views.find(view => view.id === 'desk')!.frame = 'plugin'
    rebound.capabilities.required.push('views.workbench.frame')
    expect(() => parsePluginManifest(JSON.stringify(rebound))).not.toThrow()
  })
  it('routes a declared settings command to application settings without changing workbench or pane state', () => {
    const dispatch = vi.fn(); vi.stubGlobal('window', { dispatchEvent: dispatch })
    const unregister = extensionRegistry.register({ id: 'test.settings', views: [{ id: 'settings', title: 'Settings', location: 'settings', scope: 'application', component: () => null }] })
    try {
      const tree = useWorkspaceStore.getState().paneTree; const active = useAppStore.getState().activeWorkbench
      expect(openExtensionView('extension:test.settings/settings')).toBe(true)
      expect(dispatch.mock.calls[0][0]).toMatchObject({ type: 'janusx:open-plugin-settings', detail: 'extension:test.settings/settings' })
      expect(useWorkspaceStore.getState().paneTree).toBe(tree); expect(useAppStore.getState().activeWorkbench).toBe(active)
    } finally { unregister(); vi.unstubAllGlobals() }
  })
  it('routes window commands to the native host without opening a pane or Island', () => {
    const dispatch = vi.fn(); vi.stubGlobal('window', { dispatchEvent: dispatch })
    const unregister = extensionRegistry.register({ id: 'test.window', views: [{ id: 'utility', title: 'Utility', location: 'window', scope: 'project', component: () => null }] })
    try {
      useWorkspaceStore.setState({ activeWorkspaceId: 'a' })
      const tree = useWorkspaceStore.getState().paneTree; const stage = useIslandStore.getState().stage
      expect(openExtensionView('extension:test.window/utility')).toBe(true)
      expect(dispatch.mock.calls[0][0]).toMatchObject({ type: 'janusx:plugin-window-open', detail: 'extension:test.window/utility' })
      expect(useWorkspaceStore.getState().paneTree).toBe(tree); expect(useIslandStore.getState().stage).toBe(stage)
    } finally { unregister(); vi.unstubAllGlobals() }
  })
  it('rejects duplicate Island identities, undeclared actions, cross-scope actions and arbitrary executable previews', () => {
    for (const mutate of [
      (m: ReturnType<typeof manifest>) => m.contributes.island!.push(m.contributes.island![0]),
      (m: ReturnType<typeof manifest>) => m.contributes.island![0].actions!.push('unknown'),
      (m: ReturnType<typeof manifest>) => { m.contributes.views.find(v => v.id === 'desk')!.scope = 'application' },
      (m: ReturnType<typeof manifest>) => { m.permissions = m.permissions.filter(p => p.name !== 'ui.island') },
    ]) {
      const value = manifest(); mutate(value)
      expect(() => parsePluginManifest(JSON.stringify(value))).toThrow()
    }
    const value = manifest()
    expect(() => validatePluginCall(value, 'island.update', { id: 'reference', status: { title: 'Ready', state: 'idle', preview: { html: '<script>' } } })).toThrow()
    value.permissions = []
    expect(() => validatePluginCall(value, 'island.update', { id: 'reference', status: null })).toThrow()
    expect(() => new ExtensionRegistry().register({ id: 'test.invalid', views: [{ id: 'bad', title: 'Bad', scope: 'project', location: 'terminal' as 'workspace', component: () => null }] })).toThrow()
  })
  it('renders escaped text with a persistent plugin identity and keeps host notices ahead of external errors', () => {
    const snapshot: PluginHostSnapshot = { developmentMode: true, logs: [], plugins: [{ manifest: manifest(), enabled: true } as any],
      island: [{ pluginId: manifest().id, id: 'reference', instanceId: 'page', projectId: 'a', rootId: 'root', createdAt: 999,
        status: { title: 'Ready', state: 'error', badge: '<img>', preview: { text: '<script>alert(1)</script>', rows: [{ label: '<label>', value: 'x&y' }] } } }] }
    const projected = pluginIslandNotifications(snapshot)
    expect(projected[0].plugin?.pluginId).toBe(manifest().id)
    expect(projected[0].actions).toHaveLength(3)
    const html = renderToStaticMarkup(createElement(PluginIslandPreview, { notification: projected[0] }))
    expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>'); expect(html).not.toContain('<img>')
    const host: IslandNotification = { id: 'host', kind: 'maintenance', severity: 'info', copy: { titleKey: 'host' }, actions: [], createdAt: 0 }
    expect(assembleNotifications([projected[0], host]).map(n => n.id)).toEqual(['host', projected[0].id])
    expect(pluginIslandNotifications({ ...snapshot, developmentMode: false })).toEqual([])
  })
  it('routes workbench/Island without mutating pane or right-tool state and preserves the return view', () => {
    const unregister = extensionRegistry.register({ id: 'test.surfaces', views: ['workbench', 'island'].map(location => ({ id: location, title: location, location: location as 'workbench' | 'island', scope: 'project', component: () => null })) })
    try {
      useWorkspaceStore.setState({ activeWorkspaceId: 'a' })
      useExperimentalStore.setState({ persona: true })
      const tree = useWorkspaceStore.getState().paneTree
      const tools = useRightToolStore.getState().openToolIds
      useAppStore.getState().setActiveWorkbench('knowledge')
      expect(openExtensionView('extension:test.surfaces/workbench')).toBe(true)
      expect(useAppStore.getState()).toMatchObject({ activeWorkbench: 'extension:test.surfaces/workbench', returnWorkbench: 'knowledge' })
      openExtensionView('extension:test.surfaces/workbench')
      useAppStore.getState().closePluginWorkbench()
      expect(useAppStore.getState().activeWorkbench).toBe('knowledge')
      openExtensionView('extension:test.surfaces/island')
      openExtensionView('extension:test.surfaces/island')
      expect(useIslandStore.getState().stage).toBe('expanded')
      expect(useIslandStore.getState().pluginViewRequest?.viewId).toBe('extension:test.surfaces/island')
      expect(useWorkspaceStore.getState().paneTree).toBe(tree)
      expect(useRightToolStore.getState().openToolIds).toBe(tools)
      useWorkspaceStore.setState({ activeWorkspaceId: null })
      expect(openExtensionView('extension:test.surfaces/workbench')).toBe(false)
    } finally { unregister() }
  })
  it('returns to the workspace if the prior built-in workbench was disabled while a plugin was open', () => {
    useExperimentalStore.setState({ persona: true })
    useAppStore.getState().setActiveWorkbench('knowledge')
    useAppStore.getState().openPluginWorkbench('extension:test.surfaces/desk')
    useExperimentalStore.setState({ persona: false })
    useAppStore.getState().closePluginWorkbench()
    expect(useAppStore.getState()).toMatchObject({ activeWorkbench: null, returnWorkbench: null })
    useAppStore.getState().setActiveWorkbench('blueprint')
    useAppStore.getState().closePluginWorkbench()
    expect(useAppStore.getState().activeWorkbench).toBe('blueprint')
  })
})
