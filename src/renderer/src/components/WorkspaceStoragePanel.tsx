// Note: .agents/notes/desktop/workspace-state-storage.md
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '@/i18n/useI18n'
import { useWorkspaceStore } from '@/stores/workspace'
import type { WorkspaceMigrationView } from '../../../shared/ipc/workspace-storage'
import styles from './WorkspaceStoragePanel.module.css'

export const OPEN_STORAGE_SETTINGS = 'janusx:open-storage-settings'
let focusPending = false
export function focusWorkspaceStorageSettings(): void {
  focusPending = true
  window.dispatchEvent(new Event(OPEN_STORAGE_SETTINGS))
}
const categories = ['janusX.launch.json', 'checkpoints', 'logs']
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

export function WorkspaceStoragePanel() {
  const { t } = useI18n('storage')
  const [view, setView] = useState<WorkspaceMigrationView>()
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    setError('')
    try { setView(await list()) } catch (failure) { setError(String(failure)) }
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
  const candidates = view?.items.filter(item => ['pending', 'cleanup-pending', 'failed'].includes(item.status)) ?? []
  return <section className={styles.panel} id="workspace-data-migration" aria-label={t('storage:title')}>
    <h3>{t('storage:dataManagement')}</h3>
    <h4>{t('storage:title')}</h4>
    <p>{t('storage:scope')}</p>
    {view && <Location label={t('storage:destinationRoot')} path={view.root} />}
    <p>{t('storage:cleanup')}</p><p>{t('storage:retention')}</p>
    <p>{t('storage:closeTasks')}</p>
    <div className={styles.actions}>
      <button type="button" disabled={busy !== null} onClick={() => { void refresh() }}>{t('storage:check')}</button>
      <button type="button" disabled={busy !== null || !candidates.length} onClick={() => setSelected(candidates.map(item => item.id))}>{t('storage:selectAll')}</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {!view && !error && <p role="status">{t('storage:checking')}</p>}
    {view && !candidates.length && <p>{t('storage:noPending')}</p>}
    {view?.items.map(item => <article key={item.id} className={styles.item}>
      <label><input type="checkbox" disabled={busy !== null || !candidates.some(candidate => candidate.id === item.id)} checked={selected.includes(item.id)} onChange={event => setSelected(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} /> {item.name}</label>
      <strong role="status">{busy === item.id ? t('storage:migrating') : t(`storage:status.${item.status}`)}</strong>
      <Location label={t('storage:source')} path={item.source} />
      {item.target && <Location label={t('storage:destination')} path={item.target} />}
      <ul>{categories.map((category, index) => <li key={category}>{t(`storage:category.${index}`)}: {item.categories.includes(category) ? t('storage:found') : t('storage:absent')}</li>)}</ul>
      {item.error && <p role="alert">{item.error}</p>}
    </article>)}
    <button type="button" className={styles.primary} disabled={busy !== null || !selected.length} onClick={() => { void migrate() }}>{t('storage:migrate')}</button>
  </section>
}

export function WorkspaceMigrationNotice({ onOpen }: { onOpen(): void }) {
  const { t } = useI18n('storage')
  const signature = useWorkspaceStore(state => state.workspaces.map(item => `${item.id}:${item.path}`).join('|'))
  const [view, setView] = useState<WorkspaceMigrationView>()
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
  if (!view) return null
  return createPortal(<aside className={styles.notice} aria-label={t('storage:title')}>
    <strong>{t('storage:title')}</strong><p>{t('storage:scope')}</p>
    <Location label={t('storage:destinationRoot')} path={view.root} />
    <p>{t('storage:cleanup')}</p>
    <div className={styles.actions}><button type="button" onClick={() => { setView(undefined); onOpen() }}>{t('storage:go')}</button><button type="button" onClick={() => setView(undefined)}>{t('storage:later')}</button></div>
  </aside>, document.body)
}
