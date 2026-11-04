import { test, expect } from '@playwright/test'

for (const [engine, name] of [['codex', 'review'], ['opencode', 'team/review'], ['pi', 'skill:review']]) {
  test(`${engine}: icon menu completes without dispatch and invokes a structured command with arguments`, async ({ page }) => {
    await page.goto(`/codex-conversation.html?engine=${engine}&initialView=conversation`)
    await page.evaluate(() => (window as any).codexFixture.catalog())
    const input = page.locator('[data-conversation-input]')
    await input.fill('/' + name.slice(0, -1))
    const option = page.getByRole('option').filter({ hasText: '/' + name })
    await expect(option).toBeVisible()
    await expect(option.locator('svg')).toHaveCount(1)
    await input.press('Tab')
    await expect(input).toHaveText('/' + name + ' ')
    expect(await page.evaluate(() => (window as any).codexFixture.calls.commands.filter((c: any) => c.type === 'invoke'))).toHaveLength(0)
    await input.fill('/' + name + ' inspect args')
    await input.press('Escape')
    await expect(input).toHaveText('/' + name + ' inspect args')
    await input.press('Enter')
    await expect(input).toHaveText('')
    const calls = await page.evaluate(() => (window as any).codexFixture.calls)
    expect(calls.sends).toEqual([])
    expect(calls.commands.filter((c: any) => c.type === 'invoke')).toEqual([expect.objectContaining({ entryId: 'native-review', arguments: 'inspect args', catalogRevision: 1 })])
  })
}

test('native /help does not accidentally activate the first session command', async ({ page }) => {
  await page.goto('/codex-conversation.html?initialView=conversation')
  const input = page.locator('[data-conversation-input]')
  await input.fill('/help'); await input.press('Enter')
  const calls = await page.evaluate(() => (window as any).codexFixture.calls.commands)
  expect(calls.some((c: any) => c.type === 'new')).toBe(false)
  expect(calls).toContainEqual(expect.objectContaining({ type: 'terminal-command', name: 'help' }))
})

test('Claude terminal command submits the selected native command without a raw chat prompt', async ({ page }) => {
  await page.goto('/codex-conversation.html?engine=claude&initialView=conversation')
  await page.evaluate(() => (window as any).codexFixture.catalog())
  const input = page.locator('[data-conversation-input]')
  await input.fill('/review args')
  await expect(page.getByRole('option').filter({ hasText: '/review' })).toContainText('Terminal')
  await input.press('Enter')
  await expect(input).not.toBeVisible()
  const calls = await page.evaluate(() => (window as any).codexFixture.calls)
  expect(calls.sends).toEqual([])
  expect(calls.commands.filter((c: any) => c.type === 'invoke')).toEqual([expect.objectContaining({ entryId: 'native-review', arguments: 'args' })])
})

for (const engine of ['claude', 'codex', 'opencode', 'pi', 'dsh']) {
  test(`${engine}: a typed native command executes even outside the API catalog`, async ({ page }) => {
    await page.goto(`/codex-conversation.html?engine=${engine}&initialView=conversation`)
    const input = page.locator('[data-conversation-input]')
    await input.fill('/native-extra 中文 args')
    await expect(page.getByRole('option').filter({ hasText: '/native-extra' })).toContainText('Run in the native terminal')
    await input.press('Enter')
    await expect(input).not.toBeVisible()
    const calls = await page.evaluate(() => (window as any).codexFixture.calls)
    expect(calls.sends).toEqual([])
    expect(calls.commands.filter((c: any) => c.type === 'terminal-command')).toEqual([expect.objectContaining({ name: 'native-extra', arguments: '中文 args' })])
  })
}
