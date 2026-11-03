import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore } from '../../src/renderer/src/stores/session'
import type { AgentSessionSummary } from '../../src/shared/ipc/session'

vi.mock('../../src/renderer/src/stores/workspace', () => ({
  useWorkspaceStore: { getState: () => ({ activeWorkspaceId: 'workspace' }) },
}))

const filter = { cwd: 'C:/workspace' }
const cached = { silent: true, maxAgeMs: 5000 }
const row: AgentSessionSummary = {
  id: 'session', workspaceId: 'workspace', engine: 'codex', cwd: filter.cwd,
  firstPrompt: 'A prompt', turnCount: 1, checkpointCount: 0, status: 'done',
  createdAt: '2026-10-19T00:00:00Z', updatedAt: '2026-10-19T00:00:00Z', archived: false,
}

describe('session activation data reuse', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useSessionStore.getState().clearWorkspaceScope()
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  function installList() {
    // Electron structured cloning returns fresh objects, including for no-op reads.
    const list = vi.fn(async () => structuredClone([row, { ...row, id: 'other' }]))
    vi.stubGlobal('window', { electron: { session: { list } } })
    return list
  }

  it('reveals a failed switch without retaining actionable cards from another workspace', async () => {
    const list = installList()
    await useSessionStore.getState().fetchSessions(filter, cached)
    list.mockRejectedValueOnce(new Error('unavailable'))
    await useSessionStore.getState().fetchSessions({ cwd: 'C:/other' }, cached)
    expect(useSessionStore.getState()).toMatchObject({ scopeKey: 'cwd:C:/other', loading: false, error: 'unavailable', sessions: [] })
  })

  it('reuses recent reads, expires them and forces event refreshes without loading flicker', async () => {
    const list = installList()
    const fetch = useSessionStore.getState().fetchSessions
    await fetch(filter, cached)
    const sessions = useSessionStore.getState().sessions
    for (let cycle = 0; cycle < 8; cycle++) await fetch(filter, cached)
    expect(list).toHaveBeenCalledTimes(1)
    await fetch(filter, { silent: true })
    expect(list).toHaveBeenCalledTimes(2)
    expect(useSessionStore.getState().sessions).toBe(sessions)
    await vi.advanceTimersByTimeAsync(5000)
    await fetch(filter, cached)
    expect(list).toHaveBeenCalledTimes(3)
    expect(useSessionStore.getState().loading).toBe(false)
  })

  it('retains unchanged cards, accepts changed fields and respects additions, removal and order', async () => {
    const list = installList()
    const fetch = useSessionStore.getState().fetchSessions
    await fetch(filter)
    const previous = useSessionStore.getState().sessions
    list.mockResolvedValueOnce([{ ...previous[1], turnCount: 2 }, { ...previous[0] }])
    await fetch(filter, { silent: true })
    const next = useSessionStore.getState().sessions
    expect(next[0]).toMatchObject({ id: 'other', turnCount: 2 })
    expect(next[0]).not.toBe(previous[1])
    expect(next[1]).toBe(previous[0])
    list.mockResolvedValueOnce([{ ...row, id: 'new' }, { ...previous[0] }])
    await fetch(filter, { silent: true })
    expect(useSessionStore.getState().sessions.map(({ id }) => id)).toEqual(['new', 'session'])
    expect(useSessionStore.getState().sessions[1]).toBe(previous[0])
  })

  it('reads changed filters and retries failed reads instead of reusing an invalid cache', async () => {
    const list = installList()
    const fetch = useSessionStore.getState().fetchSessions
    await fetch(filter, cached)
    await fetch({ ...filter, includeArchived: true }, cached)
    await fetch({ cwd: 'C:/other' }, cached)
    expect(list).toHaveBeenCalledTimes(3)
    list.mockRejectedValueOnce(new Error('temporary'))
    await fetch({ cwd: 'C:/other' }, { silent: true })
    await fetch({ cwd: 'C:/other' }, cached)
    expect(list).toHaveBeenCalledTimes(5)
    expect(useSessionStore.getState().error).toBeNull()
  })

  it('shares a slow expired activation read and keeps the existing cards visible', async () => {
    const list = installList()
    const fetch = useSessionStore.getState().fetchSessions
    await fetch(filter, cached)
    const previous = useSessionStore.getState().sessions
    await vi.advanceTimersByTimeAsync(5000)
    let finish!: (rows: AgentSessionSummary[]) => void
    list.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    const visits = Array.from({ length: 8 }, () => fetch(filter, cached))
    expect(list).toHaveBeenCalledTimes(2)
    expect(useSessionStore.getState().sessions).toBe(previous)
    expect(useSessionStore.getState().loading).toBe(false)
    finish(structuredClone(previous))
    await Promise.all(visits)
    expect(useSessionStore.getState().sessions).toBe(previous)
  })

  it('does not apply a late response after changing filters within the same directory', async () => {
    const list = installList()
    const fetch = useSessionStore.getState().fetchSessions
    let finish!: (rows: AgentSessionSummary[]) => void
    list.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    const oldRead = fetch(filter, cached)
    list.mockResolvedValueOnce([{ ...row, archived: true }])
    await fetch({ ...filter, includeArchived: true }, cached)
    finish([row])
    await oldRead
    expect(useSessionStore.getState().sessions[0].archived).toBe(true)
    expect(useSessionStore.getState().lastFilter).toEqual({ ...filter, includeArchived: true })
  })
})
