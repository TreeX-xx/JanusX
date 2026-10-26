import { NoteRepairService } from './note-repair'
// Note: product-owned review assembly — see .agents/notes/blueprint/maintenance/note-content-review.md
import { join, resolve } from 'node:path'
import { BlueprintReadTasks, abortableRead } from '../read-task'
import { realpath } from 'node:fs/promises'
import type { BlueprintReviewSettings } from '../../../shared/blueprint-review-settings'
import { reviewContextKey, ReviewStore } from '../suggestions/store'
import { SuggestionService } from '../suggestions/service'
import { WorkspaceSuggestionSources } from '../suggestions/sources'
import { WorkspaceSuggestions } from '../suggestions/workspace-service'
import { ReviewSettingsStore } from './settings'
import { NoteReviewEngine, type ReviewModelPort } from './engine'
import type { BlueprintReviewActivityUpdate, BlueprintReviewResults, BlueprintReviewView, ReviewActivity } from '../../../shared/ipc/blueprint-review'
import type { ReviewContext } from '../../../shared/blueprint-review'
import { GitReviewScheduler } from './git-scheduler'
import { collectReviewEvidence, type ReviewInput } from './evidence'
import { NoteReadingService } from '../note-reading'
import type { GitReviewSources } from './git-snapshot'
import type { NoteUpdatesView } from '../../../shared/blueprint-attention'

export class BlueprintReviewRuntime {
  readonly sources: WorkspaceSuggestionSources
  readonly store: ReviewStore
  readonly suggestions: WorkspaceSuggestions
  readonly settings: ReviewSettingsStore
  readonly engine: NoteReviewEngine
  readonly automatic: GitReviewScheduler
  readonly reading: NoteReadingService
  readonly repairs: NoteRepairService
  private readonly running = new Map<string, { root: string; contextKey: string; activity: ReviewActivity; controller: AbortController; finished: Promise<void> }>()
  private stopping = false
  private activityRevision = 0
  private automaticSettings?: BlueprintReviewSettings['automatic']
  private readonly statusRoots = new Set<string>()
  private readonly activityListeners = new Set<(update: BlueprintReviewActivityUpdate) => void>()
  private readonly resultListeners = new Set<(update: BlueprintReviewResults) => void>()
  private readonly reads = new BlueprintReadTasks<BlueprintReviewView>()
  constructor(root: string, models: ReviewModelPort, sources = new WorkspaceSuggestionSources()) {
    this.sources = sources
    this.reading = new NoteReadingService(join(root, 'note-reading.json'), this.sources)
    this.store = new ReviewStore(join(root, 'current-suggestions.sqlite'))
    this.suggestions = new WorkspaceSuggestions(new SuggestionService(this.store), this.sources)
    this.settings = new ReviewSettingsStore(join(root, 'review-settings.json'))
    // Review publication has its own source reader: a foreground index deadline must not discard a generated report.
    const reviewSources = new WorkspaceSuggestionSources()
    this.engine = new NoteReviewEngine(new WorkspaceSuggestions(new SuggestionService(this.store), reviewSources), reviewSources, models,
      context => { if (!this.stopping) this.resultsChanged(context) })
    this.repairs = new NoteRepairService(join(root, 'note-repair'), { context: path => this.sources.context(path),
      notes: this.sources.notes, suggestions: this.suggestions, review: (path, noteId, signal) => this.run(path, noteId, undefined, signal),
      changed: context => this.resultsChanged(context),
      written: (context, noteId, path, hash) => {
        void this.reading.observeVersion(context, { noteId, path, hash }).then(updates => {
          if (!this.stopping) this.resultsChanged(context, updates)
        }).catch(error => console.warn('[blueprint-sync] Written Note observation failed', error))
      } })
    this.automatic = new GitReviewScheduler(join(root, 'git-review-state.json'), {
      savedReviews: context => this.store.read(context).items,
      context: path => this.sources.context(path), settings: () => this.settings.read(),
      review: async (context, noteId, sources, signal) => this.run(context.workspacePath, noteId, await collectReviewEvidence(sources, context, noteId), signal, sources),
      activityChanged: root => this.activityChanged(root),
    })
  }
  onActivityChanged(listener: (update: BlueprintReviewActivityUpdate) => void) {
    this.activityListeners.add(listener)
    return () => { this.activityListeners.delete(listener) }
  }
  onResultsChanged(listener: (update: BlueprintReviewResults) => void) {
    this.resultListeners.add(listener)
    return () => { this.resultListeners.delete(listener) }
  }
  private resultsChanged(context: ReviewContext, updates?: NoteUpdatesView) {
    const update = { ...this.store.read(context), ...(updates ? { updates } : {}) }
    for (const listener of this.resultListeners) listener(structuredClone(update))
  }
  private activityChanged(root: string) {
    this.statusRoots.add(root)
    const update: BlueprintReviewActivityUpdate = { root, revision: ++this.activityRevision, automaticSettings: this.automaticSettings, automatic: this.automatic.activity(root),
      activities: [...this.running.values()].filter(run => run.root === root).map(run => run.activity) }
    for (const listener of this.activityListeners) listener(structuredClone(update))
  }
  // A toolbar read touches configuration and in-memory progress, never the Note corpus or review queue.
  async activityRead(rootPath: string): Promise<BlueprintReviewActivityUpdate> {
    const root = await realpath(rootPath).catch(() => rootPath)
    this.statusRoots.add(root)
    const revision = this.activityRevision
    const automatic = structuredClone(this.automatic.activity(root))
    const activities = [...this.running.values()].filter(run => run.root === root).map(run => ({ ...run.activity }))
    const { automatic: automaticSettings } = await this.settings.read()
    if (revision === this.activityRevision) this.automaticSettings = automaticSettings
    return { root, revision, automaticSettings, automatic, activities }
  }
  configurationChanged(settings: BlueprintReviewSettings): void {
    this.automaticSettings = settings.automatic
    for (const root of this.statusRoots) this.activityChanged(root)
  }
  read(rootPath: string): Promise<BlueprintReviewView> {
    const root = resolve(rootPath), key = process.platform === 'win32' ? root.toLowerCase() : root
    return this.reads.run(key, async signal => this.readCurrent(await abortableRead(realpath(root), signal), signal))
  }
  async readSaved(rootPath: string): Promise<BlueprintReviewView> {
    const context = await this.sources.context(rootPath)
    const updates = await this.reading.readSaved(context)
    return { ...this.store.read(context), updates, sourceComplete: false, sourcesPending: true,
      activities: [...this.running.values()].filter(run => run.contextKey === reviewContextKey(context)).map(run => run.activity) }
  }
  private async readCurrent(rootPath: string, signal: AbortSignal) {
    const context = await abortableRead(this.sources.context(rootPath), signal)
    await abortableRead(this.automatic.restoreRetries(context, signal), signal)
    signal.throwIfAborted()
    this.automatic.watch(context.workspacePath)
    const observedEpoch = this.reading.observationEpoch
    const { snapshot, ...view } = await this.suggestions.readWithSnapshot(context, signal)
    signal.throwIfAborted()
    const reading = await this.reading.read(context, snapshot, signal, observedEpoch).then(updates => ({ updates, updatesError: '' }))
      .catch(error => ({ updates: undefined, updatesError: error instanceof Error ? error.message : String(error) }))
    signal.throwIfAborted()
    const automatic = this.automatic.activity(context.workspacePath)
    return { ...view, ...reading, structure: snapshot.structure, context, automatic: automatic?.context && reviewContextKey(automatic.context) !== reviewContextKey(context) ? undefined : structuredClone(automatic), activityRevision: this.activityRevision,
      activities: [...this.running.values()].filter(run => run.contextKey === reviewContextKey(context)).map(run => run.activity) }
  }
  async run(rootPath: string, noteId: string, prepared?: ReviewInput, signal?: AbortSignal, reviewSources?: GitReviewSources) {
    if (this.stopping) throw new Error('Note review is shutting down')
    const context = await this.sources.context(rootPath)
    const key = reviewContextKey(context) + ':' + noteId
    if (prepared && reviewContextKey(prepared.context) !== reviewContextKey(context)) throw new Error('Automatic review branch changed')
    if (this.stopping) throw new Error('Note review is shutting down')
    if (this.running.has(key)) throw new Error('This Note is already being reviewed')
    const controller = new AbortController()
    let finish!: () => void
    const finished = new Promise<void>(resolve => { finish = resolve })
    const current = { root: context.workspacePath, contextKey: reviewContextKey(context), controller, activity: { noteId, phase: 'structure', trigger: prepared ? 'automatic' : 'manual' } as ReviewActivity, finished }
    this.running.set(key, current)
    this.activityChanged(context.workspacePath)
    try {
      const result = await this.engine.review(context, noteId, await this.settings.read(), signal ? AbortSignal.any([signal, controller.signal]) : controller.signal, phase => {
        current.activity = { ...current.activity, phase }
        if (prepared) this.automatic.phase(context.workspacePath, noteId, phase)
        this.activityChanged(context.workspacePath)
      }, prepared, reviewSources)
      // Publish committed findings before scheduler bookkeeping or another full source scan.
      this.resultsChanged(context)
      if (!prepared) await this.automatic.manualSucceeded(context, noteId, result)
      return result
    }
    catch (error) {
      this.resultsChanged(context)
      if (!prepared) await this.automatic.manualFailed(context, noteId, error, current.activity.phase, this.store.read(context).items.find(item => item.noteId === noteId)?.source)
      throw error
    }
    finally { if (this.running.get(key) === current) this.running.delete(key); this.activityChanged(context.workspacePath); finish() }
  }
  async cancel(rootPath: string, noteId: string): Promise<void> {
    const context = await this.sources.context(rootPath)
    this.running.get(reviewContextKey(context) + ':' + noteId)?.controller.abort(new Error('Review cancelled'))
  }
  async close(context: ReviewContext, noteId: string, reportRevision: number, findingIds: string[]) {
    const result = await this.suggestions.close(context, noteId, reportRevision, findingIds)
    this.resultsChanged(context)
    return result
  }
  async shutdown(): Promise<void> {
    this.stopping = true
    this.reads.close()
    for (const run of this.running.values()) run.controller.abort(new Error('Review interrupted by shutdown'))
    await this.automatic.shutdown()
    await Promise.all([...this.running.values()].map(run => run.finished))
    await this.engine.shutdown()
    this.sources.notes.unwatchAll()
    this.store.close()
    this.activityListeners.clear()
    this.resultListeners.clear()
  }
}

