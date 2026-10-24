// Note: Janus 眼睛行为系统 rAF 桥 — 把 janusBehavior 的输出写成 CSS 变量。
// 变量挂 face 容器，子级自定义属性继承（face 平移/压扁 + 眼组注视/眼睑）。
// 停帧策略：输出收敛且下个事件 >300ms 时取消 rAF，按 nextWakeupAt 唤醒。
import { useCallback, useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { JanusMode } from './janusIdentity'
import { JanusGazeScheduler, type JanusGazeFrame, type JanusReaction } from './janusBehavior'

const HOVER_PAD = 14

export interface UseJanusGazeOptions {
  /** 承载 --gaze/--lid/--face 变量的容器（janus-face-mini） */
  faceRef: RefObject<HTMLElement | null>
  /** 胶囊本体（几何参照：中心/悬停判定） */
  islandRef: RefObject<HTMLElement | null>
  mode: JanusMode
  /** 仅折叠态驱动 */
  enabled: boolean
  /** 通知中心展开中（P4 接线） */
  panelOpen?: boolean
  /** 拖拽进行中（下拉副黑板）：悬停判定挂起，不触发摸头 */
  suspendRef?: RefObject<boolean>
  /** 外部忙（传话中等）：待机动作让位 */
  busyRef?: RefObject<boolean>
}

export interface JanusGazeControls {
  react: (kind: JanusReaction) => void
  lookAt: (x: number, y: number, durationMs: number) => void
  scheduler: JanusGazeScheduler
}

export function useJanusGaze(options: UseJanusGazeOptions): JanusGazeControls {
  const { faceRef, islandRef, mode, enabled, panelOpen = false, suspendRef, busyRef } = options
  const schedulerRef = useRef<JanusGazeScheduler | null>(null)
  if (!schedulerRef.current) schedulerRef.current = new JanusGazeScheduler()
  const scheduler = schedulerRef.current

  const pointerRef = useRef<{ x: number; y: number; movedAt: number } | null>(null)
  const modeRef = useRef(mode)
  modeRef.current = mode
  const panelOpenRef = useRef(panelOpen)
  panelOpenRef.current = panelOpen
  const resumeRef = useRef<(() => void) | null>(null)

  const writeVars = useCallback((frame: JanusGazeFrame) => {
    const el = faceRef.current
    if (!el) return
    const s = el.style
    s.setProperty('--gaze-x', `${frame.gazeX.toFixed(3)}px`)
    s.setProperty('--gaze-y', `${frame.gazeY.toFixed(3)}px`)
    s.setProperty('--face-x', `${frame.faceX.toFixed(3)}px`)
    s.setProperty('--face-y', `${frame.faceY.toFixed(3)}px`)
    s.setProperty('--rot', `${frame.rot.toFixed(2)}deg`)
    s.setProperty('--lid', frame.lid.toFixed(3))
    s.setProperty('--sx', frame.sx.toFixed(3))
    s.setProperty('--sy', frame.sy.toFixed(3))
  }, [faceRef])

  useEffect(() => {
    if (!enabled) return

    let raf = 0
    let wakeTimer: ReturnType<typeof setTimeout> | null = null
    let lastT = performance.now()
    let running = true

    const stepOnce = () => {
      const now = performance.now()
      const dtMs = Math.min(64, now - lastT)
      lastT = now

      const island = islandRef.current
      const rect = island?.getBoundingClientRect()
      const center = rect
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : { x: 0, y: 0 }
      const pointer = pointerRef.current
      const pointerFresh = !!pointer && now - pointer.movedAt < 1400
      const hover = !!pointer && !!rect && suspendRef?.current !== true &&
        pointer.x >= rect.left - HOVER_PAD && pointer.x <= rect.right + HOVER_PAD &&
        pointer.y >= rect.top - HOVER_PAD && pointer.y <= rect.bottom + HOVER_PAD

      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const frame = scheduler.step({
        now,
        dtMs,
        mode: modeRef.current,
        pointer: pointer ? { x: pointer.x, y: pointer.y } : null,
        pointerFresh,
        islandCenter: center,
        hover,
        panelOpen: panelOpenRef.current,
        busy: suspendRef?.current === true || busyRef?.current === true,
        reducedMotion,
      })
      writeVars(frame)

      if (frame.settled && frame.nextWakeupAt - now > 300) {
        // 闲置停帧：到下一个必然变化的时刻再醒
        running = false
        wakeTimer = setTimeout(() => {
          wakeTimer = null
          if (!running) {
            running = true
            lastT = performance.now()
            raf = requestAnimationFrame(tick)
          }
        }, Math.max(32, frame.nextWakeupAt - now - 20))
        return
      }
      raf = requestAnimationFrame(tick)
    }

    const tick = () => {
      if (!running) return
      stepOnce()
    }

    const resume = () => {
      if (running) return
      running = true
      if (wakeTimer) {
        clearTimeout(wakeTimer)
        wakeTimer = null
      }
      lastT = performance.now()
      raf = requestAnimationFrame(tick)
    }
    resumeRef.current = resume

    const onPointerMove = (event: PointerEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY, movedAt: performance.now() }
      resume()
    }

    scheduler.reset(performance.now())
    writeVars({
      gazeX: 0, gazeY: 0, faceX: 0, faceY: 0, lid: 1, sx: 1, sy: 1, rot: 0, act: null,
      state: 'wander', settled: false, nextWakeupAt: performance.now() + 2000,
    })
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    raf = requestAnimationFrame(tick)

    return () => {
      running = false
      resumeRef.current = null
      if (raf) cancelAnimationFrame(raf)
      if (wakeTimer) clearTimeout(wakeTimer)
      window.removeEventListener('pointermove', onPointerMove)
    }
  }, [busyRef, enabled, islandRef, scheduler, suspendRef, writeVars])

  const react = useCallback((kind: JanusReaction) => {
    scheduler.react(kind, performance.now())
    resumeRef.current?.()
  }, [scheduler])

  const lookAt = useCallback((x: number, y: number, durationMs: number) => {
    scheduler.lookAt(x, y, durationMs, performance.now())
    resumeRef.current?.()
  }, [scheduler])

  return { react, lookAt, scheduler }
}
