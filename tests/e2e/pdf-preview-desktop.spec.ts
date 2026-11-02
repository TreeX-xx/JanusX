import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createDesktopTestEnv, seedIntroducedLearning } from './desktop-test-env'
import { pdfFixture } from '../helpers/pdf-fixture'

test('built Electron previews a local PDF offline in embedded and floating windows', async () => {
  const root = await mkdtemp(join(tmpdir(), 'janusx-pdf-'))
  let app: ElectronApplication | undefined
  try {
    const workspacePath = join(root, 'project')
    await mkdir(workspacePath)
    const filePath = join(workspacePath, 'report.pdf')
    await writeFile(filePath, pdfFixture(3))
    app = await electron.launch({ args: [resolve(process.env.JANUS_PDF_TEST_ENTRY ?? 'out/main/index.js'), `--user-data-dir=${join(root, 'data')}`], env: createDesktopTestEnv(root) })
    const main = await app.firstWindow()
    main.on('console', message => { if (message.type() === 'warning' || message.type() === 'error') console.log(message.text()) })
    await main.waitForFunction(() => typeof (window as any).electron?.window?.openEditor === 'function')
    await main.evaluate(() => (window as any).electron.system.setLanguage('zh-CN'))
    await seedIntroducedLearning(main)
    await main.addInitScript(() => {
      ;(window as any).pdfWarnings = []
      const warn = console.warn
      console.warn = (...args) => { (window as any).pdfWarnings.push(args.map(value => value?.message ? { message: value.message, details: value.details, stack: value.stack } : String(value))); warn(...args) }
    })
    await main.reload()
    await expect(main.locator('button[data-id="tool-menu"]')).toBeVisible({ timeout: 40000 })
    await main.evaluate(async path => (window as any).electron.workspace.create({ path, name: 'PDF' }), workspacePath)
    // No PDF resource may depend on the network, even in a production file:// window.
    await main.route(/^https?:/, route => route.abort())
    await main.evaluate(payload => (window as any).electron.window.openEditor(payload), { filePath, workspacePath })
    const embedded = main.locator('[data-editor-host="embedded"]')
    try { await expect(embedded.locator('.pdfViewer .textLayer').first()).toContainText('PDF preview page 1', { timeout: 20000 }) }
    catch (error) { console.log(await main.evaluate(() => (window as any).pdfWarnings)); throw error }
    await embedded.getByRole('button', { name: '下一页', exact: true }).click()
    await embedded.getByRole('button', { name: '更多文件操作' }).click()
    await main.getByRole('dialog', { name: '更多文件操作' }).getByRole('button', { name: '返回独立浮窗' }).click()
    await expect.poll(() => app!.windows().some(page => page.url().includes('editorWindow=1'))).toBe(true)
    const floating = app.windows().find(page => page.url().includes('editorWindow=1'))!
    await expect(floating.getByRole('spinbutton', { name: '页码' })).toHaveValue('2')
    await expect(floating.locator('.pdfViewer [data-page-number="2"] .textLayer')).toContainText('PDF preview page 2')
    await floating.screenshot({ path: 'artifacts/pdf-preview/electron.png' })
  } finally {
    await app?.close()
    await rm(root, { recursive: true, force: true })
  }
})
