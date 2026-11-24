import { useEffect, useId, useRef, useState } from 'react'
import { Layers3 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SettingsSection, SettingsRow, SettingsFooter, Button, Input, settingsStyles as styles } from '@janusx/ui'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWorkerSettingsText } from '@/lib/worker-settings-text'

/** Capacity is global; the existing snapshot API needs a registered workspace to read it. */
export function WorkerCapacitySettings() {
  const { t } = useTranslation('settings')
  const { errorText } = useWorkerSettingsText()
  const api = window.electron?.superAgent
  const workspaceId = useWorkspaceStore(state => state.activeWorkspaceId ?? state.workspaces[0]?.id)
  const [saved, setSaved] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState<'loading' | 'idle' | 'saving' | 'saved' | 'error'>('loading')
  const [error, setError] = useState(''), [revision, setRevision] = useState(0)
  const generation = useRef(0), saving = useRef(false)
  const id = useId(), helpId = useId()
  useEffect(() => {
    const epoch = ++generation.current
    setSaved(null); setDraft(''); setError(''); saving.current = false
    if (!api || !workspaceId) { setStatus('idle'); return }
    setStatus('loading')
    void api.schedule(workspaceId).then(snapshot => {
      if (epoch !== generation.current) return
      setSaved(snapshot.maxConcurrentWorkers); setDraft(String(snapshot.maxConcurrentWorkers)); setStatus('idle')
    }).catch(value => { if (epoch === generation.current) { setError(String(value)); setStatus('error') } })
    return () => { generation.current = epoch + 1 }
  }, [api, workspaceId, revision])
  const busy = status === 'loading' || status === 'saving'
  const valid = draft.trim() !== '' && Number.isSafeInteger(Number(draft)) && Number(draft) >= 1
  const dirty = saved !== null && Number(draft) !== saved
  const save = async () => {
    if (!api || saved === null || !valid || saving.current) return
    const epoch = generation.current
    saving.current = true; setStatus('saving'); setError('')
    try {
      const value = await api.configureCapacity(Number(draft))
      if (epoch !== generation.current) return
      setSaved(value); setDraft(String(value)); setStatus('saved')
    } catch (value) { if (epoch === generation.current) { setError(String(value)); setStatus('error') } }
    finally { if (epoch === generation.current) saving.current = false }
  }
  return <SettingsSection className={styles.section} aria-label={t('workerCapacity.title')}>
    <h4 className={styles.sectionTitle}><Layers3 size={18} aria-hidden="true" />{t('workerCapacity.title')}</h4>
    <SettingsRow className={styles.row}>
      <div className={styles.label}><label htmlFor={id} className={styles.labelText}>{t('workerCapacity.limit')}</label>
        <p id={helpId} className={styles.hint}>{t('workerCapacity.help')}</p></div>
      <Input id={id} className={styles.input} type="number" min={1} step={1} value={draft} aria-describedby={helpId}
        aria-invalid={saved !== null && !valid} disabled={busy || saved === null}
        onChange={event => { setDraft(event.target.value); setStatus('idle'); setError('') }} />
    </SettingsRow>
    <SettingsFooter className={styles.footer} sticky={false}>
      <div className={`${styles.status} ${error ? styles.statusError : ''}`} role={error || (saved !== null && !valid) ? 'alert' : 'status'}>
        {!workspaceId ? t('workerCapacity.workspaceRequired') : !api ? t('workerDefaults.unavailable') : error ? errorText(error) : saved !== null && !valid ? t('workerCapacity.invalid') : busy ? t(status === 'loading' ? 'footer.loading' : 'footer.saving') : status === 'saved' ? t('footer.saved') : dirty ? t('footer.unsaved') : ''}
      </div>
      <div className={styles.actions}>
        {saved === null && status === 'error' && <Button variant="ghost" onClick={() => setRevision(value => value + 1)}>{t('workerCapacity.retry')}</Button>}
        <Button variant="primary" disabled={busy || !valid || !dirty} onClick={() => void save()}>{t('footer.save')}</Button>
      </div>
    </SettingsFooter>
  </SettingsSection>
}
