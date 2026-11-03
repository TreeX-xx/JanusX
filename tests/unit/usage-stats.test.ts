import { describe, expect, it } from 'vitest'
import {
  aggregateUsageStats,
  cacheSplitFor,
  formatUsageRate,
  customBucketModeFor,
  endOfDay,
  normalizeCustomRange,
  parseDateInput,
  rangeEndFor,
  rangeStartFor,
  startOfDay,
  toDateInputValue,
} from '../../src/renderer/src/lib/usage-stats'
import type { UsageRecord, UsageEngine } from '../../src/shared/usage'
type Fixture = Partial<UsageRecord> & { preset?: UsageEngine; telemetryUpdatedAt?: number; detectedModel?: string; contextTokens?: number }
function terminal(overrides: Fixture): UsageRecord {
  return { id: overrides.id ?? 't1', engine: overrides.preset ?? 'codex', sessionId: overrides.sessionId ?? overrides.id ?? 't1', at: overrides.telemetryUpdatedAt ?? 0, timeBasis: 'event', inputTokens: 0, outputTokens: 0, totalTokens: 0, ...overrides, model: overrides.detectedModel }
}

// Fixed clock: Friday 2026-10-02 12:00 local time.
const NOW = new Date(2026, 9, 2, 12, 0, 0).getTime()

describe('usage stats aggregation', () => {
  it('groups models within each engine without double-counting sessions or records', () => {
    const records = [
      terminal({ id: 'a', sessionId: 'shared', preset: 'codex', detectedModel: 'model-a', totalTokens: 100, inputTokens: 20, outputTokens: 10, cacheReadTokens: 60, cacheWriteTokens: 10, telemetryUpdatedAt: NOW }),
      terminal({ id: 'b', sessionId: 'shared', preset: 'codex', detectedModel: 'model-b', totalTokens: 200, inputTokens: 50, outputTokens: 50, cacheReadTokens: 100, cacheWriteTokens: 0, telemetryUpdatedAt: NOW }),
      terminal({ id: 'c', sessionId: 'shared', preset: 'codex', detectedModel: 'model-a', totalTokens: 100, inputTokens: 30, outputTokens: 10, cacheReadTokens: 60, telemetryUpdatedAt: NOW }),
      terminal({ id: 'd', sessionId: 'shared', preset: 'claude', detectedModel: 'model-a', totalTokens: 50, inputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, telemetryUpdatedAt: NOW }),
      terminal({ id: 'e', sessionId: 'shared', preset: 'codex', totalTokens: 10, inputTokens: 10, telemetryUpdatedAt: NOW }),
      terminal({ id: 'old', detectedModel: 'excluded', totalTokens: 9000, telemetryUpdatedAt: NOW - 86_400_000 }),
    ]
    const summary = aggregateUsageStats([...records, records[0]], 'today', NOW)
    expect(summary.modelRows).toHaveLength(4)
    expect(summary.modelRows.map(row => row.totalTokens)).toEqual([200, 200, 50, 10])
    expect(summary.modelRows.reduce((sum, row) => sum + row.totalTokens, 0)).toBe(summary.totalTokens)
    expect(summary.terminals).toBe(2)
    expect(summary.modelRows.find(row => row.preset === 'codex' && row.model === 'model-a')).toMatchObject({ terminals: 1, totalTokens: 200, inputTokens: 50, outputTokens: 20, cacheReadTokens: 120, cacheWriteTokens: 10, cacheKnown: true, cacheWriteKnown: false })
    expect(summary.modelRows.find(row => row.model === undefined)).toMatchObject({ cacheKnown: false, cacheReported: false, cacheWriteKnown: false })
    const zero = summary.modelRows.find(row => row.preset === 'claude')!
    expect(cacheSplitFor(zero.cacheReadTokens, zero.inputTokens, zero.cacheWriteTokens, zero.cacheKnown).rate).toBe(0)
    expect(summary.cacheKnown).toBe(false)
    expect(summary.cacheReported).toBe(true)
    expect(aggregateUsageStats(records, 'today', NOW, 'claude').modelRows).toHaveLength(1)
  })

  it('keeps partial cache coverage distinct from a reported zero', () => {
    const summary = aggregateUsageStats([
      terminal({ id: 'a', detectedModel: 'model', totalTokens: 100, inputTokens: 100, cacheReadTokens: 0, telemetryUpdatedAt: NOW }),
      terminal({ id: 'b', detectedModel: 'model', totalTokens: 100, inputTokens: 100, telemetryUpdatedAt: NOW }),
    ], 'today', NOW)
    expect(summary.modelRows[0]).toMatchObject({ cacheKnown: false, cacheReported: true })
    expect(formatUsageRate(cacheSplitFor(0, 200, 0, summary.modelRows[0].cacheKnown).rate)).toBe('–')
  })

  it('formats cache rates consistently without changing their calculation', () => {
    const rate = cacheSplitFor(8000, 2000, 1000).rate
    expect(rate).toBe(8 / 11)
    expect(formatUsageRate(rate)).toBe('72.7%')
    expect(formatUsageRate(rate, 2)).toBe('72.73%')
    expect(formatUsageRate(0)).toBe('0.0%')
    expect(formatUsageRate(1)).toBe('100.0%')
    expect(formatUsageRate(0.996)).toBe('99.6%')
    expect(formatUsageRate(undefined)).toBe('–')
  })
  it('deduplicates record ids, counts sessions instead of observations and preserves unknown cache coverage', () => {
    const records = [terminal({ id: '1', sessionId: 's', totalTokens: 10, inputTokens: 10, cacheReadTokens: 0, telemetryUpdatedAt: NOW }), terminal({ id: '2', sessionId: 's', totalTokens: 20, inputTokens: 20, telemetryUpdatedAt: NOW })]
    const summary = aggregateUsageStats([...records, records[0]], 'today', NOW)
    expect(summary.totalTokens).toBe(30)
    expect(summary.terminals).toBe(1)
    expect(summary.cacheKnown).toBe(false)
    expect(summary.series[12]).toMatchObject({ misses: 10, unknown: 20 })
  })
  it('computes local range boundaries', () => {
    expect(rangeStartFor('today', NOW)).toBe(new Date(2026, 9, 2, 0, 0, 0).getTime())
    expect(rangeStartFor('week', NOW)).toBe(new Date(2026, 8, 28, 0, 0, 0).getTime())
    expect(rangeStartFor('month', NOW)).toBe(new Date(2026, 9, 1, 0, 0, 0).getTime())
  })

  it('groups live terminals by preset with summed tokens', () => {
    const summary = aggregateUsageStats(
      [
        terminal({ id: 'a', preset: 'codex', detectedModel: 'GPT-5-Codex', totalTokens: 1_000, inputTokens: 700, outputTokens: 300, telemetryUpdatedAt: NOW }),
        terminal({ id: 'b', preset: 'codex', detectedModel: 'GPT-5-Codex', totalTokens: 500, telemetryUpdatedAt: NOW }),
        terminal({ id: 'c', preset: 'dsh', detectedModel: 'DeepSeek-flash', totalTokens: 2_000, contextTokens: 800, telemetryUpdatedAt: NOW }),
      ],
      'today',
      NOW,
    )
    expect(summary.terminals).toBe(3)
    expect(summary.totalTokens).toBe(3_500)
    expect(summary.terminalsWithoutData).toBe(0)
    expect(summary.rows.map((row) => row.preset)).toEqual(['dsh', 'codex'])
    expect(summary.rows[1]).toMatchObject({
      terminals: 2,
      totalTokens: 1_500,
      inputTokens: 700,
      outputTokens: 300,
      models: ['GPT-5-Codex'],
    })
  })

  it('filters by range and counts terminals without data', () => {
    const old = new Date(2026, 8, 20, 12, 0, 0).getTime()
    const summary = aggregateUsageStats(
      [
        terminal({ id: 'a', preset: 'codex', totalTokens: 1_000, telemetryUpdatedAt: NOW }),
        terminal({ id: 'b', preset: 'codex', totalTokens: 9_000, telemetryUpdatedAt: old }),
        terminal({ id: 'c', preset: 'pi', telemetryUpdatedAt: NOW }),
      ],
      'today',
      NOW,
    )
    expect(summary.terminals).toBe(1)
    expect(summary.totalTokens).toBe(1_000)
    expect(summary.terminalsWithoutData).toBe(0)
    expect(summary.rows.map((row) => row.preset)).toEqual(['codex'])
  })

  it('returns an explainable empty summary with no coverage', () => {
    const summary = aggregateUsageStats([], 'month', NOW)
    expect(summary.rows).toEqual([])
    expect(summary.totalTokens).toBe(0)
    expect(summary.terminals).toBe(0)
  })

  it('sums cache counters per preset', () => {
    const summary = aggregateUsageStats(
      [
        terminal({ id: 'a', preset: 'codex', totalTokens: 1_000, inputTokens: 600, cacheReadTokens: 300, cacheWriteTokens: 100, telemetryUpdatedAt: NOW }),
        terminal({ id: 'b', preset: 'codex', totalTokens: 500, inputTokens: 500, telemetryUpdatedAt: NOW }),
      ],
      'today',
      NOW,
    )
    expect(summary.cacheReadTokens).toBe(300)
    expect(summary.cacheWriteTokens).toBe(100)
    expect(summary.rows[0]).toMatchObject({ cacheReadTokens: 300, cacheWriteTokens: 100 })
  })

  it('splits cache hits and misses without mistaking absence for zero', () => {
    expect(cacheSplitFor(300, 600, 100)).toEqual({ hits: 300, misses: 700, rate: 0.3, hasData: true })
    expect(cacheSplitFor(0, 500, 0).hasData).toBe(true)
    expect(cacheSplitFor(0, 500, 0).rate).toBe(0)
    expect(cacheSplitFor(0, 0, 0, false)).toEqual({ hits: 0, misses: 0, rate: undefined, hasData: false })
  })

  it('buckets terminals into hourly slots for today', () => {
    const at = (hour: number) => new Date(2026, 9, 2, hour, 30, 0).getTime()
    const summary = aggregateUsageStats(
      [
        terminal({ id: 'a', preset: 'codex', totalTokens: 1_000, inputTokens: 600, cacheReadTokens: 300, cacheWriteTokens: 100, outputTokens: 200, telemetryUpdatedAt: at(9) }),
        terminal({ id: 'b', preset: 'codex', totalTokens: 500, inputTokens: 500, telemetryUpdatedAt: at(10) }),
      ],
      'today',
      NOW,
    )
    expect(summary.series).toHaveLength(24)
    expect(summary.series[9]).toMatchObject({ label: '9', totalTokens: 1_000, hits: 300, misses: 700, unknown: 0, output: 200 })
    expect(summary.series[10]).toMatchObject({ label: '10', totalTokens: 500, hits: 0, misses: 0, unknown: 500, output: 0 })
  })

  it('exposes input and output sums alongside the total', () => {
    const summary = aggregateUsageStats(
      [
        terminal({ id: 'a', preset: 'codex', totalTokens: 1_000, inputTokens: 600, outputTokens: 300, telemetryUpdatedAt: NOW }),
        terminal({ id: 'b', preset: 'claude', totalTokens: 500, inputTokens: 200, outputTokens: 250, telemetryUpdatedAt: NOW }),
      ],
      'today',
      NOW,
    )
    expect(summary.inputTokens).toBe(800)
    expect(summary.outputTokens).toBe(550)
    expect(summary.rows.find((row) => row.preset === 'codex')).toMatchObject({ inputTokens: 600, outputTokens: 300 })
  })

  it('buckets terminals into daily slots for the week and filters by preset', () => {
    const monday = new Date(2026, 8, 28, 10, 0, 0).getTime()
    const tuesday = new Date(2026, 8, 29, 10, 0, 0).getTime()
    const all = aggregateUsageStats(
      [
        terminal({ id: 'a', preset: 'codex', totalTokens: 1_000, inputTokens: 1_000, telemetryUpdatedAt: monday }),
        terminal({ id: 'b', preset: 'dsh', totalTokens: 2_000, inputTokens: 2_000, telemetryUpdatedAt: tuesday }),
      ],
      'week',
      NOW,
    )
    expect(all.series.map((bucket) => bucket.label)).toEqual(['9/28', '9/29', '9/30', '10/1', '10/2'])
    expect(all.series[0].totalTokens).toBe(1_000)
    const dshOnly = aggregateUsageStats(
      [
        terminal({ id: 'a', preset: 'codex', totalTokens: 1_000, inputTokens: 1_000, telemetryUpdatedAt: monday }),
        terminal({ id: 'b', preset: 'dsh', totalTokens: 2_000, inputTokens: 2_000, telemetryUpdatedAt: tuesday }),
      ],
      'week',
      NOW,
      'dsh',
    )
    expect(dshOnly.rows.map((row) => row.preset)).toEqual(['dsh'])
    expect(dshOnly.series[0].totalTokens).toBe(0)
    expect(dshOnly.series[1].totalTokens).toBe(2_000)
  })
})

describe('usage stats custom range', () => {
  const day = (month: number, date: number, hour = 12) => new Date(2026, month - 1, date, hour, 0, 0).getTime()

  it('rounds date inputs to local day boundaries without time drift', () => {
    const noon = new Date(2026, 9, 2, 12, 30, 0).getTime()
    expect(toDateInputValue(noon)).toBe('2026-10-02')
    expect(parseDateInput('2026-10-02')).toBe(startOfDay(noon))
    expect(parseDateInput('2026-02-30')).toBeUndefined()
    expect(parseDateInput('not-a-date')).toBeUndefined()
    expect(startOfDay(noon)).toBe(new Date(2026, 9, 2, 0, 0, 0).getTime())
    expect(endOfDay(noon)).toBe(new Date(2026, 9, 2, 23, 59, 59, 999).getTime())
  })

  it('rejects invalid, future and over-long ranges', () => {
    expect(normalizeCustomRange(day(10, 5), day(10, 1), NOW).error).toBe('invalid')
    expect(normalizeCustomRange(undefined, day(10, 2), NOW).error).toBe('invalid')
    expect(normalizeCustomRange(day(10, 10), day(10, 11), NOW).error).toBe('future')
    expect(normalizeCustomRange(day(10, 1), day(10, 2), NOW).error).toBeUndefined()
    const wide = normalizeCustomRange(new Date(2025, 0, 1).getTime(), day(10, 2), NOW)
    expect(wide.error).toBe('span')
  })

  it('clamps a future end to now instead of erroring', () => {
    const normalized = normalizeCustomRange(day(10, 1), day(10, 10), NOW)
    expect(normalized.error).toBeUndefined()
    expect(normalized.end).toBe(NOW)
    expect(rangeEndFor('custom', NOW, { start: day(10, 1), end: day(10, 10) })).toBe(NOW)
  })

  it('computes custom boundaries by day', () => {
    const custom = { start: day(9, 28), end: day(9, 30) }
    expect(rangeStartFor('custom', NOW, custom)).toBe(startOfDay(day(9, 28)))
    expect(rangeEndFor('custom', NOW, custom)).toBe(endOfDay(day(9, 30)))
  })

  it('filters terminals outside the custom window on both ends', () => {
    const custom = { start: day(9, 28), end: day(9, 30) }
    const summary = aggregateUsageStats(
      [
        terminal({ id: 'in', preset: 'codex', totalTokens: 1_000, inputTokens: 700, outputTokens: 200, telemetryUpdatedAt: day(9, 29) }),
        terminal({ id: 'before', preset: 'codex', totalTokens: 9_000, telemetryUpdatedAt: day(9, 20) }),
        terminal({ id: 'after', preset: 'codex', totalTokens: 5_000, telemetryUpdatedAt: day(10, 1) }),
      ],
      'custom',
      NOW,
      undefined,
      custom,
    )
    expect(summary.terminals).toBe(1)
    expect(summary.totalTokens).toBe(1_000)
    expect(summary.inputTokens).toBe(700)
    expect(summary.modelRows).toHaveLength(1)
    expect(summary.modelRows[0].totalTokens).toBe(1_000)
    expect(summary.outputTokens).toBe(200)
    expect(summary.rangeStart).toBe(startOfDay(day(9, 28)))
  })

  it('picks hourly buckets for short spans and weekly buckets for long spans', () => {
    expect(customBucketModeFor(day(10, 1), day(10, 2))).toBe('hour')
    expect(customBucketModeFor(day(9, 1), day(9, 20))).toBe('day')
    expect(customBucketModeFor(day(1, 1), day(10, 2))).toBe('week')
    const hourly = aggregateUsageStats([], 'custom', day(10, 2, 12), undefined, { start: day(10, 1), end: day(10, 2) })
    // 10-01 00:00 → 10-02 12:00 covers 37 hourly slots.
    expect(hourly.series).toHaveLength(37)
    expect(hourly.series[0].label).toContain('10/1')
    const weekly = aggregateUsageStats([], 'custom', NOW, undefined, { start: day(7, 1), end: day(10, 2) })
    expect(weekly.series.length).toBeGreaterThan(0)
    expect(weekly.series.length).toBeLessThanOrEqual(16)
  })

  it('buckets custom daily terminals without year collisions', () => {
    const custom = { start: day(9, 28), end: day(10, 2) }
    const summary = aggregateUsageStats(
      [terminal({ id: 'a', preset: 'codex', totalTokens: 400, inputTokens: 300, outputTokens: 100, telemetryUpdatedAt: day(9, 29) })],
      'custom',
      NOW,
      undefined,
      custom,
    )
    expect(summary.series).toHaveLength(5)
    expect(summary.series.map((bucket) => bucket.label)).toEqual(['9/28', '9/29', '9/30', '10/1', '10/2'])
    expect(summary.series[1]).toMatchObject({ totalTokens: 400, output: 100 })
  })
})
