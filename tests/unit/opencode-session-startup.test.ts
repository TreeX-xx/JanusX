import { expect, it } from 'vitest'
import { join } from 'node:path'
import pty from 'node-pty'
import { OpenCodeConversation } from '../../src/main/terminal/opencode-conversation'
import { nativeConversationFixture } from '../helpers/native-conversation-fixture'

const binary = process.env.JANUSX_TEST_OPENCODE_BIN
it.skipIf(!binary || process.platform !== 'win32')('keeps startup and previews healthy, then follows native new/view sessions', async () => {
  const f = await nativeConversationFixture()
  f.env.OPENCODE_TEST_HOME = f.root
  f.env.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS = '1'
  f.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ model: 'fixture/fixture', update: 'disable', share: 'disabled', snapshots: false,
    providers: { fixture: { package: '@ai-sdk/openai-compatible', settings: { baseURL: f.url, apiKey: 'fixture' }, models: {
      fixture: { limit: { context: 32000, output: 1000 }, capabilities: { input: ['text'], output: ['text'], tools: false } },
    } } } })
  const c = new OpenCodeConversation('startup', () => {})
  let terminal: pty.IPty | undefined
  const requests: string[] = []
  let viewBody: unknown
  try {
    const launch = await c.start({ command: binary!, args: [], cwd: f.cwd, env: f.env, assetsDir: join(f.root, 'assets') })
    const wire = c as any
    const other = await wire.api('/api/session', { location: { directory: f.cwd } })
    wire.proxy.on('request', (req: any) => {
      requests.push(`${req.method} ${req.url}`)
      if (req.method === 'POST' && req.url.endsWith('/view')) {
        let body = ''; req.on('data', (chunk: Buffer) => { body += chunk }); req.on('end', () => { viewBody = JSON.parse(body) })
      }
    })
    const session = c.state.threadId
    const endpoint = launch.args[launch.args.indexOf('--server') + 1]
    const headers = { Authorization: `Basic ${Buffer.from(`opencode:${launch.env.OPENCODE_SERVER_PASSWORD}`).toString('base64')}`, 'Content-Type': 'application/json' }
    const call = (path: string, body?: unknown) => fetch(endpoint + path, { method: body === undefined ? 'GET' : 'POST', headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    expect((await call(`/api/session/${other.data.id}/message?limit=20`)).ok).toBe(true)
    expect(c.state).toMatchObject({ connection: 'ready', threadId: session })
    expect((await fetch(endpoint + '/api/session', { method: 'POST', headers, body: '{' })).ok).toBe(false)
    expect(c.state).toMatchObject({ connection: 'ready', threadId: session })
    terminal = pty.spawn(launch.command, launch.args, { cwd: f.cwd, env: { ...f.env, ...launch.env } as Record<string, string>, cols: 120, rows: 35 })
    let output = ''
    terminal.onData(data => { output += data })
    await expect.poll(() => output.includes('fixture'), { timeout: 20000 }).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 1500))
    expect(c.state.connection, JSON.stringify(requests)).toBe('ready')
    expect(c.state.threadId).toBe(session)
    requests.length = 0
    terminal.write('/new'); await new Promise(resolve => setTimeout(resolve, 150)); terminal.write('\r')
    await new Promise(resolve => setTimeout(resolve, 1000))
    terminal.write('NATIVE_FIRST'); await new Promise(resolve => setTimeout(resolve, 150)); terminal.write('\r')
    await expect.poll(() => c.state.threadId !== session && c.state.items.some(item => item.text.includes('NATIVE_FIRST final')), { timeout: 20000 }).toBe(true)
    expect(c.state.connection).toBe('ready')
    const freshSession = c.state.threadId
    expect(requests).toContain('POST /api/session')
    await expect.poll(() => viewBody).toBeDefined()
    const nativeViewBody = viewBody
    await c.command({ type: 'mode', mode: 'conversation' })
    expect((await call(`/api/session/${freshSession}/view`, nativeViewBody)).ok).toBe(true)
    expect((await call(`/api/session/${session}/view`, {})).status).toBe(409)
    expect((await call('/api/session', { location: { directory: f.cwd } })).status).toBe(409)
    await c.command({ type: 'send', commandId: 'follow', text: 'NATIVE_SECOND', controlEpoch: c.state.controlEpoch })
    await expect.poll(() => c.state.items.some(item => item.text.includes('NATIVE_SECOND final')), { timeout: 20000 }).toBe(true)
    expect(c.state.threadId).toBe(freshSession)
    await c.command({ type: 'mode', mode: 'terminal' })
    const viewed = await call(`/api/session/${session}/view`, nativeViewBody ?? {})
    expect(viewed.ok, await viewed.text()).toBe(true)
    expect(c.state).toMatchObject({ connection: 'ready', threadId: session, items: [] })
  } finally { terminal?.kill(); await c.dispose(); f.close() }
}, 45000)
