// Freeze the working-tree baseline before edits, then compare the candidate.
import { build } from 'esbuild'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { performance, monitorEventLoopDelay } from 'node:perf_hooks'

const root = process.cwd()
const directory = resolve(root, process.env.JANUSX_PERF_DIRECTORY || 'artifacts/terminal-startup-investigation')
await mkdir(directory, { recursive: true })
const file = resolve(root, 'src/main/terminal/turn-file-snapshot.ts')
if (process.argv.includes('--freeze')) {
  await writeFile(resolve(directory, 'baseline-snapshot.ts'), await readFile(file))
  console.log('Saved working-tree baseline')
} else {
  const modules = {}
  for (const label of ['before', 'after']) {
    const source = await readFile(label === 'before' ? resolve(directory, 'baseline-snapshot.ts') : file, 'utf8')
    await writeFile(resolve(directory, `${label}-snapshot.ts`), source)
    const outfile = resolve(directory, `${label}.mjs`)
    await build({ stdin: { contents: source, loader: 'ts', resolveDir: resolve(root, 'src/main/terminal') }, outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external' })
    modules[label] = await import(pathToFileURL(outfile).href)
  }
  const results = []
  for (let sample = 0; sample < 3; sample++) for (const label of sample % 2 ? ['after', 'before'] : ['before', 'after']) {
    const lag = monitorEventLoopDelay({ resolution: 10 }); lag.enable()
    const start = performance.now()
    const snapshot = await modules[label].captureTurnFiles(root, undefined, { background: false })
    const elapsedMs = performance.now() - start
    const digest = createHash('sha256')
    for (const entry of snapshot) digest.update(JSON.stringify(entry))
    const result = { label, sample, elapsedMs, files: snapshot.size, digest: digest.digest('hex'), maxLagMs: lag.max / 1e6 }
    lag.disable(); results.push(result); console.log(JSON.stringify(result))
  }
  await writeFile(resolve(directory, 'snapshot.json'), JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2))
  if (new Set(results.map(row => row.digest)).size !== 1) throw Error('Snapshots differ')
}
