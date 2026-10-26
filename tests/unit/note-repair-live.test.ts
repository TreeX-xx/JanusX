// Opt in: real configured models, real tools/files/review, isolated synthetic repository.
import { it, expect, vi } from 'vitest'
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import { createAgentRuntime } from '@janus-agent/agent-core'
import { ManagedChatSession } from '@janus-agent/chat-core'
import type { ChatTurnPorts } from '@janus-agent/janus-agent'
import { SUPPORTED_HARNESS_PROFILE } from '@janus-agent/harness-node'
import { WorkspaceSuggestionSources } from '../../plugins/blueprint/src/main/blueprint/suggestions/sources'
import { WorkspaceSuggestions } from '../../plugins/blueprint/src/main/blueprint/suggestions/workspace-service'
import { ReviewStore } from '../../plugins/blueprint/src/main/blueprint/suggestions/store'
import { SuggestionService } from '../../plugins/blueprint/src/main/blueprint/suggestions/service'
import { NoteReviewEngine } from '../../plugins/blueprint/src/main/blueprint/review/engine'
import { blueprintReviewModels, reviewModelFailure } from '../../src/main/blueprint/review/models'
import { NoteRepairService } from '../../plugins/blueprint/src/main/blueprint/review/note-repair'
import { attachNoteRepairTools } from '../../plugins/blueprint/src/main/blueprint/review/note-repair-tools'
import { runNoteRepairTurn } from '../../plugins/blueprint/src/main/blueprint/review/note-repair-turn'
import { DEFAULT_BLUEPRINT_REVIEW_SETTINGS } from '../../plugins/blueprint/src/shared/blueprint-review-settings'
import { llmService } from '../../src/main/llm/LlmService'
import { buildJanusChatTurnPorts } from '../../src/main/llm/janus-agent-ports'
import { streamText } from '../../src/main/llm/ai-runtime'

const live = Boolean(process.env.NOTE_REPAIR_LIVE_CONFIG)
const host = await vi.hoisted(async () => {
  const { mkdtempSync, realpathSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  return { root: process.env.NOTE_REPAIR_LIVE_CONFIG ? mkdtempSync(join(realpathSync.native(tmpdir()), 'note-repair-live-')) : '', key: '' }
})
vi.mock('electron', () => ({ app: { getPath: () => host.root, setProxy: async () => {} }, session: { fromPartition: () => null, defaultSession: null }, safeStorage: { isEncryptionAvailable: () => false } }))
vi.mock('../../src/main/llm/jev-credentials', () => ({ getJevKey: async () => host.key || null }))

it.skipIf(!live)('real model repairs all Note issues, re-reviews actual bytes and closes suggestions', async () => {
  const root = join(host.root, 'repository'), noteId = randomUUID(), repoId = randomUUID()
  const path = '.agents/notes/module.md', signal = AbortSignal.timeout(600_000)
  let sources: WorkspaceSuggestionSources | undefined, store: ReviewStore | undefined
  const outcome: Record<string, unknown> = { testedAt: new Date().toISOString(), isolatedRepository: true }
  try {
    await mkdir(join(host.root, 'janusx'))
    await writeFile(join(host.root, 'janusx/llm-config.json'), await readFile(process.env.NOTE_REPAIR_LIVE_CONFIG!))
    const settings = structuredClone(DEFAULT_BLUEPRINT_REVIEW_SETTINGS)
    settings.generation = { providerId: process.env.NOTE_REPAIR_LIVE_PROVIDER!, modelId: process.env.NOTE_REPAIR_LIVE_MODEL! }
    if (process.env.NOTE_REPAIR_LIVE_JEV_CREDENTIAL) {
      outcome.stage = 'credential'
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
      const electron = createRequire(import.meta.url)('electron') as string
      const { stdout } = await promisify(execFile)(electron, ['tests/fixtures/read-review-credential.cjs', process.env.NOTE_REPAIR_LIVE_JEV_CREDENTIAL], { env, windowsHide: true, timeout: 15000 })
      host.key = JSON.parse(stdout).key
      settings.jev.enabled = true
    }
    outcome.providerId = settings.generation.providerId; outcome.modelId = settings.generation.modelId
    outcome.jev = settings.jev.enabled
    outcome.stage = 'fixture'
    await mkdir(join(root, '.agents/notes'), { recursive: true }); await mkdir(join(root, 'src'))
    await writeFile(join(root, '.agents/harness.json'), JSON.stringify({ schemaVersion: 1, repoId, name: 'Repair fixture', profile: SUPPORTED_HARNESS_PROFILE }))
    const before = '---\n' + JSON.stringify({ schema: 'harness-note/2', id: noteId, kind: 'module', role: 'project', lifecycle: 'accepted', moduleState: 'implemented', created: '2026-10-10', updated: '2026-10-10T00:00:00Z', codeRefs: [{ repoId, path: 'src/queue.ts', role: 'implementation' }] }, null, 2)
      + '\n---\n# Queue\n\n## Responsibility\n\nDescribe current process-local queue behavior.\n\n## Design\n\nThe current enqueue implementation persists every item to disk before returning. All queued items survive a process restart. reset removes queued items from disk. This persistence is implemented today.\n'
    const code = 'const queue: string[] = [];\nexport function enqueue(input: string) { queue.push(input) }\nexport function reset() { queue.length = 0 }\n'
    await writeFile(join(root, path), before); await writeFile(join(root, 'src/queue.ts'), code)
    sources = new WorkspaceSuggestionSources(); store = new ReviewStore(join(host.root, 'review.sqlite'))
    const suggestions = new WorkspaceSuggestions(new SuggestionService(store), sources)
    const engine = new NoteReviewEngine(suggestions, sources, blueprintReviewModels)
    const context = await sources.context(root)
    outcome.stage = 'initial-review'
    const initial = await engine.review(context, noteId, settings, signal)
    expect(initial.report?.coverage).toBe('complete')
    expect(initial.report?.findings.length).toBeGreaterThan(0)
    const repairs = new NoteRepairService(join(host.root, 'receipts'), { context: value => sources!.context(value), notes: sources.notes, suggestions,
      review: (_root, id, abort) => engine.review(context, id, settings, abort) })
    const plan = await repairs.prepare({ context, kind: 'suggestions', intent: 'repair', noteId, reportRevision: initial.reportRevision, findingIds: initial.report!.findings.map(f => f.id) })
    outcome.initialReport = initial.report
    const runtime = createAgentRuntime({ resolveWorkspaceRoot: async () => root })
    runtime.registry.register({ name: 'fixture.read_evidence', actionRisk: 'read', description: 'Read the current implementation at src/queue.ts.', inputSchema: { type: 'object', properties: {} }, execute: async () => ({ path: 'src/queue.ts', content: await readFile(join(root, 'src/queue.ts'), 'utf8') }) })
    const workspaceId = 'repair-fixture', callerId = 'repair-live'
    const session = await runtime.createSession({ workspaceId, workspaceRoot: root, approvalMode: 'auto-run', timeoutMs: 600_000 }, callerId)
    await repairs.claim(plan.id, 'isolated-repair', [root])
    const resource = { workspaceId, workspacePath: root, workspaceName: 'Synthetic repair fixture', agentSessionId: session.id }
    const model = await llmService.getLanguageModel('janus', settings.generation.providerId, settings.generation.modelId)
    const ports = buildJanusChatTurnPorts({ callerId,
      getProviderSettings: async () => ({ modelId: settings.generation.modelId }), getLanguageModel: async () => model,
      getMaxTurns: async () => 20, getAgentSession: id => runtime.getSession(id),
      executeFunctionCall: (input, caller) => runtime.executeFunctionCall(input, caller),
      listRegistryTools: () => runtime.registry.list(), listRegistryManifests: () => runtime.registry.listManifests(),
      streamTextFn: (options => streamText({ ...options, maxTokens: 12000, maxRetries: 0 } as never)) as ChatTurnPorts['streamTextFn'],
    })
    const phases: string[] = []
    const allowed = attachNoteRepairTools(ports, { service: repairs, plan, signal, resources: [resource], phase: phase => phases.push(phase) })
    try {
      outcome.stage = 'repair'
      const result = await runNoteRepairTurn(repairs, plan.id, { requestId: randomUUID(), sourceTag: 'janus-chat', providerId: settings.generation.providerId, modelId: settings.generation.modelId, callerId,
        systemPromptPrefix: repairs.prompt(plan.id), messages: [{ role: 'user', content: 'Repair all current suggestions in this Note. Read the code evidence, read the complete Note, then submit the corrected full Note through note.repair_write.' }],
        workspaceResources: [resource], toolAllowlist: allowed, chatSession: new ManagedChatSession(),
      }, ports, {}, signal)
      expect(result.cancelled).toBe(false)
      outcome.stage = 'verification'
      const update = await repairs.finish(plan.id, signal)
      outcome.update = update; outcome.phases = phases
      expect(update).toMatchObject({ changed: true, phase: 'resolved', remaining: 0 })
      const after = await readFile(join(root, path), 'utf8')
      expect(after).not.toBe(before)
      expect(createHash('sha256').update(after).digest('hex')).toBe(update.afterHash)
      expect(await readFile(join(root, 'src/queue.ts'), 'utf8')).toBe(code)
      const snapshot = await sources.notes.readSnapshot(root)
      expect(snapshot.entries.find(entry => entry.relPath === path)?.sourceHash).toBe(update.afterHash)
      expect((await suggestions.read(context)).items.find(item => item.noteId === noteId)?.report?.findings).toHaveLength(0)
      expect((await repairs.diff(plan.id)).after).toBe(after)
      outcome.status = 'passed'; outcome.before = before; outcome.after = after
      outcome.finalReport = (await suggestions.read(context)).items.find(item => item.noteId === noteId)?.report
    } finally { await runtime.cancelSession(session.id) }
  } catch (error) {
    outcome.status = 'failed'; outcome.error = reviewModelFailure(error).message
    const detail = error as { name?: string; code?: string; stderr?: string; message?: string }
    outcome.errorName = detail.name; outcome.errorCode = detail.code
    if (outcome.stage === 'credential') outcome.credentialFailure = detail.stderr?.slice(-500)
    throw new Error('Live repair validation failed; see sanitized artifacts/note-repair/live-result.json')
  } finally {
    sources?.notes.unwatchAll(); store?.close(); host.key = ''
    await mkdir('artifacts/note-repair', { recursive: true })
    await writeFile('artifacts/note-repair/live-result.json', JSON.stringify(outcome, null, 2))
    await rm(host.root, { recursive: true, force: true })
  }
}, 650_000)
