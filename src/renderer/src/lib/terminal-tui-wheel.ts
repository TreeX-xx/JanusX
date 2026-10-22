import type { Terminal } from '@xterm/xterm'

const REPLAYED_WHEEL = '__janusxReplayedTerminalWheel'
const DEFAULT_CELL_HEIGHT = 16
const MAX_REPORTS = 48
const DOM_DELTA_LINE = 1
const DOM_DELTA_PAGE = 2

type WheelWithReplayMark = WheelEvent & { [REPLAYED_WHEEL]?: boolean }
type WheelDistanceState = { direction: -1 | 0 | 1; remainder: number }

export function createTerminalWheelDistanceState(): WheelDistanceState {
  return { direction: 0, remainder: 0 }
}

export function resolveTerminalTuiWheelReports(
  event: Pick<WheelEvent, 'deltaY' | 'deltaMode'>,
  state: WheelDistanceState,
  cellHeight = DEFAULT_CELL_HEIGHT,
  rows = 1,
): number {
  const direction = event.deltaY < 0 ? -1 : 1
  if (state.direction !== 0 && state.direction !== direction) state.remainder = 0
  state.direction = direction

  const distance = event.deltaMode === DOM_DELTA_LINE
    ? Math.abs(event.deltaY)
    : event.deltaMode === DOM_DELTA_PAGE
      ? Math.abs(event.deltaY) * Math.max(1, rows)
      : Math.abs(event.deltaY) / Math.max(1, cellHeight)
  const limited = Math.min(MAX_REPORTS, distance)
  const total = state.remainder + limited
  const reports = Math.trunc(total)
  state.remainder = total - reports
  return reports
}

export function attachTerminalTuiWheelHandler(terminal: Terminal): void {
  const state = createTerminalWheelDistanceState()
  terminal.attachCustomWheelEventHandler((event) => {
    if ((event as WheelWithReplayMark)[REPLAYED_WHEEL]) return true
    if (terminal.modes.mouseTrackingMode === 'none' || event.deltaY === 0 || event.shiftKey || event.ctrlKey || event.metaKey) return true

    const target = event.currentTarget instanceof EventTarget ? event.currentTarget : terminal.element
    if (!target) return true
    const cellHeight = terminal.element?.querySelector<HTMLElement>('.xterm-screen')
      ?.getBoundingClientRect().height
    const reports = resolveTerminalTuiWheelReports(
      event,
      state,
      cellHeight ? cellHeight / Math.max(1, terminal.rows) : DEFAULT_CELL_HEIGHT,
      terminal.rows,
    ) * (event.altKey ? 5 : 1)

    queueMicrotask(() => {
      for (let index = 0; index < Math.min(120, reports); index += 1) {
        target.dispatchEvent(cloneWheelReport(event))
      }
    })
    return false
  })
}

function cloneWheelReport(event: WheelEvent): WheelEvent {
  const clone = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    clientX: event.clientX,
    clientY: event.clientY,
    ctrlKey: event.ctrlKey,
    // Alt is a host acceleration gesture, not an application mouse modifier.
    altKey: false,
    metaKey: event.metaKey,
    deltaY: event.deltaY < 0 ? -1 : 1,
    deltaMode: DOM_DELTA_LINE,
  }) as WheelWithReplayMark
  Object.defineProperty(clone, REPLAYED_WHEEL, { value: true })
  return clone
}
