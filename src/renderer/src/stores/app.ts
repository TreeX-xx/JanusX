import { create } from 'zustand'
import type { AppLoadState } from '@/types'
import { useExperimentalStore } from './experimental'

export type ActiveWorkbench = 'blueprint' | 'knowledge' | `extension:${string}/${string}` | null

interface AppStore {
  loadState: AppLoadState
  sidebarCollapsed: boolean
  panelCollapsed: boolean
  activeWorkbench: ActiveWorkbench
  returnWorkbench: 'blueprint' | 'knowledge' | null
  /** Janus 运行态 */
  janusRunning: boolean
  /** 运行中的项目列表 */
  runningProjects: any[]
  setLoadState: (state: AppLoadState) => void
  toggleSidebar: () => void
  togglePanel: () => void
  setPanelCollapsed: (collapsed: boolean) => void
  setActiveWorkbench: (workbench: ActiveWorkbench) => void
  toggleWorkbench: (workbench: Exclude<ActiveWorkbench, null>) => void
  openPluginWorkbench: (workbench: `extension:${string}/${string}`) => void
  closePluginWorkbench: () => void
  setJanusRunning: (running: boolean) => void
  setRunningProjects: (projects: any[]) => void
}

export const useAppStore = create<AppStore>((set) => ({
  loadState: 'no-workspace',
  sidebarCollapsed: false,
  // Start with the tool rail visible and the content panel folded. A tool
  // opened from the rail expands it through the right-tool transition.
  panelCollapsed: true,
  activeWorkbench: null,
  returnWorkbench: null,
  janusRunning: false,
  runningProjects: [],
  setLoadState: (loadState) => set({ loadState }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  togglePanel: () => set((s) => ({ panelCollapsed: !s.panelCollapsed })),
  setPanelCollapsed: (panelCollapsed) => set({ panelCollapsed }),
  setActiveWorkbench: (activeWorkbench) => set({ activeWorkbench, returnWorkbench: null }),
  toggleWorkbench: (workbench) => set((s) => ({ activeWorkbench: s.activeWorkbench === workbench ? null : workbench, returnWorkbench: null })),
  openPluginWorkbench: (activeWorkbench) => set(s => ({ activeWorkbench,
    returnWorkbench: s.activeWorkbench?.startsWith('extension:') ? s.returnWorkbench : s.activeWorkbench === 'blueprint' || s.activeWorkbench === 'knowledge' ? s.activeWorkbench : null })),
  closePluginWorkbench: () => set(s => {
    if (!s.activeWorkbench?.startsWith('extension:')) return s
    const flags = useExperimentalStore.getState()
    const fallback = s.returnWorkbench
    return { activeWorkbench: (fallback === 'blueprint' && flags.blueprint) || (fallback === 'knowledge' && flags.persona) ? fallback : null, returnWorkbench: null }
  }),
  setJanusRunning: (janusRunning) => set({ janusRunning }),
  setRunningProjects: (runningProjects) => set({ runningProjects }),
}))
