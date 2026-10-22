import { expect, test } from '@playwright/test'

type TurnFixture = Window & { turnFixture: {
  configureEditor(cwd: string, workspacePath: string, worktreePath?: string, background?: boolean): void
  editorOpens: Array<{ filePath: string; workspacePath: string }>
  embeddedEditorVisible(): boolean
  emitDeleted(): void
} }

test('new changes auto-expand, expire after six seconds, and outside clicks dismiss immediately', async ({ page }) => {
  await page.clock.install()
  await page.goto('/turn-changes.html?focused=1')
  const island = page.locator('[data-turn-island][data-terminal-id="a"]')
  await page.getByRole('button', { name: 'Change two files' }).click()
  await expect(island).toHaveAttribute('data-stage', 'expanded')
  await page.clock.runFor(5900)
  await expect(island).toHaveAttribute('data-stage', 'expanded')
  await page.clock.runFor(200)
  await expect(island).toHaveAttribute('data-stage', 'collapsed')

  await page.getByRole('button', { name: 'Change two files' }).click()
  await expect(island).toHaveAttribute('data-stage', 'expanded')
  // Terminal surfaces can stop propagation; capture must still dismiss the island.
  await page.getByTestId('pane-b').evaluate(element => {
    element.addEventListener('pointerdown', event => event.stopPropagation())
  })
  await page.getByTestId('pane-b').click()
  await expect(island).toHaveAttribute('data-stage', 'collapsed')
})

test('manual expansion also expires after interaction leaves the island', async ({ page }) => {
  await page.clock.install()
  await page.goto('/turn-changes.html')
  const island = page.locator('[data-turn-island][data-terminal-id="a"]')
  await page.getByRole('button', { name: 'Change two files' }).click()
  await island.locator('.turn-change-dock').click()
  await page.clock.runFor(300)
  await expect(island).toHaveAttribute('data-stage', 'expanded')
  await page.clock.runFor(6500)
  await expect(island).toHaveAttribute('data-stage', 'expanded')
  await page.mouse.move(0, 0)
  await page.clock.runFor(6100)
  await expect(island).toHaveAttribute('data-stage', 'collapsed')
})

for (const theme of ['dark', 'planche']) {
  test(`latest clears while history remains reachable in ${theme}`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`/turn-changes.html?theme=${theme}&zh=1`)
    const island = page.locator('[data-turn-island][data-terminal-id="a"]')
    await expect(island).toBeVisible()
    await page.getByRole('button', { name: 'Change two files' }).click()
    await expect(island.locator('.turn-change-count')).toHaveText('2')
    await island.locator('.turn-change-dock').click()
    await expect(island.getByRole('region', { name: '最近' })).toBeVisible()
    await expect(island.locator('.turn-change-file')).toHaveCount(2)
    await expect.poll(async () => (await island.boundingBox())!.width).toBeGreaterThan(330)
    await page.screenshot({ path: test.info().outputPath(`latest-${theme}.png`) })
    await island.locator('.turn-change-tabs').getByRole('button', { name: '历史' }).click()
    await expect(island.locator('.turn-change-history')).toHaveCount(1)
    await page.getByRole('button', { name: 'No changes' }).click()
    await page.getByRole('button', { name: 'No changes' }).click()
    await expect(island.locator('.turn-change-count')).toHaveCount(0)
    await island.locator('.turn-change-dock').click()
    await expect(island.getByText('本轮无文件变化')).toBeVisible()
    await expect(island.locator('.turn-change-file')).toHaveCount(0)
    await island.locator('.turn-change-tabs').getByRole('button', { name: '历史' }).click()
    await expect(island.locator('.turn-change-history')).toHaveCount(1)
    await page.screenshot({ path: test.info().outputPath(`history-${theme}.png`) })
    await page.keyboard.press('Escape')
    await expect(island).toHaveAttribute('data-stage', 'collapsed')
    expect(errors).toEqual([])
  })
}

test('large counts fit the dock and keyboard access opens the current view', async ({ page }) => {
  await page.goto('/turn-changes.html')
  const island = page.locator('[data-turn-island][data-terminal-id="a"]')
  await expect(island).toBeVisible()
  await page.getByRole('button', { name: 'Many files' }).click()
  await expect(island.locator('.turn-change-count')).toHaveText('99+')
  await island.locator('.turn-change-dock').focus()
  await page.keyboard.press('Enter')
  await expect(island).toHaveAttribute('data-view', 'latest')
  await expect(island.locator('.turn-change-summary')).toContainText('120')
  await page.getByRole('button', { name: 'No changes' }).click()
  await island.locator('.turn-change-dock').dblclick()
  await expect(island).toHaveAttribute('data-view', 'history')
  await expect(island.locator('.turn-change-history')).toHaveCount(1)
})

const editorScenarios: Array<{
  name: string; cwd: string; root: string; scope: string; worktree?: string; background?: boolean
}> = [
  { name: 'workspace subdirectory', cwd: 'c:/project/src', root: 'C:\\Project\\', scope: 'C:\\Project\\' },
  { name: 'inactive nested worktree', cwd: 'C:/project/.trees/feature/src', root: 'C:/project',
    worktree: 'C:/project/.trees/feature', scope: 'C:/project/.trees/feature' },
  { name: 'background workspace snapshot', cwd: 'C:/feature/src', root: 'C:/project',
    worktree: 'C:/feature', scope: 'C:/feature', background: true },
  { name: 'directory outside known scopes', cwd: 'C:/external/src', root: 'C:/project', scope: 'C:/external/src' },
]
for (const scenario of editorScenarios) {
  test(`file clicks use the native editor scope for ${scenario.name}`, async ({ page }) => {
    await page.goto('/turn-changes.html')
    await page.waitForFunction(() => Boolean((window as TurnFixture).turnFixture))
    await page.evaluate(({ cwd, root, worktree, background }) => {
      (window as TurnFixture).turnFixture.configureEditor(cwd, root, worktree, background)
    }, scenario)
    await page.getByRole('button', { name: 'Change two files' }).click()
    const island = page.locator('[data-turn-island][data-terminal-id="a"]')
    await island.locator('.turn-change-dock').click()
    await island.locator('.turn-change-file').first().click()
    await island.getByRole('button', { name: /^History/ }).click()
    await island.locator('.turn-change-file').nth(1).click()
    const result = await page.evaluate(() => ({
      opens: (window as TurnFixture).turnFixture.editorOpens,
      embedded: (window as TurnFixture).turnFixture.embeddedEditorVisible(),
    }))
    expect(result).toEqual({
      opens: [
        { filePath: `${scenario.cwd}/src/main/terminal/turn-change-tracker.ts`, workspacePath: scenario.scope },
        { filePath: `${scenario.cwd}/src/renderer/components/TurnChangeIsland.tsx`, workspacePath: scenario.scope },
      ],
      embedded: false,
    })
  })
}

test('deleted files and terminals without a cwd do not open editor windows', async ({ page }) => {
  await page.goto('/turn-changes.html')
  await page.waitForFunction(() => Boolean((window as TurnFixture).turnFixture))
  await page.evaluate(() => (window as TurnFixture).turnFixture.emitDeleted())
  const island = page.locator('[data-turn-island][data-terminal-id="a"]')
  await island.locator('.turn-change-dock').click()
  await expect(island.locator('.turn-change-file').first()).toBeDisabled()
  await expect(island.locator('.turn-change-file').nth(1)).toBeDisabled()
  await page.evaluate(() => (window as TurnFixture).turnFixture.configureEditor('', 'C:/project'))
  await page.getByRole('button', { name: 'Change two files' }).click()
  await island.locator('.turn-change-dock').click()
  await expect(island.locator('.turn-change-file').first()).toBeDisabled()
  expect(await page.evaluate(() => (window as TurnFixture).turnFixture.editorOpens)).toEqual([])
})
