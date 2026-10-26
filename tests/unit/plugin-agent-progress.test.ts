import { afterEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { NativeAgentProgressStream } from '../../src/main/plugins/native-agent-progress'
import { nativeAgentProgressSchema, type NativeAgentProgress } from '../../packages/plugin-sdk/src/native-agent'

afterEach(() => vi.useRealTimers())

it('redacts credentials split across deltas and sends only public text and allowed tool names', async () => {
  vi.useFakeTimers()
  const sent: NativeAgentProgress[] = []
  const stream = new NativeAgentProgressStream(randomUUID(), 'private-api-key', ['note.read'], async value => { sent.push(value) })
  stream.push({ type: 'text_delta', delta: 'Answer private-api-' })
  await vi.advanceTimersByTimeAsync(250)
  expect(sent[0].text).toBe('Answer ')
  stream.push({ type: 'text_delta', delta: 'key. Continue.' })
  stream.push({ type: 'reasoning_delta', delta: 'Hidden reasoning' })
  stream.push({ type: 'tool_execution_start', call: { name: 'undeclared' } })
  await vi.advanceTimersByTimeAsync(250)
  expect(sent[1].text).toBe('Answer [redacted]. Continue.')
  expect(sent[1].tool).toBeUndefined()
  stream.push({ type: 'tool_execution_start', call: { name: 'note.read' } })
  await vi.advanceTimersByTimeAsync(250)
  expect(sent[2]).toMatchObject({ phase: 'tool', tool: 'note.read' })
  await stream.finish('Final answer')
  expect(sent.at(-1)).toMatchObject({ text: 'Final answer', phase: 'answer' })
  expect(sent.every(event => nativeAgentProgressSchema.safeParse(event).success)).toBe(true)
  expect(JSON.stringify(sent)).not.toContain('private-api')
  expect(JSON.stringify(sent)).not.toContain('Hidden reasoning')
})

it('coalesces slow consumers, bounds payloads and stops all late delivery after cancellation', async () => {
  vi.useFakeTimers()
  let release: () => void = () => {}
  const send = vi.fn(async () => new Promise<void>(resolve => { release = resolve }))
  const stream = new NativeAgentProgressStream(randomUUID(), undefined, [], send)
  stream.push({ type: 'text_delta', delta: 'start' })
  await vi.advanceTimersByTimeAsync(250)
  for (let index = 0; index < 100; index++) stream.push({ type: 'text_delta', delta: 'x'.repeat(10_000) })
  await vi.advanceTimersByTimeAsync(2000)
  expect(send).toHaveBeenCalledTimes(1)
  release()
  await vi.advanceTimersByTimeAsync(250)
  expect(send).toHaveBeenCalledTimes(2)
  const event = (send.mock.calls as unknown as Array<[NativeAgentProgress]>)[1][0]
  expect(event.text).toHaveLength(300_000)
  stream.close(); release()
  stream.push({ type: 'text_delta', delta: 'late' })
  await vi.advanceTimersByTimeAsync(2000)
  expect(send).toHaveBeenCalledTimes(2)
})
