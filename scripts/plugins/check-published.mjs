// Verify the actual public bytes using the host's signature and package verifier.
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { distributionLibrary } from './distribution-library.mjs'

const trust = JSON.parse(await readFile('plugins/catalog/trust.json', 'utf8'))
const api = await distributionLibrary()
async function download(url, limit) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`Public resource returned HTTP ${response.status}: ${url}`)
  const chunks = []; let length = 0
  for await (const chunk of response.body) {
    length += chunk.length
    if (length > limit) throw new Error('Public resource exceeds size limit')
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}
const catalog = api.verifyPluginCatalog(JSON.parse((await download(trust.catalogUrl, 2 * 1024 * 1024)).toString('utf8')), trust.keys)
if (!catalog.releases.length) throw new Error('Published catalog contains no plugins')
for (const { release, envelope } of catalog.releases) {
  const bytes = await download(release.url, api.pluginDownloadBytes(release, envelope))
  const contained = api.decodeSignedPluginPackage(bytes)
  const verified = api.verifyPluginRelease(contained.envelope, trust.keys)
  if (JSON.stringify(verified) !== JSON.stringify(release)) throw new Error('Published package metadata differs from catalog')
  await api.decodePluginArchive(contained.archive, verified)
  console.log(JSON.stringify({ id: release.id, version: release.version, bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), sequence: catalog.sequence, expiresAt: catalog.expiresAt }))
}
