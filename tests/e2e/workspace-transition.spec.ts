import { expect, test, type Page } from '@playwright/test'

const panel = (page: Page, tool: string) => page.locator(`#right-tool-panel-${tool}`)
const surface = (page: Page, tool: string) => panel(page, tool).locator('[data-workspace-transition]')
async function control(page: Page, action: string, ...args: unknown[]) {
  return page.evaluate(({ action, args }) => (window as any).workspaceTransitionFixture[action](...args), { action, args })
}
async function select(page: Page, id: string) {
  await page.getByRole('button', { name: `${id}，拖动可排序或分组`, exact: true }).click()
}
async function openTool(page: Page, tool: string) {
  await page.locator(`#right-tool-rail-${tool}`).click()
  await expect(panel(page, tool)).toBeVisible()
  await expect(surface(page, tool)).toHaveAttribute('data-workspace-transition', 'idle')
}

for (const theme of ['planche', 'dark']) {
  test(`files hold their shape under glass until loaded in ${theme}`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`/workspace-transition.html?theme=${theme}`)
    await expect(surface(page, 'files')).toHaveAttribute('data-workspace-transition', 'idle')
    await expect(panel(page, 'files')).toContainText('palette.ts')
    await control(page, 'hold', 'files', 'C:/other')
    await select(page, 'other')
    await expect(surface(page, 'files')).toHaveAttribute('data-workspace-transition', 'waiting')
    await expect(panel(page, 'files')).toContainText('palette.ts')
    await expect(panel(page, 'files').getByRole('status')).toContainText('正在切换到 other')
    await expect.poll(() => surface(page, 'files').locator('[class*="glass"]').evaluate(el => getComputedStyle(el).backdropFilter)).toBe('blur(5px)')
    await expect(panel(page, 'files').getByRole('textbox')).toBeEnabled()
    expect(await surface(page, 'files').locator('[inert]').count()).toBe(1)
    await page.screenshot({ path: test.info().outputPath(`glass-${theme}.png`) })
    await control(page, 'release', 'files', 'C:/other')
    await expect(surface(page, 'files')).toHaveAttribute('data-workspace-transition', 'idle')
    await expect(panel(page, 'files')).toContainText('other.ts')
    await expect(panel(page, 'files')).not.toContainText('palette.ts')
    expect(await surface(page, 'files').locator('[inert]').count()).toBe(0)
    await expect.poll(() => surface(page, 'files').locator('[class*="glass"]').evaluate(el => getComputedStyle(el).backdropFilter)).toBe('none')
    await page.screenshot({ path: test.info().outputPath(`clear-${theme}.png`) })
    expect(errors).toEqual([])
  })
}

test('rapid switches discard late content and the visible panel does not wait for hidden tools', async ({ page }) => {
  await page.goto('/workspace-transition.html')
  await control(page, 'hold', 'files', 'C:/other')
  await select(page, 'other')
  await expect(surface(page, 'files')).toHaveAttribute('aria-busy', 'true')
  await select(page, 'third')
  await expect(surface(page, 'files')).toHaveAttribute('data-workspace-transition', 'idle')
  await expect(panel(page, 'files')).toContainText('third.ts')
  await control(page, 'release', 'files', 'C:/other')
  await expect(panel(page, 'files')).not.toContainText('other.ts')
  await control(page, 'hold', 'files', 'C:/palette')
  await openTool(page, 'sessions')
  await select(page, 'palette')
  await expect(surface(page, 'sessions')).toHaveAttribute('data-workspace-transition', 'idle')
  await expect(panel(page, 'sessions')).toContainText('palette session')
})

for (const [tool, kind] of [['git', 'log'], ['sessions', 'sessions']] as const) {
  test(`${tool} waits for its data and recovers after a failed switch`, async ({ page }) => {
    await page.goto('/workspace-transition.html')
    await openTool(page, tool)
    await control(page, 'hold', kind, 'C:/other')
    await select(page, 'other')
    await expect(surface(page, tool)).toHaveAttribute('data-workspace-transition', 'waiting')
    await control(page, 'release', kind, 'C:/other', true)
    await expect(surface(page, tool)).toHaveAttribute('data-workspace-transition', 'idle')
    await expect(panel(page, tool)).toContainText(`${kind} unavailable`)
    await expect(panel(page, tool)).not.toContainText(tool === 'git' ? 'palette history' : 'palette session')
    await select(page, 'third')
    await expect(surface(page, tool)).toHaveAttribute('data-workspace-transition', 'idle')
    await expect(panel(page, tool)).toContainText(tool === 'git' ? 'third history' : 'third session')
  })
}

test('file failure from a background takeover clears the glass and retry succeeds', async ({ page }) => {
  await page.goto('/workspace-transition.html')
  await control(page, 'hold', 'files', 'C:/other')
  await select(page, 'other')
  await control(page, 'refreshFiles')
  await expect.poll(() => control(page, 'queued', 'files', 'C:/other')).toBe(2)
  await control(page, 'release', 'files', 'C:/other', true)
  await expect(surface(page, 'files')).toHaveAttribute('data-workspace-transition', 'idle')
  await panel(page, 'files').getByRole('button', { name: '重试', exact: true }).click()
  await expect(panel(page, 'files')).toContainText('other.ts')
})

test('background refreshes do not replay motion and worktree changes do', async ({ page }) => {
  await page.goto('/workspace-transition.html')
  for (const [tool, kind, refresh] of [['files', 'files', 'refreshFiles'], ['git', 'status', 'refreshGit'], ['sessions', 'sessions', 'refreshSessions']] as const) {
    if (tool !== 'files') await openTool(page, tool)
    await expect(surface(page, tool)).toHaveAttribute('data-workspace-transition', 'idle')
    await control(page, 'hold', kind, 'C:/palette')
    await control(page, refresh)
    await expect.poll(() => control(page, 'queued', kind, 'C:/palette')).toBe(1)
    await expect(surface(page, tool)).toHaveAttribute('data-workspace-transition', 'idle')
    await control(page, 'release', kind, 'C:/palette')
  }
  await select(page, 'other')
  await expect(surface(page, 'sessions')).toHaveAttribute('data-workspace-transition', 'idle')
  await control(page, 'hold', 'sessions', 'C:/task')
  await control(page, 'worktree')
  await expect(surface(page, 'sessions')).toHaveAttribute('data-workspace-transition', 'waiting')
  await control(page, 'release', 'sessions', 'C:/task')
  await expect(surface(page, 'sessions')).toHaveAttribute('data-workspace-transition', 'idle')
  await expect(panel(page, 'sessions')).toContainText('task session')
  await openTool(page, 'git')
  await expect(panel(page, 'git')).toContainText('task history')
})

test('reduced motion keeps loading feedback without blur', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/workspace-transition.html')
  await control(page, 'hold', 'files', 'C:/other')
  await select(page, 'other')
  await expect(surface(page, 'files')).toHaveAttribute('data-workspace-transition', 'waiting')
  await expect.poll(() => surface(page, 'files').locator('[class*="glass"]').evaluate(el => getComputedStyle(el).backdropFilter)).toBe('none')
  await control(page, 'release', 'files', 'C:/other')
  await expect(surface(page, 'files')).toHaveAttribute('data-workspace-transition', 'idle')
})

test('global session filters stay usable after clearing the active workspace', async ({ page }) => {
  await page.goto('/workspace-transition.html')
  await openTool(page, 'sessions')
  await panel(page, 'sessions').getByRole('button', { name: '全部', exact: true }).click()
  await expect(surface(page, 'sessions')).toHaveAttribute('data-workspace-transition', 'idle')
  await expect(panel(page, 'sessions')).toContainText('all session')
  await control(page, 'clearWorkspace')
  await expect(surface(page, 'sessions')).toHaveAttribute('data-workspace-transition', 'idle')
  await panel(page, 'sessions').getByRole('button', { name: '归档', exact: true }).click()
  await expect(surface(page, 'sessions')).toHaveAttribute('data-workspace-transition', 'idle')
  await expect(surface(page, 'sessions').locator('[inert]')).toHaveCount(0)
})
