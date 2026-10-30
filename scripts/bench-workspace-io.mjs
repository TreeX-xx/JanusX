// Note: .agents/notes/planning/workspace-data-contract-baseline.md
// Isolated, reproducible before/after probe; never touches a user's workspace data.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir, platform, release, cpus } from 'node:os'
import { resolve, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { performance, monitorEventLoopDelay } from 'node:perf_hooks'
import { build } from 'esbuild'

const exec = promisify(execFile)
const core = resolve('../janus-agentX')
const source = 'packages/agent-core/src/main/agent/checkpoint'
const scratch = await mkdtemp(join(tmpdir(), 'janus-io-baseline-'))
const reportPath = resolve(process.argv[2] || 'artifacts/workspace-io-baseline.json')
const baselineRevision = '25397cad9cb898973e84492ecfe50599201e902c'
const fileCount = 2048
try {
  const { stdout: revision } = await exec('git', ['rev-parse', baselineRevision], { cwd: core })
  const { stdout: files } = await exec('git', ['ls-tree', '-r', '--name-only', baselineRevision, source], { cwd: core })
  const baseline = join(scratch, 'baseline-source')
  await mkdir(baseline)
  for (const file of files.trim().split('\n')) {
    const { stdout } = await exec('git', ['show', `${baselineRevision}:${file}`], { cwd: core, maxBuffer: 4 * 1024 * 1024 })
    await writeFile(join(baseline, relative(source, file)), stdout)
  }
  const results = []
  for (const [name, entry] of [
    ['before', join(baseline, 'checkpoint-manager.ts')],
    ['after', join(core, source, 'checkpoint-manager.ts')],
  ]) {
    const bundle = join(scratch, `${name}.mjs`)
    await build({ entryPoints: [entry], outfile: bundle, bundle: true, platform: 'node', format: 'esm' })
    const { CheckpointManager } = await import(pathToFileURL(bundle).href)
    const root = join(scratch, name)
    await mkdir(root)
    // Identical 4 KiB sources; fixture generation is outside measurement.
    for (let i = 0; i < fileCount; i++) await writeFile(join(root, `${String(i).padStart(5, '0')}.txt`), `file ${i}\n`.padEnd(4096, 'x'))
    const manager = new CheckpointManager()
    await manager.initialize(root)
    const lag = monitorEventLoopDelay({ resolution: 10 })
    lag.enable()
    const started = performance.now()
    const checkpoints = await Promise.all(Array.from({ length: 8 }, (_, i) => manager.createCheckpoint({
      cwd: root, terminalId: `t${i}`, engine: 'manual', prompt: 'baseline',
    })))
    const captureMs = performance.now() - started
    let scans = 0, activeScans = 0, peakScans = 0
    const scan = manager.captureWorkspaceHashIndex.bind(manager)
    manager.captureWorkspaceHashIndex = async (...args) => {
      scans++; activeScans++; peakScans = Math.max(peakScans, activeScans)
      try { return await scan(...args) } finally { activeScans-- }
    }
    const queryStart = performance.now()
    await Promise.all(Array.from({ length: 20 }, () => manager.getChangedFileCounts(checkpoints.map(cp => cp.id), root)))
    const queryMs = performance.now() - queryStart
    lag.disable()
    results.push({ name, captureMs: Math.round(captureMs), queryMs: Math.round(queryMs),
      queryScans: scans, peakQueryScans: peakScans,
      uniqueConversationIndices: new Set(checkpoints.map(cp => cp.conversationIndex)).size,
      eventLoopMaxMs: Math.round(lag.max / 1e6), rssMiB: Math.round(process.memoryUsage().rss / 1024 / 1024) })
    // Let any idle cleanup finish before removing this script's private fixture.
    while (manager.gcPending?.size) await new Promise(resolve => setTimeout(resolve, 20))
  }
  const report = { measuredAt: new Date().toISOString(), baselineRevision: revision.trim(),
    environment: { platform: platform(), release: release(), cpu: cpus()[0]?.model, node: process.version },
    fixture: { files: fileCount, bytesPerFile: 4096, terminals: 8, simultaneousQueries: 20, cache: 'OS cache uncontrolled; fresh fixtures; same process before then after' },
    limits: 'Measures local elapsed time, scan overlap and event loop delay; not physical disk utilization, slow-HDD validation, UI latency or isolated peak RSS.', results }
  await mkdir(resolve(reportPath, '..'), { recursive: true })
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
} finally {
  const safe = relative(tmpdir(), scratch)
  if (!safe.startsWith('janus-io-baseline-') || safe.includes('..')) throw new Error('Unsafe benchmark cleanup path')
  await rm(scratch, { recursive: true, force: true })
}
