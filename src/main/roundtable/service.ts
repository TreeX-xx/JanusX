import type { RoundtableEventEnvelope, RoundtableState, RoundtableWorkspaceResource } from '../../shared/roundtable/events'
import { exportRoundtableMarkdown } from '../../shared/roundtable/export'
import { markInterrupted, migrateRoundtableState } from '../../shared/roundtable/state'
import { defaultRoundtableWorkflow } from '../../shared/roundtable/workflow-template'
import { buildArtifactBundle, resolveBundleRetry, snapshotSourceFacts, staleSnapshotDiagnostic, type ArtifactBundle } from './artifact-bundle'
import { harnessNoteService } from '../harness/service'
import { validateBundle, validateChangeSet } from '@janus-agent/harness-core'
import { RoundtableRuntime } from './runtime'
import { llmService } from '../llm/LlmService'
import { generateText } from '../llm/ai-runtime'
import { roundtableStore } from './store'
import { app } from 'electron'
import { join } from 'node:path'
import { resolveRegisteredWorkspace } from '../companion/workspace-registry'
import { noteAuthoringContext } from '../../../plugins/blueprint/src/main/notes/note-authoring'
import { z } from 'zod'

export class RoundtableService {
  private readonly sessions = new Map<string, RoundtableRuntime>()
  private readonly listeners = new Set<(event: RoundtableEventEnvelope) => void>()

  onEvent(listener: (event: RoundtableEventEnvelope) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }

  async start(input: string | { prompt: string; workspaceResources?: RoundtableWorkspaceResource[]; toolTimeoutMs?: number }): Promise<RoundtableState> {
    const runtime = this.createRuntime(typeof input === 'object' && input.toolTimeoutMs !== undefined ? { toolTimeoutMs: input.toolTimeoutMs } : undefined)
    const value = typeof input === 'string' ? { prompt: input } : input
    const resources = []
    for (const resource of value.workspaceResources ?? []) {
      const registered = await resolveRegisteredWorkspace(join(app.getPath('userData'), 'janusx', 'workspaces'), resource.workspaceId)
      resources.push({ workspaceId: registered.id, workspaceName: registered.name, workspacePath: registered.path })
    }
    const state = await runtime.start({ prompt: value.prompt, workspaceResources: resources })
    this.sessions.set(state.sessionId!, runtime)
    return state
  }

  private createRuntime(options?: { toolTimeoutMs?: number }): RoundtableRuntime {
    // Visible in the `npm run dev` terminal: proves the running main process
    // has the workspaceId-normalization + fail-loud fixes (§31). If a stale
    // process ever serves roundtables again, this line's absence gives it away.
    console.info('[roundtable] runtime created (fail-loud + workspaceId normalization active)')
    const agents = Object.fromEntries(defaultRoundtableWorkflow.participants.flatMap((spec) => spec.instances).map((participant) => [participant.id, {
      run: async ({ userInput, priorCards, priorFacts, workspaceResources, workspaceContext, hostMode, workspaceTools }: { userInput?: string; priorCards: any[]; priorFacts?: any[]; workspaceResources?: RoundtableWorkspaceResource[]; workspaceContext?: string; hostMode?: 'intake' | 'merge' | 'synthesis'; workspaceTools?: { execute(name: 'workspace.list' | 'workspace.read' | 'workspace.readRange', input: Record<string, unknown>): Promise<unknown> } }) => {
        // Fail loudly: a silent one-line fallback here used to masquerade as a
        // completed card ("refiner reviewed ... with 0 prior results"), leaving
        // users with empty proposals and no diagnosable error. Errors propagate
        // to runtime.runAgent, which records agent:error and lets the round
        // finish with the remaining agents.
        const target = await llmService.getDefaultModel()
        if (!target) throw new Error('圆桌会议需要全局默认模型：请在设置 → LLM 中把可用的 Provider 设为默认后重试。')
        let model
        try {
          model = await llmService.getLanguageModel('janus', target.provider.id, target.modelId)
        } catch (error) {
          throw new Error(`圆桌 Agent 模型创建失败 (${target.provider.id}/${target.modelId})：${error instanceof Error ? error.message : String(error)}`)
        }
          const roleInstruction = participant.role === 'refiner'
            ? 'Propose a concrete improvement and implementation path. Read the shared pool first and treat the tracked user requirement as the base. Reference pool ids (e.g. [pool-req-...]) when building on them. Output deltas only: limited new points plus implementation details plus boundary cases; never restate pool content. Put member questions under a trailing "Questions:" section, one per line.'
            : participant.role === 'challenger'
              ? 'Identify gaps, risks, and assumptions that need validation. Read the shared pool plus this round refiner increment first. Output the Top risks with fixes or counter-questions; do not open competing proposals. Put questions under a trailing "Questions:" section, one per line.'
              : hostMode === 'intake'
                ? 'Acknowledge the new user requirement in one short paragraph: restate the demand as the tracked requirement and note what the pool will build on. Do not propose solutions yet. If the user supplement answers any open pool question, list each answered question under an "Answered:" section, quoting its text exactly.'
                : hostMode === 'merge'
                  ? 'Merge this round refiner increment into a short summary: start with the merged takeaway in one sentence, then list deduplicated points and open questions. Write deltas only, do not restate the shared pool.'
                  : 'Synthesize the discussion into a concise host summary. Start with a one-sentence conclusion, then list open points.'
          // Tool budget: vague inputs make models burn every step on tool
          // calls and never write prose, which used to surface as an empty
          // result failure. Cap exploration so text always gets written.
          // The model only ever sees what the prompt shows: previously the prompt
          // listed workspace NAME + PATH but never the ID, so the model guessed
          // (e.g. the name) and the schema-level refine turned the guess into a
          // fatal InvalidToolArgumentsError that killed the whole agent.
          // Fix: show exact ids in the prompt + tool descriptions, and validate
          // attachment inside execute (recoverable tool-result error the model
          // can retry from) instead of in the schema (fatal framework throw).
          const attachedIds = (workspaceResources ?? []).map((resource) => resource.workspaceId)
          // Narrowed once so tool closures keep a non-null executor without assertions.
          const toolExecutor = workspaceTools
          // The model keeps passing the workspace NAME (sometimes with stray
          // whitespace) instead of the id, and this SDK version has no
          // toolCallRepair: any schema rejection is fatal to the whole agent.
          // So the schema stays permissive and the id is normalized here —
          // trim, exact id, case-insensitive id/name, path suffix — before it
          // reaches the runtime. Only a truly unknown value falls through to
          // the runtime NOT_ATTACHED check (a recoverable tool-result error).
          const normalizeWorkspaceId = (raw: unknown): string => {
            const resources = workspaceResources ?? []
            const text = String(raw ?? '').trim()
            if (!text) return text
            if (resources.some((resource) => resource.workspaceId === text)) return text
            const lower = text.toLowerCase()
            const byId = resources.find((resource) => resource.workspaceId.toLowerCase() === lower)
            if (byId) return byId.workspaceId
            const byName = resources.find((resource) => resource.workspaceName.toLowerCase() === lower)
            if (byName) return byName.workspaceId
            const slash = (value: string) => value.replace(/\\/g, '/').toLowerCase()
            const byPath = resources.find((resource) => {
              const root = slash(resource.workspacePath)
              const candidate = slash(text)
              return root.endsWith(candidate) || candidate.endsWith(root)
            })
            if (byPath) return byPath.workspaceId
            return text
          }
          const bindWorkspaceTool = (executor: NonNullable<typeof workspaceTools>, name: 'workspace.list' | 'workspace.read' | 'workspace.readRange') =>
            (input: Record<string, unknown>) => executor.execute(name, { ...input, workspaceId: normalizeWorkspaceId(input.workspaceId) })
          const workspaceId = z.string().min(1).describe(
            attachedIds.length
              ? `Copy EXACTLY one of these workspace ids: ${attachedIds.join(', ')}. Never invent, shorten or derive an id from the name or path.`
              : 'No workspace is attached to this roundtable. Do not call workspace tools.',
          )
          const tools = toolExecutor && attachedIds.length ? {
            workspace_list: { description: 'List a bounded non-sensitive tree in an attached workspace.', parameters: z.object({ workspaceId, path: z.string().default(''), depth: z.number().int().min(0).max(4).default(2), maxEntries: z.number().int().min(1).max(1000).default(200) }), execute: bindWorkspaceTool(toolExecutor, 'workspace.list') },
            workspace_read: { description: 'Read a bounded UTF-8 file from an attached workspace and return its content and SHA-256.', parameters: z.object({ workspaceId, path: z.string().min(1), maxBytes: z.number().int().min(1).max(256 * 1024).default(128 * 1024) }), execute: bindWorkspaceTool(toolExecutor, 'workspace.read') },
            workspace_read_range: { description: 'Read a bounded byte range from a UTF-8 file in an attached workspace and return its content and SHA-256.', parameters: z.object({ workspaceId, path: z.string().min(1), offset: z.number().int().min(0), maxBytes: z.number().int().min(1).max(256 * 1024).default(64 * 1024) }), execute: bindWorkspaceTool(toolExecutor, 'workspace.readRange') },
          } : undefined
          const poolBlock = (priorFacts ?? []).slice(-30).map((fact) =>
            `[${fact.id} | ${fact.kind} | ${fact.status}] ${fact.title}: ${String(fact.content ?? '').slice(0, 200)}`,
          ).join('\n') || 'Pool is empty.'
          const promptMessages = [
            { role: 'system', content: `You are the ${participant.role} in a structured roundtable. ${roleInstruction} You may call workspace tools at most 2-3 times for file evidence; afterwards you MUST write your findings as markdown text in the same response. Never end your turn with only tool calls and no prose.` },
            { role: 'user', content: `Topic: ${userInput ?? 'Continue from shared state'}\nWorkspace resources (read-only; copy workspaceId EXACTLY when calling tools):\n${(workspaceResources ?? []).map((resource) => `- id: ${resource.workspaceId} name: ${resource.workspaceName} path: ${resource.workspacePath}`).join('\n') || 'None attached'}\nWorkspace evidence:\n${workspaceContext || 'No readable workspace evidence attached.'}\nShared pool (authoritative; cite ids, write deltas only):\n${poolBlock}\nPrior results:\n${priorCards.map((card) => card.summary ?? '').join('\n')}` },
          ]
          const result = await generateText({ model: model as any, maxSteps: 6, tools, messages: promptMessages as any }).catch((error) => {
            throw new Error(`圆桌 Agent 模型调用失败 (${participant.id}, ${target.provider.id}/${target.modelId})：${error instanceof Error ? error.message : String(error)}`)
          })
          let text = result.text?.trim()
          if (!text) {
            // The model spent all steps on tools without writing prose. Resume
            // once with tools disabled, carrying the step history so the tool
            // findings are not lost; the model only has to write them down.
            try {
              const followUp = await generateText({
                model: model as any,
                maxSteps: 1,
                messages: [...promptMessages, ...(result.response?.messages ?? []), { role: 'user', content: 'Write your findings now as concise markdown text. Do not call any more tools.' }] as any,
              })
              text = followUp.text?.trim()
            } catch (error) {
              throw new Error(`圆桌 Agent 补写结论失败 (${participant.id})：${error instanceof Error ? error.message : String(error)}`)
            }
          }
          if (!text) throw new Error(`圆桌 Agent 返回空结果 (${participant.id}, ${target.provider.id}/${target.modelId})：模型多次均未输出文本，请换个更具体的议题重试。`)
          return text
        },
    }]))
    const runtime = new RoundtableRuntime(agents, defaultRoundtableWorkflow, {
      ...(options?.toolTimeoutMs !== undefined ? { toolTimeoutMs: options.toolTimeoutMs } : {}),
      resolveWorkspace: async (workspaceId: string) => {
        const registered = await resolveRegisteredWorkspace(join(app.getPath('userData'), 'janusx', 'workspaces'), workspaceId)
        return { path: registered.path, name: registered.name }
      },
    })
    runtime.onEvent((event) => {
      void roundtableStore.append(event.sessionId, event, runtime.getState()); this.listeners.forEach((listener) => listener(event))
    })
    return runtime
  }

  advance(sessionId: string, input = '', requestId?: string): Promise<RoundtableState> { return this.require(sessionId).advance(input, requestId) }
  end(sessionId: string): RoundtableState { return this.require(sessionId).end() }
  getState(sessionId: string): RoundtableState | null { return this.sessions.get(sessionId)?.getState() ?? null }
  exportMarkdown(sessionId: string): string {
    return exportRoundtableMarkdown(this.require(sessionId).getState())
  }
  /**
   * Builds a native `harness-bundle/1` proposal from session facts without
   * touching `.agents/notes`. Only diagnostic-free bundles are persisted;
   * callers must refuse to apply anything else. `exportMarkdown` stays the
   * explicit meeting-log export and never becomes a note asset.
   */
  async buildBundle(
    sessionId: string,
    input: {
      factIds?: string[]
      repoId: string
      root?: string
      bundleId?: string
      revision?: number
      parentUri?: string
      excluded?: Array<{ factId: string; reason: string }>
    },
  ): Promise<{ bundle: ArtifactBundle; diagnostics: Array<{ code: string; message: string; path?: string }>; snapshotHash: string }> {
    const state = this.require(sessionId).getState()
    const missing = (input.factIds ?? []).filter((id) => !state.facts.some((fact) => fact.id === id))
    const diagnostics = missing.map((id) => ({ code: 'NOT_FOUND', message: `unknown fact ${id}`, path: 'factIds' }))
    const missingExcluded = (input.excluded ?? []).filter((e) => !state.facts.some((fact) => fact.id === e.factId))
    for (const e of missingExcluded) {
      diagnostics.push({ code: 'NOT_FOUND', message: `unknown fact ${e.factId}`, path: 'excluded' })
    }
    const facts = input.factIds ? state.facts.filter((fact) => input.factIds!.includes(fact.id)) : state.facts
    const excludedById = new Map((input.excluded ?? []).map((e) => [e.factId, e.reason]))
    const built = buildArtifactBundle({
      authoring: input.root ? await noteAuthoringContext(harnessNoteService, input.root, input.parentUri, input.repoId) : undefined,
      sessionId,
      roundNumber: state.roundNumber,
      repoId: input.repoId,
      bundleId: input.bundleId,
      revision: input.revision,
      items: facts.map((fact) => {
        const reason = excludedById.get(fact.id)
        if (reason !== undefined) return { fact, exclude: { reason } }
        return { fact, parentUri: input.parentUri }
      }),
    })
    const all = [...diagnostics, ...built.diagnostics]
    const snapshotHash = snapshotSourceFacts(facts, sessionId, state.roundNumber)
    if (all.length === 0 && input.bundleId !== undefined) {
      // Retry guard (C6): the same ids mean the same proposal. An identical
      // snapshot hands back the persisted bundle so retries keep operation
      // identities; moved sources demand a new revision, never an overwrite.
      const revision = input.revision ?? 1
      const saved = await roundtableStore.loadBundle(input.bundleId, revision)
      const verdict = resolveBundleRetry(
        saved === null ? null : (saved as { snapshotHash?: unknown }).snapshotHash,
        built.bundle.snapshotHash,
      )
      if (verdict === 'reuse-saved') {
        return { bundle: saved as unknown as ArtifactBundle, diagnostics: [], snapshotHash }
      }
      if (verdict === 'stale') {
        return { bundle: built.bundle, diagnostics: [staleSnapshotDiagnostic(revision)], snapshotHash }
      }
    }
    if (all.length === 0) await roundtableStore.saveBundle(built.bundle)
    return { bundle: built.bundle, diagnostics: all, snapshotHash }
  }
  /**
   * Applies a previously built bundle to a checkout root. The bundle keeps
   * its own changeset identity, so retrying the same bundle never duplicates
   * notes; partial success reports per-operation results for targeted retry.
   */
  async applyBundle(
    root: string,
    bundle: ArtifactBundle,
    reason: string,
  ): Promise<{ txId: string; applied: Array<{ operationId: string; relPath?: string }> }> {
    const problems = [
      ...validateBundle({ schema: bundle.schema, revision: bundle.revision, artifacts: bundle.artifacts }),
      ...validateChangeSet(bundle.changeSet),
    ]
    if (problems.length > 0) {
      throw { code: problems[0].code, message: problems[0].message, path: problems[0].path }
    }
    return harnessNoteService.applyBundleChangeSet(root, bundle.changeSet, reason)
  }
  async restore(sessionId: string): Promise<RoundtableState | null> {
    const saved = await roundtableStore.load(sessionId)
    if (!saved) return null
    const runtime = this.createRuntime()
    // Old journal lines predate newer fields; a snapshot persisted mid-round
    // (crash/restart) is demoted to awaiting-user so the user can review and
    // advance instead of getting stuck in a running state nobody owns.
    runtime.hydrate(markInterrupted(migrateRoundtableState(saved.state)))
    this.sessions.set(sessionId, runtime)
    return runtime.getState()
  }
  private require(sessionId: string): RoundtableRuntime {
    const runtime = this.sessions.get(sessionId)
    if (!runtime) throw new Error(`Unknown roundtable session: ${sessionId}`)
    return runtime
  }
}

export const roundtableService = new RoundtableService()
