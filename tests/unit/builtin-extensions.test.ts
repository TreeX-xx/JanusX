import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUILTIN_RIGHT_EXTENSIONS, builtinRightViewId } from '../../src/renderer/src/extensions/builtins'
import { extensionRegistry } from '../../src/renderer/src/extensions/registry'
import { openExtensionView } from '../../src/renderer/src/extensions/workbench'
import { getRightToolDefinitions, getRightToolView, isRightToolEnabled } from '../../src/renderer/src/right-tools/registry'
import { normalizeRightToolIds } from '../../src/renderer/src/right-tools/state'
import { useRightToolStore } from '../../src/renderer/src/stores/right-tools'
import { useExperimentalStore } from '../../src/renderer/src/stores/experimental'
import { useWorkspaceStore } from '../../src/renderer/src/stores/workspace'

vi.hoisted(() => {
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  } })
})

afterEach(() => {
  for (const { definition } of BUILTIN_RIGHT_EXTENSIONS) extensionRegistry.enable(definition.id)
  useRightToolStore.setState({ openToolIds: [], activeToolId: null, panelWidths: undefined })
})

describe('built-in right-hand extensions', () => {
  it.each(BUILTIN_RIGHT_EXTENSIONS)('preserves the legacy identity and width of $tool.id across disable and enable', (builtin) => {
    const id = builtin.tool.id
    const viewId = builtinRightViewId(builtin)
    const view = getRightToolView(id)!
    expect(view.id).toBe(viewId)
    expect(view.scope).toBe('application')
    expect(getRightToolDefinitions().filter((tool) => tool.id === id || tool.id === viewId)).toEqual([builtin.tool])
    useRightToolStore.getState().openTool(id)
    useRightToolStore.getState().setPanelWidth(390, viewId)
    expect(openExtensionView(viewId)).toBe(true)
    expect(useRightToolStore.getState().openToolIds).toEqual([id])
    expect(normalizeRightToolIds([viewId, id])).toEqual([id])

    extensionRegistry.disable(builtin.definition.id)
    expect(getRightToolDefinitions().some((tool) => tool.id === id)).toBe(false)
    expect(useRightToolStore.getState().openToolIds).toEqual([])
    expect(useRightToolStore.getState().activeToolId).toBeNull()
    expect(useRightToolStore.getState().panelWidths).toEqual({ [id]: 390 })
    expect(openExtensionView(viewId)).toBe(false)
    useRightToolStore.getState().openTool(id)
    expect(useRightToolStore.getState().openToolIds).toEqual([])

    extensionRegistry.enable(builtin.definition.id)
    expect(getRightToolView(id)!.activationId).not.toBe(view.activationId)
    expect(useRightToolStore.getState().openToolIds).toEqual([])
    expect(openExtensionView(viewId)).toBe(true)
    expect(useRightToolStore.getState().openToolIds).toEqual([id])
    useRightToolStore.getState().closeTool(viewId)
    expect(useRightToolStore.getState().openToolIds).toEqual([])
    expect(getRightToolView(id)).toBeDefined()
  })

  it('opens session management through both entry points with experimental features off', () => {
    const viewId = 'extension:janusx.sessions/panel'
    useExperimentalStore.getState().apply({ knowledge: false, persona: false })
    expect(isRightToolEnabled(viewId, { knowledge: false, persona: false })).toBe(true)
    expect(openExtensionView(viewId)).toBe(true)
    useRightToolStore.getState().closeTool(viewId)
    useRightToolStore.getState().openTool('sessions')
    expect(useRightToolStore.getState().openToolIds).toEqual(['sessions'])
  })

  it('allows the existing empty-project shells and closes views without disabling their extensions', () => {
    useWorkspaceStore.setState({ activeWorkspaceId: null })
    for (const builtin of BUILTIN_RIGHT_EXTENSIONS) {
      expect(openExtensionView(builtinRightViewId(builtin))).toBe(true)
      useRightToolStore.getState().closeTool(builtin.tool.id)
      expect(getRightToolView(builtin.tool.id)).toBeDefined()
    }
    expect(useRightToolStore.getState().openToolIds).toEqual([])
  })
})
