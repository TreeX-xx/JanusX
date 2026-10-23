// Note: .agents/notes/workbench/plugin-contract-v1.md — P5 supervised declarative tasks and public contracts.
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { PluginError, matchesPluginMessage, type PluginManifest, type PluginMessage, type PluginTaskRun,
  type PluginPublicEvent, type PluginNetworkRequest, type PluginAgentService } from '@janusx/plugin-sdk'
import type { PluginNetwork } from './network'

interface BackgroundOwner {
  plugin: string; scope: string; projectId: string | null; rootId: string | null; valid(): void
}
export interface BackgroundIdentity extends BackgroundOwner { manifest: PluginManifest }
interface Execution { run: PluginTaskRun; identity: BackgroundOwner; controller: AbortController; involved: Set<string>; steps: number; resultBytes: number }
interface PublicSubscription { page: string; identity: BackgroundIdentity; plugin: string; event: string; version: number; send(event: PluginPublicEvent): void }
export class PluginBackground {
  private runs = new Map<string, Execution>()
  private subscriptions = new Map<string, PublicSubscription>()
  private eventHistory = new Map<string, { event: PluginPublicEvent; scope: string; delivered: Set<string>; time: number }>()
  private budgets = new Map<string, number[]>()
  constructor(private deps: {
    network: PluginNetwork; identity(plugin: string, source: BackgroundIdentity): BackgroundIdentity; changed(): void
  }) {}
  private budget(plugin: string, kind: string, maximum: number): void {
    const key = `${plugin}:${kind}`; const times = (this.budgets.get(key) ?? []).filter(time => Date.now() - time < 60_000)
    if (times.length >= maximum) throw new PluginError('RATE_LIMITED', 'Background budget reached.')
    times.push(Date.now()); this.budgets.set(key, times)
  }
  private permission(identity: BackgroundIdentity, name: string): void {
    identity.valid()
    if (!identity.manifest.permissions.some(item => item.name === name)) throw new PluginError('PERMISSION_DENIED', 'Background permission missing.')
  }
  list(identity?: BackgroundOwner): PluginTaskRun[] {
    identity?.valid()
    return structuredClone([...this.runs.values()].filter(item => !identity || item.run.pluginId === identity.plugin && item.identity.scope === identity.scope).map(item => item.run))
  }
  cancel(id: string, identity?: BackgroundOwner): boolean {
    const item = this.runs.get(id)
    if (!item) return false
    if (identity && (item.run.pluginId !== identity.plugin || item.identity.scope !== identity.scope)) throw new PluginError('PERMISSION_DENIED', 'Task belongs to another scope.')
    if (item.run.state !== 'running') return false
    item.run.state = 'cancelled'; item.run.finished = new Date().toISOString(); item.controller.abort(); this.deps.changed(); return true
  }
  revoke(plugin?: string, projectOnly = false): void {
    for (const item of this.runs.values()) if ((!plugin || item.involved.has(plugin)) && (!projectOnly || item.run.projectId || item.run.pluginId === 'janusx.agent')) this.cancel(item.run.id)
    for (const [id, sub] of this.subscriptions) if ((!plugin || sub.identity.plugin === plugin || sub.plugin === plugin) && (!projectOnly || sub.identity.projectId)) this.subscriptions.delete(id)
    for (const [id, entry] of this.eventHistory) if ((!plugin || entry.event.trace.includes(plugin)) && (!projectOnly || entry.scope !== 'application')) this.eventHistory.delete(id)
  }
  closePage(page: string): void { for (const [id, sub] of this.subscriptions) if (sub.page === page) this.subscriptions.delete(id) }
  unsubscribe(page: string, id: string): void { if (this.subscriptions.get(id)?.page === page) this.subscriptions.delete(id) }
  deleteData(plugin: string): void { this.revoke(plugin); for (const [id, item] of this.runs) if (item.involved.has(plugin)) this.runs.delete(id) }
  private task(identity: BackgroundIdentity, id: string, input: PluginMessage) {
    this.permission(identity, 'tasks.run')
    const task = identity.manifest.contributes.tasks?.find(item => item.id === id)
    if (!task || (task.scope === 'project') !== Boolean(identity.projectId) || !matchesPluginMessage(task.input, input)) throw new PluginError('INVALID_REQUEST', 'Task scope or input does not match.')
    return task
  }
  start(identity: BackgroundIdentity, task: string, input: PluginMessage): { id: string } {
    this.task(identity, task, input)
    return this.launch(identity, identity, task, input)
  }
  private service(identity: BackgroundIdentity, plugin: string, id: string, version: number, input?: PluginMessage) {
    this.permission(identity, 'services.public')
    const consumer = identity.manifest.contributes.consumes?.services?.find(item => item.plugin === plugin && item.id === id && item.version === version)
    if (!consumer) throw new PluginError('PERMISSION_DENIED', 'Service consumption is undeclared.')
    const provider = this.deps.identity(plugin, identity)
    this.permission(provider, 'services.public')
    const service = provider.manifest.contributes.services?.find(item => item.id === id && item.version === version && item.consumers.includes(identity.plugin))
    const task = provider.manifest.contributes.tasks?.find(item => item.id === service?.task)
    if (!service || !task || (task.scope === 'project') !== Boolean(identity.projectId)
      || !this.sameShape(consumer.schema, task.input)) throw new PluginError('DEPENDENCY_UNAVAILABLE', 'Service contract is unavailable.')
    if (input) this.task(provider, task.id, input)
    return { provider, task }
  }
  discover(identity: BackgroundIdentity) {
    this.permission(identity, 'services.public')
    return (identity.manifest.contributes.consumes?.services ?? []).flatMap(item => {
      try { const found = this.service(identity, item.plugin, item.id, item.version)
        return [{ plugin: item.plugin, service: item.id, version: item.version, scope: found.task.scope }]
      } catch { return [] }
    })
  }
  checkDependencies(identity: BackgroundIdentity): void {
    for (const item of identity.manifest.contributes.consumes?.services ?? []) if (!item.optional) this.service(identity, item.plugin, item.id, item.version)
    for (const item of identity.manifest.contributes.consumes?.events ?? []) if (!item.optional) this.eventContract(identity, item.plugin, item.id, item.version)
  }
  call(identity: BackgroundIdentity, params: { plugin: string; service: string; version: number; input: PluginMessage }): { id: string } {
    const { provider, task } = this.service(identity, params.plugin, params.service, params.version, params.input)
    return this.launch(identity, provider, task.id, params.input)
  }
  agentServices(provider: BackgroundIdentity): PluginAgentService[] {
    this.permission(provider, 'agent.services'); this.permission(provider, 'services.public')
    return (provider.manifest.contributes.services ?? []).flatMap(service => {
      const task = provider.manifest.contributes.tasks?.find(task => task.id === service.task)
      return service.consumers.includes('janusx.agent') && task && (task.scope === 'project') === Boolean(provider.projectId)
        ? [{ plugin: provider.plugin, service: service.id, version: service.version, title: task.title, scope: task.scope, input: structuredClone(task.input) }] : []
    })
  }
  async callAgent(provider: BackgroundIdentity, params: { service: string; version: number; input: PluginMessage }, signal: AbortSignal): Promise<PluginTaskRun> {
    if (signal.aborted) throw new PluginError('CANCELLED', 'Agent tool stopped.')
    if (!this.agentServices(provider).some(service => service.service === params.service && service.version === params.version)) throw new PluginError('DEPENDENCY_UNAVAILABLE', 'Agent service is unavailable.')
    const service = provider.manifest.contributes.services!.find(service => service.id === params.service && service.version === params.version)!
    // The host owns the invocation. Provider pages cannot list/cancel/read Agent results.
    const owner: BackgroundOwner = { ...provider, plugin: 'janusx.agent', scope: `${provider.scope}:agent:${randomUUID()}` }
    const { id } = this.launch(owner, provider, service.task, params.input)
    const cancel = () => { this.cancel(id, owner) }
    signal.addEventListener('abort', cancel, { once: true })
    try {
      if (signal.aborted) cancel()
      while (this.runs.get(id)?.run.state === 'running') await delay(25, undefined, { signal })
      if (signal.aborted) throw new PluginError('CANCELLED', 'Agent tool stopped.')
      owner.valid()
      const run = this.runs.get(id)?.run
      if (!run) throw new PluginError('CANCELLED', 'Agent result was removed.')
      return structuredClone(run)
    } catch (cause) {
      if (signal.aborted) throw new PluginError('CANCELLED', 'Agent tool stopped.')
      throw cause
    } finally { signal.removeEventListener('abort', cancel); this.cancel(id, owner) }
  }
  private launch(owner: BackgroundOwner, provider: BackgroundIdentity, task: string, input: PluginMessage): { id: string } {
    owner.valid(); provider.valid()
    this.budget(owner.plugin, 'task', 20)
    const active = [...this.runs.values()].filter(item => item.run.state === 'running')
    if (active.length >= 16 || active.filter(item => item.involved.has(owner.plugin) || item.involved.has(provider.plugin)).length >= 4) throw new PluginError('RATE_LIMITED', 'Task concurrency reached.')
    // Bounded history; never evict active work.
    let ownCount = [...this.runs.values()].filter(item => item.run.pluginId === owner.plugin).length
    for (const [id, item] of this.runs) if (item.run.state !== 'running' && (this.runs.size >= 128 || item.run.pluginId === owner.plugin && ownCount >= 32)) {
      this.runs.delete(id); if (item.run.pluginId === owner.plugin) ownCount--
    }
    const definition = this.task(provider, task, input)
    const id = randomUUID()
    const item: Execution = { identity: owner, controller: new AbortController(), involved: new Set([owner.plugin, provider.plugin]), steps: 0, resultBytes: 0,
      run: { id, pluginId: owner.plugin, task: `${provider.plugin}/${task}`, projectId: owner.projectId, rootId: owner.rootId,
        state: 'running', started: new Date().toISOString(), logs: [], results: [] } }
    this.runs.set(id, item); this.deps.changed()
    const timeout = setTimeout(() => { if (item.run.state === 'running') {
      item.run.state = 'timeout'; item.run.error = 'TIMEOUT'; item.controller.abort(); this.deps.changed()
    } }, definition.timeoutMs)
    void this.execute(item, provider, task, input, []).then(() => {
      if (item.run.state === 'running') item.run.state = 'completed'
    }, cause => {
      if (item.run.state === 'running') { item.run.state = 'failed'; item.run.error = cause instanceof PluginError ? cause.code : 'INTERNAL_ERROR' }
    }).finally(() => { clearTimeout(timeout); item.run.finished ??= new Date().toISOString(); this.deps.changed() })
    return { id }
  }
  private async execute(item: Execution, identity: BackgroundIdentity, taskId: string, input: PluginMessage, trace: string[]): Promise<void> {
    const key = `${identity.plugin}/${taskId}`
    if (trace.includes(key) || trace.length >= 8) throw new PluginError('CYCLE_DETECTED', 'Service cycle or depth limit reached.')
    const definition = this.task(identity, taskId, input)
    const deadline = Date.now() + definition.timeoutMs
    const serviceDeadline = trace.length ? setTimeout(() => {
      if (item.run.state === 'running') { item.run.state = 'timeout'; item.run.error = 'TIMEOUT'; item.controller.abort(); this.deps.changed() }
    }, definition.timeoutMs) : undefined
    const valid = () => {
      item.identity.valid(); identity.valid()
      if (item.controller.signal.aborted || item.run.state !== 'running') throw new PluginError('CANCELLED', 'Task stopped.')
      if (Date.now() >= deadline) throw new PluginError('TIMEOUT', 'Service deadline reached.')
    }
    try { for (const step of definition.steps) {
      valid()
      if (++item.steps > 128) throw new PluginError('RATE_LIMITED', 'Task execution step budget reached.')
      if (step.type === 'delay') await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(new PluginError('CANCELLED', 'Task stopped.')) }
        const timer = setTimeout(() => { item.controller.signal.removeEventListener('abort', abort); resolve() }, step.milliseconds)
        item.controller.signal.addEventListener('abort', abort, { once: true })
      })
      if (step.type === 'request') {
        const request: PluginNetworkRequest = { ...step.request, ...(step.bodyFromInput ? { body: JSON.stringify(input), method: 'POST' as const } : {}) }
        const result = await this.deps.network.fetch(identity.manifest, identity.scope, request, valid, item.controller.signal)
        valid(); item.resultBytes += Buffer.byteLength(result.body)
        if (item.resultBytes > 64 * 1024 || item.run.results.length >= 32) throw new PluginError('RATE_LIMITED', 'Task result budget reached.')
        item.run.results.push(result)
      }
      if (step.type === 'emit') this.publish(identity, { event: step.event, data: step.fromInput ? input : step.data })
      if (step.type === 'service') {
        const { provider, task } = this.service(identity, step.plugin, step.service, step.version, step.input)
        if (!item.involved.has(provider.plugin) && [...this.runs.values()].filter(run => run.run.state === 'running' && run.involved.has(provider.plugin)).length >= 4) throw new PluginError('RATE_LIMITED', 'Provider task concurrency reached.')
        item.involved.add(provider.plugin)
        await this.execute(item, provider, task.id, step.input, [...trace, key])
      }
      valid()
      if (item.run.logs.length < 100) item.run.logs.push({ time: new Date().toISOString(), code: step.type, ...(step.type === 'log' ? { message: step.message } : {}) })
      this.deps.changed()
    } } finally { clearTimeout(serviceDeadline) }
  }
  private sameShape(a: Record<string, string>, b: Record<string, string>): boolean {
    return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => a[key] === b[key])
  }
  private eventContract(identity: BackgroundIdentity, plugin: string, id: string, version: number) {
    this.permission(identity, 'events.public')
    const consumer = identity.manifest.contributes.consumes?.events?.find(item => item.plugin === plugin && item.id === id && item.version === version)
    const provider = this.deps.identity(plugin, identity)
    this.permission(provider, 'events.public')
    const definition = provider.manifest.contributes.events?.find(item => item.id === id && item.version === version)
    if (!definition || !consumer || !definition.consumers.includes(identity.plugin)
      || !this.sameShape(definition.data, consumer.schema) || (definition.scope === 'project') !== Boolean(identity.projectId)) throw new PluginError('DEPENDENCY_UNAVAILABLE', 'Event contract is unavailable.')
    return definition
  }
  subscribe(page: string, identity: BackgroundIdentity, plugin: string, event: string, version: number, send: (event: PluginPublicEvent) => void): string {
    this.eventContract(identity, plugin, event, version)
    if ([...this.subscriptions.values()].filter(sub => sub.page === page).length >= 32 || this.subscriptions.size >= 512) throw new PluginError('RATE_LIMITED', 'Event subscription limit reached.')
    const id = randomUUID(); this.subscriptions.set(id, { page, identity, plugin, event, version, send }); return id
  }
  publish(identity: BackgroundIdentity, params: { event: string; data: PluginMessage; cause?: string }): { id: string } {
    this.permission(identity, 'events.public'); this.budget(identity.plugin, 'event', 30)
    const definition = identity.manifest.contributes.events?.find(item => item.id === params.event)
    if (!definition || (definition.scope === 'project') !== Boolean(identity.projectId) || !matchesPluginMessage(definition.data, params.data)) throw new PluginError('INVALID_REQUEST', 'Event scope or schema does not match.')
    for (const [id, entry] of this.eventHistory) if (Date.now() - entry.time > 10_000) this.eventHistory.delete(id)
    const parent = params.cause ? this.eventHistory.get(params.cause) : undefined
    if (params.cause && (!parent || !parent.delivered.has(identity.plugin) || parent.scope !== identity.scope)) throw new PluginError('INVALID_REQUEST', 'Event cause is unavailable.')
    const trace = [...(parent?.event.trace ?? [])]
    if (trace.includes(identity.plugin) || trace.length >= 8) throw new PluginError('CYCLE_DETECTED', 'Event continuation cycle detected.')
    trace.push(identity.plugin)
    const event: PluginPublicEvent = { id: randomUUID(), source: identity.plugin, event: definition.id, version: definition.version, data: structuredClone(params.data), trace }
    const entry = { event, scope: identity.scope, delivered: new Set<string>(), time: Date.now() }
    if (this.eventHistory.size >= 256) this.eventHistory.delete(this.eventHistory.keys().next().value!)
    this.eventHistory.set(event.id, entry)
    for (const [id, sub] of this.subscriptions) if (sub.plugin === identity.plugin && sub.event === definition.id && sub.version === definition.version && sub.identity.scope === identity.scope) {
      try { sub.identity.valid(); this.eventContract(sub.identity, identity.plugin, definition.id, definition.version)
        entry.delivered.add(sub.identity.plugin); sub.send(structuredClone(event))
      } catch { this.subscriptions.delete(id) }
    }
    return { id: event.id }
  }
}
