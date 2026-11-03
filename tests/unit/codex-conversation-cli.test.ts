import { describe, it, expect, vi } from 'vitest'
import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createServer } from 'node:http'
import pty from 'node-pty'
import { CodexConversation } from '../../src/main/terminal/codex-conversation'
import { hookCliFixture } from '../helpers/hook-cli-fixture'
import { AgentHookBridge } from '../../src/main/notifications/agent-hook-bridge'
import type { AgentHookPayload } from '../../src/main/notifications/agent-hook-types'

vi.mock('electron', () => ({ app: { isPackaged: true, getPath: () => '/unused' } }))
const { AgentHookConfigManager } = await import('../../src/main/notifications/agent-hook-config')

const bin = process.env.JANUSX_TEST_CODEX_BIN
describe.skipIf(!bin || process.platform !== 'win32')('managed Codex native TUI integration (local model only)', () => {
  it('answers native request_user_input with a selection and custom text', async () => {
    const fixture = await hookCliFixture({ codexQuestionProbe: true })
    await writeFile(join(fixture.env.CODEX_HOME!, 'config.toml'), [
      'model="probe"', 'model_provider="local"', 'check_for_update_on_startup=false', 'features.default_mode_request_user_input=true',
      '[model_providers.local]', 'name="Local fixture"', `base_url="${fixture.url}/v1"`, 'wire_api="responses"', 'requires_openai_auth=false',
      `[projects.${JSON.stringify(fixture.cwd)}]`, 'trust_level="trusted"',
    ].join('\n'))
    const c = new CodexConversation('question-test', () => {})
    let terminal: pty.IPty | undefined
    try {
      const launch = await c.start({ command: bin!, args: [], cwd: fixture.cwd, env: fixture.env, assetsDir: join(fixture.root, 'assets') })
      terminal = pty.spawn(launch.command, [...launch.args, '--no-alt-screen'], { cwd: fixture.cwd, env: { ...fixture.env, ...launch.env } as Record<string, string>, cols: 120, rows: 35, useConpty: true, useConptyDll: true })
      terminal.onData(data => { if (data.includes('\x1b[6n')) terminal?.write('\x1b[1;1R') })
      await vi.waitFor(() => expect(c.state.connection).toBe('ready'), { timeout: 15000 })
      const { controlEpoch } = await c.command({ type: 'mode', mode: 'conversation' })
      await c.command({ type: 'send', commandId: 'question', text: 'Ask a question', controlEpoch })
      await vi.waitFor(() => expect(c.state.questions).toHaveLength(1), { timeout: 15000 })
      const q = c.state.questions![0]
      expect(q.questions.every(question => question.allowText)).toBe(true)
      await c.command({ type: 'answer', requestId: q.id, version: q.version, controlEpoch, answer: { answers: [
        { id: 'choice', selected: ['1'] }, { id: 'notes', selected: [], text: '中文 typed' },
      ] } })
      await vi.waitFor(() => expect(fixture.responseRequests.some(request => request.input.includes('user_note: 中文 typed'))).toBe(true), { timeout: 15000 })
      await vi.waitFor(() => expect(c.state.turnId).toBeNull(), { timeout: 15000 })
      expect(c.state.questions).toEqual([])
      expect(c.state.items.filter(item => item.type === 'userMessage')).toHaveLength(1)
    } finally { terminal?.kill(); await c.dispose(); await fixture.close() }
  })
  it('discovers and invokes a structured skill and projects its generated image in the same native thread', async () => {
    const fixture = await hookCliFixture({ codexImageProbe: true })
    await writeFile(join(fixture.env.CODEX_HOME!, 'config.toml'), [
      'model="probe"', 'model_provider="local"', 'check_for_update_on_startup=false',
      '[model_providers.local]', 'name="Local fixture"', `base_url="${fixture.url}/v1"`, 'wire_api="responses"', 'requires_openai_auth=false',
      `[projects.${JSON.stringify(fixture.cwd)}]`, 'trust_level="trusted"',
    ].join('\n'))
    const skill = join(fixture.cwd, '.agents/skills/native-review')
    await mkdir(skill, { recursive: true })
    await writeFile(join(skill, 'SKILL.md'), ['---', 'name: native-review', 'description: Native test skill', '---', 'CODEX_SKILL_BODY_MARKER'].join('\n'))
    const c = new CodexConversation('skill-test', () => {})
    let terminal: pty.IPty | undefined
    try {
      const launch = await c.start({ command: bin!, args: [], cwd: fixture.cwd, env: fixture.env, assetsDir: join(fixture.root, 'assets') })
      terminal = pty.spawn(launch.command, [...launch.args, '--no-alt-screen'], { cwd: fixture.cwd, env: { ...fixture.env, ...launch.env } as Record<string, string>, cols: 120, rows: 35, useConpty: true, useConptyDll: true })
      terminal.onData(data => { if (data.includes('\x1b[6n')) terminal?.write('\x1b[1;1R') })
      await vi.waitFor(() => expect(c.state.connection).toBe('ready'), { timeout: 15000 })
      const thread = c.state.threadId
      const { controlEpoch } = await c.command({ type: 'mode', mode: 'conversation' })
      await c.command({ type: 'commands', controlEpoch })
      const entry = c.state.commands?.find(row => row.name === 'native-review')
      expect(entry?.execution).toBe('native')
      await c.command({ type: 'invoke', entryId: entry!.id, arguments: 'ARGUMENT_MARKER', catalogRevision: c.state.commandsRevision!, commandId: 'skill', controlEpoch })
      await vi.waitFor(() => expect(fixture.responseRequests.some(request => request.input.includes('CODEX_SKILL_BODY_MARKER') && request.input.includes('ARGUMENT_MARKER'))).toBe(true), { timeout: 15000 })
      expect(c.state.threadId).toBe(thread)
      expect(c.state.commandReceipts?.at(-1)).toEqual({ id: 'skill', status: 'accepted' })
      await vi.waitFor(() => expect(c.state.items.find(item => item.images?.length)?.images?.[0].status).toBe('ready'), { timeout: 15000 })
      const image = c.state.items.find(item => item.images?.length)!.images![0]
      expect((await readFile(image.path!)).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      expect(JSON.stringify(c.snapshot())).not.toContain('iVBORw0KGgo')
    } finally { terminal?.kill(); await c.dispose(); await fixture.close() }
  })
  it('reviews actual startup hooks through structured confirmation without native keystrokes', async () => {
    const fixture = await hookCliFixture()
    await writeFile(join(fixture.env.CODEX_HOME!, 'config.toml'), [
      'model="probe"', 'model_provider="local"', 'check_for_update_on_startup=false',
      '[model_providers.local]', 'name="Local fixture"', `base_url="${fixture.url}/v1"`, 'wire_api="responses"', 'requires_openai_auth=false',
      `[projects.${JSON.stringify(fixture.cwd)}]`, 'trust_level="trusted"',
    ].join('\n'))
    const hooks = new AgentHookConfigManager({ homeDir: fixture.home, userDataDir: join(fixture.root, 'userData') })
    await hooks.ensureInstalled('codex')
    const args = await hooks.getLaunchArgs('codex')
    const controller = new CodexConversation('hooks-probe', () => {})
    let terminal: pty.IPty | undefined
    let output = ''
    try {
      await controller.command({ type: 'mode', mode: 'conversation' })
      const launch = await controller.start({ command: bin!, args, cwd: fixture.cwd, env: fixture.env })
      terminal = pty.spawn(launch.command, [...launch.args, '--no-alt-screen'], { cwd: fixture.cwd, env: { ...fixture.env, ...launch.env } as Record<string, string>, cols: 120, rows: 35, useConpty: true, useConptyDll: true })
      terminal.onData(data => { output = (output + data).slice(-10000); if (data.includes('\x1b[6n')) terminal?.write('\x1b[1;1R') })
      await vi.waitFor(() => expect(controller.state.startup?.kind, output).toBe('hooks'), { timeout: 15000 })
      expect(controller.state.startup?.hooks?.length).toBeGreaterThan(0)
      expect(controller.state.threadId).toBeNull()
      await controller.command({ type: 'startup', startupId: controller.state.startup!.id, action: 'trust', controlEpoch: controller.state.controlEpoch })
      expect(controller.state.startup, output).toBeUndefined()
      await vi.waitFor(() => expect(controller.state.connection, output).toBe('ready'), { timeout: 15000 })
    } finally { terminal?.kill(); await controller.dispose(); await fixture.close() }
  }, 60000)
  it('signs in with an isolated API key through startup controls before trusting the folder', async () => {
    const fixture = await hookCliFixture()
    await writeFile(join(fixture.env.CODEX_HOME!, 'config.toml'), [
      'model="probe"', 'model_provider="local"', 'check_for_update_on_startup=false', 'cli_auth_credentials_store="file"',
      '[model_providers.local]', 'name="Local fixture"', `base_url="${fixture.url}/v1"`, 'wire_api="responses"', 'requires_openai_auth=true',
    ].join('\n'))
    const controller = new CodexConversation('login-probe', () => {})
    let terminal: pty.IPty | undefined
    let output = ''
    try {
      await controller.command({ type: 'mode', mode: 'conversation' })
      const launch = await controller.start({ command: bin!, args: [], cwd: fixture.cwd, env: fixture.env })
      terminal = pty.spawn(launch.command, [...launch.args, '--no-alt-screen'], { cwd: fixture.cwd, env: { ...fixture.env, ...launch.env } as Record<string, string>, cols: 120, rows: 35, useConpty: true, useConptyDll: true })
      terminal.onData(data => { output = (output + data).slice(-10000); if (data.includes('\x1b[6n')) terminal?.write('\x1b[1;1R') })
      await vi.waitFor(() => expect(controller.state.startup?.kind, output).toBe('login'), { timeout: 15000 })
      await controller.command({ type: 'startup', startupId: controller.state.startup!.id, action: 'apiKey', apiKey: 'sk-local-fixture-not-a-real-key', controlEpoch: controller.state.controlEpoch })
      await vi.waitFor(() => expect(controller.state.startup?.kind, output).toBe('trust'), { timeout: 15000 })
      await controller.command({ type: 'startup', startupId: controller.state.startup!.id, action: 'trust', controlEpoch: controller.state.controlEpoch })
      await vi.waitFor(() => expect(controller.state.connection, output).toBe('ready'), { timeout: 15000 })
      expect(JSON.stringify(controller.snapshot())).not.toContain('sk-local-fixture')
      expect(fixture.responseRequests).toHaveLength(0)
    } finally { terminal?.kill(); await controller.dispose(); await fixture.close() }
  }, 60000)
  it('confirms folder trust from conversation without native keystrokes and resumes the real TUI', async () => {
    const fixture = await hookCliFixture()
    await writeFile(join(fixture.env.CODEX_HOME!, 'config.toml'), [
      'model="probe"', 'model_provider="local"', 'check_for_update_on_startup=false',
      '[model_providers.local]', 'name="Local fixture"', `base_url="${fixture.url}/v1"`, 'wire_api="responses"', 'requires_openai_auth=false',
    ].join('\n'))
    const controller = new CodexConversation('trust-probe', () => {})
    let terminal: pty.IPty | undefined
    let output = ''
    try {
      await controller.command({ type: 'mode', mode: 'conversation' })
      const launch = await controller.start({ command: bin!, args: [], cwd: fixture.cwd, env: fixture.env })
      terminal = pty.spawn(launch.command, [...launch.args, '--no-alt-screen'], { cwd: fixture.cwd, env: { ...fixture.env, ...launch.env } as Record<string, string>, cols: 120, rows: 35, useConpty: true, useConptyDll: true })
      terminal.onData(data => { output = (output + data).slice(-10000); if (data.includes('\x1b[6n')) terminal?.write('\x1b[1;1R') })
      await vi.waitFor(() => expect(controller.state.startup?.kind, output).toBe('trust'), { timeout: 15000 })
      expect(controller.state.threadId).toBeNull()
      const command = { type: 'startup' as const, startupId: controller.state.startup!.id, controlEpoch: controller.state.controlEpoch }
      await controller.command({ ...command, action: 'cancel' })
      expect(controller.state.startup?.status).toBe('cancelled')
      expect(controller.state.threadId).toBeNull()
      await controller.command({ ...command, action: 'resume' })
      await controller.command({ ...command, action: 'trust' })
      expect(controller.state.startup, output).toBeUndefined()
      await vi.waitFor(() => expect(controller.state.connection, output).toBe('ready'), { timeout: 15000 })
      await controller.command({ type: 'send', text: 'TRUST_DIALOG', commandId: 'trust-dialog', controlEpoch: controller.state.controlEpoch })
      await vi.waitFor(() => expect(controller.state.items.some(item => item.type === 'agentMessage' && item.status === 'completed')).toBe(true), { timeout: 15000 })
    } finally { terminal?.kill(); await controller.dispose(); await fixture.close() }
  }, 60000)
  it('delivers consecutive input into the active native turn', async () => {
    const fixture = await hookCliFixture({ codexLiveProbe: true })
    await writeFile(join(fixture.env.CODEX_HOME!, 'config.toml'), [
      'model="probe"', 'model_provider="local"', 'check_for_update_on_startup=false',
      '[model_providers.local]', 'name="Local fixture"', `base_url="${fixture.url}/v1"`, 'wire_api="responses"', 'requires_openai_auth=false',
      `[projects.${JSON.stringify(fixture.cwd)}]`, 'trust_level="trusted"',
    ].join('\n'))
    const controller = new CodexConversation('live-probe', () => {})
    let terminal: pty.IPty | undefined
    try {
      const launch = await controller.start({ command: bin!, args: [], cwd: fixture.cwd, env: fixture.env })
      terminal = pty.spawn(launch.command, [...launch.args, '--no-alt-screen'], { cwd: fixture.cwd, env: { ...fixture.env, ...launch.env } as Record<string, string>, cols: 120, rows: 35, useConpty: true, useConptyDll: true })
      terminal.onData(data => { if (data.includes('\x1b[6n')) terminal?.write('\x1b[1;1R') })
      await vi.waitFor(() => expect(controller.state.connection).toBe('ready'), { timeout: 15000 })
      const { controlEpoch } = await controller.command({ type: 'mode', mode: 'conversation' })
      const send = (text: string) => controller.command({ type: 'send', text, commandId: text, controlEpoch })
      await send('LIVE_FIRST')
      await vi.waitFor(() => expect(controller.state.items.some(item => item.type === 'agentMessage' && item.text === 'OK')).toBe(true), { timeout: 10000 })
      const active = controller.state.turnId
      expect(active).toBeTruthy()
      await send('LIVE_SECOND'); await send('LIVE_THIRD')
      expect(controller.state.turnId).toBe(active)
      await vi.waitFor(() => expect(fixture.responseRequests.some(request => request.input.includes('LIVE_SECOND') && request.input.includes('LIVE_THIRD'))).toBe(true), { timeout: 15000 })
      await vi.waitFor(() => expect(controller.state.items.filter(item => item.type === 'userMessage').map(item => item.text)).toEqual(['LIVE_FIRST', 'LIVE_SECOND', 'LIVE_THIRD']), { timeout: 10000 })
    } finally { terminal?.kill(); await controller.dispose(); await fixture.close() }
  }, 60000)
  it('starts /new from conversation view and keeps the native client on the confirmed new thread', async () => {
    const fixture = await hookCliFixture()
    await writeFile(join(fixture.env.CODEX_HOME!, 'config.toml'), [
      'model="probe"', 'model_provider="local"', 'check_for_update_on_startup=false',
      '[model_providers.local]', 'name="Local fixture"', `base_url="${fixture.url}/v1"`, 'wire_api="responses"', 'requires_openai_auth=false',
      `[projects.${JSON.stringify(fixture.cwd)}]`, 'trust_level="trusted"',
    ].join('\n'))
    const controller = new CodexConversation('new-thread-probe', () => {})
    let terminal: pty.IPty | undefined
    let output = ''
    try {
      const launch = await controller.start({ command: bin!, args: [], cwd: fixture.cwd, env: fixture.env })
      terminal = pty.spawn(launch.command, [...launch.args, '--no-alt-screen'], { cwd: fixture.cwd, env: { ...fixture.env, ...launch.env } as Record<string, string>, cols: 120, rows: 35, useConpty: true, useConptyDll: true })
      terminal.onData(data => { output += data; if (data.includes('\x1b[6n')) terminal?.write('\x1b[1;1R') })
      controller.setNativeInput(text => terminal!.write(text))
      await vi.waitFor(() => expect(controller.state.connection, output.slice(-1000)).toBe('ready'), { timeout: 15000 })
      await vi.waitFor(() => expect(output).toContain('state=idle'), { timeout: 10000 })
      terminal.write('UNSENT_NATIVE_DRAFT\x1b[D\x1b[D\x1b[D')
      await new Promise(resolve => setTimeout(resolve, 200))
      const old = controller.state.threadId
      const { controlEpoch } = await controller.command({ type: 'mode', mode: 'conversation' })
      const fresh = await controller.command({ type: 'new', controlEpoch })
      expect(fresh.threadId).not.toBe(old)
      expect(fresh.items).toEqual([])
      expect(fixture.responseRequests).toHaveLength(0)
      await controller.command({ type: 'send', text: 'NEW_THREAD_DIALOG', commandId: 'new-dialog', controlEpoch: fresh.controlEpoch })
      await vi.waitFor(() => expect(controller.state.items.some(item => item.type === 'agentMessage' && item.status === 'completed')).toBe(true), { timeout: 15000 })
      await vi.waitFor(() => expect(controller.state.turnId).toBeNull(), { timeout: 10000 })
      await controller.command({ type: 'mode', mode: 'terminal' })
      terminal.write('NEW_THREAD_NATIVE')
      await new Promise(resolve => setTimeout(resolve, 300)); terminal.write('\r')
      await vi.waitFor(() => expect(controller.state.items.filter(item => item.type === 'userMessage').map(item => item.text)).toEqual(['NEW_THREAD_DIALOG', 'NEW_THREAD_NATIVE']), { timeout: 15000 })
      expect(controller.state.threadId).toBe(fresh.threadId)
    } finally { terminal?.kill(); await controller.dispose(); await fixture.close() }
  }, 60000)
  it('bypasses an inherited proxy for the loopback bridge while preserving proxy configuration', async () => {
    const fixture = await hookCliFixture()
    const requests: string[] = []
    const proxy = createServer((req, res) => { requests.push(req.url ?? ''); res.writeHead(502).end() })
    proxy.on('connect', (req, socket) => { requests.push(req.url ?? ''); socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n') })
    await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve))
    const proxyUrl = `http://127.0.0.1:${(proxy.address() as { port: number }).port}`
    const env = { ...fixture.env, HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, NO_PROXY: 'existing.internal' }
    await writeFile(join(fixture.env.CODEX_HOME!, 'config.toml'), [
      'model="probe"', 'model_provider="local"', 'check_for_update_on_startup=false',
      '[model_providers.local]', 'name="Local fixture"', `base_url="${fixture.url}/v1"`, 'wire_api="responses"', 'requires_openai_auth=false',
      `[projects.${JSON.stringify(fixture.cwd)}]`, 'trust_level="trusted"',
    ].join('\n'))
    const controller = new CodexConversation('proxy-probe', () => {})
    let terminal: pty.IPty | undefined
    let output = ''
    try {
      const launch = await controller.start({ command: bin!, args: [], cwd: fixture.cwd, env })
      const nativeEnv = { ...env, ...launch.env }
      terminal = pty.spawn(launch.command, [...launch.args, '--no-alt-screen'], { cwd: fixture.cwd, env: nativeEnv as Record<string, string>, cols: 120, rows: 35, useConpty: true, useConptyDll: true })
      terminal.onData(data => { output += data; if (data.includes('\x1b[6n')) terminal?.write('\x1b[1;1R') })
      const deadline = Date.now() + 12000
      while (controller.state.connection === 'starting' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50))
      await mkdir('artifacts/codex-dual-mode', { recursive: true })
      await writeFile('artifacts/codex-dual-mode/proxy.json', JSON.stringify({ state: controller.snapshot(), requests, output }, null, 2))
      expect(controller.state.connection, JSON.stringify({ requests, output: output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').slice(-1200) })).toBe('ready')
      expect(requests.some(target => target.includes(new URL(launch.args.at(-1)!).port))).toBe(false)
      expect(nativeEnv.HTTP_PROXY).toBe(proxyUrl)
      expect(nativeEnv.NO_PROXY).toContain('existing.internal')
    } finally {
      terminal?.kill(); await controller.dispose(); await fixture.close()
      proxy.closeAllConnections(); await new Promise<void>(resolve => proxy.close(() => resolve()))
    }
  }, 30000)

  it('binds an empty native-created thread, sends both ways, preserves identity and releases its backend', async () => {
    const fixture = await hookCliFixture({ codexCommandProbe: true, codexPlanProbe: true })
    const home = fixture.env.CODEX_HOME!
    await writeFile(join(home, 'config.toml'), [
      'model="probe"', 'model_provider="local"', 'check_for_update_on_startup=false',
      'approval_policy="on-request"', 'sandbox_mode="read-only"',
      '[model_providers.local]', 'name="Local fixture"', `base_url="${fixture.url}/v1"`, 'wire_api="responses"', 'requires_openai_auth=false',
      `[projects.${JSON.stringify(fixture.cwd)}]`, 'trust_level="trusted"',
      '[analytics]', 'enabled=false', '[feedback]', 'enabled=false',
    ].join('\n'))
    const snapshots: ReturnType<CodexConversation['snapshot']>[] = []
    const payloads: AgentHookPayload[] = []
    const bridge = new AgentHookBridge({ onPayload: payload => { payloads.push(payload) } })
    await bridge.start()
    const hooks = new AgentHookConfigManager({ homeDir: fixture.home, userDataDir: join(fixture.root, 'userData') })
    await hooks.ensureInstalled('codex')
    const hookArgs = await hooks.getLaunchArgs('codex')
    const envFor = (terminalId: string) => ({ ...fixture.env, ...hooks.buildTerminalEnv({ terminalId, workspaceId: 'workspace', engine: 'codex' }, bridge.getEnv()) })
    const controller = new CodexConversation('managed-probe', state => snapshots.push(state))
    const second = new CodexConversation('managed-second', () => {})
    let terminal: pty.IPty | undefined
    let secondTerminal: pty.IPty | undefined
    let output = ''
    const until = async (predicate: () => boolean) => {
      const end = Date.now() + 20000
      while (!predicate()) { if (Date.now() > end) throw new Error(`Timeout. ${JSON.stringify(controller.snapshot())}\n${output.slice(-2000)}`); await new Promise(resolve => setTimeout(resolve, 50)) }
    }
    try {
      const launch = await controller.start({ command: bin!, args: hookArgs, cwd: fixture.cwd, env: envFor('managed-probe') })
      terminal = pty.spawn(launch.command, [...launch.args, '--no-alt-screen'], { cwd: fixture.cwd, env: { ...envFor('managed-probe'), ...launch.env } as Record<string, string>, cols: 120, rows: 35, useConpty: true, useConptyDll: true })
      let reviewed = false
      terminal.onData(data => {
        output += data
        if (data.includes('\x1b[6n')) terminal?.write('\x1b[1;1R')
        // Accept only this isolated fixture's generated hooks through the native review UI.
        if (!reviewed && output.includes('hooks are new or changed.')) { reviewed = true; setTimeout(() => terminal?.write('2\r'), 400) }
      })
      await until(() => controller.snapshot().connection === 'ready')
      const threadId = controller.snapshot().threadId
      expect(threadId).toBeTruthy()
      expect(controller.snapshot().items).toHaveLength(0)
      await until(() => output.includes('state=idle'))
      terminal.write('TERMINAL_FIRST')
      await new Promise(resolve => setTimeout(resolve, 300))
      terminal.write('\r')
      await until(() => controller.snapshot().items.some(item => item.type === 'agentMessage' && item.status === 'completed'))
      await until(() => !controller.snapshot().turnId)
      const state = await controller.command({ type: 'mode', mode: 'conversation' })
      await until(() => !controller.snapshot().modelsLoading && controller.snapshot().models.length > 0)
      expect(controller.snapshot().model).toBe('probe')
      const selectedModel = controller.snapshot().models.find(option => option.efforts.some(value => value.effort === 'high'))!
      expect(selectedModel).toBeTruthy()
      await controller.command({ type: 'settings', model: selectedModel.model, effort: 'high', controlEpoch: state.controlEpoch })
      await until(() => controller.snapshot().model === selectedModel.model && controller.snapshot().effort === 'high')
      expect(controller.acceptsTerminalInput('hidden input\r')).toBe(false)
      expect(controller.acceptsTerminalInput('\x1b[1;1R')).toBe(true)
      const command = { type: 'send' as const, text: 'DIALOG_SECOND', controlEpoch: state.controlEpoch, commandId: 'one-request' }
      await controller.command(command)
      await controller.command(command)
      await until(() => controller.snapshot().items.filter(item => item.type === 'agentMessage' && item.status === 'completed').length === 2 && !controller.snapshot().turnId)
      await until(() => output.includes('DIALOG_SECOND'))
      expect(controller.snapshot().plans?.at(-1)).toMatchObject({ version: 1, outcome: 'completed', steps: [
        { step: 'Inspect', status: 'completed' }, { step: 'Implement', status: 'inProgress' }, { step: 'Verify', status: 'pending' },
      ] })
      expect(fixture.responseRequests.find(request => request.input.includes('DIALOG_SECOND'))).toMatchObject({ model: selectedModel.model, effort: 'high' })
      expect(controller.snapshot().items.filter(item => item.type === 'userMessage' && item.text === 'DIALOG_SECOND')).toHaveLength(1)
      await controller.command({ type: 'mode', mode: 'terminal' })
      await expect(controller.command({ ...command, commandId: 'stale' })).rejects.toThrow('Display control changed')
      terminal.write('TERMINAL_THIRD')
      await new Promise(resolve => setTimeout(resolve, 300))
      terminal.write('\r')
      await until(() => controller.snapshot().items.filter(item => item.type === 'agentMessage' && item.status === 'completed').length === 3)
      expect(controller.snapshot().threadId).toBe(threadId)
      expect(controller.snapshot().items.filter(item => item.type === 'userMessage').map(item => item.text)).toEqual(['TERMINAL_FIRST', 'DIALOG_SECOND', 'TERMINAL_THIRD'])
      expect(fixture.responseRequests.find(request => request.input.includes('TERMINAL_THIRD'))).toMatchObject({ model: selectedModel.model, effort: 'high' })
      await until(() => payloads.filter(payload => payload.terminalId === 'managed-probe' && payload.event === 'Stop').length === 3)
      const launch2 = await second.start({ command: bin!, args: hookArgs, cwd: fixture.cwd, env: envFor('managed-second') })
      secondTerminal = pty.spawn(launch2.command, [...launch2.args, '--no-alt-screen'], { cwd: fixture.cwd, env: { ...envFor('managed-second'), ...launch2.env } as Record<string, string>, cols: 120, rows: 35, useConpty: true, useConptyDll: true })
      let output2 = '', reviewed2 = false
      secondTerminal.onData(data => {
        output2 += data
        if (data.includes('\x1b[6n')) secondTerminal?.write('\x1b[1;1R')
        if (!reviewed2 && output2.includes('hooks are new or changed.')) { reviewed2 = true; setTimeout(() => secondTerminal?.write('2\r'), 400) }
      })
      await until(() => second.snapshot().connection === 'ready')
      const secondState = await second.command({ type: 'mode', mode: 'conversation' })
      await second.command({ type: 'send', text: 'SECOND_SESSION', commandId: 'second-session', controlEpoch: secondState.controlEpoch })
      await until(() => payloads.some(payload => payload.terminalId === 'managed-second' && payload.event === 'Stop'))
      expect(second.snapshot().threadId).not.toBe(threadId)
      for (const [id, expectedThread] of [['managed-probe', threadId], ['managed-second', second.snapshot().threadId]]) {
        const events = payloads.filter(payload => payload.terminalId === id && payload.event === 'UserPromptSubmit')
        expect(events.length).toBe(id === 'managed-probe' ? 3 : 1)
        expect(new Set(events.map(payload => payload.sessionId))).toEqual(new Set([expectedThread]))
      }
      await until(() => !controller.snapshot().turnId)
      const approvalState = await controller.command({ type: 'mode', mode: 'conversation' })
      // The command fixture intentionally uses the fallback model's exec_command tool schema.
      // Restore it after independently verifying model/effort on both real HTTP turns above.
      await (controller as any).call('thread/settings/update', { threadId, model: 'probe', effort: 'medium' })
      await until(() => controller.snapshot().model === 'probe')
      await controller.command({ type: 'send', text: 'FIXTURE_COMMAND', commandId: 'tool-command', controlEpoch: approvalState.controlEpoch })
      await until(() => controller.snapshot().approvals.length === 1)
      const approval = controller.snapshot().approvals[0]
      expect(approval.kind).toBe('command')
      await controller.command({ type: 'approve', requestId: approval.id, decision: 'accept', controlEpoch: approvalState.controlEpoch })
      await until(() => !controller.snapshot().turnId)
      expect(controller.snapshot().items.find(item => item.type === 'commandExecution')).toMatchObject({ status: 'completed', text: expect.stringContaining('MANAGED_COMMAND_OK') })
      expect(controller.snapshot().approvals).toHaveLength(0)
      await mkdir('artifacts/codex-dual-mode', { recursive: true })
      await writeFile('artifacts/codex-dual-mode/managed.json', JSON.stringify({ threadId, snapshots, payloads, output }, null, 2))
    } finally {
      terminal?.kill(); secondTerminal?.kill(); await Promise.all([controller.dispose(), second.dispose()]); await bridge.stop(); await fixture.close()
    }
    expect(controller.snapshot().connection).toBe('closed')
    for (const runtime of [controller, second]) {
      const pid = (runtime as any).child?.pid
      if (pid) expect(() => process.kill(pid, 0)).toThrow()
    }
  }, 90000)
})
