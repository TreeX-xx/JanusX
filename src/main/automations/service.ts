import { randomUUID } from 'node:crypto'
import { readdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { automationCardInputSchema, automationInputSchema, isReminder, reviewSchema, type AutomationCard, type AutomationInput, type AutomationDefinition, type AutomationCursor, type AutomationRun } from '../../shared/automations'
import { atomicJson, jsonFiles, readJson } from './storage'
import { completeReport, git, range, resolveHead, resolveRepository, reviewContext, validateReview, type ReviewContext } from './git'
import { MISSED_GRACE_MS, RUN_HISTORY_LIMIT, RUN_TIMEOUT_MS, nextOccurrence } from './schedule'

export interface AutomationPorts {
  resolveWorkspace(id: string): Promise<string | undefined>;
  review(task: AutomationInput['tasks'][number], definition: AutomationDefinition, context: ReviewContext, signal: AbortSignal, prior: unknown): Promise<unknown>;
  changed(): void;
  removed?(id: string): void;
  completed?(run: AutomationRun): void;
  now?(): number;
}
// Single host writer. Disk writes happen before publication; long execution never holds this lane.
export class AutomationService {
  private cards = new Map<string, AutomationCard>()
  private deletingCards = new Map<string, AutomationCard & { deletedTaskIds: string[] }>()
  private definitions = new Map<string, AutomationDefinition>()
  private cursors = new Map<string, AutomationCursor>()
  private runs = new Map<string, AutomationRun>()
  private controllers = new Map<string, AbortController>()
  private flights = new Map<string, Promise<void>>()
  private deleting = new Map<string, number>()
  private active = 0
  private waiters: Array<() => void> = []
  private lane: Promise<unknown> = Promise.resolve()
  private timer?: ReturnType<typeof setInterval>
  private stopping = false
  constructor(private directory: string, private ports: AutomationPorts) {}
  private now() { return this.ports.now?.() ?? Date.now() }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const result = this.lane.then(action); this.lane = result.catch(() => {}); return result
  }
  private path(id: string, file: string) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error('Invalid automation ID')
    return join(this.directory, id, file)
  }
  private deletionMarker(id: string) { this.path(id, ''); return join(this.directory, `${id}.deleted.json`) }
  private cardPath(id: string) { this.path(id, ''); return join(this.directory, 'cards', `${id}.json`) }
  private async writeCard(card: AutomationCard) {
    await atomicJson(this.cardPath(card.id), card); this.cards.set(card.id, card)
  }
  private async purge(id: string): Promise<void> {
    const root = resolve(this.directory), target = resolve(this.path(id, ''))
    if (dirname(target) !== root) throw new Error('Invalid automation directory')
    await rm(target, { recursive: true, force: true })
    await rm(this.deletionMarker(id), { force: true })
  }
  private async persistRun(run: AutomationRun) {
    if (!this.definitions.has(run.definitionId)) return
    await atomicJson(this.path(run.definitionId, `runs/${run.id}.json`), run); this.runs.set(run.id, run)
  }
  list() { return structuredClone([...this.definitions.values()]) }
  listCards() { return structuredClone([...this.cards.values()]) }
  async saveCard(name: string, id?: string, revision?: number): Promise<AutomationCard> {
    return this.serial(async () => {
      const input = automationCardInputSchema.parse({ name }), previous = id ? this.cards.get(id) : undefined
      if (id && (!previous || previous.revision !== revision)) throw new Error('revision_conflict: reload the card')
      const card = { ...input, id: id ?? randomUUID(), revision: (previous?.revision ?? 0) + 1, createdAt: previous?.createdAt ?? new Date(this.now()).toISOString() }
      await this.writeCard(card); this.ports.changed(); return structuredClone(card)
    })
  }
  async removeCard(id: string, revision: number): Promise<void> {
    const pending = await this.serial(async () => {
      const card = this.cards.get(id) ?? this.deletingCards.get(id)
      if (!card || card.revision !== revision) throw new Error('revision_conflict: reload the card')
      let marker = this.deletingCards.get(id)
      if (!marker) {
        const tasks = [...this.definitions.values()].filter(task => task.cardId === id)
        marker = { ...card, deletedTaskIds: tasks.map(task => task.id) }
        // One durable group marker makes all child deletions recoverable before publishing any removal.
        await atomicJson(this.cardPath(id), marker)
        this.deletingCards.set(id, marker); this.cards.delete(id)
        for (const task of tasks) {
          this.definitions.delete(task.id); this.deleting.set(task.id, task.revision)
          for (const run of this.runs.values()) if (run.definitionId === task.id) this.controllers.get(run.id)?.abort(new Error('Automation deleted'))
          this.ports.removed?.(task.id)
        }
        this.ports.changed()
      }
      return { ids: marker.deletedTaskIds, flights: [...this.runs.values()].filter(run => marker.deletedTaskIds.includes(run.definitionId)).flatMap(run => this.flights.get(run.id) ?? []) }
    })
    await Promise.allSettled(pending.flights)
    await this.serial(async () => {
      for (const taskId of pending.ids) {
        await this.purge(taskId); this.cursors.delete(taskId); this.deleting.delete(taskId)
        for (const run of this.runs.values()) if (run.definitionId === taskId) this.runs.delete(run.id)
      }
      await rm(this.cardPath(id), { force: true }); this.deletingCards.delete(id)
    })
  }
  history(id: string) { return this.definitions.has(id) ? structuredClone([...this.runs.values()].filter(run => run.definitionId === id).sort((a, b) => b.startedAt.localeCompare(a.startedAt))) : [] }
  async initialize(startTimer = true): Promise<void> {
    let directories: string[] = []
    try { directories = await readdir(this.directory) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    for (const file of await jsonFiles(join(this.directory, 'cards'))) {
      const card = (await readJson<AutomationCard & { deletedTaskIds?: string[] }>(file))!
      if (card.deletedTaskIds) {
        for (const taskId of card.deletedTaskIds) await this.purge(taskId)
        await rm(file, { force: true })
      } else { automationCardInputSchema.parse({ name: card.name }); this.cards.set(card.id, card) }
    }
    // The marker lives outside the card directory, so a partially removed edit journal cannot resurrect a card.
    for (const name of directories) {
      const match = /^([a-zA-Z0-9_-]{1,128})\.deleted\.json$/.exec(name)
      if (match) await this.purge(match[1])
    }
    for (const id of directories.filter(name => /^[a-zA-Z0-9_-]{1,128}$/.test(name))) {
      const edit = await readJson<{ definition: AutomationDefinition; cursor: AutomationCursor }>(this.path(id, 'edit.json'))
      if (edit) {
        await atomicJson(this.path(id, 'cursor.json'), edit.cursor)
        await atomicJson(this.path(id, 'definition.json'), edit.definition)
        await rm(this.path(id, 'edit.json'))
      }
      const definition = await readJson<AutomationDefinition>(this.path(id, 'definition.json'))
      if (!definition) continue
      automationInputSchema.parse(this.input(definition))
      if (!definition.cardId) {
        // Legacy cards were schedulable definitions. Keep their IDs, cursor and run history as a single task.
        definition.cardId = id
        if (!this.cards.has(id)) await this.writeCard({ id, name: definition.name, revision: 1, createdAt: definition.createdAt })
        await atomicJson(this.path(id, 'definition.json'), definition)
      }
      if (!this.cards.has(definition.cardId)) throw new Error(`Missing automation card for ${id}`)
      this.definitions.set(id, definition)
      const cursor = await readJson<AutomationCursor>(this.path(id, 'cursor.json'))
      if (!cursor) throw new Error(`Missing baseline for ${id}`)
      this.cursors.set(id, cursor)
      for (const file of await jsonFiles(this.path(id, 'runs'))) {
        const run = (await readJson<AutomationRun>(file))!
        this.runs.set(run.id, run)
      }
    }
    // A complete persisted report is the recovery journal for the cursor CAS.
    for (const run of this.runs.values()) {
      if (run.report && !run.cursorApplied && ['running', 'succeeded', 'needs_attention'].includes(run.state)) await this.commitCursor(run)
      if (run.state === 'running' || run.state === 'queued') {
        run.state = run.report ? (this.cursors.get(run.definitionId)?.attention ? 'needs_attention' : 'succeeded') : 'interrupted'
        run.reason = run.state === 'interrupted' ? 'Application stopped before completion; run again manually' : run.reason
        run.finishedAt = new Date(this.now()).toISOString(); await this.persistRun(run)
      }
      if (run.finishedAt && !run.notified) await this.notify(run)
    }
    if (startTimer) { this.timer = setInterval(() => { void this.tick().catch(error => console.error('[automations]', error)) }, 30_000); this.timer.unref(); await this.tick() }
  }
  input(definition: AutomationDefinition): AutomationInput {
    const { id: _id, root: _root, revision: _revision, createdAt: _created, nextRunAt: _next, ...input } = definition
    return input
  }
  async preview(raw: AutomationInput, id?: string, baseline?: string) {
    const input = automationInputSchema.parse(raw)
    if (isReminder(input)) return { root: '', head: '', base: '', files: [], noChanges: false }
    const registered = await this.ports.resolveWorkspace(input.workspaceId)
    if (!registered || registered.includes('://')) throw new Error('A registered local repository is required')
    const root = await resolveRepository(registered), head = await resolveHead(root, input.branch)
    const previous = id ? this.definitions.get(id) : undefined
    const matching = previous?.root === root && previous?.branch === input.branch && previous?.workspaceId === input.workspaceId
    return range(root, head, baseline || (matching ? this.cursors.get(id!)?.commit : undefined) || head)
  }
  async save(raw: AutomationInput, id?: string, revision?: number, baseline?: string): Promise<AutomationDefinition> {
    return this.serial(async () => {
      const input = automationInputSchema.parse(raw), previous = id ? this.definitions.get(id) : undefined
      if (id && (!previous || previous.revision !== revision)) throw new Error('revision_conflict: reload the card')
      const nextId = id ?? randomUUID(), oldCursor = this.cursors.get(nextId)
      const anchorOnEnable = input.enabled && !previous?.enabled && !oldCursor?.explicitBaseline && this.history(nextId).length === 0 && !baseline
      const preview = await this.preview(input, anchorOnEnable ? undefined : id, baseline)
      if (previous && input.cardId && input.cardId !== previous.cardId) throw new Error('A task must remain in its card')
      const cardId = previous?.cardId ?? input.cardId ?? nextId
      let card = this.cards.get(cardId)
      if (!card && (previous || input.cardId)) throw new Error('Automation card not found')
      card = card ? { ...card, revision: card.revision + 1 } : { id: cardId, name: input.name, revision: 1, createdAt: new Date(this.now()).toISOString() }
      const targetChanged = !previous || isReminder(previous) !== isReminder(input) || previous.root !== preview.root || previous.branch !== input.branch || previous.workspaceId !== input.workspaceId
      const definition: AutomationDefinition = { ...input, cardId, id: nextId, root: preview.root, revision: (previous?.revision ?? 0) + 1,
        createdAt: previous?.createdAt ?? new Date(this.now()).toISOString(), nextRunAt: nextOccurrence(input, this.now()) }
      const cursor = targetChanged || baseline || anchorOnEnable ? { commit: preview.base, epoch: (oldCursor?.epoch ?? 0) + 1, partialCount: 0, attention: false, explicitBaseline: Boolean(baseline) } : oldCursor!
      // A small edit journal makes definition + baseline changes recoverable across either rename.
      // Invalidate a pending group-delete confirmation before committing a changed child.
      await this.writeCard(card)
      await atomicJson(this.path(nextId, 'edit.json'), { definition, cursor })
      await atomicJson(this.path(nextId, 'cursor.json'), cursor); this.cursors.set(nextId, cursor)
      await atomicJson(this.path(nextId, 'definition.json'), definition); this.definitions.set(nextId, definition)
      await rm(this.path(nextId, 'edit.json'))
      this.ports.changed(); return structuredClone(definition)
    })
  }
  async run(id: string, requestKey: string, trigger: 'manual' | 'scheduled' = 'manual', skippedReason?: string): Promise<AutomationRun> {
    return this.serial(async () => {
      if (this.stopping) throw new Error('Application is stopping')
      if (!/^[a-zA-Z0-9_:.-]{1,200}$/.test(requestKey)) throw new Error('Invalid request key')
      const definition = this.definitions.get(id), cursor = this.cursors.get(id)
      if (!definition || !cursor) throw new Error(trigger === 'scheduled' ? 'Schedule changed' : 'Automation not found')
      const occurrenceKey = `${id}:${trigger}:${requestKey}`
      const previous = [...this.runs.values()].find(run => run.occurrenceKey === occurrenceKey)
      if (previous) return structuredClone(previous)
      if (trigger === 'scheduled' && (!definition.enabled || definition.nextRunAt !== requestKey)) throw new Error('Schedule changed')
      const overlapping = [...this.runs.values()].some(run => run.definitionId === id && ['queued', 'running'].includes(run.state))
      const run: AutomationRun = { id: randomUUID(), definitionId: id, occurrenceKey, trigger, snapshot: structuredClone(definition), cursor: structuredClone(cursor),
        state: 'queued', startedAt: new Date(this.now()).toISOString(), tasks: definition.tasks.map(task => ({ id: task.id, state: 'pending' })) }
      if (skippedReason || overlapping || cursor.attention) { run.state = 'skipped'; run.reason = skippedReason || (overlapping ? 'overlapping' : 'needs_attention: select a new baseline'); run.finishedAt = run.startedAt; run.tasks.forEach(task => { task.state = 'skipped' }) }
      await this.persistRun(run); this.ports.changed()
      if (run.state === 'queued') {
        const controller = new AbortController(); this.controllers.set(run.id, controller)
        const flight = this.execute(run, controller).catch(error => console.error('[automations] persistence failure', error))
        this.flights.set(run.id, flight); void flight.finally(() => this.flights.delete(run.id))
      }
      return structuredClone(run)
    })
  }
  async cancel(id: string): Promise<void> { this.controllers.get(id)?.abort(new Error('cancelled')) }
  async remove(id: string, revision: number): Promise<void> {
    const pending = await this.serial(async () => {
      const marker = this.deletionMarker(id)
      const currentRevision = this.definitions.get(id)?.revision ?? this.deleting.get(id)
      if (currentRevision === undefined) throw new Error('Automation not found')
      if (currentRevision !== revision) throw new Error('revision_conflict: reload the card')
      if (!this.deleting.has(id)) {
        const card = this.cards.get(this.definitions.get(id)?.cardId ?? '')
        if (card) await this.writeCard({ ...card, revision: card.revision + 1 })
        await atomicJson(marker, { revision, deletedAt: new Date(this.now()).toISOString() })
        this.deleting.set(id, revision); this.definitions.delete(id)
        for (const run of this.runs.values()) if (run.definitionId === id) this.controllers.get(run.id)?.abort(new Error('Automation deleted'))
        this.ports.removed?.(id); this.ports.changed()
      }
      return [...this.runs.values()].filter(run => run.definitionId === id).flatMap(run => this.flights.get(run.id) ?? [])
    })
    // Cancellation finalizers use the writer lane too. Never wait for them while holding it.
    await Promise.allSettled(pending)
    await this.serial(async () => {
      await this.purge(id)
      for (const run of this.runs.values()) if (run.definitionId === id) this.runs.delete(run.id)
      this.cursors.delete(id); this.deleting.delete(id); this.ports.changed()
    })
  }
  async stop(): Promise<void> { this.stopping = true; if (this.timer) clearInterval(this.timer); for (const controller of this.controllers.values()) controller.abort(new Error('Application stopping')); await Promise.allSettled(this.flights.values()); await this.lane }
  async tick(): Promise<void> {
    for (const definition of this.list()) {
      if (!definition.enabled || !definition.nextRunAt || Date.parse(definition.nextRunAt) > this.now()) continue
      const due = definition.nextRunAt
      try { await this.run(definition.id, due, 'scheduled', this.now() - Date.parse(due) > MISSED_GRACE_MS ? 'missed' : undefined) }
      catch (error) { if (error instanceof Error && error.message === 'Schedule changed') continue; throw error }
      await this.serial(async () => {
        const current = this.definitions.get(definition.id)
        if (!current || current.revision !== definition.revision || current.nextRunAt !== due) return
        // Keep interval schedules anchored to the due time; polling jitter must not stretch every minute into 90 seconds.
        const period = current.schedule === 'interval' ? current.intervalMinutes! * 60_000 : 0
        current.nextRunAt = period
          ? new Date(Date.parse(due) + (Math.floor((this.now() - Date.parse(due)) / period) + 1) * period).toISOString()
          : nextOccurrence(current, this.now())
        await atomicJson(this.path(current.id, 'definition.json'), current); this.ports.changed()
      })
    }
  }
  private async commitCursor(run: AutomationRun): Promise<void> {
    if (!this.definitions.has(run.definitionId)) return
    const cursor = this.cursors.get(run.definitionId)!, definition = this.definitions.get(run.definitionId)!
    if (cursor.lastRunId === run.id) { run.cursorCommitted = !run.report!.incomplete; run.cursorApplied = true; await this.persistRun(run); return }
    if (definition.revision !== run.snapshot.revision || cursor.epoch !== run.cursor.epoch || cursor.commit !== run.cursor.commit) {
      run.reason = 'cursor_conflict: report saved; current baseline retained'; run.cursorApplied = true; await this.persistRun(run); return
    }
    const incomplete = run.report!.incomplete
    const next = { ...cursor, lastRunId: run.id, commit: incomplete ? cursor.commit : run.report!.head,
      partialCount: incomplete ? cursor.partialCount + 1 : 0, attention: incomplete && cursor.partialCount + 1 >= 2 }
    await atomicJson(this.path(run.definitionId, 'cursor.json'), next); this.cursors.set(run.definitionId, next)
    run.cursorCommitted = !incomplete; run.cursorApplied = true; await this.persistRun(run)
  }
  private async notify(run: AutomationRun): Promise<void> {
    if (!this.definitions.has(run.definitionId)) return
    // Claim before dispatch: a crash can lose a transient alert, never the durable result or emit it twice.
    run.notified = true; await this.persistRun(run); this.ports.completed?.(structuredClone(run))
  }
  private async acquire(signal: AbortSignal): Promise<void> {
    while (this.active >= 2) {
      await new Promise<void>((resolve, reject) => {
        const wake = () => { signal.removeEventListener('abort', abort); resolve() }
        const abort = () => { this.waiters = this.waiters.filter(item => item !== wake); reject(signal.reason) }
        signal.addEventListener('abort', abort, { once: true }); this.waiters.push(wake)
        if (signal.aborted) abort()
      })
    }
    signal.throwIfAborted(); this.active++
  }
  private async execute(run: AutomationRun, controller: AbortController): Promise<void> {
    const { signal } = controller, timeout = setTimeout(() => controller.abort(new Error('timeout')), RUN_TIMEOUT_MS)
    let acquired = false
    try {
      await this.acquire(signal); acquired = true
      run.state = 'running'; await this.serial(() => this.persistRun(run)); this.ports.changed()
      if (isReminder(run.snapshot)) {
        signal.throwIfAborted()
        const current = this.definitions.get(run.definitionId)
        if (run.trigger === 'scheduled' && (!current?.enabled || current.revision !== run.snapshot.revision)) {
          run.state = 'skipped'; run.reason = 'Schedule changed'; run.tasks[0].state = 'skipped'; return
        }
        run.message = run.snapshot.tasks[0].message
        run.tasks[0].state = 'succeeded'; run.tasks[0].output = run.message
        run.state = 'succeeded'; return
      }
      const registered = await this.ports.resolveWorkspace(run.snapshot.workspaceId)
      if (!registered || await resolveRepository(registered) !== run.snapshot.root) throw new Error('Project identity changed')
      const head = await resolveHead(run.snapshot.root, run.snapshot.branch)
      const input = await range(run.snapshot.root, head, run.cursor.commit); run.head = head
      if (input.noChanges) { run.state = 'skipped'; run.reason = 'no_changes'; run.tasks.forEach((task, index) => { task.state = index === 0 ? 'succeeded' : 'skipped' }); return }
      const context = await reviewContext(input, signal), reviews = [], checks = []
      const outputs = new Map<string, unknown>()
      for (const [index, task] of run.snapshot.tasks.entries()) {
        signal.throwIfAborted(); const record = run.tasks[index]; record.state = 'running'
        await this.serial(() => this.persistRun(run)); this.ports.changed()
        if (task.kind === 'git') outputs.set(task.id, input)
        else if (task.kind === 'command') {
          let output = '', passed = true
          try { output = await git(input.root, ['diff', '--no-ext-diff', '--no-textconv', '--check', input.base, input.head, '--'], signal) }
          catch (error) { const failure = error as { code?: number; stdout?: string }; if (failure.code !== 2) throw error; passed = false; output = failure.stdout ?? '' }
          const check = { taskId: task.id, command: 'git diff --check', output, passed }; checks.push(check); outputs.set(task.id, check)
        } else if (task.kind.startsWith('agent.')) {
          const review = reviewSchema.parse(await this.ports.review(task, run.snapshot, context, signal, outputs.get(task.input!)))
          validateReview(review, context); reviews.push(review); outputs.set(task.id, review)
        } else {
          run.report = completeReport(reviews, context, checks); outputs.set(task.id, run.report)
        }
        record.state = 'succeeded'; record.output = JSON.stringify(outputs.get(task.id)); await this.serial(() => this.persistRun(run))
      }
      signal.throwIfAborted()
      await this.serial(async () => {
        signal.throwIfAborted()
        // Full report is durable before cursor updates or notification.
        await this.persistRun(run)
        await this.commitCursor(run)
        run.state = this.cursors.get(run.definitionId)!.attention ? 'needs_attention' : 'succeeded'
      })
    } catch (error) {
      const reportReady = Boolean(run.report && run.tasks.every(task => task.state === 'succeeded'))
      run.state = signal.aborted ? 'cancelled' : reportReady ? 'succeeded' : 'failed'
      run.reason = `${reportReady && !signal.aborted ? 'Report complete; cursor finalization needs recovery: ' : ''}${error instanceof Error ? error.message : String(error)}`
      if (/baseline_conflict|MODEL_UNAVAILABLE|login|auth|CAPABILITY_UNAVAILABLE/i.test(run.reason)) run.state = 'needs_attention'
      const task = run.tasks.find(task => task.state === 'running'); if (task) task.state = 'failed'
    } finally {
      clearTimeout(timeout); run.finishedAt = new Date(this.now()).toISOString()
      try {
        await this.serial(async () => {
          await this.persistRun(run)
          const old = this.history(run.definitionId).filter(item => !['running', 'queued'].includes(item.state)).slice(RUN_HISTORY_LIMIT)
          for (const item of old) { await rm(this.path(item.definitionId, `runs/${item.id}.json`), { force: true }); this.runs.delete(item.id) }
        })
        this.ports.changed(); await this.serial(() => this.notify(run))
      } finally { this.controllers.delete(run.id); if (acquired) { this.active--; this.waiters.shift()?.() } }
    }
  }
}
