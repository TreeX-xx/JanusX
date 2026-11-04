import type { ConversationQuestion, ConversationQuestionAnswer } from '../../shared/conversation-questions'
import type { ConversationApproval } from '../../shared/conversation-display'

/** agentMessage.questions is asynchronous input, not a server request. */
export function codexAsyncQuestions(value: unknown): ConversationQuestion[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 20) return null
  if (value.some(q => !q || typeof q.title !== 'string' || !q.title.trim()
    || q.options != null && (!Array.isArray(q.options) || q.options.length > 100 || q.options.some((option: unknown) => typeof option !== 'string')))) return null
  return value.map((q, index) => ({ id: String(index), text: q.title, allowText: true,
    options: (q.options ?? []).map((label: string, index: number) => ({ id: String(index), label })) }))
}

const ASYNC_REPLY_START = '<send_user_message_question_reply>'
const ASYNC_REPLY_END = '</send_user_message_question_reply>'
export function codexAsyncAnswer(itemId: string, questions: ConversationQuestion[], answer: ConversationQuestionAnswer): string {
  const replies = questions.map(question => {
    const row = answer.answers.find(row => row.id === question.id)!
    return { questionItemId: JSON.stringify(['request_user_input_async', itemId, Number(question.id)]),
      question: Buffer.from(question.text).subarray(0, 512).toString('utf8').replace(/\uFFFD$/, '').replace(/[\r\n]/g, ' '),
      answer: row.selected.length ? question.options.find(option => option.id === row.selected[0])!.label : row.text!.trim() }
  })
  return `${ASYNC_REPLY_START}\n${JSON.stringify(replies)}\n${ASYNC_REPLY_END}`
}

export function codexAsyncReplies(text: string): Array<{ questionItemId: string; question: string; answer: string }> | null {
  text = text.trim()
  if (!text.startsWith(ASYNC_REPLY_START) || !text.endsWith(ASYNC_REPLY_END)) return null
  try {
    const parsed = JSON.parse(text.slice(ASYNC_REPLY_START.length, -ASYNC_REPLY_END.length))
    const replies = Array.isArray(parsed) ? parsed : [parsed]
    return replies.length && replies.every(row => row && typeof row.questionItemId === 'string' && typeof row.question === 'string' && typeof row.answer === 'string') ? replies : null
  } catch { return null }
}

// Native schema: app-server generate-json-schema. Keep opaque policy values on the main side.
export function codexQuestions(value: unknown): ConversationQuestion[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 20) return null
  const result: ConversationQuestion[] = []
  for (const q of value) {
    if (!q || typeof q.id !== 'string' || !q.id || typeof q.question !== 'string' || result.some(row => row.id === q.id)) return null
    if (q.options != null && (!Array.isArray(q.options) || q.options.length > 100 || q.options.some((o: any) => !o || typeof o.label !== 'string' || (o.description !== undefined && typeof o.description !== 'string')))) return null
    const options = (q.options ?? []).map((o: any, index: number) => ({ id: String(index), label: o.label, description: o.description }))
    result.push({ id: q.id, header: typeof q.header === 'string' ? q.header : undefined, text: q.question,
      options, allowText: q.isOther === true || !options.length, secret: q.isSecret === true })
  }
  return result
}

export function codexApprovalChoices(params: Record<string, any>, file: boolean): { choices: NonNullable<ConversationApproval['choices']>; decisions: Map<string, unknown> } {
  const choices = [
    { id: 'accept', label: 'Allow once' },
    { id: 'acceptForSession', label: 'Allow for this session' },
    { id: 'decline', label: 'Decline' },
    { id: 'cancel', label: 'Decline and stop this turn' },
  ]
  const decisions = new Map<string, unknown>(choices.map(option => [option.id, option.id]))
  if (!file && Array.isArray(params.proposedExecpolicyAmendment) && params.proposedExecpolicyAmendment.length && params.proposedExecpolicyAmendment.every((part: unknown) => typeof part === 'string')) {
    choices.push({ id: 'execpolicy', label: `Always allow commands matching: ${params.proposedExecpolicyAmendment.join(' ')}` })
    decisions.set('execpolicy', { acceptWithExecpolicyAmendment: { execpolicy_amendment: params.proposedExecpolicyAmendment } })
  }
  if (!file && Array.isArray(params.proposedNetworkPolicyAmendments)) for (const [index, policy] of params.proposedNetworkPolicyAmendments.entries()) {
    if (!policy || !['allow', 'deny'].includes(policy.action) || typeof policy.host !== 'string') continue
    const id = `network:${index}`
    choices.push({ id, label: `${policy.action === 'allow' ? 'Always allow' : 'Always deny'} network access: ${policy.host}` })
    decisions.set(id, { applyNetworkPolicyAmendment: { network_policy_amendment: policy } })
  }
  return { choices, decisions }
}
