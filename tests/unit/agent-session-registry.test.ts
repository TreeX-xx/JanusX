import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeFileAtomic } from '../../src/main/lib/atomic-file'
import { AgentSessionRegistry } from '../../src/main/sessions/session-registry'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/janusx-test-userdata' },
}))

vi.mock('../../src/main/lib/atomic-file', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/main/lib/atomic-file')>()
  return { ...actual, writeFileAtomic: vi.fn(actual.writeFileAtomic) }
})

const roots: string[] = []
const registries: AgentSessionRegistry[] = []
afterEach(async () => {
  for (const registry of registries.splice(0)) await registry.flush()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function userDataDir() {
  const path = await mkdtemp(join(tmpdir(), 'agent-sessions-'))
  roots.push(path)
  return path
}
function track(registry: AgentSessionRegistry): AgentSessionRegistry {
  registries.push(registry)
  return registry
}

function createInput(terminalId: string, workspaceId = 'ws-1') {
  return {
    terminalId,
    workspaceId,
    engine: 'claude',
    cwd: '/repo',
    shell: 'pwsh',
    preset: 'claude',
  }
}

describe('agent session registry', () => {
  it('keeps identical provider IDs separate across local, WSL and SSH sources', async () => {
    const registry = track(new AgentSessionRegistry(await userDataDir()))
    const input = { engine: 'claude', providerSessionId: 'same-provider', transcriptPath: '/history.jsonl', firstPrompt: 'question', turnCount: 1 }
    const local = registry.importExternalSession({ ...input, cwd: '/repo' })
    const wsl = registry.importExternalSession({ ...input, cwd: 'janusx-workspace://wsl/repo/Case', workspaceId: 'wsl' })
    const ssh = registry.importExternalSession({ ...input, cwd: 'janusx-workspace://ssh/repo/Case', workspaceId: 'ssh' })
    expect(new Set([local.id, wsl.id, ssh.id]).size).toBe(3)
    expect(registry.listSessions({ cwd: 'janusx-workspace://wsl/repo/case' })).toHaveLength(0)
    expect(registry.listSessions({ cwd: 'janusx-workspace://wsl/repo/Case' }).map(row => row.id)).toEqual([wsl.id])
    const rescanned = registry.importExternalSession({ ...input, cwd: wsl.cwd, workspaceId: 'wsl', turnCount: 2 })
    expect(rescanned.id).toBe(wsl.id)
    expect(registry.getSession(local.id)?.turnCount).toBe(1)
  })

  it('records remote process exit without inventing a conversation turn', async () => {
    const registry = track(new AgentSessionRegistry(await userDataDir()))
    const record = registry.createSession({ ...createInput('remote-process'), cwd: 'janusx-workspace://wsl/repo' })
    registry.noteProcessExit('remote-process', 0)
    expect(registry.getSession(record.id)).toMatchObject({ status: 'done', turnCount: 0, turns: [] })
  })

  it('refreshes provider counts and previews without rewriting hook turns or status', async () => {
    const registry = track(new AgentSessionRegistry(await userDataDir()))
    const owned = registry.createSession(createInput('live'))
    registry.notePrompt('live', 'hook question')
    registry.noteProviderSession('live', 'provider-1')
    registry.recordTurnEnd('live', 'failed', undefined, 'hook answer')
    const original = structuredClone(registry.getSession(owned.id)!)
    const input = {
      engine: 'claude', providerSessionId: 'provider-1', cwd: '/repo', transcriptPath: '/history.jsonl',
      firstPrompt: 'hook question', turnCount: 3, updatedAt: '2099-01-01T00:00:00.000Z',
      preview: [{ prompt: 'outside follow-up', excerpt: 'outside answer' }],
    }
    const listener = vi.fn()
    registry.setChangeListener(listener)
    registry.importExternalSession(input)
    expect(registry.listSessions()[0].turnCount).toBe(3)
    expect(registry.getSession(owned.id)).toMatchObject({
      turns: original.turns, status: original.status, terminalIds: original.terminalIds,
      transcriptPreview: input.preview, transcriptUpdatedAt: input.updatedAt,
    })
    listener.mockClear()
    registry.importExternalSession(input)
    expect(listener).not.toHaveBeenCalled()
  })

  it('seeds native recovery history without sharing checkpoints or future turns', async () => {
    const dir = await userDataDir()
    const registry = track(new AgentSessionRegistry(dir))
    const source = registry.createSession(createInput('original'))
    registry.notePrompt('original', 'first question')
    registry.noteCheckpoint('original', 'cp-original')
    registry.recordTurnEnd('original', 'done', 'cp-original', 'first answer')
    registry.notePrompt('original', 'second question')
    registry.recordTurnEnd('original', 'done', undefined, 'second answer')
    const restored = registry.createSession({
      ...createInput('restored'), historyFrom: source.id, continuedFrom: source.id, providerSessionId: 'native-id',
    })
    expect(restored).toMatchObject({ firstPrompt: 'first question', lastPrompt: 'second question', turnCount: 2, checkpointCount: 0 })
    expect(restored.turns.map((turn) => turn.checkpointId)).toEqual([undefined, undefined])
    expect(restored.turns[0].id).not.toBe(source.turns[0].id)
    expect(restored.turns[0]).not.toBe(source.turns[0])
    registry.notePrompt('restored', 'follow-up')
    registry.recordTurnEnd('restored', 'done', undefined, 'follow-up answer')
    expect(source.turnCount).toBe(2)
    expect(source.turns[0].checkpointId).toBe('cp-original')
    expect(restored.turnCount).toBe(3)
    await registry.flush()
    const loaded = track(new AgentSessionRegistry(dir))
    await loaded.load()
    expect(loaded.getSession(restored.id)).toMatchObject({ providerSessionId: 'native-id', firstPrompt: 'first question', turnCount: 3 })
  })
  it('creates sessions bound to terminals with stable ids', async () => {
    const registry = track(new AgentSessionRegistry(await userDataDir()))
    const record = registry.createSession(createInput('term-1'))
    expect(record.id).toBeTruthy()
    expect(registry.sessionIdForTerminal('term-1')).toBe(record.id)
    expect(registry.listSessions()).toHaveLength(1)
  })

  it('records prompts, checkpoints, and turn ends on one session', async () => {
    const registry = track(new AgentSessionRegistry(await userDataDir()))
    const record = registry.createSession(createInput('term-1'))
    registry.notePrompt('term-1', 'do the thing')
    registry.noteCheckpoint('term-1', 'cp-1')
    registry.recordTurnEnd('term-1', 'done', 'cp-1')
    const detail = registry.getSession(record.id)
    expect(detail?.firstPrompt).toBe('do the thing')
    expect(detail?.turnCount).toBe(1)
    expect(detail?.status).toBe('done')
    expect(detail?.turns).toHaveLength(1)
    expect(detail?.turns[0]).toMatchObject({ kind: 'done', checkpointId: 'cp-1' })
    const [summary] = registry.listSessions({ workspaceId: 'ws-1' })
    expect(summary).toMatchObject({ checkpointCount: 1, turnCount: 1 })
  })

  it('retains only live checkpoint ids so the card count matches storage', async () => {
    const registry = track(new AgentSessionRegistry(await userDataDir()))
    const record = registry.createSession(createInput('term-1'))
    registry.noteCheckpoint('term-1', 'cp-1')
    registry.noteCheckpoint('term-1', 'cp-2')
    registry.noteCheckpoint('term-1', 'cp-3')
    registry.retainCheckpoints(record.id, new Set(['cp-1', 'cp-3']))
    expect(registry.getSession(record.id)).toMatchObject({ checkpointCount: 2 })
    const [summary] = registry.listSessions({ workspaceId: 'ws-1' })
    expect(summary).toMatchObject({ checkpointCount: 2 })
    // Unknown sessions and fully-live ledgers persist nothing.
    registry.retainCheckpoints('missing', new Set())
    registry.retainCheckpoints(record.id, new Set(['cp-1', 'cp-3']))
    expect(registry.getSession(record.id)).toMatchObject({ checkpointCount: 2 })
  })

  it('filters by workspace and hides archived sessions by default', async () => {
    const registry = track(new AgentSessionRegistry(await userDataDir()))
    const first = registry.createSession(createInput('term-1'))
    registry.createSession(createInput('term-2', 'ws-2'))
    expect(registry.listSessions({ workspaceId: 'ws-1' })).toHaveLength(1)
    expect(registry.listSessions()).toHaveLength(2)
    registry.archiveSession(first.id)
    expect(registry.listSessions()).toHaveLength(1)
    expect(registry.listSessions({ includeArchived: true })).toHaveLength(2)
  })

  it('round-trips shell-restore layouts with caps and validation', async () => {
    const registry = track(new AgentSessionRegistry(await userDataDir()))
    expect(await registry.getLayout()).toBeNull()
    const terminals = Array.from({ length: 15 }, (_, i) => ({
      cwd: `/repo-${i}`,
      preset: 'claude',
      name: `t-${i}`,
    }))
    await registry.saveLayout({
      version: 1,
      savedAt: 'x',
      workspaces: [
        { workspaceId: 'ws-1', terminals },
        { workspaceId: 'ws-2', terminals: [{ cwd: '', preset: 'shell', name: 'bad' }] },
      ],
    })
    const layout = await registry.getLayout()
    expect(layout?.workspaces).toHaveLength(1)
    expect(layout?.workspaces[0].terminals).toHaveLength(10)
    expect(layout?.workspaces[0].terminals[0]).toMatchObject({ cwd: '/repo-0', preset: 'claude' })
    await registry.clearLayout()
    expect(await registry.getLayout()).toBeNull()
  })

  it('archives sessions by worktree path on disk removal', async () => {
    const registry = track(new AgentSessionRegistry(await userDataDir()))
    const kept = registry.createSession(createInput('term-1'))
    const removed = registry.createSession({ ...createInput('term-2'), cwd: '/repo-a' })
    expect(registry.archiveSessionsByCwd('/repo-a')).toEqual([removed.id])
    expect(registry.getSession(removed.id)?.archived).toBe(true)
    expect(registry.getSession(kept.id)?.archived).toBe(false)
    expect(registry.listSessions()).toHaveLength(1)
    expect(registry.listSessions({ includeArchived: true })).toHaveLength(2)
  })

  it('detaching a terminal keeps the session for resume', async () => {    const registry = track(new AgentSessionRegistry(await userDataDir()))
    const record = registry.createSession(createInput('term-1'))
    registry.detachTerminal('term-1')
    expect(registry.sessionIdForTerminal('term-1')).toBeNull()
    expect(registry.getSession(record.id)).not.toBeNull()
  })

  it('createSession reuses the row already bound to a terminal', async () => {
    const registry = track(new AgentSessionRegistry(await userDataDir()))
    const first = registry.createSession(createInput('term-1'))
    const second = registry.createSession(createInput('term-1'))
    expect(second.id).toBe(first.id)
    expect(registry.listSessions()).toHaveLength(1)
    expect(registry.sessionIdForTerminal('term-1')).toBe(first.id)
  })

  it('createSession keeps the origin fields of the first row', async () => {
    const registry = track(new AgentSessionRegistry(await userDataDir()))
    const first = registry.createSession({
      ...createInput('term-1'),
      continuedFrom: 'src-1',
      branch: 'feat/a',
      providerSessionId: 'p-1',
      transcriptPath: '/tmp/a.jsonl',
    })
    // The terminal lifecycle's second call carries no origin; it must not blank it.
    const second = registry.createSession(createInput('term-1'))
    expect(second.id).toBe(first.id)
    expect(second).toMatchObject({
      continuedFrom: 'src-1',
      branch: 'feat/a',
      providerSessionId: 'p-1',
      transcriptPath: '/tmp/a.jsonl',
    })
  })

  it('createSession fills blanks from a later call', async () => {
    const registry = track(new AgentSessionRegistry(await userDataDir()))
    registry.createSession({ ...createInput('term-1'), continuedFrom: 'src-1' })
    const merged = registry.createSession({
      ...createInput('term-1'),
      transcriptPath: '/tmp/later.jsonl',
      providerSessionId: 'p-9',
    })
    expect(merged).toMatchObject({
      continuedFrom: 'src-1',
      transcriptPath: '/tmp/later.jsonl',
      providerSessionId: 'p-9',
    })
    expect(registry.listSessions()).toHaveLength(1)
  })

  it('detachTerminal lets a replacement mint a fresh row', async () => {
    const registry = track(new AgentSessionRegistry(await userDataDir()))
    const old = registry.createSession(createInput('term-1'))
    registry.detachTerminal('term-1')
    const fresh = registry.createSession(createInput('term-1'))
    expect(fresh.id).not.toBe(old.id)
    expect(registry.sessionIdForTerminal('term-1')).toBe(fresh.id)
    expect(registry.listSessions({ includeArchived: true })).toHaveLength(2)
  })

  it('discardTerminal archives the row a failed create bound', async () => {
    const registry = track(new AgentSessionRegistry(await userDataDir()))
    const record = registry.createSession(createInput('term-1'))
    registry.discardTerminal('term-1')
    expect(registry.sessionIdForTerminal('term-1')).toBeNull()
    expect(registry.getSession(record.id)?.archived).toBe(true)
    expect(registry.listSessions()).toHaveLength(0)
    expect(registry.listSessions({ includeArchived: true })).toHaveLength(1)
  })

  it('dropEmptyOrphans removes rows whose terminal was taken over', async () => {
    const dir = await userDataDir()
    await mkdir(join(dir, 'janusx'), { recursive: true })
    const now = new Date().toISOString()
    // Legacy double-mint shape: one terminalId claimed by two rows, the
    // survivor owning turns and the orphan holding nothing.
    await writeFile(
      join(dir, 'janusx', 'agent-sessions.json'),
      JSON.stringify({
        version: 1,
        sessions: [
          {
            id: 'orphan',
            workspaceId: 'ws-1',
            engine: 'claude',
            cwd: '/repo',
            firstPrompt: '',
            lastPrompt: '',
            turnCount: 0,
            checkpointCount: 0,
            status: 'active',
            continuedFrom: 'src-1',
            terminalIds: ['term-1'],
            turns: [],
            checkpointIds: [],
            createdAt: now,
            updatedAt: now,
            archived: false,
          },
          {
            id: 'owner',
            workspaceId: 'ws-1',
            engine: 'claude',
            cwd: '/repo',
            firstPrompt: 'do the thing',
            lastPrompt: 'do the thing',
            turnCount: 1,
            checkpointCount: 0,
            status: 'active',
            terminalIds: ['term-1'],
            turns: [{ id: 't1', kind: 'done', startedAt: now, endedAt: now, prompt: 'do the thing' }],
            checkpointIds: [],
            createdAt: now,
            updatedAt: now,
            archived: false,
          },
        ],
      }),
    )
    const registry = track(new AgentSessionRegistry(dir))
    await registry.load()
    expect(registry.getSession('orphan')).toBeNull()
    expect(registry.getSession('owner')).not.toBeNull()
    expect(registry.sessionIdForTerminal('term-1')).toBe('owner')
    expect(registry.listSessions()).toHaveLength(1)
  })

  it('dropEmptyOrphans keeps rows that recorded anything', async () => {
    const dir = await userDataDir()
    await mkdir(join(dir, 'janusx'), { recursive: true })
    const now = new Date().toISOString()
    await writeFile(
      join(dir, 'janusx', 'agent-sessions.json'),
      JSON.stringify({
        version: 1,
        sessions: [
          {
            id: 'orphan-with-turns',
            workspaceId: 'ws-1',
            engine: 'claude',
            cwd: '/repo',
            firstPrompt: '',
            lastPrompt: '',
            turnCount: 1,
            checkpointCount: 0,
            status: 'done',
            terminalIds: ['term-1'],
            turns: [{ id: 't1', kind: 'done', startedAt: now, endedAt: now, excerpt: 'ok' }],
            checkpointIds: [],
            createdAt: now,
            updatedAt: now,
            archived: false,
          },
          {
            id: 'owner',
            workspaceId: 'ws-1',
            engine: 'claude',
            cwd: '/repo',
            firstPrompt: 'do the thing',
            lastPrompt: 'do the thing',
            turnCount: 1,
            checkpointCount: 0,
            status: 'active',
            terminalIds: ['term-1'],
            turns: [{ id: 't2', kind: 'done', startedAt: now, endedAt: now, prompt: 'do the thing' }],
            checkpointIds: [],
            createdAt: now,
            updatedAt: now,
            archived: false,
          },
        ],
      }),
    )
    const registry = track(new AgentSessionRegistry(dir))
    await registry.load()
    expect(registry.getSession('orphan-with-turns')).not.toBeNull()
    expect(registry.listSessions({ includeArchived: true })).toHaveLength(2)
  })

  it('does not guess a merge for a hook row that holds no shared key', async () => {
    const registry = track(new AgentSessionRegistry(await userDataDir()))
    // A payload whitelist that drops the provider id leaves the hook row with
    // nothing to prove identity on. Proximity is not proof: the two cards stay
    // until the payload layer passes the id through.
    const hook = registry.createSession(createInput('term-1'))
    registry.importExternalSession({
      engine: 'claude',
      cwd: '/repo',
      providerSessionId: 'p-1',
      transcriptPath: '/tmp/sess.jsonl',
      firstPrompt: 'wire the gateway',
      turnCount: 2,
    })
    expect(registry.listSessions({ includeArchived: true })).toHaveLength(2)
    expect(registry.getSession(hook.id)?.providerSessionId).toBeUndefined()
  })

  it('merges a scan row on transcript path when the hook row learns it first', async () => {
    const registry = track(new AgentSessionRegistry(await userDataDir()))
    registry.importExternalSession({
      engine: 'claude',
      cwd: '/repo',
      providerSessionId: 'p-1',
      transcriptPath: '/tmp/sess.jsonl',
      firstPrompt: 'wire the gateway',
      turnCount: 2,
    })
    // The hook row appears afterwards and learns the transcript path only: no
    // provider id, so the merge must key on the path alone.
    const hook = registry.createSession(createInput('term-1'))
    registry.noteProviderSession('term-1', undefined, '/tmp/sess.jsonl')
    expect(registry.listSessions({ includeArchived: true })).toHaveLength(1)
    expect(registry.getSession(hook.id)?.external).toBeUndefined()
    expect(registry.getSession(hook.id)?.providerSessionId).toBe('p-1')
  })

  it('never merges two rows that both claim a provider id', async () => {
    const registry = track(new AgentSessionRegistry(await userDataDir()))
    registry.createSession({ ...createInput('term-1'), providerSessionId: 'p-a' })
    registry.importExternalSession({
      engine: 'claude',
      cwd: '/repo',
      providerSessionId: 'p-b',
      transcriptPath: '/tmp/other.jsonl',
      firstPrompt: 'different conversation',
      turnCount: 1,
    })
    expect(registry.listSessions({ includeArchived: true })).toHaveLength(2)
  })

  it('backfills a titleless hook-owned session from the transcript import', async () => {
    const registry = track(new AgentSessionRegistry(await userDataDir()))
    const record = registry.createSession({ ...createInput('term-1'), providerSessionId: 'p-1' })
    registry.recordTurnEnd('term-1', 'done')
    expect(registry.getSession(record.id)?.firstPrompt).toBe('')
    registry.importExternalSession({
      engine: 'claude',
      cwd: '/repo',
      providerSessionId: 'p-1',
      transcriptPath: '/tmp/sess.jsonl',
      firstPrompt: '  fix the login retry  ',
      turnCount: 3,
    })
    const detail = registry.getSession(record.id)
    expect(detail?.external).toBeUndefined()
    expect(detail?.firstPrompt).toBe('fix the login retry')
    expect(detail?.lastPrompt).toBe('fix the login retry')
    // Hook-owned turns stay authoritative; the import never rewrites them.
    expect(detail?.turnCount).toBe(1)
    expect(detail?.transcriptPath).toBe('/tmp/sess.jsonl')
  })

  it('persists across reloads and recovers from corrupt stores', async () => {
    const dir = await userDataDir()
    const registry = track(new AgentSessionRegistry(dir))
    const record = registry.createSession(createInput('term-1'))
    registry.notePrompt('term-1', 'hello')
    await registry.flush()
    const reloaded = track(new AgentSessionRegistry(dir))
    await reloaded.load()
    expect(reloaded.getSession(record.id)?.firstPrompt).toBe('hello')

    await writeFile(join(dir, 'janusx', 'agent-sessions.json'), '{broken')
    const corrupt = track(new AgentSessionRegistry(dir))
    await corrupt.load()
    expect(corrupt.listSessions()).toEqual([])
  })

  it('caps stored sessions and turns', async () => {
    const registry = track(new AgentSessionRegistry(await userDataDir()))
    for (let i = 0; i < 205; i++) {
      registry.createSession(createInput(`term-${i}`, `ws-${i}`))
    }
    expect(registry.listSessions().length).toBeLessThanOrEqual(200)
  })

  function seedDoc(sessions: Array<Record<string, unknown>>) {
    return JSON.stringify({ version: 1, sessions })
  }

  function seedRecord(id: string, cwd: string): Record<string, unknown> {
    return {
      id,
      workspaceId: 'ws-1',
      engine: 'claude',
      cwd,
      firstPrompt: 'seeded',
      lastPrompt: 'seeded',
      turnCount: 1,
      checkpointCount: 0,
      checkpointIds: [],
      status: 'done',
      terminalIds: [],
      turns: [],
      createdAt: '2026-09-21T00:00:00.000Z',
      updatedAt: '2026-09-21T00:00:00.000Z',
      archived: false,
    }
  }

  it('never clobbers disk state it has not read yet', async () => {
    const dir = await userDataDir()
    const storePath = join(dir, 'janusx', 'agent-sessions.json')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(dir, 'janusx'), { recursive: true })
    await writeFile(storePath, seedDoc([seedRecord('seed-1', '/repo')]))
    // No explicit load: the first mutation gates on it internally.
    const registry = track(new AgentSessionRegistry(dir))
    registry.createSession(createInput('term-new'))
    await registry.flush()
    const reloaded = track(new AgentSessionRegistry(dir))
    await reloaded.load()
    expect(reloaded.getSession('seed-1')?.firstPrompt).toBe('seeded')
    expect(reloaded.listSessions()).toHaveLength(2)
  })

  it('refuses to overwrite a corrupt store and keeps a rollback copy', async () => {
    const dir = await userDataDir()
    const storePath = join(dir, 'janusx', 'agent-sessions.json')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(dir, 'janusx'), { recursive: true })
    await writeFile(storePath, seedDoc([seedRecord('seed-1', '/repo')]))
    const registry = track(new AgentSessionRegistry(dir))
    await registry.load()
    // Healthy write leaves a rollback copy of the previous bytes.
    registry.createSession(createInput('term-new'))
    await registry.flush()
    expect(await readFile(`${storePath}.prev`, 'utf8')).toBe(seedDoc([seedRecord('seed-1', '/repo')]))

    await writeFile(storePath, '{broken')
    const corrupt = track(new AgentSessionRegistry(dir))
    await corrupt.load()
    expect(corrupt.listSessions()).toEqual([])
    corrupt.createSession(createInput('term-x'))
    await corrupt.flush()
    expect(await readFile(storePath, 'utf8')).toBe('{broken')
  })

  it('emits change events on conversation writes so the panel refreshes mid-turn', async () => {
    const registry = track(new AgentSessionRegistry(await userDataDir()))
    const seen: Array<string | undefined> = []
    registry.setChangeListener((sessionId) => {
      seen.push(sessionId)
    })
    const record = registry.createSession(createInput('term-1'))
    expect(seen).toEqual([record.id])

    // Submit path: prompt text and checkpoint count reach the card at once.
    registry.notePrompt('term-1', 'do the thing')
    registry.noteCheckpoint('term-1', 'cp-1')
    registry.noteBranch('term-1', 'feature/x')
    expect(seen).toEqual([record.id, record.id, record.id, record.id])

    // Provider path: first values notify, repeats stay silent (hot hook path).
    registry.noteProviderSession('term-1', 'prov-1', '/tmp/t.jsonl')
    expect(seen).toHaveLength(5)
    registry.noteProviderSession('term-1', 'prov-1', '/tmp/t.jsonl')
    expect(seen).toHaveLength(5)
    registry.noteProviderSession('term-1', 'prov-2')
    expect(seen).toHaveLength(6)

    // Unknown terminals never notify.
    registry.notePrompt('missing', 'nope')
    registry.noteCheckpoint('missing', 'cp-x')
    expect(seen).toHaveLength(6)
  })

  it('collapses bulk imports into a single change event', async () => {
    const registry = track(new AgentSessionRegistry(await userDataDir()))
    const seen: Array<string | undefined> = []
    registry.setChangeListener((sessionId) => {
      seen.push(sessionId)
    })
    registry.beginBatch()
    for (let i = 0; i < 3; i += 1) {
      registry.importExternalSession({
        engine: 'claude',
        cwd: '/repo',
        providerSessionId: `sess-${i}`,
        transcriptPath: `/tmp/t-${i}.jsonl`,
        firstPrompt: `prompt ${i}`,
        turnCount: 1,
      })
    }
    // No per-row events while the batch is open.
    expect(seen).toHaveLength(0)
    registry.endBatch()
    expect(seen).toHaveLength(1)
    expect(registry.listSessions({ includeArchived: true })).toHaveLength(3)
  })

  it('collapses bulk imports into a single store write', async () => {
    const registry = track(new AgentSessionRegistry(await userDataDir()))
    vi.mocked(writeFileAtomic).mockClear()
    registry.beginBatch()
    for (let i = 0; i < 5; i += 1) {
      registry.importExternalSession({
        engine: 'claude',
        cwd: '/repo',
        providerSessionId: `w-${i}`,
        transcriptPath: `/tmp/w-${i}.jsonl`,
        firstPrompt: `prompt ${i}`,
        turnCount: 1,
      })
    }
    // A per-row persist stringifies the whole store each time and stalls the
    // main process through the scan; the batch defers to one write.
    expect(vi.mocked(writeFileAtomic)).not.toHaveBeenCalled()
    registry.endBatch()
    await registry.flush()
    expect(vi.mocked(writeFileAtomic)).toHaveBeenCalledTimes(1)
    expect(registry.listSessions({ includeArchived: true })).toHaveLength(5)
  })

  it('flushes a mid-batch snapshot so shutdown drops no deferred write', async () => {
    const dir = await userDataDir()
    const registry = track(new AgentSessionRegistry(dir))
    vi.mocked(writeFileAtomic).mockClear()
    registry.beginBatch()
    registry.importExternalSession({
      engine: 'claude',
      cwd: '/repo',
      providerSessionId: 'w-0',
      transcriptPath: '/tmp/w-0.jsonl',
      firstPrompt: 'prompt 0',
      turnCount: 1,
    })
    await registry.flush()
    expect(vi.mocked(writeFileAtomic)).toHaveBeenCalledTimes(1)
    registry.endBatch()
    await registry.flush()
    // The flushed snapshot already carried the batch row; close adds none.
    expect(vi.mocked(writeFileAtomic)).toHaveBeenCalledTimes(1)
    const reloaded = track(new AgentSessionRegistry(dir))
    await reloaded.load()
    expect(reloaded.listSessions({ includeArchived: true })).toHaveLength(1)
  })

  it('snapshots the prompt and excerpt onto the turn so content survives prune', async () => {
    const registry = track(new AgentSessionRegistry(await userDataDir()))
    const record = registry.createSession(createInput('term-1'))
    registry.notePrompt('term-1', 'do the thing')
    registry.noteCheckpoint('term-1', 'cp-1')
    registry.recordTurnEnd('term-1', 'done', 'cp-1', 'did it')
    // Pending prompt clears after one turn; the next turn without a new
    // submit carries no stale question.
    registry.recordTurnEnd('term-1', 'done', 'cp-1')
    const turns = registry.getSession(record.id)?.turns ?? []
    expect(turns).toHaveLength(2)
    expect(turns[0]).toMatchObject({ prompt: 'do the thing', excerpt: 'did it' })
    expect(turns[1].prompt).toBeUndefined()
  })

  it('attaches a slow reply to its original turn after another submit completes', async () => {
    const registry = track(new AgentSessionRegistry(await userDataDir()))
    const record = registry.createSession(createInput('term-1'))
    registry.notePrompt('term-1', 'first question')
    const attachFirst = registry.recordTurnEnd('term-1', 'done')
    registry.notePrompt('term-1', 'second question')
    registry.recordTurnEnd('term-1', 'done', undefined, 'second answer')
    attachFirst?.('first answer')
    expect(registry.getSession(record.id)?.turns).toMatchObject([
      { prompt: 'first question', excerpt: 'first answer' },
      { prompt: 'second question', excerpt: 'second answer' },
    ])
    expect(registry.getSession(record.id)?.turnCount).toBe(2)
  })

  it('absorbs an external row when a hook session learns its provider id late', async () => {
    const registry = track(new AgentSessionRegistry(await userDataDir()))
    const hook = registry.createSession({
      ...createInput('term-1'),
      cwd: 'C:/repo/proj',
    })
    registry.importExternalSession({
      engine: 'claude',
      cwd: 'C:/repo/proj',
      providerSessionId: 'sess-1',
      transcriptPath: '/tmp/sess-1.jsonl',
      firstPrompt: 'from transcript',
      lastExcerpt: 'tail answer',
      turnCount: 3,
    })
    expect(registry.listSessions()).toHaveLength(2)
    registry.noteProviderSession('term-1', 'sess-1', '/tmp/sess-1.jsonl')
    const sessions = registry.listSessions()
    expect(sessions).toHaveLength(1)
    const merged = registry.getSession(hook.id)
    expect(merged?.providerSessionId).toBe('sess-1')
    expect(merged?.firstPrompt).toBe('from transcript')
    expect(merged?.transcriptPath).toBe('/tmp/sess-1.jsonl')
    expect(merged?.turns.some((turn) => turn.excerpt === 'tail answer')).toBe(true)
    expect(merged?.external).toBeUndefined()
  })

  it('merges an import into a hook row that knows the transcript path', async () => {
    const registry = track(new AgentSessionRegistry(await userDataDir()))
    const hook = registry.createSession({
      ...createInput('term-1'),
      transcriptPath: '/tmp/sess-2.jsonl',
    })
    registry.importExternalSession({
      engine: 'claude',
      cwd: '/repo',
      providerSessionId: 'sess-2',
      transcriptPath: '/tmp/sess-2.jsonl',
      firstPrompt: 'transcript question',
      turnCount: 1,
    })
    expect(registry.listSessions()).toHaveLength(1)
    const merged = registry.getSession(hook.id)
    expect(merged?.providerSessionId).toBe('sess-2')
    expect(merged?.firstPrompt).toBe('transcript question')
  })

  it('recomputes turnCount on rescan instead of only growing it', async () => {
    const registry = track(new AgentSessionRegistry(await userDataDir()))
    const input = {
      engine: 'claude',
      cwd: '/repo',
      providerSessionId: 'sess-3',
      transcriptPath: '/tmp/sess-3.jsonl',
      firstPrompt: 'q',
      turnCount: 4,
    }
    registry.importExternalSession(input)
    expect(registry.listSessions()[0].turnCount).toBe(4)
    registry.importExternalSession({ ...input, turnCount: 2 })
    expect(registry.listSessions()[0].turnCount).toBe(2)
  })

  it('keeps sibling paths out of a workspace scope', async () => {
    const registry = track(new AgentSessionRegistry(await userDataDir()))
    registry.importExternalSession({
      engine: 'claude',
      cwd: 'C:/repo-server',
      providerSessionId: 'sess-a',
      transcriptPath: '/tmp/a.jsonl',
      firstPrompt: 'q',
      turnCount: 1,
    })
    registry.importExternalSession({
      engine: 'claude',
      cwd: 'C:/repo/proj',
      providerSessionId: 'sess-b',
      transcriptPath: '/tmp/b.jsonl',
      firstPrompt: 'q',
      turnCount: 1,
    })
    const scoped = registry.listSessions({ cwd: 'C:/repo' })
    expect(scoped).toHaveLength(1)
    expect(scoped[0].cwd).toBe('C:/repo/proj')
    expect(registry.listSessions({ cwd: 'C:/repo-server' })).toHaveLength(1)
  })

  it('heals a stale AGENTS.md first prompt on rescan for external rows', async () => {
    const registry = track(new AgentSessionRegistry(await userDataDir()))
    const input = {
      engine: 'codex',
      cwd: '/repo',
      providerSessionId: 'sess-codex',
      transcriptPath: '/tmp/sess-codex.jsonl',
      firstPrompt: '# AGENTS.md instructions for C:\\repo\n\n<INSTRUCTIONS>\nnoise',
      turnCount: 1,
    }
    registry.importExternalSession(input)
    const [created] = registry.listSessions()
    expect(created.firstPrompt).toContain('AGENTS.md')
    // A rescan with the fixed parser heals title, last prompt, and seed turn.
    registry.importExternalSession({ ...input, firstPrompt: 'real question' })
    const sessions = registry.listSessions()
    expect(sessions).toHaveLength(1)
    const healed = registry.getSession(created.id)
    expect(healed?.firstPrompt).toBe('real question')
    expect(healed?.lastPrompt).toBe('real question')
    expect(healed?.turns.find((turn) => turn.prompt)?.prompt).toBe('real question')
    expect(healed?.turns.some((turn) => (turn.prompt ?? '').includes('AGENTS.md'))).toBe(false)
  })

  it('heals an injection-shaped title on a hook row without touching its turns', async () => {
    const registry = track(new AgentSessionRegistry(await userDataDir()))
    const hook = registry.createSession({
      ...createInput('term-1'),
      transcriptPath: '/tmp/sess-hook.jsonl',
    })
    registry.recordTurnEnd('term-1', 'done', undefined, 'answer')
    registry.importExternalSession({
      engine: 'claude',
      cwd: '/repo',
      providerSessionId: 'sess-hook',
      transcriptPath: '/tmp/sess-hook.jsonl',
      firstPrompt: 'transcript question',
      turnCount: 1,
    })
    expect(registry.getSession(hook.id)?.firstPrompt).toBe('transcript question')
  })
})
