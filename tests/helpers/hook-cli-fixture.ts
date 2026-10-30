import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Local-only models: no credentials or provider network access in CLI acceptance. */
export async function hookCliFixture() {
  const root = await mkdtemp(join(tmpdir(), 'janusx-hook-cli-'))
  const home = join(root, "home space's 中文")
  const cwd = join(root, "workspace space's 中文")
  for (const path of [home, cwd, join(home, '.codex'), join(home, '.claude')]) await mkdir(path, { recursive: true })
  const env: NodeJS.ProcessEnv = {}
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'PATHEXT', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'CLAUDE_CODE_GIT_BASH_PATH']) {
    if (process.env[key]) env[key] = process.env[key]
  }
  Object.assign(env, {
    HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData/Roaming'), LOCALAPPDATA: join(home, 'AppData/Local'),
    CODEX_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude'), PI_CODING_AGENT_DIR: join(home, '.pi/agent'),
    XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, '.local/share'), XDG_CACHE_HOME: join(home, '.cache'), XDG_STATE_HOME: join(home, '.local/state'),
    OPENCODE_TEST_HOME: home, OPENCODE_DISABLE_MODELS_FETCH: '1', OPENCODE_DISABLE_AUTOUPDATE: '1',
    OPENCODE_DISABLE_DEFAULT_PLUGINS: '1',
    PI_OFFLINE: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1', NO_PROXY: '127.0.0.1,localhost', NO_COLOR: '1',
  })
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
    const event = (type: string, value: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`)
    if (req.url?.includes('messages')) {
      const msg = { id: 'msg_probe', type: 'message', role: 'assistant', model: 'probe', content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 8, output_tokens: 1 } }
      if (body.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        event('message_start', { message: { ...msg, content: [], stop_reason: null, usage: { input_tokens: 8, output_tokens: 0 } } })
        event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
        event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'OK' } })
        event('content_block_stop', { index: 0 })
        event('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } })
        event('message_stop', {}); res.end()
      } else { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(msg)) }
    } else if (req.url?.includes('responses')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const item = { id: 'msg_probe', type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: 'OK', annotations: [] }] }
      const response = { id: 'resp_probe', object: 'response', created_at: 1, status: 'completed', model: 'probe', output: [item], usage: { input_tokens: 8, output_tokens: 1, total_tokens: 9, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } }
      event('response.created', { response: { ...response, status: 'in_progress', output: [] } })
      event('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', content: [] } })
      event('response.content_part.added', { item_id: item.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } })
      event('response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: 'OK' })
      event('response.output_item.done', { output_index: 0, item })
      event('response.completed', { response }); res.end()
    } else if (req.url?.includes('chat/completions')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      for (const chunk of [{ delta: { role: 'assistant', content: 'OK' }, finish_reason: null }, { delta: {}, finish_reason: 'stop' }]) {
        res.write(`data: ${JSON.stringify({ id: 'chat_probe', object: 'chat.completion.chunk', created: 1, model: 'probe', choices: [{ index: 0, ...chunk }], usage: { prompt_tokens: 8, completion_tokens: 1, total_tokens: 9 } })}\n\n`)
      }
      res.end('data: [DONE]\n\n')
    } else { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"data":[]}') }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  return { root, home, cwd, env, url, close: async () => {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  } }
}

export function runHookCli(bin: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, input?: string) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(bin.endsWith('.js') ? process.execPath : bin, bin.endsWith('.js') ? [bin, ...args] : args, { cwd, env, windowsHide: true, timeout: 45000 })
    let stdout = '', stderr = ''
    child.stdout.on('data', bytes => { stdout += bytes.toString() })
    child.stderr.on('data', bytes => { stderr += bytes.toString() })
    child.on('error', reject)
    child.on('close', code => resolve({ code, stdout, stderr }))
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}

export async function filesIn(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => [])
  return (await Promise.all(entries.map(async entry => entry.isDirectory()
    ? (await filesIn(join(path, entry.name))).map(name => `${entry.name}/${name}`) : [entry.name]))).flat().sort()
}
