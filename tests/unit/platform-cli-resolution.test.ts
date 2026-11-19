import { describe, expect, it } from 'vitest'
import { resolveCliExecutable } from '../../src/main/platform/cli-launch'
import type { RuntimeContext } from '../../src/main/platform/runtime-context'

describe('detection and launch installation priority', () => {
  for (const engine of ['claude', 'pi', 'codex', 'opencode', 'dsh']) {
    it(`${engine}: the first PATH installation wins over later native executables and known-directory fallbacks`, () => {
      const command = `C:\\chosen\\${engine}.cmd`
      const files = new Map([
        [command, '@echo off\r\nnode "%~dp0launcher.js" %*\r\n'],
        ['C:\\chosen\\launcher.js', 'fixture'],
        [`C:\\later\\${engine}.exe`, 'native'],
        [`C:\\fixture\\.local\\bin\\${engine}.exe`, 'native'],
      ])
      const context: RuntimeContext = {
        identity: { id: 'local', kind: 'local', platform: 'win32', architecture: 'x64', home: 'C:\\fixture', revision: 'test' },
        env: { PATH: 'C:\\chosen;C:\\later' }, shell: 'powershell.exe',
      }
      const inspect = (file: string) => files.has(file) ? 'executable' as const : 'missing' as const
      const read = ((file: string) => files.get(file) ?? '') as Parameters<typeof resolveCliExecutable>[3]
      // Detection refines the first located command; a bare launch must refine that same installation.
      expect(resolveCliExecutable(command, context, inspect, read)).toBe(command)
      expect(resolveCliExecutable(engine, context, inspect, read)).toBe(command)
      context.env.PATH = 'C:\\absent'
      expect(resolveCliExecutable(engine, context, inspect, read)).toBe(`C:\\fixture\\.local\\bin\\${engine}.exe`)
    })
  }
})
