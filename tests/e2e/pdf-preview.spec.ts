import { expect, test } from '@playwright/test'
import { pdfFixture } from '../helpers/pdf-fixture'
import { readFileSync } from 'node:fs'

test('PDF renders selectable text, navigates, restores state and cannot save text', async ({ page }) => {
  await page.goto('/editor-preview.html')
  await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 30000 })
  await page.evaluate(base64 => {
    window.electron.file.stat = async () => ({ size: 4000, mtime: 1 })
    window.electron.file.readBinary = async () => ({ base64, mimeType: 'application/pdf', size: 4000 })
  }, pdfFixture().toString('base64'))
  await page.evaluate(() => (window as any).previewHarness.open('preview.pdf'))
  await expect(page.locator('.pdfViewer .textLayer').first()).toContainText('PDF preview page 1', { timeout: 20000 })
  await expect(page.locator('.pdfViewer canvas').first()).toBeVisible()
  expect(await page.locator('.pdfViewer canvas').count()).toBeLessThan(12)
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: '页码' })).toHaveValue('2')
  await page.getByRole('combobox', { name: 'PDF 缩放' }).selectOption('1.5')
  await page.evaluate(() => (window as any).previewHarness.open('code.ts'))
  await page.evaluate(() => (window as any).previewHarness.open('preview.pdf'))
  await expect(page.getByRole('spinbutton', { name: '页码' })).toHaveValue('2')
  await expect(page.getByRole('combobox', { name: 'PDF 缩放' })).toHaveValue('1.5')
  await page.keyboard.press('Control+s')
  expect(await page.evaluate(() => (window as any).previewHarness.saves)).toEqual([])
  await page.getByRole('combobox', { name: 'PDF 缩放' }).selectOption('page-width')
  await page.setViewportSize({ width: 480, height: 700 })
  await expect(async () => {
    const size = await page.locator('.pdf-scroll').evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth }))
    expect(size.scroll).toBeLessThanOrEqual(size.width + 2)
  }).toPass()
  await page.screenshot({ path: 'artifacts/pdf-preview/narrow.png' })
})

test('damaged PDF shows a readable error', async ({ page }) => {
  await page.goto('/editor-preview.html')
  await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 30000 })
  await page.evaluate(() => {
    window.electron.file.stat = async () => ({ size: 10 })
    window.electron.file.readBinary = async () => ({ base64: btoa('not a PDF'), size: 10 })
  })
  await page.evaluate(() => (window as any).previewHarness.open('broken.pdf'))
  await expect(page.locator('.pdf-preview [role="alert"]')).toContainText('无法显示此 PDF')
})

test('encrypted PDF accepts a password after rejecting an incorrect one', async ({ page }) => {
  // Generated with PDFKit 0.20.2: userPassword=preview-test, one Helvetica text page.
  const bytes = readFileSync('tests/fixtures/pdf/password.pdf')
  await page.goto('/editor-preview.html')
  await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 30000 })
  await page.evaluate(base64 => {
    window.electron.file.stat = async () => ({ size: 2000 })
    window.electron.file.readBinary = async () => ({ base64, size: 2000 })
  }, bytes.toString('base64'))
  await page.evaluate(() => (window as any).previewHarness.open('password.pdf'))
  await page.getByRole('textbox', { name: 'PDF 密码' }).fill('wrong')
  await page.getByRole('button', { name: '打开 PDF', exact: true }).click()
  await expect(page.getByText('密码不正确，请重试。')).toBeVisible()
  await page.getByRole('textbox', { name: 'PDF 密码' }).fill('preview-test')
  await page.getByRole('button', { name: '打开 PDF', exact: true }).click()
  await expect(page.locator('.pdfViewer .textLayer')).toContainText('Encrypted PDF preview')
})
