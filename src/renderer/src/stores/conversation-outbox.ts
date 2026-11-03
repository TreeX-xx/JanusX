import { create } from 'zustand'
import type { ConversationReference } from '../../../shared/conversation-context'
import { parseConversationSlashCommand, type ConversationSnapshot } from '../../../shared/conversation-display'

export interface OutgoingMessage {
  id: string
  text: string
  references?: ConversationReference[]
  draftText?: string
  delivery?: 'queue' | 'steer'
  expectedTurnId?: string
  imagePaths?: string[]
  threadId: string | null
  controlEpoch: number
  status: 'queued' | 'sending' | 'accepted' | 'failed'
  baseline: string[]
  dispatched?: boolean
  error?: string
}
const empty: OutgoingMessage[] = []
export const useConversationOutbox = create<{ entries: Record<string, OutgoingMessage[]> }>(() => ({ entries: {} }))
export const conversationOutbox = (id: string) => useConversationOutbox.getState().entries[id] ?? empty
const snapshots = new Map<string, ConversationSnapshot>()
const inFlight = new Set<string>()
const runtimes = new Map<string, number | undefined>()
export function bindConversationOutbox(id: string, pid: number | undefined): void {
  if (runtimes.has(id) && runtimes.get(id) !== pid) {
    snapshots.delete(id)
    inFlight.delete(id)
    update(id, conversationOutbox(id).map(item => ({ ...item, status: 'failed', error: 'Conversation restarted. Check the terminal before sending again.' })))
  }
  runtimes.set(id, pid)
}
function update(id: string, entries: OutgoingMessage[]) {
  useConversationOutbox.setState(state => ({ entries: { ...state.entries, [id]: entries } }))
}

/** Runtime-only outbox survives pane remounts; never persist or retry uncertain deliveries. */
export function enqueueConversationMessage(snapshot: ConversationSnapshot, text: string, delivery?: 'queue' | 'steer', imagePaths?: string[], references?: ConversationReference[], draftText?: string): boolean {
  if (!text.trim() || text.length > 32000 || parseConversationSlashCommand(text, snapshot.commands) || conversationOutbox(snapshot.id).length >= 100) return false
  update(snapshot.id, [...conversationOutbox(snapshot.id), {
    id: crypto.randomUUID(), text, references, draftText, delivery, imagePaths, expectedTurnId: delivery === 'steer' ? snapshot.turnId ?? undefined : undefined, threadId: snapshot.threadId, controlEpoch: snapshot.controlEpoch, status: 'queued', baseline: [],
  }])
  observeConversationOutbox(snapshot)
  return true
}

export function removeOutgoingMessage(id: string, messageId: string): void {
  update(id, conversationOutbox(id).filter(item => item.id !== messageId || item.status === 'sending' || item.status === 'accepted'))
  const snapshot = snapshots.get(id)
  if (snapshot) observeConversationOutbox(snapshot)
}

export function observeConversationOutbox(snapshot: ConversationSnapshot): void {
  const previous = snapshots.get(snapshot.id)
  if (previous && previous.revision > snapshot.revision) return
  snapshots.set(snapshot.id, snapshot)
  const entries = conversationOutbox(snapshot.id)
  const next = entries.flatMap(item => {
    // Only dispatched messages can be acknowledged. Match a fresh native identity,
    // so repeated identical prompts cannot consume an older user bubble.
    if (item.dispatched && snapshot.threadId === item.threadId
      && snapshot.items.some(native => native.type === 'userMessage' && native.text === item.text && !item.baseline.includes(native.id))) return []
    if (item.status === 'queued' && item.delivery === 'steer' && snapshot.turnId !== item.expectedTurnId) return [{ ...item, status: 'failed' as const, error: 'The target turn ended. Restore this message to send it again.' }]
    if (item.status !== 'failed' && (snapshot.threadId !== item.threadId || snapshot.controlEpoch !== item.controlEpoch
      || snapshot.connection === 'closed' || snapshot.connection === 'disconnected')) {
      return [{ ...item, status: 'failed' as const, error: 'Conversation changed or disconnected. Check the terminal before sending again.' }]
    }
    return [item]
  })
  if (next.length !== entries.length || next.some((item, index) => item !== entries[index])) update(snapshot.id, next)
  if (!next.length || inFlight.has(snapshot.id) || next.some(item => item.status === 'failed' || item.status === 'sending')) return
  const first = next.find(item => item.status === 'queued' && item.delivery === 'steer') ?? next.find(item => item.status === 'queued')
  if (!first) return
  // Different live inputs may be accepted before the native queue consumes them.
  // Identical text waits for its predecessor's echo to avoid ambiguous receipts.
  if (next.some(item => item.status === 'accepted' && (first.delivery === 'queue' || !snapshot.capabilities.liveInput || item.text === first.text))) return
  if (snapshot.mode !== 'conversation' || snapshot.connection !== 'ready' || !snapshot.capabilities.submit
    || (snapshot.turnId && (first.delivery === 'queue' || !snapshot.capabilities.liveInput)) || snapshot.submitting || snapshot.settingsUpdating || snapshot.approvals.length || snapshot.questions?.some(request => request.blocking !== false) || snapshot.needsTerminal) return
  const runtime = runtimes.get(snapshot.id)
  inFlight.add(snapshot.id)
  update(snapshot.id, next.map(item => item === first ? { ...item, status: 'sending', dispatched: true, baseline: snapshot.items.filter(native => native.type === 'userMessage').map(native => native.id) } : item))
  void (async () => {
    try {
      const result = await window.electron.terminal.conversationCommand(snapshot.id, {
        type: 'send', text: first.text, delivery: first.delivery, expectedTurnId: first.expectedTurnId, imagePaths: first.imagePaths, commandId: first.id, controlEpoch: first.controlEpoch,
      })
      if (runtimes.get(snapshot.id) !== runtime) return
      update(snapshot.id, conversationOutbox(snapshot.id).map(item => item.id === first.id && item.status === 'sending' ? { ...item, status: 'accepted' } : item))
      observeConversationOutbox(result)
    } catch (error) {
      if (runtimes.get(snapshot.id) !== runtime) return
      update(snapshot.id, conversationOutbox(snapshot.id).map(item => item.id === first.id || item.status === 'queued'
        ? { ...item, status: 'failed', error: item.id === first.id ? String(error) : undefined } : item))
    } finally {
      if (runtimes.get(snapshot.id) === runtime) {
        inFlight.delete(snapshot.id)
        const current = snapshots.get(snapshot.id)
        if (current) observeConversationOutbox(current)
      }
    }
  })()
}
