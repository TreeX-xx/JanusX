// Note: .agents/notes/desktop/officecli-bundled.md
import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const officecliRelease = JSON.parse(await readFile(new URL('../src/shared/officecli-release.json', import.meta.url), 'utf8'))
const projectRoot = fileURLToPath(new URL('../', import.meta.url))

export function officecliResource({ platform = process.platform, arch = process.arch, root = projectRoot } = {}) {
  const key = `${platform}-${arch}`
  if (!Object.hasOwn(officecliRelease.targets, key)) throw new Error(`Bundled OfficeCLI is unsupported on ${platform}/${arch}; build x64 or arm64 separately on Windows or macOS.`)
  const target = officecliRelease.targets[key]
  return {
    ...target, platform, arch,
    binary: join(root, 'resources', 'officecli', target.path),
    url: `https://github.com/iOfficeAI/OfficeCLI/releases/download/v${officecliRelease.version}/${target.asset}`,
  }
}

function verifyBytes(bytes, resource) {
  if (createHash('sha256').update(bytes).digest('hex') !== resource.sha256) {
    throw new Error(`Bundled OfficeCLI SHA256 mismatch: expected ${officecliRelease.version} (${resource.platform}/${resource.arch}) at ${resource.binary}`)
  }
}

export async function checkOfficecliResource(options = {}) {
  const resource = officecliResource(options)
  let bytes
  try { bytes = await readFile(resource.binary) }
  catch (error) {
    if (error.code !== 'ENOENT') throw error
    throw new Error(`Missing ${resource.binary}. Run npm run officecli:prepare -- --platform ${resource.platform} --arch ${resource.arch}; see resources/officecli/README.md.`)
  }
  verifyBytes(bytes, resource)
  return resource
}

export async function prepareOfficecliResource(options = {}, fetchAsset = fetch) {
  const resource = officecliResource(options)
  // Reuse only the exact pinned bytes; a failed download never replaces a local file.
  const verified = await checkOfficecliResource(options).catch(() => undefined)
  if (!verified) {
    const response = await fetchAsset(resource.url, { signal: AbortSignal.timeout(120_000) })
    if (!response.ok) throw new Error(`OfficeCLI download failed: HTTP ${response.status} (${resource.url})`)
    const bytes = Buffer.from(await response.arrayBuffer())
    verifyBytes(bytes, resource)
    await mkdir(dirname(resource.binary), { recursive: true })
    const temporary = `${resource.binary}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, bytes, { flag: 'wx', mode: 0o755 })
      await rename(temporary, resource.binary)
    } finally {
      await rm(temporary, { force: true })
    }
  }
  if (resource.platform === 'darwin') await chmod(resource.binary, 0o755)
  return resource
}
