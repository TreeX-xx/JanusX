import { expect, test, type Locator } from '@playwright/test'

async function scroll(history: Locator, position: 'top' | 'middle' | 'bottom') {
  await history.evaluate((root, position) => {
    let container = root.parentElement!
    while (!['auto', 'scroll'].includes(getComputedStyle(container).overflowY)) container = container.parentElement!
    container.scrollTop = position === 'top' ? 0 : position === 'bottom' ? container.scrollHeight : container.scrollHeight / 2
    container.dispatchEvent(new Event('scroll'))
  }, position)
}

async function anchor(history: Locator, key?: string) {
  return history.evaluate((root, key) => {
    let container = root.parentElement!
    while (!['auto', 'scroll'].includes(getComputedStyle(container).overflowY)) container = container.parentElement!
    const top = container.getBoundingClientRect().top
    const row = [...root.querySelectorAll('[data-history-key]')].find(row => key ? row.getAttribute('data-history-key') === key : row.getBoundingClientRect().bottom > top)
    return { key: row?.getAttribute('data-history-key'), offset: row ? row.getBoundingClientRect().top - top : 0 }
  }, key)
}

test('terminal history bounds mounted work, restores disclosures and holds the reader during updates', async ({ page }, info) => {
  await page.goto('/codex-conversation.html?initialView=conversation')
  await page.getByRole('combobox', { name: 'Message Codex' }).waitFor()
  await page.evaluate(() => (window as any).codexFixture.longHistory())
  const history = page.locator('[data-virtual-history]')
  await expect(history.locator('[data-live-tail]')).toContainText('Result 99')
  await expect.poll(() => history.locator('[data-history-key]').count()).toBeLessThan(15)
  await expect(history.locator('pre')).toHaveCount(0)
  await scroll(history, 'top')
  await expect(page.getByText('Review change 0', { exact: true })).toBeVisible()
  const first = history.locator('[data-history-key="long-0"]')
  await first.locator('.conversation-work-toggle').click()
  await expect(first.locator('.conversation-work-toggle')).toHaveAttribute('aria-expanded', 'true')
  const tool = first.locator('.conversation-work-body details').first()
  await expect(tool).not.toHaveAttribute('open', '')
  await tool.locator(':scope > summary').click()
  await expect(tool.locator('pre')).toContainText('Tool output')
  await tool.locator(':scope > summary').click()
  const changes = first.locator('[data-turn-files]')
  await changes.locator(':scope > summary').click()
  await changes.locator('details > summary').click()
  await expect(changes.locator('pre')).toContainText('+after')
  await scroll(history, 'middle')
  await expect(first).toHaveCount(0)
  // Wait for variable-height measurements to settle before checking a background update.
  await expect.poll(async () => (await anchor(history)).key).toMatch(/^long-/)
  await page.waitForTimeout(200)
  const before = await anchor(history)
  await page.evaluate(() => (window as any).codexFixture.delta('\n\nA new live paragraph.'))
  await expect(history.locator('[data-live-tail]')).toContainText('A new live paragraph.')
  const after = await anchor(history)
  expect(after.key).toBe(before.key)
  expect(Math.abs(after.offset - before.offset)).toBeLessThan(3)
  await page.setViewportSize({ width: 800, height: 740 })
  await expect.poll(async () => (await anchor(history)).key).toBe(before.key)
  await scroll(history, 'top')
  await expect(first.locator('.conversation-work-toggle')).toHaveAttribute('aria-expanded', 'true')
  await expect(tool).not.toHaveAttribute('open', '')
  await expect(changes.locator('pre')).toBeVisible()
  await changes.locator(':scope > summary').click()
  await expect(changes.locator('pre')).toHaveCount(0)
  await first.getByRole('button', { name: 'Edit message', exact: true }).click()
  const editor = first.getByRole('textbox', { name: 'Edit message text', exact: true })
  await editor.fill('Keep this historical edit')
  await scroll(history, 'middle')
  await expect(editor).toHaveValue('Keep this historical edit')
  await expect(editor).toBeFocused()
  await scroll(history, 'top')
  await editor.press('Escape')
  await expect(editor).toHaveCount(0)
  await page.setViewportSize({ width: 620, height: 740 })
  await expect(page.getByText('Review change 0', { exact: true })).toBeVisible()
  await scroll(history, 'bottom')
  await expect(page.getByText('Review change 99', { exact: true })).toBeVisible()
  await page.evaluate(() => (window as any).codexFixture.delta('\n\nFollowing the latest output.'))
  await expect(history.getByText('Following the latest output.', { exact: true })).toBeInViewport()
  const mounted = await history.locator('[data-history-key]').count()
  expect(mounted).toBeLessThan(15)
  await page.screenshot({ path: 'artifacts/conversation-virtual-history.png' })
  await info.attach('history-dom-budget', { body: JSON.stringify({ totalTurns: 100, totalItems: 400, mountedTurns: mounted, mountedDiffLines: await history.locator('[data-change]').count() }), contentType: 'application/json' })
})

test('shared Chat history keeps the visible message anchored when older pages are prepended', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('project-conversations', JSON.stringify({ version: 1, activeConversationId: 'long-history', conversations: [{
    id: 'long-history', title: 'Long history', createdAt: 1, updatedAt: 205, attachedWorkspaceIds: [], toolTraces: [],
    messages: Array.from({ length: 205 }, (_, index) => ({ id: String(index), role: index % 2 ? 'assistant' : 'user', content: `Archived decision ${index}\n\n` + 'Detailed historical content. '.repeat(30), timestamp: index + 1 })),
  }] })))
  await page.goto('/project.html?manual-stream')
  await page.addStyleTag({ content: '.fixture-layout {display:flex;height:620px} .fixture-layout > section {width:420px;height:620px;min-height:0} .fixture-layout .janus-chat {height:100%}' })
  const chat = page.getByTestId('main-chat'), history = chat.locator('[data-virtual-history]')
  await expect(history.locator('[data-live-tail]')).toContainText('Archived decision 204')
  await expect.poll(() => history.locator('[data-history-key]').count()).toBeLessThan(20)
  await scroll(history, 'top')
  await expect(chat.getByText('Archived decision 105', { exact: true })).toBeVisible()
  await page.waitForTimeout(200)
  const before = await anchor(history)
  await chat.getByRole('button', { name: 'Show earlier messages' }).click()
  await expect.poll(async () => (await anchor(history, before.key!)).key).toBe(before.key)
  await expect.poll(async () => Math.abs((await anchor(history, before.key!)).offset - before.offset)).toBeLessThan(4)
  await scroll(history, 'top')
  await expect(chat.getByText('Archived decision 5', { exact: true })).toBeVisible()
  await chat.getByRole('button', { name: 'Show earlier messages' }).click()
  await scroll(history, 'top')
  await expect(chat.getByText('Archived decision 0', { exact: true })).toBeVisible()
  await scroll(history, 'bottom')
  await expect.poll(() => chat.locator('.janus-chat-messages').evaluate(container => container.scrollHeight - container.scrollTop - container.clientHeight)).toBeLessThan(3)
  await expect.poll(() => history.locator('[data-history-key]').count()).toBeLessThan(20)
  await page.screenshot({ path: 'artifacts/chat-virtual-history.png' })
})
