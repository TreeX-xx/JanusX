import { resolve } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { CliDetector, quotePowerShellPath } from '../../../src/main/external-cli/cli-detector'
import type { ExternalCliToolId } from '../../../src/shared/ipc/external-cli'

type RunResult = { exitCode: number; stdout: string; stderr: string; timedOut?: boolean }

function createHarness(options: {
  toolId?: ExternalCliToolId
  files?: string[]
  path?: string
  appData?: string
  localAppData?: string
  platform?: NodeJS.Platform
  run?: (file: string, args: readonly string[]) => Promise<RunResult>
} = {}) {
  const files = new Set((options.files ?? []).map(file => resolve(file)))
  const run = vi.fn(options.run ?? (async (_file: string, args: readonly string[]) => ({
    exitCode: 0,
    stdout: args.join(' ').includes('--version') ? '1.2.3 (Claude Code)' : '',
    stderr: '',
  })))
  const detector = new CliDetector(options.toolId ?? 'claude', {
    env: { PATH: options.path ?? '', APPDATA: options.appData, LOCALAPPDATA: options.localAppData },
    platform: options.platform ?? 'win32',
    homeDir: options.platform === 'win32' || !options.platform ? 'C:\\Users\\test' : '/home/test',
    isRegularFile: async candidate => files.has(resolve(candidate)),
    run,
  })
  return { detector, run }
}

describe('CliDetector', () => {
  it('reports not-installed with a manual hint and probes nothing', async () => {
    const { detector, run } = createHarness()

    await expect(detector.detect()).resolves.toEqual({
      toolId: 'claude',
      installed: false,
      runnable: false,
      hint: 'npm i -g @anthropic-ai/claude-code@latest',
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('prefers the PATH binary and parses the version', async () => {
    const pathBinary = resolve('C:\\tools\\claude.cmd')
    const knownBinary = resolve('C:\\Users\\test\\AppData\\Roaming\\npm\\claude.cmd')
    const { detector } = createHarness({
      files: [pathBinary, knownBinary],
      path: 'C:\\tools',
      appData: 'C:\\Users\\test\\AppData\\Roaming',
    })

    await expect(detector.detect()).resolves.toEqual({
      toolId: 'claude',
      installed: true,
      runnable: true,
      version: '1.2.3',
      path: pathBinary,
      source: 'path',
      existingTerminalNotice: expect.any(String),
    })
  })

  it('falls back to known locations only when PATH misses', async () => {
    const knownBinary = resolve('C:\\Users\\test\\AppData\\Roaming\\npm\\claude.cmd')
    const { detector } = createHarness({
      files: [knownBinary],
      path: 'C:\\tools',
      appData: 'C:\\Users\\test\\AppData\\Roaming',
    })

    const result = await detector.detect()
    expect(result).toMatchObject({ installed: true, runnable: true, version: '1.2.3', source: 'known-location' })
  })

  it('marks a failing binary as installed-but-broken instead of masking it as missing', async () => {
    const pathBinary = resolve('C:\\tools\\claude.cmd')
    const { detector, run } = createHarness({
      files: [pathBinary],
      path: 'C:\\tools',
      run: async () => ({ exitCode: 1, stdout: '', stderr: 'node: bad option' }),
    })

    await expect(detector.detect()).resolves.toEqual({
      toolId: 'claude',
      installed: true,
      runnable: false,
      path: pathBinary,
      source: 'path',
      hint: 'node: bad option',
    })
    expect(run).toHaveBeenCalled()
  })

  it('probes Windows binaries through PowerShell with explicit UTF-8 output', async () => {
    const pathBinary = resolve('C:\\tools\\claude.cmd')
    const { detector, run } = createHarness({ files: [pathBinary], path: 'C:\\tools' })

    await detector.detect()
    expect(run).toHaveBeenCalledWith('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      expect.stringContaining(`& '${pathBinary}' --version`),
    ])
    expect(run.mock.calls[0]?.[1]?.[3]).toContain('[System.Text.UTF8Encoding]')
  })

  it('resolves posix binaries directly from PATH and known dirs', async () => {
    const pathBinary = resolve('/home/test/.local/bin/claude')
    const { detector } = createHarness({
      files: [pathBinary],
      path: '/home/test/.local/bin',
      platform: 'linux',
      run: async () => ({ exitCode: 0, stdout: 'claude 2.0.1', stderr: '' }),
    })

    const result = await detector.detect()
    expect(result).toMatchObject({ installed: true, runnable: true, version: '2.0.1', source: 'path' })
  })

  it('escapes single quotes in PowerShell paths', () => {
    expect(quotePowerShellPath("C:\\tools\\o'brien\\claude.cmd")).toBe("'C:\\tools\\o''brien\\claude.cmd'")
  })

  it('surfaces readable stderr when the probe exits zero without a version', async () => {
    const pathBinary = resolve('C:\\tools\\claude.cmd')
    const { detector } = createHarness({
      files: [pathBinary],
      path: 'C:\\tools',
      run: async () => ({ exitCode: 0, stdout: '', stderr: '发生错误：缺少运行时' }),
    })

    await expect(detector.detect()).resolves.toMatchObject({
      installed: true,
      runnable: false,
      hint: '发生错误：缺少运行时',
    })
  })

  it('drives other tools from the registry without Claude specifics', async () => {
    const codexBinary = resolve('C:\\Users\\test\\AppData\\Roaming\\npm\\codex.cmd')
    const { detector, run } = createHarness({
      toolId: 'codex',
      files: [codexBinary],
      path: '',
      appData: 'C:\\Users\\test\\AppData\\Roaming',
      run: async () => ({ exitCode: 0, stdout: 'codex-cli 0.44.0', stderr: '' }),
    })

    const result = await detector.detect()
    expect(result).toMatchObject({
      toolId: 'codex',
      installed: true,
      runnable: true,
      version: '0.44.0',
      source: 'known-location',
    })
    expect(run.mock.calls[0]?.[1]?.[3]).toContain(`& '${codexBinary}' --version`)
  })

  it.each([
    ['1.19.4', '1.19.4'],
    ['opencode v2.1.4', '2.1.4'],
    ['opencode v2.1.5-beta.1', '2.1.5-beta.1'],
  ])('recognizes OpenCode version output %s', async (output, version) => {
    const pathBinary = resolve('C:\\tools\\opencode.cmd')
    const { detector } = createHarness({
      toolId: 'opencode',
      files: [pathBinary],
      path: 'C:\\tools',
      run: async () => ({ exitCode: 0, stdout: output, stderr: '' }),
    })

    await expect(detector.detect()).resolves.toMatchObject({
      toolId: 'opencode', installed: true, runnable: true, version, path: pathBinary,
    })
  })

  it('does not treat a reported OpenCode version as runnable after a failed probe', async () => {
    const pathBinary = resolve('C:\\tools\\opencode.cmd')
    const { detector } = createHarness({
      toolId: 'opencode',
      files: [pathBinary],
      path: 'C:\\tools',
      run: async () => ({ exitCode: 1, stdout: 'opencode v2.1.4', stderr: 'startup failed' }),
    })

    await expect(detector.detect()).resolves.toMatchObject({ installed: true, runnable: false })
  })

  it('reports the tool-specific manual command when missing', async () => {
    const { detector } = createHarness({ toolId: 'opencode' })

    await expect(detector.detect()).resolves.toEqual({
      toolId: 'opencode',
      installed: false,
      runnable: false,
      hint: 'npm i -g @opencode/cli@latest',
    })
  })

  it('lists every location with the probe default marked first', async () => {
    const pathBinary = resolve('C:\\tools\\claude.cmd')
    const knownBinary = resolve('C:\\Users\\test\\AppData\\Roaming\\npm\\claude.cmd')
    const { detector } = createHarness({
      files: [pathBinary, knownBinary],
      path: 'C:\\tools',
      appData: 'C:\\Users\\test\\AppData\\Roaming',
    })

    await expect(detector.listLocations()).resolves.toEqual([
      { path: pathBinary, source: 'path', isDefault: true },
      { path: knownBinary, source: 'known-location', isDefault: false },
    ])
  })

  it('lists known-only locations and dedupes overlapping search dirs', async () => {
    const knownBinary = resolve('C:\\Users\\test\\AppData\\Roaming\\npm\\claude.cmd')
    const { detector } = createHarness({
      files: [knownBinary],
      path: 'C:\\Users\\test\\AppData\\Roaming\\npm',
      appData: 'C:\\Users\\test\\AppData\\Roaming',
    })

    // Same directory visible through PATH and known dirs: one entry, PATH wins.
    await expect(detector.listLocations()).resolves.toEqual([
      { path: knownBinary, source: 'path', isDefault: true },
    ])
  })

  it('lists nothing when the tool is absent', async () => {
    const { detector } = createHarness({ toolId: 'pi' })
    await expect(detector.listLocations()).resolves.toEqual([])
  })
})
