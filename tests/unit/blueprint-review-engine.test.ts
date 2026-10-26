import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { reviewStructure, assertNoteStructure } from '../../plugins/blueprint/src/main/blueprint/review/structure'
import { afterEach, expect, it, vi } from 'vitest'
import { SUPPORTED_HARNESS_PROFILE } from '@janus-agent/harness-node'
import { WorkspaceSuggestionSources } from '../../plugins/blueprint/src/main/blueprint/suggestions/sources'
import { WorkspaceSuggestions } from '../../plugins/blueprint/src/main/blueprint/suggestions/workspace-service'
import { ReviewStore } from '../../plugins/blueprint/src/main/blueprint/suggestions/store'
import { SuggestionService } from '../../plugins/blueprint/src/main/blueprint/suggestions/service'
import { NoteReviewEngine, type ReviewModelPort } from '../../plugins/blueprint/src/main/blueprint/review/engine'
import { collectReviewEvidence, ReviewEvidenceSession } from '../../plugins/blueprint/src/main/blueprint/review/evidence'
import { ReviewSettingsStore } from '../../plugins/blueprint/src/main/blueprint/review/settings'
import { DEFAULT_BLUEPRINT_REVIEW_SETTINGS } from '../../plugins/blueprint/src/shared/blueprint-review-settings'
import { registerSuggestionTools } from '../../plugins/blueprint/src/main/blueprint/suggestions/tools'

const roots: string[] = []
const stores: ReviewStore[] = []
const sources: WorkspaceSuggestionSources[] = []
const engines: NoteReviewEngine[] = []
afterEach(async () => { await Promise.all(engines.splice(0).map(engine => engine.shutdown())); sources.splice(0).forEach(source => source.notes.unwatchAll()); stores.splice(0).forEach(store => store.close()); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function setup(verify = false) {
  const root = await mkdtemp(join(tmpdir(), 'review-engine-')); roots.push(root)
  const repoId = randomUUID(), moduleId = randomUUID(), noteId = randomUUID()
  await mkdir(join(root, '.agents/notes'), { recursive: true })
  await mkdir(join(root, 'src'))
  await writeFile(join(root, '.agents/harness.json'), JSON.stringify({ schemaVersion: 1, repoId, name: 'Review fixture', profile: SUPPORTED_HARNESS_PROFILE }))
  const note = (id: string, kind: string, body: string) => '---\n' + JSON.stringify({ schema: 'harness-note/2', id, kind, lifecycle: 'accepted', created: '2026-10-10', updated: '2026-10-10T00:00:00Z',
    ...(kind === 'module' ? { moduleState: 'partial', role: 'project' } : { module: `note://${repoId}/${moduleId}` }), codeRefs: [{ repoId, path: 'src/queue.ts', role: 'implementation' }],
  }, null, 2) + '\n---\n\n# Fixture\n\n' + body
  await writeFile(join(root, '.agents/notes/module.md'), note(moduleId, 'module', '## Responsibility\n\nPersist user input.\n\n## Design\n\nA queue is planned.\n'))
  await writeFile(join(root, '.agents/notes/requirement.md'), note(noteId, 'requirement', '## Expected behavior\n\nPreserve input after restart. This requirement is not yet implemented.\n\n## Acceptance criteria\n\n- [ ] AC-1: Recover queued input.\n'))
  await writeFile(join(root, 'src/queue.ts'), 'export const queue = [] // Currently memory only\n')
  const source = new WorkspaceSuggestionSources(); sources.push(source)
  const context = await source.context(root)
  const store = new ReviewStore(join(root, 'review.sqlite')); stores.push(store)
  const workspace = new WorkspaceSuggestions(new SuggestionService(store), source)
  const finding = { id: randomUUID(), category: 'omission', summary: 'Persistence mechanism is unspecified', explanation: 'The planned persistence mechanism needs a recovery boundary.', suggestion: 'Describe the recovery boundary before implementing.',
    citations: [{ path: '.agents/notes/module.md', quote: 'A queue is planned.' }], verification: 'supported' }
  const generate = vi.fn(async (_settings, input, evidence) => {
    expect(input.materials).toHaveLength(0)
    await evidence.read('.agents/notes/requirement.md')
    expect((await evidence.paths('queue.ts')).items).toContain('src/queue.ts')
    expect((await evidence.search('memory only')).items.some(item => item.includes('src/queue.ts'))).toBe(true)
    await evidence.read('.agents/notes/module.md')
    await evidence.read('src/queue.ts')
    return { findings: [finding], coverage: 'complete', limitations: [], resolvedFindings: [] }
  })
  const verifyModel = vi.fn(async () => ({ score: 0.96, question: 'Is this issue supported by the original material?', model: 'jev-test' }))
  const models: ReviewModelPort = { generate, verify: verifyModel }
  const engine = new NoteReviewEngine(workspace, source, models)
  engines.push(engine)
  const settings = { ...structuredClone(DEFAULT_BLUEPRINT_REVIEW_SETTINGS), generation: { providerId: 'test', modelId: 'test-generation' } }
  settings.jev.enabled = verify
  const review = () => engine.review(context, noteId, settings, new AbortController().signal)
  return { root, noteId, source, context, workspace, settings, engine, generate, verifyModel, finding, review }
}

it('lets the model read the target and selected related evidence, records provenance, and never rewrites source', async () => {
  const f = await setup(); const file = join(f.root, '.agents/notes/requirement.md'); const before = await readFile(file)
  const result = await f.review()
  const input = f.generate.mock.calls[0][1]
  expect(input.materials.map(material => material.path)).toEqual(expect.arrayContaining(['.agents/notes/requirement.md', '.agents/notes/module.md', 'src/queue.ts']))
  expect(input.materials.find(material => material.path.endsWith('requirement.md'))?.content).toContain('not yet implemented')
  expect(result.report?.findings[0].verification).toBe('not-configured')
  expect(result.report?.provenance).toMatchObject({ providerId: 'test', modelId: 'test-generation' })
  expect(f.verifyModel).not.toHaveBeenCalled()
  expect(await readFile(file)).toEqual(before)
})

it('allows complete coverage with no suggestions when the agent reads the target and finds no issue', async () => {
  const f = await setup()
  f.generate.mockImplementationOnce(async (_settings, _input, evidence) => {
    await evidence.read('.agents/notes/requirement.md')
    await evidence.read('src/queue.ts')
    return { findings: [], coverage: 'complete', limitations: [], resolvedFindings: [] }
  })
  const result = await f.review()
  expect(result.report?.coverage).toBe('complete')
  expect(result.report?.findings).toEqual([])
  expect(result.report?.limitations).toEqual([])
  expect(result.report?.evidence.map(item => item.path)).toEqual(['src/queue.ts'])
})

it('retries a transient Note index lock when loading current suggestions', async () => {
  const f = await setup()
  const read = vi.spyOn(f.source.notes, 'readSnapshot')
  read.mockRejectedValueOnce(Object.assign(new Error('notes busy: lock held'), { code: 'BUSY' }))
  expect((await f.workspace.read(f.context)).items.some(item => item.noteId === f.noteId)).toBe(true)
  expect(read.mock.calls.length).toBeGreaterThan(1)
})

it('waits for a foreground cold scan longer than the old four-retry lock budget', async () => {
  const f = await setup()
  const read = vi.spyOn(f.source.notes, 'readSnapshot')
  for (let i = 0; i < 5; i++) read.mockRejectedValueOnce(Object.assign(new Error('notes busy: lock held'), { code: 'BUSY' }))
  expect((await f.workspace.read(f.context)).items.some(item => item.noteId === f.noteId)).toBe(true)
  expect(read.mock.calls.length).toBeGreaterThan(5)
})

it('cancels a wait for the Note lock without reconciling a late source observation', async () => {
  const f = await setup(), controller = new AbortController()
  const before = f.workspace.saved(f.context)
  const read = vi.spyOn(f.source.notes, 'readSnapshot').mockRejectedValue(Object.assign(new Error('notes busy: lock held'), { code: 'BUSY' }))
  const pending = f.workspace.read(f.context, controller.signal)
  const failed = expect(pending).rejects.toThrow('cancelled')
  await vi.waitFor(() => expect(read).toHaveBeenCalled())
  controller.abort(Error('cancelled'))
  await failed
  expect(f.workspace.saved(f.context)).toEqual(before)
})

it('publishes exact multiline citations across CRLF and overlapping pages read out of order', async () => {
  const f = await setup()
  await writeFile(join(f.root, 'src/queue.ts'), 'first\r\nsecond\r\nthird\r\n')
  f.generate.mockImplementationOnce(async (_settings, _input, evidence) => {
    await evidence.read('.agents/notes/requirement.md')
    await evidence.read('src/queue.ts', 2, 2)
    await evidence.read('src/queue.ts', 1, 2)
    return { findings: [{ ...f.finding, citations: [{ path: 'src/queue.ts', quote: 'first\nsecond\nthird' }] }], coverage: 'complete', limitations: [], resolvedFindings: [] }
  })
  expect((await f.review()).report?.findings[0].citations[0].quote).toBe('first\nsecond\nthird')
})

it('rejects a citation that bridges unread source lines', async () => {
  const f = await setup()
  await writeFile(join(f.root, 'src/queue.ts'), 'first\nUNREAD\nthird\n')
  f.generate.mockImplementationOnce(async (_settings, _input, evidence) => {
    await evidence.read('.agents/notes/requirement.md')
    await evidence.read('src/queue.ts', 1, 1)
    await evidence.read('src/queue.ts', 3, 1)
    return { findings: [{ ...f.finding, citations: [{ path: 'src/queue.ts', quote: 'first\nthird' }] }], coverage: 'complete', limitations: [], resolvedFindings: [] }
  })
  await expect(f.review()).rejects.toThrow('Citation quote does not match')
})

it('rejects a complete verdict that skips the implementation referenced by the target Note', async () => {
  const f = await setup()
  f.generate.mockImplementationOnce(async (_settings, _input, evidence) => {
    await evidence.read('.agents/notes/requirement.md')
    return { findings: [], coverage: 'complete', limitations: [], resolvedFindings: [] }
  })
  await expect(f.review()).rejects.toThrow('did not check implementation')
})

it('does not count an unrelated source file as the implementation referenced by the target Note', async () => {
  const f = await setup()
  await writeFile(join(f.root, 'src/unrelated.ts'), 'export const unrelated = true\n')
  f.generate.mockImplementationOnce(async (_settings, _input, evidence) => {
    await evidence.read('.agents/notes/requirement.md')
    await evidence.read('src/unrelated.ts')
    return { findings: [], coverage: 'complete', limitations: [] } as any
  })
  await expect(f.review()).rejects.toThrow('src/queue.ts')
  expect(f.workspace.saved(f.context).items.find(item => item.noteId === f.noteId)?.report).toBeNull()
})

it('requires each local code reference and allows an explicit insufficient report', async () => {
  const f = await setup()
  const file = join(f.root, '.agents/notes/requirement.md')
  const source = await readFile(file, 'utf8')
  const metadata = JSON.parse(source.split('---')[1])
  metadata.codeRefs.push({ repoId: f.context.repoId, path: 'src/recovery.ts', role: 'implementation' })
  await writeFile(file, source.replace(source.split('---')[1], '\n' + JSON.stringify(metadata, null, 2) + '\n'))
  await writeFile(join(f.root, 'src/recovery.ts'), 'export const recovered = false\n')
  const result = { findings: [], coverage: 'complete', limitations: [] }
  f.generate.mockImplementationOnce(async (_settings, _input, evidence) => {
    await evidence.read('.agents/notes/requirement.md'); await evidence.read('src/queue.ts')
    return result as any
  })
  await expect(f.review()).rejects.toThrow('src/recovery.ts')
  f.generate.mockImplementationOnce(async (_settings, _input, evidence) => {
    await evidence.read('.agents/notes/requirement.md'); await evidence.read('src/queue.ts')
    return { ...result, coverage: 'insufficient', limitations: ['Recovery implementation has not been read.'] } as any
  })
  expect((await f.review()).report?.coverage).toBe('insufficient')
})

it('requires the target Note to be fully paged before a complete review can publish', async () => {
  const f = await setup()
  await writeFile(join(f.root, '.agents/notes/requirement.md'),
    (await readFile(join(f.root, '.agents/notes/requirement.md'), 'utf8')) + Array.from({ length: 250 }, (_, index) => `Line ${index}\n`).join(''))
  const input = await collectReviewEvidence(f.source, f.context, f.noteId)
  const evidence = new ReviewEvidenceSession(f.source, input)
  await evidence.read(input.target.path)
  await expect(evidence.paths('queue.ts')).rejects.toThrow('Finish reading')
  await expect(evidence.validate()).rejects.toThrow('did not finish')
  await evidence.read(input.target.path, 201)
  expect((await evidence.paths('queue.ts')).items).toContain('src/queue.ts')
  await evidence.validate()
})

it('searches the local workspace when an external rg executable is unavailable', async () => {
  const f = await setup()
  const input = await collectReviewEvidence(f.source, f.context, f.noteId)
  const evidence = new ReviewEvidenceSession(f.source, input)
  await evidence.read(input.target.path)
  const key = Object.keys(process.env).find(name => name.toLowerCase() === 'path')!
  const original = process.env[key]
  try {
    process.env[key] = ''
    expect((await evidence.paths('queue.ts')).items).toContain('src/queue.ts')
    expect((await evidence.search('memory only')).items.some(item => item.includes('src/queue.ts'))).toBe(true)
  } finally { if (original === undefined) delete process.env[key]; else process.env[key] = original }
})

it('publishes before scoring and retains findings regardless of scoring failure or low score', async () => {
  const f = await setup(true)
  f.verifyModel.mockRejectedValueOnce(new Error('JEV unavailable'))
  let result = await f.review()
  expect(result.report?.findings[0].verification).toBe('pending')
  await expect.poll(() => f.workspace.saved(f.context).items.find(item => item.noteId === f.noteId)?.report?.findings[0]).toMatchObject({ verification: 'failed', verificationDetail: { error: 'JEV unavailable' } })
  f.verifyModel.mockResolvedValueOnce({ score: 0.05, question: 'Is the claim supported?', model: 'jev-test' })
  result = await f.review()
  expect(result.report?.findings).toHaveLength(1)
  await expect.poll(() => f.workspace.saved(f.context).items.find(item => item.noteId === f.noteId)?.report?.findings[0]).toMatchObject({ verification: 'scored', verificationDetail: { score: 0.05 } })
})

it('clears obsolete findings with a complete empty review without resolution IDs or JEV calls', async () => {
  const f = await setup(); await f.review(); f.settings.jev.enabled = true
  f.generate.mockImplementationOnce(async (_settings, _input, evidence) => {
    await evidence.read('.agents/notes/requirement.md'); await evidence.read('src/queue.ts')
    return { findings: [], coverage: 'complete', limitations: [] } as any
  })
  expect((await f.review()).report?.findings).toEqual([])
  expect(f.verifyModel).not.toHaveBeenCalled()
})

it('does not wait for a slow score or resurrect a report after a newer review replaces it', async () => {
  const f = await setup(true)
  let release!: (value: { score: number; question: string; model: string }) => void
  f.verifyModel.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  const first = await f.review()
  expect(first.report?.findings[0].verification).toBe('pending')
  f.generate.mockImplementationOnce(async (_settings, _input, evidence) => {
    await evidence.read('.agents/notes/requirement.md'); await evidence.read('src/queue.ts')
    return { findings: [], coverage: 'complete', limitations: [], resolvedFindings: [] }
  })
  const next = await f.review()
  release({ score: 0.99, question: 'Old issue', model: 'jev-test' })
  await f.engine.shutdown()
  expect(f.workspace.saved(f.context).items.find(item => item.noteId === f.noteId)?.report).toEqual(next.report)
})

it('generation failure and malformed/fabricated evidence preserve earlier issues', async () => {
  const f = await setup(); await f.review()
  f.generate.mockRejectedValueOnce(new Error('Model unavailable'))
  await expect(f.review()).rejects.toThrow('Model unavailable')
  expect((await f.workspace.read(f.context)).items.find(item => item.noteId === f.noteId)?.report?.findings).toHaveLength(1)
  f.generate.mockResolvedValueOnce({ findings: [] })
  await expect(f.review()).rejects.toMatchObject({ code: 'TRANSIENT' })
  expect((await f.workspace.read(f.context)).items.find(item => item.noteId === f.noteId)?.report?.findings).toHaveLength(1)
  f.generate.mockImplementationOnce(async (_settings, _input, evidence) => {
    await evidence.read('.agents/notes/requirement.md'); await evidence.read('src/queue.ts')
    return { findings: [{ ...f.finding, citations: [{ path: 'src/queue.ts', quote: 'Invented code' }] }], coverage: 'complete', limitations: [], resolvedFindings: [] }
  })
  await expect(f.review()).rejects.toThrow('Citation quote does not match')
  expect((await f.workspace.read(f.context)).items.find(item => item.noteId === f.noteId)?.report?.findings).toHaveLength(1)
})

it('rejects changed evidence while a model is running and keeps the previous report stale', async () => {
  const f = await setup(); await f.review()
  f.generate.mockImplementationOnce(async (_settings, _input, evidence) => {
    await evidence.read('.agents/notes/requirement.md')
    await evidence.read('src/queue.ts')
    await writeFile(join(f.root, 'src/queue.ts'), 'export const queue = new Map()\n')
    return { findings: [f.finding], coverage: 'complete', limitations: [], resolvedFindings: [] }
  })
  await expect(f.review()).rejects.toThrow('Review evidence changed')
  expect((await f.workspace.read(f.context)).items.find(item => item.noteId === f.noteId)?.report?.stale).toBe(true)
})

it('requires explicit model selection after structure checking and before generating', async () => {
  const f = await setup(); f.settings.generation.modelId = ''
  await expect(f.review()).rejects.toThrow('Configure')
  expect(f.generate).not.toHaveBeenCalled()
})

it('does not publish a late model result after cancellation', async () => {
  const f = await setup(); await f.review()
  const controller = new AbortController()
  f.generate.mockImplementationOnce(async (_settings, _input, evidence) => {
    await evidence.read('.agents/notes/requirement.md')
    controller.abort(new Error('Review cancelled'))
    return { findings: [], coverage: 'complete', limitations: [], resolvedFindings: [{ id: f.finding.id, reason: 'Resolved', citations: f.finding.citations }] }
  })
  await expect(f.engine.review(f.context, f.noteId, f.settings, controller.signal)).rejects.toThrow('cancelled')
  expect((await f.workspace.read(f.context)).items.find(item => item.noteId === f.noteId)?.report?.findings).toHaveLength(1)
})

it('feedback tools read existing suggestions and explicitly clear without generating or editing Notes', async () => {
  const f = await setup(); await f.review()
  const tools = new Map<string, any>()
  registerSuggestionTools({ get: name => tools.get(name), register: tool => tools.set(tool.name, tool) } as any, () => ({ sources: f.source, suggestions: f.workspace }))
  expect([...tools.keys()]).toEqual(['note.suggestions', 'note.suggestions.close'])
  const view = await tools.get('note.suggestions').execute({ noteId: f.noteId }, { workspaceRoot: f.root })
  const item = view.items[0]
  await tools.get('note.suggestions.close').execute({ noteId: f.noteId, branch: view.context.branch, reportRevision: item.reportRevision, findingIds: [f.finding.id] }, { workspaceRoot: f.root })
  expect((await f.workspace.read(f.context)).items.find(item => item.noteId === f.noteId)?.report).toBeNull()
  expect(f.generate).toHaveBeenCalledTimes(1)
})

it('settings persist across reopen without enabling automation and invalid writes retain the original file', async () => {
  const f = await setup(); const file = join(f.root, 'settings.json'); const settings = new ReviewSettingsStore(file)
  expect((await settings.read()).automatic).toEqual({ enabled: false, commits: 5 })
  await settings.update(f.settings)
  expect(await new ReviewSettingsStore(file).read()).toEqual(f.settings)
  expect(() => settings.update({ ...f.settings, automatic: { enabled: true, commits: 0 } })).toThrow()
  expect(await settings.read()).toEqual(f.settings)
})


it('reports malformed files by path before model configuration and never calls the model', async () => {
  const f = await setup()
  await writeFile(join(f.root, '.agents/notes/requirement.md'), '---\n{ broken JSON\n---\n# Broken Note\n')
  const snapshot = await f.source.capture(f.context, [])
  expect(snapshot.structure?.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: '.agents/notes/requirement.md' })]))
  expect(snapshot.structure?.issues.find(issue => issue.path.endsWith('requirement.md'))?.noteId).toBeUndefined()
  await expect(f.engine.review(f.context, f.noteId, DEFAULT_BLUEPRINT_REVIEW_SETTINGS, new AbortController().signal)).rejects.toThrow('Structure check failed')
  expect(f.generate).not.toHaveBeenCalled()
})

it('does not approve an invalid owner and clears the diagnosis only after an actual repair', async () => {
  const f = await setup(), file = join(f.root, '.agents/notes/requirement.md')
  const raw = await readFile(file, 'utf8')
  await writeFile(file, raw.replace(f.context.repoId, randomUUID()))
  expect((await f.source.capture(f.context, [])).structure?.issues.some(issue => issue.path.endsWith('requirement.md'))).toBe(true)
  await expect(f.review()).rejects.toThrow('Structure check failed')
  expect(f.generate).not.toHaveBeenCalled()
  await writeFile(file, raw)
  expect((await f.source.capture(f.context, [])).structure?.issues).toEqual([])
  expect((await f.review()).report?.coverage).toBe('complete')
})

it('checks ordinary Note structure without requiring or invoking a model', async () => {
  const f = await setup(), file = join(f.root, '.agents/notes/requirement.md')
  await writeFile(file, (await readFile(file, 'utf8')).replace('"kind": "requirement"', '"kind": "note"'))
  const result = await f.engine.review(f.context, f.noteId, DEFAULT_BLUEPRINT_REVIEW_SETTINGS, new AbortController().signal)
  expect(result.source?.kind).toBe('note')
  expect(result.report).toBeNull()
  expect((await f.source.capture(f.context, [])).structure?.issues).toEqual([])
  expect(f.generate).not.toHaveBeenCalled()
})

it('keeps duplicate identities as file diagnoses and never assigns them a navigation identity', async () => {
  const f = await setup()
  await writeFile(join(f.root, '.agents/notes/duplicate.md'), await readFile(join(f.root, '.agents/notes/requirement.md')))
  const result = (await f.source.capture(f.context, [])).structure!
  const duplicate = result.issues.filter(issue => issue.message.includes('duplicate note id'))
  expect(duplicate.length).toBeGreaterThan(0)
  expect(duplicate.every(issue => !issue.noteId)).toBe(true)
  await expect(f.review()).rejects.toThrow('Structure check failed')
  expect(f.generate).not.toHaveBeenCalled()
})

it('distinguishes incomplete scans and ignores unbound foreign references without hiding local defects', async () => {
  const f = await setup(), snapshot = await f.source.snapshot(f.context)
  expect(reviewStructure(snapshot)).toMatchObject({ complete: true, issues: [] })
  const partial = { ...snapshot, coverage: { ...snapshot.coverage, status: 'incomplete' as const } }
  expect(reviewStructure(partial).complete).toBe(false)
  expect(() => assertNoteStructure(partial, f.noteId)).toThrow('Structure check failed')
  snapshot.diagnostics.push({ code: 'NOT_READY', message: 'repository not bound in this index: other', path: 'note://' + randomUUID() + '/' + randomUUID() })
  expect(reviewStructure(snapshot).issues).toEqual([])
  snapshot.diagnostics.push({ code: 'SCHEMA_INVALID', message: 'Missing required section', path: '.agents/notes/requirement.md' })
  expect(reviewStructure(snapshot)).toMatchObject({ complete: true, issues: [{ path: '.agents/notes/requirement.md', noteId: f.noteId }] })
  expect(() => assertNoteStructure(snapshot, f.noteId)).toThrow('Missing required section')
})
