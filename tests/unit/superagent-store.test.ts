import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWork, otherWorkspace, recordExecution, submission, superAgentFixture, workspace } from '../helpers/superagent-fixture'

describe('SuperAgent durable work records', () => {
  let fixture: Awaited<ReturnType<typeof superAgentFixture>>
  const scope = workspace.workspaceId
  beforeEach(async () => { fixture = await superAgentFixture() })
  afterEach(async () => { await fixture.dispose() })

  it('preserves the entire original text before a receipt without creating work', async () => {
    const text = `  Original requirement\r\n${'中文 🧪 full content\n'.repeat(5000)}  `
    const receipt = await fixture.store.receiveInput(workspace, submission(text))
    const onDisk = JSON.parse(await readFile(fixture.persistence.indexPath, 'utf8'))
    expect(onDisk.inputs[0]).toEqual(receipt.input)
    expect(onDisk.works).toEqual([])
    expect(receipt).toMatchObject({ duplicate: false, revision: 1 })
    expect(await fixture.store.readResource(scope, receipt.input.resourceId)).toMatchObject({ text })
    expect(JSON.stringify(onDisk)).not.toContain('Original requirement')
    receipt.input.workspacePath = 'changed by caller'
    const reloaded = fixture.createStore().store
    expect((await reloaded.snapshot(scope)).inputs[0].workspacePath).toBe(workspace.workspacePath)
    expect((await reloaded.readResource(scope, receipt.input.resourceId)).text).toBe(text)
  })

  it('serializes concurrent duplicate and distinct submissions without content-based deduplication', async () => {
    const changes = vi.fn()
    fixture.store.subscribe(changes)
    const input = submission('same text')
    const receipts = await Promise.all([
      fixture.store.receiveInput(workspace, input), fixture.store.receiveInput(workspace, input),
      ...Array.from({ length: 16 }, () => fixture.store.receiveInput(workspace, submission('same text'))),
    ])
    expect(receipts[0].input.id).toBe(receipts[1].input.id)
    expect(receipts.filter(row => row.duplicate)).toHaveLength(1)
    const snapshot = await fixture.store.snapshot(scope)
    expect(snapshot.inputs).toHaveLength(17)
    expect(snapshot.inputs.map(row => row.sequence)).toEqual(Array.from({ length: 17 }, (_, i) => i + 1))
    expect(snapshot.revision).toBe(17)
    expect(changes).toHaveBeenCalledTimes(17)
    expect((await fixture.createStore().store.snapshot(scope)).inputs).toEqual(snapshot.inputs)
  })

  it('rejects reuse of an event identity with different content, conversation or workspace', async () => {
    const input = submission()
    const first = await fixture.store.receiveInput(workspace, input)
    for (const patch of [{ text: 'other' }, { conversationId: 'other' }]) {
      await expect(fixture.store.receiveInput(workspace, { ...input, ...patch })).rejects.toThrow('identity')
    }
    await expect(fixture.store.receiveInput(otherWorkspace, { ...input, workspaceId: otherWorkspace.workspaceId })).rejects.toThrow('identity')
    const repeated = await fixture.store.receiveInput({ ...workspace, workspacePath: 'C:/moved/a' }, input)
    expect(repeated.input).toEqual(first.input)
    expect((await fixture.store.snapshot(scope)).revision).toBe(1)
    expect((await fixture.store.snapshot(otherWorkspace.workspaceId)).inputs).toEqual([])
  })

  it('atomically associates work and pending delivery, including one input relating to multiple works', async () => {
    const { input } = await fixture.store.receiveInput(workspace, submission())
    const request = { creationId: randomUUID(), sourceInputId: input.id, title: 'A', goal: 'Build A' }
    const a = await fixture.store.createWork(scope, request)
    expect(await fixture.store.createWork(scope, request)).toEqual(a)
    await expect(fixture.store.createWork(scope, { ...request, title: 'Changed' })).rejects.toThrow('conflict')
    const b = await fixture.store.createWork(scope, { ...request, creationId: randomUUID(), title: 'B' })
    const supplement = await fixture.store.receiveInput(workspace, submission('Additional requirement'))
    const delivery = await fixture.store.routeInput(scope, supplement.input.id, a.id)
    const beforeRepeat = await fixture.store.snapshot(scope)
    expect(await fixture.store.routeInput(scope, supplement.input.id, a.id)).toEqual(delivery)
    expect((await fixture.store.snapshot(scope)).revision).toBe(beforeRepeat.revision)
    const detail = await fixture.store.workDetail(scope, a.id)
    expect(detail.inputs.map(row => row.id)).toEqual([input.id, supplement.input.id])
    expect(detail.deliveries).toHaveLength(2)
    expect(detail.deliveries.every(row => row.status === 'pending' && row.executionId === null)).toBe(true)
    expect((await fixture.store.workDetail(scope, b.id)).inputs).toHaveLength(1)
    detail.work.title = 'tampered'
    expect((await fixture.store.workDetail(scope, a.id)).work.title).toBe('A')
  })

  it('restores history and pending inputs without publishing events or resuming execution', async () => {
    const work = await createWork(fixture.store)
    const execution = await recordExecution(fixture.store, work.id)
    await fixture.store.receiveInput(workspace, submission('Unrouted input'))
    const before = await fixture.store.snapshot(scope)
    await fixture.store.close()
    const reloaded = fixture.createStore().store
    const changed = vi.fn()
    reloaded.subscribe(changed)
    expect(await reloaded.snapshot(scope)).toEqual(before)
    expect((await reloaded.workDetail(scope, work.id)).executions).toEqual([execution])
    expect(changed).not.toHaveBeenCalled()
    expect(execution).not.toHaveProperty('running')
    expect(before.deliveries[0].status).toBe('pending')
    expect(before.inputs.at(-1)?.status).toBe('received')
  })

  it('guards execution identity and stale work revisions', async () => {
    const work = await createWork(fixture.store)
    const request = { executionId: randomUUID(), workId: work.id, expectedRevision: work.revision, instanceId: 'instance', cwd: workspace.workspacePath }
    const execution = await fixture.store.recordExecution(scope, request)
    expect(await fixture.store.recordExecution(scope, request)).toEqual(execution)
    await expect(fixture.store.recordExecution(scope, { ...request, cwd: 'C:/another' })).rejects.toThrow('identity')
    await expect(fixture.store.recordExecution(scope, { ...request, executionId: randomUUID() })).rejects.toThrow('Work changed')
    expect((await fixture.store.workDetail(scope, work.id)).executions).toHaveLength(1)
  })

  it('records actual delivery evidence, rejects wrong work identity and preserves terminal results', async () => {
    const a = await createWork(fixture.store)
    const b = await createWork(fixture.store, 'B')
    const executionA = await recordExecution(fixture.store, a.id)
    const executionB = await recordExecution(fixture.store, b.id)
    const [delivery] = (await fixture.store.workDetail(scope, a.id)).deliveries
    await expect(fixture.store.updateDelivery(scope, { deliveryId: delivery.id, executionId: executionB.id, status: 'delivered' })).rejects.toThrow('another work')
    await expect(fixture.store.updateDelivery(scope, { deliveryId: delivery.id, executionId: null, status: 'delivered' })).rejects.toThrow('requires an execution')
    const request = { deliveryId: delivery.id, executionId: executionA.id, status: 'delivered' as const }
    await fixture.store.updateDelivery(scope, request)
    await fixture.store.updateDelivery(scope, { ...request, status: 'unknown' })
    const incorporated = await fixture.store.updateDelivery(scope, { ...request, status: 'incorporated' })
    expect(await fixture.store.updateDelivery(scope, { ...request, status: 'incorporated' })).toEqual(incorporated)
    await expect(fixture.store.updateDelivery(scope, request)).rejects.toThrow('already settled')
    expect((await fixture.store.workDetail(scope, b.id)).deliveries[0].status).toBe('pending')
  })

  it('deduplicates reports, stores full results and keeps late reports out of the current result', async () => {
    const work = await createWork(fixture.store)
    const old = await recordExecution(fixture.store, work.id)
    const previous = await fixture.store.recordReport(scope, {
      reportId: randomUUID(), executionId: old.id, kind: 'ready', summary: 'Previous result', text: 'Previous result',
    })
    const current = await recordExecution(fixture.store, work.id)
    expect((await fixture.store.workDetail(scope, work.id)).work.latestReportId).toBeNull()
    const request = { reportId: randomUUID(), executionId: current.id, kind: 'ready' as const, summary: 'Ready for user inspection', text: ' Full original result\n'.repeat(1000) }
    const report = await fixture.store.recordReport(scope, request)
    const changes = vi.fn()
    fixture.store.subscribe(changes)
    expect(await fixture.store.recordReport(scope, request)).toEqual(report)
    expect(changes).not.toHaveBeenCalled()
    await expect(fixture.store.recordReport(scope, { ...request, text: 'different' })).rejects.toThrow('identity')
    const late = await fixture.store.recordReport(scope, { ...request, reportId: randomUUID(), executionId: old.id })
    const detail = await fixture.store.workDetail(scope, work.id)
    expect(detail.work.latestReportId).toBe(report.id)
    expect(detail.work.closedAt).toBeNull()
    expect(detail.reports.map(row => row.id)).toEqual([previous.id, report.id, late.id])
    expect((await fixture.createStore().store.readResource(scope, report.resourceId)).text).toBe(request.text)
  })

  it('isolates all reads and relationships by captured workspace', async () => {
    const work = await createWork(fixture.store)
    const { inputs } = await fixture.store.workDetail(scope, work.id)
    const other = otherWorkspace.workspaceId
    expect((await fixture.store.snapshot(other)).works).toEqual([])
    await expect(fixture.store.workDetail(other, work.id)).rejects.toThrow('not found')
    await expect(fixture.store.readResource(other, inputs[0].resourceId)).rejects.toThrow('not found')
    await expect(fixture.store.readResource(scope, '../records.json')).rejects.toThrow('not found')
    await expect(fixture.store.routeInput(other, inputs[0].id, work.id)).rejects.toThrow('not found')
    await expect(fixture.store.createWork(other, { creationId: randomUUID(), sourceInputId: inputs[0].id, title: 'B', goal: 'B' })).rejects.toThrow('not found')
  })

  it('distinguishes handled conversation inputs from work delivery status', async () => {
    const { input } = await fixture.store.receiveInput(workspace, submission('A simple question'))
    await fixture.store.markInputHandled(scope, input.id)
    const revision = (await fixture.store.snapshot(scope)).revision
    await fixture.store.markInputHandled(scope, input.id)
    expect((await fixture.store.snapshot(scope)).revision).toBe(revision)
    const work = await createWork(fixture.store)
    await expect(fixture.store.markInputHandled(scope, work.sourceInputId)).rejects.toThrow('separate delivery')
  })
})
