/**
 * @file Roundtable native artifact producer (S5, pure)
 * @description Builds `harness-bundle/1` proposals from selected roundtable
 *  facts. Host assigns every identity (bundle, artifact, note, operation);
 *  the model never mints ids. Each selected fact maps to exactly one
 *  operation, so coverage is explicit and nothing merges silently on text
 *  similarity. Invalid proposals return diagnostics only and must never be
 *  saved as formal notes. Retry reuses the same bundle (same ids); a changed
 *  source snapshot demands a new bundle revision. No filesystem, no Electron.
 */
// Note: roundtable natively produces harness bundles — see .agents/notes/agent/roundtable-artifact-bundle-s5.md
import { createHash, randomUUID } from 'node:crypto'
import {
  HEX64_RE,
  NOTE_URI_RE,
  UUID_RE,
  parseNote,
  serializeNote,
  validateBundle,
  validateChangeSet,
  validateNote,
  createNoteInput,
  type ChangeOperation,
  type Diagnostic,
  type NoteKind,
} from '@janus-agent/harness-core'
import { setSection } from '../harness/artifact-producer'
import type { RoundtableFact } from '../../shared/roundtable/events'
import { maintainedNotePath, type NoteAuthoringContext } from '@janusx/note-tools'

export interface BundleBuildItem {
  fact: RoundtableFact
  /** Explicit exclusion keeps coverage honest without inventing prose. */
  exclude?: { reason: string }
  /** Update mode patches one H2 of an existing note instead of creating. */
  update?: { uri: string; expectedHash: string; baseMarkdown: string; section: string; text: string }
  /** Create mode only: hang the new note under this note URI. The graph
   *  projection derives hierarchy from it, so no second write is needed. */
  parentUri?: string
}

export interface BuildBundleInput {
  authoring?: NoteAuthoringContext
  sessionId: string
  roundNumber: number
  /** Target repo UUID; the producer never guesses it from names or paths. */
  repoId: string
  bundleId?: string
  revision?: number
  items: BundleBuildItem[]
}

export interface CoverageEntry {
  sourceRef: string
  operationId?: string
  section?: string
  status: 'covered' | 'excluded'
  reason?: string
}

export interface ArtifactBundle {
  schema: 'harness-bundle/1'
  id: string
  revision: number
  producer: { type: 'roundtable'; id: string; revision: number }
  artifacts: Array<{ artifactId: string; operationId: string; sourceRefs: string[] }>
  changeSet: {
    id: string
    revision: number
    source: { type: 'roundtable'; id: string; revision: number }
    operations: ChangeOperation[]
  }
  coverage: CoverageEntry[]
  unresolved: Array<{ from: string; target: string }>
  /** Source snapshot bound at proposal time; retries compare against it. */
  sources: Array<{ factId: string; kind: string; status: string; contentSha256: string }>
  snapshotHash: string
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** Canonical source snapshot: any selected-fact change alters the hash. */
export function snapshotSourceFacts(
  facts: RoundtableFact[],
  sessionId: string,
  roundNumber: number,
): string {
  const canon = {
    sessionId,
    roundNumber,
    facts: [...facts]
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((f) => ({ id: f.id, kind: f.kind, status: f.status, title: f.title, content: f.content })),
  }
  return sha256Hex(JSON.stringify(canon))
}

export type BundleRetryVerdict = 'save' | 'reuse-saved' | 'stale'

/**
 * Retry guard (C6): retries reuse the same bundle ids so operation identities
 * survive; a changed source snapshot demands a new bundle revision instead of
 * overwriting proposal history. Pure so the service and unit tests share one
 * verdict; the service owns loading and persisting the saved file.
 */
export function resolveBundleRetry(savedSnapshotHash: unknown, snapshotHash: string): BundleRetryVerdict {
  // No prior proposal: persist the fresh build. Anything else — a matching
  // hash for idempotent retry, a moved or unreadable history demanding a new
  // revision — must never silently overwrite the saved file.
  if (savedSnapshotHash === null) return 'save'
  if (typeof savedSnapshotHash !== 'string') return 'stale'
  return savedSnapshotHash === snapshotHash ? 'reuse-saved' : 'stale'
}

export function staleSnapshotDiagnostic(revision: number): Diagnostic {
  return {
    code: 'STALE_BASELINE',
    message: `source snapshot moved under bundle revision ${revision}; rebuild with a new revision instead of overwriting`,
    path: 'revision',
  }
}

function factTarget(fact: RoundtableFact): { kind: NoteKind; lifecycle: 'draft' | 'proposed' } {
  switch (fact.kind) {
    case 'requirement':
      return { kind: 'requirement', lifecycle: 'proposed' }
    case 'solution':
    case 'decision':
      return { kind: 'decision', lifecycle: 'proposed' }
    case 'action':
      // End of meeting never starts execution; actions land as task drafts.
      return { kind: 'task', lifecycle: 'draft' }
    default:
      return { kind: 'idea', lifecycle: 'draft' }
  }
}

const FOLLOW_UP = 'TBD – confirm in follow-up.'

function sectionsFor(kind: NoteKind, content: string): Array<[string, string]> {
  const body = content.trim() || FOLLOW_UP
  switch (kind) {
    case 'requirement':
      return [
        ['Problem', body],
        ['Expected behavior', FOLLOW_UP],
        ['Scope', FOLLOW_UP],
        ['Acceptance criteria', `- [ ] AC-1: ${FOLLOW_UP}`],
      ]
    case 'decision':
      return [
        ['Problem', body],
        ['Proposal', FOLLOW_UP],
        ['Alternatives considered', '- TBD.'],
        ['Risks', '- TBD.'],
      ]
    case 'task':
      return [
        ['Scope', body],
        ['Acceptance criteria', `- [ ] AC-1: ${FOLLOW_UP}`],
        ['Verification', 'Manual review of the linked discussion.'],
      ]
    default:
      return [
        ['Background', body],
        ['Idea', body],
        ['Open questions', 'None.'],
      ]
  }
}

function yamlString(value: string): string {
  return JSON.stringify(value)
}

function createMarkdown(opts: {
  noteId: string
  kind: NoteKind
  lifecycle: 'draft' | 'proposed'
  title: string
  repoId: string
  parentUri: string | null
  sessionId: string
  roundNumber: number
  factId: string
  content: string
  authoring?: NoteAuthoringContext
}): string {
  if (opts.authoring?.schema === 'harness-note/2') {
    const sections = Object.fromEntries(sectionsFor(opts.kind, opts.content).map(([name, text]) => [name === 'Proposal' ? 'Decision' : name === 'Risks' ? 'Consequences' : name === 'Background' ? 'Intent' : name, text]))
    if (opts.kind === 'idea') delete sections.Idea
    const made = createNoteInput(opts.kind, opts.title, opts.parentUri, { schema: 'harness-note/2', module: opts.authoring.module, lifecycle: opts.lifecycle, tags: ['roundtable'], sections })
    const note = parseNote(made.markdown)
    note.meta.id = opts.noteId
    note.meta.extensions = { workflowx: { provenance: { session: opts.sessionId, round: opts.roundNumber, fact: opts.factId } } }
    return serializeNote(note)
  }
  const head = [
    '---',
    'schema: harness-note/1',
    `id: ${opts.noteId}`,
    `kind: ${opts.kind}`,
    `lifecycle: ${opts.lifecycle}`,
    `created: ${today()}`,
    'tags: [roundtable]',
    'repositories:',
    `  primary: ${opts.repoId}`,
    ...(opts.parentUri ? [`parent: ${opts.parentUri}`] : []),
    'extensions:',
    '  workflowx:',
    '    provenance:',
    `      session: ${yamlString(opts.sessionId)}`,
    `      round: ${opts.roundNumber}`,
    `      fact: ${yamlString(opts.factId)}`,
    '---',
    '',
    `# ${opts.title}`,
    '',
  ]
  for (const [name, text] of sectionsFor(opts.kind, opts.content)) {
    head.push(`## ${name}`, '', text, '')
  }
  return head.join('\n')
}

function cleanTitle(fact: RoundtableFact): string {
  const title = fact.title.trim().split('\n')[0].slice(0, 120)
  return title || 'Untitled artifact'
}

export function buildArtifactBundle(input: BuildBundleInput): { bundle: ArtifactBundle; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = []
  const bundleId = input.bundleId ?? randomUUID()
  const revision = input.revision ?? 1
  if (!UUID_RE.test(input.repoId)) {
    diagnostics.push({ code: 'SCHEMA_INVALID', message: `bad repoId ${input.repoId}`, path: 'repoId' })
  }
  if (!Number.isInteger(revision) || revision < 1) {
    diagnostics.push({ code: 'SCHEMA_INVALID', message: 'bundle revision starts at 1', path: 'revision' })
  }

  const artifacts: ArtifactBundle['artifacts'] = []
  const operations: ChangeOperation[] = []
  const coverage: CoverageEntry[] = []
  const seen = new Set<string>()
  const coveredFacts: RoundtableFact[] = []

  input.items.forEach((item, index) => {
    const at = `items[${index}]`
    const fact = item.fact
    if (seen.has(fact.id)) {
      diagnostics.push({ code: 'SCHEMA_INVALID', message: `duplicate fact ${fact.id}`, path: at })
      return
    }
    seen.add(fact.id)
    if (item.exclude) {
      if (!item.exclude.reason.trim()) {
        diagnostics.push({ code: 'SCHEMA_INVALID', message: 'exclusion needs a reason', path: `${at}.exclude.reason` })
        return
      }
      coverage.push({ sourceRef: fact.id, status: 'excluded', reason: item.exclude.reason })
      return
    }
    coveredFacts.push(fact)
    const artifactId = randomUUID()
    const operationId = randomUUID()

    if (item.update) {
      const up = item.update
      if (item.parentUri !== undefined) {
        diagnostics.push({ code: 'SCHEMA_INVALID', message: 'parentUri applies to creates only', path: `${at}.parentUri` })
        return
      }
      if (!NOTE_URI_RE.test(up.uri)) {
        diagnostics.push({ code: 'SCHEMA_INVALID', message: `bad uri ${up.uri}`, path: `${at}.update.uri` })
        return
      }
      if (!HEX64_RE.test(up.expectedHash)) {
        diagnostics.push({ code: 'SCHEMA_INVALID', message: 'update needs exact expectedHash', path: `${at}.update.expectedHash` })
        return
      }
      let after: string
      try {
        const base = parseNote(up.baseMarkdown)
        const uriId = up.uri.split('/').pop()
        if (base.meta.id !== uriId) {
          diagnostics.push({ code: 'SCHEMA_INVALID', message: 'base note id mismatches uri', path: `${at}.update.baseMarkdown` })
          return
        }
        after = base.sections.some(section => section.name === up.section && section.text.trim() === up.text.trim())
          ? up.baseMarkdown
          : serializeNote({ ...base, meta: { ...base.meta, ...(base.meta.schema === 'harness-note/2' ? { updated: new Date().toISOString() } : {}) }, body: setSection(base.body, up.section, up.text) })
      } catch (error) {
        diagnostics.push({
          code: 'SCHEMA_INVALID',
          message: `unparseable base note: ${error instanceof Error ? error.message : String(error)}`,
          path: `${at}.update.baseMarkdown`,
        })
        return
      }
      const problems = validateNote(parseNote(after))
      if (problems.length > 0) {
        diagnostics.push({ code: problems[0].code, message: problems[0].message, path: `${at}.update.afterMarkdown` })
        return
      }
      operations.push({
        operationId,
        type: 'replace',
        uri: up.uri,
        expectedHash: up.expectedHash,
        afterMarkdown: after,
        dependsOn: [],
        reason: `roundtable ${input.sessionId} round ${input.roundNumber}`,
        evidenceRefs: [fact.id],
      })
      artifacts.push({ artifactId, operationId, sourceRefs: [fact.id] })
      coverage.push({ sourceRef: fact.id, operationId, section: up.section, status: 'covered' })
      return
    }

    const noteId = randomUUID()
    const target = factTarget(fact)
    if (item.parentUri !== undefined && !NOTE_URI_RE.test(item.parentUri)) {
      diagnostics.push({ code: 'SCHEMA_INVALID', message: `bad parentUri ${item.parentUri}`, path: `${at}.parentUri` })
      return
    }
    if (input.authoring?.schema === 'harness-note/2' && target.kind === 'task') {
      diagnostics.push({ code: 'NOT_READY', message: 'Roundtable action needs a Task contract (scope, acceptance, verification and review) before it can be saved as a Task; create it with note.write.', path: at })
      return
    }
    const after = createMarkdown({
      authoring: input.authoring,
      noteId,
      kind: target.kind,
      lifecycle: target.lifecycle,
      title: cleanTitle(fact),
      repoId: input.repoId,
      parentUri: item.parentUri ?? null,
      sessionId: input.sessionId,
      roundNumber: input.roundNumber,
      factId: fact.id,
      content: fact.content,
    })
    const problems = validateNote(parseNote(after))
    if (problems.length > 0) {
      diagnostics.push({ code: problems[0].code, message: problems[0].message, path: `${at}.afterMarkdown` })
      return
    }
    operations.push({
      operationId,
      type: 'create',
      uri: `note://${input.repoId}/${noteId}`,
      expectedHash: null,
      ...(input.authoring?.schema === 'harness-note/2' ? { relativePath: maintainedNotePath(input.authoring.directory!, cleanTitle(fact)) } : {}),
      afterMarkdown: after,
      dependsOn: [],
      reason: `roundtable ${input.sessionId} round ${input.roundNumber}`,
      evidenceRefs: [fact.id],
    })
    artifacts.push({ artifactId, operationId, sourceRefs: [fact.id] })
    coverage.push({ sourceRef: fact.id, operationId, section: 'document', status: 'covered' })
  })

  const producer = { type: 'roundtable' as const, id: input.sessionId, revision: input.roundNumber }
  const bundle: ArtifactBundle = {
    schema: 'harness-bundle/1',
    id: bundleId,
    revision,
    producer,
    artifacts,
    changeSet: { id: bundleId, revision, source: producer, operations },
    coverage,
    unresolved: [],
    sources: coveredFacts.map((f) => ({
      factId: f.id,
      kind: f.kind,
      status: f.status,
      contentSha256: sha256Hex(`${f.title}\u0000${f.content}`),
    })),
    snapshotHash: snapshotSourceFacts(coveredFacts, input.sessionId, input.roundNumber),
  }
  for (const d of [...validateBundle({ schema: bundle.schema, revision: bundle.revision, artifacts: bundle.artifacts }), ...validateChangeSet(bundle.changeSet)]) {
    diagnostics.push(d)
  }
  return { bundle, diagnostics }
}
