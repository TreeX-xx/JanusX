// Native Claude + documented Mods API and settings hooks, isolated localhost test.
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { createConnection } from 'node:net'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import pty from 'node-pty'

assert.equal(process.platform, 'win32')
const bin = process.env.JANUSX_TEST_CLAUDE_BIN ?? path.join(process.env.APPDATA, 'npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe')
const root = await mkdtemp(path.join(tmpdir(), 'janusx-claude-mods-'))
const workspace = path.join(root, 'workspace')
const config = path.join(root, 'config')
const artifacts = path.resolve('artifacts/claude-dual-mode/2.1.316', `mods-${Date.now()}`)
for (const directory of [workspace, config, artifacts]) await mkdir(directory, { recursive: true })
const token = randomUUID()
const taskProbe = process.argv.includes('--tasks-only') || process.argv.includes('--todos-only')
const legacyTodos = process.argv.includes('--todos-only')
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => [
  'path', 'systemroot', 'windir', 'comspec', 'temp', 'tmp', 'pathext', 'programfiles', 'programfiles(x86)', 'claude_code_git_bash_path',
].includes(key.toLowerCase())))
Object.assign(env, {
  HOME: root, USERPROFILE: root, CLAUDE_CONFIG_DIR: config,
  APPDATA: path.join(root, 'AppData/Roaming'), LOCALAPPDATA: path.join(root, 'AppData/Local'),
  XDG_CONFIG_HOME: path.join(root, '.config'), XDG_DATA_HOME: path.join(root, '.local/share'),
  TERM: 'xterm-256color', NO_PROXY: '127.0.0.1,localhost',
  ANTHROPIC_API_KEY: 'janusx-local-probe-only',
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1',
  ...(taskProbe ? { CLAUDE_CODE_ENABLE_TODO_TOOLS: '1', CLAUDE_CODE_ENABLE_TASKS: legacyTodos ? '0' : '1' } : {}),
})
const report = { version: execFileSync(bin, ['--version'], { env, encoding: 'utf8', windowsHide: true }).trim(),
  binarySha256: createHash('sha256').update(await readFile(bin)).digest('hex'), root, started: new Date().toISOString(), checks: {},
  limitations: ['Windows ConPTY and localhost model only.', 'Probe plugin, no JanusX product adapter or renderer acceptance.'] }
assert.equal(report.version, '2.1.316 (Claude Code)', 'Review Mods API for another CLI version')
await writeFile(path.join(config, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, theme: 'dark', autoUpdates: false,
  customApiKeyResponses: { approved: [env.ANTHROPIC_API_KEY], rejected: [] } }))
await writeFile(path.join(config, 'settings.json'), JSON.stringify({ permissions: { defaultMode: 'manual' } }))

const events = [], requests = [], runs = [], permissions = [], acks = new Map(), queues = new Map(), terminals = new Set(), toolPids = new Set()
let backgroundAttempt = false
let backgroundIdentity
let requestNumber = 0
const json = (res, value) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(value))
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1')
    const buffers = []
    for await (const buffer of req) buffers.push(buffer)
    const body = JSON.parse(Buffer.concat(buffers).toString() || '{}')
    if (!url.pathname.includes('/messages')) {
      if (req.headers['x-probe-token'] !== token) { res.writeHead(403).end(); return }
      const [, route, label] = url.pathname.split('/')
      if (route === 'events') { events.push({ at: Date.now(), label, ...body }); json(res, {}); return }
      if (route === 'poll') { json(res, { command: queues.get(label)?.shift() }); return }
      if (route === 'acks') { acks.set(body.id, { at: Date.now(), label, ...body }); json(res, {}); return }
      if (route === 'hooks') {
        const event = { at: Date.now(), label, type: 'classic', data: body }
        events.push(event)
        if (body.hook_event_name === 'PermissionRequest') {
          const pending = { id: randomUUID(), event, res, answered: false, closed: false }
          permissions.push(pending)
          res.on('close', () => { pending.closed = true })
          return
        }
        json(res, {}); return
      }
      res.writeHead(404).end(); return
    }
    if (url.pathname.includes('count_tokens')) { json(res, { input_tokens: 10 }); return }
    const markers = [...JSON.stringify(body.messages ?? []).matchAll(/MATRIX_[A-Z_]+/g)].map(match => match[0])
    const marker = markers.at(-1) ?? 'NO_MARKER'
    const number = ++requestNumber
    const observed = { number, marker, model: body.model, effort: body.output_config?.effort, messages: body.messages,
      startedAt: Date.now(), tools: (body.tools ?? []).map(tool => tool.name), stream: body.stream }
    requests.push(observed)
    const latest = body.messages?.at(-1)?.content
    const hasResult = Array.isArray(latest) && latest.some(block => block.type === 'tool_result')
    const taskActions = legacyTodos ? [
      ['TodoWrite', { todos: [{ content: 'Inspect native task protocol', activeForm: 'Inspecting native task protocol', status: 'in_progress' }, { content: 'Verify display', activeForm: 'Verifying display', status: 'pending' }] }],
      ['TodoWrite', { todos: [{ content: 'Inspect native task protocol', activeForm: 'Inspecting native task protocol', status: 'completed' }, { content: 'Verify display', activeForm: 'Verifying display', status: 'completed' }] }],
      ['TodoWrite', { todos: [] }],
    ] : [
      ['TaskCreate', { subject: 'Inspect native task protocol', description: 'Verify structured state', activeForm: 'Inspecting native task protocol' }],
      ['TaskUpdate', { taskId: '1', status: 'in_progress' }],
      ['TaskUpdate', { taskId: '1', status: 'completed' }],
      ['TaskUpdate', { taskId: '1', status: 'deleted' }],
    ]
    const taskIndex = body.messages?.flatMap(m => Array.isArray(m.content) ? m.content : []).filter(b => b.type === 'tool_use' && ['TaskCreate', 'TaskUpdate', 'TodoWrite'].includes(b.name)).length ?? 0
    const taskAction = taskProbe && marker === 'MATRIX_TASKS' ? taskActions[taskIndex] : undefined
    const fileCase = !!taskAction || /MATRIX_(?:ALLOW|DENY|NATIVE_APPROVAL|CANCEL_TOOL|STOP_BACKGROUND|STOP_FOREGROUND)/.test(marker) && !hasResult
    const text = `FIRST_${marker}_SECOND_${number}`
    const tool = taskAction ? { type: 'tool_use', id: `toolu_probe_${number}`, name: taskAction[0], input: taskAction[1] } : ['MATRIX_CANCEL_TOOL', 'MATRIX_STOP_BACKGROUND', 'MATRIX_STOP_FOREGROUND'].includes(marker)
      ? { type: 'tool_use', id: `toolu_probe_${number}`, name: 'Bash', input: {
        command: `node '${path.join(root, 'delayed-tool.cjs').replaceAll('\\', '/')}'`, description: 'Disposable delayed tool cancellation probe', timeout: 20000,
        ...(marker === 'MATRIX_STOP_BACKGROUND' ? { run_in_background: true } : {}) } }
      : { type: 'tool_use', id: `toolu_probe_${number}`, name: 'Write',
        input: { file_path: path.join(workspace, `${marker}.txt`), content: `${marker} written by native Claude\n` } }
    const message = { id: `msg_probe_${number}`, type: 'message', role: 'assistant', model: body.model,
      content: fileCase ? [tool] : [{ type: 'text', text }], stop_reason: fileCase ? 'tool_use' : 'end_turn',
      stop_sequence: null, usage: { input_tokens: 10, output_tokens: 8 } }
    if (!body.stream) { json(res, message); observed.finishedAt = Date.now(); return }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.on('close', () => { observed.closedAt = Date.now() })
    const emit = (type, value) => { if (!res.destroyed) res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`) }
    emit('message_start', { message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } })
    if (fileCase) {
      emit('content_block_start', { index: 0, content_block: { ...tool, input: {} } })
      emit('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(tool.input) } })
    } else {
      emit('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
      emit('content_block_delta', { index: 0, delta: { type: 'text_delta', text: `FIRST_${marker}_` } })
      await delay(['MATRIX_CANCEL', 'MATRIX_NATIVE_CANCEL', 'MATRIX_STOP_BACKGROUND'].includes(marker) ? 8000 : marker === 'MATRIX_QUEUE_ACTIVE' ? 3000 : 1400)
      if (res.destroyed) { observed.cancelledBeforeFinish = true; return }
      emit('content_block_delta', { index: 0, delta: { type: 'text_delta', text: `SECOND_${number}` } })
    }
    emit('content_block_stop', { index: 0 })
    emit('message_delta', { delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: 8 } })
    emit('message_stop', {}); observed.finishedAt = Date.now(); res.end()
  } catch (error) { report.serverError = String(error); if (!res.headersSent) res.writeHead(500); res.end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const endpoint = `http://127.0.0.1:${server.address().port}`
env.ANTHROPIC_BASE_URL = endpoint
const toolDelay = process.argv.some(arg => arg.startsWith('--stop-')) ? 14000 : 7000
await writeFile(path.join(root, 'delayed-tool.cjs'), `const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(path.join(root, 'tool-pid.txt'))}, JSON.stringify({pid: process.pid, startedAt: Date.now()})); setTimeout(() => fs.writeFileSync(${JSON.stringify(path.join(root, 'tool-finished.txt'))}, 'finished'), ${toolDelay});`)

const clean = value => value.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1b[=>]/g, '')
async function until(predicate, name, timeout = 20000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { const value = await predicate(); if (value) return value; await delay(40) }
  throw new Error(`Timeout: ${name}`)
}
async function exists(file) { try { await access(file); return true } catch { return false } }
function isAlive(pid) { try { process.kill(pid, 0); return true } catch { return false } }
async function pipe(args, label) {
  const run = { label, args, output: '', stderr: '', exitCode: null }
  runs.push(run)
  const child = spawn(bin, args, { cwd: workspace, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', data => { run.output += data }); child.stderr.on('data', data => { run.stderr += data })
  const timeout = setTimeout(() => child.kill(), 15000)
  await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => { run.exitCode = code; resolve() }) })
  clearTimeout(timeout); return run
}
async function prepare(label) {
  const directory = path.join(root, `plugin-${label}`)
  await mkdir(path.join(directory, '.claude-plugin'), { recursive: true })
  await mkdir(path.join(directory, 'hooks'))
  await writeFile(path.join(directory, '.claude-plugin/plugin.json'), JSON.stringify({ name: `janusx-probe-${label.toLowerCase()}`, version: '0.0.1', description: 'Disposable localhost feasibility probe' }))
  await writeFile(path.join(directory, 'hooks/hooks.json'), JSON.stringify({ modules: ['./register.js'] }))
  await writeFile(path.join(directory, 'hooks/register.js'), await readFile(new URL('./probe-plugin.js', import.meta.url)))
  await writeFile(path.join(directory, 'hooks/probe-config.js'), `export const endpoint = ${JSON.stringify(endpoint)};\nexport const token = ${JSON.stringify(token)};\nexport const label = ${JSON.stringify(label)};\n`)
  const settings = path.join(root, `settings-${label}.json`)
  const hookNames = ['SessionStart', 'UserPromptSubmit', 'MessageDisplay', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'Stop', 'SessionEnd', 'PostModelSwitch']
  await writeFile(settings, JSON.stringify({ permissions: { defaultMode: 'manual' },
    env: { JANUSX_HOOK_TERMINAL_ID: `terminal-${label}`, JANUSX_HOOK_WORKSPACE_ID: 'workspace-shared',
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL: endpoint, DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
    hooks: Object.fromEntries(hookNames.map(name => [name, [{ hooks: [{ type: 'http', url: `${endpoint}/hooks/${label}`,
      headers: { 'X-Probe-Token': token }, timeout: name === 'PermissionRequest' ? 25 : 5 }] }]])) }))
  return { directory, settings, label }
}
function nativeArgs(prepared, extra = []) {
  return ['--model', 'claude-sonnet-4-6', '--tools', taskProbe ? legacyTodos ? 'TodoWrite' : 'TaskCreate,TaskUpdate,TaskList,TaskGet' : 'Write,Bash,TaskStop', '--permission-mode', 'manual', '--setting-sources', 'user',
    '--strict-mcp-config', '--plugin-dir', prepared.directory, '--settings', prepared.settings, '--debug-file', path.join(root, `debug-${prepared.label}.txt`), ...extra]
}
function native(prepared, extra = []) { return nativeProcess(nativeArgs(prepared, extra), prepared.label) }
function nativeProcess(args, label) {
  const run = { label, args, output: '', exitCode: null, pid: null }
  const terminal = pty.spawn(bin, args, { cwd: workspace, env, name: 'xterm-256color', cols: 130, rows: 36 })
  run.pid = terminal.pid; runs.push(run); terminals.add(terminal)
  terminal.onData(data => { run.output += data })
  terminal.onExit(event => { run.exitCode = event.exitCode; terminals.delete(terminal) })
  return { terminal, run }
}
async function setup(client) {
  await until(() => /Sonnet|trust|API key|security|Welcome|workspace|folder|Safety/i.test(clean(client.run.output)), 'native setup')
  await delay(1500)
  const handled = new Set()
  for (let i = 0; i < 18; i++) {
    if (events.some(event => event.label === client.run.label && event.type === 'session.start')) return
    const text = clean(client.run.output).replace(/\s/g, '')
    if (!handled.has('trust') && /Yes,Itrustthisfolder|Yes,Itrustthisdirectory/.test(text)) {
      handled.add('trust'); client.terminal.write('\x1b[B'); await delay(200); client.terminal.write('\r'); await delay(1500)
    } else if (!handled.has('key') && /DoyouwanttousethisAPIkey|Yes,usethisAPIkey/.test(text)) {
      handled.add('key'); client.terminal.write('\x1b[A'); await delay(200); client.terminal.write('\r'); await delay(1500)
    } else if (!handled.has('auto') && /Makeautomodeyourdefaultpermissionmode/.test(text)) {
      handled.add('auto'); client.terminal.write('\x1b[B'); await delay(200); client.terminal.write('\r'); await delay(1500)
    }
    await delay(700)
  }
  throw new Error(`Plugin did not start: ${clean(client.run.output).slice(-3500)}`)
}
async function nativeSend(client, text) { client.terminal.write(text); await delay(120); client.terminal.write('\r') }
async function command(label, action) {
  const id = randomUUID(); const queue = queues.get(label) ?? []; queues.set(label, queue); queue.push({ id, ...action })
  return until(() => acks.get(id), `command ${action.type}`, 15000)
}
async function control(message) {
  const nonce = (await readFile(path.join(config, 'daemon/pipe.key'), 'utf8')).trim()
  const auth = (await readFile(path.join(config, 'daemon/control.key'), 'utf8')).trim()
  return new Promise((resolve, reject) => {
    const socket = createConnection(`\\\\.\\pipe\\cc-daemon-${nonce}-control`)
    let buffer = ''
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('daemon control timeout')) }, 8000)
    socket.on('error', error => { clearTimeout(timer); reject(error) })
    socket.on('connect', () => socket.write(`${JSON.stringify({ proto: 1, ...message, auth })}\n`))
    socket.on('data', bytes => {
      buffer += bytes.toString()
      const end = buffer.indexOf('\n')
      if (end < 0) return
      clearTimeout(timer); socket.destroy()
      try { resolve(JSON.parse(buffer.slice(0, end))) } catch (error) { reject(error) }
    })
  })
}
async function turn(label, marker) {
  const start = await until(() => events.find(event => event.label === label && event.type === 'turn.start' && event.data.text.includes(marker)), marker)
  const end = await until(() => events.find(event => event.label === label && event.type === 'turn.complete' && event.data.turnId === start.data.turnId), `${marker} complete`)
  await delay(200)
  return { start, end }
}
function answerPermission(pending, allow) {
  pending.answered = true
  json(pending.res, { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: allow
    ? { behavior: 'allow' } : { behavior: 'deny', message: 'Denied by disposable probe controller' } } })
}
async function probeSettings(label, client) {
  const modelAck = await command(label, { type: 'config-set', key: 'model', value: 'haiku' })
  report.checks.settings = { modelAck, method: 'config.set', requested: 'haiku' }
  if (modelAck.ok && !modelAck.result?.deny) {
    assert.ok((await command(label, { type: 'send', text: 'MATRIX_SETTINGS_DIALOG' })).ok)
    await turn(label, 'MATRIX_SETTINGS_DIALOG')
    await nativeSend(client, 'MATRIX_SETTINGS_NATIVE')
    await turn(label, 'MATRIX_SETTINGS_NATIVE')
    report.checks.settings.requests = ['MATRIX_SETTINGS_DIALOG', 'MATRIX_SETTINGS_NATIVE'].map(marker => {
      const request = requests.find(request => request.marker === marker)
      return { marker, model: request.model, effort: request.effort }
    })
    report.checks.settings.configuration = await command(label, { type: 'config' })
    assert.ok(report.checks.settings.requests.every(request => request.model.includes('haiku')))
    const persisted = JSON.parse(await readFile(path.join(config, 'settings.json'), 'utf8'))
    report.checks.settings.persistedModel = persisted.model
    assert.equal(persisted.model, 'haiku', 'config.set changes the isolated persisted default')
  }
  if (process.argv.includes('--probe-command-settings')) {
    report.checks.commandSettings = await command(label, { type: 'model', model: 'claude-haiku-4-5' }).catch(error => ({ ok: false, error: String(error) }))
  }
}
async function probeNativeInterrupt(client) {
  await nativeSend(client, 'MATRIX_NATIVE_CANCEL')
  const active = await until(() => events.find(event => event.type === 'turn.start' && event.data.text === 'MATRIX_NATIVE_CANCEL'), 'native interrupt turn')
  await until(() => events.some(event => event.type === 'step.chunk' && event.data.turnId === active.data.turnId && event.data.chunk.kind === 'text'), 'native interrupt partial')
  client.terminal.write('\x1b')
  const completed = await until(() => events.find(event => event.type === 'turn.complete' && event.data.turnId === active.data.turnId), 'native interrupt completion')
  assert.ok(completed.data.isAborted)
  const sendAfter = await command('A', { type: 'send', text: 'MATRIX_AFTER_NATIVE_CANCEL' })
  report.checks.nativeInterrupt = { completion: completed.data, sendAfter, samePidAlive: client.run.exitCode === null }
  assert.equal(sendAfter.result?.drop, 'the session was stopped and nobody has sent input since')
  await delay(300)
  assert.equal(requests.some(request => request.marker === 'MATRIX_AFTER_NATIVE_CANCEL'), false)
  // This is explicit input on the native test surface, not a proposed dialog
  // transport or an attempt to forge the plugin's origin.
  await nativeSend(client, 'MATRIX_NATIVE_RECOVERY')
  await turn('A', 'MATRIX_NATIVE_RECOVERY')
  const retry = await command('A', { type: 'send', text: 'MATRIX_AFTER_NATIVE_CANCEL' })
  assert.ok(retry.ok && !retry.result?.drop)
  const resumed = await turn('A', 'MATRIX_AFTER_NATIVE_CANCEL')
  assert.equal(requests.filter(request => request.marker === 'MATRIX_AFTER_NATIVE_CANCEL').length, 1)
  assert.ok(JSON.stringify(requests.find(request => request.marker === 'MATRIX_AFTER_NATIVE_CANCEL').messages).includes('MATRIX_NATIVE_RECOVERY'))
  report.checks.nativeInterrupt.recovery = { retry, turnId: resumed.start.data.turnId, samePidAlive: client.run.exitCode === null }
}
async function probeQueue(client) {
  await nativeSend(client, 'MATRIX_QUEUE_ACTIVE')
  const active = await until(() => events.find(event => event.type === 'turn.start' && event.data.text === 'MATRIX_QUEUE_ACTIVE'), 'queue active turn')
  await until(() => events.some(event => event.type === 'step.chunk' && event.data.turnId === active.data.turnId && event.data.chunk.kind === 'text'), 'queue partial')
  const submittedAt = Date.now()
  const pending = command('A', { type: 'send', text: 'MATRIX_QUEUED_DIALOG' })
  const ack = await pending
  assert.ok(ack.ok && !ack.result?.drop)
  const first = await turn('A', 'MATRIX_QUEUE_ACTIVE')
  const queued = await turn('A', 'MATRIX_QUEUED_DIALOG')
  const request = requests.find(request => request.marker === 'MATRIX_QUEUED_DIALOG')
  assert.ok(submittedAt < first.end.at, 'Submission happened during generation')
  assert.ok(queued.start.at >= first.end.at, 'Queued turn starts after active completion')
  assert.equal(requests.filter(request => request.marker === 'MATRIX_QUEUED_DIALOG').length, 1)
  assert.ok(JSON.stringify(request.messages).includes('MATRIX_QUEUE_ACTIVE'))
  report.checks.queue = { ack, submittedAt, activeCompletedAt: first.end.at, queuedStartedAt: queued.start.at,
    activeTurnId: active.data.turnId, queuedTurnId: queued.start.data.turnId, samePidAlive: client.run.exitCode === null }
}

async function probeHybrid(setupClient) {
  await nativeSend(setupClient, '/exit')
  await until(() => setupClient.run.exitCode !== null, 'setup session exits')
  const prepared = await prepare('H')
  // The supervisor can scrub inherited provider environment. These are only
  // this test's dummy credentials and loopback address, in its disposable home.
  await writeFile(path.join(config, 'settings.json'), await readFile(prepared.settings))
  backgroundAttempt = true
  const empty = process.argv.includes('--hybrid-empty')
  const dispatch = await pipe(nativeArgs(prepared, empty ? ['--bg'] : ['--bg', 'MATRIX_HYBRID_BOOT']), 'hybrid-dispatch')
  report.checks.hybrid = { dispatch }
  assert.equal(dispatch.exitCode, 0)
  const short = /backgrounded\s*·\s*([a-f0-9]+)/.exec(dispatch.output)?.[1]
  assert.ok(short, 'Native background dispatch returns identity')
  const listing = await pipe(['agents', '--json', '--all'], 'hybrid-list')
  backgroundIdentity = JSON.parse(listing.output).find(job => job.id === short)
  assert.ok(backgroundIdentity?.sessionId)
  const attached = nativeProcess(['attach', short], 'H-attach')
  const boot = empty ? { start: await until(() => events.find(e => e.label === 'H' && e.type === 'session.start'), 'empty hybrid ready') } : await turn('H', 'MATRIX_HYBRID_BOOT')
  if (empty) { await delay(300); assert.equal(requests.length, 0); report.checks.hybrid.emptyWithoutModelRequest = true }
  const readyListing = await pipe(['agents', '--json', '--all'], 'hybrid-list-ready')
  backgroundIdentity = JSON.parse(readyListing.output).find(job => job.id === short)
  assert.ok(backgroundIdentity?.pid, 'Ready worker exposes its native PID')
  report.checks.hybrid.before = backgroundIdentity
  assert.equal(boot.start.sessionId, backgroundIdentity.sessionId)
  if (process.argv.includes('--flag-settings')) {
    const settings = JSON.parse(await readFile(prepared.settings, 'utf8'))
    await writeFile(prepared.settings, JSON.stringify({ ...settings, model: 'haiku', effortLevel: 'low' }))
    await delay(1000)
    report.checks.flagSettings = { config: await command('H', { type: 'config' }) }
    await control({ op: 'reply', short, text: 'MATRIX_FLAG_SETTINGS', nextTurn: true })
    await turn('H', 'MATRIX_FLAG_SETTINGS')
    const request = requests.find(r => r.marker === 'MATRIX_FLAG_SETTINGS')
    report.checks.flagSettings.actual = { model: request.model, effort: request.effort }
    console.log('flag settings', JSON.stringify(report.checks.flagSettings.actual))
    attached.terminal.write('\x1a'); await until(() => attached.run.exitCode !== null, 'settings detach')
    return
  }
  if (process.argv.includes('--hybrid-settings')) {
    const before = await readFile(path.join(config, 'settings.json'), 'utf8')
    const choices = [{ model: 'haiku', effort: 'low' }, { model: 'sonnet', effort: 'high' }, { model: 'sonnet', effort: 'high' }, { model: 'opus', effort: 'max' }, { model: 'opus', effort: 'max' }, { model: 'claude-sonnet-4-6', effort: 'high' }]
    report.checks.stepSettings = []
    for (const [index, settings] of choices.entries()) {
      const ack = await command('H', { type: 'step-settings', settings, envEffort: process.argv.includes('--env-effort') })
      assert.ok(ack.ok)
      const marker = `MATRIX_SETTING_${String.fromCharCode(65 + index)}`
      const sent = await control({ op: 'reply', short, text: marker, nextTurn: true })
      assert.ok(sent.ok); await turn('H', marker)
      const actual = requests.find(r => r.marker === marker)
      report.checks.stepSettings.push({ settings, ack, actual: { model: actual?.model, effort: actual?.effort } })
      assert.ok(actual?.model.includes(settings.model))
      if (process.argv.includes('--env-effort')) assert.equal(actual?.effort, settings.effort)
      console.log('step setting', JSON.stringify({ settings, actual: { model: actual?.model, effort: actual?.effort } }))
    }
    await nativeSend(attached, 'MATRIX_SETTINGS_NATIVE')
    await turn('H', 'MATRIX_SETTINGS_NATIVE')
    const actual = requests.find(r => r.marker === 'MATRIX_SETTINGS_NATIVE')
    assert.ok(actual.model.includes('sonnet')); assert.equal(actual.effort, 'high')
    assert.equal(await readFile(path.join(config, 'settings.json'), 'utf8'), before)
    report.checks.stepSettingsNative = { model: actual.model, effort: actual.effort, settingsUnchanged: true }
    attached.terminal.write('\x1a'); await until(() => attached.run.exitCode !== null, 'settings detach')
    return
  }
  await nativeSend(attached, 'MATRIX_NATIVE_CANCEL')
  const active = await until(() => events.find(e => e.label === 'H' && e.type === 'turn.start' && e.data.text === 'MATRIX_NATIVE_CANCEL'), 'hybrid native turn')
  await until(() => events.some(e => e.label === 'H' && e.type === 'step.chunk' && e.data.turnId === active.data.turnId && e.data.chunk.kind === 'text'), 'hybrid native partial')
  attached.terminal.write('\x1b')
  const stopped = await until(() => events.find(e => e.label === 'H' && e.type === 'turn.complete' && e.data.turnId === active.data.turnId), 'hybrid native Esc completion')
  assert.ok(stopped.data.isAborted)
  const pluginRefusal = await command('H', { type: 'send', text: 'MATRIX_HYBRID_REFUSED' })
  report.checks.hybrid.pluginRefusal = pluginRefusal
  assert.equal(pluginRefusal.result?.drop, 'the session was stopped and nobody has sent input since')
  const reply = await control({ op: 'reply', short, text: 'MATRIX_HYBRID_RECOVERY', nextTurn: true })
  report.checks.hybrid.daemonAck = reply
  assert.ok(reply.ok)
  const recovered = await turn('H', 'MATRIX_HYBRID_RECOVERY')
  const recoveredRequest = requests.find(r => r.marker === 'MATRIX_HYBRID_RECOVERY')
  const chunks = events.filter(e => e.label === 'H' && e.type === 'step.chunk' && e.data.turnId === recovered.start.data.turnId && e.data.chunk.kind === 'text')
  assert.ok(chunks.some(e => e.at < recoveredRequest.finishedAt))
  assert.equal(chunks.map(e => e.data.chunk.text).join(''), `FIRST_MATRIX_HYBRID_RECOVERY_SECOND_${recoveredRequest.number}`)
  assert.equal(requests.filter(r => r.marker === 'MATRIX_HYBRID_RECOVERY').length, 1)
  assert.equal(requests.some(r => r.marker === 'MATRIX_HYBRID_REFUSED'), false)
  const pluginAfter = await command('H', { type: 'send', text: 'MATRIX_HYBRID_PLUGIN_AFTER' })
  assert.ok(pluginAfter.ok && !pluginAfter.result?.drop)
  await turn('H', 'MATRIX_HYBRID_PLUGIN_AFTER')
  await nativeSend(attached, 'MATRIX_HYBRID_NATIVE_AFTER')
  await turn('H', 'MATRIX_HYBRID_NATIVE_AFTER')
  const finalRequest = requests.find(r => r.marker === 'MATRIX_HYBRID_NATIVE_AFTER')
  assert.ok([...(empty ? [] : ['MATRIX_HYBRID_BOOT']), 'MATRIX_NATIVE_CANCEL', 'MATRIX_HYBRID_RECOVERY', 'MATRIX_HYBRID_PLUGIN_AFTER'].every(marker => JSON.stringify(finalRequest.messages).includes(marker)))
  const afterListing = await pipe(['agents', '--json', '--all'], 'hybrid-list-after')
  const after = JSON.parse(afterListing.output).find(job => job.id === short)
  assert.equal(after.pid, backgroundIdentity.pid)
  assert.equal(after.sessionId, backgroundIdentity.sessionId)
  assert.ok(isAlive(after.pid))
  report.checks.hybrid.result = { samePid: after.pid, sameSessionId: after.sessionId, liveChunks: chunks.length,
    recoveredPrompt: recovered.start.data, pluginAfter, fullHistory: true }
  attached.terminal.write('\x1a')
  await until(() => attached.run.exitCode !== null, 'hybrid detach')
  console.log('hybrid passed', JSON.stringify(report.checks.hybrid.result))
}
async function probeStopTool(client, foreground) {
  const marker = foreground ? 'MATRIX_STOP_FOREGROUND' : 'MATRIX_STOP_BACKGROUND'
  const ack = await command('A', { type: 'send', text: marker })
  assert.ok(ack.ok && !ack.result?.drop)
  const permission = await until(() => permissions.find(p => p.event.data.tool_name === 'Bash'), 'stop probe Bash permission')
  answerPermission(permission, true)
  await until(() => exists(path.join(root, 'tool-pid.txt')), 'stop probe child started')
  const child = JSON.parse(await readFile(path.join(root, 'tool-pid.txt'), 'utf8'))
  toolPids.add(child.pid)
  const active = events.find(e => e.type === 'turn.start' && e.data.text === marker)
  const use = events.find(e => e.type === 'tool.start' && e.data.tool === 'Bash')
  assert.ok(use)
  if (!foreground) await until(() => events.some(e => e.type === 'tool.complete' && e.data.toolUseId === use.data.tool_use_id), 'background task returned')
  const abort = await command('A', { type: 'abort', turnId: active.data.turnId })
  await until(() => events.some(e => e.type === 'turn.complete' && e.data.turnId === active.data.turnId && e.data.isAborted), 'stop probe turn aborted')
  report.checks.stopTool = { foreground, child, abort, toolUseId: use.data.tool_use_id, aliveAfterAbort: isAlive(child.pid) }
  const history = await command('A', { type: 'messages' })
  report.checks.stopTool.history = history
  const completed = events.find(e => e.type === 'tool.complete' && e.data.toolUseId === use.data.tool_use_id)
  report.checks.stopTool.toolResult = completed?.data.result
  report.checks.stopTool.stopHooks = events.filter(e => e.type === 'classic' && e.data.hook_event_name === 'Stop').map(e => e.data)
  const historyTool = history.result?.flatMap(row => row.toolUses ?? []).find(tool => tool.tool_use_id === use.data.tool_use_id)
  const taskId = completed?.data.result?.result?.backgroundTaskId ?? historyTool?.result?.backgroundTaskId
  report.checks.stopTool.taskId = taskId
  report.checks.stopTool.taskIdSource = completed?.data.result?.result?.backgroundTaskId ? 'tool.complete' : 'session.messages.toolUses.result'
  report.checks.stopTool.backgroundedByTurnAbort = historyTool?.result?.backgroundedByTurnAbort ?? false
  if (foreground) assert.equal(report.checks.stopTool.backgroundedByTurnAbort, true)
  assert.ok(taskId, 'Need an actual native task id before TaskStop; never infer one from a PID')
  const stop = await command('A', { type: 'stop-task', taskId })
  report.checks.stopTool.stop = stop
  await until(() => !isAlive(child.pid), 'TaskStop child exits', 4000)
  assert.ok(stop.ok && !stop.result?.deny && !stop.result?.isError)
  const remaining = Math.max(0, child.startedAt + toolDelay + 500 - Date.now())
  await delay(remaining)
  report.checks.stopTool.childGone = !isAlive(child.pid)
  report.checks.stopTool.sideEffectAbsent = !(await exists(path.join(root, 'tool-finished.txt')))
  assert.ok(report.checks.stopTool.childGone && report.checks.stopTool.sideEffectAbsent)
  const continued = await command('A', { type: 'send', text: 'MATRIX_AFTER_TASK_STOP' })
  assert.ok(continued.ok && !continued.result?.drop)
  await turn('A', 'MATRIX_AFTER_TASK_STOP')
  assert.ok(client.run.exitCode === null)
  report.checks.stopTool.continued = continued
  console.log('TaskStop passed', JSON.stringify({ ...report.checks.stopTool, history: undefined, stopHooks: undefined }))
}

try {
  console.log('mods probe', report.version, root)
  const prepared = await prepare('A')
  const validation = await pipe(['plugin', 'validate', prepared.directory], 'validate-A')
  report.checks.pluginValidation = { exitCode: validation.exitCode, output: validation.output, stderr: validation.stderr }
  assert.equal(validation.exitCode, 0)
  const client = native(prepared)
  await setup(client)
  const identity = events.find(event => event.label === 'A' && event.type === 'session.start')
  report.checks.nativeIdentity = { pid: client.run.pid, sessionId: identity.sessionId, terminalId: identity.data.terminalId }
  report.checks.configuration = await command('A', { type: 'config' })
  console.log('plugin ready', JSON.stringify(report.checks.nativeIdentity))
  assert.equal(requests.length, 0, 'Empty native session must not invoke a model')
  if (taskProbe) {
    await nativeSend(client, 'MATRIX_TASKS')
    await turn('A', 'MATRIX_TASKS')
    const snapshots = events.filter(e => e.type === 'task.snapshot')
    assert.equal(snapshots.length, legacyTodos ? 3 : 4)
    assert.ok(snapshots.every(e => !e.data.result?.deny && !e.data.result?.isError))
    report.checks.tasks = snapshots
    console.log('task snapshots', JSON.stringify(snapshots))
  } else if (process.argv.includes('--hybrid-only') || process.argv.includes('--hybrid-empty') || process.argv.includes('--hybrid-settings') || process.argv.includes('--flag-settings')) {
    await probeHybrid(client)
  } else if (process.argv.includes('--stop-tool-only') || process.argv.includes('--stop-foreground-only')) {
    await probeStopTool(client, process.argv.includes('--stop-foreground-only'))
  } else if (process.argv.includes('--interrupt-only')) {
    await probeNativeInterrupt(client)
  } else if (process.argv.includes('--queue-only')) {
    await probeQueue(client)
  } else if (process.argv.includes('--settings-only')) {
    await probeSettings('A', client)
  } else {
  await nativeSend(client, 'MATRIX_NATIVE_FIRST')
  const first = await turn('A', 'MATRIX_NATIVE_FIRST')
  const firstRequest = requests.find(request => request.marker === 'MATRIX_NATIVE_FIRST')
  const chunks = events.filter(event => event.label === 'A' && event.type === 'step.chunk' && event.data.turnId === first.start.data.turnId && event.data.chunk.kind === 'text')
  report.checks.liveText = { count: chunks.length, partialBeforeResponseEnd: chunks.some(event => event.at < firstRequest.finishedAt),
    text: chunks.map(event => event.data.chunk.text).join(''), turnId: first.start.data.turnId }
  assert.ok(report.checks.liveText.partialBeforeResponseEnd, 'Need actual partial text before model completes')
  assert.equal(report.checks.liveText.text, `FIRST_MATRIX_NATIVE_FIRST_SECOND_${firstRequest.number}`)
  const secondAck = await command('A', { type: 'send', text: 'MATRIX_DIALOG_SECOND' })
  assert.ok(secondAck.ok, secondAck.error)
  await turn('A', 'MATRIX_DIALOG_SECOND')
  await nativeSend(client, 'MATRIX_NATIVE_THIRD'); await turn('A', 'MATRIX_NATIVE_THIRD')
  const thirdRequest = requests.find(request => request.marker === 'MATRIX_NATIVE_THIRD')
  report.checks.roundtrip = { samePidAlive: client.run.exitCode === null, oneSessionId: new Set(events.filter(event => event.label === 'A' && event.sessionId).map(event => event.sessionId)).size === 1,
    fullHistory: ['MATRIX_NATIVE_FIRST', 'MATRIX_DIALOG_SECOND', 'MATRIX_NATIVE_THIRD'].every(text => JSON.stringify(thirdRequest.messages).includes(text)), sendAck: secondAck }
  assert.ok(report.checks.roundtrip.fullHistory)
  assert.ok(report.checks.roundtrip.samePidAlive && report.checks.roundtrip.oneSessionId)
  console.log('stream and roundtrip', JSON.stringify({ live: report.checks.liveText, roundtrip: report.checks.roundtrip }))

  client.terminal.write('UNSENT_NATIVE_DRAFT'); await delay(250)
  const draftBefore = await command('A', { type: 'draft' })
  assert.ok((await command('A', { type: 'send', text: 'MATRIX_WITH_DRAFT' })).ok)
  await turn('A', 'MATRIX_WITH_DRAFT')
  const draftAfter = await command('A', { type: 'draft' })
  report.checks.draft = { before: draftBefore.result, after: draftAfter.result, preserved: draftBefore.result?.text === 'UNSENT_NATIVE_DRAFT' && draftAfter.result?.text === 'UNSENT_NATIVE_DRAFT' }
  await command('A', { type: 'clear-draft' })
  report.checks.draft.cleared = await command('A', { type: 'draft' })
  assert.equal(report.checks.draft.cleared.result?.text, '')
  assert.ok(report.checks.draft.preserved)

  assert.ok((await command('A', { type: 'send', text: 'MATRIX_CANCEL' })).ok)
  const active = await until(() => events.find(event => event.type === 'turn.start' && event.data.text === 'MATRIX_CANCEL'), 'cancel active turn')
  await until(() => events.find(event => event.type === 'step.chunk' && event.data.turnId === active.data.turnId && event.data.chunk.kind === 'text'), 'partial before cancel')
  const abortAck = await command('A', { type: 'abort', turnId: active.data.turnId })
  const cancelled = await until(() => events.find(event => event.type === 'turn.complete' && event.data.turnId === active.data.turnId), 'abort completion')
  const afterAbort = await command('A', { type: 'send', text: 'MATRIX_AFTER_CANCEL' })
  report.checks.cancel = { ack: abortAck, completion: cancelled.data, sendAfter: afterAbort, samePidAlive: client.run.exitCode === null }
  if (afterAbort.ok && !afterAbort.result?.drop) await turn('A', 'MATRIX_AFTER_CANCEL')
  assert.ok(abortAck.ok && cancelled.data.isAborted)
  assert.ok(afterAbort.ok && !afterAbort.result?.drop)
  console.log('draft and cancel', JSON.stringify({ draft: report.checks.draft, cancel: report.checks.cancel }))

  for (const allow of [true, false]) {
    const marker = allow ? 'MATRIX_ALLOW' : 'MATRIX_DENY'
    assert.ok((await command('A', { type: 'send', text: marker })).ok)
    const pending = await until(() => permissions.find(value => value.event.data.tool_input?.file_path?.endsWith(`${marker}.txt`)), `${marker} permission`)
    const file = path.join(workspace, `${marker}.txt`)
    assert.equal(await exists(file), false)
    await delay(250)
    answerPermission(pending, allow)
    await turn('A', marker)
    const toolId = events.find(event => event.type === 'tool.start' && event.data.file_path === file)?.data.tool_use_id
    report.checks[marker] = { permissionInput: pending.event.data, fileExists: await exists(file), toolId,
      toolFinished: events.some(event => event.type === 'tool.complete' && event.data.toolUseId === toolId) }
    assert.equal(await exists(file), allow)
  }
  console.log('permissions', JSON.stringify({ allow: report.checks.MATRIX_ALLOW, deny: report.checks.MATRIX_DENY }))

  report.checks.history = await command('A', { type: 'messages' })

  assert.ok((await command('A', { type: 'send', text: 'MATRIX_NATIVE_APPROVAL' })).ok)
  const nativePermission = await until(() => permissions.find(value => value.event.data.tool_input?.file_path?.endsWith('MATRIX_NATIVE_APPROVAL.txt')), 'native approval request')
  await delay(300)
  const dialogBeforeRelease = /Do you want|Yes, allow|Allow once/.test(clean(client.run.output).slice(-3000))
  await until(() => /Do you want|Yes, allow|Allow once/.test(clean(client.run.output).slice(-4000)), 'native permission dialog')
  client.terminal.write('\r')
  await turn('A', 'MATRIX_NATIVE_APPROVAL')
  report.checks.nativeApproval = { dialogBeforeHookRelease: dialogBeforeRelease, hookClosedAfterNativeDecision: nativePermission.closed,
    fileExists: await exists(path.join(workspace, 'MATRIX_NATIVE_APPROVAL.txt')) }
  if (!nativePermission.closed) answerPermission(nativePermission, false) // Late denial must not reverse the completed native decision.
  assert.ok(report.checks.nativeApproval.fileExists)

  assert.ok((await command('A', { type: 'send', text: 'MATRIX_CANCEL_TOOL' })).ok)
  const toolPermission = await until(() => permissions.find(value => value.event.data.tool_name === 'Bash'), 'delayed tool permission')
  answerPermission(toolPermission, true)
  await until(() => exists(path.join(root, 'tool-pid.txt')), 'native tool process starts')
  const toolPid = JSON.parse(await readFile(path.join(root, 'tool-pid.txt'), 'utf8')).pid
  toolPids.add(toolPid)
  const toolTurn = events.find(event => event.type === 'turn.start' && event.data.text === 'MATRIX_CANCEL_TOOL')
  const staleAbort = await command('A', { type: 'abort', turnId: active.data.turnId })
  assert.equal(staleAbort.ok, false, 'Previous turn must not cancel current tool')
  const abortTool = await command('A', { type: 'abort', turnId: toolTurn.data.turnId })
  const abortedToolTurn = await until(() => events.find(event => event.type === 'turn.complete' && event.data.turnId === toolTurn.data.turnId), 'tool turn cancelled')
  await delay(400)
  let toolAlive = true
  try { process.kill(toolPid, 0) } catch { toolAlive = false }
  report.checks.cancelTool = { staleAbort, abortTool, turnAborted: abortedToolTurn.data.isAborted, toolPid, toolAlive, completedSideEffect: await exists(path.join(root, 'tool-finished.txt')) }
  if (toolAlive) {
    await until(async () => await exists(path.join(root, 'tool-finished.txt')) || !isAlive(toolPid), 'tool outcome after turn abort', 9000)
    report.checks.cancelTool.eventualSideEffect = await exists(path.join(root, 'tool-finished.txt'))
  }
  console.log('tool cancellation', JSON.stringify(report.checks.cancelTool))

  const preparedB = await prepare('B')
  const secondClient = native(preparedB)
  await setup(secondClient)
  await nativeSend(secondClient, 'MATRIX_B_ONLY'); await turn('B', 'MATRIX_B_ONLY')
  assert.ok((await command('A', { type: 'send', text: 'MATRIX_A_ONLY' })).ok)
  await turn('A', 'MATRIX_A_ONLY')
  const requestA = requests.find(request => request.marker === 'MATRIX_A_ONLY')
  const requestB = requests.find(request => request.marker === 'MATRIX_B_ONLY')
  report.checks.isolation = { identities: events.filter(event => event.type === 'session.start').map(event => ({ label: event.label, sessionId: event.sessionId, terminalId: event.data.terminalId })),
    aExcludesB: !JSON.stringify(requestA.messages).includes('MATRIX_B_ONLY'), bExcludesA: !JSON.stringify(requestB.messages).includes('MATRIX_NATIVE_FIRST') }
  assert.ok(report.checks.isolation.aExcludesB && report.checks.isolation.bExcludesA)
  client.terminal.write('/exit\r')
  await delay(250)
  if (/Background work is running/.test(clean(client.run.output).slice(-2500))) client.terminal.write('\r')
  await until(() => client.run.exitCode !== null, 'A exits')
  assert.ok((await command('B', { type: 'send', text: 'MATRIX_B_SURVIVES' })).ok)
  await turn('B', 'MATRIX_B_SURVIVES')
  report.checks.closeIsolation = { aExited: true, bAlive: secondClient.run.exitCode === null }
  console.log('isolation', JSON.stringify({ identities: report.checks.isolation, close: report.checks.closeIsolation }))
  await probeSettings('B', secondClient)
  }
  report.status = 'completed-with-limitations'
} catch (error) { report.status = 'failed'; report.error = error.stack ?? String(error); process.exitCode = 1; console.log('probe failed', report.error) }
finally {
  for (const pending of permissions) if (!pending.answered && !pending.closed) answerPermission(pending, false)
  for (let attempt = 0; attempt < 3 && terminals.size; attempt++) {
    for (const terminal of terminals) { try { terminal.write('\x1b'); terminal.write('\x15') } catch {} }
    await delay(150)
    for (const terminal of terminals) { try { terminal.write('/exit\r') } catch {} }
    await delay(250)
    for (const terminal of terminals) {
      const run = runs.find(run => run.pid === terminal.pid)
      if (/Background work is running/.test(clean(run.output).slice(-2500))) { try { terminal.write('\r') } catch {} }
    }
    await until(() => terminals.size === 0, 'native cleanup', 2000).catch(() => {})
  }
  for (const terminal of terminals) { try { terminal.kill() } catch {} }
  for (const pid of toolPids) { try { process.kill(pid) } catch {} }
  if (backgroundAttempt) {
    report.daemonCleanup = await pipe(['daemon', 'stop', '--any'], 'hybrid-daemon-cleanup')
    if (backgroundIdentity?.pid) {
      await until(() => !isAlive(backgroundIdentity.pid), 'hybrid worker exits', 5000).catch(() => {})
      report.daemonCleanup.workerGone = !isAlive(backgroundIdentity.pid)
      if (!report.daemonCleanup.workerGone) { report.status = 'failed'; process.exitCode = 1 }
    }
    if (report.daemonCleanup.exitCode !== 0) { report.status = 'failed'; process.exitCode = 1 }
  }
  await delay(300)
  report.cleanup = runs.filter(run => run.pid).map(run => { let alive = true; try { process.kill(run.pid, 0) } catch { alive = false } return { label: run.label, pid: run.pid, alive } })
  if (report.cleanup.some(item => item.alive)) { report.status = 'failed'; process.exitCode = 1 }
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
  report.finished = new Date().toISOString()
  await writeFile(path.join(artifacts, 'mods-report.json'), JSON.stringify(report, null, 2))
  await writeFile(path.join(artifacts, 'mods-events.json'), JSON.stringify(events, null, 2))
  await writeFile(path.join(artifacts, 'mods-requests.json'), JSON.stringify(requests, null, 2))
  await writeFile(path.join(artifacts, 'mods-runs.json'), JSON.stringify(runs.map(run => ({ ...run, output: clean(run.output) })), null, 2))
  console.log('report', path.join(artifacts, 'mods-report.json'))
  process.exit(process.exitCode ?? 0)
}
