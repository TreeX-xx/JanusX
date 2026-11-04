import { afterAll, beforeAll, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from '@playwright/test'
import { build } from 'esbuild'

let browser: Browser
let script: string
let css: string
beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
  const result = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React from 'react'
      import { createRoot } from 'react-dom/client'
      import i18n from 'i18next'
      import { initReactI18next } from 'react-i18next'
      import common from './src/renderer/src/i18n/locales/en/common.json'
      import { HostedConnectionNotice } from './src/renderer/src/components/HostedConnectionNotice'
      const root = createRoot(document.getElementById('root'))
      window.retries = 0; window.copied = ''; window.copyFails = false
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => {
        if (window.copyFails) throw Error('denied'); window.copied = text
      } } })
      window.showConnection = connection => root.render(<HostedConnectionNotice key={connection.provider + connection.status}
        connection={connection} onRetry={() => window.retries++} />)
      i18n.use(initReactI18next).init({lng:'en',resources:{en:{common}},interpolation:{escapeValue:false}})
        .then(() => window.ready = true)
    ` },
    bundle: true, write: false, outfile: 'hosted.js', jsx: 'automatic', format: 'iife',
    alias: { '@': process.cwd() + '/src/renderer/src' },
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'i18n-host', setup(builder) {
      builder.onLoad({ filter: /[/\\]i18n[/\\]index\.ts$/ }, () => ({
        contents: "import i18n from 'i18next';export default i18n;export const changeLanguage=lang=>i18n.changeLanguage(lang)", loader: 'ts',
      }))
    } }],
  })
  script = result.outputFiles.find(file => file.path.endsWith('.js'))!.text
  css = result.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? ''
})
afterAll(async () => { await browser?.close() })

async function pageWithConnection(provider: 'github' | 'gitlab', status: string, error?: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 380, height: 320 } })
  await page.setContent('<style>body {font: 13px sans-serif; padding: 16px; --shell-muted: #555;}</style><div id="root"></div>')
  await page.addStyleTag({ content: css })
  await page.addScriptTag({ content: script })
  await page.waitForFunction(() => (window as any).ready)
  await page.evaluate(connection => (window as any).showConnection(connection), { provider, status, error })
  await page.getByRole('status').waitFor()
  return page
}

it('guides a missing glab install, copies the exact login command, and rechecks on demand', async () => {
  const page = await pageWithConnection('gitlab', 'cli-missing')
  try {
    expect(await page.getByRole('link', { name: 'Install glab' }).getAttribute('href')).toBe('https://docs.gitlab.com/cli/')
    await page.getByRole('button', { name: 'Copy login command' }).click()
    expect(await page.evaluate(() => (window as any).copied)).toBe('glab auth login --hostname gitlab.com --web')
    await page.getByRole('button', { name: 'Check again' }).click()
    expect(await page.evaluate(() => (window as any).retries)).toBe(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  } finally { await page.close() }
})

it('uses gh for GitHub and keeps the command visible when clipboard access fails', async () => {
  const page = await pageWithConnection('github', 'unauthenticated')
  try {
    await page.evaluate(() => { (window as any).copyFails = true })
    await page.getByRole('button', { name: 'Copy login command' }).click()
    await page.getByRole('alert').waitFor()
    expect(await page.locator('code').innerText()).toBe('gh auth login --hostname github.com --web')
    expect(await page.getByRole('link').count()).toBe(0)
  } finally { await page.close() }
})

it('shows an established connection without a login prompt', async () => {
  const page = await pageWithConnection('gitlab', 'ready')
  try {
    expect(await page.getByRole('status').innerText()).toContain('Connected to GitLab')
    expect(await page.getByRole('button').count()).toBe(0)
  } finally { await page.close() }
})

it.each(['Connection timed out', 'HTTP 403: insufficient permissions'])('shows error details without assuming a network or login problem: %s', async detail => {
  const page = await pageWithConnection('github', 'error', detail)
  try {
    expect(await page.getByRole('status').innerText()).toBe('Could not check the GitHub connection. Review the error details and retry.')
    expect(await page.getByRole('alert').innerText()).toBe(detail)
    expect(await page.locator('code').count()).toBe(0)
    await page.getByRole('button', { name: 'Check again' }).click()
    expect(await page.evaluate(() => (window as any).retries)).toBe(1)
  } finally { await page.close() }
})
