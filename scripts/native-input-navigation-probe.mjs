// Disposable native ConPTY + Chromium/xterm probe. No real accounts or sessions.
// Note: .agents/notes/terminal/terminal-scrollback-navigation.md
import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import pty from 'node-pty'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const out = path.resolve('artifacts/native-input-navigation')
await mkdir(out, { recursive: true })
const reportPath = path.join(out, process.argv[2] ? `report-${process.argv[2]}.json` : 'report.json')
const root = await mkdtemp(path.join(tmpdir(), 'janusx-navigation-'))
const cwd = path.join(root, 'workspace'); await mkdir(cwd)
const npm = path.join(process.env.APPDATA, 'npm/node_modules')
const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(path|systemroot|windir|comspec|temp|tmp|pathext|programfiles.*)$/i.test(key)))
const env = { ...clean, HOME: root, USERPROFILE: root, APPDATA: path.join(root, 'roaming'), LOCALAPPDATA: path.join(root, 'local'), TERM: 'xterm-256color', NO_PROXY: 'localhost,127.0.0.1', XDG_CONFIG_HOME: path.join(root, 'config'), XDG_DATA_HOME: path.join(root, 'data'), XDG_STATE_HOME: path.join(root, 'state') }
const report = { date: new Date().toISOString(), root, cases: {}, limitations: ['Synthetic local history; no production model/account access.', 'Native TUI probe, not product UI acceptance.'] }
const browser = await chromium.launch({ headless: true })
const processes = []
function stop(proc) {
  const index = processes.indexOf(proc)
  if (index >= 0) processes.splice(index, 1)
  proc.kill()
}
let server
async function until(fn, label, ms = 20000) {
  const end = Date.now() + ms
  while (Date.now() < end) { const value = await fn(); if (value) return value; await delay(80) }
  throw new Error(`Timeout: ${label}`)
}
async function terminal(name, bin, args, extraEnv = {}) {
  const page = await browser.newPage({ viewport: { width: 1250, height: 800 } })
  await page.setContent('<div id="terminal"></div>')
  await page.addStyleTag({ path: 'node_modules/@xterm/xterm/css/xterm.css' })
  await page.addScriptTag({ path: 'node_modules/@xterm/xterm/lib/xterm.js' })
  await page.evaluate(() => { window.term = new Terminal({ cols: 100, rows: 30, scrollback: 5000, allowProposedApi: true }); term.open(document.querySelector('#terminal')) })
  const proc = pty.spawn(bin, args, { cwd, env: { ...env, ...extraEnv }, cols: 100, rows: 30, name: 'xterm-256color', useConpty: true, useConptyDll: true })
  processes.push(proc)
  let raw = '', pending = ''
  proc.onData(data => { raw += data; pending += data; if (data.includes('\x1b[6n')) proc.write('\x1b[1;1R') })
  await page.exposeFunction('ptyInput', data => proc.write(data))
  // Respond only to PTY device-status queries above. No synthetic color replies
  // are injected as keyboard input while the native app is initializing.
  async function flush() { if (pending) { const text = pending; pending = ''; await page.evaluate(text => new Promise(resolve => term.write(text, resolve)), text) } }
  async function snap(label) {
    await delay(650); await flush()
    const state = await page.evaluate(() => { const b = term.buffer.active; return { type: b.type, baseY: b.baseY, viewportY: b.viewportY, lines: Array.from({ length: term.rows }, (_, i) => b.getLine(b.viewportY + i)?.translateToString(true) ?? '') } })
    await writeFile(path.join(out, `${name}-${label}.json`), JSON.stringify(state, null, 2))
    await page.screenshot({ path: path.join(out, `${name}-${label}.png`) })
    return state
  }
  return { proc, page, snap, flush, raw: () => raw, key: async (key, label) => { proc.write(key); return snap(label) }, resize: async () => { proc.resize(45, 18); await page.evaluate(() => term.resize(45, 18)) }, save: () => writeFile(path.join(out, `${name}.ansi`), raw) }
}

async function claude() {
  const bin = path.join(npm, '@anthropic-ai/claude-code/bin/claude.exe')
  const config = path.join(root, 'claude'); await mkdir(config)
  const id = randomUUID(), project = path.join(config, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'))
  await mkdir(project, { recursive: true })
  await writeFile(path.join(config, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, theme: 'dark', autoUpdates: false, customApiKeyResponses: { approved: ['local-probe'], rejected: [] }, projects: { [cwd]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } } }))
  await writeFile(path.join(config, 'settings.json'), JSON.stringify({ tui: 'fullscreen' }))
  let parent = null; const rows = []
  for (let i = 1; i <= 30; i++) {
    for (const role of ['user', 'assistant']) {
      const uuid = randomUUID(), content = role === 'user' ? `NAV_INPUT_${String(i).padStart(2, '0')} same repeated phrase` : Array.from({ length: 6 }, (_, n) => `Answer ${i} line ${n} local synthetic history.`).join('\n')
      rows.push({ parentUuid: parent, uuid, sessionId: id, type: role, cwd, version: '2.1.319', timestamp: new Date().toISOString(), isSidechain: false, userType: 'external', message: { role, ...(role === 'assistant' ? { id: `msg_${i}`, model: 'claude-sonnet-4-6', stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } } : {}), content: role === 'user' ? content : [{ type: 'text', text: content }] } }); parent = uuid
    }
  }
  await writeFile(path.join(project, `${id}.jsonl`), rows.map(row => JSON.stringify(row)).join('\n') + '\n')
  const t = await terminal('claude', bin, ['--resume', id, '--setting-sources', 'user', '--strict-mcp-config'], { CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_NO_FLICKER: '1', ANTHROPIC_API_KEY: 'local-probe', ANTHROPIC_BASE_URL: 'http://127.0.0.1:1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1' })
  await delay(4000); const startup = await t.snap('startup')
  if (startup.lines.join('\n').includes('trust this folder')) { await t.key('\x1b[B', 'trust-select'); await t.key('\r', 'trust-confirm'); await delay(2500) }
  const result = report.cases.claude = { version: execFileSync(bin, ['--version'], { encoding: 'utf8', windowsHide: true }).trim(), snapshots: {} }
  result.snapshots.chat = await t.snap('chat')
  if (!result.snapshots.chat.lines.join('\n').includes('NAV_INPUT')) throw new Error('Claude history not loaded; inspect startup')
  await t.key('DRAFT_NAV_CHECK', 'draft')
  result.snapshots.chatPageUp = await t.key('\x1b[5~', 'chat-pageup')
  result.snapshots.viewer = await t.key('\x0f', 'viewer')
  result.snapshots.previous = await t.key('{', 'previous')
  result.snapshots.previous2 = await t.key('{', 'previous2')
  result.snapshots.next = await t.key('}', 'next')
  result.snapshots.exit = await t.key('\x1b', 'exit')
  await t.resize(); await t.snap('narrow-chat')
  await t.key('\x0f', 'narrow-viewer')
  result.snapshots.narrowPrevious = await t.key('{', 'narrow-previous')
  result.snapshots.narrowNext = await t.key('}', 'narrow-next')
  assert(result.snapshots.previous.lines.find(line => line.includes('NAV_INPUT'))?.includes('28'))
  assert(result.snapshots.previous2.lines.find(line => line.includes('NAV_INPUT'))?.includes('27'))
  assert(result.snapshots.next.lines.find(line => line.includes('NAV_INPUT'))?.includes('28'))
  assert(result.snapshots.exit.lines.some(line => line.includes('DRAFT_NAV_CHECK')))
  await t.key('\x1b', 'narrow-exit'); await t.save(); stop(t.proc)
}

async function pi() {
  const base = path.join(npm, '@earendil-works/pi-coding-agent')
  const { SessionManager } = await import(pathToFileURL(path.join(base, 'dist/core/session-manager.js')).href)
  const config = path.join(root, 'pi'); await mkdir(config)
  await mkdir(path.join(config, 'bin'))
  for (const file of ['fd.exe', 'rg.exe']) await copyFile(path.join(process.env.USERPROFILE, '.pi/agent/bin', file), path.join(config, 'bin', file))
  await writeFile(path.join(config, 'settings.json'), JSON.stringify({ tuiMode: 'fullscreen', hideThinkingBlock: true, lastChangelogVersion: '0.85.1' }))
  const s = SessionManager.create(cwd, path.join(config, 'sessions'))
  for (let i = 1; i <= 30; i++) {
    s.appendMessage({ role: 'user', content: `NAV_INPUT_${String(i).padStart(2, '0')} repeated phrase`, timestamp: Date.now() })
    s.appendMessage({ role: 'assistant', api: 'openai-completions', provider: 'fixture', model: 'fixture', content: [{ type: 'text', text: Array.from({ length: 6 }, (_, n) => `Answer ${i} line ${n}`).join('\n') }], stopReason: 'stop', timestamp: Date.now(), usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } })
  }
  const t = await terminal('pi', process.execPath, [path.join(base, 'dist/bundle/cli.js'), '--session', s.getSessionFile(), '--no-extensions', '--no-skills', '--no-prompt-templates'], { PI_CODING_AGENT_DIR: config })
  await until(async () => { await t.flush(); return t.page.evaluate(() => { const b = term.buffer.active; return Array.from({ length: term.rows }, (_, i) => b.getLine(b.viewportY + i)?.translateToString(true) ?? '').join('\n').includes('NAV_INPUT_30') }) }, 'native pi history loaded')
  const result = report.cases.pi = { version: '0.85.1', snapshots: {} }
  result.snapshots.chat = await t.snap('chat')
  await t.key('DRAFT_NAV_CHECK', 'draft')
  result.snapshots.previous = await t.key('\x1b[1;5A', 'previous')
  result.snapshots.previous2 = await t.key('\x1b[1;5A', 'previous2')
  result.snapshots.next = await t.key('\x1b[1;5B', 'next')
  await t.resize(); await t.snap('narrow')
  result.snapshots.narrowPrevious = await t.key('\x1b[1;5A', 'narrow-previous')
  result.snapshots.narrowNext = await t.key('\x1b[1;5B', 'narrow-next')
  result.snapshots.narrowNext2 = await t.key('\x1b[1;5B', 'narrow-next2')
  result.snapshots.top = await t.key('\x1b[H', 'top')
  for (let i = 0; i < 4; i++) await t.key('\x1b[1;5B', `target-step-${i + 1}`)
  result.snapshots.target = await t.snap('target')
  // Native semantic boundaries can include extra stops inside a rendered prompt.
  // Verify movement and reversal, not the false assumption one key = one message.
  const first = snapshot => snapshot.lines.findIndex(line => line.includes('NAV_INPUT'))
  assert.notDeepEqual(result.snapshots.previous2.lines, result.snapshots.previous.lines)
  assert.equal(first(result.snapshots.next), first(result.snapshots.previous))
  assert(result.snapshots.target.lines.some(line => line.includes('DRAFT_NAV_CHECK')))
  await t.save(); stop(t.proc)
}

async function codex() {
  const bin = path.join(npm, '@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe')
  const config = path.join(root, 'codex'); await mkdir(config)
  let count = 0
  server = createServer(async (req, res) => {
    let raw = ''; for await (const part of req) raw += part
    if (!req.url.includes('/responses')) { res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"data":[]}'); return }
    const text = Array.from({ length: 6 }, (_, n) => `Answer ${++count} line ${n} local synthetic history`).join('\n')
    const item = { id: `msg_${count}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }
    const response = { id: `resp_${count}`, object: 'response', status: 'completed', model: 'gpt-5.4', output: [item], usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (const [type, extra] of [['response.created', { response: { ...response, output: [], status: 'in_progress' } }], ['response.output_item.added', { output_index: 0, item }], ['response.output_item.done', { output_index: 0, item }], ['response.completed', { response }]]) res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...extra })}\n\n`)
    res.end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  await writeFile(path.join(config, 'config.toml'), ['model="gpt-5.4"', 'model_provider="local"', 'check_for_update_on_startup=false', 'approval_policy="on-request"', 'sandbox_mode="read-only"', '[model_providers.local]', 'name="Local fixture"', `base_url="http://127.0.0.1:${server.address().port}/v1"`, 'wire_api="responses"', 'requires_openai_auth=false', `[projects.${JSON.stringify(cwd)}]`, 'trust_level="trusted"', '[analytics]', 'enabled=false', '[feedback]', 'enabled=false'].join('\n'))
  const backend = spawn(bin, ['app-server', '--listen', 'stdio://'], { cwd, env: { ...env, CODEX_HOME: config }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); processes.push(backend)
  let buffer = '', nextId = 1; const pending = new Map(), events = []
  backend.stderr.on('data', () => {})
  backend.stdout.on('data', data => { buffer += data; const lines = buffer.split('\n'); buffer = lines.pop(); for (const line of lines) { try { const m = JSON.parse(line); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result) } else events.push(m) } catch {} } })
  const call = (method, params) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); backend.stdin.write(JSON.stringify({ id, method, params }) + '\n') })
  await call('initialize', { clientInfo: { name: 'navigation_probe', version: '1' }, capabilities: { experimentalApi: true } })
  backend.stdin.write('{"method":"initialized","params":{}}\n')
  const { thread } = await call('thread/start', { cwd, modelProvider: 'local', model: 'gpt-5.4', approvalPolicy: 'on-request', sandbox: 'read-only' })
  for (let i = 1; i <= 16; i++) { const { turn } = await call('turn/start', { threadId: thread.id, input: [{ type: 'text', text: `NAV_INPUT_${String(i).padStart(2, '0')} same repeated phrase`, text_elements: [] }] }); await until(() => events.some(e => e.method === 'turn/completed' && e.params.turn.id === turn.id), 'seed codex') }
  stop(backend)
  const t = await terminal('codex', bin, ['resume', thread.id], { CODEX_HOME: config })
  await until(async () => { await t.flush(); return t.page.evaluate(() => { const b = term.buffer.active; return Array.from({ length: term.rows }, (_, i) => b.getLine(b.viewportY + i)?.translateToString(true) ?? '').join('\n').includes('NAV_INPUT') }) }, 'native codex resume loaded', 30000)
  const result = report.cases.codex = { version: execFileSync(bin, ['--version'], { encoding: 'utf8', windowsHide: true }).trim(), snapshots: {} }
  result.snapshots.chat = await t.snap('chat')
  await t.key('DRAFT_NAV_CHECK', 'draft')
  result.snapshots.pageup = await t.key('\x1b[5~', 'pageup')
  result.snapshots.ctrlUp = await t.key('\x1b[1;5A', 'ctrl-up')
  result.snapshots.viewer = await t.key('\x14', 'viewer')
  result.snapshots.brace = await t.key('{', 'brace')
  await t.key('\x1b', 'exit')
  await t.key('\x15', 'clear-draft')
  await t.key('/keymap', 'keymap-typed'); result.snapshots.keymap = await t.key('\r', 'keymap')
  for (const query of ['prompt', 'previous', 'scroll', 'message']) {
    await t.key('\x7f'.repeat(80), `keymap-clear-${query}`)
    result.snapshots[`keymap-${query}`] = await t.key(query, `keymap-${query}`)
  }
  await t.save(); stop(t.proc)
  await writeFile(path.join(out, 'codex-events.json'), JSON.stringify(events, null, 2))
}

async function opencode() {
  const bin = path.join(npm, '@opencode/cli/bin/opencode.exe')
  const proc = spawn(bin, ['serve', '--hostname', '127.0.0.1', '--port', '0'], { cwd, env: { ...env, OPENCODE_SERVER_PASSWORD: 'local-probe', OPENCODE_TEST_HOME: path.join(root, 'opencode'), OPENCODE_CONFIG_CONTENT: JSON.stringify({ update: 'disable', share: 'disabled', snapshots: false }) }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  processes.push(proc)
  let logs = ''; proc.stdout.on('data', data => { logs += data }); proc.stderr.on('data', data => { logs += data })
  const endpoint = await until(() => /http:\/\/127\.0\.0\.1:\d+/.exec(logs)?.[0], 'opencode listen')
  const response = await fetch(endpoint + '/openapi.json', { headers: { Authorization: 'Basic ' + Buffer.from('opencode:local-probe').toString('base64') } })
  if (!response.ok) throw new Error(`OpenCode schema status ${response.status}`)
  const schema = await response.json()
  await writeFile(path.join(out, 'opencode-openapi.json'), JSON.stringify(schema, null, 2))
  const paths = Object.fromEntries(Object.entries(schema.paths ?? {}).filter(([key]) => /tui|scroll|jump|message|command/.test(key)))
  report.cases.opencode = { version: execFileSync(bin, ['--version'], { encoding: 'utf8', windowsHide: true }).trim(), paths }
  console.log('OpenCode relevant paths: ' + Object.keys(paths).join(', ')); stop(proc)
}

try {
  for (const [name, fn] of [['claude', claude], ['pi', pi], ['codex', codex], ['opencode', opencode]]) {
    if (process.argv[2] && process.argv[2] !== name) continue
    console.log(`Testing ${name}`)
    try { await fn(); console.log(`Recorded ${name}`) } catch (error) { report.cases[name] ??= {}; report.cases[name].error = String(error); console.log(`${name}: ${error}`) }
    await writeFile(reportPath, JSON.stringify(report, null, 2))
  }
} finally {
  for (const proc of processes) try { proc.kill() } catch {}
  server?.closeAllConnections(); server?.close(); await browser.close()
  await writeFile(reportPath, JSON.stringify(report, null, 2))
}
process.exitCode = Object.values(report.cases).some(value => value.error) ? 1 : 0
console.log(out)
// ConPTY's native wait worker can keep Node alive after all owned terminals exit.
// Reports and browser cleanup have completed before terminating this probe host.
process.exit(process.exitCode)
