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
      logScope: 'all',
      logCursor: null,
      logLoadingMore: false,
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
    let release!: (page: { commits: []; cursor: null; snapshot: string }) => void
    const first = new Promise<{ commits: []; cursor: null; snapshot: string }>(resolve => { release = resolve })
    const commits = [{ hash: 'new', shortHash: 'new', message: 'Current history', author: 'test', date: '', parents: [], refs: [] }]
    const history = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce({ commits: [], cursor: null, snapshot: 'second' }).mockResolvedValueOnce({ commits, cursor: null, snapshot: 'first-new' })
    vi.stubGlobal('window', { electron: { git: { history } } })
    const previous = useGitStore.getState().fetchLog('C:/first')
    expect(useGitStore.getState().logLoading).toBe(true)
    await useGitStore.getState().fetchLog('C:/second')
    await useGitStore.getState().fetchLog('C:/first')
    release({ commits: [], cursor: null, snapshot: 'first-old' })
    await previous
    expect(useGitStore.getState()).toMatchObject({ logCwd: 'c:/first', logLoading: false, commits })
  })

  it('settles both readiness flags on errors so the current error can be revealed', async () => {
    vi.stubGlobal('window', { electron: { git: {
      status: vi.fn().mockRejectedValue(new Error('status unavailable')),
      history: vi.fn().mockRejectedValue(new Error('history unavailable')),
    } } })
    await Promise.all([useGitStore.getState().fetchStatus('C:/failed'), useGitStore.getState().fetchLog('C:/failed')])
    expect(useGitStore.getState()).toMatchObject({ statusLoading: false, logLoading: false })
    expect(useGitStore.getState().error).toBeTruthy()
  })

  it('does not erase a history failure when status finishes afterwards', async () => {
    let release!: (value: typeof cleanStatus) => void
    vi.stubGlobal('window', { electron: { git: {
      status: () => new Promise(resolve => { release = resolve }),
      history: vi.fn().mockRejectedValue(new Error('history unavailable')),
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

  it('deduplicates concurrent page loads and ignores a page that completes after a scope switch', async () => {
    const item = { hash: 'page-a', shortHash: 'a', message: 'page', author: '', date: '', parents: [], refs: [] }
    const first = { commits: [item], cursor: { offset: 1, snapshot: 'page-a' }, snapshot: 'page-a' }
    let release!: (value: unknown) => void
    const history = vi.fn().mockResolvedValueOnce(first).mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
      .mockResolvedValueOnce({ commits: [], cursor: null, snapshot: 'page-b' })
    vi.stubGlobal('window', { electron: { git: { history } } })
    await useGitStore.getState().fetchLog('C:/paging-a')
    const pending = useGitStore.getState().loadMoreLog('C:/paging-a')
    await useGitStore.getState().loadMoreLog('C:/paging-a')
    expect(history).toHaveBeenCalledTimes(2)
    await useGitStore.getState().fetchLog('C:/paging-b')
    release({ commits: [{ ...item, hash: 'late' }], cursor: null, snapshot: 'page-a' })
    await pending
    expect(useGitStore.getState()).toMatchObject({ logCwd: 'c:/paging-b', commits: [], logLoadingMore: false })
  })

  it('retains previous pages on a load failure and retries the same cursor', async () => {
    const commit = { hash: 'first', shortHash: 'a', message: '', author: '', date: '', parents: [], refs: [] }
    const cursor = { offset: 1, snapshot: 'retry' }
    const history = vi.fn().mockResolvedValueOnce({ commits: [commit], cursor, snapshot: 'retry' })
      .mockRejectedValueOnce(new Error('temporary page failure'))
      .mockResolvedValueOnce({ commits: [{ ...commit, hash: 'second' }], cursor: null, snapshot: 'retry' })
    vi.stubGlobal('window', { electron: { git: { history } } })
    await useGitStore.getState().fetchLog('C:/page-retry')
    await useGitStore.getState().loadMoreLog('C:/page-retry')
    expect(useGitStore.getState()).toMatchObject({ commits: [commit], logCursor: cursor, logLoadingMore: false, logError: 'temporary page failure' })
    await useGitStore.getState().loadMoreLog('C:/page-retry')
    expect(useGitStore.getState().commits.map(item => item.hash)).toEqual(['first', 'second'])
    expect(history.mock.calls[1][1].cursor).toEqual(history.mock.calls[2][1].cursor)
  })

  it('restores loaded pages only while the repository snapshot still matches', async () => {
    const commit = { hash: 'first', shortHash: 'a', message: '', author: '', date: '', parents: [], refs: [] }
    const first = { commits: [commit], cursor: { offset: 1, snapshot: 'unchanged' }, snapshot: 'unchanged' }
    const history = vi.fn().mockResolvedValueOnce(first)
      .mockResolvedValueOnce({ commits: [{ ...commit, hash: 'second' }], cursor: null, snapshot: 'unchanged' })
      .mockResolvedValueOnce({ commits: [], cursor: null, snapshot: 'elsewhere' })
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce({ commits: [{ ...commit, hash: 'new-head' }], cursor: null, snapshot: 'changed' })
    vi.stubGlobal('window', { electron: { git: { history } } })
    await useGitStore.getState().fetchLog('C:/page-cache')
    await useGitStore.getState().loadMoreLog('C:/page-cache')
    await useGitStore.getState().fetchLog('C:/page-elsewhere')
    await useGitStore.getState().fetchLog('C:/page-cache')
    expect(useGitStore.getState().commits.map(item => item.hash)).toEqual(['first', 'second'])
    await useGitStore.getState().fetchLog('C:/page-cache')
    expect(useGitStore.getState().commits.map(item => item.hash)).toEqual(['new-head'])
  })

  it('does not let a late all-branches response replace the current-branch filter', async () => {
    let release!: (value: unknown) => void
    const history = vi.fn().mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
      .mockResolvedValueOnce({ commits: [], cursor: null, snapshot: 'current' })
    vi.stubGlobal('window', { electron: { git: { history } } })
    const all = useGitStore.getState().fetchLog('C:/filter-race', 'all')
    await useGitStore.getState().fetchLog('C:/filter-race', 'current')
    release({ commits: [{ hash: 'wrong' }], cursor: null, snapshot: 'all' })
    await all
    expect(useGitStore.getState()).toMatchObject({ logScope: 'current', commits: [], logLoading: false })
  })

  it('does not publish a mutation failure into another workspace', async () => {
    let reject!: (error: Error) => void
    const commit = vi.fn().mockImplementation(() => new Promise((_resolve, fail) => { reject = fail }))
    vi.stubGlobal('window', { electron: { git: { commit, status: vi.fn().mockResolvedValue(cleanStatus) } } })
    const pending = useGitStore.getState().commitChanges('C:/previous-mutation', 'message')
    await useGitStore.getState().fetchStatus('C:/current-mutation')
    reject(new Error('old hook failure'))
    await pending
    expect(useGitStore.getState()).toMatchObject({ error: null, statusCwd: 'c:/current-mutation', loading: false })
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
