import { describe, expect, it } from 'vitest'
import { createConversationTurns } from '../../src/renderer/src/lib/conversation-turns'
import type { ConversationItem } from '../../src/shared/conversation-display'

const item = (turnId: string, type = 'agentMessage', text = turnId): ConversationItem => ({ id: `${turnId}-${type}`, turnId, type, text, status: 'completed' })

describe('historical turn projection', () => {
  it('retains historical grouping and patch projections across cloned streaming snapshots', () => {
    const project = createConversationTurns()
    const rows = [item('old', 'fileChange'), item('old'), item('live')]
    rows[0].files = [{ path: 'a.ts', diff: '@@ -1 +1 @@\n-before\n+after' }]
    const first = project(rows, 'live')
    const next = structuredClone(rows)
    next[2].text += ' delta'
    const second = project(next, 'live')
    expect(second[0]).toBe(first[0])
    expect(second[0].changes).toBe(first[0].changes)
    expect(second[1]).not.toBe(first[1])
    expect(second[1].items[0].text).toBe('live delta')
    expect(project(structuredClone(next), null)[1].active).toBe(false)
  })

  it('invalidates changed patches and drops rewritten turns without leaking across sessions', () => {
    const project = createConversationTurns()
    const rows = [item('a', 'fileChange'), item('b')]
    rows[0].files = [{ path: 'a.ts', diff: '@@ -0,0 +1 @@\n+one' }]
    const first = project(rows, null)
    const changed = structuredClone(rows)
    changed[0].files![0].diff = '@@ -0,0 +1,2 @@\n+one\n+two'
    const second = project(changed, null)
    expect(second[0]).not.toBe(first[0])
    expect(second[0].changes?.files[0].additions).toBe(2)
    expect(second[1]).toBe(first[1])
    expect(project([changed[0]], null).map(turn => turn.key)).toEqual(['a'])
    expect(project(rows, null)[1]).not.toBe(first[1])
    expect(createConversationTurns()(rows, null)[0]).not.toBe(first[0])
  })
})
