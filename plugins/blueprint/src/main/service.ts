// Note: .agents/notes/workbench/plugin-contract-v1.md - the host validates each workspace context.
import { randomUUID } from 'node:crypto'
import { readMarkdownView } from '@janus-agent/harness-core'
import { join, resolve } from 'node:path'
import { realpath } from 'node:fs/promises'
import { AsyncLocalStorage } from 'node:async_hooks'
import { z } from 'zod'
import { NativeServiceError, SerialQueue, type NativePeer, type NativePluginImplementation } from '@janusx/plugin-sdk/native'
import type { JsonValue, NativeAgentProgress } from '@janusx/plugin-sdk'
import { BlueprintNoteService } from './notes/service'
import { BlueprintReviewRuntime } from './blueprint/review/service'
import { WorkspaceSuggestionSources } from './blueprint/suggestions/sources'
import { BlueprintNativeModels, json } from './blueprint/review/native-models'
import { blueprintServiceContextSchema, nativeProjectSchema, type BlueprintJob } from '../shared/native-contract'
import { reviewContextSchema, reviewPathSchema } from '../shared/blueprint-review'
import { blueprintReviewSettingsSchema } from '../shared/blueprint-review-settings'
import { noteRepairInputSchema } from '../shared/note-repair'
import { ReviewWorkspaceTracker } from './blueprint/review/workspace-tracker'
import { nativeMaintenance } from './janus/maintenance/native-service'
import { nativeRepairRequest, runNativeRepair } from './blueprint/review/native-repair'
import { callNoteMcp } from './blueprint/mcp/native-runtime'
import { WorkspaceBlueprintService } from './notes/workspace-blueprint'
import { BlueprintDiscussion, discussionRequest } from './blueprint/discussion'
import { migrateLegacyData } from './legacy-data'
import { GraphTransfers } from './graph-transfer'
import { LegacyBlueprints } from './notes/legacy-blueprints'

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/)
const key = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path)
const requestSchema = z.object({ project: nativeProjectSchema.nullable(), input: z.unknown(), instanceId: z.string().uuid().optional() }).strict()
const nodeId = z.string().min(1).max(256)
const layoutSchema = z.object({ canvasLayout: z.record(nodeId, z.object({ x: z.number().finite(), y: z.number().finite() }).strict()).optional(), collapsedNodeIds: z.array(nodeId).max(10000).nullable().optional() }).strict()

/** The host stamps the project on each call; renderer-supplied paths never select a workspace. */
export async function createBlueprintService(raw: JsonValue, host: Pick<NativePeer, 'call' | 'emit'>): Promise<NativePluginImplementation> {
  const context = blueprintServiceContextSchema.parse(raw)
  const migration = await migrateLegacyData(context)
  const notes = new BlueprintNoteService()
  const graphs = new GraphTransfers()
  const workspace = new WorkspaceBlueprintService(notes)
  const legacy = new LegacyBlueprints(context.directory, notes)
  const requestOwner = new AsyncLocalStorage<string>()
  const owners = new Map<string, { controller: AbortController; watched: Set<string>; identity: number }>()
  let nextOwner = 0
  const owner = () => {
    const id = requestOwner.getStore() ?? 'host'
    let scope = owners.get(id)
    if (!scope) { scope = { controller: new AbortController(), watched: new Set(), identity: ++nextOwner }; owners.set(id, scope) }
    return scope
  }
  const roots = new Map(context.projects.map(project => [key(project.root), project.id]))
  const projectId = (root: string) => {
    const value = roots.get(key(root))
    if (!value) throw new NativeServiceError('PATH_NOT_GRANTED')
    return value
  }
  let stopping = false
  const lifetime = new AbortController()
  const emit = (name: string, value: unknown, root?: string) => {
    if (!stopping) host.emit(name, json({ scope: root ? { projectId: projectId(root), root } : null, data: value }))
  }
  const models = new BlueprintNativeModels(host, projectId)
  const review = new BlueprintReviewRuntime(join(context.directory, 'review'), models, new WorkspaceSuggestionSources(notes))
  const discussion = new BlueprintDiscussion(join(context.directory, 'discussions'), notes, review.sources, models)
  const tracker = new ReviewWorkspaceTracker(root => review.sources.context(root), async context => {
    review.automatic.watch(context.workspacePath); await review.reading.read(context)
  }, root => review.automatic.unwatch(root))
  const unlisten = [review.onActivityChanged(update => emit('review.activity', update, update.root)),
    review.onResultsChanged(update => emit('review.results', update, update.context.workspacePath)),
    notes.onChange(event => emit('notes.changed', event, event.root))]
  const watched = new Set<string>(), watchQueue = new SerialQueue()
  const syncWatchers = () => watchQueue.run(async () => {
    notes.unwatchAll()
    for (const root of watched) { if (stopping) break; await notes.watch(root) }
    if (stopping) notes.unwatchAll()
  })
  const jobs = new Map<string, { view: BlueprintJob; controller: AbortController; finished: Promise<void>; created: number }>()
  const readingUndoRoots = new Map<string, { root: string; expires: number }>()
  const startJob = (root: string, method: string, work: (signal: AbortSignal, progress: (value: NativeAgentProgress) => void) => Promise<unknown>) => {
    const ownerSignal = owner().controller.signal
    ownerSignal.throwIfAborted()
    for (const [id, job] of jobs) if (job.view.status !== 'running' && Date.now() - job.created > 15 * 60_000) jobs.delete(id)
    if ([...jobs.values()].filter(job => job.view.status === 'running').length >= 4 || jobs.size >= 128) throw new NativeServiceError('RATE_LIMITED')
    const id = randomUUID(), controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, ownerSignal, lifetime.signal])
    const job = { view: { id, root, method, status: 'running' } as BlueprintJob, controller, finished: Promise.resolve(), created: Date.now() }
    jobs.set(id, job)
    emit('job.changed', job.view, root)
    job.finished = Promise.resolve().then(() => { signal.throwIfAborted(); return work(signal, progress => {
      if (!signal.aborted && job.view.status === 'running') job.view = { ...job.view, progress }
    }) }).then(result => {
      job.view = { ...job.view, status: signal.aborted ? 'cancelled' : 'completed', ...(!signal.aborted ? { result } : {}) }
    }, cause => {
      job.view = { ...job.view, status: signal.aborted ? 'cancelled' : 'failed', error: cause instanceof NativeServiceError ? cause.code : 'BLUEPRINT_OPERATION_FAILED' }
    }).finally(() => emit('job.changed', job.view, root))
    return { id }
  }
  const requireJob = (value: unknown, root: string) => {
    const job = jobs.get(id.parse(value))
    if (!job || key(job.view.root) !== key(root)) throw new NativeServiceError('PATH_NOT_GRANTED')
    return job
  }
  // Note: each actual worktree owns its maintenance state and immutable root binding;
  // see .agents/notes/planning/blueprint-official-plugin.md#worktree-显示切换.
  const maintenance = new Map<string, ReturnType<typeof nativeMaintenance>>()
  const maintenanceFor = (project: z.infer<typeof nativeProjectSchema>) => {
    const checkout = project.id + '\0' + key(project.root)
    let service = maintenance.get(checkout)
    if (!service) {
      service = nativeMaintenance({ directory: context.directory, notes, host, projects: () => [project], job: startJob,
        changed: task => emit('maintenance.changed', { task }, task.workspacePath) })
      maintenance.set(checkout, service)
    }
    return service
  }
  const releaseRoot = async (root: string) => {
    if (![...owners.values()].some(scope => scope.watched.has(root))) {
      tracker.track(root, false); watched.delete(root); await syncWatchers()
    }
  }
  const call: NativePluginImplementation['call'] = async (method, value, signal) => {
      if (stopping) throw new NativeServiceError('SERVICE_STOPPED')
      if (method === 'agent.tool') return models.tool(value)
      if (method === 'agent.progress') return models.progress(value)
      const request = requestSchema.parse(value), input = request.input
      const scopeSignal = AbortSignal.any([signal, lifetime.signal, owner().controller.signal])
      scopeSignal.throwIfAborted()
      // Application configuration has no file target and can be read from the settings view.
      switch (method) {
        case 'migration.status': return json(migration)
        case 'mcp.status': case 'mcp.change': case 'mcp.probe': case 'mcp.guide': return json(await callNoteMcp(host, method, input, scopeSignal))
        case 'settings.read': return json(await review.settings.read())
        case 'settings.snapshot': return json(await review.settings.snapshot())
        case 'settings.update': {
          const args = z.object({ value: blueprintReviewSettingsSchema, expectedRevision: hash }).strict().parse(input)
          const settings = await review.settings.update(args.value, args.expectedRevision)
          review.configurationChanged(settings); await review.automatic.settingsChanged(); return json(settings)
        }
        case 'settings.check': return json(await models.check(await review.settings.read(), scopeSignal))
        case 'settings.credential-status': return host.call('models.credential-status', { slot: 'jev' }, scopeSignal)
        case 'settings.credential-set': {
          const args = z.object({ value: z.string().max(4096).regex(/^[\x21-\x7e]*$/) }).strict().parse(input)
          return host.call('models.credential-set', { slot: 'jev', value: args.value }, scopeSignal)
        }
        case 'models.catalog': return host.call('models.catalog', null, scopeSignal)
      }
      const project = request.project
      if (!project) throw new NativeServiceError('PATH_NOT_GRANTED')
      const root = await realpath(project.root)
      scopeSignal.throwIfAborted()
      roots.set(key(root), project.id)
      if (method.startsWith('maintenance.')) {
        const checkout = { ...project, root }
        return maintenanceFor(checkout).call(method, json(input), checkout, scopeSignal)
      }
      const checkedContext = (value: unknown) => {
        const current = reviewContextSchema.parse(value)
        if (key(current.workspacePath) !== key(root)) throw new NativeServiceError('PATH_NOT_GRANTED')
        return current
      }
      switch (method) {
        case 'legacy.list': return json(await legacy.list())
        case 'legacy.preview': return json(await legacy.preview(root, z.string().min(1).max(128).parse(input), owner().identity, scopeSignal))
        case 'legacy.apply': return json(await legacy.apply(root, id.parse(input), owner().identity, scopeSignal))
        case 'workspace.activate': {
          if ((await workspace.status(root)).state !== 'ok') return null
          scopeSignal.throwIfAborted()
          if (owner().watched.has(root)) return null
          owner().watched.add(root); tracker.track(root, true); watched.add(root); await syncWatchers(); return null
        }
        case 'workspace.release': owner().watched.delete(root); await releaseRoot(root); return null
        case 'workspace.status': return json(await workspace.status(root))
        case 'workspace.init-preview': return json(await workspace.preview(root, z.string().min(1).max(200).parse(input), owner().identity))
        case 'workspace.init-apply': {
          const args = z.object({ id, confirmForeign: z.boolean() }).strict().parse(input)
          return json(await workspace.apply(root, args.id, owner().identity, args.confirmForeign))
        }
        case 'workspace.init-undo': return json(await workspace.undo(root, id.parse(input), owner().identity))
        case 'blueprint.graph': return json(await notes.projectView(root))
        case 'blueprint.graph-open': {
          const graph = await notes.projectView(root)
          scopeSignal.throwIfAborted()
          return graphs.open(key(root), owner().identity, graph)
        }
        case 'blueprint.graph-part': {
          const args = z.object({ id, index: z.number().int().nonnegative() }).strict().parse(input)
          return graphs.part(key(root), owner().identity, args.id, args.index)
        }
        case 'blueprint.graph-close': graphs.close(key(root), owner().identity, id.parse(input)); return null
        case 'blueprint.layout': await notes.saveUiState(root, layoutSchema.parse(input)); return null
        case 'notes.snapshot': return json(await notes.readSnapshot(root))
        case 'notes.read': {
          const source = await notes.readNote(root, z.string().regex(/^note:\/\/[a-f\d-]+\/[a-f\d-]+$/i).parse(input))
          return json({ ...source, view: readMarkdownView(source.note.body) })
        }
        case 'notes.rescan': return json(await notes.rescan(root))
        case 'discussion.read': return json(await discussion.read(root))
        case 'discussion.clear': return json(await discussion.clear(root, z.number().int().nonnegative().parse(input)))
        case 'discussion.run': {
          const args = discussionRequest.parse(input)
          return startJob(root, method, (signal, progress) => discussion.run(root, args, signal, progress))
        }
        case 'review.activity': return json(await review.activityRead(root))
        case 'review.read': return json(await review.read(root))
        case 'review.saved': return json(await review.readSaved(root))
        case 'review.run': { const noteId = id.parse(input); return startJob(root, method, signal => review.run(root, noteId, undefined, signal)) }
        case 'review.cancel': await review.cancel(root, id.parse(input)); return null
        case 'review.close': {
          const args = z.object({ context: reviewContextSchema, noteId: id, revision: z.number().int().nonnegative(), findingIds: z.array(id).min(1).max(200) }).strict().parse(input)
          return json(await review.close(checkedContext(args.context), args.noteId, args.revision, args.findingIds))
        }
        case 'reading.mark': {
          const args = z.object({ context: reviewContextSchema, versions: z.array(z.object({ noteId: id, hash, path: reviewPathSchema }).strict()).min(1).max(10000), bulk: z.boolean() }).strict().parse(input)
          const result = await review.reading.mark(checkedContext(args.context), args.versions, args.bulk)
          for (const [token, undo] of readingUndoRoots) if (undo.expires < Date.now()) readingUndoRoots.delete(token)
          if (result.undoToken) readingUndoRoots.set(result.undoToken, { root, expires: result.expiresAt! })
          emit('reading.changed', result, root); return json(result)
        }
        case 'reading.undo': {
          const token = id.parse(input), undo = readingUndoRoots.get(token)
          if (!undo || key(undo.root) !== key(root) || undo.expires < Date.now()) throw new NativeServiceError('PATH_NOT_GRANTED')
          const result = await review.reading.revert(token); readingUndoRoots.delete(token)
          emit('reading.changed', result, root); return json(result)
        }
        case 'repair.prepare': {
          const args = noteRepairInputSchema.parse(input); checkedContext(args.context)
          return json(await review.repairs.prepare(args))
        }
        case 'repair.run': {
          const args = nativeRepairRequest.parse(input)
          return startJob(root, method, signal => runNativeRepair(review.repairs, models, review.sources, args, root, signal,
            update => emit('repair.changed', update, root)))
        }
        case 'repair.diff': case 'repair.retry': case 'repair.undo': {
          const repairId = id.parse(input)
          checkedContext(await review.repairs.contextFor(repairId, method === 'repair.retry' ? 'status' : 'receipt'))
          if (method === 'repair.diff') return json(await review.repairs.diff(repairId))
          return startJob(root, method, signal => method === 'repair.retry' ? review.repairs.retryReview(repairId, signal) : review.repairs.undo(repairId, signal))
        }
        case 'jobs.read': return json(requireJob(input, root).view)
        case 'jobs.cancel': requireJob(input, root).controller.abort(); return null
        default: throw new NativeServiceError('UNKNOWN_METHOD')
      }
    }
  return {
    async call(method, value, signal) {
      try {
        if (method === 'agent.tool' || method === 'agent.progress') return await call(method, value, signal)
        const request = requestSchema.parse(value)
        return await requestOwner.run(request.instanceId ?? 'host', () => call(method, value, signal))
      } catch (cause) {
        if (cause instanceof z.ZodError) throw new NativeServiceError('INVALID_REQUEST')
        if ((cause as { code?: string })?.code === 'CONFLICT') throw new NativeServiceError('RESOURCE_CHANGED')
        if ((cause as { code?: string })?.code === 'BUSY') throw new NativeServiceError('RATE_LIMITED')
        throw cause
      }
    },
    async releaseContext(id) {
      const scope = owners.get(id)
      if (!scope) return
      scope.controller.abort(); owners.delete(id); workspace.release(scope.identity)
      legacy.release(scope.identity)
      graphs.release(scope.identity)
      for (const root of scope.watched) await releaseRoot(root)
    },
    async stop() {
      if (stopping) return
      stopping = true; lifetime.abort(); tracker.stop()
      for (const service of maintenance.values()) service.close()
      maintenance.clear()
      for (const unsubscribe of unlisten) unsubscribe()
      for (const job of jobs.values()) job.controller.abort()
      await Promise.all([...jobs.values()].map(job => job.finished))
      watched.clear(); await syncWatchers()
      await review.shutdown(); notes.unwatchAll()
      jobs.clear(); readingUndoRoots.clear(); roots.clear()
      graphs.clear()
      for (const scope of owners.values()) { scope.controller.abort(); workspace.release(scope.identity); legacy.release(scope.identity) }
      owners.clear()
    },
  }
}
