import { create } from 'zustand'
import { shallow } from 'zustand/shallow'
import { useWorkspaceStore } from './workspace'
import type {
  AgentSessionDetail,
  AgentSessionSummary,
  SessionContinueMode,
  SessionFilter,
} from '../../../shared/ipc/session'

export type { AgentSessionDetail, AgentSessionSummary }

interface SessionStore {
  scopeKey: string | null
  lastFilter: SessionFilter | null
  sessions: AgentSessionSummary[]
  selectedSession: AgentSessionDetail | null
  loading: boolean
  error: string | null
  lastFetchedAt: number | null

  fetchSessions: (filter?: SessionFilter, opts?: { silent?: boolean; maxAgeMs?: number }) => Promise<void>
  fetchSessionDetail: (sessionId: string) => Promise<void>
  continueSession: (
    sessionId: string,
    engine?: string,
    mode?: SessionContinueMode,
  ) => Promise<{ sessionId: string; terminalId: string } | null>
  clearWorkspaceScope: () => void
  setSelected: (session: AgentSessionDetail | null) => void
  subscribeToEvents: () => () => void
}

function activeWorkspaceId(): string | null {
  return useWorkspaceStore.getState().activeWorkspaceId
}

function scopeKeyFor(filter?: SessionFilter): string {
  if (filter?.workspaceId) return `ws:${filter.workspaceId}`
  if (filter?.cwd) return `cwd:${filter.cwd}`
  if (filter?.includeArchived) return 'archived'
  return 'all'
}

/** IPC clones every summary. Keep unchanged rows stable for memoized cards. */
function reconcileSessions(previous: AgentSessionSummary[], incoming: AgentSessionSummary[]): AgentSessionSummary[] {
  const byId = new Map(previous.map((session) => [session.id, session]))
  const sessions = incoming.map((session) => {
    const existing = byId.get(session.id)
    return existing && shallow(existing, session) ? existing : session
  })
  return shallow(previous, sessions) ? previous : sessions
}

const pendingLists = new Map<string, Promise<AgentSessionSummary[]>>()

function readSessionList(filter: SessionFilter | undefined, reusePending: boolean): Promise<AgentSessionSummary[]> {
  const key = JSON.stringify([filter?.workspaceId, filter?.cwd, filter?.engine, filter?.includeArchived ?? false])
  const pending = pendingLists.get(key)
  if (reusePending && pending) return pending
  const request = window.electron.session.list(filter).finally(() => {
    if (pendingLists.get(key) === request) pendingLists.delete(key)
  })
  pendingLists.set(key, request)
  return request
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  scopeKey: null,
  lastFilter: null,
  sessions: [],
  selectedSession: null,
  loading: false,
  error: null,
  lastFetchedAt: null,

  fetchSessions: async (filter, opts) => {
    const key = scopeKeyFor(filter)
    const silent = opts?.silent === true
    const current = get()
    const sameScope = current.scopeKey === key && shallow(current.lastFilter ?? {}, filter ?? {})
    const isCurrentScope = () => get().scopeKey === key && shallow(get().lastFilter ?? {}, filter ?? {})
    // Activation can reuse a recent read; explicit/event refreshes always read.
    // See .agents/notes/sessions/records/session-open-stall.md
    if (opts?.maxAgeMs && sameScope && !current.error && current.lastFetchedAt !== null
      && Date.now() - current.lastFetchedAt < opts.maxAgeMs) return
    if (filter?.workspaceId === undefined && filter?.cwd === undefined && !activeWorkspaceId() && key !== 'all') {
      set({
        scopeKey: null,
        lastFilter: null,
        sessions: [],
        selectedSession: null,
        loading: false,
        error: null,
        lastFetchedAt: null,
      })
      return
    }

    // Stale-while-revalidate: background refreshes and scope switches keep
    // the visible cards in place. Clearing the list plus a loading banner
    // above it shifted every card per session:event, which read as flicker.
    // See .agents/notes/sessions/records/session-flicker-storm.md
    if (silent && sameScope) {
      try {
        const sessions = await readSessionList(filter, Boolean(opts?.maxAgeMs))
        if (!isCurrentScope()) return
        set((state) => ({ sessions: reconcileSessions(state.sessions, sessions), lastFetchedAt: Date.now(), error: null }))
      } catch (err) {
        if (isCurrentScope()) {
          set({ error: (err as Error).message })
        }
      }
      return
    }
    set({
      scopeKey: key,
      lastFilter: filter ?? null,
      loading: true,
      error: null,
      ...(!sameScope
        ? { selectedSession: null, lastFetchedAt: null }
        : {}),
    })
    try {
      const sessions = await readSessionList(filter, Boolean(opts?.maxAgeMs))
      if (!isCurrentScope()) return
      set((state) => ({ sessions: reconcileSessions(state.sessions, sessions), loading: false, lastFetchedAt: Date.now() }))
    } catch (err) {
      if (isCurrentScope()) {
        // A failed scope switch must reveal the error, never actionable cards
        // from the previous workspace. Background failures keep current data.
        set({ error: (err as Error).message, loading: false, ...(!sameScope ? { sessions: [] } : {}) })
      }
    }
  },

  fetchSessionDetail: async (sessionId) => {
    try {
      const detail = await window.electron.session.get(sessionId)
      if (detail) set({ selectedSession: detail })
    } catch (err) {
      set({ error: (err as Error).message })
    }
  },

  continueSession: async (sessionId, engine, mode) => {
    set({ error: null })
    try {
      // External rows carry no workspace; the new terminal must show in the
      // workspace the user is looking at, so pass the active one as fallback.
      const result = await window.electron.session.continue({
        sessionId,
        engine,
        mode,
        workspaceId: activeWorkspaceId() ?? undefined,
      })
      await get().fetchSessions(get().lastFilter ?? {}, { silent: true })
      return result
    } catch (err) {
      set({ error: (err as Error).message })
      return null
    }
  },

  clearWorkspaceScope: () =>
    set({
      scopeKey: null,
      lastFilter: null,
      sessions: [],
      selectedSession: null,
      loading: false,
      error: null,
      lastFetchedAt: null,
    }),

  setSelected: (session) => set({ selectedSession: session }),

  subscribeToEvents: () => {
    // Bulk hook/scan traffic emits session:event per mutation. Without
    // coalescing, each event refetched the whole card list with a loading
    // banner, which read as constant flicker. One trailing refresh per burst
    // keeps cards live without the strobe, mirroring the timeline tick.
    // See .agents/notes/sessions/records/session-flicker-storm.md
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = window.electron.session.onEvent(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        const filter = get().lastFilter
        if (!filter && !activeWorkspaceId()) {
          get().clearWorkspaceScope()
          return
        }
        void get().fetchSessions(filter ?? {}, { silent: true })
      }, 500)
    })
    return () => {
      if (timer) clearTimeout(timer)
      unsubscribe()
    }
  },
}))
