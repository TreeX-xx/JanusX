// Refresh materialized sibling packages using npm's own publication file list.
// Note: entry — see .agents/notes/terminal/command-error-self-heal-parity.md
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyEnginePackages } from './verify-engine-packages.mjs'

import { prepareEngineDirectoryReads } from './engine-directory-reads.mjs'

export function runNpm(args, root, options = {}) {
  const cli = process.env.npm_execpath || join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
  if (!existsSync(cli)) throw new Error('Run this command through npm run prepackage so npm_execpath is available.')
  return execFileSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options })
}

const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
function filesUnder(directory, prefix = '') {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (!prefix && entry.name === 'node_modules') return []
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    return entry.isDirectory() ? filesUnder(join(directory, entry.name), path) : [path]
  }).sort()
}

function publishedPath(root, path) {
  const result = resolve(root, path)
  const inside = relative(root, result)
  if (isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`)) throw new Error(`Unsafe publication path: ${path}`)
  return result
}

export function packageMatches(source, installed, files) {
  if (!existsSync(installed) || lstatSync(installed).isSymbolicLink()) return false
  const expected = files.map(({ path }) => path).sort()
  const actual = filesUnder(installed)
  if (JSON.stringify(expected) !== JSON.stringify(actual)) return false
  return expected.every((path) => {
    const target = publishedPath(installed, path)
    return !lstatSync(target).isSymbolicLink() && hash(publishedPath(source, path)) === hash(target)
  })
}

export function preparePackage(root = process.cwd(), { npm = runNpm, installArgs = [] } = {}) {
  root = resolve(root)
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const engineReferences = Object.entries(manifest.dependencies ?? {}).filter(([name]) => name.startsWith('@janus-agent/'))
  if (engineReferences.length && engineReferences.every(([, reference]) => reference.endsWith('.tgz'))) {
    prepareEngineDirectoryReads(root)
    return verifyEnginePackages(root, manifest.dependencies)
  }
  const siblings = Object.entries(manifest.dependencies ?? {}).filter(([name]) => name.startsWith('@janus-agent/')).map(([name, reference]) => {
    if (!/^@janus-agent\/[a-z0-9][a-z0-9._-]*$/.test(name)) throw new Error(`Invalid sibling package name: ${name}`)
    if (!reference.startsWith('file:')) throw new Error(`${name} must be a local file: package`)
    const source = resolve(root, reference.slice(5))
    const packagePath = join(source, 'package.json')
    if (!existsSync(packagePath)) throw new Error(`Missing sibling package ${name}: ${source}. Restore and build janus-agentX first.`)
    const pkg = JSON.parse(readFileSync(packagePath, 'utf8'))
    if (pkg.name !== name) throw new Error(`Sibling package name mismatch: expected ${name}, got ${pkg.name}`)
    if (!pkg.main || !existsSync(publishedPath(source, pkg.main))) throw new Error(`Missing build output for ${name}. Build janus-agentX before packaging.`)
    return { name, source, installed: join(root, 'node_modules', name) }
  })
  const packed = siblings.length ? JSON.parse(npm(['pack', '--dry-run', '--json', '--ignore-scripts', ...siblings.map(({ source }) => source)], root)) : []
  const plans = siblings.map((sibling) => {
    const pack = packed.find(({ name }) => name === sibling.name)
    if (!pack?.files?.length || !pack.files.some(({ path }) => path === 'package.json')) throw new Error(`npm did not report publication files for ${sibling.name}`)
    const main = JSON.parse(readFileSync(join(sibling.source, 'package.json'), 'utf8')).main.replace(/^\.\//, '')
    if (!pack.files.some(({ path }) => path === main)) throw new Error(`Build entry is excluded from npm publication: ${sibling.name}/${main}`)
    for (const { path } of pack.files) publishedPath(sibling.source, path)
    return { ...sibling, files: pack.files }
  })
  const changed = plans.filter(({ source, installed, files }) => !packageMatches(source, installed, files))
  const lockPath = join(root, 'package-lock.json')
  const originalLock = existsSync(lockPath) ? readFileSync(lockPath, 'utf8') : null
  const hiddenLockPath = join(root, 'node_modules/.package-lock.json')
  const originalHiddenLock = existsSync(hiddenLockPath) ? readFileSync(hiddenLockPath, 'utf8') : null
  const cache = join(root, '.cache')
  mkdirSync(cache, { recursive: true })
  const backup = mkdtempSync(join(cache, 'package-refresh-'))
  const moved = []
  const absent = changed.filter(({ installed }) => !existsSync(installed))
  let discardBackup = false
  try {
    for (const [index, plan] of changed.entries()) {
      // Rename the link itself; never traverse a sibling junction to remove it.
      if (existsSync(plan.installed)) {
        const saved = join(backup, String(index))
        renameSync(plan.installed, saved)
        moved.push({ ...plan, saved })
      }
    }
    if (originalLock && changed.length) {
      const lock = JSON.parse(originalLock)
      for (const key of Object.keys(lock.packages ?? {})) {
        if (changed.some(({ name }) => key === `node_modules/${name}` || key.startsWith(`node_modules/${name}/node_modules/`))) delete lock.packages[key]
      }
      const eol = originalLock.includes('\r\n') ? '\r\n' : '\n'
      writeFileSync(lockPath, (JSON.stringify(lock, null, 2) + '\n').replace(/\n/g, eol))
    }
    // npm must also reconcile newly declared transitive dependencies. Keeping a
    // stale file: lock entry would reinstall new bytes with old dependency metadata.
    npm(['install', '--install-links', ...installArgs], root, { stdio: 'inherit' })
    for (const plan of plans) {
      if (!packageMatches(plan.source, plan.installed, plan.files)) throw new Error(`npm did not materialize the current publication files for ${plan.name}`)
    }
    console.log(`Local package contents verified: ${plans.length} packages, ${changed.length} refreshed.`)
    discardBackup = true
    return changed.map(({ name }) => name)
  } catch (error) {
    if (originalLock !== null) writeFileSync(lockPath, originalLock)
    else rmSync(lockPath, { force: true })
    if (originalHiddenLock !== null) writeFileSync(hiddenLockPath, originalHiddenLock)
    else rmSync(hiddenLockPath, { force: true })
    for (const plan of absent) {
      rmSync(plan.installed, { recursive: true, force: true })
    }
    for (const { installed, saved } of moved) {
      rmSync(installed, { recursive: true, force: true })
      renameSync(saved, installed)
    }
    discardBackup = true
    throw error
  } finally {
    // If restoration itself fails, retain the backup for manual recovery.
    if (discardBackup) rmSync(backup, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { preparePackage() } catch (error) { console.error(error.message); process.exitCode = 1 }
}
