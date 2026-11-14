import { describe, expect, it } from 'vitest'
import type { ConversationPlan } from '../../src/shared/conversation-display'
import { compactConversationPlans } from '../../src/shared/conversation-plans'

const plan = (version: number, steps = ['Inspect', 'Implement', 'Verify'], extra: Partial<ConversationPlan> = {}): ConversationPlan => ({
  turnId: 'turn-a', version, explanation: '', outcome: 'running', steps: steps.map(step => ({ step, status: 'pending' })), ...extra,
})

describe('plan history presentation', () => {
  it('shows one latest plan for repeated progress updates without modifying native snapshots', () => {
    const snapshots = Array.from({ length: 50 }, (_, i) => plan(i + 1, undefined, {
      explanation: `Progress ${i}`, outcome: i === 49 ? 'completed' : 'running',
      steps: ['Inspect', 'Implement', 'Verify'].map((step, index) => ({ step, status: i >= index * 20 ? 'completed' : 'pending' })),
    }))
    const before = structuredClone(snapshots)
    const projected = compactConversationPlans(snapshots)
    expect(projected).toEqual([snapshots.at(-1)])
    expect(projected[0]).toBe(snapshots.at(-1))
    expect(projected[0].steps.every(step => step.status === 'completed')).toBe(true)
    expect(snapshots).toEqual(before)
  })

  it('retains changes to step content, count and order while merging progress inside each revision', () => {
    const snapshots = [plan(1), plan(2), plan(3, ['Inspect', 'Implement', 'Verify', 'Review']),
      plan(4, ['Inspect', 'Implement', 'Verify', 'Review']), plan(5, ['Inspect', 'Verify', 'Implement', 'Review']),
      plan(6, ['Inspect', 'Verify', 'Implement', 'Publish'])]
    expect(compactConversationPlans(snapshots).map(row => row.version)).toEqual([2, 4, 5, 6])
  })

  it('uses the last confirmed progress and outcome, including stale, failure and interruption metadata', () => {
    const snapshots = [plan(1), plan(2, undefined, { stale: true }), plan(3, undefined, { outcome: 'failed', explanation: 'Verification failed' })]
    expect(compactConversationPlans(snapshots)).toEqual([snapshots[2]])
    expect(compactConversationPlans(snapshots.slice(0, 2))[0].stale).toBe(true)
    expect(compactConversationPlans([plan(1), plan(2, undefined, { outcome: 'interrupted' })])[0].outcome).toBe('interrupted')
  })

  it('never merges separate turns with identical steps, even when their snapshots interleave', () => {
    const snapshots = [plan(1), plan(1, undefined, { turnId: 'turn-b' }), plan(2)]
    expect(compactConversationPlans(snapshots).map(row => [row.turnId, row.version])).toEqual([['turn-a', 2], ['turn-b', 1]])
  })

  it('keeps plan clearing and returning to an earlier structure as real changes', () => {
    expect(compactConversationPlans([plan(1), plan(2, []), plan(3, []), plan(4)]).map(row => row.version)).toEqual([1, 3, 4])
    expect(compactConversationPlans([])).toEqual([])
  })
})
