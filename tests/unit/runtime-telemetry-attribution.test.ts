import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

const testContext = vi.hoisted(() => ({ homeDir: '', userData: '' }))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => testContext.userData) },
}))

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return {
    ...actual,
    default: { ...actual.default, homedir: () => testContext.homeDir },
  }
})

const { TerminalContextCoordinator } = await import('../../src/main/runtime-telemetry/coordinator')
const coordinators: InstanceType<typeof TerminalContextCoordinator>[] = []
function createCoordinator() {
  const value = new TerminalContextCoordinator()
  coordinators.push(value)
  return value
}

const CWD = 'C:/repo'
// Keep terminal starts and file timestamps on one clock even on slow runners.
const NOW = Date.now()
const SESSION_ID = '01a11111-1111-4111-8111-111111111111'

async function writeCodexSession(cwd: string, mtime: number) {
  const dir = join(testContext.homeDir, '.codex', 'sessions', '2026', '10', '14')
  await mkdir(dir, { recursive: true })
  const file = join(dir, `rollout-2026-10-14T06-00-00-${SESSION_ID}.jsonl`)
  await writeFile(file, [
    JSON.stringify({ timestamp: '2026-10-14T06:00:00Z', ordinal: 0, type: 'session_meta', payload: { id: SESSION_ID, cwd } }),
    JSON.stringify({ timestamp: '2026-10-14T06:04:00Z', ordinal: 1, type: 'turn_context', payload: { model: 'gpt-6-astra', cwd } }),
  ].join('\n'))
  await utimes(file, new Date(mtime), new Date(mtime))
  return file
}

describe('terminal attribution without hooks', () => {
  beforeEach(async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    vi.stubEnv('CODEX_HOME', '')
    testContext.homeDir = await mkdtemp(join(tmpdir(), 'janusx-attribution-home-'))
    testContext.userData = await mkdtemp(join(tmpdir(), 'janusx-attribution-data-'))
  })

  afterEach(async () => {
    await Promise.all(coordinators.splice(0).map(value => value.shutdown()))
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await rm(testContext.homeDir, { recursive: true, force: true })
    await rm(testContext.userData, { recursive: true, force: true })
  })

  it('binds an unbound terminal to the session its pty activity matches', async () => {
    await writeCodexSession(CWD, NOW)
    const coordinator = createCoordinator()
    coordinator.trackTerminal('terminal-1', 'codex', CWD)
    coordinator.noteTerminalActivity('terminal-1', NOW)

    await coordinator.runAttributionPass()

    const snapshot = await coordinator.getSnapshot({ terminalId: 'terminal-1', preset: 'codex', cwd: CWD })
    expect(snapshot).toMatchObject({ sessionId: SESSION_ID, sessionBinding: 'correlated', detectedModel: 'gpt-6-astra' })
  })

  it.each(['hook', undefined])('ignores persisted legacy binding source %s until independent attribution', async (source) => {
    await writeCodexSession(CWD, NOW)
    const path = join(testContext.userData, 'janusx', 'terminal-context-ledger.json')
    await mkdir(join(testContext.userData, 'janusx'), { recursive: true })
    await writeFile(path, JSON.stringify({ version: 1, terminals: { 'terminal-1': {
      engine: 'codex', sessionId: SESSION_ID, source, modelSegments: [], updatedAt: NOW,
    } } }))
    const coordinator = createCoordinator()
    coordinator.trackTerminal('terminal-1', 'codex', CWD)
    const request = { terminalId: 'terminal-1', preset: 'codex' as const, cwd: CWD }
    expect((await coordinator.getSnapshot(request))?.sessionId).toBeUndefined()
    coordinator.noteTerminalActivity('terminal-1', NOW)
    await coordinator.runAttributionPass()
    expect(await coordinator.getSnapshot(request)).toMatchObject({ sessionId: SESSION_ID, sessionBinding: 'correlated' })
    expect(JSON.parse(await readFile(path, 'utf8')).terminals['terminal-1'].source).toBe('correlated')
  })

  it('keeps one session exclusive across terminals', async () => {
    await writeCodexSession(CWD, NOW)
    const coordinator = createCoordinator()
    coordinator.trackTerminal('terminal-1', 'codex', CWD)
    coordinator.trackTerminal('terminal-2', 'codex', CWD)
    coordinator.noteTerminalActivity('terminal-1', NOW)
    coordinator.noteTerminalActivity('terminal-2', NOW)

    await coordinator.runAttributionPass()

    const first = await coordinator.getSnapshot({ terminalId: 'terminal-1', preset: 'codex', cwd: CWD })
    const second = await coordinator.getSnapshot({ terminalId: 'terminal-2', preset: 'codex', cwd: CWD })
    expect([first, second].filter(snapshot => snapshot?.sessionId === undefined)).toHaveLength(2)
  })

  it('stays unbound without pty activity even when a session file exists', async () => {
    await writeCodexSession(CWD, NOW)
    const coordinator = createCoordinator()
    coordinator.trackTerminal('terminal-1', 'codex', CWD)

    await coordinator.runAttributionPass()

    const snapshot = await coordinator.getSnapshot({ terminalId: 'terminal-1', preset: 'codex', cwd: CWD })
    expect(snapshot?.sessionBinding).toBeUndefined()
    expect(snapshot?.sessionId).toBeUndefined()
  })
})
