// Note: .agents/notes/workbench/plugin-contract-v1.md — local development lifecycle and broker.
import { randomUUID, createHash } from 'node:crypto'
import { readFile, mkdir, writeFile, rm, realpath } from 'node:fs/promises'
import { watch, type FSWatcher } from 'node:fs'
import { join, resolve, relative, isAbsolute, sep } from 'node:path'
import { z } from 'zod'
import { PluginError, PLUGIN_API_VERSION, PLUGIN_CAPABILITIES, parsePluginManifest, validatePluginCall,
  isSensitivePluginPath, matchesPluginViewer, type PluginDocument, type JsonValue, type PluginContext, type PluginStoredValue, type PluginIslandStatus, type PluginSettingValue } from '@janusx/plugin-sdk'
import type { InstalledPlugin, PluginHostSnapshot, PluginLog, PluginMount, PluginIslandEntry } from '../../shared/ipc/plugins'
import { SerialQueue, writeFileAtomic } from '../lib/atomic-file'
import { readPluginFile, readPluginPackage, type PluginPackage } from './files'
import { PluginStorage } from './storage'
import { PluginConfigurationStore } from './configuration'
import type { PluginManageRequest } from '../../shared/ipc/plugins'
import { PluginCredentials, PluginNetwork, type PluginEncryption, type PluginNetworkTransport } from './network'
import { PluginBackground, type BackgroundIdentity } from './background'
import { PluginModels, type PluginModelBackend } from './models'
import { serviceCallSchema, type PluginMessage, type PluginNetworkRequest, type PluginAgentService, type PluginTaskRun } from '@janusx/plugin-sdk'
import { pluginSkillReadSchema, pluginWorkflowRunSchema, type PluginAgentSkill, type PluginAgentSkillCatalog, type PluginAgentSkillResource, type PluginAgentWorkflow, type PluginAgentWorkflowCatalog } from '@janusx/plugin-sdk'

interface RecordData extends InstalledPlugin { packageDirectory: string; grant: string }
interface Instance {
  id: string; plugin: string; view: string; binding: string; token: string; generation: string; url: string
  root: string | null; scope: string; context: PluginContext; bound: boolean; ready: boolean
  requests: Map<string, { cancelled: boolean }>; used: Set<string>; times: number[]; timer: ReturnType<typeof setTimeout>
  subscriptions: Map<string, { kind: 'storage'; keys: string[] } | { kind: 'context' | 'configuration' }>
}
export interface PluginServiceDeps {
  directory: string
  encryption?: PluginEncryption
  networkTransport?: PluginNetworkTransport
  modelBackend?: PluginModelBackend
  protectedDirectories?: string[]
  resolveProject(id: string, scopePath: string | null): Promise<{ root: string; name: string }>
  changed(): void
  closed?(instanceId: string): void
  event(instanceId: string, packet: JsonValue): void
  openView(pluginId: string, viewId: string): void
  toast(pluginId: string, message: string, level: string): void
}
const requestSchema = z.object({ protocol: z.literal(1), type: z.literal('request'), requestId: z.string().min(1).max(128),
  method: z.string().max(128), params: z.unknown(), contextRevision: z.number().int().nonnegative() }).strict()
const cancelSchema = z.object({ protocol: z.literal(1), type: z.literal('cancel'), requestId: z.string().min(1).max(128) }).strict()
const permissionFingerprint = (manifest: InstalledPlugin['manifest']) => createHash('sha256').update(JSON.stringify(manifest.contributes.skills || manifest.contributes.tasks || manifest.contributes.credentials || manifest.contributes.events || manifest.contributes.services || manifest.contributes.consumes
  ? { permissions: manifest.permissions, contributes: manifest.contributes }
  : manifest.contributes.configurationViews
  ? { permissions: manifest.permissions, viewers: manifest.contributes.viewers ?? [], configurationViews: manifest.contributes.configurationViews }
  : manifest.contributes.viewers?.length ? { permissions: manifest.permissions, viewers: manifest.contributes.viewers } : manifest.permissions)).digest('hex')
const error = (code: ConstructorParameters<typeof PluginError>[0], message: string): never => { throw new PluginError(code, message) }

export class PluginService {
  private records = new Map<string, RecordData>()
  private activations = new WeakMap<RecordData, number>()
  private packages = new Map<string, PluginPackage>()
  private instances = new Map<string, Instance>()
  private recoveryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private logs: PluginLog[] = []
  private developmentMode = false
  private queue = new SerialQueue()
  private watchers = new Map<string, { watchers: FSWatcher[]; timer?: ReturnType<typeof setTimeout> }>()
  private toasts = new Map<string, number[]>()
  private configurationOpens = new Map<string, number>()
  private island = new Map<string, PluginIslandEntry>()
  private islandTimes = new Map<string, number[]>()
  private islandTimer?: ReturnType<typeof setTimeout>
  private current = { projectId: null as string | null, root: null as string | null, revision: 0, locale: 'en', theme: { id: '', tokens: {} as Record<string, string> } }
  private storage: PluginStorage
  private configuration: PluginConfigurationStore
  private initialized: Promise<void> | undefined
  private credentials: PluginCredentials
  private network: PluginNetwork
  private background: PluginBackground
  private contextSequence = 0
  private selectionKey = ''
  private pendingEvents = new Map<string, { instance: Instance; subscriptionId: string; values: Record<string, PluginStoredValue> }>()
  private eventTimer?: ReturnType<typeof setTimeout>
  private documentEdits = new Map<string, { instance: Instance; valid(): void; finish(applied: boolean): void }>()
  constructor(private deps: PluginServiceDeps) {
    this.storage = new PluginStorage(join(deps.directory, 'data'))
    this.configuration = new PluginConfigurationStore(join(deps.directory, 'configuration'))
    this.credentials = new PluginCredentials(join(deps.directory, 'credentials'), deps.encryption)
    this.network = new PluginNetwork(this.credentials, deps.networkTransport)
    this.background = new PluginBackground({ network: this.network, models: new PluginModels(deps.modelBackend), identity: (plugin, source) => this.backgroundIdentity(plugin, source.projectId, source.scope), changed: () => this.publish() })
  }
  initialize(): Promise<void> { return this.initialized ??= this.restore() }
  private async restore(): Promise<void> {
    let saved: { developmentMode: boolean; plugins: RecordData[] }
    try { saved = JSON.parse(await readFile(join(this.deps.directory, 'registry.json'), 'utf8')) } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return
      error('STORAGE_UNAVAILABLE', 'Plugin registry is unavailable.')
    }
    if (typeof saved!.developmentMode !== 'boolean' || !Array.isArray(saved!.plugins)) error('STORAGE_UNAVAILABLE', 'Plugin registry is invalid.')
    this.developmentMode = saved!.developmentMode
    for (const raw of saved!.plugins) {
      // Never turn corrupt persisted data into executable contributions.
      try {
        const manifest = parsePluginManifest(JSON.stringify(raw.manifest))
        if (!raw.source || !['linked', 'copied'].includes(raw.source.kind) || typeof raw.source.directory !== 'string'
          || typeof raw.packageDirectory !== 'string' || !Array.isArray(raw.projects) || raw.projects.some(id => typeof id !== 'string')
          || typeof raw.enabled !== 'boolean' || typeof raw.grant !== 'string' || this.records.has(manifest.id)) throw new Error('Invalid record')
        const record: RecordData = { ...raw, manifest, failures: 0, state: 'disabled' }
        this.records.set(manifest.id, record)
        try {
          const pkg = await readPluginPackage(record.packageDirectory, record.source.kind === 'linked' ? record.source.directory : undefined)
          if (pkg.manifest.id !== manifest.id) error('MANIFEST_INVALID', 'Plugin identity changed.')
          record.manifest = pkg.manifest
          record.digest = pkg.digest
          this.packages.set(manifest.id, pkg)
          if (record.enabled && this.developmentMode && record.grant === permissionFingerprint(pkg.manifest)) record.state = 'ready'
          else if (record.enabled) { record.state = 'blocked'; record.error = this.developmentMode ? 'PERMISSION_RECONFIRM_REQUIRED' : 'DEVELOPMENT_MODE_REQUIRED' }
          this.watchSource(record)
        } catch { record.state = 'error'; record.error = 'SOURCE_UNAVAILABLE' }
      } catch { this.log('MANIFEST_INVALID') }
    }
  }
  snapshot(): PluginHostSnapshot {
    return { developmentMode: this.developmentMode, plugins: [...this.records.values()].map(({ packageDirectory: _directory, grant: _grant, ...record }) => {
      const pages = [...this.instances.values()].filter(instance => instance.plugin === record.manifest.id)
      if (record.enabled && !['blocked', 'error'].includes(record.state)) {
        try { this.requiredDependencies(record.manifest) } catch { record.state = 'blocked'; record.error = 'DEPENDENCY_UNAVAILABLE' }
      }
      return { ...structuredClone(record), runtime: { pages: pages.length, connected: pages.filter(page => page.bound).length, ready: pages.filter(page => page.ready).length } }
    }), logs: [...this.logs], island: structuredClone([...this.island.values()]), tasks: this.background.list() }
  }
  private async persist(): Promise<void> {
    try { await writeFileAtomic(join(this.deps.directory, 'registry.json'), JSON.stringify({ developmentMode: this.developmentMode, plugins: [...this.records.values()] })) }
    catch { error('STORAGE_UNAVAILABLE', 'Plugin registry could not be saved.') }
  }
  log(code: string, details: Omit<PluginLog, 'time' | 'code'> = {}): void {
    this.logs.push({ time: new Date().toISOString(), code, ...details })
    if (this.logs.length > 500) this.logs.shift()
  }
  private publish(): void { this.deps.changed() }
  setDevelopment(enabled: boolean): Promise<void> {
    return this.queue.run(async () => {
      // Fail closed immediately, even if persistence is unavailable.
      this.developmentMode = enabled
      if (!enabled) for (const record of this.records.values()) this.disableRecord(record, 'DEVELOPMENT_MODE_REQUIRED')
      try { await this.persist() } finally { this.publish() }
    })
  }
  import(directory: string, kind: 'linked' | 'copied'): Promise<void> {
    return this.queue.run(async () => {
      const pkg = await readPluginPackage(directory)
      if (this.records.has(pkg.manifest.id)) error('DUPLICATE_PLUGIN', 'Plugin is already installed.')
      const packageDirectory = kind === 'linked' ? pkg.directory : join(this.deps.directory, 'packages', randomUUID())
      try { if (kind === 'copied') {
        await mkdir(packageDirectory, { recursive: true })
        for (const [path, bytes] of pkg.files) {
          const target = join(packageDirectory, path)
          await mkdir(join(target, '..'), { recursive: true })
          await writeFile(target, bytes, { flag: 'wx' })
        }
      } } catch (cause) { await rm(packageDirectory, { recursive: true, force: true }); throw cause }
      const record: RecordData = { manifest: pkg.manifest, source: { kind, directory: pkg.directory }, packageDirectory,
        digest: pkg.digest, enabled: false, projects: [], grant: '', state: 'disabled', failures: 0 }
      this.records.set(pkg.manifest.id, record)
      try { await this.persist() } catch (cause) {
        this.records.delete(pkg.manifest.id)
        if (kind === 'copied') await rm(packageDirectory, { recursive: true, force: true })
        throw cause
      }
      this.packages.set(pkg.manifest.id, pkg)
      this.watchSource(record)
      this.log('IMPORTED', { pluginId: pkg.manifest.id })
      this.publish()
    })
  }
  enable(id: string, projects: string[]): Promise<void> {
    return this.queue.run(async () => {
      const record = this.record(id)
      if (!this.developmentMode) error('DEVELOPMENT_MODE_REQUIRED', 'Enable local development mode first.')
      const pkg = await readPluginPackage(record.packageDirectory, record.source.kind === 'linked' ? record.source.directory : undefined)
      if (pkg.manifest.id !== id) error('MANIFEST_INVALID', 'Plugin identity changed.')
      for (const project of projects) await this.deps.resolveProject(project, null)
      this.requiredDependencies(pkg.manifest)
      const old = { ...record }
      record.manifest = pkg.manifest; record.digest = pkg.digest; record.projects = [...new Set(projects)]
      record.grant = permissionFingerprint(pkg.manifest); record.enabled = true; record.failures = 0; record.state = 'ready'; delete record.error
      this.revokePlugin(id)
      try { await this.persist() } catch (cause) { Object.assign(record, old); record.enabled = false; record.state = 'disabled'; this.publish(); throw cause }
      this.packages.set(id, pkg)
      this.log('ENABLED', { pluginId: id }); this.publish()
    })
  }
  disable(id: string): Promise<void> {
    return this.queue.run(async () => { this.disableRecord(this.record(id)); try { await this.persist() } finally { this.publish() } })
  }
  private disableRecord(record: RecordData, reason?: string): void {
    this.revokePlugin(record.manifest.id)
    record.enabled = false; record.state = 'disabled'; record.error = reason
  }
  reload(id: string, force = false): Promise<void> {
    return this.queue.run(async () => {
      const record = this.record(id)
      try {
        const pkg = await readPluginPackage(record.packageDirectory, record.source.kind === 'linked' ? record.source.directory : undefined)
        if (pkg.manifest.id !== id) error('MANIFEST_INVALID', 'Plugin identity changed.')
        const unchanged = pkg.digest === record.digest
        if (unchanged && record.state !== 'error' && !force) { this.watchSource(record); return }
        this.revokePlugin(id, unchanged && force ? 'reload' : undefined)
        record.manifest = pkg.manifest; record.digest = pkg.digest
        this.packages.set(id, pkg)
        if (record.grant !== permissionFingerprint(pkg.manifest)) { record.state = 'blocked'; record.error = 'PERMISSION_RECONFIRM_REQUIRED' }
        else { record.state = record.enabled && this.developmentMode ? 'ready' : 'disabled'; delete record.error }
        await this.persist()
        this.watchSource(record)
        this.log('RELOADED', { pluginId: id })
      } catch (cause) {
        this.revokePlugin(id); record.state = 'error'; record.error = cause instanceof PluginError ? cause.code : 'SOURCE_UNAVAILABLE'
        this.log(record.error, { pluginId: id }); throw cause
      } finally { this.publish() }
    })
  }
  uninstall(id: string): Promise<void> {
    return this.queue.run(async () => {
      const record = this.record(id)
      this.disableRecord(record)
      this.stopWatch(id)
      this.records.delete(id)
      try { await this.persist() } catch (cause) { this.records.set(id, record); this.publish(); throw cause }
      this.packages.delete(id)
      // Only delete an owned, UUID-named copied package; linked sources never get removed.
      if (record.source.kind === 'copied' && /^[a-f0-9-]{36}$/.test(relative(resolve(this.deps.directory, 'packages'), resolve(record.packageDirectory)))) {
        await rm(record.packageDirectory, { recursive: true, force: true })
      }
      this.log('UNINSTALLED', { pluginId: id }); this.publish()
    })
  }
  async setContext(projectId: string | null, scopePath: string | null, locale: string, theme: { id: string; tokens: Record<string, string> }): Promise<void> {
    const sequence = ++this.contextSequence
    // Revoke before asynchronous root resolution, including worktree changes.
    const selectionKey = JSON.stringify([projectId, scopePath])
    if (this.selectionKey !== selectionKey) {
      this.background.revoke(undefined, true)
      this.selectionKey = selectionKey
      this.current.revision++
      for (const instance of [...this.instances.values()]) if (instance.root) this.close(instance.id)
      this.current.root = null
    }
    const project = projectId ? await this.deps.resolveProject(projectId, scopePath) : null
    if (sequence !== this.contextSequence) return
    if (this.current.projectId !== projectId || this.current.root !== (project?.root ?? null)) {
      this.current.revision++
      for (const instance of [...this.instances.values()]) if (instance.root) this.close(instance.id)
    }
    this.current = { ...this.current, projectId, root: project?.root ?? null, locale, theme }
    for (const instance of this.instances.values()) for (const [subscriptionId, sub] of instance.subscriptions) if (sub.kind === 'context') {
      this.send(instance, { type: 'event', subscriptionId, event: 'context', payload: { locale, theme } })
    }
  }
  async mount(id: string, viewId: string, projectId: string | null, scopePath: string | null, document?: PluginDocument): Promise<PluginMount> {
    const record = this.record(id)
    this.allowed(record)
    const digest = record.digest
    const activation = this.activations.get(record) ?? 0
    const revision = this.current.revision
    const view = record.manifest.contributes.views.find(view => view.id === viewId)
    if (!view) error('INVALID_REQUEST', 'View is unavailable.')
    if (document) {
      const viewer = record.manifest.contributes.viewers?.find(item => item.id === document.viewer && item.view === viewId)
      if (!viewer || !matchesPluginViewer(viewer, document.path)) error('PATH_NOT_GRANTED', 'File does not match the declared viewer.')
    }
    const project = view!.scope === 'project' && projectId ? await this.deps.resolveProject(projectId, scopePath) : null
    if (document) {
      if (!project) error('CONTEXT_UNAVAILABLE', 'Document viewers require a project.')
      await this.readText(project!.root, document.path)
    }
    this.allowed(record)
    if (this.records.get(id) !== record || record.digest !== digest || (this.activations.get(record) ?? 0) !== activation
      || this.current.revision !== revision) error('STALE_CONTEXT', 'Context changed while mounting.')
    if (view!.scope === 'project' && (!project || !record.projects.includes(projectId!)
      || this.current.projectId !== projectId || this.current.root !== project.root)) error('CONTEXT_UNAVAILABLE', 'Project scope is unavailable.')
    if (this.instances.size >= 64 || [...this.instances.values()].filter(instance => instance.plugin === id).length >= 8) error('RATE_LIMITED', 'Too many plugin pages.')
    const scope = project ? `${projectId}:${createHash('sha256').update(project.root).digest('hex')}` : 'application'
    const documentKey = document ? JSON.stringify([document.viewer, process.platform === 'win32' ? document.path.toLowerCase() : document.path]) : ''
    const existing = [...this.instances.values()].find(instance => instance.plugin === id && instance.view === viewId && instance.scope === scope
      && (instance.context.document ? JSON.stringify([instance.context.document.viewer, process.platform === 'win32' ? instance.context.document.path.toLowerCase() : instance.context.document.path]) : '') === documentKey)
    if (existing) error('INVALID_REQUEST', 'View already has an instance.')
    const instanceId = randomUUID(); const token = randomUUID(); const generation = randomUUID()
    const context: PluginContext = { project: project ? { projectId: projectId!, rootId: createHash('sha256').update(scope).digest('hex'), name: project.name } : null,
      revision: this.current.revision, active: true, ...(record.manifest.contributes.settings?.length ? { configuration: true as const } : {}),
      ...(record.manifest.capabilities.required.includes('configuration.open') ? { configurationNavigation: true as const } : {}),
      ...(Object.values(record.manifest.contributes.configurationViews ?? {}).includes(viewId) ? { configurationEditor: true as const } : {}),
      ...(document ? { document: { viewer: document.viewer, path: document.path,
        ...(record.manifest.permissions.some(permission => permission.name === 'documents.edit') ? { editable: true } : {}) } } : {}) }
    const instance: Instance = { id: instanceId, plugin: id, view: viewId, binding: randomUUID(), token, generation,
      url: `janusx-plugin://${token}/g/${generation}/${view!.entry}`, root: project?.root ?? null, scope, context, bound: false, ready: false,
      requests: new Map(), used: new Set(), times: [], subscriptions: new Map(),
      timer: setTimeout(() => this.loadFailed(instanceId), 10_000) }
    this.instances.set(instanceId, instance)
    record.state = 'loading'; this.publish()
    return { instanceId, binding: instance.binding, url: instance.url, context }
  }
  bind(id: string, binding: string): string {
    const instance = this.instance(id, binding)
    if (instance.bound) { this.close(id); error('INVALID_SENDER', 'Instance is already bound.') }
    instance.bound = true
    this.publish()
    return instance.url
  }
  inspect(id: string, binding: string): string { return this.instance(id, binding).url }
  failView(id: string, binding: string): void {
    try { this.instance(id, binding) } catch { return }
    this.loadFailed(id)
  }
  closeAll(): void { for (const id of [...this.instances.keys()]) this.close(id) }
  isInstanceUrl(url: string): boolean { return [...this.instances.values()].some(instance => url === instance.url) }
  resource(url: string): { bytes: Buffer; path: string } | null {
    const instance = [...this.instances.values()].find(instance => url.startsWith(`janusx-plugin://${instance.token}/g/${instance.generation}/`))
    if (!instance) return null
    try { this.instance(instance.id, instance.binding) } catch { return null }
    const path = url.slice(`janusx-plugin://${instance.token}/g/${instance.generation}/`.length)
    const bytes = this.packages.get(instance.plugin)?.files.get(path)
    return bytes ? { bytes, path } : null
  }
  frameMatchesResource(frameUrl: string, resourceUrl: string): boolean {
    const instance = [...this.instances.values()].find(instance => instance.url === frameUrl)
    return Boolean(instance && resourceUrl.startsWith(`janusx-plugin://${instance.token}/g/${instance.generation}/`) && this.resource(resourceUrl))
  }
  active(id: string, binding: string, active: boolean): void {
    const instance = this.instance(id, binding)
    instance.context.active = active
    for (const [subscriptionId, sub] of instance.subscriptions) if (sub.kind === 'context') this.send(instance, { type: 'event', subscriptionId, event: 'context', payload: { active } })
  }
  close(id: string, binding?: string, reason?: string): void {
    const instance = this.instances.get(id)
    if (!instance || (binding && instance.binding !== binding)) return
    clearTimeout(instance.timer)
    this.background.closePage(id)
    this.send(instance, { type: 'event', event: 'invalidated', reason: reason ?? null, payload: { invalidated: true } })
    this.instances.delete(id)
    for (const [key, entry] of this.island) if (entry.instanceId === id) this.island.delete(key)
    if (![...this.instances.values()].some(item => item.plugin === instance.plugin && item.ready)) this.clearRecovery(instance.plugin)
    this.deps.closed?.(id)
    for (const request of instance.requests.values()) request.cancelled = true
    for (const edit of this.documentEdits.values()) if (edit.instance === instance) edit.finish(false)
    instance.subscriptions.clear()
    const record = this.records.get(instance.plugin)
    if (record?.enabled && record.state !== 'blocked' && record.state !== 'error') {
      const pages = [...this.instances.values()].filter(item => item.plugin === instance.plugin)
      record.state = pages.some(page => page.ready) ? 'active' : pages.length ? 'loading' : 'ready'
    }
    this.publish()
  }
  private clearRecovery(id: string): void { clearTimeout(this.recoveryTimers.get(id)); this.recoveryTimers.delete(id) }
  private revokePlugin(id: string, reason?: string): void {
    this.background.revoke(id); this.network.revoke(id)
    const record = this.records.get(id)
    if (record) this.activations.set(record, (this.activations.get(record) ?? 0) + 1)
    this.clearRecovery(id)
    for (const instance of [...this.instances.values()]) if (instance.plugin === id) this.close(instance.id, undefined, reason)
  }
  private loadFailed(id: string): void {
    const instance = this.instances.get(id)
    if (!instance) return
    const record = this.record(instance.plugin)
    this.clearRecovery(instance.plugin)
    this.close(id)
    record.failures++; record.state = 'error'; record.error = 'VIEW_LOAD_FAILED'
    this.log('VIEW_LOAD_FAILED', { pluginId: record.manifest.id, instanceId: id })
    if (record.failures >= 3) { this.disableRecord(record, 'VIEW_LOAD_FAILED'); void this.queue.run(() => this.persist()).catch(() => this.log('STORAGE_UNAVAILABLE')) }
    this.publish()
  }
  private send(instance: Instance, packet: Record<string, unknown>): void {
    this.deps.event(instance.id, { protocol: 1, contextRevision: instance.context.revision, ...packet } as JsonValue)
  }
  private instance(id: string, binding: string): Instance {
    const instance = this.instances.get(id)
    if (!instance || instance.binding !== binding) error('INSTANCE_CLOSED', 'Plugin instance is unavailable.')
    this.allowed(this.record(instance!.plugin))
    if (instance!.root && (this.current.projectId !== instance!.context.project?.projectId || this.current.root !== instance!.root
      || this.current.revision !== instance!.context.revision)) error('STALE_CONTEXT', 'Project context changed.')
    return instance!
  }
  private record(id: string): RecordData { const record = this.records.get(id); if (!record) error('INVALID_REQUEST', 'Plugin is unavailable.'); return record! }
  private allowed(record: RecordData): void {
    if (!this.developmentMode) error('DEVELOPMENT_MODE_REQUIRED', 'Local development mode is off.')
    if (!record.enabled) error('PLUGIN_DISABLED', 'Plugin is disabled.')
    if (record.state === 'error' && record.error !== 'VIEW_LOAD_FAILED') error('SOURCE_UNAVAILABLE', 'Plugin source must be revalidated.')
    if (record.state === 'blocked' || record.grant !== permissionFingerprint(record.manifest)) error('PERMISSION_RECONFIRM_REQUIRED', 'Plugin permissions require confirmation.')
    if (!this.packages.has(record.manifest.id)) error('SOURCE_UNAVAILABLE', 'Plugin source is unavailable.')
    this.requiredDependencies(record.manifest)
  }
  private requiredDependencies(manifest: InstalledPlugin['manifest']): void {
    for (const kind of ['events', 'services'] as const) for (const consumer of manifest.contributes.consumes?.[kind] ?? []) if (!consumer.optional && consumer.plugin !== manifest.id) {
      const provider = this.records.get(consumer.plugin)
      const declaration = provider?.manifest.contributes[kind]?.find(item => item.id === consumer.id && item.version === consumer.version && item.consumers.includes(manifest.id))
      const shape = declaration && ('data' in declaration ? declaration.data : provider?.manifest.contributes.tasks?.find(task => task.id === declaration.task)?.input)
      if (!provider?.enabled || !this.developmentMode || ['blocked', 'disabled'].includes(provider.state) || provider.state === 'error' && provider.error !== 'VIEW_LOAD_FAILED'
        || provider.grant !== permissionFingerprint(provider.manifest) || !shape || Object.keys(shape).length !== Object.keys(consumer.schema).length
        || Object.keys(shape).some(key => shape[key] !== consumer.schema[key])) error('DEPENDENCY_UNAVAILABLE', 'Required public contract is unavailable.')
    }
  }
  async call(id: string, binding: string, packet: unknown): Promise<unknown> {
    const instance = this.instance(id, binding)
    if (!instance.bound) error('INVALID_SENDER', 'Plugin channel is not bound.')
    let serialized: string | undefined
    try { serialized = JSON.stringify(packet) } catch { error('INVALID_REQUEST', 'Packet is not JSON.') }
    if (serialized === undefined || Buffer.byteLength(serialized) > 2 * 1024 * 1024) error('INVALID_REQUEST', 'Packet exceeds its limit.')
    const cancellation = cancelSchema.safeParse(packet)
    if (cancellation.success) { const request = instance.requests.get(cancellation.data.requestId); if (request) request.cancelled = true; return null }
    const unsubscription = z.object({ protocol: z.literal(1), type: z.literal('unsubscribe'), subscriptionId: z.string().min(1).max(128) }).strict().safeParse(packet)
    if (unsubscription.success) { instance.subscriptions.delete(unsubscription.data.subscriptionId); this.background.unsubscribe(instance.id, unsubscription.data.subscriptionId); return null }
    const request = requestSchema.safeParse(packet)
    if (!request.success) error('INVALID_REQUEST', 'Invalid plugin packet.')
    const { requestId, method, params, contextRevision } = request.data!
    const start = Date.now()
    let pending: { cancelled: boolean } | undefined
    try {
      if (contextRevision !== instance.context.revision) error('STALE_CONTEXT', 'Context revision changed.')
      if (instance.used.has(requestId)) error('INVALID_REQUEST', 'Duplicate request ID.')
      if (instance.used.size >= 100_000) error('RATE_LIMITED', 'Reload this plugin page to renew its request budget.')
      instance.used.add(requestId)
      instance.times = instance.times.filter(time => start - time < 1000)
      if (instance.times.length >= 30 || instance.requests.size >= 16) error('RATE_LIMITED', 'Plugin request limit reached.')
      instance.times.push(start)
      validatePluginCall(this.record(instance.plugin).manifest, method, params)
      pending = { cancelled: false }; instance.requests.set(requestId, pending)
      const valid = () => {
        this.instance(id, binding)
        if (pending!.cancelled) error('CANCELLED', 'Request was cancelled.')
        if (Date.now() - start > (method === 'workspace.readText' || method === 'documents.readText' ? 10_000 : 5_000)) error('TIMEOUT', 'Plugin request timed out.')
      }
      const result = await this.dispatch(instance, method, params as Record<string, unknown>, valid)
      valid()
      if (method === 'app.getInfo' && !instance.ready) {
        instance.ready = true; clearTimeout(instance.timer)
        const record = this.record(instance.plugin); record.state = 'active'; delete record.error
        // A handshake alone does not prove recovery: crash loops may handshake every time.
        if (record.failures && !this.recoveryTimers.has(instance.plugin)) this.recoveryTimers.set(instance.plugin, setTimeout(() => {
          this.recoveryTimers.delete(instance.plugin)
          if (record.enabled && [...this.instances.values()].some(page => page.plugin === instance.plugin && page.ready)) { record.failures = 0; this.publish() }
        }, 30_000))
        this.publish()
      }
      this.log('OK', { pluginId: instance.plugin, instanceId: id, method, duration: Date.now() - start })
      return { protocol: 1, requestId, type: 'response', ok: true, result }
    } catch (cause) {
      const code = cause instanceof PluginError ? cause.code : 'INTERNAL_ERROR'
      this.log(code, { pluginId: instance.plugin, instanceId: id, method, duration: Date.now() - start })
      return { protocol: 1, requestId, type: 'response', ok: false, error: { code, message: code } }
    } finally { if (pending) instance.requests.delete(requestId) }
  }
  private async readText(root: string, path: string): Promise<{ text: string; bytes: number; version: string }> {
    if (isSensitivePluginPath(path)) error('SENSITIVE_PATH_DENIED', 'Sensitive files are unavailable.')
    for (const directory of this.deps.protectedDirectories ?? []) {
      const part = relative(await realpath(directory).catch(() => resolve(directory)), resolve(root, path))
      if (!isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`)) error('SENSITIVE_PATH_DENIED', 'Host data is unavailable.')
    }
    const bytes = await readPluginFile(root, path, 1024 * 1024)
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      if (text.includes('\0')) error('NOT_TEXT', 'Binary files are unavailable.')
      return { text, bytes: bytes.length, version: createHash('sha256').update(bytes).digest('hex') }
    } catch { return error('NOT_TEXT', 'File must be UTF-8 text.') }
  }
  private async dispatch(instance: Instance, method: string, params: Record<string, unknown>, valid: () => void): Promise<unknown> {
    const record = this.record(instance.plugin)
    if (['tasks.start', 'tasks.list', 'tasks.cancel', 'network.fetch', 'events.publish', 'events.subscribe', 'services.discover', 'services.call'].includes(method)) {
      valid()
      const identity = this.backgroundIdentity(instance.plugin, instance.context.project?.projectId ?? null, instance.scope)
      if (method === 'tasks.start') return this.background.start(identity, params.task as string, params.input as PluginMessage)
      if (method === 'tasks.list') return this.background.list(identity)
      if (method === 'tasks.cancel') return { cancelled: this.background.cancel(params.id as string, identity) }
      if (method === 'network.fetch') return this.network.fetch(record.manifest, identity.scope, params as unknown as PluginNetworkRequest, valid)
      if (method === 'services.discover') return this.background.discover(identity)
      if (method === 'services.call') return this.background.call(identity, params as unknown as Parameters<PluginBackground['call']>[1])
      if (method === 'events.publish') return this.background.publish(identity, params as unknown as Parameters<PluginBackground['publish']>[1])
      let subscriptionId = ''
      subscriptionId = this.background.subscribe(instance.id, identity, params.plugin as string, params.event as string, params.version as number,
        event => this.send(instance, { type: 'event', event: 'public', subscriptionId, payload: event }))
      return { subscriptionId }
    }
    if (method === 'configuration.propose') return this.configuration.run(async () => {
      valid()
      if (!instance.context.configurationEditor) error('PERMISSION_DENIED', 'Only a declared configuration editor may propose edits.')
      if (!instance.context.active) error('CONTEXT_UNAVAILABLE', 'Only an active page can propose configuration.')
      const patch = params.patch as Record<string, PluginSettingValue | null>
      await this.configuration.proposal(record.manifest, instance.root ? instance.scope : null, params.expectedRevision as string, patch, valid)
      if (!instance.context.active) error('CONTEXT_UNAVAILABLE', 'Configuration page is no longer active.')
      const previous = this.configurationOpens.get(instance.plugin)
      if (previous !== undefined && Date.now() - previous < 10_000) error('RATE_LIMITED', 'Configuration navigation limit reached.')
      this.configurationOpens.set(instance.plugin, Date.now())
      this.deps.event(instance.id, { type: 'configurationProposal', pluginId: instance.plugin, scope: instance.root ? 'project' : 'application',
        proposal: { patch, expectedRevision: params.expectedRevision as string } })
      return { proposed: true }
    })
    if (method === 'configuration.open') {
      valid()
      if (!instance.context.active) error('CONTEXT_UNAVAILABLE', 'Only an active page can open configuration.')
      const previous = this.configurationOpens.get(instance.plugin)
      if (previous !== undefined && Date.now() - previous < 10_000) error('RATE_LIMITED', 'Configuration navigation limit reached.')
      this.configurationOpens.set(instance.plugin, Date.now())
      this.deps.event(instance.id, { type: 'openConfiguration', pluginId: instance.plugin, scope: instance.root ? 'project' : 'application' })
      return { opened: true }
    }
    if (method === 'configuration.get' || method === 'configuration.watch') return this.configuration.run(async () => {
      valid()
      const configuration = await this.configuration.get(record.manifest, instance.root ? instance.scope : null)
      valid()
      if (method === 'configuration.get') return configuration
      if (instance.subscriptions.size >= 64) error('RATE_LIMITED', 'Too many subscriptions.')
      const subscriptionId = randomUUID()
      instance.subscriptions.set(subscriptionId, { kind: 'configuration' })
      return { configuration, subscriptionId }
    })
    if (method === 'app.getInfo') return { pluginApiVersion: PLUGIN_API_VERSION, capabilities: [...PLUGIN_CAPABILITIES], locale: this.current.locale, theme: this.current.theme }
    if (method === 'workspace.getContext') return instance.context
    if (method === 'documents.applyEdit') {
      const document = instance.context.document
      if (!document || !instance.root) error('CONTEXT_UNAVAILABLE', 'No document is bound to this view.')
      const base = await this.readText(instance.root!, document!.path)
      valid()
      if (base.version !== params.expectedVersion) error('DOCUMENT_CONFLICT', 'Document changed on disk.')
      const editId = randomUUID()
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { this.documentEdits.delete(editId); reject(new PluginError('TIMEOUT', 'The editor did not accept the draft.')) }, 4000)
        this.documentEdits.set(editId, { instance, valid, finish: applied => {
          clearTimeout(timer); this.documentEdits.delete(editId)
          if (applied) resolve({ applied: true })
          else reject(new PluginError('DOCUMENT_CONFLICT', 'The editor cannot accept this draft.'))
        } })
        this.send(instance, { type: 'documentEdit', editId, path: document!.path, baseText: base.text, version: base.version, text: params.text })
      })
    }
    if (method === 'workspace.readText' || method === 'documents.readText') {
      if (!instance.root) error('CONTEXT_UNAVAILABLE', 'No project is bound to this view.')
      if (method === 'documents.readText' && !instance.context.document) error('CONTEXT_UNAVAILABLE', 'No document is bound to this view.')
      const path = method === 'documents.readText' ? instance.context.document!.path : params.path as string
      const result = await this.readText(instance.root!, path)
      valid()
      return method === 'documents.readText' ? { ...result, path } : { text: result.text, bytes: result.bytes }
    }
    if (method === 'views.open') {
      const target = record.manifest.contributes.views.find(view => view.id === params.view)!
      if (!instance.root && target.scope === 'project') error('CONTEXT_UNAVAILABLE', 'No project is bound to this view.')
      valid(); this.deps.openView(instance.plugin, target.id)
      for (;;) {
        valid()
        const opened = [...this.instances.values()].find(item => item.plugin === instance.plugin && item.view === target.id
          && !item.context.document && item.scope === (target.scope === 'application' ? 'application' : instance.scope))
        if (opened) return { instanceId: opened.id }
        await new Promise(resolve => setTimeout(resolve, 25))
      }
    }
    if (method === 'ui.showToast') {
      const recent = (this.toasts.get(instance.plugin) ?? []).filter(time => Date.now() - time < 10_000)
      if (recent.length >= 3) error('RATE_LIMITED', 'Plugin toast limit reached.')
      recent.push(Date.now()); this.toasts.set(instance.plugin, recent)
      valid(); this.deps.toast(instance.plugin, params.message as string, params.level as string ?? 'info')
      return { shown: true }
    }
    if (method === 'island.update') {
      const contribution = record.manifest.contributes.island!.find(item => item.id === params.id)!
      if ((contribution.scope === 'project') !== Boolean(instance.root)) error('CONTEXT_UNAVAILABLE', 'Island and publisher must have the same scope.')
      const recent = (this.islandTimes.get(instance.plugin) ?? []).filter(time => Date.now() - time < 1000)
      if (recent.length >= 10) error('RATE_LIMITED', 'Island update limit reached.')
      const key = `${instance.plugin}/${contribution.id}`
      if (params.status !== null && !this.island.has(key) && this.island.size >= 32) error('RATE_LIMITED', 'Island queue is full.')
      valid()
      const previous = this.island.get(key)
      // A different page cannot clear the latest publisher's status.
      if (params.status === null && previous && previous.instanceId !== instance.id) error('INVALID_REQUEST', 'Island status belongs to another page.')
      recent.push(Date.now()); this.islandTimes.set(instance.plugin, recent)
      if (params.status === null) this.island.delete(key)
      else this.island.set(key, { pluginId: instance.plugin, id: contribution.id, instanceId: instance.id,
        projectId: instance.context.project?.projectId ?? null, rootId: instance.context.project?.rootId ?? null,
        status: structuredClone(params.status as PluginIslandStatus), createdAt: previous?.createdAt ?? Date.now() })
      // Latest state wins; plugin progress cannot flood the renderer change queue.
      this.islandTimer ??= setTimeout(() => { this.islandTimer = undefined; this.publish() }, 100)
      return { updated: true }
    }
    if (method === 'storage.get') return this.storage.get(instance.plugin, instance.scope, params.key as string)
    if (method === 'storage.set' || method === 'storage.delete') {
      const key = params.key as string
      const value = await this.storage.mutate(instance.plugin, instance.scope, key, method === 'storage.delete' ? undefined : params.value as JsonValue,
        params.expectedRevision as number | undefined, valid)
      valid()
      this.storageChanged(instance, key, value)
      return { revision: value.revision }
    }
    if (method === 'storage.watch') return this.storage.watch(async () => {
      valid()
      if (instance.subscriptions.size >= 64) error('RATE_LIMITED', 'Too many subscriptions.')
      const keys = params.keys as string[]
      const values: Record<string, PluginStoredValue> = Object.create(null)
      for (const key of keys) values[key] = await this.storage.get(instance.plugin, instance.scope, key)
      valid()
      const subscriptionId = randomUUID()
      instance.subscriptions.set(subscriptionId, { kind: 'storage', keys })
      return { subscriptionId, values }
    })
    if (method === 'context.subscribe') {
      if (instance.subscriptions.size >= 64) error('RATE_LIMITED', 'Too many subscriptions.')
      const subscriptionId = randomUUID()
      instance.subscriptions.set(subscriptionId, { kind: 'context' })
      return { subscriptionId }
    }
    error('UNKNOWN_METHOD', 'Plugin method is unavailable.')
  }
  unsubscribe(id: string, binding: string, subscriptionId: string): void { this.instance(id, binding).subscriptions.delete(subscriptionId) }
  documentEditResult(id: string, binding: string, editId: string, applied: boolean): void {
    const instance = this.instance(id, binding)
    const edit = this.documentEdits.get(editId)
    if (!edit || edit.instance !== instance) error('INVALID_REQUEST', 'Draft is unavailable.')
    try { edit!.valid() } catch (cause) { edit!.finish(false); throw cause }
    edit!.finish(applied)
  }
  islandAction(pluginId: string, id: string, instanceId: string, commandId: string): void {
    const entry = this.island.get(`${pluginId}/${id}`)
    if (!entry || entry.instanceId !== instanceId) error('INSTANCE_CLOSED', 'Island status has expired.')
    const source = this.instances.get(instanceId)
    if (!source || source.plugin !== pluginId) error('INSTANCE_CLOSED', 'Island publisher is unavailable.')
    this.instance(instanceId, source!.binding)
    const manifest = this.record(pluginId).manifest
    const contribution = manifest.contributes.island?.find(item => item.id === id)
    if (!contribution?.actions?.includes(commandId)) error('INVALID_REQUEST', 'Island action is unavailable.')
    const command = manifest.contributes.commands?.find(item => item.id === commandId)
    if (!command) error('INVALID_REQUEST', 'Island command is unavailable.')
    validatePluginCall(manifest, 'views.open', { view: command!.action.view })
    this.deps.openView(pluginId, command!.action.view)
  }
  private storageChanged(source: Instance, key: string, value: PluginStoredValue): void {
    for (const instance of this.instances.values()) if (instance.plugin === source.plugin && instance.scope === source.scope) {
      for (const [subscriptionId, sub] of instance.subscriptions) if (sub.kind === 'storage' && sub.keys.includes(key)) {
        const id = `${instance.id}:${subscriptionId}`
        const pending = this.pendingEvents.get(id) ?? { instance, subscriptionId, values: Object.create(null) as Record<string, PluginStoredValue> }
        pending.values[key] = value
        this.pendingEvents.set(id, pending)
      }
    }
    // At most ten batches per second per subscription, latest revision per key.
    this.eventTimer ??= setTimeout(() => {
      this.eventTimer = undefined
      for (const pending of this.pendingEvents.values()) if (this.instances.get(pending.instance.id) === pending.instance
        && pending.instance.subscriptions.has(pending.subscriptionId)) this.send(pending.instance, { type: 'event', event: 'storage', subscriptionId: pending.subscriptionId, payload: pending.values })
      this.pendingEvents.clear()
    }, 100)
  }
  private watchSource(record: RecordData): void {
    if (record.source.kind !== 'linked') return
    this.stopWatch(record.manifest.id)
    const state: { watchers: FSWatcher[]; timer?: ReturnType<typeof setTimeout> } = { watchers: [] }
    const schedule = () => {
      if (state.timer) clearTimeout(state.timer)
      state.timer = setTimeout(() => { void this.reload(record.manifest.id).catch(() => {}) }, 500)
    }
    try {
      state.watchers.push(watch(record.packageDirectory, (_event, name) => { if (!name || String(name) === 'manifest.json' || String(name) === 'dist') schedule() }))
      if (record.manifest.contributes.views.length) state.watchers.push(watch(join(record.packageDirectory, 'dist'), { recursive: true }, schedule))
      for (const watcher of state.watchers) watcher.on('error', schedule)
      this.watchers.set(record.manifest.id, state)
    } catch { for (const watcher of state.watchers) watcher.close(); this.log('SOURCE_UNAVAILABLE', { pluginId: record.manifest.id }) }
  }
  private stopWatch(id: string): void { const state = this.watchers.get(id); if (state?.timer) clearTimeout(state.timer); state?.watchers.forEach(watcher => watcher.close()); this.watchers.delete(id) }
  private async configurationTarget(id: string, projectId: string | null, scopePath: string | null) {
    const record = this.record(id)
    const digest = record.digest; const activation = this.activations.get(record) ?? 0; const revision = this.current.revision
    if (!record.manifest.contributes.settings?.length) error('INVALID_REQUEST', 'Plugin has no settings.')
    if (!projectId && scopePath) error('INVALID_REQUEST', 'Application configuration has no project path.')
    if (projectId && !record.projects.includes(projectId)) error('PERMISSION_DENIED', 'Project is not approved.')
    const project = projectId ? await this.deps.resolveProject(projectId, scopePath) : null
    const valid = () => {
      if (this.records.get(id) !== record || record.digest !== digest || (this.activations.get(record) ?? 0) !== activation
        || projectId && this.current.revision !== revision) error('STALE_CONTEXT', 'Configuration target changed.')
    }
    valid()
    return { record, scope: project ? `${projectId}:${createHash('sha256').update(project.root).digest('hex')}` : null, valid }
  }
  async getConfiguration(id: string, projectId: string | null, scopePath: string | null): Promise<unknown> {
    const target = await this.configurationTarget(id, projectId, scopePath)
    return this.configuration.run(async () => {
      target.valid()
      const result = await this.configuration.management(target.record.manifest, target.scope)
      target.valid(); return result
    })
  }
  async updateConfiguration(request: Extract<PluginManageRequest, { type: 'configurationUpdate' }>): Promise<unknown> {
    const target = await this.configurationTarget(request.id, request.projectId, request.scopePath)
    return this.configuration.run(async () => {
      await this.configuration.update(target.record.manifest, target.scope, request.expectedRevision, request.patch, request.reset, target.valid, request.migrate)
      for (const instance of this.instances.values()) if (instance.plugin === request.id && (!target.scope || instance.scope === target.scope)) {
        const subscriptions = [...instance.subscriptions].filter(([, sub]) => sub.kind === 'configuration')
        if (!subscriptions.length) continue
        try {
          const configuration = await this.configuration.get(target.record.manifest, instance.root ? instance.scope : null)
          if (this.instances.get(instance.id) !== instance) continue
          for (const [subscriptionId] of subscriptions) if (instance.subscriptions.has(subscriptionId)) {
            this.send(instance, { type: 'event', event: 'configuration', subscriptionId, payload: configuration })
          }
        } catch { this.log('STORAGE_UNAVAILABLE', { pluginId: request.id, instanceId: instance.id, method: 'configuration.watch' }) }
      }
      this.publish()
      return this.configuration.management(target.record.manifest, target.scope)
    })
  }
  async deleteData(id: string): Promise<void> {
    this.record(id); this.revokePlugin(id)
    await this.storage.deletePlugin(id)
    await this.configuration.deletePlugin(id)
    this.background.deleteData(id); await this.credentials.deletePlugin(id)
  }
  private backgroundIdentity(plugin: string, projectId: string | null, scope?: string): BackgroundIdentity {
    const record = this.record(plugin); this.allowed(record)
    const generation = this.activations.get(record) ?? 0; const digest = record.digest; const revision = this.current.revision
    if (projectId && (!record.projects.includes(projectId) || this.current.projectId !== projectId || !this.current.root)) error('CONTEXT_UNAVAILABLE', 'Background project is unavailable.')
    const expectedScope = projectId ? `${projectId}:${createHash('sha256').update(this.current.root!).digest('hex')}` : 'application'
    if (scope && scope !== expectedScope) error('STALE_CONTEXT', 'Background root changed.')
    return { plugin, manifest: record.manifest, projectId, scope: expectedScope, rootId: projectId ? createHash('sha256').update(expectedScope).digest('hex') : null,
      valid: () => {
        this.allowed(record)
        if (this.records.get(plugin) !== record || record.digest !== digest || (this.activations.get(record) ?? 0) !== generation || projectId && this.current.revision !== revision) error('STALE_CONTEXT', 'Background activation changed.')
      } }
  }
  private async agentContext(context: { workspaceId: string; workspaceRoot: string }): Promise<() => void> {
    const revision = this.current.revision
    const root = await realpath(context.workspaceRoot)
    const valid = () => {
      if (revision !== this.current.revision || context.workspaceId !== this.current.projectId || root !== this.current.root) error('STALE_CONTEXT', 'Agent service requires the active project/worktree.')
    }
    valid(); return valid
  }
  async discoverAgentServices(context: { workspaceId: string; workspaceRoot: string }): Promise<PluginAgentService[]> {
    await this.initialize()
    const valid = await this.agentContext(context)
    const services: PluginAgentService[] = []
    for (const record of this.records.values()) for (const projectId of [null, context.workspaceId]) {
      try { valid(); services.push(...this.background.agentServices(this.backgroundIdentity(record.manifest.id, projectId))) } catch { /* Unavailable/unauthorized providers are not advertised. */ }
    }
    valid(); return services
  }
  // Note: .agents/notes/workbench/plugin-contract-v1.md — skills are inert, versioned plugin data.
  private agentSkill(record: RecordData, id: string, projectId: string): PluginAgentSkillResource {
    this.allowed(record)
    if (!record.manifest.permissions.some(item => item.name === 'agent.skills') || !record.manifest.capabilities.required.includes('agent.skills')) error('PERMISSION_DENIED', 'Plugin skill permission is missing.')
    const skill = record.manifest.contributes.skills?.find(item => item.id === id)
    if (!skill) error('DEPENDENCY_UNAVAILABLE', 'Plugin skill is unavailable.')
    const identity = this.backgroundIdentity(record.manifest.id, skill!.scope === 'project' ? projectId : null)
    const available = skill!.services.length ? this.background.agentServices(identity) : []
    const services = skill!.services.map(reference => {
      const service = available.find(item => item.service === reference.service && item.version === reference.version)
      if (!service) error('DEPENDENCY_UNAVAILABLE', 'Plugin skill service is unavailable.')
      return service!
    })
    identity.valid()
    return { plugin: record.manifest.id, skill: skill!.id, version: skill!.version, revision: record.digest,
      title: skill!.title, description: skill!.description, scope: skill!.scope,
      trust: 'untrusted-plugin-content', instructions: skill!.instructions, services }
  }
  async discoverAgentSkills(context: { workspaceId: string; workspaceRoot: string }, signal: AbortSignal): Promise<PluginAgentSkillCatalog> {
    if (signal.aborted) error('CANCELLED', 'Skill discovery stopped.')
    await this.initialize()
    const valid = await this.agentContext(context)
    const skills: PluginAgentSkill[] = []; let truncated = false
    for (const record of [...this.records.values()].sort((a, b) => a.manifest.id.localeCompare(b.manifest.id))) {
      for (const skill of record.manifest.contributes.skills ?? []) {
        try {
          const { instructions: _instructions, services: _services, trust: _trust, ...metadata } = this.agentSkill(record, skill.id, context.workspaceId)
          if (skills.length < 32) skills.push(metadata); else truncated = true
        } catch { /* Disabled, unauthorized or unavailable skills are not advertised. */ }
      }
    }
    valid(); if (signal.aborted) error('CANCELLED', 'Skill discovery stopped.')
    return { skills, truncated }
  }
  async readAgentSkill(context: { workspaceId: string; workspaceRoot: string }, params: unknown, signal: AbortSignal): Promise<PluginAgentSkillResource> {
    if (signal.aborted) error('CANCELLED', 'Skill read stopped.')
    await this.initialize()
    const parsed = pluginSkillReadSchema.safeParse(params)
    if (!parsed.success) error('INVALID_REQUEST', 'Plugin skill request is invalid.')
    const request = parsed.data!
    const record = this.record(request.plugin); const generation = this.activations.get(record) ?? 0
    if (record.digest !== request.revision) error('STALE_CONTEXT', 'Plugin skill revision changed.')
    const valid = await this.agentContext(context)
    if (this.records.get(request.plugin) !== record || record.digest !== request.revision || (this.activations.get(record) ?? 0) !== generation) error('STALE_CONTEXT', 'Plugin skill activation changed.')
    const resource = this.agentSkill(record, request.skill, context.workspaceId)
    if (resource.version !== request.version) error('DEPENDENCY_UNAVAILABLE', 'Plugin skill version is unavailable.')
    if (Buffer.byteLength(JSON.stringify(resource)) > 64 * 1024) error('RATE_LIMITED', 'Plugin skill resource exceeds its budget.')
    valid(); if (signal.aborted) error('CANCELLED', 'Skill read stopped.')
    return resource
  }
  async callAgentService(context: { workspaceId: string; workspaceRoot: string }, params: unknown, signal: AbortSignal): Promise<PluginTaskRun> {
    return this.agentServiceInvocation(context, params, signal)
  }
  async discoverAgentWorkflows(context: { workspaceId: string; workspaceRoot: string }, signal: AbortSignal): Promise<PluginAgentWorkflowCatalog> {
    if (signal.aborted) error('CANCELLED', 'Workflow discovery stopped.')
    await this.initialize(); const valid = await this.agentContext(context)
    const workflows: PluginAgentWorkflow[] = []; let truncated = false; let bytes = 0
    for (const record of [...this.records.values()].sort((a, b) => a.manifest.id.localeCompare(b.manifest.id))) for (const projectId of [null, context.workspaceId]) {
      try {
        for (const workflow of this.background.agentWorkflows(this.backgroundIdentity(record.manifest.id, projectId), record.digest)) {
          const size = Buffer.byteLength(JSON.stringify(workflow))
          if (workflows.length >= 32 || bytes + size > 64 * 1024) truncated = true
          else { workflows.push(workflow); bytes += size }
        }
      } catch { /* Unavailable or unauthorized workflows are not advertised. */ }
    }
    valid(); if (signal.aborted) error('CANCELLED', 'Workflow discovery stopped.')
    return { workflows, truncated }
  }
  async runAgentWorkflow(context: { workspaceId: string; workspaceRoot: string }, params: unknown, signal: AbortSignal): Promise<PluginTaskRun> {
    const parsed = pluginWorkflowRunSchema.safeParse(params)
    if (!parsed.success) error('INVALID_REQUEST', 'Workflow input is invalid.')
    const request = parsed.data!
    await this.initialize()
    const record = this.record(request.plugin)
    const workflow = record.manifest.contributes.workflows?.find(item => item.id === request.workflow && item.version === request.version)
    if (!workflow || !record.manifest.capabilities.required.includes('agent.workflows')) error('DEPENDENCY_UNAVAILABLE', 'Workflow is unavailable.')
    return this.agentServiceInvocation(context, { plugin: request.plugin, service: workflow!.service, version: request.version, input: request.input }, signal, request.revision)
  }
  private async agentServiceInvocation(context: { workspaceId: string; workspaceRoot: string }, params: unknown, signal: AbortSignal, revision?: string): Promise<PluginTaskRun> {
    if (signal.aborted) error('CANCELLED', 'Agent operation stopped.')
    await this.initialize()
    const parsed = serviceCallSchema.safeParse(params)
    if (!parsed.success) error('INVALID_REQUEST', 'Agent service input is invalid.')
    const request = parsed.data!
    // Capture activation before asynchronous workspace validation; reload/regrant cannot retarget a call.
    const record = this.record(request.plugin); const digest = record.digest; const generation = this.activations.get(record) ?? 0
    if (revision !== undefined && record.digest !== revision) error('STALE_CONTEXT', 'Workflow revision changed.')
    const valid = await this.agentContext(context)
    if (this.records.get(request.plugin) !== record || record.digest !== digest || (this.activations.get(record) ?? 0) !== generation) error('STALE_CONTEXT', 'Agent provider activation changed.')
    const service = record.manifest.contributes.services?.find(item => item.id === request.service && item.version === request.version)
    const task = record.manifest.contributes.tasks?.find(item => item.id === service?.task)
    if (!task) error('DEPENDENCY_UNAVAILABLE', 'Agent service is unavailable.')
    const identity = this.backgroundIdentity(request.plugin, task!.scope === 'project' ? context.workspaceId : null)
    const providerValid = identity.valid
    identity.valid = () => { valid(); providerValid() }
    return this.background.callAgent(identity, request, signal)
  }
  async backgroundManage(request: Extract<PluginManageRequest, { type: 'taskStart' | 'taskCancel' | 'credentialStatus' | 'credentialSet' }>): Promise<unknown> {
    if (request.type === 'taskCancel') return { cancelled: this.background.cancel(request.runId) }
    const record = this.record(request.id); const digest = record.digest; const generation = this.activations.get(record) ?? 0
    const revision = this.current.revision
    if (!request.projectId && request.scopePath) error('INVALID_REQUEST', 'Application scope has no root.')
    if (request.projectId) {
      if (!request.scopePath || (await this.deps.resolveProject(request.projectId, request.scopePath)).root !== this.current.root || revision !== this.current.revision) error('STALE_CONTEXT', 'Background management root changed.')
    }
    if (this.records.get(request.id) !== record || record.digest !== digest || (this.activations.get(record) ?? 0) !== generation) error('STALE_CONTEXT', 'Background management activation changed.')
    const identity = this.backgroundIdentity(request.id, request.projectId)
    if (request.type === 'taskStart') return this.background.start(identity, request.task, request.input)
    const slot = identity.manifest.contributes.credentials?.find(item => item.id === request.slot)
    if (!slot) error('INVALID_REQUEST', 'Credential slot is undeclared.')
    if (request.type === 'credentialStatus') return { configured: await this.credentials.status(request.id, identity.scope, slot!.id, slot!.origin) }
    this.network.revoke(request.id); this.background.revoke(request.id)
    await this.credentials.set(request.id, identity.scope, slot!.id, slot!.origin, request.value, identity.valid)
    identity.valid(); this.publish(); return { configured: request.value !== null }
  }
  dispose(): void { this.background.revoke(); this.network.close(); if (this.eventTimer) clearTimeout(this.eventTimer); if (this.islandTimer) clearTimeout(this.islandTimer); this.pendingEvents.clear(); for (const id of this.watchers.keys()) this.stopWatch(id); for (const id of [...this.instances.keys()]) this.close(id); for (const id of this.recoveryTimers.keys()) this.clearRecovery(id) }
}
