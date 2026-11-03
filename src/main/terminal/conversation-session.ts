import type { ConversationCapabilities, ConversationCommand, ConversationEngine, ConversationSnapshot } from '../../shared/conversation-display'
import { parseConversationSlashCommand, validateConversationDelivery } from '../../shared/conversation-display'
import { storeConversationImage } from './conversation-images'
import { createHash } from 'node:crypto'
import { conversationImageLinks } from '../../shared/conversation-images'

// Design: .agents/notes/workbench/terminal-dialog-dual-mode.md
// Composition only: transports, native events and process ownership stay in adapters.
export function conversationState(id: string, engine: ConversationEngine, capabilities: Partial<ConversationCapabilities> = {}): ConversationSnapshot {
  return { id, engine, capabilities: { submit: true, cancel: true, settings: false, approvals: false, liveText: true, ...capabilities },
    revision: 0, mode: 'terminal', controlEpoch: 0, connection: 'starting', threadId: null, turnId: null,
    submitting: false, items: [], approvals: [], needsTerminal: false, truncated: false, model: null, effort: null,
    models: [], modelsLoading: false, settingsUpdating: false }
}

export class ConversationSession {
  private closed = false
  private imageRoot = ''
  private cwd = ''
  private imageJobs = new Map<string, string>()
  private timer?: ReturnType<typeof setTimeout>
  private sent = new Map<string, { identity: string; promise: Promise<void> }>()
  constructor(readonly state: ConversationSnapshot, private publish: (snapshot: ConversationSnapshot) => void) {}
  snapshot(): ConversationSnapshot { return structuredClone(this.state) }
  configureImages(root: string, cwd: string): void { this.imageRoot = root; this.cwd = cwd }
  discoverImages(itemId: string): void {
    const item = this.state.items.find(row => row.id === itemId)
    if (item?.status === 'completed' && item.type !== 'userMessage' && !item.images?.length) {
      this.attachImages(itemId, conversationImageLinks(item.text).map(path => ({ path })))
    }
  }
  attachImages(itemId: string, sources: Array<{ path?: string; data?: string }>): void {
    const item = this.state.items.find(row => row.id === itemId)
    if (!item || this.closed || !sources.length) return
    const bounded = sources.slice(0, 8)
    const signature = createHash('sha256').update(JSON.stringify(bounded)).digest('hex')
    if (this.imageJobs.get(itemId) === signature) return
    this.imageJobs.set(itemId, signature)
    for (const id of this.imageJobs.keys()) if (!this.state.items.some(row => row.id === id)) this.imageJobs.delete(id)
    item.images = bounded.map((source, index) => ({ id: `${itemId}:${index}`, source: source.path, status: 'loading' }))
    void Promise.all(bounded.map(async (source, index) => {
      try { return { ...await storeConversationImage(this.imageRoot, source, this.cwd), source: source.path, status: 'ready' as const } }
      catch (error) { return { id: `${itemId}:${index}`, source: source.path, status: 'unavailable' as const, error: String(error).slice(0, 300) } }
    })).then(images => {
      const current = this.state.items.find(row => row.id === itemId)
      if (this.closed || !current || this.imageJobs.get(itemId) !== signature) return
      current.images = images; this.changed()
    })
  }
  changed(immediate = true): void {
    if (this.closed) immediate = true
    this.state.revision++
    if (!immediate && this.timer) return
    this.cancelPublish()
    if (immediate) this.publish(this.snapshot())
    else this.timer = setTimeout(() => { this.timer = undefined; this.publish(this.snapshot()) }, 32)
  }
  cancelPublish(): void { if (this.timer) clearTimeout(this.timer); this.timer = undefined }
  stop(): void { this.closed = true; this.cancelPublish() }
  mode(command: Extract<ConversationCommand, { type: 'mode' }>, disposed: boolean): ConversationSnapshot {
    if (disposed || this.closed) throw new Error('Session closed')
    if (command.mode !== 'terminal' && command.mode !== 'conversation') throw new Error('Invalid display mode')
    if (this.state.submitting || this.state.settingsUpdating) throw new Error('Wait for the current delivery or settings update')
    if (this.state.mode !== command.mode) { this.state.mode = command.mode; this.state.controlEpoch++; this.changed() }
    return this.snapshot()
  }
  guard(command: Exclude<ConversationCommand, { type: 'mode' }>, disposed: boolean): void {
    if (disposed || this.closed || this.state.connection !== 'ready' || !this.state.threadId) throw new Error('Conversation unavailable; session is not ready')
    if (this.state.mode !== 'conversation' || command.controlEpoch !== this.state.controlEpoch) throw new Error('Stale conversation control; Display control changed')
  }
  async submit(command: Extract<ConversationCommand, { type: 'send' | 'edit' | 'invoke' }>, work: () => Promise<void>): Promise<void> {
    if (typeof command.commandId !== 'string' || !command.commandId || command.commandId.length > 128) throw new Error('Invalid command identity')
    const identity = JSON.stringify(command.type === 'invoke'
      ? [command.type, command.entryId, command.catalogRevision, command.arguments, command.controlEpoch]
      : [command.type, command.text, command.controlEpoch, command.type === 'edit' ? command.itemId : null,
        command.type === 'send' ? [command.delivery, command.expectedTurnId, command.imagePaths] : null])
    const old = this.sent.get(command.commandId)
    if (old) { if (old.identity !== identity) throw new Error('Command identity reused'); return old.promise }
    validateConversationDelivery(this.state, command)
    if (command.type !== 'invoke' && (typeof command.text !== 'string' || !command.text.trim() || command.text.length > 32000)) throw new Error('Invalid prompt length')
    if (command.type !== 'invoke' && parseConversationSlashCommand(command.text, this.state.commands)) throw new Error('Use the command menu or native terminal for slash commands')
    if (this.state.submitting || this.state.settingsUpdating || this.state.approvals.length || this.state.needsTerminal
      || (this.state.turnId && (command.type !== 'send' || !this.state.capabilities.liveInput))) throw new Error('Conversation is busy or needs terminal input')
    if (this.sent.size >= 2000) throw new Error('Conversation command limit reached; create a new terminal')
    this.state.submitting = true; this.changed()
    // Install the ledger before executing work, including synchronous provider callbacks.
    const promise = Promise.resolve().then(() => { this.guard(command, false); return work() }).finally(() => { this.state.submitting = false; this.changed() })
    this.sent.set(command.commandId, { identity, promise })
    return promise
  }
}
