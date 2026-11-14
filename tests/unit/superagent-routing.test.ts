import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SuperAgentSchedulingStore } from '../../src/main/janus/superagent/scheduling-store'
import type { ChatTurnPorts } from '@janus-agent/janus-agent'
import { SuperAgentService } from '../../src/main/janus/superagent/service'
import { SuperAgentWorkers } from '../../src/main/janus/superagent/workers'
import { createSuperAgentChatTurn } from '../../src/main/janus/superagent/chat-tools'
import { environmentFixture } from '../helpers/superagent-environment-fixture'
import { ManagedEngineFixture } from '../helpers/superagent-managed-fixture'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
async function setup(capacity = 2) {
  const f = await environmentFixture(); cleanups.push(f.dispose)
  const engines: ManagedEngineFixture[] = [], scope = f.workspace.workspaceId, entry = join(f.root, 'worker-mcp.js')
  await writeFile(entry, '')
  const workers = new SuperAgentWorkers(f.store, f.service, f.root, async () => ({ command: 'fixture', env: {}, mcpCommand: process.execPath, mcpEntry: entry }),
    // These controllable engines do not own a heartbeat process; lifecycle time is tested separately.
    (_id, publish) => { const engine = new ManagedEngineFixture(publish); engines.push(engine); return engine }, 60_000, () => 1000)
  const service = new SuperAgentService(f.store, async id => id === scope ? f.repo : undefined, f.service, workers)
  cleanups.push(() => service.close())
  await service.configureCapacity(capacity)
  const turn = async (text: string, eventId = randomUUID(), conversationId = 'chat') => {
    const controller = new AbortController()
    const host = await createSuperAgentChatTurn({ service, workspaceId: scope, conversationId, eventId, text, signal: controller.signal })
    const ports = { localTools: [] } as unknown as ChatTurnPorts
    const context = await host.attach(ports)
    const messages = [{ role: 'system', content: context }, ...await host.prepareMessages([{ role: 'user', content: text }])]
    host.observeModelMessages(messages)
    const inputId = JSON.parse(context.split('\n').find(line => line.startsWith('Current host input: '))!.slice('Current host input: '.length)).inputId
    const call = async (name: string, args: unknown) => {
      if (name === 'work_route' && !['stop', 'close', 'stop-all'].includes((args as { action: string }).action)) {
        const value = args as { context?: object; goal?: string }
        args = { ...value, context: { goal: value.goal ?? 'Apply the current instruction', constraints: [], backgroundInputIds: [],
          outcome: { target: 'Requested component', acceptance: ['Requested behavior works'], assumptions: [], maxRepairRounds: 1 }, ...value.context } }
      }
      const tool = ports.localTools!.find(row => row.name === name)!
      const result = await tool.execute({ id: randomUUID(), name, arguments: args } as never, controller.signal)
      if (result.isError) throw new Error(result.content)
      messages.push({ role: 'tool', content: result.content })
      host.observeModelMessages(messages)
      return JSON.parse(result.content)
    }
    return { controller, host, ports, context, inputId, call,
      create: (key: string, isolated = false) => call('work_route', { action: 'new', inputId, key, title: key, goal: `Implement only ${key}`, ...(isolated ? { environmentSelection: { mode: 'create' } } : {}) }),
      route: async (action: 'continue' | 'stop' | 'close' | 'reopen', workId: string) => {
        const card = await call('work_read', { workId })
        return call('work_route', { action, inputId, workId, expectedRevision: card.work.revision })
      } }
  }
  return { ...f, scope, engines, workers, service, turn,
    approve: async (workId: string) => {
      const pending = (await service.environmentSnapshot(scope)).operations.find(row => row.workId === workId && row.status === 'pending')!
      return service.decideEnvironmentOperation({ workspaceId: scope, operationId: pending.id, approved: true })
    } }
}

describe('same-Janus work routing and managed admission', () => {
  it('never admits execution when saving dispatch context fails', async () => {
    const f = await setup(), turn = await f.turn('Implement centered markers')
    vi.spyOn(f.store, 'prepareDispatch').mockRejectedValueOnce(new Error('Context write failed'))
    const request = vi.spyOn(f.service.scheduler!, 'request')
    await expect(turn.create('markers')).rejects.toThrow('Context write failed')
    expect(request).not.toHaveBeenCalled()
    expect(f.engines).toHaveLength(0)
  }, 20000)
  it('dispatches a short follow-up with prior discussion and answers its report once', async () => {
    const f = await setup()
    const prior = await f.turn('Center input navigation markers; scroll when there are too many')
    const turn = await f.turn('Show twelve and dispatch')
    const original = (await f.service.snapshot(f.scope)).inputs.find(row => row.id === prior.inputId)!
    await turn.call('work_read_resource', { resourceId: original.resourceId })
    const card = await turn.call('work_route', { action: 'new', inputId: turn.inputId, key: 'markers', title: 'Markers', goal: 'Markers',
      context: { goal: 'Center twelve input navigation markers', constraints: ['Scroll overflow'], backgroundInputIds: [prior.inputId] } })
    await expect.poll(() => f.engines[0]?.inputs.length, { timeout: 15000 }).toBe(1)
    expect(f.engines[0].inputs[0].text).toContain('Center twelve input navigation markers')
    const assigned = await f.engines[0].tool('read_work') as any
    expect(assigned.inputs.some((row: any) => row.original.text.includes('Center input navigation markers'))).toBe(true)
    expect(assigned.inputs.filter((row: any) => row.delivery)).toHaveLength(1)
    const reportId = randomUUID()
    await f.engines[0].tool('report_work', { reportId, kind: 'question', summary: 'Which theme?', text: 'Which theme should be checked?' })
    f.engines[0].end()
    const answer = { workspaceId: f.scope, conversationId: 'chat', workId: card.workId, eventId: randomUUID(), replyToReportId: reportId, text: 'Check all three themes' }
    await f.service.continueWorker(answer)
    await f.service.continueWorker(answer)
    await expect.poll(() => f.engines.flatMap(engine => engine.inputs).length, { timeout: 15000 }).toBe(2)
    expect(f.engines.at(-1)!.inputs.at(-1)!.text).toContain('Check all three themes')
    expect((await f.service.workDetail(f.scope, card.workId)).work.questionResponses).toHaveLength(1)
  }, 40000)
  it('dispatches two independent workers into the same checkout without terminal or peer exclusion', async () => {
    const f = await setup(2)
    f.occupied.push(f.repo)
    const a = await (await f.turn('Implement A')).create('A')
    await expect.poll(() => f.engines[0]?.inputs.length, { timeout: 15000 }).toBe(1)
    const b = await (await f.turn('Implement B in separate files')).create('B')
    await expect.poll(() => f.engines[1]?.inputs.length, { timeout: 15000 }).toBe(1)
    expect(f.engines.map(engine => engine.options!.cwd)).toEqual([f.repo, f.repo])
    expect((await f.service.scheduleSnapshot(f.scope)).occupied).toBe(2)
    await (await f.turn('Stop only A')).route('stop', a.work.id)
    await expect.poll(() => f.workers.snapshots(f.scope).find(row => row.workId === a.work.id)?.stopConfirmed).toBe(true)
    expect(f.workers.snapshots(f.scope).find(row => row.workId === b.work.id)?.stopConfirmed).toBe(false)
  }, 45000)

  it('persists a pre-launch block, returns it on duplicate routing, and resumes the same work only with new input', async () => {
    const f = await setup()
    const turn = await f.turn('Implement A')
    // A deterministic environment precondition fails before scheduler.request or native RPC.
    await f.git(['checkout', '--detach'])
    const blocked = await turn.create('A')
    expect(blocked.schedule).toMatchObject({ status: 'blocked', diagnostic: expect.stringContaining('Environment preparation') })
    expect(f.engines).toHaveLength(0)
    expect((await f.service.scheduleSnapshot(f.scope)).occupied).toBe(0)
    expect((await f.service.scheduler!.ledger.snapshot()).actions[0]).toMatchObject({ status: 'blocked', stage: 'environment', workId: blocked.work.id })
    const restored = await new SuperAgentSchedulingStore(f.root).snapshot()
    expect(restored.entries[0].status).toBe('blocked')
    expect(restored.actions[0].status).toBe('blocked')
    expect((await turn.create('A')).work.id).toBe(blocked.work.id)
    await f.git(['checkout', 'main'])
    const resumed = await (await f.turn('Environment repaired; continue A')).route('continue', blocked.work.id)
    expect(resumed.work.id).toBe(blocked.work.id)
    await expect.poll(() => f.engines[0]?.inputs.length, { timeout: 15000 }).toBe(1)
    expect((await f.service.snapshot(f.scope)).works).toHaveLength(1)
    await expect.poll(async () => (await f.service.workDetail(f.scope, blocked.work.id)).deliveries.every(row => row.status === 'delivered'), { timeout: 15000 }).toBe(true)
  }, 40000)
  it('preserves unknown outcomes after scheduling starts and refuses to replay the same decision', async () => {
    const f = await setup(), turn = await f.turn('Implement A')
    const request = vi.spyOn(f.service.scheduler!, 'request').mockRejectedValueOnce(new Error('Unconfirmed scheduling write'))
    try {
      await expect(turn.create('A')).rejects.toThrow('Unconfirmed scheduling write')
      expect((await f.service.scheduler!.ledger.snapshot()).actions[0].status).toBe('unknown')
      await expect(turn.create('A')).rejects.toThrow('unknown outcome')
      expect(request).toHaveBeenCalledTimes(1)
    } finally { request.mockRestore() }
  }, 40000)
  it('proposes Git operations from a current read card, requires concrete approval, deduplicates and preserves the removed branch', async () => {
    const f = await setup(), work = await f.work()
    const creation = await f.service.environments!.proposeCreate(f.scope, { workId: work.id })
    expect((await f.service.decideEnvironmentOperation({ workspaceId: f.scope, operationId: creation.id, approved: true })).status).toBe('succeeded')
    const environment = (await f.service.environmentSnapshot(f.scope)).environments.find(row => row.workId === work.id)!
    await f.commit(environment.checkout.path, 'P8 integration result\n')
    const before = await f.git(['rev-parse', 'HEAD'])
    const merge = await f.turn('Merge the completed feature branch into this project')
    const args = { inputId: merge.inputId, workId: work.id, expectedRevision: work.revision, kind: 'merge' }
    expect(await merge.call('work_git', args)).toMatchObject({ blocked: true })
    const card = await merge.call('work_read', { workId: work.id }); args.expectedRevision = card.work.revision
    await expect(merge.call('work_git', { ...args, inputId: randomUUID() })).rejects.toThrow('host-admitted')
    const proposal = await merge.call('work_git', args)
    expect(proposal).toMatchObject({ status: 'pending', plan: { kind: 'merge' } })
    expect((await merge.call('work_git', args)).id).toBe(proposal.id)
    expect(await f.git(['rev-parse', 'HEAD'])).toBe(before)
    expect((await f.service.decideEnvironmentOperation({ workspaceId: f.scope, operationId: proposal.id, approved: false })).status).toBe('rejected')
    expect((await merge.call('work_git', args)).status).toBe('rejected')
    expect(await f.git(['rev-parse', 'HEAD'])).toBe(before)
    const next = await f.turn('Propose the branch merge again; I will review it')
    await next.call('work_read', { workId: work.id })
    const approved = await next.call('work_git', { ...args, inputId: next.inputId })
    expect((await f.service.decideEnvironmentOperation({ workspaceId: f.scope, operationId: approved.id, approved: true })).status).toBe('succeeded')
    expect(await f.git(['show', 'HEAD:feature.txt'])).toBe('P8 integration result')
    const remove = await f.turn('Remove only that completed worktree, keeping the branch')
    await remove.call('work_read', { workId: work.id })
    const removal = await remove.call('work_git', { ...args, inputId: remove.inputId, kind: 'remove' })
    expect(removal).toMatchObject({ status: 'pending', plan: { preserveBranch: true, unmergedCommits: 0 } })
    expect(await f.git(['worktree', 'list', '--porcelain'])).toContain(environment.checkout.branch)
    expect((await f.service.decideEnvironmentOperation({ workspaceId: f.scope, operationId: removal.id, approved: true })).status).toBe('succeeded')
    expect((await remove.call('work_git', { ...args, inputId: remove.inputId, kind: 'remove' })).id).toBe(removal.id)
    expect(await f.git(['worktree', 'list', '--porcelain'])).not.toContain(environment.checkout.branch)
    expect(await f.git(['show', `${environment.checkout.branch}:feature.txt`])).toBe('P8 integration result')
    expect(f.engines).toHaveLength(0)
  })
  it('continues an idle work before admitting queued new work at capacity one', async () => {
    const f = await setup(1), a = await (await f.turn('Implement A')).create('A')
    await expect.poll(() => f.engines[0]?.inputs.length, { timeout: 15000 }).toBe(1)
    const b = await (await f.turn('Implement B')).create('B', true); await f.approve(b.work.id)
    f.engines[0].end()
    await (await f.turn('Supplement the idle A')).route('continue', a.work.id)
    await expect.poll(() => f.engines[1]?.inputs.length, { timeout: 15000 }).toBe(1)
    expect(f.engines[1].inputs[0].text).toContain('Supplement the idle A')
    expect((await f.service.scheduleSnapshot(f.scope)).entries.find(row => row.workId === b.work.id)?.status).toBe('queued')
    expect((await f.service.scheduleSnapshot(f.scope)).occupied).toBe(1)
    expect(f.engines[0].state.connection).toBe('closed')
  }, 45000)

  it('runs four isolated worktrees with an ordered fifth, supplements only A, and stops only B after confirmed exit', async () => {
    const f = await setup(4), ids: string[] = []
    for (let index = 0; index < 5; index++) {
      const turn = await f.turn(`Implement feature ${index}`), result = await turn.create('Feature-' + index, index > 0)
      ids.push(result.work.id)
      if (index) {
        expect(result.schedule.status).toBe('awaiting-approval')
        await f.approve(result.work.id)
      }
    }
    await expect.poll(() => f.engines.length, { timeout: 15_000 }).toBe(4)
    await expect.poll(async () => (await f.service.scheduleSnapshot(f.scope)).entries.filter(row => row.status === 'running').length, { timeout: 15_000 }).toBe(4)
    expect((await f.service.scheduleSnapshot(f.scope)).entries.find(row => row.workId === ids[4])?.status).toBe('queued')
    const directories = (await f.service.environmentSnapshot(f.scope)).environments.map(row => row.checkout.path)
    expect(new Set(directories).size).toBe(5)
    expect(new Set(f.engines.map(engine => engine.options!.cwd)).size).toBe(4)
    const firstExecution = f.workers.snapshots(f.scope).find(row => row.workId === ids[0])!.executionId
    f.engines[1].state.approvals = [{ id: 'native-b', kind: 'command', description: 'B decision' }]; f.engines[1].changed()
    const supplement = await f.turn('Only supplement Feature-0; preserve the public API', undefined, 'another-chat')
    await supplement.route('continue', ids[0])
    await expect.poll(() => f.engines[0].inputs.length, { timeout: 15_000 }).toBe(2)
    expect(f.engines[0].inputs[1].text).toContain('preserve the public API')
    expect(f.engines[1].inputs).toHaveLength(1)
    expect(f.workers.snapshots(f.scope).find(row => row.workId === ids[0])?.executionId).toBe(firstExecution)
    expect((await f.service.scheduleSnapshot(f.scope)).occupied).toBe(4)
    let release!: () => void; f.engines[1].exit = () => new Promise<void>(resolve => { release = resolve })
    const stop = await f.turn('Stop Feature-1 only'); await stop.route('stop', ids[1])
    await expect.poll(() => typeof release, { timeout: 15_000 }).toBe('function')
    expect(f.engines).toHaveLength(4); expect((await f.service.scheduleSnapshot(f.scope)).occupied).toBe(4)
    release()
    await expect.poll(() => f.engines.length, { timeout: 15_000 }).toBe(5)
    await expect.poll(() => f.engines[4].inputs.length, { timeout: 15_000 }).toBe(1)
    expect(f.workers.snapshots(f.scope).find(row => row.workId === ids[0])?.stopConfirmed).toBe(false)
    expect(f.workers.snapshots(f.scope).find(row => row.workId === ids[1])?.stopConfirmed).toBe(true)
    expect(f.engines[4].inputs[0].text).toContain('Implement only Feature-4')
  }, 90_000)

  it('keeps history/ambiguity read-only and blocks duplicate, stale, cross-scope and cancelled model decisions', async () => {
    const f = await setup(1), turn = await f.turn('Implement A'), created = await turn.create('A'), id = created.work.id
    await expect.poll(() => f.engines[0]?.inputs.length, { timeout: 15_000 }).toBe(1)
    expect((await turn.create('A')).work.id).toBe(id)
    expect((await f.service.snapshot(f.scope)).works).toHaveLength(1)
    const question = await f.turn('What was done before?')
    expect((await question.call('work_list', {})).total).toBe(1)
    expect((await question.call('work_read', { workId: id })).work.id).toBe(id)
    await expect(question.call('work_route', { inputId: turn.inputId, action: 'stop', workId: id, expectedRevision: 1 })).rejects.toThrow('current host-admitted')
    const stale = await f.turn('Add one check to A'), card = await stale.call('work_read', { workId: id })
    const stop = await f.turn('Close A'); await stop.route('close', id)
    await expect(stale.call('work_route', { inputId: stale.inputId, action: 'continue', workId: id, expectedRevision: card.work.revision })).resolves.toMatchObject({
      blocked: true, reasonCode: 'work-version-changed', effects: 'none', requiredCard: { workId: id, view: 'dispatch' },
    })
    await expect(stale.route('reopen', id)).rejects.toThrow('predates')
    await expect(question.call('work_read', { workId: randomUUID() })).rejects.toThrow('not found')
    const aborted = await f.turn('Implement something else'); aborted.controller.abort()
    await expect(aborted.create('aborted')).rejects.toThrow()
    expect((await f.service.snapshot(f.scope)).works).toHaveLength(1)
    const reopen = await f.turn('Explicitly reopen A and add the requested check')
    await reopen.route('reopen', id)
    await expect.poll(() => f.engines.length, { timeout: 15_000 }).toBe(2)
    expect((await f.service.workDetail(f.scope, id)).work.closedAt).toBeNull()
  }, 40_000)

  it('a queued close cancels the original pending input; late approvals cannot revive it and duplicate inputs never resend', async () => {
    const f = await setup(1), first = await f.turn('Implement A'), a = await first.create('A')
    await expect.poll(() => f.engines[0]?.inputs.length, { timeout: 15_000 }).toBe(1)
    const second = await f.turn('Implement B'), b = await second.create('B', true)
    const proposal = (await f.service.environmentSnapshot(f.scope)).operations.find(row => row.workId === b.work.id)!
    const close = await f.turn('Close B'); await close.route('close', b.work.id)
    const decision = await f.service.decideEnvironmentOperation({ workspaceId: f.scope, operationId: proposal.id, approved: true })
    expect(decision.status).not.toBe('succeeded')
    expect((await f.service.workDetail(f.scope, b.work.id)).deliveries.every(row => row.status === 'cancelled')).toBe(true)
    const eventId = randomUUID(), supplement = await f.turn('A: preserve exact scope', eventId)
    await supplement.route('continue', a.work.id)
    await expect.poll(() => f.engines[0].inputs.length, { timeout: 15_000 }).toBe(2)
    const duplicate = await f.turn('A: preserve exact scope', eventId)
    await duplicate.route('continue', a.work.id)
    expect(f.engines[0].inputs).toHaveLength(2)
    expect(f.engines).toHaveLength(1)
  }, 40_000)
})

it('routes a request to commit existing dev changes into that checkout without a create proposal', async () => {
  const f = await setup(), path = join(f.root, 'dev-checkout')
  await f.git(['worktree', 'add', '-b', 'dev', path])
  await writeFile(join(path, 'feature.txt'), 'user changes')
  const turn = await f.turn('Commit the current dev changes and push')
  const inventory = await turn.call('work_environment', {})
  expect(inventory.checkouts).toEqual(expect.arrayContaining([expect.objectContaining({ path, branch: 'dev', dirty: true })]))
  expect(turn.ports.localTools!.find(tool => tool.name === 'work_environment')?.coordinatorAccess).toBe('read')
  const result = await turn.call('work_route', { action: 'new', inputId: turn.inputId, key: 'release', title: 'Release', goal: 'Commit dev changes', environmentSelection: { branch: 'dev', includeChanges: true } })
  await expect.poll(() => f.engines[0]?.inputs.length, { timeout: 15000 }).toBe(1)
  expect(f.engines[0].options?.cwd).toBe(path)
  expect((await f.service.workDetail(f.scope, result.work.id)).work.environmentSelection).toEqual({ branch: 'dev', includeChanges: true })
  expect((await f.service.environmentSnapshot(f.scope)).operations).toEqual([])
  expect(f.engines[0].inputs[0].text).toContain(`Checkout: ${path}`)
  expect(f.engines[0].inputs[0].text).toContain('Branch: dev')
  expect(f.engines[0].inputs[0].text).not.toContain('Baseline HEAD:')
  const continuation = await f.turn('Continue releasing the existing dev changes')
  const card = await continuation.call('work_read', { workId: result.work.id })
  expect(card.checkout.current.head).toBe(inventory.workspace.head)
  const decision = { action: 'continue', inputId: continuation.inputId, workId: result.work.id, expectedRevision: card.work.revision,
    environmentSelection: { branch: 'dev', includeChanges: true } }
  await continuation.call('work_route', decision)
  const updated = await continuation.call('work_read', { workId: result.work.id })
  await expect(continuation.call('work_route', { ...decision, expectedRevision: updated.work.revision,
    environmentSelection: { branch: 'main' } })).rejects.toThrow('Decision identity conflict')
  expect((await f.service.inspectEnvironments(f.scope, result.work.id)).assigned?.branch).toBe('dev')
})

it('routes an explicit Claude request while leaving unspecified new work on Codex', async () => {
  const f = await setup()
  const request = await f.turn('Use Claude Code for the first work')
  const card = await request.call('work_route', { action: 'new', inputId: request.inputId, key: 'claude-choice', title: 'Claude work', goal: 'Verify requested engine', workerBackend: 'claude' })
  await expect.poll(() => f.engines[0]?.inputs.length, { timeout: 15000 }).toBe(1)
  expect(f.engines[0].state.engine).toBe('claude')
  const detail = await f.service.workDetail(f.scope, card.workId)
  expect(detail.work.workerBackend).toBe('claude')
  expect(detail.executions[0].backend).toBe('claude')
  const other = await f.turn('Start another independent task using defaults')
  await other.create('default-choice')
  await expect.poll(() => f.engines[1]?.inputs.length, { timeout: 15000 }).toBe(1)
  expect(f.engines[1].state.engine).toBe('codex')
  expect(() => f.service.routeDecision(f.scope, { action: 'continue', inputId: request.inputId, workId: detail.work.id, expectedRevision: detail.work.revision, workerBackend: 'codex' } as never)).toThrow()
}, 30000)
