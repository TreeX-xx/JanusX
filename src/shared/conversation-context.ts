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
