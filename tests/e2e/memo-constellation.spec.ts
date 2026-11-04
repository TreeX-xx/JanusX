import { expect, test, type Page } from '@playwright/test'

async function open(page: Page) {
  await page.goto('/memo.html?island=1')
  await page.getByRole('button', { name: 'Open memo on the right' }).click()
  await page.getByRole('button', { name: 'A', exact: true }).click()
}
async function seed(page: Page, records = false) {
  await page.evaluate(async records => {
    const memo = (window as any).memoFixture.memos[0]
    const nodes = await window.electron.memo!.edit(memo.id, { expectedRevision: memo.revision, operations: [{ op: 'addNode', title: 'First' }, { op: 'addNode', title: 'Last' }] })
    if (records) await window.electron.memo!.edit(memo.id, { expectedRevision: nodes.revision, operations: [{ op: 'addPoint', nodeId: nodes.nodes[0].id, text: 'Delete this record' }, { op: 'addPoint', nodeId: nodes.nodes[1].id, text: 'Keep this other record' }] })
  }, records)
}
async function confirm(page: Page, text?: string) {
  if (text !== undefined) await page.getByRole('dialog').getByRole('textbox').fill(text)
  await page.getByRole('dialog').getByRole('button', { name: 'OK', exact: true }).click()
}

test('manual file fold keeps both outer islands fixed and recovers the inline file list', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await open(page)
  const memo = (await page.locator('.memo-panel').boundingBox())!
  const main = (await page.locator('.janus-island-shell').boundingBox())!
  const content = (await page.locator('.memo-content').boundingBox())!
  await page.getByRole('button', { name: 'Collapse memo files' }).click()
  await expect(page.locator('.memo-files')).toHaveCount(0)
  expect(await page.locator('.memo-panel').boundingBox()).toEqual(memo)
  expect(await page.locator('.janus-island-shell').boundingBox()).toEqual(main)
  expect((await page.locator('.memo-content').boundingBox())!.width).toBeGreaterThan(content.width)
  await page.getByRole('button', { name: 'Expand memo files' }).click()
  await expect(page.locator('.memo-files')).toHaveAttribute('data-drawer', 'false')
  expect(await page.locator('.memo-panel').boundingBox()).toEqual(memo)
})

async function clickBetween(page: Page, first: string, second: string) {
  await expect(page.locator('.memo-star-track')).toHaveAttribute('data-moving', 'false')
  const a = (await page.getByRole('tab', { name: first, exact: true }).boundingBox())!
  const b = (await page.getByRole('tab', { name: second, exact: true }).boundingBox())!
  const gap = await page.evaluate(({ a, b }) => {
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    for (const t of [.5, .4, .6]) for (const offset of [0, 12, -12, 22, -22]) {
      const x = a.x + 16 + (b.x - a.x) * t - (b.y - a.y) / length * offset
      const y = a.y + 16 + (b.y - a.y) * t + (b.x - a.x) / length * offset
      const hit = document.elementFromPoint(x, y)
      if (hit?.closest('.memo-star-track') && !hit.closest('button')) return { x, y }
    }
    return null
  }, { a, b })
  expect(gap).not.toBeNull()
  await page.mouse.click(gap!.x, gap!.y)
}

test('blank canvas insertion creates and selects the middle star, and allows end append', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await open(page)
  await seed(page)
  await page.getByRole('tab', { name: 'First', exact: true }).click()
  await clickBetween(page, 'First', 'Last')
  await expect(page.locator('.memo-star-target')).toContainText('First')
  await expect(page.locator('.memo-star-target')).toContainText('Last')
  await confirm(page, 'Middle')
  await expect(page.getByRole('tab', { name: 'Middle', exact: true })).toHaveAttribute('aria-selected', 'true')
  expect(await page.evaluate(() => (window as any).memoFixture.memos[0].nodes.map((node: any) => node.title))).toEqual(['First', 'Middle', 'Last'])
  await expect(page.locator('.memo-star-connection')).toHaveCount(2)
  await expect(page.getByRole('tab', { name: /Unassigned/ })).toHaveCount(0)
  await expect(page.locator('.memo-star-leader')).toHaveCount(3)
  await page.getByRole('tab', { name: 'Last', exact: true }).click()
  const canvas = (await page.locator('.memo-star-track').boundingBox())!
  await page.mouse.click(canvas.x + canvas.width - 25, canvas.y + canvas.height - 20)
  await confirm(page, 'Tail')
  expect(await page.evaluate(() => (window as any).memoFixture.memos[0].nodes.map((node: any) => node.title))).toEqual(['First', 'Middle', 'Last', 'Tail'])
  await page.screenshot({ path: 'artifacts/memo-analysis/constellation-v2-dark.png' })
  await page.evaluate(() => { document.documentElement.dataset.theme = 'planche' })
  await page.screenshot({ path: 'artifacts/memo-analysis/constellation-v2-planche.png' })
})

test('insertion conflicts keep the form and original anchor; keyboard menu can insert first', async ({ page }) => {
  await open(page)
  await seed(page)
  await page.getByRole('tab', { name: 'First', exact: true }).click()
  await page.locator('.memo-node-actions > summary').click()
  await page.locator('.memo-node-menu').getByRole('button', { name: 'Insert star after', exact: true }).click()
  await page.getByRole('dialog').getByRole('textbox').fill('Retry insertion')
  await page.evaluate(() => (window as any).memoFixture.modelUpdate((window as any).memoFixture.memos[0].id, 'Changed memo'))
  await confirm(page)
  await expect(page.getByRole('dialog').getByRole('textbox')).toHaveValue('Retry insertion')
  await expect(page.getByRole('alert')).toContainText('Content changed')
  await confirm(page)
  expect(await page.evaluate(() => (window as any).memoFixture.memos[0].nodes.map((node: any) => node.title))).toEqual(['First', 'Retry insertion', 'Last'])
  await page.getByRole('tab', { name: 'First', exact: true }).click()
  await page.locator('.memo-node-actions > summary').click()
  await page.locator('.memo-node-menu').getByRole('button', { name: 'Insert star before', exact: true }).click()
  await confirm(page, 'Beginning')
  expect(await page.evaluate(() => (window as any).memoFixture.memos[0].nodes[0].title)).toBe('Beginning')
})

test('blank insertion keeps the logical adjacent anchor after zooming', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await open(page)
  await seed(page)
  await page.evaluate(async () => {
    const memo = (window as any).memoFixture.memos[0]
    await window.electron.memo!.edit(memo.id, { expectedRevision: memo.revision, operations: [{ op: 'addNode', title: 'Third', label: 'v3' }, { op: 'editNode', nodeId: memo.nodes[1].id, label: 'v2' }] })
    return memo.nodes[1].id as string
  })
  await page.getByRole('tab', { name: 'First', exact: true }).press('ArrowRight')
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Zoom out constellation' }).click()
  await clickBetween(page, 'Last', 'Third')
  await expect(page.locator('.memo-star-target')).toContainText('Last')
  await expect(page.locator('.memo-star-target')).toContainText('Third')
  await confirm(page, 'Inserted on cleared line')
  await expect(page.getByRole('tab', { name: 'Inserted on cleared line', exact: true })).toHaveAttribute('aria-selected', 'true')
  expect(await page.evaluate(() => (window as any).memoFixture.memos[0].nodes.map((node: any) => node.title))).toEqual(['First', 'Last', 'Inserted on cleared line', 'Third'])
})

test('star deletion cancels safely, then selects the remaining star and preserves its records', async ({ page }) => {
  await open(page)
  await seed(page, true)
  await page.getByRole('tab', { name: 'First', exact: true }).click()
  await expect(page.locator('.memo-record-heading .memo-add-point')).toBeVisible()
  await expect(page.locator('.memo-point')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await page.locator('.memo-node-actions > summary').click()
  await page.getByRole('button', { name: 'Delete star', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('all records (1)')
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Point text' })).toHaveValue('Delete this record')
  await page.locator('.memo-node-actions > summary').click()
  await page.getByRole('button', { name: 'Delete star', exact: true }).click()
  await confirm(page)
  await expect(page.getByRole('tab', { name: 'Last', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('textbox', { name: 'Point text' })).toHaveValue('Keep this other record')
  expect(await page.evaluate(() => (window as any).memoFixture.memos[0].nodes.map((node: any) => ({ title: node.title, points: node.points.map((point: any) => point.text) })))).toEqual([{ title: 'Last', points: ['Keep this other record'] }])
})

test('selected stars show node and record counts without repeating the memo filename', async ({ page }) => {
  await open(page)
  await expect(page.getByRole('textbox', { name: 'Memo title', exact: true })).toHaveValue('A')
  await seed(page, true)
  for (const title of ['First', 'Last']) {
    await page.getByRole('tab', { name: title, exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Memo title', exact: true })).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'Node title', exact: true })).toHaveValue(title)
    await expect(page.locator('.memo-document-meta')).toContainText('2 nodes')
    await expect(page.locator('.memo-document-meta')).toContainText('2 points')
  }
  await expect(page.getByRole('button', { name: 'A', exact: true })).toBeVisible()
})

test('connections avoid actual text and leader geometry at zoom limits, across rows and after panning', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await open(page)
  await page.evaluate(async () => {
    const memo = (window as any).memoFixture.memos[0]
    await window.electron.memo!.edit(memo.id, { expectedRevision: memo.revision, operations: Array.from({ length: 14 }, (_, index) => ({ op: 'addNode' as const, title: `星 ${index + 1} · 连接避让检查`, label: index % 2 ? '' : `v${index + 1} · 2026 / 10` })) })
  })
  await page.getByRole('tab', { name: '星 1 · 连接避让检查', exact: true }).click()
  const canvas = page.locator('.memo-star-track')
  const check = async () => {
    const collisions = await canvas.evaluate(element => {
      type Point = { x: number; y: number }
      type Segment = { start: Point; end: Point }
      const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
      const intersects = (a: Segment, b: Segment) => {
        if (Math.max(a.start.x, a.end.x) < Math.min(b.start.x, b.end.x) || Math.max(b.start.x, b.end.x) < Math.min(a.start.x, a.end.x) ||
          Math.max(a.start.y, a.end.y) < Math.min(b.start.y, b.end.y) || Math.max(b.start.y, b.end.y) < Math.min(a.start.y, a.end.y)) return false
        return cross(a.start, a.end, b.start) * cross(a.start, a.end, b.end) <= 0 && cross(b.start, b.end, a.start) * cross(b.start, b.end, a.end) <= 0
      }
      const screenPoint = (path: SVGPathElement, x: number, y: number): Point => {
        const point = new DOMPoint(x, y).matrixTransform(path.getScreenCTM()!)
        return { x: point.x, y: point.y }
      }
      const connections = [...element.querySelectorAll<SVGPathElement>('.memo-star-connection')].flatMap(path =>
        [...path.getAttribute('d')!.matchAll(/M\s+(\S+)\s+(\S+)\s+L\s+(\S+)\s+(\S+)/g)].map(match => ({ start: screenPoint(path, Number(match[1]), Number(match[2])), end: screenPoint(path, Number(match[3]), Number(match[4])) })))
      const leaders = [...element.querySelectorAll<SVGPathElement>('.memo-star-leader path')].flatMap(path => {
        const [x, y, elbowX, elbowY, endX] = path.getAttribute('d')!.match(/-?\d+(?:\.\d+)?/g)!.map(Number)
        const start = screenPoint(path, x, y), elbow = screenPoint(path, elbowX, elbowY), end = screenPoint(path, endX, elbowY)
        return [{ start, end: elbow }, { start: elbow, end }]
      })
      const text = [...element.querySelectorAll('.memo-star-title, .memo-star-label')].map(span => span.getBoundingClientRect())
      const hitsText = (segment: Segment, box: DOMRect) => {
        const corners = [{ x: box.left, y: box.top }, { x: box.right, y: box.top }, { x: box.right, y: box.bottom }, { x: box.left, y: box.bottom }]
        return [segment.start, segment.end].some(point => point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom) ||
          corners.some((corner, index) => intersects(segment, { start: corner, end: corners[(index + 1) % 4] }))
      }
      return { pieces: connections.length, text: connections.filter(segment => text.some(box => hitsText(segment, box))).length,
        leaders: connections.filter(segment => leaders.some(leader => intersects(segment, leader))).length }
    })
    expect(collisions.pieces).toBeGreaterThan(0)
    expect(collisions.text).toBe(0)
    expect(collisions.leaders).toBe(0)
  }
  await expect(page.locator('.memo-star-connection')).toHaveCount(13)
  await check()
  await canvas.focus()
  for (let index = 0; index < 7; index++) await canvas.press('-')
  await expect(canvas).toHaveAttribute('data-camera-scale', '0.4')
  await check()
  for (let index = 0; index < 12; index++) await canvas.press('+')
  await expect(canvas).toHaveAttribute('data-camera-scale', '2.4')
  await check()
  await canvas.press('0')
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(box.x + box.width / 2 - 40, box.y + box.height / 2 - 220, { steps: 4 })
  await page.mouse.up({ button: 'middle' })
  await check()
  await page.getByRole('button', { name: 'Collapse memo files' }).click()
  await check()
  await page.setViewportSize({ width: 800, height: 900 })
  await expect(page.locator('.memo-panel')).toHaveAttribute('data-layout', 'stacked')
  await check()
  await page.setViewportSize({ width: 1280, height: 720 })
  await expect(page.locator('.memo-panel')).toHaveAttribute('data-layout', 'parallel')
  await canvas.press('0')
  await page.screenshot({ path: 'artifacts/memo-analysis/constellation-clearance-dark.png' })
  await page.evaluate(() => { document.documentElement.dataset.theme = 'planche' })
  await check()
  await page.screenshot({ path: 'artifacts/memo-analysis/constellation-clearance-planche.png' })
})

test('title stays above its leader and label below it through zoom, pan and file folding', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await open(page)
  await seed(page)
  await page.evaluate(async () => {
    const memo = (window as any).memoFixture.memos[0]
    await window.electron.memo!.edit(memo.id, { expectedRevision: memo.revision, operations: [{ op: 'editNode', nodeId: memo.nodes[0].id, title: '对齐检查 · 长标题保持完整提示', label: 'v1 · 2026 / 10 / 14' }] })
  })
  const star = page.getByRole('tab', { name: '对齐检查 · 长标题保持完整提示', exact: true })
  await star.click()
  const check = async () => {
    const boxes = await star.evaluate(element => {
      const path = element.querySelector<SVGPathElement>('.memo-star-leader path')!
      const end = path.getPointAtLength(path.getTotalLength())
      const line = new DOMPoint(end.x, end.y).matrixTransform(path.getScreenCTM()!)
      const title = element.querySelector('.memo-star-title')!.getBoundingClientRect()
      const label = element.querySelector('.memo-star-label')!.getBoundingClientRect()
      const left = element.getAttribute('data-label-side')!.endsWith('w')
      return { line: { x: line.x, y: line.y }, title: { edge: left ? title.left : title.right, bottom: title.bottom }, label: { edge: left ? label.left : label.right, top: label.top } }
    })
    expect(boxes.title.bottom).toBeCloseTo(boxes.line.y - 4)
    expect(boxes.label.top).toBeCloseTo(boxes.line.y + 4)
    expect(boxes.title.edge).toBeCloseTo(boxes.line.x)
    expect(boxes.label.edge).toBeCloseTo(boxes.line.x)
  }
  await check()
  await page.getByRole('button', { name: 'Zoom in constellation' }).click()
  await check()
  const canvas = (await page.locator('.memo-star-track').boundingBox())!
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(canvas.x + canvas.width / 2 + 20, canvas.y + canvas.height / 2 + 8)
  await page.mouse.up({ button: 'middle' })
  await check()
  await page.getByRole('button', { name: 'Collapse memo files' }).click()
  await check()
  await page.screenshot({ path: 'artifacts/memo-analysis/constellation-v3-dark.png' })
  await page.evaluate(() => { document.documentElement.dataset.theme = 'planche' })
  await check()
  await page.screenshot({ path: 'artifacts/memo-analysis/constellation-v3-planche.png' })
})

test('wheel zoom and middle drag are local to the canvas, while records scroll normally', async ({ page }) => {
  await open(page)
  await seed(page)
  await page.evaluate(async () => {
    const memo = (window as any).memoFixture.memos[0]
    await window.electron.memo!.edit(memo.id, { expectedRevision: memo.revision, operations: Array.from({ length: 25 }, (_, index) => ({ op: 'addPoint' as const, nodeId: memo.nodes[0].id, text: `Record ${index + 1}` })) })
  })
  await page.getByRole('tab', { name: 'First', exact: true }).click()
  const canvas = page.locator('.memo-star-track')
  const panel = (await page.locator('.memo-panel').boundingBox())!
  const initialScale = Number(await canvas.getAttribute('data-camera-scale'))
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, -120)
  await expect.poll(async () => Number(await canvas.getAttribute('data-camera-scale'))).toBeGreaterThan(initialScale)
  const beforePan = { x: Number(await canvas.getAttribute('data-camera-x')), y: Number(await canvas.getAttribute('data-camera-y')) }
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 18, { steps: 3 })
  await page.mouse.up({ button: 'middle' })
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect.poll(async () => Number(await canvas.getAttribute('data-camera-x'))).toBeCloseTo(beforePan.x + 30)
  expect(Number(await canvas.getAttribute('data-camera-y'))).toBeCloseTo(beforePan.y + 18)
  await expect(page.getByRole('tab', { name: 'First', exact: true })).toHaveAttribute('aria-selected', 'true')
  expect(await page.locator('.memo-panel').boundingBox()).toEqual(panel)
  const scale = await canvas.getAttribute('data-camera-scale')
  const list = (await page.locator('.memo-scroll').boundingBox())!
  await page.mouse.move(list.x + 20, list.y + 20)
  await page.mouse.wheel(0, 350)
  await expect.poll(() => page.locator('.memo-scroll').evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  expect(await canvas.getAttribute('data-camera-scale')).toBe(scale)
})

test('new star travels from the clicked blank space with live connections; cancel writes nothing', async ({ page }) => {
  await open(page)
  await seed(page)
  const canvas = page.locator('.memo-star-track')
  const box = (await canvas.boundingBox())!
  const origin = { x: box.width - 40, y: 36 }
  await page.mouse.click(box.x + origin.x, box.y + origin.y)
  await page.getByRole('dialog').getByRole('textbox').fill('Cancelled')
  await page.getByRole('dialog').press('Escape')
  expect(await page.evaluate(() => (window as any).memoFixture.memos[0].nodes.length)).toBe(2)
  await page.mouse.click(box.x + origin.x, box.y + origin.y)
  await page.getByRole('dialog').getByRole('textbox').fill('Moving star')
  const samples = await page.evaluate(async () => {
    document.querySelector<HTMLButtonElement>('.memo-star-composer button[type="submit"]')!.click()
    const frames: { x: number; y: number; edges: number }[] = []
    for (let i = 0; i < 35; i++) {
      await new Promise(requestAnimationFrame)
      const star = document.querySelector<HTMLElement>('.memo-star[data-born="true"]')
      if (star) frames.push({ x: parseFloat(star.style.left) + 16, y: parseFloat(star.style.top) + 16, edges: document.querySelectorAll('.memo-star-connection').length })
    }
    return frames
  })
  expect(samples.length).toBeGreaterThan(3)
  expect(Math.hypot(samples[0].x - origin.x, samples[0].y - origin.y)).toBeLessThan(65)
  expect(Math.hypot(samples.at(-1)!.x - samples[0].x, samples.at(-1)!.y - samples[0].y)).toBeGreaterThan(25)
  expect(new Set(samples.map(point => `${point.x},${point.y}`)).size).toBeGreaterThan(3)
  expect(samples.every(point => point.edges === 2)).toBe(true)
  await expect(canvas).toHaveAttribute('data-moving', 'false')
  await expect(page.getByRole('tab', { name: 'Moving star', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.memo-star[data-born="true"]')).toHaveCount(0)
})

test('a changed insertion anchor keeps the title and requires a new blank target', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await open(page)
  await seed(page)
  await clickBetween(page, 'First', 'Last')
  await page.getByRole('dialog').getByRole('textbox').fill('Keep draft')
  await page.evaluate(async () => {
    const memo = (window as any).memoFixture.memos[0]
    await window.electron.memo!.edit(memo.id, { expectedRevision: memo.revision, operations: [{ op: 'removeNode', nodeId: memo.nodes[1].id }] })
  })
  await confirm(page)
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('dialog').getByRole('textbox')).toHaveValue('Keep draft')
  const canvas = (await page.locator('.memo-star-track').boundingBox())!
  await page.mouse.click(canvas.x + canvas.width - 28, canvas.y + canvas.height - 20)
  await expect(page.getByRole('dialog').getByRole('textbox')).toHaveValue('Keep draft')
  await confirm(page)
  expect(await page.evaluate(() => (window as any).memoFixture.memos[0].nodes.map((node: any) => node.title))).toEqual(['First', 'Keep draft'])
  await expect(page.locator('.memo-star-track')).toHaveAttribute('data-moving', 'false')
})

test('star captions and leaders select without creating and layout survives hide and file switches', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await open(page)
  await seed(page)
  const first = page.getByRole('tab', { name: 'First', exact: true })
  await first.locator('.memo-star-title').click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const line = await first.locator('.memo-star-leader path').evaluate(path => {
    const element = path as SVGPathElement
    const local = element.getPointAtLength(element.getTotalLength() - 15)
    const point = new DOMPoint(local.x, local.y).matrixTransform(element.getScreenCTM()!)
    return { x: point.x, y: point.y }
  })
  await page.mouse.click(line.x, line.y)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await clickBetween(page, 'First', 'Last')
  await confirm(page, 'Middle')
  const positions = () => page.locator('.memo-star-track').evaluate(element => {
    const scale = Number((element as HTMLElement).dataset.cameraScale), x = Number((element as HTMLElement).dataset.cameraX), y = Number((element as HTMLElement).dataset.cameraY)
    return [...element.querySelectorAll<HTMLElement>('.memo-star')].map(star => ({ id: star.dataset.nodeId, x: (parseFloat(star.style.left) + 16 - x) / scale, y: (parseFloat(star.style.top) + 16 - y) / scale }))
  })
  const before = await positions()
  const checkPositions = async () => {
    const after = await positions()
    expect(after.map(point => point.id)).toEqual(before.map(point => point.id))
    after.forEach((point, i) => { expect(point.x).toBeCloseTo(before[i].x, 2); expect(point.y).toBeCloseTo(before[i].y, 2) })
  }
  await page.getByRole('button', { name: 'B', exact: true }).click()
  await page.getByRole('button', { name: 'A', exact: true }).click()
  await checkPositions()
  await page.getByRole('button', { name: 'Open memo on the right' }).click()
  await expect(page.locator('.memo-panel')).toHaveCount(0)
  await page.getByRole('button', { name: 'Open memo on the right' }).click()
  await checkPositions()
})

test('closing during creation clears provisional overlays before the delayed save returns', async ({ page }) => {
  await open(page)
  await seed(page)
  await page.evaluate(() => {
    const edit = window.electron.memo!.edit
    window.electron.memo!.edit = async (...args) => {
      await new Promise<void>(resolve => { (window as any).releaseMemoSave = resolve })
      return edit(...args)
    }
  })
  await page.getByRole('button', { name: 'Add star', exact: true }).click()
  await page.getByRole('dialog').getByRole('textbox').fill('Late star')
  await page.getByRole('dialog').getByRole('button', { name: 'OK', exact: true }).click()
  await page.getByRole('button', { name: 'Open memo on the right' }).click()
  await page.evaluate(() => (window as any).releaseMemoSave())
  await expect(page.locator('.memo-panel')).toHaveCount(0)
  await page.getByRole('button', { name: 'Open memo on the right' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.memo-star-ghost[data-pending="true"]')).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).memoFixture.memos[0].nodes.map((node: any) => node.title))).toContain('Late star')
})

test('parchment shares cancelable motion and keeps both islands bounded in small windows', async ({ page }) => {
  await page.goto('/memo.html?island=1&roundtable=1')
  await page.locator('.janus-expanded-view-button[data-view="roundtable"]').click()
  const parchment = (await page.locator('.janus-roundtable-scroll').boundingBox())!
  // The center scroll continuously floats; click its current physical position.
  await page.mouse.click(parchment.x + parchment.width / 2, parchment.y + parchment.height / 2)
  const auxiliary = page.locator('.janus-auxiliary-island')
  await expect(auxiliary).toHaveAttribute('data-phase', 'open')
  await expect(auxiliary).toHaveClass(/island-surface/)
  await page.evaluate(async () => {
    document.querySelector<HTMLButtonElement>('.janus-auxiliary-close')!.click()
    setTimeout(() => document.querySelector<HTMLButtonElement>('.janus-roundtable-scroll')!.click(), 30)
    await new Promise(resolve => setTimeout(resolve, 320))
  })
  await expect(auxiliary).toHaveAttribute('data-phase', 'open')
  const main = page.locator('.janus-island-shell')
  for (const [width, height] of [[1280, 720], [1000, 600], [800, 900], [800, 600]]) {
    await page.setViewportSize({ width, height })
    await expect.poll(async () => { const box = (await auxiliary.boundingBox())!; return box.x + box.width }).toBeLessThanOrEqual(width - 12)
    const box = (await auxiliary.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(12)
    expect(box.y).toBeGreaterThanOrEqual(12)
    expect(box.y + box.height).toBeLessThanOrEqual(height - 12)
    const mode = await auxiliary.getAttribute('data-layout')
    if (mode === 'focus') {
      await expect(main).toBeHidden()
      expect(await main.evaluate(element => element.inert)).toBe(true)
    } else {
      await expect(main).toBeVisible()
      const mainBox = (await main.boundingBox())!
      expect(mainBox.x).toBeGreaterThanOrEqual(12)
      expect(mainBox.x + mainBox.width).toBeLessThanOrEqual(width - 12)
      expect(mainBox.y).toBeGreaterThanOrEqual(12)
      expect(mainBox.y + mainBox.height).toBeLessThanOrEqual(height - 12)
      if (mode === 'stacked') expect(box.y - mainBox.y - mainBox.height).toBeCloseTo(12)
      else expect(box.x - mainBox.x - mainBox.width).toBeCloseTo(12)
    }
  }
  await page.getByRole('button', { name: 'Collapse parchment', exact: true }).click()
  await expect(auxiliary).toHaveCount(0)
  await expect(main).not.toHaveAttribute('data-auxiliary-layout', /.+/)
  await expect(main).toBeVisible()
  expect(await main.evaluate(element => element.inert)).toBe(false)
  await expect(page.locator('.janus-roundtable-scroll')).toBeFocused()
})
