import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { prepareBlueprintDevelopment } from '../../scripts/plugins/blueprint-dev.mjs'
import { distributionLibrary } from '../../scripts/plugins/distribution-library.mjs'

test('local rebuilds create increasing signed versions and retain the profile, signing identity and source manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'blueprint-local-'))
  try {
    const plugin = join(root, 'plugins/blueprint')
    await mkdir(join(plugin, 'dist/ui'), { recursive: true })
    const catalog = join(root, 'plugins/catalog')
    await mkdir(catalog, { recursive: true })
    const productionTrust = '{"catalogUrl":"https://example.test/catalog","keys":{},"nativePlugins":{}}\n'
    await writeFile(join(catalog, 'trust.json'), productionTrust)
    const manifest = await readFile(resolve('plugins/blueprint/manifest.json'), 'utf8')
    await writeFile(join(plugin, 'manifest.json'), manifest)
    await writeFile(join(plugin, 'dist/service.cjs'), 'exports.local = true')
    await writeFile(join(plugin, 'dist/note-mcp.cjs'), 'exports.local = true')
    await writeFile(join(plugin, 'dist/ui/index.html'), '<title>Local Blueprint</title>')
    const first = await prepareBlueprintDevelopment(root)
    await writeFile(join(first.profile, 'keep.txt'), 'User settings')
    const second = await prepareBlueprintDevelopment(root)
    assert.equal(first.version, '1.0.0-local.1')
    assert.equal(second.version, '1.0.0-local.2')
    assert.equal(second.profile, first.profile)
    assert.equal(await readFile(join(second.profile, 'keep.txt'), 'utf8'), 'User settings')
    assert.equal(await readFile(join(plugin, 'manifest.json'), 'utf8'), manifest)
    assert.equal(await readFile(join(catalog, 'trust.json'), 'utf8'), productionTrust)
    const trust = JSON.parse(await readFile(join(root, '.cache/blueprint-local/trust.json'), 'utf8'))
    const api = await distributionLibrary()
    for (const build of [first, second]) {
      const release = api.verifyPluginRelease(JSON.parse(await readFile(build.release, 'utf8')), trust.keys)
      const decoded = await api.decodePluginArchive(api.decodeSignedPluginPackage(await readFile(build.archive)).archive, release)
      assert.equal(decoded.manifest.version, build.version)
    }
    assert.deepEqual(trust.nativePlugins, { 'official.blueprint': ['blueprint-local'] })
    assert.equal(trust.catalogUrl, '')
  } finally { await rm(root, { recursive: true, force: true }) }
})
