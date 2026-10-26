import { expect, test } from '@playwright/test'

type Fixture = {
  calls: { legacy: number; warmups: string[] }
  disable: () => void
  clearProject: () => void
  noteChanged: () => void
  tabs: () => { id: string; type: string }[]
  restoreLegacyLayout: () => void
  setTheme: (theme: 'planche' | 'dark') => void
  sourceFailure: boolean
  openedFiles: () => string[]
}
declare global { interface Window { boardFixture: Fixture } }

test('without plugins the board opens management and startup never projects legacy Blueprint', async ({ page }) => {
  await page.goto('/blackboard.html')
  await page.getByRole('button', { name: 'Toggle board', exact: true }).click()
  const board = page.getByRole('region', { name: 'Second board', exact: true })
  await expect(board).toContainText('Install and enable plugins')
  await page.evaluate(() => window.boardFixture.noteChanged())
  await expect.poll(() => page.evaluate(() => window.boardFixture.calls.legacy)).toBe(0)
  await expect.poll(() => page.evaluate(() => window.boardFixture.calls.warmups.length)).toBe(1)
  await board.getByRole('button', { name: 'Manage plugins', exact: true }).click()
  await expect(page.getByTestId('board-height')).toHaveText('0')
  await expect(page.locator('[data-tab="plugins"]')).toHaveAttribute('aria-current', 'page')
})

test('board opens existing plugin slots once and hides disabled contributions', async ({ page }) => {
  await page.goto('/blackboard.html?installed')
  const toggle = page.getByRole('button', { name: 'Toggle board', exact: true })
  await toggle.click()
  await page.screenshot({ path: test.info().outputPath('plugin-board.png') })
  await page.getByRole('button', { name: 'Open Project Notes', exact: true }).click()
  await expect(page.getByTestId('board-height')).toHaveText('0')
  await toggle.click()
  await page.getByRole('button', { name: 'Open Project Notes', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.boardFixture.tabs().filter(tab => tab.type === 'extension').length)).toBe(1)
  await toggle.click()
  await page.evaluate(() => window.boardFixture.clearProject())
  await expect(page.getByRole('button', { name: 'Open Project Notes', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Open Application Tool', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Open Application Tool', exact: true }).click()
  await expect(page.getByTestId('board-height')).toHaveText('0')
  await expect(page.getByText('Application ready', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Return to previous view', exact: true }).click()
  await toggle.click()
  await page.evaluate(() => window.boardFixture.disable())
  await expect(page.getByRole('button', { name: 'Open Application Tool', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('board-height')).toHaveText('0')
})

test('restored legacy workbench leads to plugin management', async ({ page }) => {
  await page.goto('/blackboard.html')
  await page.evaluate(() => window.boardFixture.restoreLegacyLayout())
  await expect(page.locator('[data-tab="plugins"]')).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('.blueprint-workbench')).toHaveCount(0)
})

test('chat evidence opens a shared Note source and preserves read errors without Blueprint', async ({ page }) => {
  await page.goto('/blackboard.html?timeline')
  await page.locator('.bp-note-access > summary').click()
  await page.evaluate(() => { window.boardFixture.sourceFailure = true })
  await page.getByRole('button', { name: 'Source Note', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('Source unavailable')
  await page.evaluate(() => { window.boardFixture.sourceFailure = false })
  await page.getByRole('button', { name: 'Source Note', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.boardFixture.openedFiles())).toContain('C:/one/.agents/notes/topic.md')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.boardFixture.calls.legacy)).toBe(0)
})

test('Island pull toggles the board and its lower edge still retracts it', async ({ page }) => {
  await page.goto('/blackboard.html?installed')
  const island = page.locator('.janus-island')
  const pull = async () => {
    const pointer = { bubbles: true, pointerType: 'mouse', pointerId: 1, isPrimary: true, button: 0, clientX: 600 }
    await island.dispatchEvent('pointerdown', { ...pointer, clientY: 20 })
    await island.dispatchEvent('pointermove', { ...pointer, clientY: 120 })
    await island.dispatchEvent('pointerup', { ...pointer, clientY: 120 })
  }
  await pull()
  await expect(page.getByRole('region', { name: 'Second board', exact: true })).toBeVisible()
  await pull()
  await expect(page.getByTestId('board-height')).toHaveText('0')
  await page.getByRole('button', { name: 'Toggle board', exact: true }).click()
  const edge = page.locator('.bb-edge')
  await expect(page.locator('.island-blackboard')).toHaveCSS('height', '420px')
  await edge.hover()
  const box = await edge.boundingBox()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width / 2, box!.y - 350)
  await page.mouse.up()
  await expect(page.getByTestId('board-height')).toHaveText('0')
})

for (const theme of ['planche', 'dark'] as const) {
  test(`main exit confirmation is centered without opening Blueprint in ${theme}`, async ({ page }) => {
    await page.goto('/blackboard.html')
    await page.evaluate(theme => {
      window.boardFixture.setTheme(theme)
      ;(window as any).closeRequests = 0
      window.electron.window.close = async () => { (window as any).closeRequests++ }
    }, theme)
    const close = page.locator('.window-controls [data-window-action="close"]')
    const dialog = page.getByRole('dialog', { name: 'Confirm close', exact: true })
    await close.click()
    for (const viewport of [{ width: 1280, height: 720 }, { width: 800, height: 480 }]) {
      await page.setViewportSize(viewport)
      await expect(dialog).toBeVisible()
      await expect.poll(async () => {
        const box = await dialog.boundingBox()
        return box && Math.abs(box.x + box.width / 2 - viewport.width / 2) < 1 && Math.abs(box.y + box.height / 2 - viewport.height / 2) < 1
      }).toBe(true)
      expect(await page.locator('.prompt-dialog__overlay').evaluate(element => {
        const rect = element.getBoundingClientRect()
        return getComputedStyle(element).position === 'fixed' && rect.x === 0 && rect.y === 0 && rect.width === innerWidth && rect.height === innerHeight
      })).toBe(true)
    }
    expect(await dialog.getByRole('button', { name: 'Cancel', exact: true }).evaluate(element => getComputedStyle(element).height)).toBe('32px')
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await page.screenshot({ path: test.info().outputPath(`exit-confirmation-${theme}.png`) })
    await dialog.press('Escape')
    await expect(dialog).toHaveCount(0)
    await close.click()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await close.click()
    await page.locator('.prompt-dialog__overlay').click({ position: { x: 8, y: 8 } })
    await expect(dialog).toHaveCount(0)
    expect(await page.evaluate(() => (window as any).closeRequests)).toBe(0)
    await close.click()
    await dialog.getByRole('button', { name: 'Quit', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    expect(await page.evaluate(() => (window as any).closeRequests)).toBe(1)
  })
}
