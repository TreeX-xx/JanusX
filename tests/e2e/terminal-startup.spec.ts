import { expect, test } from '@playwright/test'

test('answers live ConPTY capability negotiation without replaying old replies', async ({ page }) => {
  await page.goto('/terminal-startup.html')
  await page.getByRole('button', { name: 'New Shell' }).click()
  await expect.poll(() => page.evaluate(() => (window as any).startupFixture.pending())).toBe(true)
  await page.evaluate(() => (window as any).startupFixture.ready())
  await page.evaluate(() => (window as any).startupFixture.output('\x1b[1t\x1b[c'))
  await expect.poll(() => page.evaluate(() => (window as any).startupFixture.inputs.filter((text: string) => /^\x1b\[\?.*c$/.test(text)).length)).toBe(1)
  await page.evaluate(() => (window as any).startupFixture.output('Ready> '))
  await expect(page.getByRole('status')).toHaveCount(0)
  await page.getByRole('button', { name: 'Remount' }).click()
  await expect(page.getByRole('status')).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).startupFixture.inputs.filter((text: string) => /^\x1b\[\?.*c$/.test(text)).length)).toBe(1)
})

for (const preset of ['Shell', 'Codex']) {
  test(`${preset} gives feedback on every launch until visible output is painted`, async ({ page }) => {
    await page.goto('/terminal-startup.html')
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.getByRole('button', { name: `New ${preset}` }).click()
      const status = page.getByRole('status')
      await expect(page.locator('.cli-terminal')).toHaveCSS('opacity', '0')
      await expect(status).toHaveText('Starting terminal…')
      await expect.poll(() => page.evaluate(() => (window as any).startupFixture.pending())).toBe(true)
      await page.evaluate(() => (window as any).startupFixture.ready())
      await expect(status).toHaveText('Waiting for terminal output…')
      // Cursor/colour/clear sequences alone must not dismiss the hint.
      await page.evaluate(() => (window as any).startupFixture.output('\x1b[2J\x1b[H\x1b[?25l'))
      await expect(status).toBeVisible()
      await expect(page.locator('.cli-terminal')).toHaveCSS('opacity', '0')
      await page.screenshot({ path: `artifacts/terminal-startup-${preset.toLowerCase()}.png` })
      await page.evaluate(() => (window as any).startupFixture.output('Ready> '))
      await expect(status).toHaveCount(0)
      await expect(page.locator('.cli-terminal')).toHaveCSS('opacity', '1')
      await expect(page.locator('.xterm-screen')).toBeVisible()
      // Restoring an existing pane consumes replay and dismisses the hint too.
      await page.getByRole('button', { name: 'Remount' }).click()
      await expect(status).toHaveCount(0)
    }
  })
}

test('failure stops startup feedback and retry resumes it, with localized dark-theme copy', async ({ page }) => {
  await page.goto('/terminal-startup.html?theme=dark')
  await page.evaluate(() => (window as any).startupFixture.changeLanguage('zh-CN'))
  await page.getByRole('button', { name: 'New Shell' }).click()
  await expect(page.getByRole('status')).toHaveText('正在启动终端…')
  await expect.poll(() => page.evaluate(() => (window as any).startupFixture.pending())).toBe(true)
  await page.evaluate(() => (window as any).startupFixture.fail())
  await expect(page.getByRole('status')).toHaveCount(0)
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByRole('status')).toHaveText('正在启动终端…')
  await page.screenshot({ path: 'artifacts/terminal-startup-dark.png' })
  await page.evaluate(() => (window as any).startupFixture.ready())
  await expect(page.getByRole('status')).toHaveText('正在等待终端输出…')
  await page.evaluate(() => (window as any).startupFixture.output('PS> '))
  await expect(page.getByRole('status')).toHaveCount(0)
})
