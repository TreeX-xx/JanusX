import { useEffect, useId, useRef, useState } from 'react'
import { ArrowUpRight, ChevronDown, LoaderCircle, Monitor, Power, QrCode, Settings2, ShieldCheck, Smartphone, Terminal, X } from 'lucide-react'
import { useWorkspaceStore } from '@/stores/workspace'
import { useAppStore } from '@/stores/app'
import { useExperimentalStore } from '@/stores/experimental'
import { useI18n } from '@/i18n/useI18n'
import type { MobileHostStatus } from '../../../shared/ipc/remote'
import { mobileRemoteSettings } from '@/lib/mobile-remote-settings'
import remoteDefaults from '../../../shared/remote-defaults.json'
import { REMOTE_LAN_ONLY, REMOTE_SETTINGS_PREFIX } from '../../../shared/remote-scope'
import styles from './StatusBar.module.css'
// Note: .agents/notes/remote/android-pairing-handshake.md
export function StatusBar() {
  const { t } = useI18n()
  const [remote, setRemote] = useState<MobileHostStatus | null>(null); const [open, setOpen] = useState(false)
  const secondsLeft = Math.max(0, Math.ceil(((remote?.expiresAt ?? 0) - Date.now()) / 1000))
  const qrCountdown = `${Math.floor(secondsLeft / 60).toString().padStart(2, '0')}:${(secondsLeft % 60).toString().padStart(2, '0')}`
  const [error, setError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const enabled = useExperimentalStore(s => s.loaded && s.remoteControl)
  const activeWorkspaceId = useWorkspaceStore(s => s.activeWorkspaceId)
  const [workspaceId, setWorkspaceId] = useState('')
  const [busy, setBusy] = useState(false)
  const [initialSettings] = useState(() => mobileRemoteSettings(key => localStorage.getItem(key)))
  const [network, setNetwork] = useState(initialSettings.network)
  const [signalUrl, setSignalUrl] = useState(initialSettings.signalUrl)
  const [stunUrl, setStunUrl] = useState(initialSettings.stunUrl)
  const [localAddress, setLocalAddress] = useState('')
  useEffect(() => {
    if (!open) return
    panelRef.current?.focus({ preventScroll: true })
    const close = () => { setOpen(false); triggerRef.current?.focus() }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close() } }
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !panelRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onPointer) }
  }, [open])
  useEffect(() => {
    try {
      for (const [key, value] of Object.entries({ network, signalUrl, stunUrl })) localStorage.setItem(`${REMOTE_SETTINGS_PREFIX}${key}`, value)
    } catch { /* The current configuration still works when storage is unavailable. */ }
  }, [network, signalUrl, stunUrl])
  useEffect(() => {
    if (!enabled) { setOpen(false); setRemote(null); return }
    let cancelled = false
    const refresh = () => void window.electron.remote.status().then(value => { if (!cancelled) setRemote(value) }).catch(reason => { if (!cancelled) setError(String(reason)) })
    refresh()
    const timer = setInterval(refresh, 1000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [enabled])
  const act = async (action: () => Promise<MobileHostStatus>) => {
    if (busy) return
    setBusy(true)
    setError('')
    try { setRemote(await action()) } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  const selectedWorkspaceId = workspaceId || activeWorkspaceId || ''
  const start = () => {
    const workspace = remote?.workspaces.find(item => item.id === selectedWorkspaceId)
    if (!workspace) { setError(t('common:mobileRemote.workspaceRequired')); return }
    if (network === 'public') {
      try {
        const url = new URL(signalUrl.trim())
        if (url.protocol !== 'wss:' || url.username || url.password || url.hash) throw Error()
      } catch { setSettingsOpen(true); setError(t('common:mobileRemote.signalRequired')); return }
    }
    void act(() => window.electron.remote.start({ signalUrl: network === 'public' ? signalUrl.trim() : '', stunUrl: stunUrl.trim(),
      workspaceId: workspace.id, localAddress: network === 'lan' ? localAddress || remote?.lanAddresses?.[0]?.address : undefined }))
  }
  const showTerminal = (id: string) => {
    if (!remote?.workspaceId) return
    const store = useWorkspaceStore.getState()
    if (store.activeWorkspaceId !== remote.workspaceId) store.setActiveWorkspace(remote.workspaceId)
    useWorkspaceStore.getState().setActiveTerminal(id)
    useAppStore.getState().setActiveWorkbench(null)
    useAppStore.getState().setLoadState('terminal-active')
    setOpen(false)
  }
  if (!enabled) return null
  return <footer className="relative flex h-7 items-center justify-end px-3.5 text-[10px]" style={{ background: 'var(--shell-chrome)', borderTop: '1px solid var(--shell-border)', color: 'var(--shell-dim)' }}>
    <div className={styles.remoteStatus}>
      {remote?.running && !remote.connectedDeviceId && !remote.pending && <span role="status" className={styles.statusText} title={remote.state}>{remote.state}</span>}
      {remote?.pending && <span className={styles.pendingText}>{t('common:mobileRemote.pending')}</span>}
      {remote?.connectedDeviceId && <span>{t('common:mobileRemote.connected', { count: remote.terminals.filter(item => item.alive).length })}</span>}
      <button ref={triggerRef} type="button" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(v => !v)} className={styles.trigger}>
        <Smartphone size={13} aria-hidden="true" />{t(remote?.running ? 'common:mobileRemote.running' : 'common:mobileRemote.enable')}
      </button>
    </div>
    {open && <div ref={panelRef} role="dialog" aria-labelledby={titleId} tabIndex={-1} className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.heading}><Smartphone size={18} strokeWidth={1.6} aria-hidden="true" /><h2 id={titleId}>{t('common:mobileRemote.title')}</h2></div>
        <button type="button" className={styles.iconButton} aria-label={t('common:action.close')} onClick={() => { setOpen(false); triggerRef.current?.focus() }}><X size={16} /></button>
      </div>
      <div className={styles.body}>
        <p className={styles.intro}>{t('common:mobileRemote.pairingHint')}</p>
        {REMOTE_LAN_ONLY && <p className={styles.hint}>{t('common:mobileRemote.lanTestHint')}</p>}
        <div role="status" className={styles.connectionStatus}>
          <span className={`${styles.statusDot} ${remote?.connectedDeviceId ? styles.connectedDot : ''}`} aria-hidden="true" />
          <span>{remote?.pending ? t('common:mobileRemote.approvalStatus') : remote?.state}</span>
        </div>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {remote?.running ? <div className={styles.sessionSummary}>
          <span><Monitor size={14} aria-hidden="true" />{remote.workspaces.find(item => item.id === remote.workspaceId)?.name}</span>
          <span>{t(network === 'public' ? 'common:mobileRemote.public' : 'common:mobileRemote.lan')}</span>
        </div> : <><label className={styles.field}>
          <span>{t('common:mobileRemote.workspace')}</span>
          <div className={styles.selectWrap}>
            <select aria-label={t('common:mobileRemote.workspace')} disabled={busy || remote?.running} value={remote?.workspaceId || selectedWorkspaceId} onChange={event => setWorkspaceId(event.target.value)}>
              <option value="" disabled>{t('common:mobileRemote.chooseWorkspace')}</option>
              {remote?.workspaces.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select><ChevronDown size={14} aria-hidden="true" />
          </div>
        </label>
        <label className={styles.field}>
          <span>{t('common:mobileRemote.network')}</span>
          <div className={styles.selectWrap}>
            <select aria-label={t('common:mobileRemote.network')} disabled={busy || remote?.running} value={network} onChange={event => setNetwork(event.target.value)}>
              {!REMOTE_LAN_ONLY && <option value="public">{t('common:mobileRemote.public')}</option>}
              <option value="lan">{t('common:mobileRemote.lan')}</option>
            </select><ChevronDown size={14} aria-hidden="true" />
          </div>
        </label></>}
        <button type="button" className={styles.disclosure} aria-expanded={settingsOpen} onClick={() => setSettingsOpen(value => !value)}>
          <Settings2 size={14} aria-hidden="true" /><span>{t('common:mobileRemote.connectionSettings')}</span><ChevronDown size={14} className={settingsOpen ? styles.expanded : ''} aria-hidden="true" />
        </button>
        {settingsOpen && <div className={styles.settings}>
          {network === 'lan' ? <label className={styles.field}>
            <span>{t('common:mobileRemote.localAddress')}</span>
            <div className={styles.selectWrap}>
              <select aria-label={t('common:mobileRemote.localAddress')} disabled={busy || remote?.running} value={localAddress || remote?.lanAddresses?.[0]?.address || ''} onChange={event => setLocalAddress(event.target.value)}>
                {remote?.lanAddresses?.map(item => <option key={`${item.name}-${item.address}`} value={item.address}>{item.name} · {item.address}</option>)}
              </select><ChevronDown size={14} aria-hidden="true" />
            </div>
          </label> : <label className={styles.field}>
            <span>{t('common:mobileRemote.signalUrl')}</span>
            <input disabled={busy || remote?.running} value={signalUrl} onChange={event => setSignalUrl(event.target.value)} placeholder={remoteDefaults.signalUrl} spellCheck={false} />
          </label>}
          {!REMOTE_LAN_ONLY && <label className={styles.field}>
            <span>{t('common:mobileRemote.stunUrl')}</span>
            <input disabled={busy || remote?.running} value={stunUrl} onChange={event => setStunUrl(event.target.value)} placeholder="stun:stun.l.google.com:19302" spellCheck={false} />
          </label>}
          <p className={styles.hint}>{t(network === 'public' ? 'common:mobileRemote.publicHint' : 'common:mobileRemote.lanHint')}</p>
          {remote?.signalUrl && <p className={styles.endpoint}>{t('common:mobileRemote.actualSignal', { url: remote.signalUrl })}</p>}
        </div>}
        {remote?.pending && <section className={styles.request}>
          <div className={styles.rowLabel}><ShieldCheck size={16} aria-hidden="true" /><span>{t('common:mobileRemote.request', { name: remote.pending.name })}</span></div>
          <div className={styles.requestActions}>
            <button type="button" disabled={busy} className={styles.secondaryButton} onClick={() => void act(() => window.electron.remote.reject())}>{t('common:mobileRemote.reject')}</button>
            <button type="button" disabled={busy} className={styles.primaryButton} onClick={() => void act(() => window.electron.remote.approve(remote.pending!.id))}>{t('common:mobileRemote.approve')}</button>
          </div>
        </section>}
        {remote?.qr ? <section className={styles.pairing} aria-label={t('common:mobileRemote.qrAlt')}>
          <div className={styles.qrSurface}>
            {secondsLeft > 0 ? <img alt={t('common:mobileRemote.qrAlt')} src={remote.qr} /> : <div className={styles.qrLoading}><LoaderCircle size={24} className={styles.spinner} aria-hidden="true" /><span>{t('common:mobileRemote.qrRefreshing')}</span></div>}
          </div>
          <p role="timer" className={styles.countdown}>{t(secondsLeft > 0 ? 'common:mobileRemote.qrCountdown' : 'common:mobileRemote.qrRefreshing', { time: qrCountdown })}</p>
          <p className={styles.hint}>{t('common:mobileRemote.qrRefreshHint')}</p>
          {remote.qrError && <p role="alert" className={styles.error}>{t('common:mobileRemote.qrRefreshFailed')}: {remote.qrError}</p>}
        </section> : <button type="button" disabled={busy} className={styles.primaryButton} onClick={start}>
          {busy ? <LoaderCircle size={15} className={styles.spinner} aria-hidden="true" /> : <QrCode size={15} aria-hidden="true" />}
          {t(busy ? 'common:mobileRemote.starting' : 'common:mobileRemote.generateQr')}
        </button>}
        {Boolean(remote?.devices.length) && <section className={styles.list}>
          <h3>{t('common:mobileRemote.devicesTitle')}</h3>
          {remote?.devices.map(device => <div key={device.id} className={styles.listRow}>
            <div className={styles.rowLabel}><Smartphone size={15} aria-hidden="true" /><span>{t('common:mobileRemote.authorized', { name: device.name })}</span></div>
            <button type="button" disabled={busy} className={styles.textButton} onClick={() => void act(() => window.electron.remote.revoke(device.id))}>{t('common:mobileRemote.revoke')}</button>
          </div>)}
        </section>}
        {Boolean(remote?.terminals.length) && <section className={styles.list}>
          <h3>{t('common:mobileRemote.terminalsTitle')}</h3>
          {remote?.terminals.map(item => <div key={item.id} className={styles.listRow}>
            <div className={styles.rowLabel}><Terminal size={15} aria-hidden="true" /><span>{t('common:mobileRemote.terminal', { state: t(item.alive ? 'common:mobileRemote.alive' : 'common:mobileRemote.exited'), pid: item.pid })}</span></div>
            <button type="button" className={styles.textButton} onClick={() => showTerminal(item.id)}>{t('common:mobileRemote.showTerminal')}<ArrowUpRight size={12} aria-hidden="true" /></button>
          </div>)}
        </section>}
      </div>
      <div className={styles.panelFooter}>
        <span className={styles.footerHint}><Monitor size={13} aria-hidden="true" />{t('common:mobileRemote.localApproval')}</span>
        {remote?.running && <button type="button" disabled={busy} className={styles.textButton} onClick={() => void act(() => window.electron.remote.stop())}><Power size={13} aria-hidden="true" />{t('common:mobileRemote.stop')}</button>}
      </div>
    </div>}
  </footer>
}
