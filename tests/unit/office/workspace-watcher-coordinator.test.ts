import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: any[]) => any>()
  const watchers: Array<{
    callback: (eventType: 'change' | 'rename', filename: string | Buffer | null) => void
    close: ReturnType<typeof vi.fn>
    error?: () => void
  }> = []
  const watch = vi.fn((_path, _options, callback) => {
    const record = {
      callback,
      close: vi.fn(),
      error: undefined as (() => void) | undefined,
    }
    watchers.push(record)
    return {
      close: record.close,
      on: (event: string, handler: () => void) => {
        if (event === 'error') record.error = handler
      },
    }
  })
  const trackBlueprintReviewWorkspace = vi.fn()
  return { handlers, watchers, watch, trackBlueprintReviewWorkspace }
})

// Keep the real fs and override only watch.
vi.mock('fs', async (importOriginal) => ({ ...(await importOriginal()), watch: mocks.watch }))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => join(tmpdir(), 'janusx-watcher-profile')) },
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => any) => mocks.handlers.set(channel, handler),
  },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn() },
}))

vi.mock('../../../src/main/blueprint/review/runtime', () => ({
  trackBlueprintReviewWorkspace: mocks.trackBlueprintReviewWorkspace,
}))

import {
  disposeWorkspaceWatcher,
  disposeWorkspaceWatchers,
  registerWorkspaceHandlers,
  subscribeWorkspaceWatcher,
} from '../../../src/main/ipc/handlers'
import { app } from 'electron'

let temporaryRoot: string

describe('workspace watcher coordinator', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    mocks.handlers.clear()
    mocks.watch.mockClear()
    mocks.watchers.length = 0
    vi.mocked(app.getPath).mockImplementation(() => join(tmpdir(), 'janusx-watcher-profile'))
    temporaryRoot = await mkdtemp(join(tmpdir(), 'janusx-watcher-coordinator-'))
  })

  afterEach(async () => {
    disposeWorkspaceWatchers()
    vi.useRealTimers()
    await rm(temporaryRoot, { recursive: true, force: true })
  })

  it('shares one watcher without activating the Blueprint plugin', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const unsubscribeFirst = subscribeWorkspaceWatcher(temporaryRoot, first)
    const unsubscribeSecond = subscribeWorkspaceWatcher(temporaryRoot, second)
    const send = vi.fn()
    const mainWindow = {
      on: vi.fn(),
      isDestroyed: () => false,
      webContents: { isDestroyed: () => false, send },
    } as any
    registerWorkspaceHandlers(() => mainWindow)
    await mocks.handlers.get('filetree:load')!({}, temporaryRoot)

    expect(mocks.watch).toHaveBeenCalledTimes(1)
    expect(mocks.trackBlueprintReviewWorkspace).not.toHaveBeenCalled()
    mocks.watchers[0].callback('change', 'report.docx')
    expect(first).toHaveBeenCalledWith('change', 'report.docx')
    expect(second).toHaveBeenCalledWith('change', 'report.docx')
    await vi.advanceTimersByTimeAsync(150)
    expect(send).toHaveBeenCalledWith('filetree:changed', {
      workspacePath: temporaryRoot,
      changedFilePath: join(temporaryRoot, 'report.docx'),
    })

    unsubscribeFirst()
    expect(mocks.watchers[0].close).not.toHaveBeenCalled()
    unsubscribeSecond()
    expect(mocks.watchers[0].close).not.toHaveBeenCalled()
    disposeWorkspaceWatcher(temporaryRoot)
    expect(mocks.watchers[0].close).toHaveBeenCalledTimes(1)
    expect(mocks.trackBlueprintReviewWorkspace).not.toHaveBeenCalled()
  })

  it('closes a subscriber-only watcher after its final independent unsubscribe', () => {
    const unsubscribeFirst = subscribeWorkspaceWatcher(temporaryRoot, vi.fn())
    const unsubscribeSecond = subscribeWorkspaceWatcher(temporaryRoot, vi.fn())
    unsubscribeFirst()
    expect(mocks.watchers[0].close).not.toHaveBeenCalled()
    unsubscribeSecond()
    expect(mocks.watchers[0].close).toHaveBeenCalledTimes(1)
  })

  it('filters Git churn from renderer refreshes but preserves raw subscribers and real Git changes', async () => {
    const subscriber = vi.fn()
    subscribeWorkspaceWatcher(temporaryRoot, subscriber)
    const send = vi.fn()
    const mainWindow = { on: vi.fn(), isDestroyed: () => false,
      webContents: { isDestroyed: () => false, send } } as any
    registerWorkspaceHandlers(() => mainWindow)
    await mocks.handlers.get('filetree:load')!({}, temporaryRoot)
    for (const path of ['.git/index.lock', '.git/objects/ab/cd', '.git/logs/HEAD', '.janusX/cache']) {
      mocks.watchers[0].callback('change', path)
    }
    await vi.advanceTimersByTimeAsync(150)
    expect(subscriber).toHaveBeenCalledTimes(4)
    expect(send).not.toHaveBeenCalled()
    mocks.watchers[0].callback('change', '.git/index')
    await vi.advanceTimersByTimeAsync(150)
    expect(send).toHaveBeenCalledTimes(1)
    send.mockClear()
    mocks.watchers[0].callback('change', 'one.ts')
    mocks.watchers[0].callback('change', 'two.ts')
    await vi.advanceTimersByTimeAsync(150)
    expect(send).toHaveBeenCalledWith('filetree:changed', {
      workspacePath: temporaryRoot, changedFilePath: null,
    })
  })

  it('notifies subscribers and replaces a failed watcher without leaking recovery timers', async () => {
    const subscriber = vi.fn()
    subscribeWorkspaceWatcher(temporaryRoot, subscriber)
    mocks.watchers[0].error?.()

    expect(subscriber).toHaveBeenCalledWith('error', null)
    expect(mocks.watchers[0].close).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(150)
    expect(mocks.watch).toHaveBeenCalledTimes(2)

    disposeWorkspaceWatchers()
    expect(mocks.watchers[1].close).toHaveBeenCalledTimes(1)
    await vi.runAllTimersAsync()
    expect(mocks.watch).toHaveBeenCalledTimes(2)
  })

  it('keeps profile churn for raw subscribers while suppressing renderer reloads', async () => {
    vi.mocked(app.getPath).mockImplementation(() => join(temporaryRoot, 'release', 'data'))
    const raw = vi.fn()
    subscribeWorkspaceWatcher(temporaryRoot, raw)
    const send = vi.fn()
    const mainWindow = { on: vi.fn(), isDestroyed: () => false,
      webContents: { isDestroyed: () => false, send } } as any
    registerWorkspaceHandlers(() => mainWindow)
    await mocks.handlers.get('filetree:load')!({}, temporaryRoot)
    for (let i = 0; i < 1000; i++) mocks.watchers[0].callback('change', 'release/data/usage-ledger.sqlite-wal')
    await vi.advanceTimersByTimeAsync(200)
    expect(raw).toHaveBeenCalledTimes(1000)
    expect(send).not.toHaveBeenCalled()
    mocks.watchers[0].callback('change', 'data/source.json')
    await vi.advanceTimersByTimeAsync(200)
    expect(send).toHaveBeenCalledWith('filetree:changed', { workspacePath: temporaryRoot, changedFilePath: join(temporaryRoot, 'data/source.json') })
  })
})
