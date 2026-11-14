import { afterEach, expect, it, vi } from 'vitest'
import { chatStream, steerChat } from '../../src/renderer/src/services/llm'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
it('reports an unknown steering outcome without resending when acknowledgement is lost', async () => {
  vi.useFakeTimers()
  const submit = vi.fn(() => new Promise(() => {}))
  vi.stubGlobal('window', { electron: { llm: { steerChat: submit } } })
  const result = expect(steerChat({ conversationId: 'c', expectedRequestId: 'r', entryId: 'e', text: 'Correction' })).rejects.toThrow('could not be confirmed')
  await vi.advanceTimersByTimeAsync(15_000); await result
  expect(submit).toHaveBeenCalledTimes(1)
})
it('cancels the host turn on idle timeout and ignores late dispatch events', async () => {
  vi.useFakeTimers()
  const callbacks: Record<string, (value: any) => void> = {}
  const detached = vi.fn(), abortChat = vi.fn(async () => {}), startChatStream = vi.fn()
  const llm: Record<string, unknown> = { abortChat, startChatStream }
  for (const name of ['onDelta', 'onDone', 'onError', 'onAgentEvent', 'onRecallTrace', 'onToolTrace']) {
    llm[name] = (callback: (value: any) => void) => { callbacks[name] = callback; return detached }
  }
  vi.stubGlobal('window', { electron: { llm } })
  const failed = vi.fn(), done = vi.fn()
  const stream = chatStream([{ role: 'user', content: 'Fix this' }], vi.fn(), done, failed, { providerId: 'fixture' })
  expect(await stream.started).toBe(true)
  await Promise.resolve()
  const requestId = startChatStream.mock.calls[0][0].requestId
  expect(stream.requestId).toBe(requestId)
  await vi.advanceTimersByTimeAsync(300_000)
  expect(abortChat).toHaveBeenCalledExactlyOnceWith(requestId)
  expect(detached).toHaveBeenCalledTimes(6)
  expect(failed).toHaveBeenCalledOnce()
  callbacks.onAgentEvent({ requestId, type: 'stream_end' })
  callbacks.onDone({ requestId })
  expect(done).not.toHaveBeenCalled()
})

it('settles startup on cancellation without dispatching a late model request', async () => {
  const startChatStream = vi.fn(), llm: Record<string, unknown> = { startChatStream, abortChat: vi.fn(async () => {}) }
  for (const name of ['onDelta', 'onDone', 'onError', 'onAgentEvent', 'onRecallTrace', 'onToolTrace']) llm[name] = () => () => {}
  vi.stubGlobal('window', { electron: { llm } })
  const stream = chatStream([{ role: 'user', content: 'Start' }], vi.fn(), vi.fn(), vi.fn(), { providerId: 'fixture' })
  stream.abort()
  expect(await stream.started).toBe(false)
  expect(startChatStream).not.toHaveBeenCalled()
})
