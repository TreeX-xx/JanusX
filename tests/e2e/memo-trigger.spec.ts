import { expect, test } from '@playwright/test'

for (const theme of ['dark', 'planche']) {
  test(`memo uses an exterior Island action rail in ${theme}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(`/memo.html?island=1&theme=${theme}`)
      const trigger = page.getByRole('button', { name: 'Open memo on the right' })
    for (const viewport of [{ width: 1280, height: 720 }, { width: 1000, height: 600 }]) {
      await page.setViewportSize(viewport)
      await expect(page.locator('.janus-island-actions').getByRole('button', { name: 'Open memo on the right' })).toBeVisible()
      await expect(page.locator('.janus-chat-toolbar')).toBeHidden()
      await expect(page.locator('.janus-resource-scope')).toHaveCount(0)
      await expect(trigger.locator('.memo-trigger-label')).toBeHidden()
      await expect(trigger).toHaveAttribute('title', 'Open memo on the right')
      await expect(page.locator('.janus-chat-input-wrapper .memo-trigger')).toHaveCount(0)
      const { box, island } = await trigger.evaluate(element => ({
        box: element.getBoundingClientRect().toJSON(),
        island: element.closest('.janus-island-shell')!.getBoundingClientRect().toJSON(),
      }))
      expect(box.width).toBe(30)
      expect(box.x).toBeGreaterThan(island.x + island.width)
      expect(box.x + box.width).toBeLessThan(viewport.width)
      await trigger.focus()
      await expect(trigger).toBeFocused()
    }
    await page.screenshot({ path: `artifacts/memo-analysis/trigger-rail-${theme}.png` })
    await trigger.press('Enter')
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const rail = (await page.locator('.janus-island-actions').boundingBox())!
    const memo = (await page.locator('.memo-panel').boundingBox())!
    expect(rail.x + rail.width).toBeLessThan(memo.x)
    await page.screenshot({ path: `artifacts/memo-analysis/rail-open-${theme}.png` })
    await page.getByRole('button', { name: 'Expand memo files' }).click()
    await page.getByRole('button', { name: 'A', exact: true }).click()
    await expect(page.getByRole('complementary', { name: 'Milestone memo' })).toBeVisible()
    await trigger.click()
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('.memo-panel')).toHaveCount(0)
    expect(await page.evaluate(() => (window as any).memoFixture.sessions.find((session: any) => session.id === (window as any).memoFixture.activeId).memoId)).toBe('00000000-0000-4000-8000-000000000001')
    await expect(page.locator('.janus-chat-toolbar')).toBeHidden()
  })
}
