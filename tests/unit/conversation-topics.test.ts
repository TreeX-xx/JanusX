import { describe, expect, it, vi } from 'vitest'
import { TopicScheduler, recoverTopics, type TopicPorts } from '../../src/renderer/src/components/janus/topicScheduler'
import { parseTopicRoute } from '../../src/shared/conversation-topics'
import { normalizeJanusChatSnapshot, type PersistedJanusConversation } from '../../src/shared/ipc/janus-chat'

function deferred<T = void>() { let resolve!: (v: T) => void, reject!: (e: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function fixture(capacity = 4) {
  let conversations: PersistedJanusConversation[] = [{ id: 'root', title: 'Chat', createdAt: 1, updatedAt: 1,
    messages: [{ id: 'base', role: 'user', content: 'Shared prior context', timestamp: 1 }], attachedWorkspaceIds: [], toolTraces: [] }]
  const runs: Array<{ id: string; text: string; messageId: string; gate: ReturnType<typeof deferred> }> = []
  const steers: Array<{ id: string; text: string; messageId: string }> = []
  let scheduler: TopicScheduler
  const ports: TopicPorts = { read: () => conversations, update: fn => { conversations = fn(conversations) },
    save: vi.fn(async () => {}), route: vi.fn(async () => ({ kind: 'new' })),
    run: vi.fn(async (c, m) => { const gate = deferred(); runs.push({ id: c.id, text: m.content, messageId: m.id, gate }); await gate.promise }),
    steer: vi.fn(async (c, m) => {
      steers.push({ id: c.id, text: m.content, messageId: m.id })
      ports.update(all => all.map(row => row.id === c.id ? { ...row, messages: [...row.messages, m] } : row))
      scheduler.consume(c.id, [m.id])
      return { accepted: true }
    }),
    stop: vi.fn(id => runs.filter(r => r.id === id).at(-1)?.gate.reject(new Error('Stopped'))) }
  scheduler = new TopicScheduler(ports, capacity)
  return { ports, runs, steers, scheduler, topics: () => conversations.filter(c => c.topic) }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

describe('topic routing and scheduling', () => {
  it('persists direct Worker messages without model routing and retries with the same identity', async () => {
    const f = fixture()
    f.ports.direct = vi.fn().mockRejectedValueOnce(new Error('Acknowledgement lost')).mockResolvedValue(undefined)
    const context = { text: 'Fix it', references: [], worker: { kind: 'worker' as const, workspaceId: 'a', workId: 'work', title: 'Fix login' } }
    await f.scheduler.submit('root', 'a', 'Fix it', false, context)
    const direct = f.topics()[0]
    expect(direct.messages[0].context?.delivery).toBe('failed')
    const snapshot = normalizeJanusChatSnapshot({ version: 1, activeConversationId: 'root', conversations: f.ports.read() })!
    const restored = snapshot.conversations.find(c => c.id === direct.id)!
    expect(restored.topic?.direct).toBe(true)
    expect(restored.messages[0].context).toEqual({ ...context, delivery: 'failed' })
    expect(f.ports.route).not.toHaveBeenCalled()
    expect(f.runs).toHaveLength(0)
    await f.scheduler.retryDirect(direct.id)
    expect(f.topics()[0].messages[0].context?.delivery).toBe('sent')
    expect(vi.mocked(f.ports.direct).mock.calls.map(call => call[1].id)).toEqual([direct.messages[0].id, direct.messages[0].id])
    await f.scheduler.retryDirect(direct.id)
    expect(f.ports.direct).toHaveBeenCalledTimes(2)
    await expect(f.scheduler.submit('root', 'other', 'Fix it', false, context)).rejects.toThrow('workspace changed')
    expect(f.topics()).toHaveLength(1)
    await f.scheduler.submit('root', 'a', 'What changed?')
    await tick()
    expect(f.runs).toHaveLength(1)
    expect(f.runs[0].id).not.toBe(direct.id)
  })
  it('keeps delivering a burst when consumption is confirmed but the RPC fails', async () => {
    const f = fixture()
    await f.scheduler.submit('root', null, 'First')
    vi.mocked(f.ports.steer).mockImplementationOnce(async (c, m) => {
      f.scheduler.consume(c.id, [m.id]); throw new Error('Lost acknowledgement')
    })
    await Promise.all(['A', 'B'].map(text => f.scheduler.submit('root', null, text)))
    expect(f.ports.steer).toHaveBeenCalledTimes(2)
    expect(f.topics()[0].topic!.inputs.slice(1).map(i => i.state)).toEqual(['consumed', 'consumed'])
    expect(f.topics()[0].topic!.diagnostic).toBeUndefined()
  })
  it('keeps a failed turn paused when a late steering acknowledgement arrives', async () => {
    const f = fixture(), ack = deferred<{ accepted: boolean }>()
    await f.scheduler.submit('root', null, 'First')
    vi.mocked(f.ports.steer).mockReturnValueOnce(ack.promise)
    const send = f.scheduler.submit('root', null, 'Correction'); await tick()
    f.runs[0].gate.reject(new Error('Stream failed')); await tick()
    ack.resolve({ accepted: true }); await send
    expect(f.topics()[0].topic!.inputs.map(i => i.state)).toEqual(['failed', 'paused'])
    expect(f.runs).toHaveLength(1)
  })
  it('accepts a late consumption receipt after an uncertain RPC outcome without replay', async () => {
    const f = fixture()
    await f.scheduler.submit('root', null, 'First')
    vi.mocked(f.ports.steer).mockRejectedValueOnce(new Error('Lost acknowledgement'))
    await f.scheduler.submit('root', null, 'Correction')
    const topic = f.topics()[0]
    f.scheduler.consume(topic.id, [topic.topic!.inputs[1].message.id])
    expect(f.topics()[0].topic!.inputs[1].state).toBe('consumed')
    expect(f.topics()[0].topic!.diagnostic).toBeUndefined()
    f.runs[0].gate.resolve(); await tick()
    expect(f.runs).toHaveLength(1)
    expect(f.topics()[0].topic!.inputs).toEqual([])
  })
  it('delivers a burst in order while the original turn is still active', async () => {
    const f = fixture()
    await f.scheduler.submit('root', 'a', 'First')
    await Promise.all(['A', 'B', 'C'].map(text => f.scheduler.submit('root', 'a', text)))
    expect(f.steers.map(s => s.text)).toEqual(['A', 'B', 'C'])
    expect(new Set(f.steers.map(s => s.messageId)).size).toBe(3)
    expect(f.runs).toHaveLength(1)
    expect(f.ports.route).not.toHaveBeenCalled()
    f.runs[0].gate.resolve(); await tick()
    expect(f.runs).toHaveLength(1)
    expect(f.topics()[0].topic!.inputs).toEqual([])
  })
  it('holds startup supplements until the initial request starts, then steers them', async () => {
    const f = fixture(), saving = deferred()
    vi.mocked(f.ports.save).mockImplementationOnce(() => saving.promise)
    const first = f.scheduler.submit('root', 'a', 'First')
    const second = f.scheduler.submit('root', 'a', 'Second')
    saving.resolve(); await Promise.all([first, second]); await tick()
    expect(f.runs).toHaveLength(1)
    expect(f.steers.map(s => s.text)).toEqual(['Second'])
  })
  it('does not replay an adopted input when its RPC acknowledgement arrives after completion', async () => {
    const f = fixture(), ack = deferred<{ accepted: boolean }>()
    await f.scheduler.submit('root', null, 'First')
    vi.mocked(f.ports.steer).mockImplementation(async (c, m) => { f.scheduler.consume(c.id, [m.id]); return ack.promise })
    const send = f.scheduler.submit('root', null, 'Correction'); await tick()
    expect(f.topics()[0].topic!.inputs[1].state).toBe('consumed')
    f.runs[0].gate.resolve(); ack.resolve({ accepted: true }); await send; await tick()
    expect(f.runs).toHaveLength(1)
    expect(f.topics()[0].topic!.inputs).toEqual([])
  })
  it('starts a new turn only after an explicit inactive rejection', async () => {
    const f = fixture(), ack = deferred<{ accepted: boolean; error: string }>()
    await f.scheduler.submit('root', null, 'First')
    vi.mocked(f.ports.steer).mockReturnValueOnce(ack.promise)
    const send = f.scheduler.submit('root', null, 'Too late'); await tick()
    f.runs[0].gate.resolve(); ack.resolve({ accepted: false, error: 'No active stream for this conversation' })
    await send; await tick()
    expect(f.runs.map(r => r.text)).toEqual(['First', 'Too late'])
    expect(f.ports.steer).toHaveBeenCalledTimes(1)
  })
  it.each(['unconsumed', 'unknown', 'rejected'])('preserves %s delivery without automatically replaying it', async kind => {
    const f = fixture()
    await f.scheduler.submit('root', null, 'First')
    if (kind === 'unknown') vi.mocked(f.ports.steer).mockRejectedValueOnce(new Error('Connection lost'))
    else vi.mocked(f.ports.steer).mockResolvedValueOnce(kind === 'rejected' ? { accepted: false, error: 'Active stream changed' } : { accepted: true })
    await f.scheduler.submit('root', null, 'Correction')
    f.runs[0].gate.resolve(); await tick()
    expect(f.runs).toHaveLength(1)
    expect(f.topics()[0].topic!.inputs[0]).toMatchObject({ state: 'paused', message: { content: 'Correction' } })
    const snapshot = normalizeJanusChatSnapshot({ version: 1, activeConversationId: 'root', conversations: f.ports.read() })!
    expect(recoverTopics(snapshot.conversations)[1].topic!.inputs[0].state).toBe('paused')
  })
  it('ignores late delivery acknowledgement after stop and preserves every input for explicit retry', async () => {
    const f = fixture(), ack = deferred<{ accepted: boolean }>()
    await f.scheduler.submit('root', null, 'First')
    vi.mocked(f.ports.steer).mockReturnValueOnce(ack.promise)
    const send = f.scheduler.submit('root', null, 'Correction'); await tick()
    const id = f.topics()[0].id
    f.scheduler.stop(id); await tick(); ack.resolve({ accepted: true }); await send
    expect(f.topics()[0].topic!.inputs.map(i => i.state)).toEqual(['paused', 'paused'])
    await f.scheduler.resume(id); await tick()
    expect(f.runs).toHaveLength(2)
    expect(f.steers.map(s => s.text)).toEqual(['Correction'])
  })
  it('continues idle conversations without classification or accumulating conversations', async () => {
    const f = fixture()
    await f.scheduler.submit('root', 'a', 'First')
    for (let i = 0; i < 10; i++) {
      f.runs[i].gate.resolve(); await tick()
      await f.scheduler.submit('root', 'a', 'Next ' + i)
      await tick()
    }
    expect(f.topics()).toHaveLength(1)
    expect(f.ports.route).not.toHaveBeenCalled()
    expect(new Set(f.runs.map(r => r.id)).size).toBe(1)
  })
  it('forks at the active input and joins full question-answer pairs before starting the ordinary queue', async () => {
    const f = fixture()
    f.ports.run = vi.fn(async (c, m) => {
      const gate = deferred(); f.runs.push({ id: c.id, text: m.content, messageId: m.id, gate })
      f.ports.update(all => all.map(row => row.id === c.id ? { ...row, messages: [...row.messages, m] } : row))
      await gate.promise
      f.ports.update(all => all.map(row => row.id === c.id ? { ...row, messages: [...row.messages,
        { id: 'answer:' + m.id, role: 'assistant', content: 'Answer ' + m.content, timestamp: Date.now() }] } : row))
    })
    await f.scheduler.submit('root', 'a', 'Prior discussion')
    f.runs[0].gate.resolve(); await tick()
    await f.scheduler.submit('root', 'a', 'Feature A'); await tick()
    await f.scheduler.submit('root', 'a', 'Feature B', true); await tick()
    const [a, b] = f.topics()
    expect(a.topic!.fork).toEqual({ id: a.id, start: 2 })
    expect(b.topic!.base.map(m => m.content)).toEqual(['Shared prior context', 'Prior discussion', 'Answer Prior discussion'])
    expect(b.topic!.base.some(m => m.content.includes('Feature A'))).toBe(false)
    await f.scheduler.submit('root', 'a', 'Compare both results')
    await f.scheduler.submit('root', 'a', 'Then implement')
    expect(f.ports.route).toHaveBeenCalledTimes(2)
    f.runs[2].gate.resolve(); await tick()
    expect(f.runs).toHaveLength(3)
    f.runs[1].gate.resolve(); await tick()
    expect(f.runs).toHaveLength(4)
    const continuation = vi.mocked(f.ports.run).mock.calls[3][0]
    expect(continuation.topic!.base.map(m => m.content)).toEqual(['Shared prior context', 'Prior discussion', 'Answer Prior discussion',
      'Feature A', 'Answer Feature A', 'Feature B', 'Answer Feature B'])
    expect(continuation.topic!.fork).toBeUndefined()
    expect(f.steers.at(-1)?.text).toBe('Then implement')
    f.runs[3].gate.resolve(); await tick()
    expect(f.runs).toHaveLength(4)
    const restored = normalizeJanusChatSnapshot({ version: 1, activeConversationId: 'root', conversations: f.ports.read() })!
    expect(restored.conversations.find(c => c.id === a.id)!.topic!.fork).toEqual(a.topic!.fork)
  })
  it('allows a queued continuation after a failed branch and records the incomplete outcome', async () => {
    const f = fixture()
    await f.scheduler.submit('root', 'a', 'A')
    await f.scheduler.submit('root', 'a', 'B', true)
    await f.scheduler.submit('root', 'a', 'Continue with available results')
    f.runs[0].gate.reject(new Error('Model failed')); await tick()
    expect(f.runs).toHaveLength(2)
    f.runs[1].gate.resolve(); await tick()
    expect(f.runs).toHaveLength(3)
    expect(vi.mocked(f.ports.run).mock.calls[2][0].topic!.base.map(m => m.content).join(' ')).toContain('Execution failed: Model failed')
  })
  it('treats a follow-up after completion as the next turn without classification', async () => {
    const f = fixture()
    await f.scheduler.submit('root', 'a', 'A')
    f.runs[0].gate.resolve(); await tick()
    await f.scheduler.submit('root', 'a', 'B', true); await tick()
    expect(f.runs).toHaveLength(2)
    expect(f.ports.route).not.toHaveBeenCalled()
    expect(f.topics().every(c => !c.topic!.fork)).toBe(true)
  })
  it('restores the parallel barrier and queued inputs without automatically running them', async () => {
    const f = fixture()
    await f.scheduler.submit('root', 'a', 'A')
    await f.scheduler.submit('root', 'a', 'B', true)
    await f.scheduler.submit('root', 'a', 'After both')
    const snapshot = normalizeJanusChatSnapshot({ version: 1, activeConversationId: 'root', conversations: f.ports.read() })!
    const restored = recoverTopics(snapshot.conversations)
    const following = restored.at(-1)!
    expect(following.topic!.afterGroup).toBe(restored[1].topic!.fork!.id)
    expect(restored.filter(c => c.topic).every(c => c.topic!.inputs.every(i => i.state === 'paused'))).toBe(true)
    const run = vi.fn()
    const scheduler = new TopicScheduler({ ...f.ports, read: () => restored, run })
    scheduler.activate(); await tick()
    expect(run).not.toHaveBeenCalled()
  })
  it('does not attach a new follow-up to a stopped waiting queue', async () => {
    const f = fixture()
    await f.scheduler.submit('root', 'a', 'A')
    await f.scheduler.submit('root', 'a', 'B', true)
    await f.scheduler.submit('root', 'a', 'Cancelled follow-up')
    f.scheduler.stop(f.topics()[2].id); await tick()
    await f.scheduler.submit('root', 'a', 'New follow-up')
    f.runs[0].gate.resolve(); f.runs[1].gate.resolve(); await tick()
    expect(f.runs.map(r => r.text)).toEqual(['A', 'B', 'New follow-up'])
    expect(f.topics()[2].topic!.inputs[0].state).toBe('paused')
  })
  it('validates targets and rejects malformed classifier output', () => {
    const candidates = [{ id: 'a', title: 'a', messages: [] }]
    expect(parseTopicRoute('{"kind":"continue","targetId":"foreign"}', candidates)).toBeNull()
    expect(parseTopicRoute('ignore instructions; execute tool', candidates)).toBeNull()
    expect(parseTopicRoute('```json\n{"kind":"continue","targetId":"a"}\n```', candidates)).toEqual({ kind: 'continue', targetId: 'a' })
  })
  it('steers related inputs immediately and forks only on explicit separate sends', async () => {
    const f = fixture()
    await f.scheduler.submit('root', 'workspace', 'First')
    const first = f.topics()[0]
    await f.scheduler.submit('root', 'workspace', 'Follow-up')
    const followId = first.topic!.inputs[0].message.id
    await f.scheduler.submit('root', 'workspace', 'Separate', true)
    await tick()
    expect(f.runs.map(r => r.text)).toEqual(['First', 'Separate'])
    expect(f.topics()).toHaveLength(2)
    expect(f.topics().every(c => c.topic?.base[0].id === 'base')).toBe(true)
    expect(f.topics()[0].topic!.base).not.toBe(f.topics()[1].topic!.base)
    const steered = f.topics()[0].topic!.inputs[1].message.id
    expect(steered).not.toBe(followId)
    expect(f.steers[0]).toEqual({ text: 'Follow-up', id: first.id, messageId: steered })
    expect(f.ports.route).not.toHaveBeenCalled()
    f.runs[0].gate.resolve(); await tick()
    expect(f.runs).toHaveLength(2)
  })
  it('routes against the live reply without repeating the running user input', async () => {
    const f = fixture()
    await f.scheduler.submit('root', 'workspace', 'Discuss a plan')
    const first = f.topics()[0]
    await f.scheduler.submit('root', 'workspace', 'Another plan', true)
    f.ports.update(all => all.map(c => c.id === first.id ? { ...c, messages: [first.topic!.inputs[0].message] } : c))
    f.ports.pendingReply = id => id === first.id ? 'The plan currently being explained' : ''
    vi.mocked(f.ports.route).mockResolvedValueOnce({ kind: 'continue', targetId: first.id })
    await f.scheduler.submit('root', 'workspace', 'Implement that plan')
    expect(vi.mocked(f.ports.route).mock.calls[0][0].candidates[0].messages).toEqual([
      { role: 'user', content: 'Discuss a plan' },
      { role: 'assistant', content: 'The plan currently being explained' },
    ])
  })
  it('routes burst inputs in input order and applies a parallel capacity limit', async () => {
    const f = fixture(2), gate = deferred<{ kind: 'new' }>()
    await f.scheduler.submit('root', null, 'First')
    await f.scheduler.submit('root', null, 'Independent', true)
    vi.mocked(f.ports.route).mockReturnValueOnce(gate.promise)
    const second = f.scheduler.submit('root', null, 'Second')
    const third = f.scheduler.submit('root', null, 'Third')
    await tick(); expect(f.topics()).toHaveLength(4); expect(f.ports.route).toHaveBeenCalledTimes(1)
    gate.resolve({ kind: 'new' }); await Promise.all([second, third]); await tick()
    expect(f.runs.map(r => r.text)).toEqual(['First', 'Independent'])
    f.runs[0].gate.resolve(); await tick()
    expect(f.runs.map(r => r.text)).toEqual(['First', 'Independent'])
    f.runs[1].gate.resolve(); await tick()
    expect(f.runs.map(r => r.text)).toEqual(['First', 'Independent', 'Second'])
    expect(f.steers.at(-1)?.text).toBe('Third')
  })
  it('retains ambiguous input and prevents cross-workspace merging', async () => {
    const f = fixture(); await f.scheduler.submit('root', 'a', 'One')
    await f.scheduler.submit('root', 'a', 'Two', true)
    vi.mocked(f.ports.route).mockResolvedValue({ kind: 'choice' })
    await f.scheduler.submit('root', 'a', 'Unclear')
    await f.scheduler.submit('root', 'b', 'Other workspace')
    const unresolved = f.topics()[2], foreign = f.topics()[3]
    await f.scheduler.resolve(unresolved.id, { kind: 'continue', targetId: foreign.id })
    expect(f.topics()[2].topic?.state).toBe('choice')
    expect(f.runs.map(r => r.text)).toEqual(['One', 'Two', 'Other workspace'])
  })
  it('does not execute when persistence fails and preserves the input for manual recovery', async () => {
    const f = fixture(); vi.mocked(f.ports.save).mockRejectedValue(new Error('Disk full'))
    await f.scheduler.submit('root', null, 'Must be preserved')
    expect(f.runs).toHaveLength(0)
    expect(f.topics()[0].topic).toMatchObject({ state: 'choice', diagnostic: 'Disk full' })
    expect(f.topics()[0].topic?.inputs[0].message.content).toBe('Must be preserved')
  })
  it('stop pauses both active and queued inputs while another topic continues', async () => {
    const f = fixture(); await f.scheduler.submit('root', null, 'First')
    const first = f.topics()[0]
    vi.mocked(f.ports.route).mockResolvedValueOnce({ kind: 'continue', targetId: first.id })
    await f.scheduler.submit('root', null, 'Later')
    await f.scheduler.submit('root', null, 'Independent', true)
    f.scheduler.stop(first.id); await tick()
    expect(f.topics()[0].topic?.inputs.map(i => i.state)).toEqual(['paused', 'paused'])
    expect(f.runs).toHaveLength(2)
    expect(f.topics()[1].topic?.inputs[0].state).toBe('running')
  })
  it('ignores a routing result after the user stops its provisional card', async () => {
    const f = fixture(); await f.scheduler.submit('root', null, 'First')
    await f.scheduler.submit('root', null, 'Independent', true)
    const gate = deferred<{ kind: 'new' }>(); vi.mocked(f.ports.route).mockReturnValueOnce(gate.promise)
    const pending = f.scheduler.submit('root', null, 'Second'); await tick()
    f.scheduler.stop(f.topics()[2].id); gate.resolve({ kind: 'new' }); await pending
    expect(f.runs).toHaveLength(2); expect(f.topics()[2].topic?.state).toBe('choice')
  })
  it('round-trips queue and base context and never automatically replays on recovery', async () => {
    const f = fixture(); await f.scheduler.submit('root', 'workspace', 'First')
    const saved = normalizeJanusChatSnapshot({ version: 1, activeConversationId: 'root', conversations: f.ports.read() })!
    expect(saved.conversations[1].topic).toEqual(f.topics()[0].topic)
    const recovered = recoverTopics(saved.conversations)
    expect(recovered[1].topic?.inputs[0].state).toBe('paused')
    expect(saved.conversations[1].topic?.inputs[0].state).toBe('running')
  })
})
