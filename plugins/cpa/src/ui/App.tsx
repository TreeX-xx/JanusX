import { useEffect, useRef, useState } from 'react'
import { Settings, ExternalLink, KeyRound, X } from 'lucide-react'
import { CpaSettingsPanel } from './CpaSettingsPanel'
import { useCpaStore } from './store'
import { call, cpa } from './bridge'
import { useI18n, cpaError } from './i18n'
import styles from './Cpa.module.css'

export function App({ settingsPage }: {settingsPage: boolean}) {
  const { t } = useI18n()
  const settings = useCpaStore(state => state.settings), status = useCpaStore(state => state.status)
  const [configure, setConfigure] = useState(settingsPage), [opened, setOpened] = useState(false)
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [retry, setRetry] = useState(0)
  const [fallback, setFallback] = useState<{provider: string; port: number; reason: string} | null>(null)
  const started = useRef(false)
  useEffect(() => { void useCpaStore.getState().load().catch(cause => setError(cpaError(cause))) }, [])
  useEffect(() => {
    let disposed = false
    const refresh = async () => {
      try {
        const [next, settings] = await Promise.all([cpa.status(), cpa.getSettings()])
        if (!disposed) {
          useCpaStore.setState(current => ({status: next, ...(JSON.stringify(current.settings) !== JSON.stringify(settings) ? {settings} : {})}))
          if (next.operationError) setError(cpaError(next.operationError))
        }
      } catch (cause) { if (!disposed) setError(cpaError(cause)) }
    }
    void refresh(); const timer = setInterval(() => { void refresh() }, 1500)
    return () => { disposed = true; clearInterval(timer) }
  }, [])
  useEffect(() => {
    if (!settings || settingsPage || started.current || settings.mode === 'managed' && !settings.enabled) return
    started.current = true
    void cpa.start().catch(cause => setError(cpaError(cause)))
  }, [settings, settingsPage])
  const canShow = !settingsPage && !configure && settings && !status?.busy && (settings.mode === 'external' || status?.phase === 'running')
  useEffect(() => {
    let disposed = false
    setOpened(false)
    void call('browser.close').then(async () => {
      if (canShow && !disposed) { await call('browser.open'); if (!disposed) setOpened(true) }
    }).catch(cause => { if (!disposed) setError(cpaError(cause)) })
    return () => { disposed = true }
  }, [Boolean(canShow), settings?.managementUrl, settings?.mode, status?.revision, retry])
  useEffect(() => {
    if (!opened) return
    let disposed = false
    const poll = async () => {
      try {
        const result = await call<{fallback: typeof fallback; externalError: boolean; error: boolean}>('browser.status')
        if (!disposed) { setFallback(result.fallback); if (result.externalError || result.error) setError(t('common:cpa.openFailed')) }
      } catch { /* Page invalidation revokes the browser as well. */ }
    }
    const timer = setInterval(() => { void poll() }, 1500)
    return () => { disposed = true; clearInterval(timer) }
  }, [opened])
  const action = (operation: () => Promise<void>, success = '') => { setError(''); void operation().then(() => setNotice(success)).catch(cause => setError(cpaError(cause))) }
  return <div className={styles.shell}>
    <header className={styles.toolbar}>
      <span className="runtime-label">CPA · {settings?.mode === 'external' ? t('common:cpa.external') : status ? t(`common:cpa.phase.${status.phase}`) : t('common:status.loading')}</span>
      {settings?.mode === 'managed' && settings.enabled && <button aria-label={t('common:cpa.copyKey')} title={t('common:cpa.copyKey')} onClick={() => action(cpa.copyManagementKey,t('common:cpa.keyCopied'))}><KeyRound size={15}/></button>}
      <button aria-label={t('common:cpa.openExternal')} title={t('common:cpa.openExternal')} onClick={() => action(() => call('browser.external'))}><ExternalLink size={15}/></button>
      {!settingsPage && <button aria-label={t('common:cpa.configure')} title={t('common:cpa.configure')} onClick={() => { setOpened(false); setConfigure(value => !value) }}><Settings size={15}/></button>}
      {configure && !settingsPage && <button aria-label={t('common:action.close')} onClick={() => setConfigure(false)}><X size={15}/></button>}
    </header>
    {error && <p className={styles.oauthNotice} role="alert">{error}<button onClick={() => { setRetry(value => value + 1); action(cpa.start) }}>{t('common:action.retry')}</button></p>}
    {notice && <p className={styles.oauthNotice} role="status" onClick={() => setNotice('')}>{notice}</p>}
    {fallback && <div className={styles.oauthNotice} role="status"><strong>{t('common:cpa.oauthManual',fallback)}</strong><p>{t(`common:cpa.oauthReason.${fallback.reason}`)} {t('common:cpa.oauthManualHelp')}</p></div>}
    {configure || settings?.mode === 'managed' && !settings.enabled
      ? <div className={styles.setup}><CpaSettingsPanel onOpened={() => { if (!settingsPage) setConfigure(false) }}/></div>
      : canShow && opened ? <OnlinePage/> : <div className={styles.message} role="status">
        <p>{status ? t(`common:cpa.phase.${status.phase}`) : t('common:status.loading')}{status?.progress !== undefined ? ` · ${status.progress}%` : ''}</p>
        <button onClick={() => action(cpa.start)}>{t('common:cpa.start')}</button>
      </div>}
  </div>
}

function OnlinePage() {
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const sync = () => {
      const rect = body.current?.getBoundingClientRect()
      if (rect) void call('browser.bounds',{rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}}).catch(() => {})
    }
    const observer = new ResizeObserver(sync)
    if (body.current) observer.observe(body.current)
    sync()
    return () => { observer.disconnect(); void call('browser.bounds',{rect:{x:0,y:0,width:0,height:0}}).catch(() => {}) }
  }, [])
  return <div ref={body} className="online-page"/>
}
