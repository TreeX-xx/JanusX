import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { WindowAPI } from '../../src/shared/ipc/system'
import { SYSTEM_CHANNELS } from '../../src/shared/ipc/system'
import { createDesktopTestEnv, seedIntroducedLearning } from './desktop-test-env'

type DesktopWindow = Window & { electron: { window: WindowAPI } }

test('main-window close/reopen preserves IPC with a hidden auxiliary window', async () => {
  const root = await mkdtemp(join(tmpdir(), 'janusx-window-reopen-'))
  let application: ElectronApplication | undefined
  try {
    const profile = join(root, 'profile')
    await mkdir(join(profile, 'janusx'), { recursive: true })
    await writeFile(join(profile, 'janusx/config.json'), JSON.stringify({ language: 'en', theme: 'dark', themeMigratedToSlate: true }))
    application = await electron.launch({
      args: [resolve(process.env.JANUSX_WINDOW_TEST_ENTRY ?? 'out/main/index.js'), `--user-data-dir=${profile}`],
      env: { ...createDesktopTestEnv(root), APPDATA: join(root, 'appdata'), LOCALAPPDATA: join(root, 'local'),
        JANUSX_OFFICECLI_BINARY: resolve(process.env.JANUSX_OFFICECLI_BINARY ?? (process.platform === 'darwin'
          ? `resources/officecli/darwin-${process.arch}/officecli` : 'resources/officecli/officecli.exe')) },
    })
    await seedIntroducedLearning(application.context())
    let page = await application.firstWindow()
    await page.reload()
    await expect(page.locator('.window-controls').first()).toBeVisible()
    if (process.platform === 'darwin') {
      await test.step('macOS edge and corner gestures resize the native main window', async () => {
        const getBounds = () => application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds())
        await application!.evaluate(({ BrowserWindow, screen }) => {
          const { x, y } = screen.getPrimaryDisplay().workArea
          BrowserWindow.getAllWindows()[0].setBounds({ x: x + 40, y: y + 40, width: 1180, height: 720 })
        })
        const first = await getBounds()
        const drag = async (edge: 'e' | 'se', dx: number, dy: number) => {
          const box = await page.locator(`[data-main-window-resize="${edge}"]`).boundingBox()
          expect(box).not.toBeNull()
          const x = box!.x + box!.width - 5
          const y = edge === 'se' ? box!.y + box!.height - 5 : box!.y + box!.height / 2
          await page.mouse.move(x, y)
          await page.mouse.down()
          await page.mouse.move(x + dx, y + dy)
          await page.mouse.up()
        }
        await drag('se', -80, -60)
        await expect.poll(getBounds).toEqual({ ...first, width: first.width - 80, height: first.height - 60 })
        await drag('e', -200, 0)
        await expect.poll(getBounds).toEqual({ ...first, width: 1000, height: first.height - 60 })
        await drag('e', 60, 0)
        await expect.poll(getBounds).toEqual({ ...first, width: 1060, height: first.height - 60 })
      })
    } else {
      await expect(page.locator('[data-main-window-resize]')).toHaveCount(0)
    }
    const channels = [SYSTEM_CHANNELS.editorHostReady, SYSTEM_CHANNELS.editorReceived, SYSTEM_CHANNELS.editorReady, SYSTEM_CHANNELS.editorViewed]
    const baseline = await application.evaluate(async ({ app, BrowserWindow, ipcMain }, channels) => {
      const main = BrowserWindow.getAllWindows()[0]
      const auxiliary = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
      // Keep the Windows/Linux host alive to exercise the macOS-style lifetime.
      // The native platform, renderer and IPC implementation remain unchanged.
      const state = { quit: app.quit, mainId: main.id, auxiliaryId: auxiliary.id }
      ;(globalThis as any).__windowReopenFixture = state
      if (process.platform !== 'darwin') app.quit = () => {}
      await auxiliary.loadURL('about:blank')
      return { mainId: main.id, listeners: channels.map(channel => ipcMain.listenerCount(channel)) }
    }, channels)
    expect(baseline.listeners).toEqual([1, 1, 1, 1])
    await expect.poll(() => application!.windows().length).toBe(2)

    const ready = async (page: Page) => {
      await page.waitForLoadState('domcontentloaded')
      await expect(page.locator('.window-controls').first()).toBeVisible()
      await expect(page.locator('.window-controls').first()).toHaveAttribute('data-maximized', 'false')
    }
    for (let cycle = 0; cycle < 3; cycle++) {
      const nextWindow = application.waitForEvent('window')
      await application.evaluate(async ({ app, BrowserWindow }) => {
        const state = (globalThis as any).__windowReopenFixture
        const main = BrowserWindow.fromId(state.mainId)!
        await new Promise<void>(resolve => { main.once('closed', resolve); main.close() })
        app.emit('activate')
      })
      page = await nextWindow
      await ready(page)
      const state = await application.evaluate(({ BrowserWindow, ipcMain }, channels) => {
        const state = (globalThis as any).__windowReopenFixture
        const main = BrowserWindow.getAllWindows().find(window => window.id !== state.auxiliaryId)!
        state.mainId = main.id
        return { mainId: main.id, windows: BrowserWindow.getAllWindows().length, auxiliaryVisible: BrowserWindow.fromId(state.auxiliaryId)!.isVisible(),
          listeners: channels.map(channel => ipcMain.listenerCount(channel)) }
      }, channels)
      expect(state.mainId).not.toBe(baseline.mainId)
      expect(state.windows).toBe(2); expect(state.auxiliaryVisible).toBe(false)
      expect(state.listeners).toEqual(baseline.listeners)
      expect(await page.evaluate(() => (window as DesktopWindow).electron.window.getMaximized())).toBe(false)
      await page.evaluate(() => (window as DesktopWindow).electron.window.maximize())
      await expect(page.locator('.window-controls').first()).toHaveAttribute('data-maximized', 'true')
      await expect(page.locator('[data-main-window-resize="e"]')).toBeHidden()
      await page.evaluate(() => (window as DesktopWindow).electron.window.maximize())
      await expect(page.locator('.window-controls').first()).toHaveAttribute('data-maximized', 'false')
    }

    await page.evaluate(() => (window as DesktopWindow).electron.window.minimize())
    await expect.poll(() => application!.evaluate(({ BrowserWindow }) => BrowserWindow.fromId((globalThis as any).__windowReopenFixture.mainId)!.isMinimized())).toBe(true)
    await application.evaluate(({ app }) => { app.emit('activate') })
    await expect.poll(() => application!.evaluate(({ BrowserWindow }) => BrowserWindow.fromId((globalThis as any).__windowReopenFixture.mainId)!.isMinimized())).toBe(false)
    await application.evaluate(({ app, BrowserWindow }) => {
      BrowserWindow.fromId((globalThis as any).__windowReopenFixture.mainId)!.hide()
      app.emit('second-instance', {}, [])
    })
    await expect.poll(() => application!.evaluate(({ BrowserWindow }) => BrowserWindow.fromId((globalThis as any).__windowReopenFixture.mainId)!.isVisible())).toBe(true)
    await page.screenshot({ path: test.info().outputPath('reopened-main-window.png') })
  } finally {
    await application?.evaluate(({ app, BrowserWindow }) => {
      const state = (globalThis as any).__windowReopenFixture
      if (!state) return
      app.quit = state.quit
      BrowserWindow.fromId(state.auxiliaryId)?.destroy()
      delete (globalThis as any).__windowReopenFixture
    }).catch(() => {})
    await application?.close()
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
