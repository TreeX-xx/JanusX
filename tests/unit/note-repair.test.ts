import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { SUPPORTED_HARNESS_PROFILE } from '@janus-agent/harness-node'
import { runChatTurn, type ChatTurnPorts } from '@janus-agent/janus-agent'
import { HarnessNoteService } from '../../src/main/harness/service'
import { NoteChatEditor } from '../../src/main/harness/note-chat'
import { ReviewStore } from '../../plugins/blueprint/src/main/blueprint/suggestions/store'
import { SuggestionService } from '../../plugins/blueprint/src/main/blueprint/suggestions/service'
import { WorkspaceSuggestionSources } from '../../plugins/blueprint/src/main/blueprint/suggestions/sources'
import { WorkspaceSuggestions } from '../../plugins/blueprint/src/main/blueprint/suggestions/workspace-service'
import { NoteRepairService } from '../../plugins/blueprint/src/main/blueprint/review/note-repair'
import { attachNoteRepairTools } from '../../plugins/blueprint/src/main/blueprint/review/note-repair-tools'
import { runNoteRepairTurn } from '../../plugins/blueprint/src/main/blueprint/review/note-repair-turn'
import { NoteReviewEngine } from '../../plugins/blueprint/src/main/blueprint/review/engine'
import { DEFAULT_BLUEPRINT_REVIEW_SETTINGS } from '../../plugins/blueprint/src/shared/blueprint-review-settings'
import { reviewStructure } from '../../plugins/blueprint/src/main/blueprint/review/structure'
import { reviewResultSchema } from '../../plugins/blueprint/src/shared/blueprint-review'
import type { NoteRepairInput, NoteRepairPlan } from '../../plugins/blueprint/src/shared/note-repair'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })
const sha = (text: string) => createHash('sha256').update(text).digest('hex')
async function fixture(useEngine = false) {
  const root = await mkdtemp(join(tmpdir(), 'note-repair-'))
  await mkdir(join(root, '.agents/notes'), { recursive: true })
  const repoId = randomUUID(), moduleId = randomUUID()
  await writeFile(join(root, '.agents/harness.json'), JSON.stringify({ schemaVersion: 1, repoId, name: 'Repair', profile: SUPPORTED_HARNESS_PROFILE }))
  await writeFile(join(root, '.agents/notes/module.md'), '---\n' + JSON.stringify({ schema: 'harness-note/2', id: moduleId, kind: 'module', lifecycle: 'accepted', created: '2026-10-10', updated: '2026-10-10T00:00:00Z', moduleState: 'partial', role: 'project' }, null, 2) + '\n---\n# Repair\n## Responsibility\nRepair fixtures.\n## Design\nOne selected Note.\n')
  const notes = new HarnessNoteService(), editor = new NoteChatEditor(notes), signal = new AbortController().signal
  const created = await editor.write(root, 'fixture', 'create', { reason: 'Fixture', operations: [{ type: 'create', kind: 'requirement', module: 'note://' + repoId + '/' + moduleId, title: 'Repair target', sections: { 'Expected behavior': 'original '.repeat(150), 'Acceptance criteria': '- [ ] AC-1: Keep source.' } }] }, true, signal)
  const read = await editor.read(root, created!.files[0].uri), id = read.uri.split('/').pop()!
  const sources = new WorkspaceSuggestionSources(notes), context = await sources.context(root)
  const store = new ReviewStore(join(root, 'reviews.db')), suggestions = new WorkspaceSuggestions(new SuggestionService(store), sources)
  cleanups.push(async () => { notes.unwatchAll(); store.close(); await rm(root, { recursive: true, force: true }) })
  const findings = ['Selected issue', 'Unselected issue'].map(summary => ({ id: randomUUID(), summary, explanation: summary, suggestion: 'Add recovery details.', category: 'omission' as const, verification: 'not-configured' as const, citations: [{ path: read.path, quote: 'original' }] }))
  const ticket = await suggestions.begin(context, id)
  await suggestions.publish(context, id, ticket.id, reviewResultSchema.parse({ findings, coverage: 'complete', limitations: [] }))
  const item = (await suggestions.read(context)).items.find(item => item.noteId === id)!
  let result: 'resolve' | 'empty' | 'incomplete' | 'fail' | 'restored' = 'resolve'
  let reviews = 0, actualContext = context
  const engine = new NoteReviewEngine(suggestions, sources, { generate: async (_settings, input, evidence) => {
    const content = await evidence.read(input.target.path)
    expect(JSON.stringify(content)).toContain('Recovery documented')
    return { findings: [], coverage: 'complete', limitations: [], resolvedFindings: findings.map(finding => ({ id: finding.id, reason: 'Recovery documented.', citations: [{ path: read.path, quote: 'Recovery documented' }] })) }
  }, verify: async () => ({ score: 1, model: 'test', question: 'Current source resolves the issue' }) })
  const settings = { ...structuredClone(DEFAULT_BLUEPRINT_REVIEW_SETTINGS), generation: { providerId: 'test', modelId: 'test' }, jev: { ...DEFAULT_BLUEPRINT_REVIEW_SETTINGS.jev, enabled: true } }
  const observations: Array<{ noteId: string; path: string; hash: string }> = []
  const service = new NoteRepairService(join(root, 'repair-receipts'), { notes, suggestions, context: async () => actualContext,
    written: (_context, noteId, path, hash) => { observations.push({ noteId, path, hash }) },
    review: async (_root, noteId, reviewSignal) => {
      reviews++; reviewSignal.throwIfAborted()
      if (useEngine) return engine.review(context, noteId, settings, reviewSignal)
      const ticket = await suggestions.begin(context, noteId)
      if (result === 'fail') { await suggestions.fail(context, noteId, ticket.id, 'Review unavailable'); throw new Error('Review unavailable') }
      await suggestions.publish(context, noteId, ticket.id, reviewResultSchema.parse({ findings: result === 'restored' ? [findings[0]] : [], coverage: result === 'incomplete' ? 'insufficient' : 'complete', limitations: result === 'incomplete' ? ['Missing evidence'] : [], resolvedFindings: result === 'resolve' ? [{ id: findings[0].id, reason: 'Recovery documented.', citations: [{ path: read.path, quote: 'Recovery documented' }] }] : [] }), reviewSignal)
      return (await suggestions.read(context)).items.find(item => item.noteId === noteId)!
    } })
  const input: NoteRepairInput = { context, intent: 'repair', kind: 'suggestions', noteId: id, reportRevision: item.reportRevision, findingIds: [findings[0].id] }
  const prepare = async (next = input) => { const plan = await service.prepare(next); await service.claim(plan.id, 'chat', [root]); return plan }
  const readAll = async (id: string) => { let offset = 0, text = '', expectedHash = ''; do { const page = await service.read(id, { offset, maxChars: 500 }); text += page.markdown; expectedHash = page.expectedHash; offset = page.nextOffset ?? 0 } while (offset); return { markdown: text, expectedHash } }
  const write = async (id: string) => { const page = await readAll(id); return service.write(id, { ...page, markdown: page.markdown + '\nRecovery documented.\n', reason: 'Fix selected issue' }, signal) }
  return { root, notes, context, read, findings, suggestions, input, service, signal, prepare, readAll, write, observations, reviews: () => reviews, mode: (next: typeof result) => { result = next }, branch: () => { actualContext = { ...context, branch: 'other' } } }
}

function repairRunner(f: Awaited<ReturnType<typeof fixture>>, plan: NoteRepairPlan, streamTextFn: ChatTurnPorts['streamTextFn'], signal = f.signal) {
  const ports: ChatTurnPorts = { model: { resolve: async () => ({ model: {}, modelId: 'fixture' }), getMaxTurns: async () => 8 },
    sessions: { getSession: () => ({ sessionId: 'session', workspaceId: 'ws', workspaceRoot: f.root, status: 'running' }) },
    tools: { registry: { list: () => [] }, executeFunctionCall: async () => { throw new Error('Unexpected tool') } }, streamTextFn }
  const allowed = attachNoteRepairTools(ports, { service: f.service, plan, signal,
    resources: [{ agentSessionId: 'session', workspaceId: 'ws', workspacePath: f.root }], phase: () => {} })
  const run = () => runNoteRepairTurn(f.service, plan.id, { requestId: 'repair-recovery', sourceTag: 'maintenance', providerId: 'fixture',
    systemPromptPrefix: f.service.prompt(plan.id), messages: [{ role: 'user', content: 'Please fix all selected Note issues.' }],
    workspaceResources: [{ agentSessionId: 'session', workspaceId: 'ws', workspacePath: f.root, workspaceName: 'Fixture' }], toolAllowlist: allowed,
  }, ports, {}, signal)
  return { ports, run }
}

describe('bounded Note repair', () => {
  it('continues after analysis-only completion, preserves read evidence and writes before review', async () => {
    const f = await fixture(true), plan = await f.prepare({ ...f.input, findingIds: f.findings.map(finding => finding.id) } as NoteRepairInput)
    let rounds = 0
    const runner = repairRunner(f, plan, async options => {
      const step = rounds++
      if (step === 2) {
        expect(JSON.stringify(options.messages)).toContain('no changed source has been written')
        expect(JSON.stringify(options.messages)).toContain(sha(f.read.markdown))
        expect(JSON.stringify(options.messages)).toContain('original')
      }
      return { textStream: (async function* () { if (step === 1) yield 'The Note needs recovery details.'; if (step === 3) yield 'Submitted.' })(),
        toolCalls: Promise.resolve(step === 0 ? [{ toolCallId: 'read', toolName: 'note_repair_read', args: {} }]
          : step === 2 ? [{ toolCallId: 'write', toolName: 'note_repair_write', args: { expectedHash: sha(f.read.markdown), markdown: f.read.markdown + '\nRecovery documented.\n', reason: 'Apply the authorized correction' } }] : []) }
    })
    const originalTools = runner.ports.tools
    const result = await runner.run()
    expect(rounds).toBe(4); expect(result.toolTraces.map(trace => trace.toolName)).toEqual(['note.repair_read', 'note.repair_write'])
    expect(runner.ports.tools).toBe(originalTools)
    expect(await f.service.finish(plan.id, f.signal)).toMatchObject({ phase: 'resolved', changed: true, remaining: 0 })
    const status = JSON.parse(await readFile(join(f.root, 'repair-receipts', plan.id + '.status.json'), 'utf8'))
    expect(status.execution).toMatchObject({ attempts: 2, tools: [{ toolName: 'note.repair_read', status: 'completed' }, { toolName: 'note.repair_write', status: 'completed' }] })
  })
  it('continues a partial read, then accepts identical source for independent zero-change review', async () => {
    const f = await fixture(), plan = await f.prepare()
    f.mode('empty')
    let rounds = 0
    const runner = repairRunner(f, plan, async options => {
      const step = rounds++
      if (step === 2) expect(JSON.stringify(options.messages)).toContain('from offset 500')
      if (step === 5) expect(JSON.stringify(options.messages)).toContain('identical to the original')
      return { textStream: (async function* () { if ([1, 4, 6].includes(step)) yield 'Analysis.' })(),
        toolCalls: Promise.resolve(step === 0 ? [{ toolCallId: 'first-page', toolName: 'note_repair_read', args: { maxChars: 500 } }]
          : step === 2 ? [{ toolCallId: 'rest', toolName: 'note_repair_read', args: { offset: 500 } }]
            : step === 3 ? [{ toolCallId: 'identical', toolName: 'note_repair_write', args: { expectedHash: sha(f.read.markdown), markdown: f.read.markdown, reason: 'No correction submitted' } }]
              : step === 5 ? [{ toolCallId: 'corrected', toolName: 'note_repair_write', args: { expectedHash: sha(f.read.markdown), markdown: f.read.markdown + '\nRecovery documented.\n', reason: 'Correct recovery description' } }] : []) }
    })
    await runner.run()
    expect(rounds).toBe(5)
    expect(await f.service.finish(plan.id, f.signal)).toMatchObject({ changed: false, phase: 'resolved', remaining: 0 })
    expect(await readFile(join(f.root, f.read.path), 'utf8')).toBe(f.read.markdown)
    expect(f.reviews()).toBe(1)
  })
  it('stops with the concrete reported blocker and retains the original Note and suggestions', async () => {
    const f = await fixture(), plan = await f.prepare()
    let rounds = 0
    const runner = repairRunner(f, plan, async () => {
      const step = rounds++
      return { textStream: (async function* () { if (step === 1) yield 'A decision is needed.' })(),
        toolCalls: Promise.resolve(step === 0 ? [{ toolCallId: 'blocker', toolName: 'note_repair_block', args: { reason: 'The owner must decide whether recovery preserves or resets the queue.' } }] : []) }
    })
    await runner.run(); expect(rounds).toBe(2)
    expect(await f.service.finish(plan.id, f.signal)).toMatchObject({ phase: 'unchanged', changed: false, error: expect.stringContaining('owner must decide') })
    expect(await readFile(join(f.root, f.read.path), 'utf8')).toBe(f.read.markdown); expect(f.reviews()).toBe(0)
    expect((await f.suggestions.read(f.context)).items.flatMap(item => item.report?.findings ?? [])).toHaveLength(2)
  })
  it('bounds repeated analysis-only completions and records why nothing was written', async () => {
    const f = await fixture(), plan = await f.prepare()
    let rounds = 0
    const runner = repairRunner(f, plan, async () => {
      rounds++
      return { textStream: (async function* () { yield 'Only analysis.' })(), toolCalls: Promise.resolve([]) }
    })
    await runner.run(); expect(rounds).toBe(3)
    expect(await f.service.finish(plan.id, f.signal)).toMatchObject({ phase: 'unchanged', error: expect.stringContaining('原文未完整读取') })
    const status = JSON.parse(await readFile(join(f.root, 'repair-receipts', plan.id + '.status.json'), 'utf8'))
    expect(status).toMatchObject({ readChars: 0, execution: { attempts: 3, message: expect.stringContaining('Only analysis.'), tools: [] } })
    expect(f.reviews()).toBe(0)
  })
  it('does not continue read-only discussion or an aborted repair', async () => {
    const f = await fixture(), plan = await f.prepare({ ...f.input, intent: 'discuss' })
    let rounds = 0
    const discussion = repairRunner(f, plan, async options => {
      rounds++
      expect(Object.keys(options.tools as object)).not.toContain('note_repair_block')
      expect(Object.keys(options.tools as object)).not.toContain('note_repair_write')
      return { textStream: (async function* () { yield 'Discussion.' })(), toolCalls: Promise.resolve([]) }
    })
    await discussion.run(); expect(rounds).toBe(1)
    expect(await f.service.finish(plan.id, f.signal)).toMatchObject({ phase: 'discussed' })
    const repair = await f.prepare(), controller = new AbortController()
    const aborted = repairRunner(f, repair, async () => { controller.abort(); return { textStream: (async function* () {})(), toolCalls: Promise.resolve([]) } }, controller.signal)
    const original = aborted.ports.tools
    expect(await aborted.run()).toMatchObject({ cancelled: true })
    expect(aborted.ports.tools).toBe(original)
    expect(await f.service.fail(repair.id, '', true)).toMatchObject({ phase: 'cancelled', changed: false })
  })
  it('preserves tool evidence and releases the wrapper when the model stream fails', async () => {
    const f = await fixture(), plan = await f.prepare()
    let rounds = 0
    const runner = repairRunner(f, plan, async () => {
      if (rounds++ > 0) throw new Error('Provider stream failed')
      return { textStream: (async function* () {})(), toolCalls: Promise.resolve([{ toolCallId: 'read', toolName: 'note_repair_read', args: {} }]) }
    })
    const original = runner.ports.tools
    await expect(runner.run()).rejects.toThrow('Provider stream failed')
    expect(rounds).toBe(2); expect(runner.ports.tools).toBe(original)
    expect(await f.service.fail(plan.id, 'Provider stream failed')).toMatchObject({ phase: 'failed', changed: false })
    const status = JSON.parse(await readFile(join(f.root, 'repair-receipts', plan.id + '.status.json'), 'utf8'))
    expect(status.execution.tools).toEqual([expect.objectContaining({ toolName: 'note.repair_read', status: 'completed' })])
  })
  it('closes the complete facade-write-engine-publish-snapshot chain on actual files', async () => {
    const f = await fixture(true)
    const plan = await f.prepare({ ...f.input, findingIds: f.findings.map(finding => finding.id) } as NoteRepairInput)
    let turn = 0
    const ports: ChatTurnPorts = { model: { resolve: async () => ({ model: {}, modelId: 'test' }), getMaxTurns: async () => 4 },
      sessions: { getSession: () => ({ sessionId: 'session', workspaceId: 'ws', workspaceRoot: f.root, status: 'running' }) },
      tools: { registry: { list: () => [] }, executeFunctionCall: async () => { throw new Error('Unexpected tool') } },
      streamTextFn: async () => {
        const step = turn++
        const page = step === 1 ? await f.readAll(plan.id) : undefined
        return { textStream: (async function* () { if (step === 2) yield 'Submitted for host review.' })(), toolCalls: Promise.resolve(step === 0 ? [{ toolCallId: 'read', toolName: 'note_repair_read', args: {} }] : step === 1 ? [{ toolCallId: 'write', toolName: 'note_repair_write', args: { expectedHash: page!.expectedHash, markdown: page!.markdown + '\nRecovery documented.\n', reason: 'Repair all current issues' } }] : []) }
      } }
    const allowed = attachNoteRepairTools(ports, { service: f.service, plan, signal: f.signal, resources: [{ agentSessionId: 'session', workspaceId: 'ws', workspacePath: f.root }], phase: () => {} })
    await runChatTurn({ requestId: 'repair-chain', sourceTag: 'maintenance', providerId: 'test', messages: [{ role: 'user', content: 'Fix all issues' }], workspaceResources: [{ agentSessionId: 'session', workspaceId: 'ws', workspacePath: f.root, workspaceName: 'Test' }], toolAllowlist: allowed }, ports, {}, f.signal)
    const update = await f.service.finish(plan.id, f.signal)
    expect(update).toMatchObject({ phase: 'resolved', changed: true, resolved: 2, remaining: 0 })
    const after = await readFile(join(f.root, f.read.path), 'utf8')
    expect(sha(after)).toBe(update.afterHash)
    expect(f.observations.at(-1)).toEqual({ noteId: plan.noteId, path: plan.path, hash: update.afterHash })
    expect((await f.suggestions.read(f.context)).items.find(item => item.noteId === plan.noteId)?.report?.findings).toHaveLength(0)
    expect((await f.notes.readSnapshot(f.root)).entries.find(entry => entry.relPath === f.read.path)?.sourceHash).toBe(update.afterHash)
    expect(JSON.parse(await readFile(join(f.root, 'repair-receipts', plan.id + '.status.json'), 'utf8')).update).toEqual(update)
  })
  it('records a no-write outcome without running review or removing suggestions', async () => {
    const f = await fixture(), plan = await f.prepare()
    const update = await f.service.finish(plan.id, f.signal)
    expect(update).toMatchObject({ phase: 'unchanged', changed: false, error: expect.stringContaining('未写入') })
    expect(f.reviews()).toBe(0)
    expect(await readFile(join(f.root, f.read.path), 'utf8')).toBe(f.read.markdown)
    expect((await f.suggestions.read(f.context)).items.flatMap(item => item.report?.findings ?? [])).toHaveLength(2)
    expect(JSON.parse(await readFile(join(f.root, 'repair-receipts', plan.id + '.status.json'), 'utf8')).update).toEqual(update)
  })
  it('treats an updated-timestamp-only submission as zero-change review and preserves original bytes', async () => {
    const f = await fixture(), plan = await f.prepare(), page = await f.readAll(plan.id); f.mode('empty')
    const priorUpdated = JSON.parse(page.markdown.split('---')[1]).updated
    const updated = new Date(Date.parse(priorUpdated) + 1000).toISOString()
    const markdown = page.markdown.replace(/"updated": "[^"]+"/, '"updated": "' + updated + '"')
    expect(await f.service.write(plan.id, { ...page, markdown, reason: 'Already correct' }, f.signal)).toMatchObject({ status: 'unchanged' })
    expect(await f.service.continuation(plan.id)).toBeUndefined()
    expect(await f.service.finish(plan.id, f.signal)).toMatchObject({ phase: 'resolved', changed: false, remaining: 0 })
    expect(await readFile(join(f.root, f.read.path), 'utf8')).toBe(f.read.markdown)
  })
  it('still closes the repair when its status record cannot be saved', async () => {
    const f = await fixture(), plan = await f.prepare()
    await writeFile(join(f.root, 'repair-receipts'), 'This path is a file')
    expect(await f.service.finish(plan.id, f.signal)).toMatchObject({ phase: 'unchanged', recordError: expect.stringContaining('记录保存失败') })
    expect(await f.service.fail(plan.id, 'Original failure')).toMatchObject({ phase: 'failed', error: 'Original failure', recordError: expect.stringContaining('记录保存失败') })
  })
  it('records the actual rejected write reason even when the model finishes normally', async () => {
    const f = await fixture(), plan = await f.prepare()
    const ports: ChatTurnPorts = { model: {} as never, sessions: { getSession: () => ({ sessionId: 'session', workspaceId: 'ws', workspaceRoot: f.root, status: 'running' }) }, tools: { registry: { list: () => [] }, executeFunctionCall: async () => { throw new Error('Unexpected') } } }
    attachNoteRepairTools(ports, { service: f.service, plan, signal: f.signal, resources: [{ agentSessionId: 'session', workspaceId: 'ws', workspacePath: f.root }], phase: () => {} })
    const result = await ports.tools.executeFunctionCall({ sessionId: 'session', call: { toolName: 'note.repair_write', input: { markdown: f.read.markdown, expectedHash: sha(f.read.markdown), reason: 'Missing full read' } } } as never, 'test')
    expect(result.status).toBe('failed')
    expect(await f.service.finish(plan.id, f.signal)).toMatchObject({ phase: 'unchanged', error: expect.stringContaining('完整读取') })
    expect(f.reviews()).toBe(0)
  })
  it('writes real source, retires the entire old set, then replaces it with independent review results', async () => {
    const f = await fixture(), plan = await f.prepare()
    await f.write(plan.id)
    const pending = (await f.suggestions.read(f.context)).items.find(item => item.noteId === plan.noteId)!
    expect(pending.report).toBeNull(); expect(pending.awaitingReview).toBeDefined()
    expect(await f.service.finish(plan.id, f.signal)).toMatchObject({ phase: 'resolved', changed: true, resolved: 1, remaining: 0, changes: { added: 2, removed: 0 } })
    const current = (await f.suggestions.read(f.context)).items.find(item => item.noteId === plan.noteId)!
    expect(current.report!.findings).toEqual([]); expect(current.awaitingReview).toBeUndefined()
    const diff = await f.service.diff(plan.id)
    expect(diff.before).toBe(f.read.markdown); expect(diff.after).toContain('Recovery documented')
    f.mode('restored'); expect(await f.service.undo(plan.id)).toMatchObject({ phase: 'reverted' })
    expect(f.observations.at(-1)?.hash).toBe(sha(await readFile(join(f.root, f.read.path), 'utf8')))
    expect((await f.suggestions.read(f.context)).items.flatMap(item => item.report?.findings ?? []).map(finding => finding.id)).toEqual([f.findings[0].id])
    expect(await readFile(join(f.root, f.read.path), 'utf8')).toBe(f.read.markdown)
    expect((await f.service.diff(plan.id)).reverted).toBe(true)
  })
  it.each(['empty', 'incomplete', 'fail'] as const)('distinguishes a %s review after retiring old findings', async mode => {
    const f = await fixture(), plan = await f.prepare(); f.mode(mode); await f.write(plan.id)
    if (mode === 'empty') expect(await f.service.finish(plan.id, f.signal)).toMatchObject({ phase: 'resolved', remaining: 0 })
    else expect(await f.service.finish(plan.id, f.signal)).toMatchObject({ phase: 'review-incomplete', changed: true, error: expect.any(String) })
    const item = (await f.suggestions.read(f.context)).items.find(item => item.noteId === plan.noteId)!
    expect(item.report?.findings ?? []).toEqual([])
    expect(Boolean(item.awaitingReview)).toBe(mode !== 'empty')
  })
  it('retries only review after failure, preserves bytes and refuses changed source or branch', async () => {
    const f = await fixture(), plan = await f.prepare(); f.mode('fail'); await f.write(plan.id)
    expect((await f.service.finish(plan.id, f.signal)).phase).toBe('review-incomplete')
    const before = await readFile(join(f.root, f.read.path), 'utf8')
    f.mode('empty')
    expect(await f.service.retryReview(plan.id)).toMatchObject({ phase: 'resolved', remaining: 0 })
    expect(f.reviews()).toBe(2)
    expect(await readFile(join(f.root, f.read.path), 'utf8')).toBe(before)
    await writeFile(join(f.root, f.read.path), before + '\nAnother edit.\n')
    await expect(f.service.retryReview(plan.id)).rejects.toThrow('再次变化')
    f.branch(); await expect(f.service.retryReview(plan.id)).rejects.toThrow('分支')
  })
  it('rejects stale selection, wrong root, duplicate claims and branch changes', async () => {
    const f = await fixture()
    await expect(f.service.prepare({ ...f.input, reportRevision: 0 } as NoteRepairInput)).rejects.toThrow('建议已更新')
    const a = await f.service.prepare(f.input), b = await f.service.prepare(f.input)
    await expect(f.service.claim(a.id, 'wrong', ['C:/other'])).rejects.toThrow('工作区')
    await f.service.claim(a.id, 'chat', [f.root])
    await expect(f.service.claim(b.id, 'other', [f.root])).rejects.toThrow('正在修复')
    f.branch(); await expect(f.service.read(a.id, {})).rejects.toThrow('分支')
  })
  it('requires all pages, preserves identity, and prevents source or undo conflicts', async () => {
    const f = await fixture(), plan = await f.prepare()
    const first = await f.service.read(plan.id, { maxChars: 500 })
    await expect(f.service.write(plan.id, { markdown: f.read.markdown, expectedHash: first.expectedHash, reason: 'Partial read' }, f.signal)).rejects.toThrow('完整读取')
    const page = await f.readAll(plan.id)
    await expect(f.service.write(plan.id, { ...page, markdown: page.markdown.replace(f.input.kind === 'suggestions' ? f.input.noteId : '', randomUUID()), reason: 'Identity' }, f.signal)).rejects.toThrow('身份')
    await f.write(plan.id); await f.service.fail(plan.id, 'Stopped')
    await writeFile(join(f.root, f.read.path), 'External edit')
    await expect(f.service.undo(plan.id)).rejects.toThrow()
    expect(await readFile(join(f.root, f.read.path), 'utf8')).toBe('External edit')
  })
  it('discussion cannot write or trigger review; cancellation truthfully tracks writes', async () => {
    const f = await fixture(), plan = await f.prepare({ ...f.input, intent: 'discuss' })
    const page = await f.readAll(plan.id)
    await expect(f.service.write(plan.id, { ...page, reason: 'Discuss' }, f.signal)).rejects.toThrow('讨论')
    expect(await f.service.finish(plan.id, f.signal)).toMatchObject({ phase: 'discussed' }); expect(f.reviews()).toBe(0)
    const repair = await f.prepare(); await f.write(repair.id)
    expect(await f.service.fail(repair.id, '', true)).toMatchObject({ phase: 'cancelled', changed: true })
  })
  it('repairs malformed JSON with salvageable identity and validates before touching bytes', async () => {
    const f = await fixture(), broken = f.read.markdown.replace('"schema":', '"schema" ')
    await writeFile(join(f.root, f.read.path), broken); await f.notes.rescan(f.root)
    const issues = reviewStructure(await f.notes.readSnapshot(f.root)).issues.filter(issue => issue.path === f.read.path)
    expect(issues.length).toBeGreaterThan(0)
    const plan = await f.prepare({ context: f.context, kind: 'structure', intent: 'repair', path: f.read.path, hash: sha(broken) })
    const page = await f.readAll(plan.id)
    await expect(f.service.write(plan.id, { ...page, markdown: broken, reason: 'Still broken' }, f.signal)).rejects.toThrow()
    expect(await readFile(join(f.root, f.read.path), 'utf8')).toBe(broken)
    await f.service.write(plan.id, { ...page, markdown: f.read.markdown, reason: 'Fix JSON delimiter' }, f.signal)
    expect(await f.service.finish(plan.id, f.signal)).toMatchObject({ phase: 'resolved', changed: true })
    await f.service.undo(plan.id); expect(await readFile(join(f.root, f.read.path), 'utf8')).toBe(broken)
  })
  it('blocks a malformed file without a unique recoverable Note identity', async () => {
    const f = await fixture(), broken = f.read.markdown.replace(/"id": "[^"]+"/, '"id": "unknown"').replace('"schema":', '"schema" ')
    await writeFile(join(f.root, f.read.path), broken); await f.notes.rescan(f.root)
    await expect(f.service.prepare({ context: f.context, kind: 'structure', intent: 'repair', path: f.read.path, hash: sha(broken) })).rejects.toThrow('身份')
  })
  it('binds all selected findings and reports complete clearance without inherited old issues', async () => {
    const f = await fixture(), plan = await f.prepare({ ...f.input, kind: 'suggestions', noteId: f.input.kind === 'suggestions' ? f.input.noteId : '', reportRevision: f.input.kind === 'suggestions' ? f.input.reportRevision : 0, findingIds: f.findings.map(finding => finding.id) })
    expect(plan.summaries).toHaveLength(2); await f.write(plan.id)
    expect(await f.service.finish(plan.id, f.signal)).toMatchObject({ phase: 'resolved', resolved: 2, remaining: 0 })
  })
  it('refuses an external change between read and write without overwriting it', async () => {
    const f = await fixture(), plan = await f.prepare(), page = await f.readAll(plan.id)
    const external = f.read.markdown + '\nExternal edit.\n'; await writeFile(join(f.root, f.read.path), external)
    await expect(f.service.write(plan.id, { ...page, markdown: f.read.markdown + '\nRepair.\n', reason: 'Fix' }, f.signal)).rejects.toThrow('其他操作')
    expect(await readFile(join(f.root, f.read.path), 'utf8')).toBe(external)
    expect(await f.service.fail(plan.id, '', true)).toMatchObject({ changed: false })
  })
  it('stops before a write and reports failed undo verification separately from the successful rollback', async () => {
    const f = await fixture(), plan = await f.prepare(), page = await f.readAll(plan.id), controller = new AbortController(); controller.abort()
    await expect(f.service.write(plan.id, { ...page, markdown: page.markdown + '\nRecovery documented.\n', reason: 'Cancelled' }, controller.signal)).rejects.toThrow()
    expect(await readFile(join(f.root, f.read.path), 'utf8')).toBe(f.read.markdown)
    await f.write(plan.id); await f.service.finish(plan.id, f.signal); f.mode('fail')
    expect(await f.service.undo(plan.id)).toMatchObject({ phase: 'reverted', error: expect.stringContaining('修改已撤销') })
    expect(await readFile(join(f.root, f.read.path), 'utf8')).toBe(f.read.markdown)
  })
  it('offers dedicated repair tools through the real facade and blocks general mutation', async () => {
    const f = await fixture(), plan = await f.prepare(), phases: string[] = []
    let turns = 0
    const ports: ChatTurnPorts = { model: { resolve: async () => ({ model: {}, modelId: 'fixture' }), getMaxTurns: async () => 3 },
      sessions: { getSession: () => ({ sessionId: 'session', workspaceId: 'ws', workspaceRoot: f.root, status: 'running' }) },
      tools: { registry: { list: () => [{ name: 'workspace.write', actionRisk: 'write', description: 'Write' }] }, executeFunctionCall: async () => { throw new Error('General mutation must not run') } },
      streamTextFn: async options => {
        expect(Object.keys(options.tools as object)).toContain('note_repair_read')
        expect(Object.keys(options.tools as object)).not.toContain('workspace_write')
        const first = turns++ === 0
        return { textStream: (async function* () { if (!first) yield 'Source read.' })(), toolCalls: Promise.resolve(first ? [{ toolCallId: 'read', toolName: 'note_repair_read', args: {} }] : []) }
      } }
    const allowed = attachNoteRepairTools(ports, { service: f.service, plan, signal: f.signal, resources: [{ agentSessionId: 'session', workspaceId: 'ws', workspacePath: f.root }], phase: phase => phases.push(phase) })
    const blocked = await ports.tools.executeFunctionCall({ sessionId: 'session', call: { toolName: 'workspace.write', input: { path: 'other' } } } as never, 'test')
    expect(blocked.status).toBe('failed')
    await runChatTurn({ sourceTag: 'maintenance', requestId: 'repair', providerId: 'fixture', messages: [{ role: 'user', content: 'Read source' }], workspaceResources: [{ agentSessionId: 'session', workspaceId: 'ws', workspacePath: f.root, workspaceName: 'Fixture' }], toolAllowlist: allowed }, ports, {}, f.signal)
    expect(phases).toContain('reading')
  })
})
