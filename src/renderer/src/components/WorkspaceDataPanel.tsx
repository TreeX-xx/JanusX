// Note: .agents/notes/desktop/workspace-state-storage.md
import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '@/i18n/useI18n'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWorktreeStore } from '@/stores/worktree'
import type { WorkspaceDataItem, WorkspaceCleanupCategory } from '../../../shared/ipc/workspace-storage'
import styles from './WorkspaceStoragePanel.module.css'

let dataRequest: Promise<WorkspaceDataItem[]> | undefined
const data = () => dataRequest ??= window.electron.workspaceStorage!.data().finally(() => { dataRequest = undefined })

export async function refreshWorkspaceDataRecords(): Promise<void> {
  const current = useWorkspaceStore.getState().workspaces
  const updated = await window.electron.workspace.list()
  for (const workspace of updated) if (current.find(item => item.id === workspace.id)?.path !== workspace.path) {
    useWorktreeStore.getState().clearWorkspace(workspace.id)
  }
  useWorkspaceStore.getState().setWorkspaces(updated)
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
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [sizes, setSizes] = useState<Record<string, number>>({})
  const [confirm, setConfirm] = useState<{ item: WorkspaceDataItem; category: WorkspaceCleanupCategory }>()
  const refresh = useCallback(async () => {
    try { setItems(await data()); setError('') }
    catch (failure) { setError(String(failure)) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { if (window.electron?.workspaceStorage?.data) void refresh(); else setLoading(false) }, [refresh])
  const action = async (operation: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true); setError('')
    try { await operation(); await refresh() }
    catch (failure) { setError(String(failure)) }
    finally { setBusy(false) }
  }
  return <details className={styles.maintenanceSection} open>
    <summary className={styles.sectionSummary}><h4>{t('storage:maintenance.title')}</h4></summary>
    <div className={styles.sectionBody}>
    <div className={styles.heading}>
      <details className={`${styles.details} ${styles.retention}`}><summary>{t('storage:retentionPolicy')}</summary><p className={styles.policy}>{t('storage:maintenance.policy')}</p></details>
      <button type="button" disabled={busy || loading} onClick={() => { void action(refresh) }}>{t('storage:check')}</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {loading && <p className={styles.empty} role="status">{t('storage:checking')}</p>}
    {!loading && !error && !items.length && <p className={styles.empty}>{t('storage:maintenance.empty')}</p>}
    {items.map(item => <article className={styles.dataItem} key={item.id}>
      <div className={styles.heading}><strong className={styles.workspaceName} title={item.name}>{item.name}</strong><span className={styles.status} data-status={item.status} title={t(`storage:maintenance.status.${item.status}`)} role="status">{t(`storage:maintenance.status.${item.status}`)}</span></div>
      <code className={styles.path} dir="auto">{item.path}</code>
      {item.expiresAt && <p className={styles.muted}>{t('storage:maintenance.expires', { date: new Date(item.expiresAt).toLocaleDateString() })}</p>}
      {item.error && <p role="alert">{item.error}</p>}
      <div className={styles.actions}>
        {item.workspaceIds.length > 0 && item.target && <button type="button" disabled={busy || item.status === 'purging'} onClick={() => { void action(() => relocateWorkspaceData(item, t('storage:maintenance.mismatch'), t('storage:maintenance.addNew'), t('storage:maintenance.cancel'))) }}>{t('storage:maintenance.relocate')}</button>}
        {item.detachedAt && item.status !== 'purging' && <button type="button" disabled={busy} onClick={() => { void action(async () => { await window.electron.workspaceStorage!.restore(item.id); await refreshWorkspaceDataRecords() }) }}>{t('storage:maintenance.restore')}</button>}
        {item.target && <details className={styles.details}><summary>{t('storage:maintenance.details')}</summary>
          <code className={styles.path}>{item.target}</code>
          <div className={styles.actions}>
            <button type="button" onClick={() => { void navigator.clipboard.writeText(item.target) }}>{t('storage:copy')}</button>
            <button type="button" disabled={busy} onClick={() => { void action(async () => { const size = await window.electron.workspaceStorage!.measure(item.id); setSizes(current => ({ ...current, [item.id]: size })) }) }}>{t('storage:maintenance.measure')}</button>
          </div>
          {sizes[item.id] !== undefined && <p>{(sizes[item.id] / 1024 / 1024).toFixed(2)} MiB</p>}
          {!item.legacy && <div className={styles.actions}>
            <button type="button" disabled={busy} onClick={() => setConfirm({ item, category: 'logs' })}>{t('storage:maintenance.clearLogs')}</button>
            <button type="button" disabled={busy} onClick={() => setConfirm({ item, category: 'checkpoints' })}>{t('storage:maintenance.clearSnapshots')}</button>
            {!item.workspaceIds.length && <button type="button" className={styles.danger} disabled={busy} onClick={() => setConfirm({ item, category: 'all' })}>{t('storage:maintenance.clearAll')}</button>}
          </div>}
        </details>}
      </div>
    </article>)}
    {confirm && <div className={styles.confirm} role="group" aria-label={t('storage:maintenance.confirmTitle')}>
      <strong>{confirm.item.name} · {t('storage:maintenance.confirmTitle')}</strong>
      <p>{t(confirm.category === 'checkpoints' ? 'storage:maintenance.confirmSnapshots' : confirm.category === 'all' ? 'storage:maintenance.confirmAll' : 'storage:maintenance.confirmLogs')}</p>
      <div className={styles.actions}><button type="button" disabled={busy} onClick={() => setConfirm(undefined)}>{t('storage:maintenance.cancel')}</button><button type="button" className={styles.danger} disabled={busy} onClick={() => { void action(async () => { await window.electron.workspaceStorage!.cleanup(confirm.item.id, confirm.category); setConfirm(undefined); setSizes({}) }) }}>{t('storage:maintenance.confirm')}</button></div>
    </div>}
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
