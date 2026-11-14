import { expect, test, type Page, type Locator } from '@playwright/test'

async function seed(page: Page, count = 100, theme = 'dark') {
  await page.goto(`/codex-conversation.html?initialView=conversation&theme=${theme}`)
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

for (const theme of ['dark', 'planche', 'white']) {
  test(`input rail centers up to twelve ticks and scrolls independently in ${theme}`, async ({ page }) => {
    for (const count of [1, 4, 12, 13]) {
      await seed(page, count, theme)
      const nav = page.getByRole('navigation', { name: 'Navigate inputs' })
      const rail = nav.locator('> div').first()
      await expect(nav.getByRole('button')).toHaveCount(count)
      await expect.poll(() => rail.evaluate(el => el.clientHeight)).toBe(Math.min(count, 12) * 18)
      const outer = (await nav.boundingBox())!, inner = (await rail.boundingBox())!
      expect(Math.abs(inner.y + inner.height / 2 - outer.y - outer.height / 2)).toBeLessThan(1)
      if (count === 4 || count === 13) await page.screenshot({ path: test.info().outputPath(`${theme}-${count}.png`) })
    }
    await seed(page, 100, theme)
    const nav = page.getByRole('navigation', { name: 'Navigate inputs' })
    const rail = nav.locator('> div').first()
    await choose(page, 51)
    await aligned(page, 'input-49')
    await expect.poll(() => rail.evaluate(el => {
      const active = el.querySelector('[aria-current]')!
      return Math.abs(active.getBoundingClientRect().top + 9 - el.getBoundingClientRect().top - el.clientHeight / 2)
    })).toBeLessThan(2)
    const color = await nav.evaluate(el => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--interaction-accent)'
      el.append(probe)
      const color = getComputedStyle(probe).color
      probe.remove()
      return color
    })
    await expect(nav.locator('[aria-current] span')).toHaveCSS('background-color', color)
    const main = page.getByRole('region')
    const reading = await main.evaluate(el => el.scrollTop)
    const before = await rail.evaluate(el => el.scrollTop)
    await rail.hover()
    await page.mouse.wheel(0, 180)
    await expect.poll(() => rail.evaluate(el => el.scrollTop)).toBeGreaterThan(before + 50)
    expect(await main.evaluate(el => el.scrollTop)).toBe(reading)
    await page.screenshot({ path: test.info().outputPath(`${theme}-overflow.png`) })
    await choose(page, 1)
    await aligned(page, 'input-0')
    await choose(page, 101)
    await expect(page.locator('[data-user-message="input-99"]')).toBeInViewport()
    await expect.poll(() => rail.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(2)
  })
}

async function choose(page: Page | Locator, number: number) {
  const nav = page.getByRole('navigation', { name: 'Navigate inputs' })
  await nav.getByRole('button', { name: `Input ${number}`, exact: true }).click()
}

test('empty history and reduced-motion keyboard navigation retain boundaries', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await seed(page, 0)
  await expect(page.getByRole('navigation', { name: 'Navigate inputs' })).toHaveCount(0)
  await seed(page, 13)
  const nav = page.getByRole('navigation', { name: 'Navigate inputs' })
  const first = nav.getByRole('button', { name: 'Input 1', exact: true })
  await first.focus()
  await first.press('Enter')
  await aligned(page, 'input-0')
  const last = nav.getByRole('button', { name: 'Input 13', exact: true })
  await last.focus()
  await last.press('Space')
  await expect(last).toHaveAttribute('aria-current', 'step')
  await expect(last).toBeInViewport()
  await expect(page.locator('[data-user-message="input-12"]')).toBeInViewport()
})

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
  await nav.getByRole('button').first().scrollIntoViewIfNeeded()
  await page.mouse.move(700, 20)
  await nav.getByRole('button').first().hover()
  await expect(nav.getByRole('tooltip')).toContainText('Question 0')
  expect((await page.locator('[data-user-message="input-99"]').boundingBox())!.y).toBe(last!.y)
  await page.screenshot({ path: test.info().outputPath('normal.png') })
})

test('navigation fits narrow and short pane containers, restores after resize, and cancels on manual reading', async ({ page }) => {
  await seed(page)
  const pane = page.locator('section').filter({ has: page.getByRole('navigation', { name: 'Navigate inputs' }) }).first()
  await pane.evaluate(pane => { pane.style.width = '230px'; pane.style.height = '400px' })
  await choose(page, 51)
  await aligned(page, 'input-49')
  const nav = page.getByRole('navigation', { name: 'Navigate inputs' })
  await nav.getByRole('button').first().hover()
  const popup = nav.getByRole('tooltip')
  await expect(popup).toBeVisible()
  const bounds = await pane.boundingBox(), box = await popup.boundingBox()
  expect(box!.x + box!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width)
  expect(box!.y + box!.height).toBeLessThanOrEqual((await nav.boundingBox())!.y + (await nav.boundingBox())!.height)
  await nav.getByRole('button').first().focus()
  await page.keyboard.press('Escape')
  await expect(popup).toHaveCount(0)
  await choose(page, 60)
  await aligned(page, 'input-58')
  await pane.evaluate(pane => { pane.style.width = '350px'; pane.style.height = '520px' })
  await aligned(page, 'input-58')
  const reading = page.getByRole('region')
  const readingBounds = (await reading.boundingBox())!
  await reading.hover({ position: { x: readingBounds.width - 12, y: readingBounds.height / 2 } })
  await page.mouse.wheel(0, -350)
  await expect.poll(() => page.locator('[data-user-message="input-58"]').evaluate(message => Math.abs(message.getBoundingClientRect().top - message.closest('[role=region]')!.getBoundingClientRect().top - 12))).toBeGreaterThan(10)
  await pane.evaluate(pane => { pane.style.width = '230px'; pane.style.height = '300px' })
  await expect.poll(() => nav.locator('> div').first().evaluate(rail => rail.clientHeight)).toBeLessThan(216)
  await nav.getByRole('button').first().hover()
  await expect(nav.getByRole('tooltip')).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('narrow-short.png') })
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
  await first.getByRole('navigation').getByRole('button').first().hover()
  const popup = first.getByRole('tooltip')
  await expect(popup).toBeVisible()
  const box = await popup.boundingBox(), bounds = await first.getByRole('navigation').boundingBox()
  expect(box!.x + box!.width).toBeLessThanOrEqual((await first.boundingBox())!.x + (await first.boundingBox())!.width)
  expect(box!.y + box!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height)
  await expect(second.getByRole('tooltip')).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath(`split-${split}.png`) })
})
