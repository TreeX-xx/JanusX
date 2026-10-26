import { describe, expect, it, vi } from 'vitest'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { ReviewWorkspaceTracker } from '../../plugins/blueprint/src/main/blueprint/review/workspace-tracker'

describe('review workspace activation', () => {
  it('coalesces a thousand registrations, then rechecks branch context on the next root load', async () => {
    let resolve!: (value: string) => void
    const context = vi.fn(() => new Promise<string>(done => { resolve = done }))
    const activate = vi.fn(async () => {})
    const tracker = new ReviewWorkspaceTracker(context, activate, vi.fn())
    for (let i = 0; i < 1000; i++) tracker.track('/repo', true)
    expect(context).toHaveBeenCalledTimes(1)
    resolve('branch-a')
    await nextTurn()
    tracker.track('/repo', true)
    resolve('branch-b')
    await nextTurn()
    expect(activate.mock.calls).toEqual([['branch-a'], ['branch-b']])
  })

  it('does not reactivate a root closed while context resolution is in flight', async () => {
    let resolve!: (value: string) => void
    const activate = vi.fn(async () => {})
    const deactivate = vi.fn()
    const tracker = new ReviewWorkspaceTracker(() => new Promise<string>(done => { resolve = done }), activate, deactivate)
    tracker.track('/repo', true)
    tracker.track('/repo', false)
    resolve('stale')
    await nextTurn()
    expect(activate).not.toHaveBeenCalled()
    expect(deactivate).toHaveBeenCalledWith('/repo')
  })

  it('retries a failed context resolution', async () => {
    const context = vi.fn().mockRejectedValueOnce(new Error('busy')).mockResolvedValueOnce('branch')
    const activate = vi.fn(async () => {})
    const tracker = new ReviewWorkspaceTracker(context, activate, vi.fn())
    tracker.track('/repo', true)
    await nextTurn()
    tracker.track('/repo', true)
    await nextTurn()
    expect(activate).toHaveBeenCalledTimes(1)
  })

  it('ignores all pending and new activations after shutdown', async () => {
    const activate = vi.fn(async () => {})
    const context = vi.fn(async () => 'branch')
    const tracker = new ReviewWorkspaceTracker(context, activate, vi.fn())
    tracker.track('/repo', true)
    tracker.stop()
    tracker.track('/other', true)
    await nextTurn()
    expect(activate).not.toHaveBeenCalled()
    expect(context).toHaveBeenCalledTimes(1)
  })
})
