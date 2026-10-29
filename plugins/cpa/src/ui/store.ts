import { create } from 'zustand'
import { cpa, type RuntimeStatus } from './bridge'
import type { CpaSettings } from '../shared/cpa'

interface CpaStore {
  settings: CpaSettings | null
  status: RuntimeStatus | null
  load: () => Promise<void>
  save: (settings: CpaSettings, managementKey?: string) => Promise<void>
  refreshStatus: () => Promise<void>
  operate: (action: 'start' | 'stop' | 'restart' | 'update') => Promise<void>
}

export const useCpaStore = create<CpaStore>((set) => ({
  settings: null,
  status: null,
  load: async () => { set({ settings: await cpa.getSettings() }) },
  save: async (settings, managementKey) => {
    try { set({ settings: await cpa.saveSettings(settings, managementKey) }) }
    catch (error) {
      // The configuration may have persisted before a download or restart failed.
      set({ settings: await cpa.getSettings() })
      throw error
    }
  },
  refreshStatus: async () => { set({ status: await cpa.status() }) },
  operate: async (action) => {
    await cpa[action]()
    set({ status: await cpa.status() })
  },
}))
