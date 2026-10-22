import { expect, test, type Page } from '@playwright/test'

type TerminalState = { cols: number; rows: number; viewportY: number; baseY: number; buffer: string; connected: boolean }
type FixtureWindow = Window & { paneFixture: {
  buffersReady(): boolean
  terminalState(id: string): TerminalState
  output(id: string, data: string): void
  navigationInputs(): Array<{ id: string; data: string }>
  metrics(): { fits: number; resizes: number; replays: number }
  state(): { creates: number; kills: number }
  switchWorkspace(): void
  removeSource(): void
  changeLanguage(language: string): Promise<void>
} }
const controls = (page: Page, id = 'a') => page.locator(`[data-terminal-scroll="${id}"]`)
const island = (page: Page, id = 'a') => page.locator(`[data-turn-island][data-terminal-id="${id}"]`)
const state = (page: Page, id = 'a') => page.evaluate(id => (window as FixtureWindow).paneFixture.terminalState(id), id)
const output = (page: Page, data: string, id = 'a') => page.evaluate(({ id, data }) => (window as FixtureWindow).paneFixture.output(id, data), { id, data })
const inputs = (page: Page) => page.evaluate(() => (window as FixtureWindow).paneFixture.navigationInputs())
const lifecycleMetrics = (page: Page) => page.evaluate(() => {
  const fixture = (window as FixtureWindow).paneFixture
  const { fits, resizes, replays } = fixture.metrics()
  const { creates, kills } = fixture.state()
  return { fits, resizes, replays, creates, kills }
})
async function ready(page: Page, query = 'single') {
  await page.goto(`/pane-tabs.html?navigation&${query}`)
  await expect.poll(() => page.evaluate(() => (window as FixtureWindow).paneFixture?.buffersReady() ?? false)).toBe(true)
  await expect(controls(page)).toBeVisible()
  await page.waitForTimeout(200)
}
async function holdUp(page: Page) {
  const box = (await controls(page).getByRole('button', { name: 'Scroll up a page' }).boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
}

test('normal history pages directly, preserves drafts and pins new output without resizing the PTY', async ({ page }) => {
  await ready(page)
  const before = await state(page)
  const beforeMetrics = await lifecycleMetrics(page)
  const up = controls(page).getByRole('button', { name: 'Scroll up a page' })
  const down = controls(page).getByRole('button', { name: 'Scroll down a page' })
  await expect(down).toBeDisabled()
  await page.locator('[data-pane-id="left"] .xterm-helper-textarea').first().focus()
  await page.keyboard.type('draft stays here')
  const draft = await inputs(page)
  await up.click()
  await expect.poll(async () => (await state(page)).viewportY).toBeLessThan(before.viewportY)
  await expect(page.locator('[data-pane-id="left"] .xterm-helper-textarea').first()).toBeFocused()
  const pinned = (await state(page)).viewportY
  await output(page, '\r\nnew output while reading\r\n')
  await expect.poll(async () => (await state(page)).baseY).toBeGreaterThan(before.baseY)
  expect((await state(page)).viewportY).toBe(pinned)
  await down.click()
  await expect.poll(async () => (await state(page)).viewportY).toBeGreaterThan(pinned)
  expect(await inputs(page)).toEqual(draft)
  const afterMetrics = await lifecycleMetrics(page)
  expect(afterMetrics).toEqual(beforeMetrics)
  expect((await state(page)).cols).toBe(before.cols)
  expect((await state(page)).rows).toBe(before.rows)
  await expect(page.locator('.terminal-history-reader, .terminal-scroll-mode-control')).toHaveCount(0)
})

test('holding repeats, release and pointer cancellation stop scrolling', async ({ page }) => {
  await ready(page)
  const start = (await state(page)).viewportY
  await holdUp(page)
  await page.waitForTimeout(180)
  const once = (await state(page)).viewportY
  await page.waitForTimeout(550)
  const held = (await state(page)).viewportY
  expect(once).toBeLessThan(start)
  expect(held).toBeLessThan(once)
  await page.mouse.up()
  await page.waitForTimeout(150)
  const released = (await state(page)).viewportY
  await page.waitForTimeout(500)
  expect((await state(page)).viewportY).toBe(released)
  await holdUp(page)
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel')))
  await page.waitForTimeout(150)
  const cancelled = (await state(page)).viewportY
  await page.waitForTimeout(550)
  expect((await state(page)).viewportY).toBe(cancelled)
  await page.mouse.up()
})

for (const action of ['blur', 'tab', 'pane', 'workspace', 'unmount'] as const) {
  test(`holding stops on ${action}`, async ({ page }) => {
    await ready(page, action === 'pane' ? '' : 'single')
    await holdUp(page)
    await page.waitForTimeout(480)
    await page.evaluate(action => {
      const fixture = (window as FixtureWindow).paneFixture
      if (action === 'blur') window.dispatchEvent(new Event('blur'))
      if (action === 'tab') document.querySelector<HTMLElement>('[data-tab-id="terminal:b"]')!.click()
      if (action === 'pane') document.querySelector<HTMLElement>('[data-pane-id="right"]')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      if (action === 'workspace') fixture.switchWorkspace()
      if (action === 'unmount') fixture.removeSource()
    }, action)
    await page.waitForTimeout(150)
    const stopped = (await state(page)).viewportY
    await page.waitForTimeout(550)
    expect((await state(page)).viewportY).toBe(stopped)
    expect(await controls(page).evaluateAll(elements => elements.some(element => element.hasAttribute('data-scrolling')))).toBe(false)
    await page.mouse.up()
  })
}

test('fullscreen uses the native mouse protocol and falls back to page keys without printable input', async ({ page }) => {
  await ready(page)
  await output(page, '\x1b[?1049h\x1b[?1003h\x1b[?1006hFULLSCREEN\x1b[20;1Hfixed input> ')
  await expect.poll(async () => (await state(page)).buffer).toBe('alternate')
  const start = (await inputs(page)).length
  await controls(page).getByRole('button', { name: 'Scroll up a page' }).click()
  await expect.poll(async () => (await inputs(page)).slice(start).filter(event => /^\x1b\[<64;\d+;\d+M$/.test(event.data)).length).toBeGreaterThan(1)
  const middle = (await inputs(page)).length
  await controls(page).getByRole('button', { name: 'Scroll down a page' }).click()
  await expect.poll(async () => (await inputs(page)).slice(middle).filter(event => /^\x1b\[<65;\d+;\d+M$/.test(event.data)).length).toBeGreaterThan(1)
  expect((await inputs(page)).slice(start).every(event => event.id === 'a' && /^\x1b\[<6[45];\d+;\d+M$/.test(event.data))).toBe(true)
  await output(page, '\x1b[?1003l\x1b[?1006l')
  await page.waitForTimeout(80)
  const fallbackStart = (await inputs(page)).length
  await controls(page).getByRole('button', { name: 'Scroll up a page' }).click()
  await controls(page).getByRole('button', { name: 'Scroll down a page' }).click()
  expect((await inputs(page)).slice(fallbackStart).map(event => event.data)).toEqual(['\x1b[5~', '\x1b[6~'])
  await page.keyboard.press('Shift+PageUp')
  expect((await inputs(page)).at(-1)?.data).toBe('\x1b[5~')
})

for (const theme of ['dark', 'planche']) {
  test(`fullscreen island meets the pane edge and collapses back to the input in ${theme}`, async ({ page }) => {
    await ready(page, `single&theme=${theme}`)
    const tools = page.locator('[data-terminal-tools="a"]')
    const inset = () => tools.evaluate(element => getComputedStyle(element).right)
    await expect.poll(inset).toBe('22px')
    const before = await state(page)
    const beforeMetrics = await lifecycleMetrics(page)
    await output(page, '\x1b[?1049h\x1b[?1003h\x1b[?1006hFULLSCREEN\x1b[20;1Hfixed input> ')
    await expect.poll(inset).toBe('0px')
    const pane = (await page.locator('[data-pane-id="left"]').boundingBox())!
    for (const view of ['latest', 'history']) {
      await island(page).locator('.turn-change-dock').click()
      await expect(island(page)).toHaveAttribute('data-stage', 'expanded')
      if (view === 'history') await island(page).getByRole('button', { name: /^History/ }).click()
      await page.waitForTimeout(450)
      const shell = (await island(page).boundingBox())!
      const nav = (await controls(page).boundingBox())!
      expect(Math.abs(shell.x + shell.width - (pane.x + pane.width))).toBeLessThan(1)
      expect(Math.abs(nav.x + nav.width - (pane.x + pane.width))).toBeLessThan(1)
      const close = island(page).getByRole('button', { name: 'Collapse file changes' })
      const target = (await close.boundingBox())!
      expect(target.width).toBeGreaterThanOrEqual(28)
      expect(target.height).toBeGreaterThanOrEqual(28)
      if (view === 'latest') await page.screenshot({ path: test.info().outputPath(`edge-${theme}.png`) })
      await close.click()
      await expect(island(page)).toHaveAttribute('data-stage', 'collapsed')
      await expect(page.locator('[data-pane-id="left"] .xterm-helper-textarea').first()).toBeFocused()
      await expect.poll(inset).toBe('0px')
    }
    expect((await state(page)).cols).toBe(before.cols)
    expect((await state(page)).rows).toBe(before.rows)
    expect(await lifecycleMetrics(page)).toEqual(beforeMetrics)
    await output(page, '\x1b[?1003l\x1b[?1006l\x1b[?1049l')
    await expect.poll(inset).toBe('22px')
    const thumb = page.locator('[data-pane-id="left"] .cli-terminal').first().locator('.scrollbar.vertical > .slider')
    const box = (await thumb.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, pane.y + pane.height / 2, { steps: 6 })
    await page.mouse.up()
    await expect.poll(async () => (await state(page)).viewportY).toBeLessThan(before.baseY)
  })
}

for (const layout of ['narrow', 'short'] as const) {
  test(`controls stay above the island in ${layout} splits and scroll only their own pane`, async ({ page }) => {
    await page.setViewportSize(layout === 'narrow' ? { width: 460, height: 720 } : { width: 500, height: 570 })
    await ready(page, layout === 'short' ? 'vertical&theme=dark' : '')
    await page.evaluate(() => (window as FixtureWindow).paneFixture.changeLanguage('zh-CN'))
    const beforeA = await state(page)
    const beforeC = await state(page, 'c')
    await controls(page, 'c').getByRole('button', { name: '向上翻屏' }).click()
    await expect.poll(async () => (await state(page, 'c')).viewportY).toBeLessThan(beforeC.viewportY)
    expect((await state(page)).viewportY).toBe(beforeA.viewportY)
    await output(page, '\x1b[?1049h\x1b[?1003h\x1b[?1006hFULLSCREEN')
    await expect.poll(async () => (await state(page)).buffer).toBe('alternate')
    for (const id of ['a', 'c']) {
      const pane = (await page.locator(`[data-pane-id="${id === 'a' ? 'left' : 'right'}"]`).boundingBox())!
      const checkBounds = async () => {
        const nav = (await controls(page, id).boundingBox())!
        const dock = (await island(page, id).boundingBox())!
        expect(nav.y).toBeGreaterThanOrEqual(pane.y)
        expect(nav.y + nav.height).toBeLessThanOrEqual(dock.y)
        expect(dock.y + dock.height).toBeLessThanOrEqual(pane.y + pane.height)
        expect(dock.x).toBeGreaterThanOrEqual(pane.x)
        if (id === 'a') expect(Math.abs(nav.x + nav.width - (pane.x + pane.width))).toBeLessThan(1)
        else expect(nav.x + nav.width).toBeLessThan(pane.x + pane.width - 12)
      }
      await checkBounds()
      await island(page, id).locator('.turn-change-dock').click()
      await expect(island(page, id)).toHaveAttribute('data-stage', 'expanded')
      await page.waitForTimeout(450)
      await checkBounds()
      await island(page, id).getByRole('button', { name: '收起文件变更' }).click()
      await expect(island(page, id)).toHaveAttribute('data-stage', 'collapsed')
      await island(page, id).locator('.turn-change-dock').click()
      await expect(island(page, id)).toHaveAttribute('data-stage', 'expanded')
    }
    expect((await state(page)).cols).toBe(beforeA.cols)
    expect((await state(page)).rows).toBe(beforeA.rows)
    expect((await state(page, 'c')).rows).toBe(beforeC.rows)
    await page.screenshot({ path: test.info().outputPath(`${layout}-controls.png`) })
  })
}

test('keyboard activation pages once and normal wheel remains directly available', async ({ page }) => {
  await ready(page)
  const start = (await state(page)).viewportY
  await controls(page).getByRole('button', { name: 'Scroll up a page' }).focus()
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await state(page)).viewportY).toBeLessThan(start)
  const once = (await state(page)).viewportY
  await page.waitForTimeout(550)
  expect((await state(page)).viewportY).toBe(once)
  const screen = page.locator('[data-pane-id="left"] .xterm-screen').first()
  await screen.hover({ position: { x: 20, y: 40 } })
  await page.mouse.wheel(0, -120)
  await expect.poll(async () => (await state(page)).viewportY).toBeLessThan(once)
})
