import type { FileNode, Workspace } from '@/types'
import { invalidateEditorFileCache } from '@/stores/editor'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWorktreeStore } from '@/stores/worktree'
import { useGitStore } from '@/stores/git'
import { applyLoadedChildren, collectLoadedDirectoryPaths, injectDirectoryChildren } from './file-tree'

export function getActiveWorkspacePath(): string | null {
  const { workspaces, activeWorkspaceId } = useWorkspaceStore.getState()
  return workspaces.find((workspace) => workspace.id === activeWorkspaceId)?.path ?? null
}

// Note: file tree follows the active worktree scope, not the workspace root — see .agents/notes/sessions/worktrees/worktree-sidebar-scoping.md
/** Effective file-tree root: active worktree path when set, otherwise the workspace root. */
export function getActiveScopePath(): string | null {
  const { workspaces, activeWorkspaceId } = useWorkspaceStore.getState()
  if (!activeWorkspaceId) return null
  const scoped = useWorktreeStore.getState().activePaths[activeWorkspaceId]
  if (scoped) return scoped
  return workspaces.find((workspace) => workspace.id === activeWorkspaceId)?.path ?? null
}

/** Scope path for a given workspace (used when the target workspace is not yet active). */
export function getScopePathForWorkspace(workspaceId: string, workspacePath: string): string {
  return useWorktreeStore.getState().activePaths[workspaceId] ?? workspacePath
}

/**
 * 全量树加载代际。
 * - loadWorkspaceFileTree 每次自增,只提交最新一次
 * - reloadWorkspaceDirectory 提交后推进目录变更代际,阻止旧根快照覆盖 children
 * - 同一目录的并发 reload 复用请求,不同目录仍可同时加载
 */
let fileTreeLoadGeneration = 0
// A directory response can arrive while a root refresh is in flight.  Track committed
// directory updates separately so the older root snapshot cannot erase newly loaded children.
let fileTreeDirectoryMutationGeneration = 0
const pendingDirectoryLoads = new Map<string, Promise<void>>()
// Note: background refreshes must never cancel a pending switch sweep — see .agents/notes/workbench/file-tree-reveal-race.md
// 未播出的切换扫描：visual load 起飞时登记目标路径，之后任意一次成功提交（visual 或后台刷新）
// 若命中该路径就播一次 revealing，保证切换扫光一定出现；后台提交永不掐断已在播的 reveal。
let pendingVisualRevealPath: string | null = null

export interface FileTreeLoadOptions {
  /** Used when the visible workspace changes; background refreshes keep the current tree in place. */
  visualTransition?: boolean
}

/**
 * 加载工作区文件树(唯一入口)。
 * 根层重新拉取之外,当前树中所有已展开加载过的目录也会同步重拉,
 * 保证外部文件系统变化(agent 写文件、终端操作)反映到已展开分支。
 */
export async function loadWorkspaceFileTree(
  workspacePath: string,
  shouldCommit: () => boolean = () => true,
  options: FileTreeLoadOptions = {},
): Promise<void> {
  const generation = ++fileTreeLoadGeneration
  const directoryMutationGeneration = fileTreeDirectoryMutationGeneration
  const shouldAnimate = options.visualTransition === true
  if (shouldAnimate && shouldCommit()) {
    pendingVisualRevealPath = workspacePath
    useWorkspaceStore.setState({ fileTreeLoadState: 'loading' })
  }

  let rootNodes: FileNode[]
  try {
    rootNodes = await window.electron.fileTree.load(workspacePath)
  } catch (error) {
    if (shouldAnimate && generation === fileTreeLoadGeneration && shouldCommit()) {
      useWorkspaceStore.setState({ fileTreeLoadState: 'error' })
    }
    throw error
  }

  if (generation !== fileTreeLoadGeneration || !shouldCommit()) return
  // 当前 store 中的树属于活动 scope;仅当目标一致时才带着已展开分支去刷新
  const loadedPaths =
    getActiveScopePath() === workspacePath
      ? collectLoadedDirectoryPaths(useWorkspaceStore.getState().fileTree)
      : []
  const childrenByPath = new Map<string, FileNode[]>()
  if (loadedPaths.length > 0) {
    // Stop superseded scans before starting more IPC/Git work; never fan out
    // every expanded directory at once.
    let nextDirectory = 0
    await Promise.all(Array.from({ length: Math.min(4, loadedPaths.length) }, async () => {
      while (nextDirectory < loadedPaths.length) {
        if (generation !== fileTreeLoadGeneration || !shouldCommit()) return
        const path = loadedPaths[nextDirectory++]
        const children = await window.electron.fileTree.children(workspacePath, path).catch(() => [])
        childrenByPath.set(path, children)
      }
    }))
  }

  if (
    generation !== fileTreeLoadGeneration ||
    directoryMutationGeneration !== fileTreeDirectoryMutationGeneration
  ) return
  if (!shouldCommit() || directoryMutationGeneration !== fileTreeDirectoryMutationGeneration) return

  // visual 提交必播；后台提交若命中待播路径也播一次（可视加载可能已被后台代际抢占）。
  // 非播出提交保持现状：已在播的 reveal 不被后台刷新掐断，error/loading 按原逻辑回到 idle。
  const playReveal = shouldAnimate || pendingVisualRevealPath === workspacePath
  if (playReveal) pendingVisualRevealPath = null

  useWorkspaceStore.setState((state) => {
    const keepRevealing = !playReveal && state.fileTreeLoadState === 'revealing'
    return {
      fileTree: applyLoadedChildren(rootNodes, childrenByPath),
      fileTreeLoadState: playReveal || keepRevealing ? 'revealing' : 'idle',
    }
  })

}

/** 重拉单个目录的 children 并挂回树上。 */
function containsDirectory(nodes: FileNode[], path: string): boolean {
  for (const node of nodes) {
    if (node.type !== 'directory') continue
    if (node.path === path) return true
    if (node.children?.length && containsDirectory(node.children, path)) return true
  }
  return false
}

export async function reloadWorkspaceDirectory(workspacePath: string, path: string): Promise<void> {
  const loadKey = `${workspacePath}\0${path}`
  const pending = pendingDirectoryLoads.get(loadKey)
  if (pending) return pending

  const operation = (async () => {
    const children = await window.electron.fileTree.children(workspacePath, path)
    if (getActiveScopePath() !== workspacePath) return

    let committed = false
    useWorkspaceStore.setState((state) => {
      if (getActiveScopePath() !== workspacePath) return {}
      if (!containsDirectory(state.fileTree, path)) return {}
      committed = true
      return { fileTree: injectDirectoryChildren(state.fileTree, path, children) }
    })
    if (committed) fileTreeDirectoryMutationGeneration += 1
  })()

  pendingDirectoryLoads.set(loadKey, operation)
  try {
    await operation
  } finally {
    if (pendingDirectoryLoads.get(loadKey) === operation) pendingDirectoryLoads.delete(loadKey)
  }
}

export async function chooseAndCreateWorkspace(): Promise<Workspace | null> {
  if (window.electron.workspaceRuntime) {
    const { openWorkspaceImport } = await import('@/components/WorkspaceImport')
    const workspace = await openWorkspaceImport()
    if (workspace) invalidateEditorFileCache(workspace.path)
    return workspace
  }
  const result = await window.electron.dialog.openDirectory()
  const folderPath = result.filePaths[0]
  if (result.canceled || !folderPath) return null
  const workspace = await window.electron.workspace.create({
    name: folderPath.split(/[/\\]/).pop() || 'Workspace',
    path: folderPath,
  })
  invalidateEditorFileCache(folderPath)
  // Note: callers load after activation, which clears the previous tree — see .agents/notes/workbench/first-run-learning.md
  return workspace
}

/**
 * Scope 刷新统一入口:清选中、清编辑器缓存、刷 git、带扫描线重拉文件树。
 * 调用方只传 scope 根目录;是否提交由 scope 竞态守卫决定。
 */
export async function refreshScopeFileTree(scopePath: string, visual = true): Promise<void> {
  if (getActiveScopePath() !== scopePath) return
  invalidateEditorFileCache(scopePath)
  void useGitStore.getState().fetchStatus(scopePath)
  useWorkspaceStore.setState({ activeFilePath: null })
  await loadWorkspaceFileTree(
    scopePath,
    () => getActiveScopePath() === scopePath,
    visual ? { visualTransition: true } : {},
  )
}

/**
 * 切换活动 worktree 并走扫描线加载;目标已是当前 scope 时直接返回 false。
 */
export async function switchActiveWorktree(workspaceId: string, nextPath: string): Promise<boolean> {
  const { workspaces } = useWorkspaceStore.getState()
  const workspacePath = workspaces.find((workspace) => workspace.id === workspaceId)?.path ?? null
  const current = useWorktreeStore.getState().activePaths[workspaceId] ?? workspacePath
  if (!workspacePath || current === nextPath) return false
  useWorktreeStore.getState().setActivePath(workspaceId, nextPath)
  await refreshScopeFileTree(nextPath, true).catch(() => {})
  return true
}
