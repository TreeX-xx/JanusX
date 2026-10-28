import { expect, test } from '@playwright/test'

for (const width of [1100, 480, 320]) {
  test(`theme cards preview both palettes and fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/theme-settings.html')
    await expect(page.getByText('Language Services', { exact: true })).toHaveCount(0)
    await expect(page.getByText('clangd', { exact: true })).toHaveCount(0)
    const picker = page.getByRole('group', { name: 'Appearance theme', exact: true })
    await expect(picker.getByRole('radio')).toHaveCount(2)
    await expect(picker.getByText('Classic Black (default)', { exact: true })).toBeVisible()
    await expect(picker.getByText('Slate', { exact: true })).toBeVisible()
    await expect(picker.locator('input[value="dark"]')).toBeChecked()
    await expect(page.locator('[data-theme-preview="planche"]')).toHaveCSS('background-color', 'rgb(239, 228, 197)')
    await expect(page.locator('[data-theme-preview="dark"]')).toHaveCSS('background-color', 'rgb(21, 21, 23)')
    const box = await picker.boundingBox()
    expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    expect(await picker.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
    await page.screenshot({ path: test.info().outputPath(`theme-cards-${width}.png`) })
  })
}

test('click and keyboard switch the persisted theme without retinting other previews', async ({ page }) => {
  await page.goto('/theme-settings.html?theme=planche')
  const dark = page.locator('input[value="dark"]')
  await dark.locator('..').click()
  await expect(dark).toBeDisabled()
  await expect(dark).toBeChecked()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('[data-theme-preview="planche"]')).toHaveCSS('background-color', 'rgb(239, 228, 197)')
  await expect(dark).toBeEnabled()
  await page.screenshot({ path: test.info().outputPath('theme-cards-dark.png') })
  await dark.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(page.locator('input[value="planche"]')).toBeChecked()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'planche')
})

test('a rejected save keeps the previous selection and offers another attempt', async ({ page }) => {
  await page.goto('/theme-settings.html?fail&theme=planche')
  await page.locator('input[value="dark"]').locator('..').click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.locator('input[value="planche"]')).toBeChecked()
  await expect(page.locator('input[value="dark"]')).toBeEnabled()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'planche')
})

test('registered themes receive cards and unknown saved themes select the default', async ({ page }) => {
  await page.goto('/theme-settings.html?custom&theme=unknown')
  await expect(page.getByRole('radio')).toHaveCount(3)
  await expect(page.locator('input[value="dark"]')).toBeChecked()
  await page.getByText('Custom theme', { exact: true }).click()
  await expect(page.locator('input[value="custom"]')).toBeChecked()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'custom')
})
