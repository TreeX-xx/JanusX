import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PluginDistributionService, type PluginDownload } from '../../src/main/plugins/distribution/service'
import { signPluginPayload, type PluginRelease } from '../../src/main/plugins/distribution/package'

const pair = generateKeyPairSync('ed25519')
const keys = { test: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() }
const sign = (value: unknown) => signPluginPayload(value, 'test', pair.privateKey)
const release: PluginRelease = { schemaVersion: 1, id: 'test.catalog', name: 'Catalog test', description: '', version: '1.0.0',
  publisher: 'JanusX', host: '^0.9.4', pluginApi: '^1.0.0', platforms: ['win32-x64'], url: 'https://example.test/plugin.jxp',
  bytes: 10, sha256: '1'.repeat(64), contentDigest: '2'.repeat(64) }
const catalog = (sequence: number, expiry = Date.now() + 60_000, releases = [sign(release)]) => sign({ schemaVersion: 1, sequence,
  issuedAt: new Date(Date.now() - 120_000).toISOString(), expiresAt: new Date(expiry).toISOString(), releases })
const cleanups: Array<() => unknown> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'janus-catalog-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const changed = vi.fn(), install = vi.fn(async () => {})
  const download = vi.fn<PluginDownload>(async () => Buffer.from(JSON.stringify(catalog(1))))
  const deps = { directory, keys, catalogUrl: 'https://example.test/catalog.json', hostVersion: '0.9.4', platform: 'win32-x64', download, install, changed }
  const service = new PluginDistributionService(deps)
  cleanups.push(() => service.dispose())
  await service.initialize()
  return { service, directory, deps, download, install, changed }
}

describe('official catalog lifecycle', () => {
  it('downloads only metadata on refresh and exposes compatibility without acquiring packages', async () => {
    const f = await fixture()
    await f.service.refresh()
    expect(f.download).toHaveBeenCalledTimes(1)
    expect(f.install).not.toHaveBeenCalled()
    expect(f.service.snapshot().entries[0]).toMatchObject({ id: release.id, compatible: true, bytes: 10 })
    f.download.mockResolvedValue(Buffer.from(JSON.stringify(catalog(2, undefined, [sign({ ...release, host: '^9.0.0' })]))))
    await f.service.refresh()
    expect(f.service.snapshot().entries[0].compatible).toBe(false)
    await expect(f.service.install(release.id)).rejects.toThrow('INCOMPATIBLE_PLUGIN')
    expect(f.install).not.toHaveBeenCalled()
  })
  it('keeps authenticated sequence across restarts even when cache has expired', async () => {
    const f = await fixture()
    await writeFile(join(f.directory, 'catalog.json'), JSON.stringify({ sequence: 0, envelope: catalog(9, Date.now() - 1000) }))
    const service = new PluginDistributionService(f.deps)
    await service.initialize()
    expect(service.snapshot()).toMatchObject({ expired: true, entries: [{ id: release.id }] })
    await expect(service.refresh()).rejects.toThrow('CATALOG_ROLLBACK')
    expect(service.snapshot().entries).toHaveLength(1)
    f.download.mockResolvedValue(Buffer.from(JSON.stringify(catalog(10))))
    await service.refresh()
    expect(service.snapshot().expired).toBe(false)
    service.dispose()
  })
  it('rejects mutated same-sequence catalogs and ambiguous plugin versions', async () => {
    const f = await fixture()
    await f.service.refresh()
    f.download.mockResolvedValue(Buffer.from(JSON.stringify(catalog(1, undefined, []))))
    await expect(f.service.refresh()).rejects.toThrow('CATALOG_ROLLBACK')
    f.download.mockResolvedValue(Buffer.from(JSON.stringify(catalog(2, undefined, [sign(release), sign({ ...release, version: '2.0.0' })]))))
    await expect(f.service.refresh()).rejects.toThrow('INVALID_PACKAGE')
    expect(f.service.snapshot().entries).toHaveLength(1)
  })
  it('preserves an offline catalog and sanitizes network exceptions in snapshots', async () => {
    const f = await fixture()
    await f.service.refresh()
    f.download.mockRejectedValue(new Error('https://user:password@example.test/secret'))
    await expect(f.service.refresh()).rejects.toThrow()
    expect(f.service.snapshot()).toMatchObject({ error: 'CATALOG_UNAVAILABLE', entries: [{ id: release.id }] })
    expect(f.changed).toHaveBeenCalledTimes(2)
    await expect(f.service.install(release.id)).rejects.toThrow('INSTALLATION_FAILED')
    expect(f.install).not.toHaveBeenCalled()
  })
  it('cancels a live download and rejects overlapping installs without altering installed state', async () => {
    const f = await fixture()
    let started!: () => void
    const downloading = new Promise<void>(resolve => { started = resolve })
    f.download.mockImplementation(async (url, _limit, signal, progress) => {
      if (url.endsWith('catalog.json')) return Buffer.from(JSON.stringify(catalog(1)))
      progress?.(35)
      started()
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    })
    const pending = f.service.install(release.id)
    const cancelled = expect(pending).rejects.toThrow('INSTALLATION_CANCELLED')
    await downloading
    expect(f.service.snapshot().operation).toMatchObject({ id: release.id, percent: 35, phase: 'downloading' })
    await expect(f.service.install(release.id)).rejects.toThrow('INSTALLATION_BUSY')
    f.service.cancel()
    await cancelled
    expect(f.service.snapshot().operation).toBeUndefined()
    expect(f.install).not.toHaveBeenCalled()
  })
  it('finishes the atomic installation phase even if cancellation is requested', async () => {
    const f = await fixture()
    const envelope = catalog(1)
    f.download.mockImplementation(async url => url.endsWith('catalog.json') ? Buffer.from(JSON.stringify(envelope)) : Buffer.alloc(10))
    f.install.mockImplementation(async () => {
      expect(f.service.snapshot().operation?.phase).toBe('installing')
      f.service.cancel()
    })
    await f.service.install(release.id)
    expect(f.install).toHaveBeenCalledTimes(1)
    expect(f.service.snapshot()).toMatchObject({ error: undefined, operation: undefined })
  })
  it('does not install on invalid signatures, expired metadata or catalog persistence failure', async () => {
    const f = await fixture()
    f.download.mockResolvedValue(Buffer.from(JSON.stringify({ ...catalog(1), signature: 'A'.repeat(86) + '==' })))
    await expect(f.service.install(release.id)).rejects.toThrow('INVALID_SIGNATURE')
    f.download.mockResolvedValue(Buffer.from(JSON.stringify(catalog(1, Date.now() - 1000))))
    await expect(f.service.install(release.id)).rejects.toThrow('CATALOG_EXPIRED')
    f.download.mockResolvedValue(Buffer.from(JSON.stringify(catalog(1))))
    await mkdir(join(f.directory, 'catalog.json'))
    await expect(f.service.install(release.id)).rejects.toThrow('INSTALLATION_FAILED')
    expect(f.service.snapshot().entries).toEqual([])
    expect(f.install).not.toHaveBeenCalled()
  })
  it('fails closed without a trusted signer and after shutdown', async () => {
    const f = await fixture()
    const service = new PluginDistributionService({ ...f.deps, keys: {} })
    expect(service.snapshot().configured).toBe(false)
    await expect(service.refresh()).rejects.toThrow('DISTRIBUTION_NOT_CONFIGURED')
    expect(f.download).not.toHaveBeenCalled()
    service.dispose()
    await expect(service.install(release.id)).rejects.toThrow('INSTALLATION_CANCELLED')
  })
})
