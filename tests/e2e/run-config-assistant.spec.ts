import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { createDesktopTestEnv } from './desktop-test-env'

type DesktopWindow = Window & { electron: { workspace: { create(i: { name: string; path: string }): Promise<{ id: string }> }; llm: { saveTerminalProvider(id: string, p: unknown): Promise<{ success: boolean }> }; system: { setLanguage(l: string): Promise<void> } } }

/** Model-facing tool names are the canonical names with `.`/`-` folded to `_`. */
const EXPECTED_TOOL_SURFACE = ['launch_config_get', 'launch_config_edit', 'launch_config_apply', 'workspace_list', 'workspace_read', 'project_detect']
const FORBIDDEN_TOOL_SURFACE = ['workspace_edit', 'workspace_write', 'note_write', 'command_run', 'project_apply_config']

test('run-config assistant edits via launch-config tools and applies through the approval box', async () => {
  const root = await mkdtemp(join(tmpdir(), 'janusx-run-config-'))
  const userDataDir = join(root, 'user-data')
  const workspacePath = join(root, 'workspace')
  await mkdir(userDataDir, { recursive: true })
  await mkdir(join(workspacePath, 'src'), { recursive: true })
  await writeFile(join(workspacePath, 'package.json'), JSON.stringify({ name: 'run-config-fixture', scripts: { dev: 'vite', start: 'node src/start.js' }, devDependencies: { vite: '^6.0.0' } }))
  await writeFile(join(workspacePath, 'src/start.js'), 'console.log("start")\n')

  const seenToolSets: string[][] = []
  const seenUrls: string[] = []
  let streamTurn = 0
  let application: ElectronApplication | undefined
  let server: Server | undefined
  try {
    server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      request.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          // Runtime status probes use non-streaming chat completions.
          if (request.url === '/v1/chat/completions' && body.stream !== true) {
            response.writeHead(200, { 'Content-Type': 'application/json' })
            response.end(JSON.stringify({ id: 'health', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }] }))
            return
          }
          const isResponses = request.url === '/v1/responses'
          seenUrls.push(request.url!)
          const tools: Array<{ name: string }> = body.tools ?? []
          seenToolSets.push(tools.map((tool) => tool.name))
          const turn = streamTurn++
          response.writeHead(200, { 'Content-Type': 'text/event-stream' })
          const emit = (event: unknown) => response.write(`data: ${JSON.stringify(event)}\n\n`)

          // Use the production provider, compatibility layer, SDK, loop and IPC.
          // The fixture supplies publicly returned reasoning, never private model state.
          const emitWork = () => {
            if (isResponses) {
              const reasoning = { type: 'reasoning', id: `reason-${turn}`, summary: [], encrypted_content: null }
              emit({ type: 'response.output_item.added', output_index: 0, item: reasoning })
              emit({ type: 'response.reasoning_summary_part.added', item_id: `reason-${turn}`, summary_index: 0 })
              emit({ type: 'response.reasoning_summary_text.delta', item_id: `reason-${turn}`, summary_index: 0, delta: `Reasoning phase ${turn}.` })
              emit({ type: 'response.reasoning_summary_part.done', item_id: `reason-${turn}`, summary_index: 0 })
              emit({ type: 'response.output_item.done', output_index: 0, item: { ...reasoning, summary: [{ type: 'summary_text', text: `Reasoning phase ${turn}.` }] } })
              const item = { type: 'message', id: `work-${turn}` }
              emit({ type: 'response.output_item.added', output_index: 1, item })
              emit({ type: 'response.output_text.delta', item_id: item.id, delta: `Working phase ${turn}.` })
              emit({ type: 'response.output_item.done', output_index: 1, item })
            }
          }

          const emitToolCall = (name: string, args: Record<string, unknown>) => {
            const json = JSON.stringify(args)
            if (isResponses) {
              const item = { type: 'function_call', id: `item-${turn}`, call_id: `tool-${turn}`, name, arguments: json, status: 'completed' }
              emit({ type: 'response.created', response: { id: `fixture-${turn}`, created_at: 1, model: 'fixture-model' } })
              emitWork()
              emit({ type: 'response.output_item.added', output_index: 2, item: { ...item, arguments: '' } })
              emit({ type: 'response.function_call_arguments.delta', item_id: item.id, output_index: 2, delta: json })
              emit({ type: 'response.output_item.done', output_index: 2, item })
              emit({ type: 'response.completed', response: { usage: { input_tokens: 10, output_tokens: 10 } } })
            } else {
              emit({ id: `fixture-${turn}`, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: `call-${turn}`, type: 'function', function: { name, arguments: json } }] }, finish_reason: null }] })
              emit({ id: `fixture-${turn}`, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
              emit('[DONE]')
            }
            response.end()
          }

          const emitText = (text: string) => {
            if (isResponses) {
              const item = { type: 'message', id: `text-${turn}` }
              emit({ type: 'response.created', response: { id: `fixture-${turn}`, created_at: 1, model: 'fixture-model' } })
              emit({ type: 'response.output_item.added', output_index: 0, item })
              emit({ type: 'response.output_text.delta', item_id: item.id, delta: text })
              emit({ type: 'response.output_item.done', output_index: 0, item })
              emit({ type: 'response.completed', response: { usage: { input_tokens: 10, output_tokens: 10 } } })
            } else {
              emit({ id: `fixture-${turn}`, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] })
              emit({ id: `fixture-${turn}`, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
              emit('[DONE]')
            }
            response.end()
          }

          if (turn === 0) {
            emitToolCall('launch_config_get', {})
          } else if (turn === 1) {
            emitToolCall('launch_config_edit', { ops: [{ op: 'setField', path: 'configurations[0].program', value: 'debug-start.exe' }] })
          } else if (turn === 2) {
            emitToolCall('launch_config_apply', {})
          } else {
            // 长回复：复现「输出后右栏被内容撑开、composer 被挤没」的布局回归。
            emitText(Array.from({ length: 40 }, (_, index) => `第 ${index} 行：运行配置助手生成的较长回复，用于复现垂直布局被内容撑开的问题。`).join('\n'))
          }
        } catch {
          if (!response.headersSent) response.writeHead(500)
          response.end('fixture failed')
        }
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as { port: number }

    application = await electron.launch({
      args: [resolve(process.env.JANUS_DESKTOP_MAIN ?? 'out/main/index.js'), `--user-data-dir=${userDataDir}`],
      env: createDesktopTestEnv(root),
    })
    const page: Page = await application.firstWindow({ timeout: 30_000 })
    await page.waitForLoadState('domcontentloaded')
    await page.waitForFunction(() => Boolean((window as DesktopWindow).electron?.workspace?.create && (window as DesktopWindow).electron?.llm?.saveTerminalProvider))
    await page.evaluate(() => (window as DesktopWindow).electron.system.setLanguage('zh-CN'))

    const saved = await page.evaluate(async (baseURL) => (window as DesktopWindow).electron.llm.saveTerminalProvider('janus', {
      id: 'openai-compatible', name: 'Local fixture', authType: 'api-key' as never, enabled: true,
      apiKey: 'fixture-key', baseURL, modelId: 'fixture-model', models: ['fixture-model'],
      extra: { protocol: 'responses', chatModelLimits: { 'fixture-model': { contextWindow: 64000, maxOutputTokens: 8192 } } },
    }), `http://127.0.0.1:${port}/v1`)
    expect(saved.success).toBe(true)

    await page.evaluate(({ path }) => (window as DesktopWindow).electron.workspace.create({ name: 'Run config workspace', path }), { path: workspacePath })
    await page.setViewportSize({ width: 1400, height: 900 })
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    const skipGate = page.getByRole('button', { name: '稍后再说，先用本地功能' })
    await skipGate.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined)
    if (await skipGate.count()) await skipGate.click()

    const workspaceRow = page.locator('.ws').filter({ hasText: 'Run config workspace' }).first()
    await expect(workspaceRow).toBeVisible()
    await workspaceRow.hover()
    await workspaceRow.getByRole('button', { name: '更多操作' }).click()
    await page.getByRole('button', { name: '运行配置…', exact: true }).click()

    const launchModal = page.locator('.ws-config-modal')
    await expect(launchModal).toBeVisible()
    // Internal dialogs keep a localized close action in the upper-right corner.
    const modalBox = await launchModal.boundingBox()
    const closeBox = await launchModal.getByRole('button', { name: '关闭', exact: true }).boundingBox()
    expect(closeBox!.x).toBeGreaterThan(modalBox!.x + modalBox!.width * 2 / 3)
    expect(closeBox!.y).toBeLessThan(modalBox!.y + modalBox!.height / 3)
    const composer = launchModal.locator('textarea[placeholder*="生成"]')
    await expect(composer).toBeVisible()
    await composer.fill('运行 debug 版 start.exe')
    await composer.press('Enter')

    // 1. The model request carries exactly the restricted tool surface.
    await expect.poll(() => seenToolSets.length, { timeout: 30_000 }).toBeGreaterThan(0)
    const offered = seenToolSets.at(-1)!
    for (const name of EXPECTED_TOOL_SURFACE) expect(offered).toContain(name)
    for (const name of FORBIDDEN_TOOL_SURFACE) expect(offered).not.toContain(name)

    // 2. launch-config.edit lands in the middle-column form (config_change round-trip).
    await expect(launchModal).toContainText('debug-start.exe', { timeout: 20_000 })

    // 3. launch-config.apply raises the approval box; approve it.
    await expect(launchModal.getByText('Janus 请求写入运行配置')).toBeVisible({ timeout: 20_000 })
    // 布局 bug 回归：输出/审批期间 composer 仍在（不被下沿撑开挤没），且思考工具链 + 加载计时可见。
    await expect(composer).toBeVisible()
    await expect(launchModal.locator('[data-turn-elapsed]').first()).toBeVisible()
    await expect(launchModal.locator('.janus-tool-card').first()).toBeVisible()
    await expect(launchModal.locator('.janus-chat-thinking')).toHaveCount(3)
    await expect(launchModal.locator('.janus-chat-thinking[data-streaming="true"]')).toHaveCount(0)
    await expect(launchModal.locator('[data-config-state="draft"]')).toBeVisible()
    await expect(launchModal.locator('[data-config-state="applied"]')).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('run-config-assistant-streaming.png') })
    await launchModal.getByRole('button', { name: '批准' }).click()
    await expect(launchModal.getByText('Janus 请求写入运行配置', { exact: true })).toBeHidden()

    // 4. The config file lands on disk and the baseline settles (diff cleared).
    const storage = await page.evaluate(async () => (window as any).electron.workspaceStorage.data())
    const workspaceData = storage.find((item: { path: string }) => item.path === workspacePath)
    expect(workspaceData, 'saved config belongs to the workspace private data').toBeTruthy()
    const configPath = join(workspaceData.target, 'launch.json')
    await expect.poll(async () => {
      try { JSON.parse(await readFile(configPath, 'utf8')); return true } catch { return false }
    }, { timeout: 20_000 }).toBe(true)
    const landed = JSON.parse(await readFile(configPath, 'utf8'))
    expect(landed.configurations[0].program).toBe('debug-start.exe')

    // 5. 布局回归：长回复落定后 composer 仍完整在弹窗内（未被下沿撑开挤没），消息区内部滚动。
    await expect(launchModal).toContainText('第 39 行：运行配置助手生成的较长回复', { timeout: 20_000 })
    await expect(launchModal.locator('.janus-tool-card')).toHaveCount(3)
    await expect(launchModal.locator('[data-config-state="applied"]')).toBeVisible()
    await expect(launchModal.locator('.janus-chat-timeline-block').evaluateAll(elements => elements.map(element => element.getAttribute('data-kind'))))
      .resolves.toEqual(['reasoning', 'text', 'tool', 'reasoning', 'text', 'tool', 'reasoning', 'text', 'tool', 'text'])
    await expect(composer).toBeVisible()
    await expect.poll(async () => {
      const modal = await launchModal.boundingBox()
      const box = await composer.boundingBox()
      return Boolean(modal && box && box.y + box.height <= modal.y + modal.height + 1 && box.x + box.width <= modal.x + modal.width + 1)
    }, { timeout: 10_000 }).toBe(true)
    await expect.poll(() => launchModal.evaluate((el) => {
      const messages = el.querySelector('[class*="messages"]') as HTMLElement | null
      return Boolean(messages && messages.scrollHeight > messages.clientHeight)
    })).toBe(true)

    await page.screenshot({ path: test.info().outputPath('run-config-assistant-applied.png') })
  } finally {
    await application?.close().catch(() => undefined)
    server?.closeAllConnections()
    await new Promise<void>((resolve) => server?.close(() => resolve()))
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
