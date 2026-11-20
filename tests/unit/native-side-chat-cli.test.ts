import { expect, it, vi } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CODEX_CONVERSATION_CAPABILITIES, type ConversationSnapshot } from '../../src/shared/conversation-display'
import { CodexManagedTransport } from '../../src/main/terminal/codex-managed-transport'
import { openCodexSideChat } from '../../src/main/terminal/codex-side-chat'
import { hookCliFixture } from '../helpers/hook-cli-fixture'

const binary = process.env.JANUSX_TEST_CODEX_BIN

// The fixture runs the CLI without executing any tools or spawning agent processes.
async function closeFixtureProcess(child: ChildProcess | undefined) {
  if (child?.exitCode !== null || child.signalCode !== null) return
  const closed = once(child, 'close')
  child.kill()
  await closed
}

it.skipIf(!binary)('forks and continues a Codex side thread through a real app-server', async () => {
  const fixture = await hookCliFixture({ codexLiveProbe: true })
  const options = { command: binary!, args: [], cwd: fixture.cwd, env: fixture.env, assetsDir: fixture.root }
  const turns = new Set<string>()
  const parent = new CodexManagedTransport(({ method, params }) => {
    if (method === 'turn/completed' && params.turn.status === 'completed') turns.add(params.turn.id)
  }, () => {})
  try {
    await writeFile(join(fixture.env.CODEX_HOME!, 'config.toml'), [
      'model="gpt-5.4"', 'model_provider="local"', 'check_for_update_on_startup=false',
      '[model_providers.local]', 'name="Local fixture"', `base_url="${fixture.url}/v1"`, 'wire_api="responses"', 'requires_openai_auth=false',
    ].join('\n'))
    await parent.start(options)
    const { thread } = await parent.call('thread/start', { cwd: fixture.cwd, sandbox: 'read-only', approvalPolicy: 'never' })
    const snapshot = { threadId: thread.id, turnId: null, items: [], model: 'gpt-5.4', effort: 'medium', capabilities: CODEX_CONVERSATION_CAPABILITIES } as ConversationSnapshot
    const empty = await openCodexSideChat(options, snapshot, new AbortController().signal)
    try {
      const abort = new AbortController()
      await expect(empty.ask('CANCEL_EMPTY_SIDE', () => abort.abort(), abort.signal)).resolves.toBe('OK')
      expect(abort.signal.aborted).toBe(true)
    } finally { await empty.dispose() }
    const { turn } = await parent.call('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'MAIN_HISTORY', text_elements: [] }] })
    await vi.waitFor(() => expect(turns.has(turn.id)).toBe(true))
    const side = await openCodexSideChat(options, snapshot, new AbortController().signal)
    try {
      const publish = vi.fn()
      const signal = new AbortController().signal
      await expect(side.ask('SIDE_FIRST', publish, signal)).resolves.toBe('OK')
      expect(publish).toHaveBeenCalledWith('OK')
      await expect(side.ask('SIDE_NEXT', publish, signal)).resolves.toBe('OK')
      expect(fixture.responseRequests.at(-1)?.input).toContain('MAIN_HISTORY')
      expect(fixture.responseRequests.at(-1)?.input).toContain('SIDE_FIRST')
      expect(fixture.responseRequests.at(-1)?.input).toContain('SIDE_NEXT')
      const next = await parent.call('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'MAIN_NEXT', text_elements: [] }] })
      await vi.waitFor(() => expect(turns.has(next.turn.id)).toBe(true))
      expect(fixture.responseRequests.at(-1)?.input).not.toContain('SIDE_FIRST')
      expect(fixture.responseRequests.at(-1)?.input).toContain('MAIN_NEXT')
    } finally { await side.dispose() }
  } finally { await parent.stop(); await fixture.close(); await rm(fixture.root, { recursive: true, force: true }) }
}, 30000)

it.skipIf(!process.env.JANUSX_TEST_CLAUDE_BIN)('forks from the completed Claude transcript and continues under the child session ID', async () => {
  const { randomUUID } = await import('node:crypto')
  const { claudeConversationFixture } = await import('../helpers/claude-conversation-fixture')
  const { openClaudeSideChat } = await import('../../src/main/terminal/claude-side-chat')
  const { runSideChatProcess } = await import('../../src/main/terminal/side-chat-process')
  const fixture = await claudeConversationFixture()
  const binary = process.env.JANUSX_TEST_CLAUDE_BIN!
  const threadId = randomUUID()
  const signal = new AbortController().signal
  const settings = join(fixture.config, 'settings.json')
  const options = { binary, cwd: fixture.cwd, env: fixture.env, configDir: fixture.config, settings }
  try {
    let completed = false
    await runSideChatProcess(binary, ['--print', '--output-format', 'stream-json', '--verbose', '--tools', '',
      '--session-id', threadId, '--model', 'claude-sonnet-4-6', 'CC_PARENT'], fixture.cwd, fixture.env, signal, frame => {
      if (frame.type === 'result' && !frame.is_error) completed = true
    })
    expect(completed).toBe(true)
    const snapshot = { threadId, turnId: null, model: 'claude-sonnet-4-6', effort: 'medium' } as ConversationSnapshot
    const side = await openClaudeSideChat(options, snapshot, signal)
    try {
      const publish = vi.fn()
      await expect(side.ask('CC_SIDE_FIRST', publish, signal)).resolves.toContain('CC_SIDE_FIRST')
      expect(publish).toHaveBeenCalled()
      await expect(side.ask('CC_SIDE_NEXT', publish, signal)).resolves.toContain('CC_SIDE_NEXT')
      const next = fixture.requests.findLast(request => request.marker === 'CC_SIDE_NEXT')
      expect(JSON.stringify(next?.messages)).toContain('CC_PARENT')
      expect(JSON.stringify(next?.messages)).toContain('CC_SIDE_FIRST')
      expect(next?.tools ?? []).toHaveLength(0)
      const abort = new AbortController()
      await expect(side.ask('CC_CANCEL', () => abort.abort(), abort.signal)).resolves.toContain('CC_CANCEL')
      expect(abort.signal.aborted).toBe(true)
    } finally { await side.dispose() }
  } finally { await fixture.close(); await rm(fixture.root, { recursive: true, force: true }) }
}, 40000)

it.skipIf(!process.env.JANUSX_TEST_OPENCODE_BIN)('forks OpenCode before the active parent prompt and continues with its own history', async () => {
  const { OpenCodeConversation } = await import('../../src/main/terminal/opencode-conversation')
  const { nativeConversationFixture } = await import('../helpers/native-conversation-fixture')
  const f = await nativeConversationFixture()
  const c = new OpenCodeConversation('open-code-side-test', () => {})
  f.env.OPENCODE_TEST_HOME = f.root
  f.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ model: 'fixture/fixture', update: 'disable', share: 'disabled', snapshots: false,
    providers: { fixture: { package: '@ai-sdk/openai-compatible', settings: { baseURL: f.url, apiKey: 'fixture' }, models: {
      fixture: { limit: { context: 32000, output: 1000 }, capabilities: { input: ['text'], output: ['text'], tools: false } },
    } } } })
  try {
    await c.start({ command: process.env.JANUSX_TEST_OPENCODE_BIN!, args: [], cwd: f.cwd, env: f.env, assetsDir: join(f.root, 'assets') })
    const { controlEpoch, threadId } = await c.command({ type: 'mode', mode: 'conversation' })
    await c.command({ type: 'send', commandId: 'parent', text: 'NATIVE_PARENT', controlEpoch })
    await vi.waitFor(() => {
      expect(c.state.turnId).toBeNull()
      expect(c.state.items.some(item => item.text === 'First NATIVE_PARENT final')).toBe(true)
    }, { timeout: 10000 })
    await c.command({ type: 'send', commandId: 'live', text: 'NATIVE_LIVE', controlEpoch })
    await vi.waitFor(() => expect(c.state.turnId).not.toBeNull())
    const signal = new AbortController().signal
    const side = await c.openSideChat(threadId!, signal)
    try {
      await expect(side.ask('NATIVE_SIDE', () => {}, signal)).resolves.toContain('First NATIVE_SIDE final')
      const abort = new AbortController()
      await expect(side.ask('NATIVE_CANCEL', () => abort.abort(), abort.signal)).resolves.toContain('NATIVE_CANCEL')
      expect(abort.signal.aborted).toBe(true)
      await expect(side.ask('NATIVE_FOLLOWUP', () => {}, signal)).resolves.toContain('First NATIVE_FOLLOWUP final')
      const input = JSON.stringify(f.requestBodies.at(-1)?.messages)
      expect(input).toContain('NATIVE_PARENT')
      expect(input).toContain('NATIVE_SIDE')
      expect(input).not.toContain('NATIVE_LIVE')
      expect(c.state.threadId).toBe(threadId)
      expect(c.state.items.some(item => item.text.includes('NATIVE_SIDE'))).toBe(false)
    } finally { await side.dispose() }
  } finally {
    await closeFixtureProcess((c as unknown as { child?: ChildProcess }).child)
    await c.dispose(); f.close(); await rm(f.root, { recursive: true, force: true })
  }
}, 40000)

it.skipIf(!process.env.JANUSX_TEST_PI_BIN)('branches an active Pi terminal and runs side prompts from its native branch file', async () => {
  const { spawnProcess, stopOwnedProcess } = await import('../../src/main/platform/process-host')
  const { PiConversation } = await import('../../src/main/terminal/extension-conversation')
  const { nativeConversationFixture } = await import('../helpers/native-conversation-fixture')
  const f = await nativeConversationFixture()
  const c = new PiConversation('pi-side-test', () => {})
  let terminal: ReturnType<typeof spawnProcess> | undefined
  let output = ''
  try {
    await writeFile(join(f.config, 'models.json'), JSON.stringify({ providers: {
      fixture: { baseUrl: f.url, api: 'openai-completions', apiKey: 'fixture', models: [{ id: 'fixture', contextWindow: 32000, maxTokens: 1000 }] },
    } }))
    const launch = await c.start({ command: process.env.JANUSX_TEST_PI_BIN!, args: ['--mode', 'rpc', '--provider', 'fixture', '--model', 'fixture', '--no-tools'],
      cwd: f.cwd, env: f.env, assetsDir: join(f.root, 'assets') })
    terminal = spawnProcess(launch.command, launch.args, { cwd: f.cwd, env: f.env, stdio: ['pipe', 'pipe', 'pipe'] })
    terminal.stdout?.on('data', text => { output = (output + text).slice(-5000) })
    terminal.stderr?.on('data', text => { output = (output + text).slice(-5000) })
    await vi.waitFor(() => expect(c.state.connection, output).toBe('ready'), { timeout: 20000 })
    const { controlEpoch, threadId } = await c.command({ type: 'mode', mode: 'conversation' })
    await c.command({ type: 'send', commandId: 'parent', text: 'NATIVE_PARENT', controlEpoch })
    await vi.waitFor(() => {
      expect(c.state.turnId).toBeNull()
      expect(c.state.items.some(item => item.text === 'First NATIVE_PARENT final')).toBe(true)
    }, { timeout: 10000 })
    await c.command({ type: 'send', commandId: 'live', text: 'NATIVE_LIVE', controlEpoch })
    await vi.waitFor(() => expect(c.state.turnId).not.toBeNull())
    const signal = new AbortController().signal
    const side = await c.openSideChat(threadId!, signal)
    try {
      await expect(side.ask('NATIVE_SIDE', () => {}, signal)).resolves.toContain('First NATIVE_SIDE final')
      const abort = new AbortController()
      await expect(side.ask('NATIVE_CANCEL', () => abort.abort(), abort.signal)).resolves.toContain('NATIVE_CANCEL')
      expect(abort.signal.aborted).toBe(true)
      await expect(side.ask('NATIVE_FOLLOWUP', () => {}, signal)).resolves.toContain('First NATIVE_FOLLOWUP final')
      const sent = f.requestBodies.findLast(body => JSON.stringify(body.messages).includes('NATIVE_FOLLOWUP'))
      const input = JSON.stringify(sent?.messages)
      expect(input).toContain('NATIVE_PARENT')
      expect(input).toContain('NATIVE_SIDE')
      expect(input).not.toContain('NATIVE_LIVE')
      expect(c.state.threadId).toBe(threadId)
    } finally { await side.dispose() }
  } finally {
    if (terminal) await stopOwnedProcess(terminal)
    await c.dispose(); f.close(); await rm(f.root, { recursive: true, force: true })
  }
}, 45000)

it.skipIf(!process.env.JANUSX_TEST_DSH_BIN)('forks DSH in its native agent host and isolates an active parent and side stop', async () => {
  const { mkdir, realpath, symlink } = await import('node:fs/promises')
  const { dirname } = await import('node:path')
  const { pathToFileURL } = await import('node:url')
  const { spawnProcess } = await import('../../src/main/platform/process-host')
  const { findCliPackage } = await import('../../src/main/external-cli/package-location')
  const { DshConversation } = await import('../../src/main/terminal/extension-conversation')
  const { nativeConversationFixture } = await import('../helpers/native-conversation-fixture')
  const f = await nativeConversationFixture()
  const c = new DshConversation('dsh-side-test', () => {})
  let child: ReturnType<typeof spawnProcess> | undefined
  let output = ''
  const binary = await realpath(process.env.JANUSX_TEST_DSH_BIN!)
  const cli = findCliPackage(binary, '@deepseek-ai/dsh')!
  const nodeModules = dirname(dirname(cli))
  f.env.DSH_HOME = join(f.root, 'dsh')
  f.env.DSH_TELEMETRY_DISABLED = '1'
  f.env.DEEPSEEK_API_KEY = 'fixture'
  f.env.DEEPSEEK_BASE_URL = f.url
  const profile = join(f.env.DSH_HOME, 'profiles/dsh-tui')
  const fixture = join(f.root, 'agent.mjs')
  try {
    await mkdir(profile, { recursive: true })
    await symlink(nodeModules, join(profile, 'node_modules'), 'junction')
    await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'fixture', private: true,
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }))
    await writeFile(join(profile, 'cordis.yml'), '[]')
    await writeFile(fixture, `import { randomUUID } from 'node:crypto'
export const inject = ['llm', 'agents', 'agentLoop']
export function apply(ctx) {
  ctx.on('llm/stream', options => (async function* () {
    const all = JSON.stringify(options.messages)
    const marker = all.match(/NATIVE_[A-Z]+/g)?.at(-1)
    const text = marker + ' parent=' + all.includes('NATIVE_PARENT') + ' active=' + all.includes('NATIVE_LIVE')
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    await new Promise(resolve => setTimeout(resolve, ['NATIVE_CANCEL', 'NATIVE_LIVE'].includes(marker) ? 3000 : 50))
    if (options.signal?.aborted) throw options.signal.reason
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })())
  void ctx.agents.create({ sessionId: 'session-' + randomUUID(), meta: { cwd: process.cwd() },
    agentOptions: { provider: 'deepseek', model: 'deepseek-v4-flash' } }).catch(error => process.stderr.write(String(error)))
  process.stdin.resume()
}`)
    await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([{ insert: [{ id: 'fixture-agent', name: pathToFileURL(fixture).href }] }]))
    const launch = await c.start({ command: binary, args: ['--profile', 'dsh-tui'], cwd: f.cwd, env: f.env, assetsDir: join(f.root, 'assets') })
    child = spawnProcess(launch.command, launch.args, { cwd: f.cwd, env: f.env, stdio: ['pipe', 'pipe', 'pipe'] })
    child.stdout?.on('data', text => { output = (output + text).slice(-6000) })
    child.stderr?.on('data', text => { output = (output + text).slice(-6000) })
    await vi.waitFor(() => expect(c.state.connection, output).toBe('ready'), { timeout: 12000 })
    const { controlEpoch, threadId } = await c.command({ type: 'mode', mode: 'conversation' })
    await c.command({ type: 'send', commandId: 'parent', text: 'NATIVE_PARENT', controlEpoch })
    await vi.waitFor(() => {
      expect(c.state.turnId).toBeNull()
      expect(c.state.items.some(item => item.text.includes('NATIVE_PARENT parent=true') && item.type === 'agentMessage')).toBe(true)
    }, { timeout: 6000 })
    await c.command({ type: 'send', commandId: 'live', text: 'NATIVE_LIVE', controlEpoch })
    await vi.waitFor(() => expect(c.state.turnId).not.toBeNull())
    const signal = new AbortController().signal
    const side = await c.openSideChat(threadId!, signal)
    try {
      await expect(side.ask('NATIVE_SIDE', () => {}, signal)).resolves.toBe('NATIVE_SIDE parent=true active=false')
      const abort = new AbortController()
      await expect(side.ask('NATIVE_CANCEL', () => abort.abort(), abort.signal)).resolves.toContain('NATIVE_CANCEL')
      expect(abort.signal.aborted).toBe(true)
      await expect(side.ask('NATIVE_FOLLOWUP', () => {}, signal)).resolves.toBe('NATIVE_FOLLOWUP parent=true active=false')
      expect(c.state.threadId).toBe(threadId)
      expect(c.state.items.some(item => item.text.includes('NATIVE_SIDE'))).toBe(false)
    } finally { await side.dispose() }
  } finally {
    await closeFixtureProcess(child)
    await c.dispose(); f.close(); await rm(f.root, { recursive: true, force: true })
  }
}, 35000)
