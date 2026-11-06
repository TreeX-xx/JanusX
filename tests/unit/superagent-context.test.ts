import { randomUUID } from 'node:crypto'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatTurnPorts } from '@janus-agent/janus-agent'
import { estimateContextTokens } from '@janus-agent/chat-core'
import { SuperAgentContext } from '../../src/main/janus/superagent/context'
import { SuperAgentService } from '../../src/main/janus/superagent/service'
import { SuperAgentContextStore } from '../../src/main/janus/superagent/context-store'
import { createSuperAgentChatTurn } from '../../src/main/janus/superagent/chat-tools'
import { mcpOutputBytes, resourcePage } from '../../src/main/janus/superagent/context-reader'
import { hashText } from '../../src/main/janus/superagent/persistence'
import { createWork, otherWorkspace, recordExecution, submission, superAgentFixture, workspace } from '../helpers/superagent-fixture'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanups.splice(0).reverse()) await close() })
async function setup() {
  const f = await superAgentFixture(); cleanups.push(f.dispose)
  const service = new SuperAgentService(f.store, async id => id === workspace.workspaceId ? workspace.workspacePath : undefined)
  cleanups.push(() => service.close())
  const context = service.context
  const turn = async (text: string, conversationId = 'new-chat') => {
    const controller = new AbortController()
    const host = await createSuperAgentChatTurn({ service, workspaceId: workspace.workspaceId, conversationId, eventId: randomUUID(), text, signal: controller.signal })
    host.configure({ contextWindow: 32_768, maxOutputTokens: 4096 })
    const ports = { localTools: [], streamTextFn: vi.fn(async () => ({ textStream: (async function* () {})() })) } as unknown as ChatTurnPorts
    const inline = await host.attach(ports), messages = await host.prepareMessages([{ role: 'user', content: text }])
    const initial = [{ role: 'system', content: inline }, ...messages]
    await ports.streamTextFn({ messages: initial })
    const input = (await service.snapshot(workspace.workspaceId)).inputs.at(-1)!
    const call = async (name: string, args: unknown) => {
      const result = await ports.localTools!.find(row => row.name === name)!.execute({ id: randomUUID(), name, arguments: args } as never, controller.signal)
      if (result.isError) throw new Error(result.content)
      return JSON.parse(result.content)
    }
    const see = async (value: unknown) => ports.streamTextFn({ messages: [...initial, { role: 'tool', content: JSON.stringify(value) }] })
    return { host, ports, input, call, see, inline, messages, initial }
  }
  return { ...f, service, context, turn }
}

describe('P5 shared context and source integrity', () => {
  it('exposes scoped stop-all only for a current host-admitted input without requiring historical context reads', async () => {
    const f = await setup(), prior = await f.turn('Historical request'), t = await f.turn('Stop all work in this workspace')
    const route = vi.spyOn(f.service, 'routeDecision').mockResolvedValue({ requested: true } as never)
    await expect(t.call('work_route', { action: 'stop-all', inputId: prior.input.id, scope: 'workspace' })).rejects.toThrow()
    expect(route).not.toHaveBeenCalled()
    expect(await t.call('work_route', { action: 'stop-all', inputId: t.input.id, scope: 'workspace' })).toMatchObject({ requested: true })
    expect(route).toHaveBeenCalledWith(workspace.workspaceId, { action: 'stop-all', inputId: t.input.id, scope: 'workspace' }, expect.any(AbortSignal))
    expect(t.inline).toContain('all-workspaces only for an explicit global request')
  })

  it('keeps steering envelopes idempotent across concurrent retries while rejecting changed originals', async () => {
    const f = await setup(), t = await f.turn('Continue discussing the work'), eventId = randomUUID()
    const raw = 'Preserve this late requirement. '.repeat(3000) + 'STEER_TAIL'
    const [first, second] = await Promise.all([t.host.steering(eventId, raw), t.host.steering(eventId, raw)])
    expect(second).toBe(first)
    expect(await t.host.steering(eventId, raw)).toBe(first)
    expect(first).toContain('"truncated":true')
    await expect(t.host.steering(eventId, raw + ' changed')).rejects.toThrow()
    const records = await f.service.snapshot(workspace.workspaceId)
    expect(records.inputs).toHaveLength(2)
    expect((await f.service.readResource(workspace.workspaceId, records.inputs[1].resourceId)).text).toBe(raw)
  })

  it('finds retained closed work beyond five candidates by alias, file and native/report references, then reads its originals', async () => {
    const f = await setup(), old = await createWork(f.store, 'Old checkout feature'), execution = await recordExecution(f.store, old.id)
    const detail = await f.store.workDetail(workspace.workspaceId, old.id)
    await f.context.update(workspace.workspaceId, { workId: old.id, expectedWorkRevision: detail.work.revision, expectedContextRevision: 0,
      goal: { text: 'Maintain the original flow', sourceInputIds: [old.sourceInputId] }, constraints: [], coveredInputIds: [old.sourceInputId], aliases: ['previous-panel'], files: ['src/panel.ts'] })
    const report = await f.store.recordReport(workspace.workspaceId, { reportId: randomUUID(), executionId: execution.id, kind: 'ready', summary: 'Historical result', text: 'Original report with evidence.' })
    await f.store.controlWork(workspace.workspaceId, old.id, (await f.store.workDetail(workspace.workspaceId, old.id)).work.revision, 'close')
    for (let i = 0; i < 7; i++) await createWork(f.store, 'New feature ' + i)
    const t = await f.turn('What happened in the earlier work?')
    const data = JSON.parse(t.inline.split('\n').find(line => line.startsWith('SuperAgent Inline: '))!.slice(19))
    expect(data.candidates.works.length).toBeLessThanOrEqual(5)
    expect(data.candidates.nextOffset).not.toBeNull()
    for (const query of ['previous-panel', 'src/panel.ts', execution.providerSessionId!, report.id, report.resourceId]) {
      expect((await t.call('work_list', { query })).works.map((row: any) => row.id)).toContain(old.id)
    }
    const later = await t.call('work_list', { offset: 5 }); expect(later.works.map((row: any) => row.id)).toContain(old.id)
    const card = await t.call('work_read', { workId: old.id })
    expect(card.work.closedAt).not.toBeNull(); expect(card.report.summary).toBe('Historical result')
    expect((await t.call('work_read_resource', { resourceId: card.source.resourceId })).text).toBe('Implement the requested feature')
    expect((await t.call('work_read_resource', { resourceId: card.report.resourceId })).text).toBe('Original report with evidence.')
    expect((await f.store.workDetail(workspace.workspaceId, old.id)).executions).toHaveLength(1)
  })

  it('keeps a late supplement outside old report/interpretation coverage and replaces an explicit constraint without deleting originals', async () => {
    const f = await setup(), work = await createWork(f.store), execution = await recordExecution(f.store, work.id)
    let detail = await f.store.workDetail(workspace.workspaceId, work.id)
    await f.store.updateDelivery(workspace.workspaceId, { deliveryId: detail.deliveries[0].id, executionId: execution.id, status: 'delivered' })
    const goal = { text: 'Implement the feature', sourceInputIds: [work.sourceInputId] }
    const update = { workId: work.id, expectedWorkRevision: detail.work.revision, expectedContextRevision: 0, goal,
      constraints: [{ text: 'Use blue', sourceInputIds: [work.sourceInputId] }], coveredInputIds: [work.sourceInputId] }
    await f.context.update(workspace.workspaceId, update)
    const report = await f.store.recordReport(workspace.workspaceId, { reportId: randomUUID(), executionId: execution.id, kind: 'ready', summary: 'Blue implemented', text: 'Historical blue result.' })
    const late = await f.store.receiveInput(workspace, submission('Replace blue with red; preserve the API.')); await f.store.routeInput(workspace.workspaceId, late.input.id, work.id)
    let card = await f.context.card(workspace.workspaceId, work.id)
    expect(card.intent).toMatchObject({ stale: true, uncoveredInputCount: 1 })
    expect(card.inputs[0]).toMatchObject({ interpreted: false, availableAtLatestReport: false, delivery: { status: 'pending' } })
    expect(card.report?.availableInputIds).toEqual([work.sourceInputId])
    detail = await f.store.workDetail(workspace.workspaceId, work.id)
    await f.context.update(workspace.workspaceId, { ...update, expectedWorkRevision: detail.work.revision, expectedContextRevision: 1,
      constraints: [{ text: 'Use red; preserve the API', sourceInputIds: [late.input.id] }], coveredInputIds: [work.sourceInputId, late.input.id] })
    card = await new SuperAgentContext(f.createStore().store).card(workspace.workspaceId, work.id)
    expect(card.intent).toMatchObject({ stale: false, revision: 2 })
    expect(card.intent.constraints[0].text).toBe('Use red; preserve the API')
    expect((await f.context.read(workspace.workspaceId, { resourceId: report.resourceId })).text).toBe('Historical blue result.')
    expect((await f.store.workDetail(workspace.workspaceId, work.id)).inputs).toHaveLength(2)
    await expect(f.context.update(workspace.workspaceId, update)).rejects.toThrow('changed')
  })

  it('preserves very long input and blocks dispatch until every page has actually reached a later model request, without a six-read quota', async () => {
    const f = await setup(), raw = '要求必须保留。'.repeat(12_000) + 'TAIL_REQUIREMENT', t = await f.turn(raw)
    const route = vi.spyOn(f.service, 'routeDecision').mockResolvedValue({ work: { id: randomUUID() } } as never)
    const args = { inputId: t.input.id, action: 'new', key: 'long', title: 'Long work', goal: 'Preserve all requirements' }
    expect((await f.service.readResource(workspace.workspaceId, t.input.resourceId)).text).toBe(raw)
    expect(estimateContextTokens(t.inline + JSON.stringify(t.messages))).toBeLessThan(8000)
    expect(t.messages[0].content).toContain('"truncated":true')
    let blocked = await t.call('work_route', args), count = 0
    expect(blocked.blocked).toBe(true)
    while (blocked.blocked) {
      const page = await t.call('work_read_resource', blocked.required[0])
      expect(page.status).toBe('available'); expect(page.end).toBeGreaterThan(page.offset)
      expect((await t.call('work_route', args)).blocked).toBe(true) // same model response still has not read this result
      await t.see(page); count++
      blocked = await t.call('work_route', args)
      expect(count).toBeLessThan(100)
    }
    expect(count).toBeGreaterThan(6); expect(route).toHaveBeenCalledTimes(1)
  })

  it('keeps Worker reads work-scoped, diagnoses missing/damaged/versioned sources and preserves unsupported context files', async () => {
    const f = await setup(), work = await createWork(f.store), other = await createWork(f.store, 'Other')
    const a = (await f.store.workDetail(workspace.workspaceId, work.id)).inputs[0]
    const b = (await f.store.workDetail(workspace.workspaceId, other.id)).inputs[0]
    await expect(f.context.read(workspace.workspaceId, { resourceId: b.resourceId }, Infinity, work.id)).rejects.toThrow('outside')
    const foreign = await f.store.receiveInput(otherWorkspace, { ...submission(), workspaceId: otherWorkspace.workspaceId })
    await expect(f.context.read(workspace.workspaceId, { resourceId: foreign.input.resourceId })).rejects.toThrow('outside')
    expect((await f.context.read(workspace.workspaceId, { resourceId: a.resourceId, version: '0'.repeat(64) })).status).toBe('version-mismatch')
    await writeFile(join(f.root, 'resources', a.resourceId + '.txt'), 'damaged')
    expect((await f.context.read(workspace.workspaceId, { resourceId: a.resourceId })).status).toBe('unavailable')
    await rm(join(f.root, 'resources', a.resourceId + '.txt'))
    expect((await f.context.read(workspace.workspaceId, { resourceId: a.resourceId })).status).toBe('missing')
    const file = join(f.root, 'context.json'), unsupported = '{"version":999,"entries":[]}'
    await writeFile(file, unsupported)
    const reopened = new SuperAgentContext(f.createStore().store), card = await reopened.card(workspace.workspaceId, work.id)
    expect(card.intent.diagnostic).toContain('preserved'); expect(card.inputs[0].original.status).toBe('missing')
    expect(await readFile(file, 'utf8')).toBe(unsupported)
  })

  it('pages every input and long sourced interpretation; rejects conflicting context revisions and unsafe file references', async () => {
    const f = await setup(), work = await createWork(f.store)
    for (let i = 0; i < 23; i++) { const receipt = await f.store.receiveInput(workspace, submission('Supplement ' + i)); await f.store.routeInput(workspace.workspaceId, receipt.input.id, work.id) }
    const detail = await f.store.workDetail(workspace.workspaceId, work.id), long = 'Explicit scoped goal '.repeat(220)
    const update = { workId: work.id, expectedWorkRevision: detail.work.revision, expectedContextRevision: 0,
      goal: { text: long.trim(), sourceInputIds: [work.sourceInputId] }, constraints: [], coveredInputIds: [work.sourceInputId] }
    await expect(f.context.update(workspace.workspaceId, { ...update, files: ['../outside'] })).rejects.toThrow()
    await f.context.update(workspace.workspaceId, update)
    const first = await f.context.card(workspace.workspaceId, work.id), second = await f.context.card(workspace.workspaceId, work.id, { offset: first.inputsPage.nextOffset })
    expect([...first.inputs, ...second.inputs]).toHaveLength(24)
    let goal = first.intent.goal.text, continuation = first.intent.goal.continuation
    while (continuation) { const { workId: _id, ...query } = continuation; const next = await f.context.card(workspace.workspaceId, work.id, query); goal += next.intent.goal.text; continuation = next.intent.goal.continuation }
    expect(goal).toBe(long.trim())
    await expect(f.context.card(workspace.workspaceId, work.id, { intentRevision: 2 })).rejects.toThrow('version')
    const store = new SuperAgentContextStore(f.root, async () => { throw new Error('Write unavailable') })
    await expect(store.put(workspace.workspaceId, { ...update, expectedContextRevision: 1, aliases: [], files: [] })).rejects.toThrow('Write unavailable')
    expect((await f.context.card(workspace.workspaceId, work.id)).intent.revision).toBe(1)
  })

  it('reports no-progress repeats and never treats unavailable critical originals or semantic updates as execution', async () => {
    const f = await setup(), work = await createWork(f.store), t = await f.turn('Continue the old work')
    const route = vi.spyOn(f.service, 'routeDecision').mockResolvedValue({} as never)
    const card = await t.call('work_read', { workId: work.id }); await t.see(card)
    await t.call('work_read_resource', { resourceId: card.source.resourceId })
    expect(await t.call('work_read_resource', { resourceId: card.source.resourceId })).toMatchObject({ status: 'no-progress', noProgress: true, text: '' })
    expect(await t.call('work_read_resource', { resourceId: card.source.resourceId, reread: true })).toMatchObject({ status: 'available', text: 'Implement the requested feature' })
    await rm(join(f.root, 'resources', card.source.resourceId + '.txt'))
    expect(await t.call('work_route', { action: 'continue', inputId: t.input.id, workId: work.id, expectedRevision: card.work.revision })).toMatchObject({ blocked: true, required: [{ status: 'missing' }] })
    expect(route).not.toHaveBeenCalled()
  })

  it('does not let a late old execution report claim later deliveries, and requires visible current cards even with complete semantic coverage', async () => {
    const f = await setup(), work = await createWork(f.store), old = await recordExecution(f.store, work.id)
    const first = (await f.store.workDetail(workspace.workspaceId, work.id)).deliveries[0]
    await f.store.updateDelivery(workspace.workspaceId, { deliveryId: first.id, executionId: old.id, status: 'delivered' })
    const fresh = await f.store.receiveInput(workspace, submission('A later requirement'))
    const delivery = await f.store.routeInput(workspace.workspaceId, fresh.input.id, work.id), current = await recordExecution(f.store, work.id)
    await f.store.updateDelivery(workspace.workspaceId, { deliveryId: delivery.id, executionId: current.id, status: 'delivered' })
    const late = await f.store.recordReport(workspace.workspaceId, { reportId: randomUUID(), executionId: old.id, kind: 'ready', summary: 'Late report', text: 'Old execution only' })
    expect(late.availableInputIds).toEqual([work.sourceInputId])
    const detail = await f.store.workDetail(workspace.workspaceId, work.id)
    await f.context.update(workspace.workspaceId, { workId: work.id, expectedWorkRevision: detail.work.revision, expectedContextRevision: 0,
      goal: { text: 'Current goal', sourceInputIds: [work.sourceInputId] }, constraints: [], coveredInputIds: detail.inputs.map(row => row.id) })
    const t = await f.turn('Continue'), route = vi.spyOn(f.service, 'routeDecision').mockResolvedValue({} as never)
    const args = { action: 'continue', inputId: t.input.id, workId: work.id, expectedRevision: detail.work.revision }
    expect(await t.call('work_route', args)).toMatchObject({ blocked: true, requiredCard: { workId: work.id } })
    const card = await t.call('work_read', { workId: work.id })
    expect((await t.call('work_route', args)).blocked).toBe(true)
    await t.see(card); await t.call('work_route', args); expect(route).toHaveBeenCalledOnce()
  })

  it('uses stable Unicode-safe ranges and returns normal material whole when it fits', () => {
    const text = 'x'.repeat(47_999) + '😀' + 'tail', resource = { id: randomUUID(), workspaceId: workspace.workspaceId, kind: 'input' as const, bytes: Buffer.byteLength(text), sha256: hashText(text), createdAt: 1 }
    const first = resourcePage({ resource, text }), next = resourcePage({ resource, text }, first.nextOffset!)
    expect(first.text + next.text).toBe(text); expect(first.end).toBe(47_999); expect(next.version).toBe(first.version)
    expect(resourcePage({ resource, text: 'Normal material' }).truncated).toBe(false)
    expect(() => resourcePage({ resource, text }, text.length + 1)).toThrow('offset')
    const escaped = ('中文😀\\\"\n').repeat(3000), bounded = resourcePage({ resource, text: escaped }, 0, Infinity, 12_000)
    expect(mcpOutputBytes(bounded)).toBeLessThanOrEqual(12_000)
    expect(bounded.text).toBe(escaped.slice(bounded.offset, bounded.end))
    expect(bounded.continuation?.offset).toBe(bounded.text.length)
  })
})
