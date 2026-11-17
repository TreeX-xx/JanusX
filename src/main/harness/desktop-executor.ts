// Note: desktop xdo host owns checks and self-review — see .agents/notes/agent/desktop-delegated-modes.md
// Note: evaluator tests precede the verdict — see .agents/notes/agent/independent-review-repair.md
/**
 * @file Desktop verification and delegated execution host.
 * @description Runs an accepted task's declared verification on the desktop:
 *  pins the live snapshot, executes command steps in a validated child
 *  process (never a shell string), collects operator evidence for manual
 *  steps, obtains a read-only self-review claim through an injected port,
 *  and records the immutable receipt before finishing against the neutral
 *  run kernel. State transitions ride `execution-adapter` (neutral kernel);
 *  model turns and command runtimes belong to this host. The CLI
 *  task-execution host is never called: the two hosts are peers sharing
 *  only the contract and the receipt validator.
 *  No Electron import, so unit tests drive real temp checkouts.
 */
import { runProcess } from '../platform/process-host/node'
import { randomUUID } from 'node:crypto'
import { relative, resolve } from 'node:path'
import {
  codeKey,
  codeManifestHash,
  taskExecutionPolicy,
  reviewTestVerdict,
  type RunReviewTests,
  type Diagnostic,
  type Receipt,
  type ReceiptCheck,
  type ReceiptCoverage,
  type VerificationStep,
} from '@janus-agent/harness-core'
import { TaskScope, checkpointTaskHandoff, collectLiveSnapshot, collectTaskSnapshot, createReviewTestSession } from '@janus-agent/harness-node'
import { ensureTaskThread, recordThreadAttempt, recordThreadEvaluation } from './task-thread'
import { buildTaskBrief, renderBriefSection, saveBriefCopy, verifyBriefFiles, type TaskBrief } from './task-brief'
import {
  finishTaskRun,
  getTaskRun,
  maybeAutoRepairTaskRun,
  pauseTaskRun,
  recordTaskReceipt,
  verifyTaskRun,
} from './execution-adapter'
import { parseDesktopReviewClaim, type DesktopReviewCriterion } from './desktop-review'
import { prepareDesktopTaskTurn, type DesktopTaskTurn } from './desktop-task-turn'

type DesktopRun = NonNullable<Awaited<ReturnType<typeof getTaskRun>>['run']>

export interface DesktopCommandOutcome {
  ok: boolean
  exitCode?: number
  timedOut?: boolean
  summary: string
}

export interface DesktopReviewPortInput {
  manifest: Receipt['codeManifest']
  manifestHash: string
  checks: ReceiptCheck[]
  criteria: DesktopReviewCriterion[]
  brief: TaskBrief
  runTests?: RunReviewTests
}

export interface DesktopExecutorPorts {
  command(step: VerificationStep, signal?: AbortSignal): Promise<DesktopCommandOutcome>
  review(input: DesktopReviewPortInput, signal?: AbortSignal): Promise<{ verdict: 'approved' | 'needs-fix' | 'blocked'; coverage: ReceiptCoverage[]; summary?: string }>
  independentReview?: DesktopExecutorPorts['review']
}

export interface DesktopManualEvidence {
  stepId: string
  observer: string
  observation: string
}

export interface DesktopExecuteOptions {
  implementor?: string
  reviewer?: string
  timeoutMs?: number
  manualEvidence?: DesktopManualEvidence[]
  signal?: AbortSignal
}

export interface DesktopExecuteResult {
  implementationResult?: string
  reviewPending?: boolean
  receiptId: string
  completed: boolean
  checks: ReceiptCheck[]
  repairedAttempt?: number | null
}

interface OpResult<T> {
  ok: boolean
  run: DesktopRun | null
  errors: Diagnostic[]
  data: T
}

const KNOWN_CODES = new Set(['NOT_FOUND', 'SCHEMA_INVALID', 'CONFLICT', 'NOT_READY', 'STALE_BASELINE', 'DEPENDENCY_UNSATISFIED', 'APPROVAL_REQUIRED', 'PERMISSION_DENIED', 'BUSY', 'RECOVERY_REQUIRED', 'INVALID_RELATION', 'UNRESOLVED_REFERENCE', 'CAPABILITY_UNAVAILABLE'])

function diag(code: Diagnostic['code'], message: string, path?: string): Diagnostic {
  return path === undefined ? { code, message } : { code, message, path }
}

/** Host-thrown `CODE: message` errors become diagnostics; anything else is IO. */
function hostError(error: unknown): Diagnostic[] {
  const message = error instanceof Error ? error.message : String(error)
  const code = ((error as { code?: string })?.code ?? message.split(':')[0]?.trim()) as Diagnostic['code']
  if (code === 'UNSUPPORTED_SCHEMA') return [diag(code, message)]
  if (KNOWN_CODES.has(code)) return [diag(code, message)]
  return [diag('IO_ERROR', `desktop executor failed: ${message}`)]
}

function sameInputs(a: Array<{ uri: string; contentHash: string; criteria?: string[] }>, b: Array<{ uri: string; contentHash: string; criteria?: string[] }>): boolean {
  const key = (row: { uri: string; contentHash: string; criteria?: string[] }): string =>
    `${row.uri}${row.contentHash}${[...(row.criteria ?? [])].sort().join(',')}`
  const left = a.map(key).sort()
  const right = b.map(key).sort()
  return left.length === right.length && left.every((value, index) => value === right[index])
}

const SUMMARY_LIMIT = 4000

/**
 * Executes one declared command step without a shell. The program and args
 * travel as an array, the cwd must resolve inside the checkout, and output
 * is truncated. Declared commands are trusted workspace code under runtime
 * policy, not an operating-system sandbox.
 */
export function runDesktopCommand(
  root: string,
  step: VerificationStep,
  opts?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<DesktopCommandOutcome> {
  if (step.kind !== 'command' || typeof step.program !== 'string' || !step.program) {
    return Promise.resolve({ ok: false, summary: `verification step ${step.id} has no executable program` })
  }
  if (!Array.isArray(step.args) || step.args.some((arg) => typeof arg !== 'string')) {
    return Promise.resolve({ ok: false, summary: `verification step ${step.id} needs a string args array` })
  }
  const cwd = resolve(root, step.cwd || '.')
  const outside = relative(root, cwd)
  if (outside === '..' || outside.startsWith(`..${'/'}`) || outside.startsWith('..\\') || (cwd !== root && !cwd.startsWith(root.endsWith('/') || root.endsWith('\\') ? root : `${root}/`) && !cwd.startsWith(`${root}\\`))) {
    return Promise.resolve({ ok: false, summary: `verification cwd escapes the checkout: ${step.cwd}` })
  }
  const timeoutMs = opts?.timeoutMs ?? 120_000
  return (async () => {
    let output = ''
    const append = (chunk: string): void => {
      output += chunk
      if (output.length > SUMMARY_LIMIT) output = output.slice(-SUMMARY_LIMIT)
    }
    const result = await runProcess(step.program as string, step.args, { cwd, timeoutMs, signal: opts?.signal, maxOutputBytes: 16 * 1024 * 1024, onStdout: append, onStderr: append })
    return {
      ok: result.status === 'exited' && result.exitCode === 0,
      ...(result.exitCode === null ? {} : { exitCode: result.exitCode }),
      ...(['timed-out', 'cancelled'].includes(result.status) ? { timedOut: true } : {}),
      summary: result.status !== 'exited' ? `command ${result.status}\n${output}` : output || 'Command produced no output',
    }
  })()
}

export function checkCoverageClaims(
  claims: ReceiptCoverage[],
  criteria: Map<string, string>,
  passed: Set<string>,
): Diagnostic[] {
  const seen = new Set<string>()
  for (let i = 0; i < claims.length; i += 1) {
    const claim = claims[i] as ReceiptCoverage
    const key = `${claim.uri}#${claim.criterionId}`
    if (!criteria.has(key)) return [diag('UNRESOLVED_REFERENCE', `self-review covers an unknown criterion: ${key}`, `review.coverage[${i}]`)]
    if (seen.has(key)) return [diag('SCHEMA_INVALID', `self-review covers ${key} twice`, `review.coverage[${i}]`)]
    seen.add(key)
    if (claim.criterionHash !== criteria.get(key)) {
      return [diag('STALE_BASELINE', `criterion ${key} moved during verification; re-run explicitly`, `review.coverage[${i}].criterionHash`)]
    }
    for (const checkId of claim.checkIds) {
      if (!passed.has(checkId)) {
        return [diag('NOT_READY', `criterion ${key} cites check ${checkId} that did not pass; partial evidence never composes a pass`, `review.coverage[${i}].checkIds`)]
      }
    }
  }
  return []
}

/**
 * Executes the pinned run to a receipt: verify, checks, mode-specific review,
 * record, finish. Failures record immutable receipts where one exists;
 * malformed review output records nothing and never completes.
 */
export async function verifyDesktopTask(
  root: string,
  runId: string,
  token: string,
  ports: DesktopExecutorPorts,
  opts?: DesktopExecuteOptions,
): Promise<OpResult<DesktopExecuteResult>> {
  const fail = <T>(run: DesktopRun | null, errors: Diagnostic[], data: T): OpResult<T> => ({ ok: false, run, errors, data })
  let loaded: Awaited<ReturnType<typeof getTaskRun>>
  try {
    loaded = await getTaskRun(root, runId)
  } catch (error) {
    return fail(null, hostError(error), { receiptId: '', completed: false, checks: [] })
  }
  const run = loaded.run
  if (!run) return fail(null, loaded.errors, { receiptId: '', completed: false, checks: [] })
  const contract = await collectTaskSnapshot(root, run.taskUri)
  if (!contract.ok) return fail(run, contract.errors, { receiptId: '', completed: false, checks: [] })
  const policy = taskExecutionPolicy(run.mode, run.lease?.owner ?? 'desktop', runId, contract.work.review)
  const implementor = opts?.implementor ?? policy.implementor
  const reviewer = opts?.reviewer?.trim() || policy.reviewer
  if (policy.independent && (!ports.independentReview || reviewer === implementor || reviewer === run.lease?.owner)) {
    return fail(run, [diag('CAPABILITY_UNAVAILABLE', 'Task execution requires a separate independent reviewer', 'review')], { receiptId: '', completed: false, checks: [] })
  }
  if (run.executor !== 'internal') {
    return fail(run, [diag('CAPABILITY_UNAVAILABLE', 'external runs finish through their own host and handoff', 'executor')], { receiptId: '', completed: false, checks: [] })
  }
  if (run.state !== 'running' && run.state !== 'verifying') {
    return fail(run, [diag('NOT_READY', `execute runs from running (now ${run.state}); start the queued run first`, 'state')], { receiptId: '', completed: false, checks: [] })
  }
  // The thread persists across attempts on the same run: repairs reattach to
  // it instead of re-reading the world. The run record stays the truth.
  let thread: Awaited<ReturnType<typeof ensureTaskThread>>
  try {
    thread = await ensureTaskThread(root, { runId, taskUri: run.taskUri, mode: run.mode })
  } catch (error) {
    return fail(run, hostError(error), { receiptId: '', completed: false, checks: [] })
  }
  const history = thread.attempts.slice(-3).map((item) => ({
    attempt: item.attempt,
    verdict: item.reviewVerdict ?? 'unreviewed',
    ...(item.receiptId ? { receiptId: item.receiptId } : {}),
    failedChecks: item.checks.filter((check) => check.status !== 'passed').map((check) => check.id),
  }))
  const noteAttempt = async (extra: { reviewVerdict?: 'approved' | 'needs-fix' | 'blocked'; receiptId?: string; checks: ReceiptCheck[] }): Promise<void> => {
    try {
      thread = await recordThreadAttempt(root, runId, {
        attempt: run.attempt,
        manifestHash,
        checks: extra.checks.map((check) => ({ id: check.id, kind: check.kind, status: check.status })),
        ...(extra.reviewVerdict ? { reviewVerdict: extra.reviewVerdict } : {}),
        ...(extra.receiptId ? { receiptId: extra.receiptId } : {}),
      })
    } catch {
      // Thread history is auxiliary; the receipt dwarfs it. Never fail the run for it.
    }
  }
  let snapshot: Awaited<ReturnType<typeof collectTaskSnapshot>>
  try {
    snapshot = await collectTaskSnapshot(root, run.taskUri)
  } catch (error) {
    return fail(run, hostError(error), { receiptId: '', completed: false, checks: [] })
  }
  if (!snapshot.ok) return fail(run, snapshot.errors, { receiptId: '', completed: false, checks: [] })
  if (snapshot.baseline.taskContractHash !== run.baseline.taskContractHash || !sameInputs(snapshot.baseline.inputs, run.baseline.inputs)) {
    return fail(run, [diag('STALE_BASELINE', 'task contract or inputs moved; pause and rebaseline explicitly', 'baseline')], { receiptId: '', completed: false, checks: [] })
  }
  let scope: TaskScope
  try {
    scope = new TaskScope(root, snapshot.repoId, snapshot.work)
  } catch (error) {
    return fail(run, hostError(error), { receiptId: '', completed: false, checks: [] })
  }
  let manifest: Receipt['codeManifest']
  try {
    manifest = await scope.manifest()
  } catch (error) {
    return fail(run, hostError(error), { receiptId: '', completed: false, checks: [] })
  }
  const manifestHash = codeManifestHash(manifest)
  if (run.state === 'verifying') {
    const pinned = run.verification?.codeManifest
    if (!pinned || codeManifestHash(pinned) !== manifestHash) {
      return fail(run, [diag('STALE_BASELINE', 'code changed after verification; pause and rebaseline before retrying', 'codeManifest')], { receiptId: '', completed: false, checks: [] })
    }
  } else {
    const verified = await verifyTaskRun(root, runId, token, manifest)
    if (!verified.ok) return fail(verified.run ?? run, verified.errors, { receiptId: '', completed: false, checks: [] })
  }
  const evidence = new Map((opts?.manualEvidence ?? []).map((item) => [item.stepId, item]))
  const checks: ReceiptCheck[] = []
  const checkCurrent = async () => {
    opts?.signal?.throwIfAborted()
    const current = await prepareDesktopTaskTurn(root, runId, token, 'self')
    if (current.attempt !== run.attempt) throw new Error('STALE_BASELINE: task attempt changed')
  }
  try {
    for (const step of snapshot.work.verification) {
      await checkCurrent()
      if (step.repoId !== snapshot.repoId) {
        return fail(run, [diag('CAPABILITY_UNAVAILABLE', `verification step ${step.id} targets another checkout; split multi-repository work into per-repo tasks`, 'verification')], { receiptId: '', completed: false, checks })
      }
      await scope.checkPath(step.cwd)
      if (step.kind === 'manual') {
        const proof = evidence.get(step.id)
        if (!proof || !proof.observer.trim() || !proof.observation.trim()) {
          return fail(run, [diag('CAPABILITY_UNAVAILABLE', `manual step ${step.id} needs operator evidence (observer plus actual observation); no check is auto-passed`, 'verification')], { receiptId: '', completed: false, checks })
        }
        checks.push({ id: step.id, kind: 'manual', required: step.required, status: 'passed', repoId: step.repoId, summary: proof.observation.slice(0, SUMMARY_LIMIT), performedBy: proof.observer })
        continue
      }
      const outcome = await ports.command(step, opts?.signal)
      checks.push({
        id: step.id, kind: 'command', required: step.required, repoId: step.repoId,
        command: { program: step.program as string, args: (step.args ?? []) as string[], cwd: step.cwd },
        status: outcome.ok && outcome.exitCode === 0 && !outcome.timedOut ? 'passed' : 'failed',
        ...(Number.isInteger(outcome.exitCode) ? { exitCode: outcome.exitCode as number } : {}),
        summary: (outcome.summary || 'Command produced no output').slice(0, SUMMARY_LIMIT),
        performedBy: implementor,
      })
    }
  } catch (error) {
    if (opts?.signal?.aborted) await pauseTaskRun(root, runId, token)
    return fail(run, hostError(error), { receiptId: '', completed: false, checks })
  }
  const criteria: DesktopReviewCriterion[] = snapshot.work.acceptanceRefs.map((ref) => ({
    uri: ref.uri,
    criterionId: ref.criterionId,
    text: snapshot.notes.find((note) => note.uri === ref.uri)?.sections.find((section) => section.name === 'Acceptance criteria')?.text,
    criterionHash: (snapshot.criterionHashes.find(([uri]) => uri === ref.uri)?.[1].find(([id]) => id === ref.criterionId)?.[1] ?? '') as string,
  }))
  if (criteria.some((item) => !item.criterionHash)) {
    return fail(run, [diag('NOT_FOUND', 'an acceptance reference resolves to no hashed criterion; re-adopt the task contract', 'acceptanceRefs')], { receiptId: '', completed: false, checks })
  }
  let claim: { verdict: 'approved' | 'needs-fix' | 'blocked'; coverage: ReceiptCoverage[]; summary?: string }
  const brief = buildTaskBrief({
    runId,
    taskUri: run.taskUri,
    attempt: run.attempt,
    goalText: snapshot.notes.find((note) => note.uri === run.taskUri)?.sections.find((section) => section.name === 'Scope')?.text ?? '',
    constraintText: snapshot.notes.find((note) => note.uri === run.taskUri)?.sections.find((section) => section.name === 'Open questions')?.text ?? '',
    criteria: criteria.map((item) => ({ uri: item.uri, criterionId: item.criterionId })),
    manifest,
    history,
  })
  const briefProblems = verifyBriefFiles(brief, manifest)
  if (briefProblems.length > 0) return fail(run, briefProblems, { receiptId: '', completed: false, checks })
  try {
    await saveBriefCopy(root, runId, `attempt-${run.attempt}`, renderBriefSection(brief))
  } catch {
    // Brief copies are audit-only; the live brief above is what the review uses.
  }
  try {
    await checkCurrent()
    await checkpointTaskHandoff(root, run.taskUri, run.baseline.taskContractHash, 'Self-review; preserve authored progress and evidence')
    claim = await ports.review({ manifest, manifestHash, checks, criteria, brief }, opts?.signal)
    if (!['approved', 'needs-fix', 'blocked'].includes(claim.verdict)) throw new Error('SCHEMA_INVALID: invalid self-review verdict')
    if (policy.independent) {
      await checkCurrent()
      await checkpointTaskHandoff(root, run.taskUri, run.baseline.taskContractHash, 'Independent review against fixed acceptance criteria')
      const tests = createReviewTestSession({ root, repoId: snapshot.repoId, actor: reviewer, manifest, criteria,
        verification: snapshot.work.verification, command: ports.command, checkCurrent })
      claim = await ports.independentReview!({ manifest: structuredClone(manifest), manifestHash, checks: structuredClone(checks), criteria, brief: { ...brief, prior: [] }, runTests: tests.run }, opts?.signal)
      tests.assertExecuted()
      checks.push(...tests.checks)
      claim.verdict = reviewTestVerdict(claim.verdict, checks)
    }
    await checkCurrent()
  } catch (error) {
    if (opts?.signal?.aborted) await pauseTaskRun(root, runId, token)
    await noteAttempt({ checks })
    return fail(run, hostError(error), { receiptId: '', completed: false, checks })
  }
  if (claim.verdict !== 'approved' && claim.verdict !== 'needs-fix' && claim.verdict !== 'blocked') {
    await noteAttempt({ checks })
    return fail(run, [diag('SCHEMA_INVALID', 'self-review verdict must be approved, needs-fix, or blocked; refusing completion', 'review.verdict')], { receiptId: '', completed: false, checks })
  }
  const criterionMap = new Map(criteria.map((item) => [`${item.uri}#${item.criterionId}`, item.criterionHash]))
  const passed = new Set(checks.filter((check) => check.status === 'passed').map((check) => check.id))
  const coverageProblems = checkCoverageClaims(claim.coverage, criterionMap, passed)
  if (coverageProblems.length > 0) {
    await noteAttempt({ checks })
    return fail(run, coverageProblems, { receiptId: '', completed: false, checks })
  }
  let receipt: Receipt = {
    schema: 'harness-receipt/1', id: randomUUID(), taskUri: run.taskUri, mode: run.mode, attempt: run.attempt,
    taskContractHash: run.baseline.taskContractHash, inputs: run.baseline.inputs, codeManifest: manifest,
    checks, coverage: claim.coverage,
    review: { kind: policy.independent ? 'independent' : 'self', verdict: claim.verdict, reviewedManifestHash: manifestHash, actor: policy.independent ? reviewer : implementor, ...(claim.summary ? { summary: claim.summary.slice(0, SUMMARY_LIMIT) } : {}) },
    createdAt: new Date().toISOString(), actor: implementor,
  }
  let current: Receipt['codeManifest']
  try {
    current = await scope.manifest()
    await checkCurrent()
  } catch (error) {
    if (opts?.signal?.aborted) await pauseTaskRun(root, runId, token)
    return fail(run, hostError(error), { receiptId: '', completed: false, checks })
  }
  // Drift during checks or review invalidates the evidence itself, but the
  // blocked receipt still lands as immutable history for the next attempt.
  if (codeManifestHash(current) !== manifestHash) {
    receipt = { ...receipt, review: { ...receipt.review, verdict: 'blocked' } }
    const stored = await recordTaskReceipt(root, runId, token, receipt)
    if (!stored.ok) return fail(stored.run ?? run, stored.errors, { receiptId: receipt.id, completed: false, checks })
    await noteAttempt({ reviewVerdict: 'blocked', receiptId: receipt.id, checks })
    return fail(stored.run ?? run, [diag('STALE_BASELINE', 'scoped code changed during verification or review; the blocked receipt is recorded, fix and re-run', 'codeManifest')], { receiptId: receipt.id, completed: false, checks })
  }
  const stored = await recordTaskReceipt(root, runId, token, receipt)
  if (!stored.ok) return fail(stored.run ?? run, stored.errors, { receiptId: receipt.id, completed: false, checks })
  await noteAttempt({ reviewVerdict: receipt.review.verdict, receiptId: receipt.id, checks })
  if (policy.independent) {
    await recordThreadEvaluation(root, runId, { attempt: run.attempt, reviewer, verdict: receipt.review.verdict, receiptId: receipt.id }).catch(() => undefined)
  }
  if (run.mode === 'xdel' && snapshot.work.review === 'independent' && claim.verdict === 'approved' && checks.every(check => check.status === 'passed')) {
    await checkpointTaskHandoff(root, run.taskUri, run.baseline.taskContractHash, 'Main Agent integrates Change Summary and Note draft; independent review remains pending under the existing contract')
    return fail(stored.run ?? run, [diag('NOT_READY', 'xdel self-review is recorded; independent review remains pending')], { receiptId: receipt.id, completed: false, checks, reviewPending: true })
  }
  let live: Awaited<ReturnType<typeof collectLiveSnapshot>>
  try {
    live = await collectLiveSnapshot(root, run.taskUri, implementor, current.map((row) => [codeKey(row.repoId, row.path), row.deleted === true ? null : (row.sha256 as string)]))
    await checkCurrent()
  } catch (error) {
    if (opts?.signal?.aborted) await pauseTaskRun(root, runId, token)
    return fail(stored.run ?? run, hostError(error), { receiptId: receipt.id, completed: false, checks })
  }
  if (!live.ok) return fail(stored.run ?? run, live.errors, { receiptId: receipt.id, completed: false, checks })
  const finished = await finishTaskRun(root, runId, token, receipt.id, live.live)
  if (!finished.ok) {
    if (!policy.autoRepair || receipt.review.verdict === 'blocked') return fail(finished.run ?? run, finished.errors, { receiptId: receipt.id, completed: false, checks })
    const auto = await maybeAutoRepairTaskRun(root, runId, token)
    if (auto.ok && auto.data.repaired) {
      return { ok: true, run: auto.run ?? run, errors: finished.errors, data: { receiptId: receipt.id, completed: false, checks, repairedAttempt: auto.data.attempt } }
    }
    return fail(finished.run ?? run, finished.errors, { receiptId: receipt.id, completed: false, checks })
  }
  await checkpointTaskHandoff(root, run.taskUri, run.baseline.taskContractHash, 'Main Agent integrates returned drafts and completes closeout')
  return { ok: true, run: finished.run ?? run, errors: [], data: { receiptId: receipt.id, completed: true, checks } }
}

/** Compatibility export for callers of the original verification-only host. */
export const executeDesktopXdo = verifyDesktopTask

/** Validates a raw model review text into a port output. Parse failures refuse; they never approve. */
export function reviewClaimFromText(text: string): { ok: true; claim: { verdict: 'approved' | 'needs-fix' | 'blocked'; coverage: ReceiptCoverage[] } } | { ok: false; errors: Diagnostic[] } {
  const parsed = parseDesktopReviewClaim(text)
  if (!parsed.ok) return { ok: false, errors: parsed.errors as Diagnostic[] }
  return { ok: true, claim: { verdict: parsed.claim.verdict, coverage: parsed.claim.coverage } }
}

/** Implementation and bounded repair precede immutable verification on each attempt. */
export async function executeDesktopTask(
  root: string, runId: string, token: string,
  ports: DesktopExecutorPorts & { implement(turn: DesktopTaskTurn, signal?: AbortSignal): Promise<{ cancelled: boolean; text?: string }> },
  opts?: DesktopExecuteOptions,
): Promise<OpResult<DesktopExecuteResult>> {
  let repairedAttempt: number | null = null
  let implementationResult: string | undefined
  try {
    for (;;) {
      opts?.signal?.throwIfAborted()
      const loaded = await getTaskRun(root, runId)
      if (loaded.run) {
        const contract = await collectTaskSnapshot(root, loaded.run.taskUri)
        if (!contract.ok) return { ok: false, run: loaded.run, errors: contract.errors, data: { receiptId: '', completed: false, checks: [] } }
        const policy = taskExecutionPolicy(loaded.run.mode, loaded.run.lease?.owner ?? 'desktop', runId, contract.work.review)
        const reviewer = opts?.reviewer?.trim() || policy.reviewer
        if (policy.independent && (!ports.independentReview || reviewer === (opts?.implementor ?? policy.implementor) || reviewer === loaded.run.lease?.owner)) throw new Error('CAPABILITY_UNAVAILABLE: Task execution requires a separate independent reviewer')
      }
      if (loaded.run?.state === 'running') {
        const turn = await prepareDesktopTaskTurn(root, runId, token)
        const implementation = await ports.implement(turn, opts?.signal)
        implementationResult = implementation.text
        if (implementation.cancelled || opts?.signal?.aborted) {
          await pauseTaskRun(root, runId, token)
          throw new Error('NOT_READY: implementation cancelled; task paused')
        }
        await prepareDesktopTaskTurn(root, runId, token)
      }
      const result = await verifyDesktopTask(root, runId, token, ports, opts)
      if (!result.ok || !result.data.repairedAttempt) {
        return { ...result, data: { ...result.data, repairedAttempt, implementationResult } }
      }
      repairedAttempt = result.data.repairedAttempt
    }
  } catch (error) {
    if (opts?.signal?.aborted) await pauseTaskRun(root, runId, token)
    const loaded = await getTaskRun(root, runId)
    return { ok: false, run: loaded.run, errors: hostError(error), data: { receiptId: '', completed: false, checks: [], repairedAttempt } }
  }
}
