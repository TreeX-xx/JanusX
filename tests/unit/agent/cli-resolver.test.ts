import { win32 } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  claudeSpawnResult,
  clearCache,
  resolveClaudeBinary,
  selectWindowsSpawnPath,
} from '../../../src/main/janus-runner/cli-resolver'

describe('selectWindowsSpawnPath', () => {
  it('keeps an earlier npm native install ahead of a later WinGet executable', () => {
    const npm = 'C:\\Users\\77777\\AppData\\Roaming\\npm'
    const native = `${npm}\\node_modules\\@opencode\\cli\\bin\\opencode.exe`
    const winget = 'C:\\WinGet\\Links\\opencode.exe'
    const shim = `${npm}\\opencode.cmd`
    const exists = new Set([shim, native, winget])
    expect(selectWindowsSpawnPath([`${npm}\\opencode`, shim, winget], 'opencode', {
      existsSync: p => exists.has(p),
      readFileSync: () => '@ECHO off\r\n"%dp0%\\node_modules\\@opencode\\cli\\bin\\opencode.exe" %*',
    })).toBe(native)
  })

  it('preserves lookup order among native executables regardless of path length', () => {
    const first = 'C:\\preferred-install\\opencode.exe'
    expect(selectWindowsSpawnPath([first, 'C:\\bin\\opencode.exe'], 'opencode', {
      existsSync: () => true,
    })).toBe(first)
  })

  afterEach(() => {
    clearCache()
  })

  it('prefers .exe over .cmd over extensionless npm shims', () => {
    const npm = 'C:\\Users\\Tree\\AppData\\Roaming\\npm'
    const exists = new Set([
      `${npm}\\opencode`,
      `${npm}\\opencode.cmd`,
      `${npm}\\node_modules\\opencode-ai\\bin\\opencode.exe`,
    ])

    const chosen = selectWindowsSpawnPath(
      [`${npm}\\opencode`, `${npm}\\opencode.cmd`, `${npm}\\opencode.ps1`],
      'opencode',
      {
        existsSync: (p) => exists.has(p),
        readFileSync: () =>
          `@ECHO off\r\n"${npm}\\node_modules\\opencode-ai\\bin\\opencode.exe"   %*\r\n`,
      },
    )

    expect(chosen).toBe(`${npm}\\node_modules\\opencode-ai\\bin\\opencode.exe`)
  })

  it('never returns extensionless shims when only those exist among where lines', () => {
    const npm = 'C:\\Users\\Tree\\AppData\\Roaming\\npm'
    const exists = new Set([`${npm}\\claude`, `${npm}\\claude.cmd`])

    const chosen = selectWindowsSpawnPath([`${npm}\\claude`, `${npm}\\claude.cmd`], 'claude', {
      existsSync: (p) => exists.has(p),
      readFileSync: () => '@ECHO off\r\nnode "%~dp0\\node_modules\\pkg\\cli.js" %*\r\n',
    })

    expect(chosen).toBe(`${npm}\\claude.cmd`)
  })

  it('keeps codex.cmd instead of following node.exe from the shim', () => {
    const npm = 'C:\\Users\\Tree\\AppData\\Roaming\\npm'
    const exists = new Set([
      `${npm}\\codex`,
      `${npm}\\codex.cmd`,
      `${npm}\\node.exe`,
      `${npm}\\node_modules\\@openai\\codex\\bin\\codex.js`,
    ])

    const chosen = selectWindowsSpawnPath([`${npm}\\codex`, `${npm}\\codex.cmd`], 'codex', {
      existsSync: (p) => exists.has(p),
      readFileSync: () =>
        [
          '@ECHO off',
          `IF EXIST "${npm}\\node.exe" (`,
          `  SET "_prog=${npm}\\node.exe"`,
          ') ELSE (',
          '  SET "_prog=node"',
          ')',
          `"%_prog%"  "${npm}\\node_modules\\@openai\\codex\\bin\\codex.js" %*`,
        ].join('\r\n'),
    })

    expect(chosen).toBe(`${npm}\\codex.cmd`)
  })

  it('prefers .exe candidate already present in where output', () => {
    const exists = new Set([
      'C:\\tools\\claude.exe',
      'C:\\Users\\Tree\\AppData\\Roaming\\npm\\claude.cmd',
    ])

    const chosen = selectWindowsSpawnPath(
      [
        'C:\\Users\\Tree\\AppData\\Roaming\\npm\\claude',
        'C:\\Users\\Tree\\AppData\\Roaming\\npm\\claude.cmd',
        'C:\\tools\\claude.exe',
      ],
      'claude',
      {
        existsSync: (p) => exists.has(p),
        readFileSync: () => {
          throw new Error('should not read when .exe is already selected')
        },
      },
    )

    expect(chosen).toBe('C:\\tools\\claude.exe')
  })

  it('follows a .local bin claude.cmd forwarder to the npm-global native exe', () => {
    const local = 'C:\\Users\\Tree\\.local\\bin'
    const npm = 'C:\\Users\\Tree\\AppData\\Roaming\\npm'
    const forwarder = `${local}\\claude.cmd`
    const npmCmd = `${npm}\\claude.cmd`
    const exe = `${npm}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`
    const files = new Map<string, string>([
      [forwarder, `@ECHO off\r\n"${npmCmd}" %*\r\n`],
      [npmCmd, `@ECHO off\r\n"${exe}" %*\r\n`],
    ])

    const chosen = selectWindowsSpawnPath([forwarder], 'claude', {
      existsSync: (p) => p === forwarder || p === npmCmd || p === exe,
      readFileSync: (p) => files.get(p) ?? '',
      env: { APPDATA: 'C:\\Users\\Tree\\AppData\\Roaming' },
      homedir: 'C:\\Users\\Tree',
    })

    expect(chosen).toBe(exe)
  })

  it('finds the npm-global claude.exe when the PATH shim has no sibling node_modules', () => {
    const forwarder = 'C:\\Users\\Tree\\.local\\bin\\claude.cmd'
    const appData = 'C:\\Users\\Tree\\AppData\\Roaming'
    const exe = win32.join(appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')

    const resolution = resolveClaudeBinary([forwarder], {
      existsSync: (p) => p === forwarder || p === exe,
      readFileSync: () => '@ECHO off\r\nnpm exec --yes --package @anthropic-ai/claude-code -- claude %*\r\n',
      env: { APPDATA: appData, LOCALAPPDATA: 'C:\\Users\\Tree\\AppData\\Local' },
      homedir: 'C:\\Users\\Tree',
    })

    expect(resolution.path).toBe(exe)
    expect(resolution.foundCommand).toBe(forwarder)
    expect(claudeSpawnResult(resolution)).toEqual({ path: exe })
  })

  it('does not stop at the first PATH shim when a later claude.cmd points at the exe', () => {
    const forwarder = 'C:\\Users\\Tree\\.local\\bin\\claude.cmd'
    const npm = 'C:\\Users\\Tree\\AppData\\Roaming\\npm'
    const npmCmd = `${npm}\\claude.cmd`
    const exe = `${npm}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`
    const files = new Map<string, string>([
      [forwarder, '@ECHO off\r\nREM forwards somewhere else\r\n'],
      [npmCmd, `@ECHO off\r\n"${exe}" %*\r\n`],
    ])

    const chosen = selectWindowsSpawnPath([forwarder, npmCmd], 'claude', {
      existsSync: (p) => p === forwarder || p === npmCmd || p === exe,
      readFileSync: (p) => files.get(p) ?? '',
      env: {},
      homedir: 'C:\\Users\\Tree',
    })

    expect(chosen).toBe(exe)
  })

  it('expands %APPDATA% in a forwarder to the npm claude shim', () => {
    const forwarder = 'C:\\Users\\Tree\\.local\\bin\\claude.cmd'
    const appData = 'C:\\Users\\Tree\\AppData\\Roaming'
    const npmCmd = `${appData}\\npm\\claude.cmd`
    const exe = `${appData}\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`
    const files = new Map<string, string>([
      [forwarder, '@ECHO off\r\n"%APPDATA%\\npm\\claude.cmd" %*\r\n'],
      [npmCmd, `@ECHO off\r\n"${exe}" %*\r\n`],
    ])

    const chosen = selectWindowsSpawnPath([forwarder], 'claude', {
      existsSync: (p) => p === forwarder || p === npmCmd || p === exe,
      readFileSync: (p) => files.get(p) ?? '',
      env: { APPDATA: appData },
      homedir: 'C:\\Users\\Tree',
    })

    expect(chosen).toBe(exe)
  })

  it('keeps an npm claude.cmd that launches a local script when no native exe exists', () => {
    const forwarder = 'C:\\Users\\Tree\\.local\\bin\\claude.cmd'
    const appData = 'C:\\Users\\Tree\\AppData\\Roaming'
    const npmCmd = win32.join(appData, 'npm', 'claude.cmd')
    const script = win32.join(appData, 'npm', 'cli.js')
    const files = new Map<string, string>([
      [forwarder, '@ECHO off\r\nnpm exec claude %*\r\n'],
      [npmCmd, '@echo off\r\nnode "%~dp0cli.js" %*\r\n'],
    ])

    const resolution = resolveClaudeBinary([forwarder], {
      existsSync: (p) => p === forwarder || p === npmCmd || p === script,
      readFileSync: (p) => files.get(p) ?? '',
      env: { APPDATA: appData, LOCALAPPDATA: 'C:\\Users\\Tree\\AppData\\Local' },
      homedir: 'C:\\Users\\Tree',
    })

    expect(resolution).toMatchObject({ path: npmCmd, directLauncher: true })
    expect(claudeSpawnResult(resolution)).toEqual({ path: npmCmd })
  })

  it('keeps a local claude.cmd that launches its own script', () => {
    const cmd = 'C:\\fixture\\bin\\claude.cmd'
    const script = 'C:\\fixture\\bin\\fake-agent.js'
    const exe = 'C:\\Users\\Tree\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe'

    const chosen = selectWindowsSpawnPath([cmd], 'claude', {
      existsSync: (p) => p === cmd || p === script || p === exe,
      readFileSync: () => '@echo off\r\nnode "%~dp0fake-agent.js" %*\r\n',
      env: { APPDATA: 'C:\\Users\\Tree\\AppData\\Roaming' },
      homedir: 'C:\\Users\\Tree',
    })

    expect(chosen).toBe(cmd)
  })

  it('honors an absolute claude.exe already present among candidates', () => {
    const exe = 'C:\\Users\\Tree\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe'
    const forwarder = 'C:\\Users\\Tree\\.local\\bin\\claude.cmd'

    const chosen = selectWindowsSpawnPath([exe, forwarder], 'claude', {
      existsSync: (p) => p === exe || p === forwarder,
      readFileSync: () => {
        throw new Error('should not read when an exe candidate exists')
      },
    })

    expect(chosen).toBe(exe)
  })

  it('reports the shim and the exe paths when a forwarder has no native binary', () => {
    const forwarder = 'C:\\Users\\Tree\\.local\\bin\\claude.cmd'
    const missingLocalExe = 'C:\\Users\\Tree\\.local\\bin\\claude.exe'
    const appData = 'C:\\Users\\Tree\\AppData\\Roaming'
    const expected = win32.join(appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')

    const resolution = resolveClaudeBinary([forwarder], {
      existsSync: (p) => p === forwarder,
      readFileSync: () => '@ECHO off\r\n"%~dp0claude.exe" %*\r\n',
      env: { APPDATA: appData, LOCALAPPDATA: 'C:\\Users\\Tree\\AppData\\Local' },
      homedir: 'C:\\Users\\Tree',
    })
    const decision = claudeSpawnResult(resolution)

    expect(decision.path).toBeNull()
    expect(decision.error).toContain('npm installation supported')
    expect(decision.error).toContain(forwarder)
    expect(decision.error).toContain(missingLocalExe)
    expect(decision.error).toContain(expected)
    expect(decision.error?.startsWith('Claude dual mode requires native claude.exe')).toBe(true)
  })

  it('returns null when only non-spawnable paths exist', () => {
    const chosen = selectWindowsSpawnPath(
      ['C:\\Users\\Tree\\AppData\\Roaming\\npm\\opencode'],
      'opencode',
      {
        existsSync: () => true,
        readFileSync: () => '#!/bin/sh\nexec true\n',
      },
    )

    expect(chosen).toBeNull()
  })
})

describe('resolveCliExecutable Windows target contract', () => {
  async function resolver(files: Map<string, string>, path: string) {
    const { resolveCliExecutable } = await import('../../../src/main/platform/cli-launch')
    const context = { identity: { id: 'local', kind: 'local' as const, platform: 'win32' as const, architecture: 'x64', home: 'C:/Users/fixture', revision: 'fixture' }, env: { PATH: path }, shell: 'powershell.exe' }
    return (command: string) => resolveCliExecutable(command, context, file => files.has(file) ? 'executable' : 'missing', file => files.get(file) ?? '')
  }
  it('resolves a native OpenCode package from the first PATH shim', async () => {
    const root = 'C:\\npm', shim = root + '\\opencode.cmd', exe = root + '\\node_modules\\opencode-ai\\bin\\opencode.exe'
    const resolve = await resolver(new Map([[shim, '@ECHO off\r\n"' + exe + '" %*\r\n'], [exe, '']]), root)
    expect(resolve('opencode')).toBe(exe)
  })
  it('follows a Claude forwarder to the installed native binary', async () => {
    const local = 'C:\\local\\claude.cmd', shim = 'C:\\npm\\claude.cmd', exe = 'C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe'
    const resolve = await resolver(new Map([[local, '"' + shim + '" %*'], [shim, '"' + exe + '" %*'], [exe, '']]), 'C:\\local;C:\\npm')
    expect(resolve('claude')).toBe(exe)
  })
  it('reports a broken Claude forwarder instead of falling back to a bare command', async () => {
    const local = 'C:\\local\\claude.cmd'
    const resolve = await resolver(new Map([[local, '@ECHO off\r\n"%~dp0claude.exe" %*\r\n']]), 'C:\\local')
    expect(() => resolve('claude')).toThrow('native claude.exe')
    expect(() => resolve('claude')).toThrow(local)
  })
  it('preserves a configured absolute native executable', async () => {
    const exe = 'C:\\custom\\claude.exe'
    const resolve = await resolver(new Map([[exe, '']]), '')
    expect(resolve(exe)).toBe(exe)
  })
  it('does not treat directories as executable candidates', async () => {
    const { resolveCliExecutable } = await import('../../../src/main/platform/cli-launch')
    const context = { identity: { id: 'local', kind: 'local' as const, platform: 'win32' as const, architecture: 'x64', home: 'C:/Users/fixture', revision: 'fixture' }, env: { PATH: 'C:\\bin' }, shell: 'powershell.exe' }
    expect(resolveCliExecutable('pi', context, () => 'not-file')).toBeNull()
  })
})
