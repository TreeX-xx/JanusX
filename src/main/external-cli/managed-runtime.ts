import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { runChecked } from '../platform/process-host'
import { downloadHostAsset } from '../lib/download'
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
  const result = await runChecked(node, ['--version'], { timeoutMs: 15_000 })
  if (result.stdout.trim() !== `v${MANAGED_NODE_VERSION}`) throw new Error('Private Node.js runtime verification failed.')
}

async function verifyRuntime(runtime: string): Promise<void> {
  const node = join(runtime, process.platform === 'win32' ? 'node.exe' : 'bin/node')
  await verifyNode(node)
  const npm = join(runtime, process.platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : 'lib/node_modules/npm/bin/npm-cli.js')
  await readFile(npm)
  const result = await runChecked(node, [npm, '--version'], { timeoutMs: 15_000 })
  if (!/^\d+\.\d+\.\d+$/.test(result.stdout.trim())) throw new Error('Private npm verification failed.')
}

function assertOwned(base: string, target: string): void {
  const child = relative(resolve(base), resolve(target))
  if (!child || child === '..' || child.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(child)) {
    throw new Error('Refusing to modify a runtime path outside the private directory.')
  }
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
    try { await verifyRuntime(paths.runtime); return paths } catch { /* Stage and verify a replacement before touching the damaged runtime. */ }
  }
  const expected = hashes[`${process.platform}-${process.arch}`]
  if (!expected) throw new Error('Automatic Node.js setup is unavailable on this platform. Install Node.js LTS manually, then retry.')
  await mkdir(paths.base, { recursive: true })
  const stage = await mkdtemp(join(paths.base, 'download-'))
  try {
    const platform = process.platform === 'win32' ? 'win' : process.platform
    const folder = `node-v${MANAGED_NODE_VERSION}-${platform}-${process.arch}`
    const archive = `${folder}.${process.platform === 'win32' ? 'zip' : 'tar.gz'}`
    const bytes = await downloadHostAsset(`https://nodejs.org/dist/v${MANAGED_NODE_VERSION}/${archive}`, 160 * 1024 * 1024, AbortSignal.timeout(180_000))
    verifyRuntimeArchive(bytes, expected)
    const file = join(stage, archive)
    await writeFile(file, bytes)
    if (process.platform === 'win32') {
      const quote = (s: string) => `'${s.replace(/'/g, "''")}'`
      await runChecked('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath ${quote(file)} -DestinationPath ${quote(stage)}`], { timeoutMs: 120_000 })
    } else {
      await runChecked('tar', ['-xzf', file, '-C', stage], { timeoutMs: 120_000 })
    }
    const extracted = join(stage, folder)
    await verifyRuntime(extracted)
    const backup = join(stage, 'previous-runtime')
    assertOwned(paths.base, paths.runtime)
    assertOwned(paths.base, backup)
    const replacing = existsSync(paths.runtime)
    if (replacing) await rename(paths.runtime, backup)
    try {
      await rename(extracted, paths.runtime)
    } catch (error) {
      // A failed swap must retain the old runtime, including when files are locked.
      if (replacing) await rename(backup, paths.runtime)
      throw error
    }
    return paths
  } finally {
    // stage is created by mkdtemp directly inside our owned runtime directory.
    assertOwned(paths.base, stage)
    // Keep the backup if restoration failed; a subsequent retry can recover it manually.
    if (!existsSync(join(stage, 'previous-runtime')) || existsSync(paths.node)) await rm(stage, { recursive: true, force: true })
  }
}
