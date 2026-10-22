// Note: .agents/notes/workbench/plugin-contract-v1.md — bounded, non-following reads and snapshots.
import { constants } from 'node:fs'
import * as nodeFiles from 'node:fs/promises'
import { resolve, join, relative, sep, isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
import { parsePluginManifest, PluginError, validatePluginPath, type PluginManifest } from '@janusx/plugin-sdk'

export interface PluginPackage { manifest: PluginManifest; directory: string; digest: string; files: Map<string, Buffer> }
let { lstat, realpath, open, readdir } = nodeFiles
/** Bypass Electron's virtual ASAR paths; plugins contain only ordinary OS files. */
export function configurePluginFileSystem(files: Pick<typeof nodeFiles, 'lstat' | 'realpath' | 'open' | 'readdir'>): void {
  ;({ lstat, realpath, open, readdir } = files)
}
const fail = (code: ConstructorParameters<typeof PluginError>[0], message: string): never => { throw new PluginError(code, message) }
const outside = (root: string, path: string) => { const part = relative(root, path); return isAbsolute(part) || part === '..' || part.startsWith(`..${sep}`) }

export async function readPluginFile(root: string, path: string, limit: number): Promise<Buffer> {
  validatePluginPath(path)
  const canonical = await realpath(root)
  if (canonical !== resolve(root)) fail('RESOURCE_CHANGED', 'Resource root changed.')
  const target = resolve(canonical, path)
  if (outside(canonical, target)) fail('INVALID_PACKAGE_PATH', 'Resource is outside its root.')
  let current = canonical
  for (const segment of path.split('/')) {
    current = join(current, segment)
    const info = await lstat(current).catch(() => fail('FILE_NOT_FOUND', 'Resource is unavailable.'))
    if (info.isSymbolicLink() || outside(canonical, await realpath(current))) fail('INVALID_PACKAGE_PATH', 'Linked resources are unavailable.')
  }
  const file = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch(() => fail('FILE_NOT_FOUND', 'Resource is unavailable.'))
  try {
    const before = await file.stat({ bigint: true })
    if (!before.isFile() || before.nlink !== 1n) fail('INVALID_PACKAGE_PATH', 'Resource must be a regular, unlinked file.')
    if (before.size > BigInt(limit)) fail('FILE_TOO_LARGE', 'Resource exceeds its limit.')
    const buffer = Buffer.alloc(Math.min(Number(before.size) + 1, limit + 1))
    let size = 0
    while (size < buffer.length) {
      const read = await file.read(buffer, size, buffer.length - size, size)
      if (!read.bytesRead) break
      size += read.bytesRead
    }
    const after = await file.stat({ bigint: true })
    const pathInfo = await lstat(target, { bigint: true })
    // Electron 35/Windows lstat.dev is zero even through original-fs. Compare a second
    // opened handle instead, retaining the full 64-bit inode and device identity.
    const verification = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    let sameFile: boolean
    try { const check = await verification.stat({ bigint: true }); sameFile = check.dev === after.dev && check.ino === after.ino }
    finally { await verification.close() }
    if (!sameFile || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs
      || before.ctimeNs !== after.ctimeNs || after.ino !== pathInfo.ino || pathInfo.isSymbolicLink()
      || await realpath(target) !== target || after.nlink !== 1n) fail('RESOURCE_CHANGED', 'Resource changed while reading.')
    // Recheck parent links as well as the opened file before publishing bytes.
    current = canonical
    for (const segment of path.split('/')) {
      current = join(current, segment)
      if ((await lstat(current)).isSymbolicLink() || await realpath(current) !== current) fail('RESOURCE_CHANGED', 'Resource changed while reading.')
    }
    if (size > limit) fail('FILE_TOO_LARGE', 'Resource exceeds its limit.')
    return buffer.subarray(0, size)
  } finally { await file.close() }
}

export async function readPluginPackage(directory: string, expectedRoot?: string): Promise<PluginPackage> {
  const root = await realpath(directory).catch(() => fail('SOURCE_UNAVAILABLE', 'Plugin source is unavailable.'))
  if (expectedRoot && root !== expectedRoot) fail('RESOURCE_CHANGED', 'Registered plugin source root changed.')
  let manifestBytes: Buffer
  try { manifestBytes = await readPluginFile(root, 'manifest.json', 64 * 1024) } catch (error) {
    if (error instanceof PluginError && error.code === 'FILE_TOO_LARGE') fail('PACKAGE_LIMIT_EXCEEDED', 'Manifest exceeds its limit.')
    if (error instanceof PluginError && error.code === 'FILE_NOT_FOUND') fail('MANIFEST_INVALID', 'Manifest is missing.')
    throw error
  }
  let manifest: PluginManifest
  try { manifest = parsePluginManifest(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)) } catch (error) {
    if (error instanceof PluginError) throw error
    fail('MANIFEST_INVALID', 'Manifest must be UTF-8 JSON.')
  }
  const files = new Map<string, Buffer>([['manifest.json', manifestBytes]])
  const names = new Set(['manifest.json'])
  let total = manifestBytes.length
  let nodes = 0
  async function walk(path: string, depth: number): Promise<void> {
    if (depth > 32 || ++nodes > 4000) fail('PACKAGE_LIMIT_EXCEEDED', 'Resource tree exceeds its limit.')
    validatePluginPath(path)
    const info = await lstat(resolve(root, path)).catch(() => fail('ENTRY_NOT_FOUND', 'Build the plugin before importing.'))
    if (info.isSymbolicLink()) fail('INVALID_PACKAGE_PATH', 'Linked resources are unavailable.')
    const lower = path.toLowerCase()
    if (names.has(lower)) fail('INVALID_PACKAGE_PATH', 'Resource paths collide by case.')
    names.add(lower)
    if (info.isDirectory()) {
      for (const entry of await readdir(resolve(root, path))) await walk(`${path}/${entry}`, depth + 1)
      return
    }
    const image = /\.(png|jpe?g|webp|gif|ico)$/.test(path)
    if (!image && !/\.(html|js|mjs|css|json)$/.test(path)) fail('INVALID_PACKAGE_PATH', 'Unsupported resource type.')
    let bytes: Buffer
    try { bytes = await readPluginFile(root, path, (image ? 10 : 5) * 1024 * 1024) } catch (error) {
      if (error instanceof PluginError && error.code === 'FILE_TOO_LARGE') fail('PACKAGE_LIMIT_EXCEEDED', 'Resource exceeds its limit.')
      throw error
    }
    total += bytes.length
    if (files.size >= 2000 || total > 50 * 1024 * 1024) fail('PACKAGE_LIMIT_EXCEEDED', 'Package exceeds its limit.')
    files.set(path, bytes)
  }
  await walk('dist', 0)
  for (const view of manifest!.contributes.views) if (!files.has(view.entry)) fail('ENTRY_NOT_FOUND', 'A declared HTML entry is missing.')
  const hash = createHash('sha256')
  for (const [path, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b))) hash.update(path).update('\0').update(String(bytes.length)).update('\0').update(bytes)
  return { manifest: manifest!, directory: root, digest: hash.digest('hex'), files }
}
