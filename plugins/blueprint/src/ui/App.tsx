import { t } from './i18n'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { PluginApi, PluginContext } from '@janusx/plugin-sdk'
import type { Blueprint } from '../shared/janus/types'
import type { BlueprintReviewView, BlueprintReviewActivityUpdate } from '../shared/ipc/blueprint-review'
import type { BlueprintReviewSettings } from '../shared/blueprint-review-settings'
import type { NoteRepairInput, NoteRepairPlan, NoteRepairUpdate, NoteRepairDiff } from '../shared/note-repair'
import type { HarnessWorkspaceStatus, HarnessInitPreview } from '../shared/workspace'
import { Graph } from './Graph'
import { Markdown } from './Markdown'
import { Settings, type Models } from './Settings'
import { Maintenance } from './Maintenance'
import { BlueprintAttention } from './BlueprintAttention'
import { NoteReader } from './NoteReader'
import type { ReaderVisit } from './NoteReviewPanel'
import type { NoteSource } from './note-body'
import type { NoteReadResult, NoteVersion } from '../shared/blueprint-attention'
import { attentionNode, rowDestination, type AttentionRow, type AttentionMode } from './graph/attention-model'
import { call, job, plugin } from './client'
import { loadGraph } from './load-graph'
import { blueprintText as bt } from './blueprint-text'
import { Select } from './Select'
import { cardIndexStyle, useAnimatedOpen, useReducedMotion, useWorkbenchPhase } from './CardFrame'
import { WorkbenchLoading } from './WorkbenchLoading'
import './note-wiki.css'
import './workbench-surface.css'
import { JanusIdentityCore } from './JanusIdentityCore'
import { ToolbarMore } from './ToolbarMore'
import { LegacyImport } from './LegacyImport'
import { WorkbenchPopover } from './WorkbenchPopover'
import { ChevronRight, FileText, RefreshCw, SettingsIcon } from './WorkbenchIcons'
import { blueprintStatusOptions } from './blueprintStatus'
import { blueprintStatusFilter } from '../shared/blueprint-note-status'
import { projectArchitecture } from './graph/architecture-view'
import { navigateNote, pushNavigation, rememberViewport, type NavigationHistory } from './graph/navigation-history'

const phase: Record<string, string> = {
  resolved: '已修复并验证',
  unresolved: '仍有待处理问题',
  discussed: '讨论完成',
  failed: '处理失败',
  cancelled: '已停止',
  'review-incomplete': '已修改，复审未完成',
  reverted: '已撤销',
  unchanged: '未修改文件',
  reading: '正在读取',
  editing: '正在修复',
  reviewing: '正在复审',
}

export function App({ context, transitioning = false }: { context: PluginContext; transitioning?: boolean }) {
  const scopeKey = context.project?.rootId ?? 'application'
  const [revealReady, setRevealReady] = useState(false)
  const [frameContext, setFrameContext] = useState<Awaited<ReturnType<PluginApi['views']['getFrame']>>>()
  useEffect(() => {
    const frame = requestAnimationFrame(() => setRevealReady(true))
    return () => cancelAnimationFrame(frame)
  }, [])
  useEffect(() => {
    let disposed = false
    if (context.workbenchFrame && !transitioning) void plugin().views.getFrame().then(frame => { if (!disposed) setFrameContext(frame) }).catch(error => { if (!disposed) setError(String(error)) })
    return () => { disposed = true }
  }, [context.workbenchFrame, scopeKey, transitioning])
  const [detailOpen, setDetailOpen] = useState(true)
  const [readerVisit, setReaderVisit] = useState<{ nodeId: string; visit: ReaderVisit }>()
  const fitRef = useRef<(() => void) | null>(null)
  const [status, setStatus] = useState<HarnessWorkspaceStatus>(),
    [blueprint, setBlueprint] = useState<Blueprint>(),
    [review, setReview] = useState<BlueprintReviewView>()
  const [models, setModels] = useState<Models>([]),
    [model, setModel] = useState({ providerId: '', modelId: '' })
  const [selection, setSelection] = useState<NavigationHistory>({ entries: [], index: -1 }),
    [source, setSource] = useState<NoteSource>()
  const [query, setQuery] = useState(''),
    [kind, setKind] = useState(''),
    [discussion, setDiscussion] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [undoLayout, setUndoLayout] = useState<Blueprint['canvasLayout']>()
  const [busy, setBusy] = useState(''),
    [error, setError] = useState('')
  const [init, setInit] = useState<HarnessInitPreview>(),
    [initDone, setInitDone] = useState(false),
    [confirmForeign, setConfirmForeign] = useState(false)
  const [repair, setRepair] = useState<{ plan: NoteRepairPlan; update?: NoteRepairUpdate; text?: string; diff?: NoteRepairDiff }>()
  const [readUndo, setReadUndo] = useState<{ token: string; expiresAt: number }>(),
    [refreshVersion, setRefreshVersion] = useState(0)
  const rememberReading = (result: { undoToken?: string; expiresAt?: number }) => {
    setReadUndo(result.undoToken && result.expiresAt ? { token: result.undoToken, expiresAt: result.expiresAt } : undefined)
  }
  useEffect(() => {
    if (!readUndo) return
    const timer = setTimeout(() => setReadUndo(undefined), Math.max(0, readUndo.expiresAt - Date.now()))
    return () => clearTimeout(timer)
  }, [readUndo])
  const generation = useRef(0),
    controller = useRef<AbortController>(),
    mounted = useRef(true)
  const scopeGeneration = useRef(0)
  const readController = useRef<AbortController>()
  const reloadInFlight = useRef(false)
  const reloadAgain = useRef(false)
  const janusAnim = useAnimatedOpen(discussion)
  const reducedMotion = useReducedMotion()
  const cardCount = 2 + Number(detailOpen) + Number(discussion)
  const closeFrame = useCallback(() => { void plugin().views.requestFrame({ action: 'close' }).catch(error => setError(String(error))) }, [])
  const { isClosing, requestClose } = useWorkbenchPhase(true, { exitMs: reducedMotion ? 0 : 260 + (cardCount - 1) * 60 + 60, onClose: closeFrame })
  const discussionOpened = useRef(false)
  if (discussion) discussionOpened.current = true
  useLayoutEffect(() => {
    scopeGeneration.current++
    generation.current++
    controller.current?.abort(); controller.current = undefined
    readController.current?.abort(); readController.current = undefined
    reloadInFlight.current = false; reloadAgain.current = false
    setStatus(undefined); setBlueprint(undefined); setReview(undefined); setSource(undefined)
    setSelection({ entries: [], index: -1 }); setReaderVisit(undefined)
    setRepair(undefined); setInit(undefined); setInitDone(false); setConfirmForeign(false); setReadUndo(undefined); setUndoLayout(undefined)
    setQuery(''); setKind(''); setStatusFilter(''); setDiscussion(false); discussionOpened.current = false
    setBusy(''); setError('')
  }, [scopeKey, transitioning])
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('[popover]:popover-open, [data-select-dropdown]')) return
      event.preventDefault()
      if (discussion) setDiscussion(false)
      else if (context.workbenchFrame) requestClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [discussion, context.workbenchFrame, requestClose])
  const navigation = selection.entries[selection.index] ?? { nodeId: null, scopeId: null }
  const selected = navigation.nodeId,
    node = selected ? blueprint?.nodes[selected] : undefined
  const navigate = useCallback(
    (id: string) =>
      blueprint && setSelection(previous => navigateNote(previous, blueprint, id)),
    [blueprint],
  )
  const refresh = useCallback(() => setRefreshVersion((value) => value + 1), [])
  const reload = useCallback(async (signal: AbortSignal) => {
    if (!context.project || transitioning) return
    const version = ++generation.current
    const nextStatus = await call<HarnessWorkspaceStatus>('workspace.status', null, signal)
    if (!mounted.current || version !== generation.current) return
    setStatus(nextStatus)
    if (nextStatus.state !== 'ok') {
      setBlueprint(undefined)
      setReview(undefined)
      setError('')
      return
    }
    await call('workspace.activate', null, signal)
    const [graph, review] = await Promise.all([loadGraph(signal), call<BlueprintReviewView>('review.read', null, signal)])
    if (!mounted.current || version !== generation.current) return
    setBlueprint(graph.blueprint)
    setError('')
    setReview(review)
    setSelection((previous) =>
      previous.index >= 0 && graph.blueprint.nodes[previous.entries[previous.index].nodeId ?? '']
        ? previous
        : {
            entries: graph.blueprint.nodeIds.length ? navigateNote({ entries: [], index: -1 }, graph.blueprint,
              graph.blueprint.nodeIds.find(id => graph.blueprint.nodes[id].note?.metadata?.role === 'project') ?? graph.blueprint.rootNodeId ?? graph.blueprint.nodeIds[0]).entries : [],
            index: graph.blueprint.nodeIds.length ? 0 : -1,
          },
    )
  }, [scopeKey, transitioning])
  useEffect(() => {
    if (transitioning) return
    mounted.current = true
    let timer: ReturnType<typeof setTimeout>,
      stop: (() => void) | undefined,
      disposed = false
    void plugin()
      .native.watch((event) => {
        if (disposed) return
        if (event.name === 'notes.changed' || event.name === 'review.results' || event.name === 'reading.changed') {
          clearTimeout(timer)
          timer = setTimeout(refresh, 180)
        }
        if (event.name === 'repair.changed')
          setRepair((current) =>
            current?.plan.id === (event.value as unknown as NoteRepairUpdate).id
              ? { ...current, update: event.value as unknown as NoteRepairUpdate }
              : current,
          )
        if (event.name === 'review.activity') {
          const activity = event.value as unknown as BlueprintReviewActivityUpdate
          setReview((current) =>
            current && activity.revision >= (current.activityRevision ?? 0)
              ? { ...current, activities: activity.activities, automatic: activity.automatic, activityRevision: activity.revision }
              : current,
          )
        }
      })
      .then((unsubscribe) => {
        if (disposed) unsubscribe()
        else stop = unsubscribe
      })
      .catch((error) => { if (!disposed) setError(String(error)) })
    void Promise.all([call<Models>('models.catalog'), call<BlueprintReviewSettings>('settings.read')])
      .then(([models, settings]) => {
        if (!disposed) {
          setModels(models)
          setModel(settings.generation)
        }
      })
      .catch((error) => {
        if (!disposed) setError(String(error))
      })
    return () => {
      disposed = true
      mounted.current = false
      generation.current++
      stop?.()
      clearTimeout(timer)
      controller.current?.abort()
      readController.current?.abort()
    }
  }, [scopeKey, transitioning])
  useEffect(() => {
    // Coalesce watcher and review notifications while a snapshot is being
    // transferred. Cancelling/restarting every notification can starve large
    // graphs and fill the page's request queue with abandoned reads.
    if (reloadInFlight.current) { reloadAgain.current = true; return }
    const abort = new AbortController()
    readController.current = abort
    reloadInFlight.current = true
    void reload(abort.signal).catch((error) => {
      if (mounted.current && !abort.signal.aborted) setError(String(error))
    }).finally(() => {
      if (readController.current !== abort) return
      reloadInFlight.current = false
      if (mounted.current && reloadAgain.current) { reloadAgain.current = false; refresh() }
    })
  }, [reload, refreshVersion, refresh])
  useEffect(() => {
    const abort = new AbortController()
    setSource(current => current?.note.meta.id === node?.note?.id ? current : undefined)
    if (node?.sourceUri)
      void call<NoteSource>('notes.read', node.sourceUri, abort.signal)
        .then(source => { if (!abort.signal.aborted) setSource(source) })
        .catch((error) => {
          if (!abort.signal.aborted) setError(String(error))
        })
    return () => abort.abort()
  }, [node?.sourceUri, node?.sourceHash, refreshVersion, scopeKey, transitioning])
  const action = async (label: string, work: (signal: AbortSignal) => Promise<void>) => {
    if (controller.current) return
    const abort = new AbortController()
    controller.current = abort
    setBusy(label)
    setError('')
    try {
      await work(abort.signal)
    } catch (error) {
      if (mounted.current && !abort.signal.aborted) setError(String(error))
    } finally {
      if (mounted.current && controller.current === abort) {
        controller.current = undefined
        setBusy('')
      }
    }
  }
  const startRepair = (input: NoteRepairInput) =>
    void action(input.intent === 'repair' ? t('正在修复 Note') : t('正在讨论问题'), async (signal) => {
      if (!model.providerId || !model.modelId) throw new Error(t('请先在蓝图设置中选择模型'))
      const plan = await call<NoteRepairPlan>('repair.prepare', input, signal)
      setRepair({ plan })
      const result = await job<{ text: string; update: NoteRepairUpdate }>(
        'repair.run',
        {
          ...model,
          id: plan.id,
          conversationId: crypto.randomUUID(),
          messages: [
            {
              role: 'user',
              content:
                input.intent === 'repair' ? t('修复所选问题，保留身份、原有要求和无关内容。') : t('解释所选问题及可选方案，不修改文件。'),
            },
          ],
        },
        signal,
      )
      setRepair({ plan, ...result })
      refresh()
    })
  const suggestionCounts = useMemo(() => {
    const counts = new Map(review?.items.map(item => [item.noteId, item.report?.findings.length ?? 0]))
    return Object.fromEntries((blueprint?.nodeIds ?? []).map(id => [id, counts.get(blueprint!.nodes[id].note?.id ?? blueprint!.nodes[id].sourceUri?.split('/').at(-1) ?? '') ?? 0]))
  }, [blueprint, review?.items])
  const nodes = (blueprint?.nodeIds ?? [])
    .map((id) => blueprint!.nodes[id])
    .filter(
      (node) =>
        node &&
        (!kind || node.kind === kind) &&
        (!statusFilter || blueprintStatusFilter(node) === statusFilter) &&
        (!query || `${node.title} ${node.sourceUri ?? ''}`.toLowerCase().includes(query.toLowerCase())),
    )
  const saveLayout = (patch: { canvasLayout?: Blueprint['canvasLayout']; collapsedNodeIds?: string[] | null }) => {
    if (!blueprint) return
    const version = scopeGeneration.current
    setBlueprint({ ...blueprint, ...patch })
    void call('blueprint.layout', patch).catch((error) => {
      if (!mounted.current || scopeGeneration.current !== version) return
      setError(String(error))
      refresh()
    })
  }
  const acceptRead = (result: NoteReadResult) => {
    rememberReading(result)
    setReview(current => current && current.context.repoId === result.context.repoId && current.context.branch === result.context.branch ? { ...current, updates: result.updates } : current)
    refresh()
  }
  const markVersions = async (versions: NoteVersion[], bulk: boolean) => {
    if (!review) return
    acceptRead(await call<NoteReadResult>('reading.mark', { context: review.context, versions, bulk }))
  }
  const undoReading = async () => {
    if (!readUndo) return
    acceptRead(await call<NoteReadResult>('reading.undo', readUndo.token))
    setReadUndo(undefined)
  }
  const openFile = async (path: string, expectedVersion?: string) => {
    const hash = expectedVersion ?? blueprint?.noteSnapshot?.entries.find(entry => entry.relPath === path)?.sourceHash ?? review?.structure?.issues.find(issue => issue.path === path)?.hash
    if (!hash) throw new Error(bt('reader.sourceUnavailable'))
    await plugin().workspace.openDocument({ path, expectedVersion: hash })
  }
  const visitAttention = (row: AttentionRow, mode: AttentionMode, findingId?: string) => {
    if (!blueprint) return
    const id = attentionNode(blueprint, row.root, row.noteId)
    if (!id) return
    navigate(id); setDetailOpen(true); setQuery(''); setKind(''); setStatusFilter('')
    setReaderVisit(previous => ({ nodeId: id, visit: { ...rowDestination(row, mode), ...(findingId ? { intent: 'finding', findingId } : {}), sequence: (previous?.visit.sequence ?? 0) + 1 } }))
  }
  const reviewActivity = review?.activities.find(activity => activity.trigger !== 'automatic') ?? review?.activities[0]
  const automaticEnabled = review?.automatic && review.automatic.phase !== 'disabled'
  const reviewRunning = Boolean(reviewActivity || ['checking', 'reviewing'].includes(review?.automatic?.phase ?? ''))
  const headerActions = <div className="blueprint-workbench-actions">
    <BlueprintAttention key={scopeKey} blueprint={blueprint} review={review} busy={Boolean(busy) || transitioning} select={visitAttention} repair={startRepair}
      refresh={async () => { await call('notes.rescan'); refresh() }} mark={versions => markVersions(versions, true)}
      undoRead={readUndo ? undoReading : undefined} openFile={openFile}
      activityTrigger={review?.automatic && (review.automatic.phase !== 'disabled' || review.activities.length > 0 || review.automatic.lastRun) ? <><FileText /><span className="bp-review-heading"><span className="bp-review-title">{bt(reviewActivity?.trigger !== 'automatic' && reviewActivity ? 'review.activity.manual' : reviewRunning ? 'review.activity.running' : automaticEnabled ? 'review.activity.enabled' : 'review.activity.results')}</span><span className="bp-review-meta">{automaticEnabled ? bt('review.activity.commits', { count: review.automatic.commits, threshold: review.automatic.threshold }) : ''}</span></span>{reviewRunning && <span className="bp-review-track" aria-hidden="true"><span /></span>}</> : undefined} />
                <button className="blueprint-janus-capsule" disabled={!blueprint} onClick={() => setDiscussion(value => !value)} aria-expanded={discussion} aria-label={bt('workbench.copilotName')}>
                  <JanusIdentityCore identity="main" size="pod" showHalo={false} showScanline={false} className="blueprint-janus-capsule__identity" aria-label="Janus" />
                  <span className="blueprint-janus-capsule__name">{bt('workbench.copilotName')}</span>
                  <span className="blueprint-janus-capsule__status">{bt('workbench.statusIdle')}</span>
                  <ChevronRight className="blueprint-janus-capsule__chevron" size={13} />
                </button>
  </div>
  const diagnosticsControl = status?.diagnostics.length ? <WorkbenchPopover label={`${t('来源诊断 ·')} ${status.diagnostics.length}`} triggerContent={`${bt('detailPanel.source')} ${status.diagnostics.length}`}>
    {status.diagnostics.map((issue, index) => <p key={index} className="bp-note-diagnostic">{issue.path} · {issue.message}</p>)}
  </WorkbenchPopover> : null
  if (!context.project) return <main className="blueprint-plugin settings-only"><div className="settings-surface"><Settings models={models} saved={() => {}} /></div></main>
  return (
    <main className="blueprint-plugin blueprint-workbench-shell" data-reveal-ready={revealReady ? 'true' : undefined}
      data-closing={isClosing ? 'true' : undefined} data-card-count={cardCount}
      style={{ '--card-count': cardCount, '--card-enter-stagger': '180ms', '--card-enter-duration': '260ms', '--card-exit-stagger': '60ms' } as CSSProperties}>
      <header className="blueprint-workbench-topbar" style={cardIndexStyle(0)}>
        <div className="blueprint-workbench-switch" onFocusCapture={() => {
          const version = scopeGeneration.current
          if (context.workbenchFrame && !transitioning) void plugin().views.getFrame()
            .then(frame => { if (scopeGeneration.current === version) setFrameContext(frame) })
            .catch(error => { if (scopeGeneration.current === version) setError(String(error)) })
        }}>
          <Select className="blueprint-select blueprint-workbench-switch__select" ariaLabel={t('切换项目')}
            value={context.project.projectId} options={frameContext?.projects.length ? frameContext.projects.map(project => ({ value: project.id, label: project.name })) : [{ value: context.project.projectId, label: context.project.name }]}
            disabled={!context.workbenchFrame || isClosing || transitioning}
            onChange={projectId => { void plugin().views.requestFrame({ action: 'selectProject', projectId }).catch(error => setError(String(error))) }} />
          {frameContext?.worktrees?.length ? <Select className="blueprint-select blueprint-workbench-switch__select" ariaLabel={t('切换工作树')}
            value={frameContext.worktreeId ?? ''} options={frameContext.worktrees.map(worktree => ({ value: worktree.id,
              label: `${worktree.branch ?? t('分离 HEAD')} · ${worktree.name}${worktree.isMain ? ` · ${t('主工作树')}` : ''}` }))}
            disabled={isClosing || transitioning || frameContext.worktrees.length < 2}
            onChange={worktreeId => { void plugin().views.requestFrame({ action: 'selectWorktree', worktreeId }).catch(error => setError(String(error))) }} /> : null}
        </div>
        {headerActions}
        {context.workbenchFrame && <button type="button" className="blueprint-workbench-close" onClick={requestClose}
          aria-label={bt('workbench.closeAria')} title={bt('workbench.closeTitle')} />}
      </header>
      {error && (
        <div className="error" role="alert">
          {error}
          {diagnosticsControl}
          <button
            onClick={() => {
              setError('')
              refresh()
            }}
          >
            {t('重试')}
          </button>
        </div>
      )}
      {busy && (
        <div className="progress" role="status">
          {busy}
          <button onClick={() => controller.current?.abort()}>{t('停止')}</button>
        </div>
      )}
      {context.project && (
        <div className="workspace-page" key={scopeKey} data-worktree-scope={scopeKey}>
          {!blueprint && (!status || status.state === 'ok' || transitioning) && !error && <WorkbenchLoading detailOpen={detailOpen} diagnostics={diagnosticsControl} />}
          {!transitioning && status && status.state !== 'ok' && (
            <section className="empty blueprint-workbench-card blueprint-workspace-empty" style={cardIndexStyle(1)}>
              <h1>{t(['not-found', 'foreign', 'empty'].includes(status.state) ? '未检测到蓝图 Note' : '暂时无法读取蓝图 Note')}</h1>
              {diagnosticsControl}
              <p>{t(['not-found', 'foreign', 'empty'].includes(status.state) ? '当前工作区或工作树中未检测到蓝图 Note。可以切换到其他工作区或工作树。' : '请查看来源诊断，修复文档或访问问题后重试。')}</p>
              {['not-found', 'foreign'].includes(status.state) && <>
              <p>{t('初始化会创建项目身份和根模块。已有文件保留，确认前可以查看完整内容。')}</p>
              <button
                disabled={Boolean(busy)}
                onClick={() =>
                  void action(t('准备初始化'), async (signal) => {
                    setInit(await call('workspace.init-preview', context.project!.name, signal))
                    setInitDone(false)
                  })
                }
              >
                {t('预览初始化')}
              </button>
              </>}
            </section>
          )}
          {init && (
            <section className="init-preview">
              <h2>{initDone ? t('初始化已完成') : t('确认初始化文件')}</h2>
              {init.files.map((file) => (
                <details key={file.path}>
                  <summary>{file.path}</summary>
                  <pre>{file.content}</pre>
                </details>
              ))}
              {init.foreign && !initDone && (
                <label>
                  <input type="checkbox" checked={confirmForeign} onChange={(event) => setConfirmForeign(event.target.checked)} />
                  {t('确认保留现有 .agents 文件并接入 Notes')}
                </label>
              )}
              <button
                disabled={Boolean(busy) || (!initDone && init.foreign && !confirmForeign)}
                onClick={() =>
                  void action(initDone ? t('撤销初始化') : t('初始化'), async (signal) => {
                    if (initDone) {
                      await call('workspace.init-undo', init.id, signal)
                      setInit(undefined)
                    } else {
                      await call('workspace.init-apply', { id: init.id, confirmForeign }, signal)
                      setInitDone(true)
                    }
                    refresh()
                  })
                }
              >
                {initDone ? t('撤销本次初始化') : t('确认创建')}
              </button>
              <button onClick={() => setInit(undefined)}>{t('收起')}</button>
            </section>
          )}
          {blueprint && (
            <>
              <div className="blueprint-workbench-toolbar">
                <input className="blueprint-search"
                  aria-label={t('搜索 Note')}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('搜索 Note…')}
                />
                <Select ariaLabel={bt('detailPanel.status')} value={statusFilter} onChange={setStatusFilter}
                  className="blueprint-select blueprint-select--status-filter"
                  options={[{ value: '', label: bt('search.statusAll') }, ...blueprintStatusOptions(Object.values(blueprint.nodes), bt)]} />
                <Select ariaLabel={t('文档类型')} value={kind} onChange={setKind}
                  className="blueprint-select blueprint-select--kind-filter"
                  options={[{ value: '', label: t('所有类型') }, ...[...new Set(blueprint.nodeIds.map(id => blueprint.nodes[id]?.kind).filter((value): value is string => Boolean(value)))].map(value => ({ value, label: bt('noteKind.' + value) }))]} />
                <button className="blueprint-btn" onClick={() => fitRef.current?.()}>{bt('action.fitCanvas')}</button>
                <button className="blueprint-btn" onClick={() => setDetailOpen(value => !value)} aria-pressed={detailOpen}>{bt('action.nodeDetail')}</button>
                <div className="blueprint-toolbar__spacer" />
                {diagnosticsControl}

                <LegacyImport changed={refresh} />
                <ToolbarMore>
                  <button className="blueprint-btn" disabled={selection.index <= 0} onClick={() => setSelection(value => ({ ...value, index: value.index - 1 }))}>{t('← 返回')}</button>
                  <button className="blueprint-btn" disabled={selection.index >= selection.entries.length - 1} onClick={() => setSelection(value => ({ ...value, index: value.index + 1 }))}>{t('前进 →')}</button>
                <button className="blueprint-btn blueprint-workbench-icon" aria-label={t('设置')} title={t('设置')} onClick={() => void plugin().views.open({ view: 'settings' }).catch(error => setError(String(error)))}><SettingsIcon /></button>
                <button className="blueprint-btn blueprint-workbench-icon" aria-label={bt('action.refresh')} title={bt('action.refresh')} disabled={Boolean(busy)} onClick={refresh}><RefreshCw /></button>
                  <button className="blueprint-btn" disabled={Object.keys(projectArchitecture(blueprint).roles).length > 0}
                    onClick={() => { setUndoLayout(blueprint.canvasLayout); saveLayout({ canvasLayout: {} }) }}>{bt('action.restoreDefaultLayout')}</button>
                  {undoLayout && <button className="blueprint-btn" onClick={() => { saveLayout({ canvasLayout: undoLayout }); setUndoLayout(undefined) }}>{bt('action.undoRestore')}</button>}
                </ToolbarMore>


              </div>
              <div className="blueprint-workbench-body" data-detail-open={detailOpen ? 'true' : 'false'} data-janus-open={discussion ? 'true' : 'false'}>
                <div className="blueprint-workbench-detail-slot" data-open={detailOpen ? 'true' : 'false'} style={cardIndexStyle(1)}>{node && <NoteReader key={node.id} blueprint={blueprint} node={node} visible={detailOpen} source={source} review={review} busy={Boolean(busy)} visit={readerVisit?.nodeId === node.id ? readerVisit.visit : undefined}
                  select={(id, anchor) => {
                    navigate(id)
                    setReaderVisit(previous => ({ nodeId: id, visit: { intent: 'body', anchor, sequence: (previous?.visit.sequence ?? 0) + 1 } }))
                  }} close={() => setDetailOpen(false)} read={version => markVersions([version], false)} repair={startRepair}
                  runReview={async () => { await job('review.run', node.note!.id, new AbortController().signal); refresh() }}
                  cancelReview={async () => { await call('review.cancel', node.note!.id) }}
                  closeFindings={async findingIds => {
                    const item = review?.items.find(item => item.noteId === node.note?.id)
                    if (item && review) await call('review.close', { context: review.context, noteId: item.noteId, revision: item.reportRevision, findingIds })
                    refresh()
                  }} refresh={refresh} openFile={openFile}>
                  {repair && (
                    <section className="repair-result">
                      <h3>
                        {t(phase[repair.update?.phase ?? 'reading'] ?? repair.update?.phase ?? '')}· {repair.plan.title}
                      </h3>
                      {repair.text && <Markdown text={repair.text} />}
                      <p role="status">{repair.update?.error}</p>
                      {repair.update?.changed && (
                        <button
                          disabled={Boolean(busy)}
                          onClick={() =>
                            void action(t('读取差异'), async (signal) =>
                              setRepair({ ...repair, diff: await call('repair.diff', repair.plan.id, signal) }),
                            )
                          }
                        >
                          {t('查看修改')}
                        </button>
                      )}
                      {repair.diff && (
                        <details open>
                          <summary>{repair.diff.path}</summary>
                          <h4>{t('修改前')}</h4>
                          <pre>{repair.diff.before}</pre>
                          <h4>{t('修改后')}</h4>
                          <pre>{repair.diff.after}</pre>
                          <button
                            disabled={Boolean(busy) || repair.diff.reverted}
                            onClick={() =>
                              void action(t('撤销修复'), async (signal) => {
                                const update = await job<NoteRepairUpdate>('repair.undo', repair.plan.id, signal)
                                setRepair({ ...repair, update, diff: { ...repair.diff!, reverted: true } })
                                refresh()
                              })
                            }
                          >
                            {t('确认撤销修复')}
                          </button>
                        </details>
                      )}
                      {repair.update?.phase === 'review-incomplete' && (
                        <button
                          disabled={Boolean(busy)}
                          onClick={() =>
                            void action(t('重试复审'), async (signal) => {
                              setRepair({ ...repair, update: await job('repair.retry', repair.plan.id, signal) })
                              refresh()
                            })
                          }
                        >
                          {t('仅重试审核')}
                        </button>
                      )}
                    </section>
                  )}
                </NoteReader>}</div>
                <section className="canvas blueprint-workbench-card blueprint-workbench-card--canvas blueprint-view blueprint-view--workbench" style={cardIndexStyle(detailOpen ? 2 : 1)} aria-label={t('蓝图画布')}>
                  <Graph
                    blueprint={blueprint}
                    navigation={navigation}
                    navigationKey={selection.index}
                    select={id => {
                      navigate(id); setDetailOpen(true)
                      setReaderVisit(previous => ({ nodeId: id, visit: { intent: 'body', sequence: (previous?.visit.sequence ?? 0) + 1 } }))
                    }}
                    save={saveLayout}
                    enter={(scopeId, nodeId) => {
                      setSelection(previous => pushNavigation(previous, { scopeId, nodeId }))
                      if (nodeId) {
                        setDetailOpen(true)
                        setReaderVisit(previous => ({ nodeId, visit: { intent: 'body', sequence: (previous?.visit.sequence ?? 0) + 1 } }))
                      }
                    }}
                    remember={viewport => setSelection(previous => rememberViewport(previous, viewport))}
                    suggestions={suggestionCounts}
                    openSuggestions={id => { navigate(id); setDetailOpen(true); setReaderVisit(previous => ({ nodeId: id, visit: { intent: 'suggestions', sequence: (previous?.visit.sequence ?? 0) + 1 } })) }}
                    query={query}
                    matches={nodes.map(node => node.id)}
                    canGoBack={selection.index > 0}
                    back={() => setSelection(value => ({ ...value, index: Math.max(0, value.index - 1) }))}
                    fitRef={fitRef}
                    reviews={Object.fromEntries(blueprint.nodeIds.map(id => {
                      const noteId = blueprint.nodes[id].note?.id
                      const item = review?.items.find(item => item.noteId === noteId)
                      return [id, { suggestions: suggestionCounts[id] ?? 0, awaitingReview: Boolean(item?.awaitingReview),
                        unread: review?.updates?.entries.some(entry => entry.noteId === noteId && entry.unread) }]
                    }))}
                  />
                </section>
                {discussionOpened.current && (
                  <div className="blueprint-workbench-janus-slot" hidden={!janusAnim.rendered} data-visible={janusAnim.visible ? 'true' : 'false'}><aside className="blueprint-workbench-card blueprint-workbench-card--janus" style={cardIndexStyle(detailOpen ? 3 : 2)}>
                  <Maintenance
                    visible={discussion}
                    models={models}
                    model={model}
                    setModel={setModel}
                    node={node}
                    nodes={blueprint.nodes}
                    refresh={refresh}
                    close={() => setDiscussion(false)}
                  /></aside></div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </main>
  )
}
