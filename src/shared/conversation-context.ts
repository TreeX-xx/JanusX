import { normalizeWorkerShortcut, type WorkerShortcut } from './worker-shortcuts'

export interface ConversationReference {
  id: string
  name: string
  path: string
  kind: 'file' | 'directory' | 'image' | 'diff'
  quote?: string
  inline?: boolean
}
export const referenceToken = (ref: ConversationReference) => `[[ref:${ref.id}]]`
export function activeConversationReferences(text: string, references: ConversationReference[]): ConversationReference[] {
  return references.filter(ref => !ref.inline || text.includes(referenceToken(ref)))
    .sort((a, b) => {
      const left = text.indexOf(referenceToken(a)), right = text.indexOf(referenceToken(b))
      return (left < 0 ? text.length : left) - (right < 0 ? text.length : right)
    })
}
export const MAX_CONVERSATION_ATTACHMENTS = 8
export const MAX_CONVERSATION_ATTACHMENT_BYTES = 10 * 1024 * 1024

/** Display text/references and explicit input routing. The host validates routing; no file bytes. */
export interface MessageContext { text: string; references: ConversationReference[]; worker?: WorkerShortcut; delivery?: 'pending' | 'sent' | 'failed' }
export function normalizeMessageContext(value: unknown): MessageContext | undefined {
  if (!value || typeof value !== 'object') return undefined
  const source = value as Partial<MessageContext>
  if (typeof source.text !== 'string' || source.text.length > 32000 || !Array.isArray(source.references) || source.references.length > MAX_CONVERSATION_ATTACHMENTS) return undefined
  const references: ConversationReference[] = []
  for (const ref of source.references) {
    if (!ref || !['file','directory','image','diff'].includes(ref.kind) || !['id','name','path'].every(key => typeof ref[key as 'id' | 'name' | 'path'] === 'string' && ref[key as 'id' | 'name' | 'path'].length > 0 && ref[key as 'id' | 'name' | 'path'].length <= 4096)
      || (ref.quote !== undefined && (typeof ref.quote !== 'string' || ref.quote.length > 100000))) return undefined
    references.push({ id:ref.id, name:ref.name, path:ref.path, kind:ref.kind, ...(ref.quote !== undefined ? {quote:ref.quote} : {}) })
  }
  const worker = normalizeWorkerShortcut(source.worker)
  return references.length || worker ? { text:source.text, references, ...(worker ? { worker } : {}),
    ...(['pending', 'sent', 'failed'].includes(source.delivery ?? '') ? { delivery: source.delivery } : {}) } : undefined
}

export function conversationPrompt(text: string, references: ConversationReference[]): string {
  const inline = new Map(references.map(ref => [referenceToken(ref), ref]))
  const expanded = text.replace(/\[\[ref:[^\]]+\]\]/g, token => {
    const ref = inline.get(token)
    return ref ? `${ref.kind}: ${JSON.stringify(ref.path)}${ref.quote ? `\n${ref.quote}\n` : ''}` : token
  })
  const trailing = references.filter(ref => !ref.inline && !text.includes(referenceToken(ref)))
  if (!trailing.length) return expanded
  return [expanded.trim(), 'Referenced context (read these files as needed):', ...trailing.map(ref =>
    `${ref.kind}: ${JSON.stringify(ref.path)}${ref.quote ? `\n${ref.quote}` : ''}`)].filter(Boolean).join('\n\n')
}
