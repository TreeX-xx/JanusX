import { normalizeWorkerShortcut, type WorkerShortcut } from './worker-shortcuts'
import { PRODUCT_IMAGE_EXTENSIONS } from './product'

export interface ConversationReference {
  id: string
  name: string
  path: string
  kind: 'file' | 'directory' | 'image' | 'diff'
  size?: number
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
export const CONVERSATION_ATTACHMENT_CHUNK_BYTES = 1024 * 1024
export const MAX_CONVERSATION_NATIVE_IMAGES = 8
export const CONVERSATION_NATIVE_IMAGE_BUDGET = 10 * 1024 * 1024
export const CONVERSATION_PROMPT_LIMIT = 32000

export function conversationReferenceFileKind(name: string): 'image' | 'file' {
  return PRODUCT_IMAGE_EXTENSIONS.some(extension => name.toLowerCase().endsWith(extension)) ? 'image' : 'file'
}

export function supportsNativeConversationImage(path: string): boolean {
  return /\.(?:png|jpe?g|webp)$/i.test(path) && !path.startsWith('janusx-workspace://')
}

/** Display text/references and explicit input routing. The host validates routing; no file bytes. */
export interface MessageContext { text: string; references: ConversationReference[]; worker?: WorkerShortcut; delivery?: 'pending' | 'sent' | 'failed' }
export function normalizeMessageContext(value: unknown): MessageContext | undefined {
  if (!value || typeof value !== 'object') return undefined
  const source = value as Partial<MessageContext>
  if (typeof source.text !== 'string' || source.text.length > CONVERSATION_PROMPT_LIMIT || !Array.isArray(source.references)) return undefined
  const references: ConversationReference[] = []
  for (const ref of source.references) {
    if (!ref || !['file','directory','image','diff'].includes(ref.kind) || !['id','name','path'].every(key => typeof ref[key as 'id' | 'name' | 'path'] === 'string' && ref[key as 'id' | 'name' | 'path'].length > 0 && ref[key as 'id' | 'name' | 'path'].length <= 4096)
      || (ref.quote !== undefined && (typeof ref.quote !== 'string' || ref.quote.length > 100000))) return undefined
    references.push({ id:ref.id, name:ref.name, path:ref.path, kind:ref.kind, ...(ref.quote !== undefined ? {quote:ref.quote} : {}),
      ...(typeof ref.size === 'number' && Number.isSafeInteger(ref.size) && ref.size >= 0 ? { size: ref.size } : {}) })
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

// Keep the authored text and every inline occurrence when expanding a draft
// for a size-limited transport. Copy continues to use the full path and quote.
export function boundedConversationPrompt(text: string, references: ConversationReference[]): string {
  const full = conversationPrompt(text, references)
  if (full.length <= CONVERSATION_PROMPT_LIMIT) return full
  const paths = conversationPrompt(text, references.map(ref => ({ ...ref, quote: undefined })))
  if (paths.length <= CONVERSATION_PROMPT_LIMIT) return paths

  const byToken = new Map(references.map((ref, index) => [referenceToken(ref), { ref, index }]))
  let remaining = CONVERSATION_PROMPT_LIMIT - text.length
  return text.replace(/\[\[ref:[^\]]+\]\]/g, token => {
    const entry = byToken.get(token)
    if (!entry) return token
    const fullPath = `${entry.ref.kind}: ${JSON.stringify(entry.ref.path)}`
    const label = `[${entry.ref.name}]`
    const result = fullPath.length <= token.length + remaining ? fullPath :
      label.length <= token.length + remaining ? label : `[file ${entry.index + 1}]`
    remaining += token.length - result.length
    return result
  })
}
