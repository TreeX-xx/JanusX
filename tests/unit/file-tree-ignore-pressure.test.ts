import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProcessOutcome } from '../../src/main/platform/process-host'

const mocks = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('../../src/main/platform/process-host', () => ({ runProcess: mocks.run }))

// Process ownership, timeout escalation and exit confirmation are covered by platform-process-host.test.ts.
// This consumer owns batching, concurrency and failure handling.
describe('file tree git process pressure', () => {
  beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); mocks.run.mockReset() })
  afterEach(() => { vi.useRealTimers() })

  function pendingRun() {
    let finish!: (result: Partial<ProcessOutcome>) => void
    const promise = new Promise<Partial<ProcessOutcome>>(resolve => { finish = resolve })
    mocks.run.mockReturnValueOnce(promise)
    return finish
  }

  it('batches 100 directories for a workspace into one git invocation', async () => {
    const finish = pendingRun()
    const { getGitIgnoredPaths } = await import('../../src/main/ipc/file-tree-ignore')
    const pending = Array.from({ length: 100 }, (_, i) => getGitIgnoredPaths('root', ['dir' + i + '/file']))
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.run).toHaveBeenCalledTimes(1)
    expect(mocks.run.mock.calls[0][2].input.split('\0').filter(Boolean)).toHaveLength(100)
    finish({ status: 'exited', exitCode: 0, stdout: 'dir3/file\0' })
    const results = await Promise.all(pending)
    expect(results[3].has('dir3/file')).toBe(true)
  })

  it('limits independent workspaces to two active git checks', async () => {
    const finishes = Array.from({ length: 5 }, pendingRun)
    const { getGitIgnoredPaths } = await import('../../src/main/ipc/file-tree-ignore')
    const pending = finishes.map((_, i) => getGitIgnoredPaths('root' + i, ['file']))
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.run).toHaveBeenCalledTimes(2)
    finishes[0]({ status: 'exited', exitCode: 1, stdout: '' })
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.run).toHaveBeenCalledTimes(3)
    finishes[1]({ status: 'exited', exitCode: 1, stdout: '' })
    finishes[2]({ status: 'exited', exitCode: 1, stdout: '' })
    await vi.advanceTimersByTimeAsync(0)
    finishes[3]({ status: 'exited', exitCode: 1, stdout: '' })
    finishes[4]({ status: 'exited', exitCode: 1, stdout: '' })
    await Promise.all(pending)
  })

  it.each(['timed-out', 'exit-unconfirmed', 'spawn-error'] as const)('delegates bounded execution and ignores partial output after %s', async status => {
    mocks.run.mockResolvedValue({ status, stdout: 'file\0' })
    const { getGitIgnoredPaths } = await import('../../src/main/ipc/file-tree-ignore')
    const pending = getGitIgnoredPaths('root', ['file'])
    await vi.advanceTimersByTimeAsync(0)
    expect(await pending).toEqual(new Set())
    expect(mocks.run).toHaveBeenCalledWith('git', ['check-ignore', '--no-index', '--stdin', '-z'],
      expect.objectContaining({ cwd: 'root', input: 'file\0', timeoutMs: 3000 }))
  })
})
