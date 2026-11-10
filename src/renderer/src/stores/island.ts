import { create } from 'zustand'
let chatSequence = 0
import {
  INITIAL_ISLAND_CONTROLLER_STATE,
  reduceIslandController,
  type IslandControllerAction,
  type IslandControllerState,
} from '../components/janus/islandController'

interface IslandStore {
  openSequence: number
  companionToolId: 'automations' | null
  releaseCompanion: () => void
  chatRequest: { prefill: string; sequence: number } | null
  openChat: (prefill?: string, companionToolId?: 'automations') => void
  consumeChat: (sequence: number) => void
  pluginViewRequest: { viewId: `extension:${string}/${string}`; sequence: number } | null
  activePluginViewId: `extension:${string}/${string}` | null
  openPluginView: (viewId: `extension:${string}/${string}`) => void
  stage: IslandControllerState['stage']
  knowledge: IslandControllerState['knowledge']
  dispatch: (action: IslandControllerAction) => void
}

/** The capsule/peek/expanded stage lives here instead of inside the Titlebar so
 *  surfaces outside it — the memo panel above all — can follow the island
 *  without prop drilling. The reducer stays the single source of transitions. */
export const useIslandStore = create<IslandStore>()((set) => ({
  ...INITIAL_ISLAND_CONTROLLER_STATE,
  openSequence: 0,
  companionToolId: null,
  releaseCompanion: () => set({ companionToolId: null }),
  chatRequest: null,
  openChat: (prefill = '', companionToolId) => set(current => ({
    openSequence: current.openSequence + 1,
    ...(current.stage === 'expanded' ? {} : reduceIslandController({ stage: current.stage, knowledge: current.knowledge }, { type: 'double-activate' })),
    chatRequest: { prefill, sequence: ++chatSequence },
    companionToolId: companionToolId ?? null,
  })),
  consumeChat: sequence => set(current => current.chatRequest?.sequence === sequence ? { chatRequest: null } : {}),
  pluginViewRequest: null,
  activePluginViewId: null,
  openPluginView: viewId => set(current => ({
    openSequence: current.openSequence + 1,
    companionToolId: null,
    ...(current.stage === 'expanded' ? {} : reduceIslandController({ stage: current.stage, knowledge: current.knowledge }, { type: 'double-activate' })),
    pluginViewRequest: { viewId, sequence: (current.pluginViewRequest?.sequence ?? 0) + 1 },
  })),
  dispatch: (action) => set((current) => {
    const next = reduceIslandController({ stage: current.stage, knowledge: current.knowledge }, action)
    return { ...next, ...(next.stage === 'expanded' && current.stage !== 'expanded' ? { openSequence: current.openSequence + 1 } : {}), ...(next.stage !== 'expanded' ? { companionToolId: null } : {}) }
  }),
}))
