import { create } from 'zustand'
import type { AppLoadState } from '@/types'
import { useExperimentalStore } from './experimental'

export type ActiveWorkbench = 'blueprint' | 'knowledge' | `extension:${string}/${string}` | null

/** 副黑板默认/最小高度（px）：下拉落板落点与下缘拖高的下限。 */
export const BLACKBOARD_DEFAULT_HEIGHT = 420
export const BLACKBOARD_MIN_HEIGHT = 220

const BLACKBOARD_HEIGHT_KEY = 'janus:blackboard-height'

export function loadBlackboardHeight(): number {
  try {
    const raw = Number(window.localStorage.getItem(BLACKBOARD_HEIGHT_KEY))
    if (Number.isFinite(raw) && raw >= BLACKBOARD_MIN_HEIGHT) return raw
  } catch { /* persistence is best-effort */ }
  return BLACKBOARD_DEFAULT_HEIGHT
}

export function saveBlackboardHeight(height: number): void {
  try { window.localStorage.setItem(BLACKBOARD_HEIGHT_KEY, String(Math.round(height))) } catch { /* best-effort */ }
}

interface AppStore {
  loadState: AppLoadState
  sidebarCollapsed: boolean
  panelCollapsed: boolean
  activeWorkbench: ActiveWorkbench
  returnWorkbench: 'blueprint' | 'knowledge' | null
  /** 岛下拉副黑板：settled 高度（0=收起）。中央工作区按此高度下滑让位。 */
  blackboardHeight: number
  /** 拖拽过程中的实时预览高度（null=非拖拽中，用 settled 值）。 */
  blackboardDrag: number | null
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
  setBlackboardHeight: (height: number) => void
  setBlackboardDrag: (height: number | null) => void
  toggleBlackboard: () => void
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
  blackboardHeight: 0,
  blackboardDrag: null,
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
  setBlackboardHeight: (blackboardHeight) => set({ blackboardHeight: Math.max(0, blackboardHeight) }),
  setBlackboardDrag: (blackboardDrag) => set({ blackboardDrag }),
  toggleBlackboard: () => set((s) => ({
    blackboardHeight: s.blackboardHeight > 0 ? 0 : loadBlackboardHeight(),
    blackboardDrag: null,
  })),
  setJanusRunning: (janusRunning) => set({ janusRunning }),
  setRunningProjects: (runningProjects) => set({ runningProjects }),
}))
