import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearCache, selectWindowsSpawnPath } from '../../../src/main/janus-runner/cli-resolver'

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
})
