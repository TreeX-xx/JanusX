import { afterAll, beforeAll, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const artifacts = 'artifacts/tool-presentation-unification-20261113'
let browser: Browser, page: Page, reference: Page
beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
  reference = await browser.newPage({ viewport: { width: 1400, height: 950 } })
  await reference.goto(pathToFileURL(resolve('design/superagent-conversation/SuperAgent Conversation.html')).href)
  await reference.locator('.process').first().waitFor()
  // Use the actual approved HTML's tool markup and styles, with the same content as both adapters.
  const referenceTool = await reference.locator('.tool-running').first().evaluate(el => {
    el.className = 'tool tool-running'; el.setAttribute('open', '')
    el.querySelector('.verb')!.textContent = '执行'
    el.querySelector('.tool-target')!.textContent = 'npm run typecheck'
    el.querySelector('.tool-time')!.textContent = '执行中'
    el.querySelector('pre')!.textContent = 'npm run typecheck\n\nChecking renderer types…'
    return el.outerHTML
  })
  const referenceCss = await reference.locator('style').allTextContents().then(styles => styles.join('\n'))
  const built = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client'
    import i18n from 'i18next'; import {initReactI18next} from 'react-i18next'
    import terminal from './src/renderer/src/i18n/locales/zh-CN/terminal.json'
    import janus from './src/renderer/src/i18n/locales/zh-CN/janus.json'
    import {ConversationToolCall} from './src/renderer/src/components/chat/ConversationToolCall'
    import {ToolCallCard} from './src/renderer/src/components/janus/ToolCallCard'
    import {WorkDisclosure} from './src/renderer/src/components/chat/WorkDisclosure'
    import native from './src/renderer/src/components/AgentSessionPane.module.css'
    import './src/renderer/src/styles/themes.generated.css'; import './src/renderer/src/styles/globals.css'
    import './src/renderer/src/components/janus/janus-island.css'
    window.files=[]; window.renderState=(status='running')=>createRoot(document.getElementById('root')).render(<App status={status}/>);
    function App({status}) { const [state,setState]=React.useState(status);window.setToolState=setState;
      const item={id:'native',turnId:'turn',type:'commandExecution',status:state==='running'?'inProgress':state,activity:'npm run typecheck',text:'npm run typecheck\\n\\nChecking renderer types…'};
      const entry={callId:'super',toolName:'command_run',workspaceId:'workspace',status:state,argsDigest:'npm run typecheck',resultDigest:'Checking renderer types…',summary:''};
      const work={count:1,running:state==='running'?1:0,waiting:0,failed:0,rejected:0,unknown:0,interrupted:0,incomplete:false};
      return <>{['native','super'].map(mode=><section key={mode} data-mode={mode} style={{width:'min(640px,calc(100vw - 32px))',margin:'20px auto'}}>
        <h2 style={{fontSize:13,fontWeight:500,marginBottom:14}}>{mode==='native'?'普通对话':'SuperAgent'}</h2>
        <div className={mode==='native'?native.root:'janus-chat-message assistant'} style={{width:'100%',maxWidth:'100%',height:'auto'}}><div className={mode==='super'?'janus-chat-message-content':''}>
          <WorkDisclosure summary={work} activity={{text:entry.argsDigest,kind:mode==='native'?item.type:entry.toolName}} stateKey={mode}>
            {mode==='native'?<ConversationToolCall item={item} openFile={path=>window.files.push(path)}/>:<ToolCallCard entry={entry} workspaceNames={new Map([['workspace','JanusX']])}/>}
          </WorkDisclosure>
        </div></div></section>)}</>
    }
    i18n.use(initReactI18next).init({lng:'zh-CN',resources:{'zh-CN':{terminal,janus}},interpolation:{escapeValue:false}}).then(()=>window.renderState())
  ` }, bundle: true, write: false, outfile: 'tools.js', jsx: 'automatic', format: 'iife', define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'fixture-i18n', setup(b) { b.onLoad({ filter: /[/\\]i18n[/\\]index\.ts$/ }, () => ({ contents: "import i18n from 'i18next';export default i18n;export const changeLanguage=()=>{}", loader: 'ts' })) } }] })
  page = await browser.newPage({ viewport: { width: 1000, height: 950 } })
  await page.setContent('<html data-theme="dark"><body style="margin:0"><div id="root"></div><section style="width:min(640px,calc(100vw - 32px));margin:20px auto"><h2 style="font:500 13px Segoe UI">HTML 参考 · 相同命令</h2><iframe title="Approved HTML" style="width:100%;height:700px;border:0"></iframe></section></body></html>')
  await page.addStyleTag({ content: built.outputFiles.find(f => f.path.endsWith('.css'))!.text })
  await page.locator('iframe').evaluate((el, html) => { (el as HTMLIFrameElement).srcdoc = html }, `<html data-theme="dark" data-accent="brand"><style>${referenceCss}</style><body style="background:transparent"><div class="process" style="padding-left:22px">${referenceTool}</div></body></html>`)
  await page.addScriptTag({ content: built.outputFiles.find(f => f.path.endsWith('.js'))!.text })
  await page.locator('.conversation-work-toggle').first().waitFor()
  await mkdir(artifacts, { recursive: true })
}, 30000)
afterAll(async () => { await browser?.close() })

it('uses HTML row metrics in both real adapters, keeps default folds and keyboard access', async () => {
  for (const mode of ['native', 'super']) {
    const host = page.locator(`[data-mode=${mode}]`)
    expect(await host.locator('.conversation-work-toggle').getAttribute('aria-expanded')).toBe('false')
    await host.locator('.conversation-work-toggle').click()
    expect(await host.locator('.conversation-tool').getAttribute('open')).toBeNull()
    await host.locator('.conversation-tool-toggle').focus()
    await page.keyboard.press('Enter')
    await host.locator('.conversation-tool-body').waitFor()
  }
  await page.locator('.conversation-tool-toggle').last().evaluate(el => Promise.all(el.getAnimations({ subtree: true })
    .filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished)))
  const metrics = (el: Element) => {
    const row = getComputedStyle(el), icon = el.firstElementChild!, chevron = el.lastElementChild!
    return { height: el.getBoundingClientRect().height, padding: row.padding, gap: row.gap, fontSize: row.fontSize,
      iconWidth: getComputedStyle(icon).width, chevronRight: Math.round(el.getBoundingClientRect().right - chevron.getBoundingClientRect().right), borderLeft: row.borderLeftWidth }
  }
  const native = await page.locator('[data-mode=native] .conversation-tool-toggle').evaluate(metrics)
  const superagent = await page.locator('[data-mode=super] .conversation-tool-toggle').evaluate(metrics)
  // Measure the approved HTML instead of maintaining a second set of expected style constants.
  const html = await reference.locator('.tool-running').first().evaluate(el => { el.closest('.process')!.setAttribute('open', ''); return true })
  expect(html).toBe(true)
  await reference.locator('.tool-running > summary').first().evaluate(el => Promise.all(el.getAnimations({ subtree: true })
    .filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished)))
  const approved = await reference.locator('.tool-running > summary').first().evaluate(metrics)
  await writeFile(artifacts+'/row-metrics.json', JSON.stringify({native,superagent,approved},null,2))
  expect(native).toEqual(superagent)
  expect(native).toEqual(approved)
  const preMetrics = (el: Element) => { const s=getComputedStyle(el); return {padding:s.padding,margin:s.margin,fontSize:s.fontSize,lineHeight:s.lineHeight,maxHeight:s.maxHeight,borderRadius:s.borderRadius} }
  const output = await page.locator('[data-mode=native] pre').evaluate(preMetrics)
  expect(await page.locator('[data-mode=super] pre').evaluate(preMetrics)).toEqual(output)
  expect(output).toEqual(await reference.locator('.tool-running pre').first().evaluate(preMetrics))
  await writeFile(artifacts+'/html-metrics.json', JSON.stringify({native,superagent,approved,output},null,2))
  for (const [theme,width] of [['dark',1000],['white',390],['planche',760]] as const) {
    await page.setViewportSize({width,height:950})
    await page.evaluate(theme=>{document.documentElement.dataset.theme=theme},theme)
    await page.locator('iframe').contentFrame().locator('html').evaluate((el, theme)=>{el.setAttribute('data-theme',theme==='dark'?'dark':'light')},theme)
    await page.locator('iframe').contentFrame().locator('.tool > summary').evaluate(el => Promise.all(el.getAnimations({ subtree: true })
      .filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished)))
    for (const mode of ['native','super']) expect(await page.locator(`[data-mode=${mode}] .conversation-tool`).evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)
    await page.evaluate(()=>{(document.activeElement as HTMLElement)?.blur();window.scrollTo(0,0);document.body.scrollTo(0,0)})
    await page.screenshot({path:`${artifacts}/comparison-${theme}.png`})
  }
  await page.evaluate(()=>(window as any).setToolState('completed'))
  await expect.poll(()=>page.locator('.conversation-tool[data-active=true]').count()).toBe(0)
  expect(await page.locator('.conversation-tool[open]').count()).toBe(2)
  const idle = await reference.locator('.tool:not(.tool-running) > summary').first().evaluate(el=>getComputedStyle(el).padding)
  for (const mode of ['native','super']) expect(await page.locator(`[data-mode=${mode}] .conversation-tool-toggle`).evaluate(el=>getComputedStyle(el).padding)).toBe(idle)
}, 20000)
