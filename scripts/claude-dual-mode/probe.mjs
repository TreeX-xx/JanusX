// Windows Claude native-TUI / structured-transport feasibility probe.
// Uses a disposable home and localhost-only Messages fixture; never reads user credentials.
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { createConnection } from 'node:net'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import pty from 'node-pty'

assert.equal(process.platform, 'win32', 'This probe validates Windows ConPTY only.')
const bin = process.env.JANUSX_TEST_CLAUDE_BIN ?? path.join(process.env.APPDATA, 'npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe')
const root = await mkdtemp(path.join(tmpdir(), 'janusx-claude-dual-'))
const workspace = path.join(root, 'workspace')
const config = path.join(root, 'config')
for (const directory of [workspace, config]) await mkdir(directory, { recursive: true })
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
})
await writeFile(path.join(config, '.claude.json'), JSON.stringify({
  hasCompletedOnboarding: true, theme: 'dark', autoUpdates: false,
  customApiKeyResponses: { approved: ['janusx-local-probe-only'], rejected: [] },
  projects: { [workspace]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } },
}))
await writeFile(path.join(config, 'settings.json'), JSON.stringify({
  permissions: { defaultMode: 'default' }, skipDangerousModePermissionPrompt: false,
}))

const report = {
  version: execFileSync(bin, ['--version'], { env, encoding: 'utf8', windowsHide: true }).trim(),
  binarySha256: createHash('sha256').update(await readFile(bin)).digest('hex'),
  platform: process.platform, root, started: new Date().toISOString(),
  checks: {}, limitations: ['Local deterministic model only; no vendor credentials or cloud attach.', 'Protocol/TUI probe, not JanusX UI acceptance.'],
}
const version = report.version.split(' ')[0]
const artifacts = path.resolve('artifacts/claude-dual-mode', version)
await mkdir(artifacts, { recursive: true })
const requests = []
const rawRuns = []
const terminals = new Set()
const children = new Set()
const sockets = new Set()
const backgroundEvents = []
let backgroundShort
let messageNumber = 0
const server = createServer(async (req, res) => {
  const buffers = []
  for await (const buffer of req) buffers.push(buffer)
  let body
  try { body = JSON.parse(Buffer.concat(buffers).toString() || '{}') } catch { res.writeHead(400).end(); return }
  if (!req.url?.includes('/messages') || req.url.includes('count_tokens')) {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ input_tokens: 10, data: [] }))
    return
  }
  const text = JSON.stringify(body.messages ?? [])
  const markers = [...text.matchAll(/PROBE_(?:NATIVE_FIRST|SDK_SECOND|NATIVE_THIRD|SDK_BASELINE|BACKGROUND|BG_FIRST|BG_SECOND|BG_THIRD|BG_SLOW|BG_DETACHED)/g)].map(match => match[0])
  const number = ++messageNumber
  const observed = { number, url: req.url, model: body.model, markers: [...new Set(markers)], messages: body.messages, stream: body.stream, startedAt: Date.now() }
  requests.push(observed)
  const reply = `LOCAL_REPLY_${number}`
  const message = { id: `msg_probe_${number}`, type: 'message', role: 'assistant', model: body.model,
    content: [{ type: 'text', text: reply }], stop_reason: 'end_turn', stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 3 } }
  if (!body.stream) {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(message)); return
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  const event = (type, value) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`)
  event('message_start', { message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } })
  event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
  event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'LOCAL_' } })
  const latestText = JSON.stringify(body.messages?.at(-1))
  await delay(latestText.includes('PROBE_BG_SLOW') ? 1600 : 120)
  event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: `REPLY_${number}` } })
  event('content_block_stop', { index: 0 })
  event('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } })
  event('message_stop', {}); res.end(); observed.finishedAt = Date.now()
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`
const baseArgs = ['--model', 'claude-sonnet-4-6', '--tools', '', '--permission-mode', 'manual', '--setting-sources', 'user', '--strict-mcp-config']

function stripAnsi(value) {
  return value.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1b[=>]/g, '')
}
async function until(predicate, label, timeout = 25000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (predicate()) return
    await delay(50)
  }
  throw new Error(`Timeout: ${label}`)
}
function native(args, label) {
  const run = { label, args, output: '', exitCode: null, pid: null }
  const terminal = pty.spawn(bin, args, { cwd: workspace, env: { ...env }, cols: 130, rows: 36, name: 'xterm-256color' })
  run.pid = terminal.pid
  terminal.onData(data => { run.output += data })
  terminal.onExit(event => { run.exitCode = event.exitCode; terminals.delete(terminal) })
  terminals.add(terminal); rawRuns.push(run)
  return { terminal, run }
}
async function pipe(args, label, input, timeout = 15000) {
  const run = { label, args, output: '', stderr: '', exitCode: null, pid: null, timedOut: false }
  rawRuns.push(run)
  const child = spawn(bin, args, { cwd: workspace, env: { ...env }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  run.pid = child.pid; children.add(child)
  child.stdout.on('data', data => { run.output += data })
  child.stderr.on('data', data => { run.stderr += data })
  child.stdin.on('error', () => {})
  const timer = setTimeout(() => { run.timedOut = true; child.kill() }, timeout)
  child.stdin.end(input ?? '')
  await new Promise(resolve => child.on('exit', code => { run.exitCode = code; children.delete(child); clearTimeout(timer); resolve() }))
  return run
}
async function validation(args, label) {
  const { terminal, run } = native(args, label)
  await until(() => run.exitCode !== null, `${label} exits`, 10000).catch(() => {})
  if (run.exitCode === null) { run.timedOut = true; terminal.kill(); await delay(200) }
  report.checks[label] = { exitCode: run.exitCode, timedOut: Boolean(run.timedOut), output: stripAnsi(run.output).slice(-2500) }
  console.log(label, JSON.stringify(report.checks[label]))
}
async function control(message, subscribe = false) {
  const nonce = (await readFile(path.join(config, 'daemon/pipe.key'), 'utf8')).trim()
  const auth = (await readFile(path.join(config, 'daemon/control.key'), 'utf8')).trim()
  return new Promise((resolve, reject) => {
    const socket = createConnection(`\\\\.\\pipe\\cc-daemon-${nonce}-control`)
    sockets.add(socket)
    let buffer = '', replied = false
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('daemon control timeout')) }, 8000)
    socket.on('error', error => { clearTimeout(timer); reject(error) })
    socket.on('close', () => sockets.delete(socket))
    socket.on('connect', () => socket.write(`${JSON.stringify({ proto: 1, ...message, auth })}\n`))
    socket.on('data', bytes => {
      buffer += bytes.toString()
      let end
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
        if (!line) continue
        let value
        try { value = JSON.parse(line) } catch { continue }
        if (subscribe) backgroundEvents.push({ at: Date.now(), ...value })
        if (!replied) {
          replied = true; clearTimeout(timer)
          resolve(value)
          if (!subscribe) socket.destroy()
        }
      }
    })
  })
}
async function findTranscript(sessionId) {
  const search = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const target = path.join(directory, entry.name)
      if (entry.isFile() && entry.name === `${sessionId}.jsonl`) return target
      if (entry.isDirectory()) { const found = await search(target); if (found) return found }
    }
  }
  return search(path.join(config, 'projects'))
}

try {
  assert.ok(['2.1.314', '2.1.316'].includes(version), 'Review private daemon protocol before testing another CLI version.')
  console.log('probe', report.version, root)
  await validation([...baseArgs, '--input-format', 'stream-json', '--output-format', 'stream-json'], 'structured_requires_print')
  await validation([...baseArgs, '--sdk-url', 'ws://127.0.0.1:9/probe'], 'sdk_url_native')
  await validation([...baseArgs, '--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--sdk-url', 'ws://127.0.0.1:9/probe'], 'sdk_url_local')
  await validation([...baseArgs, '--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--attach-serve', randomUUID()], 'attach_serve_local')
  await validation([...baseArgs, '--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--attach-serve', 'cse_janusx_local_probe'], 'attach_serve_cloud_gate')
  const bg = await pipe([...baseArgs, '--bg', 'PROBE_BACKGROUND'], 'background_local')
  report.checks.background_local = { exitCode: bg.exitCode, timedOut: bg.timedOut, output: `${bg.output}${bg.stderr}`.slice(-2500) }
  console.log('background_local', JSON.stringify(report.checks.background_local))

  const baseline = await pipe([...baseArgs, '--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--include-partial-messages', '--verbose'],
    'sdk_baseline', `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'PROBE_SDK_BASELINE' } })}\n`, 25000)
  const baselineEvents = baseline.output.split(/\r?\n/).flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } })
  report.checks.sdk_baseline = { exitCode: baseline.exitCode, timedOut: baseline.timedOut,
    streamEvents: baselineEvents.filter(event => event.type === 'stream_event').length,
    completed: baselineEvents.some(event => event.type === 'result' && !event.is_error),
    sessionId: baselineEvents.find(event => event.session_id)?.session_id,
  }
  assert.ok(report.checks.sdk_baseline.completed, `SDK baseline failed: ${baseline.stderr} ${baseline.output.slice(-1800)}`)

  const sessionId = randomUUID()
  const { terminal, run } = native([...baseArgs, '--session-id', sessionId], 'native_session')
  await until(() => /Sonnet|trust|API key|security|Welcome|workspace|folder|Safety/i.test(stripAnsi(run.output)), 'native startup')
  await delay(1000)
  // Only accept the generated fixture's own directory trust/key dialogs.
  if (/Yes,Itrustthisfolder|Yes,Itrustthisdirectory/.test(stripAnsi(run.output).replace(/\s/g, ''))) {
    terminal.write('\x1b[B'); await delay(150); terminal.write('\r'); await delay(1500)
  }
  if (/DoyouwanttousethisAPIkey|Yes,usethisAPIkey/.test(stripAnsi(run.output).replace(/\s/g, ''))) {
    terminal.write('\x1b[A'); await delay(150); terminal.write('\r'); await delay(1000)
  }
  if (/Makeautomodeyourdefaultpermissionmode/.test(stripAnsi(run.output).replace(/\s/g, ''))) {
    terminal.write('\x1b[B'); await delay(150); terminal.write('\r'); await delay(1000)
  }
  terminal.write('PROBE_NATIVE_FIRST')
  await delay(200); terminal.write('\r')
  await until(() => requests.some(request => request.markers.includes('PROBE_NATIVE_FIRST')), 'native first request')
  const first = requests.find(request => request.markers.includes('PROBE_NATIVE_FIRST'))
  await until(() => stripAnsi(run.output).includes(`REPLY_${first.number}`), 'native first reply')
  await delay(600)
  report.checks.native_baseline = { pid: run.pid, sessionId, request: first.number, completed: true }
  // The worker reads these fixture-only settings even if the supervisor scrubs inherited env.
  await writeFile(path.join(config, 'settings.json'), JSON.stringify({
    permissions: { defaultMode: 'manual' },
    env: { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1' },
  }))
  const trustedBg = await pipe([...baseArgs, '--bg', 'PROBE_BACKGROUND'], 'background_trusted')
  report.checks.background_trusted = { exitCode: trustedBg.exitCode, timedOut: trustedBg.timedOut, output: `${trustedBg.output}${trustedBg.stderr}`.slice(-2500) }
  console.log('background_trusted', JSON.stringify(report.checks.background_trusted))
  backgroundShort = /backgrounded\s*·\s*([a-f0-9]+)/.exec(trustedBg.output)?.[1]

  const resumed = await pipe([...baseArgs, '--resume', sessionId, '--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--include-partial-messages', '--verbose'],
    'resume_while_native_alive', `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'PROBE_SDK_SECOND' } })}\n`, 25000)
  const second = requests.find(request => request.markers.includes('PROBE_SDK_SECOND'))
  report.checks.resume_while_native_alive = { nativePid: run.pid, resumedPid: resumed.pid, nativeAlive: run.exitCode === null,
    exitCode: resumed.exitCode, timedOut: resumed.timedOut, request: second?.number,
    includesNativeHistory: second?.markers.includes('PROBE_NATIVE_FIRST') ?? false,
    output: `${resumed.stderr}\n${resumed.output}`.slice(-1500) }
  terminal.write('PROBE_NATIVE_THIRD'); await delay(200); terminal.write('\r')
  await until(() => requests.some(request => request.markers.includes('PROBE_NATIVE_THIRD')), 'native third request')
  const third = requests.find(request => request.markers.includes('PROBE_NATIVE_THIRD'))
  await until(() => stripAnsi(run.output).includes(`REPLY_${third.number}`), 'native third reply')
  report.checks.native_after_resume = { pid: run.pid, stillAlive: run.exitCode === null,
    includesFirst: third.markers.includes('PROBE_NATIVE_FIRST'), includesSdkSecond: third.markers.includes('PROBE_SDK_SECOND'), request: third.number }
  console.log('resume_while_native_alive', JSON.stringify({ ...report.checks.resume_while_native_alive, output: undefined }))
  console.log('native_after_resume', JSON.stringify(report.checks.native_after_resume))
  assert.ok(backgroundShort, 'Background dispatch must return an id')
  const listing = await pipe(['agents', '--json', '--all'], 'background_listing')
  const background = JSON.parse(listing.output).find(job => job.id === backgroundShort)
  assert.ok(background?.pid, 'Background session must have a live CLI pid')
  report.checks.background_identity = { short: backgroundShort, sessionId: background.sessionId, nativePid: background.pid }
  console.log('control_ping', JSON.stringify(await control({ op: 'ping' })))
  const snapshot = await control({ op: 'subscribe', short: backgroundShort, tail: 2 }, true)
  report.checks.background_subscription = { initialType: snapshot.type, streamTailType: typeof snapshot.streamTail }
  const attached = native(['attach', backgroundShort], 'background_attach')
  await until(() => requests.some(request => request.markers.includes('PROBE_BACKGROUND')), 'background initial request')
  await delay(1200)
  attached.terminal.write('PROBE_BG_FIRST'); await delay(200); attached.terminal.write('\r')
  await until(() => requests.some(request => request.markers.includes('PROBE_BG_FIRST')), 'background native request')
  const bgFirst = requests.find(request => request.markers.includes('PROBE_BG_FIRST'))
  await until(() => stripAnsi(attached.run.output).includes(`REPLY_${bgFirst.number}`), 'background native first reply')
  const reply = await control({ op: 'reply', short: backgroundShort, text: 'PROBE_BG_SECOND', nextTurn: true })
  report.checks.background_semantic_reply = { ack: reply }
  assert.ok(reply.ok, 'Semantic reply accepted by the daemon')
  await until(() => requests.some(request => request.markers.includes('PROBE_BG_SECOND')), 'background semantic request')
  const bgSecond = requests.find(request => request.markers.includes('PROBE_BG_SECOND'))
  await until(() => stripAnsi(attached.run.output).includes(`REPLY_${bgSecond.number}`), 'native displays semantic reply')
  attached.terminal.write('PROBE_BG_THIRD'); await delay(200); attached.terminal.write('\r')
  await until(() => requests.some(request => request.markers.includes('PROBE_BG_THIRD')), 'background native third request')
  const bgThird = requests.find(request => request.markers.includes('PROBE_BG_THIRD'))
  await until(() => stripAnsi(attached.run.output).includes(`REPLY_${bgThird.number}`), 'background native third reply')
  assert.ok(bgThird.markers.includes('PROBE_BG_SECOND'), 'Native request must include the semantic input')
  const transcript = await findTranscript(background.sessionId)
  assert.ok(transcript, 'Background session writes its native transcript')
  await control({ op: 'reply', short: backgroundShort, text: 'PROBE_BG_SLOW', nextTurn: true })
  await until(() => requests.some(request => request.markers.includes('PROBE_BG_SLOW')), 'background slow request')
  const slow = requests.find(request => request.markers.includes('PROBE_BG_SLOW'))
  let partialOnDisk = false
  while (!slow.finishedAt) {
    const text = await readFile(transcript, 'utf8')
    if (text.includes(`LOCAL_REPLY_${slow.number}`) || text.includes('"text":"LOCAL_"')) partialOnDisk = true
    await delay(40)
  }
  await delay(500)
  const after = await pipe(['agents', '--json', '--all'], 'background_identity_after')
  const identityAfter = JSON.parse(after.output).find(job => job.id === backgroundShort)
  report.checks.background_roundtrip = { sameNativePid: identityAfter?.pid === background.pid,
    sameSessionId: identityAfter?.sessionId === background.sessionId, includesFirst: bgSecond.markers.includes('PROBE_BG_FIRST'),
    includesSemanticInNative: bgThird.markers.includes('PROBE_BG_SECOND'), nativeSeesSemanticReply: true }
  report.checks.background_stream = { events: [...new Set(backgroundEvents.map(event => event.type))],
    hasAnsiInStream: backgroundEvents.some(event => event.type === 'stream' && /\x1b\[/.test(event.line ?? '')),
    hasStructuredTextDelta: backgroundEvents.some(event => event.type === 'stream_event' || event.type === 'text_delta'),
    partialOnDiskDuringStream: partialOnDisk,
    completedReplyOnDisk: (await readFile(transcript, 'utf8')).includes(`LOCAL_REPLY_${slow.number}`) }
  console.log('background_roundtrip', JSON.stringify(report.checks.background_roundtrip))
  console.log('background_stream', JSON.stringify(report.checks.background_stream))
  attached.terminal.write('\x1a') // Documented Ctrl+Z: detach, keeping the background native session alive.
  await until(() => attached.run.exitCode !== null, 'native attach detaches')
  const detachedReply = await control({ op: 'reply', short: backgroundShort, text: 'PROBE_BG_DETACHED', nextTurn: true })
  assert.ok(detachedReply.ok, 'Semantic input works while the native attach client is detached')
  await until(() => requests.some(request => request.markers.includes('PROBE_BG_DETACHED')), 'detached semantic request')
  const detachedRequest = requests.find(request => request.markers.includes('PROBE_BG_DETACHED'))
  await until(() => detachedRequest.finishedAt, 'detached response complete')
  const reattached = native(['attach', backgroundShort], 'background_reattach')
  await until(() => stripAnsi(reattached.run.output).includes(`REPLY_${detachedRequest.number}`), 'reattach replays detached response')
  const reattachedListing = await pipe(['agents', '--json', '--all'], 'background_identity_reattached')
  const reattachedIdentity = JSON.parse(reattachedListing.output).find(job => job.id === backgroundShort)
  report.checks.background_detach_reattach = { semanticInputWhileDetached: true, replaysDetachedReply: true,
    sameNativePid: reattachedIdentity?.pid === background.pid, sameSessionId: reattachedIdentity?.sessionId === background.sessionId,
    includesPriorInputs: ['PROBE_BG_FIRST', 'PROBE_BG_SECOND', 'PROBE_BG_THIRD'].every(marker => detachedRequest.markers.includes(marker)) }
  console.log('background_detach_reattach', JSON.stringify(report.checks.background_detach_reattach))
  assert.ok(Object.values(report.checks.background_roundtrip).every(Boolean))
  assert.ok(Object.values(report.checks.background_detach_reattach).every(Boolean))
  report.status = 'completed-with-limitations'
} catch (error) {
  report.error = error.stack ?? String(error)
  report.status = 'failed'
  process.exitCode = 1
  console.log('probe error', report.error)
} finally {
  for (const socket of sockets) socket.destroy()
  for (const terminal of terminals) {
    const run = rawRuns.find(candidate => candidate.pid === terminal.pid)
    try { terminal.write(run?.label === 'native_session' ? '/exit\r' : '\x1a') } catch {}
  }
  await until(() => terminals.size === 0, 'probe terminal clients exit', 2500).catch(() => {})
  for (const terminal of terminals) { try { terminal.kill() } catch {} }
  for (const child of children) { try { child.kill() } catch {} }
  if (backgroundShort) {
    const cleanup = await pipe(['daemon', 'stop', '--any'], 'background_cleanup')
    report.checks.background_cleanup = { exitCode: cleanup.exitCode, output: cleanup.output, error: cleanup.stderr }
    const nativePid = report.checks.background_identity?.nativePid
    if (nativePid) {
      let alive = true
      for (let attempt = 0; attempt < 40 && alive; attempt++) {
        try { process.kill(nativePid, 0) } catch { alive = false }
        if (alive) await delay(50)
      }
      report.checks.background_cleanup.nativeProcessGone = !alive
      if (alive || cleanup.exitCode !== 0) { report.status = 'failed'; process.exitCode = 1 }
    }
  }
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  report.finished = new Date().toISOString()
  await writeFile(path.join(artifacts, 'probe-report.json'), JSON.stringify(report, null, 2))
  await writeFile(path.join(artifacts, 'probe-runs.json'), JSON.stringify(rawRuns.map(run => ({ ...run, output: stripAnsi(run.output) })), null, 2))
  await writeFile(path.join(artifacts, 'probe-requests.json'), JSON.stringify(requests, null, 2))
  await writeFile(path.join(artifacts, 'probe-background-events.json'), JSON.stringify(backgroundEvents, null, 2))
  console.log('report', path.join(artifacts, 'probe-report.json'))
  // ConPTY native pipe handles may outlive kill(); evidence is flushed first.
  process.exit(process.exitCode ?? 0)
}
