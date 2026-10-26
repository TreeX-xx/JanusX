import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js'
import { parseNote } from '@janus-agent/harness-core'
import { prepareBlueprintDevelopment } from '../../scripts/plugins/blueprint-dev.mjs'
import { createDesktopTestEnv, seedIntroducedLearning } from './desktop-test-env'

test('local signed build installs disabled, opens in the full desktop and serves MCP after the desktop exits', async ({}, testInfo) => {
  test.setTimeout(180_000)
  const cache = resolve('.cache')
  await mkdir(cache, { recursive: true })
  const directory = await mkdtemp(join(cache, 'blueprint-test-'))
  let app: ElectronApplication | undefined, client: Client | undefined, transport: StdioClientTransport | undefined
  try {
    execFileSync(process.execPath, ['plugins/blueprint/build.mjs'], { windowsHide: true, stdio: 'pipe' })
    const build = await prepareBlueprintDevelopment(process.cwd(), directory)
    const compileEnv = { ...process.env, JANUSX_BLUEPRINT_LOCAL_DIRECTORY: directory }
    execFileSync(process.execPath, ['node_modules/electron-vite/bin/electron-vite.js', 'build', '--config',
      'scripts/plugins/blueprint-dev.config.ts', '--outDir', build.appDirectory], { env: compileEnv, windowsHide: true, stdio: 'pipe', maxBuffer: 32 * 1024 * 1024 })
    const project = join(directory, 'project')
    await mkdir(join(project, '.agents/notes'), { recursive: true })
    await cp(resolve('.agents/notes'), join(project, '.agents/notes'), { recursive: true })
    await cp(resolve('.agents/harness.json'), join(project, '.agents/harness.json'))
    // Two real Git worktrees share Note identities but contain different saved text.
    execFileSync('git', ['init', '--initial-branch=blueprint-main'], { cwd: project, windowsHide: true, stdio: 'pipe' })
    execFileSync('git', ['add', '.agents'], { cwd: project, windowsHide: true, stdio: 'pipe' })
    execFileSync('git', ['-c', 'user.name=Blueprint fixture', '-c', 'user.email=blueprint@fixture.invalid', 'commit', '-m', 'Fixture Notes'], { cwd: project, windowsHide: true, stdio: 'pipe' })
    const feature = join(directory, 'feature-checkout')
    execFileSync('git', ['worktree', 'add', '-b', 'blueprint-feature', feature], { cwd: project, windowsHide: true, stdio: 'pipe' })
    const featureNote = join(feature, '.agents/notes/module.md')
    await writeFile(featureNote, (await readFile(featureNote, 'utf8')).replace(/^# JanusX\s*$/m, '# Worktree fixture') + '\nWorktree-specific saved content.\n')
    const { ELECTRON_RUN_AS_NODE: _node, NODE_OPTIONS: _options, ...env } = createDesktopTestEnv(directory)
    app = await electron.launch({ args: [resolve('scripts/plugins/blueprint-dev-entry.mjs'), `--user-data-dir=${build.profile}`],
      env: { ...env, JANUSX_BLUEPRINT_LOCAL_DIRECTORY: directory } })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.evaluate(() => (window as any).electron.system.setLanguage('en'))
    await seedIntroducedLearning(page)
    const listed = await page.evaluate(() => (window as any).electron.plugins.request({ type: 'list' }))
    expect(listed).toMatchObject({ ok: true, data: { developmentMode: false, plugins: [{ enabled: false, source: { kind: 'official' }, manifest: { id: build.id, version: build.version } }] } })
    expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(build.profile)
    expect(await app.evaluate(() => process.env.JANUSX_KNOWLEDGE_ROOT)).toBe(join(build.profile, 'knowledge'))
    await page.evaluate(path => (window as any).electron.workspace.create({ name: 'Local project', path }), project)
    await page.reload()
    await page.getByText('Local project', { exact: true }).filter({ visible: true }).first().click()
    await page.getByTitle('Settings', { exact: true }).click()
    await page.locator('[data-tab="plugins"]').click()
    const card = page.locator('[data-plugin-id="official.blueprint"]')
    await expect(card).toContainText(build.version)
    // Exercise the real main-window import picker and verifier with no catalog or sidecar JSON.
    await app.evaluate(({ dialog }) => {
      ;(globalThis as any).pluginImportPath = null
      ;(dialog as any).showOpenDialog = async (_window: unknown, options: { filters: { extensions: string[] }[] }) => {
        if (options.filters[0].extensions[0] !== 'jxp') throw new Error('Expected the package picker')
        const path = (globalThis as any).pluginImportPath
        return { canceled: !path, filePaths: path ? [path] : [] }
      }
    })
    const importButton = page.getByRole('button', { name: 'Import plugin package', exact: true })
    await importButton.click()
    await expect(importButton).toBeEnabled()
    await expect(card).toContainText(build.version)
    const invalidPackage = join(directory, 'invalid.jxp')
    await writeFile(invalidPackage, 'invalid package')
    await app.evaluate((_electron, path) => { (globalThis as any).pluginImportPath = path }, invalidPackage)
    await importButton.click()
    await expect(page.getByRole('alert')).toContainText('incomplete, corrupt or unsupported')
    await expect(card).toContainText(build.version)
    expect(await page.evaluate(() => (window as any).electron.plugins.request({ type: 'importPackage', path: 'C:/untrusted.jxp' }))).toMatchObject({ ok: false, code: 'INVALID_REQUEST' })
    await page.evaluate(() => (window as any).electron.plugins.request({ type: 'uninstall', id: 'official.blueprint' }))
    await expect(card).toHaveCount(0)
    const standalonePackage = join(directory, 'blueprint.jxp')
    await cp(build.archive, standalonePackage)
    await app.evaluate((_electron, path) => { (globalThis as any).pluginImportPath = path }, standalonePackage)
    await importButton.click()
    await expect(page.getByRole('status')).toContainText('Plugin package installed')
    await expect(card).toContainText(build.version)
    expect(await page.evaluate(() => (window as any).electron.plugins.request({ type: 'list' }))).toMatchObject({ ok: true, data: { developmentMode: false, plugins: [{ enabled: false }] } })
    await card.getByRole('button', { name: 'Review permissions and scope', exact: true }).click()
    const review = page.getByRole('region', { name: 'Review permissions and scope' })
    await review.getByLabel('Local project', { exact: true }).check()
    await review.getByRole('button', { name: 'Grant and enable', exact: true }).click()
    await page.locator('[data-tab="extension:official.blueprint/settings"]').click()
    const guest = async () => {
      await expect.poll(() => app!.context().pages().some(candidate => candidate.url().startsWith('janusx-plugin:'))).toBe(true)
      return app!.context().pages().find(candidate => candidate.url().startsWith('janusx-plugin:'))!
    }
    let plugin = await guest()
    await expect(plugin.getByRole('heading', { name: 'Blueprint settings', exact: true })).toBeVisible()
    await plugin.getByLabel('Commits per check', { exact: true }).fill('9')
    await expect(plugin.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
    await expect.poll(() => plugin.isClosed()).toBe(true)
    await page.locator('button[data-id="tool-menu"]').click()
    await expect(page.getByRole('menuitem', { name: '蓝图设置', exact: true })).toHaveCount(0)
    await page.getByRole('menuitem', { name: '打开蓝图', exact: true }).click()
    plugin = await guest()
    await expect(plugin.getByRole('heading', { name: 'JanusX', level: 2, exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(plugin.locator('.markdown-preview')).toContainText('桌面工作区', { timeout: 30_000 })
    await plugin.getByRole('button', { name: 'Switch worktree', exact: true }).click()
    await plugin.getByRole('option', { name: /blueprint-feature/ }).click()
    await expect.poll(() => plugin.isClosed()).toBe(true)
    plugin = await guest()
    await expect(plugin.getByRole('heading', { name: 'Worktree fixture', level: 2, exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(plugin.locator('.markdown-preview')).toContainText('Worktree-specific saved content.')
    await expect(page.locator('[data-plugin-workbench="extension:official.blueprint/blueprint"]')).toBeVisible()
    await plugin.getByRole('button', { name: 'Switch worktree', exact: true }).click()
    await plugin.getByRole('option', { name: /blueprint-main/ }).click()
    await expect.poll(() => plugin.isClosed()).toBe(true)
    plugin = await guest()
    await expect(plugin.getByRole('heading', { name: 'JanusX', level: 2, exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(plugin.locator('.markdown-preview')).not.toContainText('Worktree-specific saved content.')
    await expect(plugin.locator('.bp-note-review__content')).toBeHidden()
    await plugin.getByRole('tab', { name: 'Related Notes', exact: true }).click()
    const relation = plugin.locator('.bp-note-relation-card').filter({ has: plugin.locator('.bp-reader-card__toggle:enabled') }).first()
    await relation.getByRole('button', { name: /^Preview Note/ }).click()
    await expect(relation.locator('.markdown-preview')).toBeVisible()
    await expect(relation.locator('.markdown-preview')).not.toBeEmpty()
    await plugin.getByRole('tab', { name: 'Body', exact: true }).click()
    await expect(plugin.locator('.bp-note-relations')).toHaveCount(0)
    await expect(page.locator('[data-plugin-workbench="extension:official.blueprint/blueprint"]')).toBeVisible()
    await expect(page.locator('.plugin-workbench-header')).toHaveCount(0)
    await expect(plugin.locator('.blueprint-workbench-topbar')).toHaveCount(1)
    await expect(plugin.locator('.note-list')).toHaveCount(0)
    await expect(plugin.locator('.discussion')).toHaveCount(0)
    await expect(plugin.locator('.bp-node-card').first()).toBeVisible()
    await expect(plugin.locator('.react-flow__controls')).toHaveCount(0)
    await expect(plugin.locator('.bp-canvas-legend')).toContainText('Pending suggestions')
    expect(await plugin.locator('.blueprint-workbench-toolbar').evaluate(element => {
      const rect = element.getBoundingClientRect()
      return [...element.children].filter(child => child.matches('button, input, select')).every(child => {
        const control = child.getBoundingClientRect()
        return control.top >= rect.top && control.bottom <= rect.bottom
      })
    })).toBe(true)
    // The original full-screen frame covers ordinary titlebar controls.
    const workbench = page.locator('[data-plugin-workbench="extension:official.blueprint/blueprint"]')
    expect(await workbench.evaluate(element => {
      const rect = element.getBoundingClientRect()
      const island = document.querySelector('.janus-island')!.getBoundingClientRect()
      const hit = document.elementFromPoint(island.x + island.width / 2, island.y + island.height / 2)
      return rect.top === 0 && Boolean(hit?.closest('[data-plugin-workbench]'))
    })).toBe(true)
    const diagnostics = plugin.getByRole('button', { name: /^Source diagnostics/ })
    await expect(diagnostics).toBeVisible()
    await expect(plugin.locator('.workspace-page > .diagnostics')).toHaveCount(0)
    const canvasTop = (await plugin.locator('.blueprint-workbench-body').boundingBox())!.y
    await diagnostics.click()
    await expect(plugin.getByRole('region', { name: /^Source diagnostics/ })).toBeVisible()
    expect((await plugin.locator('.blueprint-workbench-body').boundingBox())!.y).toBe(canvasTop)
    await plugin.keyboard.press('Escape')
    await plugin.getByRole('button', { name: 'JANUS // COPILOT', exact: true }).click()
    await expect(plugin.locator('.discussion')).toBeVisible()
    await expect(plugin.locator('.bp-maintenance-composer')).toBeVisible()
    await expect(plugin.locator('.bp-maintenance-greeting')).toBeVisible()
    await expect.poll(() => plugin.locator('.blueprint-workbench-body').evaluate(element =>
      element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running' && animation.effect?.getTiming().iterations !== Infinity).length)).toBe(0)
    expect(await plugin.locator('.blueprint-workbench-body').evaluate(element => {
      const body = element.getBoundingClientRect()
      return [...element.querySelectorAll('.blueprint-workbench-card--janus, .bp-node-detail')].every(card => {
        const rect = card.getBoundingClientRect()
        return rect.left >= body.left - 1 && rect.right <= body.right + 1 && rect.bottom <= body.bottom + 1
      })
    })).toBe(true)
    expect(await plugin.locator('.bp-maintenance-composer').evaluate(element => {
      const rect = element.getBoundingClientRect(), panel = element.closest('.discussion')!.getBoundingClientRect()
      return rect.bottom <= panel.bottom && rect.top > panel.top
    })).toBe(true)
    // Opening the original right card must refit the center after its transition.
    await expect.poll(() => plugin.locator('.react-flow').evaluate(element => {
      const canvas = element.getBoundingClientRect()
      const cards = [...element.querySelectorAll('.bp-node-card')]
      return cards.length > 0 && cards.every(card => {
        const rect = card.getBoundingClientRect()
        return rect.left >= canvas.left - 1 && rect.right <= canvas.right + 1 && rect.top >= canvas.top - 1 && rect.bottom <= canvas.bottom + 1
      })
    })).toBe(true)
    await plugin.screenshot({ path: testInfo.outputPath('blueprint-side-cards.png') })
    await plugin.getByRole('button', { name: 'JANUS // COPILOT', exact: true }).click()
    await plugin.getByRole('button', { name: 'More', exact: true }).click()
    await plugin.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(page.locator('[data-tab="extension:official.blueprint/settings"][aria-current="page"]')).toBeVisible()
    await expect.poll(() => app!.context().pages().some(candidate => candidate.url().startsWith('janusx-plugin:') && candidate !== plugin)).toBe(true)
    const settingsGuest = app.context().pages().find(candidate => candidate.url().startsWith('janusx-plugin:') && candidate !== plugin)!
    await expect(settingsGuest.getByRole('heading', { name: 'Blueprint settings', exact: true })).toBeVisible()
    await expect(settingsGuest.getByLabel('Commits per check', { exact: true })).toHaveValue('9')
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
    await expect(plugin.getByRole('heading', { name: 'JanusX', level: 2, exact: true })).toBeVisible()
    await expect(plugin.locator('.bp-node-card').first()).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('local-blueprint-desktop.png') })
    await plugin.screenshot({ path: testInfo.outputPath('local-blueprint-page.png') })
    await plugin.getByRole('button', { name: 'More', exact: true }).click()
    await plugin.getByRole('button', { name: 'Refresh', exact: true }).click()
    await plugin.getByRole('textbox', { name: 'Search Notes', exact: true }).fill('JanusX')
    await plugin.locator('.bp-browser-results').getByRole('button', { name: 'JanusX Module', exact: true }).click()
    await expect(plugin.getByRole('heading', { name: 'JanusX', level: 2, exact: true })).toBeVisible()
    await expect(plugin.locator('.markdown-preview')).toContainText('桌面工作区')
    await expect(plugin.locator('main > .error')).toHaveCount(0)
    await plugin.getByRole('textbox', { name: 'Search Notes', exact: true }).fill('')
    await page.screenshot({ path: testInfo.outputPath('repository-blueprint-desktop.png') })
    await plugin.screenshot({ path: testInfo.outputPath('repository-blueprint-page.png') })
    await plugin.keyboard.press('Escape')
    await expect.poll(() => plugin.isClosed()).toBe(true)
    await expect(workbench).toHaveCount(0)
    await app.close(); app = undefined
    // Use the generated launcher's compiled local trust and actual enabled registry.
    client = new Client({ name: 'local-development-check', version: '1' })
    transport = new StdioClientTransport({ command: process.execPath, args: [join(build.appDirectory, 'main/plugin-mcp.js'), build.id, 'note'], cwd: project,
      env: { ...getDefaultEnvironment(), JANUSX_PLUGIN_HOME: join(build.profile, 'janusx/plugins') }, stderr: 'pipe' })
    let stderr = ''
    transport.stderr?.on('data', chunk => { stderr += String(chunk) })
    try {
      await client.connect(transport)
      expect((await client.listTools()).tools.map(tool => tool.name)).toContain('note.read')
      const source = JSON.parse(await readFile(resolve('.agents/harness.json'), 'utf8'))
      const rootNote = parseNote(await readFile(join(project, '.agents/notes/module.md'), 'utf8'))
      const result = await client.callTool({ name: 'note.read', arguments: { workspacePath: project, uri: `note://${source.repoId}/${rootNote.meta.id}` } })
      expect(result.isError, stderr).not.toBe(true)
      expect(JSON.stringify(result.content)).toContain('JanusX')
    } catch (cause) { console.log('Local MCP stderr:', stderr); throw cause }
    const registry = JSON.parse(await readFile(join(build.profile, 'janusx/plugins/registry.json'), 'utf8'))
    expect(registry.plugins[0].enabled).toBe(true)
  } catch (cause) {
    if (app) {
      console.log('Blueprint host diagnostics:', await (await app.firstWindow()).evaluate(async () => {
        const response = await (window as any).electron.plugins.request({ type: 'list' })
        return response.data?.logs?.slice(-35)
      }).catch(() => 'unavailable'))
      for (const guest of app.context().pages().filter(candidate => candidate.url().startsWith('janusx-plugin:'))) {
        console.log('Blueprint page diagnostics:', await guest.locator('body').innerText().catch(() => 'closed'))
        console.log('Blueprint canvas geometry:', await guest.evaluate(() => {
          const node = document.querySelector('.bp-node-card')
          const elements = [...document.querySelectorAll('.graph, .react-flow, .react-flow__viewport, .react-flow__node')].slice(0, 8)
          for (let parent = node; parent; parent = parent.parentElement) elements.push(parent)
          return elements.map(element => {
            const style = getComputedStyle(element), rect = element.getBoundingClientRect()
            return { className: element.className, width: rect.width, height: rect.height, x: rect.x, y: rect.y,
              display: style.display, visibility: style.visibility, opacity: style.opacity, transform: style.transform }
          })
        }).catch(() => 'closed'))
        await guest.screenshot({ path: testInfo.outputPath('blueprint-failure.png') }).catch(() => {})
      }
    }
    throw cause
  } finally {
    await client?.close().catch(() => {})
    await transport?.close().catch(() => {})
    if (app) await app.close().catch(() => app!.process().kill())
    if (!resolve(directory).startsWith(cache + sep)) throw new Error('Local test cleanup escaped the cache directory.')
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})
