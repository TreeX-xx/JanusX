import { beforeEach, describe, expect, it, vi } from 'vitest'

const appExit = vi.fn()

vi.mock('electron', () => ({
  app: {
    exit: (...args: unknown[]) => appExit(...args),
  },
}))

import { AppShutdown } from '../../src/main/shutdown/AppShutdown'
vi.mock('../../src/main/shutdown/diagnostics', () => ({ logShutdown: vi.fn() }))

describe('AppShutdown', () => {
  beforeEach(() => {
    appExit.mockReset()
  })

  it('is single-flight and idempotent under repeated beginQuit', async () => {
    const killTerminals = vi.fn()
    const shutdown = new AppShutdown()
    shutdown.configure({ killTerminals })

    const first = shutdown.beginQuit({ reason: 'test', timeoutMs: 1000 })
    const second = shutdown.beginQuit({ reason: 'test-again', timeoutMs: 1000 })

    expect(second).toBe(first)
    expect(shutdown.isQuitting).toBe(true)

    await first

    expect(killTerminals).toHaveBeenCalledTimes(1)
    expect(appExit).toHaveBeenCalledTimes(1)
  })

  it('forces app.exit after timeout even if a step hangs', async () => {
    const hang = vi.fn(() => new Promise<void>(() => {}))
    const shutdown = new AppShutdown()
    shutdown.configure({ stopProjects: hang })

    await shutdown.beginQuit({ reason: 'timeout', timeoutMs: 50 })

    expect(appExit).toHaveBeenCalled()
  })

  it('never depends on clearAllLoaded and still runs resource stops', async () => {
    const abortChatStreams = vi.fn()
    const cancelAnalyzer = vi.fn()
    const stopHookBridge = vi.fn()
    const killTerminals = vi.fn()
    const killAgents = vi.fn()
    const stopProjects = vi.fn()
    const stopOfficeWatches = vi.fn()
    const disposeOfficeArtifactIndexes = vi.fn()
    const disposeWatchers = vi.fn()
    const destroyToast = vi.fn()
    const closeEditors = vi.fn()
    const flushAgentSessions = vi.fn()
    const disposeTerminalSession = vi.fn()
    const clearAllLoaded = vi.fn()

    const shutdown = new AppShutdown()
    shutdown.configure({
      abortChatStreams,
      cancelAnalyzer,
      stopHookBridge,
      killTerminals,
      killAgents,
      stopProjects,
      stopOfficeWatches,
      disposeOfficeArtifactIndexes,
      disposeWatchers,
      destroyToast,
      closeEditors,
      flushAgentSessions,
      disposeTerminalSession,
    })

    await shutdown.beginQuit({ reason: 'full', timeoutMs: 1000 })

    expect(clearAllLoaded).not.toHaveBeenCalled()
    expect(abortChatStreams).toHaveBeenCalledTimes(1)
    expect(cancelAnalyzer).toHaveBeenCalledTimes(1)
    expect(stopHookBridge).toHaveBeenCalledTimes(1)
    expect(killTerminals).toHaveBeenCalledTimes(1)
    expect(killAgents).toHaveBeenCalledTimes(1)
    expect(stopProjects).toHaveBeenCalledTimes(1)
    expect(stopOfficeWatches).toHaveBeenCalledTimes(1)
    expect(disposeOfficeArtifactIndexes).toHaveBeenCalledTimes(1)
    expect(disposeWatchers).toHaveBeenCalledTimes(1)
    expect(destroyToast).toHaveBeenCalledTimes(1)
    expect(closeEditors).toHaveBeenCalledTimes(1)
    expect(flushAgentSessions).toHaveBeenCalledTimes(1)
    expect(disposeTerminalSession).toHaveBeenCalledTimes(1)
    expect(appExit).toHaveBeenCalledTimes(1)
  })

  it('waits beyond the ordinary step timeout for owned Worker process-tree settlement', async () => {
    vi.useFakeTimers()
    try {
      const killTerminals = vi.fn(), shutdown = new AppShutdown()
      shutdown.configure({ flushSuperAgentRecords: () => new Promise<void>(resolve => setTimeout(resolve, 8000)), killTerminals })
      const quitting = shutdown.beginQuit()
      await vi.advanceTimersByTimeAsync(4500)
      expect(killTerminals).toHaveBeenCalledTimes(1); expect(appExit).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(3500); await quitting
      expect(killTerminals).toHaveBeenCalledTimes(1); expect(appExit).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
  })

  it('continues after a step failure', async () => {
    const failing = vi.fn(async () => {
      throw new Error('boom')
    })
    const later = vi.fn()
    const shutdown = new AppShutdown()
    shutdown.configure({
      abortChatStreams: failing,
      // destroyToast runs first; use a later step for "continues after failure"
      disposeWatchers: later,
    })

    await shutdown.beginQuit({ timeoutMs: 1000 })

    expect(failing).toHaveBeenCalledTimes(1)
    expect(later).toHaveBeenCalledTimes(1)
    expect(appExit).toHaveBeenCalledTimes(1)
    expect(appExit).toHaveBeenCalledWith(1)
  })

  it('marks quitting before renderer acknowledgement and starts critical stops despite a hung worker', async () => {
    const shutdown = new AppShutdown(), terminals = vi.fn(), office = vi.fn(), transport = vi.fn()
    expect(shutdown.requestQuit()).toBe(true)
    expect(shutdown.requestQuit()).toBe(false)
    shutdown.configure({ flushSuperAgentRecords: () => new Promise(() => {}), killTerminals: terminals,
      stopOfficeWatches: office, disconnectWorkspaceTransports: transport })
    const flight = shutdown.beginQuit({ timeoutMs: 50 })
    await Promise.resolve(); await Promise.resolve()
    expect(terminals).toHaveBeenCalledOnce(); expect(office).toHaveBeenCalledOnce(); expect(transport).toHaveBeenCalledOnce()
    await flight
    expect(appExit).toHaveBeenCalledWith(1)
  })

  it('does not finalize terminal records before asynchronous disposal completes', async () => {
    const shutdown = new AppShutdown(), flush = vi.fn()
    let release!: () => void
    shutdown.configure({ killTerminals: () => new Promise<void>(resolve => { release = resolve }), flushAgentSessions: flush })
    const flight = shutdown.beginQuit()
    await Promise.resolve(); await Promise.resolve()
    expect(flush).not.toHaveBeenCalled()
    release(); await flight
    expect(flush).toHaveBeenCalledOnce(); expect(appExit).toHaveBeenCalledWith(0)
  })

  it('destroys toast/editor early and kills terminals before flushing session records', async () => {
    const order: string[] = []
    const track = (name: string) => vi.fn(() => {
      order.push(name)
    })

    const destroyToast = track('destroyToast')
    const closeEditors = track('closeEditors')
    const flushAgentSessions = track('flushAgentSessions')
    const stopOfficeWatches = track('stopOfficeWatches')
    const killTerminals = track('killTerminals')
    const stopRuntimeTelemetry = track('stopRuntimeTelemetry')
    const disposeOfficeArtifactIndexes = track('disposeOfficeArtifactIndexes')
    const disposeTerminalSession = track('disposeTerminalSession')
    const abortChatStreams = track('abortChatStreams')
    const flushSuperAgentRecords = track('flushSuperAgentRecords')

    const shutdown = new AppShutdown()
    shutdown.configure({
      destroyToast,
      closeEditors,
      abortChatStreams,
      flushSuperAgentRecords,
      flushAgentSessions,
      stopOfficeWatches,
      killTerminals,
      stopRuntimeTelemetry,
      disposeOfficeArtifactIndexes,
      disposeTerminalSession,
    })

    await shutdown.beginQuit({ reason: 'order', timeoutMs: 1000 })

    expect(order.indexOf('destroyToast')).toBeLessThan(order.indexOf('abortChatStreams'))
    expect(order.indexOf('closeEditors')).toBeLessThan(order.indexOf('abortChatStreams'))
    expect(flushSuperAgentRecords).toHaveBeenCalledTimes(1)
    expect(order.indexOf('abortChatStreams')).toBeLessThan(order.indexOf('flushSuperAgentRecords'))
    expect(order.indexOf('flushSuperAgentRecords')).toBeLessThan(order.indexOf('killTerminals'))
    // AC9: kill terminals before finalizing checkpoints so no native pty
    // callback can fire sendToRenderer into a torn-down window during finalize.
    expect(order.indexOf('killTerminals')).toBeLessThan(order.indexOf('flushAgentSessions'))
    expect(order.indexOf('killTerminals')).toBeLessThan(order.indexOf('stopRuntimeTelemetry'))
    expect(order.indexOf('stopRuntimeTelemetry')).toBeLessThan(order.indexOf('flushAgentSessions'))
    expect(order.indexOf('killTerminals')).toBeLessThan(order.indexOf('stopOfficeWatches'))
    expect(order.indexOf('killTerminals')).toBeLessThan(order.indexOf('disposeOfficeArtifactIndexes'))
    expect(order.indexOf('killTerminals')).toBeLessThan(order.indexOf('disposeTerminalSession'))
  })
})
