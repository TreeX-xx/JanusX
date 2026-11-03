import { expect, test, type Locator } from '@playwright/test'

async function caretTop(input: Locator): Promise<number> {
  return input.evaluate(() => {
    const range = getSelection()!.getRangeAt(0).cloneRange()
    // Empty lines have an element boundary caret; measure their placeholder.
    if (!range.getClientRects().length && range.startContainer.nodeType === Node.ELEMENT_NODE) {
      const child = range.startContainer.childNodes[range.startOffset]
      if (child) range.selectNode(child)
    }
    const rects = [...range.getClientRects()]
    if (!rects.length) throw new Error('Caret has no visible line')
    return Math.max(...rects.map(rect => rect.top))
  })
}

for (const shortcut of ['Control+j', 'Shift+Enter']) {
  test(`${shortcut} moves to a new line on the first press and preserves exact text`, async ({ page }) => {
    await page.goto('/codex-conversation.html?initialView=conversation')
    const input = page.getByRole('combobox', { name: 'Message Codex', exact: true })
    await input.fill('first')
    const before = await caretTop(input)
    await input.press(shortcut)
    expect(await caretTop(input)).toBeGreaterThan(before + 10)
    await input.pressSequentially('second')
    await input.press(shortcut)
    await input.press(shortcut)
    await input.pressSequentially('fourth')
    await input.press('Enter')
    expect(await page.evaluate(() => (window as any).codexFixture.calls.sends)).toEqual(['first\nsecond\n\nfourth'])
  })
}

test('newline in an empty draft survives undo, redo and remount without an extra blank line', async ({ page }) => {
  await page.goto('/codex-conversation.html?initialView=conversation')
  const input = page.getByRole('combobox', { name: 'Message Codex', exact: true })
  await input.press('Control+j')
  await input.pressSequentially('second')
  await input.press('Control+j')
  const beforeUndo = await input.innerText()
  await input.press('Control+z')
  await expect.poll(() => input.innerText()).not.toBe(beforeUndo)
  await input.press('Control+Shift+z')
  await expect.poll(() => input.innerText()).toBe(beforeUndo)
  await page.getByRole('button', { name: 'Remount', exact: true }).click()
  await input.press('Control+End')
  await input.pressSequentially('third')
  await input.press('Enter')
  expect(await page.evaluate(() => (window as any).codexFixture.calls.sends)).toEqual(['\nsecond\nthird'])
})

test('arrows edit wrapped lines before recalling history and allow editing a recalled entry', async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 780 })
  await page.goto('/codex-conversation.html?initialView=conversation')
  const input = page.getByRole('combobox', { name: 'Message Codex', exact: true })
  await input.fill('older history'); await input.press('Enter')
  await page.evaluate(() => (window as any).codexFixture.finish())
  const wrapped = 'A long paragraph with wrapping words to move the cursor within the second visual line without any newline characters.'
  await input.fill(wrapped); await input.press('Enter')
  await page.evaluate(() => (window as any).codexFixture.finish())
  const draft = wrapped + ' Keep this draft.'
  await input.fill(draft)
  await input.press('Control+Home')
  await input.press('ArrowDown')
  await input.press('ArrowRight')
  const secondLine = await caretTop(input)
  await input.press('ArrowUp')
  await expect(input).toHaveText(draft)
  expect(await caretTop(input)).toBeLessThan(secondLine - 10)
  await input.press('ArrowUp')
  await expect(input).toHaveText(wrapped)
  await input.press('ArrowDown')
  await input.press('ArrowRight')
  await expect(input).toHaveText(wrapped)
  await input.press('ArrowUp')
  await expect(input).toHaveText(wrapped)
  await input.press('Control+End')
  await input.press('ArrowDown')
  await expect(input).toHaveText(draft)
  await input.fill('first')
  await input.press('Control+j')
  await input.pressSequentially('second')
  await input.press('ArrowUp')
  await expect(input).toHaveText('first\nsecond', { useInnerText: true })
  expect(await page.evaluate(() => (window as any).codexFixture.calls.sends)).toEqual(['older history', wrapped])
})
