import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createDesktopTestEnv } from './desktop-test-env'

type EditorWindowAPI = Window & {
  electron: {
    window: {
      openEditor(payload: { filePath: string; workspacePath: string; floating?: boolean }): Promise<{ success?: boolean }>
    }
  }
}

function editorWindows(application: ElectronApplication): Page[] {
  return application.windows().filter((page) => new URL(page.url()).searchParams.get('editorWindow') === '1')
}

test('file opens share one workspace editor window and switch existing tabs', async () => {
  const entry = resolve('out/main/index.js')
  let root = ''
  let application: ElectronApplication | undefined

  try {
    await access(entry)
    root = await mkdtemp(join(tmpdir(), 'janusx-editor-tabs-'))
    const userDataDir = join(root, 'user-data')
    const workspacePath = join(root, 'workspace')
    const firstPath = join(workspacePath, 'first.ts')
    const secondPath = join(workspacePath, 'second.ts')
    await Promise.all([mkdir(userDataDir, { recursive: true }), mkdir(workspacePath, { recursive: true })])
    await Promise.all([
      writeFile(firstPath, 'export const first = true\n'),
      writeFile(secondPath, 'export const second = true\n'),
    ])

    application = await electron.launch({
      args: [entry, `--user-data-dir=${userDataDir}`],
      env: createDesktopTestEnv(root),
    })
    const mainPage = await application.firstWindow({ timeout: 30_000 })
    await mainPage.waitForFunction(() => typeof (window as EditorWindowAPI).electron?.window?.openEditor === 'function')

    // Delay theme IPC so a default-colored loading fallback would be observable.
    await mainPage.evaluate(async () => {
      await (window as any).electron.theme.update('dark')
    })
    await application.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('theme:get')
      ipcMain.handle('theme:get', async () => {
        await new Promise(resolve => setTimeout(resolve, 400))
        return 'dark'
      })
    })
    await application.context().addInitScript(() => {
      if (new URLSearchParams(location.search).get('editorWindow') !== '1') return
      const frames: Array<{ theme: string | undefined; background: string }> = []
      ;(window as any).editorThemeFrames = frames
      const sample = () => {
        const root = document.getElementById('root')
        if (root?.firstElementChild) {
          frames.push({ theme: document.documentElement.dataset.theme, background: getComputedStyle(root.firstElementChild).backgroundColor })
        }
        if (frames.length < 20) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })

    await mainPage.evaluate(
      async ({ first, second, workspace }) => {
        await Promise.all([
          (window as EditorWindowAPI).electron.window.openEditor({ filePath: first, workspacePath: workspace, floating: true }),
          (window as EditorWindowAPI).electron.window.openEditor({ filePath: second, workspacePath: workspace, floating: true }),
        ])
      },
      { first: firstPath, second: secondPath, workspace: workspacePath },
    )

    await expect.poll(() => editorWindows(application!).length).toBe(1)
    const editorPage = editorWindows(application)[0]
    await expect(editorPage.locator('#root')).not.toBeEmpty()
    await expect(editorPage.locator('[data-editor-window-state="ready"]')).toBeVisible()
    await expect(editorPage.locator('[data-editor-window-state="error"]')).toHaveCount(0)
    await expect(editorPage.locator('.monaco-editor')).toBeVisible({ timeout: 30_000 })
    await expect(editorPage.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect.poll(() => editorPage.evaluate(() => (window as any).editorThemeFrames.length)).toBeGreaterThan(0)
    const frames = await editorPage.evaluate(() => (window as any).editorThemeFrames as Array<{ theme: string; background: string }>)
    expect(frames.every(frame => frame.theme === 'dark')).toBe(true)
    expect(frames.some(frame => frame.background === 'rgb(239, 228, 197)')).toBe(false)
    expect(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .find(window => new URL(window.webContents.getURL()).searchParams.get('editorWindow') === '1')?.getBackgroundColor())).toBe('#151517')
    await mainPage.evaluate(() => (window as any).electron.theme.update('planche'))
    await expect(editorPage.locator('html')).toHaveAttribute('data-theme', 'planche')
    await expect(editorPage.locator('html')).toHaveCSS('background-color', 'rgb(239, 228, 197)')
    await mainPage.evaluate(() => (window as any).electron.theme.update('dark'))
    await expect(editorPage.locator('html')).toHaveAttribute('data-theme', 'dark')
    await editorPage.screenshot({ path: test.info().outputPath('standalone-editor-ready.png') })
    const tabs = editorPage.locator('[data-editor-tab]')
    await expect(tabs).toHaveCount(2)
    await expect(tabs.filter({ hasText: 'second.ts' })).toHaveAttribute('data-active', 'true')
    const code = editorPage.locator('.monaco-editor .view-lines')
    await expect(code).toContainText('export const second = true')

    const dragRegion = editorPage.locator('[data-editor-drag-region]')
    const dragStrip = editorPage.locator('[data-editor-window-drag-strip]')
    await expect(dragRegion).toHaveCSS('-webkit-app-region', 'drag')
    await expect(dragStrip).toHaveCSS('-webkit-app-region', 'drag')
    await expect(tabs.first()).toHaveCSS('-webkit-app-region', 'no-drag')
    const dragStripBox = await dragStrip.boundingBox()
    expect(dragStripBox?.height).toBe(8)
    expect(dragStripBox?.width).toBeGreaterThan(1000)
    expect(await dragStrip.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) === element
    })).toBe(true)

    await editorPage.getByRole('button', { name: /^(More file actions|更多文件操作)$/ }).click()
    await editorPage.getByRole('dialog').getByRole('button', { name: /^(Pin window on top|锁定窗口置顶)$/ }).click()
    await expect.poll(() => application!.evaluate(({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows()
        .find(window => new URL(window.webContents.getURL()).searchParams.get('editorWindow') === '1')
        ?.isAlwaysOnTop()
    })).toBe(true)
    await editorPage.getByRole('button', { name: /^(More file actions|更多文件操作)$/ }).click()
    await editorPage.getByRole('dialog').getByRole('button', { name: /^(Unpin window|取消窗口置顶)$/ }).click()
    await expect.poll(() => application!.evaluate(({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows()
        .find(window => new URL(window.webContents.getURL()).searchParams.get('editorWindow') === '1')
        ?.isAlwaysOnTop()
    })).toBe(false)

    await mainPage.evaluate(
      ({ first, workspace }) => (window as EditorWindowAPI).electron.window.openEditor({ filePath: first, workspacePath: workspace, floating: true }),
      { first: firstPath, workspace: workspacePath },
    )

    await expect(editorWindows(application)).toHaveLength(1)
    await expect(tabs).toHaveCount(2)
    await expect(tabs.filter({ hasText: 'first.ts' })).toHaveAttribute('data-active', 'true')
    await expect(code).toContainText('export const first = true')
    await expect(code).not.toContainText('export const second = true')
  } finally {
    if (application) await application.close().catch(() => undefined)
    if (root) await rm(root, { recursive: true, force: true })
  }
})

test('native editor close uses the themed dialog and respects save failure and discard', async () => {
  const root = await mkdtemp(join(tmpdir(), 'janusx-editor-close-'))
  let application: ElectronApplication | undefined
  try {
    const workspacePath = join(root, 'workspace')
    const filePath = join(workspacePath, 'close.ts')
    await mkdir(workspacePath, { recursive: true })
    await writeFile(filePath, 'export const original = true\n')
    application = await electron.launch({ args: [resolve('out/main/index.js'), `--user-data-dir=${join(root, 'user-data')}`], env: createDesktopTestEnv(root) })
    const main = await application.firstWindow()
    await main.waitForFunction(() => !!(window as any).electron?.window?.openEditor)
    const open = async () => {
      await main.evaluate(payload => (window as any).electron.window.openEditor(payload), { filePath, workspacePath, floating: true })
      await expect.poll(() => editorWindows(application!).length).toBe(1)
      const page = editorWindows(application!)[0]
      await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 30_000 })
      return page
    }
    const nativeClose = () => application!.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find(window => new URL(window.webContents.getURL()).searchParams.get('editorWindow') === '1')?.close()
    })
    let page = await open()
    await page.locator('.monaco-editor').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('// saved edit')
    await nativeClose()
    let dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    expect(editorWindows(application)).toHaveLength(1)
    await nativeClose()
    await dialog.getByRole('button', { name: /^(保存并关闭|Save and close)$/ }).click()
    await expect.poll(() => editorWindows(application!).length).toBe(0)
    expect(await readFile(filePath, 'utf8')).toContain('// saved edit')

    page = await open()
    await page.locator('.monaco-editor').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('// must stay unsaved')
    await application.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('file:save')
      ipcMain.handle('file:save', () => ({ error: 'Fixture permission denied' }))
    })
    await nativeClose()
    dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: /^(保存并关闭|Save and close)$/ }).click()
    await expect(dialog.getByRole('alert')).toBeVisible()
    expect(editorWindows(application)).toHaveLength(1)
    await Promise.all([
      page.waitForEvent('close'),
      dialog.getByRole('button', { name: /^(不保存|Don't save)$/ }).click({ noWaitAfter: true }).catch(error => {
        // Discard can destroy the renderer before Playwright receives mouseup.
        if (!page.isClosed()) throw error
      }),
    ])
    await expect.poll(() => editorWindows(application!).length).toBe(0)
    expect(await readFile(filePath, 'utf8')).not.toContain('// must stay unsaved')
  } finally {
    if (application) await application.close().catch(() => undefined)
    // `root` is the exact directory returned by mkdtemp for this test.
    await rm(root, { recursive: true, force: true })
  }
})

test('HTML editor serves local styles, modules and images and previews unsaved changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'janusx-html-editor-'))
  let application: ElectronApplication | undefined
  try {
    const workspacePath = join(root, 'workspace')
    await Promise.all(['docs/modules', 'styles', 'assets'].map(path => mkdir(join(workspacePath, path), { recursive: true })))
    const filePath = join(workspacePath, 'docs', 'page.html')
    const original = '<!doctype html><meta charset="UTF-8"><link rel="stylesheet" href="/styles/theme.css"><main id="page"><h1>Local preview</h1><img alt="Local SVG" src="../assets/bg.svg"></main><script type="module" src="./modules/page.js"></script>'
    await Promise.all([
      writeFile(filePath, original),
      writeFile(join(workspacePath, 'styles', 'theme.css'), 'html,body{margin:0}#page{width:100vw;height:100vh;color:white;background:#123456 url("../assets/bg.svg") no-repeat right bottom}'),
      writeFile(join(workspacePath, 'assets', 'bg.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="orange"/></svg>'),
      writeFile(join(workspacePath, 'root.js'), 'export const marker="module-"'),
      writeFile(join(workspacePath, 'data.json'), '{"value":"ready"}'),
      writeFile(join(workspacePath, 'docs', 'modules', 'page.js'), 'import {marker} from "../../root.js"; const data=await fetch("/data.json").then(r=>r.json()); const page=document.getElementById("page");page.dataset.ready=marker+data.value;try{page.dataset.parent=typeof parent.electron}catch{page.dataset.parent="isolated"}'),
    ])
    application = await electron.launch({ args: [resolve('out/main/index.js'), `--user-data-dir=${join(root, 'user-data')}`], env: createDesktopTestEnv(root) })
    const main = await application.firstWindow()
    await main.waitForFunction(() => !!(window as any).electron?.window?.openEditor)
    await main.evaluate(payload => (window as any).electron.window.openEditor(payload), { filePath, workspacePath, floating: true })
    await expect.poll(() => editorWindows(application!).length).toBe(1)
    const page = editorWindows(application)[0]
    const frame = page.frameLocator('iframe')
    await expect(frame.locator('#page')).toHaveAttribute('data-ready', 'module-ready', { timeout: 30_000 })
    await expect(frame.locator('#page')).toHaveAttribute('data-parent', 'isolated')
    await expect(frame.locator('#page')).toHaveCSS('background-color', 'rgb(18, 52, 86)')
    await expect.poll(() => frame.locator('img').evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(120)
    await expect.poll(() => frame.locator('html').evaluate(() => innerWidth)).toBe(1280)
    expect(await frame.locator('html').evaluate(() => typeof (window as any).electron)).toBe('undefined')
    const url = await page.locator('iframe').getAttribute('src')
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:/)
    await page.getByRole('radio', { name: /^(双栏|Split)$/ }).click()
    await page.locator('.monaco-editor').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('<p id="draft">Unsaved preview</p>')
    await expect(frame.locator('#draft')).toHaveText('Unsaved preview')
    expect(await readFile(filePath, 'utf8')).toBe(original)
    for (const theme of ['planche', 'dark']) {
      await main.evaluate(theme => (window as any).electron.theme.update(theme), theme)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      for (const width of [820, 1000, 1280]) {
        await application.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()
          .find(window => new URL(window.webContents.getURL()).searchParams.get('editorWindow') === '1')!.setSize(width, 720), width)
        await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
        await expect(page.getByRole('radio', { name: /^(双栏|Split)$/ })).toBeChecked()
        for (const selector of ['.editor-titlebar', '.editor-toolbar']) {
          expect(await page.locator(selector).evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThan(2)
        }
        expect((await page.locator('.filetab-strip').boundingBox())!.width).toBeGreaterThan(100)
        await page.screenshot({ path: test.info().outputPath(`floating-${theme}-${width}.png`) })
      }
    }
    await page.getByRole('radio', { name: /^(代码|Code)$/ }).click()
    await expect(page.locator('iframe')).toHaveCount(0)
    await expect.poll(async () => (await fetch(url!)).status).toBe(404)
  } finally {
    if (application) await application.close().catch(() => undefined)
    // Exact temporary directory created for this test.
    await rm(root, { recursive: true, force: true })
  }
})
