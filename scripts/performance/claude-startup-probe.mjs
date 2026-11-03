// Real native CLI, isolated profile and localhost model. No user sessions touched.
import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { performance } from 'node:perf_hooks'
import pty from 'node-pty'

const directory = resolve('artifacts/claude-startup-performance')
await mkdir(directory, { recursive: true })
const binary = process.env.JANUSX_TEST_CLAUDE_BIN || join(process.env.APPDATA, 'npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe')
const exec = promisify(execFile)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function bundle(label) {
  const outfile = join(directory, `${label}.mjs`)
  await build({ stdin: { contents: 'export { ClaudeConversation } from "./src/main/terminal/claude-conversation.ts"; export { claudeConversationFixture } from "./tests/helpers/claude-conversation-fixture.ts";', resolveDir: process.cwd(), loader: 'ts' },
    outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external', plugins: [{ name: 'raw', setup(builder) {
      builder.onResolve({ filter: /\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'raw' }))
      builder.onLoad({ filter: /.*/, namespace: 'raw' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text' }))
    } }] })
  await writeFile(join(directory, `${label}-claude-conversation.ts`), await readFile('src/main/terminal/claude-conversation.ts'))
}
if (process.argv.includes('--freeze')) { await bundle('before'); process.exit(0) }
const baselineOnly = process.argv.includes('--baseline')
if (!baselineOnly) await bundle('after')
const modules = { before: await import(pathToFileURL(join(directory, 'before.mjs')).href) }
if (!baselineOnly) modules.after = await import(pathToFileURL(join(directory, 'after.mjs')).href)
const fixture = await modules.before.claudeConversationFixture()
let setup, exited = false, output = ''
const results = []
const until = async (fn, label) => {
  const end = Date.now() + 25000
  while (!fn()) { if (Date.now() > end) throw Error(`${label}: ${output.slice(-1500)}`); await delay(50) }
}
try {
  const version = (await exec(binary, ['--version'], { env: fixture.env, windowsHide: true })).stdout.trim()
  console.log(JSON.stringify({ version }))
  setup = pty.spawn(binary, ['--model', 'claude-sonnet-4-6', '--tools', ''], { cwd: fixture.cwd, env: fixture.env, cols: 130, rows: 36 })
  setup.onData(data => { output += data }); setup.onExit(() => { exited = true })
  const clean = () => output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\s/g, '')
  await until(() => output.includes('trust'), 'trust')
  await delay(1200); setup.write('\x1b[B'); await delay(200); setup.write('\r'); await delay(1500)
  await until(() => clean().includes('DoyouwanttousethisAPIkey'), 'fixture API key')
  setup.write('\x1b[A'); await delay(200); setup.write('\r')
  await until(() => clean().includes('Sonnet4.6'), 'setup ready')
  await exec('taskkill', ['/PID', String(setup.pid), '/T', '/F'], { windowsHide: true })
  await until(() => exited, 'setup exit')
  for (let sample = 0; sample < (baselineOnly ? 1 : 3); sample++) {
    for (const label of baselineOnly ? ['before'] : sample % 2 ? ['after', 'before'] : ['before', 'after']) {
      const stages = [], started = performance.now()
      const controller = new modules[label].ClaudeConversation(`probe-${label}-${sample}`, () => {})
      const original = controller.cli.bind(controller)
      controller.cli = async (args, timeout) => {
        const start = performance.now()
        try { return await original(args, timeout) }
        finally { stages.push({ stage: args.includes('--bg') ? 'dispatch' : args[0], startMs: start - started, elapsedMs: performance.now() - start }) }
      }
      try {
        await controller.start({ command: binary, args: ['--model', 'claude-sonnet-4-6', '--tools', ''], cwd: fixture.cwd,
          env: { ...fixture.env, JANUSX_HOOK_TERMINAL_ID: controller.id }, assetsDir: join(fixture.root, 'assets') })
        const result = { label, sample, totalMs: performance.now() - started, stages: [...stages], connection: controller.snapshot().connection }
        results.push(result); console.log(JSON.stringify(result))
        if (fixture.requests.length) throw Error('Startup unexpectedly called the model')
      } finally { await controller.dispose() }
    }
  }
  await writeFile(join(directory, baselineOnly ? 'initial.json' : 'comparison.json'), JSON.stringify({ timestamp: new Date().toISOString(), version, results, modelRequests: fixture.requests.length }, null, 2))
} finally {
  if (setup && !exited) await exec('taskkill', ['/PID', String(setup.pid), '/T', '/F'], { windowsHide: true }).catch(() => {})
  await exec(binary, ['daemon', 'stop', '--any'], { env: fixture.env, cwd: fixture.cwd, windowsHide: true, timeout: 10000 }).catch(() => {})
  await fixture.close()
}
process.exit(0)
