import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, RefreshCw } from 'lucide-react'
import { call } from './bridge'
import { useLocale, errorText } from './i18n'
import { EnvironmentSelect } from './EnvironmentSelect'
import type { DockerTarget, EnvironmentState } from '../shared/docker'

export function RuntimeSetup({ environment, onState, onSelect, onReady, locked }: {
  environment: EnvironmentState; onState(state: EnvironmentState): void; onSelect(target: DockerTarget): Promise<void>; onReady(): void; locked: boolean
}) {
  const t = useLocale(), [error, setError] = useState(''), [confirm, setConfirm] = useState(false)
  const latest = useRef({ onState, onReady, revision: environment.revision, locked }); latest.current = { onState, onReady, revision: environment.revision, locked }
  const attached = useRef(false), status = environment.status, target = environment.target
  const key = target.kind === 'wsl' ? `wsl:${target.distribution}` : target.kind
  const apply = (next: EnvironmentState) => {
    if (next.revision < latest.current.revision) return
    latest.current.onState(next)
    if (next.target.kind !== 'local' && next.status.phase === 'ready' && !next.status.busy && !latest.current.locked && !attached.current) { attached.current = true; latest.current.onReady() }
  }
  useEffect(() => {
    attached.current = false; setConfirm(false); setError('')
    let disposed = false, pending = false
    void call('runtime.inspect', { refresh: true }).catch(cause => { if (!disposed) setError(errorText(cause)) })
    void call('environment.discover').catch(() => {})
    const timer = setInterval(() => {
      if (pending) return; pending = true
      void call<EnvironmentState>('environment.read').then(next => { if (!disposed) apply(next) }).catch(cause => { if (!disposed) setError(errorText(cause)) }).finally(() => { pending = false })
    }, 1000)
    return () => { disposed = true; clearInterval(timer) }
  }, [key])
  const prepare = async (install = false) => {
    setError(''); attached.current = false; setConfirm(false)
    try { await call('runtime.prepare', { install }); apply(await call<EnvironmentState>('environment.read')) } catch (cause) { setError(errorText(cause)) }
  }
  const phase = t(`runtime_${status.phase}`), canPrepare = target.kind !== 'local' && !status.busy && !['checking', 'ready', 'unsupported'].includes(status.phase)
  return <section className="runtime-setup" aria-label={t('environment')}>
    <div className="runtime-heading"><strong>{t('environment')}</strong><button className="icon" aria-label={t('detectEnvironments')} disabled={locked || status.busy || environment.discovering} onClick={() => {
      void call('environment.discover').catch(cause => setError(errorText(cause)))
      void call('runtime.inspect', { refresh: true }).catch(cause => setError(errorText(cause)))
    }}><RefreshCw size={13}/></button></div>
    <EnvironmentSelect environment={environment} disabled={locked || status.busy || target.kind !== 'local' && status.phase === 'checking'} onSelect={next => { void onSelect(next).catch(cause => setError(errorText(cause))) }}/>
    <p>{t(target.kind === 'local' ? 'existingDockerHelp' : target.kind === 'wsl' ? 'existingWslHelp' : 'runtimeHelp')}</p>
    {environment.discovering && <small>{t('detectingEnvironments')}</small>}
    {environment.discoveryError && <small>{t('wslDetectionFailed')}</small>}
    {target.kind !== 'local' && <>
      <p role="status">{status.busy && <LoaderCircle size={13} className="spin"/>}{phase}{status.progress !== undefined && ` · ${status.progress}%`}</p>
      {status.busy && <progress aria-label={phase} max={100} value={status.progress}/>}
      {status.phase === 'restart-required' && <p>{t('runtimeRestartHelp')}</p>}
      {status.phase === 'error' && <p className="error-text" role="alert">{errorText(status.error ?? '')}</p>}
      {status.phase === 'unsupported' && <p>{t('ubuntuOnly')}</p>}
      {canPrepare && !confirm && <button className="primary" disabled={locked} onClick={() => {
        if (target.kind === 'wsl' && status.phase !== 'stopped') setConfirm(true); else void prepare()
      }}>{t(status.phase === 'stopped' ? 'runtimeStart' : status.phase === 'restart-required' ? 'runtimeContinue' : target.kind === 'wsl' ? 'installInUbuntu' : 'runtimeInstall')}</button>}
      {confirm && <div className="install-confirm"><p>{t('installInUbuntuConfirm').replace('{name}', target.kind === 'wsl' ? target.distribution : '')}</p><div><button className="primary" onClick={() => { void prepare(true) }}>{t('confirmInstall')}</button><button onClick={() => setConfirm(false)}>{t('cancel')}</button></div></div>}
      <small>{t(target.kind === 'wsl' ? 'existingWslDataHelp' : 'runtimeDataHelp')}</small>
    </>}
    {error && <p className="error-text" role="alert">{error}</p>}
  </section>
}
