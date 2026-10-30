import { _electron as electron, expect, test, type ElectronApplication, type Page, type Frame, type Locator } from '@playwright/test'
import { mkdtemp, mkdir, cp, readFile, writeFile, rm, link, symlink, readdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:http'
import { createSocket } from 'node:dgram'
import { build } from 'esbuild'
import { createServer as createTcpServer } from 'node:net'
import { createDesktopTestEnv, seedIntroducedLearning } from './desktop-test-env'

const pluginId = 'example.project-reference'
async function openManagement(card: Locator) {
  const details = card.locator('[data-plugin-management]')
  if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click()
}
async function boot(root: string) {
  const app = await electron.launch({ args: [resolve(process.env.JANUS_E2E_MAIN_ENTRY ?? 'out/main/index.js'), `--user-data-dir=${join(root, 'profile')}`], env: createDesktopTestEnv(root) })
  const page = await app.firstWindow()
  app.context().on('page', guest => {
    guest.on('console', message => console.log('[guest]', message.type(), message.text()))
    guest.on('pageerror', error => console.log('[guest error]', error.message))
    guest.on('requestfailed', request => console.log('[guest request]', request.url(), request.failure()?.errorText))
  })
  page.on('console', message => { if (message.type() === 'error') console.log('[renderer]', message.text()) })
  await page.waitForLoadState('domcontentloaded')
  await page.evaluate(() => (window as any).electron.system.setLanguage('en'))
  await seedIntroducedLearning(page)
  await app.context().addInitScript(() => {
    window.addEventListener('message', event => {
      if (event.source === window.parent && event.data?.type === 'janusx:plugin-port' && event.ports[0]) {
        (window as any).testPort = event.ports[0]; (window as any).testRevision = event.data.contextRevision
      }
    })
  })
  await page.reload()
  return { app, page }
}
async function settings(page: Page) {
  if (await page.locator('[data-plugin-workbench]').isVisible()) {
    // Fullscreen workbenches cover the titlebar. Exercise the same host event
    // used by plugin management navigation to verify modal occlusion.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('janusx:open-plugin-manager')))
  } else await page.getByTitle('Settings', { exact: true }).click()
  await page.locator('[data-tab="plugins"]').click()
  await expect(page.locator('[data-plugin-settings]')).toBeVisible()
}
async function importDirectory(app: ElectronApplication, page: Page, source: string, copied = false) {
  await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, source)
  await page.getByRole('tab', { name: 'Developer', exact: true }).click()
  await page.getByRole('button', { name: copied ? 'Install directory copy' : 'Link development directory', exact: true }).click()
}
async function rawCall(frame: Frame | Page, method: string, params: unknown) {
  return frame.evaluate(({ method, params }) => new Promise(resolve => {
    const port = (window as any).testPort as MessagePort
    const requestId = `raw-${crypto.randomUUID()}`
    const listener = (event: MessageEvent) => { if (event.data?.requestId === requestId) { port.removeEventListener('message', listener); resolve(event.data) } }
    port.addEventListener('message', listener)
    port.postMessage({ protocol: 1, type: 'request', requestId, method, params, contextRevision: (window as any).testRevision })
  }), { method, params }) as Promise<any>
}
async function guest(app: ElectronApplication, entry: string, excludeUrl = ''): Promise<Page> {
  const matches = (page: Page) => page.url().startsWith('janusx-plugin:') && page.url().endsWith(entry) && page.url() !== excludeUrl
  await expect.poll(() => app.context().pages().some(matches)).toBe(true)
  const page = app.context().pages().find(matches)!
  await page.waitForLoadState('domcontentloaded')
  return page
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'janusx-p2-desktop-'))
  const receipt = JSON.parse(await readFile('artifacts/plugin-p1/scaffold.json', 'utf8'))
  const source = join(root, 'plugin')
  await mkdir(source)
  await cp(join(receipt.project, 'dist'), join(source, 'dist'), { recursive: true })
  await cp(join(receipt.project, 'manifest.json'), join(source, 'manifest.json'))
  const project = join(root, 'project-a'); await mkdir(project); await writeFile(join(project, 'README.md'), 'P2 readable project file')
  return { root, source, project }
}
async function close(app: ElectronApplication | undefined) {
  if (!app) return
  const process = app.process()
  let timer: ReturnType<typeof setTimeout> | undefined
  try { await Promise.race([app.close(), new Promise<void>(resolve => { timer = setTimeout(() => { process.kill('SIGKILL'); resolve() }, 5000) })]) } finally { clearTimeout(timer) }
}
async function enableFixture(app: ElectronApplication, page: Page, source: string, workspaceId: string, id = pluginId) {
  await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, source)
  await page.evaluate(async ({ pluginId, workspaceId }) => {
    for (const input of [{ type: 'import', kind: 'linked' }, { type: 'development', enabled: true }, { type: 'enable', id: pluginId, projects: [workspaceId] }]) {
      const result = await (window as any).electron.plugins.request(input); if (!result.ok) throw new Error(result.code)
    }
  }, { pluginId: id, workspaceId })
}
async function openDetails(page: Page) {
  await page.locator('button[data-id="tool-menu"]').click()
  await page.getByRole('menuitem', { name: 'Open project reference', exact: true }).click()
}

test('project plugins apply to existing and future workspaces after first enable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'janusx-plugin-grant-'))
  let app: ElectronApplication | undefined
  try {
    const id = 'example.project-grant'
    const source = join(root, 'plugin'); await mkdir(join(source, 'dist'), { recursive: true })
    await writeFile(join(source, 'manifest.json'), JSON.stringify({
      schemaVersion: 1, id, name: 'Project grant fixture', version: '1.0.0', engines: { pluginApi: '^1.0.0' },
      capabilities: { required: ['views.workbench', 'views.workbench.frame', 'views.settings', 'commands.openView', 'context.project', 'files.readText'], optional: [] },
      permissions: [{ name: 'ui.views.open' }, { name: 'workspace.context.read' }, { name: 'workspace.files.read', paths: ['README.md'] }],
      contributes: {
        views: [
          { id: 'desk', title: 'Grant fixture', entry: 'dist/index.html', location: 'workbench', scope: 'project', frame: 'plugin', instancePolicy: 'single' },
          { id: 'settings', title: 'Grant settings', entry: 'dist/settings.html', location: 'settings', scope: 'application', instancePolicy: 'single' },
        ],
        commands: [{ id: 'open', title: 'Open grant fixture', action: { type: 'openView', view: 'desk' } }],
        menus: [{ location: 'toolbox', command: 'open', when: 'projectOpen' }],
      },
    }))
    const html = '<!doctype html><h1 id="status">Loading</h1><script type="module" src="./main.js"></script>'
    await writeFile(join(source, 'dist/index.html'), html); await writeFile(join(source, 'dist/settings.html'), html)
    await build({ stdin: { resolveDir: process.cwd(), contents: `import { connectPlugin } from './packages/plugin-sdk/src/client.ts';
      const api = await connectPlugin(); window.fixtureApi = api;
      document.querySelector('#status').textContent = location.pathname.endsWith('settings.html') ? 'Settings available'
        : (await api.workspace.readText({path:'README.md'})).text;` }, bundle: true, format: 'esm', platform: 'browser', outfile: join(source, 'dist/main.js') })
    const project = join(root, 'project'); await mkdir(project); await writeFile(join(project, 'README.md'), 'Authorized project content')
    const other = join(root, 'other'); await mkdir(other)
    const booted = await boot(root); app = booted.app; const page = booted.page
    await page.evaluate(path => (window as any).electron.workspace.create({ name: 'Grant project', path }), project)
    await writeFile(join(other, 'README.md'), 'New workspace content')
    await page.reload(); await page.getByText('Grant project', { exact: true }).filter({ visible: true }).first().click()
    await settings(page); await importDirectory(app, page, source)
    await page.evaluate(() => (window as any).electron.plugins.request({ type: 'development', enabled: true }))
    const review = page.getByRole('region', { name: 'Review permissions' })
    await page.locator(`[data-plugin-id="${id}"]`).getByRole('button', { name: 'Review permissions', exact: true }).click()
    await expect(review.getByRole('checkbox')).toHaveCount(0)
    await expect(review).toContainText('all current and future workspaces')
    await review.getByRole('button', { name: 'Grant and enable', exact: true }).click()
    await expect(review).toHaveCount(0)
    const listed = () => page.evaluate(async () => (await (window as any).electron.plugins.request({ type: 'list' })).data.plugins[0])
    expect((await listed()).projectScope).toBe('all')
    await page.locator(`[data-tab="extension:${id}/settings"]`).click()
    await expect((await guest(app, '/dist/settings.html')).locator('#status')).toHaveText('Settings available')
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
    const open = async () => {
      await page.locator('button[data-id="tool-menu"]').click()
      await page.getByRole('menuitem', { name: 'Open grant fixture', exact: true }).click()
    }
    await open()
    await expect((await guest(app, '/dist/index.html')).locator('#status')).toHaveText('Authorized project content')
    await page.evaluate(path => (window as any).electron.workspace.create({ name: 'Other grant project', path }), other)
    await page.reload()
    await page.getByText('Other grant project', { exact: true }).filter({ visible: true }).first().click()
    await open()
    await expect((await guest(app, '/dist/index.html')).locator('#status')).toHaveText('New workspace content')

  } finally { await close(app); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
})

test('installed settings pages follow activation, modal bounds, nested covers and uninstall', async ({}, testInfo) => {
  const root = await mkdtemp(join(tmpdir(), 'janusx-plugin-settings-'))
  let app: ElectronApplication | undefined
  try {
    const id = 'example.settings-page'
    const source = join(root, 'plugin'); await mkdir(join(source, 'dist'), { recursive: true })
    const manifest = {
      schemaVersion: 1, id, name: 'Settings lifecycle fixture', version: '1.0.0', engines: { pluginApi: '^1.0.0' },
      capabilities: { required: ['views.settings', 'commands.openView', 'storage.kv', 'ui.toast', 'context.project'], optional: [] },
      permissions: [{ name: 'ui.views.open' }, { name: 'plugin.storage' }, { name: 'ui.toast' }, { name: 'workspace.context.read' }],
      contributes: {
        views: [{ id: 'settings', title: 'Fixture settings', entry: 'dist/settings.html', location: 'settings', scope: 'application', instancePolicy: 'single' }],
        commands: [{ id: 'open-settings', title: 'Open fixture settings', action: { type: 'openView', view: 'settings' } }],
        menus: [{ location: 'toolbox', command: 'open-settings', when: 'always' }],
      },
    }
    await writeFile(join(source, 'manifest.json'), JSON.stringify(manifest))
    await writeFile(join(source, 'dist/settings.html'), '<!doctype html><html><body><h1 id="status">Loading</h1><label>Label<input id="label"></label><button id="save">Save fixture</button><script type="module" src="./settings.js"></script></body></html>')
    await build({ stdin: { contents: `import { connectPlugin } from './packages/plugin-sdk/src/client.ts';
      const api = await connectPlugin(); window.settingsApi = api;
      const input = document.querySelector('#label');
      input.value = (await api.storage.get({ key: 'label' })).value ?? '';
      document.querySelector('#save').onclick = async () => {
        await api.storage.set({ key: 'label', value: input.value }); document.querySelector('#status').textContent = 'Saved';
      };
      document.querySelector('#status').textContent = 'Settings ready';`, resolveDir: process.cwd() },
      bundle: true, format: 'esm', platform: 'browser', outfile: join(source, 'dist/settings.js') })
    const booted = await boot(root); app = booted.app; const page = booted.page
    await settings(page)
    const navigation = page.locator(`[data-tab="extension:${id}/settings"]`)
    await expect(navigation).toHaveCount(0)
    await importDirectory(app, page, source)
    expect(await page.evaluate(() => (window as any).electron.plugins.request({ type: 'development', enabled: true }))).toMatchObject({ ok: true })
    // Installed but not enabled: no settings entry and no plugin page.
    await expect(navigation).toHaveCount(0)
    await expect(page.locator('[data-plugin-native]')).toHaveCount(0)
    await page.locator('[data-tab="plugins"]').click()
    await page.locator(`[data-plugin-id="${id}"]`).getByRole('button', { name: 'Review permissions', exact: true }).click()
    await page.getByRole('region', { name: 'Review permissions' }).getByRole('button', { name: 'Grant and enable', exact: true }).click()
    await navigation.click()
    let frame = await guest(app, '/dist/settings.html')
    await expect(frame.locator('#status')).toHaveText('Settings ready')
    expect(await frame.evaluate(() => (window as any).settingsApi.workspace.getContext())).toMatchObject({ project: null })
    const attached = () => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children
      .filter(child => (child as any).webContents?.getURL().startsWith('janusx-plugin:'))
      .map(child => ({ url: (child as any).webContents.getURL(), bounds: child.getBounds() })))
    await expect.poll(async () => (await attached()).length).toBe(1)
    const rect = await page.locator('[data-plugin-native]').boundingBox()
    const bounds = (await attached())[0].bounds
    expect(rect).not.toBeNull()
    for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(bounds[key] - rect![key])).toBeLessThanOrEqual(2)
    expect(bounds.width).toBeGreaterThan(200); expect(bounds.height).toBeGreaterThan(100)
    await frame.locator('#label').fill('Retained settings')
    await frame.locator('#save').click(); await expect(frame.locator('#status')).toHaveText('Saved')
    await frame.evaluate(() => (window as any).settingsApi.ui.showToast({ message: 'Settings cover fixture' }))
    await expect(page.getByRole('status').filter({ hasText: 'Settings cover fixture' })).toBeVisible()
    await expect.poll(async () => (await attached()).length).toBe(0)
    await expect.poll(async () => (await attached()).length, { timeout: 10_000 }).toBe(1)
    await page.screenshot({ path: testInfo.outputPath('plugin-settings.png') })
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect.poll(() => frame.isClosed()).toBe(true)
    await expect.poll(async () => (await attached()).length).toBe(0)
    await page.locator('button[data-id="tool-menu"]').click()
    await page.getByRole('menuitem', { name: 'Open fixture settings', exact: true }).click()
    await expect(navigation).toHaveAttribute('aria-current', 'page')
    frame = await guest(app, '/dist/settings.html')
    await expect(frame.locator('#label')).toHaveValue('Retained settings')
    await expect.poll(async () => (await attached()).length).toBe(1)
    // The same settings command must navigate again even when its initial tab is unchanged.
    await page.locator('[data-tab="general"]').click()
    await expect.poll(() => frame.isClosed()).toBe(true)
    await page.locator('[data-tab="plugins"]').click()
    await page.locator(`[data-plugin-id="${id}"]`).getByRole('button', { name: 'Fixture settings', exact: true }).click()
    await expect(navigation).toHaveAttribute('aria-current', 'page')
    frame = await guest(app, '/dist/settings.html')
    await expect(frame.locator('#label')).toHaveValue('Retained settings')
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect.poll(() => frame.isClosed()).toBe(true)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.locator('button[data-id="tool-menu"]').click()
    await page.getByRole('menuitem', { name: 'Open fixture settings', exact: true }).click()
    frame = await guest(app, '/dist/settings.html')
    await expect(frame.locator('#label')).toHaveValue('Retained settings')
    await expect.poll(async () => (await attached()).length).toBe(1)
    expect(await page.evaluate(id => (window as any).electron.plugins.request({ type: 'disable', id }), id)).toMatchObject({ ok: true })
    // Disabling withdraws the entry; the selected page falls back to plugin management.
    await expect(navigation).toHaveCount(0)
    await expect(page.locator('[data-plugin-settings-page]')).toHaveCount(0)
    await expect(page.locator('[data-tab="plugins"]')).toHaveAttribute('aria-current', 'page')
    await expect.poll(() => frame.isClosed()).toBe(true)
    expect(await page.evaluate(id => (window as any).electron.plugins.request({ type: 'enable', id, projects: [] }), id)).toMatchObject({ ok: true })
    await expect(navigation).toBeVisible()
    await navigation.click()
    frame = await guest(app, '/dist/settings.html')
    await expect(frame.locator('#label')).toHaveValue('Retained settings')
    expect(await page.evaluate(id => (window as any).electron.plugins.request({ type: 'uninstall', id }), id)).toMatchObject({ ok: true })
    await expect(navigation).toHaveCount(0)
    await expect(page.locator('[data-plugin-settings-page]')).toHaveCount(0)
    await expect(page.locator('[data-tab="plugins"]')).toHaveAttribute('aria-current', 'page')
    await expect.poll(() => frame.isClosed()).toBe(true)
    await expect.poll(async () => (await attached()).length).toBe(0)
  } finally { await close(app); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
})

test('P7 palette-only plugins require review, persist selection, shield settings and fall back on revocation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'janusx-palette-desktop-')); let app: ElectronApplication | undefined
  try {
    const source = join(root, 'palette'); await mkdir(source)
    await cp('packages/plugin-sdk/examples/p7-palette/manifest.json', join(source, 'manifest.json'))
    const id = 'example.ocean-palette'; const theme = `plugin:${id}/ocean`
    let booted = await boot(root); app = booted.app; let page = booted.page
    await settings(page); await importDirectory(app, page, source)
    await page.evaluate(() => (window as any).electron.plugins.request({ type: 'development', enabled: true }))
    const card = page.locator(`[data-plugin-id="${id}"]`)
    await card.getByRole('button', { name: 'Review permissions', exact: true }).click()
    const review = page.getByRole('region', { name: 'Review permissions' })
    await expect(review.locator('[data-plugin-themes]')).toContainText('Ocean')
    await expect(review.locator('[data-plugin-themes]')).toContainText('No CSS or scripts')
    await review.getByRole('button', { name: 'Grant and enable', exact: true }).click()
    await page.locator('[data-tab="general"]').click()
    await page.locator(`[data-theme-preview="${theme}"]`).click()
    await expect.poll(() => page.evaluate(() => (window as any).electron.theme.get())).toBe(theme)
    const canvas = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--shell-canvas').trim())
    await expect.poll(canvas).toBe('#151517')
    await page.screenshot({ path: 'artifacts/plugin-theme-settings.png' })
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
    await expect.poll(canvas).toBe('#102030')
    await settings(page); await expect.poll(canvas).toBe('#151517')
    await page.evaluate(id => (window as any).electron.plugins.request({ type: 'disable', id }), id)
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
    await expect.poll(canvas).toBe('#151517')
    expect(await page.evaluate(() => (window as any).electron.theme.get())).toBe(theme)
    await page.evaluate(id => (window as any).electron.plugins.request({ type: 'enable', id, projects: [] }), id)
    await expect.poll(canvas).toBe('#102030')
    expect(await page.evaluate(async () => (await (window as any).electron.plugins.request({ type: 'list' })).data.plugins[0].runtime.pages)).toBe(0)
    await close(app); app = undefined
    booted = await boot(root); app = booted.app; page = booted.page
    await expect.poll(canvas).toBe('#102030')
    await page.evaluate(() => (window as any).electron.plugins.request({ type: 'development', enabled: false }))
    await expect.poll(canvas).toBe('#151517')
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--shell-canvas'))).toBe('')
  } finally { await close(app); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
})

test('P7 windows preserve isolated bridges, restore geometry, shield host dialogs and revoke project ownership', async () => {
  const f = await fixture(); let app: ElectronApplication | undefined
  try {
    const manifest = JSON.parse(await readFile(join(f.source, 'manifest.json'), 'utf8'))
    manifest.capabilities.required.push('views.window'); manifest.permissions.push({ name: 'ui.windows' })
    manifest.contributes.views.push(
      { id: 'window-project', title: 'Project utility', location: 'window', scope: 'project', entry: 'dist/index.html', instancePolicy: 'single' },
      { id: 'window-app', title: 'Application utility', location: 'window', scope: 'application', entry: 'dist/summary.html', instancePolicy: 'single' })
    manifest.contributes.commands.push({ id: 'open-utility', title: 'Open project utility', action: { type: 'openView', view: 'window-project' } })
    manifest.contributes.menus.push({ location: 'toolbox', command: 'open-utility', when: 'projectOpen' })
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(manifest))
    const booted = await boot(f.root); app = booted.app; const page = booted.page
    const workspace = await page.evaluate(path => (window as any).electron.workspace.create({ name: 'P7 Window project', path }), f.project)
    const other = join(f.root, 'project-b'); await mkdir(other); await writeFile(join(other, 'README.md'), 'Project B')
    await page.evaluate(path => (window as any).electron.workspace.create({ name: 'P7 Other project', path }), other)
    await page.reload(); await page.getByText('P7 Window project', { exact: true }).filter({ visible: true }).first().click()
    await settings(page); await importDirectory(app, page, f.source)
    await page.evaluate(() => (window as any).electron.plugins.request({ type: 'development', enabled: true }))
    const card = page.locator(`[data-plugin-id="${manifest.id}"]`)
    await card.getByRole('button', { name: 'Review permissions', exact: true }).click()
    const review = page.getByRole('region', { name: 'Review permissions' })
    await expect(review.locator('[data-plugin-windows]')).toContainText('Project utility')
    await expect(review.locator('[data-plugin-windows]')).toContainText('not unsaved content')
    await review.getByRole('button', { name: 'Grant and enable', exact: true }).click()
    await openManagement(card); await card.locator('[data-plugin-windows] > summary').click()
    await card.getByRole('button', { name: 'Open window · Project utility', exact: true }).click()
    // Opening while settings covers the host must not reveal the plugin page.
    await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(win => win.getTitle().includes(' — Project utility [')).length)).toBe(1)
    expect(await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows().find(win => win.getTitle().includes(' — Project utility ['))!; return { visible: win.isVisible(), children: win.contentView.children.length } })).toEqual({ visible: false, children: 0 })
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
    const details = await guest(app, '/dist/index.html'); await expect(details.locator('#content')).toHaveText('P2 readable project file')
    await details.getByRole('button', { name: 'Remember this project' }).click()
    await expect.poll(() => rawCall(details, 'storage.get', { key: 'project-name' })).toMatchObject({ ok: true, result: { found: true, value: 'project-a' } })
    expect(await details.evaluate(() => ({ node: typeof (window as any).require, host: typeof (window as any).electron }))).toEqual({ node: 'undefined', host: 'undefined' })
    expect(await rawCall(details, 'workspace.readText', { path: '../secret.md' })).toMatchObject({ ok: false, error: { code: 'INVALID_PACKAGE_PATH' } })
    await page.locator('button[data-id="tool-menu"]').click(); await page.getByRole('menuitem', { name: 'Open project utility', exact: true }).click()
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(win => win.getTitle().includes(' — Project utility [')).length)).toBe(1)
    await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows().find(win => win.getTitle().includes(' — Project utility ['))!; win.setBounds({ x: 90, y: 100, width: 680, height: 480 }) })
    await details.screenshot({ path: 'artifacts/plugin-window-ui.png' })
    await settings(page)
    await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.getTitle().includes(' — Project utility ['))!.contentView.children.length)).toBe(0)
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
    await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.getTitle().includes(' — Project utility ['))!.contentView.children.length)).toBe(1)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.getTitle().includes(' — Project utility ['))!.close())
    await expect.poll(async () => (await page.evaluate(() => (window as any).electron.plugins.request({ type: 'list' }))).data.plugins[0].runtime.pages).toBe(0)
    const open = (view: string) => page.evaluate(({ id, view, projectId, path }) => (window as any).electron.plugins.request({ type: 'windowOpen', id, view, projectId, scopePath: path }), { id: manifest.id, view, projectId: workspace.id, path: f.project })
    expect(await open('window-project')).toMatchObject({ ok: true })
    const reopened = await guest(app, '/dist/index.html'); await expect(reopened.locator('#content')).toHaveText('project-a')
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.getTitle().includes(' — Project utility ['))!.getBounds())).toMatchObject({ x: 90, y: 100, width: 680, height: 480 })
    expect(await rawCall(reopened, 'storage.get', { key: 'project-name' })).toMatchObject({ ok: true, result: { found: true, value: 'project-a' } })
    expect(await open('window-app')).toMatchObject({ ok: true })
    const appPage = await guest(app, '/dist/summary.html'); await expect(appPage.locator('#status')).toContainText('No project')
    await page.getByText('P7 Other project', { exact: true }).filter({ visible: true }).first().click()
    await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(win => win.getTitle().includes(' — Project utility [')).length)).toBe(0)
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(win => win.getTitle().includes(' — Application utility [')).length)).toBe(1)
    await page.evaluate(id => (window as any).electron.plugins.request({ type: 'disable', id }), manifest.id)
    await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(win => win.getTitle().includes('utility [')).length)).toBe(0)
  } finally { await close(app); await rm(f.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
})

test('P6 document contexts review fixed files, share page and Agent reads, report document revisions and revoke access', async () => {
  const f = await fixture(); let app: ElectronApplication | undefined
  try {
    const manifest = JSON.parse(await readFile(join(f.source, 'manifest.json'), 'utf8'))
    const provider = JSON.parse(await readFile('packages/plugin-sdk/examples/p6-context-provider/manifest.json', 'utf8'))
    manifest.capabilities.required.push('agent.context', 'files.readText'); manifest.permissions.push({ name: 'agent.context' })
    manifest.contributes.contextProviders = provider.contributes.contextProviders
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(manifest))
    const booted = await boot(f.root); app = booted.app; const page = booted.page
    const workspace = await page.evaluate(path => (window as any).electron.workspace.create({ name: 'P6 Context project', path }), f.project)
    await page.reload(); await page.getByText('P6 Context project', { exact: true }).filter({ visible: true }).first().click()
    await settings(page); await importDirectory(app, page, f.source)
    await page.evaluate(() => (window as any).electron.plugins.request({ type: 'development', enabled: true }))
    const card = page.locator(`[data-plugin-id="${manifest.id}"]`)
    await card.getByRole('button', { name: 'Review permissions', exact: true }).click()
    const review = page.getByRole('region', { name: 'Review permissions' })
    await expect(review.locator('[data-plugin-contexts]')).toContainText('README.md')
    await expect(review.locator('[data-plugin-contexts]')).toContainText('unsaved editor drafts are excluded')
    await review.locator('[data-plugin-contexts]').scrollIntoViewIfNeeded(); await page.screenshot({ path: 'artifacts/plugin-context-ui.png' })
    await review.getByRole('button', { name: 'Grant and enable', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
    await openDetails(page); const details = await guest(app, '/dist/index.html')
    await expect(details.locator('#content')).toHaveText('P2 readable project file')
    const catalog = await rawCall(details, 'context.providers', {}); const metadata = catalog.result.providers[0]
    expect(metadata).not.toHaveProperty('text')
    const request = { plugin: metadata.plugin, provider: metadata.provider, version: metadata.version, revision: metadata.revision }
    const ui = await rawCall(details, 'context.read', request)
    expect(ui).toMatchObject({ ok: true, result: { trust: 'untrusted-plugin-content', path: 'README.md', text: 'P2 readable project file' } })
    const loaded = await page.evaluate(async ({ context, request }) => {
      const api = (window as any).electron.agentRuntime; const session = await api.createSession({ ...context, approvalMode: 'plan' })
      return { sessionId: session.id, catalog: await api.executeTool({ sessionId: session.id, call: { toolName: 'plugin.contexts', input: {} } }),
        resource: await api.executeTool({ sessionId: session.id, call: { toolName: 'plugin.read-context', input: request } }) }
    }, { context: { workspaceId: workspace.id, workspaceRoot: f.project }, request })
    expect(loaded.catalog).toMatchObject({ status: 'completed', output: catalog.result })
    expect(loaded.resource).toMatchObject({ status: 'completed', output: ui.result })
    await writeFile(join(f.project, 'README.md'), 'Updated saved context')
    const changed = await rawCall(details, 'context.read', request)
    expect(changed.result.text).toBe('Updated saved context'); expect(changed.result.documentVersion).not.toBe(ui.result.documentVersion)
    expect(await rawCall(details, 'context.read', { ...request, path: '../secret.md' })).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
    await settings(page); await card.getByRole('button', { name: 'Disable', exact: true }).click()
    const revoked = await page.evaluate(async ({ sessionId, request }) => {
      const api = (window as any).electron.agentRuntime
      return { catalog: await api.executeTool({ sessionId, call: { toolName: 'plugin.contexts', input: {} } }), read: await api.executeTool({ sessionId, call: { toolName: 'plugin.read-context', input: request } }) }
    }, { sessionId: loaded.sessionId, request })
    expect(revoked.catalog.output.providers).toEqual([]); expect(revoked.read.status).toBe('failed')
    const snapshot = await page.evaluate(() => (window as any).electron.plugins.request({ type: 'list' })); expect(snapshot.data.tasks).toEqual([])
  } finally { await close(app); await rm(f.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
})

test('P6 workflows review the full sequence, share UI and Agent execution, track steps and cancel without running the tail', async () => {
  const f = await fixture(); let app: ElectronApplication | undefined
  try {
    const manifest = JSON.parse(await readFile('packages/plugin-sdk/examples/p6-workflow-provider/manifest.json', 'utf8'))
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(manifest))
    const booted = await boot(f.root); app = booted.app; const page = booted.page
    const workspace = await page.evaluate(path => (window as any).electron.workspace.create({ name: 'P6 Workflow project', path }), f.project)
    await page.reload(); await page.getByText('P6 Workflow project', { exact: true }).filter({ visible: true }).first().click()
    await settings(page); await importDirectory(app, page, f.source)
    await page.evaluate(() => (window as any).electron.plugins.request({ type: 'development', enabled: true }))
    const card = page.locator(`[data-plugin-id="${manifest.id}"]`)
    await card.getByRole('button', { name: 'Review permissions', exact: true }).click()
    const review = page.getByRole('region', { name: 'Review permissions' })
    await expect(review.locator('[data-plugin-workflows]')).toContainText('completed effects are not undone')
    await expect(review.locator('[data-plugin-workflows]')).toContainText('inputFromTask')
    await review.getByRole('button', { name: 'Grant and enable', exact: true }).click()
    await openManagement(card); await card.locator('[data-plugin-background] > summary').click()
    await card.getByLabel('Background scope', { exact: true }).selectOption('project')
    await card.getByLabel('Sequential report Input (JSON)', { exact: true }).fill('{"topic":"UI report"}')
    await card.getByRole('button', { name: 'Run Sequential report', exact: true }).click()
    const steps = card.locator('[data-plugin-workflow-steps]')
    await expect(steps.locator('li').filter({ hasText: 'Completed' })).toHaveCount(2)
    await steps.scrollIntoViewIfNeeded(); await page.screenshot({ path: 'artifacts/plugin-workflows-ui.png' })
    const loaded = await page.evaluate(async context => {
      const api = (window as any).electron.agentRuntime; const session = await api.createSession({ ...context, approvalMode: 'plan' })
      const catalog = await api.executeTool({ sessionId: session.id, call: { toolName: 'plugin.workflows', input: {} } })
      const workflow = catalog.output.workflows[0]
      const request = { plugin: workflow.plugin, workflow: workflow.workflow, version: workflow.version, revision: workflow.revision, input: { topic: 'Agent report' } }
      const denied = await api.executeTool({ sessionId: session.id, call: { toolName: 'plugin.run-workflow', input: request } })
      return { sessionId: session.id, catalog, request, denied }
    }, { workspaceId: workspace.id, workspaceRoot: f.project })
    expect(loaded.catalog).toMatchObject({ status: 'completed', output: { workflows: [{ steps: [{ service: 'collect' }, { service: 'finish' }] }] } })
    expect(loaded.denied.status).toBe('failed')
    const approved = await page.evaluate(async ({ sessionId, request }) => {
      const api = (window as any).electron.agentRuntime; await api.setApprovalMode(sessionId, 'per-action'); let approvals = 0
      const unsubscribe = api.onEvent((event: any) => { if (event.type === 'approval-requested' && event.request.sessionId === sessionId) {
        approvals++; void api.resolveApproval({ ...event.request, approvalId: event.request.id, approved: true })
      } })
      try { return { result: await api.executeTool({ sessionId, call: { toolName: 'plugin.run-workflow', input: request } }), approvals } }
      finally { unsubscribe() }
    }, { sessionId: loaded.sessionId, request: loaded.request })
    expect(approved).toMatchObject({ approvals: 1, result: { status: 'completed', output: { pluginId: 'janusx.agent', state: 'completed', workflow: { steps: [{ state: 'completed' }, { state: 'completed' }] } } } })
    await page.evaluate(async ({ sessionId, request }) => {
      const api = (window as any).electron.agentRuntime; await api.setApprovalMode(sessionId, 'auto-run')
      ;(window as any).workflowPending = api.executeTool({ sessionId, call: { toolName: 'plugin.run-workflow', input: request } })
    }, { sessionId: loaded.sessionId, request: loaded.request })
    await expect.poll(async () => {
      const snapshot = await page.evaluate(() => (window as any).electron.plugins.request({ type: 'list' }))
      return snapshot.data.tasks.some((run: any) => run.pluginId === 'janusx.agent' && run.workflow?.steps[0].state === 'running')
    }).toBe(true)
    await page.evaluate(sessionId => (window as any).electron.agentRuntime.cancelSession(sessionId), loaded.sessionId)
    expect((await page.evaluate(() => (window as any).workflowPending)).status).toBe('cancelled')
    const snapshot = await page.evaluate(() => (window as any).electron.plugins.request({ type: 'list' }))
    expect(snapshot.data.tasks.at(-1).workflow.steps.map((step: any) => step.state)).toEqual(['cancelled', 'skipped'])
    expect(snapshot.data.tasks.filter((run: any) => run.pluginId === manifest.id)).toHaveLength(1)
  } finally { await close(app); await rm(f.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
})

test('P6 skills show reviewed inert guidance, load through real Agent tools and retain service approval and revocation', async () => {
  const f = await fixture(); let app: ElectronApplication | undefined
  try {
    const manifest = JSON.parse(await readFile('packages/plugin-sdk/examples/p6-skill-provider/manifest.json', 'utf8'))
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(manifest))
    const booted = await boot(f.root); app = booted.app; const page = booted.page
    const workspace = await page.evaluate(path => (window as any).electron.workspace.create({ name: 'P6 Skill project', path }), f.project)
    await page.reload(); await page.getByText('P6 Skill project', { exact: true }).filter({ visible: true }).first().click()
    await settings(page); await importDirectory(app, page, f.source)
    await page.evaluate(() => (window as any).electron.plugins.request({ type: 'development', enabled: true }))
    const card = page.locator(`[data-plugin-id="${manifest.id}"]`)
    await card.getByRole('button', { name: 'Review permissions', exact: true }).click()
    const review = page.getByRole('region', { name: 'Review permissions' })
    await expect(review.locator('[data-plugin-skills]')).toContainText(manifest.contributes.skills[0].instructions)
    await expect(review).toContainText('cannot erase content already read')
    await review.getByRole('button', { name: 'Grant and enable', exact: true }).click()
    await expect(card).toContainText('Enabled, no page open')
    await openManagement(card); await card.locator('[data-plugin-skills] > summary').click()
    await card.locator('[data-plugin-skills]').scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'artifacts/plugin-skills-ui.png' })
    const loaded = await page.evaluate(async context => {
      const api = (window as any).electron.agentRuntime
      const session = await api.createSession({ ...context, approvalMode: 'plan' })
      const catalog = await api.executeTool({ sessionId: session.id, call: { toolName: 'plugin.skills', input: {} } })
      const metadata = catalog.output.skills[0]
      const request = { plugin: metadata.plugin, skill: metadata.skill, version: metadata.version, revision: metadata.revision }
      const resource = await api.executeTool({ sessionId: session.id, call: { toolName: 'plugin.read-skill', input: request } })
      return { sessionId: session.id, catalog, request, resource }
    }, { workspaceId: workspace.id, workspaceRoot: f.project })
    expect(loaded.catalog).toMatchObject({ status: 'completed', output: { skills: [{ plugin: manifest.id }], truncated: false } })
    expect(loaded.catalog.output.skills[0]).not.toHaveProperty('instructions')
    expect(loaded.resource).toMatchObject({ status: 'completed', output: { trust: 'untrusted-plugin-content', instructions: manifest.contributes.skills[0].instructions, services: [{ service: 'status', input: {} }] } })
    const before = await page.evaluate(() => (window as any).electron.plugins.request({ type: 'list' }))
    expect(before.data.tasks).toEqual([])
    const denied = await page.evaluate(({ sessionId, id }) => (window as any).electron.agentRuntime.executeTool({ sessionId, call: { toolName: 'plugin.call-service', input: { plugin: id, service: 'status', version: 1, input: {} } } }), { sessionId: loaded.sessionId, id: manifest.id })
    expect(denied.status).toBe('failed')
    const approved = await page.evaluate(async ({ sessionId, id }) => {
      const api = (window as any).electron.agentRuntime; await api.setApprovalMode(sessionId, 'per-action')
      let approvals = 0
      const unsubscribe = api.onEvent((event: any) => { if (event.type === 'approval-requested' && event.request.sessionId === sessionId) {
        approvals++; void api.resolveApproval({ ...event.request, approvalId: event.request.id, approved: true })
      } })
      try { return { result: await api.executeTool({ sessionId, call: { toolName: 'plugin.call-service', input: { plugin: id, service: 'status', version: 1, input: {} } } }), approvals } }
      finally { unsubscribe() }
    }, { sessionId: loaded.sessionId, id: manifest.id })
    expect(approved).toMatchObject({ approvals: 1, result: { status: 'completed', output: { pluginId: 'janusx.agent', state: 'completed' } } })
    await card.getByRole('button', { name: 'Disable', exact: true }).click()
    const revoked = await page.evaluate(async ({ sessionId, request }) => {
      const api = (window as any).electron.agentRuntime
      return { catalog: await api.executeTool({ sessionId, call: { toolName: 'plugin.skills', input: {} } }), resource: await api.executeTool({ sessionId, call: { toolName: 'plugin.read-skill', input: request } }) }
    }, { sessionId: loaded.sessionId, request: loaded.request })
    expect(revoked.catalog.output.skills).toEqual([]); expect(revoked.resource.status).toBe('failed')
  } finally { await close(app); await rm(f.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
})

async function modelServer(holdFirst = false) {
  const requests: Array<{ body: any; authorization?: string }> = []
  let aborted = false
  const token = 'p6-fixture-model-secret-token'
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') { response.writeHead(404).end(); return }
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    requests.push({ body, authorization: request.headers.authorization })
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const send = (delta: unknown, reason: string | null = null) => response.write(`data: ${JSON.stringify({ id: 'chatcmpl-p6', object: 'chat.completion.chunk', created: 1, model: 'gpt-4o-mini', choices: [{ index: 0, delta, finish_reason: reason }] })}\n\n`)
    send({ role: 'assistant', content: holdFirst && requests.length > 1 ? token : 'Fixture summary.' })
    if (holdFirst && requests.length === 1) { response.on('close', () => { aborted = true }); return }
    send({}, 'stop')
    response.write(`data: ${JSON.stringify({ id: 'chatcmpl-p6', object: 'chat.completion.chunk', created: 1, model: 'gpt-4o-mini', choices: [], usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 } })}\n\n`)
    response.end('data: [DONE]\n\n')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Model fixture has no port')
  const configure = async (page: Page) => {
    const saved = await page.evaluate(async ({ baseURL, token }) => {
      const api = (window as any).electron.llm
      const saved = await api.saveTerminalProvider('janus', { id: 'p6-model-fixture', name: 'Model fixture', authType: 'api-key', enabled: true, baseURL, apiKey: token, modelId: 'gpt-4o-mini', defaultModelId: 'gpt-4o-mini' })
      await api.setTerminalDefault('janus', 'p6-model-fixture'); return saved
    }, { baseURL: `http://127.0.0.1:${address.port}/v1`, token })
    expect(saved.success).toBe(true)
  }
  return { requests, token, configure, aborted: () => aborted, close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) } }
}

test('P6 model tasks use the real host model adapter for UI and Agent without exposing credentials or tools', async () => {
  const f = await fixture(); const model = await modelServer(); let app: ElectronApplication | undefined
  try {
    await writeFile(join(f.source, 'manifest.json'), await readFile('packages/plugin-sdk/examples/p6-model-provider/manifest.json'))
    const booted = await boot(f.root); app = booted.app; const page = booted.page
    const workspace = await page.evaluate(path => (window as any).electron.workspace.create({ name: 'P6 Model project', path }), f.project)
    await page.reload(); await page.getByText('P6 Model project', { exact: true }).filter({ visible: true }).first().click()
    await model.configure(page); await enableFixture(app, page, f.source, workspace.id, 'example.text-summary')
    await settings(page)
    const card = page.locator('[data-plugin-id="example.text-summary"]'); await openManagement(card); await card.locator('[data-plugin-background] > summary').click()
    await expect(card).toContainText('may incur charges')
    await card.getByLabel('Summarize supplied text Input (JSON)').fill(JSON.stringify({ text: 'A supplied UI text.' }))
    await card.getByRole('button', { name: 'Run Summarize supplied text', exact: true }).click()
    await expect(card.locator('[data-plugin-model-result]')).toContainText('Fixture summary.')
    const result = await page.evaluate(async ({ workspaceId, workspaceRoot }) => {
      const api = (window as any).electron.agentRuntime
      const session = await api.createSession({ workspaceId, workspaceRoot, approvalMode: 'auto-run' })
      return api.executeTool({ sessionId: session.id, call: { toolName: 'plugin.call-service', input: { plugin: 'example.text-summary', service: 'summarize', version: 1, input: { text: 'A supplied Agent text.' } } } })
    }, { workspaceId: workspace.id, workspaceRoot: f.project })
    expect(result).toMatchObject({ status: 'completed', output: { pluginId: 'janusx.agent', state: 'completed', modelResults: [{ text: 'Fixture summary.', usage: { inputTokens: 12, outputTokens: 5 } }] } })
    expect(model.requests).toHaveLength(2)
    for (const request of model.requests) {
      expect(request.authorization).toBe(`Bearer ${model.token}`)
      expect(request.body.model).toBe('gpt-4o-mini')
      expect(request.body.max_tokens ?? request.body.max_completion_tokens).toBe(256)
      expect(request.body.tools).toBeUndefined()
      expect(JSON.stringify(request.body.messages)).not.toContain(model.token)
    }
    expect(JSON.stringify(result)).not.toContain(model.token)
    await card.locator('[data-plugin-model-result]').scrollIntoViewIfNeeded()
    await expect(card.locator('[data-plugin-model-result]')).toBeVisible()
    await page.screenshot({ path: 'artifacts/plugin-model-ui.png' })
  } finally { await close(app); await model.close(); await rm(f.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
})

test('P6 model task revocation aborts the real request and a credential echo never reaches the task result', async () => {
  const f = await fixture(); const model = await modelServer(true); let app: ElectronApplication | undefined
  try {
    await writeFile(join(f.source, 'manifest.json'), await readFile('packages/plugin-sdk/examples/p6-model-provider/manifest.json'))
    const booted = await boot(f.root); app = booted.app; const page = booted.page
    await model.configure(page); await settings(page); await importDirectory(app, page, f.source)
    const id = 'example.text-summary'
    await page.evaluate(async id => {
      const api = (window as any).electron.plugins
      for (const request of [{ type: 'development', enabled: true }, { type: 'enable', id, projects: [] }, { type: 'taskStart', id, task: 'summarize', input: { text: 'Supplied text.' }, projectId: null, scopePath: null }]) {
        const result = await api.request(request); if (!result.ok) throw new Error(result.code)
      }
    }, id)
    await expect.poll(() => model.requests.length).toBe(1)
    await page.evaluate(id => (window as any).electron.plugins.request({ type: 'disable', id }), id)
    await expect.poll(model.aborted).toBe(true)
    await page.evaluate(async id => {
      const api = (window as any).electron.plugins
      await api.request({ type: 'enable', id, projects: [] })
      await api.request({ type: 'taskStart', id, task: 'summarize', input: { text: 'Supplied text.' }, projectId: null, scopePath: null })
    }, id)
    await expect.poll(async () => {
      const snapshot = await page.evaluate(() => (window as any).electron.plugins.request({ type: 'list' }))
      return snapshot.data.tasks.at(-1)?.error
    }).toBe('MODEL_UNAVAILABLE')
    const snapshot = await page.evaluate(() => (window as any).electron.plugins.request({ type: 'list' }))
    expect(snapshot.data.tasks.map((run: any) => run.state)).toEqual(['cancelled', 'failed'])
    expect(JSON.stringify(snapshot.data.tasks)).not.toContain(model.token)
    expect(snapshot.data.tasks.every((run: any) => !run.modelResults?.length)).toBe(true)
  } finally { await close(app); await model.close(); await rm(f.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
})

test('P6 built-in Agent discovers public services, enforces approval, tracks results and cancels its host task', async () => {
  const f = await fixture(); let app: ElectronApplication | undefined
  try {
    const manifest = JSON.parse(await readFile('packages/plugin-sdk/examples/p6-status-provider/manifest.json', 'utf8'))
    // Deterministic desktop fixture: the production HTTPS transport is covered separately.
    manifest.contributes.tasks[0].steps = [{ type: 'delay', milliseconds: 1200 }, { type: 'log', message: 'Status fixture completed' }]
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(manifest))
    const booted = await boot(f.root); app = booted.app; const page = booted.page
    const workspace = await page.evaluate(path => (window as any).electron.workspace.create({ name: 'P6 Project', path }), f.project)
    await page.reload(); await page.getByText('P6 Project', { exact: true }).filter({ visible: true }).first().click()
    await enableFixture(app, page, f.source, workspace.id, manifest.id)
    const request = { plugin: manifest.id, service: 'status', version: 1, input: {} }
    const context = { workspaceId: workspace.id, workspaceRoot: f.project }
    const sessions = await page.evaluate(async context => {
      const api = (window as any).electron.agentRuntime
      const plan = await api.createSession({ ...context, approvalMode: 'plan' })
      const run = await api.createSession({ ...context, approvalMode: 'per-action' })
      return { plan: plan.id, run: run.id }
    }, context)
    const denied = await page.evaluate(({ sessionId, request }) => (window as any).electron.agentRuntime.executeTool({ sessionId, call: { toolName: 'plugin.call-service', input: request } }), { sessionId: sessions.plan, request })
    expect(denied.status).toBe('failed')
    const found = await page.evaluate(sessionId => (window as any).electron.agentRuntime.executeTool({ sessionId, call: { toolName: 'plugin.services', input: {} } }), sessions.run)
    expect(found.output).toMatchObject([{ plugin: manifest.id, service: 'status' }])
    const completed = await page.evaluate(async ({ sessionId, request }) => {
      const api = (window as any).electron.agentRuntime
      let approvals = 0
      const unsubscribe = api.onEvent((event: any) => {
        if (event.type === 'approval-requested' && event.request.sessionId === sessionId) {
          approvals++; void api.resolveApproval({ ...event.request, approvalId: event.request.id, approved: true })
        }
      })
      try { return { result: await api.executeTool({ sessionId, call: { toolName: 'plugin.call-service', input: request } }), approvals } }
      finally { unsubscribe() }
    }, { sessionId: sessions.run, request })
    expect(completed.approvals).toBe(1)
    expect(completed.result).toMatchObject({ status: 'completed', output: { pluginId: 'janusx.agent', state: 'completed', logs: [{ code: 'delay' }, { message: 'Status fixture completed' }] } })
    await page.evaluate(async ({ sessionId, request }) => {
      const api = (window as any).electron.agentRuntime
      await api.setApprovalMode(sessionId, 'auto-run')
      ;(window as any).p6Pending = api.executeTool({ sessionId, call: { toolName: 'plugin.call-service', input: request } })
    }, { sessionId: sessions.run, request })
    await expect.poll(async () => {
      const snapshot = await page.evaluate(() => (window as any).electron.plugins.request({ type: 'list' }))
      return snapshot.data.tasks.some((run: any) => run.pluginId === 'janusx.agent' && run.state === 'running')
    }).toBe(true)
    await page.evaluate(sessionId => (window as any).electron.agentRuntime.cancelSession(sessionId), sessions.run)
    expect((await page.evaluate(() => (window as any).p6Pending)).status).toBe('cancelled')
    const snapshot = await page.evaluate(() => (window as any).electron.plugins.request({ type: 'list' }))
    expect(snapshot.data.tasks.map((run: any) => run.state)).toEqual(['completed', 'cancelled'])
  } finally { await close(app); await rm(f.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
})

test('P5 manifest-only tasks run without pages, expose service logs, survive settings close and stop on provider disable', async () => {
  const f = await fixture(); let app: ElectronApplication | undefined
  try {
    const providerId = 'example.background-provider'; const consumerId = 'example.background-consumer'
    await writeFile(join(f.source, 'manifest.json'), await readFile('packages/plugin-sdk/examples/p5-provider/manifest.json'))
    const consumerSource = join(f.root, 'consumer'); await mkdir(consumerSource)
    await writeFile(join(consumerSource, 'manifest.json'), await readFile('packages/plugin-sdk/examples/p5-consumer/manifest.json'))
    const booted = await boot(f.root); app = booted.app; const page = booted.page
    await settings(page); await importDirectory(app, page, consumerSource)
    await page.evaluate(() => (window as any).electron.plugins.request({ type: 'development', enabled: true }))
    const missing = await page.evaluate(id => (window as any).electron.plugins.request({ type: 'enable', id, projects: [] }), consumerId)
    expect(missing.code).toBe('DEPENDENCY_UNAVAILABLE')
    await importDirectory(app, page, f.source)
    for (const id of [providerId, consumerId]) expect((await page.evaluate(id => (window as any).electron.plugins.request({ type: 'enable', id, projects: [] }), id)).ok).toBe(true)
    let provider = page.locator(`[data-plugin-id="${providerId}"]`)
    await openManagement(provider); await provider.locator('[data-plugin-background] > summary').click()
    await provider.getByRole('button', { name: 'Run Background report', exact: true }).click()
    await expect(provider.locator('[data-plugin-task]')).toContainText('Running')
    await page.keyboard.press('Escape')
    await expect.poll(async () => {
      const result = await page.evaluate(() => (window as any).electron.plugins.request({ type: 'list' }))
      return result.data.tasks.find((run: any) => run.pluginId === providerId)?.state
    }).toBe('completed')
    await settings(page); provider = page.locator(`[data-plugin-id="${providerId}"]`)
    await openManagement(provider); await provider.locator('[data-plugin-background] > summary').click()
    await expect(provider.locator('[data-plugin-task]')).toContainText('Report completed')
    const consumer = page.locator(`[data-plugin-id="${consumerId}"]`)
    await openManagement(consumer); await consumer.locator('[data-plugin-background] > summary').click()
    await consumer.getByRole('button', { name: 'Run Request background report', exact: true }).click()
    await expect(consumer.locator('[data-plugin-task]')).toContainText('Running')
    await provider.getByRole('button', { name: 'Disable', exact: true }).click()
    await expect(consumer.locator('[data-plugin-task]')).toContainText('Stopped')
    expect(await app.evaluate(({ webContents }) => webContents.getAllWebContents().filter(contents => contents.getURL().startsWith('janusx-plugin:')).length)).toBe(0)
    await close(app); app = undefined
  } finally { await close(app); await rm(f.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
})

test('P5 isolated bridges exchange declared events and services while direct network and unapproved broker destinations remain blocked', async () => {
  const f = await fixture(); let app: ElectronApplication | undefined; let hits = 0
  const listener = createServer((_request, response) => { hits++; response.end('unexpected') })
  await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve))
  try {
    const provider = JSON.parse(await readFile(join(f.source, 'manifest.json'), 'utf8'))
    provider.capabilities.required.push('tasks.declarative', 'events.public', 'services.public', 'network.fetch')
    provider.permissions.push({ name: 'tasks.run' }, { name: 'events.public' }, { name: 'services.public' }, { name: 'network.fetch', origins: ['https://api.example.com'] })
    provider.contributes.tasks = [{ id: 'report', title: 'Report', scope: 'project', input: {}, timeoutMs: 2000, steps: [{ type: 'delay', milliseconds: 50 }, { type: 'log', message: 'Service reported' }] }]
    provider.contributes.services = [{ id: 'report', version: 1, task: 'report', consumers: ['example.p5-consumer'] }]
    provider.contributes.events = [{ id: 'reported', version: 1, scope: 'project', data: { status: 'string' }, consumers: ['example.p5-consumer'] }]
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(provider))
    const consumerSource = join(f.root, 'consumer'); await mkdir(consumerSource); await cp(join(f.source, 'dist'), join(consumerSource, 'dist'), { recursive: true })
    const consumer = structuredClone(provider); consumer.id = 'example.p5-consumer'; consumer.name = 'P5 consumer'
    delete consumer.contributes.services; delete consumer.contributes.events
    consumer.contributes.commands[0].title = 'Open P5 consumer'
    consumer.contributes.consumes = { services: [{ plugin: pluginId, id: 'report', version: 1, schema: {} }], events: [{ plugin: pluginId, id: 'reported', version: 1, schema: { status: 'string' } }] }
    await writeFile(join(consumerSource, 'manifest.json'), JSON.stringify(consumer))
    const booted = await boot(f.root); app = booted.app; const page = booted.page
    const workspace = await page.evaluate(path => (window as any).electron.workspace.create({ name: 'P5 Project', path }), f.project)
    await page.reload(); await page.getByText('P5 Project', { exact: true }).filter({ visible: true }).first().click()
    await enableFixture(app, page, f.source, workspace.id); await enableFixture(app, page, consumerSource, workspace.id, consumer.id)
    await openDetails(page); const providerPage = await guest(app, '/dist/index.html')
    await page.locator('button[data-id="tool-menu"]').click(); await page.getByRole('menuitem', { name: 'Open P5 consumer', exact: true }).click()
    const consumerPage = await guest(app, '/dist/index.html', providerPage.url())
    const sub = await rawCall(consumerPage, 'events.subscribe', { plugin: pluginId, event: 'reported', version: 1 }); expect(sub.ok).toBe(true)
    await consumerPage.evaluate(() => { (window as any).receivedP5 = []; (window as any).testPort.addEventListener('message', (event: MessageEvent) => { if (event.data.event === 'public') (window as any).receivedP5.push(event.data.payload) }) })
    expect((await rawCall(providerPage, 'events.publish', { event: 'reported', data: { status: 'complete' } })).ok).toBe(true)
    await expect.poll(() => consumerPage.evaluate(() => (window as any).receivedP5[0]?.data.status)).toBe('complete')
    const run = await rawCall(consumerPage, 'services.call', { plugin: pluginId, service: 'report', version: 1, input: {} }); expect(run.ok).toBe(true)
    await expect.poll(async () => {
      const result = await rawCall(consumerPage, 'tasks.list', {}); return result.result.find((item: any) => item.id === run.result.id)?.state
    }).toBe('completed')
    expect((await rawCall(providerPage, 'services.call', { plugin: consumer.id, service: 'report', version: 1, input: {} })).error.code).toBe('PERMISSION_DENIED')
    const address = listener.address(); if (!address || typeof address === 'string') throw new Error('Missing listener')
    const url = `http://127.0.0.1:${address.port}/blocked`
    expect((await rawCall(providerPage, 'network.fetch', { url })).error.code).toBe('NETWORK_DENIED')
    expect(await providerPage.evaluate(async url => { try { await fetch(url); return 'connected' } catch { return 'blocked' } }, url)).toBe('blocked')
    expect(hits).toBe(0)
    expect(await providerPage.evaluate(() => ({ bridge: typeof (window as any).electron, node: typeof (window as any).require }))).toEqual({ bridge: 'undefined', node: 'undefined' })
    await close(app); app = undefined
  } finally { await close(app); await new Promise<void>(resolve => listener.close(() => resolve())); await rm(f.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
})

test('P5 host credential input encrypts, persists and revokes tokens without returning secrets or persisting task runs', async () => {
  const f = await fixture(); let app: ElectronApplication | undefined
  try {
    const value = JSON.parse(await readFile('packages/plugin-sdk/examples/p5-provider/manifest.json', 'utf8'))
    value.capabilities.required.push('network.fetch', 'credentials.use')
    value.permissions.push({ name: 'network.fetch', origins: ['https://api.example.com'] }, { name: 'credentials.use' })
    value.contributes.credentials = [{ id: 'token', title: 'P5 API token', origin: 'https://api.example.com' }]
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(value))
    let booted = await boot(f.root); app = booted.app; let page = booted.page
    await settings(page); await importDirectory(app, page, f.source)
    for (const request of [{ type: 'development', enabled: true }, { type: 'enable', id: value.id, projects: [] }]) expect((await page.evaluate(input => (window as any).electron.plugins.request(input), request)).ok).toBe(true)
    let card = page.locator(`[data-plugin-id="${value.id}"]`)
    await openManagement(card); await card.locator('[data-plugin-background] > summary').click()
    await card.getByLabel('P5 API token', { exact: true }).fill('p5-desktop-fixture-token')
    await card.getByRole('button', { name: 'Save credential', exact: true }).click()
    await expect(card.getByText('https://api.example.com · Credential configured', { exact: true })).toBeVisible()
    await expect(card.getByLabel('P5 API token', { exact: true })).toHaveValue('')
    const snapshot = await page.evaluate(() => (window as any).electron.plugins.request({ type: 'list' }))
    expect(JSON.stringify(snapshot)).not.toContain('p5-desktop-fixture-token')
    const userData = await app.evaluate(({ app }) => app.getPath('userData'))
    const credentialRoot = join(userData, 'janusx/plugins/credentials')
    const credentialFolder = join(credentialRoot, (await readdir(credentialRoot))[0])
    const persisted = await readFile(join(credentialFolder, (await readdir(credentialFolder))[0]))
    expect(persisted.includes(Buffer.from('p5-desktop-fixture-token'))).toBe(false)
    await close(app); app = undefined; booted = await boot(f.root); app = booted.app; page = booted.page
    await settings(page); card = page.locator(`[data-plugin-id="${value.id}"]`)
    await openManagement(card); await card.locator('[data-plugin-background] > summary').click()
    await expect(card.getByText('https://api.example.com · Credential configured', { exact: true })).toBeVisible()
    await card.getByRole('button', { name: 'Revoke credential', exact: true }).click()
    await expect(card.getByText('https://api.example.com · No credential configured', { exact: true })).toBeVisible()
    expect((await page.evaluate(() => (window as any).electron.plugins.request({ type: 'list' }))).data.tasks).toEqual([])
    await close(app); app = undefined
  } finally { await close(app); await rm(f.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
})

test('P4a declarative configuration persists, inherits, updates both plugin views and rejects stale forms', async ({}, testInfo) => {
  const f = await fixture(); let app: ElectronApplication | undefined
  try {
    const manifest = JSON.parse(await readFile(join(f.source, 'manifest.json'), 'utf8'))
    manifest.permissions.push({ name: 'configuration.read' }); manifest.capabilities.required.push('configuration.settings', 'configuration.open')
    manifest.contributes.settings = [
      { key: 'label', title: 'Reference label', type: 'string', default: 'Reference', scope: 'project', minLength: 1, maxLength: 40 },
      { key: 'enabled', title: 'Show details', type: 'boolean', default: true, scope: 'project' },
      { key: 'limit', title: 'Item limit', type: 'number', default: 10, minimum: 1, maximum: 100, integer: true, scope: 'project' },
      { key: 'style', title: 'Display style', type: 'enum', default: 'compact', options: ['compact', 'full'], scope: 'application' },
    ]
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(manifest))
    let booted = await boot(f.root); app = booted.app; let page = booted.page
    const workspace = await page.evaluate(path => (window as any).electron.workspace.create({ name: 'P4a Settings A', path }), f.project)
    const other = join(f.root, 'project-b'); await mkdir(other); await writeFile(join(other, 'README.md'), 'B')
    const workspaceB = await page.evaluate(path => (window as any).electron.workspace.create({ name: 'P4a Settings B', path }), other)
    await page.reload(); await page.getByText('P4a Settings A', { exact: true }).filter({ visible: true }).first().click()
    await enableFixture(app, page, f.source, workspace.id)
    await page.evaluate(async ({ id, projects }) => (window as any).electron.plugins.request({ type: 'enable', id, projects }), { id: pluginId, projects: [workspace.id, workspaceB.id] })
    await openDetails(page)
    let details = await guest(app, '/dist/index.html')
    await expect(details.locator('#configuration')).toContainText('Reference')
    await details.getByRole('button', { name: 'Summary', exact: true }).click()
    let summary = await guest(app, '/dist/summary.html')
    await expect(summary.locator('#configuration')).toContainText('Reference')
    // The guest can navigate only to its own host form; native pages are occluded by the modal.
    await summary.getByRole('button', { name: 'Configure plugin', exact: true }).click()
    let card = page.locator(`[data-plugin-id="${pluginId}"]`)
    let form = card.locator('[data-plugin-configuration]')
    await expect(form).toBeVisible()
    await expect(form.getByRole('combobox', { name: 'Configuration scope', exact: true })).toHaveValue('project')
    await expect(page.locator('[data-plugin-native]')).toHaveCount(2)
    await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children
      .filter(child => (child as any).webContents?.getURL().startsWith('janusx-plugin:')).length)).toBe(0)
    await form.getByRole('combobox', { name: 'Configuration scope', exact: true }).selectOption('application')
    await expect(form.getByRole('textbox', { name: 'Reference label', exact: true })).toHaveValue('Reference')
    await form.getByRole('textbox', { name: 'Reference label', exact: true }).fill('Global label')
    // Scope switches and closing Settings must preserve each unsaved draft independently.
    await form.getByRole('combobox', { name: 'Configuration scope', exact: true }).selectOption('project')
    await expect(form.getByRole('textbox', { name: 'Reference label', exact: true })).toHaveValue('Reference')
    await form.getByRole('textbox', { name: 'Reference label', exact: true }).fill('Project draft')
    await form.getByRole('combobox', { name: 'Configuration scope', exact: true }).selectOption('application')
    await expect(form.getByRole('textbox', { name: 'Reference label', exact: true })).toHaveValue('Global label')
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-plugin-settings]')).toBeHidden()
    await settings(page)
    await openManagement(card); await card.getByText('Configuration', { exact: true }).click()
    await expect(form.getByRole('textbox', { name: 'Reference label', exact: true })).toHaveValue('Global label')
    await form.getByRole('combobox', { name: 'Configuration scope', exact: true }).selectOption('project')
    await expect(form.getByRole('textbox', { name: 'Reference label', exact: true })).toHaveValue('Project draft')
    await form.getByRole('button', { name: 'Reload configuration', exact: true }).click()
    await form.getByRole('alertdialog').getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(form.getByRole('textbox', { name: 'Reference label', exact: true })).toHaveValue('Project draft')
    await form.getByRole('button', { name: 'Reload configuration', exact: true }).click()
    await form.getByRole('alertdialog').getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect(form.getByRole('textbox', { name: 'Reference label', exact: true })).toHaveValue('Reference')
    await form.getByRole('combobox', { name: 'Configuration scope', exact: true }).selectOption('application')
    await expect(form.getByRole('textbox', { name: 'Reference label', exact: true })).toHaveValue('Global label')
    await form.getByRole('checkbox', { name: 'Show details', exact: true }).uncheck()
    await form.getByRole('spinbutton', { name: 'Item limit', exact: true }).fill('101')
    await expect(form.getByRole('button', { name: 'Save configuration', exact: true })).toBeDisabled()
    await form.getByRole('spinbutton', { name: 'Item limit', exact: true }).fill('25')
    await form.getByRole('combobox', { name: 'Display style', exact: true }).selectOption('full')
    await form.getByRole('button', { name: 'Save configuration', exact: true }).click()
    await expect(form.getByText('Configuration saved.', { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('plugin-configuration.png') })
    await expect(details.locator('#configuration')).toContainText('Global label')
    await expect(summary.locator('#configuration')).toContainText('Global label')
    await page.keyboard.press('Escape')
    await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children
      .filter(child => (child as any).webContents?.getURL().startsWith('janusx-plugin:')).length)).toBe(2)
    await page.locator(`[data-plugin-view="${pluginId}/summary"]`).getByRole('button', { name: 'Configuration', exact: true }).click()
    card = page.locator(`[data-plugin-id="${pluginId}"]`); form = card.locator('[data-plugin-configuration]')
    await expect(form).toBeVisible()
    await expect(form.getByRole('combobox', { name: 'Configuration scope', exact: true })).toHaveValue('project')
    await form.getByRole('combobox', { name: 'Configuration scope', exact: true }).selectOption('project')
    await expect(form.getByRole('combobox', { name: 'Display style', exact: true })).toBeDisabled()
    await form.getByRole('textbox', { name: 'Reference label', exact: true }).fill('Local label')
    await form.getByRole('button', { name: 'Save configuration', exact: true }).click()
    await expect(details.locator('#configuration')).toContainText('Local label')
    await expect(summary.locator('#configuration')).toContainText('Local label')
    const stale = await page.evaluate(async ({ id, projectId, scopePath }) => (await (window as any).electron.plugins.request({ type: 'configurationGet', id, projectId, scopePath })).data,
      { id: pluginId, projectId: workspace.id, scopePath: f.project })
    await page.evaluate(async ({ id, projectId, scopePath, revision }) => (window as any).electron.plugins.request({ type: 'configurationUpdate', id, projectId, scopePath, expectedRevision: revision, patch: { label: 'Other editor' }, reset: false }),
      { id: pluginId, projectId: workspace.id, scopePath: f.project, revision: stale.revision })
    await form.getByRole('textbox', { name: 'Reference label', exact: true }).fill('My pending change')
    await form.getByRole('button', { name: 'Save configuration', exact: true }).click()
    await expect(form.getByRole('alert')).toContainText('Configuration changed elsewhere')
    await expect(form.getByRole('textbox', { name: 'Reference label', exact: true })).toHaveValue('My pending change')
    await form.getByRole('button', { name: 'Reload configuration', exact: true }).click()
    await form.getByRole('alertdialog').getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect(form.getByRole('textbox', { name: 'Reference label', exact: true })).toHaveValue('Other editor')
    await close(app); app = undefined
    booted = await boot(f.root); app = booted.app; page = booted.page
    await page.getByText('P4a Settings A', { exact: true }).filter({ visible: true }).first().click()
    await openDetails(page); details = await guest(app, '/dist/index.html')
    await expect(details.locator('#configuration')).toContainText('Other editor')
    await settings(page); card = page.locator(`[data-plugin-id="${pluginId}"]`)
    await openManagement(card); await card.getByText('Configuration', { exact: true }).click(); form = card.locator('[data-plugin-configuration]')
    await form.getByRole('combobox', { name: 'Configuration scope', exact: true }).selectOption('project')
    await form.getByRole('button', { name: 'Reset this scope', exact: true }).click()
    await form.getByRole('alertdialog').getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect(details.locator('#configuration')).toContainText('Global label')
    await page.keyboard.press('Escape')
    await page.getByText('P4a Settings B', { exact: true }).filter({ visible: true }).first().click()
    await openDetails(page)
    await expect((await guest(app, '/dist/index.html')).locator('#configuration')).toContainText('Global label')
    await settings(page); card = page.locator(`[data-plugin-id="${pluginId}"]`)
    await openManagement(card); await card.getByText('Configuration', { exact: true }).click(); form = card.locator('[data-plugin-configuration]')
    await form.getByRole('button', { name: 'Reset this scope', exact: true }).click()
    await form.getByRole('alertdialog').getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect((await guest(app, '/dist/index.html')).locator('#configuration')).toContainText('Reference')
  } finally { await close(app); await rm(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) }
})

test('P4a isolated custom settings propose edits for host review and keep application and project scopes separate', async ({}, testInfo) => {
  const f = await fixture(); let app: ElectronApplication | undefined
  try {
    const manifest = JSON.parse(await readFile(join(f.source, 'manifest.json'), 'utf8'))
    manifest.permissions.push({ name: 'configuration.read' }, { name: 'configuration.propose' })
    manifest.capabilities.required.push('configuration.settings', 'configuration.customViews')
    manifest.contributes.settings = [
      { key: 'label', title: 'Reference label', type: 'string', default: 'Reference', scope: 'project' },
      { key: 'style', title: 'Display style', type: 'enum', default: 'compact', options: ['compact', 'full'], scope: 'application' },
    ]
    manifest.contributes.views.push({ ...manifest.contributes.views.find((view: any) => view.id === 'desk'), id: 'app-config', scope: 'application', entry: 'dist/summary.html' })
    manifest.contributes.configurationViews = { application: 'app-config', project: 'desk' }
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(manifest))
    const booted = await boot(f.root); app = booted.app; const page = booted.page
    const workspace = await page.evaluate(path => (window as any).electron.workspace.create({ name: 'Custom settings project', path }), f.project)
    await page.reload(); await page.getByText('Custom settings project', { exact: true }).filter({ visible: true }).first().click()
    await enableFixture(app, page, f.source, workspace.id); await settings(page)
    const card = page.locator(`[data-plugin-id="${pluginId}"]`)
    await openManagement(card); await card.getByText('Configuration', { exact: true }).click()
    const form = card.locator('[data-plugin-configuration]')
    await form.getByRole('combobox', { name: 'Configuration scope', exact: true }).selectOption('project')
    await form.getByRole('button', { name: 'Open custom settings', exact: true }).click()
    const custom = await guest(app, '/dist/index.html')
    await expect(page.locator('[data-plugin-workbench]')).toBeVisible()
    await expect(custom.getByRole('textbox', { name: 'Configuration patch', exact: true })).toBeVisible()
    expect(await custom.evaluate(() => ({ node: typeof (window as any).require, bridge: typeof (window as any).electron, origin: self.origin }))).toEqual({ node: 'undefined', bridge: 'undefined', origin: 'null' })
    await custom.getByRole('textbox', { name: 'Configuration patch', exact: true }).fill('{"label":"Custom project"}')
    await custom.getByRole('button', { name: 'Review configuration changes', exact: true }).click()
    await expect(form.getByRole('textbox', { name: 'Reference label', exact: true })).toHaveValue('Custom project')
    await expect(form.getByText('This plugin proposed these changes.', { exact: false })).toBeVisible()
    await expect(page.locator('[data-plugin-workbench]')).toBeHidden()
    const read = (projectId: string | null, scopePath: string | null) => page.evaluate(async target => (await (window as any).electron.plugins.request({ type: 'configurationGet', ...target })).data,
      { id: pluginId, projectId, scopePath })
    expect((await read(workspace.id, f.project)).values.label).toBe('Reference')
    await page.screenshot({ path: testInfo.outputPath('custom-settings-review.png') })
    await form.getByRole('button', { name: 'Save configuration', exact: true }).click()
    await expect(form.getByText('Configuration saved.', { exact: true })).toBeVisible()
    expect((await read(workspace.id, f.project)).values.label).toBe('Custom project')
    expect((await read(null, null)).values.label).toBe('Reference')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Return to previous view', exact: true }).click()
    await expect.poll(() => custom.isClosed()).toBe(true)
    await settings(page); await openManagement(card); await card.getByText('Configuration', { exact: true }).click()
    await form.getByRole('button', { name: 'Open custom settings', exact: true }).click()
    const application = await guest(app, '/dist/summary.html')
    await application.getByRole('textbox', { name: 'Configuration patch', exact: true }).fill('{"style":"full","label":"Custom app"}')
    // App and project pages share a navigation budget; advance the cooldown without weakening production policy.
    await page.waitForTimeout(10_000)
    await application.getByRole('button', { name: 'Review configuration changes', exact: true }).click()
    await expect(form.getByRole('textbox', { name: 'Reference label', exact: true })).toHaveValue('Custom app')
    await expect(form.getByRole('combobox', { name: 'Configuration scope', exact: true })).toHaveValue('application')
    // A competing host update after handoff must leave the review draft intact on conflict.
    const state = await read(null, null)
    await page.evaluate(async input => (window as any).electron.plugins.request(input), { type: 'configurationUpdate', id: pluginId, projectId: null, scopePath: null,
      expectedRevision: state.revision, patch: { label: 'Concurrent app' }, reset: false })
    await form.getByRole('button', { name: 'Save configuration', exact: true }).click()
    await expect(form.getByRole('alert')).toContainText('Configuration changed elsewhere')
    await expect(form.getByRole('textbox', { name: 'Reference label', exact: true })).toHaveValue('Custom app')
    await form.getByRole('button', { name: 'Reload configuration', exact: true }).click()
    await form.getByRole('alertdialog').getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect(form.getByRole('textbox', { name: 'Reference label', exact: true })).toHaveValue('Concurrent app')
    await expect(form.getByText('This plugin proposed these changes.', { exact: false })).toHaveCount(0)
    expect((await read(workspace.id, f.project)).values.label).toBe('Custom project')
    await page.keyboard.press('Escape')
    await app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(contents => contents.getURL() === url)!.forcefullyCrashRenderer(), application.url())
    await page.locator(`[data-plugin-view="${pluginId}/app-config"]`).getByRole('button', { name: 'Configuration', exact: true }).click()
    await expect(form.getByRole('textbox', { name: 'Reference label', exact: true })).toHaveValue('Concurrent app')
    await card.getByRole('button', { name: 'Disable', exact: true }).click()
    await expect.poll(() => application.isClosed()).toBe(true)
  } finally { await close(app); await rm(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) }
})

test('P4a users review and explicitly migrate renamed configuration independently in each scope', async ({}, testInfo) => {
  const f = await fixture(); let app: ElectronApplication | undefined
  try {
    const manifestPath = join(f.source, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.permissions.push({ name: 'configuration.read' }); manifest.capabilities.required.push('configuration.settings')
    manifest.contributes.settings = [{ key: 'label', title: 'Reference label', type: 'string', default: 'Reference', scope: 'project' }]
    await writeFile(manifestPath, JSON.stringify(manifest))
    const booted = await boot(f.root); app = booted.app; const page = booted.page
    const workspace = await page.evaluate(path => (window as any).electron.workspace.create({ name: 'Migration project', path }), f.project)
    await page.reload(); await page.getByText('Migration project', { exact: true }).filter({ visible: true }).first().click()
    await enableFixture(app, page, f.source, workspace.id); await settings(page)
    const card = page.locator(`[data-plugin-id="${pluginId}"]`)
    await openManagement(card); await card.getByText('Configuration', { exact: true }).click()
    const form = card.locator('[data-plugin-configuration]')
    await form.getByRole('textbox', { name: 'Reference label', exact: true }).fill('Application old')
    await form.getByRole('button', { name: 'Save configuration', exact: true }).click()
    await expect(form.getByText('Configuration saved.', { exact: true })).toBeVisible()
    await form.getByRole('combobox', { name: 'Configuration scope', exact: true }).selectOption('project')
    await form.getByRole('textbox', { name: 'Reference label', exact: true }).fill('Project old')
    await form.getByRole('button', { name: 'Save configuration', exact: true }).click()
    await expect(form.getByText('Configuration saved.', { exact: true })).toBeVisible()
    manifest.capabilities.required.push('configuration.migrations')
    manifest.contributes.settings[0].key = 'name'
    manifest.contributes.settings[0].title = 'Reference name'
    manifest.contributes.settingMigrations = [{ from: 'label', to: 'name' }]
    await writeFile(manifestPath, JSON.stringify(manifest))
    await openManagement(card); await card.getByText('Advanced actions and diagnostics', { exact: true }).click()
    await card.getByRole('button', { name: 'Reload', exact: true }).click()
    const input = form.getByRole('textbox', { name: 'Reference name', exact: true })
    await expect(input).toHaveValue('Reference')
    await expect(form.getByText('label → name · Ready', { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('configuration-migration.png') })
    await input.fill('Pending edit')
    await expect(form.getByRole('button', { name: 'Apply compatible migrations', exact: true })).toBeDisabled()
    await form.getByRole('button', { name: 'Reload configuration', exact: true }).click()
    await form.getByRole('alertdialog').getByRole('button', { name: 'Confirm', exact: true }).click()
    await form.getByRole('button', { name: 'Apply compatible migrations', exact: true }).click()
    await expect(input).toHaveValue('Project old')
    await expect(form.getByRole('button', { name: 'Apply compatible migrations', exact: true })).toHaveCount(0)
    await form.getByRole('combobox', { name: 'Configuration scope', exact: true }).selectOption('application')
    await expect(input).toHaveValue('Reference')
    await form.getByRole('button', { name: 'Apply compatible migrations', exact: true }).click()
    await expect(input).toHaveValue('Application old')
    await form.getByRole('combobox', { name: 'Configuration scope', exact: true }).selectOption('project')
    await expect(input).toHaveValue('Project old')
    await page.keyboard.press('Escape'); await openDetails(page)
    await expect((await guest(app, '/dist/index.html')).locator('#configuration')).toContainText('Project old')
  } finally { await close(app); await rm(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) }
})

test('P4 multiple pages retain their keys across reload and list only granted directory metadata', async () => {
  const f = await fixture(); let app: ElectronApplication | undefined
  try {
    const manifest = JSON.parse(await readFile(join(f.source, 'manifest.json'), 'utf8'))
    manifest.capabilities.required.push('views.multiple', 'files.listDirectory')
    manifest.permissions.push({ name: 'workspace.directories.list', paths: ['docs'] })
    manifest.contributes.views.find((view: any) => view.id === 'details').instancePolicy = 'multiple'
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(manifest))
    await mkdir(join(f.project, 'docs')); await writeFile(join(f.project, 'docs/a.txt'), 'not granted'); await writeFile(join(f.project, 'docs/.env'), 'secret')
    const booted = await boot(f.root); app = booted.app; const page = booted.page
    const workspace = await page.evaluate(path => (window as any).electron.workspace.create({ name: 'P4 Instances', path }), f.project)
    await page.reload(); await page.getByText('P4 Instances', { exact: true }).filter({ visible: true }).first().click()
    await enableFixture(app, page, f.source, workspace.id)
    await openDetails(page); const first = await guest(app, '/dist/index.html')
    const firstContext = await rawCall(first, 'workspace.getContext', {})
    await openDetails(page); const second = await guest(app, '/dist/index.html', first.url())
    const secondContext = await rawCall(second, 'workspace.getContext', {})
    expect(firstContext.result.instanceKey).not.toBe(secondContext.result.instanceKey)
    expect(await rawCall(second, 'workspace.listDirectory', { path: 'docs' })).toMatchObject({ ok: true, result: { entries: [{ name: 'a.txt', type: 'file' }], truncated: false } })
    expect(await rawCall(second, 'workspace.readText', { path: 'docs/a.txt' })).toMatchObject({ ok: false, error: { code: 'PATH_NOT_GRANTED' } })
    expect(await rawCall(second, 'workspace.listDirectory', { path: '.' })).toMatchObject({ ok: false, error: { code: 'PATH_NOT_GRANTED' } })
    expect(await rawCall(second, 'views.open', { view: 'details', instanceKey: firstContext.result.instanceKey })).toMatchObject({ ok: true })
    const detailsPages = () => app!.context().pages().filter(item => item.url().startsWith('janusx-plugin:') && item.url().endsWith('/dist/index.html'))
    expect(detailsPages()).toHaveLength(2)
    await page.evaluate(id => (window as any).electron.plugins.request({ type: 'reload', id }), pluginId)
    await expect.poll(async () => {
      try { return (await Promise.all(detailsPages().map(item => rawCall(item, 'workspace.getContext', {})))).map(result => result.result.instanceKey).sort() } catch { return [] }
    }).toEqual([firstContext.result.instanceKey, secondContext.result.instanceKey].sort())
    await page.evaluate(id => (window as any).electron.plugins.request({ type: 'disable', id }), pluginId)
    await expect.poll(() => detailsPages().length).toBe(0)
  } finally { await close(app); await rm(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) }
})

test('P4 continuous drafts survive saves and offer manual diff review with a second disk-version check', async () => {
  const f = await fixture(); let app: ElectronApplication | undefined
  try {
    const manifest = JSON.parse(await readFile(join(f.source, 'manifest.json'), 'utf8'))
    manifest.permissions.push({ name: 'documents.read' }, { name: 'documents.edit' }, { name: 'documents.draft' })
    manifest.capabilities.required.push('documents.viewers', 'documents.readText', 'documents.applyEdit', 'documents.draft')
    manifest.contributes.viewers = [{ id: 'text', title: 'Reference text', view: 'details', extensions: ['.txt'] }]
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(manifest))
    const filePath = join(f.project, 'draft.txt'); await writeFile(filePath, 'original')
    const booted = await boot(f.root); app = booted.app; const page = booted.page
    const workspace = await page.evaluate(path => (window as any).electron.workspace.create({ name: 'P4 Continuous', path }), f.project)
    await page.reload(); await page.getByText('P4 Continuous', { exact: true }).filter({ visible: true }).first().click()
    await enableFixture(app, page, f.source, workspace.id)
    await page.evaluate(payload => (window as any).electron.window.openEditor(payload), { filePath, workspacePath: f.project })
    const editor = page.locator('[data-editor-host="embedded"]')
    await editor.getByRole('combobox', { name: 'Open with', exact: true }).selectOption(`${pluginId}/text`)
    let plugin = await guest(app, '/dist/index.html')
    const keep = async (text: string) => {
      await plugin.getByRole('textbox', { name: 'Document draft', exact: true }).fill(text)
      await plugin.getByRole('button', { name: 'Keep draft in host', exact: true }).click()
      await expect(plugin.locator('#status')).toContainText('Draft kept by JanusX')
    }
    await keep('first draft'); await keep('second draft')
    expect(await readFile(filePath, 'utf8')).toBe('original')
    const oldUrl = plugin.url()
    await editor.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(() => readFile(filePath, 'utf8')).toBe('second draft')
    plugin = await guest(app, '/dist/index.html', oldUrl)
    await expect(plugin.getByRole('textbox', { name: 'Document draft', exact: true })).toHaveValue('second draft')
    await keep('my changes'); await writeFile(filePath, 'external changes')
    await editor.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(editor.getByRole('alert')).toContainText('Your draft is kept')
    await expect(editor.locator('.monaco-diff-editor')).toBeVisible()
    await expect(editor.locator('.view-lines')).toContainText(['external changes', 'my changes'])
    await writeFile(filePath, 'external again')
    await editor.getByRole('button', { name: 'Save reviewed result', exact: true }).click()
    expect(await readFile(filePath, 'utf8')).toBe('external again')
    await expect(editor.locator('.view-lines')).toContainText(['external again', 'my changes'])
    await expect(editor.locator('.monaco-diff-editor .view-lines.line-delete').filter({ visible: true })).toContainText('external again')
    const modified = editor.locator('.monaco-diff-editor .modified .view-lines:not(.line-delete)')
    await modified.click(); await page.keyboard.press('Control+A'); await page.keyboard.type('manually merged')
    await page.screenshot({ path: 'artifacts/plugin-p4-conflict-review.png' })
    await editor.getByRole('button', { name: 'Save reviewed result', exact: true }).click()
    await expect.poll(() => readFile(filePath, 'utf8')).toBe('manually merged')
    await expect(editor.getByRole('button', { name: 'Save reviewed result', exact: true })).toHaveCount(0)
  } finally { await close(app); await rm(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) }
})

test('P4 plugin drafts are host-owned, reviewed before saving and retained on disk conflict or disable', async () => {
  const f = await fixture(); let app: ElectronApplication | undefined
  try {
    const manifest = JSON.parse(await readFile(join(f.source, 'manifest.json'), 'utf8'))
    manifest.permissions.push({ name: 'documents.read' }, { name: 'documents.edit' })
    manifest.capabilities.required.push('documents.viewers', 'documents.readText', 'documents.applyEdit')
    manifest.contributes.viewers = [{ id: 'text', title: 'Reference text', view: 'details', extensions: ['.txt'] }]
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(manifest))
    const first = join(f.project, 'a.txt'); const second = join(f.project, 'b.txt')
    await writeFile(first, 'original A'); await writeFile(second, 'original B')
    const booted = await boot(f.root); app = booted.app; const page = booted.page
    const workspace = await page.evaluate(path => (window as any).electron.workspace.create({ name: 'P4 Drafts', path }), f.project)
    await page.reload(); await page.getByText('P4 Drafts', { exact: true }).filter({ visible: true }).first().click()
    await enableFixture(app, page, f.source, workspace.id)
    const editor = page.locator('[data-editor-host="embedded"]')
    const open = (filePath: string) => page.evaluate(payload => (window as any).electron.window.openEditor(payload), { filePath, workspacePath: f.project })
    const draft = async (text: string) => {
      await editor.getByRole('combobox', { name: 'Open with', exact: true }).selectOption(`${pluginId}/text`)
      const plugin = await guest(app!, '/dist/index.html')
      await plugin.getByRole('textbox', { name: 'Document draft', exact: true }).fill(text)
      await plugin.getByRole('button', { name: 'Send draft for review', exact: true }).click()
      await expect(plugin.locator('#status')).toContainText('Draft kept by JanusX')
      await expect(editor.getByRole('button', { name: 'Review draft in built-in editor', exact: true })).toBeVisible()
      return plugin
    }
    await open(first); await draft('plugin draft A')
    expect(await readFile(first, 'utf8')).toBe('original A')
    await editor.getByRole('button', { name: 'Close a.txt', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children
      .filter(child => (child as any).webContents?.getURL().startsWith('janusx-plugin:')).length)).toBe(0)
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
    await editor.getByRole('button', { name: 'Review draft in built-in editor', exact: true }).click()
    await expect(editor.locator('.view-lines')).toContainText('plugin draft A')
    await editor.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(() => readFile(first, 'utf8')).toBe('plugin draft A')
    await open(second); await draft('plugin draft B')
    await writeFile(second, 'external B')
    await page.evaluate(id => (window as any).electron.plugins.request({ type: 'disable', id }), pluginId)
    await expect(editor.locator('[data-document-viewer="builtin"]')).toBeVisible()
    await expect(editor.locator('.view-lines').filter({ hasText: 'plugin draft B' }).last()).toContainText('plugin draft B')
    await editor.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(editor.getByRole('alert')).toContainText('Your draft is kept')
    expect(await readFile(second, 'utf8')).toBe('external B')
    await expect(editor.locator('.view-lines').filter({ hasText: 'plugin draft B' }).last()).toContainText('plugin draft B')
    await open(first); await open(second)
    await expect(editor.locator('.view-lines').filter({ hasText: 'plugin draft B' }).last()).toContainText('plugin draft B')
    await editor.getByRole('button', { name: 'Close b.txt', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Save and close', exact: true }).click()
    await expect(dialog.getByRole('alert')).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(editor.locator('.view-lines').filter({ hasText: 'plugin draft B' }).last()).toContainText('plugin draft B')
    await editor.getByRole('button', { name: 'More file actions', exact: true }).click()
    await page.getByRole('dialog', { name: 'More file actions', exact: true }).getByRole('button', { name: 'Return to floating window', exact: true }).click()
    await expect.poll(() => app!.windows().some(window => window.url().includes('editorWindow=1'))).toBe(true)
    const floating = app.windows().find(window => window.url().includes('editorWindow=1'))!
    await expect(floating.locator('.view-lines').filter({ hasText: 'plugin draft B' }).last()).toContainText('plugin draft B')
    await floating.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(floating.getByRole('alert').filter({ hasText: 'Your draft is kept' })).toBeVisible()
    expect(await readFile(second, 'utf8')).toBe('external B')
    await floating.getByRole('button', { name: 'More file actions', exact: true }).click()
    await floating.getByRole('dialog', { name: 'More file actions', exact: true }).getByRole('button', { name: 'Embed into main workspace', exact: true }).click()
    await expect(editor.locator('.view-lines').filter({ hasText: 'plugin draft B' }).last()).toContainText('plugin draft B')
  } finally { await close(app); await rm(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) }
})

test('P4 document viewers bind files, persist defaults, shield dialogs and fall back without losing drafts', async () => {
  const f = await fixture(); let app: ElectronApplication | undefined
  try {
    const manifest = JSON.parse(await readFile(join(f.source, 'manifest.json'), 'utf8'))
    manifest.permissions.push({ name: 'documents.read' })
    manifest.capabilities.required.push('documents.viewers', 'documents.readText')
    manifest.contributes.viewers = [{ id: 'text', title: 'Reference text', view: 'details', extensions: ['.txt'] }]
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(manifest))
    const first = join(f.project, 'a.txt'); const second = join(f.project, 'b.txt')
    await writeFile(first, 'P4 file A'); await writeFile(second, 'P4 file B')
    let booted = await boot(f.root); app = booted.app; let page = booted.page
    const workspace = await page.evaluate(path => (window as any).electron.workspace.create({ name: 'P4 Files', path }), f.project)
    await page.reload(); await page.getByText('P4 Files', { exact: true }).filter({ visible: true }).first().click()
    await enableFixture(app, page, f.source, workspace.id)
    const open = (filePath: string) => page.evaluate(payload => (window as any).electron.window.openEditor(payload), { filePath, workspacePath: f.project })
    await open(first)
    let editor = page.locator('[data-editor-host="embedded"]')
    const viewerId = `${pluginId}/text`
    await editor.getByRole('combobox', { name: 'Open with', exact: true }).selectOption(viewerId)
    const firstGuest = await guest(app, '/dist/index.html')
    await expect(firstGuest.locator('#content')).toHaveText('P4 file A')
    expect(await rawCall(firstGuest, 'documents.readText', { path: 'b.txt' })).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
    expect(await rawCall(firstGuest, 'workspace.readText', { path: 'b.txt' })).toMatchObject({ ok: false, error: { code: 'PATH_NOT_GRANTED' } })
    const secondMount = await page.evaluate(async payload => {
      const result = await (window as any).electron.plugins.request(payload)
      if (!result.ok) throw new Error(result.code)
      return result.data
    }, { type: 'mount', id: pluginId, view: 'details', projectId: workspace.id, scopePath: f.project, document: { viewer: 'text', path: 'b.txt' } })
    const secondGuest = await guest(app, '/dist/index.html', firstGuest.url())
    await expect(secondGuest.locator('#content')).toHaveText('P4 file B')
    expect((await rawCall(firstGuest, 'documents.readText', {})).result.text).toBe('P4 file A')
    await page.evaluate(mount => (window as any).electron.plugins.request({ type: 'close', instanceId: mount.instanceId, binding: mount.binding }), secondMount)
    await editor.getByRole('button', { name: 'Use by default for this file type', exact: true }).click()
    await settings(page)
    await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter(child => (child as any).webContents?.getURL().startsWith('janusx-plugin:')).length)).toBe(0)
    await page.keyboard.press('Escape')
    await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter(child => (child as any).webContents?.getURL().startsWith('janusx-plugin:')).length)).toBe(1)
    await close(app); app = undefined

    booted = await boot(f.root); app = booted.app; page = booted.page
    await page.getByText('P4 Files', { exact: true }).filter({ visible: true }).first().click()
    await open(second); editor = page.locator('[data-editor-host="embedded"]')
    const restored = await guest(app, '/dist/index.html')
    await expect(restored.locator('#content')).toHaveText('P4 file B')
    await expect(editor.getByRole('combobox', { name: 'Open with', exact: true })).toHaveValue(viewerId)
    await writeFile(second, 'P4 external update')
    expect((await rawCall(restored, 'documents.readText', {})).result.text).toBe('P4 external update')
    await expect(editor.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)
    await editor.getByRole('combobox', { name: 'Open with', exact: true }).focus(); await page.keyboard.press('Control+s')
    expect(await readFile(second, 'utf8')).toBe('P4 external update')
    await editor.getByRole('button', { name: 'Restore built-in default', exact: true }).click()
    await expect(editor.locator('.monaco-editor')).toBeVisible()
    await editor.locator('.monaco-editor').click(); await page.keyboard.press('Control+End'); await page.keyboard.type(' unsaved P4 draft')
    await expect(editor.getByRole('combobox', { name: 'Open with', exact: true })).toBeDisabled()
    await expect(editor.locator('.view-lines')).toContainText('unsaved P4 draft')
    await open(first)
    await expect(editor.getByRole('combobox', { name: 'Open with', exact: true })).toHaveValue('builtin')
    await editor.getByRole('combobox', { name: 'Open with', exact: true }).selectOption(viewerId)
    const doomed = await guest(app, '/dist/index.html')
    await expect(doomed.locator('#content')).toHaveText('P4 file A')
    await app.evaluate(({ webContents }) => { webContents.getAllWebContents().find(contents => contents.getURL().startsWith('janusx-plugin:'))!.forcefullyCrashRenderer() })
    await expect(editor.locator('[data-document-viewer="builtin"]')).toBeVisible()
    await expect(editor.getByRole('status')).toContainText('Plugin viewer unavailable')
    await expect(editor.locator('.monaco-editor')).toBeVisible()
    await editor.getByRole('combobox', { name: 'Open with', exact: true }).selectOption('builtin')
    await editor.getByRole('combobox', { name: 'Open with', exact: true }).selectOption(viewerId)
    await expect((await guest(app, '/dist/index.html')).locator('#content')).toHaveText('P4 file A')
    await page.evaluate(id => (window as any).electron.plugins.request({ type: 'disable', id }), pluginId)
    await expect(editor.locator('[data-document-viewer="builtin"]')).toBeVisible()
    await open(second)
    await expect(editor.locator('.view-lines')).toContainText('unsaved P4 draft')
    expect(await readFile(second, 'utf8')).toBe('P4 external update')
  } finally { await close(app); await rm(f.root, { recursive: true, force: true }) }
})

test('P3 four surfaces preserve panes, return focus, shield approvals and revoke on project switch/disable', async () => {
  const f = await fixture(); let app: ElectronApplication | undefined
  try {
    const booted = await boot(f.root); app = booted.app; const page = booted.page
    const workspace = await page.evaluate(path => (window as any).electron.workspace.create({ name: 'P3 Project A', path }), f.project)
    const projectB = join(f.root, 'project-b'); await mkdir(projectB); await writeFile(join(projectB, 'README.md'), 'P3 project B')
    const workspaceB = await page.evaluate(path => (window as any).electron.workspace.create({ name: 'P3 Project B', path }), projectB)
    await page.reload(); await page.getByText('P3 Project A', { exact: true }).filter({ visible: true }).first().click()
    await enableFixture(app, page, f.source, workspace.id)
    await page.evaluate(async ({ id, projects }) => (window as any).electron.plugins.request({ type: 'enable', id, projects }), { id: pluginId, projects: [workspace.id, workspaceB.id] })
    await openDetails(page)
    const details = await guest(app, '/dist/index.html')
    await expect(details.locator('#content')).toHaveText('P2 readable project file')
    const attached = () => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children
      .filter(child => (child as any).webContents?.getURL().startsWith('janusx-plugin:')).map(child => ({ url: (child as any).webContents.getURL(), bounds: child.getBounds() })))
    await expect.poll(async () => (await attached()).some(child => child.url === details.url())).toBe(true)
    await details.getByRole('button', { name: 'Summary', exact: true }).click()
    const summary = await guest(app, '/dist/summary.html')
    await details.getByRole('button', { name: 'Remember this project', exact: true }).click()
    await expect(summary.locator('#content')).toHaveText('project-a')
    const workbenchButton = page.locator(`button[data-id="extension:${pluginId}/desk"]`)
    await workbenchButton.click()
    const desk = await guest(app, '/dist/index.html', details.url())
    const workbench = page.locator('[data-plugin-workbench]')
    await expect(workbench).toBeVisible()
    await expect(desk.locator('#content')).toHaveText('project-a')
    await expect.poll(async () => (await attached()).map(child => child.url)).toEqual([desk.url()])
    expect(details.isClosed()).toBe(false); expect(summary.isClosed()).toBe(false)
    await expect(page.getByRole('button', { name: 'Return to previous view', exact: true })).toBeFocused()
    await settings(page)
    await expect(workbench).toBeHidden()
    await expect.poll(async () => (await attached()).length).toBe(0)
    await expect(page.locator('[data-plugin-settings]')).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
    await expect(workbench).toBeVisible()
    await page.getByRole('button', { name: 'Return to previous view', exact: true }).click()
    await expect(workbench).toHaveCount(0)
    await expect.poll(() => desk.isClosed()).toBe(true)
    await expect(workbenchButton).toBeFocused()
    await expect.poll(async () => (await attached()).some(child => child.url === details.url())).toBe(true)
    await rawCall(details, 'island.update', { id: 'reference', status: { title: 'P3 ready', state: 'running', progress: 42, badge: '42%', preview: { text: '<script>safe text</script>', rows: [{ label: 'Project', value: 'A' }] } } })
    await page.locator('[data-plugin-island-count]').click()
    await expect(page.locator('.janus-island-shell')).toHaveAttribute('data-stage', 'peek')
    await expect(page.locator('.janus-capsule-title')).toContainText('P3 ready')
    await expect.poll(async () => (await attached()).length).toBe(0)
    await page.locator('.janus-island').dblclick({ position: { x: 8, y: 8 } })
    await expect(page.locator('.janus-island-shell')).toHaveAttribute('data-stage', 'expanded')
    await page.locator(`button[data-view="extension:${pluginId}/island"]`).click()
    const island = await guest(app, '/dist/summary.html', summary.url())
    await expect(island.locator('#content')).toHaveText('project-a')
    await expect.poll(async () => (await attached()).map(child => child.url)).toEqual([island.url()])
    const nativeBounds = (await attached())[0].bounds
    expect(nativeBounds.width).toBeGreaterThan(100); expect(nativeBounds.height).toBeGreaterThan(50)
    await page.locator('.janus-notify-badge').click()
    await expect.poll(async () => (await attached()).length).toBe(0)
    await expect(page.locator('[data-plugin-island-preview]').filter({ visible: true })).toContainText('<script>safe text</script>')
    expect(await page.locator('[data-plugin-island-preview] script').count()).toBe(0)
    await page.locator('.janus-notify-tray').getByRole('button', { name: 'Open reference desk', exact: true }).click()
    await expect(workbench).toBeVisible()
    await expect(page.locator('.janus-island-shell')).toHaveAttribute('data-stage', 'collapsed')
    const reopenedDesk = await guest(app, '/dist/index.html', details.url())
    const oldDeskUrl = reopenedDesk.url()
    await page.evaluate(id => (window as any).electron.plugins.request({ type: 'reload', id }), pluginId)
    await expect.poll(() => reopenedDesk.isClosed()).toBe(true)
    const reloadedDesk = await guest(app, '/dist/index.html', details.url())
    expect(reloadedDesk.url()).not.toBe(oldDeskUrl)
    await workbench.getByRole('combobox', { name: 'Switch project', exact: true }).selectOption(workspaceB.id)
    await expect(workbench).toHaveCount(0)
    await expect.poll(() => reloadedDesk.isClosed()).toBe(true)
    await workbenchButton.click()
    await expect(workbench).toBeVisible()
    const projectBDesk = await guest(app, '/dist/index.html')
    await expect(projectBDesk.locator('#status')).toHaveText('project-b')
    await page.evaluate(id => (window as any).electron.plugins.request({ type: 'disable', id }), pluginId)
    await expect(workbench).toHaveCount(0)
    await expect(page.locator('[data-plugin-island-count]')).toHaveCount(0)
    await expect.poll(async () => app!.context().pages().filter(page => page.url().startsWith('janusx-plugin:')).length).toBe(0)
    await expect(workbenchButton).toHaveCount(0)
  } finally { await close(app); await rm(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) }
})

test('bounded renderer OOM and subsequent post-handshake crashes trip the circuit without ending the host', async () => {
  const f = await fixture(); let app: ElectronApplication | undefined
  try {
    const booted = await boot(f.root); app = booted.app; const page = booted.page
    const workspace = await page.evaluate(path => (window as any).electron.workspace.create({ name: 'Crash project', path }), f.project)
    await page.reload(); await page.getByText('Crash project', { exact: true }).filter({ visible: true }).first().click()
    await enableFixture(app, page, f.source, workspace.id)
    const healthySource = join(f.root, 'healthy-plugin'); await cp(f.source, healthySource, { recursive: true })
    const healthyManifest = JSON.parse(await readFile(join(healthySource, 'manifest.json'), 'utf8'))
    healthyManifest.id = 'example.healthy-reference'
    healthyManifest.contributes.commands.find((command: any) => command.id === 'open-details').title = 'Open healthy reference'
    await writeFile(join(healthySource, 'manifest.json'), JSON.stringify(healthyManifest))
    await enableFixture(app, page, healthySource, workspace.id, healthyManifest.id)
    await page.locator('button[data-id="tool-menu"]').click()
    await page.getByRole('menuitem', { name: 'Open healthy reference', exact: true }).click()
    const healthy = await guest(app, '/dist/index.html')
    await expect(healthy.locator('#content')).toHaveText('P2 readable project file')
    // The host renderer already exists. Bound only subsequently spawned renderers' V8 heaps.
    await app.evaluate(({ app }) => app.commandLine.appendSwitch('js-flags', '--max-old-space-size=64'))
    await openDetails(page)
    for (let failure = 1; failure <= 3; failure++) {
      const details = await guest(app, '/dist/index.html', healthy.url())
      await expect(details.locator('#content')).toHaveText('P2 readable project file')
      const running = await page.evaluate(async () => (await (window as any).electron.plugins.request({ type: 'list' })).data.plugins[0])
      expect(running).toMatchObject({ failures: failure - 1, runtime: { pages: 1, connected: 1, ready: 1 } })
      if (failure === 1) {
        const limit = await details.evaluate(() => (performance as any).memory.jsHeapSizeLimit)
        // Chromium reports the old-space cap plus young-generation headroom.
        expect(limit).toBeLessThan(192 * 1024 * 1024)
      }
      await app.evaluate(({ webContents }, { oom, url }) => {
        const contents = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
        contents.once('render-process-gone', (_event, details) => { (globalThis as any).pluginGoneReason = details.reason })
        if (oom) void contents.executeJavaScript('globalThis.boundedHeapProbe = []; for (let i = 0; i < 256; i++) globalThis.boundedHeapProbe.push(new Array(65536).fill(i));').catch(() => {})
        else contents.forcefullyCrashRenderer()
      }, { oom: failure === 1, url: details.url() })
      await expect.poll(() => page.evaluate(async () => (await (window as any).electron.plugins.request({ type: 'list' })).data.plugins[0].failures)).toBe(failure)
      expect(await app.evaluate(() => (globalThis as any).pluginGoneReason)).toBe(failure === 1 ? 'oom' : 'crashed')
      expect(await rawCall(healthy, 'workspace.readText', { path: 'README.md' })).toMatchObject({ ok: true, result: { text: 'P2 readable project file' } })
      if (failure < 3) await page.getByRole('button', { name: 'Retry plugin view', exact: true }).click()
    }
    await settings(page)
    const card = page.locator(`[data-plugin-id="${pluginId}"]`)
    await expect(card).toContainText('Disabled')
    await expect(card.locator('[data-plugin-runtime]')).toHaveText('Pages: 0 · Bridge connected: 0 · Ready: 0')
    expect((await page.evaluate(() => (window as any).electron.plugins.request({ type: 'list' }))).data.plugins[0]).toMatchObject({ enabled: false, failures: 3 })
    await expect.poll(() => app!.context().pages().filter(page => page.url().startsWith('janusx-plugin:')).length).toBe(1)
    expect(healthy.isClosed()).toBe(false)
  } finally { await close(app); await rm(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) }
})

test('real git worktree switching revokes old pages, isolates KV and rejects linked files through the bridge', async () => {
  const f = await fixture(); let app: ElectronApplication | undefined
  try {
    const git = (args: string[]) => execFileSync('git', args, { cwd: f.project, stdio: 'pipe' })
    git(['init', '-b', 'main']); git(['add', 'README.md'])
    git(['-c', 'user.name=Desktop Test', '-c', 'user.email=desktop-test@example.invalid', 'commit', '-m', 'fixture'])
    const tree = join(f.root, 'worktree'); git(['worktree', 'add', '-b', 'p2-worktree', tree, 'HEAD'])
    await writeFile(join(tree, 'README.md'), 'P2 worktree file')
    const manifest = JSON.parse(await readFile(join(f.source, 'manifest.json'), 'utf8'))
    manifest.permissions.find((permission: any) => permission.name === 'workspace.files.read').paths.push('linked/README.md', 'hard.md')
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(manifest))
    const outside = join(f.root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'README.md'), 'private outside bytes')
    await symlink(outside, join(tree, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    await link(join(outside, 'README.md'), join(tree, 'hard.md'))
    const booted = await boot(f.root); app = booted.app; const page = booted.page
    const workspace = await page.evaluate(path => (window as any).electron.workspace.create({ name: 'Worktree project', path }), f.project)
    await page.reload(); await page.getByText('Worktree project', { exact: true }).filter({ visible: true }).first().click()
    await enableFixture(app, page, f.source, workspace.id); await openDetails(page)
    const original = await guest(app, '/dist/index.html')
    await expect(original.locator('#content')).toHaveText('P2 readable project file')
    const originalContext = (await rawCall(original, 'workspace.getContext', {})).result
    expect(await rawCall(original, 'storage.set', { key: 'scope-check', value: 'main' })).toMatchObject({ ok: true })
    const trees = await page.evaluate(async ({ id, path }) => (window as any).electron.worktree.list(id, path), { id: workspace.id, path: f.project })
    const branchPath = trees.find((item: any) => !item.isMain).path
    const mainPath = trees.find((item: any) => item.isMain).path
    await page.getByRole('button', { name: /^Expand Worktree project terminal list/ }).click()
    await page.getByRole('button', { name: branchPath, exact: true }).click()
    await expect.poll(() => original.isClosed()).toBe(true)
    await openDetails(page)
    const changed = await guest(app, '/dist/index.html')
    await expect(changed.locator('#content')).toHaveText('P2 worktree file')
    const changedContext = (await rawCall(changed, 'workspace.getContext', {})).result
    expect(changedContext.project.projectId).toBe(originalContext.project.projectId)
    expect(changedContext.project.rootId).not.toBe(originalContext.project.rootId)
    expect(changedContext.revision).toBeGreaterThan(originalContext.revision)
    expect(await rawCall(changed, 'storage.get', { key: 'scope-check' })).toMatchObject({ ok: true, result: { found: false } })
    for (const path of ['linked/README.md', 'hard.md']) expect(await rawCall(changed, 'workspace.readText', { path })).toMatchObject({ ok: false, error: { code: 'INVALID_PACKAGE_PATH' } })
    await rawCall(changed, 'storage.set', { key: 'scope-check', value: 'worktree' })
    await page.getByRole('button', { name: mainPath, exact: true }).click()
    await expect.poll(() => changed.isClosed()).toBe(true)
    await openDetails(page)
    const returned = await guest(app, '/dist/index.html')
    await expect(returned.locator('#content')).toHaveText('P2 readable project file')
    expect((await rawCall(returned, 'workspace.getContext', {})).result.project.rootId).toBe(originalContext.project.rootId)
    expect(await rawCall(returned, 'storage.get', { key: 'scope-check' })).toMatchObject({ ok: true, result: { value: 'main' } })
    const logs = (await page.evaluate(() => (window as any).electron.plugins.request({ type: 'list' }))).data.logs
    expect(logs.filter((log: any) => log.code === 'INVALID_PACKAGE_PATH').length).toBeGreaterThanOrEqual(2)
    await settings(page)
    await expect(page.locator(`[data-plugin-id="${pluginId}"] [data-plugin-runtime]`)).toHaveText('Pages: 1 · Bridge connected: 1 · Ready: 1')
  } finally { await close(app); await rm(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) }
})

test('a disconnected plugin bridge revokes its page and a normal host disable does not count as a crash', async () => {
  const f = await fixture(); let app: ElectronApplication | undefined
  try {
    const booted = await boot(f.root); app = booted.app; const page = booted.page
    const workspace = await page.evaluate(path => (window as any).electron.workspace.create({ name: 'Bridge project', path }), f.project)
    await page.reload(); await page.getByText('Bridge project', { exact: true }).filter({ visible: true }).first().click()
    await enableFixture(app, page, f.source, workspace.id); await openDetails(page)
    const details = await guest(app, '/dist/index.html')
    await expect(details.locator('#content')).toHaveText('P2 readable project file')
    await details.evaluate(() => (window as any).testPort.close())
    await expect.poll(() => details.isClosed()).toBe(true)
    const snapshot = () => page.evaluate(async () => (await (window as any).electron.plugins.request({ type: 'list' })).data.plugins[0])
    expect(await snapshot()).toMatchObject({ failures: 1, state: 'error', runtime: { pages: 0, connected: 0, ready: 0 } })
    await page.getByRole('button', { name: 'Retry plugin view', exact: true }).click()
    await expect((await guest(app, '/dist/index.html')).locator('#content')).toHaveText('P2 readable project file')
    await page.evaluate(id => (window as any).electron.plugins.request({ type: 'disable', id }), pluginId)
    await expect.poll(snapshot).toMatchObject({ enabled: false, failures: 1, runtime: { pages: 0, connected: 0, ready: 0 } })
  } finally { await close(app); await rm(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) }
})

test('external packed SDK plugin completes import, grant, both views, scoped storage, network denial and disable/uninstall', async () => {
  const f = await fixture(); let app: ElectronApplication | undefined
  let hits = 0
  const udp = createSocket('udp4'); let udpHits = 0
  udp.on('message', () => { udpHits++ })
  await new Promise<void>(resolve => udp.bind(0, '127.0.0.1', resolve))
  let turnHits = 0
  const turn = createTcpServer(socket => { turnHits++; socket.destroy() })
  await new Promise<void>(resolve => turn.listen(0, '127.0.0.1', resolve))
  const server = createServer((_req, res) => { hits++; res.end('must not reach') })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }; const remote = `http://127.0.0.1:${address.port}/blocked`
  try {
    const booted = await boot(f.root); app = booted.app; const page = booted.page
    const workspace = await page.evaluate(path => (window as any).electron.workspace.create({ name: 'P2 Project A', path }), f.project)
    const projectB = join(f.root, 'project-b'); await mkdir(projectB); await writeFile(join(projectB, 'README.md'), 'Project B file')
    await page.evaluate(path => (window as any).electron.workspace.create({ name: 'P2 Project B', path }), projectB)
    await page.reload(); await page.getByText('P2 Project A', { exact: true }).filter({ visible: true }).first().click()
    await settings(page); await importDirectory(app, page, f.source)
    const card = page.locator(`[data-plugin-id="${pluginId}"]`)
    await expect(card).toContainText('Disabled')
    const blocked = await page.evaluate(id => (window as any).electron.plugins.request({ type: 'enable', id, projects: [] }), pluginId)
    expect(blocked).toMatchObject({ ok: false, code: 'DEVELOPMENT_MODE_REQUIRED' })
    await page.getByRole('tab', { name: 'Developer', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Enable local development mode', exact: true }).click()
    await expect(page.getByRole('checkbox', { name: 'Enable local development mode', exact: true })).toBeChecked()
    await page.getByRole('tab', { name: /^Installed/ }).click()
    await card.getByRole('button', { name: 'Review permissions' }).click()
    await page.getByRole('button', { name: 'Grant and enable', exact: true }).click()
    await expect(card).toContainText('Enabled, no page open')
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
    await page.locator('button[data-id="tool-menu"]').click()
    await page.getByRole('menuitem', { name: 'Open project reference', exact: true }).click()
    const details = await guest(app, '/dist/index.html')
    await expect(details.locator('#content')).toHaveText('P2 readable project file')
    await expect(page.locator(`[data-plugin-view="${pluginId}/details"] [data-plugin-native]`)).toBeVisible()
    await page.locator(`[id="right-tool-rail-extension:${pluginId}/summary"]`).click()
    const summary = await guest(app, '/dist/summary.html')
    await expect(summary.locator('#status')).toHaveText('project-a')
    await details.getByRole('button', { name: 'Remember this project' }).click()
    await expect(summary.locator('#content')).toHaveText('project-a')
    const frame = details
    expect(await frame.evaluate(() => ({ node: typeof (window as any).require, preload: typeof (window as any).electron, origin: self.origin }))).toEqual({ node: 'undefined', preload: 'undefined', origin: 'null' })
    expect(await rawCall(frame, 'terminal.register', {})).toMatchObject({ ok: false, error: { code: 'UNKNOWN_METHOD' } })
    expect(await rawCall(frame, 'workspace.readText', { path: 'other.txt' })).toMatchObject({ ok: false, error: { code: 'PATH_NOT_GRANTED' } })
    expect(await rawCall(frame, 'views.open', { view: 'summary' })).toMatchObject({ ok: true, result: { instanceId: expect.any(String) } })
    expect(await rawCall(frame, 'ui.showToast', { message: 'Plugin notice', level: 'info' })).toMatchObject({ ok: true })
    await expect(page.getByText('Plugin notice', { exact: true })).toBeVisible()
    await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter(child => (child as any).webContents?.getURL().startsWith('janusx-plugin:')).length)).toBe(0)
    await expect(page.getByText('Plugin notice', { exact: true })).toBeHidden()
    await frame.evaluate(url => { void fetch(url).catch(() => {}); const image = new Image(); image.src = url; document.body.append(image); window.open(url) }, remote)
    await frame.evaluate(url => { location.href = url }, remote).catch(() => {})
    const rtc = await frame.evaluate(async ({ udpPort, tcpPort }) => {
      try {
        const connection = new RTCPeerConnection({ iceServers: [{ urls: `stun:127.0.0.1:${udpPort}` }, { urls: `turn:127.0.0.1:${tcpPort}?transport=tcp`, username: 'probe', credential: 'probe' }] })
        connection.createDataChannel('probe'); await connection.setLocalDescription(await connection.createOffer())
        await new Promise(resolve => setTimeout(resolve, 1200)); connection.close(); return 'available'
      } catch (cause) { return (cause as Error).name }
    }, { udpPort: (udp.address() as { port: number }).port, tcpPort: (turn.address() as { port: number }).port })
    console.log('[plugin RTC]', rtc)
    expect(udpHits).toBe(0)
    expect(turnHits).toBe(0)
    await page.waitForTimeout(300)
    expect(hits).toBe(0); expect(frame.url()).toMatch(/^janusx-plugin:/)
    const stillSame = await page.evaluate(() => (window as any).electron.plugins.request({ type: 'list' }))
    expect(stillSame.data.logs.some((log: any) => log.code === 'UNKNOWN_METHOD')).toBe(true)
    const forged = await app.evaluate(async ({ BrowserWindow }) => {
      const other = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false } })
      try { await other.loadURL('data:text/html,<p>Untrusted sender</p>'); return await other.webContents.executeJavaScript('require("electron").ipcRenderer.invoke("plugins:manage", {type:"list"})') }
      finally { other.destroy() }
    })
    expect(forged).toMatchObject({ ok: false, code: 'INVALID_SENDER' })
    await page.locator(`[data-plugin-view="${pluginId}/details"]`).getByRole('button', { name: 'Inspect plugin' }).click()
    await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.webContents.getURL().startsWith('devtools:')))).toBe(true)
    await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) if (window.webContents.getURL().startsWith('devtools:')) window.close() })
    const previousUrl = frame.url()
    const htmlPath = join(f.source, 'dist/index.html')
    await writeFile(htmlPath, (await readFile(htmlPath, 'utf8')).replace('</body>', '<p id="hot-reload">Hot reload verified</p></body>'))
    await expect.poll(() => app!.context().pages().some(candidate => candidate.url().startsWith('janusx-plugin:') && candidate.url().endsWith('/dist/index.html') && candidate.url() !== previousUrl)).toBe(true)
    await expect((await guest(app, '/dist/index.html')).locator('#hot-reload')).toHaveText('Hot reload verified')
    await page.getByText('P2 Project B', { exact: true }).filter({ visible: true }).first().click()
    await page.locator('button[data-id="tool-menu"]').click(); await page.getByRole('menuitem', { name: 'Open project reference', exact: true }).click()
    await expect((await guest(app, '/dist/index.html')).locator('#content')).toHaveText('Project B file')
    await expect((await guest(app, '/dist/summary.html')).locator('#status')).toHaveText('project-b')
    await expect((await guest(app, '/dist/summary.html')).locator('#content')).toBeEmpty()
    await page.getByText('P2 Project A', { exact: true }).filter({ visible: true }).first().click()
    await expect((await guest(app, '/dist/index.html')).locator('#content')).toHaveText('project-a')
    await expect((await guest(app, '/dist/summary.html')).locator('#content')).toHaveText('project-a')
    expect(workspace.id).toBeTruthy()
    await settings(page)
    await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter(child => (child as any).webContents?.getURL().startsWith('janusx-plugin:')).length)).toBe(0)
    const beforeManualReload = (await guest(app, '/dist/index.html')).url()
    await openManagement(card); await card.getByText('Advanced actions and diagnostics', { exact: true }).click()
    await card.getByRole('button', { name: 'Reload', exact: true }).click()
    await expect.poll(() => app!.context().pages().some(candidate => candidate.url().startsWith('janusx-plugin:') && candidate.url().endsWith('/dist/index.html') && candidate.url() !== beforeManualReload)).toBe(true)
    await openManagement(card); await card.getByText('Entries and shortcuts', { exact: true }).click()
    const shortcut = card.getByRole('textbox', { name: 'Shortcut Open project reference', exact: true })
    await shortcut.fill('Ctrl+Alt+Shift+Q')
    await shortcut.locator('../..').getByRole('button', { name: 'Apply or disable', exact: true }).click()
    const hiddenEntry = card.getByRole('switch', { name: /Open project reference.*Show in toolbox/ })
    await shortcut.focus()
    await hiddenEntry.uncheck()
    await hiddenEntry.check()
    await expect(shortcut).toHaveValue('Ctrl+Alt+Shift+Q')
    await card.getByRole('button', { name: 'Disable', exact: true }).click()
    await expect(page.locator('[data-plugin-native]')).toHaveCount(0)
    await expect.poll(() => app!.context().pages().filter(page => page.url().startsWith('janusx-plugin:')).length).toBe(0)
    await card.getByRole('button', { name: 'Uninstall', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect(card).toHaveCount(0)
    expect(await readFile(join(f.source, 'manifest.json'), 'utf8')).toContain(pluginId)
  } finally { await close(app); udp.close(); await new Promise<void>(resolve => turn.close(() => resolve())); await new Promise<void>(resolve => server.close(() => resolve())); await rm(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) }
})

test('a runaway plugin renderer can be removed while the host remains responsive', async () => {
  const f = await fixture(); let app: ElectronApplication | undefined
  try {
    const booted = await boot(f.root); app = booted.app; const page = booted.page
    const workspace = await page.evaluate(path => (window as any).electron.workspace.create({ name: 'Runaway project', path }), f.project)
    await page.reload(); await page.getByText('Runaway project', { exact: true }).filter({ visible: true }).first().click()
    await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, f.source)
    await page.evaluate(async ({ pluginId, workspace }) => {
      const api = (window as any).electron.plugins
      for (const input of [{ type: 'import', kind: 'linked' }, { type: 'development', enabled: true }, { type: 'enable', id: pluginId, projects: [workspace.id] }]) {
        const result = await api.request(input); if (!result.ok) throw new Error(result.code)
      }
    }, { pluginId, workspace })
    await page.locator('button[data-id="tool-menu"]').click(); await page.getByRole('menuitem', { name: 'Open project reference', exact: true }).click()
    await expect((await guest(app, '/dist/index.html')).locator('#content')).toHaveText('P2 readable project file')
    const process = await app.evaluate(({ BrowserWindow, webContents }) => {
      const host = BrowserWindow.getAllWindows()[0].webContents
      const contents = webContents.getAllWebContents().find(contents => contents.getURL().startsWith('janusx-plugin:'))!
      const info = { plugin: contents.getOSProcessId(), host: host.getOSProcessId() }
      void contents.executeJavaScript('while(true){}').catch(() => {})
      return info
    })
    expect(process.plugin).not.toBe(process.host)
    await settings(page)
    await page.locator(`[data-plugin-id="${pluginId}"]`).getByRole('button', { name: 'Disable', exact: true }).click()
    await expect(page.locator('[data-plugin-native]')).toHaveCount(0)
    await expect.poll(() => app!.evaluate(({ app }, pid) => app.getAppMetrics().some(metric => metric.pid === pid), process.plugin), { timeout: 15_000 }).toBe(false)
  } finally { await close(app); await rm(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) }
})

test('copied development sources retain trust and restart only enabled entries, not pages', async () => {
  const f = await fixture(); let app: ElectronApplication | undefined
  try {
    let booted = await boot(f.root); app = booted.app
    await settings(booted.page); await importDirectory(app, booted.page, f.source, true)
    await expect(booted.page.locator(`[data-plugin-id="${pluginId}"]`)).toBeVisible()
    const invoke = (page: Page, input: unknown) => page.evaluate(input => (window as any).electron.plugins.request(input), input)
    await invoke(booted.page, { type: 'development', enabled: true })
    await invoke(booted.page, { type: 'enable', id: pluginId, projects: [] })
    const card = booted.page.locator(`[data-plugin-id="${pluginId}"]`)
    await openManagement(card); await card.getByText('Entries and shortcuts', { exact: true }).click()
    const shortcut = card.getByRole('textbox', { name: 'Shortcut Open project reference', exact: true })
    await shortcut.fill('Ctrl+Alt+Shift+Q')
    await shortcut.locator('../..').getByRole('button', { name: 'Apply or disable', exact: true }).click()
    await shortcut.focus()
    await card.getByRole('switch', { name: /Open project reference.*Show in toolbox/ }).uncheck()
    await close(app); app = undefined
    await rm(f.source, { recursive: true, force: true })
    booted = await boot(f.root); app = booted.app
    const restored = await invoke(booted.page, { type: 'list' })
    expect(restored.data.plugins[0]).toMatchObject({ enabled: true, state: 'ready', source: { kind: 'copied' } })
    await expect(booted.page.locator('[data-plugin-native]')).toHaveCount(0)
    await settings(booted.page)
    const restoredCard = booted.page.locator(`[data-plugin-id="${pluginId}"]`)
    await restoredCard.getByText('Entries and shortcuts', { exact: true }).click()
    await expect(restoredCard.getByRole('textbox', { name: 'Shortcut Open project reference', exact: true })).toHaveValue('Ctrl+Alt+Shift+Q')
    await expect(restoredCard.getByRole('switch', { name: /Open project reference.*Show in toolbox/ })).not.toBeChecked()
    await invoke(booted.page, { type: 'development', enabled: false })
    await invoke(booted.page, { type: 'development', enabled: true })
    expect((await invoke(booted.page, { type: 'list' })).data.plugins[0].enabled).toBe(false)
  } finally { await close(app); await rm(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) }
})

test('six invalid package classes surface stable error codes without partial installations', async () => {
  const f = await fixture(); let app: ElectronApplication | undefined
  try {
    const booted = await boot(f.root); app = booted.app; const page = booted.page
    await settings(page)
    const original = JSON.parse(await readFile(join(f.source, 'manifest.json'), 'utf8'))
    const cases: Array<[string, (manifest: any) => void]> = [
      ['MANIFEST_INVALID', manifest => { manifest.bad = true }], ['INCOMPATIBLE_API', manifest => { manifest.engines.pluginApi = '^9.0.0' }],
      ['UNSUPPORTED_PERMISSION', manifest => { manifest.permissions.push({ name: 'terminal.register' }) }], ['INVALID_PACKAGE_PATH', manifest => { manifest.contributes.views[0].entry = '../index.html' }],
      ['PACKAGE_LIMIT_EXCEEDED', manifest => { manifest.description = 'x'.repeat(70_000) }], ['ENTRY_NOT_FOUND', manifest => { manifest.contributes.views[0].entry = 'dist/missing.html' }],
    ]
    for (const [code, change] of cases) {
      const manifest = structuredClone(original); change(manifest)
      await writeFile(join(f.source, 'manifest.json'), JSON.stringify(manifest)); await importDirectory(app, page, f.source)
      await expect(page.locator('[data-plugin-settings]').getByRole('alert')).toHaveText(code)
    }
    expect((await page.evaluate(() => (window as any).electron.plugins.request({ type: 'list' }))).data.plugins).toEqual([])
  } finally { await close(app); await rm(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) }
})

test('three native page handshake timeouts automatically disable the faulty plugin', async () => {
  const f = await fixture(); let app: ElectronApplication | undefined
  try {
    await writeFile(join(f.source, 'dist/index.html'), '<!doctype html><p>No ready handshake</p>')
    const booted = await boot(f.root); app = booted.app; const page = booted.page
    const workspace = await page.evaluate(path => (window as any).electron.workspace.create({ name: 'Timeout project', path }), f.project)
    await page.reload(); await page.getByText('Timeout project', { exact: true }).filter({ visible: true }).first().click()
    await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, f.source)
    await page.evaluate(async ({ pluginId, workspace }) => {
      for (const input of [{ type: 'import', kind: 'linked' }, { type: 'development', enabled: true }, { type: 'enable', id: pluginId, projects: [workspace.id] }]) {
        const result = await (window as any).electron.plugins.request(input); if (!result.ok) throw new Error(result.code)
      }
    }, { pluginId, workspace })
    await page.locator('button[data-id="tool-menu"]').click(); await page.getByRole('menuitem', { name: 'Open project reference', exact: true }).click()
    for (let failure = 1; failure <= 3; failure++) {
      await expect.poll(() => page.evaluate(async () => (await (window as any).electron.plugins.request({ type: 'list' })).data.plugins[0].failures), { timeout: 15_000 }).toBe(failure)
      if (failure < 3) await page.getByRole('button', { name: 'Retry plugin view', exact: true }).click()
    }
    expect((await page.evaluate(() => (window as any).electron.plugins.request({ type: 'list' }))).data.plugins[0]).toMatchObject({ enabled: false, state: 'disabled', failures: 3, error: 'VIEW_LOAD_FAILED' })
    await expect.poll(() => app!.context().pages().filter(page => page.url().startsWith('janusx-plugin:')).length).toBe(0)
  } finally { await close(app); await rm(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) }
})
