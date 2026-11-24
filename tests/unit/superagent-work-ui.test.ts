import { afterAll, beforeAll, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { CodexConversation } from '../../src/main/terminal/codex-conversation'
import type { ConversationSnapshot } from '../../src/shared/conversation-display'

const settingsArtifacts = process.env.JANUS_WORKER_TEST_ARTIFACTS ? `${process.env.JANUS_WORKER_TEST_ARTIFACTS}/settings` : 'artifacts/superagent-worker-settings'
const compactArtifacts = process.env.JANUS_WORKER_TEST_ARTIFACTS ? `${process.env.JANUS_WORKER_TEST_ARTIFACTS}/compact` : 'artifacts/superagent-compact'
const reportArtifacts = process.env.JANUS_WORKER_TEST_ARTIFACTS ? `${process.env.JANUS_WORKER_TEST_ARTIFACTS}/reports` : 'artifacts/superagent-hifi'
const queueArtifacts = process.env.JANUS_WORKER_TEST_ARTIFACTS ? `${process.env.JANUS_WORKER_TEST_ARTIFACTS}/queue` : 'artifacts/superagent-priority-queue'
let browser: Browser, script: string, css: string
it('shows persisted evidence review separately from worker delivery and updates gaps without implying acceptance', async () => {
  const page = await browser.newPage({ viewport: { width: 420, height: 1000 } })
  try {
    await page.route('http://127.0.0.1/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script })
    await expandWorkerDetails(page)
    await page.evaluate(() => {
      const w = window as any, original = w.electron.superAgent.workDetail
      w.reviewValue = { reportId: 'report-1', assignmentRevision: 1, state: 'reviewing', summary: 'Inspecting the whole sidebar', findings: [], updatedAt: Date.now() }
      w.electron.superAgent.workDetail = async (...args: any[]) => {
        const detail = await original(...args)
        return detail.work.id === 'work-1' ? { ...detail, work: { ...detail.work, review: w.reviewValue } } : detail
      }
      w.listeners.record({ workspaceId: 'workspace', kind: 'review' })
    })
    const review = page.locator('[data-work-id="work-1"] [data-worker-review]')
    await expect.poll(() => review.getAttribute('data-worker-review')).toBe('reviewing')
    expect(await review.innerText()).toContain('Reviewing requirements and artifacts')
    await page.evaluate(() => {
      const w = window as any
      w.reviewValue = { ...w.reviewValue, state: 'unverified', summary: 'Source changed; running application not verified',
        criteria: [{ criterion: 'The entire sidebar collapses', status: 'unverified', evidence: [] }] }
      w.listeners.record({ workspaceId: 'workspace', kind: 'review' })
    })
    await expect.poll(() => review.getAttribute('data-worker-review')).toBe('unverified')
    await review.locator('summary').click()
    expect(await review.innerText()).toContain('Completion remains unverified')
    expect(await review.innerText()).toContain('running application not verified')
    expect(await review.innerText()).toContain('The entire sidebar collapses')
    expect(await review.innerText()).not.toContain('Evidence review passed')
    await mkdir('artifacts/superagent-quality/ui', { recursive: true })
    await page.locator('[data-work-id="work-1"]').screenshot({ path: 'artifacts/superagent-quality/ui/unverified.png' })
  } finally { await page.close() }
})
async function expandWorkerDetails(page: Page) {
  await page.locator('[data-presentation="status"]').first().waitFor()
  for (const card of await page.locator('[data-presentation="status"]').all()) {
    const toggle = card.locator('button[aria-expanded]').first()
    if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click()
  }
}
it('opens the Worker monitor with reversible motion, retained disclosures and an inert closed viewport', async () => {
  const page = await browser.newPage({ viewport: { width: 420, height: 1000 } }), errors: string[] = []
  const output = `${compactArtifacts}/monitor`
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.route('http://127.0.0.1/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script })
    const card = page.locator('[data-presentation="status"][data-work-id="work-1"]')
    const trigger = card.locator('[data-worker-header] button').first(), body = card.locator('[data-worker-monitor]')
    await trigger.waitFor()
    expect(await trigger.getAttribute('aria-controls')).toBe(await body.getAttribute('id'))
    expect(await body.evaluate(el => ({ inert: (el as HTMLElement).inert, height: el.getBoundingClientRect().height }))).toEqual({ inert: true, height: 0 })
    // Sample actual layout over animation frames, rather than merely checking CSS declarations.
    const sample = () => trigger.evaluate(async button => {
      const panel = document.getElementById(button.getAttribute('aria-controls')!)!
      const header = button.closest('[data-worker-header]')!, start = performance.now()
      const frames: { time: number; height: number; headerHeight: number }[] = []
      ;(button as HTMLButtonElement).click()
      while (performance.now() - start < 440) {
        await new Promise(requestAnimationFrame)
        frames.push({ time: performance.now() - start, height: panel.getBoundingClientRect().height, headerHeight: header.getBoundingClientRect().height })
      }
      return frames
    })
    const opening = await sample(), height = opening.at(-1)!.height
    expect(height).toBeGreaterThan(80)
    expect(opening.some(frame => frame.height > 1 && frame.height < height - 1)).toBe(true)
    expect(new Set(opening.map(frame => frame.headerHeight)).size).toBe(1)
    await card.getByRole('button', { name: 'Latest output', exact: true }).click()
    const closing = await sample()
    expect(closing.some(frame => frame.height > 1 && frame.height < closing[0].height - 1)).toBe(true)
    expect(closing.at(-1)!.height).toBe(0)
    expect(await body.evaluate(el => (el as HTMLElement).inert)).toBe(true)
    expect(await card.getByRole('button', { name: 'Latest output', exact: true }).count()).toBe(0)
    await trigger.focus(); await page.keyboard.press('Enter')
    await expect.poll(() => body.getAttribute('aria-hidden')).toBe('false')
    expect(await card.getByRole('button', { name: 'Latest output', exact: true }).getAttribute('aria-expanded')).toBe('true')
    // A worker snapshot refresh must keep both the monitor and its inner fold open.
    await page.evaluate(() => (window as any).listeners.record({ workspaceId: 'workspace' }))
    expect(await trigger.getAttribute('aria-expanded')).toBe('true')
    await page.keyboard.press('Space')
    await expect.poll(() => body.evaluate(el => el.getBoundingClientRect().height)).toBe(0)
    await trigger.evaluate(async button => {
      ;(button as HTMLButtonElement).click()
      await new Promise(resolve => setTimeout(resolve, 55))
      ;(button as HTMLButtonElement).click()
    })
    await expect.poll(() => body.evaluate(el => el.getBoundingClientRect().height)).toBe(0)
    expect(await trigger.getAttribute('aria-expanded')).toBe('false')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await trigger.click()
    expect(await body.evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s')
    // Closing from an external event must return focus instead of stranding it in inert content.
    await card.getByRole('button', { name: 'Latest output', exact: true }).focus()
    await trigger.evaluate(el => (el as HTMLButtonElement).click())
    expect(await trigger.evaluate(el => el === document.activeElement)).toBe(true)
    await mkdir(output, { recursive: true })
    for (const theme of ['dark', 'white', 'planche']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
      await page.evaluate(() => (document.activeElement as HTMLElement)?.blur()); await page.mouse.move(0, 0)
      await card.screenshot({ path: `${output}/closed-${theme}.png` })
      await trigger.click()
      expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      await page.evaluate(() => (document.activeElement as HTMLElement)?.blur()); await page.mouse.move(0, 0)
      await card.screenshot({ path: `${output}/open-${theme}.png` })
      await trigger.click()
    }
    expect(errors).toEqual([])
    await writeFile(`${output}/motion.json`, JSON.stringify({ opening, closing, errors }, null, 2))
  } finally { await page.close() }
})
it('renders global queue positions and priority controls with durable pause, resume and cancellation receipts', async () => {
  const page = await browser.newPage({ viewport: { width: 380, height: 950 } })
  try {
    await page.route('http://127.0.0.1/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script }); await expandWorkerDetails(page)
    await page.locator('[data-worker-queue]').waitFor()
    await page.evaluate(() => {
      const w = window as any, api = w.electron.superAgent
      const row = { workspaceId: 'workspace', workId: 'work-2', status: 'queued', queuePosition: 3, priority: 'normal', effectivePriority: 'normal', queueVersion: 7, order: 8, queuedAt: Date.now() - 120_000, waitReason: 'capacity', occupiesSlot: false }
      w.queueRow = row
      api.schedule = async () => ({ workspaceId: 'workspace', maxConcurrentWorkers: 2, occupied: 2, queued: row.status === 'queued' ? 3 : 2, paused: row.status === 'paused' ? 1 : 0, blocked: 1, entries: [row] })
      api.controlQueue = async (control: any) => {
        w.calls.push(['queue', control])
        if (w.queueError) throw new Error(w.queueError)
        row.queueVersion++
        if (control.action === 'priority') { row.priority = control.priority; row.effectivePriority = control.priority; row.queuePosition = 1 }
        if (control.action === 'pause') { row.status = 'paused'; row.waitReason = 'paused'; row.queuePosition = undefined }
        if (control.action === 'resume') { row.status = 'queued'; row.waitReason = 'capacity'; row.queuePosition = 1 }
        if (control.action === 'cancel') { row.status = 'cancelled'; row.queuePosition = undefined }
        w.listeners.schedule({ workspaceId: 'workspace' })
        return api.schedule()
      }
      w.listeners.schedule({ workspaceId: 'workspace' })
    })
    const card = page.locator('[data-presentation="status"][data-work-id="work-2"]')
    await card.getByText('Global queue #3', { exact: true }).waitFor()
    expect(await page.getByText('2 / 2 active', { exact: true }).count()).toBe(1)
    expect(await page.getByTitle('2 / 2 active across workspaces').count()).toBe(1)
    expect(await page.getByRole('button', { name: 'Configure concurrency in Settings → Agent' }).count()).toBe(0)
    expect(await page.getByRole('spinbutton').count()).toBe(0)
    expect(await page.locator('article[data-work-group="queued"]').count()).toBe(1) // The other two are in different workspaces.
    expect(await card.getByText('Waiting 2 min', { exact: true }).count()).toBe(1)
    await card.getByRole('combobox', { name: 'Queue priority' }).selectOption('high')
    await card.getByText('Global queue #1', { exact: true }).waitFor()
    expect(await page.evaluate(() => (window as any).calls.find((row: any) => row[0] === 'queue')[1])).toEqual({ workspaceId: 'workspace', workId: 'work-2', expectedVersion: 7, action: 'priority', priority: 'high' })
    await card.getByRole('button', { name: 'Pause queue', exact: true }).click()
    await card.getByRole('button', { name: 'Resume queue', exact: true }).waitFor()
    expect(await card.getByText(/Global queue #/).count()).toBe(0)
    await page.evaluate(() => { (window as any).queueError = 'Queue entry changed; refresh its state' })
    await card.getByRole('button', { name: 'Resume queue', exact: true }).click()
    await card.getByRole('alert').getByText('Queue entry changed; refresh its state', { exact: false }).waitFor()
    expect(await card.getByRole('button', { name: 'Resume queue', exact: true }).isEnabled()).toBe(true)
    await page.evaluate(() => { (window as any).queueError = ''; (window as any).changeLanguage('zh-CN') })
    await card.getByRole('button', { name: '恢复排队', exact: true }).click()
    await card.getByText('全局排队第 1 位', { exact: true }).waitFor()
    await mkdir(queueArtifacts, { recursive: true })
    expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.screenshot({ path: `${queueArtifacts}/narrow-zh.png`, fullPage: true })
    await card.getByRole('button', { name: '取消排队', exact: true }).click()
    await page.locator('[data-work-group="completed"][data-work-id="work-2"]').waitFor()
    expect(await card.getByText('已取消排队', { exact: true }).count()).toBe(1)
    expect(await card.locator('[data-worker-queue]').count()).toBe(0)
  } finally { await page.close() }
})
it('shows real branch metadata, current task summaries and native duration without growing the card', async () => {
  const page = await browser.newPage({ viewport: { width: 800, height: 800 } })
  try {
    await page.route('http://127.0.0.1/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script }); await expandWorkerDetails(page)
    const card = page.locator('[data-presentation="status"][data-work-id="work-1"]')
    await card.waitFor()
    const status = card.locator('[data-worker-status]')
    await expect.poll(() => status.getAttribute('data-running')).toBe('true')
    const transform = await status.evaluate(el => getComputedStyle(el, '::before').transform)
    await expect.poll(() => status.evaluate(el => getComputedStyle(el, '::before').transform)).not.toBe(transform)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect(await status.evaluate(el => getComputedStyle(el, '::before').animationName)).toBe('none')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.evaluate(() => { const w = window as any, row = w.residents.find((r: any) => r.workId === 'work-1'); row.phase = 'waiting'; w.listeners.worker(row) })
    await expect.poll(() => status.getAttribute('data-running')).toBe('false')
    expect(await status.evaluate(el => getComputedStyle(el, '::before').animationName)).toBe('none')
    await page.evaluate(() => { const w = window as any, row = w.residents.find((r: any) => r.workId === 'work-1'); row.phase = 'running'; w.listeners.worker(row) })
    await card.evaluate(el => { (el as HTMLElement).style.width = '280px' })
    await card.locator('button[aria-expanded]').first().click()
    await expect.poll(() => card.locator('[data-worker-monitor]').evaluate(el => el.getBoundingClientRect().height)).toBe(0)
    const height = (await card.boundingBox())!.height
    await page.evaluate(() => {
      const w = window as any, row = w.residents.find((r: any) => r.workId === 'work-1')
      Object.assign(row.conversation, { turnId: 'current', turnStartedAt: Date.now() - 42000,
        plans: [{ turnId: 'current', version: 1, outcome: 'running', steps: [{ step: 'Verify conversation layout and keyboard interactions', status: 'inProgress' }] }] })
      w.electron.superAgent.environments = async () => ({ operations: [], environments: [{ workId: 'work-1', removedAt: null, checkout: { branch: 'feat/superagent-automation-exploration', path: 'C:/workspace/superagent-preview' } }] })
      w.listeners.worker(row); w.listeners.environment({ workspaceId: 'workspace' })
    })
    const branch = card.getByLabel('Work branch: feat/superagent-automation-exploration')
    await expect.poll(() => branch.count()).toBe(1)
    expect((await card.boundingBox())!.height).toBeLessThanOrEqual(height + 1)
    await card.locator('button[aria-expanded]').first().click()
    await branch.waitFor()
    const title = card.locator('strong[title]')
    expect(await title.innerText()).toBe('Verify conversation layout and keyboard interactions')
    expect(await title.evaluate(el => el.scrollWidth > el.clientWidth && getComputedStyle(el).textOverflow === 'ellipsis')).toBe(true)
    await branch.hover(); await page.getByRole('tooltip').waitFor()
    expect(await page.getByRole('tooltip').innerText()).toContain('C:/workspace/superagent-preview')
    await page.keyboard.press('Escape')
    await page.mouse.move(0, 0); await branch.focus()
    const clock = card.locator('[data-worker-elapsed]'), first = await clock.textContent()
    await expect.poll(() => clock.textContent()).not.toBe(first)
    expect(await branch.evaluate(el => el === document.activeElement)).toBe(true)
    await page.keyboard.press('Escape')
    await mkdir(compactArtifacts, { recursive: true })
    for (const theme of ['dark', 'white', 'planche']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
      expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      await card.screenshot({ path: `${compactArtifacts}/metadata-${theme}.png` })
    }
    await page.evaluate(() => {
      const w = window as any, row = w.residents.find((r: any) => r.workId === 'work-1')
      row.phase = 'idle'; Object.assign(row.conversation, { turnId: null, turnStartedAt: undefined, plans: [], items: [{ turnId: 'current', type: 'agentMessage', text: 'Keyboard and layout checks passed', durationMs: 42000, status: 'completed' }] }); w.listeners.worker(row)
    })
    await expect.poll(() => clock.textContent()).toBe('00:42')
    await page.waitForTimeout(1100); expect(await clock.textContent()).toBe('00:42')
    expect(await card.getAttribute('data-settled')).toBe('true')
    expect(await status.getAttribute('data-running')).toBe('false')
    await card.locator('button[aria-expanded]').first().click()
    expect(await card.getByRole('button', {name:'Latest output',exact:true}).count()).toBe(0)
    // An idle turn still occupies its native slot until ready/exit, even with a compact summary.
    expect(await card.evaluate(el => el.closest('[data-work-group]')?.getAttribute('data-work-group'))).toBe('running')
    await card.screenshot({path:`${compactArtifacts}/settled-summary.png`})
    await card.locator('button[aria-expanded]').first().click()
    expect(await card.getByRole('button', {name:'Latest output',exact:true}).getAttribute('aria-expanded')).toBe('false')
    await card.screenshot({path:`${compactArtifacts}/settled-records.png`})
    expect(await title.innerText()).toBe('Feature 1') // A raw recent output is not a task summary.
    await page.evaluate(() => (window as any).changeLanguage('zh-CN'))
    await expect.poll(() => clock.getAttribute('aria-label')).toBe('本轮总耗时：00:42')
    await page.evaluate(() => { const w = window as any, row = w.residents.find((r: any) => r.workId === 'work-1'); row.phase = 'starting'; row.conversation.items = []; w.listeners.worker(row) })
    await expect.poll(() => clock.count()).toBe(0)
    await page.evaluate(() => (window as any).switchWorkspace('empty'))
    await page.locator('[data-worker-empty]').waitFor()
    expect(await page.locator('[data-presentation=status]').count()).toBe(0)
    expect(/\p{Extended_Pictographic}/u.test(await page.locator('[data-worker-empty]').innerText())).toBe(false)
    await page.screenshot({path:`${compactArtifacts}/idle.png`})
  } finally { await page.close() }
})
it('prioritizes structured questions and keeps delivery evidence collapsed', async () => {
  const page = await browser.newPage({ viewport: { width: 420, height: 750 } })
  try {
    await page.route('http://127.0.0.1/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script }); await expandWorkerDetails(page)
    await page.locator('[data-work-id="work-1"]').waitFor()
    await page.evaluate(() => {
      document.getElementById('root')!.style.display = 'none'
      ;(window as any).mountStructuredReport({ schema: 'janus-worker-report/1', kind: 'question', summary: 'A target is still needed.', report: {
        completed: [], artifacts: [], checks: [{ method: 'Tests', status: 'not_run', result: 'Waiting for target', evidence: [] }],
        limitations: ['No files changed'], questions: ['Which navigation should be changed?'], details: '',
      } })
    })
    await page.locator('[data-worker-report]').getByRole('button', { name: 'View report' }).click()
    await page.locator('[data-worker-report-drawer]').waitFor({ state: 'visible' })
    await page.getByRole('button', { name: 'Enlarge report' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByText('Which navigation should be changed?', { exact: true }).first().waitFor()
    expect(await dialog.getByRole('heading', { name: 'Verification', exact: true }).isVisible()).toBe(false)
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await mkdir(reportArtifacts, { recursive: true })
    await dialog.screenshot({ path: `${reportArtifacts}/question-report-mobile.png` })
  } finally { await page.close() }
})
it('surfaces a saved question in conversation decisions and removes it after a durable answer', async () => {
  const page = await browser.newPage({ viewport: { width: 800, height: 700 } })
  try {
    await page.route('http://127.0.0.1/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script }); await expandWorkerDetails(page)
    await page.locator('[data-work-id="work-1"]').waitFor()
    await page.evaluate(async () => {
      const w = window as any, api = w.electron.superAgent
      const snapshot = await api.snapshot('workspace'), work = snapshot.works.find((row: any) => row.id === 'work-1')
      Object.assign(work, { latestReportId: 'question-report', latestExecutionId: 'execution-1' })
      const report = { id: 'question-report', workId: work.id, executionId: 'execution-1', workspaceId: 'workspace', resourceId: 'report-body', kind: 'question', summary: 'Which navigation markers?' }
      const previousDetail = api.workDetail
      api.snapshot = async () => ({ ...snapshot, reports: [report] })
      api.workDetail = async (scope: string, id: string) => ({ ...await previousDetail(scope, id), reports: id === work.id ? [report] : [] })
      api.continueWorker = async (value: any) => { w.calls.push(['continue', value]); work.questionResponses = [{ reportId: report.id, inputId: 'answer' }]; w.listeners.record({ workspaceId: 'workspace' }) }
      w.residents.find((row: any) => row.workId === work.id).phase = 'idle'
      w.listeners.record({ workspaceId: 'workspace' })
    })
    const question = page.locator('[data-worker-question]')
    await question.waitFor()
    expect(await page.getByText('Question reported; awaiting information', { exact: true }).count()).toBeGreaterThan(0)
    await mkdir(reportArtifacts, { recursive: true })
    await question.screenshot({ path: `${reportArtifacts}/question-in-conversation.png` })
    await question.getByRole('button', { name: 'Read earlier context and continue' }).click()
    await question.waitFor({ state: 'detached' })
    const calls = await page.evaluate(() => (window as any).calls.filter((row: any) => row[0] === 'continue'))
    expect(calls[0][1]).toMatchObject({ workId: 'work-1', replyToReportId: 'question-report' })
  } finally { await page.close() }
})
it('answers a legacy question with a stable retry identity and bilingual recovery controls', async () => {
  const page = await browser.newPage({ viewport: { width: 720, height: 600 } })
  try {
    await page.route('http://127.0.0.1/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script }); await expandWorkerDetails(page)
    await page.locator('[data-work-id="work-1"]').waitFor()
    await page.evaluate(() => { (window as any).continueError = 'Temporary disconnect'; (window as any).mountQuestion() })
    const card = page.locator('[data-worker-question]')
    await card.getByRole('textbox').fill('The left input navigation markers')
    await card.getByRole('button', { name: 'Answer and continue' }).click()
    await card.getByRole('alert').waitFor()
    await page.evaluate(() => { (window as any).continueError = '' })
    await card.getByRole('button', { name: 'Retry answer', exact: true }).click()
    const calls = await page.evaluate(() => (window as any).calls.filter((row: any) => row[0] === 'continue'))
    expect(calls).toHaveLength(2)
    expect(calls[0][1]).toEqual(calls[1][1])
    expect(calls[0][1]).toMatchObject({ replyToReportId: 'question-report', workId: 'work-1', text: 'The left input navigation markers' })
    await page.evaluate(() => (window as any).changeLanguage('zh-CN'))
    await card.getByText('等待补充信息', { exact: true }).waitFor()
    await mkdir(reportArtifacts, { recursive: true })
    await card.screenshot({ path: `${reportArtifacts}/question-answer-zh.png` })
    expect(await card.getByRole('textbox').isDisabled()).toBe(true)
  } finally { await page.close() }
})
it('shows concise conversation results and separates evidence from original source on wide and narrow screens', async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 950 } })
  try {
    await page.route('http://127.0.0.1/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script }); await expandWorkerDetails(page)
    await page.locator('[data-work-id="work-1"]').waitFor()
    await page.evaluate(() => {
      document.getElementById('root')!.style.display = 'none'
      ;(window as any).mountStructuredReport({ schema: 'janus-worker-report/1', kind: 'ready', summary: 'Reports now distinguish results from verification.', report: {
        completed: ['Added **structured reports**', 'Preserved historical reports'],
        artifacts: [{ label: 'Report reader', reference: 'src/WorkerReportCard.tsx' }],
        checks: [
          { method: 'npm test', status: 'passed', result: '3 checks passed', evidence: ['artifacts/checks.log'] },
          { method: 'Live provider', status: 'not_run', result: 'No live provider used', evidence: [] },
          { method: 'Integration probe', status: 'failed', result: 'Fixture service unavailable', evidence: [] },
        ], limitations: ['Live integration remains unverified'], questions: ['Which environment should be used?'],
        details: '## Technical evidence\n\nOriginal input f676a3ac-f396-4790-8f11-a2a37874feca\n\n| Check | Result |\n| --- | --- |\n| Schema | Passed |',
      } })
    })
    const card = page.locator('[data-worker-report]'); await card.waitFor()
    expect(await card.innerText()).toContain('Reports now distinguish results')
    expect(await card.innerText()).toContain('Failed: 1')
    expect(await card.innerText()).not.toContain('f676a3ac')
    expect(await card.innerText()).not.toContain('npm test')
    await mkdir(reportArtifacts, { recursive: true })
    await card.screenshot({ path: `${reportArtifacts}/structured-card.png` })
    await card.getByRole('button', { name: 'View report' }).click()
    await page.getByRole('button', { name: 'Enlarge report' }).click()
    const dialog = page.getByRole('dialog'); await dialog.waitFor()
    expect(await dialog.getByRole('heading', { name: 'Verification', exact: true }).count()).toBe(1)
    const hierarchy = await dialog.getByRole('heading', { name: 'Verification', exact: true }).evaluate(el => {
      const style = getComputedStyle(el)
      return { size: style.fontSize, weight: style.fontWeight, border: style.borderTopWidth, background: style.backgroundColor }
    })
    expect(hierarchy.size).toBe('12px'); expect(hierarchy.weight).toBe('700'); expect(hierarchy.border).toBe('1px')
    expect(hierarchy.background).not.toBe('rgba(0, 0, 0, 0)')
    expect(await card.locator('h2').evaluate(el => getComputedStyle(el).fontSize)).toBe('13px')
    expect(await dialog.getByText('Not run', { exact: true }).count()).toBe(1)
    expect(await dialog.getByText('Failed', { exact: true }).count()).toBe(1)
    expect(await dialog.locator('strong').innerText()).toBe('structured reports')
    await dialog.screenshot({ path: `${reportArtifacts}/structured-report.png` })
    await dialog.getByText('Detailed explanation', { exact: true }).click()
    expect(await dialog.locator('table').count()).toBe(1)
    await dialog.getByRole('button', { name: 'View original report' }).click()
    expect(await dialog.locator('pre').innerText()).toContain('"schema": "janus-worker-report/1"'.replaceAll(' ', ''))
    await dialog.getByRole('button', { name: 'Back to work result' }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => (window as any).changeLanguage('zh-CN'))
    await dialog.getByRole('heading', { name: '验证情况', exact: true }).waitFor()
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await dialog.screenshot({ path: `${reportArtifacts}/structured-report-mobile.png` })
    await page.keyboard.press('Escape')
    expect(await card.getByRole('button', { name: '查看汇报' }).count()).toBeGreaterThanOrEqual(0)
  } finally { await page.close() }
})
it('uses common compact cards for workflow children and standalone Workers, with scoped parent controls', async () => {
  const page = await browser.newPage({ viewport: { width: 420, height: 1000 } }), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.route('http://127.0.0.1/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script })
    await page.locator('[data-presentation="status"]').first().waitFor()
    await page.evaluate(() => {
      const w = window as any
      const flow = { id: 'workflow', workspaceId: 'workspace', conversationId: 'chat-a', revision: 4, title: 'Develop and verify navigation', goal: 'Implement navigation and verify keyboard behavior', state: 'running', repairRound: 0, maxRepairRounds: 1, history: [],
        nodes: [{ key: 'dev', role: 'develop', label: 'Development', workId: 'work-1', dependencies: [], state: 'running' }, { key: 'test', role: 'test', label: 'Testing', workId: 'work-2', dependencies: ['dev'], state: 'waiting' }] }
      w.electron.superAgent.workflows = async () => ({ workspaceId: 'workspace', revision: flow.revision, workflows: [flow] })
      w.electron.superAgent.controlWorkflow = async (input: any) => { w.calls.push(['workflow', input]); flow.revision++; flow.state = input.action === 'pause' ? 'paused' : input.action === 'resume' ? 'running' : 'stopped'; w.listeners.record({ workspaceId: 'workspace' }); return flow }
      w.listeners.record({ workspaceId: 'workspace' })
    })
    const flow = page.locator('[data-workflow-id="workflow"]'), child = flow.locator('[data-work-id="work-1"]'), single = page.locator('article[data-work-id="work-0"][data-presentation="status"]')
    await flow.waitFor()
    expect(await flow.getByText('Waiting for dependencies', { exact: true }).count()).toBe(1)
    expect(await child.getByRole('button', { name: 'Latest output', exact: true }).count()).toBe(0)
    expect(await single.getByRole('button', { name: 'Latest output', exact: true }).count()).toBe(0)
    for (const card of [child, single]) {
      expect(await card.locator('strong[title]').evaluate(el => getComputedStyle(el).fontSize)).toBe('14px')
      expect((await card.boundingBox())!.height).toBeLessThan(110)
    }
    await page.getByRole('region', { name: 'Workflow plans' }).getByRole('button', { name: /Testing/ }).click()
    const tester = flow.locator('[data-work-id="work-2"]')
    await expect.poll(() => tester.getAttribute('data-summary-expanded')).toBe('true')
    await tester.locator('button[aria-expanded]').first().click()
    await flow.getByRole('button', { name: 'Pause future steps', exact: true }).click()
    await flow.getByRole('button', { name: 'Resume workflow', exact: true }).waitFor()
    expect(await page.evaluate(() => (window as any).calls.filter((row: any) => row[0] === 'workflow')[0][1])).toEqual({ workspaceId: 'workspace', workflowId: 'workflow', expectedRevision: 4, action: 'pause' })
    await flow.getByRole('button', { name: 'Resume workflow', exact: true }).click()
    await flow.getByRole('button', { name: 'Flow details', exact: true }).click()
    await flow.getByText('After Development', { exact: true }).waitFor()
    await child.locator('button[aria-expanded]').first().click()
    await child.getByRole('button', { name: 'Latest output', exact: true }).waitFor()
    await child.locator('button[aria-expanded]').first().click()
    await flow.getByRole('button', { name: 'Flow details', exact: true }).click()
    await mkdir('artifacts/workflow-implementation/ui', { recursive: true })
    for (const theme of ['dark', 'white', 'planche']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
      await flow.screenshot({ path: `artifacts/workflow-implementation/ui/workflow-${theme}.png` })
    }
    await page.setViewportSize({ width: 320, height: 950 })
    expect(await flow.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await flow.screenshot({ path: 'artifacts/workflow-implementation/ui/workflow-narrow.png' })
    await flow.getByRole('button', { name: 'Stop workflow', exact: true }).click()
    expect(await page.evaluate(() => (window as any).calls.filter((row: any) => row[1]?.action === 'stop'))).toEqual([])
    await flow.getByRole('group', { name: 'Stop workflow' }).getByRole('button', { name: 'Stop workflow' }).click()
    await page.waitForFunction(() => document.querySelector('[data-workflow-id="workflow"]')?.getAttribute('data-state') === 'stopped')
    expect(errors).toEqual([])
  } finally { await page.close() }
})

beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React,{useState} from 'react'; import {createRoot} from 'react-dom/client'
    import i18n from 'i18next'; import {initReactI18next} from 'react-i18next'
    import janus from './src/renderer/src/i18n/locales/en/janus.json'; import terminal from './src/renderer/src/i18n/locales/en/terminal.json'
    import zhJanus from './src/renderer/src/i18n/locales/zh-CN/janus.json'; import zhTerminal from './src/renderer/src/i18n/locales/zh-CN/terminal.json'
    import settings from './src/renderer/src/i18n/locales/en/settings.json'; import zhSettings from './src/renderer/src/i18n/locales/zh-CN/settings.json'
    import './src/renderer/src/styles/themes.generated.css'
    import {SuperAgentWork,SuperAgentWorkHeader,SuperAgentWorkProvider,SuperAgentDecisions,SuperAgentWorkflowPlans} from './src/renderer/src/components/janus/SuperAgentWork'
    import {WorkerReportMessage,SuperAgentReportFallback} from './src/renderer/src/components/janus/WorkerReportCard'
    import {WorkerQuestionCard} from './src/renderer/src/components/janus/WorkerQuestionCard'
    window.mountQuestion=()=>{document.getElementById('root').style.display='none';const target=document.createElement('div');target.id='question-fixture';target.style.cssText='max-width:600px;padding:20px;margin:auto';document.body.append(target);createRoot(target).render(<WorkerQuestionCard title='Input navigation' report={{id:'question-report',workId:'work-1',workspaceId:'workspace',resourceId:'report-body',summary:'Which input markers should be centered?',kind:'question'}} conversationId='chat' refresh={async()=>{window.calls.push(['refresh'])}}/>)}
    import {WorkerDefaultsSettings} from './src/renderer/src/components/WorkerDefaultsSettings'
    import {useSuperAgentUIStore} from './src/renderer/src/stores/superagent-ui'
    window.setSuperAgentStarted=started=>useSuperAgentUIStore.setState({started})
    window.setSuperAgentStarted(true)
    import {AgentSettingsPanel} from './src/renderer/src/components/AgentSettingsPanel'
    import {SettingsSurface} from '@janusx/ui'
    import settingsModalStyles from './src/renderer/src/components/AppSettingsModal.module.css'
    window.mountWorkerDefaults=()=>{const target=document.createElement('div');target.id='worker-defaults';target.style.cssText='padding:24px;max-width:800px';document.body.append(target);createRoot(target).render(<WorkerDefaultsSettings/>)}
    window.mountAgentSettings=()=>{document.getElementById('root').style.display='none';const target=document.createElement('div');target.id='agent-settings';target.style.cssText='width:min(800px,100vw);height:600px;--so-body-pad-x:28px;--so-body-pad-y:24px;background:var(--shell-canvas);font-family:Inter,ui-sans-serif,system-ui,sans-serif';document.body.append(target);const root=createRoot(target);root.render(<SettingsSurface className={settingsModalStyles.body} style={{height:'100%',boxSizing:'border-box'}}><AgentSettingsPanel/></SettingsSurface>);window.closeAgentSettings=()=>{root.unmount();target.remove();document.getElementById('root').style.display=''}}
    window.addEventListener('janusx:open-worker-settings',()=>window.mountAgentSettings())
    window.mountReport=()=>{const target=document.createElement('div');document.body.append(target);createRoot(target).render(<WorkerReportMessage content={'Worker report · Release check\\n\\nEnvironment needs adjustment.\\n\\n'+('Full evidence line.\\n'.repeat(80))+'EXACT_END'}/>)}
    window.mountStructuredReport=report=>{const target=document.createElement('div');target.style.cssText='max-width:680px;margin:16px auto';document.body.append(target);createRoot(target).render(<WorkerReportMessage content={'Worker report · Improve reports\\n\\n'+JSON.stringify(report)}/>)}
    window.calls=[];window.listeners={};window.current=undefined;window.saved=[];window.capacity=3;window.operations=[]
    const works=Array.from({length:5},(_,i)=>({id:'work-'+i,title:'Feature '+i,workspaceId:'workspace',sourceInputId:'input-'+i,createdAt:5-i,revision:1,closedAt:null,latestReportId:i===4?'report':null}));
    const input={id:'input',conversationId:'chat-a',resourceId:'input-body'}
    const phases=['waiting','running','queued','failed','ready'];
    window.residents=works.filter((_,i)=>i!==2).map((work,i)=>({workspaceId:'workspace',workId:work.id,executionId:'execution-'+i,instanceId:'instance-'+i,
      phase:phases[works.indexOf(work)],stopConfirmed:i===3,disabledExtensions:[],conversation:{models:[],connection:'ready',items:i===1?[
        {type:'agentMessage',text:'Checking greeting behavior'}, {type:'userMessage',text:'Assigned work: Feature 1\\nGoal: Implement the discussed plan\\nWork background (data): confirmed constraints'}]:[],approvals:[],questions:[]}}));
    window.electron={superAgent:{available:async()=>true,
      workerModels:async backend=>{window.calls.push(['worker-models',backend]);if(window.catalogError)throw new Error('offline');return (backend==='codex'?['native','alternate','codex-model']:['opus']).map(model=>({model,displayName:model,efforts:[],defaultEffort:null}))},
      workerDefaults:async backend=>{if(window.deferDefaults)await(window.defaultsGate??=new Promise(resolve=>window.resolveDefaults=resolve));const active=window.defaultSettings||{terminal:'codex',model:null,effort:null};return !backend||backend===active.terminal?active:window.defaultProfiles?.[backend]||{terminal:backend,model:null,effort:null}},
      workerIdleTimeoutMinutes:async()=>window.idleMinutes??30,
      workerPolicy:async()=>window.workerPolicy??{defaultBackend:'codex',enabled:['codex','claude']},
      updateWorkerPolicy:async value=>{window.workerPolicy=value;return value},
      updateWorkerIdleTimeoutMinutes:async value=>{if(window.idleError)throw new Error(window.idleError);window.idleMinutes=value;return value},
      updateWorkerDefaults:async value=>{window.calls.push(['defaults',value]);if(window.settingsError)throw new Error(window.settingsError);window.defaultSettings=value;(window.defaultProfiles||={})[value.terminal]=value;return value},
      workerSettings:async identity=>window.workerChoices?.[identity.executionId]||{selection:{terminal:'codex',model:null,effort:null},inherited:true,pending:false},
      configureWorker:async(identity,value)=>{window.calls.push(['worker-settings',identity,value]);if(window.settingsError)throw new Error(window.settingsError);const state={selection:value||window.defaultSettings||{terminal:'codex',model:null,effort:null},inherited:value===null,pending:true};(window.workerChoices||={})[identity.executionId]=state;return state},
      refreshWorkerModels:async identity=>{window.calls.push(['models',identity]);return window.electron.superAgent.workerSettings(identity)},
      snapshot:async scope=>({inputs:[input],works:scope==='workspace'?works:[]}),
      workDetail:async(_scope,id)=>({work:works.find(row=>row.id===id),inputs:[{...input,id:'input-'+id.slice(5),sequence:1}],executions:[],reports:[{id:'report',resourceId:'report-body',summary:'Persisted Worker result'}],deliveries:[]}),
      workerLog:async()=>({available:true,text:window.failureLog||''}),
      workers:async()=>window.residents,environments:async()=>({operations:window.operations}),
      schedule:async scope=>({workspaceId:scope,maxConcurrentWorkers:window.capacity,occupied:3,entries:scope==='workspace'?works.map((work,i)=>({...work,workId:work.id,status:phases[i]})):[]}),
      configureCapacity:async value=>{window.calls.push(['capacity',value]);window.capacity=value;phases[2]='starting';window.listeners.schedule?.({workspaceId:'workspace'});return value},
      controlWork:async value=>{window.calls.push(['work-control',value]);if(value.action==='close'){works.find(row=>row.id===value.workId).closedAt=10;window.listeners.record?.({workspaceId:'workspace'})}},
      readResource:async(_scope,id)=>({text:id==='input-body'?'Original user instruction':'Persisted Worker result'}),
      onChanged:fn=>{window.listeners.record=fn;return()=>{delete window.listeners.record}},
      onWorkerChanged:fn=>{window.listeners.worker=fn;return()=>{delete window.listeners.worker}},
      onEnvironmentsChanged:fn=>{window.listeners.environment=fn;return()=>{delete window.listeners.environment}},
      onScheduleChanged:fn=>{window.listeners.schedule=fn;return()=>{delete window.listeners.schedule}},
      controlWorker:async value=>{window.calls.push(['control',value])},
      continueWorker:async value=>{window.calls.push(['continue',value]);if(window.continueError)throw new Error(window.continueError)},
    }}
    window.electron.llm={getTerminalDefault:async()=>{window.calls.push(['unexpected-llm-models']);throw new Error('No LLM binding')},listModels:async()=>{window.calls.push(['unexpected-llm-models']);return [{id:'unrelated-channel-model',name:'Unrelated model'}]}}
    window.electron.agentSettings={get:async()=>window.agentSettings||{approvalMode:'per-action',agentMaxSteps:40,safeCompileAutoAllow:true},update:async value=>{window.calls.push(['agent-settings',value]);window.agentSettings=value;return value}}
    window.publish=(phase='waiting')=>{
      window.saved=[{id:'report',resourceId:'report-body'}]
      window.current={workspaceId:'workspace',conversationId:'chat-a',workId:'work-0',executionId:'execution',instanceId:'instance',phase,stopConfirmed:false,disabledExtensions:[],
        conversation:{models:[],connection:'ready',items:[],approvals:[],questions:[{id:23,version:4,status:'pending',cancelable:true,questions:[
          {id:'choice',text:'Choose result',options:[{id:'yes',label:'Yes'},{id:'no',label:'No'}]},
          {id:'notes',text:'Your note',options:[],allowText:true}]}]}}
      window.residents=[...window.residents.filter(row=>row.workId!=='work-0'),window.current]
      window.listeners.worker?.(window.current);window.listeners.record?.({workspaceId:'workspace'})
    }
    window.retire=()=>{const row=window.residents.find(row=>row.workId==='work-4');window.residents=window.residents.filter(row=>row!==row);window.listeners.worker?.({...row,retiredAt:1800000})}
    window.blockBeforeLaunch=()=>{
      window.residents=window.residents.filter(row=>row.workId!=='work-2');phases[2]='blocked';window.listeners.schedule?.({workspaceId:'workspace'})
    }
    window.addOlderQuestion=()=>{
      for(let i=5;i<13;i++){works.push({id:'work-'+i,title:'Feature '+i,workspaceId:'workspace',sourceInputId:'input-'+i,createdAt:5-i,revision:1,closedAt:null});phases.push('queued')}
      const row={...window.residents[0],workId:'work-12',executionId:'old-request',conversation:{models:[],connection:'ready',items:[],approvals:[],questions:[{id:90,version:1,status:'pending',questions:[{id:'choice',text:'Answer the older work',options:[{id:'yes',label:'Proceed'}]}]}]}}
      window.residents.push(row);window.listeners.worker?.(row)
    }
    function App(){const[draft,setDraft]=useState(''),[visible,setVisible]=useState(true);return <div style={{padding:16,maxWidth:760}}>
      <button onClick={()=>setVisible(value=>!value)}>Toggle panel</button>{visible&&<SuperAgentWorkProvider><SuperAgentWorkHeader/><SuperAgentWorkflowPlans conversationId="chat-a"/><SuperAgentWork conversationId="chat-a"/><div data-conversation-reports><SuperAgentReportFallback/></div><SuperAgentDecisions conversationId="chat-a"/></SuperAgentWorkProvider>}<textarea aria-label="Draft" value={draft} onChange={e=>setDraft(e.target.value)}/></div>}
    window.changeLanguage=language=>i18n.changeLanguage(language)
    i18n.use(initReactI18next).init({lng:'en',resources:{en:{janus,terminal,settings},'zh-CN':{janus:zhJanus,terminal:zhTerminal,settings:zhSettings}},interpolation:{escapeValue:false}}).then(()=>createRoot(document.getElementById('root')).render(<App/>))
  ` }, bundle: true, write: false, outfile: 'superagent-ui.js', loader: { '.svg': 'dataurl' }, jsx: 'automatic', format: 'iife', define: { 'process.env.NODE_ENV': '"test"' }, plugins: [{ name: 'isolated-workspace', setup(builder) {
    builder.onLoad({ filter: /[/\\]stores[/\\]workspace\.ts$/ }, () => ({ contents: "import {useSyncExternalStore} from 'react';let state={activeWorkspaceId:'workspace',workspaces:[{id:'workspace',name:'Fixture project'}]};const listeners=new Set();window.switchWorkspace=id=>{state={...state,activeWorkspaceId:id};listeners.forEach(fn=>fn())};export const useWorkspaceStore=selector=>selector(useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>state))", loader: 'ts' }))
    builder.onLoad({ filter: /[/\\]i18n[/\\]index\.ts$/ }, () => ({ contents: "import i18n from 'i18next';export default i18n;export const changeLanguage=()=>{}", loader: 'ts' }))
  } }] })
  script = result.outputFiles.find(file => file.path.endsWith('.js'))!.text
  css = result.outputFiles.find(file => file.path.endsWith('.css'))!.text
})

it('allows stop retry after Close fails and after the unconfirmed instance is restored', async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 850 } })
  try {
    await page.route('http://127.0.0.1/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script }); await expandWorkerDetails(page)
    const card = page.getByRole('article', { name: 'Feature 0', exact: true })
    await card.waitFor()
    // The fixture persists Close before receiving the asynchronous stop outcome.
    await page.evaluate(async () => {
      const w = window as any
      await w.electron.superAgent.controlWork({ workId: 'work-0', action: 'close' })
      const worker = w.residents[0]; worker.phase = 'failed'; worker.diagnostic = 'Access denied: PID 48852'
      w.listeners.worker(worker)
    })
    await expect.poll(() => card.getAttribute('data-phase')).toBe('failed')
    const stop = card.getByRole('button', { name: 'Stop Worker', exact: true })
    expect(await stop.isEnabled()).toBe(true)
    await stop.click()
    await page.evaluate(() => {
      const w = window as any, worker = w.residents[0]; worker.restored = true; worker.phase = 'interrupted'; w.listeners.worker(worker)
    })
    await expect.poll(() => card.getAttribute('data-phase')).toBe('interrupted')
    expect(await stop.isEnabled()).toBe(true)
    await stop.click()
    expect(await page.evaluate(() => (window as any).calls.filter((row: any[]) => row[0] === 'work-control' && row[1].action === 'stop').length)).toBe(2)
  } finally { await page.close() }
})

it('keeps combined Agent and Worker settings compact and all section actions reachable in a 800 by 600 scroll body', async () => {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
  try {
    await page.route('http://127.0.0.1/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script }); await expandWorkerDetails(page)
    await page.getByRole('article', { name: 'Feature 0', exact: true }).waitFor()
    await page.evaluate(() => { document.body.style.margin = '0'; (window as any).mountAgentSettings() })
    const panel = page.locator('#agent-settings'), sections = panel.locator('[data-jx-section]')
    const model = panel.locator('#worker-model-codex')
    await model.waitFor(); await page.waitForFunction(() => !(document.getElementById('worker-model-codex') as HTMLInputElement).disabled)
    expect(await sections.count()).toBe(3)
    const plugin = panel.getByRole('region', { name: 'SuperAgent plugin settings', exact: true })
    expect(await plugin.getByRole('heading', { level: 3 }).isVisible()).toBe(true)
    expect(await plugin.getByRole('heading', { level: 4 }).count()).toBe(2)
    expect(await plugin.locator('[data-jx-footer]').count()).toBe(2)
    expect(await panel.locator('.jx-settings-panel').count()).toBe(1)
    const permissionBounds = (await sections.first().boundingBox())!
    const gap = (await plugin.boundingBox())!.y - permissionBounds.y - permissionBounds.height
    expect(gap).toBeGreaterThanOrEqual(16); expect(gap).toBeLessThanOrEqual(32)
    const footers = await panel.locator('[data-jx-footer]').evaluateAll(rows => rows.map(row => getComputedStyle(row).position))
    expect(footers).toEqual(['static', 'static', 'static'])
    expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await model.click(); await page.getByRole('option', { name: 'alternate', exact: true }).click()
    const workerSection = sections.nth(2), save = workerSection.getByRole('button', { name: 'Save', exact: true })
    await save.click()
    await page.waitForFunction(() => (window as any).defaultSettings?.model === 'alternate')
    const permissionSection = sections.nth(0)
    await permissionSection.getByRole('checkbox').uncheck()
    await permissionSection.getByRole('button', { name: 'Save', exact: true }).click()
    await page.waitForFunction(() => (window as any).agentSettings?.safeCompileAutoAllow === false)
    await mkdir(settingsArtifacts, { recursive: true })
    for (const theme of ['dark', 'white', 'planche']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
      await panel.locator('main, [data-jx-surface]').first().evaluate(el => { el.scrollTop = 0 })
      await panel.screenshot({ path: `${settingsArtifacts}/combined-${theme}.png` })
      await save.scrollIntoViewIfNeeded()
      expect(await save.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) })).toBe(true)
      await panel.screenshot({ path: `${settingsArtifacts}/combined-bottom-${theme}.png` })
    }
    await page.evaluate(() => (window as any).changeLanguage('zh-CN'))
    await workerSection.getByRole('button', { name: '恢复原生默认', exact: true }).waitFor()
    await panel.getByRole('region', { name: 'SuperAgent 插件设置', exact: true }).waitFor()
    await page.setViewportSize({ width: 390, height: 700 })
    expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    expect(await panel.innerText()).not.toContain('workerDefaults.')
  } finally { await page.close() }
})

it('opens ordinary Agent settings without querying the Worker queue', async () => {
  const page = await browser.newPage()
  try {
    await page.route('http://127.0.0.1/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/')
    await page.addScriptTag({ content: script })
    await page.getByRole('button', { name: 'Toggle panel' }).click()
    await page.evaluate(() => {
      const w = window as any
      w.setSuperAgentStarted(false)
      w.queueReads = 0
      const schedule = w.electron.superAgent.schedule
      w.electron.superAgent.schedule = (...args: any[]) => { w.queueReads++; return schedule(...args) }
      w.mountAgentSettings()
    })
    await page.locator('#agent-settings select, #agent-settings button').first().waitFor()
    expect(await page.getByRole('region', { name: 'SuperAgent plugin settings', exact: true }).count()).toBe(0)
    expect(await page.getByRole('region', { name: 'Worker concurrency' }).count()).toBe(0)
    expect(await page.evaluate(() => (window as any).queueReads)).toBe(0)
    await page.evaluate(() => (window as any).setSuperAgentStarted(true))
    await page.getByRole('region', { name: 'Worker concurrency' }).waitFor()
    await expect.poll(() => page.evaluate(() => (window as any).queueReads)).toBe(1)
  } finally { await page.close() }
})

it('validates capacity only in Settings, retains rejected edits, and recovers from a failed read', async () => {
  const page = await browser.newPage({viewport:{width:900,height:760}})
  try {
    await page.route('http://127.0.0.1/', route => route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}))
    await page.goto('http://127.0.0.1/'); await page.addStyleTag({content:css}); await page.addScriptTag({content:script})
    await page.evaluate(() => (window as any).mountAgentSettings())
    const panel=page.getByRole('region',{name:'Worker concurrency',exact:true}), input=panel.getByRole('spinbutton'), save=panel.getByRole('button',{name:'Save',exact:true})
    await expect.poll(() => input.inputValue()).toBe('3')
    for(const invalid of ['0','-1','1.5','']) {
      await input.fill(invalid); expect(await save.isDisabled()).toBe(true)
      expect(await input.getAttribute('aria-invalid')).toBe('true')
    }
    expect(await page.evaluate(() => (window as any).calls.filter((row:any[]) => row[0]==='capacity'))).toEqual([])
    await page.evaluate(() => {const w=window as any; w.capacityWrite=w.electron.superAgent.configureCapacity; w.electron.superAgent.configureCapacity=async()=>{throw Error('Capacity write rejected')}})
    await input.fill('5'); await save.click(); await panel.getByRole('alert').filter({hasText:'Capacity write rejected'}).waitFor()
    expect(await input.inputValue()).toBe('5')
    expect(await page.evaluate(() => (window as any).capacity)).toBe(3)
    await page.evaluate(() => {const w=window as any;w.electron.superAgent.configureCapacity=w.capacityWrite})
    await save.click(); await page.waitForFunction(() => (window as any).capacity===5)
    expect(await save.isDisabled()).toBe(true)
    await mkdir(`${settingsArtifacts}/capacity`,{recursive:true})
    for(const theme of ['dark','white','planche']) {
      await page.evaluate(theme => {document.documentElement.dataset.theme=theme},theme)
      await panel.screenshot({path:`${settingsArtifacts}/capacity/${theme}.png`})
    }
    await page.evaluate(() => {const w=window as any;w.closeAgentSettings();w.capacityRead=w.electron.superAgent.schedule;w.electron.superAgent.schedule=async()=>{throw Error('Capacity read failed')};w.mountAgentSettings()})
    await panel.getByRole('alert').filter({hasText:'Capacity read failed'}).waitFor()
    expect(await input.isDisabled()).toBe(true); expect(await save.isDisabled()).toBe(true)
    await page.evaluate(() => {const w=window as any;w.electron.superAgent.schedule=w.capacityRead})
    await panel.getByRole('button',{name:'Reload'}).click()
    await expect.poll(() => input.inputValue()).toBe('5')
    await page.evaluate(() => (window as any).changeLanguage('zh-CN'))
    const chinese=page.getByRole('region',{name:'Worker 并发',exact:true})
    await chinese.getByRole('spinbutton',{name:'并发上限'}).waitFor()
    await page.setViewportSize({width:390,height:760})
    await chinese.screenshot({path:`${settingsArtifacts}/capacity/narrow-zh.png`})
    expect(await chinese.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)
  } finally {await page.close()}
})

it('loads, saves and restores Worker defaults with a truthful backend selector and visible validation errors', async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } })
  try {
    await page.route('http://127.0.0.1/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script }); await expandWorkerDetails(page)
    await page.getByRole('article', { name: 'Feature 0', exact: true }).waitFor()
    await page.evaluate(() => {
      const w = window as any; w.deferDefaults = true; w.defaultSettings = { terminal: 'codex', model: 'native', effort: 'medium' }; w.mountWorkerDefaults()
    })
    const panel = page.locator('#worker-defaults'), model = panel.locator('#worker-model-codex')
    await model.waitFor(); expect(await model.isDisabled()).toBe(true)
    await page.waitForFunction(() => typeof (window as any).resolveDefaults === 'function')
    await page.evaluate(() => { const w = window as any; w.deferDefaults = false; w.resolveDefaults() })
    await page.waitForFunction(() => document.getElementById('worker-model-codex')?.textContent?.includes('native'))
    expect(await panel.getByRole('button', { name: 'Configure engine', exact: true }).count()).toBe(0)
    expect(await panel.getByRole('spinbutton', { name: 'Idle auto-close time', exact: true }).inputValue()).toBe('30')
    const idle = panel.getByRole('spinbutton', { name: 'Idle auto-close time', exact: true })
    expect(await idle.isDisabled()).toBe(false)
    await idle.fill('0')
    await panel.getByRole('button', { name: 'Save', exact: true }).click()
    await panel.getByRole('alert').getByText('Enter a whole number of minutes between 1 and 10080.', { exact: false }).waitFor()
    await idle.fill('60')
    await page.evaluate(() => { (window as any).idleError = 'Idle setting write failed' })
    await panel.getByRole('button', { name: 'Save', exact: true }).click()
    await panel.getByRole('alert').getByText('Idle setting write failed', { exact: false }).waitFor()
    expect(await idle.inputValue()).toBe('60')
    await page.evaluate(() => { (window as any).idleError = null })
    await panel.getByRole('button', { name: 'Save', exact: true }).click()
    await page.waitForFunction(() => (window as any).idleMinutes === 60)
    await model.click(); await page.getByRole('option', { name: 'alternate', exact: true }).click()
    await panel.locator('#worker-effort-codex').click()
    await page.getByRole('listbox').getByRole('option', { name: 'High', exact: true }).click()
    await panel.getByRole('button', { name: 'Save', exact: true }).click()
    await page.waitForFunction(() => (window as any).defaultSettings.model === 'alternate')
    expect(await page.evaluate(() => (window as any).defaultSettings)).toEqual({ terminal: 'codex', model: 'alternate', effort: 'high' })
    for (const theme of ['dark', 'white', 'planche']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
      await mkdir(settingsArtifacts, { recursive: true })
      await panel.screenshot({ path: `${settingsArtifacts}/defaults-${theme}.png` })
    }
    await panel.getByRole('button', { name: 'Restore native defaults', exact: true }).click()
    expect(await model.innerText()).toContain('Native default')
    expect(await idle.inputValue()).toBe('30')
    await panel.getByRole('button', { name: 'Save', exact: true }).click()
    await page.waitForFunction(() => (window as any).defaultSettings.model === null)
    expect(await page.evaluate(() => (window as any).defaultSettings)).toEqual({ terminal: 'codex', model: null, effort: null })
    await page.evaluate(() => { (window as any).settingsError = 'Disk unavailable' })
    await model.click(); await page.getByRole('option', { name: 'native', exact: true }).click(); await panel.getByRole('button', { name: 'Save', exact: true }).click()
    await panel.getByRole('alert').getByText('Disk unavailable', { exact: false }).waitFor()
    await page.evaluate(() => (window as any).changeLanguage('zh-CN'))
    await panel.getByRole('button', { name: '恢复原生默认', exact: true }).waitFor()
    expect(await panel.innerText()).toContain('默认执行')
    expect(await panel.getByRole('spinbutton', { name: '空闲自动关闭时间', exact: true }).isDisabled()).toBe(false)
  } finally { await page.close() }
})

it('shows retry for a failed continuation even when the previous stopped worker was ready', async () => {
  const page = await browser.newPage()
  try {
    await page.route('http://127.0.0.1/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script }); await expandWorkerDetails(page)
    await page.locator('[data-work-id="work-0"]').first().waitFor()
    await page.evaluate(() => {
      const w = window as any, worker = w.residents[0]
      worker.phase = 'ready'; worker.stopConfirmed = true
      w.electron.superAgent.schedule = async () => ({ workspaceId: 'workspace', occupied: 0, maxConcurrentWorkers: 2,
        entries: [{ workId: worker.workId, status: 'failed', diagnostic: 'Environment is occupied by an active worker or terminal' }] })
      w.listeners.worker(worker); w.listeners.schedule({ workspaceId: 'workspace' })
    })
    const card = page.locator('[data-work-id="work-0"]').first()
    await expect.poll(() => card.getAttribute('data-phase')).toBe('failed')
    await card.getByRole('button', { name: 'Retry startup', exact: true }).click()
    expect(await page.evaluate(() => (window as any).calls.some((row: any[]) => row[0] === 'continue'))).toBe(true)
  } finally { await page.close() }
})

it('edits a single Worker for the next turn, preserves current native readback and rejects errors visibly', async () => {
  const page = await browser.newPage({ viewport: { width: 320, height: 600 } })
  try {
    await page.route('http://127.0.0.1/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script }); await expandWorkerDetails(page)
    const card = page.getByRole('article', { name: 'Feature 0', exact: true })
    await card.waitFor()
    await page.evaluate(() => {
      const w = window as any, worker = w.residents[0]
      worker.conversation = { ...worker.conversation, model: 'native', effort: 'medium', revision: 1, models: [
        { model: 'native', displayName: 'Native model', defaultEffort: 'medium', efforts: [{ effort: 'medium' }, { effort: 'high' }] },
        { model: 'alternate', displayName: 'Alternate model', defaultEffort: 'high', efforts: [{ effort: 'high' }] },
      ] }; w.listeners.worker(worker)
    })
    await card.getByRole('button', { name: /^Model settings:/ }).click()
    const controls = page.getByRole('dialog')
    await controls.getByText('Current native configuration: native · Medium', { exact: true }).waitFor()
    await controls.getByRole('button', { name: 'Model', exact: true }).click()
    await page.getByRole('option', { name: 'Alternate model', exact: true }).click()
    expect(await controls.getByRole('button', { name: 'Reasoning', exact: true }).innerText()).toContain('High')
    await controls.getByRole('button', { name: 'Apply next turn', exact: true }).click()
    await controls.getByText('Pending next turn: alternate · High', { exact: true }).waitFor()
    expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    expect(await controls.evaluate(el => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().right <= innerWidth)).toBe(true)
    expect(await controls.innerText()).toContain('Current native configuration: native · Medium')
    expect(await page.evaluate(() => (window as any).calls.find((row: any[]) => row[0] === 'worker-settings'))).toEqual([
      'worker-settings', { workspaceId: 'workspace', workId: 'work-0', executionId: 'execution-0' }, { terminal: 'codex', model: 'alternate', effort: 'high' },
    ])
    for (const theme of ['dark', 'white', 'planche']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
      await mkdir(settingsArtifacts, { recursive: true })
      await controls.screenshot({ path: `${settingsArtifacts}/worker-${theme}.png` })
      await controls.getByRole('button', { name: 'Close model settings', exact: true }).click()
      await card.screenshot({ path: `${settingsArtifacts}/sidebar-${theme}.png` })
      await card.getByRole('button', { name: /^Model settings:/ }).click()
    }
    await controls.getByRole('button', { name: 'Use saved defaults', exact: true }).click()
    await page.waitForFunction(() => (window as any).calls.filter((row: any[]) => row[0] === 'worker-settings').at(-1)[2] === null)
    await page.evaluate(() => { (window as any).settingsError = 'Execution changed' })
    await controls.getByRole('button', { name: 'Use saved defaults', exact: true }).click()
    await controls.getByRole('alert').getByText('Execution changed', { exact: false }).waitFor()
    await page.evaluate(() => (window as any).changeLanguage('zh-CN'))
    await controls.getByRole('button', { name: '使用默认设置', exact: true }).waitFor()
    expect(await controls.innerText()).not.toContain('workerModel.')
    await page.evaluate(() => {
      const w = window as any, worker = w.residents[0]; worker.phase = 'stopping'; w.listeners.worker(worker)
    })
    expect(await controls.getByRole('button', { name: '使用默认设置', exact: true }).isDisabled()).toBe(true)
  } finally { await page.close() }
})

it('shares bilingual ultra and max labels across defaults and native catalog controls and translates IPC errors', async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } })
  try {
    await page.route('http://127.0.0.1/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script }); await expandWorkerDetails(page)
    const card = page.getByRole('article', { name: 'Feature 0', exact: true }); await card.waitFor()
    await page.evaluate(() => {
      const w = window as any
      w.defaultSettings = { terminal: 'codex', model: '6-astra', effort: 'ultra' }; w.mountWorkerDefaults()
      const worker = w.residents[0]
      worker.conversation = { ...worker.conversation, model: '6-astra', effort: 'high', revision: 1, models: [
        { model: '6-astra', displayName: '6 Astra', defaultEffort: 'high', efforts: ['high', 'ultra', 'max', 'future_effort'].map(effort => ({ effort })) },
      ] }; w.listeners.worker(worker)
    })
    const defaults = page.locator('#worker-defaults')
    await defaults.locator('#worker-effort-codex').getByText('Ultra', { exact: true }).waitFor()
    await defaults.locator('#worker-effort-codex').click()
    await page.getByRole('option', { name: 'Maximum (max)', exact: true }).click()
    await defaults.getByRole('button', { name: 'Save', exact: true }).click()
    await page.waitForFunction(() => (window as any).defaultSettings.effort === 'max')
    await card.getByRole('button', { name: /^Model settings:/ }).click()
    const controls = page.getByRole('dialog')
    await controls.getByRole('button', { name: 'Reasoning', exact: true }).click()
    expect(await page.getByRole('option', { name: 'future_effort', exact: true }).count()).toBe(1)
    await page.getByRole('option', { name: 'Ultra', exact: true }).click()
    await controls.getByRole('button', { name: 'Apply next turn', exact: true }).click()
    await controls.getByText('Pending next turn: 6-astra · Ultra', { exact: true }).waitFor()
    expect(await page.evaluate(() => (window as any).calls.filter((row: any[]) => row[0] === 'worker-settings').at(-1)[2])).toEqual({ terminal: 'codex', model: '6-astra', effort: 'ultra' })
    await page.evaluate(() => (window as any).changeLanguage('zh-CN'))
    await controls.getByText('下轮生效：6-astra · 超强（ultra）', { exact: true }).waitFor()
    expect(await defaults.locator('#worker-effort-codex').innerText()).toContain('最大（max）')
    await page.evaluate(() => { (window as any).settingsError = "Error: Error invoking remote method 'superagent:configure-worker': Error: Unsupported reasoning effort for this Codex model" })
    await controls.getByRole('button', { name: '使用默认设置', exact: true }).click()
    await controls.getByRole('alert').getByText('此模型不支持所选推理强度', { exact: false }).waitFor()
    expect(await controls.getByRole('alert').innerText()).not.toContain('Error invoking remote method')
    await mkdir(settingsArtifacts, { recursive: true })
    await controls.screenshot({ path: `${settingsArtifacts}/effort-ultra-zh.png` })
    await page.evaluate(() => (window as any).changeLanguage('en'))
    await controls.getByRole('alert').getByText('This model does not support the selected reasoning effort', { exact: false }).waitFor()
    await controls.screenshot({ path: `${settingsArtifacts}/effort-ultra-en.png` })
    await controls.getByRole('button', { name: 'Close model settings', exact: true }).click()
    await page.evaluate(() => { const w = window as any; w.defaultSettings.effort = 'future_effort'; w.changeLanguage('zh-CN') })
    await defaults.locator('#worker-effort-codex').getByText('future_effort', { exact: true }).waitFor()
  } finally { await page.close() }
})

it('uses neutral native approval cards and loaded Codex icons in all three themes without changing decision routing', async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 850 } })
  try {
    await page.route('http://127.0.0.1/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script }); await expandWorkerDetails(page)
    await page.getByRole('article', { name: 'Feature 0', exact: true }).waitFor()
    await page.evaluate(() => {
      const state = window as any, worker = state.residents[0]
      worker.conversation.approvals = [{ id: 81, description: 'Allow the janus_worker MCP server to run tool "report_work"?',
        choices: [{ id: 'accept', label: 'Allow once' }, { id: 'decline', label: 'Decline' }] }]
      state.listeners.worker(worker)
    })
    const approval = page.locator('[data-presentation="decisions"][data-work-id="work-0"]')
    await approval.getByText('Allow the janus_worker', { exact: false }).waitFor()
    for (const theme of ['dark', 'white', 'planche']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
      const border = await approval.evaluate(el => {
        const probe = document.createElement('div'); probe.style.border = '1px solid var(--shell-border)'; el.append(probe)
        const expected = getComputedStyle(probe).borderLeftColor; probe.remove()
        const actual = getComputedStyle(el)
        return { actual: actual.borderLeftColor, expected, width: actual.borderLeftWidth }
      })
      expect(border.actual).toBe(border.expected); expect(border.width).toBe('1px')
      await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('[data-preset="codex"]')].every(img => img.complete && img.naturalWidth > 0))
      expect(await page.locator('[data-preset="codex"]').count()).toBe(5)
      await mkdir('artifacts/superagent-approvals', { recursive: true })
      await approval.screenshot({ path: `artifacts/superagent-approvals/approval-${theme}.png` })
      await page.locator('[data-presentation="status"][data-work-id="work-0"]').screenshot({ path: `artifacts/superagent-approvals/worker-${theme}.png` })
    }
    await approval.getByRole('button', { name: 'Allow once', exact: true }).click()
    await page.waitForFunction(() => (window as any).calls.some(([kind, value]: any[]) => kind === 'control' && value.type === 'approve' && value.requestId === 81 && value.workId === 'work-0' && value.executionId === 'execution-0' && value.decision === 'accept'))
  } finally { await page.close() }
})

it('localizes command and turn permission choices without changing the native response', async () => {
  const page = await browser.newPage()
  try {
    await page.route('http://127.0.0.1/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script }); await expandWorkerDetails(page)
    await page.getByRole('article', { name: 'Feature 0', exact: true }).waitFor()
    await page.evaluate(async () => {
      const w = window as any; await w.changeLanguage('zh-CN')
      const worker = w.residents.find((row: any) => row.workId === 'work-0')
      worker.conversation.approvals = [{ id: 91, kind: 'command', description: 'npm test', choices: [
        { id: 'accept', label: 'Allow once' }, { id: 'acceptForSession', label: 'Allow for this session' },
        { id: 'decline', label: 'Decline' }, { id: 'cancel', label: 'Decline and stop this turn' },
      ] }, { id: 92, kind: 'command', permissionScope: 'turn', description: 'Scoped permissions', choices: [
        { id: 'accept', label: 'Allow these permissions for this turn' }, { id: 'decline', label: 'Decline' },
      ] }]
      w.listeners.worker(worker)
    })
    const panel = page.locator('[data-presentation="decisions"][data-work-id="work-0"]')
    for (const label of ['允许一次', '本会话允许', '拒绝并停止本轮', '允许本轮权限']) {
      await panel.getByRole('button', { name: label, exact: true }).waitFor()
    }
    expect(await panel.getByRole('button', { name: /^Allow|^Decline/ }).count()).toBe(0)
    await panel.getByRole('button', { name: '允许本轮权限', exact: true }).click()
    await page.waitForFunction(() => (window as any).calls.some(([kind, value]: any[]) => kind === 'control' && value.requestId === 92 && value.decision === 'accept'))
    await mkdir('artifacts/superagent-approvals', { recursive: true })
    await panel.screenshot({ path: 'artifacts/superagent-approvals/approval-zh.png' })
  } finally { await page.close() }
})

it('keeps an older pending decision reachable before expanding a paginated Worker list', async () => {
  const page = await browser.newPage()
  try {
    await page.route('http://127.0.0.1/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script }); await expandWorkerDetails(page)
    await page.getByRole('article', { name: 'Feature 4', exact: true }).waitFor()
    await page.evaluate(() => (window as any).addOlderQuestion())
    await page.getByRole('article', { name: 'Feature 12', exact: true }).waitFor()
    expect(await page.getByRole('article').count()).toBe(13)
    await page.getByRole('radio', { name: 'Proceed', exact: true }).check()
    await page.getByRole('button', { name: 'Submit answer', exact: true }).click()
    await page.waitForFunction(() => (window as any).calls.some((row: any) => row[0] === 'control' && row[1].workId === 'work-12' && row[1].requestId === 90))
  } finally { await page.close() }
})
afterAll(async () => { await browser?.close() })

it('explains an unsupported native request and offers retry only after stop is confirmed', async () => {
  const page = await browser.newPage()
  try {
    await page.route('http://127.0.0.1/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script }); await expandWorkerDetails(page)
    const card = page.locator('[data-presentation="status"][data-work-id="work-0"]')
    await card.waitFor()
    await page.evaluate(() => {
      const w = window as any, worker = w.residents[0]
      worker.conversation.needsTerminal = true
      worker.conversation.error = 'Unsupported native request: fixture/request. Stop this worker to cancel it.'
      w.listeners.worker({ ...worker })
    })
    const decision = page.locator('[data-presentation="decisions"][data-work-id="work-0"]')
    await decision.getByRole('alert').filter({ hasText: 'fixture/request' }).waitFor()
    expect(await decision.getByRole('button', { name: 'Stop Worker', exact: true }).count()).toBe(1)
    expect(await card.getByRole('button', { name: 'Retry startup', exact: true }).count()).toBe(0)
    expect(await page.evaluate(() => (window as any).calls.length)).toBe(0)
    await page.evaluate(() => {
      const w = window as any, worker = w.residents[0]
      worker.phase = 'stopped'; worker.stopConfirmed = true; worker.conversationId = 'original-chat'
      w.continueError = 'Retry connection failed'; w.listeners.worker({ ...worker })
    })
    await decision.waitFor({ state: 'hidden' })
    const retry = card.getByRole('button', { name: 'Retry startup', exact: true })
    await retry.click()
    await card.getByRole('alert').filter({ hasText: 'Retry connection failed' }).waitFor()
    const first = await page.evaluate(() => (window as any).calls.find(([kind]: any[]) => kind === 'continue')[1])
    expect(first).toMatchObject({ workspaceId: 'workspace', workId: 'work-0', conversationId: 'original-chat' })
    expect(first.eventId).toBeTruthy()
    await page.evaluate(() => { (window as any).continueError = undefined })
    await retry.click()
    await page.waitForFunction(() => (window as any).calls.filter(([kind]: any[]) => kind === 'continue').length === 2)
    expect(await page.evaluate(() => (window as any).calls.filter(([kind]: any[]) => kind === 'continue')[1][1].eventId)).toBe(first.eventId)
    expect(await card.getByRole('alert').count()).toBe(0)
  } finally { await page.close() }
})

it('keeps the live command caret aligned with the last visible glyph across wrapping and trailing newlines', async () => {
  const page = await browser.newPage({ viewport: { width: 400, height: 950 } })
  try {
    await page.route('http://127.0.0.1/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script }); await expandWorkerDetails(page)
    const card = page.locator('[data-presentation="status"][data-work-id="work-1"]')
    await card.waitFor()
    for (const width of [280, 352]) {
      if (await card.getByRole('button', { name: 'Current command', exact: true }).getAttribute('aria-expanded') === 'false') await card.getByRole('button', { name: 'Current command', exact: true }).click()
      for (const text of ['rg -n focus src', 'npm test\nRunning checks\n\n', 'checking/'.repeat(35) + 'done  \r\n', 'FILL_TO_EDGE']) {
        const expectedText = await page.evaluate(({ width, text }) => {
          const w = window as any, worker = w.residents.find((row: any) => row.workId === 'work-1')
          document.querySelector<HTMLElement>('[data-work-id="work-1"]')!.style.width = `${width}px`
          if (text === 'FILL_TO_EDGE') {
            const panel = document.querySelector<HTMLElement>('[data-work-id="work-1"] [data-worker-stream]')!, style = getComputedStyle(panel)
            const context = document.createElement('canvas').getContext('2d')!; context.font = style.font
            const columns = Math.floor((panel.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)) / context.measureText('x').width)
            text = 'x'.repeat(columns - 2)
          }
          worker.conversation.turnId = 'caret-turn'; worker.conversation.connection = 'ready'; worker.phase = 'running'
          worker.conversation.items = [{ id: 'caret-command', type: 'commandExecution', turnId: 'caret-turn', status: 'inProgress', text }]
          w.listeners.worker(worker)
          return text
        }, { width, text })
        await page.waitForFunction(text => document.querySelector('[data-work-id="work-1"] [data-worker-stream] span')?.textContent?.trimEnd() === '$ ' + text.trimEnd(), expectedText)
        const geometry = await card.locator('[data-worker-stream]').evaluate(el => {
          const text = el.querySelector('span')!.firstChild!, end = text.textContent!.trimEnd().length
          const range = document.createRange(); range.setStart(text, end - 1); range.setEnd(text, end)
          const glyph = range.getBoundingClientRect(), caret = el.querySelector('i')!.getBoundingClientRect()
          return { dy: Math.abs(caret.y + caret.height / 2 - glyph.y - glyph.height / 2), dx: caret.x - glyph.right, overflow: el.scrollWidth > el.clientWidth }
        })
        expect(geometry.dy).toBeLessThanOrEqual(2)
        expect(geometry.dx).toBeGreaterThanOrEqual(-1)
        expect(geometry.dx).toBeLessThanOrEqual(6)
        expect(geometry.overflow).toBe(false)
        expect(await page.evaluate(() => (window as any).residents.find((row: any) => row.workId === 'work-1').conversation.items[0].text)).toBe(expectedText)
      }
    }
    await mkdir(`${compactArtifacts}/caret`, { recursive: true })
    for (const theme of ['dark', 'white', 'planche']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
      await card.screenshot({ path: `${compactArtifacts}/caret/${theme}.png` })
    }
    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect(await card.locator('[data-worker-stream] i').evaluate(el => getComputedStyle(el).animationName)).toBe('none')
  } finally { await page.close() }
})

it('shows live commands collapsed, shows the actual dispatched prompt on expand, and drops stale command state', async () => {
  const page = await browser.newPage({ viewport: { width: 400, height: 950 } })
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  try {
    await page.route('http://127.0.0.1/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script }); await expandWorkerDetails(page)
    const card = page.locator('[data-presentation="status"][data-work-id="work-1"]')
    await card.waitFor()
    await page.evaluate(() => {
      const w = window as any, worker = w.residents.find((row: any) => row.workId === 'work-1')
      worker.conversation.connection = 'ready'; worker.conversation.turnId = 'current'
      worker.conversation.items.push({ id: 'reply', type: 'agentMessage', turnId: 'current', status: 'inProgress', text: 'LATEST REPLY\n'.repeat(40) })
      worker.conversation.items.push({ id: 'command', type: 'commandExecution', turnId: 'current', status: 'inProgress', text: 'npm test\n' + 'Running 1 test\n'.repeat(40) })
      w.listeners.worker(worker)
    })
    await page.waitForFunction(() => document.querySelector('[data-work-id="work-1"] [data-worker-stream]')?.textContent?.includes('npm test'))
    expect(await card.locator('button[aria-controls^="worker-prompt-"]').getAttribute('aria-expanded')).toBe('false')
    expect(await card.locator('[data-worker-stream]').getAttribute('data-running')).toBe('true')
    const reply = card.locator('[data-worker-reply]'), command = card.locator('[data-worker-stream]')
    const outputToggle = card.getByRole('button', { name: 'Latest output', exact: true }), commandToggle = card.getByRole('button', { name: 'Current command', exact: true })
    expect(await outputToggle.getAttribute('aria-expanded')).toBe('false')
    expect(await commandToggle.getAttribute('aria-expanded')).toBe('false')
    expect(await command.evaluate(el => el.closest('[aria-hidden]')?.getBoundingClientRect().height)).toBe(0)
    await outputToggle.click(); await commandToggle.click()
    await expect.poll(async () => (await command.boundingBox())!.height).toBe(220)
    expect(await reply.innerText()).toContain('LATEST REPLY')
    expect(await reply.innerText()).not.toContain('npm test')
    expect(await command.innerText()).not.toContain('LATEST REPLY')
    for (const [panel, height] of [[reply, 112], [command, 220]] as const) {
      expect(await panel.evaluate(el => ({ height: el.getBoundingClientRect().height, overflow: getComputedStyle(el).overflowY, scrolls: el.scrollHeight > el.clientHeight }))).toEqual({ height, overflow: 'auto', scrolls: true })
      await panel.click()
      expect(await card.locator('button[aria-controls^="worker-prompt-"]').getAttribute('aria-expanded')).toBe('false')
      await panel.focus(); await page.keyboard.press('Home')
    }
    expect((await reply.boundingBox())!.y).toBeLessThan((await command.boundingBox())!.y)
    expect(await reply.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(await command.evaluate(el => getComputedStyle(el).backgroundColor))
    await commandToggle.locator('svg').click()
    await expect.poll(() => command.evaluate(el => el.closest('[aria-hidden]')?.getBoundingClientRect().height)).toBe(0)
    expect(await command.evaluate(el => (el.closest('[aria-hidden]') as HTMLElement).inert)).toBe(true)
    expect(await outputToggle.getAttribute('aria-expanded')).toBe('true')
    await commandToggle.press('Enter')
    await expect.poll(async () => (await command.boundingBox())!.height).toBe(220)
    await commandToggle.press('Space')
    await expect.poll(() => command.evaluate(el => el.closest('[aria-hidden]')?.getBoundingClientRect().height)).toBe(0)

    await card.locator('button[aria-controls^="worker-prompt-"]').focus(); await page.keyboard.press('Enter')
    await card.locator('[data-worker-prompt]').waitFor()
    expect(await card.locator('[data-worker-prompt]').innerText()).toContain('Goal: Implement the discussed plan')
    expect(await card.locator('[data-worker-prompt]').innerText()).not.toContain('Original user instruction')
    expect(await card.innerText()).not.toContain('HOST_PRIVATE_SUPPLEMENT')
    expect(await card.locator('details [data-worker-prompt]').count()).toBe(0)
    await mkdir(reportArtifacts, { recursive: true })
    for (const theme of ['dark', 'white', 'planche']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
      await card.screenshot({ path: `${reportArtifacts}/worker-${theme}.png` })
      expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    }
    await card.locator('button[aria-controls^="worker-prompt-"]').click()
    await page.evaluate(() => {
      const w = window as any, worker = w.residents.find((row: any) => row.workId === 'work-1')
      worker.conversation.items.at(-1).text += '\nNEW OUTPUT'; w.listeners.worker(worker)
    })
    await page.waitForFunction(() => document.querySelector('[data-work-id="work-1"] [data-worker-stream]')?.textContent?.includes('NEW OUTPUT'))
    await page.evaluate(() => { const w = window as any, worker = w.residents.find((row: any) => row.workId === 'work-1'); worker.phase = 'failed'; w.listeners.worker(worker) })
    await page.waitForFunction(() => document.querySelector('[data-work-id="work-1"] [data-worker-stream]')?.getAttribute('data-running') === 'false')
    expect(await card.locator('[data-worker-stream]').innerText()).not.toContain('npm test')
    expect(errors).toEqual([])
  } finally { await page.close() }
})

it('renders native command output deltas before completion through published worker snapshots', async () => {
  const page = await browser.newPage({ viewport: { width: 400, height: 950 } })
  let published: ConversationSnapshot | undefined
  const controller = new CodexConversation('command-stream', snapshot => { published = snapshot }), wire = controller as any
  const emit = (method: string, params: object) => wire.receive({ method, params: { threadId: 'main', turnId: 'current', ...params } })
  const deliver = async () => {
    expect(published).toBeDefined()
    await page.evaluate(snapshot => {
      const w = window as any, worker = w.residents.find((row: any) => row.workId === 'work-1')
      worker.conversation = snapshot; w.listeners.worker(worker)
    }, published!)
  }
  try {
    await page.route('http://127.0.0.1/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script }); await expandWorkerDetails(page)
    const card = page.locator('[data-presentation="status"][data-work-id="work-1"]'), command = card.locator('[data-worker-stream]')
    await card.getByRole('button', { name: 'Current command', exact: true }).click()
    wire.attach({ id: 'main', turns: [] })
    emit('turn/started', { turn: { id: 'current' } })
    emit('item/started', { item: { id: 'command', type: 'commandExecution', command: 'npm test', status: 'inProgress' } })
    await deliver()
    await expect.poll(() => command.innerText()).toBe('$ npm test')
    for (const delta of ['Test 1 passed\n', 'Test 2 passed\n']) {
      const previous = published
      emit('item/commandExecution/outputDelta', { itemId: 'command', delta })
      await expect.poll(() => published, { timeout: 1000 }).not.toBe(previous)
      await deliver()
      await expect.poll(() => command.innerText()).toContain(delta.trim())
      expect(await command.getAttribute('data-running')).toBe('true')
    }
    expect(await command.innerText()).toBe('$ npm test\nTest 1 passed\nTest 2 passed')
    emit('item/completed', { item: { id: 'command', type: 'commandExecution', command: 'npm test', status: 'completed', aggregatedOutput: 'Test 1 passed\nTest 2 passed\n' } })
    await deliver()
    await expect.poll(() => command.getAttribute('data-running')).toBe('false')
    expect(await command.innerText()).not.toContain('npm test')
    expect(controller.snapshot().items.at(-1)?.text).toBe('npm test\nTest 1 passed\nTest 2 passed\n')
  } finally { await controller.dispose(); await page.close() }
})

it('keeps long reports compact and opens the complete original in an accessible dialog', async () => {
  const page = await browser.newPage({ viewport: { width: 900, height: 800 } })
  try {
    await page.route('http://127.0.0.1/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script }); await expandWorkerDetails(page)
    await page.locator('[data-work-id="work-1"]').waitFor()
    await page.evaluate(() => (window as any).mountReport())
    const card = page.locator('[data-worker-report]'); await card.waitFor()
    expect((await card.boundingBox())!.height).toBeLessThan(220)
    await card.getByRole('button', { name: 'View report' }).click()
    await page.getByRole('button', { name: 'Enlarge report' }).click()
    await page.getByRole('dialog').waitFor()
    await page.getByRole('button', { name: 'View original report', exact: true }).click()
    expect(await page.getByRole('dialog').locator('pre').innerText()).toContain('EXACT_END')
    await mkdir(reportArtifacts, { recursive: true })
    await page.getByRole('dialog').screenshot({ path: `${reportArtifacts}/report-dialog.png` })
    await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' })
    await page.keyboard.press('Escape'); await page.locator('[data-worker-report-drawer]').waitFor({ state: 'hidden' })
    await expect.poll(() => card.getByRole('button', { name: 'View report' }).evaluate(el => el === document.activeElement)).toBe(true)
  } finally { await page.close() }
})

it('centers the shared report reader from sidebar and output messages despite the application margin reset', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  try {
    await page.route('http://127.0.0.1/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/')
    await page.addStyleTag({ content: '*,::before,::after { margin: 0; padding: 0; box-sizing: border-box; }' })
    await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script }); await expandWorkerDetails(page)
    const sidebar = page.getByRole('article', { name: 'Feature 4', exact: true })
    await sidebar.waitFor()
    await page.evaluate(() => {
      const w = window as any, read = w.electron.superAgent.readResource
      w.reportReads = []; w.electron.superAgent.readResource = async (...args: unknown[]) => { w.reportReads.push(args); return read(...args) }
      w.mountReport()
    })
    const message = page.locator('[data-worker-report]'); await message.waitFor()
    await mkdir(reportArtifacts, { recursive: true })
    expect(await page.locator('[data-work-id="work-1"]').getByRole('button', { name: 'View report', exact: true }).count()).toBe(0)
    for (const viewport of [{ width: 1440, height: 900 }, { width: 320, height: 600 }]) {
      await page.setViewportSize(viewport)
      for (const [source, card] of [['sidebar', sidebar], ['message', message]] as const) {
        const trigger = card.getByRole('button', { name: 'View report', exact: true })
        if (source === 'sidebar') {
          expect(await trigger.innerText()).toBe('')
          expect(await trigger.locator('svg').count()).toBe(1)
          expect(await trigger.getAttribute('title')).toBe('View report')
          expect(await trigger.getAttribute('aria-expanded')).toBe('false')
          const triggerBox = (await trigger.boundingBox())!, closeBox = (await card.locator('[data-worker-header] > button').last().boundingBox())!
          expect(triggerBox.width).toBe(28); expect(triggerBox.height).toBe(28)
          expect(triggerBox.y).toBe(closeBox.y)
          expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
          expect(await trigger.evaluate(el => {
            const card = el.closest('article')!, height = card.getBoundingClientRect().height
            el.style.display = 'none'
            const difference = card.getBoundingClientRect().height - height
            el.style.removeProperty('display')
            return difference
          })).toBe(0)
          await trigger.focus(); await page.keyboard.press('Enter')
        } else await trigger.click()
        expect(await page.getByRole('dialog').count()).toBe(0)
        // A closing reader may still be painting its exit; only the active one is interactive.
        await page.locator('[data-report-reveal][aria-hidden=false] [data-worker-report-drawer]').waitFor()
        await page.getByRole('button', { name: 'Enlarge report' }).click()
        const dialog = page.getByRole('dialog'); await dialog.waitFor()
        if (source === 'sidebar') await dialog.getByText('Persisted Worker result', { exact: true }).waitFor()
        else { await dialog.getByRole('button', { name: 'View original report', exact: true }).click(); expect(await dialog.locator('pre').innerText()).toContain('EXACT_END') }
        for (const theme of ['dark', 'white', 'planche']) {
          await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
          expect(await dialog.evaluate(el => {
            const r = el.getBoundingClientRect()
            return Math.abs(r.left + r.width / 2 - innerWidth / 2) < 2 && Math.abs(r.top + r.height / 2 - innerHeight / 2) < 2
              && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && el.scrollWidth <= el.clientWidth
          })).toBe(true)
          await page.screenshot({ path: `${reportArtifacts}/${source}-${viewport.width}-${theme}.png` })
        }
        if (source === 'sidebar') await dialog.getByRole('button', { name: 'Close report', exact: true }).click()
        else { await page.keyboard.press('Escape'); await page.keyboard.press('Escape') }
        await dialog.waitFor({ state: 'hidden' }); await expect.poll(() => trigger.evaluate(el => el === document.activeElement)).toBe(true)
        if (source === 'sidebar') {
          for (const theme of ['dark', 'white', 'planche']) {
            await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
            await sidebar.screenshot({ path: `${reportArtifacts}/sidebar-icon-${viewport.width}-${theme}.png` })
          }
        }
      }
    }
    expect(await page.evaluate(() => (window as any).reportReads)).toEqual([['workspace', 'report-body'], ['workspace', 'report-body']])
    expect(errors).toEqual([])
  } finally { await page.close() }
})

it('keeps model and prompt tools on one line and edits models in an anchored popover at narrow width', async () => {
  const page = await browser.newPage({ viewport: { width: 320, height: 480 } })
  try {
    await page.route('http://127.0.0.1/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/'); await page.addStyleTag({ content: '*,::before,::after { margin: 0; padding: 0; }' }); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script }); await expandWorkerDetails(page)
    const card = page.locator('[data-presentation="status"][data-work-id="work-0"]')
    await card.waitFor()
    await page.evaluate(() => {
      const w = window as any, worker = w.residents[0]
      worker.conversation.model = 'model-with-a-very-long-provider-and-version-name'
      worker.conversation.effort = 'high'
      worker.conversation.models = [
        { model: worker.conversation.model, displayName: 'Current model', efforts: [{ effort: 'high' }], defaultEffort: 'high' },
        { model: 'other-model', displayName: 'Other model', efforts: [{ effort: 'low' }, { effort: 'high' }], defaultEffort: 'low' },
      ]
      const current = { selection: { terminal: 'codex', model: null, effort: null }, inherited: true, pending: false }
      w.electron.superAgent.workerSettings = async () => current
      w.electron.superAgent.configureWorker = async (identity: unknown, selection: unknown) => {
        w.calls.push(['model', identity, selection]); return { ...current, selection: selection ?? current.selection, inherited: !selection, pending: true }
      }
      w.electron.superAgent.refreshWorkerModels = async () => { w.calls.push(['refresh-models']); return current }
      w.listeners.worker({ ...worker })
    })
    const model = card.getByRole('button', { name: /^Model settings:/ })
    const prompt = card.getByRole('button', { name: 'Latest dispatched prompt', exact: true })
    await model.waitFor()
    for (const theme of ['dark', 'white', 'planche']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
      expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      expect((await model.boundingBox())!.y).toBe((await prompt.boundingBox())!.y)
      for (const name of ['Stop Worker', 'Close work']) {
        const action = card.getByRole('button', { name, exact: true })
        expect(await action.innerText()).toBe('')
        expect((await action.boundingBox())!.width).toBe(28)
      }
      await mkdir(compactArtifacts, { recursive: true })
      await card.screenshot({ path: `${compactArtifacts}/worker-${theme}.png` })
    }
    expect((await card.locator('[data-worker-stream]').boundingBox())!.height).toBeLessThanOrEqual(46)
    await model.focus(); await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'Model settings', exact: true })
    await dialog.waitFor()
    const anchor = await model.boundingBox(), panel = await dialog.boundingBox()
    expect(Math.min(Math.abs(panel!.y + panel!.height + 6 - anchor!.y), Math.abs(panel!.y - anchor!.y - anchor!.height - 6))).toBeLessThan(2)
    expect(await dialog.evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && el.scrollWidth <= el.clientWidth })).toBe(true)
    await dialog.getByRole('button', { name: 'Model', exact: true }).click()
    await dialog.getByRole('option', { name: 'Other model', exact: true }).click()
    await dialog.getByRole('button', { name: 'Reasoning', exact: true }).click()
    await page.keyboard.press('Escape')
    expect(await dialog.isVisible()).toBe(true)
    expect(await dialog.getByRole('listbox').count()).toBe(0)
    await dialog.getByRole('button', { name: 'Apply next turn', exact: true }).click()
    expect(await page.evaluate(() => (window as any).calls.find((row: any) => row[0] === 'model'))).toEqual(['model', { workspaceId: 'workspace', workId: 'work-0', executionId: 'execution-0' }, { terminal: 'codex', model: 'other-model', effort: 'low' }])
    await dialog.screenshot({ path: `${compactArtifacts}/model-popover.png` })
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' })
    expect(await model.evaluate(el => el === document.activeElement)).toBe(true)
    await card.getByRole('button', { name: 'Stop Worker', exact: true }).click()
    expect(await page.evaluate(() => (window as any).calls.find((row: any) => row[0] === 'work-control')[1])).toMatchObject({ workId: 'work-0', action: 'stop' })
  } finally { await page.close() }
})

it('anchors model settings to the right-hand trigger and follows scroll and resize without covering the viewport origin', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  try {
    await page.route('http://127.0.0.1/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script }); await expandWorkerDetails(page)
    const card = page.locator('[data-presentation="status"][data-work-id="work-0"]')
    await card.waitFor()
    await card.evaluate(el => { Object.assign((el as HTMLElement).style, { position: 'fixed', right: '24px', bottom: '24px', width: '300px' }) })
    const trigger = card.getByRole('button', { name: /^Model settings:/ }), panel = page.getByRole('dialog', { name: 'Model settings', exact: true })
    const checkAnchor = async () => {
      await expect.poll(async () => {
        const anchor = await trigger.boundingBox(), box = await panel.boundingBox()
        if (!anchor || !box) return false
        return Math.min(Math.abs(box.y + box.height + 6 - anchor.y), Math.abs(box.y - anchor.y - anchor.height - 6)) < 2
          && box.x >= 12 && box.y >= 12 && box.x + box.width <= page.viewportSize()!.width - 12 && box.y + box.height <= page.viewportSize()!.height - 12
      }).toBe(true)
    }
    await trigger.click(); await checkAnchor()
    const initialAnchor = await trigger.boundingBox(), initialPanel = await panel.boundingBox()
    expect(Math.abs(initialPanel!.x + initialPanel!.width - initialAnchor!.x - initialAnchor!.width)).toBeLessThan(2)
    await card.evaluate(el => { (el as HTMLElement).style.bottom = '124px'; window.dispatchEvent(new Event('scroll')) })
    await checkAnchor()
    await page.setViewportSize({ width: 1000, height: 750 }); await checkAnchor()
    await mkdir(settingsArtifacts, { recursive: true })
    for (const theme of ['dark', 'white', 'planche']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
      await page.screenshot({ path: `${settingsArtifacts}/anchored-${theme}.png` })
    }
    await page.mouse.click(20, 20); await panel.waitFor({ state: 'hidden' })
    await trigger.click(); await checkAnchor(); await page.keyboard.press('Escape')
    await panel.waitFor({ state: 'hidden' }); expect(await trigger.evaluate(el => el === document.activeElement)).toBe(true)
    expect(errors).toEqual([])
  } finally { await page.close() }
})

it('explains excluded existing changes before approving an isolated worktree', async () => {
  const page = await browser.newPage()
  try {
    await page.route('http://127.0.0.1/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script }); await expandWorkerDetails(page)
    await page.getByRole('article', { name: 'Feature 0', exact: true }).waitFor()
    await page.evaluate(() => {
      (window as any).operations = [{ id: 'create', workId: 'work-0', status: 'pending', plan: { kind: 'create',
        targetPath: 'C:/project-isolated', branch: 'janus/release', baseRef: 'dev', baseCommit: 'commit', source: { dirty: true } } }];
      (window as any).listeners.environment?.({ workspaceId: 'workspace' })
    })
    await page.getByText('Uncommitted changes and new files in the original directory are excluded.', { exact: false }).waitFor()
    await page.getByRole('button', { name: 'Create and start', exact: true }).waitFor()
    expect(await page.evaluate(() => (window as any).calls)).toEqual([])
  } finally { await page.close() }
})

it('loads failure evidence with details collapsed and requires an inline close confirmation', async () => {
  const page = await browser.newPage()
  try {
    await page.route('http://127.0.0.1/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script }); await expandWorkerDetails(page)
    await page.getByRole('article', { name: 'Feature 0', exact: true }).waitFor()
    await page.evaluate(() => { (window as any).failureLog = 'Native connection failed'; (window as any).publish('failed') })
    const card = page.getByRole('article', { name: 'Feature 0', exact: true })
    await card.getByRole('alert').filter({ hasText: 'Native connection failed' }).waitFor()
    expect(await card.locator('button[aria-controls^="worker-prompt-"]').getAttribute('aria-expanded')).toBe('false')
    await card.getByRole('button', { name: 'Close work' }).click()
    expect(await card.getByRole('button', { name: 'Close work', exact: true }).count()).toBe(0)
    expect(await card.getByRole('button', { name: 'Cancel', exact: true }).evaluate(el => el === document.activeElement)).toBe(true)
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Close work')
    expect(await page.evaluate(() => (window as any).calls.length)).toBe(0)
    await card.getByRole('button', { name: 'Close work' }).click()
    await card.getByRole('button', { name: 'Cancel', exact: true }).click()
    await card.getByRole('button', { name: 'Close work' }).click()
    expect(await page.evaluate(() => (window as any).calls.some((c: any) => c[1]?.action === 'close'))).toBe(false)
    await card.getByRole('button', { name: 'Confirm close', exact: true }).click()
    expect(await card.count()).toBe(1)
    expect(await card.getAttribute('data-phase')).toBe('failed')
    expect(await card.getByRole('button', { name: 'Stop Worker', exact: true }).isEnabled()).toBe(true)
    await mkdir('artifacts/superagent-topics', { recursive: true })
    await page.screenshot({ path: 'artifacts/superagent-topics/worker-stopping.png', fullPage: true })
  } finally { await page.close() }
})

it('clears a refresh failure after recovery without hiding an action failure', async () => {
  const page = await browser.newPage()
  try {
    await page.route('http://127.0.0.1/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/'); await page.addScriptTag({ content: script }); await expandWorkerDetails(page)
    await page.getByRole('article', { name: 'Feature 0', exact: true }).waitFor()
    await page.evaluate(() => {
      const w = window as any, original = w.electron.superAgent.snapshot
      w.electron.superAgent.snapshot = async (...args: any[]) => {
        w.electron.superAgent.snapshot = original
        throw new Error('Temporary refresh failure')
      }
    })
    // The action succeeds, but its follow-up read fails. The read error must not
    // become a permanent card-level action error.
    await page.getByRole('article', { name: 'Feature 0', exact: true }).getByRole('button', { name: 'Stop Worker', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Temporary refresh failure' }).waitFor()
    await page.evaluate(() => (window as any).listeners.record({ workspaceId: 'workspace' }))
    await page.getByRole('alert').filter({ hasText: 'Temporary refresh failure' }).waitFor({ state: 'hidden' })
    await page.evaluate(() => {
      const w = window as any
      w.electron.superAgent.controlWork = async () => { throw new Error('Worker control rejected') }
    })
    await page.getByRole('article', { name: 'Feature 0', exact: true }).getByRole('button', { name: 'Stop Worker', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Worker control rejected' }).waitFor()
    await page.evaluate(() => (window as any).publish())
    await page.getByRole('radio', { name: 'Yes', exact: true }).waitFor()
    expect(await page.getByRole('alert').innerText()).toContain('Worker control rejected')
  } finally { await page.close() }
})

it('ignores an older failed refresh after a newer success and after a workspace switch', async () => {
  const page = await browser.newPage()
  try {
    await page.route('http://127.0.0.1/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/'); await page.addScriptTag({ content: script }); await expandWorkerDetails(page)
    await page.getByRole('article', { name: 'Feature 0', exact: true }).waitFor()
    const deferRead = () => page.evaluate(() => {
      const w = window as any, original = w.electron.superAgent.snapshot
      w.electron.superAgent.snapshot = (...args: any[]) => {
        w.electron.superAgent.snapshot = original
        return new Promise((_resolve, reject) => { w.rejectRead = reject })
      }
      w.listeners.record({ workspaceId: 'workspace' })
    })
    await deferRead()
    await page.evaluate(() => (window as any).publish())
    await page.getByRole('radio', { name: 'Yes', exact: true }).waitFor()
    await page.evaluate(async () => { (window as any).rejectRead(new Error('Stale read failed')); await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(await page.getByRole('alert').count()).toBe(0)
    await deferRead()
    await page.evaluate(() => (window as any).switchWorkspace('another-workspace'))
    await page.getByRole('article').first().waitFor({ state: 'hidden' })
    await page.evaluate(async () => { (window as any).rejectRead(new Error('Previous workspace failed')); await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(await page.getByRole('alert').count()).toBe(0)
  } finally { await page.close() }
})

it('does not let an older successful read dismiss the latest refresh failure', async () => {
  const page = await browser.newPage()
  try {
    await page.route('http://127.0.0.1/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/'); await page.addScriptTag({ content: script }); await expandWorkerDetails(page)
    await page.getByRole('article', { name: 'Feature 0', exact: true }).waitFor()
    await page.evaluate(() => {
      const w = window as any, original = w.electron.superAgent.snapshot
      w.electron.superAgent.snapshot = (...args: any[]) => {
        w.electron.superAgent.snapshot = async () => { throw new Error('Latest refresh failed') }
        return new Promise(resolve => { w.resolveRead = () => resolve(original(...args)) })
      }
      w.listeners.record({ workspaceId: 'workspace' })
      w.listeners.record({ workspaceId: 'workspace' })
    })
    await page.getByRole('alert').filter({ hasText: 'Latest refresh failed' }).waitFor()
    await page.evaluate(async () => { (window as any).resolveRead(); await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(await page.getByRole('alert').innerText()).toContain('Latest refresh failed')
  } finally { await page.close() }
})

it('shows an environment block without a native execution in both status and decisions', async () => {
  const page = await browser.newPage()
  try {
    await page.route('http://127.0.0.1/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script }); await expandWorkerDetails(page)
    await page.getByRole('article', { name: 'Feature 2', exact: true }).waitFor()
    await page.evaluate(() => (window as any).blockBeforeLaunch())
    await page.getByRole('group', { name: 'Feature 2', exact: true }).getByText('Environment blocked', { exact: true }).waitFor()
    await page.getByRole('article', { name: 'Feature 2', exact: true }).getByText('Environment blocked', { exact: true }).waitFor()
  } finally { await page.close() }
})

it('explains occupied environments with equal borders and usable close controls at sidebar width', async () => {
  const page = await browser.newPage({ viewport: { width: 312, height: 1000 } })
  try {
    await page.route('http://127.0.0.1/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script }); await expandWorkerDetails(page)
    await page.getByRole('article', { name: 'Feature 2', exact: true }).waitFor()
    const diagnostic = 'Environment preparation blocked before worker launch: Error: Environment is occupied by an active worker or terminal. Resolve the environment and send a new explicit continuation.'
    await page.evaluate(diagnostic => {
      const w = window as any, original = w.electron.superAgent.schedule
      const workDetail = w.electron.superAgent.workDetail
      w.electron.superAgent.workDetail = async (...args: any[]) => {
        const detail = await workDetail(...args)
        if (detail.work.id === 'work-2') detail.work.environmentSelection = { path: 'C:/projects/current-work', includeChanges: true }
        return detail
      }
      w.electron.superAgent.schedule = async (...args: any[]) => {
        const snapshot = await original(...args)
        snapshot.entries.find((row: any) => row.workId === 'work-2').diagnostic = diagnostic
        return snapshot
      }
      w.blockBeforeLaunch()
    }, diagnostic)
    const card = page.getByRole('article', { name: 'Feature 2', exact: true })
    const decision = page.getByRole('group', { name: 'Feature 2', exact: true })
    await card.getByText('Work directory occupied; Worker has not started', { exact: true }).waitFor()
    expect(await card.locator('code').innerText()).toBe('C:/projects/current-work')
    expect(await card.getByRole('button', { name: 'Stop Worker', exact: true }).count()).toBe(0)
    for (const theme of ['dark', 'white', 'planche']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
      for (const view of [card, decision]) {
        const borders = await view.getByRole('alert').evaluate(el => {
          const s = getComputedStyle(el)
          return [s.borderLeftWidth, s.borderRightWidth, s.borderTopWidth, s.borderBottomWidth, s.borderLeftColor, s.borderRightColor]
        })
        expect(borders.slice(0, 4)).toEqual(['1px', '1px', '1px', '1px'])
        expect(borders[4]).toBe(borders[5])
        expect(await view.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      }
      await mkdir('artifacts/superagent-errors', { recursive: true })
      await card.screenshot({ path: `artifacts/superagent-errors/occupied-${theme}.png` })
      await card.getByRole('button', { name: 'Close work', exact: true }).click()
      const close = card.getByRole('group', { name: 'Confirm close', exact: true })
      expect(await close.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      await card.screenshot({ path: `artifacts/superagent-errors/close-${theme}.png` })
      await close.getByRole('button', { name: 'Cancel', exact: true }).click()
    }
    await card.getByText('View original error', { exact: true }).click()
    expect(await card.locator('pre').innerText()).toBe(diagnostic)
    expect(await page.evaluate(() => (window as any).calls)).toEqual([])
  } finally { await page.close() }
})

it('shows occupancy without sidebar editing, configures capacity in Settings, and preserves work controls and drafts', async () => {
  const page = await browser.newPage({ viewport: { width: 860, height: 780 } })
  try {
    await page.route('http://127.0.0.1/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script }); await expandWorkerDetails(page)
    await page.getByRole('textbox', { name: 'Draft' }).fill('Implement the feature')
    await page.getByRole('article', { name: 'Feature 4' }).waitFor()
    expect(await page.getByRole('article').count()).toBe(5)
    await page.getByRole('article', { name: 'Feature 1' }).getByRole('button', { name: 'Latest output', exact: true }).click()
    await expect.poll(() => page.getByRole('article', { name: 'Feature 1' }).innerText()).toContain('Checking greeting behavior')
    expect(await page.getByText('HOST_PRIVATE_SUPPLEMENT', { exact: true }).count()).toBe(0)
    expect(await page.getByRole('button', { name: 'Run with Worker', exact: true }).count()).toBe(0)
    expect(await page.getByRole('spinbutton', { name: 'Worker concurrency limit' }).count()).toBe(0)
    expect(await page.getByRole('button', { name: 'Save limit' }).count()).toBe(0)
    await page.getByText('3 / 3 active', {exact:true}).waitFor()
    expect(await page.evaluate(() => (window as any).calls.some((row: any) => row[0] === 'capacity'))).toBe(false)
    expect(await page.getByRole('button', { name: 'Configure concurrency in Settings → Agent' }).count()).toBe(0)
    await page.evaluate(() => (window as any).mountAgentSettings())
    const settings = page.getByRole('region', {name:'Worker concurrency',exact:true})
    await expect.poll(() => settings.getByRole('spinbutton').inputValue()).toBe('3')
    await settings.getByRole('spinbutton').fill('4')
    await settings.getByRole('button', { name: 'Save', exact: true }).click()
    await page.waitForFunction(() => (window as any).capacity === 4)
    await page.evaluate(() => (window as any).closeAgentSettings())
    await page.getByText('3 / 4 active', {exact:true}).waitFor()
    await page.getByRole('article', { name: 'Feature 2' }).getByText('Starting', { exact: true }).waitFor()
    await page.evaluate(() => (window as any).publish())
    await page.getByRole('article', { name: 'Feature 4' }).getByRole('button', { name: 'View report' }).click()
    await page.getByText('Persisted Worker result', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Close report' }).click()
    await page.getByRole('radio', { name: 'Yes', exact: true }).check()
    await page.getByRole('textbox', { name: /Your note/ }).fill('custom answer')
    await page.locator('form').getByRole('button', { name: 'Submit answer', exact: true }).click()
    await page.waitForFunction(() => (window as any).calls.some((row: any) => row[0] === 'control' && row[1].type === 'answer'))
    const answer = await page.evaluate(() => (window as any).calls.find((row: any) => row[0] === 'control' && row[1].type === 'answer')[1])
    expect(answer).toMatchObject({ workId: 'work-0', executionId: 'execution', requestId: 23, version: 4,
      answer: { answers: [{ id: 'choice', selected: ['yes'] }, { id: 'notes', selected: [], text: 'custom answer' }] } })
    expect(await page.getByRole('textbox', { name: 'Draft' }).inputValue()).toBe('Implement the feature')
    await mkdir(`${settingsArtifacts}/sidebar`, { recursive: true })
    await page.screenshot({ path: `${settingsArtifacts}/sidebar/worker-chat.png`, fullPage: true })
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
    await expandWorkerDetails(page)
    await page.getByRole('article', { name: 'Feature 0' }).getByRole('button', { name: 'Stop Worker', exact: true }).click()
    await page.waitForFunction(() => (window as any).calls.some((row: any) => row[0] === 'work-control' && row[1].action === 'stop' && row[1].workId==='work-0'))
    await page.getByRole('article', { name: 'Feature 2' }).getByRole('button', { name: 'Close work' }).click()
    await page.getByRole('article', { name: 'Feature 2' }).getByRole('button', { name: 'Confirm close', exact: true }).click()
    await page.getByRole('article', { name: 'Feature 2' }).waitFor({ state: 'hidden' })
    await page.getByRole('article', { name: 'Feature 0' }).getByRole('button', { name: 'Close work' }).click()
    await page.getByRole('article', { name: 'Feature 0' }).getByRole('button', { name: 'Confirm close', exact: true }).click()
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

it('shows the exact trust directory and sends a setup decision for the active execution', async () => {
  const page = await browser.newPage()
  try {
    await page.route('http://127.0.0.1/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script }); await expandWorkerDetails(page)
    await page.getByRole('article', { name: 'Feature 0', exact: true }).waitFor()
    await page.evaluate(() => {
      const w = window as any, row = w.residents.find((item: any) => item.workId === 'work-0')
      row.conversation = { ...row.conversation, controlEpoch: 7, startup: { id: 12, kind: 'trust', status: 'pending', directory: 'C:/existing-dev' } }
      w.listeners.worker(row)
    })
    const setup = page.locator('[data-conversation-startup="trust"]')
    await setup.waitFor(); expect(await setup.innerText()).toContain('C:/existing-dev')
    await setup.locator('button').last().click()
    await page.waitForFunction(() => (window as any).calls.some((row: any) => row[1]?.type === 'startup'))
    const request = await page.evaluate(() => (window as any).calls.find((row: any) => row[1]?.type === 'startup')[1])
    expect(request).toMatchObject({ workId: 'work-0', executionId: 'execution-0', command: { type: 'startup', startupId: 12, action: 'trust', controlEpoch: 7 } })
  } finally { await page.close() }
})

it('selects Claude and Codex defaults independently without changing live Workers', async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } })
  try {
    await page.route('http://127.0.0.1/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script }); await expandWorkerDetails(page)
    await page.getByRole('article', { name: 'Feature 0', exact: true }).waitFor()
    await page.evaluate(() => { (window as any).mountWorkerDefaults() })
    const panel = page.locator('#worker-defaults')
    await page.waitForFunction(() => !(document.getElementById('worker-model-codex') as HTMLButtonElement)?.disabled)
    const codex = panel.getByRole('region', { name: 'Codex', exact: true }), claude = panel.getByRole('region', { name: 'Claude Code', exact: true })
    await claude.getByRole('button', { name: 'Default model', exact: true }).click()
    await page.getByRole('option', { name: 'opus', exact: true }).click()
    await codex.getByRole('button', { name: 'Default model', exact: true }).click()
    await page.getByRole('option', { name: 'codex-model', exact: true }).click()
    await panel.getByRole('button', { name: 'Save', exact: true }).click()
    await page.waitForFunction(() => (window as any).defaultProfiles?.claude.model === 'opus' && (window as any).defaultProfiles?.codex.model === 'codex-model')
    expect(await codex.getByRole('button', { name: 'Default', exact: true }).getAttribute('aria-pressed')).toBe('true')
    await claude.getByRole('checkbox').uncheck()
    await panel.getByRole('button', { name: 'Save', exact: true }).click()
    await page.waitForFunction(() => (window as any).workerPolicy.enabled.length === 1)
    expect(await claude.getByRole('button', { name: 'Default model', exact: true }).isDisabled()).toBe(true)
    expect(await codex.getByRole('checkbox').isDisabled()).toBe(true)
    await claude.getByRole('button', { name: 'Set as default', exact: true }).click()
    await panel.getByRole('button', { name: 'Save', exact: true }).click()
    await page.waitForFunction(() => (window as any).workerPolicy.defaultBackend === 'claude' && (window as any).workerPolicy.enabled.includes('claude'))
    expect(await claude.getByRole('button', { name: 'Default model', exact: true }).innerText()).toContain('opus')
    expect(await page.evaluate(() => (window as any).calls.filter((row: any[]) => row[0] === 'unexpected-llm-models'))).toEqual([])
    // Refresh failure preserves the selected model and supports retry.
    await page.evaluate(() => { (window as any).catalogError = true })
    await claude.getByRole('button', { name: 'Refresh models' }).click()
    await claude.getByText('Models unavailable. Try refreshing.').waitFor()
    expect(await claude.getByRole('button', { name: 'Default model', exact: true }).innerText()).toContain('opus')
    await page.evaluate(() => { (window as any).catalogError = false })
    await claude.getByRole('button', { name: 'Refresh models' }).click()
    await claude.getByText('Models unavailable. Try refreshing.').waitFor({ state: 'hidden' })
    await page.setViewportSize({ width: 360, height: 800 })
    expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    expect(await page.evaluate(() => (window as any).calls.filter((row: any[]) => row[0] === 'worker-settings'))).toEqual([])
    await mkdir(settingsArtifacts, { recursive: true }); await panel.screenshot({ path: settingsArtifacts + '/claude-defaults.png' })
  } finally { await page.close() }
})
