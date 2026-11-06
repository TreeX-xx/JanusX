import { randomUUID } from 'node:crypto'
import { createServer, type ServerResponse } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'
import { SuperAgentWorkers } from '../../src/main/janus/superagent/workers'
import { SuperAgentService } from '../../src/main/janus/superagent/service'
import { CodexConversation } from '../../src/main/terminal/codex-conversation'
import { environmentFixture } from '../helpers/superagent-environment-fixture'
import { hashText } from '../../src/main/janus/superagent/persistence'
import { WORKER_IDLE_MS } from '../../src/main/janus/superagent/lifecycle-store'

const binary = process.env.JANUS_SUPERAGENT_CODEX_BINARY
const entry = resolve('artifacts/build-check/main/worker-mcp.js')
const electron = createRequire(import.meta.url)('electron') as string

function respond(res: ServerResponse, model: string, item: any) {
  if (res.destroyed) return
  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  const event = (type: string, value: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`)
  const response = { id: randomUUID(), object: 'response', status: 'completed', model, output: [item],
    usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } }
  event('response.created', { response: { ...response, status: 'in_progress', output: [] } })
  event('response.output_item.added', { output_index: 0, item })
  event('response.output_item.done', { output_index: 0, item })
  event('response.completed', { response }); res.end()
}

describe.skipIf(!binary || process.platform !== 'win32')('P3/P5/P6 product service with real Codex and built Electron MCP', () => {
  it('edits, recalls, retires, resumes, rebuilds missing history and confirms background termination', async () => {
    const f = await environmentFixture(), scope = f.workspace.workspaceId
    const home = join(f.root, 'isolated-home'), codexHome = join(home, '.codex')
    await mkdir(codexHome, { recursive: true })
    const env: NodeJS.ProcessEnv = {}
    for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'PATHEXT', 'PROGRAMFILES', 'PROGRAMFILES(X86)']) if (process.env[key]) env[key] = process.env[key]
    Object.assign(env, { HOME: home, USERPROFILE: home, CODEX_HOME: codexHome, APPDATA: join(home, 'AppData/Roaming'), LOCALAPPDATA: join(home, 'AppData/Local'), NO_PROXY: '127.0.0.1,localhost', NO_COLOR: '1' })
    const requests: any[] = [], modelErrors: string[] = []
    const reports = { first: randomUUID(), resume: randomUUID() }
    const original = 'P3_RUN: implement the isolated fixture. ' + 'P5 requirement must remain available. '.repeat(2500) + 'P5_TAIL_REQUIREMENT'
    const originalPages: any[] = []
    let sourceResource = '', releaseFirst!: () => void, holdStop: ServerResponse | undefined
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve })
    const server = createServer(async (req, res) => {
      try {
        const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk)
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
        if (!req.url?.includes('responses')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"data":[]}'); return }
        requests.push(body)
        if (requests.length === 1) await firstGate
        const tools = (body.tools ?? []).flatMap((tool: any) => tool.type === 'namespace' ? (tool.tools ?? []).map((row: any) => ({ ...row, namespace: tool.name })) : [tool])
        const lastUser = JSON.stringify((body.input ?? []).filter((row: any) => row.role === 'user').at(-1))
        const completed = (id: string) => body.input?.some((row: any) => row.type === 'function_call_output' && row.call_id === id)
        const call = (name: string, id: string, args: object) => {
          const tool = tools.find((row: any) => row.name === name)
          if (!tool) throw new Error(`Native tool unavailable: ${name}; ${tools.map((row: any) => row.name).join(',')}`)
          respond(res, body.model, { id, call_id: id, type: 'function_call', name: tool.name, namespace: tool.namespace, status: 'completed', arguments: JSON.stringify(args) })
        }
        if (lastUser.includes('P3_STOP') && !lastUser.includes('P6_REBUILD')) {
          if (!completed('stop_background')) call('exec_command', 'stop_background', { cmd: `Start-Process -FilePath '${process.execPath.replaceAll("'", "''")}' -ArgumentList @('background-fixture.cjs') -WorkingDirectory '${f.repo.replaceAll("'", "''")}' -WindowStyle Hidden; Start-Sleep -Seconds 3`, shell: 'powershell.exe', login: false, yield_time_ms: 1000 })
          else { holdStop = res; res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': holding active turn\n\n') }
          return
        }
        if (lastUser.includes('P3_RESUME')) {
          if (!completed('resume_report')) { call('report_work', 'resume_report', { reportId: reports.resume, kind: 'ready', summary: 'Resumed', text: 'Read original context and continued.' }); return }
          respond(res, body.model, { id: randomUUID(), type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'P3_RESUMED', annotations: [] }] }); return
        } else if (!completed('read_assigned')) { call('read_work', 'read_assigned', {}); return }
        else {
          const pages: any[] = []
          const visit = (value: any) => {
            if (typeof value === 'string') { try { visit(JSON.parse(value)) } catch {} }
            else if (Array.isArray(value)) value.forEach(visit)
            else if (value && typeof value === 'object') {
              if (value.resourceId === sourceResource && value.status === 'available' && typeof value.offset === 'number') pages.push(value)
              else Object.values(value).forEach(visit)
            }
          }
          for (const item of body.input ?? []) if (item.type === 'function_call_output' && item.call_id?.startsWith('read_original_')) visit(item.output)
          const page = pages.sort((a, b) => b.offset - a.offset)[0]
          if (!page || page.nextOffset !== null) { call('read_resource', 'read_original_' + (page?.nextOffset ?? 0), page?.continuation ?? { resourceId: sourceResource }); return }
          originalPages.splice(0, originalPages.length, ...pages.sort((a, b) => a.offset - b.offset))
        }
        if (!completed('edit_code')) {
          call('exec_command', 'edit_code', { cmd: 'Set-Content -LiteralPath worker-result.txt -Value P3_NATIVE_EDIT', shell: 'powershell.exe', login: false }); return
        } else if (!completed('ask_user')) {
          call('request_user_input', 'ask_user', { questions: [
            { id: 'choice', header: 'Choose', question: 'Which output?', options: [{ label: 'Short', description: 'Short output' }, { label: 'Long', description: 'Long output' }] },
            { id: 'custom', header: 'Notes', question: 'Additional notes?', options: [{ label: 'None', description: 'No note' }, { label: 'Later', description: 'Add later' }] },
          ] }); return
        } else if (!completed('ready_report')) {
          call('report_work', 'ready_report', { reportId: reports.first, kind: 'ready', summary: 'Fixture implemented', text: 'Created worker-result.txt; read the original input; answered the native question.' }); return
        }
        respond(res, body.model, { id: randomUUID(), type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'P3_DONE', annotations: [] }] })
      } catch (error) { modelErrors.push(String(error)); res.destroy(error as Error) }
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const marker = join(f.root, 'inherited-mcp-started.txt'), inherited = join(f.root, 'inherited.cjs')
    await writeFile(inherited, `require('fs').writeFileSync(${JSON.stringify(marker)}, 'unexpected'); process.stdin.resume()`)
    const config = [
      'model="probe"', 'model_provider="local"', 'check_for_update_on_startup=false', 'features.default_mode_request_user_input=true',
      '[model_providers.local]', 'name="P3 isolated response fixture"', `base_url="http://127.0.0.1:${(server.address() as { port: number }).port}/v1"`, 'wire_api="responses"', 'requires_openai_auth=false',
      '[mcp_servers.inherited_writer]', `command=${JSON.stringify(process.execPath)}`, `args=[${JSON.stringify(inherited)}]`,
      `[projects.${JSON.stringify(f.repo)}]`, 'trust_level="trusted"',
    ].join('\n')
    await writeFile(join(codexHome, 'config.toml'), config)
    const engines: CodexConversation[] = []
    let nativeLimits: unknown, clockOffset = 0
    const workers = new SuperAgentWorkers(f.store, f.service, f.root,
      async () => ({ command: binary!, env, mcpCommand: electron, mcpEntry: entry }),
      (id, publish) => {
        const engine = new CodexConversation(id, publish), start = engine.startManaged.bind(engine)
        engine.startManaged = options => start({ ...options, configure: value => {
          nativeLimits = Object.fromEntries(Object.entries(value.config ?? {}).filter(([key]) => /limit|token|truncation|window/.test(key)))
          return options.configure(value)
        } })
        engines.push(engine); return engine
      }, 3000, () => Date.now() + clockOffset)
    const service = new SuperAgentService(f.store, async id => id === scope ? f.repo : undefined, f.service, workers)
    let workId = ''
    const current = () => workers.snapshots(scope).find(row => row.workId === workId)!
    const control = (value: any) => service.controlWorker({ workspaceId: scope, workId, executionId: current().executionId, ...value })
    let mcpDecisions = 0
    const decideMcp = async () => {
      for (const request of current()?.conversation.questions ?? []) if (request.questions.some(row => row.id === '$action') && request.status === 'pending') {
        mcpDecisions++
        await control({ type: 'answer', requestId: request.id, version: request.version, answer: { answers: request.questions.map(row => ({
          id: row.id, selected: row.id === '$action' ? ['accept'] : row.options.length ? [row.options[0].id] : [],
        })) } })
      }
    }
    let failure: unknown
    try {
      expect(existsSync(entry), 'Build the MCP entry with npm run build:check first').toBe(true)
      // Use a concise assigned goal while the lossless user original lives in the resource store.
      const input = await service.submitInput({ workspaceId: scope, conversationId: 'native-chat', eventId: randomUUID(), text: original })
      const work = await f.store.createWork(scope, { creationId: input.input.id, sourceInputId: input.input.id, title: 'Native recall', goal: 'Implement the isolated fixture after reading all requirements' })
      await f.service.reuse(scope, { workId: work.id, path: f.repo, branch: 'main' })
      const prepared = { work, receipt: input, operation: undefined }
      workId = prepared.work.id; sourceResource = prepared.receipt.input.resourceId
      expect(prepared.operation).toBeUndefined()
      await service.startWorker(scope, workId)
      await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0), { timeout: 15000 })
      const running = current()
      await service.appendWorker({ workspaceId: scope, conversationId: 'native-chat', eventId: randomUUID(), text: 'P3_SUPPLEMENT: preserve this constraint', workId, executionId: running.executionId })
      await vi.waitFor(async () => expect((await service.workDetail(scope, workId)).deliveries.at(-1)?.status).toBe('delivered'), { timeout: 10000 })
      expect(current().conversation.turnId).toBe(running.conversation.turnId)
      releaseFirst()
      await vi.waitFor(async () => {
        await decideMcp()
        for (const approval of current().conversation.approvals) {
          expect(approval.choices?.some(choice => choice.id === 'accept')).toBe(true)
          await control({ type: 'approve', requestId: approval.id, decision: 'accept' })
        }
        expect(current().conversation.questions?.some(request => request.questions.some(row => row.id === 'choice')), JSON.stringify({ current: current(), modelErrors })).toBe(true)
      // This phase now includes multiple lossless MCP pages before the edit and question.
      }, { timeout: 60000, interval: 100 })
      const question = current().conversation.questions!.find(request => request.questions.some(row => row.id === 'choice'))!
      await control({ type: 'answer', requestId: question.id, version: question.version, answer: { answers: [
        { id: 'choice', selected: ['1'] }, { id: 'custom', selected: [], text: '中文 custom answer' },
      ] } })
      await vi.waitFor(async () => { await decideMcp(); expect(current().phase, JSON.stringify({ current: current(), modelErrors })).toBe('ready') }, { timeout: 20000 })
      expect(existsSync(join(f.repo, 'worker-result.txt')), JSON.stringify(requests.at(-1).input.filter((row: any) => row.call_id === 'edit_code'))).toBe(true)
      expect(await readFile(join(f.repo, 'worker-result.txt'), 'utf8')).toContain('P3_NATIVE_EDIT')
      expect(JSON.stringify(requests)).toContain('user_note: 中文 custom answer')
      expect(JSON.stringify(requests.at(-1).input)).toContain('P3_SUPPLEMENT')
      expect((await service.workDetail(scope, workId)).reports).toHaveLength(1)
      expect(originalPages.length).toBeGreaterThan(1)
      expect(hashText(originalPages.map(page => page.text).join(''))).toBe(hashText(original))
      expect(originalPages.at(-1).text).toContain('P5_TAIL_REQUIREMENT')
      expect(existsSync(marker), 'Inherited MCP must never be started').toBe(false)
      const count = requests.length
      await new Promise(resolve => setTimeout(resolve, 300))
      expect(requests).toHaveLength(count)
      await vi.waitFor(() => expect(current()).toMatchObject({ phase: 'ready', stopConfirmed: true }), { timeout: 15000 })
      clockOffset += WORKER_IDLE_MS; await workers.sweep()
      expect(workers.snapshots(scope)).toEqual([])
      expect((await service.workDetail(scope, workId)).reports).toHaveLength(1)
      await service.continueWorker({ workspaceId: scope, conversationId: 'native-chat', eventId: randomUUID(), workId, text: 'P3_RESUME: explicitly continue' })
      await vi.waitFor(async () => { await decideMcp(); expect(current().report?.id, JSON.stringify(current())).toBe(reports.resume) }, { timeout: 20000 })
      await vi.waitFor(() => expect(current()).toMatchObject({ phase: 'ready', stopConfirmed: true }), { timeout: 15000 })
      expect(current().executionId).not.toBe(running.executionId)
      expect(current().conversation.threadId).toBe(running.conversation.threadId)
      expect(await readFile(join(codexHome, 'config.toml'), 'utf8')).toBe(config)
      await writeFile(join(f.repo, 'background-fixture.cjs'), `const fs=require('fs');fs.writeFileSync(${JSON.stringify(join(f.repo, 'background-started.txt'))},'started');setTimeout(()=>fs.writeFileSync(${JSON.stringify(join(f.repo, 'background-finished.txt'))},'leaked'),10000)`)
      await service.continueWorker({ workspaceId: scope, conversationId: 'native-chat', eventId: randomUUID(), workId, text: 'P3_STOP: start background work' })
      await vi.waitFor(async () => {
        for (const approval of current().conversation.approvals) await control({ type: 'approve', requestId: approval.id, decision: 'accept' })
        expect(existsSync(join(f.repo, 'background-started.txt')), JSON.stringify(current())).toBe(true)
      }, { timeout: 20000 })
      await new Promise(resolve => setTimeout(resolve, 1500))
      expect(existsSync(join(f.repo, 'background-finished.txt'))).toBe(false)
      await control({ type: 'stop' })
      await vi.waitFor(() => expect(current()).toMatchObject({ phase: 'stopped', stopConfirmed: true }), { timeout: 15000 })
      expect(engines.every(engine => engine.snapshot().connection === 'closed')).toBe(true)
      await new Promise(resolve => setTimeout(resolve, 10500))
      expect(existsSync(join(f.repo, 'background-finished.txt'))).toBe(false)
      expect((await service.workDetail(scope, workId)).reports).toHaveLength(2)
      // Seed a historical execution with a native thread known to be absent in this isolated home.
      // The actual native error must pass the same narrow recovery boundary as a missing rollout.
      const retained = await service.workDetail(scope, workId)
      const previous = await f.store.recordExecution(scope, { executionId: randomUUID(), instanceId: randomUUID(), workId, cwd: f.repo, expectedRevision: retained.work.revision })
      await f.store.bindExecution(scope, previous.id, { providerSessionId: '00000000-0000-4000-8000-000000000006' })
      reports.resume = randomUUID()
      await service.continueWorker({ workspaceId: scope, conversationId: 'native-chat', eventId: randomUUID(), workId, text: 'P3_RESUME P6_REBUILD: recover saved requirements' })
      await vi.waitFor(async () => { await decideMcp(); expect(current()?.report?.id, JSON.stringify(current())).toBe(reports.resume) }, { timeout: 30000 })
      await vi.waitFor(() => expect(current()).toMatchObject({ phase: 'ready', stopConfirmed: true, recovery: 'rebuilt' }), { timeout: 15000 })
      expect(current().conversation.threadId).not.toBe('00000000-0000-4000-8000-000000000006')
      expect((await service.workDetail(scope, workId)).executions).toHaveLength(retained.executions.length + 2)
      expect(mcpDecisions).toBeGreaterThan(0)
      expect(modelErrors).toEqual([])
    } catch (error) { failure = error; throw error }
    finally {
      await mkdir('artifacts/superagent-p6', { recursive: true })
      await writeFile('artifacts/superagent-p6/native-result.json', JSON.stringify({ failure: failure && String(failure), modelErrors,
        requestCount: requests.length, nativeLimits, pages: originalPages.map(({ resourceId, version, offset, end, total, nextOffset, text }) => ({ resourceId, version, offset, end, total, nextOffset,
          textLength: text.length, textHash: hashText(text), truncation: text.match(/.{0,60}(?:truncat|omitted).{0,100}/g) })),
        current: workId && current() }, null, 2))
      releaseFirst(); holdStop?.destroy()
      await service.close().catch(error => { if (!failure) throw error })
      server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
      await f.dispose()
    }
  }, 180000)
})
