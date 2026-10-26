import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HARNESS_COMMAND_CHANNELS } from '../../src/shared/ipc/harness'

const mocks = vi.hoisted(() => ({
  configExists: vi.fn(),
  resolveRoot: vi.fn(),
  projectView: vi.fn(),
  prepareTaskRun: vi.fn(),
  startTaskRun: vi.fn(),
  getTaskRun: vi.fn(),
  getTaskRunState: vi.fn(),
  listTaskRunStates: vi.fn(),
  cancelTaskRun: vi.fn(),
  closeoutTaskRun: vi.fn(),
  handoffTaskRun: vi.fn(),
  readTaskHandoff: vi.fn(),
  takeoverTaskRun: vi.fn(),
  listTaskThreads: vi.fn(),
  openTaskThread: vi.fn(),
  closeTaskThread: vi.fn(),
  requestIndependentReview: vi.fn(),
  finishWithLatestReceipt: vi.fn(),
  repairTaskRun: vi.fn(),
  previewUndo: vi.fn(),
  applyUndo: vi.fn(),
  previewMigration: vi.fn(),
  applyMigration: vi.fn(),
  archiveBlueprintSource: vi.fn(),
  loadBlueprint: vi.fn(),
  evictBlueprint: vi.fn(),
  listAudits: vi.fn(),
  pauseTaskRun: vi.fn(),
  resumeTaskRun: vi.fn(),
  rebaselineTaskRun: vi.fn(),
  executeDesktopTask: vi.fn(),
  runDesktopCommand: vi.fn(),
  reviewClaimFromText: vi.fn(),
  buildDesktopReviewPrompt: vi.fn(),
  buildEvaluatorPrompt: vi.fn(),
  createModelReviewPort: vi.fn(),
  ensureTaskThread: vi.fn(),
  setThreadModel: vi.fn(),
  setThreadReviewer: vi.fn(),
  readDesktopConcurrency: vi.fn(),
  readTaskTranscript: vi.fn(),
  getLanguageModel: vi.fn(),
  generateText: vi.fn(),
  previewShareImport: vi.fn(),
  applyShareImport: vi.fn(),
}))

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()

vi.mock('@janus-agent/harness-node', async importOriginal => ({
  ...await importOriginal<typeof import('@janus-agent/harness-node')>(),
  collectTaskSnapshot: vi.fn(async () => ({ ok: true, work: { review: 'self' } })),
}))
vi.mock('../../plugins/blueprint/src/main/notes/note-authoring', () => ({ noteAuthoringContext: vi.fn(async () => ({ schema: 'harness-note/1' })) }))

// Note: tests own config discovery — see .agents/notes/2026-09-20-reproducible-verification.md
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>()
  return {
    ...fs,
    existsSync: (path: Parameters<typeof fs.existsSync>[0]) =>
      String(path).replace(/\\/g, '/').endsWith('/.codex/config.toml')
        ? mocks.configExists()
        : fs.existsSync(path),
  }
})

vi.mock('electron', () => ({
  app: { getPath: () => `${process.env.TEMP ?? process.cwd()}\\janusx-harness-run-${process.pid}` },
  BrowserWindow: { fromWebContents: () => null },
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, fn)
    },
  },
}))

vi.mock('../../src/main/harness/service', () => ({
  harnessNoteService: {
    resolveRoot: mocks.resolveRoot,
    onChange: vi.fn(),
    previewShareImport: mocks.previewShareImport,
    applyShareImport: mocks.applyShareImport,
  },
}))


vi.mock('../../src/main/harness/execution-adapter', () => ({
  prepareTaskRun: mocks.prepareTaskRun,
  startTaskRun: mocks.startTaskRun,
  getTaskRun: mocks.getTaskRun,
  getTaskRunState: mocks.getTaskRunState,
  listTaskRunStates: mocks.listTaskRunStates,
  cancelTaskRun: mocks.cancelTaskRun,
  closeoutTaskRun: mocks.closeoutTaskRun,
  handoffTaskRun: mocks.handoffTaskRun,
  readTaskHandoff: mocks.readTaskHandoff,
  takeoverTaskRun: mocks.takeoverTaskRun,
  listTaskThreads: mocks.listTaskThreads,
  openTaskThread: mocks.openTaskThread,
  closeTaskThread: mocks.closeTaskThread,
  pauseTaskRun: mocks.pauseTaskRun,
  resumeTaskRun: mocks.resumeTaskRun,
  rebaselineTaskRun: mocks.rebaselineTaskRun,
  repairTaskRun: mocks.repairTaskRun,
}))

vi.mock('../../src/main/harness/desktop-executor', () => ({
  executeDesktopTask: mocks.executeDesktopTask,
  runDesktopCommand: mocks.runDesktopCommand,
  reviewClaimFromText: mocks.reviewClaimFromText,
}))

vi.mock('../../src/main/harness/independent-review', () => ({
  requestIndependentReview: mocks.requestIndependentReview,
  finishWithLatestReceipt: mocks.finishWithLatestReceipt,
}))

vi.mock('../../src/main/harness/undo', () => ({
  previewUndo: mocks.previewUndo,
  applyUndo: mocks.applyUndo,
}))

vi.mock('../../src/main/harness/desktop-review', () => ({
  buildDesktopReviewPrompt: mocks.buildDesktopReviewPrompt,
  buildEvaluatorPrompt: mocks.buildEvaluatorPrompt,
  createModelReviewPort: mocks.createModelReviewPort,
}))

vi.mock('../../src/main/harness/task-thread', () => ({
  ensureTaskThread: mocks.ensureTaskThread,
  setThreadModel: mocks.setThreadModel,
  setThreadReviewer: mocks.setThreadReviewer,
  readDesktopConcurrency: mocks.readDesktopConcurrency,
}))

vi.mock('../../src/main/harness/task-transcript', () => ({ readTaskTranscript: mocks.readTaskTranscript }))

vi.mock('../../src/main/llm/LlmService', () => ({
  llmService: { getLanguageModel: mocks.getLanguageModel },
}))

vi.mock('../../src/main/llm/ai-runtime', () => ({
  generateText: mocks.generateText, streamText: vi.fn(),
}))

async function handler(channel: string): Promise<(...args: unknown[]) => Promise<unknown>> {
  if (handlers.size === 0) {
    const { registerHarnessHandlers } = await import('../../src/main/ipc/harness-handlers')
    registerHarnessHandlers(() => null)
  }
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`missing handler ${channel}`)
  return fn
}

const ROOT = 'C:\\checkout'
const TASK_URI = 'note://8fa19f17-c717-43a8-93a7-810a5e0cbc91/11111111-1111-4111-8111-111111111111'
const RUN = {
  schema: 'harness-run/1',
  runId: 'run-1',
  taskUri: TASK_URI,
  mode: 'xdo',
  state: 'queued',
  attempt: 0,
  executor: 'internal',
  lease: null,
  baseline: { taskContractHash: 'a'.repeat(64), inputs: [] },
  repairBudget: { maxAuto: 1, usedAuto: 0 },
  repairs: [],
  receipts: [],
  takeovers: [],
  closeout: 'commit-required',
  createdAt: '2026-09-18T00:00:00.000Z',
  updatedAt: '2026-09-18T00:00:00.000Z',
}

describe('harness run IPC mapping (S8-JanusX surface)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.configExists.mockReturnValue(true)
    mocks.resolveRoot.mockResolvedValue({ ok: true, root: ROOT, diagnostics: [] })
    mocks.readDesktopConcurrency.mockResolvedValue(null)
  })

  it('resolves the checkout before touching runs', async () => {
    mocks.resolveRoot.mockResolvedValueOnce({ ok: false, diagnostics: [{ code: 'NOT_FOUND', message: 'no .agents' }] })
    const prepare = await handler(HARNESS_COMMAND_CHANNELS.runPrepare)
    await expect(prepare({}, 'C:\\elsewhere', { taskUri: TASK_URI, mode: 'xdo', closeout: 'commit-required' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect(mocks.prepareTaskRun).not.toHaveBeenCalled()
    mocks.resolveRoot.mockResolvedValue({ ok: true, root: ROOT, diagnostics: [] })
  })

  it('previews share imports without prose and applies them through', async () => {
    mocks.resolveRoot.mockResolvedValue({ ok: true, root: ROOT, diagnostics: [] })
    const preview = await handler(HARNESS_COMMAND_CHANNELS.shareImportPreview)
    mocks.previewShareImport.mockResolvedValueOnce({
      notes: [
        { kind: 'create', id: 'n1', uri: 'note://r/n1', relPath: '.agents/notes/a.md', afterMarkdown: '# T' },
        { kind: 'invalid', id: 'n2', reason: 'bad prose' },
      ],
      receipts: [{ id: 'rc1', action: 'write' }],
    })
    await expect(preview({}, ROOT, { snapshot: true })).resolves.toEqual({
      notes: [{ id: 'n1', action: 'create' }, { id: 'n2', action: 'invalid', reason: 'bad prose' }],
      receipts: [{ id: 'rc1', action: 'write' }],
    })
    const apply = await handler(HARNESS_COMMAND_CHANNELS.shareImportApply)
    mocks.applyShareImport.mockResolvedValueOnce({
      notes: [{ id: 'n1', action: 'applied' }],
      receipts: [{ id: 'rc1', action: 'applied' }],
    })
    await expect(apply({}, ROOT, { snapshot: true })).resolves.toEqual({
      notes: [{ id: 'n1', action: 'applied' }],
      receipts: [{ id: 'rc1', action: 'applied' }],
    })
  })

  it('prepares runs and surfaces the first diagnostic as the failure', async () => {
    const prepare = await handler(HARNESS_COMMAND_CHANNELS.runPrepare)
    mocks.prepareTaskRun.mockResolvedValueOnce({ ok: true, run: RUN, errors: [], data: { runId: 'run-1' } })
    await expect(
      prepare({}, ROOT, { taskUri: TASK_URI, mode: 'xdo', closeout: 'commit-required' }),
    ).resolves.toMatchObject({ runId: 'run-1', taskUri: TASK_URI, state: 'queued', attempt: 0 })

    mocks.prepareTaskRun.mockResolvedValueOnce({ ok: false, run: null, errors: [{ code: 'NOT_READY', message: 'draft', path: 'lifecycle' }], data: { runId: '' } })
    await expect(
      prepare({}, ROOT, { taskUri: TASK_URI, mode: 'xdo', closeout: 'commit-required' }),
    ).rejects.toMatchObject({ code: 'NOT_READY', path: 'lifecycle' })

    await expect(prepare({}, ROOT, { taskUri: TASK_URI, mode: 'nope', closeout: 'commit-required' })).rejects.toMatchObject({
      code: 'SCHEMA_INVALID',
      path: 'mode',
    })
    expect(mocks.prepareTaskRun).toHaveBeenCalledTimes(2)
  })

  it('starts, reads, lists, cancels, closeouts, and hands off runs', async () => {
    const start = await handler(HARNESS_COMMAND_CHANNELS.runStart)
    mocks.startTaskRun.mockResolvedValueOnce({ ok: true, run: { ...RUN, state: 'running' }, errors: [], data: { attempt: 1 } })
    await expect(start({}, ROOT, 'run-1', 'desktop', { by: 'desktop' })).resolves.toEqual({ attempt: 1 })
    mocks.startTaskRun.mockResolvedValueOnce({ ok: false, run: null, errors: [{ code: 'STALE_BASELINE', message: 'moved' }], data: { attempt: 0 } })
    await expect(start({}, ROOT, 'run-1', 'desktop', { by: 'desktop' })).rejects.toMatchObject({ code: 'STALE_BASELINE' })

    const status = await handler(HARNESS_COMMAND_CHANNELS.runStatus)
    mocks.getTaskRunState.mockResolvedValueOnce({ ...RUN, state: 'running', attempt: 1, receipts: 0 })
    await expect(status({}, ROOT, 'run-1')).resolves.toMatchObject({ runId: 'run-1', state: 'running', receipts: 0 })
    mocks.getTaskRunState.mockRejectedValueOnce({ code: 'IO_ERROR', message: 'gone' })
    await expect(status({}, ROOT, 'run-1')).rejects.toMatchObject({ code: 'IO_ERROR' })

    const list = await handler(HARNESS_COMMAND_CHANNELS.runList)
    mocks.listTaskRunStates.mockResolvedValueOnce([RUN])
    await expect(list({}, ROOT)).resolves.toHaveLength(1)

    const cancel = await handler(HARNESS_COMMAND_CHANNELS.runCancel)
    mocks.getTaskRun.mockResolvedValueOnce({ run: { ...RUN, lease: { token: 'tok', owner: 'desktop', at: 'now' } }, errors: [] })
    mocks.cancelTaskRun.mockResolvedValueOnce({ ok: true, run: { ...RUN, state: 'cancelled' }, errors: [], data: undefined })
    mocks.getTaskRun.mockResolvedValueOnce({ run: { ...RUN, state: 'cancelled' }, errors: [] })
    await expect(cancel({}, ROOT, 'run-1')).resolves.toEqual({ state: 'cancelled' })
    expect(mocks.cancelTaskRun).toHaveBeenCalledWith(ROOT, 'run-1', 'tok')

    const closeout = await handler(HARNESS_COMMAND_CHANNELS.runCloseout)
    mocks.closeoutTaskRun.mockResolvedValueOnce({ ok: true, run: RUN, errors: [], data: { satisfied: false, detail: 'no commit yet' } })
    await expect(closeout({}, ROOT, 'run-1')).resolves.toEqual({ satisfied: false, detail: 'no commit yet' })

    const handoff = await handler(HARNESS_COMMAND_CHANNELS.runHandoff)
    mocks.handoffTaskRun.mockResolvedValueOnce({ ok: true, run: RUN, errors: [], data: { path: 'C:\\handoff.md' } })
    await expect(handoff({}, ROOT, 'run-1')).resolves.toEqual({ path: 'C:\\handoff.md' })
  })

  it('executes through the desktop host without leaking the lease token', async () => {
    const execute = await handler(HARNESS_COMMAND_CHANNELS.runExecute)
    mocks.readDesktopConcurrency.mockResolvedValueOnce(null)
    mocks.getTaskRun.mockResolvedValueOnce({
      run: { ...RUN, state: 'running', attempt: 1, lease: { token: 'tok', owner: 'desktop', at: 'now' } },
      errors: [],
    })
    mocks.ensureTaskThread.mockResolvedValueOnce({ runId: 'run-1', model: undefined, attempts: [] })
    mocks.setThreadModel.mockResolvedValueOnce({ runId: 'run-1', attempts: [] })
    mocks.createModelReviewPort.mockReturnValueOnce(async () => ({ verdict: 'approved', coverage: [] }))
    mocks.executeDesktopTask.mockImplementationOnce(async (_root: string, runId: string, token: string, ports: unknown) => {
      expect(runId).toBe('run-1')
      expect(token).toBe('tok')
      expect(ports).toMatchObject({ implement: expect.any(Function), command: expect.any(Function), review: expect.any(Function) })
      return { ok: true, run: { ...RUN, state: 'done' }, errors: [], data: { receiptId: 'r-1', completed: true, checks: [] } }
    })
    await expect(execute({}, ROOT, { runId: 'run-1', providerId: 'p', modelId: 'm' })).resolves.toMatchObject({
      receiptId: 'r-1',
      completed: true,
    })
    expect(mocks.setThreadModel).toHaveBeenCalledWith(ROOT, 'run-1', { providerId: 'p', modelId: 'm' })

    mocks.readDesktopConcurrency.mockResolvedValueOnce(null)
    mocks.getTaskRun.mockResolvedValueOnce({
      run: { ...RUN, state: 'running', attempt: 1, lease: { token: 'tok', owner: 'desktop', at: 'now' } },
      errors: [],
    })
    mocks.ensureTaskThread.mockResolvedValueOnce({ runId: 'run-1', model: { providerId: 'tp', modelId: 'tm' }, attempts: [{ attempt: 1 }] })
    mocks.setThreadModel.mockClear()
    mocks.executeDesktopTask.mockResolvedValueOnce({ ok: true, run: { ...RUN, state: 'done' }, errors: [], data: { receiptId: 'r-2', completed: true, checks: [] } })
    await expect(execute({}, ROOT, { runId: 'run-1' })).resolves.toMatchObject({ receiptId: 'r-2' })
    expect(mocks.setThreadModel).not.toHaveBeenCalled()

    mocks.getTaskRun.mockResolvedValueOnce({ run: null, errors: [{ code: 'NOT_FOUND', message: 'gone' }] })
    await expect(execute({}, ROOT, { runId: 'run-1' })).rejects.toMatchObject({ code: 'NOT_FOUND' })

    mocks.getTaskRun.mockResolvedValueOnce({ run: { ...RUN, lease: null }, errors: [] })
    await expect(execute({}, ROOT, { runId: 'run-1' })).rejects.toMatchObject({ code: 'BUSY' })

    await expect(execute({}, ROOT, { runId: '' })).rejects.toMatchObject({ code: 'SCHEMA_INVALID', path: 'runId' })
  })

  it('restores xflow reviewer identity and model separately from the implementor', async () => {
    const execute = await handler(HARNESS_COMMAND_CHANNELS.runExecute)
    mocks.readDesktopConcurrency.mockResolvedValue(null)
    mocks.getTaskRun.mockResolvedValue({ run: { ...RUN, mode: 'xflow', state: 'running', attempt: 1, lease: { owner: 'desktop', token: 'tok' } }, errors: [] })
    const thread = { model: { providerId: 'p', modelId: 'm' }, reviewerModel: { providerId: 'review-p', modelId: 'review-m' }, reviewer: 'auditor', attempts: [] }
    mocks.ensureTaskThread.mockResolvedValueOnce(thread)
    mocks.setThreadReviewer.mockResolvedValueOnce(thread)
    mocks.createModelReviewPort.mockReset().mockImplementation((_uri, _attempt, deps, builder) => {
      expect(deps).toMatchObject(thread.reviewerModel)
      expect(builder).toBe(mocks.buildEvaluatorPrompt)
      return async () => ({ verdict: 'approved', coverage: [] })
    })
    mocks.executeDesktopTask.mockImplementationOnce(async (_root, _runId, _token, ports, opts) => {
      expect(opts.reviewer).toBe('auditor')
      await ports.independentReview({})
      return { ok: true, run: RUN, errors: [], data: { receiptId: 'independent', completed: true, checks: [] } }
    })
    await expect(execute({}, ROOT, { runId: 'run-1' })).resolves.toMatchObject({ receiptId: 'independent' })
    expect(mocks.setThreadReviewer).toHaveBeenCalledWith(ROOT, 'run-1', thread.reviewerModel, 'auditor')
  })

  it('refuses executions past the desktop concurrency budget', async () => {
    const execute = await handler(HARNESS_COMMAND_CHANNELS.runExecute)
    mocks.readDesktopConcurrency.mockResolvedValue({ maxThreads: 1 })
    mocks.getTaskRun.mockResolvedValue({
      run: { ...RUN, state: 'running', attempt: 1, lease: { token: 'tok', owner: 'desktop', at: 'now' } },
      errors: [],
    })
    mocks.ensureTaskThread.mockResolvedValue({ runId: 'run-1', model: { providerId: 'p', modelId: 'm' }, attempts: [] })
    let entered!: () => void
    const enteredGate = new Promise<void>((resolve) => { entered = resolve })
    let release!: (value: unknown) => void
    mocks.executeDesktopTask.mockImplementationOnce(
      () => new Promise((resolve) => { entered(); release = resolve as (value: unknown) => void }),
    )
    const first = execute({}, ROOT, { runId: 'run-1' })
    await enteredGate
    try {
      await expect(execute({}, ROOT, { runId: 'run-2' })).rejects.toMatchObject({ code: 'BUSY', message: expect.stringContaining('budget') })
    } finally {
      release({ ok: true, run: { ...RUN, state: 'done' }, errors: [], data: { receiptId: 'r-9', completed: true, checks: [] } })
      await expect(first).resolves.toMatchObject({ receiptId: 'r-9' })
    }
  })

  it('executes without a personal config on a clean checkout', async () => {
    mocks.configExists.mockReturnValue(false)
    mocks.getTaskRun.mockResolvedValue({
      run: { ...RUN, state: 'running', lease: { token: 'tok', owner: 'desktop' } }, errors: [],
    })
    mocks.ensureTaskThread.mockResolvedValue({ runId: 'run-1', model: { providerId: 'p', modelId: 'm' }, attempts: [] })
    mocks.executeDesktopTask.mockResolvedValue({ ok: true, run: RUN, errors: [], data: { receiptId: 'clean', completed: true, checks: [] } })
    const execute = await handler(HARNESS_COMMAND_CHANNELS.runExecute)
    await expect(execute({}, ROOT, { runId: 'run-1' })).resolves.toMatchObject({ receiptId: 'clean' })
    expect(mocks.readDesktopConcurrency).not.toHaveBeenCalled()
  })

  it('reserves a run before asynchronous preparation and releases a failed reservation', async () => {
    const execute = await handler(HARNESS_COMMAND_CHANNELS.runExecute)
    mocks.readDesktopConcurrency.mockResolvedValue(null)
    let entered!: () => void
    const enteredGate = new Promise<void>((resolve) => { entered = resolve })
    let release!: (value: unknown) => void
    mocks.getTaskRun.mockImplementationOnce(() => new Promise((resolve) => { entered(); release = resolve }))
    const first = execute({}, ROOT, { runId: 'run-1' })
    const outcome = first.then(() => null, (error: unknown) => error)
    await enteredGate
    const transcript = await handler(HARNESS_COMMAND_CHANNELS.runTranscript)
    mocks.readTaskTranscript.mockResolvedValue({ runId: 'run-1', active: false, turns: [] })
    try {
      await expect(execute({}, ROOT, { runId: 'run-1' })).rejects.toMatchObject({ code: 'BUSY' })
      await expect(transcript({}, ROOT, 'run-1')).resolves.toMatchObject({ active: true, turns: [] })
      mocks.resolveRoot.mockResolvedValueOnce({ ok: true, root: 'C:\\another-checkout', diagnostics: [] })
      await expect(transcript({}, 'C:\\another-checkout', 'run-1')).resolves.toMatchObject({ active: false })
    } finally {
      release({ run: null, errors: [{ code: 'UNSUPPORTED_SCHEMA', message: 'profile mismatch' }] })
      expect(await outcome).toMatchObject({ code: 'UNSUPPORTED_SCHEMA' })
    }
    await expect(transcript({}, ROOT, 'run-1')).resolves.toMatchObject({ active: false })
    mocks.readTaskTranscript.mockRejectedValueOnce(Object.assign(new Error('invalid history'), { code: 'RECOVERY_REQUIRED' }))
    await expect(transcript({}, ROOT, 'run-1')).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' })
    mocks.getTaskRun.mockResolvedValueOnce({ run: null, errors: [{ code: 'NOT_FOUND', message: 'missing' }] })
    await expect(execute({}, ROOT, { runId: 'run-1' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('pauses, resumes, rebaselines, and refuses stray aborts', async () => {
    const pause = await handler(HARNESS_COMMAND_CHANNELS.runPause)
    mocks.getTaskRun.mockResolvedValueOnce({ run: { ...RUN, lease: { token: 'tok', owner: 'desktop', at: 'now' } }, errors: [] })
    mocks.pauseTaskRun.mockResolvedValueOnce({ ok: true, run: { ...RUN, state: 'paused' }, errors: [], data: undefined })
    mocks.getTaskRun.mockResolvedValueOnce({ run: { ...RUN, state: 'paused' }, errors: [] })
    await expect(pause({}, ROOT, 'run-1')).resolves.toEqual({ state: 'paused' })
    expect(mocks.pauseTaskRun).toHaveBeenCalledWith(ROOT, 'run-1', 'tok')

    const resume = await handler(HARNESS_COMMAND_CHANNELS.runResume)
    mocks.getTaskRun.mockResolvedValueOnce({ run: { ...RUN, state: 'paused', lease: { token: 'tok', owner: 'desktop', at: 'now' } }, errors: [] })
    mocks.resumeTaskRun.mockResolvedValueOnce({ ok: true, run: { ...RUN, state: 'running' }, errors: [], data: { state: 'running' } })
    mocks.getTaskRun.mockResolvedValueOnce({ run: { ...RUN, state: 'running' }, errors: [] })
    await expect(resume({}, ROOT, 'run-1')).resolves.toEqual({ state: 'running' })

    const rebaseline = await handler(HARNESS_COMMAND_CHANNELS.runRebaseline)
    mocks.getTaskRun.mockResolvedValueOnce({ run: { ...RUN, state: 'paused', taskUri: TASK_URI, lease: { token: 'tok', owner: 'desktop', at: 'now' } }, errors: [] })
    mocks.rebaselineTaskRun.mockResolvedValueOnce({ ok: true, run: { ...RUN, state: 'queued' }, errors: [], data: undefined })
    mocks.getTaskRun.mockResolvedValueOnce({ run: { ...RUN, state: 'queued' }, errors: [] })
    await expect(rebaseline({}, ROOT, 'run-1', { by: 'desktop' })).resolves.toEqual({ state: 'queued' })
    expect(mocks.rebaselineTaskRun).toHaveBeenCalledWith(ROOT, 'run-1', 'tok', TASK_URI, { by: 'desktop' })

    const abort = await handler(HARNESS_COMMAND_CHANNELS.runAbort)
    await expect(abort({}, ROOT, 'run-1')).rejects.toMatchObject({ code: 'NOT_READY' })
  })

  it('reads handoffs and takes over runs with an explicit reason', async () => {
    const read = await handler(HARNESS_COMMAND_CHANNELS.runHandoffRead)
    mocks.readTaskHandoff.mockResolvedValueOnce({ ok: true, run: RUN, errors: [], data: { path: 'C:\\handoff.md', markdown: '# Harness run handoff' } })
    await expect(read({}, ROOT, 'run-1')).resolves.toEqual({ path: 'C:\\handoff.md', markdown: '# Harness run handoff' })
    mocks.readTaskHandoff.mockResolvedValueOnce({ ok: false, run: RUN, errors: [{ code: 'NOT_FOUND', message: 'missing' }], data: { path: '', markdown: '' } })
    await expect(read({}, ROOT, 'run-1')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(read({}, ROOT, '')).rejects.toMatchObject({ code: 'SCHEMA_INVALID', path: 'runId' })

    const takeover = await handler(HARNESS_COMMAND_CHANNELS.runTakeover)
    mocks.takeoverTaskRun.mockResolvedValueOnce({ ok: true, run: { ...RUN, state: 'running' }, errors: [], data: { token: 'tok-2' } })
    mocks.getTaskRun.mockResolvedValueOnce({ run: { ...RUN, state: 'running' }, errors: [] })
    await expect(takeover({}, ROOT, 'run-1', 'terminal', 'CLI takes over')).resolves.toEqual({ state: 'running' })
    expect(mocks.takeoverTaskRun).toHaveBeenCalledWith(ROOT, 'run-1', 'terminal', 'CLI takes over')
    await expect(takeover({}, ROOT, 'run-1', 'terminal', '  ')).rejects.toMatchObject({ code: 'SCHEMA_INVALID', path: 'reason' })
    await expect(takeover({}, ROOT, 'run-1', '  ', 'reason')).rejects.toMatchObject({ code: 'SCHEMA_INVALID', path: 'newOwner' })
  })

  it('lists threads, opens them for activation, and closes only on decision', async () => {
    const threads = await handler(HARNESS_COMMAND_CHANNELS.runThreads)
    mocks.listTaskThreads.mockResolvedValueOnce({ threads: [{ runId: 'run-1' }], errors: [] })
    await expect(threads({}, ROOT)).resolves.toEqual([{ runId: 'run-1' }])

    const thread = await handler(HARNESS_COMMAND_CHANNELS.runThread)
    mocks.openTaskThread.mockResolvedValueOnce({ ok: true, run: RUN, errors: [], data: { runId: 'run-1', history: [] } })
    await expect(thread({}, ROOT, 'run-1')).resolves.toEqual({ runId: 'run-1', history: [] })
    mocks.openTaskThread.mockResolvedValueOnce({ ok: false, run: null, errors: [{ code: 'NOT_FOUND', message: 'gone' }], data: null })
    await expect(thread({}, ROOT, 'run-9')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(thread({}, ROOT, '')).rejects.toMatchObject({ code: 'SCHEMA_INVALID', path: 'runId' })

    const close = await handler(HARNESS_COMMAND_CHANNELS.runThreadClose)
    mocks.closeTaskThread.mockResolvedValueOnce({ ok: true, run: RUN, errors: [], data: { closed: true } })
    await expect(close({}, ROOT, 'run-1')).resolves.toEqual({ closed: true })
    mocks.closeTaskThread.mockResolvedValueOnce({ ok: false, run: RUN, errors: [{ code: 'BUSY', message: 'owned' }], data: { closed: false } })
    await expect(close({}, ROOT, 'run-1')).rejects.toMatchObject({ code: 'BUSY' })
  })

  it('redirects legacy conversion to the installed plugin before reading data', async () => {
    for (const channel of [HARNESS_COMMAND_CHANNELS.migratePreview, HARNESS_COMMAND_CHANNELS.migrateApply]) {
      const call = await handler(channel)
      await expect(call({}, ROOT, 'bp-1')).rejects.toThrow('BLUEPRINT_PLUGIN_REQUIRED')
    }
    expect(mocks.loadBlueprint).not.toHaveBeenCalled()
    expect(mocks.applyMigration).not.toHaveBeenCalled()
  })

  it('reviews independently, finishes on the latest receipt, and repairs explicitly', async () => {
    const review = await handler(HARNESS_COMMAND_CHANNELS.runReview)
    mocks.getTaskRun.mockResolvedValue({
      run: { ...RUN, state: 'verifying', attempt: 1, lease: { token: 'tok', owner: 'desktop', at: 'now' } },
      errors: [],
    })
    mocks.createModelReviewPort.mockReturnValueOnce(async () => ({ verdict: 'needs-fix', coverage: [] }))
    mocks.requestIndependentReview.mockImplementationOnce(async (_root: string, runId: string, token: string, ports: unknown, opts: unknown) => {
      expect(runId).toBe('run-1')
      expect(token).toBe('tok')
      expect(opts).toMatchObject({ reviewer: 'evaluator' })
      expect(ports).toMatchObject({ review: expect.any(Function) })
      return { ok: true, run: RUN, errors: [], data: { receiptId: 'r-ind', verdict: 'needs-fix' } }
    })
    await expect(review({}, ROOT, { runId: 'run-1', reviewer: 'evaluator', providerId: 'p', modelId: 'm' })).resolves.toEqual({
      receiptId: 'r-ind',
      verdict: 'needs-fix',
    })
    await expect(review({}, ROOT, { runId: 'run-1', reviewer: '  ' })).rejects.toMatchObject({ code: 'SCHEMA_INVALID', path: 'reviewer' })
    await expect(review({}, ROOT, { runId: '' , reviewer: 'evaluator' })).rejects.toMatchObject({ code: 'SCHEMA_INVALID', path: 'runId' })

    const finish = await handler(HARNESS_COMMAND_CHANNELS.runFinish)
    mocks.getTaskRun.mockResolvedValueOnce({
      run: { ...RUN, state: 'verifying', lease: { token: 'tok', owner: 'desktop', at: 'now' } },
      errors: [],
    })
    mocks.finishWithLatestReceipt.mockResolvedValueOnce({ ok: true, run: { ...RUN, state: 'done' }, errors: [], data: { receiptId: 'r-ind', completed: true } })
    await expect(finish({}, ROOT, 'run-1')).resolves.toEqual({ receiptId: 'r-ind', completed: true })
    mocks.finishWithLatestReceipt.mockResolvedValueOnce({ ok: false, run: RUN, errors: [{ code: 'NOT_READY', message: 'empty' }], data: { receiptId: 'r-ind', completed: false } })
    await expect(finish({}, ROOT, 'run-1')).rejects.toMatchObject({ code: 'NOT_READY' })

    const repair = await handler(HARNESS_COMMAND_CHANNELS.runRepair)
    mocks.getTaskRun.mockResolvedValueOnce({
      run: { ...RUN, state: 'verifying', receipts: ['r-ind'], lease: { token: 'tok', owner: 'desktop', at: 'now' } },
      errors: [],
    })
    mocks.repairTaskRun.mockResolvedValueOnce({ ok: true, run: { ...RUN, state: 'running', attempt: 2 }, errors: [], data: { attempt: 2 } })
    mocks.getTaskRun.mockResolvedValueOnce({ run: { ...RUN, state: 'running', attempt: 2 }, errors: [] })
    await expect(repair({}, ROOT, { runId: 'run-1', summary: 'Flaky check.' })).resolves.toEqual({ attempt: 2, state: 'running' })
    expect(mocks.repairTaskRun).toHaveBeenCalledWith(ROOT, 'run-1', 'tok', { failureReceiptId: 'r-ind', summary: 'Flaky check.', auto: false, authorization: { by: 'desktop' } })
    await expect(repair({}, ROOT, { runId: 'run-1', summary: '  ' })).rejects.toMatchObject({ code: 'SCHEMA_INVALID', path: 'summary' })
  })

  it('previews managed writes and applies undo as a new write', async () => {
    const preview = await handler(HARNESS_COMMAND_CHANNELS.undoPreview)
    mocks.previewUndo.mockResolvedValueOnce({ preview: { txId: 'tx-1', reversible: true, files: [] }, errors: [] })
    await expect(preview({}, ROOT)).resolves.toMatchObject({ txId: 'tx-1', reversible: true })
    mocks.previewUndo.mockResolvedValueOnce({ preview: null, errors: [{ code: 'NOT_FOUND', message: 'empty' }] })
    await expect(preview({}, ROOT)).rejects.toMatchObject({ code: 'NOT_FOUND' })

    const apply = await handler(HARNESS_COMMAND_CHANNELS.undoApply)
    mocks.applyUndo.mockResolvedValueOnce({ txId: 'tx-2', reverted: ['a.md'], errors: [] })
    await expect(apply({}, ROOT)).resolves.toEqual({ txId: 'tx-2', reverted: ['a.md'] })
    mocks.applyUndo.mockResolvedValueOnce({ txId: '', reverted: [], errors: [{ code: 'CONFLICT', message: 'moved' }] })
    await expect(apply({}, ROOT, 'tx-1')).rejects.toMatchObject({ code: 'CONFLICT' })
  })
})
