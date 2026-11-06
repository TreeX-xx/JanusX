import { randomUUID } from 'node:crypto'
import type { z } from 'zod'
import type {
  SuperAgentChange, SuperAgentDelivery, SuperAgentInputReceipt, SuperAgentResource,
  SuperAgentSnapshot, SuperAgentSubmitInput, SuperAgentWork, SuperAgentWorkDetail, SuperAgentWorkspace,
} from '../../../shared/superagent'
import { SerialQueue } from '../../lib/atomic-file'
import { hashText, SuperAgentPersistence } from './persistence'
import {
  createWorkSchema, deliveryUpdateSchema, identity, parseDocument, recordExecutionSchema,
  recordReportSchema, submitInputSchema, workspaceSchema, type SuperAgentDocument,
} from './schema'

interface ResourceWrite { resource: SuperAgentResource; text: string }
interface Mutation<T> { value: T; unchanged?: boolean; resources?: ResourceWrite[] }

function owned<T extends { id: string; workspaceId: string }>(rows: T[], id: string, workspaceId: string): T {
  const record = rows.find(row => row.id === id && row.workspaceId === workspaceId)
  if (!record) throw new Error('SuperAgent record not found in workspace')
  return record
}

/** Single host writer. Every receipt/change is published only after its atomic index commit. */
export class SuperAgentStore {
  private readonly queue = new SerialQueue()
  private readonly listeners = new Set<(event: SuperAgentChange) => void>()
  private data?: SuperAgentDocument
  private closing = false

  constructor(private readonly persistence: SuperAgentPersistence, private readonly now = Date.now) {}

  get directory(): string { return this.persistence.directory }

  workspaceIds(): Promise<string[]> { return this.queue.run(async () => [...new Set((await this.load()).works.map(row => row.workspaceId))]) }

  subscribe(listener: (event: SuperAgentChange) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Drain already admitted writes; new writes fail. No dispatch or process restoration occurs. */
  close(): Promise<void> {
    this.closing = true
    return this.queue.run(async () => { this.listeners.clear() })
  }

  private async load(): Promise<SuperAgentDocument> {
    return this.data ??= await this.persistence.load()
  }

  private mutate<T>(workspaceId: string, kind: SuperAgentChange['kind'], change: (draft: SuperAgentDocument) => Mutation<T>) {
    if (this.closing) return Promise.reject(new Error('SuperAgent records are closing'))
    return this.queue.run(async () => {
      const current = await this.load()
      const draft = structuredClone(current)
      const mutation = change(draft)
      if (mutation.unchanged) return { value: structuredClone(mutation.value), revision: current.revision, changed: false }
      draft.revision += 1
      const validated = parseDocument(draft)
      try {
        // An interrupted write may leave an unreferenced body. Never publish a dangling reference.
        for (const body of mutation.resources ?? []) await this.persistence.writeResource(body.resource, body.text)
        await this.persistence.save(validated)
      } catch (error) {
        // A post-rename failure can be ambiguous. A subsequent explicit call reloads disk, never resends work.
        this.data = undefined
        throw error
      }
      this.data = validated
      const event = { workspaceId, revision: validated.revision, kind }
      for (const listener of this.listeners) {
        try { listener({ ...event }) } catch (error) { console.error('[superagent] record notification failed', error) }
      }
      return { value: structuredClone(mutation.value), revision: validated.revision, changed: true }
    })
  }

  private body(draft: SuperAgentDocument, workspaceId: string, kind: SuperAgentResource['kind'], text: string): ResourceWrite {
    const resource: SuperAgentResource = {
      id: randomUUID(), workspaceId, kind, sha256: hashText(text), bytes: Buffer.byteLength(text, 'utf8'), createdAt: this.now(),
    }
    draft.resources.push(resource)
    return { resource, text }
  }

  async receiveInput(workspace: SuperAgentWorkspace, value: SuperAgentSubmitInput): Promise<SuperAgentInputReceipt> {
    const scope = workspaceSchema.parse(workspace), input = submitInputSchema.parse(value)
    if (input.workspaceId !== scope.workspaceId) throw new Error('Input workspace mismatch')
    const result = await this.mutate(scope.workspaceId, 'input', draft => {
      const existing = draft.inputs.find(row => row.eventId === input.eventId)
      if (existing) {
        const resource = owned(draft.resources, existing.resourceId, existing.workspaceId)
        if (existing.workspaceId !== scope.workspaceId || existing.conversationId !== input.conversationId
          || resource.sha256 !== hashText(input.text) || resource.bytes !== Buffer.byteLength(input.text, 'utf8')) {
          throw new Error('Input event identity already belongs to a different submission')
        }
        return { value: existing, unchanged: true }
      }
      const body = this.body(draft, scope.workspaceId, 'input', input.text)
      const record = {
        ...scope, id: randomUUID(), eventId: input.eventId, conversationId: input.conversationId,
        sequence: draft.inputs.reduce((last, row) => Math.max(last, row.sequence), 0) + 1,
        resourceId: body.resource.id, receivedAt: this.now(), status: 'received' as const,
      }
      draft.inputs.push(record)
      return { value: record, resources: [body] }
    })
    return { input: result.value, duplicate: !result.changed, revision: result.revision }
  }

  /** Called by host routing later, not by renderer submissions. */
  async createWork(workspaceId: string, value: z.input<typeof createWorkSchema>): Promise<SuperAgentWork> {
    const scope = identity.parse(workspaceId), input = createWorkSchema.parse(value)
    return (await this.mutate(scope, 'work', draft => {
      const source = owned(draft.inputs, input.sourceInputId, scope)
      const existing = draft.works.find(row => row.creationId === input.creationId)
      if (existing) {
        if (existing.workspaceId !== scope || existing.sourceInputId !== input.sourceInputId
          || existing.title !== input.title || existing.goal !== input.goal) throw new Error('Work creation identity conflict')
        return { value: existing, unchanged: true }
      }
      const work: SuperAgentWork = {
        id: randomUUID(), ...input, workspaceId: scope, workspacePath: source.workspacePath,
        revision: 0, createdAt: this.now(), updatedAt: this.now(), closedAt: null, latestExecutionId: null, latestReportId: null,
      }
      draft.works.push(work)
      this.attach(draft, scope, source.id, work)
      return { value: work }
    })).value
  }

  private attach(draft: SuperAgentDocument, workspaceId: string, inputId: string, work: SuperAgentWork): SuperAgentDelivery {
    const input = owned(draft.inputs, inputId, workspaceId)
    const existing = draft.deliveries.find(row => row.workId === work.id && row.inputId === input.id)
    if (existing) return existing
    if (work.closedAt !== null) throw new Error('Work is closed')
    const delivery: SuperAgentDelivery = {
      id: randomUUID(), workspaceId, inputId, workId: work.id, executionId: null, status: 'pending', updatedAt: this.now(),
    }
    draft.deliveries.push(delivery)
    input.status = 'routed'
    work.revision += 1; work.updatedAt = this.now()
    return delivery
  }

  async routeInput(workspaceId: string, inputId: string, workId: string): Promise<SuperAgentDelivery> {
    const scope = identity.parse(workspaceId), input = identity.parse(inputId), target = identity.parse(workId)
    return (await this.mutate(scope, 'delivery', draft => {
      const work = owned(draft.works, target, scope)
      const existing = draft.deliveries.find(row => row.workId === work.id && row.inputId === input)
      return { value: this.attach(draft, scope, input, work), unchanged: !!existing }
    })).value
  }

  async markInputHandled(workspaceId: string, inputId: string): Promise<void> {
    const scope = identity.parse(workspaceId), id = identity.parse(inputId)
    await this.mutate(scope, 'input', draft => {
      const input = owned(draft.inputs, id, scope)
      if (input.status === 'routed') throw new Error('Routed input has separate delivery records')
      const unchanged = input.status === 'handled'
      input.status = 'handled'
      return { value: undefined, unchanged }
    })
  }

  /** Explicit user control is durable before queued or late execution can observe it. */
  async controlWork(workspaceId: string, workId: string, expectedRevision: number, action: 'stop' | 'close' | 'reopen'): Promise<SuperAgentWork> {
    const scope = identity.parse(workspaceId), id = identity.parse(workId)
    return (await this.mutate(scope, 'work', draft => {
      const work = owned(draft.works, id, scope)
      if (work.revision !== expectedRevision) throw new Error('Work changed; read its current revision before deciding')
      if (action === 'reopen') {
        if (work.closedAt === null) throw new Error('Work is already open')
        work.closedAt = null
      } else {
        if (action === 'close') work.closedAt = this.now()
        for (const delivery of draft.deliveries) if (delivery.workId === id && ['pending', 'unknown'].includes(delivery.status)) {
          delivery.status = 'cancelled'; delivery.updatedAt = this.now()
        }
      }
      work.revision++; work.updatedAt = this.now()
      return { value: work }
    })).value
  }

  async recordExecution(workspaceId: string, value: z.input<typeof recordExecutionSchema>) {
    const scope = identity.parse(workspaceId), input = recordExecutionSchema.parse(value)
    return (await this.mutate(scope, 'execution', draft => {
      const work = owned(draft.works, input.workId, scope)
      const existing = draft.executions.find(row => row.id === input.executionId)
      if (existing) {
        if (existing.workspaceId !== scope || existing.workId !== work.id || existing.instanceId !== input.instanceId
          || existing.cwd !== input.cwd || existing.providerSessionId !== input.providerSessionId || existing.nativeTurnId !== input.nativeTurnId) {
          throw new Error('Execution identity conflict')
        }
        return { value: existing, unchanged: true }
      }
      if (work.closedAt !== null || work.revision !== input.expectedRevision) throw new Error('Work changed or closed before recording execution')
      const record = {
        id: input.executionId, workspaceId: scope, workId: work.id, instanceId: input.instanceId, cwd: input.cwd,
        providerSessionId: input.providerSessionId, nativeTurnId: input.nativeTurnId, recordedAt: this.now(),
      }
      draft.executions.push(record)
      work.latestExecutionId = record.id
      work.latestReportId = null
      work.revision += 1
      work.updatedAt = this.now()
      return { value: record }
    })).value
  }

  async updateDelivery(workspaceId: string, value: z.input<typeof deliveryUpdateSchema>): Promise<SuperAgentDelivery> {
    const scope = identity.parse(workspaceId), input = deliveryUpdateSchema.parse(value)
    return (await this.mutate(scope, 'delivery', draft => {
      const delivery = owned(draft.deliveries, input.deliveryId, scope)
      if (input.executionId) {
        const execution = owned(draft.executions, input.executionId, scope)
        if (execution.workId !== delivery.workId) throw new Error('Delivery execution belongs to another work')
      } else if (input.status !== 'cancelled') throw new Error('Delivery evidence requires an execution')
      if (delivery.executionId && delivery.executionId !== input.executionId) throw new Error('Delivery execution changed')
      if (delivery.status === input.status && delivery.executionId === input.executionId) return { value: delivery, unchanged: true }
      if (delivery.status === 'incorporated' || delivery.status === 'cancelled') throw new Error('Delivery is already settled')
      delivery.status = input.status; delivery.executionId = input.executionId; delivery.updatedAt = this.now()
      return { value: delivery }
    })).value
  }

  /** Only the managed adapter's local no-send receipt may undo its provisional unknown marker. */
  async deferUnsentDelivery(workspaceId: string, deliveryId: string, executionId: string): Promise<void> {
    await this.mutate(identity.parse(workspaceId), 'delivery', draft => {
      const delivery = owned(draft.deliveries, identity.parse(deliveryId), workspaceId)
      if (delivery.status === 'cancelled') return { value: undefined, unchanged: true }
      if (delivery.status !== 'unknown' || delivery.executionId !== executionId) throw new Error('Delivery changed before local deferral')
      const work = owned(draft.works, delivery.workId, workspaceId)
      delivery.status = work.closedAt === null ? 'pending' : 'cancelled'
      delivery.executionId = null; delivery.updatedAt = this.now()
      return { value: undefined }
    })
  }

  /** Fill native identity only from the owned process; a known identity can never be rebound. */
  async bindExecution(workspaceId: string, executionId: string, binding: { providerSessionId?: string; nativeTurnId?: string }): Promise<void> {
    const scope = identity.parse(workspaceId), id = identity.parse(executionId)
    if (binding.providerSessionId !== undefined) identity.parse(binding.providerSessionId)
    if (binding.nativeTurnId !== undefined) identity.parse(binding.nativeTurnId)
    await this.mutate(scope, 'execution', draft => {
      const execution = owned(draft.executions, id, scope)
      for (const key of ['providerSessionId', 'nativeTurnId'] as const) if (binding[key] !== undefined) {
        if (execution[key] !== null && execution[key] !== binding[key]) throw new Error('Native execution identity changed')
        execution[key] = binding[key]
      }
      return { value: undefined }
    })
  }

  async recordReport(workspaceId: string, value: z.input<typeof recordReportSchema>) {
    const scope = identity.parse(workspaceId), input = recordReportSchema.parse(value)
    return (await this.mutate(scope, 'report', draft => {
      const execution = owned(draft.executions, input.executionId, scope)
      const work = owned(draft.works, execution.workId, scope)
      const existing = draft.reports.find(row => row.id === input.reportId)
      if (existing) {
        const resource = owned(draft.resources, existing.resourceId, scope)
        if (existing.executionId !== execution.id || existing.kind !== input.kind || existing.summary !== input.summary
          || resource.sha256 !== hashText(input.text) || resource.bytes !== Buffer.byteLength(input.text, 'utf8')) throw new Error('Report identity conflict')
        return { value: existing, unchanged: true }
      }
      const body = this.body(draft, scope, 'report', input.text)
      const report = {
        id: input.reportId, workspaceId: scope, workId: work.id, executionId: execution.id,
        kind: input.kind, summary: input.summary, resourceId: body.resource.id, receivedAt: this.now(),
        availableInputIds: draft.deliveries.filter(row => row.workId === work.id && row.executionId === execution.id
          && ['delivered', 'incorporated'].includes(row.status)).map(row => row.inputId),
      }
      draft.reports.push(report)
      // Old execution reports remain history, never replace the current result or reopen work.
      if (work.latestExecutionId === execution.id && work.closedAt === null) {
        work.latestReportId = report.id; work.revision += 1; work.updatedAt = this.now()
      }
      return { value: report, resources: [body] }
    })).value
  }

  snapshot(workspaceId: string): Promise<SuperAgentSnapshot> {
    const scope = identity.parse(workspaceId)
    return this.queue.run(async () => {
      const data = await this.load()
      const scoped = <T extends { workspaceId: string }>(rows: T[]) => rows.filter(row => row.workspaceId === scope)
      return structuredClone({ workspaceId: scope, revision: data.revision,
        works: scoped(data.works), inputs: scoped(data.inputs), deliveries: scoped(data.deliveries),
        executions: scoped(data.executions), reports: scoped(data.reports), resources: scoped(data.resources) })
    })
  }

  async workDetail(workspaceId: string, workId: string): Promise<SuperAgentWorkDetail> {
    const snapshot = await this.snapshot(workspaceId)
    const work = owned(snapshot.works, identity.parse(workId), snapshot.workspaceId)
    const deliveries = snapshot.deliveries.filter(row => row.workId === work.id)
    const inputIds = new Set([work.sourceInputId, ...deliveries.map(row => row.inputId)])
    const inputs = snapshot.inputs.filter(row => inputIds.has(row.id))
    const reports = snapshot.reports.filter(row => row.workId === work.id)
    const resourceIds = new Set([...inputs, ...reports].map(row => row.resourceId))
    return { workspaceId: snapshot.workspaceId, revision: snapshot.revision, work, inputs, deliveries, reports,
      executions: snapshot.executions.filter(row => row.workId === work.id), resources: snapshot.resources.filter(row => resourceIds.has(row.id)) }
  }

  readResource(workspaceId: string, resourceId: string) {
    const scope = identity.parse(workspaceId), id = identity.parse(resourceId)
    return this.queue.run(async () => {
      const resource = owned((await this.load()).resources, id, scope)
      return { resource: structuredClone(resource), text: await this.persistence.readResource(resource) }
    })
  }
}
