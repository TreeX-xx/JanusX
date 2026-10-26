import { createHash, createPrivateKey, createPublicKey } from 'node:crypto'
import { lstat, readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { distributionLibrary } from './distribution-library.mjs'

export async function packagePlugin({ directory, output, url, publisher, host, platforms, keyId, privateKey, keys }) {
  const api = await distributionLibrary()
  const key = createPrivateKey(privateKey)
  if (key.asymmetricKeyType !== 'ed25519' || !Object.hasOwn(keys, keyId)
    || !createPublicKey(keys[keyId]).equals(createPublicKey(key))) throw new Error('Signing key does not match the pinned public key')
  const files = new Map()
  let total = 0
  const visit = async path => {
    const absolute = join(directory, path)
    const stat = await lstat(absolute)
    if (stat.isSymbolicLink()) throw new Error('Package links are forbidden')
    if (path.split('/').length > 33) throw new Error('Package path exceeds depth budget')
    if (stat.isDirectory()) {
      for (const name of (await readdir(absolute)).sort()) await visit(`${path}/${name}`)
    } else {
      if (!stat.isFile() || stat.nlink !== 1 || files.size >= 2000 || (total += stat.size) > api.PACKAGE_LIMIT) throw new Error('Package exceeds resource budget')
      files.set(path, await readFile(absolute))
    }
  }
  await visit('manifest.json'); await visit('dist')
  const manifest = JSON.parse(files.get('manifest.json').toString('utf8'))
  const archive = await api.encodePluginArchive(files)
  const release = api.releaseSchema.parse({ schemaVersion: 1, id: manifest.id, name: manifest.name, description: manifest.description ?? '',
    version: manifest.version, publisher, host, pluginApi: manifest.engines.pluginApi, platforms, url,
    packageFormat: 'jxp/2', bytes: archive.length, sha256: createHash('sha256').update(archive).digest('hex'), contentDigest: api.pluginContentDigest(files) })
  const signed = api.signPluginPayload(release, keyId, key)
  await api.decodePluginArchive(archive, api.verifyPluginRelease(signed, keys))
  const packaged = api.encodeSignedPluginPackage(archive, signed)
  await mkdir(output, { recursive: true })
  const basename = `${manifest.id}-${manifest.version}`
  // Never overwrite published version material. Run each release build in an empty output directory.
  await writeFile(join(output, `${basename}.jxp`), packaged, { flag: 'wx' })
  await writeFile(join(output, `${basename}.release.json`), JSON.stringify(signed, null, 2) + '\n', { flag: 'wx' })
  return { basename, release, signed, bytes: packaged.length }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [directory, output] = process.argv.slice(2)
  if (!directory || !output) throw new Error('Usage: node scripts/plugins/package-plugin.mjs PLUGIN_DIRECTORY OUTPUT_DIRECTORY')
  const trust = JSON.parse(await readFile('plugins/catalog/trust.json', 'utf8'))
  const metadata = JSON.parse(await readFile(join(directory, 'release.json'), 'utf8'))
  const result = await packagePlugin({ directory, output, ...metadata, keys: trust.keys, keyId: process.env.JANUSX_PLUGIN_KEY_ID,
    privateKey: process.env.JANUSX_PLUGIN_SIGNING_KEY })
  console.log(`Verified signed package: ${result.basename}.jxp (${result.bytes} bytes). The release JSON is for catalog publishing only.`)
}
