// Proves the packaged build actually runs, from a directory outside this
// repository. Node's ESM resolver walks out of app.asar, so launching
// win-unpacked/JanusX.exe next to the repo used to find any package missing from
// the archive in the repo's own node_modules — the check passed on a build whose
// portable and setup artifacts died during bootstrap with no window and no log.
// Note: entry — see .agents/notes/desktop/packaged-hoisted-deps.md

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { getRawHeader, listPackage } from '@electron/asar'
import { validatePackagedPluginEntries } from './check-package-boundary.mjs'

const root = process.cwd()
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
// Note: staged delivery verifies a separate output directory — see .agents/notes/knowledge/tasks/knowledge-review-status-audit-plan.md
const releaseArg = process.argv.indexOf('--release-dir')
if (releaseArg !== -1 && (!process.argv[releaseArg + 1] || process.argv[releaseArg + 1].startsWith('--'))) {
  throw new Error('--release-dir requires a directory')
}
const releaseDirectory = releaseArg === -1 ? join(root, 'release', packageJson.version) : resolve(process.argv[releaseArg + 1])
const appAsar = join(releaseDirectory, 'win-unpacked', 'resources', 'app.asar')
const unpackedExecutable = join(releaseDirectory, 'win-unpacked', 'JanusX.exe')
// electron-builder omits SemVer build metadata from artifact names.
const artifactVersion = packageJson.version.split('+')[0]
const portableExecutable = join(releaseDirectory, `JanusX-${artifactVersion}-x64-portable.exe`)
const verifyPortable = process.argv.includes('--portable')

// Chromium reuses the app executable for sandboxed GPU subprocesses. Inspect the
// shipped PE manifests: a verifier's elevated token must not conceal regression.
for (const file of [unpackedExecutable, ...(verifyPortable ? [portableExecutable] : [])]) {
  if (existsSync(file)) {
    const match = readFileSync(file).toString('utf8').match(/<requestedExecutionLevel\b[^>]*\blevel="([^"]+)"/)
    if (!match) throw new Error(`Executable execution-level manifest missing: ${file}`)
    if (match[1] !== 'asInvoker') throw new Error(`Packaged GUI executable must use asInvoker, found ${match[1]}: ${file}`)
  }
}

// Every symlink in the archive must resolve inside it, otherwise a workspace
// dependency such as @janusx/llm-core is packaged as a dangling link and the app
// cannot resolve it at runtime.
function archiveSymlinks(archive) {
  const links = []
  const walk = (node, path) => {
    for (const [name, child] of Object.entries(node.files || {})) {
      const here = path ? `${path}/${name}` : name
      if (child.link) links.push({ at: here, to: child.link.split('\\').join('/') })
      if (child.files) walk(child, here)
    }
  }
  walk(archive, '')
  return links
}

function resolveArchiveLink(link, from) {
  const raw = link.to.startsWith('.') ? `${from.split('/').slice(0, -1).join('/')}/${link.to}` : link.to
  const segments = []
  for (const part of raw.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') segments.pop()
    else segments.push(part)
  }
  return segments.join('/')
}

// Everything startup resolves must be reachable from the archive root.
const REQUIRED_ARCHIVE_ROOTS = ['package.json', 'out', 'node_modules']
for (const requiredPath of [appAsar, unpackedExecutable]) {
  if (!existsSync(requiredPath)) throw new Error(`Packaged runtime artifact missing: ${requiredPath}`)
}

const asarEntries = new Set(listPackage(appAsar).map((entry) => entry.split(sep).join('/').replace(/^\/+/, '')))
validatePackagedPluginEntries(asarEntries)
// Neither sidecar resources nor smart-unpacked files may carry plugin payloads.
for (const base of [join(releaseDirectory, 'win-unpacked'), join(dirname(appAsar)), join(dirname(appAsar), 'app.asar.unpacked')]) {
  for (const path of ['plugins', 'node_modules/@janusx/blueprint']) {
    if (existsSync(join(base, path))) throw new Error(`Downloadable plugin files must not ship in the application: ${join(base, path)}`)
  }
}
const archiveHeader = getRawHeader(appAsar).header
for (const link of archiveSymlinks(archiveHeader)) {
  const target = resolveArchiveLink(link, link.at)
  if (!asarEntries.has(target) && ![...asarEntries].some((entry) => entry.startsWith(`${target}/`))) {
    throw new Error(`app.asar contains a dangling symlink: ${link.at} -> ${link.to}`)
  }
}
for (const requiredEntry of [
  'node_modules/ai/package.json',
  'node_modules/@langchain/langgraph/package.json',
  'node_modules/@langchain/core/package.json',
  'out/main/index.js',
]) {
  if (!asarEntries.has(requiredEntry)) throw new Error(`app.asar runtime entry missing: ${requiredEntry}`)
}
if (![...asarEntries].some((entry) => /^out\/main\/chunks\/LlmService-.*\.js$/.test(entry))) {
  throw new Error('app.asar LlmService chunk missing')
}
for (const name of Object.keys(packageJson.dependencies)) {
  if (!asarEntries.has(`node_modules/${name}/package.json`)) {
    throw new Error(`app.asar is missing the declared dependency ${name} from its node_modules root`)
  }
}
for (const requiredRoot of REQUIRED_ARCHIVE_ROOTS) {
  if (!asarEntries.has(requiredRoot) && ![...asarEntries].some((entry) => entry.startsWith(`${requiredRoot}/`))) {
    throw new Error(`app.asar root entry missing: ${requiredRoot}`)
  }
}

// node_modules reaches the archive verbatim, so `files` negations are the only
// thing that keeps devDependencies out of it. Both directions are asserted
// against the production closure: a package the app needs must be present, and a
// package the app cannot reach must be absent. electron-builder's own binaries,
// `electron`'s dist and the test toolchain were 612 MiB of a 301 MiB installer's
// 870 MiB payload before the negations existed.
const CLOSURE_EXCEPTIONS = new Map([
  ['electron', 'the built-in Electron module answers `import "electron"`; node_modules/electron exports an exe path'],
  ['typescript', 'declared by the MCP and Lark SDKs, required by neither at runtime'],
  ['monaco-editor', 'bundled into out/renderer as renderer assets'],
])

// `npm ls` exits non-zero on workspace file: dependencies even when it prints the
// whole tree, so the status is ignored and the printed tree is the only input.
// Windows resolves npm through the shell only, and Node flags that pairing as
// deprecated; the arguments here are constants, so the warning is filtered out
// rather than left in every packaging log.
const emitWarning = process.emitWarning.bind(process)
process.emitWarning = (warning, ...rest) => {
  if (`${warning}`.includes('shell option true')) return
  emitWarning(warning, ...rest)
}
const BACKSLASH = String.fromCharCode(92)
const NODE_MODULES = '/node_modules/'
const listed = spawnSync('npm', ['ls', '--omit=dev', '--all', '--parseable'], {
  cwd: root,
  encoding: 'utf8',
  shell: true,
  maxBuffer: 1 << 28,
})
const closure = new Set()
for (const line of (listed.stdout || '').split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
  const normalized = line.split(BACKSLASH).join('/')
  const index = normalized.lastIndexOf(NODE_MODULES)
  if (index === -1) continue
  const installPath = normalized.slice(index + NODE_MODULES.length)
  const parts = installPath.split('/')
  closure.add(installPath.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0])
}
if (closure.size === 0) throw new Error('production dependency closure is empty; npm ls printed no tree')

const archivePackages = new Set()
for (const entry of asarEntries) {
  if (!entry.startsWith('node_modules/')) continue
  const parts = entry.slice('node_modules/'.length).split('/')
  // `node_modules/@scope` is the scope directory itself, not a package; a package
  // always carries a second segment.
  if (parts[0].startsWith('@') && parts.length < 2) continue
  archivePackages.add(parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0])
}

// The closure also lists nested installs such as
// node_modules/node-pty/node_modules/node-addon-api. Only names npm hoisted to
// the root are expected at the archive root, so the requirement is the closure
// intersected with what is installed at the root.
const installedAtRoot = new Set()
for (const name of readdirSync(join(root, 'node_modules'))) {
  if (name.startsWith('.')) continue
  if (!name.startsWith('@')) {
    installedAtRoot.add(name)
    continue
  }
  for (const scoped of readdirSync(join(root, 'node_modules', name))) installedAtRoot.add(`${name}/${scoped}`)
}

const missingFromArchive = [...closure].filter(
  (name) => installedAtRoot.has(name) && !archivePackages.has(name) && !CLOSURE_EXCEPTIONS.has(name),
)
if (missingFromArchive.length > 0) {
  throw new Error(
    `app.asar is missing production packages (${missingFromArchive.slice(0, 10).join(', ')}): ` +
      'a `files` negation is wider than the dev-only set. Run `npm run exclusions:sync`.',
  )
}
const leakedIntoArchive = [...archivePackages].filter((name) => !closure.has(name))
if (leakedIntoArchive.length > 0) {
  throw new Error(
    `app.asar carries packages the production closure never reaches ` +
      `(${leakedIntoArchive.slice(0, 10).join(', ')}): run \`npm run exclusions:sync\` and repackage.`,
  )
}

function directorySize(directory) {
  let total = 0
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name)
    if (entry.isDirectory()) total += directorySize(target)
    else if (entry.isFile()) total += statSync(target).size
  }
  return total
}

// The archive gives every entry an aligned block, so the asar file runs well
// above the sum of its file sizes (252 MiB against a 169 MiB payload) and drifts
// with file count. The payload is what measures the app's own footprint, so the
// budgets below use it: each limit sits above the build that landed the
// exclusions (payload 169 MiB, unpacked 12 MiB, portable 130 MiB) with headroom
// for dependency growth, and low enough that the previous shape
// (870 MiB payload, 539 MiB unpacked, 301 MiB portable) still fails.
function archivePayload() {
  let total = 0
  const walk = (node) => {
    for (const child of Object.values(node.files ?? {})) {
      if (child.files) walk(child)
      else total += child.size ?? 0
    }
  }
  walk(archiveHeader)
  return total / 1048576
}

const SIZE_BUDGETS = [
  { label: 'app.asar payload', measure: archivePayload, limitMiB: 260 },
  {
    label: 'app.asar.unpacked',
    measure: () => directorySize(join(dirname(appAsar), 'app.asar.unpacked')) / 1048576,
    limitMiB: 64,
  },
  {
    label: 'portable installer',
    measure: () => (existsSync(portableExecutable) ? statSync(portableExecutable).size / 1048576 : 0),
    limitMiB: 200,
    whenPortable: true,
  },
]
for (const budget of SIZE_BUDGETS) {
  if (budget.whenPortable && !verifyPortable) continue
  const sizeMiB = budget.measure()
  if (sizeMiB > budget.limitMiB) {
    throw new Error(`${budget.label} is ${sizeMiB.toFixed(1)} MiB, over the ${budget.limitMiB} MiB packaging budget`)
  }
}
console.log(
  `Packaging budgets verified: payload ${archivePayload().toFixed(1)} MiB, ` +
    `unpacked ${SIZE_BUDGETS[1].measure().toFixed(1)} MiB` +
    (verifyPortable ? `, portable ${SIZE_BUDGETS[2].measure().toFixed(1)} MiB` : '') +
    '.',
)

// llm-runtime pins the AI runtime; module-graph imports everything bootstrapApp
// imports, which is the only thing that catches an unresolvable package anywhere
// in the startup graph rather than in the one module llm-runtime happens to touch.
const SMOKE_MODES = ['llm-runtime', 'module-graph']
const STARTUP_TIMEOUT_MS = 60_000
const guiResults = []

async function runSmoke(executable, mode, stage, label) {
  const profile = await mkdtemp(join(stage, 'profile-'))
  try {
    await new Promise((resolvePromise, reject) => {
      const child = spawn(resolve(executable), [`--smoke-test=${mode}`, `--user-data-dir=${profile}`], {
        stdio: 'inherit',
        windowsHide: true,
        env: { ...process.env, JANUSX_KNOWLEDGE_ROOT: join(profile, 'knowledge') },
      })
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`${label} smoke timed out after ${STARTUP_TIMEOUT_MS}ms: ${executable}`))
      }, STARTUP_TIMEOUT_MS)
      child.once('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      child.once('exit', (code) => {
        clearTimeout(timeout)
        if (code === 0) resolvePromise()
        else reject(new Error(`${label} smoke (${mode}) failed with exit code ${code}: ${executable}`))
      })
    })
  } finally {
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

// Exercise the normal entry, native GPU subprocesses, preload and rendered page.
// Import-only smoke modes skip normal startup and cannot prove a window opens.
async function verifyGui(executable, stage, label) {
  const { _electron } = await import('@playwright/test')
  const profile = await mkdtemp(join(stage, 'gui-profile-'))
  const env = { ...process.env, JANUSX_KNOWLEDGE_ROOT: join(profile, 'knowledge'), ELECTRON_RENDERER_URL: '' }
  delete env.ELECTRON_RUN_AS_NODE
  let application
  try {
    application = await _electron.launch({
      executablePath: resolve(executable), args: [`--user-data-dir=${profile}`], env, timeout: STARTUP_TIMEOUT_MS,
    })
    const page = await application.firstWindow({ timeout: STARTUP_TIMEOUT_MS })
    await page.waitForFunction(() => Boolean(window.electron) && document.getElementById('root')?.childElementCount > 0 && document.body.innerText.trim().length > 20,
      undefined, { timeout: STARTUP_TIMEOUT_MS })
    const result = await application.evaluate(({ app, BrowserWindow }) => ({
      version: app.getVersion(),
      windows: BrowserWindow.getAllWindows().map(window => ({ visible: window.isVisible(), url: window.webContents.getURL() })),
      forbiddenSwitches: ['no-sandbox', 'disable-gpu-sandbox', 'disable-gpu'].filter(name => app.commandLine.hasSwitch(name)),
      chromiumLog: app.commandLine.getSwitchValue('log-file'),
      gpu: app.getGPUFeatureStatus(),
    }))
    if (result.version !== packageJson.version || !result.windows.some(window => window.visible && window.url.startsWith('file:'))) {
      throw new Error(`${label} did not display the packaged application window: ${JSON.stringify(result)}`)
    }
    if (result.forbiddenSwitches.length) throw new Error(`${label} bypassed the normal GPU launch: ${result.forbiddenSwitches.join(', ')}`)
    const startupLog = readFileSync(join(profile, 'logs', 'startup.log'), 'utf8')
    if (!startupLog.includes(`Starting JanusX ${packageJson.version}`) || !result.chromiumLog) {
      throw new Error(`${label} startup diagnostics were not configured`)
    }
    guiResults.push({ label, ...result, startupLog })
    console.log(`[packaged-gui] ${label} visible, renderer and preload ready, native GPU launch enabled`)
  } finally {
    if (application) await application.close()
  }
}

// Copies the build out of the repository before launching it, so no path above
// the archive can stand in for a package the archive is missing.
const PATH_7ZA = join(root, 'node_modules', '7zip-bin', 'win', process.arch, '7za.exe')

// The portable installer is a 7z payload behind a launcher stub. The stub extracts
// the payload, starts the app detached and exits 0 on its own, so neither its exit
// code nor its output says anything about the app it carries: a payload that dies
// during bootstrap still reports success. The payload is therefore extracted and
// booted under both smoke modes, and the stub is launched on its own to prove it
// starts the app.
async function extractPortablePayload(target) {
  await mkdir(target, { recursive: true })
  const extracted = spawnSync(PATH_7ZA, ['x', '-y', `-o${target}`, portableExecutable], { encoding: 'utf8' })
  if (extracted.status !== 0) {
    throw new Error(`7za could not extract the portable installer (exit ${extracted.status})`)
  }
}

function processIds(imageName) {
  const listing = spawnSync('tasklist', ['/fo', 'csv', '/nh'], { encoding: 'utf8' })
  const ids = []
  for (const line of (listing.stdout || '').split(/\r?\n/)) {
    const match = line.match(/"([^"]*)","(\d+)"/)
    if (match && match[1].toLowerCase() === imageName) ids.push(Number(match[2]))
  }
  return ids
}

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))

async function verifyPortablePayload(stage) {
  const extracted = join(stage, 'portable-payload')
  await extractPortablePayload(extracted)
  for (const required of [
    'JanusX.exe',
    'resources/app.asar',
    'resources/app.asar.unpacked/node_modules/node-pty',
    'resources/officecli/officecli.exe',
    'locales/en-US.pak',
  ]) {
    if (!existsSync(join(extracted, required))) throw new Error(`portable installer is missing ${required}`)
  }
  for (const mode of SMOKE_MODES) await runSmoke(join(extracted, 'JanusX.exe'), mode, stage, 'portable payload')
  await verifyGui(join(extracted, 'JanusX.exe'), stage, 'portable payload')
}

async function verifyPortableStub(stage) {
  const alreadyRunning = new Set(processIds('janusx.exe'))
  const profile = await mkdtemp(join(stage, 'profile-'))
  try {
    const stub = spawn(resolve(portableExecutable), [`--smoke-test=module-graph`, `--user-data-dir=${profile}`], {
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, JANUSX_KNOWLEDGE_ROOT: join(profile, 'knowledge') },
    })
    const deadline = Date.now() + STARTUP_TIMEOUT_MS
    let started = null
    while (started === null && Date.now() < deadline) {
      await delay(250)
      started = processIds('janusx.exe').find((pid) => !alreadyRunning.has(pid)) ?? null
    }
    if (started === null) {
      stub.kill()
      throw new Error('the portable installer did not start the app it carries')
    }
    // The smoke makes the app exit on its own, so waiting for it needs no kill.
    while (Date.now() < deadline && processIds('janusx.exe').includes(started)) await delay(250)
    if (processIds('janusx.exe').includes(started)) {
      throw new Error('the app started by the portable installer did not finish its smoke test')
    }
    const stubExit = await new Promise((resolveExit) => {
      if (stub.exitCode !== null) resolveExit(stub.exitCode)
      else stub.once('exit', (code) => resolveExit(code))
    })
    if (stubExit !== 0) throw new Error(`the portable installer exited with code ${stubExit}`)
  } finally {
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

const stage = await mkdtemp(join(tmpdir(), 'janusx-packaged-runtime-'))
try {
  await cp(join(releaseDirectory, 'win-unpacked'), join(stage, 'app'), { recursive: true })
  for (const mode of SMOKE_MODES) await runSmoke(join(stage, 'app', 'JanusX.exe'), mode, stage, 'unpacked')
  await verifyGui(join(stage, 'app', 'JanusX.exe'), stage, 'unpacked')

  if (verifyPortable) {
    if (!existsSync(portableExecutable)) throw new Error(`Portable artifact missing: ${portableExecutable}`)
    await verifyPortablePayload(stage)
    await verifyPortableStub(stage)
  }

  await mkdir(join(root, 'artifacts'), { recursive: true })
  await writeFile(join(root, 'artifacts', 'packaged-runtime-gui.json'), JSON.stringify({ version: packageJson.version, platform: process.platform, results: guiResults }, null, 2))
  console.log(`Packaged runtime and GUI verified${verifyPortable ? ' (unpacked + portable payload + portable stub)' : ''}.`)
} finally {
  await rm(stage, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
