import { useAssistantStore } from './assistant'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { PersistStorage, StateStorage } from 'zustand/middleware'
import { useAppStore } from './app'
import { useExperimentalStore } from './experimental'
import { canonicalRightToolId, getRightToolView, isRightToolEnabled } from '../right-tools/registry'
import { extensionRegistry } from '@/extensions/registry'
import { useWorkspaceStore } from './workspace'
import {
  activateRightTool,
  clampRightToolPanelWidth,
  closeRightTool,
  createDefaultRightToolPreferences,
  openRightTool,
  reconcileRightToolPreferences,
  RIGHT_TOOL_SCHEMA_VERSION,
  toggleRightToolFromRail,
} from '../right-tools/state'
import type {
  PanelCollapseCommand,
  RightToolId,
  RightToolPreferencesV1,
  RightToolTransition,
} from '../right-tools/types'

export const RIGHT_TOOL_STORAGE_KEY = 'janusx:right-tools:v1'
export const RIGHT_TOOL_PERSIST_VERSION = RIGHT_TOOL_SCHEMA_VERSION

interface RightToolStore extends RightToolPreferencesV1 {
  openTool: (toolId: RightToolId) => void
  activateTool: (toolId: RightToolId) => void
  closeTool: (toolId: RightToolId) => void
  toggleFromRail: (toolId: RightToolId) => void
  setPanelWidth: (width: number, toolId?: RightToolId | null) => void
  reconcile: () => void
}

const defaults = createDefaultRightToolPreferences()

export function selectPersistedRightToolPreferences(
  state: RightToolPreferencesV1,
): RightToolPreferencesV1 {
  // Only display preferences survive restarts; every launch starts rail-only.
  return {
    schemaVersion: state.schemaVersion,
    openToolIds: [],
    activeToolId: null,
    panelWidth: state.panelWidth,
    ...(state.panelWidths ? { panelWidths: state.panelWidths } : {}),
  }
}

export function createSafeRightToolStorage(
  getStorage: () => StateStorage,
): PersistStorage<RightToolPreferencesV1> | undefined {
  const storage = createJSONStorage<RightToolPreferencesV1>(() => {
    const underlying = getStorage()
    // Switching tools changes runtime state, but not the persisted widths.
    // Avoid synchronous localStorage writes on that interaction path.
    const written = new Map<string, string>()
    return {
      getItem: (name) => underlying.getItem(name),
      setItem: (name, value) => {
        if (written.get(name) === value) return
        const result = underlying.setItem(name, value)
        // Only cache completed synchronous writes; asynchronous backends retain
        // their own ordering and retry semantics.
        if (!(result instanceof Promise)) written.set(name, value)
        return result
      },
      removeItem: (name) => {
        written.delete(name)
        return underlying.removeItem(name)
      },
    }
  })
  if (!storage) return undefined

  return {
    ...storage,
    getItem: (name) => {
      try {
        const value = storage.getItem(name)
        return value instanceof Promise ? value.catch(() => null) : value
      } catch {
        return null
      }
    },
  }
}

export const useRightToolStore = create<RightToolStore>()(
  persist<RightToolStore, [], [], RightToolPreferencesV1>(
    (set, get) => {
      const applyTransition = (result: RightToolTransition): void => {
        set(result.preferences)
        applyPanelCollapseCommand(result.panelCollapseCommand)
      }
      const route = (toolId: RightToolId, transition: typeof openRightTool): void => {
        if (!isRightToolEnabled(toolId, useExperimentalStore.getState())) return
        if (getRightToolView(toolId)?.scope === 'project' && !useWorkspaceStore.getState().activeWorkspaceId) return
        if (toolId === 'persona' || toolId === 'review') {
          useAssistantStore.getState().setSection(toolId === 'persona' ? 'personal' : 'review')
        }
        applyTransition(transition(get(), canonicalRightToolId(toolId) as RightToolId))
      }

      return {
        ...defaults,
        openTool: (toolId) => route(toolId, openRightTool),
        activateTool: (toolId) => route(toolId, activateRightTool),
        closeTool: (toolId) => applyTransition(closeRightTool(get(), toolId)),
        toggleFromRail: (toolId) => route(toolId, toggleRightToolFromRail),
        setPanelWidth: (panelWidth, toolId) => {
          const id = canonicalRightToolId(toolId) as RightToolId | null | undefined
          set((state) => id
            ? { panelWidths: { ...state.panelWidths, [id]: clampRightToolPanelWidth(panelWidth, undefined, id) } }
            : { panelWidth: clampRightToolPanelWidth(panelWidth) })
        },
        reconcile: () => set(reconcileRightToolPreferences(get())),
      }
    },
    {
      name: RIGHT_TOOL_STORAGE_KEY,
      version: RIGHT_TOOL_PERSIST_VERSION,
      storage: createSafeRightToolStorage(() => localStorage),
      partialize: selectPersistedRightToolPreferences,
      migrate: () => createDefaultRightToolPreferences(),
      // Force rail-only on launch regardless of legacy persisted open sets.
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...reconcileRightToolPreferences(persistedState),
        openToolIds: [],
        activeToolId: null,
      }),
    },
  ),
)

function applyPanelCollapseCommand(command: PanelCollapseCommand): void {
  const appStore = useAppStore.getState()

  if (command === 'expand' && appStore.panelCollapsed) appStore.setPanelCollapsed(false)
  if (command === 'collapse' && !appStore.panelCollapsed) appStore.setPanelCollapsed(true)
  if (command === 'toggle') appStore.togglePanel()
}

extensionRegistry.subscribe(() => useRightToolStore.getState().reconcile())
