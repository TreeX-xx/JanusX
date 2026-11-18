import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Box, Check, ChevronDown, ChevronRight, Circle, FileText, LoaderCircle, Pause, Play, RotateCcw, Square, X } from 'lucide-react'
import type { SuperAgentWorkDetail } from '../../../../shared/superagent'
import type { SuperAgentEnvironment, SuperAgentGitOperation } from '../../../../shared/superagent-environment'
import type { SuperAgentWorkerControl, SuperAgentWorkerSnapshot } from '../../../../shared/superagent-worker'
import type { SuperAgentScheduleEntry, SuperAgentScheduleSnapshot } from '../../../../shared/superagent-scheduling'
import { useWorkspaceStore } from '../../stores/workspace'
import { useSuperAgentUIStore } from '../../stores/superagent-ui'
import { ConversationStartupPanel } from '../ConversationStartupPanel'
import { ConversationQuestions } from '../ConversationQuestions'
import type { SuperAgentWorkflow, SuperAgentWorkflowNode } from '../../../../shared/superagent-workflow'
import { WorkerSummaryHeader } from './WorkerSummaryHeader'
import { WorkerMonitorBody } from './WorkerMonitor'
import { WorkerDockRail } from './WorkerDockRail'
import { pendingReportQuestion } from '@janus-agent/janus-agent/superagent/contracts/superagent'
import { WorkerQuestionCard } from './WorkerQuestionCard'
import { WorkerReportCard } from './WorkerReportCard'
import { SuperAgentPresentationProvider, useSuperAgentPresentation, useSuperAgentHighlight } from './SuperAgentPresentation'
import { WorkerDisclosure } from './WorkerDisclosure'
import { WorkerModelControls } from './WorkerModelControls'
import { workerHeadline, workerPrompt, workerReply, workerStream } from './workerPresentation'
import { WorkerBranch, WorkerElapsed } from './WorkerMetadata'
import { WorkerQueueControls } from './WorkerQueueControls'
import { WorkerScheduleContext } from './WorkerScheduleContext'
import { useSuperAgentAvailability } from './useSuperAgentAvailability'
import styles from './SuperAgentWork.module.css'

interface WorkView { detail: SuperAgentWorkDetail; report?: string; environment?: SuperAgentEnvironment; operation?: SuperAgentGitOperation; schedule?: SuperAgentScheduleEntry; node?: SuperAgentWorkflowNode; workflow?: SuperAgentWorkflow }

/** Resident instances and current arrangements; retired work remains queryable through ordinary chat. */
function useWorkState() {
  const workspaceId = useWorkspaceStore(state => state.activeWorkspaceId)
  const workspace = useWorkspaceStore(state => state.workspaces.find(row => row.id === workspaceId))
  const focusedWorkId = useSuperAgentUIStore(state => state.focusedWorkId)
  const available = useSuperAgentAvailability(workspaceId)
  const api = available ? window.electron?.superAgent : undefined
  const [views, setViews] = useState<WorkView[]>([])
  const [workers, setWorkers] = useState<SuperAgentWorkerSnapshot[]>([])
  const [schedule, setSchedule] = useState<SuperAgentScheduleSnapshot>()
  const [workflows, setWorkflows] = useState<SuperAgentWorkflow[]>([])
  const [limit, setLimit] = useState(10)
  const [total, setTotal] = useState(0)
  const [refreshError, setRefreshError] = useState('')
  const generation = useRef(0), reads = useRef(0), runtimeRevision = useRef(0)
  const visibleWorks = useRef(new Set<string>())

  const refresh = useCallback(async () => {
    if (!api || !workspaceId) return
    const epoch = generation.current, read = ++reads.current, runtime = runtimeRevision.current
    try {
      const [snapshot, live, environments, scheduled, plans] = await Promise.all([
        api.snapshot(workspaceId), api.workers(workspaceId), api.environments(workspaceId), api.schedule(workspaceId),
        api.workflows?.(workspaceId),
      ])
      const flows = plans?.workflows ?? []
      const workflowWorkIds = new Set(flows.flatMap(flow => flow.nodes.flatMap(node => node.workId ? [node.workId] : [])))
      const resident = snapshot.works.filter(work => {
        if (workflowWorkIds.has(work.id)) return true
        if (pendingReportQuestion(work, snapshot.reports)) return true
        const worker = live.find(row => row.workId === work.id && row.retiredAt === undefined)
        const arranged = scheduled.entries.find(row => row.workId === work.id)
        if (work.closedAt === null && environments.operations.some(row => row.workId === work.id && row.status === 'pending')) return true
        return worker ? work.closedAt === null || !worker.stopConfirmed
          : work.closedAt === null && arranged && ['queued', 'paused', 'cancelled', 'awaiting-approval', 'starting', 'interrupted', 'failed', 'blocked'].includes(arranged.status)
      })
      // Pagination must never hide an unanswered request or an explicitly located work.
      const selected = resident.sort((a, b) => Number(a.closedAt !== null) - Number(b.closedAt !== null) || b.createdAt - a.createdAt)
        .filter((work, index) => index < limit || work.id === focusedWorkId || !!pendingReportQuestion(work, snapshot.reports)
          || workflowWorkIds.has(work.id)
          || environments.operations.some(row => row.workId === work.id && row.status === 'pending')
          || scheduled.entries.some(row => row.workId === work.id && ['queued', 'paused', 'starting', 'interrupted', 'failed', 'blocked'].includes(row.status))
          || live.some(row => row.workId === work.id && !row.stopConfirmed)
          || live.some(row => row.workId === work.id && !row.restored && !row.stopConfirmed &&
            (row.conversation.approvals.length || row.conversation.questions?.some(question => question.status === 'pending')
              || row.commitRequest?.status === 'pending' || row.conversation.startup || row.conversation.needsTerminal)))
      const cards = await Promise.all(selected.map(async work => {
        const detail = await api.workDetail(workspaceId, work.id)
        const report = detail.reports.find(row => row.id === work.latestReportId)
        const workflow = flows.find(flow => flow.nodes.some(node => node.workId === work.id))
        return { detail, report: report?.summary,
          workflow, node: workflow?.nodes.find(node => node.workId === work.id),
          environment: environments.environments?.find(row => row.workId === work.id && row.removedAt === null && row.releasedAt === undefined),
          operation: environments.operations.find(row => row.workId === work.id && row.status === 'pending'),
          schedule: scheduled.entries.find(row => row.workId === work.id) }
      }))
      if (epoch !== generation.current || read !== reads.current) return
      visibleWorks.current = new Set(cards.map(row => row.detail.work.id))
      setViews(cards); setTotal(resident.length); setSchedule(scheduled); setWorkflows(flows)
      if (runtime === runtimeRevision.current) setWorkers(live)
      setRefreshError(plans?.diagnostic ?? '')
    } catch (value) {
      if (epoch === generation.current && read === reads.current) setRefreshError(String(value))
    }
  }, [api, workspaceId, limit, focusedWorkId])

  useEffect(() => {
    const epoch = ++generation.current
    setViews([]); setWorkers([]); setTotal(0); setSchedule(undefined); setWorkflows([]); setRefreshError('')
    visibleWorks.current.clear()
    if (!api || !workspaceId) return
    const read = () => { void refresh() }
    read()
    const records = api.onChanged(change => { if (change.workspaceId === workspaceId) read() })
    const environments = api.onEnvironmentsChanged(change => { if (change.workspaceId === workspaceId) read() })
    const scheduling = api.onScheduleChanged(change => { if (change.workspaceId === workspaceId) read() })
    const workflows = api.onWorkflowsChanged?.(change => { if (change.workspaceId === workspaceId) read() })
    const ageing = window.setInterval(read, 30_000)
    const runtime = api.onWorkerChanged(snapshot => {
      if (snapshot.workspaceId !== workspaceId) return
      runtimeRevision.current++
      setWorkers(current => snapshot.retiredAt !== undefined
        ? current.filter(row => row.workId !== snapshot.workId || row.executionId !== snapshot.executionId)
        : [...current.filter(row => row.workId !== snapshot.workId), snapshot])
      if (snapshot.retiredAt !== undefined || !visibleWorks.current.has(snapshot.workId)) read()
    })
    return () => { generation.current = epoch + 1; window.clearInterval(ageing); records(); runtime(); environments(); scheduling(); workflows?.() }
  }, [api, workspaceId, refresh])

  return { api, workspaceId, workspace, views, workers, schedule, workflows,
    setLimit, total, error: refreshError, refresh }
}

type ViewChanges = (workspaceId: string, path: string) => Promise<void>
const WorkContext = createContext<(ReturnType<typeof useWorkState> & { onViewChanges?: ViewChanges }) | null>(null)
export function SuperAgentWorkProvider({ children, onViewChanges, revealWork, revealConversation }: { children: ReactNode; onViewChanges?: ViewChanges; revealWork?(): void; revealConversation?(): void }) {
  const state = useWorkState()
  return <WorkContext.Provider value={{ ...state, onViewChanges }}><WorkerScheduleContext.Provider value={state.schedule}><SuperAgentPresentationProvider workspaceId={state.workspaceId} details={state.views.map(view => view.detail)} revealWork={revealWork} revealConversation={revealConversation}>{children}</SuperAgentPresentationProvider></WorkerScheduleContext.Provider></WorkContext.Provider>
}

export function SuperAgentMonitorRail({ visible }: { visible: boolean }) {
  const state = useContext(WorkContext), presentation = useSuperAgentPresentation(), { t } = useTranslation('janus')
  const seen = useSuperAgentUIStore(value => value.readWorkerReports)
  if (!state || !presentation) return null
  const entries = state.views.map(view => {
    const work = view.detail.work, worker = state.workers.find(row => row.workId === work.id)
    const latest = view.detail.reports.find(row => row.id === work.latestReportId)
    const phase = work.closedAt !== null ? 'closed' : worker?.phase ?? (view.schedule?.status === 'queued' ? 'queued' : latest ? 'ready' : 'idle')
    return { id: work.id, title: workerHeadline(work.title, worker), phase, worker, branch: view.environment?.checkout.branch,
      status: view.schedule?.status === 'paused' ? t('superagent.queue.reason.paused') : t(`superagent.phase.${phase}`),
      running: workGroup(view, worker) === 'running', unread: !!latest && seen[JSON.stringify([work.workspaceId, work.id])] !== latest.resourceId,
      report: latest ? { title: work.title, summary: view.report ?? latest.summary, workspaceId: work.workspaceId, resourceId: latest.resourceId } : undefined }
  })
  return <WorkerDockRail entries={entries} visible={visible} reveal={presentation.focusWork}
    openReport={(entry, trigger) => { if (entry.report) presentation.openReport(entry.id, entry.report, trigger) }} />
}

export function SuperAgentWorkHeader() {
  const { t } = useTranslation('janus')
  const state = useContext(WorkContext)
  const schedule = state?.schedule
  return <header className={styles.panelHeader} data-worker-panel-header="">
    <div className={styles.panelHeading} data-worker-panel-heading="">
      <strong>{t('superagent.workers')}</strong>
      {schedule && <span className={styles.capacityInfo} title={t('superagent.capacitySummary', { occupied: schedule.occupied, capacity: schedule.maxConcurrentWorkers })}>
        {t('superagent.capacityOccupied', { occupied: schedule.occupied, capacity: schedule.maxConcurrentWorkers })}
      </span>}
    </div>
    {state?.workspace && <span className={styles.workspaceName} title={state.workspace.name}>{state.workspace.name}</span>}
  </header>
}

export function SuperAgentWork({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation('janus')
  const state = useContext(WorkContext)
  if (!state) return <SuperAgentWorkProvider><SuperAgentWork conversationId={conversationId} /></SuperAgentWorkProvider>
  const { api, workspaceId, views, workers, schedule, workflows,
    setLimit, total, error, refresh } = state

  if (!api || !workspaceId) return <p className={styles.empty}>{t('superagent.chooseWorkspace')}</p>
  return <section className={styles.work} aria-label={t('superagent.heading')}>
    {!views.length && <div className={styles.empty} data-worker-empty=""><Box size={24} aria-hidden="true" /><strong>{t('superagent.noWorkers')}</strong><p>{t('superagent.startHint')}</p></div>}
    {(error || schedule?.diagnostic) && <p role="alert">{error || schedule?.diagnostic}</p>}
    <div className={styles.workList}>
    {workflows.map(flow => <WorkflowCard key={flow.id} flow={flow} refresh={refresh}>
      {flow.nodes.map(node => { const view = views.find(row => row.detail.work.id === node.workId); return view && <WorkCard key={view.detail.work.id} view={view} mode="status"
        conversationId={conversationId} worker={workers.find(row => row.workId === node.workId)} refresh={refresh} /> })}
    </WorkflowCard>)}
    {(['running', 'queued', 'attention', 'completed'] as const).flatMap(group => {
      const items = views.filter(view => !view.workflow && workGroup(view, workers.find(row => row.workId === view.detail.work.id)) === group)
        .sort((a, b) => (a.schedule?.queuePosition ?? Infinity) - (b.schedule?.queuePosition ?? Infinity) || (a.schedule?.order ?? 0) - (b.schedule?.order ?? 0))
      if (!items.length) return []
      // Keep cards as keyed siblings so changing groups preserves open controls, errors and draft answers.
      return [<h3 key={group} id={`work-group-${group}`} className={styles.groupHeading}>{t(`superagent.queue.group.${group}`)} <span>{items.length}</span></h3>,
        ...items.map(view => <WorkCard key={workspaceId + ':' + view.detail.work.id} view={view} mode="status" group={group}
          conversationId={conversationId} worker={workers.find(row => row.workId === view.detail.work.id)} refresh={refresh} />)]
    })}</div>
    {total > views.length && <button onClick={() => setLimit(value => value + 10)}>{t('superagent.more')}</button>}
  </section>
}

function WorkflowCard({ flow, refresh, children }: { flow: SuperAgentWorkflow; refresh(): Promise<void>; children: ReactNode }) {
  const { t } = useTranslation('janus'), api = window.electron.superAgent!
  const [expanded, setExpanded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirmStop, setConfirmStop] = useState(false)
  const lock = useRef(false)
  const control = async (action: 'pause' | 'resume' | 'stop') => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try { await api.controlWorkflow({ workspaceId: flow.workspaceId, workflowId: flow.id, expectedRevision: flow.revision, action }); setConfirmStop(false) }
    catch (error) { setError(String(error)) }
    finally { await refresh(); lock.current = false; setBusy(false) }
  }
  const ended = ['completed', 'stopped'].includes(flow.state)
  return <article className={styles.workflow} data-workflow-id={flow.id} data-state={flow.state} aria-label={flow.title}>
    <WorkerSummaryHeader title={flow.title} subtitle={t('workflow.workers', { count: flow.nodes.length })} status={t(`workflow.state.${flow.state}`)} running={flow.state === 'running'} expanded={expanded} controlsId={`workflow-monitor-${flow.id}`} toggle={() => setExpanded(value => !value)} />
    <div className={styles.workflowChildren}>{children}</div>
    <div className={styles.workflowResult}><span>Janus</span><span>{flow.state === 'completed' ? t('workflow.delivered') : t('workflow.progress', { done: flow.nodes.filter(node => node.state === 'done').length, total: flow.nodes.length })}</span></div>
    <WorkerMonitorBody id={`workflow-monitor-${flow.id}`} expanded={expanded}><div className={styles.workflowDetails}>
      <p>{flow.goal}</p>
      <ol>{flow.nodes.map(node => <li key={node.key}><strong>{node.label}</strong><span>{node.dependencies.length ? t('workflow.after', { names: node.dependencies.map(key => flow.nodes.find(row => row.key === key)?.label).join('、') }) : t('workflow.independent')}</span></li>)}</ol>
      <p>{t('workflow.repair', { current: flow.repairRound, maximum: flow.maxRepairRounds })}</p>
      {flow.history.map(row => <p key={row.reportId}>{row.summary}</p>)}
    </div></WorkerMonitorBody>
    {(error || flow.diagnostic) && <div className={styles.failure} role="alert">{error || flow.diagnostic}</div>}
    {!ended && <div className={styles.workflowFooter}>
      <button type="button" className={styles.workflowDetailsButton} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{t('workflow.details')}</button>
      <span />
      {['running', 'paused', 'blocked', 'interrupted'].includes(flow.state) && <button type="button" className={styles.iconAction} disabled={busy} title={t(flow.state === 'running' ? 'workflow.pause' : 'workflow.resume')} aria-label={t(flow.state === 'running' ? 'workflow.pause' : 'workflow.resume')}
        onClick={() => void control(flow.state === 'running' ? 'pause' : 'resume')}>{flow.state === 'running' ? <Pause size={14} /> : <Play size={14} />}</button>}
      <button type="button" className={styles.iconAction} disabled={busy || flow.state === 'stopping'} title={t('workflow.stop')} aria-label={t('workflow.stop')} onClick={() => setConfirmStop(true)}><Square size={14} /></button>
    </div>}
    {confirmStop && <div className={styles.closeConfirm} role="group" aria-label={t('workflow.stop')}><p>{t('workflow.stopHint')}</p><div className={styles.confirmActions}>
      <button type="button" disabled={busy} onClick={() => setConfirmStop(false)}>{t('topics.cancel')}</button><button type="button" disabled={busy} onClick={() => void control('stop')}>{t('workflow.stop')}</button>
    </div></div>}
  </article>
}

export function SuperAgentWorkflowPlans({ conversationId, relatedConversationIds = [] }: { conversationId: string; relatedConversationIds?: string[] }) {
  const state = useContext(WorkContext), { t } = useTranslation('janus')
  const plans = state?.workflows.filter(flow => flow.conversationId === conversationId || relatedConversationIds.includes(flow.conversationId)) ?? []
  if (!plans.length) return null
  return <section className={styles.planList} aria-label={t('workflow.plans')}>{plans.map(flow => <WorkflowPlan key={flow.id} flow={flow} />)}</section>
}

function WorkflowPlan({ flow }: { flow: SuperAgentWorkflow }) {
  const { t } = useTranslation('janus'), [expanded, setExpanded] = useState<boolean>()
  const open = expanded ?? !['completed', 'stopped'].includes(flow.state)
  return <details className={styles.plan} data-workflow-plan={flow.id} data-state={flow.state} open={open}>
    <summary onClick={event => { event.preventDefault(); setExpanded(!open) }}>
      <ChevronRight size={14} aria-hidden="true" /><strong>{flow.title}</strong>
      <span>{flow.nodes.filter(node => node.state === 'done').length} / {flow.nodes.length}</span><span>{t(`workflow.state.${flow.state}`)}</span>
    </summary>
    <div className={styles.planSteps}>{flow.nodes.map(node => <WorkflowPlanNode key={node.key} node={node} running={flow.state === 'running'} />)}</div>
  </details>
}

function WorkflowPlanNode({ node, running }: { node: SuperAgentWorkflowNode; running: boolean }) {
  const { t } = useTranslation('janus'), presentation = useSuperAgentPresentation()
  const highlight = useSuperAgentHighlight(node.workId ? { workIds: [node.workId] } : null)
  const active = running && ['running', 'admitting'].includes(node.state)
  return <button type="button" className={styles.planNode} data-current={active} data-state={node.state} disabled={!node.workId} {...highlight}
    onClick={() => node.workId && presentation?.focusWork(node.workId)}>
    {node.state === 'done' ? <Check size={13} aria-hidden="true" /> : active ? <LoaderCircle size={13} className={styles.planSpinner} aria-hidden="true" /> : <Circle size={11} aria-hidden="true" />}
    <span>{node.label}</span><small>{t(`workflow.node.${node.state}`)}</small>
  </button>
}

export function SuperAgentDecisions({ conversationId }: { conversationId: string }) {
  const state = useContext(WorkContext)
  const { t } = useTranslation('janus')
  if (!state) return null
  const pending = state.views.filter(view => needsDecision(view, state.workers.find(row => row.workId === view.detail.work.id)))
  if (!pending.length) return null
  return <section className={styles.work} aria-label={t('superagent.decisions')}>
    {pending.map(view => <WorkCard key={state.workspaceId + ':' + view.detail.work.id} view={view} mode="decisions"
      conversationId={conversationId} worker={state.workers.find(row => row.workId === view.detail.work.id)} refresh={state.refresh} />)}
  </section>
}

function needsDecision(view: WorkView, worker?: SuperAgentWorkerSnapshot) {
  return pendingReportQuestion(view.detail.work, view.detail.reports) || view.operation || ['failed', 'blocked'].includes(view.schedule?.status ?? '') || worker?.phase === 'failed' || (worker && !worker.restored && !worker.stopConfirmed &&
    (worker.conversation.approvals.length || worker.conversation.questions?.length || worker.commitRequest?.status === 'pending' || worker.conversation.startup || worker.conversation.needsTerminal))
}

/** Work restoration must settle before an empty conversation is presented. */
export function useSuperAgentWelcomeState(conversationId: string) {
  const state = useContext(WorkContext)
  return {
    loading: Boolean(state?.api && state.workspaceId && !state.schedule && !state.error),
    hasContent: Boolean(state?.error || state?.workflows.some(flow => flow.conversationId === conversationId)
      || state?.views.some(view => needsDecision(view, state.workers.find(row => row.workId === view.detail.work.id)))),
  }
}

function isSettled(view: WorkView, worker?: SuperAgentWorkerSnapshot) {
  if (view.schedule && ['queued', 'paused', 'awaiting-approval', 'starting'].includes(view.schedule.status)) return false
  if (view.operation || pendingReportQuestion(view.detail.work, view.detail.reports) || view.schedule?.diagnostic || worker?.diagnostic
    || view.detail.reports.some(row => row.id === view.detail.work.latestReportId && row.kind === 'failure')
    || worker?.conversation.approvals.length || worker?.conversation.questions?.some(row => row.status === 'pending') || worker?.conversation.startup || worker?.conversation.needsTerminal || worker?.commitRequest?.status === 'pending') return false
  return (view.detail.work.closedAt !== null && (!worker || worker.stopConfirmed)) || worker?.phase === 'idle' || worker?.phase === 'ready'
}

function workGroup(view: WorkView, worker?: SuperAgentWorkerSnapshot): 'running' | 'queued' | 'attention' | 'completed' {
  if (view.schedule && ['queued', 'paused'].includes(view.schedule.status) && !view.schedule.occupiesSlot) return 'queued'
  if (view.operation || pendingReportQuestion(view.detail.work, view.detail.reports)
    || ['blocked', 'failed', 'interrupted', 'awaiting-approval'].includes(view.schedule?.status ?? '')
    || worker?.phase === 'failed' || worker?.phase === 'interrupted'
    || (worker && !worker.stopConfirmed && (worker.phase === 'waiting' || worker.conversation.approvals.length
      || worker.conversation.questions?.some(row => row.status === 'pending') || worker.conversation.startup || worker.conversation.needsTerminal || worker.commitRequest?.status === 'pending'))) return 'attention'
  if (view.schedule?.occupiesSlot || (worker && !worker.stopConfirmed) || view.schedule?.status === 'starting') return 'running'
  return 'completed'
}

function WorkCard({ view, worker, conversationId, refresh, mode, group }: { view: WorkView; worker?: SuperAgentWorkerSnapshot; conversationId: string; refresh(): Promise<void>; mode: 'status' | 'decisions'; group?: ReturnType<typeof workGroup> }) {
  const { t } = useTranslation('janus'), api = window.electron.superAgent!
  const onViewChanges = useContext(WorkContext)?.onViewChanges
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [confirmClose, setConfirmClose] = useState(false)
  const closeButton = useRef<HTMLButtonElement>(null)
  const [failureLog, setFailureLog] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [summaryExpanded, setSummaryExpanded] = useState(false)
  const settled = isSettled(view, worker)
  const actionLock = useRef(false), retryEvent = useRef<string | null>(null)
  const { detail, report, operation, schedule } = view, work = detail.work
  const highlight = useSuperAgentHighlight({ workIds: [work.id] })
  const focusedWorkId = useSuperAgentUIStore(state => state.focusedWorkId)
  const prompt = workerPrompt(worker)
  const card = useRef<HTMLElement>(null)
  useEffect(() => {
    let cancelled = false
    setFailureLog('')
    if (mode === 'status' && worker?.phase === 'failed' && !worker.diagnostic) {
      void api.workerLog(work.workspaceId, worker.executionId).then(log => {
        if (!cancelled && log.available) setFailureLog(log.text.slice(-1500))
      }).catch(value => { if (!cancelled) setFailureLog(String(value)) })
    }
    return () => { cancelled = true }
  }, [api, mode, worker?.phase, worker?.diagnostic, worker?.executionId, work.workspaceId])
  useEffect(() => {
    if (focusedWorkId === work.id && mode === 'status') { setExpanded(true); setSummaryExpanded(true); card.current?.scrollIntoView({ block: 'nearest' }) }
  }, [focusedWorkId, work.id, mode])
  const run = async (action: () => Promise<unknown>) => {
    if (actionLock.current) return
    actionLock.current = true
    setBusy(true); setError('')
    try { await action(); await refresh() } catch (value) { setError(String(value)); await refresh() } finally { actionLock.current = false; setBusy(false) }
  }
  type NativeAction = SuperAgentWorkerControl extends infer Control ? Control extends SuperAgentWorkerControl ? Omit<Control, 'workspaceId' | 'workId' | 'executionId'> : never : never
  const control = (action: NativeAction) => {
    if (worker) void run(() => api.controlWorker({ workspaceId: work.workspaceId, workId: work.id, executionId: worker.executionId, ...action }))
  }
  const active = worker && !worker.restored && work.closedAt === null && !worker.stopConfirmed && !['stopping', 'failed', 'stopped', 'interrupted'].includes(worker.phase)
  const stream = workerStream(worker)
  const reply = workerReply(worker)
  const headline = workerHeadline(work.title, worker)
  const checkout = view.environment?.checkout
  const streamPanel = useRef<HTMLDivElement>(null), followStream = useRef(true)
  const replyPanel = useRef<HTMLDivElement>(null), followReply = useRef(true)
  useLayoutEffect(() => {
    if (followStream.current && streamPanel.current) streamPanel.current.scrollTop = streamPanel.current.scrollHeight
  }, [stream.text])
  useLayoutEffect(() => {
    if (followReply.current && replyPanel.current) replyPanel.current.scrollTop = replyPanel.current.scrollHeight
  }, [reply.text])
  const pendingQuestion = pendingReportQuestion(work, detail.reports)
  const latestReport = detail.reports.find(row => row.id === work.latestReportId)
  const commit = worker?.commitRequest
  const phase = worker && !worker.stopConfirmed && work.closedAt !== null && !worker.restored && !['failed', 'interrupted'].includes(worker.phase) ? 'stopping'
    : worker && !worker.stopConfirmed && (worker.phase === 'failed' || worker.restored) ? worker.phase
    : work.closedAt !== null ? 'closed'
    : worker?.stopConfirmed && schedule && ['failed', 'blocked', 'queued', 'paused', 'cancelled', 'starting', 'awaiting-approval', 'stopped', 'interrupted'].includes(schedule.status)
      ? schedule.status : worker?.phase ?? schedule?.status
  const displayPhase = phase === 'idle' && pendingQuestion ? 'question' : phase === 'idle' && latestReport?.kind === 'failure' ? 'report-failed' : phase
  const diagnostic = error || schedule?.diagnostic || worker?.diagnostic || failureLog
  const environmentBusy = diagnostic.includes('Environment is occupied by an active worker or terminal')
  const environmentPath = work.environmentSelection?.path ?? view.environment?.checkout.path
  const canStop = (worker && !worker.stopConfirmed) || ['awaiting-approval', 'starting'].includes(schedule?.status ?? '')
  const cancelClose = () => { setConfirmClose(false); requestAnimationFrame(() => closeButton.current?.focus()) }
  const actionButtons = !confirmClose && <>
    {!view.workflow && work.closedAt === null && ['failed', 'blocked', 'interrupted', 'stopped'].includes(phase ?? '') && (!worker || worker.stopConfirmed) && <button type="button" className={styles.iconAction} title={t('topics.retryWorker')} aria-label={t('topics.retryWorker')} disabled={busy} onClick={() => void run(async () => {
      retryEvent.current ??= crypto.randomUUID()
      await api.continueWorker({ workspaceId: work.workspaceId, conversationId: worker?.conversationId ?? conversationId,
        workId: work.id, eventId: retryEvent.current, text: t('topics.retryWorker') })
      retryEvent.current = null
    })}><RotateCcw size={14} aria-hidden="true" /></button>}
    {canStop && <button type="button" className={styles.iconAction} title={t('superagent.stop')} aria-label={t('superagent.stop')} disabled={busy || phase === 'stopping'}
      onClick={() => void run(() => api.controlWork({ workspaceId: work.workspaceId, conversationId, workId: work.id, expectedRevision: work.revision, action: 'stop' }))}><Square size={14} aria-hidden="true" /></button>}
    {work.closedAt === null && <button type="button" ref={closeButton} className={`${styles.iconAction} ${styles.closeWorkButton}`} title={t('superagent.close')} aria-label={t('superagent.close')} disabled={busy || phase === 'stopping'} onClick={() => setConfirmClose(true)}><X size={15} aria-hidden="true" /></button>}
  </>
  return <article ref={card} role={mode === 'decisions' ? 'group' : undefined} className={styles.card} aria-label={work.title} data-work-id={work.id} data-phase={phase} data-presentation={mode}
    data-work-group={group} aria-describedby={group ? `work-group-${group}` : undefined} data-settled={settled} data-summary-expanded={summaryExpanded || confirmClose} tabIndex={mode === 'status' ? 0 : undefined} {...highlight}>
    {mode === 'decisions' && <div className={styles.heading}><strong>{work.title}</strong><span role="status">{displayPhase ? t(`superagent.phase.${displayPhase}`) : t('superagent.history')}</span></div>}
    {mode === 'status' && <>
    <div className={styles.workerOverview}>
      <WorkerSummaryHeader title={headline} engine={worker?.conversation.engine === 'claude' || work.workerBackend === 'claude' ? 'claude' : 'codex'}
        running={Boolean(active && ['starting', 'running'].includes(phase ?? '') && workGroup(view, worker) === 'running' && (!view.node || ['running', 'admitting'].includes(view.node.state)))}
        subtitle={`${view.node?.label ?? 'Worker'} · ${worker?.conversation.engine === 'claude' || work.workerBackend === 'claude' ? 'Claude Code' : 'Codex'}`}
        status={view.node?.state === 'waiting' ? view.workflow && ['paused', 'blocked', 'interrupted'].includes(view.workflow.state) ? t(`workflow.state.${view.workflow.state}`) : t(view.node.dependencies.length ? 'workflow.node.waiting' : 'workflow.node.admitting')
          : view.workflow?.state === 'paused' && !schedule?.occupiesSlot ? t('workflow.state.paused')
          : schedule?.status === 'queued' && schedule.queuePosition ? t('workflow.queuePosition', { position: schedule.queuePosition })
          : view.node && ['done', 'blocked', 'stopped'].includes(view.node.state) ? t(`workflow.node.${view.node.state}`)
          : displayPhase ? t(`superagent.phase.${displayPhase}`) : t('superagent.history')}
        expanded={summaryExpanded} controlsId={`worker-monitor-${work.id}`} toggle={() => setSummaryExpanded(value => !value)}
        actions={latestReport && report && <WorkerReportCard title={work.title} summary={report} workspaceId={work.workspaceId} resourceId={latestReport.resourceId} workId={work.id} buttonOnly="icon" />} />
    </div>
    <WorkerMonitorBody id={`worker-monitor-${work.id}`} expanded={summaryExpanded}>
      <div className={styles.records}>
      {work.review && <details data-worker-review={work.review.state}>
        <summary>{t(`superagent.review.${work.review.state}`)}</summary>
        <p>{work.review.summary}</p>
        {work.review.findings.map((finding, index) => <p key={index}>{finding}</p>)}
        {work.review.criteria?.map((criterion, index) => <p key={index}>{t(`superagent.reviewCriterion.${criterion.status}`)} · {criterion.criterion}</p>)}
      </details>}
      <div className={styles.workerMeta}>{checkout?.branch && <WorkerBranch branch={checkout.branch} path={checkout.path} />}<WorkerElapsed worker={worker} /><div className={styles.headerActions}>{actionButtons}</div></div>
      <WorkerDisclosure label={t('superagent.latestOutput')}>
      <div ref={replyPanel} className={styles.stream} data-worker-reply="" role="region" aria-label={t('superagent.latestOutput')} tabIndex={0}
        onScroll={event => { const el = event.currentTarget; followReply.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24 }}>
        <span>{reply.text || t('superagent.noOutput')}</span>
        {reply.truncated && <small>{t('superagent.streamTruncated')}</small>}
      </div>
      </WorkerDisclosure>
      <WorkerDisclosure label={t('superagent.currentCommand')}>
      <div ref={streamPanel} className={`${styles.stream} ${styles.command}`} data-worker-stream="" data-running={stream.running && work.closedAt === null} role="region" aria-label={t('superagent.currentCommand')} tabIndex={0}
        onScroll={event => { const el = event.currentTarget; followStream.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24 }}>
        <span>{work.closedAt !== null ? t('superagent.streamStopped') : stream.text.trimEnd() || t(worker?.phase === 'failed' || worker?.restored || worker?.conversation.connection === 'disconnected' ? 'superagent.streamUnknown' : 'superagent.streamIdle')}</span>
        {stream.running && work.closedAt === null && <i className={styles.caret} aria-hidden="true" />}
        {stream.truncated && <small>{t('superagent.streamTruncated')}</small>}
      </div>
      </WorkerDisclosure>
      </div>
    <div className={styles.workerTools}>
    {worker && <WorkerModelControls key={worker.executionId} worker={worker} />}
    <button type="button" className={styles.workerToggle} title={t('superagent.latestPrompt')} aria-label={t('superagent.latestPrompt')} aria-expanded={expanded} aria-controls={`worker-prompt-${work.id}`} onClick={() => setExpanded(value => !value)}>
      <FileText size={12} aria-hidden="true" /><span>{t('superagent.promptLabel')}</span><ChevronDown size={11} data-open={expanded} aria-hidden="true" />
    </button>
    </div>
    <div className={styles.prompt} id={`worker-prompt-${work.id}`} hidden={!expanded}>
      <h3>{t('superagent.latestPrompt')}</h3>
      {prompt.text ? <><p data-worker-prompt="">{prompt.text}</p>{prompt.truncated && <small>{t('superagent.streamTruncated')}</small>}</> : <p>{t('superagent.noPrompt')}</p>}
      {view.environment && onViewChanges && <button type="button" disabled={busy}
        onClick={() => void run(() => onViewChanges(work.workspaceId, view.environment!.checkout.path))}>{t('superagent.viewChanges')}</button>}
      {worker?.disabledExtensions.length ? <p>{t('superagent.extensions')}: {worker.disabledExtensions.join(', ')}</p> : null}
    </div>
    {schedule && <WorkerQueueControls entry={schedule} busy={busy} run={run} />}
    {!['queued', 'paused'].includes(schedule?.status ?? '') && detail.deliveries.some(row => row.status === 'pending' || row.status === 'unknown') && <p>{t('superagent.pendingInput')}</p>}
    </WorkerMonitorBody>
    </>}
    {mode === 'decisions' && !['queued', 'paused'].includes(schedule?.status ?? '') && detail.deliveries.some(row => row.status === 'pending' || row.status === 'unknown') && <p>{t('superagent.pendingInput')}</p>}
    {mode === 'decisions' && <>
    {pendingQuestion && <WorkerQuestionCard key={pendingQuestion.id} report={pendingQuestion} title={work.title} conversationId={detail.inputs.find(row => row.id === work.sourceInputId)?.conversationId ?? conversationId} refresh={refresh} />}
    {work.closedAt === null && operation && <div className={styles.decision}>
      <strong>{t(`superagent.gitOperation.${operation.plan.kind}`)}</strong>
      <pre>{operation.plan.kind === 'create' ? `${operation.plan.targetPath}\n${operation.plan.branch}\n${operation.plan.baseRef} @ ${operation.plan.baseCommit}`
        : operation.plan.kind === 'merge' ? `${operation.plan.source.path} (${operation.plan.source.branch}) → ${operation.plan.target.path} (${operation.plan.target.branch})`
          : `${operation.plan.source.path} (${operation.plan.source.branch})`}</pre>
      {operation.plan.kind === 'create' && operation.plan.source.dirty && <p>{t('superagent.createCommittedOnly')}</p>}
      {operation.plan.kind === 'remove' && <p>{t('superagent.removeDetails', { count: operation.plan.unmergedCommits })}<br />{operation.plan.source.ignoredEntries.join('\n')}</p>}
      <button disabled={busy} onClick={() => void run(() => api.decideEnvironmentOperation({ workspaceId: work.workspaceId, operationId: operation.id, approved: false }))}>{t('superagent.decline')}</button>
      <button disabled={busy} onClick={() => void run(async () => {
        const result = await api.decideEnvironmentOperation({ workspaceId: work.workspaceId, operationId: operation.id, approved: true })
        if (result.status !== 'succeeded') throw new Error(result.message ?? result.status)
      })}>{t(operation.plan.kind === 'create' ? 'superagent.createAndStart' : 'superagent.approveOperation')}</button>
    </div>}
    {active && worker.conversation.startup && (worker.conversation.startup.status === 'cancelled'
      ? <button disabled={busy} onClick={() => control({ type: 'startup', command: { type: 'startup', startupId: worker.conversation.startup!.id, action: 'resume', controlEpoch: worker.conversation.controlEpoch } })}>{t('superagent.resumeSetup')}</button>
      : <ConversationStartupPanel startup={worker.conversation.startup} epoch={worker.conversation.controlEpoch} busy={busy} action={async command => {
        if (command.type !== 'startup') return false
        setBusy(true); setError('')
        try { await api.controlWorker({ workspaceId: work.workspaceId, workId: work.id, executionId: worker.executionId, type: 'startup', command }); await refresh(); return true }
        catch (value) { setError(String(value)); return false } finally { setBusy(false) }
      }} />)}
    {active && worker.conversation.approvals.map(approval => <div className={styles.decision} key={approval.id}>
      <strong>{t('superagent.nativeApproval')}</strong><pre>{approval.description}</pre>
      {approval.choices?.map(choice => <button key={choice.id} disabled={busy} onClick={() => control({ type: 'approve', requestId: approval.id, decision: choice.id })}>{t(`terminal:conversation.approvalChoices.${approval.permissionScope === 'turn' && choice.id === 'accept' ? 'acceptForTurn' : choice.id}`, { defaultValue: choice.label })}</button>)}
    </div>)}
    {active && worker.conversation.questions?.map(request => <ConversationQuestions key={request.id + ':' + request.version} request={request} disabled={busy}
      answer={answer => control({ type: 'answer', requestId: request.id, version: request.version, answer })} />)}
    {active && commit?.status === 'pending' && <div className={styles.decision}>
      <strong>{t(commit.publish ? 'superagent.publishGit' : 'superagent.commit')}</strong><pre>{commit.publish ? JSON.stringify(commit.publish, null, 2) : commit.message}{'\n'}{commit.paths.join('\n')}{'\n'}{commit.head}</pre>
      {commit.changes.map(change => <details key={change.path}><summary>{change.path} ({change.bytes} B)</summary><pre>{change.patch}</pre>
        {change.truncated && <p>{t('superagent.diffTruncated')}</p>}<small>SHA-256: {change.sha256}</small></details>)}
      <button disabled={busy} onClick={() => control({ type: 'commit', requestId: commit.id, approved: false })}>{t('superagent.decline')}</button>
      <button disabled={busy} onClick={() => control({ type: 'commit', requestId: commit.id, approved: true })}>{t(commit.publish ? 'superagent.approveOperation' : 'superagent.allowCommit')}</button>
    </div>}
    {commit && commit.status !== 'pending' && <p>{t('superagent.commitResult', { status: commit.status })} {commit.commit} {commit.error}</p>}
    {active && worker.conversation.needsTerminal && <div className={styles.decision} role="alert">
      <p>{t('superagent.unsupported')}</p>
      {worker.conversation.error && <pre>{worker.conversation.error}</pre>}
    </div>}
    </>}
    {diagnostic && <div className={styles.failure} role="alert">
      {environmentBusy ? <>
        <strong>{t('superagent.environmentBusy')}</strong>
        {environmentPath && <code className={styles.failurePath}>{environmentPath}</code>}
        <p>{t('superagent.environmentBusyHint')}</p>
        <details><summary>{t('superagent.diagnosticDetails')}</summary><pre>{diagnostic}</pre></details>
      </> : diagnostic}
    </div>}
    {(confirmClose || mode === 'decisions') && (work.closedAt === null || (worker && !worker.stopConfirmed)) && <div className={styles.workActions}>
      {confirmClose && work.closedAt === null ? <div className={styles.closeConfirm} role="group" aria-label={t('topics.confirmClose')}
        onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); if (!busy) cancelClose() } }}>
        <p>{t('topics.closeConfirm')}</p>
        <div className={styles.confirmActions}>
          <button type="button" autoFocus disabled={busy} onClick={cancelClose}>{t('topics.cancel')}</button>
          <button type="button" className={styles.confirmCloseButton} disabled={busy} onClick={() => void run(async () => {
            await api.controlWork({ workspaceId: work.workspaceId, conversationId: worker?.conversationId ?? conversationId, workId: work.id, expectedRevision: work.revision, action: 'close' })
            setConfirmClose(false)
          })}>{t('topics.confirmClose')}</button>
        </div>
      </div> : actionButtons}
    </div>}
  </article>
}
