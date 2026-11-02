import { expect, test } from '@playwright/test'

for (const installed of [true, false]) {
  test(`initial detection opens setup only when needed: installed=${installed}`, async ({ page }) => {
    await page.goto(`/terminal-startup.html?delayDetect${installed ? '' : '&localCli=missing'}`)
    // Count actual modal openings, so a transient flash cannot pass a final-state assertion.
    await page.evaluate(() => {
      const original = HTMLDialogElement.prototype.showModal
      ;(window as any).setupOpenings = 0
      HTMLDialogElement.prototype.showModal = function () {
        if (this.getAttribute('aria-labelledby') === 'local-cli-title') (window as any).setupOpenings++
        original.call(this)
      }
    })
    await page.getByRole('button', { name: 'New Codex' }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
    expect(await page.evaluate(() => (window as any).setupOpenings)).toBe(0)
    expect(await page.evaluate(() => (window as any).startupFixture.pending())).toBe(false)
    await page.evaluate(() => (window as any).localCliFixture.completeDetection())
    if (installed) {
      await expect.poll(() => page.evaluate(() => (window as any).startupFixture.pending())).toBe(true)
      await expect(page.getByRole('dialog')).not.toBeVisible()
      expect(await page.evaluate(() => (window as any).setupOpenings)).toBe(0)
      expect(await page.evaluate(() => (window as any).localCliFixture.installs)).toBe(0)
    } else {
      await expect(page.getByRole('dialog', { name: 'Set up Codex' })).toBeVisible()
      expect(await page.evaluate(() => (window as any).setupOpenings)).toBe(1)
      expect(await page.evaluate(() => (window as any).startupFixture.pending())).toBe(false)
    }
  })
}

test('missing marker sits inside the terminal card bottom-right corner', async ({ page }) => {
  await page.goto('/terminal-startup.html?localCli=missing&selector')
  const card = page.getByRole('button', { name: /^Codex/ })
  const badge = card.getByRole('img', { name: 'Not installed. Click to install' })
  await expect(badge).toBeVisible()
  const outer = (await card.boundingBox())!
  const marker = (await badge.boundingBox())!
  expect(outer.x + outer.width - marker.x - marker.width).toBeGreaterThanOrEqual(5)
  expect(outer.x + outer.width - marker.x - marker.width).toBeLessThanOrEqual(10)
  expect(outer.y + outer.height - marker.y - marker.height).toBeGreaterThanOrEqual(5)
  expect(outer.y + outer.height - marker.y - marker.height).toBeLessThanOrEqual(10)
  await page.screenshot({ path: test.info().outputPath('terminal-card-badge.png') })
})

test('missing CLI has a badge and installs before any terminal is created', async ({ page }) => {
  await page.goto('/terminal-startup.html?localCli=missing')
  await expect(page.getByRole('img', { name: 'Not installed. Click to install' })).toBeVisible()
  await page.getByRole('button', { name: 'New Codex' }).click()
  const dialog = page.getByRole('dialog', { name: 'Set up Codex' })
  await expect(dialog).toBeVisible()
  expect(await page.evaluate(() => (window as any).startupFixture.pending())).toBe(false)
  await dialog.getByRole('button', { name: 'Install and open' }).click()
  await expect(dialog).not.toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).startupFixture.pending())).toBe(true)
  expect(await page.evaluate(() => (window as any).localCliFixture.installs)).toBe(1)
  await expect(page.getByRole('img', { name: 'Not installed. Click to install' })).toHaveCount(0)
})

test('installation failure retains recovery and manual Node fallback', async ({ page }) => {
  await page.goto('/terminal-startup.html?localCli=missing')
  await page.evaluate(() => { (window as any).localCliFixture.fail = true })
  await page.getByRole('button', { name: 'New Codex' }).click()
  await page.getByRole('button', { name: 'Install and open' }).click()
  await expect(page.getByRole('alert')).toContainText('Setup did not complete')
  await page.getByText('Show details', { exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Fixture network failure')
  await page.getByText('Install the runtime manually', { exact: true }).click()
  await expect(page.getByRole('link', { name: 'Open Node.js downloads' })).toHaveAttribute('href', 'https://nodejs.org/en/download')
  await page.getByRole('link', { name: 'Open Node.js downloads' }).click()
  expect(await page.evaluate(() => (window as any).localCliFixture.links)).toEqual(['https://nodejs.org/en/download'])
  await page.evaluate(() => { (window as any).localCliFixture.fail = false })
  await page.getByRole('button', { name: 'Install and open' }).click()
  await expect.poll(() => page.evaluate(() => (window as any).startupFixture.pending())).toBe(true)
})

test('leaving setup prevents a late install from opening a terminal', async ({ page }) => {
  await page.goto('/terminal-startup.html?localCli=missing')
  await page.evaluate(() => { (window as any).localCliFixture.delayed = true })
  await page.getByRole('button', { name: 'New Codex' }).click()
  await page.getByRole('button', { name: 'Install and open' }).click()
  await expect(page.getByRole('status')).toContainText('Preparing and installing')
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await page.evaluate(() => (window as any).localCliFixture.complete())
  await expect(page.getByRole('img', { name: 'Not installed. Click to install' })).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).startupFixture.pending())).toBe(false)
})

test('manual install can resume the original launch without another install', async ({ page }) => {
  await page.goto('/terminal-startup.html?localCli=missing')
  await page.getByRole('button', { name: 'New Codex' }).click()
  await expect(page.getByRole('button', { name: 'Install and open' })).toBeEnabled()
  await page.evaluate(() => { (window as any).localCliFixture.installed = true })
  await page.getByRole('button', { name: 'Already installed? Check again' }).click()
  await expect.poll(() => page.evaluate(() => (window as any).startupFixture.pending())).toBe(true)
  expect(await page.evaluate(() => (window as any).localCliFixture.installs)).toBe(0)
})

for (const theme of ['planche', 'dark']) {
  test(`setup fits narrow screens in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 700 })
    await page.goto(`/terminal-startup.html?localCli=missing&theme=${theme}`)
    await page.getByRole('button', { name: 'New Codex' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('button', { name: 'Install and open' })).toBeEnabled()
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    await page.screenshot({ path: test.info().outputPath(`cli-setup-${theme}.png`) })
  })
}
