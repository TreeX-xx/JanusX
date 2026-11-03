import { create } from 'zustand'
import type { GitStatus, GitCommit } from '@/types'
import type { GitCommitChange } from '../../../shared/ipc/git'

interface GitStore {
  status: GitStatus | null
  statusCwd: string | null
  statusLoading: boolean
  commits: GitCommit[]
  logCwd: string | null
  logLoading: boolean
  logError: string | null
  loading: boolean
  error: string | null

  fetchStatus: (cwd: string) => Promise<void>
  fetchLog: (cwd: string, maxCount?: number) => Promise<void>
  stageFiles: (cwd: string, paths: string[]) => Promise<void>
  unstageFiles: (cwd: string, paths: string[]) => Promise<void>
  commitChanges: (cwd: string, message: string) => Promise<boolean>
  pushChanges: (cwd: string) => Promise<boolean>
  pullChanges: (cwd: string) => Promise<boolean>
  discardChange: (cwd: string, path: string) => Promise<boolean>
  commitChangesByHash: (cwd: string, hash: string) => Promise<GitCommitChange[]>
}

interface PendingStatusRefresh {
  promise: Promise<void>
  rerun: boolean
}

const pendingStatusRefreshes = new Map<string, PendingStatusRefresh>()
let logGeneration = 0

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

export const useGitStore = create<GitStore>((set) => ({
  status: null,
  statusCwd: null,
  statusLoading: false,
  commits: [],
  logCwd: null,
  logLoading: false,
  logError: null,
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

  fetchLog: async (cwd, maxCount) => {
    // Note: .agents/notes/workbench/file-tree-reveal-race.md — history must
    // settle for the current scope before the shared glass clears.
    const generation = ++logGeneration
    const logCwd = normalizeGitCwd(cwd)
    set((state) => ({ logCwd, logLoading: true, logError: null, commits: state.logCwd === logCwd ? state.commits : [] }))
    try {
      const commits = await window.electron.git.log(cwd, maxCount)
      if (generation === logGeneration) set({ commits, logLoading: false })
    } catch (err: any) {
      if (generation === logGeneration) set({ logError: toErrorMessage(err), logLoading: false })
    }
  },

  stageFiles: async (cwd, paths) => {
    set({ loading: true, error: null, statusCwd: normalizeGitCwd(cwd) })
    try {
      const status = await window.electron.git.stage(cwd, paths)
      const statusCwd = supersedePendingRefresh(cwd)
      set((state) => state.statusCwd === statusCwd ? { status, loading: false } : { loading: false })
    } catch (err: any) {
      set({ error: toErrorMessage(err), loading: false })
    }
  },

  unstageFiles: async (cwd, paths) => {
    set({ loading: true, error: null, statusCwd: normalizeGitCwd(cwd) })
    try {
      const status = await window.electron.git.unstage(cwd, paths)
      const statusCwd = supersedePendingRefresh(cwd)
      set((state) => state.statusCwd === statusCwd ? { status, loading: false } : { loading: false })
    } catch (err: any) {
      set({ error: toErrorMessage(err), loading: false })
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
      set({ error: toErrorMessage(err), loading: false })
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
      set({ error: toErrorMessage(err), loading: false })
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
      set({ error: toErrorMessage(err), loading: false })
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
      set({ error: toErrorMessage(err), loading: false })
      return false
    }
  },

  commitChangesByHash: async (cwd, hash) => {
    try { return await window.electron.git.commitChanges(cwd, hash) } catch (err: any) { set({ error: toErrorMessage(err) }); return [] }
  },
}))
