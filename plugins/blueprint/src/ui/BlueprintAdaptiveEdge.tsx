import { memo } from 'react'
import {
  BaseEdge,
  getBezierPath,
  useInternalNode,
  type Edge,
  type EdgeProps,
} from '@xyflow/react'
import { getAdaptiveEdgeEndpoints } from './graph/adaptive-edge-geometry'

// Note: adaptive routing is reserved for relation/interface links — see .agents/notes/2026-09-26-blueprint-edge-partial-refresh--edge-refresh.md

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
    <BaseEdge
      path={path}
      label={label}
      labelX={labelX}
      labelY={labelY}
      labelStyle={{ fill: 'var(--shell-accent-strong)', fontSize: 11 }}
      labelBgStyle={{ fill: 'var(--shell-card)' }}
      markerStart={markerStart}
      markerEnd={markerEnd}
      style={style}
      interactionWidth={interactionWidth ?? 16}
    />
  )
}

export const BlueprintAdaptiveEdge = memo(BlueprintAdaptiveEdgeImpl)
