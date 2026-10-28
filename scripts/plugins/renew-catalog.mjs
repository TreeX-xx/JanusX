// Dependency-free so the scheduled catalog renewal never installs application packages.
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function renewCatalog(envelope, { keys, keyId, privateKey, now = Date.now() }) {
  const key = createPrivateKey(privateKey)
  if (key.asymmetricKeyType !== 'ed25519' || !Object.hasOwn(keys, keyId)
    || !createPublicKey(keys[keyId]).equals(createPublicKey(key))) throw new Error('Signing key does not match pinned identity')
  const decode = signed => {
    if (!signed || !Object.hasOwn(keys, signed.keyId) || !verify(null, Buffer.from(signed.payload, 'base64'),
      createPublicKey(keys[signed.keyId]), Buffer.from(signed.signature, 'base64'))) throw new Error('Invalid catalog or release signature')
    return JSON.parse(Buffer.from(signed.payload, 'base64').toString('utf8'))
  }
  const catalog = decode(envelope)
  if (catalog.schemaVersion !== 1 || !Number.isSafeInteger(catalog.sequence) || catalog.sequence < 0
    || !Array.isArray(catalog.releases) || !catalog.releases.length || catalog.releases.length > 500
    || !Number.isFinite(Date.parse(catalog.issuedAt)) || Date.parse(catalog.issuedAt) > now
    || !(Date.parse(catalog.expiresAt) > Date.parse(catalog.issuedAt))) throw new Error('Invalid catalog metadata')
  for (const release of catalog.releases) decode(release)
  // Keep authenticated release bytes exactly unchanged; renew only sequence and dates.
  const sequence = Math.max(catalog.sequence + 1, Math.floor(now / 1000))
  if (!Number.isSafeInteger(sequence)) throw new Error('Catalog sequence exhausted')
  const payload = Buffer.from(JSON.stringify({ ...catalog, sequence, issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 7 * 86400000).toISOString() }))
  return { keyId, payload: payload.toString('base64'), signature: sign(null, payload, key).toString('base64') }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [catalogPath, trustPath = 'plugins/catalog/trust.json'] = process.argv.slice(2)
  if (!catalogPath) throw new Error('Usage: renew-catalog.mjs CATALOG_JSON [TRUST_JSON]')
  const trust = JSON.parse(await readFile(trustPath, 'utf8'))
  const renewed = renewCatalog(JSON.parse(await readFile(catalogPath, 'utf8')), { keys: trust.keys,
    keyId: process.env.JANUSX_PLUGIN_KEY_ID, privateKey: process.env.JANUSX_PLUGIN_SIGNING_KEY })
  await writeFile(catalogPath, JSON.stringify(renewed, null, 2) + '\n')
  console.log('Renewed authenticated catalog for seven days; release metadata unchanged.')
}
