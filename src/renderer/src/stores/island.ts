import { create } from 'zustand'
import { useSuperAgentUIStore } from './superagent-ui'
import { openSuperAgent } from '@/lib/superagent-navigation'
let chatSequence = 0
import {
  INITIAL_ISLAND_CONTROLLER_STATE,
  reduceIslandController,
  type IslandControllerAction,
  type IslandControllerState,
} from '../components/janus/islandController'

interface IslandStore {
  openSequence: number
  automationLocked: boolean
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
  automationLocked: false,
  companionToolId: null,
  releaseCompanion: () => set({ companionToolId: null }),
  chatRequest: null,
  openChat: (prefill = '', companionToolId) => {
    if (useSuperAgentUIStore.getState().started) {
      openSuperAgent()
      set(current => ({ chatRequest: { prefill, sequence: ++chatSequence }, companionToolId: companionToolId ?? current.companionToolId }))
      return
    }
    set(current => ({
    openSequence: current.openSequence + 1,
    ...(current.stage === 'expanded' ? {} : reduceIslandController({ stage: current.stage, knowledge: current.knowledge }, { type: 'double-activate' })),
    chatRequest: { prefill, sequence: ++chatSequence },
    companionToolId: companionToolId ?? current.companionToolId,
    }))
  },
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
    // The automation panel owns this lock until it closes or another tool takes over.
    const companion = current.companionToolId === 'automations'
    if (current.automationLocked && current.stage === 'expanded' && next.stage !== 'expanded' && !useSuperAgentUIStore.getState().started) return current
    return { ...next, ...(next.stage === 'expanded' && current.stage !== 'expanded' ? { openSequence: current.openSequence + 1 } : {}), ...(!companion && next.stage !== 'expanded' ? { companionToolId: null } : {}) }
  }),
}))
