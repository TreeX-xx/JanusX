import { afterAll, beforeAll, it } from 'vitest'
import { expect } from '@playwright/test'
import { chromium, type Browser, type Page } from 'playwright'
import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'

let browser: Browser, script: string, css: string
beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import i18n from 'i18next'; import {initReactI18next} from 'react-i18next';
    import zh from './src/renderer/src/i18n/locales/zh-CN/storage.json';
    import {WorkspaceStoragePanel,WorkspaceMigrationNotice,focusWorkspaceStorageSettings} from './src/renderer/src/components/WorkspaceStoragePanel';
    const root='C:/Users/Test/AppData/Roaming/JanusX-Portable/janusx/workspace-state';
    const state=window.fixture={calls:[],status:'pending',dismissed:false,opened:0,focused:0};
    Element.prototype.scrollIntoView=function(){state.focused++;};
    window.focusStorage=focusWorkspaceStorageSettings;
    const item=()=>({id:'w',name:'中文项目',source:'D:/projects/中文项目/.janusX',target:root+'/12345678-1234-1234-1234-123456789012',categories:['janusX.launch.json','checkpoints','logs'],status:state.status});
    window.electron={workspaceStorage:{list:async()=>{state.calls.push('list');return{root,prompt:!state.dismissed,items:[item()]};},dismiss:async()=>{state.calls.push('dismiss');state.dismissed=true;},migrate:async(ids)=>{state.calls.push(['migrate',ids]);state.status='migrated';return[item()];}}};
    i18n.use(initReactI18next).init({lng:'zh-CN',resources:{'zh-CN':{storage:zh}},initImmediate:false});
    const target=createRoot(document.getElementById('root'));
    window.mount=(mode)=>target.render(mode==='notice'?<WorkspaceMigrationNotice onOpen={()=>state.opened++}/>:mode==='empty'?null:<WorkspaceStoragePanel/>);
    window.mount(new URLSearchParams(location.search).get('mode')||'panel');
  ` }, plugins: [{ name: 'isolated-storage-host', setup(builder) {
    builder.onResolve({ filter: /^@\/i18n\/useI18n$/ }, () => ({ path: 'i18n', namespace: 'fixture' }))
    builder.onResolve({ filter: /^@\/stores\/workspace$/ }, () => ({ path: 'workspace', namespace: 'fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'ts', resolveDir: process.cwd(), contents: args.path === 'i18n'
      ? `import {useTranslation} from 'react-i18next'; export const useI18n=(ns)=>useTranslation(ns);`
      : `export const useWorkspaceStore=(select)=>select({workspaces:[{id:'w',path:'D:/projects/demo'}]});` }))
  } }], bundle: true, write: false, outfile: 'storage-ui.js', jsx: 'automatic', format: 'iife' })
  script = result.outputFiles.find(file => file.path.endsWith('.js'))!.text
  css = result.outputFiles.find(file => file.path.endsWith('.css'))!.text
}, 30_000)
afterAll(async () => { await browser?.close() })
async function mount(mode = 'panel', width = 900): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  await page.route('http://storage.test/**', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
  await page.goto(`http://storage.test/?mode=${mode}`)
  await page.addStyleTag({ content: `body{margin:20px;color:#eee;background:#20242a;--shell-text:#eee;--shell-border:#888;--shell-canvas:#20242a;--shell-pane:#272d34;} ${css}` })
  await page.addScriptTag({ content: script })
  return page
}

it('shows exact scope and source/destination before an explicit migration and updates status', async () => {
  const page = await mount()
  try {
    await expect(page.getByText('待迁移', { exact: true })).toBeVisible()
    await expect(page.getByText('D:/projects/中文项目/.janusX', { exact: true })).toBeVisible()
    await expect(page.getByText(/启动配置、检查点历史和命令日志/)).toBeVisible()
    await expect(page.getByText(/校验成功后将自动删除对应旧文件/)).toBeVisible()
    const execute = page.getByRole('button', { name: '迁移并清理旧文件', exact: true })
    await expect(execute).toBeDisabled()
    expect(await page.evaluate(() => (window as any).fixture.calls.filter(Array.isArray))).toEqual([])
    await page.getByRole('checkbox').check()
    await execute.click()
    await expect(page.getByText('迁移完成', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => (window as any).fixture.calls.filter(Array.isArray))).toEqual([['migrate', ['w']]])
  } finally { await page.close() }
})

it('upgrade notice explains location, dismisses once and opens settings without migrating', async () => {
  const page = await mount('notice')
  try {
    await expect(page.getByRole('button', { name: '前往迁移' })).toBeVisible()
    await expect(page.locator('code')).toContainText('JanusX-Portable/janusx/workspace-state')
    expect(await page.evaluate(() => (window as any).fixture.calls.filter(Array.isArray))).toEqual([])
    await page.getByRole('button', { name: '前往迁移' }).click()
    expect(await page.evaluate(() => (window as any).fixture.opened)).toBe(1)
    await page.evaluate(() => (window as any).mount('empty'))
    await page.evaluate(() => (window as any).mount('notice'))
    await expect(page.getByRole('button', { name: '前往迁移' })).toHaveCount(0)
    expect(await page.evaluate(() => (window as any).fixture.calls.filter(Array.isArray))).toEqual([])
  } finally { await page.close() }
})

it('keeps navigation intent until the settings panel mounts', async () => {
  const page = await mount('empty')
  try {
    await page.evaluate(() => { (window as any).focusStorage(); (window as any).mount('panel') })
    await expect.poll(() => page.evaluate(() => (window as any).fixture.focused)).toBe(1)
  } finally { await page.close() }
})

it('wraps full paths at narrow width without horizontal overflow', async () => {
  const page = await mount('panel', 480)
  try {
    await expect(page.getByText('待迁移', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await mkdir('artifacts/workspace-storage', { recursive: true })
    await page.screenshot({ path: 'artifacts/workspace-storage/settings-480.png', fullPage: true })
  } finally { await page.close() }
})
