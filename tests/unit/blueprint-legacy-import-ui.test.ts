// Note: .agents/notes/planning/blueprint-official-plugin.md
import { afterAll, beforeAll, expect, it } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { build } from 'esbuild'

let browser: Browser, script: string
beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {LegacyImport} from './plugins/blueprint/src/ui/LegacyImport';
    import {setLocale} from './plugins/blueprint/src/ui/i18n';
    setLocale('en');
    createRoot(document.getElementById('root')).render(<LegacyImport changed={() => window.fixture.refreshes++} />);
  ` }, plugins: [{ name: 'legacy-host', setup(builder) {
    builder.onResolve({ filter: /^\.\/client$/ }, () => ({ path: 'client', namespace: 'fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'ts', contents: `
      const state = window.fixture = {calls: [], applied: false, fail: false, refreshes: 0};
      export async function call(method, input) {
        state.calls.push({method,input});
        if(method === 'legacy.list') return state.applied ? [] : [{id:'old',name:'Old board',nodes:1}];
        if(method === 'legacy.preview') return {token:'exact-preview', notes:[{uri:'note://repo/id',title:'Imported requirement',kind:'requirement'}],warnings:[], documents:[{relativePath:'requirement.md',markdown:'# Imported requirement\\nExact preview content.'}]};
        if(method === 'legacy.apply') {if(state.fail) throw Error('RESOURCE_CHANGED'); state.applied=true; return {};}
        throw Error(method);
      }
    ` }))
  } }], bundle: true, write: false, jsx: 'automatic', format: 'iife' })
  script = result.outputFiles[0].text
}, 30_000)
afterAll(async () => { await browser?.close() })

it('requires an exact preview before importing and consumes a failed confirmation', async () => {
  const page = await browser.newPage()
  try {
    await page.setContent('<div id="root"></div>')
    await page.addScriptTag({ content: script })
    const count = (method: string) => page.evaluate(method => (window as any).fixture.calls.filter((item: any) => item.method === method).length, method)
    await page.getByRole('button', { name: 'Import legacy Blueprint', exact: true }).click()
    await page.getByRole('button', { name: 'Read legacy Blueprints', exact: true }).click()
    await page.getByRole('button', { name: 'Old board', exact: false }).click()
    await page.getByText('requirement · Imported requirement').waitFor()
    await page.getByText('requirement.md', { exact: true }).click()
    await page.getByText('Exact preview content.', { exact: false }).waitFor()
    expect(await count('legacy.apply')).toBe(0)
    await page.evaluate(() => { (window as any).fixture.fail = true })
    await page.getByRole('button', { name: 'Confirm import', exact: true }).click()
    await page.getByRole('alert').waitFor()
    expect(await page.getByRole('button', { name: 'Confirm import', exact: true }).count()).toBe(0)
    expect(await count('legacy.apply')).toBe(1)
    await page.evaluate(() => { (window as any).fixture.fail = false })
    await page.getByRole('button', { name: 'Old board', exact: false }).click()
    await page.getByRole('button', { name: 'Confirm import', exact: true }).click()
    await expect.poll(() => page.evaluate(() => (window as any).fixture.refreshes)).toBe(1)
    expect(await page.getByRole('button', { name: 'Old board', exact: false }).count()).toBe(0)
    expect(await page.evaluate(() => (window as any).fixture.calls.filter((item: any) => item.method === 'legacy.apply').map((item: any) => item.input))).toEqual(['exact-preview', 'exact-preview'])
  } finally { await page.close() }
})
