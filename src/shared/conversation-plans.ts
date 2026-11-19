import type { ConversationPlan } from './conversation-display'

/** Progress and explanations update a plan in place; only changed ordered steps create a revision.
 * Native snapshots remain untouched for protocol history and diagnostics. */
export function compactConversationPlans(plans: readonly ConversationPlan[]): ConversationPlan[] {
  const revisions: ConversationPlan[] = []
  const latest = new Map<string, number>()
  for (const plan of plans) {
    const index = latest.get(plan.turnId)
    const previous = index === undefined ? undefined : revisions[index]
    if (index !== undefined && previous && previous.steps.length === plan.steps.length
      && previous.steps.every((step, index) => step.step === plan.steps[index].step)) {
      revisions[index] = plan
    } else {
      latest.set(plan.turnId, revisions.length)
      revisions.push(plan)
    }
  }
  return revisions
}
