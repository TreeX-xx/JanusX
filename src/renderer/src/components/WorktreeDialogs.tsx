import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useWorktreeStore } from '@/stores/worktree'
import { useWorkspaceStore } from '@/stores/workspace'
import { refreshScopeFileTree } from '@/features/workspace/actions'
import { useI18n } from '@/i18n/useI18n'
import { ModalCloseButton } from './ModalCloseButton'
import { ModalFrame } from './shared/ModalFrame'
import styles from './WorktreeDialogs.module.css'
import type { BranchDiff } from '../../../shared/ipc/worktree'
import type { FailedCheckLog, HostedCheck, HostedComment, HostedIssue, HostedReview } from '../../../shared/ipc/hosted'
import type { WorktreeInfo } from '../../../shared/ipc/worktree'
import type { Workspace } from '@/types'

function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-./]/g, '')
    .replace(/-+/g, '-')
    .replace(/^[./-]+|[./-]+$/g, '')
  return slug || 'worktree'
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--shell-canvas)',
  border: '1px solid var(--control-border)',
  borderRadius: 5,
  color: 'var(--shell-text)',
  fontSize: 12,
  padding: '7px 9px',
  outline: 'none',
  fontFamily: 'inherit',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  color: 'var(--shell-muted)',
  marginBottom: 5,
}

export function WorktreeComposer({ workspace, onClose }: { workspace: Workspace; onClose: () => void }) {
  const { t } = useI18n('terminal')
  const createWorktree = useWorktreeStore((s) => s.createWorktree)
  const [name, setName] = useState('')
  const [branch, setBranch] = useState('')
  const [branchTouched, setBranchTouched] = useState(false)
  const [startFrom, setStartFrom] = useState('origin/main')
  const [busy, setBusy] = useState(false)
  const [showIssues, setShowIssues] = useState(false)
  const [issueQuery, setIssueQuery] = useState('')
  const [issues, setIssues] = useState<HostedIssue[]>([])
  const [issuesBusy, setIssuesBusy] = useState(false)
  const [linkedIssue, setLinkedIssue] = useState<string | null>(null)

  // Provider pattern: submit closes immediately; progress, cancel, and retry
  // live on the sidebar row while creation runs in the background. The close
  // goes through the frame so it descends rather than cutting out.
  const submit = async (requestClose: () => void) => {
    if (!name.trim() || busy) return
    setBusy(true)
    const payload = {
      name: name.trim(),
      branch: branch.trim() || undefined,
      startFrom: startFrom.trim() || undefined,
      linkedIssue: linkedIssue ?? undefined,
    }
    requestClose()
    try {
      const result = await createWorktree(workspace.id, workspace.path, payload)
      if (useWorkspaceStore.getState().activeWorkspaceId === workspace.id) {
        await refreshScopeFileTree(result.path, true).catch(() => {})
      }
    } catch {
      // Failure lands on the sidebar progress row with retry.
    }
  }

  const searchIssues = async () => {
    setIssuesBusy(true)
    try {
      const results = await window.electron.hosted.listIssues(workspace.path, issueQuery.trim() || undefined)
      setIssues(results)
    } catch {
      setIssues([])
    } finally {
      setIssuesBusy(false)
    }
  }

  const applyIssue = (issue: HostedIssue) => {
    setName(issue.title)
    if (!branchTouched) setBranch(slugify(issue.title))
    setLinkedIssue(`#${issue.number}`)
    setShowIssues(false)
  }

  const title = t('terminal:worktree.composerTitle')

  return (
    <ModalFrame label={title} onClose={onClose} panelClassName={styles.composerPanel}>
      {({ requestClose }) => (
        <>
          <div
            className="flex justify-between items-center"
            style={{ padding: '12px 16px', borderBottom: '1px solid var(--control-border)' }}
          >
            <div className="font-semibold" style={{ fontSize: 13, color: 'var(--shell-text)' }}>
              {title}
            </div>
            <ModalCloseButton onClose={requestClose} />
          </div>
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={labelStyle}>{t('terminal:worktree.nameLabel')}</label>
              <input
                autoFocus
                value={name}
                placeholder={t('terminal:worktree.namePlaceholder')}
                onChange={(event) => {
                  setName(event.target.value)
                  if (!branchTouched) setBranch(slugify(event.target.value))
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void submit(requestClose)
                }}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>{t('terminal:worktree.branchLabel')}</label>
              <input
                value={branch}
                onChange={(event) => {
                  setBranch(event.target.value)
                  setBranchTouched(true)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void submit(requestClose)
                }}
                style={{ ...inputStyle, fontFamily: "'SF Mono', monospace" }}
              />
            </div>
            <div>
              <label style={labelStyle}>{t('terminal:worktree.startFromLabel')}</label>
              <input
                value={startFrom}
                onChange={(event) => setStartFrom(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void submit(requestClose)
                }}
                style={{ ...inputStyle, fontFamily: "'SF Mono', monospace" }}
              />
            </div>
            <div>
              <button
                type="button"
                onClick={() => {
                  const next = !showIssues
                  setShowIssues(next)
                  if (next && issues.length === 0 && !issuesBusy) void searchIssues()
                }}
                className="cursor-pointer"
                style={{ fontSize: 11, color: 'var(--shell-muted)', background: 'none', border: 'none', padding: 0 }}
              >
                {t('terminal:worktree.issueSection')}{linkedIssue ? ` · ${linkedIssue}` : ''} {showIssues ? '▴' : '▾'}
              </button>
              {linkedIssue && !showIssues && (
                <button
                  type="button"
                  onClick={() => setLinkedIssue(null)}
                  className="cursor-pointer"
                  style={{ fontSize: 10, color: 'var(--shell-dim)', background: 'none', border: 'none', padding: 0, marginLeft: 8 }}
                >
                  ✕
                </button>
              )}
              {showIssues && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div className="flex" style={{ gap: 6 }}>
                    <input
                      value={issueQuery}
                      placeholder={t('terminal:worktree.issueSearchPh')}
                      onChange={(event) => setIssueQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void searchIssues()
                      }}
                      style={{ ...inputStyle, flex: 1, minWidth: 0, fontSize: 11 }}
                    />
                    <button
                      type="button"
                      onClick={() => void searchIssues()}
                      disabled={issuesBusy}
                      className="rounded cursor-pointer"
                      style={{ height: 30, padding: '0 12px', fontSize: 11, border: '1px solid var(--control-border)', background: 'transparent', color: 'var(--shell-text)', flexShrink: 0 }}
                    >
                      {t('terminal:worktree.issueSearch')}
                    </button>
                  </div>
                  {issues.map((issue) => (
                    <div key={issue.number} className="flex items-center" style={{ gap: 8, fontSize: 11 }}>
                      <span style={{ fontFamily: "'SF Mono', monospace", color: 'var(--shell-dim)', flexShrink: 0 }}>
                        #{issue.number}
                      </span>
                      <span className="flex-1 min-w-0 overflow-hidden overflow-ellipsis whitespace-nowrap" style={{ color: 'var(--shell-text)' }}>
                        {issue.title}
                      </span>
                      <button
                        type="button"
                        onClick={() => applyIssue(issue)}
                        className="cursor-pointer"
                        style={{ fontSize: 10, color: 'var(--shell-muted)', background: 'none', border: 'none', padding: 0, flexShrink: 0 }}
                      >
                        {t('terminal:worktree.issueUse')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div
            className="flex justify-end"
            style={{ padding: '12px 16px', borderTop: '1px solid var(--control-border)', gap: 8 }}
          >
            <button
              onClick={requestClose}
              className="rounded cursor-pointer"
              style={{ height: 28, padding: '0 16px', fontSize: 11, border: '1px solid var(--control-border)', background: 'color-mix(in srgb, var(--surface-tint) 3%, transparent)', color: 'var(--shell-muted)' }}
            >
              {t('terminal:worktree.cancel')}
            </button>
            <button
              onClick={() => void submit(requestClose)}
              disabled={!name.trim() || busy}
              className="rounded cursor-pointer"
              style={{ height: 28, padding: '0 16px', fontSize: 11, border: '1px solid var(--control-border)', background: 'transparent', color: 'var(--shell-text)', opacity: !name.trim() || busy ? 0.45 : 1 }}
            >
              {t('terminal:worktree.create')}
            </button>
          </div>
        </>
      )}
    </ModalFrame>
  )
}

export function WorktreeDeleteDialog({  workspaceId,
  workspacePath,
  worktree,
  onClose,
}: {
  workspaceId: string
  workspacePath: string
  worktree: WorktreeInfo
  onClose: (branchKept?: string) => void
}) {
  const { t } = useI18n('terminal')
  const deleteWorktree = useWorktreeStore((s) => s.deleteWorktree)
  const [status, setStatus] = useState<{ branch: string | null; dirty: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    window.electron.worktree
      .status(worktree.path)
      .then((result) => {
        if (alive) setStatus(result)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [worktree.path])

  const runDelete = async (force: boolean) => {
    setBusy(true)
    setError(null)
    try {
      const wasActive = (useWorktreeStore.getState().activePaths[workspaceId] ?? workspacePath) === worktree.path
      const result = await deleteWorktree(workspaceId, workspacePath, worktree.path, force, worktree.branch)
      if (wasActive && useWorkspaceStore.getState().activeWorkspaceId === workspaceId) {
        const scopePath = useWorktreeStore.getState().activePaths[workspaceId] ?? workspacePath
        await refreshScopeFileTree(scopePath, true).catch(() => {})
      }
      onClose(result.branchKept)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'var(--modal-backdrop)', backdropFilter: 'blur(10px)', zIndex: 1000 }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <div
        className="overflow-hidden"
        style={{ width: 420, background: 'var(--shell-chrome)', border: '1px solid var(--shell-border)', borderRadius: 8 }}
      >
        <div
          className="flex justify-between items-center"
          style={{ padding: '12px 16px', borderBottom: '1px solid var(--control-border)' }}
        >
          <div className="font-semibold" style={{ fontSize: 13, color: 'var(--shell-text)' }}>
            {t('terminal:worktree.deleteTitle')}
          </div>
          <ModalCloseButton onClose={() => { if (!busy) onClose() }} />
        </div>
        <div style={{ padding: 16, fontSize: 12, color: 'var(--shell-muted)', lineHeight: 1.6 }}>
          {t('terminal:worktree.deleteBody')}
          <div style={{ marginTop: 8, fontFamily: "'SF Mono', monospace", fontSize: 11, color: 'var(--shell-muted)' }}>
            {worktree.path}
            {status?.branch ? ` · ${status.branch}` : ''}
          </div>
          {status?.dirty && (
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--shell-accent)', lineHeight: 1.6 }}>
              {t('terminal:worktree.dirtyWarn')}
            </div>
          )}
          {error && <div style={{ marginTop: 8, fontSize: 11, color: 'var(--shell-diff-del)', lineHeight: 1.6 }}>{error}</div>}
        </div>
        <div
          className="flex justify-end"
          style={{ padding: '12px 16px', borderTop: '1px solid var(--control-border)', gap: 8 }}
        >
          <button
            onClick={() => onClose()}
            disabled={busy}
            className="rounded cursor-pointer"
            style={{ height: 28, padding: '0 16px', fontSize: 11, border: '1px solid var(--control-border)', background: 'color-mix(in srgb, var(--surface-tint) 3%, transparent)', color: 'var(--shell-muted)' }}
          >
            {t('terminal:worktree.cancel')}
          </button>
          {(!status || status.dirty) && (
            <button
              onClick={() => void runDelete(true)}
              disabled={busy}
              className="rounded cursor-pointer"
              style={{ height: 28, padding: '0 16px', fontSize: 11, border: '1px solid color-mix(in srgb, var(--shell-diff-del) 35%, transparent)', background: 'transparent', color: 'var(--shell-diff-del)' }}
            >
              {t('terminal:worktree.forceDelete')}
            </button>
          )}
          <button
            onClick={() => void runDelete(false)}
            disabled={busy || (status?.dirty ?? false)}
            className="rounded cursor-pointer"
            style={{ height: 28, padding: '0 16px', fontSize: 11, border: '1px solid var(--control-border)', background: 'transparent', color: 'var(--shell-text)', opacity: busy || status?.dirty ? 0.45 : 1 }}
          >
            {t('terminal:worktree.deleteConfirm')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

type ShipPhase = 'loading' | 'ready' | 'committing' | 'merging' | 'done' | 'conflict'

/**
 * Local Ship: review the branch diff, commit worktree leftovers, merge
 * into the base, optionally push, then delete the worktree. Hosted reviews
 * arrive with the provider phase; this dialog never opens a PR.
 */
export function WorktreeShipDialog({
  workspaceId,
  workspacePath,
  worktree,
  onClose,
}: {
  workspaceId: string
  workspacePath: string
  worktree: WorktreeInfo
  onClose: () => void
}) {
  const { t } = useI18n('terminal')
  const deleteWorktree = useWorktreeStore((s) => s.deleteWorktree)
  const [base, setBase] = useState(worktree.startFrom ?? 'origin/main')
  const branch = worktree.branch ?? ''
  const [phase, setPhase] = useState<ShipPhase>('loading')
  const [diff, setDiff] = useState<BranchDiff | null>(null)
  const [worktreeDirty, setWorktreeDirty] = useState(false)
  const [mainDirty, setMainDirty] = useState(false)
  const [commitMessage, setCommitMessage] = useState('')
  const [pushBase, setPushBase] = useState(true)
  const [conflicts, setConflicts] = useState<string[]>([])
  const [upToDate, setUpToDate] = useState(false)
  const [pushError, setPushError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [branchDiff, wtStatus, mainStatus] = await Promise.all([
          window.electron.worktree.shipDiff(workspacePath, base, branch),
          window.electron.worktree.status(worktree.path),
          window.electron.git.status(workspacePath),
        ])
        if (!alive) return
        setDiff(branchDiff)
        setWorktreeDirty(wtStatus.dirty)
        setMainDirty(!mainStatus.clean)
        setPhase('ready')
      } catch (err) {
        if (!alive) return
        setError(err instanceof Error ? err.message : String(err))
        setPhase('ready')
      }
    })()
    return () => {
      alive = false
    }
  }, [workspacePath, worktree.path, base, branch])

  const runCommit = async () => {
    if (!commitMessage.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const status = await window.electron.git.status(worktree.path)
      const paths = status.changes.map((change) => change.path)
      if (paths.length > 0) await window.electron.git.stage(worktree.path, paths)
      await window.electron.git.commit(worktree.path, commitMessage.trim())
      const fresh = await window.electron.worktree.status(worktree.path)
      setWorktreeDirty(fresh.dirty)
      setCommitMessage('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const runMerge = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    setPushError(null)
    try {
      const result = await window.electron.worktree.shipMerge(workspacePath, branch)
      if (!result.merged) {
        setConflicts(result.conflicts)
        setPhase('conflict')
        return
      }
      setUpToDate(result.upToDate)
      if (pushBase) {
        try {
          await window.electron.git.push(workspacePath)
        } catch (err) {
          // The merge stands; pushing stays a manual retry.
          setPushError(err instanceof Error ? err.message : String(err))
        }
      }
      setPhase('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const runAbort = async () => {
    setBusy(true)
    try {
      await window.electron.worktree.shipAbort(workspacePath)
      setConflicts([])
      setPhase('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const runDeleteAfterShip = async () => {
    setBusy(true)
    try {
      const wasActive = (useWorktreeStore.getState().activePaths[workspaceId] ?? workspacePath) === worktree.path
      await deleteWorktree(workspaceId, workspacePath, worktree.path, false, worktree.branch)
      if (wasActive && useWorkspaceStore.getState().activeWorkspaceId === workspaceId) {
        const scopePath = useWorktreeStore.getState().activePaths[workspaceId] ?? workspacePath
        await refreshScopeFileTree(scopePath, true).catch(() => {})
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  const canMerge = phase === 'ready' && !worktreeDirty && !mainDirty && !busy && branch.length > 0

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'var(--modal-backdrop)', backdropFilter: 'blur(10px)', zIndex: 1000 }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <div
        className="overflow-hidden"
        style={{ width: 480, background: 'var(--shell-chrome)', border: '1px solid var(--shell-border)', borderRadius: 8 }}
      >
        <div
          className="flex justify-between items-center"
          style={{ padding: '12px 16px', borderBottom: '1px solid var(--control-border)' }}
        >
          <div className="font-semibold" style={{ fontSize: 13, color: 'var(--shell-text)' }}>
            {t('terminal:worktree.shipTitle')}
          </div>
          <ModalCloseButton onClose={() => { if (!busy) onClose() }} />
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 460, overflowY: 'auto' }}>
          <div className="flex items-center" style={{ gap: 8 }}>
            <span style={{ fontFamily: "'SF Mono', monospace", fontSize: 11, color: 'var(--shell-muted)' }}>
              {branch} →
            </span>
            <input
              value={base}
              onChange={(event) => setBase(event.target.value)}
              disabled={phase === 'done' || phase === 'conflict' || busy}
              style={{ ...inputStyle, flex: 1, minWidth: 0, fontFamily: "'SF Mono', monospace", fontSize: 11, padding: '5px 8px' }}
            />
          </div>

          {phase === 'loading' && (
            <div style={{ fontSize: 12, color: 'var(--shell-dim)' }}>{t('terminal:agentSession.loading')}</div>
          )}

          {diff && diff.files.length === 0 && phase !== 'loading' && (
            <div style={{ fontSize: 12, color: 'var(--shell-muted)' }}>{t('terminal:worktree.shipDiffEmpty', { base })}</div>
          )}

          {diff && diff.files.length > 0 && (
            <div>
              <div style={{ fontFamily: "'SF Mono', monospace", fontSize: 11, color: 'var(--shell-muted)', marginBottom: 6 }}>
                {diff.files.length} files · <span style={{ color: 'var(--shell-diff-add)' }}>+{diff.additions}</span>{' '}
                <span style={{ color: 'var(--shell-diff-del)' }}>−{diff.deletions}</span>
              </div>
              <div style={{ fontFamily: "'SF Mono', monospace", fontSize: 10.5, color: 'var(--shell-dim)', lineHeight: 1.8 }}>
                {diff.files.map((file) => (
                  <div key={file.path}>
                    {file.path}{' '}
                    {(file.additions ?? 0) > 0 && <span style={{ color: 'var(--shell-diff-add)' }}>+{file.additions} </span>}
                    {(file.deletions ?? 0) > 0 && <span style={{ color: 'var(--shell-diff-del)' }}>−{file.deletions}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {mainDirty && phase !== 'done' && (
            <div style={{ fontSize: 11, color: 'var(--shell-accent)', lineHeight: 1.6 }}>
              {t('terminal:worktree.mainDirtyBlock')}
            </div>
          )}

          {worktreeDirty && phase !== 'done' && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--shell-accent)', lineHeight: 1.6, marginBottom: 6 }}>
                {t('terminal:worktree.worktreeDirtyNote')}
              </div>
              <label style={{ display: 'block', fontSize: 11, color: 'var(--shell-muted)', marginBottom: 5 }}>
                {t('terminal:worktree.commitMessage')}
              </label>
              <div className="flex" style={{ gap: 6 }}>
                <input
                  value={commitMessage}
                  onChange={(event) => setCommitMessage(event.target.value)}
                  style={{ ...inputStyle, flex: 1, minWidth: 0 }}
                />
                <button
                  onClick={() => void runCommit()}
                  disabled={!commitMessage.trim() || busy}
                  className="rounded cursor-pointer"
                  style={{ height: 30, padding: '0 14px', fontSize: 11, border: '1px solid var(--control-border)', background: 'transparent', color: 'var(--shell-text)', opacity: !commitMessage.trim() || busy ? 0.45 : 1, flexShrink: 0 }}
                >
                  {t('terminal:worktree.commitRun')}
                </button>
              </div>
            </div>
          )}

          {phase === 'conflict' && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--shell-diff-del)', lineHeight: 1.6, marginBottom: 6 }}>
                {t('terminal:worktree.conflictsNote')}
              </div>
              <div style={{ fontFamily: "'SF Mono', monospace", fontSize: 10.5, color: 'var(--shell-muted)', lineHeight: 1.8 }}>
                {conflicts.map((file) => (
                  <div key={file}>{file}</div>
                ))}
              </div>
            </div>
          )}

          {phase === 'done' && (
            <div style={{ fontSize: 12, color: 'var(--shell-diff-add)', lineHeight: 1.6 }}>
              {upToDate ? t('terminal:worktree.upToDateNote') : t('terminal:worktree.mergedOk')}
            </div>
          )}

          {pushError && (
            <div style={{ fontSize: 11, color: 'var(--shell-diff-del)', lineHeight: 1.6 }}>{pushError}</div>
          )}
          {error && (
            <div style={{ fontSize: 11, color: 'var(--shell-diff-del)', lineHeight: 1.6 }}>{error}</div>
          )}

          {phase !== 'done' && phase !== 'conflict' && (
            <label className="flex items-center" style={{ gap: 7, fontSize: 11, color: 'var(--shell-muted)', cursor: 'pointer' }}>
              <input type="checkbox" checked={pushBase} onChange={(event) => setPushBase(event.target.checked)} />
              {t('terminal:worktree.pushBase')}
            </label>
          )}

          <HostedReviewSection
            workspacePath={workspacePath}
            worktreePath={worktree.path}
            branch={branch}
            base={base}
          />
        </div>
        <div
          className="flex justify-end"
          style={{ padding: '12px 16px', borderTop: '1px solid var(--control-border)', gap: 8 }}
        >
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded cursor-pointer"
            style={{ height: 28, padding: '0 16px', fontSize: 11, border: '1px solid var(--control-border)', background: 'color-mix(in srgb, var(--surface-tint) 3%, transparent)', color: 'var(--shell-muted)' }}
          >
            {t('terminal:worktree.cancel')}
          </button>
          {phase === 'conflict' ? (
            <button
              onClick={() => void runAbort()}
              disabled={busy}
              className="rounded cursor-pointer"
              style={{ height: 28, padding: '0 16px', fontSize: 11, border: '1px solid var(--control-border)', background: 'transparent', color: 'var(--shell-text)' }}
            >
              {t('terminal:worktree.abortMerge')}
            </button>
          ) : phase === 'done' ? (
            <button
              onClick={() => void runDeleteAfterShip()}
              disabled={busy}
              className="rounded cursor-pointer"
              style={{ height: 28, padding: '0 16px', fontSize: 11, border: '1px solid var(--control-border)', background: 'transparent', color: 'var(--shell-text)' }}
            >
              {t('terminal:worktree.deleteAfterShip')}
            </button>
          ) : (
            <button
              onClick={() => void runMerge()}
              disabled={!canMerge}
              className="rounded cursor-pointer"
              style={{ height: 28, padding: '0 16px', fontSize: 11, border: '1px solid var(--control-border)', background: 'transparent', color: 'var(--shell-text)', opacity: canMerge ? 1 : 0.45 }}
            >
              {busy ? t('terminal:worktree.merging') : t('terminal:worktree.doMerge', { base })}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function reviewStateLabel(state: HostedReview['state'], t: (k: string) => string): string {
  if (state === 'draft') return t('terminal:worktree.prDraft')
  if (state === 'merged') return t('terminal:worktree.prMerged')
  if (state === 'closed') return t('terminal:worktree.prClosed')
  return t('terminal:worktree.prOpen')
}

function checkStateLabel(state: HostedCheck['state'], t: (k: string) => string): string {
  if (state === 'pass') return t('terminal:worktree.checksPass')
  if (state === 'fail') return t('terminal:worktree.checksFail')
  if (state === 'skipped') return t('terminal:worktree.checksSkipped')
  return t('terminal:worktree.checksPending')
}

function checkStateColor(state: HostedCheck['state']): string {
  if (state === 'pass') return 'var(--shell-diff-add)'
  if (state === 'fail') return 'var(--shell-diff-del)'
  return 'var(--shell-dim)'
}

function buildFixPrompt(kind: 'PR' | 'MR', review: HostedReview, logs: FailedCheckLog[]): string {
  const lines = [
    `修复 ${kind} #${review.number}「${review.title}」（${review.head} → ${review.base}）的失败检查：`,
    ...logs.flatMap((entry) => ['', `## ${entry.name}${entry.truncated ? '（日志已截断取尾部）' : ''}`, entry.log]),
    '',
    '要求：只修失败相关的代码，保持其他行为不变；跑通相关测试后推送。',
  ]
  return lines.join('\n')
}

/**
 * Hosted review surface inside Ship. Renders nothing when the checkout
 * has no provider (local-only work keeps zero hosted chrome).
 */
function HostedReviewSection({
  workspacePath,
  worktreePath,
  branch,
  base,
}: {
  workspacePath: string
  worktreePath: string
  branch: string
  base: string
}) {
  const { t } = useI18n('terminal')
  const [provider, setProvider] = useState<'github' | 'gitlab' | null | 'unknown'>('unknown')
  const [reviews, setReviews] = useState<HostedReview[]>([])
  const [checks, setChecks] = useState<HostedCheck[]>([])
  const [logs, setLogs] = useState<FailedCheckLog[] | null>(null)
  const [comments, setComments] = useState<HostedComment[] | null>(null)
  const [commentDraft, setCommentDraft] = useState('')
  const [autoMerge, setAutoMerge] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [title, setTitle] = useState(branch)
  const [body, setBody] = useState('')
  const [draft, setDraft] = useState(true)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [detected, reviewList, checkList] = await Promise.all([
      window.electron.hosted.detect(workspacePath),
      window.electron.hosted.listReviews(workspacePath, branch).catch(() => []),
      window.electron.hosted.checks(workspacePath, branch).catch(() => []),
    ])
    return { detected, reviewList, checkList }
  }, [workspacePath, branch])

  useEffect(() => {
    let alive = true
    void refresh()
      .then(({ detected, reviewList, checkList }) => {
        if (!alive) return
        setProvider(detected)
        setReviews(reviewList)
        setChecks(checkList)
      })
      .catch(() => {
        if (alive) setProvider(null)
      })
    return () => {
      alive = false
    }
  }, [refresh])

  const reload = useCallback(async () => {
    setError(null)
    try {
      const { reviewList, checkList } = await refresh()
      setReviews(reviewList)
      setChecks(checkList)
      setLogs(null)
      setComments(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [refresh])

  if (provider !== 'github' && provider !== 'gitlab') return null

  const open = reviews.find((r) => r.head === branch && (r.state === 'open' || r.state === 'draft')) ?? null
  const failing = checks.filter((c) => c.state === 'fail')

  const runCreate = async () => {
    if (!title.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await window.electron.hosted.createReview({
        workspacePath,
        title: title.trim(),
        body: body.trim() || undefined,
        base,
        head: branch,
        draft,
        worktreePath,
      })
      setShowCreate(false)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const runMergePr = async () => {
    if (!open || busy) return
    setBusy(true)
    setError(null)
    try {
      await window.electron.hosted.mergeReview(workspacePath, open.number, 'squash')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const runViewLogs = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await window.electron.hosted.failedLogs(workspacePath, branch)
      setLogs(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const runLoadComments = async () => {
    if (!open || comments) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.electron.hosted.listComments(workspacePath, open.number)
      setComments(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const runPostComment = async () => {
    if (!open || !commentDraft.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await window.electron.hosted.postComment(workspacePath, open.number, commentDraft.trim())
      setCommentDraft('')
      const result = await window.electron.hosted.listComments(workspacePath, open.number)
      setComments(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const runAutoMerge = async () => {
    if (!open || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.electron.hosted.setAutoMerge(workspacePath, open.number, !autoMerge)
      setAutoMerge(result.autoMerge)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const runCopyFix = async () => {
    if (!open) return
    let entries = logs
    if (!entries) {
      try {
        entries = await window.electron.hosted.failedLogs(workspacePath, branch)
        setLogs(entries)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        return
      }
    }
    try {
      await navigator.clipboard.writeText(buildFixPrompt(provider === 'gitlab' ? 'MR' : 'PR', open, entries))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('clipboard unavailable')
    }
  }

  return (
    <div style={{ borderTop: '1px solid var(--control-border)', paddingTop: 10 }}>
      <div className="flex items-center" style={{ gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--shell-muted)' }}>
          {t('terminal:worktree.prSection')}
        </span>
        <button
          onClick={() => void reload()}
          className="cursor-pointer"
          style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--shell-dim)', background: 'none', border: 'none', padding: 0 }}
        >
          {t('terminal:worktree.checksRefresh')}
        </button>
      </div>

      {!open && !showCreate && (
            <button
              onClick={() => {
                setTitle(branch)
                setShowCreate(true)
              }}
              className="rounded cursor-pointer"
              style={{ height: 26, padding: '0 14px', fontSize: 11, border: '1px solid var(--control-border)', background: 'transparent', color: 'var(--shell-text)' }}
            >
              {provider === 'gitlab' ? t('terminal:worktree.mrCreate') : t('terminal:worktree.prCreate')}
            </button>
      )}

      {showCreate && !open && (
        <div className="flex flex-col" style={{ gap: 8 }}>
          <input
            value={title}
            placeholder={t('terminal:worktree.prTitlePh')}
            onChange={(event) => setTitle(event.target.value)}
            style={{ ...inputStyle, fontSize: 11 }}
          />
          <input
            value={body}
            placeholder={t('terminal:worktree.prBodyPh')}
            onChange={(event) => setBody(event.target.value)}
            style={{ ...inputStyle, fontSize: 11 }}
          />
          <div className="flex items-center" style={{ gap: 8 }}>
            <label className="flex items-center" style={{ gap: 6, fontSize: 11, color: 'var(--shell-muted)', cursor: 'pointer' }}>
              <input type="checkbox" checked={draft} onChange={(event) => setDraft(event.target.checked)} />
              {t('terminal:worktree.draftPr')}
            </label>
            <button
              onClick={() => void runCreate()}
              disabled={!title.trim() || busy}
              className="rounded cursor-pointer"
              style={{ height: 26, padding: '0 14px', fontSize: 11, border: '1px solid var(--control-border)', background: 'transparent', color: 'var(--shell-text)', opacity: !title.trim() || busy ? 0.45 : 1, marginLeft: 'auto' }}
            >
              {provider === 'gitlab' ? t('terminal:worktree.mrCreate') : t('terminal:worktree.prCreate')}
            </button>
          </div>
        </div>
      )}

      {open && (
        <div className="flex flex-col" style={{ gap: 8 }}>
          <div className="flex items-center" style={{ gap: 7, fontSize: 11.5, color: 'var(--shell-text)' }}>
            <span style={{ color: 'var(--status-info)' }}>#{open.number}</span>
            <span className="flex-1 min-w-0 overflow-hidden overflow-ellipsis whitespace-nowrap">{open.title}</span>
            <span style={{ fontSize: 10, color: 'var(--shell-dim)' }}>{reviewStateLabel(open.state, t)}</span>
          </div>
          <div>
            <div style={{ fontSize: 10.5, color: 'var(--shell-dim)', marginBottom: 4 }}>
              {t('terminal:worktree.checksTitle')}
            </div>
            {checks.length === 0 && (
              <div style={{ fontSize: 10.5, color: 'var(--shell-dim)' }}>{t('terminal:worktree.checksEmpty')}</div>
            )}
            {checks.map((check) => (
              <div key={check.name} className="flex items-center" style={{ gap: 7, fontSize: 10.5, color: 'var(--shell-muted)', lineHeight: 1.9 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: checkStateColor(check.state), flexShrink: 0 }} />
                <span className="flex-1 min-w-0 overflow-hidden overflow-ellipsis whitespace-nowrap">{check.name}</span>
                <span style={{ color: checkStateColor(check.state) }}>{checkStateLabel(check.state, t)}</span>
              </div>
            ))}
          </div>
          <div>
            <button
              type="button"
              onClick={() => void runLoadComments()}
              className="cursor-pointer"
              style={{ fontSize: 10.5, color: 'var(--shell-dim)', background: 'none', border: 'none', padding: 0, marginBottom: comments ? 6 : 0 }}
            >
              {t('terminal:worktree.commentsTitle')}{comments ? ` · ${comments.length}` : ''}
            </button>
            {comments && (
              <div className="flex flex-col" style={{ gap: 6, marginBottom: 6 }}>
                {comments.map((comment) => (
                  <div key={comment.id} style={{ fontSize: 10.5, lineHeight: 1.6 }}>
                    <span style={{ color: 'var(--shell-muted)' }}>{comment.author || '?'}</span>
                    {comment.path && (
                      <span style={{ fontFamily: "'SF Mono', monospace", color: 'var(--shell-dim)' }}>
                        {' '}· {comment.path}{typeof comment.line === 'number' ? `:${comment.line}` : ''}
                      </span>
                    )}
                    <div style={{ color: 'var(--shell-text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{comment.body}</div>
                  </div>
                ))}
                <div className="flex" style={{ gap: 6 }}>
                  <input
                    value={commentDraft}
                    placeholder={t('terminal:worktree.commentPh')}
                    onChange={(event) => setCommentDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void runPostComment()
                    }}
                    style={{ ...inputStyle, flex: 1, minWidth: 0, fontSize: 11 }}
                  />
                  <button
                    type="button"
                    onClick={() => void runPostComment()}
                    disabled={!commentDraft.trim() || busy}
                    className="rounded cursor-pointer"
                    style={{ height: 28, padding: '0 12px', fontSize: 10, border: '1px solid var(--control-border)', background: 'transparent', color: 'var(--shell-text)', flexShrink: 0 }}
                  >
                    {t('terminal:worktree.commentSend')}
                  </button>
                </div>
              </div>
            )}
          </div>
          <div>
            <button
              type="button"
              onClick={() => void runAutoMerge()}
              disabled={busy}
              className="cursor-pointer"
              style={{ fontSize: 10.5, color: autoMerge ? 'var(--shell-diff-add)' : 'var(--shell-dim)', background: 'none', border: 'none', padding: 0 }}
            >
              {autoMerge ? t('terminal:worktree.autoMergeOff') : t('terminal:worktree.autoMergeOn')}
            </button>
          </div>
          {logs && logs.map((entry) => (
            <div key={entry.name} style={{ background: 'var(--shell-canvas)', border: '1px solid var(--control-border)', borderRadius: 5, padding: '7px 9px' }}>
              <div style={{ fontFamily: "'SF Mono', monospace", fontSize: 10, color: 'var(--shell-muted)', marginBottom: 4 }}>
                {entry.name}{entry.truncated ? ' · truncated' : ''}
              </div>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontFamily: "'SF Mono', monospace", fontSize: 10, color: 'var(--shell-dim)', maxHeight: 140, overflowY: 'auto' }}>
                {entry.log}
              </pre>
            </div>
          ))}
          <div className="flex" style={{ gap: 6 }}>
            {failing.length > 0 && (
              <>
                <button
                  onClick={() => void runViewLogs()}
                  disabled={busy}
                  className="flex-1 rounded cursor-pointer"
                  style={{ height: 24, fontSize: 10, border: '1px solid var(--control-border)', background: 'transparent', color: 'var(--shell-muted)' }}
                >
                  {t('terminal:worktree.viewLogs')}
                </button>
                <button
                  onClick={() => void runCopyFix()}
                  disabled={busy}
                  className="flex-1 rounded cursor-pointer"
                  style={{ height: 24, fontSize: 10, border: '1px solid var(--control-border)', background: 'transparent', color: 'var(--shell-text)' }}
                >
                  {copied ? t('terminal:worktree.copied') : t('terminal:worktree.copyFix')}
                </button>
              </>
            )}
            {open.state === 'open' && (
              <button
                onClick={() => void runMergePr()}
                disabled={busy}
                className="flex-1 rounded cursor-pointer"
                style={{ height: 24, fontSize: 10, border: '1px solid var(--control-border)', background: 'transparent', color: 'var(--shell-text)' }}
              >
                {t('terminal:worktree.mergePr')}
              </button>
            )}
          </div>
        </div>
      )}

      {error && <div style={{ fontSize: 11, color: 'var(--shell-diff-del)', lineHeight: 1.6 }}>{error}</div>}
    </div>
  )
}
