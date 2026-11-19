import { execFileSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import semver from 'semver'
import { distributionLibrary } from './distribution-library.mjs'
import { packagePlugin } from './package-plugin.mjs'

const repository = fileURLToPath(new URL('../../', import.meta.url))
const macArchitectures = ['arm64', 'x64']
const readJson = async path => JSON.parse(await readFile(path, 'utf8'))

async function main() {
  const { values, positionals } = parseArgs({
    options: { 'release-tag': { type: 'string' }, arch: { type: 'string', multiple: true } }, allowPositionals: true,
  })
  const releaseTag = values['release-tag']
  const architectures = values.arch ?? (releaseTag ? [process.arch] : macArchitectures)
  if (positionals.length > 1 || (releaseTag !== undefined && (!releaseTag.startsWith('v') || !semver.valid(releaseTag)))
    || architectures.some(arch => !macArchitectures.includes(arch))) {
    throw new Error('Usage: npm run plugins:package:mac -- [OUTPUT_ROOT] [--release-tag vX.Y.Z] [--arch arm64|x64]')
  }
  const buildPlatform = `${process.platform}-${process.arch}`
  if (process.platform !== 'darwin' || !macArchitectures.includes(process.arch)) {
    throw new Error('Run this command on macOS with an arm64 or x64 Node.js runtime.')
  }
  const macPlatforms = [...new Set(architectures)].map(arch => `darwin-${arch}`)
  const { npm_execpath: npm, JANUSX_PLUGIN_SIGNING_KEY: releaseKey, JANUSX_PLUGIN_KEY_ID: releaseKeyId, ...buildEnv } = process.env
  if (!npm) throw new Error('Run this command with npm run plugins:package:mac.')

  const run = (args, env = buildEnv) => execFileSync(process.execPath, [npm, ...args], {
    cwd: repository, env, stdio: 'inherit',
  })
  run(['run', 'build:plugin-sdk'])
  run(['run', 'build:llm-core'])
  const { PLUGIN_API_VERSION } = await import('@janusx/plugin-sdk')
  const { version: hostVersion } = await readJson(join(repository, 'package.json'))
  const api = await distributionLibrary()

  // A release.json can already point at the candidate. Compare it with the
  // signed public catalog to prevent repackaging an existing plugin version.
  const catalogPath = process.env.JANUSX_PLUGIN_PREVIOUS_CATALOG
  let previousCatalog
  if (releaseTag && catalogPath) {
    const { keys } = await readJson(join(repository, 'plugins/catalog/trust.json'))
    previousCatalog = api.verifyPluginCatalog(await readJson(catalogPath), keys, 0, Date.now(), true)
  }

  const plugins = await Promise.all(['blueprint', 'cpa', 'docker', 'superagent'].map(async name => {
    const directory = join(repository, 'plugins', name)
    const manifest = await readJson(join(directory, 'manifest.json'))
    const metadata = await readJson(join(directory, 'release.json'))
    const filename = `${manifest.id}-${manifest.version}.jxp`
    if (!releaseTag) return { directory, manifest, metadata: {
      ...metadata, publisher: 'Local macOS test build', platforms: macPlatforms, url: `https://local.invalid/${filename}`,
    } }

    const publishedUrl = new URL(metadata.url)
    const publishedVersion = previousCatalog
      ? previousCatalog.releases.find(({ release }) => release.id === manifest.id)?.release.version
      : metadata.firstRelease === manifest.version ? undefined : basename(publishedUrl.pathname).slice(manifest.id.length + 1, -4)
    if (publishedVersion && !semver.gt(manifest.version, publishedVersion)) {
      throw new Error(`Increase ${name}'s manifest and package version above the published ${publishedVersion} before release signing.`)
    }
    const url = new URL(`../${releaseTag}/${filename}`, publishedUrl).href
    const platforms = [...new Set([...metadata.platforms, ...macPlatforms])]
    return { directory, manifest, metadata: { ...metadata, url, platforms } }
  }))

  const keyId = releaseTag ? releaseKeyId : 'mac-package-test'
  let trust, privateKey
  if (releaseTag) {
    trust = await readJson(join(repository, 'plugins/catalog/trust.json'))
    if (!releaseKey || !keyId || plugins.some(({ manifest }) => !trust.nativePlugins[manifest.id]?.includes(keyId))) {
      throw new Error('Set JANUSX_PLUGIN_KEY_ID and JANUSX_PLUGIN_SIGNING_KEY for a trusted official plugin signer.')
    }
    privateKey = releaseKey
  } else {
    const testKey = generateKeyPairSync('ed25519')
    privateKey = testKey.privateKey.export({ type: 'pkcs8', format: 'pem' })
    trust = { catalogUrl: '', keys: { [keyId]: testKey.publicKey.export({ type: 'spki', format: 'pem' }) },
      nativePlugins: Object.fromEntries(plugins.map(({ manifest }) => [manifest.id, [keyId]])) }
  }

  const outputRoot = resolve(positionals[0] ?? join(repository, 'artifacts/plugins/macos'))
  await mkdir(outputRoot, { recursive: true })
  const output = await mkdtemp(join(outputRoot, releaseTag ? 'release-' : 'test-'))
  const staging = join(output, 'build')
  try {
    for (const { directory, manifest, metadata } of plugins) {
      const buildRoot = join(staging, manifest.id)
      run(['run', 'build', '--prefix', directory], { ...buildEnv, JANUSX_PLUGIN_BUILD_ROOT: buildRoot })
      await writeFile(join(buildRoot, 'manifest.json'), JSON.stringify(manifest))
      const { basename: artifact } = await packagePlugin({
        ...metadata, directory: buildRoot, output, keyId, privateKey, keys: trust.keys,
      })
      const bytes = await readFile(join(output, `${artifact}.jxp`))
      const { archive, envelope } = api.decodeSignedPluginPackage(bytes)
      const verified = api.verifyPluginRelease(envelope, trust.keys)
      for (const platform of macPlatforms) api.assertPluginCompatibility(verified, hostVersion, PLUGIN_API_VERSION, platform)
      await api.decodePluginArchive(archive, verified)
      console.log(`Verified ${artifact}.jxp (${bytes.length} bytes, ${verified.platforms.join(', ')})`)
    }
    if (!releaseTag) await writeFile(join(output, 'trust.json'), JSON.stringify(trust, null, 2) + '\n')
    await rm(staging, { recursive: true })
  } catch (cause) {
    await rm(output, { recursive: true, force: true })
    throw cause
  }
  console.log(`${releaseTag ? 'Release-signed' : 'Test-signed'} plugin packages built on ${buildPlatform}: ${output}`)
}

main().catch(cause => {
  console.error(cause instanceof Error ? cause.message : String(cause))
  process.exitCode = 1
})
