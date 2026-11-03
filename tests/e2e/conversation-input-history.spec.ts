import { expect, test } from '@playwright/test'

for (const engine of ['claude', 'codex']) {
  test(`${engine} recalls submitted text after reopening, restores draft and preserves editing keys`, async ({ page }) => {
    await page.goto(`/codex-conversation.html?engine=${engine}&initialView=conversation`)
    const input = page.getByRole('combobox', { name: `Message ${engine === 'claude' ? 'Claude' : 'Codex'}`, exact: true })
    await input.fill('Remember this\nsecond line')
    await input.press('Enter')
    await expect(input).toHaveText('')
    await page.reload()
    await expect(input).toBeVisible()
    await input.fill('unsent draft')
    await input.press('Control+Home')
    await input.press('ArrowUp')
    await expect(input).toHaveText('Remember this\nsecond line', { useInnerText: true })
    await input.press('Control+End')
    await input.press('ArrowDown')
    await expect(input).toHaveText('unsent draft')
    await input.fill('line one\nline two')
    await input.press('ArrowUp')
    await expect(input).toHaveText('line one\nline two', { useInnerText: true })
    await input.fill('')
    await input.dispatchEvent('keydown', { key: 'ArrowUp', isComposing: true })
    await expect(input).toHaveText('')
    await input.fill('/')
    await input.press('ArrowUp')
    await expect(input).toHaveText('/')
    expect(await page.evaluate(() => (window as any).codexFixture.calls.sends)).toEqual([])
  })
}

test('native history is recalled without sending and does not leak across engine scopes', async ({ page }) => {
  await page.goto('/codex-conversation.html?initialView=conversation')
  await page.evaluate(() => {
    ;(window as any).electron.terminal.inputHistory = async () => [{ text: 'native terminal input', time: Date.now() }]
  })
  await page.getByRole('button', { name: 'Terminal', exact: true }).click()
  await page.getByRole('button', { name: 'Conversation', exact: true }).click()
  const input = page.getByRole('combobox', { name: 'Message Codex', exact: true })
  await expect(input).toBeEnabled()
  await input.press('ArrowUp')
  await expect(input).toHaveText('native terminal input')
  expect(await page.evaluate(() => (window as any).codexFixture.calls.sends)).toEqual([])
  await input.press('Enter')
  await page.goto('/codex-conversation.html?engine=claude&initialView=conversation')
  const claudeInput = page.getByRole('combobox', { name: 'Message Claude', exact: true })
  await claudeInput.press('ArrowUp')
  await expect(claudeInput).toHaveText('')
})
