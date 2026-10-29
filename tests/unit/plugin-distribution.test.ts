import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import {
  assertPluginCompatibility, decodePluginArchive, encodePluginArchive, pluginContentDigest,
  signPluginPayload, verifyPluginCatalog, verifyPluginRelease, type PluginRelease,
  decodeSignedPluginPackage, encodeSignedPluginPackage, pluginDownloadBytes, SIGNED_PACKAGE_LIMIT,
} from '../../src/main/plugins/distribution/package'
import { readPluginImport } from '../../src/main/plugins/distribution/import'
import { PluginDistributionService } from '../../src/main/plugins/distribution/service'
import { PluginService, type PluginServiceDeps } from '../../src/main/plugins/service'
import { NativePluginService } from '../../src/main/plugins/native-service'
import type { NativePacket } from '../../packages/plugin-sdk/src/native-protocol'

const pair = generateKeyPairSync('ed25519')
const keys = { release: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() }
const signer = (value: unknown) => signPluginPayload(value, 'release', pair.privateKey)
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const cleanups: Array<() => void | Promise<unknown>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function serviceFixture(overrides: Partial<PluginServiceDeps> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'janus-official-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const deps = { directory, official: { keys, hostVersion: '0.9.4', platform: 'win32-x64' },
    resolveProject: async () => ({ root: directory, name: 'fixture' }), changed() {}, event() {}, openView() {}, toast() {}, ...overrides }
  const create = async () => { const service = new PluginService(deps); cleanups.push(() => service.dispose()); await service.initialize(); return service }
  return { directory, create, service: await create() }
}
async function fixture() {
  const manifest = JSON.parse(await readFile('packages/plugin-sdk/template/manifest.json', 'utf8'))
  const files = new Map<string, Buffer>([['manifest.json', Buffer.from(JSON.stringify(manifest))]])
  for (const view of manifest.contributes.views) files.set(view.entry, Buffer.from('<p>offline plugin</p>'))
  const archive = await encodePluginArchive(files)
  const release: PluginRelease = {
    schemaVersion: 1, id: manifest.id, name: manifest.name, description: '', publisher: 'JanusX', version: manifest.version,
    host: '>=0.9.4 <1.0.0', pluginApi: manifest.engines.pluginApi, platforms: ['win32-x64'],
    url: 'https://example.com/plugin.jxp', bytes: archive.length, sha256: sha(archive), contentDigest: pluginContentDigest(files),
  }
  return { manifest, files, archive, release }
}

describe('official plugin distribution boundary', () => {
  it('installs one self-contained file offline and downloads the identical file through the catalog', async () => {
    const f = await fixture()
    const release = { ...f.release, packageFormat: 'jxp/2' as const }
    const signed = signer(release)
    const bytes = encodeSignedPluginPackage(f.archive, signed)
    expect(bytes.length).toBe(pluginDownloadBytes(release, signed))
    const local = await serviceFixture(), online = await serviceFixture()
    const path = join(local.directory, 'plugin.jxp')
    await writeFile(path, bytes)
    await local.service.installPackage(await readPluginImport(path))
    expect(local.service.snapshot()).toMatchObject({ developmentMode: false, plugins: [{ enabled: false, source: { kind: 'official' }, manifest: { id: f.manifest.id } }] })
    const download = vi.fn(async (url: string, limit: number) => {
      if (url === release.url) { expect(limit).toBe(bytes.length); return bytes }
      return Buffer.from(JSON.stringify(signer({ schemaVersion: 1, sequence: 1, issuedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), releases: [signed] })))
    })
    const distribution = new PluginDistributionService({ directory: online.directory, keys, hostVersion: '0.9.4', platform: 'win32-x64',
      catalogUrl: 'https://example.com/catalog.json', download, install: (bytes, envelope) => online.service.installOfficial(bytes, envelope), changed() {} })
    cleanups.push(() => distribution.dispose())
    await distribution.install(f.manifest.id)
    expect(online.service.snapshot().plugins[0].digest).toBe(local.service.snapshot().plugins[0].digest)
    expect(distribution.snapshot().entries[0].bytes).toBe(bytes.length)
    expect(download).toHaveBeenCalledTimes(2)
  })
  it('rejects damaged, untrusted and incompatible imports without replacing the installed plugin', async () => {
    const f = await fixture(), host = await serviceFixture()
    const signed = signer({ ...f.release, packageFormat: 'jxp/2' })
    const bytes = encodeSignedPluginPackage(f.archive, signed)
    await host.service.installPackage(bytes)
    const before = host.service.snapshot().plugins
    const corrupted = Buffer.from(bytes); corrupted[corrupted.length - 1] ^= 1
    const invalidSignature = encodeSignedPluginPackage(f.archive, { ...signed, signature: 'A'.repeat(86) + '==' })
    const otherSigner = encodeSignedPluginPackage(f.archive, { ...signed, keyId: 'unknown' })
    const incompatible = encodeSignedPluginPackage(f.archive, signer({ ...f.release, packageFormat: 'jxp/2', host: '^9.0.0' }))
    for (const [input, code] of [[corrupted, 'INVALID_PACKAGE'], [bytes.subarray(0, 10), 'INVALID_PACKAGE'], [invalidSignature, 'INVALID_SIGNATURE'], [otherSigner, 'INVALID_SIGNATURE'], [incompatible, 'INCOMPATIBLE_PLUGIN']] as const) {
      await expect(host.service.installPackage(input)).rejects.toThrow(code)
      expect(host.service.snapshot().plugins).toEqual(before)
    }
    await expect(host.service.installPackage(f.archive)).rejects.toThrow('INVALID_PACKAGE')
    const oversizedHeader = Buffer.from(bytes); oversizedHeader.writeUInt32BE(0xffffffff, Buffer.byteLength('JANUSX-PLUGIN/2\n'))
    expect(() => decodeSignedPluginPackage(oversizedHeader)).toThrow('INVALID_PACKAGE')
    await expect(host.service.installOfficial(bytes, signer({ ...f.release, packageFormat: 'jxp/2', publisher: 'Different' }))).rejects.toThrow('metadata differs')
    expect(host.service.snapshot().plugins).toEqual(before)
  })
  it('bounds local file reads and reports missing or empty package files', async () => {
    const host = await serviceFixture(), path = join(host.directory, 'large.jxp')
    const file = await open(path, 'w')
    try { await file.truncate(SIGNED_PACKAGE_LIMIT + 1) } finally { await file.close() }
    await expect(readPluginImport(path)).rejects.toThrow('INVALID_PACKAGE')
    await writeFile(path, '')
    await expect(readPluginImport(path)).rejects.toThrow('INVALID_PACKAGE')
    await expect(readPluginImport(path + '.missing')).rejects.toThrow('PACKAGE_READ_FAILED')
  })
  it('updates offline only after stopping and keeps the prior signed version available for rollback', async () => {
    const f = await fixture(), host = await serviceFixture()
    await host.service.installPackage(encodeSignedPluginPackage(f.archive, signer({ ...f.release, packageFormat: 'jxp/2' })))
    await host.service.enable(f.manifest.id, [])
    f.manifest.version = '1.2.3'
    f.files.set('manifest.json', Buffer.from(JSON.stringify(f.manifest)))
    const archive = await encodePluginArchive(f.files)
    const bytes = encodeSignedPluginPackage(archive, signer({ ...f.release, version: '1.2.3', packageFormat: 'jxp/2',
      bytes: archive.length, sha256: sha(archive), contentDigest: pluginContentDigest(f.files) }))
    await expect(host.service.installPackage(bytes)).rejects.toThrow('Disable the plugin')
    await host.service.disable(f.manifest.id)
    await host.service.installPackage(bytes)
    expect(host.service.snapshot().plugins[0]).toMatchObject({ enabled: false, manifest: { version: '1.2.3' } })
    await host.service.rollback(f.manifest.id)
    expect(host.service.snapshot().plugins[0]).toMatchObject({ enabled: false, manifest: { version: f.release.version } })
  })
  it('requires a separately pinned native signer and enablement, then accepts every registered project', async () => {
    const f = await fixture()
    f.manifest.native = { entry: 'dist/service.cjs', dataVersion: 1, methods: ['echo'] }
    f.manifest.capabilities.required.push('runtime.native')
    f.manifest.permissions.push({ name: 'runtime.native' })
    f.files.set('manifest.json', Buffer.from(JSON.stringify(f.manifest)))
    f.files.set('dist/service.cjs', Buffer.from('module.exports = {}'))
    const archive = await encodePluginArchive(f.files)
    const signed = signer({ ...f.release, packageFormat: 'jxp/2', bytes: archive.length, sha256: sha(archive), contentDigest: pluginContentDigest(f.files) })
    const packaged = encodeSignedPluginPackage(archive, signed)
    const denied = await serviceFixture()
    await expect(denied.service.installPackage(packaged)).rejects.toThrow('explicitly trusted plugin')
    expect(denied.service.snapshot().plugins).toEqual([])
    const createNativeService = vi.fn((_record, _directory, stopped) => new NativePluginService({ host: async () => null, stopped,
      spawn() {
        let listener: (packet: unknown) => void = () => {}
        return { listen: callback => { listener = callback; return () => {} }, exited: () => () => {}, terminate() {},
          send(packet: NativePacket) { if (packet.type === 'request') queueMicrotask(() => listener({ protocol: 1, generation: packet.generation, type: 'result', id: packet.id, value: packet.value })) } }
      } }))
    const host = await serviceFixture({ official: { keys, nativePlugins: { [f.manifest.id]: ['release'] }, hostVersion: '0.9.4', platform: 'win32-x64' }, createNativeService,
      resolveProject: async id => {
        if (id === 'missing') throw new Error('Project is not registered')
        return { root: tmpdir(), name: id }
      } })
    await host.service.installPackage(packaged)
    expect(createNativeService).not.toHaveBeenCalled()
    await host.service.enable(f.manifest.id, ['allowed'])
    expect(createNativeService).toHaveBeenCalledTimes(1)
    expect(await host.service.nativeCall(f.manifest.id, 'echo', 'input', 'allowed')).toMatchObject({ input: 'input', project: { id: 'allowed' } })
    expect(await host.service.nativeCall(f.manifest.id, 'echo', null, 'other')).toMatchObject({ project: { id: 'other' } })
    await expect(host.service.nativeCall(f.manifest.id, 'echo', null, 'missing')).rejects.toThrow('Project is not registered')
    await expect(host.service.nativeCall(f.manifest.id, 'undeclared', null)).rejects.toThrow('Native method is not declared')
    await host.service.disable(f.manifest.id)
    await expect(host.service.nativeCall(f.manifest.id, 'echo', null)).rejects.toThrow('Plugin is disabled')
    f.manifest.version = '2.0.0'; f.manifest.native.dataVersion = 2
    f.files.set('manifest.json', Buffer.from(JSON.stringify(f.manifest)))
    const incompatible = await encodePluginArchive(f.files)
    await expect(host.service.installOfficial(incompatible, signer({ ...f.release, version: '2.0.0', bytes: incompatible.length, sha256: sha(incompatible), contentDigest: pluginContentDigest(f.files) }))).rejects.toThrow('supported data migration')
    expect(host.service.snapshot().plugins[0].manifest.version).toBe(f.release.version)
  })
  it('installs and runs without development mode, revalidates on restart, and preserves official activation when development is disabled', async () => {
    const f = await fixture(); const host = await serviceFixture()
    await host.service.installOfficial(f.archive, signer(f.release))
    expect(host.service.snapshot().plugins[0]).toMatchObject({ enabled: false, source: { kind: 'official', publisher: 'JanusX' } })
    await host.service.enable(f.manifest.id, [])
    await host.service.setDevelopment(false)
    expect(host.service.snapshot().plugins[0]).toMatchObject({ enabled: true, state: 'ready' })
    host.service.dispose()
    const restored = await host.create()
    expect(restored.snapshot().plugins[0]).toMatchObject({ enabled: true, state: 'ready' })
    expect(restored.snapshot().plugins[0]).not.toHaveProperty('release')
    expect(restored.snapshot().plugins[0]).not.toHaveProperty('previous')
  })
  it('blocks altered installed bytes and rejects forged official registry entries', async () => {
    const f = await fixture(); const host = await serviceFixture()
    await host.service.installOfficial(f.archive, signer(f.release))
    await host.service.enable(f.manifest.id, [])
    const directory = host.service.snapshot().plugins[0].source.directory
    await writeFile(join(directory, f.manifest.contributes.views[0].entry), 'tampered')
    await expect(host.service.enable(f.manifest.id, [])).rejects.toThrow('Official package no longer matches')
    host.service.dispose()
    expect((await host.create()).snapshot().plugins[0].state).toBe('error')
    const registry = JSON.parse(await readFile(join(host.directory, 'registry.json'), 'utf8'))
    delete registry.plugins[0].release
    await writeFile(join(host.directory, 'registry.json'), JSON.stringify(registry))
    expect((await host.create()).snapshot().plugins[0].state).toBe('error')
  })
  it('requires a stopped plugin for update, retains data, and restores a verified previous package', async () => {
    const f = await fixture(); const host = await serviceFixture()
    await host.service.installOfficial(f.archive, signer(f.release))
    await host.service.enable(f.manifest.id, [])
    await expect(host.service.installOfficial(f.archive, signer(f.release))).rejects.toThrow('Disable the plugin')
    await host.service.disable(f.manifest.id)
    const oldDirectory = host.service.snapshot().plugins[0].source.directory
    f.manifest.version = '1.2.3'
    f.files.set('manifest.json', Buffer.from(JSON.stringify(f.manifest)))
    const archive = await encodePluginArchive(f.files)
    const release = { ...f.release, version: '1.2.3', bytes: archive.length, sha256: sha(archive), contentDigest: pluginContentDigest(f.files) }
    await host.service.installOfficial(archive, signer(release))
    expect(host.service.snapshot().plugins[0].manifest.version).toBe('1.2.3')
    await host.service.rollback(f.manifest.id)
    expect(host.service.snapshot().plugins[0]).toMatchObject({ enabled: false, manifest: { version: f.release.version }, source: { directory: oldDirectory } })
    await host.service.enable(f.manifest.id, [])
    await host.service.uninstall(f.manifest.id)
    expect(host.service.snapshot().plugins).toEqual([])
  })
  it('verifies exact signed metadata and round-trips a real SDK package', async () => {
    const f = await fixture()
    const release = verifyPluginRelease(signer(f.release), keys)
    assertPluginCompatibility(release, '0.9.4', '1.0.0', 'win32-x64')
    const unpacked = await decodePluginArchive(f.archive, release)
    expect(unpacked.manifest.id).toBe(f.manifest.id)
    expect(unpacked.files).toEqual(f.files)
  })
  it('rejects tampered metadata, unknown signers, prototype key names and unsigned identity claims', async () => {
    const f = await fixture()
    const signed = signer(f.release)
    expect(() => verifyPluginRelease({ ...signed, payload: Buffer.from(JSON.stringify({ ...f.release, publisher: 'Other' })).toString('base64') }, keys)).toThrow('INVALID_SIGNATURE')
    expect(() => verifyPluginRelease({ ...signed, keyId: '__proto__' }, keys)).toThrow('INVALID_SIGNATURE')
    expect(() => verifyPluginRelease(signed, {})).toThrow('INVALID_SIGNATURE')
    expect(() => verifyPluginRelease(f.release, keys)).toThrow('INVALID_SIGNATURE')
  })
  it('rejects corrupt bytes and package substitution even with a matching download hash', async () => {
    const f = await fixture()
    const corrupt = Buffer.from(f.archive); corrupt[corrupt.length - 1] ^= 1
    await expect(decodePluginArchive(corrupt, f.release)).rejects.toThrow('INVALID_PACKAGE')
    await expect(decodePluginArchive(f.archive, { ...f.release, id: 'different.plugin' })).rejects.toThrow('INVALID_PACKAGE')
    await expect(decodePluginArchive(f.archive, { ...f.release, contentDigest: '0'.repeat(64) })).rejects.toThrow('INVALID_PACKAGE')
  })
  it.each(['../escape.js', '/root.js', 'dist/../escape.js', 'dist/con.js', 'dist/foo:bar.js', 'dist/a.js/child.js', 'dist/INDEX.html'])('rejects unsafe or colliding resource %s before extraction', async path => {
    const f = await fixture()
    f.files.set('dist/a.js', Buffer.from('a'))
    f.files.set('dist/index.html', Buffer.from('page'))
    f.files.set(path, Buffer.from('bad'))
    const archive = gzipSync(JSON.stringify({ format: 'janusx-plugin/1', files: [...f.files].map(([name, bytes]) => [name, bytes.toString('base64')]) }))
    await expect(decodePluginArchive(archive, { ...f.release, bytes: archive.length, sha256: sha(archive), contentDigest: pluginContentDigest(f.files) })).rejects.toThrow('INVALID_PACKAGE')
  })
  it('rejects duplicate files and a declared entry missing from the archive', async () => {
    const f = await fixture()
    const entries = [...f.files].map(([name, bytes]) => [name, bytes.toString('base64')])
    const archive = gzipSync(JSON.stringify({ format: 'janusx-plugin/1', files: [...entries, entries[0]] }))
    await expect(decodePluginArchive(archive, { ...f.release, bytes: archive.length, sha256: sha(archive) })).rejects.toThrow('INVALID_PACKAGE')
    f.files.delete(f.manifest.contributes.views[0].entry)
    await expect(encodePluginArchive(f.files)).rejects.toThrow('INVALID_PACKAGE')
  })
  it('enforces host/API/platform compatibility before activation', async () => {
    const { release } = await fixture()
    for (const [host, api, platform] of [['0.8.0', '1.0.0', 'win32-x64'], ['1.0.0', '1.0.0', 'win32-x64'], ['0.9.4', '9.0.0', 'win32-x64'], ['0.9.4', '1.0.0', 'linux-x64']]) {
      expect(() => assertPluginCompatibility(release, host, api, platform)).toThrow('INCOMPATIBLE_PLUGIN')
    }
  })
  it('rejects expired, future, rolled back and conflicting signed catalogs', async () => {
    const f = await fixture()
    const now = Date.parse('2026-10-24T09:00:00Z')
    const catalog = { schemaVersion: 1, sequence: 3, issuedAt: '2026-10-24T08:00:00Z', expiresAt: '2026-10-25T08:00:00Z', releases: [signer(f.release)] }
    expect(verifyPluginCatalog(signer(catalog), keys, 3, now).releases[0].release.id).toBe(f.manifest.id)
    expect(() => verifyPluginCatalog(signer(catalog), keys, 4, now)).toThrow('CATALOG_ROLLBACK')
    expect(() => verifyPluginCatalog(signer(catalog), keys, 3, now + 2 * 86400000)).toThrow('CATALOG_EXPIRED')
    expect(() => verifyPluginCatalog(signer(catalog), keys, 3, now - 86400000)).toThrow('CATALOG_EXPIRED')
    expect(() => verifyPluginCatalog(signer({ ...catalog, releases: [...catalog.releases, ...catalog.releases] }), keys, 3, now)).toThrow('INVALID_PACKAGE')
  })
})
