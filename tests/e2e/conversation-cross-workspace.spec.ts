import { expect, test } from '@playwright/test'

for (const delivery of ['Enter', 'button']) {
  test(`foreign workspace split sends its own draft via ${delivery}`, async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto('/codex-conversation.html?initialView=conversation&split=side&crossWorkspace')
    const foreign = page.locator('[data-fixture-pane="first"]')
    const local = page.locator('[data-fixture-pane="second"]')
    const input = foreign.getByRole('combobox', { name: 'Message Codex' })
    const localInput = local.getByRole('combobox', { name: 'Message Codex' })
    await localInput.fill('Keep current workspace draft')
    await input.fill('Send foreign workspace draft')
    if (delivery === 'Enter') await input.press('Enter')
    else await foreign.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(() => page.evaluate(() => (window as any).codexFixture.calls.sends)).toEqual(['Send foreign workspace draft'])
    await expect(input).toHaveText('')
    await expect(localInput).toHaveText('Keep current workspace draft')
  })
}

test('restoring a failed foreign workspace message preserves newer draft text', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/codex-conversation.html?initialView=conversation&split=side&crossWorkspace')
  const foreign = page.locator('[data-fixture-pane="first"]')
  const input = foreign.getByRole('combobox', { name: 'Message Codex' })
  await input.fill('Original message')
  await page.evaluate(() => (window as any).codexFixture.holdSend())
  await input.press('Enter')
  await expect.poll(() => page.evaluate(() => (window as any).codexFixture.calls.sends)).toEqual(['Original message'])
  await input.fill('New draft')
  await page.evaluate(() => (window as any).codexFixture.releaseSend(true))
  await expect(foreign.getByRole('alert')).toHaveText('Error: Fixture send failed')
  await foreign.getByRole('button', { name: 'Edit / restore draft' }).click()
  await expect.poll(() => input.innerText()).toMatch(/^New draft\n+Original message$/)
})
