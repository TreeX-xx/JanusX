import { expect, test, type Page } from '@playwright/test'

async function attach(page: Page, name: string) {
  await page.getByRole('button', { name: 'Attach workspace' }).click()
  await page.getByRole('option', { name, exact: true }).click()
  await expect(page.getByRole('button', { name: `Remove ${name}`, exact: true })).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/memo.html?island=1&workspaces=1')
  await page.getByRole('button', { name: 'Open memo on the right' }).click()
  await page.getByRole('button', { name: 'A', exact: true }).click()
})

test('Chat resources change without memo writes or interrupting the bound conversation', async ({ page }) => {
  const before = await page.evaluate(() => ({ memo: structuredClone((window as any).memoFixture.memos[0]), id: (window as any).memoFixture.activeId }))
  await page.evaluate(() => (window as any).memoFixture.send('Keep running'))
  await attach(page, 'JanusX')
  await attach(page, 'AgentX')
  await page.getByRole('button', { name: 'Remove JanusX', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Remove JanusX', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => structuredClone((window as any).memoFixture.memos[0]))).toEqual(before.memo)
  expect(await page.evaluate(() => ({ id: (window as any).memoFixture.activeId, sessions: (window as any).memoFixture.sessions.length, aborted: (window as any).memoFixture.aborted }))).toEqual({ id: before.id, sessions: 1, aborted: 0 })
  await page.evaluate(() => (window as any).memoFixture.finish())
})

test('creation and file selection keep workspace resources solely in Chat', async ({ page }) => {
  await attach(page, 'JanusX')
  await page.getByRole('button', { name: 'New memo', exact: true }).click()
  await page.getByRole('dialog').getByRole('textbox').fill('Independent plan')
  await page.getByRole('dialog').getByRole('button', { name: 'OK', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Memo title' })).toHaveValue('Independent plan')
  expect(await page.evaluate(() => (window as any).memoFixture.memos.find((memo: any) => memo.title === 'Independent plan'))).not.toHaveProperty('workspaces')
  await page.getByRole('button', { name: 'B', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Remove JanusX', exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as any).memoFixture.memos[1].revision)).toBe(0)
})

test('a memo persistence failure cannot prevent Chat resource changes', async ({ page }) => {
  await page.evaluate(() => { (window as any).electron.memo.edit = async () => { throw new Error('Disk full') } })
  await attach(page, 'JanusX')
  await expect(page.locator('.janus-chat-error-card')).toHaveCount(0)
  await page.getByRole('button', { name: 'Remove JanusX', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Remove JanusX', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).memoFixture.memos[0].revision)).toBe(0)
})
