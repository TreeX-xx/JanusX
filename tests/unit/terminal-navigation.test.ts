import type { Terminal } from '@xterm/xterm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  handleTerminalPageKey, registerTerminalNavigation, scrollTerminalPage,
  subscribeTerminalNavigation, terminalViewportState,
} from '../../src/renderer/src/lib/terminal-navigation'

function fixture(type = 'normal', mouseTrackingMode = 'none') {
  const events: Record<string, () => void> = {}
  const dispose = vi.fn()
  const term = {
    buffer: { active: { type, viewportY: 60, baseY: 60 },
      onBufferChange: (fn: () => void) => { events.buffer = fn; return { dispose } } },
    onScroll: (fn: () => void) => { events.scroll = fn; return { dispose } },
    onWriteParsed: (fn: () => void) => { events.parsed = fn; return { dispose } },
    modes: { mouseTrackingMode }, rows: 30, input: vi.fn(), focus: vi.fn(),
    element: { querySelector: vi.fn() },
  }
  const scroll = vi.fn()
  const unregister = registerTerminalNavigation('test', term as unknown as Terminal, scroll)
  cleanups.push(unregister)
  return { term, events, scroll, unregister, dispose }
}
const cleanups: Array<() => void> = []
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); vi.unstubAllGlobals() })

describe('native terminal scrolling', () => {
  it('scrolls the normal buffer without sending input to the shell', () => {
    const { term, scroll } = fixture()
    scrollTerminalPage('test', -1)
    scrollTerminalPage('test', 1)
    expect(scroll.mock.calls).toEqual([[-1], [1]])
    expect(term.input).not.toHaveBeenCalled()
  })

  it('updates normal-buffer bounds after scrolling and new output, then enables TUI scrolling', () => {
    const { term, events } = fixture()
    const listener = vi.fn()
    cleanups.push(subscribeTerminalNavigation(listener))
    expect(terminalViewportState('test')).toEqual({ canUp: true, canDown: false, hasScrollback: true })
    term.buffer.active.viewportY = 0
    events.scroll()
    expect(terminalViewportState('test')).toEqual({ canUp: false, canDown: true, hasScrollback: true })
    term.buffer.active.viewportY = term.buffer.active.baseY = 0
    events.parsed()
    expect(terminalViewportState('test')).toEqual({ canUp: false, canDown: false, hasScrollback: false })
    term.buffer.active.type = 'alternate'
    events.buffer()
    expect(terminalViewportState('test')).toEqual({ canUp: true, canDown: true, hasScrollback: false })
    events.parsed()
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('uses native page keys when an alternate-screen app has no mouse protocol', () => {
    const { term, scroll } = fixture('alternate')
    scrollTerminalPage('test', -1)
    scrollTerminalPage('test', 1)
    expect(term.input.mock.calls).toEqual([['\x1b[5~', true], ['\x1b[6~', true]])
    expect(scroll).not.toHaveBeenCalled()
  })

  it('dispatches native wheel events using current geometry after a split resize', () => {
    vi.stubGlobal('WheelEvent', class { constructor(public type: string, public options: WheelEventInit) {} })
    const { term } = fixture('alternate', 'any')
    let rect = { left: 20, top: 80, width: 600, height: 400 }
    const screen = { getBoundingClientRect: () => rect, dispatchEvent: vi.fn() }
    term.element.querySelector.mockReturnValue(screen)
    scrollTerminalPage('test', -1)
    rect = { left: 350, top: 40, width: 240, height: 180 }
    term.rows = 12
    scrollTerminalPage('test', 1)
    expect(screen.dispatchEvent.mock.calls.map(([event]) => event.options)).toEqual([
      { bubbles: true, cancelable: true, clientX: 320, clientY: 280, deltaMode: 1, deltaY: -15 },
      { bubbles: true, cancelable: true, clientX: 470, clientY: 130, deltaMode: 1, deltaY: 6 },
    ])
    expect(term.input).not.toHaveBeenCalled()
  })

  it('does not unregister a replacement terminal when an old mount cleans up', () => {
    const old = fixture()
    const replacement = fixture('alternate')
    old.unregister()
    scrollTerminalPage('test', 1)
    expect(replacement.term.input).toHaveBeenCalledWith('\x1b[6~', true)
    replacement.unregister()
    expect(terminalViewportState('test')).toEqual({ canUp: false, canDown: false, hasScrollback: false })
    scrollTerminalPage('test', -1)
    expect(replacement.term.input).toHaveBeenCalledTimes(1)
  })

  it('forwards shifted page keys once in fullscreen while preserving shell shortcuts', () => {
    const { term } = fixture('alternate')
    const event = { type: 'keydown', key: 'PageUp', shiftKey: true, preventDefault: vi.fn(), stopPropagation: vi.fn() }
    expect(handleTerminalPageKey(term as unknown as Terminal, event as unknown as KeyboardEvent)).toBe(true)
    event.type = 'keyup'
    expect(handleTerminalPageKey(term as unknown as Terminal, event as unknown as KeyboardEvent)).toBe(true)
    expect(term.input.mock.calls).toEqual([['\x1b[5~', true]])
    term.buffer.active.type = 'normal'
    expect(handleTerminalPageKey(term as unknown as Terminal, event as unknown as KeyboardEvent)).toBe(false)
  })
})
