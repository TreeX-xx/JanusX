import { create } from 'zustand'
import type { GitStatus } from '@/types'
import type { GitHistoryCommit, GitHistoryCursor, GitHistoryScope, GitHistoryPage } from '../../../shared/ipc/git'

interface GitStore {
  status: GitStatus | null
  statusCwd: string | null
  statusLoading: boolean
  commits: GitHistoryCommit[]
  logCwd: string | null
  logLoading: boolean
  logError: string | null
  logScope: GitHistoryScope
  logCursor: GitHistoryCursor | null
  logLoadingMore: boolean
  loading: boolean
  error: string | null

  fetchStatus: (cwd: string) => Promise<void>
  fetchLog: (cwd: string, scope?: GitHistoryScope) => Promise<void>
  loadMoreLog: (cwd: string) => Promise<void>
  stageFiles: (cwd: string, paths: string[]) => Promise<void>
  unstageFiles: (cwd: string, paths: string[]) => Promise<void>
  commitChanges: (cwd: string, message: string) => Promise<boolean>
  pushChanges: (cwd: string) => Promise<boolean>
  pullChanges: (cwd: string) => Promise<boolean>
  discardChange: (cwd: string, path: string) => Promise<boolean>
}

interface PendingStatusRefresh {
  promise: Promise<void>
  rerun: boolean
}

const pendingStatusRefreshes = new Map<string, PendingStatusRefresh>()
let logGeneration = 0
const historyCache = new Map<string, GitHistoryPage>()
function cacheHistory(key: string, page: GitHistoryPage) {
  historyCache.delete(key)
  historyCache.set(key, page)
  if (historyCache.size > 8) historyCache.delete(historyCache.keys().next().value!)
}

export function normalizeGitCwd(cwd: string): string {
  const normalized = cwd.replace(/\\/g, '/').replace(/\/+$/, '')
  return /^[A-Za-z]:/.test(normalized) ? normalized.toLowerCase() : normalized
}

function supersedePendingRefresh(cwd: string): string {
  const statusCwd = normalizeGitCwd(cwd)
  const pending = pendingStatusRefreshes.get(statusCwd)
  if (pending) pending.rerun = true
  return statusCwd
}

const IPC_INVOKE_PREFIX = /^Error invoking remote method 'git:[^']*':\s*/

/** 去掉 Electron invoke 的 "Error invoking remote method 'git:*':" 包装，只保留 git 自身的错误文本。 */
function toErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.replace(IPC_INVOKE_PREFIX, '').replace(/^Error:\s*/, '')
}

export const useGitStore = create<GitStore>((set, get) => ({
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

  fetchStatus: async (cwd) => {
    const statusCwd = normalizeGitCwd(cwd)
    set((state) => ({
      status: state.statusCwd === statusCwd ? state.status : null,
      statusCwd,
      statusLoading: true,
      error: null,
    }))

    const pending = pendingStatusRefreshes.get(statusCwd)
    if (pending) {
      pending.rerun = true
      return pending.promise
    }

    const refresh: PendingStatusRefresh = { promise: Promise.resolve(), rerun: false }
    refresh.promise = (async () => {
      do {
        refresh.rerun = false
        try {
          const status = await window.electron.git.status(cwd)
          if (refresh.rerun) continue
          set((state) => state.statusCwd === statusCwd ? { status, statusLoading: false, error: null } : {})
        } catch (err: any) {
          if (refresh.rerun) continue
          set((state) => state.statusCwd === statusCwd ? { error: toErrorMessage(err), statusLoading: false } : {})
        }
      } while (refresh.rerun)
    })().finally(() => {
      if (pendingStatusRefreshes.get(statusCwd) === refresh) {
        pendingStatusRefreshes.delete(statusCwd)
      }
    })
    pendingStatusRefreshes.set(statusCwd, refresh)
    return refresh.promise
  },

  fetchLog: async (cwd, scope = 'all') => {
    // Note: .agents/notes/workbench/file-tree-reveal-race.md — history must
    // settle for the current scope before the shared glass clears.
    const generation = ++logGeneration
    const logCwd = normalizeGitCwd(cwd)
    const key = `${logCwd}:${scope}`
    const cached = historyCache.get(key)
    set((state) => ({ logCwd, logScope: scope, logCursor: null, logLoadingMore: false, logLoading: true, logError: null,
      commits: cached?.commits ?? (state.logCwd === logCwd && state.logScope === scope ? state.commits : []) }))
    try {
      const page = await window.electron.git.history(cwd, { scope, limit: 60 })
      if (generation === logGeneration) {
        const current = cached && cached.snapshot === page.snapshot && cached.commits.length > page.commits.length ? cached : page
        cacheHistory(key, current)
        set({ commits: current.commits, logCursor: current.cursor, logLoading: false })
      }
    } catch (err: any) {
      if (generation === logGeneration) set({ logError: toErrorMessage(err), logLoading: false })
    }
  },

  loadMoreLog: async (cwd) => {
    const state = get()
    if (state.logCwd !== normalizeGitCwd(cwd) || state.logLoading || state.logLoadingMore || !state.logCursor) return
    const generation = logGeneration
    set({ logLoadingMore: true, logError: null })
    try {
      const page = await window.electron.git.history(cwd, { scope: state.logScope, limit: 60, cursor: state.logCursor })
      if (generation === logGeneration) {
        const commits = [...get().commits, ...page.commits]
        cacheHistory(`${state.logCwd}:${state.logScope}`, { ...page, commits })
        set({ commits, logCursor: page.cursor, logLoadingMore: false })
      }
    } catch (err) {
      if (generation === logGeneration) set({ logError: toErrorMessage(err), logLoadingMore: false })
    }
  },

  stageFiles: async (cwd, paths) => {
    set({ loading: true, error: null, statusCwd: normalizeGitCwd(cwd) })
    try {
      const status = await window.electron.git.stage(cwd, paths)
      const statusCwd = supersedePendingRefresh(cwd)
      set((state) => state.statusCwd === statusCwd ? { status, loading: false } : { loading: false })
    } catch (err: any) {
      set(state => state.statusCwd === normalizeGitCwd(cwd) ? { error: toErrorMessage(err), loading: false } : { loading: false })
    }
  },

  unstageFiles: async (cwd, paths) => {
    set({ loading: true, error: null, statusCwd: normalizeGitCwd(cwd) })
    try {
      const status = await window.electron.git.unstage(cwd, paths)
      const statusCwd = supersedePendingRefresh(cwd)
      set((state) => state.statusCwd === statusCwd ? { status, loading: false } : { loading: false })
    } catch (err: any) {
      set(state => state.statusCwd === normalizeGitCwd(cwd) ? { error: toErrorMessage(err), loading: false } : { loading: false })
    }
  },

  commitChanges: async (cwd, message) => {
    set({ loading: true, error: null, statusCwd: normalizeGitCwd(cwd) })
    try {
      const status = await window.electron.git.commit(cwd, message)
      const statusCwd = supersedePendingRefresh(cwd)
      set((state) => state.statusCwd === statusCwd ? { status, loading: false } : { loading: false })
      return true
    } catch (err: any) {
      set(state => state.statusCwd === normalizeGitCwd(cwd) ? { error: toErrorMessage(err), loading: false } : { loading: false })
      return false
    }
  },

  pushChanges: async (cwd) => {
    set({ loading: true, error: null, statusCwd: normalizeGitCwd(cwd) })
    try {
      await window.electron.git.push(cwd)
      const status = await window.electron.git.status(cwd)
      const statusCwd = supersedePendingRefresh(cwd)
      set((state) => state.statusCwd === statusCwd ? { status, loading: false } : { loading: false })
      return true
    } catch (err: any) {
      set(state => state.statusCwd === normalizeGitCwd(cwd) ? { error: toErrorMessage(err), loading: false } : { loading: false })
      return false
    }
  },

  pullChanges: async (cwd) => {
    set({ loading: true, error: null, statusCwd: normalizeGitCwd(cwd) })
    try {
      await window.electron.git.pull(cwd)
      const status = await window.electron.git.status(cwd)
      const statusCwd = supersedePendingRefresh(cwd)
      set((state) => state.statusCwd === statusCwd ? { status, loading: false } : { loading: false })
      return true
    } catch (err: any) {
      set(state => state.statusCwd === normalizeGitCwd(cwd) ? { error: toErrorMessage(err), loading: false } : { loading: false })
      return false
    }
  },

  discardChange: async (cwd, path) => {
    set({ loading: true, error: null, statusCwd: normalizeGitCwd(cwd) })
    try {
      const status = await window.electron.git.discard(cwd, path)
      const statusCwd = supersedePendingRefresh(cwd)
      set((state) => state.statusCwd === statusCwd ? { status, loading: false } : { loading: false })
      return true
    } catch (err: any) {
      set(state => state.statusCwd === normalizeGitCwd(cwd) ? { error: toErrorMessage(err), loading: false } : { loading: false })
      return false
    }
  },

}))
