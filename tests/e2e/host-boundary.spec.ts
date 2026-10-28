import { expect, test } from '@playwright/test'

type Fixture = {
  calls: { legacy: number; warmups: string[] }
  noteChanged: () => void
  restoreLegacyLayout: () => void
  setTheme: (theme: 'planche' | 'dark') => void
  sourceFailure: boolean
  openedFiles: () => string[]
}
declare global { interface Window { hostFixture: Fixture } }

test('startup and Note changes never project retired Blueprint', async ({ page }) => {
  await page.goto('/host-boundary.html')
  await page.evaluate(() => window.hostFixture.noteChanged())
  await expect.poll(() => page.evaluate(() => window.hostFixture.calls.warmups.length)).toBe(1)
  expect(await page.evaluate(() => window.hostFixture.calls.legacy)).toBe(0)
})

test('restored legacy workbench leads to plugin management', async ({ page }) => {
  await page.goto('/host-boundary.html')
  await page.evaluate(() => window.hostFixture.restoreLegacyLayout())
  await expect(page.locator('[data-tab="plugins"]')).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('.blueprint-workbench')).toHaveCount(0)
})

test('chat evidence opens a shared Note source and preserves read errors without Blueprint', async ({ page }) => {
  await page.goto('/host-boundary.html?timeline')
  await page.locator('.bp-note-access > summary').click()
  await page.evaluate(() => { window.hostFixture.sourceFailure = true })
  await page.getByRole('button', { name: 'Source Note', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('Source unavailable')
  await page.evaluate(() => { window.hostFixture.sourceFailure = false })
  await page.getByRole('button', { name: 'Source Note', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.hostFixture.openedFiles())).toContain('C:/one/.agents/notes/topic.md')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.hostFixture.calls.legacy)).toBe(0)
})

for (const theme of ['planche', 'dark'] as const) {
  test(`main exit confirmation is centered without opening Blueprint in ${theme}`, async ({ page }) => {
    await page.goto('/host-boundary.html')
    await page.evaluate(theme => {
      window.hostFixture.setTheme(theme)
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
