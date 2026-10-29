import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, readFile, writeFile, copyFile } from 'node:fs/promises'
import { build as bundle } from 'esbuild'
import { join, resolve, delimiter } from 'node:path'
import { createDockerCliFixture } from './docker-cli-fixture'
import { prepareDockerDevelopment } from '../../scripts/plugins/docker-dev.mjs'
import { createDesktopTestEnv, seedIntroducedLearning } from './desktop-test-env'

test('signed Docker plugin: global manager, CLI fixture actions, live logs and PTY survive page closure', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'Windows CLI fixture; other platforms need their own real-engine verification.')
  test.setTimeout(240_000)
  await mkdir('.cache', { recursive: true }); const directory = await mkdtemp(join(resolve('.cache'), 'docker-desktop-'))
  let app: ElectronApplication | undefined
  try {
    const cli = await createDockerCliFixture(directory)
    execFileSync(process.execPath, ['plugins/docker/build.mjs'], { windowsHide: true, stdio: 'pipe' })
    const build = await prepareDockerDevelopment(process.cwd(), directory)
    execFileSync(process.execPath, ['node_modules/electron-vite/bin/electron-vite.js', 'build', '--config', 'scripts/plugins/docker-dev.config.ts', '--outDir', build.appDirectory],
      { env: { ...process.env, JANUSX_DOCKER_LOCAL_DIRECTORY: directory }, windowsHide: true, stdio: 'pipe', maxBuffer: 32 * 1024 * 1024 })
    const { ELECTRON_RUN_AS_NODE: _node, NODE_OPTIONS: _options, ...env } = createDesktopTestEnv(directory)
    app = await electron.launch({ executablePath: process.env.JANUS_ELECTRON_PATH,
      args: [resolve('scripts/plugins/docker-dev-entry.mjs'), `--user-data-dir=${build.profile}`], env: { ...env, PATH: cli.directory + delimiter + process.env.PATH, JANUSX_DOCKER_LOCAL_DIRECTORY: directory } })
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded')
    await page.evaluate(() => (window as any).electron.system.setLanguage('en')); await seedIntroducedLearning(page); await page.reload()
    const request = (input: object) => page.evaluate(input => (window as any).electron.plugins.request(input), input)
    const enabled = await request({ type: 'enable', id: build.id })
    expect(enabled, JSON.stringify(enabled)).toMatchObject({ ok: true })
    const open = async (): Promise<Page> => {
      await page.locator('button[data-id="tool-menu"]').click(); await page.getByRole('menuitem', { name: 'Docker', exact: true }).click()
      await expect.poll(() => app!.context().pages().some(item => item.url().startsWith('janusx-plugin:'))).toBe(true)
      return app!.context().pages().find(item => item.url().startsWith('janusx-plugin:'))!
    }
    const close = async () => {
      const tab = page.locator('[data-tab-id*="official.docker"]'); await tab.locator('[data-tab-close]').hover(); await page.mouse.down()
      try { await expect(tab).toHaveCount(0) } finally { await page.mouse.up() }
    }
    let plugin = await open()
    await expect(plugin.getByRole('button', { name: /atlas-web/ })).toBeVisible()
    expect(await page.evaluate(() => (window as any).electron.workspace.list())).toEqual([])
    await plugin.getByRole('button', { name: /atlas-web/ }).click()
    await expect(plugin.getByRole('heading', { name: 'atlas-web' })).toBeVisible()
    await plugin.getByRole('button', { name: '127.0.0.1:18080' }).click()
    await expect(page.locator('[data-tab-id^="browser:"]')).toHaveCount(1)
    // Return to the same global Docker page after the browser opens.
    await page.locator('[data-tab-id*="official.docker"]').click()
    await plugin.getByRole('button', { name: 'Logs', exact: true }).click()
    await expect(plugin.locator('pre.logs')).toContainText('fixture log')
    await plugin.getByRole('button', { name: 'Pause scroll' }).click()
    await plugin.getByRole('textbox', { name: 'Search logs' }).fill('fixture log 1')
    await expect(plugin.locator('pre.logs')).toContainText('fixture log 1')
    await plugin.getByRole('button', { name: 'Copy', exact: true }).click()
    await expect.poll(() => app!.evaluate(({ clipboard }) => clipboard.readText())).toContain('fixture log 1')
    await plugin.getByRole('button', { name: 'Terminal', exact: true }).click()
    await plugin.getByRole('button', { name: 'Open terminal', exact: true }).click()
    await expect(plugin.locator('.xterm-rows')).toContainText('fixture-shell:')
    const shellText = await plugin.locator('.xterm-rows').innerText(), pid = Number(/fixture-shell:(\d+)/.exec(shellText)![1])
    const input = plugin.locator('.xterm-helper-textarea')
    await input.pressSequentially('remember kept-shell'); await input.press('Enter')
    await plugin.getByRole('button', { name: /atlas-worker/ }).click()
    await plugin.getByRole('button', { name: /atlas-web/ }).click()
    await expect(plugin.getByRole('button', { name: 'Close shell' })).toBeVisible()
    await close(); expect(() => process.kill(pid, 0)).not.toThrow()
    plugin = await open()
    await expect(plugin.getByRole('button', { name: 'Close shell' })).toBeVisible()
    await plugin.locator('.xterm-helper-textarea').pressSequentially('recall'); await plugin.locator('.xterm-helper-textarea').press('Enter')
    await expect(plugin.locator('.xterm-rows')).toContainText('retained:kept-shell')
    await plugin.screenshot({ path: info.outputPath('docker-terminal.png') })
    await plugin.getByRole('button', { name: 'Overview', exact: true }).click()
    await plugin.screenshot({ path: info.outputPath('docker-dark-wide.png') })
    // A registered project context does not rebind this application-level manager.
    const projectRoot = join(directory, 'project'); await mkdir(projectRoot)
    const project = await page.evaluate(path => (window as any).electron.workspace.create({ name: 'Project', path }), projectRoot)
    expect(await request({ type: 'context', projectId: project.id, scopePath: projectRoot, locale: 'en', theme: { id: '', tokens: {} } })).toMatchObject({ ok: true })
    await page.reload()
    await page.getByRole('button', { name: 'Project, drag to reorder or' }).click()
    plugin = await open()
    await expect(plugin.getByRole('heading', { name: 'atlas-web' })).toBeVisible()
    const window = await app.browserWindow(page)
    await window.evaluate(window => window.setContentSize(1000, 760))
    await expect(plugin.getByRole('button', { name: 'Containers', exact: true })).toBeVisible()
    await plugin.screenshot({ path: info.outputPath('docker-dark-narrow.png') })
    await plugin.getByRole('button', { name: 'Containers', exact: true }).click()
    await expect(plugin.getByRole('textbox', { name: 'Search containers' })).toBeVisible()
    await plugin.getByRole('textbox', { name: 'Search containers' }).fill('atlas-web')
    await expect(plugin.getByRole('button', { name: /atlas-worker/ })).toHaveCount(0)
    await plugin.getByRole('textbox', { name: 'Search containers' }).fill('')
    await plugin.getByRole('button', { name: /atlas-web/ }).click()
    await page.evaluate(() => (window as any).electron.theme.update('planche'))
    await expect(plugin.locator('.docker-app')).toHaveCSS('background-color', 'rgb(239, 228, 197)')
    await plugin.screenshot({ path: info.outputPath('docker-planche-narrow.png') })
    await plugin.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect.poll(async () => (await readFile(cli.state, 'utf8')).split(/\r?\n/)[0]).toBe('exited')
    await expect.poll(() => { try { process.kill(pid, 0); return true } catch { return false } }).toBe(false)
    await plugin.getByRole('button', { name: 'Start', exact: true }).click()
    await expect.poll(async () => (await readFile(cli.state, 'utf8')).split(/\r?\n/)[0]).toBe('running')
    expect(await request({ type: 'disable', id: build.id })).toMatchObject({ ok: true })
    await expect.poll(() => plugin.isClosed()).toBe(true)
    expect((await readFile(cli.state, 'utf8')).split(/\r?\n/)[0]).toBe('running')
    await writeFile(cli.context, 'ssh://remote-fixture')
    expect(await request({ type: 'enable', id: build.id })).toMatchObject({ ok: true })
    plugin = await open()
    await expect(plugin.getByRole('alert')).toContainText('remote endpoint')
    await expect(plugin.getByRole('heading', { name: 'Connect to local Docker' })).toBeVisible()
  } finally {
    if (app) { const process = app.process(), timer = setTimeout(() => process.kill(), 5000); try { await app.close() } finally { clearTimeout(timer) } }
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('managed runtime setup: explicit installation, retry, page release and automatic WSL connection', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'Windows managed runtime UI and PTY fixture')
  test.setTimeout(240_000)
  await mkdir('.cache', { recursive: true }); const directory = await mkdtemp(join(resolve('.cache'), 'docker-managed-desktop-'))
  let app: ElectronApplication | undefined
  try {
    const cli = await createDockerCliFixture(directory)
    execFileSync(process.execPath, ['plugins/docker/build.mjs'], { windowsHide: true, stdio: 'pipe' })
    const wslPath = join(cli.directory, 'wsl.exe')
    await copyFile(join(cli.directory, 'docker.exe'), wslPath)
    await bundle({ entryPoints: ['tests/e2e/docker-managed-service-fixture.ts'], outfile: 'plugins/docker/dist/service.cjs', platform: 'node', target: 'node22', format: 'cjs', bundle: true, mainFields: ['module', 'main'], define: { FIXTURE_WSL_PATH: JSON.stringify(wslPath) } })
    const build = await prepareDockerDevelopment(process.cwd(), directory)
    execFileSync(process.execPath, ['node_modules/electron-vite/bin/electron-vite.js', 'build', '--config', 'scripts/plugins/docker-dev.config.ts', '--outDir', build.appDirectory],
      { env: { ...process.env, JANUSX_DOCKER_LOCAL_DIRECTORY: directory }, windowsHide: true, stdio: 'pipe', maxBuffer: 32 * 1024 * 1024 })
    const { ELECTRON_RUN_AS_NODE: _node, NODE_OPTIONS: _options, ...env } = createDesktopTestEnv(directory)
    app = await electron.launch({ executablePath: process.env.JANUS_ELECTRON_PATH, args: [resolve('scripts/plugins/docker-dev-entry.mjs'), `--user-data-dir=${build.profile}`], env: { ...env, JANUSX_DOCKER_LOCAL_DIRECTORY: directory } })
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded')
    await page.evaluate(() => (window as any).electron.system.setLanguage('en')); await seedIntroducedLearning(page); await page.reload()
    expect(await page.evaluate(id => (window as any).electron.plugins.request({ type: 'enable', id }), build.id)).toMatchObject({ ok: true })
    const open = async () => {
      await page.locator('button[data-id="tool-menu"]').click(); await page.getByRole('menuitem', { name: 'Docker', exact: true }).click()
      await expect.poll(() => app!.context().pages().some(item => item.url().startsWith('janusx-plugin:'))).toBe(true)
      return app!.context().pages().find(item => item.url().startsWith('janusx-plugin:'))!
    }
    let plugin = await open()
    await expect(plugin.getByRole('status')).toContainText('Runtime is not installed')
    await expect(plugin.getByRole('button', { name: 'Install and start' })).toBeVisible()
    await expect.poll(() => plugin.evaluate(() => window.innerWidth)).toBeGreaterThan(0)
    await plugin.screenshot({ path: info.outputPath('docker-runtime-setup.png') })
    await plugin.getByRole('button', { name: 'Install and start' }).click()
    await expect(plugin.locator('.runtime-setup').getByRole('alert')).toContainText('fixture-download-failed')
    await plugin.getByRole('button', { name: 'Install and start' }).click()
    await expect(plugin.getByRole('status')).toContainText('Installing Docker Engine')
    const tab = page.locator('[data-tab-id*="official.docker"]'); await tab.locator('[data-tab-close]').hover(); await page.mouse.down()
    try { await expect(tab).toHaveCount(0) } finally { await page.mouse.up() }
    plugin = await open()
    await expect(plugin.getByRole('status')).toContainText('Installing Docker Engine')
    await expect(plugin.getByRole('button', { name: /atlas-web/ })).toBeVisible()
    await plugin.getByRole('button', { name: /atlas-web/ }).click()
    await plugin.getByRole('button', { name: 'Logs', exact: true }).click()
    await expect(plugin.locator('pre.logs')).toContainText('fixture log')
    await plugin.getByRole('button', { name: 'Terminal', exact: true }).click()
    await plugin.getByRole('button', { name: 'Open terminal', exact: true }).click()
    await expect(plugin.locator('.xterm-rows')).toContainText('fixture-shell:')
    await plugin.locator('.xterm-helper-textarea').pressSequentially('recall'); await plugin.locator('.xterm-helper-textarea').press('Enter')
    await expect(plugin.locator('.xterm-rows')).toContainText('retained:')
    await plugin.screenshot({ path: info.outputPath('docker-runtime-connected.png') })
  } finally {
    if (app) { const process = app.process(), timer = setTimeout(() => process.kill(), 5000); try { await app.close() } finally { clearTimeout(timer) } }
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
