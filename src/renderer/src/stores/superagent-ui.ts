// Note: .agents/notes/agent/superagent-interface.md — presentation never owns execution.
import { create } from 'zustand'
import type { SuperAgentReport } from '../../../shared/superagent'

const preferenceKey = 'janus:superagent-view'
interface Preferences { started: boolean; workersCollapsed: boolean; workersWidth: number }
function readPreferences(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem(preferenceKey) ?? '{}')
    return { started: value.started === true, workersCollapsed: value.workersCollapsed === true,
      workersWidth: Number.isFinite(value.workersWidth) ? Math.max(280, Math.min(440, value.workersWidth)) : 320 }
  } catch { return { started: false, workersCollapsed: false, workersWidth: 320 } }
}
function savePreferences(value: Preferences) {
  try { localStorage.setItem(preferenceKey, JSON.stringify({ started: value.started,
    workersCollapsed: value.workersCollapsed, workersWidth: value.workersWidth })) } catch { /* Session preference remains usable. */ }
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
  setWorkersCollapsed(value: boolean): void
  setWorkersWidth(value: number): void
  addNotice(notice: SuperAgentNotice): void
}

export const useSuperAgentUIStore = create<SuperAgentUI>((set, get) => ({
  ...readPreferences(), terminalLauncher: false, focusedWorkId: null, notices: [],
  start: () => { set({ started: true }); savePreferences(get()) },
  setWorkersCollapsed: workersCollapsed => { set({ workersCollapsed }); savePreferences(get()) },
  setWorkersWidth: value => {
    if (!Number.isFinite(value)) return
    set({ workersWidth: Math.max(280, Math.min(440, value)) }); savePreferences(get())
  },
  addNotice: notice => set(state => state.notices.some(row => row.id === notice.id) ? {} : {
    notices: [...state.notices, notice].slice(-100),
  }),
}))
