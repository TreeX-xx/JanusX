import { create } from 'zustand'
import {
  INITIAL_ISLAND_CONTROLLER_STATE,
  reduceIslandController,
  type IslandControllerAction,
  type IslandControllerState,
} from '../components/janus/islandController'

interface IslandStore {
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
  pluginViewRequest: null,
  activePluginViewId: null,
  openPluginView: viewId => set(current => ({
    ...(current.stage === 'expanded' ? {} : reduceIslandController({ stage: current.stage, knowledge: current.knowledge }, { type: 'double-activate' })),
    pluginViewRequest: { viewId, sequence: (current.pluginViewRequest?.sequence ?? 0) + 1 },
  })),
  dispatch: (action) => set((current) => reduceIslandController(
    { stage: current.stage, knowledge: current.knowledge },
    action,
  )),
}))
