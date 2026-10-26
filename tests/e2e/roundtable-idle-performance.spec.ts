import { expect, test } from '@playwright/test'

test('hidden roundtable stops layout polling and resumes when shown', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Element.prototype.getBoundingClientRect
    ;(window as any).roundtableReads = 0
    Element.prototype.getBoundingClientRect = function () {
      if (this.matches('.janus-roundtable-stage, .janus-roundtable-seat-pod')) (window as any).roundtableReads++
      return original.call(this)
    }
  })
  await page.goto('/')
  await expect(page.locator('.janus-roundtable-stage')).toBeAttached()
  await page.waitForTimeout(200)
  await page.evaluate(() => { (window as any).roundtableReads = 0 })
  await page.waitForTimeout(200)
  expect(await page.evaluate(() => (window as any).roundtableReads)).toBe(0)

  await page.getByTestId('reopen-island').click()
  await page.locator('.janus-expanded-view-button[data-view="roundtable"]').click()
  await expect(page.locator('.janus-roundtable-stage')).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).roundtableReads)).toBeGreaterThan(5)
  await page.locator('.janus-expanded-view-button[data-view="chat"]').click()
  await expect(page.locator('.janus-roundtable-stage')).toBeHidden()
  await page.waitForTimeout(200)
  await page.evaluate(() => { (window as any).roundtableReads = 0 })
  await page.waitForTimeout(200)
  expect(await page.evaluate(() => (window as any).roundtableReads)).toBe(0)
})
