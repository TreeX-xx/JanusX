import type { ConversationSnapshot } from '../../shared/conversation-display'
import { validateConversationAnswer, type ConversationQuestionAnswer, type ConversationQuestionRequest } from '../../shared/conversation-questions'

/** Request lifetime belongs to the native adapter. A reply is consumed once, even on transport uncertainty. */
export class ConversationQuestions {
  private version = 0
  private pending = new Map<string | number, { fingerprint: string; completion: 'reply' | 'event'; timer?: ReturnType<typeof setTimeout>; error?: string; reply(answer: ConversationQuestionAnswer): Promise<void> | void }>()
  constructor(private state: ConversationSnapshot, private changed: () => void) {}
  ask(request: Omit<ConversationQuestionRequest, 'version' | 'status'>, reply: (answer: ConversationQuestionAnswer) => Promise<void> | void, completion: 'reply' | 'event' = 'reply'): void {
    const fingerprint = JSON.stringify(request)
    if (this.pending.get(request.id)?.fingerprint === fingerprint) return
    clearTimeout(this.pending.get(request.id)?.timer)
    this.pending.set(request.id, { fingerprint, reply, completion })
    this.state.questions = [...(this.state.questions ?? []).filter(row => row.id !== request.id), { ...request, version: ++this.version, status: 'pending' }]
    this.changed()
  }
  resolve(id: string | number): void {
    const pending = this.pending.get(id)
    clearTimeout(pending?.timer)
    if (pending?.error && this.state.error === pending.error) this.state.error = undefined
    this.pending.delete(id)
    const old = this.state.questions ?? []
    this.state.questions = old.filter(row => row.id !== id)
    if (old.length !== this.state.questions.length) this.changed()
  }
  clear(): void {
    for (const pending of this.pending.values()) clearTimeout(pending.timer)
    this.pending.clear()
    this.state.questions = []
  }
  uncertain(id: string | number, message: string): void {
    const request = this.state.questions?.find(row => row.id === id)
    const pending = this.pending.get(id)
    if (!request || !pending) return
    clearTimeout(pending.timer)
    request.status = 'unknown'
    this.state.needsTerminal = true
    pending.error = `Answer delivery is unconfirmed. Check the terminal before answering again. ${message.slice(0, 500)}`
    this.state.error = pending.error
    this.changed()
  }
  disconnected(message: string): void {
    for (const request of this.state.questions ?? []) if (request.status === 'submitting') this.uncertain(request.id, message)
  }
  async answer(id: string | number, version: number, answer: ConversationQuestionAnswer): Promise<void> {
    const request = this.state.questions?.find(row => row.id === id)
    const pending = this.pending.get(id)
    if (!request || !pending || request.version !== version || request.status !== 'pending') throw new Error('Question expired or already answered')
    validateConversationAnswer(request, answer)
    request.status = 'submitting'; this.changed()
    try {
      await pending.reply(answer)
      // A callback may finish an older request after the native source has replaced it.
      if (this.pending.get(id) === pending) {
        if (pending.completion === 'reply') this.resolve(id)
        else if (request.status === 'submitting') {
          // Only delivery is timed. A person may leave an unanswered question
          // open indefinitely; a transport ack is not native acceptance.
          pending.timer = setTimeout(() => this.uncertain(id, 'Native confirmation timed out.'), 15000)
          pending.timer.unref?.()
        }
      }
    } catch (error) {
      if (this.pending.get(id) === pending) {
        this.uncertain(id, String(error))
      }
      throw error
    }
  }
}
