// Note: checkpoints are separate from failed review jobs — see .agents/notes/blueprint/maintenance/note-content-review.md
import { readFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import { SerialQueue, writeFileAtomic } from '@janusx/plugin-sdk/native'
import { REVIEW_NOTE_KINDS, reviewContextSchema, type ReviewContext, type ReviewItem } from '../../../shared/blueprint-review'
import type { AutomaticReviewActivity, AutomaticReviewTarget, ReviewActivity } from '../../../shared/ipc/blueprint-review'
import type { BlueprintReviewSettings } from '../../../shared/blueprint-review-settings'
import { reviewContextKey } from '../suggestions/store'
import { GitReviewSources, git, gitHead } from './git-snapshot'

const hash = z.string().regex(/^[a-f0-9]{40,64}$/)
const jobSchema = z.object({ commit: hash, noteId: z.string().uuid(), attempts: z.number().int().min(0).max(2),
  round: z.number().int().nonnegative().default(0), retrying: z.boolean().default(false), state: z.enum(['pending', 'failed']), error: z.string().optional(), title: z.string().optional(), path: z.string().optional(),
  stage: z.enum(['structure', 'reading', 'analyzing', 'verifying', 'publishing']).optional() }).strict()
const targetSchema = z.object({ noteId: z.string().uuid(), commit: hash, title: z.string().optional(), path: z.string().optional(),
  round: z.number().int().nonnegative().default(0), state: z.enum(['reviewed', 'incomplete']), reportRevision: z.number().optional() })
const summarySchema = z.object({ finishedAt: z.string().datetime(), outcome: z.enum(['reviewed', 'no-changes']),
  reviewed: z.number().int().nonnegative(), findings: z.number().int().nonnegative(), failed: z.number().int().nonnegative(), incomplete: z.number().int().nonnegative() }).strict()
const roundSchema = z.object({ id: z.number().int().nonnegative(), finishedAt: z.string().datetime().optional() }).strict()
const retrySchema = z.object({ noteId: z.string().uuid(), commit: hash.optional(), path: z.string().optional(), title: z.string().optional(),
  state: z.enum(['failed', 'incomplete']), error: z.string().optional(), reportRevision: z.number().optional(),
  stage: z.enum(['structure', 'reading', 'analyzing', 'verifying', 'publishing']).optional() }).strict()
const checkpointSchema = z.object({ context: reviewContextSchema, checkpoint: hash.nullable(), seen: hash.nullable(),
  enabled: z.boolean(), nextRound: z.number().int().nonnegative().default(0), completedRounds: z.array(z.number().int().nonnegative()).default([0]), rounds: z.array(roundSchema).default([]), jobs: z.array(jobSchema), retries: z.array(retrySchema).default([]), retryImportDone: z.boolean().default(false), targets: z.array(targetSchema).default([]), error: z.string().optional(), lastRun: summarySchema.optional() }).strict()
const stateSchema = z.object({ version: z.literal(1), branches: z.record(checkpointSchema) }).strict()
type State = z.infer<typeof stateSchema>
interface SchedulerPorts {
  context(root: string): Promise<ReviewContext>
  settings(): Promise<BlueprintReviewSettings>
  review(context: ReviewContext, noteId: string, sources: GitReviewSources, signal: AbortSignal): Promise<ReviewItem | undefined | void>
  savedReviews?(context: ReviewContext): ReviewItem[]
  activityChanged?(root: string): void
}

export class GitReviewScheduler {
  private readonly queue = new SerialQueue()
  private readonly roots = new Set<string>()
  private readonly activities = new Map<string, AutomaticReviewActivity>()
  private readonly controller = new AbortController()
  private readonly active = new Map<string, AbortController>()
  private readonly restoredContexts = new Set<string>()
  private timer?: ReturnType<typeof setInterval>
  private polling?: Promise<void>
  constructor(readonly path: string, private readonly ports: SchedulerPorts) {}
  watch(root: string): void {
    const newlyWatched = !this.roots.has(root)
    this.roots.add(root)
    if (!this.timer) { this.timer = setInterval(() => { void this.poll() }, 10000); this.timer.unref() }
    if (newlyWatched || !this.activities.has(root)) void this.poll()
  }
  activity(root: string) { return this.activities.get(root) }
  phase(root: string, noteId: string, phase: ReviewActivity['phase']) {
    const target = this.activities.get(root)?.targets?.find(target => target.noteId === noteId)
    if (target) { target.stage = phase; this.changed(root) }
  }
  private targets(branch: State['branches'][string]): AutomaticReviewTarget[] {
    const jobs = new Set(branch.jobs.map(job => job.noteId))
    const tracked = new Set([...jobs, ...branch.targets.map(target => target.noteId)])
    return [...branch.retries.filter(retry => !tracked.has(retry.noteId)), ...branch.targets.filter(target => !jobs.has(target.noteId)), ...branch.jobs.map(job => ({
      noteId: job.noteId, commit: job.commit, round: job.round, state: job.state, retrying: job.retrying, title: job.title, path: job.path, stage: job.stage, error: job.error,
    }))]
  }
  private branch(state: State, context: ReviewContext) {
    return state.branches[reviewContextKey(context)] ??= { context, checkpoint: null, seen: null, enabled: false,
      nextRound: 0, completedRounds: [0], rounds: [], jobs: [], targets: [], retries: [], retryImportDone: false }
  }
  /** Recover actual unfinished reports once; a revision or historical aggregate never invents a run. */
  private importRetries(branch: State['branches'][string]): boolean {
    if (branch.retryImportDone) return false
    const tracked = new Set([...branch.jobs, ...branch.targets.filter(target => target.state === 'incomplete'), ...branch.retries].map(item => item.noteId))
    for (const item of this.ports.savedReviews?.(branch.context) ?? []) {
      if (tracked.has(item.noteId)) continue
      if (!item.error && !item.pending && item.report?.coverage !== 'insufficient') continue
      branch.targets = branch.targets.filter(target => target.noteId !== item.noteId)
      branch.retries.push({ noteId: item.noteId, path: item.source?.path, commit: item.report?.provenance?.commit,
        state: item.error || item.pending ? 'failed' : 'incomplete', reportRevision: item.reportRevision,
        error: item.error ?? (item.pending ? 'Review interrupted; recover from the Note preview' : undefined) })
      tracked.add(item.noteId)
    }
    branch.retryImportDone = true
    return true
  }
  private publishTargets(context: ReviewContext, branch: State['branches'][string]) {
    const activity = this.activities.get(context.workspacePath)
    if (!activity || activity.context && reviewContextKey(activity.context) !== reviewContextKey(context)) return
    activity.targets = this.targets(branch); activity.rounds = this.rounds(branch)
    this.changed(context.workspacePath)
  }
  async restoreRetries(context: ReviewContext, signal?: AbortSignal): Promise<void> {
    const key = reviewContextKey(context)
    const isCurrent = () => {
      const activity = this.activities.get(context.workspacePath)
      return this.restoredContexts.has(key) && activity?.context && reviewContextKey(activity.context) === key
    }
    if (isCurrent()) return
    const initialActivity = this.activities.get(context.workspacePath)
    // Reading already-persisted status must not queue behind a model running in another checkout.
    const observed = this.branch(await this.read(), context)
    const retries = observed.retries.length
    const imported = this.importRetries(observed)
    const restore = async (branch: State['branches'][string]) => {
      signal?.throwIfAborted()
      const settings = await this.ports.settings()
      signal?.throwIfAborted()
      if (isCurrent() || this.activities.get(context.workspacePath) !== initialActivity) return
      this.restoredContexts.add(key)
      const activity = this.activities.get(context.workspacePath)
      if (!activity || activity.context && reviewContextKey(activity.context) !== key) {
        this.activities.set(context.workspacePath, { context, phase: settings.automatic.enabled ? 'waiting' : 'disabled',
          commits: 0, threshold: settings.automatic.commits, remaining: 0, lastRun: branch.lastRun })
      }
      this.publishTargets(context, branch)
    }
    if (!imported || observed.retries.length === retries) return restore(observed)
    // A legacy report migration must be persisted before source reconciliation can clear its error.
    return this.queue.run(async () => {
      signal?.throwIfAborted()
      if (isCurrent()) return
      const state = await this.read(), branch = this.branch(state, context)
      signal?.throwIfAborted()
      if (this.importRetries(branch)) await this.save(state)
      await restore(branch)
    })
  }
  private rounds(branch: State['branches'][string]) {
    return branch.completedRounds.filter(id => id > 0 || branch.targets.some(target => target.round === id))
      .map(id => branch.rounds.find(round => round.id === id) ?? { id })
  }
  private finishRound(branch: State['branches'][string], round: number) {
    if (branch.jobs.some(job => job.round === round && job.state === 'pending')
      || !branch.targets.some(target => target.round === round && target.state === 'reviewed')) return
    branch.completedRounds = [...new Set([...branch.completedRounds, round])].sort((a, b) => a - b).slice(-2)
    if (!branch.rounds.some(item => item.id === round)) branch.rounds.push({ id: round, finishedAt: new Date().toISOString() })
    branch.rounds = branch.rounds.filter(item => branch.completedRounds.includes(item.id))
    branch.targets = branch.targets.filter(target => target.state === 'incomplete' || branch.completedRounds.includes(target.round))
  }
  private changed(root: string) { this.ports.activityChanged?.(root) }
  unwatch(root: string): void { this.roots.delete(root); this.active.get(root)?.abort(); this.activities.delete(root) }
  private async read(): Promise<State> {
    try { return stateSchema.parse(JSON.parse(await readFile(this.path, 'utf8'))) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, branches: {} }; throw error }
  }
  private save(state: State) { return writeFileAtomic(this.path, JSON.stringify(state) + '\n') }
  /** Settings changes anchor currently tracked checkouts immediately, not at the next periodic poll. */
  poll(): Promise<void> {
    if (this.polling) return this.polling
    this.polling = (async () => {
      for (const root of this.roots) {
        if (this.controller.signal.aborted) break
        try { await this.tick(root) }
        catch {
          this.activities.set(root, { ...this.activities.get(root), phase: 'failed', commits: this.activities.get(root)?.commits ?? 0, threshold: this.activities.get(root)?.threshold ?? 0,
            remaining: 0, reason: 'sources-unavailable', error: 'Git review could not read its checkpoint or Note sources' })
          this.changed(root)
        }
      }
    })().finally(() => { this.polling = undefined })
    return this.polling
  }
  tick(root: string): Promise<void> {
    return this.queue.run(async () => {
      if (this.controller.signal.aborted) return
      const controller = new AbortController()
      this.active.set(root, controller)
      try { await this.tickNow(root, AbortSignal.any([controller.signal, this.controller.signal])) }
      finally { this.active.delete(root) }
    })
  }
  /** A settings change cancels in-flight generation and anchors without starting a model. */
  async settingsChanged(): Promise<void> {
    for (const controller of this.active.values()) controller.abort()
    await this.queue.run(async () => {
      const settings = await this.ports.settings(), state = await this.read()
      for (const root of this.roots) {
        const context = await this.ports.context(root), key = reviewContextKey(context)
        const branch = state.branches[key]
        if (branch?.enabled === settings.automatic.enabled) {
          const activity = this.activities.get(root)
          if (activity) { activity.threshold = settings.automatic.commits; this.changed(root) }
          continue
        }
        const head = context.branch === 'no-git' ? null : await gitHead(root)
        const unavailable = context.branch === 'no-git' ? 'no-git' : context.branch.startsWith('detached:') ? 'detached' : !head ? 'no-commits' : undefined
        state.branches[key] = { context, checkpoint: head, seen: head, enabled: settings.automatic.enabled,
          lastRun: branch?.lastRun, targets: branch?.targets ?? [], nextRound: branch?.nextRound ?? 0, completedRounds: branch?.completedRounds ?? [0], rounds: branch?.rounds ?? [], retries: branch?.retries ?? [], retryImportDone: branch?.retryImportDone ?? false,
          jobs: (branch?.jobs ?? []).map(job => ({ ...job, state: 'failed', error: 'Automatic review stopped; recover from the Note preview' })) }
        for (const round of new Set((branch?.jobs ?? []).filter(job => job.state === 'pending').map(job => job.round))) this.finishRound(state.branches[key], round)
        this.activities.set(root, { phase: settings.automatic.enabled ? unavailable ? 'unavailable' : 'waiting' : 'disabled', reason: settings.automatic.enabled ? unavailable : undefined,
          context, commits: 0, threshold: settings.automatic.commits, remaining: 0, lastRun: branch?.lastRun, targets: this.targets(state.branches[key]), rounds: this.rounds(state.branches[key]) })
        this.changed(root)
      }
      await this.save(state)
    })
  }
  async manualSucceeded(context: ReviewContext, noteId: string, result?: ReviewItem): Promise<void> {
    await this.queue.run(async () => {
      const state = await this.read(), branch = this.branch(state, context)
      const job = branch.jobs.find(job => job.noteId === noteId)
      const target = branch.targets.find(target => target.noteId === noteId)
      this.importRetries(branch)
      const wasRetry = branch.retries.some(retry => retry.noteId === noteId)
      const incomplete = result?.report?.coverage === 'insufficient'
      branch.jobs = branch.jobs.filter(job => job.noteId !== noteId)
      branch.targets = branch.targets.filter(target => target.noteId !== noteId)
      branch.retries = branch.retries.filter(retry => retry.noteId !== noteId)
      if (job || target) {
        const previous = job ?? target!
        const round = incomplete || (!wasRetry && !job && target?.state === 'reviewed') ? previous.round : ++branch.nextRound
        branch.targets.push({ noteId, commit: previous.commit, title: previous.title, path: result?.source?.path ?? previous.path,
          round, state: incomplete ? 'incomplete' : 'reviewed', reportRevision: result?.reportRevision })
        if (!incomplete) this.finishRound(branch, round)
      } else if (incomplete) {
        branch.retries.push({ noteId, state: 'incomplete', path: result?.source?.path, reportRevision: result?.reportRevision,
          commit: result?.report?.provenance?.commit })
      }
      await this.save(state)
      this.restoredContexts.add(reviewContextKey(context))
      const activity = this.activities.get(context.workspacePath)
      if (activity && (!activity.context || reviewContextKey(activity.context) === reviewContextKey(context))
        && activity.reason === 'review-failed' && !this.targets(branch).some(target => target.state === 'failed')) {
        activity.phase = (await this.ports.settings()).automatic.enabled ? 'waiting' : 'disabled'; delete activity.error; delete activity.reason
      }
      this.publishTargets(context, branch)
    })
  }
  async manualFailed(context: ReviewContext, noteId: string, error: unknown, stage: ReviewActivity['phase'], source?: ReviewItem['source']): Promise<void> {
    await this.queue.run(async () => {
      const state = await this.read(), branch = this.branch(state, context)
      const previous = branch.jobs.find(job => job.noteId === noteId) ?? branch.targets.find(target => target.noteId === noteId)
      this.importRetries(branch)
      branch.targets = branch.targets.filter(target => target.noteId !== noteId)
      branch.jobs = branch.jobs.filter(job => job.noteId !== noteId)
      branch.retries = branch.retries.filter(retry => retry.noteId !== noteId)
      const message = error instanceof z.ZodError ? 'Review output did not match the required structure'
        : (error instanceof Error ? error.message : String(error)).slice(0, 600)
      if (previous) branch.jobs.push({ noteId, commit: previous.commit, round: previous.round, title: previous.title, path: source?.path ?? previous.path,
        attempts: 2, retrying: true, state: 'failed', stage, error: message })
      else branch.retries.push({ noteId, path: source?.path, state: 'failed', stage, error: message })
      await this.save(state)
      this.restoredContexts.add(reviewContextKey(context))
      const activity = this.activities.get(context.workspacePath)
      if (activity && (!activity.context || reviewContextKey(activity.context) === reviewContextKey(context))) {
        activity.phase = (await this.ports.settings()).automatic.enabled ? 'failed' : 'disabled'; activity.error = message; activity.reason = 'review-failed'
      }
      this.publishTargets(context, branch)
    })
  }
  private async tickNow(root: string, signal: AbortSignal): Promise<void> {
    const settings = await this.ports.settings()
    const context = await this.ports.context(root)
    const previous = this.activities.get(root)
    const activity: AutomaticReviewActivity = { context, phase: settings.automatic.enabled ? 'waiting' : 'disabled',
      commits: previous?.context && reviewContextKey(previous.context) === reviewContextKey(context) ? previous.commits : 0, threshold: settings.automatic.commits, remaining: 0 }
    const state = await this.read(), key = reviewContextKey(context)
    let branch = this.branch(state, context)
    if (this.importRetries(branch)) await this.save(state)
    this.restoredContexts.add(key)
    activity.lastRun = branch.lastRun; activity.targets = this.targets(branch); activity.rounds = this.rounds(branch)
    this.activities.set(root, activity)
    if (context.branch === 'no-git' || context.branch.startsWith('detached:')) {
      if (settings.automatic.enabled) { activity.phase = 'unavailable'; activity.reason = context.branch === 'no-git' ? 'no-git' : 'detached' }
      this.changed(root); return
    }
    const head = await gitHead(root)
    if (!head && settings.automatic.enabled) { activity.phase = 'unavailable'; activity.reason = 'no-commits'; this.changed(root); return }
    if (!branch || !branch.enabled || !settings.automatic.enabled || branch.checkpoint === null) {
      // Disabled intervals and a new branch start from the observed HEAD; no historical model replay.
      const jobs = branch?.jobs ?? []
      branch = state.branches[key] = { context, checkpoint: head, seen: head, enabled: settings.automatic.enabled, jobs, lastRun: branch?.lastRun, targets: branch?.targets ?? [], nextRound: branch?.nextRound ?? 0, completedRounds: branch?.completedRounds ?? [0], rounds: branch?.rounds ?? [], retries: branch?.retries ?? [], retryImportDone: branch?.retryImportDone ?? false }
      await this.save(state)
      this.changed(root)
      return
    }
    if (!head) return
    // Unresolved merge/index conflicts never represent a finished review input.
    if ((await git(root, ['ls-files', '-u'])).trim()) { activity.phase = 'failed'; activity.reason = 'git-conflicts'; activity.error = 'Resolve Git conflicts before automatic review'; this.changed(root); return }
    let commits: string[]
    try {
      await git(root, ['merge-base', '--is-ancestor', branch.checkpoint, head])
      commits = (await git(root, ['rev-list', '--first-parent', '--reverse', `${branch.checkpoint}..${head}`])).trim().split('\n').filter(Boolean)
    } catch {
      branch.error = 'Git history changed; establish a new baseline by turning automatic review off and on'
      await this.save(state); activity.phase = 'failed'; activity.reason = 'history-changed'; activity.error = branch.error; this.changed(root); return
    }
    activity.commits = commits.length
    this.changed(root)
    const unseen = branch.seen && commits.includes(branch.seen) ? commits.slice(commits.indexOf(branch.seen) + 1) : branch.seen === head ? [] : commits
    let merge = false
    for (const commit of unseen) if ((await git(root, ['rev-list', '--parents', '-n', '1', commit])).trim().split(/\s+/).length > 2) { merge = true; break }
    const checked = commits.length >= settings.automatic.commits || merge
    if (checked) {
      activity.phase = 'checking'
      this.changed(root)
      const sources = await GitReviewSources.open(context, head, signal)
      try {
        const changed = new Set((await git(root, ['diff', '--relative', '--name-only', '--no-renames', '-z', branch.checkpoint, head, '--', '.agents/notes'])).split('\0').filter(Boolean))
        const snapshot = await sources.snapshot(context, signal)
        const targets = snapshot.entries.filter(entry => entry.doc && REVIEW_NOTE_KINDS.has(entry.doc.kind) && changed.has(entry.relPath))
        // A valid snapshot retires unavailable completed targets; unresolved records survive until successful recovery.
        const interruptedRounds = new Set(branch.jobs.filter(job => job.state === 'pending').map(job => job.round))
        const eligible = new Set(snapshot.entries.filter(entry => entry.doc && REVIEW_NOTE_KINDS.has(entry.doc.kind)).map(entry => entry.doc!.id))
        branch.targets = branch.targets.filter(target => target.state === 'incomplete' || eligible.has(target.noteId))
        for (const job of branch.jobs) if (!eligible.has(job.noteId) && job.state === 'pending') {
          job.state = 'failed'; job.error = 'Review target is unavailable or no longer eligible; recover from the Note preview'
        }
        const round = targets.length ? ++branch.nextRound : branch.nextRound
        for (const target of targets) {
          const retrying = branch.jobs.some(job => job.noteId === target.doc!.id && (job.state === 'failed' || job.retrying))
            || branch.targets.some(previous => previous.noteId === target.doc!.id && previous.state === 'incomplete')
            || branch.retries.some(previous => previous.noteId === target.doc!.id)
          branch.jobs = branch.jobs.filter(job => job.noteId !== target.doc!.id)
          branch.jobs.push({ commit: head, round, retrying, noteId: target.doc!.id, title: target.doc!.title, path: target.relPath, attempts: 0, state: 'pending' })
        }
        for (const previousRound of interruptedRounds) this.finishRound(branch, previousRound)
        // Persist queue and checkpoint atomically, including a successful no-difference check.
        branch.checkpoint = head; branch.seen = head; delete branch.error
        await this.save(state); activity.commits = 0
      } finally { await sources.close() }
    } else if (branch.seen !== head) { branch.seen = head; await this.save(state) }
    activity.remaining = branch.jobs.filter(job => job.state === 'pending').length
    activity.targets = this.targets(branch); activity.rounds = this.rounds(branch)
    const pending = branch.jobs.filter(job => job.state === 'pending')
    activity.total = pending.length; activity.completed = 0
    let reviewed = 0, findings = 0, incomplete = 0
    for (const job of pending) {
      if (signal.aborted || !(await this.ports.settings()).automatic.enabled) break
      if (reviewContextKey(await this.ports.context(root)) !== key) break
      if (job.attempts >= 2) { job.state = 'failed'; job.error = 'Review interrupted twice; recover manually'; activity.completed++; activity.remaining--; activity.targets = this.targets(branch); activity.rounds = this.rounds(branch); await this.save(state); this.changed(root); continue }
      activity.phase = 'reviewing'
      let sources: GitReviewSources | undefined
      try {
        sources = await GitReviewSources.open(context, job.commit, signal)
        const entry = (await sources.snapshot(context, signal)).entries.find(entry => entry.doc?.id === job.noteId)
        activity.currentNote = { id: job.noteId, title: entry?.doc?.title ?? entry?.relPath ?? job.noteId, path: entry?.relPath ?? '' }
        const target = activity.targets?.find(target => target.noteId === job.noteId)
        if (target) { target.state = 'reviewing'; target.stage = 'reading' }
        this.changed(root)
        while (job.attempts < 2) {
          if (signal.aborted) break
          job.attempts++; await this.save(state)
          try {
            const result = await this.ports.review(context, job.noteId, sources, signal)
            signal.throwIfAborted()
            reviewed++; findings += result?.report?.findings.length ?? 0
            if (result?.report?.coverage === 'insufficient') incomplete++
            branch.targets = branch.targets.filter(target => target.noteId !== job.noteId)
            branch.targets.push({ noteId: job.noteId, title: job.title, path: job.path, commit: job.commit,
              round: job.round, state: result?.report?.coverage === 'insufficient' ? 'incomplete' : 'reviewed', reportRevision: result?.reportRevision })
            branch.retries = branch.retries.filter(retry => retry.noteId !== job.noteId)
            branch.jobs = branch.jobs.filter(item => item !== job); await this.save(state); break
          } catch (error) {
            // Shutdown/settings cancellation is a pause, not a failed provider attempt.
            if (signal.aborted) { job.attempts--; await this.save(state); break }
            if ((error as { code?: string }).code === 'TRANSIENT' && job.attempts < 2) {
              try { await delay(2000, undefined, { signal }) }
              catch { await this.save(state); break }
              continue
            }
            job.state = 'failed'; job.stage = target?.stage ?? 'reading'
            job.error = error instanceof z.ZodError ? 'Review output did not match the required structure' : (error instanceof Error ? error.message : String(error)).slice(0, 600)
            await this.save(state); break
          }
        }
      } catch (error) {
        job.state = 'failed'; job.stage = 'reading'; job.error = (error instanceof Error ? error.message : String(error)).slice(0, 600)
        await this.save(state)
      } finally { await sources?.close() }
      activity.targets = this.targets(branch); activity.rounds = this.rounds(branch)
      if (!signal.aborted) { activity.completed++; activity.remaining--; this.changed(root) }
    }
    if (!signal.aborted) {
      for (const round of new Set(pending.map(job => job.round))) this.finishRound(branch, round)
      activity.targets = this.targets(branch); activity.rounds = this.rounds(branch)
    }
    const failed = branch.jobs.find(job => job.state === 'failed')
    activity.phase = failed ? 'failed' : 'waiting'; activity.error = failed?.error
    activity.reason = failed ? 'review-failed' : undefined
    delete activity.currentNote
    if (!signal.aborted && (checked || pending.length)) {
      branch.lastRun = { finishedAt: new Date().toISOString(), outcome: pending.length ? 'reviewed' : 'no-changes', reviewed, findings,
        failed: pending.filter(job => job.state === 'failed').length, incomplete }
      activity.lastRun = branch.lastRun
      await this.save(state)
    }
    this.changed(root)
  }
  async shutdown(): Promise<void> { clearInterval(this.timer); this.controller.abort(); await this.polling; await this.queue.run(async () => {}) }
}
