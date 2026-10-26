/**
 * @file Harness IPC Handlers (S4)
 * @description Project-note resolve/graph/apply/bind/share channels over the
 *  single HarnessNoteService. Failures cross IPC as plain HarnessFailure
 *  data; the renderer matches `code`, never Error identity.
 */
import { registerHarnessDocumentHandlers } from '../harness/document-handlers'
import { registerRemoteHarnessHandler } from '../workspace/remote-harness'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { collectTaskSnapshot } from '@janus-agent/harness-node'
import { taskExecutionPolicy } from '@janus-agent/harness-core'
import { harnessNoteService } from '../harness/service'
import { blueprintNoteView } from '../blueprint/note-service'
import { listNoteChatChanges } from '../harness/note-chat'
import { applyMigration, archiveBlueprintSource, previewMigration } from '../janus/blueprint-migrate'
import { blueprintStore } from '../janus/blueprint-store'
import { GLOBAL_BLUEPRINT_SCOPE } from '../janus/blueprint-paths'
import { readMaintenanceAudits } from '../../../plugins/blueprint/src/main/janus/maintenance/audit-records'
import { buildEvaluatorPrompt, createModelReviewPort } from '../harness/desktop-review'
import { executeDesktopTask, runDesktopCommand } from '../harness/desktop-executor'
import { createDesktopImplementationPort, generateDesktopReviewText } from '../harness/desktop-task-turn'
import { readTaskTranscript } from '../harness/task-transcript'
import { configService, DEFAULT_AGENT_MAX_STEPS } from '../config/service'
import type { ChatTurnPorts } from '@janus-agent/janus-agent'
import { finishWithLatestReceipt, requestIndependentReview } from '../harness/independent-review'
import { ensureTaskThread, readDesktopConcurrency, setThreadModel, setThreadReviewer } from '../harness/task-thread'
import { llmService } from '../llm/LlmService'
import { streamText } from '../llm/ai-runtime'
import {
  cancelTaskRun,
  closeoutTaskRun,
  closeTaskThread,
  getTaskRun,
  getTaskRunState,
  handoffTaskRun,
  listTaskRunStates,
  listTaskThreads,
  openTaskThread,
  pauseTaskRun,
  prepareTaskRun,
  readTaskHandoff,
  rebaselineTaskRun,
  repairTaskRun,
  resumeTaskRun,
  startTaskRun,
  takeoverTaskRun,
} from '../harness/execution-adapter'
import {
  HARNESS_COMMAND_CHANNELS,
  HARNESS_EVENT_CHANNELS,
  type HarnessFailure,
  type HarnessRunCloseoutResult,
  type HarnessRunExecuteInput,
  type HarnessRunExecuteResult,
  type HarnessRunPrepared,
  type HarnessRunPrepareInput,
  type HarnessRunRepairInput,
  type HarnessRunReviewInput,
  type HarnessRunReviewResult,
  type HarnessRunState,
  type HarnessMigrationPreview,
  type HarnessMigrationResult,
} from '../../shared/ipc/harness'

const throwFailure = (code: HarnessFailure['code'], message: string, extra?: Partial<HarnessFailure>): never => {
  throw { code, message, ...extra } satisfies HarnessFailure
}

const RUN_FAILURE_CODES: ReadonlySet<string> = new Set([
  'NOT_FOUND',
  'SCHEMA_INVALID',
  'UNSUPPORTED_SCHEMA',
  'CONFLICT',
  'NOT_READY',
  'STALE_BASELINE',
  'DEPENDENCY_UNSATISFIED',
  'APPROVAL_REQUIRED',
  'PERMISSION_DENIED',
  'BUSY',
  'RECOVERY_REQUIRED',
  'INVALID_RELATION',
  'UNRESOLVED_REFERENCE',
  'CAPABILITY_UNAVAILABLE',
  'IO_ERROR',
])

/** First dispatcher diagnostic becomes the IPC failure; codes stay in the shared envelope. */
function throwRunFailure(errors: Array<{ code: string; message: string; path?: string }>): never {
  const first = errors[0]
  const code = (first && RUN_FAILURE_CODES.has(first.code) ? first.code : 'SCHEMA_INVALID') as HarnessFailure['code']
  throw { code, message: first?.message ?? 'run operation failed', ...(first?.path ? { path: first.path } : {}) } satisfies HarnessFailure
}

async function withRoot(cwd: string): Promise<string> {
  const resolved = await harnessNoteService.resolveRoot(cwd)
  if (!resolved.ok || !resolved.root) {
    throwFailure('NOT_FOUND', resolved.diagnostics[0]?.message ?? `no project notes under ${cwd}`)
  }
  return resolved.root as string
}

export function registerHarnessHandlers(getWindow: () => BrowserWindow | null): void {
  const handle = registerRemoteHarnessHandler(ipcMain, getWindow)
  registerHarnessDocumentHandlers(handle)
  harnessNoteService.onChange(event => {
    getWindow()?.webContents.send(HARNESS_EVENT_CHANNELS.changed, { root: event.root, rev: event.rev,
      kinds: [...new Set(event.events.map(e => e.type))], external: event.external, error: event.error })
  })
  // ── task runs (S8-JanusX): adapter OpResults cross IPC as data or coded failure ──

  handle(
    HARNESS_COMMAND_CHANNELS.runPrepare,
    async (_e, cwd: string, input: HarnessRunPrepareInput): Promise<HarnessRunPrepared> => {
      const root = await withRoot(cwd)
      if (!input || typeof input.taskUri !== 'string' || !input.taskUri) {
        throwFailure('SCHEMA_INVALID', 'run prepare needs a task URI', { path: 'taskUri' })
      }
      if (!['xdo', 'xdel', 'xflow'].includes(input.mode)) {
        throwFailure('SCHEMA_INVALID', `bad run mode: ${String(input.mode)}`, { path: 'mode' })
      }
      if (input.closeout !== 'commit-required' && input.closeout !== 'working-tree-authorized') {
        throwFailure('SCHEMA_INVALID', `bad closeout: ${String(input.closeout)}`, { path: 'closeout' })
      }
      const prepared = await prepareTaskRun(root, {
        taskRef: input.taskUri,
        mode: input.mode,
        closeout: input.closeout,
        ...(input.authorizationRef ? { authorizationRef: input.authorizationRef } : {}),
        ...(input.maxAutoRepairs !== undefined ? { maxAutoRepairs: input.maxAutoRepairs } : {}),
        ...(input.executor ? { executor: input.executor } : {}),
      })
      if (!prepared.ok || !prepared.run) throwRunFailure(prepared.errors)
      return {
        runId: prepared.data.runId,
        taskUri: prepared.run.taskUri,
        state: prepared.run.state,
        attempt: prepared.run.attempt,
      }
    },
  )

  handle(
    HARNESS_COMMAND_CHANNELS.runStart,
    async (
      _e,
      cwd: string,
      runId: string,
      owner: string,
      authorization: { by: string; ref?: string } | null,
    ): Promise<{ attempt: number }> => {
      const root = await withRoot(cwd)
      if (typeof runId !== 'string' || !runId) throwFailure('SCHEMA_INVALID', 'run start needs a run id', { path: 'runId' })
      if (typeof owner !== 'string' || !owner) throwFailure('SCHEMA_INVALID', 'run start needs an owner', { path: 'owner' })
      const started = await startTaskRun(root, runId, owner, authorization ?? null)
      if (!started.ok) throwRunFailure(started.errors)
      return started.data
    },
  )

  handle(
    HARNESS_COMMAND_CHANNELS.runStatus,
    async (_e, cwd: string, runId: string): Promise<HarnessRunState> => {
      const root = await withRoot(cwd)
      if (typeof runId !== 'string' || !runId) throwFailure('SCHEMA_INVALID', 'run status needs a run id', { path: 'runId' })
      return getTaskRunState(root, runId)
    },
  )

  handle(
    HARNESS_COMMAND_CHANNELS.runList,
    async (_e, cwd: string): Promise<HarnessRunState[]> => {
      const root = await withRoot(cwd)
      return listTaskRunStates(root)
    },
  )

  handle(
    HARNESS_COMMAND_CHANNELS.runCancel,
    async (_e, cwd: string, runId: string): Promise<{ state: string }> => {
      const root = await withRoot(cwd)
      if (typeof runId !== 'string' || !runId) throwFailure('SCHEMA_INVALID', 'run cancel needs a run id', { path: 'runId' })
      // Renderer-driven cancel carries no lease token: the adapter maps a
      // null token onto an explicit takeover-free cancel path owned here.
      const lease = await getTaskRun(root, runId)
      if (!lease.run) throwRunFailure(lease.errors)
      const cancelled = await cancelTaskRun(root, runId, lease.run?.lease?.token ?? null)
      if (!cancelled.ok) throwRunFailure(cancelled.errors)
      const after = await getTaskRun(root, runId)
      return { state: after.run?.state ?? 'cancelled' }
    },
  )

  handle(
    HARNESS_COMMAND_CHANNELS.runCloseout,
    async (_e, cwd: string, runId: string): Promise<HarnessRunCloseoutResult> => {
      const root = await withRoot(cwd)
      if (typeof runId !== 'string' || !runId) throwFailure('SCHEMA_INVALID', 'run closeout needs a run id', { path: 'runId' })
      const report = await closeoutTaskRun(root, runId, { repoRoot: root })
      if (!report.ok) throwRunFailure(report.errors)
      return report.data
    },
  )

  handle(
    HARNESS_COMMAND_CHANNELS.runHandoff,
    async (_e, cwd: string, runId: string): Promise<{ path: string }> => {
      const root = await withRoot(cwd)
      if (typeof runId !== 'string' || !runId) throwFailure('SCHEMA_INVALID', 'run handoff needs a run id', { path: 'runId' })
      const handoff = await handoffTaskRun(root, runId)
      if (!handoff.ok) throwRunFailure(handoff.errors)
      return handoff.data
    },
  )

  // ── desktop xdo host (S8-JanusX): checks plus self-review in the main process ──
  // Lease tokens never cross IPC; the renderer passes intent and evidence only.

  const inFlight = new Map<string, AbortController>()
  const executionKey = (root: string, runId: string) => JSON.stringify([process.platform === 'win32' ? root.toLowerCase() : root, runId])

  handle(HARNESS_COMMAND_CHANNELS.runTranscript, async (_e, cwd: string, runId: string) => {
    const root = await withRoot(cwd)
    try {
      const transcript = await readTaskTranscript(root, runId)
      return { ...transcript, active: transcript.active || inFlight.has(executionKey(root, runId)) }
    } catch (error) {
      const failure = error as { code?: HarnessFailure['code']; message?: string }
      const code = failure.code ?? 'IO_ERROR'
      // Electron serializes Error.message; thrown records become "[object Object]".
      throw Object.assign(new Error(`${code}: ${failure.message ?? 'Cannot read implementation history'}`), { code })
    }
  })

  async function runStateOf(root: string, runId: string): Promise<{ state: string }> {
    const loaded = await getTaskRun(root, runId)
    if (!loaded.run) throwRunFailure(loaded.errors)
    return { state: loaded.run?.state ?? 'unknown' }
  }

  /** First config dir wins; null means the desktop runs unguarded and says so. */
  function desktopConfigRoot(): string | null {
    const candidates: string[] = []
    try {
      candidates.push(app.getAppPath())
    } catch {
      // Packaged shells without app paths fall through to the working copy.
    }
    candidates.push(process.cwd())
    for (const candidate of candidates) {
      try {
        if (existsSync(join(candidate, '.codex', 'config.toml'))) return candidate
      } catch {
        // Unreadable candidates never block execution.
      }
    }
    return null
  }

  handle(
    HARNESS_COMMAND_CHANNELS.runExecute,
    async (_e, cwd: string, input: HarnessRunExecuteInput): Promise<HarnessRunExecuteResult> => {
      const root = await withRoot(cwd)
      const runId = input?.runId
      if (typeof runId !== 'string' || !runId) throwFailure('SCHEMA_INVALID', 'run execute needs a run id', { path: 'runId' })
      if (inFlight.has(executionKey(root, runId))) throwFailure('BUSY', 'this run already has an in-flight execution; abort it first', { path: 'runId' })
      const configRoot = desktopConfigRoot()
      const budget = configRoot ? await readDesktopConcurrency(configRoot) : null
      if (budget && inFlight.size >= budget.maxThreads) {
        throwFailure('BUSY', `desktop concurrency budget spent (${inFlight.size}/${budget.maxThreads}); wait for or abort a running execution`, { path: 'runId' })
      }
      if (inFlight.has(executionKey(root, runId))) throwFailure('BUSY', 'this run already has an in-flight execution', { path: 'runId' })
      const controller = new AbortController()
      inFlight.set(executionKey(root, runId), controller)
      try {
        const loaded = await getTaskRun(root, runId)
        if (!loaded.run) throwRunFailure(loaded.errors)
        const leaseToken = loaded.run?.lease?.token
        if (!leaseToken) throwFailure('BUSY', 'run has no owner lease; start it before executing', { path: 'runId' })
        const token = leaseToken as string
        const taskUri = loaded.run?.taskUri as string
        // The thread outlives every turn: recovery reuses the stored model
        // endpoint, and repairs reattach to the same history.
        const threadError = (error: unknown): never => throwRunFailure([{ code: 'IO_ERROR', message: error instanceof Error ? error.message : String(error) }])
        let thread = await ensureTaskThread(root, { runId, taskUri, mode: loaded.run?.mode ?? 'xdo' }).catch(threadError)
        const providerId = input?.providerId?.trim() || thread.model?.providerId
        const modelId = input?.modelId?.trim() || thread.model?.modelId
        if (input?.providerId?.trim() && input?.modelId?.trim()) {
          thread = await setThreadModel(root, runId, { providerId: input.providerId.trim(), modelId: input.modelId.trim() }).catch(threadError)
        }
        const reviewerProviderId = input?.reviewerProviderId?.trim() || thread.reviewerModel?.providerId || providerId
        const reviewerModelId = input?.reviewerModelId?.trim() || thread.reviewerModel?.modelId || modelId
        const reviewer = input?.reviewer?.trim() || thread.reviewer
        const contract = await collectTaskSnapshot(root, taskUri)
        if (!contract.ok) throwRunFailure(contract.errors)
        const policy = taskExecutionPolicy(loaded.run!.mode, loaded.run!.lease?.owner ?? 'desktop', runId, contract.work.review)
        if (policy.independent && reviewerProviderId && reviewerModelId) {
          thread = await setThreadReviewer(root, runId, { providerId: reviewerProviderId, modelId: reviewerModelId }, reviewer).catch(threadError)
        }
        const maxTurns = await configService.getAgentMaxSteps().catch(() => DEFAULT_AGENT_MAX_STEPS)
        const reviewPort = (kind: 'self' | 'independent') => async (evidence: Parameters<ReturnType<typeof createModelReviewPort>>[0], signal?: AbortSignal) => {
          const provider = kind === 'independent' ? reviewerProviderId : providerId
          const model = kind === 'independent' ? reviewerModelId : modelId
          return createModelReviewPort(taskUri, (await getTaskRun(root, runId)).run?.attempt ?? 0, {
            providerId: provider, modelId: model,
            getModel: (provider, model) => llmService.getLanguageModel('janus', provider, model),
            generateReviewText: (_model, prompt, signal) => generateDesktopReviewText(root, runId, token, kind, {
              providerId: provider ?? '', modelId: model ?? '', maxTurns,
              getModel: (provider, model) => llmService.getLanguageModel('janus', provider, model),
              streamTextFn: streamText as unknown as ChatTurnPorts['streamTextFn'],
            }, prompt, signal),
          }, kind === 'independent' ? buildEvaluatorPrompt : undefined)(evidence, signal)
        }
        const timeoutMs = input?.timeoutMs === undefined ? undefined : Math.min(600_000, Math.max(5_000, Math.floor(input.timeoutMs)))
        const manualEvidence = Array.isArray(input?.manualEvidence) ? input.manualEvidence : []
        for (const item of manualEvidence) {
          if (!item || typeof item.stepId !== 'string' || typeof item.observer !== 'string' || typeof item.observation !== 'string') {
            throwFailure('SCHEMA_INVALID', 'manual evidence needs stepId, observer, and observation', { path: 'manualEvidence' })
          }
        }
        const executed = await executeDesktopTask(root, runId, token, {
          implement: createDesktopImplementationPort({
            providerId: providerId ?? '', modelId: modelId ?? '',
            getModel: (provider, model) => llmService.getLanguageModel('janus', provider, model),
            streamTextFn: streamText as unknown as ChatTurnPorts['streamTextFn'],
            maxTurns,
          }),
          command: (step, signal) => runDesktopCommand(root, step, { ...(timeoutMs === undefined ? {} : { timeoutMs }), signal }),
          review: reviewPort('self'),
          ...(policy.independent ? { independentReview: reviewPort('independent') } : {}),
        }, { manualEvidence, reviewer, ...(timeoutMs === undefined ? {} : { timeoutMs }), signal: controller.signal })
        if (!executed.ok && !executed.data.reviewPending) throwRunFailure(executed.errors)
        return {
          implementationResult: executed.data.implementationResult,
          reviewPending: executed.data.reviewPending ?? false,
          diagnostics: executed.errors.map(({ code, message }) => ({ code, message })),
          receiptId: executed.data.receiptId,
          completed: executed.data.completed,
          checks: executed.data.checks.map((check) => ({ id: check.id, kind: check.kind, status: check.status, summary: check.summary })),
          repairedAttempt: executed.data.repairedAttempt ?? null,
        }
      } finally {
        inFlight.delete(executionKey(root, runId))
      }
    },
  )

  handle(
    HARNESS_COMMAND_CHANNELS.runPause,
    async (_e, cwd: string, runId: string): Promise<{ state: string }> => {
      const root = await withRoot(cwd)
      if (typeof runId !== 'string' || !runId) throwFailure('SCHEMA_INVALID', 'run pause needs a run id', { path: 'runId' })
      const loaded = await getTaskRun(root, runId)
      if (!loaded.run) throwRunFailure(loaded.errors)
      const paused = await pauseTaskRun(root, runId, loaded.run?.lease?.token ?? '')
      if (!paused.ok) throwRunFailure(paused.errors)
      return runStateOf(root, runId)
    },
  )

  handle(
    HARNESS_COMMAND_CHANNELS.runResume,
    async (_e, cwd: string, runId: string): Promise<{ state: string }> => {
      const root = await withRoot(cwd)
      if (typeof runId !== 'string' || !runId) throwFailure('SCHEMA_INVALID', 'run resume needs a run id', { path: 'runId' })
      const loaded = await getTaskRun(root, runId)
      if (!loaded.run) throwRunFailure(loaded.errors)
      const resumed = await resumeTaskRun(root, runId, loaded.run?.lease?.token ?? '')
      if (!resumed.ok) throwRunFailure(resumed.errors)
      return runStateOf(root, runId)
    },
  )

  handle(
    HARNESS_COMMAND_CHANNELS.runRebaseline,
    async (_e, cwd: string, runId: string, authorization: { by: string; ref?: string } | null): Promise<{ state: string }> => {
      const root = await withRoot(cwd)
      if (typeof runId !== 'string' || !runId) throwFailure('SCHEMA_INVALID', 'run rebaseline needs a run id', { path: 'runId' })
      const loaded = await getTaskRun(root, runId)
      if (!loaded.run || !loaded.run.taskUri) throwRunFailure(loaded.errors.length ? loaded.errors : [{ code: 'NOT_FOUND', message: 'run is missing' }])
      const rebased = await rebaselineTaskRun(root, runId, loaded.run?.lease?.token ?? '', loaded.run?.taskUri as string, authorization ?? null)
      if (!rebased.ok) throwRunFailure(rebased.errors)
      return runStateOf(root, runId)
    },
  )

  handle(
    HARNESS_COMMAND_CHANNELS.runAbort,
    async (_e, cwd: string, runId: string): Promise<{ state: string }> => {
      const root = await withRoot(cwd)
      if (typeof runId !== 'string' || !runId) throwFailure('SCHEMA_INVALID', 'run abort needs a run id', { path: 'runId' })
      const controller = inFlight.get(executionKey(root, runId))
      if (!controller) throwFailure('NOT_READY', 'no in-flight execution owns this run', { path: 'runId' })
      ;(controller as AbortController).abort()
      return runStateOf(root, runId)
    },
  )

  // ── external runner backflow (S8-JanusX): handoff reads plus host takeover ──
  // The external terminal owns its process; the desktop only hands over the
  // pinned baseline and validates whatever evidence comes back through the
  // shared kernel. Takeover tokens stay in the main process.

  handle(
    HARNESS_COMMAND_CHANNELS.runHandoffRead,
    async (_e, cwd: string, runId: string): Promise<{ path: string; markdown: string }> => {
      const root = await withRoot(cwd)
      if (typeof runId !== 'string' || !runId) throwFailure('SCHEMA_INVALID', 'run handoff read needs a run id', { path: 'runId' })
      const handoff = await readTaskHandoff(root, runId)
      if (!handoff.ok) throwRunFailure(handoff.errors)
      return handoff.data
    },
  )

  handle(
    HARNESS_COMMAND_CHANNELS.runTakeover,
    async (_e, cwd: string, runId: string, newOwner: string, reason: string): Promise<{ state: string }> => {
      const root = await withRoot(cwd)
      if (typeof runId !== 'string' || !runId) throwFailure('SCHEMA_INVALID', 'run takeover needs a run id', { path: 'runId' })
      if (typeof newOwner !== 'string' || !newOwner.trim()) throwFailure('SCHEMA_INVALID', 'run takeover needs a new owner', { path: 'newOwner' })
      if (typeof reason !== 'string' || !reason.trim()) throwFailure('SCHEMA_INVALID', 'takeover needs a reason; silent ownership changes strand runs', { path: 'reason' })
      if (inFlight.has(executionKey(root, runId))) throwFailure('BUSY', 'an in-flight desktop execution owns this run; abort it first', { path: 'runId' })
      const taken = await takeoverTaskRun(root, runId, newOwner.trim(), reason.trim())
      if (!taken.ok) throwRunFailure(taken.errors)
      return runStateOf(root, runId)
    },
  )

  // ── thread registry (S8-JanusX): background threads list, activate, close ──
  // Threads live with their run on this checkout. Closing destroys only the
  // thread file plus briefs after an explicit user decision; Notes, receipts,
  // and run records always survive.

  handle(
    HARNESS_COMMAND_CHANNELS.runThreads,
    async (_e, cwd: string) => {
      const root = await withRoot(cwd)
      return (await listTaskThreads(root)).threads
    },
  )

  handle(
    HARNESS_COMMAND_CHANNELS.runThread,
    async (_e, cwd: string, runId: string) => {
      const root = await withRoot(cwd)
      if (typeof runId !== 'string' || !runId) throwFailure('SCHEMA_INVALID', 'run thread needs a run id', { path: 'runId' })
      const opened = await openTaskThread(root, runId)
      if (!opened.ok) throwRunFailure(opened.errors)
      return opened.data
    },
  )

  handle(
    HARNESS_COMMAND_CHANNELS.runThreadClose,
    async (_e, cwd: string, runId: string): Promise<{ closed: boolean }> => {
      const root = await withRoot(cwd)
      if (typeof runId !== 'string' || !runId) throwFailure('SCHEMA_INVALID', 'run thread close needs a run id', { path: 'runId' })
      if (inFlight.has(executionKey(root, runId))) throwFailure('BUSY', 'an in-flight desktop execution owns this run; abort it first', { path: 'runId' })
      const closed = await closeTaskThread(root, runId)
      if (!closed.ok) throwRunFailure(closed.errors)
      return closed.data
    },
  )

  // ── delegated review and limited repair (S8-JanusX): read-only evaluator ──
  // The evaluator audits pinned evidence on its own thread and never inherits
  // implementor history. Repairs spend the kernel budget through explicit
  // packets; finishing re-validates against a live snapshot.

  async function runOwnerToken(root: string, runId: string): Promise<{ token: string; owner: string }> {
    const loaded = await getTaskRun(root, runId)
    if (!loaded.run) throwRunFailure(loaded.errors)
    const token = loaded.run?.lease?.token
    const owner = loaded.run?.lease?.owner
    if (!token || !owner) throwFailure('BUSY', 'run has no owner lease; start it before review', { path: 'runId' })
    return { token: token as string, owner: owner as string }
  }

  handle(
    HARNESS_COMMAND_CHANNELS.runReview,
    async (_e, cwd: string, input: HarnessRunReviewInput): Promise<HarnessRunReviewResult> => {
      const root = await withRoot(cwd)
      const runId = input?.runId
      if (typeof runId !== 'string' || !runId) throwFailure('SCHEMA_INVALID', 'run review needs a run id', { path: 'runId' })
      const reviewer = input?.reviewer?.trim() ?? ''
      if (!reviewer) throwFailure('SCHEMA_INVALID', 'independent review needs a reviewer identity', { path: 'reviewer' })
      if (inFlight.has(executionKey(root, runId))) throwFailure('BUSY', 'an in-flight desktop execution owns this run; abort it first', { path: 'runId' })
      const { token } = await runOwnerToken(root, runId)
      const loaded = await getTaskRun(root, runId)
      const taskUri = loaded.run?.taskUri as string
      const attempt = loaded.run?.attempt ?? 0
      const providerId = input?.providerId?.trim()
      const modelId = input?.modelId?.trim()
      const reviewed = await requestIndependentReview(root, runId, token, {
        review: createModelReviewPort(taskUri, attempt, {
          ...(providerId ? { providerId } : {}),
          ...(modelId ? { modelId } : {}),
          getModel: (provider, model) => llmService.getLanguageModel('janus', provider, model),
          generateReviewText: (_model, prompt, signal) => generateDesktopReviewText(root, runId, token, 'independent', {
            providerId: providerId ?? '', modelId: modelId ?? '', maxTurns: DEFAULT_AGENT_MAX_STEPS,
            getModel: (provider, model) => llmService.getLanguageModel('janus', provider, model),
            streamTextFn: streamText as unknown as ChatTurnPorts['streamTextFn'],
          }, prompt, signal),
        }, buildEvaluatorPrompt),
      }, { reviewer, ...(input?.receiptId ? { receiptId: input.receiptId } : {}) })
      if (!reviewed.ok) throwRunFailure(reviewed.errors)
      return reviewed.data
    },
  )

  handle(
    HARNESS_COMMAND_CHANNELS.runFinish,
    async (_e, cwd: string, runId: string): Promise<{ receiptId: string; completed: boolean }> => {
      const root = await withRoot(cwd)
      if (typeof runId !== 'string' || !runId) throwFailure('SCHEMA_INVALID', 'run finish needs a run id', { path: 'runId' })
      if (inFlight.has(executionKey(root, runId))) throwFailure('BUSY', 'an in-flight desktop execution owns this run; abort it first', { path: 'runId' })
      const { token } = await runOwnerToken(root, runId)
      const finished = await finishWithLatestReceipt(root, runId, token)
      if (!finished.ok) throwRunFailure(finished.errors)
      return finished.data
    },
  )

  handle(
    HARNESS_COMMAND_CHANNELS.runRepair,
    async (_e, cwd: string, input: HarnessRunRepairInput): Promise<{ attempt: number; state: string }> => {
      const root = await withRoot(cwd)
      const runId = input?.runId
      if (typeof runId !== 'string' || !runId) throwFailure('SCHEMA_INVALID', 'run repair needs a run id', { path: 'runId' })
      const summary = input?.summary?.trim() ?? ''
      if (!summary) throwFailure('SCHEMA_INVALID', 'repair needs a short failure summary', { path: 'summary' })
      if (inFlight.has(executionKey(root, runId))) throwFailure('BUSY', 'an in-flight desktop execution owns this run; abort it first', { path: 'runId' })
      const loaded = await getTaskRun(root, runId)
      if (!loaded.run) throwRunFailure(loaded.errors)
      const failureReceiptId = loaded.run?.receipts[(loaded.run?.receipts.length ?? 1) - 1]
      if (!failureReceiptId) throwFailure('NOT_READY', 'repair needs a recorded failure receipt; review before repairing', { path: 'receipts' })
      const lease = loaded.run?.lease
      const repaired = await repairTaskRun(root, runId, lease?.token ?? '', {
        failureReceiptId,
        summary,
        auto: false,
        ...(lease ? { authorization: { by: lease.owner } } : {}),
      })
      if (!repaired.ok) throwRunFailure(repaired.errors)
      const after = await getTaskRun(root, runId)
      return { attempt: repaired.data.attempt, state: after.run?.state ?? 'running' }
    },
  )

  handle(HARNESS_COMMAND_CHANNELS.noteChatChanges, async (_e, cwd: string, conversationId: string) => {
    // Note: preserve useful diagnostics through Electron's Error serialization — see .agents/notes/blueprint/workspaces/requirements/blueprint-empty-init.md
    try {
      if (typeof conversationId !== 'string' || !conversationId.trim() || conversationId.length > 128) throwFailure('SCHEMA_INVALID', 'Invalid conversation id')
      return await listNoteChatChanges(await withRoot(cwd), conversationId)
    } catch (error) {
      if (error instanceof Error) throw error
      const failure = error as Partial<HarnessFailure> | null
      const code = failure?.code ?? 'IO_ERROR'
      throw Object.assign(new Error(`${code}: ${failure?.message ?? 'Cannot read Note change history'}`), { code })
    }
  })

  // ── managed undo (S8-JanusX, legacy-loop equivalence): preview then apply ──
  // Undo reverses one committed write as a new undoable changeset. Conflicts
  // refuse the whole package; evidence and receipts never move.

  // ── on-demand legacy migration (S8-JanusX): JSON blueprint becomes Notes ──
  // Preview never writes. Apply validates every note, writes once through
  // the managed transaction, then archives (never deletes) the JSON source.

  async function migrationSource(cwd: string, blueprintId: string) {
    const root = await withRoot(cwd)
    if (typeof blueprintId !== 'string' || !blueprintId) throwFailure('SCHEMA_INVALID', 'migration needs a blueprint id', { path: 'blueprintId' })
    const view = await blueprintNoteView.projectView(root)
    if (!view.repoId) throwFailure('NOT_FOUND', 'init .agents/harness.json with a repoId first')
    const blueprint = await blueprintStore.loadBlueprint(GLOBAL_BLUEPRINT_SCOPE, blueprintId)
    if (!blueprint) throwFailure('NOT_FOUND', `unknown blueprint ${blueprintId}`, { path: 'blueprintId' })
    const audits = await readMaintenanceAudits(join(app.getPath('userData'), 'janusx', 'blueprint-maintenance-audit'), { blueprintId }).catch(() => [])
    return { root: root as string, repoId: view.repoId as string, blueprint: blueprint!, audits }
  }

  function throwMigrationFailure(error: unknown): never {
    const failure = error as { code?: string; message?: string; path?: string }
    throwRunFailure([{ code: failure.code ?? 'SCHEMA_INVALID', message: failure.message ?? String(error), ...(failure.path ? { path: failure.path } : {}) }])
  }

  handle(
    HARNESS_COMMAND_CHANNELS.migratePreview,
    async (_e, cwd: string, blueprintId: string): Promise<HarnessMigrationPreview> => {
      const { root, repoId, blueprint, audits } = await migrationSource(cwd, blueprintId)
      try {
        const { noteAuthoringContext } = await import('../../../plugins/blueprint/src/main/notes/note-authoring')
        return previewMigration(blueprint, repoId, audits, await noteAuthoringContext(harnessNoteService, root))
      } catch (error) {
        throwMigrationFailure(error)
      }
    },
  )

  handle(
    HARNESS_COMMAND_CHANNELS.migrateApply,
    async (_e, cwd: string, blueprintId: string): Promise<HarnessMigrationResult> => {
      const { root, repoId, blueprint, audits } = await migrationSource(cwd, blueprintId)
      try {
        const result = await applyMigration(root, repoId, blueprint, audits, archiveBlueprintSource)
        blueprintStore.evictBlueprint(blueprintId)
        return result
      } catch (error) {
        throwMigrationFailure(error)
      }
    },
  )
}
