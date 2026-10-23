import { useRef, useCallback, useEffect } from 'react'
import {
  isDoubleTapWithinTolerance,
  isInteractiveIslandDescendant,
  type TapPoint,
} from './islandInteraction'

// Island gestures: click, double click and pull. Running uses the titlebar button.
const SWIPE_THRESHOLD = 60          // 副黑板开合阈值 px

interface IslandGestureOptions {
  onSwipeFlip: () => void           // 下拉达阈值回调（放下/收起副黑板）
  /** 未达阈值的拖拽释放：预览归位 */
  onSwipeCancel?: () => void
  onDoubleTap: () => void           // 双击回调
  onSingleTap?: () => void
  /** 轻点即时回调（位移≤12px 松手即触发，早于单击确认；用于 flinch/惊醒 伴随反应） */
  onQuickTap?: () => void
  /** 拖拽过程中实时回调：副黑板预览高度跟手 */
  onDragProgress?: (deltaY: number, progress: number) => void
  isRunning: boolean
  enableComplexGestures?: boolean
  /** pull-hint 文案（下拉副黑板语义）；缺省保留原型英文 */
  pullHint?: { keep: string; release: string }
}

export function useIslandGesture({
  onSwipeFlip,
  onSwipeCancel,
  onDoubleTap,
  onSingleTap,
  onQuickTap,
  onDragProgress,
  isRunning,
  enableComplexGestures = true,
  pullHint,
}: IslandGestureOptions) {
  const islandRef = useRef<HTMLDivElement>(null)
  const pullHintRef = useRef<HTMLDivElement>(null)

  /*-- 内部状�?--*/
  const isPointerDown = useRef(false)
  const isDragging = useRef(false)
  const startX = useRef(0)
  const startY = useRef(0)
  const currentDragY = useRef(0)

  /*-- 双击检�?--*/
  const lastTapTime = useRef(0)
  const lastTapPoint = useRef<TapPoint | null>(null)
  const pendingSingleTapTimer = useRef<number | null>(null)
  const singleTapCallbackRef = useRef(onSingleTap)
  const DOUBLE_TAP_DELAY = 420
  const DOUBLE_TAP_TOLERANCE = 18

  singleTapCallbackRef.current = onSingleTap
  const quickTapCallbackRef = useRef(onQuickTap)
  quickTapCallbackRef.current = onQuickTap
  const pullHintLabelsRef = useRef(pullHint)
  pullHintLabelsRef.current = pullHint

  /*-- 清理 --*/
  useEffect(() => {
    return () => {

      if (pendingSingleTapTimer.current) clearTimeout(pendingSingleTapTimer.current)

    }
  }, [])

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!e.isPrimary || e.button !== 0) return
      if (isInteractiveIslandDescendant(e.target, e.currentTarget)) return
      // In expanded mode, preventDefault() on pointerdown would suppress the
      // subsequent mousedown event, breaking Select dropdown outside-click detection.
      if (enableComplexGestures) e.preventDefault()

      const now = Date.now()
      const point = { x: e.clientX, y: e.clientY }
      if (isDoubleTapWithinTolerance(
        lastTapTime.current,
        now,
        DOUBLE_TAP_DELAY,
        lastTapPoint.current,
        point,
        DOUBLE_TAP_TOLERANCE,
      )) {
        if (pendingSingleTapTimer.current) {
          clearTimeout(pendingSingleTapTimer.current)
          pendingSingleTapTimer.current = null
        }
        lastTapTime.current = 0
        lastTapPoint.current = null
        onDoubleTap()
        return
      }

      e.currentTarget.setPointerCapture(e.pointerId)

      isPointerDown.current = true
      isDragging.current = false
      startX.current = e.clientX
      startY.current = e.clientY
      currentDragY.current = 0

    },
    [enableComplexGestures, onDoubleTap],
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isPointerDown.current || !enableComplexGestures) return
      const deltaY = e.clientY - startY.current

      // 拖拽判定：超�?5px 垂直位移
      if (
        !isDragging.current &&
        Math.abs(deltaY) > 5 &&
        Math.abs(deltaY) > Math.abs(e.clientX - startX.current)
      ) {
        isDragging.current = true
        if (pendingSingleTapTimer.current) clearTimeout(pendingSingleTapTimer.current)
        pendingSingleTapTimer.current = null
        lastTapTime.current = 0
        lastTapPoint.current = null

        const island = islandRef.current
        if (island) {
          island.classList.add('is-dragging')
        }
      }

      if (isDragging.current && deltaY > 0) {
        currentDragY.current = deltaY

        // Board preview follows the pull; the island itself stays put.
        if (onDragProgress) {
          const progress = Math.min(deltaY / SWIPE_THRESHOLD, 1)
          onDragProgress(deltaY, progress)
        }

        // Pull hint stays anchored to the island (no drag offset).
        const hint = pullHintRef.current
        if (hint) {
          if (deltaY > 20 && !isRunning) {
            hint.style.opacity = String(Math.min(deltaY / 30, 1))
            const labels = pullHintLabelsRef.current
            if (deltaY >= SWIPE_THRESHOLD) {
              hint.textContent = labels?.release ?? 'Release to flip'
              hint.style.color = '#fff'
            } else {
              hint.textContent = labels?.keep ?? 'Keep pulling to switch view'
              hint.style.color = '#888'
            }
          } else {
            hint.style.opacity = '0'
          }
        }
      }
    },
    [isRunning, enableComplexGestures, onDragProgress],
  )

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isPointerDown.current) return
      isPointerDown.current = false
      e.currentTarget.releasePointerCapture(e.pointerId)

      if (!enableComplexGestures) {
        if (Math.hypot(e.clientX - startX.current, e.clientY - startY.current) <= 12) {
          lastTapTime.current = Date.now()
          lastTapPoint.current = { x: e.clientX, y: e.clientY }
        }
        return
      }

      const island = islandRef.current
      if (island) {
        island.classList.remove('is-dragging')
      }

      if (isDragging.current) {
        isDragging.current = false
        // Preview reset; settle/cancel callbacks own the board height.
        if (onDragProgress) onDragProgress(0, 0)

        const hint = pullHintRef.current
        if (hint) {
          hint.style.opacity = '0'
          hint.style.transform = 'translateX(-50%)'
        }

        const flipped = currentDragY.current >= SWIPE_THRESHOLD
        currentDragY.current = 0
        if (flipped) onSwipeFlip()
        else onSwipeCancel?.()
      } else {
        // 非拖�?�?检查双�?
        if (enableComplexGestures && Math.hypot(e.clientX - startX.current, e.clientY - startY.current) <= 12) {
          quickTapCallbackRef.current?.()
          const now = Date.now()
          const tapPoint = { x: e.clientX, y: e.clientY }
          if (isDoubleTapWithinTolerance(
            lastTapTime.current,
            now,
            DOUBLE_TAP_DELAY,
            lastTapPoint.current,
            tapPoint,
            DOUBLE_TAP_TOLERANCE,
          )) {
            if (pendingSingleTapTimer.current) {
              clearTimeout(pendingSingleTapTimer.current)
              pendingSingleTapTimer.current = null
            }
            lastTapTime.current = 0
            lastTapPoint.current = null
            onDoubleTap()
          } else {
            lastTapTime.current = now
            lastTapPoint.current = tapPoint
            if (onSingleTap) {
              if (pendingSingleTapTimer.current) clearTimeout(pendingSingleTapTimer.current)
              pendingSingleTapTimer.current = window.setTimeout(() => {
                pendingSingleTapTimer.current = null
                lastTapTime.current = 0
                lastTapPoint.current = null
                singleTapCallbackRef.current?.()
              }, DOUBLE_TAP_DELAY)
            }
          }
        }
      }
    },
    [enableComplexGestures, onSwipeFlip, onSwipeCancel, onDoubleTap, onSingleTap, onDragProgress],
  )

  const handlePointerCancel = useCallback(() => {
    if (pendingSingleTapTimer.current) clearTimeout(pendingSingleTapTimer.current)
    pendingSingleTapTimer.current = null
    lastTapTime.current = 0
    lastTapPoint.current = null

    isPointerDown.current = false
    isDragging.current = false

    if (onDragProgress) onDragProgress(0, 0)

    const island = islandRef.current
    if (island) {
      island.classList.remove('is-dragging')
      island.style.transform = ''
      island.style.transition = ''
    }

    const hint = pullHintRef.current
    if (hint) hint.style.opacity = '0'
    if (hint) hint.style.transform = 'translateX(-50%)' // 重置位置

    currentDragY.current = 0
  }, [onDragProgress])

  return {
    islandRef,
    pullHintRef,
    isDraggingRef: isDragging,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
  }
}
