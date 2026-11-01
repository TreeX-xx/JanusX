import { randomUUID } from 'node:crypto'
import type { ConversationCommand, ConversationEngine, ConversationItem, ConversationSnapshot } from '../../shared/conversation-display'
import { parseConversationSlashCommand } from '../../shared/conversation-display'

export type NativeEvent = { type: 'session' | 'start' | 'end' | 'item' | 'attention' | 'error'; sessionId?: string; path?: string; model?: string; turnId?: string; item?: ConversationItem; pending?: boolean; error?: string; outcome?: 'completed' | 'interrupted' | 'failed' }
export type NativeLaunch = { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; assetsDir: string; pathDir?: string }

/** Common control fences for native adapters. Execution remains in the provider. */
export abstract class NativeConversation {
  readonly state: ConversationSnapshot
  protected disposed = false
  private broken = false
  private sent = new Map<string, { text: string; itemId?: string; promise: Promise<void> }>()
  private publishTimer?: ReturnType<typeof setTimeout>
  constructor(readonly id: string, engine: ConversationEngine, private readonly publish: (value: ConversationSnapshot) => void,
    private readonly bind: (sessionId: string, path?: string) => void = () => {}) {
    this.state = { id, engine, capabilities: { submit: true, cancel: true, settings: false, approvals: false, liveText: true },
      revision: 0, mode: 'terminal', controlEpoch: 0, connection: 'starting', threadId: null, turnId: null,
      submitting: false, items: [], approvals: [], needsTerminal: false, truncated: false, model: null, effort: null,
      models: [], modelsLoading: false, settingsUpdating: false }
  }
  snapshot(): ConversationSnapshot { return structuredClone(this.state) }
  protected changed(): void {
    this.state.revision++
    if (!this.publishTimer) this.publishTimer = setTimeout(() => { this.publishTimer = undefined; this.publish(this.snapshot()) }, 32)
  }
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
        if (item.type === 'agentMessage' && this.state.turnStartedAt) item.durationMs = Date.now() - this.state.turnStartedAt
      }
      this.state.turnId = null; this.state.turnStartedAt = undefined; this.state.needsTerminal = false
    } else if (event.type === 'item' && event.item) {
      const next = { ...event.item, text: event.item.text.slice(0, 32000), truncated: event.item.text.length > 32000 || event.item.truncated }
      const existing = this.state.items.find(item => item.id === next.id)
      if (existing) Object.assign(existing, next, { receivedAt: existing.receivedAt })
      else this.state.items.push({ ...next, receivedAt: next.receivedAt ?? Date.now() })
      if (this.state.items.length > 500) { this.state.items.shift(); this.state.truncated = true }
    } else if (event.type === 'attention') {
      if (this.state.needsTerminal === !!event.pending) return
      this.state.needsTerminal = !!event.pending
    }
    else if (event.type === 'error') { this.fail(event.error ?? 'Native bridge failed'); return }
    this.changed()
  }
  protected abstract deliver(command: { id: string; type: 'send' | 'interrupt'; text?: string; sessionId: string; turnId: string | null }): Promise<void>
  protected async editHistory(_item: ConversationItem): Promise<void> { throw new Error('Native history editing is unavailable') }
  async command(command: ConversationCommand): Promise<ConversationSnapshot> {
    if (this.disposed) throw new Error('Session closed')
    if (command.type === 'mode') {
      if (!['terminal', 'conversation'].includes(command.mode)) throw new Error('Invalid display mode')
      if (this.state.submitting) throw new Error('Wait for the current delivery')
      if (this.state.mode !== command.mode) { this.state.mode = command.mode; this.state.controlEpoch++; this.changed() }
      return this.snapshot()
    }
    if (this.state.mode !== 'conversation' || command.controlEpoch !== this.state.controlEpoch) throw new Error('Stale conversation control')
    if (this.state.connection !== 'ready' || !this.state.threadId) throw new Error('Native session unavailable; use the terminal')
    if (command.type !== 'send' && command.type !== 'edit' && command.type !== 'interrupt') throw new Error('Use the native terminal for this action')
    if (command.type === 'send' || command.type === 'edit') {
      const itemId = command.type === 'edit' ? command.itemId : undefined
      const old = this.sent.get(command.commandId)
      if (old) { if (old.text !== command.text || old.itemId !== itemId) throw new Error('Command ID reused'); await old.promise; return this.snapshot() }
      if (!command.text.trim() || command.text.length > 100000 || parseConversationSlashCommand(command.text)) throw new Error('Send plain text; run slash commands in the terminal')
      if (this.state.turnId || this.state.submitting || this.state.needsTerminal) throw new Error('Native session is busy')
      if (this.sent.size >= 2000) throw new Error('Conversation command limit reached; create a new terminal')
      const target = itemId ? this.state.items.find(item => item.id === itemId) : undefined
      if (command.type === 'edit' && (!this.state.capabilities.edit || !target || target.type !== 'userMessage' || target.truncated || target.editable === false)) throw new Error('This message cannot be edited safely')
      this.state.submitting = true; this.changed()
      const sessionId = this.state.threadId
      const promise = (async () => {
        if (target) await this.editHistory(target)
        await this.deliver({ id: command.commandId, type: 'send', text: command.text, sessionId, turnId: null })
      })()
      this.sent.set(command.commandId, { text: command.text, itemId, promise })
      try { await promise } finally { this.state.submitting = false; this.changed() }
    } else if (this.state.turnId) {
      await this.deliver({ id: randomUUID(), type: 'interrupt', sessionId: this.state.threadId, turnId: this.state.turnId })
    }
    return this.snapshot()
  }
  acceptsTerminalInput(data: string): boolean { return this.state.mode === 'terminal' || /^\x1b\[[?\d;]*[Rcn]$/.test(data) }
  protected close(): void {
    this.disposed = true; if (this.publishTimer) clearTimeout(this.publishTimer)
    this.state.connection = 'closed'; this.state.turnId = null; this.state.revision++; this.publish(this.snapshot())
  }
  abstract start(options: NativeLaunch): Promise<{ command: string; args: string[] }>
  abstract dispose(): Promise<void>
}
