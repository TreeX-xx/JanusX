import { useEffect, useState } from 'react'
import { useAppStore } from '@/stores/app'
import { invalidateEditorFileCache, useEditorStore } from '@/stores/editor'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWorktreeStore } from '@/stores/worktree'
import { useGitStore } from '@/stores/git'
import { warmupIndex } from '@/services/harness'
import { getActiveScopePath, getScopePathForWorkspace, loadWorkspaceFileTree, refreshScopeFileTree } from './actions'
import { collectShellRestore, restoreShells } from '@/lib/shell-restore'
import { createWorkspaceRefreshQueue } from './refresh-queue'

/**
 * Idle-time note-index warmup: fills the main-process index cache for every
 * known workspace checkout for shared Note consumers, including chat and MCP.
 * Sequential and best-effort; failures stay silent by design.
 */
function scheduleIndexWarmup(paths: string[]): () => void {
  const queue = [...new Set(paths.filter(Boolean))]
  let disposed = false
  const pump = (): void => {
    if (disposed) return
    const next = queue.shift()
    if (!next) return
    void warmupIndex(next).catch(() => {}).finally(() => {
      if (typeof requestIdleCallback === 'function') requestIdleCallback(() => pump(), { timeout: 5000 })
      else setTimeout(pump, 800)
    })
  }
  const kick = (): void => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => pump(), { timeout: 8000 })
    else setTimeout(pump, 2500)
  }
  kick()
  return () => { disposed = true }
}

export function useWorkspaceBootstrap(): boolean {
  const [workspaceReady, setWorkspaceReady] = useState(false)
  useEffect(() => {
    let activeScopePath: string | null = null
    const refreshActiveWorkspace = () => {
      const { activeWorkspaceId, workspaces } = useWorkspaceStore.getState()
      const workspace = workspaces.find((item) => item.id === activeWorkspaceId)
      const nextPath = workspace ? getScopePathForWorkspace(workspace.id, workspace.path) : null
      if (nextPath === activeScopePath) return
      activeScopePath = nextPath
      if (nextPath) void useGitStore.getState().fetchStatus(nextPath)
    }
    refreshActiveWorkspace()
    const unsubscribeWorkspace = useWorkspaceStore.subscribe(refreshActiveWorkspace)
    const unsubscribeWorktree = useWorktreeStore.subscribe(refreshActiveWorkspace)
    return () => {
      unsubscribeWorkspace()
      unsubscribeWorktree()
    }
  }, [])

  useEffect(() => {
    let disposed = false
    let stopWarmup: (() => void) | undefined
    void window.electron.workspace.initialize().then(async (state) => {
      if (disposed) return
      useWorkspaceStore.setState({ workspaces: state.workspaces, activeWorkspaceId: state.activeWorkspaceId })
      setWorkspaceReady(true)
      if (state.workspaces.length === 0) {
        useAppStore.setState({ loadState: 'no-workspace' })
        return
      }
      useAppStore.setState({ loadState: 'no-terminal' })
      const activeWorkspace = state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId)
      // Note: plugin activation owns projections — see .agents/notes/planning/blueprint-official-plugin.md
      stopWarmup = scheduleIndexWarmup(state.workspaces.map(workspace => workspace.path))
      if (activeWorkspace) await loadWorkspaceFileTree(activeWorkspace.path).catch(() => {})
      if (disposed) return
      // One-shot cold restore of pre-quit shells; agents never auto-run.
      void restoreShells().catch(() => undefined)
    }).catch(() => { if (!disposed) useAppStore.setState({ loadState: 'no-workspace' }) })
    return () => { disposed = true; stopWarmup?.() }
  }, [])

  useEffect(() => window.electron.system.onPrepareQuit(async () => {
    try {
      await window.electron.session.saveLayout(collectShellRestore())
    } catch {
      // Quit must never block on a failed snapshot.
    }
  }), [])

  // Note: 外部 `git worktree add/remove` 由主进程 watch + 轮询推送，左侧无需手动刷新
  useEffect(() => window.electron.worktree.onChanged((payload) => {
    const prevScope = useWorktreeStore.getState().activePaths[payload.workspaceId] ?? payload.workspacePath
    useWorktreeStore.getState().applyExternalWorktrees(payload.workspaceId, payload.workspacePath, payload.worktrees)
    const nextScope = useWorktreeStore.getState().activePaths[payload.workspaceId] ?? payload.workspacePath
    if (prevScope === nextScope) return
    // 外部删除命中活动盘时回落到主盘并重刷文件树；新增从不抢占当前 scope
    if (useWorkspaceStore.getState().activeWorkspaceId !== payload.workspaceId) return
    void refreshScopeFileTree(nextScope, true).catch(() => {})
  }), [])

  useEffect(() => {
    const queue = createWorkspaceRefreshQueue(async (workspacePath, changedFilePath) => {
      if (getActiveScopePath() !== workspacePath) return
      await Promise.allSettled([
        useGitStore.getState().fetchStatus(workspacePath),
        loadWorkspaceFileTree(workspacePath, () => getActiveScopePath() === workspacePath),
        useEditorStore.getState().reloadOpenFiles(workspacePath, changedFilePath),
      ])
    })
    const unsubscribe = window.electron.fileTree.onChanged((payload) => {
      const workspacePath = payload.workspacePath
      const scopePath = getActiveScopePath()
      if (!scopePath || scopePath !== workspacePath) return
      invalidateEditorFileCache(workspacePath)
      queue.enqueue(workspacePath, payload.changedFilePath ?? null)
    })
    return () => { queue.dispose(); unsubscribe() }
  }, [])
  return workspaceReady
}
