import { afterEach, describe, expect, it } from 'vitest'
import { layoutAutomationIsland } from '../../src/renderer/src/components/automations/automationIslandLayout'
import { useIslandStore } from '../../src/renderer/src/stores/island'

afterEach(() => useIslandStore.getState().dispatch({ type: 'dismiss' }))

describe('automation companion geometry', () => {
  for (const [viewportWidth, viewportHeight, panelLeft] of [[1400, 900, 932], [1024, 720, 556], [680, 780, 212], [480, 640, 12]]) {
    it(`keeps both surfaces separate at ${viewportWidth} × ${viewportHeight}`, () => {
      const layout = layoutAutomationIsland({ viewportWidth, viewportHeight, panelLeft, dockTop: 40 })
      const box = layout.island
      expect(box.left).toBeGreaterThanOrEqual(0)
      expect(box.left + box.width + 48).toBeLessThanOrEqual(viewportWidth)
      expect(box.top + box.height).toBeLessThanOrEqual(viewportHeight)
      if (layout.mode === 'parallel') {
        expect(box.left + box.width + 48).toBeLessThan(panelLeft)
        expect(layout.panelOffset).toBe(0)
        expect(viewportWidth - layout.veil.right).toBe(panelLeft)
      } else {
        expect(box.top + box.height).toBeLessThan(40 + layout.panelOffset)
        expect(viewportHeight - layout.veil.bottom).toBe(40 + layout.panelOffset)
        expect(viewportHeight - 40 - layout.panelOffset).toBeGreaterThan(200)
      }
    })
  }
})

describe('Island companion lifetime', () => {
  it('announces workspace-loading opportunities only on opening or explicit chat activation', () => {
    useIslandStore.getState().dispatch({ type: 'dismiss' })
    const sequence = useIslandStore.getState().openSequence
    useIslandStore.getState().dispatch({ type: 'single-activate' })
    expect(useIslandStore.getState().openSequence).toBe(sequence)
    useIslandStore.getState().dispatch({ type: 'double-activate' })
    expect(useIslandStore.getState().openSequence).toBe(sequence + 1)
    useIslandStore.getState().openChat()
    expect(useIslandStore.getState().openSequence).toBe(sequence + 2)
    useIslandStore.getState().dispatch({ type: 'dismiss' })
    expect(useIslandStore.getState().openSequence).toBe(sequence + 2)
  })
  it('opens without a prefill and releases the lock on dismissal', () => {
    useIslandStore.getState().openChat('', 'automations')
    expect(useIslandStore.getState()).toMatchObject({ stage: 'expanded', companionToolId: 'automations', chatRequest: { prefill: '' } })
    useIslandStore.getState().dispatch({ type: 'dismiss' })
    expect(useIslandStore.getState()).toMatchObject({ stage: 'collapsed', companionToolId: null })
  })
  it('releases when the terminal changes or another chat entry takes over', () => {
    useIslandStore.getState().openChat('', 'automations')
    useIslandStore.getState().dispatch({ type: 'terminal-changed' })
    expect(useIslandStore.getState().companionToolId).toBeNull()
    useIslandStore.getState().openChat('', 'automations')
    useIslandStore.getState().openChat('Another request')
    expect(useIslandStore.getState()).toMatchObject({ stage: 'expanded', companionToolId: null, chatRequest: { prefill: 'Another request' } })
  })
})
