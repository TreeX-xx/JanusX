import { create } from 'zustand'
import type { Workspace, Terminal, FileNode } from '@/types'
import {
  activatePaneTab,
  addPaneContentToTree,
  addTerminalToPaneTree,
  closePaneTab,
  collapsePaneTree,
  createExtensionPaneContent,
  isAvailableExtensionPane,
  createTerminalPaneContent,
  findLeafPane,
  findTerminalPane,
  getLeafPanes,
  getPaneContentById,
  insertPaneContentAtIndex,
  reorderPaneTab as reorderPaneTabInTree,
  removePaneContentFromTree,
  removeTerminalFromPaneTree,
  retainWorkspacePaneContent,
  resizeSplitPane,
  resolvePaneFocus,
  splitPaneTree,
  unsplitPaneTree,
  type PaneDropEdge,
  type ExtensionPaneContent,
  type PaneSplitDirection,
  type WorkspacePaneNode,
} from '@/lib/workspace-pane'
import { useGlobalToolsStore } from './global-tools'
import { extensionRegistry } from '@/extensions/registry'
import type { ExtensionViewId } from '@/extensions/types'

type TerminalSnapshot = {
  terminals: Terminal[]
  activeTerminalId: string | null
  paneTree: WorkspacePaneNode | null
  focusedPaneId: string | null
  focusedTabId: string | null
}

interface WorkspaceStore {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  terminals: Terminal[]
  activeTerminalId: string | null
  paneTree: WorkspacePaneNode | null
  focusedPaneId: string | null
  focusedTabId: string | null
  fileTree: FileNode[]
  activeFilePath: string | null
  fileTreeLoadState: 'idle' | 'loading' | 'revealing' | 'error'
  /*-- tab 拖拽进行中：拖拽期间隐藏浏览器原生视图，让 pane 落点区恢复为 DOM 可命中 --*/
  tabDragInFlight: boolean

  // 每个工作区的终端快照
  terminalSnapshots: Record<string, TerminalSnapshot>

  setWorkspaces: (workspaces: Workspace[]) => void
  addWorkspace: (workspace: Workspace) => void
  removeWorkspace: (id: string) => void
  setActiveWorkspace: (id: string | null) => void

  addTerminal: (terminal: Terminal) => void
  addTerminalForWorkspace: (terminal: Terminal) => void
  removeTerminal: (id: string) => void
  setActiveTerminal: (id: string) => void
  updateTerminal: (id: string, patch: Partial<Terminal>) => void
  setFocusedPane: (paneId: string) => void
  setPaneTab: (paneId: string, tabId: string) => void
  setTabDragInFlight: (active: boolean) => void
  addBrowserSurfaceToTree: (surfaceId: string) => void
  openBrowserInWorkspace: (url?: string) => Promise<void>
  openMarkdownInWorkspace: () => void
  openExtensionView: (viewId: ExtensionViewId, instanceKey?: string) => void
  splitPane: (paneId: string | null, direction: PaneSplitDirection) => void
  unsplitPane: (paneId: string | null) => void
  collapsePaneLayout: () => void
  resizePane: (splitId: string, ratio: number) => void
  closePaneTab: (paneId: string, tabId: string) => void
  reorderPaneTab: (paneId: string, tabId: string, targetIndex: number) => void
  movePaneTabToIndex: (contentId: string, paneId: string, targetIndex: number) => void
  moveTerminalToPane: (terminalId: string, paneId: string) => void
  splitPaneWithTerminal: (terminalId: string, paneId: string, edge: PaneDropEdge, ratio?: number) => void
  movePaneContentToPane: (contentId: string, paneId: string) => void
  splitPaneWithContent: (contentId: string, paneId: string, edge: PaneDropEdge, ratio?: number) => void

  updateFileTree: (nodes: FileNode[]) => void
  setActiveFilePath: (path: string | null) => void
}

function createPaneId(prefix = 'pane'): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

type TerminalLookupState = {
  terminals: Terminal[]
  terminalSnapshots: Record<string, TerminalSnapshot>
}

function findTerminalInState(state: TerminalLookupState, terminalId: string): Terminal | null {
  const activeTerminal = state.terminals.find((item) => item.id === terminalId)
  if (activeTerminal) return activeTerminal

  for (const snapshot of Object.values(state.terminalSnapshots)) {
    const terminal = snapshot.terminals.find((item) => item.id === terminalId)
    if (terminal) return terminal
  }

  return null
}

function ensureTerminalInCurrentView(terminals: Terminal[], terminal: Terminal): Terminal[] {
  return terminals.some((item) => item.id === terminal.id) ? terminals : [...terminals, terminal]
}

function sanitizeWorkspaceSnapshot(snapshot: TerminalSnapshot, workspaceId: string): TerminalSnapshot {
  const terminals = snapshot.terminals.filter((terminal) => terminal.workspaceId === workspaceId)
  const paneTree = retainWorkspacePaneContent(
    snapshot.paneTree,
    workspaceId,
    new Set(terminals.map((terminal) => terminal.id))
  )
  const focus = resolvePaneFocus(paneTree, snapshot.focusedPaneId, snapshot.focusedTabId)
  return {
    terminals,
    activeTerminalId: focus.terminalId,
    paneTree,
    focusedPaneId: focus.paneId,
    focusedTabId: focus.tabId,
  }
}

function filterExtensionPanes(
  tree: WorkspacePaneNode | null,
  keep: (tab: ExtensionPaneContent) => boolean,
): WorkspacePaneNode | null {
  for (const leaf of getLeafPanes(tree)) {
    for (const tab of leaf.tabs) {
      if (tab.type === 'extension' && !keep(tab)) tree = removePaneContentFromTree(tree, tab.id)
    }
  }
  return tree
}

function allowsTerminalPresentation(
  paneTree: WorkspacePaneNode | null,
  activeWorkspaceId: string | null,
  paneId: string,
  tabId: string | null
): boolean {
  const pane = findLeafPane(paneTree, paneId)
  const tab = pane?.tabs.find((item) => item.id === tabId)
  if (!pane || !tab || tab.type !== 'terminal' || tab.workspaceId === activeWorkspaceId) return true
  return getLeafPanes(paneTree).length > 1
    && pane.tabs.every((item) => item.type !== 'terminal' || item.workspaceId === tab.workspaceId)
}

function updateTerminalSnapshots(
  snapshots: Record<string, TerminalSnapshot>,
  terminalId: string,
  patch: Partial<Terminal>
): Record<string, TerminalSnapshot> {
  let changed = false
  const nextSnapshots = Object.fromEntries(
    Object.entries(snapshots).map(([workspaceId, snapshot]) => {
      let snapshotChanged = false
      const terminals = snapshot.terminals.map((terminal) => {
        if (terminal.id !== terminalId) return terminal
        snapshotChanged = true
        return { ...terminal, ...patch, updatedAt: patch.updatedAt ?? Date.now() }
      })

      if (!snapshotChanged) return [workspaceId, snapshot]
      changed = true
      return [workspaceId, { ...snapshot, terminals }]
    })
  )

  return changed ? nextSnapshots : snapshots
}

function removeTerminalFromSnapshots(
  snapshots: Record<string, TerminalSnapshot>,
  terminalId: string
): Record<string, TerminalSnapshot> {
  let changed = false
  const nextSnapshots = Object.fromEntries(
    Object.entries(snapshots).map(([workspaceId, snapshot]) => {
      if (!snapshot.terminals.some((terminal) => terminal.id === terminalId)) return [workspaceId, snapshot]

      const paneTree = removeTerminalFromPaneTree(snapshot.paneTree, terminalId)
      const focus = resolvePaneFocus(paneTree, snapshot.focusedPaneId, snapshot.focusedTabId)
      changed = true
      return [
        workspaceId,
        {
          terminals: snapshot.terminals.filter((terminal) => terminal.id !== terminalId),
          activeTerminalId: focus.terminalId,
          paneTree,
          focusedPaneId: focus.paneId,
          focusedTabId: focus.tabId,
        },
      ]
    })
  )

  return changed ? nextSnapshots : snapshots
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: null,
  terminals: [],
  activeTerminalId: null,
  paneTree: null,
  focusedPaneId: null,
  focusedTabId: null,
  fileTree: [],
  activeFilePath: null,
  fileTreeLoadState: 'idle',
  tabDragInFlight: false,
  terminalSnapshots: {},

  setWorkspaces: (workspaces) => set({ workspaces }),
  addWorkspace: (workspace) =>
    set((s) => ({ workspaces: [...s.workspaces, workspace] })),
  removeWorkspace: (id) =>
    set((s) => {
      const { [id]: _, ...rest } = s.terminalSnapshots
      // 删掉的是活动工作区时一并清掉活动 pane 宿主：否则已删工作区的终端标签会
      // 悬在无项目作用域里（全局 pane 哨兵会把它渲染出来），空白页反而回不去。
      const becomingProjectless = s.activeWorkspaceId === id
      return {
        workspaces: s.workspaces.filter((w) => w.id !== id),
        activeWorkspaceId: becomingProjectless ? null : s.activeWorkspaceId,
        ...(becomingProjectless
          ? {
              terminals: [],
              activeTerminalId: null,
              paneTree: null,
              focusedPaneId: null,
              focusedTabId: null,
            }
          : {}),
        terminalSnapshots: rest,
      }
    }),
  setActiveWorkspace: (id) => {
    const s = get()
    if (s.activeWorkspaceId === id) return
    // 保存当前工作区的终端快照
    const snapshots = { ...s.terminalSnapshots }
    if (s.activeWorkspaceId) {
      snapshots[s.activeWorkspaceId] = sanitizeWorkspaceSnapshot({
        terminals: s.terminals,
        activeTerminalId: s.activeTerminalId,
        paneTree: s.paneTree,
        focusedPaneId: s.focusedPaneId,
        focusedTabId: s.focusedTabId,
      }, s.activeWorkspaceId)
    }
    // 恢复目标工作区的终端快照;文件树属于旧工作区,立即清空避免串台
    const saved = id && snapshots[id] ? sanitizeWorkspaceSnapshot(snapshots[id], id) : null
    if (saved && id) snapshots[id] = saved
    const paneTree = saved?.paneTree ?? null
    const focus = resolvePaneFocus(paneTree, saved?.focusedPaneId ?? null, saved?.focusedTabId ?? null)
    set({
      activeWorkspaceId: id,
      fileTree: [],
      activeFilePath: null,
      terminals: saved?.terminals ?? [],
      activeTerminalId: focus.terminalId,
      paneTree,
      focusedPaneId: focus.paneId,
      focusedTabId: focus.tabId,
      terminalSnapshots: snapshots,
    })
  },

  addTerminal: (terminal) => {
    if (get().activeWorkspaceId !== terminal.workspaceId) {
      get().addTerminalForWorkspace(terminal)
      return
    }
    useGlobalToolsStore.getState().setFocused(false)
    set((s) => {
      const now = Date.now()
      const nextTerminal = {
        ...terminal,
        updatedAt: terminal.updatedAt ?? now,
        telemetryStartedAt: terminal.telemetryStartedAt ?? now,
      }
      const result = addTerminalToPaneTree(
        s.paneTree,
        s.focusedPaneId,
        createTerminalPaneContent(nextTerminal.id, nextTerminal.workspaceId),
        createPaneId()
      )
      return {
        terminals: [...s.terminals, nextTerminal],
        activeTerminalId: terminal.id,
        paneTree: result.tree,
        focusedPaneId: result.focus.paneId,
        focusedTabId: result.focus.tabId,
      }
    })
  },
  addTerminalForWorkspace: (terminal) => {
    if (get().activeWorkspaceId === terminal.workspaceId) {
      get().addTerminal(terminal)
      return
    }
    set((s) => {
      const snapshot = s.terminalSnapshots[terminal.workspaceId] ?? {
        terminals: [], activeTerminalId: null, paneTree: null, focusedPaneId: null, focusedTabId: null,
      }
      if (snapshot.terminals.some((item) => item.id === terminal.id)) return {}
      const result = addTerminalToPaneTree(snapshot.paneTree, snapshot.focusedPaneId, createTerminalPaneContent(terminal.id, terminal.workspaceId), createPaneId())
      return { terminalSnapshots: { ...s.terminalSnapshots, [terminal.workspaceId]: {
        ...snapshot, terminals: [...snapshot.terminals, terminal], activeTerminalId: terminal.id,
        paneTree: result.tree, focusedPaneId: result.focus.paneId, focusedTabId: result.focus.tabId,
      } } }
    })
  },
  removeTerminal: (id) =>
    set((s) => {
      const terminals = s.terminals.filter((t) => t.id !== id)
      // Remove only the terminal view; non-terminal pane content such as Janus Chat
      // must survive when the terminal was the last terminal in the workspace.
      const paneTree = removeTerminalFromPaneTree(s.paneTree, id)
      const focus = resolvePaneFocus(paneTree, s.focusedPaneId, s.focusedTabId)
      return {
        terminals,
        activeTerminalId: focus.terminalId,
        paneTree,
        focusedPaneId: focus.paneId,
        focusedTabId: focus.tabId,
        terminalSnapshots: removeTerminalFromSnapshots(s.terminalSnapshots, id),
      }
    }),
  setActiveTerminal: (id) =>
    set((s) => {
      const terminal = s.terminals.find((t) => t.id === id)
      if (!terminal) return {}
      useGlobalToolsStore.getState().setFocused(false)

      const existing = findTerminalPane(s.paneTree, id)
      if (existing.paneId && existing.tabId) {
        return {
          activeTerminalId: id,
          paneTree: activatePaneTab(s.paneTree, existing.paneId, existing.tabId),
          focusedPaneId: existing.paneId,
          focusedTabId: existing.tabId,
        }
      }

      const result = addTerminalToPaneTree(
        s.paneTree,
        s.focusedPaneId,
        createTerminalPaneContent(terminal.id, terminal.workspaceId),
        createPaneId()
      )
      return {
        activeTerminalId: id,
        paneTree: result.tree,
        focusedPaneId: result.focus.paneId,
        focusedTabId: result.focus.tabId,
      }
    }),
  updateTerminal: (id, patch) =>
    set((s) => ({
      terminals: s.terminals.map((t) =>
        t.id === id ? { ...t, ...patch, updatedAt: patch.updatedAt ?? Date.now() } : t
      ),
      terminalSnapshots: updateTerminalSnapshots(s.terminalSnapshots, id, patch),
    })),
  setFocusedPane: (paneId) =>
    set((s) => {
      if (!findLeafPane(s.paneTree, paneId)) return {}
      useGlobalToolsStore.getState().setFocused(false)
      const focus = resolvePaneFocus(s.paneTree, paneId, null)
      if (!allowsTerminalPresentation(s.paneTree, s.activeWorkspaceId, paneId, focus.tabId)) return {}
      return {
        focusedPaneId: focus.paneId,
        focusedTabId: focus.tabId,
        activeTerminalId: focus.terminalId,
      }
    }),
  setPaneTab: (paneId, tabId) =>
    set((s) => {
      if (!findLeafPane(s.paneTree, paneId)) return {}
      useGlobalToolsStore.getState().setFocused(false)
      if (!allowsTerminalPresentation(s.paneTree, s.activeWorkspaceId, paneId, tabId)) return {}
      const paneTree = activatePaneTab(s.paneTree, paneId, tabId)
      const focus = resolvePaneFocus(paneTree, paneId, tabId)
      return {
        paneTree,
        focusedPaneId: focus.paneId,
        focusedTabId: focus.tabId,
        activeTerminalId: focus.terminalId,
      }
    }),
  setTabDragInFlight: (active) =>
    set((s) => (s.tabDragInFlight === active ? {} : { tabDragInFlight: active })),
  // Compatibility entry points: global tools never enter a project snapshot.
  addBrowserSurfaceToTree: (surfaceId) => useGlobalToolsStore.getState().attachBrowser(surfaceId),
  openBrowserInWorkspace: (url) => useGlobalToolsStore.getState().openBrowser(url),
  openMarkdownInWorkspace: () => useGlobalToolsStore.getState().openMarkdown(get().activeWorkspaceId),
  openExtensionView: (viewId, instanceKey) => {
    const content = createExtensionPaneContent(viewId, get().activeWorkspaceId, instanceKey)
    if (!content) return
    if (content.scope === 'application') { useGlobalToolsStore.getState().openContent(content); return }
    useGlobalToolsStore.getState().setFocused(false)
    set((state) => {
      const result = addPaneContentToTree(state.paneTree, state.focusedPaneId, content, createPaneId())
      return {
        paneTree: result.tree, focusedPaneId: result.focus.paneId,
        focusedTabId: result.focus.tabId, activeTerminalId: result.focus.terminalId,
      }
    })
  },
  splitPane: (paneId, direction) =>
    set((s) => {
      const result = splitPaneTree(s.paneTree, paneId ?? s.focusedPaneId, direction, createPaneId('split'), createPaneId())
      return {
        paneTree: result.tree,
        focusedPaneId: result.focus.paneId,
        focusedTabId: result.focus.tabId,
        activeTerminalId: result.focus.terminalId,
      }
    }),
  unsplitPane: (paneId) =>
    set((s) => {
      const result = unsplitPaneTree(s.paneTree, paneId ?? s.focusedPaneId)
      return {
        paneTree: result.tree,
        focusedPaneId: result.focus.paneId,
        focusedTabId: result.focus.tabId,
        activeTerminalId: result.focus.terminalId,
      }
    }),
  collapsePaneLayout: () =>
    set((s) => {
      if (!s.activeWorkspaceId) return {}
      const safeSnapshot = sanitizeWorkspaceSnapshot({
        terminals: s.terminals,
        activeTerminalId: s.activeTerminalId,
        paneTree: s.paneTree,
        focusedPaneId: s.focusedPaneId,
        focusedTabId: s.focusedTabId,
      }, s.activeWorkspaceId)
      const result = collapsePaneTree(safeSnapshot.paneTree, safeSnapshot.activeTerminalId)
      return {
        terminals: safeSnapshot.terminals,
        paneTree: result.tree,
        focusedPaneId: result.focus.paneId,
        focusedTabId: result.focus.tabId,
        activeTerminalId: result.focus.terminalId,
      }
    }),
  resizePane: (splitId, ratio) =>
    set((s) => ({
      paneTree: resizeSplitPane(s.paneTree, splitId, ratio),
    })),
  closePaneTab: (paneId, tabId) =>
    set((s) => {
      const paneTree = closePaneTab(s.paneTree, paneId, tabId)
      const focus = resolvePaneFocus(paneTree, paneId, null)
      return {
        paneTree,
        focusedPaneId: focus.paneId,
        focusedTabId: focus.tabId,
        activeTerminalId: focus.terminalId,
      }
    }),
  /*-- 同 pane 内 tab 排序：落点不变时不产生新树，避免无意义重渲染 --*/
  reorderPaneTab: (paneId, tabId, targetIndex) =>
    set((s) => {
      const paneTree = reorderPaneTabInTree(s.paneTree, paneId, tabId, targetIndex)
      if (!paneTree || paneTree === s.paneTree) return {}
      const focus = resolvePaneFocus(paneTree, paneId, tabId)
      return {
        paneTree,
        focusedPaneId: focus.paneId,
        focusedTabId: focus.tabId,
        activeTerminalId: focus.terminalId,
      }
    }),
  movePaneTabToIndex: (contentId, paneId, targetIndex) =>
    set((s) => {
      if (!findLeafPane(s.paneTree, paneId)) return {}
      /*-- 侧栏拖入的终端可能尚无 pane 视图：为其建内容后按下标插入 --*/
      let content = getPaneContentById(s.paneTree, contentId)
      let terminals = s.terminals
      if (!content) {
        if (!contentId.startsWith('terminal:')) return {}
        const terminalId = contentId.slice('terminal:'.length)
        const terminal = findTerminalInState(s, terminalId)
        if (!terminal || terminal.workspaceId !== s.activeWorkspaceId) return {}
        terminals = ensureTerminalInCurrentView(s.terminals, terminal)
        content = createTerminalPaneContent(terminal.id, terminal.workspaceId)
      }
      const result = insertPaneContentAtIndex(s.paneTree, paneId, content, targetIndex, createPaneId())
      if (result.tree === s.paneTree && terminals === s.terminals) return {}
      return {
        terminals,
        paneTree: result.tree,
        focusedPaneId: result.focus.paneId,
        focusedTabId: result.focus.tabId,
        activeTerminalId: result.focus.terminalId,
      }
    }),
  moveTerminalToPane: (terminalId, paneId) =>
    set((s) => {
      if (!findLeafPane(s.paneTree, paneId)) return {}
      const terminal = findTerminalInState(s, terminalId)
      if (!terminal || terminal.workspaceId !== s.activeWorkspaceId) return {}
      const terminals = ensureTerminalInCurrentView(s.terminals, terminal)
      const result = addTerminalToPaneTree(
        s.paneTree,
        paneId,
        createTerminalPaneContent(terminal.id, terminal.workspaceId),
        createPaneId()
      )
      return {
        terminals,
        paneTree: result.tree,
        focusedPaneId: result.focus.paneId,
        focusedTabId: result.focus.tabId,
        activeTerminalId: result.focus.terminalId,
      }
    }),
  splitPaneWithTerminal: (terminalId, paneId, edge, ratio = 0.5) =>
    set((s) => {
      if (!findLeafPane(s.paneTree, paneId)) return {}
      const terminal = findTerminalInState(s, terminalId)
      if (!terminal) return {}
      const terminals = terminal.workspaceId === s.activeWorkspaceId
        ? ensureTerminalInCurrentView(s.terminals, terminal)
        : s.terminals

      const direction: PaneSplitDirection = edge === 'left' || edge === 'right' ? 'horizontal' : 'vertical'
      const placement = edge === 'left' || edge === 'top' ? 'before' : 'after'
      const clampedRatio = Math.min(0.85, Math.max(0.15, ratio))
      const splitResult = splitPaneTree(
        s.paneTree,
        paneId,
        direction,
        createPaneId('split'),
        createPaneId(),
        placement,
        clampedRatio
      )
      const targetPaneId = splitResult.focus.paneId
      if (!targetPaneId) {
        return {
          terminals,
          paneTree: splitResult.tree,
          focusedPaneId: splitResult.focus.paneId,
          focusedTabId: splitResult.focus.tabId,
          activeTerminalId: splitResult.focus.terminalId,
        }
      }

      const result = addTerminalToPaneTree(
        splitResult.tree,
        targetPaneId,
        createTerminalPaneContent(terminal.id, terminal.workspaceId),
        createPaneId()
      )
      return {
        terminals,
        paneTree: result.tree,
        focusedPaneId: result.focus.paneId,
        focusedTabId: result.focus.tabId,
        activeTerminalId: result.focus.terminalId,
      }
    }),

  /*-- 内容中立的 tab 拖拽落点：browser / markdown 共用，终端另有 moveTerminalToPane --*/
  movePaneContentToPane: (contentId, paneId) =>
    set((s) => {
      if (!findLeafPane(s.paneTree, paneId)) return {}
      const content = getPaneContentById(s.paneTree, contentId)
      if (!content || content.type === 'terminal') return {}
      const removed = removePaneContentFromTree(s.paneTree, contentId)
      const result = addPaneContentToTree(removed, paneId, content, createPaneId())
      return {
        paneTree: result.tree,
        focusedPaneId: result.focus.paneId,
        focusedTabId: result.focus.tabId,
        activeTerminalId: null,
      }
    }),
  splitPaneWithContent: (contentId, paneId, edge, ratio = 0.5) =>
    set((s) => {
      if (!findLeafPane(s.paneTree, paneId)) return {}
      const content = getPaneContentById(s.paneTree, contentId)
      if (!content || content.type === 'terminal') return {}

      const removed = removePaneContentFromTree(s.paneTree, contentId)
      const direction: PaneSplitDirection = edge === 'left' || edge === 'right' ? 'horizontal' : 'vertical'
      const placement = edge === 'left' || edge === 'top' ? 'before' : 'after'
      const clampedRatio = Math.min(0.85, Math.max(0.15, ratio))
      const splitResult = splitPaneTree(
        removed,
        paneId,
        direction,
        createPaneId('split'),
        createPaneId(),
        placement,
        clampedRatio
      )
      const targetPaneId = splitResult.focus.paneId
      if (!targetPaneId) {
        return {
          paneTree: splitResult.tree,
          focusedPaneId: splitResult.focus.paneId,
          focusedTabId: splitResult.focus.tabId,
          activeTerminalId: null,
        }
      }

      const result = addPaneContentToTree(splitResult.tree, targetPaneId, content, createPaneId())
      return {
        paneTree: result.tree,
        focusedPaneId: result.focus.paneId,
        focusedTabId: result.focus.tabId,
        activeTerminalId: null,
      }
    }),

  updateFileTree: (fileTree) => set({ fileTree }),
  setActiveFilePath: (path) => set({ activeFilePath: path }),
}))

// Unregistration clears both the visible tree and inactive project snapshots.
extensionRegistry.subscribe(() => {
  const state = useWorkspaceStore.getState()
  const clean = (snapshot: TerminalSnapshot): TerminalSnapshot => {
    const paneTree = filterExtensionPanes(snapshot.paneTree, isAvailableExtensionPane)
    if (paneTree === snapshot.paneTree) return snapshot
    const focus = resolvePaneFocus(paneTree, snapshot.focusedPaneId, snapshot.focusedTabId)
    return { ...snapshot, paneTree, focusedPaneId: focus.paneId, focusedTabId: focus.tabId, activeTerminalId: focus.terminalId }
  }
  const current = clean(state)
  const terminalSnapshots = Object.fromEntries(Object.entries(state.terminalSnapshots).map(([id, snapshot]) => [id, clean(snapshot)]))
  if (current === state && Object.entries(terminalSnapshots).every(([id, snapshot]) => snapshot === state.terminalSnapshots[id])) return
  useWorkspaceStore.setState({
    paneTree: current.paneTree, focusedPaneId: current.focusedPaneId,
    focusedTabId: current.focusedTabId, activeTerminalId: current.activeTerminalId,
    terminalSnapshots,
  })
})
