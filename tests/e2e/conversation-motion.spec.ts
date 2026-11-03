import { test, expect } from '@playwright/test'

for (const engine of ['codex', 'claude', 'opencode', 'pi', 'dsh']) test(`${engine} moves and shows loading before the first send is acknowledged`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto(`/codex-conversation.html?engine=${engine}&initialView=conversation`)
  const input = page.locator('[data-conversation-input]')
  await expect(input).toBeFocused()
  await input.fill('Delayed first message')
  const before = await input.evaluate(el => el.closest('form')!.getBoundingClientRect().top)
  await page.evaluate(() => (window as any).codexFixture.holdSend())
  await input.press('Enter')
  // The fixture deliberately publishes no snapshot or user message until released.
  await expect(page.locator('[data-empty=false]')).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Thinking' })).toBeVisible()
  await expect.poll(() => input.evaluate(el => el.closest('form')!.getBoundingClientRect().top)).toBeGreaterThan(before + 80)
  await input.press('Enter')
  expect(await page.evaluate(() => (window as any).codexFixture.calls.sends)).toEqual(['Delayed first message'])
  await expect(input).toHaveText('')
  await expect(page.getByText('Delayed first message', { exact: true })).toHaveCount(1)
  await page.evaluate(() => (window as any).codexFixture.releaseSend())
  await expect(input).toHaveText('')
  await expect(page.getByText('Delayed first message', { exact: true })).toHaveCount(1)
  await expect(page.locator('[data-empty=false]')).toBeVisible()
})

test('rejected first send retains the message and explicitly restores the draft with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/codex-conversation.html?initialView=conversation')
  const input = page.locator('[data-conversation-input]')
  await expect(input).toBeFocused()
  await input.fill('Keep the draft on failure')
  await page.evaluate(() => (window as any).codexFixture.holdSend())
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.locator('[data-empty=false]')).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Thinking' })).toBeVisible()
  expect(await input.evaluate(el => el.closest('form')!.getAnimations().length)).toBe(0)
  await page.evaluate(() => (window as any).codexFixture.releaseSend(true))
  await expect(page.getByRole('alert')).toHaveText('Error: Fixture send failed')
  await expect(page.getByText('Keep the draft on failure', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Edit / restore draft' }).click()
  await expect(page.locator('[data-empty=true]')).toBeVisible()
  await expect(input).toHaveText('Keep the draft on failure')
  await expect(page.getByRole('status').filter({ hasText: 'Thinking' })).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).codexFixture.calls.sends)).toEqual(['Keep the draft on failure'])
})

for (const engine of ['codex', 'claude']) test(`${engine} moves the first composer smoothly from the center to the bottom`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  if (engine === 'claude') await page.setViewportSize({ width: 380, height: 700 })
  await page.goto(`/codex-conversation.html?engine=${engine}`)
  await page.getByRole('button', { name: 'Conversation', exact: true }).click()
  const input = page.getByRole('combobox', { name: `Message ${engine === 'claude' ? 'Claude' : 'Codex'}` })
  await expect(input).toBeFocused()
  await input.fill('First message')
  const before = await input.evaluate(el => el.closest('form')!.getBoundingClientRect().top)
  await input.press('Enter')
  const positions = await input.evaluate(el => {
    const form = el.closest('form')!
    const animation = form.getAnimations().find(a => (a.effect as KeyframeEffect).getKeyframes().some(frame => frame.transform))!
    animation.pause()
    const duration = Number(animation.effect!.getTiming().duration)
    animation.currentTime = 0
    const start = form.getBoundingClientRect().top
    animation.currentTime = duration / 2
    const middle = form.getBoundingClientRect().top
    animation.currentTime = duration
    const end = form.getBoundingClientRect().top
    animation.currentTime = duration / 2
    return { start, middle, end }
  })
  expect(Math.abs(positions.start - before)).toBeLessThan(2)
  expect(positions.end - positions.start).toBeGreaterThan(80)
  expect(positions.middle).toBeGreaterThan(positions.start)
  expect(positions.middle).toBeLessThan(positions.end)
  await page.evaluate(() => (window as any).codexFixture.delta('Reply while the composer is moving.'))
  await expect(page.getByText('Reply while the composer is moving.')).toBeVisible()
  await expect(input).toBeFocused()
  await page.screenshot({ path: `artifacts/codex-dual-mode/first-send-${engine}.png` })
  if (engine === 'claude') {
    await page.getByRole('button', { name: 'Terminal', exact: true }).click()
    expect(await page.getByRole('combobox', { name: 'Message Claude', includeHidden: true }).evaluate(el => el.closest('form')!.getAnimations().length)).toBe(0)
    await page.getByRole('button', { name: 'Conversation', exact: true }).click()
    await expect(input).toBeFocused()
  } else await input.evaluate(el => el.closest('form')!.getAnimations().forEach(animation => animation.finish()))
  expect(await input.evaluate(el => el.closest('form')!.getBoundingClientRect().top)).toBeCloseTo(positions.end, 0)
  expect(await page.evaluate(() => (window as any).codexFixture.calls.sends)).toEqual(['First message'])
})


test('/new smoothly returns the existing composer to the center', async ({ page }) => {
  page.on('pageerror', error => console.error(error.message))
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/codex-conversation.html?initialView=conversation')
  const input = page.locator('[data-conversation-input]')
  await expect(input).toBeFocused()
  await page.evaluate(() => (window as any).codexFixture.editPreview())
  await expect(page.locator('[data-empty=false]')).toBeVisible()
  await input.evaluate(el => el.closest('form')!.getAnimations().forEach(a => a.finish()))
  await input.fill('/new')
  const before = await input.evaluate(el => {
    el.setAttribute('data-original-input', 'yes')
    return el.closest('form')!.getBoundingClientRect().top
  })
  await input.press('Enter')
  await expect(page.locator('[data-empty=true]')).toBeVisible()
  const positions = await input.evaluate(el => {
    const form = el.closest('form')!
    const animation = form.getAnimations().find(a => (a.effect as KeyframeEffect).getKeyframes().some(frame => frame.transform))!
    animation.pause()
    const duration = Number(animation.effect!.getTiming().duration)
    animation.currentTime = 0
    const start = form.getBoundingClientRect().top
    animation.currentTime = duration / 2
    const middle = form.getBoundingClientRect().top
    animation.currentTime = duration
    const end = form.getBoundingClientRect().top
    animation.finish()
    return { start, middle, end }
  })
  expect(Math.abs(positions.start - before)).toBeLessThan(2)
  expect(positions.start - positions.end).toBeGreaterThan(80)
  expect(positions.middle).toBeLessThan(positions.start)
  expect(positions.middle).toBeGreaterThan(positions.end)
  await expect(input).toHaveAttribute('data-original-input', 'yes')
  await expect(input).toBeFocused()
})