// Note: .agents/notes/workbench/terminal-dialog-dual-mode.md — native interaction requests.
export interface ConversationQuestion {
  id: string
  header?: string
  text: string
  detail?: string
  options: Array<{ id: string; label: string; description?: string }>
  multiple?: boolean
  allowText?: boolean
  secret?: boolean
  multiline?: boolean
  placeholder?: string
  initialText?: string
  required?: boolean
  inputType?: 'number' | 'integer'
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  minSelections?: number
  maxSelections?: number
}

export interface ConversationQuestionRequest {
  id: string | number
  version: number
  itemId?: string
  turnId?: string
  questions: ConversationQuestion[]
  blocking?: boolean
  cancelable?: boolean
  status?: 'pending' | 'submitting' | 'unknown'
}

export interface ConversationQuestionAnswer {
  cancelled?: boolean
  answers: Array<{ id: string; selected: string[]; text?: string }>
}

/** Validate before consuming a native callback. Option IDs, never labels, cross the UI boundary. */
export function validateConversationAnswer(request: ConversationQuestionRequest, value: ConversationQuestionAnswer): void {
  if (!value || !Array.isArray(value.answers)) throw new Error('Invalid answer')
  if (value.cancelled === true) {
    if (!request.cancelable || value.answers.length) throw new Error('This request cannot be cancelled')
    return
  }
  if (value.cancelled !== undefined && value.cancelled !== false) throw new Error('Invalid cancellation')
  if (value.answers.length !== request.questions.length) throw new Error('Answer every question')
  const ids = new Set<string>()
  for (const answer of value.answers) {
    const question = request.questions.find(row => row.id === answer?.id)
    if (!question || ids.has(answer.id) || !Array.isArray(answer.selected)) throw new Error('Invalid question identity')
    ids.add(answer.id)
    if (new Set(answer.selected).size !== answer.selected.length || answer.selected.some(id => !question.options.some(option => option.id === id))) throw new Error('Invalid option')
    if (!question.multiple && answer.selected.length > 1) throw new Error('Select one option')
    if (answer.text !== undefined && (typeof answer.text !== 'string' || answer.text.length > 32000 || !question.allowText)) throw new Error('Invalid custom answer')
    const text = answer.text?.trim()
    if (!question.multiple && answer.selected.length && text) throw new Error('Choose an option or enter an answer')
    if (!answer.selected.length && !text) {
      if (question.required === false) continue
      throw new Error('Answer every question')
    }
    if (text && ((question.minLength !== undefined && answer.text!.length < question.minLength) || (question.maxLength !== undefined && answer.text!.length > question.maxLength))) throw new Error('Answer length is outside the requested range')
    const count = answer.selected.length + (text ? 1 : 0)
    if ((question.minSelections !== undefined && count < question.minSelections) || (question.maxSelections !== undefined && count > question.maxSelections)) throw new Error('Choose the requested number of options')
    if (question.inputType && text) {
      const number = Number(text)
      if (!Number.isFinite(number) || (question.inputType === 'integer' && !Number.isInteger(number)) || (question.minimum !== undefined && number < question.minimum) || (question.maximum !== undefined && number > question.maximum)) throw new Error('Number is outside the requested range')
    }
  }
}

export function hasBlockingQuestions(snapshot: { questions?: ConversationQuestionRequest[] }): boolean {
  return !!snapshot.questions?.some(request => request.blocking !== false)
}

export function questionAnswerValues(question: ConversationQuestion, answer: ConversationQuestionAnswer['answers'][number]): string[] {
  return [...answer.selected.map(id => question.options.find(option => option.id === id)!.label), ...(answer.text?.trim() ? [answer.text] : [])]
}
