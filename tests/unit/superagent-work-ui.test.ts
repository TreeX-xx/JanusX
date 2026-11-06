import { afterAll, beforeAll, expect, it } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'

let browser: Browser, script: string, css: string
beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React,{useState} from 'react'; import {createRoot} from 'react-dom/client'
    import i18n from 'i18next'; import {initReactI18next} from 'react-i18next'
    import janus from './src/renderer/src/i18n/locales/en/janus.json'; import terminal from './src/renderer/src/i18n/locales/en/terminal.json'
    import './src/renderer/src/styles/themes.generated.css'
    import {SuperAgentWork,SuperAgentWorkProvider,SuperAgentDecisions} from './src/renderer/src/components/janus/SuperAgentWork'
    window.calls=[];window.listeners={};window.current=undefined;window.saved=[];window.capacity=3
    const works=Array.from({length:5},(_,i)=>({id:'work-'+i,title:'Feature '+i,workspaceId:'workspace',sourceInputId:'input-'+i,createdAt:5-i,revision:1,closedAt:null,latestReportId:i===4?'report':null}));
    const input={id:'input',conversationId:'chat-a',resourceId:'input-body'}
    const phases=['waiting','running','queued','failed','ready'];
    window.residents=works.filter((_,i)=>i!==2).map((work,i)=>({workspaceId:'workspace',workId:work.id,executionId:'execution-'+i,instanceId:'instance-'+i,
      phase:phases[works.indexOf(work)],stopConfirmed:i===3,disabledExtensions:[],conversation:{items:i===1?[
        {type:'agentMessage',text:'Checking greeting behavior'}, {type:'userMessage',text:'HOST_PRIVATE_SUPPLEMENT'}]:[],approvals:[],questions:[]}}));
    window.electron={superAgent:{
      snapshot:async scope=>({inputs:[input],works:scope==='workspace'?works:[]}),
      workDetail:async(_scope,id)=>({work:works.find(row=>row.id===id),inputs:[input],executions:[],reports:[{id:'report',resourceId:'report-body',summary:'Persisted Worker result'}],deliveries:[]}),
      workers:async()=>window.residents,environments:async()=>({operations:[]}),
      schedule:async scope=>({workspaceId:scope,maxConcurrentWorkers:window.capacity,occupied:3,entries:scope==='workspace'?works.map((work,i)=>({...work,workId:work.id,status:phases[i]})):[]}),
      configureCapacity:async value=>{window.calls.push(['capacity',value]);window.capacity=value;phases[2]='starting';window.listeners.schedule?.({workspaceId:'workspace'});return value},
      controlWork:async value=>{window.calls.push(['work-control',value]);if(value.action==='close'){works.find(row=>row.id===value.workId).closedAt=10;window.listeners.record?.({workspaceId:'workspace'})}},
      readResource:async(_scope,id)=>({text:id==='input-body'?'Original user instruction':'Persisted Worker result'}),
      onChanged:fn=>{window.listeners.record=fn;return()=>{delete window.listeners.record}},
      onWorkerChanged:fn=>{window.listeners.worker=fn;return()=>{delete window.listeners.worker}},
      onEnvironmentsChanged:fn=>{window.listeners.environment=fn;return()=>{delete window.listeners.environment}},
      onScheduleChanged:fn=>{window.listeners.schedule=fn;return()=>{delete window.listeners.schedule}},
      controlWorker:async value=>{window.calls.push(['control',value])},
    }}
    window.publish=(phase='waiting')=>{
      window.saved=[{id:'report',resourceId:'report-body'}]
      window.current={workspaceId:'workspace',conversationId:'chat-a',workId:'work-0',executionId:'execution',instanceId:'instance',phase,stopConfirmed:false,disabledExtensions:[],
        conversation:{items:[],approvals:[],questions:[{id:23,version:4,status:'pending',cancelable:true,questions:[
          {id:'choice',text:'Choose result',options:[{id:'yes',label:'Yes'},{id:'no',label:'No'}]},
          {id:'notes',text:'Your note',options:[],allowText:true}]}]}}
      window.residents=[...window.residents.filter(row=>row.workId!=='work-0'),window.current]
      window.listeners.worker?.(window.current);window.listeners.record?.({workspaceId:'workspace'})
    }
    window.retire=()=>{const row=window.residents.find(row=>row.workId==='work-4');window.residents=window.residents.filter(row=>row!==row);window.listeners.worker?.({...row,retiredAt:1800000})}
    window.addOlderQuestion=()=>{
      for(let i=5;i<13;i++){works.push({id:'work-'+i,title:'Feature '+i,workspaceId:'workspace',sourceInputId:'input-'+i,createdAt:5-i,revision:1,closedAt:null});phases.push('queued')}
      const row={...window.residents[0],workId:'work-12',executionId:'old-request',conversation:{items:[],approvals:[],questions:[{id:90,version:1,status:'pending',questions:[{id:'choice',text:'Answer the older work',options:[{id:'yes',label:'Proceed'}]}]}]}}
      window.residents.push(row);window.listeners.worker?.(row)
    }
    function App(){const[draft,setDraft]=useState(''),[visible,setVisible]=useState(true);return <div style={{padding:16,maxWidth:760}}>
      <button onClick={()=>setVisible(value=>!value)}>Toggle panel</button>{visible&&<SuperAgentWorkProvider><SuperAgentWork conversationId="chat-a"/><SuperAgentDecisions conversationId="chat-a"/></SuperAgentWorkProvider>}<textarea aria-label="Draft" value={draft} onChange={e=>setDraft(e.target.value)}/></div>}
    i18n.use(initReactI18next).init({lng:'en',resources:{en:{janus,terminal}},interpolation:{escapeValue:false}}).then(()=>createRoot(document.getElementById('root')).render(<App/>))
  ` }, bundle: true, write: false, outfile: 'superagent-ui.js', jsx: 'automatic', format: 'iife', define: { 'process.env.NODE_ENV': '"test"' }, plugins: [{ name: 'isolated-workspace', setup(builder) {
    builder.onLoad({ filter: /[/\\]stores[/\\]workspace\.ts$/ }, () => ({ contents: "import {useSyncExternalStore} from 'react';let state={activeWorkspaceId:'workspace',workspaces:[{id:'workspace',name:'Fixture project'}]};const listeners=new Set();window.switchWorkspace=id=>{state={...state,activeWorkspaceId:id};listeners.forEach(fn=>fn())};export const useWorkspaceStore=selector=>selector(useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>state))", loader: 'ts' }))
    builder.onLoad({ filter: /[/\\]i18n[/\\]index\.ts$/ }, () => ({ contents: "import i18n from 'i18next';export default i18n;export const changeLanguage=()=>{}", loader: 'ts' }))
  } }] })
  script = result.outputFiles.find(file => file.path.endsWith('.js'))!.text
  css = result.outputFiles.find(file => file.path.endsWith('.css'))!.text
})

it('keeps an older pending decision reachable before expanding a paginated Worker list', async () => {
  const page = await browser.newPage()
  try {
    await page.route('http://127.0.0.1/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script })
    await page.getByRole('article', { name: 'Feature 4', exact: true }).waitFor()
    await page.evaluate(() => (window as any).addOlderQuestion())
    await page.getByRole('article', { name: 'Feature 12', exact: true }).waitFor()
    expect(await page.getByRole('article').count()).toBe(11)
    await page.getByRole('radio', { name: 'Proceed', exact: true }).check()
    await page.getByRole('button', { name: 'Submit answer', exact: true }).click()
    await page.waitForFunction(() => (window as any).calls.some((row: any) => row[0] === 'control' && row[1].workId === 'work-12' && row[1].requestId === 90))
  } finally { await page.close() }
})
afterAll(async () => { await browser?.close() })

it('shows more than two works, configures capacity, scopes native decisions and ignores stale workspace events', async () => {
  const page = await browser.newPage({ viewport: { width: 860, height: 780 } })
  try {
    await page.route('http://127.0.0.1/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script })
    await page.getByRole('textbox', { name: 'Draft' }).fill('Implement the feature')
    await page.getByRole('article', { name: 'Feature 4' }).waitFor()
    expect(await page.getByRole('article').count()).toBe(5)
    expect(await page.getByRole('article', { name: 'Feature 1' }).innerText()).toContain('Checking greeting behavior')
    expect(await page.getByText('HOST_PRIVATE_SUPPLEMENT', { exact: true }).count()).toBe(0)
    expect(await page.getByRole('button', { name: 'Run with Worker', exact: true }).count()).toBe(0)
    await page.getByText('Worker concurrency limit', { exact: true }).click()
    await page.getByRole('spinbutton', { name: 'Worker concurrency limit' }).fill('4')
    await page.getByRole('button', { name: 'Save limit' }).click()
    await page.getByRole('article', { name: 'Feature 2' }).getByText('Starting', { exact: true }).waitFor()
    await page.evaluate(() => (window as any).publish())
    await page.getByText('Persisted Worker result', { exact: true }).waitFor()
    await page.getByRole('radio', { name: 'Yes', exact: true }).check()
    await page.getByRole('textbox', { name: /Your note/ }).fill('custom answer')
    await page.locator('form').getByRole('button', { name: 'Submit answer', exact: true }).click()
    await page.waitForFunction(() => (window as any).calls.some((row: any) => row[0] === 'control' && row[1].type === 'answer'))
    const answer = await page.evaluate(() => (window as any).calls.find((row: any) => row[0] === 'control' && row[1].type === 'answer')[1])
    expect(answer).toMatchObject({ workId: 'work-0', executionId: 'execution', requestId: 23, version: 4,
      answer: { answers: [{ id: 'choice', selected: ['yes'] }, { id: 'notes', selected: [], text: 'custom answer' }] } })
    expect(await page.getByRole('textbox', { name: 'Draft' }).inputValue()).toBe('Implement the feature')
    await mkdir('artifacts/superagent-p7', { recursive: true })
    await page.screenshot({ path: 'artifacts/superagent-p7/worker-chat.png', fullPage: true })
    const beforeUnmount = await page.evaluate(() => (window as any).calls.length)
    await page.getByRole('button', { name: 'Toggle panel' }).click()
    await page.getByRole('article').first().waitFor({ state: 'hidden' })
    expect(await page.evaluate(() => (window as any).calls.length)).toBe(beforeUnmount)
    await page.getByRole('button', { name: 'Toggle panel' }).click()
    await page.getByRole('article', { name: 'Feature 4' }).waitFor()
    await page.evaluate(() => (window as any).retire())
    await page.getByRole('article', { name: 'Feature 4' }).waitFor({ state: 'hidden' })
    expect(await page.evaluate(async () => (await (window as any).electron.superAgent.workDetail('workspace', 'work-4')).reports)).toHaveLength(1)
    await page.evaluate(() => (window as any).publish('failed'))
    await page.getByRole('article', { name: 'Feature 0' }).getByRole('button', { name: 'Stop Worker', exact: true }).click()
    await page.waitForFunction(() => (window as any).calls.some((row: any) => row[0] === 'work-control' && row[1].action === 'stop' && row[1].workId==='work-0'))
    await page.getByRole('article', { name: 'Feature 2' }).getByRole('button', { name: 'Close work' }).click()
    await page.getByRole('article', { name: 'Feature 2' }).waitFor({ state: 'hidden' })
    await page.getByRole('article', { name: 'Feature 0' }).getByRole('button', { name: 'Close work' }).click()
    await page.getByRole('article', { name: 'Feature 0' }).getByRole('button', { name: 'Stop Worker', exact: true }).waitFor()
    await page.evaluate(() => {
      const w = window as any; w.current.stopConfirmed = true; w.listeners.record({ workspaceId: 'workspace' })
    })
    await page.getByRole('article', { name: 'Feature 0' }).waitFor({ state: 'hidden' })
    await page.evaluate(() => (window as any).switchWorkspace('another-workspace'))
    await page.getByText('Persisted Worker result', { exact: true }).waitFor({ state: 'hidden' })
    await page.evaluate(() => (window as any).publish())
    expect(await page.getByRole('button', { name: 'Stop Worker', exact: true }).count()).toBe(0)
  } finally { await page.close() }
})
