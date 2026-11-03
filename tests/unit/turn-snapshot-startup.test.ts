import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { workspaceIo } from '@janus-agent/agent-core'
import { captureTurnFiles } from '../../src/main/terminal/turn-file-snapshot'

const control = vi.hoisted(() => ({ entered: 0, closed: 0, fail: false, gate: undefined as Promise<void> | undefined }))
vi.mock('node:fs/promises', async importOriginal => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return { ...original, open: async (...args: Parameters<typeof original.open>) => {
    const handle = await original.open(...args)
    const index = ++control.entered
    return {
      read: async (...readArgs: Parameters<typeof handle.read>) => {
        if (control.fail && index === 1) throw new Error('probe read failure')
        await control.gate
        return handle.read(...readArgs)
      },
      close: async () => { await handle.close(); control.closed++ },
    }
  } }
})

let cwd: string | undefined
let release: (() => void) | undefined
afterEach(async () => {
  release?.()
  if (cwd) {
    const root = await realpath(tmpdir())
    if (!relative(root, cwd).startsWith('janus-startup-')) throw Error('Unexpected fixture directory')
    await rm(cwd, { recursive: true, force: true })
  }
  cwd = undefined; release = undefined
  control.entered = 0; control.closed = 0; control.fail = false; control.gate = undefined
})

it.each(['cancel', 'read failure'] as const)('drains the bounded group before releasing its workspace lane on %s', async failure => {
  cwd = await mkdtemp(join(await realpath(tmpdir()), 'janus-startup-'))
  await Promise.all(Array.from({ length: 20 }, (_, i) => writeFile(join(cwd!, `${i}.txt`), 'content')))
  control.gate = new Promise<void>(resolve => { release = resolve })
  control.fail = failure === 'read failure'
  const abort = new AbortController()
  const capture = captureTurnFiles(cwd, abort.signal, { background: false })
  const outcome = capture.then(() => null, error => error as Error)
  try {
    await vi.waitFor(() => expect(control.entered).toBe(8))
    let nextStarted = false
    const next = workspaceIo.run(cwd, async () => { nextStarted = true; expect(control.closed).toBe(8) })
    if (failure === 'cancel') abort.abort(new Error('probe cancellation'))
    await new Promise(resolve => setImmediate(resolve))
    expect(nextStarted).toBe(false)
    expect(control.entered).toBe(8)
    release!()
    expect((await outcome)?.message).toContain(failure === 'cancel' ? 'probe cancellation' : 'probe read failure')
    await next
    expect(control.closed).toBe(8)
  } finally { release!(); await outcome }
})
