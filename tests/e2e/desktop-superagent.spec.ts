import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { controlledGit } from '../../src/main/git/controlled-worktree'
import { hookCliFixture } from '../helpers/hook-cli-fixture'
import { seedIntroducedLearning } from './desktop-test-env'

test.skip(!process.env.JANUS_SUPERAGENT_CODEX_BINARY || process.platform !== 'win32', 'Requires the explicitly selected local Codex binary')

test('Island starts the shared workspace in the light theme without starting work', async () => {
  const cli = await hookCliFixture()
  let application: ElectronApplication | undefined
  try {
    application = await electron.launch({ args: [resolve('out/main/index.js'), `--user-data-dir=${join(cli.root, 'profile')}`],
      env: { ...cli.env, NODE_ENV: 'production', ELECTRON_RENDERER_URL: '', JANUSX_KNOWLEDGE_ROOT: join(cli.root, 'knowledge') } })
    await seedIntroducedLearning(application.context())
    const page = await application.firstWindow()
    await page.waitForFunction(() => Boolean(window.electron?.superAgent))
    const workspaceId = await page.evaluate(async path => {
      await window.electron.system.setLanguage('en')
      await window.electron.theme.update('white')
      const workspace = await window.electron.workspace.create({ name: 'Island launch fixture', path })
      await window.electron.workspace.load(workspace.id)
      return workspace.id
    }, cli.cwd)
    await page.reload()
    await page.locator('.ws').filter({ hasText: 'Island launch fixture' }).first().click()
    await page.locator('.janus-island').dblclick()
    await page.locator('.janus-island-shell').getByRole('button', { name: 'Super Agent', exact: true }).click()
    const surface = page.locator('[data-superagent-workspace]')
    const toolbar = page.locator('[data-superagent-toolbar]')
    await expect(surface).toBeVisible()
    await expect(surface).toHaveCount(1)
    await expect(page.locator('.janus-island-shell')).not.toBeVisible()
    const prompt = surface.locator('textarea')
    await prompt.fill('Keep this draft while toggling the terminal launcher')
    await toolbar.getByRole('button', { name: 'Show terminals', exact: true }).click()
    await expect(page.locator('[data-pane-region="project"] [data-onboarding="shell"]')).toBeVisible()
    await toolbar.getByRole('button', { name: 'Hide terminal launcher', exact: true }).click()
    await expect(page.locator('[data-pane-region="project"]')).not.toBeVisible()
    await expect(prompt).toHaveValue('Keep this draft while toggling the terminal launcher')
    await expect(prompt).toBeFocused()
    await toolbar.getByRole('button', { name: 'Show terminals', exact: true }).click()
    await expect(page.locator('[data-pane-region="project"] [data-onboarding="shell"]')).toBeVisible()
    // The labeled Worker disclosure is distinct from the outer toolbox collapse.
    await expect(page.locator('button[aria-controls="superagent-workers"]')).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Hide Workers', exact: true })).toHaveCount(1)
    await expect(toolbar.getByRole('button', { name: 'Hide Workers', exact: true })).toHaveText('Workers')
    await toolbar.getByRole('button', { name: 'Hide Workers', exact: true }).click()
    await expect(surface).toBeVisible()
    await expect(page.locator('#superagent-workers')).not.toBeVisible()
    await toolbar.getByRole('button', { name: 'Show Workers', exact: true }).click()
    await page.locator('[data-pane-region="tools"]').getByRole('button', { name: 'Collapse tools', exact: true }).click()
    await expect(surface).not.toBeVisible()
    await expect(page.locator('[data-pane-region="project"] [data-onboarding="shell"]')).toBeVisible()
    await page.locator('[data-tools-toggle]').click()
    await expect(surface).toBeVisible()
    await expect(toolbar.getByRole('button', { name: 'Hide Workers', exact: true })).toHaveAttribute('aria-expanded', 'true')
    const snapshot = await page.evaluate(id => window.electron.superAgent.snapshot(id), workspaceId)
    expect(snapshot.works).toHaveLength(0)
    await mkdir('artifacts/superagent-p7', { recursive: true })
    await page.screenshot({ path: 'artifacts/superagent-p7/desktop-light.png' })
    await mkdir('artifacts/superagent-controls', { recursive: true })
    await page.screenshot({ path: 'artifacts/superagent-controls/light-expanded.png' })
  } finally {
    if (application) await application.close()
    await cli.close()
  }
})

test('ordinary chat recalls, continues and stops work; app quit restores history without executing until explicitly continued', async () => {
  test.setTimeout(300000)
  const cli = await hookCliFixture(), f = { repo: '' }
  f.repo = cli.cwd
  await controlledGit(f.repo, ['init', '-b', 'main'])
  await controlledGit(f.repo, ['config', 'user.name', 'P4 Desktop'])
  await controlledGit(f.repo, ['config', 'user.email', 'p4@example.invalid'])
  await writeFile(join(f.repo, 'baseline.txt'), 'fixture\n')
  await controlledGit(f.repo, ['add', 'baseline.txt']); await controlledGit(f.repo, ['commit', '-m', 'Fixture'])
  let application: ElectronApplication | undefined
  let startup = ''
  const errors: string[] = [], reportId = randomUUID()
  const janusRequests: any[] = [], nativeRequests: any[] = [], steps = new Map<string, number>()
  const janusCalls: unknown[] = []
  const markersByInput = new Map<string, string>(), previousTools = new Map<string, string>()
  const longInput = 'P4_NEW: implement the isolated desktop fixture. ' + 'Retain this requirement and its source. '.repeat(2000) + 'P5_DESKTOP_TAIL'
  let workId = '', hold: import('node:http').ServerResponse | undefined
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk)
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
      if (req.url?.startsWith('/janus/')) {
        if (!body.stream) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id: 'health', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }] })); return }
        janusRequests.push(body)
        let context: any, card: any
        const walk = (value: any) => {
          if (typeof value === 'string') {
            const line = value.split('\n').find(line => line.startsWith('Current host input: '))
            if (line) context = JSON.parse(line.slice('Current host input: '.length))
            try { const parsed = JSON.parse(value); if (parsed && typeof parsed === 'object') walk(parsed) } catch {}
          } else if (Array.isArray(value)) value.forEach(walk)
          else if (value && typeof value === 'object') {
            if (value.work?.id && Number.isInteger(value.work.revision)) { card = value; workId = value.work.id }
            Object.values(value).forEach(walk)
          }
        }
        walk(body)
        if (!context?.inputId) throw new Error('The real Janus prompt did not contain its persisted input identity')
        const step = steps.get(context.inputId) ?? 0; steps.set(context.inputId, step + 1)
        const text = JSON.stringify(body.input ?? body.messages)
        // Use the latest user marker, not historical instructions.
        const markers = ['P4_NEW', 'P4_HISTORY', 'P4_CONTINUE', 'P4_GENERAL', 'P4_STOP', 'P6_STOP_ALL']
        const marker = markersByInput.get(context.inputId) ?? markers.map(marker => ({ marker, index: text.lastIndexOf(marker) })).sort((a, b) => b.index - a.index)[0].marker
        markersByInput.set(context.inputId, marker)
        let result: any
        const readResult = (value: any) => {
          if (typeof value === 'string') { try { readResult(JSON.parse(value)) } catch {} }
          else if (Array.isArray(value)) value.forEach(readResult)
          else if (value && typeof value === 'object') {
            if (value.blocked || value.work?.id || (value.resourceId && value.status)) result = value
            else Object.values(value).forEach(readResult)
          }
        }
        const outputs = body.input ? body.input.filter((row: any) => row.type === 'function_call_output') : body.messages.filter((row: any) => row.role === 'tool')
        outputs.forEach(readResult)
        const previous = previousTools.get(context.inputId)
        let name: string | undefined, args: unknown, reply = 'General chat still available'
        if (marker === 'P4_NEW') {
          if (!step || previous === 'work_read_resource') { name = 'work_route'; args = { inputId: context.inputId, action: 'new', key: 'desktop-feature', title: 'Desktop feature', goal: 'Implement the isolated desktop fixture' } }
          reply = 'Desktop feature arranged'
        } else if (marker === 'P4_HISTORY') {
          if (!step) { name = 'work_list'; args = {} }
          reply = 'History only; no work started'
        } else if (marker === 'P4_GENERAL') {
          if (!step) { name = 'workspace_overview'; args = { workspaceId: context.workspaceId, path: '', depth: 1, maxEntries: 10 } }
        } else if (marker === 'P6_STOP_ALL') {
          if (!step) { name = 'work_route'; args = { inputId: context.inputId, action: 'stop-all', scope: 'workspace' } }
          reply = 'Workspace stop requested'
        } else if (marker === 'P4_CONTINUE' || marker === 'P4_STOP') {
          if (!step) { name = 'work_read'; args = { workId } }
          else if (previous === 'work_read' || previous === 'work_read_resource') {
            if (card?.work.id !== workId) throw new Error('Missing real work card before action')
            name = 'work_route'; args = { inputId: context.inputId, action: marker === 'P4_STOP' ? 'stop' : 'continue', workId, expectedRevision: card.work.revision }
          }
          reply = marker === 'P4_STOP' ? 'Stop requested' : 'Supplement arranged'
        }
        if (previous === 'work_route' && result?.blocked) {
          name = result.requiredCard ? 'work_read' : 'work_read_resource'; args = result.requiredCard ?? result.required[0]
        }
        if (name && !body.tools.some((tool: any) => (tool.name ?? tool.function?.name) === name)) throw new Error('Janus tool missing: ' + name)
        janusCalls.push({ inputId: context.inputId, step, marker, name, tools: body.tools.map((tool: any) => tool.name ?? tool.function?.name) })
        if (name) previousTools.set(context.inputId, name)
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        const emit = (value: unknown) => res.write(`data: ${JSON.stringify(value)}\n\n`)
        if (req.url?.endsWith('/responses')) {
          emit({ type: 'response.created', response: { id: randomUUID(), created_at: 1, model: 'fixture-model' } })
          const id = randomUUID()
          if (name) {
            const item = { type: 'function_call', id, call_id: id, name, arguments: JSON.stringify(args), status: 'completed' }
            emit({ type: 'response.output_item.added', output_index: 0, item: { ...item, arguments: '' } })
            emit({ type: 'response.function_call_arguments.delta', item_id: id, output_index: 0, delta: item.arguments })
            emit({ type: 'response.output_item.done', output_index: 0, item })
          } else {
            const item = { type: 'message', id }
            emit({ type: 'response.output_item.added', output_index: 0, item })
            emit({ type: 'response.output_text.delta', item_id: id, delta: reply })
            emit({ type: 'response.output_item.done', output_index: 0, item })
          }
          emit({ type: 'response.completed', response: { usage: { input_tokens: 100, output_tokens: 20 } } })
        } else {
          emit({ id: randomUUID(), object: 'chat.completion.chunk', choices: [{ index: 0, delta: name ? { role: 'assistant', tool_calls: [{ index: 0, id: randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } }] } : { role: 'assistant', content: reply }, finish_reason: null }] })
          emit({ id: randomUUID(), object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: name ? 'tool_calls' : 'stop' }] })
          res.write('data: [DONE]\n\n')
        }
        res.end(); return
      }
      if (!req.url?.includes('responses')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[]}'); return }
      nativeRequests.push(body)
      const tools = (body.tools ?? []).flatMap((tool: any) => tool.type === 'namespace' ? tool.tools.map((row: any) => ({ ...row, namespace: tool.name })) : [tool])
      const completed = (id: string) => body.input?.some((row: any) => row.call_id === id && row.type === 'function_call_output')
      if (JSON.stringify(body.input).includes('P4_CONTINUE')) { hold = res; return }
      const name = !completed('desktop_edit') ? 'exec_command' : !completed('desktop_report') ? 'report_work' : undefined
      const tool = name && tools.find((row: any) => row.name === name)
      if (name && !tool) throw new Error(`Tool missing: ${name}`)
      const id = name === 'exec_command' ? 'desktop_edit' : 'desktop_report'
      const args = name === 'exec_command' ? { cmd: 'Set-Content -LiteralPath worker-desktop.txt -Value DESKTOP_WORKER_EDIT', shell: 'powershell.exe', login: false }
        : { reportId, kind: 'ready', summary: 'Desktop work ready', text: 'Desktop Worker report: created worker-desktop.txt through the managed native process.' }
      const item = tool ? { id, call_id: id, type: 'function_call', name: tool.name, namespace: tool.namespace, status: 'completed', arguments: JSON.stringify(args) }
        : { id: 'desktop_message', type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: 'Done', annotations: [] }] }
      const response = { id: randomUUID(), object: 'response', status: 'completed', model: body.model, output: [item] }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const emit = (type: string, value: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`)
      emit('response.created', { response: { ...response, status: 'in_progress', output: [] } })
      emit('response.output_item.added', { output_index: 0, item }); emit('response.output_item.done', { output_index: 0, item }); emit('response.completed', { response }); res.end()
    } catch (error) { errors.push(String(error)); res.destroy(error as Error) }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    let config = [
      'model="probe"', 'model_provider="local"', 'check_for_update_on_startup=false',
      '[model_providers.local]', 'name="Desktop P4 fixture"', `base_url="http://127.0.0.1:${(server.address() as { port: number }).port}/v1"`, 'wire_api="responses"', 'requires_openai_auth=false',
      `[projects.${JSON.stringify(f.repo)}]`, 'trust_level="trusted"',
    ].join('\n')
    await writeFile(join(cli.env.CODEX_HOME!, 'config.toml'), config)
    const env = { ...cli.env, NODE_ENV: 'production', ELECTRON_RENDERER_URL: '', JANUSX_KNOWLEDGE_ROOT: join(cli.root, 'knowledge') }
    const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'PATH'
    env[pathKey] = `${dirname(process.env.JANUS_SUPERAGENT_CODEX_BINARY!)};${env[pathKey] ?? ''}`
    application = await electron.launch({ args: [resolve(process.env.JANUS_DESKTOP_ENTRY ?? 'out/main/index.js'), `--user-data-dir=${join(cli.root, 'profile')}`], env })
    application.process().stderr?.on('data', data => { startup = (startup + data.toString()).slice(-12000) })
    application.process().stdout?.on('data', data => { startup = (startup + data.toString()).slice(-12000) })
    await seedIntroducedLearning(application.context())
    let page = await application.firstWindow({ timeout: 45000 }).catch(error => { throw new Error(`${String(error)}\n${startup}`) })
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1500, 1000))
    await page.waitForFunction(() => Boolean(window.electron?.superAgent))
    const workspaceId = await page.evaluate(async path => {
      await window.electron.system.setLanguage('en')
      const workspace = await window.electron.workspace.create({ name: 'SuperAgent P4 fixture', path })
      await window.electron.workspace.load(workspace.id)
      return workspace.id
    }, f.repo)
    const saved = await page.evaluate(baseURL => window.electron.llm.saveTerminalProvider('janus', {
      id: 'openai-compatible', name: 'P4 Janus fixture', authType: 'api-key' as never, enabled: true,
      apiKey: 'fixture-key', baseURL, modelId: 'fixture-model', models: ['fixture-model'],
      extra: { chatModelLimits: { 'fixture-model': { contextWindow: 128000, maxOutputTokens: 4096 } } },
    }), `http://127.0.0.1:${(server.address() as { port: number }).port}/janus/v1`)
    expect(saved.success).toBe(true)
    await page.reload()
    await page.locator('.ws').filter({ hasText: 'SuperAgent P4 fixture' }).first().click()
    await page.getByRole('button', { name: 'Super Agent', exact: true }).click()
    let work = page.getByRole('region', { name: 'SuperAgent work', exact: true })
    await expect(work).toBeVisible()
    const surface = page.locator('[data-superagent-workspace]')
    const toolbar = page.locator('[data-superagent-toolbar]')
    const draft = surface.locator('textarea.janus-chat-input')
    await draft.fill('P7 draft remains while panels change')
    await toolbar.getByRole('button', { name: 'Hide Workers', exact: true }).click()
    await expect(work).not.toBeVisible()
    await expect(draft).toHaveValue('P7 draft remains while panels change')
    await mkdir('artifacts/superagent-controls', { recursive: true })
    await page.screenshot({ path: 'artifacts/superagent-controls/dark-collapsed.png' })
    await toolbar.getByRole('button', { name: 'Show Workers', exact: true }).click()
    await expect(work).toBeVisible()
    await page.locator('.janus-island').dblclick()
    await expect(page.locator('.janus-island-shell')).toHaveAttribute('data-notif', 'true')
    await expect(surface).toBeVisible()
    await expect(page.locator('[data-superagent-workspace]')).toHaveCount(1)
    await page.keyboard.press('Escape')
    expect(nativeRequests).toHaveLength(0)
    expect(janusRequests).toHaveLength(0)
    await toolbar.getByRole('button', { name: 'Show terminals', exact: true }).click()
    await page.locator('[data-pane-region="project"] [data-onboarding="shell"]').click()
    const terminalInput = page.locator('[data-pane-region="project"] .xterm-helper-textarea').first()
    await expect(terminalInput).toBeVisible({ timeout: 20000 })
    await terminalInput.focus()
    await page.keyboard.type('echo P7_TERMINAL_ALIVE')
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-pane-region="project"] .xterm-rows').first()).toContainText('P7_TERMINAL_ALIVE', { timeout: 15000 })
    await expect(draft).toHaveValue('P7 draft remains while panels change')
    expect(janusRequests).toHaveLength(0)
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1000, 850))
    // A narrow tool pane offers its own Worker view without covering the terminal region.
    await expect(surface).toHaveAttribute('data-compact', 'true')
    await toolbar.getByRole('button', { name: 'Show Workers', exact: true }).click()
    await expect(work).toBeVisible()
    const terminalBounds = await page.locator('[data-pane-region="project"]').boundingBox()
    const workBounds = await surface.boundingBox()
    expect(terminalBounds!.x + terminalBounds!.width).toBeLessThanOrEqual(workBounds!.x + 1)
    await page.screenshot({ path: 'artifacts/superagent-controls/narrow-workers.png' })
    await toolbar.getByRole('button', { name: 'Hide Workers', exact: true }).click()
    await expect(draft).toBeFocused()
    await expect(draft).toHaveValue('P7 draft remains while panels change')
    await page.screenshot({ path: 'artifacts/superagent-controls/narrow-chat.png' })
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1800, 1000))
    await expect(work).toBeVisible()
    await surface.getByRole('separator', { name: 'Resize Worker panel' }).focus()
    await page.keyboard.press('End')
    await expect(surface.getByRole('separator', { name: 'Resize Worker panel' })).toHaveAttribute('aria-valuenow', '440')
    await page.keyboard.press('Home')
    await expect(surface.getByRole('separator', { name: 'Resize Worker panel' })).toHaveAttribute('aria-valuenow', '280')
    const send = async (text: string) => { await page.locator('[data-superagent-workspace] textarea.janus-chat-input').fill(text); await page.locator('[data-superagent-workspace] textarea.janus-chat-input').press('Enter') }
    await send(longInput)
    await expect(page.locator('[data-superagent-workspace] .janus-chat')).toContainText('Desktop feature arranged', { timeout: 45000 })
    const trustedPaths = new Set([f.repo])
    await expect.poll(async () => {
      // Native folder consent is a prerequisite, separate from the host Git approval.
      // Seed only this test's isolated Codex profile for the concrete proposed checkout.
      for (const operation of (await page.evaluate(scope => window.electron.superAgent.environments(scope), workspaceId)).operations) {
        if (operation.status === 'pending' && operation.plan.kind === 'create' && !trustedPaths.has(operation.plan.targetPath)) {
          trustedPaths.add(operation.plan.targetPath)
          config += `\n[projects.${JSON.stringify(operation.plan.targetPath)}]\ntrust_level="trusted"\n`
          await writeFile(join(cli.env.CODEX_HOME!, 'config.toml'), config)
        }
      }
      for (const create of await page.getByRole('region', { name: 'Worker decisions' }).getByRole('button', { name: 'Create and start', exact: true }).all()) {
        if (await create.isEnabled().catch(() => false)) await create.click({ timeout: 1000 }).catch(() => undefined)
      }
      for (const form of await page.getByRole('region', { name: 'Worker decisions' }).locator('form').all()) {
        for (const group of await form.getByRole('radiogroup').all()) {
          const first = group.getByRole('radio').first()
          if (await first.isEnabled().catch(() => false)) await first.check({ timeout: 1000 }).catch(() => undefined)
        }
        const submit = form.getByRole('button', { name: 'Submit answer', exact: true })
        if (await submit.count() && await submit.isEnabled()) await submit.click()
      }
      for (const allow of await page.getByRole('region', { name: 'Worker decisions' }).getByRole('button', { name: 'Allow once', exact: true }).all()) {
        if (await allow.isEnabled().catch(() => false)) await allow.click({ timeout: 1000 }).catch(() => undefined)
      }
      return await page.evaluate(async scope => (await window.electron.superAgent.snapshot(scope)).reports.length, workspaceId)
    }, { timeout: 90000 }).toBe(1)
    await expect(work).toContainText('Desktop work ready')
    await expect(work.getByRole('status')).toHaveText('Reported ready', { timeout: 15000 })
    const checkout = (await page.evaluate(scope => window.electron.superAgent.environments(scope), workspaceId)).environments[0].checkout.path
    expect(await readFile(join(checkout, 'worker-desktop.txt'), 'utf8')).toContain('DESKTOP_WORKER_EDIT')
    await expect.poll(async () => (await page.evaluate(scope => window.electron.superAgent.workers(scope), workspaceId))[0].stopConfirmed).toBe(true)
    const requestsBeforeNotice = janusRequests.length
    await draft.fill('Draft survives reading and locating a result')
    await page.locator('.janus-island').click()
    const notice = page.locator('.janus-notification-center .janus-notif-row').filter({ hasText: 'Desktop work ready' })
    await expect(notice).toContainText('SuperAgent P4 fixture')
    if (await notice.getAttribute('data-selected') !== 'true') await notice.locator('.janus-notif-summary').click()
    await expect(draft).toHaveValue('Draft survives reading and locating a result')
    await notice.getByRole('button', { name: 'Go to work', exact: true }).click()
    await expect(page.locator('.janus-notification-center')).toHaveCount(0)
    await expect(surface).toHaveCount(1)
    await expect(draft).toHaveValue('Draft survives reading and locating a result')
    expect(janusRequests).toHaveLength(requestsBeforeNotice)
    await draft.fill('')
    const count = nativeRequests.length, janusCount = janusRequests.length
    await send('P4_HISTORY: what did the previous work change?')
    await expect(page.locator('[data-superagent-workspace] .janus-chat')).toContainText('History only; no work started', { timeout: 15000 })
    expect(nativeRequests).toHaveLength(count)
    expect(janusRequests.length - janusCount, JSON.stringify(janusCalls)).toBe(2)
    await send('P4_CONTINUE: continue the same feature with another check')
    await expect(page.locator('[data-superagent-workspace] .janus-chat')).toContainText('Supplement arranged', { timeout: 45000 })
    await expect.poll(() => !!hold, { timeout: 25000 }).toBe(true)
    await send('P4_GENERAL: answer an ordinary question while development is running')
    await expect(page.locator('[data-superagent-workspace] .janus-chat')).toContainText('General chat still available', { timeout: 15000 })
    expect(janusCalls.some((call: any) => call.name === 'workspace_overview')).toBe(true)
    await mkdir('artifacts/superagent-p7', { recursive: true })
    await page.screenshot({ path: 'artifacts/superagent-p7/desktop-chat.png' })
    await send('P4_STOP: stop the Desktop feature only')
    await expect(page.locator('[data-superagent-workspace] .janus-chat')).toContainText('Stop requested', { timeout: 15000 })
    await expect(work.getByRole('status')).toHaveText('Stopped', { timeout: 15000 })
    expect((await page.evaluate(scope => window.electron.superAgent.workers(scope), workspaceId))[0].stopConfirmed).toBe(true)
    expect(await readFile(join(cli.env.CODEX_HOME!, 'config.toml'), 'utf8')).toBe(config)
    expect(errors).toEqual([])
    expect([...steps.values()][0]).toBeGreaterThan(2)
    expect(janusCalls.some((call: any) => call.marker === 'P4_NEW' && call.name === 'work_read_resource')).toBe(true)
    const records = await page.evaluate(scope => window.electron.superAgent.snapshot(scope), workspaceId)
    expect(records.works).toHaveLength(1)
    const original = await page.evaluate(({ scope, resourceId }) => window.electron.superAgent.readResource(scope, resourceId), { scope: workspaceId, resourceId: records.inputs[0].resourceId })
    expect(original.text).toBe(longInput)
    hold = undefined
    await send('P4_CONTINUE: continue before closing the application')
    await expect.poll(() => !!hold, { timeout: 30000 }).toBe(true)
    const active = (await page.evaluate(scope => window.electron.superAgent.workers(scope), workspaceId))[0]
    expect(active.stopConfirmed).toBe(false)
    // Exercise the actual AppShutdown path; only the finally fallback force-kills this test's PID.
    await Promise.all([application.waitForEvent('close'), application.evaluate(({ app }) => app.quit()).catch(() => undefined)])
    const nativeBeforeRestore = nativeRequests.length, janusBeforeRestore = janusRequests.length
    application = await electron.launch({ args: [resolve(process.env.JANUS_DESKTOP_ENTRY ?? 'out/main/index.js'), `--user-data-dir=${join(cli.root, 'profile')}`], env })
    page = await application.firstWindow({ timeout: 45000 })
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1500, 1000))
    await page.waitForFunction(() => Boolean(window.electron?.superAgent))
    await page.locator('.ws').filter({ hasText: 'SuperAgent P4 fixture' }).first().click()
    await expect(page.locator('[data-superagent-workspace]')).toBeVisible()
    work = page.getByRole('region', { name: 'SuperAgent work', exact: true })
    await expect(work.getByRole('status')).toHaveText('Not running after restart')
    const restored = (await page.evaluate(scope => window.electron.superAgent.workers(scope), workspaceId))[0]
    expect(restored).toMatchObject({ phase: 'interrupted', restored: true, stopConfirmed: true, executionId: active.executionId })
    expect(restored.conversation.connection).toBe('closed')
    const restoredRecords = await page.evaluate(scope => window.electron.superAgent.snapshot(scope), workspaceId)
    expect(restoredRecords.works[0].closedAt).toBeNull(); expect(restoredRecords.reports).toHaveLength(1)
    // The old report stays queryable, but cannot masquerade as the newer interrupted execution's result.
    expect(restoredRecords.works[0].latestReportId).toBeNull()
    expect((await page.evaluate(({ scope, resourceId }) => window.electron.superAgent.readResource(scope, resourceId), {
      scope: workspaceId, resourceId: restoredRecords.reports[0].resourceId,
    })).text).toContain('Desktop Worker report: created worker-desktop.txt')
    expect(nativeRequests).toHaveLength(nativeBeforeRestore); expect(janusRequests).toHaveLength(janusBeforeRestore)
    await page.screenshot({ path: 'artifacts/superagent-p7/desktop-restored.png' })
    hold = undefined
    await send('P4_CONTINUE: explicitly continue after reopening the application')
    await expect.poll(() => !!hold, { timeout: 30000 }).toBe(true)
    const resumed = (await page.evaluate(scope => window.electron.superAgent.workers(scope), workspaceId))[0]
    expect(resumed.executionId).not.toBe(active.executionId); expect(resumed.conversation.threadId).toBe(active.conversation.threadId)
    await send('P6_STOP_ALL: stop all managed work in this workspace')
    await expect(page.locator('[data-superagent-workspace] .janus-chat')).toContainText('Workspace stop requested', { timeout: 15000 })
    await expect.poll(async () => (await page.evaluate(scope => window.electron.superAgent.workers(scope), workspaceId))[0].stopConfirmed).toBe(true)
    expect(errors).toEqual([])
  } finally {
    await mkdir('artifacts/superagent-p7', { recursive: true })
    if (application?.windows()[0]) {
      const failedPage = application.windows()[0]
      await failedPage.screenshot({ path: 'artifacts/superagent-p7/desktop-last.png' }).catch(() => undefined)
      await writeFile('artifacts/superagent-p7/desktop-last.txt', await failedPage.locator('body').innerText().catch(() => startup))
    }
    await writeFile('artifacts/superagent-p7/desktop-calls.json', JSON.stringify({ janusCalls, errors }, null, 2))
    hold?.destroy()
    // This test owns this isolated process. Also clean up a synchronous native startup error dialog.
    if (application?.process().pid && application.process().exitCode === null) {
      await promisify(execFile)('taskkill', ['/PID', String(application.process().pid), '/T', '/F'], { windowsHide: true }).catch(() => undefined)
    }
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
    await cli.close()
  }
})
