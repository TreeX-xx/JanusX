import { afterAll, beforeAll, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
const artifactRoot = process.env.JANUS_TOPICS_TEST_ARTIFACTS ?? 'artifacts'

let browser: Browser, script: string, css: string
beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
  const built = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client'
    import i18n from 'i18next'; import {initReactI18next} from 'react-i18next'
    import janus from './src/renderer/src/i18n/locales/en/janus.json'
    import zhJanus from './src/renderer/src/i18n/locales/zh-CN/janus.json'
    import settings from './src/renderer/src/i18n/locales/en/settings.json'
    import terminal from './src/renderer/src/i18n/locales/en/terminal.json'
    import zhTerminal from './src/renderer/src/i18n/locales/zh-CN/terminal.json'
    import zhSettings from './src/renderer/src/i18n/locales/zh-CN/settings.json'
    import common from './src/renderer/src/i18n/locales/en/common.json'
    import zhCommon from './src/renderer/src/i18n/locales/zh-CN/common.json'
    import {installElectronApiFallback} from './src/renderer/src/lib/electron-api-fallback'
    import {JanusChatProvider,useJanusChatRegistry} from './src/renderer/src/components/janus/JanusChatProvider'
    import {JanusChat} from './src/renderer/src/components/janus/JanusChat'
    import {SuperAgentWorkspace} from './src/renderer/src/components/janus/SuperAgentWorkspace'
    import {useSuperAgentUIStore} from './src/renderer/src/stores/superagent-ui'
    import {usePluginSnapshot} from './src/renderer/src/extensions/plugin-snapshot'
    import {SuperAgentLaunch} from './src/renderer/src/components/janus/SuperAgentLaunch'
    import {openSuperAgent} from './src/renderer/src/lib/superagent-navigation'
    import {useGlobalToolsStore} from './src/renderer/src/stores/global-tools'
    import {getLeafPanes} from './src/renderer/src/lib/workspace-pane'
    import {useWorkspaceStore} from './src/renderer/src/stores/workspace'
    import './src/renderer/src/styles/themes.generated.css'
    import './src/renderer/src/styles/globals.css'
    import './src/renderer/src/components/janus/janus-island.css'
    installElectronApiFallback();document.documentElement.dataset.theme='dark'
    const ordinaryProfile=['fresh-install','legacy-install','remembered-install'].includes(window.initialMode)
    if (!ordinaryProfile) useSuperAgentUIStore.setState({started:true})
    window.pluginState=state=>usePluginSnapshot.setState({plugins:state==='missing'?[]:[{
      manifest:{id:'official.superagent'},source:{kind:'official'},enabled:state==='active',state,projectScope:'all',
    }]})
    window.pluginState(ordinaryProfile?'missing':'active')
    window.openSuperAgent=openSuperAgent
    window.hasAgentPane=()=>getLeafPanes(useGlobalToolsStore.getState().paneTree).some(p=>p.tabs.some(t=>t.type==='superagent'))
    const noEvents=()=>()=>{}
    window.fixtureHost={available:async()=>true,onChanged:noEvents,onEnvironmentsChanged:noEvents,onWorkerChanged:noEvents,onScheduleChanged:noEvents,
      snapshot:async()=>({works:[],reports:[],inputs:[]}),workers:async()=>[],environments:async()=>({operations:[],environments:[]}),schedule:async()=>({entries:[],occupied:0,maxConcurrentWorkers:2})}
    if (!ordinaryProfile) window.electron.superAgent=window.fixtureHost
    window.setProjectPane=type=>{
      const tab=type==='terminal'?{type:'terminal',id:'terminal:fixture',terminalId:'fixture',workspaceId:'preview'}:{type:'markdown',id:'markdown:fixture',panelId:'fixture'}
      useWorkspaceStore.setState({paneTree:type?{type:'leaf',id:'fixture-pane',tabs:[tab],activeTabId:tab.id}:null})
    }
    window.requests=[];window.saved=window.preloaded??null;window.errors=[];window.routeCalls=[];window.newTopicInputs=[];window.answerCalls=[];window.steerCalls=[]
    window.previewWorkers=(workspaceName='JanusX')=>{
      window.electron.agentRuntime.createSession=async()=>({id:'preview-session',status:'running'})
      const work={id:'W-01',sourceInputId:'source-input',workspaceId:'preview',title:'Refine conversation layout',goal:'Align the interface with the HTML design',createdAt:1,revision:1,closedAt:null}
      const worker={workId:work.id,workspaceId:'preview',executionId:'preview-run',phase:'running',stopConfirmed:false,disabledExtensions:[],conversation:{models:[],model:'gpt-6-astra',effort:'ultra',connection:'ready',turnId:'current',turnStartedAt:Date.now()-42000,items:[{turnId:'current',type:'agentMessage',text:'Checking spacing and keyboard access'}],approvals:[],questions:[]}}
      window.previewWork=work;window.previewWorker=worker
      window.electron.superAgent={...window.fixtureHost,snapshot:async()=>({works:[work]}),workers:async()=>[worker],environments:async()=>({operations:[],environments:[{workId:work.id,removedAt:null,checkout:{branch:'feat/superagent-automation-exploration',path:'/fixture/superagent'}}]}),schedule:async()=>({maxConcurrentWorkers:2,occupied:1,entries:[{workId:work.id,status:'running'}]}),workDetail:async()=>({work,inputs:[],executions:[],reports:[],deliveries:[]}),onChanged:fn=>{window.workerRecordChanged=fn;return()=>{}},onWorkerChanged:fn=>{window.workerRuntimeChanged=fn;return()=>{}},onEnvironmentsChanged:()=>()=>{},onScheduleChanged:()=>()=>{}}
      useWorkspaceStore.setState({activeWorkspaceId:'preview',workspaces:[{id:'preview',name:workspaceName,path:'/fixture'}]})
    }
    window.previewChinese=()=>i18n.changeLanguage('zh-CN')
    const listeners={delta:new Set(),done:new Set(),error:new Set(),agent:new Set()}
    window.applySteer=input=>{
      listeners.agent.forEach(fn=>fn({requestId:input.expectedRequestId,type:'steering_consumed',keys:[input.entryId]}))
      listeners.agent.forEach(fn=>fn({requestId:input.expectedRequestId,type:'text_delta',delta:' Updated: '+input.text}))
    }
    window.configuredModel={provider:{id:'fixture',name:'Fixture'},modelId:'model'}
    Object.assign(window.electron.llm,{
      getTerminalProviders:async()=>[{id:'fixture',name:'Fixture',models:['model']},{id:'second',name:'Second',models:['alternate']}],
      getTerminalDefault:async()=>{if(window.modelGate)await window.modelGate;return window.configuredModel},listModels:async()=>[],
      startChatStream:request=>{window.requests.push(request);queueMicrotask(()=>{
        listeners.agent.forEach(fn=>fn({requestId:request.requestId,type:'stream_start'}))
        listeners.agent.forEach(fn=>fn({requestId:request.requestId,type:'text_delta',delta:'Response: '+request.messages.at(-1).content}))
      })},
      abortChat:async requestId=>{window.aborted=requestId},
      steerChat:async input=>{window.steerCalls.push(input);if(window.rejectSteer)throw new Error('Steering connection lost');if(!window.holdSteer)queueMicrotask(()=>window.applySteer(input));return{accepted:true}},
      cancelSteerChat:async()=>({cancelled:true}),
      onDelta:fn=>{listeners.delta.add(fn);return()=>listeners.delta.delete(fn)},
      onDone:fn=>{listeners.done.add(fn);return()=>listeners.done.delete(fn)},
      onError:fn=>{listeners.error.add(fn);return()=>listeners.error.delete(fn)},
      onAgentEvent:fn=>{listeners.agent.add(fn);return()=>listeners.agent.delete(fn)},
      answerQuestion:async payload=>{window.answerCalls.push(payload);if(window.rejectAnswer)return{accepted:false,error:'Answer transport failed'};return{accepted:true}}
    })
    window.electron.janusChat={load:async()=>{if(window.deferStartup)await new Promise(resolve=>{window.releaseStartup=resolve});return window.saved},save:async value=>{window.saved=structuredClone(value)},
      routeTopic:async request=>{window.routeCalls.push(request);await new Promise(r=>setTimeout(r,80));
        if(window.rejectRoute)throw new Error('Routing model returned no valid result')
        if(window.newTopicInputs.includes(request.text))return{kind:'new'}
        return request.text==='Ambiguous'?{kind:'choice'}:request.text==='Follow-up'||request.candidates.length===1?{kind:'continue',targetId:window.autoRouteTarget??request.candidates[0].id}:{kind:'wait'}}}
    window.finish=index=>{const requestId=window.requests[index].requestId;listeners.done.forEach(fn=>fn({requestId}));listeners.agent.forEach(fn=>fn({requestId,type:'stream_end'}))}
    window.delta=(index,text)=>listeners.agent.forEach(fn=>fn({requestId:window.requests[index].requestId,type:'text_delta',delta:text}))
    window.tool=(index,event)=>listeners.agent.forEach(fn=>fn({requestId:window.requests[index].requestId,...event}))
    window.fail=index=>{const requestId=window.requests[index].requestId;listeners.error.forEach(fn=>fn({requestId,error:'Fixture stream failure'}));listeners.agent.forEach(fn=>fn({requestId,type:'stream_error',error:'Fixture stream failure'}))}
    window.question=index=>listeners.agent.forEach(fn=>fn({requestId:window.requests[index].requestId,type:'question_requested',callId:'question-1',questions:[{header:'Direction',question:'Which approach?',multiple:false,options:[{label:'Keep',description:'Keep the existing layout'},{label:'Refine',description:'Improve the layout'}]}],allowCustom:true}))
    function App(){const registry=useJanusChatRegistry();window.registry=registry;window.seedParallelInput=text=>registry.topics.submit(registry.getController().conversationId,useWorkspaceStore.getState().activeWorkspaceId,text,true);const [toolbarHost,setToolbarHost]=React.useState(null);const [visible,setVisible]=React.useState(true);window.setStartupVisible=setVisible;window.startupLanguage=language=>i18n.changeLanguage(language);
      if (ordinaryProfile) {
        const chat=registry.getController()
        return <><SuperAgentLaunch/><JanusChat {...chat} visible focused showPermissionSelector={false} conversationStyle modeColor="blue" onSend={chat.send} onStop={chat.stop}
          onRetry={chat.retry} onRewrite={chat.rewrite} onClear={chat.clear} conversationController={chat}/></>
      }
      return <div style={{height:'100vh',display:visible?'flex':'none',flexDirection:'column',margin:'auto',background:'var(--surface)',color:'var(--text)'}}>
        <div ref={setToolbarHost} style={{height:30,flexShrink:0,display:'flex',justifyContent:'flex-end'}}/><div style={{flex:1,minHeight:0}}><SuperAgentWorkspace visible={visible} focused={visible} toolbarHost={toolbarHost}/></div>
      </div>}
    i18n.use(initReactI18next).init({lng:'en',fallbackLng:'en',resources:{en:{janus,common,settings,terminal},'zh-CN':{janus:zhJanus,common:zhCommon,settings:zhSettings,terminal:zhTerminal}},interpolation:{escapeValue:false}}).then(()=>createRoot(document.getElementById('root')).render(<JanusChatProvider><App/></JanusChatProvider>))
  ` }, bundle: true, write: false, outfile: 'topics-ui.js', loader: { '.svg': 'dataurl', '.png': 'dataurl' }, jsx: 'automatic', format: 'iife', define: { 'process.env.NODE_ENV': '"test"' }, plugins: [{ name: 'fixture-i18n', setup(builder) {
    builder.onLoad({ filter: /[/\\]lib[/\\]monaco-runtime\.ts$/ }, () => ({ contents: 'export const configureMonacoRuntime = () => {}; export const initializeMonacoRuntime = async () => ({})', loader: 'ts' }))
    builder.onLoad({ filter: /[/\\]i18n[/\\]index\.ts$/ }, () => ({ contents: "import i18n from 'i18next';export default i18n;export const changeLanguage=()=>{}", loader: 'ts' }))
  } }] })
  script = built.outputFiles.find(f => f.path.endsWith('.js'))!.text
  css = built.outputFiles.find(f => f.path.endsWith('.css'))!.text
}, 30000)
afterAll(async () => { await browser?.close() })

async function open(initialMode = 'superagent', deferStartup = false, controlledClock = false) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } })
  if (controlledClock) {
    await page.clock.install({ time: new Date('2026-11-12T00:00:00Z') })
    await page.clock.pauseAt(new Date('2026-11-12T00:00:01Z'))
  }
  page.setDefaultTimeout(5000)
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()) })
  page.on('pageerror', error => { console.error(error.message) })
  await page.route('http://127.0.0.1/', route => route.fulfill({ contentType: 'text/html', body: '<style>body{margin:0;font-family:Arial}</style><div id="root"></div>' }))
  await page.goto('http://127.0.0.1/'); await page.evaluate(({mode, defer}) => {
    if (mode === 'legacy-install') localStorage.setItem('janus:superagent-view', JSON.stringify({ started: true, agentMode: 'superagent' }))
    if (mode === 'remembered-install') localStorage.setItem('janus:superagent-view', JSON.stringify({ modeVersion: 1, started: true, agentMode: 'superagent' }))
    ;(window as any).initialMode = mode
    ;(window as any).deferStartup = defer
  }, {mode: initialMode, defer: deferStartup})
  await page.addStyleTag({ content: css + '[data-superagent-workspace] > .janus-chat { flex:1; width:100%; }' }); await page.addScriptTag({ content: script })
  if (!deferStartup) {
    await page.waitForFunction(() => (window as any).registry?.persistenceReady)
    await page.locator('.janus-chat-input:visible').waitFor()
  }
  return page
}

it('centers the new conversation with its composer and retains drafts across themes, short panes and Workers', async () => {
  const page = await open()
  try {
    const welcome = page.locator('[data-conversation-welcome]')
    const input = page.locator('.janus-chat-input:visible')
    await welcome.waitFor()
    expect(await welcome.getAttribute('data-brand')).toBe('janusx')
    expect(await welcome.locator('[data-welcome-workspace]').textContent()).toBe('No workspace selected')
    await input.fill('Keep the welcome draft')
    await input.evaluate(el => { (window as any).welcomeInput = el })
    await mkdir(`${artifactRoot}/welcome`, { recursive: true })
    for (const [theme, width, height] of [['dark', 1100, 850], ['white', 380, 720], ['planche', 520, 400]] as const) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
      await page.setViewportSize({ width, height })
      const heading = welcome.locator('[data-active=true] h2')
      expect(await welcome.getByRole('img').evaluate(el => getComputedStyle(el, '::before').maskImage)).not.toBe('none')
      expect(await welcome.getByRole('img').locator('span').evaluate(el => getComputedStyle(el).maskImage)).not.toBe('none')
      await page.screenshot({ path: `${artifactRoot}/welcome/janusx-${theme}-${width}-layout.png` })
      await expect.poll(async () => Math.abs((await heading.boundingBox())!.x - (await input.boundingBox())!.x)).toBeLessThan(1)
      await expect.poll(() => welcome.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      expect(await input.evaluate(el => el === (window as any).welcomeInput)).toBe(true)
      expect(await input.textContent()).toBe('Keep the welcome draft')
      await input.scrollIntoViewIfNeeded()
      await page.screenshot({ path: `${artifactRoot}/welcome/janusx-${theme}-${width}.png` })
    }
    await page.evaluate(() => (window as any).previewChinese())
    expect(await welcome.locator('[data-active=true] h2').textContent()).toBe('想从哪里开始？')
    expect(await welcome.locator('[data-welcome-workspace]').textContent()).toBe('尚未选择工作区')
    await page.setViewportSize({ width: 1100, height: 850 })
    await input.press('Enter')
    await page.waitForFunction(() => (window as any).requests.length === 1)
    expect(await welcome.count()).toBe(0)
    expect(await input.evaluate(el => el === (window as any).welcomeInput)).toBe(true)
    await page.evaluate(() => (window as any).previewWorkers())
    await expect.poll(() => welcome.locator('[data-welcome-workspace]').textContent()).toContain('JanusX')
    expect(await welcome.locator('[data-welcome-workspace]').getAttribute('title')).toBe('/fixture')
    await expect.poll(() => welcome.locator('[data-active=true]').evaluate(el => getComputedStyle(el).opacity)).toBe('1')
    await page.screenshot({ path: `${artifactRoot}/welcome/janusx-zh-workspace.png` })
  } finally { await page.close() }
})

it('shows restored workflow plans instead of a new conversation welcome', async () => {
  const page = await open()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.evaluate(() => {
      const w = window as any
      w.previewWorkers()
      w.electron.superAgent.workflows = async () => ({ workflows: [{ id: 'restored-plan', conversationId: w.registry.getController().conversationId,
        workspaceId: 'preview', title: 'Restored plan', goal: 'Resume the saved work', state: 'running', nodes: [], history: [], repairRound: 0, maxRepairRounds: 1 }] })
    })
    await page.locator('section[aria-label="Workflow plans"]').getByText('Restored plan').waitFor()
    expect(await page.locator('[data-conversation-welcome]').count()).toBe(0)
    expect(await page.locator('.janus-chat-transcript-viewport').first().isVisible()).toBe(true)
    expect(errors).toEqual([])
  } finally { await page.close() }
})

it('keeps output tools compact and preserves workflow folds and Worker highlights', async () => {
  const page = await open()
  try {
    await page.evaluate(() => {
      const w = window as any; w.previewWorkers()
      w.flowState = 'running'; w.nodeState = 'running'
      w.electron.superAgent.onChanged = (fn: unknown) => { w.workChanged = fn; return () => {} }
      w.electron.superAgent.workflows = async () => ({ workflows: [{ id: 'stream-plan', conversationId: w.registry.getController().conversationId,
        workspaceId: 'preview', title: 'Output stream plan', goal: 'Verify the interface', state: w.flowState, history: [], repairRound: 0, maxRepairRounds: 2,
        nodes: [{ key: 'develop', label: 'Implement output stream', role: 'develop', state: w.nodeState, workId: 'W-01', dependencies: [], round: 0 }] }] })
    })
    const plan = page.locator('[data-workflow-plan="stream-plan"]')
    await plan.waitFor()
    expect(await plan.getAttribute('open')).not.toBeNull()
    const node = plan.getByRole('button', { name: /Implement output stream/ })
    expect(await node.getAttribute('data-current')).toBe('true')
    expect(await node.evaluate(el => getComputedStyle(el).borderLeftWidth)).toBe('0px')
    await node.hover()
    const worker = page.locator('[data-presentation=status][data-work-id="W-01"]')
    await expect.poll(() => worker.getAttribute('data-cross-highlight')).toBe('true')
    await plan.locator(':scope > summary').click()
    await page.evaluate(() => { const w=window as any; w.workChanged({workspaceId:'preview'}) })
    expect(await plan.getAttribute('open')).toBeNull()
    await plan.locator(':scope > summary').click()
    await page.evaluate(() => { const w=window as any; w.flowState='completed';w.nodeState='done';w.workChanged({workspaceId:'preview'}) })
    await expect.poll(() => plan.getAttribute('data-state')).toBe('completed')
    expect(await plan.getAttribute('open')).not.toBeNull()
    expect(await node.getAttribute('data-current')).toBe('false')
    await send(page, 'Check the output stream'); await page.waitForFunction(() => (window as any).requests.length === 1)
    await page.evaluate(() => {
      const w=window as any
      for(const event of [{type:'tool_call_start'}, {type:'tool_call_ready',argumentKeys:['path','query']}, {type:'tool_execution_start'}])
        w.tool(0,{...event,callId:'inspect-stream',toolName:'search_files'})
    })
    const work = page.locator('.conversation-work-toggle'), card = page.locator('.janus-tool-card')
    await work.waitFor(); expect(await work.getAttribute('aria-expanded')).toBe('false')
    expect(await work.innerText()).toContain('path, query')
    expect(await work.locator('.conversation-work-verb').innerText()).toBe('Search')
    await work.click(); await card.waitFor()
    expect(await card.locator('.janus-tool-card-body').count()).toBe(0)
    expect(await card.evaluate(el => getComputedStyle(el).borderLeftWidth)).toBe('0px')
    await card.locator('.janus-tool-card-toggle').click()
    await card.locator('.janus-tool-card-body').waitFor()
    await mkdir(`${artifactRoot}/stream`, { recursive:true })
    for (const [theme,width] of [['dark',1100],['white',390],['planche',760]] as const) {
      await page.evaluate(theme => { document.documentElement.dataset.theme=theme },theme)
      await page.setViewportSize({width,height:850})
      expect(await card.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)
      await page.screenshot({path:`${artifactRoot}/stream/superagent-${theme}.png`})
    }
    await page.evaluate(() => { const w=window as any;w.tool(0,{type:'tool_execution_end',callId:'inspect-stream',toolName:'search_files',status:'completed'});w.finish(0) })
    await expect.poll(() => page.locator('.janus-chat-message.streaming').count()).toBe(0)
    expect(await page.locator('.conversation-work-toggle').getAttribute('aria-expanded')).toBe('true')
    expect(await page.locator('.janus-tool-card-body').isVisible()).toBe(true)
  } finally { await page.close() }
}, 20000)

it('returns to the process toggle inside a completed SuperAgent topic', async () => {
  const page = await open()
  try {
    await send(page, 'Review the process in detail')
    await page.waitForFunction(() => (window as any).requests.length === 1)
    await page.evaluate(() => {
      const w = window as any
      for (let index = 0; index < 6; index++) {
        w.tool(0, { type: 'reasoning_delta', delta: Array.from({ length: 26 }, (_, line) => `Step ${index + 1}.${line + 1}`).join('\n') })
        w.tool(0, { type: 'tool_execution_start', callId: `search-${index}`, toolName: 'search_files' })
        w.tool(0, { type: 'tool_execution_end', callId: `search-${index}`, toolName: 'search_files', status: 'completed' })
      }
      w.finish(0)
    })
    const topic = page.locator('[data-topic-id][data-topic-state="done"]')
    const toggle = topic.locator('.conversation-work-toggle')
    await toggle.click()
    const scroller = page.locator('.janus-chat-messages').filter({ has: topic })
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight / 2 })
    const returnButton = topic.getByRole('button', { name: 'Back to process start' })
    await returnButton.click()
    expect(await toggle.evaluate(element => element === document.activeElement)).toBe(true)
    await expect.poll(() => returnButton.count()).toBe(0)
    await page.keyboard.press('Enter')
    expect(await toggle.getAttribute('aria-expanded')).toBe('false')
  } finally { await page.close() }
}, 20000)

it('keeps pending Worker decisions visible even with no conversation messages', async () => {
  const page = await open()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.evaluate(() => {
      const w = window as any
      w.previewWorkers()
      const workers = w.electron.superAgent.workers
      w.electron.superAgent.workers = async () => (await workers()).map((worker: any) => ({ ...worker, phase: 'failed', stopConfirmed: true }))
      w.electron.superAgent.workerLog = async () => ({ available: true, text: 'Worker failed while checking the layout.' })
    })
    await page.getByRole('region', { name: 'Worker decisions' }).waitFor()
    expect(await page.locator('[data-conversation-welcome]').count()).toBe(0)
    await page.screenshot({ path: `${artifactRoot}/welcome/pending-decisions.png` })
    await expect.poll(() => page.getByRole('region', { name: 'Worker decisions' }).isVisible()).toBe(true)
    expect(errors).toEqual([])
  } finally { await page.close() }
})

async function expectStartupPalette(page: Page) {
  const palette = await page.locator('[data-superagent-startup]').evaluate(surface => {
    const probe = document.createElement('span')
    surface.append(probe)
    const color = (value: string) => {
      probe.style.color = value
      return getComputedStyle(probe).color
    }
    const style = (selector: string) => getComputedStyle(surface.querySelector(selector)!)
    const field = surface.querySelector('canvas')!.getContext('2d')!
    const pairs = {
      background: [getComputedStyle(surface).backgroundColor, color('var(--shell-pane)')],
      wordmark: [style('[data-startup-wordmark]').backgroundColor, color('var(--shell-text)')],
      accent: [style('[data-startup-wordmark] > span').backgroundColor, color('var(--shell-accent)')],
      status: [style('[role=status]').color, color('var(--shell-muted)')],
      tagline: [style('p:not([role])').color, color('var(--shell-muted)')],
      field: [color(field.fillStyle as string), color('var(--shell-muted)')],
      track: [style('[role=status] + div > span').backgroundColor, color('var(--shell-muted)')],
    }
    probe.remove()
    return pairs
  })
  for (const [role, [actual, expected]] of Object.entries(palette)) expect(actual, role).toBe(expected)
}

it('adapts the startup palette until restoration finishes, without starting work or replaying on tab changes', async () => {
  const page = await open('superagent', true)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    const splash = page.locator('[data-superagent-startup]')
    await splash.waitFor()
    await page.waitForTimeout(3200)
    const bounds = await splash.boundingBox(), field = await splash.locator('canvas').boundingBox()
    expect(field).toEqual(bounds)
    expect(bounds).toEqual(await page.locator('[data-superagent-workspace]').boundingBox())
    expect(bounds).toMatchObject({ y: 30, width: 1100, height: 820 })
    expect(await splash.getAttribute('data-settled')).toBe('false')
    expect(await page.locator('.janus-chat-input').count()).toBe(0)
    expect(await page.locator('[aria-valuenow]').count()).toBe(0)
    expect(await page.evaluate(() => (window as any).requests.length)).toBe(0)
    await mkdir(`${artifactRoot}/startup`, { recursive: true })
    for (const theme of ['dark', 'white', 'planche']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
      await expectStartupPalette(page)
      await splash.screenshot({ path: `${artifactRoot}/startup/${theme}.png` })
    }
    for (const size of [{ name: 'wide', width: 1920, height: 1080 }, { name: 'short', width: 800, height: 280 }]) {
      await page.setViewportSize({ width: size.width, height: size.height })
      await expect.poll(() => splash.locator('canvas').evaluate((el: HTMLCanvasElement) => el.width)).toBe(size.width)
      expect(await splash.locator('canvas').boundingBox()).toEqual(await page.locator('[data-superagent-workspace]').boundingBox())
      expect(await splash.evaluate(el => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight)).toBe(true)
      expect(await splash.locator('h1').evaluate(el => el.getBoundingClientRect().top >= 0)).toBe(true)
      await splash.screenshot({ path: `${artifactRoot}/startup/${size.name}.png` })
    }
    await page.evaluate(() => (window as any).startupLanguage('zh-CN'))
    await page.getByRole('status').filter({ hasText: '正在准备工作界面' }).waitFor()
    await page.setViewportSize({ width: 320, height: 420 })
    expect(await splash.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    expect(await splash.locator('canvas').boundingBox()).toEqual(await page.locator('[data-superagent-workspace]').boundingBox())
    expect(await splash.getByRole('heading', { name: 'JanusX' }).count()).toBe(1)
    expect(await splash.locator('[data-startup-wordmark]').evaluate(el => el.getBoundingClientRect().right <= window.innerWidth)).toBe(true)
    await splash.screenshot({ path: `${artifactRoot}/startup/narrow-zh.png` })
    await page.evaluate(() => (window as any).setStartupVisible(false))
    await page.evaluate(() => (window as any).releaseStartup())
    await page.waitForFunction(() => (window as any).registry.persistenceReady)
    await page.waitForTimeout(300)
    expect(await splash.count()).toBe(1)
    await page.evaluate(() => (window as any).setStartupVisible(true))
    await page.locator('.janus-chat-input:visible').waitFor()
    await page.locator('.janus-chat-input').fill('Preserve my draft')
    await page.evaluate(() => (window as any).setStartupVisible(false))
    await page.evaluate(() => (window as any).setStartupVisible(true))
    expect(await splash.count()).toBe(0)
    expect(await page.locator('.janus-chat-input').textContent()).toBe('Preserve my draft')
    expect(await page.evaluate(() => (window as any).requests.length)).toBe(0)
    expect(errors).toEqual([])
  } finally { await page.close() }
})

it('scans the JanusX wordmark during the full-screen entrance and then fades into the restored workspace', async () => {
  const page = await open('superagent', true, true)
  try {
    const splash = page.locator('[data-superagent-startup]')
    await splash.waitFor()
    await page.evaluate(() => (window as any).releaseStartup())
    await expect.poll(() => page.evaluate(() => (window as any).registry.persistenceReady)).toBe(true)
    const logo = splash.getByRole('heading', { name: 'JanusX' })
    const reveal = () => logo.evaluate(el => parseFloat((el as HTMLElement).style.getPropertyValue('--logo-reveal')))
    expect(await reveal()).toBe(0)
    await page.clock.runFor(600)
    const early = await reveal()
    expect(early).toBeGreaterThan(0)
    expect(early).toBeLessThan(100)
    expect(await logo.locator('[data-startup-scan]').evaluate(el => getComputedStyle(el).maskImage)).not.toBe('none')
    await mkdir(`${artifactRoot}/startup`, { recursive: true })
    await splash.screenshot({ path: `${artifactRoot}/startup/logo-scan-early.png` })
    await page.evaluate(() => { document.documentElement.dataset.theme = 'white' })
    await expectStartupPalette(page)
    expect(await reveal()).toBe(early)
    await page.clock.runFor(700)
    expect(await reveal()).toBeGreaterThan(early)
    expect(await reveal()).toBeLessThan(100)
    await splash.screenshot({ path: `${artifactRoot}/startup/logo-scan-middle.png` })
    await page.clock.runFor(700)
    expect(await reveal()).toBe(100)
    expect(await logo.evaluate(el => (el as HTMLElement).style.getPropertyValue('--logo-scan-opacity'))).toBe('0')
    await splash.screenshot({ path: `${artifactRoot}/startup/logo-scan-complete.png` })
    await page.clock.runFor(500)
    expect(await splash.getAttribute('data-settled')).toBe('false')
    expect(await splash.getAttribute('aria-busy')).toBe('false')
    expect(await page.locator('.janus-chat-input').count()).toBe(0)
    await page.clock.runFor(110)
    expect(await splash.getAttribute('data-settled')).toBe('true')
    await page.clock.runFor(430)
    await page.locator('.janus-chat-input:visible').waitFor()
    expect(await splash.count()).toBe(0)
    expect(await page.evaluate(() => (window as any).requests.length)).toBe(0)
  } finally { await page.close() }
})

it('counts only visible startup time across hidden panes and background windows', async () => {
  const page = await open('superagent', true, true)
  try {
    const splash = page.locator('[data-superagent-startup]')
    await splash.waitFor()
    await page.clock.runFor(800)
    const logo = splash.getByRole('heading', { name: 'JanusX', includeHidden: true })
    const reveal = () => logo.evaluate(el => (el as HTMLElement).style.getPropertyValue('--logo-reveal'))
    const beforeHiddenPane = await reveal()
    await page.evaluate(() => (window as any).setStartupVisible(false))
    await page.clock.runFor(5000)
    expect(await reveal()).toBe(beforeHiddenPane)
    await page.evaluate(() => (window as any).releaseStartup())
    await page.evaluate(() => (window as any).setStartupVisible(true))
    await page.clock.runFor(500)
    expect(await splash.getAttribute('data-settled')).toBe('false')
    const beforeBackground = await reveal()
    expect(parseFloat(beforeBackground)).toBeGreaterThan(parseFloat(beforeHiddenPane))
    expect(parseFloat(beforeBackground)).toBeLessThan(100)
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await page.clock.runFor(5000)
    expect(await splash.getAttribute('data-active')).toBe('false')
    expect(await reveal()).toBe(beforeBackground)
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await page.clock.runFor(1200)
    expect(await splash.getAttribute('data-settled')).toBe('false')
    await page.clock.runFor(600)
    await page.locator('.janus-chat-input:visible').waitFor()
    expect(await splash.count()).toBe(0)
  } finally { await page.close() }
})

it('uses a static full-screen field with reduced motion and enters the ready workspace without the entrance delay', async () => {
  const page = await open('superagent', true)
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const splash = page.locator('[data-superagent-startup]')
    await splash.waitFor()
    await expect.poll(() => splash.locator('canvas').evaluate((el: HTMLCanvasElement) => el.toDataURL())).not.toBe('data:,')
    await page.waitForTimeout(100)
    const frame = await splash.locator('canvas').evaluate((el: HTMLCanvasElement) => el.toDataURL())
    await page.waitForTimeout(100)
    expect(await splash.locator('canvas').evaluate((el: HTMLCanvasElement) => el.toDataURL())).toBe(frame)
    expect(await splash.getByRole('heading', { name: 'JanusX' }).evaluate(el => (el as HTMLElement).style.getPropertyValue('--logo-reveal'))).toBe('100%')
    expect(await splash.locator('[data-startup-wordmark]').evaluate(el => getComputedStyle(el).clipPath)).toBe('none')
    expect(await splash.locator('[data-startup-scan]').evaluate(el => getComputedStyle(el).display)).toBe('none')
    let previousFrame = frame
    for (const theme of ['white', 'planche', 'dark']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
      await expectStartupPalette(page)
      const nextFrame = await splash.locator('canvas').evaluate((el: HTMLCanvasElement) => el.toDataURL())
      expect(nextFrame).not.toBe(previousFrame)
      await page.waitForTimeout(100)
      expect(await splash.locator('canvas').evaluate((el: HTMLCanvasElement) => el.toDataURL())).toBe(nextFrame)
      previousFrame = nextFrame
    }
    // Runtime/plugin palettes change inline tokens while retaining their base theme ID.
    await page.evaluate(() => {
      const root = document.documentElement
      root.style.setProperty('--shell-pane', '#102030')
      root.style.setProperty('--shell-text', '#f5f5f5')
      root.style.setProperty('--shell-muted', '#b0c0d0')
      root.style.setProperty('--shell-accent', '#80c0ff')
    })
    await expectStartupPalette(page)
    expect(await splash.locator('canvas').evaluate((el: HTMLCanvasElement) => el.toDataURL())).not.toBe(previousFrame)
    await splash.screenshot({ path: `${artifactRoot}/startup/runtime-palette-reduced-motion.png` })
    await page.evaluate(() => {
      for (const token of ['shell-pane', 'shell-text', 'shell-muted', 'shell-accent']) document.documentElement.style.removeProperty(`--${token}`)
    })
    await expectStartupPalette(page)
    await page.evaluate(() => (window as any).releaseStartup())
    await page.locator('.janus-chat-input:visible').waitFor({ timeout: 700 })
    expect(await splash.count()).toBe(0)
  } finally { await page.close() }
})
async function send(page: Page, text: string, separate = false) {
  // Existing parallel histories still need coverage after removal of the UI entry.
  if (separate) { await page.evaluate(text => (window as any).seedParallelInput(text), text); return }
  const input = page.locator('.janus-chat-input:visible')
  await input.fill(text); await input.press('Enter')
}
async function sendIndependentInputs(page: Page, texts: string[]) {
  await page.evaluate(inputs => { (window as any).newTopicInputs = inputs }, texts)
  const before = await page.evaluate(() => (window as any).requests.length)
  for (const [index, text] of texts.entries()) {
    await send(page, text)
    await page.waitForFunction(count => (window as any).requests.length === count, before + index + 1)
  }
  await page.evaluate(() => { (window as any).routeCalls = [] })
}
it('runs four real panes, preserves shared history and routes explicit and automatic branch messages', async()=>{
  const page=await open(),errors:string[]=[]
  page.on('pageerror',error=>errors.push(error.message))
  try {
    await page.setViewportSize({width:1440,height:1000})
    await send(page, 'Shared prior discussion')
    await page.waitForFunction(() => (window as any).requests.length === 1)
    await page.evaluate(() => (window as any).finish(0))
    await page.waitForFunction(() => (window as any).saved.conversations.some((c: any) => c.topic && c.messages.length === 2 && !c.topic.inputs.length))
    await page.evaluate(()=>{(window as any).requests=[]})
    await page.locator('.janus-chat-input:visible').evaluate(el=>{(window as any).originalInput=el})
    await sendIndependentInputs(page,['Analyze four areas in parallel, preserving existing changes','Deploy','Test','API'])
    await page.waitForFunction(()=>(window as any).requests.length===4)
    const stage=page.locator('[data-parallel-stage]'),grid=stage.locator('[data-parallel-grid]')
    await expect.poll(()=>stage.getAttribute('data-phase')).toBe('analyzing')
    const boxes=await stage.locator('[data-topic-id]').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{x:Math.round(r.x),y:Math.round(r.y),width:r.width,height:r.height}}))
    expect(new Set(boxes.map(box=>box.x)).size).toBe(2);expect(new Set(boxes.map(box=>box.y)).size).toBe(2)
    expect(boxes.every(box=>box.width>300&&box.height>150)).toBe(true)
    expect(await page.locator('.janus-chat-input:visible').count()).toBe(1)
    expect(await page.locator('.janus-chat-message.user').filter({hasText:'Analyze four areas in parallel, preserving existing changes'}).count()).toBe(1)
    const ids=await stage.locator('[data-topic-id]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-topic-id')))
    await page.evaluate(()=>{const w=window as any;for(let i=0;i<4;i++)w.delta(i,('Output for branch '+i+'\n\n').repeat(40))})
    const columns=grid.getByRole('separator',{name:'Resize analysis columns'}),rows=grid.getByRole('separator',{name:'Resize analysis rows'})
    await columns.focus();await columns.press('ArrowRight');await rows.focus();await rows.press('ArrowDown')
    expect(await columns.getAttribute('aria-valuenow')).toBe('55');expect(await rows.getAttribute('aria-valuenow')).toBe('55')
    const input=page.locator('.janus-chat-input:visible');await input.fill('Keep this draft')
    const positions=await stage.locator('[data-topic-body]').evaluateAll(nodes=>nodes.map((node,index)=>{node.scrollTop=50+index*30;return node.scrollTop}))
    await page.getByRole('button',{name:'Previous conversation',exact:true}).click()
    await expect.poll(()=>stage.getAttribute('data-view')).toBe('history')
    await expect.poll(()=>page.locator('.janus-chat-message.user:visible').textContent()).toContain('Shared prior discussion')
    await page.evaluate(()=>(window as any).delta(1,' Updated deployment analysis'))
    expect(await stage.getAttribute('data-view')).toBe('history')
    await page.getByRole('button',{name:'Back to analysis',exact:true}).click()
    await expect.poll(()=>stage.getAttribute('data-view')).toBe('panes')
    await expect.poll(()=>stage.locator('[data-topic-body]').evaluateAll(nodes=>nodes.map(node=>node.scrollTop))).toEqual(positions)
    expect(await input.textContent()).toBe('Keep this draft')
    await stage.locator('[data-branch-supplement]').nth(2).click()
    expect(await page.locator('[data-branch-target]').getAttribute('data-branch-target')).toBe(ids[2])
    expect(await input.textContent()).toBe('Keep this draft')
    await input.fill('Only adjust the Test branch');await input.press('Enter')
    await page.waitForFunction(()=>(window as any).steerCalls.length===1)
    expect(await page.evaluate(()=>(window as any).steerCalls[0].conversationId)).toBe(ids[2])
    await expect.poll(()=>page.locator('[data-branch-target]').count()).toBe(0)
    await page.evaluate(id=>{(window as any).autoRouteTarget=id},ids[1])
    await send(page,'Follow-up');await page.waitForFunction(()=>(window as any).steerCalls.length===2)
    expect(await page.evaluate(()=>(window as any).steerCalls[1].conversationId)).toBe(ids[1])
    expect(await page.evaluate(()=>(window as any).routeCalls.length)).toBe(1)
    await page.evaluate(()=>(window as any).finish(0))
    expect(await stage.locator('[data-topic-id]:visible').count()).toBe(4)
    await mkdir(`${artifactRoot}/superagent-production`,{recursive:true})
    await page.screenshot({path:`${artifactRoot}/superagent-production/four-running.png`})
    for(const theme of ['white','planche']){
      await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme)
      await page.screenshot({path:`${artifactRoot}/superagent-production/four-${theme}.png`})
    }
    await page.evaluate(()=>document.documentElement.dataset.theme='dark')
    await page.setViewportSize({width:480,height:850})
    await expect.poll(()=>stage.getAttribute('data-narrow')).toBe('true')
    expect(await stage.getByRole('navigation',{name:'Select an analysis branch'}).getByRole('button').count()).toBe(4)
    await stage.getByRole('navigation').getByRole('button',{name:'API',exact:true}).click()
    expect(await stage.locator('[data-topic-id]:visible').getAttribute('data-topic-id')).toBe(ids[3])
    await page.screenshot({path:`${artifactRoot}/superagent-production/four-narrow.png`})
    await page.setViewportSize({width:1440,height:1000})
    await page.evaluate(()=>{const w=window as any;w.finish(1);w.finish(2);w.finish(3)})
    await expect.poll(()=>stage.getAttribute('data-phase')).toBe('held')
    await stage.locator('[data-parallel-merge]').click()
    await expect.poll(()=>stage.getAttribute('data-phase')).toBe('merging')
    await expect.poll(()=>stage.getAttribute('data-view')).toBe('conversation')
    const cards=await stage.locator('[data-topic-id]').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{x:Math.round(r.x),y:Math.round(r.y)}}))
    expect(new Set(cards.map(card=>card.x)).size).toBe(1);expect(new Set(cards.map(card=>card.y)).size).toBe(4)
    expect(await input.evaluate(el=>el===(window as any).originalInput)).toBe(true)
    await page.waitForTimeout(300)
    await expect.poll(()=>stage.evaluate(el=>el.closest('.janus-chat-messages')!.scrollTop)).toBe(0)
    await page.screenshot({path:`${artifactRoot}/superagent-production/four-merged.png`})
    expect(errors).toEqual([])
  } finally {await page.close()}
},30000)
it('returns an untouched analysis group to four independent cards with loading and no focus change',async()=>{
  const page=await open()
  try{
    await page.setViewportSize({width:1440,height:1000})
    await sendIndependentInputs(page,['One','Two','Three','Four'])
    await page.waitForFunction(()=>(window as any).requests.length===4)
    const stage=page.locator('[data-parallel-stage]')
    await expect.poll(()=>stage.getAttribute('data-phase')).toBe('analyzing')
    await page.evaluate(()=>{const w=window as any;for(let i=0;i<4;i++)w.finish(i)})
    await expect.poll(()=>stage.getAttribute('data-phase')).toBe('gathering')
    await expect.poll(()=>stage.getAttribute('data-phase')).toBe('merging')
    await expect.poll(()=>stage.getAttribute('data-view')).toBe('conversation')
    expect(await stage.locator('[data-topic-id]').count()).toBe(4)
    expect(await page.locator('.janus-chat-input:visible').evaluate(el=>el===document.activeElement)).toBe(true)
    const before=await page.evaluate(()=>(window as any).requests.length)
    const id=await stage.locator('[data-topic-id]').first().getAttribute('data-topic-id')
    await stage.locator('[data-branch-supplement]').first().click();await send(page,'Continue this completed branch')
    await page.waitForFunction(n=>(window as any).requests.length===n+1,before)
    expect(await page.evaluate(()=>(window as any).requests.at(-1).conversationId)).toBe(id)
    expect(await stage.getAttribute('data-view')).toBe('conversation')
    await page.evaluate(()=>(window as any).finish(4))
    const resumed=stage.locator('[data-topic-id]').first()
    await expect.poll(()=>resumed.locator('.superagent-reply').last().getAttribute('open')).not.toBeNull()
    await expect.poll(()=>resumed.locator('.superagent-reply').last().textContent()).toContain('Continue this completed branch')
  }finally{await page.close()}
},20000)
it('keeps completed parallel history in the conversation after merging, navigation and reopening', async () => {
  const page = await open()
  try {
    await send(page, 'Shared discussion before parallel analysis')
    await page.waitForFunction(() => (window as any).requests.length === 1)
    await page.evaluate(() => (window as any).finish(0))
    await page.waitForFunction(() => (window as any).saved.conversations.some((c: any) => c.topic && c.messages.length === 2 && !c.topic.inputs.length))
    await sendIndependentInputs(page, ['Analyze first area', 'Analyze second area'])
    const stage = page.locator('[data-parallel-stage]')
    await expect.poll(() => stage.getAttribute('data-phase')).toBe('analyzing')
    await page.evaluate(() => { (window as any).finish(1); (window as any).finish(2) })
    await expect.poll(() => stage.getAttribute('data-phase')).toMatch(/held|merging|merged/)
    if (await stage.getAttribute('data-phase') === 'held') await stage.locator('[data-parallel-merge]').click()
    await expect.poll(() => stage.getAttribute('data-view')).toBe('conversation')
    const assertContinuousHistory = async () => {
      expect(await page.getByRole('button', { name: /^(Previous conversation|Back to conversation|此前对话|返回对话)$/ }).count()).toBe(0)
      expect(await page.locator('.janus-chat-message.user:visible').filter({ hasText: 'Shared discussion before parallel analysis' }).count()).toBe(1)
      expect(await page.locator('.janus-chat-message.user:visible').filter({ hasText: 'Analyze first area' }).count()).toBe(1)
      expect(await stage.locator('[data-topic-id]:visible').count()).toBe(2)
    }
    await assertContinuousHistory()
    await page.locator('[data-input-navigation] button').first().click()
    await assertContinuousHistory()
    expect(await stage.getAttribute('data-view')).toBe('conversation')
    const saved = await page.evaluate(() => (window as any).saved)
    await page.reload(); await page.evaluate(snapshot => { (window as any).preloaded = snapshot }, saved)
    await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script })
    await page.locator('.janus-chat-input:visible').waitFor()
    await expect.poll(() => stage.getAttribute('data-view')).toBe('conversation')
    await page.evaluate(() => (window as any).previewChinese())
    await assertContinuousHistory()
    expect(await page.evaluate(() => (window as any).requests.length)).toBe(0)
    await mkdir(`${artifactRoot}/superagent-continuous-history`, { recursive: true })
    await page.screenshot({ path: `${artifactRoot}/superagent-continuous-history/reopened.png` })
  } finally { await page.close() }
}, 20000)
it('holds an automatic merge when the reader enters a pane during its loading stage',async()=>{
  const page=await open()
  try{
    await page.setViewportSize({width:1440,height:1000})
    await sendIndependentInputs(page,['One','Two']);await page.waitForFunction(()=>(window as any).requests.length===2)
    const stage=page.locator('[data-parallel-stage]')
    await expect.poll(()=>stage.getAttribute('data-phase')).toBe('analyzing')
    await page.evaluate(()=>{(window as any).finish(0);(window as any).finish(1)})
    await expect.poll(()=>stage.getAttribute('data-phase')).toBe('merging')
    await stage.locator('[data-topic-body]').first().focus()
    await expect.poll(()=>stage.getAttribute('data-phase')).toBe('held')
    await page.waitForTimeout(1100)
    expect(await stage.getAttribute('data-view')).toBe('panes')
  }finally{await page.close()}
},20000)
it('adds real context through picker and drag, preserves a rejected draft, and sends references through the topic stream', async () => {
  const page = await open(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.evaluate(() => {
      const w = window as any; w.previewWorkers(); w.imported = []
      w.electron.fileTree.children = async () => [{ type:'file',name:'context.md',path:'context.md' }]
      w.electron.file.importConversationAttachment = async ({ name, size }: File) => { w.imported.push({name,size}); return {id:'local-ref',path:'/imports/'+name,name,kind:'file'} }
    })
    const input = page.locator('.janus-chat-input:visible')
    await input.fill('Review this context ')
    await page.getByRole('button',{name:'Add context',exact:true}).click()
    await page.getByRole('button',{name:'Reference files or folders (@)',exact:true}).click()
    await page.getByRole('textbox',{name:'Search files or enter a path'}).fill('context')
    await page.getByRole('button',{name:'context.md',exact:true}).click()
    expect(await input.locator('[data-reference-id]').count()).toBe(1)
    await page.getByRole('button',{name:'Add context',exact:true}).click()
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button',{name:'Attach files',exact:true}).click()
    await (await chooser).setFiles({name:'notes.txt',mimeType:'text/plain',buffer:Buffer.from('A real imported fixture')})
    await expect.poll(() => input.locator('[data-reference-id]').count()).toBe(2)
    expect(await page.evaluate(() => (window as any).imported)).toEqual([{name:'notes.txt',size:23}])
    const dt = await page.evaluateHandle(() => { const data = new DataTransfer(); data.setData('application/x-janusx-workspace-file',JSON.stringify({type:'file',name:'part.ts',path:'src/part.ts',workspacePath:'/fixture',quote:'const active = true'})); return data })
    await input.dispatchEvent('dragenter',{dataTransfer:dt}); await input.dispatchEvent('dragover',{dataTransfer:dt})
    expect(await page.locator('[data-context-drag=true]').count()).toBe(0)
    await mkdir(`${artifactRoot}/context`,{recursive:true})
    await page.screenshot({path:`${artifactRoot}/context/dropzone.png`})
    await input.dispatchEvent('drop',{dataTransfer:dt}); await dt.dispose()
    await expect.poll(() => input.locator('[data-reference-id]').count()).toBe(3)
    expect(await page.locator('[data-context-drag=true]').count()).toBe(0)
    // A failed submission must restore tokens with their real reference objects.
    await page.evaluate(() => { const w=window as any; w.originalSubmit=w.registry.topics.submit; w.registry.topics.submit=async()=>{throw Error('Fixture send rejected')} })
    await input.press('Enter'); await page.getByRole('alert').filter({hasText:'Fixture send rejected'}).first().waitFor()
    await expect.poll(() => input.locator('[data-reference-id]').count()).toBe(3)
    await page.evaluate(() => { const w=window as any; w.registry.topics.submit=w.originalSubmit })
    for (const theme of ['dark','white','planche']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme=theme },theme)
      await page.screenshot({path:`${artifactRoot}/context/attached-${theme}.png`})
    }
    await page.setViewportSize({width:390,height:900})
    await page.getByRole('button',{name:'Add context',exact:true}).click()
    const menu = page.getByRole('dialog',{name:'Add context',exact:true})
    expect(await menu.evaluate(el => {const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0})).toBe(true)
    await page.screenshot({path:`${artifactRoot}/context/menu-narrow.png`})
    await page.keyboard.press('Escape'); await input.press('Enter')
    await page.waitForFunction(() => (window as any).requests.length===1)
    const content = await page.evaluate(() => (window as any).requests[0].messages.at(-1).content)
    expect(content).toContain('/fixture/context.md'); expect(content).toContain('/imports/notes.txt'); expect(content).toContain('const active = true'); expect(content).not.toContain('[[ref:')
    const sent = page.locator('.janus-chat-message.user').last()
    await expect.poll(() => sent.locator('[data-prompt-reference]').count()).toBe(3)
    expect(await sent.locator('.janus-message-context').count()).toBe(0)
    expect(await sent.textContent()).not.toContain('/imports/')
    await page.waitForFunction(() => (window as any).saved.conversations.some((c: any) => c.messages.some((m: any) => m.context?.references.length === 3)))
    await page.setViewportSize({width:1100,height:850})
    await page.screenshot({path:`${artifactRoot}/context/sent.png`})
    expect(await input.textContent()).toBe(''); expect(errors).toEqual([])
  } finally { await page.close() }
},20000)

it('links exact input/reply rounds to Workers and folds history without changing manual choices', async () => {
  const page = await open()
  try {
    await page.evaluate(() => {
      const w=window as any; w.previewWorkers(); const api=w.electron.superAgent, detail=api.workDetail
      api.onChanged=(fn: unknown)=>{w.workChanged=fn;return()=>{}}
      api.workDetail=async()=>{const result=await detail();result.inputs=[{id:'source-input',eventId:w.requests[0]?.inputEventId,conversationId:w.requests[0]?.conversationId}];return result}
    })
    await send(page,'First linked question'); await page.waitForFunction(() => (window as any).requests.length===1)
    await page.evaluate(() => { const w=window as any;w.workChanged({workspaceId:'preview'});w.finish(0) })
    await page.locator('.superagent-reply').waitFor()
    await send(page,'Second unrelated question'); await page.waitForFunction(() => (window as any).requests.length===2)
    await page.evaluate(() => (window as any).finish(1))
    const replies=page.locator('.superagent-reply'), users=page.locator('.janus-chat-message.user'), card=page.locator('[data-presentation=status][data-work-id="W-01"]')
    await expect.poll(() => replies.count()).toBe(2)
    expect(await replies.first().getAttribute('open')).toBeNull(); expect(await replies.last().getAttribute('open')).not.toBeNull()
    const beforeHighlight = await users.first().boundingBox()
    await users.first().hover(); await expect.poll(() => card.getAttribute('data-cross-highlight')).toBe('true')
    expect(await users.first().boundingBox()).toEqual(beforeHighlight)
    expect(await page.locator('.janus-chat-message[data-cross-highlight=true]').count()).toBe(2)
    expect(await users.last().getAttribute('data-cross-highlight')).toBe('false')
    await card.hover(); expect(await users.first().getAttribute('data-cross-highlight')).toBe('true')
    await replies.first().locator(':scope > summary').click()
    await page.evaluate(() => (window as any).workChanged({workspaceId:'preview'}))
    expect(await replies.first().getAttribute('open')).not.toBeNull()
    await expect.poll(() => users.first().getAttribute('data-cross-highlight')).toBe('true')
    expect(await users.first().evaluate(el=>getComputedStyle(el).boxShadow)).toBe('none')
    expect(await users.first().locator('.janus-chat-message-content').evaluate(el=>getComputedStyle(el).boxShadow)).toContain('inset')
    await mkdir(`${artifactRoot}/linked`,{recursive:true})
    for (const theme of ['dark', 'white', 'planche']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
      await page.screenshot({path:`${artifactRoot}/linked/round-worker-${theme}.png`, animations:'disabled'})
      expect(await users.first().locator('.janus-chat-message-content').evaluate(el=>getComputedStyle(el).boxShadow)).toContain('inset')
      const replySurface = await page.locator('.janus-chat-message.assistant[data-cross-highlight=true]').evaluate(el => {
        const s = getComputedStyle(el, '::before')
        return { shadow:s.boxShadow, opacity:s.opacity, background:s.backgroundColor, border:s.borderLeftWidth }
      })
      expect(replySurface.shadow).toBe('none')
      expect(replySurface.border).toBe('0px')
      expect(replySurface.opacity).toBe('1')
      expect(replySurface.background).not.toBe('rgba(0, 0, 0, 0)')
      await writeFile(`${artifactRoot}/linked/highlight-${theme}.json`, JSON.stringify(replySurface, null, 2))
    }
    await page.mouse.move(20, 20)
    await expect.poll(() => page.locator('[data-cross-highlight=true]').count()).toBe(0)
    await page.keyboard.press('Tab')
    await users.last().focus(); expect(await card.getAttribute('data-cross-highlight')).toBe('false')
    expect(await page.locator('.janus-chat-message[data-cross-highlight=true]').count()).toBe(2)
    await replies.last().locator(':scope > summary').focus()
    expect(await users.last().getAttribute('data-cross-highlight')).toBe('true')
    await page.setViewportSize({width:390,height:850})
    await users.last().hover()
    await page.emulateMedia({reducedMotion:'reduce'})
    const bounds = await page.locator('.janus-chat-message[data-cross-highlight=true]').evaluateAll(nodes => nodes.map(el => {
      const r=el.getBoundingClientRect(), style=getComputedStyle(el,'::before')
      return {inside:r.left>=0&&r.right<=innerWidth, transition:style.transitionDuration}
    }))
    expect(bounds.every(row => row.inside)).toBe(true)
    expect(bounds.every(row => row.transition === '0s')).toBe(true)
    await page.screenshot({path:`${artifactRoot}/linked/round-narrow.png`})
  } finally { await page.close() }
},15000)

it('refreshes hovered steering links when work arrives and clears highlights when the live reply unmounts', async () => {
  const page = await open()
  try {
    await page.evaluate(() => {
      const w=window as any; w.previewWorkers(); const api=w.electron.superAgent, detail=api.workDetail
      api.onChanged=(fn: unknown)=>{w.workChanged=fn;return()=>{}}
      api.workDetail=async()=>({...await detail(),inputs:w.linkedInputs??[]})
    })
    await send(page,'Keep this answer active')
    await page.waitForFunction(() => (window as any).requests.length===1)
    const first=page.locator('.janus-chat-message.user').first(), live=page.locator('.janus-chat-message.streaming')
    const card=page.locator('[data-presentation=status][data-work-id="W-01"]')
    await first.hover()
    await expect.poll(() => first.getAttribute('data-cross-highlight')).toBe('true')
    const originalInput = await first.elementHandle()
    expect(await card.getAttribute('data-cross-highlight')).toBe('false')
    // Arrival and work assignment happen without moving the pointer off the original input.
    await page.evaluate(async () => {
      const w=window as any, topic=w.registry.topicConversations[0]
      await w.registry.topics.submit(topic.topic.rootId,'preview','Add the Worker constraint')
      w.linkedInputs=[{id:'source-input',eventId:w.steerCalls[0].entryId,conversationId:topic.id}]
      w.workChanged({workspaceId:'preview'})
    })
    expect(await originalInput!.evaluate(el => el.isConnected)).toBe(true)
    await expect.poll(() => card.getAttribute('data-cross-highlight')).toBe('true')
    expect(await page.locator('.janus-chat-message[data-cross-highlight=true]').count()).toBe(3)
    await live.hover()
    await page.evaluate(() => (window as any).finish(0))
    await expect.poll(() => page.locator('.janus-chat-message.streaming').count()).toBe(0)
    await expect.poll(() => page.locator('[data-cross-highlight=true]').count()).toBe(0)
    await card.hover()
    expect(await page.locator('.janus-chat-message[data-cross-highlight=true]').count()).toBe(3)
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await expect.poll(() => page.locator('[data-cross-highlight=true]').count()).toBe(0)
    const reply=page.locator('.superagent-reply').first(), summary=reply.locator(':scope > summary')
    await summary.click(); await summary.click()
    const originalReply=await reply.elementHandle()
    await send(page,'Start a later round')
    await page.waitForFunction(() => (window as any).requests.length===2)
    expect(await originalReply!.evaluate(el => el.isConnected && (el as HTMLDetailsElement).open)).toBe(true)
  } finally { await page.close() }
},15000)

it('waits for request registration before steering input sent during startup', async () => {
  const page = await open()
  try {
    await page.evaluate(() => { (window as any).modelGate = new Promise(resolve => { (window as any).releaseModel = resolve }) })
    await send(page, 'Start'); await send(page, 'Correction during startup')
    await page.waitForFunction(() => (window as any).saved.conversations.some((c: any) => c.topic?.inputs.length === 2))
    expect(await page.evaluate(() => (window as any).requests.length)).toBe(0)
    await page.evaluate(() => (window as any).releaseModel())
    await page.waitForFunction(() => (window as any).steerCalls.length === 1)
    const { requests, steerCalls } = await page.evaluate(() => ({ requests: (window as any).requests, steerCalls: (window as any).steerCalls }))
    expect(requests).toHaveLength(1)
    expect(steerCalls[0]).toMatchObject({ expectedRequestId: requests[0].requestId, text: 'Correction during startup' })
    await page.evaluate(() => (window as any).finish(0))
    await page.waitForFunction(() => (window as any).saved.conversations.some((c: any) => c.topic && !c.topic.inputs.length))
    expect(await page.evaluate(() => (window as any).requests.length)).toBe(1)
  } finally { await page.close() }
})

it('animates reply height in both directions, reverses immediately, and respects reduced motion', async () => {
  const page = await open()
  try {
    await send(page, 'Review reply disclosure')
    await page.waitForFunction(() => (window as any).requests.length === 1)
    await page.evaluate(() => {
      const w = window as any
      w.delta(0, '\n\n' + 'Keep each section readable while opening and closing.\n\n'.repeat(14)); w.finish(0)
    })
    const reply = page.locator('.superagent-reply'), summary = reply.locator(':scope > summary')
    await expect.poll(() => summary.getAttribute('aria-expanded')).toBe('true')
    // Let the default latest-reply reveal finish before measuring user interaction.
    await expect.poll(() => reply.evaluate(el => el.getAnimations({ subtree: true }).length)).toBe(0)
    const frames = await reply.evaluate(async el => {
      const summary = el.querySelector('summary')!, body = el.querySelector<HTMLElement>(':scope > div')!
      const startHeight = el.getBoundingClientRect().height, header = summary.getBoundingClientRect().height
      summary.click()
      await new Promise(requestAnimationFrame)
      const inert = body.inert, values: number[] = [], start = performance.now()
      while (performance.now() - start < 300) { await new Promise(requestAnimationFrame); values.push(el.getBoundingClientRect().height) }
      return { startHeight, header, inert, values }
    })
    expect(frames.inert).toBe(true)
    expect(frames.values.some(h => h > frames.header + 2 && h < frames.startHeight - 2)).toBe(true)
    expect(frames.values.at(-1)).toBeCloseTo(frames.header, 0)
    expect(await summary.textContent()).toContain('Latest reply')
    await summary.focus(); await summary.press('Enter')
    await expect.poll(() => summary.getAttribute('aria-expanded')).toBe('true')
    await expect.poll(() => reply.evaluate(el => el.getAnimations({ subtree: true }).length)).toBe(0)
    expect((await reply.boundingBox())!.height).toBeGreaterThan(frames.header + 100)
    const reversed = await reply.evaluate(async el => {
      const summary = el.querySelector('summary')!; summary.click()
      const start = performance.now()
      while (performance.now() - start < 75) await new Promise(requestAnimationFrame)
      const before = el.getBoundingClientRect().height; summary.click()
      return { before, after: el.getBoundingClientRect().height }
    })
    expect(Math.abs(reversed.before - reversed.after)).toBeLessThan(2)
    await expect.poll(() => summary.getAttribute('aria-expanded')).toBe('true')
    await expect.poll(() => reply.evaluate(el => el.getAnimations({ subtree: true }).length)).toBe(0)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await summary.press('Space')
    await expect.poll(() => summary.getAttribute('aria-expanded')).toBe('false')
    expect(await reply.evaluate(el => getComputedStyle(el, '::details-content').transitionDuration)).toBe('0s')
    await page.evaluate(() => (window as any).previewChinese())
    await page.setViewportSize({ width: 320, height: 720 })
    await mkdir(`${artifactRoot}/disclosures`, { recursive: true })
    for (const theme of ['dark', 'white', 'planche']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
      expect(await summary.textContent()).toContain('展开')
      expect(await summary.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      await page.screenshot({ path: `${artifactRoot}/disclosures/reply-${theme}-320.png` })
    }
  } finally { await page.close() }
})
it('withdraws an unconsumed supplement from history and persistence without replaying it', async () => {
  const page = await open()
  try {
    await page.evaluate(() => { (window as any).holdSteer = true })
    await send(page, 'Start'); await page.waitForFunction(() => (window as any).requests.length === 1)
    await send(page, 'Withdraw this supplement')
    await page.getByRole('button', { name: 'Withdraw steering message', exact: true }).click()
    await page.waitForFunction(() => (window as any).saved.conversations.every((c: any) => !c.messages.some((m: any) => m.content === 'Withdraw this supplement')
      && !c.topic?.inputs.some((i: any) => i.message.content === 'Withdraw this supplement')))
    await page.evaluate(() => (window as any).finish(0))
    await page.waitForFunction(() => (window as any).saved.conversations.some((c: any) => c.topic && !c.topic.inputs.length))
    expect(await page.evaluate(() => (window as any).requests.length)).toBe(1)
  } finally { await page.close() }
})
it('classifies consecutive input and applies related input without waiting for completion', async () => {
  const page = await open()
  try {
    await page.evaluate(() => { (window as any).holdSteer = true })
    await send(page, 'Explain the plan'); await page.waitForFunction(() => (window as any).requests.length === 1)
    await send(page, 'Keep it short'); await send(page, 'Use Chinese')
    await page.waitForFunction(() => (window as any).steerCalls.length === 2)
    expect(await page.evaluate(() => (window as any).requests.length)).toBe(1)
    expect(await page.evaluate(() => (window as any).routeCalls.length)).toBe(2)
    const inputs = await page.evaluate(() => (window as any).steerCalls)
    expect(inputs.map((i: any) => i.text)).toEqual(['Keep it short', 'Use Chinese'])
    expect(inputs.every((i: any) => i.expectedRequestId === inputs[0].expectedRequestId)).toBe(true)
    await page.waitForFunction(() => document.querySelectorAll('.janus-chat-queued-badge').length === 2)
    await mkdir(`${artifactRoot}/superagent-steering`, { recursive: true })
    await page.screenshot({ path: `${artifactRoot}/superagent-steering/pending.png`, fullPage: true })
    await page.evaluate(() => (window as any).steerCalls.forEach((window as any).applySteer))
    await page.waitForFunction(() => !document.querySelector('.janus-chat-queued-badge'))
    await page.getByText('Updated: Keep it short Updated: Use Chinese', { exact: false }).first().waitFor()
    await page.evaluate(() => (window as any).finish(0))
    await page.waitForFunction(() => (window as any).saved.conversations.some((c: any) => c.topic && !c.topic.inputs.length))
    expect(await page.evaluate(() => (window as any).requests.length)).toBe(1)
    for (const content of ['Keep it short', 'Use Chinese']) expect(await page.locator('.janus-chat-message.user').filter({ hasText: content }).count()).toBe(1)
    await page.setViewportSize({ width: 390, height: 850 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `${artifactRoot}/superagent-steering/applied-narrow.png`, fullPage: true })
  } finally { await page.close() }
})
it('renders right-aligned input bubbles and left-aligned replies across themes and narrow layouts', async () => {
  const page = await open()
  try {
    await page.evaluate(() => (window as any).previewWorkers())
    await send(page, 'Align the conversation and reports with the reviewed HTML.\nKeep all existing interactions.')
    await page.waitForFunction(() => (window as any).requests.length === 1)
    await page.evaluate(() => (window as any).finish(0))
    const user = page.locator('[data-topic-id] .janus-chat-message.user').first()
    await user.waitFor()
    await page.locator('[data-topic-id] .janus-chat-message.assistant').first().waitFor()
    const geometry = () => user.evaluate(el => {
      const bubble = el.querySelector('.janus-chat-message-content')!, b = bubble.getBoundingClientRect(), row = el.getBoundingClientRect()
      const assistant = el.closest('.janus-chat-messages')!.querySelector('.janus-chat-message.assistant')!, a = assistant.getBoundingClientRect()
      return {right: Math.abs(b.right - row.right), separation: b.left - a.left, align: getComputedStyle(bubble).textAlign, radius: parseFloat(getComputedStyle(bubble).borderTopLeftRadius), overflow: el.scrollWidth > el.clientWidth}
    })
    await mkdir(`${artifactRoot}/bubbles`, { recursive: true })
    for (const theme of ['dark', 'white', 'planche']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
      const g = await geometry()
      expect(g.right).toBeLessThan(2); expect(g.separation).toBeGreaterThan(20); expect(g.align).toBe('left'); expect(g.radius).toBe(16); expect(g.overflow).toBe(false)
      const parity = await user.evaluate(el => {
        const host = document.createElement('div'); host.dataset.superagentWorkspace = ''; host.style.cssText = 'position:fixed;left:-10000px;width:850px'
        host.innerHTML = '<div class="janus-chat" data-conversation-style><div class="janus-chat-message user"><div class="janus-chat-message-content">Native reference</div></div></div>'
        document.body.append(host)
        const actual = getComputedStyle(el.querySelector('.janus-chat-message-content')!), native = getComputedStyle(host.querySelector('.janus-chat-message-content')!)
        const properties = ['borderRadius', 'backgroundColor', 'borderTopColor', 'padding', 'fontSize', 'lineHeight'] as const
        const values = properties.map(key => ({property: key, actual: actual[key], native: native[key]})); host.remove(); return values
      })
      for (const value of parity) expect(value.actual, value.property).toBe(value.native)
      expect(await user.locator('.janus-chat-message-speaker').isVisible()).toBe(false)
      await page.screenshot({ path: `${artifactRoot}/bubbles/workspace-${theme}.png` })
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: `${artifactRoot}/bubbles/narrow-before-check.png` })
    await expect.poll(async () => (await geometry()).right).toBeLessThan(2)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `${artifactRoot}/bubbles/workspace-narrow.png` })
  } finally { await page.close() }
})
it('keeps topic keyboard focus inside the clipping card', async () => {
  const page = await open()
  try {
    await send(page, 'Inspect the active topic focus boundary')
    const stop = page.locator('[data-topic-id] header button').first()
    await stop.waitFor(); await stop.focus()
    const geometry = await stop.evaluate(el => {
      const r = el.getBoundingClientRect(), card = el.closest('[data-topic-id]')!, b = card.getBoundingClientRect(), s = getComputedStyle(el)
      const ink = Math.max(0, parseFloat(s.outlineWidth) + parseFloat(s.outlineOffset))
      return {overflow: getComputedStyle(card).overflow, outline: s.outline, offset: s.outlineOffset, outside: Math.max(0, r.right + ink - b.right, b.left - r.left + ink)}
    })
    await mkdir(`${artifactRoot}/bubbles`, {recursive: true})
    await writeFile(`${artifactRoot}/bubbles/focus-geometry.json`, JSON.stringify(geometry, null, 2))
    await page.screenshot({path: `${artifactRoot}/bubbles/topic-focus.png`})
    expect(geometry.outside).toBeLessThanOrEqual(0.5)
  } finally { await page.close() }
})
it('retries a failed topic using saved Settings even while the root and model catalog still select the old model', async () => {
  const page = await open()
  try {
    await page.waitForFunction(() => (window as any).registry.getController().modelOptions.length > 0)
    await page.evaluate(() => (window as any).registry.getController().selectModel('fixture', 'model'))
    await send(page, 'Retry this input'); await page.waitForFunction(() => (window as any).requests.length === 1)
    await page.evaluate(() => (window as any).fail(0))
    await page.locator('[data-topic-state="paused"]').waitFor()
    // Deliberately do not publish a catalog refresh: dispatch must read persisted Settings.
    await page.evaluate(() => { (window as any).configuredModel = { provider: { id: 'new-provider' }, modelId: 'gemini-3.8-flash' } })
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.waitForFunction(() => (window as any).requests.length === 2)
    const [first, retry] = await page.evaluate(() => (window as any).requests)
    expect(first).toMatchObject({ providerId: 'fixture', modelId: 'model' })
    expect(retry).toMatchObject({ providerId: 'new-provider', modelId: 'gemini-3.8-flash', inputEventId: first.inputEventId, conversationId: first.conversationId })
    await page.waitForFunction(() => (window as any).saved.conversations.some((c: any) => c.topic && c.modelId === 'gemini-3.8-flash'))
    expect(await page.evaluate(() => (window as any).registry.getController().activeModel.modelId)).toBe('model')
    await page.evaluate(() => (window as any).finish(1))
    await page.locator('[data-topic-state="done"]').waitFor()
    await send(page, 'Next idle turn'); await page.waitForFunction(() => (window as any).requests.length === 3)
    expect(await page.evaluate(() => (window as any).requests[2])).toMatchObject({ providerId: 'new-provider', modelId: 'gemini-3.8-flash' })
  } finally { await page.close() }
})

it('steers on the active model and applies changed Settings only to the next turn', async () => {
  const page = await open()
  try {
    await send(page, 'First'); await page.waitForFunction(() => (window as any).requests.length === 1)
    await page.evaluate(() => { (window as any).configuredModel = { provider: { id: 'next' }, modelId: 'routing-model' } })
    await send(page, 'Follow-up')
    await page.waitForFunction(() => (window as any).saved.conversations.some((c: any) => c.topic?.inputs.length === 2))
    expect(await page.evaluate(() => (window as any).routeCalls)).toHaveLength(1)
    expect(await page.evaluate(() => (window as any).requests)).toHaveLength(1)
    expect(await page.evaluate(() => (window as any).saved.conversations.find((c: any) => c.topic).modelId)).toBe('model')
    await page.evaluate(() => {
      (window as any).configuredModel = { provider: { id: 'latest' }, modelId: 'queued-model' }
      ;(window as any).finish(0)
    })
    await page.waitForFunction(() => (window as any).saved.conversations.some((c: any) => c.topic && !c.topic.inputs.length))
    await send(page, 'Next turn')
    await page.waitForFunction(() => (window as any).requests.length === 2)
    const [first, next] = await page.evaluate(() => (window as any).requests)
    expect(first).toMatchObject({ providerId: 'fixture', modelId: 'model' })
    expect(next).toMatchObject({ providerId: 'latest', modelId: 'queued-model', conversationId: first.conversationId })
    expect(next.messages.at(-1).content).toBe('Next turn')
    expect(next.messages.filter((m: any) => m.role === 'user' && m.content === 'Follow-up')).toHaveLength(1)
  } finally { await page.close() }
})

it('shares searchable model and context controls, keyboard selection and focus restoration in both languages', async () => {
  const page = await open()
  try {
    await mkdir(`${artifactRoot}/superagent-model-settings`, { recursive: true })
    for (const language of ['en', 'zh-CN']) {
      if (language === 'zh-CN') await page.evaluate(() => (window as any).previewChinese())
      expect(await page.getByRole('button', { name: /^(Separate question|独立提问)$/ }).count()).toBe(0)
      expect(await page.locator('[data-superagent-design] > header').count()).toBe(0)
      expect(await page.locator('[data-conversation-welcome] [data-active=true] h2').textContent()).toBe(language === 'en' ? 'Where would you like to start?' : '想从哪里开始？')
      expect(await page.locator('[data-selection-trigger="model"]').count()).toBe(1)
      expect(await page.locator('.janus-chat-clear-button, [data-selection-trigger="permission"], [data-selection-trigger="effort"]').count()).toBe(0)
      const input = page.locator('.janus-chat-input:visible')
      await input.fill('Keep this draft'); await input.press('Tab')
      expect(await input.evaluate(el => document.activeElement === el)).toBe(false)
      await input.focus(); await input.press('Control+p')
      const menu = page.locator('[data-composer-options][data-panel="model"]')
      await menu.waitFor()
      const search = menu.getByRole('combobox').first()
      await expect.poll(()=>search.evaluate(el=>document.activeElement===el)).toBe(true)
      await menu.locator('select').selectOption('second')
      expect(await menu.getByRole('listbox').getByRole('option').count()).toBe(1)
      await search.fill('no-matching-model')
      expect(await menu.getByRole('listbox').getByRole('option').count()).toBe(0)
      await search.fill('alternate')
      expect(await menu.getByRole('listbox').getByRole('option').count()).toBe(1)
      await search.press('Enter')
      await expect.poll(() => page.locator('[data-selection-trigger="model"]').innerText()).toContain('alternate')
      await expect.poll(()=>input.evaluate(el=>document.activeElement===el)).toBe(true)
      await input.press('Control+p')
      await page.keyboard.press('Escape')
      expect(await page.locator('[data-selection-trigger="model"]').evaluate(el=>document.activeElement===el)).toBe(true)
      expect(await input.textContent()).toBe('Keep this draft')
      await page.locator('[data-selection-trigger="model"]').click()
      await page.getByRole('button',{name:language==='en'?'Add context':'添加上下文',exact:true}).click()
      expect(await menu.count()).toBe(0)
      await page.getByRole('dialog').waitFor()
      await page.locator('[data-selection-trigger="model"]').click()
      await menu.waitFor()
      expect(await page.getByRole('dialog').count()).toBe(0)
      await page.keyboard.press('Escape')
      await page.screenshot({ path: `${artifactRoot}/superagent-model-settings/composer-${language}.png` })
    }
    await send(page,'Use the selected model'); await page.waitForFunction(() => (window as any).requests.length===1)
    expect(await page.evaluate(() => (window as any).requests[0])).toMatchObject({providerId:'second',modelId:'alternate'})
    await page.evaluate(() => (window as any).registry.getController().selectModel('fixture','model',true))
    await send(page,'Keep guiding this turn')
    await page.waitForFunction(() => (window as any).steerCalls.length===1)
    expect(await page.evaluate(() => (window as any).requests.length)).toBe(1)
    await page.evaluate(() => (window as any).finish(0))
    await page.waitForFunction(() => (window as any).saved.conversations.some((c:any) => c.topic && !c.topic.inputs.length))
    await send(page,'Next turn uses the new selection'); await page.waitForFunction(() => (window as any).requests.length===2)
    expect(await page.evaluate(() => (window as any).requests[1])).toMatchObject({providerId:'fixture',modelId:'model'})
  } finally { await page.close() }
})

it('does not fall back to a stale topic model when Settings has no default and shows localized recovery guidance', async () => {
  const page = await open()
  try {
    await send(page, 'First'); await page.waitForFunction(() => (window as any).requests.length === 1)
    await page.evaluate(() => { (window as any).fail(0); (window as any).configuredModel = null })
    await page.locator('[data-topic-state="paused"]').waitFor()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Choose a default model in Settings' }).waitFor()
    expect(await page.evaluate(() => (window as any).requests.length)).toBe(1)
    await page.evaluate(() => (window as any).previewChinese())
    await page.getByRole('button', { name: '继续处理', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '请在设置 → LLM 引擎中选择默认模型' }).waitFor()
    expect(await page.evaluate(() => (window as any).requests.length)).toBe(1)
  } finally { await page.close() }
})

it('only offers the terminal launcher toggle for an empty project area and preserves the draft', async () => {
  const page = await open()
  try {
    const toolbar = page.locator('[data-superagent-toolbar]')
    expect(await toolbar.getByRole('button', { name: 'Show terminals', exact: true }).isDisabled()).toBe(true)
    await page.evaluate(() => (window as any).previewWorkers())
    const draft = page.locator('.janus-chat-input:visible')
    await draft.fill('Keep this draft')
    await toolbar.getByRole('button', { name: 'Show terminals', exact: true }).click()
    expect(await toolbar.getByRole('button', { name: 'Hide terminal launcher', exact: true }).getAttribute('aria-expanded')).toBe('true')
    await toolbar.getByRole('button', { name: 'Hide terminal launcher', exact: true }).click()
    await page.waitForFunction(() => document.activeElement?.classList.contains('janus-chat-input'))
    expect(await draft.textContent()).toBe('Keep this draft')
    for (const type of ['terminal', 'markdown']) {
      await page.evaluate(type => (window as any).setProjectPane(type), type)
      await page.waitForFunction(() => document.querySelectorAll('[data-superagent-toolbar] button').length === 0)
      expect(await toolbar.getByRole('button', { name: /terminal/i }).count()).toBe(0)
      await page.evaluate(() => (window as any).setProjectPane(null))
      await toolbar.getByRole('button', { name: 'Show terminals', exact: true }).waitFor()
    }
    await toolbar.getByRole('button', { name: 'Show terminals', exact: true }).click()
    await page.evaluate(() => (window as any).setProjectPane('terminal'))
    await toolbar.getByRole('button', { name: /terminal/i }).waitFor({ state: 'detached' })
    await page.evaluate(() => (window as any).setProjectPane(null))
    await toolbar.getByRole('button', { name: 'Hide terminal launcher', exact: true }).click()
    expect(await draft.textContent()).toBe('Keep this draft')
    expect(await page.evaluate(() => (window as any).requests.length)).toBe(0)
  } finally { await page.close() }
})
it('keeps a live 48px monitor rail, previews without dispatch, and reads reports inline with a fixed neutral reader', async () => {
  const page = await open(), output = `${artifactRoot}/dock`
  try {
    await page.evaluate(() => {
      const w = window as any; w.previewWorkers(); w.previewWork.latestReportId = 'r1'; w.reportVersion = 'body-1'; w.reportLoadFails = true
      const detail = w.electron.superAgent.workDetail
      w.electron.superAgent.workDetail = async () => ({ ...await detail(), reports: [{ id: 'r1', resourceId: w.reportVersion, kind: 'ready', summary: 'Interface checks complete' }] })
      w.electron.superAgent.readResource = async () => { if (w.reportLoadFails) throw new Error('Resource unavailable'); return { text: 'Report evidence\n\n' + 'Verified keyboard and layout behavior.\n\n'.repeat(120) + 'REPORT_END' } }
    })
    const dock = page.locator('[data-worker-dock]'), rail = page.locator('[data-monitor-rail]'), sidebar = page.locator('#superagent-workers')
    const input = page.locator('.janus-chat-input'), toggle = page.locator('[data-dock-toggle]'), edge = page.getByRole('separator', { name: 'Resize Worker panel' })
    await sidebar.getByRole('article').waitFor()
    await expect.poll(() => dock.evaluate(el => Math.round(el.getBoundingClientRect().width))).toBe(340)
    await input.fill('Keep this unsubmitted context')
    const frames = await toggle.evaluate(async button => {
      const root = button.closest('[data-worker-dock]')!, start = performance.now(), result: number[] = []
      ;(button as HTMLButtonElement).click()
      while (performance.now() - start < 420) { await new Promise(requestAnimationFrame); result.push(root.getBoundingClientRect().width) }
      return result
    })
    expect(frames.some(width => width > 49 && width < 339)).toBe(true)
    expect(frames.at(-1)).toBe(48)
    expect(await sidebar.evaluate(el => (el as HTMLElement).inert)).toBe(true)
    const item = rail.locator('[data-rail-work-id="W-01"]')
    await expect.poll(() => item.getAttribute('data-unread')).toBe('true')
    const initialTime = await item.locator('time').textContent()
    await expect.poll(() => item.locator('time').textContent()).not.toBe(initialTime)
    await item.hover(); const peek = page.getByRole('region', { name: 'Worker preview', exact: true }); await peek.waitFor()
    expect(await peek.innerText()).toContain('feat/superagent-automation-exploration')
    await peek.getByRole('button', { name: 'Expand Worker' }).focus(); await page.keyboard.press('Escape')
    await expect.poll(() => peek.isVisible()).toBe(false); expect(await item.evaluate(el => el === document.activeElement)).toBe(true)
    await item.click(); await peek.getByRole('button', { name: 'View report' }).click()
    const inline = page.locator('[data-worker-report-inline]'); await inline.getByRole('alert').waitFor()
    expect(await item.getAttribute('data-unread')).toBe('true')
    await page.evaluate(() => { (window as any).reportLoadFails = false })
    await inline.getByRole('button', { name: 'Retry loading' }).click()
    await expect.poll(() => item.getAttribute('data-unread')).toBe('false')
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('janus:superagent-view')!).readWorkerReports[JSON.stringify(['preview', 'W-01'])])).toBe('body-1')
    expect(await inline.evaluate(el => !!el.closest('.janus-chat-messages'))).toBe(true)
    expect(await sidebar.locator('[data-worker-report-inline]').count()).toBe(0)
    expect(await input.textContent()).toBe('Keep this unsubmitted context')
    await mkdir(output, { recursive: true })
    await page.screenshot({ path: `${output}/inline-dark.png` })
    await inline.getByRole('button', { name: 'Enlarge report' }).click()
    const dialog = page.getByRole('dialog'), header = dialog.locator('header'), body = dialog.locator('[data-worker-report-body]')
    await expect.poll(() => dialog.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return Math.abs(bounds.left + bounds.width / 2 - innerWidth / 2) <= 1
        && Math.abs(bounds.top + bounds.height / 2 - innerHeight / 2) <= 1
    })).toBe(true)
    const top = await header.evaluate(el => el.getBoundingClientRect().top)
    await body.evaluate(el => { el.scrollTop = el.scrollHeight })
    expect(await body.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
    expect(await header.evaluate(el => el.getBoundingClientRect().top)).toBe(top)
    expect(await body.evaluate(el => getComputedStyle(el).scrollbarColor)).not.toBe('auto')
    for (const theme of ['dark','white','planche']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
      await dialog.screenshot({ path: `${output}/reader-${theme}.png` })
    }
    await page.keyboard.press('Escape')
    await page.screenshot({ path: `${output}/returned-inline.png` })
    await inline.getByRole('button', { name: 'Close report' }).click()
    await page.evaluate(() => { const w = window as any; w.reportVersion = 'body-2'; w.workerRecordChanged({ workspaceId: 'preview' }) })
    await expect.poll(() => item.getAttribute('data-unread')).toBe('true')
    await toggle.press('Enter'); await expect.poll(() => dock.evaluate(el => Math.round(el.getBoundingClientRect().width))).toBe(340)
    const reversal = await toggle.evaluate(async button => {
      const root = button.closest('[data-worker-dock]')!
      ;(button as HTMLButtonElement).click()
      const started = performance.now()
      while (performance.now() - started < 90) await new Promise(requestAnimationFrame)
      const mid = root.getBoundingClientRect().width; (button as HTMLButtonElement).click()
      return { mid, immediate: root.getBoundingClientRect().width }
    })
    expect(reversal.mid).toBeGreaterThan(48); expect(reversal.mid).toBeLessThan(340)
    expect(Math.abs(reversal.immediate - reversal.mid)).toBeLessThan(2)
    await expect.poll(() => dock.evaluate(el => Math.round(el.getBoundingClientRect().width))).toBe(340)
    await edge.click(); expect(await toggle.getAttribute('aria-expanded')).toBe('true')
    await edge.press('Enter'); await edge.press('Space'); expect(await toggle.getAttribute('aria-expanded')).toBe('true')
    await toggle.click(); await expect.poll(() => dock.evaluate(el => Math.round(el.getBoundingClientRect().width))).toBe(48)
    await page.emulateMedia({ reducedMotion: 'reduce' }); await toggle.focus(); await page.keyboard.press('Enter')
    await expect.poll(() => dock.evaluate(el => Math.round(el.getBoundingClientRect().width))).toBe(340)
    expect(await dock.evaluate(el => getComputedStyle(el.parentElement!).transitionDuration)).toBe('0s')
    const grip = await edge.boundingBox()
    await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2); await page.mouse.down()
    await page.mouse.move(grip!.x + grip!.width / 2 - 30, grip!.y + grip!.height / 2); await page.mouse.up()
    await expect.poll(() => dock.evaluate(el => Math.round(el.getBoundingClientRect().width))).toBe(370)
    await toggle.press('Space'); await page.screenshot({ path: `${output}/rail-planche.png` })
    await toggle.press('Space'); await expect.poll(() => dock.evaluate(el => Math.round(el.getBoundingClientRect().width))).toBe(370)
    expect(await page.evaluate(() => (window as any).requests.length)).toBe(0)
    await writeFile(`${output}/motion.json`, JSON.stringify({ frames, reversal }, null, 2))
  } finally { await page.close() }
})

it('shows distinct Worker panel states and returns to the draft from the narrow Worker view', async () => {
  const page = await open()
  try {
    await page.evaluate(() => (window as any).previewWorkers())
    await page.getByRole('article', { name: 'Refine conversation layout' }).waitFor()
    const toggle = page.locator('[data-dock-toggle]')
    const sidebar = page.locator('#superagent-workers')
    const header = sidebar.locator('[data-worker-panel-header]')
    expect(await header.getByText('JanusX', { exact: true }).count()).toBe(1)
    expect(await header.getByText('1 / 2 active', { exact: true }).count()).toBe(1)
    expect(await page.locator('button[aria-controls="superagent-workers"]').count()).toBe(1)
    expect(await page.locator('[data-superagent-toolbar] button[aria-controls="superagent-workers"]').count()).toBe(0)
    const buttonPosition = await toggle.boundingBox()
    const draft = page.locator('.janus-chat-input')
    await draft.fill('Return to this draft')
    const divider = page.getByRole('separator', { name: 'Resize Worker panel' })
    await divider.focus(); await page.keyboard.press('End')
    await mkdir(`${artifactRoot}/superagent-toolbar`, { recursive: true })
    for (const theme of ['dark', 'white', 'planche']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
      expect(await toggle.getAttribute('aria-expanded')).toBe('true')
      await expect.poll(() => sidebar.evaluate(el => Math.round(el.getBoundingClientRect().right))).toBe(1100)
      await expect.poll(() => sidebar.evaluate(el => getComputedStyle(el).opacity)).toBe('1')
      expect(await sidebar.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      // The open dock is one column: its button occupies header space, never a second rail.
      const headerBox = (await header.boundingBox())!, controlBox = (await toggle.boundingBox())!
      const capacityBox = (await header.getByText('1 / 2 active', { exact: true }).boundingBox())!
      const controlsBox = (await page.locator('[data-worker-controls]').boundingBox())!
      expect(controlBox.y).toBeGreaterThanOrEqual(headerBox.y)
      expect(controlsBox.y + controlsBox.height).toBeLessThanOrEqual(headerBox.y + headerBox.height)
      expect(capacityBox.x + capacityBox.width).toBeLessThan(controlBox.x)
      const openBackground = await toggle.evaluate(el => getComputedStyle(el).backgroundColor)
      await page.evaluate(() => (document.activeElement as HTMLElement)?.blur()); await page.mouse.move(0, 0)
      await page.screenshot({ path: `${artifactRoot}/superagent-toolbar/${theme}-expanded.png` })
      await toggle.focus(); await page.keyboard.press('Enter')
      expect(await toggle.getAttribute('aria-expanded')).toBe('false')
      await expect.poll(async () => Math.round((await toggle.boundingBox())!.x)).toBe(Math.round(buttonPosition!.x))
      expect(Math.round((await toggle.boundingBox())!.y)).toBe(Math.round(buttonPosition!.y))
      expect(await sidebar.getAttribute('inert')).toBe('')
      await expect.poll(() => sidebar.isVisible()).toBe(false)
      // Expanded state is conveyed by the glyph; idle shell buttons stay transparent.
      expect(await toggle.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(openBackground)
      await page.mouse.move(0, 400)
      await page.screenshot({ path: `${artifactRoot}/superagent-toolbar/${theme}-collapsed.png` })
      await page.keyboard.press('Space')
      expect(await toggle.getAttribute('aria-expanded')).toBe('true')
      expect(await divider.getAttribute('aria-valuenow')).toBe('440')
    }
    await page.setViewportSize({ width: 1100, height: 420 })
    await divider.focus(); await page.keyboard.press('Home')
    expect(await divider.getAttribute('aria-valuenow')).toBe('280')
    const workerCard = sidebar.getByRole('article', { name: 'Refine conversation layout' })
    const details = workerCard.locator('[data-worker-header] button[aria-expanded]').first()
    expect(await details.getAttribute('aria-expanded')).toBe('false')
    await details.click()
    expect(await details.getAttribute('aria-expanded')).toBe('true')
    const model = workerCard.getByRole('button', { name: /^Model settings:/ })
    const prompt = workerCard.getByRole('button', { name: 'Latest dispatched prompt', exact: true })
    await prompt.scrollIntoViewIfNeeded()
    expect((await header.boundingBox())!.y).toBe((await sidebar.boundingBox())!.y)
    for (const control of [model, prompt]) {
      expect(await control.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) })).toBe(true)
    }
    expect(await workerCard.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await mkdir(`${artifactRoot}/superagent-compact`, { recursive: true })
    await sidebar.screenshot({ path: `${artifactRoot}/superagent-compact/sidebar-280-short.png` })
    await divider.focus(); await page.keyboard.press('End')
    await page.setViewportSize({ width: 480, height: 850 })
    await page.waitForFunction(() => document.querySelector('[data-superagent-workspace]')?.getAttribute('data-compact') === 'true')
    await toggle.click()
    expect(await toggle.innerText()).toBe('')
    expect(await toggle.getAttribute('title')).toBe('Back to chat')
    expect(await toggle.getAttribute('aria-label')).toBe('Back to chat')
    expect(await draft.isVisible()).toBe(false)
    expect(await sidebar.isVisible()).toBe(true)
    await expect.poll(() => sidebar.evaluate(el => Math.round(el.getBoundingClientRect().left))).toBe(0)
    await expect.poll(() => sidebar.evaluate(el => getComputedStyle(el).opacity)).toBe('1')
    expect(Math.round((await sidebar.boundingBox())!.width)).toBe(480)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `${artifactRoot}/superagent-toolbar/narrow-workers.png` })
    await toggle.click()
    await page.waitForFunction(() => document.activeElement?.classList.contains('janus-chat-input'))
    expect(await draft.textContent()).toBe('Return to this draft')
    await page.screenshot({ path: `${artifactRoot}/superagent-toolbar/narrow-chat.png` })
    await page.setViewportSize({ width: 1100, height: 850 })
    await page.waitForFunction(() => document.querySelector('[data-superagent-workspace]')?.getAttribute('data-compact') === 'false')
    expect(await toggle.getAttribute('aria-expanded')).toBe('true')
    expect(await divider.getAttribute('aria-valuenow')).toBe('440')
    // A short, narrow pane still fits the header, controls and scrollable Worker cards.
    await page.setViewportSize({ width: 320, height: 420 })
    await page.waitForFunction(() => document.querySelector('[data-superagent-workspace]')?.getAttribute('data-compact') === 'true')
    await page.evaluate(() => (window as any).previewChinese())
    await toggle.click()
    await expect.poll(() => sidebar.evaluate(el => Math.round(el.getBoundingClientRect().left))).toBe(0)
    await expect.poll(() => sidebar.evaluate(el => getComputedStyle(el).opacity)).toBe('1')
    expect(await sidebar.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    expect(await toggle.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) })).toBe(true)
    await page.screenshot({ path: `${artifactRoot}/superagent-toolbar/narrow-zh-320.png` })
    const longName = 'JanusX / SuperAgent workspace with a very long project name'
    await page.evaluate(name => (window as any).previewWorkers(name), longName)
    const projectName = header.getByTitle(longName, { exact: true })
    await projectName.waitFor()
    expect(await projectName.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true)
    expect(await header.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    expect(await header.getByTitle('所有工作区共占用 1 / 2 个名额').count()).toBe(1)
    await page.screenshot({ path: `${artifactRoot}/superagent-toolbar/narrow-long-project.png` })
    await toggle.click()
    expect(await draft.textContent()).toBe('Return to this draft')
  } finally { await page.close() }
})
it.each(['fresh-install', 'legacy-install', 'remembered-install'])('sends, steers and stops ordinary chat without a SuperAgent host on %s', async profile => {
  const page = await open(profile)
  try {
    const input = page.locator('.janus-chat-input:visible')
    const mode = page.getByRole('combobox', { name: 'Agent mode (next message)' })
    expect(await mode.count()).toBe(0)
    await input.fill('First ordinary turn')
    await input.press('Enter')
    await page.waitForFunction(() => (window as any).requests.length === 1)
    expect(await page.evaluate(() => (window as any).requests[0].agentMode)).toBe('ordinary')
    await input.fill('Add a detail')
    await input.press('Enter')
    await page.waitForFunction(() => (window as any).steerCalls.length === 1)
    await page.locator('.janus-chat-stop').click()
    await page.waitForFunction(() => (window as any).aborted === (window as any).requests[0].requestId)
    expect(await page.evaluate(() => (window as any).hasAgentPane())).toBe(false)
  } finally { await page.close() }
})

it('shows SuperAgent after activation and closes its pane on disable or removal', async () => {
  const page = await open('fresh-install')
  try {
    const launch = page.getByRole('button', { name: 'Super Agent', exact: true })
    const mode = page.getByRole('combobox', { name: 'Agent mode (next message)' })
    for (const inactive of ['disabled', 'missing']) {
      await page.evaluate(() => { (window as any).openSuperAgent() })
      expect(await page.evaluate(() => (window as any).hasAgentPane())).toBe(false)
      expect(await launch.count()).toBe(0)
      await page.evaluate(() => (window as any).pluginState('active'))
      await launch.click()
      await page.waitForFunction(() => (window as any).hasAgentPane())
      expect(await mode.count()).toBe(0)
      await page.evaluate(state => (window as any).pluginState(state), inactive)
      await launch.waitFor({ state: 'detached' })
      await page.waitForFunction(() => !(window as any).hasAgentPane())
      expect(await mode.count()).toBe(0)
    }
  } finally { await page.close() }
})

it('ignores duplicate sends and keeps newer edits while an availability check is pending', async () => {
  const page = await open()
  try {
    const input = page.locator('.janus-chat-input:visible')
    await page.evaluate(() => {
      const w = window as any
      w.checks = 0
      w.electron.superAgent.available = () => new Promise(resolve => { w.checks++; w.finishCheck = resolve })
    })
    await input.fill('Original')
    await input.press('Enter')
    await input.press('Enter')
    await input.fill('Revised instructions')
    await page.evaluate(() => (window as any).finishCheck(true))
    expect(await input.textContent()).toBe('Revised instructions')
    expect(await page.evaluate(() => [(window as any).checks, (window as any).requests.length])).toEqual([1, 0])
  } finally { await page.close() }
})

it('keeps the editable draft when the SuperAgent host is unavailable and submits it once after recovery', async () => {
  const page = await open('ordinary')
  try {
    const input = page.locator('.janus-chat-input:visible')
    await page.evaluate(() => { (window as any).electron.superAgent.available = async () => false })
    await input.fill('Keep my original input')
    await input.press('Enter')
    await page.getByRole('alert').filter({ hasText: 'Check that SuperAgent is installed and enabled' }).waitFor()
    expect(await input.textContent()).toBe('Keep my original input')
    expect(await page.evaluate(() => [(window as any).requests.length, (window as any).registry.topicConversations.length])).toEqual([0, 0])
    await page.evaluate(() => { (window as any).electron.superAgent.available = async () => true })
    await input.press('Enter')
    await page.waitForFunction(() => (window as any).requests.length === 1)
    expect(await page.evaluate(() => (window as any).requests[0].agentMode)).toBe('superagent')
  } finally { await page.close() }
})

it('keeps the dedicated workspace in SuperAgent mode and exposes no mode switch', async () => {
  const page = await open('ordinary')
  try {
    await page.locator('[data-superagent-toolbar]').waitFor()
    expect(await page.getByRole('combobox', { name: 'Agent mode (next message)' }).count()).toBe(0)
    expect(await page.locator('[data-superagent-design="multi-input"]').count()).toBe(1)
    await send(page, 'Implement the plan')
    await page.waitForFunction(() => (window as any).requests.length === 1)
    expect(await page.evaluate(() => (window as any).requests[0].agentMode)).toBe('superagent')
    await page.evaluate(() => (window as any).finish(0))
    expect(await page.locator('[data-superagent-design="multi-input"]').count()).toBe(1)
  } finally { await page.close() }
})
it('shows routing failure separately from ambiguity and retains the input for manual placement', async () => {
  const page = await open()
  try {
    await send(page, 'Discuss the plan')
    await page.waitForFunction(() => (window as any).requests.length === 1)
    await page.evaluate(() => { (window as any).rejectRoute = true })
    await send(page, 'Implement that plan')
    const choice = page.locator('[data-topic-state="choice"]')
    await choice.getByRole('alert').waitFor()
    expect(await choice.innerText()).toContain('Routing model returned no valid result')
    expect(await choice.innerText()).toContain('Implement that plan')
    expect(await choice.innerText()).not.toContain('Choose a separate topic or an existing one')
    const request = await page.evaluate(() => (window as any).routeCalls[0])
    expect(request.candidates.flatMap((c: any) => c.messages)).toContainEqual({ role: 'assistant', content: 'Response: Discuss the plan' })
    await choice.getByRole('button', { name: 'Join: Discuss the plan', exact: true }).click()
    await page.waitForFunction(() => (window as any).steerCalls.length === 1)
    await page.evaluate(() => (window as any).finish(0))
    await page.waitForFunction(() => (window as any).requests.length === 1)
  } finally { await page.close() }
})
it('restores a report as a compact card in the real SuperAgent transcript with Workers still reachable', async () => {
  const page = await open()
  try {
    await page.evaluate(() => (window as any).previewWorkers())
    await send(page, 'Check the release')
    await page.waitForFunction(() => (window as any).requests.length === 1)
    await page.evaluate(() => (window as any).finish(0))
    await page.waitForFunction(() => (window as any).saved?.conversations.some((c: any) => c.topic && c.messages.length >= 2))
    const saved = await page.evaluate(() => {
      const snapshot = structuredClone((window as any).saved)
      const root = snapshot.conversations.find((c: any) => c.id === snapshot.activeConversationId)
      root.messages.push({ id: 'worker-report:fixture-report', role: 'assistant', timestamp: Date.now(), workspaceId: 'preview',
        content: 'Worker report · Release check\n\nEnvironment needs adjustment.\n\n' + 'Exact saved evidence.\n'.repeat(80) + 'REPORT_END' })
      return snapshot
    })
    await page.reload(); await page.evaluate(snapshot => { (window as any).preloaded = snapshot }, saved)
    await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script })
    await page.waitForFunction(() => (window as any).registry?.persistenceReady)
    await page.evaluate(() => {
      const w=window as any;w.previewWorkers();const detail=w.electron.superAgent.workDetail
      w.electron.superAgent.workDetail=async()=>({...await detail(),reports:[{id:'fixture-report',resourceId:'saved-report',kind:'ready'}]})
    })
    const report = page.locator('[data-worker-report]'); await report.waitFor()
    expect(await page.locator('[data-conversation-welcome]').count()).toBe(0)
    expect(await report.count()).toBe(1); expect((await report.boundingBox())!.height).toBeLessThan(220)
    await mkdir(`${artifactRoot}/superagent-hifi`, { recursive: true })
    await page.screenshot({ path: `${artifactRoot}/superagent-hifi/workspace.png` })
    const opening = await report.getByRole('button', { name: 'View report' }).evaluate(async button => {
      const reveal = document.getElementById(button.getAttribute('aria-controls')!)!
      ;(button as HTMLButtonElement).click()
      const values: number[] = [], start = performance.now()
      while (performance.now() - start < 360) { await new Promise(requestAnimationFrame); values.push(reveal.getBoundingClientRect().height) }
      return values
    })
    expect(opening.some(h => h > 2 && h < opening.at(-1)! - 2)).toBe(true)
    const drawer = page.locator('[data-worker-report-drawer]')
    expect(await drawer.count()).toBe(1)
    expect(await drawer.evaluate(el => !!el.closest('.janus-chat-messages'))).toBe(true)
    expect(await page.locator('#superagent-workers [data-worker-report-inline]').count()).toBe(0)
    expect(await page.getByRole('dialog').count()).toBe(0)
    await page.locator('.janus-chat-input:visible').fill('Draft remains editable while reading')
    for (const theme of ['dark','white','planche']) {
      await page.evaluate(theme => {document.documentElement.dataset.theme=theme},theme)
      await page.screenshot({path:`${artifactRoot}/superagent-hifi/drawer-${theme}.png`})
    }
    await page.getByRole('button', { name: 'View original report' }).click()
    expect(await page.locator('[data-worker-report-drawer]').innerText()).toContain('REPORT_END')
    const reverse = await report.getByRole('button', { name: 'Collapse report' }).evaluate(async button => {
      const reveal = document.getElementById(button.getAttribute('aria-controls')!)!, reader = reveal.querySelector('[data-worker-report-drawer]')!
      const expandedHeight = reveal.getBoundingClientRect().height
      ;(button as HTMLButtonElement).click()
      await new Promise(requestAnimationFrame)
      const inert = reveal.inert, hidden = reveal.getAttribute('aria-hidden'), start = performance.now()
      while (performance.now() - start < 65) await new Promise(requestAnimationFrame)
      const height = reveal.getBoundingClientRect().height; (button as HTMLButtonElement).click()
      const immediate = reveal.getBoundingClientRect().height
      while (performance.now() - start < 350) await new Promise(requestAnimationFrame)
      return { inert, hidden, expandedHeight, height, immediate, sameReader: reveal.querySelector('[data-worker-report-drawer]') === reader }
    })
    expect(reverse.inert).toBe(true); expect(reverse.hidden).toBe('true')
    expect(reverse.height).toBeGreaterThan(0)
    expect(reverse.height).toBeLessThan(reverse.expandedHeight - 2)
    expect(Math.abs(reverse.height - reverse.immediate)).toBeLessThan(2)
    expect(reverse.sameReader).toBe(true)
    expect(await drawer.innerText()).toContain('REPORT_END')
    await page.keyboard.press('Escape')
    await drawer.waitFor({ state: 'detached' })
    expect(await report.getByRole('button', { name: 'View report' }).evaluate(el => el === document.activeElement)).toBe(true)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await report.getByRole('button', { name: 'View report' }).click()
    await drawer.waitFor()
    expect(await drawer.evaluate(el => getComputedStyle(el.closest('[data-report-reveal]')!).transitionDuration)).toBe('0s')
    await page.keyboard.press('Escape'); await drawer.waitFor({ state: 'detached' })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `${artifactRoot}/superagent-hifi/workspace-mobile.png` })
    expect(await page.evaluate(() => (window as any).requests.length)).toBe(0)
  } finally { await page.close() }
})
it('inserts inline engines with # and sends @ messages directly without invoking SuperAgent', async () => {
  const page = await open('ordinary')
  try {
    await page.evaluate(() => {
      const w = window as any; w.previewWorkers(); w.directCalls = []
      w.electron.superAgent.workerPolicy = async () => ({ defaultBackend: 'codex', enabled: ['codex', 'claude'] })
      const snapshot = w.electron.superAgent.snapshot
      w.electron.superAgent.snapshot = async () => ({ ...await snapshot(), executions: [] })
      w.electron.superAgent.continueWorker = async (input: any) => { w.directCalls.push(input); if (w.failDirect) throw new Error('Worker delivery unavailable'); return {} }
    })
    const input = page.locator('.janus-chat-input:visible')
    await input.fill('#cla'); await page.getByRole('option', { name: 'Claude Code Enabled' }).waitFor()
    await mkdir(`${artifactRoot}/superagent-shortcuts`, { recursive: true })
    await page.screenshot({ path: `${artifactRoot}/superagent-shortcuts/engine-picker.png` })
    await input.press('Enter')
    await input.locator('[data-engine="claude"]').waitFor()
    expect(await page.locator('[data-worker-selection]').count()).toBe(0)
    await page.keyboard.insertText('implement, then #cod')
    await page.getByRole('option', { name: 'Codex Default' }).waitFor()
    await input.press('Tab')
    await input.locator('[data-engine="codex"]').waitFor()
    await page.keyboard.insertText('test the implementation')
    await input.locator('[data-engine="claude"] button[data-remove]').click()
    expect(await input.locator('[data-engine="claude"]').count()).toBe(0)
    await input.press('ControlOrMeta+z')
    await input.locator('[data-engine="claude"]').waitFor()
    await page.screenshot({ path: `${artifactRoot}/superagent-shortcuts/inline-orchestration.png` })
    await input.press('Enter')
    await page.waitForFunction(() => (window as any).requests.length === 1)
    expect(await page.evaluate(() => (window as any).requests[0].workerBackend)).toBeUndefined()
    const request = await page.evaluate(() => (window as any).requests[0])
    expect(request.messages.filter((message: any) => message.role === 'user').map((message: any) => message.content.replace(/\s/g, ' ')).join('\n')).toContain('[[engine:claude]] implement, then [[engine:codex]] test the implementation')
    expect(await page.locator('[data-prompt-engine]').count()).toBe(2)
    await page.evaluate(() => (window as any).finish(0))
    await input.fill('@Refine'); await page.locator('[data-worker-shortcuts] [role="option"]').first().waitFor()
    await input.press('Tab')
    await page.evaluate(() => { (window as any).failDirect = true })
    await send(page, 'Add keyboard tests')
    await page.getByText('Delivery failed', { exact: false }).waitFor()
    expect(await page.evaluate(() => (window as any).requests.length)).toBe(1)
    expect(await page.evaluate(() => (window as any).routeCalls.length)).toBe(0)
    await page.evaluate(() => { (window as any).failDirect = false })
    await page.getByRole('button', { name: 'Retry direct delivery' }).click()
    await page.getByText('Accepted by scheduler', { exact: false }).waitFor()
    const calls = await page.evaluate(() => (window as any).directCalls)
    expect(calls).toHaveLength(2); expect(calls[0]).toEqual(calls[1])
    expect(calls[0]).toMatchObject({ workId: 'W-01', workspaceId: 'preview', text: 'Add keyboard tests' })
    await send(page, 'Summarize progress')
    await page.waitForFunction(() => (window as any).requests.length === 2)
    const next = await page.evaluate(() => (window as any).requests[1])
    expect(next.workerBackend).toBeUndefined()
    expect(next.messages.some((message: any) => message.role === 'assistant' && message.content.includes('Observation only') && message.content.includes('Add keyboard tests'))).toBe(true)
    await mkdir(`${artifactRoot}/superagent-shortcuts`, { recursive: true })
    await page.screenshot({ path: `${artifactRoot}/superagent-shortcuts/direct-delivery.png` })
  } finally { await page.close() }
}, 30000)

it('blocks disabled shortcut choices and keeps unselected # text literal', async () => {
  const page = await open()
  try {
    await page.evaluate(() => {
      const w = window as any
      w.electron.superAgent = { ...w.fixtureHost, workerPolicy: async () => ({ defaultBackend: 'codex', enabled: ['codex'] }) }
    })
    const input = page.locator('.janus-chat-input:visible')
    await input.fill('#cla')
    const option = page.locator('[data-worker-shortcuts] [role="option"]')
    await option.waitFor(); expect(await option.isDisabled()).toBe(true)
    await input.press('Enter'); expect(await page.locator('[data-worker-selection]').count()).toBe(0)
    await input.press('Escape')
    await input.fill('# Heading is ordinary text'); await input.press('Enter')
    await page.waitForFunction(() => (window as any).requests.length === 1)
    expect(await page.evaluate(() => (window as any).requests[0].workerBackend)).toBeUndefined()
  } finally { await page.close() }
}, 15000)

it('matches the conversation caret and lets readers return to the latest topic without losing their reading position', async () => {
  const page = await open()
  try {
    const input = page.locator('.janus-chat-input:visible')
    for (const theme of ['dark', 'white', 'planche']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
      expect(await input.evaluate(el => {
        const style = getComputedStyle(el)
        return style.caretColor === style.color
      })).toBe(true)
    }
    await send(page, 'Long topic')
    await page.waitForFunction(() => (window as any).requests.length === 1)
    const scroll = page.locator('.janus-chat-messages').first()
    const latest = page.locator('.janus-chat-latest')
    const distance = () => scroll.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)
    await page.evaluate(() => (window as any).delta(0, '\n\n' + 'A paragraph of streamed topic content.\n\n'.repeat(80)))
    await expect.poll(() => scroll.evaluate(el => el.scrollHeight > el.clientHeight + 300)).toBe(true)
    await expect.poll(distance).toBeLessThanOrEqual(20)
    expect(await latest.count()).toBe(0)
    const navigation = page.locator('[data-input-navigation]')
    await navigation.waitFor()
    expect(await navigation.count()).toBe(1)
    expect(await navigation.getAttribute('data-input-count')).toBe('1')
    await navigation.locator('button').first().hover()
    await expect.poll(() => navigation.locator('[role="tooltip"]').textContent()).toContain('Long topic')
    await navigation.locator('button').first().click()
    await expect.poll(() => scroll.evaluate(el => {
      const message = el.querySelector('[data-user-message]')!
      return Math.abs(message.getBoundingClientRect().top - el.getBoundingClientRect().top - 12)
    })).toBeLessThan(2)
    await latest.waitFor()
    const top = await scroll.evaluate(el => el.scrollTop)
    await page.evaluate(() => (window as any).delta(0, 'More content while reading history.\n\n'.repeat(20)))
    await page.waitForTimeout(150)
    expect(await scroll.evaluate(el => el.scrollTop)).toBe(top)
    const buttonBox = await latest.boundingBox(), scrollBox = await scroll.boundingBox()
    expect(buttonBox!.y).toBeGreaterThanOrEqual(scrollBox!.y)
    expect(buttonBox!.y + buttonBox!.height).toBeLessThanOrEqual(scrollBox!.y + scrollBox!.height + 1)
    expect(await page.locator('[data-topic-id] .janus-chat-latest').count()).toBe(0)
    await latest.click()
    await expect.poll(distance).toBeLessThanOrEqual(20)
    await page.evaluate(() => (window as any).delta(0, 'Follow the tail again.\n\n'.repeat(20)))
    await expect.poll(distance).toBeLessThanOrEqual(20)
    await page.evaluate(() => (window as any).finish(0))
    await page.setViewportSize({ width: 480, height: 700 })
    await navigation.locator('button').first().focus(); await page.keyboard.press('Enter')
    await latest.waitFor()
    await latest.focus(); await page.keyboard.press('Enter')
    await expect.poll(distance).toBeLessThanOrEqual(20)
    await mkdir(`${artifactRoot}/superagent-topics`, { recursive: true })
    await page.screenshot({ path: `${artifactRoot}/superagent-topics/latest-navigation.png` })
  } finally { await page.close() }
}, 30000)

it('forks only while busy, joins both full results, then resumes a normal transcript without routing', async () => {
  const page = await open()
  try {
    await send(page, 'Prior discussion'); await page.waitForFunction(() => (window as any).requests.length === 1)
    await page.evaluate(() => (window as any).finish(0))
    await page.waitForFunction(() => (window as any).saved.conversations.some((c: any) => c.topic && c.messages.length === 2 && !c.topic.inputs.length))
    await send(page, 'Feature A'); await page.waitForFunction(() => (window as any).requests.length === 2)
    expect(await page.locator('[data-parallel-section]').count()).toBe(0)
    expect(await page.evaluate(() => (window as any).routeCalls.length)).toBe(0)
    await page.evaluate(()=>{(window as any).newTopicInputs=['Feature B']})
    await send(page, 'Feature B'); await page.waitForFunction(() => (window as any).requests.length === 3)
    const section = page.locator('[data-parallel-section]')
    await expect.poll(()=>section.locator('[data-parallel="true"]').count()).toBe(2)
    await expect.poll(()=>section.getAttribute('data-phase')).toBe('analyzing')
    const initial = await page.evaluate(() => (window as any).requests)
    expect(initial[1].messages.slice(0, -1)).toEqual(initial[2].messages.slice(0, -1))
    expect(initial[2].messages.at(-1).content).toBe('Feature B')
    expect(await section.innerText()).not.toContain('Response: Prior discussion')
    expect(await page.locator('.janus-chat-input:visible').evaluate(el => el === document.activeElement)).toBe(true)
    await send(page, 'Compare both results')
    await page.getByText('Waiting for parallel results', { exact: true }).first().waitFor()
    await page.evaluate(() => (window as any).finish(2))
    expect(await page.evaluate(() => (window as any).requests.length)).toBe(3)
    expect(await section.getAttribute('data-view')).toBe('panes')
    await mkdir(`${artifactRoot}/superagent-topics`, { recursive: true })
    await page.screenshot({ path: `${artifactRoot}/superagent-topics/fork-active.png`, fullPage: true })
    await page.setViewportSize({ width: 480, height: 850 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `${artifactRoot}/superagent-topics/fork-narrow.png`, fullPage: true })
    await page.evaluate(() => (window as any).finish(1))
    await page.waitForFunction(() => (window as any).requests.length === 4)
    const continued = await page.evaluate(() => (window as any).requests[3])
    const texts = continued.messages.map((m: any) => m.content)
    expect(texts).toEqual(['Prior discussion', 'Response: Prior discussion', 'Feature A', 'Response: Feature A',
      'Feature B', 'Response: Feature B', 'Compare both results'])
    await expect.poll(()=>section.getAttribute('data-phase')).toMatch(/held|merging|merged/)
    if(await section.getAttribute('data-phase')==='held')await section.getByRole('button',{name:'Return to conversation',exact:true}).click()
    await expect.poll(()=>section.getAttribute('data-view'),{timeout:5000}).toBe('conversation')
    await page.evaluate(() => (window as any).finish(3))
    await page.waitForFunction(() => (window as any).saved.conversations.some((c: any) => c.messages.some((m: any) => m.content === 'Response: Compare both results') && !c.topic.inputs.length))
    await send(page, 'Continue normally')
    await page.waitForFunction(() => (window as any).requests.length === 5)
    expect(await page.evaluate(() => (window as any).routeCalls.length)).toBe(2)
    expect(await page.evaluate(() => (window as any).requests[4].conversationId)).toBe(continued.conversationId)
    await page.setViewportSize({ width: 1100, height: 850 })
    await page.screenshot({ path: `${artifactRoot}/superagent-topics/fork-joined.png`, fullPage: true })
    const navigation = page.locator('[data-input-navigation]')
    await expect.poll(() => navigation.getAttribute('data-input-count')).toBe('5')
    await navigation.locator('button').nth(2).hover()
    await expect.poll(() => navigation.locator('[role="tooltip"]').textContent()).toContain('Feature B')
    await navigation.locator('button').nth(2).click()
    expect(await section.locator('[data-parallel="true"]:visible').count()).toBe(2)
  } finally { await page.close() }
}, 20000)

it('keeps errors and unresolved input visible and stops only the selected topic', async () => {
  const page = await open()
  try {
    await send(page, 'First topic'); await page.waitForFunction(() => (window as any).requests.length === 1)
    await send(page, 'Independent topic', true); await page.waitForFunction(() => (window as any).requests.length === 2)
    await page.evaluate(() => (window as any).fail(0))
    await page.getByText('Fixture stream failure', { exact: true }).first().waitFor()
    await page.evaluate(()=>{const w=window as any;w.autoRouteTarget=w.requests[1].conversationId})
    await send(page, 'Follow-up'); await page.waitForFunction(() => (window as any).steerCalls.length === 1)
    expect(await page.evaluate(() => (window as any).requests.length)).toBe(2)
    await page.locator('[data-topic-state="running"]').getByRole('button', { name: 'Stop this topic and pause its queue' }).click()
    await page.locator('[data-topic-state="paused"]').first().waitFor()
    expect(await page.evaluate(() => (window as any).aborted)).toBeTruthy()
    expect(await page.evaluate(() => (window as any).requests.length)).toBe(2)
    const error = page.getByRole('alert').filter({ hasText: 'Fixture stream failure' }).first()
    const borders = await error.evaluate(el => {
      const s = getComputedStyle(el)
      return [s.borderLeftWidth, s.borderRightWidth, s.borderLeftColor, s.borderRightColor]
    })
    expect(borders.slice(0, 2)).toEqual(['1px', '1px']); expect(borders[2]).toBe(borders[3])
    await page.screenshot({ path: `${artifactRoot}/superagent-topics/error-choice.png`, fullPage: true })
  } finally { await page.close() }
}, 15000)

it('matches question typography, sends Enter answers and keeps multiline, IME and deferred drafts isolated', async () => {
  const page = await open()
  try {
    await send(page, 'First topic'); await page.waitForFunction(() => (window as any).requests.length === 1)
    await page.evaluate(() => (window as any).question(0))
    await page.getByRole('radio', { name: 'Refine Improve the layout' }).check()
    const custom = page.locator('.janus-question-custom')
    const draft = page.locator('.janus-chat-input:visible')
    await draft.fill('Keep the main draft')
    expect(await custom.evaluate(el=>el.tagName)).toBe('TEXTAREA')
    for (const theme of ['dark','white','planche']) {
      await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme)
      expect(await custom.evaluate(el=>getComputedStyle(el).fontSize)).toBe(await draft.evaluate(el=>getComputedStyle(el).fontSize))
      expect(await custom.evaluate(el=>getComputedStyle(el).lineHeight)).toBe(await draft.evaluate(el=>getComputedStyle(el).lineHeight))
    }
    await custom.fill('Preserve keyboard access')
    await custom.press('End'); await custom.press('Shift+Enter'); await custom.pressSequentially('Keep multiline answers')
    await custom.press('Control+j'); await custom.pressSequentially('Keep the main draft')
    const text = 'Preserve keyboard access\nKeep multiline answers\nKeep the main draft'
    expect(await custom.inputValue()).toBe(text)
    await custom.dispatchEvent('keydown',{key:'Enter',isComposing:true})
    await custom.dispatchEvent('keydown',{key:'Enter',keyCode:229})
    await custom.dispatchEvent('compositionstart'); await custom.press('Enter')
    expect(await page.evaluate(()=>(window as any).answerCalls.length)).toBe(0)
    await custom.dispatchEvent('compositionend')
    await page.getByRole('button', { name: 'Answer later' }).click()
    await page.getByRole('button', { name: 'Answer now' }).click()
    expect(await custom.inputValue()).toBe(text)
    expect(await page.getByRole('radio', { name: 'Refine Improve the layout' }).isChecked()).toBe(true)
    await page.evaluate(() => { (window as any).rejectAnswer = true })
    await custom.press('Enter')
    await page.getByRole('alert').filter({ hasText: 'Answer transport failed' }).waitFor()
    await page.evaluate(() => { (window as any).rejectAnswer = false })
    await custom.dispatchEvent('keydown',{key:'Enter',repeat:true})
    expect(await page.evaluate(()=>(window as any).answerCalls.length)).toBe(1)
    await custom.press('Enter')
    expect(await page.getByRole('button', { name: 'Submitted, awaiting response' }).isDisabled()).toBe(true)
    expect(await page.evaluate(() => (window as any).answerCalls.length)).toBe(2)
    expect(await page.evaluate(()=>(window as any).answerCalls[1].answer.answers[0].custom)).toBe(text)
    expect(await draft.textContent()).toBe('Keep the main draft')
    expect(await page.evaluate(()=>(window as any).requests.length)).toBe(1)
    expect(await page.evaluate(()=>(window as any).steerCalls.length)).toBe(0)
    await page.screenshot({ path: `${artifactRoot}/superagent-topics/question.png`, fullPage: true })
  } finally { await page.close() }
}, 15000)

it('restores unfinished topics without starting a stream and supports reduced motion', async () => {
  const page = await open()
  try {
    await send(page, 'First topic'); await page.waitForFunction(() => (window as any).requests.length === 1)
    const saved = await page.evaluate(() => (window as any).saved)
    await page.reload(); await page.evaluate(snapshot => { (window as any).preloaded = snapshot }, saved)
    await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script })
    await page.locator('[data-topic-state="paused"]').waitFor()
    expect(await page.locator('[data-conversation-welcome]').count()).toBe(0)
    expect(await page.evaluate(() => (window as any).requests)).toHaveLength(0)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.waitForFunction(() => (window as any).requests.length === 1)
    await send(page, 'Follow-up')
    await page.waitForFunction(() => (window as any).saved.conversations.some((c: any) => c.topic?.inputs.length === 2))
    expect(await page.locator('[data-parallel-section]').count()).toBe(0)
    expect(await page.evaluate(() => (window as any).requests.length)).toBe(1)
  } finally { await page.close() }
}, 15000)


it('aligns the composer footer and interrupts active conversation branches', async () => {
  const page = await open()
  try {
    const composer = page.locator('.janus-chat-input-wrapper:visible')
    const input = composer.locator('.janus-chat-input')
    await input.fill('Check footer')
    await input.blur()
    const border = await composer.evaluate(el => getComputedStyle(el).borderColor)
    await input.focus()
    expect(await composer.evaluate(el => getComputedStyle(el).borderColor)).not.toBe('')
    await expect.poll(() => composer.evaluate(el => getComputedStyle(el).borderColor)).not.toBe(border)
    expect(await composer.locator('.janus-chat-input-hint').textContent()).toContain('Enter')
    await expect.poll(() => composer.locator('.janus-chat-input-hint').evaluate(el => getComputedStyle(el).opacity)).toBe('1')
    expect(await composer.locator('[data-selection-trigger="model"] span').evaluate(el => getComputedStyle(el).fontSize)).toBe('11px')
    const add = await composer.getByRole('button', { name: 'Add context', exact: true }).boundingBox()
    const editor = await input.boundingBox()
    expect(Math.abs(add!.x - editor!.x)).toBeLessThan(1)
    await composer.locator('[data-selection-trigger="model"]').click()
    expect(await composer.locator('[data-selection-trigger="model"]').getAttribute('aria-expanded')).toBe('true')
    await input.press('Escape')
    await input.press('Enter')
    await page.waitForFunction(() => (window as any).requests.length === 1)
    await composer.locator('.janus-chat-stop').waitFor()
    expect(await composer.locator('.janus-chat-send').count()).toBe(0)
    await send(page, 'Independent branch', true)
    await page.waitForFunction(() => (window as any).requests.length === 2)
    await mkdir(artifactRoot + '/composer-footer', { recursive: true })
    await page.screenshot({ path: artifactRoot + '/composer-footer/running.png' })
    const stop = composer.locator('.janus-chat-stop')
    const right = await stop.evaluate(el => el.getBoundingClientRect().right)
    await input.fill('Preserve this unsent instruction')
    expect(await stop.getAttribute('data-secondary')).toBe('true')
    expect(await composer.locator('.janus-chat-send').evaluate(el => el.getBoundingClientRect().right)).toBeCloseTo(right, 0)
    for (const theme of ['dark', 'white', 'planche']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
      await page.setViewportSize({ width: 380, height: 720 })
      await composer.screenshot({ path: `${artifactRoot}/composer-footer/${theme}-draft.png` })
      await expect.poll(() => composer.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      const color = await composer.locator('.janus-chat-status-bar').evaluate(el => getComputedStyle(el).borderTopColor)
      await page.mouse.move(0, 0)
      await stop.focus()
      expect(await composer.locator('.janus-chat-status-bar').evaluate(el => getComputedStyle(el).borderTopColor)).toBe(color)
      await expect.poll(() => stop.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
      await composer.screenshot({ path: `${artifactRoot}/composer-footer/${theme}-draft.png` })
    }
    await stop.press('Enter')
    await expect.poll(() => composer.locator('.janus-chat-stop').count()).toBe(0)
    expect(await input.textContent()).toBe('Preserve this unsent instruction')
    expect(await composer.locator('.janus-chat-send').isEnabled()).toBe(true)
    expect(await page.evaluate(() => (window as any).registry.topicConversations.every((c: any) => !(window as any).registry.getController(c.id).isStreaming))).toBe(true)
    expect(await page.evaluate(() => (window as any).aborted)).toBeTruthy()
    expect(await composer.locator('.janus-chat-input-hint').textContent()).toContain('Enter')
    await page.setViewportSize({ width: 430, height: 850 })
    await expect.poll(() => composer.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.screenshot({ path: artifactRoot + '/composer-footer/narrow.png' })
  } finally { await page.close() }
}, 15000)
it('keeps the shared Worker dock hover and active feedback consistent across themes', async () => {
  const output = `${artifactRoot}/dock-hover`
  await mkdir(output, { recursive: true })
  const source = 'production', page = await open()
    try {
      const toggle = () => page.locator('[data-dock-toggle]:visible').first()
      const edge = page.locator('[data-superagent-workspace] [role=separator][aria-valuemin="280"]')
      const style = (part: string, pseudo?: string) => (part === 'toggle' ? toggle() : edge).evaluate((el, pseudo) => {
        const s = getComputedStyle(el, pseudo)
        return { background: s.backgroundColor, radius: s.borderRadius, border: s.borderTopColor, shadow: s.boxShadow, opacity: s.opacity, transform: s.transform, transition: s.transitionDuration }
      }, pseudo)
      for (const theme of ['dark', 'white', 'planche']) {
        await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
        const expected = await page.evaluate(() => {
          const probe = document.createElement('div'); probe.style.background = 'var(--shell-hover)'; document.body.append(probe)
          const color = getComputedStyle(probe).backgroundColor; probe.remove(); return color
        })
        for (const expanded of [true, false]) {
          await page.mouse.move(0, 0)
          await toggle().evaluate(el => (el as HTMLElement).blur())
          await expect.poll(async () => (await style('toggle')).background).toBe('rgba(0, 0, 0, 0)')
          expect((await style('toggle')).radius).toBe('6px')
          await toggle().hover()
          await expect.poll(async () => (await style('toggle')).background).toBe(expected)
          expect((await style('toggle')).border).toBe('rgba(0, 0, 0, 0)')
          expect((await style('toggle')).shadow).toBe('none')
          expect((await style('toggle')).transition).toContain('0.15s')
          await page.mouse.down()
          expect((await style('toggle')).background).toBe(expected)
          await page.screenshot({ path: `${output}/${source}-${theme}-${expanded ? 'open' : 'closed'}-active.png` })
          await page.mouse.up()
        }
        if (await toggle().getAttribute('aria-expanded') === 'false') await toggle().click()
        await edge.hover()
        await expect.poll(async () => (await style('edge', '::before')).opacity).toBe('1')
        expect((await style('edge', '::before')).background).toBe(expected)
        expect((await style('edge', '::before')).radius).toBe('6px')
        await expect.poll(async () => (await style('edge', '::after')).opacity).toBe('0.85')
        expect((await style('edge', '::after')).transform).toBe('none')
        expect((await style('edge', '::after')).shadow).toBe('none')
        await page.screenshot({ path: `${output}/${source}-${theme}-grip.png` })
        await page.mouse.move(0, 0)
        await expect.poll(async () => (await style('edge', '::before')).opacity).toBe('0')
        await page.keyboard.press('Tab')
        await edge.focus()
        await expect.poll(async () => (await style('edge', '::before')).opacity).toBe('1')
        await edge.evaluate(el => (el as HTMLElement).blur())
      }
      await page.emulateMedia({ reducedMotion: 'reduce' })
      expect((await style('toggle')).transition).toBe('0s')
      expect((await style('edge', '::after')).transition).toBe('0s')
    } finally { await page.close() }
})
