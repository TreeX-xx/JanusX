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
    import {WorkspaceUnavailableNotice} from './src/renderer/src/components/WorkspaceDataPanel';
    const root='C:/Users/Test/AppData/Roaming/JanusX-Portable/janusx/workspace-state';
    const state=window.fixture={calls:[],status:'pending',dismissed:false,opened:0,focused:0};
    Element.prototype.scrollIntoView=function(){state.focused++;};
    window.focusStorage=focusWorkspaceStorageSettings;
    const item=()=>({id:'w',name:'中文项目',source:'D:/projects/中文项目/.janusX',target:root+'/12345678-1234-1234-1234-123456789012',categories:['janusX.launch.json','checkpoints','logs'],status:state.status});
    window.electron={workspaceStorage:{list:async()=>{state.calls.push('list');return{root,prompt:!state.dismissed,items:[item()]};},dismiss:async()=>{state.calls.push('dismiss');state.dismissed=true;},migrate:async(ids)=>{state.calls.push(['migrate',ids]);state.status='migrated';return[item()];}}};
    const storage={id:'s',name:'中文项目',path:'D:/projects/demo',target:root+'/12345678-1234-1234-1234-123456789012',workspaceIds:['w'],legacy:false,status:'associated'};
    state.storage=storage;state.canceled=false;state.mismatch=false;state.response=1;state.workspaces=[{id:'w',name:'中文项目',path:storage.path}];
    Object.assign(window.electron.workspaceStorage,{
      retireHooks:async()=>{state.calls.push('retireHooks');if(state.hookError)throw Error(state.hookError);return{commands:2,files:['C:/Users/Test/.janusx/hooks/janusx-agent-hook.ps1'],retained:[{path:'C:/Users/Test/.janusx/hooks/janusx-hook-runner.exe',reason:'Unknown binary retained'}]};},
      data:async()=>{state.calls.push('data');return[{...storage}];},
      measure:async(id)=>{state.calls.push(['measure',id]);return 1024*1024;},
      cleanup:async(id,category)=>{state.calls.push(['cleanup',id,category]);},
      relocate:async(id,path)=>{state.calls.push(['relocate',id,path]);if(state.mismatch)throw Error('WORKSPACE_IDENTITY_MISMATCH');storage.path=path;storage.status='associated';state.workspaces[0].path=path;},
      restore:async(id)=>{state.calls.push(['restore',id]);storage.status='associated';storage.workspaceIds=['w'];delete storage.detachedAt;delete storage.expiresAt;},
    });
    window.electron.dialog={openDirectory:async()=>({canceled:state.canceled,filePaths:['D:/projects/moved']}),showMessageBox:async()=>({response:state.response})};
    window.electron.workspace={list:async()=>state.workspaces,create:async(dto)=>{state.calls.push(['create',dto]);return dto;}};
    i18n.use(initReactI18next).init({lng:'zh-CN',resources:{'zh-CN':{storage:zh}},initImmediate:false});
    const target=createRoot(document.getElementById('root'));
    window.mount=(mode)=>target.render(mode==='notice'?<WorkspaceMigrationNotice onOpen={()=>state.opened++}/>:mode==='unavailable'?<WorkspaceUnavailableNotice/>:mode==='empty'?null:<WorkspaceStoragePanel/>);
    window.mount(new URLSearchParams(location.search).get('mode')||'panel');
  ` }, plugins: [{ name: 'isolated-storage-host', setup(builder) {
    builder.onResolve({ filter: /^@\/i18n\/useI18n$/ }, () => ({ path: 'i18n', namespace: 'fixture' }))
    builder.onResolve({ filter: /^@\/stores\/workspace$/ }, () => ({ path: 'workspace', namespace: 'fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'ts', resolveDir: process.cwd(), contents: args.path === 'i18n'
      ? `import {useTranslation} from 'react-i18next'; export const useI18n=(ns)=>useTranslation(ns);`
      : `const state=()=>({workspaces:window.fixture.workspaces,activeWorkspaceId:'w',setWorkspaces:(items)=>{window.fixture.workspaces=items;}});export const useWorkspaceStore=(select)=>select(state());useWorkspaceStore.getState=state;` }))
  } }], bundle: true, write: false, outfile: 'storage-ui.js', jsx: 'automatic', format: 'iife' })
  script = result.outputFiles.find(file => file.path.endsWith('.js'))!.text
  css = result.outputFiles.find(file => file.path.endsWith('.css'))!.text
}, 30_000)
afterAll(async () => { await browser?.close() })
async function mount(mode = 'panel', width = 900): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  await page.route('http://storage.test/**', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
  await page.goto(`http://storage.test/?mode=${mode}`)
  await page.addStyleTag({ content: `body{margin:20px;font:13px system-ui;color:#e6e6e6;background:#202020;--shell-text:#e6e6e6;--shell-border:#404040;--shell-muted:#a0a0a0;--shell-canvas:#202020;--shell-pane:#292929;} ${css}` })
  await page.addScriptTag({ content: script })
  return page
}

it('shows exact scope and source/destination before an explicit migration and updates status', async () => {
  const page = await mount()
  try {
    await expect(page.getByText('待迁移', { exact: true })).toBeVisible()
    await expect(page.getByText('D:/projects/中文项目/.janusX', { exact: true })).toBeVisible()
    await expect(page.getByText(/仅将旧工作区.*启动配置和命令日志迁入/)).toBeVisible()
    await expect(page.getByText(/旧还原点.*直接清除，不迁移、不保留/)).toBeVisible()
    await expect(page.locator('li').getByText(/旧还原点.*不迁移/)).toBeVisible()
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

it('calculates size only on demand and confirms the selected cleanup category', async () => {
  const page = await mount()
  try {
    const row = page.locator('article').first()
    await expect(row.getByText('已关联', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => (window as any).fixture.calls.filter(Array.isArray))).toEqual([])
    await row.locator('summary').click()
    await row.getByRole('button', { name: '计算占用' }).click()
    await expect(row.getByText('1.00 MiB')).toBeVisible()
    await row.getByRole('button', { name: '清理日志', exact: true }).click()
    const confirm = page.getByRole('group', { name: '确认清理' })
    await expect(confirm).toBeVisible()
    expect(await page.evaluate(() => (window as any).fixture.calls.filter((call: any) => Array.isArray(call) && call[0] === 'cleanup'))).toEqual([])
    await confirm.getByRole('button', { name: '取消', exact: true }).click()
    await row.getByRole('button', { name: '清理旧快照', exact: true }).click()
    await expect(confirm).toContainText('Island')
    await confirm.getByRole('button', { name: '确认清除', exact: true }).click()
    await expect(confirm).toHaveCount(0)
    expect(await page.evaluate(() => (window as any).fixture.calls.filter(Array.isArray))).toEqual([['measure', 's'], ['cleanup', 's', 'checkpoints']])
  } finally { await page.close() }
})

it('relocates through the picker, respects cancel and offers a new import after identity mismatch', async () => {
  const page = await mount()
  try {
    const relocate = page.getByRole('button', { name: '重新定位', exact: true })
    await expect(relocate).toBeVisible()
    await page.evaluate(() => { (window as any).fixture.canceled = true })
    await relocate.click()
    expect(await page.evaluate(() => (window as any).fixture.calls.filter(Array.isArray))).toEqual([])
    await page.evaluate(() => { Object.assign((window as any).fixture, { canceled: false, mismatch: true, response: 0 }) })
    await relocate.click()
    await expect.poll(() => page.evaluate(() => (window as any).fixture.calls.filter((call: any) => Array.isArray(call) && call[0] === 'create').length)).toBe(1)
    await page.evaluate(() => { (window as any).fixture.mismatch = false })
    await relocate.click()
    await expect(page.locator('article').first().getByText('D:/projects/moved', { exact: true })).toBeVisible()
  } finally { await page.close() }
})

it('reattaches detached data and keeps unavailable notices local and dismissible', async () => {
  const page = await mount()
  try {
    await page.evaluate(() => { Object.assign((window as any).fixture.storage, { status: 'detached', workspaceIds: [], detachedAt: '2026-10-31', expiresAt: '2026-11-30' }) })
    await page.getByRole('button', { name: '重新检查', exact: true }).first().click()
    await page.getByRole('button', { name: '恢复关联', exact: true }).click()
    await expect(page.locator('article').first().getByText('已关联', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => (window as any).fixture.calls.filter(Array.isArray))).toEqual([['restore', 's']])
    await page.evaluate(() => { (window as any).fixture.storage.status = 'offline'; (window as any).mount('unavailable') })
    const notice = page.getByRole('complementary')
    await expect(notice).toBeVisible()
    await expect(notice.getByText('D:/projects/demo', { exact: true })).toBeVisible()
    await notice.getByRole('button', { name: '稍后处理', exact: true }).click()
    await expect(notice).toHaveCount(0)
  } finally { await page.close() }
})

it('renders maintenance in both themes at narrow width with full paths and keyboard actions', async () => {
  for (const light of [false, true]) {
    const page = await mount('panel', 480)
    try {
      if (light) await page.addStyleTag({ content: 'body{color:#252525;background:#fafafa;--shell-text:#252525;--shell-muted:#666;--shell-border:#ddd;--shell-canvas:#fafafa;--shell-pane:#f1f1f1;}' })
      const row = page.locator('article').first()
      await row.locator('summary').focus(); await page.keyboard.press('Enter')
      await expect(row.getByRole('button', { name: '计算占用' })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await mkdir('artifacts/workspace-storage', { recursive: true })
      await page.getByRole('heading', { name: '工作区数据', exact: true }).locator('../..').screenshot({ path: `artifacts/workspace-storage/maintenance-${light ? 'light' : 'dark'}-480.png` })
    } finally { await page.close() }
  }
})

it('cleans legacy Hooks only after confirmation and reports retained files with retryable failures', async () => {
  const page = await mount('panel', 480)
  try {
    expect(await page.evaluate(() => (window as any).fixture.calls.includes('retireHooks'))).toBe(false)
    await page.getByRole('button', { name: '清理旧 Hook 接入', exact: true }).click()
    const confirm = page.getByRole('group', { name: '确认清理旧 Hook' })
    await expect(confirm).toContainText('外部 CLI')
    await confirm.getByRole('button', { name: '取消', exact: true }).click()
    expect(await page.evaluate(() => (window as any).fixture.calls.includes('retireHooks'))).toBe(false)
    await page.getByRole('button', { name: '清理旧 Hook 接入', exact: true }).click()
    await page.evaluate(() => { (window as any).fixture.hookError = 'Close terminals before cleanup' })
    await confirm.getByRole('button', { name: '确认清除', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Close terminals')
    await expect(confirm).toBeVisible()
    await page.evaluate(() => { (window as any).fixture.hookError = '' })
    await confirm.getByRole('button', { name: '确认清除', exact: true }).click()
    await expect(page.getByText('已清理 2 条旧 Hook 命令、1 个文件。', { exact: true })).toBeVisible()
    await expect(page.getByText('Unknown binary retained', { exact: true })).toBeVisible()
    await expect(page.getByText('C:/Users/Test/.janusx/hooks/janusx-hook-runner.exe', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: 'artifacts/workspace-storage/legacy-hooks-480.png', fullPage: true })
  } finally { await page.close() }
})
