import { describe, expect, it } from 'vitest'
import type { Terminal } from '../../src/renderer/src/types'
import { getTerminalStatusVisual, summarizeTerminalActivity, terminalStatusRingClass } from '../../src/renderer/src/lib/terminal-sidebar-visual'
import { DEFAULT_APP_THEME } from '../../src/shared/ipc/theme'
import { defineTheme, getThemeDefinition, removeTheme } from '../../src/shared/theme/registry'

function terminal(id: string, status: Terminal['status']): Terminal {
  return {
    id,
    workspaceId: 'workspace-1',
    name: id,
    preset: 'shell',
    cwd: 'C:/workspace',
    shell: 'powershell.exe',
    pid: null,
    status,
  }
}

describe('terminal sidebar visuals', () => {
  it('summarizes total, running, attention, and error terminals for the workspace badge', () => {
    expect(summarizeTerminalActivity([
      terminal('one', 'running'),
      terminal('two', 'wait'),
      terminal('three', 'error'),
      terminal('four', 'needs-approval'),
      terminal('five', 'needs-input'),
      terminal('six', 'degraded'),
    ])).toEqual({
      total: 6,
      running: 1,
      errors: 1,
      needsApproval: 1,
      needsInput: 1,
      degraded: 1,
      needsAction: 3,
    })
  })

  it('maps every status to one shared ring shape (sidebar rows and middle tabs read one language)', () => {
    // running 淡环+走圈光弧、待处理共用呼吸、degraded 虚线环、error 实心盘、wait 降透明度
    expect(terminalStatusRingClass('running')).toBe('term-status-ring--running')
    expect(terminalStatusRingClass('needs-approval')).toBe('term-status-pulse')
    expect(terminalStatusRingClass('needs-input')).toBe('term-status-pulse')
    expect(terminalStatusRingClass('degraded')).toBe('term-status-ring--degraded')
    expect(terminalStatusRingClass('error')).toBe('term-status-ring--error')
    expect(terminalStatusRingClass('wait')).toBe('term-status-ring--idle')
  })

  it('uses localized labels with a unified attention visual', () => {
    expect(getTerminalStatusVisual('running').label).toBe('运行中')
    expect(getTerminalStatusVisual('wait').label).toBe('空闲')
    expect(getTerminalStatusVisual('needs-input').label).toBe('待处理')
    expect(getTerminalStatusVisual('needs-approval').label).toBe('待处理')
    expect(getTerminalStatusVisual('degraded').label).toBe('受限')
    expect(getTerminalStatusVisual('error').label).toBe('异常')
    expect(getTerminalStatusVisual('needs-input').color).toBe(getTerminalStatusVisual('needs-approval').color)
    // 经典黑六态五色；石板色 attention/error 同为朱红（刻意单点睛），六态四色
    const dark = ['running', 'wait', 'needs-input', 'needs-approval', 'degraded', 'error'].map((status) =>
      getTerminalStatusVisual(status as Terminal['status'], 'dark').color
    )
    expect(new Set(dark).size).toBe(5)
    const planche = ['running', 'wait', 'needs-input', 'needs-approval', 'degraded', 'error'].map((status) =>
      getTerminalStatusVisual(status as Terminal['status'], 'planche').color
    )
    expect(new Set(planche).size).toBe(4)
  })

  it('reads status colors from the theme definition (M1 unified structure)', () => {
    const base = getThemeDefinition('dark')
    const theme = { ...base, id: 'test-status-slots', status: { ...base.status,
      running: { color: '#123456', background: '#234567' },
      attention: { color: '#345678', background: '#456789' },
    } }
    defineTheme(theme)
    try {
      for (const [status, slot] of [
        ['running', 'running'], ['wait', 'wait'], ['needs-input', 'attention'],
        ['needs-approval', 'attention'], ['degraded', 'degraded'], ['error', 'error'],
      ] as const) {
        const visual = getTerminalStatusVisual(status, theme.id)
        expect({ color: visual.color, background: visual.background }).toEqual(theme.status[slot])
      }
      expect(getTerminalStatusVisual('running', 'nope').color).toBe(getThemeDefinition(DEFAULT_APP_THEME).status.running.color)
    } finally { removeTheme(theme.id) }
  })
})
