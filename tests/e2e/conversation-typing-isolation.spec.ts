import { expect, test } from '@playwright/test'

test('typing in a 400-item conversation does not traverse history and retains the draft', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/codex-conversation.html?initialView=conversation')
  const input = page.getByRole('combobox', { name: 'Message Codex' })
  await input.waitFor()
  await page.evaluate(() => (window as any).codexFixture.longHistory())
  await expect(page.getByText('Review change 99', { exact: true })).toBeVisible()
  await input.focus()
  // Settle layout/scroll effects before measuring reads of historical item text.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const before = await page.evaluate(() => (window as any).codexFixture.historyReads())
  await input.pressSequentially('Keep this draft while reviewing', { delay: 10 })
  await expect(input).toHaveText('Keep this draft while reviewing')
  const after = await page.evaluate(() => (window as any).codexFixture.historyReads())
  expect(after - before, 'typing must not read historical message contents').toBe(0)
  await page.getByRole('button', { name: 'Remount', exact: true }).click()
  await expect(input).toHaveText('Keep this draft while reviewing')
  await input.press('Enter')
  await expect.poll(() => page.evaluate(() => (window as any).codexFixture.calls.sends)).toEqual(['Keep this draft while reviewing'])
})
