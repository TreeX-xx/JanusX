// Note: .agents/notes/planning/blueprint-official-plugin.md — real production package and resource evidence.
// Run after packaging: node scripts/plugins/check-blueprint-packaged.mjs RELEASE_DIR PACKAGE [BASELINE_DIR] [--compatibility | --faults]
import { _electron, expect } from '@playwright/test'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { distributionLibrary } from './distribution-library.mjs'

const arguments_ = process.argv.slice(2)
const [release, archive, baseline] = arguments_.filter(value => !value.startsWith('--'))
if (!release || !archive) throw new Error('Usage: check-blueprint-packaged.mjs RELEASE_DIR PACKAGE [BASELINE_DIR]')
const compatibility = arguments_.includes('--compatibility'), faults = arguments_.includes('--faults')
if (arguments_.some(value => value.startsWith('--') && !['--compatibility', '--faults'].includes(value)) || compatibility && faults) {
  throw new Error('Choose one supported verification mode')
}
if (compatibility && !baseline) throw new Error('Compatibility mode requires the original delivery directory')
const output = resolve(release, 'verification', ...(compatibility ? ['compatibility'] : faults ? ['faults'] : []))
await mkdir(output, { recursive: true })
const stage = await mkdtemp(join(tmpdir(), 'janusx-blueprint-packaged-'))
const manifest = JSON.parse(await readFile('plugins/blueprint/manifest.json', 'utf8'))
const samples = [], states = [], faultChecks = []
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
      if (attempt >= 19 || !String(error).includes('Execution context was destroyed')) throw error
      await new Promise(resolve => setTimeout(resolve, 500))
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

async function fileHashes(root, names) {
  const files = {}
  const visit = async relative => {
    let entries
    try { entries = await readdir(join(root, relative), { withFileTypes: true }) }
    catch (error) { if (error.code === 'ENOENT') return; throw error }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(relative, entry.name)
      if (entry.isDirectory()) await visit(path)
      else {
        expect(entry.isFile()).toBe(true)
        files[path] = createHash('sha256').update(await readFile(join(root, path))).digest('hex')
      }
    }
  }
  for (const name of names) await visit(name)
  return files
}

try {
  await cp(resolve(release, 'win-unpacked'), join(stage, 'candidate'), { recursive: true })
  if (baseline && !compatibility && !faults) await cp(resolve(baseline, 'win-unpacked'), join(stage, 'baseline'), { recursive: true })
  // Alternate real frozen artifacts. Each run has a fresh profile; OS file caches are not flushed.
  for (let run = 0; run < (compatibility || faults ? 0 : 3); run++) {
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
  const projectFiles = faults ? await fileHashes(project, ['.agents/notes']) : null
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
  await expect(card).toContainText(manifest.version, { timeout: 60_000 })
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
  if (faults) {
    const api = await distributionLibrary()
    const bytes = await readFile(archive), decoded = api.decodeSignedPluginPackage(bytes)
    const corrupt = Buffer.from(bytes); corrupt[corrupt.length - 1] ^= 1
    const signature = decoded.envelope.signature
    const alteredSignature = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1)
    const translations = JSON.parse(await readFile('src/renderer/src/i18n/locales/en/plugins.json', 'utf8'))
    const cases = [
      { name: 'truncated', bytes: bytes.subarray(0, 10), code: 'INVALID_PACKAGE', message: translations.importInvalid },
      { name: 'payload-changed', bytes: corrupt, code: 'INVALID_PACKAGE', message: translations.importInvalid },
      { name: 'signature-changed', bytes: api.encodeSignedPluginPackage(decoded.archive, { ...decoded.envelope, signature: alteredSignature }), code: 'INVALID_SIGNATURE', message: translations.importUntrusted },
      { name: 'unknown-signer', bytes: api.encodeSignedPluginPackage(decoded.archive, { ...decoded.envelope, keyId: 'untrusted-fault-test' }), code: 'INVALID_SIGNATURE', message: translations.importUntrusted },
      { name: 'immutable-version', bytes, code: 'INVALID_REQUEST', message: translations.importBlocked },
    ]
    await page.getByTitle('Settings', { exact: true }).click()
    await page.locator('[data-tab="plugins"]').click()
    const home = join(profile, 'janusx/plugins')
    const persistent = async () => ({
      registry: createHash('sha256').update(await readFile(join(home, 'registry.json'))).digest('hex'),
      files: await fileHashes(home, ['packages', 'data', 'configuration', 'credentials']),
    })
    const before = await persistent()
    expect(Object.keys(before.files).some(path => path.startsWith('packages'))).toBe(true)
    expect(Object.keys(before.files).some(path => path.startsWith('data'))).toBe(true)
    for (const item of cases) {
      const path = join(stage, `${item.name}.jxp`)
      await writeFile(path, item.bytes)
      await application.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
      }, path)
      await page.getByRole('button', { name: 'Import plugin package', exact: true }).click()
      await expect(page.getByRole('alert')).toHaveText(item.message)
      const result = await registry(page)
      expect(result.ok).toBe(true)
      expect(result.data.logs.at(-1).code).toBe(item.code)
      expect(result.data.plugins).toMatchObject([{ enabled: false, manifest: { version: manifest.version } }])
      expect(await persistent()).toEqual(before)
      expect(await nativeProcesses()).toEqual([])
      faultChecks.push({ name: item.name, code: item.code, sha256: createHash('sha256').update(item.bytes).digest('hex'), persistentFilesUnchanged: true })
    }
    await application.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }) })
    await page.getByRole('button', { name: 'Import plugin package', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Import plugin package', exact: true })).toBeEnabled()
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(await persistent()).toEqual(before)
    faultChecks.push({ name: 'picker-cancelled', persistentFilesUnchanged: true })
  }
  if (!compatibility) {
    await application.close(); application = undefined
    ;({ page } = await launch('candidate', profile))
    const restarted = await sample(page, 'disabled-after-restart')
    expect(restarted.plugins).toMatchObject([{ enabled: false, state: 'disabled', runtime: { pages: 0, connected: 0, ready: 0 } }])
    expect(await nativeProcesses()).toEqual([])
  }
  if (faults) {
    expect(await page.evaluate(projects => window.electron.plugins.request({ type: 'enable', id: 'official.blueprint', projects }), authorizedProjects)).toMatchObject({ ok: true })
    await page.getByTitle('Settings', { exact: true }).click()
    await page.locator('[data-tab="extension:official.blueprint/settings"]').click()
    plugin = await guest()
    await expect(plugin.getByLabel('Commits per check', { exact: true })).toHaveValue('9')
    expect(await nativeProcesses()).toHaveLength(1)
    expect(await page.evaluate(() => window.electron.plugins.request({ type: 'disable', id: 'official.blueprint' }))).toMatchObject({ ok: true })
    await expect.poll(nativeProcesses).toEqual([])
    expect(await fileHashes(project, ['.agents/notes'])).toEqual(projectFiles)
    faultChecks.push({ name: 'restart-and-reenable', pluginVersion: manifest.version, retained: '9', projectFilesUnchanged: true })
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
    stage, pluginVersion: manifest.version, summary, samples, states, versionChecks, faultChecks,
    limits: ['Windows x64 only; fresh profile startup, first root content may still be loading',
      compatibility ? 'Compatibility mode checks installed versions; startup comparison and restart checks run separately' : faults ? 'Fault mode checks local import rejection, unchanged persisted files and restart; no startup comparison' : 'Three alternating runs; OS file caches not flushed; background user processes may affect timing',
      'Memory sums include all Electron processes and are not exclusive physical memory',
      'Enabled sample includes real repository graph and open workbench; other states have different workloads',
      'No model action requested; real provider quality, full historic version matrix and installer wizard not tested'] }
  await writeFile(join(output, 'blueprint-packaged.json'), JSON.stringify(receipt, null, 2) + '\n')
  console.log(JSON.stringify({ status: receipt.status, summary, faultChecks, states: states.map(item => ({ state: item.state, workingSetKiB: item.workingSetKiB })) }, null, 2))
} catch (error) {
  const pluginPage = application?.context().pages().find(page => page.url().startsWith('janusx-plugin:'))
  let diagnostics
  if (pluginPage) {
    await pluginPage.getByRole('button', { name: /Source diagnostics/ }).click({ timeout: 2000 }).catch(() => {})
    diagnostics = await pluginPage.locator('body').innerText().catch(() => undefined)
  }
  await writeFile(join(output, 'blueprint-packaged-failure.json'), JSON.stringify({ checkedAt: new Date().toISOString(),
    status: 'failed', stage, error: String(error), diagnostics, samples, states, faultChecks }, null, 2) + '\n')
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
