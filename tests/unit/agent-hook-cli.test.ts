import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parse, stringify } from 'smol-toml'
import { AgentHookBridge } from '../../src/main/notifications/agent-hook-bridge'
import { AgentHookCoordinator } from '../../src/main/notifications/agent-hook-coordinator'
import type { AgentHookPayload, AgentHookSemantic } from '../../src/main/notifications/agent-hook-types'
import { filesIn, hookCliFixture, runHookCli } from '../helpers/hook-cli-fixture'

vi.mock('../../src/main/notifications/desktop-toast-window', () => ({ desktopToastWindow: { show: vi.fn(() => true) } }))
vi.mock('electron', () => ({ app: { isPackaged: true, getPath: () => '/unused' } }))
const { AgentHookConfigManager } = await import('../../src/main/notifications/agent-hook-config')
const npm = join(process.env.APPDATA ?? '', 'npm/node_modules')
const bins = {
  claude: process.env.JANUSX_TEST_CLAUDE_BIN ?? join(npm, '@anthropic-ai/claude-code/bin/claude.exe'),
  codex: process.env.JANUSX_TEST_CODEX_BIN ?? join(npm, '@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe'),
  pi: process.env.JANUSX_TEST_PI_BIN ?? join(npm, '@earendil-works/pi-coding-agent/dist/bundle/cli.js'),
  opencode: process.env.JANUSX_TEST_OPENCODE_BIN ?? join(npm, '@opencode/cli/bin/opencode.exe'),
}
const enabled = process.env.JANUSX_TEST_REAL_CLIS === '1' && process.platform === 'win32'
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { vi.unstubAllEnvs(); for (const close of cleanup.splice(0).reverse()) await close() })

async function setup(engine: keyof typeof bins) {
  const fixture = await hookCliFixture()
  cleanup.push(() => process.env.JANUSX_TEST_KEEP_FIXTURES === '1' ? Promise.resolve() : rm(fixture.root, { recursive: true, force: true }), fixture.close)
  if (process.env.JANUSX_TEST_KEEP_FIXTURES === '1') console.info('Hook CLI fixture:', fixture.root)
  const payloads: AgentHookPayload[] = []
  const accepted: Array<{ id: string; semantic: AgentHookSemantic }> = []
  const coordinator = new AgentHookCoordinator(() => null, { deliverCompletion: () => true, deliverAttention: () => true,
    onResolvedPayload: (_payload, terminal, semantic) => { accepted.push({ id: terminal.terminalId, semantic }) },
  })
  const bridge = new AgentHookBridge({ onPayload: payload => { payloads.push(payload); coordinator.handleHookPayload(payload) } })
  await bridge.start()
  cleanup.push(() => bridge.stop())
  const manager = new AgentHookConfigManager({ homeDir: fixture.home, userDataDir: join(fixture.root, "userData space's 中文") })
  await manager.ensureInstalled(engine)
  if (engine === 'codex') await manager.checkCodexLaunchVersion(bins.codex)
  const openCodeMajor = engine === 'opencode' ? await manager.getOpenCodeMajor(bins.opencode) : undefined
  const launch = await manager.getLaunchArgs(engine, openCodeMajor)
  const envFor = (id: string) => {
    coordinator.registerTerminal({ terminalId: id, engine, workspaceId: 'workspace', cwd: fixture.cwd })
    return { ...fixture.env, ...manager.buildTerminalEnv({ terminalId: id, workspaceId: 'workspace', engine, openCodeMajor }, bridge.getEnv()) }
  }
  const run = (args: string[], env = envFor(engine)) => runHookCli(bins[engine], args, fixture.cwd, env)
  expect((await runHookCli(bins[engine], ['--version'], fixture.cwd, fixture.env)).code).toBe(0)
  return { ...fixture, manager, bridge, launch, payloads, accepted, envFor, run, openCodeMajor }
}

describe.skipIf(!enabled)('real CLI launch isolation (local model fixtures)', () => {
  it.skipIf(!existsSync(bins.claude))('Claude keeps user settings, adds hooks for one launch, then detaches', async () => {
    const f = await setup('claude')
    const settings = join(f.home, '.claude/settings.json')
    const original = '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"echo user-hook"}]}]}}\n'
    await writeFile(settings, original)
    const env = { ...f.envFor('claude'), ANTHROPIC_BASE_URL: f.url, ANTHROPIC_API_KEY: 'local-only' }
    const base = ['--print', '--model', 'probe', '--no-session-persistence', '--tools', '', '--output-format', 'json']
    const result = await f.run([...base, ...f.launch, 'Reply OK'], env)
    expect(result, result.stderr).toMatchObject({ code: 0 })
    // Native exit hooks can outlive the print process; keep the Bridge open.
    await vi.waitFor(() => expect(f.payloads.map(payload => payload.event)).toEqual(expect.arrayContaining(['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd'])), { timeout: 10000 })
    expect(f.accepted.map(event => event.semantic.type)).toEqual(expect.arrayContaining(['session-update', 'turn-start', 'turn-end', 'session-close']))
    const before = f.payloads.length
    expect((await f.run([...base, 'Reply OK'], env)).code).toBe(0)
    expect(f.payloads).toHaveLength(before)
    expect(await readFile(settings, 'utf8')).toBe(original)
    expect(await filesIn(f.cwd)).toEqual([])
  })

  it.skipIf(!existsSync(bins.pi))('Pi adds only the launch extension while retaining user extension discovery', async () => {
    const f = await setup('pi')
    const provider = join(f.root, 'provider.mjs')
    await writeFile(provider, `export default function(pi){pi.registerProvider('local-probe',{baseUrl:${JSON.stringify(f.url + '/v1')},apiKey:'local-only',api:'openai-completions',models:[{id:'probe',name:'Probe',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:128000,maxTokens:4096}]})}`)
    const userExtensions = join(f.home, '.pi/agent/extensions')
    await mkdir(userExtensions, { recursive: true })
    const sentinel = join(f.root, 'user-extension-fired')
    await writeFile(join(userExtensions, 'user.js'), `import {writeFileSync} from 'node:fs'; export default function(pi){pi.on('agent_start',()=>writeFileSync(${JSON.stringify(sentinel)},'yes'))}`)
    const base = ['--offline', '--no-session', '--no-context-files', '--no-skills', '--no-prompt-templates', '--no-themes', '--extension', provider, '--provider', 'local-probe', '--model', 'probe', '--no-tools', '--thinking', 'off', '--print']
    const result = await f.run([...base, ...f.launch, 'Reply OK'])
    expect(result, result.stderr).toMatchObject({ code: 0 })
    expect(f.payloads.map(payload => payload.event)).toEqual(['UserPromptSubmit', 'Stop'])
    expect(await readFile(sentinel, 'utf8')).toBe('yes')
    const before = f.payloads.length
    expect((await f.run([...base, 'Reply OK'])).code).toBe(0)
    expect(f.payloads).toHaveLength(before)
    expect(await filesIn(f.cwd)).toEqual([])
  })

  it.skipIf(!existsSync(bins.opencode))('OpenCode private servers keep two terminal identities in one workspace and detach without env injection', async () => {
    const f = await setup('opencode')
    const userPluginDir = join(f.root, 'user-plugin')
    await mkdir(userPluginDir)
    const sentinel = join(f.root, 'user-plugin-loaded')
    await writeFile(join(userPluginDir, 'server.js'), `import {writeFileSync} from 'node:fs'; export default {id:'user-plugin',setup(){writeFileSync(${JSON.stringify(sentinel)},'yes')}}`)
    const v1Plugin = join(userPluginDir, 'v1.js')
    await writeFile(v1Plugin, `import {writeFileSync} from 'node:fs'; export const UserPlugin=async()=>{writeFileSync(${JSON.stringify(sentinel)},'yes');return {}}`)
    const nativeDir = join(f.home, '.config/opencode')
    await mkdir(nativeDir, { recursive: true })
    const nativeConfig = join(nativeDir, 'opencode.json')
    const original = JSON.stringify({ $schema: 'https://opencode.ai/config.json', [f.openCodeMajor === 1 ? 'plugin' : 'plugins']: [f.openCodeMajor === 1 ? pathToFileURL(v1Plugin).href : userPluginDir.replace(/\\/g, '/')] })
    await writeFile(nativeConfig, original)
    const config = JSON.stringify({ provider: { 'local-probe': { npm: '@ai-sdk/openai-compatible', name: 'Local probe', options: { baseURL: f.url + '/v1', apiKey: 'local-only' }, models: { probe: { name: 'Probe', limit: { context: 128000, output: 4096 } } } } }, model: 'local-probe/probe', small_model: 'local-probe/probe' })
    vi.stubEnv('OPENCODE_CONFIG_CONTENT', config)
    const base = ['run', '--format', 'json', '--model', 'local-probe/probe']
    // Initialize the native DB/provider cache before exercising concurrent servers.
    // Concurrent first-ever native bootstrap is a separate provider boundary.
    const nativeEnv = { ...f.env, OPENCODE_CONFIG_CONTENT: config }
    expect((await f.run([...base, ...f.launch, 'Reply OK'], nativeEnv)).code).toBe(0)
    expect(f.payloads).toEqual([])
    expect(await readFile(sentinel, 'utf8')).toBe('yes')
    const ids = ['first', 'second']
    const results = await Promise.all(ids.map(id => f.run([...base, ...f.launch, 'Reply OK'], f.envFor(id))))
    for (const [index, id] of ids.entries()) {
      const result = results[index]
      expect(result, result.stderr).toMatchObject({ code: 0 })
      const events = f.payloads.filter(payload => payload.terminalId === id)
      expect(events.map(payload => payload.event)).toEqual(expect.arrayContaining(f.openCodeMajor === 1
        ? ['session.status', 'session.idle'] : ['session.execution.started', 'session.execution.succeeded']))
      expect(new Set(events.map(payload => payload.sessionId)).size).toBe(1)
      expect(events[0].sessionId).toBeTruthy()
      expect(f.accepted.filter(event => event.id === id).map(event => event.semantic.type).filter(type => type !== 'session-update')).toEqual(['turn-start', 'turn-end'])
    }
    expect(f.payloads.find(payload => payload.terminalId === 'first')?.sessionId).not.toBe(f.payloads.find(payload => payload.terminalId === 'second')?.sessionId)
    const before = f.payloads.length
    expect((await f.run([...base, ...f.launch, 'Reply OK'], nativeEnv)).code).toBe(0)
    expect(f.payloads).toHaveLength(before)
    expect(await readFile(nativeConfig, 'utf8')).toBe(original)
    expect(await filesIn(f.cwd)).toEqual([])
  })

  it.skipIf(!existsSync(bins.codex))('Codex keeps native hook sources and requires real native trust before delivery', async () => {
    const f = await setup('codex')
    const configPath = join(f.home, '.codex/config.toml')
    const nativeHooks = join(f.home, '.codex/hooks.json')
    const sentinel = join(f.root, 'native-hooks.log')
    const nativeCommand = (value: string) => `Add-Content -LiteralPath '${sentinel.replace(/'/g, "''")}' -Value '${value}'`
    const original = stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: nativeCommand('inline') }] }] } })
    await writeFile(configPath, original)
    await writeFile(nativeHooks, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: nativeCommand('file') }] }] } }))
    const originalHooks = await readFile(nativeHooks, 'utf8')
    const base = ['-c', 'model="probe"', '-c', 'model_provider="local"', '-c', `model_providers.local={name="Local probe",base_url="${f.url}/v1",wire_api="responses",requires_openai_auth=false}`, '-c', 'check_for_update_on_startup=false']
    const exec = ['exec', '--ephemeral', '--skip-git-repo-check', '--json', 'Reply OK']
    expect((await f.run([...base, ...f.launch, ...exec])).code).toBe(0)
    expect(f.payloads).toEqual([]) // A successful model response does not prove trusted hooks.
    expect(await readFile(configPath, 'utf8')).toBe(original)
    const pty = await import('node-pty')
    const terminal = pty.spawn(bins.codex, [...base, ...f.launch, '--no-alt-screen', 'Reply OK'], {
      cwd: f.cwd, env: { ...f.envFor('codex'), TERM: 'xterm-256color' } as Record<string, string>, name: 'xterm-256color', cols: 130, rows: 40, useConpty: true, useConptyDll: true,
    })
    let output = '', folder = false, reviewed = false, stopping = false
    const stop = () => { if (!stopping) { stopping = true; terminal.kill() } }
    await new Promise<void>((resolve, reject) => {
      const poll = setInterval(() => {
        if (reviewed && f.payloads.some(payload => payload.event === 'Stop')) { clearInterval(poll); clearTimeout(timer); stop() }
      }, 100)
      const timer = setTimeout(() => { clearInterval(poll); stop(); reject(new Error('native hook review timed out: ' + output.slice(-2000))) }, 30000)
      terminal.onData(data => {
        output += data
        if (data.includes('\u001b[6n')) terminal.write('\u001b[1;1R')
        if (!folder && output.includes('Trust and continue')) { folder = true; setTimeout(() => terminal.write('\r'), 400) }
        if (!reviewed && output.includes('Trust all and continue')) { reviewed = true; setTimeout(() => terminal.write('2\r'), 400) }
        if (reviewed && f.payloads.some(payload => payload.event === 'Stop')) { clearInterval(poll); clearTimeout(timer); stop() }
      })
      terminal.onExit(() => { clearInterval(poll); clearTimeout(timer); if (!reviewed) reject(new Error('native review did not open')); else resolve() })
    })
    expect(reviewed).toBe(true)
    const state = parse(await readFile(configPath, 'utf8')).hooks as { state: object }
    expect(state.state).toBeTruthy() // Records originate from Codex's review, never a computed hash.
    f.payloads.length = 0
    await writeFile(sentinel, '')
    expect((await f.run([...base, ...f.launch, ...exec])).code).toBe(0)
    expect(f.payloads.map(payload => payload.event)).toEqual(expect.arrayContaining(['SessionStart', 'UserPromptSubmit', 'Stop']))
    expect((await readFile(sentinel, 'utf8')).trim().split(/\r?\n/).sort()).toEqual(['file', 'inline'])
    const before = f.payloads.length
    expect((await f.run([...base, ...exec])).code).toBe(0)
    expect(f.payloads).toHaveLength(before)
    expect((await readFile(sentinel, 'utf8')).trim().split(/\r?\n/).sort()).toEqual(['file', 'file', 'inline', 'inline'])
    expect(await readFile(nativeHooks, 'utf8')).toBe(originalHooks)
    expect(await filesIn(f.cwd)).toEqual([])
  }, 90000)
})
