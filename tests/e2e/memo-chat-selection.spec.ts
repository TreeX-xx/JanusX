import { expect, test, type Page } from '@playwright/test'

async function bindings(page: Page) {
  return page.evaluate(() => (window as any).memoFixture.requests.map((request: any) => request.memoBinding))
}
async function send(page: Page) {
  const count = (await bindings(page)).length
  await page.evaluate(() => (window as any).memoFixture.send('Record this in the current star'))
  await expect.poll(async () => (await bindings(page)).length).toBe(count + 1)
}
async function finish(page: Page) {
  await page.evaluate(() => (window as any).memoFixture.finish())
  await expect(page.locator('main.janus-chat')).toHaveAttribute('data-streaming', 'false')
}

test.beforeEach(async ({ page }) => {
  // Keep the standalone fixture's file navigation expanded for selection checks.
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/memo.html')
  await page.getByRole('button', { name: 'Open memo on the right' }).click()
  await page.getByRole('button', { name: 'A', exact: true }).click()
  await page.evaluate(async () => {
    const memo = (window as any).memoFixture.memos[0]
    await window.electron.memo!.edit(memo.id, { expectedRevision: memo.revision, operations: [{ op: 'addNode', title: 'First' }, { op: 'addNode', title: 'Second' }] })
  })
  await expect(page.getByRole('textbox', { name: 'Node title' })).toHaveValue('First')
})

test('snapshots the selected star for sends and steering while retaining selection when hidden', async ({ page }) => {
  const ids = await page.evaluate(() => (window as any).memoFixture.memos[0].nodes.map((node: any) => node.id))
  await page.getByRole('tab', { name: 'First', exact: true }).press('ArrowRight')
  await send(page)
  expect((await bindings(page))[0].selectedNodeId).toBe(ids[1])
  await page.getByRole('tab', { name: 'Second', exact: true }).press('ArrowLeft')
  await page.evaluate(() => (window as any).memoFixture.send('Also record this in the current star'))
  await expect.poll(() => page.evaluate(() => (window as any).memoFixture.steers.length)).toBe(1)
  const steered = await page.evaluate(() => (window as any).memoFixture.steers[0])
  expect(steered.memoBinding).toMatchObject({ selectedNodeId: ids[0], messageId: steered.entryId })
  expect((await bindings(page))[0].selectedNodeId).toBe(ids[1])
  await finish(page)
  await page.getByRole('button', { name: 'Open memo on the right' }).click()
  await expect(page.locator('.memo-panel')).toHaveCount(0)
  await send(page)
  expect((await bindings(page))[1].selectedNodeId).toBe(ids[0])
})

test('keeps per-file selections and sends null for an empty file without altering the previous turn', async ({ page }) => {
  const selectedId = await page.evaluate(() => (window as any).memoFixture.memos[0].nodes[1].id)
  await page.getByRole('tab', { name: 'First', exact: true }).press('ArrowRight')
  await send(page)
  await finish(page)
  await page.getByRole('button', { name: 'B', exact: true }).click()
  await send(page)
  expect((await bindings(page))[1]).toMatchObject({ memoId: '00000000-0000-4000-8000-000000000002', selectedNodeId: null })
  await finish(page)
  await page.getByRole('button', { name: 'A', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Node title' })).toHaveValue('Second')
  await send(page)
  expect((await bindings(page)).map((binding: any) => binding.selectedNodeId)).toEqual([selectedId, null, selectedId])
})

test('retains the send-time selection when a late steering rejection falls back to a new turn', async ({ page }) => {
  const ids = await page.evaluate(() => (window as any).memoFixture.memos[0].nodes.map((node: any) => node.id))
  await page.getByRole('tab', { name: 'First', exact: true }).press('ArrowRight')
  await send(page)
  await page.getByRole('tab', { name: 'Second', exact: true }).press('ArrowLeft')
  await page.evaluate(() => {
    window.electron.llm.steerChat = () => new Promise(resolve => { (window as any).rejectMemoSteer = () => resolve({ accepted: false }) })
    ;(window as any).memoFixture.send('A late followup for the current star')
  })
  await page.getByRole('tab', { name: 'First', exact: true }).press('ArrowRight')
  await finish(page)
  await page.evaluate(() => (window as any).rejectMemoSteer())
  await expect.poll(async () => (await bindings(page)).length).toBe(2)
  expect((await bindings(page)).map((binding: any) => binding.selectedNodeId)).toEqual([ids[1], ids[0]])
  await expect(page.getByRole('textbox', { name: 'Node title' })).toHaveValue('Second')
})

test('uses the visible fallback only for new messages after a selected node is deleted', async ({ page }) => {
  const ids = await page.evaluate(() => (window as any).memoFixture.memos[0].nodes.map((node: any) => node.id))
  await page.getByRole('tab', { name: 'First', exact: true }).press('ArrowRight')
  await send(page)
  await page.evaluate(async () => {
    const memo = (window as any).memoFixture.memos[0]
    await window.electron.memo!.edit(memo.id, { expectedRevision: memo.revision, operations: [{ op: 'removeNode', nodeId: memo.nodes[1].id }] })
  })
  await expect(page.getByRole('textbox', { name: 'Node title' })).toHaveValue('First')
  await finish(page)
  await send(page)
  expect((await bindings(page)).map((binding: any) => binding.selectedNodeId)).toEqual([ids[1], ids[0]])
  await finish(page)
  await page.evaluate(async () => {
    const memo = (window as any).memoFixture.memos[0]
    await window.electron.memo!.edit(memo.id, { expectedRevision: memo.revision, operations: [{ op: 'removeNode', nodeId: memo.nodes[0].id }] })
  })
  await expect(page.getByRole('textbox', { name: 'Node title' })).toHaveCount(0)
  await send(page)
  expect((await bindings(page))[2].selectedNodeId).toBeNull()
})
