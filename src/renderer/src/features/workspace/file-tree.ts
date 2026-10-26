/**
 * @file 文件树纯函数与操作原语
 * @description
 *  文件树的路径工具、树结构变换、搜索过滤与删除流程,
 *  供 FileExplorerTool / Sidebar / workspace actions 共用,不依赖 React。
 */

import type { FileNode } from '@/types'
import { parseRuntimeResource, runtimeResource } from '../../../../shared/workspace-runtime'

export interface FileTreeOperationResult {
  success?: boolean
  error?: string
  path?: string
}

export function getParentPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const index = normalized.lastIndexOf('/')
  return index === -1 ? '' : normalized.slice(0, index)
}

export function getAbsolutePath(workspacePath: string, relativePath: string): string {
  if (!relativePath) return workspacePath
  const resource = parseRuntimeResource(workspacePath)
  if (resource) return runtimeResource(resource.workspaceId, `${resource.path.replace(/\/+$/, '')}/${relativePath}`)
  const separator = workspacePath.includes('\\') ? '\\' : '/'
  return `${workspacePath.replace(/[\\/]+$/, '')}${separator}${relativePath.split('/').join(separator)}`
}

export function isPathInScope(path: string, scope: string): boolean {
  if (!scope) return path.length > 0
  return path === scope || path.startsWith(`${scope}/`)
}

/** 把 oldPrefix 下的路径映射到 newPrefix 下;不在范围内的原样返回 */
export function remapPath(path: string, oldPrefix: string, newPrefix: string): string {
  if (path === oldPrefix) return newPrefix
  if (path.startsWith(`${oldPrefix}/`)) return `${newPrefix}${path.slice(oldPrefix.length)}`
  return path
}

export function isValidEntryName(name: string): boolean {
  return Boolean(name) && name !== '.' && name !== '..' && !/[/\\]/.test(name)
}

export function injectDirectoryChildren(nodes: FileNode[], path: string, children: FileNode[]): FileNode[] {
  return nodes.map((node) => {
    if (node.path === path && node.type === 'directory') {
      return {
        ...node,
        children,
        loaded: true,
        hasChildren: children.length > 0,
      }
    }
    if (!node.children?.length) return node
    return { ...node, children: injectDirectoryChildren(node.children, path, children) }
  })
}

/** 收集树中所有已加载(loaded)目录的路径,用于全量刷新时同步重拉这些分支 */
export function collectLoadedDirectoryPaths(nodes: FileNode[]): string[] {
  const paths: string[] = []
  const walk = (list: FileNode[]): void => {
    for (const node of list) {
      if (node.type !== 'directory') continue
      if (node.loaded) paths.push(node.path)
      if (node.children?.length) walk(node.children)
    }
  }
  walk(nodes)
  return paths
}

/** 把重新拉取的子目录内容按路径挂回树上;childrenByPath 未覆盖的分支保持原状 */
export function applyLoadedChildren(nodes: FileNode[], childrenByPath: Map<string, FileNode[]>): FileNode[] {
  return nodes.map((node) => {
    if (node.type !== 'directory') return node
    const children = childrenByPath.get(node.path)
    if (!children) return node
    const merged = applyLoadedChildren(children, childrenByPath)
    return { ...node, children: merged, loaded: true, hasChildren: merged.length > 0 }
  })
}

export interface FileTreeFilterResult {
  nodes: FileNode[]
  /** 含有匹配后代、应强制展开的目录路径 */
  expandedDirs: Set<string>
}

function nodeMatchesQuery(node: FileNode, lowered: string): boolean {
  return node.name.toLowerCase().includes(lowered) || node.path.toLowerCase().includes(lowered)
}

/** 按名称或相对路径过滤已加载的树:保留匹配项与含匹配后代的目录分支 */
export function filterFileTree(nodes: FileNode[], query: string): FileTreeFilterResult {
  const expandedDirs = new Set<string>()
  const lowered = query.toLowerCase()

  const filter = (list: FileNode[]): FileNode[] => {
    const kept: FileNode[] = []
    for (const node of list) {
      const selfMatches = nodeMatchesQuery(node, lowered)
      if (node.type === 'directory') {
        const children = node.children?.length ? filter(node.children) : []
        if (children.length > 0) {
          expandedDirs.add(node.path)
          kept.push({ ...node, children })
        } else if (selfMatches) {
          // 目录本身命中:保留原始 children,允许继续展开/搜索加载
          kept.push(node)
        }
      } else if (selfMatches) {
        kept.push(node)
      }
    }
    return kept
  }

  return { nodes: filter(nodes), expandedDirs }
}

/**
 * 搜索时挑选可继续加载的目录路径(未 loaded),避免整仓扫爆。
 * 仅:根层未加载目录、当前已展开未加载目录、名称/路径命中的未加载目录。
 */
export function collectDirectoryPathsToSearchLoad(
  nodes: FileNode[],
  query: string,
  limit = 40,
  expandedPaths?: ReadonlySet<string>,
): string[] {
  const trimmed = query.trim()
  if (!trimmed || limit <= 0) return []

  const lowered = trimmed.toLowerCase()
  const paths: string[] = []
  const seen = new Set<string>()

  const push = (path: string): boolean => {
    if (seen.has(path)) return paths.length < limit
    seen.add(path)
    paths.push(path)
    return paths.length < limit
  }

  const walk = (list: FileNode[], isRootLevel: boolean): boolean => {
    for (const node of list) {
      if (paths.length >= limit) return false
      if (node.type !== 'directory') continue

      const selfMatches = nodeMatchesQuery(node, lowered)
      const isExpanded = expandedPaths?.has(node.path) === true
      if (!node.loaded && (isRootLevel || isExpanded || selfMatches)) {
        if (!push(node.path)) return false
      }

      if (node.children?.length) {
        if (!walk(node.children, false)) return false
      }
    }
    return paths.length < limit
  }

  walk(nodes, true)
  return paths
}

/** 丢弃树上已不存在(或不再是目录)的展开路径 */
export function pruneExpandedPaths(expanded: Set<string>, tree: FileNode[]): Set<string> {
  if (expanded.size === 0) return expanded

  const directoryPaths = new Set<string>()
  const walk = (list: FileNode[]): void => {
    for (const node of list) {
      if (node.type !== 'directory') continue
      directoryPaths.add(node.path)
      if (node.children?.length) walk(node.children)
    }
  }
  walk(tree)

  let changed = false
  const next = new Set<string>()
  for (const path of expanded) {
    if (directoryPaths.has(path)) next.add(path)
    else changed = true
  }
  return changed ? next : expanded
}

export interface PendingFileTreeDelete {
  workspacePath: string
  targetPath: string
  targetName: string
  parentPath: string
}

export interface FileTreeDeleteActions {
  deleteTarget: (workspacePath: string, targetPath: string) => Promise<FileTreeOperationResult | null>
  isWorkspaceActive: (workspacePath: string) => boolean
  reloadDirectory: (parentPath: string, workspacePath: string) => Promise<void>
  onDeleted: (targetPath: string) => void
}

export function createPendingFileTreeDelete(
  workspacePath: string,
  target: { path: string; name: string },
): PendingFileTreeDelete {
  return {
    workspacePath,
    targetPath: target.path,
    targetName: target.name,
    parentPath: getParentPath(target.path),
  }
}

export async function executeFileTreeDelete(
  request: PendingFileTreeDelete,
  actions: FileTreeDeleteActions,
): Promise<boolean> {
  const result = await actions.deleteTarget(request.workspacePath, request.targetPath)
  if (!result) return false
  if (!actions.isWorkspaceActive(request.workspacePath)) return true

  actions.onDeleted(request.targetPath)
  await actions.reloadDirectory(request.parentPath, request.workspacePath)
  return true
}
