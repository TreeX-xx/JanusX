import { ManagedEngineFixture as Engine } from '../helpers/superagent-managed-fixture'
import { randomUUID } from 'node:crypto'
import { writeFile, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SuperAgentWorkers } from '../../src/main/janus/superagent/workers'
import { SuperAgentService } from '../../src/main/janus/superagent/service'
import { environmentFixture } from '../helpers/superagent-environment-fixture'
import { estimateContextTokens } from '@janus-agent/chat-core'
import { WorkerSettingsEngines, WorkerSettingsStore } from '../../src/main/janus/superagent/worker-settings'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
async function setup(withSettings = false) {
  const f = await environmentFixture(), scope = f.workspace.workspaceId
  cleanups.push(() => f.dispose())
  const entry = join(f.root, 'worker-mcp.js'); await writeFile(entry, '')
  const engines: Engine[] = []
  const factory = (_id: string, publish: ConstructorParameters<typeof Engine>[0]) => {
    const engine = new Engine(publish); engines.push(engine)
    if (withSettings) {
      engine.state.model = 'native'; engine.state.effort = 'medium'
      const command = engine.command.bind(engine)
      engine.command = async (...args: any[]) => {
        const value = args[0]
        if (value.type === 'models') engine.state.models = [
          { model: 'native', displayName: 'Native', description: '', defaultEffort: 'medium', efforts: [{ effort: 'medium', description: '' }] },
          { model: 'alternate', displayName: 'Alternate', description: '', defaultEffort: 'high', efforts: [{ effort: 'high', description: '' }] },
        ]
        if (value.type === 'settings') { engine.state.model = value.model; engine.state.effort = value.effort }
        return command()
      }
    }
    return engine
  }
  const settings = new WorkerSettingsEngines(new WorkerSettingsStore(f.root), factory)
  const workers = new SuperAgentWorkers(f.store, f.service, f.root, async () => ({ command: 'fixture', env: {}, mcpCommand: process.execPath, mcpEntry: entry }),
    withSettings ? settings.create : factory, 60_000)
  cleanups.push(async () => { await workers.close().catch(() => undefined) })
  const work = await f.work(); await f.service.reuse(scope, { workId: work.id, path: f.repo, branch: 'main' })
  const append = (text: string, eventId = randomUUID()) => {
    const current = workers.snapshots(scope).at(-1)!
    return workers.append({ workspaceId: scope, conversationId: 'chat', workId: work.id, executionId: current.executionId, eventId, text })
  }
  return { ...f, scope, workers, work, engines, settings, append,
    start: () => workers.start(scope, work.id), current: () => workers.snapshots(scope).at(-1)!,
    control: (control: any) => workers.control({ workspaceId: scope, workId: work.id, executionId: workers.snapshots(scope).at(-1)!.executionId, ...control }) }
}

describe('owned Worker durable execution boundary', () => {
  it('delivers compact scope changes only after acceptance and keeps the complete assignment readable', async () => {
    const f = await setup()
    const source = (await f.store.workDetail(f.scope, f.work.id)).inputs[0]
    const context = { goal: 'Implement the SuperAgent HTML prototype', constraints: ['Right-aligned user bubbles', 'Keep offline support'], backgroundInputIds: [] }
    await f.store.prepareDispatch(f.scope, f.work.id, source.id, context)
    await f.start(); const engine = f.engines[0]
    expect(engine.config.developerInstructions).toContain('A status-only question calls for checking and reporting')
    expect(engine.config.developerInstructions).toContain('preserve others’ changes')
    const dispatch = async (text: string, constraints = context.constraints, withdrawConstraints?: Array<{ text: string; sourceQuote: string }>) => {
      const eventId = randomUUID()
      const { input } = await f.store.receiveInput(f.workspace, { workspaceId: f.scope, conversationId: 'chat', eventId, text })
      await f.store.prepareDispatch(f.scope, f.work.id, input.id, { ...context, constraints, withdrawConstraints })
      await f.append(text, eventId)
    }
    await dispatch('两段式主题 写入html了吗')
    const status = engine.inputs[1].text
    expect(status).toContain('两段式主题 写入html了吗')
    expect(status).toContain('Context updated; use read_work')
    for (const repeated of [context.goal, ...context.constraints, 'Assigned work:', 'Baseline HEAD:', f.work.id]) expect(status).not.toContain(repeated)
    engine.deferInput = true
    await dispatch('Replace bubble alignment with compact titles', ['Compact titles', 'Keep offline support'],
      [{ text: 'Right-aligned user bubbles', sourceQuote: 'Replace bubble alignment with compact titles' }])
    expect(engine.inputs).toHaveLength(2)
    await f.control({ type: 'approve', requestId: 'late-approval', decision: 'accept' })
    const change = engine.inputs[2].text
    expect(change).toContain('Explicitly withdrawn constraints (see original user instructions):\n- Right-aligned user bubbles')
    expect(change).toContain('Added constraints:\n- Compact titles')
    expect(change).not.toContain('Keep offline support')
    expect(await engine.tool('read_work', {})).toMatchObject({ assignmentRevision: 3,
      intent: { goal: { text: context.goal }, constraints: expect.arrayContaining([{ text: expect.stringContaining('Compact titles') }, { text: expect.stringContaining('Keep offline support') }].map(row => expect.objectContaining(row))) } })
    await dispatch('Check the current result', ['Compact titles', 'Keep offline support'])
    expect(engine.inputs[3].text).not.toContain('Added constraints:')
    expect((await f.store.workDetail(f.scope, f.work.id)).deliveries.every(row => row.status === 'delivered')).toBe(true)
  })

  it('validates structured reports, binds host identity and exposes the same evidence to the coordinator', async () => {
    const f = await setup(); await f.start(); const engine = f.engines[0]
    const report = { reportId: randomUUID(), kind: 'ready', summary: 'Analysis finished; runtime check failed.', report: {
      completed: ['Analyzed the requested issue'], artifacts: [],
      checks: [{ method: 'Fixture check', status: 'failed', result: 'Expected failure', evidence: ['fixture.log'] }],
      limitations: ['Runtime repair remains'], questions: [], details: '## Evidence\n\nOriginal details.',
    } }
    await expect(engine.tool('report_work', { ...report, report: { ...report.report, checks: [] } })).rejects.toThrow()
    await expect(engine.tool('report_work', report)).rejects.toThrow('failed check')
    expect((await f.store.workDetail(f.scope, f.work.id)).reports).toHaveLength(0)
    report.kind = 'failure'
    await engine.tool('report_work', report); await engine.tool('report_work', report)
    const detail = await f.store.workDetail(f.scope, f.work.id)
    expect(detail.reports).toHaveLength(1)
    expect(detail.reports[0]).toMatchObject({ workId: f.work.id, executionId: f.current().executionId })
    const body = await f.store.readResource(f.scope, detail.reports[0].resourceId)
    expect(JSON.parse(body.text)).toMatchObject({ schema: 'janus-worker-report/1', summary: report.summary, report: report.report })
    const card = await engine.tool('read_work', {}) as any
    expect(card.report.reviewInstruction).toContain('not acceptance')
    const page = await engine.tool('read_resource', { resourceId: detail.reports[0].resourceId }) as any
    expect(page.text).toBe(body.text)
  })
  it('retains native request IDs and legacy or child origins without persisting arbitrary payloads', async () => {
    const f = await setup(); await f.start()
    const engine = f.engines[0]
    engine.options!.onEvent!({ id: 81, method: 'applyPatchApproval', params: { conversationId: 'native-child', callId: 'native-item', fileChanges: { secret: 'DO_NOT_LOG_REQUEST_BODY' } } })
    engine.options!.onEvent!({ method: 'serverRequest/resolved', params: { requestId: 81 } })
    await vi.waitFor(async () => {
      const log = await f.workers.readLog(f.scope, f.current().executionId)
      expect(log.text).toContain('applyPatchApproval')
      expect(log.text).toContain('native-child')
      expect(log.text).toContain('"id":81')
      expect(log.text).toContain('serverRequest/resolved')
      expect(log.text).not.toContain('DO_NOT_LOG_REQUEST_BODY')
    })
  })

  it('applies Worker defaults before input and carries a next-turn override through execution replacement', async () => {
    const f = await setup(true)
    const first = await f.start()
    expect(f.engines[0].state.model).toBe('native')
    await f.settings.get(first.instanceId).configure({ terminal: 'codex', model: 'alternate', effort: 'high' })
    await f.append('Steer the active turn')
    expect(f.engines[0].state.model).toBe('native')
    expect(f.engines[0].inputs).toHaveLength(2)
    f.engines[0].end(); await f.append('Start the next turn')
    const next = f.current()
    expect(next.executionId).not.toBe(first.executionId)
    expect(next.conversation).toMatchObject({ model: 'alternate', effort: 'high' })
    expect(f.engines[1].inputs).toHaveLength(1)
    expect(() => f.settings.get(first.instanceId)).toThrow('unavailable')
    await f.settings.get(next.instanceId).configure(null)
    f.engines[1].end(); await f.append('Continue using native defaults')
    expect(f.current().conversation).toMatchObject({ model: 'native', effort: 'medium' })
    expect((await f.store.workDetail(f.scope, f.work.id)).deliveries.every(row => row.status === 'delivered')).toBe(true)
  })

  it('prepares private temp space per execution and removes it only after process exit', async () => {
    const f = await setup(); await f.start()
    const first = f.engines[0], scratch = first.options!.env.TMP!
    expect(first.options!.env).toMatchObject({ TEMP: scratch, TMPDIR: scratch })
    expect((await stat(scratch)).isDirectory()).toBe(true)
    expect(first.options!.args).toContain(`shell_environment_policy.set.TEMP=${JSON.stringify(scratch.replaceAll('\\', '/'))}`)
    expect(first.config.developerInstructions).toContain('Implement and verify the assigned work autonomously')
    await writeFile(join(scratch, 'test-output'), 'kept while running')
    first.exit = async () => { expect(await readFile(join(scratch, 'test-output'), 'utf8')).toBe('kept while running') }
    first.end(); await f.append('Continue with the next check')
    await vi.waitFor(() => expect(f.engines).toHaveLength(2))
    expect(f.engines[1].options!.env.TMP).not.toBe(scratch)
    await expect(stat(scratch)).rejects.toMatchObject({ code: 'ENOENT' })
    const secondScratch = f.engines[1].options!.env.TMP!
    await f.workers.close()
    await expect(stat(secondScratch)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('binds native identities and steers bounded input with lossless MCP recall, without replay or guessing ready', async () => {
    const f = await setup(), state = await f.start(), engine = f.engines[0]
    expect(engine.config.config.mcp_servers.inherited.enabled).toBe(false)
    expect(engine.options!.args).toContain('features.plugins=false')
    const supplement = '完整要求 '.repeat(9000), id = randomUUID()
    await f.append(supplement, id); await f.append(supplement, id)
    expect(engine.inputs).toHaveLength(2)
    expect(engine.inputs[0].text).toContain('Assigned work:')
    expect(engine.inputs[1].text).not.toContain('Assigned work:')
    expect(engine.inputs[1].text).not.toContain('Work background (data):')
    expect(engine.inputs[1]).toMatchObject({ turn: state.conversation.turnId })
    expect(estimateContextTokens(engine.inputs[1].text)).toBeLessThanOrEqual(8000)
    expect(engine.inputs[1].text).toContain('Input truncated. Continue with read_resource')
    const detail = await f.store.workDetail(f.scope, f.work.id)
    expect(detail.executions).toHaveLength(1)
    expect(detail.executions[0]).toMatchObject({ providerSessionId: engine.state.threadId, nativeTurnId: engine.state.turnId })
    expect(detail.deliveries.every(row => row.status === 'delivered')).toBe(true)
    let offset = 0, recalled = ''
    do {
      const page = await engine.tool('read_resource', { resourceId: detail.inputs.at(-1)!.resourceId, offset }) as any
      expect(page.status).toBe('available'); recalled += page.text; offset = page.nextOffset
    } while (offset !== null)
    expect(recalled).toBe(supplement)
    engine.end(); expect(f.current().phase).toBe('idle')
    expect(detail.reports).toHaveLength(0)
  })

  it('saves capability-bound reports once; old reports cannot cover a new supplement or become the latest again', async () => {
    const f = await setup(); await f.start(); const engine = f.engines[0]
    const report = { reportId: randomUUID(), kind: 'ready', summary: 'Done', text: 'Checked the fixture' }
    await engine.tool('report_work', report)
    const old = await f.store.workDetail(f.scope, f.work.id)
    await f.append('Additional constraint')
    await engine.tool('report_work', report)
    engine.end(); expect(f.current().phase).toBe('idle')
    const newer = { ...report, reportId: randomUUID(), kind: 'question', summary: 'Need input' }
    await engine.tool('report_work', newer); await engine.tool('report_work', report)
    expect(f.current().report?.id).toBe(newer.reportId)
    expect((await f.store.workDetail(f.scope, f.work.id)).reports).toHaveLength(2)
    expect(await engine.tool('read_resource', { resourceId: old.inputs[0].resourceId })).toMatchObject({ text: 'Implement a feature' })
    await expect(engine.tool('report_work', { ...report, workId: randomUUID() })).rejects.toThrow()
    await expect(engine.tool('read_resource', { resourceId: randomUUID() })).rejects.toThrow('outside')
  })

  it('keeps supplements pending at approvals and records uncertain RPC delivery without retrying', async () => {
    const f = await setup(); await f.start(); const engine = f.engines[0]
    engine.state.approvals = [{ id: 'approve', kind: 'command', description: 'Review command' }]; engine.changed()
    const id = randomUUID(); await f.append('Wait for approval', id)
    expect(engine.inputs).toHaveLength(1)
    expect((await f.store.workDetail(f.scope, f.work.id)).deliveries.at(-1)?.status).toBe('pending')
    engine.deliveryError = true
    await expect(f.control({ type: 'approve', requestId: 'approve', decision: 'accept' })).rejects.toThrow('receipt lost')
    await f.append('Wait for approval', id)
    expect(engine.inputs).toHaveLength(2)
    expect((await f.store.workDetail(f.scope, f.work.id)).deliveries.at(-1)?.status).toBe('unknown')
  })

  it('keeps an input pending when a native decision arrives after the durable send marker but before the RPC', async () => {
    const f = await setup(); await f.start(); const engine = f.engines[0]
    engine.deferInput = true
    await f.append('Input raced with native approval')
    expect(engine.inputs).toHaveLength(1)
    expect((await f.store.workDetail(f.scope, f.work.id)).deliveries.at(-1)).toMatchObject({ status: 'pending', executionId: null })
    await f.control({ type: 'approve', requestId: 'late-approval', decision: 'accept' })
    expect(engine.inputs).toHaveLength(2)
    expect((await f.store.workDetail(f.scope, f.work.id)).deliveries.at(-1)?.status).toBe('delivered')
  })

  it('continues an idle native thread with a new execution and rejects old capabilities and stale decisions', async () => {
    const f = await setup(), old = await f.start(), first = f.engines[0]
    first.end(); const next = await f.append('Explicitly continue')
    expect(next.executionId).not.toBe(old.executionId)
    expect(f.engines[1].options?.threadId).toBe(old.conversation.threadId)
    expect(f.engines[1].inputs).toHaveLength(1)
    expect(f.engines[1].inputs[0].text).not.toContain('User input 1 (resource')
    expect(f.engines[1].inputs[0].text).not.toContain('Assigned work:')
    await expect(first.tool('read_work')).rejects.toThrow('unavailable')
    await expect(f.workers.control({ workspaceId: f.scope, workId: f.work.id, executionId: old.executionId, type: 'stop' })).rejects.toThrow('changed')
  })

  it('flushes saved input when a native decision is resolved after the answer transport returns', async () => {
    const f = await setup(); await f.start(); const engine = f.engines[0]
    engine.state.questions = [{ id: 8, version: 1, status: 'submitting', questions: [], blocking: true }]; engine.changed()
    await f.append('Pending while native acknowledgement arrives')
    expect(engine.inputs).toHaveLength(1)
    engine.state.questions = []; engine.changed()
    engine.options?.onEvent?.({ method: 'serverRequest/resolved', params: { requestId: 8 } })
    await vi.waitFor(() => expect(engine.inputs).toHaveLength(2), { timeout: 10000 })
    expect(engine.inputs[1].turn).toBe(engine.inputs[0].turn ?? engine.state.turnId)
  })

  it('does not turn a failed native turn into ready even if a report was saved before the failure', async () => {
    const f = await setup(); await f.start(); const engine = f.engines[0]
    await engine.tool('report_work', { reportId: randomUUID(), kind: 'ready', summary: 'Premature report', text: 'Before native failure' })
    engine.options?.onEvent?.({ method: 'turn/completed', params: { threadId: engine.state.threadId, turn: { id: engine.state.turnId, status: 'failed', error: { message: 'Native fixture failure' } } } })
    await vi.waitFor(() => expect(f.current()).toMatchObject({ phase: 'failed', stopConfirmed: true }), { timeout: 10000 })
    expect(f.current().diagnostic).toContain('Native fixture failure')
  })

  it('keeps the environment occupied until owned process exit is confirmed', async () => {
    const f = await setup(); await f.start()
    let exited!: () => void
    f.engines[0].exit = () => new Promise(resolve => { exited = resolve })
    const stopping = f.control({ type: 'stop' })
    await vi.waitFor(() => expect(exited).toBeTypeOf('function'))
    await expect(f.service.acquire(f.scope, f.work.id)).rejects.toThrow('occupied')
    expect(f.current().stopConfirmed).toBe(false)
    exited(); await stopping
    const lease = await f.service.acquire(f.scope, f.work.id); await f.service.release(lease.id)
    expect(f.current()).toMatchObject({ phase: 'stopped', stopConfirmed: true })
  })

  it('quarantines an environment after an unconfirmed stop and stops on identity drift', async () => {
    const f = await setup(); await f.start()
    const scratch = f.engines[0].options!.env.TMP!
    f.engines[0].exit = async () => { throw new Error('Process tree unconfirmed') }
    await f.git(['checkout', '-b', 'drift'])
    await f.workers.sweep()
    expect(f.current()).toMatchObject({ phase: 'failed', stopConfirmed: false })
    await f.git(['checkout', 'main'])
    await expect(f.service.acquire(f.scope, f.work.id)).rejects.toThrow('occupied')
    await expect(f.start()).rejects.toThrow('Stop the previous')
    expect((await stat(scratch)).isDirectory()).toBe(true)
    f.engines[0].exit = async () => {}
    await f.control({ type: 'stop' })
    await expect(stat(scratch)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('serializes duplicate commit calls, persists a reviewed outcome and does not replay old requests', async () => {
    const f = await setup(); await f.start(); const engine = f.engines[0]
    await writeFile(join(f.repo, 'feature.txt'), 'approved content\n')
    const input = { requestId: randomUUID(), message: 'Approved fixture', paths: ['feature.txt'] }
    const result = engine.tool('commit_work', input), duplicate = engine.tool('commit_work', input)
    void result.catch(() => undefined); void duplicate.catch(() => undefined)
    await vi.waitFor(() => expect(f.current().commitRequest?.status).toBe('pending'), { timeout: 10000 })
    expect(f.current().commitRequest?.changes[0].patch).toContain('+approved content')
    expect(await f.git(['rev-list', '--count', 'HEAD'])).toBe('1')
    await f.control({ type: 'commit', requestId: input.requestId, approved: true })
    expect(await result).toMatchObject({ status: 'succeeded' }); expect(await duplicate).toMatchObject({ status: 'succeeded' })
    expect(await f.git(['rev-list', '--count', 'HEAD'])).toBe('2')
    expect(await engine.tool('commit_work', input)).toMatchObject({ status: 'succeeded' })
    const ledger = JSON.parse(await readFile(join(f.root, 'commits', `${input.requestId}.json`), 'utf8'))
    expect(ledger).toMatchObject({ workId: f.work.id, status: 'succeeded' })
    expect(await f.git(['status', '--porcelain'])).toBe('')
  })

  it('persists decline when stopping a pending commit', async () => {
    const f = await setup(); await f.start()
    await writeFile(join(f.repo, 'feature.txt'), 'pending\n')
    const requestId = randomUUID()
    const result = f.engines[0].tool('commit_work', { requestId, message: 'Pending', paths: ['feature.txt'] })
    const settled = result.catch(error => error)
    await vi.waitFor(() => expect(f.current().commitRequest?.status).toBe('pending'), { timeout: 10000 })
    await f.control({ type: 'stop' }); await settled
    expect(JSON.parse(await readFile(join(f.root, 'commits', `${requestId}.json`), 'utf8')).status).toBe('declined')
    expect(await f.git(['rev-list', '--count', 'HEAD'])).toBe('1')
  })

  it('settles an approved host commit before releasing occupancy and prevents Git mutation after stop', async () => {
    const f = await setup(); await f.start()
    await writeFile(join(f.repo, 'feature.txt'), 'reviewed but stopped\n')
    const requestId = randomUUID(), tool = f.engines[0].tool('commit_work', { requestId, message: 'Stopped commit', paths: ['feature.txt'] }).catch(error => error)
    await vi.waitFor(() => expect(f.current().commitRequest?.status).toBe('pending'), { timeout: 10000 })
    let enter!: () => void, release!: () => void
    const entered = new Promise<void>(resolve => { enter = resolve }), gate = new Promise<void>(resolve => { release = resolve })
    const commit = f.service.commit.bind(f.service)
    vi.spyOn(f.service, 'commit').mockImplementation(async (...args) => { enter(); await gate; return commit(...args) })
    const decision = f.control({ type: 'commit', requestId, approved: true }).catch(error => error)
    await entered
    const stop = f.control({ type: 'stop' })
    expect(f.current().stopConfirmed).toBe(false)
    await expect(f.service.acquire(f.scope, f.work.id)).rejects.toThrow('occupied')
    release(); expect(await decision).toBeInstanceOf(Error); await tool; await stop
    expect(f.current().stopConfirmed).toBe(true)
    expect(await f.git(['rev-list', '--count', 'HEAD'])).toBe('1')
    expect(f.current().commitRequest?.status).toBe('unknown')
  })

  it('allows a declined environment proposal to be proposed again on explicit continuation', async () => {
    const f = await setup()
    const service = new SuperAgentService(f.store, async () => f.repo, f.service, f.workers)
    const input = { workspaceId: f.scope, conversationId: 'new-chat', eventId: randomUUID(), text: 'New independent work' }
    const receipt = await service.submitInput(input)
    const work = await f.store.createWork(f.scope, { creationId: randomUUID(), sourceInputId: receipt.input.id, title: 'Isolated work', goal: input.text, environmentSelection: { mode: 'create' } })
    const first = { work, operation: await f.service.proposeCreate(f.scope, { workId: work.id }) }
    expect(first.operation).toBeDefined()
    await service.decideEnvironmentOperation({ workspaceId: f.scope, operationId: first.operation!.id, approved: false })
    const second = await service.continueWorker({ ...input, eventId: randomUUID(), text: 'Try again', workId: first.work.id })
    expect(second.operation?.status).toBe('pending')
    expect(second.operation?.id).not.toBe(first.operation!.id)
    expect(f.engines).toHaveLength(0)
  })
})

it('reviews a host tag request once and returns the persisted receipt on retry', async () => {
  const f = await setup(); await f.start()
  const requestId = randomUUID(), input = { requestId, kind: 'tag', tag: 'v-fixture' }
  const pending = f.engines[0].tool('git_work', input)
  await vi.waitFor(() => expect(f.current().commitRequest?.publish).toMatchObject({ kind: 'tag', tag: 'v-fixture' }), { timeout: 15000 })
  expect(await f.git(['tag', '--list'])).toBe('')
  await f.control({ type: 'commit', requestId, approved: true })
  expect(await pending).toMatchObject({ status: 'succeeded' })
  expect(await f.engines[0].tool('git_work', input)).toMatchObject({ status: 'succeeded' })
  expect(await f.git(['rev-parse', 'v-fixture'])).toBe(await f.git(['rev-parse', 'HEAD']))
})
