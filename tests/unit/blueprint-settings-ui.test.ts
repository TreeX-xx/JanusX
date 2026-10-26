import { beforeAll, afterAll, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'

let browser: Browser, script: string, css: string
beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {Settings} from './plugins/blueprint/src/ui/Settings';
    import {setLocale} from './plugins/blueprint/src/ui/i18n';
    import './plugins/blueprint/src/ui/style.css';
    setLocale('zh-CN');
    createRoot(document.getElementById('root')).render(<div className="settings-surface"><Settings models={[]} saved={() => {}} /></div>);
  ` }, plugins: [{ name: 'isolated-settings-host', setup(builder) {
    builder.onResolve({ filter: /^\.\/client$/ }, () => ({ path: 'settings-host', namespace: 'fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'ts', contents: `
      const initial = {generation: {providerId: '', modelId: ''}, jev: {enabled: false, endpoint: 'https://api.typesafe.ai/v1/systemone', model: 'jev-1.13.0'}, automatic: {enabled: false, commits: 5}};
      const state = window.fixture = {value: initial, revision: 1, calls: [], stored: null, storageRevision: 0, key: '', conflict: false, ready: false, checking: false};
      const providers = [{id: 'fixture', name: 'Fixture provider', models: [{id: 'fixture-model', name: 'Fixture model'}]}];
      const snapshot = () => ({value: structuredClone(state.value), revision: state.revision.toString(16).padStart(64, '0')});
      export const plugin = () => ({storage: {
        get: async () => ({found: state.stored !== null, value: state.stored, revision: state.storageRevision}),
        set: async ({value}) => {state.stored = structuredClone(value); return {revision: ++state.storageRevision}},
        delete: async () => {state.stored = null; return {revision: ++state.storageRevision}},
      }});
      export async function call(method, input, signal) {
        state.calls.push({method, input: method.includes('credential-set') ? '<redacted>' : input});
        if(method === 'migration.status') return {steps: {}};
        if(method === 'models.catalog') return providers;
        if(method === 'settings.snapshot') return snapshot();
        if(method === 'settings.update') {if(state.conflict) throw Error('RESOURCE_CHANGED'); state.value = structuredClone(input.value); state.revision++; return state.value;}
        if(method === 'settings.credential-status') return {configured: !!state.key};
        if(method === 'settings.credential-set') {state.key = input.value; return {configured: !!state.key};}
        if(method === 'settings.check') {
          if(state.checking) await new Promise(resolve => setTimeout(resolve, 500));
          signal?.throwIfAborted();
          return {generation: {status: state.ready ? 'ready' : 'missing'}, jev: {status: state.value.jev.enabled ? 'ready' : 'disabled'}};
        }
        if(method === 'mcp.status' || method === 'mcp.change') return {available: true, clients: [{id:'codex',label:'Codex',path:'C:/fixture/.codex/config.toml',hash:'a'.repeat(64),state: method === 'mcp.change' ? 'current' : 'absent'}]};
        if(method === 'mcp.probe') return {ok: true, tools: ['note.read']};
        throw Error(method);
      }
    ` }))
  } }], bundle: true, write: false, outfile: 'settings-ui.js', jsx: 'automatic', format: 'iife' })
  script = result.outputFiles.find(file => file.path.endsWith('.js'))!.text
  css = result.outputFiles.find(file => file.path.endsWith('.css'))!.text
}, 30_000)
afterAll(async () => { await browser?.close() })
async function mount(width = 850) {
  const page = await browser.newPage({ viewport: { width, height: 980 } })
  page.setDefaultTimeout(6000)
  await page.setContent('<div id="root"></div>')
  await page.addStyleTag({ content: css })
  await page.addScriptTag({ content: script })
  await page.getByRole('heading', { name: '审核模型', exact: true }).waitFor()
  return page
}
const count = (page: Page, method: string) => page.evaluate(method => (window as any).fixture.calls.filter((call: any) => call.method === method).length, method)

it('restores original cards, keyboard dropdowns, commit steps and automatic connection checks', async () => {
  const page = await mount()
  try {
    expect(await page.locator('.blueprint-settings > fieldset').count()).toBe(3)
    await expect.poll(() => count(page, 'settings.check')).toBe(1)
    expect(await page.getByRole('checkbox', { name: '自动审核', exact: true }).isDisabled()).toBe(true)
    await page.getByRole('button', { name: '建议生成提供方', exact: true }).click()
    await page.getByRole('option', { name: 'Fixture provider', exact: true }).click()
    await page.getByRole('button', { name: '建议生成模型', exact: true }).press('ArrowDown')
    await page.keyboard.press('End'); await page.keyboard.press('Enter')
    await expect.poll(() => page.evaluate(() => (window as any).fixture.value.generation)).toEqual({ providerId: 'fixture', modelId: 'fixture-model' })
    await page.evaluate(() => { (window as any).fixture.ready = true })
    await expect.poll(() => count(page, 'settings.check')).toBeGreaterThan(1)
    await expect.poll(() => page.getByRole('checkbox', { name: '自动审核', exact: true }).isEnabled()).toBe(true)
    await page.getByRole('button', { name: '增加每轮提交数', exact: true }).click()
    await expect.poll(() => page.evaluate(() => (window as any).fixture.value.automatic.commits)).toBe(6)
    await page.getByRole('button', { name: '减少每轮提交数', exact: true }).click()
    await expect.poll(() => page.evaluate(() => (window as any).fixture.value.automatic.commits)).toBe(5)
    const before = await count(page, 'models.catalog')
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect.poll(() => count(page, 'models.catalog')).toBe(before + 1)
    await page.getByRole('button', { name: '重新检测', exact: true }).click()
    await expect.poll(() => page.getByRole('button', { name: '重新检测', exact: true }).isEnabled()).toBe(true)
    await mkdir('artifacts/plugins', { recursive: true })
    await page.screenshot({ path: 'artifacts/plugins/blueprint-settings-restored.png', fullPage: true })
  } finally { await page.close() }
}, 20_000)

it('edits JEV inline, masks replacement keys, clears host credentials and never drafts secrets', async () => {
  const page = await mount()
  try {
    await page.getByRole('checkbox', { name: 'JEV 建议评分（可选）', exact: true }).check()
    await page.getByLabel('JEV 接口', { exact: true }).fill('https://api.typesafe.ai/v1/systemone')
    const key = page.getByLabel('JEV 凭据', { exact: true })
    await key.fill('fixture-secret')
    expect(await key.getAttribute('type')).toBe('password')
    await expect.poll(() => page.evaluate(() => (window as any).fixture.key)).toBe('fixture-secret')
    await page.getByRole('button', { name: '显示 JEV 凭据', exact: true }).click()
    expect(await key.getAttribute('type')).toBe('text')
    expect(await page.evaluate(() => JSON.stringify((window as any).fixture.stored))).not.toContain('fixture-secret')
    await page.getByRole('button', { name: '清除凭据', exact: true }).click()
    await expect.poll(() => page.evaluate(() => (window as any).fixture.key)).toBe('')
    expect(await key.getAttribute('type')).toBe('password')
    expect(await key.inputValue()).toBe('')
  } finally { await page.close() }
})

it('keeps conflict recovery and same-page MCP actions at narrow widths', async () => {
  const page = await mount(460)
  try {
    await page.evaluate(() => { (window as any).fixture.conflict = true })
    await page.getByLabel('每轮检查的提交数', { exact: true }).fill('8')
    await page.getByRole('alert').filter({ hasText: 'RESOURCE_CHANGED' }).waitFor()
    expect(await page.getByLabel('每轮检查的提交数', { exact: true }).inputValue()).toBe('8')
    await page.getByRole('button', { name: '放弃草稿并重新载入', exact: true }).click()
    await expect.poll(() => page.getByLabel('每轮检查的提交数', { exact: true }).inputValue()).toBe('5')
    await page.getByRole('group', { name: 'Codex', exact: true }).getByRole('button', { name: '导入', exact: true }).click()
    await expect.poll(() => count(page, 'mcp.change')).toBe(1)
    await page.getByRole('button', { name: '检测服务', exact: true }).click()
    await page.getByRole('status').filter({ hasText: '服务握手和 Note 读取已通过' }).waitFor()
    await page.getByRole('button', { name: '了解 MCP 接入功能', exact: true }).click()
    await page.getByRole('tooltip').waitFor()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: 'artifacts/plugins/blueprint-settings-narrow.png', fullPage: true })
  } finally { await page.close() }
})
