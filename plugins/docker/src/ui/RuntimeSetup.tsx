import { useEffect, useRef, useState } from 'react'
import { Download, LoaderCircle } from 'lucide-react'
import { call } from './bridge'
import { useLocale, errorText } from './i18n'
import type { RuntimeStatus } from '../shared/docker'

export function RuntimeSetup({ onReady }: { onReady(): void }) {
  const t = useLocale(), [status, setStatus] = useState<RuntimeStatus>({ phase: 'checking', busy: false }), [error, setError] = useState('')
  const ready = useRef(onReady); ready.current = onReady
  const attached = useRef(false)
  const apply = (next: RuntimeStatus) => {
    setStatus(next)
    if (next.phase === 'ready' && !next.busy && !attached.current) { attached.current = true; ready.current() }
  }
  useEffect(() => {
    let disposed = false, pending = false
    void call<RuntimeStatus>('runtime.inspect').then(next => { if (!disposed) apply(next) }).catch(cause => { if (!disposed) setError(errorText(cause)) })
    const timer = setInterval(() => {
      if (pending) return; pending = true
      void call<RuntimeStatus>('runtime.status').then(next => { if (!disposed) apply(next) }).catch(cause => { if (!disposed) setError(errorText(cause)) }).finally(() => { pending = false })
    }, 1000)
    return () => { disposed = true; clearInterval(timer) }
  }, [])
  const prepare = async () => {
    setError(''); attached.current = false
    try { apply(await call<RuntimeStatus>('runtime.prepare')) } catch (cause) { setError(errorText(cause)) }
  }
  if (status.phase === 'unsupported') return <p className="hint">{t('runtime_unsupported')}</p>
  const phase = t(`runtime_${status.phase}`), canPrepare = !status.busy && !['checking', 'ready'].includes(status.phase)
  return <section className="runtime-setup" aria-label={t('runtimeTitle')}>
    <div className="runtime-heading">{status.busy ? <LoaderCircle size={15} className="spin"/> : <Download size={15}/>}<strong>{t('runtimeTitle')}</strong></div>
    <p>{t('runtimeHelp')}</p>
    <p role="status">{phase}{status.progress !== undefined && ` · ${status.progress}%`}</p>
    {status.busy && <progress aria-label={phase} max={100} value={status.progress}/>}
    {status.phase === 'restart-required' && <p>{t('runtimeRestartHelp')}</p>}
    {status.phase === 'error' && <p className="error-text" role="alert">{errorText(status.error ?? '')}</p>}
    {error && <p className="error-text" role="alert">{error}</p>}
    {canPrepare && <button className="primary" onClick={() => { void prepare() }}>{t(status.phase === 'stopped' ? 'runtimeStart' : status.phase === 'restart-required' ? 'runtimeContinue' : 'runtimeInstall')}</button>}
    <small>{t('runtimeDataHelp')}</small>
  </section>
}
