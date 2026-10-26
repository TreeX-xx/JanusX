import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Blueprint } from '../../plugins/blueprint/src/shared/janus/types'

const mocks = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('@/services/blueprint', () => ({ loadBlueprint: mocks.load, listBlueprintSummaries: vi.fn(), focusNode: vi.fn() }))
vi.mock('@/stores/workspace', () => ({ useWorkspaceStore: { getState: () => ({ workspaces: [], activeWorkspaceId: null }) } }))
import { HarnessNoteService } from '../../src/main/harness/service'
import { useBlueprintStore } from '../../src/renderer/src/stores/blueprint'

const graph = (id: string): Blueprint => ({ id, source: 'harness', nodes: {} } as Blueprint)
let root: string
let svc: HarnessNoteService
beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'note-watch-start-'))
  svc = new HarnessNoteService()
  useBlueprintStore.setState({ currentBlueprint: null, blueprintWorkspace: {}, error: null, loadState: 'idle', loading: false, loadingBlueprintId: null })
  // Mirrors the awaited main IPC ordering: load projection, then start watcher.
  mocks.load.mockImplementation(async (cwd: string, id: string) => {
    const result = graph(id)
    await svc.watch(cwd)
    return result
  })
})
afterEach(async () => { svc.unwatchAll(); await fs.rm(root, { recursive: true, force: true }); vi.clearAllMocks() })

describe('watch startup errors survive the load boundary', () => {
  it('shows a first-load failure with no subscriber, then permits retry', async () => {
    const id = 'harness:project:first'
    useBlueprintStore.setState({ blueprintWorkspace: { [id]: root } })
    await useBlueprintStore.getState().loadBlueprint(id)
    expect(useBlueprintStore.getState()).toMatchObject({ loadState: 'error', currentBlueprint: null, loading: false })
    expect(useBlueprintStore.getState().error).toContain('Note watcher could not start')
    await fs.mkdir(join(root, '.agents'))
    await useBlueprintStore.getState().loadBlueprint(id)
    expect(useBlueprintStore.getState()).toMatchObject({ loadState: 'idle', error: null, currentBlueprint: { id } })
  })

  it('keeps the current checkout and exposes failure when switching to another', async () => {
    const good = join(root, 'good')
    const bad = join(root, 'bad')
    await fs.mkdir(join(good, '.agents'), { recursive: true })
    const first = 'harness:project:good'
    const second = 'harness:project:bad'
    useBlueprintStore.setState({ blueprintWorkspace: { [first]: good, [second]: bad } })
    await useBlueprintStore.getState().loadBlueprint(first)
    await useBlueprintStore.getState().loadBlueprint(second)
    expect(useBlueprintStore.getState()).toMatchObject({ loadState: 'error', currentBlueprint: { id: first }, loadingBlueprintId: null })
    expect(useBlueprintStore.getState().error).toContain(bad)
    await expect(svc.watch(good)).resolves.toBeUndefined()
  })
})
