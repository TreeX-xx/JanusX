// Isolated native command/skill probes. No user credentials or production model.
// Note: .agents/notes/workbench/terminal-dialog-dual-mode.md
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { createConnection } from 'node:net'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import assert from 'node:assert/strict'

const npm = path.join(process.env.APPDATA, 'npm/node_modules')
const bins = {
  codex: path.join(npm, '@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe'),
  claude: path.join(npm, '@anthropic-ai/claude-code/bin/claude.exe'),
  opencode: path.join(npm, '@opencode/cli/bin/opencode.exe'),
  pi: path.join(npm, '@earendil-works/pi-coding-agent/dist/bundle/cli.js'),
}
const artifacts = path.resolve('artifacts/slash-command-probe', `${Date.now()}`)
await mkdir(artifacts, { recursive: true })
const report = { started: new Date().toISOString(), limitations: ['Windows installed versions only; isolated fixtures, not product UI acceptance.', 'Model transport is localhost only.'], engines: {} }
async function put(file, text) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, text) }
async function wait(fn, label, ms = 20000) {
  const end = Date.now() + ms
  while (Date.now() < end) { const result = await fn(); if (result) return result; await delay(40) }
  throw new Error(`Timeout: ${label}`)
}
async function fixture(engine) {
  const root = await mkdtemp(path.join(tmpdir(), `janus-slash-${engine}-`))
  const cwd = path.join(root, 'workspace'), config = path.join(root, 'config')
  await mkdir(cwd); await mkdir(config)
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(path|systemroot|windir|comspec|temp|tmp|pathext|programfiles.*)$/i.test(k)))
  Object.assign(env, { HOME: root, USERPROFILE: root, APPDATA: path.join(root, 'roaming'), LOCALAPPDATA: path.join(root, 'local'), XDG_CONFIG_HOME: config,
    XDG_DATA_HOME: path.join(root, 'data'), XDG_STATE_HOME: path.join(root, 'state'), CODEX_HOME: config, CLAUDE_CONFIG_DIR: config, PI_CODING_AGENT_DIR: config,
    NO_PROXY: 'localhost,127.0.0.1', TERM: 'xterm-256color', DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' })
  const requests = [], children = []
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const bytes of req) raw += bytes
    if (raw) requests.push({ url: req.url, body: JSON.parse(raw) })
    if (req.url === '/ready') { res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}'); return }
    if (req.url.includes('count_tokens')) { res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"input_tokens":10}'); return }
    // Stop before tool/model execution; outbound payload still proves native expansion.
    res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { type: 'invalid_request_error', message: 'Probe captured payload; intentional stop' } }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  const version = execFileSync(engine === 'pi' ? process.execPath : bins[engine], engine === 'pi' ? [bins.pi, '--version'] : ['--version'], { env, encoding: 'utf8', windowsHide: true }).trim()
  const result = report.engines[engine] = { version, root, checks: {} }
  function launch(args) {
    const child = spawn(engine === 'pi' ? process.execPath : bins[engine], engine === 'pi' ? [bins.pi, ...args] : args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    children.push(child)
    const messages = []; let raw = '', stderr = '', stdout = ''
    child.stdout.on('data', bytes => { stdout += bytes; raw += bytes; const lines = raw.split('\n'); raw = lines.pop(); for (const line of lines) { try { messages.push(JSON.parse(line)) } catch {} } })
    child.stderr.on('data', bytes => { stderr += bytes })
    child.on('error', e => { stderr += String(e) })
    child.stdin.on('error', () => {})
    return { child, messages, log: () => ({ stdout, stderr }), send: value => child.stdin.write(JSON.stringify(value) + '\n') }
  }
  return { root, cwd, config, env, requests, url, result, launch, async close() {
    for (const child of children) {
      if (child.exitCode === null) { const done = new Promise(resolve => child.once('exit', resolve)); child.kill(); await Promise.race([done, delay(3000)]) }
    }
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
    await writeFile(path.join(artifacts, `${engine}-requests.json`), JSON.stringify(requests, null, 2))
  } }
}
async function codex(f) {
  const skill = path.join(f.cwd, '.agents/skills/probe-skill/SKILL.md')
  await put(skill, '---\nname: probe-skill\ndescription: Probe skill\n---\nCODEX_SKILL_BODY_MARKER')
  await put(path.join(f.cwd, '.agents/skills/probe-skill/agents/openai.yaml'), 'interface:\n  display_name: Probe Display\n  short_description: Probe short description\n  icon_small: ./assets/icon.svg\n')
  await put(path.join(f.cwd, '.agents/skills/probe-skill/assets/icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="6"/></svg>')
  await put(path.join(f.config, 'config.toml'), `model="gpt-5.4"\nmodel_provider="local"\ncheck_for_update_on_startup=false\n[model_providers.local]\nname="Probe"\nbase_url="${f.url}/v1"\nwire_api="responses"\nrequires_openai_auth=false\n`)
  const p = f.launch(['app-server']); let id = 0
  const call = async (method, params) => { const n = ++id; p.send({ id: n, method, params }); const r = await wait(() => p.messages.find(m => m.id === n), method); if (r.error) throw new Error(JSON.stringify(r.error)); return r.result }
  await call('initialize', { clientInfo: { name: 'slash_probe', version: '1' }, capabilities: { experimentalApi: true } }); p.send({ method: 'initialized' })
  f.result.checks.catalog = await call('skills/list', { cwds: [f.cwd], forceReload: true })
  assert(JSON.stringify(f.result.checks.catalog).includes('probe-skill'))
  const found = f.result.checks.catalog.data.flatMap(row => row.skills).find(row => row.name === 'probe-skill')
  assert.equal(found.interface.displayName, 'Probe Display')
  assert(found.interface.iconSmall.endsWith('icon.svg'))
  await put(path.join(f.cwd, '.agents/skills/late-skill/SKILL.md'), '---\nname: late-skill\ndescription: Reload probe\n---\nLATE_SKILL')
  assert(JSON.stringify(await call('skills/list', { cwds: [f.cwd], forceReload: true })).includes('late-skill'))
  f.result.checks.forceReload = true
  const thread = await call('thread/start', { cwd: f.cwd, model: 'gpt-5.4', modelProvider: 'local', approvalPolicy: 'never', sandbox: 'read-only' })
  await call('turn/start', { threadId: thread.thread.id, input: [{ type: 'text', text: '$probe-skill Probe argument' }, { type: 'skill', name: 'probe-skill', path: skill }] })
  await wait(() => f.requests.some(r => JSON.stringify(r.body).includes('CODEX_SKILL_BODY_MARKER')), 'Codex expanded skill')
  f.result.checks.expandedSkillInModelPayload = true
}
async function claude(f) {
  f.env.ANTHROPIC_API_KEY = 'probe-local-only'; f.env.ANTHROPIC_BASE_URL = f.url
  await put(path.join(f.config, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, autoUpdates: false,
    projects: { [f.cwd]: { hasTrustDialogAccepted: true }, [f.cwd.replaceAll('\\', '/')]: { hasTrustDialogAccepted: true } },
    customApiKeyResponses: { approved: [f.env.ANTHROPIC_API_KEY], rejected: [] } }))
  await put(path.join(f.cwd, '.claude/skills/probe-skill/SKILL.md'), '---\nname: probe-skill\ndescription: Probe skill\n---\nCLAUDE_SKILL_BODY_MARKER $ARGUMENTS')
  await put(path.join(f.cwd, '.claude/skills/hidden-skill/SKILL.md'), '---\nname: hidden-skill\ndescription: Hidden probe\nuser-invocable: false\n---\nHIDDEN_BODY')
  const p = f.launch(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--tools', '', '--setting-sources', 'project'])
  p.send({ type: 'control_request', request_id: 'init', request: { subtype: 'initialize' } })
  const initialized = await wait(() => p.messages.find(m => m.type === 'control_response'), 'Claude initialize')
  f.result.checks.initialize = initialized
  assert(JSON.stringify(initialized).includes('probe-skill'))
  const commands = initialized.response.response.commands
  assert(!commands.some(command => command.name === 'hidden-skill'))
  f.result.checks.hiddenSkillExcluded = true
  p.send({ type: 'user', message: { role: 'user', content: '/probe-skill ARGUMENT_MARKER' } })
  await wait(() => f.requests.some(r => JSON.stringify(r.body).includes('CLAUDE_SKILL_BODY_MARKER')), 'Claude skill expansion')
  f.result.checks.expandedSkillInModelPayload = true
  // Verify the same version-specific daemon reply transport used by JanusX.
  await put(path.join(f.config, 'settings.json'), JSON.stringify({ env: { ANTHROPIC_API_KEY: f.env.ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL: f.url, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1' }, hooks: { SessionStart: [{ hooks: [{ type: 'http', url: `${f.url}/ready`, timeout: 5 }] }] } }))
  try {
    const background = f.launch(['--bg', '--tools', '', '--settings', path.join(f.config, 'settings.json')])
    const short = await wait(() => /backgrounded\s*·\s*([a-f0-9]+)/.exec(background.log().stdout)?.[1], 'Claude background').catch(error => { f.result.checks.backgroundLog = background.log(); throw error })
    f.result.checks.backgroundJob = short
    const nonce = (await readFile(path.join(f.config, 'daemon/pipe.key'), 'utf8')).trim()
    const auth = (await readFile(path.join(f.config, 'daemon/control.key'), 'utf8')).trim()
    const control = value => new Promise((resolve, reject) => {
      const socket = createConnection(`\\\\.\\pipe\\cc-daemon-${nonce}-control`); let buffer = ''
      const timer = setTimeout(() => { socket.destroy(); reject(new Error('Daemon timeout')) }, 8000)
      socket.on('error', e => { clearTimeout(timer); reject(e) })
      socket.on('connect', () => socket.write(JSON.stringify({ proto: 1, auth, ...value }) + '\n'))
      socket.on('data', bytes => { buffer += bytes; if (buffer.includes('\n')) { clearTimeout(timer); socket.destroy(); resolve(JSON.parse(buffer.split('\n')[0])) } })
    })
    // Probe-only readiness: an empty native background session need not fire
    // the settings SessionStart HTTP hook before its first prompt.
    await wait(async () => {
      const log = f.launch(['logs', short])
      await wait(() => log.child.exitCode !== null, 'Claude readiness log')
      f.result.checks.backgroundLog = log.log()
      return log.log().stdout.includes('❯')
    }, 'Claude native input ready')
    f.result.checks.daemonReply = await control({ op: 'reply', short, text: '/probe-skill DAEMON_ARGUMENT_MARKER', nextTurn: true })
    const request = await wait(() => f.requests.find(r => JSON.stringify(r.body).includes('DAEMON_ARGUMENT_MARKER')), 'Claude daemon request')
    assert(!JSON.stringify(request.body).includes('CLAUDE_SKILL_BODY_MARKER'), 'Revisit daemon behavior if native expansion becomes supported')
    assert(JSON.stringify(request.body).includes('/probe-skill DAEMON_ARGUMENT_MARKER'))
    f.result.checks.daemonExpandedSkillInModelPayload = false
    f.result.checks.daemonForwardsSlashAsPlainText = true
  } finally {
    if (f.result.checks.backgroundJob) {
      const log = f.launch(['logs', f.result.checks.backgroundJob])
      await wait(() => log.child.exitCode !== null, 'Claude job logs').catch(() => {})
      f.result.checks.backgroundLog = log.log()
    }
    // This command uses only the fresh CLAUDE_CONFIG_DIR created by this probe.
    const cleanup = f.launch(['daemon', 'stop', '--any'])
    await wait(() => cleanup.child.exitCode !== null, 'Isolated daemon cleanup')
    f.result.checks.daemonCleanup = cleanup.child.exitCode
    assert.equal(cleanup.child.exitCode, 0)
  }
}
async function opencode(f) {
  f.env.OPENCODE_SERVER_PASSWORD = 'isolated-probe'
  f.env.OPENCODE_TEST_HOME = f.root
  f.env.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS = '1'
  f.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ model: 'fixture/fixture', update: 'disable', share: 'disabled', snapshots: false, providers: { fixture: { package: '@ai-sdk/openai-compatible', settings: { baseURL: `${f.url}/v1`, apiKey: 'fixture' }, models: { fixture: { limit: { context: 32000, output: 1000 }, capabilities: { input: ['text'], output: ['text'], tools: false } } } } } })
  await put(path.join(f.cwd, '.opencode/commands/team/review.md'), '---\ndescription: Probe command\n---\nOPENCODE_COMMAND_BODY_MARKER $ARGUMENTS')
  await put(path.join(f.cwd, '.opencode/skills/probe-skill/SKILL.md'), '---\nname: Probe Skill\ndescription: Probe skill\n---\nOPENCODE_SKILL_BODY_MARKER')
  const p = f.launch(['serve', '--hostname', '127.0.0.1', '--port', '0'])
  const endpoint = await wait(() => /http:\/\/127\.0\.0\.1:\d+/.exec(p.log().stdout + p.log().stderr)?.[0], 'OpenCode server')
  const headers = { Authorization: `Basic ${Buffer.from('opencode:isolated-probe').toString('base64')}`, 'Content-Type': 'application/json' }
  const created = await fetch(endpoint + '/api/session', { method: 'POST', headers, body: JSON.stringify({ location: { directory: f.cwd } }) }).then(r => r.json())
  f.result.checks.created = created
  for (const route of ['/api/location', '/api/debug/location', '/api/config', '/openapi.json', '/api/command', '/api/skill']) {
    const response = await fetch(endpoint + route + `?location[directory]=${encodeURIComponent(f.cwd)}`, { headers }); const text = await response.text()
    try { f.result.checks[route] = { status: response.status, data: JSON.parse(text) } } catch { f.result.checks[route] = { status: response.status, sample: text.slice(0, 100) } }
  }
  await wait(async () => {
    for (const route of ['/api/command', '/api/skill']) {
      const response = await fetch(endpoint + route + `?location[directory]=${encodeURIComponent(f.cwd)}`, { headers })
      f.result.checks[route] = { status: response.status, data: await response.json() }
    }
    return JSON.stringify(f.result.checks['/api/command']).includes('team/review') && JSON.stringify(f.result.checks['/api/skill']).includes('probe-skill')
  }, 'OpenCode directory load')
  assert(JSON.stringify(f.result.checks['/api/command']).includes('team/review'), 'Nested command discovered')
  assert(JSON.stringify(f.result.checks['/api/skill']).includes('probe-skill'), 'Skill discovered')
  const response = await fetch(endpoint + `/api/session/${created.data.id}/command`, { method: 'POST', headers, body: JSON.stringify({ name: 'team/review', text: 'ARGUMENT_MARKER' }) })
  f.result.checks.commandStatus = response.status
  assert.equal(response.status, 204)
  await wait(() => f.requests.some(r => JSON.stringify(r.body).includes('OPENCODE_COMMAND_BODY_MARKER ARGUMENT_MARKER')), 'OpenCode command expansion')
  f.result.checks.expandedCommandInModelPayload = true
  const fresh = await fetch(endpoint + '/api/session', { method: 'POST', headers, body: JSON.stringify({ location: { directory: f.cwd } }) }).then(r => r.json())
  const count = f.requests.length
  const skillResponse = await fetch(endpoint + `/api/session/${fresh.data.id}/prompt`, { method: 'POST', headers, body: JSON.stringify({ text: 'EXPLICIT_SKILL_ARGUMENT', skills: [{ id: 'probe-skill' }] }) })
  assert.equal(skillResponse.status, 200)
  await wait(() => f.requests.slice(count).some(r => JSON.stringify(r.body).includes('OPENCODE_SKILL_BODY_MARKER')), 'OpenCode skill attachment expansion')
  f.result.checks.expandedSkillAttachmentInModelPayload = true
}
async function pi(f) {
  await put(path.join(f.config, 'models.json'), JSON.stringify({ providers: { fixture: { baseUrl: `${f.url}/v1`, api: 'openai-completions', apiKey: 'fixture', models: [{ id: 'fixture', contextWindow: 32000, maxTokens: 1000 }] } } }))
  await put(path.join(f.config, 'skills/probe-skill/SKILL.md'), '---\nname: probe-skill\ndescription: Probe skill\n---\nPI_SKILL_BODY_MARKER')
  await put(path.join(f.config, 'prompts/probe-template.md'), '---\ndescription: Probe template\n---\nPI_TEMPLATE_BODY_MARKER $ARGUMENTS')
  const extension = path.join(f.root, 'probe-extension.mjs')
  await put(extension, `import { writeFileSync } from 'node:fs'; export default pi => {
    pi.registerCommand('probe-extension', { description: 'Probe extension', handler: async args => { writeFileSync(${JSON.stringify(path.join(f.root, 'extension-result.txt'))}, args) } });
    pi.registerCommand('probe-raw', { handler: async () => pi.sendUserMessage('/skill:probe-skill RAW_ARGUMENT') });
    pi.registerCommand('probe-expanded', { handler: async () => pi.sendUserMessage('/skill:probe-skill EXPANDED_ARGUMENT', { expandPromptTemplates: true }) });
    pi.on('session_start', () => writeFileSync(${JSON.stringify(path.join(f.root, 'extension-catalog.json'))}, JSON.stringify(pi.getCommands())));
  }`)
  const p = f.launch(['--mode', 'rpc', '--provider', 'fixture', '--model', 'fixture', '--no-session', '--extension', extension])
  let id = 0
  const call = async (type, fields = {}) => { const n = String(++id); p.send({ id: n, type, ...fields }); return wait(() => p.messages.find(m => m.id === n), type) }
  f.result.checks.catalog = await call('get_commands')
  assert(JSON.stringify(f.result.checks.catalog).includes('skill:probe-skill'))
  await call('prompt', { message: '/probe-extension ARGUMENT_MARKER' })
  assert.equal(await readFile(path.join(f.root, 'extension-result.txt'), 'utf8'), 'ARGUMENT_MARKER')
  f.result.checks.extensionDispatched = true
  await call('prompt', { message: '/skill:probe-skill ARGUMENT_MARKER' })
  await wait(() => f.requests.some(r => JSON.stringify(r.body).includes('PI_SKILL_BODY_MARKER')), 'Pi skill expansion')
  f.result.checks.expandedSkillInModelPayload = true
  for (const [command, marker] of [['/probe-template TEMPLATE_ARGUMENT', 'PI_TEMPLATE_BODY_MARKER'], ['/probe-raw', 'RAW_ARGUMENT'], ['/probe-expanded', 'EXPANDED_ARGUMENT']]) {
    const next = f.launch(['--mode', 'rpc', '--provider', 'fixture', '--model', 'fixture', '--no-session', '--extension', extension])
    next.send({ id: 'ready', type: 'get_commands' }); await wait(() => next.messages.find(m => m.id === 'ready'), 'Pi ready')
    const baseline = f.requests.length
    next.send({ id: 'send', type: 'prompt', message: command })
    const request = await wait(() => f.requests.slice(baseline).find(r => JSON.stringify(r.body).includes(marker)), `Pi ${command}`)
    const user = [...request.body.messages].reverse().find(m => m.role === 'user')
    if (command === '/probe-raw') assert(!JSON.stringify(user).includes('PI_SKILL_BODY_MARKER'))
    if (command === '/probe-expanded') assert(JSON.stringify(user).includes('PI_SKILL_BODY_MARKER'))
    f.result.checks[command] = { lastUser: user }
  }
  f.result.checks.extensionCatalog = JSON.parse(await readFile(path.join(f.root, 'extension-catalog.json'), 'utf8'))
}
for (const engine of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(bins)) {
  const f = await fixture(engine)
  try {
    assert.equal(f.result.version, { codex: 'codex-cli 0.166.0', claude: '2.1.316 (Claude Code)', opencode: 'opencode v2.1.4', pi: '0.85.1' }[engine], 'Review probe contract for another installed version')
    await ({ codex, claude, opencode, pi })[engine](f); f.result.status = 'passed'
  }
  catch (error) { f.result.status = 'failed'; f.result.error = String(error); process.exitCode = 1 }
  finally { await f.close(); console.log(engine, f.result.status, f.result.error ?? '') }
}
await writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2))
console.log('Report:', path.join(artifacts, 'report.json'))
