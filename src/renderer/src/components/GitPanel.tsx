import { memo, useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useGitStore } from '@/stores/git'
import { useWorkspaceStore } from '@/stores/workspace'
import { useI18n } from '@/i18n/useI18n'
import type { TFunction } from 'i18next'
import type { GitFileChange } from '@/types'
import type { GitCommitChange } from '../../../shared/ipc/git'
import { ModalCloseButton } from './ModalCloseButton'
import { PromptDialog } from './blueprint/PromptDialog'
import styles from './GitPanel.module.css'
import { Eye, GitBranch, Minus, Plus, RotateCcw } from 'lucide-react'
import { useEditorStore } from '@/stores/editor'

type GitRemoteAction = 'push' | 'pull'
const GIT_HISTORY_LIMIT = 100
const commitDateFormatter = new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' })

export function GitPanel({ active = true }: { active?: boolean }) {
  const { status, commits, loading, error, fetchLog, stageFiles, unstageFiles, discardChange, commitChangesByHash, commitChanges, pushChanges, pullChanges } = useGitStore()
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const cwd = workspaces.find((w) => w.id === activeWorkspaceId)?.path
  const { t } = useI18n('git')
  const [commitMsg, setCommitMsg] = useState('')
  const [confirmAction, setConfirmAction] = useState<GitRemoteAction | null>(null)
  const [discardTarget, setDiscardTarget] = useState<GitFileChange | null>(null)
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null)
  const [commitFiles, setCommitFiles] = useState<Record<string, GitCommitChange[]>>({})
  const [commitFilesLoading, setCommitFilesLoading] = useState<string | null>(null)
  const openFile = useEditorStore((state) => state.openFile)
  const [hoveredCommit, setHoveredCommit] = useState<{ commit: typeof commits[number]; top: number; left: number } | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadCommitPreview = useCallback(async (commit: typeof commits[number]) => {
    if (!cwd || commitFiles[commit.hash]) return
    setCommitFilesLoading(commit.hash)
    const files = await commitChangesByHash(cwd, commit.hash)
    setCommitFiles((current) => ({ ...current, [commit.hash]: files }))
    setCommitFilesLoading((current) => current === commit.hash ? null : current)
  }, [commitChangesByHash, commitFiles, cwd])

  const clearHoverTimers = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = null
  }, [])

  // Note: .agents/notes/workbench/right-dock.md — previews never capture pointer input.
  const closePreview = useCallback(() => {
    clearHoverTimers()
    setHoveredCommit(null)
  }, [clearHoverTimers])

  const schedulePreview = useCallback((commit: typeof commits[number], target: HTMLElement) => {
    clearHoverTimers()
    setHoveredCommit(null)
    hoverTimerRef.current = setTimeout(() => {
      const rect = target.getBoundingClientRect()
      const previewWidth = Math.min(280, window.innerWidth - 16)
      const left = Math.max(8, rect.left - previewWidth - 8)
      const top = Math.max(8, Math.min(window.innerHeight - 220, rect.top))
      setHoveredCommit({ commit, top, left })
      void loadCommitPreview(commit)
    }, 280)
  }, [clearHoverTimers, loadCommitPreview])

  useEffect(() => () => clearHoverTimers(), [clearHoverTimers])

  useEffect(() => {
    if (!active) setConfirmAction(null)
    closePreview()
  }, [active, cwd, closePreview])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') closePreview() }
    window.addEventListener('scroll', closePreview, true)
    window.addEventListener('resize', closePreview)
    document.addEventListener('pointerdown', closePreview, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('scroll', closePreview, true)
      window.removeEventListener('resize', closePreview)
      document.removeEventListener('pointerdown', closePreview, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [closePreview])

  const refreshGitData = useCallback(async () => {
    if (!cwd) return
    await fetchLog(cwd, GIT_HISTORY_LIMIT)
  }, [cwd, fetchLog])

  useEffect(() => {
    if (!cwd) return
    void refreshGitData()
  }, [cwd, refreshGitData])

  const handleStageAll = useCallback(async () => {
    if (!cwd || !status) return
    const unstaged = status.changes.filter((c) => !c.staged).map((c) => c.path)
    if (unstaged.length > 0) await stageFiles(cwd, unstaged)
  }, [cwd, status, stageFiles])

  const handleUnstageAll = useCallback(async () => {
    if (!cwd || !status) return
    const staged = status.changes.filter((c) => c.staged).map((c) => c.path)
    if (staged.length > 0) await unstageFiles(cwd, staged)
  }, [cwd, status, unstageFiles])

  const handleCommit = useCallback(async () => {
    if (!cwd || !commitMsg.trim()) return
    const committed = await commitChanges(cwd, commitMsg.trim())
    if (!committed) return
    await fetchLog(cwd, GIT_HISTORY_LIMIT)
    setCommitMsg('')
  }, [cwd, commitMsg, commitChanges, fetchLog])

  const handlePush = useCallback(() => {
    if (!cwd || loading) return
    setConfirmAction('push')
  }, [cwd, loading])

  const handlePull = useCallback(() => {
    if (!cwd || loading) return
    setConfirmAction('pull')
  }, [cwd, loading])

  const handleConfirmRemoteAction = useCallback(async () => {
    if (!cwd || !confirmAction) return

    const succeeded = confirmAction === 'push'
      ? await pushChanges(cwd)
      : await pullChanges(cwd)
    if (!succeeded) return
    await fetchLog(cwd, GIT_HISTORY_LIMIT)
    setConfirmAction(null)
  }, [confirmAction, cwd, fetchLog, pullChanges, pushChanges])

  const handleToggleStage = useCallback(
    async (file: GitFileChange) => {
      if (!cwd) return
      if (file.staged) {
        await unstageFiles(cwd, [file.path])
      } else {
        await stageFiles(cwd, [file.path])
      }
    },
    [cwd, stageFiles, unstageFiles]
  )

  const handleOpenFile = useCallback((file: GitFileChange) => {
    if (!cwd) return
    void openFile(`${cwd}/${file.path}`.replace(/\\/g, '/'), cwd)
  }, [cwd, openFile])

  const handleDiscard = useCallback(async () => {
    if (!cwd || !discardTarget) return
    await discardChange(cwd, discardTarget.path)
    setDiscardTarget(null)
  }, [cwd, discardChange, discardTarget])

  const handleToggleCommit = useCallback(async (hash: string) => {
    if (expandedCommit === hash) { setExpandedCommit(null); return }
    setExpandedCommit(hash)
    if (commitFiles[hash]) return
    if (!cwd) return
    setCommitFilesLoading(hash)
    const files = await commitChangesByHash(cwd, hash)
    setCommitFiles((current) => ({ ...current, [hash]: files }))
    setCommitFilesLoading(null)
  }, [commitFiles, commitChangesByHash, cwd, expandedCommit])

  if (!cwd) {
    return (
      <div className={styles.emptyState}>
        <p className={styles.emptyTitle}>{t('git:noWorkspace')}</p>
      </div>
    )
  }

  // 工作区不是 Git 仓库：主进程返回结构化占位状态（isRepo: false），这里给出说明而不是错误文本。
  if (status?.isRepo === false) {
    return (
      <div className={styles.emptyState}>
        <GitBranch className={styles.emptyIcon} size={20} strokeWidth={1.25} aria-hidden="true" />
        <p className={styles.emptyTitle}>{t('git:notRepository.title')}</p>
        <p className={styles.emptyHint}>{t('git:notRepository.hint')}</p>
      </div>
    )
  }

  const stagedChanges = status?.changes.filter((c) => c.staged) ?? []
  const unstagedChanges = status?.changes.filter((c) => !c.staged) ?? []
  const modifiedCount = status?.changes.filter((c) => c.status === 'M').length ?? 0
  const addedCount = status?.changes.filter((c) => c.status === 'A' || c.status === '??').length ?? 0
  const deletedCount = status?.changes.filter((c) => c.status === 'D').length ?? 0

  const remoteMeta = confirmAction
    ? {
        title: t(`git:remote.${confirmAction}.title`),
        actionLabel: t(`git:remote.${confirmAction}.actionLabel`),
        description: t(`git:remote.${confirmAction}.description`),
        hint: t(`git:remote.${confirmAction}.hint`),
      }
    : null
  const branchName = status?.branch.name ?? t('git:branch.currentFallback')
  const upstreamName = status?.branch.upstream ?? t('git:branch.upstreamUnset')

  return (
    <>
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden text-xs" aria-busy={loading}>
      {/* Branch bar */}
      <div className={styles.branchToolbar}>
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <div
            className="w-2 h-2 rounded-full shrink-0"
            style={{ border: '1.5px solid var(--shell-muted)' }}
          />
          <span className="text-[var(--shell-text)] font-medium truncate">
            {status?.branch.name ?? '...'}
          </span>
          {status?.branch.upstream && (
            <span className="text-[var(--shell-dim)] truncate" title={status.branch.upstream}>
              {status.branch.upstream}
            </span>
          )}
        </div>
        {(status?.branch.ahead ?? 0) > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'color-mix(in srgb, var(--shell-diff-add) 15%, transparent)', color: 'var(--shell-diff-add)' }}>
            ↑{status?.branch.ahead}
          </span>
        )}
        {(status?.branch.behind ?? 0) > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'color-mix(in srgb, var(--shell-diff-del) 15%, transparent)', color: 'var(--shell-diff-del)' }}>
            ↓{status?.branch.behind}
          </span>
        )}
      </div>

      {/* Status summary */}
      {(modifiedCount > 0 || addedCount > 0 || deletedCount > 0) && <div className={styles.statusSummary}>
        {modifiedCount > 0 && <div>
          <span className="text-[var(--shell-muted)]">{t('git:statusSummary.modified', { count: modifiedCount })}</span>
        </div>}
        {addedCount > 0 && <div>
          <span className="text-[var(--shell-muted)]">{t('git:statusSummary.added', { count: addedCount })}</span>
        </div>}
        {deletedCount > 0 && <div>
          <span className="text-[var(--shell-muted)]">{t('git:statusSummary.deleted', { count: deletedCount })}</span>
        </div>}
      </div>}

      {/* Changed files */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-testid="git-scroll-region">
        {error && (
          <div className="px-3 py-2 text-[10px]" style={{ color: 'var(--shell-diff-del)' }}>
            {error}
          </div>
        )}

        {/* Staged files */}
        {stagedChanges.length > 0 && (
          <div>
            <div
              className={`px-3 py-1.5 text-[10px] font-semibold tracking-wider uppercase flex justify-between items-center ${styles.sectionHeader}`}
              style={{ color: 'var(--shell-dim)' }}
            >
              <span>{t('git:staged.title')}</span>
              <button
                onClick={handleUnstageAll}
                className="text-[10px] normal-case tracking-normal font-normal transition-colors hover:text-[var(--shell-accent)]"
                style={{ color: 'var(--shell-dim)' }}
              >
                {t('git:staged.unstageAll')}
              </button>
            </div>
            {groupFiles(stagedChanges).map((files) => (
              <div key={files[0].path} className={styles.fileGroup} style={{ containIntrinsicSize: `auto ${files.length * 32}px` }}>
                {files.map((file) => <GitFileItem key={file.path} file={file} onToggle={handleToggleStage} onOpen={handleOpenFile} onDiscard={setDiscardTarget} />)}
              </div>
            ))}
          </div>
        )}

        {/* Unstaged files */}
        {unstagedChanges.length > 0 && (
          <div>
            <div
              className={`px-3 py-1.5 text-[10px] font-semibold tracking-wider uppercase flex justify-between items-center ${styles.sectionHeader}`}
              style={{ color: 'var(--shell-dim)' }}
            >
              <span>{t('git:changes.title')}</span>
              <button
                onClick={handleStageAll}
                className="text-[10px] normal-case tracking-normal font-normal transition-colors hover:text-[var(--shell-accent)]"
                style={{ color: 'var(--shell-dim)' }}
              >
                {t('git:changes.stageAll')}
              </button>
            </div>
            {groupFiles(unstagedChanges).map((files) => (
              <div key={files[0].path} className={styles.fileGroup} style={{ containIntrinsicSize: `auto ${files.length * 32}px` }}>
                {files.map((file) => <GitFileItem key={file.path} file={file} onToggle={handleToggleStage} onOpen={handleOpenFile} onDiscard={setDiscardTarget} />)}
              </div>
            ))}
          </div>
        )}

        {status?.clean && (
          <div className="flex flex-col items-center justify-center py-8 gap-2 text-[var(--shell-dim)]">
            <div className="w-5 h-5 rounded-full border border-[var(--shell-border)] flex items-center justify-center text-[10px]">✓</div>
            <span>{t('git:clean')}</span>
          </div>
        )}

        {/* Commit history */}
        {commits.length > 0 && (
          <div>
            <div
              className={`px-3 py-1.5 text-[10px] font-semibold tracking-wider uppercase ${styles.sectionHeader}`}
              style={{ color: 'var(--shell-dim)' }}
            >
              {t('git:history.title')}
            </div>
            {commits.map((commit) => (
              <div
                key={commit.hash}
                tabIndex={0}
                onMouseEnter={(event) => schedulePreview(commit, event.currentTarget)}
                onMouseLeave={closePreview}
                onFocus={(event) => {
                  if (event.currentTarget.matches(':focus-visible')) schedulePreview(commit, event.currentTarget)
                }}
                onBlur={closePreview}
                onClick={() => { closePreview(); void handleToggleCommit(commit.hash) }}
                className={`relative px-3 py-2 transition-colors ${styles.commitRow}`}
              >
                <div
                  className="absolute left-3 top-3 w-1.5 h-1.5 rounded-full"
                  style={{ background: 'var(--shell-accent)' }}
                />
                <div className="min-w-0 pl-4">
                  <div className="text-[var(--shell-text)] truncate">{commit.message}</div>
                  <div className="flex gap-2 mt-0.5 text-[10px] text-[var(--shell-dim)]">
                    <span>{commit.shortHash}</span>
                    <span>{commit.author}</span>
                    <span>{formatDate(commit.date, t)}</span>
                  </div>
                </div>
                {expandedCommit === commit.hash && (
                  <div className={`mt-2 pt-1.5 pl-4 ${styles.previewDivider}`}>
                    {commitFilesLoading === commit.hash ? <div className="py-2 text-[10px] text-[var(--shell-dim)]">{t('git:history.loadingChanges')}</div> : (commitFiles[commit.hash] ?? []).map((file) => (
                      <div key={file.path} className="flex items-center gap-1.5 py-1 text-[10px]">
                        <span className="min-w-0 flex-1 truncate text-[var(--shell-muted)]">{file.path}</span>
                        {file.additions !== null && <span className="text-[var(--shell-diff-add)]">+{file.additions}</span>}
                        {file.deletions !== null && <span className="text-[var(--shell-diff-del)]">-{file.deletions}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {hoveredCommit && createPortal(
        <div
          role="tooltip"
          className={styles.commitPreview}
          style={{
            top: hoveredCommit.top,
            left: hoveredCommit.left,
          }}
        >
          <div className="font-medium leading-4 text-[var(--shell-text)] break-words">{hoveredCommit.commit.message}</div>
          <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-[var(--shell-muted)]">
            <span>{hoveredCommit.commit.shortHash}</span>
            <span>{hoveredCommit.commit.author}</span>
            <span>{new Date(hoveredCommit.commit.date).toLocaleString()}</span>
          </div>
          {commitFilesLoading === hoveredCommit.commit.hash && <div className="mt-2 text-[10px] text-[var(--shell-dim)]">{t('git:history.loadingChanges')}</div>}
          {commitFilesLoading !== hoveredCommit.commit.hash && commitFiles[hoveredCommit.commit.hash] && (() => {
            const files = commitFiles[hoveredCommit.commit.hash]
            const additions = files.reduce((sum, file) => sum + (file.additions ?? 0), 0)
            const deletions = files.reduce((sum, file) => sum + (file.deletions ?? 0), 0)
            return <>
              <div className={`mt-2 flex items-center gap-2 pt-2 text-[10px] ${styles.previewDivider}`}>
                <span className="text-[var(--shell-muted)]">{t('git:history.filesCount', { count: files.length })}</span>
                <span className="text-[var(--shell-diff-add)]">+{additions}</span>
                <span className="text-[var(--shell-diff-del)]">-{deletions}</span>
              </div>
              <div className="mt-1.5 space-y-0.5">
                {files.slice(0, 5).map((file) => <div key={file.path} className="truncate text-[10px] text-[var(--shell-muted)]">{file.path}</div>)}
                {files.length > 5 && <div className="text-[10px] text-[var(--shell-dim)]">{t('git:history.moreFiles', { count: files.length - 5 })}</div>}
              </div>
            </>
          })()}
          {!commitFiles[hoveredCommit.commit.hash] && commitFilesLoading !== hoveredCommit.commit.hash && <div className="mt-2 text-[10px] text-[var(--shell-dim)]">{t('git:history.previewHint')}</div>}
        </div>,
        document.body,
      )}

      {/* Commit input */}
      <div
        className="shrink-0 p-2"
        style={{ borderTop: '1px solid var(--border)' }}
      >
        <div className="flex gap-1.5">
          <input
            type="text"
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCommit()}
            placeholder={t('git:commit.placeholder')}
            className="flex-1 h-7 rounded px-2.5 text-xs transition-colors focus:outline-none focus:border-[var(--shell-accent-border)]"
            style={{
              background: 'color-mix(in srgb, var(--shell-text) 5%, transparent)',
              border: '1px solid var(--control-border)',
              color: 'var(--shell-text)',
            }}
          />
          <button
            onClick={handleCommit}
            disabled={!commitMsg.trim() || loading}
            className="px-3 h-7 rounded text-[11px] transition-colors disabled:opacity-30"
            style={{
              background: 'var(--shell-accent-soft)',
              border: '1px solid var(--shell-accent-border)',
              color: 'var(--shell-accent)',
            }}
          >
            {t('git:commit.button')}
          </button>
        </div>
        <div className="flex gap-1.5 mt-1.5">
          <button
            type="button"
            onClick={handlePush}
            disabled={loading}
            className="flex-1 h-7 rounded border border-[var(--shell-border)] bg-[color-mix(in_srgb,var(--shell-text)_5%,transparent)] text-[10px] font-medium text-[var(--shell-muted)] cursor-pointer transition-[background,border-color,color,box-shadow,transform] duration-150 hover:-translate-y-px hover:border-[var(--shell-accent-border)] hover:bg-[var(--shell-accent-soft)] hover:text-[var(--shell-accent)] hover:shadow-[0_0_0_1px_var(--shell-accent-soft)] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:translate-y-0 disabled:hover:border-[var(--shell-border)] disabled:hover:bg-[color-mix(in_srgb,var(--shell-text)_5%,transparent)] disabled:hover:text-[var(--shell-muted)] disabled:hover:shadow-none"
          >
            {t('git:remote.pushButton')}
          </button>
          <button
            type="button"
            onClick={handlePull}
            disabled={loading}
            className="flex-1 h-7 rounded border border-[var(--shell-border)] bg-[color-mix(in_srgb,var(--shell-text)_5%,transparent)] text-[10px] font-medium text-[var(--shell-muted)] cursor-pointer transition-[background,border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:border-[var(--shell-accent-border)] hover:bg-[var(--shell-accent-soft)] hover:text-[var(--shell-accent)] hover:shadow-[0_0_0_1px_var(--shell-accent-soft)] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:translate-y-0 disabled:hover:border-[var(--shell-border)] disabled:hover:bg-[color-mix(in_srgb,var(--shell-text)_5%,transparent)] disabled:hover:text-[var(--shell-muted)] disabled:hover:shadow-none"
          >
            {t('git:remote.pullButton')}
          </button>
        </div>
      </div>
    </div>
    {discardTarget && active && (
      <PromptDialog
        open
        title={t('git:discard.title')}
        description={t('git:discard.description', { path: discardTarget.path })}
        confirmText={t('git:discard.confirm')}
        cancelText={t('common:action.cancel')}
        onCancel={() => setDiscardTarget(null)}
        onConfirm={() => void handleDiscard()}
      />
    )}
    {active && remoteMeta && createPortal(
      <div
        className="fixed inset-0 flex items-center justify-center"
        style={{
          background: 'rgba(8, 8, 10, 0.62)',
          backdropFilter: 'blur(10px)',
          zIndex: 1000,
        }}
      >
        <div
          className={styles.confirmDialog}
          style={{
            width: 390,
          }}
        >
          <div
            className="flex justify-between items-center"
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <div
              className="font-semibold flex items-center"
              style={{ fontSize: 13, color: 'var(--shell-text)', gap: 6 }}
            >
              <span style={{ color: 'var(--shell-accent)' }}>{confirmAction === 'push' ? '↑' : '↓'}</span>
              {remoteMeta.title}
            </div>
            <ModalCloseButton onClose={() => setConfirmAction(null)} />
          </div>

          <div style={{ padding: '16px 16px 18px' }}>
            <div style={{ fontSize: 12, color: 'var(--shell-muted)', lineHeight: 1.6 }}>
              {remoteMeta.description}
            </div>
            <div
              className={styles.dialogInfoBox}
              style={{
                marginTop: 12,
                padding: '9px 10px',
                borderRadius: 5,
                fontSize: 11,
                color: 'var(--shell-dim)',
                lineHeight: 1.6,
              }}
            >
              <div>
                <span>{t('git:remote.branchLabel')} </span><strong style={{ color: 'var(--shell-text)', fontWeight: 600 }}>{branchName}</strong>
              </div>
              <div>
                <span>{t('git:remote.remoteLabel')} </span><strong style={{ color: 'var(--shell-text)', fontWeight: 600 }}>{upstreamName}</strong>
              </div>
            </div>
            <div
              className={styles.dialogHintBox}
              style={{
                marginTop: 12,
                padding: '8px 10px',
                borderRadius: 4,
                fontSize: 11,
                lineHeight: 1.5,
              }}
            >
              {remoteMeta.hint}
            </div>
          </div>

          <div
            className="flex justify-end"
            style={{
              padding: '10px 16px',
              borderTop: '1px solid var(--border)',
              gap: 8,
            }}
          >
            <button
              type="button"
              onClick={() => setConfirmAction(null)}
              className="rounded cursor-pointer transition-colors tbtn-ghost"
              style={{
                height: 28,
                padding: '0 14px',
                fontSize: 11,
                background: 'color-mix(in srgb, var(--shell-text) 5%, transparent)',
                border: '1px solid var(--control-border)',
                color: 'var(--shell-muted)',
              }}
            >
              {t('common:action.cancel')}
            </button>
            <button
              type="button"
              onClick={handleConfirmRemoteAction}
              disabled={loading}
              className="rounded cursor-pointer transition-colors disabled:cursor-not-allowed disabled:opacity-45 tbtn-accent"
              style={{
                height: 28,
                padding: '0 16px',
                fontSize: 11,
                background: 'var(--shell-accent-soft)',
                border: '1px solid var(--shell-accent-border)',
                color: 'var(--shell-accent)',
              }}
            >
              {loading ? t('git:remote.executing') : remoteMeta.actionLabel}
            </button>
          </div>
        </div>
      </div>,
      document.body,
    )}
    </>
  )
}

function groupFiles(files: GitFileChange[]): GitFileChange[][] {
  return Array.from({ length: Math.ceil(files.length / 16) }, (_, index) => files.slice(index * 16, (index + 1) * 16))
}

const GitFileItem = memo(function GitFileItem({ file, onToggle, onOpen, onDiscard }: { file: GitFileChange; onToggle: (file: GitFileChange) => void; onOpen: (file: GitFileChange) => void; onDiscard: (file: GitFileChange) => void }) {
  const { t } = useI18n('git')
  const statusColors: Record<string, { bg: string; fg: string }> = {
    M: { bg: 'rgba(229, 192, 123, 0.15)', fg: '#e5c07b' },
    A: { bg: 'rgba(78, 201, 176, 0.15)', fg: '#4ec9b0' },
    D: { bg: 'rgba(224, 108, 117, 0.15)', fg: '#e06c75' },
    R: { bg: 'rgba(198, 160, 246, 0.15)', fg: '#c6a0f6' },
    '??': { bg: 'rgba(136, 136, 136, 0.15)', fg: '#888' },
    UU: { bg: 'rgba(224, 108, 117, 0.15)', fg: '#e06c75' },
  }
  const colors = statusColors[file.status] ?? statusColors['??']

  return (
    <div
      className={`group flex items-center gap-2 px-3 py-1.5 transition-colors ${styles.fileRow}`}
    >
      <span
        className="w-4 h-4 rounded-sm flex items-center justify-center text-[9px] font-bold shrink-0"
        style={{ background: colors.bg, color: colors.fg }}
      >
        {file.status === '??' ? '?' : file.status}
      </span>
      <button type="button" onClick={() => onOpen(file)} className="flex-1 min-w-0 truncate text-left text-[var(--shell-muted)] hover:text-[var(--shell-text)]" title={file.path}>{file.path}</button>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <FileActionButton label={t('git:changes.open')} icon={<Eye size={13} />} onClick={() => onOpen(file)} />
        <FileActionButton label={file.staged ? t('git:changes.unstage') : t('git:changes.stage')} icon={file.staged ? <Minus size={13} /> : <Plus size={13} />} onClick={() => onToggle(file)} />
        <FileActionButton label={t('git:changes.discard')} icon={<RotateCcw size={13} />} onClick={() => onDiscard(file)} danger />
      </div>
      {file.staged && (
        <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--shell-diff-add)' }} />
      )}
    </div>
  )
}, (previous, next) => previous.onToggle === next.onToggle && previous.onOpen === next.onOpen &&
  previous.onDiscard === next.onDiscard && previous.file.path === next.file.path &&
  previous.file.status === next.file.status && previous.file.staged === next.file.staged &&
  previous.file.additions === next.file.additions && previous.file.deletions === next.file.deletions)

function FileActionButton({ label, icon, onClick, danger = false }: { label: string; icon: ReactNode; onClick: () => void; danger?: boolean }) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} className={`flex h-5 w-5 items-center justify-center rounded text-[var(--shell-dim)] hover:bg-[color-mix(in_srgb,var(--shell-text)_8%,transparent)] hover:text-[var(--shell-text)] ${danger ? 'hover:text-[var(--shell-diff-del)]' : ''}`}>{icon}</button>
}

function formatDate(dateStr: string, t: TFunction): string {
  try {
    const d = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return t('git:time.justNow')
    if (diffMins < 60) return t('git:time.minutesAgo', { count: diffMins })
    if (diffHours < 24) return t('git:time.hoursAgo', { count: diffHours })
    if (diffDays < 7) return t('git:time.daysAgo', { count: diffDays })
    return commitDateFormatter.format(d)
  } catch {
    return dateStr
  }
}
