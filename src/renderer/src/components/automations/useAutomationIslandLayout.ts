import { useLayoutEffect, useState, type RefObject } from 'react'
import { useIslandStore } from '@/stores/island'
import { layoutAutomationIsland } from './automationIslandLayout'

/** Geometry is temporary: dismissing or leaving the automation panel restores both surfaces. */
export function useAutomationIslandLayout(shellRef: RefObject<HTMLDivElement>, enabled: boolean) {
  const [veil, setVeil] = useState<{ right: number; bottom: number } | null>(null)
  const [automationRoot, setAutomationRoot] = useState<HTMLElement | null>(null)
  // Automatic routing may need to load the lazy tool view before measuring it.
  useLayoutEffect(() => {
    if (!enabled) { setAutomationRoot(null); return }
    const findPanel = () => {
      const root = document.querySelector<HTMLElement>('.automation-panel')
      if (!root || root.closest('[hidden], [aria-hidden="true"]')) return false
      setAutomationRoot(root)
      return true
    }
    if (findPanel()) return
    const observer = new MutationObserver(() => { if (findPanel()) observer.disconnect() })
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'aria-hidden'] })
    return () => observer.disconnect()
  }, [enabled])
  useLayoutEffect(() => {
    if (!enabled) { setVeil(null); return }
    const island = shellRef.current
    const automation = automationRoot
    const panel = automation?.closest<HTMLElement>('#right-tool-panel') ?? automation
    if (!island || !automation || !panel) return
    const cluster = island.closest<HTMLElement>('.janus-island-cluster')
    const owners = [island, cluster].filter((element): element is HTMLElement => Boolean(element))
    const region = automation.closest<HTMLElement>('[id="right-tool-panel-automations"]')
    let frame = 0
    const apply = () => {
      if (!automation.isConnected || automation.closest('[hidden], [aria-hidden="true"]')) {
        useIslandStore.getState().releaseCompanion(); return
      }
      // Memo owns geometry until its exit restores the Island. Its attribute
      // observer below retries; cancelling here loses the incoming draft focus.
      if (island.hasAttribute('data-memo-layout')) return
      const bounds = panel.getBoundingClientRect()
      const dockTop = panel.closest('aside')?.getBoundingClientRect().top ?? 40
      const layout = layoutAutomationIsland({ viewportWidth: window.innerWidth, viewportHeight: window.innerHeight, panelLeft: bounds.left, dockTop })
      for (const element of owners) {
        element.dataset.toolCompanion = layout.mode
        for (const [key, value] of Object.entries(layout.island)) element.style.setProperty(`--tool-island-${key}`, `${value}px`)
      }
      panel.dataset.islandCompanion = 'automations'
      panel.style.setProperty('--island-companion-offset', `${layout.panelOffset}px`)
      setVeil(previous => previous?.right === layout.veil.right && previous.bottom === layout.veil.bottom ? previous : layout.veil)
    }
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(apply) }
    const resize = new ResizeObserver(schedule)
    resize.observe(panel)
    const mutation = new MutationObserver(schedule)
    if (region) mutation.observe(region, { attributes: true, attributeFilter: ['hidden', 'aria-hidden'] })
    mutation.observe(island, { attributes: true, attributeFilter: ['data-memo-layout'] })
    window.addEventListener('resize', schedule)
    apply()
    return () => {
      cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect()
      window.removeEventListener('resize', schedule)
      for (const element of owners) {
        delete element.dataset.toolCompanion
        for (const key of ['left', 'top', 'width', 'height']) element.style.removeProperty(`--tool-island-${key}`)
      }
      delete panel.dataset.islandCompanion
      panel.style.removeProperty('--island-companion-offset')
    }
  }, [shellRef, enabled, automationRoot])
  return enabled ? veil : null
}
