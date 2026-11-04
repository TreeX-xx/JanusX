import { expect, test, type Page } from '@playwright/test'

async function seed(page: Page, count = 2) {
  await page.evaluate(async count => {
    const memo = (window as any).memoFixture.memos[0]
    await window.electron.memo!.edit(memo.id, { expectedRevision: memo.revision, operations: Array.from({ length: count }, (_, index) => ({ op: 'addNode' as const, title: `Node ${index + 1}`, label: `v${index + 1}` })) })
  }, count)
}

test.beforeEach(async ({ page }) => {
  await page.goto('/memo.html?island=1')
  await page.getByRole('button', { name: 'Open memo on the right' }).click()
  await page.getByRole('button', { name: 'A', exact: true }).click()
})

test('full-width navigation selects one body, retains node identity on reorder and falls back after deletion', async ({ page }) => {
  await seed(page)
  await page.getByRole('tab', { name: 'Node 2', exact: true }).click()
  const activeId = await page.evaluate(() => (window as any).memoFixture.activeId)
  await expect(page.getByRole('textbox', { name: 'Node title' })).toHaveValue('Node 2')
  await expect(page.locator('.memo-node')).toHaveCount(1)
  await page.screenshot({ path: 'artifacts/memo-analysis/constellation-dark.png' })
  await page.evaluate(() => { document.documentElement.dataset.theme = 'planche' })
  await page.screenshot({ path: 'artifacts/memo-analysis/constellation-planche.png' })
  await page.locator('.memo-node-actions > summary').click()
  await page.locator('.memo-node-actions').getByRole('button', { name: 'Move up' }).click()
  await expect(page.getByRole('tab', { name: 'Node 2', exact: true })).toHaveAttribute('aria-selected', 'true')
  const nav = (await page.locator('.memo-constellation').boundingBox())!
  const canvas = (await page.locator('.memo-canvas').boundingBox())!
  expect(nav.width).toBe(canvas.width - 2)
  await page.getByRole('button', { name: 'Delete star', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'OK', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Node 1', exact: true })).toHaveAttribute('aria-selected', 'true')
  expect(await page.evaluate(() => (window as any).memoFixture.activeId)).toBe(activeId)
})

test('conflict drafts survive node and file navigation and require an explicit retry', async ({ page }) => {
  await seed(page)
  await page.getByRole('tab', { name: 'Node 1', exact: true }).click()
  const title = page.getByRole('textbox', { name: 'Node title' })
  await title.fill('Manual draft')
  await page.evaluate(async () => {
    const memo = (window as any).memoFixture.memos[0]
    await window.electron.memo!.edit(memo.id, { expectedRevision: memo.revision, operations: [{ op: 'editNode', nodeId: memo.nodes[0].id, title: 'Model title' }] })
  })
  await page.getByRole('tab', { name: 'Node 2', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Content changed')
  await page.getByRole('button', { name: 'B', exact: true }).click()
  await page.getByRole('button', { name: 'A', exact: true }).click()
  await page.getByRole('tab', { name: 'Model title', exact: true }).click()
  await expect(title).toHaveValue('Manual draft')
  await page.getByRole('button', { name: 'Save Node title' }).click()
  await expect(page.getByRole('tab', { name: 'Manual draft', exact: true })).toHaveAttribute('aria-selected', 'true')
})

test('long navigation supports keyboard selection and reduced motion without changing the conversation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await seed(page, 20)
  const activeId = await page.evaluate(() => (window as any).memoFixture.activeId)
  const first = page.getByRole('tab', { name: 'Node 1', exact: true })
  await first.click()
  await first.press('End')
  await expect(page.getByRole('tab', { name: 'Node 20', exact: true })).toBeFocused()
  await expect(page.getByRole('textbox', { name: 'Node title' })).toHaveValue('Node 20')
  expect(Number(await page.locator('.memo-star-track').getAttribute('data-camera-y'))).toBeLessThan(0)
  expect(await page.evaluate(() => (window as any).memoFixture.activeId)).toBe(activeId)
})

test('rapid hide and reopen cancels exit, preserves drafts and clears geometry after the final hide', async ({ page }) => {
  const title = page.getByRole('textbox', { name: 'Memo title' })
  await title.fill('Unsaved title')
  await page.evaluate(() => {
    const trigger = document.querySelector<HTMLButtonElement>('.memo-trigger')!
    trigger.click()
    setTimeout(() => trigger.click(), 40)
  })
  await expect(page.locator('.memo-panel')).toHaveAttribute('data-phase', 'open')
  await expect(title).toHaveValue('Unsaved title')
  expect(await page.evaluate(() => (window as any).memoFixture.sessions.length)).toBe(1)
  await page.getByRole('button', { name: 'Open memo on the right' }).click()
  await expect(page.locator('.memo-panel')).toHaveCount(0)
  await expect(page.locator('.janus-island-cluster')).not.toHaveAttribute('data-memo-layout', /.+/)
})

test('Chinese composition does not submit the field on an IME Enter key', async ({ page }) => {
  const title = page.getByRole('textbox', { name: 'Memo title' })
  await title.fill('输入中的标题')
  await title.evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })))
  await expect(title).toBeFocused()
  expect(await page.evaluate(() => (window as any).memoFixture.memos[0].title)).toBe('A')
  await title.press('Enter')
  await expect(page.getByRole('button', { name: '输入中的标题', exact: true })).toBeVisible()
})
