// Note: .agents/notes/workbench/plugin-contract-v1.md — local development lifecycle and broker.
import { randomUUID, createHash } from 'node:crypto'
import { readFile, mkdir, writeFile, rm, realpath } from 'node:fs/promises'
import { watch, type FSWatcher } from 'node:fs'
import { join, resolve, relative, isAbsolute, sep } from 'node:path'
import { z } from 'zod'
import semver from 'semver'
import { PluginError, PLUGIN_API_VERSION, PLUGIN_CAPABILITIES, parsePluginManifest, validatePluginCall,
  isSensitivePluginPath, matchesPluginViewer, type PluginDocument, type JsonValue, type PluginContext, type PluginStoredValue, type PluginIslandStatus, type PluginSettingValue } from '@janusx/plugin-sdk'
import type { InstalledPlugin, PluginHostSnapshot, PluginLog, PluginMount, PluginIslandEntry } from '../../shared/ipc/plugins'
import { SerialQueue, writeFileAtomic } from '../lib/atomic-file'
import { readPluginFile, readPluginPackage, listPluginDirectory, type PluginPackage } from './files'
import { PluginStorage } from './storage'
import { PluginConfigurationStore } from './configuration'
import type { PluginManageRequest } from '../../shared/ipc/plugins'
import { PluginCredentials, PluginNetwork, type PluginEncryption, type PluginNetworkTransport } from './network'
import { PluginBackground, type BackgroundIdentity } from './background'
import { PluginModels, type PluginModelBackend } from './models'
import { serviceCallSchema, type PluginMessage, type PluginNetworkRequest, type PluginAgentService, type PluginTaskRun } from '@janusx/plugin-sdk'
import { pluginContextReadSchema, type PluginDocumentContext, type PluginDocumentContextCatalog, type PluginDocumentContextResource } from '@janusx/plugin-sdk'
import { pluginSkillReadSchema, pluginWorkflowRunSchema, type PluginAgentSkill, type PluginAgentSkillCatalog, type PluginAgentSkillResource, type PluginAgentWorkflow, type PluginAgentWorkflowCatalog } from '@janusx/plugin-sdk'
import type { PluginDraft } from '@janusx/plugin-sdk'
import { assertPluginCompatibility, decodePluginArchive, decodeSignedPluginPackage, verifyPluginRelease, type SignedPluginPayload, type PluginTrustKeys } from './distribution/package'
import { NativePluginService } from './native-service'
import { NativeServiceError, nativeValueSchema, PLUGIN_ERROR_CODES, type PluginErrorCode } from '@janusx/plugin-sdk'
import type { NativeModelCredentials } from './native-models'
import { permissionFingerprint } from './permission-fingerprint'
import { allowLegacyImport, markPluginDataReset } from './data-reset'
import { collectPluginPackages, pluginDataInUse, PLUGIN_PACKAGE_STORAGE_LIMIT, withPluginPackageLock } from './package-leases'

interface RecordData extends InstalledPlugin {
  packageDirectory: string; grant: string; release?: SignedPluginPayload
  previous?: Omit<RecordData, 'previous'>
}
interface Instance {
  id: string; plugin: string; view: string; binding: string; token: string; generation: string; url: string
  root: string | null; scope: string; context: PluginContext; bound: boolean; ready: boolean
  requests: Map<string, { cancelled: boolean; controller: AbortController }>; used: Set<string>; times: number[]; timer: ReturnType<typeof setTimeout>
  subscriptions: Map<string, { kind: 'storage'; keys: string[] } | { kind: 'context' | 'configuration' | 'native' }>
}
export interface PluginServiceDeps {
  directory: string
  encryption?: PluginEncryption
  networkTransport?: PluginNetworkTransport
  modelBackend?: PluginModelBackend
  protectedDirectories?: string[]
  legacyCredentials?: Readonly<Record<string, ReadonlyArray<{ slot: string; origin: string; path: string }>>>
  official?: { keys: PluginTrustKeys; hostVersion: string; platform: string; nativePlugins?: Readonly<Record<string, readonly string[]>> }
  createNativeService?(record: InstalledPlugin, directory: string, stopped: (code: string) => void, credentials: NativeModelCredentials): NativePluginService
  resolveProject(id: string, scopePath: string | null): Promise<{ root: string; name: string }>
  worktrees?(projectId: string): Promise<Array<{ root: string; name: string; branch: string | null; isMain: boolean }>>
  changed(): void
  closed?(instanceId: string): void
  event(instanceId: string, packet: JsonValue): void
  /** Host renderer only: these packets contain canonical paths and must never enter the plugin port. */
  workspaceHandoff?(packet: JsonValue): void
  openView(pluginId: string, viewId: string, instanceKey?: string): void
  workbenchAction?(packet: JsonValue): void
  toast(pluginId: string, message: string, level: string): void
}
const requestSchema = z.object({ protocol: z.literal(1), type: z.literal('request'), requestId: z.string().min(1).max(128),
  method: z.string().max(128), params: z.unknown(), contextRevision: z.number().int().nonnegative() }).strict()
const cancelSchema = z.object({ protocol: z.literal(1), type: z.literal('cancel'), requestId: z.string().min(1).max(128) }).strict()
const nativeEventSchema = z.object({ scope: z.object({ projectId: z.string().min(1), root: z.string().min(1) }).strict().nullable(), data: nativeValueSchema }).strict()
const error = (code: ConstructorParameters<typeof PluginError>[0], message: string): never => { throw new PluginError(code, message) }

export class PluginService {
  private workspaceHandoffs = new Map<string, number>()
  private records = new Map<string, RecordData>()
  private activations = new WeakMap<RecordData, number>()
  private packages = new Map<string, PluginPackage>()
  private nativeServices = new Map<string, NativePluginService>()
  private nativeStops = new Map<string, Promise<void>>()
  private instances = new Map<string, Instance>()
  private recoveryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private logs: PluginLog[] = []
  private developmentMode = false
  private queue = new SerialQueue()
  private watchers = new Map<string, { watchers: FSWatcher[]; timer?: ReturnType<typeof setTimeout> }>()
  private toasts = new Map<string, number[]>()
  private contextReads = 0
  private contextReadTimes: number[] = []
  private directoryReads = 0
  private directoryReadTimes: number[] = []
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
  private contextReady: Promise<void> = Promise.resolve()
  private selectionKey = ''
  private pendingEvents = new Map<string, { instance: Instance; subscriptionId: string; values: Record<string, PluginStoredValue> }>()
  private eventTimer?: ReturnType<typeof setTimeout>
  private documentEdits = new Map<string, { instance: Instance; valid(): void; finish(applied: boolean): void }>()
  private documentDrafts = new Map<string, { instance: Instance; valid(): void; finish(draft: PluginDraft | null): void }>()
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
        if (!raw.source || !['linked', 'copied', 'official'].includes(raw.source.kind) || typeof raw.source.directory !== 'string'
          || typeof raw.packageDirectory !== 'string' || !Array.isArray(raw.projects) || raw.projects.some(id => typeof id !== 'string')
          || typeof raw.enabled !== 'boolean' || typeof raw.grant !== 'string' || this.records.has(manifest.id)) throw new Error('Invalid record')
        const record: RecordData = { ...raw, manifest, failures: 0, state: 'disabled' }
        this.records.set(manifest.id, record)
        try {
          const pkg = await this.readPackage(record)
          if (pkg.manifest.id !== manifest.id) error('MANIFEST_INVALID', 'Plugin identity changed.')
          record.manifest = pkg.manifest
          record.digest = pkg.digest
          this.packages.set(manifest.id, pkg)
          if (record.enabled && this.sourceAllowed(record) && record.grant === permissionFingerprint(pkg.manifest)) record.state = 'ready'
          else if (record.enabled) { record.state = 'blocked'; record.error = this.sourceAllowed(record) ? 'PERMISSION_RECONFIRM_REQUIRED' : 'DEVELOPMENT_MODE_REQUIRED' }
          this.watchSource(record)
        } catch { record.state = 'error'; record.error = 'SOURCE_UNAVAILABLE' }
      } catch { this.log('MANIFEST_INVALID') }
    }
    for (const record of this.records.values()) if (record.enabled && record.state === 'ready' && record.manifest.native) {
      try { await this.startNative(record) }
      catch { record.enabled = false; record.state = 'error'; record.error = 'SOURCE_UNAVAILABLE'; await this.persist() }
    }
  }
  snapshot(): PluginHostSnapshot {
    return { developmentMode: this.developmentMode, plugins: [...this.records.values()].map(({ packageDirectory: _directory, grant: _grant, release: _release, previous: _previous, ...record }) => {
      const pages = [...this.instances.values()].filter(instance => instance.plugin === record.manifest.id)
      if (record.enabled && !['blocked', 'error'].includes(record.state)) {
        try { this.requiredDependencies(record.manifest) } catch { record.state = 'blocked'; record.error = 'DEPENDENCY_UNAVAILABLE' }
      }
      return { ...structuredClone(record), previousVersion: _previous?.source?.kind === 'official' ? _previous.manifest?.version : undefined,
        runtime: { pages: pages.length, connected: pages.filter(page => page.bound).length, ready: pages.filter(page => page.ready).length } }
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
      if (!enabled) for (const record of this.records.values()) if (record.source.kind !== 'official') this.disableRecord(record, 'DEVELOPMENT_MODE_REQUIRED')
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
  private sourceAllowed(record: InstalledPlugin): boolean { return record.source.kind === 'official' || this.developmentMode }
  private async readPackage(record: RecordData): Promise<PluginPackage> {
    const pkg = await readPluginPackage(record.packageDirectory, record.source.kind === 'linked' ? record.source.directory : undefined)
    if (record.source.kind === 'official') {
      const official = this.deps.official
      if (!official || !record.release) error('SOURCE_UNAVAILABLE', 'Official release verification is unavailable.')
      const release = verifyPluginRelease(record.release, official!.keys)
      assertPluginCompatibility(release, official!.hostVersion, PLUGIN_API_VERSION, official!.platform)
      const owned = relative(resolve(this.deps.directory, 'packages'), resolve(record.packageDirectory))
      if (!/^[a-f0-9-]{36}$/.test(owned) || release.id !== pkg.manifest.id || release.version !== pkg.manifest.version
        || release.pluginApi !== pkg.manifest.engines.pluginApi || release.contentDigest !== pkg.digest) error('RESOURCE_CHANGED', 'Official package no longer matches its signed release.')
      record.source.publisher = release.publisher
    }
    if (pkg.manifest.native && (record.source.kind !== 'official' || !record.release
      || !Object.hasOwn(this.deps.official?.nativePlugins ?? {}, pkg.manifest.id)
      || !this.deps.official?.nativePlugins?.[pkg.manifest.id]?.includes(record.release.keyId))) {
      error('PERMISSION_DENIED', 'Native services require an explicitly trusted plugin and signing key.')
    }
    return pkg
  }
  /** The caller supplies downloaded bytes, never a directory or an asserted official flag. */
  private retainedPackages(): string[] {
    return [...this.records.values()].flatMap(record => [record.packageDirectory, record.previous?.packageDirectory].filter((path): path is string => Boolean(path)))
  }
  private async collectPackages(): Promise<void> {
    try { await collectPluginPackages(this.deps.directory, this.retainedPackages()) }
    catch { this.log('PACKAGE_CLEANUP_DEFERRED') }
  }
  async installPackage(bytes: Buffer): Promise<void> {
    const { envelope } = decodeSignedPluginPackage(bytes)
    const release = verifyPluginRelease(envelope, this.deps.official?.keys ?? {})
    if (release.packageFormat !== 'jxp/2') error('INVALID_REQUEST', 'Select a self-contained signed plugin package.')
    await this.installOfficial(bytes, envelope)
  }
  installOfficial(archive: Buffer, envelope: SignedPluginPayload): Promise<void> {
    return this.queue.run(() => withPluginPackageLock(this.deps.directory, async () => {
      const official = this.deps.official
      if (!official) error('SOURCE_UNAVAILABLE', 'Official distribution is not configured.')
      const release = verifyPluginRelease(envelope, official!.keys)
      assertPluginCompatibility(release, official!.hostVersion, PLUGIN_API_VERSION, official!.platform)
      if (release.packageFormat === 'jxp/2') {
        const wrapped = decodeSignedPluginPackage(archive)
        if (wrapped.envelope.keyId !== envelope.keyId || wrapped.envelope.payload !== envelope.payload || wrapped.envelope.signature !== envelope.signature) {
          error('INVALID_REQUEST', 'Package metadata differs from the selected release.')
        }
        archive = wrapped.archive
      }
      const pkg = await decodePluginArchive(archive, release)
      const old = this.records.get(release.id)
      if (old && old.source.kind !== 'official') error('DUPLICATE_PLUGIN', 'Remove the development source before installing its official release.')
      if (old?.enabled) error('INVALID_REQUEST', 'Disable the plugin before updating to preserve active work.')
      if (old && semver.lte(release.version, old.manifest.version)) error('INVALID_REQUEST', 'Use rollback to restore an earlier version; releases are immutable.')
      if (old?.manifest.native?.dataVersion !== pkg.manifest.native?.dataVersion && old) error('INVALID_REQUEST', 'This update requires a supported data migration.')
      const used = await collectPluginPackages(this.deps.directory, this.retainedPackages())
      if (used + [...pkg.files.values()].reduce((sum, bytes) => sum + bytes.length, 0) > PLUGIN_PACKAGE_STORAGE_LIMIT) {
        error('PACKAGE_LIMIT_EXCEEDED', 'Plugin storage is full. Close unused MCP clients or uninstall unused plugins, then retry.')
      }
      const packageDirectory = join(this.deps.directory, 'packages', randomUUID())
      try {
        for (const [path, bytes] of pkg.files) {
          const target = join(packageDirectory, path)
          await mkdir(join(target, '..'), { recursive: true })
          await writeFile(target, bytes, { flag: 'wx' })
        }
        const { previous: _previous, ...previous } = old ?? {} as RecordData
        const record: RecordData = { manifest: pkg.manifest, digest: release.contentDigest, packageDirectory,
          source: { kind: 'official', directory: packageDirectory, publisher: release.publisher }, release: structuredClone(envelope),
          enabled: false, projects: old?.projects ?? [], grant: old?.grant ?? '', state: 'disabled', failures: 0,
          ...(old ? { previous } : {}) }
        await this.readPackage(record)
        this.records.set(release.id, record)
        try { await this.persist() } catch (cause) { if (old) this.records.set(release.id, old); else this.records.delete(release.id); throw cause }
        this.packages.set(release.id, { ...pkg, digest: release.contentDigest, directory: packageDirectory })
      } catch (cause) { await rm(packageDirectory, { recursive: true, force: true }).catch(() => {}); throw cause }
      await this.collectPackages()
      this.log('INSTALLED_OFFICIAL', { pluginId: release.id }); this.publish()
    }))
  }
  rollback(id: string): Promise<void> {
    return this.queue.run(() => withPluginPackageLock(this.deps.directory, async () => {
      const record = this.record(id)
      if (record.enabled || record.source.kind !== 'official' || !record.previous) error('INVALID_REQUEST', 'Rollback requires a disabled plugin and an earlier official package.')
      const previous = record.previous!
      if (previous.source?.kind !== 'official' || !previous.release || !Array.isArray(previous.projects) || typeof previous.grant !== 'string') error('SOURCE_UNAVAILABLE', 'Invalid previous official release.')
      if (previous.manifest?.native?.dataVersion !== record.manifest.native?.dataVersion) error('INVALID_REQUEST', 'Previous code is incompatible with current data.')
      const restored = { ...previous, enabled: false, state: 'disabled' as const, failures: 0, error: undefined }
      const pkg = await this.readPackage(restored)
      if (pkg.manifest.id !== id) error('MANIFEST_INVALID', 'Rollback identity mismatch.')
      this.records.set(id, restored)
      try { await this.persist() } catch (cause) { this.records.set(id, record); throw cause }
      this.packages.set(id, pkg); await this.collectPackages(); this.log('ROLLED_BACK', { pluginId: id }); this.publish()
    }))
  }
  private async startNative(record: RecordData): Promise<void> {
    if (!record.manifest.native) return
    if (!this.deps.createNativeService) error('SOURCE_UNAVAILABLE', 'Native service runtime is unavailable.')
    const id = record.manifest.id
    await this.nativeStops.get(id)
    const directory = join(this.deps.directory, 'data', id, 'native')
    await mkdir(directory, { recursive: true })
    const importLegacy = await allowLegacyImport(this.deps.directory, id)
    if (importLegacy) for (const source of this.deps.legacyCredentials?.[id] ?? []) {
      if (!record.manifest.permissions.some(permission => permission.name === 'credentials.use')
        || !record.manifest.contributes.credentials?.some(slot => slot.id === source.slot && slot.origin === source.origin)) continue
      await this.credentials.importLegacy(id, source.slot, source.origin, source.path, () => this.allowed(record))
    }
    const projects = await Promise.all(record.projects.map(async projectId => ({ id: projectId, ...await this.deps.resolveProject(projectId, null) })))
    const native = this.deps.createNativeService!(structuredClone(record), record.packageDirectory, code => {
      if (this.nativeServices.get(id) !== native) return
      this.nativeServices.delete(id)
      this.disableRecord(record, code)
      record.state = 'error'
      this.log(code, { pluginId: id }); this.publish()
      void this.queue.run(() => this.persist()).catch(() => this.log('STORAGE_UNAVAILABLE'))
    }, {
      read: async (slot, origin) => { this.allowed(record); return this.credentials.get(id, 'application', slot, origin) },
      status: async (slot, origin) => { this.allowed(record); return this.credentials.status(id, 'application', slot, origin) },
      set: async (slot, origin, value) => {
        this.allowed(record)
        this.network.revoke(id); this.background.revoke(id)
        await this.credentials.set(id, 'application', slot, origin, value || null, () => this.allowed(record))
        this.allowed(record); this.publish()
      },
    })
    this.nativeServices.set(id, native)
    try {
      await native.start({ apiVersion: 1, pluginId: id, dataVersion: record.manifest.native.dataVersion, directory,
        applicationDataDirectory: resolve(this.deps.directory, '../..'), allowLegacyImport: importLegacy, projects })
      native.onEvent((name, value) => {
        if (this.nativeServices.get(id) !== native || !record.enabled) return
        const event = nativeEventSchema.safeParse(value)
        if (!event.success) { native.stop('INVALID_NATIVE_PACKET'); return }
        for (const instance of this.instances.values()) if (instance.plugin === id) {
          if (event.data.scope && (event.data.scope.projectId !== instance.context.project?.projectId || event.data.scope.root !== instance.root)) continue
          for (const [subscriptionId, subscription] of instance.subscriptions) if (subscription.kind === 'native') {
            this.send(instance, { type: 'event', subscriptionId, event: 'native', payload: { name, value: event.data.data } })
          }
        }
      })
    } catch (cause) {
      this.nativeServices.delete(id); native.stop(); throw cause
    }
  }
  /** Shared services may call an installed feature through the same declared contract as its isolated UI. */
  async nativeCall(id: string, method: string, input: JsonValue, projectId: string | null = null, scopePath: string | null = null, signal?: AbortSignal, instanceId?: string): Promise<JsonValue> {
    const record = this.record(id)
    this.allowed(record)
    if (!record.manifest.native?.methods.includes(method)) error('UNKNOWN_METHOD', 'Native method is not declared.')
    if (projectId && !record.projects.includes(projectId)) error('PATH_NOT_GRANTED', 'Project is not granted.')
    const project = projectId ? { id: projectId, ...await this.deps.resolveProject(projectId, scopePath) } : null
    this.allowed(record)
    const native = this.nativeServices.get(id)
    if (!native) error('SOURCE_UNAVAILABLE', 'Native service is unavailable.')
    signal?.throwIfAborted()
    try { return await native!.call(method, { input, project, ...(instanceId ? { instanceId } : {}) }, signal) }
    catch (cause) {
      if (cause instanceof NativeServiceError && (PLUGIN_ERROR_CODES as readonly string[]).includes(cause.code)) error(cause.code as PluginErrorCode, cause.code)
      if (cause instanceof NativeServiceError) error('SOURCE_UNAVAILABLE', `Native service request failed (${cause.code}).`)
      throw cause
    }
  }
  enable(id: string, projects: string[]): Promise<void> {
    return this.queue.run(async () => {
      const record = this.record(id)
      if (!this.sourceAllowed(record)) error('DEVELOPMENT_MODE_REQUIRED', 'Enable local development mode first.')
      const pkg = await this.readPackage(record)
      if (pkg.manifest.id !== id) error('MANIFEST_INVALID', 'Plugin identity changed.')
      for (const project of projects) await this.deps.resolveProject(project, null)
      this.requiredDependencies(pkg.manifest)
      const old = { ...record }
      record.manifest = pkg.manifest; record.digest = pkg.digest; record.projects = [...new Set(projects)]
      record.grant = permissionFingerprint(pkg.manifest); record.enabled = true; record.failures = 0; record.state = 'ready'; delete record.error
      this.revokePlugin(id)
      try { await this.persist() } catch (cause) { Object.assign(record, old); record.enabled = false; record.state = 'disabled'; this.publish(); throw cause }
      this.packages.set(id, pkg)
      try { await this.startNative(record) } catch (cause) {
        this.disableRecord(record, 'SOURCE_UNAVAILABLE'); await this.persist(); this.publish(); throw cause
      }
      this.log('ENABLED', { pluginId: id }); this.publish()
    })
  }
  disable(id: string): Promise<void> {
    return this.queue.run(async () => { this.disableRecord(this.record(id)); await this.nativeStops.get(id); try { await this.persist() } finally { this.publish() } })
  }
  private disableRecord(record: RecordData, reason?: string): void {
    this.revokePlugin(record.manifest.id)
    record.enabled = false; record.state = 'disabled'; record.error = reason
  }
  reload(id: string, force = false): Promise<void> {
    return this.queue.run(async () => {
      const record = this.record(id)
      try {
        const pkg = await this.readPackage(record)
        if (pkg.manifest.id !== id) error('MANIFEST_INVALID', 'Plugin identity changed.')
        const unchanged = pkg.digest === record.digest
        if (unchanged && record.state !== 'error' && !force) { this.watchSource(record); return }
        this.revokePlugin(id, unchanged && force ? 'reload' : undefined)
        record.manifest = pkg.manifest; record.digest = pkg.digest
        this.packages.set(id, pkg)
        if (record.grant !== permissionFingerprint(pkg.manifest)) { record.state = 'blocked'; record.error = 'PERMISSION_RECONFIRM_REQUIRED' }
        else { record.state = record.enabled && this.sourceAllowed(record) ? 'ready' : 'disabled'; delete record.error }
        await this.persist()
        if (record.enabled && record.state === 'ready') await this.startNative(record)
        this.watchSource(record)
        this.log('RELOADED', { pluginId: id })
      } catch (cause) {
        this.revokePlugin(id); record.state = 'error'; record.error = cause instanceof PluginError ? cause.code : 'SOURCE_UNAVAILABLE'
        this.log(record.error, { pluginId: id }); throw cause
      } finally { this.publish() }
    })
  }
  uninstall(id: string): Promise<void> {
    return this.queue.run(() => withPluginPackageLock(this.deps.directory, async () => {
      const record = this.record(id)
      if (await pluginDataInUse(this.deps.directory, id)) error('INVALID_REQUEST', 'Close the independent MCP clients using this plugin before uninstalling.')
      this.disableRecord(record)
      await this.nativeStops.get(id)
      this.stopWatch(id)
      this.records.delete(id)
      try { await this.persist() } catch (cause) { this.records.set(id, record); this.publish(); throw cause }
      this.packages.delete(id)
      await this.collectPackages()
      this.log('UNINSTALLED', { pluginId: id }); this.publish()
    }))
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
    const ready = this.contextReady = (async () => {
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
    })()
    // A caller may mount immediately after this returns. Wait for any newer
    // resolution too, rather than exposing the temporarily revoked root.
    let pending = ready
    for (;;) {
      await pending
      if (pending === this.contextReady) return
      pending = this.contextReady
    }
  }
  async mount(id: string, viewId: string, projectId: string | null, scopePath: string | null, document?: PluginDocument, instanceKey?: string): Promise<PluginMount> {
    const record = this.record(id)
    this.allowed(record)
    const digest = record.digest
    const activation = this.activations.get(record) ?? 0
    const revision = this.current.revision
    const view = record.manifest.contributes.views.find(view => view.id === viewId)
    if (!view) error('INVALID_REQUEST', 'View is unavailable.')
    if (instanceKey !== undefined && (document || view!.instancePolicy !== 'multiple' || !/^[a-zA-Z0-9_-]{1,64}$/.test(instanceKey))) error('INVALID_REQUEST', 'Invalid view instance key.')
    if (!document && view!.instancePolicy === 'multiple' && !instanceKey) error('INVALID_REQUEST', 'A multi-instance view requires a host key.')
    if (document) {
      const viewer = record.manifest.contributes.viewers?.find(item => item.id === document.viewer && item.view === viewId)
      if (!viewer || !matchesPluginViewer(viewer, document.path)) error('PATH_NOT_GRANTED', 'File does not match the declared viewer.')
    }
    if (view!.scope === 'project' && projectId && !record.projects.includes(projectId)) error('PATH_NOT_GRANTED', 'Project is not granted.')
    const project = view!.scope === 'project' && projectId ? await this.deps.resolveProject(projectId, scopePath) : null
    if (document) {
      if (!project) error('CONTEXT_UNAVAILABLE', 'Document viewers require a project.')
      await this.readText(project!.root, document.path)
    }
    this.allowed(record)
    if (this.records.get(id) !== record || record.digest !== digest || (this.activations.get(record) ?? 0) !== activation
      || this.current.revision !== revision) error('STALE_CONTEXT', 'Context changed while mounting.')
    if (view!.scope === 'project' && projectId && !record.projects.includes(projectId)) error('PATH_NOT_GRANTED', 'Project is not granted.')
    if (view!.scope === 'project' && (!project
      || this.current.projectId !== projectId || this.current.root !== project.root)) error('CONTEXT_UNAVAILABLE', 'Project scope is unavailable.')
    if (this.instances.size >= 64 || [...this.instances.values()].filter(instance => instance.plugin === id).length >= 8) error('RATE_LIMITED', 'Too many plugin pages.')
    const scope = project ? `${projectId}:${createHash('sha256').update(project.root).digest('hex')}` : 'application'
    const documentKey = document ? JSON.stringify([document.viewer, process.platform === 'win32' ? document.path.toLowerCase() : document.path]) : ''
    const existing = [...this.instances.values()].find(instance => instance.plugin === id && instance.view === viewId && instance.scope === scope
      && instance.context.instanceKey === instanceKey
      && (instance.context.document ? JSON.stringify([instance.context.document.viewer, process.platform === 'win32' ? instance.context.document.path.toLowerCase() : instance.context.document.path]) : '') === documentKey)
    if (existing) error('INVALID_REQUEST', 'View already has an instance.')
    const instanceId = randomUUID(); const token = randomUUID(); const generation = randomUUID()
    const context: PluginContext = { project: project ? { projectId: projectId!, rootId: createHash('sha256').update(scope).digest('hex'), name: project.name } : null,
      ...(view!.frame === 'plugin' ? { workbenchFrame: true as const } : {}),
      revision: this.current.revision, active: true, ...(instanceKey ? { instanceKey } : {}), ...(record.manifest.contributes.settings?.length ? { configuration: true as const } : {}),
      ...(record.manifest.capabilities.required.includes('configuration.open') ? { configurationNavigation: true as const } : {}),
      ...(Object.values(record.manifest.contributes.configurationViews ?? {}).includes(viewId) ? { configurationEditor: true as const } : {}),
      ...(document ? { document: { viewer: document.viewer, path: document.path,
        ...(record.manifest.permissions.some(permission => permission.name === 'documents.edit') ? { editable: true } : {}),
        ...(record.manifest.permissions.some(permission => permission.name === 'documents.draft') ? { draftSession: true } : {}) } } : {}) }
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
  windowView(id: string, viewId: string): { title: string; scope: 'application' | 'project' } {
    const record = this.record(id); this.allowed(record)
    const view = record.manifest.contributes.views.find(item => item.id === viewId && item.location === 'window')
    if (!view || !record.manifest.capabilities.required.includes('views.window') || !record.manifest.permissions.some(item => item.name === 'ui.windows')) error('PERMISSION_DENIED', 'A declared window view is required.')
    return { title: `${record.manifest.name} — ${view!.title} [${record.manifest.id}]`, scope: view!.scope }
  }
  async validateWindowContext(id: string, binding: string, projectId: string | null, scopePath: string | null): Promise<void> {
    const instance = this.instance(id, binding)
    if (instance.root) {
      if (projectId !== instance.context.project?.projectId) error('STALE_CONTEXT', 'Window project changed.')
      const project = await this.deps.resolveProject(projectId!, scopePath)
      this.instance(id, binding)
      if (project.root !== instance.root) error('STALE_CONTEXT', 'Window worktree changed.')
    }
  }
  failView(id: string, binding: string): void {
    try { this.instance(id, binding) } catch { return }
    this.loadFailed(id)
  }
  // Revoke mounts still awaiting project resolution as well as existing pages.
  closeAll(): void { this.current.revision++; for (const id of [...this.instances.keys()]) this.close(id) }
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
    for (const request of instance.requests.values()) { request.cancelled = true; request.controller.abort() }
    void this.nativeServices.get(instance.plugin)?.call('lifecycle.release', { instanceId: id }, AbortSignal.timeout(3000))
      .catch(() => this.log('NATIVE_CONTEXT_RELEASE_FAILED', { pluginId: instance.plugin }))
    for (const edit of this.documentEdits.values()) if (edit.instance === instance) edit.finish(false)
    for (const edit of this.documentDrafts.values()) if (edit.instance === instance) edit.finish(null)
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
    const native = this.nativeServices.get(id)
    this.nativeServices.delete(id)
    if (native) {
      const finished = native.shutdown().catch(() => this.log('SERVICE_STOP_FAILED', { pluginId: id })).finally(() => {
        if (this.nativeStops.get(id) === finished) this.nativeStops.delete(id)
      })
      this.nativeStops.set(id, finished)
    }
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
    if (!this.sourceAllowed(record)) error('DEVELOPMENT_MODE_REQUIRED', 'Local development mode is off.')
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
      if (!provider?.enabled || !this.sourceAllowed(provider) || ['blocked', 'disabled'].includes(provider.state) || provider.state === 'error' && provider.error !== 'VIEW_LOAD_FAILED'
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
    if (cancellation.success) { const request = instance.requests.get(cancellation.data.requestId); if (request) { request.cancelled = true; request.controller.abort() }; return null }
    const unsubscription = z.object({ protocol: z.literal(1), type: z.literal('unsubscribe'), subscriptionId: z.string().min(1).max(128) }).strict().safeParse(packet)
    if (unsubscription.success) { instance.subscriptions.delete(unsubscription.data.subscriptionId); this.background.unsubscribe(instance.id, unsubscription.data.subscriptionId); return null }
    const request = requestSchema.safeParse(packet)
    if (!request.success) error('INVALID_REQUEST', 'Invalid plugin packet.')
    const { requestId, method, params, contextRevision } = request.data!
    const start = Date.now()
    let pending: { cancelled: boolean; controller: AbortController } | undefined
    try {
      if (contextRevision !== instance.context.revision) error('STALE_CONTEXT', 'Context revision changed.')
      if (instance.used.has(requestId)) error('INVALID_REQUEST', 'Duplicate request ID.')
      if (instance.used.size >= 100_000) error('RATE_LIMITED', 'Reload this plugin page to renew its request budget.')
      instance.used.add(requestId)
      instance.times = instance.times.filter(time => start - time < 1000)
      if (instance.times.length >= 30 || instance.requests.size >= 16) error('RATE_LIMITED', 'Plugin request limit reached.')
      instance.times.push(start)
      validatePluginCall(this.record(instance.plugin).manifest, method, params)
      pending = { cancelled: false, controller: new AbortController() }; instance.requests.set(requestId, pending)
      const valid = () => {
        this.instance(id, binding)
        if (pending!.cancelled) error('CANCELLED', 'Request was cancelled.')
        if (Date.now() - start > (method === 'native.call' ? 30_000 : method === 'workspace.readText' || method === 'documents.readText' || method === 'context.read' ? 10_000 : 5_000)) error('TIMEOUT', 'Plugin request timed out.')
      }
      const result = await this.dispatch(instance, method, params as Record<string, unknown>, valid, pending.controller.signal)
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
  private async readText(root: string, path: string, limit = 1024 * 1024): Promise<{ text: string; bytes: number; version: string }> {
    if (isSensitivePluginPath(path)) error('SENSITIVE_PATH_DENIED', 'Sensitive files are unavailable.')
    for (const directory of this.deps.protectedDirectories ?? []) {
      const part = relative(await realpath(directory).catch(() => resolve(directory)), resolve(root, path))
      if (!isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`)) error('SENSITIVE_PATH_DENIED', 'Host data is unavailable.')
    }
    const bytes = await readPluginFile(root, path, limit)
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      if (text.includes('\0')) error('NOT_TEXT', 'Binary files are unavailable.')
      return { text, bytes: bytes.length, version: createHash('sha256').update(bytes).digest('hex') }
    } catch { return error('NOT_TEXT', 'File must be UTF-8 text.') }
  }
  private async frameWorktrees(projectId: string) {
    if (this.deps.worktrees) return (await this.deps.worktrees(projectId)).slice(0, 128)
    const project = await this.deps.resolveProject(projectId, null)
    return [{ root: project.root, name: project.name, branch: null, isMain: true }]
  }

  private async dispatch(instance: Instance, method: string, params: Record<string, unknown>, valid: () => void, signal: AbortSignal): Promise<unknown> {
    const record = this.record(instance.plugin)
    if (method === 'native.call') return this.nativeCall(instance.plugin, params.method as string, params.input as JsonValue, instance.context.project?.projectId ?? null, instance.root, signal, instance.id)
    if (method === 'native.watch') {
      if (!this.nativeServices.has(instance.plugin)) error('SOURCE_UNAVAILABLE', 'Native service is unavailable.')
      if (instance.subscriptions.size >= 64) error('RATE_LIMITED', 'Subscription limit reached.')
      const subscriptionId = randomUUID()
      instance.subscriptions.set(subscriptionId, { kind: 'native' })
      return { subscriptionId }
    }
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
    if (method === 'workspace.openDocument' || method === 'workspace.proposeTerminal') {
      if (!this.deps.workspaceHandoff) error('SOURCE_UNAVAILABLE', 'Workspace handoff host is unavailable.')
      const projectId = instance.context.project?.projectId, root = instance.root
      const active = () => {
        valid()
        if (!projectId || !root || !instance.context.active || this.current.projectId !== projectId || this.current.root !== root) {
          error('CONTEXT_UNAVAILABLE', 'Workspace handoffs require the active project page.')
        }
      }
      active()
      const key = `${instance.plugin}/${method}`, previous = this.workspaceHandoffs.get(key)
      if (previous !== undefined && Date.now() - previous < (method === 'workspace.openDocument' ? 1000 : 10_000)) error('RATE_LIMITED', 'Workspace handoff limit reached.')
      this.workspaceHandoffs.set(key, Date.now())
      if (method === 'workspace.openDocument') {
        const path = params.path as string, source = await this.readText(root!, path)
        active()
        if (source.version !== params.expectedVersion) error('RESOURCE_CHANGED', 'The source file changed.')
        this.deps.workspaceHandoff!({ type: 'openDocument', pluginId: instance.plugin, projectId: projectId!, root: root!, path })
        return { requested: true }
      }
      this.deps.workspaceHandoff!({ type: 'terminalDraft', pluginId: instance.plugin, name: record.manifest.name, projectId: projectId!, root: root!, text: params.text as string })
      return { proposed: true }
    }
    if (method === 'workspace.getContext') return instance.context
    if (method === 'context.providers' || method === 'context.read') {
      if (!instance.root || !instance.context.project) error('CONTEXT_UNAVAILABLE', 'Document context requires a project page.')
      const context = { workspaceId: instance.context.project!.projectId, workspaceRoot: instance.root! }
      if (method === 'context.providers') return this.discoverDocumentContexts(context, undefined, instance.plugin)
      if (params.plugin !== instance.plugin) error('PERMISSION_DENIED', 'Pages can read only their own context providers.')
      return this.readDocumentContext(context, params, undefined, valid)
    }
    if (method === 'documents.readDraft' || method === 'documents.updateDraft') {
      const document = instance.context.document
      if (!document?.draftSession || !instance.root) error('CONTEXT_UNAVAILABLE', 'A draft session is required.')
      const base = await this.readText(instance.root!, document!.path)
      valid()
      const editId = randomUUID()
      return new Promise<JsonValue>((resolve, reject) => {
        const timer = setTimeout(() => { this.documentDrafts.delete(editId); reject(new PluginError('TIMEOUT', 'Editor did not respond.')) }, 4000)
        this.documentDrafts.set(editId, { instance, valid, finish: draft => {
          clearTimeout(timer); this.documentDrafts.delete(editId)
          if (draft) resolve({ ...draft })
          else reject(new PluginError('DOCUMENT_CONFLICT', 'Editor draft changed or is unavailable.'))
        } })
        this.send(instance, { type: 'documentDraft', editId, path: document!.path, baseText: base.text, version: base.version,
          ...(method === 'documents.updateDraft' ? { text: params.text as string, expectedRevision: params.expectedRevision as number } : {}) })
      })
    }
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
    if (method === 'workspace.listDirectory') {
      if (!instance.root) error('CONTEXT_UNAVAILABLE', 'Directory queries require a project page.')
      this.directoryReadTimes = this.directoryReadTimes.filter(time => Date.now() - time < 60_000)
      if (this.directoryReads >= 4 || this.directoryReadTimes.length >= 60) error('RATE_LIMITED', 'Directory query budget reached.')
      this.directoryReads++; this.directoryReadTimes.push(Date.now())
      try { return await listPluginDirectory(instance.root!, params.path as string, params.limit as number ?? 100, valid, this.deps.protectedDirectories) }
      catch (cause) {
        if (cause instanceof PluginError) throw cause
        error('FILE_NOT_FOUND', 'Directory is unavailable.')
      } finally { this.directoryReads-- }
    }
    if (method === 'workspace.readText' || method === 'documents.readText') {
      if (!instance.root) error('CONTEXT_UNAVAILABLE', 'No project is bound to this view.')
      if (method === 'documents.readText' && !instance.context.document) error('CONTEXT_UNAVAILABLE', 'No document is bound to this view.')
      const path = method === 'documents.readText' ? instance.context.document!.path : params.path as string
      const result = await this.readText(instance.root!, path)
      valid()
      return method === 'documents.readText' ? { ...result, path } : { text: result.text, bytes: result.bytes }
    }
    if (method === 'views.getFrame' || method === 'views.requestFrame') {
      const view = record.manifest.contributes.views.find(view => view.id === instance.view)
      if (view?.location !== 'workbench' || view.frame !== 'plugin') error('PERMISSION_DENIED', 'This view does not own a workbench frame.')
      valid()
      if (method === 'views.getFrame') {
        const projects = []
        for (const id of record.projects.slice(0, 128)) {
          const project = await this.deps.resolveProject(id, null).catch(() => null)
          valid()
          if (project) projects.push({ id, name: project.name })
        }
        const projectId = instance.context.project?.projectId ?? null
        if (projectId && record.manifest.capabilities.required.includes('views.workbench.worktrees')) {
          const entries = await this.frameWorktrees(projectId)
          valid()
          return { projects, projectId, worktreeId: createHash('sha256').update(instance.root!).digest('hex'),
            worktrees: entries.map(({ root, ...entry }) => ({ ...entry, id: createHash('sha256').update(root).digest('hex') })) }
        }
        return { projects, projectId }
      }
      if (!this.deps.workbenchAction) error('SOURCE_UNAVAILABLE', 'Workbench frame is unavailable.')
      if (params.action === 'selectProject') {
        if (view!.scope !== 'project' || !record.projects.includes(params.projectId as string)) error('PERMISSION_DENIED', 'Project is not granted.')
        await this.deps.resolveProject(params.projectId as string, null)
        valid()
      }
      let scopePath: string | undefined
      if (params.action === 'selectWorktree') {
        const projectId = instance.context.project?.projectId
        if (view!.scope !== 'project' || !projectId || !record.projects.includes(projectId)) error('PERMISSION_DENIED', 'Project is not granted.')
        const entries = await this.frameWorktrees(projectId!)
        valid()
        const entry = entries.find(item => createHash('sha256').update(item.root).digest('hex') === params.worktreeId)
        if (!entry) error('CONTEXT_UNAVAILABLE', 'Worktree is no longer available.')
        scopePath = (await this.deps.resolveProject(projectId!, entry!.root)).root
        valid()
        if (scopePath !== entry!.root) error('STALE_CONTEXT', 'Worktree identity changed.')
      }
      this.deps.workbenchAction!({ type: 'workbenchAction', pluginId: instance.plugin, viewId: instance.view,
        currentProjectId: instance.context.project?.projectId ?? null, root: instance.root, action: params.action as string,
        ...(params.action === 'selectProject' ? { projectId: params.projectId as string } : {}),
        ...(scopePath ? { scopePath } : {}) })
      return { requested: true }
    }
    if (method === 'views.open') {
      const target = record.manifest.contributes.views.find(view => view.id === params.view)!
      if (!instance.root && target.scope === 'project') error('CONTEXT_UNAVAILABLE', 'No project is bound to this view.')
      const instanceKey = target.instancePolicy === 'multiple' ? params.instanceKey as string ?? randomUUID() : undefined
      valid(); this.deps.openView(instance.plugin, target.id, instanceKey)
      for (;;) {
        valid()
        const opened = [...this.instances.values()].find(item => item.plugin === instance.plugin && item.view === target.id
          && item.context.instanceKey === instanceKey
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
  documentDraftResult(id: string, binding: string, editId: string, draft: PluginDraft | null): void {
    const instance = this.instance(id, binding)
    const edit = this.documentDrafts.get(editId)
    if (!edit || edit.instance !== instance) error('INVALID_REQUEST', 'Draft request is unavailable.')
    try { edit!.valid() } catch (cause) { edit!.finish(null); throw cause }
    edit!.finish(draft)
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
  deleteData(id: string): Promise<void> {
    return this.queue.run(() => withPluginPackageLock(this.deps.directory, async () => {
      const record = this.record(id)
      if (await pluginDataInUse(this.deps.directory, id)) error('INVALID_REQUEST', 'Close the independent MCP clients using this plugin before deleting its data.')
      this.disableRecord(record); await this.nativeStops.get(id); await this.persist(); this.publish()
      await markPluginDataReset(this.deps.directory, id)
      await this.storage.deletePlugin(id)
      const dataRoot = resolve(this.deps.directory, 'data'), nativeData = resolve(dataRoot, record.manifest.id)
      if (relative(dataRoot, nativeData) !== record.manifest.id) error('INVALID_REQUEST', 'Invalid plugin data directory.')
      await rm(nativeData, { recursive: true, force: true })
      await this.configuration.deletePlugin(id)
      this.background.deleteData(id); await this.credentials.deletePlugin(id)
      await this.collectPackages()
    }))
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
  // Note: .agents/notes/workbench/plugin-contract-v1.md — UI and Agent share fixed-file context reads.
  private documentContext(record: RecordData, id: string, projectId: string): PluginDocumentContext {
    this.allowed(record)
    const manifest = record.manifest
    if (!manifest.capabilities.required.includes('agent.context') || !manifest.permissions.some(item => item.name === 'agent.context')) error('PERMISSION_DENIED', 'Document context is not authorized.')
    const provider = manifest.contributes.contextProviders?.find(item => item.id === id)
    if (!provider) error('DEPENDENCY_UNAVAILABLE', 'Document context provider is unavailable.')
    validatePluginCall(manifest, 'workspace.readText', { path: provider!.path })
    this.backgroundIdentity(manifest.id, projectId).valid()
    return { plugin: manifest.id, provider: provider!.id, version: provider!.version, revision: record.digest,
      title: provider!.title, description: provider!.description, path: provider!.path, scope: 'project' }
  }
  async discoverDocumentContexts(context: { workspaceId: string; workspaceRoot: string }, signal?: AbortSignal, plugin?: string): Promise<PluginDocumentContextCatalog> {
    if (signal?.aborted) error('CANCELLED', 'Document context discovery stopped.')
    await this.initialize(); const valid = await this.agentContext(context)
    const providers: PluginDocumentContext[] = []; let truncated = false; let bytes = 0
    for (const record of [...this.records.values()].sort((a, b) => a.manifest.id.localeCompare(b.manifest.id))) {
      if (plugin && record.manifest.id !== plugin) continue
      for (const provider of record.manifest.contributes.contextProviders ?? []) {
        try {
          const metadata = this.documentContext(record, provider.id, context.workspaceId)
          const size = Buffer.byteLength(JSON.stringify(metadata))
          if (providers.length >= 32 || bytes + size > 64 * 1024) truncated = true
          else { providers.push(metadata); bytes += size }
        } catch { /* Unavailable or unauthorized providers are not advertised; discovery never reads files. */ }
      }
    }
    valid(); if (signal?.aborted) error('CANCELLED', 'Document context discovery stopped.')
    return { providers, truncated }
  }
  async readDocumentContext(context: { workspaceId: string; workspaceRoot: string }, params: unknown, signal?: AbortSignal, callerValid?: () => void): Promise<PluginDocumentContextResource> {
    if (signal?.aborted) error('CANCELLED', 'Document context read stopped.')
    await this.initialize()
    const parsed = pluginContextReadSchema.safeParse(params)
    if (!parsed.success) error('INVALID_REQUEST', 'Document context request is invalid.')
    const request = parsed.data!; const record = this.record(request.plugin)
    const identity = this.backgroundIdentity(request.plugin, context.workspaceId)
    if (record.digest !== request.revision) error('STALE_CONTEXT', 'Document context package revision changed.')
    const metadata = this.documentContext(record, request.provider, context.workspaceId)
    if (metadata.version !== request.version) error('DEPENDENCY_UNAVAILABLE', 'Document context version is unavailable.')
    const workspaceValid = await this.agentContext(context); const root = this.current.root!
    const started = Date.now()
    const valid = () => {
      identity.valid(); workspaceValid(); callerValid?.()
      if (signal?.aborted) error('CANCELLED', 'Document context read stopped.')
      if (Date.now() - started > 10_000) error('TIMEOUT', 'Document context read timed out.')
    }
    valid()
    this.contextReadTimes = this.contextReadTimes.filter(time => started - time < 60_000)
    if (this.contextReads >= 4 || this.contextReadTimes.length >= 60) error('RATE_LIMITED', 'Document context read budget reached.')
    this.contextReadTimes.push(started); this.contextReads++
    try {
      const { text, bytes, version } = await this.readText(root, metadata.path, 32 * 1024)
      valid()
      const resource: PluginDocumentContextResource = { ...metadata, trust: 'untrusted-plugin-content', text, bytes, documentVersion: version }
      if (Buffer.byteLength(JSON.stringify(resource)) > 64 * 1024) error('RATE_LIMITED', 'Document context response exceeds its budget.')
      this.log('OK', { pluginId: request.plugin, method: 'context.read', duration: Date.now() - started })
      return resource
    } catch (cause) {
      this.log(cause instanceof PluginError ? cause.code : 'INTERNAL_ERROR', { pluginId: request.plugin, method: 'context.read', duration: Date.now() - started })
      if (cause instanceof PluginError) throw cause
      return error('INTERNAL_ERROR', 'Document context is unavailable.')
    } finally { this.contextReads-- }
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
  async dispose(): Promise<void> {
    for (const id of [...this.nativeServices.keys()]) this.revokePlugin(id)
    this.background.revoke(); this.network.close()
    if (this.eventTimer) clearTimeout(this.eventTimer)
    if (this.islandTimer) clearTimeout(this.islandTimer)
    this.pendingEvents.clear()
    for (const id of this.watchers.keys()) this.stopWatch(id)
    for (const id of [...this.instances.keys()]) this.close(id)
    for (const id of this.recoveryTimers.keys()) this.clearRecovery(id)
    await Promise.all(this.nativeStops.values())
  }
}
