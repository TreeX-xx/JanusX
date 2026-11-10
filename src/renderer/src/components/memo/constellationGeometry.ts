export interface ConstellationPoint { x: number; y: number }
export interface ConstellationCamera extends ConstellationPoint { scale: number }
export interface ConstellationSize { width: number; height: number }
export const DEFAULT_CAMERA = { x: 0, y: 0, scale: 1 }
export const STAR_ANNOTATION = { textLeft: 24, width: 108, titleTop: -34, titleHeight: 14, leaderY: -16, labelTop: -12, labelHeight: 13 }
export interface ConstellationRect { left: number; top: number; right: number; bottom: number }
export interface ConstellationSegment { start: ConstellationPoint; end: ConstellationPoint }
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Labels keep screen-sized text, so their clearance is solved after camera projection. */
export function annotationClearance(point: ConstellationPoint, hasLabel: boolean): ConstellationRect[] {
  const { textLeft, width, titleTop, leaderY, labelTop, labelHeight } = STAR_ANNOTATION
  const padding = 4
  const boxes = [
    { left: point.x + 6 - padding, top: point.y + leaderY - padding, right: point.x + 20 + padding, bottom: point.y + padding },
    { left: point.x + 20 - padding, top: point.y + titleTop - padding, right: point.x + textLeft + width + padding, bottom: point.y + leaderY + padding },
  ]
  if (hasLabel) boxes.push({ left: point.x + textLeft - padding, top: point.y + labelTop - padding,
    right: point.x + textLeft + width + padding, bottom: point.y + labelTop + labelHeight + padding })
  return boxes
}

/** Keep the constellation's straight backbone, leaving clean gaps around callouts. */
export function clearConnection(start: ConstellationPoint, end: ConstellationPoint, obstacles: ConstellationRect[], minimumLength = 4): ConstellationSegment[] {
  const dx = end.x - start.x, dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  if (!length) return []
  const blocked: Array<[number, number]> = []
  for (const box of obstacles) {
    let from = 0, to = 1
    for (const [origin, delta, low, high] of [[start.x, dx, box.left, box.right], [start.y, dy, box.top, box.bottom]]) {
      if (delta === 0) { if (origin < low || origin > high) { from = 1; to = 0; break } }
      else {
        const first = (low - origin) / delta, second = (high - origin) / delta
        from = Math.max(from, Math.min(first, second)); to = Math.min(to, Math.max(first, second))
      }
    }
    if (from <= to) blocked.push([from, to])
  }
  blocked.sort((a, b) => a[0] - b[0])
  const visible: ConstellationSegment[] = []
  const add = (from: number, to: number) => {
    if ((to - from) * length < minimumLength) return
    visible.push({ start: { x: start.x + dx * from, y: start.y + dy * from }, end: { x: start.x + dx * to, y: start.y + dy * to } })
  }
  let cursor = 0
  for (const [from, to] of blocked) {
    if (from > cursor) add(cursor, from)
    cursor = Math.max(cursor, to)
  }
  if (cursor < 1) add(cursor, 1)
  return visible
}

export function connectionPath(segments: ConstellationSegment[]): string {
  return segments.map(({ start, end }) => `M ${start.x} ${start.y} L ${end.x} ${end.y}`).join(' ')
}

export function connectionMidpoint(segments: ConstellationSegment[]): ConstellationPoint | null {
  const longest = segments.reduce<ConstellationSegment | null>((previous, segment) => !previous ||
    Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y) > Math.hypot(previous.end.x - previous.start.x, previous.end.y - previous.start.y) ? segment : previous, null)
  return longest ? { x: (longest.start.x + longest.end.x) / 2, y: (longest.start.y + longest.end.y) / 2 } : null
}

export function starPosition(index: number): ConstellationPoint {
  return { x: 52 + index * 172, y: 80 }
}
export function projectStar(point: ConstellationPoint, camera: ConstellationCamera): ConstellationPoint {
  return { x: camera.x + point.x * camera.scale, y: camera.y + point.y * camera.scale }
}
export function zoomCamera(camera: ConstellationCamera, at: ConstellationPoint, factor: number): ConstellationCamera {
  const scale = clamp(camera.scale * factor, .4, 2.4)
  return { scale, x: at.x - (at.x - camera.x) * scale / camera.scale, y: at.y - (at.y - camera.y) * scale / camera.scale }
}
export function boundCamera(camera: ConstellationCamera, viewport: ConstellationSize, count: number, points?: ConstellationPoint[]): ConstellationCamera {
  if (points?.length) return { ...camera,
    x: clamp(camera.x, -Math.max(...points.map(point => point.x)) * camera.scale + 32, viewport.width - Math.min(...points.map(point => point.x)) * camera.scale - 32),
    y: clamp(camera.y, -Math.max(...points.map(point => point.y)) * camera.scale + 40, viewport.height - Math.min(...points.map(point => point.y)) * camera.scale - 32) }
  const world = { width: starPosition(Math.max(0, count - 1)).x + 140, height: 160 }
  return { ...camera, x: clamp(camera.x, -world.width * camera.scale + 48, Math.max(48, viewport.width - 48)),
    y: clamp(camera.y, -world.height * camera.scale + 48, Math.max(48, viewport.height - 32)) }
}
