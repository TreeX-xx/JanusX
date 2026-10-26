import { createPrivateKey } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { distributionLibrary } from './distribution-library.mjs'

export async function buildCatalog({ releases, sequence, keys, keyId, privateKey, previous, now = Date.now() }) {
  const api = await distributionLibrary()
  if (previous && sequence <= api.verifyPluginCatalog(previous, keys, 0, now, true).sequence) throw new Error('Catalog sequence must increase')
  const envelope = api.signPluginPayload({ schemaVersion: 1, sequence, issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 7 * 86400000).toISOString(), releases }, keyId, createPrivateKey(privateKey))
  api.verifyPluginCatalog(envelope, keys, 0, now)
  return envelope
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [output, sequence, ...releasePaths] = process.argv.slice(2)
  if (!output || !sequence || !releasePaths.length) throw new Error('Usage: node scripts/plugins/build-catalog.mjs OUTPUT SEQUENCE RELEASE_JSON...')
  const trust = JSON.parse(await readFile('plugins/catalog/trust.json', 'utf8'))
  const releases = await Promise.all(releasePaths.map(async path => JSON.parse(await readFile(path, 'utf8'))))
  const previous = process.env.JANUSX_PLUGIN_PREVIOUS_CATALOG ? JSON.parse(await readFile(process.env.JANUSX_PLUGIN_PREVIOUS_CATALOG, 'utf8')) : undefined
  const envelope = await buildCatalog({ releases, sequence: Number(sequence), keys: trust.keys, previous,
    keyId: process.env.JANUSX_PLUGIN_KEY_ID, privateKey: process.env.JANUSX_PLUGIN_SIGNING_KEY })
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, JSON.stringify(envelope, null, 2) + '\n', { flag: 'wx' })
  console.log(`Verified catalog sequence ${sequence}: ${releases.length} plugins`)
}
