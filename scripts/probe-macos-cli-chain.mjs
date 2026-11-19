// Source-level macOS simulation. This does not execute Mach-O binaries or a Mac PTY.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const root = process.cwd()
const output = path.resolve('artifacts/cli-chain/mac-simulation')
await fsp.mkdir(output, { recursive: true })
const sandbox = await fsp.mkdtemp(path.join(output, 'sandbox-'))
const results = [], hashes = {}
const home = '/Users/Mac 中文'
function mapped(file) {
  assert.equal(typeof file, 'string')
  assert.ok(file.startsWith('/'), `Unexpected host path: ${file}`)
  const target = path.resolve(sandbox, '.' + path.posix.normalize(file))
  assert.ok(target.startsWith(sandbox + path.sep))
  return target
}
async function put(file, content) {
  await fsp.mkdir(path.dirname(mapped(file)), { recursive: true })
  await fsp.writeFile(mapped(file), content)
}
async function packageFile(directory, name, version) { await put(directory + '/package.json', JSON.stringify({ name, version })) }
function loader(arch) {
  const env = { HOME: home, SHELL: '/bin/zsh', PATH: '/usr/bin:/bin', DSH_HOME: home + '/custom-dsh' }
  const cache = new Map(), calls = [], versions = new Map()
  const asyncFs = { ...fsp }, syncFs = { ...fs }
  for (const method of ['stat', 'readFile', 'writeFile', 'mkdir', 'rm']) asyncFs[method] = (file, ...args) => fsp[method](mapped(file), ...args)
  for (const method of ['existsSync', 'statSync', 'readFileSync', 'accessSync']) syncFs[method] = (file, ...args) => fs[method](mapped(file), ...args)
  syncFs.realpathSync = file => '/' + path.relative(sandbox, fs.realpathSync(mapped(file))).replaceAll('\\', '/')
  const builtins = {
    '@janusx/llm-core/mac-system-proxy': { macProxyEnvironment: env => env },
    'node:path': { ...path.posix, win32: path.win32 },
    'node:os': { homedir: () => home }, 'node:fs': syncFs, 'node:fs/promises': asyncFs,
    electron: { app: { getPath: () => home + '/Library/Application Support/JanusX-' + arch } },
    execa: { execa: async (file, args, options) => {
      calls.push({ file, args: [...args], path: options?.env?.PATH })
      if (args[0] === 'plugin') {
        const companion = '@deepseek-harness-tui/dsh-tui'
        const version = args.at(-1).slice(companion.length + 1)
        const directory = env.DSH_HOME + '/profiles/dsh-tui/node_modules/' + companion
        await packageFile(directory, companion, version)
        await put(directory + '/lib/types/index.js', 'export {}')
        return { exitCode: 0, stdout: '', stderr: '' }
      }
      return { exitCode: 0, stdout: versions.get(file) ?? '1.2.3', stderr: '' }
    } },
  }
  function load(relative) {
    const file = path.resolve(root, relative)
    if (cache.has(file)) return cache.get(file).exports
    const module = { exports: {} }; cache.set(file, module)
    const source = fs.readFileSync(file)
    hashes[path.relative(root, file).replaceAll('\\', '/')] = createHash('sha256').update(source).digest('hex')
    // Source moved to the common process host. Keep execution simulated at its
    // public boundary; process-host itself has separate native contract tests.
    if (file === path.resolve(root, 'src/main/platform/process-host/index.ts')) {
      const run = async (program, args, options) => ({ status: 'exited', truncated: false, ...await builtins.execa.execa(program, args, options) })
      module.exports = { runProcess: run, runChecked: run }
      return module.exports
    }
    const code = ts.transpileModule(source.toString('utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
    vm.runInNewContext(code, { module, exports: module.exports, require(name) {
      if (Object.hasOwn(builtins, name)) return builtins[name]
      if (name.startsWith('node:')) return require(name)
      assert.ok(name.startsWith('.'), `Unexpected external module: ${name}`)
      const target = path.resolve(path.dirname(file), name)
      const found = [target, target + '.ts', path.join(target, 'index.ts')].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
      assert.ok(found, `Unresolved source module: ${name}`)
      return load(found)
    }, process: { platform: 'darwin', arch, env }, console, Buffer, URL, setTimeout, clearTimeout }, { filename: file })
    return module.exports
  }
  return { env, calls, versions, load }
}
async function check(arch, name, run) {
  try { await run(); results.push({ arch, name, status: 'passed' }) }
  catch (error) { results.push({ arch, name, status: 'failed', error: error.stack }) }
}

try {
  for (const arch of ['arm64', 'x64']) {
    const l = loader(arch)
    const { CliDetector } = l.load('src/main/external-cli/cli-detector.ts')
    const { resolveCLIPath } = l.load('src/main/janus-runner/cli-resolver.ts')
    const { managedCliPaths, managedCliEnv } = l.load('src/main/external-cli/managed-paths.ts')
    const { mergeLoginEnvironment } = l.load('src/main/external-cli/login-environment.ts')
    const { verifyManagedInstall, dshProfileHint } = l.load('src/main/external-cli/managed-install.ts')
    const { CliInstaller } = l.load('src/main/external-cli/installer.ts')
    const { EXTERNAL_CLI_TOOLS } = l.load('src/main/external-cli/tool-registry.ts')
    const { findCliPackage, requiredCliPackageFile } = l.load('src/main/external-cli/package-location.ts')
    const paths = managedCliPaths()

    await put('/opt/homebrew/bin/pi', '#!/usr/bin/env node')
    await check(arch, 'Finder PATH: Homebrew detection and resolver select the same executable', async () => {
      const probe = await new CliDetector('pi').detect()
      assert.equal(probe.path, '/opt/homebrew/bin/pi')
      assert.equal(probe.runnable, true)
      assert.equal(await resolveCLIPath('pi'), probe.path)
      assert.ok(l.calls.at(-1).path.split(':').includes('/opt/homebrew/bin'))
    })
    await check(arch, 'Login environment restores nvm and custom CLI homes without overwriting explicit overrides', () => {
      const restored = mergeLoginEnvironment(l.env, '\0JANUSX_LOGIN_ENV_START\0PATH=/Users/Mac 中文/.nvm/bin:/opt/homebrew/bin\0DSH_HOME=/wrong\0PI_CODING_AGENT_DIR=/custom/pi\0')
      assert.ok(restored.PATH.startsWith('/Users/Mac 中文/.nvm/bin:'))
      assert.equal(restored.DSH_HOME, l.env.DSH_HOME)
      assert.equal(restored.PI_CODING_AGENT_DIR, '/custom/pi')
    })
    await check(arch, 'Architecture-specific managed prefix preserves legacy tools', async () => {
      assert.ok(paths.prefix.endsWith('tools-darwin-' + arch))
      const legacy = paths.base + '/tools/bin/pi'
      await put(legacy, 'legacy')
      assert.ok(!managedCliEnv().PATH.split(':').includes(path.posix.dirname(legacy)))
      assert.equal(await fsp.readFile(mapped(legacy), 'utf8'), 'legacy')
    })
    await check(arch, 'An external install becomes resolvable after an earlier miss', async () => {
      const command = 'janusx-probe-' + arch
      assert.equal(await resolveCLIPath(command), null)
      await put('/opt/homebrew/bin/' + command, 'fixture')
      assert.equal(await resolveCLIPath(command), '/opt/homebrew/bin/' + command)
    })
    await check(arch, 'Legacy private target verifies only when explicitly selected by PATH', async () => {
      const installer = new CliInstaller({ platform: 'darwin', env: l.env, homeDir: home,
        isRegularFile: async file => { try { return (await fsp.stat(mapped(file))).isFile() } catch { return false } },
        prepareNpm: async () => ({ path: paths.npm, pathDirs: [paths.bin, paths.toolsBin] }), installPrefix: () => paths.prefix,
        run: async (file, args) => {
          assert.equal(file, paths.npm)
          assert.equal(args[args.indexOf('--prefix') + 1], paths.prefix)
          await put(paths.toolsBin + '/pi', '#!/usr/bin/env node')
          await packageFile(paths.prefix + '/lib/node_modules/@earendil-works/pi-coding-agent', '@earendil-works/pi-coding-agent', '1.2.3')
          return { exitCode: 0, stdout: '', stderr: '' }
        }, verifyInstall: (tool, version) => verifyManagedInstall(tool, version) })
      const installed = await installer.install(EXTERNAL_CLI_TOOLS.pi)
      assert.equal(installed.success, true)
      assert.ok(!managedCliEnv().PATH.split(':').includes(paths.toolsBin))
      l.env.PATH = paths.toolsBin + ':' + paths.bin + ':' + l.env.PATH
      const probe = await new CliDetector('pi').detect()
      assert.equal(probe.path, installed.target.path)
      assert.equal(probe.version, installed.target.version)
      assert.equal(await resolveCLIPath('pi'), installed.target.path)
      assert.ok(managedCliEnv().PATH.startsWith(paths.toolsBin + ':'))
    })
    await check(arch, 'A mismatched package version cannot pass installation verification', async () => {
      await assert.rejects(verifyManagedInstall(EXTERNAL_CLI_TOOLS.pi, '9.9.9'), /Could not verify/)
    })
    await check(arch, 'Pi POSIX package lookup and hoisted DSH dependency lookup', async () => {
      assert.equal(findCliPackage(paths.toolsBin + '/pi', '@earendil-works/pi-coding-agent'), paths.prefix + '/lib/node_modules/@earendil-works/pi-coding-agent')
      const dsh = paths.prefix + '/lib/node_modules/@deepseek-ai/dsh'
      const llm = paths.prefix + '/lib/node_modules/@deepseek-ai/dsh-llm'
      await packageFile(dsh, '@deepseek-ai/dsh', '1.2.3')
      await packageFile(llm, '@deepseek-ai/dsh-llm', '1.2.3')
      await put(llm + '/lib/index.js', 'export {}')
      assert.equal(requiredCliPackageFile(dsh + '/package.json', '@deepseek-ai/dsh-llm', 'lib/index.js'), llm + '/lib/index.js')
    })
    await check(arch, 'DSH install prepares a pinned TUI profile and verifies it instead of accepting a bare dsh', async () => {
      await fsp.rm(mapped(l.env.DSH_HOME), { recursive: true, force: true })
      assert.match(await dshProfileHint(), /missing or incomplete/)
      await put(paths.toolsBin + '/dsh', '#!/usr/bin/env node')
      const companion = '@deepseek-harness-tui/dsh-tui'
      await packageFile(paths.prefix + '/lib/node_modules/' + companion, companion, '0.20.0')
      const target = await verifyManagedInstall(EXTERNAL_CLI_TOOLS.dsh, 'latest')
      assert.equal(target.path, paths.toolsBin + '/dsh')
      assert.equal(await dshProfileHint(), undefined)
      assert.equal(l.calls.at(-1).args.at(-1), companion + '@0.20.0')
    })
  }
} finally {
  assert.ok(path.resolve(sandbox).startsWith(output + path.sep))
  await fsp.rm(sandbox, { recursive: true, force: true })
}
const report = { generatedAt: new Date().toISOString(), host: `${process.platform}-${process.arch}`, sourceHashes: hashes,
  summary: { passed: results.filter(r => r.status === 'passed').length, failed: results.filter(r => r.status === 'failed').length },
  boundaries: 'Real TypeScript modules and filesystem fixtures; Darwin process, npm, shell and CLI execution are simulated. Real Mac kernel, Mach-O, PTY, accounts and network model calls are not-run.', results }
await fsp.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report.summary))
process.exitCode = report.summary.failed ? 1 : 0
