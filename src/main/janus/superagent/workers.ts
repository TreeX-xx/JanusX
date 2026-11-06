import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import type { ConversationSnapshot } from '../../../shared/conversation-display'
import type { SuperAgentAppendInput, SuperAgentWorkerControl, SuperAgentWorkerSnapshot } from '../../../shared/superagent-worker'
import { CodexConversation, ManagedInputDeferred } from '../../terminal/codex-conversation'
import type { CodexRpc } from '../../terminal/codex-managed-transport'
import { SerialQueue } from '../../lib/atomic-file'
import { executeControlledCommit, prepareControlledCommit, previewControlledCommit, type ControlledCommitPlan } from '../../git/controlled-commit'
import { SuperAgentEnvironments, type SuperAgentEnvironmentLease } from './environments'
import { SuperAgentStore } from './store'
import { SuperAgentWorkerBroker } from './worker-broker'
import { SuperAgentNativeLogs } from './native-log'
import { identity, recordReportSchema, submitInputSchema } from './schema'
import { workerPermissions } from './worker-permissions'
import { WORKER_MCP_NAME, WORKER_RESTRICTIONS, workerLaunch } from './worker-launch'
import { writeRecordAtomic } from './persistence'
import { SuperAgentContext, cardQuerySchema, resourceQuerySchema } from './context'
import { ContextReadEvidence, fitText, INLINE_CONTEXT_TOKENS, mcpOutputBytes } from './context-reader'
import { estimateContextTokens } from '@janus-agent/chat-core'
import { conversationState } from '../../terminal/conversation-session'
import { SuperAgentLifecycleStore, WORKER_IDLE_MS } from './lifecycle-store'

export interface WorkerLaunchOptions { command: string; env: NodeJS.ProcessEnv; mcpCommand: string; mcpEntry: string }
export interface ManagedWorkerEngine {
  snapshot(): ConversationSnapshot
  startManaged(options: Parameters<CodexConversation['startManaged']>[0]): Promise<void>
  managedCall(method: 'mcpServerStatus/list', params: CodexRpc): Promise<CodexRpc>
  managedInput(text: string, expectedTurnId: string | null): Promise<{ turnId: string }>
  command(command: Parameters<CodexConversation['command']>[0]): Promise<ConversationSnapshot>
  dispose(): Promise<void>
}
interface WorkerEntry {
  snapshot: SuperAgentWorkerSnapshot
  engine: ManagedWorkerEngine
  lease: SuperAgentEnvironmentLease
  revoke?: () => void
  inputQueue: SerialQueue
  dispatchQueue: SerialQueue
  events: SerialQueue
  commitQueue: SerialQueue
  stopped?: Promise<void>
  stopping: boolean
  cancelContinuation: boolean
  nativeEnded: boolean
  inputVersion: number
  reportVersion?: number
  heartbeatAt?: number
  mcpExpectedAt?: number
  durable?: boolean
  persistedState?: string
  persistenceFailed?: boolean
  stopFailed?: boolean
  reads: ContextReadEvidence
  contextOutputBytes: number
  commit?: { plan: ControlledCommitPlan; promise: Promise<unknown>; resolve(value: unknown): void; reject(error: Error): void; expiresAt: number; timer: ReturnType<typeof setTimeout> }
}
const controlSchema = z.object({ workspaceId: identity, workId: z.string().uuid(), executionId: z.string().uuid(), type: z.enum(['stop', 'approve', 'answer', 'commit']) }).passthrough()
const commitSchema = z.object({ requestId: z.string().uuid(), message: z.string().trim().min(1).max(8000), paths: z.array(z.string().min(1).max(4096)).min(1).max(100) }).strict()

/** Owns native executions. The scheduler owns admission; this layer never guesses semantic targets. */
export class SuperAgentWorkers {
  readonly context: SuperAgentContext
  readonly lifecycle: SuperAgentLifecycleStore
  private entries = new Map<string, WorkerEntry>()
  private restored = new Map<string, SuperAgentWorkerSnapshot>()
  private initializing?: Promise<void>
  private launching = new Map<string, Promise<SuperAgentWorkerSnapshot>>()
  private listeners = new Set<(snapshot: SuperAgentWorkerSnapshot) => void>()
  private broker = new SuperAgentWorkerBroker()
  private logs: SuperAgentNativeLogs
  private timer: ReturnType<typeof setInterval>
  private checking = false
  private closing = false
  private cancelled = new Set<string>()
  private continuation?: (workspaceId: string, workId: string) => Promise<void>

  constructor(private readonly store: SuperAgentStore, private readonly environments: SuperAgentEnvironments,
    private readonly directory: string, private readonly launchOptions: () => Promise<WorkerLaunchOptions>,
    private readonly factory: (id: string, publish: (state: ConversationSnapshot) => void) => ManagedWorkerEngine = (id, publish) => new CodexConversation(id, publish),
    intervalMs = 3000, private readonly now = Date.now, lifecycle?: SuperAgentLifecycleStore) {
    this.context = new SuperAgentContext(store, environments)
    this.lifecycle = lifecycle ?? new SuperAgentLifecycleStore(directory)
    environments.setExecutionGuard(async () => (await this.lifecycle.snapshot()).filter(row => !row.stopConfirmed).map(row => row.cwd))
    this.logs = new SuperAgentNativeLogs(join(directory, 'native-logs'))
    this.timer = setInterval(() => { void this.sweep().catch(error => console.error('[superagent] lifecycle supervision failed', error)) }, intervalMs)
    this.timer.unref()
  }

  subscribe(listener: (snapshot: SuperAgentWorkerSnapshot) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  setContinuation(handler: (workspaceId: string, workId: string) => Promise<void>): void { this.continuation = handler }
  initialize(): Promise<void> {
    return this.initializing ??= (async () => {
      for (const row of await this.lifecycle.snapshot()) {
        const detail = await this.store.workDetail(row.workspaceId, row.workId)
        const execution = detail.executions.find(item => item.id === row.executionId)
        if (!execution || execution.instanceId !== row.instanceId || execution.cwd !== row.cwd) throw new Error('Unresolved Worker lifecycle identity; execution is blocked')
        if (row.retiredAt !== undefined) continue
        const state = conversationState(row.instanceId, 'codex')
        state.connection = 'closed'; state.mode = 'conversation'; state.threadId = execution.providerSessionId
        const phase = ['ready', 'stopped', 'failed'].includes(row.phase) && row.stopConfirmed ? row.phase : 'interrupted'
        this.restored.set(row.workId, { ...row, phase, conversation: state, restored: true, disabledExtensions: [],
          report: detail.reports.find(item => item.id === detail.work.latestReportId),
          diagnostic: !row.stopConfirmed ? 'Previous execution stop is unconfirmed. No live control connection was restored; the environment remains occupied. Verify the owned process tree before reusing it.'
            : phase === 'interrupted' ? 'Restored records only. A new explicit input is required to execute.' : row.diagnostic })
      }
    })()
  }
  snapshots(workspaceId: string): SuperAgentWorkerSnapshot[] {
    const rows = new Map(this.restored)
    for (const [id, entry] of this.entries) rows.set(id, entry.snapshot)
    return [...rows.values()].filter(row => row.workspaceId === workspaceId && row.retiredAt === undefined).map(row => structuredClone(row))
  }
  private emit(snapshot: SuperAgentWorkerSnapshot): void {
    for (const listener of this.listeners) { try { listener(structuredClone(snapshot)) } catch { /* an observer cannot change execution */ } }
  }
  private publish(entry: WorkerEntry): void {
    this.emit(entry.snapshot)
    if (!entry.durable || entry.persistenceFailed) return
    const { phase, stopConfirmed, idleSince, retiredAt, diagnostic, recovery } = entry.snapshot
    const patch = { phase, stopConfirmed, idleSince, retiredAt, diagnostic, recovery }, signature = JSON.stringify(patch)
    if (signature === entry.persistedState) return
    entry.persistedState = signature
    void this.lifecycle.update(entry.snapshot.workId, entry.snapshot.executionId, { ...patch, updatedAt: this.now() }).catch(error => {
      entry.persistenceFailed = true
      void this.fail(entry, `Lifecycle state could not be saved; execution stopped. ${String(error)}`)
    })
  }
  private isCurrent(entry: WorkerEntry): boolean { return this.entries.get(entry.snapshot.workId) === entry && !entry.stopping && !this.closing }
  private phase(entry: WorkerEntry): void {
    if (entry.stopping || ['starting', 'failed', 'stopped', 'interrupted'].includes(entry.snapshot.phase)) return
    const state = entry.snapshot.conversation
    entry.snapshot.phase = entry.commit || state.approvals.length || state.questions?.some(question => question.blocking !== false) || state.needsTerminal ? 'waiting'
      : state.turnId ? 'running' : entry.nativeEnded && entry.snapshot.report?.kind === 'ready' && entry.reportVersion === entry.inputVersion ? 'ready' : 'idle'
  }
  private observe(entry: WorkerEntry, state: ConversationSnapshot): void {
    if (this.entries.get(entry.snapshot.workId) !== entry) return
    entry.snapshot.conversation = state
    if ((state.connection === 'disconnected' || (state.connection === 'closed' && entry.snapshot.phase !== 'starting')) && !entry.stopping) { void this.fail(entry, state.error ?? 'Codex control connection closed'); return }
    this.phase(entry); this.publish(entry)
  }

  start(workspaceId: string, workId: string): Promise<SuperAgentWorkerSnapshot> {
    identity.parse(workspaceId); z.string().uuid().parse(workId)
    if (this.closing) return Promise.reject(new Error('SuperAgent is shutting down'))
    const old = this.launching.get(workId)
    if (old) return old
    this.cancelled.delete(workId)
    const promise = this.startWork(workspaceId, workId).finally(() => this.launching.delete(workId))
    this.launching.set(workId, promise)
    return promise
  }

  private async startWork(workspaceId: string, workId: string): Promise<SuperAgentWorkerSnapshot> {
    await this.initialize()
    const recovered = this.restored.get(workId)
    if (recovered && !recovered.stopConfirmed) throw new Error(recovered.diagnostic)
    const old = this.entries.get(workId)
    if (old && old.snapshot.workspaceId !== workspaceId) throw new Error('Work belongs to another workspace')
    if (old && !old.snapshot.stopConfirmed && !['stopped', 'failed'].includes(old.snapshot.phase)) return structuredClone(old.snapshot)
    if (old && !old.snapshot.stopConfirmed) throw new Error('Stop the previous execution before explicitly continuing')
    const detail = await this.store.workDetail(workspaceId, workId)
    const pending = detail.deliveries.filter(row => row.status === 'pending')
    if (!pending.length) throw new Error('There is no new explicit input to execute; history is never replayed')
    if (this.cancelled.has(workId)) throw new Error('Worker launch was stopped')
    const lease = await this.environments.acquire(workspaceId, workId)
    let entry: WorkerEntry | undefined
    try {
      if (this.closing || this.cancelled.has(workId)) throw new Error('Worker launch was stopped')
      const executionId = randomUUID(), instanceId = randomUUID()
      await this.store.recordExecution(workspaceId, { executionId, instanceId, workId, cwd: lease.checkout.path, expectedRevision: detail.work.revision })
      const source = detail.inputs.find(input => input.id === detail.work.sourceInputId)!
      const engine = this.factory(instanceId, state => { if (entry) this.observe(entry, state) })
      entry = { engine, lease, reads: new ContextReadEvidence(), contextOutputBytes: 0, inputQueue: new SerialQueue(), dispatchQueue: new SerialQueue(), events: new SerialQueue(), commitQueue: new SerialQueue(), stopping: false, cancelContinuation: false, nativeEnded: false, inputVersion: 0,
        snapshot: { workspaceId, conversationId: source.conversationId, workId, executionId, instanceId, phase: 'starting', conversation: engine.snapshot(), disabledExtensions: [], stopConfirmed: false } }
      this.entries.set(workId, entry); this.publish(entry)
      await this.lifecycle.begin({ workspaceId, workId, executionId, instanceId, conversationId: source.conversationId,
        cwd: lease.checkout.path, phase: 'starting', stopConfirmed: false, updatedAt: this.now() })
      entry.durable = true; this.restored.delete(workId)
      if (this.closing || this.cancelled.has(workId)) throw new Error('Worker launch was stopped')
      const current = entry
      const grant = await this.broker.issue((tool, args) => this.tool(current, tool, args))
      entry.revoke = grant.revoke
      const options = await this.launchOptions()
      await this.environments.validateLease(lease.id)
      if (!this.isCurrent(entry)) throw new Error('Worker launch was stopped')
      const previous = [...detail.executions].reverse().find(row => row.providerSessionId)?.providerSessionId ?? undefined
      if (previous) entry.snapshot.recovery = 'resumed'
      await engine.startManaged({ command: options.command, cwd: lease.checkout.path, env: options.env,
        args: [...workerPermissions(lease).configOverrides, ...WORKER_RESTRICTIONS].flatMap(value => ['-c', value]), threadId: previous,
        configure: config => {
          if (!this.isCurrent(current)) throw new Error('Worker launch was stopped')
          const launch = workerLaunch(lease, config, { command: options.mcpCommand, entry: options.mcpEntry, ...grant })
          current.contextOutputBytes = launch.contextOutputBytes
          current.snapshot.disabledExtensions = launch.disabledExtensions
          return launch.params
        }, onEvent: event => this.event(current, event),
        onMissingThread: async () => {
          if (!this.isCurrent(current)) throw new Error('Worker launch was stopped')
          const material = await this.store.workDetail(workspaceId, workId)
          const latest = material.reports.find(row => row.id === material.work.latestReportId) ?? material.reports.at(-1)
          for (const resourceId of new Set([...material.inputs.map(row => row.resourceId), ...(latest ? [latest.resourceId] : [])])) {
            const page = await this.context.read(workspaceId, { resourceId }, 0, workId)
            if (page.status !== 'available' && page.status !== 'context-pressure') throw new Error(`Cannot reconstruct missing native history: required original ${resourceId} is unavailable. Ask for the missing background.`)
          }
          await this.environments.validateLease(lease.id)
          if (!this.isCurrent(current)) throw new Error('Worker launch was stopped')
          current.snapshot.recovery = 'rebuilt'
          current.snapshot.diagnostic = 'Native history is unavailable; rebuilding from saved requirements, reports and the current checkout.'
          await this.lifecycle.update(workId, executionId, { recovery: 'rebuilt', diagnostic: current.snapshot.diagnostic, updatedAt: this.now() })
        },
      })
      if (!this.isCurrent(entry)) throw new Error('Worker launch was stopped')
      const threadId = engine.snapshot().threadId
      if (!threadId) throw new Error('Codex did not return a native thread')
      await this.store.bindExecution(workspaceId, executionId, { providerSessionId: threadId })
      entry.mcpExpectedAt = this.now()
      const status = await engine.managedCall('mcpServerStatus/list', { serverName: WORKER_MCP_NAME, detail: 'toolsAndAuthOnly' })
      const server = Array.isArray(status.data) ? status.data.find(row => row.name === WORKER_MCP_NAME) : undefined
      if (!server?.tools?.report_work) throw new Error('Codex did not discover the managed report_work tool')
      entry.snapshot.phase = 'idle'; entry.snapshot.conversation = engine.snapshot()
      await this.deliver(entry)
      this.phase(entry); this.publish(entry)
      return structuredClone(entry.snapshot)
    } catch (error) {
      if (entry) await this.fail(entry, String(error))
      else await this.environments.release(lease.id)
      throw error
    }
  }

  async append(value: SuperAgentAppendInput): Promise<SuperAgentWorkerSnapshot> {
    const { workId, executionId, ...inputValue } = value
    const input = submitInputSchema.parse(inputValue)
    const entry = this.current(input.workspaceId, workId, executionId)
    if (!this.isCurrent(entry)) throw new Error('Worker is no longer accepting input')
    const detail = await this.store.workDetail(input.workspaceId, workId)
    const receipt = await this.store.receiveInput({ workspaceId: input.workspaceId, workspacePath: detail.work.workspacePath }, input)
    const delivery = await this.store.routeInput(input.workspaceId, receipt.input.id, workId)
    if (delivery.status !== 'pending') return structuredClone(entry.snapshot)
    entry.snapshot.idleSince = undefined
    entry.inputVersion++; this.phase(entry); this.publish(entry)
    await this.dispatchPending(entry)
    return structuredClone(this.entries.get(workId)!.snapshot)
  }

  private dispatchPending(entry: WorkerEntry): Promise<void> {
    return entry.dispatchQueue.run(async () => {
      if (!this.isCurrent(entry) || entry.snapshot.phase === 'starting') return
      const state = entry.engine.snapshot()
      if (entry.commit || state.approvals.length || state.questions?.some(row => row.blocking !== false) || state.needsTerminal) return
      const detail = await this.store.workDetail(entry.snapshot.workspaceId, entry.snapshot.workId)
      if (!detail.deliveries.some(row => row.status === 'pending') || !this.isCurrent(entry)) return
      if (!state.turnId && detail.executions.find(row => row.id === entry.snapshot.executionId)?.nativeTurnId) {
        // Only a saved explicit supplement may continue a completed turn. A user stop cancels this handoff.
        await this.stopEntry(entry)
        if (!entry.cancelContinuation && !this.closing) {
          if (this.continuation) await this.continuation(entry.snapshot.workspaceId, entry.snapshot.workId)
          else await this.start(entry.snapshot.workspaceId, entry.snapshot.workId)
        }
      } else await this.deliver(entry)
    })
  }

  private deliver(entry: WorkerEntry): Promise<void> {
    return entry.inputQueue.run(async () => {
      if (!this.isCurrent(entry) || entry.snapshot.phase === 'starting') return
      const native = entry.engine.snapshot()
      if (entry.commit || native.approvals.length || native.questions?.some(row => row.blocking !== false) || native.needsTerminal) return
      await this.environments.validateLease(entry.lease.id)
      const detail = await this.store.workDetail(entry.snapshot.workspaceId, entry.snapshot.workId)
      const deliveries = detail.deliveries.filter(row => row.status === 'pending').sort((a, b) => detail.inputs.find(row => row.id === a.inputId)!.sequence - detail.inputs.find(row => row.id === b.inputId)!.sequence)
      if (!deliveries.length || !this.isCurrent(entry)) return
      const card = await this.context.card(entry.snapshot.workspaceId, detail.work.id)
      const assignment = `Assigned work: ${detail.work.title}\nGoal: ${fitText(card.intent.goal.text, 1200)}\nWork id: ${detail.work.id}\nOnly implement this assigned scope; shared user input may mention other works.\nRead truncated requirements with read_resource before acting. Use read_work to page all inputs, reports and constraints. Historical reports are not current code: verify this checkout's branch, HEAD and files.\n${entry.snapshot.recovery === 'rebuilt' ? 'The original native history is missing. Reconstruct the work from read_work and its required original resources before dependent edits; ask if critical context is insufficient.\n' : ''}`
      const background = JSON.stringify({ intent: card.intent, checkout: card.checkout, report: card.report,
        inputCount: card.inputCount, inputsPage: card.inputsPage, inputs: card.inputs.map(({ original: _original, ...row }) => row) })
      const context = estimateContextTokens(background) < INLINE_CONTEXT_TOKENS / 2 ? background
        : JSON.stringify({ workId: detail.work.id, contextTruncated: true, recovery: 'Call read_work before implementation for constraints, uncovered inputs and reports.' })
      let remaining = Math.max(0, INLINE_CONTEXT_TOKENS - estimateContextTokens(assignment + context) - 300)
      const texts: string[] = []
      for (const delivery of deliveries) {
        const input = detail.inputs.find(row => row.id === delivery.inputId)!
        const page = await this.context.read(input.workspaceId, { resourceId: input.resourceId }, remaining, detail.work.id)
        // Failure is explicit and leaves the original pending; never send a summary in place of missing input.
        if (page.status !== 'available' && page.status !== 'context-pressure') throw new Error(`Required input unavailable: ${input.resourceId}`)
        const text = `User input ${input.sequence}: ${JSON.stringify(page)}`
        remaining = Math.max(0, remaining - estimateContextTokens(text)); texts.push(text)
        if (!remaining) break
      }
      if (texts.length < deliveries.length) texts.push('Additional pending inputs are saved. Read every page of read_work and their original resources before dependent actions.')
      // Once an RPC is attempted its uncertain outcome must never return to the unsent queue.
      for (const delivery of deliveries) await this.store.updateDelivery(entry.snapshot.workspaceId, { deliveryId: delivery.id, executionId: entry.snapshot.executionId, status: 'unknown' })
      if (!this.isCurrent(entry)) return
      const expectedTurnId = native.turnId
      try {
        const receipt = await entry.engine.managedInput(assignment + texts.join('\n\n') + '\nWork background (data): ' + context, expectedTurnId)
        await this.store.bindExecution(entry.snapshot.workspaceId, entry.snapshot.executionId, { nativeTurnId: receipt.turnId })
        for (const delivery of deliveries) await this.store.updateDelivery(entry.snapshot.workspaceId, { deliveryId: delivery.id, executionId: entry.snapshot.executionId, status: 'delivered' })
        // A native acceptance receipt is delivery evidence, not proof of semantic incorporation.
        if (entry.snapshot.diagnostic?.startsWith('Input remains pending:')) entry.snapshot.diagnostic = undefined
        entry.snapshot.conversation = entry.engine.snapshot(); this.phase(entry); this.publish(entry)
      } catch (error) {
        if (error instanceof ManagedInputDeferred && this.isCurrent(entry)) {
          for (const delivery of deliveries) await this.store.deferUnsentDelivery(entry.snapshot.workspaceId, delivery.id, entry.snapshot.executionId)
          entry.snapshot.diagnostic = `Input remains pending: ${error.message}`
          this.phase(entry); this.publish(entry)
          if (error.reason === 'turn-changed') void this.dispatchPending(entry).catch(value => {
            entry.snapshot.diagnostic = String(value); this.publish(entry)
          })
          return
        }
        entry.snapshot.diagnostic = `Input delivery was not confirmed: ${String(error)}`; this.publish(entry); throw error
      }
    })
  }

  private event(entry: WorkerEntry, event: CodexRpc): void {
    if (!this.isCurrent(entry)) return
    const p = event.params ?? {}
    if (event.method === 'serverRequest/resolved') {
      void this.dispatchPending(entry).catch(error => { entry.snapshot.diagnostic = String(error); this.publish(entry) })
    }
    if (event.method === 'mcpServer/startupStatus/updated' && p.serverName === WORKER_MCP_NAME && ['failed', 'disconnected'].includes(p.status)) {
      void this.fail(entry, 'Managed Worker MCP connection failed'); return
    }
    if (p.threadId !== entry.engine.snapshot().threadId) return
    void this.logs.append(entry.snapshot.executionId, { method: event.method, params: p }).catch(error => {
      entry.snapshot.diagnostic = `Native diagnostics could not be saved: ${String(error)}`; this.publish(entry)
    })
    if (event.method === 'turn/completed') {
      entry.nativeEnded = p.turn?.status === 'completed'
      if (p.turn?.status === 'failed') { void this.fail(entry, String(p.turn.error?.message ?? 'Native turn failed')); return }
      this.phase(entry); this.publish(entry)
      void this.dispatchPending(entry).catch(error => { entry.snapshot.diagnostic = String(error); this.publish(entry) })
    }
    if (event.method === 'turn/started' && p.turn?.id) {
      void entry.events.run(() => this.store.bindExecution(entry.snapshot.workspaceId, entry.snapshot.executionId, { nativeTurnId: p.turn.id })).catch(error => { void this.fail(entry, String(error)) })
    }
  }

  private async tool(entry: WorkerEntry, name: string, value: unknown): Promise<unknown> {
    if (!this.isCurrent(entry)) throw new Error('Execution capability is no longer active')
    if (name === '__heartbeat') { z.object({}).strict().parse(value); entry.heartbeatAt = this.now(); return { received: true } }
    const { workspaceId, workId, executionId } = entry.snapshot
    await this.environments.validateLease(entry.lease.id)
    if (!this.isCurrent(entry)) throw new Error('Execution changed before the tool ran')
    if (name === 'report_work') {
      const input = recordReportSchema.omit({ executionId: true }).parse(value)
      return entry.events.run(() => entry.inputQueue.run(async () => {
        if (!this.isCurrent(entry)) throw new Error('Worker stopped before the report was saved')
        const version = entry.inputVersion
        const detail = await this.store.workDetail(workspaceId, workId)
        const duplicate = detail.reports.some(row => row.id === input.reportId)
        const report = await this.store.recordReport(workspaceId, { ...input, executionId })
        if (!duplicate && this.isCurrent(entry)) {
          entry.snapshot.report = report
          entry.reportVersion = detail.deliveries.some(row => row.status === 'pending' || (row.executionId === executionId && row.status === 'unknown')) ? undefined : version
          this.phase(entry); this.publish(entry)
        }
        return { reportId: report.id, saved: true, kind: report.kind }
      }))
    }
    if (name === 'read_work') {
      const card = await this.context.card(workspaceId, workId, cardQuerySchema.parse(value), entry.contextOutputBytes / 4)
      return mcpOutputBytes(card) <= entry.contextOutputBytes ? card : { status: 'context-pressure', workId, source: card.source,
        diagnostic: 'Native tool output setting cannot fit the work card. Read the original resource or report the missing background; do not infer truncated constraints.' }
    }
    if (name === 'read_resource') {
      const args = resourceQuerySchema.parse(value), page = await this.context.read(workspaceId, args, Infinity, workId, entry.contextOutputBytes - 512)
      return page.status === 'available' ? entry.reads.repeated(page, args.reread) ?? page : page
    }
    if (name === 'commit_work') return this.requestCommit(entry, value)
    throw new Error('Unsupported Worker tool')
  }

  private async requestCommit(entry: WorkerEntry, value: unknown): Promise<unknown> {
    const input = commitSchema.parse(value)
    const result = await entry.commitQueue.run(async () => {
    if (!this.isCurrent(entry)) throw new Error('Worker stopped before commit review')
    if (entry.snapshot.commitRequest?.id === input.requestId) {
      if (entry.snapshot.commitRequest.message !== input.message || JSON.stringify(entry.snapshot.commitRequest.paths) !== JSON.stringify(input.paths)) throw new Error('Commit request identity was reused')
      return { response: entry.commit?.promise ?? entry.snapshot.commitRequest }
    }
    if (entry.commit) throw new Error('A commit request is already pending')
    try {
      const saved = JSON.parse(await readFile(join(this.directory, 'commits', `${input.requestId}.json`), 'utf8'))
      if (saved.version !== 1 || saved.workspaceId !== entry.snapshot.workspaceId || saved.workId !== entry.snapshot.workId || saved.executionId !== entry.snapshot.executionId
        || saved.message !== input.message || JSON.stringify(saved.paths) !== JSON.stringify(input.paths)) throw new Error('Commit request identity was reused')
      if (['pending', 'executing'].includes(saved.status)) throw new Error('Previous commit outcome is unconfirmed; it will not be replayed')
      return { response: saved }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const lease = await this.environments.validateLease(entry.lease.id)
    const plan = await prepareControlledCommit(lease.checkout, input.paths)
    const changes = await previewControlledCommit(lease.checkout, plan)
    if (!this.isCurrent(entry)) throw new Error('Worker stopped before commit review')
    entry.snapshot.commitRequest = { id: input.requestId, message: input.message, paths: input.paths, head: plan.head, changes, status: 'pending' }
    await this.saveCommit(entry)
    let resolve!: (result: unknown) => void, reject!: (error: Error) => void
    const promise = new Promise((yes, no) => { resolve = yes; reject = no })
    void promise.catch(() => undefined)
    const timer = setTimeout(() => { void this.decideCommit(entry, input.requestId, false).catch(() => undefined) }, 14 * 60 * 1000)
    entry.commit = { plan, promise, resolve, reject, timer, expiresAt: Date.now() + 14 * 60 * 1000 }
    this.phase(entry); this.publish(entry)
    return { response: promise }
    })
    return result.response
  }
  private saveCommit(entry: WorkerEntry): Promise<void> {
    return writeRecordAtomic(join(this.directory, 'commits', `${entry.snapshot.commitRequest!.id}.json`), JSON.stringify({ version: 1,
      workspaceId: entry.snapshot.workspaceId, workId: entry.snapshot.workId, executionId: entry.snapshot.executionId, ...entry.snapshot.commitRequest }))
  }
  private decideCommit(entry: WorkerEntry, requestId: string, approved: boolean): Promise<void> {
    return entry.commitQueue.run(async () => {
    const request = entry.snapshot.commitRequest, pending = entry.commit
    if (!request || request.id !== requestId) throw new Error('Commit request is no longer current')
    if (request.status !== 'pending') return
    if (!pending) throw new Error('Commit review expired with its execution')
    clearTimeout(pending.timer)
    try {
      if (!approved || Date.now() >= pending.expiresAt) { request.status = 'declined'; await this.saveCommit(entry); pending.resolve({ ...request }); return }
      if (!this.isCurrent(entry)) throw new Error('Worker stopped before commit approval')
      request.status = 'executing'; await this.saveCommit(entry); this.publish(entry)
      request.commit = await this.environments.commit(entry.lease.id, request.head, checkout => {
        if (!this.isCurrent(entry)) throw new Error('Worker stopped before Git mutation')
        return executeControlledCommit(checkout, pending.plan, request.message, join(this.directory, 'commit-indexes'))
      })
      request.status = 'succeeded'; await this.saveCommit(entry); pending.resolve({ ...request })
    } catch (error) {
      request.status = request.status === 'executing' ? 'unknown' : 'stale'; request.error = String(error)
      await this.saveCommit(entry).catch(() => undefined)
      pending.reject(new Error(`Commit did not finish with a confirmed result; it will not be retried. ${String(error)}`))
      throw error
    } finally { entry.commit = undefined; this.phase(entry); this.publish(entry) }
    })
  }

  private current(workspaceId: string, workId: string, executionId: string): WorkerEntry {
    const entry = this.entries.get(workId)
    if (!entry || entry.snapshot.workspaceId !== workspaceId || entry.snapshot.executionId !== executionId) throw new Error('Worker execution changed; refresh before controlling it')
    return entry
  }
  async control(value: SuperAgentWorkerControl): Promise<SuperAgentWorkerSnapshot> {
    controlSchema.parse(value)
    const entry = this.current(value.workspaceId, value.workId, value.executionId)
    if (value.type === 'stop') { entry.cancelContinuation = true; if (entry.stopFailed) entry.stopped = undefined; await this.stopEntry(entry); return structuredClone(entry.snapshot) }
    if (!this.isCurrent(entry)) throw new Error('Worker is no longer active')
    await this.environments.validateLease(entry.lease.id)
    if (value.type === 'commit') { if (typeof value.approved !== 'boolean') throw new Error('Invalid commit decision'); await this.decideCommit(entry, value.requestId, value.approved) }
    else {
      const controlEpoch = entry.engine.snapshot().controlEpoch
      if (value.type === 'approve') await entry.engine.command({ type: 'approve', requestId: value.requestId, decision: value.decision, controlEpoch })
      else await entry.engine.command({ type: 'answer', requestId: value.requestId, version: value.version, answer: value.answer, controlEpoch })
    }
    await this.dispatchPending(entry)
    return structuredClone(entry.snapshot)
  }

  private stopEntry(entry: WorkerEntry, failed = false): Promise<void> {
    if (entry.stopped) return entry.stopped
    entry.stopping = true; entry.revoke?.()
    entry.snapshot.phase = 'stopping'; this.publish(entry)
    entry.stopped = (async () => {
      // Request a native interrupt immediately, then confirm owned process-tree termination.
      const state = entry.engine.snapshot()
      if (state.turnId && state.connection === 'ready') void entry.engine.command({ type: 'interrupt', controlEpoch: state.controlEpoch }).catch(() => undefined)
      await entry.engine.dispose()
      // An already approved host commit must settle before the environment can be reused.
      await entry.commitQueue.run(async () => {
        if (entry.commit) {
          clearTimeout(entry.commit.timer)
          entry.commit.reject(new Error('Worker stopped before the commit decision'))
          if (entry.snapshot.commitRequest?.status === 'pending') { entry.snapshot.commitRequest.status = 'declined'; await this.saveCommit(entry) }
          entry.commit = undefined
        }
      })
      await entry.inputQueue.run(async () => {})
      await entry.events.run(async () => {})
      // Persist the confirmation before releasing either the in-memory or recovered environment guard.
      await this.lifecycle.update(entry.snapshot.workId, entry.snapshot.executionId, { stopConfirmed: true, phase: failed ? 'failed' : 'stopped', idleSince: undefined, updatedAt: this.now() })
      await this.environments.release(entry.lease.id)
      entry.snapshot.stopConfirmed = true
      entry.snapshot.conversation = entry.engine.snapshot()
      entry.snapshot.phase = failed ? 'failed' : 'stopped'; entry.snapshot.idleSince = undefined; entry.stopFailed = false; this.publish(entry)
    })().catch(error => {
      entry.stopFailed = true
      entry.snapshot.phase = 'failed'; entry.snapshot.diagnostic = `Stop could not be confirmed; the environment remains occupied. ${String(error)}`
      this.publish(entry); throw error
    })
    return entry.stopped
  }
  /** Cancels even a launch which has not published its first snapshot yet. */
  async stopWork(workspaceId: string, workId: string): Promise<void> {
    this.cancelled.add(workId)
    await this.initialize()
    const recovered = this.restored.get(workId)
    if (recovered && recovered.workspaceId !== workspaceId) throw new Error('Work belongs to another workspace')
    if (recovered && !recovered.stopConfirmed) throw new Error(recovered.diagnostic)
    if (recovered) {
      recovered.phase = 'stopped'; recovered.idleSince = undefined
      await this.lifecycle.update(workId, recovered.executionId, { phase: 'stopped', idleSince: undefined, updatedAt: this.now() }); this.emit(recovered)
    }
    const current = this.entries.get(workId)
    if (current && current.snapshot.workspaceId !== workspaceId) throw new Error('Work belongs to another workspace')
    if (current) {
      current.cancelContinuation = true; if (current.stopFailed) current.stopped = undefined
      await this.stopEntry(current)
      current.snapshot.phase = 'stopped'; current.snapshot.idleSince = undefined; this.publish(current)
    }
    await this.launching.get(workId)?.catch(() => undefined)
    const late = this.entries.get(workId)
    if (late && late !== current) { late.cancelContinuation = true; await this.stopEntry(late) }
  }
  /** Finish the execution process tree before returning its capacity; keep the ready card/history. */
  async settleReady(workspaceId: string, workId: string, executionId: string): Promise<void> {
    const entry = this.current(workspaceId, workId, executionId)
    if (entry.snapshot.phase !== 'ready') return
    await this.stopEntry(entry)
    const detail = await this.store.workDetail(workspaceId, workId)
    if (entry.cancelContinuation || detail.work.closedAt !== null || detail.deliveries.some(row => row.status === 'pending' || row.status === 'unknown')) return
    entry.snapshot.phase = 'ready'; entry.snapshot.idleSince = this.now()
    await this.lifecycle.update(workId, executionId, { phase: 'ready', idleSince: entry.snapshot.idleSince, updatedAt: this.now() })
    this.publish(entry)
  }
  private async fail(entry: WorkerEntry, message: string): Promise<void> {
    entry.cancelContinuation = true
    entry.snapshot.diagnostic = message
    await this.stopEntry(entry, true).catch(() => undefined)
  }
  async noteInput(workspaceId: string, workId: string): Promise<void> {
    await this.initialize()
    const entry = this.entries.get(workId), state = entry?.snapshot ?? this.restored.get(workId)
    if (!state || state.workspaceId !== workspaceId) return
    state.idleSince = undefined; state.retiredAt = undefined
    await this.lifecycle.update(workId, state.executionId, { idleSince: undefined, retiredAt: undefined, updatedAt: this.now() })
    if (entry) this.publish(entry); else this.emit(state)
  }
  /** Explicit clock seam; observation never launches work or resets idle time. */
  async sweep(): Promise<void> {
    if (this.checking || this.closing) return
    this.checking = true
    try {
      await this.initialize()
      await Promise.all([...this.entries.values()].filter(entry => this.isCurrent(entry)).map(async entry => {
        try {
          await this.environments.validateLease(entry.lease.id)
          const last = entry.heartbeatAt ?? entry.mcpExpectedAt
          if (last !== undefined && this.now() - last > 20_000) throw new Error('Worker MCP connection is no longer responding')
        } catch (error) { await this.fail(entry, String(error)) }
      }))
      const states = [...this.restored.values(), ...[...this.entries.values()].map(entry => entry.snapshot)]
      for (const state of states) {
        if (state.phase !== 'ready' || !state.stopConfirmed || state.idleSince === undefined || this.now() - state.idleSince < WORKER_IDLE_MS || this.launching.has(state.workId)) continue
        const detail = await this.store.workDetail(state.workspaceId, state.workId)
        if (detail.work.closedAt !== null || detail.deliveries.some(row => row.status === 'pending' || row.status === 'unknown')) continue
        const entry = this.entries.get(state.workId)
        if (entry && (entry.snapshot !== state || entry.commit || state.conversation.turnId || state.conversation.approvals.length || state.conversation.questions?.some(row => row.status === 'pending'))) continue
        const retiredAt = this.now(), idleSince = state.idleSince
        if (state.phase !== 'ready' || !state.stopConfirmed || idleSince === undefined) continue
        if (!await this.lifecycle.update(state.workId, state.executionId, { retiredAt, updatedAt: retiredAt }, idleSince)) continue
        if (state.idleSince !== idleSince || state.phase !== 'ready' || this.launching.has(state.workId)) continue
        if (this.entries.get(state.workId) === entry && entry?.snapshot === state) this.entries.delete(state.workId)
        if (this.restored.get(state.workId) === state) this.restored.delete(state.workId)
        state.retiredAt = retiredAt; this.emit(state)
      }
    } finally { this.checking = false }
  }
  async readLog(workspaceId: string, executionId: string) {
    const snapshot = await this.store.snapshot(identity.parse(workspaceId))
    if (!snapshot.executions.some(row => row.id === executionId)) throw new Error('Execution does not belong to this workspace')
    return this.logs.read(executionId)
  }
  async close(): Promise<void> {
    this.closing = true; clearInterval(this.timer)
    const stop = async (entry: WorkerEntry) => {
      const ready = entry.snapshot.phase === 'ready' && entry.snapshot.stopConfirmed, idleSince = entry.snapshot.idleSince
      await this.stopEntry(entry)
      if (ready) { entry.snapshot.phase = 'ready'; entry.snapshot.idleSince = idleSince }
      else { entry.snapshot.phase = 'interrupted'; entry.snapshot.idleSince = undefined }
      this.publish(entry)
    }
    const results = await Promise.allSettled([...this.entries.values()].map(stop))
    await Promise.allSettled(this.launching.values())
    const lateResults = await Promise.allSettled([...this.entries.values()].filter(entry => !entry.snapshot.stopConfirmed).map(stop))
    await this.broker.close(); await this.logs.close(); await this.lifecycle.close()
    if ([...results, ...lateResults].some(result => result.status === 'rejected')) throw new Error('Some managed workers did not confirm exit')
  }
}
