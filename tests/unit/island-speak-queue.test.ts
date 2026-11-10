import { describe, expect, it } from 'vitest'
import { IslandSpeakQueue } from '../../src/renderer/src/components/janus/islandSpeakQueue'
import type { IslandNotification } from '../../src/renderer/src/components/janus/islandNotifications'

const T0 = 50_000

function make(): IslandSpeakQueue {
  return new IslandSpeakQueue({ soloHoldMs: 2600, queuedHoldMs: 1900, gapMs: 420 })
}

describe('IslandSpeakQueue 串行传话', () => {
  it('removing a card clears its active, queued and retained notices while preserving other sources', () => {
    const q = make()
    const entry = (id: string) => ({ id, body: id, at: T0, notification: { automation: { id, definitionId: 'deleted-card' } } as IslandNotification })
    q.enqueue(entry('active'), T0)
    q.enqueue(entry('queued'), T0)
    q.enqueue({ id: 'other', body: 'Other source', at: T0 }, T0)
    q.removeAutomation('deleted-card')
    expect(q.step(T0)).toMatchObject({ speaking: { id: 'other' }, historyCount: 1, unreadCount: 1, pendingCount: 1 })
    q.enqueue(entry('active'), T0)
    expect(q.step(T0).history.map(item => item.id)).toEqual(['other'])
  })
  it('单条：立即开讲，hold 到点收起', () => {
    const q = make()
    q.enqueue({ id: 'a', body: 'A', at: T0 }, T0)
    expect(q.step(T0).speaking?.id).toBe('a')
    expect(q.step(T0 + 2599).speaking?.id).toBe('a')
    expect(q.step(T0 + 2600).speaking).toBeNull()
  })

  it('多条：串行播报；续播时已有排队则 hold 缩短', () => {
    const q = make()
    q.enqueue({ id: 'a', body: 'A', at: T0 }, T0)
    q.enqueue({ id: 'b', body: 'B', at: T0 + 100 }, T0 + 100)
    q.enqueue({ id: 'c', body: 'C', at: T0 + 200 }, T0 + 200)
    // a 开讲时队列为空 → soloHoldMs=2600（hold 在开讲时刻决定，lab 语义）
    expect(q.step(T0 + 2599).speaking?.id).toBe('a')
    expect(q.step(T0 + 2600).speaking).toBeNull()
    // 间隔 420ms 后 b 接棒，开讲时后面还有 c → queuedHoldMs=1900
    expect(q.step(T0 + 2600 + 419).speaking).toBeNull()
    expect(q.step(T0 + 2600 + 420).speaking?.id).toBe('b')
    expect(q.step(T0 + 2600 + 420 + 1899).speaking?.id).toBe('b')
    expect(q.step(T0 + 2600 + 420 + 1900).speaking).toBeNull()
    // c 是最后一条 → soloHoldMs=2600
    const end = T0 + 2600 + 420 + 1900 + 420
    expect(q.step(end).speaking?.id).toBe('c')
    expect(q.step(end + 2600).speaking).toBeNull()
  })

  it('AC-3 收起续播：dismiss 当前条后队列继续（不连坐清队）', () => {
    const q = make()
    q.enqueue({ id: 'a', body: 'A', at: T0 }, T0)
    q.enqueue({ id: 'b', body: 'B', at: T0 }, T0)
    q.enqueue({ id: 'c', body: 'C', at: T0 }, T0)
    expect(q.step(T0).speaking?.id).toBe('a')
    expect(q.dismiss(T0 + 500)).toBe(true)
    expect(q.step(T0 + 500).speaking).toBeNull()
    // gap 后续播 b —— 这是实验台修过的卡死 bug 的回归锚
    const snap = q.step(T0 + 500 + 420)
    expect(snap.speaking?.id).toBe('b')
  })

  it('opening and closing silence presentation but preserve all unread records', () => {
    const q = make()
    q.enqueue({ id: 'a', body: 'A', at: T0 }, T0)
    q.enqueue({ id: 'b', body: 'B', at: T0 }, T0)
    q.silence()
    expect(q.step(T0 + 10000)).toMatchObject({ speaking: null, pendingCount: 0, historyCount: 2, unreadCount: 2 })
    q.markRead('a')
    expect(q.step(T0).unreadCount).toBe(1)
    q.clear(true)
    expect(q.step(T0).history.map(item => item.id)).toEqual(['b'])
    q.clear()
    q.enqueue({ id: 'b', body: 'B', at: T0 }, T0)
    expect(q.step(T0).historyCount).toBe(0)
  })

  it('pauses the remaining hold time while hovering or focusing', () => {
    const q = new IslandSpeakQueue()
    q.enqueue({ id: 'a', body: 'A', at: T0 }, T0)
    q.setPaused(true, T0 + 2000)
    expect(q.step(T0 + 20000).speaking?.id).toBe('a')
    expect(q.step(T0 + 20000).nextEventAt).toBe(Infinity)
    q.setPaused(false, T0 + 20000)
    expect(q.step(T0 + 23999).speaking?.id).toBe('a')
    expect(q.step(T0 + 24000).speaking).toBeNull()
    expect(q.step(T0 + 24000).unreadCount).toBe(1)
  })

  it('groups reminders by task, renews the alert and unread state, and never moves a row', () => {
    const q = new IslandSpeakQueue()
    q.enqueue({ id: 'a', groupKey: 'phone', body: 'First', at: T0 }, T0)
    q.enqueue({ id: 'b', body: 'Other', at: T0 + 1 }, T0 + 1)
    q.markRead('phone')
    q.silence()
    q.enqueue({ id: 'c', groupKey: 'phone', body: 'Latest', at: T0 + 60000 }, T0 + 60000)
    const snap = q.step(T0 + 60000)
    expect(snap.speaking).toMatchObject({ id: 'c', body: 'Latest', count: 2, read: false })
    expect(snap.history.map(item => item.key)).toEqual(['phone', 'b'])
    expect(snap.unreadCount).toBe(2)
    q.enqueue({ id: 'a', groupKey: 'phone', body: 'First', at: T0 }, T0 + 60001)
    expect(q.step(T0 + 60001).history[0].id).toBe('c')
  })

  it('retains arrivals during Chat without replaying them on close', () => {
    const q = new IslandSpeakQueue()
    q.enqueue({ id: 'a', body: 'A', at: T0 }, T0, false)
    expect(q.step(T0)).toMatchObject({ speaking: null, unreadCount: 1, historyCount: 1 })
    q.enqueue({ id: 'a', body: 'A', at: T0 }, T0 + 5000)
    expect(q.step(T0 + 5000).speaking).toBeNull()
  })

  it('bounds history and pending presentation together', () => {
    const q = new IslandSpeakQueue({ historyLimit: 2 })
    for (const id of ['a', 'b', 'c']) q.enqueue({ id, body: id, at: T0 }, T0)
    expect(q.step(T0).history.map(item => item.id)).toEqual(['b', 'c'])
    expect(q.step(T0).pendingCount).toBe(2)
    expect(q.step(T0).speaking?.id).toBe('b')
  })
})
