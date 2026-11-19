import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FolderOpen, Plus, X } from 'lucide-react'
import { Button } from '@janusx/ui'
import { useI18n } from '@/i18n/useI18n'
import { HISTORY_ENGINES, type HistoryEngine, type HistorySourceSettings, type HistorySourcesView } from '../../../shared/history-sources'
import { TerminalPresetIcon } from './ui/TerminalPresetIcon'
import styles from './HistorySourcesButton.module.css'

const names = { claude: 'Claude Code', codex: 'Codex', pi: 'Pi', opencode: 'OpenCode' }

export function HistorySourcesButton({ compact = false, onChanged }: { compact?: boolean; onChanged?: () => void }) {
  const { t } = useI18n('settings')
  const [open, setOpen] = useState(false)
  return <>
    <Button variant="ghost" className={styles.trigger} aria-label={t('historySources.title')} title={t('historySources.title')} onClick={() => setOpen(true)}>
      <FolderOpen size={14} />{!compact && t('historySources.title')}
    </Button>
    {open && <HistorySourcesDialog onClose={() => setOpen(false)} onChanged={onChanged} />}
  </>
}

function HistorySourcesDialog({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const { t } = useI18n('settings')
  const ref = useRef<HTMLDialogElement>(null)
  const [view, setView] = useState<HistorySourcesView>()
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    let mounted = true
    void window.electron.system.getHistorySources().then(result => { if (mounted) setView(result) })
      .catch(err => { if (mounted) setError(String(err)) }).finally(() => { if (mounted) setBusy(false) })
    return () => { mounted = false; dialog.close() }
  }, [])

  async function save(settings: HistorySourceSettings) {
    setBusy(true); setError('')
    try {
      const result = await window.electron.system.saveHistorySources(settings)
      setView(result)
      if (result.refreshWarning) setError(`${t('historySources.refreshFailed')} ${result.refreshWarning}`)
      onChanged?.()
    } catch (err) { setError(String(err)) }
    finally { setBusy(false) }
  }
  async function add(engine: HistoryEngine) {
    if (!view) return
    setBusy(true); setError('')
    try {
      const path = await window.electron.system.pickHistorySource(engine)
      if (path) await save({ ...view.settings, locations: [...view.settings.locations.filter(item => item.engine !== engine || item.path !== path), { engine, path, enabled: true }] })
    } catch (err) { setError(String(err)) }
    finally { setBusy(false) }
  }
  return createPortal(<dialog ref={ref} className={styles.dialog} aria-labelledby="history-sources-title" aria-busy={busy}
    onKeyDown={event => event.stopPropagation()} onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <header className={styles.header}>
      <div><h2 id="history-sources-title">{t('historySources.title')}</h2><p>{t('historySources.description')}</p></div>
      <Button variant="ghost" disabled={busy} aria-label={t('historySources.close')} onClick={onClose}><X size={16} /></Button>
    </header>
    <div className={styles.body}>
      {HISTORY_ENGINES.map(engine => <section key={engine} className={styles.provider} aria-label={names[engine]}>
        <div className={styles.providerHeader}>
          <span className={styles.name}><TerminalPresetIcon preset={engine} style={{ width: 16, height: 16 }} />{names[engine]}</span>
          <label className={styles.automatic}><input type="checkbox" disabled={busy || !view} checked={!view?.settings.disabledAutomatic.includes(engine)}
            onChange={event => { if (view) void save({ ...view.settings, disabledAutomatic: event.target.checked ? view.settings.disabledAutomatic.filter(item => item !== engine) : [...view.settings.disabledAutomatic, engine] }) }} />{t('historySources.automatic')}</label>
          <Button variant="ghost" disabled={busy || !view} aria-label={`${t('historySources.add')} ${names[engine]}`} onClick={() => void add(engine)}><Plus size={14} /></Button>
        </div>
        <p className={styles.hint}>{t(`historySources.path.${engine}`)}</p>
        {view?.sources.filter(source => source.engine === engine).map(source => <div key={source.path} className={styles.source}>
          <label className={styles.location}>
            <input type="checkbox" disabled={busy || source.automatic} checked={source.enabled} aria-label={source.path}
              onChange={event => void save({ ...view.settings, locations: view.settings.locations.map(item => item.engine === engine && item.path === source.path ? { ...item, enabled: event.target.checked } : item) })} />
            <span className={styles.path} title={source.path}>{source.path}</span>
          </label>
          <div className={styles.sourceMeta}>
            <span>{t(`historySources.status.${source.status}`)}</span>
            {source.status === 'ready' && <span>{t(`historySources.resume.${source.resume}`)}</span>}
            {!source.automatic && <Button variant="ghost" disabled={busy} aria-label={`${t('historySources.remove')} ${source.path}`} onClick={() => void save({ ...view.settings, locations: view.settings.locations.filter(item => item.engine !== engine || item.path !== source.path) })}><X size={12} /></Button>}
          </div>
        </div>)}
      </section>)}
    </div>
    <footer className={styles.footer}>
      <p>{t('historySources.note')}</p>
      {busy && <p role="status">{t('historySources.busy')}</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.actions}>
        <Button variant="ghost" disabled={busy || !view} onClick={() => void save({ disabledAutomatic: [], locations: [] })}>{t('historySources.reset')}</Button>
        <Button disabled={busy} onClick={onClose}>{t('historySources.done')}</Button>
      </div>
    </footer>
  </dialog>, document.body)
}
