import { afterEach, expect, it, vi } from 'vitest'
import { HostedCache, hostedKey } from '../../src/renderer/src/lib/hosted-cache'
afterEach(() => vi.useRealTimers())

it('reuses fresh values, retains stale data and deduplicates overlapping forced reads', async () => {
  vi.useFakeTimers(); vi.setSystemTime(1000)
  const cache = new HostedCache()
  const loader = vi.fn().mockResolvedValue('first')
  expect(await cache.load('key', loader, 100)).toBe('first')
  await cache.load('key', loader, 100)
  expect(loader).toHaveBeenCalledTimes(1)
  vi.setSystemTime(1101)
  expect(cache.peek('key')).toBe('first')
  expect(cache.fresh('key')).toBe(false)
  let finish!: (value: string) => void
  const read = vi.fn(() => new Promise<string>(resolve => { finish = resolve }))
  const a = cache.load('key', read, 100, true)
  const b = cache.load('key', read, 100, true)
  expect(a).toBe(b)
  await Promise.resolve(); finish('second')
  expect(await a).toBe('second')
  expect(read).toHaveBeenCalledTimes(1)
})

it('keeps the last successful value when refresh fails and retries errors', async () => {
  const cache = new HostedCache()
  cache.set('key', 'saved', 1000)
  const loader = vi.fn().mockRejectedValue(new Error('offline'))
  await expect(cache.load('key', loader, 100, true)).rejects.toThrow('offline')
  expect(cache.peek('key')).toBe('saved')
  await expect(cache.load('key', loader, 100, true)).rejects.toThrow()
  expect(loader).toHaveBeenCalledTimes(2)
})

it('prevents reads from an old authorization session from repopulating the cache', async () => {
  const cache = new HostedCache()
  let finish!: (value: string) => void
  const old = cache.load('key', () => new Promise<string>(resolve => { finish = resolve }), 100)
  const rejected = expect(old).rejects.toThrow('superseded')
  await Promise.resolve(); cache.clear()
  await cache.load('key', async () => 'new account', 100)
  finish('old account'); await rejected
  expect(cache.peek('key')).toBe('new account')
})

it('invalidates pre-mutation reads while retaining unaffected resources', async () => {
  const cache = new HostedCache()
  cache.set('image', 'image', 100)
  let finish!: (value: string) => void
  const old = cache.load('detail', () => new Promise<string>(resolve => { finish = resolve }), 100)
  const rejected = expect(old).rejects.toThrow('superseded')
  await Promise.resolve(); cache.invalidate(key => key === 'detail')
  cache.set('detail', 'edited', 100)
  finish('before edit'); await rejected
  expect(cache.peek('detail')).toBe('edited')
  expect(cache.peek('image')).toBe('image')
})

it('bounds entries and bytes with least-recently-used eviction', () => {
  const cache = new HostedCache(2, 100)
  cache.set('a', 'small', 100); cache.set('b', 'small', 100)
  cache.peek('a'); cache.set('c', 'small', 100)
  expect(cache.peek('b')).toBeUndefined()
  expect(cache.peek('a')).toBe('small')
  cache.set('large', 'x'.repeat(100), 100)
  expect(cache.peek('large')).toBeUndefined()
  const bytes = new HostedCache(10, 24)
  bytes.set('a', '12345', 100); bytes.set('b', '12345', 100)
  expect(bytes.peek('a')).toBeUndefined()
  expect(bytes.peek('b')).toBe('12345')
})

it('isolates workspaces, repository identities, queries and page numbers', () => {
  const target = { workspacePath: '/one', repositoryKey: 'github:org/repo' }
  const keys = [hostedKey(target, 'list', { kind: 'issue', page: 1 }), hostedKey(target, 'list', { kind: 'review', page: 1 }), hostedKey(target, 'list', { kind: 'issue', page: 2 }), hostedKey({ ...target, workspacePath: '/two' }, 'list', { kind: 'issue', page: 1 }), hostedKey({ ...target, repositoryKey: 'github:org/other' }, 'list', { kind: 'issue', page: 1 })]
  expect(new Set(keys).size).toBe(keys.length)
})

it('clears authorized data on 401 without treating a transport failure as logout', async () => {
  const cache = new HostedCache()
  cache.onAuthFailure = vi.fn(() => cache.clear())
  cache.set('image', 'private', 1000)
  await expect(cache.load('detail', async () => { throw Error('timeout') }, 100)).rejects.toThrow()
  expect(cache.onAuthFailure).not.toHaveBeenCalled()
  await expect(cache.load('detail', async () => { throw Error('HTTP 401 Unauthorized') }, 100)).rejects.toThrow()
  expect(cache.onAuthFailure).toHaveBeenCalledTimes(1)
  expect(cache.peek('image')).toBeUndefined()
})
