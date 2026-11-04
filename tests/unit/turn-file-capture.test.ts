import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, rm, mkdir, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { captureTurnFiles, compareTurnFiles } from '../../src/main/terminal/turn-file-snapshot'

let cwd: string
beforeEach(async () => {
  cwd = await mkdtemp(join(await realpath(tmpdir()), 'janus-turn-diff-'))
})
afterEach(async () => {
  const root = await realpath(tmpdir())
  if (!relative(root, await realpath(cwd)).startsWith('janus-turn-diff-')) throw new Error('Unexpected test directory')
  await rm(cwd, { recursive: true, force: true })
})

describe('bounded file capture', () => {
  it.each([true, false])('retains the same first 16 MiB in path order (background: %s)', async background => {
    const names = Array.from({ length: 18 }, (_, index) => `${String(index).padStart(2, '0')}.txt`)
    await Promise.all(names.map(name => writeFile(join(cwd, name), Buffer.alloc(1024 * 1024, 65))))
    const snapshot = await captureTurnFiles(cwd, undefined, { background })
    expect([...snapshot.keys()]).toEqual(names)
    expect([...snapshot].filter(([, file]) => file.text !== undefined).map(([name]) => name)).toEqual(names.slice(0, 16))
    expect(snapshot.get('17.txt')).toMatchObject({ size: 1024 * 1024, binary: false, oversized: false })
    expect(snapshot.get('17.txt')?.hash).toBe(snapshot.get('00.txt')?.hash)
    expect(compareTurnFiles(snapshot, await captureTurnFiles(cwd))).toEqual([])
  })

  it('honors Git ignores and preserves Unicode paths', async () => {
    await promisify(execFile)('git', ['init', '-q'], { cwd })
    await writeFile(join(cwd, '.gitignore'), '*.log\n')
    await writeFile(join(cwd, 'ignored.log'), 'noise')
    await writeFile(join(cwd, '中文 file.ts'), 'source')
    const snapshot = await captureTurnFiles(cwd)
    expect(snapshot.has('中文 file.ts')).toBe(true)
    expect(snapshot.has('ignored.log')).toBe(false)
    expect([...snapshot.keys()].some(path => path.startsWith('.git/'))).toBe(false)
  })
  it('marks binaries and large files without line counts and excludes checkpoint storage', async () => {
    const before = await captureTurnFiles(cwd)
    await mkdir(join(cwd, '.janusX'))
    await writeFile(join(cwd, '.janusX', 'internal.txt'), 'ignore')
    await writeFile(join(cwd, 'binary.bin'), Buffer.from([0, 1, 2]))
    await writeFile(join(cwd, 'large.txt'), Buffer.alloc(2 * 1024 * 1024, 65))
    const after = await captureTurnFiles(cwd)
    expect(after.has('.janusX/internal.txt')).toBe(false)
    expect(compareTurnFiles(before, after)).toEqual([
      expect.objectContaining({ path: 'binary.bin', additions: null, deletions: null }),
      expect.objectContaining({ path: 'large.txt', additions: null, deletions: null }),
    ])
  })
})
