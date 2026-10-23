import { _electron as electron, expect, test, type ElectronApplication, type Page, type Frame } from '@playwright/test'
import { mkdtemp, mkdir, cp, readFile, writeFile, rm, link, symlink } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:http'
import { createSocket } from 'node:dgram'
import { createServer as createTcpServer } from 'node:net'
import { createDesktopTestEnv, seedIntroducedLearning } from './desktop-test-env'

const pluginId = 'example.project-reference'
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
  await page.getByTitle('Settings', { exact: true }).click()
  await page.locator('[data-tab="plugins"]').click()
  await expect(page.locator('[data-plugin-settings]')).toBeVisible()
}
async function importDirectory(app: ElectronApplication, page: Page, source: string, copied = false) {
  await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, source)
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
  return app.context().pages().find(matches)!
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
    await expect(editor.locator('.view-lines')).toContainText('plugin draft B')
    await editor.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(editor.getByRole('alert')).toContainText('Your draft is kept')
    expect(await readFile(second, 'utf8')).toBe('external B')
    await expect(editor.locator('.view-lines')).toContainText('plugin draft B')
    await open(first); await open(second)
    await expect(editor.locator('.view-lines')).toContainText('plugin draft B')
    await editor.getByRole('button', { name: 'Close b.txt', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Save and close', exact: true }).click()
    await expect(dialog.getByRole('alert')).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(editor.locator('.view-lines')).toContainText('plugin draft B')
    await editor.getByRole('button', { name: 'Return to floating window', exact: true }).click()
    await expect.poll(() => app!.windows().some(window => window.url().includes('editorWindow=1'))).toBe(true)
    const floating = app.windows().find(window => window.url().includes('editorWindow=1'))!
    await expect(floating.locator('.view-lines')).toContainText('plugin draft B')
    await floating.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(floating.getByRole('alert').filter({ hasText: 'Your draft is kept' })).toBeVisible()
    expect(await readFile(second, 'utf8')).toBe('external B')
    await floating.getByRole('button', { name: 'Embed into main workspace', exact: true }).click()
    await expect(editor.locator('.view-lines')).toContainText('plugin draft B')
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
    await page.locator('.janus-island').dblclick()
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
    await page.getByRole('checkbox', { name: 'Enable local development mode', exact: true }).click()
    await expect(page.getByRole('checkbox', { name: 'Enable local development mode', exact: true })).toBeChecked()
    await card.getByRole('button', { name: 'Review permissions and scope' }).click()
    await page.getByRole('region', { name: 'Review permissions and scope' }).getByRole('checkbox', { name: 'P2 Project A' }).check()
    await page.getByRole('region', { name: 'Review permissions and scope' }).getByRole('checkbox', { name: 'P2 Project B' }).check()
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
    await card.getByRole('button', { name: 'Reload', exact: true }).click()
    await expect.poll(() => app!.context().pages().some(candidate => candidate.url().startsWith('janusx-plugin:') && candidate.url().endsWith('/dist/index.html') && candidate.url() !== beforeManualReload)).toBe(true)
    await card.getByText('Entries and shortcuts', { exact: true }).click()
    const shortcut = card.getByRole('textbox', { name: 'Shortcut Open project reference', exact: true })
    await shortcut.fill('Ctrl+Alt+Shift+Q')
    await shortcut.locator('..').getByRole('button', { name: 'Apply or disable', exact: true }).click()
    const hiddenEntry = card.getByRole('checkbox', { name: 'Hide entry · toolbox · open-details', exact: true })
    await card.getByRole('spinbutton', { name: 'Order open-details toolbox', exact: true }).fill('-10')
    await shortcut.focus()
    await hiddenEntry.check()
    await hiddenEntry.uncheck()
    await expect(card.getByRole('spinbutton', { name: 'Order open-details toolbox', exact: true })).toHaveValue('-10')
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
    await card.getByText('Entries and shortcuts', { exact: true }).click()
    const shortcut = card.getByRole('textbox', { name: 'Shortcut Open project reference', exact: true })
    await shortcut.fill('Ctrl+Alt+Shift+Q')
    await shortcut.locator('..').getByRole('button', { name: 'Apply or disable', exact: true }).click()
    await card.getByRole('spinbutton', { name: 'Order open-details toolbox', exact: true }).fill('-10')
    await shortcut.focus()
    await card.getByRole('checkbox', { name: 'Hide entry · toolbox · open-details', exact: true }).check()
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
    await expect(restoredCard.getByRole('spinbutton', { name: 'Order open-details toolbox', exact: true })).toHaveValue('-10')
    await expect(restoredCard.getByRole('checkbox', { name: 'Hide entry · toolbox · open-details', exact: true })).toBeChecked()
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
