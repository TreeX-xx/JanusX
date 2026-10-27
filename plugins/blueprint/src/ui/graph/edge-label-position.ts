import type { NodeRect } from './adaptive-edge-geometry'

/** Keep the badge near its edge without covering any measured canvas card. */
export function getEdgeLabelPosition(
  anchor: { x: number; y: number },
  size: { width: number; height: number },
  cards: NodeRect[],
): { x: number; y: number } {
  const halfWidth = size.width / 2 + 8, halfHeight = size.height / 2 + 8
  const clear = ({ x, y }: typeof anchor) => cards.every(card =>
    x + halfWidth <= card.x + 0.001 || x - halfWidth >= card.x + card.width - 0.001 ||
    y + halfHeight <= card.y + 0.001 || y - halfHeight >= card.y + card.height - 0.001)
  if (clear(anchor)) return anchor
  // Search the nearest horizontal/vertical clearance boundaries. At least the
  // outermost boundary is free, even when several neighbouring cards overlap.
  const candidates = cards.flatMap(card => [
    { x: card.x - halfWidth, y: anchor.y },
    { x: card.x + card.width + halfWidth, y: anchor.y },
    { x: anchor.x, y: card.y - halfHeight },
    { x: anchor.x, y: card.y + card.height + halfHeight },
  ])
  if (cards.length) {
    candidates.push(
      { x: Math.min(...cards.map(card => card.x)) - halfWidth, y: anchor.y },
      { x: Math.max(...cards.map(card => card.x + card.width)) + halfWidth, y: anchor.y },
      { x: anchor.x, y: Math.min(...cards.map(card => card.y)) - halfHeight },
      { x: anchor.x, y: Math.max(...cards.map(card => card.y + card.height)) + halfHeight },
    )
  }
  candidates.sort((a, b) => Math.hypot(a.x - anchor.x, a.y - anchor.y) - Math.hypot(b.x - anchor.x, b.y - anchor.y))
  return candidates.find(clear) ?? anchor
}
