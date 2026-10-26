import { memo } from 'react'
import {
  BaseEdge,
  getSmoothStepPath,
  useInternalNode,
  type Edge,
  type EdgeProps,
} from '@xyflow/react'
import { getHierarchicalEdgeEndpoints } from './graph/adaptive-edge-geometry'

// Note: parent links use fixed vertical ports so hierarchy reads as S-curves — see .agents/notes/2026-09-26-blueprint-edge-partial-refresh--edge-refresh.md

const FALLBACK_WIDTH = 240
const FALLBACK_HEIGHT = 110

type BlueprintHierarchyEdgeType = Edge<Record<string, never>, 'blueprintHierarchy'>

function BlueprintHierarchyEdgeImpl({
  source,
  target,
  markerEnd,
  markerStart,
  style,
  label,
  labelStyle,
  labelBgStyle,
  labelBgPadding,
  labelBgBorderRadius,
  interactionWidth,
}: EdgeProps<BlueprintHierarchyEdgeType>) {
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)
  if (!sourceNode || !targetNode) return null

  const endpoints = getHierarchicalEdgeEndpoints(
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
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: endpoints.source.x,
    sourceY: endpoints.source.y,
    sourcePosition: endpoints.source.position,
    targetX: endpoints.target.x,
    targetY: endpoints.target.y,
    targetPosition: endpoints.target.position,
    borderRadius: 12,
  })

  return (
    <BaseEdge
      path={path}
      label={label}
      labelX={labelX}
      labelY={labelY}
      labelStyle={labelStyle}
      labelBgStyle={labelBgStyle}
      labelBgPadding={labelBgPadding}
      labelBgBorderRadius={labelBgBorderRadius}
      markerStart={markerStart}
      markerEnd={markerEnd}
      style={style}
      interactionWidth={interactionWidth ?? 24}
    />
  )
}

export const BlueprintHierarchyEdge = memo(BlueprintHierarchyEdgeImpl)
