import { readFile } from 'node:fs/promises'
import { runtimeCapability } from '../../../shared/runtime/capabilities'
import { localRuntimeContext } from '../../platform/runtime-context'
import { join } from 'node:path'
import { SerialQueue, writeFileAtomic } from '../../lib/atomic-file'
import { CodexConversation, ManagedInputDeferred } from '../../terminal/codex-conversation'
import type { ConversationSnapshot } from '../../../shared/conversation-display'
import { DEFAULT_WORKER_MODEL_SETTINGS, DEFAULT_WORKER_IDLE_MINUTES, parseWorkerIdleMinutes, parseWorkerModelSettings, type WorkerModelSettings, type WorkerSettingsState } from '../../../shared/superagent-worker-settings'
import { DarwinCodexWorker } from './darwin-codex'
import { ClaudeWorkerEngine } from './claude-worker'
import type { WorkerBackend } from '../../../shared/superagent'
import { parseWorkerPolicy, type WorkerPolicy } from '../../../shared/superagent-worker-settings'
import type { ManagedWorkerEngine } from './workers'

export class WorkerSettingsStore {
  private readonly queue = new SerialQueue()
  constructor(private readonly directory: string) {}
  async getIdleMinutes(): Promise<number> {
    try { return parseWorkerIdleMinutes(JSON.parse(await readFile(join(this.directory, 'worker-idle-minutes.json'), 'utf8'))) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return DEFAULT_WORKER_IDLE_MINUTES
      throw error
    }
  }
  async updateIdleMinutes(value: unknown): Promise<number> {
    const minutes = parseWorkerIdleMinutes(value)
    return this.queue.run(async () => {
      await writeFileAtomic(join(this.directory, 'worker-idle-minutes.json'), JSON.stringify(minutes))
      return minutes
    })
  }
  private async profiles(): Promise<{ active: WorkerBackend; enabled: WorkerBackend[]; profiles: Record<WorkerBackend, WorkerModelSettings> }> {
    const profiles: Record<WorkerBackend, WorkerModelSettings> = { codex: { ...DEFAULT_WORKER_MODEL_SETTINGS }, claude: { ...DEFAULT_WORKER_MODEL_SETTINGS, terminal: 'claude' } }
    let raw: unknown
    try { raw = JSON.parse(await readFile(join(this.directory, 'worker-settings.json'), 'utf8')) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { active: 'codex', enabled: ['codex', 'claude'], profiles }; throw error }
    if (raw && typeof raw === 'object' && 'version' in raw) {
      const doc = raw as { version: unknown; active: unknown; enabled?: unknown; profiles: Record<string, unknown> }
      if (![2, 3].includes(doc.version as number) || !['codex', 'claude'].includes(doc.active as string) || !doc.profiles) throw new Error('Invalid Worker settings')
      for (const backend of ['codex', 'claude'] as const) {
        profiles[backend] = parseWorkerModelSettings(doc.profiles[backend])
        if (profiles[backend].terminal !== backend) throw new Error('Invalid Worker settings')
      }
      const policy = parseWorkerPolicy({ defaultBackend: doc.active, enabled: doc.version === 3 ? doc.enabled : ['codex', 'claude'] })
      return { active: policy.defaultBackend, enabled: policy.enabled, profiles }
    }
    const legacy = parseWorkerModelSettings(raw)
    profiles[legacy.terminal] = legacy
    return { active: legacy.terminal, enabled: ['codex', 'claude'], profiles }
  }
  async get(backend?: WorkerBackend): Promise<WorkerModelSettings> {
    if (backend !== undefined && backend !== 'codex' && backend !== 'claude') throw new Error('Unsupported Worker backend')
    const doc = await this.profiles()
    return doc.profiles[backend ?? doc.active]
  }
  async update(value: unknown): Promise<WorkerModelSettings> {
    const settings = parseWorkerModelSettings(value)
    return this.queue.run(async () => {
      const doc = await this.profiles()
      doc.profiles[settings.terminal] = settings
      await writeFileAtomic(join(this.directory, 'worker-settings.json'), JSON.stringify({ version: 3, ...doc }, null, 2))
      return settings
    })
  }
  async policy(): Promise<WorkerPolicy> {
    const doc = await this.profiles()
    return { defaultBackend: doc.active, enabled: doc.enabled }
  }
  async updatePolicy(value: unknown): Promise<WorkerPolicy> {
    const policy = parseWorkerPolicy(value)
    return this.queue.run(async () => {
      const doc = await this.profiles()
      await writeFileAtomic(join(this.directory, 'worker-settings.json'), JSON.stringify({ version: 3, ...doc, active: policy.defaultBackend, enabled: policy.enabled }, null, 2))
      return policy
    })
  }
  async resolveBackend(backend?: WorkerBackend): Promise<WorkerBackend> {
    const policy = await this.policy(), selected = backend ?? policy.defaultBackend
    if (!policy.enabled.includes(selected)) throw new Error(`Worker backend disabled: ${selected}`)
    return selected
  }
}

interface SessionSettings {
  selection: WorkerModelSettings
  inherited: boolean
  baseline: { model: string | null; effort: string | null }
  requested: boolean
}

/** Decorates only settings. Native execution, permissions, delivery and disposal remain engine-owned. */
export class WorkerSettingsEngine implements ManagedWorkerEngine {
  private selection: WorkerModelSettings = { ...DEFAULT_WORKER_MODEL_SETTINGS }
  private inherited = true
  private baseline?: { model: string | null; effort: string | null }
  private requested = false
  private version = 0
  private initialized = false
  private disposed = false
  private configuration = 0
  private error?: string
  constructor(private readonly engine: ManagedWorkerEngine, private readonly defaults: WorkerSettingsStore,
    private readonly sessions?: Map<string, SessionSettings>) {}
  private backend(): WorkerBackend { return this.engine.snapshot().engine === 'claude' ? 'claude' : 'codex' }
  snapshot() { return this.engine.snapshot() }
  managedCall(...args: Parameters<ManagedWorkerEngine['managedCall']>) { return this.engine.managedCall(...args) }
  command(...args: Parameters<ManagedWorkerEngine['command']>) { return this.engine.command(...args) }
  dispose() { this.disposed = true; return this.engine.dispose() }
  async startManaged(options: Parameters<ManagedWorkerEngine['startManaged']>[0]) {
    const capability = runtimeCapability('managed-worker', this.backend(), localRuntimeContext().identity)
    if (capability.status !== 'available') throw new Error(capability.message)
    const defaults = await this.defaults.get(this.backend())
    if (this.disposed) throw new Error('Worker is unavailable')
    const previous = options.threadId ? this.sessions?.get(this.backend() + ':' + options.threadId) : undefined
    await this.engine.startManaged(options)
    const state = this.snapshot()
    this.baseline = previous?.baseline ?? { model: state.model, effort: state.effort }
    await this.engine.command({ type: 'models', controlEpoch: state.controlEpoch })
    this.selection = { ...(previous?.selection ?? defaults) }
    this.inherited = previous?.inherited ?? true
    this.requested = previous?.requested ?? (defaults.model !== null || defaults.effort !== null)
    // Finish before SuperAgentWorkers can deliver the first durable input.
    await this.apply()
    this.assertAvailable()
    this.initialized = true
    this.remember()
  }
  private assertAvailable() {
    if (this.disposed || this.snapshot().connection !== 'ready') throw new Error('Worker is unavailable')
  }
  private remember() {
    const threadId = this.snapshot().threadId
    if (!this.sessions || !threadId || !this.baseline) return
    // Continuations replace execution instances. Retain bounded, session-only choices and
    // the original native baseline, so restore never treats an override as the default.
    this.sessions.delete(this.backend() + ':' + threadId)
    this.sessions.set(this.backend() + ':' + threadId, { selection: { ...this.selection }, inherited: this.inherited, baseline: { ...this.baseline }, requested: this.requested })
    if (this.sessions.size > 256) this.sessions.delete(this.sessions.keys().next().value!)
  }
  private target(settings: WorkerModelSettings) {
    const state = this.snapshot()
    const model = settings.model ?? this.baseline?.model
    const option = state.models.find(row => row.model === model)
    if (!option) throw new Error(state.modelsError || 'Model is not in the current Worker catalog; refresh the Worker model catalog')
    const effort = settings.effort ?? (settings.model === null ? this.baseline?.effort ?? option.defaultEffort : option.defaultEffort)
    if (effort === null ? option.efforts.length > 0 : !option.efforts.some(row => row.effort === effort)) {
      throw new Error('Unsupported reasoning effort for this model')
    }
    return { model: option.model, effort }
  }
  state(): WorkerSettingsState {
    let pending = this.requested
    if (pending) {
      try { const target = this.target(this.selection), current = this.snapshot(); pending = target.model !== current.model || target.effort !== current.effort }
      catch { /* Keep the pending request visible when native catalog/readback is unavailable. */ }
    }
    return { selection: { ...this.selection }, inherited: this.inherited, pending, ...(this.error ? { error: this.error } : {}) }
  }
  async configure(value: unknown): Promise<WorkerSettingsState> {
    this.assertAvailable()
    if (!this.initialized) throw new Error('Worker settings are still loading')
    const state = this.snapshot()
    const configuration = ++this.configuration
    const next = value === null ? await this.defaults.get(this.backend()) : parseWorkerModelSettings(value)
    this.assertAvailable()
    const current = this.snapshot()
    if (configuration !== this.configuration || state.threadId !== current.threadId || state.controlEpoch !== current.controlEpoch) throw new Error('Worker settings changed; retry on the current execution')
    if (next.terminal !== this.backend()) throw new Error('Worker backend is fixed for this work')
    this.target(next) // Validate against this execution's native catalog before changing anything.
    this.selection = next; this.inherited = value === null; this.requested = true; this.error = undefined; this.version++
    this.remember()
    return this.state()
  }
  async refreshModels() {
    this.assertAvailable()
    await this.engine.command({ type: 'models', controlEpoch: this.snapshot().controlEpoch })
    this.assertAvailable()
    return this.state()
  }
  private async apply() {
    while (this.requested) {
      const version = this.version
      try {
        this.assertAvailable()
        const target = this.target(this.selection), current = this.snapshot()
        if (current.turnId) throw new ManagedInputDeferred('turn-changed')
        if (target.model !== current.model || target.effort !== current.effort) {
          await this.engine.command({ type: 'settings', ...target, controlEpoch: current.controlEpoch })
          const deadline = Date.now() + 5000
          // An RPC receipt is not authoritative native configuration. The adapter updates
          // its snapshot only on thread/settings/updated; never send under stale settings.
          while (version === this.version) {
            this.assertAvailable()
            const confirmed = this.snapshot()
            if (confirmed.threadId !== current.threadId || confirmed.controlEpoch !== current.controlEpoch || confirmed.turnId) throw new ManagedInputDeferred('turn-changed')
            if (confirmed.model === target.model && confirmed.effort === target.effort) break
            if (Date.now() >= deadline) throw new Error('Native Worker configuration was not confirmed')
            await new Promise(resolve => setTimeout(resolve, 20))
          }
        }
        if (version !== this.version) continue
        this.error = undefined
        return
      } catch (error) {
        if (version === this.version) this.error = String(error)
        throw error
      }
    }
  }
  async managedInput(text: string, expectedTurnId: string | null) {
    // Steering an active turn must keep that turn's model and identity intact.
    if (expectedTurnId === null) {
      try { this.assertAvailable(); await this.apply() }
      catch (error) {
        if (error instanceof ManagedInputDeferred) throw error
        // No input RPC was sent. Preserve the durable pending delivery rather than mark
        // an unsent input as uncertain merely because configuration failed.
        throw new ManagedInputDeferred('waiting')
      }
    }
    return this.engine.managedInput(text, expectedTurnId)
  }
}

export class WorkerSettingsEngines {
  private readonly entries = new Map<string, WorkerSettingsEngine>()
  private readonly sessions = new Map<string, SessionSettings>()
  constructor(readonly defaults: WorkerSettingsStore,
    private readonly factory: (id: string, publish: (snapshot: ConversationSnapshot) => void, backend?: WorkerBackend) => ManagedWorkerEngine = (id, publish, backend) => backend === 'claude' ? new ClaudeWorkerEngine(id, publish) : process.platform === 'darwin' ? new DarwinCodexWorker(id, publish) : new CodexConversation(id, publish)) {}
  create = (id: string, publish: (snapshot: ConversationSnapshot) => void, backend?: WorkerBackend): ManagedWorkerEngine => {
    const engine = new WorkerSettingsEngine(this.factory(id, publish, backend), this.defaults, this.sessions)
    this.entries.set(id, engine)
    return {
      snapshot: () => engine.snapshot(), startManaged: options => engine.startManaged(options),
      managedCall: (...args) => engine.managedCall(...args), managedInput: (...args) => engine.managedInput(...args),
      command: command => engine.command(command),
      dispose: async () => { await engine.dispose(); if (this.entries.get(id) === engine) this.entries.delete(id) },
    }
  }
  get(instanceId: string): WorkerSettingsEngine {
    const engine = this.entries.get(instanceId)
    if (!engine) throw new Error('Worker settings are unavailable for this execution')
    return engine
  }
}
