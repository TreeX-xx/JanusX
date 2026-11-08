// Note: empirical provider comparison — .agents/notes/desktop/browser-computer-use.md
// Prerequisites and exact package versions are recorded in that Note. No product wiring is changed.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { _electron as electron, chromium } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { createDesktopTestEnv, seedIntroducedLearning } from '../tests/e2e/desktop-test-env.ts'

const base = resolve('artifacts/browser-mcp-comparison')
const runtime = join(base, 'runtime/node_modules')
const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
const runRoot = join(base, 'runs', stamp)
const chosen = process.argv.find(arg => arg.startsWith('--provider='))?.split('=')[1] || 'all'
const browserChoice = process.argv.find(arg => arg.startsWith('--browser='))?.split('=')[1] || 'janusx'
const unthrottled = process.argv.includes('--unthrottled')
assert(['all', 'chrome', 'playwright'].includes(chosen), 'Expected --provider=chrome|playwright|all')
assert(['janusx', 'edge', 'chrome', 'external-all'].includes(browserChoice), 'Expected --browser=janusx|edge|chrome|external-all')
await mkdir(runRoot, { recursive: true })
const entry = resolve(process.env.JANUSX_E2E_ENTRY || 'artifacts/build-check/main/index.js')
const records = []

function text(result) { return (result.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n') }
async function listen(server) {
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done) })
  return `http://127.0.0.1:${server.address().port}`
}
async function until(read, predicate, description, timeout = 10000) {
  const start = Date.now()
  let value
  do {
    value = await read()
    if (predicate(value)) return value
    await new Promise(done => setTimeout(done, 100))
  } while (Date.now() - start < timeout)
  throw new Error(`${description}: ${JSON.stringify(value)}`)
}
async function fixtures(dir) {
  const submissions = []
  const frame = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(`<title>Cross origin frame</title><style>html,body{background:#fff;color:#111}</style><label>Frame input<input id="value"></label><button onclick="document.getElementById('result').textContent='Frame saved:'+document.getElementById('value').value">Save frame</button><p id="result"></p>`)
  })
  const frameOrigin = await listen(frame)
  const server = createServer(async (req, res) => {
    if (req.url === '/missing-resource') { res.writeHead(503); res.end('probe expected 503'); return }
    if (req.url === '/submit') {
      let data = ''; for await (const chunk of req) data += chunk
      submissions.push(JSON.parse(data))
      res.setHeader('Set-Cookie', 'mcp_session=fixture-login; Path=/; SameSite=Lax')
      res.end('signed in'); return
    }
    if (req.url === '/download') {
      res.setHeader('Content-Disposition', 'attachment; filename="probe-download.txt"')
      res.end('browser-mcp-download-fixture'); return
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    if (req.url?.startsWith('/next')) {
      res.end('<title>MCP Next</title><h1>Next page</h1><button onclick="document.body.dataset.wrongClick=\'true\'">Replacement action</button>'); return
    }
    res.end(`<!doctype html><meta charset="utf-8"><title>MCP Fixture</title>
      <style>html,body{background:#fff;color:#111}body{font:16px system-ui;max-width:900px;margin:24px}label,button,a{margin:6px;display:inline-block}iframe{width:700px;height:110px}input{padding:5px}button{padding:7px}</style>
      <h1>Browser MCP comparison fixture</h1>
      <form id="login"><label>Username<input id="username" autocomplete="username"></label><label>Password<input id="password" type="password" autocomplete="current-password"></label><button>Sign in</button></form><p id="login-result"></p>
      <button id="increment">Increment</button><output id="count">0</output>
      <button id="diagnostics">Generate diagnostics</button><p id="diagnostic-result"></p>
      <button id="dialog">Confirm action</button><p id="dialog-result"></p>
      <label>Upload fixture<input id="upload" type="file"></label><p id="upload-result"></p>
      <a href="/download">Download fixture</a><a href="/next">Next page</a>
      <section id="shadow"></section><iframe title="Cross origin controls" src="${frameOrigin}/"></iframe>
      <script>
      let count=0; increment.onclick=()=>{document.getElementById('count').textContent=String(++count)};
      login.onsubmit=async e=>{e.preventDefault();const r=await fetch('/submit',{method:'POST',body:JSON.stringify({username:username.value,password:password.value})});document.getElementById('login-result').textContent=await r.text()};
      diagnostics.onclick=async()=>{console.error('mcp-fixture-console-error');await fetch('/missing-resource');document.getElementById('diagnostic-result').textContent='diagnostics complete'};
      dialog.onclick=()=>{document.getElementById('dialog-result').textContent=confirm('MCP fixture confirmation')?'confirmed':'cancelled'};
      upload.onchange=()=>{document.getElementById('upload-result').textContent=upload.files[0]?.name||''};
      const root=document.getElementById('shadow').attachShadow({mode:'open'});root.innerHTML='<button>Shadow action</button><span></span>';root.querySelector('button').onclick=()=>root.querySelector('span').textContent='shadow done';
      </script>`)
  })
  const origin = await listen(server)
  await writeFile(join(dir, 'upload-fixture.txt'), 'browser-mcp-upload-fixture')
  return { origin, frameOrigin, submissions, close: async () => {
    for (const item of [server, frame]) { item.closeAllConnections(); await new Promise(done => item.close(done)) }
  } }
}

function externalExecutable(browserName) {
  const suffix = browserName === 'edge' ? 'Microsoft/Edge/Application/msedge.exe' : 'Google/Chrome/Application/chrome.exe'
  const found = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]
    .filter(Boolean).map(root => join(root, suffix)).find(existsSync)
  assert(found, `Installed ${browserName} not found`)
  return found
}

async function run(provider, browserName) {
  const external = browserName !== 'janusx'
  const dir = external ? join(runRoot, browserName, provider) : join(runRoot, provider)
  await mkdir(dir, { recursive: true })
  const fixture = await fixtures(dir)
  const report = { provider, browser: browserName, started: new Date().toISOString(), platform: process.platform, node: process.version,
    ...(external ? { executable: externalExecutable(browserName) } : { entry, buildSha256: createHash('sha256').update(await readFile(entry)).digest('hex') }),
    gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirtyFiles: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }),
    origin: fixture.origin, frameOrigin: fixture.frameOrigin, unthrottled, cases: [], calls: [] }
  records.push(report)
  let app, shell, guest, client, transport, pageId, lastSnapshot, surfaceId, tabId, externalBrowser, externalProcess
  const pages = () => external ? externalBrowser.contexts()[0].pages() : app.context().pages()
  let callNumber = 0
  const log = (message) => console.log(`${browserName}/${provider}: ${message}`)
  async function call(name, args = {}, allowError = false) {
    const started = performance.now()
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 20000 })
    const elapsedMs = Math.round(performance.now() - started)
    const id = String(++callNumber).padStart(3, '0')
    // Images are retained separately; keep result text and metadata readable.
    const sanitized = { ...result, content: await Promise.all((result.content || []).map(async (block, index) => {
      if (block.type !== 'image') return block
      const filename = `${id}-${name}-${index}.${block.mimeType === 'image/jpeg' ? 'jpg' : 'png'}`
      await writeFile(join(dir, filename), Buffer.from(block.data, 'base64'))
      return { type: 'image', mimeType: block.mimeType, file: filename, bytes: Buffer.from(block.data, 'base64').length }
    })) }
    await writeFile(join(dir, `${id}-${name}.json`), JSON.stringify({ args, elapsedMs, result: sanitized }, null, 2))
    report.calls.push({ id, name, elapsedMs, isError: !!result.isError, textChars: text(result).length })
    if (result.isError && !allowError) throw new Error(`${name}: ${text(result)}`)
    return result
  }
  async function check(name, fn) {
    const started = performance.now()
    try { const detail = await fn(); report.cases.push({ name, status: 'pass', elapsedMs: Math.round(performance.now()-started), detail }); log(`PASS ${name}`) }
    catch (error) {
      const pageState = guest && !guest.isClosed() ? await guest.evaluate(() => ({ visibility: document.visibilityState, focused: document.hasFocus(), viewport: [innerWidth, innerHeight], buttons: [...document.querySelectorAll('button')].slice(0, 3).map(button => ({ text: button.textContent, disabled: button.disabled, bounds: button.getBoundingClientRect().toJSON() })) })).catch(() => null) : null
      report.cases.push({ name, status: 'fail', elapsedMs: Math.round(performance.now()-started), error: error.stack, pageState }); log(`FAIL ${name}: ${error.message}`)
    }
    await writeFile(join(dir, 'report.json'), JSON.stringify(report, null, 2))
  }
  async function connect() {
    const started = performance.now()
    const args = provider === 'chrome'
      ? [join(runtime, 'chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js'), `--browser-url=${report.cdpOrigin}`, '--no-usage-statistics', '--no-performance-crux', `--workspace=${dir}`]
      : [join(runtime, '@playwright/mcp/cli.js'), `--cdp-endpoint=${report.cdpOrigin}`, '--output-dir', dir, '--timeout-action=5000', '--timeout-navigation=15000']
    transport = new StdioClientTransport({ command: process.execPath, args, stderr: 'pipe', env: { ...process.env, CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: '1' } })
    let stderr = ''
    transport.stderr?.on('data', chunk => { stderr += chunk.toString(); void writeFile(join(dir, 'mcp-stderr.log'), stderr) })
    client = new Client({ name: 'janusx-browser-comparison', version: '1.0.0' }, { capabilities: { roots: { listChanged: false } } })
    client.setRequestHandler(ListRootsRequestSchema, () => ({ roots: [{ uri: pathToFileURL(dir).href, name: 'isolated-browser-fixtures' }] }))
    await client.connect(transport)
    const tools = await client.listTools()
    report.server = client.getServerVersion()
    report.handshakeMs = Math.round(performance.now() - started)
    report.toolCount = tools.tools.length
    report.toolSchemaChars = JSON.stringify(tools).length
    await writeFile(join(dir, 'tools.json'), JSON.stringify(tools, null, 2))
    report.command = { command: process.execPath, args }
  }
  async function selectFixture(url = fixture.origin + '/') {
    let result, line
    const started = Date.now()
    do {
      result = await call(provider === 'chrome' ? 'list_pages' : 'browser_tabs', provider === 'chrome' ? {} : { action: 'list' })
      line = text(result).split('\n').find(line => line.includes(`(${url})`))
      if (line) break
      await new Promise(done => setTimeout(done, 500))
    } while (Date.now() - started < 5000)
    assert(line, `Fixture target not found after 5s in ${text(result)}`)
    const match = line.match(/^\s*-?\s*(\d+)[:.)]/)
    assert(match, `Cannot parse target: ${line}`)
    pageId = Number(match[1])
    await call(provider === 'chrome' ? 'select_page' : 'browser_tabs', provider === 'chrome' ? { pageId, bringToFront: false } : { action: 'select', index: pageId })
    return text(result)
  }
  async function snapshot() {
    lastSnapshot = text(await call(provider === 'chrome' ? 'take_snapshot' : 'browser_snapshot', provider === 'chrome' ? { pageId } : {}))
    return lastSnapshot
  }
  function ref(label, role) {
    const line = lastSnapshot.split('\n').find(line => line.includes(`"${label}"`) && (!role || line.includes(role)))
    assert(line, `Missing ${role || ''} ${label} in snapshot`)
    const match = provider === 'chrome' ? line.match(/uid=(\S+)/) : line.match(/\[ref=([^\]]+)\]/)
    assert(match, `Missing ref in ${line}`)
    return match[1]
  }
  async function click(label, role = 'button', allowError = false) {
    const target = ref(label, role)
    return call(provider === 'chrome' ? 'click' : 'browser_click', provider === 'chrome' ? { pageId, uid: target } : { target }, allowError)
  }
  async function fill(label, value) {
    const target = ref(label, 'textbox')
    return call(provider === 'chrome' ? 'fill' : 'browser_type', provider === 'chrome' ? { pageId, uid: target, value } : { target, text: value })
  }
  async function navigate(url) {
    return call(provider === 'chrome' ? 'navigate_page' : 'browser_navigate', provider === 'chrome' ? { pageId, type: 'url', url } : { url })
  }
  async function readGuest(fn) { return guest.evaluate(fn) }
  try {
    const probePort = createServer()
    const cdpOrigin = await listen(probePort)
    await new Promise(done => probePort.close(done))
    report.cdpOrigin = cdpOrigin
    if (external) {
      const args = [`--user-data-dir=${join(dir, 'profile')}`, `--remote-debugging-port=${new URL(cdpOrigin).port}`, '--remote-debugging-address=127.0.0.1', '--no-first-run', '--no-default-browser-check', '--window-size=1280,900', fixture.origin + '/']
      if (unthrottled) args.unshift('--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling')
      // These are the visible browser windows under test, not background helpers.
      externalProcess = spawn(report.executable, args, { windowsHide: false, stdio: ['ignore', 'ignore', 'pipe'] })
      let browserStderr = ''
      externalProcess.stderr.on('data', chunk => { browserStderr += chunk; void writeFile(join(dir, 'browser-stderr.log'), browserStderr) })
      externalProcess.on('error', error => { browserStderr += error.stack })
      report.browserLaunch = { executable: report.executable, args }
      report.browserVersion = await until(async () => {
        try { return await (await fetch(`${cdpOrigin}/json/version`)).json() } catch { return null }
      }, Boolean, 'external browser CDP', 30000)
      externalBrowser = await chromium.connectOverCDP(cdpOrigin, { noDefaults: true })
    } else {
      app = await electron.launch({ args: [entry, `--user-data-dir=${join(dir, 'profile')}`, `--remote-debugging-port=${new URL(cdpOrigin).port}`, '--remote-debugging-address=127.0.0.1'], env: createDesktopTestEnv(dir), timeout: 45000 })
      shell = await app.firstWindow()
      await shell.waitForLoadState('domcontentloaded')
      await seedIntroducedLearning(shell)
      await shell.evaluate(() => window.electron.system.setLanguage('en'))
      await shell.reload()
      await shell.locator('button[data-id="tool-menu"]').click()
      await shell.locator('button[data-id="browser"]').click()
      const shellTab = shell.locator('[data-tab-id]').first()
      surfaceId = (await shellTab.getAttribute('data-tab-id')).slice('browser:'.length)
      await shell.getByRole('textbox', { name: 'Address bar' }).fill(fixture.origin + '/')
      await shell.getByRole('textbox', { name: 'Address bar' }).press('Enter')
    }
    guest = await until(async () => pages().find(page => page.url() === fixture.origin + '/'), Boolean, 'existing fixture page')
    // This Playwright connection is only an independent observer. Without a listener,
    // it automatically dismisses dialogs and interferes with the MCP under test.
    guest.on('dialog', () => {})
    await guest.waitForLoadState('load')
    if (external) {
      const session = await guest.context().newCDPSession(guest)
      const { targetInfo } = await session.send('Target.getTargetInfo')
      const { windowId, bounds } = await session.send('Browser.getWindowForTarget', { targetId: targetInfo.targetId })
      report.nativeWindow = { windowId, initialBounds: bounds }
      await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } })
      await guest.bringToFront()
      await session.detach()
    }
    if (!external) {
      const state = await shell.evaluate(id => window.electron.browser.getState(id), surfaceId)
      tabId = state.activeTabId
      report.surface = state
      report.electron = await app.evaluate(() => process.versions)
    }
    report.targetsBefore = await (await fetch(`${cdpOrigin}/json/list`)).json()
    await connect()
    await check(external ? 'attach-existing-external-browser-page' : 'attach-existing-WebContentsView', async () => {
      const listing = await selectFixture()
      const snap = await snapshot()
      assert(snap.includes('Browser MCP comparison fixture'))
      assert(snap.includes('Username'))
      return { listing, targetId: pageId, snapshotChars: snap.length }
    })
    if (pageId === undefined) throw new Error('Cannot proceed without a fixture target')
    await check('form-fill-and-submit', async () => {
      await snapshot(); await fill('Username', 'probe-user'); await fill('Password', 'fixture-only-password'); await click('Sign in')
      await until(() => guest.locator('#login-result').textContent(), value => value === 'signed in', 'login result')
      assert.equal(fixture.submissions.length, 1)
      assert.equal(fixture.submissions[0].username, 'probe-user')
      assert((await snapshot()).includes('signed in'))
      return { submissions: fixture.submissions.length, cookiePresent: (await readGuest(() => document.cookie)).includes('mcp_session=fixture-login') }
    })
    await check('click-verified-in-DOM', async () => {
      await snapshot(); await click('Increment')
      assert.equal(await guest.locator('#count').textContent(), '1')
      assert((await snapshot()).includes('1'))
    })
    await check('open-shadow-DOM', async () => {
      await snapshot(); await click('Shadow action')
      assert.equal(await readGuest(() => document.querySelector('#shadow').shadowRoot.querySelector('span').textContent), 'shadow done')
      assert((await snapshot()).includes('shadow done'))
    })
    await check('cross-origin-iframe', async () => {
      await snapshot(); await fill('Frame input', 'frame-probe'); await click('Save frame')
      assert.equal(await guest.frameLocator('iframe').locator('#result').textContent(), 'Frame saved:frame-probe')
      assert((await snapshot()).includes('Frame saved:frame-probe'))
    })
    await check('console-and-network-errors', async () => {
      await snapshot(); await click('Generate diagnostics')
      await until(() => guest.locator('#diagnostic-result').textContent(), value => value === 'diagnostics complete', 'diagnostic event')
      const consoleResult = text(await call(provider === 'chrome' ? 'list_console_messages' : 'browser_console_messages', provider === 'chrome' ? { pageId } : { level: 'error' }))
      const networkResult = text(await call(provider === 'chrome' ? 'list_network_requests' : 'browser_network_requests', provider === 'chrome' ? { pageId } : { static: false }))
      assert(consoleResult.includes('mcp-fixture-console-error'))
      assert(networkResult.includes('missing-resource') && networkResult.includes('503'))
      return { consoleFound: true, http503Found: true }
    })
    await check('screenshot', async () => {
      const filename = join(dir, 'mcp-screenshot.png')
      await call(provider === 'chrome' ? 'take_screenshot' : 'browser_take_screenshot', provider === 'chrome' ? { pageId, format: 'png', filePath: filename } : { filename, type: 'png', scale: 'css' })
      const bytes = await readFile(filename)
      assert.equal(bytes.subarray(1, 4).toString(), 'PNG')
      assert(bytes.length > 1000)
      return { bytes: bytes.length }
    })
    await check('file-upload', async () => {
      await snapshot()
      const target = ref('Upload fixture')
      if (provider === 'chrome') await call('upload_file', { pageId, uid: target, filePaths: [join(dir, 'upload-fixture.txt')] })
      else { await call('browser_click', { target }); await call('browser_file_upload', { paths: [join(dir, 'upload-fixture.txt')] }) }
      assert.equal(await guest.locator('#upload-result').textContent(), 'upload-fixture.txt')
      assert((await snapshot()).includes('upload-fixture.txt'))
    })
    await check('native-confirm-dialog', async () => {
      await snapshot(); await click('Confirm action')
      await call(provider === 'chrome' ? 'handle_dialog' : 'browser_handle_dialog', provider === 'chrome' ? { pageId, action: 'accept' } : { accept: true })
      await until(() => guest.locator('#dialog-result').textContent(), value => value === 'confirmed', 'confirmed dialog')
    })
    await check('download', async () => {
      const filename = join(dir, 'download-received.txt')
      let downloadSession
      const downloadEvents = []
      if (external) {
        downloadSession = await externalBrowser.newBrowserCDPSession()
        downloadSession.on('Browser.downloadWillBegin', event => downloadEvents.push({ type: 'begin', ...event }))
        downloadSession.on('Browser.downloadProgress', event => downloadEvents.push({ type: 'progress', ...event }))
        await downloadSession.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir, eventsEnabled: true })
      } else {
        await app.evaluate(({ session }, filename) => {
          globalThis.__mcpProbeDownloads = []
          session.fromPartition('persist:janusx-browser').once('will-download', (_event, item) => {
            item.setSavePath(filename)
            item.once('done', (_event, state) => globalThis.__mcpProbeDownloads.push({ state, path: item.getSavePath() }))
          })
        }, filename)
      }
      try {
        await snapshot(); await click('Download fixture', 'link')
        if (external) {
          const downloadedPath = join(dir, 'probe-download.txt')
          const content = await until(async () => { try { return await readFile(downloadedPath, 'utf8') } catch { return null } }, value => value === 'browser-mcp-download-fixture', 'download bytes')
          await until(async () => downloadEvents, events => events.some(event => event.state === 'completed'), 'browser download completed event')
          return { path: downloadedPath, verifiedContent: content, events: downloadEvents }
        }
      const downloads = await until(() => app.evaluate(() => globalThis.__mcpProbeDownloads), entries => entries.length > 0, 'download completion')
      assert.equal(downloads[0].state, 'completed')
      assert.equal(await readFile(filename, 'utf8'), 'browser-mcp-download-fixture')
      return downloads[0]
      } finally {
        if (downloadSession) {
          await writeFile(join(dir, 'download-events.json'), JSON.stringify(downloadEvents, null, 2))
          await downloadSession.detach()
        }
      }
    })
    await check('navigation-rejects-stale-reference', async () => {
      await snapshot(); const stale = ref('Increment', 'button')
      await navigate(fixture.origin + '/next')
      await guest.waitForURL('**/next')
      const result = await call(provider === 'chrome' ? 'click' : 'browser_click', provider === 'chrome' ? { pageId, uid: stale } : { target: stale }, true)
      assert(result.isError, `Old reference accepted: ${text(result)}`)
      assert.notEqual(await readGuest(() => document.body.dataset.wrongClick), 'true')
      await navigate(fixture.origin + '/')
      await guest.waitForURL(fixture.origin + '/')
      return { error: text(result) }
    })
    await check('user-login-state-after-reload', async () => {
      assert((await readGuest(() => document.cookie)).includes('mcp_session=fixture-login'))
      await navigate(fixture.origin + '/')
      assert((await readGuest(() => document.cookie)).includes('mcp_session=fixture-login'))
    })
    await check('user-and-agent-share-live-page', async () => {
      // Human-side interaction is deliberately separate from the MCP path.
      await guest.getByRole('button', { name: 'Increment', exact: true }).click()
      assert.equal(await guest.locator('#count').textContent(), '1')
      assert((await snapshot()).includes('1'))
      await click('Increment')
      assert.equal(await guest.locator('#count').textContent(), '2')
      await navigate(fixture.origin + '/')
    })
    await check('MCP-disconnect-and-reconnect', async () => {
      await client.close(); client = undefined
      assert(!guest.isClosed())
      await connect(); await selectFixture(); assert((await snapshot()).includes('Username'))
      assert((await readGuest(() => document.cookie)).includes('mcp_session=fixture-login'))
    })
    if (!external) await check('DevTools-coexistence', async () => {
      await app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(w => w.getURL() === url).openDevTools({ mode: 'detach', activate: false }), fixture.origin + '/')
      await snapshot(); await click('Increment')
      assert.equal(await guest.locator('#count').textContent(), '1')
      await app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(w => w.getURL() === url).closeDevTools(), fixture.origin + '/')
    })
    if (external) {
      await check('MCP-create-new-native-tab', async () => {
        const url = fixture.origin + '/?mcp-created'
        await call(provider === 'chrome' ? 'new_page' : 'browser_tabs', provider === 'chrome' ? { url, background: false } : { action: 'new', url })
        const newPage = await until(async () => pages().find(page => page.url() === url), Boolean, 'MCP-created native tab')
        await newPage.waitForLoadState('load')
        await selectFixture(url); await snapshot(); await click('Increment')
        assert.equal(await newPage.locator('#count').textContent(), '1')
        return { url, count: '1' }
      })
      await check('MCP-select-native-tab-controls-correct-page', async () => {
        const secondPage = pages().find(page => page.url().includes('?mcp-created'))
        assert(secondPage, 'MCP must create the second tab first')
        const firstBefore = Number(await guest.locator('#count').textContent())
        const secondBefore = Number(await secondPage.locator('#count').textContent())
        await selectFixture(fixture.origin + '/')
        if (provider === 'chrome') await call('select_page', { pageId, bringToFront: true })
        await snapshot(); await click('Increment')
        assert.equal(Number(await guest.locator('#count').textContent()), firstBefore + 1)
        assert.equal(Number(await secondPage.locator('#count').textContent()), secondBefore)
        return { firstCount: firstBefore + 1, secondCount: secondBefore, scope: 'MCP target selection; native UI focus is not inferred from emulated visibility' }
      })
      await check('MCP-switch-and-close-created-native-tab', async () => {
        const url = fixture.origin + '/?mcp-created'
        await selectFixture(url); await snapshot()
        await call(provider === 'chrome' ? 'close_page' : 'browser_tabs', provider === 'chrome' ? { pageId } : { action: 'close', index: pageId })
        await until(async () => pages().some(page => page.url() === url), value => !value, 'created tab closed')
        assert(!guest.isClosed())
        await selectFixture(fixture.origin + '/')
      })
      await guest.screenshot({ path: join(dir, 'guest-final.png'), timeout: 5000 })
    } else {
    await check('second-host-tab-control', async () => {
      const second = await shell.evaluate(async ({ surfaceId, url }) => window.electron.browser.openTab(surfaceId, url), { surfaceId, url: fixture.origin + '/?second' })
      assert(second.success)
      await until(async () => (await (await fetch(`${report.cdpOrigin}/json/list`)).json()).some(t => t.url === fixture.origin + '/?second'), Boolean, 'second host tab')
      await selectFixture(fixture.origin + '/?second'); await snapshot(); await click('Increment')
      const secondPage = await until(async () => app.context().pages().find(page => page.url() === fixture.origin + '/?second'), Boolean, 'second page')
      assert.equal(await secondPage.locator('#count').textContent(), '1')
      assert.equal(await guest.locator('#count').textContent(), '1')
      await shell.evaluate(({ surfaceId, tabId }) => window.electron.browser.activateTab(surfaceId, tabId), { surfaceId, tabId })
      await selectFixture(fixture.origin + '/')
    })
    await check('late-host-tab-after-MCP-reconnect', async () => {
      const state = await shell.evaluate(id => window.electron.browser.getState(id), surfaceId)
      const secondTab = state.tabs.find(tab => tab.url.includes('?second'))
      await shell.evaluate(({ surfaceId, tabId }) => window.electron.browser.activateTab(surfaceId, tabId), { surfaceId, tabId: secondTab.tabId })
      await client.close(); client = undefined
      await connect(); await selectFixture(fixture.origin + '/?second')
      await snapshot(); await click('Increment')
      const secondPage = app.context().pages().find(page => page.url() === fixture.origin + '/?second')
      assert(Number(await secondPage.locator('#count').textContent()) > 0)
      return { target: fixture.origin + '/?second' }
    })
    await check('MCP-select-page-updates-host-active-tab', async () => {
      const state = await shell.evaluate(id => window.electron.browser.getState(id), surfaceId)
      const secondTab = state.tabs.find(tab => tab.url.includes('?second'))
      await shell.evaluate(({ surfaceId, tabId }) => window.electron.browser.activateTab(surfaceId, tabId), { surfaceId, tabId: secondTab.tabId })
      await selectFixture(fixture.origin + '/')
      if (provider === 'chrome') await call('select_page', { pageId, bringToFront: true })
      const after = await shell.evaluate(id => window.electron.browser.getState(id), surfaceId)
      const detail = { expectedActiveTab: tabId, actualActiveTab: after.activeTabId, selectedMcpPage: pageId }
      await writeFile(join(dir, 'select-page-host-integration.json'), JSON.stringify(detail, null, 2))
      assert.equal(after.activeTabId, tabId, 'MCP selection does not update JanusX active web tab')
      return detail
    })
    // Restore the native visible view even when a deliberate integration-gap case fails.
    await shell.evaluate(({ surfaceId, tabId }) => window.electron.browser.activateTab(surfaceId, tabId), { surfaceId, tabId })
    await selectFixture(fixture.origin + '/')
    await check('MCP-new-page-host-integration', async () => {
      const url = fixture.origin + '/?mcp-created'
      const response = await call(provider === 'chrome' ? 'new_page' : 'browser_tabs', provider === 'chrome' ? { url, background: true } : { action: 'new', url }, true)
      const targets = await (await fetch(`${report.cdpOrigin}/json/list`)).json()
      const hostState = await shell.evaluate(id => window.electron.browser.getState(id), surfaceId)
      const detail = { toolError: !!response.isError, response: text(response), targetCreated: targets.some(t => t.url === url), registeredInSurface: hostState.tabs.some(tab => tab.url === url) }
      await writeFile(join(dir, 'new-page-host-integration.json'), JSON.stringify(detail, null, 2))
      assert(detail.registeredInSurface, `MCP-created page is not registered in JanusX browser surface: ${JSON.stringify(detail)}`)
      return detail
    })
    await shell.screenshot({ path: join(dir, 'janusx-shell.png'), timeout: 5000 }).catch(error => { report.shellScreenshotError = error.message })
    await guest.screenshot({ path: join(dir, 'guest-final.png'), timeout: 5000 }).catch(error => { report.guestScreenshotError = error.message })
    }
  } catch (error) {
    report.fatal = error.stack; log(`FATAL ${error.message}`)
  } finally {
    if (client) await client.close().catch(() => {})
    if (app) {
      await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
      await app.close().catch(() => {})
    }
    if (externalBrowser) {
      // Close only the browser instance launched with this run's isolated profile.
      const session = await externalBrowser.newBrowserCDPSession().catch(() => null)
      if (session) await session.send('Browser.close').catch(() => {})
      await externalBrowser.close().catch(() => {})
    }
    if (externalProcess && externalProcess.exitCode === null) {
      await Promise.race([new Promise(done => externalProcess.once('exit', done)), new Promise(done => setTimeout(done, 3000))])
      if (externalProcess.exitCode === null) externalProcess.kill()
    }
    await fixture.close()
    report.finished = new Date().toISOString()
    await writeFile(join(dir, 'report.json'), JSON.stringify(report, null, 2))
    log(`report ${join(dir, 'report.json')}`)
  }
}
for (const browserName of browserChoice === 'external-all' ? ['edge', 'chrome'] : [browserChoice]) {
  for (const provider of chosen === 'all' ? ['chrome', 'playwright'] : [chosen]) await run(provider, browserName)
}
await writeFile(join(runRoot, 'summary.json'), JSON.stringify(records, null, 2))
console.log(`Evidence: ${runRoot}`)
if (records.some(report => report.fatal || report.cases.some(item => item.status === 'fail'))) process.exitCode = 1
