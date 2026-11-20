import { useLayoutEffect, useRef } from 'react'
import '@/styles/outside-press.css'

let openSurfaces = 0

// A titlebar drag region and a preview iframe otherwise own their input.
// Note: .agents/notes/workbench/island-hifi-optimized-alignment.md
export function useOutsidePress(active: boolean, isInside: (target: Node) => boolean, dismiss: () => void): void {
  const handlers = useRef({ isInside, dismiss })
  useLayoutEffect(() => { handlers.current = { isInside, dismiss } }, [isInside, dismiss])
  useLayoutEffect(() => {
    if (!active) return
    const root = document.documentElement
    if (++openSurfaces === 1) root.setAttribute('data-outside-press', '')

    let dismissedOnPointerDown = false
    const handlePress = (event: MouseEvent) => {
      // Keyboard activation is handled by the focused control, not as an outside press.
      if (event.type === 'click' && event.detail === 0) return
      const alreadyDismissed = event.type === 'click' && dismissedOnPointerDown
      dismissedOnPointerDown = false
      if (alreadyDismissed || !(event.target instanceof Node) || handlers.current.isInside(event.target)) return
      dismissedOnPointerDown = event.type === 'pointerdown'
      handlers.current.dismiss()
    }
    document.addEventListener('pointerdown', handlePress, true)
    document.addEventListener('click', handlePress, true)
    return () => {
      document.removeEventListener('pointerdown', handlePress, true)
      document.removeEventListener('click', handlePress, true)
      if (--openSurfaces === 0) root.removeAttribute('data-outside-press')
    }
  }, [active])
}
