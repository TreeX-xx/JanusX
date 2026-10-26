// Note: chat edits are displayed after the committed write — see .agents/notes/blueprint/maintenance/requirements/blueprint-conversation-development.md
import { useEffect, useState } from 'react'
import { useNoteChatStore } from '@/stores/note-chat'
import { useI18n } from '@/i18n/useI18n'
import type { NoteChatChange } from '../../../../shared/note-chat'
import { reviewDiff } from '@/lib/review-diff'
import { sameCheckoutPath } from '@/lib/checkout-path'
import styles from './NoteChatActivity.module.css'

export function ChangeCard({ change }: { change: NoteChatChange }) {
  const { t } = useI18n('blueprint')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reverted = !!change.reverted
  const undo = async () => {
    if (!change.txId || busy || reverted) return
    setBusy(true); setError(null)
    try {
      const preview = await window.electron.harness.undoPreview(change.workspacePath, change.txId)
      if (!preview.reversible) throw new Error(t('blueprint:noteChat.undoConflict'))
      await window.electron.harness.undoApply(change.workspacePath, change.txId)
      useNoteChatStore.getState().receive({ ...change, reverted: true })
    } catch (reason) {
      setError(reason && typeof reason === 'object' && 'message' in reason ? String(reason.message) : String(reason))
    } finally { setBusy(false) }
  }
  return <article className={styles.card}>
    <strong>{t(reverted ? 'blueprint:noteChat.reverted' : 'blueprint:noteChat.applied', { count: change.files.length })}</strong>
    <p>{change.reason}</p>
    <ul>{change.files.map(file => <li key={file.uri}>{file.title}</li>)}</ul>
    <details><summary>{t('blueprint:noteChat.viewChanges')}</summary>
      {change.files.map(file => {
        const diff = reviewDiff(file.before, file.after)
        return <section key={file.uri}><strong>{file.title}</strong>
          <div className={styles.diff}><pre aria-label={t('blueprint:maintenance.auditBefore')}>{diff.before || '∅'}</pre>
            <pre aria-label={t('blueprint:maintenance.auditAfter')}>{diff.after || '∅'}</pre></div>
          <details><summary>{t('blueprint:noteChat.fullText')}</summary><pre>{file.after}</pre></details>
        </section>
      })}
    </details>
    <button type="button" disabled={busy || reverted || !change.txId} onClick={() => void undo()}>{t('blueprint:maintenance.undoAction')}</button>
    {error && <p role="alert">{error}</p>}
  </article>
}

export function NoteChatActivity({ conversationId, workspacePath, excludedIds = [] }: { conversationId: string; workspacePath: string; excludedIds?: string[] }) {
  const { t } = useI18n('blueprint')
  const changes = useNoteChatStore(state => state.changes)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    const initial = new Map(useNoteChatStore.getState().changes.map(change => [change.id, change]))
    setError(null)
    void window.electron.harness.noteChatChanges(workspacePath, conversationId).then(records => {
      if (!active) return
      useNoteChatStore.setState(state => {
        const merged = new Map(state.changes.map(change => [change.id, change]))
        for (const record of records) {
          if (!merged.has(record.id) || merged.get(record.id) === initial.get(record.id)) merged.set(record.id, record)
        }
        return { changes: [...merged.values()] }
      })
    }).catch(reason => { if (active) setError(String(reason?.message ?? reason)) })
    return () => { active = false }
  }, [workspacePath, conversationId, attempt])
  const matching = changes.filter(change => change.conversationId === conversationId && sameCheckoutPath(change.workspacePath, workspacePath))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return <div className={styles.activity} aria-live="polite">
    {matching.filter(change => !excludedIds.includes(change.id)).map(change => <ChangeCard key={change.id} change={change} />)}
    {error && <div className={styles.notice}>
      <p role="status">{t('blueprint:noteChat.historyLoadFailed')}</p>
      <button type="button" onClick={() => setAttempt(value => value + 1)}>{t('blueprint:noteChat.reloadHistory')}</button>
      <details><summary>{t('blueprint:workspace.diagnostics')}</summary><pre>{error}</pre></details>
    </div>}
  </div>
}
