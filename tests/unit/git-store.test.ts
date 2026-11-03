import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGitStore } from '../../src/renderer/src/stores/git'

const cleanStatus = {
  branch: { name: 'main', upstream: 'origin/main', ahead: 0, behind: 0 },
  changes: [],
  clean: true,
}

function createGitApiMock() {
  return {
    commit: vi.fn().mockResolvedValue(cleanStatus),
    push: vi.fn().mockResolvedValue(undefined),
    pull: vi.fn().mockResolvedValue(undefined),
    status: vi.fn().mockResolvedValue(cleanStatus),
  }
}

function invokeStoreAction(storeAction: 'commitChanges' | 'pushChanges' | 'pullChanges', cwd: string) {
  return storeAction === 'commitChanges'
    ? useGitStore.getState()[storeAction](cwd, 'message')
    : useGitStore.getState()[storeAction](cwd)
}

describe('Git store actions', () => {
  beforeEach(() => {
    useGitStore.setState({
      status: null,
      statusCwd: null,
      statusLoading: false,
      commits: [],
      logCwd: null,
      logLoading: false,
      logError: null,
      loading: false,
      error: null,
    })
  })

  it('coalesces overlapping refreshes and commits only the latest result', async () => {
    let resolveFirst!: (value: typeof cleanStatus) => void
    const first = new Promise<typeof cleanStatus>((resolve) => { resolveFirst = resolve })
    const changedStatus = { ...cleanStatus, clean: false, changes: [{ path: 'a.ts', status: 'M' as const, staged: false, additions: 1, deletions: 0 }] }
    const status = vi.fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(changedStatus)
    vi.stubGlobal('window', { electron: { git: { status } } })

    const initialRefresh = useGitStore.getState().fetchStatus('C:\\workspace')
    const followupRefresh = useGitStore.getState().fetchStatus('C:\\workspace')
    resolveFirst(cleanStatus)
    await Promise.all([initialRefresh, followupRefresh])

    expect(status).toHaveBeenCalledTimes(2)
    expect(useGitStore.getState().status).toEqual(changedStatus)
  })

  it('preserves the last successful status when a refresh fails', async () => {
    const status = vi.fn().mockResolvedValueOnce(cleanStatus).mockRejectedValueOnce(new Error('temporary failure'))
    vi.stubGlobal('window', { electron: { git: { status } } })

    await useGitStore.getState().fetchStatus('C:\\workspace')
    await useGitStore.getState().fetchStatus('C:\\workspace')

    expect(useGitStore.getState()).toMatchObject({ status: cleanStatus, error: 'temporary failure' })
  })

  it('strips the Electron invoke wrapper before recording a git error', async () => {
    const status = vi.fn().mockRejectedValue(
      new Error("Error invoking remote method 'git:status': Error: git push failed"),
    )
    vi.stubGlobal('window', { electron: { git: { status } } })

    await useGitStore.getState().fetchStatus('C:\\workspace')

    expect(useGitStore.getState().error).toBe('git push failed')
  })

  it('does not let a previous workspace overwrite the active workspace', async () => {
    let resolvePrevious!: (value: typeof cleanStatus) => void
    const previous = new Promise<typeof cleanStatus>((resolve) => { resolvePrevious = resolve })
    const activeStatus = { ...cleanStatus, branch: { ...cleanStatus.branch, name: 'active' } }
    const status = vi.fn().mockReturnValueOnce(previous).mockResolvedValueOnce(activeStatus)
    vi.stubGlobal('window', { electron: { git: { status } } })

    const previousRefresh = useGitStore.getState().fetchStatus('C:\\previous')
    await useGitStore.getState().fetchStatus('C:\\active')
    resolvePrevious(cleanStatus)
    await previousRefresh

    expect(useGitStore.getState()).toMatchObject({ status: activeStatus, statusCwd: 'c:/active' })
  })

  it('keeps history readiness tied to the latest request even after returning to the same workspace', async () => {
    let release!: (commits: []) => void
    const first = new Promise<[]>(resolve => { release = resolve })
    const commits = [{ hash: 'new', shortHash: 'new', message: 'Current history', author: 'test', date: '' }]
    const log = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce([]).mockResolvedValueOnce(commits)
    vi.stubGlobal('window', { electron: { git: { log } } })
    const previous = useGitStore.getState().fetchLog('C:/first')
    expect(useGitStore.getState().logLoading).toBe(true)
    await useGitStore.getState().fetchLog('C:/second')
    await useGitStore.getState().fetchLog('C:/first')
    release([])
    await previous
    expect(useGitStore.getState()).toMatchObject({ logCwd: 'c:/first', logLoading: false, commits })
  })

  it('settles both readiness flags on errors so the current error can be revealed', async () => {
    vi.stubGlobal('window', { electron: { git: {
      status: vi.fn().mockRejectedValue(new Error('status unavailable')),
      log: vi.fn().mockRejectedValue(new Error('history unavailable')),
    } } })
    await Promise.all([useGitStore.getState().fetchStatus('C:/failed'), useGitStore.getState().fetchLog('C:/failed')])
    expect(useGitStore.getState()).toMatchObject({ statusLoading: false, logLoading: false })
    expect(useGitStore.getState().error).toBeTruthy()
  })

  it('does not erase a history failure when status finishes afterwards', async () => {
    let release!: (value: typeof cleanStatus) => void
    vi.stubGlobal('window', { electron: { git: {
      status: () => new Promise(resolve => { release = resolve }),
      log: vi.fn().mockRejectedValue(new Error('history unavailable')),
    } } })
    const status = useGitStore.getState().fetchStatus('C:/current')
    await useGitStore.getState().fetchLog('C:/current')
    release(cleanStatus)
    await status
    expect(useGitStore.getState()).toMatchObject({ statusLoading: false, logLoading: false, logError: 'history unavailable' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    ['commitChanges', 'commit'],
    ['pushChanges', 'push'],
    ['pullChanges', 'pull'],
  ] as const)('returns true and refreshes status after %s succeeds', async (storeAction, apiAction) => {
    const api = createGitApiMock()
    vi.stubGlobal('window', { electron: { git: api } })

    const succeeded = await invokeStoreAction(storeAction, 'C:\\workspace')

    expect(succeeded).toBe(true)
    expect(api[apiAction]).toHaveBeenCalled()
    expect(useGitStore.getState()).toMatchObject({
      status: cleanStatus,
      loading: false,
      error: null,
    })
    if (storeAction !== 'commitChanges') expect(api.status).toHaveBeenCalledWith('C:\\workspace')
  })

  it.each([
    ['commitChanges', 'commit'],
    ['pushChanges', 'push'],
    ['pullChanges', 'pull'],
  ] as const)('returns false and preserves the error after %s fails', async (storeAction, apiAction) => {
    const api = createGitApiMock()
    api[apiAction].mockRejectedValue(new Error(`${apiAction} failed`))
    vi.stubGlobal('window', { electron: { git: api } })

    const succeeded = await invokeStoreAction(storeAction, 'C:\\workspace')

    expect(succeeded).toBe(false)
    expect(useGitStore.getState()).toMatchObject({
      loading: false,
      error: `${apiAction} failed`,
    })
  })
})
