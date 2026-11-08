// Note: .agents/notes/desktop/browser-computer-use.md — real upstream MCP through the production chat adapter.
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createDesktopTestEnv, seedIntroducedLearning } from './desktop-test-env'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const entry = resolve(process.env.JANUSX_E2E_ENTRY || 'artifacts/build-check/main/index.js')

test('terminal browser registration shares native MCP files, controls real tabs and revokes removed clients', async () => {
  test.setTimeout(150000)
  const root = await mkdtemp(join(tmpdir(), 'janusx-browser-terminal-'))
  const profile = join(root, 'profile'), workspace = join(root, 'workspace')
  await mkdir(join(profile, 'janusx'), { recursive: true }); await mkdir(workspace)
  await writeFile(join(profile, 'janusx/config.json'), JSON.stringify({ agentApprovalMode: 'auto-run', language: 'en' }))
  const env = createDesktopTestEnv(root)
  env.CODEX_HOME = join(root, 'home', '.codex')
  env.XDG_CONFIG_HOME = join(root, 'home', '.config')
  env.CLAUDE_CONFIG_DIR = join(root, 'home', '.claude')
  env.PI_CODING_AGENT_DIR = join(root, 'home', '.pi', 'agent')
  env.DSH_HOME = join(root, 'home', '.dsh')
  delete env.OPENCODE_CONFIG
  const fixture = createServer((_request, response) => response.end('<!doctype html><title>Terminal browser fixture</title><h1>Browser connected</h1>'))
  await new Promise<void>(resolve => fixture.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(fixture.address() as { port: number }).port}`
  const application = await electron.launch({ args: [entry, `--user-data-dir=${profile}`], env })
  let client: Client | undefined
  try {
    const page = await application.firstWindow()
    await seedIntroducedLearning(page); await page.reload()
    await page.getByTitle('Settings', { exact: true }).click()
    await page.locator('[data-tab="browser-control"]').click()
    const panel = page.locator('[data-browser-terminal-settings]')
    await expect(panel.locator('[data-browser-client]')).toHaveCount(6)
    for (const id of ['claude', 'codex', 'opencode', 'janus', 'pi', 'dsh']) {
      const row = panel.locator(`[data-browser-client="${id}"]`)
      await row.getByRole('button', { name: 'Register', exact: true }).click()
      await expect(row).toContainText('Configured')
      await row.getByRole('button', { name: 'Check connection', exact: true }).click()
      await expect(panel.getByRole('status')).toContainText('tools found', { timeout: 20000 })
    }
    await page.screenshot({ path: test.info().outputPath('terminal-access-dark.png') })
    const rows = await page.evaluate(() => window.electron.controls.clients())
    const codex = rows.find(row => row.id === 'codex')!
    const text = await readFile(codex.path, 'utf8')
    expect(text).toContain('[mcp_servers.janusx-browser]')
    const native = await page.evaluate(async () => {
      const query = { client: 'codex' as const, scope: 'user' as const }
      const catalog = await window.electron.localIntegrations!.scan(query)
      const entry = catalog.entries.find(entry => entry.name === 'janusx-browser')!
      return JSON.parse((await window.electron.localIntegrations!.read(query, entry.id)).content)
    })
    client = new Client({ name: 'terminal-desktop-test', version: '1.0.0' })
    const transport = new StdioClientTransport({ command: native.command, args: native.args, env: { ...process.env, ...native.env }, cwd: workspace, stderr: 'pipe' })
    transport.stderr?.on('data', () => {})
    await client.connect(transport)
    expect((await client.listTools()).tools.map(tool => tool.name)).toContain('new_page')
    // Close the covering settings modal before host automation displays its native surface.
    await page.getByRole('dialog', { name: 'Browser control', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()
    const created = await client.callTool({ name: 'new_page', arguments: { url } })
    expect(created.isError).not.toBe(true)
    const block = created.content as Array<{ type: string; text: string }>
    const pageId = JSON.parse(block[0].text).pageId
    expect(typeof pageId).toBe('number')
    const listing = await client.callTool({ name: 'list_pages', arguments: {} })
    expect(JSON.stringify(listing)).toContain(String(pageId))
    const snapshot = await client.callTool({ name: 'take_snapshot', arguments: { pageId } })
    expect(snapshot.isError).not.toBe(true)
    expect(JSON.stringify(snapshot)).toContain('Browser connected')
    await page.reload()
    await page.getByTitle('Settings', { exact: true }).click()
    await page.locator('[data-tab="browser-control"]').click()
    const row = panel.locator('[data-browser-client="codex"]')
    await row.getByRole('button', { name: 'Remove', exact: true }).click()
    await panel.getByRole('button', { name: 'Confirm removal', exact: true }).click()
    await expect(row).toContainText('Not registered')
    const denied = await client.callTool({ name: 'list_pages', arguments: {} })
    expect(denied.isError).toBe(true)
    expect(JSON.stringify(denied)).toContain('expired')
  } finally {
    await client?.close()
    await application.evaluate(({ app }) => app.exit(0)).catch(() => {}); await application.close().catch(() => {})
    fixture.closeAllConnections(); await new Promise<void>(resolve => fixture.close(() => resolve()))
  }
})

// Main-process inspection is confined to the test debugger. No test IPC or execute bridge ships in the app.
async function attach(application: ElectronApplication, owner: string, runId = owner, workspaceRoot?: string): Promise<string[]> {
  return application.evaluate(async (_electron, { directory, owner, runId, workspaceRoot }) => {
    const fs = process.getBuiltinModule('node:fs/promises'), path = process.getBuiltinModule('node:path')
    const chunks = path.join(directory, 'chunks')
    const files = await fs.readdir(chunks)
    let target: string | undefined
    for (const file of files.filter(file => file.startsWith('chat-tools-'))) {
      if ((await fs.readFile(path.join(chunks, file), 'utf8')).includes('function attachBrowserTools')) { target = path.join(chunks, file); break }
    }
    if (!target) throw new Error('Production browser chat adapter chunk not found')
    const exports = process.getBuiltinModule('node:module').createRequire(target)(target)
    const attach = Object.values(exports).find(value => typeof value === 'function' && value.name === 'attachBrowserTools') as Function
    if (!attach) throw new Error('Production browser adapter export not found')
    const state = globalThis as unknown as { browserTests?: Record<string, { tools: Array<{ name: string; parameters: { parse(input: unknown): unknown }; execute(call: unknown, signal: AbortSignal): Promise<unknown> }>; controller: AbortController }> }
    const controller = new AbortController()
    const ports = { localTools: [] }
    await attach(ports, { owner, runId, signal: controller.signal, root: workspaceRoot })
    state.browserTests ??= {}
    state.browserTests[owner] = { tools: ports.localTools, controller }
    return ports.localTools.map((tool: { name: string }) => tool.name)
  }, { directory: dirname(entry), owner, runId, workspaceRoot })
}
async function tool(application: ElectronApplication, owner: string, name: string, input: Record<string, unknown> = {}) {
  return application.evaluate(async (_electron, { owner, name, input }) => {
    const state = (globalThis as unknown as { browserTests: Record<string, { tools: Array<{ name: string; parameters: { parse(input: unknown): unknown }; execute(call: unknown, signal: AbortSignal): Promise<{ content: string; isError?: boolean }> }>; controller: AbortController }> }).browserTests[owner]
    const tool = state.tools.find(tool => tool.name === name)
    if (!tool) throw new Error(`Browser tool not offered: ${name}`)
    tool.parameters.parse(input)
    return tool.execute({ id: `test-${Date.now()}`, name, arguments: input }, state.controller.signal)
  }, { owner, name, input })
}
const output = (result: { content: string; isError?: boolean }) => {
  expect(result.isError, result.content).not.toBe(true)
  return JSON.parse(result.content)
}
const ref = (snapshot: string, label: string, role = 'button') => {
  const line = snapshot.split('\n').find(line => line.includes(`${role} "${label}"`))
  const uid = line?.match(/uid=(\S+)/)?.[1]
  expect(uid, `Missing ${label} in ${snapshot}`).toBeTruthy()
  return uid!
}
async function readCounter(app: ElectronApplication, id: number) {
  return app.evaluate(({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('document.querySelector("#count").textContent'), id)
}

test('browser chat tools adapt native tabs, isolate targets, stop control and persist both settings panels', async () => {
  test.setTimeout(150000)
  const root = await mkdtemp(join(tmpdir(), 'janusx-browser-control-'))
  const profile = join(root, 'profile')
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  await writeFile(join(workspace, 'upload.txt'), 'browser control fixture')
  await writeFile(join(root, 'outside.txt'), 'outside workspace')
  await mkdir(join(profile, 'janusx'), { recursive: true })
  await writeFile(join(profile, 'janusx/config.json'), JSON.stringify({ agentApprovalMode: 'auto-run', language: 'en' }))
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    if (req.url === '/next') { res.end('<title>Next</title><button>Replacement</button>'); return }
    res.end('<!doctype html><title>Control fixture</title><style>html{background:white;color:black}</style><h1>Control fixture</h1><button onclick="count.textContent=Number(count.textContent)+1">Increment</button><output id="count">0</output><label>Name<input id="name"></label><label>Upload<input id="upload" type="file"></label>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  let application: ElectronApplication | undefined
  try {
    application = await electron.launch({ args: [entry, `--user-data-dir=${profile}`], env: createDesktopTestEnv(root) })
    const app = application
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await seedIntroducedLearning(page); await page.reload()
    await page.getByTitle('Settings', { exact: true }).click()
    await page.locator('[data-tab="browser-control"]').click()
    await expect(page.locator('[data-control-runtime]')).toHaveText('Runtime ready', { timeout: 20000 })
    await page.screenshot({ path: test.info().outputPath('browser-settings-dark-en.png') })
    await page.locator('[data-tab="computer-control"]').click()
    await expect(page.getByRole('note')).toContainText('not connected yet')
    await page.getByLabel('Driver executable', { exact: true }).fill('C:\\missing\\cua-driver.exe')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByRole('status')).toHaveText('Settings saved')
    await page.getByRole('button', { name: 'Check driver version', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('ENOENT')
    await page.getByRole('dialog', { name: 'Computer control', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()

    const names = await attach(app, 'one', 'one', workspace)
    expect(names).toContain('browser_new_page')
    expect(names).toContain('browser_take_snapshot')
    expect(names).not.toContain('browser_evaluate_script')
    const first = { pageId: output(await tool(app, 'one', 'browser_new_page', { url: origin + '/' })).pageId as number }
    await expect(page.getByRole('textbox', { name: 'Address bar', exact: true })).toHaveValue(origin + '/')
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.length)).toBe(1)
    let snapshot = output(await tool(app, 'one', 'browser_take_snapshot', first)).text as string
    output(await tool(app, 'one', 'browser_click', { pageId: first.pageId, uid: ref(snapshot, 'Increment') }))
    expect(await readCounter(app, first.pageId)).toBe('1')
    output(await tool(app, 'one', 'browser_fill', { pageId: first.pageId, uid: ref(snapshot, 'Name', 'textbox'), value: 'JanusX' }))
    expect(await app.evaluate(({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('document.querySelector("#name").value'), first.pageId)).toBe('JanusX')
    const upload = { pageId: first.pageId, uid: ref(snapshot, 'Upload') }
    expect((await tool(app, 'one', 'browser_upload_file', { ...upload, filePaths: [join(root, 'outside.txt')] })).isError).toBe(true)
    output(await tool(app, 'one', 'browser_upload_file', { ...upload, filePaths: [join(workspace, 'upload.txt')] }))
    expect(await app.evaluate(({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('document.querySelector("#upload").files[0].name'), first.pageId)).toBe('upload.txt')
    const second = { pageId: output(await tool(app, 'one', 'browser_new_page', { url: origin + '/' })).pageId as number }
    snapshot = output(await tool(app, 'one', 'browser_take_snapshot', second)).text as string
    output(await tool(app, 'one', 'browser_click', { pageId: second.pageId, uid: ref(snapshot, 'Increment') }))
    expect(await readCounter(app, second.pageId)).toBe('1')
    expect(await readCounter(app, first.pageId)).toBe('1')
    output(await tool(app, 'one', 'browser_select_page', first))
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.map(view => (view as Electron.WebContentsView).webContents.id))).toEqual([first.pageId])
    snapshot = output(await tool(app, 'one', 'browser_take_snapshot', first)).text as string
    output(await tool(app, 'one', 'browser_click', { pageId: first.pageId, uid: ref(snapshot, 'Increment') }))
    expect(await readCounter(app, first.pageId)).toBe('2')
    expect(await readCounter(app, second.pageId)).toBe('1')
    const screenshot = output(await tool(app, 'one', 'browser_take_screenshot', first)) as { screenshot: string }
    expect((await readFile(screenshot.screenshot)).subarray(1, 4).toString()).toBe('PNG')
    await writeFile(test.info().outputPath('controlled-page.png'), await readFile(screenshot.screenshot))
    await page.screenshot({ path: test.info().outputPath('browser-controlled-tabs.png') })

    await attach(app, 'two')
    const otherPages = output(await tool(app, 'two', 'browser_list_pages')).pages as Array<{ pageId: number; title: string }>
    expect(otherPages.some(tab => [first.pageId, second.pageId].includes(tab.pageId))).toBe(false)
    expect((await tool(app, 'two', 'browser_select_page', first)).isError).toBe(true)

    snapshot = output(await tool(app, 'one', 'browser_take_snapshot', first)).text as string
    const stale = ref(snapshot, 'Increment')
    output(await tool(app, 'one', 'browser_navigate_page', { pageId: first.pageId, type: 'url', url: origin + '/next' }))
    expect((await tool(app, 'one', 'browser_click', { pageId: first.pageId, uid: stale })).isError).toBe(true)
    expect((await tool(app, 'one', 'browser_navigate_page', { pageId: first.pageId, url: 'file:///secret' })).isError).toBe(true)

    await page.evaluate(() => window.electron.controls.stop())
    expect((await tool(app, 'one', 'browser_new_page', { url: origin + '/' })).isError).toBe(true)
    await attach(app, 'one', 'new-turn')
    output(await tool(app, 'one', 'browser_close_page', second))
    await page.evaluate(() => window.electron.controls.update({ browser: { enabled: false, timeoutMs: 9000 } }))
    expect((await tool(app, 'one', 'browser_take_snapshot', first)).isError).toBe(true)
    expect(await attach(app, 'disabled')).toEqual([])

    await page.evaluate(async () => { await window.electron.system.setLanguage('zh-CN'); await window.electron.theme.update('planche') })
    await page.reload()
    await page.getByTitle('设置', { exact: true }).click()
    await page.locator('[data-tab="browser-control"]').click()
    await expect(page.getByLabel('允许 AI 控制内置浏览器', { exact: true })).not.toBeChecked()
    await expect(page.getByLabel('单次操作超时', { exact: true })).toHaveValue('9')
    await page.screenshot({ path: test.info().outputPath('browser-settings-light-zh.png') })
    await page.locator('[data-tab="computer-control"]').click()
    await expect(page.getByLabel('驱动程序位置', { exact: true })).toHaveValue('C:\\missing\\cua-driver.exe')
    await page.screenshot({ path: test.info().outputPath('computer-settings-light-zh.png') })
    const config = JSON.parse(await readFile(join(profile, 'janusx/config.json'), 'utf8'))
    expect(config.controlSettings).toEqual({ browser: { enabled: false, timeoutMs: 9000 }, computer: { executable: 'C:\\missing\\cua-driver.exe' } })
  } finally {
    if (application) { await application.evaluate(({ app }) => app.exit(0)).catch(() => {}); await application.close().catch(() => {}) }
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
