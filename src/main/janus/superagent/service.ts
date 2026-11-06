import type { SuperAgentWork, SuperAgentWorkspace } from '../../../shared/superagent'
import { identity, submitInputSchema } from './schema'
import { SuperAgentStore } from './store'
import { SuperAgentEnvironmentUnavailable, type SuperAgentEnvironments } from './environments'
import { environmentDecisionSchema } from './environment-schema'
import type { SuperAgentWorkers } from './workers'
import type { SuperAgentAppendInput, SuperAgentContinueInput, SuperAgentWorkerControl } from '../../../shared/superagent-worker'
import { inspectCheckout } from '../../git/controlled-worktree'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { SerialQueue } from '../../lib/atomic-file'
import { SuperAgentScheduler } from './scheduler'
import type { SuperAgentRouteDecision, SuperAgentWorkControl } from '../../../shared/superagent-scheduling'
import { SuperAgentContext } from './context'

const routeSchema = z.discriminatedUnion('action', [
  z.object({ inputId: z.string().uuid(), action: z.literal('new'), key: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    title: z.string().trim().min(1).max(160), goal: z.string().trim().min(1).max(20_000) }).strict(),
  ...(['continue', 'stop', 'close', 'reopen'] as const).map(action => z.object({ inputId: z.string().uuid(), action: z.literal(action),
    workId: z.string().uuid(), expectedRevision: z.number().int().positive().safe() }).strict()),
  z.object({ inputId: z.string().uuid(), action: z.literal('stop-all'), scope: z.enum(['workspace', 'all-workspaces']) }).strict(),
])

/** Admission, semantic decisions and deterministic execution checks share the same durable records. */
export class SuperAgentService {
  readonly scheduler?: SuperAgentScheduler
  readonly context: SuperAgentContext
  private decisions = new SerialQueue()
  private closing = false
  constructor(
    readonly store: SuperAgentStore,
    private readonly resolveWorkspaceRoot: (workspaceId: string) => Promise<string | undefined>,
    readonly environments?: SuperAgentEnvironments,
    readonly workers?: SuperAgentWorkers,
  ) {
    this.context = workers?.context ?? new SuperAgentContext(store, environments)
    if (workers) this.scheduler = new SuperAgentScheduler(store, workers)
  }

  private async workspace(value: unknown): Promise<SuperAgentWorkspace> {
    const workspaceId = identity.parse(value)
    const workspacePath = await this.resolveWorkspaceRoot(workspaceId)
    if (!workspacePath) throw new Error('SuperAgent workspace is not registered')
    return { workspaceId, workspacePath }
  }

  async submitInput(value: unknown) {
    // Parse before yielding so a caller cannot change scope/text while workspace lookup awaits.
    const input = submitInputSchema.parse(value)
    const workspace = await this.workspace(input.workspaceId)
    await this.scheduler?.initialize()
    return this.store.receiveInput(workspace, input)
  }

  async snapshot(workspaceId: unknown) {
    return this.store.snapshot((await this.workspace(workspaceId)).workspaceId)
  }

  async workDetail(workspaceId: unknown, workId: unknown) {
    const id = identity.parse(workId)
    return this.store.workDetail((await this.workspace(workspaceId)).workspaceId, id)
  }

  async readResource(workspaceId: unknown, resourceId: unknown) {
    const id = identity.parse(resourceId)
    return this.store.readResource((await this.workspace(workspaceId)).workspaceId, id)
  }

  async environmentSnapshot(workspaceId: unknown) {
    const scope = await this.workspace(workspaceId)
    if (!this.environments) throw new Error('SuperAgent environment service is unavailable')
    return this.environments.store.snapshot(scope.workspaceId)
  }

  async decideEnvironmentOperation(value: unknown) {
    const decision = environmentDecisionSchema.parse(value)
    await this.workspace(decision.workspaceId)
    if (!this.environments) throw new Error('SuperAgent environment service is unavailable')
    const result = await this.environments.decide(decision)
    if (result.status !== 'pending' && result.status !== 'executing') {
      await this.scheduler?.approval(decision.workspaceId, result.workId, result.id, result.status === 'succeeded')
    }
    return result
  }

  /** Propose only: the renderer's concrete approval remains the sole execution entry. */
  proposeGitOperation(workspaceId: string, value: { inputId: string; workId: string; expectedRevision: number; kind: 'merge' | 'remove' }, signal?: AbortSignal) {
    const request = z.object({ inputId: z.string().uuid(), workId: z.string().uuid(), expectedRevision: z.number().int().positive().safe(),
      kind: z.enum(['merge', 'remove']) }).strict().parse(value)
    return this.decisions.run(async () => {
      if (this.closing) throw new Error('SuperAgent is shutting down')
      signal?.throwIfAborted()
      await this.workspace(workspaceId)
      if (!this.scheduler || !this.environments) throw new Error('Work environment management is unavailable')
      const records = await this.store.snapshot(workspaceId)
      const input = records.inputs.find(row => row.id === request.inputId)
      if (!input) throw new Error('Input does not belong to this workspace')
      const ledger = this.scheduler.ledger, kind = request.kind === 'merge' ? 'git-merge' : 'git-remove'
      const id = `${input.id}:${kind}:${request.workId}`, state = await ledger.snapshot()
      const previous = state.actions.find(row => row.id === id)
      if (previous) {
        const operation = (await this.environments.store.snapshot(workspaceId)).operations.find(row => row.id === previous.operationId)
        if (previous.status !== 'applied' || !operation) throw new Error('The earlier proposal has an unknown outcome; it will not be replayed')
        return operation
      }
      const work = records.works.find(row => row.id === request.workId)
      if (!work || work.closedAt !== null || work.revision !== request.expectedRevision) throw new Error('Work changed or closed; read the current card')
      if (state.actions.some(row => ['stop', 'close', 'stop-all'].includes(row.kind)
        && (row.workId === work.id || row.kind === 'stop-all' && (row.scope === 'all-workspaces' || row.workspaceId === workspaceId))
        && (row.inputSequence ?? records.inputs.find(source => source.id === row.inputId)?.sequence ?? 0) >= input.sequence)) {
        throw new Error('This input predates a stop or close; a new explicit input is required')
      }
      signal?.throwIfAborted()
      await ledger.change(data => { data.actions.push({ id, workspaceId, inputId: input.id, kind, workId: work.id,
        fingerprint: JSON.stringify(request), status: 'applying' }) })
      try {
        signal?.throwIfAborted()
        const operation = request.kind === 'merge' ? await this.environments.proposeMerge(workspaceId, work.id)
          : await this.environments.proposeRemove(workspaceId, work.id)
        await ledger.change(data => { const row = data.actions.find(row => row.id === id)!; row.status = 'applied'; row.operationId = operation.id })
        return operation
      } catch (error) {
        await ledger.change(data => { const row = data.actions.find(row => row.id === id)!; row.status = 'unknown'; row.error = String(error) }).catch(() => undefined)
        throw error
      }
    })
  }

  /** Compatibility entry for an explicit work. All launches still pass through shared capacity. */
  async prepareWorker(value: unknown) {
    const receipt = await this.submitInput(value)
    const input = receipt.input
    const body = await this.store.readResource(input.workspaceId, input.resourceId)
    const work = await this.store.createWork(input.workspaceId, { creationId: input.id, sourceInputId: input.id,
      title: body.text.slice(0, 120), goal: body.text })
    return { receipt, work, operation: await this.prepareEnvironment(work) }
  }

  private async prepareEnvironment(work: SuperAgentWork) {
    if (!this.environments) throw new Error('Worker environments are unavailable')
    const snapshot = await this.environments.store.snapshot(work.workspaceId)
    if (snapshot.environments.some(row => row.workId === work.id && row.removedAt === null)) return undefined
    const existing = snapshot.operations.find(row => row.workId === work.id && row.status === 'pending')
    if (existing) return existing
    const checkout = await inspectCheckout(work.workspacePath)
    if (!checkout.dirty) {
      try { await this.environments.reuse(work.workspaceId, { workId: work.id, path: checkout.path, branch: checkout.branch }); return undefined }
      catch (error) { if (!(error instanceof SuperAgentEnvironmentUnavailable)) throw error }
    }
    return this.environments.proposeCreate(work.workspaceId, { workId: work.id })
  }

  async startWorker(workspaceId: unknown, workId: unknown) {
    const scope = await this.workspace(workspaceId)
    if (!this.scheduler) throw new Error('Managed Workers are unavailable')
    const detail = await this.workDetail(scope.workspaceId, workId)
    const pending = detail.deliveries.filter(row => row.status === 'pending').at(-1)
    if (!pending) throw new Error('There is no pending explicit input; execution will not be replayed')
    await this.scheduler.checkInput(scope.workspaceId, detail.work.id, detail.inputs.find(row => row.id === pending.inputId)!.sequence)
    const operation = await this.prepareEnvironment(detail.work)
    return this.scheduler.request(scope.workspaceId, detail.work.id, pending.inputId, operation?.id)
  }
  async appendWorker(input: SuperAgentAppendInput) {
    await this.workspace(input.workspaceId)
    if (!this.workers) throw new Error('Managed Workers are unavailable')
    const current = this.workers.snapshots(input.workspaceId).find(row => row.workId === input.workId)
    if (current?.executionId !== input.executionId) throw new Error('Worker execution changed; refresh before controlling it')
    const { executionId: _executionId, ...continuation } = input
    await this.continueWorker(continuation)
    return this.workers.snapshots(input.workspaceId).find(row => row.workId === input.workId)!
  }
  async continueWorker(value: SuperAgentContinueInput) {
    const { workId, ...inputValue } = value
    const input = submitInputSchema.parse(inputValue)
    const detail = await this.workDetail(input.workspaceId, workId)
    const receipt = await this.submitInput(input)
    await this.routeDecision(input.workspaceId, { inputId: receipt.input.id, action: 'continue', workId, expectedRevision: detail.work.revision })
    const updated = await this.workDetail(input.workspaceId, workId)
    const environments = await this.environmentSnapshot(input.workspaceId)
    return { receipt, work: updated.work, operation: environments.operations.find(row => row.workId === workId && row.status === 'pending') }
  }
  async workerSnapshots(workspaceId: unknown) {
    const scope = await this.workspace(workspaceId)
    await this.workers?.initialize()
    return this.workers?.snapshots(scope.workspaceId) ?? []
  }
  async controlWorker(value: SuperAgentWorkerControl) {
    await this.workspace(value.workspaceId)
    if (!this.workers) throw new Error('Managed Workers are unavailable')
    if (value.type === 'stop' && this.scheduler) {
      const native = this.workers.snapshots(value.workspaceId).find(row => row.workId === value.workId)
      if (native?.executionId !== value.executionId) throw new Error('Worker execution changed; refresh before controlling it')
      const detail = await this.workDetail(value.workspaceId, value.workId)
      await this.controlWork({ workspaceId: value.workspaceId, workId: value.workId, expectedRevision: detail.work.revision, action: 'stop', conversationId: native.conversationId })
      return this.workers.snapshots(value.workspaceId).find(row => row.workId === value.workId)!
    }
    return this.workers.control(value)
  }
  async workerLog(workspaceId: unknown, executionId: unknown) {
    const scope = await this.workspace(workspaceId)
    if (!this.workers) throw new Error('Managed Workers are unavailable')
    return this.workers.readLog(scope.workspaceId, identity.parse(executionId))
  }

  async scheduleSnapshot(workspaceId: unknown) {
    const scope = await this.workspace(workspaceId)
    if (!this.scheduler) throw new Error('Worker scheduling is unavailable')
    return this.scheduler.snapshot(scope.workspaceId)
  }
  async configureCapacity(value: unknown) {
    if (!this.scheduler) throw new Error('Worker scheduling is unavailable')
    return this.scheduler.configure(value)
  }
  async controlWork(value: SuperAgentWorkControl) {
    const action = z.enum(['stop', 'close']).parse(value.action)
    const receipt = await this.submitInput({ workspaceId: value.workspaceId, conversationId: identity.parse(value.conversationId),
      eventId: randomUUID(), text: `Explicit ${action} of work ${value.workId}` })
    return this.routeDecision(value.workspaceId, { action, inputId: receipt.input.id, workId: value.workId, expectedRevision: value.expectedRevision })
  }
  routeDecision(workspaceId: string, value: SuperAgentRouteDecision, signal?: AbortSignal) {
    const decision = routeSchema.parse(value)
    return this.decisions.run(async () => {
      if (this.closing) throw new Error('SuperAgent is shutting down')
      signal?.throwIfAborted()
      await this.workspace(workspaceId)
      if (!this.scheduler) throw new Error('Worker scheduling is unavailable')
      const records = await this.store.snapshot(workspaceId), source = records.inputs.find(row => row.id === decision.inputId)
      if (!source) throw new Error('Input does not belong to this workspace')
      if (decision.action === 'stop-all') return this.stopAll(workspaceId, source.id, source.sequence, decision.scope)
      const target = decision.action === 'new' ? decision.key : decision.workId
      const id = `${source.id}:${decision.action}:${target}`
      const fingerprint = JSON.stringify(decision.action === 'new' ? decision : { inputId: source.id, action: decision.action, workId: decision.workId })
      const state = await this.scheduler.ledger.snapshot(), previous = state.actions.find(row => row.id === id)
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new Error('Decision identity conflict; the original outcome is preserved')
        if (previous.status !== 'applied' || !previous.workId) throw new Error('The earlier decision has an unknown outcome and will not be replayed; read current records')
        return this.workCard(workspaceId, previous.workId)
      }
      if (['new', 'continue', 'reopen'].includes(decision.action) && state.actions.some(row => row.kind === 'stop-all'
        && (row.scope === 'all-workspaces' || row.workspaceId === workspaceId) && (row.inputSequence ?? 0) >= source.sequence)) {
        throw new Error('This input predates stop-all; a new explicit input is required')
      }
      if (decision.action !== 'new') {
        const work = records.works.find(row => row.id === decision.workId)
        if (!work || work.revision !== decision.expectedRevision) throw new Error('Work changed; read the current card before deciding')
        const newerControl = state.actions.some(row => row.workId === work.id && ['stop', 'close'].includes(row.kind)
          && (records.inputs.find(input => input.id === row.inputId)?.sequence ?? 0) >= source.sequence)
        if (newerControl) throw new Error('This input predates a stop or close; a new explicit input is required')
        if (work.closedAt !== null && !['reopen', 'stop', 'close'].includes(decision.action)) throw new Error('Work is closed; explicit reopening is required')
      }
      signal?.throwIfAborted()
      await this.scheduler.ledger.change(data => { data.actions.push({ id, workspaceId, inputId: source.id, fingerprint, kind: decision.action, status: 'applying',
        ...(decision.action === 'new' ? {} : { workId: decision.workId }) }) })
      try {
        signal?.throwIfAborted()
        let work: SuperAgentWork
        if (decision.action === 'new') {
          work = await this.store.createWork(workspaceId, { creationId: `${source.id}:${decision.key}`, sourceInputId: source.id, title: decision.title, goal: decision.goal })
        } else {
          work = (await this.workDetail(workspaceId, decision.workId)).work
          if (decision.action !== 'continue') work = await this.store.controlWork(workspaceId, work.id, decision.expectedRevision, decision.action)
          else if (work.revision !== decision.expectedRevision) throw new Error('Work changed before dispatch')
        }
        if (decision.action === 'stop' || decision.action === 'close') await this.scheduler.cancel(workspaceId, work.id, decision.action === 'close')
        else {
          await this.store.routeInput(workspaceId, source.id, work.id)
          work = (await this.workDetail(workspaceId, work.id)).work
          const operation = await this.prepareEnvironment(work)
          signal?.throwIfAborted()
          await this.scheduler.request(workspaceId, work.id, source.id, operation?.id)
        }
        await this.scheduler.ledger.change(data => { const row = data.actions.find(row => row.id === id)!; row.status = 'applied'; row.workId = work.id })
        return this.workCard(workspaceId, work.id)
      } catch (error) {
        await this.scheduler.ledger.change(data => { const row = data.actions.find(row => row.id === id)!; row.status = 'unknown'; row.error = String(error) }).catch(() => undefined)
        throw error
      }
    })
  }
  private async stopAll(workspaceId: string, inputId: string, inputSequence: number, scope: 'workspace' | 'all-workspaces') {
    const scheduler = this.scheduler!, id = `${inputId}:stop-all:${scope}`, fingerprint = JSON.stringify({ inputId, action: 'stop-all', scope })
    const data = await scheduler.ledger.snapshot(), previous = data.actions.find(row => row.id === id)
    if (previous) {
      if (previous.status !== 'applied') throw new Error('The previous stop-all outcome is unknown; inspect current records before a new explicit control')
      return { action: 'stop-all', scope, targets: previous.targets ?? [], requested: true }
    }
    await this.workers?.initialize()
    const targets: Array<{ workspaceId: string; workId: string; closed: boolean }> = []
    for (const currentScope of scope === 'all-workspaces' ? await this.store.workspaceIds() : [workspaceId]) {
      const records = await this.store.snapshot(currentScope), native = this.workers?.snapshots(currentScope) ?? []
      for (const work of records.works) {
        const row = data.entries.find(item => item.workId === work.id)
        if (native.some(item => item.workId === work.id && !item.stopConfirmed) || (row && ['awaiting-approval', 'queued', 'starting', 'running', 'waiting', 'idle', 'stopping'].includes(row.status))
          || records.deliveries.some(item => item.workId === work.id && ['pending', 'unknown'].includes(item.status))) {
          targets.push({ workspaceId: currentScope, workId: work.id, closed: work.closedAt !== null })
        }
      }
    }
    await scheduler.ledger.change(draft => { draft.actions.push({ id, workspaceId, inputId, inputSequence, fingerprint, kind: 'stop-all', scope, status: 'applying',
      targets: targets.map(({ workspaceId, workId }) => ({ workspaceId, workId })) }) })
    try {
      await scheduler.cancelMany(targets, async () => {
        for (const target of targets) {
          const detail = await this.store.workDetail(target.workspaceId, target.workId)
          await this.store.controlWork(target.workspaceId, target.workId, detail.work.revision, 'stop')
        }
      })
      await scheduler.ledger.change(draft => { draft.actions.find(row => row.id === id)!.status = 'applied' })
      return { action: 'stop-all', scope, targets: targets.map(({ workspaceId, workId }) => ({ workspaceId, workId })), requested: true }
    } catch (error) {
      await scheduler.ledger.change(draft => { const row = draft.actions.find(item => item.id === id)!; row.status = 'unknown'; row.error = String(error) }).catch(() => undefined)
      throw error
    }
  }
  async workCard(workspaceId: string, workId: string, query: unknown = {}, maxTokens = Infinity) {
    await this.workspace(workspaceId)
    await this.workers?.initialize()
    const card = await this.context.card(workspaceId, workId, query, maxTokens)
    const schedule = (await this.scheduler?.snapshot(workspaceId))?.entries.find(row => row.workId === workId)
    const lifecycle = (await this.workers?.lifecycle.snapshot())?.find(row => row.workId === workId)
    return { ...card, schedule, lifecycle,
      worker: (() => { const worker = this.workers?.snapshots(workspaceId).find(row => row.workId === workId)
        return worker && { executionId: worker.executionId, phase: worker.phase, stopConfirmed: worker.stopConfirmed, diagnostic: worker.diagnostic,
          pendingApprovals: worker.conversation.approvals.length, pendingQuestions: worker.conversation.questions?.length ?? 0 } })() }
  }
  async listWorks(workspaceId: string, query = '', offset = 0, size = 20) {
    await this.workspace(workspaceId)
    const directory = await this.context.list(workspaceId, query, offset, size), schedule = await this.scheduler?.snapshot(workspaceId)
    return { ...directory, maxConcurrentWorkers: schedule?.maxConcurrentWorkers, occupied: schedule?.occupied,
      states: schedule && Object.fromEntries([...new Set(schedule.entries.map(row => row.status))].map(status => [status, schedule.entries.filter(row => row.status === status).length])),
      works: directory.works.map(work => ({ ...work, schedule: schedule?.entries.find(row => row.workId === work.id) })) }
  }

  async close(): Promise<void> {
    this.closing = true
    // Stop owned processes even if another persistence/queue drain fails during shutdown.
    const results = await Promise.allSettled([this.scheduler?.close(), this.workers?.close(), this.decisions.run(async () => {})])
    const drained = await Promise.allSettled([this.context.close(), this.environments?.close(), this.store.close()])
    const failures = [...results, ...drained].filter(row => row.status === 'rejected')
    if (failures.length) throw new AggregateError(failures.map(row => row.reason), 'SuperAgent shutdown has unconfirmed outcomes')
  }
}
