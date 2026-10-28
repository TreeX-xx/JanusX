import { _electron as electron, test, expect, type ElectronApplication } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { createDesktopTestEnv, seedIntroducedLearning } from './desktop-test-env'

test('real Chat UI sends memo tools through HTTP, persists edits and refreshes the selected node', async () => {
  const root = await mkdtemp(join(tmpdir(), 'janus-memo-review-'))
  let application: ElectronApplication | undefined
  let memoId = '', selectedId = '', step = 0
  const selectedIds: string[] = []
  const offered: string[][] = [], failures: string[] = []
  const requests: unknown[] = []
  const selectionFromPrompt = (body: unknown): string => {
    let selected: string | undefined
    const walk = (value: any) => {
      if (typeof value === 'string') {
        const line = value.split('\n').find(line => line.startsWith('Bound memo overview (read points through memo_read): '))
        if (line) {
          const context = JSON.parse(line.slice(line.indexOf('{')))
          if (context.id === memoId && context.selectedNode?.status === 'selected') selected = context.selectedNode.nodeId
        }
      } else if (Array.isArray(value)) value.forEach(walk)
      else if (value && typeof value === 'object') Object.values(value).forEach(walk)
    }
    walk(body)
    if (!selected) throw new Error('Missing selected star in actual model prompt')
    return selected
  }
  const latestMemo = (body: unknown) => {
    let found: any
    const walk = (value: any) => {
      if (typeof value === 'string') { try { walk(JSON.parse(value)) } catch {} }
      else if (Array.isArray(value)) value.forEach(walk)
      else if (value && typeof value === 'object') {
        if (value.id === memoId && Array.isArray(value.nodes)) found = value
        Object.values(value).forEach(walk)
      }
    }
    walk(body)
    return found
  }
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        const names = (body.tools ?? []).map((tool: any) => tool.name ?? tool.function?.name)
        if (!body.stream) {
          response.writeHead(200, { 'Content-Type': 'application/json' })
          response.end(JSON.stringify({ id: 'probe', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }] }))
          return
        }
        requests.push(body)
        offered.push(names)
        const index = step++
        const memo = latestMemo(body)
        if ([0, 4, 7, 10].includes(index)) { selectedId = selectionFromPrompt(body); selectedIds.push(selectedId) }
        let name: string | undefined, args: unknown, text = 'Unbound reply'
        if ([0, 4, 7, 10].includes(index)) { name = 'memo_read'; args = [0, 10].includes(index) ? {} : { nodeId: selectedId } }
        if ([1, 11].includes(index)) { name = 'memo_read'; args = { nodeId: selectedId } }
        if ([2, 5, 8, 12].includes(index)) {
          if (!memo || !Number.isInteger(memo.revision)) throw new Error('Missing real memo tool result')
          const operations = [2, 12].includes(index) ? [{ op: 'addPoint', nodeId: selectedId, text: 'Chat created record' }]
            : index === 5 ? [{ op: 'editPoint', pointId: memo.points.at(-1).id, text: 'Chat edited record' }]
            : [{ op: 'removePoint', pointId: memo.points.at(-1).id }]
          name = 'memo_edit'; args = { expectedRevision: memo.revision, operations }
        }
        if ([3, 6, 9, 13].includes(index)) {
          if (!memo?.success) throw new Error('Missing successful edit result')
          text = `Memo Review A updated ${index}`
        }
        if (index === 15) { name = 'memo_create'; args = { title: '工程排期' } }
        if (index === 16) {
          // Discover the new identity from the actual tool response.
          const walk = (value: any) => {
            if (typeof value === 'string') { try { walk(JSON.parse(value)) } catch {} }
            else if (Array.isArray(value)) value.forEach(walk)
            else if (value && typeof value === 'object') {
              if (value.created === true && value.title === '工程排期') memoId = value.id
              Object.values(value).forEach(walk)
            }
          }
          walk(body)
          name = 'memo_read'; args = {}
        }
        if (index === 17) { name = 'memo_edit'; args = { expectedRevision: memo.revision, operations: [{ op: 'addNode', title: '092' }, { op: 'addNode', title: '093' }] } }
        if (index === 18) { name = 'memo_read'; args = {} }
        if (index === 19) {
          const records = [['备忘录', 'shell功能扩展', '工具界面提升', '界面小改', '用量统计'], ['远程基座', 'docker（基础）', 'http（基础）']]
          name = 'memo_edit'; args = { expectedRevision: memo.revision, operations: memo.nodes.flatMap((node: any, nodeIndex: number) => records[nodeIndex].map(text => ({ op: 'addPoint', nodeId: node.id, text }))) }
        }
        if (index === 20) text = '工程排期已保存到左侧备忘录'
        response.writeHead(200, { 'Content-Type': 'text/event-stream' })
        const emit = (event: unknown) => response.write(`data: ${JSON.stringify(event)}\n\n`)
        if (request.url?.endsWith('/responses')) {
          emit({ type: 'response.created', response: { id: `r-${index}`, created_at: 1, model: 'fixture-model' } })
          if (name) {
            const item = { type: 'function_call', id: `item-${index}`, call_id: `call-${index}`, name, arguments: JSON.stringify(args), status: 'completed' }
            emit({ type: 'response.output_item.added', output_index: 0, item: { ...item, arguments: '' } })
            emit({ type: 'response.function_call_arguments.delta', item_id: item.id, output_index: 0, delta: item.arguments })
            emit({ type: 'response.output_item.done', output_index: 0, item })
          } else {
            const item = { type: 'message', id: `text-${index}` }
            emit({ type: 'response.output_item.added', output_index: 0, item })
            emit({ type: 'response.output_text.delta', item_id: item.id, delta: text })
            emit({ type: 'response.output_item.done', output_index: 0, item })
          }
          emit({ type: 'response.completed', response: { usage: { input_tokens: 10, output_tokens: 10 } } })
        } else {
          emit({ id: `r-${index}`, object: 'chat.completion.chunk', choices: [{ index: 0, delta: name ? { role: 'assistant', tool_calls: [{ index: 0, id: `call-${index}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } : { role: 'assistant', content: text }, finish_reason: null }] })
          emit({ id: `r-${index}`, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: name ? 'tool_calls' : 'stop' }] })
          response.write('data: [DONE]\n\n')
        }
        response.end()
      } catch (error) {
        failures.push(String(error)); response.statusCode = 500; response.end('Fixture failed')
      }
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const buildRoot = resolve('out')
    application = await electron.launch({ args: [join(buildRoot, 'main/index.js'), `--user-data-dir=${join(root, 'user-data')}`], env: { ...createDesktopTestEnv(root), JANUSX_DEV_BUILD_ROOT: buildRoot } })
    const page = await application.firstWindow()
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1400, 800))
    await expect.poll(async () => Math.abs(await page.evaluate(() => window.innerWidth) - 1400)).toBeLessThanOrEqual(1)
    await page.waitForFunction(() => Boolean(window.electron?.memo))
    await page.evaluate(() => window.electron.system.setLanguage('en'))
    const saved = await page.evaluate(baseURL => window.electron.llm.saveTerminalProvider('janus', {
      id: 'openai-compatible', name: 'Local memo review', authType: 'api-key' as never, enabled: true,
      apiKey: 'fixture-key', baseURL, modelId: 'fixture-model', models: ['fixture-model'],
      extra: { chatModelLimits: { 'fixture-model': { contextWindow: 128000, maxOutputTokens: 4096 } } },
    }), `http://127.0.0.1:${(server.address() as any).port}/v1`)
    expect(saved.success).toBe(true)
    const memo = await page.evaluate(async () => {
      const created = await window.electron.memo!.create('Review A')
      return window.electron.memo!.edit(created.id, { expectedRevision: 0, operations: [{ op: 'addNode', title: 'First' }, { op: 'addNode', title: 'Target' }] })
    })
    memoId = memo.id
    await seedIntroducedLearning(page)
    await page.reload()
    await page.locator('.janus-island').dblclick()
    await page.getByRole('tab', { name: 'Chat', exact: true }).click()
    await page.getByRole('button', { name: 'Open memo on the left' }).click()
    await page.getByRole('button', { name: 'Review A', exact: true }).click()
    await page.getByRole('tab', { name: 'First', exact: true }).press('ArrowRight')
    await expect(page.getByRole('textbox', { name: 'Node title', exact: true })).toHaveValue('Target')
    const send = async (prompt: string, index: number) => {
      await page.locator('textarea.janus-chat-input').fill(prompt)
      await page.locator('textarea.janus-chat-input').press('Enter')
      await expect(page.locator('.janus-chat')).toContainText(`Memo Review A updated ${index}`)
      expect(failures).toEqual([])
    }
    await send('Add "Chat created record" to the currently selected star.', 3)
    await expect(page.getByRole('textbox', { name: 'Point text' })).toHaveValue('Chat created record')
    const created = JSON.parse(await readFile(join(root, 'user-data/janusx/memos', `${memoId}.json`), 'utf8'))
    expect(created.nodes[1].points[0].source).toMatchObject({ conversationId: expect.any(String), messageId: expect.any(String) })
    await send('Change that record in the current star to "Chat edited record".', 6)
    await expect(page.getByRole('textbox', { name: 'Point text' })).toHaveValue('Chat edited record')
    await send('Delete that record from the current star.', 9)
    await expect(page.locator('.memo-point')).toHaveCount(0)
    const deleted = JSON.parse(await readFile(join(root, 'user-data/janusx/memos', `${memoId}.json`), 'utf8'))
    expect(deleted.nodes[1].points).toEqual([])
    expect(deleted.revision).toBe(4)
    expect(deleted.nodes[0].points).toEqual([])
    await page.getByRole('tab', { name: 'Target', exact: true }).press('ArrowLeft')
    await expect(page.getByRole('textbox', { name: 'Node title', exact: true })).toHaveValue('First')
    await send('Add "Chat created record" to the current star after switching.', 13)
    await expect(page.getByRole('textbox', { name: 'Point text' })).toHaveValue('Chat created record')
    const switched = JSON.parse(await readFile(join(root, 'user-data/janusx/memos', `${memoId}.json`), 'utf8'))
    expect(switched.nodes[0].points[0].text).toBe('Chat created record')
    expect(switched.nodes[1].points).toEqual([])
    expect(switched.revision).toBe(5)
    expect(selectedIds).toEqual([memo.nodes[1].id, memo.nodes[1].id, memo.nodes[1].id, memo.nodes[0].id])
    // Inspect the actual HTTP model context; Electron contextBridge APIs are immutable.
    expect(JSON.stringify(requests[0])).toContain(memoId)
    expect(JSON.stringify(requests[0])).toContain('selectedNode')
    expect(offered.slice(0, 14).every(names => names.includes('memo_read') && names.includes('memo_edit'))).toBe(true)
    await page.screenshot({ path: test.info().outputPath('chat-memo-complete.png') })
    await page.getByRole('button', { name: 'Leave memo' }).click()
    await page.locator('textarea.janus-chat-input').fill('Reply without a memo.')
    await page.locator('textarea.janus-chat-input').press('Enter')
    await expect(page.locator('.janus-chat')).toContainText('Unbound reply')
    expect(offered.at(-1)).toContain('memo_create')
    await page.locator('textarea.janus-chat-input').fill('帮我建立一个关于工程排期的里程碑备忘录\n092节点为备忘录/shell功能扩展/工具界面提升/界面小改/用量统计 093节点为远程基座/docker（基础）/http（基础）')
    await page.locator('textarea.janus-chat-input').press('Enter')
    await expect(page.locator('.janus-chat')).toContainText('工程排期已保存到左侧备忘录')
    await page.getByRole('button', { name: 'Open memo on the left' }).click()
    await expect(page.getByRole('textbox', { name: 'Node title', exact: true })).toHaveValue('092')
    await expect(page.getByRole('textbox', { name: 'Point text' })).toHaveCount(5)
    const schedule = JSON.parse(await readFile(join(root, 'user-data/janusx/memos', `${memoId}.json`), 'utf8'))
    expect(schedule.title).toBe('工程排期')
    expect(schedule.nodes.map((node: any) => node.title)).toEqual(['092', '093'])
    expect(schedule.nodes.map((node: any) => node.points.length)).toEqual([5, 3])
    await expect.poll(async () => {
      const state = await page.evaluate(() => window.electron.janusChat!.load())
      return state?.conversations.find(conversation => conversation.id === state.activeConversationId)?.memoId
    }).toBe(memoId)
    await page.reload()
    await page.locator('.janus-island').dblclick()
    await page.getByRole('tab', { name: 'Chat', exact: true }).click()
    await page.getByRole('button', { name: 'Open memo on the left' }).click()
    await expect(page.getByRole('textbox', { name: 'Node title', exact: true })).toHaveValue('092')
    await expect(page.getByRole('textbox', { name: 'Point text' })).toHaveCount(5)
    expect(failures).toEqual([])
    await test.info().attach('review-evidence', { body: JSON.stringify({ steps: step, offered, failures, finalRevision: switched.revision, selectedIds }), contentType: 'application/json' })
  } catch (error) {
    await test.info().attach('fixture-diagnostics', { body: JSON.stringify({ step, offered, failures, requests }), contentType: 'application/json' })
    throw error
  } finally {
    await application?.close().catch(() => undefined)
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    if (dirname(root) !== resolve(tmpdir()) || !basename(root).startsWith('janus-memo-review-')) throw new Error('Unexpected fixture directory')
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
