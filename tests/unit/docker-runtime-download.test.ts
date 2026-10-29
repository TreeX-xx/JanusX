import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NativePeer } from '@janusx/plugin-sdk/native'
import { rootfsDownloader } from '../../plugins/docker/src/main/runtime-download'
const mock = await vi.hoisted(async () => {
  const { createRequire } = await import('node:module'), { resolve } = await import('node:path')
  return { module: createRequire(resolve('plugins/docker/package.json')).resolve('undici'), fetch: vi.fn(), close: vi.fn(async () => {}), proxy: vi.fn() }
})
vi.mock(mock.module, () => ({ fetch: mock.fetch, ProxyAgent: class { constructor(url: string) { mock.proxy(url) } close = mock.close } }))
const roots: string[] = []
afterEach(async () => { vi.clearAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture(architecture = 'x64') {
  const root = await mkdtemp(join(tmpdir(), 'docker-download-')); roots.push(root)
  const host = { call: vi.fn(async () => 'http://janusx:token@127.0.0.1:12345') }
  return { file: join(root, 'rootfs.tar.gz'), download: rootfsDownloader(host as unknown as NativePeer, architecture), host }
}
describe('managed rootfs download boundary', () => {
  it('rejects altered upstream bytes, removes the partial file, and retains existing data', async () => {
    const f = await fixture(); await writeFile(f.file, 'previous incomplete archive')
    mock.fetch.mockResolvedValue(new Response('tampered rootfs', { headers: { 'content-length': '15' } }))
    await expect(f.download(f.file, new AbortController().signal, () => {})).rejects.toThrow('docker-runtime-checksum-failed')
    expect(await readFile(f.file, 'utf8')).toBe('previous incomplete archive')
    await expect(stat(f.file + '.part')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(mock.fetch).toHaveBeenCalledWith('https://cdimage.ubuntu.com/ubuntu-base/releases/24.04/release/ubuntu-base-24.04.5-base-amd64.tar.gz', expect.objectContaining({ redirect: 'error' }))
    expect(f.host.call).toHaveBeenCalledWith('desktop.proxy', null); expect(mock.close).toHaveBeenCalledOnce()
  })
  it('rejects excessive declared downloads before writing and closes the proxy dispatcher', async () => {
    const f = await fixture()
    mock.fetch.mockResolvedValue(new Response('oversized', { headers: { 'content-length': String(300 * 1024 * 1024) } }))
    await expect(f.download(f.file, new AbortController().signal, () => {})).rejects.toThrow('docker-output-limit')
    await expect(stat(f.file)).rejects.toMatchObject({ code: 'ENOENT' }); expect(mock.close).toHaveBeenCalledOnce()
  })
  it('does not download unsupported architectures', async () => {
    const f = await fixture('ia32')
    await expect(f.download(f.file, new AbortController().signal, () => {})).rejects.toThrow('docker-runtime-unsupported')
    expect(mock.fetch).not.toHaveBeenCalled(); expect(f.host.call).not.toHaveBeenCalled()
  })
})
