// Note: .agents/notes/agent/superagent-interface.md — presentation never owns execution.
import { create } from 'zustand'
import type { SuperAgentReport } from '../../../shared/superagent'

const preferenceKey = 'janus:superagent-view'
interface Preferences { started: boolean; restoreTab: boolean; workersCollapsed: boolean; workersWidth: number; readWorkerReports: Record<string, string> }
function readPreferences(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem(preferenceKey) ?? '{}')
    // Older builds persisted the implicit SuperAgent default as if it were a user choice.
    const explicit = value.modeVersion === 1
    const started = explicit && value.started === true
    // An explicit legacy mode may have produced Worker reports without opening a tab.
    return { started: started || (explicit && value.agentMode === 'superagent'), restoreTab: started && value.restoreTab !== false, workersCollapsed: value.workersCollapsed === true,
      workersWidth: Number.isFinite(value.workersWidth) ? Math.max(280, Math.min(440, value.workersWidth)) : 340,
      readWorkerReports: Object.fromEntries(Object.entries(value.readWorkerReports ?? {}).filter(([, id]) => typeof id === 'string').slice(-200)) as Record<string, string> }
  } catch { return { started: false, restoreTab: false, workersCollapsed: false, workersWidth: 340, readWorkerReports: {} } }
}
function savePreferences(value: Preferences) {
  try { localStorage.setItem(preferenceKey, JSON.stringify({ modeVersion: 1, started: value.started, restoreTab: value.restoreTab,
    workersCollapsed: value.workersCollapsed, workersWidth: value.workersWidth, readWorkerReports: value.readWorkerReports })) } catch { /* Session preference remains usable. */ }
}

export interface SuperAgentNotice {
  id: string
  workspaceId: string
  workId: string
  conversationId: string
  title: string
  summary: string
  kind: SuperAgentReport['kind']
  createdAt: number
  silent?: boolean
}
interface SuperAgentUI extends Preferences {
  terminalLauncher: boolean
  focusedWorkId: string | null
  notices: SuperAgentNotice[]
  start(): void
  rememberTabClosed(): void
  setWorkersCollapsed(value: boolean): void
  setWorkersWidth(value: number): void
  markWorkerReportRead(workspaceId: string, workId: string, resourceId: string): void
  addNotice(notice: SuperAgentNotice): void
}

export const useSuperAgentUIStore = create<SuperAgentUI>((set, get) => ({
  ...readPreferences(), terminalLauncher: false, focusedWorkId: null, notices: [],
  start: () => { set({ started: true, restoreTab: true }); savePreferences(get()) },
  rememberTabClosed: () => { set({ restoreTab: false }); savePreferences(get()) },
  setWorkersCollapsed: workersCollapsed => { set({ workersCollapsed }); savePreferences(get()) },
  markWorkerReportRead: (workspaceId, workId, resourceId) => {
    const key = JSON.stringify([workspaceId, workId])
    set(state => ({ readWorkerReports: Object.fromEntries([...Object.entries(state.readWorkerReports).filter(([id]) => id !== key), [key, resourceId]].slice(-200)) }))
    savePreferences(get())
  },
  setWorkersWidth: value => {
    if (!Number.isFinite(value)) return
    set({ workersWidth: Math.max(280, Math.min(440, value)) }); savePreferences(get())
  },
  addNotice: notice => set(state => state.notices.some(row => row.id === notice.id) ? {} : {
    notices: [...state.notices, notice].slice(-100),
  }),
}))
