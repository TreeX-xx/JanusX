import { describe, it, expect } from 'vitest'
import { conversationOutputGroups } from '../../src/shared/conversation-output'
import { summarizeWork } from '../../src/shared/work-output'
import type { ConversationItem } from '../../src/shared/conversation-display'
const item = (id: string, type: string, extra: Partial<ConversationItem> = {}): ConversationItem => ({ id, type, turnId: 'turn', text: id, status: 'completed', ...extra })
describe('conversation output grouping', () => {
  it('keeps the running activity visible when another tool finishes, then retains the last target without a timer', () => {
    const rows = [item('read', 'commandExecution', { activity: 'Read · src/main.ts', receivedAt: 10, status: 'inProgress' }),
      item('search', 'commandExecution', { activity: 'Grep · message', receivedAt: 20, text: 'Grep\nLarge result', status: 'completed' })]
    const live = conversationOutputGroups(rows, 'turn')[0]
    expect(live.activity).toEqual({ text: 'Read · src/main.ts', startedAt: 10 })
    expect(live.items[0].id).toBe('read')
    rows[0].status = 'completed'
    expect(conversationOutputGroups(rows, null)[0].activity).toEqual({ text: 'Grep · message', startedAt: undefined })
    expect(conversationOutputGroups([item('legacy', 'commandExecution')], null)[0].activity).toBeUndefined()
  })
  it('keeps chronological process separate from final answer and user input', () => {
    const items = [item('user', 'userMessage'), item('update', 'agentMessage', { phase: 'commentary' }), item('tool', 'commandExecution'), item('answer', 'agentMessage', { phase: 'final_answer' })]
    const groups = conversationOutputGroups(items, null)
    expect(groups.map(g => [g.process, g.settled, g.items.map(i => i.id)])).toEqual([[false, false, ['user']], [false, false, ['update']], [true, true, ['tool']], [false, false, ['answer']]])
    expect(groups.flatMap(g => g.items)).toEqual(items)
  })
  it.each([{ status: 'failed' }, { status: 'inProgress' }, { status: 'declined' }, { truncated: true }])('does not label unresolved evidence as settled: %j', extra => {
    expect(conversationOutputGroups([item('tool', 'commandExecution', extra), item('answer', 'agentMessage')], null)[0].settled).toBe(false)
  })
  it('groups live operations without waiting for a final answer', () => {
    expect(conversationOutputGroups([item('tool', 'commandExecution'), item('answer', 'agentMessage')], 'turn')[0].settled).toBe(false)
    expect(conversationOutputGroups([item('tool', 'commandExecution'), item('update', 'agentMessage', { phase: 'commentary' })], null).map(g => g.process)).toEqual([true, false])
  })
  it('does not group across turn boundaries', () => {
    const items = [item('tool', 'commandExecution'), item('tool2', 'commandExecution', { turnId: 'next' })]
    expect(conversationOutputGroups(items, null).map(g => g.items.length)).toEqual([1, 1])
  })
  it('breaks runs at prose and image results, without dropping or reordering records', () => {
    const items = [item('a', 'commandExecution'), item('b', 'fileChange'), item('prose', 'agentMessage'), item('c', 'reasoning'), item('image', 'imageGeneration'), item('d', 'commandExecution')]
    const groups = conversationOutputGroups(items, 'turn')
    expect(groups.map(g => g.items.map(i => i.id))).toEqual([['a', 'b'], ['prose'], ['c'], ['image'], ['d']])
    expect(groups.map(g => g.process)).toEqual([true, false, true, false, true])
    expect(groups.flatMap(g => g.items)).toEqual(items)
  })
  it('keeps failures, approvals, interruption and truncation visible in the summary while other work runs', () => {
    expect(summarizeWork(['running', 'failed', 'approval', 'declined', 'unknown'].map(status => ({ status })))).toEqual({ count: 5, running: 1, failed: 1, waiting: 1, interrupted: 1, incomplete: true })
    expect(summarizeWork([{ status: 'completed', truncated: true }]).incomplete).toBe(true)
  })
})
