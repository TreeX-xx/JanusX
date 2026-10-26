import { Position } from '@xyflow/react'

export interface NodeRect {
  x: number
  y: number
  width: number
  height: number
}

export interface EdgeEndpoint {
  x: number
  y: number
  position: Position
}

function boundaryPoint(rect: NodeRect, dx: number, dy: number, fallback: Position): EdgeEndpoint {
  const centerX = rect.x + rect.width / 2
  const centerY = rect.y + rect.height / 2
  if (dx === 0 && dy === 0) {
    return fallback === Position.Bottom
      ? { x: centerX, y: rect.y + rect.height, position: Position.Bottom }
      : { x: centerX, y: rect.y, position: Position.Top }
  }

  const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : rect.width / 2 / Math.abs(dx)
  const scaleY = dy === 0 ? Number.POSITIVE_INFINITY : rect.height / 2 / Math.abs(dy)
  if (scaleX <= scaleY) {
    const position = dx > 0 ? Position.Right : Position.Left
    return {
      x: dx > 0 ? rect.x + rect.width : rect.x,
      y: centerY + dy * scaleX,
      position,
    }
  }

  const position = dy > 0 ? Position.Bottom : Position.Top
  return {
    x: centerX + dx * scaleY,
    y: dy > 0 ? rect.y + rect.height : rect.y,
    position,
  }
}

export function getAdaptiveEdgeEndpoints(source: NodeRect, target: NodeRect): {
  source: EdgeEndpoint
  target: EdgeEndpoint
} {
  const dx = target.x + target.width / 2 - (source.x + source.width / 2)
  const dy = target.y + target.height / 2 - (source.y + source.height / 2)
  return {
    source: boundaryPoint(source, dx, dy, Position.Bottom),
    target: boundaryPoint(target, -dx, -dy, Position.Top),
  }
}

// Note: hierarchy edges stay vertical so parent links read as clean S-curves — see .agents/notes/2026-09-26-blueprint-edge-partial-refresh--edge-refresh.md
export function getHierarchicalEdgeEndpoints(source: NodeRect, target: NodeRect): {
  source: EdgeEndpoint
  target: EdgeEndpoint
} {
  return {
    source: {
      x: source.x + source.width / 2,
      y: source.y + source.height,
      position: Position.Bottom,
    },
    target: {
      x: target.x + target.width / 2,
      y: target.y,
      position: Position.Top,
    },
  }
}
