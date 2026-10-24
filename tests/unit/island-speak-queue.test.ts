import { describe, expect, it } from 'vitest'
import { IslandSpeakQueue } from '../../src/renderer/src/components/janus/islandSpeakQueue'

const T0 = 50_000

function make(): IslandSpeakQueue {
  return new IslandSpeakQueue({ soloHoldMs: 2600, queuedHoldMs: 1900, gapMs: 420 })
}

describe('IslandSpeakQueue 串行传话', () => {
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

  it('AC-3 面板打开 = 已读：清空待播、历史保留', () => {
    const q = make()
    q.enqueue({ id: 'a', body: 'A', at: T0 }, T0)
    q.enqueue({ id: 'b', body: 'B', at: T0 }, T0)
    q.markSeen()
    const snap = q.step(T0 + 10_000)
    expect(snap.speaking).toBeNull()
    expect(snap.pendingCount).toBe(0)
    expect(snap.historyCount).toBe(2)
  })

  it('AC-3/AC-4 看过即焚：burnHistory 清空且计数归零', () => {
    const q = make()
    q.enqueue({ id: 'a', body: 'A', at: T0 }, T0)
    q.enqueue({ id: 'b', body: 'B', at: T0 }, T0)
    expect(q.historyList()).toHaveLength(2)
    expect(q.burnHistory()).toBe(2)
    expect(q.step(T0 + 1000).historyCount).toBe(0)
  })

  it('历史与计数一致：计数只随到达与焚尽变化', () => {
    const q = make()
    q.enqueue({ id: 'a', body: 'A', at: T0 }, T0)
    expect(q.step(T0).historyCount).toBe(1)
    q.dismiss(T0 + 100)
    expect(q.step(T0 + 200).historyCount).toBe(1)
    q.enqueue({ id: 'b', body: 'B', at: T0 + 300 }, T0 + 300)
    expect(q.step(T0 + 400).historyCount).toBe(2)
    q.burnHistory()
    expect(q.step(T0 + 500).historyCount).toBe(0)
  })
})
