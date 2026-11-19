import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { assessRuntimeBoundaries, checkRuntimeBoundaries, inspectRuntimeSource, summarizeFindings } from '../../scripts/check-runtime-boundaries.mjs'

// Note: .agents/notes/desktop/platform-runtime-boundaries.md
const path = 'src/main/terminal/manager.ts'
const empty = { schema: 1, entries: [] }
const sourceMap = (source: string, file = path) => new Map([[file, source]])
const baseline = (source: string) => ({ schema: 1, entries: [{
  path, owner: 'terminal', phase: 'P2', kind: 'adapter', reason: 'Owns the native PTY.',
  findings: summarizeFindings(inspectRuntimeSource(path, source).findings),
}] })
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('runtime boundary gate', () => {
  it('ignores comments, strings and all type-only import/export forms', () => {
    const source = `
      // require('node:child_process'); process.platform
      const text = "import { spawn } from 'node:child_process'; navigator.platform";
      import type { ChildProcess } from 'node:child_process';
      import { type SpawnOptions } from 'child_process';
      export type { IPty } from 'node-pty';
      export { type Options } from 'execa';
      type Child = import('node:child_process').ChildProcess;
    `
    expect(inspectRuntimeSource(path, source).findings).toEqual([])
  })

  it.each([
    "import { spawn, type ChildProcess } from 'node:child_process'",
    "export { spawn } from 'child_process'",
    "export * from 'node:child_process'",
    "const child = require('node:child_process')",
    "const child = await import('node:child_process')",
    "import child = require('node:child_process')",
    "import { execa } from 'execa'",
    "import 'node-pty'",
  ])('rejects a new runtime dependency: %s', source => {
    expect(assessRuntimeBoundaries(sourceMap(source), empty).errors).toHaveLength(1)
  })

  it.each([
    'process.platform', 'process["platform"]', 'window.electron?.platform',
    'window["electron"]["platform"]', 'navigator.platform', 'navigator.userAgent',
    'target.navigator.platform', "import { platform as hostOS } from 'node:os'; hostOS()",
    "import nodeProcess from 'node:process'; nodeProcess.platform",
    "import * as system from 'node:os'; system.platform()",
    "const system = require('node:os'); system.platform()",
    "const { platform: hostOS } = require('node:os'); hostOS()",
  ])('rejects a new platform dependency: %s', source => {
    expect(assessRuntimeBoundaries(sourceMap(source), empty).errors.length).toBeGreaterThan(0)
  })

  it('allows the exact existing driver but rejects a wrapper in another file', () => {
    const source = "import * as pty from 'node-pty'; const platform = process.platform"
    expect(assessRuntimeBoundaries(sourceMap(source), baseline(source)).errors).toEqual([])
    const sources = sourceMap(source)
    sources.set('src/main/business/new-wrapper.ts', "export { spawn } from 'node:child_process'")
    expect(assessRuntimeBoundaries(sources, baseline(source)).errors).toEqual([expect.stringContaining('new-wrapper.ts: new process-import')])
  })

  it('rejects increasing use inside an existing file and retires removed allowances', () => {
    const source = 'const platform = process.platform'
    expect(assessRuntimeBoundaries(sourceMap(source + '; const other = process.platform'), baseline(source)).errors[0]).toContain('(2 > 1)')
    expect(assessRuntimeBoundaries(sourceMap('export {}'), baseline(source)).errors[0]).toContain('stale')
    expect(assessRuntimeBoundaries(new Map(), baseline(source)).errors[0]).toContain('source no longer exists')
  })

  it('requires an owner, migration phase and reason, without wildcard exemptions', () => {
    const allowed = baseline('process.platform')
    for (const patch of [{ owner: '' }, { reason: '' }, { phase: 'someday' }, { path: '../src/evil.ts' }, { findings: [{ rule: 'anything', detail: '*', count: 1 }] }]) {
      expect(() => assessRuntimeBoundaries(sourceMap('process.platform'), { ...allowed, entries: [{ ...allowed.entries[0], ...patch }] })).toThrow('Invalid')
    }
    expect(() => assessRuntimeBoundaries(sourceMap('process.platform'), { ...allowed, entries: [allowed.entries[0], allowed.entries[0]] })).toThrow('Invalid')
  })

  it('records environment, shell policy and case folding for review without banning ordinary path code', () => {
    const source = `const home = process.env.HOME; const p = process.env['PATH']; homedir(); path.join(home, 'sessions'); const key = value.toLowerCase(); const options = { shell: true };`
    const result = inspectRuntimeSource(path, source)
    expect(result.findings).toEqual([])
    expect(result.observations.map(item => item.rule)).toEqual(['environment-read', 'environment-read', 'home-read', 'case-fold-review', 'shell-option-review'])
  })

  it('scans the actual source tree including untracked wrappers and ignores test/type fixtures', () => {
    const root = mkdtempSync(join(tmpdir(), 'janusx-runtime-boundary-'))
    roots.push(root)
    mkdirSync(join(root, 'src/main/terminal'), { recursive: true })
    mkdirSync(join(root, 'scripts'))
    const source = "import * as pty from 'node-pty'"
    writeFileSync(join(root, path), source)
    writeFileSync(join(root, 'scripts/runtime-boundary-baseline.json'), JSON.stringify(baseline(source)))
    writeFileSync(join(root, 'src/main/terminal/mock.test.ts'), source)
    writeFileSync(join(root, 'src/main/terminal/types.d.ts'), 'declare const host: typeof process')
    expect(checkRuntimeBoundaries(root).errors).toEqual([])
    writeFileSync(join(root, 'src/main/terminal/new.ts'), source)
    expect(checkRuntimeBoundaries(root).errors).toEqual([expect.stringContaining('new.ts: new process-import')])
  })
})
