import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeTerminal } from '../../src/shared/workspace-runtime'

const request = vi.hoisted(() => vi.fn())
vi.mock('../../src/main/workspace/runtime', () => ({ runtimeRequest: request, resolveRuntimeResource: vi.fn() }))
vi.mock('node-pty', () => ({ spawn: vi.fn() }))
vi.mock('../../src/main/terminal/diagnostics', () => ({ logTerminalDiagnostic: vi.fn() }))
import { RemotePty } from '../../src/main/terminal/remote-pty'
import { TerminalManager } from '../../src/main/terminal/manager'

const terminal: RuntimeTerminal = { id: 't', workspaceId: 'w', cwd: '/project', argv: ['/bin/sh'], pid: 42, cols: 80, rows: 24, exitCode: null, sequence: 0, createdAt: new Date().toISOString() }
const runtime = { kind: 'wsl' as const, distro: 'test', root: '/project' }

describe('remote terminal lifetime', () => {
  beforeEach(() => { vi.useFakeTimers(); request.mockReset() })
  afterEach(() => { vi.useRealTimers() })

  it('reconnects after a lost transport without recreating the process and preserves split UTF-8', async () => {
    const bytes = Buffer.from('你好')
    request.mockResolvedValueOnce({ ...terminal, sequence: 1, data: bytes.subarray(0, 2).toString('base64') })
      .mockRejectedValueOnce(new Error('transport lost'))
      .mockResolvedValueOnce({ ...terminal, sequence: 2, data: bytes.subarray(2).toString('base64'), exitCode: 0 })
    const status = vi.fn(), data = vi.fn(), exit = vi.fn()
    const pty = new RemotePty(runtime, terminal, status)
    pty.onData(data); pty.onExit(exit); pty.start()
    await vi.advanceTimersByTimeAsync(2200)
    expect(data.mock.calls.flat().join('')).toBe('你好')
    expect(request.mock.calls.map(call => call[1])).toEqual(['terminal.poll', 'terminal.poll', 'terminal.poll'])
    expect(request.mock.calls[2][2].after).toBe(1)
    expect(status).toHaveBeenLastCalledWith(null)
    expect(exit).toHaveBeenCalledWith({ exitCode: 0 })
  })

  it('detaching suppresses late replies and never ends a remote process', async () => {
    let reply!: (value: unknown) => void
    request.mockImplementation(() => new Promise(resolve => { reply = resolve }))
    const pty = new RemotePty(runtime, terminal, vi.fn()), data = vi.fn()
    pty.onData(data); pty.start(); pty.detach()
    reply({ ...terminal, sequence: 1, data: Buffer.from('late').toString('base64') })
    await vi.advanceTimersByTimeAsync(5000)
    expect(data).not.toHaveBeenCalled()
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][1]).toBe('terminal.poll')
  })

  it('shutdown only detaches; explicit end waits for confirmation and failed end stays attached', async () => {
    const manager = new TerminalManager()
    const remote = { detach: vi.fn(), end: vi.fn(async () => {}) }
    const kill = vi.fn()
    const instance = { id: 't', pty: { pid: 42, kill, write: vi.fn(), resize: vi.fn(), onData: vi.fn(), onExit: vi.fn() }, remote,
      config: { id: 't', workspaceId: 'w', cwd: 'janusx-workspace://w/project', shell: '/bin/sh' }, status: 'running' as const, createdAt: 0, outputBuffer: '', outputSeq: 0 }
    manager.adopt(instance)
    await manager.killAll()
    expect(remote.detach).toHaveBeenCalledOnce()
    expect(remote.end).not.toHaveBeenCalled()
    expect(kill).not.toHaveBeenCalled()
    manager.adopt(instance)
    remote.end.mockRejectedValueOnce(new Error('offline'))
    await expect(manager.endRemote('t')).rejects.toThrow('offline')
    expect(manager.getInstance('t')).toBe(instance)
    await manager.endRemote('t')
    expect(manager.getInstance('t')).toBeUndefined()
    expect(kill).not.toHaveBeenCalled()
  })
})
