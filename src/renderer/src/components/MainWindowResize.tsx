import { useEffect, useRef } from 'react'
import { WINDOW_RESIZE_EDGES } from '../../../shared/ipc/system'
import styles from './MainWindowResize.module.css'

// Note: .agents/notes/desktop/window-controls.md
export function MainWindowResize() {
  const stop = useRef<(() => void) | null>(null)
  const resize = window.electron.window.dragMainResize
  useEffect(() => () => stop.current?.(), [])
  if (window.electron.platform !== 'darwin' || !resize) return null

  return <div className={styles.handles} aria-hidden="true">
    {WINDOW_RESIZE_EDGES.map(edge => <div key={edge} data-main-window-resize={edge} className={styles.handle}
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary) return
        stop.current?.()
        const handle = event.currentTarget
        const { pointerId, screenX, screenY } = event
        let frame = 0
        let dx = 0, dy = 0
        const send = () => {
          frame = 0
          resize({ phase: 'move', dx, dy })
        }
        const update = (next: PointerEvent) => {
          dx = next.screenX - screenX
          dy = next.screenY - screenY
        }
        const move = (next: PointerEvent) => {
          if (next.pointerId !== pointerId) return
          if (!(next.buttons & 1)) { finish(); return }
          update(next)
          if (!frame) frame = requestAnimationFrame(send)
        }
        const release = (next: PointerEvent) => {
          if (next.pointerId !== pointerId) return
          update(next)
          cancelAnimationFrame(frame)
          send()
          finish()
        }
        const finish = () => {
          cancelAnimationFrame(frame)
          handle.removeEventListener('pointermove', move)
          handle.removeEventListener('pointerup', release)
          handle.removeEventListener('lostpointercapture', finish)
          window.removeEventListener('blur', finish)
          if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
          stop.current = null
          resize({ phase: 'end' })
        }
        event.preventDefault()
        handle.setPointerCapture(pointerId)
        handle.addEventListener('pointermove', move)
        handle.addEventListener('pointerup', release)
        handle.addEventListener('lostpointercapture', finish)
        window.addEventListener('blur', finish)
        stop.current = finish
        resize({ phase: 'start', edge })
      }} />)}
  </div>
}
