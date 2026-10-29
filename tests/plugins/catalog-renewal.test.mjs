import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { renewCatalog } from '../../scripts/plugins/renew-catalog.mjs'
import { distributionLibrary } from '../../scripts/plugins/distribution-library.mjs'

test('renewal revives an expired signed catalog with increasing sequence and untouched releases', async () => {
  const api = await distributionLibrary()
  const pair = generateKeyPairSync('ed25519')
  const keys = { test: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() }
  const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const release = api.signPluginPayload({ schemaVersion: 1, id: 'test.plugin', name: 'Test', description: '', version: '1.0.0', publisher: 'JanusX',
    host: '^0.9.6', pluginApi: '^1.0.0', platforms: ['win32-x64'], url: 'https://example.test/plugin.jxp', bytes: 10,
    sha256: '1'.repeat(64), contentDigest: '2'.repeat(64) }, 'test', pair.privateKey)
  const now = Date.now()
  const previous = api.signPluginPayload({ schemaVersion: 1, sequence: Math.floor(now / 1000) + 5,
    issuedAt: new Date(now - 90000).toISOString(), expiresAt: new Date(now - 1000).toISOString(), releases: [release] }, 'test', pair.privateKey)
  const options = { keys, keyId: 'test', privateKey, now }
  const renewed = renewCatalog(previous, options)
  const checked = api.verifyPluginCatalog(renewed, keys, Math.floor(now / 1000) + 6, now)
  assert.equal(checked.expiresAt, new Date(now + 7 * 86400000).toISOString())
  assert.deepEqual(checked.releases[0].envelope, release)
  assert.throws(() => renewCatalog({ ...previous, signature: 'bad' }, options), /signature/)
  assert.throws(() => renewCatalog(previous, { ...options, keyId: 'unknown' }), /pinned/)
  const tampered = api.signPluginPayload({ schemaVersion: 1, sequence: 1, issuedAt: new Date(now - 1000).toISOString(),
    expiresAt: new Date(now + 1000).toISOString(), releases: [{ ...release, signature: 'bad' }] }, 'test', pair.privateKey)
  assert.throws(() => renewCatalog(tampered, options), /signature/)
})
