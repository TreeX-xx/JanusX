import { afterAll, beforeAll, expect, it } from 'vitest'
import { chromium, type Browser } from '@playwright/test'
import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'

let browser: Browser
let script: string
let css: string
beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
  const result = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React from 'react'
      import { createRoot } from 'react-dom/client'
      import { DesktopToastApp } from './src/renderer/src/components/DesktopToastApp'
      window.calls = []; window.frames = new Map(); let frameId = 0
      window.requestAnimationFrame = cb => { window.frames.set(++frameId, cb); return frameId }
      window.cancelAnimationFrame = id => window.frames.delete(id)
      window.tick = () => { const frames = [...window.frames.values()]; window.frames.clear(); frames.forEach(cb => cb(0)) }
      window.electron = { desktopToast: {
        ready: () => window.calls.push('ready'),
        painted: id => window.calls.push({ painted: id, title: document.querySelector('section')?.textContent }),
        action: action => window.calls.push(action),
        onShow: cb => { window.showToast = cb; return () => {} },
        onHide: cb => { window.hideToast = cb; return () => {} },
      } }
      createRoot(document.getElementById('root')).render(<DesktopToastApp />)
    ` },
    bundle: true, write: false, outfile: 'toast.js', jsx: 'automatic', format: 'iife',
    alias: { '@': `${process.cwd()}/src/renderer/src` },
    loader: { '.svg': 'dataurl' },
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'theme-stub', setup(builder) {
      builder.onResolve({ filter: /^@\/services\/theme$/ }, () => ({ path: 'theme', namespace: 'test' }))
      builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: `
        export const getAppTheme = () => new Promise(resolve => window.resolveTheme = resolve)
        export const applyThemeToDocument = theme => document.documentElement.dataset.theme = theme
      ` }))
    } }],
  })
  script = result.outputFiles.find(file => file.path.endsWith('.js'))!.text
  css = result.outputFiles.find(file => file.path.endsWith('.css'))!.text
    + await readFile('src/renderer/src/styles/themes.generated.css', 'utf8')
})
afterAll(async () => { await browser?.close() })

it('fits terminal icons and two-line summaries in the desktop window across themes and statuses', async () => {
  const page = await browser.newPage({ viewport: { width: 380, height: 112 } })
  try {
    await page.setContent('<style>* { box-sizing: border-box } body { margin: 0 }</style><div id="root"></div>')
    await page.addStyleTag({ content: css })
    await page.addScriptTag({ content: script })
    await page.waitForFunction(() => typeof (window as any).resolveTheme === 'function')
    await page.evaluate(() => (window as any).resolveTheme('dark'))
    for (const theme of ['dark', 'planche']) {
      await page.locator('html').evaluate((element, value) => { element.dataset.theme = value }, theme)
      for (const engine of ['codex', 'claude', 'opencode', 'janus', 'pi', 'dsh', 'shell', 'unknown']) {
        for (const type of ['completed', 'attention', 'failed']) {
          await page.evaluate(({ engine, type }) => (window as any).showToast({
            id: `${engine}-${type}`, engine, type, title: '通知标题：需要查看本次执行结果',
            body: '这是一条用于验证通知摘要两行显示的长消息。'.repeat(8),
          }), { engine, type })
          await page.waitForFunction(engine => document.querySelector('section')?.textContent?.includes(engine === 'unknown' ? 'unknown' : engine === 'dsh' ? 'DeepSeek' : engine === 'opencode' ? 'OpenCode' : engine[0].toUpperCase() + engine.slice(1)), engine)
          await page.locator(`section .lucide-${type === 'completed' ? 'check' : type === 'failed' ? 'triangle-alert' : 'circle-help'}`).waitFor()
          const layout = await page.locator('section').evaluate(section => {
            const content = section.querySelector('button')!
            const image = section.querySelector('img')
            const rect = section.getBoundingClientRect()
            return { width: rect.width, height: rect.height, fits: content.scrollHeight <= content.clientHeight,
              iconLoaded: !image || (image.complete && image.naturalWidth > 0),
              background: getComputedStyle(section).backgroundColor }
          })
          expect(layout).toMatchObject({ width: 380, height: 112, fits: true, iconLoaded: true })
          expect(layout.background).toBe(theme === 'dark' ? 'rgb(28, 28, 31)' : 'rgb(239, 228, 197)')
        }
      }
    }
  } finally { await page.close() }
})

it('waits for the initial theme and committed card before acknowledging the delivery', async () => {
  const page = await browser.newPage()
  try {
    await page.setContent('<div id="root"></div>')
    await page.addScriptTag({ content: script })
    await page.waitForFunction(() => typeof (window as any).resolveTheme === 'function')
    expect(await page.evaluate(() => (window as any).calls)).toEqual([])
    await page.evaluate(() => (window as any).resolveTheme('dark'))
    await page.waitForFunction(() => (window as any).calls.includes('ready'))
    expect(await page.locator('html').getAttribute('data-theme')).toBe('dark')
    await page.evaluate(() => (window as any).showToast({ id: 'first', deliveryId: 1, engine: 'codex', title: 'Task done', body: 'Complete' }))
    await page.getByText('Task done').waitFor()
    expect(await page.evaluate(() => (window as any).calls)).toEqual(['ready'])
    await page.evaluate(() => (window as any).tick())
    expect(await page.evaluate(() => (window as any).calls)).toEqual(['ready'])
    await page.evaluate(() => (window as any).tick())
    expect(await page.locator('section img').getAttribute('src')).toContain('data:image/svg+xml')
    expect(await page.locator('section img').getAttribute('aria-hidden')).toBe('true')
    expect(await page.evaluate(() => (window as any).calls)).toEqual(['ready', { painted: 1, title: 'CodexJanusXTask doneComplete' }])
  } finally { await page.close() }
})

it('cancels stale frames and a delayed dismiss when a newer notification arrives', async () => {
  const page = await browser.newPage()
  try {
    await page.setContent('<div id="root"></div>')
    await page.addScriptTag({ content: script })
    await page.waitForFunction(() => typeof (window as any).resolveTheme === 'function')
    await page.evaluate(() => { (window as any).resolveTheme('dark'); (window as any).showToast({ id: 'old', deliveryId: 1, title: 'Old', body: 'Old' }) })
    await page.getByText('Old', { exact: true }).first().waitFor()
    await page.getByLabel('Dismiss notification').click()
    await page.evaluate(() => (window as any).showToast({ id: 'latest', deliveryId: 2, title: 'Latest', body: 'Latest body' }))
    await page.getByText('Latest', { exact: true }).waitFor()
    await page.evaluate(() => { (window as any).tick(); (window as any).tick() })
    await page.waitForTimeout(160)
    expect(await page.locator('section img').count()).toBe(0)
    expect(await page.locator('section svg').count()).toBe(2)
    expect(await page.evaluate(() => (window as any).calls)).toEqual(['ready', { painted: 2, title: 'AgentJanusXLatestLatest body' }])
    await page.evaluate(() => (window as any).hideToast())
    await page.waitForFunction(() => !document.querySelector('section'))
  } finally { await page.close() }
})
