import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { execa } from 'execa'
import { MANAGED_NODE_VERSION, managedCliPaths } from './managed-paths'

// Pinned together from https://nodejs.org/dist/v24.22.2/SHASUMS256.txt.
const hashes: Record<string, string> = {
  'win32-x64': 'ca1bff5d8ead13c9f2ea404a176db46bd430704d5b5113734049fa365e7799e2',
  'win32-arm64': 'f47968c213105077f64c6510f007632c0ca2574802a0b5067c327c49abe1c468',
  'darwin-x64': 'd5e336d588c45be0c37dbd52cc29895593009ca4997a77a1fd02815131ed0e52',
  'darwin-arm64': 'aa9549349e47dffaa42dcf95d6e06ade8c4bdafc980979883b88767670df385a',
  'linux-x64': '361718c444e49af2ca5a110c83ba6a8901143f23ab285ebbef0341f391f482a9',
  'linux-arm64': '95c264150aceb7f3437a29fd6984924f5f8d1511ea3cbd6c508b83f6c555dae2',
}

export function verifyRuntimeArchive(bytes: Uint8Array, expected: string): void {
  if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('Node.js download checksum mismatch. Retry the download.')
}

async function verifyNode(node: string): Promise<void> {
  const result = await execa(node, ['--version'], { timeout: 15_000, windowsHide: true })
  if (result.stdout.trim() !== `v${MANAGED_NODE_VERSION}`) throw new Error('Private Node.js runtime verification failed.')
}

const preparing = new Map<string, Promise<ReturnType<typeof managedCliPaths>>>()

export function ensureManagedRuntime(root?: string): Promise<ReturnType<typeof managedCliPaths>> {
  const paths = managedCliPaths(root)
  const existing = preparing.get(paths.base)
  if (existing) return existing
  const pending = prepare(paths).finally(() => preparing.delete(paths.base))
  preparing.set(paths.base, pending)
  return pending
}

async function prepare(paths: ReturnType<typeof managedCliPaths>) {
  if (existsSync(paths.node) && existsSync(paths.npm)) {
    await verifyNode(paths.node)
    return paths
  }
  const expected = hashes[`${process.platform}-${process.arch}`]
  if (!expected) throw new Error('Automatic Node.js setup is unavailable on this platform. Install Node.js LTS manually, then retry.')
  await mkdir(paths.base, { recursive: true })
  const stage = await mkdtemp(join(paths.base, 'download-'))
  try {
    const platform = process.platform === 'win32' ? 'win' : process.platform
    const folder = `node-v${MANAGED_NODE_VERSION}-${platform}-${process.arch}`
    const archive = `${folder}.${process.platform === 'win32' ? 'zip' : 'tar.gz'}`
    const response = await fetch(`https://nodejs.org/dist/v${MANAGED_NODE_VERSION}/${archive}`, { signal: AbortSignal.timeout(120_000) })
    if (!response.ok) throw new Error(`Node.js download failed (${response.status}). Check your connection and retry.`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    verifyRuntimeArchive(bytes, expected)
    const file = join(stage, archive)
    await writeFile(file, bytes)
    if (process.platform === 'win32') {
      const quote = (s: string) => `'${s.replace(/'/g, "''")}'`
      await execa('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath ${quote(file)} -DestinationPath ${quote(stage)}`], { windowsHide: true, timeout: 120_000 })
    } else {
      await execa('tar', ['-xzf', file, '-C', stage], { timeout: 120_000 })
    }
    const extracted = join(stage, folder)
    const bin = process.platform === 'win32' ? extracted : join(extracted, 'bin')
    await verifyNode(join(bin, process.platform === 'win32' ? 'node.exe' : 'node'))
    // The archive must include npm, not just the standalone Node binary.
    await readFile(join(extracted, process.platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : 'lib/node_modules/npm/bin/npm-cli.js'))
    if (existsSync(paths.runtime)) throw new Error('The private runtime is incomplete. Install Node.js LTS manually and retry.')
    await rename(extracted, paths.runtime)
    return paths
  } finally {
    // stage is created by mkdtemp directly inside our owned runtime directory.
    await rm(stage, { recursive: true, force: true })
  }
}
