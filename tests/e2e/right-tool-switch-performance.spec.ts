import { expect, test } from '@playwright/test'

test('large Git worktrees keep offscreen file actions reachable after switching', async ({ page }) => {
  await page.goto('/tool-palette.html')
  await page.evaluate(() => (window as any).builtinExtensionFixture.largeGit())
  await page.locator('#right-tool-rail-git').click()
  const lastFile = page.getByRole('button', { name: 'src/large/file-499.tsx', exact: true })
  await lastFile.scrollIntoViewIfNeeded()
  await expect(lastFile).toBeVisible()
  await page.locator('#right-tool-rail-files').click()
  await expect(page.locator('#right-tool-rail-files')).toHaveAttribute('aria-pressed', 'true')
  await page.locator('#right-tool-rail-git').click()
  await lastFile.scrollIntoViewIfNeeded()
  const row = lastFile.locator('..')
  await page.evaluate(() => (window as any).builtinExtensionFixture.refreshGit(false))
  await expect(row).toContainText('M')
  await page.evaluate(() => (window as any).builtinExtensionFixture.refreshGit(true))
  await expect(row).toContainText('A')
  await row.hover()
  await row.getByRole('button', { name: '暂存更改', exact: true }).click()
  expect((await page.evaluate(() => (window as any).builtinExtensionFixture.state())).stagedPaths).toEqual([['src/large/file-499.tsx']])
})

test('different-width switches lay out content once while the shell animates', async ({ page }) => {
  await page.goto('/tool-palette.html?panel=520')
  await expect(page.locator('#right-tool-panel-files')).toBeVisible()
  const samples = await page.evaluate(async () => {
    const shell = document.querySelector<HTMLElement>('[data-testid="right-tool-panel-shell"]')!
    const result: { shell: number; content: number; target: number }[] = []
    for (const [id, target] of [['sessions', 518], ['files', 258], ['git', 518], ['files', 258]] as const) {
      document.querySelector<HTMLButtonElement>(`[data-rail-tool="${id}"]`)!.click()
      const start = performance.now()
      while (performance.now() - start < 450) {
        await new Promise(requestAnimationFrame)
        const panel = document.getElementById(`right-tool-panel-${id}`)!
        if (!panel.hidden) result.push({ shell: shell.getBoundingClientRect().width, content: panel.getBoundingClientRect().width, target })
      }
    }
    return result
  })
  expect(samples.length).toBeGreaterThan(10)
  expect(samples.some(({ shell }) => shell > 280 && shell < 500)).toBe(true)
  expect(Math.max(...samples.map(({ content, target }) => Math.abs(content - target)))).toBeLessThan(1)
  await test.info().attach('switch-layout-samples.json', { body: JSON.stringify(samples), contentType: 'application/json' })
})

test('repeated Git/session switches reuse recent data and the scan schedule', async ({ page }) => {
  await page.goto('/tool-palette.html')
  await page.getByRole('toolbar').getByRole('button', { name: /会话/ }).click()
  const sessions = page.locator('#right-tool-panel-sessions')
  await expect(sessions.locator('[data-session-id]')).toHaveCount(3)
  await sessions.getByRole('textbox').fill('终端管理')
  // Allow every rail target to activate, rather than only testing cancelled
  // requests inside the 100ms feedback window.
  const result = await page.evaluate(async () => {
    for (let cycle = 0; cycle < 8; cycle++) {
      document.querySelector<HTMLButtonElement>('[data-rail-tool="git"]')!.click()
      await new Promise((resolve) => setTimeout(resolve, 160))
      document.querySelector<HTMLButtonElement>('[data-rail-tool="sessions"]')!.click()
      await new Promise((resolve) => setTimeout(resolve, 160))
    }
    return (window as any).builtinExtensionFixture.state()
  })
  expect(result.sessionFilters.filter((filter: { cwd?: string }) => filter.cwd === 'C:/palette')).toHaveLength(1)
  expect(result.sessionScans).toBeLessThanOrEqual(1)
  await expect(sessions.getByRole('textbox')).toHaveValue('终端管理')
  await expect(sessions.locator('[data-session-id="session-review"]')).toBeVisible()
  expect(result.listeners).toBe(2)
  expect(result.toolActivations).toEqual(['sessions', ...Array.from({ length: 8 }, () => ['git', 'sessions']).flat()])
  await test.info().attach('switch-work.json', {
    body: JSON.stringify({ roundTrips: 8, scopedListReads: result.sessionFilters.filter((filter: { cwd?: string }) => filter.cwd === 'C:/palette').length,
      externalScans: result.sessionScans, listeners: result.listeners }, null, 2),
    contentType: 'application/json',
  })
})

test('a cached return catches up missed changes without a new event', async ({ page }) => {
  await page.clock.install()
  await page.goto('/tool-palette.html')
  await page.locator('#right-tool-rail-sessions').click()
  const card = page.locator('[data-session-id="session-review"]')
  await expect(card).toBeVisible()
  await page.locator('#right-tool-rail-git').click()
  await expect(page.locator('#right-tool-rail-git')).toHaveAttribute('aria-pressed', 'true')
  // Simulate a mutation while the inactive panel has no event subscriptions.
  await page.evaluate(() => {
    const original = window.electron.session.list
    window.electron.session.list = async (filter) => (await original(filter)).map((session) =>
      session.id === 'session-review' ? { ...session, firstPrompt: '后台更新后的标题' } : session)
  })
  await page.locator('#right-tool-rail-sessions').click()
  await expect(card).toContainText('检查终端管理')
  await page.clock.fastForward(5100)
  await expect(card).toContainText('后台更新后的标题')
})
