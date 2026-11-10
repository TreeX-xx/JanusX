/** Joint island geometry uses viewport space, never its own shifted DOM box. */
import { layoutCompanionIslands } from '../island/islandLayout'

export const MEMO_PANEL_GAP = 12
export const MEMO_PANEL_MIN_WIDTH = 260
export const MEMO_PANEL_MAX_WIDTH = 460
/** Keeps the panel off the viewport edges and bounds the host's slide. */
export const MEMO_PANEL_MARGIN = 12
export const MEMO_PANEL_MIN_HEIGHT = 220

export interface MemoPanelBox {
  left: number
  top: number
  width: number
  height: number
}

export interface MemoPanelLayout {
  box: MemoPanelBox
  /** How far the host may slide left to clear the panel, clamped so it stays on screen. */
  shift: number
}

export type MemoIslandMode = 'parallel' | 'compact' | 'stacked' | 'focus'
export type MemoIslandPane = 'chat' | 'memo'

export interface MemoIslandLayout {
  mode: MemoIslandMode
  main: MemoPanelBox
  memo: MemoPanelBox
  compactFiles: boolean
  switcher?: MemoPanelBox
}

export function layoutMemoIslands({ viewportWidth, viewportHeight, filesCollapsed = false, previousMode, topInset = MEMO_PANEL_MARGIN }: {
  viewportWidth: number
  viewportHeight: number
  filesCollapsed?: boolean
  previousMode?: MemoIslandMode
  /** Reserve native titlebar controls before distributing the remaining height. */
  topInset?: number
}): MemoIslandLayout {
  const { companion, compact, ...layout } = layoutCompanionIslands({ viewportWidth, viewportHeight, previousMode, topInset, side: 'right', horizontalGap: 56, railWidth: 48 })
  return { ...layout, memo: companion, compactFiles: filesCollapsed || compact }
}

/** Standalone chat fallback: dock against its visual (possibly scaled) box. */
export function layoutMemoPanel(host: {
  hostLeft: number
  hostWidth: number
  hostTop: number
  hostHeight: number
  viewportWidth: number
  viewportHeight: number
}): MemoPanelLayout {
  const { hostLeft, hostWidth, hostTop, hostHeight, viewportWidth, viewportHeight } = host
  const width = Math.min(
    MEMO_PANEL_MAX_WIDTH,
    Math.max(MEMO_PANEL_MIN_WIDTH, viewportWidth - hostLeft - hostWidth - MEMO_PANEL_GAP - MEMO_PANEL_MARGIN),
    Math.max(1, viewportWidth - MEMO_PANEL_MARGIN * 2)
  )
  const left = Math.max(
    MEMO_PANEL_MARGIN,
    Math.min(hostLeft + hostWidth + MEMO_PANEL_GAP, viewportWidth - MEMO_PANEL_MARGIN - width)
  )
  const top = Math.max(MEMO_PANEL_MARGIN, Math.min(hostTop, viewportHeight - MEMO_PANEL_MARGIN - 1))
  const height = Math.max(1, Math.min(Math.max(MEMO_PANEL_MIN_HEIGHT, hostHeight), viewportHeight - top - MEMO_PANEL_MARGIN))
  const box: MemoPanelBox = { left, top, width, height }
  // Only slide the host when the panel actually reaches into it.
  const overlap = hostLeft + hostWidth + MEMO_PANEL_GAP - box.left
  const shiftRoom = Math.max(0, hostLeft - MEMO_PANEL_MARGIN)
  return { box, shift: 0 - Math.min(Math.max(0, overlap), shiftRoom) }
}
