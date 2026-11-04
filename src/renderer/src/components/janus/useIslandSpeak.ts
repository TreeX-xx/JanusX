import { useCallback, useEffect, useRef, useState } from 'react'
import { IslandSpeakQueue, type IslandSpeakEntry, type IslandSpeakSnapshot } from './islandSpeakQueue'

export interface IslandSpeakControls {
  snapshot: IslandSpeakSnapshot
  enqueue: (entry: IslandSpeakEntry, present?: boolean) => void
  dismiss: () => boolean
  silence: () => void
  setPaused: (paused: boolean) => void
  markRead: (key: string) => void
  clear: (readOnly?: boolean) => void
  removeAutomation: (id: string) => void
}

export function useIslandSpeak(): IslandSpeakControls {
  const [queue] = useState(() => new IslandSpeakQueue())
  const [snapshot, setSnapshot] = useState(() => queue.step(Date.now()))
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refresh = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    const next = queue.step(Date.now())
    setSnapshot(next)
    if (Number.isFinite(next.nextEventAt)) {
      timerRef.current = setTimeout(refresh, Math.max(16, next.nextEventAt - Date.now()))
    }
  }, [queue])
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])
  const enqueue = useCallback((entry: IslandSpeakEntry, present = true) => {
    queue.enqueue(entry, Date.now(), present); refresh()
  }, [queue, refresh])
  const dismiss = useCallback(() => {
    const dismissed = queue.dismiss(Date.now()); refresh(); return dismissed
  }, [queue, refresh])
  const silence = useCallback(() => { queue.silence(); refresh() }, [queue, refresh])
  const setPaused = useCallback((paused: boolean) => { queue.setPaused(paused, Date.now()); refresh() }, [queue, refresh])
  const markRead = useCallback((key: string) => { queue.markRead(key); refresh() }, [queue, refresh])
  const clear = useCallback((readOnly = false) => { queue.clear(readOnly); refresh() }, [queue, refresh])
  const removeAutomation = useCallback((id: string) => { queue.removeAutomation(id); refresh() }, [queue, refresh])
  return { snapshot, enqueue, dismiss, silence, setPaused, markRead, clear, removeAutomation }
}
