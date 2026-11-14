import { describe, expect, it } from 'vitest'
import { createToolManifests, type JanusAgentMessage, type ToolDefinition } from '@janus-agent/agent-core'
import { runChatTurn } from '@janus-agent/janus-agent'
import { ManagedChatSession } from '../../src/main/llm/managed-chat-session'
import { resolveChatModelBudget } from '../../src/main/llm/chat-model-budget'
import type { ChatContextStatus } from '../../src/shared/chat-context'

const options = { model: { contextWindow: 16000, maxOutputTokens: 2000 }, toolTokens: 1000 }
const summary = (text = 'Keep the constraints.') => `## Goal\n${text}\n## Progress\nWork remains.\n## Next Steps\nContinue.`
const history = (): JanusAgentMessage[] => Array.from({ length: 35 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `DECISION_${index} ` + 'abc '.repeat(500) }))

describe('managed conversation context', () => {
  it('uses declared model limits, exact registry matches and visible fallback', () => {
    expect(resolveChatModelBudget('unknown')).toMatchObject({ contextWindow: 16384, source: 'estimated' })
    expect(resolveChatModelBudget('unknown', { contextWindow: 32000, maxOutputTokens: 4096 })).toMatchObject({ contextWindow: 32000, maxOutputTokens: 4096, source: 'catalog', resolved: true })
    expect(resolveChatModelBudget('unknown', undefined, { chatModelLimits: { unknown: { contextWindow: 64000, maxOutputTokens: 8192 } } })).toMatchObject({ contextWindow: 64000, maxOutputTokens: 8192, source: 'configured' })
    expect(resolveChatModelBudget('unknown', { contextWindow: 32000, maxOutputTokens: 4096 }, { chatModelLimits: { unknown: { contextWindow: 64000, maxOutputTokens: 8192 } } })).toMatchObject({ contextWindow: 32000, maxOutputTokens: 4096, source: 'catalog' })
    expect(resolveChatModelBudget('unknown', undefined, { chatModelLimits: { unknown: { contextWindow: 1000000 } } })).toMatchObject({ source: 'estimated', resolved: false })
    expect(resolveChatModelBudget('claude-sonnet-4.6').contextWindow).toBeGreaterThan(16384)
    expect(resolveChatModelBudget('unknown', undefined, { chatModelLimits: { unknown: { contextWindow: -1 } } }).source).toBe('estimated')
  })

  it('retains more than 24 messages when they fit', () => {
    const session = new ManagedChatSession()
    const messages = history()
    session.beginTurn(messages, 'scope', undefined, () => {}, 'catalog')
    expect(session.buildContext(messages, { model: { contextWindow: 1000000 } })).toEqual(messages)
  })

  it('summarizes every removed message in batches and resumes without replaying that prefix', async () => {
    const session = new ManagedChatSession()
    const messages = history()
    const original = JSON.stringify(messages)
    const statuses: ChatContextStatus[] = []
    session.beginTurn(messages, 'scope', undefined, status => statuses.push(status), 'catalog')
    const prompts: string[] = []
    await session.maybeCompact(messages, options, async input => {
      prompts.push(input.prompt)
      return summary([...new Set(input.prompt.match(/DECISION_\d+/g) ?? [])].join(' '))
    })
    const checkpoint = statuses.at(-1)!.checkpoint!
    expect(checkpoint.coveredMessages).toBeGreaterThan(0)
    for (let i = 0; i < checkpoint.coveredMessages; i++) expect(prompts.join('\n')).toContain(`DECISION_${i}`)
    expect(JSON.stringify(messages)).toBe(original)
    const firstView = session.buildContext(messages, options)
    expect(firstView.at(-1)).toEqual(messages.at(-1))
    const next = [...messages, { role: 'assistant' as const, content: 'Done.' }, { role: 'user' as const, content: 'Continue.' }]
    const restored = new ManagedChatSession()
    const tail = restored.beginTurn(next, 'scope', checkpoint, () => {}, 'catalog')
    expect(tail).toEqual(next.slice(checkpoint.coveredMessages))
    expect(restored.buildContext(tail, options).some(item => item.content.includes('DECISION_0'))).toBe(true)
  })

  it('does not commit a partial summary or silently drop history after failure', async () => {
    const session = new ManagedChatSession()
    const messages = history()
    const statuses: ChatContextStatus[] = []
    session.beginTurn(messages, 'scope', undefined, state => statuses.push(state), 'catalog')
    let attempts = 0
    // Force a second summary request independently of automatic selection thresholds.
    await expect(session.maybeCompact(messages, { ...options, force: true }, async () => {
      if (attempts++ > 0) throw new Error('summary unavailable')
      return summary()
    })).rejects.toThrow('原始对话已保留')
    expect(attempts).toBe(2)
    expect(statuses.every(state => !state.checkpoint)).toBe(true)
    expect(() => session.buildContext(messages, options)).toThrow('原始对话已保留')
    expect(messages).toHaveLength(35)
  })

  it('invalidates summaries on a rewrite or workspace switch', async () => {
    const session = new ManagedChatSession()
    const messages = history()
    let checkpoint: ChatContextStatus['checkpoint']
    session.beginTurn(messages, 'scope', undefined, status => { checkpoint = status.checkpoint }, 'catalog')
    await session.maybeCompact(messages, options, async () => summary())
    const rewritten = messages.map((item, i) => i ? item : { ...item, content: 'New decision' })
    expect(session.beginTurn(rewritten, 'scope', checkpoint, () => {}, 'catalog')).toEqual(rewritten)
    expect(session.beginTurn(messages, 'other', checkpoint, () => {}, 'catalog')).toEqual(messages)
  })

  it('advances checkpoints over successive turns and honors the manual retained tail', async () => {
    let messages = history()
    let checkpoint: ChatContextStatus['checkpoint']
    const summarize = async (input: { prompt: string }) => summary([...new Set(input.prompt.match(/DECISION_\d+/g) ?? [])].join(' '))
    for (let turn = 0; turn < 3; turn++) {
      const previousCovered = checkpoint?.coveredMessages ?? 0
      const session = new ManagedChatSession()
      const tail = session.beginTurn(messages, 'scope', checkpoint, state => { checkpoint = state.checkpoint }, 'catalog')
      await session.maybeCompact(tail, { ...options, force: true, keepRecentUnits: 4 }, summarize)
      expect(checkpoint!.coveredMessages).toBeGreaterThan(previousCovered)
      expect(checkpoint!.coveredMessages).toBe(messages.length - 4)
      expect(checkpoint!.summary).toContain('DECISION_0')
      expect(session.buildContext(tail, options).slice(-4)).toEqual(messages.slice(-4))
      messages = [...messages, { role: 'assistant', content: `Answer ${turn}` }, { role: 'user', content: `Follow-up ${turn}` }]
    }
  })

  it('retains exact structured references even when the model summary omits them', async () => {
    const session = new ManagedChatSession()
    const source = { uri: 'note://repo/exact', path: '.agents/notes/exact.md', workspacePath: 'C:/project', expectedHash: 'e'.repeat(64), txId: 'transaction-exact' }
    const messages: JanusAgentMessage[] = [{ role: 'user', content: 'Read and update' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'call', name: 'note_read', arguments: {} }] },
      { role: 'tool', content: JSON.stringify({ output: source }), toolCallId: 'call', toolName: 'note_read' },
      { role: 'user', content: 'Continue with these files' }]
    let checkpoint: ChatContextStatus['checkpoint']
    session.beginTurn(messages, 'scope', undefined, state => { checkpoint = state.checkpoint }, 'catalog')
    await session.maybeCompact(messages, { ...options, force: true }, async () => summary())
    expect(checkpoint!.references).toContain(JSON.stringify(source))
    for (const value of Object.values(source)) expect(JSON.stringify(session.buildContext(messages, options))).toContain(value)
    expect(session.buildContext(messages, options).some(message => message.role === 'tool')).toBe(false)
  })

  it('does not commit or continue inference after cancellation during summary', async () => {
    const session = new ManagedChatSession()
    const messages = history()
    const controller = new AbortController()
    const states: ChatContextStatus[] = []
    session.beginTurn(messages, 'scope', undefined, state => states.push(state), 'catalog')
    await expect(session.maybeCompact(messages, options, async () => {
      controller.abort()
      return summary()
    }, controller.signal)).rejects.toThrow()
    expect(states.every(state => !state.checkpoint)).toBe(true)
    expect(() => session.buildContext(messages, options)).toThrow()
    expect(messages).toHaveLength(35)
  })

  it('keeps Note identity and source in the next model context, and excludes stale bodies', () => {
    const session = new ManagedChatSession()
    const first = [{ role: 'user' as const, content: 'Read a Note' }]
    session.beginTurn(first, 'scope', undefined, () => {}, 'catalog')
    session.recordToolResult({ status: 'completed', toolName: 'note.read', output: {
      uri: 'note://repo/note', path: '.agents/notes/a.md', workspacePath: 'C:/project', expectedHash: 'a'.repeat(64), markdown: 'EXACT_NOTE_DECISION',
    } } as never)
    const next = [...first, { role: 'assistant' as const, content: 'Read.' }, { role: 'user' as const, content: 'What did it decide?' }]
    session.beginTurn(next, 'scope', undefined, () => {}, 'catalog')
    const context = JSON.stringify(session.buildContext(next, options))
    expect(context).toContain('EXACT_NOTE_DECISION')
    expect(context).toContain('note://repo/note')
    expect(context).toContain('a'.repeat(64))
    const cached = [...session.noteEvidence.values()][0]
    cached.stale = true
    expect(JSON.stringify(session.buildContext(next, options))).not.toContain('EXACT_NOTE_DECISION')
  })

  it('deduplicates visible evidence, isolates checkouts, and invalidates it after writing', () => {
    const session = new ManagedChatSession()
    const messages = [{ role: 'user' as const, content: 'Read a Note' }]
    session.beginTurn(messages, 'scope', undefined, () => {}, 'catalog')
    const output = { uri: 'note://repo/note', path: '.agents/notes/a.md', workspacePath: 'C:/project', expectedHash: 'a'.repeat(64), markdown: 'ORIGINAL_NOTE_BODY' }
    const read = { status: 'completed', toolName: 'note.read', output } as const
    session.recordToolResult(read as never)
    session.recordToolResult(read as never)
    expect([...session.noteEvidence.values()][0].markdown).toBe('ORIGINAL_NOTE_BODY')
    const live: JanusAgentMessage[] = [...messages, { role: 'assistant', content: '' }, { role: 'tool', content: JSON.stringify({ output }) }]
    expect(JSON.stringify(session.buildContext(live, options)).match(/ORIGINAL_NOTE_BODY/g)).toHaveLength(1)
    session.recordToolResult({ ...read, output: { ...output, workspacePath: 'C:/another-checkout', markdown: 'OTHER_CHECKOUT_BODY' } } as never)
    expect(session.noteEvidence.size).toBe(2)
    session.recordToolResult({ status: 'completed', toolName: 'note.write', output: { files: [{ uri: output.uri }] } } as never)
    expect(JSON.stringify(session.buildContext(messages, options))).not.toContain('ORIGINAL_NOTE_BODY')
    expect(JSON.stringify(session.buildContext(messages, options))).toContain('source changed')
  })

  it('facade cannot swallow a failed summary and make an uninformed model call', async () => {
    const session = new ManagedChatSession()
    const messages = history() as Array<{ role: 'user' | 'assistant'; content: string }>
    session.beginTurn(messages, 'scope', undefined, () => {}, 'catalog')
    let modelCalls = 0
    await expect(runChatTurn({ requestId: 'failure', providerId: 'fixture', messages, chatSession: session,
      compactionSummarizer: async () => { throw new Error('offline') } }, {
      model: { resolve: async () => ({ model: {}, modelId: 'fixture', ...options.model }), getMaxTurns: async () => 3 },
      tools: { registry: { list: () => [] }, executeFunctionCall: async () => { throw new Error('unused') } },
      sessions: { getSession: () => null }, streamTextFn: async () => { modelCalls++; throw new Error('must not call') },
    })).rejects.toThrow('原始对话已保留')
    expect(modelCalls).toBe(0)
  })

  it('recovers a provider overflow at the failed model call without repeating a completed write', async () => {
    const session = new ManagedChatSession()
    const messages = [{ role: 'user' as const, content: 'Earlier rule: keep other Notes' }, { role: 'assistant' as const, content: 'Agreed' }, { role: 'user' as const, content: 'Create a Note now' }]
    session.beginTurn(messages, 'scope', undefined, () => {}, 'catalog')
    let modelCalls = 0, writes = 0, summaries = 0
    const definition: ToolDefinition = { name: 'note.write', description: 'Write a Note', actionRisk: 'write', inputSchema: { type: 'object', properties: {} } }
    const result = await runChatTurn({ requestId: 'recovery', providerId: 'fixture', messages, chatSession: session, sourceTag: 'maintenance',
      workspaceResources: [{ workspaceId: 'ws', workspaceName: 'Fixture', workspacePath: 'C:/fixture', agentSessionId: 'session' }],
      compactionSummarizer: async () => { summaries++; return summary('Keep other Notes; the write already succeeded.') },
    }, {
      model: { resolve: async () => ({ model: {}, modelId: 'fixture', contextWindow: 100000 }), getMaxTurns: async () => 3 },
      sessions: { getSession: () => ({ sessionId: 'session', workspaceId: 'ws', workspaceRoot: 'C:/fixture', status: 'running' }) },
      tools: { registry: { list: () => [definition], listManifests: () => createToolManifests([definition]) }, executeFunctionCall: async () => {
        writes++
        return { toolName: 'note.write', status: 'completed', workspaceId: 'ws', sessionId: 'session', correlationId: 'write', startedAt: new Date().toISOString(), summary: 'Written', output: { txId: 'completed-tx' } }
      } },
      streamTextFn: async input => {
        const call = modelCalls++
        if (call === 1) throw new Error('context length exceeded')
        if (call > 1) expect(JSON.stringify(input.messages)).toContain('completed-tx')
        return { textStream: (async function* () { if (call > 1) yield 'Write completed.' })(),
          toolCalls: Promise.resolve(call === 0 ? [{ toolCallId: 'once', toolName: 'note_write', args: {} }] : []) }
      },
    })
    expect(writes).toBe(1)
    expect(summaries).toBe(1)
    expect(modelCalls).toBe(3)
    expect(result.text).toContain('Write completed')
  })
})
