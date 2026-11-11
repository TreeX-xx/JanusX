// Note: .agents/notes/knowledge/user-todo-janus.md
import { annotationClearance, starPosition, clearConnection, type ConstellationPoint as Point, type ConstellationRect as Rect, type ConstellationSegment as Segment } from './constellationGeometry'

export interface StarLayout { order: string[]; points: Record<string, Point> }
export type LabelSide = 'ne' | 'se' | 'nw' | 'sw'
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/** Ordered milestones share one horizontal baseline, including after insert/delete/reorder. */
export function reconcileStars(ids: string[], previous?: StarLayout): StarLayout {
  const points: Record<string, Point> = {}
  ids.forEach((id, index) => {
    const position = starPosition(index)
    const cached = previous?.points[id]
    points[id] = cached?.x === position.x && cached.y === position.y ? cached : position
  })
  return { order: [...ids], points }
}

/** Drawing, insertion and clipping share the same straight flow connection. */
export function starConnection(start: Point, end: Point, _id: string): Segment[] {
  return distance(start, end) ? [{ start, end }] : []
}

export function clipStarConnection(segments: Segment[], obstacles: Rect[]): Segment[] {
  return segments.flatMap(({ start, end }) => clearConnection(start, end, obstacles, .01))
}

export function pointOnConnection(point: Point, segments: Segment[]) {
  let best = { distance: Infinity, t: 0, point }
  segments.forEach(({ start, end }, index) => {
    const dx = end.x - start.x, dy = end.y - start.y
    const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy || 1)))
    const closest = { x: start.x + dx * t, y: start.y + dy * t }
    const gap = distance(point, closest)
    if (gap < best.distance) best = { distance: gap, t: (index + t) / segments.length, point: closest }
  })
  return best
}

export function insertionTarget(point: Point, stars: Array<{ id: string; point: Point }>): string | null {
  if (!stars.length) return null
  let best = { distance: 34, afterId: undefined as string | undefined }
  stars.slice(1).forEach((star, index) => {
    const result = pointOnConnection(point, starConnection(stars[index].point, star.point, stars[index].id))
    if (result.t > .06 && result.t < .94 && result.distance < best.distance) best = { distance: result.distance, afterId: stars[index].id }
  })
  if (best.afterId) return best.afterId
  const first = stars[0].point, next = stars[1]?.point ?? { x: first.x + 100, y: first.y }
  if (distance(point, first) < 100 && (point.x - first.x) * (next.x - first.x) + (point.y - first.y) * (next.y - first.y) < 0) return null
  return stars.at(-1)!.id
}

export function labelGeometry(point: Point, hasLabel: boolean, side: LabelSide = 'ne') {
  const left = side.endsWith('w'), below = side.startsWith('s')
  const direction = left ? -1 : 1
  const leaderY = below ? 30 : -16
  const textLeft = left ? -132 : 24
  const titleTop = leaderY - 18, labelTop = leaderY + 4
  const base = annotationClearance({ x: 0, y: 0 }, hasLabel)
  const boxes = base.map(box => {
    // Vertical translation moves the callout only; the diagonal always starts at the star.
    const translated = { left: left ? -box.right : box.left, right: left ? -box.left : box.right,
      top: box.top + (below ? 46 : 0), bottom: box.bottom + (below ? 46 : 0) }
    return { left: point.x + translated.left, right: point.x + translated.right, top: point.y + translated.top, bottom: point.y + translated.bottom }
  })
  boxes[0] = { left: point.x + (left ? -24 : 2), right: point.x + (left ? -2 : 24), top: point.y + Math.min(0, leaderY) - 4, bottom: point.y + Math.max(0, leaderY) + 4 }
  return { side, textLeft, titleTop, labelTop, leaderY, boxes, path: `M ${6 * direction} 0 L ${20 * direction} ${leaderY} H ${132 * direction}` }
}

const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))

export function placeLabels(stars: Array<{ id: string; point: Point; hasLabel: boolean }>, selectedId: string | null, viewport: { width: number; height: number }): Record<string, LabelSide> {
  const occupied: Rect[] = stars.map(({ point }) => ({ left: point.x - 17, right: point.x + 17, top: point.y - 17, bottom: point.y + 17 }))
  const result: Record<string, LabelSide> = {}
  const edges = stars.slice(1).flatMap((star, index) => starConnection(stars[index].point, star.point, stars[index].id))
  const ordered = [...stars].sort((a, b) => Number(b.id === selectedId) - Number(a.id === selectedId))
  for (const star of ordered) {
    const candidates: LabelSide[] = ['ne', 'se', 'nw', 'sw']
    const score = (side: LabelSide) => {
      const boxes = labelGeometry(star.point, star.hasLabel, side).boxes.slice(1)
      return boxes.reduce((sum, box) => sum + occupied.reduce((total, other) => total + overlap(box, other), 0) * 8 +
        Math.max(0, -box.left) * 4 + Math.max(0, box.right - viewport.width) * 4 + Math.max(0, -box.top) * 4 + Math.max(0, box.bottom - viewport.height) * 4 +
        edges.filter(edge => pointOnConnection({ x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 }, [edge]).distance < 18).length * 10, 0)
    }
    const side = candidates.reduce((best, next) => score(next) < score(best) ? next : best)
    result[star.id] = side
    occupied.push(...labelGeometry(star.point, star.hasLabel, side).boxes)
  }
  return result
}
