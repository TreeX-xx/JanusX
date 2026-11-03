import { Button as SettingsButton, Input as SettingsInput } from '@janusx/ui'
// Note: persistent native-session usage — see .agents/notes/terminal/requirements/usage-telemetry-single-source.md
import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '@/i18n/useI18n'
import { loadUsageLedger } from '@/services/usage'
import type { UsageLedgerPage } from '../../../shared/usage'
import { useThemeStore } from '@/stores/theme'
import {
  aggregateUsageStats,
  cacheSplitFor,
  formatUsageCount as formatCount,
  formatUsageRate,
  customBucketModeFor,
  normalizeCustomRange,
  parseDateInput,
  rangeStartFor,
  rangeEndFor,
  toDateInputValue,
  type TimeBucket,
  type UsageRange,
  type UsagePresetRow,
} from '@/lib/usage-stats'
import type { TerminalPreset } from '@/types'
import { EXTERNAL_CLI_TOOL_META, EXTERNAL_CLI_TOOL_ORDER, type ExternalCliToolId } from '../../../shared/ipc/external-cli'
import { EXTERNAL_CLI_TOOL_ICONS } from '@/lib/cli-tool-icons'
import { getThemeDefinition } from '../../../shared/theme/registry'
import llmStyles from './LlmConfigModal.module.css'
import styles from './UsageStatsPanel.module.css'
import { UsageHeatmap } from './UsageHeatmap'
import { UsageCostPanel } from './UsageCostPanel'
import { UsageModelBreakdown } from './UsageModelBreakdown'
import { ThemedTooltip } from './ui/ThemedTooltip'

const RANGES: UsageRange[] = ['today', 'week', 'month', 'custom']
const RANGE_KEYS = { today: 'rangeToday', week: 'rangeWeek', month: 'rangeMonth', custom: 'rangeCustom' } as const
const DAY_MS = 86_400_000

type TypeFilter = 'all' | ExternalCliToolId

function formatRate(rate: number | undefined): string {
  return rate === undefined ? '–' : `${Math.round(rate * 100)}%`
}

function presetColor(preset: TerminalPreset): string {
  return `var(--usage-${preset}, var(--shell-dim))`
}

function presetName(preset: TerminalPreset): string {
  return EXTERNAL_CLI_TOOL_META[preset as ExternalCliToolId]?.displayName ?? preset
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(query.matches)
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return reduced
}

/** 数字滚动：目标变化时在 260ms 内插值，降级时直接返回目标。 */
function useAnimatedNumber(target: number, disabled: boolean): number {
  const [display, setDisplay] = useState(target)
  const fromRef = useRef(target)
  useEffect(() => {
    if (disabled || fromRef.current === target) {
      fromRef.current = target
      setDisplay(target)
      return
    }
    const from = fromRef.current
    let frame = 0
    const startedAt = performance.now()
    const duration = 260
    const tick = (at: number) => {
      const progress = Math.min(1, (at - startedAt) / duration)
      const eased = 1 - Math.pow(1 - progress, 3)
      const value = from + (target - from) * eased
      setDisplay(value)
      if (progress < 1) frame = requestAnimationFrame(tick)
      else fromRef.current = target
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      fromRef.current = target
    }
  }, [target, disabled])
  return display
}

/** 曲线插值：桶数量与键一致时逐帧过渡，否则直接切换并由 CSS 淡入承接。 */
/**
 * Both series are resampled onto one fixed grid so curves of different bucket
 * counts (hourly today vs daily week) can morph into each other instead of
 * hard-swapping. Point count is a display detail; the resampled curve is
 * smoother than either endpoint.
 */
const MORPH_RESOLUTION = 48
/** 形态变化走形变（跨桶数），同形态数值变化用更短的补间。 */
const MORPH_MS = 420
const TWEEN_MS = 280

function resampleSeries(series: TimeBucket[], resolution: number): TimeBucket[] {
  if (series.length === 0) return []
  if (series.length === 1) return Array.from({ length: resolution }, () => ({ ...series[0] }))
  return Array.from({ length: resolution }, (_, index) => {
    const position = index / (resolution - 1) * (series.length - 1)
    const lower = Math.floor(position)
    const upper = Math.min(series.length - 1, lower + 1)
    const fraction = position - lower
    const a = series[lower]
    const b = series[upper]
    const mix = (x: number, y: number) => x + (y - x) * fraction
    const anchor = fraction < 0.5 ? a : b
    return {
      key: anchor.key,
      label: anchor.label,
      totalTokens: mix(a.totalTokens, b.totalTokens),
      hits: mix(a.hits, b.hits),
      misses: mix(a.misses, b.misses),
      unknown: mix(a.unknown, b.unknown),
      output: mix(a.output, b.output),
    }
  })
}

function seriesEquals(a: TimeBucket[], b: TimeBucket[]): boolean {
  return a.length === b.length && a.every((bucket, index) => {
    const next = b[index]
    return bucket.key === next.key
      && bucket.totalTokens === next.totalTokens
      && bucket.hits === next.hits
      && bucket.misses === next.misses
      && bucket.unknown === next.unknown
      && bucket.output === next.output
  })
}

function tweenFrames(from: TimeBucket[], to: TimeBucket[], duration: number, disabled: boolean, apply: (buckets: TimeBucket[]) => void, done: () => void): () => void {
  if (disabled || from.length === 0 || to.length === 0) {
    apply(to)
    done()
    return () => {}
  }
  let frame = 0
  const startedAt = performance.now()
  const tick = (at: number) => {
    const progress = Math.min(1, (at - startedAt) / duration)
    const eased = 1 - Math.pow(1 - progress, 3)
    apply(from.map((bucket, index) => {
      const next = to[index]
      const mix = (a: number, b: number) => a + (b - a) * eased
      return {
        ...next,
        totalTokens: mix(bucket.totalTokens, next.totalTokens),
        hits: mix(bucket.hits, next.hits),
        misses: mix(bucket.misses, next.misses),
        unknown: mix(bucket.unknown, next.unknown),
        output: mix(bucket.output, next.output),
      }
    }))
    if (progress < 1) frame = requestAnimationFrame(tick)
    else done()
  }
  frame = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(frame)
}

/**
 * 曲线切换：形态相同（桶键一致）时按值补间；形态变化（换范围/粒度）时把新旧
 * 两条曲线重采样到同一网格后形变，旧曲线平滑变成新曲线，而不是硬切重画。落到
 * 空结果时曲线先沉到基线，空水印随后到位。聚合每次渲染都返回新数组，因此先用
 * 内容比较挡住无变化的重入，否则补间会无限重启。
 */
function useAnimatedSeries(series: TimeBucket[], disabled: boolean): { buckets: TimeBucket[]; generation: number; morphing: boolean } {
  const [display, setDisplay] = useState(series)
  const [generation, setGeneration] = useState(0)
  const [morphing, setMorphing] = useState(false)
  const prevRef = useRef(series)
  // 聚合每次渲染都返回新数组，effect 会频繁重跑；在途补间保存在 ref 里，
  // 只有内容变化才取消重启，卸载时取消——否则重跑的清理会掐断补间。
  const tweenRef = useRef<(() => void) | null>(null)
  useEffect(() => () => { tweenRef.current?.() }, [])
  useEffect(() => {
    const prev = prevRef.current
    if (seriesEquals(prev, series)) return
    prevRef.current = series
    tweenRef.current?.()
    tweenRef.current = null
    // 首份数据（没有可形变的旧曲线）直接落位，由进场动画介绍图表。
    if (disabled || prev.length === 0) {
      setMorphing(false)
      setDisplay(series)
      setGeneration((value) => value + 1)
      return
    }
    const sameShape = prev.length === series.length && prev.every((bucket, index) => bucket.key === series[index].key)
    const source = sameShape ? prev : resampleSeries(prev, MORPH_RESOLUTION)
    const zeroed = source.map(bucket => ({ ...bucket, totalTokens: 0, hits: 0, misses: 0, unknown: 0, output: 0 }))
    const target = series.length === 0 ? zeroed : sameShape ? series : resampleSeries(series, MORPH_RESOLUTION)
    setMorphing(true)
    tweenRef.current = tweenFrames(source, target, sameShape ? TWEEN_MS : MORPH_MS, disabled, setDisplay, () => {
      tweenRef.current = null
      setMorphing(false)
      setDisplay(series)
    })
  }, [series, disabled])
  return { buckets: display, generation, morphing }
}

function OverallDonut({ rows, total, trackColor, label }: {
  rows: UsagePresetRow[]
  total: number
  trackColor: string
  label: string
}) {
  const radius = 34
  const circumference = 2 * Math.PI * radius
  let accumulated = 0
  return (
    <svg width="96" height="96" viewBox="0 0 96 96" role="img" aria-label={label}>
      <circle cx="48" cy="48" r={radius} fill="none" stroke={trackColor} strokeWidth="10" />
      {total > 0 && rows.map((row) => {
        const fraction = row.totalTokens / total
        const length = fraction * circumference
        const offset = -accumulated * circumference
        accumulated += fraction
        if (length <= 0) return null
        return (
          <circle
            key={row.preset}
            className={styles.donutArc}
            cx="48"
            cy="48"
            r={radius}
            fill="none"
            stroke={presetColor(row.preset)}
            strokeWidth="10"
            strokeDasharray={`${length - (rows.length > 1 ? Math.min(3, length * 0.12) : 0)} ${circumference}`}
            strokeDashoffset={offset}
            transform="rotate(-90 48 48)"
          ><title>{presetName(row.preset)}: {formatCount(row.totalTokens)} tokens · {Math.round(fraction * 100)}%</title></circle>
        )
      })}
    </svg>
  )
}

function CacheDonut({ hits, misses, hasData, hitColor, missColor, trackColor, label }: {
  hits: number
  misses: number
  hasData: boolean
  hitColor: string
  missColor: string
  trackColor: string
  label: string
}) {
  const radius = 34
  const circumference = 2 * Math.PI * radius
  const total = hits + misses
  const hitLength = hasData && total > 0 ? (hits / total) * circumference : 0
  return (
    <svg width="96" height="96" viewBox="0 0 96 96" role="img" aria-label={label}>
      <circle cx="48" cy="48" r={radius} fill="none" stroke={trackColor} strokeWidth="10" />
      {hasData && total > 0 && (
        <>
          <circle cx="48" cy="48" r={radius} fill="none" stroke={missColor} strokeWidth="10" />
          <circle
            className={styles.donutArc}
            cx="48"
            cy="48"
            r={radius}
            fill="none"
            stroke={hitColor}
            strokeWidth="10"
            strokeLinecap="butt"
            strokeDasharray={`${hitLength} ${circumference}`}
            transform="rotate(-90 48 48)"
          />
        </>
      )}
    </svg>
  )
}

type TrendMetric = { key: 'hits' | 'output'; label: string; color: string }

function TrendLines({ series, range, metrics, label, emptyLabel }: {
  series: TimeBucket[]
  range: UsageRange
  metrics: TrendMetric[]
  label: string
  emptyLabel?: string
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [hidden, setHidden] = useState<readonly string[]>([])
  const reducedMotion = usePrefersReducedMotion()
  const { buckets, generation, morphing } = useAnimatedSeries(series, reducedMotion)
  const visible = metrics.filter(({ key }) => !hidden.includes(key))
  const maxValue = Math.max(0, ...buckets.flatMap((bucket) => visible.map(({ key }) => bucket[key])))
  const ceiling = Math.max(1, maxValue)
  // 全零（空表）只画基线，不画 0.5 这类无意义刻度。
  const ticks = maxValue > 0 ? [0, 0.5, 1] : [0]
  const toggle = (key: string) => setHidden((prev) => prev.includes(key) ? prev.filter((candidate) => candidate !== key) : [...prev, key])
  const x = (index: number) => 52 + index * 620 / Math.max(1, buckets.length - 1)
  // 日期标签属于目标范围：形变期间按新网格定位，不随曲线网格抖动
  const labelX = (index: number) => 52 + index * 620 / Math.max(1, series.length - 1)
  const y = (value: number) => 174 - value / ceiling * 146
  // 聚合每次渲染返回新数组，任何“series 变化即清零”的 effect 都会在数字滚动期间
  // 反复吞掉悬停与键盘焦点；此处仅钳制越界下标，结构变化由 svg key 的淡入承接。
  const active = activeIndex === null || activeIndex >= buckets.length ? undefined : buckets[activeIndex]
  const dateLabel = (bucket: TimeBucket) => range === 'today' ? `${bucket.label.padStart(2, '0')}:00` : bucket.label
  return (
    <div className={styles.trend}>
      <svg key={generation} viewBox="0 0 700 208" className={`${styles.chart} ${styles.chartEnter}`} role="group" aria-label={label} onMouseLeave={() => setActiveIndex(null)}>
        {ticks.map((fraction) => (
          <g key={fraction} className={styles.axis}>
            <line x1="52" x2="672" y1={y(ceiling * fraction)} y2={y(ceiling * fraction)} />
            <text x="40" y={y(ceiling * fraction) + 4} textAnchor="end">{formatCount(ceiling * fraction)}</text>
          </g>
        ))}
        {visible.map(({ key, color }) => {
          // Horizontal control points keep each segment within its two measured values.
          const path = buckets.map((bucket, index) => index === 0
            ? `M ${x(index)} ${y(bucket[key])}`
            : `C ${(x(index - 1) + x(index)) / 2} ${y(buckets[index - 1][key])}, ${(x(index - 1) + x(index)) / 2} ${y(bucket[key])}, ${x(index)} ${y(bucket[key])}`).join(' ')
          return <g key={key}>
            {/* pathLength normalises the draw-on animation across path lengths. */}
            <path data-series={key} pathLength={100} d={path} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
            {/* 形变期间曲线在重采样网格上，数据点会变成几十个飞点；落地后按真实桶渲染。 */}
            {!morphing && buckets.map((bucket, index) => bucket[key] > 0.5 && <circle key={bucket.key} cx={x(index)} cy={y(bucket[key])} r="3" fill={color} />)}
          </g>
        })}
        {emptyLabel !== undefined && maxValue <= 0 && <text x="362" y="100" textAnchor="middle" className={styles.emptyWatermark}>{emptyLabel}</text>}
        {active && <line className={styles.cursor} x1={x(activeIndex!)} x2={x(activeIndex!)} y1="22" y2="174" />}
        {buckets.map((bucket, index) => {
          const showLabel = index === 0 || index === buckets.length - 1 || index % Math.max(1, Math.ceil(buckets.length / 6)) === 0
          return <g key={bucket.key}>
            {showLabel && <text className={styles.dateLabel} x={labelX(index)} y="199" textAnchor="middle">{dateLabel(bucket)}</text>}
            <rect x={x(index) - 310 / Math.max(1, buckets.length - 1)} y="20" width={620 / Math.max(1, buckets.length - 1)} height="160" fill="transparent" tabIndex={0}
              role="img" aria-label={`${dateLabel(bucket)}: ${metrics.map(({ key, label: name }) => `${name} ${Math.round(bucket[key])}`).join(', ')}`}
              onMouseEnter={() => setActiveIndex(index)} onFocus={() => setActiveIndex(index)} onBlur={() => setActiveIndex(null)} />
          </g>
        })}
      </svg>
      <div className={styles.legend} aria-live="polite">
        {active && <span className={styles.activeDate}>{dateLabel(active)}</span>}
        {metrics.map(({ key, color, label: name }) => {
          const off = hidden.includes(key)
          return <SettingsButton variant="plain" key={key} type="button" className={`${styles.chip} ${off ? styles.chipOff : ''}`} aria-pressed={!off} onClick={() => toggle(key)}>
            <i style={{ background: color }} />{name}{active && !off && <strong>{formatCount(active[key])}</strong>}
          </SettingsButton>
        })}
      </div>
    </div>
  )
}

export function UsageStatsPanel() {
  const { t } = useI18n('settings')
  const [ledger, setLedger] = useState<UsageLedgerPage>({ records: [], sessions: [] })
  const [refreshing, setRefreshing] = useState(false)
  /** Aggregates of the last data that answered a query key, shown while a new key loads. */
  const [settled, setSettled] = useState<{ key: string; view: ReturnType<typeof aggregateUsageStats>; records: UsageLedgerPage['records'] } | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000)
    return () => window.clearInterval(timer)
  }, [])
  const theme = useThemeStore((s) => s.theme)
  const definition = getThemeDefinition(theme)
  const scale = definition.ctxScale
  const hitColor = scale.stops[0]
  const missColor = scale.stops[2]
  const trackColor = scale.empty
  const reducedMotion = usePrefersReducedMotion()
  const [range, setRange] = useState<UsageRange>('today')
  const [activeType, setActiveType] = useState<TypeFilter>('all')
  const [iconFailed, setIconFailed] = useState<Partial<Record<ExternalCliToolId, boolean>>>({})
  const [startInput, setStartInput] = useState(() => toDateInputValue(Date.now() - 6 * DAY_MS))
  const [endInput, setEndInput] = useState(() => toDateInputValue(Date.now()))
  const normalized = useMemo(
    () => normalizeCustomRange(parseDateInput(startInput), parseDateInput(endInput), now),
    [startInput, endInput, now],
  )
  const customRange = range === 'custom' ? { start: normalized.start, end: normalized.end } : undefined
  const start = rangeStartFor(range, now, customRange)
  const end = rangeEndFor(range, now, customRange)
  const invalidRange = range === 'custom' && normalized.error !== undefined
  const queryKey = useRef('')
  useEffect(() => {
    let cancelled = false
    const key = JSON.stringify([start, range === 'custom' ? end : range, activeType, invalidRange])
    // A filter change keeps the previous data visible while the new query
    // runs (stale-while-revalidate); only that user action shows the
    // refreshing affordance. The periodic `now` re-query of an unchanged key
    // must stay silent so the panel never flickers on its own.
    const keyChanged = queryKey.current !== key
    queryKey.current = key
    setLoadError(false)
    if (invalidRange) {
      setRefreshing(false)
      return
    }
    if (keyChanged) setRefreshing(true)
    const engine = activeType === 'all' ? undefined : activeType
    void loadUsageLedger({ start, end, engine }).then(result => {
      if (cancelled) return
      setLedger(result)
      // Snapshot the aggregates this data answers, so a later filter change
      // can keep showing them until its own data lands.
      setSettled({ key, view: aggregateUsageStats(result.records, range, now, engine, customRange), records: result.records })
      setLoadError(Boolean(result.warning))
    }).catch(() => { if (!cancelled) setLoadError(true) })
      .finally(() => { if (!cancelled) setRefreshing(false) })
    return () => { cancelled = true }
  }, [start, end, activeType, invalidRange, now, range])
  const liveView = aggregateUsageStats(ledger.records, range, now, activeType === 'all' ? undefined : activeType, customRange)
  // Stale-while-revalidate: the aggregates are derived per filter, so keeping
  // the records is not enough — recomputing them against the new engine/range
  // would flash zeros before the query lands. Until data for the current key
  // arrives (including on error), the last settled view stays on screen.
  const view = settled?.key === JSON.stringify([start, range === 'custom' ? end : range, activeType, invalidRange])
    ? liveView
    : settled?.view ?? liveView
  const cache = cacheSplitFor(view.cacheReadTokens, view.inputTokens, view.cacheWriteTokens, view.cacheKnown)
  const animatedTotal = useAnimatedNumber(view.totalTokens, reducedMotion)
  const animatedInput = useAnimatedNumber(view.inputTokens, reducedMotion)
  const animatedOutput = useAnimatedNumber(view.outputTokens, reducedMotion)
  const ioTotal = view.inputTokens + view.outputTokens
  const outputShare = ioTotal > 0 ? view.outputTokens / ioTotal : undefined
  // 自定义区间的日期错误只在 custom 范围内生效，切回预设后不得劫持空文案。
  const customErrorKey = range !== 'custom' ? undefined
    : normalized.error === 'invalid' ? 'customInvalid' : normalized.error === 'future' ? 'customFuture' : normalized.error === 'span' ? 'customSpan' : undefined
  const isEmpty = view.terminals === 0
  const unavailableEngine = isEmpty && (activeType === 'janus' || activeType === 'dsh')
  // 趋势图只保留命中与输出两条曲线；未命中与未区分留在缓存环形与聚合口径中，不上趋势图。
  const metrics: TrendMetric[] = [
    { key: 'hits', label: t('settings:usageStats.hit'), color: hitColor },
    { key: 'output', label: t('settings:usageStats.output'), color: 'var(--usage-output)' },
  ]
  const trendBucketHint = useMemo(() => {
    if (range !== 'custom' || normalized.end < normalized.start) return undefined
    const mode = customBucketModeFor(normalized.start, normalized.end)
    return mode === 'hour' ? t('settings:usageStats.customHourly') : mode === 'week' ? t('settings:usageStats.customWeekly') : t('settings:usageStats.customDaily')
  }, [range, normalized, t])
  return (
    <section className={styles.panel} data-theme-base={definition.base} aria-label={t('settings:usageStats.title')}>
      <div className={styles.head}>
        <div className={styles.headInfo}>
          <h3 className={styles.title}>{t('settings:usageStats.title')}</h3>
          <p className={styles.subtitle}>{t('settings:usageStats.subtitle')}</p>
        </div>
      </div>
      <div className={styles.rangeRow} role="group" aria-label={t('settings:usageStats.timeRange')}>
        {RANGES.map((candidate) => <SettingsButton variant="tab" key={candidate} type="button" className={`${styles.tab} ${candidate === range ? styles.tabActive : ''}`} aria-pressed={candidate === range} onClick={() => setRange(candidate)}>{t(`settings:usageStats.${RANGE_KEYS[candidate]}`)}</SettingsButton>)}
      </div>
      {range === 'custom' && (
        <div className={styles.customBar}>
          <label className={styles.dateField}>
            <span>{t('settings:usageStats.customStart')}</span>
            <SettingsInput type="date" value={startInput} max={endInput} onChange={(event) => setStartInput(event.target.value)} aria-label={t('settings:usageStats.customStart')} />
          </label>
          <span className={styles.dateSep} aria-hidden="true">–</span>
          <label className={styles.dateField}>
            <span>{t('settings:usageStats.customEnd')}</span>
            <SettingsInput type="date" value={endInput} min={startInput} onChange={(event) => setEndInput(event.target.value)} aria-label={t('settings:usageStats.customEnd')} />
          </label>
          {customErrorKey
            ? <p className={styles.error} role="alert">{t(`settings:usageStats.${customErrorKey}`)}</p>
            : <p className={styles.customMeta}>{formatRangeLabel(normalized.start, normalized.end)}{trendBucketHint ? ` · ${trendBucketHint}` : ''}</p>}
        </div>
      )}
      <div className={styles.tabRow} role="group" aria-label={t('settings:usageStats.terminalType')}>
        <SettingsButton variant="tab" type="button" className={`${styles.tab} ${activeType === 'all' ? styles.tabActive : ''}`} aria-pressed={activeType === 'all'} onClick={() => setActiveType('all')}>{t('settings:usageStats.typeAll')}</SettingsButton>
        {EXTERNAL_CLI_TOOL_ORDER.map((toolId) => {
          const meta = EXTERNAL_CLI_TOOL_META[toolId]
          return <SettingsButton variant="tab" key={toolId} type="button" className={`${styles.tab} ${toolId === activeType ? styles.tabActive : ''}`} aria-pressed={toolId === activeType} onClick={() => setActiveType(toolId)}>
            {iconFailed[toolId] ? <span className={llmStyles.terminalTabMonogram}>{meta.monogram}</span>
              : <img className={llmStyles.terminalTabIcon} data-tool={toolId} src={EXTERNAL_CLI_TOOL_ICONS[toolId]} alt="" onError={() => setIconFailed((prev) => ({ ...prev, [toolId]: true }))} />}
            {meta.displayName}
          </SettingsButton>
        })}
      </div>
      <div className={`${styles.summary} ${isEmpty ? styles.summaryEmpty : ''} ${refreshing ? styles.dimmed : ''}`} data-testid="usage-summary" data-refreshing={refreshing ? 'true' : undefined}>
        {refreshing && <span className={styles.refreshBar} data-refresh-bar="" aria-hidden="true" />}
        <div className={`${styles.summaryCell} ${styles.totalCell}`}>
          <OverallDonut rows={view.rows} total={view.totalTokens} trackColor={trackColor} label={t('settings:usageStats.overall')} />
          <div className={styles.summaryInfo}>
            <span className={styles.label}>{t('settings:usageStats.total')}</span>
            <div className={styles.value} data-testid="usage-total">{unavailableEngine ? '–' : formatCount(animatedTotal)}<small>tokens</small></div>
            <UsageCostPanel records={settled?.records ?? ledger.records} start={view.rangeStart} end={view.rangeEnd} engine={view.rows.length === 1 ? view.rows[0].preset : undefined} />
            <div className={styles.legend}>{view.rows.map((row) => <span key={row.preset}><i style={{ background: presetColor(row.preset) }} />{presetName(row.preset)} <strong>{view.totalTokens > 0 ? Math.round(row.totalTokens / view.totalTokens * 100) : 0}%</strong></span>)}</div>
          </div>
        </div>
        <div className={`${styles.summaryCell} ${styles.ioCell}`} data-testid="usage-io">
          <div className={styles.ioNumbers}>
            <div className={styles.inputMetric}><span className={styles.label}>{t('settings:usageStats.input')}</span><strong data-testid="usage-input">{unavailableEngine ? '–' : formatCount(animatedInput)}</strong></div>
            <div className={styles.outputMetric}><span className={styles.label}>{t('settings:usageStats.output')}</span><strong data-testid="usage-output">{unavailableEngine ? '–' : formatCount(animatedOutput)}</strong></div>
          </div>
          <div className={styles.ioBar} role="img" aria-label={`${t('settings:usageStats.ioShare')}: ${formatRate(outputShare)}`}>
            <div className={styles.ioTrack}>
              <div className={styles.ioFillIn} style={{ width: `${ioTotal > 0 ? (view.inputTokens / ioTotal) * 100 : 0}%` }} />
              <div className={styles.ioFillOut} style={{ width: `${ioTotal > 0 ? (view.outputTokens / ioTotal) * 100 : 0}%` }} />
            </div>
          </div>
          <div className={styles.legend}><span>{t('settings:usageStats.ioShare')} <strong>{formatRate(outputShare)}</strong></span><span>{view.terminals} {t('settings:usageStats.terminals')}</span></div>
        </div>
        <div className={`${styles.summaryCell} ${styles.cacheCell}`}>
          <div className={styles.cacheHeading}>
            <CacheDonut hits={cache.hits} misses={cache.misses} hasData={cache.hasData} hitColor={hitColor} missColor={missColor} trackColor={trackColor} label={t('settings:usageStats.hitRate')} />
            <div className={styles.summaryInfo}>
              <span className={styles.label}>{t('settings:usageStats.hitRate')}</span>
              <ThemedTooltip label={`${formatUsageRate(cache.rate, 2)} · ${t('settings:usageStats.cacheFormula')}`}>
                <div className={styles.value} data-testid="usage-cache-rate" tabIndex={0}>{formatUsageRate(cache.rate)}</div>
              </ThemedTooltip>
            </div>
          </div>
          <div className={styles.legend}>{cache.hasData ? <><span><i style={{ background: hitColor }} />{t('settings:usageStats.hit')} <strong>{formatCount(cache.hits)}</strong></span><span><i style={{ background: missColor }} />{t('settings:usageStats.miss')} <strong>{formatCount(cache.misses)}</strong></span></> : t(view.cacheReported ? 'settings:usageStats.incompleteCacheData' : 'settings:usageStats.noCacheData')}</div>
        </div>
      </div>
      <UsageHeatmap engine={activeType === 'all' ? undefined : activeType} />
      <div className={`${styles.trendSection}${refreshing ? ' ' + styles.dimmed : ''}`}>
        <div className={styles.toolbar}><h4 className={styles.title}>{t('settings:usageStats.trend')}</h4><span className={styles.label}>tokens{trendBucketHint ? ` · ${trendBucketHint}` : ''}</span></div>
        <p className={styles.hint}>{t('settings:usageStats.ledgerUnavailable')}</p>
        {ledger.coverageStart !== undefined && <p className={styles.hint}>{t('settings:usageStats.ledgerCoverage')} {new Date(ledger.coverageStart).toLocaleString()}</p>}
        {/* Codex 的压缩会重置其累计计数器，暂停的会话是已知 CLI 行为而非数据
            损坏；为该引擎显示不完整提示只是噪音，其他引擎的缺口仍然提示。 */}
        {ledger.sessions.some(session => session.issue && session.engine !== 'codex') && (
          <p className={styles.error} role="status">{t('settings:usageStats.ledgerPaused')}</p>
        )}
        {loadError && <p className={styles.error} role="alert">{t('settings:usageStats.ledgerError')}</p>}
        <TrendLines
          series={view.series}
          range={range}
          metrics={metrics}
          label={t('settings:usageStats.trend')}
          emptyLabel={view.terminals === 0 ? t('settings:usageStats.empty') : undefined}
        />
      </div>
      <UsageModelBreakdown rows={view.modelRows} total={view.totalTokens} refreshing={refreshing} />
    </section>
  )
}

function formatRangeLabel(start: number, end: number): string {
  const from = new Date(start)
  const to = new Date(Math.max(end, start))
  return `${from.getMonth() + 1}/${from.getDate()} – ${to.getMonth() + 1}/${to.getDate()}`
}
