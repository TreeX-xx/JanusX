import { useEffect, useMemo } from 'react'
import { useAppStore } from '@/stores/app'
import { selectIsWorkspaceRunning, useRunningStore } from '@/stores/running'
import { sameScopePath, useWorktreeStore } from '@/stores/worktree'
import { projectService } from '@/services/project'
import type { Workspace } from '@/types'

export interface ScopeRunTarget {
  workspaceId: string
  /** 工作区根：配置继承来源与停止归属。 */
  workspacePath: string
  /** 启动目标（worktree 路径；主盘即 workspacePath）。 */
  scopePath: string
  branch?: string | null
  configName?: string
}

/** 从 worktree 列表解析目标分支（启动时快照，供运行面板展示）。 */
export function resolveScopeBranch(workspaceId: string, scopePath: string): string | undefined {
  const worktrees = useWorktreeStore.getState().worktreesByWorkspace[workspaceId] ?? []
  return worktrees.find((entry) => sameScopePath(entry.path, scopePath))?.branch ?? undefined
}

/**
 * 按 worktree 作用域启动：配置读目标目录，缺失时继承工作区根模板
 * （命令仍在目标目录执行，继承配置的 cwd 越界由 runner 拒绝）。
 */
export async function startScope(target: ScopeRunTarget): Promise<boolean> {
  try {
    const config =
      (await projectService.readConfig(target.scopePath)) ??
      (target.scopePath === target.workspacePath ? null : await projectService.readConfig(target.workspacePath))
    const defaultConfig = config?.configurations.find((item) => item.name === 'dev')
      ?? config?.configurations[0]
    if (!defaultConfig) return false
    return await projectService.start(target.scopePath, target.configName ?? defaultConfig.name, {
      identity: {
        workspaceId: target.workspaceId,
        scopePath: target.scopePath,
        ...(target.branch ? { branch: target.branch } : {}),
      },
      inheritFrom: target.workspacePath,
    })
  } catch (error) {
    console.error('Failed to start scope project:', error)
    return false
  }
}

/** 停止整个工作区的全部进程（运行球上的显式操作调用，乐观进入 stopping） */
export async function stopWorkspaceProjects(workspaceId: string, workspacePath: string): Promise<boolean> {
  useRunningStore.getState().markStopping(workspaceId)
  try {
    const all = await projectService.list()
    const running = all.filter(project => project.workspaceId
      ? project.workspaceId === workspaceId
      : project.id.startsWith(`${workspacePath}::`))
    await Promise.all(running.map((project) => projectService.stop(project.id)))
    return true
  } catch (error) {
    console.error('Failed to stop workspace projects:', error)
    useRunningStore.getState().clearStopping(workspaceId)
    return false
  }
}

/** 停止单个 worktree 作用域的全部进程（面板 scope 头）。 */
export async function stopScopeProjects(scopePath: string): Promise<boolean> {
  useRunningStore.getState().markStoppingScope(scopePath)
  try {
    const all = await projectService.list()
    const inScope = all.filter(
      (project) => project.scopePath
        ? sameScopePath(project.scopePath, scopePath)
        : project.id.startsWith(`${scopePath}::`),
    )
    await Promise.all(inScope.map((project) => projectService.stop(project.id)))
    return true
  } catch (error) {
    console.error('Failed to stop scope projects:', error)
    useRunningStore.getState().clearStoppingScope(scopePath)
    return false
  }
}

/**
 * useProjectRunning — 当前工作区的运行派生 + 启停 API
 *
 * P0 后不再自己轮询：运行真相来自 useGlobalRunning 写入的 useRunningStore，
 * 此处只做 activeWorkspace 派生（兼容 app.janusRunning/runningProjects 旧读者）
 * 启动使用顶栏按钮，停止使用运行面板内的显式操作。
 * 启动目标为触发时的当前 worktree（activePaths 快照），不是工作区根。
 */
export function useProjectRunning(activeWorkspace: Workspace | undefined) {
  // 注意：selector 必须返回 store 内的稳定引用（禁止内联 ?? [] 等新建引用，
  // 否则 getSnapshot 每次返回新引用导致无限重渲染）。派生数组用 useMemo。
  const activeWorkspaceId = activeWorkspace?.id
  const janusRunning = useRunningStore(selectIsWorkspaceRunning(activeWorkspaceId))
  const activeInfo = useRunningStore((state) =>
    activeWorkspaceId ? state.runningByWorkspace[activeWorkspaceId] : undefined,
  )
  const activeProjects = useMemo(() => activeInfo?.projects ?? [], [activeInfo])
  const setJanusRunning = useAppStore((state) => state.setJanusRunning)
  const setRunningProjects = useAppStore((state) => state.setRunningProjects)

  // 兼容旧读者：把派生结果镜像到 app store（ProjectSettings 自查，不依赖此处）
  useEffect(() => {
    setJanusRunning(janusRunning)
  }, [janusRunning, setJanusRunning])
  useEffect(() => {
    setRunningProjects(activeProjects)
  }, [activeProjects, setRunningProjects])

  return { janusRunning }
}
