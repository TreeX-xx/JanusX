import type { SuperAgentWorkDetail } from '../../../../shared/superagent'
import type { SuperAgentWorkerSnapshot } from '../../../../shared/superagent-worker'
import { isUserFacingReportSummary } from '@janus-agent/janus-agent/superagent/contracts/worker-report'

/** Use an explicit plan step or task name; raw replies belong only in recent output. */
export function workerHeadline(title: string, worker?: SuperAgentWorkerSnapshot) {
  if (!worker || worker.restored) return title
  const { conversation } = worker
  const turnId = conversation.turnId ?? conversation.items.at(-1)?.turnId
  if (worker.phase === 'ready' && worker.report?.executionId === worker.executionId && isUserFacingReportSummary(worker.report.summary)) return worker.report.summary
  if (!turnId || (['starting', 'running'].includes(worker.phase) && !conversation.turnId)) return title
  const plan = conversation.plans?.filter(row => row.turnId === turnId).at(-1)
  const step = plan?.outcome === 'running' && plan.steps.find(row => row.status === 'inProgress')?.step
  if (step && isUserFacingReportSummary(step)) return step
  return title
}

/** Native turn timing includes waiting. Older snapshots without timing stay blank. */
export function workerTiming(worker: SuperAgentWorkerSnapshot | undefined, now: number) {
  if (!worker || worker.restored) return null
  const { conversation } = worker
  if (conversation.turnId && conversation.turnStartedAt !== undefined) {
    if (worker.stopConfirmed || conversation.connection === 'disconnected' || conversation.connection === 'closed'
      || !['starting', 'running', 'waiting', 'stopping'].includes(worker.phase)) return null
    return { seconds: Math.max(0, Math.floor((now - conversation.turnStartedAt) / 1000)), running: true }
  }
  if (conversation.turnId || ['starting', 'running'].includes(worker.phase)) return null
  const turnId = conversation.items.at(-1)?.turnId
  const last = conversation.items.filter(item => item.turnId === turnId && item.type === 'agentMessage' && item.durationMs !== undefined).at(-1)
  return last ? { seconds: Math.max(0, Math.floor(last.durationMs! / 1000)), running: false } : null
}

export function formatWorkerElapsed(seconds: number) {
  const minute = String(Math.floor(seconds / 60) % 60).padStart(2, '0'), second = String(seconds % 60).padStart(2, '0')
  return seconds >= 3600 ? `${Math.floor(seconds / 3600)}:${minute}:${second}` : `${minute}:${second}`
}

/** Only current-turn native events can describe a running command. Never infer execution from log text. */
export function workerStream(worker?: SuperAgentWorkerSnapshot) {
  if (!worker || worker.restored || worker.stopConfirmed || worker.conversation.connection === 'disconnected'
    || !['running', 'starting'].includes(worker.phase)) return { text: '', running: false, truncated: false }
  const items = worker.conversation.items.filter(item => item.type !== 'userMessage'
    && (!worker.conversation.turnId || item.turnId === worker.conversation.turnId))
  const pending = worker.conversation.turnId ? items.filter(item => item.status === 'inProgress' && (item.activity || item.type === 'commandExecution')).at(-1) : undefined
  const item = pending
  const text = item?.type === 'commandExecution' ? '$ ' + item.text : item?.activity || item?.text || ''
  return { text, running: !!pending, truncated: !!item?.truncated }
}

/** Keep the latest assistant reply visible independently of command activity. */
export function workerReply(worker?: SuperAgentWorkerSnapshot) {
  const item = worker?.conversation.items.filter(item => item.type === 'agentMessage' && item.text.trim()).at(-1)
  return { text: item?.text || '', truncated: !!item?.truncated }
}

/** Pending/unknown deliveries are not a prompt the Worker has received. */
export function latestWorkerInput(detail: SuperAgentWorkDetail) {
  const delivered = new Set(detail.deliveries.filter(row => row.workId === detail.work.id
    && ['delivered', 'incorporated'].includes(row.status)).map(row => row.inputId))
  return detail.inputs.filter(row => delivered.has(row.id) || row.id === detail.work.sourceInputId)
    .sort((a, b) => b.sequence - a.sequence).at(0)
}

/** Native user messages are the actual assignment sent to this Worker, not the source user input. */
export function workerPrompt(worker?: SuperAgentWorkerSnapshot) {
  const item = worker?.conversation.items.filter(item => item.type === 'userMessage' && item.text.trim()).at(-1)
  return { text: item?.text || '', truncated: !!item?.truncated }
}
