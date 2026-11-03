// Compare serial vs overlapping real CLI version probing and production capture.
// This excludes agent session creation, PTY startup and renderer readiness.
import { build } from 'esbuild'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import { createHash } from 'node:crypto'

const directory = resolve('artifacts/terminal-startup-round2')
await mkdir(directory, { recursive: true })
const outfile = join(directory, 'capture.mjs')
await build({ stdin: { contents: 'export { captureTurnFiles } from "./src/main/terminal/turn-file-snapshot.ts";', resolveDir: process.cwd(), loader: 'ts' }, outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external' })
const { captureTurnFiles } = await import(pathToFileURL(outfile).href)
const binary = process.env.JANUSX_TEST_CLAUDE_BIN || join(process.env.APPDATA, 'npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe')
const exec = promisify(execFile)
const results = []
for (let sample = 0; sample < 3; sample++) for (const label of sample % 2 ? ['parallel', 'serial'] : ['serial', 'parallel']) {
  let preparationMs, baselineMs, snapshot
  const start = performance.now()
  const prepare = async () => { const t = performance.now(); await exec(binary, ['--version'], { windowsHide: true, timeout: 10000 }); preparationMs = performance.now() - t }
  const capture = async () => { const t = performance.now(); snapshot = await captureTurnFiles(process.cwd(), undefined, { background: false }); baselineMs = performance.now() - t }
  if (label === 'serial') { await prepare(); await capture() }
  else await Promise.all([prepare(), capture()])
  const totalMs = performance.now() - start
  const digest = createHash('sha256'); for (const entry of snapshot) digest.update(JSON.stringify(entry))
  const result = { label, sample, preparationMs, baselineMs, totalMs, files: snapshot.size, digest: digest.digest('hex') }
  results.push(result); console.log(JSON.stringify(result))
}
await writeFile(join(directory, 'preparation.json'), JSON.stringify({ timestamp: new Date().toISOString(), scope: 'CLI version + real foreground capture, serial versus parallel; no agent session or UI', results }, null, 2))
await writeFile(join(directory, 'parallel-terminal-handlers.ts'), await readFile('src/main/ipc/terminal-handlers.ts'))
if (new Set(results.map(row => row.digest)).size !== 1) throw Error('Snapshot digests differ')
