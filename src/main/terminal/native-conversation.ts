import { ConversationCatalog, type NativeCatalogEntry } from './conversation-catalog'
import { ConversationSession, conversationState } from './conversation-session'
import { randomUUID } from 'node:crypto'
import type { ConversationCommand, ConversationEngine, ConversationItem, ConversationSnapshot } from '../../shared/conversation-display'

export type NativeEvent = { type: 'session' | 'start' | 'end' | 'item' | 'attention' | 'error'; sessionId?: string; path?: string; model?: string; turnId?: string; item?: ConversationItem; pending?: boolean; error?: string; outcome?: 'completed' | 'interrupted' | 'failed' }
export type NativeLaunch = { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; assetsDir: string; pathDir?: string }

/** Common control fences for native adapters. Execution remains in the provider. */
export abstract class NativeConversation {
  readonly state: ConversationSnapshot
  protected session: ConversationSession
  private catalog: ConversationCatalog
  protected disposed = false
  private broken = false
  constructor(readonly id: string, engine: ConversationEngine, publish: (value: ConversationSnapshot) => void,
    private readonly bind: (sessionId: string, path?: string) => void = () => {}) {
    this.state = conversationState(id, engine)
    this.session = new ConversationSession(this.state, publish)
    this.catalog = new ConversationCatalog(this.session, () => this.loadCommands())
  }
  snapshot(): ConversationSnapshot { return this.session.snapshot() }
  protected changed(immediate = false): void { this.session.changed(immediate) }

  protected fail(error: string): void {
    if (this.disposed) return
    this.broken = true; this.state.connection = 'disconnected'; this.state.error = error; this.changed()
  }
  protected receive(event: NativeEvent): void {
    if (this.disposed || this.broken) return
    if (event.type === 'session' && event.sessionId) {
      if (this.state.threadId && this.state.threadId !== event.sessionId) { this.fail('Native session changed. Create a new dual-mode terminal.'); return }
      if (!this.state.threadId) { this.state.threadId = event.sessionId; this.bind(event.sessionId, event.path) }
      this.state.model = event.model ?? this.state.model; this.state.connection = 'ready'
    } else if (event.type === 'start') {
      if (!this.state.turnId) { this.state.turnId = event.turnId ?? randomUUID(); this.state.turnStartedAt = Date.now() }
    } else if (event.type === 'end') {
      if (event.error) this.receive({ type: 'item', item: { id: `error:${this.state.turnId}`, turnId: this.state.turnId ?? '', type: 'error', text: event.error, status: 'failed' } })
      for (const item of this.state.items) if (item.turnId === this.state.turnId) {
        if (item.status === 'inProgress') item.status = event.outcome ?? 'completed'
        this.session.discoverImages(item.id)
        if (item.type === 'agentMessage' && this.state.turnStartedAt) item.durationMs = Date.now() - this.state.turnStartedAt
      }
      this.state.turnId = null; this.state.turnStartedAt = undefined; this.state.needsTerminal = false
    } else if (event.type === 'item' && event.item) {
      const next = { ...event.item, text: event.item.text.slice(0, 32000), truncated: event.item.text.length > 32000 || event.item.truncated }
      const existing = this.state.items.find(item => item.id === next.id)
      if (existing) Object.assign(existing, next, { receivedAt: existing.receivedAt })
      else this.state.items.push({ ...next, receivedAt: next.receivedAt ?? Date.now() })
      this.session.discoverImages(next.id)
      if (this.state.items.length > 500) { this.state.items.shift(); this.state.truncated = true }
    } else if (event.type === 'attention') {
      if (this.state.needsTerminal === !!event.pending) return
      this.state.needsTerminal = !!event.pending
    }
    else if (event.type === 'error') { this.fail(event.error ?? 'Native bridge failed'); return }
    this.changed()
  }
  protected async loadCommands(): Promise<NativeCatalogEntry[]> { return [] }
  protected abstract deliver(command: { id: string; type: 'send' | 'interrupt'; text?: string; sessionId: string; turnId: string | null }): Promise<void>
  protected async editHistory(_item: ConversationItem): Promise<void> { throw new Error('Native history editing is unavailable') }
  async command(command: ConversationCommand): Promise<ConversationSnapshot> {
    if (this.disposed) throw new Error('Session closed')
    if (command.type === 'mode') return this.session.mode(command, this.disposed)
    this.session.guard(command, this.disposed)
    if (command.type === 'commands' || command.type === 'invoke') { await this.catalog.command(command); return this.snapshot() }
    if (command.type !== 'send' && command.type !== 'edit' && command.type !== 'interrupt') throw new Error('Use the native terminal for this action')
    if (command.type === 'send' || command.type === 'edit') {
      await this.session.submit(command, async () => {
        const itemId = command.type === 'edit' ? command.itemId : undefined
        const target = itemId ? this.state.items.find(item => item.id === itemId) : undefined
        if (command.type === 'edit' && (!this.state.capabilities.edit || !target || target.type !== 'userMessage' || target.truncated || target.editable === false)) throw new Error('This message cannot be edited safely')
        const sessionId = this.state.threadId!
        if (target) await this.editHistory(target)
        await this.deliver({ id: command.commandId, type: 'send', text: command.text, sessionId, turnId: this.state.turnId })
      })
    } else if (this.state.turnId) {
      await this.deliver({ id: randomUUID(), type: 'interrupt', sessionId: this.state.threadId!, turnId: this.state.turnId })
    }
    return this.snapshot()
  }
  acceptsTerminalInput(data: string): boolean { return this.state.mode === 'terminal' || /^\x1b\[[?\d;]*[Rcn]$/.test(data) }
  protected close(): void {
    this.disposed = true; this.session.stop()
    this.state.connection = 'closed'; this.state.turnId = null; this.changed(true)
  }
  abstract start(options: NativeLaunch): Promise<{ command: string; args: string[] }>
  abstract dispose(): Promise<void>
}
