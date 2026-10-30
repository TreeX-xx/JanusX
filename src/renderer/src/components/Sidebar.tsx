import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { createPortal } from 'react-dom'
import { ChevronRight, Ellipsis, Folder, GitBranch, PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react'
import { useWorkspaceStore } from '@/stores/workspace'
import { EMPTY_PENDING_LIST, EMPTY_STRING_LIST, EMPTY_WORKTREE_LIST, useWorktreeStore } from '@/stores/worktree'
import { useAppStore } from '@/stores/app'
import { useThemeStore } from '@/stores/theme'
import { useI18n } from '@/i18n/useI18n'
import { ProjectLauncher } from './ProjectLauncher'
import { WorkspaceUnavailableNotice, relocateWorkspaceData } from './WorkspaceDataPanel'
import { WorktreeComposer, WorktreeDeleteDialog, WorktreeShipDialog } from './WorktreeDialogs'
import { ModalCloseButton } from './ModalCloseButton'
import { ModalFrame } from './shared/ModalFrame'
import { ThemedTooltip } from './ui/ThemedTooltip'
import { TerminalStatusLight } from './ui/TerminalStatusLight'
import { TerminalPresetIcon } from './ui/TerminalPresetIcon'
import { TeamFooter, TeamFooterCollapsed } from './team/TeamFooter'
import type { Workspace, WorkspaceSidebarGroup, Terminal } from '@/types'
import type { WorktreeInfo } from '../../../shared/ipc/worktree'
import { clearTerminalDragData, setTerminalDragData } from '@/lib/terminal-file-reference'
import { chooseAndCreateWorkspace, getActiveScopePath, getScopePathForWorkspace, loadWorkspaceFileTree, refreshScopeFileTree, switchActiveWorktree } from '@/features/workspace/actions'
import { invalidateEditorFileCache } from '@/stores/editor'
import { TERMINAL_ATTENTION_ORDER, getTerminalStatusVisual, summarizeTerminalActivity } from '@/lib/terminal-sidebar-visual'
import {
  clearWorkspaceSidebarGroup,
  groupWorkspaceInSidebar,
  moveWorkspaceInSidebar,
  moveWorkspaceToSidebarBoundary,
  nextWorkspaceSidebarGroupName,
  normalizeWorkspaceSidebarLayout,
  removeWorkspaceFromSidebarGroup,
  renameWorkspaceSidebarGroup,
  sortWorkspaceSidebar,
  workspaceSidebarLayoutsEqual,
  type WorkspaceSidebarBoundary,
  type WorkspaceSidebarDropPosition,
} from '../../../shared/workspace-sidebar'
import {
  JANUS_PROJECT_CANDIDATE_EVENT,
  type JanusProjectCandidate,
} from './janus/janusProjectCandidate'
import styles from './Sidebar.module.css'

const WORKSPACE_DRAG_TYPE = 'application/x-janus-workspace'
const GROUP_HOVER_DELAY = 300
const MENU_MARGIN = 8
const MENU_WIDTH = 188

type WorkspaceDropIntent =
  | { mode: WorkspaceSidebarDropPosition | 'group-pending' | 'group'; targetId: string }
  | { mode: WorkspaceSidebarBoundary; targetId: null }

type WorkspaceContextMenuState = {
  x: number
  y: number
  target:
    | { kind: 'workspace'; workspace: Workspace }
    | { kind: 'group'; group: WorkspaceSidebarGroup }
}

interface WorkspaceContextMenuProps {
  menu: WorkspaceContextMenuState
  onRunConfiguration: (workspace: Workspace) => void
  onCreateWorktree: (workspace: Workspace) => void
  onRenameGroup: (group: WorkspaceSidebarGroup) => void
  onRemoveFromGroup: (workspaceId: string) => void
  onClearGroup: (groupId: string) => void
  onDelete: (workspace: Workspace) => void
  onRelocate: (workspace: Workspace) => void
}

// Expanded rows reveal a fixed-slot ⋯ on hover/focus; names do not move.
// See .agents/notes/sessions/workspace-row-hover-reveal.md.
function WorkspaceContextMenu({
  menu,
  onRunConfiguration,
  onCreateWorktree,
  onRenameGroup,
  onRemoveFromGroup,
  onClearGroup,
  onDelete,
  onRelocate,
}: WorkspaceContextMenuProps) {
  const { t } = useI18n('common')
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x: menu.x, y: menu.y })
  // Note: .agents/notes/workbench/right-dock.md — shared neutral popover surface.

  useLayoutEffect(() => {
    const element = menuRef.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    setPosition({
      x: Math.max(MENU_MARGIN, Math.min(menu.x, window.innerWidth - rect.width - MENU_MARGIN)),
      y: Math.max(MENU_MARGIN, Math.min(menu.y, window.innerHeight - rect.height - MENU_MARGIN)),
    })
  }, [menu.x, menu.y])

  const itemClassName = 'block w-full border-0 bg-transparent px-3 py-1.5 text-left text-[12px] text-[var(--shell-text)] transition-colors hover:bg-[var(--popover-hover)] hover:text-[var(--shell-text)] focus-visible:bg-[var(--popover-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-2 focus-visible:outline-[var(--shell-accent)]'
  const separatorClassName = 'my-1 h-px bg-[var(--shell-border)]'
  const target = menu.target

  return createPortal(
    <div
      ref={menuRef}
      className="fixed overflow-hidden rounded-md py-1"
      style={{
        left: position.x,
        top: position.y,
        width: MENU_WIDTH,
        zIndex: 1200,
        background: 'var(--popover-background)',
        border: '1px solid var(--control-border)',
        boxShadow: 'var(--popover-shadow)',
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      {target.kind === 'workspace' ? (
        <>
          <button type="button" className={itemClassName} onClick={() => onRunConfiguration(target.workspace)}>
            {t('common:workspace.runConfiguration')}
          </button>
          <button type="button" className={itemClassName} onClick={() => onCreateWorktree(target.workspace)}>
            {t('common:workspace.createWorktree')}
          </button>
          <button type="button" className={itemClassName} onClick={() => onRelocate(target.workspace)}>{t('storage:maintenance.relocate')}</button>
          {target.workspace.sidebarGroup && (
            <>
              <div className={separatorClassName} />
              <button type="button" className={itemClassName} onClick={() => onRenameGroup(target.workspace.sidebarGroup!)}>
                {t('common:workspace.renameGroup')}
              </button>
              <button type="button" className={itemClassName} onClick={() => onRemoveFromGroup(target.workspace.id)}>
                {t('common:workspace.removeFromGroup')}
              </button>
            </>
          )}
          <div className={separatorClassName} />
          <button
            type="button"
            className={`${itemClassName} !text-[var(--shell-diff-del)] hover:!bg-[var(--shell-accent-soft)]`}
            onClick={() => onDelete(target.workspace)}
          >
            {t('common:workspace.deleteWorkspace')}
          </button>
        </>
      ) : (
        <>
          <button type="button" className={itemClassName} onClick={() => onRenameGroup(target.group)}>
            {t('common:workspace.renameGroup')}
          </button>
          <button type="button" className={itemClassName} onClick={() => onClearGroup(target.group.id)}>
            {t('common:workspace.ungroup')}
          </button>
        </>
      )}
    </div>,
    document.body,
  )
}

function createWorkspaceSidebarGroupId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `workspace-group-${crypto.randomUUID()}`
  }
  return `workspace-group-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function terminalPresetLabel(preset: Terminal['preset'], t: (key: string) => string): string {
  switch (preset) {
    case 'claude':
      return t('terminal:provider.claude')
    case 'codex':
      return t('terminal:provider.codex')
    case 'opencode':
      return t('terminal:provider.opencode')
    case 'janus':
      return t('terminal:provider.janus')
    case 'pi':
      return t('terminal:provider.pi')
    case 'dsh':
      return t('terminal:provider.dsh')
    default:
      return t('terminal:provider.shell')
  }
}

// Preset 图标走共享 TerminalPresetIcon；侧栏单独修正 Codex 在深色主题的对比度。
// Note: status is a ring with per-state shape and motion; the label lives only in title/aria-label — see .agents/notes/terminal/terminal-status-display.md
// 形态走共享 TerminalStatusLight（与中部 tab 同一盏灯），此处只保留 tooltip 与 20px 点击区。
function TerminalStatusIndicator({ status }: { status: Terminal['status'] }) {
  const { t } = useI18n('terminal')
  const visual = getTerminalStatusVisual(status)
  const title = t('common:workspace.terminalStatusTitle', { label: t(visual.labelKey) })

  return (
    <ThemedTooltip label={title}>
      <span
        role="img"
        aria-label={title}
        className="flex h-5 w-5 shrink-0 items-center justify-center"
      >
        <TerminalStatusLight status={status} />
      </span>
    </ThemedTooltip>
  )
}

function workspaceInitial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? '?'
}

// Folder at rest; cached avatar appears on hover and remains for the selected workspace.
function RepoRowIcon({ workspacePath }: { workspacePath: string }) {
  const avatar = useWorktreeStore((s) => s.avatars[workspacePath])
  const [failed, setFailed] = useState(false)
  if (!avatar || failed) {
    return <Folder size={14} strokeWidth={1.6} className="shrink-0" aria-hidden="true" />
  }
  return (
    <span className={styles.repoIcon} aria-hidden="true">
      <Folder size={14} strokeWidth={1.6} className={styles.repoFolder} />
      <img
        src={avatar}
        alt=""
        onError={() => setFailed(true)}
        className={styles.repoAvatar}
      />
    </span>
  )
}

function worktreeDisplayName(path: string, branch: string | null): string {
  if (branch) return branch
  const parts = path.split(/[/\\]/).filter(Boolean)
  return parts.at(-1) ?? path
}

// Note: terminals are level-3 items grouped under their worktree (hi-fi:
// design/session-mgmt-hifi.html `.terms` block follows each `.ws` row) — see
// .agents/notes/terminal/terminal-sidebar-states.md
/** Terminal cwd belongs to a worktree path across git/native spellings and case. */
function isCwdWithinWorktree(cwd: string, base: string): boolean {
  const norm = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '')
  const left = norm(cwd)
  const right = norm(base)
  if (!left || !right) return false
  if (left === right || left.startsWith(`${right}/`)) return true
  if (left.startsWith('janusx-workspace://') || right.startsWith('janusx-workspace://')) return false
  const lowerLeft = left.toLowerCase()
  const lowerRight = right.toLowerCase()
  return lowerLeft === lowerRight || lowerLeft.startsWith(`${lowerRight}/`)
}

/** Display-only base ref: `origin/main` reads as `main`. */
function displayBaseRef(ref: string): string {
  return ref.startsWith('origin/') ? ref.slice(7) : ref
}

interface WorktreeTerminalGroup {
  worktree: WorktreeInfo | null
  terminals: Terminal[]
}

/** Terminals follow their worktree; unmatched fall back to main, then to a bare group. */
function groupTerminalsByWorktree(worktrees: WorktreeInfo[], terminals: Terminal[]): WorktreeTerminalGroup[] {
  const buckets = new Map<string, Terminal[]>()
  const unmatched: Terminal[] = []
  for (const terminal of terminals) {
    const owner = terminal.cwd
      ? worktrees.find((worktree) => isCwdWithinWorktree(terminal.cwd, worktree.path))
      : undefined
    if (owner) {
      const list = buckets.get(owner.id) ?? []
      list.push(terminal)
      buckets.set(owner.id, list)
    } else {
      unmatched.push(terminal)
    }
  }
  const groups = worktrees.map((worktree) => ({ worktree, terminals: buckets.get(worktree.id) ?? [] }))
  if (unmatched.length === 0) return groups
  const fallback = groups.find((group) => group.worktree?.isMain) ?? groups[0]
  if (fallback) {
    fallback.terminals.push(...unmatched)
    return groups
  }
  return [{ worktree: null, terminals: unmatched }]
}

function sortTerminalsByAttention(terminals: Terminal[]): Terminal[] {
  return [...terminals].sort((a, b) => (TERMINAL_ATTENTION_ORDER[a.status] ?? 99) - (TERMINAL_ATTENTION_ORDER[b.status] ?? 99))
}

function TerminalRow({
  terminal,
  focused,
  onDragStart,
  onSelect,
}: {
  terminal: Terminal
  focused: boolean
  onDragStart: (terminal: Terminal, event: React.DragEvent<HTMLDivElement>) => void
  onSelect: (terminal: Terminal) => void
}) {
  const { t } = useI18n()
  const presetLabel = terminalPresetLabel(terminal.preset, t)
  const displayName = terminal.name || presetLabel
  return (
    <ThemedTooltip label={`${displayName} · ${presetLabel} · ${terminal.cwd}`}>
    <div
      draggable
      role="button"
      tabIndex={0}
      aria-current={focused ? 'true' : undefined}
      aria-label={displayName}
      data-sidebar-terminal={terminal.id}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onSelect(terminal)
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        onSelect(terminal)
      }}
      onDragStart={(event) => onDragStart(terminal, event)}
      onDragEnd={() => clearTerminalDragData(terminal.id)}
      className={styles.terminalRow}
    >
      <span
        className="flex h-[18px] w-[18px] items-center justify-center"
      >
        <TerminalPresetIcon
          preset={terminal.preset}
          alt={t('common:workspace.presetIconAlt', { preset: presetLabel })}
          className="h-3.5 w-3.5 shrink-0"
          style={terminal.preset === 'codex' ? { filter: 'var(--sidebar-codex-filter)' } : undefined}
        />
      </span>
      <span className="min-w-0">
        <span className={styles.terminalName}>
          {displayName}
        </span>
      </span>
      <TerminalStatusIndicator status={terminal.status} />
    </div>
    </ThemedTooltip>
  )
}

/** Quiet count; one summary indicator appears only when action is needed. */
function WorktreeTerminalBadge({ terminals }: { terminals: Terminal[] }) {
  const { t } = useI18n()
  if (terminals.length === 0) return null
  const activity = summarizeTerminalActivity(terminals)
  const attentionStatus = activity.needsApproval > 0 ? 'needs-approval'
    : activity.needsInput > 0 ? 'needs-input'
      : activity.errors > 0 ? 'error'
        : activity.degraded > 0 ? 'degraded' : null
  return (
    <ThemedTooltip
      label={t('common:workspace.terminalCountTitle', {
        total: activity.total,
        running: activity.running,
        attention: activity.needsAction > 0
          ? t('common:workspace.terminalCountAttentionSuffix', { count: activity.needsAction })
          : '',
        errors: activity.errors
          ? t('common:workspace.terminalCountErrorsSuffix', { count: activity.errors })
          : '',
      })}
    >
    <span
      className={styles.terminalCount}
    >
      <span>{activity.total}</span>
      {attentionStatus && <TerminalStatusLight status={attentionStatus} compact />}
    </span>
    </ThemedTooltip>
  )
}

function WorktreeSubList({
  workspaceId,
  workspacePath,
  lastKeptBranch,
  terminals,
  activeTerminalId,
  isActiveWorkspace,
  onDeleteRequest,
  onShipRequest,
  onTerminalDragStart,
  onTerminalSelect,
}: {
  workspaceId: string
  workspacePath: string
  lastKeptBranch: string | null
  terminals: Terminal[]
  activeTerminalId: string | null
  isActiveWorkspace: boolean
  onDeleteRequest: (worktree: WorktreeInfo) => void
  onShipRequest: (worktree: WorktreeInfo) => void
  onTerminalDragStart: (terminal: Terminal, event: React.DragEvent<HTMLDivElement>) => void
  onTerminalSelect: (terminal: Terminal) => void
}) {
  const { t } = useI18n('terminal')
  const worktrees = useWorktreeStore((s) => s.worktreesByWorkspace[workspaceId] ?? EMPTY_WORKTREE_LIST)
  const activePath = useWorktreeStore((s) => s.activePaths[workspaceId] ?? workspacePath)
  const fetchWorktrees = useWorktreeStore((s) => s.fetchWorktrees)
  const preservedBranches = useWorktreeStore((s) => s.preservedBranches[workspaceId] ?? EMPTY_STRING_LIST)
  const deleteBranch = useWorktreeStore((s) => s.deleteBranch)
  const pendingCreations = useWorktreeStore((s) => s.pendingCreations[workspaceId] ?? EMPTY_PENDING_LIST)
  const retryCreation = useWorktreeStore((s) => s.retryCreation)
  const cancelCreation = useWorktreeStore((s) => s.cancelCreation)
  const [armingBranch, setArmingBranch] = useState<string | null>(null)
  const [branchError, setBranchError] = useState<string | null>(null)

  useEffect(() => {
    void fetchWorktrees(workspaceId, workspacePath)
    // Unmount (workspace removed) stops the main-side watch for this listing.
    // `list` re-arms it on every mount; external add/remove in between
    // arrives via the global `worktree.onChanged` subscription.
    return () => {
      void window.electron.worktree.unwatch(workspaceId, workspacePath).catch(() => {})
    }
  }, [fetchWorktrees, workspaceId, workspacePath])

  // The main checkout stays visible even when alone so single-worktree
  // workspaces still show their branch/path row; the empty hint covers
  // non-git workspaces instead of hiding the whole section.
  if (worktrees.length === 0 && pendingCreations.length === 0 && preservedBranches.length === 0 && terminals.length > 0) {
    return (
      <div>
        {sortTerminalsByAttention(terminals).map((terminal) => (
          <TerminalRow
            key={terminal.id}
            terminal={terminal}
            focused={isActiveWorkspace && terminal.id === activeTerminalId}
            onDragStart={onTerminalDragStart}
            onSelect={onTerminalSelect}
          />
        ))}
      </div>
    )
  }
  if (worktrees.length === 0 && pendingCreations.length === 0 && preservedBranches.length === 0) {
    return (
      <div>
        <div className="px-3 py-2 font-mono text-[11px] text-[var(--shell-dim)]">{t('common:workspace.terminal.empty')}</div>
      </div>
    )
  }

  const groups = groupTerminalsByWorktree(worktrees, terminals)

  const handleDeleteBranch = async (branch: string) => {
    if (armingBranch !== branch) {
      setArmingBranch(branch)
      setBranchError(null)
      return
    }
    setArmingBranch(null)
    try {
      await deleteBranch(workspaceId, workspacePath, branch, false)
    } catch {
      try {
        await deleteBranch(workspaceId, workspacePath, branch, true)
      } catch (err) {
        setBranchError(err instanceof Error ? err.message : String(err))
      }
    }
  }

  return (
    <div>
      {pendingCreations.map((pending) => (
        <div
          key={pending.id}
          className="mb-0.5 grid w-full grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 rounded-[3px] px-2 py-1.5"
          style={{ color: 'var(--shell-muted)' }}
        >
          <span className="flex h-[18px] w-[18px] items-center justify-center">
            <GitBranch size={14} strokeWidth={1.6} aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-mono text-[11px]">{pending.name}</span>
            <span className="block truncate text-[9px]" style={{ color: pending.error ? 'var(--shell-diff-del)' : 'var(--shell-dim)' }}>
              {pending.error ?? t('terminal:worktree.creating')}
            </span>
          </span>
          {pending.error ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                void (async () => {
                  await retryCreation(workspaceId, workspacePath, pending.id)
                  const scopePath = useWorktreeStore.getState().activePaths[workspaceId] ?? workspacePath
                  if (useWorkspaceStore.getState().activeWorkspaceId === workspaceId) {
                    await refreshScopeFileTree(scopePath, true).catch(() => {})
                  }
                })()
              }}
              className="cursor-pointer"
              style={{ fontSize: 10, color: 'var(--shell-muted)', background: 'none', border: 'none', padding: 0 }}
            >
              {t('terminal:worktree.retry')}
            </button>
          ) : (
            <ThemedTooltip label={t('terminal:worktree.cancel')}>
            <button
              type="button"
              aria-label={t('terminal:worktree.cancel')}
              onClick={(event) => {
                event.stopPropagation()
                void cancelCreation(workspaceId, workspacePath, pending.id)
              }}
              className="cursor-pointer"
              style={{ fontSize: 12, color: 'var(--shell-dim)', background: 'none', border: 'none', padding: '0 2px' }}
            >
              ×
            </button>
            </ThemedTooltip>
          )}
        </div>
      ))}
      {groups.map(({ worktree, terminals: groupTerminals }) => {
        if (!worktree) return null
        const focused = activePath === worktree.path
        return (
          <div key={worktree.id}>
            <ThemedTooltip label={`${worktreeDisplayName(worktree.path, worktree.branch)}${worktree.startFrom ? ` → ${displayBaseRef(worktree.startFrom)}` : ''} · ${worktree.path}`}>
            <div
              role="button"
              tabIndex={0}
              aria-label={worktree.path}
              aria-current={focused && isActiveWorkspace ? 'true' : undefined}
              onClick={(event) => {
                event.stopPropagation()
                // Note: worktree switch rescopes the file tree with a sweep — see .agents/notes/sessions/worktrees/worktree-sidebar-scoping.md
                void switchActiveWorktree(workspaceId, worktree.path)
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                event.stopPropagation()
                void switchActiveWorktree(workspaceId, worktree.path)
              }}
              className={`group/wt ${styles.worktreeRow}`}
            >
              <span className="flex h-[18px] w-[18px] items-center justify-center">
                <GitBranch size={14} strokeWidth={1.6} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className={styles.worktreeName}>
                  {worktreeDisplayName(worktree.path, worktree.branch)}
                </span>
              </span>
              <WorktreeTerminalBadge terminals={groupTerminals} />
              {!worktree.isMain && worktree.branch && (
                <button
                  type="button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    onShipRequest(worktree)
                  }}
                  onKeyDown={(event) => event.stopPropagation()}
                  className={styles.worktreeAction}
                >
                  {t('terminal:worktree.shipAction')}
                </button>
              )}
              {!worktree.isMain && (
                <ThemedTooltip label={t('terminal:worktree.deleteTitle')}>
                <button
                  type="button"
                  aria-label={t('terminal:worktree.deleteTitle')}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    onDeleteRequest(worktree)
                  }}
                  onKeyDown={(event) => event.stopPropagation()}
                  className={styles.worktreeAction}
                >
                  <Ellipsis size={14} strokeWidth={1.8} aria-hidden="true" />
                </button>
                </ThemedTooltip>
              )}
            </div>
            </ThemedTooltip>
            {groupTerminals.length > 0 && (
              <div className={styles.terminalGroup}>
                {sortTerminalsByAttention(groupTerminals).map((terminal) => (
                  <TerminalRow
                    key={terminal.id}
                    terminal={terminal}
                    focused={isActiveWorkspace && terminal.id === activeTerminalId}
                    onDragStart={onTerminalDragStart}
                    onSelect={onTerminalSelect}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
      {terminals.length === 0 && (
        <div className="px-3 py-2 font-mono text-[11px] text-[var(--shell-dim)]">{t('common:workspace.terminal.empty')}</div>
      )}
      {lastKeptBranch && (
        <div style={{ fontSize: 10, color: 'var(--shell-muted)', padding: '4px 8px', lineHeight: 1.6 }}>
          {t('terminal:worktree.branchKept', { branch: lastKeptBranch })}
        </div>
      )}
      {preservedBranches.length > 0 && (
        <div style={{ padding: '2px 8px 4px' }}>
          <div style={{ fontSize: 9.5, color: 'var(--shell-dim)', marginBottom: 3 }}>
            {t('terminal:worktree.preservedTitle')}
          </div>
          {preservedBranches.map((branch) => (
            <div key={branch} className="flex items-center" style={{ gap: 6, padding: '2px 0' }}>
              <span
                className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
                style={{ fontFamily: "'SF Mono', monospace", fontSize: 10, color: 'var(--shell-dim)' }}
              >
                {branch}
              </span>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  void handleDeleteBranch(branch)
                }}
                className="cursor-pointer"
                style={{ fontSize: 10, color: armingBranch === branch ? 'var(--shell-diff-del)' : 'var(--shell-dim)', background: 'none', border: 'none', padding: 0 }}
              >
                {t('terminal:worktree.deleteBranch')}
              </button>
            </div>
          ))}
          {branchError && (
            <div style={{ fontSize: 10, color: 'var(--shell-diff-del)', lineHeight: 1.6 }}>{branchError}</div>
          )}
        </div>
      )}
    </div>
  )
}

export function Sidebar() {
  const { t } = useI18n()
  // P5: useShallow 细粒度订阅，避免整 store 任意变化带动整个侧栏重渲染
  const { workspaces, activeWorkspaceId, terminals, activeTerminalId, terminalSnapshots, setWorkspaces, setActiveWorkspace, addWorkspace, removeWorkspace } =
    useWorkspaceStore(
      useShallow((s) => ({
        workspaces: s.workspaces,
        activeWorkspaceId: s.activeWorkspaceId,
        terminals: s.terminals,
        activeTerminalId: s.activeTerminalId,
        terminalSnapshots: s.terminalSnapshots,
        setWorkspaces: s.setWorkspaces,
        setActiveWorkspace: s.setActiveWorkspace,
        addWorkspace: s.addWorkspace,
        removeWorkspace: s.removeWorkspace,
      }))
    )
  const orderedWorkspaces = useMemo(() => sortWorkspaceSidebar(workspaces), [workspaces])
  useEffect(() => {
    const refresh = () => {
      const path = getActiveScopePath()
      if (!path) return
      invalidateEditorFileCache(path)
      useWorkspaceStore.setState({ fileTree: [], activeFilePath: null })
      void loadWorkspaceFileTree(path, () => getActiveScopePath() === path, { visualTransition: true }).catch(() => {})
    }
    window.addEventListener('janusx:workspace-data-changed', refresh)
    return () => window.removeEventListener('janusx:workspace-data-changed', refresh)
  }, [])
  const setLoadState = useAppStore((s) => s.setLoadState)
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  // 删除确认弹窗主题分支：底座走语义令牌，纸面点睛（硬套印影）走分支，与 ⋯ 菜单同构
  const plancheModal = useThemeStore((s) => s.theme) === 'planche'

  const [deleteTarget, setDeleteTarget] = useState<Workspace | null>(null)
  const [configTarget, setConfigTarget] = useState<Workspace | null>(null)
  const [composerTarget, setComposerTarget] = useState<Workspace | null>(null)
  const [shipTarget, setShipTarget] = useState<{
    workspace: Workspace
    worktree: WorktreeInfo
  } | null>(null)
  const [worktreeDeleteTarget, setWorktreeDeleteTarget] = useState<{
    workspace: Workspace
    worktree: WorktreeInfo
  } | null>(null)
  const [lastKeptBranchByWorkspace, setLastKeptBranchByWorkspace] = useState<Record<string, string>>({})
  const [projectCandidate, setProjectCandidate] = useState<JanusProjectCandidate | null>(null)
  const [expandedWorkspaceIds, setExpandedWorkspaceIds] = useState<string[]>([])
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<string[]>([])
  const [contextMenu, setContextMenu] = useState<WorkspaceContextMenuState | null>(null)
  const [draggedWorkspaceId, setDraggedWorkspaceId] = useState<string | null>(null)
  const [dropIntent, setDropIntent] = useState<WorkspaceDropIntent | null>(null)
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null)
  const [groupNameDraft, setGroupNameDraft] = useState('')
  const suppressClickRef = useRef<string | null>(null)
  const draggedWorkspaceIdRef = useRef<string | null>(null)
  const dropIntentRef = useRef<WorkspaceDropIntent | null>(null)
  const groupHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const groupHoverTargetRef = useRef<string | null>(null)
  const layoutSaveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const skipRenameBlurRef = useRef(false)

  const groupMembersById = useMemo(() => {
    const groups = new Map<string, Workspace[]>()
    for (const workspace of orderedWorkspaces) {
      const id = workspace.sidebarGroup?.id
      if (!id) continue
      const members = groups.get(id) ?? []
      members.push(workspace)
      groups.set(id, members)
    }
    return groups
  }, [orderedWorkspaces])

  useEffect(() => {
    const openCandidate = (event: Event) => {
      const detail = (event as CustomEvent<JanusProjectCandidate>).detail
      const workspace = workspaces.find((item) => item.id === detail?.workspaceId)
      if (!workspace || !detail) return
      setProjectCandidate(detail)
      setConfigTarget(workspace)
    }
    window.addEventListener(JANUS_PROJECT_CANDIDATE_EVENT, openCandidate)
    return () => window.removeEventListener(JANUS_PROJECT_CANDIDATE_EVENT, openCandidate)
  }, [workspaces])

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [contextMenu])

  useEffect(() => () => {
    if (groupHoverTimerRef.current) clearTimeout(groupHoverTimerRef.current)
  }, [])

  const fetchWorktreeIdentity = useWorktreeStore((s) => s.fetchIdentity)
  useEffect(() => {
    for (const workspace of orderedWorkspaces) {
      if (workspace.path) void fetchWorktreeIdentity(workspace.path)
    }
  }, [orderedWorkspaces, fetchWorktreeIdentity])

  // Creation submits close the composer at once; the progress row must be
  // visible, so expand arriving workspaces automatically exactly once.
  const expandRequests = useWorktreeStore((s) => s.expandRequests)
  const expandRequestsRef = useRef<Record<string, number>>({})
  useEffect(() => {
    const seen = expandRequestsRef.current
    let changed = false
    for (const [workspaceId, count] of Object.entries(expandRequests)) {
      if ((seen[workspaceId] ?? 0) < count) {
        changed = true
        setExpandedWorkspaceIds((current) =>
          current.includes(workspaceId) ? current : [...current, workspaceId],
        )
      }
    }
    if (changed) expandRequestsRef.current = { ...expandRequests }
  }, [expandRequests])

  const handleAddWorkspace = useCallback(async () => {
    try {
      const workspace = await chooseAndCreateWorkspace()
      if (!workspace) return
      addWorkspace(workspace)
      setActiveWorkspace(workspace.id)
      setLoadState('no-terminal')
      await loadWorkspaceFileTree(workspace.path, () => getActiveScopePath() === workspace.path, { visualTransition: true }).catch(() => {})
    } catch (err) {
      console.error('Failed to create workspace:', err)
    }
  }, [addWorkspace, setActiveWorkspace, setLoadState])

  const persistWorkspaceLayout = useCallback((nextWorkspaces: Workspace[]) => {
    setWorkspaces(nextWorkspaces)
    layoutSaveQueueRef.current = layoutSaveQueueRef.current
      .then(async () => {
        await Promise.all(nextWorkspaces.map((workspace) => window.electron.workspace.update(workspace.id, {
          sidebarOrder: workspace.sidebarOrder,
          sidebarGroup: workspace.sidebarGroup,
        })))
      })
      .catch((error) => {
        console.error('Failed to persist workspace sidebar layout:', error)
      })
  }, [setWorkspaces])

  const updateWorkspaceLayout = useCallback((
    update: (current: Workspace[]) => Workspace[],
  ): boolean => {
    const current = sortWorkspaceSidebar(useWorkspaceStore.getState().workspaces)
    const next = normalizeWorkspaceSidebarLayout(update(current))
    if (workspaceSidebarLayoutsEqual(current, next)) return false
    persistWorkspaceLayout(next)
    return true
  }, [persistWorkspaceLayout])

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return
    try {
      await window.electron.workspace.delete(deleteTarget.id)
      removeWorkspace(deleteTarget.id)
      updateWorkspaceLayout((current) => current)
      setExpandedWorkspaceIds((current) => current.filter((id) => id !== deleteTarget.id))
      if (workspaces.length <= 1) {
        setLoadState('no-workspace')
        useWorkspaceStore.setState({
          fileTree: [],
          terminals: [],
          activeTerminalId: null,
          paneTree: null,
          focusedPaneId: null,
          focusedTabId: null,
        })
      }
    } catch (err) {
      console.error('Failed to delete workspace:', err)
    }
    setDeleteTarget(null)
  }, [deleteTarget, removeWorkspace, workspaces.length, setLoadState, updateWorkspaceLayout])

  const handleSelect = useCallback(
    async (id: string) => {
      if (suppressClickRef.current === id) {
        suppressClickRef.current = null
        return
      }
      setActiveWorkspace(id)
      // 根据目标工作区是否有终端来设置状态
      const stateAfterSwitch = useWorkspaceStore.getState()
      setLoadState(stateAfterSwitch.terminals.length > 0 ? 'terminal-active' : 'no-terminal')
      // 加载文件树(统一入口,带工作区未再切换的竞态守卫;目标为 worktree scope)
      const ws = workspaces.find((w) => w.id === id)
      if (!ws) return
      const scopePath = getScopePathForWorkspace(id, ws.path)
      invalidateEditorFileCache(scopePath)
      await loadWorkspaceFileTree(scopePath, () => getActiveScopePath() === scopePath, { visualTransition: true }).catch((err) => {
        console.error('Failed to load file tree:', err)
      })
    },
    [setActiveWorkspace, setLoadState, workspaces]
  )

  const handleToggleWorkspaceExpand = useCallback((id: string, event: React.MouseEvent) => {
    event.stopPropagation()
    setExpandedWorkspaceIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    )
  }, [])

  const handleTerminalSelect = useCallback((terminal: Terminal) => {
    const state = useWorkspaceStore.getState()
    const workspace = state.workspaces.find((item) => item.id === terminal.workspaceId)
    if (!workspace) return
    const switchingWorkspace = state.activeWorkspaceId !== workspace.id
    if (switchingWorkspace) state.setActiveWorkspace(workspace.id)
    useWorkspaceStore.getState().setActiveTerminal(terminal.id)
    setLoadState('terminal-active')
    // Resolve scope exactly as the rendered groups do; cwd may be a subdirectory.
    const worktrees = useWorktreeStore.getState().worktreesByWorkspace[workspace.id] ?? EMPTY_WORKTREE_LIST
    const group = groupTerminalsByWorktree(worktrees, [terminal]).find((item) => item.terminals.length > 0)
    const scopePath = group?.worktree?.path ?? getScopePathForWorkspace(workspace.id, workspace.path)
    if (switchingWorkspace) {
      useWorktreeStore.getState().setActivePath(workspace.id, scopePath)
      invalidateEditorFileCache(scopePath)
      void loadWorkspaceFileTree(scopePath, () => getActiveScopePath() === scopePath, { visualTransition: true }).catch(() => {})
    } else {
      void switchActiveWorktree(workspace.id, scopePath)
    }
  }, [setLoadState])

  const handleTerminalPreviewDragStart = useCallback(
    (terminal: Terminal, event: React.DragEvent<HTMLDivElement>) => {
      event.stopPropagation()
      setTerminalDragData(event.dataTransfer, terminal.id)
      event.dataTransfer.setDragImage(event.currentTarget, 12, 12)
    },
    []
  )

  const setDropIntentValue = useCallback((intent: WorkspaceDropIntent | null) => {
    dropIntentRef.current = intent
    setDropIntent(intent)
  }, [])

  const clearGroupHover = useCallback(() => {
    if (groupHoverTimerRef.current) {
      clearTimeout(groupHoverTimerRef.current)
      groupHoverTimerRef.current = null
    }
    groupHoverTargetRef.current = null
  }, [])

  const resetWorkspaceDrag = useCallback(() => {
    clearGroupHover()
    draggedWorkspaceIdRef.current = null
    setDraggedWorkspaceId(null)
    setDropIntentValue(null)
  }, [clearGroupHover, setDropIntentValue])

  const handleWorkspaceDragStart = useCallback((workspace: Workspace, event: React.DragEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button, input')) {
      event.preventDefault()
      return
    }
    clearGroupHover()
    setContextMenu(null)
    draggedWorkspaceIdRef.current = workspace.id
    setDraggedWorkspaceId(workspace.id)
    suppressClickRef.current = workspace.id
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(WORKSPACE_DRAG_TYPE, workspace.id)
    event.dataTransfer.setData('text/plain', workspace.id)
    event.dataTransfer.setDragImage(event.currentTarget, 18, 14)
  }, [clearGroupHover])

  const handleWorkspaceDragOver = useCallback((target: Workspace, event: React.DragEvent<HTMLDivElement>) => {
    const sourceId = draggedWorkspaceIdRef.current || event.dataTransfer.getData(WORKSPACE_DRAG_TYPE)
    if (!sourceId) return
    if (sourceId === target.id) {
      clearGroupHover()
      setDropIntentValue(null)
      return
    }
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'

    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientY - rect.top) / Math.max(rect.height, 1)
    if (ratio < 0.25 || ratio > 0.75) {
      clearGroupHover()
      setDropIntentValue({ mode: ratio < 0.25 ? 'before' : 'after', targetId: target.id })
      return
    }

    const currentIntent = dropIntentRef.current
    if (currentIntent?.targetId === target.id && (currentIntent.mode === 'group-pending' || currentIntent.mode === 'group')) return
    clearGroupHover()
    groupHoverTargetRef.current = target.id
    setDropIntentValue({ mode: 'group-pending', targetId: target.id })
    groupHoverTimerRef.current = setTimeout(() => {
      groupHoverTimerRef.current = null
      if (!draggedWorkspaceIdRef.current || groupHoverTargetRef.current !== target.id) return
      setDropIntentValue({ mode: 'group', targetId: target.id })
    }, GROUP_HOVER_DELAY)
  }, [clearGroupHover, setDropIntentValue])

  const handleGroupDragOver = useCallback((targetId: string, event: React.DragEvent<HTMLDivElement>) => {
    const sourceId = draggedWorkspaceIdRef.current || event.dataTransfer.getData(WORKSPACE_DRAG_TYPE)
    if (!sourceId) return
    if (sourceId === targetId) {
      clearGroupHover()
      setDropIntentValue(null)
      return
    }
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    clearGroupHover()
    setDropIntentValue({ mode: 'group', targetId })
  }, [clearGroupHover, setDropIntentValue])

  const handleBoundaryDragOver = useCallback((boundary: WorkspaceSidebarBoundary, event: React.DragEvent<HTMLDivElement>) => {
    if (!draggedWorkspaceIdRef.current) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    clearGroupHover()
    setDropIntentValue({ mode: boundary, targetId: null })
  }, [clearGroupHover, setDropIntentValue])

  const handleWorkspaceDrop = useCallback((target: Workspace, event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const sourceId = draggedWorkspaceIdRef.current || event.dataTransfer.getData(WORKSPACE_DRAG_TYPE)
    const intent = dropIntentRef.current
    if (!sourceId || sourceId === target.id || !intent || intent.targetId !== target.id) {
      resetWorkspaceDrag()
      return
    }

    if (intent.mode === 'group') {
      const currentTarget = useWorkspaceStore.getState().workspaces.find((workspace) => workspace.id === target.id)
      if (currentTarget) {
        const group = currentTarget.sidebarGroup ?? {
          id: createWorkspaceSidebarGroupId(),
          name: nextWorkspaceSidebarGroupName(useWorkspaceStore.getState().workspaces),
        }
        updateWorkspaceLayout((current) => groupWorkspaceInSidebar(current, sourceId, target.id, group))
        if (!currentTarget.sidebarGroup) {
          setCollapsedGroupIds((current) => current.filter((id) => id !== group.id))
          setGroupNameDraft(group.name)
          setRenamingGroupId(group.id)
        }
      }
      resetWorkspaceDrag()
      return
    }

    const targetRect = event.currentTarget.getBoundingClientRect()
    const position: WorkspaceSidebarDropPosition = intent.mode === 'group-pending'
      ? event.clientY < targetRect.top + targetRect.height / 2
        ? 'before'
        : 'after'
      : intent.mode
    updateWorkspaceLayout((current) => moveWorkspaceInSidebar(current, sourceId, target.id, position))
    resetWorkspaceDrag()
  }, [resetWorkspaceDrag, updateWorkspaceLayout])

  const handleBoundaryDrop = useCallback((boundary: WorkspaceSidebarBoundary, event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const sourceId = draggedWorkspaceIdRef.current || event.dataTransfer.getData(WORKSPACE_DRAG_TYPE)
    if (sourceId) updateWorkspaceLayout((current) => moveWorkspaceToSidebarBoundary(current, sourceId, boundary))
    resetWorkspaceDrag()
  }, [resetWorkspaceDrag, updateWorkspaceLayout])

  const handleWorkspaceDragEnd = useCallback((sourceId: string) => {
    resetWorkspaceDrag()
    window.setTimeout(() => {
      if (suppressClickRef.current === sourceId) suppressClickRef.current = null
    }, 0)
  }, [resetWorkspaceDrag])

  const handleWorkspaceListDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!draggedWorkspaceIdRef.current) return
    const rect = event.currentTarget.getBoundingClientRect()
    const edge = 28
    if (event.clientY < rect.top + edge) event.currentTarget.scrollTop -= 12
    else if (event.clientY > rect.bottom - edge) event.currentTarget.scrollTop += 12
  }, [])

  const openWorkspaceContextMenu = useCallback((workspace: Workspace, x: number, y: number) => {
    resetWorkspaceDrag()
    setContextMenu({ x, y, target: { kind: 'workspace', workspace } })
  }, [resetWorkspaceDrag])

  const handleWorkspaceContextMenu = useCallback((workspace: Workspace, event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    openWorkspaceContextMenu(workspace, event.clientX, event.clientY)
  }, [openWorkspaceContextMenu])

  const handleWorkspaceMenuButtonClick = useCallback((workspace: Workspace, event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    resetWorkspaceDrag()
    setContextMenu((current) =>
      current?.target.kind === 'workspace' && current.target.workspace.id === workspace.id
        ? null
        : { x: rect.right - MENU_WIDTH, y: rect.bottom + 4, target: { kind: 'workspace', workspace } },
    )
  }, [resetWorkspaceDrag])

  const handleWorkspaceKeyDown = useCallback((workspace: Workspace, event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    if (event.shiftKey && event.key === 'F10') {
      event.preventDefault()
      const rect = event.currentTarget.getBoundingClientRect()
      openWorkspaceContextMenu(workspace, rect.left + 18, rect.top + 18)
      return
    }
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    void handleSelect(workspace.id)
  }, [handleSelect, openWorkspaceContextMenu])

  const startRenamingGroup = useCallback((group: WorkspaceSidebarGroup) => {
    setContextMenu(null)
    setCollapsedGroupIds((current) => current.filter((id) => id !== group.id))
    setGroupNameDraft(group.name)
    setRenamingGroupId(group.id)
  }, [])

  const commitGroupRename = useCallback((groupId: string) => {
    if (skipRenameBlurRef.current) {
      skipRenameBlurRef.current = false
      return
    }
    const name = groupNameDraft.trim()
    setRenamingGroupId(null)
    setGroupNameDraft('')
    if (name) updateWorkspaceLayout((current) => renameWorkspaceSidebarGroup(current, groupId, name))
  }, [groupNameDraft, updateWorkspaceLayout])

  const handleGroupNameKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      event.currentTarget.blur()
      return
    }
    if (event.key !== 'Escape') return
    event.preventDefault()
    skipRenameBlurRef.current = true
    setRenamingGroupId(null)
    setGroupNameDraft('')
    event.currentTarget.blur()
  }, [])

  const handleGroupContextMenu = useCallback((group: WorkspaceSidebarGroup, event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    resetWorkspaceDrag()
    setContextMenu({ x: event.clientX, y: event.clientY, target: { kind: 'group', group } })
  }, [resetWorkspaceDrag])

  const handleRunConfiguration = useCallback((workspace: Workspace) => {
    setContextMenu(null)
    setProjectCandidate(null)
    setConfigTarget(workspace)
  }, [])

  const handleCreateWorktree = useCallback((workspace: Workspace) => {
    setContextMenu(null)
    setComposerTarget(workspace)
  }, [])

  const handleRemoveFromGroup = useCallback((workspaceId: string) => {
    setContextMenu(null)
    updateWorkspaceLayout((current) => removeWorkspaceFromSidebarGroup(current, workspaceId))
  }, [updateWorkspaceLayout])

  const handleClearGroup = useCallback((groupId: string) => {
    setContextMenu(null)
    setCollapsedGroupIds((current) => current.filter((id) => id !== groupId))
    updateWorkspaceLayout((current) => clearWorkspaceSidebarGroup(current, groupId))
  }, [updateWorkspaceLayout])

  const handleContextDelete = useCallback((workspace: Workspace) => {
    setContextMenu(null)
    setDeleteTarget(workspace)
  }, [])

  const dropTargetGroupId = dropIntent?.targetId
    ? orderedWorkspaces.find((workspace) => workspace.id === dropIntent.targetId)?.sidebarGroup?.id ?? null
    : null

  return (
    <aside
      className={`workspace-sidebar flex flex-col overflow-hidden ${styles.sidebar}`}
      style={{
        background: 'var(--shell-chrome)',
        borderRight: '1px solid var(--shell-border)',
      }}
      data-collapsed={sidebarCollapsed}
      aria-label={t('common:workspace.ariaLabel')}
    >
      {/* 展开态 */}
      <div id="workspace-sidebar-content" className="workspace-sidebar__expanded" aria-hidden={sidebarCollapsed} {...(sidebarCollapsed ? { inert: '' } : {})}>
          <div
            data-workspace-sidebar-header=""
            className={styles.header}
          >
            <span>{t('common:workspace.label')}</span>
            <div className="flex items-center gap-0.5">
              <ThemedTooltip label={t('common:workspace.add')}>
              <button
                data-onboarding="add-workspace"
                onClick={handleAddWorkspace}
                className="flex h-7 w-7 items-center justify-center rounded-[4px] transition-colors hover:bg-[var(--shell-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1"
                style={{
                  color: 'var(--shell-text)',
                }}
                aria-label={t('common:workspace.add')}
              >
                <Plus size={15} strokeWidth={1.6} aria-hidden="true" />
              </button>
              </ThemedTooltip>
              <ThemedTooltip label={t('common:workspace.collapse')}>
              <button
                onClick={toggleSidebar}
                aria-expanded={!sidebarCollapsed}
                aria-controls="workspace-sidebar-content"
                className="flex h-7 w-7 items-center justify-center rounded-[4px] transition-colors hover:bg-[var(--shell-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1"
                style={{ color: 'var(--shell-text)' }}
                aria-label={t('common:workspace.collapseAria')}
              >
                <PanelLeftClose size={15} strokeWidth={1.6} aria-hidden="true" />
              </button>
              </ThemedTooltip>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-1.5 py-1" onDragOverCapture={handleWorkspaceListDragOver}>
            {orderedWorkspaces.length === 0 ? (
              <div className={styles.emptyState}>
                <p>{t('common:workspace.empty')}</p>
              </div>
            ) : (
              <>
                <div
                  className="relative h-1.5"
                  onDragOver={(event) => handleBoundaryDragOver('start', event)}
                  onDrop={(event) => handleBoundaryDrop('start', event)}
                >
                  {dropIntent?.mode === 'start' && (
                    <div className="pointer-events-none absolute inset-x-1 top-0 h-0.5 rounded bg-[#ff7830] shadow-[0_0_7px_rgba(255,120,48,0.7)]" />
                  )}
                </div>
                {orderedWorkspaces.map((ws, workspaceIndex) => {
                  const isActive = ws.id === activeWorkspaceId
                  const group = ws.sidebarGroup
                  const isGroupStart = !!group && orderedWorkspaces[workspaceIndex - 1]?.sidebarGroup?.id !== group.id
                  const isGroupCollapsed = !!group && collapsedGroupIds.includes(group.id)
                  if (group && isGroupCollapsed && !isGroupStart) return null
                  const groupMembers = group ? groupMembersById.get(group.id) ?? [ws] : []
                  const workspaceTerminals = (isActive ? terminals : terminalSnapshots[ws.id]?.terminals ?? []).filter(
                    (terminal) => terminal.workspaceId === ws.id
                  )
                const isExpanded = expandedWorkspaceIds.includes(ws.id)
                const terminalCount = workspaceTerminals.length
                  const isMenuOpen = contextMenu?.target.kind === 'workspace' && contextMenu.target.workspace.id === ws.id
                  const isDragged = draggedWorkspaceId === ws.id
                  const isDropBefore = dropIntent?.targetId === ws.id && dropIntent.mode === 'before'
                  const isDropAfter = dropIntent?.targetId === ws.id && dropIntent.mode === 'after'
                  const isGroupPending = dropIntent?.targetId === ws.id && dropIntent.mode === 'group-pending'
                  const isGroupTarget = dropIntent?.targetId === ws.id && dropIntent.mode === 'group'
                  const isHeaderGroupTarget = !!group && dropIntent?.mode === 'group' && dropTargetGroupId === group.id
                  const hasActiveGroupMember = groupMembers.some((member) => member.id === activeWorkspaceId)

                  return (
                    <div key={ws.id}>
                      {isGroupStart && (
                        <div
                          className="group/group-header mx-1 mb-0.5 mt-1 flex h-7 items-center gap-1 rounded px-1.5 text-[11px] transition-colors"
                          style={{
                            color: hasActiveGroupMember ? 'var(--shell-text)' : 'var(--shell-dim)',
                            background: isHeaderGroupTarget ? 'var(--shell-accent-soft)' : 'transparent',
                            boxShadow: isHeaderGroupTarget ? 'inset 0 0 0 1px var(--shell-accent-border)' : 'none',
                          }}
                          onContextMenu={(event) => handleGroupContextMenu(group, event)}
                          onDragOver={(event) => handleGroupDragOver(groupMembers[0]!.id, event)}
                          onDrop={(event) => handleWorkspaceDrop(groupMembers[0]!, event)}
                        >
                          <button
                            type="button"
                            draggable={false}
                            aria-label={isGroupCollapsed ? t('common:workspace.groupExpand', { name: group.name }) : t('common:workspace.groupCollapse', { name: group.name })}
                            onDragStart={(event) => event.preventDefault()}
                            onClick={() => setCollapsedGroupIds((current) => current.includes(group.id)
                              ? current.filter((id) => id !== group.id)
                              : [...current, group.id])}
                            className="flex h-5 w-4 shrink-0 items-center justify-center border-0 bg-transparent text-[var(--shell-dim)] transition-colors hover:text-[var(--shell-muted)]"
                          >
                            <span
                              className="h-1.5 w-1.5 border-b border-r border-current transition-transform"
                              style={{ transform: isGroupCollapsed ? 'rotate(-45deg)' : 'rotate(45deg)' }}
                            />
                          </button>
                          {renamingGroupId === group.id ? (
                            <input
                              autoFocus
                              value={groupNameDraft}
                              onFocus={(event) => event.currentTarget.select()}
                              onChange={(event) => setGroupNameDraft(event.target.value)}
                              onKeyDown={handleGroupNameKeyDown}
                              onBlur={() => commitGroupRename(group.id)}
                              onClick={(event) => event.stopPropagation()}
                              className="min-w-0 flex-1 rounded-sm border border-[rgba(255,120,48,0.35)] bg-[rgba(0,0,0,0.28)] px-1.5 py-0.5 text-[11px] text-[var(--shell-text)] outline-none"
                              aria-label={t('common:workspace.groupNameAria')}
                            />
                          ) : (
                            <ThemedTooltip label={t('common:workspace.groupCountTitle', { name: group.name, count: groupMembers.length })}>
                            <button
                              type="button"
                              draggable={false}
                              onDragStart={(event) => event.preventDefault()}
                              onClick={() => setCollapsedGroupIds((current) => current.includes(group.id)
                                ? current.filter((id) => id !== group.id)
                                : [...current, group.id])}
                              className="min-w-0 flex-1 truncate border-0 bg-transparent text-left"
                            >
                              {group.name}
                            </button>
                            </ThemedTooltip>
                          )}
                          {isGroupCollapsed && hasActiveGroupMember && (
                            <span className="h-1.5 w-1.5 rounded-full bg-[#ff7830] shadow-[0_0_5px_rgba(255,120,48,0.65)]" />
                          )}
                          <span className="font-mono text-[9px] text-[var(--shell-dim)]">{groupMembers.length}</span>
                        </div>
                      )}

                      {!isGroupCollapsed && (
                        <div className={`relative mb-px${group ? ' ml-2 pl-1.5' : ''}`}>
                          {group && (
                            <div className="pointer-events-none absolute bottom-0 left-0 top-0 w-px bg-[rgba(255,255,255,0.075)]" />
                          )}
                          <ThemedTooltip label={t('common:workspace.wsTitle', { prefix: group ? `${group.name} · ` : '', name: ws.name })}>
                          <div
                            draggable
                            tabIndex={0}
                            role="button"
                            aria-current={isActive ? 'true' : undefined}
                            aria-label={t('common:workspace.wsAriaLabel', { name: ws.name })}
                            onClick={() => handleSelect(ws.id)}
                            onKeyDown={(event) => handleWorkspaceKeyDown(ws, event)}
                            onDragStart={(event) => handleWorkspaceDragStart(ws, event)}
                            onDragOver={(event) => handleWorkspaceDragOver(ws, event)}
                            onDrop={(event) => handleWorkspaceDrop(ws, event)}
                            onDragEnd={() => handleWorkspaceDragEnd(ws.id)}
                            className={`ws group/ws ${styles.workspaceRow}`}
                            style={{
                              color: isActive ? 'var(--shell-text)' : 'var(--shell-muted)',
                              background: isGroupTarget
                                ? 'var(--shell-accent-soft)'
                                : isGroupPending
                                  ? 'var(--shell-hover)'
                                  : isActive
                                    ? 'var(--shell-active)'
                                    : undefined,
                              opacity: isDragged ? 0.42 : 1,
                              boxShadow: isGroupTarget
                                ? 'inset 0 0 0 1px rgba(255,120,48,0.48), 0 0 12px rgba(255,120,48,0.08)'
                                : isGroupPending
                                  ? 'inset 0 0 0 1px rgba(255,255,255,0.07)'
                                  : 'none',
                            }}
                          >
                            {isDropBefore && (
                              <div className="pointer-events-none absolute -top-px inset-x-1 h-0.5 rounded bg-[#ff7830] shadow-[0_0_7px_rgba(255,120,48,0.7)]" />
                            )}
                            {isDropAfter && (
                              <div className="pointer-events-none absolute -bottom-px inset-x-1 h-0.5 rounded bg-[#ff7830] shadow-[0_0_7px_rgba(255,120,48,0.7)]" />
                            )}
                      <ThemedTooltip label={isExpanded ? t('common:workspace.terminalListCollapseShort', { count: terminalCount }) : t('common:workspace.terminalListExpandShort', { count: terminalCount })}>
                      <button
                        type="button"
                        draggable={false}
                        aria-label={isExpanded ? t('common:workspace.terminalListCollapse', { name: ws.name, count: terminalCount }) : t('common:workspace.terminalListExpand', { name: ws.name, count: terminalCount })}
                        onPointerDown={(event) => event.stopPropagation()}
                        onDragStart={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                        }}
                        onClick={(event) => {
                          event.stopPropagation()
                          handleToggleWorkspaceExpand(ws.id, event)
                        }}
                        className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-[3px] border-0 bg-transparent text-[var(--shell-dim)] transition-colors duration-150 hover:bg-[var(--shell-hover)] hover:text-[var(--shell-muted)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[rgba(255,120,48,0.24)]"
                      >
                        <ChevronRight
                          size={12}
                          strokeWidth={1.8}
                          className="transition-transform duration-200 ease-out motion-reduce:transition-none"
                          style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
                          aria-hidden="true"
                        />
                      </button>
                      </ThemedTooltip>
                      <RepoRowIcon workspacePath={ws.path} />
                      <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-medium">
                        {ws.name}
                      </span>
                      {ws.runtime && ws.runtime.kind !== 'windows' && <span
                        data-runtime-kind={ws.runtime.kind}
                        title={ws.runtime.kind === 'wsl' ? ws.runtime.distro : ws.runtime.host}
                        className="shrink-0 text-[9px] font-mono"
                        style={{ color: 'var(--shell-muted)' }}
                      >{ws.runtime.kind.toUpperCase()}</span>}
                      <ThemedTooltip label={t('common:workspace.moreActions')}>
                      <button
                        type="button"
                        draggable={false}
                        aria-label={t('common:workspace.moreActions')}
                        aria-expanded={isMenuOpen}
                        onPointerDown={(event) => event.stopPropagation()}
                        onDragStart={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                        }}
                        onClick={(event) => handleWorkspaceMenuButtonClick(ws, event)}
                        className={styles.menuButton}
                      >
                        <Ellipsis size={14} strokeWidth={1.8} aria-hidden="true" />
                      </button>
                      </ThemedTooltip>
                    </div>
                    </ThemedTooltip>
                    <div
                      className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
                        isExpanded ? 'grid-rows-[1fr] opacity-100' : 'pointer-events-none grid-rows-[0fr] opacity-0'
                      }`}
                      aria-hidden={!isExpanded}
                    >
                      <div className="min-h-0 overflow-hidden">
                        <div
                          className={styles.workspaceChildren}
                        >
                        <WorktreeSubList
                          workspaceId={ws.id}
                          workspacePath={ws.path}
                          lastKeptBranch={lastKeptBranchByWorkspace[ws.id] ?? null}
                          terminals={workspaceTerminals}
                          activeTerminalId={activeTerminalId}
                          isActiveWorkspace={isActive}
                          onDeleteRequest={(worktree) => setWorktreeDeleteTarget({ workspace: ws, worktree })}
                          onShipRequest={(worktree) => setShipTarget({ workspace: ws, worktree })}
                          onTerminalDragStart={handleTerminalPreviewDragStart}
                          onTerminalSelect={handleTerminalSelect}
                        />
                        </div>
                        </div>
                      </div>
                    </div>
                      )}
                    </div>
                  )
                })}
                <div
                  className="relative h-2"
                  onDragOver={(event) => handleBoundaryDragOver('end', event)}
                  onDrop={(event) => handleBoundaryDrop('end', event)}
                >
                  {dropIntent?.mode === 'end' && (
                    <div className="pointer-events-none absolute inset-x-1 bottom-0 h-0.5 rounded bg-[#ff7830] shadow-[0_0_7px_rgba(255,120,48,0.7)]" />
                  )}
                </div>
              </>
            )}
          </div>
          {/* 左下角只留团队卡（ToB M2 pinned footer）；远控已搬到 StatusBar 胶囊 + 独立弹窗 */}
          <TeamFooter />
      </div>

      {/* 收起态 */}
      <div className="workspace-sidebar__collapsed flex flex-1 flex-col items-center gap-1 overflow-hidden py-1.5" aria-hidden={!sidebarCollapsed} {...(!sidebarCollapsed ? { inert: '' } : {})}>
          <ThemedTooltip label={t('common:workspace.expand')}>
          <button
            onClick={toggleSidebar}
            className="mb-1 flex h-9 w-9 items-center justify-center rounded-[4px] transition-colors hover:bg-[var(--shell-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1"
            style={{ color: 'var(--shell-dim)' }}
            aria-label={t('common:workspace.expandAria')}
            aria-expanded={false}
            aria-controls="workspace-sidebar-content"
          >
            <PanelLeftOpen size={15} strokeWidth={1.6} aria-hidden="true" />
          </button>
          </ThemedTooltip>
          <div
            className="w-5 h-px my-1"
            style={{ background: 'rgba(255, 255, 255, 0.06)' }}
          />
          {orderedWorkspaces.map((ws, workspaceIndex) => {
            const isActive = ws.id === activeWorkspaceId
            const isGroupStart = !!ws.sidebarGroup && orderedWorkspaces[workspaceIndex - 1]?.sidebarGroup?.id !== ws.sidebarGroup.id
            const isDragged = draggedWorkspaceId === ws.id
            const isDropBefore = dropIntent?.targetId === ws.id && dropIntent.mode === 'before'
            const isDropAfter = dropIntent?.targetId === ws.id && dropIntent.mode === 'after'
            const isGroupPending = dropIntent?.targetId === ws.id && dropIntent.mode === 'group-pending'
            const isGroupTarget = dropIntent?.targetId === ws.id && dropIntent.mode === 'group'
            const collapsedTerminals = (isActive ? terminals : terminalSnapshots[ws.id]?.terminals ?? []).filter(
              (terminal) => terminal.workspaceId === ws.id,
            )
            const collapsedActivity = summarizeTerminalActivity(collapsedTerminals)
            const collapsedDotColor =
              collapsedActivity.errors > 0 ? '#ff6666'
              : collapsedActivity.needsAction > 0 ? '#f0a35e'
              : collapsedActivity.running > 0 ? '#58c98d'
              : null

            return (
              <ThemedTooltip
                key={ws.id}
                label={t('common:workspace.wsTitle', { prefix: ws.sidebarGroup ? `${ws.sidebarGroup.name} · ` : '', name: ws.name })}
              >
              <div
                draggable
                tabIndex={0}
                role="button"
                aria-current={isActive ? 'true' : undefined}
                onClick={() => handleSelect(ws.id)}
                onKeyDown={(event) => handleWorkspaceKeyDown(ws, event)}
                onContextMenu={(event) => handleWorkspaceContextMenu(ws, event)}
                onDragStart={(event) => handleWorkspaceDragStart(ws, event)}
                onDragOver={(event) => handleWorkspaceDragOver(ws, event)}
                onDrop={(event) => handleWorkspaceDrop(ws, event)}
                onDragEnd={() => handleWorkspaceDragEnd(ws.id)}
                className="ws relative flex h-9 w-9 cursor-grab items-center justify-center rounded-[4px] transition-colors active:cursor-grabbing focus:outline-none focus-visible:ring-1 focus-visible:ring-[rgba(255,120,48,0.38)]"
                style={{
                  marginTop: isGroupStart && workspaceIndex > 0 ? 5 : 0,
                  background: isGroupTarget
                    ? 'var(--shell-accent-soft)'
                    : isGroupPending
                      ? 'var(--shell-hover)'
                      : isActive
                        ? 'var(--shell-active)'
                        : 'transparent',
                  opacity: isDragged ? 0.42 : 1,
                  boxShadow: isGroupTarget
                    ? 'inset 0 0 0 1px rgba(255,120,48,0.45)'
                    : isGroupPending
                      ? 'inset 0 0 0 1px rgba(255,255,255,0.07)'
                      : 'none',
                }}
              >
                {isDropBefore && (
                  <div className="pointer-events-none absolute -top-px inset-x-0 h-0.5 rounded bg-[#ff7830]" />
                )}
                {isDropAfter && (
                  <div className="pointer-events-none absolute -bottom-px inset-x-0 h-0.5 rounded bg-[#ff7830]" />
                )}
                <span
                  className="font-mono text-[13px] font-semibold"
                  style={{ color: isActive ? 'var(--shell-text)' : 'var(--shell-dim)' }}
                >
                  {workspaceInitial(ws.name)}
                </span>
                {collapsedDotColor && (
                  <span
                    className={collapsedActivity.needsAction > 0 ? 'term-status-pulse absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full' : 'absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full'}
                    style={{ background: collapsedDotColor }}
                  />
                )}
              </div>
              </ThemedTooltip>
            )
          })}
          {/* ToB M2 收起态：组织首字母 + 本人头像 */}
          <TeamFooterCollapsed />
      </div>
      {contextMenu && (
        <WorkspaceContextMenu
          menu={contextMenu}
          onRunConfiguration={handleRunConfiguration}
          onCreateWorktree={handleCreateWorktree}
          onRenameGroup={startRenamingGroup}
          onRemoveFromGroup={handleRemoveFromGroup}
          onClearGroup={handleClearGroup}
          onDelete={handleContextDelete}
          onRelocate={workspace => {
            setContextMenu(null)
            void window.electron.workspaceStorage?.data().then(async items => {
              const item = items.find(item => item.workspaceIds.includes(workspace.id))
              if (item) await relocateWorkspaceData(item, t('storage:maintenance.mismatch'), t('storage:maintenance.addNew'), t('storage:maintenance.cancel'))
            }).catch(error => { void window.electron.dialog.showMessageBox({ message: String(error), buttons: ['OK'] }) })
          }}
        />
      )}
      {composerTarget && (
        <WorktreeComposer workspace={composerTarget} onClose={() => setComposerTarget(null)} />
      )}
      {shipTarget && (
        <WorktreeShipDialog
          workspaceId={shipTarget.workspace.id}
          workspacePath={shipTarget.workspace.path}
          worktree={shipTarget.worktree}
          onClose={() => setShipTarget(null)}
        />
      )}
      {worktreeDeleteTarget && (
        <WorktreeDeleteDialog
          workspaceId={worktreeDeleteTarget.workspace.id}
          workspacePath={worktreeDeleteTarget.workspace.path}
          worktree={worktreeDeleteTarget.worktree}
          onClose={(branchKept) => {
            if (branchKept) {
              setLastKeptBranchByWorkspace((current) => ({
                ...current,
                [worktreeDeleteTarget.workspace.id]: branchKept,
              }))
            }
            setWorktreeDeleteTarget(null)
          }}
        />
      )}
      {/* 删除确认弹窗 — portal 到 body 级别，居窗口中央。
          遮罩沿用共享 scrim（rgba(8,8,10,0.62)+blur，与 ModalFrame/新建任务盘一致，纸面不翻淡）；
          面板底座/描边/分隔线一律走语义令牌，纸面点睛走 plancheModal 硬套印影。 */}
      {deleteTarget && createPortal(
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{
            background: 'rgba(8,8,10,0.62)',
            backdropFilter: 'blur(10px)',
            zIndex: 1000,
          }}
        >
          <div
            className="overflow-hidden"
            style={{
              width: 380,
              background: 'var(--shell-chrome)',
              border: '1px solid var(--shell-accent-border)',
              borderRadius: 8,
              boxShadow: plancheModal
                ? '3px 3px 0 #E8A08A'
                : '0 20px 50px rgba(0,0,0,0.8)',
              animation: 'island-expand-modal 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
            }}
          >
            {/* Header */}
            <div
              className="flex justify-between items-center"
              style={{
                padding: '12px 16px',
                borderBottom: '1px solid var(--control-border)',
              }}
            >
              <div
                className="font-semibold flex items-center"
                style={{ fontSize: 13, color: 'var(--shell-text)', gap: 6 }}
              >
                <span style={{ color: 'var(--shell-diff-del)' }}>&#9888;</span>
                {t('common:workspace.delete.title')}
              </div>
              <ModalCloseButton onClose={() => setDeleteTarget(null)} />
            </div>

            {/* Body */}
            <div style={{ padding: '16px 16px 20px' }}>
              <div style={{ fontSize: 12, color: 'var(--shell-muted)', marginBottom: 14, lineHeight: 1.6 }}>
                {t('common:workspace.delete.confirm', { name: deleteTarget.name })}
              </div>

              <div
                style={{
                  padding: '8px 10px',
                  background: 'var(--shell-accent-soft)',
                  border: '1px solid var(--shell-accent-border)',
                  borderRadius: 4,
                  fontSize: 11,
                  color: 'var(--shell-muted)',
                  lineHeight: 1.5,
                }}
              >
                <span style={{ color: 'var(--shell-diff-del)', marginRight: 4 }}>&#8226;</span>
                {t('common:workspace.delete.checkpointWarning')}
              </div>
            </div>

            {/* Footer */}
            <div
              className="flex justify-end"
              style={{
                padding: '10px 16px',
                borderTop: '1px solid var(--control-border)',
                gap: 8,
              }}
            >
              <button
                onClick={() => setDeleteTarget(null)}
                className="rounded cursor-pointer transition-colors tbtn-ghost"
                style={{
                  height: 28,
                  padding: '0 14px',
                  fontSize: 11,
                  background: 'transparent',
                  border: '1px solid var(--control-border)',
                  color: 'var(--shell-muted)',
                }}
              >
                {t('common:action.cancel')}
              </button>
              <button
                onClick={confirmDelete}
                className="rounded cursor-pointer transition-colors tbtn-danger"
                style={{
                  height: 28,
                  padding: '0 14px',
                  fontSize: 11,
                  background: 'var(--shell-accent-soft)',
                  border: '1px solid var(--shell-accent-border)',
                  color: 'var(--shell-diff-del)',
                }}
              >
                {t('common:action.delete')}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
      {/* 工作区启动配置弹窗 */}
      {configTarget && (
        <ModalFrame
          label={t('common:workspace.launcherTitle')}
          onClose={() => { setConfigTarget(null); setProjectCandidate(null) }}
          panelClassName="ws-config-modal"
        >
          {({ requestClose }) => (
            <>
              {/* Header：分体顶栏卡；关闭按钮通过共享样式排列在右侧 */}
              <div className="ws-config-head">
                <ModalCloseButton onClose={requestClose} />
                <div
                  className="font-semibold flex items-center"
                  style={{ fontSize: 13, color: 'var(--shell-text)', gap: 8 }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" strokeWidth="2" style={{ stroke: 'var(--shell-text)' }}>
                    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                  </svg>
                  <span>{t('common:workspace.launcherTitle')}</span>
                </div>
              </div>
              {/* Body：min-height:0 让 flex:1 能收缩到模态内高，避免内容把 body 撑出弹窗 */}
              <div style={{ padding: '0', overflow: 'visible', flex: 1, minHeight: 0 }}>
                <ProjectLauncher
                  projectPath={projectCandidate?.projectPath ?? configTarget.path}
                  workspaceId={configTarget.id}
                  workspaceRoot={configTarget.path}
                  projectRelativePath={projectCandidate?.relativePath ?? ''}
                  candidateConfig={projectCandidate?.config ?? null}
                />
              </div>
            </>
          )}
        </ModalFrame>
      )}
      {!sidebarCollapsed && <WorkspaceUnavailableNotice />}
    </aside>
  )
}
