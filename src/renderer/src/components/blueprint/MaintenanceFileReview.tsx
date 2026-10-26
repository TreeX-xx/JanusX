// Note: confirmation applies the host's frozen file preview — see .agents/notes/blueprint/maintenance/blueprint-maintenance-approval-gap.md
import { useEffect, useState } from 'react'
import { previewMaintenanceChangeSet } from '@/services/blueprint'
import { useI18n } from '@/i18n/useI18n'
import type { BlueprintMaintenancePreview, BlueprintMaintenancePreviewInput } from '../../../../../plugins/blueprint/src/shared/janus/maintenance-types'
import styles from './BlueprintActionBar.module.css'

export type MaintenanceReviewContext = Omit<BlueprintMaintenancePreviewInput, 'operationIds' | 'groupIds'>

export function MaintenanceFileReview({ input, disabled, label, onApply }: {
  input: BlueprintMaintenancePreviewInput
  disabled: boolean
  label: string
  onApply: (previewId: string) => Promise<void>
}) {
  const { t } = useI18n('blueprint')
  const [result, setResult] = useState<{ key: string; preview?: BlueprintMaintenancePreview; error?: string } | null>(null)
  const [retry, setRetry] = useState(0)
  const key = JSON.stringify(input)
  const hasSelection = input.operationIds.length > 0
  useEffect(() => {
    let active = true
    setResult(null)
    if (!hasSelection) return
    void previewMaintenanceChangeSet(JSON.parse(key) as BlueprintMaintenancePreviewInput).then(
      preview => { if (active) setResult({ key, preview }) },
      error => { if (active) setResult({ key, error: error instanceof Error ? error.message : String(error) }) },
    )
    return () => { active = false }
  }, [key, hasSelection, retry])
  const current = result?.key === key ? result : null
  const preview = current?.preview
  return <section className={styles.files} aria-label={t('blueprint:maintenance.filesTitle')}>
    <p className={styles.proposalHead}>{t('blueprint:maintenance.filesTitle')}{preview ? ` · ${preview.files.length}` : ''}</p>
    {!hasSelection ? <p className={styles.hint}>{t('blueprint:maintenance.filesSelect')}</p>
      : !current ? <p role="status">{t('blueprint:maintenance.filesLoading')}</p> : null}
    {current?.error && <div>
      <p role="alert">{current.error}</p>
      <button type="button" disabled={disabled} onClick={() => setRetry(value => value + 1)}>{t('blueprint:maintenance.filesRetry')}</button>
    </div>}
    {preview?.files.map(file => <div className={styles.file} key={file.uri}>
      <p><span>{t(file.kind === 'create' ? 'blueprint:maintenance.fileCreate' : 'blueprint:maintenance.fileReplace')}</span> <code>{file.path}</code></p>
      <div className={styles.document}><strong>{t('blueprint:maintenance.auditAfter')}</strong><pre>{file.after}</pre></div>
      <details>
        <summary>{t('blueprint:maintenance.reviewDiff')}</summary>
        <div className={styles.fileDiff}>
          <div><strong>{t('blueprint:maintenance.auditBefore')}</strong><pre>{file.before || '∅'}</pre></div>
          <div><strong>{t('blueprint:maintenance.auditAfter')}</strong><pre>{file.after}</pre></div>
        </div>
      </details>
      <p>{file.reason}</p>
      {file.archivedInsteadOfDeleted && <p>{t('blueprint:maintenance.fileArchive')}</p>}
    </div>)}
    <button type="button" className={styles.primary} disabled={disabled || !preview?.files.length}
      onClick={() => { if (preview) void onApply(preview.id) }}>{label}</button>
  </section>
}
