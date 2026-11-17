import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeShellProfiles, type ShellProfileEntry } from '../../src/shared/shellProfiles'

const mocks = vi.hoisted(() => ({
  settings: { entries: [] as ShellProfileEntry[], hiddenCliPresets: [] as string[] },
  probeOutput: {} as Record<string, string>,
}))

vi.mock('electron', () => ({ app: { getPath: () => 'C:/Users/tester/AppData/Roaming/janusx' } }))
vi.mock('../../src/main/config/service', () => ({
  configService: {
    getShellProfiles: () => mocks.settings,
    updateShellProfiles: async (settings: unknown) => settings,
  },
}))
// Domain tests mock the public command resolver; native resolution is covered separately.
vi.mock('../../src/main/platform/local-shell', async () => {
  const actual = await vi.importActual<typeof import('../../src/main/platform/local-shell')>('../../src/main/platform/local-shell')
  const { existsSync } = await import('node:fs')
  return { ...actual, findLocalCommands: (command: string) => {
    if (command.includes('/') || command.includes('\\')) return existsSync(command) ? [command] : []
    return (mocks.probeOutput[command] ?? '').split(/\r?\n/).filter(Boolean)
  } }
})

const {
  detectShellCandidates,
  getDefaultShellCommand,
  getShellProfileEntry,
  resolveShellProfileLaunch,
  saveShellProfiles,
} = await import('../../src/main/terminal/shell-profiles')

function setEntries(entries: ShellProfileEntry[]): void {
  mocks.settings = normalizeShellProfiles({ entries, hiddenCliPresets: [] })
}

let dir: string
let executable: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'janusx-shell-profile-'))
  executable = join(dir, 'my-shell.exe')
  writeFileSync(executable, '')
  mocks.probeOutput = {}
})

describe('resolveShellProfileLaunch', () => {
  it('spawns the default entry program with the suffix as trailing argv', async () => {
    setEntries([{ id: 'bash', name: 'Git Bash', command: executable, suffix: '--login -i', visible: true, isDefault: true }])
    await expect(resolveShellProfileLaunch({})).resolves.toEqual({
      program: { command: executable, args: ['--login', '-i'] },
    })
  })

  it('spawns the explicitly selected entry without changing the default', async () => {
    // 裸命令名要靠 where/which 探测确认存在，这里回放一次命中。
    mocks.probeOutput = { bash: 'C:\\Program Files\\Git\\cmd\\bash.exe' }
    setEntries([
      { id: 'default', name: 'PowerShell', command: executable, visible: true, isDefault: true },
      { id: 'other', name: 'Bash', command: 'bash', suffix: '-i', visible: true, isDefault: false },
    ])
    await expect(resolveShellProfileLaunch({ id: 'other' })).resolves.toEqual({
      program: { command: 'C:\\Program Files\\Git\\cmd\\bash.exe', args: ['-i'] },
    })
    expect(getShellProfileEntry('default')?.id).toBe('default')
  })

  it('falls back to the default entry when the selected id is gone', async () => {
    setEntries([{ id: 'default', name: 'PowerShell', command: executable, visible: true, isDefault: true }])
    const launch = await resolveShellProfileLaunch({ id: 'deleted-entry' })
    expect(launch.program?.command).toBe(executable)
  })

  it('reports a missing explicit path instead of spawning it', async () => {
    setEntries([{ id: 'a', name: 'Bash', command: join(dir, 'gone.exe'), visible: true, isDefault: true }])
    const launch = await resolveShellProfileLaunch({})
    expect(launch.program).toBeUndefined()
    expect(launch.error).toContain('gone.exe')
  })

  it('reports an executable that is not on PATH', async () => {
    setEntries([{ id: 'a', name: 'Bash', command: 'janusx-no-such-shell', visible: true, isDefault: true }])
    const launch = await resolveShellProfileLaunch({})
    expect(launch.error).toContain('janusx-no-such-shell')
  })

  it('accepts a bare command that the platform probe resolves', async () => {
    mocks.probeOutput = { pwsh: '/usr/bin/pwsh\n' }
    setEntries([{ id: 'a', name: 'PowerShell 7', command: 'pwsh', visible: true, isDefault: true }])
    await expect(resolveShellProfileLaunch({})).resolves.toEqual({
      program: { command: '/usr/bin/pwsh', args: [] },
    })
  })

  it('resolves a restored command while preserving its arguments', async () => {
    mocks.probeOutput = { bash: '/usr/bin/bash' }
    setEntries([])
    await expect(resolveShellProfileLaunch({ commandLine: 'bash --login -i' })).resolves.toEqual({
      program: { command: '/usr/bin/bash', args: ['--login', '-i'] },
    })
  })

  it('returns no program when nothing is configured, keeping the legacy shell spawn', async () => {
    setEntries([])
    await expect(resolveShellProfileLaunch({})).resolves.toEqual({})
  })
})

describe('default shell command', () => {
  it('is the default entry launch line', () => {
    setEntries([{ id: 'a', name: 'Git Bash', command: 'bash', suffix: '--login -i', visible: true, isDefault: true }])
    expect(getDefaultShellCommand()).toBe('bash --login -i')
  })

  it('falls back to the platform shell with no entries', () => {
    setEntries([])
    expect(getDefaultShellCommand()).toMatch(/powershell\.exe|bash|zsh/)
  })
})

describe('detectShellCandidates', () => {
  // 候选清单按平台不同；Git Bash 择优是 Windows 专属断言。
  const isWindows = process.platform === 'win32'

  it.skipIf(!isWindows)('prefers Git for Windows bash over other bash.exe on PATH', async () => {
    mocks.probeOutput = {
      bash: 'C:\\Windows\\System32\\bash.exe\r\nC:\\Program Files\\Git\\cmd\\bash.exe\r\n',
      pwsh: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe\r\n',
      powershell: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\r\n',
      cmd: 'C:\\Windows\\System32\\cmd.exe\r\n',
    }
    const candidates = await detectShellCandidates()
    expect(candidates.map((candidate) => candidate.executable)).toEqual(['bash', 'pwsh', 'powershell', 'cmd'])
    expect(candidates[0].path).toBe('C:\\Program Files\\Git\\cmd\\bash.exe')
    expect(candidates[0].suggestedName).toBe('Git Bash')
    expect(candidates[0].suggestedSuffix).toBe('--login -i')
    expect(candidates.every((candidate) => !candidate.configured)).toBe(true)
  })

  it.skipIf(!isWindows)('marks candidates that an entry already covers as configured', async () => {
    mocks.probeOutput = {
      bash: 'C:\\Program Files\\Git\\cmd\\bash.exe\r\n',
      pwsh: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe\r\n',
    }
    // 条目命令与候选探测的是同一个 bash.exe；带空格的路径在条目里要加引号。
    setEntries([{ id: 'a', name: 'Bash', command: '"C:\\Program Files\\Git\\bin\\bash.exe"', visible: true, isDefault: true }])
    const candidates = await detectShellCandidates()
    expect(candidates.find((candidate) => candidate.executable === 'bash')?.configured).toBe(true)
    expect(candidates.find((candidate) => candidate.executable === 'pwsh')?.configured).toBe(false)
  })

  it('skips shells the probe cannot find', async () => {
    mocks.probeOutput = {}
    expect(await detectShellCandidates()).toEqual([])
  })
})

describe('saveShellProfiles', () => {
  it('normalizes before handing the settings back', async () => {
    const saved = await saveShellProfiles({
      entries: [{ id: 'a', name: 'Bash', command: 'bash' }],
      hiddenCliPresets: ['claude'],
    })
    expect(saved.entries[0]).toMatchObject({ id: 'a', command: 'bash', visible: true, isDefault: true })
    expect(saved.hiddenCliPresets).toEqual(['claude'])
  })
})
