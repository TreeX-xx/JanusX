// Note: .agents/notes/agent/superagent-plugin-migration.md — isolated test trust and real Electron activation.
import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron, expect } from '@playwright/test'
import { packagePlugin } from './package-plugin.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const cache = join(root, '.cache')
await mkdir(cache, { recursive: true })
const stage = await mkdtemp(join(cache, 'superagent desktop '))
const env = { ...process.env, JANUSX_LOCAL_PLUGIN_DIRECTORY: stage }
delete env.ELECTRON_RUN_AS_NODE
delete env.NODE_OPTIONS
const run = (file, args, extra = {}) => execFileSync(process.execPath, [file, ...args], { cwd: root, env: { ...env, ...extra }, stdio: 'inherit' })
let app
try {
  const manifest = JSON.parse(await readFile(join(root, 'plugins/superagent/manifest.json'), 'utf8'))
  const { id, version } = manifest
  const source = join(stage, 'source')
  await mkdir(source)
  run('plugins/superagent/build.mjs', [], { JANUSX_PLUGIN_BUILD_ROOT: source })
  await cp(join(root, 'plugins/superagent/manifest.json'), join(source, 'manifest.json'))
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const keys = { fixture: publicKey.export({ type: 'spki', format: 'pem' }) }
  const sign = () => packagePlugin({ directory: source, output: stage, url: 'https://local.invalid/superagent.jxp', publisher: 'Desktop test',
    host: '>=0.9.9 <1', platforms: [process.platform + '-' + process.arch], keyId: 'fixture', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }), keys })
  const result = await sign()
  const upgradeVersion = manifest.version.split('.').map((n, i) => i === 2 ? Number(n) + 1 : n).join('.')
  await writeFile(join(source, 'manifest.json'), JSON.stringify({ ...manifest, version: upgradeVersion }))
  const upgrade = await sign()
  const build = { profile: join(stage, 'profile'), appDirectory: join(stage, 'app'), id, version,
    archive: join(stage, result.basename + '.jxp'), release: join(stage, result.basename + '.release.json') }
  await writeFile(join(stage, 'build.json'), JSON.stringify(build))
  await writeFile(join(stage, 'trust.json'), JSON.stringify({ catalogUrl: '', keys, nativePlugins: { [id]: ['fixture'] } }))
  run('node_modules/electron-vite/bin/electron-vite.js', ['build', '--config', 'scripts/plugins/blueprint-dev.config.ts', '--outDir', build.appDirectory])
  const entry = resolve(root, 'scripts/plugins/blueprint-dev-entry.mjs')
  const launch = async () => {
    app = await _electron.launch({ args: [entry, '--user-data-dir=' + build.profile], env, timeout: 60000 })
    const page = await app.firstWindow({ timeout: 60000 })
    await page.waitForFunction(() => Boolean(window.electron?.superAgent))
    return page
  }
  let page = await launch()
  const request = async input => {
    const result = await page.evaluate(input => window.electron.plugins.request(input), input)
    if (!result.ok) throw new Error(input.type + ': ' + result.code + ' ' + result.message)
    return result
  }
  expect((await request({ type: 'list' })).data.plugins).toMatchObject([{ enabled: false, manifest: { id } }])
  const workspace = join(stage, 'project 中文')
  await mkdir(workspace)
  const workspaceId = await page.evaluate(async path => (await window.electron.workspace.create({ name: 'Signed SuperAgent test', path })).id, workspace)
  const available = () => page.evaluate(id => window.electron.superAgent.available(id), workspaceId)
  expect(await available()).toBe(false)
  expect(await request({ type: 'enable', id, projects: [] })).toMatchObject({ ok: true })
  expect(await available()).toBe(true)
  await page.evaluate(async () => {
    localStorage.setItem('janusx:learning:v1', JSON.stringify({ version: 1, introduced: true }))
    await window.electron.system.setLanguage('en')
  })
  await page.reload()
  await page.getByTitle('Settings', { exact: true }).click()
  await page.locator('[data-tab="extension:official.superagent/settings"]').click()
  await expect.poll(() => app.context().pages().some(p => p.url().includes('settings.html'))).toBe(true)
  const settings = app.context().pages().find(p => p.url().includes('settings.html'))
  try { await expect(settings.getByRole('combobox', { name: /^(Default Worker|默认 Worker)$/ })).toHaveValue('codex') }
  catch (error) { throw new Error('Plugin settings did not load: ' + await settings.locator('body').innerText(), { cause: error }) }
  await settings.getByRole('combobox', { name: /^(Default Worker|默认 Worker)$/ }).selectOption('claude')
  await settings.getByRole('button', { name: /^(Save|保存)$/ }).click()
  await expect(settings.getByRole('status')).toHaveText(/^(Saved|已保存)$/)
  await expect.poll(() => page.evaluate(() => window.electron.superAgent.workerPolicy())).toMatchObject({ defaultBackend: 'claude' })
  await settings.getByRole('combobox', { name: /^(Default Worker|默认 Worker)$/ }).selectOption('codex')
  await settings.getByRole('button', { name: /^(Save|保存)$/ }).click()
  await expect.poll(() => page.evaluate(() => window.electron.superAgent.workerPolicy())).toMatchObject({ defaultBackend: 'codex' })
  await settings.getByLabel(/^(Idle timeout \(minutes\)|空闲超时（分钟）)$/).fill('45')
  await settings.getByRole('button', { name: /^(Save · Idle timeout \(minutes\)|保存 · 空闲超时（分钟）)$/ }).click()
  await expect.poll(() => page.evaluate(() => window.electron.superAgent.workerIdleTimeoutMinutes())).toBe(45)
  const input = { eventId: randomUUID(), workspaceId, conversationId: 'test-conversation', text: 'Saved by the signed-plugin fixture.' }
  const submit = () => page.evaluate(row => window.electron.superAgent.submitInput(row), input)
  const first = await submit()
  expect((await submit()).duplicate).toBe(true)
  expect(await request({ type: 'disable', id })).toMatchObject({ ok: true })
  expect(await available()).toBe(false)
  await expect(submit()).rejects.toThrow()
  const read = () => page.evaluate(([workspace, resource]) => window.electron.superAgent.readResource(workspace, resource), [workspaceId, first.input.resourceId])
  expect((await read()).text).toBe(input.text)
  await app.close(); app = undefined
  page = await launch()
  expect(await available()).toBe(false)
  expect((await read()).text).toBe(input.text)
  expect(await request({ type: 'enable', id, projects: [] })).toMatchObject({ ok: true })
  expect((await submit()).duplicate).toBe(true)
  await app.evaluate(({ app }, pluginId) => {
    const child = app.getAppMetrics().find(row => row.name === 'JanusX plugin: ' + pluginId)
    if (!child || child.type !== 'Utility') throw new Error('Test-owned plugin process missing')
    process.kill(child.pid)
  }, id)
  await expect.poll(available).toBe(false)
  expect((await read()).text).toBe(input.text)
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, join(stage, upgrade.basename + '.jxp'))
  expect(await request({ type: 'importPackage' })).toMatchObject({ ok: true })
  expect((await request({ type: 'list' })).data.plugins[0]).toMatchObject({ previousVersion: version, enabled: false, manifest: { version: upgradeVersion } })
  expect(await request({ type: 'rollback', id })).toMatchObject({ ok: true })
  expect((await request({ type: 'list' })).data.plugins[0].manifest.version).toBe(version)
  expect(await request({ type: 'uninstall', id })).toMatchObject({ ok: true })
  expect((await read()).text).toBe(input.text)
  if (process.argv.includes('--with-worker')) {
    if (!process.env.JANUS_SUPERAGENT_CODEX_BINARY) throw new Error('Set JANUS_SUPERAGENT_CODEX_BINARY to the absolute Codex executable.')
    await app.close(); app = undefined
    run('node_modules/@playwright/test/cli.js', ['test', 'tests/e2e/desktop-superagent.spec.ts', '--grep', 'context budget routes', '--workers=1'],
      { JANUS_DESKTOP_ENTRY: entry })
  }
  console.log('Verified signed install, opt-in, deactivation, restart, idempotent replay, uninstall and historical text on ' + process.platform + '-' + process.arch)
} finally {
  try { await app?.close() } finally { await rm(stage, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 }) }
}
