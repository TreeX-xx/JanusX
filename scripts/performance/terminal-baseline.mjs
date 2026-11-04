// Compare production pre-launch tracking against a pinned Git revision.
// Reads the chosen workspace; PTYs run only a ready marker, never an agent CLI.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { cpus, release } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import { build } from 'esbuild'
import pty from 'node-pty'

const exec = promisify(execFile)
const repository = resolve(import.meta.dirname, '../..')
const workspace = resolve(process.argv[2] ?? repository)
const revision = (await exec('git', ['rev-parse', process.argv[3] ?? 'HEAD'], { cwd: repository })).stdout.trim()
const directory = join(repository, 'artifacts/terminal-startup-performance')
await mkdir(directory, { recursive: true })
const modules = {}
for (const label of ['before', 'after']) {
  const outfile = join(directory, `${label}.mjs`)
  await build({
    stdin: {
      contents: 'export { TerminalTurnChangeTracker } from "./src/main/terminal/turn-change-tracker.ts"; export { captureTurnFiles } from "./src/main/terminal/turn-file-snapshot.ts";',
      resolveDir: repository, loader: 'ts',
    },
    outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external',
    plugins: label === 'before' ? [{
      name: 'baseline-revision',
      setup(builder) {
        builder.onLoad({ filter: /turn-(change-tracker|file-snapshot)\.ts$/ }, async ({ path }) => ({
          contents: (await exec('git', ['show', `${revision}:src/main/terminal/${path.split(/[\\/]/).at(-1)}`], { cwd: repository })).stdout,
          loader: 'ts',
        }))
      },
    }] : [],
  })
  modules[label] = await import(pathToFileURL(outfile).href)
}

async function firstPtyOutput() {
  const marker = `JANUS_READY_${randomUUID()}`
  const terminal = process.platform === 'win32'
    ? pty.spawn('cmd.exe', ['/d', '/q', '/c', `echo ${marker}`], { cwd: workspace, cols: 120, rows: 40, useConptyDll: true })
    : pty.spawn('/bin/sh', ['-c', `printf '${marker}\\n'`], { cwd: workspace, cols: 120, rows: 40 })
  let exited = false
  let readyAt
  try {
    await new Promise((resolveReady, reject) => {
      let output = ''
      const timeout = setTimeout(() => reject(Error('PTY ready marker timeout')), 10000)
      terminal.onData(data => {
        output += data
        if (output.includes(marker) && readyAt === undefined) readyAt = performance.now()
      })
      terminal.onExit(() => {
        exited = true
        clearTimeout(timeout)
        if (readyAt === undefined) reject(Error('PTY exited before marker'))
        else resolveReady()
      })
    })
    return readyAt
  } finally { if (!exited) terminal.kill() }
}

const results = []
for (let sample = 0; sample < 3; sample++) {
  // Alternate order to reduce the bias of filesystem caching.
  for (const label of sample % 2 ? ['after', 'before'] : ['before', 'after']) {
    const { TerminalTurnChangeTracker, captureTurnFiles } = modules[label]
    let snapshot
    const tracker = new TerminalTurnChangeTracker(() => {}, async (...args) => {
      snapshot = await captureTurnFiles(...args)
      return snapshot
    }, error => { throw error })
    const lag = monitorEventLoopDelay({ resolution: 10 })
    lag.enable()
    const start = performance.now()
    try {
      await tracker.register('benchmark', workspace)
      const registrationMs = performance.now() - start
      const firstOutputMs = await firstPtyOutput() - start
      const digest = createHash('sha256')
      for (const entry of snapshot) digest.update(JSON.stringify(entry))
      const result = {
        label, sample, files: snapshot.size, digest: digest.digest('hex'),
        registrationMs: Math.round(registrationMs), firstOutputMs: Math.round(firstOutputMs),
        maxEventLoopDelayMs: Math.round(lag.max / 1e6),
      }
      results.push(result)
      console.log(JSON.stringify(result))
    } finally { lag.disable(); tracker.unregister('benchmark') }
  }
}
if (new Set(results.map(result => result.digest)).size !== 1) throw Error('Snapshot results differ; workspace may have changed during sampling')
const report = {
  baselineRevision: revision, timestamp: new Date().toISOString(), workspace,
  platform: process.platform, os: release(), cpu: cpus()[0].model, node: process.version,
  scope: 'Production tracker registration followed by real PTY marker; excludes Electron, hook setup, agent CLI and renderer paint. OS cache not flushed.',
  results,
}
await writeFile(join(directory, 'result.json'), JSON.stringify(report, null, 2) + '\n')
// Keep source copies so results remain reviewable after HEAD advances.
for (const name of ['turn-change-tracker.ts', 'turn-file-snapshot.ts']) {
  await writeFile(join(directory, `after-${name}`), await readFile(join(repository, 'src/main/terminal', name)))
}
// All PTYs have exited and writes are complete. Bundled ConPTY can retain a
// worker handle after onExit; a standalone probe must not wait on that handle.
process.exit(0)
