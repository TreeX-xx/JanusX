import { describe, expect, it } from 'vitest'
import { clipStarConnection, insertionTarget, labelGeometry, placeLabels, reconcileStars, starConnection } from '../../src/renderer/src/components/memo/constellationLayout'
import { projectStar } from '../../src/renderer/src/components/memo/constellationGeometry'

describe('horizontal milestone flow', () => {
  const expectFlow = (layout: ReturnType<typeof reconcileStars>) => {
    layout.order.forEach((id, index) => {
      expect(layout.points[id].y).toBe(80)
      if (index) expect(layout.points[id].x - layout.points[layout.order[index - 1]].x).toBe(172)
    })
  }
  it('keeps long flows on one baseline without wrapping or reversing', () => {
    const layout = reconcileStars(Array.from({ length: 100 }, (_, i) => 'node-' + i))
    expectFlow(layout)
    expect(reconcileStars(layout.order, layout)).toEqual(layout)
    const edge = starConnection(layout.points[layout.order[0]], layout.points[layout.order[1]], 'first')
    expect(edge).toEqual([{ start: { x: 52, y: 80 }, end: { x: 224, y: 80 } }])
  })
  it('opens and closes horizontal slots on insertion, deletion and reorder, ignoring old scattered coordinates', () => {
    let layout = reconcileStars(['a', 'b', 'c'], { order: ['a', 'b', 'c'], points: { a: { x: 10, y: 50 }, b: { x: 100, y: 190 }, c: { x: 40, y: 300 } } })
    expectFlow(layout)
    const reordered = reconcileStars(['c', 'a', 'b'], layout)
    expect(reordered.points.c).toEqual(layout.points.a)
    expectFlow(reordered)
    for (let index = 0; index < 30; index++) {
      layout = reconcileStars(['a', 'new-' + index, ...layout.order.slice(1)], layout)
      expectFlow(layout)
    }
    expect(new Set(Object.values(layout.points).map(point => point.x)).size).toBe(33)
    expectFlow(reconcileStars(['first', ...layout.order], layout))
    expectFlow(reconcileStars(['a', 'c'], layout))
    expect(reconcileStars([], layout)).toEqual({ order: [], points: {} })
  })
  it('resolves only adjacent edges, including visually clipped parts, at each zoom', () => {
    for (const scale of [.4, 1, 2.4]) {
      const stars = [{ id: 'a', point: { x: 100, y: 100 } }, { id: 'b', point: { x: 300, y: 150 } }, { id: 'c', point: { x: 500, y: 90 } }].map(star => ({ ...star, point: projectStar(star.point, { x: -12, y: 20, scale }) }))
      for (let index = 0; index < 2; index++) {
        const edge = starConnection(stars[index].point, stars[index + 1].point, stars[index].id)
        expect(insertionTarget({ x: (edge[0].start.x + edge[0].end.x) / 2, y: (edge[0].start.y + edge[0].end.y) / 2 }, stars)).toBe(stars[index].id)
      }
      expect(insertionTarget({ x: stars[0].point.x - 30, y: stars[0].point.y }, stars)).toBeNull()
      expect(insertionTarget({ x: 900, y: 600 }, stars)).toBe('c')
    }
  })
  it('keeps straight connections outside all four directional callouts across zoom limits', () => {
    const layout = reconcileStars(Array.from({ length: 30 }, (_, i) => `node-${i}`))
    for (const scale of [.4, 1, 2.4]) {
      const stars = layout.order.map(id => ({ id, hasLabel: true, point: projectStar(layout.points[id], { x: -84, y: 36, scale }) }))
      const sides = placeLabels(stars, stars[0].id, { width: 460, height: 160 })
      const boxes = stars.flatMap(star => labelGeometry(star.point, true, sides[star.id]).boxes)
      const segments = stars.slice(1).flatMap((star, i) => clipStarConnection(starConnection(stars[i].point, star.point, stars[i].id), boxes))
      expect(segments.length).toBeGreaterThan(0)
      for (const { start, end } of segments) for (let i = 0; i <= 10; i++) {
        const x = start.x + (end.x - start.x) * i / 10, y = start.y + (end.y - start.y) * i / 10
        expect(boxes.some(box => x > box.left + .001 && x < box.right - .001 && y > box.top + .001 && y < box.bottom - .001)).toBe(false)
      }
    }
    for (const side of ['ne', 'nw', 'se', 'sw'] as const) {
      const label = labelGeometry({ x: 0, y: 0 }, true, side)
      expect(label.titleTop + 14).toBe(label.leaderY - 4)
      expect(label.labelTop).toBe(label.leaderY + 4)
      expect(label.textLeft).toBe(side.endsWith('w') ? -132 : 24)
    }
  })
})
