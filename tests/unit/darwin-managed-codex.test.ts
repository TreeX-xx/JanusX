import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AddressInfo } from 'node:net'
import { expect, it } from 'vitest'
import { DarwinCodexWorker } from '../../src/main/janus/superagent/darwin-codex'
import { SuperAgentWorkerBroker } from '../../src/main/janus/superagent/worker-broker'
import type { ManagedWorkerStart } from '../../src/main/janus/superagent/workers'
import { fixtureWorkerReport } from '../helpers/worker-report'

const command = process.env.JANUS_SUPERAGENT_CODEX_BINARY
it.skipIf(process.platform !== 'darwin' || !command)('runs a native turn, delivers its MCP report, resumes the thread and confirms group exit', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'Janus Worker 中文 ')))
  const broker = new SuperAgentWorkerBroker()
  let worker = new DarwinCodexWorker(randomUUID(), () => {})
  const reportId = randomUUID(), reports: unknown[] = []
  const server = createServer(async (req, res) => {
    if (!req.url?.endsWith('/responses')) { res.writeHead(404).end(); return }
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    const tools = body.tools.flatMap((tool: { name: string; tools?: {name: string}[] }) =>
      tool.tools?.map(child => ({ ...child, namespace: tool.name })) ?? [tool])
    const tool = tools.find((row: { name: string }) => row.name === 'report_work' || row.name.endsWith('__report_work'))
    const item = tool && !reports.length ? { type: 'function_call', id: 'report', call_id: 'report', name: tool.name,
      namespace: tool.namespace, status: 'completed', arguments: JSON.stringify({ reportId, kind: 'ready', summary: 'Completed local check', report: fixtureWorkerReport('Native process delivered report') }) }
      : { type: 'message', id: 'reply', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Done', annotations: [] }] }
    const response = { id: randomUUID(), object: 'response', status: 'completed', model: body.model, output: [item] }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const emit = (type: string, fields: object) => res.write('event: ' + type + '\ndata: ' + JSON.stringify({ type, ...fields }) + '\n\n')
    emit('response.created', { response: { ...response, status: 'in_progress', output: [] } })
    emit('response.output_item.added', { output_index: 0, item }); emit('response.output_item.done', { output_index: 0, item })
    emit('response.completed', { response }); res.end()
  })
  let pid: number | undefined
  try {
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
    const grant = await broker.issue(async (name, args) => { if (name === 'report_work') reports.push(args); return { accepted: true } })
    const entry = resolve('out/main/worker-mcp.js')
    const config = join(directory, 'config')
    await mkdir(config)
    await writeFile(join(config, 'config.toml'), [
      'model_provider = "fixture"', 'model = "local-test"', '[model_providers.fixture]', 'name = "Local test provider"',
      'base_url = "http://127.0.0.1:' + (server.address() as AddressInfo).port + '/v1"', 'wire_api = "responses"',
      '[projects.' + JSON.stringify(directory) + ']', 'trust_level = "trusted"',
    ].join('\n'))
    const options: ManagedWorkerStart = {
      command: command!, args: [], cwd: directory, env: { PATH: process.env.PATH, HOME: directory, CODEX_HOME: config },
      configure: () => ({ approvalPolicy: 'on-request', sandbox: 'read-only', config: {
        'mcp_servers.janus_worker': { command: process.execPath, args: [entry], env: {
          JANUS_WORKER_ENDPOINT: grant.endpoint, JANUS_WORKER_TOKEN: grant.token,
        } },
      } }),
      onProcessTree: async tree => { pid = tree[0].pid },
    }
    await worker.startManaged(options)
    const thread = worker.snapshot().threadId!
    expect(thread).toBeTruthy()
    await expect.poll(async () => JSON.stringify(await worker.managedCall('mcpServerStatus/list', {})), { timeout: 10000 }).toContain('report_work')
    expect(await worker.managedInput('Report the result of the fixture.', null)).toHaveProperty('turnId')
    await expect.poll(async () => {
      const state = worker.snapshot()
      const question = state.questions?.find(row => row.status === 'pending')
      if (question) {
        expect(question.questions).toHaveLength(1)
        expect(question.questions[0].text).toContain('report_work')
        await worker.command({ type: 'answer', requestId: question.id, version: question.version, controlEpoch: state.controlEpoch,
          answer: { answers: [{ id: '$action', selected: ['accept'] }] } })
      }
      if (state.approvals[0]) await worker.command({ type: 'approve', requestId: state.approvals[0].id, decision: 'accept', controlEpoch: state.controlEpoch })
      return reports.length
    }, { timeout: 15000 }).toBe(1)
    await expect.poll(() => worker.snapshot().turnId, { timeout: 5000 }).toBeNull()
    await worker.dispose()
    expect(() => process.kill(-pid!, 0)).toThrowError(expect.objectContaining({ code: 'ESRCH' }))
    worker = new DarwinCodexWorker(randomUUID(), () => {})
    await worker.startManaged({ ...options, threadId: thread })
    expect(worker.snapshot().threadId).toBe(thread)
    expect(reports).toHaveLength(1)
    await worker.dispose()
    expect(() => process.kill(-pid!, 0)).toThrowError(expect.objectContaining({ code: 'ESRCH' }))
  } finally {
    try { await worker.dispose() } finally {
      server.closeAllConnections(); server.close()
      await broker.close(); await rm(directory, { recursive: true, force: true })
    }
  }
}, 60_000)
