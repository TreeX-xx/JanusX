import { describe, expect, it, vi } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import pty from 'node-pty'
import { CodexConversation } from '../../src/main/terminal/codex-conversation'
import { hookCliFixture } from '../helpers/hook-cli-fixture'

const context = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => context.userData } }))
const { TerminalContextCoordinator } = await import('../../src/main/runtime-telemetry/coordinator')
const bin = process.env.JANUSX_TEST_CODEX_BIN

describe.skipIf(!bin || process.platform !== 'win32')('Codex context with real concurrent native clients (local model only)', () => {
  it('keeps two same-directory clients independent and follows a new thread without hooks', async () => {
    const fixture = await hookCliFixture()
    context.userData = join(fixture.cwd, 'telemetry-profile')
    const coordinator = new TerminalContextCoordinator()
    const terminals: pty.IPty[] = []
    const clients = ['first', 'second'].map(id => new CodexConversation(id, () => {}, threadId => {
      coordinator.bindNativeSession(id, threadId)
    }))
    const read = (id: string) => coordinator.getSnapshot({ terminalId: id, preset: 'codex', cwd: fixture.cwd })
    const send = async (client: CodexConversation, text: string) => {
      const { controlEpoch } = await client.command({ type: 'mode', mode: 'conversation' })
      await client.command({ type: 'send', text, commandId: text, controlEpoch })
      await vi.waitFor(() => expect(client.snapshot().turnId).toBeNull(), { timeout: 20000 })
    }
    try {
      await writeFile(join(fixture.env.CODEX_HOME!, 'config.toml'), [
        'model="probe"', 'model_provider="local"', 'check_for_update_on_startup=false',
        'approval_policy="never"', 'sandbox_mode="read-only"',
        '[model_providers.local]', 'name="Local fixture"', `base_url="${fixture.url}/v1"`, 'wire_api="responses"', 'requires_openai_auth=false',
        `[projects.${JSON.stringify(fixture.cwd)}]`, 'trust_level="trusted"',
        '[analytics]', 'enabled=false', '[feedback]', 'enabled=false',
      ].join('\n'))
      // Initialize the fresh shared Codex database before concurrent TUI creation;
      // production homes already exist. Both native thread selections still race.
      const launches = []
      for (const client of clients) {
        coordinator.trackTerminal(client.id, 'codex', fixture.cwd, undefined, fixture.env.CODEX_HOME, true)
        launches.push(await client.start({ command: bin!, args: [], cwd: fixture.cwd, env: fixture.env }))
      }
      await Promise.all(clients.map(async (client, index) => {
        const launch = launches[index]
        const terminal = pty.spawn(launch.command, [...launch.args, '--no-alt-screen'], {
          cwd: fixture.cwd, env: { ...fixture.env, ...launch.env } as Record<string, string>,
          cols: 120, rows: 35, useConpty: true, useConptyDll: true,
        })
        terminals.push(terminal)
        terminal.onData(data => { if (data.includes('\x1b[6n')) terminal.write('\x1b[1;1R') })
        client.setNativeInput(text => terminal.write(text))
        await vi.waitFor(() => expect(client.snapshot().connection).toBe('ready'), { timeout: 20000 })
      }))
      const [a, b] = clients
      expect(a.snapshot().threadId).toBeTruthy()
      expect(b.snapshot().threadId).not.toBe(a.snapshot().threadId)
      await Promise.all([send(a, 'FIRST_CONTEXT'), send(b, 'SECOND_CONTEXT')])
      await vi.waitFor(async () => {
        expect(await read('first')).toMatchObject({ sessionId: a.snapshot().threadId, sessionBinding: 'exact', contextTokens: 9 })
        expect(await read('second')).toMatchObject({ sessionId: b.snapshot().threadId, sessionBinding: 'exact', contextTokens: 9 })
      }, { timeout: 20000 })
      const before = await read('first')
      await send(b, 'SECOND_ONLY')
      await vi.waitFor(async () => expect((await read('second'))?.totalTokens).toBeGreaterThan(before!.totalTokens!), { timeout: 20000 })
      expect((await read('first'))?.totalTokens).toBe(before!.totalTokens)
      const old = b.snapshot().threadId
      const fresh = await b.command({ type: 'new', controlEpoch: b.snapshot().controlEpoch })
      expect(fresh.threadId).not.toBe(old)
      expect(await read('second')).toMatchObject({ sessionId: fresh.threadId, sessionBinding: 'exact' })
      expect((await read('second'))?.totalTokens ?? 0).toBe(0)
      await send(b, 'NEW_CONTEXT')
      await vi.waitFor(async () => expect(await read('second')).toMatchObject({ sessionId: fresh.threadId, contextTokens: 9 }), { timeout: 20000 })
      expect((await read('first'))?.sessionId).toBe(a.snapshot().threadId)
      await mkdir('artifacts/codex-context', { recursive: true })
      await writeFile('artifacts/codex-context/native-clients.json', JSON.stringify({ first: await read('first'), second: await read('second'), previousSecond: old, localModelRequests: fixture.responseRequests.length }, null, 2))
    } finally {
      for (const terminal of terminals) terminal.kill()
      await Promise.all(clients.map(client => client.dispose()))
      await coordinator.shutdown()
      await fixture.close()
    }
  }, 120000)
})
