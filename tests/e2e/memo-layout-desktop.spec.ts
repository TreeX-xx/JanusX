import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { createDesktopTestEnv, seedIntroducedLearning } from './desktop-test-env'

test('real Titlebar keeps memo usable at native minimum size and renderer zoom', async () => {
  const root = await mkdtemp(join(tmpdir(), 'janus-memo-layout-'))
  const buildRoot = resolve('out')
  const application = await electron.launch({
    args: [join(buildRoot, 'main/index.js'), `--user-data-dir=${join(root, 'user-data')}`],
    env: { ...createDesktopTestEnv(root), JANUSX_DEV_BUILD_ROOT: buildRoot },
  })
  try {
    const page = await application.firstWindow({ timeout: 30000 })
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1400, 800))
    await expect.poll(async () => Math.abs(await page.evaluate(() => window.innerWidth) - 1400)).toBeLessThanOrEqual(1)
    await page.waitForFunction(() => Boolean(window.electron?.memo))
    await page.evaluate(() => window.electron.system.setLanguage('en'))
    await seedIntroducedLearning(page)
    await page.reload()
    await page.waitForFunction(() => Boolean(window.electron?.memo))
    await page.evaluate(async () => {
      const memo = await window.electron.memo!.create('Native layout')
      const node = await window.electron.memo!.edit(memo.id, { expectedRevision: 0, operations: [{ op: 'addNode', title: 'Native milestone', label: 'v1.0' }] })
      await window.electron.memo!.edit(memo.id, { expectedRevision: node.revision, operations: [{ op: 'addPoint', nodeId: node.nodes[0].id, text: 'Editable native record' }] })
    })
    await page.locator('.janus-island').dblclick()
    await page.getByRole('tab', { name: 'Chat', exact: true }).click()
    await page.getByRole('button', { name: 'Open memo on the left' }).click()
    await page.getByRole('button', { name: 'Native layout', exact: true }).click()
    await page.getByRole('tab', { name: 'Native milestone', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Point text' })).toHaveValue('Editable native record')
    for (const width of [1400, 1280, 1000]) {
      await application.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size, 600), width)
      // Windows may round native content bounds by one CSS pixel at fractional scaling.
      await expect.poll(async () => Math.abs(await page.evaluate(() => window.innerWidth) - width)).toBeLessThanOrEqual(1)
      const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
      await expect(page.locator('.memo-panel')).toHaveAttribute('data-layout', width === 1000 ? 'compact' : 'parallel')
      await expect.poll(async () => {
        const box = (await page.locator('.memo-panel').boundingBox())!
        return box.y + box.height
      }).toBeLessThanOrEqual(viewport.height - 12)
      const geometry = await page.evaluate(() => {
        const main = document.querySelector('.janus-island-shell')!.getBoundingClientRect()
        const memo = document.querySelector('.memo-panel')!.getBoundingClientRect()
        return { gap: main.left - memo.right, left: memo.left, right: main.right, bottom: memo.bottom, content: document.querySelector('.memo-content')!.clientWidth }
      })
      expect(geometry.gap).toBe(12)
      expect(geometry.left).toBeGreaterThanOrEqual(12)
      expect(geometry.right).toBeLessThanOrEqual(viewport.width - 12)
      expect(geometry.bottom).toBeLessThanOrEqual(viewport.height - 12)
      expect(geometry.content).toBeGreaterThanOrEqual(250)
      const controls = page.locator('.titlebar-drag > .titlebar-no-drag').first()
      for (const control of await controls.locator(':scope > div').all()) {
        const box = (await control.boundingBox())!
        expect(await control.evaluate((element, point) => element.contains(document.elementFromPoint(point.x, point.y)), { x: box.x + box.width / 2, y: box.y + box.height / 2 })).toBe(true)
      }
    }
    await page.screenshot({ path: 'artifacts/memo-analysis/layout-desktop-1000.png' })
    await expect(page.getByRole('textbox', { name: 'Memo title' })).toHaveCount(0)
    const title = page.getByRole('textbox', { name: 'Node title' })
    await title.fill('Native dirty title')
    await title.evaluate((input: HTMLInputElement) => input.setSelectionRange(2, 6))
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25))
    await expect(page.locator('.memo-panel')).toHaveAttribute('data-layout', 'focus')
    await expect(title).toBeFocused()
    await expect(title).toHaveValue('Native dirty title')
    expect(await title.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd])).toEqual([2, 6])
    await page.getByRole('group', { name: 'Chat and memo views' }).getByRole('button', { name: 'Chat', exact: true }).click()
    await expect(page.locator('.memo-panel')).toBeHidden()
    await page.getByRole('group', { name: 'Chat and memo views' }).getByRole('button', { name: 'Memo', exact: true }).click()
    await expect(title).toHaveValue('Native dirty title')
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1))
    await expect(page.locator('.memo-panel')).toHaveAttribute('data-layout', 'compact')
  } finally {
    await application.close()
    if (dirname(root) !== resolve(tmpdir()) || !basename(root).startsWith('janus-memo-layout-')) throw new Error('Unexpected fixture directory')
    await rm(root, { recursive: true, force: true })
  }
})
