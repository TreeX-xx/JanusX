import { describe, expect, it } from 'vitest'
import { emptyChatTimeline, mergeTimelineTrace, normalizeChatTimeline, reduceChatTimeline, reduceTimelineRuntime, settleChatTimeline } from '../../src/shared/chat-timeline'
import { normalizeLaunchAssistantHistory, serializeLaunchAssistantHistory } from '../../src/shared/launch-assistant-history'
import { normalizeJanusChatSnapshot } from '../../src/shared/ipc/janus-chat'
import type { ChatAgentEvent } from '../../src/shared/ipc/llm'

describe('ordered chat process', () => {
  it('persists bounded context diagnostics without allowing raw text into the display snapshot', () => {
    const data = { phase: 'tool-result' as const, modelRequest: 2, at: 10, callId: 'read', toolName: 'work_read_resource',
      reasonCode: 'context-missing', resources: [{ resourceId: 'resource', version: 'hash', offset: 0, end: 40, total: 90, text: 'secret original' }], text: 'secret instruction' }
    const snapshot = reduceChatTimeline(emptyChatTimeline('r'), { type: 'context_diagnostic', requestId: 'r', data })
    const restored = normalizeChatTimeline(JSON.parse(JSON.stringify(snapshot)))!
    expect(restored.contextDiagnostics?.[0]).toMatchObject({ callId: 'read', resources: [{ resourceId: 'resource', offset: 0, end: 40 }] })
    expect(JSON.stringify(restored)).not.toContain('secret')
    expect(restored.blocks).toEqual([])
    expect(reduceChatTimeline(snapshot, { type: 'context_diagnostic', requestId: 'other', data })).toBe(snapshot)
  })
  it('preserves interleaving and closes each thinking segment before tool execution', () => {
    let state = emptyChatTimeline('r')
    const emit = (event: Omit<ChatAgentEvent, 'requestId'>, now: number) => { state = reduceChatTimeline(state, { ...event, requestId: 'r' } as ChatAgentEvent, now) }
    emit({ type: 'reasoning_delta', delta: 'Check scripts.' } as any, 10)
    emit({ type: 'text_delta', delta: 'Reading.' } as any, 20)
    emit({ type: 'tool_execution_start', callId: 'a', toolName: 'read' } as any, 30)
    emit({ type: 'reasoning_delta', delta: 'Check entry.' } as any, 40)
    emit({ type: 'tool_execution_start', callId: 'b', toolName: 'read' } as any, 50)
    emit({ type: 'tool_execution_end', callId: 'a', toolName: 'read', status: 'completed' } as any, 60)
    emit({ type: 'text_delta', delta: 'Done.' } as any, 70)
    const settled = settleChatTimeline(state, 80)
    expect(settled.blocks.map(block => block.kind)).toEqual(['reasoning', 'text', 'tool', 'reasoning', 'tool', 'text'])
    expect(settled.blocks.map(block => block.endedAt)).toEqual([20, 30, 60, 50, 80, 80])
    expect(settled.blocks.filter(block => block.kind === 'tool').map(block => block.callId)).toEqual(['a', 'b'])
    expect(settled.blocks[4]).toMatchObject({ entry: { status: 'failed' } })
    expect(reduceChatTimeline(state, { type: 'text_delta', requestId: 'foreign', delta: 'wrong' })).toBe(state)
  })

  it('attaches business results before tool completion and never serializes config secrets', () => {
    let state = reduceChatTimeline(emptyChatTimeline(), { type: 'config_change', requestId: 'r', callId: 'edit-1',
      change: { id: 'config-1', config: { configurations: [{ env: { TOKEN: 'do-not-store' } }] } as any,
        summary: 'set program', validation: { valid: false, errors: [{ field: 'program', message: 'Missing' }], warnings: [] } } })
    state = reduceChatTimeline(state, { type: 'tool_execution_end', requestId: 'r', callId: 'edit-1', toolName: 'launch-config.edit', status: 'completed' })
    expect(state.blocks).toHaveLength(1)
    expect(state.blocks[0]).toMatchObject({ details: [{ kind: 'config', valid: false, applied: false, errors: ['program: Missing'] }] })
    expect(JSON.stringify(state)).not.toContain('do-not-store')
    state = mergeTimelineTrace(state, { callId: 'edit-1', toolName: 'launch-config.edit', workspaceId: 'w', status: 'completed', summary: 'draft modified' })
    expect(state.blocks).toHaveLength(1)
    expect(state.blocks[0]).toMatchObject({ entry: { workspaceId: 'w', summary: 'draft modified' } })
    state = mergeTimelineTrace(state, { callId: 'edit-1', toolName: 'launch-config.edit', workspaceId: 'w', status: 'completed', summary: 'draft modified',
      configResult: { operation: 'edit', summary: 'modified', valid: false, errors: [], warnings: [], applied: false } })
    expect(state.blocks[0].kind === 'tool' && state.blocks[0].details).toHaveLength(1)
  })

  it('keeps future reasoning after truncation and settles unfinished tools on cancellation', () => {
    let state = reduceChatTimeline(emptyChatTimeline('r'), { type: 'reasoning_delta', requestId: 'r', delta: 'a'.repeat(10_000) }, 1)
    state = reduceChatTimeline(state, { type: 'tool_execution_start', requestId: 'r', callId: 'a', toolName: 'read' }, 2)
    state = reduceChatTimeline(state, { type: 'reasoning_delta', requestId: 'r', delta: 'Latest direction' }, 3)
    state = settleChatTimeline(state, 4, true)
    expect(state.blocks[0]).toMatchObject({ truncated: true, chars: 10_000 })
    expect(state.blocks[2]).toMatchObject({ text: 'Latest direction', endedAt: 4 })
    expect(state.blocks[1]).toMatchObject({ entry: { status: 'cancelled' } })
  })

  it('keeps the first summary when reasoning is truncated and closes it on execution of an existing call', () => {
    let state = reduceChatTimeline(emptyChatTimeline('r'), { type: 'tool_call_start', requestId: 'r', callId: 'a' }, 1)
    state = reduceChatTimeline(state, { type: 'reasoning_delta', requestId: 'r', delta: 'First summary.\n' + 'x'.repeat(5000) }, 2)
    state = reduceChatTimeline(state, { type: 'tool_execution_start', requestId: 'r', callId: 'a', toolName: 'read' }, 3)
    expect(state.blocks[1]).toMatchObject({ endedAt: 3, preview: expect.stringContaining('First summary.') })
    state = reduceTimelineRuntime(state, { type: 'approval-requested', request: { correlationId: 'a' } } as any, 4)
    expect(state.blocks[0]).toMatchObject({ entry: { status: 'approval' } })
    state = settleChatTimeline(state, 5, true)
    state = reduceChatTimeline(state, { type: 'tool_execution_update', requestId: 'r', callId: 'a', toolName: 'read' }, 6)
    expect(state.blocks[0]).toMatchObject({ entry: { status: 'cancelled' } })
  })

  it('bounds launch history and discards config payloads and executable fields on restore', () => {
    const timeline = { version: 1, requestId: 'r', blocks: [{ id: 'tool', kind: 'tool', callId: 'c', startedAt: 1,
      entry: { toolName: 'edit', status: 'running', summary: 'edited' },
      details: [{ kind: 'config', id: 'change', summary: 'draft edited', config: { env: { TOKEN: 'secret-value' } }, errors: [], warnings: [], applied: false }] }] }
    const result = serializeLaunchAssistantHistory([{ role: 'assistant', content: '', timeline: timeline as any }])
    expect(result).not.toContain('secret-value')
    expect(normalizeLaunchAssistantHistory(JSON.parse(result))[0].timeline?.blocks[0]).toMatchObject({ entry: { status: 'cancelled' } })
    expect(normalizeLaunchAssistantHistory({ version: 2, messages: [] })).toEqual([])
    const bounded = serializeLaunchAssistantHistory(Array.from({ length: 40 }, () => ({ role: 'assistant', content: 'x'.repeat(200_000) })))
    expect(bounded.length).toBeLessThanOrEqual(1_000_000)
  })

  it('restores ordered display separately from content and falls back for old messages', () => {
    const timeline = reduceChatTimeline(emptyChatTimeline('r'), { type: 'reasoning_delta', requestId: 'r', delta: 'Private to display' }, 1)
    const restored = normalizeJanusChatSnapshot({ version: 1, activeConversationId: 'c', conversations: [{ id: 'c', title: 'Chat', createdAt: 1, updatedAt: 1,
      messages: [{ id: 'old', role: 'assistant', timestamp: 1, content: 'Old answer' },
        { id: 'new', role: 'assistant', timestamp: 2, content: 'Answer', timeline }], attachedWorkspaceIds: [], toolTraces: [],
    }] })!
    expect(restored.conversations[0].messages[0].timeline).toBeUndefined()
    expect(restored.conversations[0].messages[1]).toMatchObject({ content: 'Answer', timeline: { blocks: [{ text: 'Private to display', endedAt: 1 }] } })
    expect(restored.conversations[0].messages.map(({ role, content }) => ({ role, content }))).not.toContainEqual(expect.objectContaining({ content: 'Private to display' }))
    expect(normalizeChatTimeline({ version: 99, blocks: [] })).toBeUndefined()
  })
})
