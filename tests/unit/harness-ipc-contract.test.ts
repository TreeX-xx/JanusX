import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HARNESS_COMMAND_CHANNELS, HARNESS_EVENT_CHANNELS, type HarnessAPI } from '../../src/shared/ipc/harness'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  expose: vi.fn(),
  send: vi.fn(),
  changes: vi.fn(),
}))

let harnessApi: HarnessAPI
const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()

vi.mock('electron', () => ({
  app: { getPath: () => `${process.env.TEMP ?? process.cwd()}\\janusx-harness-ipc-${process.pid}` },
  BrowserWindow: { fromWebContents: () => null },
  contextBridge: {
    exposeInMainWorld: (_name: string, api: { harness: HarnessAPI }) => {
      harnessApi = api.harness
      mocks.expose(api)
    },
  },
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, fn)
      mocks.handle(channel, fn)
    },
  },
  ipcRenderer: {
    invoke: mocks.invoke,
    on: mocks.on,
    removeListener: mocks.removeListener,
    send: mocks.send,
  },
}))

vi.mock('../../src/main/harness/service', () => ({
  harnessNoteService: {
    resolveRoot: vi.fn(),
    projectView: vi.fn(),
    rescan: vi.fn(),
    applyOperations: vi.fn(),
    readNote: vi.fn(),
    mergeNoteEdit: vi.fn(),
    getBindings: vi.fn(),
    setBinding: vi.fn(),
    shareSnapshot: vi.fn(),
    exportSnapshot: vi.fn(),
    watch: vi.fn(),
    onChange: vi.fn(),
  },
}))

vi.mock('../../src/main/harness/note-chat', () => ({ listNoteChatChanges: mocks.changes }))

vi.mock('../../src/main/harness/execution-adapter', () => ({
  cancelTaskRun: vi.fn(),
  closeoutTaskRun: vi.fn(),
  getTaskRun: vi.fn(),
  handoffTaskRun: vi.fn(),
  readTaskHandoff: vi.fn(),
  takeoverTaskRun: vi.fn(),
  listTaskThreads: vi.fn(),
  openTaskThread: vi.fn(),
  closeTaskThread: vi.fn(),
  listTaskRuns: vi.fn(),
  pauseTaskRun: vi.fn(),
  prepareTaskRun: vi.fn(),
  rebaselineTaskRun: vi.fn(),
  resumeTaskRun: vi.fn(),
  startTaskRun: vi.fn(),
}))

vi.mock('../../src/main/harness/task-thread', () => ({
  ensureTaskThread: vi.fn(),
  setThreadModel: vi.fn(),
  readDesktopConcurrency: vi.fn(),
}))

vi.mock('../../src/main/harness/independent-review', () => ({
  requestIndependentReview: vi.fn(),
  finishWithLatestReceipt: vi.fn(),
}))

vi.mock('../../src/main/harness/undo', () => ({
  previewUndo: vi.fn(),
  applyUndo: vi.fn(),
}))




vi.mock('../../src/main/harness/desktop-executor', () => ({
  executeDesktopTask: vi.fn(),
  runDesktopCommand: vi.fn(),
  reviewClaimFromText: vi.fn(),
}))

vi.mock('../../src/main/harness/desktop-review', () => ({
  buildDesktopReviewPrompt: vi.fn(),
  createModelReviewPort: vi.fn(),
  parseDesktopReviewClaim: vi.fn(),
}))

vi.mock('../../src/main/llm/LlmService', () => ({
  llmService: { getLanguageModel: vi.fn() },
}))

vi.mock('../../src/main/llm/ai-runtime', () => ({
  generateText: vi.fn(),
}))

async function loadAll(): Promise<void> {
  handlers.clear()
  await import('../../src/main/ipc/harness-handlers')
  const { registerHarnessHandlers } = await import('../../src/main/ipc/harness-handlers')
  registerHarnessHandlers(() => null)
  await import('../../src/preload/index')
}

describe('harness IPC contract', () => {
  beforeEach(() => {
    vi.resetModules()
    handlers.clear()
  })

  it('registers every command channel exactly once', async () => {
    await loadAll()
    for (const channel of Object.values(HARNESS_COMMAND_CHANNELS)) {
      expect(handlers.has(channel), channel).toBe(true)
    }
    expect(Object.keys(HARNESS_EVENT_CHANNELS)).toContain('changed')
  })

  it('preserves structured root failures as Error messages across the history IPC boundary', async () => {
    await loadAll()
    const { harnessNoteService } = await import('../../src/main/harness/service')
    vi.mocked(harnessNoteService.resolveRoot).mockResolvedValue({ ok: false, diagnostics: [{ code: 'NOT_FOUND', message: 'No project notes here' }] })
    const read = handlers.get(HARNESS_COMMAND_CHANNELS.noteChatChanges)!
    await expect(read({}, 'C:/empty', 'conversation')).rejects.toBeInstanceOf(Error)
    await expect(read({}, 'C:/empty', 'conversation')).rejects.toThrow('NOT_FOUND: No project notes here')
    await expect(read({}, 'C:/empty', '')).rejects.toThrow('SCHEMA_INVALID: Invalid conversation id')
  })

  it('preserves history records and real I/O failures without converting them to empty history', async () => {
    await loadAll()
    const { harnessNoteService } = await import('../../src/main/harness/service')
    vi.mocked(harnessNoteService.resolveRoot).mockResolvedValue({ ok: true, root: 'C:/project', diagnostics: [] })
    const read = handlers.get(HARNESS_COMMAND_CHANNELS.noteChatChanges)!
    const records = [{ id: 'change', conversationId: 'conversation' }]
    mocks.changes.mockResolvedValue(records)
    await expect(read({}, 'C:/project', 'conversation')).resolves.toEqual(records)
    expect(mocks.changes).toHaveBeenLastCalledWith('C:/project', 'conversation')
    mocks.changes.mockRejectedValue(new Error('EACCES: history is unreadable'))
    await expect(read({}, 'C:/project', 'conversation')).rejects.toThrow('EACCES: history is unreadable')
  })

  it('exposes the full renderer API through preload', async () => {
    await loadAll()
    for (const method of [
      'resolve',
      'projectGraph',
      'rescan',
      'apply',
      'getBindings',
      'setBinding',
      'sharePreview',
      'shareExport',
      'shareImportPreview',
      'shareImportApply',
      'runPrepare',
      'runStart',
      'runStatus',
      'runList',
      'runCancel',
      'runCloseout',
      'runHandoff',
      'runHandoffRead',
      'runTakeover',
      'runThreads',
      'runThread',
      'runTranscript',
      'runThreadClose',
      'runReview',
      'runFinish',
      'runRepair',
      'undoPreview',
      'undoApply',
      'migratePreview',
      'migrateApply',
      'runExecute',
      'runPause',
      'runResume',
      'runRebaseline',
      'runAbort',
      'onChanged',
    ] as const) {
      expect(typeof harnessApi[method], method).toBe('function')
    }
  })
})
