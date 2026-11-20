import { create } from 'zustand'
import type { NativeSideChatOwner } from '../../../shared/conversation-side-chat'

// Note: .agents/notes/workbench/terminal-dialog-dual-mode.md
export interface SideChatOwner {
  terminalId: string
  workspaceId: string
  pid?: number | null
  threadId: string | null
}
export interface SideChatSource {
  kind: 'reply' | 'message' | 'draft' | 'diff' | 'turn'
  text: string
  turnId?: string
  itemId?: string
  path?: string
}
interface SideChatTurn {
  id: string
  question: string
  source?: SideChatSource
  answer: string
  model: string
  status: 'streaming' | 'done' | 'stopped' | 'failed'
  error?: string
}
interface SideChat {
  owner: SideChatOwner
  open: boolean
  draft: string
  source?: SideChatSource
  turns: SideChatTurn[]
  abort?: () => void
}
export const useSideChats = create<{ chats: Record<string, SideChat> }>(() => ({ chats: {} }))
export function sameSideChatOwner(a: SideChatOwner, b: SideChatOwner) {
  return a.terminalId === b.terminalId && a.workspaceId === b.workspaceId && a.pid === b.pid && a.threadId === b.threadId
}
function getChat(owner: SideChatOwner) {
  const chat = useSideChats.getState().chats[owner.terminalId]
  return chat && sameSideChatOwner(chat.owner, owner) ? chat : undefined
}
function save(chat: SideChat) {
  useSideChats.setState(({ chats }) => ({ chats: { ...chats, [chat.owner.terminalId]: chat } }))
}
export function discardSideChat(terminalId: string) {
  const chat = useSideChats.getState().chats[terminalId]
  if (!chat) return
  const chats = { ...useSideChats.getState().chats }
  delete chats[terminalId]
  useSideChats.setState({ chats })
  const owner = nativeOwner(chat.owner)
  if (owner) void window.electron.terminal.sideChat?.({ type: 'dispose', owner }).catch(() => {})
}
export function openSideChat(owner: SideChatOwner, source?: SideChatSource) {
  const existing = getChat(owner)
  if (!existing) discardSideChat(owner.terminalId)
  save({ ...(existing ?? { owner, draft: '', turns: [] }), open: true, ...(source ? { source } : {}) })
}
export function editSideChat(owner: SideChatOwner, change: Partial<Pick<SideChat, 'open' | 'draft' | 'source'>>) {
  const chat = getChat(owner)
  if (chat) save({ ...chat, ...change })
}
export function stopSideChat(owner: SideChatOwner) {
  getChat(owner)?.abort?.()
}
function nativeOwner({ terminalId, threadId }: SideChatOwner): NativeSideChatOwner | undefined {
  return threadId ? { terminalId, threadId } : undefined
}

export function askSideChat(owner: SideChatOwner, model: string, retry = false) {
  const chat = getChat(owner)
  const target = nativeOwner(owner)
  const { sideChat, onSideChat } = window.electron.terminal
  if (!chat || chat.abort || !target || !sideChat || !onSideChat) return
  const last = chat.turns.at(-1)
  if (retry && (!last || last.status !== 'failed')) return
  const question = (retry ? last!.question : chat.draft).trim()
  if (!question) return
  const history = retry ? chat.turns.slice(0, -1) : chat.turns
  const turn: SideChatTurn = { id: crypto.randomUUID(), question, source: retry ? last!.source : chat.source,
    answer: '', model: history[0]?.model ?? model, status: 'streaming' }
  const excerpt = turn.source
  const text = excerpt ? `Quoted ${excerpt.kind}${excerpt.path ? ' (' + excerpt.path + ')' : ''}:\n${excerpt.text}\n\nQuestion:\n${question}` : question
  const update = (apply: (current: SideChatTurn) => SideChatTurn) => {
    const current = getChat(owner)
    const active = current?.turns.at(-1)
    if (!current || active?.id !== turn.id || active.status !== 'streaming') return
    const next = apply(active)
    save({ ...current, abort: next.status === 'streaming' ? current.abort : undefined, turns: [...current.turns.slice(0, -1), next] })
  }
  const abort = () => {
    void sideChat({ type: 'stop', owner: target, requestId: turn.id }).catch(error => update(active => ({ ...active, status: 'failed', error: String(error) })))
  }
  save({ ...chat, abort, ...(retry ? {} : { draft: '', source: undefined }), turns: [...history, turn] })
  const unsubscribe = onSideChat(event => {
    if (event.requestId === turn.id && event.owner.terminalId === target.terminalId && event.owner.threadId === target.threadId)
      update(active => ({ ...active, answer: event.text }))
  })
  void sideChat({ type: 'ask', owner: target, requestId: turn.id, text }).then(result => {
    update(active => ({ ...active, answer: result?.text ?? active.answer,
      status: result?.status === 'stopped' ? 'stopped' : (result?.text ?? active.answer).trim() ? 'done' : 'failed' }))
  }).catch(error => update(active => ({ ...active, status: 'failed', error: String(error) }))).finally(unsubscribe)
}
