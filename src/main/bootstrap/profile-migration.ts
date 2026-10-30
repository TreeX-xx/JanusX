import { createHash } from 'node:crypto'
import {
  closeSync, constants, copyFileSync, existsSync, lstatSync, mkdirSync, openSync,
  readFileSync, readSync, readdirSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

// Only disposable Electron/Chromium artifacts are excluded. In particular,
// Local Storage, IndexedDB, Cookies and browser partitions must survive.
const DISPOSABLE_ROOTS = new Set(['logs', 'Crashpad', 'Crash Reports', 'DawnCache', 'GPUCache', 'ShaderCache', 'Cache', 'Code Cache', 'SingletonLock', 'SingletonSocket', 'SingletonCookie', 'lockfile'])
const CHROMIUM_CACHES = new Set(['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'GrShaderCache', 'ShaderCache', 'DawnGraphiteCache', 'DawnWebGPUCache'])

function isDisposable(path: string): boolean {
  const parts = path.split(sep)
  if (DISPOSABLE_ROOTS.has(parts[0])) return true
  if (parts[0] === 'janusx' && parts[1] === 'logs') return true
  if (parts.length === 1 && /^\.janusx-write-test-\d+$/.test(parts[0])) return true
  // Chromium puts persistent partitions below chromium-session/Partitions.
  return parts[0] === 'chromium-session' && (
    (parts.length >= 2 && CHROMIUM_CACHES.has(parts[1]))
    || (parts[1] === 'Partitions' && parts.length >= 4 && CHROMIUM_CACHES.has(parts[3]))
  )
}

function isInside(root: string, path: string): boolean {
  const child = relative(root, path)
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
}

function samePath(first: string, second: string): boolean {
  return process.platform === 'win32' ? first.toLowerCase() === second.toLowerCase() : first === second
}

function digest(path: string): string {
  const hash = createHash('sha256')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  const fd = openSync(path, 'r')
  try {
    let count: number
    while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count))
    return hash.digest('hex')
  } finally { closeSync(fd) }
}

interface LegacyFile { path: string; hash: string | null; size: number; modified: number }

function relocatedConfig(source: string, target: string): Buffer | undefined {
  const path = join(source, 'janusx', 'config.json')
  if (!existsSync(path)) return
  const document = JSON.parse(readFileSync(path, 'utf8'))
  let changed = false
  for (const settings of [document?.knowledgeSettings?.automation?.local]) {
    if (!settings) continue
    for (const key of ['serverPath', 'modelPath']) {
      const value = settings[key]
      if (typeof value === 'string' && isAbsolute(value) && isInside(source, resolve(value))) {
        settings[key] = join(target, relative(source, resolve(value)))
        changed = true
      }
    }
  }
  return changed ? Buffer.from(JSON.stringify(document, null, 2)) : undefined
}

/** Run before any application store is opened, under the new profile's lock.
 * Unknown files are preserved; links are rejected rather than followed/deleted.
 * All durable files are copied and verified before any legacy file is removed.
 */
export function migrateLegacyPortableProfile(portableRoot: string, destination: string): void {
  const source = resolve(portableRoot, 'data')
  if (!existsSync(source)) return
  const target = resolve(destination)
  if (samePath(source, target) || isInside(source, target) || isInside(target, source)) {
    throw new Error('Legacy and current application profiles must not overlap')
  }
  const rootStat = lstatSync(source)
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory() || !samePath(realpathSync(source), source)) {
    throw new Error(`Legacy profile is not a regular directory: ${source}`)
  }
  // An arbitrary folder named "data" beside a downloaded exe is not ours.
  const receiptPath = join(target, '.legacy-profile-migrations', `${createHash('sha256').update(source).digest('hex')}.json`)
  let imported: Record<string, string | null> = {}
  try { imported = JSON.parse(readFileSync(receiptPath, 'utf8')) as Record<string, string | null> } catch { /* first import */ }
  const identity = join(source, 'janusx')
  if ((!existsSync(identity) || !lstatSync(identity).isDirectory() || lstatSync(identity).isSymbolicLink()) && Object.keys(imported).length === 0) return

  const files: LegacyFile[] = []
  const directories: string[] = []
  function inventory(directory: string): void {
    directories.push(relative(source, directory))
    for (const entry of readdirSync(directory)) {
      const absolute = join(directory, entry)
      const path = relative(source, absolute)
      const stat = lstatSync(absolute)
      if (stat.isSymbolicLink()) throw new Error(`Legacy profile contains a link; retain it for manual recovery: ${absolute}`)
      if (stat.isDirectory()) inventory(absolute)
      else if (stat.isFile()) files.push({ path, hash: isDisposable(path) ? null : digest(absolute), size: stat.size, modified: stat.mtimeMs })
      else throw new Error(`Unsupported legacy profile entry: ${absolute}`)
    }
  }
  inventory(source)
  const config = relocatedConfig(source, target)
  function outputHash(file: LegacyFile): string | null {
    return config && file.path === join('janusx', 'config.json')
      ? createHash('sha256').update(config).digest('hex') : file.hash
  }

  mkdirSync(target, { recursive: true })
  // Refuse redirected destinations, including a junction in a parent path.
  if (!samePath(realpathSync(target), target)) throw new Error(`Application profile contains a redirected path: ${target}`)
  function checkTarget(path: string): void {
    let current = target
    for (const part of path.split(sep)) {
      current = join(current, part)
      if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
        throw new Error(`Application profile contains a link: ${current}`)
      }
    }
  }
  // Preflight every conflict before copying, never overwrite the user's newer state.
  for (const file of files) {
    if (file.hash === null || imported[file.path] === file.hash) continue
    checkTarget(file.path)
    const output = join(target, file.path)
    if (existsSync(output) && (!lstatSync(output).isFile() || digest(output) !== outputHash(file))) {
      throw new Error(`Profile conflict; both copies were retained: ${output}`)
    }
  }
  for (const path of directories) {
    if (path && !isDisposable(path)) {
      checkTarget(path)
      mkdirSync(join(target, path), { recursive: true })
    }
  }
  for (const file of files) {
    if (file.hash === null || imported[file.path] === file.hash) continue
    const output = join(target, file.path)
    mkdirSync(dirname(output), { recursive: true })
    if (!existsSync(output)) {
      // Publish only a complete copy; an interrupted copy can be retried.
      const temporary = `${output}.janusx-migrating`
      if (existsSync(temporary)) throw new Error(`Unfinished profile copy; retain it for recovery: ${temporary}`)
      try {
        if (config && file.path === join('janusx', 'config.json')) writeFileSync(temporary, config, { flag: 'wx' })
        else copyFileSync(join(source, file.path), temporary, constants.COPYFILE_EXCL)
        if (digest(temporary) !== outputHash(file)) throw new Error(`Profile copy verification failed: ${temporary}`)
        renameSync(temporary, output)
      } finally {
        if (existsSync(temporary)) unlinkSync(temporary)
      }
    }
    if (digest(output) !== outputHash(file)) throw new Error(`Profile copy verification failed: ${output}`)
  }
  // Re-inventory before deletion: a running older build may still be writing.
  const originalFiles = JSON.stringify(files)
  const originalDirectories = JSON.stringify(directories)
  files.length = 0
  directories.length = 0
  inventory(source)
  if (JSON.stringify(files) !== originalFiles || JSON.stringify(directories) !== originalDirectories) {
    throw new Error('Legacy profile changed during migration. Close older JanusX instances and retry.')
  }
  // Persist verified imports before cleanup. A later launch must not resurrect
  // deleted data or replace newer settings when a read-only old copy remains.
  imported = { ...imported, ...Object.fromEntries(files.map(file => [file.path, file.hash])) }
  checkTarget(relative(target, receiptPath))
  mkdirSync(dirname(receiptPath), { recursive: true })
  const receiptTemp = `${receiptPath}.tmp`
  checkTarget(relative(target, receiptTemp))
  writeFileSync(receiptTemp, JSON.stringify(imported))
  renameSync(receiptTemp, receiptPath)
  // Cleanup is best effort, never a reason to abandon the verified user profile.
  // Remove individual verified files, then empty directories; never recursively
  // remove an arbitrary "data" directory or any newly arrived file.
  for (const file of files) {
    try {
      const original = join(source, file.path)
      if (lstatSync(original).isSymbolicLink() || !samePath(realpathSync(original), original)) continue
      if (file.hash !== null && digest(original) !== file.hash) continue
      unlinkSync(original)
    } catch (error) {
      console.warn('[profile] Could not clean legacy file:', join(source, file.path), error)
    }
  }
  for (const path of directories.reverse()) {
    try { rmdirSync(join(source, path)) } catch { /* nonempty or read-only: retain */ }
  }
}
