import { getPaneDropHint, midpointInsertIndex, paneDropHintLabel, type PaneDropHint } from './pane-drop-hint'
import styles from '@/components/TerminalArea.module.css'

export type PaneTabDrop =
  | { paneId: string; index: number; zone?: never }
  | { paneId: string; zone: PaneDropHint; index?: never }

interface PaneTabDragOptions {
  root: HTMLElement
  source: HTMLElement
  event: PointerEvent
  onActiveChange: (active: boolean) => void
  onDrop: (target: PaneTabDrop) => void
}

interface Strip {
  element: HTMLElement
  tabs: HTMLElement[]
  slot: HTMLElement
  spacer: HTMLElement
  gap: number
}

// Note: pointer previews use untransformed tab geometry and commit only on release — see .agents/notes/workbench/pane-tab-reorder.md
export function startPaneTabDrag({ root, source, event, onActiveChange, onDrop }: PaneTabDragOptions): () => void {
  const pointerId = event.pointerId
  const origin = { x: event.clientX, y: event.clientY }
  let pointer = origin
  let active = false
  let disposed = false
  let frame = 0
  let previousTime = 0
  let target: PaneTabDrop | null = null
  let overlay: HTMLElement | null = null
  let clone: HTMLElement | null = null
  let hint: HTMLElement | null = null
  let strips: Strip[] = []
  let grabX = 0
  let grabY = 0
  let width = 0
  const restoredStyles = new Map<HTMLElement, string | null>()
  const remember = (element: HTMLElement) => {
    if (!restoredStyles.has(element)) restoredStyles.set(element, element.getAttribute('style'))
  }
  const restore = () => {
    for (const [element, style] of restoredStyles) {
      if (style === null) element.removeAttribute('style')
      else element.setAttribute('style', style)
    }
  }
  let removeClickBlock = () => {}
  const blockClickUntilRelease = () => {
    const release = (next: PointerEvent) => {
      if (next.pointerId === pointerId) window.setTimeout(removeClickBlock, 0)
    }
    const suppress = (click: MouseEvent) => {
      click.preventDefault()
      click.stopImmediatePropagation()
      removeClickBlock()
    }
    removeClickBlock = () => {
      window.removeEventListener('click', suppress, true)
      window.removeEventListener('pointerup', release, true)
      window.removeEventListener('pointerdown', removeClickBlock, true)
    }
    // Esc can precede pointerup by any duration. A fresh gesture clears the block.
    window.addEventListener('click', suppress, true)
    window.addEventListener('pointerup', release, true)
    window.addEventListener('pointerdown', removeClickBlock, true)
  }
  const cleanup = () => {
    if (disposed) return
    disposed = true
    cancelAnimationFrame(frame)
    window.removeEventListener('pointermove', move, true)
    window.removeEventListener('pointerup', up, true)
    window.removeEventListener('pointercancel', cancelPointer, true)
    window.removeEventListener('keydown', keydown, true)
    window.removeEventListener('blur', cleanup)
    window.removeEventListener('resize', cleanup)
    document.removeEventListener('visibilitychange', visibility)
    source.removeEventListener('lostpointercapture', cleanup)
    if (source.hasPointerCapture(pointerId)) source.releasePointerCapture(pointerId)
    overlay?.remove()
    restore()
    if (active) {
      onActiveChange(false)
      blockClickUntilRelease()
    }
  }
  const activate = () => {
    const rect = source.getBoundingClientRect()
    width = rect.width
    grabX = origin.x - rect.left
    grabY = origin.y - rect.top
    strips = Array.from(root.querySelectorAll<HTMLElement>('[data-tab-strip]'))
      .filter((element) => element.getBoundingClientRect().width > 0)
      .map((element) => ({
        element,
        tabs: Array.from(element.querySelectorAll<HTMLElement>('[data-tab-id]')),
        slot: element.querySelector<HTMLElement>('[data-tab-drag-slot]')!,
        spacer: element.querySelector<HTMLElement>('[data-tab-drag-spacer]')!,
        gap: Number.parseFloat(getComputedStyle(element).columnGap) || 0,
      }))
    if (!strips.some((strip) => strip.tabs.includes(source)) || strips.some((strip) => !strip.slot || !strip.spacer)) {
      cleanup()
      return
    }
    active = true
    // App's perspective/rotateX ancestors establish a fixed containing block.
    // Keep viewport-coordinate visuals under body and carry their inherited theme.
    overlay = document.createElement('div')
    overlay.setAttribute('data-tab-drag-overlay', '')
    overlay.setAttribute('aria-hidden', 'true')
    overlay.inert = true
    const theme = getComputedStyle(source)
    for (const property of theme) {
      if (property.startsWith('--')) overlay.style.setProperty(property, theme.getPropertyValue(property))
    }
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', zIndex: '10000', pointerEvents: 'none', fontFamily: theme.fontFamily,
    })
    document.body.appendChild(overlay)
    clone = source.cloneNode(true) as HTMLElement
    clone.removeAttribute('data-tab-id')
    clone.removeAttribute('id')
    clone.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'))
    clone.setAttribute('data-tab-drag-clone', '')
    clone.setAttribute('aria-hidden', 'true')
    clone.inert = true
    Object.assign(clone.style, {
      position: 'fixed', left: '0', top: '0', width: `${width}px`, height: `${rect.height}px`,
      margin: '0', zIndex: '10000', pointerEvents: 'none', transition: 'none',
      background: 'var(--shell-chrome-raised)', borderRadius: '7px', boxShadow: '0 6px 20px color-mix(in srgb, var(--shadow-color) 20%, transparent)', opacity: '.95',
    })
    overlay.appendChild(clone)
    hint = document.createElement('div')
    hint.setAttribute('data-tab-drag-hint', '')
    hint.setAttribute('aria-hidden', 'true')
    hint.className = styles.dropHint
    Object.assign(hint.style, {
      position: 'fixed', zIndex: '9999', pointerEvents: 'none', display: 'none',
    })
    const label = document.createElement('span')
    label.className = styles.dropLabel
    hint.appendChild(label)
    overlay.appendChild(hint)
    for (const strip of strips) {
      remember(strip.slot)
      remember(strip.spacer)
      for (const tab of strip.tabs) {
        remember(tab)
        tab.style.transition = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'none' : 'transform 160ms ease'
      }
    }
    remember(source)
    source.style.opacity = '0'
    remember(document.body)
    document.body.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'
    source.setPointerCapture(pointerId)
    onActiveChange(true)
  }
  const update = (elapsed: number) => {
    if (!source.isConnected || root.getBoundingClientRect().width === 0 || strips.some((strip) => {
      const current = strip.element.querySelectorAll('[data-tab-id]')
      return current.length !== strip.tabs.length || strip.tabs.some((tab, index) => current[index] !== tab)
    })) {
      cleanup()
      return
    }
    clone!.style.transform = `translate3d(${pointer.x - grabX}px, ${pointer.y - grabY}px, 0)`
    const hit = document.elementFromPoint(pointer.x, pointer.y)
    const hitStrip = hit?.closest<HTMLElement>('[data-tab-strip]')
    const strip = strips.find((item) => item.element === hitStrip)
    target = null
    hint!.style.display = 'none'
    if (strip) {
      const rect = strip.element.getBoundingClientRect()
      // Continue scrolling while the pointer rests at an edge, including without new pointer events.
      const edge = Math.min(32, rect.width / 4)
      const speed = pointer.x < rect.left + edge
        ? -Math.min(1, (rect.left + edge - pointer.x) / edge)
        : pointer.x > rect.right - edge ? Math.min(1, (pointer.x - rect.right + edge) / edge) : 0
      strip.element.scrollLeft += speed * elapsed * .6
      const remaining = strip.tabs.filter((tab) => tab !== source)
      const index = midpointInsertIndex(remaining.map((tab) => ({
        // offsetLeft excludes the animated transform, so a stationary pointer never flips slots.
        left: rect.left + strip.element.clientLeft + tab.offsetLeft - strip.element.scrollLeft,
        width: tab.offsetWidth,
      })), pointer.x)
      target = { paneId: strip.element.dataset.tabStrip!, index }
    } else {
      const pane = hit?.closest<HTMLElement>('[data-pane-id]')
      if (pane && root.contains(pane)) {
        const zone = getPaneDropHint(pane, pointer.x, pointer.y)
        target = { paneId: pane.dataset.paneId!, zone }
        const rect = pane.getBoundingClientRect()
        Object.assign(hint!.style, {
          display: 'flex',
          left: `${rect.left + (zone === 'right' ? rect.width / 2 : 0)}px`,
          top: `${rect.top + (zone === 'bottom' ? rect.height / 2 : 0)}px`,
          width: `${zone === 'left' || zone === 'right' ? rect.width / 2 : rect.width}px`,
          height: `${zone === 'top' || zone === 'bottom' ? rect.height / 2 : rect.height}px`,
        })
        hint!.firstElementChild!.textContent = paneDropHintLabel(zone)
        hint!.dataset.zone = zone
      }
    }
    for (const item of strips) {
      const isTarget = item === strip && target !== null && target.index !== undefined
      const index = isTarget ? target!.index! : -1
      const isSource = item.tabs.includes(source)
      item.spacer.style.width = isTarget && !isSource ? `${width}px` : '0px'
      item.slot.style.display = isTarget ? 'block' : 'none'
      let left = item.tabs[0]?.offsetLeft ?? 0
      let slotLeft = left
      let position = 0
      for (const tab of item.tabs) {
        if (tab === source) continue
        if (position === index) {
          slotLeft = left
          left += width + item.gap
        }
        tab.style.transform = `translateX(${left - tab.offsetLeft}px)`
        left += tab.offsetWidth + item.gap
        position += 1
      }
      if (index === position) slotLeft = left
      item.slot.style.left = `${slotLeft}px`
      item.slot.style.width = `${width}px`
    }
  }
  const tick = (time: number) => {
    update(previousTime ? Math.min(time - previousTime, 32) : 0)
    previousTime = time
    if (!disposed) frame = requestAnimationFrame(tick)
  }
  const move = (next: PointerEvent) => {
    if (next.pointerId !== pointerId) return
    pointer = { x: next.clientX, y: next.clientY }
    if (!active && Math.hypot(pointer.x - origin.x, pointer.y - origin.y) < 6) return
    if (next.cancelable) next.preventDefault()
    if (!active) {
      activate()
      if (!disposed) tick(performance.now())
    }
  }
  const up = (next: PointerEvent) => {
    if (next.pointerId !== pointerId) return
    if (active) {
      pointer = { x: next.clientX, y: next.clientY }
      update(0)
      if (disposed) return
      next.preventDefault()
    }
    const drop = target
    cleanup()
    window.setTimeout(removeClickBlock, 0)
    if (drop) onDrop(drop)
  }
  const cancelPointer = (next: PointerEvent) => { if (next.pointerId === pointerId) cleanup() }
  const keydown = (next: KeyboardEvent) => {
    if (next.key !== 'Escape') return
    next.preventDefault()
    next.stopPropagation()
    cleanup()
  }
  const visibility = () => { if (document.hidden) cleanup() }
  window.addEventListener('pointermove', move, { capture: true, passive: false })
  window.addEventListener('pointerup', up, true)
  window.addEventListener('pointercancel', cancelPointer, true)
  window.addEventListener('keydown', keydown, true)
  window.addEventListener('blur', cleanup)
  window.addEventListener('resize', cleanup)
  document.addEventListener('visibilitychange', visibility)
  source.addEventListener('lostpointercapture', cleanup)
  return cleanup
}
