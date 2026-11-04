// Real Codex + native ConPTY + local deterministic Responses fixture; no account/model access.
// Usage (Windows): node scripts/codex-dual-mode/probe.mjs
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import WebSocket, { WebSocketServer } from 'ws'
import pty from 'node-pty'

assert.equal(process.platform, 'win32', 'This probe currently validates Windows ConPTY only.')
const bin = process.env.JANUSX_TEST_CODEX_BIN ?? path.join(process.env.APPDATA, 'npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe')
const root = await mkdtemp(path.join(tmpdir(), 'janusx-codex-dual-'))
const workspace = path.join(root, 'workspace')
const configDir = path.join(root, 'config')
await mkdir(workspace)
await mkdir(configDir)
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['path', 'systemroot', 'windir', 'comspec', 'temp', 'tmp', 'pathext', 'programfiles', 'programfiles(x86)'].includes(key.toLowerCase())))
Object.assign(env, {
  USERPROFILE: root, HOME: root, CODEX_HOME: configDir,
  APPDATA: path.join(root, 'AppData/Roaming'), LOCALAPPDATA: path.join(root, 'AppData/Local'),
  TERM: 'xterm-256color', NO_PROXY: '127.0.0.1,localhost',
})
const report = { version: execFileSync(bin, ['--version'], { env, encoding: 'utf8', windowsHide: true }).trim(), root, checks: {}, limitations: ['Local deterministic model fixture; no production provider request.', 'Protocol/TUI integration probe, not JanusX renderer acceptance.'] }
const events = []
const requests = []
const clients = []
const tuiWire = []
const proxySockets = new Set()
let proxy
let backend, terminal, terminalOutput = '', backendOutput = ''
let responseNumber = 0
let pendingSlowResponse

async function until(predicate, label, timeout = 20000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const result = await predicate()
    if (result) return result
    await delay(40)
  }
  throw new Error(`Timeout: ${label}`)
}

class Rpc {
  constructor(socket, label) {
    this.socket = socket
    this.label = label
    this.nextId = 1
    this.pending = new Map()
    socket.on('message', bytes => {
      const message = JSON.parse(bytes.toString())
      events.push({ client: label, ...message })
      if (message.id !== undefined && !message.method) {
        const pending = this.pending.get(message.id)
        if (pending) {
          clearTimeout(pending.timer)
          this.pending.delete(message.id)
          if (message.error) pending.reject(new Error(`${pending.method}: ${JSON.stringify(message.error)}`))
          else pending.resolve(message.result)
        }
      }
    })
    socket.on('close', () => {
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('RPC connection closed')) }
      this.pending.clear()
    })
  }
  send(message) { this.socket.send(JSON.stringify(message)) }
  call(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`RPC timeout: ${method}`)) }, 20000)
      this.pending.set(id, { resolve, reject, timer, method })
      this.send({ id, method, params })
    })
  }
  static async connect(url, label) {
    const socket = new WebSocket(url, { handshakeTimeout: 3000 })
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
    const client = new Rpc(socket, label)
    clients.push(client)
    await client.call('initialize', { clientInfo: { name: `janusx_probe_${label}`, version: '0.1.0' }, capabilities: { experimentalApi: true } })
    client.send({ method: 'initialized', params: {} })
    return client
  }
}

function emitResponse(res, body, text, tool) {
  const number = ++responseNumber
  const item = tool ? { id: `tool_probe_${number}`, call_id: `call_probe_${number}`, status: 'completed', ...tool } : { id: `msg_probe_${number}`, type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] }
  const response = { id: `resp_probe_${number}`, object: 'response', created_at: 1, status: 'completed', model: body.model, output: [item], usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } }
  const event = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  event('response.created', { response: { ...response, status: 'in_progress', output: [] } })
  if (tool) {
    event('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress' } })
    event('response.output_item.done', { output_index: 0, item })
    event('response.completed', { response })
    res.end()
    return
  }
  event('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', content: [] } })
  event('response.content_part.added', { item_id: item.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } })
  event('response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: text.slice(0, 10) })
  const finish = () => {
    if (res.destroyed) return
    event('response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: text.slice(10) })
    event('response.output_item.done', { output_index: 0, item })
    event('response.completed', { response })
    res.end()
  }
  if (text.includes('SLOW')) pendingSlowResponse = { finish, res }
  else setTimeout(finish, 250)
}

const model = createServer(async (req, res) => {
  try {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw || '{}')
    if (!req.url.includes('/responses')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"data":[]}'); return }
    requests.push(body)
    const userInputs = (body.input ?? []).filter(item => item.role === 'user')
    const last = JSON.stringify(userInputs.at(-1) ?? '')
    // The native TUI also requests ephemeral title-generation turns with no tools.
    if (body.text?.format?.schema?.properties?.title) { emitResponse(res, body, '{"title":"Probe conversation"}'); return }
    const marker = ['TERMINAL_FIRST', 'DIALOG_SECOND', 'TERMINAL_THIRD', 'SLOW_CANCEL', 'TOOL_COMMAND', 'TOOL_FILE'].find(value => last.includes(value)) ?? 'BOOTSTRAP'
    const lastInput = body.input?.at(-1)
    const hasToolOutput = lastInput?.type === 'function_call_output' || lastInput?.type === 'custom_tool_call_output'
    let tool
    if (marker === 'DIALOG_SECOND' && !hasToolOutput) {
      assert(body.tools.some(entry => entry.name === 'update_plan'), 'Native Codex exposes update_plan')
      tool = { type: 'function_call', name: 'update_plan', arguments: JSON.stringify({ explanation: 'Verify native plan projection', plan: [
        { step: 'Inspect protocol', status: 'completed' }, { step: 'Display plan', status: 'in_progress' }, { step: 'Verify UI', status: 'pending' },
      ] }) }
    }
    if (marker === 'TOOL_COMMAND' && !hasToolOutput) {
      tool = { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: 'Write-Output JANUSX_COMMAND_OK', shell: 'powershell.exe', login: false, sandbox_permissions: 'require_escalated', justification: 'Run the local fixture marker command for protocol verification.' }) }
    }
    if (marker === 'TOOL_FILE' && !hasToolOutput) {
      const patchTool = body.tools.find(entry => entry.name === 'apply_patch')
      const patch = '*** Begin Patch\n*** Add File: result.html\n+<!doctype html><title>Fixture</title><p>JANUSX_ARTIFACT_OK</p>\n*** End Patch'
      // Fallback model metadata omits apply_patch. Codex recognizes this shell form
      // before shell execution and routes it through its real patch approval handler.
      tool = patchTool ? (patchTool.type === 'custom' ? { type: 'custom_tool_call', name: 'apply_patch', input: patch } : { type: 'function_call', name: 'apply_patch', arguments: JSON.stringify({ patch }) }) : { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: `apply_patch <<'PATCH'\n${patch}\nPATCH`, shell: 'powershell.exe', login: false }) }
    }
    emitResponse(res, body, `ACK_${marker}_COMPLETE`, tool)
  } catch (error) { report.fixtureError = String(error); res.writeHead(500); res.end(String(error)) }
})

try {
  await new Promise(resolve => model.listen(0, '127.0.0.1', resolve))
  await writeFile(path.join(configDir, 'config.toml'), [
    'model="gpt-5.4"', 'model_provider="local"', 'check_for_update_on_startup=false', 'tools.update_plan.enabled=true',
    'approval_policy="on-request"', 'sandbox_mode="read-only"',
    '[model_providers.local]', 'name="Local deterministic probe"',
    `base_url="http://127.0.0.1:${model.address().port}/v1"`, 'wire_api="responses"', 'requires_openai_auth=false',
    `[projects.${JSON.stringify(workspace)}]`, 'trust_level="trusted"',
    '[analytics]', 'enabled=false', '[feedback]', 'enabled=false', '',
  ].join('\n'))
  // Get a loopback port without touching the user's daemon or its control socket.
  const reservation = createServer()
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
  const endpoint = `ws://127.0.0.1:${reservation.address().port}`
  await new Promise(resolve => reservation.close(resolve))
  backend = spawn(bin, ['app-server', '--listen', endpoint], { env, cwd: workspace, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  backend.stdout.on('data', data => { backendOutput += data })
  backend.stderr.on('data', data => { backendOutput += data })
  backend.on('error', error => { backendOutput += String(error) })
  let observer
  await until(async () => {
    try { observer = await Rpc.connect(endpoint, 'dialog'); return true } catch { return false }
  }, 'app-server listener')
  report.backendPid = backend.pid
  const started = await observer.call('thread/start', { cwd: workspace, model: 'gpt-5.4', modelProvider: 'local', approvalPolicy: 'on-request', sandbox: 'read-only' })
  const threadId = started.thread.id
  report.threadId = threadId
  // Native resume resolves durable history; a never-used draft has no rollout yet.
  const bootstrap = await observer.call('turn/start', { threadId, input: [{ type: 'text', text: 'BOOTSTRAP', text_elements: [] }] })
  await until(() => events.some(event => event.method === 'turn/completed' && event.params.turn.id === bootstrap.turn.id), 'persist bootstrap turn')
  console.log(`Probe: ${report.version}; thread ${threadId}; ${root}`)
  // Observe the native client's protocol requests, without replacing or simulating the TUI.
  proxy = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise(resolve => proxy.once('listening', resolve))
  proxy.on('connection', downstream => {
    const upstream = new WebSocket(endpoint)
    proxySockets.add(downstream); proxySockets.add(upstream)
    const queue = []
    downstream.on('message', bytes => {
      tuiWire.push(JSON.parse(bytes.toString()))
      if (upstream.readyState === WebSocket.OPEN) upstream.send(bytes.toString())
      else queue.push(bytes.toString())
    })
    upstream.on('open', () => { for (const message of queue) upstream.send(message) })
    upstream.on('message', bytes => { if (downstream.readyState === WebSocket.OPEN) downstream.send(bytes.toString()) })
    upstream.on('error', () => downstream.close())
    downstream.on('error', () => upstream.close())
    downstream.on('close', () => upstream.close())
    upstream.on('close', () => downstream.close())
  })
  terminal = pty.spawn(bin, ['--remote', `ws://127.0.0.1:${proxy.address().port}`, '--no-alt-screen', 'resume', threadId, 'TERMINAL_FIRST'], {
    cwd: workspace, env, name: 'xterm-256color', cols: 120, rows: 35, useConpty: true, useConptyDll: true,
  })
  report.tuiPid = terminal.pid
  terminal.onData(data => {
    terminalOutput += data
    if (data.includes('\x1b[6n')) terminal.write('\x1b[1;1R')
  })
  terminal.onExit(event => { report.tuiExit = event })
  const complete = marker => events.find(event => event.client === 'dialog' && event.method === 'item/completed' && event.params?.item?.text?.includes(`ACK_${marker}_COMPLETE`))
  await until(() => complete('TERMINAL_FIRST'), 'native TUI prompt visible to JSON client', 30000)
  await until(() => events.filter(event => event.method === 'turn/completed').length >= 2, 'first turn completed')
  report.checks.tuiToStructured = true
  console.log('PASS native TUI input -> structured output')
  const dialogTurn = await observer.call('turn/start', { threadId, input: [{ type: 'text', text: 'DIALOG_SECOND', text_elements: [] }] })
  await until(() => complete('DIALOG_SECOND'), 'dialog second result')
  await until(() => events.some(event => event.method === 'turn/completed' && event.params.turn.id === dialogTurn.turn.id), 'dialog turn completed')
  await until(() => terminalOutput.includes('ACK_DIALOG_SECOND_COMPLETE'), 'dialog result visible in native TUI')
  report.checks.structuredToTui = true
  const planEvent = events.find(event => event.client === 'dialog' && event.method === 'turn/plan/updated' && event.params.turnId === dialogTurn.turn.id)
  assert(planEvent, 'Native update_plan emits structured plan notification')
  assert.equal(planEvent.params.threadId, threadId)
  assert.deepEqual(planEvent.params.plan, [
    { step: 'Inspect protocol', status: 'completed' }, { step: 'Display plan', status: 'inProgress' }, { step: 'Verify UI', status: 'pending' },
  ])
  report.checks.nativePlan = planEvent.params
  console.log('PASS native update_plan -> turn/plan/updated with thread identity and three states')
  const secondRequest = requests.find(request => request.tools?.length && JSON.stringify(request.input?.at(-1)).includes('DIALOG_SECOND'))
  assert(JSON.stringify(secondRequest?.input).includes('TERMINAL_FIRST'))
  report.checks.previousContextRetained = true
  console.log('PASS structured input -> native TUI output, previous context retained')
  terminal.write('TERMINAL_THIRD')
  await delay(250)
  terminal.write('\r')
  await until(() => complete('TERMINAL_THIRD'), 'return to native TUI input')
  await until(() => events.filter(event => event.method === 'turn/completed').length >= 4, 'third turn completed')
  report.checks.returnToTui = true
  for (const marker of ['TOOL_COMMAND', 'TOOL_FILE']) {
    const turn = await observer.call('turn/start', { threadId, input: [{ type: 'text', text: marker, text_elements: [] }] })
    const approval = await until(() => events.find(event => event.client === 'dialog' && event.id !== undefined && event.method?.endsWith('/requestApproval') && event.params?.turnId === turn.turn.id), `${marker} approval`)
    report.checks[`${marker}Approval`] = approval.method
    observer.send({ id: approval.id, result: { decision: 'accept' } })
    await until(() => events.some(event => event.client === 'dialog' && event.method === 'turn/completed' && event.params.turn.id === turn.turn.id), `${marker} completion`)
    const expectedType = marker === 'TOOL_COMMAND' ? 'commandExecution' : 'fileChange'
    const completed = events.find(event => event.client === 'dialog' && event.method === 'item/completed' && event.params.turnId === turn.turn.id && event.params.item.type === expectedType)
    assert(completed, `${expectedType} structured result`)
    assert.equal(completed.params.item.status, 'completed')
    if (expectedType === 'commandExecution') {
      assert.equal(completed.params.item.exitCode, 0)
      assert(completed.params.item.aggregatedOutput.includes('JANUSX_COMMAND_OK'))
    } else {
      assert(completed.params.item.changes.some(change => path.resolve(change.path) === path.join(workspace, 'result.html') && change.diff.includes('JANUSX_ARTIFACT_OK')))
    }
    await until(() => events.some(event => event.client === 'dialog' && event.method === 'serverRequest/resolved' && event.params.requestId === approval.id), `${marker} approval resolved`)
    report.checks[`${marker}Result`] = completed.params.item
    console.log(`PASS ${expectedType} approval and structured result`)
  }
  assert((await readFile(path.join(workspace, 'result.html'), 'utf8')).includes('JANUSX_ARTIFACT_OK'))
  report.checks.artifactOnDisk = true
  const slow = await observer.call('turn/start', { threadId, input: [{ type: 'text', text: 'SLOW_CANCEL', text_elements: [] }] })
  await until(() => pendingSlowResponse, 'held streaming response')
  await until(() => events.some(event => event.client === 'dialog' && event.method === 'item/agentMessage/delta' && event.params.turnId === slow.turn.id), 'streaming text delta')
  report.checks.streamingDelta = true
  observer.socket.terminate()
  const reconnect = await Rpc.connect(endpoint, 'reconnect')
  const resumed = await reconnect.call('thread/resume', { threadId })
  assert.equal(resumed.thread.id, threadId)
  report.checks.attachWhileRunning = true
  observer = reconnect
  await reconnect.call('turn/interrupt', { threadId, turnId: slow.turn.id })
  await until(() => events.some(event => event.method === 'turn/completed' && event.params.turn.id === slow.turn.id && event.params.turn.status === 'interrupted'), 'interrupt acknowledgement')
  pendingSlowResponse.res.destroy()
  report.checks.structuredInterrupt = true
  const loaded = await observer.call('thread/loaded/list')
  report.loaded = loaded
  const history = await observer.call('thread/read', { threadId, includeTurns: true })
  report.history = history
  const userMessages = history.thread.turns.flatMap(turn => turn.items.filter(item => item.type === 'userMessage').flatMap(item => item.content.filter(part => part.type === 'text').map(part => part.text)))
  assert.deepEqual(userMessages, ['BOOTSTRAP', 'TERMINAL_FIRST', 'DIALOG_SECOND', 'TERMINAL_THIRD', 'TOOL_COMMAND', 'TOOL_FILE', 'SLOW_CANCEL'])
  report.checks.oneConversationHistory = true
  report.auxiliaryThreads = []
  for (const id of loaded.data.filter(id => id !== threadId)) {
    const auxiliary = (await observer.call('thread/read', { threadId: id })).thread
    assert.equal(auxiliary.ephemeral, true)
    assert.equal(auxiliary.threadSource, 'thread_title')
    report.auxiliaryThreads.push({ id, ephemeral: auxiliary.ephemeral, threadSource: auxiliary.threadSource })
  }
  report.checks.auxiliaryThreadsAreTitles = true
  assert.equal(backend.exitCode, null)
  assert.equal(terminal.pid, report.tuiPid)
  assert.equal(report.tuiExit, undefined)
  report.checks.sameProcesses = true
  report.eventMethods = [...new Set(events.map(event => event.method).filter(Boolean))]
  report.modelRequests = requests.length
  report.status = 'passed'
  assert.equal(report.fixtureError, undefined)
} catch (error) {
  report.status = 'failed'
  report.error = error.stack
  process.exitCode = 1
} finally {
  for (const client of clients) client.socket.terminate()
  for (const socket of proxySockets) socket.terminate()
  if (proxy) await new Promise(resolve => proxy.close(resolve))
  if (terminal && !report.tuiExit) { try { terminal.kill() } catch {} }
  if (backend && backend.exitCode === null) backend.kill()
  model.closeAllConnections()
  await new Promise(resolve => model.close(resolve))
  await Promise.all([
    writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)),
    writeFile(path.join(root, 'events.json'), JSON.stringify(events, null, 2)),
    writeFile(path.join(root, 'requests.json'), JSON.stringify(requests, null, 2)),
    writeFile(path.join(root, 'tui-rpc.json'), JSON.stringify(tuiWire, null, 2)),
    writeFile(path.join(root, 'terminal.txt'), terminalOutput),
    writeFile(path.join(root, 'backend.txt'), backendOutput),
  ])
  console.log(JSON.stringify({ status: report.status, checks: report.checks, error: report.error, report: path.join(root, 'report.json') }, null, 2))
  // ConPTY's native pipe handles can outlive kill(); all evidence is flushed above.
  process.exit(process.exitCode ?? 0)
}
