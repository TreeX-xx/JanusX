import { expect, test, type Locator, type Page } from '@playwright/test'

const reader = (page: Page) => page.locator('[data-conversation-history-browser]')
async function setup(page: Page, query = '') {
  await page.goto('/codex-conversation.html?initialView=conversation' + query)
  await page.evaluate(() => (window as any).codexFixture.pagedHistory())
  await expect(page.getByText('Complete native original preview', { exact: true })).toBeVisible()
}
async function edge(browser: Locator, end = false) {
  return browser.getByRole('region').evaluate(async (host, end) => {
    host.scrollTop = end ? host.scrollHeight : 0
    host.dispatchEvent(new Event('scroll'))
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    const top = host.getBoundingClientRect().top
    const row = [...host.querySelectorAll<HTMLElement>('[data-history-item]')].find(row => row.getBoundingClientRect().bottom > top)
    const anchor = { id: row?.dataset.historyItem, top: row ? row.getBoundingClientRect().top - top : 0 }
    return anchor
  }, end)
}

test('native history pages on scroll, preserves the reading anchor and evicts distant pages', async ({ page }, info) => {
  // A cold Vite fixture build can share CPU with native integration checks.
  test.setTimeout(90000)
  await setup(page)
  await page.getByRole('region', { name: 'Conversation history', exact: true }).evaluate(host => { host.scrollTop = 0; host.dispatchEvent(new Event('scroll')) })
  const browser = reader(page)
  await expect(browser).toBeVisible()
  await expect(browser).toHaveAttribute('data-page-count', '1')
  for (let index = 0; index < 8; index++) {
    const count = await page.evaluate(() => (window as any).codexFixture.archiveRequests.length)
    await page.evaluate(() => (window as any).codexFixture.holdArchive())
    const saved = await edge(browser)
    await page.evaluate(() => (window as any).codexFixture.releaseArchive())
    await expect.poll(() => page.evaluate(() => (window as any).codexFixture.archiveRequests.length)).toBe(count + 1)
    await page.waitForTimeout(100)
    if (saved.id) {
      const offset = await browser.locator(`[data-history-item="${saved.id}"]`).evaluate(row => row.getBoundingClientRect().top - row.closest('[role="region"]')!.getBoundingClientRect().top)
      expect(Math.abs(offset - saved.top)).toBeLessThan(5)
    }
    expect(Number(await browser.getAttribute('data-page-count'))).toBeLessThanOrEqual(3)
    expect(await browser.locator('[data-history-item]').count()).toBeLessThan(30)
  }
  await expect(browser).toHaveAttribute('data-page-count', '3')
  const requestCount = await page.evaluate(() => (window as any).codexFixture.archiveRequests.length)
  await edge(browser, true)
  await expect.poll(() => page.evaluate(() => (window as any).codexFixture.archiveRequests.length)).toBe(requestCount + 1)
  await expect(browser).toHaveAttribute('data-page-count', '3')
  await page.screenshot({ path: `${info.outputDir}/bounded-history.png` })
  await browser.getByRole('button', { name: 'Back to latest', exact: true }).click()
  await expect(browser).toHaveCount(0)
  const calls = await page.evaluate(() => (window as any).codexFixture.calls)
  expect(calls.sends).toEqual([]); expect(calls.create).toBe(0); expect(calls.kill).toBe(0)
})

test('long originals use one chunk, retain the draft and restore after hiding the pane', async ({ page }, info) => {
  await page.setViewportSize({ width: 420, height: 740 })
  await setup(page, '&theme=light')
  const composer = page.getByRole('combobox', { name: 'Message Codex', exact: true })
  await composer.fill('Keep my unsent draft')
  await page.getByRole('button', { name: 'Read full content', exact: true }).click()
  const browser = reader(page), content = browser.locator('[data-history-text-offset]')
  await expect(content).toHaveAttribute('data-history-text-offset', '0')
  let offset = 0
  while (await browser.getByRole('button', { name: 'Next section', exact: true }).isEnabled()) {
    expect((await content.textContent())!.length).toBeLessThanOrEqual(16000)
    await browser.getByRole('button', { name: 'Next section', exact: true }).click()
    offset += 16000
    await expect(content).toHaveAttribute('data-history-text-offset', String(offset))
  }
  await expect(content).toContainText('END OF NATIVE ORIGINAL')
  await page.getByRole('button', { name: 'Other workspace', exact: true }).click()
  await expect(browser).toHaveCount(0)
  await page.getByRole('button', { name: 'Other workspace', exact: true }).click()
  await expect(content).toHaveAttribute('data-history-text-offset', String(offset))
  await browser.getByRole('button', { name: 'Previous section', exact: true }).click()
  await expect(content).toHaveAttribute('data-history-text-offset', String(offset - 16000))
  expect(await browser.evaluate(host => host.scrollWidth - host.clientWidth)).toBeLessThanOrEqual(1)
  await page.screenshot({ path: `${info.outputDir}/long-content-light.png` })
  await browser.getByRole('button', { name: 'Back to history', exact: true }).click()
  await expect(browser.locator('[data-history-item="archive-999:item-999"]')).toBeInViewport()
  await browser.getByRole('button', { name: 'Back to latest', exact: true }).click()
  await expect(composer).toHaveText('Keep my unsent draft')
  expect(await page.evaluate(() => (window as any).codexFixture.calls.sends)).toEqual([])
  await page.getByRole('button', { name: 'Read full content', exact: true }).click()
  await expect(browser).toBeVisible()
  await composer.press('Enter')
  await expect(browser).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (window as any).codexFixture.calls.sends)).toEqual(['Keep my unsent draft'])
})

test('failed reads retry and late responses cannot enter a different thread', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => (window as any).codexFixture.archiveFailure(true))
  await page.getByRole('button', { name: 'Read full content', exact: true }).click()
  await expect(reader(page).getByRole('alert')).toContainText('Fixture history unavailable')
  await page.evaluate(() => (window as any).codexFixture.archiveFailure(false))
  await reader(page).getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(reader(page).locator('[data-history-text-offset]')).toContainText('Complete native original')
  await page.evaluate(() => (window as any).codexFixture.holdArchive())
  await reader(page).getByRole('button', { name: 'Next section', exact: true }).click()
  await page.evaluate(() => { (window as any).codexFixture.changeThread(); (window as any).codexFixture.releaseArchive() })
  await expect(reader(page)).toHaveCount(0)
  await expect(page.getByText('Complete native original', { exact: true })).toHaveCount(0)
})
