import type { ConversationQuestion, ConversationQuestionAnswer } from '../../shared/conversation-questions'

/** OpenCode /openapi.json Form.Field. Opaque and conditional forms stay with the native client. */
export function openCodeQuestions(fields: unknown, title: string): ConversationQuestion[] | null {
  if (!Array.isArray(fields) || !fields.length || fields.length > 30) return null
  const questions: ConversationQuestion[] = []
  for (const field of fields) {
    if (!field || typeof field.key !== 'string' || questions.some(q => q.id === field.key) || field.hidden || field.when || field.type === 'external' || field.pattern || field.format) return null
    if (!['string', 'number', 'integer', 'boolean', 'multiselect'].includes(field.type)) return null
    if (field.options !== undefined && (!Array.isArray(field.options) || field.options.length > 100 || field.options.some((option: any) => typeof option?.value !== 'string' || typeof option.label !== 'string'))) return null
    const options = field.type === 'boolean' ? [{ id: 'true', label: 'Yes' }, { id: 'false', label: 'No' }]
      : (field.options ?? []).map((option: any) => ({ id: option.value, label: option.label, description: option.description }))
    if (new Set(options.map((option: { id: string }) => option.id)).size !== options.length) return null
    questions.push({ id: field.key, text: field.title ?? title, detail: field.description, options,
      required: field.required === true, multiple: field.type === 'multiselect', allowText: field.type !== 'boolean' && (!options.length || field.custom === true),
      placeholder: field.placeholder, inputType: field.type === 'number' || field.type === 'integer' ? field.type : undefined,
      minimum: typeof field.minimum === 'number' ? field.minimum : undefined, maximum: typeof field.maximum === 'number' ? field.maximum : undefined,
      minLength: field.minLength, maxLength: field.maxLength, minSelections: field.minItems, maxSelections: field.maxItems })
  }
  return questions
}

export function openCodeAnswer(fields: Array<{ key: string; type: string }>, answer: ConversationQuestionAnswer): Record<string, unknown> {
  return Object.fromEntries(fields.flatMap(field => {
    const row = answer.answers.find(item => item.id === field.key)!
    if (!row.selected.length && !row.text?.trim()) return []
    const values = [...row.selected, ...(row.text?.trim() ? [row.text] : [])]
    const value = field.type === 'multiselect' ? values : field.type === 'boolean' ? values[0] === 'true' : field.type === 'integer' || field.type === 'number' ? Number(values[0]) : values[0]
    return [[field.key, value]]
  }))
}
