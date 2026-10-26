import { afterEach, describe, expect, it, vi } from 'vitest'
import { isRightToolEnabled, RIGHT_TOOL_IDS, RIGHT_TOOL_REGISTRY } from '../../src/renderer/src/right-tools/registry'
import {
  activateRightTool,
  clampRightToolPanelWidth,
  closeRightTool,
  createDefaultRightToolPreferences,
  FILES_PANEL_DEFAULT_WIDTH,
  normalizeRightToolIds,
  openRightTool,
  reconcileRightToolPreferences,
  RIGHT_TOOL_PANEL_DEFAULT_WIDTH,
  RIGHT_TOOL_PANEL_MAX_WIDTH,
  RIGHT_TOOL_PANEL_MIN_WIDTH,
  SESSION_PANEL_DEFAULT_WIDTH,
  SESSION_PANEL_MAX_WIDTH,
  SESSION_PANEL_MIN_WIDTH,
  preferredRightToolPanelWidth,
  toggleRightToolFromRail,
} from '../../src/renderer/src/right-tools/state'
import type { RightToolPreferencesV1 } from '../../src/renderer/src/right-tools/types'

const RIGHT_TOOL_STORAGE_KEY = 'janusx:right-tools:v1'

function preferences(
  openToolIds: RightToolPreferencesV1['openToolIds'],
  activeToolId: RightToolPreferencesV1['activeToolId'],
): RightToolPreferencesV1 {
  return { schemaVersion: 1, openToolIds, activeToolId, panelWidth: 280 }
}

describe('right tool registry', () => {
  it('defines the four single-instance while-open tools in stable order', () => {
    expect(RIGHT_TOOL_IDS).toEqual(['files', 'git', 'assist', 'sessions'])
    expect(RIGHT_TOOL_REGISTRY.every(({ instancePolicy }) => instancePolicy === 'single')).toBe(true)
    expect(RIGHT_TOOL_REGISTRY.every(({ mountPolicy }) => mountPolicy === 'while-open')).toBe(true)
    expect(RIGHT_TOOL_REGISTRY.some(({ id }) => (id as string) === 'office')).toBe(false)
  })

  it('gates the sessions tool on the experimental preview flag only', () => {
    expect(isRightToolEnabled('sessions', { knowledge: true, persona: true, sessions: true })).toBe(true)
    expect(isRightToolEnabled('sessions', { knowledge: true, persona: true, sessions: false })).toBe(false)
    expect(isRightToolEnabled('files', { knowledge: false, persona: false, sessions: false })).toBe(true)
    expect(isRightToolEnabled('git', { knowledge: false, persona: false, sessions: false })).toBe(true)
    expect(isRightToolEnabled('assist', { knowledge: true, persona: true, sessions: false })).toBe(true)
  })
})

describe('right tool transitions', () => {
  it('opens a closed tool once in registry order, activates it and expands', () => {
    const result = openRightTool(preferences(['files', 'assist'], 'files'), 'git')

    expect(result.preferences.openToolIds).toEqual(['files', 'git', 'assist'])
    expect(result.preferences.activeToolId).toBe('git')
    expect(result.panelCollapseCommand).toBe('expand')
  })

  it('reopening an open tool activates without duplicating it', () => {
    const result = openRightTool(preferences(['files', 'git'], 'files'), 'git')

    expect(result.preferences.openToolIds).toEqual(['files', 'git'])
    expect(result.preferences.activeToolId).toBe('git')
  })

  it('activates an open inactive tool without changing the open set', () => {
    const result = activateRightTool(preferences(['files', 'git'], 'files'), 'git')

    expect(result.preferences.openToolIds).toEqual(['files', 'git'])
    expect(result.preferences.activeToolId).toBe('git')
    expect(result.panelCollapseCommand).toBe('expand')
  })

  it('toggles only panel collapse for an active rail tool', () => {
    const before = preferences(['files', 'git'], 'git')
    const result = toggleRightToolFromRail(before, 'git')

    expect(result.preferences).toEqual(before)
    expect(result.panelCollapseCommand).toBe('toggle')
  })

  it('closes an inactive tool without changing the active tool', () => {
    const result = closeRightTool(preferences(['files', 'git', 'assist'], 'git'), 'files')

    expect(result.preferences.openToolIds).toEqual(['git', 'assist'])
    expect(result.preferences.activeToolId).toBe('git')
  })

  it.each([
    ['right neighbor', ['files', 'git', 'assist'] as const, 'git', 'git', ['files', 'assist'], 'assist', undefined],
    ['left neighbor', ['files', 'git'] as const, 'git', 'git', ['files'], 'files', undefined],
    ['only tool', ['files'] as const, 'files', 'files', [], null, 'collapse'],
  ] as const)('closing the active tool selects the %s', (_label, openIds, activeId, closingId, expectedOpen, expectedActive, expectedCommand) => {
    const result = closeRightTool(preferences(openIds, activeId), closingId)

    expect(result.preferences.openToolIds).toEqual(expectedOpen)
    expect(result.preferences.activeToolId).toBe(expectedActive)
    if (expectedCommand) {
      expect(result.panelCollapseCommand).toBe(expectedCommand)
    }
  })
})

describe('right tool reconciliation', () => {
  it('migrates legacy persona and review panels to one assistant', () => {
    const state = reconcileRightToolPreferences(preferences(['files', 'persona', 'review', 'assist'], 'review'))
    expect(state.openToolIds).toEqual(['files', 'assist'])
    expect(state.activeToolId).toBe('assist')
    expect(openRightTool(state, 'persona').preferences.activeToolId).toBe('assist')
  })
  it('filters unknown IDs, deduplicates and restores registry order', () => {
    expect(normalizeRightToolIds(['assist', 'git', 'unknown', 'git', 'files'])).toEqual([
      'files',
      'git',
      'assist',
    ])
  })

  it('repairs an active tool outside the normalized open set', () => {
    const result = reconcileRightToolPreferences({
      schemaVersion: 1,
      openToolIds: ['git', 'files'],
      activeToolId: 'assist',
      panelWidth: 280,
    })

    expect(result.openToolIds).toEqual(['files', 'git'])
    expect(result.activeToolId).toBe('files')
  })

  it('enforces an empty open set having no active tool', () => {
    const result = reconcileRightToolPreferences({
      schemaVersion: 1,
      openToolIds: [],
      activeToolId: 'files',
      panelWidth: 280,
    })

    expect(result.activeToolId).toBeNull()
  })

  it('restores defaults for malformed or obsolete persisted values', () => {
    expect(reconcileRightToolPreferences('not-an-object')).toEqual(createDefaultRightToolPreferences())
    expect(reconcileRightToolPreferences({ schemaVersion: 1, openToolIds: 'files' })).toEqual(
      createDefaultRightToolPreferences(),
    )
    expect(reconcileRightToolPreferences({ schemaVersion: 0 })).toEqual(
      createDefaultRightToolPreferences(),
    )
  })
})

describe('right tool persistence contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('hydrates defaults on first start and persists only display preferences', async () => {
    const { storeModule } = await loadStores()
    const { useRightToolStore } = storeModule
    const options = useRightToolStore.persist.getOptions()
    const persisted = options.partialize!(useRightToolStore.getState())

    expect(useRightToolStore.persist.hasHydrated()).toBe(true)
    expect(pickPreferences(useRightToolStore.getState())).toEqual(createDefaultRightToolPreferences())
    expect(options.name).toBe(RIGHT_TOOL_STORAGE_KEY)
    expect(options.version).toBe(1)
    expect(Object.keys(persisted as object).sort()).toEqual([
      'activeToolId',
      'openToolIds',
      'panelWidth',
      'schemaVersion',
    ])
    expect('panelCollapsed' in (persisted as object)).toBe(false)
  })

  it('hydrates a v1 persisted envelope rail-only, keeping only the clamped width', async () => {
    const { useRightToolStore } = (
      await loadStores(
        envelope({
          schemaVersion: 1,
          openToolIds: ['assist', 'unknown', 'git', 'git', 'files'],
          activeToolId: 'unknown',
          panelWidth: 999,
        }),
      )
    ).storeModule

    expect(useRightToolStore.persist.hasHydrated()).toBe(true)
    expect(pickPreferences(useRightToolStore.getState())).toEqual({
      schemaVersion: 1,
      openToolIds: [],
      activeToolId: null,
      panelWidth: 420,
    })
  })

  it('ignores a legacy all-open envelope and launches rail-only with its width', async () => {
    const { useRightToolStore } = (
      await loadStores(
        envelope({
          schemaVersion: 1,
          openToolIds: ['files', 'git', 'checkpoints', 'assist'],
          activeToolId: 'files',
          panelWidth: 300,
        }),
      )
    ).storeModule

    expect(pickPreferences(useRightToolStore.getState())).toEqual({
      schemaVersion: 1,
      openToolIds: [],
      activeToolId: null,
      panelWidth: 300,
    })
  })

  it('persists an open session as rail-only so the next launch starts closed', async () => {
    const { storeModule } = await loadStores()
    const { useRightToolStore } = storeModule

    useRightToolStore.getState().openTool('git')
    useRightToolStore.getState().setPanelWidth(320)
    const persisted = useRightToolStore.persist
      .getOptions()
      .partialize!(useRightToolStore.getState())

    expect(persisted).toEqual({
      schemaVersion: 1,
      openToolIds: [],
      activeToolId: null,
      panelWidth: 320,
    })
  })

  it('restores separate tab widths across launches and clamps invalid saved values', async () => {
    const { useRightToolStore } = (await loadStores(envelope({
      schemaVersion: 1,
      openToolIds: ['sessions', 'files'],
      activeToolId: 'sessions',
      panelWidth: 280,
      panelWidths: { sessions: 480, files: 310, git: 999, assist: 'invalid' },
    }))).storeModule

    const state = useRightToolStore.getState()
    expect(state.openToolIds).toEqual([])
    expect(state.panelWidths).toEqual({ sessions: 480, files: 310, git: 520 })
    expect(preferredRightToolPanelWidth(state.panelWidth, state.panelWidths, 'sessions')).toBe(480)
  })

  it('migrates an old envelope to defaults and the current version', async () => {
    const { storage, storeModule } = await loadStores(
      envelope(
        {
          schemaVersion: 0,
          openToolIds: ['assist'],
          activeToolId: 'assist',
          panelWidth: 320,
        },
        0,
      ),
    )

    expect(storeModule.useRightToolStore.persist.hasHydrated()).toBe(true)
    expect(pickPreferences(storeModule.useRightToolStore.getState())).toEqual(
      createDefaultRightToolPreferences(),
    )
    expect(JSON.parse(storage.getItem(RIGHT_TOOL_STORAGE_KEY)!)).toMatchObject({ version: 1 })
  })

  it.each([
    [null, 280],
    [-1, 240],
  ] as const)('normalizes invalid persisted width %s to %i', async (panelWidth, expected) => {
    const result = await loadStores(
      envelope({
        schemaVersion: 1,
        openToolIds: ['git'],
        activeToolId: 'git',
        panelWidth,
      }),
    )
    expect(result.storeModule.useRightToolStore.getState().panelWidth).toBe(expected)
  })

  it('treats malformed JSON as no saved value and completes hydration', async () => {
    const { storeModule } = await loadStores('{ malformed json')

    expect(() => storeModule.useRightToolStore.getState()).not.toThrow()
    expect(storeModule.useRightToolStore.persist.hasHydrated()).toBe(true)
    expect(pickPreferences(storeModule.useRightToolStore.getState())).toEqual(
      createDefaultRightToolPreferences(),
    )
  })

  it('persists width changes but skips identical preferences during tool switches', async () => {
    const { storage, storeModule } = await loadStores()
    const writes = vi.spyOn(storage, 'setItem')
    const store = storeModule.useRightToolStore
    store.getState().setPanelWidth(310, 'files')
    writes.mockClear()
    for (let i = 0; i < 8; i++) {
      store.getState().openTool('git')
      store.getState().openTool('files')
    }
    expect(writes.mock.calls.filter(([key]) => key === RIGHT_TOOL_STORAGE_KEY)).toHaveLength(0)
    store.getState().setPanelWidth(330, 'files')
    expect(JSON.parse(storage.getItem(RIGHT_TOOL_STORAGE_KEY)!).state.panelWidths.files).toBe(330)
    store.persist.clearStorage()
    store.getState().setPanelWidth(330, 'files')
    expect(JSON.parse(storage.getItem(RIGHT_TOOL_STORAGE_KEY)!).state.panelWidths.files).toBe(330)
  })

  it('delegates expand, toggle and collapse commands to the existing App Store', async () => {
    const { appModule, storeModule } = await loadStores()
    const { useAppStore } = appModule
    const { useRightToolStore } = storeModule

    useRightToolStore.setState(preferences(['files'], 'files'))
    useAppStore.getState().setPanelCollapsed(true)
    useRightToolStore.getState().openTool('git')
    expect(useAppStore.getState().panelCollapsed).toBe(false)

    useAppStore.getState().setPanelCollapsed(true)
    useRightToolStore.getState().activateTool('files')
    expect(useAppStore.getState().panelCollapsed).toBe(false)

    useRightToolStore.getState().toggleFromRail('files')
    expect(useAppStore.getState().panelCollapsed).toBe(true)
    expect(useRightToolStore.getState().openToolIds).toEqual(['files', 'git'])

    useRightToolStore.setState(preferences(['files'], 'files'))
    useAppStore.getState().setPanelCollapsed(false)
    useRightToolStore.getState().closeTool('files')
    expect(useAppStore.getState().panelCollapsed).toBe(true)
    expect(useRightToolStore.getState()).not.toHaveProperty('panelCollapsed')
  })
})

function createMemoryStorage(initialValue?: string) {
  const values = new Map<string, string>()
  if (initialValue !== undefined) values.set(RIGHT_TOOL_STORAGE_KEY, initialValue)

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  }
}

async function loadStores(initialValue?: string) {
  vi.resetModules()
  const storage = createMemoryStorage(initialValue)
  vi.stubGlobal('localStorage', storage)

  const [storeModule, appModule] = await Promise.all([
    import('../../src/renderer/src/stores/right-tools'),
    import('../../src/renderer/src/stores/app'),
  ])

  return { storage, storeModule, appModule }
}

function envelope(state: unknown, version = 1): string {
  return JSON.stringify({ state, version })
}

function pickPreferences(state: RightToolPreferencesV1): RightToolPreferencesV1 {
  return {
    schemaVersion: state.schemaVersion,
    openToolIds: state.openToolIds,
    activeToolId: state.activeToolId,
    panelWidth: state.panelWidth,
  }
}

describe('right tool panel width', () => {
  it('uses the 240/280/420 bounds for invalid and out-of-range values', () => {
    expect(RIGHT_TOOL_PANEL_MIN_WIDTH).toBe(240)
    expect(RIGHT_TOOL_PANEL_DEFAULT_WIDTH).toBe(280)
    expect(RIGHT_TOOL_PANEL_MAX_WIDTH).toBe(420)
    expect(clampRightToolPanelWidth(Number.NaN)).toBe(280)
    expect(clampRightToolPanelWidth('320')).toBe(280)
    expect(clampRightToolPanelWidth(-1)).toBe(240)
    expect(clampRightToolPanelWidth(999)).toBe(420)
  })

  it('honors a runtime effective maximum without going below the minimum', () => {
    expect(clampRightToolPanelWidth(400, 360)).toBe(360)
    expect(clampRightToolPanelWidth(400, 100)).toBe(240)
  })

  it('uses a wider session default and keeps per-tab drag preferences independent', async () => {
    expect([SESSION_PANEL_MIN_WIDTH, SESSION_PANEL_DEFAULT_WIDTH, SESSION_PANEL_MAX_WIDTH]).toEqual([340, 360, 520])
    expect(preferredRightToolPanelWidth(280, undefined, 'sessions')).toBe(360)
    expect(clampRightToolPanelWidth(100, 520, 'sessions')).toBe(340)
    expect(clampRightToolPanelWidth(999, 520, 'sessions')).toBe(520)

    const { useRightToolStore } = (await loadStores()).storeModule
    useRightToolStore.getState().setPanelWidth(480, 'sessions')
    useRightToolStore.getState().setPanelWidth(310, 'files')
    const state = useRightToolStore.getState()
    expect(preferredRightToolPanelWidth(state.panelWidth, state.panelWidths, 'sessions')).toBe(480)
    expect(preferredRightToolPanelWidth(state.panelWidth, state.panelWidths, 'files')).toBe(310)
    expect(preferredRightToolPanelWidth(state.panelWidth, state.panelWidths, 'git')).toBe(360)
    expect(state.panelWidth).toBe(280)

    const persisted = useRightToolStore.persist.getOptions().partialize!(state)
    expect(persisted.panelWidths).toEqual({ sessions: 480, files: 310 })
  })

  it('starts files narrower and gives Git the session width range', () => {
    expect(FILES_PANEL_DEFAULT_WIDTH).toBe(260)
    expect(preferredRightToolPanelWidth(280, undefined, 'files')).toBe(260)
    expect(preferredRightToolPanelWidth(280, undefined, 'git')).toBe(360)
    expect(clampRightToolPanelWidth(100, undefined, 'git')).toBe(340)
    expect(clampRightToolPanelWidth(999, undefined, 'git')).toBe(520)
  })
})
