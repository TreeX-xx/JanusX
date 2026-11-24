import { HistorySourcesButton } from './HistorySourcesButton'
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
  type UsageRange,
} from '@/lib/usage-stats'
import { UsageBars } from './UsageBars'
import { EXTERNAL_CLI_TOOL_META, EXTERNAL_CLI_TOOL_ORDER, type ExternalCliToolId } from '../../../shared/ipc/external-cli'
import { TerminalPresetIcon } from './ui/TerminalPresetIcon'
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
  const [range, setRange] = useState<UsageRange>('today')
  const [activeType, setActiveType] = useState<TypeFilter>('all')
  const [iconFailed, setIconFailed] = useState<Partial<Record<ExternalCliToolId, boolean>>>({})
  const [startInput, setStartInput] = useState(() => toDateInputValue(Date.now() - 6 * DAY_MS))
  const [endInput, setEndInput] = useState(() => toDateInputValue(Date.now()))
  const normalized = useMemo(
    () => normalizeCustomRange(parseDateInput(startInput), parseDateInput(endInput), now),
    [startInput, endInput, now],
  )
  const customRange = useMemo(
    () => range === 'custom' ? { start: normalized.start, end: normalized.end } : undefined,
    [range, normalized.start, normalized.end],
  )
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
  }, [start, end, activeType, invalidRange, now, range, customRange])
  const liveView = aggregateUsageStats(ledger.records, range, now, activeType === 'all' ? undefined : activeType, customRange)
  // Stale-while-revalidate: the aggregates are derived per filter, so keeping
  // the records is not enough — recomputing them against the new engine/range
  // would flash zeros before the query lands. Until data for the current key
  // arrives (including on error), the last settled view stays on screen.
  const view = settled?.key === JSON.stringify([start, range === 'custom' ? end : range, activeType, invalidRange])
    ? liveView
    : settled?.view ?? liveView
  const cache = cacheSplitFor(view.cacheReadTokens, view.inputTokens, view.cacheWriteTokens, view.cacheKnown)
  const count = view.series.reduce((sum, bucket) => sum + bucket.records, 0)
  const writeReports = view.series.reduce((sum, bucket) => sum + bucket.writeReports, 0)
  // 自定义区间的日期错误只在 custom 范围内生效，切回预设后不得劫持空文案。
  const customErrorKey = range !== 'custom' ? undefined
    : normalized.error === 'invalid' ? 'customInvalid' : normalized.error === 'future' ? 'customFuture' : normalized.error === 'span' ? 'customSpan' : undefined
  const isEmpty = view.terminals === 0
  const missingDsh = activeType === 'dsh' && isEmpty && !ledger.sessions.some(session => session.engine === 'dsh')
  const unavailableEngine = isEmpty && (activeType === 'janus' || missingDsh)
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
        <HistorySourcesButton onChanged={() => setNow(Date.now())} />
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
              : <TerminalPresetIcon className={llmStyles.terminalTabIcon} preset={toolId} onError={() => setIconFailed((prev) => ({ ...prev, [toolId]: true }))} />}
            {meta.displayName}
          </SettingsButton>
        })}
      </div>
      <div className={`${styles.summary} ${isEmpty ? styles.summaryEmpty : ''} ${refreshing ? styles.dimmed : ''}`} data-testid="usage-summary" data-refreshing={refreshing ? 'true' : undefined}>
        {refreshing && <span className={styles.refreshBar} data-refresh-bar="" aria-hidden="true" />}
        <div className={styles.metric}>
          <span>{t('settings:usageStats.total')}</span>
          <ThemedTooltip label={`${t('settings:usageStats.tokenComposition')} · ${t('settings:usageStats.freshInput')} ${view.inputTokens.toLocaleString()}`}>
            <strong tabIndex={0} data-testid="usage-total">{unavailableEngine ? '–' : formatCount(view.totalTokens)}<small>tokens</small></strong>
          </ThemedTooltip>
          <UsageCostPanel records={settled?.records ?? ledger.records} start={view.rangeStart} end={view.rangeEnd} engine={view.rows.length === 1 ? view.rows[0].preset : undefined} />
        </div>
        {([
          ['cacheRead', view.cacheReadTokens, view.cacheReported, !view.cacheKnown],
          ['cacheWrite', view.cacheWriteTokens, writeReports > 0, writeReports < count],
          ['output', view.outputTokens, !unavailableEngine, false],
        ] as const).map(([key, value, reported, partial]) => <div className={styles.metric} key={key}>
          <span>{t(`settings:usageStats.${key}`)}</span>
          <strong data-testid={`usage-${key}`}>{reported ? formatCount(value) : '–'}</strong>
          {reported && partial && <small>{t('settings:usageStats.partial')}</small>}
        </div>)}
        <div className={styles.metric}>
          <span>{t('settings:usageStats.hitRate')}</span>
          <ThemedTooltip label={t('settings:usageStats.cacheFormula')}>
            <strong data-testid="usage-cache-rate" tabIndex={0}>{formatUsageRate(cache.rate)}</strong>
          </ThemedTooltip>
          {!cache.hasData && view.cacheReported && <small>{t('settings:usageStats.incompleteCacheData')}</small>}
        </div>
      </div>
      <div className={`${styles.trendSection}${refreshing ? ' ' + styles.dimmed : ''}`}>
        <UsageBars key={settled?.key} series={view.series} range={view.range} now={view.rangeEnd} />
        {activeType === 'janus' ? <p className={styles.hint}>{t('settings:usageStats.ledgerUnavailable')}</p>
          : missingDsh ? <p className={styles.hint}>{t('settings:usageStats.noDshHistory')}</p>
          : (activeType === 'all' || activeType === 'codex' || activeType === 'opencode') && <p className={styles.hint}>{t('settings:usageStats.ledgerBaseline')}</p>}
        {ledger.coverageStart !== undefined && <p className={styles.hint}>{t('settings:usageStats.ledgerCoverage')} {new Date(ledger.coverageStart).toLocaleString()}</p>}
        {/* Codex 的压缩会重置其累计计数器，暂停的会话是已知 CLI 行为而非数据
            损坏；为该引擎显示不完整提示只是噪音，其他引擎的缺口仍然提示。 */}
        {ledger.sessions.some(session => session.issue && session.engine !== 'codex') && (
          <p className={styles.error} role="status">{t('settings:usageStats.ledgerPaused')}</p>
        )}
        {loadError && <p className={styles.error} role="alert">{t('settings:usageStats.ledgerError')}</p>}
      </div>
      <UsageHeatmap engine={activeType === 'all' ? undefined : activeType} />
      <UsageModelBreakdown rows={view.modelRows} total={view.totalTokens} refreshing={refreshing} />
    </section>
  )
}

function formatRangeLabel(start: number, end: number): string {
  const from = new Date(start)
  const to = new Date(Math.max(end, start))
  return `${from.getMonth() + 1}/${from.getDate()} – ${to.getMonth() + 1}/${to.getDate()}`
}
