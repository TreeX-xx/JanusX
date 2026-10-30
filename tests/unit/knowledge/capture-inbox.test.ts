import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CaptureInbox, type CaptureEntry } from '../../../src/main/knowledge/capture-inbox'
import type { Observation } from '../../../src/shared/knowledge'
vi.mock('electron', () => ({ app: { getPath: () => '/unused' } }))
let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'capture-inbox-')); vi.stubEnv('JANUSX_KNOWLEDGE_ROOT', root) })
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }) })
const entry = (id: string): CaptureEntry => ({ input: { workspaceId: 'project', workspacePath: '/project', source: 'agent-stream', type: 'conversation-turn', content: id }, context: { speaker: 'user', sourceEventId: id } })
it('does not read or persist the inbox when capture and recovery are disabled', async () => {
  const capture = vi.fn(), filter = vi.fn(async entries => entries)
  const inbox = new CaptureInbox(capture, filter)
  expect(await inbox.submit([entry('private')], async () => false)).toEqual([])
  await inbox.drain(async () => false)
  expect(filter).not.toHaveBeenCalled()
  expect(capture).not.toHaveBeenCalled()
  expect(await readdir(root)).toEqual([])
})

it('invalidates queued admission and does not write retry metadata after disabling in flight', async () => {
  let enabled = true, release!: () => void
  const capture = vi.fn(async () => { await new Promise<void>(resolve => { release = resolve }); throw new Error('disabled failure') })
  const inbox = new CaptureInbox(capture)
  const first = inbox.submit([entry('first')], async () => enabled)
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  const path = join(root, 'processing/capture-inbox.json')
  const before = await readFile(path, 'utf8')
  const queued = inbox.submit([entry('queued')], async () => enabled)
  enabled = false; release()
  expect(await first).toEqual([])
  expect(await queued).toEqual([])
  expect(capture).toHaveBeenCalledTimes(1)
  expect(await readFile(path, 'utf8')).toBe(before)
})
it('recovers a partially written batch after restart without duplicating successful events', async () => {
  const stored = new Map<string, Observation>(); let fail = true
  const capture = vi.fn(async (input, context) => {
    if (context.sourceEventId === 'two' && fail) throw new Error('disk unavailable')
    const row = stored.get(context.sourceEventId) ?? { id: context.sourceEventId, content: input.content } as Observation
    stored.set(context.sourceEventId, row); return row
  })
  await expect(new CaptureInbox(capture).submit([entry('one'), entry('two')])).rejects.toThrow('disk unavailable')
  const path = join(root, 'processing/capture-inbox.json')
  const pending = JSON.parse(await readFile(path, 'utf8')); expect(pending[0].attempts).toBe(1)
  fail = false; pending[0].nextAttemptAt = 0; await writeFile(path, JSON.stringify(pending))
  await new CaptureInbox(capture).drain()
  expect(stored.size).toBe(2); expect(JSON.parse(await readFile(path, 'utf8'))).toEqual([])
})
it('keeps retry failures and their updated deadline on disk and scrubs the entire pending payload', async () => {
  const capture = vi.fn(async () => { throw new Error('unavailable') })
  const item = entry('event'); const secret = 'sk-' + 'a'.repeat(48)
  item.input.content = `OPENAI_API_KEY=${secret}`; item.input.metadata = { prompt: `OPENAI_API_KEY=${secret}` }
  await expect(new CaptureInbox(capture).submit([item])).rejects.toThrow()
  const path = join(root, 'processing/capture-inbox.json'); const raw = await readFile(path, 'utf8')
  expect(raw).not.toContain(secret)
  const pending = JSON.parse(raw); pending[0].nextAttemptAt = 0; await writeFile(path, JSON.stringify(pending))
  await new CaptureInbox(capture).drain()
  expect(JSON.parse(await readFile(path, 'utf8'))[0]).toMatchObject({ attempts: 2, error: 'unavailable' })
})
it('fails closed on a corrupt recovery ledger instead of overwriting pending evidence', async () => {
  const capture = vi.fn(async () => { throw new Error('failed') }); const inbox = new CaptureInbox(capture)
  await expect(inbox.submit([entry('first')])).rejects.toThrow()
  const path = join(root, 'processing/capture-inbox.json'); await writeFile(path, 'corrupt')
  await expect(inbox.submit([entry('second')])).rejects.toThrow()
  expect(await readFile(path, 'utf8')).toBe('corrupt')
})
