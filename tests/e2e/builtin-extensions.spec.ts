import { expect, test, type Page } from '@playwright/test'

const state = (page: Page) => page.evaluate(() => (window as any).builtinExtensionFixture.state())

test('built-ins use extension lifecycle while preserving file search, Git actions and width preferences', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.stack ?? error.message))
  await page.goto('/tool-palette.html?panel=480')
  const files = page.locator('#right-tool-panel-files')
  await expect(files.getByText('README.md', { exact: true })).toBeVisible()
  await files.getByRole('textbox').fill('README')
  await page.locator('#right-tool-rail-git').click()
  const git = page.locator('#right-tool-panel-git')
  await expect(git.getByText('src/renderer/RightDock.tsx', { exact: true })).toBeVisible()
  await git.getByRole('button', { name: '暂存更改', exact: true }).click()
  await expect.poll(async () => (await state(page)).stagedPaths).toEqual([['src/renderer/RightDock.tsx']])
  await page.locator('#right-tool-rail-files').click()
  await expect(files.getByRole('textbox')).toHaveValue('README')

  for (const id of ['files', 'git', 'sessions']) {
    await page.evaluate((id) => (window as any).builtinExtensionFixture.disable(id), id)
    await expect(page.locator(`#right-tool-rail-${id}`)).toHaveCount(0)
    await expect(page.locator(`#right-tool-panel-${id}`)).toHaveCount(0)
    expect(await page.evaluate((id) => (window as any).builtinExtensionFixture.open(id), id)).toBe(false)
    await page.evaluate((id) => (window as any).builtinExtensionFixture.enable(id), id)
    await expect(page.locator(`#right-tool-panel-${id}`)).toHaveCount(0)
    expect(await page.evaluate((id) => (window as any).builtinExtensionFixture.open(id), id)).toBe(true)
    await expect(page.locator(`#right-tool-panel-${id}`)).toBeVisible()
    expect((await state(page)).open.filter((item: string) => item === id)).toHaveLength(1)
  }
  expect((await state(page)).widths).toEqual({ git: 480, sessions: 480 })
  expect(errors).toEqual([])
})

test('session view releases subscriptions on inactivity, close and disable without stopping execution', async ({ page }) => {
  await page.goto('/tool-palette.html')
  await page.locator('#right-tool-rail-sessions').click()
  const sessions = page.locator('#right-tool-panel-sessions')
  await expect(sessions.locator('[data-session-id="session-review"]')).toBeVisible()
  await expect.poll(async () => (await state(page)).listeners).toBe(2)
  await sessions.getByRole('textbox').fill('终端管理')
  await page.locator('#right-tool-rail-files').click()
  await expect.poll(async () => (await state(page)).listeners).toBe(0)
  await page.locator('#right-tool-rail-sessions').click()
  await expect(sessions.getByRole('textbox')).toHaveValue('终端管理')
  await expect.poll(async () => (await state(page)).listeners).toBe(2)
  await page.evaluate(() => (window as any).builtinExtensionFixture.selectProject('other'))
  await expect(sessions.getByRole('textbox')).toHaveValue('终端管理')
  await expect.poll(async () => (await state(page)).sessionFilters.at(-1)).toEqual({ cwd: 'C:/other' })
  await expect.poll(async () => (await state(page)).listeners).toBe(2)

  for (let cycle = 0; cycle < 3; cycle++) {
    await page.evaluate(() => (window as any).builtinExtensionFixture.close('sessions'))
    await expect.poll(async () => (await state(page)).listeners).toBe(0)
    await page.evaluate(() => (window as any).builtinExtensionFixture.open('sessions'))
    await expect(sessions.locator('[data-session-id="session-review"]')).toBeVisible()
    await expect.poll(async () => (await state(page)).listeners).toBe(2)
  }
  await page.evaluate(() => (window as any).builtinExtensionFixture.disable('sessions'))
  await expect(sessions).toHaveCount(0)
  await expect.poll(async () => (await state(page)).listeners).toBe(0)
  expect((await state(page)).terminalKills).toBe(0)
})
