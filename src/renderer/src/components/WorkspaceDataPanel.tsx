// Note: .agents/notes/desktop/workspace-state-storage.md
import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '@/i18n/useI18n'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWorktreeStore } from '@/stores/worktree'
import type { WorkspaceDataItem, WorkspaceCleanupCategory } from '../../../shared/ipc/workspace-storage'
import styles from './WorkspaceStoragePanel.module.css'
import { StorageHelp } from './StorageHelp'

let dataRequest: Promise<WorkspaceDataItem[]> | undefined
const data = () => dataRequest ??= window.electron.workspaceStorage!.data().finally(() => { dataRequest = undefined })

export async function refreshWorkspaceDataRecords(): Promise<void> {
  const current = useWorkspaceStore.getState().workspaces
  const updated = await window.electron.workspace.list()
  for (const workspace of current) if (updated.find(item => item.id === workspace.id)?.path !== workspace.path) {
    useWorktreeStore.getState().clearWorkspace(workspace.id)
    if (!updated.some(item => item.id === workspace.id)) useWorkspaceStore.getState().removeWorkspace(workspace.id)
  }
  useWorkspaceStore.getState().setWorkspaces(updated)
  dataRequest = undefined
  window.dispatchEvent(new Event('janusx:workspace-data-changed'))
}

export async function relocateWorkspaceData(item: WorkspaceDataItem, mismatchMessage: string, addLabel: string, cancelLabel: string): Promise<void> {
  const selection = await window.electron.dialog.openDirectory()
  if (selection.canceled || !selection.filePaths[0]) return
  try { await window.electron.workspaceStorage!.relocate(item.id, selection.filePaths[0]) }
  catch (error) {
    if (!String(error).includes('WORKSPACE_IDENTITY_MISMATCH')) throw error
    const result = await window.electron.dialog.showMessageBox({ message: mismatchMessage, buttons: [addLabel, cancelLabel], defaultId: 1, cancelId: 1 })
    if (result.response !== 0) return
    const path = selection.filePaths[0]
    await window.electron.workspace.create({ name: path.split(/[\\/]/).filter(Boolean).pop() ?? path, path })
  }
  await refreshWorkspaceDataRecords()
}

export function WorkspaceDataPanel() {
  const { t } = useI18n('storage')
  const [items, setItems] = useState<WorkspaceDataItem[]>([])
  const [error, setError] = useState('')
  const [busyIds, setBusyIds] = useState<string[]>([])
  const locks = useRef(new Set<string>())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [sizes, setSizes] = useState<Record<string, number>>({})
  const [confirm, setConfirm] = useState<{ item: WorkspaceDataItem; category: WorkspaceCleanupCategory | 'detach' }>()
  const refresh = useCallback(async () => {
    try { setItems(await data()); setError('') }
    catch (failure) { setError(String(failure)) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => {
    if (window.electron?.workspaceStorage?.data) void refresh(); else setLoading(false)
    window.addEventListener('janusx:workspace-data-changed', refresh)
    return () => window.removeEventListener('janusx:workspace-data-changed', refresh)
  }, [refresh])
  const action = async (id: string, operation: () => Promise<unknown>) => {
    if (locks.current.has(id)) return
    locks.current.add(id); setBusyIds([...locks.current])
    setErrors(current => ({ ...current, [id]: '' }))
    try { await operation(); dataRequest = undefined; await refresh() }
    catch (failure) { setErrors(current => ({ ...current, [id]: String(failure) })) }
    finally { locks.current.delete(id); setBusyIds([...locks.current]) }
  }
  const matches = (item: WorkspaceDataItem, value: string) => value === 'all' || (value === 'attention' ? ['offline', 'failed', 'purging'].includes(item.status) : !!item.detachedAt)
  const visible = items.filter(item => matches(item, filter))
  return <details className={styles.maintenanceSection} open>
    <summary className={styles.sectionSummary}><h4>{t('storage:maintenance.title')}</h4></summary>
    <div className={styles.sectionBody}>
    <div className={styles.heading}>
      <div className={styles.explanation}><span className={styles.muted}>{t('storage:retentionPolicy')}</span><StorageHelp label={t('storage:retentionPolicy')} paragraphs={[t('storage:maintenance.policy')]} /></div>
      <button type="button" disabled={loading} onClick={() => { dataRequest = undefined; void refresh() }}>{t('storage:check')}</button>
    </div>
    <div className={styles.filters} role="group" aria-label={t('storage:maintenance.filterLabel')}>
      {['all', 'attention', 'detached'].map(value => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{t(`storage:maintenance.filter.${value}`)}<span>{items.filter(item => matches(item, value)).length}</span></button>)}
    </div>
    {error && <p role="alert">{error}</p>}
    {loading && <p className={styles.empty} role="status">{t('storage:checking')}</p>}
    {!loading && !error && !visible.length && <p className={styles.empty}>{t(items.length ? 'storage:maintenance.filterEmpty' : 'storage:maintenance.empty')}</p>}
    {visible.map(item => {
      const busy = busyIds.includes(item.id)
      return <article className={styles.dataItem} key={item.id} aria-label={item.name} aria-busy={busy}>
      <div className={styles.heading}><strong className={styles.workspaceName} title={item.name}>{item.name}</strong><span className={styles.status} data-status={item.status} title={t(`storage:maintenance.status.${item.status}`)} role="status">{t(`storage:maintenance.status.${item.status}`)}</span></div>
      <code className={styles.path} dir="auto">{item.path}</code>
      {item.status === 'offline' && <p className={styles.muted}>{t('storage:maintenance.offlineHelp')}</p>}
      {item.expiresAt && <p className={styles.muted}>{t('storage:maintenance.expires', { date: new Date(item.expiresAt).toLocaleDateString() })}</p>}
      {(errors[item.id] || item.error) && <p role="alert">{errors[item.id] || item.error}</p>}
      {busy && <p role="status" className={styles.muted}>{t('storage:maintenance.processing')}</p>}
      <div className={styles.actions}>
        {item.actions.relocate && <button type="button" disabled={busy} onClick={() => { void action(item.id, () => relocateWorkspaceData(item, t('storage:maintenance.mismatch'), t('storage:maintenance.addNew'), t('storage:maintenance.cancel'))) }}>{t('storage:maintenance.relocate')}</button>}
        {item.actions.restore && <button type="button" disabled={busy} onClick={() => { void action(item.id, async () => { await window.electron.workspaceStorage!.restore(item.id); await refreshWorkspaceDataRecords() }) }}>{t('storage:maintenance.restore')}</button>}
        {item.actions.detach && (item.status === 'offline' || !item.workspaceIds.length) && <button type="button" disabled={busy} onClick={() => setConfirm({ item, category: 'detach' })}>{t('storage:maintenance.removeRecord')}</button>}
        {item.actions.purge && <button type="button" className={styles.danger} disabled={busy} onClick={() => setConfirm({ item, category: 'all' })}>{t('storage:maintenance.clearAll')}</button>}
        {item.target && <details className={styles.details}><summary>{t('storage:maintenance.details')}</summary>
          <code className={styles.path}>{item.target}</code>
          <div className={styles.actions}>
            <button type="button" disabled={busy} onClick={() => { void action(item.id, () => navigator.clipboard.writeText(item.target)) }}>{t('storage:copy')}</button>
            <button type="button" disabled={busy} onClick={() => { void action(item.id, async () => { const size = await window.electron.workspaceStorage!.measure(item.id); setSizes(current => ({ ...current, [item.id]: size })) }) }}>{t('storage:maintenance.measure')}</button>
          </div>
          {sizes[item.id] !== undefined && <p>{(sizes[item.id] / 1024 / 1024).toFixed(2)} MiB</p>}
          {item.actions.cleanup && <div className={styles.actions}>
            <button type="button" disabled={busy} onClick={() => setConfirm({ item, category: 'logs' })}>{t('storage:maintenance.clearLogs')}</button>
            <button type="button" disabled={busy} onClick={() => setConfirm({ item, category: 'checkpoints' })}>{t('storage:maintenance.clearSnapshots')}</button>
          </div>}
        </details>}
      </div>
    {confirm?.item.id === item.id && <div className={styles.confirm} role="group" aria-label={t('storage:maintenance.confirmTitle')}>
      <strong>{confirm.item.name} · {t('storage:maintenance.confirmTitle')}</strong>
      <p>{t(confirm.category === 'detach' ? 'storage:maintenance.confirmRemove' : confirm.category === 'checkpoints' ? 'storage:maintenance.confirmSnapshots' : confirm.category === 'all' ? 'storage:maintenance.confirmAll' : 'storage:maintenance.confirmLogs')}</p>
      <div className={styles.actions}><button type="button" disabled={busy} onClick={() => setConfirm(undefined)}>{t('storage:maintenance.cancel')}</button><button type="button" className={styles.danger} disabled={busy} onClick={() => { void action(item.id, async () => {
        if (confirm.category === 'detach') {
          try {
            for (const id of item.workspaceIds) if (!(await window.electron.workspace.delete(id)).success) throw new Error(t('storage:maintenance.removeFailed'))
            if (!item.id.startsWith('unavailable:')) await window.electron.workspaceStorage!.detach(item.id)
          } finally { await refreshWorkspaceDataRecords() }
        } else await window.electron.workspaceStorage!.cleanup(item.id, confirm.category)
        setConfirm(current => current?.item.id === item.id ? undefined : current); setSizes(current => { const next = { ...current }; delete next[item.id]; return next })
      }) }}>{t(confirm.category === 'detach' ? 'storage:maintenance.confirmRemoveAction' : 'storage:maintenance.confirm')}</button></div>
    </div>}
    </article>})}
    </div>
  </details>
}

/** Local notice appears only for the selected unavailable workspace; never a startup modal. */
export function WorkspaceUnavailableNotice() {
  const { t } = useI18n('storage')
  const activeId = useWorkspaceStore(state => state.activeWorkspaceId)
  const signature = useWorkspaceStore(state => state.workspaces.map(item => `${item.id}:${item.path}`).join('|'))
  const [item, setItem] = useState<WorkspaceDataItem>()
  const [error, setError] = useState('')
  const [dismissed, setDismissed] = useState<string>()
  const [busy, setBusy] = useState(false)
  const check = useCallback(async () => {
    const api = window.electron?.workspaceStorage
    if (!api?.data) return
    try { setItem((await data()).find(item => item.workspaceIds.includes(activeId ?? '') && item.status === 'offline')) }
    catch { /* General errors remain in data management. */ }
  }, [activeId])
  useEffect(() => { void check() }, [check, signature])
  useEffect(() => { window.addEventListener('janusx:workspace-data-changed', check); return () => window.removeEventListener('janusx:workspace-data-changed', check) }, [check])
  if (!item || dismissed === `${activeId}:${item.path}`) return null
  return <aside className={styles.unavailable} aria-label={t('storage:maintenance.status.offline')}>
    <strong>{t('storage:maintenance.unavailable')}</strong><code className={styles.path}>{item.path}</code>
    {error && <p role="alert">{error}</p>}
    <div className={styles.actions}>
      {item.target && <button type="button" disabled={busy} onClick={() => { setBusy(true); void relocateWorkspaceData(item, t('storage:maintenance.mismatch'), t('storage:maintenance.addNew'), t('storage:maintenance.cancel')).then(check).catch(failure => setError(String(failure))).finally(() => setBusy(false)) }}>{t('storage:maintenance.choose')}</button>}
      <button type="button" disabled={busy} onClick={() => { void check() }}>{t('storage:check')}</button>
      <button type="button" onClick={() => setDismissed(`${activeId}:${item.path}`)}>{t('storage:later')}</button>
    </div>
  </aside>
}
