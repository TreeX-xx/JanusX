// Note: .agents/notes/planning/blueprint-official-plugin.md — real production package and resource evidence.
// Run after packaging: node scripts/plugins/check-blueprint-packaged.mjs RELEASE_DIR PACKAGE [BASELINE_DIR] [--compatibility]
import { _electron, expect } from '@playwright/test'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { distributionLibrary } from './distribution-library.mjs'

const [release, archive, baseline] = process.argv.slice(2)
if (!release || !archive) throw new Error('Usage: check-blueprint-packaged.mjs RELEASE_DIR PACKAGE [BASELINE_DIR]')
const compatibility = process.argv.includes('--compatibility')
if (compatibility && !baseline) throw new Error('Compatibility mode requires the original delivery directory')
const output = resolve(release, 'verification', ...(compatibility ? ['compatibility'] : []))
await mkdir(output, { recursive: true })
const stage = await mkdtemp(join(tmpdir(), 'janusx-blueprint-packaged-'))
const manifest = JSON.parse(await readFile('plugins/blueprint/manifest.json', 'utf8'))
const samples = [], states = []
const environment = { ...process.env, ELECTRON_RENDERER_URL: '' }
delete environment.ELECTRON_RUN_AS_NODE
delete environment.NODE_OPTIONS
let application

async function launch(label, profile) {
  const started = performance.now()
  application = await _electron.launch({ executablePath: join(stage, label, 'JanusX.exe'),
    args: [`--user-data-dir=${profile}`], env: { ...environment, JANUSX_KNOWLEDGE_ROOT: join(profile, 'knowledge') }, timeout: 60_000 })
  const page = await application.firstWindow({ timeout: 60_000 })
  await page.waitForFunction(() => Boolean(window.electron) && document.getElementById('root')?.childElementCount > 0)
  return { page, firstContentMs: performance.now() - started }
}

const registry = page => page.evaluate(() => window.electron.plugins.request({ type: 'list' }))
async function readMetrics() {
  for (let attempt = 0; ; attempt++) {
    try { return await application.evaluate(({ app }) => ({ mainMemory: process.memoryUsage(), processes: app.getAppMetrics() })) }
    catch (error) {
      // Utility-process startup can replace a Playwright inspector context. Retry this read only.
      if (attempt >= 2 || !String(error).includes('Execution context was destroyed')) throw error
      await new Promise(resolve => setTimeout(resolve, 250))
    }
  }
}
const nativeProcesses = async () => (await readMetrics()).processes.filter(metric => metric.name === 'JanusX plugin: official.blueprint')
async function sample(page, state) {
  // Five seconds after the requested state settles; CPU is Electron's instantaneous sample.
  await page.waitForTimeout(5000)
  const metrics = await readMetrics()
  const plugins = await registry(page)
  expect(plugins.ok).toBe(true)
  const record = { state, ...metrics, plugins: plugins.data.plugins,
    workingSetKiB: metrics.processes.reduce((total, metric) => total + metric.memory.workingSetSize, 0),
    privateBytesKiB: metrics.processes.reduce((total, metric) => total + (metric.memory.privateBytes ?? 0), 0) }
  states.push(record)
  await writeFile(join(output, 'blueprint-measurements.json'), JSON.stringify({ samples, states }, null, 2) + '\n')
  return record
}

async function guest() {
  await expect.poll(() => application.context().pages().some(page => page.url().startsWith('janusx-plugin:')), { timeout: 30_000 }).toBe(true)
  return application.context().pages().find(page => page.url().startsWith('janusx-plugin:'))
}

try {
  await cp(resolve(release, 'win-unpacked'), join(stage, 'candidate'), { recursive: true })
  if (baseline && !compatibility) await cp(resolve(baseline, 'win-unpacked'), join(stage, 'baseline'), { recursive: true })
  // Alternate real frozen artifacts. Each run has a fresh profile; OS file caches are not flushed.
  for (let run = 0; run < (compatibility ? 0 : 3); run++) {
    for (const label of baseline ? ['baseline', 'candidate'] : ['candidate']) {
      const { page, firstContentMs } = await launch(label, join(stage, `${label}-profile-${run}`))
      const record = await sample(page, `${label}-absent-${run}`)
      expect(record.plugins).toEqual([])
      expect(await nativeProcesses()).toEqual([])
      samples.push({ label, run, firstContentMs, workingSetKiB: record.workingSetKiB, privateBytesKiB: record.privateBytesKiB })
      await application.close(); application = undefined
    }
  }
  const project = join(stage, 'project'), profile = join(stage, 'lifecycle-profile')
  await mkdir(join(project, '.agents'), { recursive: true })
  await cp('.agents/notes', join(project, '.agents/notes'), { recursive: true })
  await cp('.agents/harness.json', join(project, '.agents/harness.json'))
  const notePath = join(project, '.agents/notes/module.md')
  const noteHash = createHash('sha256').update(await readFile(notePath)).digest('hex')
  let { page } = await launch('candidate', profile)
  await page.evaluate(() => window.electron.system.setLanguage('en'))
  await page.addInitScript(() => localStorage.setItem('janusx:learning:v1', JSON.stringify({ version: 1, introduced: true })))
  await page.evaluate(path => window.electron.workspace.create({ name: 'Packaged project', path }), project)
  await page.reload()
  await page.getByText('Packaged project', { exact: true }).filter({ visible: true }).first().click()
  await page.getByTitle('Settings', { exact: true }).click()
  await page.locator('[data-tab="plugins"]').click()
  // Only the OS file picker is stubbed. Import, signature verification and installation run normally.
  await application.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, resolve(archive))
  await page.getByRole('button', { name: 'Import plugin package', exact: true }).click()
  let card = page.locator('[data-plugin-id="official.blueprint"]')
  await expect(card).toContainText(manifest.version)
  const disabled = await sample(page, 'installed-disabled')
  expect(disabled.plugins).toMatchObject([{ enabled: false, source: { kind: 'official' }, runtime: { pages: 0, ready: 0 } }])
  expect(await nativeProcesses()).toEqual([])
  await card.getByRole('button', { name: 'Review permissions and scope', exact: true }).click()
  const review = page.getByRole('region', { name: 'Review permissions and scope' })
  await review.getByLabel('Packaged project', { exact: true }).check()
  await review.getByRole('button', { name: 'Grant and enable', exact: true }).click()
  await page.locator('[data-tab="extension:official.blueprint/settings"]').click()
  let plugin = await guest()
  await expect(plugin.getByRole('heading', { name: 'Blueprint settings', exact: true })).toBeVisible()
  await plugin.getByLabel('Commits per check', { exact: true }).fill('9')
  await expect(plugin.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await expect.poll(() => plugin.isClosed()).toBe(true)
  await page.locator('button[data-id="tool-menu"]').click()
  await page.getByRole('menuitem', { name: '打开蓝图', exact: true }).click()
  plugin = await guest()
  await expect(plugin.getByRole('heading', { name: 'JanusX', level: 2, exact: true })).toBeVisible({ timeout: 60_000 })
  await expect(plugin.locator('.markdown-preview')).toContainText('桌面工作区', { timeout: 60_000 })
  await expect(plugin.locator('.bp-node-card').first()).toBeVisible({ timeout: 60_000 })
  expect(await nativeProcesses()).toHaveLength(1)
  const authorizedProjects = (await registry(page)).data.plugins[0].projects
  await sample(page, 'enabled-workbench-open')
  await page.screenshot({ path: join(output, 'blueprint-desktop.png') })
  await plugin.screenshot({ path: join(output, 'blueprint-page.png') })
  expect(await page.evaluate(() => window.electron.plugins.request({ type: 'disable', id: 'official.blueprint' }))).toMatchObject({ ok: true })
  await expect.poll(() => application.context().pages().filter(page => page.url().startsWith('janusx-plugin:')).length).toBe(0)
  await expect.poll(nativeProcesses).toEqual([])
  await sample(page, 'disabled-after-use')
  if (!compatibility) {
    await application.close(); application = undefined
    ;({ page } = await launch('candidate', profile))
    const restarted = await sample(page, 'disabled-after-restart')
    expect(restarted.plugins).toMatchObject([{ enabled: false, state: 'disabled', runtime: { pages: 0, connected: 0, ready: 0 } }])
    expect(await nativeProcesses()).toEqual([])
  }
  expect(createHash('sha256').update(await readFile(notePath)).digest('hex')).toBe(noteHash)
  const versionChecks = []
  if (compatibility) {
    card = page.locator('[data-plugin-id="official.blueprint"]')
    const api = await distributionLibrary()
    const trust = JSON.parse(await readFile('plugins/catalog/trust.json', 'utf8'))
    const prior = JSON.parse(await readFile(resolve(baseline, 'delivery.json'), 'utf8'))
    const priorArchive = resolve(baseline, `official.blueprint-${prior.plugin.version}.jxp`)
    const priorRelease = api.verifyPluginRelease(api.decodeSignedPluginPackage(await readFile(priorArchive)).envelope, trust.keys)
    expect(priorRelease.id).toBe(manifest.id)
    expect(await page.evaluate(() => window.electron.plugins.request({ type: 'uninstall', id: 'official.blueprint' }))).toMatchObject({ ok: true })
    if (!await page.locator('[data-tab="plugins"]').isVisible()) await page.getByTitle('Settings', { exact: true }).click()
    await page.locator('[data-tab="plugins"]').click()
    const importPackage = async path => {
      await application.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
      }, path)
      await page.getByRole('button', { name: 'Import plugin package', exact: true }).click()
    }
    const settings = async () => {
      await page.locator('[data-tab="extension:official.blueprint/settings"]').click()
      const plugin = await guest()
      await expect(plugin.getByRole('heading', { name: 'Blueprint settings', exact: true })).toBeVisible()
      return plugin
    }
    const enable = async () => {
      expect(await page.evaluate(projects => window.electron.plugins.request({ type: 'enable', id: 'official.blueprint', projects }), authorizedProjects)).toMatchObject({ ok: true })
    }
    const disable = async () => {
      expect(await page.evaluate(() => window.electron.plugins.request({ type: 'disable', id: 'official.blueprint' }))).toMatchObject({ ok: true })
      await expect.poll(nativeProcesses).toEqual([])
      await page.locator('[data-tab="plugins"]').click()
    }
    await importPackage(priorArchive)
    await expect(card).toContainText(priorRelease.version)
    await enable()
    plugin = await settings()
    await expect(plugin.getByLabel('Commits per check', { exact: true })).toHaveValue('9')
    await plugin.getByLabel('Commits per check', { exact: true }).fill('11')
    await expect(plugin.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible()
    versionChecks.push({ host: 'candidate', plugin: priorRelease.version, saved: '11' })
    await disable()
    await importPackage(resolve(archive))
    await expect(card).toContainText(manifest.version)
    expect((await registry(page)).data.plugins[0].enabled).toBe(false)
    await enable()
    plugin = await settings()
    await expect(plugin.getByLabel('Commits per check', { exact: true })).toHaveValue('11')
    versionChecks.push({ host: 'candidate', plugin: manifest.version, upgradedFrom: priorRelease.version, retained: '11' })
    await disable()
    expect(await page.evaluate(() => window.electron.plugins.request({ type: 'rollback', id: 'official.blueprint' }))).toMatchObject({ ok: true })
    await expect(card).toContainText(priorRelease.version)
    await enable()
    plugin = await settings()
    await expect(plugin.getByLabel('Commits per check', { exact: true })).toHaveValue('11')
    versionChecks.push({ host: 'candidate', plugin: priorRelease.version, rolledBackFrom: manifest.version, retained: '11' })
    await disable()
    expect(createHash('sha256').update(await readFile(notePath)).digest('hex')).toBe(noteHash)
  }
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
  const summary = Object.fromEntries([...new Set(samples.map(item => item.label))].map(label => {
    const runs = samples.filter(item => item.label === label)
    return [label, Object.fromEntries(['firstContentMs', 'workingSetKiB', 'privateBytesKiB'].map(key => [key, median(runs.map(item => item[key]))]))]
  }))
  const receipt = { checkedAt: new Date().toISOString(), status: 'passed', release: resolve(release), archive: resolve(archive),
    archiveSha256: createHash('sha256').update(await readFile(archive)).digest('hex'), baseline: baseline ? resolve(baseline) : null,
    stage, pluginVersion: manifest.version, summary, samples, states, versionChecks,
    limits: ['Windows x64 only; fresh profile startup, first root content may still be loading',
      compatibility ? 'Compatibility mode checks installed versions; startup comparison and restart checks run separately' : 'Three alternating runs; OS file caches not flushed; background user processes may affect timing',
      'Memory sums include all Electron processes and are not exclusive physical memory',
      'Enabled sample includes real repository graph and open workbench; other states have different workloads',
      'No model action requested; real provider quality, full historic version matrix and installer wizard not tested'] }
  await writeFile(join(output, 'blueprint-packaged.json'), JSON.stringify(receipt, null, 2) + '\n')
  console.log(JSON.stringify({ status: receipt.status, summary, states: states.map(item => ({ state: item.state, workingSetKiB: item.workingSetKiB })) }, null, 2))
} catch (error) {
  await writeFile(join(output, 'blueprint-packaged-failure.json'), JSON.stringify({ checkedAt: new Date().toISOString(),
    status: 'failed', stage, error: String(error), samples, states }, null, 2) + '\n')
  if (application) {
    await application.firstWindow().then(page => page.screenshot({ path: join(output, 'blueprint-failure.png') })).catch(() => {})
    console.error(await application.context().pages()[0]?.evaluate(() => window.electron.plugins.request({ type: 'list' })).catch(() => null))
  }
  throw error
} finally {
  if (application) await application.close()
  // Retain profiles and receipts, remove only the executable copies created by this invocation.
  if (dirname(stage) !== resolve(tmpdir()) || !basename(stage).startsWith('janusx-blueprint-packaged-')) throw new Error('Unexpected stage path')
  for (const label of ['candidate', 'baseline']) await rm(join(stage, label), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
