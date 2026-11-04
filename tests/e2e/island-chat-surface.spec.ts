import { expect, test } from '@playwright/test'

test('opening can reverse mid-morph and reopen without leaving a displaced eye or frame', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/')
  const shell = page.locator('.janus-island-shell')
  await page.getByTestId('reopen-island').click()
  const openingWidth = (await shell.boundingBox())!.width
  expect(openingWidth).toBeLessThan(860)
  await page.keyboard.press('Escape')
  await expect(shell).toHaveAttribute('data-stage', 'collapsed')
  await page.getByTestId('reopen-island').click()
  await expect.poll(async () => Math.round((await shell.boundingBox())!.width)).toBe(860)
  await expect(shell.locator('.janus-chat-input')).toBeVisible()
  const frame = (await shell.boundingBox())!
  const eyes = (await shell.locator('.janus-collapsed-core').boundingBox())!
  expect(Math.abs(eyes.x - frame.x - 12)).toBeLessThanOrEqual(1)
  await page.keyboard.press('Escape')
  await expect.poll(async () => Math.round((await shell.boundingBox())!.width)).toBe(52)
  await expect(shell.locator('.janus-expanded-shell')).toBeHidden()
  const capsule = (await shell.boundingBox())!
  const restingEyes = (await shell.locator('.janus-collapsed-core').boundingBox())!
  expect(restingEyes.x + restingEyes.width / 2).toBeCloseTo(capsule.x + capsule.width / 2, 0)
})

test('reduced motion does not leave a delayed frame or content transition', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await page.getByTestId('reopen-island').click()
  const shell = page.locator('.janus-island-shell')
  await expect(shell.locator('.janus-chat-input')).toBeVisible()
  expect(await shell.evaluate(element => [element, ...element.querySelectorAll(
    '.janus-expanded-shell, .janus-collapsed-core, .janus-expanded-topbar, .janus-expanded-body',
  )].flatMap(node => node.getAnimations()).filter(animation => animation instanceof CSSTransition).length)).toBe(0)
  await page.keyboard.press('Escape')
  await expect(shell.locator('.janus-expanded-shell')).toBeHidden()
  expect(Math.round((await shell.boundingBox())!.width)).toBe(52)
})

test('Chat is the only expanded surface and old pin state cannot prevent dismissal', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('janus:island-chat-pinned', '1'))
  await page.goto('/')
  const shell = page.locator('.janus-island-shell')
  await page.getByTestId('reopen-island').click()
  await expect(shell).toHaveAttribute('data-view', 'chat')
  await expect(shell.locator('.janus-chat-input')).toBeVisible()
  await expect(shell.locator('.janus-expanded-view-switch')).toHaveCount(0)
  await expect(shell.locator('.janus-pin-button')).toHaveCount(0)
  await expect(shell.locator('.janus-roundtable-view, .janus-feedback-panel, .plugin-island-tool')).toHaveCount(0)
  await expect(shell.locator('.janus-collapsed-core [role="img"]')).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('janus:island-chat-pinned'))).toBeNull()
  await page.keyboard.press('Escape')
  await expect(shell).toHaveAttribute('data-stage', 'collapsed')
  await expect(shell).toHaveAttribute('data-loading', 'true')
  await page.getByTestId('reopen-island').click()
  await expect(shell.locator('.janus-chat-input')).toBeVisible()
  await page.mouse.click(4, 600)
  await expect(shell).toHaveAttribute('data-stage', 'collapsed')
})

for (const theme of ['dark', 'planche']) {
  for (const width of [1280, 600]) {
    test(`${theme} Chat and eyes fit a ${width}px viewport`, async ({ page }) => {
      await page.setViewportSize({ width, height: 720 })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto('/memo.html?island=1')
      await page.evaluate(value => { document.documentElement.dataset.theme = value }, theme)
      const shell = page.locator('.janus-island-shell')
      const panel = shell.locator('.janus-expanded-shell')
      const input = shell.locator('.janus-chat-input')
      const eyes = shell.locator('.janus-collapsed-core')
      await expect(input).toBeVisible()
      await expect(eyes).toBeVisible()
      await expect.poll(async () => {
        const box = await panel.boundingBox()
        return box !== null && box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= 720
      }).toBe(true)
      const frame = (await panel.boundingBox())!
      const eye = (await eyes.boundingBox())!
      const composer = (await input.boundingBox())!
      expect(eye.x).toBeGreaterThanOrEqual(frame.x)
      expect(eye.y + eye.height).toBeLessThan(frame.y + 60)
      expect(composer.x + composer.width).toBeLessThanOrEqual(frame.x + frame.width)
      expect(composer.y + composer.height).toBeLessThanOrEqual(frame.y + frame.height)
      await page.screenshot({ path: test.info().outputPath(`chat-${theme}-${width}.png`) })
    })
  }
}
