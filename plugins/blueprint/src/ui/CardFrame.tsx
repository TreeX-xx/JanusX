import { useCallback, useEffect, useReducer, type CSSProperties } from 'react'

/**
 * Shared card-workbench primitives (Phase 4, §9).
 * Extracted from `BlueprintWorkbench`'s `requestClose` + `hidden/open/closing`
 * state machine so blueprint and knowledge workbenches share one lifecycle:
 * frame open/close, skeleton placeholder, grid-track card index helper, and
 * a reduced-motion escape hatch. No business logic lives here.
 */

export type WorkbenchPhase = 'hidden' | 'open' | 'closing'

type PhaseAction =
  | { type: 'open' }
  | { type: 'parent-closed' }
  | { type: 'request-close' }
  | { type: 'exit-finished' }

export interface PhaseEvent {
  /** Fired exactly once when the workbench reaches `hidden` from `closing`. */
  onHidden?: () => void
}

/**
 * Pure phase reducer (unit-tested): reopening while closing returns to
 * `open` without emitting hidden; `exit-finished` is a no-op unless closing.
 */
export function workbenchPhaseReducer(
  phase: WorkbenchPhase,
  action: PhaseAction,
  events?: PhaseEvent,
): WorkbenchPhase {
  switch (action.type) {
    case 'open':
      return 'open'
    case 'parent-closed':
      return phase === 'hidden' ? 'hidden' : 'closing'
    case 'request-close':
      return phase === 'hidden' ? 'hidden' : 'closing'
    case 'exit-finished':
      if (phase !== 'closing') return phase
      events?.onHidden?.()
      return 'hidden'
  }
}

export interface UseWorkbenchPhaseOptions {
  /**
   * Fallback close path for workbenches that unmount on a timer instead of an
   * animation-end event (the knowledge workbench closes after `exitMs`).
   * Animation-driven workbenches set this false and call `handleExitFinished`
   * from `onAnimationEnd`, with `exitMs` kept as a stuck-animation safety net.
   */
  awaitAnimation?: boolean
  /** Exit duration in ms; also the safety-net timeout when awaiting animation. */
  exitMs?: number
  onClose?: () => void
}

const DEFAULT_EXIT_MS = 320

/**
 * Owns the hidden/open/closing lifecycle for a card workbench.
 * Returns `rendered` (portal alive), `isClosing`, `requestClose`, and
 * `handleExitFinished` for `onAnimationEnd` wiring.
 */
export function useWorkbenchPhase(
  isOpen: boolean,
  { awaitAnimation = false, exitMs = DEFAULT_EXIT_MS, onClose }: UseWorkbenchPhaseOptions = {},
) {
  const [phase, dispatch] = useReducer(
    (current: WorkbenchPhase, action: PhaseAction) =>
      workbenchPhaseReducer(current, action, { onHidden: onClose }),
    isOpen ? 'open' : 'hidden',
  )

  useEffect(() => {
    dispatch({ type: isOpen ? 'open' : 'parent-closed' })
  }, [isOpen])

  // Timer close path (or safety net when awaiting a stuck animation).
  useEffect(() => {
    if (phase !== 'closing') return
    const wait = awaitAnimation ? exitMs + 500 : exitMs
    const timer = setTimeout(() => dispatch({ type: 'exit-finished' }), wait)
    return () => clearTimeout(timer)
  }, [phase, awaitAnimation, exitMs])

  const requestClose = useCallback(() => dispatch({ type: 'request-close' }), [])
  const handleExitFinished = useCallback(() => dispatch({ type: 'exit-finished' }), [])

  return {
    phase,
    rendered: phase !== 'hidden',
    isClosing: phase === 'closing',
    requestClose,
    handleExitFinished,
  }
}

/** Grid-track card index helper for staggered enter/exit (`--card-index`). */
export function cardIndexStyle(index: number): CSSProperties {
  return { '--card-index': index } as CSSProperties
}

/**
 * Side-panel exit duration in ms. Enter is transition-driven (rAF-flipped
 * `visible`); exit keeps the panel mounted for this long so the slide/fade
 * and grid-track collapse can play before unmount. CSS timings must match:
 * exit slide ≤ this value, `visibility` delay ≈ this value.
 */
export const SIDE_PANEL_EXIT_MS = 220

export interface AnimatedOpenState {
  /** Panel stays mounted while true (covers the exit transition). */
  rendered: boolean
  /** Drives `data-visible`; false plays the slide/fade-out. */
  visible: boolean
}

export type AnimatedOpenAction =
  | { type: 'open' }
  | { type: 'opened' }
  | { type: 'close' }
  | { type: 'exit-finished' }

/**
 * Pure state machine behind `useAnimatedOpen` (unit-tested): open mounts
 * hidden and waits for `opened` (rAF) to transition in; close only hides and
 * waits for `exit-finished` (timer) to unmount; reopening mid-exit snaps back
 * to visible without unmounting.
 */
export function animatedOpenReducer(
  state: AnimatedOpenState,
  action: AnimatedOpenAction,
): AnimatedOpenState {
  switch (action.type) {
    case 'open':
      return state.rendered ? { rendered: true, visible: true } : { rendered: true, visible: false }
    case 'opened':
      return state.rendered ? { rendered: true, visible: true } : state
    case 'close':
      return state.rendered ? { rendered: true, visible: false } : state
    case 'exit-finished':
      return state.visible ? state : { rendered: false, visible: false }
  }
}

/**
 * Keeps a toggling side panel mounted across its exit transition.
 * Returns `rendered` (conditional-render gate) and `visible` (`data-visible`
 * gate for the CSS slide/fade). Reduced-motion collapses the exit to 0ms;
 * CSS must separately disable the transitions.
 *
 * The open path mounts during render (render-phase update, same commit as
 * the grid-track change) so the opening track never paints empty —
 * otherwise the dark track expands one or two frames before the card mounts
 * (black-first flash). Visibility still flips on rAF so the enter transition
 * plays. The close path stays effect-driven.
 */
export function useAnimatedOpen(open: boolean, durationMs = SIDE_PANEL_EXIT_MS): AnimatedOpenState {
  const reducedMotion = useReducedMotion()
  const duration = reducedMotion ? 0 : durationMs
  const [state, dispatch] = useReducer(
    animatedOpenReducer,
    open,
    (initialOpen) => (initialOpen ? { rendered: true, visible: false } : { rendered: false, visible: false }),
  )

  if (open && !state.rendered) {
    dispatch({ type: 'open' })
  }

  useEffect(() => {
    if (!open) dispatch({ type: 'close' })
  }, [open ])

  useEffect(() => {
    if (!state.rendered || state.visible || !open) return
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      dispatch({ type: 'opened' })
      return
    }
    const frame = window.requestAnimationFrame(() => dispatch({ type: 'opened' }))
    return () => window.cancelAnimationFrame(frame)
  }, [open, state.rendered, state.visible])

  useEffect(() => {
    if (!state.rendered || state.visible || open) return
    if (typeof window === 'undefined' || duration <= 0) {
      dispatch({ type: 'exit-finished' })
      return
    }
    const timer = window.setTimeout(() => dispatch({ type: 'exit-finished' }), duration)
    return () => window.clearTimeout(timer)
  }, [open, state.rendered, state.visible, duration])

  return state
}

/** Prefers-reduced-motion probe (SSR-safe; Electron renderer always has matchMedia). */
export function useReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function CardSkeleton({ lines = 3, label }: { lines?: number; label: string }) {
  return (
    <div className="card-frame-skeleton" role="status" aria-label={label}>
      {Array.from({ length: Math.max(1, lines) }, (_, index) => (
        <span key={index} className="card-frame-skeleton-line" style={{ width: `${92 - index * 13}%` }} />
      ))}
    </div>
  )
}
