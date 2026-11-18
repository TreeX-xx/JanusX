// Engine-owned implementation. See .agents/notes/agent/ideas/superagent-harness-reliability.md
import { CodexConversation as NativeCodexConversation } from '@janus-agent/janus-agent/superagent/native/codex-conversation'
import type { ConversationCommand, ConversationPlan, ConversationSnapshot } from '../../shared/conversation-display'
import type { ConversationHistoryRequest, ConversationHistoryResult } from '../../shared/conversation-history'
import { readCodexTurnPlans } from './codex-turn-plans'

export * from '@janus-agent/janus-agent/superagent/native/codex-conversation'

/** Give the native adapter's live projection and its paged history the same final plans. */
export class DesktopCodexConversation extends NativeCodexConversation {
  private readonly projectPlans: (snapshot: ConversationSnapshot) => ConversationSnapshot
  private readonly plansFor: (threadId: string, turnIds: Iterable<string>) => ConversationPlan[]
  private restoring: Promise<void> = Promise.resolve()

  constructor(id: string, publish: (snapshot: ConversationSnapshot) => void, bind?: (threadId: string, transcriptPath?: string) => void) {
    let scope: string | undefined, source: string | undefined
    let restored = new Map<string, ConversationPlan>(), observedRevision = -1
    const observed = new Map<string, ConversationPlan>()
    const plansFor = (threadId: string, turnIds: Iterable<string>) => scope === threadId
      ? [...new Set(turnIds)].flatMap(turnId => {
        const plan = observed.get(turnId) ?? restored.get(turnId)
        return plan ? [plan] : []
      }) : []
    const project = (snapshot: ConversationSnapshot): ConversationSnapshot => {
      if (!snapshot.threadId || scope !== snapshot.threadId) return snapshot
      const visible = new Set(snapshot.items.map(item => item.turnId))
      if (snapshot.turnId) visible.add(snapshot.turnId)
      if (snapshot.revision >= observedRevision) {
        observedRevision = snapshot.revision
        for (const plan of snapshot.plans ?? []) {
          if (visible.has(plan.turnId) && (plan.turnId === snapshot.turnId || plan.outcome !== 'running')) observed.set(plan.turnId, plan)
        }
        while (observed.size > 500) {
          const first = observed.keys().next()
          if (!first.done) observed.delete(first.value)
        }
      }
      return { ...snapshot, plans: plansFor(snapshot.threadId, visible) }
    }
    super(id, snapshot => publish(project(snapshot)), (threadId, transcriptPath) => {
      bind?.(threadId, transcriptPath)
      if (scope !== threadId) {
        scope = threadId; source = undefined; restored.clear(); observed.clear(); observedRevision = -1
        this.restoring = Promise.resolve()
      }
      if (!transcriptPath || source === transcriptPath) return
      source = transcriptPath
      this.restoring = readCodexTurnPlans(transcriptPath, threadId).then(plans => {
        if (scope !== threadId || source !== transcriptPath || this.state.threadId !== threadId || this.state.connection !== 'ready') return
        restored = plans
        if (plans.size) publish(this.snapshot())
      }).catch(() => {})
    })
    this.projectPlans = project
    this.plansFor = plansFor
  }

  override snapshot(): ConversationSnapshot {
    return this.projectPlans(super.snapshot())
  }

  override async command(command: ConversationCommand): Promise<ConversationSnapshot> {
    return this.projectPlans(await super.command(command))
  }

  override async readHistory(request: ConversationHistoryRequest): Promise<ConversationHistoryResult> {
    const epoch = this.state.controlEpoch
    const result = await super.readHistory(request)
    if (result.type !== 'page') return result
    await this.restoring
    if (this.state.threadId !== request.threadId || this.state.controlEpoch !== epoch) throw new Error('Native history session changed')
    return { ...result, plans: this.plansFor(result.threadId, result.items.map(item => item.turnId)) }
  }
}
