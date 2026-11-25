import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'
import { create } from 'zustand'
import { useBrowserOcclusion } from '@/hooks/useBrowserOcclusion'
import { useOutsidePress } from '@/hooks/useOutsidePress'
import { QUOTA_DETAILS_MS, type CodexQuota, type QuotaReadReason } from '../../../shared/codex-quota'
import styles from './CodexQuotaIndicator.module.css'

// Only the active footer drives reads. The composer observes its confirmed restriction.
const useFooterQuota = create<{ id: string | null; quota: CodexQuota | null }>(() => ({ id: null, quota: null }))

export function CodexQuotaNotice({ id }: { id: string }) {
  const { t, i18n } = useTranslation('terminal')
  const quota = useFooterQuota(state => state.id === id && state.quota?.blocked ? state.quota : null)
  if (!quota) return null
  const resets = [quota.primary, quota.secondary].flatMap(w =>
    w && w.used >= 100 && w.resetsAt && w.resetsAt > Date.now() ? [w.resetsAt] : [])
  return <p role="status" className={styles.notice}>{t('quota.blocked')}
    {resets.length > 0 && ' ' + t('quota.nextReset', { time: formatTime(Math.min(...resets), i18n.language) })}</p>
}

function foreground() { return !document.hidden && document.hasFocus() }
function formatTime(ms: number, language: string) {
  return new Date(ms).toLocaleString(language, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function CodexQuotaIndicator({ id }: { id: string }) {
  const { t, i18n } = useTranslation('terminal')
  const quota = useFooterQuota(s => s.id === id ? s.quota : null)
  const [open, setOpen] = useState(false)
  const [front, setFront] = useState(foreground)
  const [now, setNow] = useState(Date.now)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const read = useCallback((reason: QuotaReadReason) => {
    if (foreground()) void window.electron.terminal.readCodexQuota?.(id, reason).catch(() => {})
  }, [id])
  useLayoutEffect(() => {
    useFooterQuota.setState({ id, quota: null })
    const off = window.electron.terminal.onCodexQuota?.(event => {
      if (event.id !== id) return
      useFooterQuota.setState({ id, quota: event.quota })
      if (!event.quota) setOpen(false)
      if (event.recheck) read('visible')
    })
    const visibility = () => {
      setFront(foreground())
      if (foreground()) { setNow(Date.now()); read('visible') }
    }
    visibility()
    window.addEventListener('focus', visibility)
    window.addEventListener('blur', visibility)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      off?.()
      window.removeEventListener('focus', visibility)
      window.removeEventListener('blur', visibility)
      document.removeEventListener('visibilitychange', visibility)
      if (useFooterQuota.getState().id === id) useFooterQuota.setState({ id: null, quota: null })
    }
  }, [id, read])

  useBrowserOcclusion(open)
  useOutsidePress(open, target => !!root.current?.contains(target), () => setOpen(false))
  useEffect(() => {
    if (!open || !front) return
    const fallback = window.setInterval(() => read('details'), QUOTA_DETAILS_MS)
    const clock = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => { clearInterval(fallback); clearInterval(clock) }
  }, [open, front, read])

  const windows = [quota?.primary, quota?.secondary].filter(w => w != null)
  const primaryReset = quota?.primary?.resetsAt
  const secondaryReset = quota?.secondary?.resetsAt
  useEffect(() => {
    if (!front) return
    const timers = new Set<number>()
    const schedule = (reset: number) => {
      const timer = window.setTimeout(() => {
        timers.delete(timer)
        if (Date.now() < reset) schedule(reset)
        else read('reset')
      }, Math.min(reset - Date.now(), 2_147_483_647))
      timers.add(timer)
    }
    for (const reset of new Set([primaryReset, secondaryReset])) {
      if (reset && reset > Date.now()) schedule(reset)
    }
    return () => timers.forEach(window.clearTimeout)
  }, [primaryReset, secondaryReset, front, read])

  if (!quota) return null
  const duration = (minutes: number | null) => {
    if (!minutes) return t('quota.window')
    if (minutes % 1440 === 0) return t('quota.days', { n: minutes / 1440 })
    if (minutes % 60 === 0) return t('quota.hours', { n: minutes / 60 })
    return t('quota.minutes', { n: minutes })
  }
  const summary = windows.map(w => duration(w.minutes) + ' ' + (100 - w.used) + '%')
  const tightest = windows.reduce((a, b) => a.used >= b.used ? a : b, windows[0])
  const stamp = (ms: number) => formatTime(ms, i18n.language)
  return <div ref={root} className={styles.root} data-codex-quota=""
    onClick={event => event.stopPropagation()}
    onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}
    onKeyDown={event => {
      if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); button.current?.focus() }
    }}>
    <button type="button" ref={button} className={styles.trigger} aria-expanded={open} aria-controls={open ? panelId : undefined}
      onClick={() => {
        if (!open) { setNow(Date.now()); read('visible') }
        setOpen(!open)
      }}>
      <span>{t(windows.length ? 'quota.remaining' : 'quota.title')}</span>
      {tightest && <><span className={styles.wide}>{summary.join(' · ')}</span>
        <span className={styles.narrow}>{duration(tightest.minutes)} {100 - tightest.used}%</span></>}
    </button>
    {open && <section id={panelId} className={styles.panel} aria-label={t('quota.title')}>
      <header><strong>{t('quota.title')}</strong><button type="button" aria-label={t('quota.refresh')} title={t('quota.refresh')}
        onClick={() => read('manual')}><RefreshCw size={13} aria-hidden="true" /></button></header>
      {windows.map((w, i) => <div className={styles.row} key={i}>
        <span>{duration(w.minutes)}</span><strong>{t('quota.left', { n: 100 - w.used })}</strong>
        {w.resetsAt !== null && <small>{t('quota.resets', { time: stamp(w.resetsAt) })}{w.resetsAt > now && ' · ' + t('quota.inMinutes', { n: Math.ceil((w.resetsAt - now) / 60_000) })}</small>}
      </div>)}
      {quota.unavailable || !windows.length ? <p role="status">{t(quota.unavailable || quota.updatedAt !== null ? 'quota.unavailable' : 'quota.loading')}</p> : null}
      {quota.updatedAt !== null && <small>{t('quota.updated', { time: stamp(quota.updatedAt) })}</small>}
    </section>}
  </div>
}
