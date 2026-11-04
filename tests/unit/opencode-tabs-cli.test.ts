import { expect, it } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import pty from 'node-pty'
import { Terminal } from '@xterm/xterm'
import { OpenCodeConversation } from '../../src/main/terminal/opencode-conversation'
import { nativeConversationFixture } from '../helpers/native-conversation-fixture'

const binary = process.env.JANUSX_TEST_OPENCODE_BIN
it.skipIf(!binary || process.platform !== 'win32').each([
  { label: 'native restoration control', cols: 80, restore: true },
  { label: 'managed terminal', cols: 80, restore: false },
  { label: 'narrow managed terminal', cols: 45, restore: false },
])('$label keeps the intended tab ownership', async ({ cols, restore }) => {
  const f = await nativeConversationFixture()
  f.env.OPENCODE_TEST_HOME = f.root
  f.env.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS = '1'
  f.env.OPENCODE_CLI_CONFIG_CONTENT = JSON.stringify({ tabs: { mode: 'on', layout: 'horizontal' } })
  f.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ model: 'fixture/fixture', update: 'disable', share: 'disabled', snapshots: false,
    providers: { fixture: { package: '@ai-sdk/openai-compatible', settings: { baseURL: f.url, apiKey: 'fixture' }, models: {
      fixture: { limit: { context: 32000, output: 1000 }, capabilities: { input: ['text'], output: ['text'], tools: false } },
    } } } })
  const controller = new OpenCodeConversation('tabs-test', () => {})
  const screen = new Terminal({ cols, rows: 24, allowProposedApi: true })
  const lines = () => Array.from({ length: screen.rows }, (_, index) => screen.buffer.active.getLine(screen.buffer.active.viewportY + index)?.translateToString(true) ?? '')
  let terminal: pty.IPty | undefined
  try {
    const launch = await controller.start({ command: binary!, args: [], cwd: f.cwd, env: f.env, assetsDir: join(f.root, 'assets') })
    const wire = controller as any
    const previous = await Promise.all([wire.api('/api/session', { location: { directory: f.cwd } }), wire.api('/api/session', { location: { directory: f.cwd } })])
    const tabsPath = join(f.root, 'state/opencode/latest/tui/tabs.json')
    await mkdir(join(f.root, 'state/opencode/latest/tui'), { recursive: true })
    const saved = JSON.stringify({ global: { tabs: [], unread: {} }, cwd: { [f.cwd]: { tabs: previous.map(info => ({ sessionID: info.data.id, title: 'New session' })), unread: {} } } })
    await writeFile(tabsPath, saved)
    const requests: string[] = []
    wire.proxy.on('request', (request: any) => requests.push(`${request.method} ${request.url}`))
    const env = { ...f.env, ...launch.env, ...(restore ? { OPENCODE_CLI_CONFIG_CONTENT: f.env.OPENCODE_CLI_CONFIG_CONTENT } : {}) }
    terminal = pty.spawn(launch.command, launch.args, { cwd: f.cwd, env: env as Record<string, string>, cols, rows: 24 })
    terminal.onData(data => screen.write(data))
    screen.onData(data => terminal?.write(data))
    await expect.poll(() => lines().join('\n'), { timeout: 20000 }).toContain('fixture')
    await new Promise(resolve => setTimeout(resolve, 1500))
    expect(previous.map(info => requests.some(path => path.includes(info.data.id)))).toEqual([restore, restore])
    expect((lines()[0].match(/New session/g) ?? []).length).toBe(restore ? 3 : 0)
    expect(requests.filter(path => path === 'POST /api/session')).toHaveLength(0)
    if (!restore) expect(await readFile(tabsPath, 'utf8')).toBe(saved)
    expect(controller.state.connection).toBe('ready')
  } finally { terminal?.kill(); screen.dispose(); await controller.dispose(); f.close() }
}, 30000)
