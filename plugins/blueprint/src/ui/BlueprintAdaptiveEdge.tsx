import { memo, useLayoutEffect, useState, type CSSProperties, type ReactNode } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useInternalNode,
  useNodes,
  type Edge,
  type EdgeProps,
} from '@xyflow/react'
import { getAdaptiveEdgeEndpoints } from './graph/adaptive-edge-geometry'
import { getEdgeLabelPosition } from './graph/edge-label-position'

// Note: .agents/notes/blueprint/navigation/blueprint-edge-partial-refresh.md

const FALLBACK_WIDTH = 240
const FALLBACK_HEIGHT = 110

type BlueprintAdaptiveEdgeType = Edge<Record<string, never>, 'blueprintAdaptive'>

function BlueprintAdaptiveEdgeImpl({
  source,
  target,
  markerEnd,
  markerStart,
  style,
  label,
  interactionWidth,
}: EdgeProps<BlueprintAdaptiveEdgeType>) {
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)
  if (!sourceNode || !targetNode) return null

  const endpoints = getAdaptiveEdgeEndpoints(
    {
      ...sourceNode.internals.positionAbsolute,
      width: sourceNode.measured.width ?? FALLBACK_WIDTH,
      height: sourceNode.measured.height ?? FALLBACK_HEIGHT,
    },
    {
      ...targetNode.internals.positionAbsolute,
      width: targetNode.measured.width ?? FALLBACK_WIDTH,
      height: targetNode.measured.height ?? FALLBACK_HEIGHT,
    },
  )
  const [path, labelX, labelY] = getBezierPath({
    sourceX: endpoints.source.x,
    sourceY: endpoints.source.y,
    sourcePosition: endpoints.source.position,
    targetX: endpoints.target.x,
    targetY: endpoints.target.y,
    targetPosition: endpoints.target.position,
  })

  return (
    <>
      <BaseEdge
        path={path}
        markerStart={markerStart}
        markerEnd={markerEnd}
        style={style}
        interactionWidth={interactionWidth ?? 16}
      />
      {label && <BlueprintEdgeLabel x={labelX} y={labelY} style={style}>{label}</BlueprintEdgeLabel>}
    </>
  )
}

function BlueprintEdgeLabel({ x, y, style, children }: { x: number; y: number; style?: CSSProperties; children: ReactNode }) {
  const nodes = useNodes()
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    if (!element) return
    const measure = () => setSize(previous => {
      const width = element.offsetWidth, height = element.offsetHeight
      return previous.width === width && previous.height === height ? previous : { width, height }
    })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  const position = getEdgeLabelPosition({ x, y }, size, nodes.filter(node => !node.hidden).map(node => ({
    ...node.position, width: node.measured?.width ?? FALLBACK_WIDTH, height: node.measured?.height ?? FALLBACK_HEIGHT,
  })))
  const moved = position.x !== x || position.y !== y
  return <>
    {moved && <path className="bp-edge-label__leader" d={`M ${x} ${y} L ${position.x} ${position.y}`}
      style={{ stroke: style?.stroke }} />}
    <EdgeLabelRenderer><div ref={setElement} className="bp-edge-label" style={{
      transform: `translate(-50%, -50%) translate(${position.x}px, ${position.y}px)`,
      visibility: size.width ? 'visible' : 'hidden',
    }}>{children}</div></EdgeLabelRenderer>
  </>
}

export const BlueprintAdaptiveEdge = memo(BlueprintAdaptiveEdgeImpl)
