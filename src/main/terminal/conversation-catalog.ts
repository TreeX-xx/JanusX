import type { ConversationCatalogEntry, ConversationCommand } from '../../shared/conversation-display'
import type { ConversationSession } from './conversation-session'

export interface NativeCatalogEntry extends ConversationCatalogEntry {
  /** Only the main process holds provider paths/IDs; IPC selects an opaque catalog identity. */
  invoke?(args: string): Promise<void>
}

export class ConversationCatalog {
  private entries = new Map<string, NativeCatalogEntry>()
  private loading?: Promise<void>
  constructor(private session: ConversationSession, private load: () => Promise<NativeCatalogEntry[]>) {}
  async command(command: ConversationCommand): Promise<boolean> {
    if (command.type === 'commands') { await this.refresh(); return true }
    if (command.type !== 'invoke') return false
    const { state } = this.session
    const selected = this.entries.get(command.entryId)
    if (selected?.execution === 'terminal') {
      if (state.commandsLoading || state.commandsError || command.catalogRevision !== state.commandsRevision) throw new Error('Command catalog changed; select the command again')
      await this.session.terminalCommand({ ...command, type: 'terminal-command', name: selected.name })
      return true
    }
    await this.session.submit(command, async () => {
      if (typeof command.arguments !== 'string' || command.arguments.length > 32000) throw new Error('Invalid command arguments')
      if (state.commandsLoading || state.commandsError || command.catalogRevision !== state.commandsRevision) throw new Error('Command catalog changed; select the command again')
      const entry = this.entries.get(command.entryId)
      if (!entry || entry.execution !== 'native' || !entry.invoke) throw new Error('Use the native terminal for this command')
      try {
        await entry.invoke(command.arguments)
        this.receipt(command.commandId, 'accepted')
      } catch (error) {
        // A failed transport may follow native acceptance. Keep the identity in the
        // session ledger and never automatically resend an invocation.
        this.receipt(command.commandId, 'unknown')
        throw error
      }
    })
    return true
  }
  private receipt(id: string, status: 'accepted' | 'unknown'): void {
    this.session.state.commandReceipts = [...(this.session.state.commandReceipts ?? []), { id, status }].slice(-100)
  }
  private refresh(): Promise<void> {
    if (this.loading) return this.loading
    const { state } = this.session
    state.commandsLoading = true; state.commandsError = undefined; this.session.changed()
    this.loading = Promise.resolve().then(this.load).then(rows => {
      if (state.connection !== 'ready') return
      const entries = new Map<string, NativeCatalogEntry>()
      for (const row of rows.slice(0, 1000)) {
        if (!row.id || !row.name || entries.has(row.id)) continue
        entries.set(row.id, row)
      }
      this.entries = entries
      state.commands = [...entries.values()].map(({ invoke: _invoke, ...entry }) => entry)
      state.commandsRevision = (state.commandsRevision ?? 0) + 1
    }).catch(error => { state.commandsError = String(error).slice(0, 1000) }).finally(() => {
      state.commandsLoading = false; this.loading = undefined; this.session.changed()
    })
    return this.loading
  }
}
