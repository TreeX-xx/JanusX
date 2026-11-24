// Note: .agents/notes/desktop/browser-control.md
import { useEffect, useState } from 'react'
import { RefreshCw, Plug, Trash2, CheckCircle2 } from 'lucide-react'
import { Button, SettingsSection, SettingsRow, settingsStyles as styles } from '@janusx/ui'
import { useI18n } from '@/i18n/useI18n'
import { TerminalPresetIcon } from './ui/TerminalPresetIcon'
import type { BrowserClientStatus, ControlKind } from '../../../shared/ipc/control'
import layout from './BrowserTerminalSettings.module.css'

export function BrowserTerminalSettings({ onManage, kind = 'browser' }: { onManage?: () => void; kind?: ControlKind }) {
  const { t } = useI18n('control')
  const [clients, setClients] = useState<BrowserClientStatus[]>([])
  const [busy, setBusy] = useState(true)
  const [message, setMessage] = useState('')
  const [error, setError] = useState(false)
  const [removal, setRemoval] = useState<BrowserClientStatus>()
  const text = (key: string) => t((kind === 'computer' ? 'computerTerminals.' : 'terminals.') + key)
  const refresh = async () => setClients(await window.electron.controls.clients(kind))
  useEffect(() => {
    let cancelled = false
    window.electron.controls.clients(kind).then(rows => { if (!cancelled) setClients(rows) }).catch(cause => {
      if (!cancelled) { setMessage(String(cause)); setError(true) }
    }).finally(() => { if (!cancelled) setBusy(false) })
    return () => { cancelled = true }
  }, [kind])
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(false); setMessage('')
    try { await action(); await refresh() }
    catch (cause) { setError(true); setMessage(cause instanceof Error ? cause.message : String(cause)); await refresh().catch(() => {}) }
    finally { setBusy(false) }
  }
  return <SettingsSection aria-busy={busy} data-browser-terminal-settings={kind === 'browser' || undefined} data-control-terminal-settings={kind}>
    <h3>{t('terminals.title')}</h3>
    <p className={styles.hint}>{text('hint')}</p>
    <div className={styles.actions}>
      {onManage && <Button onClick={onManage}>{t('terminals.manage')}</Button>}
      <Button disabled={busy} onClick={() => void run(refresh)}><RefreshCw size={14} />{t('terminals.refresh')}</Button>
    </div>
    {clients.map(client => <SettingsRow key={client.id} data-browser-client={client.id} className={layout.clientRow}>
      <div className={styles.clientIdentity}>
        <span className={styles.clientIcon}><TerminalPresetIcon preset={client.id} /></span>
        <div className={styles.label}><span className={styles.labelText}>{client.label} · {t(`terminals.state.${client.state}`)}</span>
          <span className={styles.hint}>{client.id === 'pi' ? text('pi') : text('mcp')}</span>
          {client.path && <span className={styles.hint}>{client.path}</span>}
        </div>
      </div>
      <div className={styles.actions}>
        {client.state === 'configured' && <>
          <Button size="small" disabled={busy} onClick={() => void run(async () => {
            const result = await window.electron.controls.probeClient(client.id, client.revision, kind)
            if (!result.ok) throw new Error(result.error ?? text('failed'))
            setMessage(t('terminals.checked', { client: client.label, count: result.tools ?? 0 }))
          })}><CheckCircle2 size={14} />{t('terminals.check')}</Button>
          <Button size="small" variant="danger" disabled={busy} onClick={() => setRemoval(client)}><Trash2 size={14} />{t('terminals.remove')}</Button>
        </>}
        <Button size="small" disabled={busy || client.state === 'conflict' || client.state === 'unavailable'} onClick={() => void run(async () => {
          await window.electron.controls.changeClient({ client: client.id, expectedRevision: client.revision, action: 'import' }, kind)
          setMessage(t('terminals.imported', { client: client.label }))
        })}><Plug size={14} />{t(client.state === 'configured' ? 'terminals.update' : 'terminals.import')}</Button>
      </div>
    </SettingsRow>)}
    {removal && <div className={styles.label} role="group" aria-label={t('terminals.remove')}>
      <p className={styles.hint}>{t(kind === 'computer' ? 'computerTerminals.removeHint' : 'terminals.removeHint', { client: removal.label })} {removal.path}</p>
      <div className={styles.actions}>
        <Button disabled={busy} onClick={() => setRemoval(undefined)}>{t('terminals.cancel')}</Button>
        <Button variant="danger" disabled={busy} onClick={() => void run(async () => {
          await window.electron.controls.changeClient({ client: removal.id, expectedRevision: removal.revision, action: 'remove' }, kind)
          setMessage(t('terminals.removed', { client: removal.label })); setRemoval(undefined)
        })}>{t('terminals.confirmRemove')}</Button>
      </div>
    </div>}
    {message && <p className={`${styles.status} ${error ? styles.statusError : styles.statusSuccess}`} role={error ? 'alert' : 'status'}>{message}</p>}
  </SettingsSection>
}
