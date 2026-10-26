import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { packagePlugin } from '../../scripts/plugins/package-plugin.mjs'
import { buildCatalog } from '../../scripts/plugins/build-catalog.mjs'
import { distributionLibrary } from '../../scripts/plugins/distribution-library.mjs'

test('release tools produce host-verifiable artifacts and enforce pinned signing identity and monotonic catalog', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'janus-release-tools-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const pair = generateKeyPairSync('ed25519')
  const keys = { fixture: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() }
  const signing = { keyId: 'fixture', privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), keys }
  const manifest = JSON.parse(await readFile('packages/plugin-sdk/template/manifest.json', 'utf8'))
  await mkdir(join(directory, 'dist'))
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest))
  for (const view of manifest.contributes.views) await writeFile(join(directory, view.entry), '<p>release fixture</p>')
  const input = { directory, output: join(directory, 'output'), publisher: 'JanusX', host: '^0.9.4',
    url: 'https://example.test/release.jxp', platforms: ['win32-x64'], ...signing }
  await assert.rejects(packagePlugin({ ...input, keys: {} }), /Signing key/)
  const built = await packagePlugin(input)
  const api = await distributionLibrary()
  const release = api.verifyPluginRelease(built.signed, keys)
  const archive = await readFile(join(input.output, `${built.basename}.jxp`))
  const contained = api.decodeSignedPluginPackage(archive)
  assert.deepEqual(contained.envelope, built.signed)
  assert.equal(api.pluginDownloadBytes(release, built.signed), archive.length)
  assert.equal((await api.decodePluginArchive(contained.archive, api.verifyPluginRelease(contained.envelope, keys))).manifest.id, manifest.id)
  await assert.rejects(packagePlugin(input), /EEXIST/)
  const first = await buildCatalog({ ...signing, releases: [built.signed], sequence: 1 })
  assert.equal(api.verifyPluginCatalog(first, keys).releases[0].release.id, manifest.id)
  await assert.rejects(buildCatalog({ ...signing, releases: [built.signed], sequence: 1, previous: first }), /must increase/)
  const next = await buildCatalog({ ...signing, releases: [built.signed], sequence: 2, previous: first })
  assert.equal(api.verifyPluginCatalog(next, keys, 2).sequence, 2)
  await assert.rejects(buildCatalog({ ...signing, releases: [built.signed, built.signed], sequence: 3 }), /INVALID_PACKAGE/)
})
