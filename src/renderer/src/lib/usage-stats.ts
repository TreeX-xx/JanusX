// Note: persistent usage records and date filters — see .agents/notes/terminal/requirements/usage-telemetry-single-source.md
import type { TerminalPreset } from '@/types'
import type { UsageRecord } from '../../../shared/usage'

export type UsageRange = 'today' | 'week' | 'month' | 'custom'

/** 自定义日期区间输入（毫秒时间戳，聚合前按本地日边界归一化）。 */
export interface CustomDateRange {
  start: number
  end: number
}

export type CustomRangeError = 'invalid' | 'future' | 'span'

export interface UsagePresetRow {
  preset: TerminalPreset
  terminals: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cacheKnown: boolean
  models: string[]
}

export interface UsageModelRow extends Omit<UsagePresetRow, 'models'> {
  key: string
  model?: string
  cacheReported: boolean
  cacheWriteKnown: boolean
}

export interface UsageStatsSummary {
  range: UsageRange
  rangeStart: number
  rangeEnd: number
  rows: UsagePresetRow[]
  modelRows: UsageModelRow[]
  series: TimeBucket[]
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  terminals: number
  terminalsWithoutData: number
  cacheKnown: boolean
  cacheReported: boolean
}

/** Shared display precision for settings and terminal cache rates. */
export function formatUsageRate(rate: number | undefined, digits = 1): string {
  return rate === undefined ? '–' : `${(rate * 100).toFixed(digits)}%`
}

export function formatUsageCount(value: number): string {
  const rounded = Math.round(value)
  if (rounded >= 1_000_000) return `${(rounded / 1_000_000).toFixed(1)}M`
  if (rounded >= 1000) return `${(rounded / 1000).toFixed(rounded >= 10_000 ? 0 : 1)}k`
  return String(rounded)
}

/** 缓存命中口径：命中为读缓存命中数，未命中为新鲜输入加缓存写入数。 */
export interface CacheSplit {
  hits: number
  misses: number
  rate: number | undefined
  hasData: boolean
}

export function cacheSplitFor(cacheReadTokens: number, inputTokens: number, cacheWriteTokens: number, known = true): CacheSplit {
  const hits = cacheReadTokens
  const misses = inputTokens + cacheWriteTokens
  // Presence determines coverage: a reported zero is a valid zero-hit rate.
  const hasData = known
  return { hits, misses, rate: hasData && hits + misses > 0 ? hits / (hits + misses) : undefined, hasData }
}

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

/** 自定义区间允许的最大跨度（366 天，覆盖整年对账）。 */
export const MAX_CUSTOM_SPAN_MS = 366 * DAY_MS

export function startOfDay(ts: number): number {
  const cursor = new Date(ts)
  cursor.setHours(0, 0, 0, 0)
  return cursor.getTime()
}

/** Rolling 365 local days, within the ledger's 367-day query limit. */
export function usageHeatmapStart(now: number): number {
  const date = new Date(startOfDay(now))
  date.setDate(date.getDate() - 364)
  return date.getTime()
}

export function aggregateUsageHeatmap(records: readonly UsageRecord[], now: number, engine?: TerminalPreset) {
  const start = usageHeatmapStart(now)
  const totals = new Map<string, number>()
  const seen = new Set<string>()
  for (const record of records) {
    if (seen.has(record.id) || record.at < start || record.at > now || (engine && record.engine !== engine)) continue
    seen.add(record.id)
    const key = toDateInputValue(record.at)
    totals.set(key, (totals.get(key) ?? 0) + record.totalTokens)
  }
  const cursor = new Date(start)
  cursor.setDate(cursor.getDate() - cursor.getDay())
  const today = toDateInputValue(now)
  const days = Array.from({ length: 53 * 7 }, () => {
    const key = toDateInputValue(cursor.getTime())
    const day = { key, at: cursor.getTime(), totalTokens: totals.get(key) ?? 0, future: key > today || cursor.getTime() < start }
    cursor.setDate(cursor.getDate() + 1)
    return day
  })
  const max = Math.max(0, ...days.map(day => day.totalTokens))
  return days.map(day => ({ ...day, level: day.totalTokens <= 0 ? 0 : Math.min(4, Math.ceil(day.totalTokens / max * 4)) }))
}

export function endOfDay(ts: number): number {
  const cursor = new Date(ts)
  cursor.setHours(23, 59, 59, 999)
  return cursor.getTime()
}

/** 日期输入框值（`yyyy-MM-dd`，本地时区）与时间戳互转。 */
export function toDateInputValue(ts: number): string {
  const date = new Date(ts)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function parseDateInput(value: string): number | undefined {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return undefined
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (!Number.isFinite(parsed.getTime())) return undefined
  // 溢出日期（如 2026-02-30）会被 Date 回绕，需回校验。
  if (parsed.getMonth() !== Number(match[2]) - 1 || parsed.getDate() !== Number(match[3])) return undefined
  return parsed.getTime()
}

export interface NormalizedCustomRange {
  start: number
  end: number
  error?: CustomRangeError
}

/**
 * 自定义区间归一化：起止按本地日边界展开，结束超过 now 按 now 截断。
 * 非法格式、开始晚于结束返回 `invalid`；开始在未来返回 `future`；跨度超限返回 `span`。
 */
export function normalizeCustomRange(startInput: number | undefined, endInput: number | undefined, now: number): NormalizedCustomRange {
  if (startInput === undefined || endInput === undefined || !Number.isFinite(startInput) || !Number.isFinite(endInput)) {
    return { start: startOfDay(now), end: now, error: 'invalid' }
  }
  const start = startOfDay(startInput)
  let end = endOfDay(endInput)
  if (start > end) return { start, end, error: 'invalid' }
  if (start > now) return { start, end: now, error: 'future' }
  if (end > now) end = now
  if (end - start > MAX_CUSTOM_SPAN_MS) return { start, end, error: 'span' }
  return { start, end }
}

export function rangeStartFor(range: UsageRange, now: number, custom?: CustomDateRange): number {
  if (range === 'custom' && custom) return startOfDay(custom.start)
  const cursor = new Date(now)
  if (range === 'today') {
    cursor.setHours(0, 0, 0, 0)
    return cursor.getTime()
  }
  if (range === 'week') {
    cursor.setHours(0, 0, 0, 0)
    const mondayOffset = (cursor.getDay() + 6) % 7
    return cursor.getTime() - mondayOffset * DAY_MS
  }
  return new Date(cursor.getFullYear(), cursor.getMonth(), 1).getTime()
}

export function rangeEndFor(range: UsageRange, now: number, custom?: CustomDateRange): number {
  if (range === 'custom' && custom) return Math.min(endOfDay(custom.end), now)
  return now
}

/** 时间分桶：today 按小时，week/month 按日，custom 按跨度自适应（≤48h 按小时，否则按日，>62 天按周）。 */
export interface TimeBucket {
  key: string
  label: string
  totalTokens: number
  hits: number
  misses: number
  unknown: number
  output: number
}

export type CustomBucketMode = 'hour' | 'day' | 'week'

export function customBucketModeFor(start: number, end: number): CustomBucketMode {
  const span = end - start
  if (span <= 2 * DAY_MS) return 'hour'
  if (span <= 62 * DAY_MS) return 'day'
  return 'week'
}

function dayLabel(at: number): string {
  const date = new Date(at)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

function bucketKeyFor(range: UsageRange, at: number, custom?: CustomDateRange, now: number = Date.now()): { key: string; label: string } {
  const date = new Date(at)
  if (range === 'today') {
    const hour = date.getHours()
    return { key: `h${hour}`, label: String(hour) }
  }
  if (range === 'custom' && custom) {
    const start = startOfDay(custom.start)
    const mode = customBucketModeFor(start, Math.min(endOfDay(custom.end), now))
    if (mode === 'hour') {
      const index = Math.max(0, Math.floor((at - start) / HOUR_MS))
      const label = `${dayLabel(at)} ${String(date.getHours()).padStart(2, '0')}:00`
      return { key: `ch${index}`, label }
    }
    if (mode === 'week') {
      const index = Math.max(0, Math.floor((startOfDay(at) - start) / (7 * DAY_MS)))
      return { key: `cw${index}`, label: dayLabel(start + index * 7 * DAY_MS) }
    }
    return { key: `cd${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`, label: dayLabel(at) }
  }
  const month = date.getMonth() + 1
  const day = date.getDate()
  return { key: `d${month}-${day}`, label: `${month}/${day}` }
}

function bucketKeysFor(range: UsageRange, now: number, custom?: CustomDateRange): Array<{ key: string; label: string }> {
  if (range === 'today') {
    return Array.from({ length: 24 }, (_, hour) => ({ key: `h${hour}`, label: String(hour) }))
  }
  if (range === 'custom' && custom) {
    const start = startOfDay(custom.start)
    const end = Math.min(endOfDay(custom.end), now)
    if (end < start) return []
    const mode = customBucketModeFor(start, end)
    if (mode === 'hour') {
      const count = Math.min(72, Math.floor((end - start) / HOUR_MS) + 1)
      return Array.from({ length: count }, (_, index) => {
        const at = start + index * HOUR_MS
        const date = new Date(at)
        return { key: `ch${index}`, label: `${dayLabel(at)} ${String(date.getHours()).padStart(2, '0')}:00` }
      })
    }
    if (mode === 'week') {
      const keys: Array<{ key: string; label: string }> = []
      let index = 0
      let cursor = start
      while (cursor <= end && index < 60) {
        keys.push({ key: `cw${index}`, label: dayLabel(cursor) })
        index += 1
        cursor += 7 * DAY_MS
      }
      return keys
    }
    const keys: Array<{ key: string; label: string }> = []
    const cursor = new Date(start)
    cursor.setHours(12, 0, 0, 0)
    const last = new Date(end)
    last.setHours(12, 0, 0, 0)
    while (cursor.getTime() <= last.getTime() && keys.length < 400) {
      const at = cursor.getTime()
      const date = new Date(at)
      keys.push({ key: `cd${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`, label: dayLabel(at) })
      cursor.setDate(cursor.getDate() + 1)
    }
    return keys
  }
  const start = rangeStartFor(range, now)
  const end = new Date(now)
  const keys: Array<{ key: string; label: string }> = []
  const cursor = new Date(start)
  cursor.setHours(12, 0, 0, 0)
  const last = new Date(end)
  last.setHours(12, 0, 0, 0)
  while (cursor.getTime() <= last.getTime()) {
    keys.push(bucketKeyFor(range, cursor.getTime()))
    cursor.setDate(cursor.getDate() + 1)
  }
  return keys
}

export function aggregateUsageStats(
  records: readonly UsageRecord[],
  range: UsageRange,
  now: number = Date.now(),
  preset?: TerminalPreset,
  custom?: CustomDateRange,
): UsageStatsSummary {
  const rangeStart = rangeStartFor(range, now, custom)
  const rangeEnd = rangeEndFor(range, now, custom)
  const byPreset = new Map<TerminalPreset, UsagePresetRow>()
  const byModel = new Map<string, UsageModelRow>()
  const modelSessions = new Map<string, Set<string>>()
  const sessions = new Map<TerminalPreset, Set<string>>()
  const seen = new Set<string>()
  const seriesMap = new Map<string, TimeBucket>(
    bucketKeysFor(range, now, custom).map(({ key, label }) => [key, { key, label, totalTokens: 0, hits: 0, misses: 0, unknown: 0, output: 0 }]),
  )
  for (const record of records) {
    if (record.totalTokens === 0 || seen.has(record.id) || (preset !== undefined && record.engine !== preset) || record.at < rangeStart || record.at > rangeEnd) continue
    seen.add(record.id)
    let row = byPreset.get(record.engine)
    if (!row) {
      row = { preset: record.engine, terminals: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cacheKnown: true, models: [] }
      byPreset.set(record.engine, row)
      sessions.set(record.engine, new Set())
    }
    sessions.get(record.engine)!.add(record.sessionId)
    row.terminals = sessions.get(record.engine)!.size
    row.totalTokens += record.totalTokens
    row.inputTokens += record.inputTokens
    row.outputTokens += record.outputTokens
    row.cacheReadTokens += record.cacheReadTokens ?? 0
    row.cacheWriteTokens += record.cacheWriteTokens ?? 0
    const cacheKnown = record.cacheReadTokens !== undefined
    row.cacheKnown &&= cacheKnown
    if (record.model && !row.models.includes(record.model)) row.models.push(record.model)
    // Group by both engine and recorded model; never infer an absent model.
    const model = record.model || undefined
    const key = JSON.stringify([record.engine, model ?? null])
    let modelRow = byModel.get(key)
    if (!modelRow) {
      modelRow = { key, model, preset: record.engine, terminals: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cacheKnown: true, cacheReported: false, cacheWriteKnown: true }
      byModel.set(key, modelRow)
      modelSessions.set(key, new Set())
    }
    modelSessions.get(key)!.add(record.sessionId)
    modelRow.terminals = modelSessions.get(key)!.size
    modelRow.totalTokens += record.totalTokens
    modelRow.inputTokens += record.inputTokens
    modelRow.outputTokens += record.outputTokens
    modelRow.cacheReadTokens += record.cacheReadTokens ?? 0
    modelRow.cacheWriteTokens += record.cacheWriteTokens ?? 0
    modelRow.cacheKnown &&= cacheKnown
    modelRow.cacheReported ||= cacheKnown
    modelRow.cacheWriteKnown &&= record.cacheWriteTokens !== undefined
    const bucket = seriesMap.get(bucketKeyFor(range, record.at, custom, now).key)
    if (bucket) {
      bucket.totalTokens += record.totalTokens
      bucket.output += record.outputTokens
      if (cacheKnown) { bucket.hits += record.cacheReadTokens ?? 0; bucket.misses += record.inputTokens + (record.cacheWriteTokens ?? 0) }
      else bucket.unknown += record.inputTokens + (record.cacheWriteTokens ?? 0)
    }
  }
  const rows = [...byPreset.values()].sort((a, b) => b.totalTokens - a.totalTokens)
  const modelRows = [...byModel.values()].sort((a, b) => b.totalTokens - a.totalTokens || a.key.localeCompare(b.key))
  for (const row of rows) row.models.sort()
  return {
    range, rangeStart, rangeEnd, rows, modelRows, series: [...seriesMap.values()],
    totalTokens: rows.reduce((sum, row) => sum + row.totalTokens, 0),
    inputTokens: rows.reduce((sum, row) => sum + row.inputTokens, 0),
    outputTokens: rows.reduce((sum, row) => sum + row.outputTokens, 0),
    cacheReadTokens: rows.reduce((sum, row) => sum + row.cacheReadTokens, 0),
    cacheWriteTokens: rows.reduce((sum, row) => sum + row.cacheWriteTokens, 0),
    cacheKnown: rows.length > 0 && rows.every(row => row.cacheKnown),
    cacheReported: modelRows.some(row => row.cacheReported),
    terminals: rows.reduce((sum, row) => sum + row.terminals, 0),
    terminalsWithoutData: 0,
  }
}
