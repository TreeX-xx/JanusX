// Note: .agents/notes/workbench/requirements/auxiliary-panels-preview-controls.md
import type { WorkspacePaneNode } from './workspace-pane'
import { getRightDockLayout, CENTER_WORKSPACE_MIN_WIDTH, RIGHT_TOOL_RAIL_WIDTH } from '@/components/right-tools/layout'

export const TOOLS_MIN_WIDTH = 320
export const TOOLS_DIVIDER_WIDTH = 9
export const EDITOR_MIN_WIDTH = 360
export const PANEL_RESTORE_MARGIN = 24

export function projectMinimumWidth(tree: WorkspacePaneNode | null): number {
  if (!tree || tree.type === 'leaf') return 240
  const first = projectMinimumWidth(tree.first)
  const second = projectMinimumWidth(tree.second)
  return tree.direction === 'horizontal'
    ? Math.max(first / tree.ratio, second / (1 - tree.ratio)) + TOOLS_DIVIDER_WIDTH
    : Math.max(first, second)
}

export function auxiliaryToolsReserve(hasProject: boolean, tree: WorkspacePaneNode | null): number {
  return hasProject ? projectMinimumWidth(tree) + TOOLS_MIN_WIDTH + TOOLS_DIVIDER_WIDTH : TOOLS_MIN_WIDTH
}

export function getAuxiliaryWorkspaceLayout(input: Parameters<typeof getRightDockLayout>[0] & {
  hasProject: boolean
  projectTree: WorkspacePaneNode | null
  toolsRequested: boolean
  editorRequested: boolean
  editorWidth: number
  editorWasCompact: boolean
  priority: 'tools' | 'editor'
}) {
  const projectReserve = Math.max(CENTER_WORKSPACE_MIN_WIDTH, input.hasProject ? projectMinimumWidth(input.projectTree) : 0)
  const centerReserve = input.priority === 'tools' && input.toolsRequested
    ? Math.max(projectReserve, auxiliaryToolsReserve(input.hasProject, input.projectTree) + PANEL_RESTORE_MARGIN)
    : projectReserve
  const editorCanFit = input.availableWidth >= centerReserve + EDITOR_MIN_WIDTH + RIGHT_TOOL_RAIL_WIDTH
  const rightDockLayout = getRightDockLayout({ ...input,
    availableWidth: input.availableWidth - (input.editorRequested && editorCanFit ? EDITOR_MIN_WIDTH : 0)
      - (projectReserve - CENTER_WORKSPACE_MIN_WIDTH),
  })
  const editorAvailableWidth = input.availableWidth - rightDockLayout.dockWidth - centerReserve
  const editorVisible = input.editorRequested && editorAvailableWidth >= EDITOR_MIN_WIDTH + (input.editorWasCompact ? PANEL_RESTORE_MARGIN : 0)
  const editorMaxWidth = Math.max(EDITOR_MIN_WIDTH, editorAvailableWidth)
  return {
    centerReserve, rightDockLayout, editorMaxWidth, editorVisible,
    editorWidth: editorVisible ? Math.max(EDITOR_MIN_WIDTH, Math.min(editorMaxWidth, input.editorWidth)) : 0,
  }
}
