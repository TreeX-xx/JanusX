import { mkdir, mkdtemp, readFile, stat, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, expect, it, vi } from 'vitest'
import { CliDetector } from '../../src/main/external-cli/cli-detector'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => join(tmpdir(), 'janusx-test-user-data')),
    getAppPath: vi.fn(() => join(tmpdir(), 'janusx-app')),
    isPackaged: true,
  },
}))

const { AgentHookConfigManager, JANUSX_HOOK_COMMAND_MARKER, buildHookRunnerSource, buildWindowsHookScript } = await import(
  '../../src/main/notifications/agent-hook-config'
)
const electronApp = (await import('electron')).app as unknown as {
  getAppPath: ReturnType<typeof vi.fn>
  isPackaged: boolean
}

async function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'janusx-hook-test-'))
}

type ManagerOverrides = {
  userDataDir?: string
  executablePath?: string
  platform?: 'win32' | 'linux' | 'darwin'
  windowsHookRunnerPath?: string | null
  compileHookRunner?: boolean
}

function makeManager(homeDir: string, overrides: ManagerOverrides = {}) {
  return new AgentHookConfigManager({
    homeDir,
    userDataDir: overrides.userDataDir ?? join(homeDir, 'userData'),
    executablePath: overrides.executablePath ?? '/usr/local/bin/janusx',
    platform: overrides.platform ?? 'linux',
    // Deterministic legacy form by default: no runner compile, no runner path.
    windowsHookRunnerPath: overrides.windowsHookRunnerPath ?? null,
    compileHookRunner: overrides.compileHookRunner ?? false,
  })
}

describe('AgentHookConfigManager', () => {
  it('leaves older or unknown Codex versions out of the launch injection path', async () => {
    const root = await createTempDir(), binary = join(root, 'codex.exe')
    const detect = vi.spyOn(CliDetector.prototype, 'detect')
    try {
      const manager = makeManager(root)
      await writeFile(binary, 'old')
      detect.mockResolvedValue({ toolId: 'codex', installed: true, runnable: true, version: '0.164.0' })
      await expect(manager.checkCodexLaunchVersion(binary)).rejects.toThrow('require 0.165')
      await writeFile(binary, 'supported')
      detect.mockResolvedValue({ toolId: 'codex', installed: true, runnable: true, version: '0.165.0' })
      await expect(manager.checkCodexLaunchVersion(binary)).resolves.toBeUndefined()
      await manager.checkCodexLaunchVersion(binary)
      expect(detect).toHaveBeenCalledTimes(2)
    } finally { detect.mockRestore() }
  })

  it.each([1, 2] as const)('preserves OpenCode %s inline user plugins and native config directory', async major => {
    const manager = makeManager(await createTempDir())
    const key = major === 1 ? 'plugin' : 'plugins'
    vi.stubEnv('OPENCODE_CONFIG_CONTENT', JSON.stringify({ [key]: ['user-plugin'], model: 'user/model' }))
    vi.stubEnv('OPENCODE_CONFIG_DIR', 'user-native-dir')
    try {
      const env = manager.buildTerminalEnv({ engine: 'opencode', terminalId: 't', workspaceId: 'w', openCodeMajor: major }, {})
      expect(JSON.parse(env.OPENCODE_CONFIG_CONTENT)).toMatchObject({ [key]: ['user-plugin', expect.any(String)], model: 'user/model' })
      expect(env).not.toHaveProperty('OPENCODE_CONFIG_DIR')
      expect(process.env.OPENCODE_CONFIG_DIR).toBe('user-native-dir')
    } finally { vi.unstubAllEnvs() }
  })

  it('selects OpenCode adapters by the actual binary version and invalidates the probe after upgrade', async () => {
    const root = await createTempDir(), binary = join(root, 'opencode.exe')
    await writeFile(binary, 'v1')
    const detect = vi.spyOn(CliDetector.prototype, 'detect')
      .mockResolvedValue({ toolId: 'opencode', installed: true, runnable: true, version: '1.19.5' })
    try {
      const manager = makeManager(root)
      expect(await Promise.all([manager.getOpenCodeMajor(binary), manager.getOpenCodeMajor(binary)])).toEqual([1, 1])
      expect(detect).toHaveBeenCalledTimes(1)
      expect(detect).toHaveBeenCalledWith({ path: binary, source: 'path' })
      expect(await manager.getLaunchArgs('opencode', 1)).toEqual([])
      const v1 = JSON.parse(manager.buildTerminalEnv({ engine: 'opencode', terminalId: 't', workspaceId: 'w', openCodeMajor: 1 }, {}).OPENCODE_CONFIG_CONTENT)
      expect(v1.plugin[0]).toContain('v1.js')
      await writeFile(binary, 'changed v2 binary')
      detect.mockResolvedValue({ toolId: 'opencode', installed: true, runnable: true, version: '2.1.4' })
      expect(await manager.getOpenCodeMajor(binary)).toBe(2)
      expect(await manager.getLaunchArgs('opencode', 2)).toEqual(['--standalone'])
      await writeFile(binary, 'unknown future major')
      detect.mockResolvedValue({ toolId: 'opencode', installed: true, runnable: true, version: '3.0.0' })
      await expect(manager.getOpenCodeMajor(binary)).rejects.toThrow('unsupported')
    } finally { detect.mockRestore() }
  })

  it('keeps recovery hook assets in userData without writing the original provider homes', async () => {
    const homeDir = await createTempDir()
    const claudeConfigDir = join(homeDir, 'original-claude')
    const codexHome = join(homeDir, 'original-codex')
    const manager = new AgentHookConfigManager({ homeDir, claudeConfigDir, codexHome,
      userDataDir: join(homeDir, 'userData'), platform: 'linux', compileHookRunner: false })
    await manager.ensureInstalled('claude')
    await manager.ensureInstalled('codex')
    expect(manager.getClaudeSettingsPath()).toBe(join(homeDir, 'userData/hooks/claude/additional-settings.json'))
    expect(manager.getCodexHooksPath()).toBe(join(homeDir, 'userData/hooks/codex/hooks.json'))
    expect(await readFile(manager.getClaudeSettingsPath(), 'utf8')).toContain(JANUSX_HOOK_COMMAND_MARKER)
    expect(await readFile(manager.getCodexHooksPath(), 'utf8')).toContain(JANUSX_HOOK_COMMAND_MARKER)
  })
  it('installs marker-owned Claude hooks without removing user hooks', async () => {
    const homeDir = await createTempDir()
    const settingsPath = join(homeDir, '.claude', 'settings.json')
    await mkdir(join(homeDir, '.claude'), { recursive: true })
    await writeFile(
      settingsPath,
      JSON.stringify({
        hooks: {
          Stop: [
            {
              hooks: [{ type: 'command', command: 'echo user-hook' }],
            },
          ],
        },
      }),
      'utf8',
    )

    const manager = makeManager(homeDir, { executablePath: 'C:/Program Files/JanusX/JanusX.exe', platform: 'win32' })

    await manager.ensureInstalled('claude')
    expect(JSON.parse(await readFile(settingsPath, 'utf8')).hooks.Stop[0].hooks[0].command).toBe('echo user-hook')
    const parsed = JSON.parse(await readFile(manager.getClaudeSettingsPath(), 'utf8')) as {
      hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>>
    }

    expect(parsed.hooks.Stop).toHaveLength(1)
    expect(JSON.stringify(parsed)).toContain(JANUSX_HOOK_COMMAND_MARKER)
    expect(parsed.hooks.Notification.map((entry) => entry.matcher)).toEqual([
      'permission_prompt',
      'idle_prompt',
    ])
    expect(parsed.hooks.Notification[0].hooks[0].command).toContain('permission_prompt')
    expect(parsed.hooks.Notification[1].hooks[0].command).toContain('idle_prompt')
    expect(parsed.hooks.UserPromptSubmit[0].hooks[0].command).toContain('-EventName')
    expect(parsed.hooks.UserPromptSubmit[0].hooks[0].command).toContain('janusx-agent-hook.ps1')
      expect(parsed.hooks.UserPromptSubmit[0].hooks[0].command).toContain('-Command')
      expect(parsed.hooks.UserPromptSubmit[0].hooks[0].command).not.toContain('-File')
      expect(parsed.hooks.UserPromptSubmit[0].hooks[0].command).toContain('Test-Path -LiteralPath')
      expect(parsed.hooks.UserPromptSubmit[0].hooks[0].command).not.toContain('$utf8')
  })

  it('serializes concurrent preparation and does not rewrite unchanged assets', async () => {
    const home = await createTempDir()
    const manager = makeManager(home)
    await Promise.all(Array.from({ length: 16 }, () => manager.ensureInstalled('claude')))
    const path = manager.getClaudeSettingsPath()
    const before = await stat(path)
    await manager.ensureInstalled('claude')
    expect((await stat(path)).mtimeMs).toBe(before.mtimeMs)
    expect(await manager.getLaunchArgs('claude')).toEqual(['--settings', path])
    const codex = await manager.ensureInstalled('codex')
    const args = await manager.getLaunchArgs('codex')
    expect(codex.path).toContain('userData')
    expect(args.join(' ')).not.toContain('bypass')
    expect(args.join(' ')).not.toContain('trusted_hash')
    const { parse } = await import('smol-toml')
    expect(parse(args.at(-1)!).hooks).toHaveProperty('Stop')
  })

  it('bakes the fired matcher into posix Claude Notification commands', async () => {
    const homeDir = await createTempDir()
    const manager = makeManager(homeDir, { platform: 'linux' })

    await manager.ensureInstalled('claude')
    const parsed = JSON.parse(await readFile(manager.getClaudeSettingsPath(), 'utf8')) as {
      hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>>
    }

    expect(parsed.hooks.Notification.map((entry) => entry.matcher)).toEqual([
      'permission_prompt',
      'idle_prompt',
    ])
    expect(parsed.hooks.Notification[0].hooks[0].command).toContain("'--matcher' 'permission_prompt'")
    expect(parsed.hooks.Notification[1].hooks[0].command).toContain("'--matcher' 'idle_prompt'")
    expect(parsed.hooks.Notification[0].hooks[0].command).toContain(JANUSX_HOOK_COMMAND_MARKER)
    expect(await manager.isInstalled('claude')).toBe(true)
  })

  it('leaves legacy global hook cleanup to P5', async () => {
    const homeDir = await createTempDir()
    const settingsPath = join(homeDir, '.claude', 'settings.json')
    await mkdir(join(homeDir, '.claude'), { recursive: true })
    await writeFile(
      settingsPath,
      JSON.stringify({
        hooks: {
          Stop: [
            {
              hooks: [
                {
                  type: 'command',
                  command: "powershell -File 'C:/old/janusx-hook.ps1' -Marker 'janusx-hook-v1'",
                },
              ],
            },
            {
              hooks: [{ type: 'command', command: 'echo user-hook' }],
            },
          ],
        },
      }),
      'utf8',
    )

    const manager = makeManager(homeDir, { executablePath: 'C:/Program Files/JanusX/JanusX.exe', platform: 'win32' })

    await manager.ensureInstalled('claude')
    const settings = await readFile(settingsPath, 'utf8')

    expect(settings).toContain('janusx-hook-v1')
    expect(settings).toContain('echo user-hook')
    expect(settings).not.toContain(JANUSX_HOOK_COMMAND_MARKER)
    expect(await readFile(manager.getClaudeSettingsPath(), 'utf8')).toContain(JANUSX_HOOK_COMMAND_MARKER)
  })

  it('preserves native user hook bytes including their UTF-8 BOM', async () => {
    const homeDir = await createTempDir()
    const hooksPath = join(homeDir, '.codex', 'hooks.json')
    await mkdir(join(homeDir, '.codex'), { recursive: true })
    await writeFile(
      hooksPath,
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from(JSON.stringify({
          hooks: {
            Stop: [
              {
                hooks: [{ type: 'command', command: 'echo user-codex-hook' }],
              },
            ],
          },
        })),
      ]),
    )

    const manager = makeManager(homeDir)

    await manager.ensureInstalled('codex')
    const repaired = await readFile(hooksPath)
    const parsed = JSON.parse(repaired.toString('utf8').replace(/^\uFEFF/, '')) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>
    }

    expect(Array.from(repaired.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])
    expect(parsed.hooks.Stop[0].hooks[0].command).toBe('echo user-codex-hook')
    expect(JSON.stringify(parsed)).not.toContain(JANUSX_HOOK_COMMAND_MARKER)
  })

  it('uninstalls only marker-owned Codex hooks and keeps user hooks', async () => {
    const homeDir = await createTempDir()
    const manager = makeManager(homeDir, { executablePath: '/Applications/JanusX.app/Contents/MacOS/JanusX', platform: 'darwin' })

    await manager.ensureInstalled('codex')
    const hooksPath = manager.getCodexHooksPath()
    const installed = JSON.parse(await readFile(hooksPath, 'utf8')) as {
      hooks: Record<string, unknown[]>
    }
    installed.hooks.Stop.unshift({
      hooks: [{ type: 'command', command: 'echo user-codex-hook' }],
    })
    await writeFile(hooksPath, JSON.stringify(installed, null, 2), 'utf8')

    await manager.uninstall('codex')
    const parsed = JSON.parse(await readFile(hooksPath, 'utf8')) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>
    }

    expect(parsed.hooks.Stop).toEqual([
      {
        hooks: [{ type: 'command', command: 'echo user-codex-hook' }],
      },
    ])
    expect(JSON.stringify(parsed)).not.toContain(JANUSX_HOOK_COMMAND_MARKER)
  })

  it('does not modify the external Codex config.toml', async () => {
    const homeDir = await createTempDir()
    const codexDir = join(homeDir, '.codex')
    const configPath = join(codexDir, 'config.toml')
    const externalConfig = 'base_url = \"https://provider.example/v1\"\nwire_api = \"responses\"\n'
    await mkdir(codexDir, { recursive: true })
    await writeFile(configPath, externalConfig, 'utf8')
    const manager = makeManager(homeDir)

    await manager.ensureInstalled('codex')

    expect(await readFile(configPath, 'utf8')).toBe(externalConfig)
  })

  it('uses a managed PowerShell hook sender on Windows', async () => {
    const homeDir = await createTempDir()
    electronApp.isPackaged = false
    electronApp.getAppPath.mockReturnValue(join(homeDir, 'janusx-app'))

    try {
      const manager = makeManager(homeDir, { executablePath: 'C:/repo/node_modules/electron/dist/electron.exe', platform: 'win32' })

      await manager.ensureInstalled('codex')
      const hooksJson = await readFile(manager.getCodexHooksPath(), 'utf8')
      const script = await readFile(manager.getWindowsHookScriptPath(), 'utf8')

      expect(hooksJson).toContain('janusx-agent-hook.ps1')
      expect(hooksJson).toContain('-EventName')
      expect(hooksJson).toContain('-Command')
      expect(hooksJson).not.toContain('-File')
      expect(hooksJson).not.toContain('electron.exe')
      expect(script).toContain('Invoke-RestMethod')
      expect(script).toContain('JANUSX_HOOK_PORT')
      expect(script).toContain('janusx-agent-hook-last.json')
      // Slim + fast hook sender: bounded POST, filtered raw, shallow JSON.
      expect(script).toContain('-TimeoutSec 2')
      expect(script).toContain('rawFiltered')
      expect(script).toContain('transcript_path')
      expect(script).toContain('Substring(0, 2000)')
      expect(script).not.toContain('-Depth 32')
      expect(script).toContain('-Depth 10')
      // Backticks would terminate the TS template literal that bakes this script.
      expect(script).not.toContain('`')
    } finally {
      electronApp.isPackaged = true
    }
  })

  it('detects an incomplete install so a later terminal can repair the hooks', async () => {
    const homeDir = await createTempDir()
    const userDataDir = join(homeDir, 'userData')
    const manager = makeManager(homeDir, { userDataDir, platform: 'win32' })

    await manager.ensureInstalled('claude')
    expect(await manager.isInstalled('claude')).toBe(true)
    await writeFile(manager.getWindowsHookScriptPath(), '', 'utf8')
    const settingsPath = manager.getClaudeSettingsPath()
    const settings = JSON.parse(await readFile(settingsPath, 'utf8')) as { hooks: Record<string, unknown[]> }
    settings.hooks.UserPromptSubmit = []
    await writeFile(settingsPath, JSON.stringify(settings), 'utf8')

    expect(await manager.isInstalled('claude')).toBe(false)
  })

  it('creates an opencode plugin directory and injects OPENCODE_CONFIG_DIR', async () => {    const homeDir = await createTempDir()
    const userDataDir = join(homeDir, 'userData')
    const manager = makeManager(homeDir, { userDataDir })

    await manager.ensureInstalled('opencode')
    const env = manager.buildTerminalEnv(
      {
        terminalId: 'term-opencode',
        workspaceId: 'workspace-1',
        engine: 'opencode',
      },
      {
        JANUSX_HOOK_PORT: '1234',
        JANUSX_HOOK_TOKEN: 'secret',
      },
    )

    expect(env.OPENCODE_CONFIG_DIR).toBeUndefined()
    expect(JSON.parse(env.OPENCODE_CONFIG_CONTENT).plugins).toContain(manager.getOpencodeConfigDir().replace(/\\/g, '/'))
    const plugin = await readFile(join(manager.getOpencodeConfigDir(), 'plugins', 'janusx-notify.js'), 'utf8')
    expect(plugin).toContain('session.idle')
    expect(plugin).toContain('session.created')
    expect(plugin).toContain('session.updated')
    expect(plugin).toContain('extractSessionId')
    expect(plugin).toContain('sessionID')
    expect(await manager.isInstalled('opencode')).toBe(true)
    await unlink(join(manager.getOpencodeConfigDir(), 'plugins', 'janusx-notify.js'))
    expect(await manager.isInstalled('opencode')).toBe(false)
    await manager.ensureInstalled('opencode')
    expect(await manager.isInstalled('opencode')).toBe(true)
  })

  it('installs a JanusX-owned pi extension without touching user pi settings', async () => {
    const homeDir = await createTempDir()
    const userDataDir = join(homeDir, 'userData')
    const manager = makeManager(homeDir, { userDataDir })

    const result = await manager.ensureInstalled('pi')

    expect(result.installed).toBe(true)
    expect(result.path).toBe(manager.getPiExtensionPath())
    expect(await manager.isInstalled('pi')).toBe(true)
    const extension = await readFile(manager.getPiExtensionPath(), 'utf8')
    expect(extension).toContain('agent_settled')
    expect(extension).toContain('agent_start')
    expect(extension).toContain('ui_prompt_start')
    expect(extension).toContain('PermissionRequest')
    expect(extension).toContain('after_provider_response')
    expect(extension).toContain('JANUSX_HOOK_PORT')
    // Flag-injected file: no settings.json merge, no user hook removal.
    expect(extension).not.toContain('settings.json')
  })

  it('uninstalls the managed pi extension file', async () => {
    const homeDir = await createTempDir()
    const userDataDir = join(homeDir, 'userData')
    const manager = makeManager(homeDir, { userDataDir })

    await manager.ensureInstalled('pi')
    expect(await manager.isInstalled('pi')).toBe(true)
    await manager.uninstall('pi')
    expect(await manager.isInstalled('pi')).toBe(false)
  })

  it('treats janus as env-gated with nothing to install', async () => {
    const homeDir = await createTempDir()
    const manager = makeManager(homeDir)

    const installed = await manager.ensureInstalled('janus')
    expect(installed).toEqual({ engine: 'janus', installed: true, path: manager.getHooksRootDir() })
    expect(await manager.isInstalled('janus')).toBe(true)
    const uninstalled = await manager.uninstall('janus')
    expect(uninstalled.installed).toBe(false)
  })

  it('treats dsh as hook-less: no-op without touching the opencode plugin dir', async () => {
    const homeDir = await createTempDir()
    const userDataDir = join(homeDir, 'userData')
    const manager = makeManager(homeDir, { userDataDir })

    const installed = await manager.ensureInstalled('dsh')
    expect(installed).toEqual({ engine: 'dsh', installed: true, path: manager.getHooksRootDir() })
    expect(await manager.isInstalled('dsh')).toBe(true)
    const uninstalled = await manager.uninstall('dsh')
    expect(uninstalled.installed).toBe(false)
  })

  it('emits hidden-runner hook commands on Windows when a runner path is configured', async () => {
    const homeDir = await createTempDir()
    const runnerPath = join(homeDir, '.janusx', 'hooks', 'janusx-hook-runner.exe')
    await mkdir(join(homeDir, '.janusx', 'hooks'), { recursive: true })
    await writeFile(runnerPath, '', 'utf8')
    const manager = makeManager(homeDir, {
      executablePath: 'C:/Program Files/JanusX/JanusX.exe',
      platform: 'win32',
      windowsHookRunnerPath: runnerPath,
    })

    await manager.ensureInstalled('codex')
    const parsed = JSON.parse(await readFile(manager.getCodexHooksPath(), 'utf8')) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>
    }

    for (const event of ['UserPromptSubmit', 'PermissionRequest', 'Stop']) {
      const command = parsed.hooks[event][0].hooks[0].command
      expect(command).toContain('janusx-hook-runner.exe')
      expect(command).toContain('janusx-agent-hook.ps1')
      expect(command).toContain(JANUSX_HOOK_COMMAND_MARKER)
      // Single-quoted `&` form: survives Codex's `powershell -Command`
      // wrapping on Windows (double quotes become UnexpectedToken/exit 1).
      expect(command.startsWith('& ')).toBe(true)
      expect(command).toContain(`'${event}'`)
      expect(command).not.toContain('"')
      expect(command).not.toContain('powershell')
      expect(command).not.toContain('-Command')
      expect(command).not.toContain('$')
    }
    expect(await manager.isInstalled('codex')).toBe(true)
  })

  it('falls back to powershell commands when the auto runner is missing and compile is off', async () => {
    const homeDir = await createTempDir()
    const manager = new AgentHookConfigManager({
      homeDir,
      userDataDir: join(homeDir, 'userData'),
      executablePath: 'C:/Program Files/JanusX/JanusX.exe',
      platform: 'win32',
      compileHookRunner: false,
    })

    expect(manager.getHookRunnerPath()).toBe(join(homeDir, 'userData', 'hooks', 'janusx-hook-runner.exe'))

    await manager.ensureInstalled('codex')
    const hooksJson = await readFile(manager.getCodexHooksPath(), 'utf8')

    expect(hooksJson).toContain('-Command')
    expect(hooksJson).toContain('Test-Path -LiteralPath')
    expect(hooksJson).not.toContain('janusx-hook-runner.exe')
    expect(await manager.isInstalled('codex')).toBe(true)
  })

  it('builds a GUI-subsystem runner that hides powershell and never blocks', () => {
    const source = buildHookRunnerSource()

    expect(source).toContain('CreateNoWindow = true')
    expect(source).toContain('powershell.exe')
    expect(source).toContain('WaitForExit')
    expect(source).toContain('return 0')
    // TS-template safety: no ${ interpolation or backticks that would corrupt the C#.
    expect(source).not.toContain('${')
    expect(source).not.toContain('`')
  })

  it('forwards codex thread ids through the windows hook sender', () => {
    const script = buildWindowsHookScript()

    // Codex identifies its session by thread_id: it must survive the raw
    // whitelist and the sessionId fallback so provider identity lands.
    expect(script).toContain('"thread_id", "threadId"')
    expect(script).toContain('@("session_id", "sessionId", "thread_id", "threadId")')
    expect(script).toContain('transcript_path')
  })

  it('decodes hook stdin by BOM so codex utf-16 payloads keep their session id', () => {
    const script = buildWindowsHookScript()

    // Codex pipes UTF-16LE with a BOM on Windows while Claude pipes UTF-8.
    // A UTF-8 read of UTF-16 bytes is NUL-separated mojibake: ConvertFrom-Json
    // fails, the catch demotes the payload to a string, and session_id is
    // silently dropped — the terminal then never binds its native session.
    expect(script).toContain('[Console]::OpenStandardInput()')
    expect(script).toContain('0xFF -and $stdinBytes[1] -eq 0xFE')
    expect(script).toContain('[System.Text.Encoding]::Unicode.GetString($stdinBytes)')
    expect(script).toContain('[System.Text.Encoding]::BigEndianUnicode.GetString($stdinBytes)')
    expect(script).not.toContain('[Console]::In.ReadToEnd()')
  })
})

describe('decodeHookStdin', () => {
  // The Node sender runs on non-Windows platforms; the same BOM contract applies.
  const payload = JSON.stringify({ session_id: 'codex-thread-1', cwd: 'C:\\work' })

  const decode = async (buffer: Buffer) => (await import('../../src/main/notifications/agent-hook-client')).decodeHookStdin(buffer)

  it('decodes utf-16le BOM payloads from codex', async () => {
    expect(JSON.parse(await decode(Buffer.from(`\uFEFF${payload}`, 'utf16le')))).toEqual({
      session_id: 'codex-thread-1',
      cwd: 'C:\\work',
    })
  })

  it('decodes utf-16be BOM payloads', async () => {
    const buffer = Buffer.from(`\uFEFF${payload}`, 'utf16le')
    buffer.swap16()
    buffer[0] = 0xfe
    buffer[1] = 0xff
    expect(JSON.parse(await decode(buffer)).session_id).toBe('codex-thread-1')
  })

  it('decodes plain and BOM-prefixed utf-8 payloads from claude', async () => {
    expect(JSON.parse(await decode(Buffer.from(payload, 'utf8'))).session_id).toBe('codex-thread-1')
    expect(JSON.parse(await decode(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(payload, 'utf8')]))).session_id).toBe('codex-thread-1')
  })

  it('returns an empty string for empty stdin', async () => {
    expect(await decode(Buffer.alloc(0))).toBe('')
  })
})
