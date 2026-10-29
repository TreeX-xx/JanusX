// Note: .agents/notes/terminal/terminal-hook-launch-isolation.md
import { useState } from 'react'
import { useI18n } from '@/i18n/useI18n'
import type { LegacyHookCleanupResult } from '../../../shared/ipc/workspace-storage'
import styles from './WorkspaceStoragePanel.module.css'

export function LegacyHooksCleanup() {
  const { t } = useI18n('storage')
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<LegacyHookCleanupResult>()
  const [error, setError] = useState('')
  const cleanup = async () => {
    if (busy) return
    setBusy(true); setError(''); setResult(undefined)
    try { setResult(await window.electron.workspaceStorage!.retireHooks()); setConfirm(false) }
    catch (failure) { setError(String(failure)) }
    finally { setBusy(false) }
  }
  return <div className={styles.dataSection}>
    <h4>{t('storage:hooks.title')}</h4>
    <p>{t('storage:hooks.scope')}</p>
    <button type="button" disabled={busy} onClick={() => setConfirm(true)}>{t('storage:hooks.action')}</button>
    {confirm && <div className={styles.confirm} role="group" aria-label={t('storage:hooks.confirmTitle')}>
      <p>{t('storage:hooks.closeTasks')}</p>
      <div className={styles.actions}>
        <button type="button" disabled={busy} onClick={() => setConfirm(false)}>{t('storage:maintenance.cancel')}</button>
        <button type="button" disabled={busy} onClick={() => { void cleanup() }}>{busy ? t('storage:hooks.busy') : t('storage:maintenance.confirm')}</button>
      </div>
    </div>}
    {error && <p role="alert">{error}</p>}
    {result && <div role="status">
      <p>{t('storage:hooks.result', { commands: result.commands, files: result.files.length })}</p>
      {!!result.files.length && <details><summary>{t('storage:hooks.removed')}</summary>{result.files.map(path => <code key={path} className={styles.path}>{path}</code>)}</details>}
      {!!result.retained.length && <details open><summary>{t('storage:hooks.retained')}</summary>{result.retained.map((item, index) => <div key={index}><code className={styles.path}>{item.path}</code><p>{item.reason}</p></div>)}</details>}
    </div>}
  </div>
}
