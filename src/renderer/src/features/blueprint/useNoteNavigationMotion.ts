// Note: source readiness and viewport settlement form one visit — see .agents/notes/blueprint/navigation/note-updates-and-suggestion-navigation.md
import { useEffect, useRef, useState, type RefObject } from 'react'
import type { ReactFlowInstance, Node, Edge } from '@xyflow/react'
import type { BlueprintNodeData } from '@/components/blueprint/BlueprintNodeCard'
import type { BlueprintNoteDestination } from '../../../../../plugins/blueprint/src/shared/blueprint-attention'

export interface NoteVisit extends BlueprintNoteDestination {
  sequence: number
  nodeId: string
  viewKey: string
  move: boolean
  userInitiated: boolean
}
export function useNoteNavigationMotion(visit: NoteVisit | null, viewKey: string,
  instance: RefObject<ReactFlowInstance<Node<BlueprintNodeData, 'blueprint'>, Edge> | null>,
  container: RefObject<HTMLDivElement | null>, sourceReady: number | null) {
  const [status, setStatus] = useState<{ sequence: number; phase: 'loading' | 'ready' | 'failed' | 'cancelled' }>({ sequence: 0, phase: 'ready' })
  const [focused, setFocused] = useState<string | null>(null)
  const currentView = useRef(viewKey); currentView.current = viewKey
  const source = useRef(sourceReady); source.current = sourceReady
  const cancelRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (!visit) { setStatus({ sequence: 0, phase: 'ready' }); setFocused(null); return }
    let movingFlow = instance.current
    let cancelled = false, frame = 0, focusTimer: ReturnType<typeof setTimeout> | undefined
    let fitted = !visit.move, fitting = false, stable = 0, previous = ''
    const started = performance.now()
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    setStatus({ sequence: visit.sequence, phase: 'loading' }); setFocused(null)
    cancelRef.current = () => {
      cancelled = true; cancelAnimationFrame(frame)
      const flow = instance.current
      if (fitting && flow) void flow.setViewport(flow.getViewport(), { duration: 0 })
      setStatus({ sequence: visit.sequence, phase: 'cancelled' })
    }
    const poll = () => {
      if (cancelled) return
      const flow = instance.current
      const rect = container.current?.querySelector<HTMLElement>('.react-flow')?.getBoundingClientRect()
      const node = flow?.getInternalNode(visit.nodeId)
      if (currentView.current === visit.viewKey && flow && rect && rect.width > 80 && rect.height > 80 && node) {
        const { x, y } = node.internals.positionAbsolute
        const width = node.measured?.width ?? node.width ?? 240
        const height = node.measured?.height ?? node.height ?? 120
        const geometry = `${x}:${y}:${width}:${height}:${rect.width}:${rect.height}`
        stable = geometry === previous ? stable + 1 : 0; previous = geometry
        if (!fitted && !fitting && stable >= 2) {
          fitting = true; movingFlow = flow
          const zoom = Math.min(1.1, rect.width * .72 / width, rect.height * .65 / height)
          void flow.setCenter(x + width / 2, y + height / 2, { zoom, duration: reduced ? 0 : 380 })
            .then(() => {
              if (cancelled) return
              fitting = false
              const latestRect = container.current?.querySelector<HTMLElement>('.react-flow')?.getBoundingClientRect()
              const latestNode = flow.getInternalNode(visit.nodeId)
              const latestGeometry = latestRect && latestNode && `${latestNode.internals.positionAbsolute.x}:${latestNode.internals.positionAbsolute.y}:${latestNode.measured?.width ?? latestNode.width ?? 240}:${latestNode.measured?.height ?? latestNode.height ?? 120}:${latestRect.width}:${latestRect.height}`
              if (latestGeometry === geometry) fitted = true
              else { stable = 0; previous = '' }
            }).catch(() => { if (!cancelled) setStatus({ sequence: visit.sequence, phase: 'failed' }); cancelled = true })
        }
      }
      if (source.current === -visit.sequence) { setStatus({ sequence: visit.sequence, phase: 'failed' }); return }
      if (fitted && source.current === visit.sequence) {
        setStatus({ sequence: visit.sequence, phase: 'ready' })
        if (visit.move) { setFocused(visit.nodeId); focusTimer = setTimeout(() => setFocused(null), reduced ? 0 : 1100) }
        return
      }
      if (performance.now() - started > 12000) { setStatus({ sequence: visit.sequence, phase: 'failed' }); return }
      frame = requestAnimationFrame(poll)
    }
    frame = requestAnimationFrame(poll)
    return () => {
      cancelled = true; cancelAnimationFrame(frame); clearTimeout(focusTimer); cancelRef.current = null
      if (fitting && movingFlow) void movingFlow.setViewport(movingFlow.getViewport(), { duration: 0 })
    }
  }, [visit, instance, container])
  return { status, focused, cancel: () => cancelRef.current?.() }
}
