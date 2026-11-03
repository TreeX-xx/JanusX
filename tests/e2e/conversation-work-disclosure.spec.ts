import { expect, test } from '@playwright/test'

for (const engine of ['codex', 'claude', 'opencode', 'pi', 'dsh']) {
  test(`${engine}: live work stays compact, preserves choices and exposes failures`, async ({ page }) => {
    await page.goto(`/codex-conversation.html?initialView=conversation&engine=${engine}`)
    const preview = (stage: string) => page.evaluate(stage => (window as any).codexFixture.workPreview(stage), stage)
    await preview('start')
    const toggle = page.locator('.conversation-work-toggle')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(toggle).toContainText('Running')
    await expect(page.getByText('I will inspect the workspace.', { exact: true })).toBeVisible()
    await expect(page.locator('.conversation-work summary')).toHaveCount(0)
    if (engine === 'codex') {
      await page.evaluate(() => (window as any).codexFixture.workApproval())
      await expect(toggle).toContainText('Needs approval')
      await expect(toggle).toHaveAttribute('aria-expanded', 'false')
      await expect(page.getByText('Allow workspace inspection', { exact: true })).toBeVisible()
      await preview('start')
    }
    await toggle.click()
    const detail = page.locator('.conversation-work details').first()
    await detail.locator('summary').click()
    await expect(detail).toHaveAttribute('open', '')
    await preview('update')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(toggle).toContainText('2 activities')
    await expect(toggle).toContainText('1 failed')
    await expect(detail).toHaveAttribute('open', '')
    await toggle.click()
    await preview('finish')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(toggle).toContainText('Failed')
    await expect(page.getByText('The check finished with a read error.', { exact: true })).toBeVisible()
    await toggle.click()
    await expect(detail).toHaveAttribute('open', '')
    await expect(detail.locator('pre')).toContainText('Raw command output')
    if (engine === 'codex') {
      await page.setViewportSize({ width: 380, height: 780 })
      await expect(toggle).toBeVisible()
      expect(await toggle.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
      await page.screenshot({ path: 'artifacts/work-disclosure-narrow.png' })
    }
  })
}
