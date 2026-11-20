import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/renderer/src/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('../../src/renderer/src/components/knowledge/useAssistantPendingCount', () => ({ useAssistantPendingCount: () => null }))
import {
  CENTER_WORKSPACE_MIN_WIDTH,
  getRightDockLayout,
  RIGHT_TOOL_RAIL_WIDTH,
} from '../../src/renderer/src/components/right-tools/layout'
import { RightToolRail } from '../../src/renderer/src/components/right-tools/RightToolRail'
import {
  retryToolErrorBoundary,
  RightToolHost,
} from '../../src/renderer/src/components/right-tools/RightToolHost'

describe('right dock layout', () => {
  it('reserves docked panel space and keeps collapsed or empty rails compact', () => {
    expect(RIGHT_TOOL_RAIL_WIDTH).toBe(48)
    expect(CENTER_WORKSPACE_MIN_WIDTH).toBe(320)
    for (const panelCollapsed of [true, false]) {
      for (const hasActiveTool of [true, false]) {
        expect(getRightDockLayout({ availableWidth: 1000, panelCollapsed, panelWidth: 280, hasActiveTool }))
          .toMatchObject({ dockWidth: !panelCollapsed && hasActiveTool ? 328 : 48, effectiveCollapsed: panelCollapsed, responsiveAutoCollapsed: false })
      }
    }
  })
  it('restores per-tool widths and protects the center on narrow viewports', () => {
    const input = { panelCollapsed: false, panelWidth: 280, panelWidths: { sessions: 480, files: 310 }, hasActiveTool: true }
    expect(getRightDockLayout({ ...input, availableWidth: 1200, activeToolId: 'sessions' })).toMatchObject({ panelWidth: 480, dockWidth: 528 })
    expect(getRightDockLayout({ ...input, availableWidth: 1200, activeToolId: 'files' })).toMatchObject({ panelWidth: 310, dockWidth: 358 })
    expect(getRightDockLayout({ ...input, availableWidth: 400, activeToolId: 'sessions' })).toMatchObject({ panelWidth: 340, effectiveCollapsed: true, dockWidth: 48 })
    expect(input.panelWidths.sessions).toBe(480)
  })
  it('shrinks the file tree before collapsing it on a narrow viewport', () => {
    const input = { panelCollapsed: false, panelWidth: 280, activeToolId: 'files', hasActiveTool: true }
    expect(getRightDockLayout({ ...input, availableWidth: 800 })).toMatchObject({ panelWidth: 320, dockWidth: 368 })
    expect(getRightDockLayout({ ...input, availableWidth: 660 })).toMatchObject({ panelWidth: 292, dockWidth: 340, effectiveCollapsed: false })
    expect(getRightDockLayout({ ...input, availableWidth: 600 })).toMatchObject({ effectiveCollapsed: true, dockWidth: 48 })
  })
})

describe('right dock lifecycle shell', () => {
  it('keeps open tool subtrees mounted and inert when the dock is hidden', () => {
    const markup = renderToStaticMarkup(
      createElement(RightToolHost, {
        openToolIds: ['files', 'git'],
        activeToolId: 'files',
        workspaceId: null,
        workspacePath: null,
        dockVisible: false,
        onClose: vi.fn(),
      }),
    )

    expect(markup).toContain('hidden=""')
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain('inert=""')
    expect(markup).toContain('right-tool-panel-files')
    expect(markup).toContain('right-tool-panel-git')
  })

  it('clears the error and advances the remount key on retry', () => {
    expect(retryToolErrorBoundary({ failed: true, retryKey: 4 })).toEqual({
      failed: false,
      retryKey: 5,
    })
  })
})

describe('right tool rail', () => {
  it('exposes all tools with non-color-only closed, open and active states', () => {
    const markup = renderToStaticMarkup(
      createElement(RightToolRail, {
        openToolIds: ['files', 'git'],
        activeToolId: 'git',
        onToggleTool: vi.fn(),
      }),
    )

    expect(markup).toContain('role="toolbar"')
    expect(markup).toContain('data-state="closed"')
    expect(markup).toContain('data-state="open"')
    expect(markup).toContain('data-state="active"')
    expect(markup).not.toContain('折叠右侧工具面板')
    expect(markup).not.toContain('展开右侧工具面板')
    expect(markup).toContain('common:rightTool.railButtonAria')
    expect(markup).not.toContain('office')
  })

  it('associates each collapsed icon with its own panel', () => {
    const markup = renderToStaticMarkup(
      createElement(RightToolRail, {
        openToolIds: ['files'],
        activeToolId: 'files',
        onToggleTool: vi.fn(),
        collapsed: true,
      }),
    )

    expect(markup).toContain('aria-controls="right-tool-panel-files"')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).not.toContain('common:rightDock.expandAria')
  })

  it('hides the panel toggle when no tool is open', () => {
    const markup = renderToStaticMarkup(
      createElement(RightToolRail, {
        openToolIds: [],
        activeToolId: null,
        onToggleTool: vi.fn(),
        collapsed: true,
      }),
    )

    expect(markup).not.toContain('aria-controls="right-tool-panel"')
    expect(markup).not.toContain('common:rightDock.expandAria')
  })
})
