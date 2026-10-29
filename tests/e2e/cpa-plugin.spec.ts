import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { createServer as tcpServer } from 'node:net'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { prepareCpaDevelopment } from '../../scripts/plugins/cpa-dev.mjs'
import { CpaInstaller } from '../../plugins/cpa/src/main/installer'
import { createDesktopTestEnv, seedIntroducedLearning } from './desktop-test-env'

test.describe.configure({ mode: 'serial' })
let directory: string, build: Awaited<ReturnType<typeof prepareCpaDevelopment>>
test.beforeAll(async () => {
  test.setTimeout(180_000)
  await mkdir('.cache', { recursive: true })
  directory = await mkdtemp(join(resolve('.cache'), 'cpa-desktop-'))
  execFileSync(process.execPath, ['plugins/cpa/build.mjs'], { windowsHide: true, stdio: 'pipe' })
  build = await prepareCpaDevelopment(process.cwd(), directory)
  execFileSync(process.execPath, ['node_modules/electron-vite/bin/electron-vite.js', 'build', '--config', 'scripts/plugins/cpa-dev.config.ts', '--outDir', build.appDirectory],
    { env: { ...process.env, JANUSX_CPA_LOCAL_DIRECTORY: directory }, windowsHide: true, stdio: 'pipe', maxBuffer: 32 * 1024 * 1024 })
})
test.afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) })
async function boot(): Promise<{ app: ElectronApplication; page: Page }> {
  const { ELECTRON_RUN_AS_NODE: _node, NODE_OPTIONS: _options, ...env } = createDesktopTestEnv(directory)
  const app = await electron.launch({ executablePath: process.env.JANUS_ELECTRON_PATH,
    args: [resolve('scripts/plugins/cpa-dev-entry.mjs'), `--user-data-dir=${build.profile}`], env: { ...env, JANUSX_CPA_LOCAL_DIRECTORY: directory } })
  try {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded')
    await page.evaluate(() => (window as any).electron.system.setLanguage('en'))
    await seedIntroducedLearning(page); await page.reload()
    return { app, page }
  } catch (cause) { app.process().kill(); throw cause }
}
async function request(page: Page, input: object): Promise<any> { return page.evaluate(input => (window as any).electron.plugins.request(input), input) }
async function open(page: Page, app: ElectronApplication): Promise<Page> {
  await page.locator('button[data-id="tool-menu"]').click()
  await page.getByRole('menuitem', { name: 'CPA', exact: true }).click()
  await expect.poll(() => app.context().pages().some(item => item.url().startsWith('janusx-plugin:'))).toBe(true)
  return app.context().pages().find(item => item.url().startsWith('janusx-plugin:'))!
}
async function guest(app: ElectronApplication, origin: string): Promise<Page> {
  await expect.poll(() => app.context().pages().some(item => item.url().startsWith(origin))).toBe(true)
  return app.context().pages().find(item => item.url().startsWith(origin))!
}
async function close(page: Page): Promise<void> {
  const tab = page.locator('[data-tab-id*="official.cpa"]')
  await tab.locator('[data-tab-close]').hover(); await page.mouse.down()
  try { await expect(tab).toHaveCount(0) } finally { await page.mouse.up() }
}
async function shutdown(app: ElectronApplication) {
  const child = app.process(), timer = setTimeout(() => child.kill('SIGKILL'), 5000)
  try { await app.close() } finally { clearTimeout(timer) }
}

test('signed optional CPA works without a project, isolates online login and retains it across close and disable', async ({}, info) => {
  test.setTimeout(120_000)
  const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.setHeader('X-Frame-Options', 'DENY'); res.end(`<!doctype html><title>CPA fixture</title><main></main><script>
function render(){document.querySelector('main').innerHTML=localStorage.getItem('login')?'<h1>Account quota fixture</h1>':'<label>Management key<input></label><button>Login</button>';document.querySelector('button')?.addEventListener('click',()=>{localStorage.setItem('login','yes');render()})}render()</script>`) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  let app: ElectronApplication | undefined
  try {
    const booted = await boot(); app = booted.app; const { page } = booted
    expect(await page.evaluate(() => typeof (window as any).electron.cpa)).toBe('undefined')
    expect((await request(page, { type: 'list' })).data.plugins.find((item: any) => item.manifest.id === build.id)).toMatchObject({ enabled: false, source: { kind: 'official' } })
    await page.locator('button[data-id="tool-menu"]').click()
    await expect(page.getByRole('menuitem', { name: 'CPA', exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
    expect(await request(page, { type: 'enable', id: build.id })).toMatchObject({ ok: true })
    const plugin = await open(page, app)
    await expect(plugin.locator('[data-cpa-settings]')).toBeVisible()
    await plugin.getByRole('combobox', { name: 'Connection mode' }).selectOption('external')
    await plugin.getByRole('textbox', { name: 'Management page address' }).fill(origin)
    await plugin.getByRole('button', { name: 'Save and open CPA', exact: true }).click()
    let web = await guest(app, origin)
    await web.getByRole('textbox', { name: 'Management key' }).fill('fixture-key')
    await web.getByRole('button', { name: 'Login', exact: true }).click()
    await expect(web.getByRole('heading', { name: 'Account quota fixture' })).toBeVisible()
    expect(await web.evaluate(() => ({ host: typeof (window as any).electron, node: typeof (window as any).require, bridge: typeof (window as any).janusxPlugin }))).toEqual({ host: 'undefined', node: 'undefined', bridge: 'undefined' })
    await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.length)).toBe(2)
    // Switching the host's registered project context never transfers or recreates this application guest.
    for (const name of ['project-one', 'project-two']) {
      const root = join(directory, name); await mkdir(root)
      const project = await page.evaluate(path => (window as any).electron.workspace.create({ name: path.split(/[\\/]/).at(-1), path }), root)
      expect(await request(page, { type: 'context', projectId: project.id, scopePath: root, locale: 'en', theme: { id: '', tokens: {} } })).toMatchObject({ ok: true })
      expect(await guest(app, origin)).toBe(web)
    }
    await page.getByTitle('Settings', { exact: true }).click()
    await expect(page.locator('[data-tab="integrations"]')).toHaveCount(0)
    await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.length)).toBe(0)
    await page.locator('[data-tab="extension:official.cpa/settings"]').click()
    await expect.poll(() => app!.context().pages().some(item => item.url().endsWith('/settings.html'))).toBe(true)
    const settings = app.context().pages().find(item => item.url().endsWith('/settings.html'))!
    await expect(settings.getByRole('combobox', { name: 'Connection mode' })).toHaveValue('external')
    await settings.getByRole('textbox', { name: 'Management page address' }).fill(`${origin}/alternate.html`)
    await settings.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(settings.getByRole('status')).toContainText('Connection saved')
    await settings.screenshot({ path: info.outputPath('plugin-settings.png') })
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
    await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.length)).toBe(2)
    // Saving replaces the guest; do not retain the closed page from the old URL.
    web = await guest(app, `${origin}/alternate.html`)
    await web.screenshot({ path: info.outputPath('external-management.png') })
    await page.screenshot({ path: info.outputPath('optional-cpa.png') })
    await close(page)
    await expect.poll(() => web.isClosed()).toBe(true)
    expect((await fetch(origin)).ok).toBe(true)
    await open(page, app); web = await guest(app, origin)
    await expect(web.getByRole('heading', { name: 'Account quota fixture' })).toBeVisible()
    expect(await request(page, { type: 'disable', id: build.id })).toMatchObject({ ok: true })
    expect((await fetch(origin)).ok).toBe(true)
    await expect.poll(() => web.isClosed()).toBe(true)
    expect(await request(page, { type: 'enable', id: build.id })).toMatchObject({ ok: true })
    await open(page, app); web = await guest(app, origin)
    await expect(web.getByRole('heading', { name: 'Account quota fixture' })).toBeVisible()
    await close(page)
    await request(page, { type: 'disable', id: build.id })
  } finally { if (app) await shutdown(app); await new Promise<void>(resolve => server.close(() => resolve())) }
})

test('migrates verified real CPA components, keeps the backend after panel closure and stops it on disable and quit', async ({}, info) => {
  const zipPath = process.env.JANUSX_E2E_CPA_ZIP, htmlPath = process.env.JANUSX_E2E_CPA_HTML
  const components = process.env.JANUSX_E2E_CPA_COMPONENTS
  test.skip(process.platform !== 'win32' || !components && (!zipPath || !htmlPath), 'Supply pinned official Windows CPA assets or an immutable installed component root.')
  test.setTimeout(120_000)
  const legacy = join(build.profile, 'janusx/components/cpa')
  const archiveHash = '28bde34eb33a1b03884bac1e8c1a402a25ae4eadd3c60df7ae0df53f8b281318', htmlHash = '57558cd023475674634a114824b014d3e5ac161f6f3791e3d86b6adab962a700'
  if (components) {
    // Read only immutable programs and metadata, never copy the source profile's keys or accounts.
    const installed = { id: 'v8.0.31-v1.26.5-28bde34eb33a', backend: 'v8.0.31', frontend: 'v1.26.5',
      binaryHash: '0497fe65ef8bdd796011e8df74ba91ccfde1a2ef938faf8da8be2c2a0c943d5b', pageHash: htmlHash }
    expect(createHash('sha256').update(await readFile(join(components, 'versions', installed.id, 'cli-proxy-api.exe'))).digest('hex')).toBe('0497fe65ef8bdd796011e8df74ba91ccfde1a2ef938faf8da8be2c2a0c943d5b')
    expect(createHash('sha256').update(await readFile(join(components, 'versions', installed.id, 'management.html'))).digest('hex')).toBe(htmlHash)
    await mkdir(join(legacy, 'versions'), { recursive: true })
    await cp(join(components, 'versions', installed.id), join(legacy, 'versions', installed.id), { recursive: true })
    await writeFile(join(legacy, 'current.json'), JSON.stringify(installed))
  } else {
  const archive = await readFile(zipPath!), html = await readFile(htmlPath!)
  expect(createHash('sha256').update(archive).digest('hex')).toBe(archiveHash)
  expect(createHash('sha256').update(html).digest('hex')).toBe(htmlHash)
  // Exercise the production installer with pinned transport, then migrate its real output.
  const assets = new Map<string, Buffer>()
  const release = (repo: string, tag: string, name: string, data: Buffer) => {
    const url = `https://github.com/router-for-me/${repo}/releases/download/${tag}/${name}`; assets.set(url, data)
    return Buffer.from(JSON.stringify({ tag_name: tag, draft: false, prerelease: false, assets: [{ name, browser_download_url: url, size: data.length, digest: 'sha256:' + createHash('sha256').update(data).digest('hex') }] }))
  }
  assets.set('https://api.github.com/repos/router-for-me/CLIProxyAPI/releases/latest', release('CLIProxyAPI', 'v8.0.31', 'CLIProxyAPI_8.0.31_windows_amd64.zip', archive))
  assets.set('https://api.github.com/repos/router-for-me/Cli-Proxy-API-Management-Center/releases/latest', release('Cli-Proxy-API-Management-Center', 'v1.26.5', 'management.html', html))
  const installer = new CpaInstaller(legacy, 'win32', 'x64', async url => assets.get(url) ?? Buffer.from('MIT fixture'))
  const installed = await installer.install(new AbortController().signal, () => {}); await installer.activate(installed)
  }
  await mkdir(join(legacy, 'accounts'), { recursive: true }); await writeFile(join(legacy, 'accounts/sentinel'), 'keep')
  // Remove the previous test's optional plugin data, retaining its package and old application configuration.
  await rm(join(build.profile, 'janusx/plugins/data/official.cpa/native'), { recursive: true, force: true })
  const configPath = join(build.profile, 'janusx/config.json'), config = JSON.parse(await readFile(configPath, 'utf8'))
  const listener = tcpServer(); await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve))
  const port = (listener.address() as { port: number }).port; await new Promise<void>(resolve => listener.close(() => resolve()))
  config.cpaSettings = { mode: 'managed', enabled: true, port, autoUpdate: false }; await writeFile(configPath, JSON.stringify(config))
  const origin = `http://127.0.0.1:${port}`
  let app: ElectronApplication | undefined
  try {
    const booted = await boot(); app = booted.app; const { page } = booted
    expect(await request(page, { type: 'enable', id: build.id })).toMatchObject({ ok: true })
    // Activation alone preserves on-demand startup, even with an enabled legacy configuration.
    await expect.poll(() => app!.context().pages().some(item => item.url().startsWith('janusx-plugin:'))).toBe(false)
    await expect(fetch(origin)).rejects.toThrow()
    const plugin = await open(page, app)
    await expect.poll(async () => { try { return (await fetch(`${origin}/management.html`)).status } catch { return 0 } }, { timeout: 40_000 }).toBe(200)
    const web = await guest(app, origin)
    const key = await app.evaluate(({ app, safeStorage }) => {
      const fs = process.getBuiltinModule('fs')!, path = process.getBuiltinModule('path')!
      return safeStorage.decryptString(fs.readFileSync(path.join(app.getPath('userData'), 'janusx/plugins/data/official.cpa/native/components/management-key.enc')))
    })
    await plugin.getByRole('button', { name: 'Copy management key', exact: true }).click()
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(key)
    await web.locator('input[name="cpa-management-key"]').fill(key)
    await web.getByRole('button', { name: /^(Login|连接|登录)$/ }).click()
    await expect(web.getByRole('link', { name: /^(Quota Management|配额管理)$/ })).toBeVisible()
    await web.screenshot({ path: info.outputPath('managed-management.png') })
    await plugin.screenshot({ path: info.outputPath('managed-plugin-shell.png') })
    await page.screenshot({ path: info.outputPath('managed-cpa-plugin.png') })
    await close(page)
    expect((await fetch(`${origin}/management.html`)).status).toBe(200)
    await request(page, { type: 'disable', id: build.id })
    await expect.poll(async () => { try { await fetch(origin); return true } catch { return false } }).toBe(false)
    const migrated = join(build.profile, 'janusx/plugins/data/official.cpa/native/components')
    expect(await readFile(join(migrated, 'accounts/sentinel'), 'utf8')).toBe('keep')
    expect(await readFile(join(legacy, 'accounts/sentinel'), 'utf8')).toBe('keep')
    expect(await readFile(join(migrated, 'config.yaml'), 'utf8')).not.toContain(key)
    await request(page, { type: 'enable', id: build.id })
    await open(page, app)
    await expect.poll(async () => { try { return (await fetch(`${origin}/management.html`)).status } catch { return 0 } }, { timeout: 30_000 }).toBe(200)
    await shutdown(app); app = undefined
    await expect.poll(async () => { try { await fetch(origin); return true } catch { return false } }).toBe(false)
  } finally { if (app) await shutdown(app) }
})
