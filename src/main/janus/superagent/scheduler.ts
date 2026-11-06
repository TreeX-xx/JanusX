import type { SuperAgentScheduleEntry, SuperAgentScheduleSnapshot } from '../../../shared/superagent-scheduling'
import type { SuperAgentWorkerSnapshot } from '../../../shared/superagent-worker'
import { SerialQueue } from '../../lib/atomic-file'
import { SuperAgentStore } from './store'
import { SuperAgentWorkers } from './workers'
import { capacitySchema, SuperAgentSchedulingStore } from './scheduling-store'

/** Global capacity is independent of work count, workspace count and resident result cards.
 * Note: .agents/notes/agent/superagent-scheduling.md */
export class SuperAgentScheduler {
  readonly ledger: SuperAgentSchedulingStore
  private queue = new SerialQueue()
  private occupied = new Map<string, { previousExecutionId?: string }>()
  private settling = new Set<string>()
  private cancelled = new Set<string>()
  private listeners = new Set<(workspaceId: string) => void>()
  private unsubscribe: () => void
  private closing = false
  private fault?: string
  private initializing?: Promise<void>
  private restoredCutoff = new Map<string, number>()

  constructor(private readonly store: SuperAgentStore, private readonly workers: SuperAgentWorkers, ledger?: SuperAgentSchedulingStore) {
    this.ledger = ledger ?? new SuperAgentSchedulingStore(store.directory)
    this.unsubscribe = workers.subscribe(snapshot => {
      void this.queue.run(() => this.observe(snapshot)).catch(error => this.failedPersistence(error))
    })
    workers.setContinuation(async (workspaceId, workId) => {
      const detail = await store.workDetail(workspaceId, workId)
      const pending = detail.deliveries.filter(row => row.status === 'pending').at(-1)
      if (pending && detail.work.closedAt === null) await this.request(workspaceId, workId, pending.inputId)
    })
  }
  subscribe(listener: (workspaceId: string) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private publish(workspaceId: string): void {
    for (const listener of this.listeners) { try { listener(workspaceId) } catch { /* observers do not own admission */ } }
  }
  private failedPersistence(error: unknown): void {
    if (this.closing) return
    this.fault = `Scheduling stopped after an unconfirmed operation: ${String(error)}`
    console.error('[superagent]', this.fault)
  }
  private available(): void {
    if (this.closing) throw new Error('SuperAgent is shutting down')
    if (this.fault) throw new Error(this.fault)
  }
  initialize(): Promise<void> {
    return this.initializing ??= (async () => {
      await this.workers.initialize?.()
      const data = await this.ledger.snapshot()
      for (const scope of new Set([...data.entries.map(row => row.workspaceId), ...await this.store.workspaceIds()])) {
        const records = await this.store.snapshot(scope)
        this.restoredCutoff.set(scope, records.inputs.at(-1)?.sequence ?? 0)
        for (const state of this.workers.snapshots(scope)) if (state.restored && !state.stopConfirmed) this.occupied.set(state.workId, {})
      }
    })()
  }
  async snapshot(workspaceId: string): Promise<SuperAgentScheduleSnapshot> {
    await this.initialize()
    const data = await this.ledger.snapshot()
    return { workspaceId, revision: data.revision, maxConcurrentWorkers: data.maxConcurrentWorkers,
      occupied: this.occupied.size, entries: data.entries.filter(row => row.workspaceId === workspaceId), diagnostic: this.fault }
  }
  async configure(value: unknown): Promise<number> {
    const capacity = capacitySchema.parse(value)
    return this.queue.run(async () => {
      await this.initialize()
      this.available()
      if (capacity < this.occupied.size) throw new Error(`Stop or finish active executions before reducing capacity below ${this.occupied.size}`)
      await this.ledger.change(data => { data.maxConcurrentWorkers = capacity })
      const data = await this.ledger.snapshot()
      for (const workspaceId of new Set(data.entries.map(row => row.workspaceId))) this.publish(workspaceId)
      await this.drain()
      return capacity
    })
  }
  async checkInput(workspaceId: string, workId: string, sequence: number): Promise<void> {
    await this.initialize()
    const previous = (await this.ledger.snapshot()).entries.find(row => row.workId === workId)
    const native = this.workers.snapshots(workspaceId).find(row => row.workId === workId)
    if ((previous?.status === 'interrupted' || native?.restored) && sequence <= (this.restoredCutoff.get(workspaceId) ?? 0)) throw new Error('Restored input cannot restart execution; provide a new explicit input')
    if (native?.restored && !native.stopConfirmed) throw new Error(native.diagnostic ?? 'Previous execution stop is unconfirmed')
  }
  request(workspaceId: string, workId: string, inputId: string, operationId?: string): Promise<SuperAgentScheduleEntry> {
    return this.queue.run(async () => {
      await this.initialize()
      this.available()
      const detail = await this.store.workDetail(workspaceId, workId)
      if (detail.work.closedAt !== null) throw new Error('Work is closed; explicitly reopen it before continuing')
      const input = detail.inputs.find(row => row.id === inputId)
      const delivery = detail.deliveries.find(row => row.inputId === inputId && row.workId === workId)
      if (!input || !delivery) throw new Error('Input is not bound to this work')
      const data = await this.ledger.snapshot(), previous = data.entries.find(row => row.workId === workId)
      const native = this.workers.snapshots(workspaceId).find(row => row.workId === workId)
      await this.checkInput(workspaceId, workId, input.sequence)
      if (delivery.status !== 'pending') {
        if (!previous) throw new Error('Input is no longer pending; it will not be replayed')
        return previous
      }
      this.cancelled.delete(workId)
      await this.workers.noteInput?.(workspaceId, workId)
      const live = native && this.occupied.has(workId) && !native.stopConfirmed
        && !['stopping', 'stopped', 'failed'].includes(native.phase) && !this.settling.has(workId)
      const entry: SuperAgentScheduleEntry = { workspaceId, workId, inputId, conversationId: input.conversationId,
        expectedRevision: detail.work.revision, order: previous && (previous.status === 'queued' || this.occupied.has(workId)) ? previous.order : input.sequence,
        status: operationId ? 'awaiting-approval' : live ? native.phase : 'queued', operationId,
        executionId: live ? native.executionId : undefined, updatedAt: Date.now() }
      await this.ledger.change(draft => {
        const index = draft.entries.findIndex(row => row.workId === workId)
        if (index < 0) draft.entries.push(entry); else draft.entries[index] = entry
      })
      this.publish(workspaceId)
      if (live) {
        // Supplemental input does not wait behind new work or request another slot.
        const resource = await this.store.readResource(workspaceId, input.resourceId)
        void this.workers.append({ workspaceId, workId, executionId: native.executionId,
          conversationId: input.conversationId, eventId: input.eventId, text: resource.text }).catch(error => {
          void this.queue.run(() => this.diagnostic(workspaceId, workId, String(error))).catch(value => this.failedPersistence(value))
        })
      } else {
        // Continuing an idle native thread replaces its finished process inside the same work's turn in the queue.
        if (native?.stopConfirmed && !this.settling.has(workId)) this.occupied.delete(workId)
        await this.drain()
      }
      return (await this.ledger.snapshot()).entries.find(row => row.workId === workId)!
    })
  }
  private async diagnostic(workspaceId: string, workId: string, message: string): Promise<void> {
    if (this.closing) return
    await this.ledger.change(data => { const row = data.entries.find(entry => entry.workId === workId); if (row) row.diagnostic = message })
    this.publish(workspaceId)
  }
  /** The caller already cancelled durable pending inputs/closed the work. Never wait for native shutdown here. */
  cancel(workspaceId: string, workId: string, closed: boolean): Promise<void> {
    return this.cancelMany([{ workspaceId, workId, closed }])
  }
  /** Freeze the entire selected set before saving controls, so freeing one slot cannot launch another target. */
  cancelMany(targets: Array<{ workspaceId: string; workId: string; closed: boolean }>, saveControls: () => Promise<void> = async () => {}): Promise<void> {
    return this.queue.run(async () => {
      await this.initialize()
      if (this.closing) throw new Error('SuperAgent is shutting down')
      for (const row of targets) this.cancelled.add(row.workId)
      let failure: unknown
      try {
        await saveControls()
        await this.ledger.change(data => {
          for (const target of targets) {
            const row = data.entries.find(entry => entry.workId === target.workId && entry.workspaceId === target.workspaceId)
            if (row) { row.status = target.closed ? 'closed' : this.occupied.has(target.workId) ? 'stopping' : 'stopped'; row.updatedAt = Date.now(); row.operationId = undefined }
          }
        })
      } catch (error) { failure = error; this.failedPersistence(error) }
      for (const { workspaceId, workId, closed } of targets) {
        const reservation = this.occupied.get(workId)
        this.publish(workspaceId)
        void this.workers.stopWork(workspaceId, workId).then(() => this.queue.run(async () => {
          if (this.closing) return
          if (this.occupied.get(workId) === reservation) this.occupied.delete(workId)
          await this.ledger.change(data => {
            const row = data.entries.find(entry => entry.workId === workId)
            if (row?.status === 'stopping') row.status = 'stopped'
          })
          this.publish(workspaceId); await this.drain()
        }), error => this.queue.run(async () => {
          if (this.closing) return
          await this.ledger.change(data => { const row = data.entries.find(item => item.workId === workId); if (row) row.status = closed ? 'closed' : 'failed' })
          await this.diagnostic(workspaceId, workId, String(error))
        })).catch(error => this.failedPersistence(error))
      }
      if (failure) throw failure
      await this.drain()
    })
  }
  async approval(workspaceId: string, workId: string, operationId: string, succeeded: boolean): Promise<void> {
    const data = await this.ledger.snapshot(), row = data.entries.find(entry => entry.workId === workId)
    if (!row || row.workspaceId !== workspaceId || row.operationId !== operationId || row.status !== 'awaiting-approval') return
    if (succeeded) await this.request(workspaceId, workId, row.inputId)
    else await this.queue.run(async () => {
      await this.ledger.change(draft => {
        const current = draft.entries.find(entry => entry.workId === workId)
        if (current?.operationId === operationId && current.status === 'awaiting-approval') {
          current.status = 'stopped'; current.diagnostic = 'Environment creation was not approved; waiting for new explicit input.'
        }
      })
      this.publish(workspaceId)
    })
  }
  private async drain(): Promise<void> {
    if (this.closing || this.fault) return
    let data = await this.ledger.snapshot()
    const queued = data.entries.filter(row => row.status === 'queued').sort((a, b) => a.order - b.order)
    for (const row of queued) {
      if (this.occupied.size >= data.maxConcurrentWorkers) return
      if (this.occupied.has(row.workId) || this.cancelled.has(row.workId)) continue
      const detail = await this.store.workDetail(row.workspaceId, row.workId)
      if (detail.work.closedAt !== null || detail.work.revision !== row.expectedRevision || !detail.deliveries.some(item => item.status === 'pending')) {
        await this.ledger.change(draft => {
          const entry = draft.entries.find(item => item.workId === row.workId)!
          entry.status = detail.work.closedAt !== null ? 'closed' : 'failed'
          entry.diagnostic = 'Work changed before dispatch; read its current state and provide a new explicit decision.'
        })
        this.publish(row.workspaceId); continue
      }
      // Persist intent before reserving capacity and launching. Startup never consumes restored intent.
      await this.ledger.change(draft => { const entry = draft.entries.find(item => item.workId === row.workId)!; entry.status = 'starting'; entry.updatedAt = Date.now() })
      const reservation = { previousExecutionId: this.workers.snapshots(row.workspaceId).find(item => item.workId === row.workId)?.executionId }
      this.occupied.set(row.workId, reservation); this.publish(row.workspaceId)
      void this.workers.start(row.workspaceId, row.workId).catch(error => this.queue.run(async () => {
        if (this.closing) return
        if (this.occupied.get(row.workId) !== reservation) return
        const native = this.workers.snapshots(row.workspaceId).find(item => item.workId === row.workId)
        if (!native || native.stopConfirmed) this.occupied.delete(row.workId)
        await this.ledger.change(draft => {
          const entry = draft.entries.find(item => item.workId === row.workId)!
          if (!['closed', 'stopped', 'stopping'].includes(entry.status)) entry.status = 'failed'
          entry.diagnostic = String(error)
        })
        this.publish(row.workspaceId); await this.drain()
      })).catch(error => this.failedPersistence(error))
      data = await this.ledger.snapshot()
    }
  }
  private async observe(event: SuperAgentWorkerSnapshot): Promise<void> {
    if (this.closing) return
    if (event.retiredAt !== undefined) { this.publish(event.workspaceId); return }
    const native = this.workers.snapshots(event.workspaceId).find(row => row.workId === event.workId)
    if (!native || native.executionId !== event.executionId) return
    // A slot may already belong to a new launch whose first native snapshot has not arrived.
    if (this.occupied.get(native.workId)?.previousExecutionId === native.executionId) return
    const data = await this.ledger.snapshot(), entry = data.entries.find(row => row.workId === native.workId)
    if (!entry) return
    if (native.stopConfirmed && !this.settling.has(native.workId)) {
      const pending = native.phase === 'stopped' && !this.cancelled.has(native.workId)
        ? (await this.store.workDetail(native.workspaceId, native.workId)).deliveries.some(row => row.status === 'pending') : false
      // dispatchPending is handing an existing supplement to a new native execution; retain its slot until admission.
      if (!pending) this.occupied.delete(native.workId)
    }
    // A new queued input and explicit user controls outrank late native events.
    if (!this.cancelled.has(native.workId) && !['queued', 'closed', 'interrupted'].includes(entry.status)) {
      if (entry.status !== native.phase || entry.executionId !== native.executionId || entry.diagnostic !== native.diagnostic) {
        await this.ledger.change(draft => {
          const row = draft.entries.find(item => item.workId === native.workId)!
          row.status = native.phase; row.executionId = native.executionId; row.diagnostic = native.diagnostic; row.updatedAt = Date.now()
        })
        this.publish(native.workspaceId)
      }
    }
    const detail = native.phase === 'ready' ? await this.store.workDetail(native.workspaceId, native.workId) : undefined
    const hasPending = detail?.deliveries.some(row => row.status === 'pending' || (row.executionId === native.executionId && row.status === 'unknown'))
    if (native.phase === 'ready' && !native.stopConfirmed && !hasPending && !this.cancelled.has(native.workId) && !this.settling.has(native.workId)) {
      this.settling.add(native.workId)
      const reservation = this.occupied.get(native.workId)
      void this.workers.settleReady(native.workspaceId, native.workId, native.executionId).then(() => this.queue.run(async () => {
        if (this.closing) return
        this.settling.delete(native.workId)
        const current = this.workers.snapshots(native.workspaceId).find(row => row.workId === native.workId)
        if (current) await this.observe(current)
        else if (this.occupied.get(native.workId) === reservation) {
          // Retirement may remove the confirmed result before this queued settlement callback runs.
          this.occupied.delete(native.workId); this.publish(native.workspaceId); await this.drain()
        }
      }), error => this.queue.run(async () => {
        if (this.closing) return
        this.settling.delete(native.workId); await this.diagnostic(native.workspaceId, native.workId, String(error))
      })).catch(error => this.failedPersistence(error))
    }
    await this.drain()
  }
  close(): Promise<void> {
    this.closing = true; this.unsubscribe(); this.listeners.clear()
    return this.queue.run(async () => {})
  }
}
