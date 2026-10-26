// Note: module navigation retains selection and viewport — .agents/notes/blueprint/navigation/requirements/module-browsing.md
import type { Blueprint } from '../../shared/janus/types'
import { projectArchitecture } from './architecture-view'
import { projectModuleBrowse, UNASSIGNED_SCOPE } from './module-browsing'

export type GraphViewport = { x: number; y: number; zoom: number }
export type NavigationEntry = { nodeId: string | null; scopeId: string | null; viewport?: GraphViewport }
export type NavigationHistory = { entries: NavigationEntry[]; index: number }

export function navigateNote(history: NavigationHistory, blueprint: Blueprint, nodeId: string): NavigationHistory {
  const previous = history.entries[history.index]
  const projection = projectArchitecture(blueprint)
  const browse = projectModuleBrowse(blueprint, projection, previous?.scopeId ?? null)
  const scopeId = browse.graph.nodes[nodeId] ? browse.scopeId
    : browse.owners[nodeId] ?? (projection.roles[nodeId] ? nodeId : UNASSIGNED_SCOPE)
  return pushNavigation(history, { nodeId, scopeId, ...(previous?.scopeId === scopeId ? { viewport: previous.viewport } : {}) })
}

export function pushNavigation(history: NavigationHistory, entry: NavigationEntry): NavigationHistory {
  const previous = history.entries[history.index]
  if (previous?.nodeId === entry.nodeId && previous.scopeId === entry.scopeId) return history
  return { entries: [...history.entries.slice(0, history.index + 1), entry], index: history.index + 1 }
}

export function rememberViewport(history: NavigationHistory, viewport: GraphViewport): NavigationHistory {
  const previous = history.entries[history.index]
  if (!previous || previous.viewport?.x === viewport.x && previous.viewport.y === viewport.y && previous.viewport.zoom === viewport.zoom) return history
  return { ...history, entries: history.entries.map((entry, index) => index === history.index ? { ...entry, viewport } : entry) }
}
