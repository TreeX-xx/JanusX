import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useReducedMotion, useWorkbenchPhase } from './CardFrame'
import { useBrowserOcclusion } from '@/hooks/useBrowserOcclusion'
import './ModalFrame.css'

/**
 * Shared modal frame: the one entrance/exit path for shell dialogs.
 *
 * Owns the backdrop, the perspective rise, the first-frame reveal gate, the
 * single close route, and focus return. Surfaces supply only their own panel
 * geometry and body; the motion itself lives in `ModalFrame.css` so every dialog
 * in the shell opens on the same beat.
 *
 * Timings follow the settings modal (the reference implementation) and the
 * worktree composer: a 240ms card move plus a 60ms exit buffer.
 */

const MODAL_CARD_ENTER_DURATION_MS = 240
const MODAL_EXIT_BUFFER_MS = 60
const MODAL_EXIT_MS = MODAL_CARD_ENTER_DURATION_MS + MODAL_EXIT_BUFFER_MS

export interface ModalFrameControls {
  /** Native child surfaces may paint only after entry has settled and before exit starts. */
  contentVisible: boolean
  /**
   * The one close route. Goes through the descend animation and then calls the
   * frame's `onClose`. Surfaces use this instead of `onClose` directly whenever
   * the dismissal is a user action — the composer routes its submit through it
   * so creating a worktree also gets the exit motion.
   */
  requestClose: () => void
}

export interface ModalFrameProps {
  /**
   * Panel body. Pass a function to receive the frame's close controls — needed
   * when the surface has its own dismiss affordances (buttons, form submits)
   * that should animate out rather than unmount outright.
   */
  children: ReactNode | ((controls: ModalFrameControls) => ReactNode)
  /**
   * Disable the click-outside and Esc paths. Set this for dialogs that hold
   * unsaved work, where a stray click must not discard it.
   */
  dismissable?: boolean
  /**
   * Backdrop class from the surface's own stylesheet. Use it for backdrop-level
   * concerns the frame does not own — safe-area padding, theme tints. Motion
   * stays on the frame.
   */
  backdropClassName?: string
  /**
   * Move focus to the panel once revealed. Leave off when the surface autofocuses
   * a field of its own (the worktree composer focuses the name input).
   */
  focusPanelOnReveal?: boolean
  /** Accessible name for the dialog. */
  label: string
  /**
   * Called after the exit animation completes. This is what unmounts the frame,
   * so the caller's state change must be the gate — never unmount on the click.
   */
  onClose: () => void
  /** Panel class from the surface's own stylesheet (geometry, color, layout). */
  panelClassName?: string
  /**
   * Inline overrides for the panel, merged after `panelClassName`.
   */
  panelStyle?: CSSProperties
  /**
   * Stacking layer for the backdrop. Surfaces carry different values today and
   * the frame does not guess: sidebar-scoped dialogs sit at the sidebar popover
   * layer, full-screen modals sit above the workbenches. Defaults to the
   * sidebar layer, which is what the sidebar-scoped dialogs used before.
   */
  zIndex?: number
}

/**
 * Renders a portal-hosted dialog with the shared summon/descend motion.
 *
 * The caller controls mounting: render this only while the dialog should be
 * open. The frame walks its own `open` → `closing` → `hidden` lifecycle and
 * invokes `onClose` at hidden, so the caller's state change lands after the
 * animation rather than cutting it off.
 */
export function ModalFrame({
  children,
  dismissable = true,
  backdropClassName,
  focusPanelOnReveal = false,
  label,
  onClose,
  panelClassName,
  panelStyle,
  zIndex = 1000,
}: ModalFrameProps) {
  const [revealReady, setRevealReady] = useState(false)
  const [entranceFinished, setEntranceFinished] = useState(false)
  const reducedMotion = useReducedMotion()
  const panelRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<Element | null>(null)

  // The frame mounts only while open, so it always starts in `open` and walks to
  // `closing` on its own requestClose. Reduced motion has no animation to await,
  // so the exit budget collapses and close resolves on the next tick.
  const { phase, isClosing, requestClose: phaseRequestClose, handleExitFinished } = useWorkbenchPhase(true, {
    awaitAnimation: !reducedMotion,
    exitMs: reducedMotion ? 0 : MODAL_EXIT_MS,
    onClose: () => {
      const trigger = triggerRef.current as HTMLElement | null
      triggerRef.current = null
      if (trigger && typeof trigger.focus === 'function') trigger.focus()
      onClose()
    },
  })
  const requestClose = useCallback(() => {
    phaseRequestClose()
  }, [phaseRequestClose])
  useBrowserOcclusion(phase !== 'hidden')

  // Hold the first frame so the panel always starts from the entrance keyframe
  // rather than painting its final state before the animation kicks in.
  useEffect(() => {
    triggerRef.current = document.activeElement
    setRevealReady(false)
    const frame = requestAnimationFrame(() => setRevealReady(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    if (focusPanelOnReveal && revealReady) panelRef.current?.focus({ preventScroll: true })
  }, [focusPanelOnReveal, revealReady, phase])

  useEffect(() => {
    if (!dismissable || phase === 'hidden' || isClosing) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      requestClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [dismissable, phase, isClosing, requestClose])

  if (phase === 'hidden') return null

  return createPortal(
    <div
      className={backdropClassName ? `modal-frame-backdrop ${backdropClassName}` : 'modal-frame-backdrop'}
      data-closing={isClosing ? 'true' : undefined}
      data-reveal-ready={revealReady ? 'true' : undefined}
      onAnimationEnd={(event) => {
        if (!isClosing || event.target !== event.currentTarget) return
        handleExitFinished()
      }}
      onPointerDown={(event) => {
        if (!dismissable) return
        if (event.target === event.currentTarget) requestClose()
      }}
      style={
        {
          zIndex,
          '--card-enter-duration': `${MODAL_CARD_ENTER_DURATION_MS}ms`,
          '--workbench-exit-duration': `${MODAL_EXIT_MS}ms`,
        } as CSSProperties
      }
    >
      <div
        className={panelClassName ? `modal-frame-panel ${panelClassName}` : 'modal-frame-panel'}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        ref={panelRef}
        style={panelStyle}
        onAnimationEnd={event => { if (event.target === event.currentTarget && event.animationName === 'modal-frame-card-rise') setEntranceFinished(true) }}
      >
        {typeof children === 'function' ? children({ requestClose, contentVisible: revealReady && (reducedMotion || entranceFinished) && !isClosing }) : children}
      </div>
    </div>,
    document.body,
  )
}
