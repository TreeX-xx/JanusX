import { expect, test, type Page, type Locator } from '@playwright/test'

async function seed(page: Page, count = 100) {
  await page.goto('/codex-conversation.html?initialView=conversation')
  await page.getByRole('combobox', { name: 'Message Codex' }).waitFor()
  await page.evaluate(count => {
    const items = Array.from({ length: count }, (_, index) => [
    { id: `input-${index}`, turnId: `turn-${index}`, type: 'userMessage', text: index === 30 || index === 31 ? 'Repeated input' : `Question ${index}`, status: 'completed' },
    ...(index === 30 ? [{ id: 'same-turn', turnId: 'turn-30', type: 'userMessage', text: 'Same turn second input', status: 'completed' }] : []),
    { id: `answer-${index}`, turnId: `turn-${index}`, type: 'agentMessage', text: `## Answer ${index}\n\n` + 'A detailed answer with several lines. '.repeat(40), status: 'completed' },
    ]).flat()
    Object.assign(window, { navigationFixtureItems: items })
    ;(window as any).codexFixture.progressSnapshot({ turnId: null, items })
  }, count)
}

async function choose(page: Page | Locator, number: number) {
  const nav = page.getByRole('navigation', { name: 'Navigate inputs' })
  await expect.poll(() => nav.evaluate(root => root.firstElementChild!.children.length === Math.min(Number(root.getAttribute('data-input-count')), Math.max(1, Math.floor((root.getBoundingClientRect().height - 24) / 18))))).toBe(true)
  const ticks = nav.locator('> div').first().getByRole('button')
  const starts = await ticks.evaluateAll(buttons => buttons.map(button => Number(button.getAttribute('aria-label')!.split(' ')[1])))
  const group = Math.max(0, starts.findLastIndex(start => start <= number))
  const dense = await ticks.nth(group).getAttribute('aria-haspopup')
  await ticks.nth(group).click()
  const dialog = nav.getByRole('dialog')
  if (dense) await dialog.getByRole('button', { name: `Input ${number}`, exact: true }).click()
}

async function aligned(page: Page, id: string) {
  const message = page.locator(`[data-user-message="${id}"]`)
  await expect(message).toBeInViewport()
  await expect.poll(() => message.evaluate(message => {
    const scroll = message.closest('[role=region]')!
    return Math.abs(message.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 12)
  })).toBeLessThan(3)
}

test('input ticks navigate unmounted messages by identity and pause streaming follow', async ({ page }) => {
  await seed(page)
  const nav = page.getByRole('navigation', { name: 'Navigate inputs' })
  await expect(page.locator('[data-user-message="input-30"]')).toHaveCount(0)
  await choose(page, 31)
  await aligned(page, 'input-30')
  await expect(nav.getByRole('button', { current: 'step' }).first()).toBeVisible()
  await choose(page, 32)
  await aligned(page, 'same-turn')
  // Late content above a second input changes the measured row height.
  await page.evaluate(() => {
    const items = (window as any).navigationFixtureItems
    items.find((item: { id: string }) => item.id === 'input-30').text += '\n\n' + 'Late content\n'.repeat(30)
    ;(window as any).codexFixture.progressSnapshot({ turnId: null, items })
  })
  await aligned(page, 'same-turn')
  await choose(page, 33)
  await aligned(page, 'input-31')
  const before = await page.locator('[data-user-message="input-31"]').boundingBox()
  await page.evaluate(() => (window as any).codexFixture.delta('\n\nLive output while reading.'))
  await aligned(page, 'input-31')
  expect(Math.abs((await page.locator('[data-user-message="input-31"]').boundingBox())!.y - before!.y)).toBeLessThan(3)
  expect(await page.locator('[data-history-key]').count()).toBeLessThan(18)
  await page.getByRole('button', { name: 'Back to latest' }).click()
  await expect.poll(() => page.locator('[data-virtual-history]').evaluate(root => {
    const scroll = root.closest('[role=region]')!
    return scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight
  })).toBeLessThan(3)
  // Hover is a preview, never a scroll action.
  const last = await page.locator('[data-user-message="input-99"]').boundingBox()
  await nav.getByRole('button').first().hover()
  await expect(nav.getByRole('tooltip')).toContainText('Question 0')
  expect((await page.locator('[data-user-message="input-99"]').boundingBox())!.y).toBe(last!.y)
  await page.screenshot({ path: 'artifacts/input-navigation/normal.png' })
})

test('navigation fits narrow and short pane containers, restores after resize, and cancels on manual reading', async ({ page }) => {
  await seed(page)
  const pane = page.locator('section').filter({ has: page.getByRole('navigation', { name: 'Navigate inputs' }) }).first()
  await pane.evaluate(pane => { pane.style.width = '230px'; pane.style.height = '400px' })
  await choose(page, 51)
  await aligned(page, 'input-49')
  const nav = page.getByRole('navigation', { name: 'Navigate inputs' })
  await nav.getByRole('button').first().click()
  const popup = nav.getByRole('dialog')
  await expect(popup).toBeVisible()
  const bounds = await pane.boundingBox(), box = await popup.boundingBox()
  expect(box!.x + box!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width)
  expect(box!.y + box!.height).toBeLessThanOrEqual((await nav.boundingBox())!.y + (await nav.boundingBox())!.height)
  await popup.getByRole('button').first().press('Escape')
  await expect(popup).toHaveCount(0)
  await choose(page, 60)
  await aligned(page, 'input-58')
  await pane.evaluate(pane => { pane.style.width = '350px'; pane.style.height = '520px' })
  await aligned(page, 'input-58')
  await page.mouse.move(bounds!.x + 120, bounds!.y + 100)
  await page.mouse.wheel(0, -350)
  await expect.poll(() => page.locator('[data-user-message="input-58"]').evaluate(message => Math.abs(message.getBoundingClientRect().top - message.closest('[role=region]')!.getBoundingClientRect().top - 12))).toBeGreaterThan(10)
  await pane.evaluate(pane => { pane.style.width = '230px'; pane.style.height = '300px' })
  await expect.poll(() => nav.getByRole('button').count()).toBeLessThan(10)
  await nav.getByRole('button').first().click()
  await expect(nav.getByRole('dialog')).toBeVisible()
  await page.screenshot({ path: 'artifacts/input-navigation/narrow-short.png' })
})

test('short histories, latest input and hidden views retain draft and navigation state boundaries', async ({ page }) => {
  await seed(page, 4)
  const editor = page.getByRole('combobox', { name: 'Message Codex' })
  await editor.fill('Keep this draft')
  await choose(page, 1)
  await aligned(page, 'input-0')
  await choose(page, 4)
  await expect(page.locator('[data-user-message="input-3"]')).toBeInViewport()
  await page.getByRole('button', { name: 'Terminal', exact: true }).click()
  await expect(page.getByRole('navigation', { name: 'Navigate inputs' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Conversation', exact: true }).click()
  await expect(editor).toHaveText('Keep this draft')
  await choose(page, 2)
  await aligned(page, 'input-1')
})

for (const split of ['side', 'stacked']) test(`two ${split} panes isolate navigation, previews, reading and drafts`, async ({ page }) => {
  await page.setViewportSize({ width: split === 'side' ? 460 : 800, height: 740 })
  await page.goto(`/codex-conversation.html?initialView=conversation&split=${split}&theme=light`)
  const first = page.locator('[data-fixture-pane=first]'), second = page.locator('[data-fixture-pane=second]')
  await first.getByRole('combobox').waitFor()
  await page.evaluate(() => (window as any).codexFixture.longHistory())
  await expect(second.locator('[data-live-tail]')).toContainText('Result 99')
  await second.getByRole('combobox').fill('Other pane draft')
  // Explicitly establish following after loading the large history fixture.
  const latest = second.getByRole('button', { name: 'Back to latest' })
  if (await latest.count()) await latest.click()
  await expect.poll(() => second.getByRole('region').evaluate(scroll => scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight)).toBeLessThan(3)
  const before = await second.getByRole('region').evaluate(scroll => scroll.scrollTop)
  await choose(first, 31)
  const target = first.locator('[data-user-message="long-user-30"]')
  await expect(target).toBeInViewport()
  await expect.poll(() => target.evaluate(message => Math.abs(message.getBoundingClientRect().top - message.closest('[role=region]')!.getBoundingClientRect().top - 12))).toBeLessThan(3)
  await expect(second.getByRole('combobox')).toHaveText('Other pane draft')
  expect(await second.getByRole('region').evaluate(scroll => scroll.scrollTop)).toBe(before)
  await page.evaluate(() => (window as any).codexFixture.delta('\n\nAnother live update.'))
  await expect.poll(() => second.getByRole('region').evaluate(scroll => scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight)).toBeLessThan(3)
  await expect(target).toBeInViewport()
  await first.getByRole('navigation').getByRole('button').first().click()
  const popup = first.getByRole('dialog')
  await expect(popup).toBeVisible()
  const box = await popup.boundingBox(), bounds = await first.getByRole('navigation').boundingBox()
  expect(box!.x + box!.width).toBeLessThanOrEqual((await first.boundingBox())!.x + (await first.boundingBox())!.width)
  expect(box!.y + box!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height)
  await expect(second.getByRole('dialog')).toHaveCount(0)
  await page.screenshot({ path: `artifacts/input-navigation/split-${split}.png` })
})
