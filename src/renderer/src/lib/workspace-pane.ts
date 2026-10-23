// Note: pane tree focus with island as sole subagent surface — see .agents/notes/terminal/pane-tree-subagent.md
// Note: extension views use the same pane lifecycle — see .agents/notes/workbench/requirements/plugin-architecture-forms.md
import { extensionRegistry } from '@/extensions/registry'
import type { ExtensionViewId, ExtensionViewScope } from '@/extensions/types'

export type PaneSplitDirection = 'horizontal' | 'vertical'
export type PaneSplitPlacement = 'before' | 'after'
export type PaneDropEdge = 'left' | 'right' | 'top' | 'bottom'

export type TerminalPaneContent = {
  type: 'terminal'
  id: string
  terminalId: string
  workspaceId: string
}

/*-- 浏览器 pane 内容：id 形如 browser:{surfaceId}，一个 surface 对应主进程一个浏览器实例 --*/
export type BrowserPaneContent = {
  type: 'browser'
  id: `browser:${string}`
  surfaceId: string
  terminalId?: never
  workspaceId?: never
}

/*-- Markdown pane 内容：id 形如 markdown:{panelId}，草稿按工作区/全局作用域归属，与 pane 位置无关 --*/
export type MarkdownPaneContent = {
  type: 'markdown'
  id: `markdown:${string}`
  panelId: string
  terminalId?: never
  workspaceId?: never
}

export type ExtensionPaneContent = {
  instanceKey?: string
  type: 'extension'
  id: `extension-pane:${string}`
  viewId: ExtensionViewId
  scope: ExtensionViewScope
  projectId: string | null
  terminalId?: never
  workspaceId?: never
}

export type PaneContent = TerminalPaneContent | BrowserPaneContent | MarkdownPaneContent | ExtensionPaneContent

export type WorkspacePaneLeaf = {
  type: 'leaf'
  id: string
  tabs: PaneContent[]
  activeTabId: string | null
}

export type WorkspacePaneSplit = {
  type: 'split'
  id: string
  direction: PaneSplitDirection
  ratio: number
  first: WorkspacePaneNode
  second: WorkspacePaneNode
}

export type WorkspacePaneNode = WorkspacePaneLeaf | WorkspacePaneSplit

export type WorkspacePaneFocus = {
  paneId: string | null
  tabId: string | null
  terminalId: string | null
}

export function createTerminalPaneContent(terminalId: string, workspaceId: string): TerminalPaneContent {
  return {
    type: 'terminal',
    id: `terminal:${terminalId}`,
    terminalId,
    workspaceId,
  }
}

export function createBrowserPaneContent(surfaceId: string): BrowserPaneContent {
  return { type: 'browser', id: `browser:${surfaceId}`, surfaceId }
}

export function createMarkdownPaneContent(panelId: string): MarkdownPaneContent {
  return { type: 'markdown', id: `markdown:${panelId}`, panelId }
}

export function createExtensionPaneContent(viewId: ExtensionViewId, projectId: string | null, instanceKey?: string): ExtensionPaneContent | null {
  const view = extensionRegistry.getView(viewId)
  if (!view || view.location !== 'workspace' || (view.scope === 'project' && !projectId)) return null
  const scopeId = view.scope === 'project' ? projectId : null
  if (instanceKey !== undefined && (view.instancePolicy !== 'multiple' || !/^[a-zA-Z0-9_-]{1,64}$/.test(instanceKey))) return null
  const key = view.instancePolicy === 'multiple' ? instanceKey ?? crypto.randomUUID() : undefined
  return {
    type: 'extension', id: `extension-pane:${viewId}:${scopeId === null ? 'application' : `project:${encodeURIComponent(scopeId)}`}${key ? `:instance:${key}` : ''}`,
    viewId, scope: view.scope, projectId: scopeId, ...(key ? { instanceKey: key } : {}),
  }
}

export function isAvailableExtensionPane(tab: ExtensionPaneContent): boolean {
  const view = extensionRegistry.getView(tab.viewId)
  return view?.location === 'workspace' && view.scope === tab.scope
    && (view.instancePolicy === 'multiple' ? typeof tab.instanceKey === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(tab.instanceKey) : tab.instanceKey === undefined)
    && (tab.scope === 'application' ? tab.projectId === null : typeof tab.projectId === 'string' && tab.projectId.length > 0)
}

/*-- 找到 pane 树中第一个 Markdown 面板（顶栏入口的"已有则激活"语义） --*/
export function findFirstMarkdownPaneContent(
  node: WorkspacePaneNode | null
): { paneId: string; tabId: string; panelId: string } | null {
  for (const leaf of getLeafPanes(node)) {
    const tab = leaf.tabs.find((item) => item.type === 'markdown')
    if (tab && tab.type === 'markdown') {
      return { paneId: leaf.id, tabId: tab.id, panelId: tab.panelId }
    }
  }
  return null
}

/*-- 找到 pane 树中第一个浏览器 tab（Sidebar/快捷键入口的"已有则激活"语义） --*/
export function findFirstBrowserPaneContent(
  node: WorkspacePaneNode | null
): { paneId: string; tabId: string; surfaceId: string } | null {
  for (const leaf of getLeafPanes(node)) {
    const tab = leaf.tabs.find((item) => item.type === 'browser')
    if (tab && tab.type === 'browser') {
      return { paneId: leaf.id, tabId: tab.id, surfaceId: tab.surfaceId }
    }
  }
  return null
}

export function createEmptyPaneLeaf(id: string): WorkspacePaneLeaf {
  return {
    type: 'leaf',
    id,
    tabs: [],
    activeTabId: null,
  }
}

export function getLeafPanes(node: WorkspacePaneNode | null): WorkspacePaneLeaf[] {
  if (!node) return []
  if (node.type === 'leaf') return [node]
  return [...getLeafPanes(node.first), ...getLeafPanes(node.second)]
}

export function findLeafPane(
  node: WorkspacePaneNode | null,
  paneId: string | null
): WorkspacePaneLeaf | null {
  if (!node || !paneId) return null
  if (node.type === 'leaf') return node.id === paneId ? node : null
  return findLeafPane(node.first, paneId) ?? findLeafPane(node.second, paneId)
}

export function findTerminalPane(
  node: WorkspacePaneNode | null,
  terminalId: string
): WorkspacePaneFocus {
  for (const leaf of getLeafPanes(node)) {
    const tab = leaf.tabs.find((item) => item.type === 'terminal' && item.terminalId === terminalId)
    if (tab) {
      return { paneId: leaf.id, tabId: tab.id, terminalId }
    }
  }
  return { paneId: null, tabId: null, terminalId: null }
}

function pruneEmptyPanes(node: WorkspacePaneNode | null): WorkspacePaneNode | null {
  if (!node) return null
  if (node.type === 'leaf') return node.tabs.length > 0 ? node : null

  const first = pruneEmptyPanes(node.first)
  const second = pruneEmptyPanes(node.second)
  if (!first && !second) return null
  if (!first) return second
  if (!second) return first

  return {
    ...node,
    first,
    second,
  }
}

export function resolvePaneFocus(
  node: WorkspacePaneNode | null,
  preferredPaneId: string | null,
  preferredTabId: string | null
): WorkspacePaneFocus {
  const preferredPane = findLeafPane(node, preferredPaneId)
  const fallbackPane = preferredPane ?? getLeafPanes(node)[0] ?? null
  if (!fallbackPane) return { paneId: null, tabId: null, terminalId: null }

  const preferredTab = preferredTabId
    ? fallbackPane.tabs.find((item) => item.id === preferredTabId)
    : null
  const activeTab = fallbackPane.activeTabId
    ? fallbackPane.tabs.find((item) => item.id === fallbackPane.activeTabId)
    : null
  const tab = preferredTab ?? activeTab ?? fallbackPane.tabs[0] ?? null

  return {
    paneId: fallbackPane.id,
    tabId: tab?.id ?? null,
    terminalId: tab?.type === 'terminal' ? tab.terminalId : null,
  }
}

export function activatePaneTab(
  node: WorkspacePaneNode | null,
  paneId: string,
  tabId: string | null
): WorkspacePaneNode | null {
  if (!node) return null
  if (node.type === 'leaf') {
    if (node.id !== paneId) return node
    const hasTab = tabId ? node.tabs.some((item) => item.id === tabId) : false
    return { ...node, activeTabId: hasTab ? tabId : node.tabs[0]?.id ?? null }
  }

  return {
    ...node,
    first: activatePaneTab(node.first, paneId, tabId) ?? node.first,
    second: activatePaneTab(node.second, paneId, tabId) ?? node.second,
  }
}

function removeTerminalView(node: WorkspacePaneNode, terminalId: string): WorkspacePaneNode {
  if (node.type === 'leaf') {
    const tabs = node.tabs.filter((item) => item.type !== 'terminal' || item.terminalId !== terminalId)
    const activeTabStillExists = tabs.some((item) => item.id === node.activeTabId)
    return {
      ...node,
      tabs,
      activeTabId: activeTabStillExists ? node.activeTabId : tabs[0]?.id ?? null,
    }
  }

  return {
    ...node,
    first: removeTerminalView(node.first, terminalId),
    second: removeTerminalView(node.second, terminalId),
  }
}

function upsertTabInLeaf(
  node: WorkspacePaneNode,
  paneId: string,
  content: PaneContent
): WorkspacePaneNode {
  if (node.type === 'leaf') {
    if (node.id !== paneId) return node
    const existingIndex = node.tabs.findIndex((item) => item.id === content.id)
    const tabs =
      existingIndex >= 0
        ? node.tabs.map((item) => (item.id === content.id ? content : item))
        : [...node.tabs, content]
    return {
      ...node,
      tabs,
      activeTabId: content.id,
    }
  }

  return {
    ...node,
    first: upsertTabInLeaf(node.first, paneId, content),
    second: upsertTabInLeaf(node.second, paneId, content),
  }
}

export function addTerminalToPaneTree(
  node: WorkspacePaneNode | null,
  targetPaneId: string | null,
  content: TerminalPaneContent,
  fallbackPaneId: string
): { tree: WorkspacePaneNode; focus: WorkspacePaneFocus } {
  if (!node) {
    const leaf = {
      ...createEmptyPaneLeaf(fallbackPaneId),
      tabs: [content],
      activeTabId: content.id,
    }
    return {
      tree: leaf,
      focus: { paneId: leaf.id, tabId: content.id, terminalId: content.terminalId },
    }
  }

  const deduped = removeTerminalView(node, content.terminalId)
  if (!deduped) {
    const leaf = {
      ...createEmptyPaneLeaf(fallbackPaneId),
      tabs: [content],
      activeTabId: content.id,
    }
    return {
      tree: leaf,
      focus: { paneId: leaf.id, tabId: content.id, terminalId: content.terminalId },
    }
  }

  const targetPane = findLeafPane(deduped, targetPaneId) ?? getLeafPanes(deduped)[0]
  if (!targetPane) {
    return {
      tree: deduped,
      focus: {
        paneId: null,
        tabId: null,
        terminalId: null,
      },
    }
  }

  const tree = pruneEmptyPanes(upsertTabInLeaf(deduped, targetPane.id, content)) ?? {
    ...createEmptyPaneLeaf(fallbackPaneId),
    tabs: [content],
    activeTabId: content.id,
  }
  return {
    tree,
    focus: { paneId: targetPane.id, tabId: content.id, terminalId: content.terminalId },
  }
}

export function findPaneContent(
  node: WorkspacePaneNode | null,
  contentId: string
): WorkspacePaneFocus {
  for (const leaf of getLeafPanes(node)) {
    const tab = leaf.tabs.find((item) => item.id === contentId)
    if (tab) {
      return {
        paneId: leaf.id,
        tabId: tab.id,
        terminalId: tab.type === 'terminal' ? tab.terminalId : null,
      }
    }
  }
  return { paneId: null, tabId: null, terminalId: null }
}

/*-- 取回树中某个 browser 内容对象：拖拽移动/分屏时需要原 content 重新插入 --*/
export function getBrowserPaneContent(
  node: WorkspacePaneNode | null,
  surfaceId: string
): BrowserPaneContent | null {
  for (const leaf of getLeafPanes(node)) {
    const tab = leaf.tabs.find((item) => item.type === 'browser' && item.surfaceId === surfaceId)
    if (tab && tab.type === 'browser') return tab
  }
  return null
}

/*-- 按 content id 从树中移除内容并修剪空 pane（拖拽 move/split 的前半段） --*/
export function removePaneContentFromTree(
  node: WorkspacePaneNode | null,
  contentId: string
): WorkspacePaneNode | null {
  if (!node) return null

  const remove = (current: WorkspacePaneNode): WorkspacePaneNode => {
    if (current.type === 'leaf') {
      const tabs = current.tabs.filter((item) => item.id !== contentId)
      const activeTabStillExists = tabs.some((item) => item.id === current.activeTabId)
      return {
        ...current,
        tabs,
        activeTabId: activeTabStillExists ? current.activeTabId : tabs[0]?.id ?? null,
      }
    }

    return {
      ...current,
      first: remove(current.first),
      second: remove(current.second),
    }
  }

  return pruneEmptyPanes(remove(node))
}

export function addPaneContentToTree(
  node: WorkspacePaneNode | null,
  targetPaneId: string | null,
  content: PaneContent,
  fallbackPaneId: string
): { tree: WorkspacePaneNode; focus: WorkspacePaneFocus } {
  const existing = findPaneContent(node, content.id)
  if (existing.paneId && existing.tabId) {
    return {
      tree: activatePaneTab(node, existing.paneId, existing.tabId)!,
      focus: existing,
    }
  }

  const base = node ?? createEmptyPaneLeaf(fallbackPaneId)
  const targetPane = findLeafPane(base, targetPaneId) ?? getLeafPanes(base)[0]
  const tree = upsertTabInLeaf(base, targetPane.id, content)
  return {
    tree,
    focus: {
      paneId: targetPane.id,
      tabId: content.id,
      terminalId: content.type === 'terminal' ? content.terminalId : null,
    },
  }
}

export function removeTerminalFromPaneTree(
  node: WorkspacePaneNode | null,
  terminalId: string
): WorkspacePaneNode | null {
  if (!node) return null
  return pruneEmptyPanes(removeTerminalView(node, terminalId))
}

export function retainWorkspacePaneContent(
  node: WorkspacePaneNode | null,
  workspaceId: string,
  terminalIds?: ReadonlySet<string>
): WorkspacePaneNode | null {
  if (!node) return null

  const retain = (current: WorkspacePaneNode): WorkspacePaneNode => {
    if (current.type === 'leaf') {
      // Legacy tab kinds (e.g. removed janus-chat tabs in persisted snapshots)
      // match neither branch and fall out of the tree here.
      // Browser and Markdown tabs are workspace-agnostic: a browser or a draft
      // opened under this workspace stays in its snapshot across switches.
      const tabs = current.tabs.filter((item) =>
        item.type === 'browser'
        || item.type === 'markdown'
        || (item.type === 'extension' && isAvailableExtensionPane(item)
          && (item.scope === 'application' || item.projectId === workspaceId))
        || (item.type === 'terminal'
          && item.workspaceId === workspaceId
          && (!terminalIds || terminalIds.has(item.terminalId)))
      )
      return {
        ...current,
        tabs,
        activeTabId: tabs.some((item) => item.id === current.activeTabId)
          ? current.activeTabId
          : tabs[0]?.id ?? null,
      }
    }

    return {
      ...current,
      first: retain(current.first),
      second: retain(current.second),
    }
  }

  return pruneEmptyPanes(retain(node))
}

// Note: tab reorder keeps insertion-index-after-removal so the gap preview matches the drop result — see .agents/notes/workbench/pane-tab-reorder.md
function clampTabInsertIndex(length: number, index: number): number {
  if (!Number.isFinite(index)) return length
  return Math.min(length, Math.max(0, Math.floor(index)))
}

/*-- 按内容 id 取回 pane 内容对象：跨 pane 按下标移动时需要原 content 重新插入 --*/
export function getPaneContentById(
  node: WorkspacePaneNode | null,
  contentId: string
): PaneContent | null {
  if (!node) return null
  for (const leaf of getLeafPanes(node)) {
    const tab = leaf.tabs.find((item) => item.id === contentId)
    if (tab) return tab
  }
  return null
}

/*-- 同 pane 内 tab 排序：targetIndex 是摘除拖拽 tab 之后数组里的插入位，
     与 tab 条占位渲染的视觉顺序一致；落点不变时返回原节点引用 --*/
export function reorderPaneTab(
  node: WorkspacePaneNode | null,
  paneId: string,
  tabId: string,
  targetIndex: number
): WorkspacePaneNode | null {
  if (!node) return null
  if (node.type === 'leaf') {
    if (node.id !== paneId) return node
    const from = node.tabs.findIndex((item) => item.id === tabId)
    if (from < 0) return node
    const dragged = node.tabs[from]
    const rest = node.tabs.filter((item) => item.id !== tabId)
    const clamped = clampTabInsertIndex(rest.length, targetIndex)
    if (clamped === from) return node
    return {
      ...node,
      tabs: [...rest.slice(0, clamped), dragged, ...rest.slice(clamped)],
      activeTabId: dragged.id,
    }
  }

  const first = reorderPaneTab(node.first, paneId, tabId, targetIndex) ?? node.first
  const second = reorderPaneTab(node.second, paneId, tabId, targetIndex) ?? node.second
  return first === node.first && second === node.second ? node : { ...node, first, second }
}

function insertContentIntoLeaf(
  node: WorkspacePaneNode,
  targetPaneId: string,
  content: PaneContent,
  targetIndex: number
): WorkspacePaneNode {
  if (node.type === 'leaf') {
    if (node.id !== targetPaneId) return node
    const clamped = clampTabInsertIndex(node.tabs.length, targetIndex)
    return {
      ...node,
      tabs: [...node.tabs.slice(0, clamped), content, ...node.tabs.slice(clamped)],
      activeTabId: content.id,
    }
  }

  return {
    ...node,
    first: insertContentIntoLeaf(node.first, targetPaneId, content, targetIndex),
    second: insertContentIntoLeaf(node.second, targetPaneId, content, targetIndex),
  }
}

/*-- 把 tab 按下标放入目标 pane：同 pane 退化为 reorder；跨 pane 先摘除再插入，
     落点 pane 被清空修剪时回退到首个可用 pane；拖拽 tab 保持激活 --*/
export function insertPaneContentAtIndex(
  node: WorkspacePaneNode | null,
  targetPaneId: string | null,
  content: PaneContent,
  targetIndex: number,
  fallbackPaneId: string
): { tree: WorkspacePaneNode; focus: WorkspacePaneFocus } {
  const focusFor = (paneId: string): WorkspacePaneFocus => ({
    paneId,
    tabId: content.id,
    terminalId: content.type === 'terminal' ? content.terminalId : null,
  })

  const existing = findPaneContent(node, content.id)
  if (existing.paneId && existing.tabId && existing.paneId === targetPaneId) {
    const tree = reorderPaneTab(node, existing.paneId, content.id, targetIndex) ?? node!
    return { tree, focus: focusFor(existing.paneId) }
  }

  const removed = removePaneContentFromTree(node, content.id)
  const base = removed ?? createEmptyPaneLeaf(fallbackPaneId)
  const targetPane = findLeafPane(base, targetPaneId) ?? getLeafPanes(base)[0]
  if (!targetPane) {
    const leaf: WorkspacePaneLeaf = {
      ...createEmptyPaneLeaf(fallbackPaneId),
      tabs: [content],
      activeTabId: content.id,
    }
    return { tree: leaf, focus: focusFor(leaf.id) }
  }

  const tree = insertContentIntoLeaf(base, targetPane.id, content, targetIndex)
  return { tree, focus: focusFor(targetPane.id) }
}

export function closePaneTab(
  node: WorkspacePaneNode | null,
  paneId: string,
  tabId: string
): WorkspacePaneNode | null {
  if (!node) return null
  if (node.type === 'leaf') {
    if (node.id !== paneId) return node
    const tabs = node.tabs.filter((item) => item.id !== tabId)
    if (tabs.length === 0) return null
    const activeTabStillExists = tabs.some((item) => item.id === node.activeTabId)
    return {
      ...node,
      tabs,
      activeTabId: activeTabStillExists ? node.activeTabId : tabs[0]?.id ?? null,
    }
  }

  const first = closePaneTab(node.first, paneId, tabId)
  const second = closePaneTab(node.second, paneId, tabId)
  if (!first && !second) return null
  if (!first) return second
  if (!second) return first

  return {
    ...node,
    first,
    second,
  }
}

export function splitPaneTree(
  node: WorkspacePaneNode | null,
  paneId: string | null,
  direction: PaneSplitDirection,
  newSplitId: string,
  newPaneId: string,
  placement: PaneSplitPlacement = 'after',
  ratio = 0.5
): { tree: WorkspacePaneNode | null; focus: WorkspacePaneFocus } {
  if (!node) {
    const leaf = createEmptyPaneLeaf(newPaneId)
    return { tree: leaf, focus: { paneId: leaf.id, tabId: null, terminalId: null } }
  }

  const targetPaneId = findLeafPane(node, paneId)?.id ?? getLeafPanes(node)[0]?.id ?? null
  if (!targetPaneId) {
    return { tree: node, focus: resolvePaneFocus(node, paneId, null) }
  }

  const split = (current: WorkspacePaneNode): WorkspacePaneNode => {
    if (current.type === 'leaf') {
      if (current.id !== targetPaneId) return current
      const newPane = createEmptyPaneLeaf(newPaneId)
      return {
        type: 'split',
        id: newSplitId,
        direction,
        ratio,
        first: placement === 'before' ? newPane : current,
        second: placement === 'before' ? current : newPane,
      }
    }

    return {
      ...current,
      first: split(current.first),
      second: split(current.second),
    }
  }

  return {
    tree: split(node),
    focus: { paneId: newPaneId, tabId: null, terminalId: null },
  }
}

export function collapsePaneTree(
  node: WorkspacePaneNode | null,
  preferredTerminalId: string | null
): { tree: WorkspacePaneNode | null; focus: WorkspacePaneFocus } {
  if (!node) {
    return { tree: null, focus: { paneId: null, tabId: null, terminalId: null } }
  }

  const leaves = getLeafPanes(node)
  const targetLeaf = leaves[0]
  if (!targetLeaf) {
    return { tree: null, focus: { paneId: null, tabId: null, terminalId: null } }
  }

  const seenTerminalIds = new Set<string>()
  const tabs = leaves
    .flatMap((leaf) => leaf.tabs)
    .filter((tab) => {
      if (seenTerminalIds.has(tab.id)) return false
      seenTerminalIds.add(tab.id)
      return true
    })
  const activeTab = tabs.find((tab) => tab.type === 'terminal' && tab.terminalId === preferredTerminalId) ?? tabs[0] ?? null
  const tree: WorkspacePaneLeaf = {
    type: 'leaf',
    id: targetLeaf.id,
    tabs,
    activeTabId: activeTab?.id ?? null,
  }

  return {
    tree,
    focus: {
      paneId: tree.id,
      tabId: activeTab?.id ?? null,
      terminalId: activeTab?.type === 'terminal' ? activeTab.terminalId : null,
    },
  }
}

function appendTabsToFirstLeaf(
  node: WorkspacePaneNode,
  tabsToAppend: PaneContent[]
): { node: WorkspacePaneNode; focus: WorkspacePaneFocus } {
  if (node.type === 'leaf') {
    const existing = new Set(node.tabs.map((item) => item.id))
    const tabs = [...node.tabs, ...tabsToAppend.filter((item) => !existing.has(item.id))]
    const activeTab = tabsToAppend[0] ?? node.tabs.find((item) => item.id === node.activeTabId) ?? tabs[0]
    const nextNode = {
      ...node,
      tabs,
      activeTabId: activeTab?.id ?? null,
    }
    return {
      node: nextNode,
      focus: {
        paneId: nextNode.id,
        tabId: activeTab?.id ?? null,
        terminalId: activeTab?.type === 'terminal' ? activeTab.terminalId : null,
      },
    }
  }

  const first = appendTabsToFirstLeaf(node.first, tabsToAppend)
  return {
    node: { ...node, first: first.node },
    focus: first.focus,
  }
}

function findAndRemoveLeaf(
  node: WorkspacePaneNode,
  paneId: string
): { node: WorkspacePaneNode; focus: WorkspacePaneFocus; removed: boolean } {
  if (node.type === 'leaf') {
    return {
      node,
      focus: resolvePaneFocus(node, node.id, node.activeTabId),
      removed: false,
    }
  }

  if (node.first.type === 'leaf' && node.first.id === paneId) {
    const merged = appendTabsToFirstLeaf(node.second, node.first.tabs)
    return { node: merged.node, focus: merged.focus, removed: true }
  }

  if (node.second.type === 'leaf' && node.second.id === paneId) {
    const merged = appendTabsToFirstLeaf(node.first, node.second.tabs)
    return { node: merged.node, focus: merged.focus, removed: true }
  }

  const first = findAndRemoveLeaf(node.first, paneId)
  if (first.removed) {
    return { node: { ...node, first: first.node }, focus: first.focus, removed: true }
  }

  const second = findAndRemoveLeaf(node.second, paneId)
  if (second.removed) {
    return { node: { ...node, second: second.node }, focus: second.focus, removed: true }
  }

  return {
    node,
    focus: resolvePaneFocus(node, paneId, null),
    removed: false,
  }
}

export function unsplitPaneTree(
  node: WorkspacePaneNode | null,
  paneId: string | null
): { tree: WorkspacePaneNode | null; focus: WorkspacePaneFocus } {
  if (!node || !paneId || node.type === 'leaf') {
    return { tree: node, focus: resolvePaneFocus(node, paneId, null) }
  }

  const result = findAndRemoveLeaf(node, paneId)
  return {
    tree: result.node,
    focus: result.focus,
  }
}

export function resizeSplitPane(
  node: WorkspacePaneNode | null,
  splitId: string,
  ratio: number
): WorkspacePaneNode | null {
  if (!node) return null
  const clampedRatio = Math.min(0.85, Math.max(0.15, ratio))
  if (node.type === 'split') {
    if (node.id === splitId) {
      return {
        ...node,
        ratio: clampedRatio,
      }
    }

    return {
      ...node,
      first: resizeSplitPane(node.first, splitId, clampedRatio) ?? node.first,
      second: resizeSplitPane(node.second, splitId, clampedRatio) ?? node.second,
    }
  }

  return node
}
