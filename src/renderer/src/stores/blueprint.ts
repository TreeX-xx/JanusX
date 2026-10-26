/**
 * @file Blueprint Store — 蓝图数据状态管理
 * @description
 *  V2 工作区投影底座：只在工作区之间切换，不读取 legacy JSON 蓝图。
 *  `workspaceStates` 保留每个注册工作区的蓝图状态；`blueprintWorkspace`
 *  记录每个投影所属的 checkout 路径，后续 load 经同一路径回源，保证读写
 *  同一工作区。内容变更走对话 + Agent 事务，本 store 不再持有任何直写入口。
 * 仿照 stores/git.ts 的 async + loading/error 风格。
 */

import { create } from 'zustand'
import type { NoteSourceRead } from '../../../shared/notes'
import { sameCheckoutPath } from '@/features/blueprint/resolveNodeWorkspace'
import {
  loadBlueprint,
  focusNode as focusNodeIPC,
  type Blueprint,
  type BlueprintNode
} from '@/services/blueprint'
import { useWorkspaceStore } from '@/stores/workspace'
import { useBlueprintReviewStore } from './blueprint-review'
import { readBlueprintWhenReady } from '@/services/blueprint-loading'
import { isBlueprintBusy } from '../../../../plugins/blueprint/src/shared/blueprint-loading'
import type { HarnessInitPreview, HarnessWorkspaceStatus } from '../../../shared/ipc/harness'

export type BlueprintWorkspaceState = HarnessWorkspaceStatus & { workspacePath: string }

const PROJECT_GRAPH_PREFIX = 'harness:project:'

export interface ActiveBlueprintSession {
  blueprintId: string
  nodeId: string
  workspaceId: string
  workspaceName: string
  workspacePath: string
  startedAt: string
  nodeSnapshot: BlueprintNode
}

interface BlueprintStore {
  initializationReceipts: Record<string, HarnessInitPreview>
  selectedWorkspaceId: string | null
  workspaceStates: Record<string, BlueprintWorkspaceState>
  refreshWorkspaceStates: () => Promise<void>
  loadWorkspace: (workspaceId: string | null) => Promise<void>
  switchWorkspace: (workspaceId: string) => Promise<void>
  draftRequest: { workspaceId: string; id: number } | null
  requestDraft: (workspaceId: string) => void
  /** 当前打开的投影（含 nodes 树） */
  currentBlueprint: Blueprint | null
  /** 投影 id -> 所属 checkout 路径；回源加载与 overlay 写回共用 */
  blueprintWorkspace: Record<string, string>
  /** 当前通过“开始工作”激活的节点协作会话 */
  activeSession: ActiveBlueprintSession | null
  loading: boolean
  loadingBlueprintId: string | null
  /** Increments on every completed blueprint load so views can replay entry motion. */
  loadEpoch: number
  loadState: 'idle' | 'listing' | 'loading' | 'refreshing' | 'waiting' | 'error'
  error: string | null

  /** 加载指定投影；非 project id 直接拒绝，不发 IPC */
  loadBlueprint: (id: string) => Promise<void>
  /** 查询投影所属 checkout 路径（布局持久化等 overlay 写回共用） */
  workspacePathFor: (blueprintId: string) => string | null
  /** 激活节点协作会话，不创建终端，不注入上下文 */
  focusNode: (input: {
    blueprintId: string
    nodeId: string
    workspaceId: string
    workspaceName: string
    workspacePath: string
  }) => Promise<BlueprintNode | null>
  applyNoteSource: (root: string, source: NoteSourceRead) => void
  mergeCanvasLayout: (blueprintId: string, canvasLayout: Blueprint['canvasLayout']) => void
  /** 分析完成后，重新拉取 currentBlueprint 以同步 analyzer 写入的字段 */
  refreshAfterAnalysis: () => Promise<void>
}

export const useBlueprintStore = create<BlueprintStore>((set, get) => {
  // Note: selection belongs to workspaces even without a projection — see .agents/notes/blueprint/workspaces/requirements/blueprint-empty-init.md
  let workspaceRequestId = 0
  let statusRequestId = 0
  let loadRequestId = 0
  const blueprintRequests = new Map<string, Promise<void>>()
  let workspaceRequest: { id: string; path: string; promise: Promise<void>; controller: AbortController } | undefined
  let blueprintController: AbortController | undefined

  return {
  initializationReceipts: {},
  selectedWorkspaceId: null,
  workspaceStates: {},
  draftRequest: null,
  requestDraft: (workspaceId) => set({ draftRequest: { workspaceId, id: Date.now() } }),
  refreshWorkspaceStates: async () => {
    const request = ++statusRequestId
    const initial = get().workspaceStates
    const workspaces = useWorkspaceStore.getState().workspaces
    const entries = await Promise.all(workspaces.map(async (workspace): Promise<[string, BlueprintWorkspaceState | undefined]> => {
      try {
        const status = await window.electron.harness.workspaceStatus(workspace.path)
        if (status.state === 'error' && status.diagnostics.length && status.diagnostics.every(isBlueprintBusy)) return [workspace.id, undefined]
        return [workspace.id, { ...status, workspacePath: workspace.path }] as const
      } catch (error) {
        if (isBlueprintBusy(error)) return [workspace.id, undefined]
        return [workspace.id, { state: 'error' as const, root: workspace.path, workspacePath: workspace.path, noteCount: 0,
          diagnostics: [{ code: 'IO_ERROR', message: errorMessage(error) }] }] as const
      }
    }))
    if (request !== statusRequestId) return
    set(state => ({ workspaceStates: Object.fromEntries(entries.flatMap(([id, result]) => {
      const next = state.workspaceStates[id] && (state.workspaceStates[id] !== initial[id] || !result) ? state.workspaceStates[id] : result
      return next ? [[id, next]] : []
    })) }))
  },
  switchWorkspace: async (workspaceId) => {
    if (!useWorkspaceStore.getState().workspaces.some(workspace => workspace.id === workspaceId)) return
    useWorkspaceStore.getState().setActiveWorkspace(workspaceId)
    await get().loadWorkspace(workspaceId)
  },
  loadWorkspace: async (workspaceId) => {
    const workspace = useWorkspaceStore.getState().workspaces.find(item => item.id === workspaceId)
    if (workspace && workspaceRequest?.id === workspace.id && workspaceRequest.path === workspace.path) return workspaceRequest.promise
    workspaceRequest?.controller.abort()
    workspaceRequest = undefined
    blueprintController?.abort()
    const request = ++workspaceRequestId
    ++loadRequestId
    blueprintRequests.clear()
    const switching = !workspace || get().selectedWorkspaceId !== workspace.id
      || get().workspaceStates[workspace.id]?.workspacePath !== workspace.path
    set({ selectedWorkspaceId: workspace?.id ?? null,
      ...(switching ? { currentBlueprint: null, activeSession: null, draftRequest: null } : {}),
      error: null, loading: !!workspace, loadingBlueprintId: null, loadState: workspace ? 'loading' : 'idle' })
    if (!workspace) return
    // Prime counts and lists alongside the canvas, before the user opens the blueprint.
    if (switching || !useBlueprintReviewStore.getState().views[workspace.path]) void useBlueprintReviewStore.getState().refresh(workspace.path)
    const controller = new AbortController()
    const promise = (async () => { try {
      const status = await readBlueprintWhenReady(async () => {
        const status = await window.electron.harness.workspaceStatus(workspace.path)
        if (status.state === 'error' && status.diagnostics.length && status.diagnostics.every(isBlueprintBusy)) throw status.diagnostics[0]
        return status
      }, controller.signal, () => { if (request === workspaceRequestId) set({ loadState: 'waiting' }) })
      if (request !== workspaceRequestId) return
      set(state => ({ workspaceStates: { ...state.workspaceStates, [workspace.id]: { ...status, workspacePath: workspace.path } } }))
      if (status.projectId && ['ok', 'empty', 'invalid'].includes(status.state)) {
        set(state => ({ blueprintWorkspace: { ...state.blueprintWorkspace, [status.projectId!]: workspace.path } }))
        await get().loadBlueprint(status.projectId)
        if (request !== workspaceRequestId) return
        if (get().error) set(state => ({ workspaceStates: { ...state.workspaceStates,
          [workspace.id]: { ...status, workspacePath: workspace.path, state: 'error', diagnostics: [{ code: 'IO_ERROR', message: state.error! }] } } }))
      } else set({ ...(status.state === 'error' ? { error: status.diagnostics.map(item => item.message).join('\n') } : { currentBlueprint: null }),
        loading: false, loadState: status.state === 'error' ? 'error' : 'idle' })
    } catch (error) {
      if (request !== workspaceRequestId || controller.signal.aborted) return
      set(state => ({ loading: false, loadState: 'error', error: errorMessage(error), workspaceStates: { ...state.workspaceStates,
        [workspace.id]: { root: workspace.path, workspacePath: workspace.path, state: 'error', noteCount: 0,
          diagnostics: [{ code: 'IO_ERROR', message: errorMessage(error) }] } } }))
    } finally {
      if (request === workspaceRequestId) workspaceRequest = undefined
    } })()
    workspaceRequest = { id: workspace.id, path: workspace.path, promise, controller }
    return promise
  },
  currentBlueprint: null,
  blueprintWorkspace: {},
  activeSession: null,
  loading: false,
  loadingBlueprintId: null,
  loadEpoch: 0,
  loadState: 'idle',
  error: null,

  loadBlueprint: async (id) => {
    if (!id.startsWith(PROJECT_GRAPH_PREFIX)) {
      set({ error: '仅支持工作区图谱，旧蓝图数据不再读取', loading: false })
      return
    }
    const requestKey = `${workspaceRequestId}:${id}`
    const existingRequest = blueprintRequests.get(requestKey)
    if (existingRequest) return existingRequest
    const workspaceState = useWorkspaceStore.getState()
    const cwd = get().blueprintWorkspace[id]
      ?? workspaceState.workspaces.find((w) => w.id === workspaceState.activeWorkspaceId)?.path
      ?? null
    if (!cwd) {
      set({ error: '找不到该图谱所属的工作区', loading: false })
      return
    }
    const requestId = ++loadRequestId
    blueprintController?.abort()
    const controller = new AbortController()
    blueprintController = controller
    set({ loading: true, loadingBlueprintId: id, loadState: get().currentBlueprint ? 'refreshing' : 'loading', error: null })
    const request = (async () => {
      try {
        const bp = await readBlueprintWhenReady(() => loadBlueprint(cwd, id), controller.signal,
          () => { if (requestId === loadRequestId) set({ loadState: 'waiting' }) })
        if (requestId !== loadRequestId) return
        set((s) => {
          const active = s.activeSession
          const nextNode = active && bp?.id === active.blueprintId ? bp.nodes[active.nodeId] : null
          return {
            currentBlueprint: bp,
            blueprintWorkspace: bp ? { ...s.blueprintWorkspace, [bp.id]: cwd } : s.blueprintWorkspace,
            activeSession: active && nextNode ? { ...active, nodeSnapshot: nextNode } : active,
            loading: false,
            loadingBlueprintId: null,
            loadState: 'idle',
            loadEpoch: s.loadEpoch + 1
          }
        })
      } catch (err: unknown) {
        if (requestId !== loadRequestId || controller.signal.aborted) return
        set({ error: err instanceof Error ? err.message : String(err), loading: false, loadingBlueprintId: null, loadState: 'error' })
      } finally {
        blueprintRequests.delete(requestKey)
        if (blueprintController === controller) blueprintController = undefined
      }
    })()
    blueprintRequests.set(requestKey, request)
    return request
  },

  workspacePathFor: (blueprintId) => get().blueprintWorkspace[blueprintId] ?? null,

  focusNode: async (input) => {
    set({ error: null })
    try {
      const node = await focusNodeIPC({
        workspacePath: input.workspacePath,
        nodeId: input.nodeId
      })
      if (!node) {
        set({ error: '无法激活节点协作会话' })
        return null
      }
      set((s) => ({
        currentBlueprint: s.currentBlueprint?.id === input.blueprintId
          ? {
              ...s.currentBlueprint,
              nodes: { ...s.currentBlueprint.nodes, [input.nodeId]: node }
            }
          : s.currentBlueprint,
        activeSession: {
          blueprintId: input.blueprintId,
          nodeId: input.nodeId,
          workspaceId: input.workspaceId,
          workspaceName: input.workspaceName,
          workspacePath: input.workspacePath,
          startedAt: new Date().toISOString(),
          nodeSnapshot: node
        }
      }))
      return node
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err) })
      return null
    }
  },

  applyNoteSource: (root, source) => {
    const graph = get().currentBlueprint
    if (!graph || !sameCheckoutPath(get().blueprintWorkspace[graph.id] ?? graph.noteSnapshot?.coverage.checkoutRoot ?? '', root)) return
    const node = Object.values(graph.nodes).find(node => node.sourceUri === source.uri)
    if (!node || node.sourceHash === source.sourceHash) return
    // Structural projection remains owned by the watcher. Deliver this known Note version now.
    set({ currentBlueprint: { ...graph, nodes: { ...graph.nodes, [node.id]: { ...node, sourceHash: source.sourceHash, title: source.doc.title,
      note: { ...source.doc, body: undefined, sections: [] } } },
      noteSnapshot: graph.noteSnapshot ? { ...graph.noteSnapshot, entries: graph.noteSnapshot.entries.map(entry => entry.uri === source.uri
        ? { ...entry, sourceHash: source.sourceHash, doc: { ...source.doc, body: undefined, sections: [] } } : entry) } : undefined } })
  },
  mergeCanvasLayout: (blueprintId, canvasLayout) => {
    set((s) => s.currentBlueprint?.id === blueprintId
      ? { currentBlueprint: { ...s.currentBlueprint, canvasLayout } }
      : s)
  },

  refreshAfterAnalysis: async () => {
    // A post-write refresh must not reuse a read started before the write.
    const workspaceId = get().selectedWorkspaceId, blueprintId = get().currentBlueprint?.id
    await Promise.all([workspaceRequest?.promise, ...blueprintRequests.values()])
    if (get().selectedWorkspaceId !== workspaceId) return
    if (workspaceId) await get().loadWorkspace(workspaceId)
    else if (blueprintId && get().currentBlueprint?.id === blueprintId) await get().loadBlueprint(blueprintId)
  }
  }
})

function errorMessage(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error)
}
