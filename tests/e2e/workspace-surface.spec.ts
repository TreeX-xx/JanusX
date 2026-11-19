import { expect, test } from '@playwright/test'

for (const theme of ['planche', 'dark']) {
  for (const width of [1280, 480]) {
    test(`${theme} usage toolbar stays readable at ${width}px and opens from the keyboard`, async ({ page }) => {
      await page.setViewportSize({ width, height: 720 })
      await page.goto(`/pane-tabs.html?single&usage&theme=${theme}`)
      const drawer = page.locator('[data-runtime-drawer]')
      const toggle = page.getByRole('button', { name: 'Toggle usage panel', exact: true })
      const terminal = await page.locator('.xterm-screen').first().elementHandle()
      await expect(toggle).toBeVisible()
      await expect(drawer).toHaveCSS('border-top-width', '0px')
      await expect(drawer).toHaveCSS('height', '28px')
      await expect(toggle).toHaveAttribute('aria-expanded', 'false')
      await expect(toggle).toContainText('Usage')
      const context = drawer.locator('[data-context-indicator]')
      await expect(context).toHaveText('2.0%')
      await expect(context.locator('svg')).toHaveCSS('width', '18px')
      await expect(context).toBeVisible()
      const toolbarBox = (await drawer.boundingBox())!
      const hostBefore = await page.locator('[data-pane-host]').boundingBox()
      const contextBox = (await context.boundingBox())!
      expect(contextBox.x).toBeGreaterThanOrEqual(toolbarBox.x)
      expect(contextBox.x + contextBox.width).toBeLessThanOrEqual(toolbarBox.x + toolbarBox.width)
      expect(await toggle.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
      await page.screenshot({ path: test.info().outputPath(`${theme}-${width}-collapsed.png`) })

      await toggle.focus()
      await toggle.press('Enter')
      await expect(toggle).toHaveAttribute('aria-expanded', 'true')
      await expect(drawer).toHaveCSS('height', '28px')
      expect(await page.locator('[data-pane-host]').boundingBox()).toEqual(hostBefore)
      const panel = page.getByRole('region', { name: 'Usage', exact: true })
      await expect(panel).toBeVisible()
      for (const card of await panel.locator('[data-runtime-card]').all()) {
        await expect(card).toHaveCSS('border-width', '1px')
        await expect(card).toHaveCSS('border-radius', '11px')
      }
      expect(await toggle.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
      const handle = drawer.getByRole('separator')
      await handle.focus()
      const initialHeight = Number(await handle.getAttribute('aria-valuenow'))
      await handle.press('ArrowDown')
      await expect(handle).toHaveAttribute('aria-valuenow', String(initialHeight - 16))
      await handle.press('ArrowDown')
      await expect(handle).toHaveAttribute('aria-valuenow', String(initialHeight - 32))
      expect(await page.locator('[data-pane-host]').boundingBox()).toEqual(hostBefore)
      await page.screenshot({ path: test.info().outputPath(`${theme}-${width}-expanded.png`) })
      await toggle.focus()
      await toggle.press('Space')
      await expect(toggle).toHaveAttribute('aria-expanded', 'false')
      await expect(drawer).toHaveCSS('height', '28px')
      await expect(drawer).toHaveCSS('border-top-width', '0px')
      expect(await terminal?.evaluate((node) => node.isConnected)).toBe(true)
    })
  }
}

for (const theme of ['planche', 'dark']) {
  for (const layout of ['single', 'horizontal', 'vertical']) {
    test(`${theme} ${layout} keeps a continuous workspace with local tab selection`, async ({ page }) => {
      await page.goto(`/pane-tabs.html?theme=${theme}&${layout}`)
      const host = page.locator('[data-pane-host]')
      const panes = host.locator('[data-pane-id]')
      await expect(panes).toHaveCount(layout === 'single' ? 1 : 2)
      await expect(host).toHaveCSS('margin', '0px')
      await expect(host).toHaveCSS('border-width', '0px')
      await expect(host).toHaveCSS('border-radius', '0px')
      const hostBox = (await host.boundingBox())!
      const areaBox = (await host.locator('..').boundingBox())!
      expect(hostBox.x).toBe(areaBox.x)
      expect(hostBox.y).toBe(areaBox.y)
      expect(hostBox.width).toBe(areaBox.width)
      for (const pane of await panes.all()) {
        await expect(pane).toHaveCSS('border-width', '0px')
        await expect(pane).toHaveCSS('border-radius', '0px')
        await expect(pane).toHaveCSS('box-shadow', 'none')
        const header = pane.locator('[data-tab-strip]').locator('..')
        await expect(header).toHaveCSS('border-width', '0px')
        await expect(header).toHaveCSS('background-color', await pane.evaluate((node) => getComputedStyle(node).backgroundColor))
        for (const tab of await pane.locator('[data-tab-id]').all()) {
          await expect(tab).toHaveCSS('border-width', '0px')
          await expect(tab).toHaveCSS('border-radius', '7px')
          await expect(tab).toHaveCSS('width', '144px')
        }
      }
      const first = page.locator('[data-tab-id="terminal:a"]')
      const next = page.locator('[data-tab-id="terminal:b"]')
      await next.focus()
      await expect(next).toHaveCSS('outline-style', 'solid')
      await next.press('Enter')
      await expect(next).toHaveAttribute('aria-pressed', 'true')
      await expect(first).toHaveAttribute('aria-pressed', 'false')
      if (layout !== 'single') {
        const separator = host.getByRole('separator')
        await expect(separator).toHaveCSS(layout === 'horizontal' ? 'width' : 'height', '9px')
        const divider = separator.locator('..')
        await expect(divider).toHaveCSS(layout === 'horizontal' ? 'width' : 'height', '9px')
        expect(await separator.evaluate((node, axis) => getComputedStyle(node, '::after').getPropertyValue(axis),
          layout === 'horizontal' ? 'width' : 'height')).toBe('1px')
        const right = page.locator('[data-pane-id="right"]')
        await right.locator('[data-tab-id="browser:d"]').click()
        await expect(right).toHaveAttribute('data-focused', 'true')
        await expect(page.locator('[data-pane-id="left"]')).toHaveAttribute('data-focused', 'false')
      }
      await page.screenshot({ path: test.info().outputPath(`${theme}-${layout}.png`) })
    })
  }
}

for (const direction of ['horizontal', 'vertical']) {
  test(`${direction} divider supports pointer, keyboard and equal-size reset`, async ({ page }) => {
    await page.goto(`/pane-tabs.html?${direction}`)
    const separator = page.locator('[data-pane-host]').getByRole('separator')
    await expect(separator).toHaveAttribute('aria-valuenow', '50')
    await separator.focus()
    await page.keyboard.press(direction === 'horizontal' ? 'ArrowRight' : 'ArrowDown')
    await expect(separator).toHaveAttribute('aria-valuenow', '55')
    await page.keyboard.press('Home')
    await expect(separator).toHaveAttribute('aria-valuenow', '15')
    await page.keyboard.press('End')
    await expect(separator).toHaveAttribute('aria-valuenow', '85')
    await separator.dblclick()
    await expect(separator).toHaveAttribute('aria-valuenow', '50')
    const panes = await page.locator('[data-pane-id]').all()
    const firstBox = (await panes[0].boundingBox())!
    const secondBox = (await panes[1].boundingBox())!
    expect(Math.abs(direction === 'horizontal' ? firstBox.width - secondBox.width : firstBox.height - secondBox.height)).toBeLessThan(1)
    const box = (await separator.boundingBox())!
    const host = (await page.locator('[data-pane-host]').boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(
      direction === 'horizontal' ? host.x + host.width * .65 : box.x + box.width / 2,
      direction === 'vertical' ? host.y + host.height * .65 : box.y + box.height / 2,
    )
    await expect(separator).toHaveAttribute('aria-valuenow', '65')
    await page.mouse.up()
    await expect(separator).toHaveAttribute('data-resizing', 'false')
    await separator.dblclick()
    await expect(separator).toHaveAttribute('aria-valuenow', '50')
    const snapshot = await page.evaluate(() => (window as any).paneFixture.state())
    expect(snapshot.kills).toBe(0)
    expect(snapshot.creates).toBe(0)
  })
}

test('collapse control merges splits without closing their contents', async ({ page }) => {
  await page.goto('/pane-tabs.html')
  const collapse = page.getByRole('button', { name: /End layout/ }).first()
  await expect(collapse).toBeVisible()
  await collapse.focus()
  await page.keyboard.down('Enter')
  await expect(page.locator('[data-pane-id]')).toHaveCount(1)
  await page.keyboard.up('Enter')
  await expect(page.locator('[data-tab-id]')).toHaveCount(5)
  await expect(page.locator('[data-pane-host]').getByRole('separator')).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).paneFixture.state().kills)).toBe(0)
  await page.screenshot({ path: test.info().outputPath('collapsed-layout.png') })
})
