import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createDesktopTestEnv, seedIntroducedLearning } from './desktop-test-env'
async function boot(root: string, env: NodeJS.ProcessEnv = {}): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: [resolve(process.env.JANUS_E2E_MAIN_ENTRY ?? 'out/main/index.js'), `--user-data-dir=${join(root, 'profile')}`], env: { ...createDesktopTestEnv(root), ...env } })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.evaluate(() => (window as any).electron.system.setLanguage('en'))
  await seedIntroducedLearning(page)
  await page.reload()
  return { app, page }
}

for (const tool of ['Browser', 'Markdown']) {
  test(`${tool} global page requires a full hold to close and can reopen`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'janusx-tool-close-'))
    let app: ElectronApplication | undefined
    try {
      const booted = await boot(root)
      app = booted.app
      const page = booted.page
      const trigger = page.locator('button[data-id="tool-menu"]')
      const tab = page.locator(`[data-tab-id^="${tool.toLowerCase()}:"]`)
      const close = tab.locator('[data-tab-close]')
      const open = async () => {
        await trigger.click()
        await page.getByRole('menuitem', { name: tool === 'Browser' ? 'Open the workspace browser' : 'Open a Markdown document', exact: true }).click()
        await expect(tab).toHaveCount(1)
        if (tool === 'Browser') {
          // Wait for the surface state to replace the provisional tab label;
          // the built-in start page intentionally has no attached native view.
          const id = (await tab.getAttribute('data-tab-id'))!.slice('browser:'.length)
          await expect(page.locator('[data-browser-start-page]')).toBeVisible()
          await expect.poll(() => page.evaluate(async id => {
            const state = await (window as any).electron.browser.getState(id)
            return state?.tabs.length > 0 && state.tabs.every((item: { isLoading: boolean }) => !item.isLoading)
          }, id)).toBe(true)
        }
      }
      await open()
      const tabId = await tab.getAttribute('data-tab-id')
      await tab.hover()
      await close.click()
      await expect(tab).toHaveCount(1)
      // Leaving midway must cancel the timer, even after its original deadline.
      await close.hover()
      await page.mouse.down()
      await page.waitForTimeout(300)
      await page.mouse.move(0, 0)
      await page.mouse.up()
      await page.waitForTimeout(800)
      await expect(tab).toHaveCount(1)
      await close.focus()
      await close.press('Space')
      await expect(tab).toHaveCount(1)
      await close.press('Space', { delay: 1100 })
      await expect(tab).toHaveCount(0)
      if (tool === 'Browser') {
        expect(await page.evaluate((id) => (window as any).electron.browser.getState(id), tabId!.slice('browser:'.length))).toBeNull()
        await expect.poll(() => nativeCount(app!)).toBe(0)
      }
      await open()
      await tab.hover()
      await close.click({ delay: 1500 })
      await expect(tab).toHaveCount(0)
    } finally {
      if (app) await app.close()
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })
}

test('global browser focuses its popped-out singleton and reembeds without a project', async () => {
  const root = await mkdtemp(join(tmpdir(), 'janusx-global-browser-'))
  let app: ElectronApplication | undefined
  try {
    const booted = await boot(root)
    app = booted.app
    const page = booted.page
    await page.locator('button[data-id="tool-menu"]').click()
    await page.locator('[role="menuitem"][data-id="browser"]').click()
    const tab = page.locator('[data-tab-id^="browser:"]')
    await expect(tab).toHaveCount(1)
    const id = (await tab.getAttribute('data-tab-id'))!.slice('browser:'.length)
    const [standalone] = await Promise.all([
      app.waitForEvent('window'),
      page.getByRole('button', { name: 'Pop out to standalone window', exact: true }).click(),
    ])
    await expect(tab).toHaveCount(0)
    await expect(standalone.getByRole('button', { name: 'Embed into main window', exact: true })).toBeVisible()
    await standalone.evaluate(() => (window as any).electron.window.minimize())
    await page.bringToFront()
    await page.locator('button[data-id="tool-menu"]').click()
    const entry = page.locator('[role="menuitem"][data-id="browser"]')
    await expect(entry).toBeEnabled()
    await entry.click()
    await expect.poll(() => app!.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows()
      return { count: windows.length, minimized: windows.some((win) => win.isMinimized()) }
    })).toEqual({ count: 2, minimized: false })
    await standalone.getByRole('button', { name: 'Embed into main window', exact: true }).click()
    await expect(tab).toHaveAttribute('data-tab-id', `browser:${id}`)
    await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    await expect(page.locator('[data-pane-region="tools"]')).toBeVisible()
    expect(await page.evaluate((surfaceId) => (window as any).electron.browser.getState(surfaceId).then((state: any) => state.carrier), id)).toBe('pane')
  } finally {
    if (app) await app.close()
    await rm(root, { recursive: true, force: true })
  }
})
