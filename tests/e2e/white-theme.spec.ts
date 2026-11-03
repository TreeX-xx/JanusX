import { expect, test, type Locator } from '@playwright/test'

async function contrastOnWhite(locator: Locator) {
  return locator.evaluate(el => {
    const rgb = getComputedStyle(el).color.match(/[\d.]+/g)!.map(Number)
    let alpha = rgb[3] ?? 1
    for (let parent: Element | null = el; parent; parent = parent.parentElement) alpha *= Number(getComputedStyle(parent).opacity)
    const linear = rgb.slice(0, 3).map(c => (c * alpha + 255 * (1 - alpha)) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
    return 1.05 / (linear.reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0) + .05)
  })
}

test('memo labels and conversation hints retain readable contrast on white', async ({ page }) => {
  test.setTimeout(40_000)
  await page.goto('/memo.html?theme=white&island&preview')
  for (const selector of ['.memo-point-number', '.memo-star-label']) {
    const text = page.locator(selector).first()
    await expect(text).toBeVisible()
    await expect.poll(() => contrastOnWhite(text)).toBeGreaterThanOrEqual(4.5)
  }
  await page.goto('/codex-conversation.html?theme=white&initialView=conversation')
  await page.locator('textarea').focus()
  const hint = page.locator('[class*="inputHint"]')
  await expect(hint).toBeVisible()
  await expect.poll(() => contrastOnWhite(hint)).toBeGreaterThanOrEqual(4.5)
})

test('terminal and file icons remain readable across live theme changes', async ({ page }) => {
  await page.goto('/theme-surfaces.html')
  const selector = page.getByRole('region', { name: 'Terminal selector', exact: true })
  await expect(selector.locator('[data-preset="codex"]')).toBeVisible()
  for (const theme of ['white', 'dark', 'planche', 'white']) {
    await page.getByRole('button', { name: theme, exact: true }).click()
    await expect(selector.locator('[data-preset="codex"]')).toHaveCSS('filter', theme === 'dark' ? 'invert(1)' : 'none')
    for (const preset of ['opencode', 'janus']) {
      const icon = selector.locator(`[data-preset="${preset}"]`)
      const ink = await icon.evaluate(el => getComputedStyle(el).color)
      await expect(icon.locator('path').nth(1)).toHaveCSS(preset === 'opencode' ? 'fill' : 'stroke', ink)
      await expect(icon).toHaveCSS('filter', 'none')
    }
    const borders = await page.locator('[data-git-status] > span').evaluateAll(elements => elements.map(el => (el as HTMLElement).style.borderColor))
    expect(borders.length).toBeGreaterThan(0)
    expect(borders.every(color => color.startsWith('color-mix('))).toBe(true)
  }
  const contrast = await page.locator('[data-file-kind]').evaluateAll(elements => elements.map(el => {
    const rgb = getComputedStyle(el).color.match(/[\d.]+/g)!.map(Number)
    const linear = rgb.slice(0, 3).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
    const luminance = linear.reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0)
    return { kind: el.getAttribute('data-file-kind'), opacity: rgb[3] ?? 1, ratio: 1.05 / (luminance + .05) }
  }))
  for (const icon of contrast) {
    expect(icon.opacity, icon.kind!).toBe(1)
    expect(icon.ratio, icon.kind!).toBeGreaterThanOrEqual(4.5)
  }
  await expect.poll(() => contrastOnWhite(page.locator('[data-git-ignored="true"]'))).toBeGreaterThanOrEqual(4.5)
  await page.screenshot({ path: test.info().outputPath('white-terminal-files.png'), animations: 'disabled' })
})

for (const plugin of ['cpa', 'docker']) {
  test(`${plugin} native controls follow the application theme instead of OS appearance`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto(`/plugin-controls.html?plugin=${plugin}&theme=white`)
    await expect(page.getByLabel('Mode')).toHaveCSS('color-scheme', 'light')
    await expect(page.getByLabel('Mode')).toHaveCSS('color', 'rgb(32, 41, 54)')
    await expect(page.getByLabel('Mode')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await page.emulateMedia({ colorScheme: 'light' })
    await page.getByRole('button', { name: 'dark', exact: true }).click()
    await expect(page.getByLabel('Date')).toHaveCSS('color-scheme', 'dark')
    for (const theme of ['planche', 'white']) {
      await page.getByRole('button', { name: theme, exact: true }).click()
      await expect(page.getByLabel('Date')).toHaveCSS('color-scheme', 'light')
    }
    await page.screenshot({ path: test.info().outputPath(`white-${plugin}-controls.png`), animations: 'disabled' })
  })
}

test('white Markdown reading surface matches the editor canvas', async ({ page }) => {
  await page.goto('/editor-preview.html?theme=white')
  await expect(page.locator('.markdown-preview')).toBeVisible()
  await expect(page.locator('.markdown-preview').locator('..')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await expect(page.locator('.monaco-editor').first()).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await page.screenshot({ path: test.info().outputPath('white-editor-preview.png'), animations: 'disabled' })
})

test('settings and usage share the same theme-aware CLI identities', async ({ page }) => {
  for (const path of ['/settings.html?theme=white&tab=llm&en', '/shell-settings.html?theme=white&en', '/usage.html?theme=white']) {
    await page.goto(path)
    for (const preset of ['codex', 'opencode', 'janus']) {
      const icon = page.locator(`[data-preset="${preset}"]`).first()
      await expect(icon).toBeVisible()
      if (preset === 'codex') await expect(icon).toHaveCSS('filter', 'none')
      const bounds = (await icon.boundingBox())!
      expect(bounds.width).toBeGreaterThanOrEqual(14)
      expect(bounds.width).toBeLessThanOrEqual(24)
    }
  }
})

test('white settings, portal menus and theme changes remain readable', async ({ page }) => {
  await page.goto('/settings.html?theme=white&en')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await expect(dialog).toHaveCSS('color', 'rgb(32, 41, 54)')
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light')
  await page.screenshot({ path: test.info().outputPath('white-settings.png'), animations: 'disabled' })
  await page.getByRole('button', { name: 'Default view for new sessions', exact: true }).click()
  const menu = page.getByRole('listbox')
  await expect(menu).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await expect(menu.getByRole('option').first()).toHaveCSS('color', 'rgb(32, 41, 54)')
  await page.keyboard.press('Escape')
  await page.locator('input[value="dark"]').locator('..').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.locator('input[value="white"]').locator('..').click()
  await expect(dialog).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await page.goto('/settings.html?theme=white&tab=llm&en')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('white-channels.png'), animations: 'disabled' })
})

test('white Island supports every expanded view and live dark/white switching', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => (window as any).__applyRunTheme('white'))
  await page.getByTestId('reopen-island').click()
  const shell = page.locator('.janus-island-shell[data-stage="expanded"]')
  for (const view of ['chat', 'monitor', 'roundtable']) {
    await shell.locator(`.janus-expanded-view-button[data-view="${view}"]`).click()
    await expect(shell).toHaveAttribute('data-view', view)
    await shell.screenshot({ path: test.info().outputPath(`white-island-${view}.png`), animations: 'disabled' })
  }
  await page.evaluate(() => (window as any).__applyRunTheme('dark'))
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark')
  await page.evaluate(() => (window as any).__applyRunTheme('white'))
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light')
})

test('isolated Blueprint uses the SDK palette and updates already mounted nodes', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/plugin-theme.html')
  const title = page.locator('.bp-node-card__title').first()
  await expect(title).toBeVisible()
  await expect(title).toHaveCSS('color', 'rgb(32, 41, 54)')
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light')
  await page.screenshot({ path: test.info().outputPath('white-blueprint.png'), animations: 'disabled' })
  await page.getByRole('button', { name: 'dark', exact: true }).click()
  await expect(title).toHaveCSS('color', 'rgb(250, 250, 250)')
  await page.getByRole('button', { name: 'white', exact: true }).click()
  await expect(title).toHaveCSS('color', 'rgb(32, 41, 54)')
  expect(errors).toEqual([])
})
