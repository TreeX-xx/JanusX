import { describe, expect, it } from 'vitest'
import { getAuxiliaryWorkspaceLayout, projectMinimumWidth } from '../../src/renderer/src/lib/auxiliary-layout'
import type { WorkspacePaneNode } from '../../src/renderer/src/lib/workspace-pane'

const input = {
  availableWidth: 1400, panelCollapsed: true, panelWidth: 360, hasActiveTool: true,
  hasProject: true, projectTree: null, toolsRequested: true,
  editorRequested: true, editorWidth: 560, editorWasCompact: false, priority: 'editor' as const,
}

describe('auxiliary workspace geometry', () => {
  it('preserves the preferred editor width when all three regions fit', () => {
    const layout = getAuxiliaryWorkspaceLayout(input)
    expect(layout.editorVisible).toBe(true)
    expect(layout.editorWidth).toBe(560)
    expect(input.availableWidth - layout.editorWidth - layout.rightDockLayout.dockWidth).toBeGreaterThanOrEqual(569)
  })

  it('lets the explicitly restored panel take priority without changing either preference', () => {
    const narrow = { ...input, availableWidth: 800 }
    const editor = getAuxiliaryWorkspaceLayout(narrow)
    const tools = getAuxiliaryWorkspaceLayout({ ...narrow, priority: 'tools' })
    expect(editor.editorVisible).toBe(true)
    expect(tools.editorVisible).toBe(false)
    expect(tools.editorWidth).toBe(0)
    expect(narrow.availableWidth - tools.rightDockLayout.dockWidth).toBeGreaterThanOrEqual(569)
    expect(narrow).toMatchObject({ toolsRequested: true, editorRequested: true, editorWidth: 560 })
    expect(getAuxiliaryWorkspaceLayout({ ...narrow, availableWidth: 1400 }).editorWidth).toBe(560)
  })

  it('uses a restore margin to prevent toggling around the editor minimum', () => {
    const narrow = { ...input, availableWidth: 727 }
    expect(getAuxiliaryWorkspaceLayout(narrow).editorVisible).toBe(false)
    expect(getAuxiliaryWorkspaceLayout({ ...narrow, availableWidth: 740, editorWasCompact: true }).editorVisible).toBe(false)
    expect(getAuxiliaryWorkspaceLayout({ ...narrow, availableWidth: 752, editorWasCompact: true }).editorVisible).toBe(true)
    expect(getAuxiliaryWorkspaceLayout({ ...narrow, availableWidth: 740 }).editorVisible).toBe(true)
  })

  it('never reopens a manually hidden editor when space returns', () => {
    expect(getAuxiliaryWorkspaceLayout({ ...input, editorRequested: false }).editorVisible).toBe(false)
  })

  it('keeps the right dock allocation independent of tools versus editor priority', () => {
    const layout = getAuxiliaryWorkspaceLayout({ ...input, availableWidth: 1000, panelCollapsed: false,
      editorRequested: false, priority: 'tools' })
    expect(layout.rightDockLayout.effectiveCollapsed).toBe(false)
    expect(layout.rightDockLayout.panelWidth).toBe(360)
  })

  it('reserves existing project splits before giving width to the editor', () => {
    const leaf = (id: string) => ({ type: 'leaf', id, tabs: [], activeTabId: null }) as WorkspacePaneNode
    const projectTree = { type: 'split', id: 'split', direction: 'horizontal', ratio: .35,
      first: leaf('left'), second: leaf('right') } as WorkspacePaneNode
    const minimum = projectMinimumWidth(projectTree)
    const layout = getAuxiliaryWorkspaceLayout({ ...input, availableWidth: 1200, projectTree })
    expect(layout.centerReserve).toBe(minimum)
    expect(1200 - layout.rightDockLayout.dockWidth - layout.editorWidth).toBeGreaterThanOrEqual(minimum)
  })

  it('keeps no-project tools restorable alongside files', () => {
    const layout = getAuxiliaryWorkspaceLayout({ ...input, availableWidth: 800, hasProject: false, priority: 'tools' })
    expect(layout.editorVisible).toBe(true)
    expect(800 - layout.rightDockLayout.dockWidth - layout.editorWidth).toBeGreaterThanOrEqual(320)
  })
})
