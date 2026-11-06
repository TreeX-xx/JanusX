import type { ConversationQuestion, ConversationQuestionAnswer } from '../../shared/conversation-questions'

type Json = Record<string, any>

/** Map the native primitive form schema to the existing answer component; unknown forms stay blocked. */
export function codexElicitation(params: Json): { questions: ConversationQuestion[]; result(answer: ConversationQuestionAnswer): Json } | null {
  const action: ConversationQuestion = { id: '$action', text: String(params.message ?? 'MCP request'), options: [
    { id: 'accept', label: params.mode === 'url' ? 'I completed the requested action' : 'Submit answers' },
    { id: 'decline', label: 'Decline' },
  ] }
  if (params.mode === 'url') {
    try {
      const url = new URL(params.url)
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return null
      action.detail = url.href
    } catch { return null }
    return { questions: [action], result: answer => ({ action: answer.cancelled ? 'cancel' : answer.answers[0]?.selected[0], content: null }) }
  }
  if (!['form', 'openai/form', 'openaiForm'].includes(params.mode) || params.requestedSchema?.type !== 'object') return null
  const schema = params.requestedSchema as Json
  if (!schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties) || Object.keys(schema.properties).length > 20) return null
  if (Object.keys(schema).some(key => !['type', 'properties', 'required', '$schema', 'additionalProperties', 'title', 'description'].includes(key))) return null
  const fields: ConversationQuestion[] = []
  const values = new Map<string, unknown[]>()
  for (const [id, raw] of Object.entries(schema.properties) as Array<[string, Json]>) {
    if (!raw || id === '$action' || !['string', 'number', 'integer', 'boolean', 'array'].includes(raw.type)) return null
    if (Object.keys(raw).some(key => !['type', 'title', 'description', 'enum', 'enumNames', 'oneOf', 'items', 'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'default'].includes(key))) return null
    const choices = raw.type === 'boolean' ? [{ const: true, title: 'Yes' }, { const: false, title: 'No' }]
      : raw.oneOf ?? (raw.enum?.map((value: string, index: number) => ({ const: value, title: raw.enumNames?.[index] ?? value })))
        ?? (raw.type === 'array' ? raw.items?.anyOf ?? raw.items?.enum?.map((value: string) => ({ const: value, title: value })) : undefined)
    if (raw.type === 'array' && !choices) return null
    if (choices && (!Array.isArray(choices) || choices.length > 100 || choices.some(row => !row || !['string', 'boolean'].includes(typeof row.const) || typeof row.title !== 'string'))) return null
    if (choices) values.set(id, choices.map((row: Json) => row.const))
    fields.push({ id, text: String(raw.title ?? id), detail: raw.description, required: false,
      options: (choices ?? []).map((row: Json, index: number) => ({ id: String(index), label: row.title })),
      multiple: raw.type === 'array', allowText: !choices, multiline: raw.type === 'string' && !choices,
      inputType: ['number', 'integer'].includes(raw.type) ? raw.type : undefined,
      minimum: raw.minimum, maximum: raw.maximum, minLength: raw.minLength, maxLength: raw.maxLength,
      minSelections: raw.minItems, maxSelections: raw.maxItems,
    })
  }
  return { questions: [action, ...fields], result(answer) {
    const selected = answer.cancelled ? 'cancel' : answer.answers.find(row => row.id === '$action')?.selected[0]
    if (!['accept', 'decline', 'cancel'].includes(selected!)) throw new Error('Select how to answer the MCP request')
    if (selected !== 'accept') return { action: selected, content: null }
    const content: Json = {}
    for (const field of fields) {
      const row = answer.answers.find(item => item.id === field.id)!
      if (!row?.selected.length && !row?.text?.trim()) {
        if (schema.required?.includes(field.id)) throw new Error(`Answer the required field: ${field.text}`)
        continue
      }
      const raw = schema.properties[field.id]
      const options = values.get(field.id)
      content[field.id] = options ? raw.type === 'array' ? row.selected.map(id => options[Number(id)]) : options[Number(row.selected[0])]
        : ['number', 'integer'].includes(raw.type) ? Number(row.text) : row.text
    }
    return { action: 'accept', content }
  } }
}
