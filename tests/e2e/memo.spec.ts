import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/memo.html')
  await page.getByRole('button', { name: 'Open memo on the right' }).click()
  await page.getByRole('button', { name: 'A', exact: true }).click()
})

test('memo supports star-owned records and shows an empty state after deleting the last star', async ({ page }) => {
  const panel = page.getByRole('complementary', { name: 'Milestone memo' })
  const panelBox = await panel.boundingBox()
  const chatBox = await page.locator('.janus-chat').boundingBox()
  expect(panelBox!.x + panelBox!.width).toBeLessThan(chatBox!.x)
  await page.getByRole('button', { name: 'Add star', exact: true }).click()
  await page.getByRole('dialog').getByRole('textbox').fill('Foundation')
  await page.getByRole('dialog').getByRole('button', { name: 'OK', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Node title' })).toHaveValue('Foundation')
  await page.getByRole('textbox', { name: 'Version or time label' }).fill('v1.0')
  await page.getByRole('textbox', { name: 'Version or time label' }).press('Enter')
  await expect(page.getByRole('tab', { name: 'Foundation', exact: true })).toContainText('v1.0')
  await page.getByRole('button', { name: 'Add point' }).click()
  await page.getByRole('dialog').getByRole('textbox').fill('Keep this idea')
  await page.getByRole('dialog').getByRole('button', { name: 'OK', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Point text' })).toHaveValue('Keep this idea')
  await page.locator('.memo-point').hover()
  await page.getByLabel('Record actions', { exact: true }).click()
  await page.getByRole('combobox', { name: 'Move to node' }).click()
  await expect(page.getByRole('listbox', { name: 'Move to node' }).getByRole('option')).toHaveCount(1)
  await page.getByRole('combobox', { name: 'Move to node' }).press('Escape')
  await page.getByRole('tab', { name: 'Foundation', exact: true }).click()
  await expect(page.locator('.memo-node').getByRole('textbox', { name: 'Point text' })).toHaveValue('Keep this idea')
  await page.locator('.memo-node-actions > summary').click()
  await page.getByRole('button', { name: 'Delete star', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('all records (1)')
  await page.getByRole('dialog').getByRole('button', { name: 'OK', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Point text' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Add point' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Add the first star' })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Open memo on the right' }).click()
  await page.getByRole('button', { name: 'A', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Memo title' })).toHaveValue('A')
  await expect(page.getByRole('textbox', { name: 'Point text' })).toHaveCount(0)
})

test('switching memos ends the session and binds the new one', async ({ page }) => {
  await page.getByRole('button', { name: 'A', exact: true }).click()
  await page.evaluate(() => (window as any).memoFixture.send('Record A'))
  await expect(page.getByTestId('reply')).toHaveText('Reply 1')
  // Switching to another memo ends this session: a fresh session is opened and
  // the ended one stays in the list, still carrying its own memo.
  await page.getByRole('button', { name: 'B', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).memoFixture.sessions.length)).toBe(2)
  const sessions = await page.evaluate(() => (window as any).memoFixture.sessions.map((session: any) => session.memoId))
  expect(sessions).toEqual(['00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001'])
  await page.evaluate(() => (window as any).memoFixture.send('Record B'))
  await expect(page.getByTestId('reply')).toHaveText('Reply 2')
  const result = await page.evaluate(() => (window as any).memoFixture.requests.map((request: any) => request.memoBinding?.memoId))
  expect(result).toEqual(['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'])
  expect(await page.evaluate(() => (window as any).memoFixture.aborted)).toBe(0)
})

test('manual draft is retained when a model update conflicts', async ({ page }) => {
  const title = page.getByRole('textbox', { name: 'Memo title' })
  await title.fill('My draft')
  await page.evaluate(() => (window as any).memoFixture.modelUpdate('00000000-0000-4000-8000-000000000001', 'Model title'))
  await expect(page.getByRole('button', { name: 'Model title', exact: true })).toBeVisible()
  await title.press('Enter')
  await expect(page.getByRole('alert')).toContainText('Content changed')
  await expect(title).toHaveValue('My draft')
  expect(await page.evaluate(() => (window as any).memoFixture.memos[0].title)).toBe('Model title')
  await page.getByRole('button', { name: 'Save Memo title' }).click()
  await expect(page.getByRole('button', { name: 'My draft', exact: true })).toBeVisible()
})

test('creates and deletes a memo without a workspace', async ({ page }) => {
  await page.getByRole('button', { name: 'New memo', exact: true }).click()
  await page.getByRole('dialog').getByRole('textbox').fill('Cross-project plan')
  await page.getByRole('dialog').getByRole('button', { name: 'OK', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Memo title' })).toHaveValue('Cross-project plan')
  // Every file row carries its own delete button, so scope to this memo's row.
  const row = page.locator('.memo-file-row').filter({ has: page.getByRole('button', { name: 'Cross-project plan', exact: true }) })
  await row.getByRole('button', { name: 'Delete memo', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'OK', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Cross-project plan', exact: true })).toHaveCount(0)
})

test('explicitly leaving the memo opens a new session', async ({ page }) => {
  await page.getByRole('button', { name: 'A', exact: true }).click()
  await page.evaluate(() => (window as any).memoFixture.send('Record A'))
  await expect(page.getByTestId('reply')).toHaveText('Reply 1')
  await page.getByRole('button', { name: 'Leave memo', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).memoFixture.sessions.length)).toBe(2)
  // The ended session keeps its memo; the new one has none.
  const sessions = await page.evaluate(() => (window as any).memoFixture.sessions.map((session: any) => session.memoId))
  expect(sessions).toEqual([undefined, '00000000-0000-4000-8000-000000000001'])
  await page.evaluate(() => (window as any).memoFixture.send('No memo now'))
  await expect(page.getByTestId('reply')).toHaveText('Reply 2')
  expect(await page.evaluate(() => (window as any).memoFixture.requests.at(-1).memoBinding)).toBeUndefined()
})

test('panel stays inside a narrow viewport instead of running off the edge', async ({ page }) => {
  const panel = page.getByRole('complementary', { name: 'Milestone memo' })
  // The host is pinned at left 500, so a 400px window has no room beside it and
  // the panel has to clamp into the viewport instead of hanging off the edge.
  await page.setViewportSize({ width: 400, height: 600 })
  await expect.poll(async () => {
    const box = await panel.boundingBox()
    return box ? box.x + box.width : -1
  }).toBeLessThanOrEqual(400)
  const box = await panel.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(400)
})

test('stays a top-level float over a scaled main interface', async ({ page }) => {
  await page.goto('/memo.html?scaled=1')
  await page.getByRole('button', { name: 'Open memo on the right' }).click()
  await page.getByRole('button', { name: 'A', exact: true }).click()
  const panel = page.getByRole('complementary', { name: 'Milestone memo' })
  await expect(panel).toBeVisible()
  await panel.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => undefined))) })
  // The host surface is scaled and shifted; the panel docks at its visual right
  // edge with the fixed 12px gap instead of sliding under it.
  const panelBox = (await panel.boundingBox())!
  const chatBox = (await page.locator('.janus-chat').boundingBox())!
  const gap = chatBox.x - (panelBox.x + panelBox.width)
  expect(gap).toBeGreaterThanOrEqual(0)
  expect(gap).toBeLessThanOrEqual(16)
  // Top-level: neither the chrome bar (z 9999, same tier as the app titlebar)
  // nor the command dropdown tier (z 10050) may cover the panel.
  const points = [
    [panelBox.x + panelBox.width / 2, panelBox.y + 8],
    [panelBox.x + 40, panelBox.y + 210]
  ]
  for (const [x, y] of points) {
    const onPanel = await page.evaluate(([px, py]) => Boolean(document.elementFromPoint(px, py)?.closest('.memo-panel')), [x, y])
    expect(onPanel).toBe(true)
  }
})
