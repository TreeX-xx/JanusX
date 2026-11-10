import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { dailyReviewTemplate, reminderTemplate, type AutomationsAPI } from '../../src/shared/automations'
import type { WorkspaceAPI } from '../../src/shared/ipc/workspace'
import { createDesktopTestEnv, seedIntroducedLearning } from './desktop-test-env'

type Host = Window & { reminderMessages?: string[]; electron: { automations: AutomationsAPI; workspace: WorkspaceAPI; system: { setLanguage(language: string): Promise<void> } } }

test('desktop card contains independently editable tasks and persists changes through IPC', async () => {
  test.setTimeout(90_000)
  const directory = await mkdtemp(join(tmpdir(), 'janusx-task-edit-'))
  let application: ElectronApplication | undefined
  try {
    application = await electron.launch({ args: [resolve(process.env.JANUS_DESKTOP_ENTRY ?? 'out/main/index.js'), `--user-data-dir=${join(directory, 'profile')}`], env: createDesktopTestEnv(directory) })
    await seedIntroducedLearning(application.context())
    const page = await application.firstWindow()
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 900))
    await page.waitForFunction(() => Boolean(window.electron?.automations))
    await page.evaluate(() => window.electron.system.setLanguage('en')); await page.reload()
    const card = await page.evaluate(input => window.electron.automations.save(input), { ...reminderTemplate('Original reminder'), name: 'Task editing fixture', intervalMinutes: 30 })
    await page.getByRole('button', { name: /^Automations, / }).click()
    const title = page.getByRole('button', { name: 'Task editing fixture', exact: true })
    await title.click()
    await expect(title).toHaveAttribute('aria-expanded', 'true')
    await title.click()
    await expect(title).toHaveAttribute('aria-expanded', 'false')
    await title.click()
    await page.getByRole('button', { name: 'Edit task', exact: true }).click()
    await expect(page.getByLabel('Task name', { exact: true })).toHaveValue('Task editing fixture')
    await expect(page.getByLabel('Interval (minutes)', { exact: true })).toHaveValue('30')
    await page.getByRole('textbox', { name: 'Notification message', exact: true }).fill('Updated task reminder')
    await page.screenshot({ path: 'artifacts/automations/task-edit-desktop.png' })
    await page.getByRole('button', { name: 'Save task', exact: true }).click()
    await expect(title).toHaveAttribute('aria-expanded', 'true')
    let saved = await page.evaluate(async id => (await window.electron.automations.list()).find(card => card.id === id)!, card.id)
    expect(saved).toMatchObject({ name: card.name, enabled: false, intervalMinutes: 30, tasks: [{ id: 'notify', message: 'Updated task reminder' }] })
    await page.getByRole('button', { name: 'Edit task', exact: true }).click()
    await page.getByLabel('Interval (minutes)', { exact: true }).fill('45')
    await page.getByRole('button', { name: 'Save task', exact: true }).click()
    await expect(page.locator('.automation-card')).toContainText('45 minutes')
    await page.getByRole('button', { name: 'Add task', exact: true }).click()
    await page.getByRole('button', { name: 'Interval reminder', exact: true }).click()
    await page.getByLabel('Task name', { exact: true }).fill('Sibling task')
    await page.getByLabel('Notification message', { exact: true }).fill('Separate reminder')
    await page.getByLabel('Interval (minutes)', { exact: true }).fill('10')
    await page.getByRole('button', { name: 'Save task', exact: true }).click()
    await expect(page.locator('.automation-card')).toHaveCount(1)
    await expect(page.locator('.automation-task-card')).toHaveCount(2)
    await page.reload()
    saved = await page.evaluate(async id => (await window.electron.automations.list()).find(card => card.id === id)!, card.id)
    expect(saved).toMatchObject({ name: card.name, enabled: false, intervalMinutes: 45, tasks: [{ id: 'notify', message: 'Updated task reminder' }] })
    expect(await page.evaluate(async () => (await window.electron.automations.list())[1])).toMatchObject({ cardId: card.cardId, name: 'Sibling task', intervalMinutes: 10, enabled: false })
  } finally {
    await application?.close()
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe cleanup')
    await rm(directory, { recursive: true, force: true })
  }
})

test('desktop card deletion clears its durable record and Island notification while preserving another card', async () => {
  test.setTimeout(90_000)
  const directory = await mkdtemp(join(tmpdir(), 'janusx-delete-card-'))
  let application: ElectronApplication | undefined
  try {
    application = await electron.launch({ args: [resolve(process.env.JANUS_DESKTOP_ENTRY ?? 'out/main/index.js'), `--user-data-dir=${join(directory, 'profile')}`], env: createDesktopTestEnv(directory) })
    await seedIntroducedLearning(application.context())
    const page = await application.firstWindow()
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 900))
    await page.waitForFunction(() => Boolean(window.electron?.automations))
    await page.evaluate(() => window.electron.system.setLanguage('en')); await page.reload()
    const input = { ...reminderTemplate('Delete this reminder'), name: 'Delete card fixture', enabled: true, intervalMinutes: 30 }
    const card = await page.evaluate(input => window.electron.automations.save(input), input)
    const keep = await page.evaluate(input => window.electron.automations.save(input), { ...input, name: 'Keep card fixture', enabled: false })
    await page.getByRole('button', { name: /^Automations, / }).click()
    const target = page.locator('.automation-card').filter({ has: page.getByRole('button', { name: 'Delete card fixture', exact: true }) })
    await target.getByRole('button', { name: 'Run now', exact: true }).click()
    await expect(target.locator('.automation-report')).toContainText('Delete this reminder')
    await expect(page.getByRole('button', { name: 'Notifications, 1 unread', exact: true })).toBeVisible()
    await target.getByRole('button', { name: 'Delete card', exact: true }).click()
    await page.getByRole('dialog', { name: 'Delete “Delete card fixture”?', exact: true }).getByRole('button', { name: 'Delete card', exact: true }).click()
    await expect(target).toHaveCount(0)
    await expect(page.locator('.automation-card')).toHaveCount(1)
    await expect(page.locator('.janus-unread-rim')).toHaveCount(0)
    await expect(page.locator('.janus-island-shell')).toHaveAttribute('data-speaking', 'false')
    expect(await page.evaluate(id => window.electron.automations.history(id), card.id)).toEqual([])
    expect(await page.evaluate(async () => (await window.electron.automations.list()).map(card => card.id))).toEqual([keep.id])
    await page.reload()
    await page.getByRole('button', { name: /^Automations, / }).click()
    await expect(page.locator('.automation-card')).toHaveCount(1)
    await expect(page.locator('.automation-card')).toContainText('Keep card fixture')
    await page.screenshot({ path: 'artifacts/automations/delete-desktop.png' })
  } finally {
    await application?.close()
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe cleanup')
    await rm(directory, { recursive: true, force: true })
  }
})

test('Island reminder tool result reaches the real right panel through desktop IPC', async () => {
  test.setTimeout(90_000)
  const directory = await mkdtemp(join(tmpdir(), 'janusx-reminder-chat-'))
  let application: ElectronApplication | undefined
  let calls = 0
  const failures: string[] = []
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!body.stream) {
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify({ id: 'health', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }] }))
        return
      }
      expect(body.tools.map((tool: { function: { name: string } }) => tool.function.name)).toContain('automation_reminder')
      const first = calls++ === 0
      if (!first) expect(JSON.stringify(body.messages)).toContain('Draft ready')
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const emit = (delta: unknown, finish_reason: string | null) => response.write(`data: ${JSON.stringify({ id: 'reminder', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason }] })}\n\n`)
      emit(first ? { role: 'assistant', tool_calls: [{ index: 0, id: 'reminder-call', type: 'function', function: { name: 'automation_reminder', arguments: JSON.stringify({ action: 'propose', name: 'Check phone', message: 'Check your phone', schedule: 'interval', intervalMinutes: 1 }) } }] } : { role: 'assistant', content: 'Reminder draft ready in the right panel.' }, null)
      emit({}, first ? 'tool_calls' : 'stop')
      response.end('data: [DONE]\n\n')
    } catch (error) { failures.push(String(error)); response.statusCode = 500; response.end('Fixture failed') }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    application = await electron.launch({ args: [resolve(process.env.JANUS_DESKTOP_ENTRY ?? 'out/main/index.js'), `--user-data-dir=${join(directory, 'profile')}`], env: createDesktopTestEnv(directory) })
    await seedIntroducedLearning(application.context())
    const page = await application.firstWindow()
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 900))
    await page.waitForFunction(() => Boolean(window.electron?.automations))
    await page.evaluate(() => window.electron.system.setLanguage('en'))
    const address = server.address() as { port: number }
    await page.evaluate(async baseURL => {
      const saved = await window.electron.llm.saveTerminalProvider('janus', { id: 'openai-compatible', name: 'Local reminder fixture', authType: 'api-key' as never,
        enabled: true, apiKey: 'fixture-key', baseURL, modelId: 'fixture-model', models: ['fixture-model'],
        extra: { protocol: 'chat-completions', chatModelLimits: { 'fixture-model': { contextWindow: 128000, maxOutputTokens: 4096 } } } })
      if (!saved.success) throw new Error(saved.error)
      await window.electron.llm.setTerminalDefault('janus', 'openai-compatible')
    }, `http://127.0.0.1:${address.port}/v1`)
    const memo = await page.evaluate(() => window.electron.memo!.create('Reminder context'))
    await page.reload()
    await page.locator('.janus-island').dblclick()
    await page.getByRole('button', { name: 'Open memo on the right', exact: true }).click()
    await expect(page.locator('.memo-panel')).toBeVisible()
    await page.getByRole('button', { name: 'Reminder context', exact: true }).click()
    await page.locator('.janus-chat-input').fill('生成一个自动化流程，每一分钟提醒我检查一下手机，以通知的形式')
    await page.locator('.janus-chat-input').press('Enter')
    await expect(page.locator('.janus-chat')).toContainText('Reminder draft ready', { timeout: 30_000 })
    expect(failures).toEqual([])
    const panel = page.locator('.automation-panel')
    await expect(panel).toBeVisible()
    await expect(panel).toHaveAttribute('data-island-linked', 'true')
    await expect(page.locator('.memo-panel')).toBeHidden()
    await expect(panel.getByRole('textbox', { name: 'Notification message', exact: true })).toHaveValue('Check your phone')
    await expect(panel.getByLabel('Interval (minutes)', { exact: true })).toHaveValue('1')
    expect(await page.evaluate(() => window.electron.automations.list())).toEqual([])
    await page.getByRole('button', { name: 'Open memo on the right', exact: true }).click()
    await expect(page.locator('.memo-panel')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reminder context', exact: true })).toHaveAttribute('aria-pressed', 'true')
    expect(await page.evaluate(async id => (await window.electron.memo!.list()).find(item => item.id === id), memo.id)).toMatchObject({ id: memo.id, revision: memo.revision })
    await page.locator('.memo-panel').getByRole('button', { name: 'Close', exact: true }).click()
    await page.keyboard.press('Escape')
    await panel.getByRole('button', { name: 'Open Island', exact: true }).click()
    await expect(panel).toHaveAttribute('data-island-linked', 'true')
    await expect(page.locator('.memo-panel')).toBeHidden()
    await panel.getByRole('button', { name: 'Save and enable', exact: true }).click()
    await expect(panel.locator('.automation-card')).toContainText('Check phone')
    await page.screenshot({ path: 'artifacts/automations/chat-reminder-desktop.png' })
  } finally {
    await application?.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe cleanup')
    await rm(directory, { recursive: true, force: true })
  }
})
test('desktop reminder runs on its minute schedule without a project and survives restart disabled', async () => {
  test.setTimeout(180_000)
  const directory = await mkdtemp(join(tmpdir(), 'janusx-reminder-desktop-')), profile = join(directory, 'profile')
  let application: ElectronApplication | undefined
  const launch = async () => {
    application = await electron.launch({ args: [resolve(process.env.JANUS_DESKTOP_ENTRY ?? 'out/main/index.js'), `--user-data-dir=${profile}`], env: createDesktopTestEnv(directory) })
    await seedIntroducedLearning(application.context())
    const page = await application.firstWindow()
    await page.waitForFunction(() => Boolean((window as Host).electron?.automations))
    return page
  }
  try {
    let page = await launch()
    await page.evaluate(() => (window as Host).electron.system.setLanguage('en')); await page.reload()
    await page.getByRole('button', { name: /^Automations, / }).click()
    await page.getByRole('button', { name: 'New card', exact: true }).click()
    await page.getByRole('dialog').getByLabel('Card name', { exact: true }).fill('Personal')
    await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click()
    await page.getByRole('button', { name: 'Add task', exact: true }).click()
    await page.getByRole('button', { name: /^Interval reminder/ }).click()
    await expect(page.getByRole('combobox', { name: 'Project', exact: true })).toHaveCount(0)
    await page.getByLabel('Task name', { exact: true }).fill('Check phone')
    await page.getByRole('textbox', { name: 'Notification message', exact: true }).fill('Check your phone')
    await page.evaluate(() => { const host = window as Host; host.reminderMessages = []; host.electron.automations.onCompleted(run => { if (run.message) host.reminderMessages!.push(run.message) }) })
    await page.getByRole('button', { name: 'Save and enable', exact: true }).click()
    await expect(page.locator('.automation-card')).toContainText('Check phone')
    const card = await page.evaluate(async () => (await (window as Host).electron.automations.list())[0])
    expect(card).toMatchObject({ workspaceId: '', enabled: true, intervalMinutes: 1 })
    await expect.poll(() => page.evaluate(async id => (await (window as Host).electron.automations.history(id))[0]?.message, card.id), { timeout: 100_000, intervals: [1000] }).toBe('Check your phone')
    await expect.poll(() => page.evaluate(() => (window as Host).reminderMessages)).toEqual(['Check your phone'])
    await expect(page.locator('.janus-island-shell')).toHaveAttribute('data-speaking', 'true')
    await expect(page.locator('.janus-speak-body')).toHaveText('Check your phone')
    await expect.poll(async () => (await page.locator('.janus-island-shell').boundingBox())!.height).toBeGreaterThan(80)
    await page.screenshot({ path: 'artifacts/automations/reminder-notification-preview.png' })
    await page.getByRole('button', { name: 'Read notification: Check phone', exact: true }).click()
    const reader = page.locator('.janus-notification-center')
    await expect(reader.locator('.janus-notif-body')).toHaveText('Check your phone')
    await page.keyboard.press('Escape')
    await expect(reader).toHaveCount(0)
    await page.getByRole('button', { name: 'Notifications, 0 unread', exact: true }).click()
    await reader.getByRole('button', { name: 'View task', exact: true }).click()
    await expect(page.locator('.automation-report')).toContainText('Check your phone')
    await page.screenshot({ path: 'artifacts/automations/reminder-desktop.png', fullPage: true })
    await page.getByRole('button', { name: 'Edit task', exact: true }).click()
    await page.getByLabel('Interval (minutes)', { exact: true }).fill('30')
    await page.getByRole('button', { name: 'Save task', exact: true }).click()
    await expect(page.locator('.automation-card')).toContainText('30 minutes')
    await page.getByRole('switch', { name: 'Enable Check phone', exact: true }).click()
    await expect(page.locator('.automation-card')).toContainText('Disabled')
    await application!.close(); application = undefined; page = await launch()
    const restored = await page.evaluate(async () => (await (window as Host).electron.automations.list())[0])
    expect(restored).toMatchObject({ enabled: false, intervalMinutes: 30, nextRunAt: null })
    expect(await page.evaluate(async id => (await (window as Host).electron.automations.history(id))[0].message, card.id)).toBe('Check your phone')
  } finally {
    await application?.close()
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe cleanup')
    await rm(directory, { recursive: true, force: true })
  }
})
test('built desktop saves a card, skips unchanged Git, reopens its panel and restores history after restart', async () => {
  test.setTimeout(120_000)
  const directory = await mkdtemp(join(tmpdir(), 'janusx-automation-desktop-')), repository = join(directory, 'repo'), profile = join(directory, 'profile')
  await mkdir(repository)
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repository, windowsHide: true })
  git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid')
  await writeFile(join(repository, 'example.ts'), 'export const value = 1\n'); git('add', '.'); git('commit', '-m', 'fixture')
  let application: ElectronApplication | undefined
  const launch = async () => {
    application = await electron.launch({ args: [resolve(process.env.JANUS_DESKTOP_ENTRY ?? 'out/main/index.js'), `--user-data-dir=${profile}`], env: createDesktopTestEnv(directory) })
    await seedIntroducedLearning(application.context())
    const page = await application.firstWindow(); await page.waitForFunction(() => Boolean((window as Host).electron?.automations))
    return page
  }
  try {
    let page = await launch()
    const workspace = await page.evaluate(path => (window as Host).electron.workspace.create({ name: 'Automation fixture', path }), repository)
    const input = dailyReviewTemplate(workspace.id); input.tasks[1].kind = 'agent.cli'
    const card = await page.evaluate(input => (window as Host).electron.automations.save(input), input)
    await page.evaluate(id => (window as Host).electron.automations.run(id, 'desktop-fixture'), card.id)
    await expect.poll(async () => page.evaluate(async id => (await (window as Host).electron.automations.history(id))[0]?.reason, card.id)).toBe('no_changes')
    await page.evaluate(() => (window as Host).electron.system.setLanguage('en')); await page.reload()
    await page.getByRole('button', { name: 'Automation fixture, drag to reorder or group', exact: true }).click()
    const rail = page.getByRole('button', { name: /^Automations, / })
    await expect(rail).toBeVisible(); await rail.click()
    await expect(page.locator('.automation-card')).toContainText(input.name)
    await page.locator('.automation-task-title').click()
    await expect(page.locator('.automation-report')).toContainText('No new commits')
    await page.screenshot({ path: 'artifacts/automations/desktop.png', fullPage: true })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(page.locator('.automation-generate')).toHaveCount(0)
    const automation = page.locator('.automation-panel')
    await automation.getByRole('button', { name: 'Open Island', exact: true }).click()
    const island = page.locator('.janus-island-shell')
    await expect(island).toHaveAttribute('data-stage', 'expanded')
    await expect(automation).toHaveAttribute('data-island-linked', 'true')
    await expect(island).toHaveAttribute('data-tool-companion', 'parallel')
    await expect(island.locator('.janus-chat-input')).toHaveValue('')
    await expect(island.getByRole('button', { name: 'Remove Automation fixture', exact: true })).toBeVisible()
    const noOverlap = async () => {
      const main = (await island.boundingBox())!, tool = (await automation.boundingBox())!
      const actions = await island.locator('.janus-island-actions').boundingBox()
      const right = Math.max(main.x + main.width, actions ? actions.x + actions.width : 0)
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
      return right <= viewport.width && main.y + main.height <= viewport.height && (right <= tool.x || main.y + main.height <= tool.y)
    }
    await expect.poll(noOverlap).toBe(true)
    await automation.getByRole('button', { name: 'Add task', exact: true }).click()
    await expect(island).toHaveAttribute('data-stage', 'expanded')
    await automation.getByLabel('Task name', { exact: true }).fill('Companion draft')
    await automation.locator('.automation-header h2').click()
    await page.screenshot({ path: 'artifacts/automations/island-companion-desktop.png', animations: 'disabled' })
    await page.setViewportSize({ width: 680, height: 780 })
    await expect(island).toHaveAttribute('data-tool-companion', 'stacked')
    await expect.poll(noOverlap).toBe(true)
    await expect(island.locator('.janus-chat-main')).toHaveCSS('grid-column-start', '1')
    await expect(island.locator('.janus-chat-toolbar')).toBeVisible()
    const nameField = automation.getByLabel('Task name', { exact: true })
    await expect(nameField).toHaveValue('Companion draft')
    await expect(nameField).toBeVisible()
    expect(await nameField.evaluate(element => {
      const box = element.getBoundingClientRect()
      return document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) === element
    })).toBe(true)
    await page.screenshot({ path: 'artifacts/automations/island-companion-narrow.png', animations: 'disabled' })
    await page.keyboard.press('Escape')
    await expect(island).toHaveAttribute('data-stage', 'collapsed')
    await expect(automation).toHaveAttribute('data-island-linked', 'false')
    await expect(island).not.toHaveAttribute('data-tool-companion')
    await expect(page.locator('#right-tool-panel')).not.toHaveAttribute('data-island-companion')
    await expect(nameField).toHaveValue('Companion draft')
    await expect(automation).toBeHidden()
    await page.setViewportSize({ width: 1400, height: 900 })
    await expect(automation).toBeVisible()
    await automation.getByRole('button', { name: 'Open Island', exact: true }).click()
    await expect(automation).toHaveAttribute('data-island-linked', 'true')
    await expect.poll(noOverlap).toBe(true)
    await page.evaluate(() => { document.documentElement.dataset.theme = 'planche' })
    await page.screenshot({ path: 'artifacts/automations/island-companion-planche.png', animations: 'disabled' })
    await automation.getByRole('button', { name: 'Collapse Island', exact: true }).click()
    await expect(automation).toHaveAttribute('data-island-linked', 'false')
    await application!.close(); application = undefined; page = await launch()
    expect(await page.evaluate(async id => (await (window as Host).electron.automations.history(id))[0]?.reason, card.id)).toBe('no_changes')
    expect(await page.evaluate(async id => (await (window as Host).electron.automations.run(id, 'desktop-fixture')).reason, card.id)).toBe('no_changes')
  } finally {
    await application?.close()
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe cleanup')
    await rm(directory, { recursive: true, force: true })
  }
})
