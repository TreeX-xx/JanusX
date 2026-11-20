import { useEffect, useMemo, useRef, useState } from 'react'
import type { UsageLedgerPage, UsageEngine } from '../../../shared/usage'
import { useI18n } from '@/i18n/useI18n'
import { aggregateUsageHeatmap, usageHeatmapStart } from '@/lib/usage-stats'
import { loadUsageLedger } from '@/services/usage'
import styles from './UsageStatsPanel.module.css'

export function UsageHeatmap({ engine }: { engine?: UsageEngine }) {
  const { t, currentLanguage } = useI18n()
  const [snapshot, setSnapshot] = useState<{ page: UsageLedgerPage; now: number; engine?: UsageEngine }>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [active, setActive] = useState<string>()
  const scrollRef = useRef<HTMLDivElement>(null)
  const cellsRef = useRef<Array<HTMLButtonElement | null>>([])
  const hasSnapshot = Boolean(snapshot)
  useEffect(() => {
    let cancelled = false
    let pending = false
    setLoading(true)
    setActive(undefined)
    const refresh = async () => {
      if (pending) return
      pending = true
      const now = Date.now()
      try {
        const page = await loadUsageLedger({ start: usageHeatmapStart(now), end: now, engine })
        if (!cancelled) {
          setSnapshot({ page: { ...page, records: page.records.filter(record => !engine || record.engine === engine) }, now, engine })
          setError(Boolean(page.warning))
        }
      } catch {
        if (!cancelled) setError(true)
      } finally {
        pending = false
        if (!cancelled) setLoading(false)
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 60_000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [engine])
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = scrollRef.current.scrollWidth
  }, [hasSnapshot])
  // Keep the settled calendar together while a different engine loads.
  const days = useMemo(() => aggregateUsageHeatmap(snapshot?.page.records ?? [], snapshot?.now ?? Date.now()), [snapshot])
  const selected = days.find(day => day.key === active) ?? [...days].reverse().find(day => !day.future)!
  const total = days.reduce((sum, day) => sum + day.totalTokens, 0)
  const activeDays = days.filter(day => day.totalTokens > 0).length
  const missingDsh = snapshot?.engine === 'dsh' && !snapshot.page.sessions.some(session => session.engine === 'dsh')
  const unavailable = (snapshot?.engine === 'janus' || missingDsh) && snapshot.page.records.length === 0
  const dateFormat = new Intl.DateTimeFormat(currentLanguage, { year: 'numeric', month: 'short', day: 'numeric' })
  const describe = (day: typeof selected) => `${dateFormat.format(day.at)} · ${unavailable ? '–' : !snapshot ? (loading ? t('settings:usageStats.heatmapLoading') : '–') : day.totalTokens.toLocaleString(currentLanguage) + ' tokens'}`
  return (
    <section className={styles.heatmapSection} aria-label={t('settings:usageStats.heatmapTitle')} aria-busy={loading} data-testid="usage-heatmap">
      <div className={styles.toolbar}>
        <div><h4 className={styles.title}>{t('settings:usageStats.heatmapTitle')}</h4><p className={styles.subtitle}>{t('settings:usageStats.heatmapPeriod')}</p></div>
        <span className={styles.heatmapTotal} data-testid="usage-heatmap-total">{snapshot && !unavailable ? total.toLocaleString(currentLanguage) : '–'} <small>tokens</small></span>
      </div>
      <div className={loading ? styles.dimmed : undefined}>
        <div className={styles.heatmapScroll} ref={scrollRef}>
          <div className={styles.heatmapCalendar}>
            <div className={styles.heatmapMonths} aria-hidden="true">
              {Array.from({ length: 53 }, (_, week) => {
                const day = days[week * 7]
                const next = days[Math.min(week * 7 + 6, days.length - 1)]
                return <span key={day.key}>{(week === 0 || new Date(day.at).getMonth() !== new Date(next.at).getMonth() || new Date(day.at).getDate() === 1) && !day.future ? new Intl.DateTimeFormat(currentLanguage, { month: 'short' }).format(next.at) : ''}</span>
              })}
            </div>
            <div className={styles.heatmapBody}>
              <div className={styles.heatmapWeekdays} aria-hidden="true">{[0, 1, 2, 3, 4, 5, 6].map(day => <span key={day}>{day % 2 === 1 ? new Intl.DateTimeFormat(currentLanguage, { weekday: 'short' }).format(new Date(2026, 0, 4 + day)) : ''}</span>)}</div>
              <div className={styles.heatmapGrid} role="group" aria-label={t('settings:usageStats.heatmapPeriod')}>
                {days.map((day, index) => <button
                  key={day.key} ref={node => { cellsRef.current[index] = node }} type="button"
                  className={styles.heatmapDay} data-level={day.level} data-date={day.key} data-future={day.future || undefined}
                  disabled={!snapshot || unavailable || day.future} tabIndex={day.key === selected.key ? 0 : -1}
                  title={describe(day)} aria-label={describe(day)}
                  onMouseEnter={() => setActive(day.key)} onFocus={() => setActive(day.key)}
                  onKeyDown={event => {
                    const offset = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }[event.key]
                    if (offset === undefined) return
                    event.preventDefault()
                    const next = index + offset
                    if (days[next] && !days[next].future) cellsRef.current[next]?.focus()
                  }}
                />)}
              </div>
            </div>
          </div>
        </div>
        <div className={styles.heatmapFooter}>
          <span aria-live="polite" data-testid="usage-heatmap-detail">{describe(selected)}</span>
          <span className={styles.heatmapScale}>{t('settings:usageStats.heatmapLess')}{[0, 1, 2, 3, 4].map(level => <i key={level} className={styles.heatmapDay} data-level={level} aria-hidden="true" />)}{t('settings:usageStats.heatmapMore')}</span>
        </div>
      </div>
      <p className={styles.subtitle}>{unavailable ? t(missingDsh ? 'settings:usageStats.noDshHistory' : 'settings:usageStats.ledgerUnavailable') : snapshot ? t('settings:usageStats.heatmapActiveDays', { count: activeDays }) : loading ? t('settings:usageStats.heatmapLoading') : '–'}</p>
      {error && <p className={styles.error} role="status">{t('settings:usageStats.heatmapError')}</p>}
    </section>
  )
}
