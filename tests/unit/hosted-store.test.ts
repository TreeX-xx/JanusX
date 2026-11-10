import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useHostedStore } from '../../src/renderer/src/stores/hosted'
import { hostedCache } from '../../src/renderer/src/lib/hosted-cache'
import type { HostedConnection } from '../../src/shared/ipc/hosted'

const ready: HostedConnection = { provider: 'github', status: 'ready' }
const connection = vi.fn<() => Promise<HostedConnection>>()
beforeEach(() => {
  useHostedStore.getState().authorized()
  connection.mockReset().mockResolvedValue(ready)
  vi.stubGlobal('window', { electron: { hosted: { connection } } })
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

it('reuses successful connection checks briefly but explicit refresh always checks', async () => {
  vi.useFakeTimers(); vi.setSystemTime(1000)
  await useHostedStore.getState().ensure('/workspace')
  await useHostedStore.getState().ensure('/workspace')
  expect(connection).toHaveBeenCalledTimes(1)
  await useHostedStore.getState().refresh('/workspace')
  expect(connection).toHaveBeenCalledTimes(2)
  vi.setSystemTime(61001)
  await useHostedStore.getState().ensure('/workspace')
  expect(connection).toHaveBeenCalledTimes(3)
})

it('deduplicates connection checks and rejects responses from the previous session', async () => {
  let finish!: (value: HostedConnection) => void
  connection.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const first = useHostedStore.getState().ensure('/workspace')
  expect(useHostedStore.getState().ensure('/workspace')).toBe(first)
  const rejected = expect(first).rejects.toThrow('Authorization session changed')
  useHostedStore.getState().authorized()
  connection.mockResolvedValue({ provider: 'github', status: 'unauthenticated' })
  await useHostedStore.getState().ensure('/workspace')
  finish(ready); await rejected
  expect(useHostedStore.getState().connections['/workspace']?.status).toBe('unauthenticated')
})

it('clears private resources when a connection loses authorization', async () => {
  await useHostedStore.getState().ensure('/workspace')
  hostedCache.set('private', 'body', 1000)
  const revision = useHostedStore.getState().revision
  connection.mockResolvedValue({ provider: 'github', status: 'unauthenticated' })
  await useHostedStore.getState().refresh('/workspace')
  expect(hostedCache.peek('private')).toBeUndefined()
  expect(useHostedStore.getState().revision).toBeGreaterThan(revision)
})
