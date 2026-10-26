import { ModalCloseButton } from './ModalCloseButton'
import { memo, useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { useSessionStore, type AgentSessionDetail, type AgentSessionSummary } from '@/stores/session'
import { useWorkspaceStore } from '@/stores/workspace'
import { EMPTY_WORKTREE_LIST, useWorktreeStore } from '@/stores/worktree'
import { useI18n } from '@/i18n/useI18n'
import { ThemedTooltip } from '@/components/ui/ThemedTooltip'
import { buildContinueResumeArgs, buildProviderResumeCommand, canOfferSessionResume, isNativeResumeEngine, type TranscriptDetail } from '../../../shared/ipc/session'
import { TerminalPresetIcon } from './ui/TerminalPresetIcon'
import type { TerminalPreset } from '@/types'
import { mergeTranscriptTurns } from '@/lib/session-turn-merge'
import { EXTERNAL_SESSION_SYNC_MS, startExternalSessionSync } from '@/lib/external-session-sync'
import styles from './SessionPanel.module.css'

/** 会话 engine 与终端 preset 同名；未知 engine 落到 shell 字形（与旧 fallback 一致）。 */
function sessionEnginePreset(engine: string): TerminalPreset {
  return engine === 'claude' || engine === 'codex' || engine === 'opencode' || engine === 'janus' || engine === 'pi' || engine === 'dsh'
    ? engine
    : 'shell'
}

type Scope = 'workspace' | 'project' | 'all' | 'archived'

/** L2 first-prompt cap: longer prompts clamp to this many lines until expanded. */
const PROMPT_CLAMP_LINES = 4
/** Prompts above this budget get the expand-to-full affordance. */
const PROMPT_CLAMP_CHARS = 160
/** Mount one page, then append only when the reader scrolls near the bottom.
 * See .agents/notes/sessions/records/session-open-stall.md */
const CARD_CHUNK = 20
const CARD_LOAD_THRESHOLD_PX = 120

const SCOPE_KEYS = {
  workspace: 'terminal:agentSession.scopeWorkspace',
  project: 'terminal:agentSession.scopeProject',
  all: 'terminal:agentSession.scopeAll',
  archived: 'terminal:agentSession.scopeArchived',
} as const

function formatDate(iso: string, t: (k: string, opt?: Record<string, unknown>) => string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000)
  if (diffMin < 1) return t('terminal:time.justNow')
  if (diffMin < 60) return t('terminal:time.minutesAgo', { count: diffMin })
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return t('terminal:time.hoursAgo', { count: diffHour })
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// Note: 会话表面混色档位只服务详情窗（turn 卡）；右栏列表面板的
// 地走 --shell-canvas 令牌、卡/内卡走 A 方案高保真逐值，在 SessionPanel.module.css — 见
// .agents/notes/workbench/session-card-surface.md
//
// 为什么不能直接用 --shell-card / --shell-chrome：planche 的 --shell-void /
// --shell-canvas / --shell-pane / --shell-chrome / --shell-card 全是 #EFE4C5，纸面里
// 没有更深的台阶，拿它们当卡片底色等于和底色同值；写死 rgba(0,0,0,.28) / rgba(255,255,255,.03)
// 落在纸面上分别是冷灰油渍和几乎透明的亮斑，两个主题都只能各对一半。朝文字色混出
// 两档在两主题都能拉出可见台阶：planche 得到偏暖的深纸色，dark 得到
// 逐级浮起的卡片。板面之间的分界交给发丝线，不靠更深的底色。
const SURFACE_CARD = 'color-mix(in srgb, var(--shell-chrome) 94%, var(--shell-text))'
const SURFACE_INSET = 'color-mix(in srgb, var(--shell-chrome) 90%, var(--shell-text))'
const CARD_BORDER = '1px solid var(--shell-border)'
const CARD_BORDER_SOFT = '1px solid var(--shell-border-soft)'

// Note: transcript-only session reading and native continuation — see
// .agents/notes/sessions/records/module.md

/** Provider resume command; null when the record has no native identity. */
function buildResumeCommand(session: AgentSessionSummary): string | null {
  return buildProviderResumeCommand(session.engine, session.providerSessionId, session.transcriptPath)
}

function CopyButton({ text, label, grow }: { text: string; label?: string; grow?: boolean }) {
  const { t } = useI18n('terminal')
  const [copied, setCopied] = useState(false)
  const timer = useMemo(() => ({ id: null as ReturnType<typeof setTimeout> | null }), [])
  useEffect(() => () => {
    if (timer.id) clearTimeout(timer.id)
  }, [timer])
  return (
    <button
      onClick={(event) => {
        event.stopPropagation()
        void navigator.clipboard?.writeText(text).catch(() => undefined).then(() => {
          setCopied(true)
          if (timer.id) clearTimeout(timer.id)
          timer.id = setTimeout(() => setCopied(false), 1200)
        })
      }}
      className={`rounded cursor-pointer ${styles.cardAction}`}
      style={{ height: grow ? 24 : 20, padding: '0 8px', fontSize: grow ? 10.5 : 10, border: '1px solid var(--shell-border)', background: 'transparent', color: 'var(--shell-muted)', fontFamily: "'SF Mono', monospace", flexShrink: 0, flex: grow ? 1 : undefined }}
    >
      {copied ? t('terminal:agentSession.copied') : (label ?? t('terminal:agentSession.copy'))}
    </button>
  )
}

export function SessionPanel({ active = true }: { active?: boolean }) {
  const { t } = useI18n('terminal')
  const sessions = useSessionStore((s) => s.sessions)
  const loading = useSessionStore((s) => s.loading)
  const error = useSessionStore((s) => s.error)
  const scopeKey = useSessionStore((s) => s.scopeKey)
  const fetchSessions = useSessionStore((s) => s.fetchSessions)
  const continueSession = useSessionStore((s) => s.continueSession)
  const subscribeToEvents = useSessionStore((s) => s.subscribeToEvents)
  const clearWorkspaceScope = useSessionStore((s) => s.clearWorkspaceScope)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId)
  // AC-10: card scope follows the active worktree path, not the workspace root.
  const worktrees = useWorktreeStore((s) => (activeWorkspaceId ? (s.worktreesByWorkspace[activeWorkspaceId] ?? EMPTY_WORKTREE_LIST) : EMPTY_WORKTREE_LIST))
  const activeWorktreePath = useWorktreeStore((s) => (activeWorkspaceId ? (s.activePaths[activeWorkspaceId] ?? null) : null))
  const scopePath = activeWorktreePath ?? activeWorkspace?.path ?? null
  const activeWorktree = worktrees.find((w) => w.path === scopePath) ?? null
  const setUiForPath = useWorktreeStore((s) => s.setUiForPath)
  // Single card expansion subscribes to uiByPath so toggles re-render.
  const expandedId = useWorktreeStore((s) =>
    scopePath ? (s.uiByPath[scopePath]?.expandedSessionId ?? null) : null,
  )
  const [scope, setScope] = useState<Scope>('workspace')
  const [continueTarget, setContinueTarget] = useState<AgentSessionSummary | null>(null)
  const [continuing, setContinuing] = useState(false)
  const [sourceError, setSourceError] = useState('')
  // Hooks can bind identity after the dialog opens. Explain the live record,
  // rather than keeping a stale no-id snapshot while main will resume it.
  const continueSource = continueTarget
    ? sessions.find((session) => session.id === continueTarget.id) ?? continueTarget : null
  const [detailTarget, setDetailTarget] = useState<AgentSessionSummary | null>(null)
  const [query, setQuery] = useState('')
  const [allCounts, setAllCounts] = useState<{ all: number; archived: number } | null>(null)
  // Note: open-card live refresh follows the same session:event — debounced
  // so session update bursts reload the timeline once — see
  // .agents/notes/sessions/records/session-timeline-v5.md
  const [timelineTick, setTimelineTick] = useState(0)

  useEffect(() => {
    if (!active) return
    setContinueTarget(null)
    if (scope !== 'all' && scope !== 'archived' && !activeWorkspaceId && !scopePath) {
      clearWorkspaceScope()
      return
    }
    // Project scope follows the workspace until the project model lands (P2).
    const filter = scope === 'all' ? {} : scope === 'archived' ? { includeArchived: true }
      : scopePath ? { cwd: scopePath } : { workspaceId: activeWorkspaceId ?? undefined }
    void fetchSessions(filter, { silent: true, maxAgeMs: EXTERNAL_SESSION_SYNC_MS })
    // Catch events missed while inactive even when this activation used cache.
    // Cancel on the next switch, so quick visits do not queue extra IPC reads.
    const timer = setTimeout(() => {
      void fetchSessions(filter, { silent: true, maxAgeMs: EXTERNAL_SESSION_SYNC_MS })
    }, EXTERNAL_SESSION_SYNC_MS)
    return () => clearTimeout(timer)
  }, [active, fetchSessions, clearWorkspaceScope, activeWorkspaceId, scopePath, scope])

  const activeRef = useRef(active)
  useEffect(() => { activeRef.current = active }, [active])
  useEffect(() => startExternalSessionSync(
    async () => {
      try {
        const scan = await window.electron.session.scanExternal()
        setSourceError(scan.remote?.errors.join('\n') ?? '')
      } catch (error) { setSourceError(String(error)) }
    }, window, () => activeRef.current,
  ), [])

  const handleToggle = useCallback((sessionId: string) => {
    if (!scopePath) return
    const current = useWorktreeStore.getState().uiByPath[scopePath]?.expandedSessionId ?? null
    setUiForPath(scopePath, { expandedSessionId: current === sessionId ? null : sessionId })
  }, [scopePath, setUiForPath])

  useEffect(() => active ? subscribeToEvents() : undefined, [active, subscribeToEvents])

  useEffect(() => {
    if (!active) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = window.electron.session.onEvent(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setTimelineTick((tick) => tick + 1), 600)
    })
    return () => {
      if (timer) clearTimeout(timer)
      unsubscribe()
    }
  }, [active])

  const visible = useMemo(() => {
    const scoped = scope === 'archived' ? sessions.filter((s) => s.archived) : sessions.filter((s) => !s.archived)
    const q = query.trim().toLowerCase()
    if (!q) return scoped
    return scoped.filter((s) =>
      (s.firstPrompt ?? '').toLowerCase().includes(q)
      || s.engine.toLowerCase().includes(q)
      || s.cwd.toLowerCase().includes(q)
      || (s.branch ?? '').toLowerCase().includes(q),
    )
  }, [sessions, scope, query])

  // Search still covers every summary, but only one page mounts initially.
  // Background refreshes retain the reader's loaded pages and scroll position.
  // See .agents/notes/sessions/records/session-open-stall.md
  const listRef = useRef<HTMLDivElement>(null)
  const [shownCount, setShownCount] = useState(CARD_CHUNK)
  useEffect(() => {
    setShownCount(CARD_CHUNK)
    if (listRef.current) listRef.current.scrollTop = 0
  }, [scopeKey, scopePath, scope, query])
  const shown = useMemo(() => visible.slice(0, shownCount), [visible, shownCount])

  // An empty scope tab is ambiguous with no data at all: one unfiltered fetch
  // reports the totals so the empty state names the other scopes. Runs only
  // while the visible list stays empty.
  useEffect(() => {
    if (!active || loading || visible.length > 0) return
    let alive = true
    window.electron.session
      .list({ includeArchived: true })
      .catch(() => [])
      .then((rows) => {
        if (!alive) return
        setAllCounts({
          all: rows.filter((row) => !row.archived).length,
          archived: rows.filter((row) => row.archived).length,
        })
      })
    return () => {
      alive = false
    }
  }, [active, loading, visible.length])

  return (
    <div className={`flex flex-col h-full overflow-hidden ${styles.panelGround}`}>
      <div className={styles.toolbar}>
        <div>
          <input
            className={styles.searchInput}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('terminal:agentSession.searchPlaceholder')}
            aria-label={t('terminal:agentSession.searchPlaceholder')}
          />
        </div>
        <div className={styles.scopeFilters}>
          {(Object.keys(SCOPE_KEYS) as Scope[]).map((key) => (
            <button
              key={key}
              className={styles.scopeTab}
              aria-current={scope === key ? 'page' : undefined}
              onClick={() => setScope(key)}
            >
              {t(SCOPE_KEYS[key])}
            </button>
          ))}
          {scope !== 'all' && activeWorktree && (
            <ThemedTooltip label={activeWorktree.path}>
            <span className={styles.scopeContext}>
              {activeWorktree.branch ?? activeWorktree.path}
            </span>
            </ThemedTooltip>
          )}
        </div>
      </div>

      <div
        ref={listRef}
        className={`flex-1 flex flex-col ${styles.sessionList}`}
        onScroll={(event) => {
          const list = event.currentTarget
          if (!active || shownCount >= visible.length || list.scrollTop <= 0) return
          if (list.scrollHeight - list.scrollTop - list.clientHeight > CARD_LOAD_THRESHOLD_PX) return
          // Use this render's page boundary so events in the same batch cannot
          // queue multiple pages before the newly appended cards are laid out.
          setShownCount(Math.min(shownCount + CARD_CHUNK, visible.length))
        }}
      >
        {/* Loading banner only on a truly empty list: background refreshes
            keep stale cards (stale-while-revalidate), so a banner above the
            list would shift every card per session:event. */}
        {loading && sessions.length === 0 && (
          <div className="text-xs" style={{ color: 'var(--shell-dim)' }}>{t('terminal:agentSession.loading')}</div>
        )}
        {error && (
          <div className="text-xs" style={{ color: 'var(--shell-diff-del)' }}>{error}</div>
        )}
        {sourceError && <div role="alert" className="text-xs" style={{ color: 'var(--shell-diff-del)' }}>{sourceError}</div>}
        {!loading && visible.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-xs" style={{ color: 'var(--shell-dim)', gap: 6 }}>
            <span>{t('terminal:agentSession.empty')}</span>
            {allCounts && (allCounts.all > 0 || allCounts.archived > 0) && (
              <span style={{ fontFamily: "'SF Mono', monospace", fontSize: 10 }}>
                {t('terminal:agentSession.scopeEmptyCounts', { all: allCounts.all, archived: allCounts.archived })}
              </span>
            )}
          </div>
        )}
        {shown.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            expanded={expandedId === session.id}
            timelineTick={expandedId === session.id ? timelineTick : 0}
            onToggle={handleToggle}
            onContinue={setContinueTarget}
            onDetail={setDetailTarget}
          />
        ))}
      </div>

      {detailTarget && createPortal(
        <SessionDetailWindow
          session={sessions.find((session) => session.id === detailTarget.id) ?? detailTarget}
          timelineTick={timelineTick}
          onClose={() => setDetailTarget(null)}
          onResume={() => {
            // Re-enter the provider's own session id in a fresh terminal;
            // failures surface on the panel error line.
            const id = detailTarget.id
            setDetailTarget(null)
            void continueSession(id, undefined, 'resume')
          }}
          onContinue={() => {
            setDetailTarget(null)
            setContinueTarget(detailTarget)
          }}
        />,
        document.body,
      )}

      {continueSource && createPortal(
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.64)', zIndex: 1000 }}
        >
            <div
              className="overflow-hidden"
              style={{
                width: 460,
                background: 'var(--shell-chrome)',
                border: '1px solid var(--shell-border)',
                borderRadius: 8,
                boxShadow: '0 24px 60px rgba(0,0,0,0.72)',
              }}
            >
              <SessionDialogHeader
                heading={t('terminal:agentSession.continueTitle')}
                onClose={() => setContinueTarget(null)}
              />
            <div style={{ padding: 16, fontSize: 12, color: 'var(--shell-muted)', lineHeight: 1.6 }}>
              {isNativeResumeEngine(continueSource.engine)
                ? t(buildContinueResumeArgs(continueSource)
                  ? 'terminal:agentSession.continueResumeBody'
                  : 'terminal:agentSession.continueHandoffBody')
                : t('terminal:agentSession.continueBody')}
              {!buildContinueResumeArgs(continueSource) && <div
                style={{
                  marginTop: 10,
                  padding: '8px 10px',
                  background: SURFACE_INSET,
                  border: '1px solid var(--shell-border-soft)',
                  borderRadius: 6,
                  color: 'var(--shell-text)',
                  whiteSpace: 'pre-wrap',
                }}
              >
                &ldquo;{continueSource.firstPrompt || continueSource.engine}&rdquo;
              </div>}
            </div>
            <div
              className="flex justify-end"
              style={{ padding: '12px 16px', borderTop: '1px solid var(--shell-border-soft)', gap: 8 }}
            >
              <button
                onClick={() => setContinueTarget(null)}
                className="rounded cursor-pointer"
                style={{ height: 28, padding: '0 16px', fontSize: 11, border: '1px solid var(--shell-border-soft)', background: SURFACE_INSET, color: 'var(--shell-muted)' }}
              >
                {t('common:action.cancel')}
              </button>
              <button
                onClick={async () => {
                  if (continuing) return
                  setContinuing(true)
                  try {
                    const result = await continueSession(continueSource.id, undefined, 'continue')
                    if (result) setContinueTarget(null)
                  } finally {
                    setContinuing(false)
                  }
                }}
                disabled={continuing}
                className={`rounded cursor-pointer ${styles.cardAction}`}
                style={{ height: 28, padding: '0 16px', fontSize: 11, border: '1px solid var(--control-border)', background: 'transparent', color: 'var(--shell-text)' }}
              >
                {t(buildContinueResumeArgs(continueSource)
                  ? 'terminal:agentSession.continueResumeStart'
                  : 'terminal:agentSession.continueStart')}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

function statusLabel(status: AgentSessionSummary['status'], t: (k: string) => string): string {
  if (status === 'active') return t('terminal:agentSession.statusActive')
  if (status === 'done') return t('terminal:agentSession.statusDone')
  if (status === 'failed') return t('terminal:agentSession.statusFailed')
  return t('terminal:agentSession.statusInterrupted')
}

function turnKindLabel(kind: string, t: (k: string) => string): string {
  if (kind === 'done') return t('terminal:agentSession.statusDone')
  if (kind === 'failed') return t('terminal:agentSession.statusFailed')
  return t('terminal:agentSession.statusInterrupted')
}

function baseNameOf(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).at(-1) ?? path
}

/** L1 标题：首轮提示的首个短句（HiFi v6 收缩态「」标题），无提示时回落 engine。 */
function promptTitle(prompt: string): string {
  const first = prompt.split(/[，。！？；、,!?;\n]/)[0]?.trim() ?? ''
  return first.length > 24 ? `${first.slice(0, 24)}…` : first
}

/** In-app dialogs expose only the close operation they support. */
function SessionDialogHeader({ heading, onClose }: { heading: ReactNode; onClose: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-3 px-3 select-none" style={{
      height: 38, background: 'var(--shell-pane-chrome)', borderBottom: '1px solid var(--shell-border-soft)',
    }}>
      <div className="min-w-0 flex-1 truncate text-xs" style={{ color: 'var(--shell-muted)' }}>{heading}</div>
      <ModalCloseButton onClose={onClose} />
    </div>
  )
}

const SessionCard = memo(function SessionCard({
  session,
  expanded,
  timelineTick,
  onToggle,
  onContinue,
  onDetail,
}: {
  session: AgentSessionSummary
  expanded: boolean
  timelineTick: number
  onToggle: (sessionId: string) => void
  onContinue: (session: AgentSessionSummary) => void
  onDetail: (session: AgentSessionSummary) => void
}) {
  const { t } = useI18n('terminal')
  const [detail, setDetail] = useState<AgentSessionDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [resuming, setResuming] = useState(false)
  const [resending, setResending] = useState(false)
  // L2 first-prompt display cap (AC-10): clamped until the reader asks for full text.
  const [promptFull, setPromptFull] = useState(false)
  const runContinue = useSessionStore((s) => s.continueSession)
  // Do not build every collapsed card's controls and prompt sheets at startup.
  // Retain a visited body so closing and reversing still animate continuously.
  const [visited, setVisited] = useState(expanded)
  const previewRequest = useRef<{
    version: string
    promise: Promise<AgentSessionDetail | null>
  } | null>(null)
  const previewVersion = JSON.stringify([
    session.id, session.updatedAt, session.turnCount, session.status,
    session.transcriptPath, timelineTick,
  ])

  useEffect(() => {
    if (!expanded) return
    setVisited(true)
    let alive = true
    // Reuse both pending and completed reads on rapid close/reopen. A changed
    // summary or live-event tick invalidates this one-entry, per-card cache.
    if (previewRequest.current?.version !== previewVersion) {
      const request = {
        version: previewVersion,
        promise: window.electron.session.get(session.id).catch(() => null),
      }
      previewRequest.current = request
      void request.promise.then((fetched) => {
        if (!fetched && previewRequest.current === request) previewRequest.current = null
      })
    }
    setDetailLoading(true)
    void previewRequest.current.promise.then((fetched) => {
      if (!alive) return
      if (fetched) setDetail(fetched)
      setDetailLoading(false)
    })
    return () => {
      alive = false
    }
  }, [expanded, session.id, previewVersion])

  const recentTurns = useMemo(() => {
    const turns = detail?.turns ?? []
    const ledgerTime = turns.at(-1)?.endedAt ?? ''
    return detail?.transcriptPreview && (detail.transcriptUpdatedAt ?? '') >= ledgerTime
      ? mergeTranscriptTurns([], detail.transcriptPreview, {
        createdAt: detail.createdAt, updatedAt: detail.transcriptUpdatedAt ?? detail.updatedAt,
      }) : turns.slice(-2)
  }, [detail])
  const resumeCommand = useMemo(() => buildResumeCommand(session), [session])
  const iconPreset = sessionEnginePreset(session.engine)

  // Note: expand motion retains visited bodies and animates grid rows; the
  // closed body is inert — see .agents/notes/workbench/session-card-surface.md
  // Note: compact list identity and optional prompt preview — see
  // .agents/notes/workbench/session-card-surface.md

  return (
    <div
      className={styles.cardSurface}
      data-session-id={session.id}
      data-expanded={expanded}
      style={{
        opacity: session.archived ? 0.62 : 1,
      }}
    >
      <div
        className={`flex items-center ${styles.cardHeader}`}
        style={{ gap: 7, cursor: 'pointer' }}
        onClick={() => onToggle(session.id)}
      >
        <TerminalPresetIcon preset={iconPreset} alt={session.engine} className={iconPreset === 'codex' ? styles.codexIcon : undefined} style={{ width: 14, height: 14, flexShrink: 0 }} />
        <span
          className="flex-1 min-w-0 overflow-hidden overflow-ellipsis whitespace-nowrap"
          style={{ fontSize: 13, color: 'var(--shell-text)', fontWeight: 500 }}
        >
          {session.firstPrompt ? promptTitle(session.firstPrompt) : session.engine}
        </span>
        <span
          style={{
            fontFamily: "'SF Mono', monospace",
            fontSize: 10,
            color: 'var(--shell-dim)',
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          {session.archived ? t('terminal:agentSession.archived') : statusLabel(session.status, t)}
        </span>
        <ThemedTooltip label={expanded ? t('terminal:agentSession.collapse') : t('terminal:agentSession.expand')}>
        <button
          type="button"
          className={styles.foldBtn}
          data-open={expanded}
          aria-expanded={expanded}
          aria-label={expanded ? t('terminal:agentSession.collapse') : t('terminal:agentSession.expand')}
          onClick={(event) => {
            event.stopPropagation()
            onToggle(session.id)
          }}
        >
          <ChevronDown size={13} strokeWidth={2} aria-hidden="true" />
        </button>
        </ThemedTooltip>
      </div>

      {session.firstPrompt && session.firstPrompt.trim() !== promptTitle(session.firstPrompt) && (
        <div className={styles.promptPreview}>
          {session.firstPrompt}
        </div>
      )}
      <div className={styles.sessionMeta}>
        <span style={{ textTransform: 'capitalize' }}>{session.engine}</span>
        {session.external === true && <span>{t('terminal:agentSession.external')}</span>}
        <span>{t('terminal:agentSession.turns', { count: session.turnCount })}</span>
        <span style={{ marginLeft: 'auto' }}>{formatDate(session.updatedAt, t)}</span>
      </div>

      <div className={styles.expand} data-open={expanded}>
        <div className={styles.expandInner} {...(!expanded ? { inert: '' } : {})}>
          {(expanded || visited) && <div style={{ marginTop: 10, paddingTop: 10, borderTop: CARD_BORDER_SOFT }}>
            <div style={{ fontFamily: "'SF Mono', monospace", fontSize: 10, color: 'var(--shell-muted)', lineHeight: 1.8 }}>
              <div>…/{baseNameOf(session.cwd)}{session.branch ? ` · ${session.branch}` : ''}</div>
            </div>
            {session.firstPrompt && (
              <div className={styles.sheet} style={{ marginTop: 8, padding: '9px 10px' }}>
                <div className="flex items-center" style={{ gap: 8, fontFamily: "'SF Mono', monospace", fontSize: 9.5, color: 'var(--shell-dim)', marginBottom: 6 }}>
                  <span>{t('terminal:agentSession.firstPrompt')}</span>
                  <span style={{ marginLeft: 'auto' }}>
                    <CopyButton text={session.firstPrompt} />
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 12,
                    lineHeight: 1.6,
                    color: 'var(--shell-text)',
                    wordBreak: 'break-all',
                    whiteSpace: 'pre-wrap',
                    ...(session.firstPrompt.length > PROMPT_CLAMP_CHARS && !promptFull
                      ? { display: '-webkit-box', WebkitLineClamp: PROMPT_CLAMP_LINES, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden' }
                      : {}),
                  }}
                >
                  {session.firstPrompt}
                </div>
                {session.firstPrompt.length > PROMPT_CLAMP_CHARS && (
                  <button
                    type="button"
                    onClick={() => setPromptFull((open) => !open)}
                    className={styles.cardAction}
                    style={{
                      marginTop: 4,
                      padding: 0,
                      border: 0,
                      background: 'transparent',
                      color: 'var(--shell-accent)',
                      fontSize: 10,
                      fontFamily: "'SF Mono', monospace",
                      cursor: 'pointer',
                    }}
                  >
                    {promptFull ? t('terminal:agentSession.collapse') : t('terminal:agentSession.expand')}
                  </button>
                )}
              </div>
            )}
            <div className={styles.sheet} style={{ marginTop: 8, display: 'flex', flexDirection: 'column', padding: '2px 10px' }}>
              <div style={{ fontFamily: "'SF Mono', monospace", fontSize: 9.5, color: 'var(--shell-dim)', padding: '8px 0 0' }}>
                {t('terminal:agentSession.recentTurns')}
              </div>
              {!detail ? (
                <div style={{ fontSize: 11, color: 'var(--shell-dim)', padding: '6px 0' }}>{detailLoading ? t('terminal:agentSession.loading') : t('terminal:agentSession.empty')}</div>
              ) : recentTurns.length === 0 ? (
                <div style={{ fontSize: 11, color: 'var(--shell-dim)', padding: '6px 0' }}>{t('terminal:agentSession.empty')}</div>
              ) : (
                recentTurns.map((turn) => {
                  const question = turn.prompt
                  return (
                    <div key={turn.id} style={{ padding: '8px 0', borderTop: '1px solid var(--shell-border-soft)' }}>
                      <div className="flex items-center" style={{ gap: 6, fontFamily: "'SF Mono', monospace", fontSize: 9.5, color: 'var(--shell-dim)', marginBottom: 4 }}>
                        <span>turn · {formatDate(turn.startedAt, t)}</span>
                        <span style={{ color: turn.kind === 'done' ? 'var(--shell-muted)' : 'var(--shell-diff-del)', border: '1px solid var(--shell-border)', borderRadius: 3, padding: '0 5px' }}>
                          {turnKindLabel(turn.kind, t)}
                        </span>
                      </div>
                      {question && (
                        <div style={{ fontSize: 11.5, lineHeight: 1.6, color: 'var(--shell-text)', wordBreak: 'break-all', whiteSpace: 'pre-wrap', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {question}
                        </div>
                      )}
                      {turn.excerpt && (
                        <div style={{ marginTop: 4, fontSize: 11.5, lineHeight: 1.6, color: 'var(--shell-muted)', wordBreak: 'break-all', whiteSpace: 'pre-wrap', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {turn.excerpt}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
            <div className={styles.sessionActions}>
              <button
                onClick={() => onDetail(session)}
                className={`${styles.sessionAction} ${styles.detailAction}`}
              >
                {t('terminal:agentSession.viewDetail')}
              </button>
              {session.archived && !canOfferSessionResume(session) ? null : (
                <>
                  {canOfferSessionResume(session) && (
                    resumeCommand ? (
                      <button
                        onClick={() => {
                          if (resuming) return
                          setResuming(true)
                          void runContinue(session.id, undefined, 'resume').finally(() => setResuming(false))
                        }}
                        disabled={resuming}
                        className={`${styles.sessionAction} ${styles.resumeAction}`}
                        aria-busy={resuming}
                      >
                        {t('terminal:agentSession.resume')}
                      </button>
                    ) : (
                      <ThemedTooltip label={t('terminal:agentSession.resumeUnavailable')}>
                      <button
                        disabled
                        className={`${styles.sessionAction} ${styles.resumeAction}`}
                      >
                        {t('terminal:agentSession.resume')}
                      </button>
                      </ThemedTooltip>
                    )
                  )}
                  {!session.archived && <button
                    onClick={() => onContinue(session)}
                    className={styles.sessionAction}
                  >
                    {t('terminal:agentSession.continue')}
                  </button>}
                </>
              )}
            </div>
            {detail?.pendingHandoff && (
              <div
                style={{
                  marginTop: 8, padding: '7px 9px',
                  border: '1px dashed var(--shell-border)', borderRadius: 4, lineHeight: 1.6,
                }}
              >
                <div style={{ fontSize: 10.5, color: 'var(--shell-dim)' }}>
                  {detail.pendingHandoffState === 'failed'
                    ? t('terminal:agentSession.handoffFailed')
                    : t('terminal:agentSession.handoffUnconfirmed')}
                </div>
                <button
                  onClick={() => {
                    if (resending) return
                    setResending(true)
                    void window.electron.session
                      .resendHandoff(session.id)
                      .finally(() => setResending(false))
                  }}
                  disabled={resending}
                  className="rounded cursor-pointer"
                  style={{
                    marginTop: 6, height: 22, padding: '0 12px', fontSize: 10,
                    border: '1px solid var(--control-border)', background: 'transparent',
                    color: 'var(--shell-text)', opacity: resending ? 0.6 : 1,
                  }}
                >
                  {t('terminal:agentSession.handoffResend')}
                </button>
              </div>
            )}
            <div style={{ fontSize: 10, color: 'var(--shell-dim)', marginTop: 7, lineHeight: 1.6 }}>
              {t('terminal:agentSession.detailHint', { count: session.turnCount })}
            </div>
            {session.archived && (
              <div
                style={{
                  fontSize: 10.5, color: 'var(--shell-dim)', marginTop: 8, padding: '7px 9px',
                  border: '1px dashed var(--shell-border)', borderRadius: 4, lineHeight: 1.6,
                }}
              >
                {t('terminal:agentSession.archivedHint')}
              </div>
            )}
            {session.external === true && !session.archived && (
              <div style={{ fontSize: 10, color: 'var(--shell-dim)', marginTop: 6, lineHeight: 1.6 }}>
                {t('terminal:agentSession.externalHint')}
              </div>
            )}
          </div>}
        </div>
      </div>
    </div>
  )
})

function SessionDetailWindow({
  session,
  timelineTick,
  onClose,
  onResume,
  onContinue,
}: {
  session: AgentSessionSummary
  timelineTick: number
  onClose: () => void
  /** Re-enter the provider's own session in a new terminal. */
  onResume: () => void
  onContinue: () => void
}) {
  const { t } = useI18n('terminal')
  const [detail, setDetail] = useState<AgentSessionDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [transcript, setTranscript] = useState<TranscriptDetail | null>(null)
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null)
  const turnRefs = useMemo(() => new Map<string, HTMLDivElement | null>(), [])
  const turnsPaneRef = useRef<HTMLDivElement | null>(null)
  const navPaneRef = useRef<HTMLDivElement | null>(null)
  const jumpToTurn = useCallback((id: string) => {
    setActiveTurnId(id)
    turnRefs.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [turnRefs])
  const resumeCommand = useMemo(() => buildResumeCommand(session), [session])
  useEffect(() => {
    let alive = true
    // Reload live questions and excerpts on debounced session events.
    setDetailLoading(true)
    window.electron.session
      .get(session.id)
      .catch(() => null)
      .then((fetched) => {
        if (!alive) return
        if (fetched) setDetail(fetched)
        setDetailLoading(false)
      })
    return () => {
      alive = false
    }
  }, [session.id, timelineTick])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Refresh provider prose alongside the ledger; keep the prior reading view
  // while a background read is in flight, and discard superseded responses.
  useEffect(() => {
    let alive = true
    window.electron.session
      .getTranscript(session.id)
      .catch(() => null)
      .then((fetched) => {
        if (!alive) return
        setTranscript(fetched)
      })
    return () => {
      alive = false
    }
  }, [session.id, timelineTick])

  const displayTurns = useMemo(
    () =>
      mergeTranscriptTurns(detail?.turns ?? [], transcript?.turns ?? [], {
        createdAt: detail?.createdAt ?? session.createdAt,
        updatedAt: detail?.updatedAt ?? session.updatedAt,
      }),
    [detail, transcript, session.createdAt, session.updatedAt],
  )

  // Scroll-spy: the rail follows the turn under a reading line near the top
  // of the pane. A zero-width line sits inside exactly one turn at a time, so
  // the focus changes once per boundary crossing and never flickers between
  // neighbors the way threshold-chasing observers do.
  useEffect(() => {
    const pane = turnsPaneRef.current
    if (!pane) return
    let raf = 0
    const update = () => {
      raf = 0
      const line = pane.getBoundingClientRect().top + pane.clientHeight * 0.2
      let current: string | null = null
      for (const [key, el] of turnRefs) {
        if (!el || !el.isConnected) {
          turnRefs.delete(key)
          continue
        }
        const box = el.getBoundingClientRect()
        if (box.top <= line && box.bottom > line) {
          current = key
          break
        }
      }
      if (current) setActiveTurnId((prev) => (prev === current ? prev : current))
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    pane.addEventListener('scroll', onScroll, { passive: true })
    update()
    return () => {
      pane.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [displayTurns, turnRefs])

  // Keep the active rail entry in view without stealing the reading scroll.
  useEffect(() => {
    if (!activeTurnId) return
    navPaneRef.current
      ?.querySelector(`[data-nav="${CSS.escape(activeTurnId)}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [activeTurnId])

  const iconPreset = sessionEnginePreset(session.engine)

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.64)', zIndex: 1000 }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-label={session.firstPrompt || session.engine}
        className="overflow-hidden flex flex-col"
        style={{
          width: 1020,
          maxWidth: 'calc(100vw - 40px)',
          height: 660,
          maxHeight: 'calc(100vh - 60px)',
          background: 'var(--shell-chrome)',
          border: '1px solid var(--shell-border)',
          borderRadius: 8,
          boxShadow: '0 24px 60px rgba(0,0,0,0.72)',
        }}
      >
        <SessionDialogHeader
          heading={
            <>
              <TerminalPresetIcon preset={iconPreset} alt={session.engine} style={{ width: 12, height: 12, display: 'inline-block', verticalAlign: -1, marginRight: 6 }} />
              {session.firstPrompt || session.engine}
            </>
          }
          onClose={onClose}
        />
        <div style={{ padding: '9px 16px', borderBottom: '1px solid var(--shell-border-soft)', flexShrink: 0 }}>
          <div style={{ fontFamily: "'SF Mono', monospace", fontSize: 10.5, color: 'var(--shell-muted)', lineHeight: 1.7 }}>
            …/{baseNameOf(session.cwd)}{session.branch ? ` · ${session.branch}` : ''} · {session.engine} ·{' '}
            {t('terminal:agentSession.turns', { count: session.turnCount })}
          </div>
          <div className="flex" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {session.firstPrompt && <CopyButton text={session.firstPrompt} label={t('terminal:agentSession.firstPrompt')} />}
            {(detail?.transcriptPath ?? session.transcriptPath) && (
              <CopyButton text={(detail?.transcriptPath ?? session.transcriptPath) as string} label={t('terminal:agentSession.copyLogPath')} />
            )}
            {(detail?.providerSessionId ?? session.providerSessionId) && (
              <CopyButton text={(detail?.providerSessionId ?? session.providerSessionId) as string} label={t('terminal:agentSession.copySessionId')} />
            )}
            {canOfferSessionResume(session) && resumeCommand && (
              <CopyButton text={resumeCommand} label={t('terminal:agentSession.resumeCopy')} />
            )}
          </div>
        </div>
        {session.external === true && !session.archived && (
          <div style={{ margin: '10px 16px 0', padding: '8px 11px', border: '1px dashed var(--shell-accent-border)', borderRadius: 6, fontSize: 11, color: 'var(--shell-accent)', lineHeight: 1.6, flexShrink: 0 }}>
            {t('terminal:agentSession.detailExternalBanner')}
          </div>
        )}
        {session.archived && (
          <div style={{ margin: '10px 16px 0', padding: '8px 11px', border: '1px dashed var(--shell-border)', borderRadius: 6, fontSize: 11, color: 'var(--shell-muted)', lineHeight: 1.6, flexShrink: 0 }}>
            {t('terminal:agentSession.archivedHint')}
          </div>
        )}
        <div className="flex" style={{ flex: 1, minHeight: 0 }}>
          <div ref={navPaneRef} style={{ width: 168, flexShrink: 0, borderRight: '1px solid var(--shell-border-soft)', overflowY: 'auto', padding: '10px 8px', background: SURFACE_INSET }}>
            <div style={{ fontFamily: "'SF Mono', monospace", fontSize: 9.5, color: 'var(--shell-dim)', padding: '0 6px 6px' }}>
              {t('terminal:agentSession.turns', { count: displayTurns.length })}
            </div>
            {displayTurns.map((turn, index) => {
              const label = (turn.prompt ?? turn.excerpt ?? '').replace(/\s+/g, ' ').trim().slice(0, 20) || `turn ${index + 1}`
              const active = activeTurnId === turn.id
              return (
                <ThemedTooltip key={turn.id} label={turn.prompt ?? turn.excerpt ?? `turn ${index + 1}`}>
                <button
                  data-nav={turn.id}
                  onClick={() => jumpToTurn(turn.id)}
                  className="cursor-pointer"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                    padding: '5px 6px', borderRadius: 4, border: 0, cursor: 'pointer',
                    background: active ? 'var(--shell-accent-soft)' : 'transparent',
                    color: active ? 'var(--shell-text)' : 'var(--shell-muted)',
                    fontFamily: "'SF Mono', monospace", fontSize: 10, lineHeight: 1.5, textAlign: 'left',
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: turn.kind === 'done' ? 'transparent' : turn.kind === 'failed' ? 'var(--shell-diff-del)' : 'var(--shell-accent)' }} />
                  <span style={{ color: 'var(--shell-dim)', flexShrink: 0 }}>{index + 1}</span>
                  <span className="flex-1 min-w-0 overflow-hidden overflow-ellipsis whitespace-nowrap">{label}</span>
                </button>
                </ThemedTooltip>
              )
            })}
          </div>
          <div ref={turnsPaneRef} style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '12px 16px' }}>
            {!detail ? (
              <div style={{ fontSize: 11, color: 'var(--shell-dim)' }}>{detailLoading ? t('terminal:agentSession.loading') : t('terminal:agentSession.empty')}</div>
            ) : (
              <>
                {transcript?.truncated && (
                  <div style={{ fontFamily: "'SF Mono', monospace", fontSize: 10, color: 'var(--shell-dim)', padding: '2px 0 8px' }}>
                    {t('terminal:agentSession.transcriptTruncated', { total: transcript.totalTurns, shown: transcript.turns.length })}
                  </div>
                )}
                {displayTurns.map((turn, index) => {
                  const question = turn.prompt
                  return (
                    <div
                      key={turn.id}
                      ref={(node) => { turnRefs.set(turn.id, node) }}
                      style={{
                        background: SURFACE_CARD,
                        border: activeTurnId === turn.id ? '1px solid var(--shell-accent-border)' : CARD_BORDER,
                        borderRadius: 8, padding: '11px 12px', marginBottom: 10,
                      }}
                    >
                      {question && (
                        <div style={{ marginBottom: 9 }}>
                          <div style={{ fontFamily: "'SF Mono', monospace", fontSize: 9.5, color: 'var(--shell-dim)', marginBottom: 5 }}>
                            turn {index + 1} · {formatDate(turn.startedAt, t)}
                          </div>
                          <div style={{ fontSize: 12.5, lineHeight: 1.65, color: 'var(--shell-text)', wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>
                            {question}
                          </div>
                        </div>
                      )}
                      <div className="flex items-center" style={{ gap: 6, fontFamily: "'SF Mono', monospace", fontSize: 9.5, color: 'var(--shell-dim)' }}>
                        <span>{session.engine}</span>
                        <span style={{ color: turn.kind === 'done' ? 'var(--shell-muted)' : 'var(--shell-diff-del)', border: '1px solid var(--shell-border)', borderRadius: 3, padding: '0 5px' }}>
                          {turnKindLabel(turn.kind, t)}
                        </span>
                        {!question && <span>turn {index + 1} · {formatDate(turn.startedAt, t)}</span>}
                      </div>
                      {turn.excerpt && (
                        <div style={{ marginTop: 6, fontSize: 12.5, lineHeight: 1.65, color: 'var(--shell-text)', wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>
                          {turn.excerpt}
                        </div>
                      )}
                    </div>
                  )
                })}
                {displayTurns.length === 0 && (
                  <div style={{ fontSize: 11, color: 'var(--shell-dim)', padding: '6px 0' }}>{t('terminal:agentSession.empty')}</div>
                )}
              </>
            )}
          </div>
        </div>
        <div
          className="flex items-center"
          style={{ gap: 8, padding: '10px 14px', borderTop: '1px solid var(--shell-border-soft)', flexShrink: 0, flexWrap: 'wrap' }}
        >
          <span style={{ fontSize: 11, color: 'var(--shell-muted)', flex: 1 }}>
            {t('terminal:agentSession.detailReadOnlyHint')}
          </span>
          <button
            onClick={onClose}
            className={styles.sessionAction}
          >
            {t('common:action.close')}
          </button>
          {session.archived && !canOfferSessionResume(session) ? null : (
            <>
              {canOfferSessionResume(session) && (
                resumeCommand ? (
                  <button
                    onClick={onResume}
                    className={`${styles.sessionAction} ${styles.resumeAction}`}
                  >
                    {t('terminal:agentSession.resume')}
                  </button>
                ) : (
                  <ThemedTooltip label={t('terminal:agentSession.resumeUnavailable')}>
                  <button
                    disabled
                    className={`${styles.sessionAction} ${styles.resumeAction}`}
                  >
                    {t('terminal:agentSession.resume')}
                  </button>
                  </ThemedTooltip>
                )
              )}
              {!session.archived && <button
                onClick={onContinue}
                className={styles.sessionAction}
              >
                {t('terminal:agentSession.continue')}
              </button>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
