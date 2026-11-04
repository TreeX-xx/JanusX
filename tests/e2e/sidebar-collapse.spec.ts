import { expect, test, type Page } from '@playwright/test'

const preferenceKey = 'janusx-workspace-sidebar'
const collapse = async (page: Page) => {
  await page.getByRole('button', { name: '收起工作区侧栏', exact: true }).click()
  await page.locator('aside').evaluate(async node => {
    await Promise.all(node.getAnimations({ subtree: true })
      .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => undefined)))
  })
}
const saved = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).state, preferenceKey)

test('collapsed project children leave the tab order and the rail toggle retains focus', async ({ page }) => {
  await page.goto('/sidebar.html')
  await page.locator('.workspace-sidebar__expanded .ws').first().locator('button').first().focus()
  for (let index = 0; index < 10; index++) {
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => !!document.activeElement?.closest('[aria-hidden="true"], [inert]'))).toBe(false)
  }
  await page.getByRole('button', { name: '收起工作区侧栏' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: '展开工作区侧栏' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: '收起工作区侧栏' })).toBeFocused()
})

test('short windows keep all project targets scrollable and controls fixed', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 480 })
  await page.goto('/sidebar.html?many')
  await collapse(page)
  const projects = page.locator('[data-rail-workspace]')
  await expect(projects).toHaveCount(24)
  for (const height of await projects.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height))) expect(height).toBe(36)
  const add = page.getByRole('button', { name: '添加工作区', exact: true })
  const before = await add.boundingBox()
  await projects.last().scrollIntoViewIfNeeded()
  await expect(projects.last()).toBeInViewport()
  expect(await page.locator('[data-workspace-rail-list]').evaluate(node => node.scrollTop)).toBeGreaterThan(0)
  expect(await add.boundingBox()).toEqual(before)
  await expect(page.getByRole('button', { name: '展开工作区侧栏' })).toBeInViewport()
  await expect(add).toBeInViewport()
})

test('remembers all three folding levels and prunes removed projects and groups', async ({ page }) => {
  await page.goto('/sidebar.html?grouped')
  await page.locator('.workspace-sidebar__expanded .ws').first().locator('button').first().click()
  await page.getByRole('button', { name: 'Development', exact: true }).click()
  await collapse(page)
  await page.reload()
  await expect(page.locator('aside')).toHaveAttribute('data-collapsed', 'true')
  await page.getByRole('button', { name: '展开工作区侧栏' }).click()
  await expect(page.getByRole('button', { name: 'Development', exact: true })).toHaveAttribute('aria-expanded', 'false')
  await page.getByRole('button', { name: 'Development', exact: true }).click()
  await expect(page.locator('[data-sidebar-terminal="review"]')).toBeVisible()
  await page.getByRole('button', { name: 'Development', exact: true }).click()
  await page.evaluate(() => {
    const fixture = (window as unknown as { sidebarFixture: { removeWorkspace: (id: string) => void } }).sidebarFixture
    fixture.removeWorkspace('ws-0'); fixture.removeWorkspace('ws-1')
  })
  expect(await saved(page)).toMatchObject({ expandedWorkspaceIds: [], collapsedGroupIds: [] })
})

test('adds and activates a workspace from the folded rail', async ({ page }) => {
  await page.goto('/sidebar.html')
  await collapse(page)
  await page.evaluate(() => {
    delete (window.electron as { workspaceRuntime?: unknown }).workspaceRuntime
    window.electron.dialog.openDirectory = async () => ({ canceled: false, filePaths: ['C:/projects/Added'] })
    window.electron.workspace.create = async input => ({ id: 'added', name: input.name, path: input.path, clis: [], layout: { mode: 'tabs', positions: [] }, createdAt: '' })
  })
  await page.getByRole('button', { name: '添加工作区', exact: true }).click()
  await expect(page.locator('[data-rail-workspace="added"]')).toHaveAttribute('aria-current', 'true')
  await expect(page.locator('aside')).toHaveAttribute('data-collapsed', 'true')
})

test('rail names and summaries distinguish projects without switching on hover', async ({ page }) => {
  await page.goto('/sidebar.html?many')
  await collapse(page)
  await expect(page.locator('[data-rail-workspace="ws-0"]')).toHaveText('JX')
  await expect(page.locator('[data-rail-workspace="ws-1"]')).toHaveText('JW')
  await expect(page.locator('[data-rail-workspace="ws-2"]')).toHaveText('JA')
  const project = page.getByRole('button', { name: 'JanusX · C:/projects/JanusX', exact: true })
  await project.hover()
  await expect(page.getByRole('tooltip')).toContainText('C:/projects/JanusX')
  await expect(page.getByRole('tooltip')).toContainText('1 待回复')
  await expect(page.getByRole('tooltip')).toContainText('1 运行中')
  await expect(project).toHaveAttribute('aria-current', 'true')
})

test('keyboard quick list restores an existing background terminal and returns focus', async ({ page }) => {
  await page.goto('/sidebar.html')
  await collapse(page)
  const project = page.locator('[data-rail-workspace="ws-1"]')
  await project.focus()
  await page.keyboard.press('ArrowRight')
  const panel = page.getByRole('dialog', { name: '查看 Agent runtime 的终端' })
  await expect(panel).toBeVisible()
  await expect(panel.locator('[data-quick-terminal="background"]')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(project).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  await expect(panel).toHaveCount(0)
  await expect(project).toHaveAttribute('aria-current', 'true')
  await expect(page.locator('[data-selected-terminal]')).toHaveText('background')
  await expect(page.locator('aside')).toHaveAttribute('data-collapsed', 'true')
  const state = await page.evaluate(() => (window as unknown as { sidebarFixture: { state: () => { terminals: number; pane: string; tab: string } } }).sidebarFixture.state())
  expect(state).toMatchObject({ terminals: 1, tab: 'terminal:background' })
})

for (const theme of ['dark', 'planche']) {
  test(`quick list works with pointer, keyboard and a short viewport in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 480 })
    await page.goto(`/sidebar.html?theme=${theme}&en`)
    await page.getByRole('button', { name: 'Collapse workspace sidebar' }).click()
    const trigger = page.getByRole('button', { name: 'View terminals in JanusX', exact: true })
    await trigger.click()
    const panel = page.getByRole('dialog', { name: 'View terminals in JanusX' })
    await expect(panel).toBeVisible()
    await expect(panel.locator('[data-quick-terminal="review"]')).toBeFocused()
    const rect = await panel.boundingBox()
    expect(rect!.x).toBeGreaterThanOrEqual(0)
    expect(rect!.y + rect!.height).toBeLessThanOrEqual(480)
    await page.screenshot({ path: `artifacts/sidebar-collapse/quick-list-${theme}.png`, animations: 'disabled' })
    await panel.locator('[data-quick-terminal="feature-cli"]').click()
    await expect(page.locator('[data-selected-terminal]')).toHaveText('feature-cli')
    await expect(trigger).toBeFocused()
    await trigger.click()
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()
    await trigger.click()
    await page.locator('[data-terminal-drop-target]').click({ position: { x: 600, y: 20 } })
    await expect(panel).toHaveCount(0)
  })
}
