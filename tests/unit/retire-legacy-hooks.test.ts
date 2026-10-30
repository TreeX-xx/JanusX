import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, symlink, access, chmod, stat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { workspaceIo } from '@janus-agent/agent-core'

const faults = vi.hoisted(() => ({ write: '', unlink: '', change: '', writes: [] as string[] }))
vi.mock('@janus-agent/agent-core', async original => {
  const core = await original<typeof import('@janus-agent/agent-core')>()
  return { ...core, writeIoFile: async (...args: Parameters<typeof core.writeIoFile>) => {
    faults.writes.push(args[1])
    if (faults.write && args[1].includes(faults.write)) throw new Error('write failure')
    await core.writeIoFile(...args)
    if (faults.change && args[1].startsWith(faults.change + '.')) await writeFile(faults.change, '{"userSaved":true}')
  } }
})
vi.mock('node:fs/promises', async original => {
  const fs = await original<typeof import('node:fs/promises')>()
  return { ...fs, unlink: async (path: string) => {
    if (faults.unlink && path.endsWith(faults.unlink)) throw new Error('unlink failure')
    return fs.unlink(path)
  } }
})
vi.mock('electron', () => ({ app: { isPackaged: true, getAppPath: () => '/unused' } }))
import { assertHookCleanupIdle, retireLegacyHooks, type LegacyHookLocations } from '../../src/main/notifications/retire-legacy-hooks'
import { AgentHookConfigManager } from '../../src/main/notifications/agent-hook-config'

let base: string, locations: LegacyHookLocations
const oldCommand = "powershell -File 'C:/old/janusx-hook.ps1' -Marker 'janusx-hook-v1'"
const command = (text = oldCommand) => ({ type: 'command', command: text })
const config = (hooks: unknown[] = [command()]) => ({ model: 'user-model', hooks: { Stop: [{ matcher: '*', hooks }] } })
const claude = () => join(locations.homeDir, '.claude', 'settings.json')
const sender = () => join(locations.homeDir, '.janusx', 'hooks', 'janusx-agent-hook.ps1')
const run = (unused: () => void = () => {}) => retireLegacyHooks(locations, unused)
async function put(path: string, text: string) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text) }
async function oldSender() { await put(sender(), await readFile('tests/fixtures/hooks/legacy-sender-v095.ps1', 'utf8')) }
beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'janus-retire-hooks-')))
  locations = { homeDir: join(base, 'home'), userDataDir: join(base, 'profile') }
  faults.write = ''; faults.unlink = ''; faults.change = ''; faults.writes = []
})
afterEach(async () => {
  await vi.waitFor(() => expect((workspaceIo as any).outstanding).toBe(0))
  await rm(base, { recursive: true, force: true })
})

it('removes owned commands while preserving user Hooks, unknown shapes, comments, BOM and unrelated settings', async () => {
  const data = config([command(), command('echo user-hook'), { type: 'prompt', prompt: 'user prompt' }, null])
  const raw = '\uFEFF// user comment\r\n' + JSON.stringify(data, null, 2).replace(/\n/g, '\r\n')
  await put(claude(), raw)
  const result = await run()
  expect(result.commands).toBe(1); expect(result.retained).toEqual([])
  const after = await readFile(claude(), 'utf8')
  expect(after.startsWith('\uFEFF// user comment\r\n')).toBe(true)
  expect(after).toContain('"model": "user-model"')
  expect(after).toContain('echo user-hook'); expect(after).toContain('user prompt')
  expect(after).not.toContain('janusx-hook-v1')
  expect(after).toContain('null')
  expect((await run()).commands).toBe(0)
  expect(faults.writes).toHaveLength(1)
  expect(faults.writes[0]).toMatch(/settings\.json\..*\.tmp$/)
})

it('removes emptied owned groups and events without changing preexisting user empty arrays', async () => {
  await put(claude(), JSON.stringify({ model: 'user-model', hooks: {
    Stop: [{ hooks: [command()] }, { hooks: [command('echo user-hook')] }],
    SessionStart: [{ hooks: [command()] }], UserPromptSubmit: [],
  } }))
  expect((await run()).commands).toBe(2)
  expect(JSON.parse(await readFile(claude(), 'utf8'))).toEqual({ model: 'user-model', hooks: {
    Stop: [{ hooks: [command('echo user-hook')] }], UserPromptSubmit: [],
  } })
})

it.each([
  "'C:/Program Files/JanusX/JanusX.exe' '--janusx-hook' '--source' 'codex' '--event' 'Stop' '--janusx-hook-marker' 'janusx-agent-hook-v2'",
  "& 'C:/Users/Test/.janusx/hooks/janusx-hook-runner.exe' 'C:/Users/Test/.janusx/hooks/janusx-agent-hook.ps1' 'codex' 'Stop' 'janusx-agent-hook-v2'",
  "'C:/Users/Test/.janusx/hooks/janusx-hook-runner.exe' 'C:/Users/Test/.janusx/hooks/janusx-agent-hook.ps1' 'claude' 'Stop' 'janusx-agent-hook-v2'",
  "powershell -NoProfile -ExecutionPolicy Bypass -Command 'if (-not (Test-Path -LiteralPath ''C:/old/janusx-agent-hook.ps1'')) { exit 0 }; & ''C:/old/janusx-agent-hook.ps1'' -Source ''codex'' -EventName ''Stop'' -Marker ''janusx-agent-hook-v2'''",
])('recognizes an actual legacy command form: %s', async text => {
  await put(claude(), JSON.stringify(config([command(text)])))
  expect((await run()).commands).toBe(1)
})

it.each([
  'echo janusx-agent-hook-v2',
  "echo --janusx-hook-marker 'janusx-agent-hook-v2' --janusx-hook",
  oldCommand + '; echo user-custom-command',
  "powershell -Command \"Write-Host user-action; & 'C:/old/janusx-hook.ps1' -Marker 'janusx-hook-v1'\"",
  "powershell -Command \"& 'C:/old/janusx-hook.ps1' -Marker 'janusx-hook-v1'; Write-Host user-action\"",
  oldCommand.replace('janusx-hook-v1', 'janusx-hook-v10'),
  "powershell -File 'C:/user/tool.ps1' -Marker 'janusx-hook-v1'",
])('preserves ambiguous or customized commands: %s', async text => {
  const raw = JSON.stringify(config([command(text)])); await put(claude(), raw)
  expect((await run()).commands).toBe(0)
  expect(await readFile(claude(), 'utf8')).toBe(raw)
  expect(faults.writes).toEqual([])
})

it('cleans both default and configured provider homes and never touches Codex trust or sessions', async () => {
  locations.claudeConfigDir = join(base, 'custom-claude'); locations.codexHome = join(base, 'custom-codex')
  const paths = [claude(), join(locations.homeDir, '.codex', 'hooks.json'), join(locations.claudeConfigDir, 'settings.json'), join(locations.codexHome, 'hooks.json')]
  for (const path of paths) await put(path, JSON.stringify(config()))
  const trust = join(locations.codexHome, 'config.toml'), session = join(locations.codexHome, 'sessions', 'history.jsonl')
  await put(trust, '[hooks.trust]\ntrusted_hash = "native-review"\n'); await put(session, 'native history')
  expect((await run()).commands).toBe(4)
  expect(await readFile(trust, 'utf8')).toContain('native-review')
  expect(await readFile(session, 'utf8')).toBe('native history')
})

it.each(['{bad', '{"hooks":{},"hooks":{"Stop":[]}}', '[]'])('retains malformed or ambiguous configuration and its sender: %s', async text => {
  await put(claude(), text); await oldSender()
  const result = await run()
  expect(result.retained).toEqual(expect.arrayContaining([expect.objectContaining({ path: claude() }), expect.objectContaining({ path: sender() })]))
  expect(await readFile(claude(), 'utf8')).toBe(text); await access(sender())
})

it('never follows a linked configuration parent', async () => {
  const outside = join(base, 'outside'); await put(join(outside, 'settings.json'), JSON.stringify(config()))
  await mkdir(locations.homeDir, { recursive: true })
  await symlink(outside, dirname(claude()), process.platform === 'win32' ? 'junction' : 'dir')
  const result = await run()
  expect(result.commands).toBe(0); expect(result.retained[0].reason).toContain('Linked')
  expect(await readFile(join(outside, 'settings.json'), 'utf8')).toContain('janusx-hook-v1')
})

it.skipIf(process.platform === 'win32')('never follows a linked configuration file', async () => {
  const outside = join(base, 'outside.json'); await put(outside, JSON.stringify(config()))
  await mkdir(dirname(claude()), { recursive: true }); await symlink(outside, claude())
  expect((await run()).retained[0].reason).toContain('Linked')
  expect(await readFile(outside, 'utf8')).toContain('janusx-hook-v1')
})

it('retains a concurrent user edit instead of replacing it with stale settings', async () => {
  await put(claude(), JSON.stringify(config())); faults.change = claude()
  const result = await run()
  expect(result.commands).toBe(0); expect(result.retained[0].reason).toContain('changed during cleanup')
  expect(await readFile(claude(), 'utf8')).toBe('{"userSaved":true}')
})

it.skipIf(process.platform === 'win32')('preserves private native file permissions', async () => {
  await put(claude(), JSON.stringify(config())); await chmod(claude(), 0o600)
  expect((await run()).commands).toBe(1)
  expect((await stat(claude())).mode & 0o777).toBe(0o600)
})

it('clears verified sender bytes and obsolete OpenCode configuration while preserving current assets and unknown files', async () => {
  await put(claude(), JSON.stringify(config())); await oldSender()
  await put(join(dirname(sender()), 'janusx-hook-runner.cs'), await readFile('tests/fixtures/hooks/legacy-runner-v095.cs', 'utf8'))
  const directory = join(locations.userDataDir, 'janusx', 'hooks', 'opencode')
  await put(join(directory, 'opencode.json'), JSON.stringify({ $schema: 'https://opencode.ai/config.json' }))
  await put(join(directory, 'janusx-agent-hook-marker.json'), JSON.stringify({ owner: 'JanusX', marker: 'janusx-agent-hook-v2' }))
  const current = join(directory, 'plugins', 'janusx-notify.js'), unknown = join(dirname(sender()), 'user.txt')
  await put(current, 'current plugin'); await put(unknown, 'keep')
  const binary = join(dirname(sender()), 'janusx-hook-runner.exe'); await put(binary, 'unknown executable')
  const result = await run()
  expect(result.files).toHaveLength(4)
  await expect(access(sender())).rejects.toThrow()
  expect(await readFile(current, 'utf8')).toBe('current plugin'); expect(await readFile(unknown, 'utf8')).toBe('keep')
  expect(await readFile(binary, 'utf8')).toBe('unknown executable')
  expect(result.retained).toEqual([expect.objectContaining({ path: binary })])
})

it('keeps edited senders, unmarked OpenCode config and user-modified additional config', async () => {
  await oldSender(); await writeFile(sender(), (await readFile(sender(), 'utf8')) + '\n# user edit')
  const directory = join(locations.userDataDir, 'janusx', 'hooks', 'opencode')
  await put(join(directory, 'opencode.json'), JSON.stringify({ $schema: 'https://opencode.ai/config.json' }))
  let result = await run()
  expect(result.files).toEqual([]); expect(result.retained).toHaveLength(2)
  await put(join(directory, 'janusx-agent-hook-marker.json'), JSON.stringify({ owner: 'JanusX', marker: 'janusx-agent-hook-v2' }))
  await put(join(directory, 'opencode.json'), JSON.stringify({ model: 'user/model' }))
  result = await run()
  expect(await readFile(join(directory, 'opencode.json'), 'utf8')).toContain('user/model')
  expect(result.retained.some(item => item.path.endsWith('opencode.json'))).toBe(true)
})

it('retries failed configuration writes and sender deletion without reimporting anything', async () => {
  await put(claude(), JSON.stringify(config())); await oldSender()
  faults.write = 'settings.json'
  expect((await run()).retained.some(item => item.reason.includes('write failure'))).toBe(true)
  await access(sender()); expect(await readFile(claude(), 'utf8')).toContain('janusx-hook-v1')
  faults.write = ''; faults.unlink = 'janusx-agent-hook.ps1'
  expect((await run()).commands).toBe(1); await access(sender())
  faults.unlink = ''
  expect((await run()).files).toEqual([sender()])
  expect((await run()).files).toEqual([])
})

it('coalesces requests, blocks terminal starts during cleanup and releases the gate after failure', async () => {
  const blocked = run(() => { throw new Error('active terminal') })
  expect(run()).toBe(blocked)
  expect(() => assertHookCleanupIdle()).toThrow('cleanup is in progress')
  await expect(blocked).rejects.toThrow('active terminal')
  expect(() => assertHookCleanupIdle()).not.toThrow()
  expect(await run()).toEqual({ commands: 0, files: [], retained: [] })
})

it('does not reinstall global entries when preparing new launch assets after cleanup', async () => {
  await put(claude(), JSON.stringify(config())); await run()
  const cleaned = await readFile(claude(), 'utf8')
  const manager = new AgentHookConfigManager({ homeDir: locations.homeDir, userDataDir: join(locations.userDataDir, 'janusx'), platform: 'linux', compileHookRunner: false })
  await manager.ensureInstalled('claude'); await manager.ensureInstalled('codex')
  expect(await readFile(claude(), 'utf8')).toBe(cleaned)
  expect(await readFile(manager.getClaudeSettingsPath(), 'utf8')).toContain('janusx-agent-hook-v2')
})

it.each(['claude', 'codex'] as const)('cleans exact %s generated commands including matcher arguments and quoted paths', async engine => {
  for (const mode of ['posix', 'fallback', 'runner'] as const) {
    const assets = join(locations.userDataDir, "JanusX '中文 " + mode)
    const manager = new AgentHookConfigManager({ homeDir: locations.homeDir, userDataDir: assets,
      platform: mode === 'posix' ? 'linux' : 'win32', compileHookRunner: false, executablePath: '/usr/local/bin/janusx' })
    if (mode === 'runner') await put(manager.getHookRunnerPath()!, 'fixture runner')
    await manager.ensureInstalled(engine)
    const generated = await readFile(engine === 'claude' ? manager.getClaudeSettingsPath() : manager.getCodexHooksPath(), 'utf8')
    const native = engine === 'claude' ? claude() : join(locations.homeDir, '.codex', 'hooks.json')
    await put(native, generated)
    const expected = Object.values(JSON.parse(generated).hooks).flatMap((groups: any) => groups.flatMap((group: any) => group.hooks)).length
    const result = await run()
    expect(result.commands, mode).toBe(expected)
    expect(await readFile(native, 'utf8')).not.toContain('janusx-agent-hook-v2')
    expect(await readFile(engine === 'claude' ? manager.getClaudeSettingsPath() : manager.getCodexHooksPath(), 'utf8')).toBe(generated)
  }
})
