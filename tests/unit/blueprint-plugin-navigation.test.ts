import { beforeAll, afterAll, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { build } from 'esbuild'
import { parseNote } from '@janus-agent/harness-core'
import { projectGraph } from '../../plugins/blueprint/src/main/notes/note-to-blueprint'
import { toNoteDoc } from '../../src/main/notes/note-provider'
import { navigateNote, pushNavigation, rememberViewport, type NavigationHistory } from '../../plugins/blueprint/src/ui/graph/navigation-history'
import { UNASSIGNED_SCOPE } from '../../plugins/blueprint/src/ui/graph/module-browsing'

const repo = '11111111-1111-4111-8111-111111111111'
const id = (n: number) => `${String(n).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`
const uri = (n: number) => `note://${repo}/${id(n)}`
const records = [
  { n: 1, title: 'Project', kind: 'module', role: 'project' },
  { n: 2, title: 'Reader', kind: 'module', parent: uri(1) },
  { n: 3, title: 'Writer', kind: 'module', parent: uri(1) },
  { n: 4, title: 'Nested reader', kind: 'module', parent: uri(2) },
  { n: 5, title: 'Reader document', kind: 'note', module: uri(2) },
  { n: 6, title: 'Writer document', kind: 'note', module: uri(3) },
  { n: 7, title: 'Historical document', kind: 'note' },
]
const blueprint = projectGraph({ repoId: repo, repoName: 'Navigation fixture', revision: 1, entries: records.map(({ n, title, ...meta }) => ({
  doc: toNoteDoc(parseNote(`---\n${JSON.stringify({ schema: 'harness-note/2', id: id(n), lifecycle: 'accepted', created: '2026-10-25',
    ...(meta.kind === 'module' ? { moduleState: 'partial' } : {}), ...meta })}\n---\n# ${title}\n\nNavigation fixture.\n`)),
  relPath: `.agents/notes/${n}.md`, sha256: 'a'.repeat(64),
})) }, 'C:/navigation-fixture')

it('resolves module ownership, canonical home and unassigned documents without mutating source', () => {
  const before = structuredClone(blueprint)
  const home = navigateNote({ entries: [], index: -1 }, blueprint, id(1))
  expect(home.entries[0]).toMatchObject({ nodeId: id(1), scopeId: id(1) })
  expect(pushNavigation(home, { nodeId: id(1), scopeId: id(1) })).toBe(home)
  const child = navigateNote(home, blueprint, id(2))
  expect(child.entries.at(-1)?.scopeId).toBe(id(1))
  const document = navigateNote(child, blueprint, id(6))
  expect(document.entries.at(-1)).toEqual({ nodeId: id(6), scopeId: id(3) })
  expect(navigateNote(document, blueprint, id(7)).entries.at(-1)?.scopeId).toBe(UNASSIGNED_SCOPE)
  expect(blueprint).toEqual(before)
})

it('keeps viewport history when branching and selecting within one module', () => {
  const viewport = { x: 12, y: 34, zoom: 0.75 }
  let history: NavigationHistory = navigateNote({ entries: [], index: -1 }, blueprint, id(5))
  history = rememberViewport(history, viewport)
  history = navigateNote(history, blueprint, id(4))
  expect(history.entries.at(-1)?.viewport).toEqual(viewport)
  history = navigateNote(history, blueprint, id(6))
  history = navigateNote({ ...history, index: 0 }, blueprint, id(7))
  expect(history.entries).toHaveLength(2)
  expect(history.entries[0].viewport).toEqual(viewport)
  expect(history.entries[1].viewport).toBeUndefined()
})

let browser: Browser, script: string, css: string
beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
    import {Graph} from './plugins/blueprint/src/ui/Graph';
    import {navigateNote, pushNavigation, rememberViewport} from './plugins/blueprint/src/ui/graph/navigation-history';
    import {setLocale} from './plugins/blueprint/src/ui/i18n';
    import './plugins/blueprint/src/ui/style.css';
    const blueprint = ${JSON.stringify(blueprint)};
    setLocale('en');
    function Fixture() {
      const [source, setSource] = useState(blueprint);
      const [narrow, setNarrow] = useState(false);
      const [history, setHistory] = useState(() => navigateNote({entries: [], index: -1}, blueprint, blueprint.rootNodeId));
      window.historyState = history;
      const select = id => setHistory(previous => navigateNote(previous, blueprint, id));
      return <div style={{height: '100vh', display: 'flex', flexDirection: 'column'}}>
        <nav><button disabled={history.index <= 0} onClick={() => setHistory(h => ({...h, index: h.index - 1}))}>Back</button>
        <button disabled={history.index >= history.entries.length - 1} onClick={() => setHistory(h => ({...h, index: h.index + 1}))}>Forward</button>
        <button onClick={() => select('${id(6)}')}>Locate writer document</button>
        <button onClick={() => setSource(structuredClone(blueprint))}>Refresh graph</button></nav>
        <button onClick={() => setNarrow(value => !value)}>Toggle side card</button>
        <div style={{display: 'flex', flex: 1, minHeight: 0, width: narrow ? 'calc(100% - 680px)' : '100%'}}>
        <Graph blueprint={source} navigation={history.entries[history.index]} navigationKey={history.index}
          select={select} enter={(scopeId, nodeId) => setHistory(h => pushNavigation(h, {scopeId, nodeId}))}
          remember={viewport => setHistory(h => rememberViewport(h, viewport))} save={() => {}}
          suggestions={{'${id(5)}': 2}} query="" matches={source.nodeIds.map(id => id)} />
        </div>
      </div>
    }
    createRoot(document.getElementById('root')).render(<Fixture/>);
  ` }, bundle: true, write: false, outfile: 'navigation-ui.js', jsx: 'automatic', format: 'iife' })
  script = result.outputFiles.find(file => file.path.endsWith('.js'))!.text
  css = result.outputFiles.find(file => file.path.endsWith('.css'))!.text
})

it('restores the original canvas chrome, theme, context menu and empty-module hint', async () => {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  try {
    await mount(page)
    expect(await page.locator('.react-flow.dark').count()).toBe(1)
    expect(await page.locator('.react-flow__controls').count()).toBe(0)
    expect(await page.locator('.react-flow__minimap').count()).toBe(0)
    expect(await page.locator('.bp-canvas-legend').innerText()).toContain('Pending suggestions')
    expect(await page.locator('.bp-canvas-legend').innerText()).toContain('Parent')
    const pattern = page.locator('.react-flow__background pattern')
    const before = (await current(page)).viewport.zoom
    expect(Number(await pattern.getAttribute('width'))).toBeCloseTo(before * 24, 2)
    await page.evaluate(() => { document.documentElement.dataset.theme = 'planche' })
    await expect.poll(() => page.locator('.react-flow.light').count()).toBe(1)
    expect(await page.locator('.react-flow__background circle').evaluate(element => getComputedStyle(element).fill)).toBe('rgba(28, 52, 59, 0.16)')
    await page.locator(`.react-flow__node[data-id="${id(2)}"]`).click({ button: 'right' })
    const detail = page.locator('.bp-context-menu').getByRole('button', { name: 'Node Detail', exact: true })
    await detail.click()
    await expect.poll(() => current(page)).toMatchObject({ nodeId: id(2), scopeId: id(1) })
    expect(await page.locator('.bp-context-menu').count()).toBe(0)
    await page.getByRole('button', { name: 'Enter module Reader', exact: true }).click()
    await page.getByRole('button', { name: 'Enter module Nested reader', exact: true }).click()
    await expect.poll(() => page.locator('.bp-browser-empty').isVisible()).toBe(true)
    expect(await page.locator('.bp-browser-empty').innerText()).toBe('This module has no direct files or submodules yet. Its description is available in the left preview.')
  } finally { await page.close() }
})

it('refits modules when side cards change the canvas and preserves wheel zoom after selection', async () => {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  try {
    await mount(page)
    const original = (await current(page)).viewport
    await page.getByRole('button', { name: 'Toggle side card', exact: true }).click()
    await expect.poll(async () => (await current(page)).viewport.zoom).toBeLessThan(original.zoom)
    expect(await page.locator('.react-flow').evaluate(element => {
      const canvas = element.getBoundingClientRect()
      return [...element.querySelectorAll('.bp-node-card')].every(node => {
        const box = node.getBoundingClientRect()
        return box.left >= canvas.left && box.right <= canvas.right && box.top >= canvas.top && box.bottom <= canvas.bottom
      })
    })).toBe(true)
    await page.getByRole('button', { name: 'Toggle side card', exact: true }).click()
    await expect.poll(async () => (await current(page)).viewport.zoom).toBeCloseTo(original.zoom, 3)
    await page.locator(`.react-flow__node[data-id="${id(2)}"]`).click()
    const before = (await current(page)).viewport.zoom
    await page.locator('.react-flow__pane').hover({ position: { x: 600, y: 80 } })
    await page.mouse.wheel(0, -300)
    await expect.poll(async () => (await current(page)).viewport.zoom).toBeGreaterThan(before)
  } finally { await page.close() }
})
afterAll(async () => { await browser?.close() })
async function mount(page: Page) {
  page.setDefaultTimeout(5000)
  await page.setContent('<div id="root"></div>')
  await page.addStyleTag({ content: css })
  await page.addScriptTag({ content: script })
  await page.locator('.react-flow__node').first().waitFor()
  await expect.poll(async () => (await current(page)).viewport?.zoom).toBeTypeOf('number')
}
const current = (page: Page) => page.evaluate(() => {
  const history = (window as any).historyState
  return history.entries[history.index]
})

it('keeps measured cards visible after a source refresh with unchanged node sizes', async () => {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  try {
    await mount(page)
    const card = page.locator('.bp-node-card').first()
    expect(await card.isVisible()).toBe(true)
    await page.getByRole('button', { name: 'Refresh graph', exact: true }).click()
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await expect.poll(() => card.isVisible()).toBe(true)
    // Selection/zoom still work after refreshed DTOs replace the graph.
    await page.locator(`.react-flow__node[data-id="${id(2)}"]`).click()
    await expect.poll(() => current(page)).toMatchObject({ nodeId: id(2), scopeId: id(1) })
  } finally { await page.close() }
})

it('enters nested modules and restores selected nodes and zoom on back and forward', async () => {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  try {
    await mount(page)
    const card = (n: number) => page.locator(`.react-flow__node[data-id="${id(n)}"]`)
    await card(2).locator('.bp-node-card__title').dblclick()
    await expect.poll(() => current(page)).toMatchObject({ nodeId: id(2), scopeId: id(2) })
    await card(5).waitFor()
    expect(await card(6).count()).toBe(0)
    const indicator = page.getByRole('button', { name: '2 pending review suggestions', exact: true })
    expect(await indicator.count()).toBe(1)
    expect(await indicator.innerText()).toBe('')
    await indicator.click()
    await expect.poll(() => current(page)).toMatchObject({ nodeId: id(5), scopeId: id(2) })
    expect(await card(5).locator('.bp-node-card--document').evaluate(el => getComputedStyle(el).borderRadius)).toBe('4px')
    expect(await card(2).locator('.bp-node-card--module').evaluate(el => getComputedStyle(el).borderRadius)).toBe('8px')
    await expect.poll(async () => (await current(page)).viewport?.zoom).toBeTypeOf('number')
    const beforeZoom = (await current(page)).viewport.zoom
    await page.locator('.react-flow__pane').hover({ position: { x: 600, y: 200 } })
    await page.mouse.wheel(0, -240)
    await expect.poll(async () => (await current(page)).viewport?.zoom).toBeGreaterThan(beforeZoom)
    await card(4).click()
    await expect.poll(() => current(page)).toMatchObject({ nodeId: id(4), scopeId: id(2) })
    const previous = await current(page)
    await card(4).getByRole('button', { name: 'Enter module Nested reader', exact: true }).click()
    await expect.poll(() => current(page)).toMatchObject({ nodeId: id(4), scopeId: id(4) })
    await page.getByRole('button', { name: 'Back', exact: true }).first().click()
    await expect.poll(() => current(page)).toEqual(previous)
    await expect.poll(() => page.locator('.react-flow__viewport').evaluate(el => {
      const matrix = new DOMMatrix(getComputedStyle(el).transform)
      return { x: matrix.e, y: matrix.f, zoom: matrix.a }
    })).toMatchObject({ x: expect.closeTo(previous.viewport.x, 2), y: expect.closeTo(previous.viewport.y, 2), zoom: expect.closeTo(previous.viewport.zoom, 4) })
    expect(await card(4).getAttribute('class')).toContain('selected')
    await page.getByRole('button', { name: 'Forward', exact: true }).click()
    await expect.poll(() => current(page)).toMatchObject({ scopeId: id(4) })
    await expect.poll(() => card(5).count()).toBe(0)
  } finally { await page.close() }
})

it('locates a document in a different module and exposes the unassigned page', async () => {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  try {
    await mount(page)
    await page.getByRole('button', { name: 'Locate writer document', exact: true }).click()
    await expect.poll(() => current(page)).toMatchObject({ nodeId: id(6), scopeId: id(3) })
    await page.locator(`.react-flow__node[data-id="${id(6)}"].selected`).waitFor()
    await page.locator('.bp-browser-unassigned summary').click(); await page.getByRole('button', { name: 'Historical document Note', exact: true }).click()
    await expect.poll(() => current(page)).toMatchObject({ nodeId: id(7), scopeId: UNASSIGNED_SCOPE })
    await page.locator('.bp-node-card__title').filter({ hasText: /^Historical document$/ }).waitFor()
    expect(await page.getByText('Writer document', { exact: true }).count()).toBe(0)
    await page.getByRole('button', { name: 'Project', exact: true }).click()
    await expect.poll(() => current(page)).toMatchObject({ nodeId: id(1), scopeId: id(1) })
    expect(await page.getByRole('button', { name: 'Overview', exact: true }).count()).toBe(0)
  } finally { await page.close() }
})
