import type { Terminal } from '@xterm/xterm'

// Note: .agents/notes/terminal/terminal-scrollback-navigation.md
export interface TerminalViewportState { canUp: boolean; canDown: boolean; hasScrollback: boolean }
const EMPTY: TerminalViewportState = { canUp: false, canDown: false, hasScrollback: false }
const terminals = new Map<string, Terminal>()
const scroll = new Map<string, (direction: -1 | 1) => void>()
const states = new Map<string, TerminalViewportState>()
const listeners = new Set<() => void>()
export function subscribeTerminalNavigation(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function terminalViewportState(id: string) { return states.get(id) ?? EMPTY }
export function registerTerminalNavigation(id: string, terminal: Terminal, scrollPage: (direction: -1 | 1) => void) {
  terminals.set(id, terminal)
  scroll.set(id, scrollPage)
  const update = () => {
    if (terminals.get(id) !== terminal) return
    const buffer = terminal.buffer.active
    // An alternate-screen app owns its bounds; never infer its history from baseY=0.
    const next = { canUp: buffer.type === 'alternate' || buffer.viewportY > 0,
      canDown: buffer.type === 'alternate' || buffer.viewportY < buffer.baseY,
      hasScrollback: buffer.type === 'normal' && buffer.baseY > 0 }
    const previous = terminalViewportState(id)
    if (previous.canUp === next.canUp && previous.canDown === next.canDown && previous.hasScrollback === next.hasScrollback) return
    states.set(id, next)
    listeners.forEach(listener => listener())
  }
  const scrollEvent = terminal.onScroll(update)
  const buffer = terminal.buffer.onBufferChange(update)
  const parsed = terminal.onWriteParsed(update)
  update()
  return () => {
    scrollEvent.dispose()
    buffer.dispose()
    parsed.dispose()
    if (terminals.get(id) !== terminal) return
    terminals.delete(id)
    scroll.delete(id)
    states.delete(id)
    listeners.forEach(listener => listener())
  }
}
export function focusTerminal(id: string) { terminals.get(id)?.focus() }
export function scrollTerminalPage(id: string, direction: -1 | 1) {
  const term = terminals.get(id)
  if (!term) return
  if (term.buffer.active.type === 'normal') {
    scroll.get(id)?.(direction)
  } else if (term.modes.mouseTrackingMode !== 'none') {
    // Use the app's mouse protocol and current geometry, including after a split resize.
    const screen = term.element?.querySelector('.xterm-screen')
    if (!screen) return
    const rect = screen.getBoundingClientRect()
    screen.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true,
      clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
      deltaY: direction * Math.max(1, Math.floor(term.rows / 2)), deltaMode: 1 }))
  } else {
    term.input(direction < 0 ? '\x1b[5~' : '\x1b[6~', true)
  }
}

export function handleTerminalPageKey(terminal: Terminal, event: KeyboardEvent): boolean {
  if (terminal.buffer.active.type !== 'alternate' || !event.shiftKey || event.ctrlKey || event.altKey || event.metaKey
    || (event.key !== 'PageUp' && event.key !== 'PageDown')) return false
  event.preventDefault()
  event.stopPropagation()
  if (event.type === 'keydown') terminal.input(event.key === 'PageUp' ? '\x1b[5~' : '\x1b[6~', true)
  return true
}
