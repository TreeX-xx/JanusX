import { expect, test } from '@playwright/test'

test('updates live in About and retain settings across navigation', async ({ page }) => {
  await page.goto('/settings.html?en&updater')
  await expect(page.getByText('Current version 1.0.0', { exact: true })).toHaveCount(0)
  await page.locator('[data-tab="about"]').click()
  await expect(page.getByRole('heading', { name: 'About', exact: true })).toBeVisible()
  await expect(page.getByText('Current version 1.0.0', { exact: true })).toBeVisible()
  const autoCheck = page.getByRole('checkbox')
  await expect(autoCheck).toBeChecked()
  await autoCheck.press('Space')
  await page.locator('[data-tab="general"]').click()
  await page.locator('[data-tab="about"]').click()
  await expect(autoCheck).not.toBeChecked()
  await page.getByRole('button', { name: 'Check for updates', exact: true }).click()
  await expect(page.getByText('A more focused workspace.')).toBeVisible()
  await page.getByRole('button', { name: 'Restart and install', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-update-installed', 'true')
  await page.getByRole('button', { name: 'Star on GitHub', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-repository-opened', 'true')
})

test('repository failures explain how to retry without a false starred state', async ({ page }) => {
  await page.goto('/settings.html?en&updater&tab=about&linkFail')
  const star = page.getByRole('button', { name: 'Star on GitHub', exact: true })
  await star.click()
  await expect(page.getByRole('alert')).toContainText('github.com/TreeX-xx/JanusX')
  await expect(star).toBeEnabled()
})

for (const theme of ['planche', 'dark']) {
  for (const width of [1100, 640]) {
    test(`About fits ${theme} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(`/settings.html?tab=about&theme=${theme}`)
      await expect(page.getByRole('heading', { name: '关于', exact: true })).toBeVisible()
      await page.evaluate(async () => {
        await Promise.all(document.getAnimations()
          .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
          .map(animation => animation.finished.catch(() => undefined)))
      })
      await expect(page.getByText('开发模式不可用，打包版生效', { exact: true })).toBeVisible()
      const star = page.getByRole('button', { name: '去 GitHub 点个赞', exact: true })
      await expect(star).toBeInViewport()
      expect(await page.locator('main').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
      await page.screenshot({ path: test.info().outputPath(`about-${theme}-${width}.png`) })
    })
  }
}
