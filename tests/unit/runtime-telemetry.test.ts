import { describe, expect, it } from 'vitest'
import {
  extractDshTurnStatus,
  getEstimatedContextWindow,
  getRegistryContextWindow,
  mergeRuntimeTelemetrySnapshot,
  resolveContextWindows,
} from '../../src/renderer/src/lib/runtime-telemetry'

describe('runtime telemetry model context lookup', () => {
  it('ignores an older observation and clears cumulative usage on configuration', () => {
    const current = { preset: 'codex' as const, cacheReadTokens: 800, telemetryConfidence: 'authoritative' as const, telemetryUpdatedAt: 1_000 }
    expect(mergeRuntimeTelemetrySnapshot(current, { source: 'history', confidence: 'authoritative', cacheReadTokens: 900, observedAt: 500 })).toEqual({})
    expect(mergeRuntimeTelemetrySnapshot(current, { source: 'configuration', confidence: 'declared', observedAt: 2_000 })).toHaveProperty('cacheReadTokens', undefined)
  })
  it('clears restored numeric telemetry when only configuration is available', () => {
    expect(mergeRuntimeTelemetrySnapshot({ preset: 'janus', telemetryConfidence: 'authoritative', contextTokens: 100, totalTokens: 1000, telemetrySessionId: 'old', telemetrySessionBinding: 'exact' }, { source: 'configuration', confidence: 'declared', detectedModel: 'm', observedAt: 2000 })).toMatchObject({ contextTokens: undefined, totalTokens: undefined, telemetrySessionId: undefined, telemetryConfidence: 'declared' })
  })
  it('uses the model registry before heuristic estimates', () => {
    expect(getRegistryContextWindow('gpt-5.5')).toBe(1_050_000)
    expect(getEstimatedContextWindow('codex', 'GPT-5.5')).toBe(1_050_000)
  })

  it('separates the active runtime window from the model capacity', () => {
    expect(resolveContextWindows('codex', 'gpt-5.6-sol', 258_400)).toEqual({
      runtimeWindow: 258_400,
      modelCapacity: 1_050_000,
      effectiveWindow: 258_400,
      effectiveSource: 'runtime',
    })
  })

  it('uses model capacity when the runtime does not report a window', () => {
    expect(resolveContextWindows('codex', 'gpt-5.6-sol')).toEqual({
      modelCapacity: 1_050_000,
      effectiveWindow: 1_050_000,
      effectiveSource: 'model-registry',
    })
  })

  it('accepts a newer lower context value after compaction', () => {
    expect(mergeRuntimeTelemetrySnapshot(
      {
        preset: 'codex',
        telemetryUpdatedAt: 1_000,
        telemetrySource: 'history',
        telemetryConfidence: 'authoritative',
        contextTokens: 31_000,
        inputTokens: 16_000,
      },
      {
        observedAt: 1_500,
        source: 'history',
        confidence: 'authoritative',
        contextTokens: 8_000,
        inputTokens: 15_000,
      }
    )).toEqual({
      contextTokens: 8_000,
      telemetrySource: 'history',
      telemetryConfidence: 'authoritative',
      telemetryUpdatedAt: 1_500,
    })
  })

  it('rejects an older history snapshot', () => {
    expect(mergeRuntimeTelemetrySnapshot(
      {
        preset: 'codex',
        telemetryUpdatedAt: 1_000,
        contextTokens: 31_000,
      },
      {
        observedAt: 900,
        source: 'history',
        contextTokens: 8_000,
      }
    )).toEqual({})
  })

  it('does not let estimated terminal text replace authoritative usage', () => {
    expect(mergeRuntimeTelemetrySnapshot(
      {
        preset: 'codex',
        telemetryUpdatedAt: 1_000,
        telemetryConfidence: 'authoritative',
        contextTokens: 31_000,
        totalTokens: 80_000,
      },
      {
        observedAt: 1_500,
        source: 'terminal-text',
        confidence: 'estimated',
        contextTokens: 8_000,
        totalTokens: 90_000,
      }
    )).toEqual({})
  })

  it('does not bind a session discovered by an unscoped history scan', () => {
    expect(mergeRuntimeTelemetrySnapshot(
      {
        preset: 'codex',
        telemetrySessionId: 'old-session',
        telemetryUpdatedAt: 1_000,
        contextTokens: 31_000,
        inputTokens: 16_000,
        outputTokens: 4_000,
      },
      {
        sessionId: 'new-session',
        observedAt: 1_100,
        source: 'history',
        confidence: 'authoritative',
        contextTokens: 1_200,
      }
    )).toEqual({})
  })

  it('binds and counts telemetry only when an adapter confirms the session', () => {
    expect(mergeRuntimeTelemetrySnapshot(
      { preset: 'codex', telemetrySessionId: 'old-session', compactionCount: 1 },
      {
        sessionId: 'new-session',
        sessionBinding: 'exact',
        compactionCount: 2,
        compactionCountConfidence: 'exact',
        observedAt: 2_000,
        source: 'history',
        confidence: 'authoritative',
      },
    )).toMatchObject({
      telemetrySessionId: 'new-session',
      telemetrySessionBinding: 'exact',
      compactionCount: 2,
      compactionCountConfidence: 'exact',
    })
  })

  it('clears an old runtime window while a switched model awaits its capacity event', () => {
    expect(mergeRuntimeTelemetrySnapshot(
      {
        preset: 'codex',
        detectedModel: 'GPT-5.5',
        contextWindowTokens: 200_000,
        telemetryUpdatedAt: 1_000,
      },
      {
        detectedModel: 'GPT-5.6-sol',
        modelChangedAt: 2_000,
        observedAt: 2_000,
        source: 'provider-event',
        confidence: 'authoritative',
      },
    )).toMatchObject({
      detectedModel: 'GPT-5.6-sol',
      contextWindowTokens: undefined,
    })
  })

  it('reads dsh-TUI turn lifecycle markers as running or degraded, never idle', () => {
    expect(extractDshTurnStatus('🌑 模型醒了… · 12s · 3.2k tokens · esc 中断')).toBe('running')
    expect(extractDshTurnStatus('❯ hi turn error · llm-deepseek: no API key for provider route')).toBe('degraded')
    expect(extractDshTurnStatus('deepseek-flash · Max effort')).toBeUndefined()
    expect(extractDshTurnStatus('? for shortcuts')).toBeUndefined()
  })

  it('falls back to a 128k window for dsh terminals without a registry hit', () => {
    expect(getEstimatedContextWindow('dsh', 'some-unlisted-model')).toBe(128_000)
    expect(resolveContextWindows('dsh', undefined)).toEqual({
      effectiveWindow: 128_000,
      effectiveSource: 'estimated',
    })
  })

  it('drops a regressed cumulative total without a session change', () => {
    expect(mergeRuntimeTelemetrySnapshot(
      {
        preset: 'codex',
        telemetryUpdatedAt: 1_000,
        telemetryConfidence: 'authoritative',
        totalTokens: 80_000,
      },
      {
        observedAt: 1_500,
        source: 'terminal-text',
        confidence: 'estimated',
        totalTokens: 10_000,
      },
    )).toEqual({})
  })

  it('clears stale cumulative totals on an exact session switch', () => {
    // Only a hook/adapter assertion (non-history source) may rebind an
    // exact-bound terminal; a history scan with a different session is dropped.
    expect(mergeRuntimeTelemetrySnapshot(
      {
        preset: 'codex',
        telemetrySessionId: 'old-session',
        telemetrySessionBinding: 'exact',
        telemetryUpdatedAt: 1_000,
        totalTokens: 80_000,
        inputTokens: 50_000,
        outputTokens: 30_000,
      },
      {
        sessionId: 'new-session',
        sessionBinding: 'exact',
        observedAt: 2_000,
        source: 'history',
        confidence: 'authoritative',
      },
    )).toMatchObject({ telemetrySessionId: 'new-session', totalTokens: undefined, inputTokens: undefined, outputTokens: undefined })
    expect(mergeRuntimeTelemetrySnapshot(
      {
        preset: 'codex',
        telemetrySessionId: 'old-session',
        telemetrySessionBinding: 'exact',
        telemetryUpdatedAt: 1_000,
        totalTokens: 80_000,
        inputTokens: 50_000,
        outputTokens: 30_000,
      },
      {
        sessionId: 'new-session',
        sessionBinding: 'exact',
        observedAt: 2_000,
        source: 'provider-event',
        confidence: 'authoritative',
      },
    )).toMatchObject({
      telemetrySessionId: 'new-session',
      totalTokens: undefined,
      inputTokens: undefined,
      outputTokens: undefined,
    })
  })
})
