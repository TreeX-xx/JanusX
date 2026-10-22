import type { Terminal } from '@xterm/xterm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  attachTerminalTuiWheelHandler,
  createTerminalWheelDistanceState,
  resolveTerminalTuiWheelReports,
} from '../../src/renderer/src/lib/terminal-tui-wheel'

describe('terminal TUI wheel distance', () => {
  it('carries fractional trackpad movement between events', () => {
    const state = createTerminalWheelDistanceState()
    expect(resolveTerminalTuiWheelReports({ deltaY: 5, deltaMode: 0 }, state, 20)).toBe(0)
    expect(resolveTerminalTuiWheelReports({ deltaY: 15, deltaMode: 0 }, state, 20)).toBe(1)
  })

  it('maps line and page deltas to bounded terminal reports', () => {
    const state = createTerminalWheelDistanceState()
    expect(resolveTerminalTuiWheelReports({ deltaY: 3, deltaMode: 1 }, state)).toBe(3)
    expect(resolveTerminalTuiWheelReports({ deltaY: 1, deltaMode: 2 }, state, 16, 40)).toBe(40)
    expect(resolveTerminalTuiWheelReports({ deltaY: 1200, deltaMode: 0 }, state, 16, 40)).toBe(48)
  })

  it('drops fractional momentum when direction changes', () => {
    const state = createTerminalWheelDistanceState()
    resolveTerminalTuiWheelReports({ deltaY: 10, deltaMode: 0 }, state, 16)
    expect(resolveTerminalTuiWheelReports({ deltaY: -8, deltaMode: 0 }, state, 16)).toBe(0)
  })
})

describe('native TUI wheel forwarding', () => {
  afterEach(() => vi.unstubAllGlobals())
  function fixture() {
    let handler: (event: WheelEvent) => boolean
    const target = new EventTarget()
    const reports: Array<{ deltaY: number; altKey: boolean }> = []
    target.addEventListener('wheel', event => {
      const wheel = event as WheelEvent
      reports.push({ deltaY: wheel.deltaY, altKey: wheel.altKey })
    })
    vi.stubGlobal('WheelEvent', class extends Event {
      constructor(type: string, options: WheelEventInit) {
        super(type, options)
        for (const [key, value] of Object.entries(options)) Object.defineProperty(this, key, { value })
      }
    })
    const terminal = { modes: { mouseTrackingMode: 'any' }, rows: 30,
      attachCustomWheelEventHandler: (fn: typeof handler) => { handler = fn } }
    attachTerminalTuiWheelHandler(terminal as unknown as Terminal)
    const send = (options: Partial<WheelEvent>) => handler({ currentTarget: target, deltaY: -3, deltaMode: 1, ...options } as unknown as WheelEvent)
    return { reports, send }
  }

  it('accelerates Alt wheel five times without sending Alt mouse modifiers to the app', async () => {
    const { reports, send } = fixture()
    expect(send({ altKey: true })).toBe(false)
    await Promise.resolve()
    expect(reports).toHaveLength(15)
    expect(reports.every(report => report.deltaY === -1 && !report.altKey)).toBe(true)
  })

  it('bounds each accelerated burst and leaves other modified gestures to xterm', async () => {
    const { reports, send } = fixture()
    send({ altKey: true, deltaY: 10000 })
    await Promise.resolve()
    expect(reports).toHaveLength(120)
    expect(send({ shiftKey: true })).toBe(true)
    expect(send({ ctrlKey: true })).toBe(true)
    expect(send({ metaKey: true })).toBe(true)
    await Promise.resolve()
    expect(reports).toHaveLength(120)
  })
})
