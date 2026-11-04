import { expect, test, type Page } from '@playwright/test'

async function openMemo(page: Page) {
  await page.goto('/memo.html?island=1')
  await page.getByRole('button', { name: 'Open memo on the right' }).click()
  await page.getByRole('button', { name: 'A', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Memo title' })).toHaveValue('A')
}

async function checkBounds(page: Page, width: number, height: number) {
  const main = (await page.locator('.janus-island-shell').boundingBox())!
  const memo = (await page.locator('.memo-panel').boundingBox())!
  for (const box of [main, memo]) {
    expect(box.x).toBeGreaterThanOrEqual(12)
    expect(box.y).toBeGreaterThanOrEqual(12)
    expect(box.x + box.width).toBeLessThanOrEqual(width - 12)
    expect(box.y + box.height).toBeLessThanOrEqual(height - 12)
  }
  return { main, memo }
}

test('joint cluster fits ordinary and minimum windows with readable memo and usable controls', async ({ page }) => {
  await openMemo(page)
  await page.getByRole('button', { name: 'Add star', exact: true }).click()
  await page.getByRole('dialog').getByRole('textbox').fill('A long milestone title with a version label')
  await page.getByRole('dialog').getByRole('button', { name: 'OK', exact: true }).click()
  await page.getByRole('button', { name: 'Add point' }).click()
  await page.getByRole('dialog').getByRole('textbox').fill('A record that must stay readable and editable when the main interface shrinks.')
  await page.getByRole('dialog').getByRole('button', { name: 'OK', exact: true }).click()
  for (const [width, height, mode] of [[1920, 900, 'parallel'], [1400, 900, 'parallel'], [1280, 720, 'parallel'], [1024, 600, 'compact'], [1000, 600, 'compact']] as const) {
    await page.setViewportSize({ width, height })
    await expect(page.locator('.memo-panel')).toHaveAttribute('data-layout', mode)
    const { main, memo } = await checkBounds(page, width, height)
    expect(memo.x - main.x - main.width).toBe(56)
    expect((main.x + memo.x + memo.width) / 2).toBe(width / 2)
    const content = (await page.locator('.memo-content').boundingBox())!
    expect(content.width).toBeGreaterThanOrEqual(250)
    if (width <= 1024) {
      await expect(page.getByRole('button', { name: 'Select conversation' })).toBeVisible()
      expect((await page.locator('textarea.janus-chat-input').boundingBox())!.width).toBeGreaterThan(400)
    }
    const field = page.getByRole('textbox', { name: 'Point text' })
    await field.scrollIntoViewIfNeeded()
    await page.locator('.memo-point').hover()
    if (await page.locator('.memo-point-menu').getAttribute('open') === null) await page.getByLabel('Record actions', { exact: true }).click()
    expect((await field.boundingBox())!.width).toBeGreaterThan(175)
    const overflow = await page.locator('.memo-point-actions').evaluate(element => element.scrollWidth > element.clientWidth)
    expect(overflow).toBe(false)
    for (const control of [page.getByRole('button', { name: 'Leave memo' }), page.getByRole('combobox', { name: 'Move to node' }), page.getByRole('button', { name: 'Remove point' })]) {
      await control.scrollIntoViewIfNeeded()
      const box = (await control.boundingBox())!
      expect(await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('.memo-panel')), { x: box.x + box.width / 2, y: box.y + box.height / 2 })).toBe(true)
    }
  }
})

test('automatic fold recovers and constrained files remain available in a drawer', async ({ page }) => {
  await openMemo(page)
  await page.setViewportSize({ width: 1000, height: 600 })
  await page.getByRole('button', { name: 'Expand memo files' }).click()
  await expect(page.locator('.memo-files')).toHaveAttribute('data-drawer', 'true')
  await page.getByRole('button', { name: 'B', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Memo title' })).toHaveValue('B')
  await expect(page.locator('.memo-files')).toHaveCount(0)
  await page.setViewportSize({ width: 1400, height: 900 })
  await expect(page.locator('.memo-files')).toHaveAttribute('data-drawer', 'false')
  await expect(page.getByRole('button', { name: 'Collapse conversation list' })).toBeVisible()
  await page.getByRole('button', { name: 'Collapse memo files' }).click()
  await page.setViewportSize({ width: 1000, height: 600 })
  await page.setViewportSize({ width: 1400, height: 900 })
  await expect(page.getByRole('button', { name: 'Expand memo files' })).toBeVisible()
  await expect(page.locator('.memo-panel')).toHaveAttribute('data-layout', 'parallel')
})

test('height decides stacking or focus mode, and switches keep the current stream and binding', async ({ page }) => {
  await openMemo(page)
  const activeId = await page.evaluate(() => (window as any).memoFixture.activeId)
  await page.evaluate(() => (window as any).memoFixture.send('Keep this turn running'))
  await expect.poll(() => page.evaluate(() => (window as any).memoFixture.sessions[0].isStreaming)).toBe(true)
  await page.setViewportSize({ width: 800, height: 900 })
  await expect(page.locator('.memo-panel')).toHaveAttribute('data-layout', 'stacked')
  const { main, memo } = await checkBounds(page, 800, 900)
  expect(memo.y - main.y - main.height).toBe(12)
  await page.getByRole('textbox', { name: 'Memo title' }).focus()
  await page.setViewportSize({ width: 800, height: 600 })
  await expect(page.locator('.memo-panel')).toHaveAttribute('data-layout', 'focus')
  await expect(page.locator('.janus-island-shell')).toHaveJSProperty('inert', true)
  await expect(page.locator('.janus-island-shell')).toHaveCSS('opacity', '0')
  const switcher = page.getByRole('group', { name: 'Chat and memo views' })
  await switcher.getByRole('button', { name: 'Chat', exact: true }).click()
  await expect(page.locator('.memo-panel')).toBeHidden()
  await expect(page.locator('.janus-island-shell')).toHaveJSProperty('inert', false)
  await switcher.getByRole('button', { name: 'Memo', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Memo title' })).toHaveValue('A')
  expect(await page.evaluate(() => ({ activeId: (window as any).memoFixture.activeId, aborted: (window as any).memoFixture.aborted, sessions: (window as any).memoFixture.sessions.length }))).toEqual({ activeId, aborted: 0, sessions: 1 })
  await page.evaluate(() => (window as any).memoFixture.finish())
  await expect.poll(() => page.evaluate(() => (window as any).memoFixture.sessions[0].isStreaming)).toBe(false)
})

test('dirty conflict draft and caret survive resize, view hiding and recovery', async ({ page }) => {
  await openMemo(page)
  const title = page.getByRole('textbox', { name: 'Memo title' })
  await title.fill('My unsaved draft')
  await page.evaluate(() => (window as any).memoFixture.modelUpdate('00000000-0000-4000-8000-000000000001', 'Model title'))
  await title.press('Enter')
  await expect(page.getByRole('alert')).toContainText('Content changed')
  await title.focus()
  await title.evaluate((input: HTMLInputElement) => input.setSelectionRange(3, 7))
  await page.setViewportSize({ width: 1000, height: 600 })
  await page.setViewportSize({ width: 800, height: 600 })
  await expect(title).toHaveValue('My unsaved draft')
  await expect(title).toBeFocused()
  expect(await title.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd])).toEqual([3, 7])
  expect(await page.evaluate(() => (window as any).memoFixture.memos[0].title)).toBe('Model title')
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.locator('textarea.janus-chat-input').press('Escape')
  await expect(page.locator('.memo-panel')).toBeHidden()
  await expect(page.locator('.janus-island-shell')).not.toHaveAttribute('data-memo-layout', /.+/)
  await page.getByTestId('reopen').click()
  await expect(title).toHaveValue('My unsaved draft')
  await expect(page.locator('.memo-panel')).toBeVisible()
})

test('memo dialogs and keyboard navigation stay with the companion, leaving restores main geometry', async ({ page }) => {
  await openMemo(page)
  await page.getByRole('textbox', { name: 'Memo title' }).press('Tab')
  await expect(page.locator('[data-selection-menu]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Add star', exact: true }).click()
  await page.getByRole('dialog').getByRole('textbox').fill('Dialog draft')
  await page.getByRole('dialog').getByRole('textbox').press('Tab')
  await expect(page.locator('[data-selection-menu]')).toHaveCount(0)
  await expect(page.locator('.janus-island-shell')).toHaveAttribute('data-stage', 'expanded')
  await page.getByRole('dialog').press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.janus-island-shell')).toHaveAttribute('data-stage', 'expanded')
  await page.locator('.memo-shell-header').getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.locator('.memo-panel')).toHaveCount(0)
  await expect(page.locator('.janus-island-cluster')).not.toHaveAttribute('data-memo-layout', /.+/)
  await expect.poll(async () => (await page.locator('.janus-island-shell').boundingBox())?.width).toBe(860)
  const main = (await page.locator('.janus-island-shell').boundingBox())!
  expect(main.x + main.width / 2).toBe(640)
})

test('entering focus mode keeps an active chat editor visible', async ({ page }) => {
  await openMemo(page)
  const input = page.locator('textarea.janus-chat-input')
  await input.fill('Continue my draft')
  await page.setViewportSize({ width: 800, height: 600 })
  await expect(page.getByRole('group', { name: 'Chat and memo views' }).getByRole('button', { name: 'Chat', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(input).toBeFocused()
  await expect(input).toHaveValue('Continue my draft')
})

test('closing the right companion keeps binding and draft; leaving is explicit', async ({ page }) => {
  await openMemo(page)
  const title = page.getByRole('textbox', { name: 'Memo title' })
  await title.fill('Unsaved title')
  await expect(page.locator('.memo-panel')).toHaveAttribute('data-side', 'right')
  await page.locator('.memo-shell-header').getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.locator('.memo-panel')).toHaveCount(0)
  const binding = () => page.evaluate(() => {
    const f = (window as any).memoFixture
    return f.sessions.find((s: any) => s.id === f.activeId)?.memoId
  })
  expect(await binding()).toBe('00000000-0000-4000-8000-000000000001')
  await page.getByRole('button', { name: 'Open memo on the right' }).click()
  await expect(title).toHaveValue('Unsaved title')
  await page.getByRole('button', { name: 'Leave memo', exact: true }).click()
  await expect.poll(binding).toBeUndefined()
  await expect(page.locator('.memo-panel')).toBeVisible()
})
