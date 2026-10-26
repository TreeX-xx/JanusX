import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile, realpath, lstat } from 'node:fs/promises'
import { unlinkSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { resolve, join, relative, isAbsolute } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { readPluginFile } from './files'

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const alive = (pid: unknown) => {
  if (!Number.isSafeInteger(pid) || (pid as number) <= 0) return false
  try { process.kill(pid as number, 0); return true } catch (cause) { return (cause as NodeJS.ErrnoException).code !== 'ESRCH' }
}
function owned(directory: string, path: string): string {
  const root = resolve(directory), target = resolve(path), part = relative(root, target)
  if (!part || part === '..' || part.startsWith('..\\') || part.startsWith('../') || isAbsolute(part)) throw new Error('Package state path is outside its root')
  return target
}
/** SQLite's OS lock coordinates processes and is released by the OS after a crash. */
export async function withPluginPackageLock<T>(directory: string, operation: () => Promise<T>): Promise<T> {
  await mkdir(directory, { recursive: true })
  const lock = new DatabaseSync(owned(directory, join(directory, 'package-lock.sqlite')))
  try {
    lock.exec('PRAGMA busy_timeout=0')
    let acquired = false
    for (let attempt = 0; attempt < 200; attempt++) {
      try { lock.exec('BEGIN IMMEDIATE'); acquired = true; break }
      catch (cause) {
        if (![5, 6].includes((cause as { errcode?: number }).errcode ?? -1)) throw cause
        await delay(50)
      }
    }
    if (!acquired) throw new Error('Plugin packages are busy; retry after the current operation')
    try { return await operation() } finally { lock.exec('ROLLBACK') }
  } finally { lock.close() }
}
/** Caller holds the package lock. The process must keep this lease until its MCP entry exits. */
export async function leasePluginPackage(directory: string, packageDirectory: string): Promise<() => void> {
  const packageId = relative(resolve(directory, 'packages'), resolve(packageDirectory))
  if (!uuid.test(packageId)) throw new Error('Package is not host-owned')
  const leases = owned(directory, join(directory, 'leases', packageId))
  await mkdir(leases, { recursive: true })
  const path = join(leases, randomUUID() + '.json')
  await writeFile(path, JSON.stringify({ pid: process.pid }), { flag: 'wx' })
  let released = false
  return () => { if (!released) { released = true; try { unlinkSync(path) } catch { /* A dead process lease is pruned at the next mutation. */ } } }
}
/** Caller holds the package lock. Unknown or corrupt leases conservatively prevent removal. */
export async function pluginPackageInUse(directory: string, packageDirectory: string): Promise<boolean> {
  const packageId = relative(resolve(directory, 'packages'), resolve(packageDirectory))
  if (!uuid.test(packageId)) throw new Error('Package is not host-owned')
  const leases = owned(directory, join(directory, 'leases', packageId))
  const names = await readdir(leases).catch(cause => { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []; throw cause })
  for (const name of names) {
    if (!uuid.test(name.replace(/\.json$/, ''))) return true
    const path = owned(directory, join(leases, name))
    const lease = await readFile(path, 'utf8').then(JSON.parse).catch(() => null)
    if (!lease || !Number.isSafeInteger(lease.pid) || lease.pid <= 0 || alive(lease.pid)) return true
    await rm(path, { force: true })
  }
  return false
}

/** Include every generation, including those displaced beyond the rollback slot. */
export async function pluginDataInUse(directory: string, pluginId: string): Promise<boolean> {
  const leases = await readdir(join(directory, 'leases')).catch(cause => {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []; throw cause
  })
  for (const packageId of leases) {
    if (!uuid.test(packageId)) return true
    const packageDirectory = owned(directory, join(directory, 'packages', packageId))
    if (!await pluginPackageInUse(directory, packageDirectory)) continue
    const manifest = await readPluginFile(packageDirectory, 'manifest.json', 64 * 1024).then(bytes => JSON.parse(bytes.toString('utf8'))).catch(() => null)
    if (!manifest || typeof manifest.id !== 'string' || manifest.id === pluginId) return true
  }
  return false
}

export const PLUGIN_PACKAGE_STORAGE_LIMIT = 512 * 1024 * 1024

/** Caller holds the package lock. Keep registered versions and all process leases.
 * Only canonical, host-created UUID directories are eligible for collection. */
export async function collectPluginPackages(directory: string, retained: Iterable<string>): Promise<number> {
  const packages = resolve(directory, 'packages'), keep = new Set([...retained].map(path => resolve(path).toLowerCase()))
  const entries = await readdir(packages, { withFileTypes: true }).catch(cause => {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []; throw cause
  })
  const canonicalRoot = await realpath(packages).catch(() => packages)
  let total = 0, files = 0
  const measure = async (path: string): Promise<void> => {
    if (++files > 100_000 || total > PLUGIN_PACKAGE_STORAGE_LIMIT) throw new Error('Plugin package storage budget exceeded')
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) throw new Error('Unexpected link in plugin package storage')
    if (stat.isFile()) total += stat.size
    else if (stat.isDirectory()) for (const entry of await readdir(path)) await measure(join(path, entry))
  }
  for (const entry of entries) {
    if (!uuid.test(entry.name)) continue
    const path = owned(packages, join(packages, entry.name))
    if (!entry.isDirectory() || entry.isSymbolicLink() || relative(canonicalRoot, await realpath(path)) !== entry.name) {
      throw new Error('Unexpected link in plugin package storage')
    }
    if (!keep.has(path.toLowerCase()) && !await pluginPackageInUse(directory, path)) {
      await rm(path, { recursive: true, force: true })
      await rm(owned(directory, join(directory, 'leases', entry.name)), { recursive: true, force: true })
    } else await measure(path)
  }
  return total
}
