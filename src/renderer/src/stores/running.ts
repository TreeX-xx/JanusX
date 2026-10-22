// Note: one run indicator per workspace; worktree groups live inside its panel — see .agents/notes/workbench/run-orb-budding.md
import { create } from 'zustand'
import type { RunningProjectSummary } from '../../../shared/ipc/project'

export interface WorkspaceRef {
  id: string
  name: string
  path: string
}

/** 一个 worktree 作用域下的运行集合（worktree 根或工作区根）。 */
export interface ScopeRunInfo {
  scopePath: string
  branch?: string
  projects: RunningProjectSummary[]
  startedAt: number | null
}

export interface WorkspaceRunInfo {
  workspaceId: string
  workspaceName: string
  workspacePath: string
  /** 按启动先后排序的 worktree 作用域（单作用域时长度为 1）。 */
  scopes: ScopeRunInfo[]
  /** 扁平兼容视图（scopes 内进程的并集）。 */
  projects: RunningProjectSummary[]
  startedAt: number | null
}

export const ORPHAN_WORKSPACE_ID = '__orphan__'

/** 作用域路径的规范键：git 斜杠/原生分隔符、大小写、尾斜杠归一后合并同目录。 */
export function scopeKey(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** 从 runner id `${projectPath}::${configName}::${ts}` 还原启动目录（旧数据兜底）。 */
export function projectPathFromRunId(id: string): string {
  return id.split('::', 1)[0] ?? id
}

/**
 * groupByWorkspace — projectService.list() 全量按工作区 → worktree 作用域两级分组
 *
 * 工作区归属优先取启动时盖章的 `workspaceId`；未盖章的旧数据按 runner id
 * 前缀 `${workspacePath}::` 最长匹配（/a/app 与 /a/app2 按 path.length 降序）。
 * 作用域归属取盖章 `scopePath`，缺省回退 id 前缀路径；查不到工作区的进程
 * 归入 `__orphan__`，不丢球。
 */
export function groupByWorkspace(
  all: RunningProjectSummary[],
  workspaces: WorkspaceRef[],
): Record<string, WorkspaceRunInfo> {
  const sorted = [...workspaces].sort((a, b) => b.path.length - a.path.length)
  const grouped = new Map<string, WorkspaceRunInfo>()
  const scopesByWorkspace = new Map<string, Map<string, ScopeRunInfo>>()

  const ensure = (workspaceId: string, workspaceName: string, workspacePath: string): WorkspaceRunInfo => {
    const existing = grouped.get(workspaceId)
    if (existing) return existing
    const created: WorkspaceRunInfo = {
      workspaceId,
      workspaceName,
      workspacePath,
      scopes: [],
      projects: [],
      startedAt: null,
    }
    grouped.set(workspaceId, created)
    scopesByWorkspace.set(workspaceId, new Map())
    return created
  }

  const touchTime = (target: { startedAt: number | null }, project: RunningProjectSummary): void => {
    const timestamp = Date.parse(project.startTime)
    if (Number.isFinite(timestamp)) {
      target.startedAt = target.startedAt === null ? timestamp : Math.min(target.startedAt, timestamp)
    }
  }

  for (const project of all) {
    const stamped = project.workspaceId
      ? workspaces.find((workspace) => workspace.id === project.workspaceId)
      : undefined
    const match = stamped ?? sorted.find((workspace) => project.id.startsWith(`${workspace.path}::`))
    const info = match
      ? ensure(match.id, match.name, match.path)
      : ensure(ORPHAN_WORKSPACE_ID, '未知归属', '')

    const scopePath = project.scopePath || projectPathFromRunId(project.id)
    const key = scopeKey(scopePath)
    const scopeMap = scopesByWorkspace.get(info.workspaceId)!
    let scope = scopeMap.get(key)
    if (!scope) {
      scope = { scopePath, projects: [], startedAt: null }
      scopeMap.set(key, scope)
    }
    if (!scope.branch && project.branch) scope.branch = project.branch
    scope.projects.push(project)
    touchTime(scope, project)

    info.projects.push(project)
    touchTime(info, project)
  }

  for (const [workspaceId, scopeMap] of scopesByWorkspace) {
    const info = grouped.get(workspaceId)
    if (!info) continue
    info.scopes = [...scopeMap.values()].sort((a, b) => {
      if (a.startedAt === null && b.startedAt === null) return a.scopePath.localeCompare(b.scopePath)
      if (a.startedAt === null) return 1
      if (b.startedAt === null) return -1
      return a.startedAt - b.startedAt
    })
  }

  return Object.fromEntries(grouped)
}

/** 按 startedAt 先后排序，保证球序稳定不跳 */
export function sortWorkspaceRunInfos(infos: WorkspaceRunInfo[]): WorkspaceRunInfo[] {
  return [...infos].sort((a, b) => {
    if (a.startedAt === null && b.startedAt === null) return a.workspaceId.localeCompare(b.workspaceId)
    if (a.startedAt === null) return 1
    if (b.startedAt === null) return -1
    if (a.startedAt !== b.startedAt) return a.startedAt - b.startedAt
    return a.workspaceId.localeCompare(b.workspaceId)
  })
}

interface RunningStore {
  runningByWorkspace: Record<string, WorkspaceRunInfo>
  updatedAt: number
  /** 按住确认中的工作区（stopping 灰化态），key=workspaceId，value=开始时间戳 */
  stoppingByWorkspace: Record<string, number>
  /** 按住确认中的 worktree 作用域（scope 停止灰化态），key=scopeKey(scopePath) */
  stoppingByScope: Record<string, number>
  /** 已运行又长按时的确认脉冲计数，组件据此播 orb-nudge 动画 */
  pulseByWorkspace: Record<string, number>
  setFromGrouped: (next: Record<string, WorkspaceRunInfo>) => void
  markStopping: (workspaceId: string) => void
  clearStopping: (workspaceId: string) => void
  markStoppingScope: (scopePath: string) => void
  clearStoppingScope: (scopePath: string) => void
  pulse: (workspaceId: string) => void
  removeWorkspace: (workspaceId: string) => void
  resetForTests: () => void
}

export const useRunningStore = create<RunningStore>((set) => ({
  runningByWorkspace: {},
  updatedAt: 0,
  stoppingByWorkspace: {},
  stoppingByScope: {},
  pulseByWorkspace: {},

  setFromGrouped: (next) => set((state) => {
    // stopping 超时回弹：对应工作区/作用域已从轮询消失则清掉 stopping（正常消失路径）
    const stoppingByWorkspace = { ...state.stoppingByWorkspace }
    for (const workspaceId of Object.keys(stoppingByWorkspace)) {
      if (!next[workspaceId]) delete stoppingByWorkspace[workspaceId]
    }
    const liveScopes = new Set(
      Object.values(next).flatMap((info) => info.scopes.map((scope) => scopeKey(scope.scopePath))),
    )
    const stoppingByScope = { ...state.stoppingByScope }
    for (const key of Object.keys(stoppingByScope)) {
      if (!liveScopes.has(key)) delete stoppingByScope[key]
    }
    return { runningByWorkspace: next, updatedAt: Date.now(), stoppingByWorkspace, stoppingByScope }
  }),

  markStopping: (workspaceId) => set((state) => ({
    stoppingByWorkspace: { ...state.stoppingByWorkspace, [workspaceId]: Date.now() },
  })),

  clearStopping: (workspaceId) => set((state) => {
    if (!(workspaceId in state.stoppingByWorkspace)) return {}
    const stoppingByWorkspace = { ...state.stoppingByWorkspace }
    delete stoppingByWorkspace[workspaceId]
    return { stoppingByWorkspace }
  }),

  markStoppingScope: (scopePath) => set((state) => ({
    stoppingByScope: { ...state.stoppingByScope, [scopeKey(scopePath)]: Date.now() },
  })),

  clearStoppingScope: (scopePath) => set((state) => {
    const key = scopeKey(scopePath)
    if (!(key in state.stoppingByScope)) return {}
    const stoppingByScope = { ...state.stoppingByScope }
    delete stoppingByScope[key]
    return { stoppingByScope }
  }),

  pulse: (workspaceId) => set((state) => ({
    pulseByWorkspace: { ...state.pulseByWorkspace, [workspaceId]: (state.pulseByWorkspace[workspaceId] ?? 0) + 1 },
  })),

  removeWorkspace: (workspaceId) => set((state) => {
    if (!(workspaceId in state.runningByWorkspace) && !(workspaceId in state.stoppingByWorkspace)) return {}
    const runningByWorkspace = { ...state.runningByWorkspace }
    const stoppingByWorkspace = { ...state.stoppingByWorkspace }
    delete runningByWorkspace[workspaceId]
    delete stoppingByWorkspace[workspaceId]
    return { runningByWorkspace, stoppingByWorkspace, updatedAt: Date.now() }
  }),

  resetForTests: () => set({
    runningByWorkspace: {},
    updatedAt: 0,
    stoppingByWorkspace: {},
    stoppingByScope: {},
    pulseByWorkspace: {},
  }),
}))

export const selectIsWorkspaceRunning = (workspaceId: string | null | undefined) => (state: RunningStore): boolean =>
  !!workspaceId && !!state.runningByWorkspace[workspaceId]

/** 该 worktree 作用域是否已有运行进程（长按启动前的幂等判定）。 */
export function isScopeRunning(workspaceId: string | null | undefined, scopePath: string | null | undefined): boolean {
  if (!workspaceId || !scopePath) return false
  const info = useRunningStore.getState().runningByWorkspace[workspaceId]
  if (!info) return false
  const key = scopeKey(scopePath)
  return info.scopes.some((scope) => scopeKey(scope.scopePath) === key)
}

/** 本体长按已运行时发出的确认脉冲（RunOrb 监听 pulse 播 orb-nudge 动画） */
export function nudgeRunOrb(workspaceId: string): void {
  useRunningStore.getState().pulse(workspaceId)
}
