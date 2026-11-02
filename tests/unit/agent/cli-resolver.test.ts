import { win32 } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  claudeSpawnResult,
  clearCache,
  resolveClaudeBinary,
  selectWindowsSpawnPath,
} from '../../../src/main/janus-runner/cli-resolver'

describe('selectWindowsSpawnPath', () => {
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

describe('resolveCLIPath (win32 integration via mocks)', () => {
  afterEach(() => {
    clearCache()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('parses all where lines and returns a spawnable Windows path', async () => {
    const npm = 'C:\\Users\\Tree\\AppData\\Roaming\\npm'
    const whereStdout = [`${npm}\\opencode`, `${npm}\\opencode.cmd`].join('\r\n')

    vi.resetModules()
    vi.doMock('child_process', () => ({
      exec: (
        _cmd: string,
        callback: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        callback(null, { stdout: whereStdout, stderr: '' })
        return {} as never
      },
    }))
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs')
      return {
        ...actual,
        existsSync: (p: string) =>
          p === `${npm}\\opencode` ||
          p === `${npm}\\opencode.cmd` ||
          p === `${npm}\\node_modules\\opencode-ai\\bin\\opencode.exe`,
        readFileSync: (p: string) => {
          if (p === `${npm}\\opencode.cmd`) {
            return `@ECHO off\r\n"${npm}\\node_modules\\opencode-ai\\bin\\opencode.exe"   %*\r\n`
          }
          return actual.readFileSync(p)
        },
      }
    })

    const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: 'win32' })

    try {
      const { resolveCLIPath, clearCache: clear } = await import(
        '../../../src/main/janus-runner/cli-resolver'
      )
      clear()
      const resolved = await resolveCLIPath('opencode')
      expect(resolved).toBe(`${npm}\\node_modules\\opencode-ai\\bin\\opencode.exe`)
    } finally {
      if (platformDescriptor) {
        Object.defineProperty(process, 'platform', platformDescriptor)
      }
    }
  })

  it('resolves claude.exe from where output when the first hit is a forwarder', async () => {
    const local = 'C:\\Users\\Tree\\.local\\bin\\claude.cmd'
    const npm = 'C:\\Users\\Tree\\AppData\\Roaming\\npm'
    const npmCmd = `${npm}\\claude.cmd`
    const exe = `${npm}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`
    const files = new Map<string, string>([
      [local, `@ECHO off\r\n"${npmCmd}" %*\r\n`],
      [npmCmd, `@ECHO off\r\n"${exe}" %*\r\n`],
    ])

    vi.resetModules()
    vi.doMock('child_process', () => ({
      exec: (
        _cmd: string,
        callback: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        callback(null, { stdout: local, stderr: '' })
        return {} as never
      },
    }))
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs')
      return {
        ...actual,
        existsSync: (p: string) => p === local || p === npmCmd || p === exe,
        readFileSync: (p: string, enc?: BufferEncoding) => {
          const text = files.get(p)
          if (text !== undefined) return text
          return actual.readFileSync(p, enc)
        },
      }
    })

    const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      const { resolveCLIPath, clearCache: clear } = await import(
        '../../../src/main/janus-runner/cli-resolver'
      )
      clear()
      await expect(resolveCLIPath('claude')).resolves.toBe(exe)
    } finally {
      if (platformDescriptor) Object.defineProperty(process, 'platform', platformDescriptor)
    }
  })

  it('throws the found command and tried exe when the forwarder has no native binary', async () => {
    const local = 'C:\\Users\\Tree\\.local\\bin\\claude.cmd'

    vi.resetModules()
    vi.doMock('child_process', () => ({
      exec: (
        _cmd: string,
        callback: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        callback(null, { stdout: local, stderr: '' })
        return {} as never
      },
    }))
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs')
      return {
        ...actual,
        existsSync: (p: string) => p === local,
        readFileSync: (p: string, enc?: BufferEncoding) => {
          if (p === local) return '@ECHO off\r\n"%~dp0claude.exe" %*\r\n'
          return actual.readFileSync(p, enc)
        },
      }
    })

    const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      const { resolveCLIPath, clearCache: clear, ClaudeNativeBinaryError } = await import(
        '../../../src/main/janus-runner/cli-resolver'
      )
      clear()
      await expect(resolveCLIPath('claude')).rejects.toBeInstanceOf(ClaudeNativeBinaryError)
      clear()
      await expect(resolveCLIPath('claude')).rejects.toThrow(local)
      clear()
      await expect(resolveCLIPath('claude')).rejects.toThrow('claude.exe')
    } finally {
      if (platformDescriptor) Object.defineProperty(process, 'platform', platformDescriptor)
    }
  })

  it('returns a configured absolute claude.exe without searching PATH', async () => {
    const exe = 'C:\\Users\\Tree\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe'

    vi.resetModules()
    vi.doMock('child_process', () => ({
      exec: () => {
        throw new Error('where should not run for an absolute exe')
      },
    }))
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs')
      return {
        ...actual,
        existsSync: (p: string) => p === exe,
      }
    })

    const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      const { resolveCLIPath, clearCache: clear } = await import(
        '../../../src/main/janus-runner/cli-resolver'
      )
      clear()
      await expect(resolveCLIPath(exe)).resolves.toBe(exe)
    } finally {
      if (platformDescriptor) Object.defineProperty(process, 'platform', platformDescriptor)
    }
  })
})
