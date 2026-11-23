import { _electron as electron, test, expect, type ElectronApplication } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { createDesktopTestEnv, seedIntroducedLearning } from './desktop-test-env'

test('Island reads selected memo nodes through HTTP without offering edits or creating files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'janus-memo-review-'))
  let application: ElectronApplication | undefined
  const turns: Array<{ nodeId: string; evidence: string; reply: string }> = []
  const failures: string[] = []
  let step = 0
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!body.stream) {
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify({ id: 'probe', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }] }))
        return
      }
      const index = step++
      const turn = turns[Math.floor(index / 2)]
      const read = index % 2 === 0
      const names = (body.tools ?? []).map((tool: { function?: { name: string } }) => tool.function?.name)
      expect(names).not.toContain('memo_edit')
      expect(names).not.toContain('memo_create')
      if (read) {
        expect(names).toContain('memo_read')
        expect(JSON.stringify(body.messages)).toContain(turn.nodeId)
      } else {
        expect(JSON.stringify(body.messages)).toContain(turn.evidence)
      }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const emit = (delta: unknown, finish_reason: string | null) => response.write(
        `data: ${JSON.stringify({ id: `r-${index}`, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
      )
      emit(read
        ? { role: 'assistant', tool_calls: [{ index: 0, id: `call-${index}`, type: 'function', function: { name: 'memo_read', arguments: JSON.stringify({ nodeId: turn.nodeId }) } }] }
        : { role: 'assistant', content: turn.reply }, null)
      emit({}, read ? 'tool_calls' : 'stop')
      response.end('data: [DONE]\n\n')
    } catch (error) {
      failures.push(String(error))
      response.statusCode = 500
      response.end('Fixture failed')
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const buildRoot = resolve(process.env.JANUS_DESKTOP_BUILD_ROOT ?? 'out')
    application = await electron.launch({
      args: [join(buildRoot, 'main/index.js'), `--user-data-dir=${join(root, 'user-data')}`],
      env: { ...createDesktopTestEnv(root), JANUSX_DEV_BUILD_ROOT: buildRoot, JANUSX_OFFICECLI_BINARY: join(root, 'absent-officecli') },
    })
    await seedIntroducedLearning(application.context())
    const page = await application.firstWindow()
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1400, 800))
    await page.waitForFunction(() => Boolean(window.electron?.memo))
    await page.evaluate(() => window.electron.system.setLanguage('en'))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture address')
    const saved = await page.evaluate(baseURL => window.electron.llm.saveTerminalProvider('janus', {
      id: 'openai-compatible', name: 'Local memo review', authType: 'api-key' as never, enabled: true,
      apiKey: 'fixture-key', baseURL, modelId: 'fixture-model', models: ['fixture-model'],
      extra: { protocol: 'chat-completions', chatModelLimits: { 'fixture-model': { contextWindow: 128000, maxOutputTokens: 4096 } } },
    }), `http://127.0.0.1:${address.port}/v1`)
    expect(saved.success).toBe(true)
    await page.evaluate(() => window.electron.llm.setTerminalDefault('janus', 'openai-compatible'))

    const memo = await page.evaluate(async () => {
      const api = window.electron.memo!
      const created = await api.create('Review A')
      const added = await api.edit(created.id, { expectedRevision: created.revision, operations: [
        { op: 'addNode', title: 'First' }, { op: 'addNode', title: 'Target' },
      ] })
      return api.edit(created.id, { expectedRevision: added.revision, operations: [
        { op: 'addPoint', nodeId: added.nodes[0].id, text: 'First reference' },
        { op: 'addPoint', nodeId: added.nodes[1].id, text: 'Target reference' },
      ] })
    })
    turns.push(
      { nodeId: memo.nodes[1].id, evidence: 'Target reference', reply: 'The target contains a reference.' },
      { nodeId: memo.nodes[0].id, evidence: 'First reference', reply: 'I can suggest an edit for the first reference.' },
    )
    const memoPath = join(root, 'user-data/janusx/memos', `${memo.id}.json`)
    const original = await readFile(memoPath, 'utf8')
    await page.reload()
    await page.locator('.janus-island').dblclick()
    await page.getByRole('button', { name: 'Open memo on the right' }).click()
    await page.getByRole('button', { name: 'Review A', exact: true }).click()
    const input = page.locator('.janus-chat-input')
    const chat = page.locator('.janus-chat')

    await page.getByRole('tab', { name: 'First', exact: true }).press('ArrowRight')
    await expect(page.getByRole('textbox', { name: 'Node title', exact: true })).toHaveValue('Target')
    await input.fill('Read the selected node.')
    await input.press('Enter')
    await expect(chat).toContainText(turns[0].reply)

    await page.getByRole('tab', { name: 'Target', exact: true }).press('ArrowLeft')
    await expect(page.getByRole('textbox', { name: 'Node title', exact: true })).toHaveValue('First')
    await input.fill('Edit the selected node.')
    await input.press('Enter')
    await expect(chat).toContainText(turns[1].reply)
    expect(await readFile(memoPath, 'utf8')).toBe(original)
    expect(step).toBe(4)
    expect(failures).toEqual([])
  } catch (error) {
    await test.info().attach('fixture-diagnostics', { body: JSON.stringify({ step, failures }), contentType: 'application/json' })
    throw error
  } finally {
    await application?.close().catch(() => undefined)
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    if (dirname(root) !== resolve(tmpdir()) || !basename(root).startsWith('janus-memo-review-')) throw new Error('Unexpected fixture directory')
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
