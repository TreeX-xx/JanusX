import { expect, test } from '@playwright/test'

for (const theme of ['planche', 'dark']) {
  test(`memo frame matches the main island in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`/memo.html?island=1&preview=1&theme=${theme}`)
    const memo = page.locator('.memo-panel')
    const main = page.locator('.janus-expanded-shell')
    await expect(memo).toHaveAttribute('data-phase', 'open')
    for (const property of ['border-top-width', 'border-top-color', 'border-radius', 'box-shadow', 'background-color', 'background-image']) {
      const expected = await main.evaluate((element, prop) => getComputedStyle(element).getPropertyValue(prop), property)
      await expect(memo).toHaveCSS(property, expected)
    }
    await expect(page.locator('.memo-canvas')).toHaveCSS('border-top-width', '0px')
    await expect(page.locator('.memo-shell-header button').first()).toHaveCSS('border-top-width', '0px')
    await page.screenshot({ path: test.info().outputPath(`memo-frame-${theme}.png`) })
    const original = await memo.boundingBox()
    await page.getByRole('button', { name: /Collapse memo files|收起文件栏/ }).click()
    await expect(page.locator('.memo-files')).toHaveCount(0)
    await expect.poll(async () => (await memo.boundingBox())!.width).toBe(original!.width)
    await page.setViewportSize({ width: 1000, height: 600 })
    await expect(memo).toHaveAttribute('data-layout', 'compact')
    const box = (await memo.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(12)
    expect(box.x + box.width).toBeLessThanOrEqual(988)
    await page.screenshot({ path: test.info().outputPath(`memo-frame-${theme}-compact.png`) })
  })
}
