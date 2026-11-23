import { expect, test, type Locator } from '@playwright/test'

function menuSurface(menu: Locator) {
  return menu.evaluate(node => {
    const { backgroundColor, borderTopColor, borderTopLeftRadius, boxShadow } = getComputedStyle(node)
    return { backgroundColor, borderTopColor, borderTopLeftRadius, boxShadow }
  })
}

for (const [theme, dockColor, menuColor, hoverColor] of [
  ['planche', 'rgb(239, 228, 197)', 'rgb(243, 235, 215)', 'rgb(234, 224, 200)'],
  ['dark', 'rgb(30, 30, 32)', 'rgb(37, 37, 39)', 'rgba(255, 255, 255, 0.06)'],
  ['white', 'rgb(244, 245, 247)', 'rgb(255, 255, 255)', 'rgb(240, 242, 245)'],
]) {
  test(`tool and workspace menu surfaces resolve in ${theme}`, async ({ page }) => {
    await page.goto(`/tool-palette.html?theme=${theme}&toolbox=1`)
    const files = page.getByRole('region', { name: /文件/ })
    await expect(files).toBeVisible()
    const dock = files.locator('..').locator('..').locator('..')
    await expect(dock).toHaveCSS('background-color', dockColor)
    await page.locator('.ws').filter({ hasText: 'JanusX' }).hover()
    await page.getByRole('button', { name: '更多操作', exact: true }).click()
    const action = page.getByRole('button', { name: /运行配置/ }).last()
    await expect(action).toBeVisible()
    const menu = action.locator('..')
    await expect(menu).toHaveCSS('background-color', menuColor)
    const sidebarSurface = await menuSurface(menu)
    await action.hover()
    await expect(action).toHaveCSS('background-color', hoverColor)
    await page.screenshot({ path: test.info().outputPath(`tool-palette-${theme}.png`) })
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)

    const toolbox = page.getByRole('button', { name: '展开选择要打开的工具', exact: true })
    await toolbox.click()
    const toolMenu = page.getByRole('menu', { name: '工作区工具' })
    const item = toolMenu.getByRole('menuitem', { name: '打开工作区浏览器', exact: true })
    await expect(toolMenu).toBeVisible()
    expect(await menuSurface(toolMenu)).toEqual(sidebarSurface)
    await item.hover()
    await expect(item).toHaveCSS('background-color', hoverColor)
    await page.screenshot({ path: test.info().outputPath(`toolbox-${theme}.png`) })
    await page.mouse.move(10, 200)
    await page.keyboard.press('Tab')
    await expect(item).toBeFocused()
    await expect(item).toHaveCSS('outline-style', 'solid')
    await expect(item).toHaveCSS('background-color', hoverColor)
    await page.keyboard.press('Escape')
    await expect(toolMenu).toHaveCount(0)
    await page.locator('#right-tool-rail-sessions').click()
    await expect(page.getByText('优化文件管理和工作区菜单的视觉层级', { exact: true }).first()).toBeVisible()
    await page.screenshot({ path: test.info().outputPath(`tool-sessions-${theme}.png`) })
  })
}
