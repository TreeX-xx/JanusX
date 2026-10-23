// Note: .agents/notes/workbench/global-tool-layout.md — global content has its own layout and lifetime.
import { create } from 'zustand'
import { useAuxiliaryPanelsStore } from './auxiliary-panels'
import {
  activatePaneTab, addPaneContentToTree, closePaneTab, collapsePaneTree,
  createBrowserPaneContent, createMarkdownPaneContent, findLeafPane, findPaneContent,
  getLeafPanes, getPaneContentById, insertPaneContentAtIndex, isAvailableExtensionPane,
  removePaneContentFromTree, reorderPaneTab, resizeSplitPane, resolvePaneFocus, splitPaneTree,
  type PaneContent, type PaneDropEdge, type WorkspacePaneNode,
} from '@/lib/workspace-pane'
import { createBrowserSurface, getBrowserSurfaceState, openBrowserTab, popOutBrowserSurface } from '@/services/browser'
import { extensionRegistry } from '@/extensions/registry'
import { GLOBAL_PANE_SCOPE } from '@/lib/workspace-front-surface'

export const GLOBAL_MARKDOWN_PANEL = 'global-markdown'
const newId = () => `tools-${crypto.randomUUID()}`
let browserOpening: Promise<void> | null = null

interface GlobalToolsStore {
  paneTree: WorkspacePaneNode | null
  focusedPaneId: string | null
  focusedTabId: string | null
  focused: boolean
  collapsed: boolean
  projectRatio: number
  browserSurfaceId: string | null
  markdownScopeId: string | null
  openContent: (content: PaneContent) => void
  openBrowser: (url?: string) => Promise<void>
  attachBrowser: (surfaceId: string) => void
  forgetBrowser: (surfaceId: string) => void
  openMarkdown: (scopeId: string | null) => void
  setMarkdownScope: (scopeId: string) => void
  setCollapsed: (collapsed: boolean) => void
  setProjectRatio: (ratio: number) => void
  setFocused: (focused: boolean) => void
  setFocusedPane: (paneId: string) => void
  setPaneTab: (paneId: string, tabId: string) => void
  closePaneTab: (paneId: string, tabId: string) => void
  collapsePaneLayout: () => void
  resizePane: (id: string, ratio: number) => void
  reorderPaneTab: (paneId: string, tabId: string, index: number) => void
  movePaneTabToIndex: (contentId: string, paneId: string, index: number) => void
  dropContent: (contentId: string, paneId: string, edge: PaneDropEdge | null, ratio?: number) => void
}

function treeState(paneTree: WorkspacePaneNode | null, paneId: string | null, tabId: string | null) {
  const focus = resolvePaneFocus(paneTree, paneId, tabId)
  return { paneTree, focusedPaneId: focus.paneId, focusedTabId: focus.tabId }
}

export const useGlobalToolsStore = create<GlobalToolsStore>((set, get) => ({
  paneTree: null, focusedPaneId: null, focusedTabId: null,
  focused: false, collapsed: false, projectRatio: 0.62,
  browserSurfaceId: null, markdownScopeId: null,
  openContent: (content) => {
    if (content.type === 'terminal' || (content.type === 'extension' && content.scope !== 'application')) return
    useAuxiliaryPanelsStore.getState().activate('tools')
    const state = get()
    const result = addPaneContentToTree(state.paneTree, state.focusedPaneId, content, newId())
    set({ ...treeState(result.tree, result.focus.paneId, result.focus.tabId), focused: true, collapsed: false })
  },
  openBrowser: async (url) => {
    if (browserOpening) {
      await browserOpening
      const id = get().browserSurfaceId
      if (url && id) await openBrowserTab(id, url)
      return
    }
    browserOpening = (async () => {
      const existing = get().browserSurfaceId
      if (existing) {
        const result = await getBrowserSurfaceState(existing)
        if (result && !result.destroyed) {
          if (result.carrier === 'window') await popOutBrowserSurface(existing)
          else get().attachBrowser(existing)
          if (url) await openBrowserTab(existing, url)
          return
        }
        get().forgetBrowser(existing)
      }
      const id = crypto.randomUUID()
      const result = await createBrowserSurface(id, 'pane', url)
      if (result.success) get().attachBrowser(id)
    })()
    try { await browserOpening } finally { browserOpening = null }
  },
  attachBrowser: (surfaceId) => {
    if (get().browserSurfaceId && get().browserSurfaceId !== surfaceId) return
    set({ browserSurfaceId: surfaceId })
    get().openContent(createBrowserPaneContent(surfaceId))
  },
  forgetBrowser: (surfaceId) => {
    if (get().browserSurfaceId !== surfaceId) return
    const state = get()
    const paneTree = removePaneContentFromTree(state.paneTree, `browser:${surfaceId}`)
    set({ ...treeState(paneTree, state.focusedPaneId, state.focusedTabId), browserSurfaceId: null,
      ...(!paneTree ? { focused: false } : {}) })
  },
  openMarkdown: (scopeId) => {
    if (get().markdownScopeId === null) set({ markdownScopeId: scopeId ?? GLOBAL_PANE_SCOPE })
    get().openContent(createMarkdownPaneContent(GLOBAL_MARKDOWN_PANEL))
  },
  setMarkdownScope: (markdownScopeId) => set({ markdownScopeId }),
  setCollapsed: (collapsed) => {
    if (!collapsed) useAuxiliaryPanelsStore.getState().activate('tools')
    set({ collapsed, focused: !collapsed })
  },
  setProjectRatio: (ratio) => { if (Number.isFinite(ratio)) set({ projectRatio: Math.max(0.2, Math.min(0.8, ratio)) }) },
  setFocused: (focused) => set({ focused }),
  setFocusedPane: (paneId) => {
    if (!findLeafPane(get().paneTree, paneId)) return
    set({ ...treeState(get().paneTree, paneId, null), focused: true })
  },
  setPaneTab: (paneId, tabId) => {
    if (!findLeafPane(get().paneTree, paneId)?.tabs.some((tab) => tab.id === tabId)) return
    set({ ...treeState(activatePaneTab(get().paneTree, paneId, tabId), paneId, tabId), focused: true })
  },
  // Detaching the browser pane for pop-out deliberately retains its singleton identity.
  closePaneTab: (paneId, tabId) => {
    const paneTree = closePaneTab(get().paneTree, paneId, tabId)
    set({ ...treeState(paneTree, paneId, null), ...(!paneTree ? { focused: false } : {}) })
  },
  collapsePaneLayout: () => {
    const state = get()
    const result = collapsePaneTree(state.paneTree, null)
    const paneId = findPaneContent(result.tree, state.focusedTabId ?? '').paneId
    set(treeState(paneId ? activatePaneTab(result.tree, paneId, state.focusedTabId) : result.tree, paneId, state.focusedTabId))
  },
  resizePane: (id, ratio) => set({ paneTree: resizeSplitPane(get().paneTree, id, ratio) }),
  reorderPaneTab: (paneId, tabId, index) => {
    const paneTree = reorderPaneTab(get().paneTree, paneId, tabId, index)
    set(treeState(paneTree, paneId, tabId))
  },
  movePaneTabToIndex: (contentId, paneId, index) => {
    const state = get()
    const content = getPaneContentById(state.paneTree, contentId)
    if (!content || !findLeafPane(state.paneTree, paneId)) return
    const result = insertPaneContentAtIndex(state.paneTree, paneId, content, index, newId())
    set(treeState(result.tree, result.focus.paneId, contentId))
  },
  dropContent: (contentId, paneId, edge, ratio = 0.5) => {
    const state = get()
    const content = getPaneContentById(state.paneTree, contentId)
    const target = findLeafPane(state.paneTree, paneId)
    if (!content || !target) return
    if (!edge) { get().movePaneTabToIndex(contentId, paneId, target.tabs.length); return }
    // A sole tab cannot split against itself; removing it would erase the target.
    if (target.tabs.length === 1 && target.tabs[0].id === contentId) return
    const removed = removePaneContentFromTree(state.paneTree, contentId)
    const split = splitPaneTree(removed, paneId,
      edge === 'left' || edge === 'right' ? 'horizontal' : 'vertical', newId(), newId(),
      edge === 'left' || edge === 'top' ? 'before' : 'after', Math.max(0.15, Math.min(0.85, ratio)))
    const result = addPaneContentToTree(split.tree, split.focus.paneId, content, newId())
    set({ ...treeState(result.tree, result.focus.paneId, contentId), focused: true })
  },
}))

extensionRegistry.subscribe(() => {
  const state = useGlobalToolsStore.getState()
  let tree = state.paneTree
  for (const tab of getLeafPanes(tree).flatMap((leaf) => leaf.tabs)) {
    if (tab.type === 'extension' && !isAvailableExtensionPane(tab)) tree = removePaneContentFromTree(tree, tab.id)
  }
  if (tree !== state.paneTree) useGlobalToolsStore.setState({
    ...treeState(tree, state.focusedPaneId, state.focusedTabId), ...(!tree ? { focused: false } : {}),
  })
})
