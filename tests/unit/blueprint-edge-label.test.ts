import { beforeAll, afterAll, expect, it } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { parseNote } from '@janus-agent/harness-core'
import { toNoteDoc } from '../../src/main/notes/note-provider'
import { projectGraph } from '../../plugins/blueprint/src/main/notes/note-to-blueprint'
import { getEdgeLabelPosition } from '../../plugins/blueprint/src/ui/graph/edge-label-position'

it('moves badges to the nearest clear area around every card', () => {
  const cards = [
    { x: 0, y: 0, width: 240, height: 110 },
    { x: 260, y: 0, width: 240, height: 110 },
    { x: 0, y: 130, width: 240, height: 110 },
    { x: 260, y: 130, width: 240, height: 110 },
  ]
  const position = getEdgeLabelPosition({ x: 250, y: 120 }, { width: 150, height: 28 }, cards)
  expect(position).not.toEqual({ x: 250, y: 120 })
  expect(cards.every(card => position.x + 83 <= card.x || position.x - 83 >= card.x + card.width ||
    position.y + 22 <= card.y || position.y - 22 >= card.y + card.height)).toBe(true)
  expect(getEdgeLabelPosition({ x: 600, y: 120 }, { width: 150, height: 28 }, cards)).toEqual({ x: 600, y: 120 })
})

let browser: Browser, script: string, css: string
beforeAll(async () => {
  // A small, fixed graph exercises the real interface layout without depending
  // on the developer's current Notes, their titles or the growing repository size.
  const repo = '11111111-1111-4111-8111-111111111111'
  const id = (n: number) => `${String(n).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`
  const uri = (n: number) => `note://${repo}/${id(n)}`
  const records = [
    { n: 1, title: 'Interface fixture', role: 'project' },
    { n: 2, title: 'Session provider', parent: uri(1), interfaces: [{ name: 'AgentSessionRegistry', direction: 'provides' }] },
    { n: 3, title: 'Terminal consumer', parent: uri(1), interfaces: [{ name: 'AgentSessionRegistry', direction: 'needs', provider: uri(2) }] },
    { n: 4, title: 'Other module', parent: uri(1) },
  ]
  const blueprint = projectGraph({ repoId: repo, repoName: 'Interface fixture', revision: 1,
    entries: records.map(({ n, title, ...meta }) => ({
      doc: toNoteDoc(parseNote(`---\n${JSON.stringify({ schema: 'harness-note/2', id: id(n), kind: 'module', lifecycle: 'accepted',
        moduleState: 'partial', created: '2026-10-28', updated: '2026-10-28T00:00:00Z', ...meta })}\n---\n# ${title}\n\n## Responsibility\nInterface fixture.\n`)),
      relPath: `.agents/notes/${n}.md`, sha256: 'a'.repeat(64),
    })) }, 'C:/interface-fixture')
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
    import {Graph} from './plugins/blueprint/src/ui/Graph';
    import './plugins/blueprint/src/ui/style.css';
    import './src/renderer/src/styles/themes.generated.css';
    const blueprint = ${JSON.stringify(blueprint)};
    function Fixture() {
      const [nodeId, select] = useState(blueprint.rootNodeId);
      return <div style={{height:'100vh', display:'flex'}}>
        <Graph blueprint={blueprint} navigation={{scopeId:null, nodeId}} navigationKey={0}
          select={select} enter={() => {}} remember={() => {}} save={() => {}} suggestions={{}} query="" />
      </div>;
    }
    createRoot(document.getElementById('root')).render(<Fixture/>);
  ` }, bundle: true, write: false, outfile: 'edge-label-ui.js', jsx: 'automatic', format: 'iife' })
  script = result.outputFiles.find(file => file.path.endsWith('.js'))!.text
  css = result.outputFiles.find(file => file.path.endsWith('.css'))!.text
  browser = await chromium.launch({ headless: true })
  await mkdir('artifacts/edge-label', { recursive: true })
})
afterAll(async () => { await browser?.close() })

it.each(['planche', 'dark'])('keeps interface badges clear, readable and navigable in %s', async theme => {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  page.setDefaultTimeout(5000)
  try {
    await page.setContent(`<html data-theme="${theme}"><body><div id="root"></div></body></html>`)
    await page.addStyleTag({ content: css })
    await page.addScriptTag({ content: script })
    const label = page.getByText('AgentSessionRegistry', { exact: true })
    await label.waitFor()
    await expect.poll(() => page.locator('.react-flow').evaluate(element =>
      element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length)).toBe(0)
    await page.screenshot({ path: `artifacts/edge-label/interface-fixture-${theme}.png` })
    const overlapping = () => label.evaluate(element => {
      const box = element.getBoundingClientRect()
      return [...document.querySelectorAll('.bp-node-card')].filter(card => {
        const rect = card.getBoundingClientRect()
        return box.left < rect.right && box.right > rect.left && box.top < rect.bottom && box.bottom > rect.top
      }).map(card => card.querySelector('.bp-node-card__title')?.textContent)
    })
    expect(await overlapping()).toEqual([])
    const contrast = await label.evaluate(element => {
      const rgb = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(channel => {
        const normalized = channel / 255
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
      })
      const luminance = (value: string) => {
        const [red, green, blue] = rgb(value)
        return 0.2126 * red + 0.7152 * green + 0.0722 * blue
      }
      const foreground = luminance(getComputedStyle(element).color), background = luminance(getComputedStyle(element).backgroundColor)
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
    })
    expect(contrast).toBeGreaterThanOrEqual(4.5)
    expect(await label.evaluate(element => getComputedStyle(element).pointerEvents)).toBe('none')
    expect(await page.locator('.bp-edge-label__leader').count()).toBeGreaterThan(0)
    const viewport = () => page.locator('.react-flow__viewport').evaluate(element => {
      const matrix = new DOMMatrix(getComputedStyle(element).transform)
      return { x: matrix.e, y: matrix.f, zoom: matrix.a }
    })
    const beforeZoom = await viewport()
    const initialBadge = (await label.boundingBox())!
    await page.mouse.move(initialBadge.x + initialBadge.width / 2, initialBadge.y + initialBadge.height / 2)
    await page.mouse.wheel(0, 240)
    await expect.poll(async () => (await viewport()).zoom).toBeLessThan(beforeZoom.zoom)
    await expect.poll(overlapping).toEqual([])
    const beforePan = await viewport(), badge = (await label.boundingBox())!
    await page.mouse.move(badge.x + badge.width / 2, badge.y + badge.height / 2)
    await page.mouse.down(); await page.mouse.move(badge.x + badge.width / 2 + 60, badge.y + badge.height / 2 + 20, { steps: 5 }); await page.mouse.up()
    await expect.poll(async () => (await viewport()).x).toBeGreaterThan(beforePan.x + 40)
    expect(await overlapping()).toEqual([])
    await page.setViewportSize({ width: 760, height: 800 })
    await expect.poll(overlapping).toEqual([])
    await label.waitFor({ state: 'visible' })
  } finally { await page.close() }
})
