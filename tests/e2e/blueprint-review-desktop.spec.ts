import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { SUPPORTED_HARNESS_PROFILE } from '@janus-agent/harness-node'
import { ReviewStore } from '../../plugins/blueprint/src/main/blueprint/suggestions/store'
import { SuggestionService } from '../../plugins/blueprint/src/main/blueprint/suggestions/service'
import { WorkspaceSuggestions } from '../../plugins/blueprint/src/main/blueprint/suggestions/workspace-service'
import { WorkspaceSuggestionSources } from '../../plugins/blueprint/src/main/blueprint/suggestions/sources'
import { createDesktopTestEnv } from './desktop-test-env'
import { DEFAULT_BLUEPRINT_REVIEW_SETTINGS } from '../../plugins/blueprint/src/shared/blueprint-review-settings'

test('enabled review stays visible through native status IPC while the Note read is blocked', async ({}, testInfo) => {
  const root = await mkdtemp(join(tmpdir(), 'janusx-review-status-desktop-'))
  const workspace = join(root, 'workspace'), userData = join(root, 'user-data')
  await mkdir(join(workspace, '.agents/notes'), { recursive: true })
  await writeFile(join(workspace, '.agents/harness.json'), JSON.stringify({ schemaVersion: 1, repoId: randomUUID(), profile: SUPPORTED_HARNESS_PROFILE }))
  await writeFile(join(workspace, '.agents/notes/module.md'), '---\n' + JSON.stringify({ schema: 'harness-note/2', id: randomUUID(), kind: 'module', role: 'project', lifecycle: 'accepted', moduleState: 'partial', created: '2026-10-10', updated: '2026-10-10T00:00:00Z' }) + '\n---\n# Status Workspace\n\n## Responsibility\n\nDesktop status acceptance.\n')
  await mkdir(join(userData, 'janusx/blueprint'), { recursive: true })
  await writeFile(join(userData, 'janusx/blueprint/review-settings.json'), JSON.stringify({ ...DEFAULT_BLUEPRINT_REVIEW_SETTINGS, automatic: { enabled: true, commits: 3 } }))
  const buildRoot = resolve('out')
  const application = await electron.launch({ args: [join(buildRoot, 'main/index.js'), `--user-data-dir=${userData}`], env: { ...createDesktopTestEnv(root), JANUSX_DEV_BUILD_ROOT: buildRoot, CODEX_HOME: join(root, 'codex'), APPDATA: join(root, 'appdata'), DSH_HOME: join(root, 'dsh'), XDG_CONFIG_HOME: join(root, 'config') } })
  try {
    const page = await application.firstWindow({ timeout: 30000 })
    await page.waitForFunction(() => Boolean(window.electron?.blueprintReview))
    // Only the full corpus response is held. Settings, pushes and activityRead use real IPC.
    await application.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('blueprint:review:read')
      ipcMain.handle('blueprint:review:read', () => new Promise(() => {}))
    })
    await page.evaluate(async path => {
      await window.electron.system.setLanguage('en')
      await window.electron.experimental.update({ ...await window.electron.experimental.get(), blueprint: true, persona: true, knowledge: false })
      await window.electron.workspace.create({ name: 'Status desktop', path })
    }, workspace)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.getByRole('button', { name: /Open Blueprint workbench/i }).click()
    const bar = page.getByRole('button', { name: 'Automatic review details', exact: true })
    await expect(bar).toContainText('Automatic review enabled')
    const measurement = await page.evaluate(async path => {
      const start = performance.now()
      const status = await window.electron.blueprintReview.activityRead(path)
      return { elapsedMs: performance.now() - start, status }
    }, workspace)
    expect(measurement.status.automaticSettings).toEqual({ enabled: true, commits: 3 })
    expect(measurement.elapsedMs).toBeLessThan(2000)
    await testInfo.attach('native-status-read', { body: JSON.stringify(measurement, null, 2), contentType: 'application/json' })
    await bar.click()
    const details = page.getByRole('dialog', { name: 'Automatic review details', exact: true })
    await expect(details).toContainText('Syncing Note sources')
    await page.keyboard.press('Escape')
    const settings = await page.evaluate(() => window.electron.blueprintReview.settingsGet())
    await page.evaluate(settings => window.electron.blueprintReview.settingsUpdate({ ...settings, automatic: { enabled: false, commits: 3 } }), settings)
    await expect(bar).toHaveCount(0)
    await page.evaluate(settings => window.electron.blueprintReview.settingsUpdate({ ...settings, automatic: { enabled: true, commits: 3 } }), settings)
    await expect(bar).toContainText('Automatic review enabled')
    await page.screenshot({ path: '.agents/.local/review-status/desktop-enabled.png' })
    const finalStatus = await page.evaluate(path => window.electron.blueprintReview.activityRead(path), workspace)
    expect(finalStatus.activities).toEqual([])
    expect(finalStatus.automatic?.reason).toBe('no-git')
  } finally {
    await application.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('built desktop shares current suggestions, persists settings and starts independent MCP', async () => {
  const root = await mkdtemp(join(tmpdir(), 'janusx-review-desktop-'))
  const workspace = join(root, 'workspace'), userData = join(root, 'user-data')
  const repoId = randomUUID(), rootId = randomUUID(), noteId = randomUUID(), findingId = randomUUID()
  await mkdir(join(workspace, '.agents/notes/child'), { recursive: true })
  await writeFile(join(workspace, '.agents/harness.json'), JSON.stringify({ schemaVersion: 1, repoId, profile: SUPPORTED_HARNESS_PROFILE }))
  const file = join(workspace, '.agents/notes/child/module.md')
  await writeFile(join(workspace, '.agents/notes/module.md'), '---\n' + JSON.stringify({ schema: 'harness-note/2', id: rootId, kind: 'module', role: 'project', lifecycle: 'accepted', moduleState: 'partial', created: '2026-10-10', updated: '2026-10-10T00:00:00Z' }) + '\n---\n# Review Workspace\n\n## Responsibility\n\nDesktop acceptance.\n')
  const original = '---\n' + JSON.stringify({ schema: 'harness-note/2', id: noteId, kind: 'module', parent: `note://${repoId}/${rootId}`, lifecycle: 'accepted', moduleState: 'partial', created: '2026-10-10', updated: '2026-10-10T00:00:00Z' }) + '\n---\n# Review Desktop Fixture\n\n## Responsibility\n\nRead original Notes.\n\n## Design\n\nRecovery is pending.\n'
  await writeFile(file, original)
  const stateRoot = join(userData, 'janusx/blueprint')
  const store = new ReviewStore(join(stateRoot, 'current-suggestions.sqlite')), sources = new WorkspaceSuggestionSources()
  const suggestions = new WorkspaceSuggestions(new SuggestionService(store), sources)
  const context = await sources.context(workspace), ticket = await suggestions.begin(context, noteId)
  await suggestions.publish(context, noteId, ticket.id, { findings: [{ id: findingId, category: 'insufficient', summary: 'Define recovery', explanation: 'Recovery has no boundary.', suggestion: 'Define recovery conditions.', verification: 'not-configured', citations: [{ path: '.agents/notes/child/module.md', quote: 'Recovery is pending.' }] }], coverage: 'complete', limitations: [], resolvedFindings: [] })
  const buildRoot = resolve('out')
  const launch = () => electron.launch({ args: [join(buildRoot, 'main/index.js'), `--user-data-dir=${userData}`], env: { ...createDesktopTestEnv(root), JANUSX_DEV_BUILD_ROOT: buildRoot, CODEX_HOME: join(root, 'codex'), APPDATA: join(root, 'appdata'), DSH_HOME: join(root, 'dsh'), XDG_CONFIG_HOME: join(root, 'config') } })
  let application: Awaited<ReturnType<typeof launch>> | undefined
  try {
    application = await launch()
    const page = await application.firstWindow({ timeout: 30000 })
    await page.waitForFunction(() => Boolean(window.electron?.blueprintReview))
    await page.evaluate(async path => {
      await window.electron.system.setLanguage('en')
      await window.electron.experimental.update({ ...await window.electron.experimental.get(), blueprint: true, persona: true, knowledge: false })
      await window.electron.workspace.create({ name: 'Review desktop', path })
    }, workspace)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.getByRole('button', { name: /Open Blueprint workbench/i }).click()
    await page.locator('.react-flow__node').first().click()
    await page.locator('.react-flow__node').filter({ hasText: 'Review Desktop Fixture' }).click()
    // The reader card starts collapsed and only auto-expands on an attention-panel
    // navigation, so open it before the finding summary is reachable. Anchor the name
    // so the "Open content review" shortcut portal does not also match.
    await page.getByRole('button', { name: /^Content review \d+ findings$/i }).click()
    await page.getByText('Define recovery', { exact: true }).click()
    await expect(page.getByRole('button', { name: 'Handled', exact: true })).toBeVisible()
    await page.screenshot({ path: 'artifacts/blueprint-review-desktop.png' })
    await page.getByRole('button', { name: 'Handled', exact: true }).click()
    await expect(page.getByText('Define recovery', { exact: true })).toHaveCount(0)
    expect((await suggestions.read(context)).items[0]?.report?.findings ?? []).toEqual([])
    expect(await readFile(file, 'utf8')).toBe(original)
    const settings = await page.evaluate(() => window.electron.blueprintReview.settingsGet())
    expect(settings.automatic).toEqual({ enabled: false, commits: 5 })
    await page.locator('.blueprint-workbench-close').click()
    await expect(page.locator('.blueprint-workbench-backdrop')).toHaveCount(0)
    await page.evaluate(() => window.dispatchEvent(new Event('janusx:open-knowledge-settings')))
    await expect(page.getByText('MCP integration', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Test service', exact: true }).click()
    await expect(page.getByText('Service handshake and Note read passed. This does not verify a call inside the terminal.', { exact: true })).toBeVisible({ timeout: 20000 })
    await page.screenshot({ path: 'artifacts/blueprint-settings-desktop.png' })
    await page.evaluate(async settings => window.electron.blueprintReview.settingsUpdate({ ...settings, automatic: { enabled: false, commits: 7 } }), settings)
    await application.close(); application = await launch()
    const reopened = await application.firstWindow()
    await reopened.waitForFunction(() => Boolean(window.electron?.blueprintReview))
    expect((await reopened.evaluate(() => window.electron.blueprintReview.settingsGet())).automatic).toEqual({ enabled: false, commits: 7 })
    expect((await reopened.evaluate(path => window.electron.blueprintReview.read(path), workspace)).items.flatMap(item => item.report?.findings ?? [])).toEqual([])
  } finally { await application?.close(); sources.notes.unwatchAll(); store.close(); await rm(root, { recursive: true, force: true }) }
})
