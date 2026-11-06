import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodexConversation } from '../../src/main/terminal/codex-conversation'
import { CodexManagedRpcError, CodexManagedTransport } from '../../src/main/terminal/codex-managed-transport'

afterEach(() => vi.restoreAllMocks())
function fixture(error: Error, recover = vi.fn(async () => {})) {
  vi.spyOn(CodexManagedTransport.prototype, 'start').mockResolvedValue(undefined)
  vi.spyOn(CodexManagedTransport.prototype, 'stop').mockResolvedValue(undefined)
  const call = vi.spyOn(CodexManagedTransport.prototype, 'call').mockImplementation(async method => {
    if (method === 'config/read') return { config: {} }
    if (method === 'environment/status') return { status: 'ready' }
    if (method === 'account/read') return { requiresOpenaiAuth: false }
    if (method === 'thread/resume') throw error
    if (method === 'thread/start') return { thread: { id: 'rebuilt-thread', turns: [] } }
    throw new Error('Unexpected request: ' + method)
  })
  const engine = new CodexConversation('recovery-fixture', () => {})
  const start = () => engine.startManaged({ command: 'fixture.exe', args: [], cwd: process.cwd(), env: {}, threadId: 'old-thread',
    configure: async () => ({ permissions: 'unchanged-profile' }), onMissingThread: recover })
  return { call, engine, start, recover }
}
describe('native missing-history boundary', () => {
  it('rebuilds once only after native absence and host reconstruction checks, preserving the exact permission params', async () => {
    const f = fixture(new CodexManagedRpcError(-32600, 'no rollout found for thread id old-thread'))
    await f.start()
    expect(f.recover).toHaveBeenCalledTimes(1)
    expect(f.engine.snapshot().threadId).toBe('rebuilt-thread')
    expect(f.call.mock.calls.filter(([method]) => method === 'thread/start')).toEqual([['thread/start', { permissions: 'unchanged-profile', cwd: process.cwd() }]])
    expect(f.call.mock.calls.some(([method]) => method === 'turn/start')).toBe(false)
    await f.engine.dispose()
  })
  it.each([
    new Error('thread/resume timed out; delivery is unknown'),
    new CodexManagedRpcError(-32600, 'model provider mismatch', { type: 'modelProviderMismatch' }),
    new CodexManagedRpcError(-32600, 'no rollout found for thread id another-thread'),
    new CodexManagedRpcError(-32603, 'failed to read saved thread'),
  ])('does not reinterpret an unconfirmed or unrelated native error as absence: %s', async error => {
    const f = fixture(error)
    await expect(f.start()).rejects.toThrow(error.message)
    expect(f.recover).not.toHaveBeenCalled()
    expect(f.call.mock.calls.some(([method]) => method === 'thread/start')).toBe(false)
    await f.engine.dispose()
  })
  it('does not create a new thread when critical original reconstruction fails', async () => {
    const f = fixture(new CodexManagedRpcError(-32600, 'no rollout found for thread id old-thread'), vi.fn(async () => { throw new Error('Critical original missing') }))
    await expect(f.start()).rejects.toThrow('Critical original missing')
    expect(f.call.mock.calls.some(([method]) => method === 'thread/start')).toBe(false)
    await f.engine.dispose()
  })
})
