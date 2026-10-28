import { create } from 'zustand'
import {
  EXPERIMENTAL_ENABLED_ALL,
  normalizeExperimentalFeatures,
  type ExperimentalFeatures,
} from '../../../shared/ipc/experimental'
import { getExperimentalFeatures } from '@/services/experimental-features'

interface ExperimentalStore extends ExperimentalFeatures {
  /** Knowledge controls wait for the persisted feature gate. */
  loaded: boolean
  load: () => Promise<void>
  apply: (features: Partial<ExperimentalFeatures>) => void
}

let loadPromise: Promise<void> | null = null

export const useExperimentalStore = create<ExperimentalStore>()((set, get) => ({
  ...EXPERIMENTAL_ENABLED_ALL,
  knowledge: false,
  remoteControl: false,
  loaded: false,
  load: () => {
    if (get().loaded) return Promise.resolve()
    if (loadPromise) return loadPromise
    loadPromise = (async () => {
      try {
        const api = window.electron?.experimental
        if (!api) {
          set({ ...EXPERIMENTAL_ENABLED_ALL, loaded: true })
          return
        }
        set({ ...normalizeExperimentalFeatures(await getExperimentalFeatures()), loaded: true })
      } catch {
        set({ ...EXPERIMENTAL_ENABLED_ALL, knowledge: false, remoteControl: false, loaded: true })
      }
    })()
    return loadPromise
  },
  apply: (features) => set({ ...normalizeExperimentalFeatures({ ...get(), ...features }) }),
}))
