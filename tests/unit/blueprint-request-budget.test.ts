import { afterEach, expect, it, vi } from 'vitest'
import { RequestBudget, paceBlueprintApi } from '../../plugins/blueprint/src/ui/request-budget'
import type { PluginApi } from '@janusx/plugin-sdk'

afterEach(() => { vi.useRealTimers() })

it('never submits a queued write from the old worktree after a scope change', async () => {
  vi.useFakeTimers()
  let change: Parameters<PluginApi['context']['subscribe']>[0] = () => {}
  const native = vi.fn(async () => null)
  const api = paceBlueprintApi({ context: { subscribe: async listener => { change = listener; return () => {} } }, native: { call: native } } as unknown as PluginApi)
  await api.context.subscribe(() => {})
  const queued = api.native.call({ method: 'blueprint.layout', input: { canvasLayout: {} } })
  const rejected = expect(queued).rejects.toMatchObject({ code: 'STALE_CONTEXT' })
  change({ transitioning: true })
  change({ transitioning: false })
  await vi.runAllTimersAsync(); await rejected
  expect(native).not.toHaveBeenCalled()
  const fresh = api.native.call({ method: 'workspace.status', input: null })
  await vi.runAllTimersAsync(); await fresh
  expect(native).toHaveBeenCalledTimes(1)
})

it('paces a burst of reads and writes and never replays a failed operation', async () => {
  vi.useFakeTimers()
  const budget = new RequestBudget(), starts: number[] = []
  const writes = vi.fn(async () => { starts.push(Date.now()); throw new Error('RESOURCE_CHANGED') })
  const results = Promise.allSettled(Array.from({ length: 40 }, (_, index) => budget.run(index === 5 ? writes : async () => { starts.push(Date.now()); return index })))
  await vi.runAllTimersAsync()
  expect(starts).toHaveLength(40)
  for (const start of starts) expect(starts.filter(time => time >= start && time < start + 1000).length).toBeLessThanOrEqual(17)
  expect(writes).toHaveBeenCalledTimes(1)
  expect((await results).filter(result => result.status === 'rejected')).toHaveLength(1)
})

it('bounds outstanding work and queue size, and cancels queued writes before submission', async () => {
  vi.useFakeTimers()
  const budget = new RequestBudget(), releases: Array<() => void> = []
  const active = Array.from({ length: 8 }, () => budget.run(() => new Promise<void>(resolve => releases.push(resolve))))
  await vi.advanceTimersByTimeAsync(1000)
  expect(releases).toHaveLength(8)
  const controller = new AbortController(), write = vi.fn(async () => {})
  const cancelled = budget.run(write, controller.signal)
  const cancelledAssertion = expect(cancelled).rejects.toThrow('cancelled')
  controller.abort(new Error('cancelled'))
  await cancelledAssertion
  const queued = Array.from({ length: 64 }, () => budget.run(async () => {}))
  await expect(budget.run(async () => {})).rejects.toMatchObject({ code: 'RATE_LIMITED' })
  expect(write).not.toHaveBeenCalled()
  releases.forEach(release => release())
  await vi.runAllTimersAsync()
  await Promise.all([...active, ...queued])
  expect(write).not.toHaveBeenCalled()
})

it('shares one budget across native calls and persisted drafts and passes cancellation through', async () => {
  vi.useFakeTimers()
  const starts: number[] = [], controller = new AbortController()
  const native = vi.fn(async () => { starts.push(Date.now()); return null })
  const storage = vi.fn(async () => { starts.push(Date.now()); return { revision: 1 } })
  const raw = { native: { call: native }, storage: { set: storage } } as unknown as PluginApi
  const api = paceBlueprintApi(raw)
  const requests = Array.from({ length: 20 }, (_, index) => index % 2
    ? api.native.call({ method: 'notes.read', input: null }, { signal: controller.signal })
    : api.storage.set({ key: 'draft', value: 'keep', expectedRevision: 0 }))
  await vi.runAllTimersAsync()
  await Promise.all(requests)
  expect(new Set(starts).size).toBe(20)
  expect(native).toHaveBeenCalledWith({ method: 'notes.read', input: null }, { signal: controller.signal })
  expect(storage).toHaveBeenCalledWith({ key: 'draft', value: 'keep', expectedRevision: 0 }, undefined)
})
