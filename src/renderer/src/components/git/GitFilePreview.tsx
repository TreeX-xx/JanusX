import { useContext, useEffect, useState, type ReactNode } from 'react'
import type { GitCommitChange, GitDiff, GitFileChange } from '../../../../shared/ipc/git'
import { useI18n } from '@/i18n/useI18n'
import { ThemedTooltip } from '../ui/ThemedTooltip'
import { ViewerActive } from '../viewers/ViewerToolbar'
import styles from '../GitPanel.module.css'

type PreviewFile = GitFileChange | GitCommitChange

export function GitFileStats({ file }: { file: Pick<PreviewFile, 'additions' | 'deletions'> }) {
  const { t } = useI18n('git')
  return <span className={styles.fileStats} data-testid="git-file-stats" aria-label={t('filePreview.stats', { additions: file.additions ?? '—', deletions: file.deletions ?? '—' })}>
    <span className={file.additions === null ? styles.count : styles.add}>+{file.additions ?? '—'}</span>
    <span className={file.deletions === null ? styles.count : styles.del}>−{file.deletions ?? '—'}</span>
  </span>
}

export function GitFilePreview({ cwd, file, commit, enabled = true, children }: {
  cwd: string; file: PreviewFile; commit?: string; enabled?: boolean; children: ReactNode
}) {
  const active = useContext(ViewerActive)
  return <ThemedTooltip placement="left" variant="panel" disabled={!active || !enabled}
    label={<FilePreviewContent cwd={cwd} file={file} commit={commit} />}>
    {children}
  </ThemedTooltip>
}

// Mounted only while the tooltip is open: no per-file IPC or stale worktree cache.
function FilePreviewContent({ cwd, file, commit }: { cwd: string; file: PreviewFile; commit?: string }) {
  const { t } = useI18n('git')
  const [diff, setDiff] = useState<GitDiff | null>(null)
  const [failed, setFailed] = useState(false)
  const staged = 'staged' in file && file.staged
  useEffect(() => {
    let cancelled = false
    setDiff(null); setFailed(false)
    const request = commit ? window.electron.git.commitFileDiff(cwd, commit, file.path) : window.electron.git.diff(cwd, file.path, staged)
    void request.then(value => { if (!cancelled) setDiff(value) }, () => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [cwd, commit, file.path, staged, file.additions, file.deletions])
  const lines = diff?.content.trimEnd().split('\n') ?? []
  const hunk = lines.findIndex(line => line.startsWith('@@'))
  const excerpt = hunk >= 0 ? lines.slice(hunk) : []
  const binary = lines.some(line => line.startsWith('Binary files ') || line === 'GIT binary patch')
  const truncated = diff?.truncated || excerpt.length > 10 || excerpt.slice(0, 10).some(line => line.length > 160)
  return <div className={styles.filePreview} data-testid="git-file-preview">
    <strong className={styles.filePreviewPath}>{file.path}</strong>
    <div className={styles.filePreviewMeta}>
      <span>{t(`filePreview.status.${file.status}`)} · {commit ? commit.slice(0, 7) : t(staged ? 'staged.title' : 'changes.title')}</span>
      <GitFileStats file={file} />
    </div>
    <div className={styles.filePreviewContent}>
      {failed ? <p>{t('filePreview.failed')}</p> : !diff ? <p>{t('filePreview.loading')}</p>
        : binary ? <p>{t('filePreview.binary')}</p>
          : !excerpt.length ? <p>{t('changes.noDiff')}</p>
            : <pre className={styles.patch}>{excerpt.slice(0, 10).map((line, index) => <div key={index} data-line={line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : line.startsWith('@@') ? 'hunk' : undefined}>{line.slice(0, 160) || ' '}</div>)}</pre>}
    </div>
    {truncated && <p className={styles.filePreviewHint}>{t('filePreview.excerpt')}</p>}
  </div>
}
