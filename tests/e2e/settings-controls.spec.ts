import { expect, test } from '@playwright/test'

test('settings select supports keyboard selection and Escape without closing settings', async ({ page }) => {
  await page.goto('/settings.html?tab=notifications&theme=dark')
  await page.getByRole('checkbox', { name: '启用远程提醒', exact: true }).check()
  await page.getByRole('checkbox', { name: '启用飞书提醒', exact: true }).check()
  const mode = page.getByRole('button', { name: '发送模式', exact: true })
  await mode.press('ArrowDown')
  await expect(page.getByRole('listbox')).toBeVisible()
  await mode.press('End')
  await mode.press('Enter')
  await expect(page.getByRole('textbox', { name: 'App ID', exact: true })).toBeVisible()
  await mode.press('ArrowDown')
  await mode.press('Escape')
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await expect(mode).toBeFocused()
  await expect(page.getByRole('dialog')).toBeVisible()
})

for (const theme of ['dark', 'planche', 'white']) {
  for (const plugin of ['blueprint', 'cpa']) {
    test(`${plugin} settings share neutral controls and fit ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 650, height: 900 })
      await page.goto(`/settings-plugins.html?plugin=${plugin}&theme=${theme}`)
      const frame = page.frameLocator('iframe')
      await expect(frame.locator('html')).toHaveAttribute('data-theme', theme)
      await expect(frame.locator('[data-jx-control="checkbox"]').first()).toBeVisible()
      if (plugin === 'blueprint') {
        const provider = frame.locator('[data-jx-control="select"]').first()
        await provider.click()
        await frame.getByRole('option', { name: 'Local provider', exact: true }).click()
        await expect(provider).toContainText('Local provider')
        const codex = frame.getByRole('group', { name: 'Codex', exact: true })
        await expect(codex.locator('img')).toHaveCSS('filter', theme === 'dark' ? 'invert(1)' : 'none')
        const install = codex.getByRole('button').first()
        const colors = await install.evaluate(node => {
          const probe = document.createElement('span'); probe.style.color = 'var(--shell-text)'; node.append(probe)
          const result = { background: getComputedStyle(node).backgroundColor, neutral: getComputedStyle(probe).color }
          probe.remove(); return result
        })
        expect(colors.background).toBe(colors.neutral)
        await install.click()
        await expect(install).toBeDisabled()
        await expect.poll(() => page.evaluate(() => (window as unknown as { settingsCalls: Array<{ method: string }> }).settingsCalls.filter(call => call.method === 'mcp.change').length)).toBe(1)
      } else {
        const mode = frame.getByRole('combobox')
        await mode.click()
        await frame.getByRole('option').last().click()
        await expect(frame.locator('[data-jx-control="input"]')).toHaveCount(1)
        await frame.getByRole('button', { name: 'Save', exact: true }).click()
        await expect.poll(() => page.evaluate(() => (window as unknown as { settingsCalls: Array<{ method: string }> }).settingsCalls.filter(call => call.method === 'settings.save').length)).toBe(1)
      }
      for (const width of [650, 360]) {
        await page.setViewportSize({ width, height: 900 })
        expect(await frame.locator('body').evaluate(node => node.scrollWidth <= window.innerWidth)).toBe(true)
        await page.screenshot({ path: test.info().outputPath(`${plugin}-${theme}-${width}.png`) })
      }
    })
  }
}
