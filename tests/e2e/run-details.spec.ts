import { expect, test } from '@playwright/test'

for (const theme of ['dark', 'planche']) {
  test(`run details keep controls reachable and use a neutral shadow in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 480 })
    await page.goto('/?runOrbs=1&titlebar=1')
    const indicator = page.locator('.janus-run-orb[data-workspace-id="workspace-1"]')
    await expect(indicator).toBeVisible()
    await page.evaluate(theme => {
      (window as any).__applyRunTheme(theme)
      const fixture = (window as any).__runOrbFixture
      for (let index = 0; index < 8; index++) fixture.running.push({
        ...fixture.running[0], id: `C:\\workspace-one::worker::${index + 10}`,
        name: index === 0 ? 'A long background worker name that should not push the stop control outside the panel' : `worker-${index + 1}`,
        pid: 1000 + index, scopePath: 'C:\\workspace-one', workspaceId: 'workspace-1',
      })
    }, theme)
    await expect(indicator).toHaveAttribute('aria-label', /9 processes/)
    await indicator.click()
    const panel = page.getByRole('dialog', { name: 'Workspace One', exact: true })
    await expect(panel.locator('.janus-run-orb-process')).toHaveCount(9)
    await expect(panel.locator('.janus-run-orb-port-warning').first()).toBeVisible()
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    await expect.poll(() => panel.evaluate(element => element.getAnimations().every(animation => animation.playState === 'finished'))).toBe(true)
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    expect(await panel.locator('.janus-run-orb-popover-body').evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
    const bounds = await panel.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(720)
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(480)
    const stopAll = panel.getByRole('button', { name: 'Stop all', exact: true })
    const footerBox = await stopAll.boundingBox()
    expect(footerBox!.y + footerBox!.height).toBeLessThan(bounds!.y + bounds!.height)
    if (theme === 'dark') expect(await panel.evaluate(element => getComputedStyle(element).boxShadow)).toContain('rgba(0, 0, 0,')
    await page.screenshot({ path: `artifacts/run-details-${theme}-scroll.png`, animations: 'disabled' })
    await stopAll.click()
    expect(await page.evaluate(() => (window as any).__runOrbFixture.stopCalls)).toEqual([])
    await page.mouse.click(20, 450)
    await expect(panel).toHaveCount(0)
    expect(await page.evaluate(() => (window as any).__runOrbFixture.stopCalls)).toEqual([])
  })
}

test('run detail confirmations remain separate from process content and preserve stop targets', async ({ page }) => {
  await page.goto('/?runOrbs=1&titlebar=1')
  const indicator = page.locator('.janus-run-orb[data-workspace-id="workspace-1"]')
  await expect(indicator).toBeVisible()
  await page.evaluate(() => {
    (window as any).__applyRunTheme('dark')
    const fixture = (window as any).__runOrbFixture
    fixture.running.push({ ...fixture.running[0], id: 'C:\\workspace-one::worker::3', pid: 333, name: 'worker' })
  })
  await expect(indicator).toHaveAttribute('aria-label', /2 processes/)
  await indicator.click()
  const panel = page.getByRole('dialog', { name: 'Workspace One', exact: true })
  await expect(panel.locator('.janus-run-orb-process')).toHaveCount(2)
  await page.screenshot({ path: 'artifacts/run-details-dark.png', animations: 'disabled' })
  await panel.getByRole('button', { name: 'Stop all processes in this worktree?', exact: true }).click()
  await panel.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await page.evaluate(() => (window as any).__runOrbFixture.stopCalls)).toEqual([])
  const first = panel.locator('.janus-run-orb-process').first()
  await first.getByRole('button', { name: 'Stop this process?', exact: true }).click()
  const contentBox = await first.locator('.janus-run-orb-process-main').boundingBox()
  const confirmationBox = await first.locator('.janus-run-orb-arm').boundingBox()
  expect(confirmationBox!.y).toBeGreaterThanOrEqual(contentBox!.y + contentBox!.height)
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: 'artifacts/run-details-confirm.png', animations: 'disabled' })
  await first.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(panel.locator('.janus-run-orb-process')).toHaveCount(1)
  expect(await page.evaluate(() => (window as any).__runOrbFixture.stopCalls)).toEqual(['C:\\workspace-one::dev::1'])
  await expect(panel.getByRole('button', { name: 'Stop all processes in this worktree?', exact: true })).toHaveCount(0)
  await panel.getByRole('button', { name: 'Stop all', exact: true }).click()
  await panel.getByRole('button', { name: 'Confirm stop all?', exact: true }).click()
  await expect(panel.getByText('Stopped', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'artifacts/run-details-stopped.png', animations: 'disabled' })
  await panel.getByRole('button', { name: 'Restart', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__runOrbFixture.startCalls)).toEqual(['C:\\workspace-one'])
})
