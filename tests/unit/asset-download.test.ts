import { afterEach, expect, it, vi } from 'vitest'
import { downloadHostAsset } from '../../src/main/lib/download'

vi.mock('../../src/main/lib/host-proxy', () => ({ HostProxy: class {
  async start() { return 'http://127.0.0.1:12345' }
  async close() {}
} }))
afterEach(() => vi.unstubAllGlobals())

it.each([404, 410])('reports missing official resources for HTTP %s without leaking the URL', async status => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('missing', { status })))
  await expect(downloadHostAsset('https://example.test/private', 1024, new AbortController().signal))
    .rejects.toThrow(/^DOWNLOAD_NOT_FOUND$/)
})

it('keeps other HTTP failures distinct from a missing resource', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('unavailable', { status: 503 })))
  await expect(downloadHostAsset('https://example.test/private', 1024, new AbortController().signal))
    .rejects.toThrow(/^DOWNLOAD_FAILED$/)
})
