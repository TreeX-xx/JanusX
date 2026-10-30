import { afterAll, beforeAll, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from '@playwright/test'
import { build } from 'esbuild'

let browser: Browser, script: string, css: string
beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client'
    import i18n from 'i18next'; import {initReactI18next} from 'react-i18next'
    import knowledge from './src/renderer/src/i18n/locales/en/knowledge.json'
    import {MemoryReviewTool,MemoryReviewCard} from './src/renderer/src/components/knowledge/MemoryReviewTool'
    import {useExperimentalStore} from './src/renderer/src/stores/experimental'
    import {reviewCandidateInput} from './src/shared/review-candidate-snapshot'
    import './src/renderer/src/styles/globals.css'
    import './src/renderer/src/styles/themes.generated.css'
    const candidate = {id:'candidate',type:'fact',status:'proposed',derivation:'deterministic',evidence:{observationIds:[]},
      fact:{id:'fact',content:'Keep backups for seven days.',scope:'user',kind:'procedure',files:[],concepts:[],tags:[],
        provenance:{workspaceId:'project',workspaceName:'Project',fileRefs:[],sourceObservationIds:[]}},
      decision:{status:'old',reason:'Old advisory reason',scorer:{provider:'legacy-scorer'},answers:[]}}
    window.item = candidate; window.pages=[]; window.reads = 0; window.actions = []
    window.current={reviewStateVersion:1,reviewEnabled:true,enabled:true,running:false,queue:[],tasks:[],total:0,
      stages:{extraction:'rules-only',entryReview:'automatic',wikiGeneration:'automatic',wikiReview:'automatic'},
      counts:{pending:0,running:0,succeeded:0,failed:0,'needs-review':0,cancelled:0}}
    window.refresh = async()=>{}
    window.setTask = async status => {
      window.current.queue=[{id:'current-task',stage:'entryReview',subject:'candidate',workspaceId:'project',
        candidateHash:(await reviewCandidateInput(window.item)).candidateHash,status,canRetry:status==='failed',reason:status==='failed'?'Missing source context':undefined}]
      await window.refresh()
    }
    window.electron={knowledge:{
      listCandidates:async()=>window.item.type==='fact'?[structuredClone(window.item)]:[],
      listWikiPatchCandidates:async()=>window.item.type==='wiki-patch'?[structuredClone(window.item)]:[],
      listGraphCandidates:async()=>window.item.type==='graph-edge'?[structuredClone(window.item)]:[],
      listTruth:async()=>{if(window.failTruth)throw Error('unavailable');return {facts:[],wikiPages:structuredClone(window.pages),graphEdges:[]}},
      listObservations:async()=>[],listAudit:async()=>[],retentionStats:async()=>({}),getSettings:async()=>({mode:'auto'}),listConflicts:async()=>[],processingStats:async()=>null,
      noteWikiStatuses:async()=>{if(window.failNotes)throw Error('Note read failed');return (window.item.sourceNoteRefs??[]).map(ref=>({...ref,status:window.noteState??'fresh'}))},
      observationRevocationContext:async input=>{window.sourceReads=(window.sourceReads??[]).concat([input]);const result={content:window.sourceBody??'Full source text',revoked:!!window.revoked};if(window.delaySource)await new Promise(resolve=>window.releaseSource=resolve);if(window.failSource)throw Error('source failed');return result},
      automationStatus:async()=>{window.reads++;const captured=structuredClone(window.current);if(window.delay)await new Promise(resolve=>window.release=resolve);if(window.fail)throw Error('unavailable');return captured},
      automationRetry:async id=>{window.actions.push(['retry',id]);window.current.queue[0].status='pending';window.current.queue[0].canRetry=false},
      automationRun:async()=>{window.actions.push(['run'])},
      factReviewContext:async()=>structuredClone(window.conflictContext??{targets:[],competing:[]}),
      applyCandidate:async input=>{window.actions.push(['approve',input])},rejectCandidate:async input=>{window.actions.push(['reject',input])}
    }}
    useExperimentalStore.setState({loaded:true,knowledge:true,persona:false})
    const root=createRoot(document.getElementById('root'))
    window.redraw=()=>root.render(<div id='inspector'><MemoryReviewCard key={JSON.stringify(window.item)} candidate={window.item} disabled={Boolean(window.busy)} onReview={()=>{}}/></div>)
    useExperimentalStore.setState({persona:true,loaded:true})
    i18n.use(initReactI18next).init({lng:'en',resources:{en:{knowledge}},initImmediate:false}).then(window.redraw)

  ` }, loader: { '.svg': 'dataurl' }, bundle: true, write: false, outfile: 'review-state-ui.js', jsx: 'automatic', format: 'iife', define: { 'process.env.NODE_ENV': '"test"' },
  plugins: [{ name: 'i18n-fixture', setup(builder) {
    builder.onLoad({ filter: /[/\\]i18n[/\\]index\.ts$/ }, () => ({ contents: "import i18n from 'i18next'; export default i18n; export const changeLanguage=()=>{}", loader: 'ts' }))
  } }] })
  script = result.outputFiles.find(file => file.path.endsWith('.js'))!.text
  css = result.outputFiles.find(file => file.path.endsWith('.css'))!.text
})
afterAll(async () => { await browser?.close() })

async function useLongCandidate(page: Page, kind: 'fact' | 'wiki-patch' = 'fact') {
  await page.evaluate(kind => {
    const w = window as any
    const provenance = { workspaceId: 'project', workspaceName: 'Project', fileRefs: [], sourceObservationIds: ['source-1'] }
    const content = '# Backup policy\n\n' + 'Keep backups for thirty days. '.repeat(120) + '\n\n' + 'long-id-'.repeat(90)
    const evidence = { observationIds: ['source-1'], sources: [{ observationId: 'source-1', workspaceId: 'project', speaker: 'user', authority: 'user', excerpt: '<script>sourceAttack()</script> Source excerpt' }] }
    w.item = kind === 'fact' ? { ...w.item, conflicts: [], evidence, fact: { ...w.item.fact, content, provenance } } : {
      id: 'wiki-candidate', type: kind, status: 'proposed', derivation: 'llm', conflicts: [], evidence, provenance,
      title: 'Backup policy draft', pageSlug: 'backup', confidence: 1, expectedVersion: 3, reviewMode: 'full-page',
      patchMarkdown: content + '\n\n| Field | Value |\n| --- | --- |\n| Retention | Thirty days |\n\n```js\n' + 'longCode'.repeat(100) + '\n```\n\n<script>window.attacked=true</script>\n\n[unsafe](javascript:alert(1))\n\n![remote](https://example.invalid/pixel.png)',
      rationale: 'Review the new retention policy and relationship.', sourceFactIds: ['source-fact'],
      sourceNoteRefs: [{ uri: 'note://repo/source', sourceHash: 'recorded-hash' }],
      relations: [{ type: 'depends_on', target: { workspaceId: 'project', slug: 'policy', title: 'Retention policy', version: 2, contentHash: 'a'.repeat(64) }, sourceFactIds: ['source-fact'], reason: 'Backups follow the retention policy.' }],
    }
    w.pages = [{ workspaceId: 'project', slug: 'backup', title: 'Backup policy', markdown: '# Published baseline\nSeven days.', version: 3, status: 'published', sourceFactIds: ['old-fact'], tags: [], relations: [] }]
    w.sourceBody = 'Full source line\n'.repeat(300) + 'END-OF-SOURCE'
    w.redraw(); window.dispatchEvent(new Event('janusx-memory-changed'))
  }, kind)
  await page.locator(`[data-review-type="${kind}"]`).first().waitFor({ state: 'attached' })
}

it('invalidates replacement confirmation on source failure, candidate change and busy transitions', async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } })
  try {
    await mount(page)
    await page.evaluate(() => { (window as any).conflictContext = { targets: [{ id: 'old', hash: 'target-hash', version: 2, content: 'Old policy' }], competing: [] } })
    await useLongCandidate(page)
    const detail = page.locator('#inspector')
    const confirm = detail.getByRole('checkbox')
    const approve = detail.getByRole('button', { name: /^Approve/ })
    await confirm.check()
    await expect.poll(() => approve.isEnabled()).toBe(true)
    await page.evaluate(() => { (window as any).failSource = true })
    await detail.locator('summary').filter({ hasText: 'Read full source' }).click()
    await detail.getByText('Source unavailable or ambiguous. Refresh to read it again.').waitFor()
    expect(await approve.isDisabled()).toBe(true)
    await expect.poll(() => confirm.isChecked()).toBe(false)
    await page.evaluate(() => { (window as any).failSource = false })
    await detail.getByRole('button', { name: 'Refresh source', exact: true }).click()
    await detail.getByText('END-OF-SOURCE', { exact: false }).waitFor()
    await confirm.check()
    await page.evaluate(() => { const w = window as any; w.busy = true; w.redraw() })
    await expect.poll(() => approve.isDisabled()).toBe(true)
    await page.evaluate(() => { const w = window as any; w.busy = false; w.redraw() })
    await confirm.waitFor()
    await expect.poll(() => confirm.isChecked()).toBe(false)
    await confirm.check()
    await page.evaluate(() => { const w = window as any; w.item.evidence.observationIds = ['new-source']; w.item.evidence.sources = []; w.redraw() })
    await confirm.waitFor()
    await expect.poll(() => confirm.isChecked()).toBe(false)
    await page.evaluate(() => { (window as any).revoked = true })
    await detail.locator('summary').filter({ hasText: 'Read full source' }).click()
    await detail.getByText('This source has been withdrawn.').waitFor()
    expect(await approve.isDisabled()).toBe(true)
  } finally { await page.close() }
})

async function mount(page: Page) {
  page.setDefaultTimeout(4000)
  await page.clock.install()
  await page.route('http://localhost/review-state', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
  await page.goto('http://localhost/review-state')
  await page.addStyleTag({ content: css + '\n#root{display:flex;height:900px;gap:20px}#sidebar,#inspector{width:390px}body{margin:0}' })
  await page.addScriptTag({ content: script })
  await page.locator('#inspector').waitFor()
}
