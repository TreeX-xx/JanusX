import type { IslandBox } from '../island/islandLayout'

/** Reserve the actual dock bounds, including floating previews in narrow windows. */
export function layoutAutomationIsland({ viewportWidth, viewportHeight, panelLeft, dockTop }: {
  viewportWidth: number; viewportHeight: number; panelLeft: number; dockTop: number
}): { mode: 'parallel' | 'stacked'; island: IslandBox; panelOffset: number; veil: { right: number; bottom: number } } {
  const margin = 12
  const actionRail = 48
  const top = dockTop + margin
  const availableHeight = Math.max(1, viewportHeight - top - margin)
  if (panelLeft >= 360 + margin * 2 + actionRail) {
    const width = Math.min(860, panelLeft - margin * 2 - actionRail)
    return { mode: 'parallel', island: { left: (panelLeft - width - actionRail) / 2, top, width, height: Math.min(640, availableHeight) },
      panelOffset: 0, veil: { right: viewportWidth - panelLeft, bottom: 0 } }
  }
  const height = Math.max(1, Math.floor((availableHeight - margin) / 2))
  return { mode: 'stacked', island: { left: margin, top, width: Math.max(1, viewportWidth - margin * 2 - actionRail), height },
    panelOffset: height + margin * 2, veil: { right: 0, bottom: Math.max(0, viewportHeight - top - height - margin) } }
}
