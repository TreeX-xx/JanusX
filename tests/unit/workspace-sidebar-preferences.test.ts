import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })
const key = 'janusx-workspace-sidebar'
function storage(seed?: string) {
  const values = new Map<string, string>(seed ? [[key, seed]] : [])
  vi.stubGlobal('localStorage', {
    getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, value: string) => { values.set(name, value) },
    removeItem: (name: string) => { values.delete(name) },
  })
  return values
}

it('restores all collapse preferences after a fresh load without persisting runtime state', async () => {
  const values = storage()
  const { useAppStore } = await import('../../src/renderer/src/stores/app')
  useAppStore.getState().toggleSidebar()
  useAppStore.getState().setExpandedWorkspaceIds(() => ['project'])
  useAppStore.getState().setCollapsedGroupIds(() => ['group'])
  useAppStore.getState().setJanusRunning(true)
  expect(JSON.parse(values.get(key)!).state).toEqual({ sidebarCollapsed: true, expandedWorkspaceIds: ['project'], collapsedGroupIds: ['group'] })
  vi.resetModules()
  const restored = (await import('../../src/renderer/src/stores/app')).useAppStore
  expect(restored.getState()).toMatchObject({ sidebarCollapsed: true, expandedWorkspaceIds: ['project'], collapsedGroupIds: ['group'], janusRunning: false })
  restored.getState().pruneSidebarPreferences([{ id: 'other' }])
  expect(JSON.parse(values.get(key)!).state).toEqual({ sidebarCollapsed: true, expandedWorkspaceIds: [], collapsedGroupIds: [] })
})

it.each(['not json', JSON.stringify({ state: { sidebarCollapsed: 'false', expandedWorkspaceIds: [null, 1, 'valid', 'valid'], collapsedGroupIds: {} }, version: 0 })])('tolerates malformed saved preferences: %s', async seed => {
  storage(seed)
  const { useAppStore } = await import('../../src/renderer/src/stores/app')
  expect(useAppStore.getState().sidebarCollapsed).toBe(false)
  expect(useAppStore.getState().collapsedGroupIds).toEqual([])
  expect(useAppStore.getState().expandedWorkspaceIds).toEqual(seed === 'not json' ? [] : ['valid'])
  expect(() => useAppStore.getState().toggleSidebar()).not.toThrow()
})

it('keeps navigation working when browser storage is unavailable', async () => {
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('quota') } })
  const { useAppStore } = await import('../../src/renderer/src/stores/app')
  expect(() => useAppStore.getState().toggleSidebar()).not.toThrow()
  expect(useAppStore.getState().sidebarCollapsed).toBe(true)
})
