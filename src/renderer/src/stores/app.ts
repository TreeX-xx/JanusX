import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { AppLoadState } from '@/types'
import { useExperimentalStore } from './experimental'

export type ActiveWorkbench = 'blueprint' | 'knowledge' | `extension:${string}/${string}` | null

// Note: .agents/notes/terminal/terminal-sidebar-states.md
interface SidebarPreferences {
  sidebarCollapsed: boolean
  expandedWorkspaceIds: string[]
  collapsedGroupIds: string[]
}

const sidebarStorage = createJSONStorage<SidebarPreferences>(() => ({
  getItem: name => { try { return localStorage.getItem(name) } catch { return null } },
  setItem: (name, value) => { try { localStorage.setItem(name, value) } catch { /* Preferences must not block navigation. */ } },
  removeItem: name => { try { localStorage.removeItem(name) } catch { /* Storage may be unavailable. */ } },
}))
const preferenceIds = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0))]
  : []

interface AppStore extends SidebarPreferences {
  loadState: AppLoadState
  panelCollapsed: boolean
  activeWorkbench: ActiveWorkbench
  returnWorkbench: 'blueprint' | 'knowledge' | null
  /** Janus 运行态 */
  janusRunning: boolean
  /** 运行中的项目列表 */
  runningProjects: any[]
  setLoadState: (state: AppLoadState) => void
  toggleSidebar: () => void
  setExpandedWorkspaceIds: (update: (ids: string[]) => string[]) => void
  setCollapsedGroupIds: (update: (ids: string[]) => string[]) => void
  pruneSidebarPreferences: (workspaces: { id: string; sidebarGroup?: { id: string } }[]) => void
  togglePanel: () => void
  setPanelCollapsed: (collapsed: boolean) => void
  setActiveWorkbench: (workbench: ActiveWorkbench) => void
  toggleWorkbench: (workbench: Exclude<ActiveWorkbench, null>) => void
  openPluginWorkbench: (workbench: `extension:${string}/${string}`) => void
  closePluginWorkbench: () => void
  setJanusRunning: (running: boolean) => void
  setRunningProjects: (projects: any[]) => void
}

export const useAppStore = create<AppStore>()(persist((set) => ({
  loadState: 'no-workspace',
  sidebarCollapsed: false,
  expandedWorkspaceIds: [],
  collapsedGroupIds: [],
  // Start with the tool rail visible and the content panel folded. A tool
  // opened from the rail expands it through the right-tool transition.
  panelCollapsed: true,
  activeWorkbench: null,
  returnWorkbench: null,
  janusRunning: false,
  runningProjects: [],
  setLoadState: (loadState) => set({ loadState }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setExpandedWorkspaceIds: update => set(s => ({ expandedWorkspaceIds: update(s.expandedWorkspaceIds) })),
  setCollapsedGroupIds: update => set(s => ({ collapsedGroupIds: update(s.collapsedGroupIds) })),
  pruneSidebarPreferences: workspaces => set(s => {
    const ids = new Set(workspaces.map(workspace => workspace.id))
    const groups = new Set(workspaces.map(workspace => workspace.sidebarGroup?.id))
    return {
      expandedWorkspaceIds: s.expandedWorkspaceIds.filter(id => ids.has(id)),
      collapsedGroupIds: s.collapsedGroupIds.filter(id => groups.has(id)),
    }
  }),
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
}), {
  name: 'janusx-workspace-sidebar',
  storage: sidebarStorage,
  partialize: ({ sidebarCollapsed, expandedWorkspaceIds, collapsedGroupIds }) => ({ sidebarCollapsed, expandedWorkspaceIds, collapsedGroupIds }),
  merge: (persisted, current) => {
    const saved = persisted && typeof persisted === 'object' ? persisted as Partial<SidebarPreferences> : {}
    return { ...current,
      sidebarCollapsed: typeof saved.sidebarCollapsed === 'boolean' ? saved.sidebarCollapsed : false,
      expandedWorkspaceIds: preferenceIds(saved.expandedWorkspaceIds),
      collapsedGroupIds: preferenceIds(saved.collapsedGroupIds),
    }
  },
}))
