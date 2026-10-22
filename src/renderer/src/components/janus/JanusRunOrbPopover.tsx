import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '@/i18n/useI18n'
import { useWorkspaceStore } from '@/stores/workspace'
import { projectService } from '@/services/project'
import { scopeKey, useRunningStore, type ScopeRunInfo, type WorkspaceRunInfo } from '@/stores/running'
import { EMPTY_WORKTREE_LIST, sameScopePath, useWorktreeStore } from '@/stores/worktree'
import { resolveScopeBranch, startScope, stopScopeProjects, stopWorkspaceProjects } from './useProjectRunning'
import { formatOrbUptime } from './JanusRunOrb'

const OUTPUT_PREVIEW_CHARS = 120
const ARM_TIMEOUT_MS = 3000

function truncateLine(line: string): string {
  const cleaned = line.replace(/\x1b\[[0-9;]*m/g, '').trim()
  return cleaned.length > OUTPUT_PREVIEW_CHARS ? `${cleaned.slice(0, OUTPUT_PREVIEW_CHARS)}…` : cleaned
}

export interface StoppedWorkspaceSnapshot {
  workspaceId: string
  workspaceName: string
  workspacePath: string
  /** 停止前的作用域（重启目标）；缺省回落 workspacePath。 */
  scopePath?: string
  branch?: string
}

interface JanusRunOrbPopoverProps {
  /** null = 该工作区已无运行进程（停止成功后的空态，可一键重启） */
  info: WorkspaceRunInfo | null
  stopping: boolean
  stoppedSnapshot?: StoppedWorkspaceSnapshot | null
  /** 指定作用域定位（scope 头高亮） */
  focusScopePath?: string | null
  onClose: () => void
}

/** scope 头标签：分支优先（与侧栏 worktree 行同规则），主盘补标记，路径只进 tooltip */
function scopeLabel(scope: Pick<ScopeRunInfo, 'scopePath' | 'branch'>, workspacePath: string, mainLabel: string): string {
  const branch = scope.branch || scope.scopePath.split(/[\\/]/).filter(Boolean).pop() || '?'
  return sameScopePath(scope.scopePath, workspacePath) ? `${branch}（${mainLabel}）` : branch
}

/**
 * JanusRunOrbPopover — 运行球轻面板（不停靠展开态 auxiliary）
 *
 * 关闭面板（×/点外/Esc）只关视图；停止走分级摩擦：
 * 停止全部、单 worktree、单进程均使用面板内显式点击与二次确认。
 * 多 worktree 运行按作用域分组展示；空闲 worktree 可从「可启动」区直接启动。
 */
export function JanusRunOrbPopover({ info, stopping, stoppedSnapshot = null, focusScopePath = null, onClose }: JanusRunOrbPopoverProps) {
  const { t } = useI18n('janus')
  const [outputByProject, setOutputByProject] = useState<Record<string, string>>({})
  const [armedProjectId, setArmedProjectId] = useState<string | null>(null)
  const [armedScopePath, setArmedScopePath] = useState<string | null>(null)
  const [armedAll, setArmedAll] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [restarting, setRestarting] = useState(false)
  const [startingScope, setStartingScope] = useState<string | null>(null)
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (armTimerRef.current) clearTimeout(armTimerRef.current)
  }, [])

  const workspaceId = info?.workspaceId ?? stoppedSnapshot?.workspaceId ?? ''
  const workspacePath = info?.workspacePath ?? stoppedSnapshot?.workspacePath ?? ''
  const projectIds = info?.projects.map((p) => p.id).join(',') ?? ''
  const stoppingByScope = useRunningStore((s) => s.stoppingByScope)

  // 空闲 worktree 启动行需要该工作区的 worktree 列表（未展开过侧栏时按需拉取）
  const worktrees = useWorktreeStore((s) => (workspaceId ? (s.worktreesByWorkspace[workspaceId] ?? EMPTY_WORKTREE_LIST) : EMPTY_WORKTREE_LIST))
  useEffect(() => {
    if (!workspaceId || !workspacePath || worktrees.length > 0) return
    void useWorktreeStore.getState().fetchWorktrees(workspaceId, workspacePath).catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, workspacePath])

  const idleWorktrees = useMemo(() => {
    const runningScopes = info?.scopes ?? []
    return worktrees.filter(
      (entry) => !runningScopes.some((scope) => sameScopePath(scope.scopePath, entry.path)),
    )
  }, [worktrees, info])

  // 端口冲突：同一面板内重复端口两行都标记（只警示不自动改端口）
  const conflictedPorts = useMemo(() => {
    const seen = new Map<number, number>()
    for (const project of info?.projects ?? []) {
      if (typeof project.port === 'number' && project.port > 0) {
        seen.set(project.port, (seen.get(project.port) ?? 0) + 1)
      }
    }
    return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([port]) => port))
  }, [info])

  // 懒查每进程最后一行输出（面板打开/进程集合变化时）
  useEffect(() => {
    if (!info) return
    let cancelled = false
    setActionError(null)
    void (async () => {
      const entries = await Promise.all(
        info.projects.map(async (project) => {
          try {
            const detail = await projectService.get(project.id)
            const lines = detail.output.map(truncateLine).filter(Boolean)
            return [project.id, lines[lines.length - 1] ?? ''] as const
          } catch {
            return [project.id, ''] as const
          }
        }),
      )
      if (!cancelled) {
        setOutputByProject(Object.fromEntries(entries))
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, projectIds])

  const armStopOne = (projectId: string) => {
    if (armTimerRef.current) clearTimeout(armTimerRef.current)
    setArmedProjectId(projectId)
    armTimerRef.current = setTimeout(() => setArmedProjectId(null), ARM_TIMEOUT_MS)
  }

  const armStopScope = (scopePath: string) => {
    if (armTimerRef.current) clearTimeout(armTimerRef.current)
    setArmedScopePath(scopePath)
    armTimerRef.current = setTimeout(() => setArmedScopePath(null), ARM_TIMEOUT_MS)
  }

  const confirmStopOne = async (projectId: string) => {
    if (armTimerRef.current) clearTimeout(armTimerRef.current)
    setArmedProjectId(null)
    try {
      await projectService.stop(projectId)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }

  const confirmStopScope = async (scopePath: string) => {
    if (armTimerRef.current) clearTimeout(armTimerRef.current)
    setArmedScopePath(null)
    const ok = await stopScopeProjects(scopePath)
    if (!ok) setActionError(t('janus:island.runOrb.stopping'))
  }

  const handleStopAll = () => {
    if (!info) return
    if (!armedAll) {
      setArmedAll(true)
      return
    }
    setArmedAll(false)
    setActionError(null)
    void stopWorkspaceProjects(info.workspaceId, info.workspacePath).then((ok) => {
      if (!ok) setActionError(t('janus:island.runOrb.stopping'))
    })
  }

  const handleStartScope = async (scopePath: string) => {
    if (!workspaceId || !workspacePath) return
    setStartingScope(scopePath)
    setActionError(null)
    try {
      const ok = await startScope({
        workspaceId,
        workspacePath,
        scopePath,
        branch: resolveScopeBranch(workspaceId, scopePath),
      })
      if (!ok) setActionError(t('janus:island.runOrb.noConfig'))
    } finally {
      setStartingScope(null)
    }
  }

  const handleRestart = async () => {
    const scopePath = stoppedSnapshot?.scopePath ?? workspacePath
    if (!scopePath || !workspaceId || !workspacePath) return
    setRestarting(true)
    setActionError(null)
    try {
      const ok = await startScope({
        workspaceId,
        workspacePath,
        scopePath,
        branch: stoppedSnapshot?.branch ?? resolveScopeBranch(workspaceId, scopePath),
      })
      if (!ok) setActionError(t('janus:island.runOrb.noConfig'))
    } finally {
      setRestarting(false)
    }
  }

  const handleSwitch = () => {
    if (!info) return
    useWorkspaceStore.getState().setActiveWorkspace(info.workspaceId)
    onClose()
  }

  // 已停止空态：球已随轮询消失，面板保留重启入口
  if (!info) {
    return (
      <div className="janus-run-orb-popover" role="dialog" aria-label={stoppedSnapshot?.workspaceName ?? ''}>
        <div className="janus-run-orb-popover-empty">
          <span>{t('janus:island.runOrb.stoppedEmpty')}</span>
          {stoppedSnapshot && <small>{stoppedSnapshot.workspaceName}</small>}
        </div>
        {actionError && <div className="janus-run-orb-popover-error" role="alert">{actionError}</div>}
        <div className="janus-run-orb-popover-footer">
          <button type="button" className="janus-run-orb-btn" disabled={restarting} onClick={() => void handleRestart()}>
            {t('janus:island.runOrb.restartDev')}
          </button>
          <button type="button" className="janus-run-orb-btn janus-run-orb-btn--ghost" onClick={onClose}>
            {t('janus:island.runOrb.panelClose')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="janus-run-orb-popover" role="dialog" aria-label={info.workspaceName}>
      <header className="janus-run-orb-popover-header">
        <strong>{info.workspaceName}</strong>
        <button
          type="button"
          className="janus-run-orb-popover-close"
          aria-label={t('janus:island.runOrb.panelClose')}
          title={t('janus:island.runOrb.panelClose')}
          onClick={onClose}
        >
          ×
        </button>
      </header>

      {actionError && <div className="janus-run-orb-popover-error" role="alert">{actionError}</div>}

      {info.scopes.map((scope) => {
        const isFocus = focusScopePath != null && scopeKey(scope.scopePath) === scopeKey(focusScopePath)
        const scopeStopping = stoppingByScope[scopeKey(scope.scopePath)] != null
        const armedScope = armedScopePath != null && sameScopePath(armedScopePath, scope.scopePath)
        return (
          <section key={scopeKey(scope.scopePath)} className={`janus-run-orb-scope${isFocus ? ' is-focus' : ''}`}>
            <div className="janus-run-orb-scope-head" title={scope.scopePath}>
              <span className="janus-run-orb-scope-label">
                {scopeLabel(scope, info.workspacePath, t('janus:island.runOrb.mainCheckout'))}
              </span>
              <span className="janus-run-orb-scope-meta">
                {t('janus:island.runOrb.scopeMeta', { count: scope.projects.length })}
              </span>
              {armedScope ? (
                <span className="janus-run-orb-arm">
                  <small>{t('janus:island.runOrb.scopeStopConfirm')}</small>
                  <button type="button" className="janus-run-orb-btn janus-run-orb-btn--danger" onClick={() => void confirmStopScope(scope.scopePath)}>
                    {t('janus:island.runOrb.stopOne')}
                  </button>
                  <button type="button" className="janus-run-orb-btn janus-run-orb-btn--ghost" onClick={() => setArmedScopePath(null)}>
                    {t('janus:island.runOrb.cancel')}
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="janus-run-orb-stop-one"
                  title={scopeStopping ? t('janus:island.runOrb.scopeStopping') : t('janus:island.runOrb.scopeStopConfirm')}
                  aria-label={t('janus:island.runOrb.scopeStopConfirm')}
                  disabled={scopeStopping}
                  onClick={() => armStopScope(scope.scopePath)}
                >
                  ⊘
                </button>
              )}
            </div>
            <ul className="janus-run-orb-process-list">
              {scope.projects.map((project) => {
                const armed = armedProjectId === project.id
                const portConflict = typeof project.port === 'number' && conflictedPorts.has(project.port)
                return (
                  <li key={project.id} className="janus-run-orb-process">
                    <div className="janus-run-orb-process-main">
                      <span className="janus-run-orb-process-name">{project.name}</span>
                      <span className="janus-run-orb-process-meta">
                        PID {project.pid}
                        {typeof project.port === 'number' && project.port > 0 ? ` · :${project.port}` : ''}
                        {portConflict ? ` · ⚠ ${t('janus:island.runOrb.portConflict')}` : ''}
                        {` · ${formatOrbUptime(project.uptime)}`}
                      </span>
                      <span className="janus-run-orb-process-output">
                        {outputByProject[project.id] || t('janus:island.runOrb.outputEmpty')}
                      </span>
                    </div>
                    {armed ? (
                      <span className="janus-run-orb-arm">
                        <small>{t('janus:island.runOrb.stopOneConfirm')}</small>
                        <button type="button" className="janus-run-orb-btn janus-run-orb-btn--danger" onClick={() => void confirmStopOne(project.id)}>
                          {t('janus:island.runOrb.stopOne')}
                        </button>
                        <button type="button" className="janus-run-orb-btn janus-run-orb-btn--ghost" onClick={() => setArmedProjectId(null)}>
                          {t('janus:island.runOrb.cancel')}
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="janus-run-orb-stop-one"
                        title={t('janus:island.runOrb.stopOneConfirm')}
                        aria-label={t('janus:island.runOrb.stopOneConfirm')}
                        onClick={() => armStopOne(project.id)}
                      >
                        ⊘
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
      {idleWorktrees.length > 0 && (
        <section className="janus-run-orb-scope">
          <div className="janus-run-orb-scope-head">
            <span className="janus-run-orb-scope-label">{t('janus:island.runOrb.idleTitle')}</span>
          </div>
          <ul className="janus-run-orb-process-list">
            {idleWorktrees.map((entry) => (
              <li key={entry.id} className="janus-run-orb-process" title={entry.path}>
                <div className="janus-run-orb-process-main">
                  <span className="janus-run-orb-process-name">
                    {scopeLabel({ scopePath: entry.path, branch: entry.branch ?? undefined }, info.workspacePath, t('janus:island.runOrb.mainCheckout'))}
                  </span>
                  <span className="janus-run-orb-process-meta">
                    {entry.path.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() ?? entry.path}
                  </span>
                </div>
                <button
                  type="button"
                  className="janus-run-orb-btn"
                  disabled={startingScope != null}
                  onClick={() => void handleStartScope(entry.path)}
                >
                  {startingScope && sameScopePath(startingScope, entry.path)
                    ? t('janus:island.runOrb.starting')
                    : t('janus:island.runOrb.startScope')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="janus-run-orb-popover-footer">
        <button type="button" className="janus-run-orb-btn" onClick={handleSwitch}>
          {t('janus:island.runOrb.switchTo')}
        </button>
        <button
          type="button"
          title={t('janus:island.runOrb.stopAllConfirm')}
          disabled={stopping}
          className="janus-run-orb-btn janus-run-orb-btn--danger"
          onClick={handleStopAll}
          onBlur={() => setArmedAll(false)}
        >
          {stopping ? t('janus:island.runOrb.stopping') : t(armedAll ? 'janus:island.runOrb.stopAllConfirm' : 'janus:island.runOrb.stopAll')}
        </button>
      </div>
    </div>
  )
}
