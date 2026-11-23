import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { MemoStore } from '../../src/main/memo/store'
import { memoEditSchema } from '../../src/shared/memo'

const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }) })

describe('memo workspace retirement', () => {
  it('atomically upgrades v1 on read, deleting loose records and retaining node identities and source', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'janus-memo-legacy-'))
    directories.push(directory)
    const id = randomUUID()
    const nodeId = randomUUID()
    const point = { id: randomUUID(), text: 'Keep my source', source: { conversationId: 'chat', messageId: 'message' } }
    const legacy = { version: 1, id, title: 'Legacy', revision: 7, createdAt: 1, updatedAt: 2,
      workspaces: [{ id: 'project', name: 'Project' }], nodes: [{ id: nodeId, title: 'Node', label: 'v1', points: [point] }], unassigned: [{ id: randomUUID(), text: 'Delete retired record' }] }
    const path = join(directory, `${id}.json`)
    const bytes = JSON.stringify(legacy)
    await writeFile(path, bytes, 'utf8')
    const store = new MemoStore(directory)
    const changes: unknown[] = []
    store.subscribe(change => changes.push(change))
    expect(await store.getReadOnly(id)).toMatchObject({ version: 3, revision: 7, nodes: legacy.nodes })
    expect(await readFile(path, 'utf8')).toBe(bytes)
    expect(changes).toEqual([])
    const current = await store.get(id)
    expect(current).toEqual({ version: 3, id, title: 'Legacy', revision: 8, createdAt: 1, updatedAt: expect.any(Number), nodes: legacy.nodes })
    const upgraded = await readFile(path, 'utf8')
    expect(JSON.parse(upgraded)).toEqual(current)
    expect(changes).toEqual([{ id, revision: 8 }])
    await expect(store.edit(id, { expectedRevision: 7, operations: [{ op: 'rename', title: 'Conflict' }] })).rejects.toThrow('MEMO_CONFLICT')
    expect(await readFile(path, 'utf8')).toBe(upgraded)
    expect((await store.get(id)).revision).toBe(8)
    const edited = await store.edit(id, { expectedRevision: 8, operations: [{ op: 'rename', title: 'Migrated' }] })
    expect(edited.revision).toBe(9)
    expect(edited.nodes[0]).toEqual(legacy.nodes[0])
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(edited)
    expect((await new MemoStore(directory).list())[0]).toEqual(edited)
  })

  it('removes the retired v2 bucket on disk exactly once, including an otherwise empty memo', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'janus-memo-v2-'))
    directories.push(directory)
    const id = randomUUID()
    const path = join(directory, `${id}.json`)
    await writeFile(path, JSON.stringify({ version: 2, id, title: 'Old memo', revision: 4, createdAt: 1, updatedAt: 2, nodes: [], unassigned: [{ id: randomUUID(), text: 'Retired' }] }), 'utf8')
    const store = new MemoStore(directory)
    const current = (await store.list())[0]
    expect(current.version).toBe(3)
    expect(current.revision).toBe(5)
    expect(current.nodes).toEqual([])
    expect(current).not.toHaveProperty('unassigned')
    const bytes = await readFile(path, 'utf8')
    expect(JSON.parse(bytes)).toEqual(current)
    expect(await new MemoStore(directory).get(id)).toEqual(current)
    expect(await readFile(path, 'utf8')).toBe(bytes)
    expect(memoEditSchema.safeParse({ expectedRevision: 5, operations: [{ op: 'addPoint', nodeId: null, text: 'Rejected' }] }).success).toBe(false)
  })

  it('keeps an unreadable legacy file intact and rejects workspace editing operations', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'janus-memo-legacy-'))
    directories.push(directory)
    const id = randomUUID()
    const path = join(directory, `${id}.json`)
    const bytes = JSON.stringify({ version: 1, id, workspaces: [], nodes: [{ invalid: true }] })
    await writeFile(path, bytes, 'utf8')
    await expect(new MemoStore(directory).list()).rejects.toThrow()
    expect(await readFile(path, 'utf8')).toBe(bytes)
    expect(memoEditSchema.safeParse({ expectedRevision: 0, operations: [{ op: 'mapWorkspaces', workspaces: [] }] }).success).toBe(false)
  })
})
