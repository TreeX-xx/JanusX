// Opt in only: uses an explicitly selected existing provider and synthetic isolated workspaces.
import { beforeAll, afterAll, expect, it, vi } from 'vitest'
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import { SUPPORTED_HARNESS_PROFILE } from '@janus-agent/harness-node'
import { WorkspaceSuggestionSources } from '../../plugins/blueprint/src/main/blueprint/suggestions/sources'
import { WorkspaceSuggestions } from '../../plugins/blueprint/src/main/blueprint/suggestions/workspace-service'
import { ReviewStore } from '../../plugins/blueprint/src/main/blueprint/suggestions/store'
import { SuggestionService } from '../../plugins/blueprint/src/main/blueprint/suggestions/service'
import { NoteReviewEngine } from '../../plugins/blueprint/src/main/blueprint/review/engine'
import { blueprintReviewModels } from '../../src/main/blueprint/review/models'
import { GitReviewScheduler } from '../../plugins/blueprint/src/main/blueprint/review/git-scheduler'
import { git } from '../../plugins/blueprint/src/main/blueprint/review/git-snapshot'
import { DEFAULT_BLUEPRINT_REVIEW_SETTINGS } from '../../plugins/blueprint/src/shared/blueprint-review-settings'

const live = Boolean(process.env.NOTE_REVIEW_LIVE_PROVIDER && process.env.NOTE_REVIEW_LIVE_MODEL && process.env.NOTE_REVIEW_LIVE_CONFIG)
const host = await vi.hoisted(async () => {
  const { mkdtempSync, realpathSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  return { root: process.env.NOTE_REVIEW_LIVE_CONFIG ? mkdtempSync(join(realpathSync.native(tmpdir()), 'note-review-live-')) : '', jevKey: '' }
})
vi.mock('electron', () => ({ app: { getPath: () => host.root, setProxy: async () => {} }, session: { fromPartition: () => null, defaultSession: null }, safeStorage: { isEncryptionAvailable: () => false } }))
vi.mock('../../src/main/llm/jev-credentials', () => ({ getJevKey: async () => host.jevKey || null }))
let sources: WorkspaceSuggestionSources, store: ReviewStore, engine: NoteReviewEngine
const outcomes: unknown[] = []
beforeAll(async () => {
  if (!live) return
  await mkdir(join(host.root, 'janusx'))
  // The production file is read-only; any config normalization happens in this temporary directory.
  await writeFile(join(host.root, 'janusx/llm-config.json'), await readFile(process.env.NOTE_REVIEW_LIVE_CONFIG!))
  if (process.env.NOTE_REVIEW_LIVE_JEV_CREDENTIAL) {
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const electron = createRequire(import.meta.url)('electron') as string
    const { stdout } = await promisify(execFile)(electron, ['tests/fixtures/read-review-credential.cjs', process.env.NOTE_REVIEW_LIVE_JEV_CREDENTIAL], { env, windowsHide: true, timeout: 15000 })
    host.jevKey = JSON.parse(stdout).key
  }
  sources = new WorkspaceSuggestionSources(); store = new ReviewStore(join(host.root, 'review.sqlite'))
  engine = new NoteReviewEngine(new WorkspaceSuggestions(new SuggestionService(store), sources), sources, blueprintReviewModels)
})
afterAll(async () => {
  if (!live) return
  sources?.notes.unwatchAll(); store?.close()
  await mkdir('.cache/blueprint-review-live', { recursive: true })
  await writeFile('.cache/blueprint-review-live/latest.json', JSON.stringify({ testedAt: new Date().toISOString(), providerId: process.env.NOTE_REVIEW_LIVE_PROVIDER, modelId: process.env.NOTE_REVIEW_LIVE_MODEL, jev: host.jevKey ? 'comparison' : 'not-configured', outcomes }, null, 2))
  host.jevKey = ''
  await rm(host.root, { recursive: true, force: true })
})

for (const kind of ['module', 'decision', 'requirement']) for (const scenario of ['consistent', 'contradiction', 'omission', 'insufficient', 'planned']) {
  it.skipIf(!live)(`live ${kind}: ${scenario}`, async () => {
    const root = join(host.root, `${kind}-${scenario}`), repoId = randomUUID(), noteId = randomUUID(), moduleId = kind === 'module' ? noteId : randomUUID()
    await mkdir(join(root, '.agents/notes'), { recursive: true }); await mkdir(join(root, 'src'))
    await writeFile(join(root, '.agents/harness.json'), JSON.stringify({ schemaVersion: 1, repoId, name: 'Queue fixture', profile: SUPPORTED_HARNESS_PROFILE }))
    const note = (id: string, noteKind: string, body: string) => '---\n' + JSON.stringify({ schema: 'harness-note/2', id, kind: noteKind, lifecycle: 'accepted', created: '2026-10-10', updated: '2026-10-10T00:00:00Z',
      ...(noteKind === 'module' ? { moduleState: scenario === 'planned' ? 'planned' : 'implemented', role: 'project' } : { module: `note://${repoId}/${moduleId}` }),
      codeRefs: [{ repoId, path: 'src/queue.ts', role: 'implementation' }],
    }, null, 2) + '\n---\n\n# Volatile queue\n\n' + (noteKind === 'decision'
      ? '## Problem\n\nChoose queue semantics for transient process-local strings.\n\n## Decision\n\n' + body + '\n\n## Alternatives considered\n\nDisk persistence has additional I/O and recovery costs.\n\n## Consequences\n\nCallers must follow the declared durability boundary.'
      : noteKind === 'requirement' ? '## Expected behavior\n\n' + body + (body.includes('## Acceptance criteria') ? '' : '\n\n## Acceptance criteria\n\n- [ ] AC-1: The queue exhibits the behavior stated above.') : body)
    const moduleBody = '## Responsibility\n\nA process-local volatile queue for temporary strings. Durable persistence, cross-process use and concurrent writers are outside the scope.\n\n## Design\n\nThe enqueue function appends a string to the in-memory queue. Reset clears the queue. Items are lost on restart by design.\n'
    const bodies = {
      consistent: 'The queue is volatile and items are lost on restart by design. enqueue appends a string. reset clears the queue. There is no disk I/O. This matches the current implementation.',
      contradiction: 'The current enqueue implementation writes every item to disk before returning. Items survive process restart today. No persistence work remains.',
      omission: 'The queue is volatile. Its API accepts strings through enqueue(input). Reset behavior is not described here.',
      insufficient: 'The durability implementation is owned by the referenced queue source. Its behavior cannot be established without reading that source.',
      planned: 'Future requirement, not implemented: persist queued input to disk and recover it after restart. The present in-memory implementation is intentional during planning. No claim is made that durability exists today.\n\n## Acceptance criteria\n\n- [ ] AC-1: After enqueue returns, kill the process, restart it and recover the exact input once.\n- [ ] AC-2: Preserve order; reset removes queued data durably.\nImplementation and recovery design are deferred to a later task.',
    }
    if (kind !== 'module') await writeFile(join(root, '.agents/notes/module.md'), note(moduleId, 'module', moduleBody))
    const targetPath = join(root, `.agents/notes/${kind}.md`)
    await writeFile(targetPath, note(noteId, kind, kind === 'module' && scenario === 'consistent' ? moduleBody : bodies[scenario]))
    if (scenario === 'omission') {
      await writeFile(join(root, '.agents/notes/reset-policy.md'), note(randomUUID(), 'requirement', 'Documentation requirement: every queue module description, queue decision and queue requirement must describe that reset permanently removes all queued strings in the current process. Merely saying reset is not described does not meet this requirement.'))
      const target = await readFile(targetPath, 'utf8')
      const policy = JSON.parse((await readFile(join(root, '.agents/notes/reset-policy.md'), 'utf8')).split('---')[1])
      await writeFile(targetPath, target + `\n\nRelated documentation constraint: [reset policy](note://${repoId}/${policy.id}).\n`)
    }
    if (scenario !== 'insufficient') await writeFile(join(root, 'src/queue.ts'), 'const queue: string[] = [];\nexport function enqueue(input: string) { queue.push(input) }\n' + (scenario === 'omission' ? '' : 'export function reset() { queue.length = 0 }\n'))
    const before = await readFile(targetPath)
    try {
      const context = await sources.context(root)
      const snapshot = await sources.notes.readSnapshot(context.workspacePath)
      if (!snapshot.entries.some(entry => entry.classification === 'valid' && entry.doc?.id === noteId)) {
        outcomes.push({ kind, scenario, context, diagnostic: snapshot })
        throw new Error('Invalid live fixture')
      }
      const settings = { ...structuredClone(DEFAULT_BLUEPRINT_REVIEW_SETTINGS), generation: { providerId: process.env.NOTE_REVIEW_LIVE_PROVIDER!, modelId: process.env.NOTE_REVIEW_LIVE_MODEL! } }
      const result = await engine.review(context, noteId, settings, new AbortController().signal)
      outcomes.push({ kind, scenario, report: result.report })
      expect(await readFile(targetPath)).toEqual(before)
      expect(result.report?.findings.every(f => f.verification === 'not-configured')).toBe(true)
      if (scenario === 'consistent' || scenario === 'planned') expect(result.report?.findings ?? []).toHaveLength(0)
      if (scenario === 'contradiction') expect(result.report?.findings.some(f => f.category === 'contradiction')).toBe(true)
      if (scenario === 'omission') expect(result.report?.findings.some(f => f.category === 'omission')).toBe(true)
      if (scenario === 'insufficient') expect(result.report?.coverage).toBe('insufficient')
      if (host.jevKey && result.report?.findings.length) {
        const generated = { findings: result.report.findings.map(({ source: _source, evidence: _evidence, stale: _stale, ...finding }) => finding), coverage: result.report.coverage, limitations: result.report.limitations, resolvedFindings: [] }
        const verificationEngine = new NoteReviewEngine(engine.workspace, sources, { ...blueprintReviewModels, generate: async (_settings, input, evidence) => {
          await evidence.read(input.target.path)
          for (const item of result.report!.evidence) await evidence.read(item.path)
          return generated
        } })
        settings.jev.enabled = true
        const verified = await verificationEngine.review(context, noteId, settings, new AbortController().signal)
        outcomes.push({ kind, scenario, comparison: 'same-generated-findings-with-JEV', report: verified.report })
        expect(verified.report?.findings.length).toBe(result.report.findings.length)
        expect(verified.report?.findings.every(f => f.verification !== 'not-configured')).toBe(true)
      }
    } catch (error) {
      const config = JSON.parse(await readFile(process.env.NOTE_REVIEW_LIVE_CONFIG!, 'utf8'))
      let message = error instanceof Error ? error.message : 'Unknown error'
      const scrub = (value: unknown, key = '') => {
        if (typeof value === 'string' && /key|secret|token|credential|password/i.test(key) && value.length > 3) message = message.split(value).join('[redacted]')
        else if (value && typeof value === 'object') for (const [name, child] of Object.entries(value)) scrub(child, name)
      }
      scrub(config)
      if (host.jevKey) message = message.split(host.jevKey).join('[redacted]')
      outcomes.push({ kind, scenario, error: error instanceof Error ? error.name : 'Unknown error', message: message.replace(/https?:\/\/\S+/g, '[endpoint]').slice(0, 1500) })
      // SDK errors can contain provider request headers; never print their raw objects.
      throw new Error(`Live review failed (${kind}/${scenario}); inspect sanitized local report`)
    }
  }, 0)
}

it.skipIf(!live)('live automatic Git review publishes a committed contradiction with a dirty checkout', async () => {
  const root = join(host.root, 'automatic-git'), repoId = randomUUID(), noteId = randomUUID()
  await mkdir(join(root, '.agents/notes'), { recursive: true }); await mkdir(join(root, 'src'))
  await writeFile(join(root, '.agents/harness.json'), JSON.stringify({ schemaVersion: 1, repoId, name: 'Git queue fixture', profile: SUPPORTED_HARNESS_PROFILE }))
  const note = (claim: string) => '---\n' + JSON.stringify({ schema: 'harness-note/2', id: noteId, kind: 'module', role: 'project',
    lifecycle: 'accepted', moduleState: 'implemented', created: '2026-10-10', updated: '2026-10-10T00:00:00Z',
    codeRefs: [{ repoId, path: 'src/queue.ts', role: 'implementation' }],
  }) + '\n---\n# Queue implementation\n\n## Responsibility\n\nPersist the implementation contract.\n\n## Design\n\n' + claim + '\n'
  await writeFile(join(root, '.agents/notes/module.md'), note('The current queue has a version 1 implementation.'))
  await writeFile(join(root, 'src/queue.ts'), 'export const queueVersion = 1\n')
  await git(root, ['init', '-b', 'main']); await git(root, ['config', 'user.email', 'test@example.invalid'])
  await git(root, ['config', 'user.name', 'Review Test']); await git(root, ['config', 'core.autocrlf', 'false'])
  await git(root, ['add', '.']); await git(root, ['commit', '-m', 'baseline'])
  const settings = { ...structuredClone(DEFAULT_BLUEPRINT_REVIEW_SETTINGS), generation: { providerId: process.env.NOTE_REVIEW_LIVE_PROVIDER!, modelId: process.env.NOTE_REVIEW_LIVE_MODEL! } }
  settings.automatic = { enabled: true, commits: 1 }
  const scheduler = new GitReviewScheduler(join(host.root, 'automatic-git-state.json'), {
    context: path => sources.context(path), settings: async () => settings,
    review: (context, id, pinned, signal) => engine.review(context, id, settings, signal, undefined, undefined, pinned),
  })
  try {
    await scheduler.tick(root)
    await writeFile(join(root, '.agents/notes/module.md'), note('The current queue has a version 2 implementation. No version 1 code remains.'))
    await git(root, ['add', '.']); await git(root, ['commit', '-m', 'incorrect Note claim'])
    await writeFile(join(root, '.agents/notes/module.md'), note('Uncommitted local draft describes a future version 3.'))
    await writeFile(join(root, 'src/queue.ts'), 'export const queueVersion = 3\n')
    await scheduler.tick(root)
    const item = (await engine.workspace.read(await sources.context(root))).items.find(item => item.noteId === noteId)
    outcomes.push({ kind: 'automatic-git', scenario: 'committed-contradiction', activity: scheduler.activity(root)?.lastRun, report: item?.report })
    expect(scheduler.activity(root)?.lastRun).toMatchObject({ reviewed: 1, failed: 0 })
    expect(item?.report?.findings.some(finding => finding.category === 'contradiction')).toBe(true)
    expect(item?.report?.stale).toBe(true)
    expect(item?.report?.provenance?.commit).toMatch(/^[a-f0-9]{40}$/)
  } finally { await scheduler.shutdown() }
}, 0)
