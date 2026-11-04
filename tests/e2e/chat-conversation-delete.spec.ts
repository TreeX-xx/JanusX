import { expect, test, type Page } from '@playwright/test'

async function sessions(page: Page) {
  return page.evaluate(() => (window as any).memoFixture.sessions.map((session: any) => session.id))
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/memo.html?island=1')
})

test('deleting an inactive conversation keeps the island and active stream open', async ({ page }) => {
    await page.locator('.janus-chat-sidebar').getByRole('button', { name: 'New conversation', exact: true }).click()
    const activeId = await page.evaluate(() => (window as any).memoFixture.activeId)
    await page.evaluate(() => (window as any).memoFixture.send('Keep this active reply'))
    await expect.poll(() => page.evaluate(() => (window as any).memoFixture.requests.length)).toBe(1)
    await page.locator('.janus-chat-sidebar').getByRole('button', { name: 'Delete Memo chat', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Delete conversation' })
    await expect(dialog).toBeVisible()
    expect(await sessions(page)).toContain('memo-chat')
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('.janus-island')).toHaveAttribute('data-stage', 'expanded')
    await expect.poll(() => sessions(page)).toEqual([activeId])
    expect(await page.evaluate(() => (window as any).memoFixture.activeId)).toBe(activeId)
    expect(await page.evaluate(() => (window as any).memoFixture.aborted)).toBe(0)
    await expect(page.getByTestId('reopen')).toBeHidden()
  })

test('cancel button, Escape and backdrop dismiss only the conversation confirmation', async ({ page }) => {
  const initial = await sessions(page)
  for (const cancel of ['button', 'escape', 'backdrop']) {
    await page.locator('.janus-chat-sidebar').getByRole('button', { name: 'Delete Memo chat', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Delete conversation' })
    await expect(dialog).toBeVisible()
    if (cancel === 'button') await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    else if (cancel === 'escape') await dialog.press('Escape')
    else await page.locator('.prompt-dialog__overlay').click({ position: { x: 8, y: 8 } })
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('.janus-island')).toHaveAttribute('data-stage', 'expanded')
    expect(await sessions(page)).toEqual(initial)
  }
  // Normal outside dismissal must still work once the modal is gone.
  await page.mouse.click(8, 8)
  await expect(page.getByTestId('reopen')).toBeVisible()
})

test('Enter deletes the last active conversation and opens a fresh one without collapsing', async ({ page }) => {
  await page.locator('.janus-chat-sidebar').getByRole('button', { name: 'Delete Memo chat', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete conversation' })
  await expect(dialog).toBeVisible()
  await dialog.press('Enter')
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.janus-island')).toHaveAttribute('data-stage', 'expanded')
  await expect.poll(() => sessions(page)).not.toContain('memo-chat')
  expect(await sessions(page)).toHaveLength(1)
  await expect(page.locator('textarea.janus-chat-input')).toBeVisible()
})

test('deleting the streaming conversation aborts its reply and keeps a fresh conversation open', async ({ page }) => {
  await page.evaluate(() => (window as any).memoFixture.send('Active target'))
  await expect.poll(() => page.evaluate(() => (window as any).memoFixture.requests.length)).toBe(1)
  await page.locator('.janus-chat-sidebar-row[data-active="true"]').getByRole('button', { name: /^Delete / }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete conversation' })
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.janus-island')).toHaveAttribute('data-stage', 'expanded')
  await expect.poll(() => sessions(page)).not.toContain('memo-chat')
  expect(await sessions(page)).toHaveLength(1)
  await expect.poll(() => page.evaluate(() => (window as any).memoFixture.aborted)).toBe(1)
  await expect(page.locator('textarea.janus-chat-input')).toBeVisible()
})
