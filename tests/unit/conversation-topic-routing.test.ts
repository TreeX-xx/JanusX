import { beforeEach, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>(), generate: vi.fn(), model: { id: 'model' } }))
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => fixture.handlers.set(name, handler) } }))
vi.mock('../../src/main/janus/chat-store', () => ({ janusChatStore: { load: vi.fn(), save: vi.fn() } }))
vi.mock('../../src/main/llm/LlmService', () => ({ llmService: {
  getDefaultModel: async () => ({ provider: { id: 'default' }, modelId: 'default-model' }),
  getLanguageModel: async () => fixture.model,
} }))
vi.mock('../../src/main/llm/ai-runtime', () => ({ generateText: fixture.generate }))
import { registerJanusChatHandlers } from '../../src/main/ipc/janus-chat-handlers'
import { JANUS_CHAT_CHANNELS } from '../../src/shared/ipc/janus-chat'

beforeEach(() => { fixture.generate.mockReset(); registerJanusChatHandlers() })
const route = (request: unknown) => fixture.handlers.get(JANUS_CHAT_CHANNELS.routeTopic)!({}, request)
const input = { text: 'Continue the earlier analysis', context: [{ role: 'assistant', content: 'Frozen context' }],
  candidates: [{ id: 'one', title: 'Analysis', messages: [{ role: 'user', content: 'Analyze the interface' }] }] }

it('rejects an idle routing request before calling the model', async () => {
  await expect(route({ ...input, candidates: [] })).rejects.toThrow('Invalid topic routing request')
  expect(fixture.generate).not.toHaveBeenCalled()
})

it('distinguishes an independent parallel input from a request waiting for multiple results', async () => {
  fixture.generate.mockResolvedValueOnce({ text: '{"kind":"new"}' })
  expect(await route(input)).toEqual({ kind: 'new' })
  expect(fixture.generate.mock.calls[0][0].system).toContain('while an earlier analysis is still unfinished')
  expect(fixture.generate.mock.calls[0][0].system).toContain('Do not require an explicit request to run in parallel')
  fixture.generate.mockResolvedValue({ text: '{"kind":"wait"}' })
  await expect(route(input)).rejects.toThrow('未返回有效结果')
  expect(await route({ ...input, candidates: [...input.candidates, { ...input.candidates[0], id: 'two' }] })).toEqual({ kind: 'wait' })
  fixture.generate.mockResolvedValue({ text: '{"kind":"parallel","branches":[]}' })
  await expect(route(input)).rejects.toThrow('未返回有效结果')
})

it('uses a bounded tool-free model call with shared context and validates its target', async () => {
  fixture.generate.mockResolvedValue({ text: '{"kind":"continue","targetId":"one"}' })
  expect(await route(input)).toEqual({ kind: 'continue', targetId: 'one' })
  const call = fixture.generate.mock.calls[0][0]
  expect(call.tools).toBeUndefined()
  expect(call.abortSignal).toBeInstanceOf(AbortSignal)
  expect(call.maxTokens).toBe(2048)
  expect(call.maxRetries).toBe(0)
  expect(JSON.parse(call.prompt).context).toEqual(input.context)
  fixture.generate.mockResolvedValue({ text: '{"kind":"continue","targetId":"unrelated-workspace"}' })
  await expect(route(input)).rejects.toThrow('未返回有效结果')
})

it('distinguishes incomplete model output from an explicit ambiguous decision', async () => {
  fixture.generate.mockResolvedValueOnce({ text: '', finishReason: 'length' })
  await expect(route(input)).rejects.toThrow('输出上限')
  fixture.generate.mockResolvedValueOnce({ text: 'not JSON', finishReason: 'stop' })
  await expect(route(input)).rejects.toThrow('未返回有效结果')
  fixture.generate.mockResolvedValueOnce({ text: '{"kind":"choice"}', finishReason: 'stop' })
  expect(await route(input)).toEqual({ kind: 'choice' })
})

it('retains the conclusion of long replies and instructs the model to resolve conversational follow-ups', async () => {
  fixture.generate.mockResolvedValue({ text: '{"kind":"continue","targetId":"one"}' })
  await route({ ...input, text: '按这个方案做', candidates: [{ ...input.candidates[0],
    messages: [{ role: 'assistant', content: 'START\n' + 'background '.repeat(1000) + '\nFINAL AGREED PLAN' }] }] })
  const call = fixture.generate.mock.calls[0][0]
  const excerpt = JSON.parse(call.prompt).candidates[0].messages[0].content
  expect(excerpt).toContain('START')
  expect(excerpt).toContain('FINAL AGREED PLAN')
  expect(excerpt.length).toBeLessThan(2500)
  expect(call.system).toContain('With one candidate')
})

it('propagates model failure for a visible retained input instead of assuming a new topic', async () => {
  fixture.generate.mockRejectedValue(new Error('Router unavailable'))
  await expect(route(input)).rejects.toThrow('Router unavailable')
  await expect(route({ ...input, candidates: 'untrusted' })).rejects.toThrow('Invalid topic routing request')
  expect(fixture.generate).toHaveBeenCalledOnce()
})
