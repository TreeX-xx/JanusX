import { create } from 'zustand'
import type { PluginHostSnapshot } from '../../../shared/ipc/plugins'

export const usePluginSnapshot = create<PluginHostSnapshot>(() => ({
  developmentMode: false, plugins: [], logs: [],
}))
