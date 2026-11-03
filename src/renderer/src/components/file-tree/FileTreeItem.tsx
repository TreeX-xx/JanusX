import { useCallback, useState, type DragEvent, type MouseEvent } from 'react'
import { LoaderCircle } from 'lucide-react'
import type { FileNode, GitFileChange } from '@/types'
import {
  clearWorkspaceFileDragData,
  getActiveWorkspaceFileDragData,
  hasWorkspaceFileDrag,
  readWorkspaceFileDragData,
  setWorkspaceFileDragData,
  type WorkspaceFileDragPayload,
} from '@/lib/terminal-file-reference'
import { getParentPath } from '@/features/workspace/file-tree'
import { warmupEditorRuntime } from '@/lib/editor-warmup'
import { classifyFile } from '@/lib/file-classification'
import { resolveFilePresentation } from '@/lib/file-presentation'
import { FileTypeIcon } from '@/components/FileTypeIcon'
import { useI18n } from '@/i18n/useI18n'
import styles from './file-tree.module.css'

const FILE_CHANGE_VISUALS: Record<GitFileChange['status'], { label: string; color: string; titleKey: string }> = {
  M: { label: 'M', color: 'var(--status-warning)', titleKey: 'editor:fileTree.gitStatus.modified' },
  A: { label: 'A', color: 'var(--shell-diff-add)', titleKey: 'editor:fileTree.gitStatus.added' },
  D: { label: 'D', color: 'var(--shell-diff-del)', titleKey: 'editor:fileTree.gitStatus.deleted' },
  R: { label: 'R', color: 'var(--status-info)', titleKey: 'editor:fileTree.gitStatus.renamed' },
  '??': { label: 'A', color: 'var(--shell-diff-add)', titleKey: 'editor:fileTree.gitStatus.untracked' },
  UU: { label: '!', color: 'var(--status-danger)', titleKey: 'editor:fileTree.gitStatus.conflict' },
}

interface DirectoryChangeSummary {
  additions: boolean
  deletions: boolean
}

function canMoveFileToDirectory(
  payload: WorkspaceFileDragPayload | null,
  targetDirectoryPath: string,
  workspacePath: string,
): payload is WorkspaceFileDragPayload & { type: 'file' } {
  return payload?.type === 'file'
    && payload.workspacePath === workspacePath
    && getParentPath(payload.path) !== targetDirectoryPath
}

export interface FileTreeItemProps {
  node: FileNode
  workspacePath: string
  depth: number
  activeFilePath: string | null
  expanded: boolean
  expandedPaths: Set<string>
  loading: boolean
  loadingDirectoryPaths: ReadonlySet<string>
  fileChange: GitFileChange | null
  fileChangeMap: Map<string, GitFileChange>
  changedDirs: Map<string, DirectoryChangeSummary>
  onSelect: (path: string) => void
  onToggleDirectory: (node: FileNode) => void
  onOpenFile: (path: string) => void
  onMoveFile: (sourcePath: string, targetDirectoryPath: string, workspacePath: string) => void | Promise<void>
  onOpenContextMenu: (event: MouseEvent<HTMLDivElement>, node: FileNode) => void
}

export function FileTreeItem({
  node,
  workspacePath,
  depth,
  activeFilePath,
  expanded,
  expandedPaths,
  loading,
  loadingDirectoryPaths,
  fileChange,
  fileChangeMap,
  changedDirs,
  onSelect,
  onToggleDirectory,
  onOpenFile,
  onMoveFile,
  onOpenContextMenu,
}: FileTreeItemProps) {
  const { t } = useI18n('editor')
  const isFolder = node.type === 'directory'
  const isActive = activeFilePath === node.path
  const isGitIgnored = node.isGitIgnored === true
  const changeVisual = !isFolder && fileChange ? FILE_CHANGE_VISUALS[fileChange.status] : null
  const directoryChange = isFolder ? changedDirs.get(node.path) : null
  const presentation = resolveFilePresentation(classifyFile(node.path, node.type))
  const [dropActive, setDropActive] = useState(false)

  const handleClick = useCallback(() => {
    if (isFolder) {
      void onToggleDirectory(node)
    } else {
      onSelect(node.path)
      void warmupEditorRuntime()
    }
  }, [isFolder, node, onSelect, onToggleDirectory])

  const handleDoubleClick = useCallback(() => {
    if (!isFolder) {
      void warmupEditorRuntime()
      onOpenFile(node.path)
    }
  }, [isFolder, node.path, onOpenFile])

  const handleDragStart = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      setWorkspaceFileDragData(event.dataTransfer, {
        type: node.type,
        name: node.name,
        path: node.path,
        workspacePath,
      })
    },
    [node.name, node.path, node.type, workspacePath],
  )

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    const payload = getActiveWorkspaceFileDragData()
    if (!isFolder || !hasWorkspaceFileDrag(event.dataTransfer) || !canMoveFileToDirectory(payload, node.path, workspacePath)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    setDropActive(true)
  }, [isFolder, node.path, workspacePath])

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false)
  }, [])

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    setDropActive(false)
    if (!isFolder) return
    const payload = readWorkspaceFileDragData(event.dataTransfer) ?? getActiveWorkspaceFileDragData()
    if (!canMoveFileToDirectory(payload, node.path, workspacePath)) return
    event.preventDefault()
    event.stopPropagation()
    clearWorkspaceFileDragData()
    void onMoveFile(payload.path, node.path, payload.workspacePath)
  }, [isFolder, node.path, onMoveFile, workspacePath])

  const handleContextMenu = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      if (!isFolder) onSelect(node.path)
      onOpenContextMenu(event, node)
    },
    [isFolder, node, onOpenContextMenu, onSelect],
  )

  return (
    <div>
      <div
        data-file-path={node.path}
        data-selected={isActive}
        data-git-ignored={isGitIgnored ? 'true' : undefined}
        data-drop-target={dropActive ? 'true' : undefined}
        data-directory-loading={loading ? 'true' : undefined}
        aria-busy={loading || undefined}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        draggable
        onDragStart={handleDragStart}
        onDragEnd={clearWorkspaceFileDragData}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={styles.row}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        {isFolder && <div className={styles.chevron} data-expanded={expanded} />}
        <span className="flex shrink-0" style={{ marginLeft: isFolder ? 0 : 6 }}>
          <FileTypeIcon presentation={presentation} active={isActive} />
        </span>
        <span className={styles.name} data-file-name={node.name}>
          {node.name}
        </span>
        {isFolder && loading && (
          <LoaderCircle className={styles.directorySpinner} size={12} strokeWidth={1.6} aria-hidden="true" />
        )}
        {changeVisual && fileChange && (
          <FileChangeIndicator change={fileChange} visual={changeVisual} />
        )}
{directoryChange && (
          <span
            data-git-dirty
            data-has-additions={directoryChange.additions || undefined}
            data-has-deletions={directoryChange.deletions || undefined}
            className={styles.gitAggregate}
            title={t('editor:fileTree.directoryChange.contains', {
              additions: directoryChange.additions ? t('editor:fileTree.directoryChange.additions') : '',
              connector: directoryChange.additions && directoryChange.deletions ? t('editor:fileTree.directoryChange.connector') : '',
              deletions: directoryChange.deletions ? t('editor:fileTree.directoryChange.deletions') : '',
            })}
          >
            {directoryChange.additions && <span className={styles.gitAggregateAddition} />}
            {directoryChange.deletions && <span className={styles.gitAggregateDeletion} />}
          </span>
        )}
      </div>
      {isFolder && node.children && expanded && (
        <div>
          {node.children.map((child) => (
            <FileTreeItem
              key={child.path}
              node={child}
              workspacePath={workspacePath}
              depth={depth + 1}
              activeFilePath={activeFilePath}
              expanded={expandedPaths.has(child.path)}
              expandedPaths={expandedPaths}
              loading={loadingDirectoryPaths.has(child.path)}
              loadingDirectoryPaths={loadingDirectoryPaths}
              fileChange={fileChangeMap.get(child.path) ?? null}
              fileChangeMap={fileChangeMap}
              changedDirs={changedDirs}
              onSelect={onSelect}
              onToggleDirectory={onToggleDirectory}
              onOpenFile={onOpenFile}
              onMoveFile={onMoveFile}
              onOpenContextMenu={onOpenContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function FileChangeIndicator({
  change,
  visual,
}: {
  change: GitFileChange
  visual: { label: string; color: string; titleKey: string }
}) {
  const { t } = useI18n('editor')
  const hasAdditions = (change.additions ?? 0) > 0
  const hasDeletions = (change.deletions ?? 0) > 0
  const isBinary = change.additions === null && change.deletions === null
  const showStatus = change.status === 'UU'
    || change.status === 'R'
    || isBinary
    || (!hasAdditions && !hasDeletions)
  const statusLabel = isBinary && change.status !== 'UU' && change.status !== 'R' ? t('editor:fileTree.gitStatus.binary') : visual.label
  const countTitle = [
    hasAdditions ? `+${change.additions}` : '',
    hasDeletions ? `−${change.deletions}` : '',
  ].filter(Boolean).join(' ')

  return (
    <span
      data-git-status={change.status}
      className={styles.gitChange}
      title={`${t(visual.titleKey)}${countTitle ? ` · ${countTitle}` : ''}`}
    >
      {showStatus && (
        <span
          className={styles.gitStatus}
          style={{ color: visual.color, borderColor: `color-mix(in srgb, ${visual.color} 32%, transparent)` }}
        >
          {statusLabel}
        </span>
      )}
      {hasAdditions && (
        <span data-git-additions className={styles.gitAddition}>+{formatChangeCount(change.additions!)}</span>
      )}
      {hasDeletions && (
        <span data-git-deletions className={styles.gitDeletion}>−{formatChangeCount(change.deletions!)}</span>
      )}
    </span>
  )
}

function formatChangeCount(value: number): string {
  if (value < 1000) return String(value)
  const compact = value < 10000 ? (value / 1000).toFixed(1) : Math.round(value / 1000).toString()
  return `${compact.replace(/\.0$/, '')}k`
}
