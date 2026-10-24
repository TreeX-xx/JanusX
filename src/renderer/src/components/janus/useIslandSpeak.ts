// Note: 胶囊传话驱动 — IslandSpeakQueue 的 React 桥（P3）。
// 定时器只在有活干时运转（speaking/排队），空闲即停；对齐 nextEventAt 唤醒。
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  IslandSpeakQueue,
  type IslandSpeakEntry,
  type IslandSpeakSnapshot,
} from './islandSpeakQueue'

const IDLE_SNAPSHOT: IslandSpeakSnapshot = {
  speaking: null,
  historyCount: 0,
  pendingCount: 0,
  nextEventAt: Number.POSITIVE_INFINITY,
}

export interface IslandSpeakControls {
  snapshot: IslandSpeakSnapshot
  enqueue: (entry: IslandSpeakEntry) => void
  dismiss: () => void
  markSeen: () => void
  burnHistory: () => number
}

export function useIslandSpeak(): IslandSpeakControls {
  const queueRef = useRef<IslandSpeakQueue | null>(null)
  if (!queueRef.current) queueRef.current = new IslandSpeakQueue()
  const queue = queueRef.current
  const [snapshot, setSnapshot] = useState<IslandSpeakSnapshot>(IDLE_SNAPSHOT)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const tick = useCallback(() => {
    timerRef.current = null
    const snap = queue.step(Date.now())
    setSnapshot(snap)
    if (snap.pendingCount > 0) {
      const delay = Math.max(40, Math.min(240, snap.nextEventAt - Date.now()))
      timerRef.current = setTimeout(tick, delay)
    }
  }, [queue])

  const kick = useCallback(() => {
    if (timerRef.current) return
    tick()
  }, [tick])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const enqueue = useCallback((entry: IslandSpeakEntry) => {
    queue.enqueue(entry, Date.now())
    kick()
  }, [queue, kick])

  const dismiss = useCallback(() => {
    queue.dismiss(Date.now())
    kick()
  }, [queue, kick])

  const markSeen = useCallback(() => {
    queue.markSeen()
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setSnapshot(queue.step(Date.now()))
  }, [queue])

  const burnHistory = useCallback(() => {
    const n = queue.burnHistory()
    setSnapshot(queue.step(Date.now()))
    return n
  }, [queue])

  return { snapshot, enqueue, dismiss, markSeen, burnHistory }
}
