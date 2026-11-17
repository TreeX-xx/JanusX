import { randomUUID } from 'node:crypto'
import { readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeRecordAtomic } from '../../src/main/janus/superagent/persistence'
import { submission, superAgentFixture, workspace } from '../helpers/superagent-fixture'

describe('SuperAgent persistence failure boundaries', () => {
  let fixture: Awaited<ReturnType<typeof superAgentFixture>>
  const scope = workspace.workspaceId
  beforeEach(async () => { fixture = await superAgentFixture() })
  afterEach(async () => { vi.restoreAllMocks(); await fixture.dispose() })

  it.each(['resource', 'index'])('rejects a failed %s write without a receipt or change and retains earlier input', async stage => {
    const accepted = await fixture.store.receiveInput(workspace, submission('Already saved'))
    await fixture.store.close()
    const before = await readFile(fixture.persistence.indexPath, 'utf8')
    let fail = true
    const { store } = fixture.createStore(async (path, text) => {
      if (fail && (stage === 'index' ? path === fixture.persistence.indexPath : path.endsWith('.txt'))) throw new Error('disk full')
      await writeRecordAtomic(path, text)
    })
    const change = vi.fn()
    store.subscribe(change)
    const input = submission('Pending input')
    await expect(store.receiveInput(workspace, input)).rejects.toThrow('disk full')
    expect(change).not.toHaveBeenCalled()
    expect(await readFile(fixture.persistence.indexPath, 'utf8')).toBe(before)
    expect((await store.snapshot(scope)).inputs.map(row => row.id)).toEqual([accepted.input.id])
    expect((await store.readResource(scope, accepted.input.resourceId)).text).toBe('Already saved')
    fail = false
    const retried = await store.receiveInput(workspace, input)
    expect(retried.duplicate).toBe(false)
    expect((await fixture.createStore().store.snapshot(scope)).inputs).toHaveLength(2)
    expect(change).toHaveBeenCalledTimes(1)
  })

  it('reloads after an ambiguous post-commit failure and does not duplicate an explicit retry', async () => {
    let fail = true
    const { store } = fixture.createStore(async (path, text) => {
      await writeRecordAtomic(path, text)
      if (fail && path === fixture.persistence.indexPath) throw new Error('post-rename failure')
    })
    const input = submission()
    const change = vi.fn()
    store.subscribe(change)
    await expect(store.receiveInput(workspace, input)).rejects.toThrow('post-rename')
    fail = false
    const receipt = await store.receiveInput(workspace, input)
    expect(receipt).toMatchObject({ duplicate: true, revision: 1 })
    expect((await store.snapshot(scope)).inputs).toHaveLength(1)
    expect(change).not.toHaveBeenCalled()
  })

  it.each(['syntax', 'version', 'reference', 'duplicate'])('preserves a damaged %s index and never silently resets it', async damage => {
    await fixture.store.receiveInput(workspace, submission())
    await fixture.store.close()
    const data = JSON.parse(await readFile(fixture.persistence.indexPath, 'utf8'))
    if (damage === 'version') data.version = 999
    if (damage === 'reference') data.inputs[0].resourceId = randomUUID()
    if (damage === 'duplicate') data.inputs.push({ ...data.inputs[0], id: randomUUID(), sequence: 2 })
    const broken = damage === 'syntax' ? '{interrupted' : JSON.stringify(data)
    await writeFile(fixture.persistence.indexPath, broken, 'utf8')
    const { store } = fixture.createStore()
    await expect(store.snapshot(scope)).rejects.toThrow('original file preserved')
    await expect(store.receiveInput(workspace, submission('Must not overwrite'))).rejects.toThrow('original file preserved')
    expect(await readFile(fixture.persistence.indexPath, 'utf8')).toBe(broken)
  })

  it.each(['missing', 'changed'])('reports a %s original resource instead of returning partial or invented text', async damage => {
    const { input } = await fixture.store.receiveInput(workspace, submission())
    const path = join(fixture.root, 'resources', `${input.resourceId}.txt`)
    if (damage === 'missing') await rm(path)
    else await writeFile(path, 'modified', 'utf8')
    await expect(fixture.store.readResource(scope, input.resourceId)).rejects.toThrow(/unavailable|damaged/)
    expect((await fixture.store.snapshot(scope)).inputs).toHaveLength(1)
  })

  it('does not truncate core history to the external session index limits', async () => {
    await fixture.store.receiveInput(workspace, submission())
    await fixture.store.close()
    const data = await fixture.persistence.load()
    const source = data.inputs[0]
    data.inputs = Array.from({ length: 205 }, (_, index) => ({ ...source, id: randomUUID(), eventId: randomUUID(), sequence: index + 1 }))
    // Sharing immutable body content in a valid historical fixture avoids 205 redundant disk writes.
    await fixture.persistence.save(data)
    const { store } = fixture.createStore()
    expect((await store.snapshot(scope)).inputs).toHaveLength(205)
    await store.receiveInput(workspace, submission('Newest requirement'))
    const reloaded = fixture.createStore().store
    expect((await reloaded.snapshot(scope)).inputs).toHaveLength(206)
    expect((await reloaded.readResource(scope, source.resourceId)).text).toBe(submission().text)
  })

  it('drains admitted writes on close, rejects new writes and only notifies after the commit', async () => {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const { store } = fixture.createStore(async (path, text) => {
      if (path === fixture.persistence.indexPath) { entered.resolve(); await release.promise }
      await writeRecordAtomic(path, text)
    })
    const changed = vi.fn()
    store.subscribe(changed)
    let acknowledged = false
    const accepted = store.receiveInput(workspace, submission()).then(value => { acknowledged = true; return value })
    await entered.promise
    const closed = store.close()
    let drained = false
    void closed.then(() => { drained = true })
    await expect(store.receiveInput(workspace, submission())).rejects.toThrow('closing')
    expect(acknowledged).toBe(false)
    expect(drained).toBe(false)
    expect(changed).not.toHaveBeenCalled()
    release.resolve()
    const receipt = await accepted
    await closed
    expect(drained).toBe(true)
    expect(changed).toHaveBeenCalledTimes(1)
    expect((await fixture.createStore().store.snapshot(scope)).inputs[0].id).toBe(receipt.input.id)
    expect((await readdir(fixture.root)).some(name => name.endsWith('.tmp'))).toBe(false)
  })

  it('does not turn observer failures into a failed persistence receipt', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    fixture.store.subscribe(() => { throw new Error('view disappeared') })
    const healthy = vi.fn()
    fixture.store.subscribe(healthy)
    await expect(fixture.store.receiveInput(workspace, submission())).resolves.toMatchObject({ duplicate: false })
    expect(healthy).toHaveBeenCalledTimes(1)
    expect(errors).toHaveBeenCalledTimes(1)
    expect((await fixture.createStore().store.snapshot(scope)).inputs).toHaveLength(1)
  })
})
