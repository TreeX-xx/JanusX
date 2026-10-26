// Note: .agents/notes/planning/blueprint-official-plugin.md — build outside the host checkout from public package archives.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const source = join(repository, 'plugins/blueprint')
const update = process.argv.includes('--update-lock')
const testRuntime = process.argv.includes('--test-runtime')
const npmCli = process.env.npm_execpath
if (!npmCli) throw new Error('Run through npm run plugins:blueprint:verify [-- --update-lock]')
const run = (args, cwd, options = {}) => execFileSync(process.execPath, [npmCli, ...args], { cwd, windowsHide: true, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 180_000, ...options })
const directory = await mkdtemp(join(await realpath(tmpdir()), 'janusx-blueprint-build-'))
const inside = relative(repository, directory)
if (!isAbsolute(inside) && inside !== '..' && !inside.startsWith('..' + sep)) throw new Error('Verification must be outside the repository')
const project = join(directory, 'blueprint'), vendor = join(project, 'vendor')
await mkdir(vendor, { recursive: true })
for (const file of ['src', 'manifest.json', 'package.json', 'tsconfig.json', 'build.mjs']) await cp(join(source, file), join(project, file), { recursive: true })
const pkg = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
const host = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8'))
const dependencies = []
for (const name of Object.keys(pkg.dependencies).filter(name => name.startsWith('@janus'))) {
  console.log(`Packing ${name}`)
  const reference = host.dependencies[name]
  if (!reference?.startsWith('file:')) throw new Error(`Missing public package source: ${name}`)
  const packageSource = resolve(repository, reference.slice(5))
  const packed = JSON.parse(run(['pack', packageSource, '--ignore-scripts', '--json', '--pack-destination', vendor], repository))[0]
  if (packed.name !== name || pkg.dependencies[name] !== `file:vendor/${packed.filename}`) throw new Error(`Dependency archive name or version changed: ${name}`)
  const bytes = await readFile(join(vendor, packed.filename))
  dependencies.push({ name, version: packed.version, file: packed.filename, sha256: createHash('sha256').update(bytes).digest('hex'), integrity: packed.integrity })
}
dependencies.sort((a, b) => a.name.localeCompare(b.name))
const dependencyLock = { schemaVersion: 1, dependencies }
if (!update) {
  const previous = JSON.parse(await readFile(join(source, 'build-dependencies.lock.json'), 'utf8'))
  if (JSON.stringify(previous) !== JSON.stringify(dependencyLock)) throw new Error('Public dependency bytes changed. Review the package changes and explicitly regenerate the build locks.')
  await cp(join(source, 'package-lock.json'), join(project, 'package-lock.json'))
}
console.log(`Packed ${dependencies.length} public dependencies. Installing in ${project}`)
run([update ? 'install' : 'ci', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline'], project)
console.log('Checking independent types and browser/native builds')
run(['run', 'typecheck'], project)
run(['run', 'build'], project)
// The lock must remain usable after moving the complete source+vendor directory.
const lock = JSON.parse(await readFile(join(project, 'package-lock.json'), 'utf8'))
for (const entry of Object.values(lock.packages)) if (entry.resolved?.startsWith('file:') && !entry.resolved.startsWith('file:vendor/')) throw new Error('Nonportable dependency in independent lock')
if (update) {
  await writeFile(join(source, 'build-dependencies.lock.json'), JSON.stringify(dependencyLock, null, 2) + '\n')
  await cp(join(project, 'package-lock.json'), join(source, 'package-lock.json'))
}
await mkdir(join(repository, 'artifacts/plugins'), { recursive: true })
const inputs = JSON.parse(await readFile(join(project, 'artifacts/build-inputs.json'), 'utf8'))
for (const input of inputs.inputs) {
  const path = relative(project, resolve(project, input))
  if (isAbsolute(path) || path === '..' || path.startsWith('..' + sep)) throw new Error(`Independent build used an external input: ${input}`)
}
const outputFiles = await Promise.all(Object.entries(inputs.outputs).map(async ([path, output]) => ({ path, bytes: output.bytes,
  sha256: createHash('sha256').update(await readFile(join(project, path))).digest('hex') })))
const receipt = { testedAt: new Date().toISOString(), project, node: process.version, platform: `${process.platform}-${process.arch}`,
  mode: update ? 'lock-generation' : 'npm-ci', dependencies, lockSha256: createHash('sha256').update(JSON.stringify(lock)).digest('hex'),
  outputs: outputFiles,
  checks: ['public archives', 'npm install without lifecycle scripts', 'independent typecheck', 'independent native and browser bundles', 'portable lock paths'] }
if (testRuntime) {
  console.log('Testing the independently built package in the signed Electron carrier')
  receipt.runtime = { status: 'failed', packageDirectory: project }
  try {
    run(['run', 'test:blueprint:desktop'], repository, { stdio: 'inherit', env: { ...process.env, JANUS_BLUEPRINT_PACKAGE: project } })
    receipt.runtime.status = 'passed'
    receipt.checks.push('signed install and Electron UI using independent package')
  } finally {
    await writeFile(join(repository, 'artifacts/plugins/blueprint-build.json'), JSON.stringify(receipt, null, 2) + '\n')
  }
}
await writeFile(join(repository, 'artifacts/plugins/blueprint-build.json'), JSON.stringify(receipt, null, 2) + '\n')
console.log(`Independent Blueprint build passed: ${project}`)
