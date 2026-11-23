import { test, expect } from '@playwright/test'

test('image stays visible, copies, previews, saves and becomes a reference on the next Codex turn', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/codex-conversation.html?initialView=conversation')
  await page.evaluate(() => (window as any).codexFixture.generatedImage())
  const preview = page.getByRole('button', { name: 'Preview image', exact: true })
  await expect(preview).toBeVisible()
  await expect(preview.locator('img')).toBeVisible()
  await page.getByRole('button', { name: 'Copy image', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Image copied', exact: true })).toBeVisible()
  expect(await page.evaluate(async () => (await navigator.clipboard.read())[0].types)).toContain('image/png')
  await preview.click()
  await expect(page.getByRole('dialog', { name: 'Preview image' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Preview image' })).not.toBeVisible()
  await page.getByRole('button', { name: 'Save image', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).codexFixture.calls.opens)).toContain('image:image-item:image-file')
  const input = page.getByRole('combobox', { name: 'Message Codex', exact: true })
  await input.fill('Keep this draft')
  await page.getByRole('button', { name: 'Use as reference', exact: true }).click()
  await expect(input).toContainText('Keep this draft')
  await input.press('Control+End')
  await input.pressSequentially(' Make the background blue')
  await input.press('Enter')
  await expect.poll(() => page.evaluate(() => (window as any).codexFixture.calls.commands.find((c: any) => c.type === 'send')?.imagePaths)).toEqual(['C:/fixture/generated.png'])
})

test('output image preview centers the image and fits the window as it resizes', async ({ page }) => {
  await page.goto('/codex-conversation.html?initialView=conversation')
  await page.evaluate(() => {
    ;(window as any).codexFixture.generatedImage()
    const canvas = document.createElement('canvas')
    canvas.width = 650
    canvas.height = 1600
    const base64 = canvas.toDataURL('image/png').split(',')[1]
    window.electron.file.readBinary = async () => ({ base64, mimeType: 'image/png', size: atob(base64).length })
  })
  const trigger = page.getByRole('button', { name: 'Preview image', exact: true })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Preview image' })
  const image = dialog.locator('img')
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalHeight)).toBe(1600)

  for (const viewport of [{ width: 1024, height: 768 }, { width: 380, height: 420 }]) {
    await page.setViewportSize(viewport)
    await expect.poll(() => dialog.evaluate(element => {
      const panel = element.getBoundingClientRect()
      const photo = element.querySelector('img')!.getBoundingClientRect()
      return {
        centered: [panel, photo].every(rect => Math.abs(rect.left + rect.width / 2 - innerWidth / 2) <= 1
          && Math.abs(rect.top + rect.height / 2 - innerHeight / 2) <= 1),
        fits: panel.left >= 0 && panel.top >= 0 && panel.right <= innerWidth && panel.bottom <= innerHeight
          && photo.left >= panel.left && photo.top >= panel.top && photo.right <= panel.right && photo.bottom <= panel.bottom,
      }
    })).toEqual({ centered: true, fits: true })
  }

  await dialog.getByRole('button', { name: 'Actual size', exact: true }).click()
  await expect.poll(() => image.evaluate(element => element.getBoundingClientRect().height)).toBe(1600)
  expect(await image.evaluate(element => element.parentElement!.scrollHeight > element.parentElement!.clientHeight)).toBe(true)
  await dialog.getByRole('button', { name: 'Fit window', exact: true }).click()
  await expect(image).toBeInViewport({ ratio: 1 })

  await page.mouse.click(12, 12)
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('missing image leaves readable history and disables invalid actions', async ({ page }) => {
  await page.goto('/codex-conversation.html?initialView=conversation')
  await page.evaluate(() => (window as any).codexFixture.generatedImage(true))
  await expect(page.getByText('Image unavailable', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copy image', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Save image', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Use as reference', exact: true })).toBeDisabled()
  await expect(page.getByText('Image ready', { exact: true })).toBeVisible()
})

test('copies the original bitmap from a streaming Markdown image', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/codex-conversation.html?initialView=conversation')
  const input = page.getByRole('combobox', { name: 'Message Codex', exact: true })
  await input.fill('Draw a chart'); await input.press('Enter')
  await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 630; canvas.height = 360
    const brush = canvas.getContext('2d')!
    brush.fillStyle = '#2f7d51'
    brush.fillRect(0, 0, canvas.width, canvas.height)
    const base64 = canvas.toDataURL('image/png').split(',')[1]
    window.electron.file.readBinary = async () => ({ base64, mimeType: 'image/png', size: atob(base64).length })
    ;(window as any).codexFixture.delta('![Live chart](chart.png)')
  })

  const copy = page.getByRole('button', { name: 'Copy image', exact: true })
  await expect(copy).toBeEnabled()
  await copy.click()
  await expect(page.getByRole('button', { name: 'Image copied', exact: true })).toBeVisible()
  expect(await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read()
    const bitmap = await createImageBitmap(await item.getType('image/png'))
    const canvas = document.createElement('canvas')
    const brush = canvas.getContext('2d')!
    brush.drawImage(bitmap, 0, 0)
    const result = { width: bitmap.width, height: bitmap.height, pixel: [...brush.getImageData(0, 0, 1, 1).data] }
    bitmap.close()
    return result
  })).toEqual({ width: 630, height: 360, pixel: [47, 125, 81, 255] })

  await page.evaluate(() => (window as any).codexFixture.finish())
  await expect(page.getByRole('img', { name: 'Live chart' })).toBeVisible()
})

test('copies an external image with CORS and reports a blocked source', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/codex-conversation.html?initialView=conversation')
  const base64 = await page.evaluate(() => document.createElement('canvas').toDataURL('image/png').split(',')[1])
  const body = Buffer.from(base64, 'base64')
  const host = 'https://images.example.test'
  await page.route(`${host}/allowed.png`, route => route.fulfill({ contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' }, body }))
  await page.route(`${host}/blocked.png`, route => route.fulfill({ contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': host }, body }))
  const input = page.getByRole('combobox', { name: 'Message Codex', exact: true })
  await input.fill('Show external images'); await input.press('Enter')
  await page.evaluate(host => {
    ;(window as any).codexFixture.delta(`![Allowed](${host}/allowed.png)\n\n![Blocked](${host}/blocked.png)`)
  }, host)
  const copy = page.getByRole('button', { name: 'Copy image', exact: true })
  await expect(copy).toHaveCount(2)
  await copy.first().click()
  await expect(page.getByRole('button', { name: 'Image copied', exact: true })).toBeVisible()
  await copy.last().click()
  await expect(page.getByRole('button', { name: 'Could not copy image', exact: true })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Blocked', exact: true })).toBeVisible()
})
