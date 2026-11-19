import { describe, expect, it } from 'vitest'
import { chatStatusForEvent } from '../../src/renderer/src/components/janus/janusRuntimeState'

describe('janus chat turn status (agentX parity)', () => {
  it('maps lifecycle events to the status row', () => {
    expect(chatStatusForEvent({ type: 'agent_start', requestId: 'r' })).toEqual({ kind: 'connecting' })
    expect(chatStatusForEvent({ type: 'reasoning_delta', requestId: 'r', delta: 'x' })).toEqual({ kind: 'thinking' })
    expect(chatStatusForEvent({ type: 'text_delta', requestId: 'r', delta: 'x' })).toEqual({ kind: 'writing' })
    expect(chatStatusForEvent({ type: 'tool_call_start', requestId: 'r', callId: 'c' })).toEqual({ kind: 'preparing' })
    expect(chatStatusForEvent({ type: 'tool_call_ready', requestId: 'r', callId: 'c', toolName: 't', argumentKeys: [] })).toEqual({ kind: 'preparing' })
    expect(chatStatusForEvent({ type: 'tool_execution_start', requestId: 'r', callId: 'c', toolName: 'workspace_read' })).toEqual({
      kind: 'running',
      toolName: 'workspace_read',
    })
    expect(chatStatusForEvent({ type: 'model_finish', requestId: 'r', reason: 'tool_calls' })).toEqual({ kind: 'running' })
    expect(chatStatusForEvent({ type: 'model_finish', requestId: 'r', reason: 'stop' })).toEqual({ kind: 'finishing' })
    expect(chatStatusForEvent({
      type: 'question_requested', requestId: 'r', callId: 'c', questions: [], allowCustom: false,
    })).toEqual({ kind: 'awaiting' })
  })

  it('keeps the previous status for non-visual events', () => {
    expect(chatStatusForEvent({ type: 'tool_execution_end', requestId: 'r', callId: 'c', toolName: 't', status: 'completed' })).toBeNull()
    expect(chatStatusForEvent({ type: 'todo_update', requestId: 'r', todos: [] })).toBeNull()
    expect(chatStatusForEvent({ type: 'steering_consumed', requestId: 'r', keys: [] })).toBeNull()
  })
})
