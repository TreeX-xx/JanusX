import { describe, expect, it } from 'vitest'
import { AgentSteeringPort, runJanusAgentLoop } from '@janus-agent/agent-core'

describe('installed agent tool pairing', () => {
  it('includes inputs received while preparing context in the first installed-engine request', async () => {
    const steeringPort = new AgentSteeringPort()
    let calls = 0, transforms = 0
    const messages = await runJanusAgentLoop([{ role: 'user', content: 'Start' }], {
      tools: [], steeringPort,
      transformContext: async context => {
        if (transforms++ === 0) steeringPort.push('early', { role: 'user', content: 'New constraint' })
        return context
      },
      stream: async context => {
        calls++
        expect(context.at(-1)?.content).toBe('New constraint')
        return { message: { role: 'assistant', content: 'Updated' } }
      },
    })
    expect(calls).toBe(1)
    expect(messages.filter(m => m.content === 'New constraint')).toHaveLength(1)
  })
  it.each([true, false])('pairs every call when parallel steering is %s', async (steer) => {
    const steeringPort = new AgentSteeringPort()
    const calls = [
      { id: 'read-1', name: 'note_read', arguments: {} },
      { id: 'write-1', name: 'note_write', arguments: {} },
      { id: 'write-2', name: 'note_write', arguments: {} },
    ]
    let writes = 0
    let turns = 0
    const messages = await runJanusAgentLoop([{ role: 'user', content: 'Update Note' }], {
      steeringPort, maxTurns: 2,
      tools: [
        { name: 'note_read', executionMode: 'parallel', execute: async () => {
          if (steer) steeringPort.push('followup', { role: 'user', content: 'Revised title' })
          return { content: 'Read completed' }
        } },
        { name: 'note_write', executionMode: 'sequential', execute: async () => {
          writes++
          return { content: 'Written' }
        } },
      ],
      stream: async () => turns++ === 0
        ? { message: { role: 'assistant', content: '', toolCalls: calls }, toolCalls: calls }
        : { message: { role: 'assistant', content: 'done' } },
    })
    const results = messages.filter(message => message.role === 'tool')
    expect(results.map(message => message.toolCallId)).toEqual(calls.map(call => call.id))
    expect(writes).toBe(steer ? 0 : 2)
    if (steer) {
      expect(results.slice(1).every(result => result.content.includes('skipped'))).toBe(true)
      expect(messages.findIndex(message => message.content === 'Revised title')).toBeGreaterThan(messages.indexOf(results[2]))
    }
  })

  it.each(['before-first', 'between-tools'])('pairs skipped sequential calls %s', async (boundary) => {
    const steeringPort = new AgentSteeringPort()
    const calls = ['one', 'two'].map(id => ({ id, name: 'write', arguments: {} }))
    let writes = 0
    let turns = 0
    let injected = false
    const steer = () => {
      if (injected) return
      injected = true
      steeringPort.push('followup', { role: 'user', content: 'Stop writing' })
    }
    const messages = await runJanusAgentLoop([{ role: 'user', content: 'Write' }], {
      steeringPort, maxTurns: 2,
      onEvent: event => {
        if (boundary === 'before-first' && event.type === 'message_end') steer()
      },
      tools: [{ name: 'write', executionMode: 'sequential', execute: async () => {
        writes++
        steer()
        return { content: 'Written' }
      } }],
      stream: async () => turns++ === 0
        ? { message: { role: 'assistant', content: '', toolCalls: calls }, toolCalls: calls }
        : { message: { role: 'assistant', content: 'done' } },
    })
    expect(messages.filter(message => message.role === 'tool').map(message => message.toolCallId)).toEqual(['one', 'two'])
    expect(writes).toBe(boundary === 'before-first' ? 0 : 1)
  })
})
