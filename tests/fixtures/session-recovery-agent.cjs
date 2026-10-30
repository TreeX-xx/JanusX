// A local CLI fixture: read the child-selected store and keep provider identity.
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const engine = process.argv[2]
const args = process.argv.slice(3)
if (args.includes('--version')) { console.log(engine === 'opencode' ? '2.1.4' : '0.165.0'); process.exit(0) }
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'recovery-manifest.json'), 'utf8'))
const source = manifest[engine]
const env = process.env
const terminalId = env.JANUSX_HOOK_TERMINAL_ID
const resumed = args.includes('--resume') || args.includes('resume') || args.includes('--session')
let transcriptPath = source.transcriptPath
if (resumed && engine === 'claude') transcriptPath = path.join(env.CLAUDE_CONFIG_DIR, 'projects', 'repo', source.id + '.jsonl')
if (resumed && engine === 'codex') transcriptPath = path.join(env.CODEX_HOME, 'sessions', '2026', 'rollout-date-' + source.id + '.jsonl')
if (engine === 'opencode') transcriptPath = path.join(env.XDG_DATA_HOME, 'opencode', 'opencode.db')
function database() {
  const db = new (require('node:sqlite').DatabaseSync)(transcriptPath)
  db.exec('PRAGMA busy_timeout = 5000')
  return db
}
function storedHistory() {
  if (engine !== 'opencode') return fs.readFileSync(transcriptPath, 'utf8')
  const db = database()
  try { return JSON.stringify(db.prepare('SELECT data FROM part WHERE session_id = ?').all(source.id)) }
  finally { db.close() }
}
const hooksPath = engine === 'claude' ? args[args.indexOf('--settings') + 1]
  : engine === 'opencode' ? path.join(JSON.parse(env.OPENCODE_CONFIG_CONTENT).plugins.at(-1), 'server.js') : undefined
const hooksInstalled = engine === 'codex' ? args.some(arg => arg.startsWith('hooks=')) : fs.existsSync(hooksPath)
fs.writeFileSync(path.join(__dirname, 'launch-' + terminalId + '.json'), JSON.stringify({
  args, cwd: process.cwd(), transcriptPath, history: resumed ? storedHistory() : '', hooksInstalled, hooksPath,
}))
function hook(event, prompt) {
  const body = JSON.stringify({ source: engine, event, terminalId, workspaceId: env.JANUSX_HOOK_WORKSPACE_ID,
    sessionId: source.id, cwd: process.cwd(), message: prompt, timestamp: new Date().toISOString(),
    raw: { transcript_path: transcriptPath, thread_id: engine === 'codex' ? source.id : undefined, status: 'busy' },
  })
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: env.JANUSX_HOOK_PORT, path: '/api/agent-hook', method: 'POST',
      headers: { Authorization: 'Bearer ' + env.JANUSX_HOOK_TOKEN, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => { res.resume(); res.on('end', () => res.statusCode === 200 ? resolve() : reject(new Error('Hook HTTP ' + res.statusCode))) })
    req.on('error', reject); req.end(body)
  })
}
function appendTurn(prompt) {
  const answer = 'answer to ' + prompt
  if (engine === 'claude') fs.appendFileSync(transcriptPath, [
    { type: 'user', sessionId: source.id, cwd: process.cwd(), message: { role: 'user', content: prompt } },
    { type: 'assistant', sessionId: source.id, message: { role: 'assistant', content: [{ type: 'text', text: answer }] } },
  ].map(JSON.stringify).join('\n') + '\n')
  else if (engine === 'codex') fs.appendFileSync(transcriptPath, [
    { type: 'response_item', payload: { role: 'user', content: [{ type: 'input_text', text: prompt }] } },
    { type: 'response_item', payload: { role: 'assistant', content: [{ type: 'output_text', text: answer }] } },
  ].map(JSON.stringify).join('\n') + '\n')
  else {
    const db = database()
    const now = Date.now()
    for (const [role, text, offset] of [['user', prompt, 0], ['assistant', answer, 1]]) {
      const id = terminalId + '-' + now + '-' + role
      db.prepare('INSERT INTO message VALUES (?, ?, ?, ?)').run(id, source.id, now + offset, JSON.stringify({ role }))
      db.prepare('INSERT INTO part VALUES (?, ?, ?, ?, ?)').run(id, id, source.id, now + offset, JSON.stringify({ type: 'text', text }))
    }
    db.close()
  }
}
let pending = ''
let sequence = Promise.resolve()
process.stdin.on('data', (chunk) => {
  const input = chunk.toString('utf8')
  fs.appendFileSync(path.join(__dirname, 'input-' + terminalId + '.txt'), input)
  pending += input
  const lines = pending.split(/[\r\n]+/); pending = lines.pop()
  for (const prompt of lines.filter(Boolean)) sequence = sequence.then(async () => {
    await hook(engine === 'opencode' ? 'session.status' : 'UserPromptSubmit', prompt)
    appendTurn(prompt)
    await hook(engine === 'opencode' ? 'session.idle' : 'Stop')
    process.stdout.write('turn done> ')
  }).catch((err) => fs.writeFileSync(path.join(__dirname, 'error-' + terminalId + '.txt'), String(err)))
})
process.stdout.write('\u001b[?2004hready> ')
setInterval(() => {}, 1000)
