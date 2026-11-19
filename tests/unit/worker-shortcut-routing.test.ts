import { createCoordinator } from '../../plugins/superagent/src/coordinator'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { ChatTurnPorts } from '@janus-agent/janus-agent'
import type { JanusAgentMessage } from '@janus-agent/agent-core'
import { DesktopSuperAgentService } from '../../src/main/janus/superagent/desktop-service'
import { createSuperAgentChatTurn } from '../../src/main/janus/superagent/desktop-chat-turn'
import { SuperAgentWorkers } from '../../src/main/janus/superagent/workers'
import { WorkerSettingsStore } from '../../src/main/janus/superagent/worker-settings'
import { environmentFixture } from '../helpers/superagent-environment-fixture'
import { ManagedEngineFixture } from '../helpers/superagent-managed-fixture'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
async function setup() {
  const f = await environmentFixture(); cleanups.push(f.dispose)
  const scope = f.workspace.workspaceId, entry = join(f.root, 'worker-mcp.js'), policy = new WorkerSettingsStore(f.root)
  await writeFile(entry, '')
  const engines: ManagedEngineFixture[] = []
  const workers = new SuperAgentWorkers(f.store, f.service, f.root, async backend => ({ backend: await policy.resolveBackend(backend), command: 'fixture', env: {}, mcpCommand: process.execPath, mcpEntry: entry }),
    (_id, publish) => { const engine = new ManagedEngineFixture(publish); engines.push(engine); return engine }, 60_000, () => 1000)
  const service = new DesktopSuperAgentService(f.store, async id => id === scope ? f.repo : undefined, f.service, workers)
  const coordinator = createCoordinator()
  const lifetime = new AbortController()
  service.activation = { signal: lifetime.signal, active: true, call: (method, value, signal) => coordinator.call(method, value, signal ?? lifetime.signal) }
  service.workerPolicy = policy; cleanups.push(() => service.close())
  await service.configureCapacity(3)
  const turn = async (backend?: 'codex' | 'claude', text = 'Implement a small change') => {
    const signal = new AbortController().signal, eventId = randomUUID()
    const host = await createSuperAgentChatTurn({ service, workspaceId: scope, conversationId: 'chat', eventId, text, signal, workerBackend: backend })
    const ports = { localTools: [] } as unknown as ChatTurnPorts, context = await host.attach(ports)
    const messages: JanusAgentMessage[] = [{ role: 'system', content: context }, ...await host.prepareMessages([{ role: 'user', content: text }])]
    host.observeModelMessages(messages)
    const inputId = (await service.snapshot(scope)).inputs.find(row => row.eventId === eventId)!.id
    const call = async (name: string, args: any) => {
      if (name === 'work_route' && !['stop', 'close', 'stop-all'].includes(args.action)) {
        args = { ...args, context: { goal: text, constraints: [], backgroundInputIds: [],
          outcome: { target: text, acceptance: ['Requested behavior works'], assumptions: [], maxRepairRounds: 1 }, ...args.context } }
      }
      const result = await ports.localTools!.find(tool => tool.name === name)!.execute({ id: randomUUID(), name, arguments: args } as never, signal)
      if (result.isError) throw new Error(result.content)
      messages.push({ role: 'tool', content: result.content })
      host.observeModelMessages(messages)
      return JSON.parse(result.content)
    }
    return { host, inputId, call, observe: (message: JanusAgentMessage) => { messages.push(message); host.observeModelMessages(messages) },
      create: (key: string, workerBackend?: string) => call('work_route', { inputId, action: 'new', key, title: key, goal: text, ...(workerBackend ? { workerBackend } : {}) }) }
  }
  return { ...f, scope, service, policy, engines, turn }
}

it('preserves separate engines and dependencies for inline orchestration', async () => {
  const f = await setup()
  const turn = await f.turn(undefined, '[[engine:claude]] implement, then [[engine:codex]] test')
  const flow = await turn.call('work_plan', { inputId: turn.inputId, key: 'mixed', title: 'Develop and test', goal: 'Implement and verify', nodes: [
    { key: 'dev', role: 'develop', label: 'Development', title: 'Develop', goal: 'Develop the feature', workerBackend: 'claude', dependencies: [] },
    { key: 'test', role: 'test', label: 'Testing', title: 'Verify', goal: 'Test the implementation', workerBackend: 'codex', dependencies: ['dev'] },
  ] })
  expect(flow.nodes.map((node: any) => node.workerBackend)).toEqual(['claude', 'codex'])
  expect(flow.nodes[1].dependencies).toEqual(['dev'])
  expect((await f.policy.policy()).defaultBackend).toBe('codex')
  await expect(f.service.startWorker(f.scope, flow.nodes[1].workId)).rejects.toThrow('dependencies')
}, 30000)

it('pins # selection even when the model omits it, preserves the default and rejects a conflicting route', async () => {
  const f = await setup()
  await (await f.turn()).create('default')
  const claude = await f.turn('claude')
  await expect(claude.create('conflict', 'codex')).rejects.toThrow('WORKER_BACKEND_CONFLICT')
  await claude.create('selected')
  await vi.waitFor(() => expect(f.engines).toHaveLength(2))
  const records = await f.service.snapshot(f.scope)
  expect(records.works.map(work => work.workerBackend)).toEqual(['codex', 'claude'])
  expect((await f.policy.policy()).defaultBackend).toBe('codex')
  const existing = records.works[0], card = await claude.call('work_read', { workId: existing.id })
  await expect(claude.call('work_route', { inputId: claude.inputId, action: 'continue', workId: existing.id, expectedRevision: card.work.revision })).rejects.toThrow('fixed')
  const eventId = randomUUID(), steering = await claude.host.steering(eventId, 'Use Codex for another independent change', 'codex')
  claude.observe({ role: 'user', content: steering })
  const inputId = (await f.service.snapshot(f.scope)).inputs.find(row => row.eventId === eventId)!.id
  await claude.call('work_route', { inputId, action: 'new', key: 'steered', title: 'Steered change', goal: 'Independent change' })
  expect((await f.service.snapshot(f.scope)).works.find(row => row.title === 'Steered change')?.workerBackend).toBe('codex')
}, 45000)

it('rejects disabled engines at dispatch and continuation without replacing them or creating extra work', async () => {
  const f = await setup()
  await (await f.turn('claude')).create('existing')
  const work = (await f.service.snapshot(f.scope)).works[0]
  await f.policy.updatePolicy({ defaultBackend: 'codex', enabled: ['codex'] })
  await expect(f.turn('claude')).rejects.toThrow('disabled')
  const ordinary = await f.turn()
  await expect(ordinary.create('disabled', 'claude')).rejects.toThrow('disabled')
  await expect(f.service.continueWorker({ workspaceId: f.scope, workId: work.id, conversationId: 'direct', eventId: randomUUID(), text: 'Add tests' })).rejects.toThrow('disabled')
  expect((await f.service.snapshot(f.scope)).works).toHaveLength(1)
  expect((await f.service.workDetail(f.scope, work.id)).deliveries).toHaveLength(1)
}, 45000)

it('delivers direct supplements once with their original text and rejects closed work', async () => {
  const f = await setup()
  await (await f.turn()).create('existing')
  const work = (await f.service.snapshot(f.scope)).works[0]
  const input = { workspaceId: f.scope, workId: work.id, conversationId: 'direct', eventId: randomUUID(), text: 'Exact user text\n\nReferenced context: /fixture/tests.ts' }
  await f.service.continueWorker(input)
  await f.service.continueWorker(input)
  const detail = await f.service.workDetail(f.scope, work.id)
  const originals = detail.inputs.filter(row => row.eventId === input.eventId)
  expect(originals).toHaveLength(1)
  expect(detail.deliveries.filter(row => row.inputId === originals[0].id)).toHaveLength(1)
  expect((await f.service.readResource(f.scope, originals[0].resourceId)).text).toBe(input.text)
  await f.service.controlWork({ workspaceId: f.scope, workId: work.id, expectedRevision: detail.work.revision, conversationId: 'direct', action: 'close' })
  await expect(f.service.continueWorker({ ...input, eventId: randomUUID() })).rejects.toThrow()
}, 20000)

it('creates an idempotent workflow with # backend constraints and rejects a disabled role before allocating children', async () => {
  const f = await setup(), turn = await f.turn('claude')
  const plan = { inputId: turn.inputId, key: 'workflow', title: 'Develop and test', goal: 'Implement and verify', nodes: [
    { key: 'dev', role: 'develop', label: 'Development', title: 'Develop', goal: 'Develop one feature', dependencies: [] },
    { key: 'test', role: 'test', label: 'Testing', title: 'Verify', goal: 'Verify the implementation', dependencies: ['dev'] },
  ] }
  const flow = await turn.call('work_plan', plan)
  expect(flow.nodes.map((node: any) => node.workerBackend)).toEqual(['claude', 'claude'])
  expect((await turn.call('work_plan', plan)).id).toBe(flow.id)
  await vi.waitFor(() => expect(f.engines).toHaveLength(1), { timeout: 10000 })
  expect((await f.service.snapshot(f.scope)).works).toHaveLength(2)
  expect((await f.service.scheduleSnapshot(f.scope)).entries).toHaveLength(1)
  await expect(turn.call('work_plan', { ...plan, nodes: plan.nodes.map(node => ({ ...node, workerBackend: 'codex' })) })).rejects.toThrow('WORKER_BACKEND_CONFLICT')
  await expect(turn.call('work_plan', { ...plan, inputId: randomUUID() })).rejects.toThrow('INPUT_NOT_ADMITTED')
  await expect(f.service.startWorker(f.scope, flow.nodes[1].workId)).rejects.toThrow('dependencies')
  const input = { workspaceId: f.scope, workId: flow.nodes[1].workId, conversationId: 'direct', eventId: randomUUID(), text: 'Exact supplement for the future tester' }
  await f.service.continueWorker(input)
  expect(f.engines).toHaveLength(1)
  const detail = await f.service.workDetail(f.scope, flow.nodes[1].workId)
  expect(detail.deliveries.some(row => row.status === 'pending' && detail.inputs.some(source => source.id === row.inputId && source.eventId === input.eventId))).toBe(true)
  await f.service.controlWork({ workspaceId: f.scope, workId: flow.nodes[1].workId, expectedRevision: detail.work.revision, conversationId: 'direct', action: 'stop' })
  expect((await f.service.workflowSnapshot(f.scope)).workflows[0].state).toBe('blocked')
  await f.policy.updatePolicy({ defaultBackend: 'codex', enabled: ['codex'] })
  const ordinary = await f.turn()
  await expect(ordinary.call('work_plan', { ...plan, key: 'disabled', inputId: ordinary.inputId, nodes: plan.nodes.map(node => ({ ...node, workerBackend: 'claude' })) })).rejects.toThrow('disabled')
  expect((await f.service.snapshot(f.scope)).works).toHaveLength(2)
  await ordinary.call('work_route', { inputId: ordinary.inputId, action: 'stop-all', scope: 'workspace' })
  await vi.waitFor(async () => expect((await f.service.workflowSnapshot(f.scope)).workflows[0].state).toBe('stopped'), { timeout: 10000 })
}, 45000)
