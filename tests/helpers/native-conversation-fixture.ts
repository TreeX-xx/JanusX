import { createServer } from 'node:http'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export async function nativeConversationFixture() {
  const root = await mkdtemp(join(tmpdir(), 'janusx-native-dialog-'))
  const cwd = join(root, 'workspace'), config = join(root, 'config')
  await mkdir(cwd); await mkdir(config)
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(path|systemroot|windir|comspec|temp|tmp|pathext|programfiles.*)$/i.test(k)))
  Object.assign(env, { USERPROFILE: root, HOME: root, APPDATA: join(root, 'roaming'), LOCALAPPDATA: join(root, 'local'), XDG_CONFIG_HOME: config,
    XDG_DATA_HOME: join(root, 'data'), XDG_STATE_HOME: join(root, 'state'), PI_CODING_AGENT_DIR: config, TERM: 'xterm-256color', NO_PROXY: 'localhost,127.0.0.1' })
  const requests: string[] = []
  const requestBodies: Record<string, unknown>[] = []
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const part of req) raw += part
    if (!raw) { res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}'); return }
    const body = JSON.parse(raw), last = [...(body.messages ?? [])].reverse().find(m => m.role === 'user')
    requestBodies.push(body)
    const marker = JSON.stringify(last?.content ?? '').match(/NATIVE_[A-Z]+/)?.[0] ?? 'OTHER'
    requests.push(marker)
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const delta = (content: string, finish_reason: string | null = null) => res.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason }] })}\n\n`)
    delta(`First ${marker}`)
    await new Promise(resolve => setTimeout(resolve, marker === 'NATIVE_CANCEL' ? 3000 : 300))
    delta(' final', 'stop'); res.end('data: [DONE]\n\n')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
  return { root, cwd, config, env, url, requests, requestBodies, close: () => { server.closeAllConnections(); server.close() } }
}
