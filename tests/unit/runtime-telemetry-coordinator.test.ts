import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendFile, mkdtemp, readFile, rename, rm, stat, unlink, utimes, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { sourceVersion } from '../../src/main/runtime-telemetry/source-version'
import { UsageLedger } from '../../src/main/runtime-telemetry/usage-ledger'

const testContext = vi.hoisted(() => ({ userData: '', snapshots: [] as Array<Record<string, unknown>> }))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => testContext.userData) },
}))

vi.mock('../../src/main/runtime-telemetry/history', () => ({
  getRuntimeTelemetrySnapshot: vi.fn(async (request: Record<string, unknown>) => {
    testContext.snapshots.push(request)
    return request.sessionId
      ? { sessionId: request.sessionId, contextTokens: 100, contextWindowTokens: 200, source: 'history', confidence: 'authoritative' }
      : { contextTokens: 0, contextWindowTokens: 200, source: 'configuration', confidence: 'declared' }
  }),
}))

const { TerminalContextCoordinator } = await import('../../src/main/runtime-telemetry/coordinator')
const coordinators: InstanceType<typeof TerminalContextCoordinator>[] = []
function createCoordinator() {
  const value = new TerminalContextCoordinator()
  coordinators.push(value)
  return value
}
const { getRuntimeTelemetrySnapshot } = await import('../../src/main/runtime-telemetry/history')
const defaultReader = vi.mocked(getRuntimeTelemetrySnapshot).getMockImplementation()!

describe('TerminalContextCoordinator', () => {
  it('binds concurrent owned Codex backends independently of cwd, output timing and renderer claims', async () => {
    const coordinator = createCoordinator()
    for (const id of ['a', 'b']) coordinator.trackTerminal(id, 'codex', 'C:/repo', undefined, undefined, true)
    expect(coordinator.bindNativeSession('a', 'native-a')).toBe(true)
    expect(coordinator.bindNativeSession('b', 'native-b')).toBe(true)
    expect(coordinator.bindSession('b', 'codex', 'native-a')).toBe(false)
    const a = await coordinator.getSnapshot({ terminalId: 'a', preset: 'codex', cwd: 'C:/repo', sessionId: 'native-b' })
    const b = await coordinator.getSnapshot({ terminalId: 'b', preset: 'codex', cwd: 'C:/repo' })
    expect(a).toMatchObject({ sessionId: 'native-a', sessionBinding: 'exact', contextTokens: 100 })
    expect(b).toMatchObject({ sessionId: 'native-b', sessionBinding: 'exact', contextTokens: 100 })
  })

  it('accepts native identity only for a registered owned Codex backend and rejects late callbacks', async () => {
    const coordinator = createCoordinator()
    expect(coordinator.bindNativeSession('a', 'native-a')).toBe(false)
    coordinator.trackTerminal('a', 'codex', 'C:/repo')
    expect(coordinator.bindNativeSession('a', 'native-a')).toBe(false)
    coordinator.trackTerminal('a', 'codex', 'C:/repo', undefined, undefined, true)
    expect(coordinator.bindNativeSession('a', 'native-a')).toBe(true)
    await coordinator.releaseTerminal('a')
    expect(coordinator.bindNativeSession('a', 'native-a')).toBe(false)
  })

  it('corrects a heuristic owner without stealing another native connection', async () => {
    const coordinator = createCoordinator()
    coordinator.trackTerminal('heuristic', 'codex', 'C:/repo')
    coordinator.bindSession('heuristic', 'codex', 'session')
    for (const id of ['a', 'b']) coordinator.trackTerminal(id, 'codex', 'C:/repo', undefined, undefined, true)
    expect(coordinator.bindNativeSession('a', 'session')).toBe(true)
    expect(await coordinator.getSnapshot({ terminalId: 'heuristic', preset: 'codex', cwd: 'C:/repo' })).toMatchObject({ source: 'configuration' })
    expect(coordinator.bindNativeSession('b', 'previous')).toBe(true)
    expect(coordinator.bindNativeSession('b', 'session')).toBe(false)
    expect(await coordinator.getSnapshot({ terminalId: 'b', preset: 'codex', cwd: 'C:/repo' })).toMatchObject({ source: 'configuration' })
    expect(await coordinator.getSnapshot({ terminalId: 'a', preset: 'codex', cwd: 'C:/repo' })).toMatchObject({ sessionId: 'session', sessionBinding: 'exact' })
  })

  it('requires native reconfirmation after restart rather than trusting a persisted process identity', async () => {
    const first = createCoordinator()
    first.trackTerminal('a', 'codex', 'C:/repo', undefined, undefined, true)
    first.bindNativeSession('a', 'old')
    await first.getSnapshot({ terminalId: 'a', preset: 'codex', cwd: 'C:/repo' })
    const restored = createCoordinator()
    restored.trackTerminal('a', 'codex', 'C:/repo', undefined, undefined, true)
    expect(await restored.getSnapshot({ terminalId: 'a', preset: 'codex', cwd: 'C:/repo' })).toMatchObject({ source: 'configuration' })
    restored.bindNativeSession('a', 'resumed')
    expect(await restored.getSnapshot({ terminalId: 'a', preset: 'codex', cwd: 'C:/repo' })).toMatchObject({ sessionId: 'resumed', sessionBinding: 'exact' })
  })

  it('publishes empty new-thread identity before its first rollout exists', async () => {
    const coordinator = createCoordinator()
    const notify = vi.fn()
    coordinator.trackTerminal('a', 'codex', 'C:/repo', notify, undefined, true)
    coordinator.bindNativeSession('a', 'old')
    await coordinator.getSnapshot({ terminalId: 'a', preset: 'codex', cwd: 'C:/repo' })
    vi.mocked(getRuntimeTelemetrySnapshot).mockResolvedValue(null)
    coordinator.bindNativeSession('a', 'new')
    expect(await coordinator.getSnapshot({ terminalId: 'a', preset: 'codex', cwd: 'C:/repo' })).toMatchObject({ sessionId: 'new', sessionBinding: 'exact', source: 'history' })
    expect(notify.mock.calls.at(-1)?.[0]).toMatchObject({ sessionId: 'new' })
    expect(notify.mock.calls.at(-1)?.[0].contextTokens).toBeUndefined()
  })

  beforeEach(async () => {
    testContext.userData = await mkdtemp(join(tmpdir(), 'janusx-context-ledger-'))
    testContext.snapshots = []
    vi.mocked(getRuntimeTelemetrySnapshot).mockImplementation(defaultReader)
  })

  afterEach(async () => {
    await Promise.all(coordinators.splice(0).map(value => value.shutdown()))
    vi.restoreAllMocks()
    vi.useRealTimers()
    await rm(testContext.userData, { recursive: true, force: true })
  })

  it('keeps an external session exclusively bound to one JanusX terminal', async () => {
    const coordinator = createCoordinator()
    expect(coordinator.bindSession('terminal-a', 'codex', 'session-1')).toBe(true)
    expect(coordinator.bindSession('terminal-b', 'codex', 'session-1')).toBe(false)

    const first = await coordinator.getSnapshot({ terminalId: 'terminal-a', preset: 'codex', cwd: 'C:/repo' })
    const second = await coordinator.getSnapshot({ terminalId: 'terminal-b', preset: 'codex', cwd: 'C:/repo', sessionId: 'session-1' })

    expect(first).toMatchObject({ sessionId: 'session-1', sessionBinding: 'correlated' })
    expect(second).toMatchObject({ source: 'configuration' })
    expect(testContext.snapshots).toEqual([
      expect.objectContaining({ sessionId: 'session-1' }),
      expect.objectContaining({ sessionId: undefined }),
    ])
  })

  it('keeps the launch Codex home through hook refreshes, renderer reads and final collection', async () => {
    const coordinator = createCoordinator()
    const codexHome = join(testContext.userData, 'recovery-codex')
    coordinator.trackTerminal('terminal-a', 'codex', 'C:/repo', undefined, codexHome)
    coordinator.bindSession('terminal-a', 'codex', 'session-1')
    coordinator.trackTerminal('terminal-a', 'codex', 'C:/repo')
    await coordinator.getSnapshot({ terminalId: 'terminal-a', preset: 'codex', cwd: 'C:/repo' })
    await coordinator.releaseTerminal('terminal-a')
    expect(testContext.snapshots).toHaveLength(2)
    expect(testContext.snapshots.every(request => request.codexHome === codexHome)).toBe(true)
    await coordinator.getSnapshot({ terminalId: 'terminal-a', preset: 'codex', cwd: 'C:/repo' })
    expect(testContext.snapshots.at(-1)?.codexHome).toBeUndefined()
  })

  it('persists an exact binding for renderer reloads', async () => {
    const first = createCoordinator()
    first.bindSession('terminal-a', 'codex', 'session-1')

    const restored = createCoordinator()
    const snapshot = await restored.getSnapshot({ terminalId: 'terminal-a', preset: 'codex', cwd: 'C:/repo' })

    expect(snapshot).toMatchObject({ sessionId: 'session-1', sessionBinding: 'correlated' })
  })

  it('releases a session when its terminal exits', async () => {
    const coordinator = createCoordinator()
    coordinator.bindSession('terminal-a', 'opencode', 'session-1')
    coordinator.unbindTerminal('terminal-a')

    expect(coordinator.bindSession('terminal-b', 'opencode', 'session-1')).toBe(true)
    const restored = createCoordinator()
    const snapshot = await restored.getSnapshot({ terminalId: 'terminal-a', preset: 'opencode', cwd: 'C:/repo' })
    expect(snapshot).toMatchObject({ source: 'configuration' })
  })

  it('rejects an in-flight history result after session rebinding', async () => {
    const coordinator = createCoordinator()
    coordinator.bindSession('t', 'codex', 'old')
    let resolve!: (snapshot: { sessionId: string; detectedModel: string }) => void
    vi.mocked(getRuntimeTelemetrySnapshot).mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const pending = coordinator.getSnapshot({ terminalId: 't', preset: 'codex', cwd: 'C:/repo' })
    await Promise.resolve()
    await Promise.resolve()
    coordinator.bindSession('t', 'codex', 'new')
    resolve({ sessionId: 'old', detectedModel: 'old-model' })
    expect(await pending).toBeNull()
    expect(await coordinator.getSnapshot({ terminalId: 't', preset: 'codex', cwd: 'C:/repo' })).toMatchObject({ sessionId: 'new' })
  })

  it('rejects an in-flight result after terminal unbinding', async () => {
    const coordinator = createCoordinator()
    coordinator.bindSession('t', 'codex', 's')
    let resolve!: (snapshot: { sessionId: string }) => void
    vi.mocked(getRuntimeTelemetrySnapshot).mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const pending = coordinator.getSnapshot({ terminalId: 't', preset: 'codex', cwd: 'C:/repo' })
    await Promise.resolve()
    await Promise.resolve()
    coordinator.unbindTerminal('t')
    resolve({ sessionId: 's' })
    expect(await pending).toBeNull()
  })

  it('collects without a renderer, retains usage after exit and resumes the same baseline', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    let input = 100
    vi.mocked(getRuntimeTelemetrySnapshot).mockImplementation(async request => ({ sessionId: request.sessionId, source: 'history', usageObservation: { engine: 'codex', namespace: '/native', sessionId: request.sessionId!, mode: 'cumulative', collectedAt: Date.now(), counters: { inputTokens: input, outputTokens: 0, totalTokens: input } } }))
    const coordinator = createCoordinator()
    coordinator.bindSession('t', 'codex', 's')
    coordinator.trackTerminal('t', 'codex', 'C:/repo')
    await coordinator.getSnapshot({ terminalId: 't', preset: 'codex', cwd: 'C:/repo', startedAt: 9999999 })
    expect(testContext.snapshots.at(-1)?.startedAt).not.toBe(9999999)
    input = 110
    await vi.advanceTimersByTimeAsync(10_000)
    input = 120
    await coordinator.releaseTerminal('t')
    const restored = createCoordinator()
    restored.bindSession('other', 'codex', 's')
    input = 125
    vi.setSystemTime(12_000)
    await restored.getSnapshot({ terminalId: 'other', preset: 'codex', cwd: 'C:/repo' })
    expect(restored.listUsage({ start: 0, end: 20_000 }).records.map(record => record.totalTokens)).toEqual([10, 10, 5])
    vi.mocked(getRuntimeTelemetrySnapshot).mockReset()
  })

  it('reuses unchanged file projections, forces periodic verification and detects growth with preserved mtime', async () => {
    const file = join(testContext.userData, 'session.jsonl')
    await writeFile(file, '100')
    let now = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const reader = vi.mocked(getRuntimeTelemetrySnapshot).mockClear().mockImplementation(async request => {
      const info = await stat(file)
      return { sessionId: request.sessionId, filePath: file, sourceVersion: sourceVersion(info), contextTokens: Number(await readFile(file, 'utf8')) }
    })
    const coordinator = createCoordinator()
    coordinator.bindSession('t', 'codex', 's')
    const request = { terminalId: 't', preset: 'codex' as const, cwd: 'C:/repo' }
    expect((await coordinator.getSnapshot(request))?.contextTokens).toBe(100)
    await coordinator.getSnapshot(request)
    expect(reader).toHaveBeenCalledTimes(1)
    now += 30_000
    await coordinator.getSnapshot(request)
    expect(reader).toHaveBeenCalledTimes(2)
    const before = await stat(file)
    await appendFile(file, '0')
    await utimes(file, before.atime, before.mtime)
    expect((await coordinator.getSnapshot(request))?.contextTokens).toBe(1000)
    expect(reader).toHaveBeenCalledTimes(3)
  })

  it('invalidates same-sized rewrites, replacement, deletion and session rebinding', async () => {
    const file = join(testContext.userData, 'session.jsonl')
    await writeFile(file, '100')
    const reader = vi.mocked(getRuntimeTelemetrySnapshot).mockClear().mockImplementation(async request => {
      const info = await stat(file).catch(() => null)
      return info ? { sessionId: request.sessionId, filePath: file, sourceVersion: sourceVersion(info), contextTokens: Number(await readFile(file, 'utf8')) } : null
    })
    const coordinator = createCoordinator()
    coordinator.bindSession('t', 'codex', 's')
    const request = { terminalId: 't', preset: 'codex' as const, cwd: 'C:/repo' }
    await coordinator.getSnapshot(request)
    const before = await stat(file)
    await writeFile(file, '200')
    await utimes(file, before.atime, before.mtime)
    expect((await coordinator.getSnapshot(request))?.contextTokens).toBe(200)
    const replacement = file + '.tmp'
    await writeFile(replacement, '300')
    await rename(replacement, file)
    expect((await coordinator.getSnapshot(request))?.contextTokens).toBe(300)
    await unlink(file)
    expect(await coordinator.getSnapshot(request)).toBeNull()
    await writeFile(file, '400')
    expect((await coordinator.getSnapshot(request))?.contextTokens).toBe(400)
    coordinator.bindSession('t', 'codex', 'other')
    expect((await coordinator.getSnapshot(request))?.sessionId).toBe('other')
    expect(reader).toHaveBeenCalledTimes(6)
  })

  it('does not cache failed accounting and refuses new work after shutdown', async () => {
    const file = join(testContext.userData, 'session.jsonl')
    await writeFile(file, '100')
    const reader = vi.mocked(getRuntimeTelemetrySnapshot).mockClear().mockImplementation(async request => ({
      sessionId: request.sessionId, filePath: file, sourceVersion: sourceVersion(await stat(file)),
      usageObservation: { engine: 'codex', namespace: '/native', sessionId: request.sessionId!, mode: 'cumulative', collectedAt: Date.now(), counters: { inputTokens: 100, outputTokens: 0, totalTokens: 100 } },
    }))
    const fail = vi.spyOn(UsageLedger.prototype, 'record').mockImplementationOnce(() => { throw new Error('busy') })
    const coordinator = createCoordinator()
    coordinator.bindSession('t', 'codex', 's')
    const request = { terminalId: 't', preset: 'codex' as const, cwd: 'C:/repo' }
    await coordinator.getSnapshot(request)
    fail.mockRestore()
    await coordinator.getSnapshot(request)
    expect(reader).toHaveBeenCalledTimes(2)
    await coordinator.shutdown()
    expect(await coordinator.getSnapshot(request)).toBeNull()
    expect(coordinator.bindSession('t', 'codex', 'new')).toBe(false)
  })

  it('cancels the delayed corpus scan and polling when shut down', async () => {
    vi.useFakeTimers()
    const coordinator = createCoordinator()
    coordinator.startCorpusScan()
    coordinator.trackTerminal('t', 'codex', 'C:/repo')
    const reader = vi.mocked(getRuntimeTelemetrySnapshot).mockClear()
    await coordinator.shutdown()
    const finalReads = reader.mock.calls.length
    await vi.advanceTimersByTimeAsync(600_000)
    expect(reader).toHaveBeenCalledTimes(finalReads)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('persists the final usage delta before closing the ledger', async () => {
    let input = 100
    vi.mocked(getRuntimeTelemetrySnapshot).mockImplementation(async request => ({ sessionId: request.sessionId,
      usageObservation: { engine: 'codex', namespace: '/native', sessionId: request.sessionId!, mode: 'cumulative',
        collectedAt: Date.now(), counters: { inputTokens: input, outputTokens: 0, totalTokens: input } } }))
    const coordinator = createCoordinator()
    coordinator.bindSession('t', 'codex', 's')
    coordinator.trackTerminal('t', 'codex', 'C:/repo')
    await coordinator.getSnapshot({ terminalId: 't', preset: 'codex', cwd: 'C:/repo' })
    input = 125
    const stopping = coordinator.shutdown()
    await coordinator.releaseTerminal('t')
    await stopping
    const ledger = new UsageLedger(() => join(testContext.userData, 'janusx', 'usage-ledger.sqlite'))
    try {
      expect(ledger.list({ start: Date.now() - 60_000, end: Date.now() + 1000 }).records.map(value => value.totalTokens)).toEqual([25])
    } finally { ledger.close() }
  })
})
