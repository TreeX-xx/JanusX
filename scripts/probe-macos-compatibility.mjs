// Windows-hosted source diagnostics; never a substitute for a macOS installation test.
// Note: .agents/notes/desktop/macos-compatibility.md
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import vm from 'node:vm'
import ts from 'typescript'
import { parse } from 'yaml'

const root = fileURLToPath(new URL('../', import.meta.url))
const sources = new Map()
const results = []
const posix = { ...path.posix, win32: path.win32 }
function source(file) {
  const bytes = readFileSync(path.resolve(root, file))
  sources.set(file, createHash('sha256').update(bytes).digest('hex'))
  return bytes.toString('utf8')
}
function evaluate(code, bindings = {}) {
  const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  return vm.runInNewContext(output, bindings, { timeout: 2000 })
}
function load(file, mocks, bindings = {}) {
  const module = { exports: {} }
  evaluate(source(file), { module, exports: module.exports, require(name) {
    if (Object.hasOwn(mocks, name)) return mocks[name]
    throw new Error(`Unmocked dependency: ${file} -> ${name}`)
  }, ...bindings })
  return module.exports
}
function find(file, predicate) {
  const ast = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true)
  const found = []
  function visit(node) { if (predicate(node, ast)) found.push(node); ts.forEachChild(node, visit) }
  visit(ast)
  assert.equal(found.length, 1, `Expected exactly one source boundary in ${file}`)
  return { node: found[0], ast }
}
async function check(id, arch, expected, action) {
  const result = { id, arch, evidence: 'source-simulation', expected }
  results.push(result)
  try { await action(result); result.status ??= 'passed' }
  catch (error) {
    result.status = error.code === 'ERR_ASSERTION' || String(error.message).startsWith('Duplicate IPC handler:') ? 'failed' : 'error'
    result.error = String(error.message ?? error)
  }
  console.log(`${result.status.toUpperCase()} ${arch}/${id}${result.error ? ': ' + result.error : ''}`)
}

function cliBoundary(arch, extra = {}) {
  const files = new Set(['/opt/homebrew/bin/claude']), managed = []
  const process = { platform: 'darwin', arch, env: { PATH: '/usr/bin:/bin', SHELL: '/bin/zsh', HOME: '/Users/probe' } }
  const cache = new Map()
  const missing = () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }) }
  const managedCliEnv = () => ({ ...process.env, PATH: [...managed, process.env.PATH].join(':') })
  const managedModule = { managedCliDirs: () => managed, managedCliEnv }
  const registry = { getExternalCliTool: () => ({ binaryNames: ['claude'] }) }
  const builtins = {
    'node:path': posix, 'node:crypto': { createHash }, 'node:events': { EventEmitter },
    'node:os': { homedir: () => '/Users/probe' },
    'node:module': { createRequire: () => () => { throw new Error('Unexpected native resolution') } },
    'node:fs': { constants: { X_OK: 1 }, existsSync: file => files.has(file), statSync: file => files.has(file) ? { isFile: () => true } : missing(),
      accessSync: file => { if (!files.has(file)) missing() }, readFileSync: missing },
    'node:fs/promises': { stat: async file => files.has(file) ? { isFile: () => true } : missing() },
    ...extra,
  }
  function moduleFor(file) {
    file = path.relative(root, path.resolve(root, file)).replaceAll('\\', '/')
    if (cache.has(file)) return cache.get(file)
    const mocks = { 'src/main/external-cli/managed-paths.ts': managedModule,
      'src/main/external-cli/tool-registry.ts': registry,
      'src/main/platform/process-host/index.ts': { runProcess() { throw new Error('Unexpected process execution') } },
      'src/main/shutdown/quit-state.ts': { assertApplicationRunning() {} },
      'src/main/terminal/diagnostics.ts': { logTerminalDiagnostic() {} }, ...extra }
    if (Object.hasOwn(mocks, file)) return mocks[file]
    const module = { exports: {} }; cache.set(file, module.exports)
    // CommonJS transpilation cannot declare a lexical `require` before its own imports.
    const text = source(file).replace('const require = createRequire(import.meta.url)', 'const nativeRequire = createRequire("probe")').replaceAll('require.resolve(', 'nativeRequire.resolve(')
    evaluate(text, { module, exports: module.exports, process, Buffer, console, setTimeout, clearTimeout, require(name) {
      if (Object.hasOwn(builtins, name)) return builtins[name]
      if (!name.startsWith('.')) throw new Error('Unexpected module: ' + name)
      const candidate = path.resolve(root, path.dirname(file), name)
      const target = [candidate + '.ts', path.join(candidate, 'index.ts')].find(value => { try { return readFileSync(value).length >= 0 } catch { return false } })
      if (!target) throw new Error('Missing source: ' + name)
      return moduleFor(target)
    } })
    return module.exports
  }
  return { files, process, managed, load: moduleFor, resolver: moduleFor('src/main/janus-runner/cli-resolver.ts'),
    detector: new (moduleFor('src/main/external-cli/cli-detector.ts').CliDetector)('claude') }
}
function capabilityBoundary() {
  const contractPath = fileURLToPath(import.meta.resolve('@janus-agent/janus-agent/superagent/contracts/conversation-display'))
  const contract = load(path.relative(root, contractPath), {})
  return load('src/shared/runtime/capabilities.ts', { '@janus-agent/janus-agent/superagent/contracts/conversation-display': contract })
}

function windowBoundary(arch) {
  const { SYSTEM_CHANNELS } = load('src/shared/ipc/system.ts', {})
  const handlers = new Map(), listeners = new Map()
  const ipcMain = { on(name, fn) { const list = listeners.get(name) ?? []; list.push(fn); listeners.set(name, list) }, handle(name, fn) {
    if (handlers.has(name)) throw new Error(`Duplicate IPC handler: ${name}`)
    handlers.set(name, fn)
  } }
  const windowIpc = load('src/main/windows/register-window-ipc.ts', {
    electron: { ipcMain, BrowserWindow: { fromWebContents: sender => sender.window } },
    '../../shared/ipc/system': { SYSTEM_CHANNELS }, './editor-routing': { EditorRouting: class {} },
  })
  const { node: create, ast } = find('src/main/index.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'createWindow')
  const { node: activate, ast: activateAst } = find('src/main/index.ts', (node, ast) => ts.isCallExpression(node)
    && node.expression.getText(ast) === 'app.on' && node.arguments[0]?.text === 'activate')
  const { node: secondInstance, ast: secondAst } = find('src/main/index.ts', (node, ast) => ts.isCallExpression(node)
    && node.expression.getText(ast) === 'app.on' && node.arguments[0]?.text === 'second-instance')
  const bootstrapStatements = create.parent.statements
  const show = bootstrapStatements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'showMainWindow')
  const register = bootstrapStatements.filter(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(ast) === 'registerWindowIpc')
  const windows = []
  const appShutdown = { isQuitting: false }
  const context = {
    process: { platform: 'darwin', arch }, appShutdown,
    app: { isReady: () => true, quit() { throw new Error('Mac close must not quit') } },
    BrowserWindow: { getAllWindows: () => windows.filter(window => !window.destroyed) },
    createMainWindow(onClosed) {
      const window = { destroyed: false, visible: true, minimized: false, focused: false,
        isDestroyed() { return this.destroyed }, isVisible() { return this.visible }, isMinimized() { return this.minimized },
        show() { this.visible = true }, restore() { this.minimized = false }, focus() { this.focused = true },
        minimize() { this.minimized = true },
        close() { this.destroyed = true; onClosed() }, webContents: {} }
      window.webContents.window = window; windows.push(window); return window
    },
    officeArtifactIndex: { disposeAll() {} }, feishuInboundRuntime: { stop() {}, configure() {}, reconfigure() {} },
    editorWindows: {}, getOfficeWindows() { return [] }, resolveOfficeWorkspaceRoot() {}, officeWatchPool: {}, browserSurfaces: {},
    registerApplicationIpc() {}, registerWindowIpc: windowIpc.registerWindowIpc,
    console, require(name) {
      if (name === './updater/service') return { updateService: { setMainWindow() {}, setAutoCheck() {}, startAutoCheck() {} } }
      if (name === './config/service') return { configService: { getUpdaterSettings: async () => ({ autoCheck: false }) } }
      throw new Error(`Unmocked lifecycle import: ${name}`)
    },
  }
  evaluate(`let mainWindow = null; ${register.map(node => node.getText(ast)).join('\n')}
    ${create.getText(ast)}; ${show?.getText(ast) ?? ''}; globalThis.controls = {
    createWindow, activate: ${activate.arguments[1].getText(activateAst)},
    secondInstance: ${secondInstance.arguments[1].getText(secondAst)}, getMain: () => mainWindow
  }`, context)
  return { ...context.controls, windows, app: context.app, appShutdown, handlers, listeners, SYSTEM_CHANNELS }
}

function processBoundary(arch, { group = true, stubborn = false, denied = false } = {}) {
  let running = true
  const signals = []
  const execFile = () => { throw new Error('Expected promisified process query') }
  execFile[promisify.custom] = async () => ({ stdout: group ? ' 731\n' : ' 900\n', stderr: '' })
  const { stopProcessTree } = load('src/main/platform/process-host/owned-tree.ts', {
    'node:child_process': { execFile },
    'node:util': { promisify },
    '@janus-agent/janus-agent/superagent/native/windows-process-tree': {}, './diagnostics': { logShutdown() {} },
  }, { process: { platform: 'darwin', arch, kill(pid, signal) {
    if (!running) throw Object.assign(new Error('gone'), { code: 'ESRCH' })
    if (signal === 0) return
    signals.push([pid, signal])
    if (denied) throw Object.assign(new Error('denied'), { code: 'EPERM' })
    if (!stubborn || signal === 'SIGKILL') running = false
  } }, setTimeout })
  return { stopProcessTree, signals }
}

for (const arch of ['arm64', 'x64']) {
  await check('MAC-01-window-reopen', arch, 'Close -> activate recreates the main window without duplicate IPC', async result => {
    const lifecycle = windowBoundary(arch)
    lifecycle.createWindow(); lifecycle.getMain().close()
    lifecycle.activate()
    result.actual = { windows: lifecycle.windows.length, mainVisible: lifecycle.getMain()?.visible }
    assert.equal(lifecycle.getMain()?.visible, true)
  })
  await check('MAC-02-hidden-toast', arch, 'A hidden auxiliary window does not prevent main-window recreation', async result => {
    const lifecycle = windowBoundary(arch)
    lifecycle.createWindow(); lifecycle.getMain().close()
    lifecycle.windows.push({ destroyed: false, visible: false })
    lifecycle.activate(); result.actual = { mainWindow: Boolean(lifecycle.getMain()) }
    assert.ok(lifecycle.getMain(), 'Hidden auxiliary window prevented main-window recreation')
  })
  await check('MAC-02-minimized-main', arch, 'Dock activation restores and focuses the main window', async result => {
    const lifecycle = windowBoundary(arch)
    lifecycle.createWindow(); lifecycle.getMain().minimized = true
    lifecycle.activate(); result.actual = { minimized: lifecycle.getMain().minimized, focused: lifecycle.getMain().focused }
    assert.equal(result.actual.minimized, false, 'Main window was not restored')
    assert.equal(result.actual.focused, true)
  })
  await check('MAC-02-hidden-main', arch, 'Dock activation shows and focuses a hidden main window', async result => {
    const lifecycle = windowBoundary(arch)
    lifecycle.createWindow(); lifecycle.getMain().visible = false
    lifecycle.activate(); result.actual = { visible: lifecycle.getMain().visible, focused: lifecycle.getMain().focused }
    assert.equal(result.actual.visible, true); assert.equal(result.actual.focused, true)
  })
  await check('MAC-01-repeated-reopen-routing', arch, 'Ten close/reopen cycles retain one IPC registration and target the current sender', async result => {
    const lifecycle = windowBoundary(arch)
    lifecycle.createWindow()
    const handlers = lifecycle.handlers.size
    const listenerCounts = [...lifecycle.listeners].map(([channel, list]) => [channel, list.length])
    for (let cycle = 0; cycle < 10; cycle++) {
      lifecycle.getMain().close(); lifecycle.activate()
      const current = lifecycle.getMain()
      lifecycle.handlers.get(lifecycle.SYSTEM_CHANNELS.minimize)({ sender: current.webContents })
      assert.equal(current.minimized, true)
      lifecycle.activate(); assert.equal(current.minimized, false)
      assert.equal(current.focused, true)
    }
    assert.equal(lifecycle.handlers.size, handlers)
    assert.deepEqual([...lifecycle.listeners].map(([channel, list]) => [channel, list.length]), listenerCounts)
    result.actual = { cycles: 10, handlers, eventListeners: Object.fromEntries(listenerCounts) }
  })
  await check('second-instance-main-restore', arch, 'A second instance shows and restores the existing hidden/minimized main window', async result => {
    const lifecycle = windowBoundary(arch)
    lifecycle.createWindow(); lifecycle.getMain().visible = false; lifecycle.getMain().minimized = true
    lifecycle.secondInstance()
    result.actual = { visible: lifecycle.getMain().visible, minimized: lifecycle.getMain().minimized, focused: lifecycle.getMain().focused }
    assert.equal(result.actual.visible, true); assert.equal(result.actual.minimized, false); assert.equal(result.actual.focused, true)
  })
  await check('shutdown-no-reopen', arch, 'Activation during shutdown creates no new window', async result => {
    const lifecycle = windowBoundary(arch); lifecycle.appShutdown.isQuitting = true
    lifecycle.activate(); result.actual = { windows: lifecycle.windows.length }; assert.equal(result.actual.windows, 0)
  })
  await check('shutdown-no-window-restore', arch, 'Activation and a second instance do not restore an existing window during shutdown', async result => {
    const lifecycle = windowBoundary(arch)
    lifecycle.createWindow(); lifecycle.getMain().visible = false; lifecycle.getMain().minimized = true
    lifecycle.appShutdown.isQuitting = true; lifecycle.activate(); lifecycle.secondInstance()
    result.actual = { visible: lifecycle.getMain().visible, minimized: lifecycle.getMain().minimized, focused: lifecycle.getMain().focused }
    assert.equal(result.actual.visible, false); assert.equal(result.actual.minimized, true); assert.equal(result.actual.focused, false)
  })
  await check('second-instance-before-ready', arch, 'A second instance before app readiness does not create a native window', async result => {
    const lifecycle = windowBoundary(arch); lifecycle.app.isReady = () => false
    lifecycle.secondInstance(); result.actual = { windows: lifecycle.windows.length }; assert.equal(result.actual.windows, 0)
  })
  await check('MAC-03-homebrew', arch, 'Detection -> launch resolves the same Homebrew executable', async result => {
    const cli = cliBoundary(arch)
    result.actual = { detected: (await cli.detector.findCandidate())?.path, launch: await cli.resolver.resolveCLIPath('claude') }
    assert.equal(result.actual.detected, '/opt/homebrew/bin/claude')
    assert.equal(result.actual.launch, result.actual.detected)
  })
  await check('cli-absolute-path', arch, 'An explicit detected path resolves successfully', async result => {
    const cli = cliBoundary(arch)
    result.actual = await cli.resolver.resolveCLIPath((await cli.detector.findCandidate()).path)
    assert.equal(result.actual, '/opt/homebrew/bin/claude')
  })
  await check('cli-cache-refresh', arch, 'Explicit cache invalidation makes a newly installed CLI visible', async result => {
    const cli = cliBoundary(arch)
    cli.files.clear()
    assert.equal(await cli.resolver.resolveCLIPath('claude'), null)
    cli.files.add('/usr/local/bin/claude'); cli.resolver.clearCache()
    result.actual = await cli.resolver.resolveCLIPath('claude'); assert.equal(result.actual, '/usr/local/bin/claude')
  })
  await check('cli-managed-after-miss', arch, 'A managed install takes precedence even after a cached miss', async result => {
    const cli = cliBoundary(arch); cli.files.clear(); assert.equal(await cli.resolver.resolveCLIPath('claude'), null)
    cli.files.add('/managed/bin/claude'); cli.managed.push('/managed/bin')
    result.actual = await cli.resolver.resolveCLIPath('claude'); assert.equal(result.actual, '/managed/bin/claude')
  })
  await check('terminal-spawn-io-stop', arch, 'Resolved CLI -> PTY spawn -> input/output/resize -> confirmed cleanup', async result => {
    const stopped = [], calls = []
    const pty = { pid: 731, write: data => calls.push(['write', data]), resize: (cols, rows) => calls.push(['resize', cols, rows]),
      kill: () => calls.push(['kill']), onData() {}, onExit() {} }
    // Native spawn stays a double; execute the actual manager, driver, environment and resolver.
    const cli = cliBoundary(arch, {
      'node-pty': { spawn(file, args, options) { calls.push(['spawn', file, args, options]); return pty } },
      'src/main/shutdown/process-tree.ts': { async stopProcessTree(target, options) { stopped.push([target.pid, options.processGroup]) } },
    })
    const manager = new (cli.load('src/main/terminal/manager.ts').TerminalManager)()
    const program = await cli.resolver.resolveCLIPath((await cli.detector.findCandidate()).path)
    manager.create({ id: 'probe', workspaceId: 'ws', cwd: '/Users/probe/project', shell: '/bin/zsh', program, programArgs: ['--version'] }, '/office/bin')
    manager.write('probe', 'hello\r'); manager.resize('probe', 100, 32); manager.appendOutput('probe', 'ready')
    assert.equal(manager.getOutputReplay('probe').data, 'ready')
    await manager.killAll()
    assert.equal(manager.listInstances().length, 0); assert.equal(stopped[0][1], true)
    const spawn = calls.find(call => call[0] === 'spawn')
    assert.equal(spawn[1], program); assert.equal(spawn[3].env.PATH, '/office/bin:/usr/bin:/bin')
    assert.ok(calls.some(call => call[0] === 'write')); assert.ok(calls.some(call => call[0] === 'resize')); assert.ok(calls.some(call => call[0] === 'kill'))
    result.actual = { program, ptyCalls: calls.map(call => call[0]), ownedStop: stopped }
  })
  await check('MAC-04-claude-capability', arch, 'Advertised Claude conversation support agrees with the startup gate', async result => {
    const { node, ast } = find('src/main/terminal/claude-conversation.ts', node => ts.isMethodDeclaration(node) && node.name?.getText() === 'launch')
    const contractPath = fileURLToPath(import.meta.resolve('@janus-agent/janus-agent/superagent/contracts/conversation-display'))
    const contract = load(path.relative(root, contractPath), {})
    const desktopContract = load('src/shared/conversation-display.ts', { '@janus-agent/janus-agent/superagent/contracts/conversation-display': contract, './runtime/capabilities': capabilityBoundary() })
    assert.match(source('src/renderer/src/lib/terminal-launch.ts'), /executionCapability\('conversation', preset, cwd\)/)
    result.actual = { advertised: desktopContract.supportsConversation('claude', 'darwin') }
    try { evaluate(`(function(){ ${node.body.statements[0].getText(ast)} })()`, { process: { platform: 'darwin', arch } }) }
    catch (error) { result.actual.startupError = error.message }
    assert.equal(Boolean(result.actual.startupError), !result.actual.advertised, 'UI advertises Claude conversation support but startup refuses macOS')
  })
  await check('managed-worker-startup', arch, 'Observe the actual desktop Worker platform gate before downstream tests', async result => {
    const { node, ast } = find('src/main/ipc/superagent-handlers.ts', (node, ast) => ts.isNewExpression(node) && node.expression.getText(ast) === 'SuperAgentWorkers')
    const launch = node.arguments[3]
    try { await evaluate(`(async function(){ ${launch.body.statements.slice(0, 3).map(statement => statement.getText(ast)).join('\n')} })()`, {
      settings: { defaults: { resolveBackend: async () => 'codex' } }, backend: 'codex', ...capabilityBoundary(),
      localRuntimeContext: () => ({ identity: { kind: 'local', platform: 'darwin', architecture: arch } }),
    }) }
    catch (error) {
      if (!error.message.includes('does not support managed-worker')) throw error
      result.status = 'blocked'; result.actual = error.message
    }
  })
  await check('MAC-09-tools-architecture', arch, 'Private npm tools are isolated across native arm64 and Rosetta x64', async result => {
    function prefix(targetArch) {
      const environment = cliBoundary(targetArch).load('src/main/platform/environment.ts')
      return load('src/main/external-cli/managed-paths.ts', { electron: { app: { getPath: () => '/Users/probe/Library/Application Support/JanusX' } },
        'node:fs': { existsSync: () => true }, 'node:path': posix, 'node:os': { homedir: () => '/Users/probe' },
        './search-paths': load('src/main/external-cli/search-paths.ts', { '../platform/environment': environment }), '../platform/environment': environment }, { process: { platform: 'darwin', arch: targetArch } }).managedCliPaths().prefix
    }
    result.actual = { arm64: prefix('arm64'), x64: prefix('x64') }
    assert.notEqual(result.actual.arm64, result.actual.x64, 'Both architectures share the npm tools prefix')
  })
  for (const scenario of [{ name: 'term', group: true }, { name: 'escalation', group: true, stubborn: true }, { name: 'foreign-group', group: false }]) {
    await check(`MAC-10-process-${scenario.name}`, arch, 'Owned groups stop with TERM/KILL; inherited groups are not signalled', async result => {
      const boundary = processBoundary(arch, scenario)
      await boundary.stopProcessTree({ pid: 731 }, { processGroup: true, graceMs: 0 })
      result.actual = boundary.signals
      assert.deepEqual(boundary.signals[0], [scenario.group ? -731 : 731, 'SIGTERM'])
      if (scenario.stubborn) assert.deepEqual(boundary.signals[1], [-731, 'SIGKILL'])
    })
  }
  await check('MAC-10-permission-failure', arch, 'Permission denial remains an unconfirmed cleanup error', async result => {
    const boundary = processBoundary(arch, { denied: true })
    await assert.rejects(boundary.stopProcessTree({ pid: 731 }, { processGroup: true }), { code: 'EPERM' })
    result.actual = 'EPERM propagated'
  })
  await check('MAC-05-update-guard', arch, 'Mac update guard reports its unsupported boundary', async result => {
    const guards = load('src/main/updater/guards.ts', {})
    result.actual = guards.resolveUnsupportedReason({ platform: 'darwin', isPackaged: true })
    assert.equal(result.actual, 'non-windows-p0')
  })
}

await check('MAC-07-native-inventory', 'both', 'Both Mach-O PTY targets and spawn helpers exist with the requested CPU type', async result => {
  result.evidence = 'host-file-inspection'; result.actual = []
  for (const [arch, cpu] of [['arm64', 0x0100000c], ['x64', 0x01000007]]) {
    for (const binary of ['pty.node', 'spawn-helper']) {
      const file = `node_modules/node-pty/prebuilds/darwin-${arch}/${binary}`
      const bytes = Buffer.from(readFileSync(path.join(root, file)))
      sources.set(file, createHash('sha256').update(bytes).digest('hex'))
      assert.equal(bytes.readUInt32LE(0), 0xfeedfacf); assert.equal(bytes.readUInt32LE(4), cpu)
      result.actual.push({ arch, binary, bytes: bytes.length })
    }
  }
  const config = parse(source('electron-builder.yml'))
  assert.ok(config.asarUnpack.includes('node_modules/node-pty/**/*'))
})
for (const arch of ['arm64', 'x64']) await check('office-resource-to-package-to-runtime', arch, 'Actual OfficeCLI bytes pass the builder hook and agree with runtime paths and hashes', async result => {
  result.evidence = 'host-file-and-packaging-hook'
  const { checkOfficecliResource } = await import('./officecli-resources.mjs')
  const { default: beforePack } = await import('./officecli-before-pack.cjs')
  source('scripts/officecli-resources.mjs'); source('scripts/officecli-before-pack.cjs'); source('scripts/check-macos-resources.mjs')
  const { Arch } = await import('builder-util')
  const release = JSON.parse(source('src/shared/officecli-release.json'))
  const runtime = load('src/main/office/office-bundled-path.ts', { 'node:path': posix, '../../shared/officecli-release.json': { default: release } })
  let resource
  try { resource = await checkOfficecliResource({ root, platform: 'darwin', arch }) }
  catch (error) { result.status = 'blocked'; result.actual = error.message; return }
  await beforePack({ electronPlatformName: 'darwin', arch: Arch[arch], packager: { projectDir: root } })
  const bytes = readFileSync(resource.binary), hash = createHash('sha256').update(bytes).digest('hex')
  sources.set(path.relative(root, resource.binary).replaceAll('\\', '/'), hash)
  assert.equal(bytes.readUInt32LE(0), 0xfeedfacf)
  assert.equal(bytes.readUInt32LE(4), arch === 'arm64' ? 0x0100000c : 0x01000007)
  assert.equal(hash, runtime.expectedBundledOfficecliSha256(arch, 'darwin'))
  const packaged = runtime.resolveBundledOfficecliBinary({ platform: 'darwin', arch, env: {}, resourcesPath: '/Applications/JanusX.app/Contents/Resources' })
  const config = parse(source('electron-builder.yml')), relativeTarget = config.mac.extraResources[0].to.replace('${arch}', arch)
  assert.equal(packaged, posix.join('/Applications/JanusX.app/Contents/Resources', relativeTarget))
  assert.ok(new RegExp(config.mac.signIgnore[0]).test(packaged))
  result.actual = { bytes: bytes.length, sha256: hash, packagedPath: packaged, nativeExecution: 'not-run' }
})
await check('MAC-11-minimum-os', 'both', 'A minimum macOS release is declared for the distribution', async result => {
  const config = parse(source('electron-builder.yml'))
  result.actual = config.mac.minimumSystemVersion ?? null
  assert.ok(result.actual, 'minimumSystemVersion is not declared; the common dependency floor is unverified')
})
for (const [id, expected] of [
  ['finder-and-dock', 'Actual Finder environment, Dock activation and native window behavior'],
  ['native-pty-and-cli', 'Mach-O loading, PTY helper permissions, real CLI login/execute/cancel'],
  ['office-preview', 'Real Mac Office creation/edit/preview and signed-binary checksum'],
  ['cmd-q-and-processes', 'Real Mac process-group ownership, descendant and port cleanup after Cmd+Q'],
  ['signed-install-and-update', 'Signed/notarized DMG/ZIP download, Gatekeeper and version-to-version upgrade'],
]) results.push({ id, arch: 'both', evidence: 'macos-native', status: 'not-run', expected, reason: `Host is ${process.platform}/${process.arch}; no Mac execution environment attached` })

source('scripts/probe-macos-compatibility.mjs'); source('package.json')
const report = { schema: 'janusx-macos-probe/1', generatedAt: new Date().toISOString(), host: { platform: process.platform, arch: process.arch, node: process.version },
  boundary: 'Real source with explicit system doubles. No native Mac binary execution or packaged Mac end-to-end claim.',
  sources: Object.fromEntries(sources), summary: Object.fromEntries(['passed', 'failed', 'blocked', 'error', 'not-run'].map(status => [status, results.filter(result => result.status === status).length])), results }
const destination = path.resolve(root, process.argv[2] ?? 'artifacts/macos-compatibility/source-probes.json')
mkdirSync(path.dirname(destination), { recursive: true }); writeFileSync(destination, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ report: destination, summary: report.summary }))
process.exitCode = report.summary.failed || report.summary.blocked || report.summary.error ? 1 : 0
