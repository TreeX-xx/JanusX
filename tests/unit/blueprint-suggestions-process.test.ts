import { fork, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { build } from 'esbuild'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { ReviewStore } from '../../plugins/blueprint/src/main/blueprint/suggestions/store'
import { SuggestionService } from '../../plugins/blueprint/src/main/blueprint/suggestions/service'
import { reviewResultSchema, type ReviewContext } from '../../plugins/blueprint/src/shared/blueprint-review'

let root: string
let worker: string
const children: ChildProcess[] = []
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'suggestion-process-'))
  worker = join(root, 'worker.cjs')
  await build({ entryPoints: [resolve('tests/fixtures/suggestion-worker.ts')], outfile: worker, bundle: true, platform: 'node', format: 'cjs' })
})
afterAll(async () => {
  await Promise.all(children.map(child => child.exitCode !== null ? undefined : new Promise<void>(done => { child.once('exit', () => done()); child.kill() })))
  await rm(root, { recursive: true, force: true })
})
async function client(db: string) {
  const child = fork(worker, [db], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }); children.push(child)
  let nextId = 0
  await new Promise<void>((done, reject) => {
    child.once('message', () => done()); child.once('error', reject)
    child.once('exit', code => reject(new Error(`Worker exited ${code}`)))
  })
  return (method: string, ...args: unknown[]) => new Promise<any>((done, reject) => {
    const id = ++nextId
    const listener = (message: any) => {
      if (message.id !== id) return
      child.off('message', listener)
      if (message.error) reject(new Error(message.error)); else done(message.result)
    }
    child.on('message', listener); child.send({ id, method, args })
  })
}

it('two independent processes preserve partial handling, reject old publications, and agree after reopen', async () => {
  const db = join(root, 'concurrent.db')
  const context: ReviewContext = { repoId: randomUUID(), workspacePath: root, branch: 'refs/heads/main' }
  const noteId = randomUUID()
  const source = { noteId, path: '.agents/notes/module.md', hash: 'a'.repeat(64), kind: 'module', lifecycle: 'accepted' }
  const snapshot = { context, complete: true, notes: [source], unavailablePaths: [], evidence: {} }
  const a = await client(db), b = await client(db)
  await a('reconcile', context, snapshot, 0)
  let state = await a('read', context)
  let ticket = await a('begin', context, noteId, state.revision, [])
  const findings = ['first', 'second'].map(summary => ({ id: randomUUID(), summary, explanation: 'Current-only issue payload', suggestion: 'Update the description', category: 'omission', verification: 'not-configured', citations: [{ path: source.path, quote: 'required' }] }))
  const result = reviewResultSchema.parse({ findings, coverage: 'complete', limitations: [] })
  await a('publish', context, ticket.id, noteId, result)
  state = await a('read', context)
  ticket = await b('begin', context, noteId, state.revision, [])
  const revision = state.items[0].reportRevision
  const outcomes = await Promise.allSettled([
    a('close', context, noteId, revision, [findings[0].id]),
    b('close', context, noteId, revision, [findings[1].id]),
  ])
  expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1)
  expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(1)
  state = await b('read', context)
  expect(state.items[0].report.findings).toHaveLength(1)
  await expect(a('publish', context, ticket.id, noteId, result)).rejects.toThrow()
  await b('close', context, noteId, state.items[0].reportRevision, [state.items[0].report.findings[0].id])
  const reopened = new ReviewStore(db)
  try { expect(new SuggestionService(reopened).read(context).items[0].report).toBeNull() } finally { reopened.close() }
  expect((await readFile(db)).includes(Buffer.from('Current-only issue payload'))).toBe(false)
})

it('a concurrent confirmed deletion wins over an in-flight publish without resurrecting content', async () => {
  const db = join(root, 'deletion.db')
  const context: ReviewContext = { repoId: randomUUID(), workspacePath: root, branch: 'main' }
  const noteId = randomUUID()
  const source = { noteId, path: '.agents/notes/module.md', hash: 'b'.repeat(64), kind: 'module', lifecycle: 'accepted' }
  const a = await client(db), b = await client(db)
  await a('reconcile', context, { context, complete: true, notes: [source], unavailablePaths: [], evidence: {} }, 0)
  let state = await a('read', context)
  const ticket = await a('begin', context, noteId, state.revision, [])
  const missing = { context, complete: true, notes: [], unavailablePaths: [], evidence: {} }
  state = await b('read', context)
  await b('reconcile', context, missing, state.revision)
  const outcomes = await Promise.allSettled([
    a('publish', context, ticket.id, noteId, reviewResultSchema.parse({ findings: [], coverage: 'complete', limitations: [] })),
    (async () => { const current = await b('read', context); await b('reconcile', context, missing, current.revision) })(),
  ])
  expect(outcomes[0].status).toBe('rejected')
  expect(outcomes[1].status).toBe('fulfilled')
  expect((await a('read', context)).items).toEqual([])
})
