import { describe, expect, it } from 'vitest'
import {
  layoutMemoPanel,
  layoutMemoIslands,
  MEMO_PANEL_MARGIN,
  MEMO_PANEL_MAX_WIDTH,
  MEMO_PANEL_MIN_WIDTH,
} from '../../src/renderer/src/components/memo/memoLayout'

/** Standalone fallback host; joint island layout does not read this shifted box. */
const islandAt = (viewportWidth: number) => {
  const hostWidth = Math.min(900, viewportWidth - 72)
  return { hostWidth, hostLeft: (viewportWidth - hostWidth) / 2, hostTop: 12, hostHeight: 460 }
}

describe('memo panel layout', () => {
  it('keeps both the panel and the host inside the viewport at every window width', () => {
    for (const viewportWidth of [800, 1000, 1200, 1400, 1444, 1600, 1920]) {
      const host = islandAt(viewportWidth)
      const { box, shift } = layoutMemoPanel({ ...host, viewportWidth, viewportHeight: 720 })
      const at = (what: string) => `${what} at viewport ${viewportWidth}`
      expect(box.left, at('panel left')).toBeGreaterThanOrEqual(MEMO_PANEL_MARGIN)
      expect(box.left + box.width, at('panel right')).toBeLessThanOrEqual(viewportWidth - MEMO_PANEL_MARGIN)
      expect(host.hostLeft + shift + host.hostWidth, at('host right')).toBeLessThanOrEqual(viewportWidth - MEMO_PANEL_MARGIN)
      expect(box.width, at('width')).toBeGreaterThanOrEqual(MEMO_PANEL_MIN_WIDTH)
      expect(box.width, at('width')).toBeLessThanOrEqual(MEMO_PANEL_MAX_WIDTH)
    }
  })

  it('leaves the host alone when the panel already fits beside it', () => {
    const viewportWidth = 1920
    const host = islandAt(viewportWidth)
    const { box, shift } = layoutMemoPanel({ ...host, viewportWidth, viewportHeight: 720 })
    expect(shift).toBe(0)
    expect(box.left).toBeGreaterThanOrEqual(host.hostLeft + host.hostWidth)
  })

  it('slides the host exactly as far as the panel reaches into it', () => {
    const viewportWidth = 1400
    const host = islandAt(viewportWidth)
    const { box, shift } = layoutMemoPanel({ ...host, viewportWidth, viewportHeight: 720 })
    // 260px of panel beside a 250px right margin cannot fit side by side, so the
    // host slides left until the 12px gap is restored.
    expect(shift).toBe(box.left - 12 - host.hostLeft - host.hostWidth)
    expect(host.hostLeft + shift + host.hostWidth).toBeLessThan(box.left)
  })

  it('never pushes the host off the right edge, even at the narrowest width', () => {
    for (const viewportWidth of [900, 980, 1100]) {
      const host = islandAt(viewportWidth)
      const { shift } = layoutMemoPanel({ ...host, viewportWidth, viewportHeight: 720 })
      expect(host.hostLeft + shift + host.hostWidth, `host right at ${viewportWidth}`).toBeLessThanOrEqual(viewportWidth - MEMO_PANEL_MARGIN)
    }
  })

  it('clamps the panel into a viewport narrower than its minimum width', () => {
    const { box } = layoutMemoPanel({ hostLeft: 40, hostWidth: 300, hostTop: 12, hostHeight: 400, viewportWidth: 220, viewportHeight: 600 })
    expect(box.left).toBeGreaterThanOrEqual(MEMO_PANEL_MARGIN)
    expect(box.left + box.width).toBeLessThanOrEqual(220 - MEMO_PANEL_MARGIN)
  })

  it('clamps the panel height into the viewport', () => {
    const { box } = layoutMemoPanel({ hostLeft: 400, hostWidth: 450, hostTop: 300, hostHeight: 600, viewportWidth: 1280, viewportHeight: 640 })
    expect(box.top + box.height).toBeLessThanOrEqual(640 - MEMO_PANEL_MARGIN)
    expect(box.height).toBeGreaterThan(0)
  })
})

describe('joint memo and main island layout', () => {
  it('keeps both islands within bounds and separated across window sizes', () => {
    for (const [viewportWidth, viewportHeight] of [[1920, 900], [1400, 900], [1280, 720], [1024, 600], [1000, 600], [960, 500], [800, 900], [600, 676]]) {
      const layout = layoutMemoIslands({ viewportWidth, viewportHeight })
      for (const box of [layout.main, layout.memo]) {
        expect(box.left).toBeGreaterThanOrEqual(12)
        expect(box.top).toBeGreaterThanOrEqual(12)
        expect(box.left + box.width).toBeLessThanOrEqual(viewportWidth - 12)
        expect(box.top + box.height).toBeLessThanOrEqual(viewportHeight - 12)
      }
      if (layout.mode === 'stacked') expect(layout.main.top + layout.main.height + 12).toBe(layout.memo.top)
      else {
        expect(layout.main.left + layout.main.width + 56).toBe(layout.memo.left)
        expect((layout.main.left + layout.memo.left + layout.memo.width) / 2).toBe(viewportWidth / 2)
        expect(layout.main.width).toBeGreaterThanOrEqual(560)
      }
    }
  })

  it('keeps full memo width at 1280 and folds files at the native window minimum', () => {
    const full = layoutMemoIslands({ viewportWidth: 1280, viewportHeight: 720 })
    expect(full.mode).toBe('parallel')
    expect(full.memo.width).toBe(460)
    expect(full.main.width).toBe(740)
    const compact = layoutMemoIslands({ viewportWidth: 1000, viewportHeight: 600 })
    expect(compact.mode).toBe('compact')
    expect(compact.compactFiles).toBe(true)
    expect(compact.memo.width).toBe(320)
  })

  it('only stacks when both minimum heights fit, otherwise reserves a focus switch', () => {
    expect(layoutMemoIslands({ viewportWidth: 800, viewportHeight: 676 }).mode).toBe('stacked')
    const focus = layoutMemoIslands({ viewportWidth: 800, viewportHeight: 600 })
    expect(focus.mode).toBe('focus')
    expect(focus.main).toEqual(focus.memo)
    expect(focus.switcher!.top + focus.switcher!.height + 12).toBe(focus.main.top)
    expect(focus.memo.top + focus.memo.height).toBe(588)
  })

  it('degrades before clipping and uses recovery room at mode boundaries', () => {
    expect(layoutMemoIslands({ viewportWidth: 1055, viewportHeight: 720, previousMode: 'parallel' }).mode).toBe('compact')
    expect(layoutMemoIslands({ viewportWidth: 1060, viewportHeight: 720, previousMode: 'compact' }).mode).toBe('compact')
    expect(layoutMemoIslands({ viewportWidth: 1132, viewportHeight: 720, previousMode: 'compact' }).mode).toBe('parallel')
    expect(layoutMemoIslands({ viewportWidth: 800, viewportHeight: 700, previousMode: 'focus' }).mode).toBe('focus')
    expect(layoutMemoIslands({ viewportWidth: 800, viewportHeight: 708, previousMode: 'focus' }).mode).toBe('stacked')
  })

  it('keeps a manual file collapse even after the window grows', () => {
    const layout = layoutMemoIslands({ viewportWidth: 1920, viewportHeight: 900, filesCollapsed: true })
    expect(layout.compactFiles).toBe(true)
    expect(layout.memo.width).toBe(460)
    const expanded = layoutMemoIslands({ viewportWidth: 1920, viewportHeight: 900 })
    expect(layout.main).toEqual(expanded.main)
    expect(layout.memo).toEqual(expanded.memo)
  })

  it('reserves native titlebar space when deciding pane height and stacking', () => {
    const compact = layoutMemoIslands({ viewportWidth: 1000, viewportHeight: 600, topInset: 50 })
    expect(compact.main.top).toBe(50)
    expect(compact.memo.height).toBe(538)
    expect(compact.memo.top + compact.memo.height).toBe(588)
    expect(layoutMemoIslands({ viewportWidth: 800, viewportHeight: 700, topInset: 50 }).mode).toBe('focus')
    expect(layoutMemoIslands({ viewportWidth: 800, viewportHeight: 714, topInset: 50 }).mode).toBe('stacked')
  })
})
