import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
vi.mock('../../../src/main/shutdown/process-tree', () => ({ stopProcessTree: vi.fn(async (proc) => { proc.kill('SIGTERM') }) }))

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}))

vi.mock('../../../src/main/janus-runner/cli-resolver', () => ({
  resolveCLIPath: vi.fn().mockResolvedValue('/usr/bin/claude'),
}))

vi.mock('../../../src/main/janus-runner/parsers', () => ({
  createParser: vi.fn(() => ({
    parseLine: vi.fn((json: Record<string, unknown>) => {
      // Default parser: emit a text-chunk for each line
      return [{ type: 'text-chunk', text: JSON.stringify(json) }]
    }),
    reset: vi.fn(),
  })),
}))

function createMockProcess() {
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()
  const proc = Object.assign(new EventEmitter(), {
    stdout,
    stderr,
    kill: vi.fn(),
    pid: 12345,
  })
  return proc
}

type StartOpts = {
  engine: 'claude' | 'codex' | 'opencode'
  prompt: string
  cwd: string
  model?: string
}

type AgentStreamManagerInstance = InstanceType<
  Awaited<ReturnType<typeof importManager>>
>

async function importManager() {
  const { AgentStreamManager } = await import(
    '../../../src/main/janus-runner/stream-manager'
  )
  return AgentStreamManager
}

describe('AgentStreamManager', () => {
  let spawnMock: ReturnType<typeof vi.fn>
  let resolveCLIPathMock: ReturnType<typeof vi.fn>
  let createParserMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.useFakeTimers()
    const cp = await import('child_process')
    spawnMock = cp.spawn as unknown as ReturnType<typeof vi.fn>
    spawnMock.mockReset()

    const resolver = await import('../../../src/main/janus-runner/cli-resolver')
    resolveCLIPathMock = resolver.resolveCLIPath as unknown as ReturnType<typeof vi.fn>
    resolveCLIPathMock.mockReset().mockResolvedValue('/usr/bin/claude')

    const parsers = await import('../../../src/main/janus-runner/parsers')
    createParserMock = parsers.createParser as unknown as ReturnType<typeof vi.fn>
    createParserMock.mockReset().mockImplementation(() => ({
      parseLine: vi.fn((json: Record<string, unknown>) => {
        return [{ type: 'text-chunk', text: JSON.stringify(json) }]
      }),
      reset: vi.fn(),
    }))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // Encapsulate the repeated start -> emit close -> await ceremony.
  async function startAndClose(
    manager: AgentStreamManagerInstance,
    opts: StartOpts,
    afterStart?: (manager: AgentStreamManagerInstance, mockProc: ReturnType<typeof createMockProcess>) => void,
  ) {
    const mockProc = createMockProcess()
    spawnMock.mockReturnValue(mockProc)
    const startPromise = manager.start(opts)
    setTimeout(() => {
      afterStart?.(manager, mockProc)
      mockProc.emit('close', 0)
    }, 10)
    await vi.runAllTimersAsync()
    const id = await startPromise
    return { manager, mockProc, id }
  }

  // -------------------------------------------------------
  // 1. start() spawns process with correct args per engine
  // -------------------------------------------------------
  describe('start() spawns process with correct args', () => {
    it.each([
      [
        'claude',
        '/usr/bin/claude',
        'hello world',
        '/tmp',
        [
          '-p', 'hello world',
          '--output-format', 'stream-json',
          '--include-partial-messages',
          '--verbose',
          '--no-session-persistence',
          '--permission-mode', 'bypassPermissions',
        ],
      ],
      [
        'codex',
        '/usr/bin/codex',
        'test prompt',
        '/workdir',
        [
          'exec', '--json', '--skip-git-repo-check',
          '--dangerously-bypass-approvals-and-sandbox',
          '--', 'test prompt',
        ],
      ],
      [
        'opencode',
        '/usr/bin/opencode',
        'do something',
        '/project',
        [
          'run', '--format', 'json',
          '--dir', '/project',
          '--dangerously-skip-permissions',
          '--', 'do something',
        ],
      ],
    ] as const)('%s engine uses correct args', async (engine, cliPath, prompt, cwd, expectedArgs) => {
      resolveCLIPathMock.mockResolvedValue(cliPath)
      const AgentStreamManager = await importManager()
      const manager = new AgentStreamManager()
      await startAndClose(manager, { engine, prompt, cwd, approvalMode: 'auto-run' })
      expect(spawnMock).toHaveBeenCalledWith(
        cliPath,
        expectedArgs,
        expect.objectContaining({ cwd }),
      )
    })

    it('uses the engine approval flow in strict mode', async () => {
      resolveCLIPathMock.mockResolvedValue('/usr/bin/codex')
      const AgentStreamManager = await importManager()
      const manager = new AgentStreamManager()
      await startAndClose(manager, { engine: 'codex', prompt: 'strict', cwd: '/workdir', approvalMode: 'per-action' })
      expect(spawnMock.mock.calls[0][1]).toEqual(['exec', '--json', '--skip-git-repo-check', '--', 'strict'])
    })

    it('opencode engine includes --model when provided', async () => {
      resolveCLIPathMock.mockResolvedValue('/usr/bin/opencode')
      const AgentStreamManager = await importManager()
      const manager = new AgentStreamManager()
      await startAndClose(manager, {
        engine: 'opencode',
        prompt: 'do something',
        cwd: '/project',
        model: 'gpt-4o',
      })
      const args = spawnMock.mock.calls[0][1]
      expect(args).toContain('--model')
      expect(args).toContain('gpt-4o')
    })
  })

  // -------------------------------------------------------
  // 2. onEvent receives events from parsed stdout
  // -------------------------------------------------------
  describe('onEvent', () => {
    it('receives events when stdout emits JSON lines', async () => {
      const AgentStreamManager = await importManager()
      const manager = new AgentStreamManager()
      const receivedEvents: any[] = []

      await startAndClose(manager, { engine: 'claude', prompt: 'test', cwd: '/tmp' }, (mgr, mockProc) => {
        const sessions = mgr.listSessions()
        if (sessions.length > 0) {
          mgr.onEvent(sessions[0].id, (event) => {
            receivedEvents.push(event)
          })
        }
        mockProc.stdout.emit('data', Buffer.from('{"type":"test","value":42}\n'))
      })

      expect(receivedEvents.length).toBeGreaterThan(0)
      expect(receivedEvents.some((e) => e.type === 'text-chunk')).toBe(true)
      expect(receivedEvents.some((e) => e.type === 'done')).toBe(true)
    })

    it('onEvent returns an unsubscribe function', async () => {
      const AgentStreamManager = await importManager()
      const manager = new AgentStreamManager()
      const receivedEvents: any[] = []

      await startAndClose(manager, { engine: 'claude', prompt: 'test', cwd: '/tmp' }, (mgr, mockProc) => {
        const sessions = mgr.listSessions()
        let unsubscribe: (() => void) | null = null
        if (sessions.length > 0) {
          unsubscribe = mgr.onEvent(sessions[0].id, (event) => {
            receivedEvents.push(event)
          })
        }
        mockProc.stdout.emit('data', Buffer.from('{"before":"unsub"}\n'))
        unsubscribe?.()
        mockProc.stdout.emit('data', Buffer.from('{"after":"unsub"}\n'))
      })

      const textChunks = receivedEvents.filter((e) => e.type === 'text-chunk')
      for (const chunk of textChunks) {
        expect(chunk.text).not.toContain('after')
      }
    })
  })

  // -------------------------------------------------------
  // 3. cancel() kills the process
  // -------------------------------------------------------
  describe('cancel()', () => {
    it('kills the process with SIGTERM', async () => {
      const AgentStreamManager = await importManager()
      const manager = new AgentStreamManager()
      let sessionId = ''
      const { mockProc } = await startAndClose(
        manager,
        { engine: 'claude', prompt: 'test', cwd: '/tmp' },
        (mgr) => {
          const sessions = mgr.listSessions()
          if (sessions.length > 0) {
            sessionId = sessions[0].id
            mgr.cancel(sessionId)
          }
        },
      )
      expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM')
      expect(manager.getSession(sessionId)).toBeUndefined()
    })

    it('does nothing for non-existent and already completed sessions', async () => {
      const AgentStreamManager = await importManager()
      const manager = new AgentStreamManager()
      // Non-existent: should not throw, kill never called
      manager.cancel('non-existent-id')

      // Already completed: start, let close, then cancel is a no-op
      const { mockProc, id } = await startAndClose(manager, { engine: 'claude', prompt: 'test', cwd: '/tmp' })
      manager.cancel(id)
      expect(mockProc.kill).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------
  // 4. cancelAll() cancels all running sessions
  // -------------------------------------------------------
  describe('cancelAll()', () => {
    it('cancels all running sessions', async () => {
      const mockProc1 = createMockProcess()
      const mockProc2 = createMockProcess()
      spawnMock.mockReturnValueOnce(mockProc1).mockReturnValueOnce(mockProc2)

      const AgentStreamManager = await importManager()
      const manager = new AgentStreamManager()

      const startPromise1 = manager.start({
        engine: 'claude',
        prompt: 'task 1',
        cwd: '/tmp',
      })
      const startPromise2 = manager.start({
        engine: 'claude',
        prompt: 'task 2',
        cwd: '/tmp',
      })

      setTimeout(() => {
        expect(manager.listSessions()).toHaveLength(2)
        manager.cancelAll()
        mockProc1.emit('close', null)
        mockProc2.emit('close', null)
      }, 10)

      await vi.runAllTimersAsync()
      await Promise.all([startPromise1, startPromise2])

      expect(mockProc1.kill).toHaveBeenCalledWith('SIGTERM')
      expect(mockProc2.kill).toHaveBeenCalledWith('SIGTERM')
      expect(manager.listSessions()).toHaveLength(0)
    })

    it('clears the queue so queued tasks never run', async () => {
      const procs = Array.from({ length: 4 }, () => createMockProcess())
      procs.forEach((p) => spawnMock.mockReturnValueOnce(p))

      const AgentStreamManager = await importManager()
      const manager = new AgentStreamManager({ maxConcurrency: 3 })

      const p1 = manager.start({ engine: 'claude', prompt: '1', cwd: '/tmp' })
      const p2 = manager.start({ engine: 'claude', prompt: '2', cwd: '/tmp' })
      const p3 = manager.start({ engine: 'claude', prompt: '3', cwd: '/tmp' })
      const p4 = manager.start({ engine: 'claude', prompt: '4', cwd: '/tmp' })
      const p4Rejection = expect(p4).rejects.toThrow('cancelled before start')

      await vi.advanceTimersByTimeAsync(0)

      setTimeout(() => {
        expect(manager.listSessions()).toHaveLength(3)
        manager.cancelAll()
        procs[0].emit('close', null)
        procs[1].emit('close', null)
        procs[2].emit('close', null)
      }, 10)

      await vi.runAllTimersAsync()
      await Promise.all([p1, p2, p3])
      await p4Rejection

      expect(manager.listSessions()).toHaveLength(0)
      const cliSpawns = spawnMock.mock.calls.filter(([command]) => command !== 'taskkill')
      expect(cliSpawns).toHaveLength(3)
    })
  })

  // -------------------------------------------------------
  // 5. listSessions() returns active sessions
  // -------------------------------------------------------
  describe('listSessions()', () => {
    it('returns empty array when no sessions exist', async () => {
      const AgentStreamManager = await importManager()
      const manager = new AgentStreamManager()
      expect(manager.listSessions()).toEqual([])
    })

    it('returns active sessions and removes them after close', async () => {
      const AgentStreamManager = await importManager()
      const manager = new AgentStreamManager()

      const mockProc = createMockProcess()
      spawnMock.mockReturnValue(mockProc)
      const startPromise = manager.start({
        engine: 'claude',
        prompt: 'test',
        cwd: '/tmp',
      })

      setTimeout(() => {
        const sessions = manager.listSessions()
        expect(sessions).toHaveLength(1)
        expect(sessions[0].engine).toBe('claude')
        expect(sessions[0].status).toBe('running')
        mockProc.emit('close', 0)
      }, 10)

      await vi.runAllTimersAsync()
      await startPromise

      expect(manager.listSessions()).toHaveLength(0)
    })
  })

  // -------------------------------------------------------
  // 6. resolveCLIPath failure throws error
  // -------------------------------------------------------
  describe('resolveCLIPath failure', () => {
    it('rejects when CLI path is null', async () => {
      resolveCLIPathMock.mockResolvedValue(null)

      const AgentStreamManager = await importManager()
      const manager = new AgentStreamManager()

      await expect(
        manager.start({ engine: 'claude', prompt: 'test', cwd: '/tmp' }),
      ).rejects.toThrow('CLI not found for engine: claude')
    })

    it('rejects when CLI path is empty string', async () => {
      resolveCLIPathMock.mockResolvedValue('')

      const AgentStreamManager = await importManager()
      const manager = new AgentStreamManager()

      await expect(
        manager.start({ engine: 'codex', prompt: 'test', cwd: '/tmp' }),
      ).rejects.toThrow('CLI not found for engine: codex')
    })
  })

  // -------------------------------------------------------
  // 7. Concurrency queue
  // -------------------------------------------------------
  describe('concurrency queue', () => {
    it('queues the 4th task when maxConcurrency=3', async () => {
      const procs = Array.from({ length: 4 }, () => createMockProcess())
      procs.forEach((p) => spawnMock.mockReturnValueOnce(p))

      const AgentStreamManager = await importManager()
      const manager = new AgentStreamManager({ maxConcurrency: 3 })

      const results: string[] = []
      const promises = [
        manager.start({ engine: 'claude', prompt: '1', cwd: '/tmp' }).then((id) => {
          results.push(id)
          return id
        }),
        manager.start({ engine: 'claude', prompt: '2', cwd: '/tmp' }).then((id) => {
          results.push(id)
          return id
        }),
        manager.start({ engine: 'claude', prompt: '3', cwd: '/tmp' }).then((id) => {
          results.push(id)
          return id
        }),
        manager.start({ engine: 'claude', prompt: '4', cwd: '/tmp' }).then((id) => {
          results.push(id)
          return id
        }),
      ]

      await vi.advanceTimersByTimeAsync(0)
      expect(spawnMock).toHaveBeenCalledTimes(3)
      expect(manager.listSessions()).toHaveLength(3)

      setTimeout(() => {
        procs[0].emit('close', 0)
        procs[1].emit('close', 0)
        procs[2].emit('close', 0)
      }, 10)

      await vi.advanceTimersByTimeAsync(20)

      expect(spawnMock).toHaveBeenCalledTimes(4)

      setTimeout(() => {
        procs[3].emit('close', 0)
      }, 10)

      await vi.runAllTimersAsync()
      await Promise.all(promises)

      expect(results).toHaveLength(4)
      expect(manager.listSessions()).toHaveLength(0)
    })

    it('queue drains sequentially as slots free up', async () => {
      const procs = Array.from({ length: 5 }, () => createMockProcess())
      procs.forEach((p) => spawnMock.mockReturnValueOnce(p))

      const AgentStreamManager = await importManager()
      const manager = new AgentStreamManager({ maxConcurrency: 2 })

      const promises = Array.from({ length: 5 }, (_, i) =>
        manager.start({ engine: 'claude', prompt: `${i}`, cwd: '/tmp' }),
      )

      await vi.advanceTimersByTimeAsync(0)
      expect(spawnMock).toHaveBeenCalledTimes(2)
      expect(manager.listSessions()).toHaveLength(2)

      setTimeout(() => procs[0].emit('close', 0), 10)
      await vi.advanceTimersByTimeAsync(20)
      expect(spawnMock).toHaveBeenCalledTimes(3)

      setTimeout(() => procs[1].emit('close', 0), 10)
      await vi.advanceTimersByTimeAsync(20)
      expect(spawnMock).toHaveBeenCalledTimes(4)

      setTimeout(() => procs[2].emit('close', 0), 10)
      await vi.advanceTimersByTimeAsync(20)
      expect(spawnMock).toHaveBeenCalledTimes(5)

      setTimeout(() => {
        procs[3].emit('close', 0)
        procs[4].emit('close', 0)
      }, 10)

      await vi.runAllTimersAsync()
      await Promise.all(promises)

      expect(manager.listSessions()).toHaveLength(0)
    })
  })

  // -------------------------------------------------------
  // Additional: getSession()
  // -------------------------------------------------------
  describe('getSession()', () => {
    it('blocks a launch still resolving its CLI when shutdown begins', async () => {
      const AgentStreamManager = await importManager(), manager = new AgentStreamManager()
      let resolve!: (value: string) => void
      resolveCLIPathMock.mockReturnValueOnce(new Promise<string>(yes => { resolve = yes }))
      const launch = manager.startWithId('late', { engine: 'claude', prompt: 'test', cwd: '/tmp' })
      const rejected = expect(launch).rejects.toThrow('cancelled before spawn')
      await manager.killAll(); resolve('/usr/bin/claude'); await rejected
      expect(spawnMock).not.toHaveBeenCalled()
    })

    it('waits for native confirmation after cancelling active streams', async () => {
      const AgentStreamManager = await importManager(), manager = new AgentStreamManager(), proc = createMockProcess()
      const { stopProcessTree } = await import('../../../src/main/shutdown/process-tree')
      let confirm!: () => void
      vi.mocked(stopProcessTree).mockImplementationOnce(() => new Promise<void>(resolve => { confirm = resolve }))
      spawnMock.mockReturnValue(proc)
      await manager.start({ engine: 'claude', prompt: 'test', cwd: '/tmp' })
      let stopped = false
      const flight = manager.killAll().then(() => { stopped = true })
      await Promise.resolve(); expect(stopped).toBe(false)
      expect(proc.kill).not.toHaveBeenCalled()
      confirm(); await flight; expect(stopped).toBe(true)
    })
    it('returns undefined for non-existent and the session while running', async () => {
      const AgentStreamManager = await importManager()
      const manager = new AgentStreamManager()
      expect(manager.getSession('nope')).toBeUndefined()

      const mockProc = createMockProcess()
      spawnMock.mockReturnValue(mockProc)
      const startPromise = manager.start({
        engine: 'claude',
        prompt: 'test',
        cwd: '/tmp',
      })

      setTimeout(() => {
        const sessions = manager.listSessions()
        const session = manager.getSession(sessions[0].id)
        expect(session).toBeDefined()
        expect(session!.engine).toBe('claude')
        expect(session!.status).toBe('running')
        mockProc.emit('close', 0)
      }, 10)

      await vi.runAllTimersAsync()
      await startPromise
    })
  })

  // -------------------------------------------------------
  // Additional: stderr capture
  // -------------------------------------------------------
  describe('stderr handling', () => {
    it('does not crash when stderr emits data', async () => {
      const AgentStreamManager = await importManager()
      const manager = new AgentStreamManager()

      await startAndClose(manager, { engine: 'claude', prompt: 'test', cwd: '/tmp' }, (_mgr, mockProc) => {
        mockProc.stderr.emit('data', Buffer.from('some warning\n'))
        mockProc.stderr.emit('data', Buffer.from('another warning\n'))
      })

      expect(manager.listSessions()).toHaveLength(0)
    })
  })

  // -------------------------------------------------------
  // Additional: malformed stdout lines are skipped
  // -------------------------------------------------------
  describe('malformed stdout', () => {
    it('skips non-JSON lines without crashing', async () => {
      const AgentStreamManager = await importManager()
      const manager = new AgentStreamManager()
      const receivedEvents: any[] = []

      await startAndClose(manager, { engine: 'claude', prompt: 'test', cwd: '/tmp' }, (mgr, mockProc) => {
        const sessions = mgr.listSessions()
        if (sessions.length > 0) {
          mgr.onEvent(sessions[0].id, (event) => {
            receivedEvents.push(event)
          })
        }
        mockProc.stdout.emit('data', Buffer.from('not json at all\n'))
        mockProc.stdout.emit('data', Buffer.from('{"valid":true}\n'))
        mockProc.stdout.emit('data', Buffer.from('   \n'))
        mockProc.stdout.emit('data', Buffer.from('{"also_valid":true}\n'))
      })

      const textChunks = receivedEvents.filter((e) => e.type === 'text-chunk')
      expect(textChunks).toHaveLength(2)
      expect(receivedEvents.some((e) => e.type === 'done')).toBe(true)
    })
  })
})
