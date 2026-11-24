// Note: time-bucket composition — see .agents/notes/terminal/requirements/usage-stats-custom-range-detail.md
import { useRef, useState } from 'react'
import { useI18n } from '@/i18n/useI18n'
import { formatUsageCount, type TimeBucket, type UsageRange } from '@/lib/usage-stats'
import styles from './UsageStatsPanel.module.css'

const parts = [
  ['input', 'freshInput'], ['hits', 'cacheRead'], ['write', 'cacheWrite'], ['output', 'output'],
] as const

function compositionSegments(bucket: TimeBucket) {
  if (!bucket.totalTokens || bucket.readReports !== bucket.records || bucket.writeReports !== bucket.records ||
    parts.reduce((sum, [key]) => sum + bucket[key], 0) !== bucket.totalTokens) return null
  return parts.map(([key]) => bucket[key] > 0 && <i key={key} data-part={key} style={{ flexGrow: bucket[key] }} />)
}

export function UsageBars({ series, range, now }: { series: TimeBucket[]; range: UsageRange; now: number }) {
  const { t, currentLanguage } = useI18n('settings')
  const [hover, setHover] = useState<number>()
  const [selected, setSelected] = useState<number>()
  const columns = useRef<Array<HTMLButtonElement | null>>([])
  const peak = series.reduce((best, bucket, i) => bucket.totalTokens > (series[best]?.totalTokens ?? 0) ? i : best, 0)
  const maximum = series[peak]?.totalTokens ?? 0
  const magnitude = 10 ** Math.floor(Math.log10(maximum || 1))
  const ceiling = Math.ceil((maximum || 1) / magnitude * 2) * magnitude / 2
  const hour = new Date(now).getHours()
  const active = hover ?? selected
  const detail = series[active ?? peak]
  const label = (bucket: TimeBucket) => range === 'today' ? bucket.label.padStart(2, '0') + ':00' : bucket.label
  const interval = (bucket: TimeBucket) => range === 'today' ? label(bucket) + '–' + String(Number(bucket.label) + 1).padStart(2, '0') + ':00' : bucket.label
  const tickStep = range === 'today' ? 6 : Math.max(1, Math.ceil(series.length / 4))
  return <div className={styles.trend} data-testid="usage-trend">
    <div className={styles.toolbar}>
      <h4 className={styles.title}>{t('settings:usageStats.trend')} <small>tokens</small></h4>
      <div className={styles.trendReading} aria-live="polite">{detail && (maximum > 0 || active !== undefined) && <>
        {active === undefined && <span>{t('settings:usageStats.peak')}</span>}
        {interval(detail)} <b>{formatUsageCount(detail.totalTokens)}</b>
        {range === 'today' && Number(detail.label) === hour && <span>{t('settings:usageStats.ongoing')}</span>}
      </>}</div>
    </div>
    <div className={styles.plot}>
      <div className={styles.scale} aria-hidden="true"><span>{maximum > 0 && formatUsageCount(ceiling)}</span><span>{maximum > 0 && formatUsageCount(ceiling / 2)}</span><span>0</span></div>
      <div className={styles.columns} role="group" aria-label={t('settings:usageStats.trend')} onMouseLeave={() => setHover(undefined)}>
        {series.map((bucket, index) => {
          const future = range === 'today' && index > hour
          const current = range === 'today' && index === hour
          return <button key={bucket.key} type="button" ref={node => { columns.current[index] = node }}
            data-bucket={bucket.key} data-active={active === index || undefined} data-current={current || undefined}
            className={styles.column} disabled={future}
            aria-label={interval(bucket) + ' · ' + bucket.totalTokens.toLocaleString(currentLanguage) + ' tokens'}
            tabIndex={index === (selected ?? (maximum > 0 ? peak : 0)) ? 0 : -1}
            onClick={() => setSelected(index)} onFocus={() => setSelected(index)}
            onMouseEnter={() => { if (!future) setHover(index) }} onBlur={() => setSelected(undefined)}
            onKeyDown={event => {
              const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
              if (step) { event.preventDefault(); setHover(undefined); columns.current[index + step]?.focus() }
            }}>
            <span className={styles.bar} style={{ height: (bucket.totalTokens / ceiling * 100) + '%' }}>
              {active === index && compositionSegments(bucket)}
            </span>
            {current && <span className={styles.currentTag}>{t('settings:usageStats.ongoing')}</span>}
            {index % tickStep === 0 && <span className={styles.tick}>{range === 'today' ? bucket.label.padStart(2, '0') : bucket.label}</span>}
          </button>
        })}
        {!maximum && <span className={styles.plotEmpty}>{t('settings:usageStats.empty')}</span>}
      </div>
    </div>
    <div className={styles.compositionTrack} data-testid="usage-bucket-composition" aria-hidden="true">
      {detail && compositionSegments(detail)}
    </div>
    <div className={styles.parts}>{parts.map(([key, name]) => {
      const reports = key === 'hits' ? detail?.readReports : key === 'write' ? detail?.writeReports : detail?.records
      return <span key={key}><i data-part={key} />{t('settings:usageStats.' + name)}
        {detail && maximum > 0 && <strong>{reports || !detail.records ? formatUsageCount(detail[key]) : '–'}
          {!!reports && reports < detail.records && <small> · {t('settings:usageStats.partial')}</small>}</strong>}
      </span>
    })}</div>
  </div>
}
