// Note: .agents/notes/planning/workspace-data-lifecycle-plan.md
// P6 fault injection uses disposable directories and separate Node processes.
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir, release, cpus } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { performance, monitorEventLoopDelay } from 'node:perf_hooks'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'

const script = fileURLToPath(import.meta.url)
const digest = value => createHash('sha256').update(value).digest('hex')

if (process.argv[2] === '--worker') {
  const [bundle, cwd, profile, action, pause] = process.argv.slice(3)
  const { WorkspaceStateStore, WORKSPACE_RETENTION_MS } = await import(pathToFileURL(bundle).href)
  const { workspaceIo, useWorkspaceStorage } = await import('@janus-agent/agent-core')
  const store = new WorkspaceStateStore(profile)
  const records = [{ id: 'w', name: 'P6 fixture', path: cwd }]
  const item = await store.inspect(cwd, 'w', 'P6 fixture')
  const manifestPath = join(item.target, 'manifest.json')
  let count = 0
  const step = workspaceIo.step.bind(workspaceIo)
  workspaceIo.step = async () => {
    await step()
    const committed = existsSync(manifestPath)
    if ((pause === 'copy' && !committed || pause === 'cleanup' && committed) && ++count === 32) {
      process.send({ paused: pause, target: item.target })
      await new Promise(() => {}) // Parent terminates this actual process at a known boundary.
    }
  }
  const lag = monitorEventLoopDelay({ resolution: 10 }); lag.enable()
  const start = performance.now()
  let foreground = false
  if (action === 'migrate') {
    const needsBatches = existsSync(join(cwd, '.janusX', 'checkpoints'))
    let completed = false
    const migration = store.migrate(cwd).then(() => { completed = true })
    await workspaceIo.run(join(profile, 'other-workspace'), async () => {
      if (needsBatches) assert.equal(completed, false, 'foreground work must run before the large migration finishes')
      foreground = true
    })
    await migration
  } else if (action === 'maintain') {
    await store.maintain(records)
    // Cross 30 days by advancing the API clock, never the machine clock.
    const future = Date.now() + WORKSPACE_RETENTION_MS + 60_000
    const unlock = useWorkspaceStorage(cwd)
    await store.maintain(records, future)
    assert.equal((await readdir(join(item.target, 'logs'))).length, 257)
    unlock()
    await store.maintain(records, future)
    assert.deepEqual(await readdir(join(item.target, 'logs')), [])
    await store.sync([], future)
    await store.maintain([], future + WORKSPACE_RETENTION_MS + 1)
    assert.equal(existsSync(item.target), false)
  } else {
    await store.sync(records)
    for (let round = 0; round < 20; round++) {
      const items = await Promise.all(Array.from({ length: 8 }, () => store.inspect(cwd, 'w', 'P6 fixture')))
      assert(items.every(value => value.target === item.target && value.status === 'migrated'))
      await store.maintain(records)
    }
    assert.equal(await store.promptDismissed(), true)
  }
  lag.disable()
  process.send({ done: true, elapsedMs: Math.round(performance.now() - start),
    eventLoopMaxMs: Math.round(lag.max / 1e6), rssMiB: Math.round(process.memoryUsage().rss / 1024 / 1024), foreground,
    target: item.target, status: action === 'maintain' ? 'purged' : (await store.inspect(cwd, 'w', 'P6 fixture')).status })
  process.disconnect()
} else {
  const output = resolve(process.argv[2] || 'artifacts/workspace-storage/p6-lifecycle.json')
  await mkdir(dirname(output), { recursive: true })
  const bundle = join(dirname(output), 'p6-workspace-state.mjs')
  await build({ entryPoints: ['src/main/storage/workspace-state.ts'], outfile: bundle,
    bundle: true, format: 'esm', platform: 'node', packages: 'external' })
  const scratch = await realpath(await mkdtemp(join(tmpdir(), 'janusx-p6-lifecycle-')))
  const cwd = join(scratch, "workspace space's 中文"), profile = join(scratch, 'profile')
  const old = join(cwd, '.janusX')
  const runs = []
  const report = { measuredAt: new Date().toISOString(), node: process.version, os: release(), cpu: cpus()[0]?.model,
    fixture: { logs: 257, logBytes: 48 * 1024 * 1024, snapshots: 4096, restartRounds: 12, concurrentQueries: 8 },
    limits: 'Local filesystem; uncontrolled OS cache. Two real process kills; retention uses an accelerated API clock. Not physical slow-disk, days-long, cross-process writer safety or installer upgrade evidence.', runs }
  async function run(action, pause = '') {
    const child = fork(script, ['--worker', bundle, cwd, profile, action, pause], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true })
    let stderr = '', result
    child.stderr.on('data', data => { stderr += data })
    const started = performance.now()
    await new Promise((resolveRun, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error('P6 worker timed out: ' + stderr)) }, 120_000)
      child.on('message', message => { result = message; if (message.paused) child.kill() })
      child.on('error', error => { clearTimeout(timer); reject(error) })
      child.on('exit', code => {
        clearTimeout(timer)
        if (result?.paused === pause && pause || result?.done && code === 0) resolveRun()
        else reject(new Error(`P6 worker exited ${code}: ${stderr}`))
      })
    })
    runs.push({ action, pause: pause || undefined, processMs: Math.round(performance.now() - started), ...result })
    return result
  }
  try {
    await mkdir(join(old, 'logs'), { recursive: true }); await mkdir(join(old, 'checkpoints'))
    const launch = JSON.stringify({ version: '0.1.0', projectName: 'P6 fixture', projectType: 'custom', configurations: [] })
    await writeFile(join(old, 'janusX.launch.json'), launch)
    const small = Buffer.alloc(64 * 1024, 's'), large = Buffer.alloc(32 * 1024 * 1024, 'L')
    for (let i = 0; i < 256; i++) await writeFile(join(old, 'logs', `command-${i}.log`), small)
    await writeFile(join(old, 'logs', 'large.log'), large)
    for (let i = 0; i < 4096; i++) await writeFile(join(old, 'checkpoints', `${i}.json`), 'retired malformed snapshot')
    await writeFile(join(old, 'unknown.txt'), 'user-owned unknown data')
    await writeFile(join(cwd, 'source.ts'), 'source must survive')

    const interrupted = await run('migrate', 'copy')
    assert.equal(existsSync(join(interrupted.target, 'manifest.json')), false)
    assert.equal((await readdir(join(old, 'logs'))).length, 257)
    const committed = await run('migrate', 'cleanup')
    const manifestBefore = await readFile(join(committed.target, 'manifest.json'), 'utf8')
    assert.equal(JSON.parse(manifestBefore).migration.cleanupComplete, false)
    const finished = await run('migrate')
    assert.equal(finished.status, 'migrated'); assert.equal(finished.foreground, true)
    const manifestPath = join(finished.target, 'manifest.json')
    const receipt = JSON.parse(await readFile(manifestPath, 'utf8'))
    assert.equal(receipt.retentionStartedAt, JSON.parse(manifestBefore).retentionStartedAt)
    assert.equal(receipt.migration.cleanupComplete, true)
    assert.equal(receipt.migration.files.length, 258)
    assert.equal(digest(await readFile(join(finished.target, 'launch.json'))), digest(launch))
    assert.equal((await readdir(join(finished.target, 'logs'))).length, 257)
    for (const file of await readdir(join(finished.target, 'logs'))) {
      assert.equal(digest(await readFile(join(finished.target, 'logs', file))), digest(file === 'large.log' ? large : small))
    }
    assert.equal(existsSync(join(old, 'checkpoints')), false)
    assert.equal(await readFile(join(old, 'unknown.txt'), 'utf8'), 'user-owned unknown data')

    const { WorkspaceStateStore } = await import(pathToFileURL(bundle).href)
    await new WorkspaceStateStore(profile).dismissPrompt()
    // A later app must never reimport stale source files over newer target data.
    const newer = launch.replace('P6 fixture', 'New configuration after migration')
    await writeFile(join(finished.target, 'launch.json'), newer)
    await writeFile(join(old, 'janusX.launch.json'), launch)
    await run('migrate')
    assert.equal(await readFile(join(finished.target, 'launch.json'), 'utf8'), newer)
    const frozenManifest = await readFile(manifestPath, 'utf8')
    for (let i = 0; i < 12; i++) await run('check')
    assert.equal(await readFile(manifestPath, 'utf8'), frozenManifest)
    const separate = await new WorkspaceStateStore(join(scratch, 'other-profile')).resolve(cwd)
    assert.notEqual(separate.root, finished.target)
    const futureManifest = JSON.stringify({ ...receipt, schema: 999 })
    await writeFile(manifestPath, futureManifest)
    await assert.rejects(new WorkspaceStateStore(profile).resolve(cwd), /Unknown workspace storage manifest/)
    assert.equal(await readFile(manifestPath, 'utf8'), futureManifest)
    await writeFile(manifestPath, frozenManifest)
    await run('maintain')
    assert.equal(await readFile(join(cwd, 'source.ts'), 'utf8'), 'source must survive')
    assert.equal(await readFile(join(old, 'unknown.txt'), 'utf8'), 'user-owned unknown data')
    report.passed = true
  } catch (error) { report.passed = false; report.error = String(error); throw error }
  finally {
    await writeFile(output, JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report, null, 2))
    const inside = relative(await realpath(tmpdir()), scratch)
    if (!inside.startsWith('janusx-p6-lifecycle-') || inside.includes('..')) throw new Error('Unsafe P6 fixture cleanup')
    await rm(scratch, { recursive: true, force: true })
  }
}
