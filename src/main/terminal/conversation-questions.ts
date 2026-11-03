import type { ConversationSnapshot } from '../../shared/conversation-display'
import { validateConversationAnswer, type ConversationQuestionAnswer, type ConversationQuestionRequest } from '../../shared/conversation-questions'

/** Request lifetime belongs to the native adapter. A reply is consumed once, even on transport uncertainty. */
export class ConversationQuestions {
  private version = 0
  private pending = new Map<string | number, { fingerprint: string; reply(answer: ConversationQuestionAnswer): Promise<void> | void }>()
  constructor(private state: ConversationSnapshot, private changed: () => void) {}
  ask(request: Omit<ConversationQuestionRequest, 'version' | 'status'>, reply: (answer: ConversationQuestionAnswer) => Promise<void> | void): void {
    const fingerprint = JSON.stringify(request)
    if (this.pending.get(request.id)?.fingerprint === fingerprint) return
    this.pending.set(request.id, { fingerprint, reply })
    this.state.questions = [...(this.state.questions ?? []).filter(row => row.id !== request.id), { ...request, version: ++this.version, status: 'pending' }]
    this.changed()
  }
  resolve(id: string | number): void {
    this.pending.delete(id)
    const old = this.state.questions ?? []
    this.state.questions = old.filter(row => row.id !== id)
    if (old.length !== this.state.questions.length) this.changed()
  }
  clear(): void {
    this.pending.clear()
    this.state.questions = []
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
      if (this.pending.get(id) === pending) this.resolve(id)
    } catch (error) {
      if (this.pending.get(id) === pending) {
        request.status = 'unknown'
        this.state.needsTerminal = true
        this.state.error = `Answer delivery is unconfirmed. Check the terminal before answering again. ${String(error).slice(0, 500)}`
        this.changed()
      }
      throw error
    }
  }
}
