import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { TerminalTurnChangeTracker } from '../../src/main/terminal/turn-change-tracker'
import { captureTurnFiles } from '../../src/main/terminal/turn-file-snapshot'
import type { TerminalTurnChangesEvent } from '../../src/shared/ipc/terminal'
import { workspaceIo } from '@janus-agent/agent-core'

let cwd: string
const published: TerminalTurnChangesEvent[] = []
beforeEach(async () => {
  cwd = await mkdtemp(join(await realpath(tmpdir()), 'janus-turn-diff-'))
  published.length = 0
})
afterEach(async () => {
  const root = await realpath(tmpdir())
  if (!relative(root, await realpath(cwd)).startsWith('janus-turn-diff-')) throw new Error('Unexpected test directory')
  await rm(cwd, { recursive: true, force: true })
})

describe('adjacent completed turn snapshots', () => {
  it('keeps the launch boundary in the shared lane and cancels it while waiting', async () => {
    let release!: () => void
    const blocker = workspaceIo.run(cwd, () => new Promise<void>(resolve => { release = resolve }))
    const errors = vi.fn()
    const tracker = new TerminalTurnChangeTracker(event => published.push(event), captureTurnFiles, errors)
    let registered = false
    const registration = tracker.register('a', cwd).then(() => { registered = true })
    try {
      await new Promise(resolve => setImmediate(resolve))
      expect(registered).toBe(false)
      tracker.unregister('a')
      await registration
      expect(errors).not.toHaveBeenCalled()
      expect(published).toEqual([])
    } finally {
      release()
      await blocker
    }
  })

  it('uses foreground scheduling only for the pre-launch capture', async () => {
    const capture = vi.fn().mockResolvedValue(new Map())
    const tracker = new TerminalTurnChangeTracker(event => published.push(event), capture)
    await tracker.register('a', cwd)
    expect(capture.mock.calls[0][2]).toEqual({ background: false })
    tracker.start('a')
    await tracker.finish('a', 'done', null)
    expect(capture.mock.calls[1]).toHaveLength(2)
    tracker.unregister('a')
  })

  it('advances after changed and quiet turns, including edits between submissions', async () => {
    await writeFile(join(cwd, 'a.ts'), 'base\n')
    const tracker = new TerminalTurnChangeTracker(event => published.push(event))
    await tracker.register('a', cwd)
    tracker.start('a')
    await writeFile(join(cwd, 'a.ts'), 'base\none\n')
    await tracker.finish('a', 'done', 'cp')
    expect(published[0]).toMatchObject({ fileCount: 1, additions: 1, deletions: 0 })
    tracker.start('a')
    await tracker.finish('a', 'done', 'cp')
    tracker.start('a')
    await tracker.finish('a', 'done', 'cp')
    expect(published.slice(1).map(event => event.fileCount)).toEqual([0, 0])
    // A fresh input checkpoint would miss this inter-turn change.
    await writeFile(join(cwd, 'a.ts'), 'base\none\ntwo\n')
    tracker.start('a')
    await tracker.finish('a', 'done', 'cp')
    expect(published[3]).toMatchObject({ fileCount: 1, additions: 1, deletions: 0 })
    expect(published[0].additions).toBe(1)
  })
  it('ignores repeated starts and ends, and captures failure/interruption changes', async () => {
    const tracker = new TerminalTurnChangeTracker(event => published.push(event))
    await tracker.register('a', cwd)
    tracker.start('a'); tracker.start('a')
    await writeFile(join(cwd, 'new.txt'), 'one\ntwo\n')
    await Promise.all([tracker.finish('a', 'failed', null), tracker.finish('a', 'done', null)])
    expect(published).toHaveLength(1)
    expect(published[0]).toMatchObject({ kind: 'failed', additions: 2 })
    tracker.start('a')
    await rm(join(cwd, 'new.txt'))
    await tracker.finish('a', 'interrupted', null)
    expect(published[1].files[0]).toMatchObject({ status: 'deleted', deletions: 2 })
  })
  it('reports an open turn so duplicate end hooks can be ignored', async () => {
    const tracker = new TerminalTurnChangeTracker(event => published.push(event))
    await tracker.register('a', cwd)
    expect(tracker.hasActiveTurn('a')).toBe(false)
    tracker.start('a')
    expect(tracker.hasActiveTurn('a')).toBe(true)
    await tracker.finish('a', 'done', null)
    expect(tracker.hasActiveTurn('a')).toBe(false)
    // A second end with no open turn stays ignored at the call site.
    await tracker.finish('a', 'interrupted', null)
    expect(published).toHaveLength(1)
  })
  it('isolates baselines for two terminals sharing a folder', async () => {
    const tracker = new TerminalTurnChangeTracker(event => published.push(event))
    await tracker.register('a', cwd); await tracker.register('b', cwd)
    await writeFile(join(cwd, 'new.txt'), 'one\n')
    tracker.start('a'); await tracker.finish('a', 'done', null)
    tracker.start('b'); await tracker.finish('b', 'done', null)
    expect(published.map(event => event.fileCount)).toEqual([1, 1])
    tracker.start('a'); await tracker.finish('a', 'done', null)
    expect(published[2].fileCount).toBe(0)
  })
  it.each(['unregister', 'replace'])('discards in-flight results after %s', async action => {
    const initial = await captureTurnFiles(cwd)
    let resolveCapture!: (value: typeof initial) => void
    const capture = vi.fn().mockResolvedValueOnce(initial).mockImplementationOnce(() => new Promise(resolve => { resolveCapture = resolve })).mockResolvedValue(initial)
    const tracker = new TerminalTurnChangeTracker(event => published.push(event), capture)
    await tracker.register('a', cwd)
    tracker.start('a')
    const finish = tracker.finish('a', 'done', null)
    await Promise.resolve()
    tracker.unregister('a')
    if (action === 'replace') await tracker.register('a', cwd)
    resolveCapture(initial)
    await finish
    expect(published).toEqual([])
  })
  it('reports missing boundaries as unavailable and re-establishes a baseline', async () => {
    const initial = await captureTurnFiles(cwd)
    const capture = vi.fn().mockResolvedValueOnce(initial).mockRejectedValueOnce(new Error('unreadable')).mockResolvedValue(initial)
    const error = vi.fn()
    const tracker = new TerminalTurnChangeTracker(event => published.push(event), capture, error)
    await tracker.register('a', cwd)
    for (let i = 0; i < 3; i++) { tracker.start('a'); await tracker.finish('a', 'done', null) }
    expect(published.map(event => event.available)).toEqual([false, false, true])
    expect(error).toHaveBeenCalledTimes(1)
  })

  it('bounds rapid completed turns and cancels waiting captures when the terminal closes', async () => {
    const initial = new Map()
    let release!: (snapshot: typeof initial) => void
    const capture = vi.fn().mockResolvedValueOnce(initial).mockImplementationOnce(() => new Promise(resolve => { release = resolve })).mockResolvedValue(initial)
    const errors = vi.fn()
    const tracker = new TerminalTurnChangeTracker(event => published.push(event), capture, errors)
    await tracker.register('a', cwd)
    const finishes: Promise<void>[] = []
    for (let i = 0; i < 70; i++) {
      tracker.start('a')
      finishes.push(tracker.finish('a', 'done', null))
    }
    await Promise.resolve()
    expect(errors).toHaveBeenCalled()
    expect(published.every(event => !event.available)).toBe(true)
    const alreadyPublished = published.length
    tracker.unregister('a')
    release(initial)
    await Promise.all(finishes)
    expect(capture).toHaveBeenCalledTimes(2)
    expect(published).toHaveLength(alreadyPublished)
  })
})
