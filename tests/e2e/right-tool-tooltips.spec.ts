import { expect, test } from '@playwright/test'

for (const theme of ['planche', 'dark']) {
  test(`right tooltips do not obstruct controls in ${theme}`, async ({ page }) => {
    await page.goto(`/tool-palette.html?theme=${theme}`)
    const rail = page.getByRole('toolbar')
    const files = rail.getByRole('button', { name: /文件/ })
    const git = rail.getByRole('button', { name: /Git/ })
    const tooltip = page.getByRole('tooltip')
    await files.hover()
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toHaveCSS('pointer-events', 'none')
    const buttonBox = (await files.boundingBox())!
    const tipBox = (await tooltip.boundingBox())!
    expect(tipBox.x + tipBox.width).toBeLessThanOrEqual(buttonBox.x - 6)
    expect(Math.abs(tipBox.y + tipBox.height / 2 - buttonBox.y - buttonBox.height / 2)).toBeLessThan(3)
    await git.click()
    await expect(page.locator('#right-tool-rail-git')).toHaveAttribute('aria-pressed', 'true')
    await expect(tooltip).toHaveCount(0)
    await page.waitForTimeout(500)
    await expect(tooltip).toHaveCount(0)

    // Keyboard focus still explains icon-only controls.
    await page.keyboard.press('Tab')
    await files.focus()
    await expect(tooltip).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(tooltip).toHaveCount(0)

    // A long tooltip flips above the bottom edge and fits horizontally.
    await page.locator('#edge-tooltip').hover()
    await expect(tooltip).toBeVisible()
    const edge = (await tooltip.boundingBox())!
    expect(edge.x).toBeGreaterThanOrEqual(7)
    expect(edge.y).toBeGreaterThanOrEqual(7)
    expect(edge.x + edge.width).toBeLessThanOrEqual(1273)
    expect(edge.y + edge.height).toBeLessThanOrEqual(713)
    await page.setViewportSize({ width: 640, height: 480 })
    await expect(tooltip).toHaveCount(0)
    await page.mouse.move(400, 50)
    await page.locator('#edge-tooltip').hover()
    await expect(tooltip).toBeVisible()
    const narrow = (await tooltip.boundingBox())!
    expect(narrow.x + narrow.width).toBeLessThanOrEqual(633)
    expect(narrow.y + narrow.height).toBeLessThanOrEqual(473)
    await page.setViewportSize({ width: 1280, height: 720 })
    await expect(tooltip).toHaveCount(0)

    await page.getByRole('tab', { name: '历史', exact: true }).click()
    const commit = page.locator('[data-commit-hash="palette-commit"]')
    await commit.hover()
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toContainText('tooltip-preview.txt')
    await expect(tooltip).toHaveCSS('pointer-events', 'none')
    const preview = (await tooltip.boundingBox())!
    const point = { x: preview.x + preview.width / 2, y: preview.y + 20 }
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, point)).toBe('preview-underlay')
    await page.mouse.click(point.x, point.y)
    await expect(page.locator('#preview-underlay')).toHaveText('Underlay clicked')
    await expect(tooltip).toHaveCount(0)
    await commit.click()
    await expect(page.getByText('tooltip-preview.txt', { exact: true })).toBeVisible()

    // Escape cancels pending timers, and leaving the tool closes visible previews.
    await page.mouse.move(400, 50)
    await commit.hover()
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    await expect(tooltip).toHaveCount(0)
    await page.mouse.move(400, 50)
    await commit.hover()
    await expect(tooltip).toBeVisible()
    await page.locator('#right-tool-rail-files').click()
    await expect(tooltip).toHaveCount(0)
  })
}
