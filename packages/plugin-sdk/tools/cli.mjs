#!/usr/bin/env node
// Note: .agents/notes/workbench/plugin-contract-v1.md — metadata-only P1 tools.
import { cp, mkdir, readFile, writeFile, lstat, readdir, realpath } from 'node:fs/promises'
import { dirname, resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePluginManifest, validatePluginPath, PluginError } from '../dist/index.js'

const sdkRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const template = resolve(sdkRoot, 'template')

export async function createPlugin(target, sdkTarball) {
  if (!target || !sdkTarball) throw new Error('Usage: janusx-plugin init <new-directory> --sdk <packed-sdk.tgz>')
  const tarball = await realpath(sdkTarball)
  if (!(await lstat(tarball)).isFile() || !tarball.endsWith('.tgz')) throw new Error('--sdk must name a packed SDK tarball.')
  const destination = resolve(target)
  // mkdir without recursive prevents overwriting any existing directory, even an empty one.
  await mkdir(destination)
  for (const entry of await readdir(template)) {
    await cp(resolve(template, entry), resolve(destination, entry), { recursive: true, errorOnExist: true, force: false })
  }
  const manifest = parsePluginManifest(await readFile(resolve(destination, 'manifest.json'), 'utf8'))
  await writeFile(resolve(destination, 'package.json'), JSON.stringify({
    name: manifest.id, version: manifest.version, private: true, type: 'module',
    scripts: { typecheck: 'tsc --noEmit', build: 'npm run typecheck && vite build', preview: 'vite --host 127.0.0.1', check: 'janusx-plugin check .' },
    dependencies: { '@janusx/plugin-sdk': `file:${tarball.replaceAll('\\', '/')}` },
    devDependencies: { typescript: '^5.6.0', vite: '^6.0.0' },
  }, null, 2) + '\n')
  await writeFile(resolve(destination, '.gitignore'), 'node_modules/\ndist/\n')
  return destination
}

/** Development diagnostic, not the P2 installer or runtime filesystem boundary. */
export async function checkPlugin(directory) {
  const root = await realpath(directory)
  const manifestFile = resolve(root, 'manifest.json')
  const manifestStat = await lstat(manifestFile)
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) throw new PluginError('INVALID_PACKAGE_PATH', 'Manifest must be a regular file.')
  if (manifestStat.size > 64 * 1024) throw new PluginError('PACKAGE_LIMIT_EXCEEDED', 'Manifest exceeds 64 KiB.')
  const manifest = parsePluginManifest(await readFile(manifestFile, 'utf8'))
  // Match the host installer: declarative-only packages deliver only their manifest.
  if (!manifest.contributes.views.length && !manifest.native) return manifest
  const found = new Set()
  let count = 1
  let bytes = manifestStat.size
  async function walk(path) {
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) throw new PluginError('INVALID_PACKAGE_PATH', 'Linked resources are not supported.')
    const name = relative(root, path).split(sep).join('/')
    validatePluginPath(name)
    if (stat.isDirectory()) {
      for (const child of await readdir(path)) await walk(resolve(path, child))
      return
    }
    if (!stat.isFile()) throw new PluginError('INVALID_PACKAGE_PATH', 'Resources must be regular files.')
    const lower = name.toLowerCase()
    if (found.has(lower)) throw new PluginError('INVALID_PACKAGE_PATH', 'Resource paths collide by case.')
    found.add(lower)
    const image = /\.(?:png|jpe?g|webp|gif|ico)$/.test(name)
    if (!image && !/\.(?:html|js|mjs|css|json)$/.test(name) && !(manifest.native && name.endsWith('.cjs'))) throw new PluginError('INVALID_PACKAGE_PATH', 'Unsupported resource type.')
    count++; bytes += stat.size
    if (count > 2000 || bytes > 50 * 1024 * 1024 || stat.size > (image ? 10 : 5) * 1024 * 1024) {
      throw new PluginError('PACKAGE_LIMIT_EXCEEDED', 'Resource budget exceeded.')
    }
  }
  // Only the declared dist delivery tree is checked; sources and node_modules are not package resources.
  try { await walk(resolve(root, 'dist')) } catch (error) {
    if (error.code === 'ENOENT') throw new PluginError('ENTRY_NOT_FOUND', 'Build the plugin before checking it.')
    throw error
  }
  for (const view of manifest.contributes.views) {
    if (!found.has(view.entry.toLowerCase()) || !(await lstat(resolve(root, view.entry)).catch(() => null))?.isFile()) throw new PluginError('ENTRY_NOT_FOUND', 'A declared HTML entry is missing.')
  }
  for (const entry of [manifest.native?.entry, manifest.native?.mcp?.entry]) {
    if (entry && !found.has(entry.toLowerCase())) throw new PluginError('ENTRY_NOT_FOUND', 'A native entry is missing.')
  }
  return manifest
}

async function main() {
  const [command, directory, flag, tarball] = process.argv.slice(2)
  if (command === 'init') {
    if (flag !== '--sdk') throw new Error('Pass --sdk <packed-sdk.tgz>; this SDK is not yet published.')
    console.log(`Created ${await createPlugin(directory, tarball)}. Run npm install, npm run build, npm run check.`)
  } else if (command === 'check') {
    console.log(`Plugin package valid: ${(await checkPlugin(resolve(directory ?? '.'))).id}. Runtime isolation is not checked.`)
  } else if (command === 'contract') {
    const manifest = parsePluginManifest(await readFile(resolve(template, 'manifest.json'), 'utf8'))
    console.log(`Plugin contract valid: ${manifest.id}. Runtime isolation is not checked.`)
  } else throw new Error('Usage: janusx-plugin init <new-directory> --sdk <sdk.tgz> | check <directory>')
}

if (process.argv[1] && await realpath(process.argv[1]).catch(() => '') === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`${error.code ?? 'PLUGIN_CHECK_FAILED'}: ${error.message}`); process.exitCode = 1 })
}
