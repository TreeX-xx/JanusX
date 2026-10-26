import { beforeAll, afterAll, expect, it } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { build } from 'esbuild'
let browser: Browser, script: string, css: string
beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React from 'react'; import { createRoot } from 'react-dom/client';
    import i18n from 'i18next'; import { initReactI18next } from 'react-i18next';
    import plugins from './src/renderer/src/i18n/locales/en/plugins.json';
    import { PluginWorkspaceHandoffHost } from './src/renderer/src/extensions/PluginWorkspaceHandoffHost';
    import { useWorktreeStore } from './src/renderer/src/stores/worktree';
    window.listeners=new Set();window.launches=[];window.opened=[];window.launchResult={ok:true,prefilled:true,terminalId:'test',pid:12};
    window.electron={platform:'win32',plugins:{onEvent:listener=>{window.listeners.add(listener);return()=>window.listeners.delete(listener)}},
      window:{openEditor:async input=>{window.opened.push(input);return{success:true}}}};
    window.emit=packet=>{for(const listener of window.listeners)listener({packet:{pluginId:'demo.plugin',name:'Example plugin',projectId:'project',root:'C:/fixture',...packet}})};
    window.path=path=>useWorktreeStore.setState({activePaths:{project:path}});
    i18n.use(initReactI18next).init({lng:'en',resources:{en:{plugins}},interpolation:{escapeValue:false}}).then(()=>createRoot(document.getElementById('root')).render(<PluginWorkspaceHandoffHost/>));
  ` }, bundle: true, write: false, outfile: 'handoff-ui.js', jsx: 'automatic', format: 'iife', define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'handoff-ports', setup(builder) {
      builder.onLoad({ filter: /[/\\]i18n[/\\]index\.ts$/ }, () => ({ contents: "import i18n from 'i18next';export default i18n;export const changeLanguage=value=>i18n.changeLanguage(value)", loader: 'ts' }))
      builder.onLoad({ filter: /[/\\]stores[/\\]workspace\.ts$/ }, () => ({ contents: "import {create} from 'zustand';export const useWorkspaceStore=create(()=>({activeWorkspaceId:'project',workspaces:[{id:'project',path:'C:/fixture'}]}))", loader: 'ts' }))
      builder.onLoad({ filter: /[/\\]stores[/\\]worktree\.ts$/ }, () => ({ contents: "import {create} from 'zustand';export const useWorktreeStore=create(()=>({activePaths:{}}))", loader: 'ts' }))
      builder.onLoad({ filter: /[/\\]stores[/\\]app\.ts$/ }, () => ({ contents: "export const useAppStore={getState:()=>({setActiveWorkbench:()=>{}})}", loader: 'ts' }))
      builder.onLoad({ filter: /[/\\]extensions[/\\]plugin-runtime\.tsx$/ }, () => ({ contents: "export function usePluginSnapshot(){return{plugins:[{manifest:{id:'demo.plugin'},enabled:true,state:'active'}]}}", loader: 'tsx' }))
      builder.onLoad({ filter: /[/\\]lib[/\\]terminal-launch\.ts$/ }, () => ({ contents: "export async function launchTerminalPreset(input){window.launches.push(input);return window.launchResult}", loader: 'ts' }))
    } }] })
  script = result.outputFiles.find(file => file.path.endsWith('.js'))!.text
  css = result.outputFiles.find(file => file.path.endsWith('.css'))!.text
}, 20_000)
afterAll(async () => { await browser?.close() })
async function page() {
  const page = await browser.newPage({ reducedMotion: 'reduce' }); page.setDefaultTimeout(5000)
  await page.setContent('<div id="root"></div>'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script })
  await page.waitForFunction(() => (window as any).listeners?.size > 0)
  return page
}
it('keeps editable drafts until confirmation, preserves them across project changes and pastes without Enter', async () => {
  const view = await page()
  try {
    await view.evaluate(() => (window as any).emit({ type: 'terminalDraft', text: 'Original task' }))
    const input = view.getByRole('textbox', { name: 'Task draft' })
    await input.fill('Reviewed task\nWith acceptance criteria')
    await input.press('Enter')
    expect(await view.evaluate(() => (window as any).launches.length)).toBe(0)
    await view.evaluate(() => { (window as any).emit({ type: 'terminalDraft', text: 'Overwriting proposal' }); (window as any).path('C:/another-tree') })
    await expect.poll(() => view.getByRole('button', { name: 'Create terminal and prefill' }).isEnabled()).toBe(false)
    expect(await input.inputValue()).toBe('Reviewed task\nWith acceptance criteria\n')
    await view.evaluate(() => (window as any).path('C:/fixture'))
    await view.getByRole('combobox').selectOption('claude')
    await view.getByRole('button', { name: 'Create terminal and prefill' }).click()
    await expect.poll(() => view.getByRole('dialog').count()).toBe(0)
    expect(await view.evaluate(() => (window as any).launches)).toEqual([{ preset: 'claude', workspaceId: 'project', workspacePath: 'C:/fixture',
      initialInput: '\x1b[200~Reviewed task\nWith acceptance criteria\n\x1b[201~' }])
  } finally { await view.close() }
})
it('preserves the draft after a launch failure and never launches on cancellation', async () => {
  const view = await page()
  try {
    await view.evaluate(() => { (window as any).launchResult={ok:false}; (window as any).emit({ type: 'terminalDraft', text: 'Keep this draft' }) })
    await view.getByRole('button', { name: 'Create terminal and prefill' }).click()
    await view.getByRole('alert').waitFor()
    expect(await view.getByRole('textbox').inputValue()).toBe('Keep this draft')
    await view.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect.poll(() => view.getByRole('dialog').count()).toBe(0)
    expect(await view.evaluate(() => (window as any).launches.length)).toBe(1)
  } finally { await view.close() }
})
