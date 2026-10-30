// Note: .agents/notes/desktop/workspace-state-storage.md
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '@/i18n/useI18n'
import { useWorkspaceStore } from '@/stores/workspace'
import type { WorkspaceMigrationItem, WorkspaceMigrationView } from '../../../shared/ipc/workspace-storage'
import styles from './WorkspaceStoragePanel.module.css'
import { WorkspaceDataPanel } from './WorkspaceDataPanel'
import { LegacyHooksCleanup } from './LegacyHooksCleanup'
import { StorageHelp } from './StorageHelp'

export const OPEN_STORAGE_SETTINGS = 'janusx:open-storage-settings'
let focusPending = false
export function focusWorkspaceStorageSettings(): void {
  focusPending = true
  window.dispatchEvent(new Event(OPEN_STORAGE_SETTINGS))
}
const categories = ['janusX.launch.json', 'checkpoints', 'logs']
const canMigrate = (item: WorkspaceMigrationItem) => ['pending', 'cleanup-pending', 'failed'].includes(item.status)
let listRequest: Promise<WorkspaceMigrationView> | undefined
function list(): Promise<WorkspaceMigrationView> {
  const api = window.electron?.workspaceStorage
  if (!api) return Promise.reject(new Error('Workspace storage is unavailable'))
  return listRequest ??= api.list().finally(() => { listRequest = undefined })
}

function Location({ label, path }: { label: string; path: string }) {
  const { t } = useI18n('storage')
  return <div className={styles.location}><span>{label}</span><code>{path}</code><button type="button" onClick={() => { void navigator.clipboard.writeText(path) }}>{t('storage:copy')}</button></div>
}

function MigrationDetails({ item }: { item: WorkspaceMigrationItem }) {
  const { t } = useI18n('storage')
  return <>
    <Location label={t('storage:source')} path={item.source} />
    {item.target && <Location label={t('storage:destination')} path={item.target} />}
    <ul>{categories.map((category, index) => <li key={category}>{t(`storage:category.${index}`)}: {item.categories.includes(category) ? t('storage:found') : t('storage:absent')}</li>)}</ul>
    {item.error && <p role="alert">{item.error}</p>}
  </>
}

export function WorkspaceStoragePanel() {
  const { t } = useI18n('storage')
  const [view, setView] = useState<WorkspaceMigrationView>()
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [migrationOpen, setMigrationOpen] = useState(false)
  const refresh = useCallback(async () => {
    setError('')
    try {
      const next = await list()
      setView(next)
      if (next.items.some(item => item.status !== 'new' && item.status !== 'migrated')) setMigrationOpen(true)
    } catch (failure) { setError(String(failure)); setMigrationOpen(true) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    const focus = () => {
      const section = document.getElementById('workspace-data-migration')
      if (section) { section.scrollIntoView({ block: 'start' }); focusPending = false }
    }
    window.addEventListener(OPEN_STORAGE_SETTINGS, focus)
    if (focusPending) focus()
    return () => window.removeEventListener(OPEN_STORAGE_SETTINGS, focus)
  }, [])
  const migrate = async () => {
    if (busy || !selected.length) return
    setError('')
    try {
      for (const id of selected) {
        setBusy(id)
        const results = await window.electron.workspaceStorage!.migrate([id])
        setView(current => current ? { ...current, items: current.items.map(item => results.find(result => result.id === item.id) ?? item) } : current)
      }
      setSelected([])
    } catch (failure) { setError(String(failure)) }
    finally { setBusy(null) }
  }
  const candidates = view?.items.filter(canMigrate) ?? []
  return <section className={styles.panel} id="workspace-data-migration" aria-label={t('storage:dataManagement')}>
    <h3>{t('storage:dataManagement')}</h3>
    <WorkspaceDataPanel />
    <LegacyHooksCleanup />
    <details className={styles.maintenanceSection} open={migrationOpen} onToggle={event => setMigrationOpen(event.currentTarget.open)}>
    <summary className={styles.sectionSummary}><span>{t('storage:title')}</span></summary>
    <div className={styles.sectionBody}>
    <div className={styles.explanation}>
      <p className={styles.muted}>{t('storage:scope')}</p>
      <StorageHelp label={t('storage:retentionPolicy')} paragraphs={[t('storage:cleanup'), t('storage:retention'), t('storage:closeTasks')]} />
    </div>
    {view && <Location label={t('storage:destinationRoot')} path={view.root} />}
    <div className={styles.toolbar}>
    <div className={styles.actions}>
      <button type="button" disabled={busy !== null} onClick={() => { void refresh() }}>{t('storage:check')}</button>
      <button type="button" disabled={busy !== null || !candidates.length} onClick={() => setSelected(candidates.map(item => item.id))}>{t('storage:selectAll')}</button>
    </div>
    <button type="button" className={styles.primary} disabled={busy !== null || !selected.length} onClick={() => { void migrate() }}>{t('storage:migrate')}</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {!view && !error && <p role="status">{t('storage:checking')}</p>}
    {view && !candidates.length && <p>{t('storage:noPending')}</p>}
    {view?.items.map(item => <article key={item.id} className={styles.item}>
      <div className={styles.heading}><label className={styles.itemLabel}><input type="checkbox" disabled={busy !== null || !candidates.some(candidate => candidate.id === item.id)} checked={selected.includes(item.id)} onChange={event => setSelected(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} /><span className={styles.workspaceName} title={item.name}>{item.name}</span></label>
      <span className={styles.status} data-status={item.status} title={busy === item.id ? t('storage:migrating') : t(`storage:status.${item.status}`)} role="status">{busy === item.id ? t('storage:migrating') : t(`storage:status.${item.status}`)}</span></div>
      <details className={styles.details} open={selected.includes(item.id) || busy === item.id || !!item.error}>
        <summary>{t('storage:bulk.details')}</summary><MigrationDetails item={item} />
      </details>
    </article>)}
    </div>
    </details>
  </section>
}

export function WorkspaceMigrationNotice({ onOpen }: { onOpen(): void }) {
  const { t } = useI18n('storage')
  const signature = useWorkspaceStore(state => state.workspaces.map(item => `${item.id}:${item.path}`).join('|'))
  const [view, setView] = useState<WorkspaceMigrationView>()
  const [phase, setPhase] = useState<'notice' | 'checking' | 'review' | 'running' | 'done'>('notice')
  const [progress, setProgress] = useState<{ id: string; current: number; total: number }>()
  const [error, setError] = useState('')
  const running = useRef(false)
  const shown = useRef(false)
  useEffect(() => {
    if (!signature || shown.current || !window.electron?.workspaceStorage) return
    let live = true
    void list().then(value => {
      if (!live || !value.prompt || shown.current) return
      shown.current = true
      setView(value)
      void window.electron.workspaceStorage!.dismiss().catch(() => {})
    }).catch(() => {})
    return () => { live = false }
  }, [signature])
  const review = async () => {
    if (running.current) return
    running.current = true; setPhase('checking'); setError('')
    try { setView(await list()); setPhase('review') }
    catch (failure) { setError(String(failure)); setPhase('notice') }
    finally { running.current = false }
  }
  const migrateAll = async () => {
    if (running.current || phase !== 'review' || !view) return
    const candidates = view.items.filter(canMigrate)
    if (!candidates.length) return
    running.current = true; setPhase('running'); setError('')
    try {
      for (const [index, item] of candidates.entries()) {
        setProgress({ id: item.id, current: index + 1, total: candidates.length })
        let result: WorkspaceMigrationItem
        try {
          const results = await window.electron.workspaceStorage!.migrate([item.id])
          result = results.find(value => value.id === item.id) ?? { ...item, status: 'failed', error: t('storage:bulk.noResult') }
        } catch (failure) { result = { ...item, status: 'failed', error: String(failure) } }
        setView(current => current ? { ...current, items: current.items.map(value => value.id === item.id ? result : value) } : current)
      }
    } finally { running.current = false; setProgress(undefined); setPhase('done') }
  }
  if (!view) return null
  const candidates = view.items.filter(canMigrate)
  const busy = phase === 'checking' || phase === 'running'
  const expanded = phase === 'review' || phase === 'running' || phase === 'done'
  return createPortal(<aside className={styles.notice} aria-label={t('storage:title')}>
    <div className={styles.noticeBody}>
    <strong>{t('storage:title')}</strong><p>{t('storage:scope')}</p>
    <Location label={t('storage:destinationRoot')} path={view.root} />
    <p>{t('storage:cleanup')}</p>
    {error && <p role="alert">{error}</p>}
    {expanded && <>
      {phase === 'review' && <p>{t('storage:bulk.scope', { count: candidates.length })}</p>}
      <p>{t('storage:retention')}</p>
      {phase === 'review' && <p>{t('storage:closeTasks')}</p>}
      <details open className={styles.details}>
        <summary>{t('storage:bulk.details')}</summary>
        {view.items.map(item => <article key={item.id} className={styles.item}>
          <strong>{item.name}</strong>
          <p>{progress?.id === item.id ? t('storage:migrating') : t(`storage:status.${item.status}`)}</p>
          <MigrationDetails item={item} />
        </article>)}
      </details>
    </>}
    </div>
    {progress && <p role="status">{t('storage:bulk.progress', { current: progress.current, total: progress.total, name: view.items.find(item => item.id === progress.id)?.name })}</p>}
    {phase === 'done' && <p role="status">{t('storage:bulk.result', { completed: view.items.filter(item => item.status === 'migrated').length, remaining: view.items.filter(item => ['pending', 'failed', 'cleanup-pending', 'offline', 'unsupported'].includes(item.status)).length })}</p>}
    <div className={styles.actions}>
      {phase === 'notice' && <button type="button" onClick={() => { void review() }}>{t('storage:bulk.action')}</button>}
      {phase === 'checking' && <button type="button" disabled>{t('storage:checking')}</button>}
      {phase === 'review' && <button type="button" disabled={!candidates.length} onClick={() => { void migrateAll() }}>{t('storage:bulk.confirm')}</button>}
      <button type="button" disabled={busy} onClick={() => { setView(undefined); onOpen() }}>{t('storage:go')}</button>
      <button type="button" disabled={busy} onClick={() => phase === 'review' ? setPhase('notice') : setView(undefined)}>{phase === 'review' ? t('storage:maintenance.cancel') : phase === 'done' ? t('storage:bulk.close') : t('storage:later')}</button>
    </div>
  </aside>, document.body)
}
