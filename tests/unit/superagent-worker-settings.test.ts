import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkerSettingsEngine, WorkerSettingsEngines, WorkerSettingsStore } from '../../src/main/janus/superagent/worker-settings'
import { DEFAULT_WORKER_MODEL_SETTINGS, parseWorkerModelSettings } from '../../src/shared/superagent-worker-settings'
import { conversationState } from '../../src/main/terminal/conversation-session'
import { ManagedInputDeferred } from '../../src/main/terminal/codex-conversation'
import type { ManagedWorkerEngine } from '../../src/main/janus/superagent/workers'

const catalog = [
  { model: 'native', displayName: 'Native model', description: '', defaultEffort: 'medium', efforts: [{ effort: 'medium', description: '' }, { effort: 'high', description: '' }] },
  { model: 'alternate', displayName: 'Alternate model', description: '', defaultEffort: 'high', efforts: [{ effort: 'high', description: '' }] },
  { model: 'simple', displayName: 'No reasoning model', description: '', defaultEffort: null, efforts: [] },
  { model: '6-astra', displayName: '6 Astra', description: '', defaultEffort: 'high', efforts: ['high', 'ultra', 'max', 'future_effort'].map(effort => ({ effort, description: '' })) },
]
class NativeSettingsFixture implements ManagedWorkerEngine {
  state = conversationState('fixture', 'codex')
  commands: Array<Parameters<ManagedWorkerEngine['command']>[0]> = []
  inputs: Array<{ text: string; turn: string | null; model: string | null; effort: string | null }> = []
  update: (model: string, effort: string | null) => Promise<void> = async (model, effort) => { this.state.model = model; this.state.effort = effort }
  constructor(readonly id = 'fixture') { this.state.model = 'native'; this.state.effort = 'medium' }
  snapshot() { return structuredClone(this.state) }
  async startManaged(options: Parameters<ManagedWorkerEngine['startManaged']>[0]) {
    this.state.connection = 'ready'; this.state.threadId = options.threadId ?? this.id
  }
  async managedCall() { return {} }
  async command(command: Parameters<ManagedWorkerEngine['command']>[0]) {
    this.commands.push(command)
    if (command.type === 'models') this.state.models = structuredClone(catalog)
    if (command.type === 'settings') await this.update(command.model, command.effort)
    return this.snapshot()
  }
  async managedInput(text: string, turn: string | null) {
    this.inputs.push({ text, turn, model: this.state.model, effort: this.state.effort })
    return { turnId: turn ?? 'turn' }
  }
  async dispose() { this.state.connection = 'closed' }
}
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { vi.useRealTimers(); for (const close of cleanups.splice(0)) await close() })
async function store() {
  const directory = await mkdtemp(join(tmpdir(), 'worker-settings-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  return new WorkerSettingsStore(directory)
}
const launch = (threadId?: string) => ({ threadId } as Parameters<ManagedWorkerEngine['startManaged']>[0])
const alternate = { terminal: 'codex' as const, model: 'alternate', effort: 'high' }

describe('Worker settings preferences and native execution boundary', () => {
  it('migrates the previous active backend and enforces enabled/default policy independently of profiles', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'worker-policy-'))
    cleanups.push(() => rm(directory, { recursive: true, force: true }))
    await writeFile(join(directory, 'worker-settings.json'), JSON.stringify({ version: 2, active: 'claude', profiles: {
      codex: DEFAULT_WORKER_MODEL_SETTINGS, claude: { terminal: 'claude', model: 'opus', effort: null },
    } }))
    const defaults = new WorkerSettingsStore(directory)
    expect(await defaults.policy()).toEqual({ defaultBackend: 'claude', enabled: ['codex', 'claude'] })
    await defaults.update(alternate)
    expect((await defaults.get()).terminal).toBe('claude')
    await defaults.updatePolicy({ defaultBackend: 'codex', enabled: ['codex'] })
    await expect(defaults.resolveBackend('claude')).rejects.toThrow('disabled')
    expect(await defaults.resolveBackend()).toBe('codex')
    await expect(defaults.updatePolicy({ defaultBackend: 'claude', enabled: ['codex'] })).rejects.toThrow('must be enabled')
    expect(await new WorkerSettingsStore(directory).policy()).toEqual({ defaultBackend: 'codex', enabled: ['codex'] })
    expect((await defaults.get('claude')).model).toBe('opus')
  })
  it('keeps engine defaults separate and never migrates a running Worker when defaults change', async () => {
    const defaults = await store()
    await defaults.update(alternate)
    const claude = { terminal: 'claude' as const, model: 'opus', effort: 'high' }
    await defaults.update(claude)
    expect(await defaults.get()).toEqual(alternate)
    await defaults.updatePolicy({ defaultBackend: 'claude', enabled: ['codex', 'claude'] })
    expect(await defaults.get()).toEqual(claude)
    expect(await defaults.get('codex')).toEqual(alternate)
    expect(await defaults.get('claude')).toEqual(claude)
    const native = new NativeSettingsFixture(), engine = new WorkerSettingsEngine(native, defaults)
    await engine.startManaged(launch())
    expect(engine.state().selection).toEqual(alternate)
    await expect(engine.configure(claude)).rejects.toThrow('backend is fixed')
    await engine.configure(null)
    expect(engine.state().selection.terminal).toBe('codex')
    await engine.dispose()
  })

  it('persists idle policy separately and rejects invalid updates without overwriting it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'worker-idle-settings-'))
    cleanups.push(() => rm(directory, { recursive: true, force: true }))
    const defaults = new WorkerSettingsStore(directory)
    expect(await defaults.getIdleMinutes()).toBe(30)
    await defaults.updateIdleMinutes(60)
    expect(await new WorkerSettingsStore(directory).getIdleMinutes()).toBe(60)
    await defaults.update(alternate)
    for (const value of [0, -1, 0.5, 10081, Infinity, NaN, null, '30', {}]) {
      await expect(defaults.updateIdleMinutes(value)).rejects.toThrow('Invalid Worker idle timeout')
    }
    expect(await defaults.getIdleMinutes()).toBe(60)
    expect(await defaults.get()).toEqual(alternate)
    await defaults.updateIdleMinutes(1)
    await defaults.updateIdleMinutes(10080)
    expect(await defaults.getIdleMinutes()).toBe(10080)
  })

  it('persists validated defaults, serializes updates and restores native defaults', async () => {
    const defaults = await store()
    expect(await defaults.get()).toEqual(DEFAULT_WORKER_MODEL_SETTINGS)
    await Promise.all([defaults.update(alternate), defaults.update({ ...alternate, model: 'simple', effort: null })])
    expect(await defaults.get()).toEqual({ terminal: 'codex', model: 'simple', effort: null })
    await defaults.update(DEFAULT_WORKER_MODEL_SETTINGS)
    expect(await defaults.get()).toEqual(DEFAULT_WORKER_MODEL_SETTINGS)
    for (const value of [{ ...alternate, terminal: 'unsupported' }, { ...alternate, model: 'bad model' }, ...['', 'bad effort', 'a'.repeat(65), 3, undefined].map(effort => ({ ...alternate, effort })), { ...alternate, cwd: '/forged' }, {}]) {
      expect(() => parseWorkerModelSettings(value)).toThrow()
      await expect(defaults.update(value)).rejects.toThrow()
    }
    expect(await defaults.get()).toEqual(DEFAULT_WORKER_MODEL_SETTINGS)
  })

  it('accepts native ultra, max and future efforts while rejecting unsupported pairs without changing the active turn', async () => {
    const defaults = await store(), native = new NativeSettingsFixture(), engine = new WorkerSettingsEngine(native, defaults)
    await defaults.update({ terminal: 'codex', model: '6-astra', effort: 'ultra' })
    await engine.startManaged(launch())
    expect(engine.snapshot()).toMatchObject({ model: '6-astra', effort: 'ultra' })
    for (const effort of ['max', 'future_effort', 'ultra']) {
      native.state.turnId = 'active'
      await engine.configure({ terminal: 'codex', model: '6-astra', effort })
      const before = engine.snapshot().effort
      await engine.managedInput('steer', 'active')
      expect(native.inputs.at(-1)?.effort).toBe(before)
      native.state.turnId = null
      await engine.managedInput('next', null)
      expect(native.inputs.at(-1)?.effort).toBe(effort)
    }
    const selected = engine.state()
    for (const setting of [{ terminal: 'codex', model: '6-astra', effort: 'invented' }, { terminal: 'codex', model: 'alternate', effort: 'ultra' }]) {
      await expect(engine.configure(setting)).rejects.toThrow('Unsupported reasoning effort')
      expect(engine.state()).toEqual(selected)
    }
    expect(await defaults.get()).toEqual({ terminal: 'codex', model: '6-astra', effort: 'ultra' })
  })

  it('waits for authoritative native readback before completing startup or sending first input', async () => {
    const defaults = await store(); await defaults.update(alternate)
    const native = new NativeSettingsFixture(), engine = new WorkerSettingsEngine(native, defaults)
    let confirm!: () => void
    native.update = async (model, effort) => { confirm = () => { native.state.model = model; native.state.effort = effort } }
    let started = false
    const start = engine.startManaged(launch()).then(() => { started = true })
    await vi.waitFor(() => expect(confirm).toBeTypeOf('function'))
    expect(started).toBe(false); expect(native.inputs).toEqual([])
    expect(engine.state()).toMatchObject({ pending: true, selection: alternate })
    confirm(); await start
    await engine.managedInput('first durable input', null)
    expect(native.inputs).toEqual([{ text: 'first durable input', turn: null, model: 'alternate', effort: 'high' }])
    expect(engine.state().pending).toBe(false)
  })

  it('does not change active-turn steering and applies a pending override only before a new turn', async () => {
    const defaults = await store(), native = new NativeSettingsFixture(), engine = new WorkerSettingsEngine(native, defaults)
    await engine.startManaged(launch()); native.state.turnId = 'active-turn'
    expect(await engine.configure(alternate)).toMatchObject({ inherited: false, pending: true })
    await engine.managedInput('steer', 'active-turn')
    expect(native.inputs[0]).toMatchObject({ turn: 'active-turn', model: 'native', effort: 'medium' })
    expect(native.commands.filter(command => command.type === 'settings')).toHaveLength(0)
    native.state.turnId = null
    await engine.managedInput('next', null)
    expect(native.inputs[1]).toMatchObject({ model: 'alternate', effort: 'high' })
    expect(engine.state().pending).toBe(false)
    // Readback drift is rechecked even after a previously successful application.
    native.state.model = 'native'; native.state.effort = 'medium'
    await engine.managedInput('another', null)
    expect(native.inputs[2]).toMatchObject({ model: 'alternate', effort: 'high' })
  })

  it('validates model/effort pairs against the execution catalog before modifying selection', async () => {
    const defaults = await store(), native = new NativeSettingsFixture(), engine = new WorkerSettingsEngine(native, defaults)
    await engine.startManaged(launch())
    for (const settings of [{ ...alternate, model: 'missing' }, { ...alternate, effort: 'medium' }]) await expect(engine.configure(settings)).rejects.toThrow()
    expect(engine.state()).toMatchObject({ inherited: true, pending: false, selection: DEFAULT_WORKER_MODEL_SETTINGS })
    await engine.configure({ terminal: 'codex', model: 'simple', effort: null }); await engine.managedInput('simple', null)
    expect(native.inputs[0]).toMatchObject({ model: 'simple', effort: null })
    await engine.configure(null); await engine.managedInput('restore', null)
    expect(native.inputs[1]).toMatchObject({ model: 'native', effort: 'medium' })
  })

  it('leaves a failed local configuration preflight unsent and visibly pending', async () => {
    const defaults = await store(), native = new NativeSettingsFixture(), engine = new WorkerSettingsEngine(native, defaults)
    await engine.startManaged(launch()); await engine.configure(alternate)
    native.update = async () => { throw new Error('native settings transport failed') }
    await expect(engine.managedInput('must remain pending', null)).rejects.toBeInstanceOf(ManagedInputDeferred)
    expect(native.inputs).toHaveLength(0)
    expect(engine.state()).toMatchObject({ pending: true, error: expect.stringContaining('native settings transport failed') })
    // A native input RPC error must retain its original unknown-delivery semantics.
    native.update = async (model, effort) => { native.state.model = model; native.state.effort = effort }
    const failure = new Error('input receipt lost'); vi.spyOn(native, 'managedInput').mockRejectedValueOnce(failure)
    await expect(engine.managedInput('unknown delivery', null)).rejects.toBe(failure)
  })

  it('fails closed when a settings RPC returns without native confirmation', async () => {
    const defaults = await store(), native = new NativeSettingsFixture(), engine = new WorkerSettingsEngine(native, defaults)
    await engine.startManaged(launch()); await engine.configure(alternate)
    native.update = async () => {}
    vi.useFakeTimers()
    const input = engine.managedInput('unconfirmed', null)
    const assertion = expect(input).rejects.toBeInstanceOf(ManagedInputDeferred)
    await vi.advanceTimersByTimeAsync(5020); await assertion
    expect(native.inputs).toHaveLength(0)
    expect(engine.state()).toMatchObject({ pending: true, error: expect.stringContaining('not confirmed') })
  })

  it('rejects an async restore after disposal and never overwrites a newer configuration', async () => {
    const defaults = await store(), native = new NativeSettingsFixture(), engine = new WorkerSettingsEngine(native, defaults)
    await engine.startManaged(launch())
    const pending = Promise.withResolvers<typeof DEFAULT_WORKER_MODEL_SETTINGS>()
    vi.spyOn(defaults, 'get').mockReturnValueOnce(pending.promise)
    const restore = engine.configure(null)
    await engine.configure(alternate); pending.resolve(DEFAULT_WORKER_MODEL_SETTINGS)
    await expect(restore).rejects.toThrow('changed')
    expect(engine.state().selection).toEqual(alternate)
    const stopping = Promise.withResolvers<typeof DEFAULT_WORKER_MODEL_SETTINGS>()
    vi.spyOn(defaults, 'get').mockReturnValueOnce(stopping.promise)
    const stale = engine.configure(null); await engine.dispose(); stopping.resolve(DEFAULT_WORKER_MODEL_SETTINGS)
    await expect(stale).rejects.toThrow('unavailable')
    expect(engine.state().selection).toEqual(alternate)
  })

  it('maps factory instance IDs and carries choices across replacement executions without recapturing an override as native default', async () => {
    const defaults = await store(), natives: NativeSettingsFixture[] = []
    const registry = new WorkerSettingsEngines(defaults, id => { const native = new NativeSettingsFixture(id); natives.push(native); return native })
    const first = registry.create('instance-a', () => {}); await first.startManaged(launch())
    await registry.get('instance-a').configure(alternate); await first.dispose()
    expect(() => registry.get('instance-a')).toThrow('unavailable')
    const continued = registry.create('instance-b', () => {}); natives[1].state.model = 'alternate'; natives[1].state.effort = 'high'
    await continued.startManaged(launch('instance-a')); await continued.managedInput('continued', null)
    expect(natives[1].inputs[0]).toMatchObject({ model: 'alternate', effort: 'high' })
    expect(registry.get('instance-b').state()).toMatchObject({ inherited: false, selection: alternate })
    await registry.get('instance-b').configure(null); await continued.managedInput('restored', null)
    expect(natives[1].inputs[1]).toMatchObject({ model: 'native', effort: 'medium' })
    const unrelated = registry.create('instance-c', () => {}); await unrelated.startManaged(launch())
    expect(registry.get('instance-c').state()).toMatchObject({ inherited: true, selection: DEFAULT_WORKER_MODEL_SETTINGS })
    await continued.dispose(); await unrelated.dispose()
  })
})
