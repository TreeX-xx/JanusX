// Real Electron utilityProcess probe; a Node child-process unit test alone is insufficient.
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const require = createRequire(import.meta.url)
const directory = await mkdtemp(join(tmpdir(), 'janus-native-probe-'))
const childEntry = join(directory, 'service.cjs'), mainEntry = join(directory, 'main.cjs')
try {
  await build({ stdin: { contents: `
    import { startNativePlugin } from './packages/plugin-sdk/src/native'
    import { DatabaseSync } from 'node:sqlite'
    import { writeFile } from 'node:fs/promises'
    import { join } from 'node:path'
    startNativePlugin(async (context, host) => {
      const db = new DatabaseSync(join(context.directory, 'state.sqlite'))
      db.exec('CREATE TABLE IF NOT EXISTS state(value TEXT)')
      return { async call(method, value, signal) {
        if (method === 'echo') return { value, pid: process.pid, node: process.versions.node }
        if (method === 'host') return host.call('probe.host', value)
        if (method === 'crash') process.exit(7)
        if (method === 'wait') { await new Promise(resolve => setTimeout(resolve, 100)); return 'late' }
        throw new Error('Unknown method')
      }, async stop() { db.close(); await writeFile(join(context.directory, 'closed'), 'yes') } }
    })`, resolveDir: process.cwd(), loader: 'ts' }, outfile: childEntry, bundle: true, platform: 'node', format: 'cjs', target: 'node22', logLevel: 'silent' })
  await build({ stdin: { contents: `
    import { app, utilityProcess } from 'electron'
    import { writeFile, readFile } from 'node:fs/promises'
    import { join } from 'node:path'
    import assert from 'node:assert/strict'
    import { NativePluginService } from './src/main/plugins/native-service'
    app.disableHardwareAcceleration()
    app.whenReady().then(async () => {
      const failures = [], pids = []
      const create = () => new NativePluginService({ host: async (method, value) => ({ method, value }), stopped: code => failures.push(code),
        spawn(generation) {
          const child = utilityProcess.fork(${JSON.stringify(childEntry)}, ['--janusx-native-generation=' + generation], { stdio: 'pipe', serviceName: 'JanusX native probe' })
          child.once('spawn', () => pids.push(child.pid))
          return { send: packet => child.postMessage(packet), listen: listener => { child.on('message', listener); return () => child.off('message', listener) },
            exited: listener => { child.on('exit', listener); return () => child.off('exit', listener) }, terminate: () => child.kill() }
        } })
      const service = create()
      await service.start({ directory: ${JSON.stringify(directory)} })
      const echoed = await service.call('echo', 'native')
      assert.notEqual(echoed.pid, process.pid)
      assert.equal(echoed.value, 'native')
      assert.deepEqual(await service.call('host', 'callback'), { method: 'probe.host', value: 'callback' })
      const controller = new AbortController()
      const cancelled = assert.rejects(service.call('wait', null, controller.signal), /CANCELLED/)
      controller.abort(); await cancelled
      await service.shutdown()
      assert.equal(await readFile(join(${JSON.stringify(directory)}, 'closed'), 'utf8'), 'yes')
      const crashed = create()
      await crashed.start({ directory: ${JSON.stringify(directory)} })
      await assert.rejects(crashed.call('crash', null), /SERVICE_STOPPED/)
      assert.deepEqual(failures, ['SERVICE_STOPPED', 'SERVICE_EXITED'])
      await writeFile(${JSON.stringify(join(directory, 'receipt.json'))}, JSON.stringify({ electron: process.versions.electron,
        node: echoed.node, platform: process.platform, arch: process.arch, separateProcesses: pids.length,
        sqlite: true, hostCallback: true, cancellation: true, gracefulShutdown: true, crashIsolation: true }))
      app.exit(0)
    }).catch(error => { console.error(error); app.exit(1) })
  `, resolveDir: process.cwd(), loader: 'ts' }, outfile: mainEntry, bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'],
    alias: { '@janusx/plugin-sdk': resolve('packages/plugin-sdk/src/native-protocol.ts') }, logLevel: 'silent' })
  const { ELECTRON_RUN_AS_NODE: _node, NODE_OPTIONS: _options, ...env } = process.env
  await new Promise((accept, reject) => {
    const child = spawn(require('electron'), [mainEntry], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let diagnostics = ''
    child.stdout.on('data', bytes => { diagnostics = (diagnostics + bytes).slice(-8000) })
    child.stderr.on('data', bytes => { diagnostics = (diagnostics + bytes).slice(-8000) })
    const timer = setTimeout(() => { child.kill(); reject(new Error('Native Electron probe timed out')) }, 45_000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => { clearTimeout(timer); code === 0 ? accept() : reject(new Error(`Native Electron probe failed (${code}): ${diagnostics}`)) })
  })
  const receipt = JSON.parse(await readFile(join(directory, 'receipt.json'), 'utf8'))
  await mkdir('artifacts/plugins', { recursive: true })
  await writeFile('artifacts/plugins/native-probe.json', JSON.stringify({ ...receipt, testedAt: new Date().toISOString() }, null, 2) + '\n')
  console.log(JSON.stringify(receipt))
} finally { await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
