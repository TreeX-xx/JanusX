import { afterEach, describe, expect, it } from 'vitest'
import { layoutAutomationIsland } from '../../src/renderer/src/components/automations/automationIslandLayout'
import { useIslandStore } from '../../src/renderer/src/stores/island'
import { useSuperAgentUIStore } from '../../src/renderer/src/stores/superagent-ui'
import { useGlobalToolsStore } from '../../src/renderer/src/stores/global-tools'

afterEach(() => {
  useIslandStore.setState({ automationLocked: false })
  useIslandStore.getState().releaseCompanion()
  useIslandStore.getState().dispatch({ type: 'dismiss' })
  useSuperAgentUIStore.setState({ started: false })
})

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
  it('opens without a prefill and stays locked until the panel releases it', () => {
    useIslandStore.setState({ automationLocked: true })
    useIslandStore.getState().openChat('', 'automations')
    expect(useIslandStore.getState()).toMatchObject({ stage: 'expanded', companionToolId: 'automations', chatRequest: { prefill: '' } })
    useIslandStore.getState().dispatch({ type: 'dismiss' })
    expect(useIslandStore.getState()).toMatchObject({ stage: 'expanded', companionToolId: 'automations' })
    useIslandStore.getState().releaseCompanion()
    useIslandStore.setState({ automationLocked: false })
    useIslandStore.getState().dispatch({ type: 'dismiss' })
    expect(useIslandStore.getState()).toMatchObject({ stage: 'collapsed', companionToolId: null })
  })
  it('keeps the connection across terminal changes and other chat requests', () => {
    useIslandStore.setState({ automationLocked: true })
    useIslandStore.getState().openChat('', 'automations')
    useIslandStore.getState().dispatch({ type: 'terminal-changed' })
    expect(useIslandStore.getState()).toMatchObject({ stage: 'expanded', companionToolId: 'automations' })
    useIslandStore.getState().openChat('', 'automations')
    useIslandStore.getState().openChat('Another request')
    expect(useIslandStore.getState()).toMatchObject({ stage: 'expanded', companionToolId: 'automations', chatRequest: { prefill: 'Another request' } })
  })
  it('keeps chat pinned while memo temporarily owns the companion geometry', () => {
    useIslandStore.setState({ automationLocked: true })
    useIslandStore.getState().openChat('', 'automations')
    useIslandStore.getState().releaseCompanion()
    useIslandStore.getState().dispatch({ type: 'dismiss' })
    expect(useIslandStore.getState()).toMatchObject({ stage: 'expanded', automationLocked: true, companionToolId: null })
  })
  it('retains the connection when chat is hosted by SuperAgent rather than expanded Island', () => {
    useSuperAgentUIStore.setState({ started: true })
    useIslandStore.getState().openChat('', 'automations')
    expect(useIslandStore.getState()).toMatchObject({ stage: 'collapsed', companionToolId: 'automations', chatRequest: { prefill: '' } })
    expect(useGlobalToolsStore.getState()).toMatchObject({ focusedTabId: 'superagent', collapsed: false })
    useIslandStore.getState().dispatch({ type: 'dismiss' })
    expect(useIslandStore.getState().companionToolId).toBe('automations')
    useIslandStore.getState().releaseCompanion()
    expect(useIslandStore.getState().companionToolId).toBeNull()
    expect(useGlobalToolsStore.getState().focusedTabId).toBe('superagent')
  })
})
