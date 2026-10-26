import { expect, test } from '@playwright/test'

test('CLI rows retain install, upgrade, detection and visibility actions', async ({ page }) => {
  await page.goto('/shell-settings.html?cliStates')
  const cli = page.getByRole('region', { name: '外部 CLI', exact: true })
  await expect(cli.locator('[data-cli-tool]')).toHaveCount(6)
  const claude = cli.getByRole('group', { name: 'Claude Code', exact: true })
  const codex = cli.getByRole('group', { name: 'Codex', exact: true })
  await expect(claude.getByText('有新版', { exact: true })).toBeVisible()
  await claude.getByRole('button', { name: '升级', exact: true }).click()
  await expect(claude.getByText('就绪', { exact: true })).toBeVisible()
  await codex.getByRole('button', { name: '安装', exact: true }).click()
  await expect(codex.getByText('就绪', { exact: true })).toBeVisible()
  await codex.getByRole('button', { name: '重新检测', exact: true }).click()
  await expect(codex.getByRole('button', { name: '重新检测', exact: true })).toBeVisible()
  await codex.getByRole('button', { name: '在新建终端入口显示', exact: true }).click()
  await expect(codex.getByRole('button', { name: '已从新建终端入口隐藏', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await expect(cli.getByRole('group', { name: 'OpenCode', exact: true }).getByText('已安装但不可运行')).toBeVisible()
})

for (const theme of ['planche', 'dark']) {
  for (const width of [1100, 640, 390]) {
    test(`CLI identity, status and actions fit ${theme} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1100 })
      await page.goto(`/shell-settings.html?cliStates&opencode=v1&theme=${theme}`)
      const cli = page.getByRole('region', { name: '外部 CLI', exact: true })
      await expect(cli.getByRole('group', { name: 'DeepSeek Harness', exact: true })).toBeVisible()
      for (const row of await cli.locator('[data-cli-tool]').all()) {
        expect(await row.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
        const bounds = await row.boundingBox()
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
      }
      await cli.screenshot({ path: test.info().outputPath(`external-cli-${theme}-${width}.png`) })
    })
  }
}

test('OpenCode v1 updates independently, then explicitly upgrades to v2', async ({ page }) => {
  await page.goto('/shell-settings.html?opencode=v1')
  const row = page.getByRole('group', { name: 'OpenCode', exact: true })
  await expect(row.getByText('1.18.0 · → 1.19.4 · path', { exact: true })).toBeVisible()
  await expect(row.getByRole('button', { name: '升级到 v2 · 2.1.4', exact: true })).toBeVisible()
  await row.getByRole('button', { name: '更新 v1', exact: true }).click()
  await expect(row.getByText('就绪', { exact: true })).toBeVisible()
  await expect(row.getByRole('button', { name: '更新 v1', exact: true })).toHaveCount(0)
  await row.getByRole('button', { name: '升级到 v2 · 2.1.4', exact: true }).click()
  await expect(row.getByText('2.1.4 · path', { exact: true })).toBeVisible()
  await expect(row.getByRole('button', { name: /升级到 v2/ })).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as { cliInstallRequests: unknown }).cliInstallRequests)).toEqual([
    { toolId: 'opencode', options: { channel: 'v1', version: '1.19.4' } },
    { toolId: 'opencode', options: { channel: 'v2', version: '2.1.4' } },
  ])
})

test('OpenCode v2 updates within v2', async ({ page }) => {
  await page.goto('/shell-settings.html?opencode=v2&en')
  const row = page.getByRole('group', { name: 'OpenCode', exact: true })
  await row.getByRole('button', { name: 'Update v2', exact: true }).click()
  await expect(row.getByText('2.1.4 · path', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { cliInstallRequests: unknown }).cliInstallRequests)).toEqual([
    { toolId: 'opencode', options: { channel: 'v2', version: '2.1.4' } },
  ])
})

test('a new OpenCode installation defaults to v2', async ({ page }) => {
  await page.goto('/shell-settings.html?opencode=missing')
  const row = page.getByRole('group', { name: 'OpenCode', exact: true })
  await row.getByRole('button', { name: '安装 v2', exact: true }).click()
  await expect(row.getByText('2.1.4 · path', { exact: true })).toBeVisible()
})

for (const scenario of ['offline', 'v1-offline', 'unknown', 'v1-ready']) {
  test(`OpenCode ${scenario} does not invent a v1 update`, async ({ page }) => {
    await page.goto(`/shell-settings.html?opencode=${scenario}`)
    const row = page.getByRole('group', { name: 'OpenCode', exact: true })
    await expect(row.getByRole('button', { name: '重新检测', exact: true })).toBeVisible()
    await expect(row.getByRole('button', { name: '更新 v1', exact: true })).toHaveCount(0)
    await expect(row.getByRole('button', { name: '升级到 v2 · 2.1.4', exact: true })).toHaveCount(scenario === 'offline' ? 0 : 1)
  })
}

for (const scenario of ['fail', 'shadow']) {
  test(`OpenCode ${scenario} preserves the upgrade error`, async ({ page }) => {
    await page.goto(`/shell-settings.html?opencode=${scenario}`)
    const row = page.getByRole('group', { name: 'OpenCode', exact: true })
    await row.getByRole('button', { name: '升级到 v2 · 2.1.4', exact: true }).click()
    await expect(row.getByRole('alert')).toContainText(scenario === 'fail' ? 'Fixture download failed' : 'Check PATH')
    await expect(row.getByText('1.18.0 · → 1.19.4 · path', { exact: true })).toBeVisible()
    await expect(row.getByText('安装完成，重启终端后生效。')).toHaveCount(0)
  })
}
