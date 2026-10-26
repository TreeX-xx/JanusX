import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { ExternalLink } from 'lucide-react'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWorktreeStore } from '@/stores/worktree'
import {
  getActiveScopePath,
  loadWorkspaceFileTree,
  reloadWorkspaceDirectory,
} from '@/features/workspace/actions'
import {
  collectDirectoryPathsToSearchLoad,
  createPendingFileTreeDelete,
  executeFileTreeDelete,
  filterFileTree,
  getAbsolutePath,
  getParentPath,
  isPathInScope,
  isValidEntryName,
  pruneExpandedPaths,
  remapPath,
  type FileTreeOperationResult,
  type PendingFileTreeDelete,
} from '@/features/workspace/file-tree'
import { useGitStore } from '@/stores/git'
import { closeEditorFilesUnderPath, remapEditorPaths } from '@/stores/editor'
import type { FileNode, GitFileChange } from '@/types'
import { warmupEditorRuntime } from '@/lib/editor-warmup'
import { PromptDialog } from '@/components/common/PromptDialog'
import { FileTreeItem } from '@/components/file-tree/FileTreeItem'
import { SCAN_BASE_MS } from '@/components/file-tree/scan-timing'
import { useI18n } from '@/i18n/useI18n'
import styles from '@/components/file-tree/file-tree.module.css'
import {
  FileTreeContextMenu,
  type FileTreeContextMenuState,
} from '@/components/file-tree/FileTreeContextMenu'

// 兼容既有测试/调用方的再导出;实现已迁往 features/workspace/file-tree
export {
  createPendingFileTreeDelete,
  executeFileTreeDelete,
  reloadWorkspaceDirectory,
  type PendingFileTreeDelete,
}
export { FileTreeItem, type FileTreeItemProps } from '@/components/file-tree/FileTreeItem'

const FILE_CHANGE_PRIORITY: Record<GitFileChange['status'], number> = {
  UU: 0,
  D: 1,
  M: 2,
  A: 3,
  R: 4,
  '??': 5,
}

interface NamingDialogState {
  mode: 'create-file' | 'create-directory' | 'rename'
  /** 新建时为目标目录;重命名时为目标项路径 */
  path: string
  defaultValue: string
}

const NAMING_DIALOG_KEYS: Record<NamingDialogState['mode'], { titleKey: string; labelKey: string }> = {
  'create-file': { titleKey: 'editor:fileTree.naming.createFile.title', labelKey: 'editor:fileTree.naming.createFile.label' },
  'create-directory': { titleKey: 'editor:fileTree.naming.createDirectory.title', labelKey: 'editor:fileTree.naming.createDirectory.label' },
  'rename': { titleKey: 'editor:fileTree.naming.rename.title', labelKey: 'editor:fileTree.naming.rename.label' },
}

export function FileExplorerTool({ active = true }: { active?: boolean }) {
  const { t } = useI18n('editor')
  const fileTree = useWorkspaceStore((s) => s.fileTree)
  const fileTreeLoadState = useWorkspaceStore((s) => s.fileTreeLoadState)
  const activeFilePath = useWorkspaceStore((s) => s.activeFilePath)
  const setActiveFilePath = useWorkspaceStore((s) => s.setActiveFilePath)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const worktreeActivePath = useWorktreeStore((s) =>
    activeWorkspaceId ? (s.activePaths[activeWorkspaceId] ?? null) : null,
  )
  const gitStatus = useGitStore((s) => s.status)
  const [contextMenu, setContextMenu] = useState<FileTreeContextMenuState | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PendingFileTreeDelete | null>(null)
  const [namingDialog, setNamingDialog] = useState<NamingDialogState | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [openingVSCode, setOpeningVSCode] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set())
  const [loadingDirectoryKeys, setLoadingDirectoryKeys] = useState<Set<string>>(() => new Set())
  const activeWorkspacePath = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId)?.path ?? null,
    [activeWorkspaceId, workspaces],
  )
  // Note: file tree follows the active worktree scope, not the workspace root — see .agents/notes/sessions/worktrees/worktree-sidebar-scoping.md
  const activeScopePath = worktreeActivePath ?? activeWorkspacePath
  const fileTreeViewportRef = useRef<HTMLDivElement>(null)
  const fileChangeMap = useMemo(() => {
    const map = new Map<string, GitFileChange>()
    for (const change of gitStatus?.changes ?? []) {
      const normalizedPath = change.path.replace(/\\/g, '/')
      const existing = map.get(normalizedPath)
      if (!existing || FILE_CHANGE_PRIORITY[change.status] < FILE_CHANGE_PRIORITY[existing.status] || (!existing.staged && change.staged)) {
        map.set(normalizedPath, change)
      }
    }
    return map
  }, [gitStatus])

  const changedDirs = useMemo(() => {
    const dirs = new Map<string, { additions: boolean; deletions: boolean }>()
    for (const [path, change] of fileChangeMap) {
      const hasKnownCounts = change.additions !== null || change.deletions !== null
      const hasLineChanges = (change.additions ?? 0) > 0 || (change.deletions ?? 0) > 0
      const additions = (change.additions ?? 0) > 0
        || change.status === 'A'
        || change.status === '??'
        || change.status === 'R'
        || (!hasLineChanges && change.status === 'M')
        || (!hasKnownCounts && change.status !== 'D')
      const deletions = (change.deletions ?? 0) > 0
        || change.status === 'D'
        || change.status === 'R'
        || (!hasLineChanges && change.status === 'M')
        || (!hasKnownCounts && change.status !== 'A' && change.status !== '??')

      for (let dir = getParentPath(path.replace(/\/+$/, '')); dir; dir = getParentPath(dir)) {
        const current = dirs.get(dir)
        dirs.set(dir, {
          additions: current?.additions === true || additions,
          deletions: current?.deletions === true || deletions,
        })
      }
    }
    return dirs
  }, [fileChangeMap])

  const trimmedQuery = searchQuery.trim()
  const filtered = useMemo(
    () => (trimmedQuery ? filterFileTree(fileTree, trimmedQuery) : null),
    [fileTree, trimmedQuery],
  )
  const visibleTree = filtered ? filtered.nodes : fileTree

  const loadingDirectoryPaths = useMemo(() => {
    const paths = new Set<string>()
    if (!activeScopePath) return paths
    const prefix = `${activeScopePath}\0`
    for (const key of loadingDirectoryKeys) {
      if (key.startsWith(prefix)) paths.add(key.slice(prefix.length))
    }
    return paths
  }, [activeScopePath, loadingDirectoryKeys])

  const reloadDirectory = useCallback(async (path: string, expectedWorkspacePath?: string) => {
    const workspacePath = expectedWorkspacePath ?? getActiveScopePath()
    if (!workspacePath || getActiveScopePath() !== workspacePath) return
    const loadKey = `${workspacePath}\0${path}`
    if (path) {
      setLoadingDirectoryKeys((current) => {
        if (current.has(loadKey)) return current
        const next = new Set(current)
        next.add(loadKey)
        return next
      })
    }

    try {
      if (path) {
        await reloadWorkspaceDirectory(workspacePath, path)
      } else {
        await loadWorkspaceFileTree(workspacePath, () => getActiveScopePath() === workspacePath)
      }
    } catch (err: any) {
      setErrorMessage(err?.message || t('editor:fileTree.reloadFailed'))
    } finally {
      if (path) {
        setLoadingDirectoryKeys((current) => {
          if (!current.has(loadKey)) return current
          const next = new Set(current)
          next.delete(loadKey)
          return next
        })
      }
    }
  }, [])

  const retryFileTreeLoad = useCallback(() => {
    if (!activeScopePath) return
    void loadWorkspaceFileTree(
      activeScopePath,
      () => getActiveScopePath() === activeScopePath,
      { visualTransition: true },
    )
  }, [activeScopePath])

  const openWorkspaceInVSCode = useCallback(async () => {
    if (!activeScopePath || openingVSCode) return
    setOpeningVSCode(true)
    try {
      const result = await window.electron.system.openVSCode(activeScopePath)
      if (!result.success) setErrorMessage(result.error || t('editor:fileTree.openVSCodeFailed'))
    } catch (error: any) {
      setErrorMessage(error?.message || t('editor:fileTree.openVSCodeFailed'))
    } finally {
      setOpeningVSCode(false)
    }
  }, [activeScopePath, openingVSCode, t])

  useEffect(() => {
    if (!activeScopePath) return
    setExpandedPaths(new Set())
    setLoadingDirectoryKeys(new Set())
    setSearchQuery('')
    if (fileTreeViewportRef.current) fileTreeViewportRef.current.scrollTop = 0
  }, [activeScopePath])

  const finishFileTreeReveal = useCallback(() => {
    useWorkspaceStore.setState((state) =>
      state.fileTreeLoadState === 'revealing' ? { fileTreeLoadState: 'idle' } : {},
    )
  }, [])

  // overlay 挂在滚动容器 .treeViewport 内，高度即为可见视口高度，与内容长度无关；
  // 时长固定为 SCAN_BASE_MS，reveal 中途不再改时长，避免重启动画造成扫一半跳回或卡住。
  useLayoutEffect(() => {
    if (fileTreeLoadState !== 'revealing') return
    const viewport = fileTreeViewportRef.current
    if (viewport && viewport.scrollTop !== 0) viewport.scrollTop = 0
  }, [fileTreeLoadState, activeScopePath])

  // animationend 是唯一结束路径时，切后台或动画被中断就会卡在遮罩态；按固定时长兜底收尾，
  // 保证每次切换后工作区文件一定可见。
  useEffect(() => {
    if (fileTreeLoadState !== 'revealing') return
    const timer = window.setTimeout(finishFileTreeReveal, SCAN_BASE_MS + 150)
    return () => window.clearTimeout(timer)
  }, [fileTreeLoadState, activeScopePath, finishFileTreeReveal])

  // 外部 FS 变更/重命名/删除后,丢弃树上已不存在的展开路径
  useEffect(() => {
    setExpandedPaths((current) => pruneExpandedPaths(current, fileTree))
  }, [fileTree])

  // 搜索时按需加载有限个未展开目录,让嵌套匹配逐步出现
  useEffect(() => {
    if (!trimmedQuery || !activeScopePath) return

    let cancelled = false
    const timer = setTimeout(() => {
      if (cancelled) return
      const paths = collectDirectoryPathsToSearchLoad(fileTree, trimmedQuery, 40, expandedPaths)
      if (paths.length === 0) return

      setExpandedPaths((current) => {
        const next = new Set(current)
        for (const path of paths) next.add(path)
        return next
      })

      void (async () => {
        for (const path of paths) {
          if (cancelled) return
          if (getActiveScopePath() !== activeScopePath) return
          await reloadDirectory(path, activeScopePath)
        }
      })()
    }, 180)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // expandedPaths 有意不入依赖:加载候选会主动 expand,避免与 setExpanded 形成环
  }, [activeScopePath, fileTree, reloadDirectory, trimmedQuery])

  const handleToggleDirectory = useCallback(
    (node: FileNode) => {
      if (loadingDirectoryPaths.has(node.path)) return
      const shouldExpand = !expandedPaths.has(node.path)
      setExpandedPaths((current) => {
        const next = new Set(current)
        if (shouldExpand) next.add(node.path)
        else next.delete(node.path)
        return next
      })

      if (shouldExpand && !node.loaded) {
        void reloadDirectory(node.path)
      }
    },
    [expandedPaths, loadingDirectoryPaths, reloadDirectory],
  )

  const getActiveScope = useCallback(() => getActiveScopePath(), [])

  const openFileInEditorWindow = useCallback(async (relativePath: string) => {
    const scopePath = getActiveScope()
    if (!scopePath) return

    const absolutePath = getAbsolutePath(scopePath, relativePath)
    setActiveFilePath(relativePath)
    await window.electron.window.openEditor({
      filePath: absolutePath,
      workspacePath: scopePath,
    })
  }, [getActiveScope, setActiveFilePath])

  const openContextMenu = useCallback((event: MouseEvent<HTMLDivElement>, node: FileNode | null) => {
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      target: node
        ? {
            node,
            name: node.name,
            path: node.path,
            type: node.type,
          }
        : {
            node: null,
            name: t('editor:fileTree.workspaceRoot'),
            path: '',
            type: 'directory',
          },
    })
  }, [t])

  useEffect(() => {
    if (!active) {
      setContextMenu(null)
      return
    }
    if (!contextMenu) return

    const close = () => setContextMenu(null)
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }

    // 延后挂关闭监听:避免与打开菜单的同一次 contextmenu/click 在同一事件轮次立刻关菜单
    let disposed = false
    let removeListeners: (() => void) | null = null
    const attachTimer = window.setTimeout(() => {
      if (disposed) return
      window.addEventListener('click', close)
      window.addEventListener('contextmenu', close)
      window.addEventListener('keydown', closeOnEscape)
      window.addEventListener('scroll', close, true)
      removeListeners = () => {
        window.removeEventListener('click', close)
        window.removeEventListener('contextmenu', close)
        window.removeEventListener('keydown', closeOnEscape)
        window.removeEventListener('scroll', close, true)
      }
    }, 0)

    return () => {
      disposed = true
      window.clearTimeout(attachTimer)
      removeListeners?.()
    }
  }, [active, contextMenu])

  const runFileTreeMutation = useCallback(
    async (operation: () => Promise<FileTreeOperationResult>): Promise<FileTreeOperationResult | null> => {
      try {
        const result = await operation()
        if (!result.success) {
          setErrorMessage(result.error || t('editor:fileTree.operationFailed'))
          return null
        }
        return result
      } catch (err: any) {
        setErrorMessage(err.message || t('editor:fileTree.operationFailed'))
        return null
      }
    },
    [t],
  )

  const handleOpenContextTarget = useCallback(() => {
    if (!contextMenu || contextMenu.target.type === 'directory') return
    void warmupEditorRuntime()
    openFileInEditorWindow(contextMenu.target.path)
    setContextMenu(null)
  }, [contextMenu, openFileInEditorWindow])

  const handleCopyContextPath = useCallback(
    async (mode: 'relative' | 'absolute') => {
      if (!contextMenu) return
      const scopePath = getActiveScope()
      if (!scopePath) return

      const value =
        mode === 'relative'
          ? contextMenu.target.path || '.'
          : getAbsolutePath(scopePath, contextMenu.target.path)
      await navigator.clipboard.writeText(value)
      setContextMenu(null)
    },
    [contextMenu, getActiveScope],
  )

  const handleRevealContextTarget = useCallback(async () => {
    if (!contextMenu) return
    const scopePath = getActiveScope()
    if (!scopePath) return

    await runFileTreeMutation(() => window.electron.fileTree.reveal(scopePath, contextMenu.target.path))
    setContextMenu(null)
  }, [contextMenu, getActiveScope, runFileTreeMutation])

  const openNamingDialog = useCallback(
    (mode: NamingDialogState['mode']) => {
      if (!contextMenu) return
      if (mode === 'rename') {
        if (!contextMenu.target.node) return
        setNamingDialog({ mode, path: contextMenu.target.path, defaultValue: contextMenu.target.name })
      } else {
        const baseDirectory =
          contextMenu.target.type === 'directory'
            ? contextMenu.target.path
            : getParentPath(contextMenu.target.path)
        setNamingDialog({ mode, path: baseDirectory, defaultValue: '' })
      }
      setContextMenu(null)
    },
    [contextMenu],
  )

  const validateEntryName = useCallback((name: string): string | null => {
    if (!isValidEntryName(name)) return t('editor:fileTree.nameInvalid')
    return null
  }, [t])

  const handleNamingConfirm = useCallback(
    async (name: string) => {
      if (!namingDialog) return
      const dialog = namingDialog
      setNamingDialog(null)
      const scopePath = getActiveScope()
      if (!scopePath) return

      if (dialog.mode === 'rename') {
        if (name === dialog.defaultValue) return
        const oldPath = dialog.path
        const parentPath = getParentPath(oldPath)
        const result = await runFileTreeMutation(() =>
          window.electron.fileTree.rename(scopePath, oldPath, name),
        )
        if (!result?.path) return
        const newPath = result.path

        // 同步依赖旧路径的状态:编辑器 tab/缓存、展开集合、当前选中
        remapEditorPaths(
          getAbsolutePath(scopePath, oldPath),
          getAbsolutePath(scopePath, newPath),
          scopePath,
        )
        setExpandedPaths((current) => {
          const next = new Set<string>()
          for (const path of current) next.add(remapPath(path, oldPath, newPath))
          return next
        })
        const currentActive = useWorkspaceStore.getState().activeFilePath
        if (currentActive && isPathInScope(currentActive, oldPath)) {
          setActiveFilePath(remapPath(currentActive, oldPath, newPath))
        }
        await reloadDirectory(parentPath)
        void useGitStore.getState().fetchStatus(scopePath)
        return
      }

      const result = await runFileTreeMutation(() =>
        dialog.mode === 'create-file'
          ? window.electron.fileTree.createFile(scopePath, dialog.path, name)
          : window.electron.fileTree.createDirectory(scopePath, dialog.path, name),
      )
      if (!result) return

      await reloadDirectory(dialog.path)
      if (dialog.path) {
        setExpandedPaths((current) => new Set(current).add(dialog.path))
      }
      if (dialog.mode === 'create-file' && result.path) setActiveFilePath(result.path)
      void useGitStore.getState().fetchStatus(scopePath)
    },
    [getActiveScope, namingDialog, reloadDirectory, runFileTreeMutation, setActiveFilePath],
  )

  const handleMoveFile = useCallback(async (
    sourcePath: string,
    targetDirectoryPath: string,
    sourceWorkspacePath: string,
  ) => {
    const scopePath = getActiveScope()
    if (!scopePath || scopePath !== sourceWorkspacePath) return

    const sourceParentPath = getParentPath(sourcePath)
    if (sourceParentPath === targetDirectoryPath) return

    const result = await runFileTreeMutation(() =>
      window.electron.fileTree.move(scopePath, sourcePath, targetDirectoryPath),
    )
    if (!result?.path || getActiveScope() !== sourceWorkspacePath) return

    const targetPath = result.path
    remapEditorPaths(
      getAbsolutePath(scopePath, sourcePath),
      getAbsolutePath(scopePath, targetPath),
      scopePath,
    )
    const currentActive = useWorkspaceStore.getState().activeFilePath
    if (currentActive === sourcePath) setActiveFilePath(targetPath)
    setExpandedPaths((current) => new Set(current).add(targetDirectoryPath))

    await reloadDirectory(sourceParentPath, sourceWorkspacePath)
    if (targetDirectoryPath !== sourceParentPath) {
      await reloadDirectory(targetDirectoryPath, sourceWorkspacePath)
    }
    void useGitStore.getState().fetchStatus(scopePath)
  }, [getActiveScope, reloadDirectory, runFileTreeMutation, setActiveFilePath])

  const handleDeleteContextTarget = useCallback(() => {
    if (!contextMenu || !contextMenu.target.node) return
    const scopePath = getActiveScope()
    if (!scopePath) return

    setPendingDelete(createPendingFileTreeDelete(scopePath, contextMenu.target))
    setContextMenu(null)
  }, [contextMenu, getActiveScope])

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDelete) return
    const request = pendingDelete
    setPendingDelete(null)

    await executeFileTreeDelete(request, {
      deleteTarget: (workspacePath, targetPath) =>
        runFileTreeMutation(() => window.electron.fileTree.delete(workspacePath, targetPath)),
      isWorkspaceActive: (workspacePath) => getActiveScope() === workspacePath,
      reloadDirectory,
      onDeleted: (targetPath) => {
        closeEditorFilesUnderPath(getAbsolutePath(request.workspacePath, targetPath))
        setExpandedPaths((current) => {
          const next = new Set<string>()
          for (const path of current) {
            if (!isPathInScope(path, targetPath)) next.add(path)
          }
          return next
        })
        const currentActive = useWorkspaceStore.getState().activeFilePath
        if (currentActive && isPathInScope(currentActive, targetPath)) setActiveFilePath(null)
      },
    })
    void useGitStore.getState().fetchStatus(request.workspacePath)
  }, [getActiveScope, pendingDelete, reloadDirectory, runFileTreeMutation, setActiveFilePath])

  const namingCopy = namingDialog ? NAMING_DIALOG_KEYS[namingDialog.mode] : null

  return (
    <>
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="flex gap-1.5 px-3 py-2">
          <input
            type="text"
            className={`h-7 min-w-0 flex-1 rounded px-2.5 text-xs text-[var(--shell-text)] transition-colors ${styles.searchInput}`}
            placeholder={t('editor:fileTree.searchPlaceholder')}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && searchQuery) {
                event.stopPropagation()
                setSearchQuery('')
              }
            }}
          />
          <button
            type="button"
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${styles.externalEditorButton}`}
            title={t('editor:fileTree.openInVSCode')}
            aria-label={t('editor:fileTree.openInVSCode')}
            disabled={!activeScopePath || openingVSCode}
            onClick={() => void openWorkspaceInVSCode()}
          >
            <ExternalLink size={14} aria-hidden="true" />
          </button>
        </div>
        <div
          ref={fileTreeViewportRef}
          data-testid="file-explorer-content"
          aria-busy={fileTreeLoadState === 'loading' || fileTreeLoadState === 'revealing'}
          aria-label={t('editor:fileTree.ariaContent')}
          className={`no-scrollbar min-h-0 flex-1 overflow-y-auto p-1.5 text-xs ${styles.treeViewport}`}
          onContextMenu={(event) => {
            event.preventDefault()
            // 空白区菜单:item 已 stopPropagation;这里再 stop 防冒泡到外层容器
            event.stopPropagation()
            openContextMenu(event, null)
          }}
        >
          <div className={`min-h-full ${styles.tree}`} data-file-tree-phase={fileTreeLoadState}>
            {fileTreeLoadState === 'loading' ? (
              <div className={styles.loadingState} role="status">{t('editor:fileTree.loading')}</div>
            ) : fileTreeLoadState === 'error' ? (
              <div className={styles.loadError} role="alert">
                <span>{t('editor:fileTree.loadError')}</span>
                <button type="button" onClick={retryFileTreeLoad}>{t('common:action.retry')}</button>
              </div>
            ) : visibleTree.length === 0 ? (
              <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-3">
                <div className="text-[var(--shell-dim)]">
                  {fileTree.length === 0 ? t('editor:fileTree.emptyWorkspace') : t('editor:fileTree.noMatch')}
                </div>
              </div>
            ) : (
              <div className={styles.treeContent}>
                {visibleTree.map((node) => (
                  <div key={node.path}>
                    <FileTreeItem
                      node={node}
                      workspacePath={activeScopePath ?? ''}
                      depth={0}
                      activeFilePath={activeFilePath}
                      expanded={expandedPaths.has(node.path) || filtered?.expandedDirs.has(node.path) === true}
                      expandedPaths={
                        filtered ? new Set([...expandedPaths, ...filtered.expandedDirs]) : expandedPaths
                      }
                      loading={loadingDirectoryPaths.has(node.path)}
                      loadingDirectoryPaths={loadingDirectoryPaths}
                      fileChange={fileChangeMap.get(node.path) ?? null}
                      fileChangeMap={fileChangeMap}
                      changedDirs={changedDirs}
                      onSelect={setActiveFilePath}
                      onToggleDirectory={handleToggleDirectory}
                      onOpenFile={openFileInEditorWindow}
                      onMoveFile={handleMoveFile}
                      onOpenContextMenu={openContextMenu}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* 遮罩与光线挂在滚动容器 .treeViewport 内：inset:0 即可见视口高度，光线每次完整走完可见区；
              之前挂在 .tree 内拿的是内容高度，长树后半程跑到折叠线以下，看起来像提前消失。 */}
          {fileTreeLoadState === 'revealing' && (
            <div
              key={activeScopePath ?? 'empty'}
              className={styles.scanOverlay}
              style={{ '--scan-duration': `${SCAN_BASE_MS}ms` } as CSSProperties}
              aria-hidden="true"
              onAnimationEnd={(event) => {
                if (event.target === event.currentTarget) finishFileTreeReveal()
              }}
            >
              <div className={styles.scanMask} />
              <div className={styles.scanBeam} />
            </div>
          )}
        </div>
      </div>

      {active && contextMenu ? (
        <FileTreeContextMenu
          menu={contextMenu}
          onOpen={handleOpenContextTarget}
          onCreate={(type) => openNamingDialog(type === 'file' ? 'create-file' : 'create-directory')}
          onCopyPath={(mode) => void handleCopyContextPath(mode)}
          onReveal={() => void handleRevealContextTarget()}
          onRename={() => openNamingDialog('rename')}
          onDelete={handleDeleteContextTarget}
        />
      ) : null}

      <PromptDialog
        open={namingDialog !== null}
        title={namingCopy ? t(namingCopy.titleKey) : ''}
        label={namingCopy ? t(namingCopy.labelKey) : undefined}
        defaultValue={namingDialog?.defaultValue}
        validate={validateEntryName}
        onConfirm={(value) => void handleNamingConfirm(value)}
        onCancel={() => setNamingDialog(null)}
      />

      <PromptDialog
        open={pendingDelete !== null}
        title={t('editor:fileTree.deleteTitle')}
        description={
          <>
            {t('editor:fileTree.deleteConfirmPrefix')}<strong className="prompt-dialog__emphasis">{pendingDelete?.targetName}</strong>{t('editor:fileTree.deleteConfirmSuffix')}
          </>
        }
        confirmOnly
        confirmText={t('editor:fileTree.deleteConfirmButton')}
        tone="danger"
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />

      <PromptDialog
        open={errorMessage !== null}
        title={t('editor:fileTree.errorTitle')}
        description={errorMessage}
        confirmOnly
        hideCancel
        confirmText={t('editor:fileTree.errorDismiss')}
        onConfirm={() => setErrorMessage(null)}
        onCancel={() => setErrorMessage(null)}
      />
    </>
  )
}
