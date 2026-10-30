import { expect, test } from '@playwright/test'

test('notification disclosure keeps draft values through collapse, discard and save', async ({ page }) => {
  await page.goto('/settings.html?tab=notifications')
  const save = page.getByRole('button', { name: '保存', exact: true })
  const remote = page.getByRole('checkbox', { name: '启用远程提醒', exact: true })
  await expect(save).toBeDisabled()
  await expect(page.getByText('去重窗口', { exact: true })).toHaveCount(0)
  await remote.press('Space')
  await expect(page.getByRole('status')).toHaveText('有未保存的修改')
  await expect(page.getByText('去重窗口', { exact: true })).toBeHidden()
  await page.getByText('高级设置', { exact: true }).click()
  const dedupe = page.getByText('去重窗口', { exact: true }).locator('../..').getByRole('spinbutton')
  await dedupe.fill('600')
  await page.getByRole('checkbox', { name: '启用飞书提醒', exact: true }).press('Space')
  const url = page.getByRole('textbox', { name: 'Webhook URL', exact: true })
  await url.fill('https://example.com/test-hook')
  await remote.press('Space')
  await expect(url).toHaveCount(0)
  await remote.press('Space')
  await expect(url).toHaveValue('https://example.com/test-hook')
  await page.getByText('高级设置', { exact: true }).click()
  await expect(dedupe).toHaveValue('600')
  await save.click()
  await expect(page.getByRole('status')).toHaveText('已保存')
  await expect(save).toBeDisabled()
  await dedupe.fill('900')
  await page.getByRole('button', { name: '撤销修改' }).click()
  await expect(dedupe).toHaveValue('600')
  // The saved draft survives a panel remount.
  await page.locator('[data-tab="general"]').click()
  await page.locator('[data-tab="notifications"]').click()
  await expect(remote).toBeChecked()
  await expect(url).toHaveValue('https://example.com/test-hook')
})

test('failed notification save preserves edits and permits retry or discard', async ({ page }) => {
  await page.goto('/settings.html?tab=notifications&fail')
  const remote = page.getByRole('checkbox', { name: '启用远程提醒', exact: true })
  await remote.press('Space')
  const save = page.getByRole('button', { name: '保存', exact: true })
  await save.click()
  await expect(page.getByRole('status')).toHaveText('Fixture save failed')
  await expect(remote).toBeChecked()
  await expect(save).toBeEnabled()
  await page.getByRole('button', { name: '撤销修改' }).click()
  await expect(remote).not.toBeChecked()
  await expect(save).toBeDisabled()
})

test('agent settings enable saving only for changes and discard restores saved values', async ({ page }) => {
  await page.goto('/settings.html?tab=agent')
  const save = page.getByRole('button', { name: '保存', exact: true })
  const steps = page.getByRole('spinbutton')
  await expect(save).toBeDisabled()
  await steps.fill('55')
  await expect(page.getByRole('status')).toHaveText('有未保存的修改')
  await page.getByRole('button', { name: '撤销修改' }).click()
  await expect(steps).toHaveValue('40')
  await steps.fill('55')
  await save.click()
  await expect(page.getByRole('status')).toHaveText('已保存')
  await expect(save).toBeDisabled()
})

for (const theme of ['planche', 'dark']) {
  for (const width of [1440, 900, 640]) {
    test(`settings fit ${theme} at ${width}px with reachable navigation and footer`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(`/settings.html?theme=${theme}`)
      await expect(page.getByRole('heading', { name: '外观与语言', exact: true })).toBeVisible()
      const dialog = page.getByRole('dialog')
      const sidebar = dialog.locator('aside')
      const learning = sidebar.getByRole('button', { name: '帮助与学习', exact: true })
      await expect(learning).toBeInViewport()
      await page.evaluate(async () => {
        await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => undefined)))
      })
      expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
      await page.screenshot({ path: test.info().outputPath(`general-${theme}-${width}.png`) })
      await page.locator('[data-tab="notifications"]').click()
      const save = page.getByRole('button', { name: '保存', exact: true })
      await expect(save).toBeInViewport()
      await expect(learning).toBeInViewport()
      const body = page.locator('main')
      expect(await body.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
      await page.screenshot({ path: test.info().outputPath(`notifications-${theme}-${width}.png`) })
      await page.setViewportSize({ width, height: 480 })
      await expect(learning).toBeInViewport()
      const before = (await learning.boundingBox())!
      if (width > 760) {
        const bounds = (await sidebar.boundingBox())!
        expect(bounds.y + bounds.height - before.y - before.height).toBeLessThanOrEqual(20)
      }
      await sidebar.locator('nav').evaluate(node => { node.scrollTop = node.scrollHeight; node.scrollLeft = node.scrollWidth })
      const after = (await learning.boundingBox())!
      expect(after.y).toBeCloseTo(before.y, 0)
      await expect(learning).toBeInViewport()
      await page.screenshot({ path: test.info().outputPath(`learning-footer-${theme}-${width}-480.png`) })
      await page.getByRole('button', { name: '关闭', exact: true }).click()
      await expect(dialog).toHaveCount(0)
    })
  }
}
