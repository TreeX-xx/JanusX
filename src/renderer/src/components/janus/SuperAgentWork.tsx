import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { SuperAgentWorkDetail } from '../../../../shared/superagent'
import type { SuperAgentEnvironment, SuperAgentGitOperation } from '../../../../shared/superagent-environment'
import type { SuperAgentWorkerControl, SuperAgentWorkerSnapshot } from '../../../../shared/superagent-worker'
import type { SuperAgentScheduleEntry, SuperAgentScheduleSnapshot } from '../../../../shared/superagent-scheduling'
import { useWorkspaceStore } from '../../stores/workspace'
import { useSuperAgentUIStore } from '../../stores/superagent-ui'
import { ConversationQuestions } from '../ConversationQuestions'
import { MarkdownContent } from '../chat/ChatContent'
import styles from './SuperAgentWork.module.css'

interface WorkView { detail: SuperAgentWorkDetail; report?: string; environment?: SuperAgentEnvironment; operation?: SuperAgentGitOperation; schedule?: SuperAgentScheduleEntry }

/** Resident instances and current arrangements; retired work remains queryable through ordinary chat. */
function useWorkState() {
  const workspaceId = useWorkspaceStore(state => state.activeWorkspaceId)
  const workspace = useWorkspaceStore(state => state.workspaces.find(row => row.id === workspaceId))
  const focusedWorkId = useSuperAgentUIStore(state => state.focusedWorkId)
  const api = window.electron?.superAgent
  const [views, setViews] = useState<WorkView[]>([])
  const [workers, setWorkers] = useState<SuperAgentWorkerSnapshot[]>([])
  const [schedule, setSchedule] = useState<SuperAgentScheduleSnapshot>()
  const [capacity, setCapacity] = useState('2')
  const [saving, setSaving] = useState(false)
  const [limit, setLimit] = useState(10)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const generation = useRef(0), reads = useRef(0), runtimeRevision = useRef(0)
  const visibleWorks = useRef(new Set<string>())

  const refresh = useCallback(async () => {
    if (!api || !workspaceId) return
    const epoch = generation.current, read = ++reads.current, runtime = runtimeRevision.current
    const [snapshot, live, environments, scheduled] = await Promise.all([
      api.snapshot(workspaceId), api.workers(workspaceId), api.environments(workspaceId), api.schedule(workspaceId),
    ])
    const resident = snapshot.works.filter(work => {
      const worker = live.find(row => row.workId === work.id && row.retiredAt === undefined)
      const arranged = scheduled.entries.find(row => row.workId === work.id)
      if (work.closedAt === null && environments.operations.some(row => row.workId === work.id && row.status === 'pending')) return true
      return worker ? work.closedAt === null || !worker.stopConfirmed
        : work.closedAt === null && arranged && ['queued', 'awaiting-approval', 'starting', 'interrupted', 'failed'].includes(arranged.status)
    })
    // Pagination must never hide an unanswered request or an explicitly located work.
    const selected = resident.sort((a, b) => Number(a.closedAt !== null) - Number(b.closedAt !== null) || b.createdAt - a.createdAt)
      .filter((work, index) => index < limit || work.id === focusedWorkId
        || environments.operations.some(row => row.workId === work.id && row.status === 'pending')
        || live.some(row => row.workId === work.id && !row.restored && !row.stopConfirmed &&
          (row.conversation.approvals.length || row.conversation.questions?.some(question => question.status === 'pending')
            || row.commitRequest?.status === 'pending' || row.conversation.needsTerminal)))
    const cards = await Promise.all(selected.map(async work => {
      const detail = await api.workDetail(workspaceId, work.id)
      const report = detail.reports.find(row => row.id === work.latestReportId)
      return { detail, report: report?.summary,
        environment: environments.environments?.find(row => row.workId === work.id && row.removedAt === null),
        operation: environments.operations.find(row => row.workId === work.id && row.status === 'pending'),
        schedule: scheduled.entries.find(row => row.workId === work.id) }
    }))
    if (epoch !== generation.current || read !== reads.current) return
    visibleWorks.current = new Set(cards.map(row => row.detail.work.id))
    setViews(cards); setTotal(resident.length); setSchedule(scheduled)
    if (runtime === runtimeRevision.current) setWorkers(live)
    setCapacity(current => current === '' ? String(scheduled.maxConcurrentWorkers) : current)
  }, [api, workspaceId, limit, focusedWorkId])

  useEffect(() => {
    const epoch = ++generation.current
    setViews([]); setWorkers([]); setSchedule(undefined); setCapacity(''); setError(''); setSaving(false)
    visibleWorks.current.clear()
    if (!api || !workspaceId) return
    let cancelled = false
    const read = () => { void refresh().catch(value => { if (!cancelled) setError(String(value)) }) }
    read()
    const records = api.onChanged(change => { if (change.workspaceId === workspaceId) read() })
    const environments = api.onEnvironmentsChanged(change => { if (change.workspaceId === workspaceId) read() })
    const scheduling = api.onScheduleChanged(change => { if (change.workspaceId === workspaceId) read() })
    const runtime = api.onWorkerChanged(snapshot => {
      if (snapshot.workspaceId !== workspaceId) return
      runtimeRevision.current++
      setWorkers(current => snapshot.retiredAt !== undefined
        ? current.filter(row => row.workId !== snapshot.workId || row.executionId !== snapshot.executionId)
        : [...current.filter(row => row.workId !== snapshot.workId), snapshot])
      if (snapshot.retiredAt !== undefined || !visibleWorks.current.has(snapshot.workId)) read()
    })
    return () => { cancelled = true; generation.current = epoch + 1; records(); runtime(); environments(); scheduling() }
  }, [api, workspaceId, refresh])

  return { api, workspaceId, workspace, views, workers, schedule, capacity, setCapacity, saving, setSaving,
    setLimit, total, error, setError, generation, refresh }
}

type ViewChanges = (workspaceId: string, path: string) => Promise<void>
const WorkContext = createContext<(ReturnType<typeof useWorkState> & { onViewChanges?: ViewChanges }) | null>(null)
export function SuperAgentWorkProvider({ children, onViewChanges }: { children: ReactNode; onViewChanges?: ViewChanges }) {
  const state = useWorkState()
  return <WorkContext.Provider value={{ ...state, onViewChanges }}>{children}</WorkContext.Provider>
}

export function SuperAgentWork({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation('janus')
  const state = useContext(WorkContext)
  if (!state) return <SuperAgentWorkProvider><SuperAgentWork conversationId={conversationId} /></SuperAgentWorkProvider>
  const { api, workspaceId, workspace, views, workers, schedule, capacity, setCapacity, saving, setSaving,
    setLimit, total, error, setError, generation, refresh } = state

  if (!api || !workspaceId) return <p className={styles.empty}>{t('superagent.chooseWorkspace')}</p>
  return <section className={styles.work} aria-label={t('superagent.heading')}>
    <div className={styles.heading}><span>{workspace?.name}</span>
      {schedule && <span>{t('superagent.capacitySummary', { occupied: schedule.occupied, capacity: schedule.maxConcurrentWorkers })}</span>}
    </div>
    <details><summary>{t('superagent.capacity')}</summary><form className={styles.actions} onSubmit={event => {
      event.preventDefault(); const epoch = generation.current
      setSaving(true); setError('')
      void api.configureCapacity(Number(capacity)).then(() => { if (epoch === generation.current) return refresh() })
        .catch(value => { if (epoch === generation.current) setError(String(value)) }).finally(() => { if (epoch === generation.current) setSaving(false) })
    }}>
      <input aria-label={t('superagent.capacity')} type="number" min="1" step="1" value={capacity} onChange={event => setCapacity(event.target.value)} />
      <button disabled={saving || !Number.isSafeInteger(Number(capacity)) || Number(capacity) < 1}>{t('superagent.saveCapacity')}</button>
    </form></details>
    {!views.length && <p>{t('superagent.startHint')}</p>}
    {(error || schedule?.diagnostic) && <p role="alert">{error || schedule?.diagnostic}</p>}
    {views.map(view => <WorkCard key={workspaceId + ':' + view.detail.work.id} view={view} mode="status"
      conversationId={conversationId} worker={workers.find(row => row.workId === view.detail.work.id)} refresh={refresh} />)}
    {total > views.length && <button onClick={() => setLimit(value => value + 10)}>{t('superagent.more')}</button>}
  </section>
}

export function SuperAgentDecisions({ conversationId }: { conversationId: string }) {
  const state = useContext(WorkContext)
  const { t } = useTranslation('janus')
  if (!state) return null
  const pending = state.views.filter(view => {
    const worker = state.workers.find(row => row.workId === view.detail.work.id)
    return view.operation || view.schedule?.status === 'failed' || worker?.phase === 'failed' || (worker && !worker.restored && !worker.stopConfirmed &&
      (worker.conversation.approvals.length || worker.conversation.questions?.length || worker.commitRequest?.status === 'pending' || worker.conversation.needsTerminal))
  })
  if (!pending.length) return null
  return <section className={styles.work} aria-label={t('superagent.decisions')}>
    {pending.map(view => <WorkCard key={state.workspaceId + ':' + view.detail.work.id} view={view} mode="decisions"
      conversationId={conversationId} worker={state.workers.find(row => row.workId === view.detail.work.id)} refresh={state.refresh} />)}
  </section>
}

function WorkCard({ view, worker, conversationId, refresh, mode }: { view: WorkView; worker?: SuperAgentWorkerSnapshot; conversationId: string; refresh(): Promise<void>; mode: 'status' | 'decisions' }) {
  const { t } = useTranslation('janus'), api = window.electron.superAgent!
  const onViewChanges = useContext(WorkContext)?.onViewChanges
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const { detail, report, operation, schedule } = view, work = detail.work
  const focusedWorkId = useSuperAgentUIStore(state => state.focusedWorkId)
  const card = useRef<HTMLElement>(null)
  useEffect(() => {
    if (focusedWorkId === work.id && mode === 'status') card.current?.scrollIntoView({ block: 'nearest' })
  }, [focusedWorkId, work.id, mode])
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('')
    try { await action(); await refresh() } catch (value) { setError(String(value)) } finally { setBusy(false) }
  }
  type NativeAction = SuperAgentWorkerControl extends infer Control ? Control extends SuperAgentWorkerControl ? Omit<Control, 'workspaceId' | 'workId' | 'executionId'> : never : never
  const control = (action: NativeAction) => {
    if (worker) void run(() => api.controlWorker({ workspaceId: work.workspaceId, workId: work.id, executionId: worker.executionId, ...action }))
  }
  const active = worker && !worker.restored && work.closedAt === null && !worker.stopConfirmed && !['stopping', 'failed', 'stopped', 'interrupted'].includes(worker.phase)
  const recentActivity = worker?.conversation.items.filter(item => item.type !== 'userMessage'
    && (item.activity || (item.type === 'agentMessage' && item.text.trim()))).at(-1)
  const preview = recentActivity?.activity || recentActivity?.text
  const commit = worker?.commitRequest
  const phase = worker && !worker.stopConfirmed && (work.closedAt !== null || worker.phase === 'failed' || worker.restored)
    ? worker.phase === 'failed' || worker.restored ? worker.phase : 'stopping'
    : work.closedAt !== null ? 'closed' : schedule?.status ?? worker?.phase
  return <article ref={card} role={mode === 'decisions' ? 'group' : undefined} className={styles.card} aria-label={work.title} data-work-id={work.id} data-phase={phase}>
    <div className={styles.heading}><strong>{work.title}</strong><span role="status">{phase ? t(`superagent.phase.${phase}`) : t('superagent.history')}</span></div>
    {mode === 'status' && <>
    <small>Codex</small>
    {report && <div><small>{t('superagent.report')}</small><MarkdownContent content={report} variant="conversation" /></div>}
    {active && !report && preview && <p className={styles.preview}>{preview.slice(0, 500)}</p>}
    <details open={focusedWorkId === work.id || undefined}><summary>{t('superagent.details')}</summary>
      <p>{work.goal}</p><dl className={styles.facts}>
        {view.environment && <><dt>{t('superagent.directory')}</dt><dd>{view.environment.checkout.path}</dd>
          <dt>{t('superagent.branch')}</dt><dd>{view.environment.checkout.branch}</dd></>}
        {detail.executions.at(-1)?.providerSessionId && <><dt>{t('superagent.session')}</dt><dd>{detail.executions.at(-1)!.providerSessionId}</dd></>}
      </dl>
      {view.environment && onViewChanges && <button type="button" disabled={busy}
        onClick={() => void run(() => onViewChanges(work.workspaceId, view.environment!.checkout.path))}>{t('superagent.viewChanges')}</button>}
      {worker?.disabledExtensions.length ? <p>{t('superagent.extensions')}: {worker.disabledExtensions.join(', ')}</p> : null}
    </details>
    </>}
    {detail.deliveries.some(row => row.status === 'pending' || row.status === 'unknown') && <p>{t('superagent.pendingInput')}</p>}
    {mode === 'decisions' && <>
    {work.closedAt === null && operation && <div className={styles.decision}>
      <strong>{t(`superagent.gitOperation.${operation.plan.kind}`)}</strong>
      <pre>{operation.plan.kind === 'create' ? `${operation.plan.targetPath}\n${operation.plan.branch}\n${operation.plan.baseRef} @ ${operation.plan.baseCommit}`
        : operation.plan.kind === 'merge' ? `${operation.plan.source.path} (${operation.plan.source.branch}) → ${operation.plan.target.path} (${operation.plan.target.branch})`
          : `${operation.plan.source.path} (${operation.plan.source.branch})`}</pre>
      {operation.plan.kind === 'remove' && <p>{t('superagent.removeDetails', { count: operation.plan.unmergedCommits })}<br />{operation.plan.source.ignoredEntries.join('\n')}</p>}
      <button disabled={busy} onClick={() => void run(() => api.decideEnvironmentOperation({ workspaceId: work.workspaceId, operationId: operation.id, approved: false }))}>{t('superagent.decline')}</button>
      <button disabled={busy} onClick={() => void run(async () => {
        const result = await api.decideEnvironmentOperation({ workspaceId: work.workspaceId, operationId: operation.id, approved: true })
        if (result.status !== 'succeeded') throw new Error(result.message ?? result.status)
      })}>{t(operation.plan.kind === 'create' ? 'superagent.createAndStart' : 'superagent.approveOperation')}</button>
    </div>}
    {active && worker.conversation.approvals.map(approval => <div className={styles.decision} key={approval.id}>
      <strong>{t('superagent.nativeApproval')}</strong><pre>{approval.description}</pre>
      {approval.choices?.map(choice => <button key={choice.id} disabled={busy} onClick={() => control({ type: 'approve', requestId: approval.id, decision: choice.id })}>{choice.label}</button>)}
    </div>)}
    {active && worker.conversation.questions?.map(request => <ConversationQuestions key={request.id + ':' + request.version} request={request} disabled={busy}
      answer={answer => control({ type: 'answer', requestId: request.id, version: request.version, answer })} />)}
    {active && commit?.status === 'pending' && <div className={styles.decision}>
      <strong>{t('superagent.commit')}</strong><pre>{commit.message}{'\n'}{commit.paths.join('\n')}{'\n'}{commit.head}</pre>
      {commit.changes.map(change => <details key={change.path}><summary>{change.path} ({change.bytes} B)</summary><pre>{change.patch}</pre>
        {change.truncated && <p>{t('superagent.diffTruncated')}</p>}<small>SHA-256: {change.sha256}</small></details>)}
      <button disabled={busy} onClick={() => control({ type: 'commit', requestId: commit.id, approved: false })}>{t('superagent.decline')}</button>
      <button disabled={busy} onClick={() => control({ type: 'commit', requestId: commit.id, approved: true })}>{t('superagent.allowCommit')}</button>
    </div>}
    {commit && commit.status !== 'pending' && <p>{t('superagent.commitResult', { status: commit.status })} {commit.commit} {commit.error}</p>}
    {worker?.conversation.needsTerminal && <p role="alert">{t('superagent.unsupported')}</p>}
    </>}
    {(error || schedule?.diagnostic || worker?.diagnostic) && <p role="alert">{error || schedule?.diagnostic || worker?.diagnostic}</p>}
    {(work.closedAt === null || (worker && !worker.stopConfirmed)) && <div className={styles.actions}>
      {(!worker?.stopConfirmed || ['queued', 'awaiting-approval'].includes(schedule?.status ?? '')) && <button disabled={busy || phase === 'stopping'} onClick={() => void run(() => api.controlWork({ workspaceId: work.workspaceId, conversationId, workId: work.id, expectedRevision: work.revision, action: 'stop' }))}>{t('superagent.stop')}</button>}
      {work.closedAt === null && <button disabled={busy} onClick={() => void run(() => api.controlWork({ workspaceId: work.workspaceId, conversationId, workId: work.id, expectedRevision: work.revision, action: 'close' }))}>{t('superagent.close')}</button>}
    </div>}
  </article>
}
