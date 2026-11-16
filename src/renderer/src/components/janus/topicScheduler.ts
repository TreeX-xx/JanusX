import type { JanusChatMessage, PersistedJanusConversation } from '../../../../shared/ipc/janus-chat'
import type { TopicRoute, TopicRouteRequest } from '../../../../shared/conversation-topics'
import type { AgentApprovalMode } from '../../../../shared/ipc/agent-runtime'
import type { ChatSteerResult } from '../../../../shared/ipc/llm'

type Conversation = PersistedJanusConversation
export interface TopicPorts {
  read(): Conversation[]
  update(change: (current: Conversation[]) => Conversation[]): void
  save(): Promise<void>
  route(request: TopicRouteRequest): Promise<TopicRoute>
  run(conversation: Conversation, message: JanusChatMessage): Promise<void>
  steer(conversation: Conversation, message: JanusChatMessage): Promise<ChatSteerResult>
  stop(id: string): void
  direct?(conversation: Conversation, message: JanusChatMessage): Promise<void>
  settings?(root: Conversation): { providerId?: string; modelId?: string; approvalMode?: AgentApprovalMode }
  pendingReply?(id: string): string
}

/** Busy-input routing follows .agents/notes/agent/superagent-interface.md; the engine guards each active turn. */
export class TopicScheduler {
  private routes = new Map<string, Promise<void>>()
  private running = new Set<string>()
  private started = new Set<string>()
  private deliveries = new Map<string, Promise<void>>()
  private generations = new Map<string, number>()
  private closed = false
  constructor(private ports: TopicPorts, private capacity = 4) {}
  private find(id: string) { return this.ports.read().find(c => c.id === id) }
  private siblings(c: Conversation) {
    return this.ports.read().filter(other => other.id !== c.id && other.topic?.rootId === c.topic?.rootId
      && other.topic?.workspaceId === c.topic?.workspaceId)
  }
  private busy(c: Conversation) {
    return this.running.has(c.id) || c.topic?.inputs.some(i => !['paused', 'failed'].includes(i.state))
  }
  private history(c: Conversation): JanusChatMessage[] {
    const all = this.ports.read(), before = all.slice(0, all.findIndex(other => other.id === c.id))
    const history = [...(this.find(c.topic!.rootId)?.messages ?? [])]
    for (const prior of before.filter(other => other.topic?.rootId === c.topic!.rootId && other.topic.workspaceId === c.topic!.workspaceId)) {
      if (prior.topic!.fork?.request) history.push(prior.topic!.fork.request)
      history.push(...prior.messages)
      for (const input of prior.topic!.inputs.filter(i => i.state === 'failed' || i.state === 'paused')) {
        history.push(input.message, { id: `status:${input.message.id}`, role: 'assistant', timestamp: prior.updatedAt,
          content: `[Execution ${input.state}: ${prior.topic!.diagnostic || 'Stopped or paused; no completed result is available.'}]` })
      }
    }
    const seen = new Set<string>()
    return history.filter(m => !seen.has(m.id) && !!seen.add(m.id))
  }
  private change(id: string, change: (c: Conversation) => Conversation) {
    this.ports.update(all => all.map(c => c.id === id ? { ...change(c), updatedAt: Date.now() } : c))
  }
  private fail(id: string, error: unknown) {
    this.change(id, c => c.topic ? { ...c, topic: { ...c.topic,
      diagnostic: error instanceof Error ? error.message : String(error),
      state: c.topic.state === 'routing' ? 'choice' : c.topic.state,
      inputs: c.topic.inputs.map(i => ({ ...i, state: i.state === 'running' ? 'failed' : 'paused' })) } } : c)
  }
  async retryDirect(id: string): Promise<void> {
    const conversation = this.find(id), message = conversation?.messages[0]
    if (this.closed || !conversation?.topic?.direct || !message || this.deliveries.has(id)) return
    const run = async () => {
      try {
        if (!this.ports.direct) throw new Error('Direct Worker delivery is unavailable')
        if (message.context?.delivery !== 'sent') await this.ports.direct(conversation, message)
        this.change(id, c => ({ ...c, messages: c.messages.map(m => m.id === message.id ? { ...m, context: { ...m.context!, delivery: 'sent' } } : m), topic: { ...c.topic!, diagnostic: undefined } }))
      } catch (error) {
        this.change(id, c => ({ ...c, messages: c.messages.map(m => m.id === message.id ? { ...m, context: { ...m.context!, delivery: 'failed' } } : m), topic: { ...c.topic!, diagnostic: String(error) } }))
      }
      try { await this.ports.save() } catch (error) {
        // The pre-dispatch record already exists. Never restore the composer
        // and mint another input identity after delivery was attempted.
        this.change(id, c => ({ ...c, topic: { ...c.topic!, diagnostic: String(error) } }))
      }
    }
    const delivery = run(); this.deliveries.set(id, delivery)
    try { await delivery } finally { this.deliveries.delete(id) }
  }
  async submit(rootId: string, workspaceId: string | null, text: string, separate = false, context?: JanusChatMessage['context'], options?: { targetId?: string }): Promise<void> {
    if (this.closed) return
    const root = this.find(rootId), content = text.trim()
    if (!root || !content) return
    if (content.length > 100_000) throw new Error('Conversation storage limit reached')
    const id = crypto.randomUUID(), now = Date.now()
    const settings = this.ports.settings?.(root) ?? root
    const message: JanusChatMessage = { id: crypto.randomUUID(), role: 'user', content, timestamp: now, workspaceId, ...(context ? { context } : {}) }
    if (options?.targetId) {
      const target = this.find(options.targetId)
      if (!target?.topic || target.topic.rootId !== rootId || target.topic.workspaceId !== workspaceId || target.topic.state !== 'ready' || target.topic.direct || target.topic.afterGroup) throw new Error('Topic is no longer available')
      if (context?.worker?.kind === 'worker') throw new Error('Cancel the conversation branch target before sending directly to a Worker')
      this.change(target.id, c => ({...c,topic:{...c.topic!,inputs:[...c.topic!.inputs,{message,state:'queued'}]}}))
      try { await this.ports.save(); await this.deliver(target.id); this.pump() } catch (error) { this.fail(target.id,error) }
      return
    }
    if (context?.worker?.kind === 'worker') {
      if (!workspaceId || context.worker.workspaceId !== workspaceId) throw new Error('Worker workspace changed')
      if (this.ports.read().length >= 95) throw new Error('Conversation storage limit reached')
      const direct: Conversation = { id, title: context.worker.title, createdAt: now, updatedAt: now,
        messages: [{ ...message, context: { ...context, delivery: 'pending' } }], attachedWorkspaceIds: [workspaceId], toolTraces: [],
        topic: { rootId, workspaceId, base: [], inputs: [], state: 'ready', direct: true } }
      this.ports.update(all => [...all, direct])
      try { await this.ports.save() } catch (error) { this.ports.update(all => all.filter(c => c.id !== id)); throw error }
      await this.retryDirect(id)
      return
    }
    const scope = this.ports.read().filter(c => c.topic?.rootId === rootId && c.topic.workspaceId === workspaceId)
    const last = scope.at(-1)
    if (last?.topic?.state === 'ready' && !last.topic.direct && !last.topic.fork && !last.topic.inputs.length
      && !scope.some(c => this.busy(c) || c.topic!.state === 'routing')) {
      this.change(last.id, c => ({ ...c,
        topic: { ...c.topic!, inputs: [{ message, state: 'queued' }], diagnostic: undefined,
          approvalMode: 'approvalMode' in settings ? settings.approvalMode : c.topic!.approvalMode } }))
      try { await this.ports.save(); this.pump() } catch (error) { this.fail(last.id, error) }
      return
    }
    if (this.ports.read().length >= 95) throw new Error('Conversation storage limit reached')
    const needsRouting = scope.some(c => this.busy(c) || c.topic!.state === 'routing')
    const provisional: Conversation = { id, title: content.replace(/\s+/g, ' ').slice(0, 80), createdAt: now, updatedAt: now,
      messages: [], attachedWorkspaceIds: workspaceId ? [workspaceId] : [], toolTraces: [],
      providerId: settings.providerId, modelId: settings.modelId, engineeringContext: structuredClone(root.engineeringContext),
      topic: { rootId, workspaceId, base: [],
        approvalMode: 'approvalMode' in settings ? settings.approvalMode : undefined,
        state: needsRouting ? 'routing' : 'ready', inputs: [{ message, state: 'queued' }] } }
    this.ports.update(all => [...all, provisional])
    if (!needsRouting) {
      try { await this.ports.save(); this.pump() } catch (error) { this.fail(id, error) }
      return
    }
    const key = `${rootId}:${workspaceId ?? ''}`
    const prior = this.routes.get(key) ?? Promise.resolve()
    const next = prior.then(async () => {
      if (this.find(id)?.topic?.state !== 'routing') return
      try {
        await this.ports.save()
        const siblings = this.siblings(provisional).filter(c => c.topic!.state === 'ready')
        const active = siblings.filter(c => this.busy(c) && !c.topic!.afterGroup)
        const group = active.find(c => c.topic!.fork)?.topic!.fork?.id
        if (separate) { await this.resolve(id, { kind: 'new' }); return }
        if (!active.length) {
          const last = siblings.at(-1)
          if (last && !last.topic!.direct && !last.topic!.fork && !last.topic!.inputs.length) {
            await this.resolve(id, { kind: 'continue', targetId: last.id }); return
          }
          await this.resolve(id, { kind: 'new' }); return
        }
        const candidates = (group?siblings.filter(c=>c.topic!.fork?.id===group):active)
          .sort((a, b) => b.updatedAt - a.updatedAt).map(c => {
            const seen = new Set(c.messages.map(m => m.id))
            const pending = c.topic!.inputs.filter(i => !seen.has(i.message.id))
            const reply = this.ports.pendingReply?.(c.id)
            return { id: c.id, title: c.title, messages: [...c.messages,
              ...pending.filter(i => i.state === 'running').map(i => i.message),
              ...(reply ? [{ role: 'assistant', content: reply }] : []),
              ...pending.filter(i => i.state !== 'running').map(i => i.message)]
              .slice(-6).map(m => ({ role: m.role, content: m.content })) }
          })
        const result = candidates.length ? await this.ports.route({ text: content, candidates,
          context: active[0].topic!.base.slice(-6).map(m => ({ role: m.role, content: m.content })),
          providerId: provisional.providerId, modelId: provisional.modelId }) : { kind: 'new' as const }
        if (this.find(id)?.topic?.state !== 'routing') return
        if (group && result.kind === 'wait') {
          const waiting = siblings.find(c => c.topic!.afterGroup === group && c.topic!.inputs[0]?.state === 'queued')
          if (waiting) { await this.resolve(id, { kind: 'continue', targetId: waiting.id }); return }
          this.change(id, c => ({ ...c, topic: { ...c.topic!, afterGroup: group } }))
        }
        await this.resolve(id, result)
      } catch (error) { this.fail(id, error) }
    })
    this.routes.set(key, next)
    await next
    if (this.routes.get(key) === next) this.routes.delete(key)
  }
  async resolve(id: string, result: TopicRoute): Promise<void> {
    const source = this.find(id)
    if (!source?.topic || source.topic.state === 'ready') return
    try {
      if (result.kind === 'continue') {
        const target = this.find(result.targetId)
        if (!target?.topic || target.id === id || target.topic.state !== 'ready'
          || target.topic.rootId !== source.topic.rootId || target.topic.workspaceId !== source.topic.workspaceId) throw new Error('Topic is no longer available')
        this.ports.update(all => all.filter(c => c.id !== id).map(c => c.id === target.id ? { ...c, updatedAt: Date.now(),
          topic: { ...c.topic!, ...(!this.busy(c)?{approvalMode:source.topic!.approvalMode??c.topic!.approvalMode}:{}), inputs: [...c.topic!.inputs, ...source.topic!.inputs.map(i => ({ ...i, state: 'queued' as const }))] } } : c))
        try { await this.ports.save() } catch (e) { this.fail(target.id, e); return }
        await this.deliver(target.id)
      } else {
        if (result.kind === 'new' && !source.topic.afterGroup) {
          const target = this.siblings(source).find(c => c.topic!.state === 'ready' && !c.topic!.afterGroup && this.busy(c))
          if (target?.topic?.fork) {
            this.change(id, c => ({ ...c, topic: { ...c.topic!, base: structuredClone([
              ...target.topic!.base, ...target.messages.slice(0, target.topic!.fork!.start)]),
              fork: { id: target.topic!.fork!.id, start: 0 } } }))
          } else if (target) {
            const input = target.topic!.inputs[0]?.message
            const index = target.messages.findIndex(m => m.id === input?.id)
            const start = index < 0 ? target.messages.length : index
            const base = structuredClone([...target.topic!.base, ...target.messages.slice(0, start)])
            this.change(target.id, c => ({ ...c, title: input?.content.replace(/\s+/g, ' ').slice(0, 80) || c.title,
              topic: { ...c.topic!, fork: { id: target.id, start } } }))
            this.change(id, c => ({ ...c, topic: { ...c.topic!, base, fork: { id: target.id, start: 0 } } }))
          }
        }
        this.change(id, c => ({ ...c, topic: { ...c.topic!, diagnostic: undefined,
          state: result.kind === 'choice' ? 'choice' : 'ready', inputs: c.topic!.inputs.map(i => ({ ...i, state: 'queued' })) } }))
        await this.ports.save()
      }
      this.pump()
    } catch (error) { this.fail(id, error) }
  }
  /** The engine receipt, rather than the RPC acknowledgement, commits adoption. */
  consume(id: string, keys: string[]): void {
    this.change(id, c => {
      const inputs = c.topic!.inputs.map(i => keys.includes(i.message.id) && ['steering', 'accepted', 'paused'].includes(i.state)
        ? { ...i, state: 'consumed' as const, error: undefined } : i)
      return { ...c, topic: { ...c.topic!, inputs, diagnostic: inputs.find(i => i.error)?.error } }
    })
    void this.ports.save().catch(error => this.fail(id, error))
  }
  withdraw(id: string, entryId: string): void {
    this.change(id, c => ({ ...c, topic: { ...c.topic!, inputs: c.topic!.inputs.filter(i => i.message.id !== entryId) } }))
    void this.ports.save().catch(error => this.fail(id, error))
  }
  private deliver(id: string): Promise<void> {
    const pending = this.deliveries.get(id)
    if (pending) return pending
    if (!this.started.has(id)) return Promise.resolve()
    const generation = this.generations.get(id) ?? 0
    const current = () => (this.generations.get(id) ?? 0) === generation
    const delivery = Promise.resolve().then(async () => {
      while (current() && this.started.has(id)) {
        const input = this.find(id)?.topic?.inputs.find(i => i.state === 'queued')
        if (!input) return
        const change = (state: typeof input.state, error?: string) => this.change(id, c => {
          const entry = c.topic!.inputs.find(i => i.message.id === input.message.id)
          if (!entry || entry.state === 'consumed') return c
          return { ...c, topic: { ...c.topic!, inputs: c.topic!.inputs.map(i => i === entry ? { ...i, state, error } : i),
            ...(error ? { diagnostic: error } : {}) } }
        })
        change('steering')
        try {
          await this.ports.save()
          if (!current() || !this.started.has(id)) { if (current()) change('queued'); return }
          const result = await this.ports.steer(this.find(id)!, input.message)
          if (!current()) return
          if (!result.accepted && result.error === 'No active stream for this conversation') {
            change('queued'); await this.ports.save(); return
          }
          change(result.accepted ? 'accepted' : 'paused', result.accepted ? undefined : result.error || 'Follow-up was not accepted')
          await this.ports.save()
        } catch (error) {
          if (current() && this.find(id)?.topic?.inputs.find(i => i.message.id === input.message.id)?.state === 'consumed') continue
          if (current()) change('paused', error instanceof Error ? error.message : String(error))
          await this.ports.save().catch(() => undefined)
          return
        }
      }
    }).finally(() => { if (this.deliveries.get(id) === delivery) this.deliveries.delete(id) })
    this.deliveries.set(id, delivery)
    return delivery
  }
  stop(id: string): void {
    this.generations.set(id, (this.generations.get(id) ?? 0) + 1)
    this.deliveries.delete(id)
    this.change(id, c => c.topic ? { ...c, topic: { ...c.topic, state: c.topic.state === 'routing' ? 'choice' : c.topic.state,
      inputs: c.topic.inputs.map(i => ({ ...i, state: 'paused' })) } } : c)
    this.ports.stop(id)
    void this.ports.save().then(() => this.pump()).catch(e => this.fail(id, e))
  }
  async resume(id: string): Promise<void> {
    if (this.running.has(id)) return
    this.change(id, c => c.topic ? { ...c, topic: { ...c.topic, diagnostic: undefined,
      inputs: c.topic.inputs.map(i => ({ ...i, state: 'queued', error: undefined })) } } : c)
    try { await this.ports.save(); this.pump() } catch (e) { this.fail(id, e) }
  }
  private pump(): void {
    if (this.closed) return
    for (const c of this.ports.read()) {
      if (this.running.size >= this.capacity) break
      if (!c.topic || c.topic.state !== 'ready' || c.topic.inputs[0]?.state !== 'queued' || this.running.has(c.id)) continue
      if (c.topic.afterGroup && this.siblings(c).some(other => other.topic!.fork?.id === c.topic!.afterGroup && this.busy(other))) continue
      this.running.add(c.id)
      void this.execute(c.id)
    }
  }
  activate(): void { this.closed = false }
  dispose(): void {
    this.closed = true
    for (const c of this.ports.read()) if (c.topic?.inputs.length) this.stop(c.id)
  }
  private async execute(id: string): Promise<void> {
    const generation = this.generations.get(id) ?? 0
    const input = this.find(id)?.topic?.inputs[0]
    if (!input) { this.running.delete(id); return }
    try {
      this.change(id, c => {
        const base = c.topic!.fork ? c.topic!.base : this.history(c)
        const changed = JSON.stringify(base) !== JSON.stringify(c.topic!.base)
        return { ...c, ...(changed ? { contextCheckpoint: undefined, contextEpoch: (c.contextEpoch ?? 0) + 1 } : {}),
          topic: { ...c.topic!, base, afterGroup: undefined,
            inputs: c.topic!.inputs.map(i => i.message.id === input.message.id ? { ...i, state: 'running' } : i) } }
      })
      await this.ports.save()
      if ((this.generations.get(id) ?? 0) !== generation) return
      const current = this.find(id)
      if (!current) return
      this.started.add(id)
      const execution = this.ports.run(current, input.message)
      void this.deliver(id)
      await execution
      this.started.delete(id)
      await this.deliveries.get(id)
      if ((this.generations.get(id) ?? 0) !== generation) return
      this.change(id, c => {
        const inputs = c.topic!.inputs.filter(i => i.message.id !== input.message.id && i.state !== 'consumed')
          .map(i => ['steering', 'accepted'].includes(i.state) ? { ...i, state: 'paused' as const, error: 'Response ended before this follow-up was applied' } : i)
        return { ...c, topic: { ...c.topic!, inputs, diagnostic: inputs.find(i => i.error)?.error } }
      })
      await this.ports.save()
    } catch (error) {
      if ((this.generations.get(id) ?? 0) === generation) {
        this.generations.set(id, generation + 1)
        this.deliveries.delete(id)
        this.fail(id, error)
      }
    } finally { this.started.delete(id); this.running.delete(id); this.pump() }
  }
}

/** Reload never replays uncertain model/tool execution. Only an explicit resume can restart it. */
export function recoverTopics(conversations: Conversation[]): Conversation[] {
  return conversations.map(c => !c.topic ? c : { ...c, topic: { ...c.topic,
    state: c.topic.state === 'routing' ? 'choice' : c.topic.state,
    inputs: c.topic.inputs.map(i => ({ ...i, state: 'paused' })) } })
}
