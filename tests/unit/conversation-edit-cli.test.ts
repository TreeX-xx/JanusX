import { describe, it, expect } from 'vitest'
import { writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import pty from 'node-pty'
import { CodexConversation } from '../../src/main/terminal/codex-conversation'
import { OpenCodeConversation } from '../../src/main/terminal/opencode-conversation'
import { hookCliFixture } from '../helpers/hook-cli-fixture'
import { nativeConversationFixture } from '../helpers/native-conversation-fixture'

for (const engine of ['codex', 'opencode'] as const) {
  const binary = process.env[engine === 'codex' ? 'JANUSX_TEST_CODEX_BIN' : 'JANUSX_TEST_OPENCODE_BIN']
  describe.skipIf(!binary || process.platform !== 'win32')(`${engine} native history editing`, () => {
    it('replaces a historical turn in the same session and model context while preserving workspace files', async () => {
      const f = engine === 'codex' ? await hookCliFixture() : await nativeConversationFixture()
      if (engine === 'codex') await writeFile(join(f.env.CODEX_HOME!, 'config.toml'), [
        'model="probe"', 'model_provider="local"', 'check_for_update_on_startup=false',
        '[model_providers.local]', 'name="Local fixture"', `base_url="${f.url}/v1"`, 'wire_api="responses"', 'requires_openai_auth=false',
        `[projects.${JSON.stringify(f.cwd)}]`, 'trust_level="trusted"',
      ].join('\n'))
      else f.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ model: 'fixture/fixture', update: 'disable', share: 'disabled', snapshots: false,
        providers: { fixture: { package: '@ai-sdk/openai-compatible', settings: { baseURL: f.url, apiKey: 'fixture' }, models: {
          fixture: { limit: { context: 32000, output: 1000 }, capabilities: { input: ['text'], output: ['text'], tools: false } },
        } } } })
      const c = engine === 'codex' ? new CodexConversation('edit-test', () => {}) : new OpenCodeConversation('edit-test', () => {})
      let terminal: pty.IPty | undefined
      let output = ''
      const wait = async (predicate: () => boolean) => {
        const end = Date.now() + 20000
        while (!predicate()) { if (Date.now() > end) throw new Error(JSON.stringify(c.snapshot()) + output.slice(-1000)); await new Promise(r => setTimeout(r, 50)) }
      }
      try {
        const launch = await c.start({ command: binary!, args: [], cwd: f.cwd, env: f.env, assetsDir: join(f.root, 'assets') })
        terminal = pty.spawn(launch.command, launch.args, { cwd: f.cwd, env: { ...f.env, ...launch.env } as Record<string, string>, cols: 120, rows: 35, useConpty: true, useConptyDll: engine === 'codex' })
        terminal.onData(data => { output += data; if (data.includes('\x1b[6n')) terminal?.write('\x1b[1;1R') })
        await wait(() => c.state.connection === 'ready')
        if (engine === 'opencode') await wait(() => output.includes('fixture'))
        await new Promise(r => setTimeout(r, 700))
        terminal.write('NATIVE_KEEP'); await new Promise(r => setTimeout(r, 100)); terminal.write('\r')
        await wait(() => !c.state.turnId && c.state.items.some(i => i.type === 'agentMessage' && i.status === 'completed'))
        await c.command({ type: 'mode', mode: 'conversation' })
        const threadId = c.state.threadId
        const send = async (text: string) => {
          await c.command({ type: 'send', commandId: text, text, controlEpoch: c.state.controlEpoch })
          await wait(() => !c.state.turnId && c.state.items.some(i => i.type === 'userMessage' && i.text === text))
        }
        await send('NATIVE_OLD')
        await send('NATIVE_LATER')
        const target = c.state.items.find(i => i.type === 'userMessage' && i.text === 'NATIVE_OLD')!
        const file = join(f.cwd, 'keep-edit.txt')
        await writeFile(file, 'workspace changes stay')
        const command = { type: 'edit' as const, itemId: target.id, text: 'NATIVE_EDITED', commandId: 'edit-once', controlEpoch: c.state.controlEpoch }
        await c.command(command)
        await c.command(command)
        await wait(() => !c.state.turnId && c.state.items.some(i => i.type === 'userMessage' && i.text === 'NATIVE_EDITED'))
        expect(c.state.threadId).toBe(threadId)
        expect(c.state.items.filter(i => i.type === 'userMessage').map(i => i.text)).toEqual(['NATIVE_KEEP', 'NATIVE_EDITED'])
        const requests = 'responseRequests' in f ? f.responseRequests.map(r => r.input) : f.requestBodies.map(b => JSON.stringify(b.messages))
        const edited = requests.filter(r => r.includes('NATIVE_EDITED'))
        expect(edited).toHaveLength(1)
        expect(edited[0]).toContain('NATIVE_KEEP')
        expect(edited[0]).not.toContain('NATIVE_OLD')
        expect(edited[0]).not.toContain('NATIVE_LATER')
        expect(await readFile(file, 'utf8')).toBe('workspace changes stay')
        await c.command({ type: 'mode', mode: 'terminal' })
        await new Promise(r => setTimeout(r, 700))
        terminal.write('NATIVE_AFTER_EDIT'); await new Promise(r => setTimeout(r, 100)); terminal.write('\r')
        await wait(() => !c.state.turnId && c.state.items.some(i => i.type === 'userMessage' && i.text === 'NATIVE_AFTER_EDIT'))
        const after = 'responseRequests' in f ? f.responseRequests.at(-1)!.input : JSON.stringify(f.requestBodies.at(-1)!.messages)
        expect(after).toContain('NATIVE_EDITED')
        expect(after).not.toContain('NATIVE_OLD')
        expect(c.state.threadId).toBe(threadId)
      } finally { terminal?.kill(); await c.dispose(); await f.close() }
    }, 60000)
  })
}
