import { expect, test } from '@playwright/test'
import { installHtmlPreviewFixture } from './html-preview-fixture'

const samples = {
  responsive: '<!doctype html><style>html,body{margin:0}main{width:100vw;height:100vh;background:#123456}</style><main>Responsive page</main>',
  fixed: '<!doctype html><style>html,body{margin:0}main{width:1000px;height:700px;background:#123456;position:relative}span{position:absolute;right:0;bottom:0}</style><main>Fixed canvas<span>END</span></main>',
  clipped: '<!doctype html><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}main{width:1000px;height:700px;background:#123456;position:relative}span{position:absolute;right:0;bottom:0}</style><main>Clipped canvas<span>END</span></main>',
}

for (const name of ['responsive', 'fixed', 'clipped'] as const) {
  test('HTML fits ' + name + ' content and supports responsive and actual size', async ({ page }, testInfo) => {
    await installHtmlPreviewFixture(page)
    await page.setViewportSize({ width: 1100, height: 760 })
    await page.goto('/editor-preview.html')
    await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 20_000 })
    await page.evaluate(html => (window as any).previewHarness.open('sample.html', html), samples[name])
    await page.getByRole('radio', { name: '双栏', exact: true }).click()
    const frame = page.frameLocator('iframe')
    await expect(frame.locator('main')).toBeVisible()
    await expect.poll(() => frame.locator('html').evaluate(() => innerWidth)).toBe(1280)
    const viewport = page.locator('[data-html-viewport]')
    await expect.poll(() => viewport.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThan(3)
    if (name !== 'responsive') await expect(frame.locator('span')).toBeInViewport()
    await page.screenshot({ path: testInfo.outputPath(name + '-fit.png') })
    await page.getByRole('button', { name: '预览选项' }).click()
    await page.getByRole('combobox', { name: '预览缩放' }).selectOption('100')
    await expect.poll(() => viewport.evaluate(el => el.scrollWidth - el.clientWidth)).toBeGreaterThan(600)
    await viewport.evaluate(el => { el.scrollLeft = el.scrollWidth; el.scrollTop = el.scrollHeight })
    expect(await viewport.evaluate(el => el.scrollLeft)).toBeGreaterThan(0)
    await page.getByRole('combobox', { name: '预览视口' }).selectOption('responsive')
    await expect.poll(() => frame.locator('html').evaluate(() => innerWidth)).toBeLessThan(600)
    await expect(page.getByRole('combobox', { name: '预览缩放' })).toBeDisabled()
    await page.keyboard.press('Escape')
    await page.getByRole('radio', { name: '预览', exact: true }).click()
    await expect.poll(() => frame.locator('html').evaluate(() => innerWidth)).toBeGreaterThan(1000)
  })
}

test('HTML loads relative CSS and JS, updates drafts, disables scripts and releases the preview', async ({ page }) => {
  const state = await installHtmlPreviewFixture(page)
  await page.goto('/editor-preview.html')
  await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 20_000 })
  const html = '<!doctype html><link rel="stylesheet" href="./theme.css"><main id="page">Initial</main><script src="./page.js"></script>'
  await page.evaluate(content => (window as any).previewHarness.open('docs/external.html', content), html)
  const main = page.frameLocator('iframe').locator('#page')
  await expect(main).toHaveCSS('background-color', 'rgb(18, 52, 86)')
  await expect(main).toHaveAttribute('data-ready', 'yes')
  await page.getByRole('button', { name: '预览选项' }).click()
  await page.getByRole('button', { name: '禁用脚本' }).click()
  await expect(main).not.toHaveAttribute('data-ready', 'yes')
  await expect(main).toHaveCSS('background-color', 'rgb(18, 52, 86)')
  await page.getByRole('button', { name: '预览选项' }).click()
  await page.getByRole('button', { name: '启用脚本' }).click()
  await expect(main).toHaveAttribute('data-ready', 'yes')
  await page.evaluate(content => {
    const h = (window as any).previewHarness
    h.state().updateContent(h.state().activeFileId, content)
  }, html.replace('Initial', 'Unsaved draft'))
  await expect(main).toContainText('Unsaved draft')
  expect(state.opened).toBe(1)
  expect(state.updated).toBe(1)
  expect(await page.evaluate(() => (window as any).previewHarness.saves.length)).toBe(0)
  await page.getByRole('radio', { name: '代码', exact: true }).click()
  await expect.poll(() => state.closed).toBe(1)
})

test('HTML fallback keeps executable documents isolated from the application', async ({ page }) => {
  await page.goto('/editor-preview.html')
  await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 20_000 })
  const html = '<!doctype html><main id="page">Fallback</main><script>try{document.getElementById("page").dataset.parent=typeof parent.electron}catch{document.getElementById("page").dataset.parent="isolated"}</script>'
  await page.evaluate(content => (window as any).previewHarness.open('fallback.html', content), html)
  await expect(page.getByRole('status')).toBeVisible()
  await expect(page.frameLocator('iframe').locator('#page')).toHaveAttribute('data-parent', 'isolated')
})
