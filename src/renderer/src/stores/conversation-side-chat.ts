import { create } from 'zustand'
import { chatStream, type ChatMessage } from '../services/llm'

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
  chat.abort?.()
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
  const chat = getChat(owner)
  if (!chat?.abort) return
  chat.abort()
  save({ ...chat, abort: undefined, turns: chat.turns.map(turn => turn.status === 'streaming' ? { ...turn, status: 'stopped' } : turn) })
}
export function askSideChat(owner: SideChatOwner, model: { providerId: string; modelId: string }, retry = false) {
  const chat = getChat(owner)
  if (!chat || chat.abort) return
  const last = chat.turns.at(-1)
  if (retry && (!last || last.status !== 'failed')) return
  const question = (retry ? last!.question : chat.draft).trim()
  if (!question) return
  const history = retry ? chat.turns.slice(0, -1) : chat.turns
  const turn: SideChatTurn = { id: crypto.randomUUID(), question, source: retry ? last!.source : chat.source,
    answer: '', model: model.modelId, status: 'streaming' }
  const messages: ChatMessage[] = [{ role: 'system', content: 'Answer the user’s side questions in their language. Excerpts are quoted context from a separate terminal conversation. Explain using only the supplied text. You cannot inspect the workspace or perform actions.' }]
  for (const item of [...history, turn]) {
    const excerpt = item.source
    const content = excerpt ? `Quoted ${excerpt.kind}${excerpt.path ? ' (' + excerpt.path + ')' : ''}:\n${excerpt.text}\n\nQuestion:\n${item.question}` : item.question
    messages.push({ role: 'user', content })
    if (item.answer) messages.push({ role: 'assistant', content: item.answer })
  }
  const update = (apply: (current: SideChatTurn) => SideChatTurn) => {
    const current = getChat(owner)
    const active = current?.turns.at(-1)
    if (!current || active?.id !== turn.id || active.status !== 'streaming') return
    const next = apply(active)
    save({ ...current, abort: next.status === 'streaming' ? current.abort : undefined, turns: [...current.turns.slice(0, -1), next] })
  }
  save({ ...chat, ...(retry ? {} : { draft: '', source: undefined }), turns: [...history, turn] })
  try {
    const stream = chatStream(messages,
      delta => update(active => ({ ...active, answer: active.answer + delta })),
      () => update(active => ({ ...active, status: active.answer.trim() ? 'done' : 'failed' })),
      error => update(active => ({ ...active, status: 'failed', error })),
      { ...model, sideChat: true })
    const current = getChat(owner)
    if (current?.turns.at(-1)?.id === turn.id && current.turns.at(-1)?.status === 'streaming') save({ ...current, abort: stream.abort })
  } catch (cause) { update(active => ({ ...active, status: 'failed', error: String(cause) })) }
}
