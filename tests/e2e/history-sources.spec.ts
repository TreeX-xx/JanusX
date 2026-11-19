import { expect, test } from '@playwright/test'

for (const theme of ['planche', 'dark']) {
  for (const width of [1100, 390]) {
    test(`shared history settings ${theme} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 950 })
      await page.goto(`/usage.html?theme=${theme}`)
      await page.evaluate(() => {
        let settings: import('../../src/shared/history-sources').HistorySourceSettings = { disabledAutomatic: [], locations: [] }
        const view = (): import('../../src/shared/history-sources').HistorySourcesView => ({ settings, sources: [
          { engine: 'claude', path: '/Users/用户/.claude/projects', namespace: '/Users/用户/.claude', automatic: true, enabled: !settings.disabledAutomatic.includes('claude'), status: 'missing', resume: 'read-only' },
          ...settings.locations.map(item => ({ ...item, namespace: item.path, automatic: false, status: 'ready' as const, resume: 'native-layout' as const })),
        ] })
        window.electron.system.getHistorySources = async () => view()
        window.electron.system.saveHistorySources = async value => { settings = value; return view() }
        window.electron.system.pickHistorySource = async () => '/Users/用户/自定义历史目录/projects'
      })
      await page.getByRole('button', { name: '历史数据位置', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: '历史数据位置' })
      await expect(dialog.getByText('位置不存在', { exact: true })).toBeVisible()
      await dialog.getByRole('button', { name: '添加位置 Claude Code', exact: true }).click()
      await expect(dialog.getByText('/Users/用户/自定义历史目录/projects', { exact: true })).toBeVisible()
      await expect(dialog.getByText('已识别历史', { exact: true })).toBeVisible()
      const custom = dialog.getByRole('checkbox', { name: '/Users/用户/自定义历史目录/projects', exact: true })
      await custom.uncheck()
      await expect(custom).not.toBeChecked()
      expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
      await page.screenshot({ path: `artifacts/history-sources/${theme}-${width}.png`, fullPage: true })
      await dialog.getByRole('button', { name: '完成', exact: true }).click()
      await expect(dialog).not.toBeVisible()
      await page.getByRole('button', { name: '历史数据位置', exact: true }).click()
      await expect(dialog.getByRole('checkbox', { name: '/Users/用户/自定义历史目录/projects', exact: true })).not.toBeChecked()
      await dialog.getByRole('button', { name: '恢复自动识别', exact: true }).click()
      await expect(dialog.getByText('/Users/用户/自定义历史目录/projects', { exact: true })).toHaveCount(0)
      await page.keyboard.press('Escape')
      await expect(dialog).not.toBeVisible()
    })
  }
}
