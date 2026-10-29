// Exercise the public catalog and package in a fresh, repository-external packaged app.
import { _electron, expect } from '@playwright/test'
import { cp, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const release = resolve(process.argv[2] ?? 'release/0.9.5')
const output = join(release, 'verification')
await mkdir(output, { recursive: true })
const stage = await mkdtemp(join(tmpdir(), 'janusx-published-plugin-'))
const env = { ...process.env, ELECTRON_RENDERER_URL: '' }
delete env.ELECTRON_RUN_AS_NODE
delete env.NODE_OPTIONS
let app
const checks = []
try {
  await cp(join(release, 'win-unpacked'), join(stage, 'app'), { recursive: true })
  app = await _electron.launch({ executablePath: join(stage, 'app/JanusX.exe'),
    args: [`--user-data-dir=${join(stage, 'profile')}`], env, timeout: 60_000 })
  const page = await app.firstWindow({ timeout: 60_000 })
  await page.waitForFunction(() => Boolean(window.electron?.plugins) && document.getElementById('root')?.childElementCount > 0)
  await page.evaluate(() => {
    localStorage.setItem('janusx:learning:v1', JSON.stringify({ version: 1, introduced: true }))
  })
  await page.reload()
  await page.waitForFunction(() => Boolean(window.electron?.plugins) && document.getElementById('root')?.childElementCount > 0)
  const request = input => page.evaluate(input => window.electron.plugins.request(input), input)
  const before = await request({ type: 'list' })
  expect(before.ok).toBe(true)
  expect(before.data.plugins).toEqual([])
  checks.push('Fresh packaged profile contains no preinstalled plugin')
  expect(await request({ type: 'catalogRefresh' })).toMatchObject({ ok: true })
  const catalog = await request({ type: 'list' })
  expect(catalog.data.distribution.entries).toContainEqual(expect.objectContaining({ id: 'official.blueprint', version: '1.0.7', compatible: true }))
  checks.push('Real public signed catalog is discoverable and compatible')
  expect(await request({ type: 'installOfficial', id: 'official.blueprint' })).toMatchObject({ ok: true })
  const installed = await request({ type: 'list' })
  expect(installed.data.plugins).toMatchObject([{ enabled: false, source: { kind: 'official' }, manifest: { version: '1.0.7' } }])
  checks.push('Real public package downloads, verifies and installs disabled')
  expect(await request({ type: 'enable', id: 'official.blueprint', projects: [] })).toMatchObject({ ok: true })
  checks.push('Official native plugin enables with explicit grant')
  await page.evaluate(() => window.electron.system.setLanguage('en'))
  await page.getByTitle('Settings', { exact: true }).click()
  await page.locator('[data-tab="extension:official.blueprint/settings"]').click()
  await expect.poll(() => app.context().pages().filter(p => p.url().startsWith('janusx-plugin:')).length).toBeGreaterThan(0)
  const plugin = app.context().pages().find(p => p.url().startsWith('janusx-plugin:'))
  await expect(plugin.getByRole('heading', { name: /^(Blueprint settings|蓝图设置)$/ })).toBeVisible({ timeout: 60_000 })
  await page.screenshot({ path: join(output, 'published-plugin-desktop.png') })
  await plugin.screenshot({ path: join(output, 'published-plugin-settings.png') })
  checks.push('Downloaded plugin settings page renders in packaged host')
  expect(await request({ type: 'disable', id: 'official.blueprint' })).toMatchObject({ ok: true })
  expect(await request({ type: 'uninstall', id: 'official.blueprint' })).toMatchObject({ ok: true })
  expect((await request({ type: 'list' })).data.plugins).toEqual([])
  checks.push('Disable and uninstall complete in isolated profile')
  await writeFile(join(output, 'published-plugin-install.json'), JSON.stringify({ checkedAt: new Date().toISOString(), status: 'passed', checks }, null, 2) + '\n')
  console.log(checks.join('\n'))
} catch (error) {
  await writeFile(join(output, 'published-plugin-install.json'), JSON.stringify({ checkedAt: new Date().toISOString(), status: 'failed', checks, error: String(error) }, null, 2) + '\n')
  throw error
} finally {
  await app?.close()
  await rm(stage, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
