import { describe, expect, it } from 'vitest'
import { boundCamera, clearConnection, connectionMidpoint, projectStar, starPosition, zoomCamera } from '../../src/renderer/src/components/memo/constellationGeometry'
import { labelGeometry, placeLabels } from '../../src/renderer/src/components/memo/constellationLayout'
import { layoutCompanionIslands } from '../../src/renderer/src/components/island/islandLayout'

describe('constellation camera', () => {
  it('keeps the world point under the wheel cursor fixed, including zoom limits', () => {
    const at = { x: 180, y: 80 }
    for (const factor of [.001, .7, 1.3, 100]) {
      const camera = { x: -30, y: 14, scale: 1.2 }
      const world = { x: (at.x - camera.x) / camera.scale, y: (at.y - camera.y) / camera.scale }
      const zoomed = zoomCamera(camera, at, factor)
      expect(projectStar(world, zoomed).x).toBeCloseTo(at.x)
      expect(projectStar(world, zoomed).y).toBeCloseTo(at.y)
      expect(zoomed.scale).toBeGreaterThanOrEqual(.4)
      expect(zoomed.scale).toBeLessThanOrEqual(2.4)
    }
  })
  it('bounds panning at empty and dense scenes without changing zoom', () => {
    for (const count of [0, 1, 20, 100]) {
      const viewport = { width: 280, height: 140 }
      const bounded = boundCamera({ x: 1e6, y: -1e6, scale: .8 }, viewport, count)
      expect(bounded.x).toBeLessThan(viewport.width)
      expect(bounded.y).toBeGreaterThan(-Math.max(1, Math.ceil(count / 6)) * 210 * .8)
      expect(bounded.scale).toBe(.8)
    }
  })
})

describe('constellation annotation clearance', () => {
  it('keeps clear connections intact and merges overlapping callout gaps in either direction', () => {
    const start = { x: 0, y: 0 }, end = { x: 100, y: 0 }
    expect(clearConnection(start, end, [])).toEqual([{ start, end }])
    const obstacles = [
      { left: 20, right: 45, top: -10, bottom: 10 },
      { left: 40, right: 60, top: -10, bottom: 10 },
      { left: 120, right: 150, top: -10, bottom: 10 },
    ]
    const segments = clearConnection(start, end, obstacles)
    expect(segments).toEqual([
      { start, end: { x: 20, y: 0 } },
      { start: { x: 60, y: 0 }, end },
    ])
    expect(clearConnection(end, start, obstacles)).toEqual([...segments].reverse().map(({ start, end }) => ({ start: end, end: start })))
    expect(connectionMidpoint(segments)).toEqual({ x: 80, y: 0 })
  })

  it('omits insertion positions when no usable line remains', () => {
    const point = { x: 5, y: 5 }
    expect(clearConnection(point, point, [])).toEqual([])
    const covered = clearConnection(point, { x: 10, y: 10 }, [{ left: 0, top: 0, right: 20, bottom: 20 }])
    expect(covered).toEqual([])
    expect(connectionMidpoint(covered)).toBeNull()
    expect(clearConnection(point, { x: 6, y: 5 }, [])).toEqual([])
  })

  it('leaves screen-sized title and leader clearance along horizontal flows at all zoom limits', () => {
    for (const scale of [.4, .7, 1, 1.6, 2.4]) {
      const points = Array.from({ length: 24 }, (_, index) => projectStar(starPosition(index), { x: -137, y: 58, scale }))
      const stars = points.map((point, index) => ({ id: String(index), point, hasLabel: index % 2 === 0 }))
      const sides = placeLabels(stars, '0', { width: 460, height: 160 })
      const obstacles = stars.flatMap(star => labelGeometry(star.point, star.hasLabel, sides[star.id]).boxes)
      const segments = points.slice(1).flatMap((point, index) => clearConnection(points[index], point, obstacles))
      expect(segments.length).toBeGreaterThan(0)
      for (const { start, end } of segments) {
        // Sample visible ink independently of the clipping algorithm, including both endpoints.
        for (let step = 0; step <= 100; step++) {
          const x = start.x + (end.x - start.x) * step / 100, y = start.y + (end.y - start.y) * step / 100
          expect(obstacles.some(box => x > box.left + .001 && x < box.right - .001 && y > box.top + .001 && y < box.bottom - .001)).toBe(false)
        }
      }
    }
  })
})

describe('right-side companion geometry', () => {
  it('uses the same bounded layout for parchment, including small windows', () => {
    for (const [viewportWidth, viewportHeight] of [[1920, 900], [1280, 720], [1000, 600], [800, 900], [800, 600]]) {
      const layout = layoutCompanionIslands({ viewportWidth, viewportHeight, companionWidth: 420, side: 'right' })
      for (const box of [layout.main, layout.companion]) {
        expect(box.left).toBeGreaterThanOrEqual(12)
        expect(box.left + box.width).toBeLessThanOrEqual(viewportWidth - 12)
        expect(box.top + box.height).toBeLessThanOrEqual(viewportHeight - 12)
      }
      if (layout.mode === 'parallel' || layout.mode === 'compact') expect(layout.companion.left - layout.main.left - layout.main.width).toBe(12)
    }
  })
})
