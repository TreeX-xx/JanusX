import { expect, test } from '@playwright/test'

test('image previews fit both dimensions when the editor window grows or shrinks', async ({ page }) => {
  await page.goto('/editor-preview.html')
  await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 20_000 })
  for (const { width, height, extension } of [{ width: 2400, height: 3600, extension: 'svg' }, { width: 3600, height: 1200, extension: 'png' }, { width: 2400, height: 2400, extension: 'jpg' }, { width: 120, height: 80, extension: 'png' }]) {
    await page.evaluate(({ width, height, extension }) => {
      const mimeType = extension === 'svg' ? 'image/svg+xml' : extension === 'jpg' ? 'image/jpeg' : 'image/png'
      let base64: string
      if (extension === 'svg') {
        base64 = btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="orange"/></svg>`)
      } else {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')!
        context.fillStyle = 'orange'
        context.fillRect(0, 0, width, height)
        base64 = canvas.toDataURL(mimeType).split(',')[1]
      }
      ;(window as any).electron.file.readBinary = async () => ({
        base64, mimeType, size: 200,
      })
    }, { width, height, extension })
    const name = `image-${width}-${height}.${extension}`
    await page.evaluate(name => (window as any).previewHarness.open(name), name)
    const image = page.getByRole('img', { name, exact: true })
    await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(width)
    for (const viewport of [{ width: 800, height: 480 }, { width: 1600, height: 900 }, { width: 600, height: 700 }]) {
      await page.setViewportSize(viewport)
      await expect(async () => {
        const bounds = (await image.boundingBox())!
        expect(bounds.x).toBeGreaterThanOrEqual(0)
        expect(bounds.y).toBeGreaterThanOrEqual(0)
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width)
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height - 30)
        expect(bounds.width / bounds.height).toBeCloseTo(width / height, 2)
        expect(bounds.width).toBeLessThanOrEqual(width)
        expect(bounds.height).toBeLessThanOrEqual(height)
        await expect(page.getByText(extension === 'svg' ? 'image/svg+xml' : extension === 'jpg' ? 'image/jpeg' : 'image/png', { exact: true })).toBeInViewport()
      }).toPass()
    }
  }
})
