import { expect, test } from '@playwright/test'
import { PNG_PIXEL } from '../helpers/image-fixture'

test('dropped and pasted images preview before sending and survive remount', async ({ page }) => {
  await page.goto('/codex-conversation.html?initialView=conversation')
  const input = page.getByRole('combobox', { name: 'Message Codex' })
  await input.fill('Keep my draft')
  await page.evaluate(base64 => {
    window.electron.file.readBinary = async () => ({ base64, mimeType: 'image/png', size: 68 })
  }, PNG_PIXEL)
  for (const method of ['drop', 'paste']) {
    await input.evaluate((element, method) => {
      const data = new DataTransfer()
      data.items.add(new File(['fixture'], method + '.png', { type: 'image/png' }))
      element.dispatchEvent(method === 'drop'
        ? new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true })
        : new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    }, method)
    const preview = page.getByRole('button', { name: `Preview image: ${method}.png`, exact: true })
    await expect(preview.locator('img')).toBeVisible()
    await expect.poll(() => preview.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1)
    // Measure the text beside the chip, not its containing line box: an image
    // must not supply the baseline for the whole inline reference.
    const alignment = await input.evaluate(element => {
      const text = [...element.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent?.includes('Keep my draft'))!
      const range = document.createRange()
      range.selectNodeContents(text)
      const textRect = range.getBoundingClientRect()
      const chipRect = element.querySelector('[data-reference-token]')!.getBoundingClientRect()
      return Math.abs((textRect.top + textRect.bottom) / 2 - (chipRect.top + chipRect.bottom) / 2)
    })
    expect(alignment).toBeLessThanOrEqual(3)
  }
  await page.getByRole('button', { name: 'Remount', exact: true }).click()
  const preview = page.getByRole('button', { name: 'Preview image: drop.png', exact: true })
  await preview.click()
  const dialog = page.getByRole('dialog', { name: 'Preview image: drop.png' })
  await expect(dialog).toBeVisible()
  await expect.poll(() => dialog.evaluate(element => {
    const bounds = element.getBoundingClientRect()
    return Math.abs(bounds.left + bounds.width / 2 - innerWidth / 2) <= 1
      && Math.abs(bounds.top + bounds.height / 2 - innerHeight / 2) <= 1
  })).toBe(true)
  await page.keyboard.press('Escape')
  await expect(preview).toBeFocused()
  await expect(input).toContainText('Keep my draft')
  expect(await page.evaluate(() => (window as any).codexFixture.calls.sends)).toEqual([])
  await page.setViewportSize({ width: 380, height: 720 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'artifacts/conversation-composer/attachment-preview.png' })
  await page.getByRole('button', { name: 'Remove paste.png' }).click()
  await expect(page.getByRole('button', { name: 'Preview image: paste.png' })).toHaveCount(0)
  await input.press('Enter')
  await expect.poll(() => page.evaluate(() => (window as any).codexFixture.calls.commands.find((item: any) => item.type === 'send')?.imagePaths)).toEqual(['C:/attachments/drop.png'])
})

test('unreadable image stays removable without a broken preview', async ({ page }) => {
  await page.goto('/codex-conversation.html?initialView=conversation')
  await page.getByRole('combobox', { name: 'Message Codex' }).fill('Draft')
  await page.evaluate(() => { window.electron.file.readBinary = async () => ({ error: 'Missing file' }) })
  await page.locator('input[type=file]').setInputFiles({ name: 'missing.png', mimeType: 'image/png', buffer: Buffer.from('fixture') })
  await expect(page.getByText('Image unavailable', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Preview image: missing.png' })).toBeDisabled()
  await page.getByRole('button', { name: 'Remove missing.png' }).click()
  await expect(page.getByText('Image unavailable', { exact: true })).toHaveCount(0)
})
